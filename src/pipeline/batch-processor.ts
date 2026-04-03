/**
 * Batch Processing Pipeline — Ray-Bans × OpenClaw
 *
 * Async image processing queue with concurrency control, priority ordering,
 * progress tracking, error recovery, and backpressure management.
 *
 * Use cases:
 * - Process a backlog of photos taken during a walk-through
 * - Re-analyze images when switching to a different agent
 * - Bulk import from phone gallery
 * - Overnight batch re-processing for improved models
 *
 * 🌙 Night Shift Agent — 2026-03-07
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export type JobPriority = 'critical' | 'high' | 'normal' | 'low';

export type JobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'cancelled'
  | 'expired';

export interface BatchJob<TInput = unknown, TOutput = unknown> {
  /** Unique job identifier */
  id: string;
  /** What kind of processing to do */
  type: JobType;
  /** Input data for processing */
  input: TInput;
  /** Priority (determines queue ordering) */
  priority: JobPriority;
  /** Current status */
  status: JobStatus;
  /** Number of attempts so far */
  attempts: number;
  /** Maximum attempts before giving up */
  maxAttempts: number;
  /** When the job was created */
  createdAt: number;
  /** When the job started processing */
  startedAt?: number;
  /** When the job finished (success or final failure) */
  completedAt?: number;
  /** Output data (on success) */
  output?: TOutput;
  /** Error message (on failure) */
  error?: string;
  /** Tags for filtering/grouping */
  tags: string[];
  /** TTL in ms — job expires if not started by this time */
  ttlMs?: number;
  /** Which batch this job belongs to (for grouped processing) */
  batchId?: string;
  /** Retry delay in ms (doubles each attempt) */
  retryDelayMs: number;
  /** Scheduled retry time (if retrying) */
  nextRetryAt?: number;
  /** Dependent job IDs — this job waits for them */
  dependsOn: string[];
  /** Metadata for tracking */
  metadata: Record<string, unknown>;
}

export type JobType =
  | 'vision_analysis'      // Run image through vision pipeline
  | 'product_lookup'       // UPC/barcode database lookup
  | 'inventory_merge'      // Merge products into inventory state
  | 'export_generate'      // Generate export file (CSV/JSON/report)
  | 'memory_index'         // Index image into memory store
  | 'agent_route'          // Route image to appropriate agent
  | 'thumbnail_generate'   // Create thumbnail for dashboard
  | 'ocr_extract'          // Extract text from image
  | 'face_detect'          // Detect faces for networking agent
  | 'barcode_scan'         // Scan for barcodes specifically
  | 'reprocess'            // Re-run previous analysis with new model/settings
  | 'custom';              // User-defined processing

export interface BatchProcessorConfig {
  /** Maximum concurrent jobs */
  maxConcurrency: number;
  /** Maximum queue depth before rejecting new jobs */
  maxQueueDepth: number;
  /** Default max attempts per job */
  defaultMaxAttempts: number;
  /** Default retry delay in ms */
  defaultRetryDelayMs: number;
  /** Maximum retry delay (cap for exponential backoff) */
  maxRetryDelayMs: number;
  /** How often to check for retry-eligible jobs (ms) */
  retryCheckIntervalMs: number;
  /** How often to check for expired jobs (ms) */
  expirationCheckIntervalMs: number;
  /** Enable processing */
  enabled: boolean;
  /** Maximum total bytes in queue (backpressure) */
  maxQueueBytes: number;
}

export const DEFAULT_BATCH_CONFIG: BatchProcessorConfig = {
  maxConcurrency: 3,
  maxQueueDepth: 500,
  defaultMaxAttempts: 3,
  defaultRetryDelayMs: 1000,
  maxRetryDelayMs: 30000,
  retryCheckIntervalMs: 5000,
  expirationCheckIntervalMs: 10000,
  enabled: true,
  maxQueueBytes: 100 * 1024 * 1024, // 100 MB
};

export interface CreateJobOptions<TInput = unknown> {
  type: JobType;
  input: TInput;
  priority?: JobPriority;
  maxAttempts?: number;
  tags?: string[];
  ttlMs?: number;
  batchId?: string;
  retryDelayMs?: number;
  dependsOn?: string[];
  metadata?: Record<string, unknown>;
}

export interface BatchStats {
  totalJobs: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  expired: number;
  retrying: number;
  avgProcessingTimeMs: number;
  totalProcessingTimeMs: number;
  throughputPerMinute: number;
  errorRate: number;
  oldestQueuedAge: number;
  currentConcurrency: number;
  maxConcurrency: number;
  queueDepth: number;
  maxQueueDepth: number;
  estimatedBytesInQueue: number;
}

