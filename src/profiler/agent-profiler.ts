/**
 * Agent Performance Profiler — Benchmark, profile, and optimize all agents
 *
 * Capabilities:
 * - Per-agent latency tracking (p50, p95, p99, max)
 * - Memory usage profiling per invocation
 * - Throughput measurement (ops/sec)
 * - Cost estimation per invocation (API tokens)
 * - Regression detection (performance degrading over time)
 * - Bottleneck identification across agent pipelines
 * - Configurable warmup, iterations, and concurrency
 * - Historical comparison with saved baselines
 * - Voice-friendly performance summaries
 *
 * @module profiler/agent-profiler
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProfilerConfig {
  /** Max stored samples per agent (default: 10000) */
  maxSamplesPerAgent?: number;
  /** Enable memory tracking (adds overhead, default: false) */
  trackMemory?: boolean;
  /** Regression detection threshold — % slower before alert (default: 20) */
  regressionThreshold?: number;
  /** Minimum samples before regression check (default: 50) */
  regressionMinSamples?: number;
  /** Auto-trim samples older than this (ms, default: 7 days) */
  retentionMs?: number;
  /** Cost per 1K input tokens (default: $0.005) */
  costPerInputKTokens?: number;
  /** Cost per 1K output tokens (default: $0.015) */
  costPerOutputKTokens?: number;
}

export interface InvocationSample {
  agentId: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
  error?: string;
  memoryBefore?: number;
  memoryAfter?: number;
  memoryDelta?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  metadata?: Record<string, unknown>;
}

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  stdDev: number;
}

export interface AgentProfile {
  agentId: string;
  sampleCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  latency: LatencyStats;
  throughput: {
    opsPerSecond: number;
    opsPerMinute: number;
  };
  memory: {
    avgDeltaBytes: number;
    maxDeltaBytes: number;
    peakUsageBytes: number;
  } | null;
  cost: {
    totalEstimated: number;
    avgPerInvocation: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  timeRange: {
    firstSample: number;
    lastSample: number;
    spanMs: number;
  };
}

export interface BenchmarkConfig {
  /** Number of warmup iterations (default: 3) */
  warmup?: number;
  /** Number of measured iterations (default: 100) */
  iterations?: number;
  /** Concurrency level (default: 1) */
  concurrency?: number;
  /** Timeout per invocation in ms (default: 30000) */
  timeoutMs?: number;
  /** Label for this benchmark run */
  label?: string;
}

export interface BenchmarkResult {
  agentId: string;
  label: string;
  config: Required<BenchmarkConfig>;
  latency: LatencyStats;
  successRate: number;
  totalDurationMs: number;
  throughput: number;
  errors: Array<{ iteration: number; error: string }>;
  timestamp: number;
}

export interface RegressionAlert {
  agentId: string;
  metric: 'latency_p50' | 'latency_p95' | 'latency_p99' | 'success_rate' | 'throughput';
  baselineValue: number;
  currentValue: number;
  changePercent: number;
  severity: 'warning' | 'critical';
  timestamp: number;
}

export interface Baseline {
  agentId: string;
  label: string;
  profile: AgentProfile;
  savedAt: number;
}

export interface PipelineStage {
  name: string;
  agentId: string;
  durationMs: number;
}

export interface PipelineProfile {
  name: string;
  stages: PipelineStage[];
  totalDurationMs: number;
  bottleneck: PipelineStage;
  bottleneckPercent: number;
}

// ─── Agent Performance Profiler ─────────────────────────────────────────────

export class AgentProfiler extends EventEmitter {
  private config: Required<ProfilerConfig>;
  private samples: Map<string, InvocationSample[]> = new Map();
  private baselines: Map<string, Baseline[]> = new Map();
  private activeTimers: Map<string, { startTime: number; memBefore?: number }> = new Map();
  private timerCounter = 0;

