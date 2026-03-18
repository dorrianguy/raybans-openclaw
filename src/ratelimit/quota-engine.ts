/**
 * API Rate Limiter & Quota Engine
 *
 * Enforces billing tier limits across the platform:
 * - Vision API calls per hour/day/month
 * - Agent requests per day
 * - Storage limits (images, memory entries)
 * - Export limits
 * - TTS minutes per month
 * - Concurrent session limits
 *
 * Features:
 * - Token bucket rate limiting (burst-friendly)
 * - Sliding window counters (accurate period tracking)
 * - Per-user quota management
 * - Billing tier enforcement (free/solo/multi/enterprise)
 * - Usage analytics and trend tracking
 * - Overage handling (soft limit with warnings, hard limit blocks)
 * - Grace periods for tier transitions
 * - Webhook notifications for limit approaching/exceeded
 *
 * @module ratelimit/quota-engine
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export type PricingTier = 'free' | 'solo' | 'multi' | 'enterprise' | 'pay_per_count';

export type ResourceType =
  | 'vision_api_calls'
  | 'agent_requests'
  | 'tts_minutes'
  | 'storage_images'
  | 'storage_memory'
  | 'exports'
  | 'concurrent_sessions'
  | 'locations'
  | 'api_requests'      // external API calls
  | 'webhook_events';

export type LimitPeriod = 'minute' | 'hour' | 'day' | 'month' | 'total';

export type OveragePolicy = 'block' | 'warn' | 'charge' | 'throttle';

export interface TierLimits {
  tier: PricingTier;
  limits: ResourceLimit[];
  /** Monthly price in cents */
  priceMonthly: number;
  /** Annual price in cents (if different) */
  priceAnnual?: number;
  /** Features included */
  features: string[];
}

export interface ResourceLimit {
  resource: ResourceType;
  period: LimitPeriod;
  limit: number;
  /** What happens when limit is exceeded */
  overagePolicy: OveragePolicy;
  /** For 'charge' policy: cost per unit over limit in cents */
  overageCostCents?: number;
  /** Percentage of limit to trigger warning (0-1) */
  warningThreshold: number;
  /** Burst allowance (token bucket: extra capacity for spikes) */
  burstAllowance?: number;
}

export interface QuotaState {
  userId: string;
  tier: PricingTier;
  resources: Map<string, ResourceUsage>;
  /** Timestamp when tier was last changed */
  tierChangedAt: string;
  /** Grace period expiry (allows old tier limits for a period after downgrade) */
  gracePeriodUntil?: string;
}

export interface ResourceUsage {
  resource: ResourceType;
  period: LimitPeriod;
  /** Current usage count */
  current: number;
  /** Maximum allowed */
  limit: number;
  /** Period start timestamp */
  periodStart: string;
  /** Whether warning has been triggered this period */
  warningTriggered: boolean;
  /** Whether limit has been exceeded this period */
  limitExceeded: boolean;
  /** Token bucket: current tokens available */
  tokensAvailable?: number;
  /** Token bucket: last refill timestamp */
  lastRefillAt?: string;
}

export interface QuotaCheckResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** If not allowed, why */
  reason?: string;
  /** Current usage after this request (if allowed) */
  currentUsage?: number;
  /** Maximum allowed */
  limit?: number;
  /** Percentage used */
  percentUsed?: number;
  /** Whether this triggered a warning */
  isWarning?: boolean;
  /** Remaining in this period */
  remaining?: number;
  /** When the period resets */
  resetsAt?: string;
  /** If charged for overage, the cost in cents */
  overageCostCents?: number;
}

export interface UsageSummary {
  userId: string;
  tier: PricingTier;
  period: { start: string; end: string };
  resources: Array<{
    resource: ResourceType;
    period: LimitPeriod;
    used: number;
    limit: number;
    percentUsed: number;
    isWarning: boolean;
    isExceeded: boolean;
  }>;
  totalOverageCostCents: number;
  estimatedMonthlyUsage: Record<ResourceType, number>;
}

export interface QuotaEngineConfig {
  /** Default tier for new users */
  defaultTier: PricingTier;
  /** Enable grace period on tier downgrade */
  gracePeriodEnabled: boolean;
  /** Grace period duration in hours */
  gracePeriodHours: number;
  /** Token bucket refill rate (tokens per second) */
  tokenRefillRate: number;
  /** Enable usage trend estimation */
  estimateMonthlyUsage: boolean;
  /** Debug mode */
  debug: boolean;
}

