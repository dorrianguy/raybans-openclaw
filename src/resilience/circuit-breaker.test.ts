/**
 * Tests for Circuit Breaker & Error Recovery Engine
 * 🌙 Night Shift Agent — 2026-03-04
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CircuitBreaker,
  RetryExecutor,
  ResiliencePipeline,
  ResilienceRegistry,
  ResilienceProfiles,
  CircuitOpenError,
  BulkheadFullError,
  CallTimeoutError,
} from './circuit-breaker.js';

// ─── Helper Functions ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const successFn = async () => 'ok';
const failFn = async () => {
  throw new Error('boom');
};
const slowFn = (ms: number) => () => new Promise((resolve) => setTimeout(() => resolve('slow'), ms));

// ─── CircuitBreaker Tests ────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  afterEach(() => {
    if (breaker) breaker.destroy();
  });

  describe('Basic State Transitions', () => {
    it('should start in closed state', () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      });
      expect(breaker.getState()).toBe('closed');
    });

    it('should allow calls when closed', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      });
      const result = await breaker.execute(successFn);
      expect(result).toBe('ok');
    });

    it('should open after reaching failure threshold', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 3,
        resetTimeoutMs: 5000,
      });

      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failFn);
        } catch {}
      }

      expect(breaker.getState()).toBe('open');
    });

    it('should reject calls when open', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });

      // Trip the breaker
      for (let i = 0; i < 2; i++) {
        try { await breaker.execute(failFn); } catch {}
      }

      await expect(breaker.execute(successFn)).rejects.toThrow(CircuitOpenError);
    });

    it('should transition to half-open after reset timeout', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 100,
      });

      // Trip the breaker
      for (let i = 0; i < 2; i++) {
        try { await breaker.execute(failFn); } catch {}
      }
      expect(breaker.getState()).toBe('open');

      // Wait for reset timeout
      await sleep(150);

      // Next call should go through (half-open)
      const result = await breaker.execute(successFn);
      expect(result).toBe('ok');
    });

    it('should close after enough successes in half-open', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 100,
        halfOpenSuccessThreshold: 2,
      });

      // Trip the breaker
      for (let i = 0; i < 2; i++) {
        try { await breaker.execute(failFn); } catch {}
      }

      // Wait for half-open
      await sleep(150);

      // Successful calls in half-open
      await breaker.execute(successFn);
      await breaker.execute(successFn);

      expect(breaker.getState()).toBe('closed');
    });

    it('should go back to open on failure in half-open', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 100,
        halfOpenSuccessThreshold: 3,
      });

      // Trip the breaker
      for (let i = 0; i < 2; i++) {
        try { await breaker.execute(failFn); } catch {}
      }

      // Wait for half-open
      await sleep(150);

      // Fail in half-open
      try { await breaker.execute(failFn); } catch {}

      expect(breaker.getState()).toBe('open');
    });
  });

  describe('Failure Rate Threshold', () => {
    it('should open based on failure rate when minimum calls met', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 100, // high count threshold
        failureRateThreshold: 0.5, // 50% failure rate
        minimumCalls: 4,
        resetTimeoutMs: 5000,
        slidingWindowSize: 10,
      });

      // 2 success + 3 fails = 60% failure rate > 50%
      await breaker.execute(successFn);
      await breaker.execute(successFn);
      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(failFn); } catch {}

      expect(breaker.getState()).toBe('open');
    });

    it('should NOT open if minimum calls not met', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 100,
        failureRateThreshold: 0.5,
        minimumCalls: 10,
        resetTimeoutMs: 5000,
        slidingWindowSize: 10,
      });

      // Only 3 calls total (below min 10)
      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(failFn); } catch {}

      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('Timeout', () => {
    it('should timeout slow calls', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 5,
        resetTimeoutMs: 5000,
        callTimeoutMs: 50,
      });

      await expect(breaker.execute(slowFn(200))).rejects.toThrow(CallTimeoutError);
    });

    it('should not timeout fast calls', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 5,
        resetTimeoutMs: 5000,
        callTimeoutMs: 500,
      });

      const result = await breaker.execute(slowFn(10));
      expect(result).toBe('slow');
    });

    it('should count timeouts as failures', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
        callTimeoutMs: 50,
      });

      try { await breaker.execute(slowFn(200)); } catch {}
      try { await breaker.execute(slowFn(200)); } catch {}

      expect(breaker.getState()).toBe('open');
      const metrics = breaker.getMetrics();
      expect(metrics.timedOutCalls).toBe(2);
    });
  });

  describe('Bulkhead', () => {
    it('should reject when max concurrent reached', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 10,
        resetTimeoutMs: 5000,
        maxConcurrent: 2,
        callTimeoutMs: 5000,
      });

      // Start 2 slow calls
      const p1 = breaker.execute(slowFn(200));
      const p2 = breaker.execute(slowFn(200));

      // Third should be rejected
      await expect(breaker.execute(successFn)).rejects.toThrow(BulkheadFullError);

      await Promise.all([p1, p2]);
    });

    it('should allow calls after concurrent ones complete', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 10,
        resetTimeoutMs: 5000,
        maxConcurrent: 1,
        callTimeoutMs: 5000,
      });

      const result1 = await breaker.execute(successFn);
      const result2 = await breaker.execute(successFn);

      expect(result1).toBe('ok');
      expect(result2).toBe('ok');
    });
  });

  describe('Fallback', () => {
    it('should use primary fallback when circuit is open', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });

      // Trip the breaker
      for (let i = 0; i < 2; i++) {
        try { await breaker.execute(failFn); } catch {}
      }

      const result = await breaker.execute(failFn, {
        primary: () => 'fallback-result',
      });

      expect(result).toBe('fallback-result');
    });

    it('should use secondary fallback when primary fails', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });

      // Trip the breaker
      for (let i = 0; i < 2; i++) {
        try { await breaker.execute(failFn); } catch {}
      }

      const result = await breaker.execute(failFn, {
        primary: () => { throw new Error('primary failed'); },
        secondary: () => 'secondary-result',
      });

      expect(result).toBe('secondary-result');
    });

    it('should use default value when all fallbacks fail', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });

      // Trip the breaker
      for (let i = 0; i < 2; i++) {
        try { await breaker.execute(failFn); } catch {}
      }

      const result = await breaker.execute(failFn, {
        primary: () => { throw new Error('nope'); },
        defaultValue: 'default',
      });

      expect(result).toBe('default');
    });

    it('should use cached result as fallback', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });

      // Cache a result
      await breaker.execute(async () => 'cached-value');

      // Trip the breaker
      for (let i = 0; i < 2; i++) {
        try { await breaker.execute(failFn); } catch {}
      }

      const result = await breaker.execute(failFn, {
        useCachedResult: true,
      });

      expect(result).toBe('cached-value');
    });

    it('should use fallback on execution failure (circuit closed)', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 10,
        resetTimeoutMs: 5000,
      });

      const result = await breaker.execute(failFn, {
        primary: () => 'fallback',
      });

      expect(result).toBe('fallback');
    });
  });

  describe('Ignored Errors', () => {
    it('should not count ignored errors as failures', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
        ignoreErrors: (err) => err.message === 'ignored',
      });

      try {
        await breaker.execute(async () => { throw new Error('ignored'); });
      } catch {}
      try {
        await breaker.execute(async () => { throw new Error('ignored'); });
      } catch {}
      try {
        await breaker.execute(async () => { throw new Error('ignored'); });
      } catch {}

      // Should still be closed because errors were ignored
      expect(breaker.getState()).toBe('closed');
      expect(breaker.getMetrics().failedCalls).toBe(0);
    });
  });

  describe('Force Controls', () => {
    it('should force open', () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 10,
        resetTimeoutMs: 5000,
      });

      breaker.forceOpen();
      expect(breaker.getState()).toBe('open');
    });

    it('should force closed', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });

      // Trip it
      for (let i = 0; i < 2; i++) {
        try { await breaker.execute(failFn); } catch {}
      }
      expect(breaker.getState()).toBe('open');

      breaker.forceClosed();
      expect(breaker.getState()).toBe('closed');

      // Should accept calls again
      const result = await breaker.execute(successFn);
      expect(result).toBe('ok');
    });

    it('should reset all state', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });

      await breaker.execute(successFn);
      try { await breaker.execute(failFn); } catch {}

      breaker.reset();
      const metrics = breaker.getMetrics();

      expect(metrics.state).toBe('closed');
      expect(metrics.totalCalls).toBe(0);
      expect(metrics.successfulCalls).toBe(0);
      expect(metrics.failedCalls).toBe(0);
    });
  });

  describe('Metrics', () => {
    it('should track call counts', async () => {
      breaker = new CircuitBreaker({
        name: 'test-metrics',
        failureThreshold: 10,
        resetTimeoutMs: 5000,
      });

      await breaker.execute(successFn);
      await breaker.execute(successFn);
      try { await breaker.execute(failFn); } catch {}

      const metrics = breaker.getMetrics();
      expect(metrics.name).toBe('test-metrics');
      expect(metrics.totalCalls).toBe(3);
      expect(metrics.successfulCalls).toBe(2);
      expect(metrics.failedCalls).toBe(1);
    });

    it('should track consecutive failures', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 10,
        resetTimeoutMs: 5000,
      });

      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(failFn); } catch {}
      await breaker.execute(successFn);
      try { await breaker.execute(failFn); } catch {}

      const metrics = breaker.getMetrics();
      expect(metrics.consecutiveFailures).toBe(1);
      expect(metrics.consecutiveSuccesses).toBe(0);
    });

    it('should calculate failure rate', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 100,
        resetTimeoutMs: 5000,
        slidingWindowSize: 10,
      });

      await breaker.execute(successFn);
      try { await breaker.execute(failFn); } catch {}
      await breaker.execute(successFn);
      try { await breaker.execute(failFn); } catch {}

      const metrics = breaker.getMetrics();
      expect(metrics.failureRate).toBe(0.5); // 2 out of 4
    });

    it('should track response times', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 10,
        resetTimeoutMs: 5000,
        callTimeoutMs: 5000,
      });

      await breaker.execute(slowFn(10));
      await breaker.execute(slowFn(20));

      const metrics = breaker.getMetrics();
      expect(metrics.averageResponseTimeMs).toBeGreaterThan(0);
      expect(metrics.p95ResponseTimeMs).toBeGreaterThan(0);
    });

    it('should track state changes', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 100,
      });

      // Trip it
      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(failFn); } catch {}

      const metrics = breaker.getMetrics();
      expect(metrics.stateChanges.length).toBe(1);
      expect(metrics.stateChanges[0].from).toBe('closed');
      expect(metrics.stateChanges[0].to).toBe('open');
      expect(metrics.openCount).toBe(1);
    });

    it('should track rejected calls', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });

      // Trip the breaker
      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(failFn); } catch {}

      // Rejected calls
      try { await breaker.execute(successFn); } catch {}
      try { await breaker.execute(successFn); } catch {}

      const metrics = breaker.getMetrics();
      expect(metrics.rejectedCalls).toBe(2);
    });

    it('should track bulkhead rejections', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 10,
        resetTimeoutMs: 5000,
        maxConcurrent: 1,
        callTimeoutMs: 5000,
      });

      const slow = breaker.execute(slowFn(200));
      try { await breaker.execute(successFn); } catch {}

      const metrics = breaker.getMetrics();
      expect(metrics.bulkhead.rejectedCalls).toBe(1);

      await slow;
    });
  });

  describe('Events', () => {
    it('should emit success events', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 5,
        resetTimeoutMs: 5000,
      });

      const handler = vi.fn();
      breaker.on('success', handler);

      await breaker.execute(successFn);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test',
          state: 'closed',
        })
      );
    });

    it('should emit failure events', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 5,
        resetTimeoutMs: 5000,
      });

      const handler = vi.fn();
      breaker.on('failure', handler);

      try { await breaker.execute(failFn); } catch {}

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test',
          consecutiveFailures: 1,
        })
      );
    });

    it('should emit state-change events', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });

      const handler = vi.fn();
      breaker.on('state-change', handler);

      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(failFn); } catch {}

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test',
          from: 'closed',
          to: 'open',
        })
      );
    });

    it('should emit rejected events', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });

      const handler = vi.fn();
      breaker.on('rejected', handler);

      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(successFn); } catch {}

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit fallback events', async () => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 10,
        resetTimeoutMs: 5000,
      });

      const handler = vi.fn();
      breaker.on('fallback:primary', handler);

      await breaker.execute(failFn, { primary: () => 'fb' });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── RetryExecutor Tests ─────────────────────────────────────────────────────

describe('RetryExecutor', () => {
  it('should succeed on first attempt', async () => {
    const retry = new RetryExecutor({
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      jitter: false,
    });

    const result = await retry.execute(successFn);
    expect(result).toBe('ok');
  });

  it('should retry on failure', async () => {
    let attempts = 0;
    const retry = new RetryExecutor({
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      jitter: false,
    });

    const fn = async () => {
      attempts++;
      if (attempts < 3) throw new Error('not yet');
      return 'finally';
    };

    const result = await retry.execute(fn);
    expect(result).toBe('finally');
    expect(attempts).toBe(3);
  });

  it('should throw after max retries', async () => {
    const retry = new RetryExecutor({
      maxAttempts: 2,
      initialDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      jitter: false,
    });

    await expect(retry.execute(failFn)).rejects.toThrow('boom');
  });

  it('should not retry non-retryable errors', async () => {
    let attempts = 0;
    const retry = new RetryExecutor({
      maxAttempts: 5,
      initialDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      jitter: false,
      nonRetryableErrors: (err) => err.message === 'fatal',
    });

    const fn = async () => {
      attempts++;
      throw new Error('fatal');
    };

    await expect(retry.execute(fn)).rejects.toThrow('fatal');
    expect(attempts).toBe(1);
  });

  it('should call onRetry callback', async () => {
    const onRetry = vi.fn();
    const retry = new RetryExecutor({
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      jitter: false,
      onRetry,
    });

    try { await retry.execute(failFn); } catch {}

    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error), expect.any(Number));
    expect(onRetry).toHaveBeenCalledWith(3, expect.any(Error), expect.any(Number));
  });

  it('should apply exponential backoff', async () => {
    const delays: number[] = [];
    const retry = new RetryExecutor({
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      jitter: false,
      onRetry: (_attempt, _err, delay) => delays.push(delay),
    });

    try { await retry.execute(failFn); } catch {}

    // Without jitter: 100, 200, 400
    expect(delays[0]).toBe(100);
    expect(delays[1]).toBe(200);
    expect(delays[2]).toBe(400);
  });

  it('should cap delay at maxDelayMs', async () => {
    const delays: number[] = [];
    const retry = new RetryExecutor({
      maxAttempts: 5,
      initialDelayMs: 100,
      maxDelayMs: 300,
      backoffMultiplier: 3,
      jitter: false,
      onRetry: (_attempt, _err, delay) => delays.push(delay),
    });

    try { await retry.execute(failFn); } catch {}

    // 100, 300(capped), 300(capped), 300(capped), 300(capped)
    expect(delays[0]).toBe(100);
    expect(delays[1]).toBe(300);
    expect(delays[2]).toBe(300);
  });

  it('should apply jitter when enabled', async () => {
    const delays: number[] = [];
    const retry = new RetryExecutor({
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      jitter: true,
      onRetry: (_attempt, _err, delay) => delays.push(delay),
    });

    try { await retry.execute(failFn); } catch {}

    // All delays should be less than or equal to the non-jittered value
    for (let i = 0; i < delays.length; i++) {
      const maxExpected = Math.min(100 * Math.pow(2, i), 1000);
      expect(delays[i]).toBeLessThanOrEqual(maxExpected);
      expect(delays[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── ResiliencePipeline Tests ────────────────────────────────────────────────

describe('ResiliencePipeline', () => {
  let pipeline: ResiliencePipeline<string>;

  afterEach(() => {
    if (pipeline) pipeline.destroy();
  });

  it('should execute successfully through the pipeline', async () => {
    pipeline = new ResiliencePipeline<string>(
      { name: 'test', failureThreshold: 3, resetTimeoutMs: 5000 }
    );

    const result = await pipeline.execute(successFn);
    expect(result).toBe('ok');
  });

  it('should retry failures before opening circuit', async () => {
    let attempts = 0;
    pipeline = new ResiliencePipeline<string>(
      { name: 'test', failureThreshold: 5, resetTimeoutMs: 5000 },
      { maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2, jitter: false }
    );

    const fn = async () => {
      attempts++;
      if (attempts < 3) throw new Error('retry me');
      return 'recovered';
    };

    const result = await pipeline.execute(fn);
    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
  });

  it('should use fallback when circuit and retries fail', async () => {
    pipeline = new ResiliencePipeline<string>(
      { name: 'test', failureThreshold: 2, resetTimeoutMs: 5000 },
      { maxAttempts: 1, initialDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2, jitter: false },
      { defaultValue: 'default-fallback' }
    );

    // Trip the circuit
    try { await pipeline.execute(failFn); } catch {}
    try { await pipeline.execute(failFn); } catch {}

    // Should use fallback
    const result = await pipeline.execute(failFn);
    expect(result).toBe('default-fallback');
  });

  it('should expose metrics', async () => {
    pipeline = new ResiliencePipeline<string>(
      { name: 'metrics-test', failureThreshold: 10, resetTimeoutMs: 5000 }
    );

    await pipeline.execute(successFn);
    const metrics = pipeline.getMetrics();

    expect(metrics.name).toBe('metrics-test');
    expect(metrics.totalCalls).toBe(1);
    expect(metrics.successfulCalls).toBe(1);
  });

  it('should support force open/close', async () => {
    pipeline = new ResiliencePipeline<string>(
      { name: 'test', failureThreshold: 10, resetTimeoutMs: 5000 }
    );

    pipeline.forceOpen();
    await expect(pipeline.execute(successFn)).rejects.toThrow(CircuitOpenError);

    pipeline.forceClosed();
    const result = await pipeline.execute(successFn);
    expect(result).toBe('ok');
  });
});

// ─── ResilienceRegistry Tests ────────────────────────────────────────────────

describe('ResilienceRegistry', () => {
  let registry: ResilienceRegistry;

  beforeEach(() => {
    registry = new ResilienceRegistry();
  });

  afterEach(() => {
    registry.destroyAll();
  });

  it('should register and retrieve pipelines', () => {
    const pipeline = new ResiliencePipeline(
      { name: 'test', failureThreshold: 3, resetTimeoutMs: 5000 }
    );

    registry.register('test', pipeline);
    expect(registry.get('test')).toBe(pipeline);
  });

  it('should reject duplicate names', () => {
    const p1 = new ResiliencePipeline(
      { name: 'test', failureThreshold: 3, resetTimeoutMs: 5000 }
    );
    const p2 = new ResiliencePipeline(
      { name: 'test', failureThreshold: 3, resetTimeoutMs: 5000 }
    );

    registry.register('test', p1);
    expect(() => registry.register('test', p2)).toThrow('already registered');

    p2.destroy();
  });

  it('should return undefined for non-existent pipeline', () => {
    expect(registry.get('nope')).toBeUndefined();
  });

  it('should get all metrics', async () => {
    const p1 = new ResiliencePipeline(
      { name: 'a', failureThreshold: 3, resetTimeoutMs: 5000 }
    );
    const p2 = new ResiliencePipeline(
      { name: 'b', failureThreshold: 3, resetTimeoutMs: 5000 }
    );

    registry.register('a', p1);
    registry.register('b', p2);

    await p1.execute(successFn);

    const metrics = registry.getAllMetrics();
    expect(metrics['a'].totalCalls).toBe(1);
    expect(metrics['b'].totalCalls).toBe(0);
  });

  it('should provide health summary', async () => {
    const p1 = new ResiliencePipeline(
      { name: 'healthy', failureThreshold: 10, resetTimeoutMs: 5000 }
    );
    const p2 = new ResiliencePipeline(
      { name: 'unhealthy', failureThreshold: 2, resetTimeoutMs: 5000 }
    );

    registry.register('healthy', p1);
    registry.register('unhealthy', p2);

    // Trip p2
    try { await p2.execute(failFn); } catch {}
    try { await p2.execute(failFn); } catch {}

    const health = registry.getHealthSummary();
    expect(health.total).toBe(2);
    expect(health.closed).toBe(1);
    expect(health.open).toBe(1);
    expect(health.unhealthy).toContain('unhealthy');
    expect(health.healthScore).toBe(0.5);
  });

  it('should open all circuits', () => {
    const p1 = new ResiliencePipeline(
      { name: 'a', failureThreshold: 10, resetTimeoutMs: 5000 }
    );
    const p2 = new ResiliencePipeline(
      { name: 'b', failureThreshold: 10, resetTimeoutMs: 5000 }
    );

    registry.register('a', p1);
    registry.register('b', p2);

    registry.openAll();

    expect(p1.getMetrics().state).toBe('open');
    expect(p2.getMetrics().state).toBe('open');
  });

  it('should reset all circuits', async () => {
    const p1 = new ResiliencePipeline(
      { name: 'a', failureThreshold: 2, resetTimeoutMs: 5000 }
    );

    registry.register('a', p1);

    // Trip it
    try { await p1.execute(failFn); } catch {}
    try { await p1.execute(failFn); } catch {}

    registry.resetAll();
    expect(p1.getMetrics().state).toBe('closed');
    expect(p1.getMetrics().totalCalls).toBe(0);
  });

  it('should unregister and destroy a pipeline', () => {
    const p1 = new ResiliencePipeline(
      { name: 'a', failureThreshold: 3, resetTimeoutMs: 5000 }
    );

    registry.register('a', p1);
    expect(registry.unregister('a')).toBe(true);
    expect(registry.get('a')).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('should return false when unregistering non-existent', () => {
    expect(registry.unregister('nope')).toBe(false);
  });

  it('should list all pipeline names', () => {
    const p1 = new ResiliencePipeline(
      { name: 'alpha', failureThreshold: 3, resetTimeoutMs: 5000 }
    );
    const p2 = new ResiliencePipeline(
      { name: 'beta', failureThreshold: 3, resetTimeoutMs: 5000 }
    );

    registry.register('alpha', p1);
    registry.register('beta', p2);

    expect(registry.list()).toEqual(['alpha', 'beta']);
  });

  it('should track size', () => {
    expect(registry.size).toBe(0);

    const p1 = new ResiliencePipeline(
      { name: 'a', failureThreshold: 3, resetTimeoutMs: 5000 }
    );
    registry.register('a', p1);
    expect(registry.size).toBe(1);
  });
});

// ─── Resilience Profiles Tests ───────────────────────────────────────────────

describe('ResilienceProfiles', () => {
  it('should create vision API profile', async () => {
    const pipeline = ResilienceProfiles.visionApi('test-vision');
    const result = await pipeline.execute(successFn);
    expect(result).toBe('ok');
    expect(pipeline.getMetrics().name).toBe('test-vision');
    pipeline.destroy();
  });

  it('should create product lookup profile', async () => {
    const pipeline = ResilienceProfiles.productLookup('test-product');
    const result = await pipeline.execute(successFn);
    expect(result).toBe('ok');
    pipeline.destroy();
  });

  it('should create web research profile', async () => {
    const pipeline = ResilienceProfiles.webResearch('test-web');
    const result = await pipeline.execute(successFn);
    expect(result).toBe('ok');
    pipeline.destroy();
  });

  it('should create voice service profile', async () => {
    const pipeline = ResilienceProfiles.voiceService('test-voice');
    const result = await pipeline.execute(successFn);
    expect(result).toBe('ok');
    pipeline.destroy();
  });

  it('should create webhook delivery profile', async () => {
    const pipeline = ResilienceProfiles.webhookDelivery('test-webhook');
    const result = await pipeline.execute(successFn);
    expect(result).toBe('ok');
    pipeline.destroy();
  });

  it('should create billing profile', async () => {
    const pipeline = ResilienceProfiles.billing('test-billing');
    const result = await pipeline.execute(successFn);
    expect(result).toBe('ok');
    pipeline.destroy();
  });

  it('should create local storage profile', async () => {
    const pipeline = ResilienceProfiles.localStorage('test-storage');
    const result = await pipeline.execute(successFn);
    expect(result).toBe('ok');
    pipeline.destroy();
  });

  it('vision API should not retry auth errors', async () => {
    const pipeline = ResilienceProfiles.visionApi('test');
    let attempts = 0;

    await expect(pipeline.execute(async () => {
      attempts++;
      throw new Error('invalid api key');
    })).rejects.toThrow('invalid api key');

    // Should be 1 attempt only (no retries for auth errors)
    expect(attempts).toBe(1);
    pipeline.destroy();
  });

  it('billing should not retry card declined errors', async () => {
    const pipeline = ResilienceProfiles.billing('test');
    let attempts = 0;

    await expect(pipeline.execute(async () => {
      attempts++;
      throw new Error('card_declined');
    })).rejects.toThrow('card_declined');

    expect(attempts).toBe(1);
    pipeline.destroy();
  });
});

// ─── Error Types Tests ───────────────────────────────────────────────────────

describe('Error Types', () => {
  it('CircuitOpenError should have correct name and message', () => {
    const err = new CircuitOpenError('my-circuit');
    expect(err.name).toBe('CircuitOpenError');
    expect(err.message).toContain('my-circuit');
    expect(err.message).toContain('open');
  });

  it('BulkheadFullError should have correct name and message', () => {
    const err = new BulkheadFullError('my-circuit', 5);
    expect(err.name).toBe('BulkheadFullError');
    expect(err.message).toContain('my-circuit');
    expect(err.message).toContain('5');
  });

  it('CallTimeoutError should have correct name and message', () => {
    const err = new CallTimeoutError('my-circuit', 5000);
    expect(err.name).toBe('CallTimeoutError');
    expect(err.message).toContain('my-circuit');
    expect(err.message).toContain('5000');
  });
});