export interface BatchProgress {
  batchId: string;
  totalJobs: number;
  completed: number;
  failed: number;
  processing: number;
  queued: number;
  percentComplete: number;
  estimatedRemainingMs: number;
  startedAt: number;
  elapsedMs: number;
}

export interface BatchProcessorEvents {
  'job:created': (job: BatchJob) => void;
  'job:started': (job: BatchJob) => void;
  'job:completed': (job: BatchJob) => void;
  'job:failed': (job: BatchJob) => void;
  'job:retrying': (job: BatchJob) => void;
  'job:cancelled': (job: BatchJob) => void;
  'job:expired': (job: BatchJob) => void;
  'batch:progress': (progress: BatchProgress) => void;
  'batch:completed': (batchId: string) => void;
  'queue:full': () => void;
  'queue:empty': () => void;
  'queue:backpressure': (bytesUsed: number, maxBytes: number) => void;
  'processor:paused': () => void;
  'processor:resumed': () => void;
  'error': (error: Error) => void;
}

// ─── Priority ordering ──────────────────────────────────────────

const PRIORITY_ORDER: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ─── Processor handler type ─────────────────────────────────────

export type JobHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  job: BatchJob<TInput, TOutput>
) => Promise<TOutput>;

// ─── Main class ─────────────────────────────────────────────────

let idCounter = 0;

export class BatchProcessor extends EventEmitter {
  private config: BatchProcessorConfig;
  private jobs: Map<string, BatchJob> = new Map();
  private handlers: Map<JobType, JobHandler> = new Map();
  private activeCount = 0;
  private paused = false;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private expirationTimer: ReturnType<typeof setInterval> | null = null;
  private completedProcessingTimes: number[] = [];
  private startTime: number;
  private estimatedQueueBytes = 0;