export const DEFAULT_QUOTA_CONFIG: QuotaEngineConfig = {
  defaultTier: 'free',
  gracePeriodEnabled: true,
  gracePeriodHours: 72,
  tokenRefillRate: 1,
  estimateMonthlyUsage: true,
  debug: false,
};

export interface QuotaEngineEvents {
  'quota:warning': (userId: string, resource: ResourceType, percentUsed: number) => void;
  'quota:exceeded': (userId: string, resource: ResourceType, policy: OveragePolicy) => void;
  'quota:reset': (userId: string, resource: ResourceType) => void;
  'tier:changed': (userId: string, oldTier: PricingTier, newTier: PricingTier) => void;
  'overage:charged': (userId: string, resource: ResourceType, costCents: number) => void;
  'usage:recorded': (userId: string, resource: ResourceType, amount: number) => void;
}

// ─── Tier Definitions ───────────────────────────────────────────

export const TIER_DEFINITIONS: Record<PricingTier, TierLimits> = {
  free: {
    tier: 'free',
    priceMonthly: 0,
    features: ['basic_vision', 'basic_voice', 'csv_export'],
    limits: [
      { resource: 'vision_api_calls', period: 'day', limit: 50, overagePolicy: 'block', warningThreshold: 0.8 },
      { resource: 'vision_api_calls', period: 'month', limit: 500, overagePolicy: 'block', warningThreshold: 0.8 },
      { resource: 'agent_requests', period: 'day', limit: 20, overagePolicy: 'block', warningThreshold: 0.8 },
      { resource: 'tts_minutes', period: 'month', limit: 30, overagePolicy: 'block', warningThreshold: 0.8 },
      { resource: 'storage_images', period: 'total', limit: 500, overagePolicy: 'block', warningThreshold: 0.9 },
      { resource: 'storage_memory', period: 'total', limit: 1000, overagePolicy: 'block', warningThreshold: 0.9 },
      { resource: 'exports', period: 'day', limit: 3, overagePolicy: 'block', warningThreshold: 0.8 },
      { resource: 'concurrent_sessions', period: 'total', limit: 1, overagePolicy: 'block', warningThreshold: 1.0 },
      { resource: 'locations', period: 'total', limit: 1, overagePolicy: 'block', warningThreshold: 1.0 },
      { resource: 'api_requests', period: 'minute', limit: 10, overagePolicy: 'throttle', warningThreshold: 0.9, burstAllowance: 5 },
    ],
  },
  solo: {
    tier: 'solo',
    priceMonthly: 7900,
    priceAnnual: 79000,
    features: ['full_vision', 'full_voice', 'all_exports', 'dashboard', 'basic_agents'],
    limits: [
      { resource: 'vision_api_calls', period: 'day', limit: 500, overagePolicy: 'warn', warningThreshold: 0.8 },
      { resource: 'vision_api_calls', period: 'month', limit: 10000, overagePolicy: 'charge', warningThreshold: 0.8, overageCostCents: 1 },
      { resource: 'agent_requests', period: 'day', limit: 200, overagePolicy: 'warn', warningThreshold: 0.8 },
      { resource: 'agent_requests', period: 'month', limit: 5000, overagePolicy: 'charge', warningThreshold: 0.8, overageCostCents: 2 },
      { resource: 'tts_minutes', period: 'month', limit: 300, overagePolicy: 'charge', warningThreshold: 0.8, overageCostCents: 5 },
      { resource: 'storage_images', period: 'total', limit: 10000, overagePolicy: 'warn', warningThreshold: 0.9 },
      { resource: 'storage_memory', period: 'total', limit: 50000, overagePolicy: 'warn', warningThreshold: 0.9 },
      { resource: 'exports', period: 'day', limit: 50, overagePolicy: 'warn', warningThreshold: 0.8 },
      { resource: 'concurrent_sessions', period: 'total', limit: 3, overagePolicy: 'block', warningThreshold: 1.0 },
      { resource: 'locations', period: 'total', limit: 1, overagePolicy: 'block', warningThreshold: 1.0 },
      { resource: 'api_requests', period: 'minute', limit: 60, overagePolicy: 'throttle', warningThreshold: 0.9, burstAllowance: 20 },
    ],
  },
  multi: {
    tier: 'multi',
    priceMonthly: 19900,
    priceAnnual: 199000,
    features: ['full_vision', 'full_voice', 'all_exports', 'dashboard', 'all_agents', 'pos_integration', 'shrinkage_analytics', 'priority_support'],
    limits: [
      { resource: 'vision_api_calls', period: 'day', limit: 2000, overagePolicy: 'warn', warningThreshold: 0.8 },
      { resource: 'vision_api_calls', period: 'month', limit: 50000, overagePolicy: 'charge', warningThreshold: 0.8, overageCostCents: 1 },
      { resource: 'agent_requests', period: 'day', limit: 1000, overagePolicy: 'warn', warningThreshold: 0.8 },
      { resource: 'agent_requests', period: 'month', limit: 25000, overagePolicy: 'charge', warningThreshold: 0.8, overageCostCents: 1 },
      { resource: 'tts_minutes', period: 'month', limit: 1000, overagePolicy: 'charge', warningThreshold: 0.8, overageCostCents: 3 },
      { resource: 'storage_images', period: 'total', limit: 100000, overagePolicy: 'warn', warningThreshold: 0.9 },
      { resource: 'storage_memory', period: 'total', limit: 500000, overagePolicy: 'warn', warningThreshold: 0.9 },
      { resource: 'exports', period: 'day', limit: 200, overagePolicy: 'warn', warningThreshold: 0.8 },
      { resource: 'concurrent_sessions', period: 'total', limit: 10, overagePolicy: 'block', warningThreshold: 1.0 },
      { resource: 'locations', period: 'total', limit: 5, overagePolicy: 'block', warningThreshold: 1.0 },
      { resource: 'api_requests', period: 'minute', limit: 120, overagePolicy: 'throttle', warningThreshold: 0.9, burstAllowance: 40 },
      { resource: 'webhook_events', period: 'day', limit: 1000, overagePolicy: 'warn', warningThreshold: 0.8 },
    ],
  },
  enterprise: {
    tier: 'enterprise',
    priceMonthly: 49900,
    priceAnnual: 499000,
    features: ['full_vision', 'full_voice', 'all_exports', 'dashboard', 'all_agents', 'pos_integration', 'shrinkage_analytics', 'priority_support', 'custom_integrations', 'api_access', 'sla', 'dedicated_support'],
    limits: [
      { resource: 'vision_api_calls', period: 'day', limit: 10000, overagePolicy: 'charge', warningThreshold: 0.9, overageCostCents: 1 },
      { resource: 'vision_api_calls', period: 'month', limit: 250000, overagePolicy: 'charge', warningThreshold: 0.9, overageCostCents: 1 },
      { resource: 'agent_requests', period: 'day', limit: 5000, overagePolicy: 'charge', warningThreshold: 0.9, overageCostCents: 1 },
      { resource: 'agent_requests', period: 'month', limit: 100000, overagePolicy: 'charge', warningThreshold: 0.9, overageCostCents: 1 },
      { resource: 'tts_minutes', period: 'month', limit: 5000, overagePolicy: 'charge', warningThreshold: 0.9, overageCostCents: 2 },
      { resource: 'storage_images', period: 'total', limit: 1000000, overagePolicy: 'warn', warningThreshold: 0.95 },
      { resource: 'storage_memory', period: 'total', limit: 5000000, overagePolicy: 'warn', warningThreshold: 0.95 },
      { resource: 'exports', period: 'day', limit: 1000, overagePolicy: 'warn', warningThreshold: 0.9 },
      { resource: 'concurrent_sessions', period: 'total', limit: 50, overagePolicy: 'warn', warningThreshold: 0.9 },
      { resource: 'locations', period: 'total', limit: 999999, overagePolicy: 'warn', warningThreshold: 0.99 },
      { resource: 'api_requests', period: 'minute', limit: 600, overagePolicy: 'throttle', warningThreshold: 0.9, burstAllowance: 100 },
      { resource: 'webhook_events', period: 'day', limit: 10000, overagePolicy: 'warn', warningThreshold: 0.9 },
    ],
  },
  pay_per_count: {
    tier: 'pay_per_count',
    priceMonthly: 0,
    features: ['basic_vision', 'basic_voice', 'csv_export'],
    limits: [
      { resource: 'vision_api_calls', period: 'day', limit: 1000, overagePolicy: 'charge', warningThreshold: 0.9, overageCostCents: 2 },
      { resource: 'agent_requests', period: 'day', limit: 500, overagePolicy: 'charge', warningThreshold: 0.9, overageCostCents: 3 },
      { resource: 'tts_minutes', period: 'month', limit: 120, overagePolicy: 'charge', warningThreshold: 0.8, overageCostCents: 5 },
      { resource: 'storage_images', period: 'total', limit: 5000, overagePolicy: 'block', warningThreshold: 0.9 },
      { resource: 'storage_memory', period: 'total', limit: 10000, overagePolicy: 'block', warningThreshold: 0.9 },
      { resource: 'exports', period: 'day', limit: 20, overagePolicy: 'block', warningThreshold: 0.8 },
      { resource: 'concurrent_sessions', period: 'total', limit: 1, overagePolicy: 'block', warningThreshold: 1.0 },
      { resource: 'locations', period: 'total', limit: 1, overagePolicy: 'block', warningThreshold: 1.0 },
      { resource: 'api_requests', period: 'minute', limit: 30, overagePolicy: 'throttle', warningThreshold: 0.9, burstAllowance: 10 },
    ],
  },
};

