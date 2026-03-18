/**
 * Offline Queue & Sync Engine
 *
 * Handles store-and-forward when connectivity drops — essential for real-world
 * inventory walks in warehouses, basements, and other spotty-signal environments.
 *
 * Features:
 * - Priority-based operation queue (critical > high > normal > low)
 * - Automatic retry with exponential backoff on failures
 * - Connectivity monitoring with online/offline state machine
 * - Batch drain when connectivity is restored
 * - Disk-based persistence (operations survive app restart)
 * - Conflict detection on sync (stale data, version mismatch)
 * - Ordered processing with dependency tracking (op B depends on op A)
 * - Max queue size with eviction of low-priority items
 * - TTL: operations expire if not processed within a configurable window
 * - Progress tracking and voice-friendly status summaries
 * - Metrics: queue depth, drain rate, failure counts, offline duration
 *
 * @module offline/offline-queue
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export type OperationPriority = 'critical' | 'high' | 'normal' | 'low';
export type OperationStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired' | 'evicted';
export type ConnectivityState = 'online' | 'offline' | 'degraded';

/** Numeric priority for sorting (higher = more important) */
const PRIORITY_WEIGHT: Record<OperationPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export interface QueuedOperation {
  id: string;
  /** Type of operation (e.g., 'vision_analysis', 'product_lookup', 'usage_report') */
  type: string;
  /** Serializable payload */
  payload: Record<string, unknown>;
  /** Priority level */
  priority: OperationPriority;
  /** Current status */
  status: OperationStatus;
  /** When this operation was enqueued */
  enqueuedAt: string;
  /** When processing started (if applicable) */
  processingAt?: string;
  /** When processing completed (if applicable) */
  completedAt?: string;
  /** Number of processing attempts */
  attempts: number;
  /** Maximum allowed attempts */
  maxAttempts: number;
  /** Last error message */
  lastError?: string;
  /** Operation this depends on (must complete first) */
  dependsOn?: string;
  /** Time-to-live in ms (from enqueue time) */
  ttlMs: number;
  /** Result data (if completed) */
  result?: unknown;
  /** Size estimate in bytes (for queue capacity management) */
  sizeBytes: number;
}

export interface OfflineQueueConfig {
  /** Maximum number of operations in the queue */
  maxQueueSize: number;
  /** Maximum total size in bytes */
  maxQueueBytes: number;
  /** Default TTL for operations in ms (default: 24 hours) */
  defaultTtlMs: number;
  /** Default max attempts per operation */
  defaultMaxAttempts: number;
  /** Base delay for exponential backoff in ms */
  retryBaseDelayMs: number;
  /** Maximum delay for retries in ms */
  retryMaxDelayMs: number;
  /** Batch size when draining queue */
  drainBatchSize: number;
  /** Delay between drain batches in ms */
  drainBatchDelayMs: number;
  /** How often to check connectivity (ms) */
  connectivityCheckIntervalMs: number;
  /** Connectivity check function */
  connectivityCheck?: () => Promise<boolean>;
  /** Operation processor: executes a queued operation */
  processor: (operation: QueuedOperation) => Promise<unknown>;
}

export interface QueueMetrics {
  /** Current queue depth */
  depth: number;
  /** Total bytes in queue */
  totalBytes: number;
  /** Breakdown by priority */
  byPriority: Record<OperationPriority, number>;
  /** Breakdown by status */
  byStatus: Record<OperationStatus, number>;
  /** Total operations ever enqueued */
  totalEnqueued: number;
  /** Total operations successfully processed */
  totalCompleted: number;
  /** Total operations that failed (exhausted retries) */
  totalFailed: number;
  /** Total operations expired */
  totalExpired: number;
  /** Total operations evicted (queue full) */
  totalEvicted: number;
  /** Current connectivity state */
  connectivity: ConnectivityState;
  /** Total time offline in this session (ms) */
  totalOfflineMs: number;
  /** Time of last successful drain */
  lastDrainAt?: string;
  /** Average processing time (ms) */
  avgProcessingTimeMs: number;
  /** Drain rate (operations per minute) */
  drainRatePerMin: number;
  /** Whether queue is currently draining */
  isDraining: boolean;
}

export interface SyncConflict {
  operationId: string;
  type: string;
  reason: 'stale_data' | 'version_mismatch' | 'dependency_failed' | 'server_rejected';
  localData: unknown;
  remoteData?: unknown;
  resolvedAt?: string;
  resolution?: 'local_wins' | 'remote_wins' | 'merged' | 'discarded';
}

// ─── Default Config ─────────────────────────────────────────────

