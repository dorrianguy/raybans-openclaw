/**
 * Tests for Multi-Device Sync Engine
 * 🌙 Night Shift Agent — 2026-03-04
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeviceSyncEngine, type SyncOperation } from './device-sync.js';

// ─── Helper Functions ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const createEngine = (
  deviceId: string = 'device-1',
  opts: Record<string, any> = {}
) =>
  new DeviceSyncEngine({
    deviceId,
    deviceType: 'dashboard',
    ...opts,
  });

// ─── Device Management Tests ─────────────────────────────────────────────────

describe('DeviceSyncEngine — Device Management', () => {
  let engine: DeviceSyncEngine;

  afterEach(() => {
    engine.destroy();
  });

  it('should register self on creation', () => {
    engine = createEngine('server');
    const devices = engine.getAllDevices();
    expect(devices.length).toBe(1);
    expect(devices[0].deviceId).toBe('server');
    expect(devices[0].connected).toBe(true);
  });

  it('should register a new device', () => {
    engine = createEngine('server');
    const device = engine.registerDevice({
      deviceId: 'glasses-1',
      type: 'glasses',
      label: 'Dorrian\'s Ray-Bans',
    });

    expect(device.deviceId).toBe('glasses-1');
    expect(device.type).toBe('glasses');
    expect(device.connected).toBe(true);
    expect(device.capabilities).toContain('camera');
  });

  it('should update existing device on re-register', () => {
    engine = createEngine('server');
    engine.registerDevice({
      deviceId: 'phone-1',
      type: 'phone',
      label: 'iPhone',
    });

    const updated = engine.registerDevice({
      deviceId: 'phone-1',
      type: 'phone',
      label: 'iPhone Pro',
    });

    expect(updated.label).toBe('iPhone Pro');
    expect(engine.getAllDevices().length).toBe(2); // server + phone
  });

  it('should disconnect a device', () => {
    engine = createEngine('server');
    engine.registerDevice({
      deviceId: 'glasses-1',
      type: 'glasses',
      label: 'Glasses',
    });

    expect(engine.disconnectDevice('glasses-1')).toBe(true);
    
    const device = engine.getDevice('glasses-1');
    expect(device?.connected).toBe(false);
    expect(device?.syncStatus).toBe('offline');
  });

  it('should return false for disconnecting unknown device', () => {
    engine = createEngine('server');
    expect(engine.disconnectDevice('unknown')).toBe(false);
  });

  it('should remove a device', () => {
    engine = createEngine('server');
    engine.registerDevice({
      deviceId: 'phone-1',
      type: 'phone',
      label: 'Phone',
    });

    expect(engine.removeDevice('phone-1')).toBe(true);
    expect(engine.getDevice('phone-1')).toBeUndefined();
  });

  it('should not remove self', () => {
    engine = createEngine('server');
    expect(engine.removeDevice('server')).toBe(false);
  });

  it('should return false for removing non-existent device', () => {
    engine = createEngine('server');
    expect(engine.removeDevice('nope')).toBe(false);
  });

  it('should get connected devices only', () => {
    engine = createEngine('server');
    engine.registerDevice({ deviceId: 'a', type: 'phone', label: 'A' });
    engine.registerDevice({ deviceId: 'b', type: 'glasses', label: 'B' });
    engine.disconnectDevice('b');

    const connected = engine.getConnectedDevices();
    expect(connected.length).toBe(2); // server + a
    expect(connected.find((d) => d.deviceId === 'b')).toBeUndefined();
  });

  it('should infer capabilities by device type', () => {
    engine = createEngine('server');
    
    const glasses = engine.registerDevice({
      deviceId: 'g',
      type: 'glasses',
      label: 'Glasses',
    });
    expect(glasses.capabilities).toContain('camera');
    expect(glasses.capabilities).toContain('microphone');

    const phone = engine.registerDevice({
      deviceId: 'p',
      type: 'phone',
      label: 'Phone',
    });
    expect(phone.capabilities).toContain('gps');
    expect(phone.capabilities).toContain('notification');
  });

  it('should emit device events', () => {
    engine = createEngine('server');
    const connectedHandler = vi.fn();
    const disconnectedHandler = vi.fn();

    engine.on('device:connected', connectedHandler);
    engine.on('device:disconnected', disconnectedHandler);

    engine.registerDevice({ deviceId: 'a', type: 'phone', label: 'A' });
    expect(connectedHandler).toHaveBeenCalledTimes(1);

    engine.disconnectDevice('a');
    expect(disconnectedHandler).toHaveBeenCalledTimes(1);
  });
});

// ─── State Operations Tests ──────────────────────────────────────────────────

describe('DeviceSyncEngine — State Operations', () => {
  let engine: DeviceSyncEngine;

  afterEach(() => {
    engine.destroy();
  });

  it('should set and get values', () => {
    engine = createEngine('server');
    engine.set('settings', 'theme', 'dark');

    expect(engine.get('settings', 'theme')).toBe('dark');
  });

  it('should return undefined for non-existent keys', () => {
    engine = createEngine('server');
    expect(engine.get('settings', 'nope')).toBeUndefined();
    expect(engine.get('nonexistent', 'key')).toBeUndefined();
  });

  it('should update existing values', () => {
    engine = createEngine('server');
    engine.set('settings', 'theme', 'light');
    engine.set('settings', 'theme', 'dark');

    expect(engine.get('settings', 'theme')).toBe('dark');
  });

  it('should handle complex values', () => {
    engine = createEngine('server');
    const data = { name: 'Test', items: [1, 2, 3], nested: { a: true } };
    engine.set('inventory', 'session-1', data);

    expect(engine.get('inventory', 'session-1')).toEqual(data);
  });

  it('should delete values', () => {
    engine = createEngine('server');
    engine.set('settings', 'theme', 'dark');
    const op = engine.delete('settings', 'theme');

    expect(op).not.toBeNull();
    expect(engine.get('settings', 'theme')).toBeUndefined();
  });

  it('should return null when deleting non-existent key', () => {
    engine = createEngine('server');
    expect(engine.delete('settings', 'nope')).toBeNull();
  });

  it('should list keys in a namespace', () => {
    engine = createEngine('server');
    engine.set('contacts', 'alice', { name: 'Alice' });
    engine.set('contacts', 'bob', { name: 'Bob' });
    engine.set('settings', 'theme', 'dark');

    const keys = engine.keys('contacts');
    expect(keys).toContain('alice');
    expect(keys).toContain('bob');
    expect(keys).not.toContain('theme');
  });

  it('should return empty array for non-existent namespace keys', () => {
    engine = createEngine('server');
    expect(engine.keys('nothing')).toEqual([]);
  });

  it('should return entries for a namespace', () => {
    engine = createEngine('server');
    engine.set('settings', 'theme', 'dark');
    engine.set('settings', 'lang', 'en');

    const entries = engine.entries('settings');
    expect(entries.length).toBe(2);
    expect(entries.find((e) => e.key === 'theme')?.value).toBe('dark');
  });

  it('should check if key exists', () => {
    engine = createEngine('server');
    engine.set('settings', 'theme', 'dark');

    expect(engine.has('settings', 'theme')).toBe(true);
    expect(engine.has('settings', 'nope')).toBe(false);
    expect(engine.has('nothing', 'key')).toBe(false);
  });

  it('should list namespaces', () => {
    engine = createEngine('server');
    engine.set('settings', 'theme', 'dark');
    engine.set('contacts', 'alice', {});

    expect(engine.getNamespaces()).toContain('settings');
    expect(engine.getNamespaces()).toContain('contacts');
  });

  it('should create sync operations on set', () => {
    engine = createEngine('server');
    const op = engine.set('settings', 'theme', 'dark');

    expect(op.type).toBe('create');
    expect(op.namespace).toBe('settings');
    expect(op.key).toBe('theme');
    expect(op.data).toBe('dark');
    expect(op.sourceDeviceId).toBe('server');
  });

  it('should create update operations on overwrite', () => {
    engine = createEngine('server');
    engine.set('settings', 'theme', 'light');
    const op = engine.set('settings', 'theme', 'dark');

    expect(op.type).toBe('update');
  });

  it('should increment vector clock on each operation', () => {
    engine = createEngine('server');
    const op1 = engine.set('a', 'k1', 'v1');
    const op2 = engine.set('a', 'k2', 'v2');

    expect(op2.vectorClock['server']).toBeGreaterThan(op1.vectorClock['server']);
  });

  it('should enforce namespace filter', () => {
    engine = createEngine('server', { namespaces: ['allowed'] });

    engine.set('allowed', 'key', 'value');
    expect(engine.get('allowed', 'key')).toBe('value');

    expect(() => engine.set('blocked', 'key', 'value')).toThrow('not in the sync list');
  });

  it('should emit state:changed events', () => {
    engine = createEngine('server');
    const handler = vi.fn();
    engine.on('state:changed', handler);

    engine.set('settings', 'theme', 'dark');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'settings', key: 'theme', value: 'dark' })
    );
  });

  it('should emit state:deleted events', () => {
    engine = createEngine('server');
    const handler = vi.fn();
    engine.on('state:deleted', handler);

    engine.set('settings', 'theme', 'dark');
    engine.delete('settings', 'theme');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'settings', key: 'theme' })
    );
  });
});

// ─── Command Tests ───────────────────────────────────────────────────────────

describe('DeviceSyncEngine — Commands', () => {
  let engine: DeviceSyncEngine;

  afterEach(() => {
    engine.destroy();
  });

  it('should send a command', () => {
    engine = createEngine('server');
    const op = engine.sendCommand('start-scan', { mode: 'inventory' });

    expect(op.type).toBe('command');
    expect(op.key).toBe('start-scan');
    expect(op.data).toEqual({ mode: 'inventory' });
  });

  it('should send targeted commands', () => {
    engine = createEngine('server');
    const op = engine.sendCommand('vibrate', {}, ['glasses-1']);

    expect(op.targetDevices).toEqual(['glasses-1']);
  });

  it('should emit command:sent event', () => {
    engine = createEngine('server');
    const handler = vi.fn();
    engine.on('command:sent', handler);

    engine.sendCommand('test', { data: true });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'test', data: { data: true } })
    );
  });

  it('should receive remote commands', () => {
    engine = createEngine('server');
    const handler = vi.fn();
    engine.on('command:received', handler);

    engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'glasses-1',
      type: 'command',
      namespace: 'commands',
      key: 'snap-photo',
      data: { facing: 'front' },
      timestamp: Date.now(),
      vectorClock: { 'glasses-1': 1 },
      applied: false,
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'snap-photo',
        data: { facing: 'front' },
        from: 'glasses-1',
      })
    );
  });
});

// ─── Remote Sync Tests ───────────────────────────────────────────────────────

describe('DeviceSyncEngine — Remote Sync', () => {
  let engine: DeviceSyncEngine;

  afterEach(() => {
    engine.destroy();
  });

  it('should apply remote create operation', () => {
    engine = createEngine('server');

    const result = engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'create',
      namespace: 'settings',
      key: 'theme',
      data: 'dark',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    expect(result.applied).toBe(true);
    expect(engine.get('settings', 'theme')).toBe('dark');
  });

  it('should apply remote update operation', () => {
    engine = createEngine('server');
    engine.set('settings', 'theme', 'light');

    const result = engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'update',
      namespace: 'settings',
      key: 'theme',
      data: 'dark',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    expect(result.applied).toBe(true);
    expect(engine.get('settings', 'theme')).toBe('dark');
  });

  it('should apply remote delete operation', () => {
    engine = createEngine('server');
    engine.set('settings', 'theme', 'dark');

    const result = engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'delete',
      namespace: 'settings',
      key: 'theme',
      data: null,
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    expect(result.applied).toBe(true);
    expect(engine.get('settings', 'theme')).toBeUndefined();
  });

  it('should ignore operations from self', () => {
    engine = createEngine('server');

    const result = engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'server', // Same as engine
      type: 'create',
      namespace: 'settings',
      key: 'test',
      data: 'value',
      timestamp: Date.now(),
      vectorClock: { server: 1 },
      applied: false,
    });

    expect(result.applied).toBe(false);
  });

  it('should respect namespace filter for remote operations', () => {
    engine = createEngine('server', { namespaces: ['allowed'] });

    const result = engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'create',
      namespace: 'blocked',
      key: 'test',
      data: 'value',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    expect(result.applied).toBe(false);
  });

  it('should update device sync status', () => {
    engine = createEngine('server');
    engine.registerDevice({ deviceId: 'phone-1', type: 'phone', label: 'Phone' });

    engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'create',
      namespace: 'test',
      key: 'k',
      data: 'v',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    const device = engine.getDevice('phone-1');
    expect(device?.lastSync).not.toBeNull();
    expect(device?.syncStatus).toBe('synced');
  });

  it('should merge vector clocks', () => {
    engine = createEngine('server');

    engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'create',
      namespace: 'test',
      key: 'k',
      data: 'v',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 5, server: 2 },
      applied: false,
    });

    // After merge, our clock should have the max values
    const snapshot = engine.getStateSnapshot();
    expect(snapshot.vectorClock['phone-1']).toBe(5);
  });

  it('should emit sync:applied event', () => {
    engine = createEngine('server');
    const handler = vi.fn();
    engine.on('sync:applied', handler);

    engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'create',
      namespace: 'test',
      key: 'k',
      data: 'v',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ─── Conflict Resolution Tests ───────────────────────────────────────────────

describe('DeviceSyncEngine — Conflict Resolution', () => {
  let engine: DeviceSyncEngine;

  afterEach(() => {
    engine.destroy();
  });

  it('should detect concurrent updates as conflicts', () => {
    engine = createEngine('server', { conflictStrategy: 'manual' });

    // Set value locally (server clock=1)
    engine.set('settings', 'theme', 'dark');

    // Apply concurrent remote update (phone clock=1, no knowledge of server)
    const result = engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'update',
      namespace: 'settings',
      key: 'theme',
      data: 'light',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    expect(result.conflict).toBeDefined();
    expect(result.conflict?.resolution).toBe('pending');
  });

  it('should resolve conflicts with last-write-wins', () => {
    engine = createEngine('server', { conflictStrategy: 'last-write-wins' });

    engine.set('settings', 'theme', 'dark');

    const result = engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'update',
      namespace: 'settings',
      key: 'theme',
      data: 'light',
      timestamp: Date.now() + 1000, // newer timestamp
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    expect(result.applied).toBe(true);
    expect(engine.get('settings', 'theme')).toBe('light');
  });

  it('should resolve conflicts with server-wins', () => {
    engine = createEngine('server', { conflictStrategy: 'server-wins' });

    engine.set('settings', 'theme', 'dark');

    engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'update',
      namespace: 'settings',
      key: 'theme',
      data: 'light',
      timestamp: Date.now() + 1000,
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    // Server value should be preserved
    expect(engine.get('settings', 'theme')).toBe('dark');
  });

  it('should resolve conflicts with client-wins', () => {
    engine = createEngine('server', { conflictStrategy: 'client-wins' });

    engine.set('settings', 'theme', 'dark');

    engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'update',
      namespace: 'settings',
      key: 'theme',
      data: 'light',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    expect(engine.get('settings', 'theme')).toBe('light');
  });

  it('should allow manual conflict resolution', () => {
    engine = createEngine('server', { conflictStrategy: 'manual' });

    engine.set('settings', 'theme', 'dark');

    const result = engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'update',
      namespace: 'settings',
      key: 'theme',
      data: 'light',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    expect(result.applied).toBe(false);
    
    const conflicts = engine.getConflicts();
    expect(conflicts.length).toBe(1);

    engine.resolveConflict(conflicts[0].id, 'blue');
    expect(engine.get('settings', 'theme')).toBe('blue');
    expect(engine.getConflicts().length).toBe(0);
  });

  it('should return false for invalid conflict resolution', () => {
    engine = createEngine('server');
    expect(engine.resolveConflict('nope', 'value')).toBe(false);
  });

  it('should emit sync:conflict event', () => {
    engine = createEngine('server', { conflictStrategy: 'manual' });
    const handler = vi.fn();
    engine.on('sync:conflict', handler);

    engine.set('settings', 'theme', 'dark');
    engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'update',
      namespace: 'settings',
      key: 'theme',
      data: 'light',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ─── Snapshot Tests ──────────────────────────────────────────────────────────

describe('DeviceSyncEngine — Snapshots', () => {
  let engine: DeviceSyncEngine;

  afterEach(() => {
    engine.destroy();
  });

  it('should create state snapshot', () => {
    engine = createEngine('server');
    engine.set('settings', 'theme', 'dark');
    engine.set('contacts', 'alice', { name: 'Alice' });

    const snapshot = engine.getStateSnapshot();
    expect(snapshot.state['settings']['theme'].value).toBe('dark');
    expect(snapshot.state['contacts']['alice'].value).toEqual({ name: 'Alice' });
    expect(snapshot.vectorClock['server']).toBeGreaterThan(0);
  });

  it('should apply state snapshot', () => {
    engine = createEngine('server');

    engine.applyStateSnapshot({
      state: {
        settings: {
          theme: {
            value: 'dark',
            version: 1,
            updatedBy: 'phone-1',
            updatedAt: Date.now(),
            vectorClock: { 'phone-1': 1 },
          },
        },
      },
      vectorClock: { 'phone-1': 1 },
    });

    expect(engine.get('settings', 'theme')).toBe('dark');
  });

  it('should merge snapshot with existing state (newer wins)', () => {
    engine = createEngine('server');
    
    const oldTime = Date.now() - 10000;
    const newTime = Date.now();

    engine.applyStateSnapshot({
      state: {
        settings: {
          theme: {
            value: 'old-value',
            version: 1,
            updatedBy: 'phone-1',
            updatedAt: oldTime,
            vectorClock: { 'phone-1': 1 },
          },
        },
      },
      vectorClock: { 'phone-1': 1 },
    });

    engine.applyStateSnapshot({
      state: {
        settings: {
          theme: {
            value: 'new-value',
            version: 2,
            updatedBy: 'phone-1',
            updatedAt: newTime,
            vectorClock: { 'phone-1': 2 },
          },
        },
      },
      vectorClock: { 'phone-1': 2 },
    });

    expect(engine.get('settings', 'theme')).toBe('new-value');
  });

  it('should emit snapshot-applied event', () => {
    engine = createEngine('server');
    const handler = vi.fn();
    engine.on('sync:snapshot-applied', handler);

    engine.applyStateSnapshot({
      state: { settings: {} },
      vectorClock: {},
    });

    expect(handler).toHaveBeenCalledWith({ namespaces: ['settings'] });
  });
});

// ─── Buffer & History Tests ──────────────────────────────────────────────────

describe('DeviceSyncEngine — Buffer & History', () => {
  let engine: DeviceSyncEngine;

  afterEach(() => {
    engine.destroy();
  });

  it('should buffer operations for sync', () => {
    engine = createEngine('server');
    engine.set('a', 'k1', 'v1');
    engine.set('a', 'k2', 'v2');

    const buffered = engine.getBufferedOperations();
    expect(buffered.length).toBe(2);
  });

  it('should clear buffer after getting operations', () => {
    engine = createEngine('server');
    engine.set('a', 'k', 'v');

    engine.getBufferedOperations();
    const empty = engine.getBufferedOperations();
    expect(empty.length).toBe(0);
  });

  it('should limit buffer size', () => {
    engine = createEngine('server', { maxBufferSize: 3 });

    for (let i = 0; i < 5; i++) {
      engine.set('a', `k${i}`, `v${i}`);
    }

    const buffered = engine.getBufferedOperations();
    expect(buffered.length).toBeLessThanOrEqual(3);
  });

  it('should maintain operation history', () => {
    engine = createEngine('server');
    engine.set('a', 'k1', 'v1');
    engine.set('b', 'k2', 'v2');

    const history = engine.getHistory();
    expect(history.length).toBe(2);
  });

  it('should filter history by namespace', () => {
    engine = createEngine('server');
    engine.set('settings', 'k1', 'v1');
    engine.set('contacts', 'k2', 'v2');

    const history = engine.getHistory({ namespace: 'settings' });
    expect(history.length).toBe(1);
    expect(history[0].namespace).toBe('settings');
  });

  it('should limit history size', () => {
    engine = createEngine('server', { maxHistory: 5 });

    for (let i = 0; i < 10; i++) {
      engine.set('a', `k${i}`, `v${i}`);
    }

    const history = engine.getHistory();
    expect(history.length).toBeLessThanOrEqual(5);
  });

  it('should filter history by limit', () => {
    engine = createEngine('server');
    for (let i = 0; i < 10; i++) {
      engine.set('a', `k${i}`, `v${i}`);
    }

    const history = engine.getHistory({ limit: 3 });
    expect(history.length).toBe(3);
  });

  it('should emit sync:ready after debounce', async () => {
    engine = createEngine('server', { syncDebounceMs: 50 });
    const handler = vi.fn();
    engine.on('sync:ready', handler);

    engine.set('a', 'k1', 'v1');
    engine.set('a', 'k2', 'v2');

    // Not yet — still debouncing
    expect(handler).not.toHaveBeenCalled();

    await sleep(100);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ operations: 2 }));
  });
});

// ─── Metrics Tests ───────────────────────────────────────────────────────────

describe('DeviceSyncEngine — Metrics', () => {
  let engine: DeviceSyncEngine;

  afterEach(() => {
    engine.destroy();
  });

  it('should track total operations', () => {
    engine = createEngine('server');
    engine.set('a', 'k1', 'v1');
    engine.set('a', 'k2', 'v2');

    engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'create',
      namespace: 'a',
      key: 'k3',
      data: 'v3',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    const metrics = engine.getMetrics();
    expect(metrics.totalOpsOut).toBe(2);
    expect(metrics.totalOpsIn).toBe(1);
  });

  it('should track connected devices', () => {
    engine = createEngine('server');
    engine.registerDevice({ deviceId: 'a', type: 'phone', label: 'A' });
    engine.registerDevice({ deviceId: 'b', type: 'glasses', label: 'B' });

    expect(engine.getMetrics().connectedDevices).toBe(3); // server + a + b
  });

  it('should track buffered operations', () => {
    engine = createEngine('server');
    engine.set('a', 'k1', 'v1');

    expect(engine.getMetrics().bufferedOps).toBe(1);

    engine.getBufferedOperations();
    expect(engine.getMetrics().bufferedOps).toBe(0);
  });

  it('should track conflicts', () => {
    engine = createEngine('server', { conflictStrategy: 'manual' });
    engine.set('a', 'k', 'v1');

    engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'update',
      namespace: 'a',
      key: 'k',
      data: 'v2',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    const metrics = engine.getMetrics();
    expect(metrics.totalConflicts).toBe(1);
    expect(metrics.pendingConflicts).toBe(1);
  });
});

// ─── Voice Summary Tests ─────────────────────────────────────────────────────

describe('DeviceSyncEngine — Voice Summary', () => {
  let engine: DeviceSyncEngine;

  afterEach(() => {
    engine.destroy();
  });

  it('should generate single device summary', () => {
    engine = createEngine('server');
    const summary = engine.getVoiceSummary();
    expect(summary).toContain('Only this device');
  });

  it('should list connected devices', () => {
    engine = createEngine('server');
    engine.registerDevice({ deviceId: 'glasses', type: 'glasses', label: 'Ray-Bans' });

    const summary = engine.getVoiceSummary();
    expect(summary).toContain('2 devices connected');
    expect(summary).toContain('Ray-Bans');
  });

  it('should mention pending conflicts', () => {
    engine = createEngine('server', { conflictStrategy: 'manual' });
    engine.set('a', 'k', 'v1');

    engine.applyRemoteOperation({
      id: 'op-1',
      sourceDeviceId: 'phone-1',
      type: 'update',
      namespace: 'a',
      key: 'k',
      data: 'v2',
      timestamp: Date.now(),
      vectorClock: { 'phone-1': 1 },
      applied: false,
    });

    const summary = engine.getVoiceSummary();
    expect(summary).toContain('conflict');
  });

  it('should say all synced when no issues', () => {
    engine = createEngine('server');
    engine.getBufferedOperations(); // drain buffer

    const summary = engine.getVoiceSummary();
    expect(summary).toContain('All synced');
  });
});

// ─── Destroy Tests ───────────────────────────────────────────────────────────

describe('DeviceSyncEngine — Destroy', () => {
  it('should clean up on destroy', () => {
    const engine = createEngine('server');
    engine.set('a', 'k', 'v');
    engine.registerDevice({ deviceId: 'phone', type: 'phone', label: 'Phone' });

    engine.destroy();

    expect(engine.getAllDevices()).toEqual([]);
    expect(engine.getNamespaces()).toEqual([]);
    expect(engine.getConflicts()).toEqual([]);
  });
});