// ─── Quota Engine ───────────────────────────────────────────────

export class QuotaEngine extends EventEmitter {
  private config: QuotaEngineConfig;
  private users: Map<string, QuotaState> = new Map();
  private overageAccumulator: Map<string, number> = new Map(); // userId → total overage cents

  constructor(config: Partial<QuotaEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_QUOTA_CONFIG, ...config };
  }

  // ─── User Management ──────────────────────────────────────

  /** Register a new user with a tier */
  registerUser(userId: string, tier?: PricingTier): void {
    const userTier = tier || this.config.defaultTier;
    const tierDef = TIER_DEFINITIONS[userTier];

    const resources = new Map<string, ResourceUsage>();
    for (const limit of tierDef.limits) {
      const key = `${limit.resource}:${limit.period}`;
      resources.set(key, {
        resource: limit.resource,
        period: limit.period,
        current: 0,
        limit: limit.limit,
        periodStart: new Date().toISOString(),
        warningTriggered: false,
        limitExceeded: false,
        tokensAvailable: limit.burstAllowance ? limit.limit + limit.burstAllowance : undefined,
        lastRefillAt: limit.burstAllowance ? new Date().toISOString() : undefined,
      });
    }

    this.users.set(userId, {
      userId,
      tier: userTier,
      resources,
      tierChangedAt: new Date().toISOString(),
    });
  }

  /** Change a user's tier */
  changeTier(userId: string, newTier: PricingTier): void {
    const state = this.users.get(userId);
    if (!state) {
      this.registerUser(userId, newTier);
      return;
    }

    const oldTier = state.tier;
    if (oldTier === newTier) return;

    const isDowngrade = this.getTierRank(newTier) < this.getTierRank(oldTier);

    // Set grace period on downgrade
    if (isDowngrade && this.config.gracePeriodEnabled) {
      const grace = new Date();
      grace.setHours(grace.getHours() + this.config.gracePeriodHours);
      state.gracePeriodUntil = grace.toISOString();
    }

    // Rebuild resources for new tier
    const newTierDef = TIER_DEFINITIONS[newTier];
    const newResources = new Map<string, ResourceUsage>();

    for (const limit of newTierDef.limits) {
      const key = `${limit.resource}:${limit.period}`;
      const existing = state.resources.get(key);

      newResources.set(key, {
        resource: limit.resource,
        period: limit.period,
        current: existing?.current ?? 0,
        limit: limit.limit,
        periodStart: existing?.periodStart ?? new Date().toISOString(),
        warningTriggered: false,
        limitExceeded: false,
        tokensAvailable: limit.burstAllowance ? limit.limit + limit.burstAllowance : undefined,
        lastRefillAt: limit.burstAllowance ? new Date().toISOString() : undefined,
      });
    }

    state.tier = newTier;
    state.resources = newResources;
    state.tierChangedAt = new Date().toISOString();

    this.emit('tier:changed', userId, oldTier, newTier);
  }

  /** Get user's current tier */
  getUserTier(userId: string): PricingTier | null {
    return this.users.get(userId)?.tier ?? null;
  }

  /** Check if a user is registered */
  hasUser(userId: string): boolean {
    return this.users.has(userId);
  }

  // ─── Quota Checking ───────────────────────────────────────

  /** Check if a resource usage is allowed (does NOT consume) */
  checkQuota(userId: string, resource: ResourceType, amount = 1): QuotaCheckResult {
    const state = this.users.get(userId);
    if (!state) {
      return { allowed: false, reason: 'User not registered' };
    }

    // Find the most restrictive applicable limit
    const limits = this.getEffectiveLimits(state);
    const applicableLimits = limits.filter(l => l.resource === resource);

    if (applicableLimits.length === 0) {
      // No limit defined for this resource — allow
      return { allowed: true, remaining: Infinity };
    }

    for (const limit of applicableLimits) {
      const key = `${limit.resource}:${limit.period}`;
      const usage = state.resources.get(key);
      if (!usage) continue;

      // Check if period has expired and needs reset
      this.maybeResetPeriod(userId, usage, limit);

      const newUsage = usage.current + amount;
      const effectiveLimit = limit.burstAllowance
        ? limit.limit + limit.burstAllowance
        : limit.limit;

      if (newUsage > effectiveLimit) {
        switch (limit.overagePolicy) {
          case 'block':
            return {
              allowed: false,
              reason: `${resource} limit exceeded (${usage.current}/${limit.limit} per ${limit.period})`,
              currentUsage: usage.current,
              limit: limit.limit,
              percentUsed: usage.current / limit.limit,
              remaining: Math.max(0, limit.limit - usage.current),
              resetsAt: this.getResetTime(usage),
            };
          case 'throttle':
            return {
              allowed: false,
              reason: `${resource} rate limit exceeded. Try again later.`,
              currentUsage: usage.current,
              limit: limit.limit,
              percentUsed: usage.current / limit.limit,
              remaining: 0,
              resetsAt: this.getResetTime(usage),
            };
          case 'warn':
            // Allow but flag
            break;
          case 'charge':
            // Allow and note overage cost
            break;
        }
      }
    }

    // Find most used resource for response
    let highestPercent = 0;
    let worstUsage: ResourceUsage | undefined;
    let worstLimit: ResourceLimit | undefined;

    for (const limit of applicableLimits) {
      const key = `${limit.resource}:${limit.period}`;
      const usage = state.resources.get(key);
      if (!usage) continue;
      const pct = (usage.current + amount) / limit.limit;
      if (pct > highestPercent) {
        highestPercent = pct;
        worstUsage = usage;
        worstLimit = limit;
      }
    }

    const percentUsed = worstUsage && worstLimit
      ? (worstUsage.current + amount) / worstLimit.limit
      : 0;

    const isWarning = worstLimit
      ? percentUsed >= worstLimit.warningThreshold && percentUsed < 1
      : false;

    const overageCost = worstLimit && percentUsed > 1 && worstLimit.overageCostCents
      ? Math.ceil((worstUsage!.current + amount - worstLimit.limit) * worstLimit.overageCostCents)
      : undefined;

    return {
      allowed: true,
      currentUsage: worstUsage ? worstUsage.current + amount : amount,
      limit: worstLimit?.limit,
      percentUsed,
      isWarning,
      remaining: worstLimit && worstUsage
        ? Math.max(0, worstLimit.limit - worstUsage.current - amount)
        : undefined,
      resetsAt: worstUsage ? this.getResetTime(worstUsage) : undefined,
      overageCostCents: overageCost,
    };
  }

  /** Consume a resource (check + record) */
  consume(userId: string, resource: ResourceType, amount = 1): QuotaCheckResult {
    const check = this.checkQuota(userId, resource, amount);

    if (!check.allowed) return check;

    const state = this.users.get(userId)!;
    const limits = this.getEffectiveLimits(state);
    const applicableLimits = limits.filter(l => l.resource === resource);

    for (const limit of applicableLimits) {
      const key = `${limit.resource}:${limit.period}`;
      const usage = state.resources.get(key);
      if (!usage) continue;

      usage.current += amount;

      // Check for warning threshold
      const percentUsed = usage.current / limit.limit;
      if (percentUsed >= limit.warningThreshold && !usage.warningTriggered) {
        usage.warningTriggered = true;
        this.emit('quota:warning', userId, resource, percentUsed);
        check.isWarning = true;
      }

      // Check for limit exceeded
      if (usage.current > limit.limit && !usage.limitExceeded) {
        usage.limitExceeded = true;
        this.emit('quota:exceeded', userId, resource, limit.overagePolicy);

        // Track overage cost
        if (limit.overagePolicy === 'charge' && limit.overageCostCents) {
          const overageAmount = usage.current - limit.limit;
          const cost = overageAmount * limit.overageCostCents;
          const accKey = `${userId}:${resource}`;
          const prev = this.overageAccumulator.get(accKey) || 0;
          this.overageAccumulator.set(accKey, prev + cost);
          this.emit('overage:charged', userId, resource, cost);
        }
      }

      // Update token bucket
      if (usage.tokensAvailable !== undefined) {
        usage.tokensAvailable = Math.max(0, usage.tokensAvailable - amount);
      }
    }

    this.emit('usage:recorded', userId, resource, amount);
    return check;
  }

  /** Release a resource (for concurrent limits like sessions) */
  release(userId: string, resource: ResourceType, amount = 1): void {
    const state = this.users.get(userId);
    if (!state) return;

    const limits = this.getEffectiveLimits(state);
    const applicableLimits = limits.filter(l => l.resource === resource);

    for (const limit of applicableLimits) {
      const key = `${limit.resource}:${limit.period}`;
      const usage = state.resources.get(key);
      if (!usage) continue;

      usage.current = Math.max(0, usage.current - amount);
      if (usage.current <= limit.limit) {
        usage.limitExceeded = false;
      }
    }
  }

  // ─── Usage Analytics ──────────────────────────────────────

  /** Get usage summary for a user */
  getUsageSummary(userId: string): UsageSummary | null {
    const state = this.users.get(userId);
    if (!state) return null;

    const limits = this.getEffectiveLimits(state);
    const resources: UsageSummary['resources'] = [];

    for (const limit of limits) {
      const key = `${limit.resource}:${limit.period}`;
      const usage = state.resources.get(key);
      if (!usage) continue;

      const percentUsed = usage.limit > 0 ? usage.current / usage.limit : 0;
      resources.push({
        resource: limit.resource,
        period: limit.period,
        used: usage.current,
        limit: usage.limit,
        percentUsed,
        isWarning: percentUsed >= limit.warningThreshold,
        isExceeded: usage.current > usage.limit,
      });
    }

    // Calculate total overage
    let totalOverage = 0;
    for (const [key, cost] of this.overageAccumulator) {
      if (key.startsWith(userId + ':')) {
        totalOverage += cost;
      }
    }

    // Estimate monthly usage based on current daily usage
    const estimatedMonthly: Record<string, number> = {};
    if (this.config.estimateMonthlyUsage) {
      for (const r of resources) {
        if (r.period === 'day' && r.used > 0) {
          const dayStart = new Date(state.resources.get(`${r.resource}:day`)?.periodStart || '');
          const hoursElapsed = Math.max(1, (Date.now() - dayStart.getTime()) / (1000 * 60 * 60));
          const dailyRate = r.used / (hoursElapsed / 24);
          estimatedMonthly[r.resource] = Math.round(dailyRate * 30);
        }
      }
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    return {
      userId,
      tier: state.tier,
      period: {
        start: monthStart.toISOString(),
        end: monthEnd.toISOString(),
      },
      resources,
      totalOverageCostCents: totalOverage,
      estimatedMonthlyUsage: estimatedMonthly as Record<ResourceType, number>,
    };
  }

  /** Get usage for a specific resource */
  getResourceUsage(userId: string, resource: ResourceType, period?: LimitPeriod): ResourceUsage | null {
    const state = this.users.get(userId);
    if (!state) return null;

    // Find matching usage entry
    for (const [key, usage] of state.resources) {
      if (usage.resource === resource && (!period || usage.period === period)) {
        return { ...usage };
      }
    }
    return null;
  }

  /** Get total overage cost for a user */
  getTotalOverageCost(userId: string): number {
    let total = 0;
    for (const [key, cost] of this.overageAccumulator) {
      if (key.startsWith(userId + ':')) {
        total += cost;
      }
    }
    return total;
  }

  /** Get tier definition */
  getTierDefinition(tier: PricingTier): TierLimits {
    return TIER_DEFINITIONS[tier];
  }

  /** Get all tier definitions */
  getAllTiers(): TierLimits[] {
    return Object.values(TIER_DEFINITIONS);
  }

  /** Check if a feature is available for a tier */
  hasFeature(userId: string, feature: string): boolean {
    const state = this.users.get(userId);
    if (!state) return false;
    const tierDef = TIER_DEFINITIONS[state.tier];
    return tierDef.features.includes(feature);
  }

  /** Reset a specific resource counter for a user */
  resetResource(userId: string, resource: ResourceType, period?: LimitPeriod): void {
    const state = this.users.get(userId);
    if (!state) return;

    for (const [key, usage] of state.resources) {
      if (usage.resource === resource && (!period || usage.period === period)) {
        usage.current = 0;
        usage.warningTriggered = false;
        usage.limitExceeded = false;
        usage.periodStart = new Date().toISOString();
        this.emit('quota:reset', userId, resource);
      }
    }
  }

  /** Reset all resources for a user */
  resetAll(userId: string): void {
    const state = this.users.get(userId);
    if (!state) return;

    for (const [_key, usage] of state.resources) {
      usage.current = 0;
      usage.warningTriggered = false;
      usage.limitExceeded = false;
      usage.periodStart = new Date().toISOString();
    }

    // Clear overage
    for (const key of [...this.overageAccumulator.keys()]) {
      if (key.startsWith(userId + ':')) {
        this.overageAccumulator.delete(key);
      }
    }
  }

  /** Get registered user count */
  getUserCount(): number {
    return this.users.size;
  }

  // ─── Private Helpers ──────────────────────────────────────

  private getEffectiveLimits(state: QuotaState): ResourceLimit[] {
    const tierDef = TIER_DEFINITIONS[state.tier];

    // During grace period, use the higher of old and new limits
    if (state.gracePeriodUntil) {
      const graceExpiry = new Date(state.gracePeriodUntil).getTime();
      if (Date.now() < graceExpiry) {
        // Grace period still active — just use current tier limits
        // (In a full impl, we'd compare with previous tier)
        return tierDef.limits;
      }
      // Grace period expired — clean it up
      state.gracePeriodUntil = undefined;
    }

    return tierDef.limits;
  }

  private maybeResetPeriod(userId: string, usage: ResourceUsage, limit: ResourceLimit): void {
    if (limit.period === 'total') return; // total limits don't reset

    const periodStart = new Date(usage.periodStart).getTime();
    const now = Date.now();
    let periodMs: number;

    switch (limit.period) {
      case 'minute':
        periodMs = 60 * 1000;
        break;
      case 'hour':
        periodMs = 60 * 60 * 1000;
        break;
      case 'day':
        periodMs = 24 * 60 * 60 * 1000;
        break;
      case 'month':
        periodMs = 30 * 24 * 60 * 60 * 1000;
        break;
      default:
        return;
    }

    if (now - periodStart >= periodMs) {
      usage.current = 0;
      usage.periodStart = new Date().toISOString();
      usage.warningTriggered = false;
      usage.limitExceeded = false;
      this.emit('quota:reset', userId, usage.resource);

      // Refill tokens
      if (usage.tokensAvailable !== undefined && limit.burstAllowance) {
        usage.tokensAvailable = limit.limit + limit.burstAllowance;
        usage.lastRefillAt = new Date().toISOString();
      }
    }
  }

  private getResetTime(usage: ResourceUsage): string {
    const periodStart = new Date(usage.periodStart);
    switch (usage.period) {
      case 'minute':
        periodStart.setMinutes(periodStart.getMinutes() + 1);
        break;
      case 'hour':
        periodStart.setHours(periodStart.getHours() + 1);
        break;
      case 'day':
        periodStart.setDate(periodStart.getDate() + 1);
        break;
      case 'month':
        periodStart.setMonth(periodStart.getMonth() + 1);
        break;
      case 'total':
        return 'never';
    }
    return periodStart.toISOString();
  }

  private getTierRank(tier: PricingTier): number {
    const ranks: Record<PricingTier, number> = {
      free: 0,
      pay_per_count: 1,
      solo: 2,
      multi: 3,
      enterprise: 4,
    };
    return ranks[tier] ?? 0;
  }
}
