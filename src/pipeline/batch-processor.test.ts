/**
 * Tests for Batch Processing Pipeline
 * 🌙 Night Shift Agent — 2026-03-07
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BatchProcessor,
  BatchJob,
  CreateJobOptions,
  DEFAULT_BATCH_CONFIG,
  JobPriority,
  JobType,
} from './batch-processor';

// Helper to create a basic processor with a fast handler
function createProcessor(config: Partial<typeof DEFAULT_BATCH_CONFIG> = {}) {
  const processor = new BatchProcessor(config);
  return processor;
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Job Creation ──────────────────────────────────────────────

describe('BatchProcessor — Job Creation', () => {
  it('should create a job with default values', () => {
    const proc = createProcessor({ maxConcurrency: 0 }); // Don't auto-process
    proc.registerHandler('vision_analysis', async () => 'done');

    const job = proc.enqueue({
      type: 'vision_analysis',
      input: { imageId: 'img-1' },
    });

    expect(job.id).toBeTruthy();
    expect(job.type).toBe('vision_analysis');
    expect(job.priority).toBe('normal');
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(3);
    expect(job.tags).toEqual([]);
    expect(job.dependsOn).toEqual([]);
  });

  it('should create a job with custom options', () => {
    const proc = createProcessor();
    proc.registerHandler('product_lookup', async () => ({}));

    const job = proc.enqueue({
      type: 'product_lookup',
      input: { upc: '012345678901' },
      priority: 'high',
      maxAttempts: 5,
      tags: ['barcode', 'inventory'],
      ttlMs: 60000,
      batchId: 'batch-1',
      retryDelayMs: 2000,
      metadata: { storeId: 'store-A' },
    });

    expect(job.priority).toBe('high');
    expect(job.maxAttempts).toBe(5);
    expect(job.tags).toEqual(['barcode', 'inventory']);
    expect(job.ttlMs).toBe(60000);
    expect(job.batchId).toBe('batch-1');
    expect(job.retryDelayMs).toBe(2000);
    expect(job.metadata.storeId).toBe('store-A');
  });

  it('should reject jobs when queue is full', () => {
    const proc = createProcessor({ maxQueueDepth: 2, maxConcurrency: 0 });
    // maxConcurrency 0 means nothing will process, so jobs stay queued
    proc.registerHandler('vision_analysis', async () => 'done');

    proc.enqueue({ type: 'vision_analysis', input: 1 });
    proc.enqueue({ type: 'vision_analysis', input: 2 });

    expect(() => {
      proc.enqueue({ type: 'vision_analysis', input: 3 });
    }).toThrow(/Queue is full/);
  });

  it('should emit queue:full when depth exceeded', () => {
    const proc = createProcessor({ maxQueueDepth: 1, maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    const fullHandler = vi.fn();
    proc.on('queue:full', fullHandler);

    proc.enqueue({ type: 'vision_analysis', input: 1 });

    try {
      proc.enqueue({ type: 'vision_analysis', input: 2 });
    } catch { /* expected */ }

    expect(fullHandler).toHaveBeenCalledTimes(1);
  });

  it('should enforce byte limits (backpressure)', () => {
    const proc = createProcessor({ maxQueueBytes: 100, maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    // Enqueue a job with a large buffer
    const bigInput = { buffer: Buffer.alloc(150) };

    expect(() => {
      proc.enqueue({ type: 'vision_analysis', input: bigInput });
    }).toThrow(/byte limit exceeded/);
  });

  it('should emit job:created event', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    const handler = vi.fn();
    proc.on('job:created', handler);

    const job = proc.enqueue({ type: 'vision_analysis', input: 'test' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].id).toBe(job.id);
  });
});

// ─── Batch Creation ────────────────────────────────────────────

