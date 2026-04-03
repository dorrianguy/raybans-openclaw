/**
 * Job Queue Tests — Night Shift #30
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JobQueue, type Job, type JobContext, type JobHandler } from './job-queue';

describe('JobQueue', () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue({ pollIntervalMs: 10, maxConcurrency: 2 });
  });

  afterEach(() => {
    queue.destroy();
  });

  // ── Helper ─────────────────────────────────────────────────────────────

  function wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── Handler Registration ───────────────────────────────────────────────

  describe('handler registration', () => {
    it('should register and list handlers', () => {
      queue.registerHandler('image:process', async () => {});
      queue.registerHandler('export:csv', async () => {});

      const types = queue.getRegisteredTypes();
      expect(types).toContain('image:process');
      expect(types).toContain('export:csv');
    });

    it('should remove handlers', () => {
      queue.registerHandler('test', async () => {});
      expect(queue.removeHandler('test')).toBe(true);
      expect(queue.removeHandler('nonexistent')).toBe(false);
      expect(queue.getRegisteredTypes()).not.toContain('test');
    });
  });

  // ── Basic Enqueue ──────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('should enqueue a job with defaults', () => {
      const job = queue.enqueue({ type: 'test', payload: { data: 1 } });
      expect(job).not.toBeNull();
      expect(job!.id).toMatch(/^job_/);
      expect(job!.type).toBe('test');
      expect(job!.status).toBe('pending');
      expect(job!.priority).toBe('normal');
      expect(job!.progress).toBe(0);
      expect(job!.retries).toBe(0);
    });

    it('should enqueue with custom options', () => {
      const job = queue.enqueue({
        type: 'test',
        payload: null,
        priority: 'critical',
        maxRetries: 5,
        timeoutMs: 60000,
        metadata: { custom: true },
      });

      expect(job!.priority).toBe('critical');
      expect(job!.maxRetries).toBe(5);
      expect(job!.timeoutMs).toBe(60000);
      expect(job!.metadata.custom).toBe(true);
    });

    it('should return null when queue is full', () => {
      const smallQueue = new JobQueue({ maxQueueSize: 2 });
      smallQueue.enqueue({ type: 'test', payload: 1 });
      smallQueue.enqueue({ type: 'test', payload: 2 });
      const third = smallQueue.enqueue({ type: 'test', payload: 3 });

      expect(third).toBeNull();
      smallQueue.destroy();
    });

    it('should retrieve jobs by ID', () => {
      const job = queue.enqueue({ type: 'test', payload: 'find me' });
      const found = queue.getJob(job!.id);
      expect(found).toBeDefined();
      expect(found!.payload).toBe('find me');
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('should deduplicate by idempotency key', () => {
      const j1 = queue.enqueue({ type: 'test', payload: 1, idempotencyKey: 'dedup-1' });
      const j2 = queue.enqueue({ type: 'test', payload: 2, idempotencyKey: 'dedup-1' });

      expect(j1!.id).toBe(j2!.id); // same job returned
      expect(queue.getPendingCount()).toBe(1);
    });

    it('should allow re-enqueue after completion', async () => {
      queue.registerHandler('test', async () => 'done');
      queue.start();

      const j1 = queue.enqueue({ type: 'test', payload: 1, idempotencyKey: 'key-1' });
      await wait(100);

      expect(queue.getJob(j1!.id)!.status).toBe('completed');

      // Should now allow re-enqueue
      const j2 = queue.enqueue({ type: 'test', payload: 2, idempotencyKey: 'key-1' });
      expect(j2!.id).not.toBe(j1!.id);
    });
  });

  // ── Job Execution ──────────────────────────────────────────────────────

  describe('execution', () => {
    it('should execute jobs and update status', async () => {
      queue.registerHandler('greet', async (job) => {
        return `Hello ${job.payload}`;
      });

      const job = queue.enqueue({ type: 'greet', payload: 'World' });
      queue.start();

      await wait(100);

      const completed = queue.getJob(job!.id);
      expect(completed!.status).toBe('completed');
      expect(completed!.result).toBe('Hello World');
      expect(completed!.progress).toBe(100);
    });

    it('should handle job failures', async () => {
      queue.registerHandler('fail', async () => {
        throw new Error('intentional failure');
      });

      const job = queue.enqueue({
        type: 'fail',
        payload: null,
        maxRetries: 0,
      });

      queue.start();
      await wait(100);

      const failed = queue.getJob(job!.id);
      expect(failed!.status).toBe('dead');
      expect(failed!.error).toBe('intentional failure');
    });

    it('should fail jobs with no registered handler', async () => {
      const job = queue.enqueue({ type: 'unregistered', payload: null });
      queue.start();
      await wait(100);

      const result = queue.getJob(job!.id);
      expect(result!.status).toBe('dead');
      expect(result!.error).toContain('No handler');
    });

    it('should respect max concurrency', async () => {
      let running = 0;
      let maxRunning = 0;

      queue.registerHandler('slow', async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await wait(50);
        running--;
      });

      for (let i = 0; i < 6; i++) {
        queue.enqueue({ type: 'slow', payload: i });
      }

      queue.start();
      await wait(500);

      expect(maxRunning).toBeLessThanOrEqual(2);
      expect(queue.getMetrics().totalCompleted).toBe(6);
    });
  });

  // ── Priority ───────────────────────────────────────────────────────────

  describe('priority', () => {
    it('should process critical jobs before normal', async () => {
      const order: number[] = [];

      queue.registerHandler('ordered', async (job) => {
        order.push(job.payload as number);
      });

      // Enqueue in reverse priority order
      queue.enqueue({ type: 'ordered', payload: 3, priority: 'low' });
      queue.enqueue({ type: 'ordered', payload: 1, priority: 'critical' });
      queue.enqueue({ type: 'ordered', payload: 2, priority: 'high' });

      // Use single concurrency to guarantee order
      const seqQueue = new JobQueue({ maxConcurrency: 1, pollIntervalMs: 10 });
      const seqOrder: number[] = [];

      seqQueue.registerHandler('ordered', async (job) => {
        seqOrder.push(job.payload as number);
      });

      seqQueue.enqueue({ type: 'ordered', payload: 3, priority: 'low' });
      seqQueue.enqueue({ type: 'ordered', payload: 1, priority: 'critical' });
      seqQueue.enqueue({ type: 'ordered', payload: 2, priority: 'high' });

      seqQueue.start();
      await wait(200);

      expect(seqOrder).toEqual([1, 2, 3]);
      seqQueue.destroy();
    });
  });

  // ── Retry ──────────────────────────────────────────────────────────────

  describe('retry', () => {
    it('should retry failed jobs', async () => {
      let attempts = 0;
      queue.registerHandler('retry-test', async () => {
        attempts++;
        if (attempts < 3) throw new Error(`attempt ${attempts}`);
        return 'success';
      });

      const job = queue.enqueue({
        type: 'retry-test',
        payload: null,
        maxRetries: 3,
        retryDelayMs: 20,
      });

      queue.start();
      await wait(500);

      expect(attempts).toBe(3);
      const result = queue.getJob(job!.id);
      expect(result!.status).toBe('completed');
      expect(result!.result).toBe('success');
    });

    it('should move to dead letter after max retries', async () => {
      queue.registerHandler('always-fail', async () => {
        throw new Error('permanent failure');
      });

      // maxRetries: 0 means no retries — go straight to dead letter on first failure
      queue.enqueue({
        type: 'always-fail',
        payload: null,
        maxRetries: 0,
      });

      queue.start();
      await wait(200);

      expect(queue.getDeadLetters().length).toBeGreaterThanOrEqual(1);
      expect(queue.getMetrics().totalDeadLettered).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Job Progress ───────────────────────────────────────────────────────

  describe('progress tracking', () => {
    it('should update progress during execution', async () => {
      const progressValues: number[] = [];

      queue.registerHandler('progress-test', async (_job, ctx) => {
        ctx.updateProgress(25);
        ctx.updateProgress(50);
        ctx.updateProgress(75);
        ctx.updateProgress(100);
      });

      queue.onProgress((job) => progressValues.push(job.progress));

      queue.enqueue({ type: 'progress-test', payload: null });
      queue.start();
      await wait(100);

      expect(progressValues).toEqual([25, 50, 75, 100]);
    });

    it('should clamp progress to 0-100', async () => {
      const progressValues: number[] = [];

      queue.registerHandler('clamp-test', async (_job, ctx) => {
        ctx.updateProgress(-10);
        ctx.updateProgress(150);
      });

      queue.onProgress((job) => progressValues.push(job.progress));

      queue.enqueue({ type: 'clamp-test', payload: null });
      queue.start();
      await wait(100);

      expect(progressValues).toEqual([0, 100]);
    });
  });

  // ── Job Cancellation ──────────────────────────────────────────────────

  describe('cancellation', () => {
    it('should cancel pending jobs', () => {
      const job = queue.enqueue({ type: 'test', payload: null });
      expect(queue.cancelJob(job!.id)).toBe(true);
      expect(queue.getJob(job!.id)!.status).toBe('cancelled');
    });

    it('should signal cancellation to running jobs', async () => {
      let wasCancelled = false;

      queue.registerHandler('cancelable', async (_job, ctx) => {
        await wait(50);
        wasCancelled = ctx.isCancelled();
        await wait(50);
      });

      const job = queue.enqueue({ type: 'cancelable', payload: null });
      queue.start();

      await wait(20);
      queue.cancelJob(job!.id);
      await wait(200);

      expect(wasCancelled).toBe(true);
    });

    it('should not cancel completed jobs', async () => {
      queue.registerHandler('test', async () => 'done');
      const job = queue.enqueue({ type: 'test', payload: null });
      queue.start();
      await wait(100);

      expect(queue.cancelJob(job!.id)).toBe(false);
    });
  });

  // ── Job Logs ──────────────────────────────────────────────────────────

  describe('job logs', () => {
    it('should capture context logs', async () => {
      queue.registerHandler('logging', async (_job, ctx) => {
        ctx.log('Starting work');
        ctx.log('Step 1 complete');
        ctx.log('All done');
      });

      const job = queue.enqueue({ type: 'logging', payload: null });
      queue.start();
      await wait(100);

      const logs = queue.getJobLogs(job!.id);
      expect(logs).toHaveLength(3);
      expect(logs[0]).toContain('Starting work');
      expect(logs[1]).toContain('Step 1 complete');
      expect(logs[2]).toContain('All done');
    });

    it('should return empty array for unknown jobs', () => {
      expect(queue.getJobLogs('nonexistent')).toEqual([]);
    });
  });

  // ── Scheduled Jobs ────────────────────────────────────────────────────

  describe('scheduled jobs', () => {
    it('should create scheduled jobs', () => {
      const future = Date.now() + 60000;
      const job = queue.enqueue({
        type: 'test',
        payload: null,
        scheduledFor: future,
      });

      expect(job!.status).toBe('scheduled');
      expect(job!.scheduledFor).toBe(future);
    });

    it('should execute when schedule time arrives', async () => {
      let executed = false;
      queue.registerHandler('scheduled', async () => { executed = true; });

      queue.enqueue({
        type: 'scheduled',
        payload: null,
        scheduledFor: Date.now() + 30, // 30ms from now
      });

      queue.start();
      await wait(200);

      expect(executed).toBe(true);
    });
  });

  // ── Dependencies ──────────────────────────────────────────────────────

  describe('dependencies', () => {
    it('should wait for dependencies to complete', async () => {
      const order: string[] = [];

      queue.registerHandler('dep', async (job) => {
        order.push(job.payload as string);
      });

      const j1 = queue.enqueue({ type: 'dep', payload: 'first' });
      queue.enqueue({
        type: 'dep',
        payload: 'second',
        dependencies: [j1!.id],
      });

      queue.start();
      await wait(200);

      expect(order).toEqual(['first', 'second']);
    });

    it('should not execute if dependency not yet complete', async () => {
      let secondExecuted = false;

      queue.registerHandler('slow', async () => {
        await wait(200);
      });
      queue.registerHandler('fast', async () => {
        secondExecuted = true;
      });

      const dep = queue.enqueue({ type: 'slow', payload: null });
      queue.enqueue({
        type: 'fast',
        payload: null,
        dependencies: [dep!.id],
      });

      queue.start();
      await wait(50);

      expect(secondExecuted).toBe(false);

      await wait(300);
      expect(secondExecuted).toBe(true);
    });
  });

  // ── Groups ────────────────────────────────────────────────────────────

  describe('job groups', () => {
    it('should batch enqueue with group ID', () => {
      const jobs = queue.enqueueBatch([
        { type: 'test', payload: 1 },
        { type: 'test', payload: 2 },
        { type: 'test', payload: 3 },
      ], 'batch-1');

      expect(jobs).toHaveLength(3);
      expect(jobs.every((j) => j.groupId === 'batch-1')).toBe(true);
    });

    it('should track group progress', async () => {
      queue.registerHandler('test', async () => {});

      queue.enqueueBatch([
        { type: 'test', payload: 1 },
        { type: 'test', payload: 2 },
        { type: 'test', payload: 3 },
      ], 'grp-progress');

      const before = queue.getGroupProgress('grp-progress');
      expect(before.total).toBe(3);
      expect(before.pending).toBe(3);

      queue.start();
      await wait(200);

      const after = queue.getGroupProgress('grp-progress');
      expect(after.completed).toBe(3);
      expect(after.overallProgress).toBe(100);
    });

    it('should detect group completion', async () => {
      queue.registerHandler('test', async () => {});

      queue.enqueueBatch([
        { type: 'test', payload: 1 },
        { type: 'test', payload: 2 },
      ], 'grp-done');

      expect(queue.isGroupComplete('grp-done')).toBe(false);

      queue.start();
      await wait(200);

      expect(queue.isGroupComplete('grp-done')).toBe(true);
    });

    it('should return empty progress for unknown groups', () => {
      const progress = queue.getGroupProgress('nonexistent');
      expect(progress.total).toBe(0);
    });
  });

  // ── TTL / Expiry ──────────────────────────────────────────────────────

  describe('TTL', () => {
    it('should expire old pending jobs', async () => {
      // Register handler but make the job expire before it runs
      // by not starting the queue until after TTL
      const job = queue.enqueue({
        type: 'test',
        payload: null,
        ttlMs: 30, // 30ms TTL
      });

      // Wait for TTL to pass, THEN start to trigger tick
      await wait(50);
      queue.start();
      await wait(50);

      const result = queue.getJob(job!.id);
      // Job should be expired (cancelled via TTL)
      expect(result!.status).toBe('cancelled');
      expect(queue.getMetrics().totalExpired).toBe(1);
    });
  });

  // ── Timeout ───────────────────────────────────────────────────────────

  describe('timeout', () => {
    it('should timeout long-running jobs', async () => {
      queue.registerHandler('slow', async () => {
        await wait(5000); // 5 seconds
      });

      const job = queue.enqueue({
        type: 'slow',
        payload: null,
        timeoutMs: 50,
        maxRetries: 0,
      });

      queue.start();
      await wait(200);

      const result = queue.getJob(job!.id);
      expect(result!.error).toContain('timed out');
    });
  });

  // ── Dead Letter Queue ─────────────────────────────────────────────────

  describe('dead letter queue', () => {
    it('should store permanently failed jobs', async () => {
      queue.registerHandler('fail', async () => { throw new Error('permanent'); });

      queue.enqueue({ type: 'fail', payload: 'dlq', maxRetries: 0 });
      queue.start();
      await wait(100);

      const dlq = queue.getDeadLetters();
      expect(dlq).toHaveLength(1);
      expect(dlq[0].payload).toBe('dlq');
    });

    it('should filter dead letters by type', async () => {
      queue.registerHandler('a', async () => { throw new Error(); });
      queue.registerHandler('b', async () => { throw new Error(); });

      queue.enqueue({ type: 'a', payload: null, maxRetries: 0 });
      queue.enqueue({ type: 'b', payload: null, maxRetries: 0 });
      queue.start();
      await wait(100);

      expect(queue.getDeadLetters({ type: 'a' })).toHaveLength(1);
      expect(queue.getDeadLetters({ type: 'b' })).toHaveLength(1);
    });

    it('should retry dead letters', async () => {
      let attempts = 0;
      queue.registerHandler('retry-dlq', async () => {
        attempts++;
        if (attempts < 2) throw new Error('not yet');
      });

      queue.enqueue({ type: 'retry-dlq', payload: null, maxRetries: 0 });
      queue.start();
      await wait(100);

      expect(queue.getDeadLetters()).toHaveLength(1);

      const dlJob = queue.getDeadLetters()[0];
      const retried = queue.retryDeadLetter(dlJob.id);
      expect(retried).not.toBeNull();

      await wait(100);
      expect(queue.getMetrics().totalCompleted).toBeGreaterThanOrEqual(1);
    });

    it('should clear dead letters', async () => {
      queue.registerHandler('fail', async () => { throw new Error(); });
      queue.enqueue({ type: 'fail', payload: null, maxRetries: 0 });
      queue.enqueue({ type: 'fail', payload: null, maxRetries: 0 });
      queue.start();
      await wait(100);

      expect(queue.clearDeadLetters()).toBe(2);
      expect(queue.getDeadLetters()).toHaveLength(0);
    });
  });

  // ── Query ──────────────────────────────────────────────────────────────

  describe('query', () => {
    it('should get jobs by status', () => {
      queue.enqueue({ type: 'test', payload: 1 });
      queue.enqueue({ type: 'test', payload: 2 });

      expect(queue.getJobsByStatus('pending')).toHaveLength(2);
      expect(queue.getJobsByStatus('completed')).toHaveLength(0);
    });

    it('should get jobs by type', () => {
      queue.enqueue({ type: 'a', payload: 1 });
      queue.enqueue({ type: 'b', payload: 2 });
      queue.enqueue({ type: 'a', payload: 3 });

      expect(queue.getJobsByType('a')).toHaveLength(2);
      expect(queue.getJobsByType('b')).toHaveLength(1);
    });

    it('should count pending and running', () => {
      queue.enqueue({ type: 'test', payload: 1 });
      queue.enqueue({ type: 'test', payload: 2 });

      expect(queue.getPendingCount()).toBe(2);
      expect(queue.getRunningCount()).toBe(0);
    });
  });

  // ── Cleanup ───────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('should purge completed jobs', async () => {
      queue.registerHandler('test', async () => {});
      queue.enqueue({ type: 'test', payload: 1 });
      queue.enqueue({ type: 'test', payload: 2 });
      queue.start();
      await wait(100);

      const purged = queue.purgeCompleted();
      expect(purged).toBe(2);
      expect(queue.getJobsByStatus('completed')).toHaveLength(0);
    });
  });

  // ── Metrics ───────────────────────────────────────────────────────────

  describe('metrics', () => {
    it('should track enqueue counts', () => {
      queue.enqueue({ type: 'test', payload: 1 });
      queue.enqueue({ type: 'test', payload: 2 });

      expect(queue.getMetrics().totalEnqueued).toBe(2);
    });

    it('should track completion and type stats', async () => {
      queue.registerHandler('a', async () => {});
      queue.registerHandler('b', async () => { throw new Error(); });

      queue.enqueue({ type: 'a', payload: null });
      queue.enqueue({ type: 'b', payload: null, maxRetries: 0 });
      queue.start();
      await wait(200);

      const metrics = queue.getMetrics();
      expect(metrics.totalCompleted).toBe(1);
      expect(metrics.typeCounts['a']?.completed).toBe(1);
      expect(metrics.typeCounts['b']?.failed).toBe(1);
    });
  });

  // ── Event Hooks ───────────────────────────────────────────────────────

  describe('event hooks', () => {
    it('should fire onComplete callback', async () => {
      const completed: string[] = [];
      queue.onComplete((job) => completed.push(job.type));

      queue.registerHandler('test', async () => {});
      queue.enqueue({ type: 'test', payload: null });
      queue.start();
      await wait(100);

      expect(completed).toEqual(['test']);
    });

    it('should fire onFailed callback', async () => {
      const failed: string[] = [];
      queue.onFailed((job) => failed.push(job.error!));

      queue.registerHandler('fail', async () => { throw new Error('boom'); });
      queue.enqueue({ type: 'fail', payload: null, maxRetries: 0 });
      queue.start();
      await wait(100);

      expect(failed).toEqual(['boom']);
    });
  });

  // ── Voice Summary ─────────────────────────────────────────────────────

  describe('voice summary', () => {
    it('should generate summary with activity', async () => {
      queue.registerHandler('test', async () => {});
      queue.enqueue({ type: 'test', payload: null });
      queue.start();
      await wait(100);

      const summary = queue.getVoiceSummary();
      expect(summary).toContain('completed');
    });

    it('should handle idle state', () => {
      const summary = queue.getVoiceSummary();
      expect(summary).toContain('0 completed');
    });
  });

  // ── Start / Stop ──────────────────────────────────────────────────────

  describe('start/stop', () => {
    it('should not process when stopped', async () => {
      let executed = false;
      queue.registerHandler('test', async () => { executed = true; });
      queue.enqueue({ type: 'test', payload: null });

      await wait(50);
      expect(executed).toBe(false);
    });

    it('should report running state', () => {
      expect(queue.isRunning()).toBe(false);
      queue.start();
      expect(queue.isRunning()).toBe(true);
      queue.stop();
      expect(queue.isRunning()).toBe(false);
    });
  });

  // ── Destroy ───────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should clean up all state', () => {
      queue.registerHandler('test', async () => {});
      queue.enqueue({ type: 'test', payload: null });

      queue.destroy();

      expect(queue.isRunning()).toBe(false);
      expect(queue.getPendingCount()).toBe(0);
      expect(queue.getRegisteredTypes()).toHaveLength(0);
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle multiple starts gracefully', () => {
      queue.start();
      queue.start(); // should not throw
      expect(queue.isRunning()).toBe(true);
    });

    it('should handle cancel of nonexistent job', () => {
      expect(queue.cancelJob('nonexistent')).toBe(false);
    });

    it('should handle batch enqueue with auto-generated group ID', () => {
      const jobs = queue.enqueueBatch([
        { type: 'test', payload: 1 },
        { type: 'test', payload: 2 },
      ]);

      expect(jobs).toHaveLength(2);
      expect(jobs[0].groupId).toBeDefined();
      expect(jobs[0].groupId).toBe(jobs[1].groupId);
    });
  });
});
