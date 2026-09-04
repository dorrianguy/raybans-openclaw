/**
 * A/B Testing & Experimentation Engine
 * 
 * Data-driven growth engine for optimizing pricing, onboarding,
 * feature adoption, and user experience. Features:
 * 
 * - Experiment lifecycle (draft → running → paused → completed → archived)
 * - Multi-variant testing (A/B, A/B/C, multivariate)
 * - Deterministic assignment via hash (consistent user experience)
 * - Statistical significance calculation (chi-squared test)
 * - Mutual exclusion groups (prevent experiment collisions)
 * - Traffic allocation with gradual rollout
 * - Conversion tracking and funnel analysis
 * - Segment-based targeting (by tier, role, region)
 * - Experiment scheduling (start/end dates)
 * - Voice-friendly results summaries
 * 
 * 🌙 Built by Night Shift Agent — Night #35
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'archived';

export type ExperimentType = 'ab' | 'multivariate' | 'feature_flag' | 'holdout';

export type MetricType = 'conversion' | 'revenue' | 'engagement' | 'retention' | 'custom';

export interface Experiment {
  id: string;
  name: string;
  description: string;
  type: ExperimentType;
  status: ExperimentStatus;
  hypothesis: string;
  variants: Variant[];
  metrics: ExperimentMetric[];
  targeting: TargetingRule[];
  exclusionGroup?: string;
  trafficAllocation: number;    // 0-100, percentage of eligible traffic
  startDate?: number;
  endDate?: number;
  minSampleSize: number;
  owner: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  winnerVariantId?: string;
}

export interface Variant {
  id: string;
  name: string;
  description: string;
  weight: number;              // 0-100, traffic split within experiment
  isControl: boolean;
  config: Record<string, unknown>;  // The actual values for this variant
  participants: number;
  conversions: number;
  totalRevenue: number;
  customMetrics: Record<string, number>;
}

export interface ExperimentMetric {
  id: string;
  name: string;
  type: MetricType;
  isPrimary: boolean;
  description: string;
  minimumDetectableEffect: number;  // e.g., 0.05 = 5% improvement
}

export interface TargetingRule {
  field: 'tier' | 'role' | 'region' | 'device' | 'tenure_days' | 'custom';
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'lt' | 'gte' | 'lte';
  value: string | string[] | number;
}

export interface Assignment {
  experimentId: string;
  variantId: string;
  userId: string;
  assignedAt: number;
  context: Record<string, unknown>;
}

export interface ConversionEvent {
  experimentId: string;
  variantId: string;
  userId: string;
  metricId: string;
  value: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ExperimentResults {
  experimentId: string;
  experimentName: string;
  status: ExperimentStatus;
  duration: { days: number; hours: number };
  totalParticipants: number;
  variants: VariantResults[];
  primaryMetric: MetricResults | null;
  allMetrics: MetricResults[];
  winner: { variantId: string; variantName: string; confidence: number } | null;
  recommendation: string;
}

export interface VariantResults {
  variantId: string;
  variantName: string;
  isControl: boolean;
  participants: number;
  conversionRate: number;
  totalRevenue: number;
  averageRevenue: number;
  uplift: number;           // vs control, percentage
}

export interface MetricResults {
  metricId: string;
  metricName: string;
  type: MetricType;
  isPrimary: boolean;
  variants: Array<{
    variantId: string;
    variantName: string;
    value: number;
    sampleSize: number;
  }>;
  chiSquared: number;
  pValue: number;
  significant: boolean;
  confidence: number;
}

export interface ExperimentEngineConfig {
  maxExperiments: number;
  maxVariantsPerExperiment: number;
  maxMetricsPerExperiment: number;
  maxAssignments: number;
  maxConversionEvents: number;
  significanceLevel: number;       // Default: 0.05 (95% confidence)
  minParticipantsForSignificance: number;
}

export interface ExperimentEngineEvents {
  'experiment:created': (experiment: Experiment) => void;
  'experiment:started': (experimentId: string) => void;
  'experiment:paused': (experimentId: string) => void;
  'experiment:completed': (experimentId: string, winnerId: string | undefined) => void;
  'experiment:archived': (experimentId: string) => void;
  'assignment:created': (assignment: Assignment) => void;
  'conversion:recorded': (event: ConversionEvent) => void;
  'significance:reached': (experimentId: string, metricId: string, pValue: number) => void;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ExperimentEngineConfig = {
  maxExperiments: 100,
  maxVariantsPerExperiment: 10,
  maxMetricsPerExperiment: 20,
  maxAssignments: 100000,
  maxConversionEvents: 500000,
  significanceLevel: 0.05,
  minParticipantsForSignificance: 30,
};

// ─── Engine ──────────────────────────────────────────────────────────────────

export class ExperimentEngine extends EventEmitter {
  private experiments: Map<string, Experiment> = new Map();
  private assignments: Assignment[] = [];
  private conversions: ConversionEvent[] = [];
  private exclusionGroups: Map<string, Set<string>> = new Map(); // group → experiment IDs
  private config: ExperimentEngineConfig;
  private idCounter = 0;

  constructor(config?: Partial<ExperimentEngineConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${++this.idCounter}`;
  }

  // ─── Experiment CRUD ─────────────────────────────────────────────────

  createExperiment(params: {
    name: string;
    description: string;
    type: ExperimentType;
    hypothesis: string;
    variants: Array<{
      name: string;
      description: string;
      weight: number;
      isControl: boolean;
      config: Record<string, unknown>;
    }>;
    metrics: Array<{
      name: string;
      type: MetricType;
      isPrimary: boolean;
      description?: string;
      minimumDetectableEffect?: number;
    }>;
    targeting?: TargetingRule[];
    exclusionGroup?: string;
    trafficAllocation?: number;
    startDate?: number;
    endDate?: number;
    minSampleSize?: number;
    owner: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Experiment {
    if (this.experiments.size >= this.config.maxExperiments) {
      throw new Error(`Maximum experiments reached (${this.config.maxExperiments})`);
    }

    // Validate variants
    if (params.variants.length < 2) {
      throw new Error('Experiment must have at least 2 variants');
    }
    if (params.variants.length > this.config.maxVariantsPerExperiment) {
      throw new Error(`Maximum variants exceeded (${this.config.maxVariantsPerExperiment})`);
    }

    // Validate exactly one control
    const controlCount = params.variants.filter(v => v.isControl).length;
    if (controlCount !== 1) {
      throw new Error('Experiment must have exactly 1 control variant');
    }

    // Validate weights sum to 100
    const weightSum = params.variants.reduce((sum, v) => sum + v.weight, 0);
    if (Math.abs(weightSum - 100) > 0.01) {
      throw new Error(`Variant weights must sum to 100 (got ${weightSum})`);
    }

    // Validate metrics
    if (params.metrics.length === 0) {
      throw new Error('Experiment must have at least 1 metric');
    }
    if (params.metrics.length > this.config.maxMetricsPerExperiment) {
      throw new Error(`Maximum metrics exceeded (${this.config.maxMetricsPerExperiment})`);
    }

    const primaryCount = params.metrics.filter(m => m.isPrimary).length;
    if (primaryCount !== 1) {
      throw new Error('Experiment must have exactly 1 primary metric');
    }

    // Validate traffic allocation
    const traffic = params.trafficAllocation ?? 100;
    if (traffic < 0 || traffic > 100) {
      throw new Error('Traffic allocation must be between 0 and 100');
    }

    const variants: Variant[] = params.variants.map(v => ({
      id: this.generateId('var'),
      name: v.name,
      description: v.description,
      weight: v.weight,
      isControl: v.isControl,
      config: { ...v.config },
      participants: 0,
      conversions: 0,
      totalRevenue: 0,
      customMetrics: {},
    }));

    const metrics: ExperimentMetric[] = params.metrics.map(m => ({
      id: this.generateId('metric'),
      name: m.name,
      type: m.type,
      isPrimary: m.isPrimary,
      description: m.description ?? '',
      minimumDetectableEffect: m.minimumDetectableEffect ?? 0.05,
    }));

    const experiment: Experiment = {
      id: this.generateId('exp'),
      name: params.name,
      description: params.description,
      type: params.type,
      status: 'draft',
      hypothesis: params.hypothesis,
      variants,
      metrics,
      targeting: params.targeting ?? [],
      exclusionGroup: params.exclusionGroup,
      trafficAllocation: traffic,
      startDate: params.startDate,
      endDate: params.endDate,
      minSampleSize: params.minSampleSize ?? 100,
      owner: params.owner,
      tags: params.tags ?? [],
      metadata: params.metadata ?? {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.experiments.set(experiment.id, experiment);

    // Register in exclusion group
    if (experiment.exclusionGroup) {
      if (!this.exclusionGroups.has(experiment.exclusionGroup)) {
        this.exclusionGroups.set(experiment.exclusionGroup, new Set());
      }
      this.exclusionGroups.get(experiment.exclusionGroup)!.add(experiment.id);
    }

    this.emit('experiment:created', experiment);
    return experiment;
  }

  getExperiment(experimentId: string): Experiment | undefined {
    return this.experiments.get(experimentId);
  }

  listExperiments(filters?: {
    status?: ExperimentStatus;
    type?: ExperimentType;
    owner?: string;
    tag?: string;
  }): Experiment[] {
    let results = Array.from(this.experiments.values());

    if (filters?.status) results = results.filter(e => e.status === filters.status);
    if (filters?.type) results = results.filter(e => e.type === filters.type);
    if (filters?.owner) results = results.filter(e => e.owner === filters.owner);
    if (filters?.tag) results = results.filter(e => e.tags.includes(filters.tag!));

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ─── Experiment Lifecycle ────────────────────────────────────────────

  startExperiment(experimentId: string): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment '${experimentId}' not found`);
    if (exp.status !== 'draft' && exp.status !== 'paused') {
      throw new Error(`Cannot start experiment in '${exp.status}' status`);
    }

    // Check exclusion group — no two experiments in same group can run
    if (exp.exclusionGroup) {
      const groupExps = this.exclusionGroups.get(exp.exclusionGroup) ?? new Set();
      for (const otherId of groupExps) {
        if (otherId === experimentId) continue;
        const other = this.experiments.get(otherId);
        if (other && other.status === 'running') {
          throw new Error(
            `Cannot start: experiment '${other.name}' in exclusion group '${exp.exclusionGroup}' is already running`
          );
        }
      }
    }

    exp.status = 'running';
    exp.startDate = exp.startDate ?? Date.now();
    exp.updatedAt = Date.now();

    this.experiments.set(experimentId, exp);
    this.emit('experiment:started', experimentId);
  }

  pauseExperiment(experimentId: string): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment '${experimentId}' not found`);
    if (exp.status !== 'running') {
      throw new Error(`Cannot pause experiment in '${exp.status}' status`);
    }

    exp.status = 'paused';
    exp.updatedAt = Date.now();
    this.experiments.set(experimentId, exp);
    this.emit('experiment:paused', experimentId);
  }

  completeExperiment(experimentId: string, winnerVariantId?: string): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment '${experimentId}' not found`);
    if (exp.status !== 'running' && exp.status !== 'paused') {
      throw new Error(`Cannot complete experiment in '${exp.status}' status`);
    }

    if (winnerVariantId) {
      if (!exp.variants.some(v => v.id === winnerVariantId)) {
        throw new Error(`Variant '${winnerVariantId}' not found in experiment`);
      }
    }

    exp.status = 'completed';
    exp.completedAt = Date.now();
    exp.winnerVariantId = winnerVariantId;
    exp.updatedAt = Date.now();

    this.experiments.set(experimentId, exp);
    this.emit('experiment:completed', experimentId, winnerVariantId);
  }

  archiveExperiment(experimentId: string): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment '${experimentId}' not found`);
    if (exp.status !== 'completed') {
      throw new Error(`Only completed experiments can be archived`);
    }

    exp.status = 'archived';
    exp.updatedAt = Date.now();
    this.experiments.set(experimentId, exp);
    this.emit('experiment:archived', experimentId);
  }

  // ─── Assignment ──────────────────────────────────────────────────────

  assignUser(experimentId: string, userId: string, context?: Record<string, unknown>): Assignment | null {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment '${experimentId}' not found`);
    if (exp.status !== 'running') return null;

    // Check if already assigned
    const existing = this.assignments.find(
      a => a.experimentId === experimentId && a.userId === userId
    );
    if (existing) return existing;

    // Check targeting rules
    if (context && !this.matchesTargeting(exp.targeting, context)) {
      return null;
    }

    // Check traffic allocation
    if (!this.isInTrafficAllocation(userId, experimentId, exp.trafficAllocation)) {
      return null;
    }

    // Check exclusion groups — user can only be in one experiment per group
    if (exp.exclusionGroup) {
      const groupExps = this.exclusionGroups.get(exp.exclusionGroup) ?? new Set();
      for (const otherId of groupExps) {
        if (otherId === experimentId) continue;
        const otherAssignment = this.assignments.find(
          a => a.experimentId === otherId && a.userId === userId
        );
        if (otherAssignment) return null;
      }
    }

    // Deterministic variant assignment via hash
    const variantId = this.selectVariant(userId, exp);

    const variant = exp.variants.find(v => v.id === variantId);
    if (variant) {
      variant.participants++;
    }

    const assignment: Assignment = {
      experimentId,
      variantId,
      userId,
      assignedAt: Date.now(),
      context: context ?? {},
    };

    this.assignments.push(assignment);

    // Trim assignments
    if (this.assignments.length > this.config.maxAssignments) {
      this.assignments = this.assignments.slice(-Math.floor(this.config.maxAssignments * 0.75));
    }

    this.emit('assignment:created', assignment);
    return assignment;
  }

  getAssignment(experimentId: string, userId: string): Assignment | undefined {
    return this.assignments.find(
      a => a.experimentId === experimentId && a.userId === userId
    );
  }

  getVariantConfig(experimentId: string, userId: string): Record<string, unknown> | null {
    const assignment = this.getAssignment(experimentId, userId);
    if (!assignment) return null;

    const exp = this.experiments.get(experimentId);
    if (!exp) return null;

    const variant = exp.variants.find(v => v.id === assignment.variantId);
    return variant?.config ?? null;
  }

  private selectVariant(userId: string, experiment: Experiment): string {
    // Deterministic hash-based assignment
    const hash = crypto
      .createHash('md5')
      .update(`${experiment.id}:${userId}`)
      .digest('hex');
    const hashValue = parseInt(hash.substring(0, 8), 16) % 100;

    let cumWeight = 0;
    for (const variant of experiment.variants) {
      cumWeight += variant.weight;
      if (hashValue < cumWeight) {
        return variant.id;
      }
    }

    // Fallback to last variant
    return experiment.variants[experiment.variants.length - 1].id;
  }

  private isInTrafficAllocation(userId: string, experimentId: string, allocation: number): boolean {
    if (allocation >= 100) return true;
    if (allocation <= 0) return false;

    const hash = crypto
      .createHash('md5')
      .update(`traffic:${experimentId}:${userId}`)
      .digest('hex');
    const value = parseInt(hash.substring(0, 8), 16) % 100;
    return value < allocation;
  }

  private matchesTargeting(rules: TargetingRule[], context: Record<string, unknown>): boolean {
    if (rules.length === 0) return true;

    return rules.every(rule => {
      const value = context[rule.field];
      return this.evaluateRule(rule, value);
    });
  }

  private evaluateRule(rule: TargetingRule, value: unknown): boolean {
    switch (rule.operator) {
      case 'eq': return value === rule.value;
      case 'neq': return value !== rule.value;
      case 'in': return Array.isArray(rule.value) && rule.value.includes(value as string);
      case 'not_in': return Array.isArray(rule.value) && !rule.value.includes(value as string);
      case 'gt': return typeof value === 'number' && typeof rule.value === 'number' && value > rule.value;
      case 'lt': return typeof value === 'number' && typeof rule.value === 'number' && value < rule.value;
      case 'gte': return typeof value === 'number' && typeof rule.value === 'number' && value >= rule.value;
      case 'lte': return typeof value === 'number' && typeof rule.value === 'number' && value <= rule.value;
      default: return false;
    }
  }

  // ─── Conversion Tracking ─────────────────────────────────────────────

  recordConversion(params: {
    experimentId: string;
    userId: string;
    metricId: string;
    value?: number;
    metadata?: Record<string, unknown>;
  }): ConversionEvent | null {
    const exp = this.experiments.get(params.experimentId);
    if (!exp) throw new Error(`Experiment '${params.experimentId}' not found`);

    const assignment = this.getAssignment(params.experimentId, params.userId);
    if (!assignment) return null; // User not in experiment

    const metric = exp.metrics.find(m => m.id === params.metricId);
    if (!metric) throw new Error(`Metric '${params.metricId}' not found in experiment`);

    const variant = exp.variants.find(v => v.id === assignment.variantId);
    if (variant) {
      variant.conversions++;
      if (metric.type === 'revenue') {
        variant.totalRevenue += params.value ?? 0;
      }
      if (params.value !== undefined) {
        variant.customMetrics[params.metricId] = 
          (variant.customMetrics[params.metricId] ?? 0) + params.value;
      }
    }

    const event: ConversionEvent = {
      experimentId: params.experimentId,
      variantId: assignment.variantId,
      userId: params.userId,
      metricId: params.metricId,
      value: params.value ?? 1,
      timestamp: Date.now(),
      metadata: params.metadata,
    };

    this.conversions.push(event);

    // Trim
    if (this.conversions.length > this.config.maxConversionEvents) {
      this.conversions = this.conversions.slice(-Math.floor(this.config.maxConversionEvents * 0.75));
    }

    this.emit('conversion:recorded', event);

    // Check for statistical significance
    this.checkSignificance(exp);

    return event;
  }

  // ─── Statistical Analysis ────────────────────────────────────────────

  private checkSignificance(experiment: Experiment): void {
    const totalParticipants = experiment.variants.reduce((sum, v) => sum + v.participants, 0);
    if (totalParticipants < this.config.minParticipantsForSignificance) return;

    for (const metric of experiment.metrics) {
      const result = this.calculateMetricResults(experiment, metric);
      if (result.significant) {
        this.emit('significance:reached', experiment.id, metric.id, result.pValue);
      }
    }
  }

  private calculateMetricResults(experiment: Experiment, metric: ExperimentMetric): MetricResults {
    const control = experiment.variants.find(v => v.isControl)!;
    const treatments = experiment.variants.filter(v => !v.isControl);

    const variants = experiment.variants.map(v => {
      let value: number;
      if (metric.type === 'conversion') {
        value = v.participants > 0 ? v.conversions / v.participants : 0;
      } else if (metric.type === 'revenue') {
        value = v.participants > 0 ? v.totalRevenue / v.participants : 0;
      } else {
        value = v.participants > 0
          ? (v.customMetrics[metric.id] ?? 0) / v.participants
          : 0;
      }

      return {
        variantId: v.id,
        variantName: v.name,
        value,
        sampleSize: v.participants,
      };
    });

    // Chi-squared test for conversion metrics
    let chiSquared = 0;
    let pValue = 1;
    let significant = false;

    if (metric.type === 'conversion' && control.participants >= this.config.minParticipantsForSignificance) {
      chiSquared = this.chiSquaredTest(experiment.variants);
      pValue = this.chiSquaredPValue(chiSquared, experiment.variants.length - 1);
      significant = pValue < this.config.significanceLevel;
    }

    const confidence = Math.round((1 - pValue) * 100);

    return {
      metricId: metric.id,
      metricName: metric.name,
      type: metric.type,
      isPrimary: metric.isPrimary,
      variants,
      chiSquared: Math.round(chiSquared * 1000) / 1000,
      pValue: Math.round(pValue * 10000) / 10000,
      significant,
      confidence: Math.min(confidence, 100),
    };
  }

  private chiSquaredTest(variants: Variant[]): number {
    const totalParticipants = variants.reduce((s, v) => s + v.participants, 0);
    const totalConversions = variants.reduce((s, v) => s + v.conversions, 0);

    if (totalParticipants === 0 || totalConversions === 0) return 0;

    const overallRate = totalConversions / totalParticipants;
    let chiSq = 0;

    for (const variant of variants) {
      if (variant.participants === 0) continue;

      const expectedConversions = variant.participants * overallRate;
      const expectedNonConversions = variant.participants * (1 - overallRate);

      if (expectedConversions > 0) {
        chiSq += Math.pow(variant.conversions - expectedConversions, 2) / expectedConversions;
      }

      const nonConversions = variant.participants - variant.conversions;
      if (expectedNonConversions > 0) {
        chiSq += Math.pow(nonConversions - expectedNonConversions, 2) / expectedNonConversions;
      }
    }

    return chiSq;
  }

  /**
   * Approximate chi-squared p-value using the Wilson-Hilferty approximation.
   * Good enough for experiment decision-making (not a stats library).
   */
  private chiSquaredPValue(chiSquared: number, degreesOfFreedom: number): number {
    if (degreesOfFreedom <= 0 || chiSquared <= 0) return 1;

    // Wilson-Hilferty approximation
    const k = degreesOfFreedom;
    const z = Math.pow(chiSquared / k, 1 / 3) - (1 - 2 / (9 * k));
    const denom = Math.sqrt(2 / (9 * k));
    const normalZ = z / denom;

    // Approximate normal CDF using error function approximation
    return 1 - this.normalCDF(normalZ);
  }

  private normalCDF(z: number): number {
    // Abramowitz and Stegun approximation 7.1.26
    if (z < -8) return 0;
    if (z > 8) return 1;

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
  }

  // ─── Results ─────────────────────────────────────────────────────────

  getResults(experimentId: string): ExperimentResults {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment '${experimentId}' not found`);

    const control = exp.variants.find(v => v.isControl)!;
    const totalParticipants = exp.variants.reduce((s, v) => s + v.participants, 0);

    const controlRate = control.participants > 0 ? control.conversions / control.participants : 0;

    const variantResults: VariantResults[] = exp.variants.map(v => {
      const rate = v.participants > 0 ? v.conversions / v.participants : 0;
      const uplift = controlRate > 0 ? ((rate - controlRate) / controlRate) * 100 : 0;

      return {
        variantId: v.id,
        variantName: v.name,
        isControl: v.isControl,
        participants: v.participants,
        conversionRate: Math.round(rate * 10000) / 100,  // percentage with 2 decimals
        totalRevenue: v.totalRevenue,
        averageRevenue: v.participants > 0 ? Math.round(v.totalRevenue / v.participants * 100) / 100 : 0,
        uplift: Math.round(uplift * 100) / 100,
      };
    });

    const allMetrics = exp.metrics.map(m => this.calculateMetricResults(exp, m));
    const primaryMetric = allMetrics.find(m => m.isPrimary) ?? null;

    // Determine winner
    let winner: ExperimentResults['winner'] = null;
    if (primaryMetric && primaryMetric.significant) {
      // Find best performing variant
      const bestVariant = primaryMetric.variants
        .filter(v => !exp.variants.find(ev => ev.id === v.variantId)?.isControl)
        .sort((a, b) => b.value - a.value)[0];

      if (bestVariant) {
        const controlValue = primaryMetric.variants.find(
          v => exp.variants.find(ev => ev.id === v.variantId)?.isControl
        )?.value ?? 0;

        if (bestVariant.value > controlValue) {
          winner = {
            variantId: bestVariant.variantId,
            variantName: bestVariant.variantName,
            confidence: primaryMetric.confidence,
          };
        }
      }
    }

    // Duration
    const startMs = exp.startDate ?? exp.createdAt;
    const endMs = exp.completedAt ?? Date.now();
    const durationMs = endMs - startMs;
    const days = Math.floor(durationMs / 86400000);
    const hours = Math.floor((durationMs % 86400000) / 3600000);

    // Recommendation
    let recommendation: string;
    if (totalParticipants < exp.minSampleSize) {
      recommendation = `Need more data: ${totalParticipants}/${exp.minSampleSize} participants.`;
    } else if (!primaryMetric?.significant) {
      recommendation = 'No statistically significant difference detected yet. Continue running.';
    } else if (winner) {
      recommendation = `Ship variant '${winner.variantName}' — ${winner.confidence}% confidence it outperforms control.`;
    } else {
      recommendation = 'Control performs best. Keep current implementation.';
    }

    return {
      experimentId,
      experimentName: exp.name,
      status: exp.status,
      duration: { days, hours },
      totalParticipants,
      variants: variantResults,
      primaryMetric,
      allMetrics,
      winner,
      recommendation,
    };
  }

  // ─── Voice Summary ───────────────────────────────────────────────────

  getVoiceSummary(experimentId: string): string {
    const results = this.getResults(experimentId);
    const parts: string[] = [];

    parts.push(`Experiment "${results.experimentName}": ${results.status}.`);
    parts.push(`${results.totalParticipants} participants over ${results.duration.days} days.`);

    if (results.winner) {
      parts.push(`Winner: ${results.winner.variantName} with ${results.winner.confidence}% confidence.`);
    } else if (results.primaryMetric && !results.primaryMetric.significant) {
      parts.push('No clear winner yet.');
    }

    for (const v of results.variants) {
      if (!v.isControl) {
        const dir = v.uplift >= 0 ? 'up' : 'down';
        parts.push(
          `${v.variantName}: ${v.conversionRate}% conversion, ${Math.abs(v.uplift)}% ${dir} from control.`
        );
      }
    }

    parts.push(results.recommendation);
    return parts.join(' ');
  }

  // ─── Experiment Templates ────────────────────────────────────────────

  static createPricingExperiment(params: {
    name: string;
    owner: string;
    controlPrice: number;
    testPrices: number[];
  }): Parameters<ExperimentEngine['createExperiment']>[0] {
    const totalVariants = params.testPrices.length + 1;
    const weight = Math.floor(100 / totalVariants);
    const remainder = 100 - weight * totalVariants;

    const variants = [
      {
        name: 'Control',
        description: `Current price: $${params.controlPrice}/mo`,
        weight: weight + remainder,
        isControl: true,
        config: { price: params.controlPrice },
      },
      ...params.testPrices.map((price, i) => ({
        name: `Price $${price}`,
        description: `Test price: $${price}/mo`,
        weight,
        isControl: false,
        config: { price },
      })),
    ];

    return {
      name: params.name,
      description: `Testing pricing variations: $${params.controlPrice} vs ${params.testPrices.map(p => '$' + p).join(', ')}`,
      type: 'ab' as ExperimentType,
      hypothesis: `Changing price from $${params.controlPrice} will impact conversion and revenue`,
      variants,
      metrics: [
        { name: 'Conversion Rate', type: 'conversion' as MetricType, isPrimary: true },
        { name: 'Revenue Per User', type: 'revenue' as MetricType, isPrimary: false },
      ],
      owner: params.owner,
      tags: ['pricing'],
    };
  }

  static createOnboardingExperiment(params: {
    name: string;
    owner: string;
    controlFlow: string;
    testFlows: Array<{ name: string; config: Record<string, unknown> }>;
  }): Parameters<ExperimentEngine['createExperiment']>[0] {
    const totalVariants = params.testFlows.length + 1;
    const weight = Math.floor(100 / totalVariants);
    const remainder = 100 - weight * totalVariants;

    const variants = [
      {
        name: 'Control',
        description: `Current flow: ${params.controlFlow}`,
        weight: weight + remainder,
        isControl: true,
        config: { flow: params.controlFlow },
      },
      ...params.testFlows.map(flow => ({
        name: flow.name,
        description: `Test flow: ${flow.name}`,
        weight,
        isControl: false,
        config: flow.config,
      })),
    ];

    return {
      name: params.name,
      description: `Testing onboarding flow variations`,
      type: 'ab' as ExperimentType,
      hypothesis: 'A different onboarding flow will increase activation rate',
      variants,
      metrics: [
        { name: 'Activation Rate', type: 'conversion' as MetricType, isPrimary: true },
        { name: 'Time to First Value', type: 'engagement' as MetricType, isPrimary: false },
        { name: 'Day 7 Retention', type: 'retention' as MetricType, isPrimary: false },
      ],
      owner: params.owner,
      tags: ['onboarding'],
    };
  }

  // ─── Stats ───────────────────────────────────────────────────────────

  getStats(): {
    totalExperiments: number;
    running: number;
    completed: number;
    draft: number;
    paused: number;
    totalAssignments: number;
    totalConversions: number;
    experimentsWithWinner: number;
    averageDurationDays: number;
    byType: Record<ExperimentType, number>;
  } {
    const exps = Array.from(this.experiments.values());

    const byType: Record<ExperimentType, number> = {
      ab: 0, multivariate: 0, feature_flag: 0, holdout: 0,
    };
    for (const e of exps) byType[e.type]++;

    const completedExps = exps.filter(e => e.status === 'completed');
    const avgDuration = completedExps.length > 0
      ? completedExps.reduce((sum, e) => {
          const dur = (e.completedAt ?? Date.now()) - (e.startDate ?? e.createdAt);
          return sum + dur;
        }, 0) / completedExps.length / 86400000
      : 0;

    return {
      totalExperiments: exps.length,
      running: exps.filter(e => e.status === 'running').length,
      completed: completedExps.length,
      draft: exps.filter(e => e.status === 'draft').length,
      paused: exps.filter(e => e.status === 'paused').length,
      totalAssignments: this.assignments.length,
      totalConversions: this.conversions.length,
      experimentsWithWinner: completedExps.filter(e => e.winnerVariantId).length,
      averageDurationDays: Math.round(avgDuration * 10) / 10,
      byType,
    };
  }
}