  constructor(config: ProfilerConfig = {}) {
    super();
    this.config = {
      maxSamplesPerAgent: config.maxSamplesPerAgent ?? 10000,
      trackMemory: config.trackMemory ?? false,
      regressionThreshold: config.regressionThreshold ?? 20,
      regressionMinSamples: config.regressionMinSamples ?? 50,
      retentionMs: config.retentionMs ?? 7 * 24 * 60 * 60 * 1000,
      costPerInputKTokens: config.costPerInputKTokens ?? 0.005,
      costPerOutputKTokens: config.costPerOutputKTokens ?? 0.015,
    };
  }

  // ─── Core Profiling ─────────────────────────────────────────────────────

  /**
   * Start timing an agent invocation. Returns a timer ID to pass to stopTimer().
   */
  startTimer(agentId: string): string {
    const timerId = `${agentId}_${++this.timerCounter}_${Date.now()}`;
    const entry: { startTime: number; memBefore?: number } = {
      startTime: Date.now(),
    };

    if (this.config.trackMemory && typeof process !== 'undefined' && process.memoryUsage) {
      entry.memBefore = process.memoryUsage().heapUsed;
    }

    this.activeTimers.set(timerId, entry);
    return timerId;
  }

  /**
   * Stop timing and record the sample.
   */
  stopTimer(
    timerId: string,
    result: {
      success: boolean;
      error?: string;
      inputTokens?: number;
      outputTokens?: number;
      metadata?: Record<string, unknown>;
    }
  ): InvocationSample | null {
    const timer = this.activeTimers.get(timerId);
    if (!timer) return null;

    this.activeTimers.delete(timerId);

    const agentId = timerId.split('_')[0];
    const now = Date.now();
    const durationMs = now - timer.startTime;

    let memoryAfter: number | undefined;
    let memoryDelta: number | undefined;
    if (this.config.trackMemory && timer.memBefore !== undefined && typeof process !== 'undefined' && process.memoryUsage) {
      memoryAfter = process.memoryUsage().heapUsed;
      memoryDelta = memoryAfter - timer.memBefore;
    }

    let estimatedCost: number | undefined;
    if (result.inputTokens !== undefined || result.outputTokens !== undefined) {
      const inputCost = ((result.inputTokens ?? 0) / 1000) * this.config.costPerInputKTokens;
      const outputCost = ((result.outputTokens ?? 0) / 1000) * this.config.costPerOutputKTokens;
      estimatedCost = inputCost + outputCost;
    }

    const sample: InvocationSample = {
      agentId,
      timestamp: now,
      durationMs,
      success: result.success,
      error: result.error,
      memoryBefore: timer.memBefore,
      memoryAfter,
      memoryDelta,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedCost,
      metadata: result.metadata,
    };

    this.recordSample(sample);
    return sample;
  }

  /**
   * Record a pre-built sample directly.
   */
  recordSample(sample: InvocationSample): void {
    if (!this.samples.has(sample.agentId)) {
      this.samples.set(sample.agentId, []);
    }

    const agentSamples = this.samples.get(sample.agentId)!;
    agentSamples.push(sample);

    // Enforce max samples
    if (agentSamples.length > this.config.maxSamplesPerAgent) {
      const excess = agentSamples.length - this.config.maxSamplesPerAgent;
      agentSamples.splice(0, excess);
    }

    this.emit('sample', sample);

    // Check for regressions
    if (agentSamples.length >= this.config.regressionMinSamples) {
      this.checkRegressions(sample.agentId);
    }
  }

  /**
   * Wrap an async function with profiling.
   */
  async profile<T>(
    agentId: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<{ result: T; sample: InvocationSample }> {
    const timerId = this.startTimer(agentId);
    try {
      const result = await fn();
      const sample = this.stopTimer(timerId, {
        success: true,
        metadata,
      })!;
      return { result, sample };
    } catch (err) {
      const sample = this.stopTimer(timerId, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        metadata,
      })!;
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { sample });
    }
  }

  // ─── Profiling Queries ──────────────────────────────────────────────────

