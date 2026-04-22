/**
 * Feature Flag System — Dynamic Feature Control
 *
 * Controls which features are available per user, plan, percentage rollout,
 * and A/B testing. Essential for gradual rollouts, plan gating, and experimentation.
 *
 * Key capabilities:
 * - Boolean flags (on/off)
 * - Plan-gated flags (only available on certain plans)
 * - Percentage rollout (gradual feature releases)
 * - User-level overrides (enable/disable for specific users)
 * - Time-based flags (enable between dates)
 * - Flag dependencies (feature B requires feature A)
 * - A/B testing variants
 * - Flag evaluation audit trail
 * - Voice-friendly flag status summaries
 *
 * @module flags/feature-flags
 */

import { EventEmitter } from 'events';

// ─── Types ────────────────────────────────────────────────────────────────

export type FlagStatus = 'enabled' | 'disabled' | 'conditional';

export type PlanId = 'free' | 'solo_store' | 'multi_store' | 'enterprise' | 'pay_per_count';

export type FlagCategory =
  | 'core'
  | 'agent'
  | 'billing'
  | 'ui'
  | 'experimental'
  | 'beta'
  | 'deprecated';

export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  category: FlagCategory;
  status: FlagStatus;
  // Plan gating: which plans can see this feature
  allowedPlans?: PlanId[];
  // Percentage rollout (0-100)
  rolloutPercentage?: number;
  // User-level overrides
  enabledUsers?: string[];
  disabledUsers?: string[];
  // Time-based activation
  enableAfter?: number; // timestamp
  disableBefore?: number; // timestamp (enable only after this date)
  enableUntil?: number; // timestamp (disable after this date)
  // Dependencies: other flags that must be enabled
  dependsOn?: string[];
  // A/B testing
  variants?: FlagVariant[];
  // Metadata
  owner?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface FlagVariant {
  id: string;
  name: string;
  weight: number; // 0-100, weights should sum to 100
  config?: Record<string, unknown>;
}

export interface FlagEvaluation {
  flagId: string;
  userId: string;
  planId?: PlanId;
  result: boolean;
  variant?: string;
  reason: EvaluationReason;
  timestamp: number;
}

export type EvaluationReason =
  | 'flag_disabled'
  | 'flag_enabled'
  | 'plan_allowed'
  | 'plan_denied'
  | 'user_override_enabled'
  | 'user_override_disabled'
  | 'rollout_included'
  | 'rollout_excluded'
  | 'time_window_active'
  | 'time_window_inactive'
  | 'dependency_not_met'
  | 'flag_not_found'
  | 'conditional_evaluated';

export interface EvaluationContext {
  userId: string;
  planId?: PlanId;
  attributes?: Record<string, unknown>;
}

export interface FlagManagerConfig {
  maxFlags: number;
  maxAuditLog: number;
  maxVariantsPerFlag: number;
  maxUserOverridesPerFlag: number;
  maxDependencyDepth: number;
  auditEnabled: boolean;
}

export const DEFAULT_FLAG_CONFIG: FlagManagerConfig = {
  maxFlags: 500,
  maxAuditLog: 10000,
  maxVariantsPerFlag: 10,
  maxUserOverridesPerFlag: 1000,
  maxDependencyDepth: 5,
  auditEnabled: true,
};

export interface FlagManagerEvents {
  'flag:created': (flag: FeatureFlag) => void;
  'flag:updated': (flag: FeatureFlag, changes: string[]) => void;
  'flag:deleted': (flagId: string) => void;
  'flag:evaluated': (evaluation: FlagEvaluation) => void;
  'flag:status_changed': (flagId: string, oldStatus: FlagStatus, newStatus: FlagStatus) => void;
}

// ─── Feature Flag Manager ─────────────────────────────────────────────────

export class FeatureFlagManager extends EventEmitter {
  private flags: Map<string, FeatureFlag> = new Map();
  private auditLog: FlagEvaluation[] = [];
  private config: FlagManagerConfig;

