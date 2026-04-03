/**
 * Background Job Queue — Async Processing Engine
 *
 * Handles deferred work: image analysis, report generation, exports,
 * webhook delivery, notifications, and any task that shouldn't block
 * the main request/voice pipeline.
 *
 * Features:
 * - Priority queue with 4 levels (critical > high > normal > low)
 * - Concurrency control (configurable max workers)
 * - Job lifecycle: pending → running → completed/failed/cancelled
 * - Retry with exponential backoff + max retries
 * - Job dependencies: wait for prerequisite jobs to complete
 * - Deduplication by idempotency key
 * - Scheduled jobs (run after delay)
 * - Job groups: batch related jobs, wait for all to complete
 * - TTL: auto-expire old jobs
 * - Progress tracking: jobs report 0-100% progress
 * - Dead letter queue for permanently failed jobs
 * - Metrics: throughput, latency, success rate, queue depth
 * - Voice summary for status reporting
 *
 * 🌙 Night Shift Agent — Night #30
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type JobPriority = 'critical' | 'high' | 'normal' | 'low';

export type JobStatus = 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dead';

const PRIORITY_WEIGHT: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export interface JobDefinition {
  type: string;
  payload: unknown;
  priority?: JobPriority;
  maxRetries?: number;
  retryDelayMs?: number; // base delay for exponential backoff
  timeoutMs?: number;
  ttlMs?: number; // auto-expire if not started within this time
  idempotencyKey?: string; // prevent duplicate jobs
  dependencies?: string[]; // job IDs that must complete first
  groupId?: string; // group related jobs
  scheduledFor?: number; // timestamp to run at
  metadata?: Record<string, unknown>;
}

export interface Job extends Required<Pick<JobDefinition, 'type' | 'payload' | 'priority'>> {
  id: string;
  status: JobStatus;
  retries: number;
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
  ttlMs: number;
  idempotencyKey?: string;
  dependencies: string[];
  groupId?: string;
  scheduledFor?: number;
  metadata: Record<string, unknown>;
  progress: number; // 0-100
  result?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  nextRetryAt?: number;
}

export type JobHandler = (
  job: Job,
  context: JobContext
) => Promise<unknown>;

export interface JobContext {
  updateProgress: (percent: number) => void;
  isCancelled: () => boolean;
  log: (message: string) => void;
}

export interface JobQueueConfig {
  maxConcurrency?: number; // max parallel workers (default: 3)
  pollIntervalMs?: number; // how often to check for ready jobs (default: 100)
  maxQueueSize?: number; // max pending jobs (default: 10000)
  deadLetterMax?: number; // max DLQ entries (default: 100)
  defaultTimeoutMs?: number; // default job timeout (default: 30000)
  defaultMaxRetries?: number; // default max retries (default: 3)
  defaultRetryDelayMs?: number; // default base retry delay (default: 1000)
  defaultTtlMs?: number; // default TTL (default: 0 = no expiry)
}

export interface QueueMetrics {
  totalEnqueued: number;
  totalCompleted: number;
  totalFailed: number;
  totalRetried: number;
  totalCancelled: number;
  totalExpired: number;
  totalDeadLettered: number;
  currentPending: number;
  currentRunning: number;
  currentScheduled: number;
  averageLatencyMs: number;
  averageDurationMs: number;
  throughputPerMinute: number;
  typeCounts: Record<string, { completed: number; failed: number; avgDuration: number }>;
  deadLetterSize: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let jobIdCounter = 0;
function generateJobId(): string {
  return `job_${Date.now()}_${++jobIdCounter}`;
}

// ─── Job Queue ───────────────────────────────────────────────────────────────

export class JobQueue {
  private jobs: Map<string, Job> = new Map();
  private handlers: Map<string, JobHandler> = new Map();
  private activeJobs: Set<string> = new Set();
  private idempotencyIndex: Map<string, string> = new Map(); // key → jobId
  private jobLogs: Map<string, string[]> = new Map();
  private cancelledJobs: Set<string> = new Set();
  private deadLetterQueue: Job[] = [];
  private config: Required<JobQueueConfig>;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // Metrics tracking
  private _totalEnqueued = 0;
  private _totalCompleted = 0;
  private _totalFailed = 0;
  private _totalRetried = 0;
  private _totalCancelled = 0;
  private _totalExpired = 0;
  private _totalDeadLettered = 0;
  private _latencySum = 0;
  private _latencyCount = 0;
  private _durationSum = 0;
  private _durationCount = 0;
  private _completedInWindow: number[] = []; // timestamps of completions
  private _typeStats: Map<string, { completed: number; failed: number; durationSum: number; durationCount: number }> = new Map();

  // Event callbacks
  private onJobComplete?: (job: Job) => void;
  private onJobFailed?: (job: Job) => void;
  private onJobProgress?: (job: Job) => void;

  constructor(config: JobQueueConfig = {}) {
    this.config = {
      maxConcurrency: config.maxConcurrency ?? 3,
      pollIntervalMs: config.pollIntervalMs ?? 100,
      maxQueueSize: config.maxQueueSize ?? 10000,
      deadLetterMax: config.deadLetterMax ?? 100,
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30000,
      defaultMaxRetries: config.defaultMaxRetries ?? 3,
      defaultRetryDelayMs: config.defaultRetryDelayMs ?? 1000,
      defaultTtlMs: config.defaultTtlMs ?? 0,
    };
  }

  // ── Handler Registration ──────────────────────────────────────────────

  registerHandler(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  removeHandler(type: string): boolean {
    return this.handlers.delete(type);
  }

  getRegisteredTypes(): string[] {
    return [...this.handlers.keys()];
  }

  // ── Enqueue ───────────────────────────────────────────────────────────

  enqueue(definition: JobDefinition): Job | null {
    // Check queue size limit
    const pendingCount = this.getPendingCount();
    if (pendingCount >= this.config.maxQueueSize) {
      return null; // queue full
    }

    // Check idempotency
    if (definition.idempotencyKey) {
      const existingId = this.idempotencyIndex.get(definition.idempotencyKey);
      if (existingId) {
        const existing = this.jobs.get(existingId);
        if (existing && (existing.status === 'pending' || existing.status === 'running' || existing.status === 'scheduled')) {
          return existing; // return existing job
        }
        // If completed/failed/cancelled, allow re-enqueue
        this.idempotencyIndex.delete(definition.idempotencyKey);
      }
    }

    const job: Job = {
      id: generateJobId(),
      type: definition.type,
      payload: definition.payload,
      priority: definition.priority ?? 'normal',
      status: definition.scheduledFor ? 'scheduled' : 'pending',
      retries: 0,
      maxRetries: definition.maxRetries ?? this.config.defaultMaxRetries,
      retryDelayMs: definition.retryDelayMs ?? this.config.defaultRetryDelayMs,
      timeoutMs: definition.timeoutMs ?? this.config.defaultTimeoutMs,
      ttlMs: definition.ttlMs ?? this.config.defaultTtlMs,
      idempotencyKey: definition.idempotencyKey,
      dependencies: definition.dependencies ?? [],
      groupId: definition.groupId,
      scheduledFor: definition.scheduledFor,
      metadata: definition.metadata ?? {},
      progress: 0,
      createdAt: Date.now(),
    };

    this.jobs.set(job.id, job);
    this._totalEnqueued++;

    if (definition.idempotencyKey) {
      this.idempotencyIndex.set(definition.idempotencyKey, job.id);
    }

    // Immediately try to process if queue is running
    if (this.running) {
      this.processNext();
    }

    return job;
  }

  // ── Batch Enqueue ─────────────────────────────────────────────────────

  enqueueBatch(definitions: JobDefinition[], groupId?: string): Job[] {
    const gid = groupId ?? `grp_${Date.now()}_${++jobIdCounter}`;
    const jobs: Job[] = [];

    for (const def of definitions) {
      const job = this.enqueue({ ...def, groupId: gid });
      if (job) jobs.push(job);
    }

    return jobs;
  }

  // ── Start / Stop ──────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    this.pollTimer = setInterval(() => {
      this.tick();
    }, this.config.pollIntervalMs);

    // Run tick first (handles TTL expiry, scheduled jobs, retries), then process
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private tick(): void {
    // Check for scheduled jobs that are ready
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.status === 'scheduled' && job.scheduledFor && job.scheduledFor <= now) {
        job.status = 'pending';
      }
    }

    // Check for TTL-expired pending jobs
    for (const job of this.jobs.values()) {
      if (job.status === 'pending' && job.ttlMs > 0) {
        if (now - job.createdAt > job.ttlMs) {
          job.status = 'cancelled';
          this._totalExpired++;
        }
      }
    }

    // Check for retry-ready jobs
    for (const job of this.jobs.values()) {
      if (job.status === 'failed' && job.nextRetryAt && job.nextRetryAt <= now) {
        if (job.retries < job.maxRetries) {
          job.status = 'pending';
          job.nextRetryAt = undefined;
        }
      }
    }

    this.processNext();
  }

  private processNext(): void {
    if (!this.running) return;
    if (this.activeJobs.size >= this.config.maxConcurrency) return;

    const nextJob = this.getNextJob();
    if (!nextJob) return;

    this.executeJob(nextJob);

    // Try to fill remaining slots
    if (this.activeJobs.size < this.config.maxConcurrency) {
      // Use setImmediate-like pattern to avoid stack overflow
      setTimeout(() => this.processNext(), 0);
    }
  }

  private getNextJob(): Job | null {
    // Find pending jobs sorted by priority, then creation time
    const candidates: Job[] = [];

    for (const job of this.jobs.values()) {
      if (job.status !== 'pending') continue;

      // Check dependencies
      if (job.dependencies.length > 0) {
        const allDepsComplete = job.dependencies.every((depId) => {
          const dep = this.jobs.get(depId);
          return dep && dep.status === 'completed';
        });
        if (!allDepsComplete) continue;
      }

      candidates.push(job);
    }

    if (candidates.length === 0) return null;

    // Sort by priority then createdAt
    candidates.sort((a, b) => {
      const pd = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (pd !== 0) return pd;
      return a.createdAt - b.createdAt;
    });

    return candidates[0];
  }

  private async executeJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = 'failed';
      job.error = `No handler registered for job type: ${job.type}`;
      this._totalFailed++;
      this.moveToDeadLetter(job);
      return;
    }

    job.status = 'running';
    job.startedAt = Date.now();
    this.activeJobs.add(job.id);

    const context: JobContext = {
      updateProgress: (percent: number) => {
        job.progress = Math.max(0, Math.min(100, percent));
        this.onJobProgress?.(job);
      },
      isCancelled: () => this.cancelledJobs.has(job.id),
      log: (message: string) => {
        const logs = this.jobLogs.get(job.id) ?? [];
        logs.push(`[${new Date().toISOString()}] ${message}`);
        this.jobLogs.set(job.id, logs);
      },
    };

    // Create timeout promise
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Job timed out after ${job.timeoutMs}ms`));
      }, job.timeoutMs);
    });

    try {
      const result = await Promise.race([
        handler(job, context),
        timeoutPromise,
      ]);

      if (timeoutHandle) clearTimeout(timeoutHandle);

      // Check if cancelled during execution
      if (this.cancelledJobs.has(job.id)) {
        job.status = 'cancelled';
        this._totalCancelled++;
        this.cancelledJobs.delete(job.id);
      } else {
        job.status = 'completed';
        job.result = result;
        job.progress = 100;
        job.completedAt = Date.now();
        this._totalCompleted++;

        // Track duration
        const duration = job.completedAt - (job.startedAt ?? job.createdAt);
        this._durationSum += duration;
        this._durationCount++;

        // Track latency (time from creation to start)
        if (job.startedAt) {
          this._latencySum += job.startedAt - job.createdAt;
          this._latencyCount++;
        }

        // Track type stats
        const ts = this._typeStats.get(job.type) ?? { completed: 0, failed: 0, durationSum: 0, durationCount: 0 };
        ts.completed++;
        ts.durationSum += duration;
        ts.durationCount++;
        this._typeStats.set(job.type, ts);

        // Track throughput window
        this._completedInWindow.push(Date.now());

        this.onJobComplete?.(job);
      }
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);

      const errorMsg = err instanceof Error ? err.message : String(err);
      job.error = errorMsg;

      if (job.retries < job.maxRetries) {
        // Schedule retry with exponential backoff
        job.retries++;
        this._totalRetried++;
        const delay = job.retryDelayMs * Math.pow(2, job.retries - 1);
        job.nextRetryAt = Date.now() + delay;
        job.status = 'failed'; // will be moved to pending by tick()
      } else {
        job.status = 'failed';
        job.completedAt = Date.now();
        this._totalFailed++;

        // Track type stats
        const ts = this._typeStats.get(job.type) ?? { completed: 0, failed: 0, durationSum: 0, durationCount: 0 };
        ts.failed++;
        this._typeStats.set(job.type, ts);

        this.moveToDeadLetter(job);
        this.onJobFailed?.(job);
      }
    } finally {
      this.activeJobs.delete(job.id);

      // Try processing next job
      if (this.running) {
        this.processNext();
      }
    }
  }

  private moveToDeadLetter(job: Job): void {
    job.status = 'dead';
    this._totalDeadLettered++;

    this.deadLetterQueue.push({ ...job });
    if (this.deadLetterQueue.length > this.config.deadLetterMax) {
      this.deadLetterQueue.shift();
    }
  }

  // ── Job Management ────────────────────────────────────────────────────

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (job.status === 'running') {
      this.cancelledJobs.add(id);
      return true;
    }

    if (job.status === 'pending' || job.status === 'scheduled') {
      job.status = 'cancelled';
      this._totalCancelled++;
      return true;
    }

    return false; // already completed/failed/cancelled
  }

  getJobLogs(id: string): string[] {
    return this.jobLogs.get(id) ?? [];
  }

  // ── Group Management ──────────────────────────────────────────────────

  getGroupJobs(groupId: string): Job[] {
    const jobs: Job[] = [];
    for (const job of this.jobs.values()) {
      if (job.groupId === groupId) jobs.push(job);
    }
    return jobs;
  }

  getGroupProgress(groupId: string): {
    total: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
    overallProgress: number;
  } {
    const jobs = this.getGroupJobs(groupId);
    const total = jobs.length;
    if (total === 0) return { total: 0, completed: 0, failed: 0, running: 0, pending: 0, overallProgress: 0 };

    const completed = jobs.filter((j) => j.status === 'completed').length;
    const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'dead').length;
    const running = jobs.filter((j) => j.status === 'running').length;
    const pending = jobs.filter((j) => j.status === 'pending' || j.status === 'scheduled').length;

    // Overall progress is average of all job progresses
    const totalProgress = jobs.reduce((sum, j) => sum + j.progress, 0);
    const overallProgress = Math.round(totalProgress / total);

    return { total, completed, failed, running, pending, overallProgress };
  }

  isGroupComplete(groupId: string): boolean {
    const jobs = this.getGroupJobs(groupId);
    if (jobs.length === 0) return false;
    return jobs.every((j) => j.status === 'completed' || j.status === 'failed' || j.status === 'dead' || j.status === 'cancelled');
  }

  // ── Query ─────────────────────────────────────────────────────────────

  getJobsByStatus(status: JobStatus): Job[] {
    return [...this.jobs.values()].filter((j) => j.status === status);
  }

  getJobsByType(type: string): Job[] {
    return [...this.jobs.values()].filter((j) => j.type === type);
  }

  getPendingCount(): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'pending' || job.status === 'scheduled') count++;
    }
    return count;
  }

  getRunningCount(): number {
    return this.activeJobs.size;
  }

  // ── Dead Letter Queue ─────────────────────────────────────────────────

  getDeadLetters(options: { type?: string; limit?: number } = {}): Job[] {
    let entries = [...this.deadLetterQueue];
    if (options.type) {
      entries = entries.filter((j) => j.type === options.type);
    }
    if (options.limit) {
      entries = entries.slice(-options.limit);
    }
    return entries;
  }

  retryDeadLetter(jobId: string): Job | null {
    const idx = this.deadLetterQueue.findIndex((j) => j.id === jobId);
    if (idx === -1) return null;

    const deadJob = this.deadLetterQueue[idx];
    this.deadLetterQueue.splice(idx, 1);

    // Re-enqueue as a new job
    return this.enqueue({
      type: deadJob.type,
      payload: deadJob.payload,
      priority: deadJob.priority,
      maxRetries: deadJob.maxRetries,
      retryDelayMs: deadJob.retryDelayMs,
      timeoutMs: deadJob.timeoutMs,
      groupId: deadJob.groupId,
      metadata: { ...deadJob.metadata, retriedFrom: deadJob.id },
    });
  }

  clearDeadLetters(): number {
    const count = this.deadLetterQueue.length;
    this.deadLetterQueue = [];
    return count;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  purgeCompleted(olderThanMs?: number): number {
    let removed = 0;
    const cutoff = olderThanMs ? Date.now() - olderThanMs : 0;

    for (const [id, job] of this.jobs.entries()) {
      if (job.status === 'completed' || job.status === 'cancelled') {
        if (!olderThanMs || (job.completedAt && job.completedAt < cutoff)) {
          this.jobs.delete(id);
          this.jobLogs.delete(id);
          if (job.idempotencyKey) this.idempotencyIndex.delete(job.idempotencyKey);
          removed++;
        }
      }
    }

    return removed;
  }

  // ── Metrics ───────────────────────────────────────────────────────────

  getMetrics(): QueueMetrics {
    // Clean up old throughput window entries (keep last 60 seconds)
    const windowStart = Date.now() - 60000;
    this._completedInWindow = this._completedInWindow.filter((t) => t >= windowStart);

    const typeCounts: Record<string, { completed: number; failed: number; avgDuration: number }> = {};
    for (const [type, stats] of this._typeStats) {
      typeCounts[type] = {
        completed: stats.completed,
        failed: stats.failed,
        avgDuration: stats.durationCount > 0 ? Math.round(stats.durationSum / stats.durationCount) : 0,
      };
    }

    return {
      totalEnqueued: this._totalEnqueued,
      totalCompleted: this._totalCompleted,
      totalFailed: this._totalFailed,
      totalRetried: this._totalRetried,
      totalCancelled: this._totalCancelled,
      totalExpired: this._totalExpired,
      totalDeadLettered: this._totalDeadLettered,
      currentPending: this.getPendingCount(),
      currentRunning: this.getRunningCount(),
      currentScheduled: this.getJobsByStatus('scheduled').length,
      averageLatencyMs: this._latencyCount > 0 ? Math.round(this._latencySum / this._latencyCount) : 0,
      averageDurationMs: this._durationCount > 0 ? Math.round(this._durationSum / this._durationCount) : 0,
      throughputPerMinute: this._completedInWindow.length,
      typeCounts,
      deadLetterSize: this.deadLetterQueue.length,
    };
  }

  // ── Event Hooks ───────────────────────────────────────────────────────

  onComplete(callback: (job: Job) => void): void {
    this.onJobComplete = callback;
  }

  onFailed(callback: (job: Job) => void): void {
    this.onJobFailed = callback;
  }

  onProgress(callback: (job: Job) => void): void {
    this.onJobProgress = callback;
  }

  // ── Voice Summary ─────────────────────────────────────────────────────

  getVoiceSummary(): string {
    const m = this.getMetrics();
    const parts: string[] = [];

    if (m.currentRunning > 0) {
      parts.push(`${m.currentRunning} jobs running.`);
    }

    if (m.currentPending > 0) {
      parts.push(`${m.currentPending} jobs waiting.`);
    }

    parts.push(`${m.totalCompleted} completed, ${m.totalFailed} failed.`);

    if (m.averageDurationMs > 0) {
      parts.push(`Average job takes ${Math.round(m.averageDurationMs / 1000)} seconds.`);
    }

    if (m.throughputPerMinute > 0) {
      parts.push(`Processing ${m.throughputPerMinute} jobs per minute.`);
    }

    if (m.deadLetterSize > 0) {
      parts.push(`${m.deadLetterSize} jobs permanently failed.`);
    }

    if (m.totalRetried > 0) {
      parts.push(`${m.totalRetried} jobs retried.`);
    }

    return parts.join(' ') || 'Job queue is idle.';
  }

  // ── Destroy ───────────────────────────────────────────────────────────

  destroy(): void {
    this.stop();
    this.jobs.clear();
    this.handlers.clear();
    this.activeJobs.clear();
    this.idempotencyIndex.clear();
    this.jobLogs.clear();
    this.cancelledJobs.clear();
    this.deadLetterQueue = [];
  }
}