describe('BatchProcessor — Batch Operations', () => {
  it('should create a batch of jobs with shared batchId', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    const { batchId, jobs } = proc.enqueueBatch([
      { type: 'vision_analysis', input: 'img-1' },
      { type: 'vision_analysis', input: 'img-2' },
      { type: 'vision_analysis', input: 'img-3' },
    ]);

    expect(batchId).toBeTruthy();
    expect(jobs).toHaveLength(3);
    expect(jobs.every(j => j.batchId === batchId)).toBe(true);
  });

  it('should use custom batchId if provided', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    const { batchId } = proc.enqueueBatch(
      [{ type: 'vision_analysis', input: 'a' }],
      'my-batch'
    );

    expect(batchId).toBe('my-batch');
  });

  it('should cancel all jobs in a batch', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    const { batchId, jobs } = proc.enqueueBatch([
      { type: 'vision_analysis', input: 1 },
      { type: 'vision_analysis', input: 2 },
      { type: 'vision_analysis', input: 3 },
    ]);

    const cancelled = proc.cancelBatch(batchId);
    expect(cancelled).toBe(3);
    expect(jobs.every(j => proc.getJob(j.id)?.status === 'cancelled')).toBe(true);
  });
});

// ─── Processing ────────────────────────────────────────────────

describe('BatchProcessor — Processing', () => {
  it('should process a job with registered handler', async () => {
    const proc = createProcessor();
    proc.registerHandler('vision_analysis', async (input: { value: number }) => {
      return { result: input.value * 2 };
    });

    const completedPromise = new Promise<BatchJob>(resolve => {
      proc.on('job:completed', resolve);
    });

    proc.enqueue({
      type: 'vision_analysis',
      input: { value: 21 },
    });

    const completed = await completedPromise;
    expect(completed.status).toBe('completed');
    expect((completed.output as any).result).toBe(42);
    expect(completed.attempts).toBe(1);
    expect(completed.startedAt).toBeTruthy();
    expect(completed.completedAt).toBeTruthy();
  });

  it('should fail job if no handler is registered', async () => {
    const proc = createProcessor();

    const failedPromise = new Promise<BatchJob>(resolve => {
      proc.on('job:failed', resolve);
    });

    proc.enqueue({
      type: 'custom',
      input: {},
    });

    const failed = await failedPromise;
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/No handler registered/);
  });

  it('should respect maxConcurrency', async () => {
    const proc = createProcessor({ maxConcurrency: 2 });
    let concurrent = 0;
    let maxConcurrent = 0;

    proc.registerHandler('vision_analysis', async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await wait(50);
      concurrent--;
      return 'done';
    });

    const promises: Promise<BatchJob>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(new Promise<BatchJob>(resolve => {
        const job = proc.enqueue({ type: 'vision_analysis', input: i });
        const check = setInterval(() => {
          const current = proc.getJob(job.id);
          if (current && (current.status === 'completed' || current.status === 'failed')) {
            clearInterval(check);
            resolve(current);
          }
        }, 10);
      }));
    }

    await Promise.all(promises);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should process jobs in priority order', async () => {
    const proc = createProcessor({ maxConcurrency: 1 });
    const order: string[] = [];

    proc.registerHandler('vision_analysis', async (input: { name: string }) => {
      order.push(input.name);
      return input.name;
    });

    // Pause to queue them up without processing
    proc.pause();

    proc.enqueue({ type: 'vision_analysis', input: { name: 'low' }, priority: 'low' });
    proc.enqueue({ type: 'vision_analysis', input: { name: 'critical' }, priority: 'critical' });
    proc.enqueue({ type: 'vision_analysis', input: { name: 'normal' }, priority: 'normal' });
    proc.enqueue({ type: 'vision_analysis', input: { name: 'high' }, priority: 'high' });

    // Resume and let them process
    proc.resume();

    // Wait for all to complete
    await wait(200);

    expect(order[0]).toBe('critical');
    expect(order[1]).toBe('high');
    expect(order[2]).toBe('normal');
    expect(order[3]).toBe('low');
  });

  it('should handle async errors and retry', async () => {
    const proc = createProcessor({ maxConcurrency: 1 });
    let callCount = 0;

    proc.registerHandler('vision_analysis', async () => {
      callCount++;
      if (callCount < 3) throw new Error('temporary failure');
      return 'success';
    });

    const retryHandler = vi.fn();
    proc.on('job:retrying', retryHandler);

    proc.enqueue({
      type: 'vision_analysis',
      input: 'test',
      retryDelayMs: 10, // fast retry for tests
    });

    // Wait for retries
    await wait(200);

    // Manually trigger retry check since timers aren't started
    (proc as any).checkRetries();
    await wait(100);
    (proc as any).checkRetries();
    await wait(100);

    const job = proc.queryJobs({ type: 'vision_analysis' })[0];
    expect(job.status).toBe('completed');
    expect(callCount).toBe(3);
    expect(retryHandler).toHaveBeenCalled();
  });

  it('should fail after max attempts', async () => {
    const proc = createProcessor({ maxConcurrency: 1 });

    proc.registerHandler('vision_analysis', async () => {
      throw new Error('always fails');
    });

    const failedPromise = new Promise<BatchJob>(resolve => {
      proc.on('job:failed', resolve);
    });

    proc.enqueue({
      type: 'vision_analysis',
      input: 'test',
      maxAttempts: 1,
    });

    const failed = await failedPromise;
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('always fails');
    expect(failed.attempts).toBe(1);
  });

  it('should respect job dependencies', async () => {
    const proc = createProcessor({ maxConcurrency: 1 });
    const order: string[] = [];

    proc.registerHandler('vision_analysis', async (input: string) => {
      order.push(input);
      return input;
    });

    // Create parent job first (paused so we control order)
    proc.pause();
    const parent = proc.enqueue({ type: 'vision_analysis', input: 'parent' });
    const child = proc.enqueue({
      type: 'vision_analysis',
      input: 'child',
      dependsOn: [parent.id],
    });

    proc.resume();
    await wait(150);

    expect(order[0]).toBe('parent');
    expect(order[1]).toBe('child');
  });

  it('should fail dependent job when dependency fails', async () => {
    const proc = createProcessor({ maxConcurrency: 1 });

    proc.registerHandler('vision_analysis', async (input: string) => {
      if (input === 'parent') throw new Error('parent failed');
      return input;
    });

    proc.pause();
    const parent = proc.enqueue({
      type: 'vision_analysis',
      input: 'parent',
      maxAttempts: 1,
    });
    proc.enqueue({
      type: 'vision_analysis',
      input: 'child',
      dependsOn: [parent.id],
    });

    proc.resume();
    await wait(200);

    // Trigger next pick to process dependent
    (proc as any).processNext();
    await wait(50);

    const childJob = proc.queryJobs({}).find(j => (j.input as string) === 'child');
    expect(childJob?.status).toBe('failed');
    expect(childJob?.error).toBe('Dependency failed');
  });
});

