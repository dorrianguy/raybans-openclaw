/**
 * Feature Flag Engine — Controlled rollouts, A/B testing, experiment-driven development
 *
 * Essential for:
 * - Gradually rolling out new agents to users (canary deploys)
 * - A/B testing pricing, UI, and agent behavior
 * - Per-plan feature gating (free vs paid)
 * - Kill switches for misbehaving features
 * - Regional feature availability (US only, EU only)
 * - Time-based launches (holiday promotions)
 *
 * Revenue angle: Enables data-driven pricing optimization and prevents
 * catastrophic rollouts. Enterprise customers ($499/mo) need feature flags
 * for compliance (roll back instantly without redeploying).
 *
 * @module feature-flag-engine
 */

import { EventEmitter } from 'events';

// ─── Types ─────────────────────────────────────────────────────────────

export type FlagStatus = 'active' | 'inactive' | 'archived';

export type RolloutStrategy =
  | 'all'               // Everyone gets it
  | 'none'              // Nobody gets it (kill switch)
  | 'percentage'        // Random % of users
  | 'user_list'         // Specific user IDs
  | 'plan'              // Based on subscription plan
  | 'region'            // Based on geographic region
  | 'schedule'          // Time-based activation
  | 'gradual'           // Percentage increases over time
  | 'ring';             // Ring-based deployment (internal → beta → GA)

export type FlagValueType = 'boolean' | 'string' | 'number' | 'json';

export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  status: FlagStatus;
  valueType: FlagValueType;
  defaultValue: FlagValue;
  rules: FlagRule[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  // Metadata
  category?: string;      // 'agent', 'ui', 'billing', 'experiment', etc.
  jiraTicket?: string;     // Tracking reference
  expiresAt?: number;      // Auto-archive after this date
  permanent?: boolean;     // Never expires (subscription features, etc.)
}

export type FlagValue = boolean | string | number | Record<string, unknown>;

export interface FlagRule {
  id: string;
  priority: number;        // Lower = higher priority (evaluated first)
  strategy: RolloutStrategy;
  value: FlagValue;        // Value when this rule matches
  // Strategy-specific config
  percentage?: number;     // For 'percentage' and 'gradual'
  userIds?: string[];      // For 'user_list'
  plans?: string[];        // For 'plan' (e.g., ['pro', 'enterprise'])
  regions?: string[];      // For 'region' (ISO country codes)
  schedule?: {
    startTime: number;     // Unix timestamp
    endTime?: number;
  };
  gradual?: {
    startPercentage: number;
    endPercentage: number;
    startTime: number;
    endTime: number;
  };
  ring?: RingLevel;
  // Condition
  condition?: FlagCondition;
  enabled: boolean;
}

export type RingLevel = 'internal' | 'alpha' | 'beta' | 'ga';

export interface FlagCondition {
  field: string;           // User property to check
  operator: ConditionOperator;
  value: string | number | boolean | string[];
}

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'in'
  | 'not_in'
  | 'exists'
  | 'regex';

export interface EvaluationContext {
  userId: string;
  plan?: string;           // Subscription plan
  region?: string;         // ISO country code
  ring?: RingLevel;        // User's ring level
  properties?: Record<string, string | number | boolean>;
  // Internal
  _hash?: number;          // Cached hash for consistent bucketing
}

export interface FlagEvaluation {
  flagId: string;
  value: FlagValue;
  ruleId?: string;         // Which rule matched
  strategy?: RolloutStrategy;
  reason: EvaluationReason;
  timestamp: number;
}

export type EvaluationReason =
  | 'default'              // No rules matched, used default
  | 'rule_match'           // A specific rule matched
  | 'disabled'             // Flag is inactive
  | 'not_found'            // Flag doesn't exist
  | 'error';               // Evaluation error

