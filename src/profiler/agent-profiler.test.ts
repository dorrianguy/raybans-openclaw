/**
 * Tests for Agent Performance Profiler
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AgentProfiler,
  type ProfilerConfig,
  type InvocationSample,
  type BenchmarkResult,
  type RegressionAlert,
  type PipelineProfile,
  type AgentProfile,
} from './agent-profiler';

// ─── Helpers ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createProfiler(config: ProfilerConfig = {}): AgentProfiler {
  return new AgentProfiler(config);
}

function addSamples(
  profiler: AgentProfiler,
  agentId: string,
  count: number,
  opts: {
    durationRange?: [number, number];
    failRate?: number;
    inputTokens?: number;
    outputTokens?: number;
  } = {}
): void {
  const [minDur, maxDur] = opts.durationRange ?? [10, 100];
  const failRate = opts.failRate ?? 0;

  for (let i = 0; i < count; i++) {
    const dur = minDur + Math.random() * (maxDur - minDur);
    const success = Math.random() >= failRate;
    profiler.recordSample({
      agentId,
      timestamp: Date.now() + i,
      durationMs: Math.round(dur),
      success,
      error: success ? undefined : 'Simulated failure',
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      estimatedCost: opts.inputTokens
        ? ((opts.inputTokens ?? 0) / 1000) * 0.005 +
          ((opts.outputTokens ?? 0) / 1000) * 0.015
        : undefined,
    });
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('AgentProfiler', () => {
  let profiler: AgentProfiler;

  beforeEach(() => {
    profiler = createProfiler();
  });

  // ── Constructor & Config ──────────────────────────────────────────────

  describe('constructor', () => {
    it('creates with default config', () => {
      const p = createProfiler();
      expect(p).toBeDefined();
      expect(p.getTrackedAgents()).toEqual([]);
    });

    it('accepts custom config', () => {
      const p = createProfiler({
        maxSamplesPerAgent: 500,
        trackMemory: true,
        regressionThreshold: 30,
      });
      expect(p).toBeDefined();
    });
  });

  // ── Timer-Based Profiling ─────────────────────────────────────────────

  describe('startTimer / stopTimer', () => {
    it('records a successful invocation', () => {
      const timerId = profiler.startTimer('inventory');
      const sample = profiler.stopTimer(timerId, { success: true });

      expect(sample).not.toBeNull();
      expect(sample!.agentId).toBe('inventory');
      expect(sample!.success).toBe(true);
      expect(sample!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records a failed invocation with error', () => {
      const timerId = profiler.startTimer('inventory');
      const sample = profiler.stopTimer(timerId, {
        success: false,
        error: 'Vision model timeout',
      });

      expect(sample!.success).toBe(false);
      expect(sample!.error).toBe('Vision model timeout');
    });

    it('records token counts and estimates cost', () => {
      const timerId = profiler.startTimer('inventory');
      const sample = profiler.stopTimer(timerId, {
        success: true,
        inputTokens: 1000,
        outputTokens: 500,
      });

      expect(sample!.inputTokens).toBe(1000);
      expect(sample!.outputTokens).toBe(500);
      expect(sample!.estimatedCost).toBeGreaterThan(0);
      // Cost: (1000/1000)*0.005 + (500/1000)*0.015 = 0.005 + 0.0075 = 0.0125
      expect(sample!.estimatedCost).toBeCloseTo(0.0125, 4);
    });

    it('returns null for unknown timer ID', () => {
      const sample = profiler.stopTimer('nonexistent', { success: true });
      expect(sample).toBeNull();
    });

    it('records metadata', () => {
      const timerId = profiler.startTimer('security');
      const sample = profiler.stopTimer(timerId, {
        success: true,
        metadata: { scanType: 'qr', threatsFound: 2 },
      });

      expect(sample!.metadata).toEqual({
        scanType: 'qr',
        threatsFound: 2,
      });
    });

    it('emits sample event on stopTimer', () => {
      const handler = vi.fn();
      profiler.on('sample', handler);

      const timerId = profiler.startTimer('inventory');
      profiler.stopTimer(timerId, { success: true });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].agentId).toBe('inventory');
    });
  });

  // ── profile() wrapper ─────────────────────────────────────────────────

  describe('profile()', () => {
    it('wraps a successful async function', async () => {
      const { result, sample } = await profiler.profile('inventory', async () => {
        return 42;
      });

      expect(result).toBe(42);
      expect(sample.agentId).toBe('inventory');
      expect(sample.success).toBe(true);
    });

    it('wraps a failing async function', async () => {
      await expect(
        profiler.profile('inventory', async () => {
          throw new Error('Vision failed');
        })
      ).rejects.toThrow('Vision failed');

      const profile = profiler.getProfile('inventory');
      expect(profile!.failureCount).toBe(1);
    });

    it('passes metadata through', async () => {
      const { sample } = await profiler.profile(
        'meeting',
        async () => 'ok',
        { meetingId: 'mtg-123' }
      );

      expect(sample.metadata).toEqual({ meetingId: 'mtg-123' });
    });
  });

  // ── recordSample ──────────────────────────────────────────────────────

  describe('recordSample', () => {
    it('stores samples and retrieves them in profiles', () => {
      addSamples(profiler, 'inventory', 50);

      const profile = profiler.getProfile('inventory');
      expect(profile).not.toBeNull();
      expect(profile!.sampleCount).toBe(50);
    });

    it('enforces max samples per agent', () => {
      const p = createProfiler({ maxSamplesPerAgent: 100 });
      addSamples(p, 'inventory', 200);

      const profile = p.getProfile('inventory');
      expect(profile!.sampleCount).toBe(100);
    });

    it('tracks multiple agents independently', () => {
      addSamples(profiler, 'inventory', 30);
      addSamples(profiler, 'security', 20);
      addSamples(profiler, 'meeting', 10);

      expect(profiler.getTrackedAgents().length).toBe(3);
      expect(profiler.getProfile('inventory')!.sampleCount).toBe(30);
      expect(profiler.getProfile('security')!.sampleCount).toBe(20);
      expect(profiler.getProfile('meeting')!.sampleCount).toBe(10);
    });
  });

  // ── getProfile ────────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('returns null for untracked agent', () => {
      expect(profiler.getProfile('nonexistent')).toBeNull();
    });

    it('calculates latency statistics correctly', () => {
      // Add deterministic samples
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (const d of durations) {
        profiler.recordSample({
          agentId: 'test',
          timestamp: Date.now(),
          durationMs: d,
          success: true,
        });
      }

      const profile = profiler.getProfile('test')!;
      expect(profile.latency.min).toBe(10);
      expect(profile.latency.max).toBe(100);
      expect(profile.latency.mean).toBe(55);
      expect(profile.latency.median).toBe(60); // index 5 of sorted 10 items
      expect(profile.latency.count).toBe(10);
    });

    it('tracks success rate correctly', () => {
      addSamples(profiler, 'flaky', 100, { failRate: 0.3 });

      const profile = profiler.getProfile('flaky')!;
      // With random failure rate, success rate should be roughly 70%
      expect(profile.successRate).toBeGreaterThan(0.5);
      expect(profile.successRate).toBeLessThan(0.9);
      expect(profile.successCount + profile.failureCount).toBe(100);
    });

    it('calculates cost correctly', () => {
      addSamples(profiler, 'expensive', 10, {
        inputTokens: 2000,
        outputTokens: 1000,
      });

      const profile = profiler.getProfile('expensive')!;
      expect(profile.cost.totalInputTokens).toBe(20000);
      expect(profile.cost.totalOutputTokens).toBe(10000);
      expect(profile.cost.totalEstimated).toBeGreaterThan(0);
      // Per sample: (2000/1000)*0.005 + (1000/1000)*0.015 = 0.01 + 0.015 = 0.025
      // Total: 0.025 * 10 = 0.25
      expect(profile.cost.totalEstimated).toBeCloseTo(0.25, 2);
    });

    it('respects sinceMs filter', () => {
      const now = Date.now();

      for (let i = 0; i < 10; i++) {
        profiler.recordSample({
          agentId: 'test',
          timestamp: now - 10000 + i * 100,
          durationMs: 50,
          success: true,
        });
      }
      for (let i = 0; i < 5; i++) {
        profiler.recordSample({
          agentId: 'test',
          timestamp: now + i * 100,
          durationMs: 100,
          success: true,
        });
      }

      const recentProfile = profiler.getProfile('test', now - 1);
      expect(recentProfile!.sampleCount).toBe(5);
      expect(recentProfile!.latency.mean).toBe(100);
    });

    it('calculates time range correctly', () => {
      const now = Date.now();
      profiler.recordSample({
        agentId: 'test',
        timestamp: now - 5000,
        durationMs: 10,
        success: true,
      });
      profiler.recordSample({
        agentId: 'test',
        timestamp: now,
        durationMs: 20,
        success: true,
      });

      const profile = profiler.getProfile('test')!;
      expect(profile.timeRange.firstSample).toBe(now - 5000);
      expect(profile.timeRange.lastSample).toBe(now);
      expect(profile.timeRange.spanMs).toBe(5000);
    });
  });

  // ── getAllProfiles ─────────────────────────────────────────────────────

  describe('getAllProfiles', () => {
    it('returns profiles sorted by sample count descending', () => {
      addSamples(profiler, 'small', 10);
      addSamples(profiler, 'large', 100);
      addSamples(profiler, 'medium', 50);

      const profiles = profiler.getAllProfiles();
      expect(profiles.length).toBe(3);
      expect(profiles[0].agentId).toBe('large');
      expect(profiles[1].agentId).toBe('medium');
      expect(profiles[2].agentId).toBe('small');
    });

    it('returns empty array when no data', () => {
      expect(profiler.getAllProfiles()).toEqual([]);
    });
  });

  // ── Ranking Queries ───────────────────────────────────────────────────

  describe('getSlowest', () => {
    it('returns agents ordered by median latency', () => {
      addSamples(profiler, 'fast', 50, { durationRange: [5, 15] });
      addSamples(profiler, 'slow', 50, { durationRange: [500, 1000] });
      addSamples(profiler, 'medium', 50, { durationRange: [100, 200] });

      const slowest = profiler.getSlowest(3);
      expect(slowest.length).toBe(3);
      expect(slowest[0].agentId).toBe('slow');
      expect(slowest[0].medianMs).toBeGreaterThan(400);
    });

    it('respects limit', () => {
      addSamples(profiler, 'a', 20);
      addSamples(profiler, 'b', 20);
      addSamples(profiler, 'c', 20);

      const result = profiler.getSlowest(1);
      expect(result.length).toBe(1);
    });
  });

  describe('getMostUnreliable', () => {
    it('returns agents with lowest success rate', () => {
      addSamples(profiler, 'reliable', 50, { failRate: 0.02 });
      addSamples(profiler, 'flaky', 50, { failRate: 0.5 });
      addSamples(profiler, 'broken', 50, { failRate: 0.9 });

      const unreliable = profiler.getMostUnreliable(3);
      expect(unreliable[0].agentId).toBe('broken');
    });

    it('skips agents with fewer than 10 samples', () => {
      addSamples(profiler, 'few', 5, { failRate: 1.0 });
      addSamples(profiler, 'enough', 15, { failRate: 0.5 });

      const unreliable = profiler.getMostUnreliable(5);
      expect(unreliable.length).toBe(1);
      expect(unreliable[0].agentId).toBe('enough');
    });
  });

  describe('getMostExpensive', () => {
    it('returns agents by total cost', () => {
      addSamples(profiler, 'cheap', 100, {
        inputTokens: 100,
        outputTokens: 50,
      });
      addSamples(profiler, 'expensive', 100, {
        inputTokens: 5000,
        outputTokens: 3000,
      });

      const expensive = profiler.getMostExpensive(2);
      expect(expensive[0].agentId).toBe('expensive');
      expect(expensive[0].totalCost).toBeGreaterThan(expensive[1].totalCost);
    });
  });

  // ── Benchmarking ──────────────────────────────────────────────────────

  describe('benchmark', () => {
    it('runs sequential benchmark', async () => {
      const result = await profiler.benchmark(
        'inventory',
        async (i) => {
          // Simulate work
          await sleep(1);
        },
        { warmup: 1, iterations: 10 }
      );

      expect(result.agentId).toBe('inventory');
      expect(result.latency.count).toBe(10);
      expect(result.successRate).toBe(1);
      expect(result.throughput).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);
    });

    it('records failures in benchmark', async () => {
      let callCount = 0;
      const result = await profiler.benchmark(
        'flaky',
        async () => {
          callCount++;
          if (callCount % 3 === 0) throw new Error('Simulated fail');
        },
        { warmup: 0, iterations: 9 }
      );

      expect(result.errors.length).toBe(3);
      expect(result.successRate).toBeCloseTo(6 / 9, 2);
    });

    it('runs concurrent benchmark', async () => {
      const result = await profiler.benchmark(
        'concurrent',
        async () => {
          await sleep(5);
        },
        { warmup: 0, iterations: 8, concurrency: 4 }
      );

      expect(result.latency.count).toBe(8);
      // With concurrency 4, total time should be less than 8 * 5ms
      expect(result.totalDurationMs).toBeLessThan(8 * 5 + 100);
    });

    it('emits benchmark event', async () => {
      const handler = vi.fn();
      profiler.on('benchmark', handler);

      await profiler.benchmark('test', async () => {}, {
        warmup: 0,
        iterations: 5,
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('uses default config when none provided', async () => {
      const result = await profiler.benchmark('test', async () => {}, {
        warmup: 0,
        iterations: 5,
      });

      expect(result.config.warmup).toBe(0);
      expect(result.config.iterations).toBe(5);
      expect(result.config.concurrency).toBe(1);
      expect(result.config.timeoutMs).toBe(30000);
    });
  });

  // ── Baselines & Regression ────────────────────────────────────────────

  describe('baselines', () => {
    it('saves a baseline from current data', () => {
      addSamples(profiler, 'inventory', 100);
      const baseline = profiler.saveBaseline('inventory', 'v1.0');

      expect(baseline).not.toBeNull();
      expect(baseline!.label).toBe('v1.0');
      expect(baseline!.profile.sampleCount).toBe(100);
    });

    it('returns null when saving baseline for untracked agent', () => {
      expect(profiler.saveBaseline('nonexistent', 'v1')).toBeNull();
    });

    it('retrieves saved baselines', () => {
      addSamples(profiler, 'inventory', 50);
      profiler.saveBaseline('inventory', 'v1.0');
      profiler.saveBaseline('inventory', 'v1.1');

      const baselines = profiler.getBaselines('inventory');
      expect(baselines.length).toBe(2);
      expect(baselines[0].label).toBe('v1.0');
      expect(baselines[1].label).toBe('v1.1');
    });

    it('returns empty for agent with no baselines', () => {
      expect(profiler.getBaselines('none')).toEqual([]);
    });
  });

  describe('compareToBaseline', () => {
    it('compares current performance against a baseline', () => {
      // Fast baseline
      for (let i = 0; i < 50; i++) {
        profiler.recordSample({
          agentId: 'inventory',
          timestamp: Date.now() + i,
          durationMs: 50,
          success: true,
          inputTokens: 100,
          outputTokens: 50,
          estimatedCost: 0.00125,
        });
      }
      profiler.saveBaseline('inventory', 'fast');

      // Slower samples
      for (let i = 0; i < 50; i++) {
        profiler.recordSample({
          agentId: 'inventory',
          timestamp: Date.now() + 1000 + i,
          durationMs: 200,
          success: true,
          inputTokens: 100,
          outputTokens: 50,
          estimatedCost: 0.00125,
        });
      }

      const comparison = profiler.compareToBaseline('inventory', 'fast');
      expect(comparison).not.toBeNull();

      const latencyChange = comparison!.changes.find(
        (c) => c.metric === 'latency_median'
      );
      expect(latencyChange).toBeDefined();
      expect(latencyChange!.changePercent).toBeGreaterThan(0); // Got slower
      expect(latencyChange!.improved).toBe(false);
    });

    it('returns null for unknown baseline', () => {
      addSamples(profiler, 'inventory', 50);
      expect(profiler.compareToBaseline('inventory', 'nonexistent')).toBeNull();
    });

    it('returns null for untracked agent', () => {
      expect(profiler.compareToBaseline('nonexistent', 'v1')).toBeNull();
    });
  });

  describe('regression detection', () => {
    it('emits regression alert when performance degrades', () => {
      const p = createProfiler({
        regressionThreshold: 20,
        regressionMinSamples: 10,
      });
      const alerts: RegressionAlert[] = [];
      p.on('regression', (alert: RegressionAlert) => alerts.push(alert));

      // Fast baseline
      for (let i = 0; i < 20; i++) {
        p.recordSample({
          agentId: 'inv',
          timestamp: Date.now() + i,
          durationMs: 50,
          success: true,
        });
      }
      p.saveBaseline('inv', 'baseline');

      // Much slower
      for (let i = 0; i < 20; i++) {
        p.recordSample({
          agentId: 'inv',
          timestamp: Date.now() + 1000 + i,
          durationMs: 500,
          success: true,
        });
      }

      // Should have latency regression alerts
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].agentId).toBe('inv');
      expect(alerts[0].metric).toContain('latency');
    });

    it('does not emit when below threshold', () => {
      const p = createProfiler({
        regressionThreshold: 50,
        regressionMinSamples: 10,
      });
      const alerts: RegressionAlert[] = [];
      p.on('regression', (a: RegressionAlert) => alerts.push(a));

      for (let i = 0; i < 20; i++) {
        p.recordSample({
          agentId: 'inv',
          timestamp: Date.now() + i,
          durationMs: 50,
          success: true,
        });
      }
      p.saveBaseline('inv', 'baseline');

      // Only slightly slower (10%)
      for (let i = 0; i < 20; i++) {
        p.recordSample({
          agentId: 'inv',
          timestamp: Date.now() + 1000 + i,
          durationMs: 55,
          success: true,
        });
      }

      expect(alerts.length).toBe(0);
    });

    it('does not check when below min samples', () => {
      const p = createProfiler({
        regressionMinSamples: 100,
      });
      const alerts: RegressionAlert[] = [];
      p.on('regression', (a: RegressionAlert) => alerts.push(a));

      addSamples(p, 'inv', 20);
      p.saveBaseline('inv', 'baseline');
      addSamples(p, 'inv', 20);

      // Only 40 samples, min is 100
      expect(alerts.length).toBe(0);
    });
  });

  // ── Pipeline Profiling ────────────────────────────────────────────────

  describe('profilePipeline', () => {
    it('profiles a multi-stage pipeline', async () => {
      const result = await profiler.profilePipeline('inventory-flow', [
        {
          name: 'capture',
          agentId: 'camera',
          fn: async () => { await sleep(2); },
        },
        {
          name: 'analyze',
          agentId: 'vision',
          fn: async () => { await sleep(50); },
        },
        {
          name: 'store',
          agentId: 'persistence',
          fn: async () => { await sleep(2); },
        },
      ]);

      expect(result.name).toBe('inventory-flow');
      expect(result.stages.length).toBe(3);
      expect(result.totalDurationMs).toBeGreaterThan(50);
      expect(result.bottleneck.name).toBe('analyze');
      expect(result.bottleneckPercent).toBeGreaterThan(50);
    });

    it('identifies correct bottleneck', async () => {
      const result = await profiler.profilePipeline('test', [
        {
          name: 'fast',
          agentId: 'a',
          fn: async () => { await sleep(1); },
        },
        {
          name: 'bottleneck',
          agentId: 'b',
          fn: async () => { await sleep(20); },
        },
      ]);

      expect(result.bottleneck.name).toBe('bottleneck');
    });

    it('emits pipeline event', async () => {
      const handler = vi.fn();
      profiler.on('pipeline', handler);

      await profiler.profilePipeline('test', [
        { name: 's1', agentId: 'a', fn: async () => {} },
      ]);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Maintenance ───────────────────────────────────────────────────────

  describe('trimOldSamples', () => {
    it('removes samples older than retention', () => {
      const p = createProfiler({ retentionMs: 60000 }); // 1 minute

      // Old samples
      for (let i = 0; i < 10; i++) {
        p.recordSample({
          agentId: 'inventory',
          timestamp: Date.now() - 120000 + i,
          durationMs: 50,
          success: true,
        });
      }
      // Recent samples
      for (let i = 0; i < 5; i++) {
        p.recordSample({
          agentId: 'inventory',
          timestamp: Date.now() + i,
          durationMs: 50,
          success: true,
        });
      }

      const trimmed = p.trimOldSamples();
      expect(trimmed).toBe(10);
      expect(p.getProfile('inventory')!.sampleCount).toBe(5);
    });

    it('returns 0 when nothing to trim', () => {
      addSamples(profiler, 'inventory', 10);
      expect(profiler.trimOldSamples()).toBe(0);
    });
  });

  describe('clearAgent', () => {
    it('clears all data for a specific agent', () => {
      addSamples(profiler, 'inventory', 50);
      addSamples(profiler, 'security', 30);
      profiler.saveBaseline('inventory', 'v1');

      profiler.clearAgent('inventory');

      expect(profiler.getProfile('inventory')).toBeNull();
      expect(profiler.getBaselines('inventory')).toEqual([]);
      expect(profiler.getProfile('security')!.sampleCount).toBe(30);
    });
  });

  describe('clearAll', () => {
    it('clears all profiler data', () => {
      addSamples(profiler, 'inventory', 50);
      addSamples(profiler, 'security', 30);
      profiler.saveBaseline('inventory', 'v1');

      profiler.clearAll();

      expect(profiler.getTrackedAgents()).toEqual([]);
      expect(profiler.getAllProfiles()).toEqual([]);
    });
  });

  // ── Dashboard Summary ─────────────────────────────────────────────────

  describe('getDashboardSummary', () => {
    it('returns summary of all agents', () => {
      addSamples(profiler, 'inventory', 100, {
        inputTokens: 1000,
        outputTokens: 500,
      });
      addSamples(profiler, 'security', 50, { failRate: 0.1 });

      const summary = profiler.getDashboardSummary();
      expect(summary.totalAgents).toBe(2);
      expect(summary.totalSamples).toBe(150);
      expect(summary.totalCost).toBeGreaterThan(0);
      expect(summary.overallSuccessRate).toBeGreaterThan(0.9);
      expect(summary.agents.length).toBe(2);
    });

    it('handles empty state', () => {
      const summary = profiler.getDashboardSummary();
      expect(summary.totalAgents).toBe(0);
      expect(summary.totalSamples).toBe(0);
      expect(summary.overallSuccessRate).toBe(1);
      expect(summary.alerts).toEqual([]);
    });

    it('includes regression alerts', () => {
      // Create baseline then regress
      for (let i = 0; i < 50; i++) {
        profiler.recordSample({
          agentId: 'inv',
          timestamp: Date.now() + i,
          durationMs: 50,
          success: true,
        });
      }
      profiler.saveBaseline('inv', 'v1');

      for (let i = 0; i < 50; i++) {
        profiler.recordSample({
          agentId: 'inv',
          timestamp: Date.now() + 1000 + i,
          durationMs: 500,
          success: true,
        });
      }

      const summary = profiler.getDashboardSummary();
      expect(summary.alerts.length).toBeGreaterThan(0);
    });
  });

  // ── Voice Summary ─────────────────────────────────────────────────────

  describe('getVoiceSummary', () => {
    it('returns readable summary', () => {
      addSamples(profiler, 'inventory', 100, { durationRange: [100, 500] });
      addSamples(profiler, 'security', 50, { failRate: 0.3, durationRange: [50, 200] });

      const summary = profiler.getVoiceSummary();
      expect(summary).toContain('Tracking 2 agents');
      expect(summary).toContain('150 total invocations');
      expect(summary).toContain('success rate');
    });

    it('handles empty state', () => {
      expect(profiler.getVoiceSummary()).toBe(
        'No agent performance data collected yet.'
      );
    });

    it('mentions slow agents', () => {
      addSamples(profiler, 'slow', 50, { durationRange: [1000, 5000] });
      addSamples(profiler, 'fast', 50, { durationRange: [5, 15] });

      const summary = profiler.getVoiceSummary();
      expect(summary).toContain('Slowest agent: slow');
    });
  });

  // ── Serialization ─────────────────────────────────────────────────────

  describe('export / import', () => {
    it('exports and re-imports data correctly', () => {
      addSamples(profiler, 'inventory', 50);
      addSamples(profiler, 'security', 30);
      profiler.saveBaseline('inventory', 'v1');

      const data = profiler.exportData();

      const newProfiler = createProfiler();
      newProfiler.importData(data);

      expect(newProfiler.getProfile('inventory')!.sampleCount).toBe(50);
      expect(newProfiler.getProfile('security')!.sampleCount).toBe(30);
      expect(newProfiler.getBaselines('inventory').length).toBe(1);
    });
  });

  // ── Sample Counts ─────────────────────────────────────────────────────

  describe('getSampleCounts', () => {
    it('returns counts per agent', () => {
      addSamples(profiler, 'inventory', 50);
      addSamples(profiler, 'security', 30);

      const counts = profiler.getSampleCounts();
      expect(counts.inventory).toBe(50);
      expect(counts.security).toBe(30);
    });

    it('returns empty object when no data', () => {
      expect(profiler.getSampleCounts()).toEqual({});
    });
  });

  // ── Memory Tracking ───────────────────────────────────────────────────

  describe('memory tracking', () => {
    it('tracks memory when enabled', () => {
      const p = createProfiler({ trackMemory: true });
      const timerId = p.startTimer('inventory');
      const sample = p.stopTimer(timerId, { success: true });

      // In a test environment, process.memoryUsage should be available
      if (typeof process !== 'undefined' && process.memoryUsage) {
        expect(sample!.memoryBefore).toBeDefined();
        expect(sample!.memoryAfter).toBeDefined();
        expect(sample!.memoryDelta).toBeDefined();
      }
    });

    it('does not track memory when disabled', () => {
      const p = createProfiler({ trackMemory: false });
      const timerId = p.startTimer('inventory');
      const sample = p.stopTimer(timerId, { success: true });

      expect(sample!.memoryBefore).toBeUndefined();
      expect(sample!.memoryAfter).toBeUndefined();
    });

    it('includes memory stats in profile when tracked', () => {
      const p = createProfiler({ trackMemory: true });

      for (let i = 0; i < 10; i++) {
        const timerId = p.startTimer('inventory');
        p.stopTimer(timerId, { success: true });
      }

      const profile = p.getProfile('inventory')!;
      if (typeof process !== 'undefined' && process.memoryUsage) {
        expect(profile.memory).not.toBeNull();
      }
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles single sample profile', () => {
      profiler.recordSample({
        agentId: 'single',
        timestamp: Date.now(),
        durationMs: 42,
        success: true,
      });

      const profile = profiler.getProfile('single')!;
      expect(profile.latency.min).toBe(42);
      expect(profile.latency.max).toBe(42);
      expect(profile.latency.mean).toBe(42);
      expect(profile.latency.median).toBe(42);
      expect(profile.latency.stdDev).toBe(0);
    });

    it('handles all-failure agent', () => {
      addSamples(profiler, 'broken', 20, { failRate: 1.0 });

      const profile = profiler.getProfile('broken')!;
      expect(profile.successRate).toBe(0);
      expect(profile.failureCount).toBe(20);
    });

    it('handles zero-duration samples', () => {
      for (let i = 0; i < 5; i++) {
        profiler.recordSample({
          agentId: 'instant',
          timestamp: Date.now() + i,
          durationMs: 0,
          success: true,
        });
      }

      const profile = profiler.getProfile('instant')!;
      expect(profile.latency.min).toBe(0);
      expect(profile.latency.mean).toBe(0);
    });

    it('handles concurrent timers for same agent', () => {
      const t1 = profiler.startTimer('inventory');
      const t2 = profiler.startTimer('inventory');
      const t3 = profiler.startTimer('inventory');

      profiler.stopTimer(t2, { success: true });
      profiler.stopTimer(t1, { success: false, error: 'timeout' });
      profiler.stopTimer(t3, { success: true });

      const profile = profiler.getProfile('inventory')!;
      expect(profile.sampleCount).toBe(3);
      expect(profile.successCount).toBe(2);
      expect(profile.failureCount).toBe(1);
    });

    it('handles rapid sample recording', () => {
      for (let i = 0; i < 1000; i++) {
        profiler.recordSample({
          agentId: 'rapid',
          timestamp: Date.now(),
          durationMs: Math.random() * 100,
          success: true,
        });
      }

      const profile = profiler.getProfile('rapid')!;
      expect(profile.sampleCount).toBe(1000);
    });
  });
});