// ─── Job Management ────────────────────────────────────────────

describe('BatchProcessor — Job Management', () => {
  it('should get a job by ID', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    const job = proc.enqueue({ type: 'vision_analysis', input: 'test' });
    const retrieved = proc.getJob(job.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(job.id);
  });

  it('should return undefined for unknown job ID', () => {
    const proc = createProcessor();
    expect(proc.getJob('nonexistent')).toBeUndefined();
  });

  it('should cancel a queued job', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    const job = proc.enqueue({ type: 'vision_analysis', input: 'test' });
    const cancelled = proc.cancelJob(job.id);

    expect(cancelled).toBe(true);
    expect(proc.getJob(job.id)?.status).toBe('cancelled');
  });

  it('should not cancel a completed job', async () => {
    const proc = createProcessor();
    proc.registerHandler('vision_analysis', async () => 'done');

    const completedPromise = new Promise<BatchJob>(resolve => {
      proc.on('job:completed', resolve);
    });

    const job = proc.enqueue({ type: 'vision_analysis', input: 'test' });
    await completedPromise;

    const cancelled = proc.cancelJob(job.id);
    expect(cancelled).toBe(false);
  });

  it('should clear finished jobs', async () => {
    const proc = createProcessor();
    proc.registerHandler('vision_analysis', async () => 'done');

    const completedPromise = new Promise<void>(resolve => {
      proc.on('job:completed', resolve);
    });

    proc.enqueue({ type: 'vision_analysis', input: 'test' });
    await completedPromise;

    const cleared = proc.clearFinished();
    expect(cleared).toBe(1);
    expect(proc.getStats().totalJobs).toBe(0);
  });

  it('should query jobs by status', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');
    proc.registerHandler('product_lookup', async () => ({}));

    proc.enqueue({ type: 'vision_analysis', input: 1 });
    proc.enqueue({ type: 'product_lookup', input: 2 });

    const queued = proc.queryJobs({ status: 'queued' });
    expect(queued).toHaveLength(2);

    const visionJobs = proc.queryJobs({ type: 'vision_analysis' });
    expect(visionJobs).toHaveLength(1);
  });

  it('should query jobs by tag', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    proc.enqueue({ type: 'vision_analysis', input: 1, tags: ['urgent', 'store-A'] });
    proc.enqueue({ type: 'vision_analysis', input: 2, tags: ['store-B'] });
    proc.enqueue({ type: 'vision_analysis', input: 3, tags: ['urgent', 'store-B'] });

    const urgent = proc.queryJobs({ tag: 'urgent' });
    expect(urgent).toHaveLength(2);

    const storeB = proc.queryJobs({ tag: 'store-B' });
    expect(storeB).toHaveLength(2);
  });

  it('should query jobs by priority', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    proc.enqueue({ type: 'vision_analysis', input: 1, priority: 'high' });
    proc.enqueue({ type: 'vision_analysis', input: 2, priority: 'low' });
    proc.enqueue({ type: 'vision_analysis', input: 3, priority: 'high' });

    const highPriority = proc.queryJobs({ priority: 'high' });
    expect(highPriority).toHaveLength(2);
  });
});

