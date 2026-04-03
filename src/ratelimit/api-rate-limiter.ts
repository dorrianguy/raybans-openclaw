/**
 * API Rate Limiter — Production-Grade Request Throttling
 *
 * Protects the platform APIs from abuse, enforces plan-based limits,
 * and provides fair resource allocation across customers.
 *
 * Features:
 * - Token bucket algorithm (smooth rate limiting)
 * - Sliding window counters (accurate per-period limits)
 * - Per-customer, per-plan, per-endpoint limits
 * - Plan-based rate limits (free/solo/multi/enterprise)
 * - Burst allowance: short spike tolerance above steady rate
 * - IP-based limiting for unauthenticated requests
 * - Endpoint-specific overrides (e.g., /api/vision is more expensive)
 * - Concurrency limiting (max simultaneous requests)
 * - Cost-based limiting: vision API calls cost more "tokens" than list calls
 * - Grace period: first N requests exempt from limits (onboarding UX)
 * - Retry-After header calculation
 * - Rate limit headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 * - Whitelist/blacklist support
 * - Metrics: total allowed, denied, per-customer stats
 * - Voice summary for status reporting
 *
 * 🌙 Night Shift Agent — Night #30
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type PlanTier = 'free' | 'solo' | 'multi' | 'enterprise' | 'internal';

export interface RateLimitRule {
  maxRequests: number; // requests per window
  windowMs: number; // window duration in ms
  burstAllowance?: number; // extra requests allowed in burst (default: 0)
  costPerRequest?: number; // token cost per request (default: 1)
  maxConcurrent?: number; // max simultaneous requests
  graceRequests?: number; // exempt first N requests
}

export interface PlanLimits {
  global: RateLimitRule; // overall rate limit
  endpoints?: Record<string, RateLimitRule>; // per-endpoint overrides
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetMs: number; // ms until window resets
  retryAfterMs?: number; // ms to wait before retrying (only if denied)
  cost: number;
  headers: Record<string, string>;
}

export interface RateLimiterConfig {
  planLimits?: Record<PlanTier, PlanLimits>;
  defaultPlan?: PlanTier;
  whitelist?: string[]; // customer IDs exempt from limits
  blacklist?: string[]; // customer IDs permanently blocked
  ipLimits?: RateLimitRule; // limits for unauthenticated IP-based requests
  cleanupIntervalMs?: number; // how often to clean expired windows (default: 60000)
}

interface BucketState {
  tokens: number;
  lastRefill: number;
  windowStart: number;
  windowCount: number;
  totalRequests: number;
  totalDenied: number;
  concurrent: number;
  graceUsed: number;
  firstRequest: number;
}

export interface LimiterMetrics {
  totalAllowed: number;
  totalDenied: number;
  totalCost: number;
  activeCustomers: number;
  customerStats: Record<string, { allowed: number; denied: number; lastRequest: number }>;
  planBreakdown: Record<string, { allowed: number; denied: number }>;
  topDenied: Array<{ id: string; denials: number }>;
}

// ─── Default Plan Limits ─────────────────────────────────────────────────────

const DEFAULT_PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    global: {
      maxRequests: 100,
      windowMs: 3600000, // 100 per hour
      burstAllowance: 10,
      maxConcurrent: 2,
      graceRequests: 20,
    },
    endpoints: {
      '/api/vision': {
        maxRequests: 20,
        windowMs: 3600000,
        costPerRequest: 5,
        maxConcurrent: 1,
      },
      '/api/export': {
        maxRequests: 5,
        windowMs: 3600000,
        costPerRequest: 3,
      },
    },
  },
  solo: {
    global: {
      maxRequests: 1000,
      windowMs: 3600000,
      burstAllowance: 50,
      maxConcurrent: 5,
      graceRequests: 50,
    },
    endpoints: {
      '/api/vision': {
        maxRequests: 200,
        windowMs: 3600000,
        costPerRequest: 3,
        maxConcurrent: 3,
      },
    },
  },
  multi: {
    global: {
      maxRequests: 5000,
      windowMs: 3600000,
      burstAllowance: 200,
      maxConcurrent: 20,
    },
    endpoints: {
      '/api/vision': {
        maxRequests: 1000,
        windowMs: 3600000,
        costPerRequest: 2,
        maxConcurrent: 10,
      },
    },
  },
  enterprise: {
    global: {
      maxRequests: 50000,
      windowMs: 3600000,
      burstAllowance: 1000,
      maxConcurrent: 100,
    },
  },
  internal: {
    global: {
      maxRequests: 1000000,
      windowMs: 3600000,
      maxConcurrent: 1000,
    },
  },
};

const DEFAULT_IP_LIMITS: RateLimitRule = {
  maxRequests: 30,
  windowMs: 60000, // 30 per minute for unauthenticated
  burstAllowance: 5,
  maxConcurrent: 2,
};

// ─── API Rate Limiter ────────────────────────────────────────────────────────

export class ApiRateLimiter {
  private buckets: Map<string, BucketState> = new Map();
  private customerPlans: Map<string, PlanTier> = new Map();
  private planLimits: Record<PlanTier, PlanLimits>;
  private whitelist: Set<string>;
  private blacklist: Set<string>;
  private ipLimits: RateLimitRule;
  private defaultPlan: PlanTier;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Metrics
  private _totalAllowed = 0;
  private _totalDenied = 0;
  private _totalCost = 0;
  private _planStats: Map<string, { allowed: number; denied: number }> = new Map();

  constructor(config: RateLimiterConfig = {}) {
    this.planLimits = config.planLimits ?? DEFAULT_PLAN_LIMITS;
    this.defaultPlan = config.defaultPlan ?? 'free';
    this.whitelist = new Set(config.whitelist ?? []);
    this.blacklist = new Set(config.blacklist ?? []);
    this.ipLimits = config.ipLimits ?? DEFAULT_IP_LIMITS;

    // Start cleanup timer
    const cleanupMs = config.cleanupIntervalMs ?? 60000;
    if (cleanupMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), cleanupMs);
    }
  }

  // ── Customer Plan Management ──────────────────────────────────────────

  setCustomerPlan(customerId: string, plan: PlanTier): void {
    this.customerPlans.set(customerId, plan);
  }

  getCustomerPlan(customerId: string): PlanTier {
    return this.customerPlans.get(customerId) ?? this.defaultPlan;
  }

  removeCustomer(customerId: string): void {
    this.customerPlans.delete(customerId);
    this.buckets.delete(customerId);
  }

  // ── Whitelist / Blacklist ─────────────────────────────────────────────

  addToWhitelist(id: string): void {
    this.whitelist.add(id);
    this.blacklist.delete(id); // can't be both
  }

  removeFromWhitelist(id: string): void {
    this.whitelist.delete(id);
  }

  addToBlacklist(id: string): void {
    this.blacklist.add(id);
    this.whitelist.delete(id); // can't be both
  }

  removeFromBlacklist(id: string): void {
    this.blacklist.delete(id);
  }

  isWhitelisted(id: string): boolean {
    return this.whitelist.has(id);
  }

  isBlacklisted(id: string): boolean {
    return this.blacklist.has(id);
  }

  // ── Rate Check ────────────────────────────────────────────────────────

  checkLimit(customerId: string, endpoint?: string): RateLimitResult {
    // Blacklisted: always deny
    if (this.blacklist.has(customerId)) {
      this._totalDenied++;
      this.trackPlanStat(customerId, false);
      return {
        allowed: false,
        remaining: 0,
        limit: 0,
        resetMs: 0,
        retryAfterMs: Infinity,
        cost: 0,
        headers: this.buildHeaders(0, 0, 0),
      };
    }

    // Whitelisted: always allow
    if (this.whitelist.has(customerId)) {
      this._totalAllowed++;
      this.trackPlanStat(customerId, true);
      return {
        allowed: true,
        remaining: Infinity,
        limit: Infinity,
        resetMs: 0,
        cost: 1,
        headers: this.buildHeaders(Infinity, Infinity, 0),
      };
    }

    // Get plan and applicable rule
    const plan = this.getCustomerPlan(customerId);
    const planConfig = this.planLimits[plan];
    if (!planConfig) {
      // Unknown plan — use default
      return this.checkLimit(customerId); // recursion with default plan
    }

    // Determine which rule to use
    let rule = planConfig.global;
    if (endpoint && planConfig.endpoints?.[endpoint]) {
      rule = planConfig.endpoints[endpoint];
    }

    return this.applyRule(customerId, endpoint, rule, plan);
  }

  checkIpLimit(ip: string): RateLimitResult {
    if (this.blacklist.has(ip)) {
      return {
        allowed: false,
        remaining: 0,
        limit: 0,
        resetMs: 0,
        retryAfterMs: Infinity,
        cost: 0,
        headers: this.buildHeaders(0, 0, 0),
      };
    }

    if (this.whitelist.has(ip)) {
      return {
        allowed: true,
        remaining: Infinity,
        limit: Infinity,
        resetMs: 0,
        cost: 1,
        headers: this.buildHeaders(Infinity, Infinity, 0),
      };
    }

    return this.applyRule(`ip:${ip}`, undefined, this.ipLimits, 'free');
  }

  private applyRule(
    key: string,
    endpoint: string | undefined,
    rule: RateLimitRule,
    plan: PlanTier
  ): RateLimitResult {
    const bucketKey = endpoint ? `${key}:${endpoint}` : key;
    const now = Date.now();
    const cost = rule.costPerRequest ?? 1;

    // Get or create bucket
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        tokens: rule.maxRequests + (rule.burstAllowance ?? 0),
        lastRefill: now,
        windowStart: now,
        windowCount: 0,
        totalRequests: 0,
        totalDenied: 0,
        concurrent: 0,
        graceUsed: 0,
        firstRequest: now,
      };
      this.buckets.set(bucketKey, bucket);
    }

    // Check grace period
    if (rule.graceRequests && bucket.graceUsed < rule.graceRequests) {
      bucket.graceUsed++;
      bucket.totalRequests++;
      this._totalAllowed++;
      this._totalCost += cost;
      this.trackPlanStat(key, true);

      return {
        allowed: true,
        remaining: rule.graceRequests - bucket.graceUsed,
        limit: rule.graceRequests,
        resetMs: 0,
        cost,
        headers: this.buildHeaders(
          rule.graceRequests,
          rule.graceRequests - bucket.graceUsed,
          0
        ),
      };
    }

    // Sliding window: reset if window has elapsed
    if (now - bucket.windowStart >= rule.windowMs) {
      bucket.windowStart = now;
      bucket.windowCount = 0;
      bucket.tokens = rule.maxRequests + (rule.burstAllowance ?? 0);
    }

    // Refill tokens proportionally
    const elapsed = now - bucket.lastRefill;
    const refillRate = rule.maxRequests / rule.windowMs; // tokens per ms
    const tokensToAdd = elapsed * refillRate;
    bucket.tokens = Math.min(
      rule.maxRequests + (rule.burstAllowance ?? 0),
      bucket.tokens + tokensToAdd
    );
    bucket.lastRefill = now;

    // Check concurrency limit
    if (rule.maxConcurrent && bucket.concurrent >= rule.maxConcurrent) {
      bucket.totalDenied++;
      this._totalDenied++;
      this.trackPlanStat(key, false);

      const resetMs = rule.windowMs - (now - bucket.windowStart);
      return {
        allowed: false,
        remaining: 0,
        limit: rule.maxConcurrent,
        resetMs,
        retryAfterMs: 1000, // suggest retry in 1 second for concurrency
        cost,
        headers: this.buildHeaders(rule.maxConcurrent, 0, Math.ceil(resetMs / 1000)),
      };
    }

    // Check token availability
    if (bucket.tokens < cost) {
      bucket.totalDenied++;
      this._totalDenied++;
      this.trackPlanStat(key, false);

      const resetMs = rule.windowMs - (now - bucket.windowStart);
      const retryAfterMs = Math.ceil((cost - bucket.tokens) / refillRate);

      return {
        allowed: false,
        remaining: Math.max(0, Math.floor(bucket.tokens)),
        limit: rule.maxRequests,
        resetMs,
        retryAfterMs,
        cost,
        headers: this.buildHeaders(
          rule.maxRequests,
          Math.max(0, Math.floor(bucket.tokens)),
          Math.ceil(resetMs / 1000)
        ),
      };
    }

    // Allow the request
    bucket.tokens -= cost;
    bucket.windowCount++;
    bucket.totalRequests++;
    this._totalAllowed++;
    this._totalCost += cost;
    this.trackPlanStat(key, true);

    const resetMs = rule.windowMs - (now - bucket.windowStart);

    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      limit: rule.maxRequests,
      resetMs,
      cost,
      headers: this.buildHeaders(
        rule.maxRequests,
        Math.floor(bucket.tokens),
        Math.ceil(resetMs / 1000)
      ),
    };
  }

  // ── Concurrency Tracking ──────────────────────────────────────────────

  acquireConcurrency(customerId: string, endpoint?: string): boolean {
    const plan = this.getCustomerPlan(customerId);
    const planConfig = this.planLimits[plan];
    const rule = (endpoint && planConfig?.endpoints?.[endpoint]) ?? planConfig?.global;

    if (!rule?.maxConcurrent) return true;

    const bucketKey = endpoint ? `${customerId}:${endpoint}` : customerId;
    const bucket = this.buckets.get(bucketKey);
    if (!bucket) return true;

    if (bucket.concurrent >= rule.maxConcurrent) return false;

    bucket.concurrent++;
    return true;
  }

  releaseConcurrency(customerId: string, endpoint?: string): void {
    const bucketKey = endpoint ? `${customerId}:${endpoint}` : customerId;
    const bucket = this.buckets.get(bucketKey);
    if (bucket && bucket.concurrent > 0) {
      bucket.concurrent--;
    }
  }

  // ── Headers ───────────────────────────────────────────────────────────

  private buildHeaders(
    limit: number,
    remaining: number,
    resetSeconds: number
  ): Record<string, string> {
    return {
      'X-RateLimit-Limit': String(limit === Infinity ? 'unlimited' : limit),
      'X-RateLimit-Remaining': String(remaining === Infinity ? 'unlimited' : remaining),
      'X-RateLimit-Reset': String(resetSeconds),
    };
  }

  // ── Plan Stats ────────────────────────────────────────────────────────

  private trackPlanStat(key: string, allowed: boolean): void {
    const plan = this.customerPlans.get(key) ?? this.defaultPlan;
    const stats = this._planStats.get(plan) ?? { allowed: 0, denied: 0 };
    if (allowed) stats.allowed++; else stats.denied++;
    this._planStats.set(plan, stats);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  private cleanup(): void {
    const now = Date.now();
    const staleThreshold = 3600000; // 1 hour

    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > staleThreshold && bucket.concurrent === 0) {
        this.buckets.delete(key);
      }
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────

  getMetrics(): LimiterMetrics {
    const customerStats: Record<string, { allowed: number; denied: number; lastRequest: number }> = {};

    for (const [key, bucket] of this.buckets.entries()) {
      if (key.startsWith('ip:') || key.includes(':')) continue; // skip IP and endpoint buckets
      customerStats[key] = {
        allowed: bucket.totalRequests - bucket.totalDenied,
        denied: bucket.totalDenied,
        lastRequest: bucket.lastRefill,
      };
    }

    const planBreakdown: Record<string, { allowed: number; denied: number }> = {};
    for (const [plan, stats] of this._planStats) {
      planBreakdown[plan] = { ...stats };
    }

    // Top denied customers
    const topDenied = Object.entries(customerStats)
      .filter(([_, s]) => s.denied > 0)
      .sort((a, b) => b[1].denied - a[1].denied)
      .slice(0, 10)
      .map(([id, s]) => ({ id, denials: s.denied }));

    return {
      totalAllowed: this._totalAllowed,
      totalDenied: this._totalDenied,
      totalCost: this._totalCost,
      activeCustomers: this.buckets.size,
      customerStats,
      planBreakdown,
      topDenied,
    };
  }

  resetMetrics(): void {
    this._totalAllowed = 0;
    this._totalDenied = 0;
    this._totalCost = 0;
    this._planStats.clear();
    for (const bucket of this.buckets.values()) {
      bucket.totalRequests = 0;
      bucket.totalDenied = 0;
    }
  }

  // ── Introspection ─────────────────────────────────────────────────────

  getCustomerUsage(customerId: string): {
    plan: PlanTier;
    totalRequests: number;
    totalDenied: number;
    currentTokens: number;
    concurrent: number;
    graceRemaining: number;
  } | null {
    const bucket = this.buckets.get(customerId);
    if (!bucket) return null;

    const plan = this.getCustomerPlan(customerId);
    const planConfig = this.planLimits[plan];
    const graceTotal = planConfig?.global.graceRequests ?? 0;

    return {
      plan,
      totalRequests: bucket.totalRequests,
      totalDenied: bucket.totalDenied,
      currentTokens: Math.floor(bucket.tokens),
      concurrent: bucket.concurrent,
      graceRemaining: Math.max(0, graceTotal - bucket.graceUsed),
    };
  }

  getPlanLimits(plan: PlanTier): PlanLimits | undefined {
    return this.planLimits[plan];
  }

  // ── Voice Summary ─────────────────────────────────────────────────────

  getVoiceSummary(): string {
    const m = this.getMetrics();
    const parts: string[] = [];

    const total = m.totalAllowed + m.totalDenied;
    if (total === 0) return 'Rate limiter is idle. No requests processed.';

    parts.push(`Processed ${total} API requests.`);

    const denyRate = total > 0 ? Math.round((m.totalDenied / total) * 100) : 0;
    parts.push(`${m.totalAllowed} allowed, ${m.totalDenied} denied (${denyRate}% deny rate).`);

    if (m.topDenied.length > 0) {
      parts.push(`Top rate-limited customer: ${m.topDenied[0].id} with ${m.topDenied[0].denials} denials.`);
    }

    if (Object.keys(m.planBreakdown).length > 0) {
      const planSummary = Object.entries(m.planBreakdown)
        .map(([plan, stats]) => `${plan}: ${stats.allowed} ok, ${stats.denied} denied`)
        .join('; ');
      parts.push(`By plan: ${planSummary}.`);
    }

    return parts.join(' ');
  }

  // ── Destroy ───────────────────────────────────────────────────────────

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.buckets.clear();
    this.customerPlans.clear();
    this.whitelist.clear();
    this.blacklist.clear();
  }
}