  constructor(config: Partial<BatchProcessorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_BATCH_CONFIG, ...config };
    this.startTime = Date.now();
  }

  // ─── Handler registration ───────────────────────────────────

  /**
   * Register a processing handler for a job type.
   * Each job type needs exactly one handler.
   */
  registerHandler<TInput = unknown, TOutput = unknown>(
    type: JobType,
    handler: JobHandler<TInput, TOutput>
  ): void {
    this.handlers.set(type, handler as JobHandler);
  }

  /**
   * Check if a handler is registered for a job type.
   */
  hasHandler(type: JobType): boolean {
    return this.handlers.has(type);
  }

  // ─── Job creation ───────────────────────────────────────────

  /**
   * Add a job to the processing queue.
   * Returns the created job or throws if queue is full.
   */
  enqueue<TInput = unknown>(options: CreateJobOptions<TInput>): BatchJob<TInput> {
    // Check queue depth
    const queuedCount = this.getQueuedJobs().length;
    if (queuedCount >= this.config.maxQueueDepth) {
      this.emit('queue:full');
      throw new Error(`Queue is full (${queuedCount}/${this.config.maxQueueDepth})`);
    }

    // Estimate job size for backpressure
    const estimatedSize = this.estimateJobSize(options.input);
    if (this.estimatedQueueBytes + estimatedSize > this.config.maxQueueBytes) {
      this.emit('queue:backpressure', this.estimatedQueueBytes, this.config.maxQueueBytes);
      throw new Error(`Queue byte limit exceeded (${this.estimatedQueueBytes}/${this.config.maxQueueBytes} bytes)`);
    }

    const job: BatchJob<TInput> = {
      id: this.generateId(),
      type: options.type,
      input: options.input,
      priority: options.priority || 'normal',
      status: 'queued',
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.config.defaultMaxAttempts,
      createdAt: Date.now(),
      tags: options.tags || [],
      ttlMs: options.ttlMs,
      batchId: options.batchId,
      retryDelayMs: options.retryDelayMs ?? this.config.defaultRetryDelayMs,
      dependsOn: options.dependsOn || [],
      metadata: options.metadata || {},
    };

    this.jobs.set(job.id, job as BatchJob);
    this.estimatedQueueBytes += estimatedSize;
    this.emit('job:created', job);

    // Try to process immediately
    this.processNext();

    return job;
  }

  /**
   * Enqueue multiple jobs as a batch. Returns batch ID for tracking.
   */
  enqueueBatch<TInput = unknown>(
    jobs: CreateJobOptions<TInput>[],
    batchId?: string
  ): { batchId: string; jobs: BatchJob<TInput>[] } {
    const bid = batchId || `batch-${this.generateId()}`;
    const created: BatchJob<TInput>[] = [];

    for (const jobOpts of jobs) {
      const job = this.enqueue({
        ...jobOpts,
        batchId: bid,
      });
      created.push(job);
    }

    return { batchId: bid, jobs: created };
  }

  // ─── Job management ─────────────────────────────────────────

  /**
   * Get a job by ID.
   */
  getJob(id: string): BatchJob | undefined {
    return this.jobs.get(id);
  }

  /**
   * Cancel a job. Only queued or retrying jobs can be cancelled.
   */
  cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (job.status !== 'queued' && job.status !== 'retrying') return false;

    job.status = 'cancelled';
    job.completedAt = Date.now();
    this.emit('job:cancelled', job);

    return true;
  }

  /**
   * Cancel all jobs in a batch.
   */
  cancelBatch(batchId: string): number {
    let cancelled = 0;
    for (const job of this.jobs.values()) {
      if (job.batchId === batchId && (job.status === 'queued' || job.status === 'retrying')) {
        job.status = 'cancelled';
        job.completedAt = Date.now();
        this.emit('job:cancelled', job);
        cancelled++;
      }
    }
    return cancelled;
  }

  /**
   * Clear completed, failed, cancelled, and expired jobs from memory.
   * Returns number of jobs cleared.
   */
  clearFinished(): number {
    let cleared = 0;
    const terminalStatuses: JobStatus[] = ['completed', 'failed', 'cancelled', 'expired'];

    for (const [id, job] of this.jobs.entries()) {
      if (terminalStatuses.includes(job.status)) {
        this.jobs.delete(id);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Get all jobs matching filters.
   */
  queryJobs(filters?: {
    status?: JobStatus;
    type?: JobType;
    batchId?: string;
    tag?: string;
    priority?: JobPriority;
  }): BatchJob[] {
    let results = Array.from(this.jobs.values());

    if (filters?.status) {
      results = results.filter(j => j.status === filters.status);
    }
    if (filters?.type) {
      results = results.filter(j => j.type === filters.type);
    }
    if (filters?.batchId) {
      results = results.filter(j => j.batchId === filters.batchId);
    }
    if (filters?.tag) {
      results = results.filter(j => j.tags.includes(filters.tag!));
    }
    if (filters?.priority) {
      results = results.filter(j => j.priority === filters.priority);
    }

    return results;
  }

  // ─── Processing control ─────────────────────────────────────

  /**
   * Pause processing. Active jobs will finish but no new ones start.
   */
  pause(): void {
    if (!this.paused) {
      this.paused = true;
      this.emit('processor:paused');
    }
  }

  /**
   * Resume processing after a pause.
   */
  resume(): void {
    if (this.paused) {
      this.paused = false;
      this.emit('processor:resumed');
      this.processNext();
    }
  }

  /**
   * Check if the processor is paused.
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Start periodic timers for retry checking and expiration.
   */
  startTimers(): void {
    this.stopTimers();

    this.retryTimer = setInterval(() => {
      this.checkRetries();
    }, this.config.retryCheckIntervalMs);

    this.expirationTimer = setInterval(() => {
      this.checkExpirations();
    }, this.config.expirationCheckIntervalMs);
  }

  /**
   * Stop periodic timers.
   */
  stopTimers(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.expirationTimer) {
      clearInterval(this.expirationTimer);
      this.expirationTimer = null;
    }
  }

  /**
   * Gracefully drain: wait for active jobs to finish, don't start new ones.
   */
  async drain(timeoutMs = 30000): Promise<void> {
    this.pause();

    const start = Date.now();
    while (this.activeCount > 0) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Drain timeout: ${this.activeCount} jobs still active`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // ─── Stats & Progress ───────────────────────────────────────

  /**
   * Get current processor statistics.
   */
  getStats(): BatchStats {
    const all = Array.from(this.jobs.values());
    const queued = all.filter(j => j.status === 'queued');
    const completed = all.filter(j => j.status === 'completed');
    const failed = all.filter(j => j.status === 'failed');
    const processing = all.filter(j => j.status === 'processing');
    const cancelled = all.filter(j => j.status === 'cancelled');
    const expired = all.filter(j => j.status === 'expired');
    const retrying = all.filter(j => j.status === 'retrying');

    const avgTime = this.completedProcessingTimes.length > 0
      ? this.completedProcessingTimes.reduce((a, b) => a + b, 0) / this.completedProcessingTimes.length
      : 0;

    const totalTime = this.completedProcessingTimes.reduce((a, b) => a + b, 0);

    const elapsedMinutes = Math.max((Date.now() - this.startTime) / 60000, 0.001);
    const throughput = completed.length / elapsedMinutes;

    const finishedCount = completed.length + failed.length;
    const errorRate = finishedCount > 0 ? failed.length / finishedCount : 0;

    const oldestQueued = queued.length > 0
      ? Date.now() - Math.min(...queued.map(j => j.createdAt))
      : 0;

    return {
      totalJobs: all.length,
      queued: queued.length,
      processing: processing.length,
      completed: completed.length,
      failed: failed.length,
      cancelled: cancelled.length,
      expired: expired.length,
      retrying: retrying.length,
      avgProcessingTimeMs: Math.round(avgTime),
      totalProcessingTimeMs: Math.round(totalTime),
      throughputPerMinute: Math.round(throughput * 100) / 100,
      errorRate: Math.round(errorRate * 1000) / 1000,
      oldestQueuedAge: oldestQueued,
      currentConcurrency: this.activeCount,
      maxConcurrency: this.config.maxConcurrency,
      queueDepth: queued.length + retrying.length,
      maxQueueDepth: this.config.maxQueueDepth,
      estimatedBytesInQueue: this.estimatedQueueBytes,
    };
  }

  /**
   * Get progress for a specific batch.
   */
  getBatchProgress(batchId: string): BatchProgress | null {
    const batchJobs = Array.from(this.jobs.values())
      .filter(j => j.batchId === batchId);

    if (batchJobs.length === 0) return null;

    const completed = batchJobs.filter(j => j.status === 'completed').length;
    const failed = batchJobs.filter(j => j.status === 'failed').length;
    const processing = batchJobs.filter(j => j.status === 'processing').length;
    const queued = batchJobs.filter(j =>
      j.status === 'queued' || j.status === 'retrying'
    ).length;

    const total = batchJobs.length;
    const finished = completed + failed;
    const percentComplete = total > 0 ? Math.round((finished / total) * 100) : 0;

    // Estimate remaining time based on completed jobs
    const completedJobs = batchJobs.filter(j => j.status === 'completed' && j.startedAt && j.completedAt);
    const avgTime = completedJobs.length > 0
      ? completedJobs.reduce((sum, j) => sum + (j.completedAt! - j.startedAt!), 0) / completedJobs.length
      : 0;

    const remaining = queued + processing;
    const estimatedRemainingMs = Math.round(avgTime * remaining);

    const startedAt = Math.min(...batchJobs.map(j => j.createdAt));
    const elapsedMs = Date.now() - startedAt;

    return {
      batchId,
      totalJobs: total,
      completed,
      failed,
      processing,
      queued,
      percentComplete,
      estimatedRemainingMs,
      startedAt,
      elapsedMs,
    };
  }

  /**
   * Generate a voice-friendly summary of current status.
   */
  getVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];

    if (stats.processing > 0) {
      parts.push(`Processing ${stats.processing} ${stats.processing === 1 ? 'image' : 'images'}`);
    }

    if (stats.queued > 0) {
      parts.push(`${stats.queued} in queue`);
    }

    if (stats.completed > 0) {
      parts.push(`${stats.completed} done`);
    }

    if (stats.failed > 0) {
      parts.push(`${stats.failed} failed`);
    }

    if (parts.length === 0) {
      return 'Processing queue is empty.';
    }

    let summary = parts.join('. ') + '.';

    if (stats.avgProcessingTimeMs > 0) {
      const seconds = Math.round(stats.avgProcessingTimeMs / 100) / 10;
      summary += ` Average ${seconds} seconds per item.`;
    }

    if (stats.throughputPerMinute > 0) {
      summary += ` Running at ${Math.round(stats.throughputPerMinute)} per minute.`;
    }

    return summary;
  }

  // ─── Internal processing ────────────────────────────────────

  private processNext(): void {
    if (this.paused || !this.config.enabled) return;
    if (this.activeCount >= this.config.maxConcurrency) return;

    const nextJob = this.pickNextJob();
    if (!nextJob) {
      if (this.activeCount === 0) {
        this.emit('queue:empty');
      }
      return;
    }

    this.executeJob(nextJob);
  }

  private pickNextJob(): BatchJob | null {
    const now = Date.now();
    const eligible: BatchJob[] = [];

    for (const job of this.jobs.values()) {
      if (job.status !== 'queued') continue;

      // Check TTL
      if (job.ttlMs && (now - job.createdAt) > job.ttlMs) {
        job.status = 'expired';
        job.completedAt = now;
        this.emit('job:expired', job);
        continue;
      }

      // Check dependencies
      if (job.dependsOn.length > 0) {
        const allDepsMet = job.dependsOn.every(depId => {
          const dep = this.jobs.get(depId);
          return dep && dep.status === 'completed';
        });

        // Check if any dependency failed — fail this job too
        const anyDepFailed = job.dependsOn.some(depId => {
          const dep = this.jobs.get(depId);
          return dep && (dep.status === 'failed' || dep.status === 'cancelled' || dep.status === 'expired');
        });

        if (anyDepFailed) {
          job.status = 'failed';
          job.error = 'Dependency failed';
          job.completedAt = now;
          this.emit('job:failed', job);
          continue;
        }

        if (!allDepsMet) continue;
      }

      eligible.push(job);
    }

    if (eligible.length === 0) return null;

    // Sort by priority then creation time
    eligible.sort((a, b) => {
      const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.createdAt - b.createdAt;
    });

    return eligible[0];
  }

  private async executeJob(job: BatchJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = 'failed';
      job.error = `No handler registered for job type: ${job.type}`;
      job.completedAt = Date.now();
      this.emit('job:failed', job);
      this.processNext();
      return;
    }

    job.status = 'processing';
    job.startedAt = Date.now();
    job.attempts++;
    this.activeCount++;
    this.emit('job:started', job);

    try {
      const result = await handler(job.input, job);
      job.output = result;
      job.status = 'completed';
      job.completedAt = Date.now();

      const processingTime = job.completedAt - job.startedAt;
      this.completedProcessingTimes.push(processingTime);
      // Keep only last 100 times for rolling average
      if (this.completedProcessingTimes.length > 100) {
        this.completedProcessingTimes.shift();
      }

      this.estimatedQueueBytes -= this.estimateJobSize(job.input);
      if (this.estimatedQueueBytes < 0) this.estimatedQueueBytes = 0;

      this.emit('job:completed', job);

      // Emit batch progress if part of a batch
      if (job.batchId) {
        this.emitBatchProgress(job.batchId);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (job.attempts < job.maxAttempts) {
        // Schedule retry with exponential backoff
        const delay = Math.min(
          job.retryDelayMs * Math.pow(2, job.attempts - 1),
          this.config.maxRetryDelayMs
        );
        job.status = 'retrying';
        job.error = errorMessage;
        job.nextRetryAt = Date.now() + delay;
        this.emit('job:retrying', job);
      } else {
        // Final failure
        job.status = 'failed';
        job.error = errorMessage;
        job.completedAt = Date.now();

        this.estimatedQueueBytes -= this.estimateJobSize(job.input);
        if (this.estimatedQueueBytes < 0) this.estimatedQueueBytes = 0;

        this.emit('job:failed', job);

        // Emit batch progress if part of a batch
        if (job.batchId) {
          this.emitBatchProgress(job.batchId);
        }
      }
    } finally {
      this.activeCount--;
      // Try to process more jobs
      this.processNext();
    }
  }

  private checkRetries(): void {
    const now = Date.now();

    for (const job of this.jobs.values()) {
      if (job.status === 'retrying' && job.nextRetryAt && now >= job.nextRetryAt) {
        job.status = 'queued';
        job.nextRetryAt = undefined;
      }
    }

    this.processNext();
  }

  private checkExpirations(): void {
    const now = Date.now();

    for (const job of this.jobs.values()) {
      if (job.status === 'queued' && job.ttlMs) {
        if ((now - job.createdAt) > job.ttlMs) {
          job.status = 'expired';
          job.completedAt = now;
          this.emit('job:expired', job);
        }
      }
    }
  }

  private emitBatchProgress(batchId: string): void {
    const progress = this.getBatchProgress(batchId);
    if (progress) {
      this.emit('batch:progress', progress);

      // Check if batch is fully done
      if (progress.completed + progress.failed === progress.totalJobs) {
        this.emit('batch:completed', batchId);
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private getQueuedJobs(): BatchJob[] {
    return Array.from(this.jobs.values())
      .filter(j => j.status === 'queued' || j.status === 'retrying');
  }

  private estimateJobSize(input: unknown): number {
    if (!input) return 100;
    if (typeof input === 'string') return input.length;
    if (Buffer.isBuffer(input)) return input.length;
    if (typeof input === 'object' && input !== null) {
      // Check for buffer-like fields
      const obj = input as Record<string, unknown>;
      if (obj.buffer && Buffer.isBuffer(obj.buffer)) {
        return (obj.buffer as Buffer).length + 500;
      }
      if (typeof obj.size === 'number') return obj.size;
    }
    // Default estimate for general objects
    return 1024;
  }

  private generateId(): string {
    idCounter++;
    return `job-${Date.now()}-${idCounter}`;
  }
}