  /**
   * Get comprehensive profile for an agent.
   */
  getProfile(agentId: string, sinceMs?: number): AgentProfile | null {
    const raw = this.samples.get(agentId);
    if (!raw || raw.length === 0) return null;

    const samples = sinceMs
      ? raw.filter((s) => s.timestamp >= sinceMs)
      : raw;

    if (samples.length === 0) return null;

    const successSamples = samples.filter((s) => s.success);
    const failureSamples = samples.filter((s) => !s.success);
    const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);

    const latency = this.calcLatencyStats(durations);

    // Throughput
    const timeSpan = samples[samples.length - 1].timestamp - samples[0].timestamp;
    const opsPerSecond = timeSpan > 0 ? (samples.length / timeSpan) * 1000 : samples.length;
    const opsPerMinute = opsPerSecond * 60;

    // Memory
    let memory: AgentProfile['memory'] = null;
    if (this.config.trackMemory) {
      const memDeltas = samples
        .filter((s) => s.memoryDelta !== undefined)
        .map((s) => s.memoryDelta!);
      const memPeaks = samples
        .filter((s) => s.memoryAfter !== undefined)
        .map((s) => s.memoryAfter!);

      if (memDeltas.length > 0) {
        memory = {
          avgDeltaBytes: memDeltas.reduce((a, b) => a + b, 0) / memDeltas.length,
          maxDeltaBytes: Math.max(...memDeltas),
          peakUsageBytes: memPeaks.length > 0 ? Math.max(...memPeaks) : 0,
        };
      }
    }