export interface Experiment {
  id: string;
  name: string;
  description: string;
  flagId: string;          // Feature flag controlling the experiment
  status: 'draft' | 'running' | 'paused' | 'completed';
  variants: ExperimentVariant[];
  startedAt?: number;
  endedAt?: number;
  winningVariant?: string;
  sampleSize: number;      // Target sample size per variant
  metric: string;          // What we're measuring
}

export interface ExperimentVariant {
  id: string;
  name: string;
  value: FlagValue;
  weight: number;          // Traffic split (0-100)
  // Results
  impressions: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
}

export interface FeatureFlagEngineConfig {
  maxFlags: number;
  maxRulesPerFlag: number;
  maxExperiments: number;
  evaluationCacheTTL: number;  // ms
  defaultRing: RingLevel;
  enableAudit: boolean;
}

export interface FlagAuditEntry {
  timestamp: number;
  action: 'created' | 'updated' | 'toggled' | 'archived' | 'rule_added' | 'rule_removed' | 'evaluated';
  flagId: string;
  userId?: string;
  details: string;
}

export interface FeatureFlagEngineEvents {
  'flag:created': { flagId: string };
  'flag:updated': { flagId: string };
  'flag:toggled': { flagId: string; active: boolean };
  'flag:archived': { flagId: string };
  'flag:evaluated': { flagId: string; userId: string; value: FlagValue; reason: EvaluationReason };
  'experiment:started': { experimentId: string };
  'experiment:completed': { experimentId: string; winningVariant?: string };
  'experiment:impression': { experimentId: string; variantId: string };
}

// ─── Default Config ────────────────────────────────────────────────────

export const DEFAULT_FLAG_CONFIG: FeatureFlagEngineConfig = {
  maxFlags: 500,
  maxRulesPerFlag: 20,
  maxExperiments: 50,
  evaluationCacheTTL: 60000,  // 1 minute
  defaultRing: 'ga',
  enableAudit: true,
};

// ─── Ring Hierarchy ───────────────────────────────────────────────────

const RING_HIERARCHY: Record<RingLevel, number> = {
  internal: 0,
  alpha: 1,
  beta: 2,
  ga: 3,
};

// ─── Feature Flag Engine Implementation ───────────────────────────────

export class FeatureFlagEngine extends EventEmitter {
  private config: FeatureFlagEngineConfig;
  private flags: Map<string, FeatureFlag> = new Map();
  private experiments: Map<string, Experiment> = new Map();
  private evaluationCache: Map<string, { value: FlagValue; timestamp: number }> = new Map();
  private audit: FlagAuditEntry[] = [];
  private overrides: Map<string, Map<string, FlagValue>> = new Map(); // flagId → userId → value