// ─── Pause / Resume / Drain ────────────────────────────────────

describe('BatchProcessor — Control', () => {
  it('should pause and resume processing', async () => {
    const proc = createProcessor();
    const processed: number[] = [];

    proc.registerHandler('vision_analysis', async (input: number) => {
      processed.push(input);
      return input;
    });

    proc.pause();
    expect(proc.isPaused()).toBe(true);

    proc.enqueue({ type: 'vision_analysis', input: 1 });
    proc.enqueue({ type: 'vision_analysis', input: 2 });

    await wait(50);
    expect(processed).toHaveLength(0); // Nothing processed while paused

    proc.resume();
    expect(proc.isPaused()).toBe(false);

    await wait(100);
    expect(processed).toHaveLength(2);
  });

  it('should emit paused/resumed events', () => {
    const proc = createProcessor();
    const pausedHandler = vi.fn();
    const resumedHandler = vi.fn();

    proc.on('processor:paused', pausedHandler);
    proc.on('processor:resumed', resumedHandler);

    proc.pause();
    proc.resume();

    expect(pausedHandler).toHaveBeenCalledTimes(1);
    expect(resumedHandler).toHaveBeenCalledTimes(1);
  });

  it('should not double-pause or double-resume', () => {
    const proc = createProcessor();
    const pausedHandler = vi.fn();
    const resumedHandler = vi.fn();

    proc.on('processor:paused', pausedHandler);
    proc.on('processor:resumed', resumedHandler);

    proc.pause();
    proc.pause();
    proc.resume();
    proc.resume();

    expect(pausedHandler).toHaveBeenCalledTimes(1);
    expect(resumedHandler).toHaveBeenCalledTimes(1);
  });

  it('should drain active jobs', async () => {
    const proc = createProcessor({ maxConcurrency: 1 });

    proc.registerHandler('vision_analysis', async () => {
      await wait(50);
      return 'done';
    });

    proc.enqueue({ type: 'vision_analysis', input: 1 });
    proc.enqueue({ type: 'vision_analysis', input: 2 });

    await wait(10); // Let first job start

    await proc.drain(5000);
    expect(proc.isPaused()).toBe(true);
    expect(proc.getStats().processing).toBe(0);
  });
});

// ─── Statistics ────────────────────────────────────────────────

describe('BatchProcessor — Statistics', () => {
  it('should track basic stats', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    proc.enqueue({ type: 'vision_analysis', input: 1 });
    proc.enqueue({ type: 'vision_analysis', input: 2 });

    const stats = proc.getStats();
    expect(stats.totalJobs).toBe(2);
    expect(stats.queued).toBe(2);
    expect(stats.processing).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.maxConcurrency).toBe(0);
    expect(stats.maxQueueDepth).toBe(500);
  });

  it('should track completed job stats', async () => {
    const proc = createProcessor();
    proc.registerHandler('vision_analysis', async () => {
      await wait(10);
      return 'done';
    });

    const promise = new Promise<void>(resolve => {
      let count = 0;
      proc.on('job:completed', () => {
        count++;
        if (count === 3) resolve();
      });
    });

    proc.enqueue({ type: 'vision_analysis', input: 1 });
    proc.enqueue({ type: 'vision_analysis', input: 2 });
    proc.enqueue({ type: 'vision_analysis', input: 3 });

    await promise;

    const stats = proc.getStats();
    expect(stats.completed).toBe(3);
    expect(stats.avgProcessingTimeMs).toBeGreaterThan(0);
    expect(stats.throughputPerMinute).toBeGreaterThan(0);
  });

  it('should calculate error rate', async () => {
    const proc = createProcessor();
    let callNum = 0;

    proc.registerHandler('vision_analysis', async () => {
      callNum++;
      if (callNum <= 2) throw new Error('fail');
      return 'done';
    });

    // First two will fail (maxAttempts: 1), third succeeds
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 3; i++) {
      promises.push(new Promise<void>(resolve => {
        const handler = (job: BatchJob) => {
          if (job.status === 'completed' || job.status === 'failed') {
            proc.off('job:completed', handler);
            proc.off('job:failed', handler);
            resolve();
          }
        };
        proc.on('job:completed', handler);
        proc.on('job:failed', handler);
      }));
    }

    proc.enqueue({ type: 'vision_analysis', input: 1, maxAttempts: 1 });
    proc.enqueue({ type: 'vision_analysis', input: 2, maxAttempts: 1 });
    proc.enqueue({ type: 'vision_analysis', input: 3, maxAttempts: 1 });

    await Promise.all(promises);

    const stats = proc.getStats();
    // 2 failed out of 3 = 0.667 error rate
    expect(stats.errorRate).toBeCloseTo(0.667, 1);
  });
});

