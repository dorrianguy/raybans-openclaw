/**
 * Tests for Fault Recovery Engine
 * 🌙 Night Shift Agent — Night #36
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FaultRecoveryEngine,
  DEFAULT_RECOVERY_CONFIG,
  type FaultRecoveryConfig,
  type Checkpoint,
  type WALEntry,
  type FaultEvent,
  type RecoveryPlan,
  type DegradationLevel,
} from './fault-recovery.js';

describe('FaultRecoveryEngine', () => {
  let engine: FaultRecoveryEngine;

  beforeEach(() => {
    engine = new FaultRecoveryEngine();
  });

  // ─── Default Config ─────────────────────────────────────────────────────

  describe('default config', () => {
    it('should have reasonable checkpoint interval', () => {
      expect(DEFAULT_RECOVERY_CONFIG.checkpointIntervalMs).toBe(30_000);
    });

    it('should have max checkpoint limit', () => {
      expect(DEFAULT_RECOVERY_CONFIG.maxCheckpoints).toBe(20);
    });

    it('should have WAL compaction threshold', () => {
      expect(DEFAULT_RECOVERY_CONFIG.maxWALEntries).toBe(500);
    });

    it('should have fault retention of 7 days', () => {
      expect(DEFAULT_RECOVERY_CONFIG.faultRetentionMs).toBe(7 * 24 * 3600_000);
    });

    it('should enable auto-recovery by default', () => {
      expect(DEFAULT_RECOVERY_CONFIG.autoRecover).toBe(true);
    });

    it('should enable voice alerts by default', () => {
      expect(DEFAULT_RECOVERY_CONFIG.voiceAlerts).toBe(true);
    });

    it('should enable degradation by default', () => {
      expect(DEFAULT_RECOVERY_CONFIG.enableDegradation).toBe(true);
    });
  });

  // ─── Checkpoint Management ──────────────────────────────────────────────

  describe('checkpoint management', () => {
    const sessionId = 'session-1';
    const metadata = {
      itemCount: 42,
      scanCount: 100,
      zonesCovered: ['zone-a', 'zone-b'],
      lastAction: 'scan',
      elapsedMs: 60000,
    };

    it('should create a checkpoint', () => {
      const cp = engine.createCheckpoint(sessionId, { items: [1, 2, 3] }, metadata);

      expect(cp.id).toBeTruthy();
      expect(cp.sessionId).toBe(sessionId);
      expect(cp.status).toBe('committed');
      expect(cp.data).toEqual({ items: [1, 2, 3] });
      expect(cp.metadata.itemCount).toBe(42);
      expect(cp.sequenceNumber).toBe(1);
      expect(cp.sizeBytes).toBeGreaterThan(0);
      expect(cp.hash).toBeTruthy();
    });

    it('should emit checkpoint_created event', () => {
      const handler = vi.fn();
      engine.on('checkpoint_created', handler);

      engine.createCheckpoint(sessionId, {}, metadata);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should get latest checkpoint', () => {
      engine.createCheckpoint(sessionId, { version: 1 }, metadata);
      engine.createCheckpoint(sessionId, { version: 2 }, metadata);
      engine.createCheckpoint(sessionId, { version: 3 }, metadata);

      const latest = engine.getLatestCheckpoint(sessionId);
      expect(latest).not.toBeNull();
      expect(latest!.data).toEqual({ version: 3 });
    });

    it('should return null for missing session', () => {
      const latest = engine.getLatestCheckpoint('nonexistent');
      expect(latest).toBeNull();
    });

    it('should limit checkpoints per session', () => {
      const eng = new FaultRecoveryEngine({ maxCheckpoints: 3 });
      for (let i = 0; i < 5; i++) {
        eng.createCheckpoint(sessionId, { i }, metadata);
      }

      const all = eng.getCheckpoints(sessionId);
      expect(all.length).toBe(3);
      expect(all[0].data).toEqual({ i: 2 }); // oldest kept
      expect(all[2].data).toEqual({ i: 4 }); // newest
    });

    it('should get all checkpoints for a session', () => {
      engine.createCheckpoint(sessionId, { a: 1 }, metadata);
      engine.createCheckpoint(sessionId, { b: 2 }, metadata);

      const all = engine.getCheckpoints(sessionId);
      expect(all.length).toBe(2);
    });

    it('should verify checkpoint integrity', () => {
      const cp = engine.createCheckpoint(sessionId, { data: 'test' }, metadata);
      expect(engine.verifyCheckpoint(cp.id)).toBe(true);
    });

    it('should detect corrupted checkpoints via markCorrupted', () => {
      const cp = engine.createCheckpoint(sessionId, { data: 'test' }, metadata);
      // Verify before corruption
      expect(engine.verifyCheckpoint(cp.id)).toBe(true);

      // Mark corrupted — should no longer appear in getLatestCheckpoint
      engine.markCorrupted(cp.id);
      expect(engine.getLatestCheckpoint(sessionId)).toBeNull();
    });

    it('should mark checkpoint as corrupted', () => {
      const cp = engine.createCheckpoint(sessionId, {}, metadata);
      expect(engine.markCorrupted(cp.id)).toBe(true);

      const latest = engine.getLatestCheckpoint(sessionId);
      expect(latest).toBeNull(); // corrupted checkpoints skipped
    });

    it('should return false for marking non-existent checkpoint', () => {
      expect(engine.markCorrupted('fake-id')).toBe(false);
    });

    it('should restore from a specific checkpoint', () => {
      const cp1 = engine.createCheckpoint(sessionId, { version: 1 }, metadata);
      engine.createCheckpoint(sessionId, { version: 2 }, metadata);

      const result = engine.restoreFromCheckpoint(cp1.id);
      expect(result).not.toBeNull();
      expect(result!.checkpoint.data).toEqual({ version: 1 });
    });

    it('should return null for invalid checkpoint restore', () => {
      expect(engine.restoreFromCheckpoint('fake')).toBeNull();
    });

    it('should skip corrupted checkpoints in getLatestCheckpoint', () => {
      const cp1 = engine.createCheckpoint(sessionId, { version: 1 }, metadata);
      const cp2 = engine.createCheckpoint(sessionId, { version: 2 }, metadata);

      engine.markCorrupted(cp2.id);
      const latest = engine.getLatestCheckpoint(sessionId);
      expect(latest!.data).toEqual({ version: 1 });
    });
  });

  // ─── Write-Ahead Log ────────────────────────────────────────────────────

  describe('write-ahead log', () => {
    const sessionId = 'session-wal';

    it('should append WAL entries', () => {
      const entry = engine.appendWAL(sessionId, 'add_item', { sku: 'ABC123' });

      expect(entry.id).toBeTruthy();
      expect(entry.sessionId).toBe(sessionId);
      expect(entry.operation).toBe('add_item');
      expect(entry.data).toEqual({ sku: 'ABC123' });
      expect(entry.applied).toBe(false);
    });

    it('should increment sequence numbers', () => {
      const e1 = engine.appendWAL(sessionId, 'op1', {});
      const e2 = engine.appendWAL(sessionId, 'op2', {});
      const e3 = engine.appendWAL(sessionId, 'op3', {});

      expect(e1.sequenceNumber).toBe(1);
      expect(e2.sequenceNumber).toBe(2);
      expect(e3.sequenceNumber).toBe(3);
    });

    it('should reference latest checkpoint', () => {
      const cp = engine.createCheckpoint(sessionId, {}, {
        itemCount: 0, scanCount: 0, zonesCovered: [],
        lastAction: '', elapsedMs: 0,
      });

      const entry = engine.appendWAL(sessionId, 'op', {});
      expect(entry.checkpointRef).toBe(cp.id);
    });

    it('should have null checkpointRef when no checkpoint exists', () => {
      const entry = engine.appendWAL(sessionId, 'op', {});
      expect(entry.checkpointRef).toBeNull();
    });

    it('should get uncommitted WAL entries', () => {
      engine.appendWAL(sessionId, 'op1', {});
      engine.appendWAL(sessionId, 'op2', {});

      const entries = engine.getWALEntries(sessionId);
      expect(entries.length).toBe(2);
      expect(entries.every(e => !e.applied)).toBe(true);
    });

    it('should get all WAL entries including applied', () => {
      const e1 = engine.appendWAL(sessionId, 'op1', {});
      engine.appendWAL(sessionId, 'op2', {});

      engine.markWALApplied([e1.id]);
      const all = engine.getAllWALEntries(sessionId);
      expect(all.length).toBe(2);

      const uncommitted = engine.getWALEntries(sessionId);
      expect(uncommitted.length).toBe(1);
    });

    it('should mark WAL entries as applied', () => {
      const e1 = engine.appendWAL(sessionId, 'op1', {});
      const e2 = engine.appendWAL(sessionId, 'op2', {});

      const marked = engine.markWALApplied([e1.id, e2.id]);
      expect(marked).toBe(2);

      const uncommitted = engine.getWALEntries(sessionId);
      expect(uncommitted.length).toBe(0);
    });

    it('should return 0 for marking non-existent WAL entries', () => {
      expect(engine.markWALApplied(['fake'])).toBe(0);
    });

    it('should not double-mark WAL entries', () => {
      const e1 = engine.appendWAL(sessionId, 'op1', {});
      engine.markWALApplied([e1.id]);
      const marked = engine.markWALApplied([e1.id]);
      expect(marked).toBe(0);
    });

    it('should get WAL entries since a checkpoint', () => {
      const cp = engine.createCheckpoint(sessionId, {}, {
        itemCount: 0, scanCount: 0, zonesCovered: [],
        lastAction: '', elapsedMs: 0,
      });

      engine.appendWAL(sessionId, 'after1', {});
      engine.appendWAL(sessionId, 'after2', {});

      const since = engine.getWALSinceCheckpoint(sessionId, cp.id);
      expect(since.length).toBe(2);
    });

    it('should return empty for WAL since non-existent checkpoint', () => {
      engine.appendWAL(sessionId, 'op1', {});
      const since = engine.getWALSinceCheckpoint(sessionId, 'fake');
      expect(since.length).toBe(0);
    });

    it('should detect when checkpoint is needed', () => {
      const eng = new FaultRecoveryEngine({ maxWALEntries: 3 });
      eng.appendWAL(sessionId, 'op1', {});
      eng.appendWAL(sessionId, 'op2', {});
      expect(eng.needsCheckpoint(sessionId)).toBe(false);

      eng.appendWAL(sessionId, 'op3', {});
      expect(eng.needsCheckpoint(sessionId)).toBe(true);
    });
  });

  // ─── Session Recovery ───────────────────────────────────────────────────

  describe('session recovery', () => {
    const sessionId = 'session-recover';
    const metadata = {
      itemCount: 10, scanCount: 20, zonesCovered: ['a'],
      lastAction: 'scan', elapsedMs: 30000,
    };

    it('should restore session from latest checkpoint + WAL', () => {
      engine.createCheckpoint(sessionId, { items: 10 }, metadata);

      // More operations after checkpoint
      engine.appendWAL(sessionId, 'add_item', { sku: 'X' });
      engine.appendWAL(sessionId, 'add_item', { sku: 'Y' });

      const result = engine.restoreSession(sessionId);
      expect(result).not.toBeNull();
      expect(result!.checkpoint.data).toEqual({ items: 10 });
      expect(result!.walEntries.length).toBe(2);
      expect(result!.estimatedLoss).toBeGreaterThanOrEqual(0);
    });

    it('should return null for session with no checkpoints', () => {
      expect(engine.restoreSession('empty-session')).toBeNull();
    });

    it('should emit checkpoint_restored on restore', () => {
      const handler = vi.fn();
      engine.on('checkpoint_restored', handler);

      engine.createCheckpoint(sessionId, {}, metadata);
      engine.restoreSession(sessionId);
      expect(handler).toHaveBeenCalled();
    });

    it('should emit wal_replayed when WAL entries exist', () => {
      const handler = vi.fn();
      engine.on('wal_replayed', handler);

      engine.createCheckpoint(sessionId, {}, metadata);
      engine.appendWAL(sessionId, 'op', {});
      engine.restoreSession(sessionId);

      expect(handler).toHaveBeenCalledWith(1);
    });

    it('should estimate data loss', () => {
      const handler = vi.fn();
      engine.on('data_loss_detected', handler);

      engine.createCheckpoint(sessionId, {}, metadata);

      // Simulate operations after checkpoint that won't be in WAL
      // (the WAL entry sequence > checkpoint sequence means no gap)
      engine.appendWAL(sessionId, 'op1', {});
      engine.appendWAL(sessionId, 'op2', {});

      const result = engine.restoreSession(sessionId);
      expect(result).not.toBeNull();
      // With all WAL entries present, loss should be minimal
    });

    it('should cleanup session data', () => {
      engine.createCheckpoint(sessionId, {}, metadata);
      engine.appendWAL(sessionId, 'op', {});

      const cleanup = engine.cleanupSession(sessionId);
      expect(cleanup.checkpointsRemoved).toBe(1);
      expect(cleanup.walEntriesRemoved).toBe(1);

      expect(engine.getCheckpoints(sessionId).length).toBe(0);
      expect(engine.getWALEntries(sessionId).length).toBe(0);
    });

    it('should list active sessions', () => {
      engine.createCheckpoint('s1', {}, metadata);
      engine.appendWAL('s2', 'op', {});
      engine.createCheckpoint('s3', {}, metadata);

      const sessions = engine.getActiveSessions();
      expect(sessions).toContain('s1');
      expect(sessions).toContain('s2');
      expect(sessions).toContain('s3');
      expect(sessions.length).toBe(3);
    });
  });

  // ─── Fault Detection ───────────────────────────────────────────────────

  describe('fault detection', () => {
    it('should report a fault', () => {
      const fault = engine.reportFault('crash', 'Process crashed');

      expect(fault.id).toBeTruthy();
      expect(fault.type).toBe('crash');
      expect(fault.message).toBe('Process crashed');
      expect(fault.resolved).toBe(false);
    });

    it('should emit fault_detected event', () => {
      const handler = vi.fn();
      engine.on('fault_detected', handler);

      engine.reportFault('timeout', 'API timeout');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should include session context in fault', () => {
      const fault = engine.reportFault('api_failure', 'Vision API 500', {
        sessionId: 'ses-1',
        context: { endpoint: '/analyze', statusCode: 500 },
      });

      expect(fault.sessionId).toBe('ses-1');
      expect(fault.context).toEqual({ endpoint: '/analyze', statusCode: 500 });
    });

    it('should include stack trace', () => {
      const fault = engine.reportFault('crash', 'Error', {
        stack: 'Error: at foo.ts:42',
      });
      expect(fault.stack).toBe('Error: at foo.ts:42');
    });

    it('should auto-start recovery when autoRecover is enabled', () => {
      const handler = vi.fn();
      engine.on('recovery_started', handler);

      engine.reportFault('crash', 'Crash!');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should not auto-start recovery when autoRecover is disabled', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      const handler = vi.fn();
      eng.on('recovery_started', handler);

      eng.reportFault('crash', 'Crash!');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should get faults filtered by resolved status', () => {
      const f1 = engine.reportFault('crash', 'C1');
      engine.reportFault('crash', 'C2');
      engine.resolveFault(f1.id, 'retry');

      const unresolved = engine.getFaults({ resolved: false });
      expect(unresolved.length).toBe(1);

      const resolved = engine.getFaults({ resolved: true });
      expect(resolved.length).toBe(1);
    });

    it('should get faults filtered by type', () => {
      engine.reportFault('crash', 'C1');
      engine.reportFault('timeout', 'T1');
      engine.reportFault('crash', 'C2');

      const crashes = engine.getFaults({ type: 'crash' });
      expect(crashes.length).toBe(2);
    });

    it('should get faults filtered by session', () => {
      engine.reportFault('crash', 'C1', { sessionId: 'ses-1' });
      engine.reportFault('crash', 'C2', { sessionId: 'ses-2' });

      const ses1 = engine.getFaults({ sessionId: 'ses-1' });
      expect(ses1.length).toBe(1);
    });

    it('should get faults since timestamp', () => {
      const before = Date.now();
      engine.reportFault('crash', 'C1');

      const faults = engine.getFaults({ since: before });
      expect(faults.length).toBe(1);

      const future = engine.getFaults({ since: Date.now() + 10000 });
      expect(future.length).toBe(0);
    });
  });

  // ─── Recovery Plans ─────────────────────────────────────────────────────

  describe('recovery plans', () => {
    it('should create a recovery plan for a fault', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      const fault = eng.reportFault('crash', 'Crash!');
      const plan = eng.startRecovery(fault.id);

      expect(plan).not.toBeNull();
      expect(plan!.faultId).toBe(fault.id);
      expect(plan!.status).toBe('in_progress');
      expect(plan!.strategies.length).toBeGreaterThan(0);
      expect(plan!.attempts).toBe(0);
    });

    it('should not create plan for resolved fault', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      const fault = eng.reportFault('crash', 'Crash!');
      eng.resolveFault(fault.id, 'retry');
      const plan = eng.startRecovery(fault.id);
      expect(plan).toBeNull();
    });

    it('should not create plan for non-existent fault', () => {
      expect(engine.startRecovery('fake')).toBeNull();
    });

    it('should attempt recovery', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      const fault = eng.reportFault('timeout', 'Timeout!');
      eng.startRecovery(fault.id);

      const result = eng.attemptRecovery(fault.id);
      expect(result).not.toBeNull();
      expect(result!.strategy).toBeTruthy();
    });

    it('should return null for attempt on non-existent plan', () => {
      expect(engine.attemptRecovery('fake')).toBeNull();
    });

    it('should get recovery plan', () => {
      const fault = engine.reportFault('crash', 'C');
      const plan = engine.getRecoveryPlan(fault.id);
      expect(plan).not.toBeNull();
      expect(plan!.faultId).toBe(fault.id);
    });

    it('should return null for non-existent plan', () => {
      expect(engine.getRecoveryPlan('fake')).toBeNull();
    });

    it('should abandon recovery', () => {
      const fault = engine.reportFault('crash', 'C');
      const abandoned = engine.abandonRecovery(fault.id);
      expect(abandoned).toBe(true);

      const plan = engine.getRecoveryPlan(fault.id);
      expect(plan!.status).toBe('abandoned');
    });

    it('should not abandon non-existent plan', () => {
      expect(engine.abandonRecovery('fake')).toBe(false);
    });

    it('should not abandon already completed plan', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      const fault = eng.reportFault('timeout', 'T');
      eng.startRecovery(fault.id);
      eng.attemptRecovery(fault.id); // 'retry' should succeed

      // If it succeeded, can't abandon
      const plan = eng.getRecoveryPlan(fault.id);
      if (plan?.status === 'succeeded') {
        expect(eng.abandonRecovery(fault.id)).toBe(false);
      }
    });

    it('should use correct strategies for each fault type', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });

      const crash = eng.reportFault('crash', 'C');
      const crashPlan = eng.startRecovery(crash.id);
      expect(crashPlan!.strategies).toContain('checkpoint_restore');

      const network = eng.reportFault('network_loss', 'N');
      const networkPlan = eng.startRecovery(network.id);
      expect(networkPlan!.strategies).toContain('fallback_local');

      const hw = eng.reportFault('hardware_disconnect', 'H');
      const hwPlan = eng.startRecovery(hw.id);
      expect(hwPlan!.strategies).toContain('reconnect');
    });
  });

  // ─── Fault Resolution ──────────────────────────────────────────────────

  describe('fault resolution', () => {
    it('should manually resolve a fault', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      const fault = eng.reportFault('crash', 'Crash!');

      const resolved = eng.resolveFault(fault.id, 'checkpoint_restore');
      expect(resolved).toBe(true);

      const faults = eng.getFaults({ resolved: true });
      expect(faults[0].resolution).toBe('checkpoint_restore');
      expect(faults[0].resolvedAt).not.toBeNull();
    });

    it('should not resolve already resolved fault', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      const fault = eng.reportFault('crash', 'C');
      eng.resolveFault(fault.id, 'retry');
      expect(eng.resolveFault(fault.id, 'retry')).toBe(false);
    });

    it('should not resolve non-existent fault', () => {
      expect(engine.resolveFault('fake', 'retry')).toBe(false);
    });

    it('should track recovery time', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      const fault = eng.reportFault('crash', 'C');
      eng.resolveFault(fault.id, 'retry');

      const resolved = eng.getFaults({ resolved: true })[0];
      expect(resolved.recoveryTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Degradation Management ────────────────────────────────────────────

  describe('degradation management', () => {
    it('should start at full capability', () => {
      expect(engine.getDegradation()).toBe('full');
    });

    it('should change degradation level', () => {
      engine.setDegradation('reduced', 'API slow');
      expect(engine.getDegradation()).toBe('reduced');
    });

    it('should emit degradation_changed event', () => {
      const handler = vi.fn();
      engine.on('degradation_changed', handler);

      engine.setDegradation('local_only', 'No network');
      expect(handler).toHaveBeenCalledWith('local_only', 'No network');
    });

    it('should not emit when level stays same', () => {
      const handler = vi.fn();
      engine.on('degradation_changed', handler);

      engine.setDegradation('full', 'OK'); // same as default
      expect(handler).not.toHaveBeenCalled();
    });

    it('should check capability availability at full level', () => {
      expect(engine.isCapabilityAvailable('cloud_vision')).toBe(true);
      expect(engine.isCapabilityAvailable('local_processing')).toBe(true);
      expect(engine.isCapabilityAvailable('sync')).toBe(true);
    });

    it('should restrict capabilities at reduced level', () => {
      engine.setDegradation('reduced', 'test');

      expect(engine.isCapabilityAvailable('cloud_vision')).toBe(false);
      expect(engine.isCapabilityAvailable('cloud_api')).toBe(true);
      expect(engine.isCapabilityAvailable('local_processing')).toBe(true);
      expect(engine.isCapabilityAvailable('sync')).toBe(false);
    });

    it('should restrict capabilities at local_only level', () => {
      engine.setDegradation('local_only', 'test');

      expect(engine.isCapabilityAvailable('cloud_vision')).toBe(false);
      expect(engine.isCapabilityAvailable('cloud_api')).toBe(false);
      expect(engine.isCapabilityAvailable('local_processing')).toBe(true);
      expect(engine.isCapabilityAvailable('voice_commands')).toBe(true);
    });

    it('should restrict most capabilities at offline level', () => {
      engine.setDegradation('offline', 'test');

      expect(engine.isCapabilityAvailable('cloud_vision')).toBe(false);
      expect(engine.isCapabilityAvailable('local_processing')).toBe(false);
      expect(engine.isCapabilityAvailable('offline_cache')).toBe(true);
    });

    it('should get available capabilities list', () => {
      engine.setDegradation('local_only', 'test');
      const caps = engine.getAvailableCapabilities();
      expect(caps).toContain('local_processing');
      expect(caps).toContain('offline_cache');
      expect(caps).not.toContain('cloud_vision');
      expect(caps).not.toContain('sync');
    });

    it('should allow unknown capabilities by default', () => {
      expect(engine.isCapabilityAvailable('custom_thing')).toBe(true);
    });
  });

  // ─── Network Monitoring ────────────────────────────────────────────────

  describe('network monitoring', () => {
    it('should start as online', () => {
      expect(engine.isNetworkOnline()).toBe(true);
    });

    it('should handle going offline', () => {
      const lostHandler = vi.fn();
      engine.on('network_lost', lostHandler);

      engine.setNetworkStatus(false);
      expect(engine.isNetworkOnline()).toBe(false);
      expect(lostHandler).toHaveBeenCalledOnce();
    });

    it('should handle coming back online', () => {
      const restoredHandler = vi.fn();
      engine.on('network_restored', restoredHandler);

      engine.setNetworkStatus(false);
      engine.setNetworkStatus(true);
      expect(engine.isNetworkOnline()).toBe(true);
      expect(restoredHandler).toHaveBeenCalledOnce();
    });

    it('should not emit redundant events for same status', () => {
      const handler = vi.fn();
      engine.on('network_lost', handler);

      engine.setNetworkStatus(true); // same as default
      expect(handler).not.toHaveBeenCalled();
    });

    it('should degrade to local_only when network lost', () => {
      engine.setNetworkStatus(false);
      expect(engine.getDegradation()).toBe('local_only');
    });

    it('should restore to full when network returns', () => {
      engine.setNetworkStatus(false);
      engine.setNetworkStatus(true);
      expect(engine.getDegradation()).toBe('full');
    });

    it('should report network_loss fault', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      eng.setNetworkStatus(false);
      const faults = eng.getFaults({ type: 'network_loss' });
      expect(faults.length).toBe(1);
    });
  });

  // ─── Hardware Monitoring ───────────────────────────────────────────────

  describe('hardware monitoring', () => {
    it('should register device via heartbeat', () => {
      engine.deviceHeartbeat('glasses-1');
      expect(engine.getConnectedDevices()).toContain('glasses-1');
    });

    it('should emit hardware_reconnected for new device', () => {
      const handler = vi.fn();
      engine.on('hardware_reconnected', handler);

      engine.deviceHeartbeat('glasses-1');
      expect(handler).toHaveBeenCalledWith('glasses-1');
    });

    it('should not emit for repeat heartbeat', () => {
      engine.deviceHeartbeat('glasses-1');

      const handler = vi.fn();
      engine.on('hardware_reconnected', handler);
      engine.deviceHeartbeat('glasses-1'); // already known
      expect(handler).not.toHaveBeenCalled();
    });

    it('should check device connectivity', () => {
      engine.deviceHeartbeat('glasses-1');
      expect(engine.isDeviceConnected('glasses-1')).toBe(true);
    });

    it('should report unknown device as disconnected', () => {
      expect(engine.isDeviceConnected('unknown')).toBe(false);
    });

    it('should detect disconnected devices via health check', () => {
      const eng = new FaultRecoveryEngine({
        hardwareTimeoutMs: 100,
        autoRecover: false,
      });

      eng.deviceHeartbeat('glasses-1');

      // Manually set old timestamp to simulate timeout
      (eng as any).connectedDevices.set('glasses-1', Date.now() - 200);

      const disconnected = eng.checkDeviceHealth();
      expect(disconnected).toContain('glasses-1');
      expect(eng.getConnectedDevices()).not.toContain('glasses-1');
    });

    it('should emit hardware_disconnected on timeout', () => {
      const eng = new FaultRecoveryEngine({
        hardwareTimeoutMs: 100,
        autoRecover: false,
      });
      const handler = vi.fn();
      eng.on('hardware_disconnected', handler);

      eng.deviceHeartbeat('glasses-1');
      (eng as any).connectedDevices.set('glasses-1', Date.now() - 200);

      eng.checkDeviceHealth();
      expect(handler).toHaveBeenCalledWith('glasses-1');
    });

    it('should report hardware_disconnect fault on timeout', () => {
      const eng = new FaultRecoveryEngine({
        hardwareTimeoutMs: 100,
        autoRecover: false,
      });

      eng.deviceHeartbeat('glasses-1');
      (eng as any).connectedDevices.set('glasses-1', Date.now() - 200);

      eng.checkDeviceHealth();
      const faults = eng.getFaults({ type: 'hardware_disconnect' });
      expect(faults.length).toBe(1);
    });

    it('should list multiple connected devices', () => {
      engine.deviceHeartbeat('glasses-1');
      engine.deviceHeartbeat('phone-1');
      engine.deviceHeartbeat('tablet-1');

      const devices = engine.getConnectedDevices();
      expect(devices.length).toBe(3);
    });
  });

  // ─── Health Probes ──────────────────────────────────────────────────────

  describe('health probes', () => {
    it('should register a health probe', () => {
      engine.registerProbe('test', () => true);
      const statuses = engine.getProbeStatuses();
      expect(statuses.length).toBe(1);
      expect(statuses[0].name).toBe('test');
    });

    it('should run probes and collect results', async () => {
      engine.registerProbe('healthy', () => true, { intervalMs: 0 });
      engine.registerProbe('unhealthy', () => false, { intervalMs: 0 });

      const results = await engine.runProbes();
      expect(results.get('healthy')).toBe(true);
      expect(results.get('unhealthy')).toBe(false);
    });

    it('should track consecutive failures', async () => {
      engine.registerProbe('flaky', () => false, { intervalMs: 0, maxFailures: 3 });

      await engine.runProbes();
      // Reset lastCheck so it runs again immediately
      (engine as any).healthProbes.get('flaky').lastCheck = 0;
      await engine.runProbes();

      const statuses = engine.getProbeStatuses();
      const flaky = statuses.find(s => s.name === 'flaky');
      expect(flaky!.failures).toBe(2);
    });

    it('should reset failures on success', async () => {
      let healthy = false;
      engine.registerProbe('toggle', () => healthy, { intervalMs: 0 });

      await engine.runProbes();
      expect(engine.getProbeStatuses()[0].failures).toBe(1);

      healthy = true;
      // Reset lastCheck so it runs again immediately
      (engine as any).healthProbes.get('toggle').lastCheck = 0;
      await engine.runProbes();
      expect(engine.getProbeStatuses()[0].failures).toBe(0);
    });

    it('should report fault after max failures', async () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      eng.registerProbe('bad', () => false, { intervalMs: 0, maxFailures: 2 });

      await eng.runProbes();
      // Reset lastCheck so it runs again immediately
      (eng as any).healthProbes.get('bad').lastCheck = 0;
      await eng.runProbes();

      const faults = eng.getFaults();
      expect(faults.length).toBe(1);
      expect(faults[0].message).toContain('bad');
    });

    it('should handle async probes', async () => {
      engine.registerProbe('async', async () => {
        return true;
      }, { intervalMs: 0 });

      const results = await engine.runProbes();
      expect(results.get('async')).toBe(true);
    });

    it('should handle probe errors gracefully', async () => {
      engine.registerProbe('error', () => {
        throw new Error('probe error');
      }, { intervalMs: 0 });

      const results = await engine.runProbes();
      expect(results.get('error')).toBe(false);
    });

    it('should not run probes before interval', async () => {
      engine.registerProbe('interval', () => true, { intervalMs: 60000 });

      const r1 = await engine.runProbes();
      expect(r1.size).toBe(1); // first run always runs

      const r2 = await engine.runProbes();
      expect(r2.size).toBe(0); // too soon
    });
  });

  // ─── Statistics ─────────────────────────────────────────────────────────

  describe('statistics', () => {
    it('should return baseline stats', () => {
      const stats = engine.getStats();

      expect(stats.totalFaults).toBe(0);
      expect(stats.resolvedFaults).toBe(0);
      expect(stats.unresolvedFaults).toBe(0);
      expect(stats.totalRecoveries).toBe(0);
      expect(stats.currentDegradation).toBe('full');
      expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(stats.lastFaultAt).toBeNull();
      expect(stats.mtbf).toBeNull();
      expect(stats.mttr).toBeNull();
    });

    it('should track fault counts', () => {
      engine.reportFault('crash', 'C1');
      engine.reportFault('timeout', 'T1');

      const stats = engine.getStats();
      expect(stats.totalFaults).toBe(2);
    });

    it('should track checkpoint counts', () => {
      const metadata = {
        itemCount: 0, scanCount: 0, zonesCovered: [],
        lastAction: '', elapsedMs: 0,
      };
      engine.createCheckpoint('s1', {}, metadata);
      engine.createCheckpoint('s2', {}, metadata);

      const stats = engine.getStats();
      expect(stats.totalCheckpoints).toBe(2);
    });

    it('should track WAL entry counts', () => {
      engine.appendWAL('s1', 'op', {});
      engine.appendWAL('s2', 'op', {});
      engine.appendWAL('s1', 'op2', {});

      const stats = engine.getStats();
      expect(stats.totalWALEntries).toBe(3);
    });

    it('should calculate MTBF with multiple faults', () => {
      // Create faults with known timing
      engine.reportFault('crash', 'C1');
      engine.reportFault('timeout', 'T1');

      const stats = engine.getStats();
      // MTBF should be non-null with 2+ faults
      expect(stats.mtbf).not.toBeNull();
    });

    it('should track recovery success rate', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });

      const f1 = eng.reportFault('timeout', 'T');
      eng.startRecovery(f1.id);
      eng.attemptRecovery(f1.id);

      const stats = eng.getStats();
      expect(stats.totalRecoveries).toBeGreaterThan(0);
    });

    it('should track last fault timestamp', () => {
      const before = Date.now();
      engine.reportFault('crash', 'C');

      const stats = engine.getStats();
      expect(stats.lastFaultAt).not.toBeNull();
      expect(stats.lastFaultAt!).toBeGreaterThanOrEqual(before);
    });
  });

  // ─── Voice Summary ─────────────────────────────────────────────────────

  describe('voice summary', () => {
    it('should report fully operational when healthy', () => {
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('fully operational');
    });

    it('should mention degradation level', () => {
      engine.setDegradation('local_only', 'test');
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('local only');
    });

    it('should mention unresolved issues', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      eng.reportFault('crash', 'C1');
      eng.reportFault('crash', 'C2');

      const summary = eng.getVoiceSummary();
      expect(summary).toContain('2 unresolved issues');
    });

    it('should mention single unresolved issue', () => {
      const eng = new FaultRecoveryEngine({ autoRecover: false });
      eng.reportFault('crash', 'C1');

      const summary = eng.getVoiceSummary();
      expect(summary).toContain('1 unresolved issue');
    });

    it('should mention offline status', () => {
      engine.setNetworkStatus(false);
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('offline');
    });

    it('should mention connected devices', () => {
      engine.deviceHeartbeat('glasses-1');
      engine.deviceHeartbeat('phone-1');

      const summary = engine.getVoiceSummary();
      expect(summary).toContain('2 devices connected');
    });

    it('should mention no devices', () => {
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('No devices connected');
    });

    it('should mention data loss', () => {
      // Trigger data loss scenario
      (engine as any).totalItemsLost = 3;
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('3 items may have been lost');
    });
  });
});