  constructor(config: Partial<FeatureFlagEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_FLAG_CONFIG, ...config };
  }

  // ─── Flag CRUD ─────────────────────────────────────────────────────

  /**
   * Create a new feature flag
   */
  createFlag(params: {
    id: string;
    name: string;
    description?: string;
    valueType?: FlagValueType;
    defaultValue?: FlagValue;
    tags?: string[];
    category?: string;
    permanent?: boolean;
    createdBy?: string;
  }): FeatureFlag {
    if (this.flags.has(params.id)) {
      throw new Error(`Flag "${params.id}" already exists`);
    }
    if (this.flags.size >= this.config.maxFlags) {
      throw new Error(`Maximum flags (${this.config.maxFlags}) reached`);
    }

    const now = Date.now();
    const flag: FeatureFlag = {
      id: params.id,
      name: params.name,
      description: params.description ?? '',
      status: 'inactive',
      valueType: params.valueType ?? 'boolean',
      defaultValue: params.defaultValue ?? false,
      rules: [],
      tags: params.tags ?? [],
      category: params.category,
      permanent: params.permanent,
      createdBy: params.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    this.flags.set(flag.id, flag);
    this.logAudit('created', flag.id, undefined, `Flag "${flag.name}" created`);
    this.emit('flag:created', { flagId: flag.id });

    return flag;
  }

  /**
   * Get a flag by ID
   */
  getFlag(id: string): FeatureFlag | undefined {
    return this.flags.get(id);
  }

  /**
   * Get all flags, optionally filtered
   */
  getAllFlags(options: {
    status?: FlagStatus;
    tag?: string;
    category?: string;
  } = {}): FeatureFlag[] {
    let flags = Array.from(this.flags.values());

    if (options.status) {
      flags = flags.filter(f => f.status === options.status);
    }
    if (options.tag) {
      flags = flags.filter(f => f.tags.includes(options.tag!));
    }
    if (options.category) {
      flags = flags.filter(f => f.category === options.category);
    }

    return flags.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Update a flag's properties
   */
  updateFlag(id: string, updates: Partial<Pick<FeatureFlag, 'name' | 'description' | 'defaultValue' | 'tags' | 'category' | 'expiresAt' | 'permanent'>>): FeatureFlag | null {
    const flag = this.flags.get(id);
    if (!flag) return null;

    Object.assign(flag, updates, { updatedAt: Date.now() });
    this.clearCacheForFlag(id);
    this.logAudit('updated', id, undefined, `Flag "${flag.name}" updated`);
    this.emit('flag:updated', { flagId: id });

    return flag;
  }

  /**
   * Toggle a flag's active status
   */
  toggleFlag(id: string, active?: boolean): FeatureFlag | null {
    const flag = this.flags.get(id);
    if (!flag) return null;

    const newStatus: FlagStatus = active !== undefined
      ? (active ? 'active' : 'inactive')
      : (flag.status === 'active' ? 'inactive' : 'active');

    flag.status = newStatus;
    flag.updatedAt = Date.now();
    this.clearCacheForFlag(id);

    this.logAudit('toggled', id, undefined, `Flag "${flag.name}" set to ${newStatus}`);
    this.emit('flag:toggled', { flagId: id, active: newStatus === 'active' });

    return flag;
  }

  /**
   * Archive a flag (soft delete)
   */
  archiveFlag(id: string): boolean {
    const flag = this.flags.get(id);
    if (!flag) return false;

    flag.status = 'archived';
    flag.updatedAt = Date.now();
    this.clearCacheForFlag(id);

    this.logAudit('archived', id, undefined, `Flag "${flag.name}" archived`);
    this.emit('flag:archived', { flagId: id });

    return true;
  }

  /**
   * Delete a flag permanently
   */
  deleteFlag(id: string): boolean {
    return this.flags.delete(id);
  }

  // ─── Rules Management ──────────────────────────────────────────────

  /**
   * Add a rule to a flag
   */
  addRule(flagId: string, rule: Omit<FlagRule, 'id'>): FlagRule | null {
    const flag = this.flags.get(flagId);
    if (!flag) return null;
    if (flag.rules.length >= this.config.maxRulesPerFlag) {
      throw new Error(`Maximum rules per flag (${this.config.maxRulesPerFlag}) reached`);
    }

    const fullRule: FlagRule = {
      ...rule,
      id: `rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    };

    flag.rules.push(fullRule);
    flag.rules.sort((a, b) => a.priority - b.priority);
    flag.updatedAt = Date.now();
    this.clearCacheForFlag(flagId);

    this.logAudit('rule_added', flagId, undefined, `Rule "${fullRule.id}" added with strategy "${rule.strategy}"`);

    return fullRule;
  }

  /**
   * Remove a rule from a flag
   */
  removeRule(flagId: string, ruleId: string): boolean {
    const flag = this.flags.get(flagId);
    if (!flag) return false;

    const index = flag.rules.findIndex(r => r.id === ruleId);
    if (index === -1) return false;

    flag.rules.splice(index, 1);
    flag.updatedAt = Date.now();
    this.clearCacheForFlag(flagId);

    this.logAudit('rule_removed', flagId, undefined, `Rule "${ruleId}" removed`);

    return true;
  }

  /**
   * Update a rule
   */
  updateRule(flagId: string, ruleId: string, updates: Partial<FlagRule>): FlagRule | null {
    const flag = this.flags.get(flagId);
    if (!flag) return null;

    const rule = flag.rules.find(r => r.id === ruleId);
    if (!rule) return null;

    Object.assign(rule, updates);
    flag.rules.sort((a, b) => a.priority - b.priority);
    flag.updatedAt = Date.now();
    this.clearCacheForFlag(flagId);

    return rule;
  }

  // ─── User Overrides ────────────────────────────────────────────────

  /**
   * Set a user-specific override for a flag (for testing/VIP users)
   */
  setOverride(flagId: string, userId: string, value: FlagValue): void {
    if (!this.overrides.has(flagId)) {
      this.overrides.set(flagId, new Map());
    }
    this.overrides.get(flagId)!.set(userId, value);
  }

  /**
   * Remove a user override
   */
  removeOverride(flagId: string, userId: string): boolean {
    const flagOverrides = this.overrides.get(flagId);
    if (!flagOverrides) return false;
    return flagOverrides.delete(userId);
  }

  /**
   * Get all overrides for a flag
   */
  getOverrides(flagId: string): Map<string, FlagValue> {
    return this.overrides.get(flagId) ?? new Map();
  }

  // ─── Evaluation ────────────────────────────────────────────────────

  /**
   * Evaluate a feature flag for a given context
   */
  evaluate(flagId: string, context: EvaluationContext): FlagEvaluation {
    const timestamp = Date.now();
    const flag = this.flags.get(flagId);

    if (!flag) {
      return { flagId, value: false, reason: 'not_found', timestamp };
    }

    if (flag.status !== 'active') {
      return { flagId, value: flag.defaultValue, reason: 'disabled', timestamp };
    }

    // Check user override first
    const override = this.overrides.get(flagId)?.get(context.userId);
    if (override !== undefined) {
      const eval_: FlagEvaluation = {
        flagId, value: override, reason: 'rule_match', timestamp,
        ruleId: 'override', strategy: 'user_list',
      };
      this.emitEvaluation(eval_, context);
      return eval_;
    }

    // Check cache
    const cacheKey = `${flagId}:${context.userId}`;
    const cached = this.evaluationCache.get(cacheKey);
    if (cached && (timestamp - cached.timestamp) < this.config.evaluationCacheTTL) {
      return { flagId, value: cached.value, reason: 'rule_match', timestamp };
    }

    // Evaluate rules in priority order
    for (const rule of flag.rules) {
      if (!rule.enabled) continue;

      const matches = this.evaluateRule(rule, context, timestamp);
      if (matches) {
        const eval_: FlagEvaluation = {
          flagId,
          value: rule.value,
          ruleId: rule.id,
          strategy: rule.strategy,
          reason: 'rule_match',
          timestamp,
        };

        // Cache the result
        this.evaluationCache.set(cacheKey, { value: rule.value, timestamp });
        this.emitEvaluation(eval_, context);

        return eval_;
      }
    }

    // No rules matched — use default
    const defaultEval: FlagEvaluation = {
      flagId, value: flag.defaultValue, reason: 'default', timestamp,
    };
    this.evaluationCache.set(cacheKey, { value: flag.defaultValue, timestamp });
    this.emitEvaluation(defaultEval, context);

    return defaultEval;
  }

  /**
   * Evaluate a flag as a boolean (convenience)
   */
  isEnabled(flagId: string, context: EvaluationContext): boolean {
    const result = this.evaluate(flagId, context);
    return Boolean(result.value);
  }

  /**
   * Evaluate a flag and return its string value
   */
  getString(flagId: string, context: EvaluationContext, fallback: string = ''): string {
    const result = this.evaluate(flagId, context);
    return typeof result.value === 'string' ? result.value : fallback;
  }

  /**
   * Evaluate a flag and return its number value
   */
  getNumber(flagId: string, context: EvaluationContext, fallback: number = 0): number {
    const result = this.evaluate(flagId, context);
    return typeof result.value === 'number' ? result.value : fallback;
  }

  /**
   * Evaluate multiple flags at once
   */
  evaluateAll(context: EvaluationContext): Map<string, FlagValue> {
    const results = new Map<string, FlagValue>();
    for (const flag of this.flags.values()) {
      if (flag.status === 'active') {
        const eval_ = this.evaluate(flag.id, context);
        results.set(flag.id, eval_.value);
      }
    }
    return results;
  }

  private evaluateRule(rule: FlagRule, context: EvaluationContext, now: number): boolean {
    // Check condition first (if present)
    if (rule.condition && !this.evaluateCondition(rule.condition, context)) {
      return false;
    }

    switch (rule.strategy) {
      case 'all':
        return true;

      case 'none':
        return false;

      case 'percentage':
        if (rule.percentage === undefined) return false;
        return this.getUserBucket(context.userId, rule.id) < rule.percentage;

      case 'user_list':
        if (!rule.userIds) return false;
        return rule.userIds.includes(context.userId);

      case 'plan':
        if (!rule.plans || !context.plan) return false;
        return rule.plans.includes(context.plan);

      case 'region':
        if (!rule.regions || !context.region) return false;
        return rule.regions.includes(context.region);

      case 'schedule':
        if (!rule.schedule) return false;
        if (now < rule.schedule.startTime) return false;
        if (rule.schedule.endTime && now > rule.schedule.endTime) return false;
        return true;

      case 'gradual':
        if (!rule.gradual) return false;
        return this.evaluateGradual(rule.gradual, context, now);

      case 'ring':
        if (!rule.ring) return false;
        const userRing = context.ring ?? this.config.defaultRing;
        return RING_HIERARCHY[userRing] <= RING_HIERARCHY[rule.ring];

      default:
        return false;
    }
  }

  private evaluateCondition(condition: FlagCondition, context: EvaluationContext): boolean {
    const actualValue = context.properties?.[condition.field];
    if (actualValue === undefined && condition.operator !== 'exists') return false;

    switch (condition.operator) {
      case 'equals':
        return actualValue === condition.value;
      case 'not_equals':
        return actualValue !== condition.value;
      case 'contains':
        return typeof actualValue === 'string' && typeof condition.value === 'string' &&
               actualValue.includes(condition.value);
      case 'not_contains':
        return typeof actualValue === 'string' && typeof condition.value === 'string' &&
               !actualValue.includes(condition.value);
      case 'greater_than':
        return typeof actualValue === 'number' && typeof condition.value === 'number' &&
               actualValue > condition.value;
      case 'less_than':
        return typeof actualValue === 'number' && typeof condition.value === 'number' &&
               actualValue < condition.value;
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(String(actualValue));
      case 'not_in':
        return Array.isArray(condition.value) && !condition.value.includes(String(actualValue));
      case 'exists':
        return actualValue !== undefined;
      case 'regex':
        if (typeof actualValue !== 'string' || typeof condition.value !== 'string') return false;
        try {
          return new RegExp(condition.value).test(actualValue);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  private evaluateGradual(
    gradual: NonNullable<FlagRule['gradual']>,
    context: EvaluationContext,
    now: number
  ): boolean {
    if (now < gradual.startTime) return false;
    if (now >= gradual.endTime) {
      return this.getUserBucket(context.userId, 'gradual') < gradual.endPercentage;
    }

    const elapsed = now - gradual.startTime;
    const total = gradual.endTime - gradual.startTime;
    const progress = elapsed / total;
    const currentPercentage = gradual.startPercentage +
      (gradual.endPercentage - gradual.startPercentage) * progress;

    return this.getUserBucket(context.userId, 'gradual') < currentPercentage;
  }

  /**
   * Consistent hash bucketing — same user always gets same bucket (0-100)
   */
  private getUserBucket(userId: string, salt: string): number {
    const input = `${userId}:${salt}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % 100;
  }

  private emitEvaluation(eval_: FlagEvaluation, context: EvaluationContext): void {
    this.emit('flag:evaluated', {
      flagId: eval_.flagId,
      userId: context.userId,
      value: eval_.value,
      reason: eval_.reason,
    });
  }

  // ─── Experiments / A/B Testing ─────────────────────────────────────

  /**
   * Create an experiment
   */
  createExperiment(params: {
    id: string;
    name: string;
    description?: string;
    flagId: string;
    variants: Omit<ExperimentVariant, 'impressions' | 'conversions' | 'conversionRate' | 'revenue'>[];
    sampleSize?: number;
    metric?: string;
  }): Experiment {
    if (this.experiments.size >= this.config.maxExperiments) {
      throw new Error(`Maximum experiments (${this.config.maxExperiments}) reached`);
    }

    // Validate weights sum to 100
    const totalWeight = params.variants.reduce((sum, v) => sum + v.weight, 0);
    if (totalWeight !== 100) {
      throw new Error(`Variant weights must sum to 100 (got ${totalWeight})`);
    }

    const experiment: Experiment = {
      id: params.id,
      name: params.name,
      description: params.description ?? '',
      flagId: params.flagId,
      status: 'draft',
      variants: params.variants.map(v => ({
        ...v,
        impressions: 0,
        conversions: 0,
        conversionRate: 0,
        revenue: 0,
      })),
      sampleSize: params.sampleSize ?? 1000,
      metric: params.metric ?? 'conversion',
    };

    this.experiments.set(experiment.id, experiment);
    return experiment;
  }

  /**
   * Start an experiment
   */
  startExperiment(id: string): Experiment | null {
    const experiment = this.experiments.get(id);
    if (!experiment || experiment.status !== 'draft') return null;

    experiment.status = 'running';
    experiment.startedAt = Date.now();

    // Ensure the flag is active
    const flag = this.flags.get(experiment.flagId);
    if (flag && flag.status !== 'active') {
      flag.status = 'active';
    }

    this.emit('experiment:started', { experimentId: id });
    return experiment;
  }

  /**
   * Get the variant assignment for a user in an experiment
   */
  getVariant(experimentId: string, userId: string): ExperimentVariant | null {
    const experiment = this.experiments.get(experimentId);
    if (!experiment || experiment.status !== 'running') return null;

    const bucket = this.getUserBucket(userId, experimentId);
    let cumulative = 0;

    for (const variant of experiment.variants) {
      cumulative += variant.weight;
      if (bucket < cumulative) {
        return variant;
      }
    }

    // Fallback to first variant
    return experiment.variants[0] ?? null;
  }

  /**
   * Record an impression for an experiment
   */
  recordImpression(experimentId: string, variantId: string): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return;

    const variant = experiment.variants.find(v => v.id === variantId);
    if (variant) {
      variant.impressions++;
      this.emit('experiment:impression', { experimentId, variantId });
    }
  }

  /**
   * Record a conversion for an experiment
   */
  recordConversion(experimentId: string, variantId: string, revenue: number = 0): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return;

    const variant = experiment.variants.find(v => v.id === variantId);
    if (variant) {
      variant.conversions++;
      variant.revenue += revenue;
      variant.conversionRate = variant.impressions > 0
        ? variant.conversions / variant.impressions
        : 0;
    }
  }

  /**
   * Complete an experiment and determine winner
   */
  completeExperiment(id: string): Experiment | null {
    const experiment = this.experiments.get(id);
    if (!experiment || experiment.status !== 'running') return null;

    experiment.status = 'completed';
    experiment.endedAt = Date.now();

    // Determine winner by conversion rate
    let bestVariant: ExperimentVariant | null = null;
    let bestRate = -1;

    for (const variant of experiment.variants) {
      if (variant.conversionRate > bestRate) {
        bestRate = variant.conversionRate;
        bestVariant = variant;
      }
    }

    experiment.winningVariant = bestVariant?.id;

    this.emit('experiment:completed', {
      experimentId: id,
      winningVariant: experiment.winningVariant,
    });

    return experiment;
  }

  /**
   * Get an experiment by ID
   */
  getExperiment(id: string): Experiment | undefined {
    return this.experiments.get(id);
  }

  /**
   * Get all experiments
   */
  getAllExperiments(): Experiment[] {
    return Array.from(this.experiments.values());
  }

  /**
   * Calculate statistical significance between two variants (simplified z-test)
   */
  calculateSignificance(experimentId: string, variantA: string, variantB: string): {
    significant: boolean;
    confidence: number;
    zScore: number;
    winner?: string;
  } {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return { significant: false, confidence: 0, zScore: 0 };

    const a = experiment.variants.find(v => v.id === variantA);
    const b = experiment.variants.find(v => v.id === variantB);
    if (!a || !b) return { significant: false, confidence: 0, zScore: 0 };

    if (a.impressions < 30 || b.impressions < 30) {
      return { significant: false, confidence: 0, zScore: 0 };
    }

    const pA = a.conversionRate;
    const pB = b.conversionRate;
    const nA = a.impressions;
    const nB = b.impressions;

    // Pooled proportion
    const p = (a.conversions + b.conversions) / (nA + nB);
    const se = Math.sqrt(p * (1 - p) * (1 / nA + 1 / nB));

    if (se === 0) return { significant: false, confidence: 0, zScore: 0 };

    const zScore = (pA - pB) / se;
    const absZ = Math.abs(zScore);

    // Approximate p-value from z-score
    let confidence = 0;
    if (absZ >= 2.576) confidence = 99;
    else if (absZ >= 1.96) confidence = 95;
    else if (absZ >= 1.645) confidence = 90;
    else if (absZ >= 1.282) confidence = 80;
    else confidence = Math.round(absZ / 2.576 * 80);

    return {
      significant: absZ >= 1.96, // 95% confidence threshold
      confidence,
      zScore: Math.round(zScore * 1000) / 1000,
      winner: zScore > 0 ? variantA : (zScore < 0 ? variantB : undefined),
    };
  }

  // ─── Prebuilt Flag Templates ───────────────────────────────────────

  /**
   * Create common feature flags for the Ray-Ban platform
   */
  createPlatformFlags(): FeatureFlag[] {
    const flags: FeatureFlag[] = [];

    const templates: Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      permanent?: boolean;
    }> = [
      { id: 'agent:inventory', name: 'Inventory Agent', description: 'Inventory counting via glasses', category: 'agent', permanent: true },
      { id: 'agent:security', name: 'Security Agent', description: 'Threat detection and QR scanning', category: 'agent', permanent: true },
      { id: 'agent:meeting', name: 'Meeting Intelligence', description: 'Meeting transcription and analysis', category: 'agent', permanent: true },
      { id: 'agent:translation', name: 'Translation Agent', description: 'Real-time translation with cultural context', category: 'agent', permanent: true },
      { id: 'agent:debug', name: 'Debug Agent', description: 'Code debugging via vision', category: 'agent', permanent: true },
      { id: 'feature:cloud_processing', name: 'Cloud Processing', description: 'Send images to cloud vision APIs', category: 'feature' },
      { id: 'feature:face_recognition', name: 'Face Recognition', description: 'Identify known contacts by face', category: 'feature' },
      { id: 'feature:store_layout', name: 'Store Layout Mapping', description: 'GPS-based store mapping', category: 'feature' },
      { id: 'billing:pay_per_count', name: 'Pay-Per-Count Plan', description: 'Usage-based billing for inventory counts', category: 'billing', permanent: true },
      { id: 'ui:dark_mode', name: 'Dark Mode Dashboard', description: 'Dark theme for the web dashboard', category: 'ui' },
      { id: 'experiment:pricing_v2', name: 'Pricing V2 Test', description: 'Test new pricing structure', category: 'experiment' },
    ];

    for (const t of templates) {
      if (!this.flags.has(t.id)) {
        flags.push(this.createFlag(t));
      }
    }

    return flags;
  }

  // ─── Audit Log ─────────────────────────────────────────────────────

  private logAudit(action: FlagAuditEntry['action'], flagId: string, userId?: string, details: string = ''): void {
    if (!this.config.enableAudit) return;

    this.audit.push({
      timestamp: Date.now(),
      action,
      flagId,
      userId,
      details,
    });

    // Keep last 10000
    if (this.audit.length > 10000) {
      this.audit = this.audit.slice(-7500);
    }
  }

  /**
   * Get audit log
   */
  getAuditLog(options: {
    flagId?: string;
    action?: FlagAuditEntry['action'];
    limit?: number;
  } = {}): FlagAuditEntry[] {
    let entries = [...this.audit];

    if (options.flagId) {
      entries = entries.filter(e => e.flagId === options.flagId);
    }
    if (options.action) {
      entries = entries.filter(e => e.action === options.action);
    }

    entries.sort((a, b) => b.timestamp - a.timestamp);

    if (options.limit) {
      entries = entries.slice(0, options.limit);
    }

    return entries;
  }

  // ─── Cache Management ──────────────────────────────────────────────

  private clearCacheForFlag(flagId: string): void {
    for (const key of this.evaluationCache.keys()) {
      if (key.startsWith(`${flagId}:`)) {
        this.evaluationCache.delete(key);
      }
    }
  }

  /**
   * Clear all evaluation cache
   */
  clearCache(): void {
    this.evaluationCache.clear();
  }

  // ─── Stats ─────────────────────────────────────────────────────────

  /**
   * Get engine statistics
   */
  getStats(): {
    totalFlags: number;
    activeFlags: number;
    inactiveFlags: number;
    archivedFlags: number;
    totalRules: number;
    totalExperiments: number;
    runningExperiments: number;
    totalOverrides: number;
    cacheSize: number;
    auditEntries: number;
  } {
    const flags = Array.from(this.flags.values());
    let totalOverrides = 0;
    for (const overrideMap of this.overrides.values()) {
      totalOverrides += overrideMap.size;
    }

    return {
      totalFlags: flags.length,
      activeFlags: flags.filter(f => f.status === 'active').length,
      inactiveFlags: flags.filter(f => f.status === 'inactive').length,
      archivedFlags: flags.filter(f => f.status === 'archived').length,
      totalRules: flags.reduce((sum, f) => sum + f.rules.length, 0),
      totalExperiments: this.experiments.size,
      runningExperiments: Array.from(this.experiments.values()).filter(e => e.status === 'running').length,
      totalOverrides,
      cacheSize: this.evaluationCache.size,
      auditEntries: this.audit.length,
    };
  }

  /**
   * Generate a voice-friendly flags summary
   */
  generateVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];

    parts.push(`${stats.activeFlags} feature flags active out of ${stats.totalFlags} total.`);

    if (stats.runningExperiments > 0) {
      parts.push(`${stats.runningExperiments} experiments currently running.`);
    }

    if (stats.totalOverrides > 0) {
      parts.push(`${stats.totalOverrides} user overrides in place.`);
    }

    return parts.join(' ');
  }

  /**
   * Reset engine state (for testing)
   */
  reset(): void {
    this.flags.clear();
    this.experiments.clear();
    this.evaluationCache.clear();
    this.audit = [];
    this.overrides.clear();
  }
}