// ─── Batch Progress ────────────────────────────────────────────

describe('BatchProcessor — Batch Progress', () => {
  it('should track batch progress', async () => {
    const proc = createProcessor({ maxConcurrency: 1 });
    proc.registerHandler('vision_analysis', async () => {
      await wait(10);
      return 'done';
    });

    const batchCompletedPromise = new Promise<string>(resolve => {
      proc.on('batch:completed', resolve);
    });

    const { batchId } = proc.enqueueBatch([
      { type: 'vision_analysis', input: 1 },
      { type: 'vision_analysis', input: 2 },
      { type: 'vision_analysis', input: 3 },
    ]);

    await batchCompletedPromise;

    const progress = proc.getBatchProgress(batchId);
    expect(progress).not.toBeNull();
    expect(progress!.totalJobs).toBe(3);
    expect(progress!.completed).toBe(3);
    expect(progress!.percentComplete).toBe(100);
  });

  it('should return null for unknown batch', () => {
    const proc = createProcessor();
    expect(proc.getBatchProgress('nonexistent')).toBeNull();
  });

  it('should emit batch:progress events', async () => {
    const proc = createProcessor({ maxConcurrency: 1 });
    proc.registerHandler('vision_analysis', async () => 'done');

    const progressEvents: any[] = [];
    proc.on('batch:progress', (p) => progressEvents.push(p));

    const batchCompletedPromise = new Promise<void>(resolve => {
      proc.on('batch:completed', () => resolve());
    });

    proc.enqueueBatch([
      { type: 'vision_analysis', input: 1 },
      { type: 'vision_analysis', input: 2 },
    ]);

    await batchCompletedPromise;

    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    expect(progressEvents[progressEvents.length - 1].percentComplete).toBe(100);
  });
});

// ─── TTL & Expiration ──────────────────────────────────────────

describe('BatchProcessor — Expiration', () => {
  it('should expire jobs past their TTL during pick', async () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    const job = proc.enqueue({
      type: 'vision_analysis',
      input: 'test',
      ttlMs: 1, // expire almost immediately
    });

    await wait(10);

    // Trigger a pick which checks TTL
    (proc as any).pickNextJob();

    expect(proc.getJob(job.id)?.status).toBe('expired');
  });

  it('should emit job:expired event', async () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    const expiredHandler = vi.fn();
    proc.on('job:expired', expiredHandler);

    proc.enqueue({
      type: 'vision_analysis',
      input: 'test',
      ttlMs: 1,
    });

    await wait(10);
    (proc as any).checkExpirations();

    expect(expiredHandler).toHaveBeenCalledTimes(1);
  });
});

// ─── Handler Registration ──────────────────────────────────────

