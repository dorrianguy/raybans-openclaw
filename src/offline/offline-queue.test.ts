/**
 * Tests for Offline Queue & Sync Engine
 * @module offline/offline-queue.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  OfflineQueue,
  OfflineQueueConfig,
  QueuedOperation,
} from './offline-queue.js';

// ─── Helpers ────────────────────────────────────────────────────

function createConfig(overrides?: Partial<OfflineQueueConfig>): OfflineQueueConfig {
  return {
    maxQueueSize: 100,
    maxQueueBytes: 10 * 1024 * 1024,
    defaultTtlMs: 60 * 60 * 1000,
    defaultMaxAttempts: 3,
    retryBaseDelayMs: 10, // Fast for tests
    retryMaxDelayMs: 100,
    drainBatchSize: 5,
    drainBatchDelayMs: 0, // No delay in tests
    connectivityCheckIntervalMs: 30000,
    processor: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

function createQueue(overrides?: Partial<OfflineQueueConfig>): OfflineQueue {
  return new OfflineQueue(createConfig(overrides));
}

// ─── Tests ──────────────────────────────────────────────────────

describe('OfflineQueue — Enqueue', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    queue = createQueue();
    queue.setConnectivity('offline'); // Prevent auto-drain during enqueue tests
  });

  it('should enqueue an operation', () => {
    const op = queue.enqueue('vision_analysis', { imageId: 'img_1' });
    expect(op.id).toBeDefined();
    expect(op.type).toBe('vision_analysis');
    expect(op.status).toBe('pending');
    expect(op.priority).toBe('normal');
    expect(op.attempts).toBe(0);
  });

  it('should enqueue with custom priority', () => {
    const op = queue.enqueue('alert', { level: 'critical' }, { priority: 'critical' });
    expect(op.priority).toBe('critical');
  });

  it('should enqueue with custom TTL', () => {
    const op = queue.enqueue('temp', {}, { ttlMs: 5000 });
    expect(op.ttlMs).toBe(5000);
  });

  it('should enqueue with dependency', () => {
    const op1 = queue.enqueue('step1', {});
    const op2 = queue.enqueue('step2', {}, { dependsOn: op1.id });
    expect(op2.dependsOn).toBe(op1.id);
  });

  it('should get operation by ID', () => {
    const op = queue.enqueue('test', {});
    expect(queue.getOperation(op.id)).toBeDefined();
    expect(queue.getOperation('nonexistent')).toBeUndefined();
  });

  it('should get pending operations sorted by priority', () => {
    queue.enqueue('low', {}, { priority: 'low' });
    queue.enqueue('critical', {}, { priority: 'critical' });
    queue.enqueue('normal', {}, { priority: 'normal' });

    const pending = queue.getPending();
    expect(pending[0].priority).toBe('critical');
    expect(pending[1].priority).toBe('normal');
    expect(pending[2].priority).toBe('low');
  });

  it('should remove an operation', () => {
    const op = queue.enqueue('removable', {});
    expect(queue.remove(op.id)).toBe(true);
    expect(queue.getOperation(op.id)).toBeUndefined();
  });

  it('should clear all operations', () => {
    queue.enqueue('a', {});
    queue.enqueue('b', {});
    queue.clear();
    expect(queue.getPending()).toHaveLength(0);
  });

  it('should emit enqueued event', () => {
    const handler = vi.fn();
    queue.on('operation:enqueued', handler);
    queue.enqueue('test', { data: 1 });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'test', priority: 'normal' }));
  });

  it('should estimate operation size', () => {
    const op = queue.enqueue('sized', { big: 'a'.repeat(1000) });
    expect(op.sizeBytes).toBeGreaterThan(2000);
  });

  it('should accept custom size override', () => {
    const op = queue.enqueue('custom', {}, { sizeBytes: 999 });
    expect(op.sizeBytes).toBe(999);
  });
});

describe('OfflineQueue — Queue Capacity', () => {
  it('should evict lowest priority when queue is full', () => {
    const queue = createQueue({ maxQueueSize: 3 });
    queue.setConnectivity('offline'); // Prevent auto-drain

    queue.enqueue('low1', {}, { priority: 'low' });
    queue.enqueue('normal1', {}, { priority: 'normal' });
    queue.enqueue('normal2', {}, { priority: 'normal' });

    // This should evict the low priority one
    const op = queue.enqueue('high1', {}, { priority: 'high' });
    expect(op.priority).toBe('high');
    expect(queue.getPending()).toHaveLength(3); // 2 normal + 1 high
  });

  it('should throw when queue is full and no lower priority to evict', () => {
    const queue = createQueue({ maxQueueSize: 2 });
    queue.setConnectivity('offline'); // Prevent auto-drain

    queue.enqueue('high1', {}, { priority: 'high' });
    queue.enqueue('high2', {}, { priority: 'high' });

    expect(() => queue.enqueue('normal', {}, { priority: 'normal' })).toThrow('Queue is full');
  });

  it('should evict for byte capacity', () => {
    const queue = createQueue({ maxQueueBytes: 100 });
    queue.setConnectivity('offline'); // Prevent auto-drain

    queue.enqueue('small', {}, { priority: 'low', sizeBytes: 50 });
    queue.enqueue('big', { data: 'x' }, { priority: 'high', sizeBytes: 80 });

    // Low priority should have been evicted
    const pending = queue.getPending();
    expect(pending.length).toBe(1);
    expect(pending[0].priority).toBe('high');
  });

  it('should track eviction metrics', () => {
    const queue = createQueue({ maxQueueSize: 2 });
    queue.setConnectivity('offline'); // Prevent auto-drain
    const handler = vi.fn();
    queue.on('operation:evicted', handler);

    queue.enqueue('low', {}, { priority: 'low' });
    queue.enqueue('low2', {}, { priority: 'low' });
    queue.enqueue('high', {}, { priority: 'high' });

    expect(handler).toHaveBeenCalled();
    expect(queue.getMetrics().totalEvicted).toBe(1);
  });
});

describe('OfflineQueue — Connectivity', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    queue = createQueue();
  });

  it('should start online', () => {
    expect(queue.getConnectivity()).toBe('online');
  });

  it('should set connectivity offline', () => {
    const handler = vi.fn();
    queue.on('connectivity:offline', handler);
    queue.setConnectivity('offline');
    expect(queue.getConnectivity()).toBe('offline');
    expect(handler).toHaveBeenCalled();
  });

  it('should set connectivity online', () => {
    queue.setConnectivity('offline');
    const handler = vi.fn();
    queue.on('connectivity:online', handler);
    queue.setConnectivity('online');
    expect(handler).toHaveBeenCalled();
  });

  it('should set degraded state', () => {
    const handler = vi.fn();
    queue.on('connectivity:degraded', handler);
    queue.setConnectivity('degraded');
    expect(queue.getConnectivity()).toBe('degraded');
    expect(handler).toHaveBeenCalled();
  });

  it('should not emit if state unchanged', () => {
    const handler = vi.fn();
    queue.on('connectivity:changed', handler);
    queue.setConnectivity('online'); // Already online
    expect(handler).not.toHaveBeenCalled();
  });

  it('should track offline duration', () => {
    queue.setConnectivity('offline');
    // Simulate some time passing
    const metrics1 = queue.getMetrics();
    expect(metrics1.totalOfflineMs).toBeGreaterThanOrEqual(0);

    queue.setConnectivity('online');
    const metrics2 = queue.getMetrics();
    expect(metrics2.totalOfflineMs).toBeGreaterThanOrEqual(0);
  });

  it('should emit changed event with previous state', () => {
    const handler = vi.fn();
    queue.on('connectivity:changed', handler);
    queue.setConnectivity('offline');
    expect(handler).toHaveBeenCalledWith({ previous: 'online', current: 'offline' });
  });
});

describe('OfflineQueue — Drain (Processing)', () => {
  it('should process pending operations', async () => {
    const processor = vi.fn(async () => ({ result: 'ok' }));
    const queue = createQueue({ processor });

    queue.enqueue('task1', { data: 1 });
    queue.enqueue('task2', { data: 2 });

    await queue.startDrain();

    expect(processor).toHaveBeenCalledTimes(2);
    expect(queue.getPending()).toHaveLength(0);
    expect(queue.getMetrics().totalCompleted).toBe(2);
  });

  it('should process in priority order', async () => {
    const order: string[] = [];
    const processor = vi.fn(async (op: QueuedOperation) => {
      order.push(op.type);
      return {};
    });
    const queue = createQueue({ processor, drainBatchSize: 1 });

    queue.enqueue('low', {}, { priority: 'low' });
    queue.enqueue('critical', {}, { priority: 'critical' });
    queue.enqueue('normal', {}, { priority: 'normal' });

    await queue.startDrain();

    expect(order[0]).toBe('critical');
    expect(order[1]).toBe('normal');
    expect(order[2]).toBe('low');
  });

  it('should handle processor errors with retry', async () => {
    let callCount = 0;
    const processor = vi.fn(async () => {
      callCount++;
      if (callCount <= 2) throw new Error('network timeout');
      return { success: true };
    });
    const queue = createQueue({ processor, retryBaseDelayMs: 0, retryMaxDelayMs: 0 });

    queue.enqueue('retryable', {}, { maxAttempts: 5 });

    // First drain: will fail (attempt 1)
    await queue.startDrain();
    // Second drain: will fail again (attempt 2)
    await queue.startDrain();
    // Third drain: should succeed (attempt 3)
    await queue.startDrain();

    expect(queue.getMetrics().totalCompleted).toBe(1);
  });

  it('should mark as failed after max attempts', async () => {
    const processor = vi.fn(async () => { throw new Error('always fails'); });
    const queue = createQueue({ processor, retryBaseDelayMs: 0, retryMaxDelayMs: 0 });

    queue.enqueue('doomed', {}, { maxAttempts: 2 });

    // First drain: fail attempt 1
    await queue.startDrain();
    // Second drain: fail attempt 2 = maxAttempts → mark failed
    await queue.startDrain();

    const op = queue.getPending();
    expect(op).toHaveLength(0);
    expect(queue.getMetrics().totalFailed).toBe(1);
  });

  it('should not drain when offline', async () => {
    const processor = vi.fn(async () => ({}));
    const queue = createQueue({ processor });

    queue.setConnectivity('offline');
    queue.enqueue('blocked', {});

    await queue.startDrain();
    expect(processor).not.toHaveBeenCalled();
  });

  it('should auto-drain when going online with pending ops', async () => {
    const processor = vi.fn(async () => ({}));
    const queue = createQueue({ processor });

    queue.setConnectivity('offline');
    queue.enqueue('waiting', {});

    // Going online should trigger drain
    queue.setConnectivity('online');

    // Wait a tick for async drain to start
    await new Promise(r => setTimeout(r, 50));

    expect(processor).toHaveBeenCalled();
  });

  it('should emit drain events', async () => {
    const queue = createQueue();
    const startHandler = vi.fn();
    const completeHandler = vi.fn();
    queue.on('drain:started', startHandler);
    queue.on('drain:completed', completeHandler);

    queue.enqueue('test', {});
    await queue.startDrain();

    expect(startHandler).toHaveBeenCalled();
    expect(completeHandler).toHaveBeenCalledWith(expect.objectContaining({
      processed: 1,
      remaining: 0,
    }));
  });

  it('should not start drain twice', async () => {
    const processor = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 50));
      return {};
    });
    const queue = createQueue({ processor });

    queue.enqueue('test', {});

    // First drain starts processing; second returns immediately because isDraining
    const drain1 = queue.startDrain();
    const drain2 = queue.startDrain();
    await Promise.all([drain1, drain2]);

    // First drain is still running (50ms processor), wait for it
    await new Promise(r => setTimeout(r, 100));

    // Processor should only be called once
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('should handle empty queue drain gracefully', async () => {
    const queue = createQueue();
    await queue.startDrain(); // No operations — should complete immediately
    expect(queue.getMetrics().totalCompleted).toBe(0);
  });
});

describe('OfflineQueue — Dependencies', () => {
  it('should wait for dependency before processing', async () => {
    const order: string[] = [];
    const processor = vi.fn(async (op: QueuedOperation) => {
      order.push(op.type);
      return {};
    });
    const queue = createQueue({ processor, drainBatchSize: 1 });

    const step1 = queue.enqueue('step1', {});
    queue.enqueue('step2', {}, { dependsOn: step1.id });

    await queue.startDrain();
    // First drain processes step1 but skips step2 (dep not yet complete)
    // Second drain processes step2
    await queue.startDrain();

    expect(order[0]).toBe('step1');
    expect(order[1]).toBe('step2');
  });

  it('should fail dependent when dependency fails', async () => {
    const processor = vi.fn(async (op: QueuedOperation) => {
      if (op.type === 'step1') throw new Error('always fails');
      return {};
    });
    const queue = createQueue({ processor, retryBaseDelayMs: 0, retryMaxDelayMs: 0 });

    const step1 = queue.enqueue('step1', {}, { maxAttempts: 1 });
    queue.enqueue('step2', {}, { dependsOn: step1.id });

    await queue.startDrain();
    await queue.startDrain(); // Second drain for step2 to notice step1 failed

    expect(queue.getMetrics().totalFailed).toBe(2);
    expect(queue.getConflicts().length).toBeGreaterThan(0);
  });
});

describe('OfflineQueue — TTL & Expiration', () => {
  it('should expire operations past TTL', async () => {
    const queue = createQueue();
    queue.setConnectivity('offline'); // Enqueue while offline so TTL can expire

    const handler = vi.fn();
    queue.on('operation:expired', handler);

    // Create with very short TTL
    const op = queue.enqueue('ephemeral', {}, { ttlMs: 1 });

    // Wait for TTL to pass
    await new Promise(r => setTimeout(r, 10));

    queue.setConnectivity('online');
    await queue.startDrain();

    const found = queue.getOperation(op.id);
    expect(found?.status).toBe('expired');
    expect(handler).toHaveBeenCalled();
  });

  it('should not expire operations within TTL', async () => {
    const queue = createQueue();
    const op = queue.enqueue('longLived', {}, { ttlMs: 60000 });
    await queue.startDrain();
    const found = queue.getOperation(op.id);
    expect(found?.status).toBe('completed');
  });
});

describe('OfflineQueue — Conflicts', () => {
  it('should detect version mismatch conflicts', async () => {
    const processor = vi.fn(async () => { throw new Error('version_mismatch: stale data'); });
    const queue = createQueue({ processor });

    queue.enqueue('stale', { version: 1 });
    await queue.startDrain();

    const conflicts = queue.getConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe('version_mismatch');
  });

  it('should detect server rejection', async () => {
    const processor = vi.fn(async () => { throw new Error('forbidden: access denied'); });
    const queue = createQueue({ processor });

    queue.enqueue('rejected', {});
    await queue.startDrain();

    const conflicts = queue.getConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe('server_rejected');
  });

  it('should resolve conflicts', () => {
    const queue = createQueue();
    // Manually add a conflict for testing
    const processor = vi.fn(async () => { throw new Error('conflict: data mismatch'); });
    const queue2 = createQueue({ processor });
    queue2.enqueue('conflicting', {});

    // Simulate conflict via processor
    queue2.startDrain().then(() => {
      const conflicts = queue2.getConflicts();
      if (conflicts.length > 0) {
        const resolved = queue2.resolveConflict(conflicts[0].operationId, 'local_wins');
        expect(resolved).toBe(true);
        expect(queue2.getConflicts()).toHaveLength(0); // Resolved conflicts filtered out
      }
    });
  });

  it('should return false for resolving non-existent conflict', () => {
    const queue = createQueue();
    expect(queue.resolveConflict('nonexistent', 'discarded')).toBe(false);
  });
});

describe('OfflineQueue — Metrics', () => {
  it('should track basic metrics', async () => {
    const queue = createQueue();

    queue.enqueue('a', {}, { priority: 'high' });
    queue.enqueue('b', {}, { priority: 'normal' });
    queue.enqueue('c', {}, { priority: 'low' });

    const metrics = queue.getMetrics();
    expect(metrics.depth).toBe(3);
    expect(metrics.byPriority.high).toBe(1);
    expect(metrics.byPriority.normal).toBe(1);
    expect(metrics.byPriority.low).toBe(1);
    expect(metrics.totalEnqueued).toBe(3);
    expect(metrics.connectivity).toBe('online');
  });

  it('should track completion metrics after drain', async () => {
    const queue = createQueue();

    queue.enqueue('x', {});
    queue.enqueue('y', {});
    await queue.startDrain();

    const metrics = queue.getMetrics();
    expect(metrics.totalCompleted).toBe(2);
    expect(metrics.depth).toBe(0);
    expect(metrics.lastDrainAt).toBeDefined();
    expect(metrics.avgProcessingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should track failed metrics', async () => {
    const processor = vi.fn(async () => { throw new Error('fail'); });
    const queue = createQueue({ processor, retryBaseDelayMs: 1 });

    queue.enqueue('fail', {}, { maxAttempts: 1 });
    await queue.startDrain();

    expect(queue.getMetrics().totalFailed).toBe(1);
  });

  it('should report isDraining status', async () => {
    const processor = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 100));
      return {};
    });
    const queue = createQueue({ processor });

    queue.enqueue('slow', {});
    const drainPromise = queue.startDrain();

    // Check while draining
    await new Promise(r => setTimeout(r, 20));
    expect(queue.getMetrics().isDraining).toBe(true);

    await drainPromise;
    expect(queue.getMetrics().isDraining).toBe(false);
  });
});

describe('OfflineQueue — Voice Summary', () => {
  it('should report synced status', () => {
    const queue = createQueue();
    const summary = queue.getVoiceSummary();
    expect(summary).toContain('synced');
    expect(summary).toContain('up to date');
  });

  it('should report offline status', () => {
    const queue = createQueue();
    queue.setConnectivity('offline');
    queue.enqueue('queued', {});

    const summary = queue.getVoiceSummary();
    expect(summary).toContain('offline');
    expect(summary).toContain('1 operations queued');
  });

  it('should report pending operations', () => {
    const queue = createQueue();
    queue.setConnectivity('offline');
    queue.enqueue('a', {});
    queue.enqueue('b', {});
    queue.setConnectivity('online');

    const summary = queue.getVoiceSummary();
    expect(summary).toContain('2');
  });

  it('should report failures', async () => {
    const processor = vi.fn(async () => { throw new Error('fail'); });
    const queue = createQueue({ processor, retryBaseDelayMs: 1 });

    queue.enqueue('fail', {}, { maxAttempts: 1 });
    await queue.startDrain();

    const summary = queue.getVoiceSummary();
    expect(summary).toContain('failed');
  });

  it('should report conflicts', async () => {
    const processor = vi.fn(async () => { throw new Error('conflict: mismatch'); });
    const queue = createQueue({ processor });

    queue.enqueue('conflict', {});
    await queue.startDrain();

    const summary = queue.getVoiceSummary();
    expect(summary).toContain('conflict');
  });
});

describe('OfflineQueue — Serialization', () => {
  it('should export pending operations', () => {
    const queue = createQueue();
    queue.setConnectivity('offline');
    queue.enqueue('a', { data: 1 });
    queue.enqueue('b', { data: 2 });

    const state = queue.exportState();
    expect(state.operations).toHaveLength(2);
  });

  it('should not export completed operations', async () => {
    const queue = createQueue();
    queue.enqueue('done', {});
    await queue.startDrain();

    const state = queue.exportState();
    expect(state.operations).toHaveLength(0);
  });

  it('should import state and reset processing to pending', () => {
    const queue = createQueue();
    const handler = vi.fn();
    queue.on('state:imported', handler);

    queue.importState({
      operations: [
        {
          id: 'op_import_1',
          type: 'test',
          payload: {},
          priority: 'normal',
          status: 'processing', // Should be reset to pending
          enqueuedAt: new Date().toISOString(),
          attempts: 1,
          maxAttempts: 3,
          ttlMs: 60000,
          sizeBytes: 100,
        },
      ],
      conflicts: [],
    });

    const op = queue.getOperation('op_import_1');
    expect(op).toBeDefined();
    expect(op!.status).toBe('pending');
    expect(handler).toHaveBeenCalled();
  });

  it('should import conflicts', () => {
    const queue = createQueue();

    queue.importState({
      operations: [],
      conflicts: [
        { operationId: 'op_1', type: 'test', reason: 'stale_data', localData: {} },
      ],
    });

    expect(queue.getConflicts()).toHaveLength(1);
  });
});

describe('OfflineQueue — Cleanup', () => {
  it('should cleanup old completed operations', async () => {
    const queue = createQueue();
    queue.enqueue('old', {});
    await queue.startDrain();

    // Cleanup with maxAge of 0 (remove everything completed)
    const removed = queue.cleanup(0);
    expect(removed).toBe(1);
  });

  it('should not cleanup recent operations', async () => {
    const queue = createQueue();
    queue.enqueue('recent', {});
    await queue.startDrain();

    const removed = queue.cleanup(60000);
    expect(removed).toBe(0);
  });

  it('should cleanup failed operations', async () => {
    const processor = vi.fn(async () => { throw new Error('fail'); });
    const queue = createQueue({ processor, retryBaseDelayMs: 1 });

    queue.enqueue('failed', {}, { maxAttempts: 1 });
    await queue.startDrain();

    const removed = queue.cleanup(0);
    expect(removed).toBe(1);
  });
});

describe('OfflineQueue — Destroy', () => {
  it('should clean up everything on destroy', () => {
    const queue = createQueue();
    queue.enqueue('test', {});
    queue.startConnectivityMonitoring();

    queue.destroy();

    expect(queue.getPending()).toHaveLength(0);
    expect(queue.getConflicts()).toHaveLength(0);
  });
});

describe('OfflineQueue — Connectivity Monitoring', () => {
  it('should start and stop monitoring', () => {
    const checkFn = vi.fn(async () => true);
    const queue = createQueue({ connectivityCheck: checkFn });

    queue.startConnectivityMonitoring();
    queue.stopConnectivityMonitoring();
    // Should not throw
  });

  it('should not start monitoring without check function', () => {
    const queue = createQueue({ connectivityCheck: undefined });
    queue.startConnectivityMonitoring();
    // Should not throw, just no-op
    queue.stopConnectivityMonitoring();
  });
});