    // Cost
    const totalInputTokens = samples.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0);
    const totalOutputTokens = samples.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0);
    const totalEstimated = samples.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);

    return {
      agentId,
      sampleCount: samples.length,
      successCount: successSamples.length,
      failureCount: failureSamples.length,
      successRate: samples.length > 0 ? successSamples.length / samples.length : 0,
      latency,
      throughput: {
        opsPerSecond: Math.round(opsPerSecond * 1000) / 1000,
        opsPerMinute: Math.round(opsPerMinute * 100) / 100,
      },
      memory,
      cost: {
        totalEstimated: Math.round(totalEstimated * 10000) / 10000,
        avgPerInvocation: samples.length > 0
          ? Math.round((totalEstimated / samples.length) * 10000) / 10000
          : 0,
        totalInputTokens,
        totalOutputTokens,
      },
      timeRange: {
        firstSample: samples[0].timestamp,
        lastSample: samples[samples.length - 1].timestamp,
        spanMs: timeSpan,
      },
    };
  }

  /**
   * Get profiles for all tracked agents.
   */
  getAllProfiles(sinceMs?: number): AgentProfile[] {
    const profiles: AgentProfile[] = [];
    for (const agentId of this.samples.keys()) {
      const profile = this.getProfile(agentId, sinceMs);
      if (profile) profiles.push(profile);
    }
    return profiles.sort((a, b) => b.sampleCount - a.sampleCount);
  }

  /**
   * Get the slowest agents by median latency.
   */
  getSlowest(limit = 5): Array<{ agentId: string; medianMs: number; p95Ms: number }> {
    return this.getAllProfiles()
      .sort((a, b) => b.latency.median - a.latency.median)
      .slice(0, limit)
      .map((p) => ({
        agentId: p.agentId,
        medianMs: p.latency.median,
        p95Ms: p.latency.p95,
      }));
  }

  /**
   * Get agents with the highest failure rates.
   */
  getMostUnreliable(limit = 5): Array<{ agentId: string; successRate: number; failures: number }> {
    return this.getAllProfiles()
      .filter((p) => p.sampleCount >= 10)
      .sort((a, b) => a.successRate - b.successRate)
      .slice(0, limit)
      .map((p) => ({
        agentId: p.agentId,
        successRate: Math.round(p.successRate * 10000) / 100,
        failures: p.failureCount,
      }));
  }

  /**
   * Get the most expensive agents by total estimated cost.
   */
  getMostExpensive(limit = 5): Array<{ agentId: string; totalCost: number; avgCost: number }> {
    return this.getAllProfiles()
      .sort((a, b) => b.cost.totalEstimated - a.cost.totalEstimated)
      .slice(0, limit)
      .map((p) => ({
        agentId: p.agentId,
        totalCost: p.cost.totalEstimated,
        avgCost: p.cost.avgPerInvocation,
      }));
  }

  // ─── Benchmarking ───────────────────────────────────────────────────────

  /**
   * Run a benchmark against an agent function.
   */
  async benchmark(
    agentId: string,
    fn: (iteration: number) => Promise<void>,
    config: BenchmarkConfig = {}
  ): Promise<BenchmarkResult> {
    const fullConfig: Required<BenchmarkConfig> = {
      warmup: config.warmup ?? 3,
      iterations: config.iterations ?? 100,
      concurrency: config.concurrency ?? 1,
      timeoutMs: config.timeoutMs ?? 30000,
      label: config.label ?? `benchmark_${Date.now()}`,
    };

    // Warmup
    for (let i = 0; i < fullConfig.warmup; i++) {
      try {
        await this.withTimeout(fn(i), fullConfig.timeoutMs);
      } catch {
        // Ignore warmup errors
      }
    }

    const durations: number[] = [];
    const errors: Array<{ iteration: number; error: string }> = [];
    const startTime = Date.now();

    if (fullConfig.concurrency <= 1) {
      // Sequential
      for (let i = 0; i < fullConfig.iterations; i++) {
        const iterStart = Date.now();
        try {
          await this.withTimeout(fn(i), fullConfig.timeoutMs);
          durations.push(Date.now() - iterStart);
        } catch (err) {
          durations.push(Date.now() - iterStart);
          errors.push({
            iteration: i,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } else {
      // Concurrent
      const pending: Array<Promise<void>> = [];
      let iterIndex = 0;

      const runNext = async (): Promise<void> => {
        while (iterIndex < fullConfig.iterations) {
          const i = iterIndex++;
          const iterStart = Date.now();
          try {
            await this.withTimeout(fn(i), fullConfig.timeoutMs);
            durations.push(Date.now() - iterStart);
          } catch (err) {
            durations.push(Date.now() - iterStart);
            errors.push({
              iteration: i,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      };

      for (let c = 0; c < fullConfig.concurrency; c++) {
        pending.push(runNext());
      }
      await Promise.all(pending);
    }

    const totalDurationMs = Date.now() - startTime;
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const successCount = fullConfig.iterations - errors.length;

    const result: BenchmarkResult = {
      agentId,
      label: fullConfig.label,
      config: fullConfig,
      latency: this.calcLatencyStats(sortedDurations),
      successRate: successCount / fullConfig.iterations,
      totalDurationMs,
      throughput: Math.round((fullConfig.iterations / totalDurationMs) * 1000 * 100) / 100,
      errors,
      timestamp: Date.now(),
    };

    this.emit('benchmark', result);
    return result;
  }

  // ─── Baselines & Regression ─────────────────────────────────────────────

  /**
   * Save current profile as a baseline for future comparison.
   */
  saveBaseline(agentId: string, label: string): Baseline | null {
    const profile = this.getProfile(agentId);
    if (!profile) return null;

    const baseline: Baseline = {
      agentId,
      label,
      profile,
      savedAt: Date.now(),
    };

    if (!this.baselines.has(agentId)) {
      this.baselines.set(agentId, []);
    }
    this.baselines.get(agentId)!.push(baseline);

    this.emit('baseline:saved', baseline);
    return baseline;
  }

  /**
   * Get saved baselines for an agent.
   */
  getBaselines(agentId: string): Baseline[] {
    return this.baselines.get(agentId) ?? [];
  }

  /**
   * Compare current performance against a baseline.
   */
  compareToBaseline(
    agentId: string,
    baselineLabel: string
  ): {
    baseline: AgentProfile;
    current: AgentProfile;
    changes: Array<{
      metric: string;
      baselineValue: number;
      currentValue: number;
      changePercent: number;
      improved: boolean;
    }>;
  } | null {
    const baselines = this.baselines.get(agentId);
    if (!baselines) return null;

    const baseline = baselines.find((b) => b.label === baselineLabel);
    if (!baseline) return null;

    const current = this.getProfile(agentId);
    if (!current) return null;

    const changes: Array<{
      metric: string;
      baselineValue: number;
      currentValue: number;
      changePercent: number;
      improved: boolean;
    }> = [];

    const addChange = (metric: string, baseVal: number, curVal: number, lowerIsBetter: boolean) => {
      if (baseVal === 0) return;
      const changePercent = ((curVal - baseVal) / baseVal) * 100;
      changes.push({
        metric,
        baselineValue: baseVal,
        currentValue: curVal,
        changePercent: Math.round(changePercent * 100) / 100,
        improved: lowerIsBetter ? curVal < baseVal : curVal > baseVal,
      });
    };

    addChange('latency_median', baseline.profile.latency.median, current.latency.median, true);
    addChange('latency_p95', baseline.profile.latency.p95, current.latency.p95, true);
    addChange('latency_p99', baseline.profile.latency.p99, current.latency.p99, true);
    addChange('success_rate', baseline.profile.successRate, current.successRate, false);
    addChange('throughput', baseline.profile.throughput.opsPerSecond, current.throughput.opsPerSecond, false);
    addChange('avg_cost', baseline.profile.cost.avgPerInvocation, current.cost.avgPerInvocation, true);

    return {
      baseline: baseline.profile,
      current,
      changes,
    };
  }

  /**
   * Check for performance regressions against the most recent baseline.
   */
  private checkRegressions(agentId: string): void {
    const baselines = this.baselines.get(agentId);
    if (!baselines || baselines.length === 0) return;

    const latestBaseline = baselines[baselines.length - 1];
    const current = this.getProfile(agentId);
    if (!current) return;

    const threshold = this.config.regressionThreshold / 100;
    const alerts: RegressionAlert[] = [];

    // Latency regressions (higher = worse)
    const checkLatency = (
      metric: RegressionAlert['metric'],
      baseVal: number,
      curVal: number
    ) => {
      if (baseVal === 0) return;
      const change = (curVal - baseVal) / baseVal;
      if (change > threshold) {
        alerts.push({
          agentId,
          metric,
          baselineValue: baseVal,
          currentValue: curVal,
          changePercent: Math.round(change * 10000) / 100,
          severity: change > threshold * 2 ? 'critical' : 'warning',
          timestamp: Date.now(),
        });
      }
    };

    checkLatency('latency_p50', latestBaseline.profile.latency.median, current.latency.median);
    checkLatency('latency_p95', latestBaseline.profile.latency.p95, current.latency.p95);
    checkLatency('latency_p99', latestBaseline.profile.latency.p99, current.latency.p99);

    // Success rate regression (lower = worse)
    if (latestBaseline.profile.successRate > 0) {
      const srChange =
        (latestBaseline.profile.successRate - current.successRate) /
        latestBaseline.profile.successRate;
      if (srChange > threshold) {
        alerts.push({
          agentId,
          metric: 'success_rate',
          baselineValue: latestBaseline.profile.successRate,
          currentValue: current.successRate,
          changePercent: Math.round(srChange * 10000) / 100,
          severity: srChange > threshold * 2 ? 'critical' : 'warning',
          timestamp: Date.now(),
        });
      }
    }

    for (const alert of alerts) {
      this.emit('regression', alert);
    }
  }

  // ─── Pipeline Profiling ─────────────────────────────────────────────────

  /**
   * Profile a multi-stage agent pipeline to find bottlenecks.
   */
  async profilePipeline(
    name: string,
    stages: Array<{
      name: string;
      agentId: string;
      fn: () => Promise<void>;
    }>
  ): Promise<PipelineProfile> {
    const stageResults: PipelineStage[] = [];

    for (const stage of stages) {
      const start = Date.now();
      await stage.fn();
      const durationMs = Date.now() - start;

      stageResults.push({
        name: stage.name,
        agentId: stage.agentId,
        durationMs,
      });
    }

    const totalDurationMs = stageResults.reduce((sum, s) => sum + s.durationMs, 0);
    const bottleneck = stageResults.reduce((max, s) =>
      s.durationMs > max.durationMs ? s : max
    );

    const result: PipelineProfile = {
      name,
      stages: stageResults,
      totalDurationMs,
      bottleneck,
      bottleneckPercent:
        totalDurationMs > 0
          ? Math.round((bottleneck.durationMs / totalDurationMs) * 10000) / 100
          : 0,
    };

    this.emit('pipeline', result);
    return result;
  }

  // ─── Maintenance ────────────────────────────────────────────────────────

  /**
   * Trim old samples based on retention policy.
   */
  trimOldSamples(): number {
    const cutoff = Date.now() - this.config.retentionMs;
    let trimmed = 0;

    for (const [agentId, samples] of this.samples) {
      const before = samples.length;
      const filtered = samples.filter((s) => s.timestamp >= cutoff);
      if (filtered.length < before) {
        this.samples.set(agentId, filtered);
        trimmed += before - filtered.length;
      }
    }

    return trimmed;
  }

  /**
   * Clear all data for an agent.
   */
  clearAgent(agentId: string): void {
    this.samples.delete(agentId);
    this.baselines.delete(agentId);
  }

  /**
   * Clear all profiler data.
   */
  clearAll(): void {
    this.samples.clear();
    this.baselines.clear();
    this.activeTimers.clear();
    this.timerCounter = 0;
  }

  /**
   * Get list of all tracked agent IDs.
   */
  getTrackedAgents(): string[] {
    return Array.from(this.samples.keys());
  }

  /**
   * Get raw sample count per agent.
   */
  getSampleCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [agentId, samples] of this.samples) {
      counts[agentId] = samples.length;
    }
    return counts;
  }

  // ─── Dashboard Summary ──────────────────────────────────────────────────

  /**
   * Generate a dashboard-ready summary of all agents.
   */
  getDashboardSummary(): {
    totalAgents: number;
    totalSamples: number;
    totalCost: number;
    overallSuccessRate: number;
    avgLatencyMs: number;
    agents: Array<{
      agentId: string;
      samples: number;
      successRate: number;
      medianLatencyMs: number;
      p95LatencyMs: number;
      estimatedCost: number;
    }>;
    alerts: RegressionAlert[];
  } {
    const profiles = this.getAllProfiles();
    const alerts: RegressionAlert[] = [];

    // Collect regression alerts
    for (const profile of profiles) {
      const baselines = this.baselines.get(profile.agentId);
      if (!baselines || baselines.length === 0) continue;
      const comparison = this.compareToBaseline(
        profile.agentId,
        baselines[baselines.length - 1].label
      );
      if (!comparison) continue;
      for (const change of comparison.changes) {
        if (!change.improved && Math.abs(change.changePercent) > this.config.regressionThreshold) {
          alerts.push({
            agentId: profile.agentId,
            metric: change.metric as RegressionAlert['metric'],
            baselineValue: change.baselineValue,
            currentValue: change.currentValue,
            changePercent: change.changePercent,
            severity: Math.abs(change.changePercent) > this.config.regressionThreshold * 2
              ? 'critical'
              : 'warning',
            timestamp: Date.now(),
          });
        }
      }
    }

    const totalSamples = profiles.reduce((sum, p) => sum + p.sampleCount, 0);
    const totalSuccesses = profiles.reduce((sum, p) => sum + p.successCount, 0);
    const totalCost = profiles.reduce((sum, p) => sum + p.cost.totalEstimated, 0);
    const avgLatency =
      profiles.length > 0
        ? profiles.reduce((sum, p) => sum + p.latency.mean, 0) / profiles.length
        : 0;

    return {
      totalAgents: profiles.length,
      totalSamples,
      totalCost: Math.round(totalCost * 10000) / 10000,
      overallSuccessRate: totalSamples > 0 ? totalSuccesses / totalSamples : 1,
      avgLatencyMs: Math.round(avgLatency * 100) / 100,
      agents: profiles.map((p) => ({
        agentId: p.agentId,
        samples: p.sampleCount,
        successRate: Math.round(p.successRate * 10000) / 100,
        medianLatencyMs: p.latency.median,
        p95LatencyMs: p.latency.p95,
        estimatedCost: p.cost.totalEstimated,
      })),
      alerts,
    };
  }

  // ─── Voice Summary ──────────────────────────────────────────────────────

  /**
   * Generate a TTS-friendly performance summary.
   */
  getVoiceSummary(): string {
    const summary = this.getDashboardSummary();
    if (summary.totalAgents === 0) {
      return 'No agent performance data collected yet.';
    }

    const parts: string[] = [];
    parts.push(
      `Tracking ${summary.totalAgents} agents with ${summary.totalSamples} total invocations.`
    );
    parts.push(
      `Overall success rate: ${Math.round(summary.overallSuccessRate * 100)}%.`
    );
    parts.push(
      `Average latency: ${Math.round(summary.avgLatencyMs)} milliseconds.`
    );

    if (summary.totalCost > 0) {
      parts.push(`Total estimated API cost: $${summary.totalCost.toFixed(2)}.`);
    }

    // Highlight problematic agents
    const slowest = this.getSlowest(1);
    if (slowest.length > 0) {
      parts.push(
        `Slowest agent: ${slowest[0].agentId} at ${Math.round(slowest[0].medianMs)} milliseconds median.`
      );
    }

    const unreliable = this.getMostUnreliable(1);
    if (unreliable.length > 0 && unreliable[0].successRate < 95) {
      parts.push(
        `Least reliable: ${unreliable[0].agentId} at ${unreliable[0].successRate}% success rate.`
      );
    }

    if (summary.alerts.length > 0) {
      const critical = summary.alerts.filter((a) => a.severity === 'critical');
      if (critical.length > 0) {
        parts.push(
          `Warning: ${critical.length} critical performance regressions detected.`
        );
      }
    }

    return parts.join(' ');
  }

  // ─── Serialization ──────────────────────────────────────────────────────

  /**
   * Export all profiler data for persistence.
   */
  exportData(): {
    samples: Record<string, InvocationSample[]>;
    baselines: Record<string, Baseline[]>;
  } {
    const samplesObj: Record<string, InvocationSample[]> = {};
    for (const [k, v] of this.samples) {
      samplesObj[k] = [...v];
    }
    const baselinesObj: Record<string, Baseline[]> = {};
    for (const [k, v] of this.baselines) {
      baselinesObj[k] = [...v];
    }
    return { samples: samplesObj, baselines: baselinesObj };
  }

  /**
   * Import previously exported data.
   */
  importData(data: {
    samples: Record<string, InvocationSample[]>;
    baselines: Record<string, Baseline[]>;
  }): void {
    for (const [agentId, samples] of Object.entries(data.samples)) {
      this.samples.set(agentId, [...samples]);
    }
    for (const [agentId, baselines] of Object.entries(data.baselines)) {
      this.baselines.set(agentId, [...baselines]);
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private calcLatencyStats(sortedDurations: number[]): LatencyStats {
    if (sortedDurations.length === 0) {
      return { count: 0, min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0, stdDev: 0 };
    }

    const n = sortedDurations.length;
    const sum = sortedDurations.reduce((a, b) => a + b, 0);
    const mean = sum / n;

    const variance =
      n > 1
        ? sortedDurations.reduce((acc, d) => acc + Math.pow(d - mean, 2), 0) / (n - 1)
        : 0;

    return {
      count: n,
      min: sortedDurations[0],
      max: sortedDurations[n - 1],
      mean: Math.round(mean * 100) / 100,
      median: sortedDurations[Math.floor(n / 2)],
      p95: sortedDurations[Math.floor(n * 0.95)],
      p99: sortedDurations[Math.floor(n * 0.99)],
      stdDev: Math.round(Math.sqrt(variance) * 100) / 100,
    };
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
      promise
        .then((val) => {
          clearTimeout(timer);
          resolve(val);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