describe('BatchProcessor — Handlers', () => {
  it('should register and check handlers', () => {
    const proc = createProcessor();

    expect(proc.hasHandler('vision_analysis')).toBe(false);

    proc.registerHandler('vision_analysis', async () => 'done');

    expect(proc.hasHandler('vision_analysis')).toBe(true);
    expect(proc.hasHandler('product_lookup')).toBe(false);
  });

  it('should support multiple handler types', async () => {
    const proc = createProcessor();
    const results: string[] = [];

    proc.registerHandler('vision_analysis', async (input: string) => {
      results.push(`vision:${input}`);
      return `vision:${input}`;
    });

    proc.registerHandler('product_lookup', async (input: string) => {
      results.push(`product:${input}`);
      return `product:${input}`;
    });

    const promise = new Promise<void>(resolve => {
      let count = 0;
      proc.on('job:completed', () => {
        count++;
        if (count === 2) resolve();
      });
    });

    proc.enqueue({ type: 'vision_analysis', input: 'img-1' });
    proc.enqueue({ type: 'product_lookup', input: 'upc-1' });

    await promise;
    expect(results).toContain('vision:img-1');
    expect(results).toContain('product:upc-1');
  });
});

// ─── Voice Summary ─────────────────────────────────────────────

describe('BatchProcessor — Voice Summary', () => {
  it('should generate empty queue summary', () => {
    const proc = createProcessor();
    const summary = proc.getVoiceSummary();
    expect(summary).toBe('Processing queue is empty.');
  });

  it('should generate summary with queued items', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    proc.enqueue({ type: 'vision_analysis', input: 1 });
    proc.enqueue({ type: 'vision_analysis', input: 2 });

    const summary = proc.getVoiceSummary();
    expect(summary).toContain('2 in queue');
  });

  it('should generate summary with mixed states', async () => {
    const proc = createProcessor({ maxConcurrency: 1 });

    proc.registerHandler('vision_analysis', async () => {
      await wait(100);
      return 'done';
    });

    // Enqueue several, let one start processing
    proc.enqueue({ type: 'vision_analysis', input: 1 });
    proc.enqueue({ type: 'vision_analysis', input: 2 });
    proc.enqueue({ type: 'vision_analysis', input: 3 });

    await wait(10);

    const summary = proc.getVoiceSummary();
    expect(summary).toContain('Processing 1 image');
    expect(summary).toContain('in queue');
  });
});

// ─── Timers ────────────────────────────────────────────────────

describe('BatchProcessor — Timers', () => {
  it('should start and stop timers', () => {
    const proc = createProcessor();

    proc.startTimers();
    expect((proc as any).retryTimer).not.toBeNull();
    expect((proc as any).expirationTimer).not.toBeNull();

    proc.stopTimers();
    expect((proc as any).retryTimer).toBeNull();
    expect((proc as any).expirationTimer).toBeNull();
  });

  it('should restart timers cleanly', () => {
    const proc = createProcessor();

    proc.startTimers();
    const first = (proc as any).retryTimer;

    proc.startTimers(); // Should stop old and start new
    const second = (proc as any).retryTimer;

    expect(second).not.toBeNull();
    proc.stopTimers();
  });
});

// ─── Edge Cases ────────────────────────────────────────────────

describe('BatchProcessor — Edge Cases', () => {
  it('should handle null/undefined input', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('custom', async () => null);

    const job = proc.enqueue({ type: 'custom', input: null });
    expect(job.input).toBeNull();
  });

  it('should handle rapid enqueue/cancel cycles', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    for (let i = 0; i < 100; i++) {
      const job = proc.enqueue({ type: 'vision_analysis', input: i });
      if (i % 2 === 0) {
        proc.cancelJob(job.id);
      }
    }

    const stats = proc.getStats();
    expect(stats.queued).toBe(50);
    expect(stats.cancelled).toBe(50);
    expect(stats.totalJobs).toBe(100);
  });

  it('should generate unique IDs', () => {
    const proc = createProcessor({ maxConcurrency: 0 });
    proc.registerHandler('vision_analysis', async () => 'done');

    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const job = proc.enqueue({ type: 'vision_analysis', input: i });
      ids.add(job.id);
    }

    expect(ids.size).toBe(100);
  });

  it('should handle concurrent completion events correctly', async () => {
    const proc = createProcessor({ maxConcurrency: 5 });
    let completedCount = 0;

    proc.registerHandler('vision_analysis', async () => {
      await wait(Math.random() * 20);
      return 'done';
    });

    proc.on('job:completed', () => completedCount++);

    for (let i = 0; i < 20; i++) {
      proc.enqueue({ type: 'vision_analysis', input: i });
    }

    await wait(500);

    expect(completedCount).toBe(20);
    expect(proc.getStats().completed).toBe(20);
  });
});