  constructor(config: Partial<FlagManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_FLAG_CONFIG, ...config };
  }

  // ─── Flag CRUD ────────────────────────────────────────────────────────

  /**
   * Create a new feature flag.
   */
  createFlag(params: {
    id: string;
    name: string;
    description?: string;
    category?: FlagCategory;
    status?: FlagStatus;
    allowedPlans?: PlanId[];
    rolloutPercentage?: number;
    enabledUsers?: string[];
    disabledUsers?: string[];
    enableAfter?: number;
    enableUntil?: number;
    dependsOn?: string[];
    variants?: FlagVariant[];
    owner?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): FeatureFlag {
    if (this.flags.has(params.id)) {
      throw new Error(`Flag '${params.id}' already exists`);
    }

    if (this.flags.size >= this.config.maxFlags) {
      throw new Error(`Maximum of ${this.config.maxFlags} flags reached`);
    }

    // Validate rollout percentage
    if (params.rolloutPercentage !== undefined) {
      if (params.rolloutPercentage < 0 || params.rolloutPercentage > 100) {
        throw new Error('Rollout percentage must be between 0 and 100');
      }
    }

    // Validate variants
    if (params.variants && params.variants.length > this.config.maxVariantsPerFlag) {
      throw new Error(`Maximum of ${this.config.maxVariantsPerFlag} variants per flag`);
    }

    if (params.variants && params.variants.length > 0) {
      const totalWeight = params.variants.reduce((sum, v) => sum + v.weight, 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        throw new Error('Variant weights must sum to 100');
      }
    }

    // Check dependencies exist
    if (params.dependsOn) {
      for (const dep of params.dependsOn) {
        if (!this.flags.has(dep)) {
          throw new Error(`Dependency flag '${dep}' not found`);
        }
      }
    }

    const now = Date.now();
    const flag: FeatureFlag = {
      id: params.id,
      name: params.name,
      description: params.description || '',
      category: params.category || 'core',
      status: params.status || 'disabled',
      allowedPlans: params.allowedPlans,
      rolloutPercentage: params.rolloutPercentage,
      enabledUsers: params.enabledUsers,
      disabledUsers: params.disabledUsers,
      enableAfter: params.enableAfter,
      enableUntil: params.enableUntil,
      dependsOn: params.dependsOn,
      variants: params.variants,
      owner: params.owner,
      tags: params.tags,
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata,
    };

    this.flags.set(params.id, flag);
    this.emit('flag:created', { ...flag });

    return { ...flag };
  }

  /**
   * Update an existing flag.
   */
  updateFlag(flagId: string, updates: Partial<Omit<FeatureFlag, 'id' | 'createdAt'>>): FeatureFlag {
    const flag = this.flags.get(flagId);
    if (!flag) {
      throw new Error(`Flag '${flagId}' not found`);
    }

    const changes: string[] = [];
    const oldStatus = flag.status;

    if (updates.status !== undefined && updates.status !== flag.status) {
      changes.push(`status: ${flag.status} → ${updates.status}`);
      flag.status = updates.status;
    }

    if (updates.name !== undefined) { flag.name = updates.name; changes.push('name'); }
    if (updates.description !== undefined) { flag.description = updates.description; changes.push('description'); }
    if (updates.category !== undefined) { flag.category = updates.category; changes.push('category'); }
    if (updates.allowedPlans !== undefined) { flag.allowedPlans = updates.allowedPlans; changes.push('allowedPlans'); }
    if (updates.rolloutPercentage !== undefined) {
      if (updates.rolloutPercentage < 0 || updates.rolloutPercentage > 100) {
        throw new Error('Rollout percentage must be between 0 and 100');
      }
      flag.rolloutPercentage = updates.rolloutPercentage;
      changes.push('rolloutPercentage');
    }
    if (updates.enabledUsers !== undefined) { flag.enabledUsers = updates.enabledUsers; changes.push('enabledUsers'); }
    if (updates.disabledUsers !== undefined) { flag.disabledUsers = updates.disabledUsers; changes.push('disabledUsers'); }
    if (updates.enableAfter !== undefined) { flag.enableAfter = updates.enableAfter; changes.push('enableAfter'); }
    if (updates.enableUntil !== undefined) { flag.enableUntil = updates.enableUntil; changes.push('enableUntil'); }
    if (updates.dependsOn !== undefined) { flag.dependsOn = updates.dependsOn; changes.push('dependsOn'); }
    if (updates.variants !== undefined) { flag.variants = updates.variants; changes.push('variants'); }
    if (updates.owner !== undefined) { flag.owner = updates.owner; changes.push('owner'); }
    if (updates.tags !== undefined) { flag.tags = updates.tags; changes.push('tags'); }
    if (updates.metadata !== undefined) { flag.metadata = updates.metadata; changes.push('metadata'); }

    flag.updatedAt = Date.now();

    if (changes.length > 0) {
      this.emit('flag:updated', { ...flag }, changes);
    }

    if (updates.status !== undefined && updates.status !== oldStatus) {
      this.emit('flag:status_changed', flagId, oldStatus, updates.status);
    }

    return { ...flag };
  }

  /**
   * Delete a flag.
   */
  deleteFlag(flagId: string): void {
    if (!this.flags.has(flagId)) {
      throw new Error(`Flag '${flagId}' not found`);
    }

    // Check if other flags depend on this one
    for (const [id, flag] of this.flags) {
      if (flag.dependsOn?.includes(flagId)) {
        throw new Error(`Cannot delete flag '${flagId}' — flag '${id}' depends on it`);
      }
    }

    this.flags.delete(flagId);
    this.emit('flag:deleted', flagId);
  }

  /**
   * Get a flag by ID.
   */
  getFlag(flagId: string): FeatureFlag | undefined {
    const flag = this.flags.get(flagId);
    return flag ? { ...flag } : undefined;
  }

  /**
   * Get all flags.
   */
  getAllFlags(): FeatureFlag[] {
    return Array.from(this.flags.values()).map(f => ({ ...f }));
  }

  /**
   * Get flags by category.
   */
  getFlagsByCategory(category: FlagCategory): FeatureFlag[] {
    return this.getAllFlags().filter(f => f.category === category);
  }

  /**
   * Get flags by tag.
   */
  getFlagsByTag(tag: string): FeatureFlag[] {
    return this.getAllFlags().filter(f => f.tags?.includes(tag));
  }

  // ─── Flag Evaluation ──────────────────────────────────────────────────

  /**
   * Evaluate whether a flag is enabled for a given context.
   * This is the main method — call this to check if a feature is available.
   */
  isEnabled(flagId: string, context: EvaluationContext): boolean {
    const evaluation = this.evaluate(flagId, context);
    return evaluation.result;
  }

  /**
   * Full evaluation with reason and variant info.
   */
  evaluate(flagId: string, context: EvaluationContext): FlagEvaluation {
    const flag = this.flags.get(flagId);

    if (!flag) {
      const evaluation: FlagEvaluation = {
        flagId,
        userId: context.userId,
        planId: context.planId,
        result: false,
        reason: 'flag_not_found',
        timestamp: Date.now(),
      };
      this.recordEvaluation(evaluation);
      return evaluation;
    }

    // 1. Check flag status
    if (flag.status === 'disabled') {
      return this.createEvaluation(flagId, context, false, 'flag_disabled');
    }

    if (flag.status === 'enabled') {
      // Still need to check other conditions
    }

    // 2. Check user overrides first (highest priority)
    if (flag.disabledUsers?.includes(context.userId)) {
      return this.createEvaluation(flagId, context, false, 'user_override_disabled');
    }

    if (flag.enabledUsers?.includes(context.userId)) {
      return this.createEvaluation(flagId, context, true, 'user_override_enabled');
    }

    // 3. Check time window
    const now = Date.now();
    if (flag.enableAfter && now < flag.enableAfter) {
      return this.createEvaluation(flagId, context, false, 'time_window_inactive');
    }
    if (flag.enableUntil && now > flag.enableUntil) {
      return this.createEvaluation(flagId, context, false, 'time_window_inactive');
    }

    // 4. Check plan gating
    if (flag.allowedPlans && flag.allowedPlans.length > 0) {
      if (!context.planId || !flag.allowedPlans.includes(context.planId)) {
        return this.createEvaluation(flagId, context, false, 'plan_denied');
      }
    }

    // 5. Check dependencies
    if (flag.dependsOn && flag.dependsOn.length > 0) {
      for (const dep of flag.dependsOn) {
        if (!this.isEnabled(dep, context)) {
          return this.createEvaluation(flagId, context, false, 'dependency_not_met');
        }
      }
    }

    // 6. Check rollout percentage
    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
      const hash = this.hashUserForRollout(context.userId, flagId);
      if (hash >= flag.rolloutPercentage) {
        return this.createEvaluation(flagId, context, false, 'rollout_excluded');
      }
      return this.createEvaluation(flagId, context, true, 'rollout_included');
    }

    // 7. If status is 'enabled' and all conditions pass
    if (flag.status === 'enabled') {
      return this.createEvaluation(flagId, context, true, 'flag_enabled');
    }

    // 8. Conditional: if plan was allowed or time window active
    if (flag.allowedPlans && context.planId && flag.allowedPlans.includes(context.planId)) {
      return this.createEvaluation(flagId, context, true, 'plan_allowed');
    }

    if (flag.enableAfter && now >= flag.enableAfter) {
      return this.createEvaluation(flagId, context, true, 'time_window_active');
    }

    return this.createEvaluation(flagId, context, true, 'conditional_evaluated');
  }

  /**
   * Get the variant for a user in an A/B test flag.
   */
  getVariant(flagId: string, context: EvaluationContext): FlagVariant | undefined {
    const flag = this.flags.get(flagId);
    if (!flag || !flag.variants || flag.variants.length === 0) {
      return undefined;
    }

    if (!this.isEnabled(flagId, context)) {
      return undefined;
    }

    // Deterministic variant assignment based on user ID
    const hash = this.hashUserForRollout(context.userId, `${flagId}_variant`);

    let cumulative = 0;
    for (const variant of flag.variants) {
      cumulative += variant.weight;
      if (hash < cumulative) {
        return { ...variant };
      }
    }

    // Fallback to last variant
    return { ...flag.variants[flag.variants.length - 1] };
  }

  /**
   * Evaluate all flags for a context and return enabled flag IDs.
   */
  getEnabledFlags(context: EvaluationContext): string[] {
    const enabled: string[] = [];
    for (const flag of this.flags.values()) {
      if (this.isEnabled(flag.id, context)) {
        enabled.push(flag.id);
      }
    }
    return enabled;
  }

  // ─── Bulk Operations ──────────────────────────────────────────────────

  /**
   * Enable a flag globally.
   */
  enableFlag(flagId: string): FeatureFlag {
    return this.updateFlag(flagId, { status: 'enabled' });
  }

  /**
   * Disable a flag globally.
   */
  disableFlag(flagId: string): FeatureFlag {
    return this.updateFlag(flagId, { status: 'disabled' });
  }

  /**
   * Add a user override (enable for specific user).
   */
  enableForUser(flagId: string, userId: string): void {
    const flag = this.flags.get(flagId);
    if (!flag) throw new Error(`Flag '${flagId}' not found`);

    if (!flag.enabledUsers) flag.enabledUsers = [];
    if (!flag.enabledUsers.includes(userId)) {
      if (flag.enabledUsers.length >= this.config.maxUserOverridesPerFlag) {
        throw new Error(`Maximum of ${this.config.maxUserOverridesPerFlag} user overrides per flag`);
      }
      flag.enabledUsers.push(userId);
    }

    // Remove from disabled list if present
    if (flag.disabledUsers) {
      flag.disabledUsers = flag.disabledUsers.filter(id => id !== userId);
    }

    flag.updatedAt = Date.now();
  }

  /**
   * Add a user override (disable for specific user).
   */
  disableForUser(flagId: string, userId: string): void {
    const flag = this.flags.get(flagId);
    if (!flag) throw new Error(`Flag '${flagId}' not found`);

    if (!flag.disabledUsers) flag.disabledUsers = [];
    if (!flag.disabledUsers.includes(userId)) {
      flag.disabledUsers.push(userId);
    }

    // Remove from enabled list if present
    if (flag.enabledUsers) {
      flag.enabledUsers = flag.enabledUsers.filter(id => id !== userId);
    }

    flag.updatedAt = Date.now();
  }

  /**
   * Set rollout percentage.
   */
  setRollout(flagId: string, percentage: number): FeatureFlag {
    return this.updateFlag(flagId, {
      rolloutPercentage: percentage,
      status: 'conditional',
    });
  }

  // ─── Audit Log ────────────────────────────────────────────────────────

  /**
   * Get recent evaluations.
   */
  getAuditLog(options?: {
    flagId?: string;
    userId?: string;
    limit?: number;
  }): FlagEvaluation[] {
    let results = [...this.auditLog];

    if (options?.flagId) {
      results = results.filter(e => e.flagId === options.flagId);
    }

    if (options?.userId) {
      results = results.filter(e => e.userId === options.userId);
    }

    const limit = options?.limit || 100;
    return results.slice(-limit);
  }

  /**
   * Get evaluation stats for a flag.
   */
  getFlagStats(flagId: string): {
    totalEvaluations: number;
    enabledCount: number;
    disabledCount: number;
    enableRate: number;
    topReasons: Record<string, number>;
  } {
    const evaluations = this.auditLog.filter(e => e.flagId === flagId);
    const enabledCount = evaluations.filter(e => e.result).length;
    const disabledCount = evaluations.filter(e => !e.result).length;

    const topReasons: Record<string, number> = {};
    for (const e of evaluations) {
      topReasons[e.reason] = (topReasons[e.reason] || 0) + 1;
    }

    return {
      totalEvaluations: evaluations.length,
      enabledCount,
      disabledCount,
      enableRate: evaluations.length > 0 ? enabledCount / evaluations.length : 0,
      topReasons,
    };
  }

  // ─── Summary ──────────────────────────────────────────────────────────

  /**
   * Get a summary of all flags.
   */
  getSummary(): {
    totalFlags: number;
    enabled: number;
    disabled: number;
    conditional: number;
    byCategory: Record<string, number>;
  } {
    const flags = Array.from(this.flags.values());
    const byCategory: Record<string, number> = {};

    for (const flag of flags) {
      byCategory[flag.category] = (byCategory[flag.category] || 0) + 1;
    }

    return {
      totalFlags: flags.length,
      enabled: flags.filter(f => f.status === 'enabled').length,
      disabled: flags.filter(f => f.status === 'disabled').length,
      conditional: flags.filter(f => f.status === 'conditional').length,
      byCategory,
    };
  }

  /**
   * Generate a TTS-friendly voice summary.
   */
  generateVoiceSummary(): string {
    const summary = this.getSummary();
    const parts: string[] = [];

    parts.push(`${summary.totalFlags} feature flag${summary.totalFlags !== 1 ? 's' : ''} configured.`);
    parts.push(`${summary.enabled} enabled, ${summary.disabled} disabled, ${summary.conditional} conditional.`);

    const categories = Object.entries(summary.byCategory)
      .map(([cat, count]) => `${count} ${cat}`)
      .join(', ');
    if (categories) {
      parts.push(`Categories: ${categories}.`);
    }

    return parts.join(' ');
  }

  /**
   * Get total flag count.
   */
  getFlagCount(): number {
    return this.flags.size;
  }

  /**
   * Destroy and clean up.
   */
  destroy(): void {
    this.removeAllListeners();
    this.flags.clear();
    this.auditLog = [];
  }

  // ─── Built-in Flag Templates ──────────────────────────────────────────

  /**
   * Create standard platform flags.
   */
  createPlatformFlags(): void {
    const platformFlags = [
      { id: 'inventory_vision', name: 'Inventory Vision', category: 'core' as FlagCategory, status: 'enabled' as FlagStatus },
      { id: 'voice_commands', name: 'Voice Commands', category: 'core' as FlagCategory, status: 'enabled' as FlagStatus },
      { id: 'barcode_scanning', name: 'Barcode Scanning', category: 'core' as FlagCategory, status: 'enabled' as FlagStatus },
      { id: 'multi_device_sync', name: 'Multi-Device Sync', category: 'core' as FlagCategory, status: 'conditional' as FlagStatus, allowedPlans: ['multi_store', 'enterprise'] as PlanId[] },
      { id: 'security_agent', name: 'Security Agent', category: 'agent' as FlagCategory, status: 'conditional' as FlagStatus, allowedPlans: ['solo_store', 'multi_store', 'enterprise'] as PlanId[] },
      { id: 'meeting_agent', name: 'Meeting Intelligence', category: 'agent' as FlagCategory, status: 'conditional' as FlagStatus, allowedPlans: ['multi_store', 'enterprise'] as PlanId[] },
      { id: 'deal_agent', name: 'Deal Analysis', category: 'agent' as FlagCategory, status: 'conditional' as FlagStatus, allowedPlans: ['solo_store', 'multi_store', 'enterprise'] as PlanId[] },
      { id: 'translation_agent', name: 'Translation', category: 'agent' as FlagCategory, status: 'conditional' as FlagStatus, allowedPlans: ['multi_store', 'enterprise'] as PlanId[] },
      { id: 'debug_agent', name: 'Debug Agent', category: 'agent' as FlagCategory, status: 'conditional' as FlagStatus, allowedPlans: ['enterprise'] as PlanId[] },
      { id: 'store_layout', name: 'Store Layout Mapping', category: 'core' as FlagCategory, status: 'conditional' as FlagStatus, allowedPlans: ['multi_store', 'enterprise'] as PlanId[] },
      { id: 'api_access', name: 'API Access', category: 'core' as FlagCategory, status: 'conditional' as FlagStatus, allowedPlans: ['enterprise'] as PlanId[] },
      { id: 'csv_export', name: 'CSV Export', category: 'core' as FlagCategory, status: 'enabled' as FlagStatus },
      { id: 'json_export', name: 'JSON Export', category: 'core' as FlagCategory, status: 'conditional' as FlagStatus, allowedPlans: ['solo_store', 'multi_store', 'enterprise'] as PlanId[] },
      { id: 'dashboard_widgets', name: 'Custom Dashboard Widgets', category: 'ui' as FlagCategory, status: 'conditional' as FlagStatus, allowedPlans: ['enterprise'] as PlanId[] },
      { id: 'dark_mode', name: 'Dark Mode', category: 'ui' as FlagCategory, status: 'enabled' as FlagStatus },
      { id: 'new_onboarding', name: 'New Onboarding Flow', category: 'experimental' as FlagCategory, status: 'conditional' as FlagStatus, rolloutPercentage: 25 },
    ];

    for (const flag of platformFlags) {
      if (!this.flags.has(flag.id)) {
        this.createFlag({
          ...flag,
          description: `Platform flag: ${flag.name}`,
        });
      }
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private createEvaluation(
    flagId: string,
    context: EvaluationContext,
    result: boolean,
    reason: EvaluationReason
  ): FlagEvaluation {
    const evaluation: FlagEvaluation = {
      flagId,
      userId: context.userId,
      planId: context.planId,
      result,
      reason,
      timestamp: Date.now(),
    };

    this.recordEvaluation(evaluation);
    return evaluation;
  }

  private recordEvaluation(evaluation: FlagEvaluation): void {
    if (this.config.auditEnabled) {
      this.auditLog.push(evaluation);

      // Trim audit log
      if (this.auditLog.length > this.config.maxAuditLog) {
        this.auditLog = this.auditLog.slice(-Math.floor(this.config.maxAuditLog * 0.75));
      }

      this.emit('flag:evaluated', evaluation);
    }
  }

  /**
   * Deterministic hash of userId + flagId to a number 0-99.
   * Used for percentage rollout and variant assignment.
   */
  private hashUserForRollout(userId: string, flagId: string): number {
    const str = `${userId}:${flagId}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash) % 100;
  }
}