const DEFAULT_CONFIG: Partial<OfflineQueueConfig> = {
  maxQueueSize: 1000,
  maxQueueBytes: 50 * 1024 * 1024, // 50MB
  defaultTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  defaultMaxAttempts: 5,
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 60000,
  drainBatchSize: 10,
  drainBatchDelayMs: 500,
  connectivityCheckIntervalMs: 30000,
};

// ─── Main Class ─────────────────────────────────────────────────

export class OfflineQueue extends EventEmitter {
  private queue: Map<string, QueuedOperation> = new Map();
  private config: OfflineQueueConfig;
  private connectivity: ConnectivityState = 'online';
  private isDraining: boolean = false;
  private idCounter: number = 0;
  private connectivityTimer?: ReturnType<typeof setInterval>;
  private offlineStartTime?: number;

  // Metrics counters
  private totalEnqueued: number = 0;
  private totalCompleted: number = 0;
  private totalFailed: number = 0;
  private totalExpired: number = 0;
  private totalEvicted: number = 0;
  private totalOfflineMs: number = 0;
  private lastDrainAt?: string;
  private processingTimes: number[] = [];
  private drainCompletedCount: number = 0;
  private drainStartTime?: number;

  // Conflicts
  private conflicts: SyncConflict[] = [];

  constructor(config: OfflineQueueConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config } as OfflineQueueConfig;
  }

  // ─── Enqueue ────────────────────────────────────────────────

  /**
   * Add an operation to the offline queue
   */
  enqueue(
    type: string,
    payload: Record<string, unknown>,
    options?: Partial<Pick<QueuedOperation, 'priority' | 'maxAttempts' | 'ttlMs' | 'dependsOn' | 'sizeBytes'>>,
  ): QueuedOperation {
    // Clean expired operations first
    this.cleanExpired();

    const priority = options?.priority || 'normal';
    const sizeBytes = options?.sizeBytes || this.estimateSize(payload);

    // Check queue capacity
    if (this.queue.size >= this.config.maxQueueSize) {
      const evicted = this.evictLowest(priority);
      if (!evicted) {
        throw new Error('Queue is full and no lower-priority operations to evict');
      }
    }

    // Check byte capacity
    const currentBytes = this.getTotalBytes();
    if (currentBytes + sizeBytes > this.config.maxQueueBytes) {
      const needed = (currentBytes + sizeBytes) - this.config.maxQueueBytes;
      const evicted = this.evictForSpace(needed, priority);
      if (!evicted) {
        throw new Error('Queue is full (bytes) and cannot make room');
      }
    }

    const operation: QueuedOperation = {
      id: this.nextId(),
      type,
      payload,
      priority,
      status: 'pending',
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: options?.maxAttempts || this.config.defaultMaxAttempts,
      dependsOn: options?.dependsOn,
      ttlMs: options?.ttlMs || this.config.defaultTtlMs,
      sizeBytes,
    };

    this.queue.set(operation.id, operation);
    this.totalEnqueued++;

    this.emit('operation:enqueued', { id: operation.id, type, priority });

    return operation;
  }

  /**
   * Get an operation by ID
   */
  getOperation(id: string): QueuedOperation | undefined {
    return this.queue.get(id);
  }

  /**
   * Get all pending operations sorted by priority (highest first)
   */
  getPending(): QueuedOperation[] {
    return Array.from(this.queue.values())
      .filter(op => op.status === 'pending')
      .sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
  }

  /**
   * Remove a specific operation
   */
  remove(id: string): boolean {
    return this.queue.delete(id);
  }

  /**
   * Clear all operations
   */
  clear(): void {
    this.queue.clear();
    this.emit('queue:cleared');
  }

  // ─── Connectivity Management ────────────────────────────────

  /**
   * Set connectivity state manually
   */
  setConnectivity(state: ConnectivityState): void {
    const previous = this.connectivity;
    if (previous === state) return;

    this.connectivity = state;

    if (state === 'offline' && previous !== 'offline') {
      this.offlineStartTime = Date.now();
      this.emit('connectivity:offline');
    } else if (state === 'online' && previous !== 'online') {
      if (this.offlineStartTime) {
        this.totalOfflineMs += Date.now() - this.offlineStartTime;
        this.offlineStartTime = undefined;
      }
      this.emit('connectivity:online');

      // Auto-drain when back online (fire-and-forget, errors caught to avoid unhandled rejection)
      if (!this.isDraining && this.getPending().length > 0) {
        this.startDrain().catch(() => {});
      }
    } else if (state === 'degraded') {
      this.emit('connectivity:degraded');
    }

    this.emit('connectivity:changed', { previous, current: state });
  }

  /**
   * Get current connectivity state
   */
  getConnectivity(): ConnectivityState {
    return this.connectivity;
  }

  /**
   * Start periodic connectivity checking
   */
  startConnectivityMonitoring(): void {
    if (this.connectivityTimer) return;
    if (!this.config.connectivityCheck) return;

    this.connectivityTimer = setInterval(async () => {
      try {
        const isOnline = await this.config.connectivityCheck!();
        this.setConnectivity(isOnline ? 'online' : 'offline');
      } catch {
        this.setConnectivity('offline');
      }
    }, this.config.connectivityCheckIntervalMs);
  }

  /**
   * Stop connectivity monitoring
   */
  stopConnectivityMonitoring(): void {
    if (this.connectivityTimer) {
      clearInterval(this.connectivityTimer);
      this.connectivityTimer = undefined;
    }
  }

  // ─── Queue Draining ─────────────────────────────────────────

  /**
   * Start draining the queue (process pending operations)
   */
  async startDrain(): Promise<void> {
    if (this.isDraining) return;
    if (this.connectivity === 'offline') return;

    this.isDraining = true;
    this.drainStartTime = Date.now();
    this.drainCompletedCount = 0;
    this.emit('drain:started');

    try {
      let batch: QueuedOperation[];

      while (true) {
        // Get next batch of processable operations
        batch = this.getNextBatch();
        if (batch.length === 0) break;
        if (this.connectivity === 'offline') break;

        // Process batch
        await Promise.all(batch.map(op => this.processOperation(op)));

        this.emit('drain:batch_completed', { processed: batch.length, remaining: this.getPending().length });

        // Brief delay between batches to avoid overwhelming the API
        if (this.config.drainBatchDelayMs > 0 && this.getPending().length > 0) {
          await this.delay(this.config.drainBatchDelayMs);
        }
      }
    } finally {
      this.isDraining = false;
      this.lastDrainAt = new Date().toISOString();
      this.emit('drain:completed', {
        processed: this.drainCompletedCount,
        remaining: this.getPending().length,
      });
    }
  }

  /**
   * Process a single operation
   */
  private async processOperation(operation: QueuedOperation): Promise<void> {
    // Check if expired
    const enqueued = new Date(operation.enqueuedAt).getTime();
    if (Date.now() - enqueued > operation.ttlMs) {
      operation.status = 'expired';
      this.totalExpired++;
      this.emit('operation:expired', { id: operation.id, type: operation.type });
      return;
    }

    // Check dependency
    if (operation.dependsOn) {
      const dep = this.queue.get(operation.dependsOn);
      if (dep && dep.status !== 'completed') {
        // Dependency not yet complete, skip for now
        return;
      }
      if (dep && dep.status === 'failed') {
        // Dependency failed, mark conflict
        operation.status = 'failed';
        operation.lastError = `Dependency ${operation.dependsOn} failed`;
        this.totalFailed++;
        this.addConflict(operation.id, operation.type, 'dependency_failed', operation.payload);
        this.emit('operation:failed', { id: operation.id, error: operation.lastError });
        return;
      }
    }

    operation.status = 'processing';
    operation.processingAt = new Date().toISOString();
    operation.attempts++;

    const startTime = Date.now();

    try {
      const result = await this.config.processor(operation);
      operation.status = 'completed';
      operation.completedAt = new Date().toISOString();
      operation.result = result;
      this.totalCompleted++;
      this.drainCompletedCount++;

      const processingTime = Date.now() - startTime;
      this.processingTimes.push(processingTime);
      // Keep only last 100 timing samples
      if (this.processingTimes.length > 100) {
        this.processingTimes = this.processingTimes.slice(-100);
      }

      this.emit('operation:completed', { id: operation.id, type: operation.type, result, processingTimeMs: processingTime });
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      operation.lastError = errorMessage;

      // Check for specific error types
      if (errorMessage.includes('version_mismatch') || errorMessage.includes('conflict')) {
        operation.status = 'failed';
        this.totalFailed++;
        this.addConflict(operation.id, operation.type, 'version_mismatch', operation.payload);
        this.emit('operation:conflict', { id: operation.id, error: errorMessage });
        return;
      }

      if (errorMessage.includes('rejected') || errorMessage.includes('forbidden') || errorMessage.includes('unauthorized')) {
        operation.status = 'failed';
        this.totalFailed++;
        this.addConflict(operation.id, operation.type, 'server_rejected', operation.payload);
        this.emit('operation:rejected', { id: operation.id, error: errorMessage });
        return;
      }

      // Retryable failure
      if (operation.attempts < operation.maxAttempts) {
        operation.status = 'pending';
        this.emit('operation:retry', { id: operation.id, attempt: operation.attempts, error: errorMessage });
      } else {
        operation.status = 'failed';
        this.totalFailed++;
        this.emit('operation:failed', { id: operation.id, type: operation.type, error: errorMessage, attempts: operation.attempts });
      }
    }
  }

  /**
   * Get next batch of processable operations
   */
  private getNextBatch(): QueuedOperation[] {
    const pending = this.getPending();
    const batch: QueuedOperation[] = [];

    for (const op of pending) {
      if (batch.length >= this.config.drainBatchSize) break;

      // Check dependency satisfaction
      if (op.dependsOn) {
        const dep = this.queue.get(op.dependsOn);
        if (dep && dep.status !== 'completed' && dep.status !== 'failed') {
          continue; // Dependency still pending/processing
        }
      }

      // Check retry delay (exponential backoff)
      if (op.attempts > 0) {
        const delay = Math.min(
          this.config.retryBaseDelayMs * Math.pow(2, op.attempts - 1),
          this.config.retryMaxDelayMs,
        );
        const lastAttemptTime = op.processingAt ? new Date(op.processingAt).getTime() : 0;
        if (Date.now() - lastAttemptTime < delay) {
          continue; // Not enough time has passed for retry
        }
      }

      batch.push(op);
    }

    return batch;
  }

  // ─── Conflict Management ────────────────────────────────────

  /**
   * Get all unresolved conflicts
   */
  getConflicts(): SyncConflict[] {
    return this.conflicts.filter(c => !c.resolvedAt);
  }

  /**
   * Resolve a conflict
   */
  resolveConflict(operationId: string, resolution: SyncConflict['resolution']): boolean {
    const conflict = this.conflicts.find(c => c.operationId === operationId && !c.resolvedAt);
    if (!conflict) return false;

    conflict.resolvedAt = new Date().toISOString();
    conflict.resolution = resolution;

    this.emit('conflict:resolved', { operationId, resolution });
    return true;
  }

  private addConflict(operationId: string, type: string, reason: SyncConflict['reason'], localData: unknown): void {
    this.conflicts.push({
      operationId,
      type,
      reason,
      localData,
    });
  }

  // ─── Metrics ────────────────────────────────────────────────

  /**
   * Get queue metrics
   */
  getMetrics(): QueueMetrics {
    const ops = Array.from(this.queue.values());

    const byPriority: Record<OperationPriority, number> = { critical: 0, high: 0, normal: 0, low: 0 };
    const byStatus: Record<OperationStatus, number> = { pending: 0, processing: 0, completed: 0, failed: 0, expired: 0, evicted: 0 };
    let totalBytes = 0;

    for (const op of ops) {
      byPriority[op.priority] = (byPriority[op.priority] || 0) + 1;
      byStatus[op.status] = (byStatus[op.status] || 0) + 1;
      totalBytes += op.sizeBytes;
    }

    const avgProcessingTime = this.processingTimes.length > 0
      ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
      : 0;

    let drainRate = 0;
    if (this.isDraining && this.drainStartTime && this.drainCompletedCount > 0) {
      const elapsed = (Date.now() - this.drainStartTime) / 60000; // minutes
      drainRate = elapsed > 0 ? this.drainCompletedCount / elapsed : 0;
    }

    let currentOffline = 0;
    if (this.offlineStartTime) {
      currentOffline = Date.now() - this.offlineStartTime;
    }

    return {
      depth: ops.filter(op => op.status === 'pending' || op.status === 'processing').length,
      totalBytes,
      byPriority,
      byStatus,
      totalEnqueued: this.totalEnqueued,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
      totalExpired: this.totalExpired,
      totalEvicted: this.totalEvicted,
      connectivity: this.connectivity,
      totalOfflineMs: this.totalOfflineMs + currentOffline,
      lastDrainAt: this.lastDrainAt,
      avgProcessingTimeMs: Math.round(avgProcessingTime),
      drainRatePerMin: Math.round(drainRate * 10) / 10,
      isDraining: this.isDraining,
    };
  }

  /**
   * Get a voice-friendly queue status summary
   */
  getVoiceSummary(): string {
    const metrics = this.getMetrics();
    const parts: string[] = [];

    if (metrics.connectivity === 'offline') {
      const offlineMins = Math.round(metrics.totalOfflineMs / 60000);
      parts.push(`You've been offline for ${offlineMins} minutes`);
      parts.push(`${metrics.depth} operations queued for sync`);
    } else if (metrics.isDraining) {
      parts.push(`Syncing: ${metrics.depth} operations remaining`);
      if (metrics.drainRatePerMin > 0) {
        const eta = Math.ceil(metrics.depth / metrics.drainRatePerMin);
        parts.push(`estimated ${eta} minutes to complete`);
      }
    } else if (metrics.depth === 0) {
      parts.push('Everything is synced and up to date');
    } else {
      parts.push(`${metrics.depth} operations pending`);
    }

    if (metrics.totalFailed > 0) {
      parts.push(`${metrics.totalFailed} operations failed`);
    }

    const conflicts = this.getConflicts();
    if (conflicts.length > 0) {
      parts.push(`${conflicts.length} sync conflicts need attention`);
    }

    return parts.join('. ') + '.';
  }

  // ─── Serialization ─────────────────────────────────────────

  /**
   * Export queue state for persistence (disk storage)
   */
  exportState(): { operations: QueuedOperation[]; conflicts: SyncConflict[] } {
    return {
      operations: Array.from(this.queue.values()).filter(
        op => op.status === 'pending' || op.status === 'processing',
      ),
      conflicts: this.conflicts.filter(c => !c.resolvedAt),
    };
  }

  /**
   * Import queue state (from disk on restart)
   */
  importState(state: { operations: QueuedOperation[]; conflicts: SyncConflict[] }): void {
    for (const op of state.operations) {
      // Reset processing operations to pending (they were interrupted)
      if (op.status === 'processing') {
        op.status = 'pending';
      }
      this.queue.set(op.id, op);
    }

    this.conflicts.push(...state.conflicts);

    this.emit('state:imported', { operations: state.operations.length, conflicts: state.conflicts.length });
  }

  // ─── Cleanup ────────────────────────────────────────────────

  /**
   * Clean up completed/failed/expired operations older than the given age
   */
  cleanup(maxAgeMs: number = 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [id, op] of this.queue.entries()) {
      if (
        (op.status === 'completed' || op.status === 'failed' || op.status === 'expired' || op.status === 'evicted') &&
        new Date(op.enqueuedAt).getTime() < cutoff
      ) {
        this.queue.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Destroy the queue (stop timers, clear state)
   */
  destroy(): void {
    this.stopConnectivityMonitoring();
    this.isDraining = false;
    this.queue.clear();
    this.conflicts = [];
    this.removeAllListeners();
  }

  // ─── Helpers ────────────────────────────────────────────────

  private nextId(): string {
    this.idCounter++;
    return `op_${Date.now()}_${this.idCounter.toString().padStart(4, '0')}`;
  }

  private estimateSize(payload: Record<string, unknown>): number {
    return JSON.stringify(payload).length * 2; // rough byte estimate
  }

  private getTotalBytes(): number {
    let total = 0;
    for (const op of this.queue.values()) {
      if (op.status === 'pending' || op.status === 'processing') {
        total += op.sizeBytes;
      }
    }
    return total;
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const op of this.queue.values()) {
      if (op.status === 'pending' || op.status === 'processing') {
        const enqueued = new Date(op.enqueuedAt).getTime();
        if (now - enqueued > op.ttlMs) {
          op.status = 'expired';
          this.totalExpired++;
          this.emit('operation:expired', { id: op.id, type: op.type });
        }
      }
    }
  }

  private evictLowest(incomingPriority: OperationPriority): boolean {
    // Find lowest priority pending operation that's lower than incoming
    const pending = this.getPending();
    const incomingWeight = PRIORITY_WEIGHT[incomingPriority];

    for (let i = pending.length - 1; i >= 0; i--) {
      if (PRIORITY_WEIGHT[pending[i].priority] < incomingWeight) {
        pending[i].status = 'evicted';
        this.totalEvicted++;
        this.emit('operation:evicted', { id: pending[i].id, type: pending[i].type });
        return true;
      }
    }

    return false;
  }

  private evictForSpace(neededBytes: number, incomingPriority: OperationPriority): boolean {
    const pending = this.getPending();
    const incomingWeight = PRIORITY_WEIGHT[incomingPriority];
    let freedBytes = 0;

    // Evict lowest priority first until we have enough space
    for (let i = pending.length - 1; i >= 0; i--) {
      if (PRIORITY_WEIGHT[pending[i].priority] < incomingWeight) {
        pending[i].status = 'evicted';
        freedBytes += pending[i].sizeBytes;
        this.totalEvicted++;
        this.emit('operation:evicted', { id: pending[i].id, type: pending[i].type });

        if (freedBytes >= neededBytes) return true;
      }
    }

    return freedBytes >= neededBytes;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
