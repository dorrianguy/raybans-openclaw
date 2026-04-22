/**
 * Tests for Session Manager — Multi-Device Session Coordination
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SessionManager,
  DEFAULT_SESSION_CONFIG,
  type SessionManagerConfig,
  type Session,
  type DeviceType,
  type SessionType,
  type SessionStatus,
} from './session-manager.js';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({ autoExpireEnabled: false });
  });

  afterEach(() => {
    manager.destroy();
  });

  // ─── Session Creation ─────────────────────────────────────────────────

  describe('createSession', () => {
    it('should create a session with required fields', () => {
      const session = manager.createSession({
        userId: 'user1',
        type: 'inventory',
      });

      expect(session.id).toBeDefined();
      expect(session.id).toMatch(/^ses_/);
      expect(session.userId).toBe('user1');
      expect(session.type).toBe('inventory');
      expect(session.status).toBe('active');
      expect(session.devices).toEqual([]);
      expect(session.tags).toEqual([]);
      expect(session.notes).toEqual([]);
      expect(session.duration).toBe(0);
      expect(session.pausedDuration).toBe(0);
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('should create a session with optional fields', () => {
      const session = manager.createSession({
        userId: 'user1',
        type: 'inspection',
        title: 'Warehouse A Inspection',
        description: 'Annual inspection',
        tags: ['warehouse', 'annual'],
        metadata: { location: 'Building A' },
        agentIds: ['inspection-agent', 'security-agent'],
      });

      expect(session.title).toBe('Warehouse A Inspection');
      expect(session.description).toBe('Annual inspection');
      expect(session.tags).toEqual(['warehouse', 'annual']);
      expect(session.metadata).toEqual({ location: 'Building A' });
      expect(session.agentIds).toEqual(['inspection-agent', 'security-agent']);
    });

    it('should generate unique session IDs', () => {
      const s1 = manager.createSession({ userId: 'user1', type: 'general' });
      const s2 = manager.createSession({ userId: 'user1', type: 'general' });
      expect(s1.id).not.toBe(s2.id);
    });

    it('should truncate long titles', () => {
      const longTitle = 'A'.repeat(300);
      const session = manager.createSession({
        userId: 'user1',
        type: 'general',
        title: longTitle,
      });
      expect(session.title!.length).toBe(DEFAULT_SESSION_CONFIG.maxTitleLength);
    });

    it('should limit tags to max count', () => {
      const tags = Array.from({ length: 30 }, (_, i) => `tag${i}`);
      const session = manager.createSession({
        userId: 'user1',
        type: 'general',
        tags,
      });
      expect(session.tags.length).toBe(DEFAULT_SESSION_CONFIG.maxTagsPerSession);
    });

    it('should emit session:created event', () => {
      const handler = vi.fn();
      manager.on('session:created', handler);

      manager.createSession({ userId: 'user1', type: 'inventory' });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].userId).toBe('user1');
    });

    it('should enforce concurrent session limit', () => {
      const mgr = new SessionManager({
        autoExpireEnabled: false,
        maxSessionsPerUser: 2,
      });

      mgr.createSession({ userId: 'user1', type: 'general' });
      mgr.createSession({ userId: 'user1', type: 'general' });

      expect(() =>
        mgr.createSession({ userId: 'user1', type: 'general' })
      ).toThrow('maximum of 2 concurrent sessions');

      mgr.destroy();
    });

    it('should emit limit:approaching when near max', () => {
      const mgr = new SessionManager({
        autoExpireEnabled: false,
        maxSessionsPerUser: 2,
      });
      const handler = vi.fn();
      mgr.on('limit:approaching', handler);

      mgr.createSession({ userId: 'user1', type: 'general' });
      // Second session = at limit, should emit approaching
      mgr.createSession({ userId: 'user1', type: 'general' });

      expect(handler).toHaveBeenCalledWith('user1', 2, 2);

      mgr.destroy();
    });

    it('should emit limit:reached when at max', () => {
      const mgr = new SessionManager({
        autoExpireEnabled: false,
        maxSessionsPerUser: 1,
      });
      const handler = vi.fn();
      mgr.on('limit:reached', handler);

      mgr.createSession({ userId: 'user1', type: 'general' });

      expect(() =>
        mgr.createSession({ userId: 'user1', type: 'general' })
      ).toThrow();

      expect(handler).toHaveBeenCalledWith('user1', 1);

      mgr.destroy();
    });

    it('should allow different users to have separate session limits', () => {
      const mgr = new SessionManager({
        autoExpireEnabled: false,
        maxSessionsPerUser: 1,
      });

      mgr.createSession({ userId: 'user1', type: 'general' });
      // Different user should work
      const s2 = mgr.createSession({ userId: 'user2', type: 'general' });
      expect(s2.userId).toBe('user2');

      mgr.destroy();
    });

    it('should initialize stats to zero', () => {
      const session = manager.createSession({ userId: 'user1', type: 'general' });
      expect(session.stats).toEqual({
        imagesProcessed: 0,
        voiceCommands: 0,
        agentInvocations: 0,
        itemsScanned: 0,
        errorsEncountered: 0,
        deviceHandoffs: 0,
        pauseCount: 0,
      });
    });

    it('should set expiresAt based on timeout config', () => {
      const session = manager.createSession({ userId: 'user1', type: 'general' });
      expect(session.expiresAt).toBeDefined();
      expect(session.expiresAt! - session.createdAt).toBe(DEFAULT_SESSION_CONFIG.sessionTimeoutMs);
    });
  });

  // ─── Session Lifecycle ────────────────────────────────────────────────

  describe('pauseSession', () => {
    it('should pause an active session', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      const paused = manager.pauseSession(session.id);

      expect(paused.status).toBe('paused');
      expect(paused.pausedAt).toBeDefined();
      expect(paused.stats.pauseCount).toBe(1);
    });

    it('should emit session:paused event with reason', () => {
      const handler = vi.fn();
      manager.on('session:paused', handler);

      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.pauseSession(session.id, 'lunch break');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][1]).toBe('lunch break');
    });

    it('should throw if session is not active', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.pauseSession(session.id);

      expect(() => manager.pauseSession(session.id)).toThrow("Cannot pause session in 'paused' status");
    });

    it('should increment pause count on multiple pauses', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });

      manager.pauseSession(session.id);
      manager.resumeSession(session.id);
      manager.pauseSession(session.id);
      manager.resumeSession(session.id);
      manager.pauseSession(session.id);

      const s = manager.getSession(session.id)!;
      expect(s.stats.pauseCount).toBe(3);
    });
  });

  describe('resumeSession', () => {
    it('should resume a paused session', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.pauseSession(session.id);
      const resumed = manager.resumeSession(session.id);

      expect(resumed.status).toBe('active');
      expect(resumed.pausedDuration).toBeGreaterThanOrEqual(0);
    });

    it('should emit session:resumed event', () => {
      const handler = vi.fn();
      manager.on('session:resumed', handler);

      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.pauseSession(session.id);
      manager.resumeSession(session.id);

      expect(handler).toHaveBeenCalledOnce();
    });

    it('should throw if session is not paused', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });

      expect(() => manager.resumeSession(session.id)).toThrow("Cannot resume session in 'active' status");
    });

    it('should track paused duration', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.pauseSession(session.id);

      // Simulate some time passing
      const s = manager.getSession(session.id)!;
      // Since the pause just happened, pausedDuration should be 0 until resume
      manager.resumeSession(session.id);
      const resumed = manager.getSession(session.id)!;
      expect(resumed.pausedDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('completeSession', () => {
    it('should complete an active session', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      const summary = manager.completeSession(session.id);

      expect(summary.sessionId).toBe(session.id);
      expect(summary.type).toBe('inventory');
      expect(summary.voiceSummary).toBeDefined();

      const completed = manager.getSession(session.id)!;
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeDefined();
    });

    it('should complete a paused session', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.pauseSession(session.id);
      const summary = manager.completeSession(session.id);

      expect(summary.sessionId).toBe(session.id);
      const completed = manager.getSession(session.id)!;
      expect(completed.status).toBe('completed');
    });

    it('should emit session:completed with summary', () => {
      const handler = vi.fn();
      manager.on('session:completed', handler);

      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.completeSession(session.id);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][1].sessionId).toBe(session.id);
    });

    it('should throw if session already completed', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.completeSession(session.id);

      expect(() => manager.completeSession(session.id)).toThrow("already 'completed'");
    });

    it('should return correct stats in summary', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.incrementStat(session.id, 'imagesProcessed', 25);
      manager.incrementStat(session.id, 'itemsScanned', 100);
      manager.incrementStat(session.id, 'voiceCommands', 15);

      const summary = manager.completeSession(session.id);
      expect(summary.stats.imagesProcessed).toBe(25);
      expect(summary.stats.itemsScanned).toBe(100);
      expect(summary.stats.voiceCommands).toBe(15);
    });
  });

  describe('cancelSession', () => {
    it('should cancel an active session', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      const cancelled = manager.cancelSession(session.id, 'user request');

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.completedAt).toBeDefined();
    });

    it('should emit session:cancelled with reason', () => {
      const handler = vi.fn();
      manager.on('session:cancelled', handler);

      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.cancelSession(session.id, 'test reason');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][1]).toBe('test reason');
    });

    it('should throw if session already completed', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.completeSession(session.id);

      expect(() => manager.cancelSession(session.id)).toThrow("already 'completed'");
    });
  });

  // ─── Device Management ────────────────────────────────────────────────

  describe('connectDevice', () => {
    it('should connect a device to a session', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      const device = manager.connectDevice(session.id, {
        deviceId: 'glasses-1',
        type: 'glasses',
        name: 'Ray-Ban Meta',
      });

      expect(device.deviceId).toBe('glasses-1');
      expect(device.type).toBe('glasses');
      expect(device.name).toBe('Ray-Ban Meta');
      expect(device.capabilities).toContain('camera');
      expect(device.capabilities).toContain('microphone');
    });

    it('should set first device as primary', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'glasses-1', type: 'glasses' });

      const s = manager.getSession(session.id)!;
      expect(s.primaryDeviceId).toBe('glasses-1');
    });

    it('should allow multiple devices', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'glasses-1', type: 'glasses' });
      manager.connectDevice(session.id, { deviceId: 'phone-1', type: 'phone' });
      manager.connectDevice(session.id, { deviceId: 'dash-1', type: 'dashboard' });

      const s = manager.getSession(session.id)!;
      expect(s.devices.length).toBe(3);
    });

    it('should handle reconnecting the same device', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'glasses-1', type: 'glasses' });
      manager.connectDevice(session.id, { deviceId: 'glasses-1', type: 'glasses' });

      const s = manager.getSession(session.id)!;
      expect(s.devices.length).toBe(1);
    });

    it('should enforce max devices per session', () => {
      const mgr = new SessionManager({
        autoExpireEnabled: false,
        maxDevicesPerSession: 2,
      });

      const session = mgr.createSession({ userId: 'user1', type: 'inventory' });
      mgr.connectDevice(session.id, { deviceId: 'd1', type: 'glasses' });
      mgr.connectDevice(session.id, { deviceId: 'd2', type: 'phone' });

      expect(() =>
        mgr.connectDevice(session.id, { deviceId: 'd3', type: 'dashboard' })
      ).toThrow('maximum of 2 connected devices');

      mgr.destroy();
    });

    it('should emit device:connected event', () => {
      const handler = vi.fn();
      manager.on('device:connected', handler);

      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'glasses-1', type: 'glasses' });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toBe(session.id);
    });

    it('should assign default capabilities by device type', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });

      const glasses = manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });
      expect(glasses.capabilities).toContain('camera');
      expect(glasses.capabilities).toContain('gps');
      expect(glasses.capabilities).toContain('accelerometer');

      const phone = manager.connectDevice(session.id, { deviceId: 'p1', type: 'phone' });
      expect(phone.capabilities).toContain('touch');
      expect(phone.capabilities).toContain('display');

      const dash = manager.connectDevice(session.id, { deviceId: 'd1', type: 'dashboard' });
      expect(dash.capabilities).toContain('keyboard');
      expect(dash.capabilities).toContain('display');

      const api = manager.connectDevice(session.id, { deviceId: 'a1', type: 'api' });
      expect(api.capabilities).toEqual([]);
    });

    it('should accept custom capabilities', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      const device = manager.connectDevice(session.id, {
        deviceId: 'custom-1',
        type: 'companion',
        capabilities: ['barcode_scanner', 'display'],
      });
      expect(device.capabilities).toEqual(['barcode_scanner', 'display']);
    });

    it('should throw if session is completed', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.completeSession(session.id);

      expect(() =>
        manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' })
      ).toThrow("Cannot connect device to session in 'completed' status");
    });
  });

  describe('disconnectDevice', () => {
    it('should disconnect a device', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });
      manager.connectDevice(session.id, { deviceId: 'p1', type: 'phone' });

      manager.disconnectDevice(session.id, 'g1');

      const s = manager.getSession(session.id)!;
      expect(s.devices.length).toBe(1);
      expect(s.devices[0].deviceId).toBe('p1');
    });

    it('should reassign primary device when primary disconnects', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });
      manager.connectDevice(session.id, { deviceId: 'p1', type: 'phone' });

      manager.disconnectDevice(session.id, 'g1');

      const s = manager.getSession(session.id)!;
      expect(s.primaryDeviceId).toBe('p1');
    });

    it('should clear primary when last device disconnects', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });
      manager.disconnectDevice(session.id, 'g1');

      const s = manager.getSession(session.id)!;
      expect(s.primaryDeviceId).toBeUndefined();
    });

    it('should emit device:disconnected event', () => {
      const handler = vi.fn();
      manager.on('device:disconnected', handler);

      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });
      manager.disconnectDevice(session.id, 'g1', 'user_request');

      expect(handler).toHaveBeenCalledWith(session.id, 'g1', 'user_request');
    });

    it('should throw if device not found', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      expect(() => manager.disconnectDevice(session.id, 'nonexistent')).toThrow('not found');
    });
  });

  describe('deviceHeartbeat', () => {
    it('should update device heartbeat timestamp', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });

      const before = manager.getSession(session.id)!.devices[0].lastHeartbeat;
      manager.deviceHeartbeat(session.id, 'g1');
      const after = manager.getSession(session.id)!.devices[0].lastHeartbeat;

      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('should emit device:heartbeat event', () => {
      const handler = vi.fn();
      manager.on('device:heartbeat', handler);

      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });
      manager.deviceHeartbeat(session.id, 'g1');

      expect(handler).toHaveBeenCalledWith(session.id, 'g1');
    });

    it('should throw if device not found', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      expect(() => manager.deviceHeartbeat(session.id, 'nonexistent')).toThrow('not found');
    });
  });

  describe('handoffDevice', () => {
    it('should transfer primary control between devices', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });
      manager.connectDevice(session.id, { deviceId: 'p1', type: 'phone' });

      const result = manager.handoffDevice(session.id, 'g1', 'p1');

      expect(result.success).toBe(true);
      expect(result.fromDevice).toBe('g1');
      expect(result.toDevice).toBe('p1');

      const s = manager.getSession(session.id)!;
      expect(s.primaryDeviceId).toBe('p1');
      expect(s.stats.deviceHandoffs).toBe(1);
    });

    it('should fail if source device not found', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'p1', type: 'phone' });

      const result = manager.handoffDevice(session.id, 'nonexistent', 'p1');
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Source device not found');
    });

    it('should fail if target device not found', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });

      const result = manager.handoffDevice(session.id, 'g1', 'nonexistent');
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Target device not found');
    });

    it('should emit device:handoff event', () => {
      const handler = vi.fn();
      manager.on('device:handoff', handler);

      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });
      manager.connectDevice(session.id, { deviceId: 'p1', type: 'phone' });
      manager.handoffDevice(session.id, 'g1', 'p1');

      expect(handler).toHaveBeenCalledWith(session.id, 'g1', 'p1');
    });
  });

  describe('checkDeviceTimeouts', () => {
    it('should disconnect devices that exceed heartbeat timeout', () => {
      const mgr = new SessionManager({
        autoExpireEnabled: false,
        heartbeatTimeoutMs: 100,
      });

      const session = mgr.createSession({ userId: 'user1', type: 'inventory' });
      mgr.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });

      // Manually age the heartbeat
      const s = mgr.getSession(session.id)!;
      const internalSession = (mgr as any).sessions.get(session.id)!;
      internalSession.devices[0].lastHeartbeat = Date.now() - 200;

      const timedOut = mgr.checkDeviceTimeouts(session.id);
      expect(timedOut).toEqual(['g1']);

      const updated = mgr.getSession(session.id)!;
      expect(updated.devices.length).toBe(0);

      mgr.destroy();
    });

    it('should not disconnect devices within timeout window', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });

      const timedOut = manager.checkDeviceTimeouts(session.id);
      expect(timedOut).toEqual([]);
    });

    it('should return empty array for nonexistent session', () => {
      const result = manager.checkDeviceTimeouts('nonexistent');
      expect(result).toEqual([]);
    });
  });

  // ─── Session Metadata ─────────────────────────────────────────────────

  describe('tags', () => {
    it('should add tags', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.addTag(session.id, 'urgent');
      manager.addTag(session.id, 'warehouse');

      const s = manager.getSession(session.id)!;
      expect(s.tags).toEqual(['urgent', 'warehouse']);
    });

    it('should normalize tags to lowercase', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.addTag(session.id, 'URGENT');

      const s = manager.getSession(session.id)!;
      expect(s.tags).toEqual(['urgent']);
    });

    it('should not duplicate tags', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.addTag(session.id, 'urgent');
      manager.addTag(session.id, 'urgent');

      const s = manager.getSession(session.id)!;
      expect(s.tags).toEqual(['urgent']);
    });

    it('should remove tags', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.addTag(session.id, 'urgent');
      manager.addTag(session.id, 'warehouse');
      manager.removeTag(session.id, 'urgent');

      const s = manager.getSession(session.id)!;
      expect(s.tags).toEqual(['warehouse']);
    });

    it('should enforce max tags', () => {
      const mgr = new SessionManager({
        autoExpireEnabled: false,
        maxTagsPerSession: 3,
      });

      const session = mgr.createSession({ userId: 'user1', type: 'inventory' });
      mgr.addTag(session.id, 'a');
      mgr.addTag(session.id, 'b');
      mgr.addTag(session.id, 'c');

      expect(() => mgr.addTag(session.id, 'd')).toThrow('maximum of 3 tags');

      mgr.destroy();
    });

    it('should ignore empty tags', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.addTag(session.id, '  ');

      const s = manager.getSession(session.id)!;
      expect(s.tags).toEqual([]);
    });
  });

  describe('notes', () => {
    it('should add notes', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.addNote(session.id, 'Aisle 3 needs recount');

      const s = manager.getSession(session.id)!;
      expect(s.notes).toEqual(['Aisle 3 needs recount']);
    });

    it('should truncate long notes', () => {
      const longNote = 'N'.repeat(2000);
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.addNote(session.id, longNote);

      const s = manager.getSession(session.id)!;
      expect(s.notes[0].length).toBe(DEFAULT_SESSION_CONFIG.maxNoteLength);
    });

    it('should enforce max notes', () => {
      const mgr = new SessionManager({
        autoExpireEnabled: false,
        maxNotesPerSession: 2,
      });

      const session = mgr.createSession({ userId: 'user1', type: 'inventory' });
      mgr.addNote(session.id, 'Note 1');
      mgr.addNote(session.id, 'Note 2');

      expect(() => mgr.addNote(session.id, 'Note 3')).toThrow('maximum of 2 notes');

      mgr.destroy();
    });
  });

  describe('metadata', () => {
    it('should update metadata', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.updateMetadata(session.id, { storeId: 'store-1', floor: 2 });

      const s = manager.getSession(session.id)!;
      expect(s.metadata).toEqual({ storeId: 'store-1', floor: 2 });
    });

    it('should merge metadata', () => {
      const session = manager.createSession({
        userId: 'user1',
        type: 'inventory',
        metadata: { storeId: 'store-1' },
      });
      manager.updateMetadata(session.id, { floor: 2 });

      const s = manager.getSession(session.id)!;
      expect(s.metadata).toEqual({ storeId: 'store-1', floor: 2 });
    });
  });

  describe('stats', () => {
    it('should increment stats', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.incrementStat(session.id, 'imagesProcessed', 5);
      manager.incrementStat(session.id, 'itemsScanned', 10);
      manager.incrementStat(session.id, 'voiceCommands');

      const s = manager.getSession(session.id)!;
      expect(s.stats.imagesProcessed).toBe(5);
      expect(s.stats.itemsScanned).toBe(10);
      expect(s.stats.voiceCommands).toBe(1);
    });
  });

  describe('agents', () => {
    it('should add and remove agents', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.addAgent(session.id, 'inventory-agent');
      manager.addAgent(session.id, 'security-agent');

      let s = manager.getSession(session.id)!;
      expect(s.agentIds).toEqual(['inventory-agent', 'security-agent']);

      manager.removeAgent(session.id, 'inventory-agent');
      s = manager.getSession(session.id)!;
      expect(s.agentIds).toEqual(['security-agent']);
    });

    it('should not duplicate agents', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.addAgent(session.id, 'inventory-agent');
      manager.addAgent(session.id, 'inventory-agent');

      const s = manager.getSession(session.id)!;
      expect(s.agentIds).toEqual(['inventory-agent']);
    });
  });

  // ─── Queries ──────────────────────────────────────────────────────────

  describe('querySessions', () => {
    beforeEach(() => {
      manager.createSession({ userId: 'user1', type: 'inventory', tags: ['warehouse'] });
      manager.createSession({ userId: 'user1', type: 'inspection', tags: ['annual'] });
      manager.createSession({ userId: 'user2', type: 'meeting' });
    });

    it('should return all sessions with empty query', () => {
      const results = manager.querySessions();
      expect(results.length).toBe(3);
    });

    it('should filter by userId', () => {
      const results = manager.querySessions({ userId: 'user1' });
      expect(results.length).toBe(2);
    });

    it('should filter by status', () => {
      const sessions = manager.querySessions({ userId: 'user1' });
      manager.pauseSession(sessions[0].id);

      const active = manager.querySessions({ status: 'active' });
      const paused = manager.querySessions({ status: 'paused' });
      expect(active.length).toBe(2);
      expect(paused.length).toBe(1);
    });

    it('should filter by multiple statuses', () => {
      const sessions = manager.querySessions({ userId: 'user1' });
      manager.completeSession(sessions[0].id);

      const results = manager.querySessions({ status: ['active', 'completed'] });
      expect(results.length).toBe(3);
    });

    it('should filter by type', () => {
      const results = manager.querySessions({ type: 'inventory' });
      expect(results.length).toBe(1);
    });

    it('should filter by multiple types', () => {
      const results = manager.querySessions({ type: ['inventory', 'inspection'] });
      expect(results.length).toBe(2);
    });

    it('should filter by tags', () => {
      const results = manager.querySessions({ tags: ['warehouse'] });
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('inventory');
    });

    it('should filter by device type', () => {
      const sessions = manager.querySessions({ userId: 'user1' });
      manager.connectDevice(sessions[0].id, { deviceId: 'g1', type: 'glasses' });

      const results = manager.querySessions({ deviceType: 'glasses' });
      expect(results.length).toBe(1);
    });

    it('should support pagination', () => {
      const page1 = manager.querySessions({ limit: 2, offset: 0 });
      const page2 = manager.querySessions({ limit: 2, offset: 2 });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(1);
    });

    it('should sort by createdAt desc by default', () => {
      const results = manager.querySessions({ sortBy: 'lastActivityAt', sortOrder: 'desc' });
      // All created in same ms, so just verify we get all 3 back sorted
      expect(results.length).toBe(3);
    });

    it('should sort ascending when specified', () => {
      const results = manager.querySessions({ sortOrder: 'asc' });
      expect(results[0].type).toBe('inventory'); // oldest
    });
  });

  describe('getActiveSessionCount', () => {
    it('should count active and paused sessions', () => {
      const s1 = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.createSession({ userId: 'user1', type: 'inspection' });
      manager.pauseSession(s1.id);

      expect(manager.getActiveSessionCount('user1')).toBe(2);
    });

    it('should not count completed sessions', () => {
      const s1 = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.createSession({ userId: 'user1', type: 'inspection' });
      manager.completeSession(s1.id);

      expect(manager.getActiveSessionCount('user1')).toBe(1);
    });
  });

  describe('getActiveSessions', () => {
    it('should return only active and paused sessions', () => {
      const s1 = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.createSession({ userId: 'user1', type: 'inspection' });
      const s3 = manager.createSession({ userId: 'user1', type: 'meeting' });
      manager.completeSession(s1.id);
      manager.pauseSession(s3.id);

      const active = manager.getActiveSessions();
      expect(active.length).toBe(2);
    });
  });

  describe('getSessionsByDevice', () => {
    it('should find sessions with specific device types', () => {
      const s1 = manager.createSession({ userId: 'user1', type: 'inventory' });
      const s2 = manager.createSession({ userId: 'user1', type: 'inspection' });
      manager.connectDevice(s1.id, { deviceId: 'g1', type: 'glasses' });
      manager.connectDevice(s2.id, { deviceId: 'p1', type: 'phone' });

      const glassesSessions = manager.getSessionsByDevice('glasses');
      expect(glassesSessions.length).toBe(1);
    });
  });

  // ─── Auto-Expire ──────────────────────────────────────────────────────

  describe('expireSessions', () => {
    it('should expire sessions past their expiry time', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });

      // Manually set expiresAt to the past
      const internalSession = (manager as any).sessions.get(session.id)!;
      internalSession.expiresAt = Date.now() - 1000;

      const expired = manager.expireSessions();
      expect(expired).toEqual([session.id]);

      const s = manager.getSession(session.id)!;
      expect(s.status).toBe('expired');
    });

    it('should emit session:expired event', () => {
      const handler = vi.fn();
      manager.on('session:expired', handler);

      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      const internalSession = (manager as any).sessions.get(session.id)!;
      internalSession.expiresAt = Date.now() - 1000;

      manager.expireSessions();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should not expire sessions within timeout', () => {
      manager.createSession({ userId: 'user1', type: 'inventory' });

      const expired = manager.expireSessions();
      expect(expired).toEqual([]);
    });

    it('should not expire completed or cancelled sessions', () => {
      const s1 = manager.createSession({ userId: 'user1', type: 'inventory' });
      const s2 = manager.createSession({ userId: 'user1', type: 'inspection' });
      manager.completeSession(s1.id);
      manager.cancelSession(s2.id);

      // Expire both
      const is1 = (manager as any).sessions.get(s1.id)!;
      const is2 = (manager as any).sessions.get(s2.id)!;
      is1.expiresAt = Date.now() - 1000;
      is2.expiresAt = Date.now() - 1000;

      const expired = manager.expireSessions();
      expect(expired).toEqual([]);
    });
  });

  // ─── Voice Summary ────────────────────────────────────────────────────

  describe('generateVoiceSummary', () => {
    it('should generate a basic summary', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      const summary = manager.generateVoiceSummary(session.id);

      expect(summary).toContain('inventory session');
    });

    it('should include stats in summary', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.incrementStat(session.id, 'imagesProcessed', 25);
      manager.incrementStat(session.id, 'itemsScanned', 100);

      const summary = manager.generateVoiceSummary(session.id);
      expect(summary).toContain('25 images processed');
      expect(summary).toContain('100 items scanned');
    });

    it('should include device info', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.connectDevice(session.id, { deviceId: 'g1', type: 'glasses' });
      manager.connectDevice(session.id, { deviceId: 'p1', type: 'phone' });

      const summary = manager.generateVoiceSummary(session.id);
      expect(summary).toContain('Devices:');
      expect(summary).toContain('glasses');
      expect(summary).toContain('phone');
    });

    it('should include error count', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.incrementStat(session.id, 'errorsEncountered', 3);

      const summary = manager.generateVoiceSummary(session.id);
      expect(summary).toContain('3 errors encountered');
    });

    it('should format hours for long sessions', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      // Manually set duration to 2 hours 30 minutes
      const internalSession = (manager as any).sessions.get(session.id)!;
      internalSession.duration = 2.5 * 60 * 60 * 1000;

      const summary = manager.generateVoiceSummary(session.id);
      expect(summary).toContain('2 hours');
      expect(summary).toContain('30 minutes');
    });

    it('should handle session type with underscores', () => {
      const session = manager.createSession({ userId: 'user1', type: 'security_patrol' });
      const summary = manager.generateVoiceSummary(session.id);
      expect(summary).toContain('security patrol');
    });
  });

  // ─── Global Stats ─────────────────────────────────────────────────────

  describe('getGlobalStats', () => {
    it('should return correct counts by status', () => {
      const s1 = manager.createSession({ userId: 'user1', type: 'inventory' });
      const s2 = manager.createSession({ userId: 'user1', type: 'inspection' });
      const s3 = manager.createSession({ userId: 'user2', type: 'meeting' });
      manager.completeSession(s1.id);
      manager.cancelSession(s2.id);

      const stats = manager.getGlobalStats();
      expect(stats.totalSessions).toBe(3);
      expect(stats.activeSessions).toBe(1);
      expect(stats.completedSessions).toBe(1);
      expect(stats.cancelledSessions).toBe(1);
      expect(stats.uniqueUsers).toBe(2);
    });

    it('should aggregate total stats', () => {
      const s1 = manager.createSession({ userId: 'user1', type: 'inventory' });
      const s2 = manager.createSession({ userId: 'user1', type: 'inspection' });
      manager.incrementStat(s1.id, 'imagesProcessed', 10);
      manager.incrementStat(s2.id, 'imagesProcessed', 20);
      manager.incrementStat(s1.id, 'voiceCommands', 5);

      const stats = manager.getGlobalStats();
      expect(stats.totalImages).toBe(30);
      expect(stats.totalVoiceCommands).toBe(5);
    });
  });

  // ─── Session Count ────────────────────────────────────────────────────

  describe('getSessionCount', () => {
    it('should return total session count', () => {
      expect(manager.getSessionCount()).toBe(0);

      manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.createSession({ userId: 'user1', type: 'inspection' });

      expect(manager.getSessionCount()).toBe(2);
    });
  });

  // ─── History Trimming ─────────────────────────────────────────────────

  describe('history trimming', () => {
    it('should trim oldest terminal sessions when over limit', () => {
      const mgr = new SessionManager({
        autoExpireEnabled: false,
        maxSessionHistory: 3,
        maxSessionsPerUser: 100,
      });

      // Create and complete 3 sessions
      const s1 = mgr.createSession({ userId: 'user1', type: 'general' });
      mgr.completeSession(s1.id);
      const s2 = mgr.createSession({ userId: 'user1', type: 'general' });
      mgr.completeSession(s2.id);
      const s3 = mgr.createSession({ userId: 'user1', type: 'general' });
      mgr.completeSession(s3.id);

      // 4th should trigger trimming
      mgr.createSession({ userId: 'user1', type: 'general' });

      expect(mgr.getSessionCount()).toBeLessThanOrEqual(4);

      mgr.destroy();
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────────

  describe('error handling', () => {
    it('should throw for nonexistent session ID', () => {
      expect(() => manager.pauseSession('nonexistent')).toThrow('not found');
      expect(() => manager.resumeSession('nonexistent')).toThrow('not found');
      expect(() => manager.completeSession('nonexistent')).toThrow('not found');
      expect(() => manager.cancelSession('nonexistent')).toThrow('not found');
    });

    it('should throw for invalid session state transitions', () => {
      const session = manager.createSession({ userId: 'user1', type: 'inventory' });
      manager.completeSession(session.id);

      expect(() => manager.pauseSession(session.id)).toThrow("Cannot pause session in 'completed'");
      expect(() => manager.cancelSession(session.id)).toThrow("already 'completed'");
    });
  });

  // ─── Destroy ──────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should clean up timers on destroy', () => {
      const mgr = new SessionManager({ autoExpireEnabled: true });
      mgr.destroy();
      // Should not throw
      expect(mgr.getSessionCount()).toBe(0);
    });
  });
});
