/**
 * Multi-Device Sync Engine
 * 
 * Synchronizes state across glasses, phone, dashboard, and any
 * other connected clients. Handles conflict resolution, offline
 * buffering, and real-time state propagation.
 * 
 * 🌙 Night Shift Agent — 2026-03-04
 */

import { EventEmitter } from 'events';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DeviceType = 'glasses' | 'phone' | 'dashboard' | 'api' | 'companion' | 'unknown';
export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'conflict' | 'error';
export type ConflictStrategy = 'last-write-wins' | 'server-wins' | 'client-wins' | 'manual';

export interface DeviceInfo {
  /** Unique device ID */
  deviceId: string;
  /** Device type */
  type: DeviceType;
  /** Human-readable label */
  label: string;
  /** When the device last connected */
  lastSeen: Date;
  /** Whether the device is currently connected */
  connected: boolean;
  /** Device capabilities */
  capabilities: DeviceCapability[];
  /** Current sync status */
  syncStatus: SyncStatus;
  /** Pending operations count */
  pendingOps: number;
  /** Last successful sync timestamp */
  lastSync: Date | null;
  /** Metadata */
  metadata: Record<string, any>;
}

export type DeviceCapability =
  | 'camera'
  | 'microphone'
  | 'speaker'
  | 'display'
  | 'gps'
  | 'storage'
  | 'compute'
  | 'notification';

export interface SyncOperation {
  /** Operation ID */
  id: string;
  /** Source device */
  sourceDeviceId: string;
  /** Operation type */
  type: 'create' | 'update' | 'delete' | 'command';
  /** Resource namespace (e.g., 'inventory', 'contacts', 'settings') */
  namespace: string;
  /** Resource key */
  key: string;
  /** Operation data */
  data: any;
  /** Timestamp of the operation */
  timestamp: number;
  /** Vector clock for causal ordering */
  vectorClock: Record<string, number>;
  /** Whether this operation has been applied */
  applied: boolean;
  /** Target devices (empty = broadcast to all) */
  targetDevices?: string[];
}

export interface SyncConflict {
  /** Conflict ID */
  id: string;
  /** The conflicting operations */
  operations: SyncOperation[];
  /** Namespace */
  namespace: string;
  /** Resource key */
  key: string;
  /** How the conflict was or should be resolved */
  resolution: ConflictStrategy | 'pending';
  /** Resolved value (if resolved) */
  resolvedValue?: any;
  /** When the conflict was detected */
  detectedAt: Date;
  /** When the conflict was resolved */
  resolvedAt: Date | null;
}

export interface SyncState {
  /** Current state for all namespaces */
  store: Map<string, Map<string, SyncEntry>>;
  /** Vector clock for this node */
  vectorClock: Record<string, number>;
}

export interface SyncEntry {
  value: any;
  version: number;
  updatedBy: string;
  updatedAt: number;
  vectorClock: Record<string, number>;
}

export interface SyncEngineConfig {
  /** This device's ID */
  deviceId: string;
  /** This device's type */
  deviceType: DeviceType;
  /** Conflict resolution strategy */
  conflictStrategy?: ConflictStrategy;
  /** Max offline buffer size */
  maxBufferSize?: number;
  /** Sync debounce interval in ms */
  syncDebounceMs?: number;
  /** Enable compression for sync payloads */
  compression?: boolean;
  /** Max operation history to retain */
  maxHistory?: number;
  /** Namespaces to sync (empty = all) */
  namespaces?: string[];
}

export interface SyncMetrics {
  totalOpsIn: number;
  totalOpsOut: number;
  totalConflicts: number;
  resolvedConflicts: number;
  pendingConflicts: number;
  connectedDevices: number;
  bufferedOps: number;
  lastSyncTimestamp: Date | null;
  opsPerMinute: number;
  averageSyncLatencyMs: number;
}

// ─── Sync Engine ─────────────────────────────────────────────────────────────

export class DeviceSyncEngine extends EventEmitter {
  private config: Required<SyncEngineConfig>;
  private devices: Map<string, DeviceInfo> = new Map();
  private state: SyncState;
  private operationBuffer: SyncOperation[] = [];
  private operationHistory: SyncOperation[] = [];
  private conflicts: SyncConflict[] = [];
  private conflictIdCounter = 0;
  private opIdCounter = 0;
  private syncLatencies: number[] = [];
  private totalOpsIn = 0;
  private totalOpsOut = 0;
  private opsTimestamps: number[] = []; // for ops/min calculation
  private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: SyncEngineConfig) {
    super();
    this.config = {
      deviceId: config.deviceId,
      deviceType: config.deviceType,
      conflictStrategy: config.conflictStrategy ?? 'last-write-wins',
      maxBufferSize: config.maxBufferSize ?? 1000,
      syncDebounceMs: config.syncDebounceMs ?? 100,
      compression: config.compression ?? false,
      maxHistory: config.maxHistory ?? 500,
      namespaces: config.namespaces ?? [],
    };

    this.state = {
      store: new Map(),
      vectorClock: { [this.config.deviceId]: 0 },
    };

    // Register self as a device
    this.registerDevice({
      deviceId: this.config.deviceId,
      type: this.config.deviceType,
      label: `Local (${this.config.deviceType})`,
      capabilities: this.inferCapabilities(this.config.deviceType),
    });
  }

  // ─── Device Management ─────────────────────────────────────────────────

  /**
   * Register a connected device
   */
  registerDevice(info: {
    deviceId: string;
    type: DeviceType;
    label: string;
    capabilities?: DeviceCapability[];
    metadata?: Record<string, any>;
  }): DeviceInfo {
    const existing = this.devices.get(info.deviceId);
    if (existing) {
      // Update existing device
      existing.connected = true;
      existing.lastSeen = new Date();
      existing.type = info.type;
      existing.label = info.label;
      if (info.capabilities) existing.capabilities = info.capabilities;
      if (info.metadata) existing.metadata = { ...existing.metadata, ...info.metadata };
      this.emit('device:reconnected', existing);
      return { ...existing };
    }

    const device: DeviceInfo = {
      deviceId: info.deviceId,
      type: info.type,
      label: info.label,
      lastSeen: new Date(),
      connected: true,
      capabilities: info.capabilities ?? this.inferCapabilities(info.type),
      syncStatus: 'synced',
      pendingOps: 0,
      lastSync: null,
      metadata: info.metadata ?? {},
    };

    this.devices.set(info.deviceId, device);

    // Initialize vector clock for new device
    if (!this.state.vectorClock[info.deviceId]) {
      this.state.vectorClock[info.deviceId] = 0;
    }

    this.emit('device:connected', device);
    return { ...device };
  }

  /**
   * Mark a device as disconnected
   */
  disconnectDevice(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    device.connected = false;
    device.syncStatus = 'offline';
    this.emit('device:disconnected', { deviceId, label: device.label });
    return true;
  }

  /**
   * Remove a device entirely
   */
  removeDevice(deviceId: string): boolean {
    if (deviceId === this.config.deviceId) return false; // Can't remove self
    const existed = this.devices.delete(deviceId);
    if (existed) {
      this.emit('device:removed', { deviceId });
    }
    return existed;
  }

  /**
   * Get info about a specific device
   */
  getDevice(deviceId: string): DeviceInfo | undefined {
    const device = this.devices.get(deviceId);
    return device ? { ...device } : undefined;
  }

  /**
   * Get all connected devices
   */
  getConnectedDevices(): DeviceInfo[] {
    return Array.from(this.devices.values())
      .filter((d) => d.connected)
      .map((d) => ({ ...d }));
  }

  /**
   * Get all registered devices
   */
  getAllDevices(): DeviceInfo[] {
    return Array.from(this.devices.values()).map((d) => ({ ...d }));
  }

  // ─── State Operations ──────────────────────────────────────────────────

  /**
   * Set a value in the sync store (creates a sync operation)
   */
  set(namespace: string, key: string, value: any): SyncOperation {
    // Check namespace filter
    if (this.config.namespaces.length > 0 && !this.config.namespaces.includes(namespace)) {
      throw new Error(`Namespace "${namespace}" is not in the sync list`);
    }

    // Increment vector clock
    this.state.vectorClock[this.config.deviceId] =
      (this.state.vectorClock[this.config.deviceId] || 0) + 1;

    // Get or create namespace store
    if (!this.state.store.has(namespace)) {
      this.state.store.set(namespace, new Map());
    }
    const nsStore = this.state.store.get(namespace)!;

    const existing = nsStore.get(key);
    const isCreate = !existing;

    // Create sync entry
    const entry: SyncEntry = {
      value,
      version: existing ? existing.version + 1 : 1,
      updatedBy: this.config.deviceId,
      updatedAt: Date.now(),
      vectorClock: { ...this.state.vectorClock },
    };

    nsStore.set(key, entry);

    // Create sync operation
    const op: SyncOperation = {
      id: `op-${++this.opIdCounter}`,
      sourceDeviceId: this.config.deviceId,
      type: isCreate ? 'create' : 'update',
      namespace,
      key,
      data: value,
      timestamp: Date.now(),
      vectorClock: { ...this.state.vectorClock },
      applied: true,
    };

    this.addToHistory(op);
    this.totalOpsOut++;
    this.recordOpTimestamp();

    // Buffer for sync
    this.bufferOperation(op);

    this.emit('state:changed', { namespace, key, value, operation: op });
    return op;
  }

  /**
   * Get a value from the sync store
   */
  get(namespace: string, key: string): any | undefined {
    const nsStore = this.state.store.get(namespace);
    if (!nsStore) return undefined;
    const entry = nsStore.get(key);
    return entry ? entry.value : undefined;
  }

  /**
   * Delete a value from the sync store
   */
  delete(namespace: string, key: string): SyncOperation | null {
    const nsStore = this.state.store.get(namespace);
    if (!nsStore || !nsStore.has(key)) return null;

    // Increment vector clock
    this.state.vectorClock[this.config.deviceId] =
      (this.state.vectorClock[this.config.deviceId] || 0) + 1;

    nsStore.delete(key);

    const op: SyncOperation = {
      id: `op-${++this.opIdCounter}`,
      sourceDeviceId: this.config.deviceId,
      type: 'delete',
      namespace,
      key,
      data: null,
      timestamp: Date.now(),
      vectorClock: { ...this.state.vectorClock },
      applied: true,
    };

    this.addToHistory(op);
    this.totalOpsOut++;
    this.recordOpTimestamp();
    this.bufferOperation(op);

    this.emit('state:deleted', { namespace, key, operation: op });
    return op;
  }

  /**
   * Get all keys in a namespace
   */
  keys(namespace: string): string[] {
    const nsStore = this.state.store.get(namespace);
    return nsStore ? Array.from(nsStore.keys()) : [];
  }

  /**
   * Get all entries in a namespace
   */
  entries(namespace: string): Array<{ key: string; value: any; version: number }> {
    const nsStore = this.state.store.get(namespace);
    if (!nsStore) return [];
    return Array.from(nsStore.entries()).map(([key, entry]) => ({
      key,
      value: entry.value,
      version: entry.version,
    }));
  }

  /**
   * Check if a key exists
   */
  has(namespace: string, key: string): boolean {
    const nsStore = this.state.store.get(namespace);
    return nsStore ? nsStore.has(key) : false;
  }

  /**
   * Get namespaces
   */
  getNamespaces(): string[] {
    return Array.from(this.state.store.keys());
  }

  /**
   * Broadcast a command to other devices (not stored in state)
   */
  sendCommand(
    command: string,
    data: any,
    targetDevices?: string[]
  ): SyncOperation {
    this.state.vectorClock[this.config.deviceId] =
      (this.state.vectorClock[this.config.deviceId] || 0) + 1;

    const op: SyncOperation = {
      id: `op-${++this.opIdCounter}`,
      sourceDeviceId: this.config.deviceId,
      type: 'command',
      namespace: 'commands',
      key: command,
      data,
      timestamp: Date.now(),
      vectorClock: { ...this.state.vectorClock },
      applied: true,
      targetDevices,
    };

    this.addToHistory(op);
    this.totalOpsOut++;
    this.recordOpTimestamp();
    this.bufferOperation(op);

    this.emit('command:sent', { command, data, targetDevices, operation: op });
    return op;
  }

  // ─── Sync Operations ──────────────────────────────────────────────────

  /**
   * Apply an incoming operation from another device
   */
  applyRemoteOperation(op: SyncOperation): { applied: boolean; conflict?: SyncConflict } {
    this.totalOpsIn++;
    this.recordOpTimestamp();

    // Ignore our own operations
    if (op.sourceDeviceId === this.config.deviceId) {
      return { applied: false };
    }

    // Handle commands (don't store, just emit)
    if (op.type === 'command') {
      this.emit('command:received', { command: op.key, data: op.data, from: op.sourceDeviceId });
      return { applied: true };
    }

    // Namespace filter
    if (this.config.namespaces.length > 0 && !this.config.namespaces.includes(op.namespace)) {
      return { applied: false };
    }

    // Check for conflicts
    const nsStore = this.state.store.get(op.namespace);
    const existing = nsStore?.get(op.key);

    if (existing && this.isConflict(existing, op)) {
      return this.handleConflict(existing, op);
    }

    // Apply the operation
    this.applyOperation(op);

    // Update device sync status
    const device = this.devices.get(op.sourceDeviceId);
    if (device) {
      device.lastSync = new Date();
      device.syncStatus = 'synced';
    }

    // Merge vector clock
    this.mergeVectorClock(op.vectorClock);

    this.emit('sync:applied', { operation: op });
    return { applied: true };
  }

  /**
   * Get the full state snapshot for initial sync
   */
  getStateSnapshot(): {
    state: Record<string, Record<string, SyncEntry>>;
    vectorClock: Record<string, number>;
    timestamp: number;
  } {
    const stateObj: Record<string, Record<string, SyncEntry>> = {};

    for (const [ns, nsStore] of this.state.store) {
      stateObj[ns] = {};
      for (const [key, entry] of nsStore) {
        stateObj[ns][key] = { ...entry };
      }
    }

    return {
      state: stateObj,
      vectorClock: { ...this.state.vectorClock },
      timestamp: Date.now(),
    };
  }

  /**
   * Apply a full state snapshot (for initial sync / reconnection)
   */
  applyStateSnapshot(snapshot: {
    state: Record<string, Record<string, SyncEntry>>;
    vectorClock: Record<string, number>;
  }): void {
    for (const [ns, entries] of Object.entries(snapshot.state)) {
      if (!this.state.store.has(ns)) {
        this.state.store.set(ns, new Map());
      }
      const nsStore = this.state.store.get(ns)!;

      for (const [key, entry] of Object.entries(entries)) {
        const existing = nsStore.get(key);
        if (!existing || entry.updatedAt > existing.updatedAt) {
          nsStore.set(key, { ...entry });
        }
      }
    }

    this.mergeVectorClock(snapshot.vectorClock);
    this.emit('sync:snapshot-applied', { namespaces: Object.keys(snapshot.state) });
  }

  /**
   * Get buffered operations (for sending to remote devices)
   */
  getBufferedOperations(): SyncOperation[] {
    const ops = [...this.operationBuffer];
    this.operationBuffer = [];
    return ops;
  }

  /**
   * Get operation history
   */
  getHistory(options?: {
    namespace?: string;
    limit?: number;
    since?: number;
  }): SyncOperation[] {
    let history = [...this.operationHistory];

    if (options?.namespace) {
      history = history.filter((op) => op.namespace === options.namespace);
    }

    if (options?.since) {
      history = history.filter((op) => op.timestamp >= options.since!);
    }

    if (options?.limit) {
      history = history.slice(-options.limit);
    }

    return history;
  }

  // ─── Conflict Management ───────────────────────────────────────────────

  /**
   * Get all unresolved conflicts
   */
  getConflicts(): SyncConflict[] {
    return this.conflicts.filter((c) => c.resolution === 'pending').map((c) => ({ ...c }));
  }

  /**
   * Resolve a conflict manually
   */
  resolveConflict(conflictId: string, resolvedValue: any): boolean {
    const conflict = this.conflicts.find((c) => c.id === conflictId);
    if (!conflict || conflict.resolution !== 'pending') return false;

    conflict.resolution = 'manual';
    conflict.resolvedValue = resolvedValue;
    conflict.resolvedAt = new Date();

    // Apply the resolved value
    if (!this.state.store.has(conflict.namespace)) {
      this.state.store.set(conflict.namespace, new Map());
    }

    this.state.store.get(conflict.namespace)!.set(conflict.key, {
      value: resolvedValue,
      version: Math.max(...conflict.operations.map((op) => {
        const nsStore = this.state.store.get(op.namespace);
        const entry = nsStore?.get(op.key);
        return entry?.version ?? 0;
      })) + 1,
      updatedBy: this.config.deviceId,
      updatedAt: Date.now(),
      vectorClock: { ...this.state.vectorClock },
    });

    this.emit('conflict:resolved', conflict);
    return true;
  }

  // ─── Metrics ───────────────────────────────────────────────────────────

  /**
   * Get sync metrics
   */
  getMetrics(): SyncMetrics {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentOps = this.opsTimestamps.filter((t) => t > oneMinuteAgo);

    const avgLatency =
      this.syncLatencies.length > 0
        ? this.syncLatencies.reduce((a, b) => a + b, 0) / this.syncLatencies.length
        : 0;

    return {
      totalOpsIn: this.totalOpsIn,
      totalOpsOut: this.totalOpsOut,
      totalConflicts: this.conflicts.length,
      resolvedConflicts: this.conflicts.filter((c) => c.resolvedAt).length,
      pendingConflicts: this.conflicts.filter((c) => c.resolution === 'pending').length,
      connectedDevices: Array.from(this.devices.values()).filter((d) => d.connected).length,
      bufferedOps: this.operationBuffer.length,
      lastSyncTimestamp: this.getLastSyncTime(),
      opsPerMinute: recentOps.length,
      averageSyncLatencyMs: Math.round(avgLatency),
    };
  }

  /**
   * Generate voice-friendly sync status
   */
  getVoiceSummary(): string {
    const metrics = this.getMetrics();
    const connected = this.getConnectedDevices();
    const deviceNames = connected.map((d) => d.label).join(', ');

    const parts: string[] = [];

    if (connected.length === 1) {
      parts.push('Only this device is connected');
    } else {
      parts.push(`${connected.length} devices connected: ${deviceNames}`);
    }

    if (metrics.pendingConflicts > 0) {
      parts.push(`${metrics.pendingConflicts} sync conflict${metrics.pendingConflicts > 1 ? 's' : ''} need resolution`);
    }

    if (metrics.bufferedOps > 0) {
      parts.push(`${metrics.bufferedOps} operations waiting to sync`);
    }

    if (metrics.pendingConflicts === 0 && metrics.bufferedOps === 0) {
      parts.push('All synced');
    }

    return parts.join('. ') + '.';
  }

  /**
   * Destroy and clean up
   */
  destroy(): void {
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }
    this.devices.clear();
    this.state.store.clear();
    this.operationBuffer = [];
    this.operationHistory = [];
    this.conflicts = [];
    this.removeAllListeners();
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  /**
   * Check if an incoming operation conflicts with existing state
   */
  private isConflict(existing: SyncEntry, incoming: SyncOperation): boolean {
    if (incoming.type === 'delete') return false;

    // Concurrent operations = neither vector clock dominates the other
    const existingClock = existing.vectorClock;
    const incomingClock = incoming.vectorClock;

    let existingDominates = false;
    let incomingDominates = false;

    const allDevices = new Set([
      ...Object.keys(existingClock),
      ...Object.keys(incomingClock),
    ]);

    for (const device of allDevices) {
      const e = existingClock[device] || 0;
      const i = incomingClock[device] || 0;
      if (e > i) existingDominates = true;
      if (i > e) incomingDominates = true;
    }

    // Concurrent = neither fully dominates
    return existingDominates && incomingDominates;
  }

  /**
   * Handle a detected conflict
   */
  private handleConflict(
    existing: SyncEntry,
    incoming: SyncOperation
  ): { applied: boolean; conflict?: SyncConflict } {
    const conflict: SyncConflict = {
      id: `conflict-${++this.conflictIdCounter}`,
      operations: [
        {
          id: `existing-${existing.updatedAt}`,
          sourceDeviceId: existing.updatedBy,
          type: 'update',
          namespace: incoming.namespace,
          key: incoming.key,
          data: existing.value,
          timestamp: existing.updatedAt,
          vectorClock: { ...existing.vectorClock },
          applied: true,
        },
        { ...incoming },
      ],
      namespace: incoming.namespace,
      key: incoming.key,
      resolution: 'pending',
      detectedAt: new Date(),
      resolvedAt: null,
    };

    // Auto-resolve based on strategy
    switch (this.config.conflictStrategy) {
      case 'last-write-wins': {
        const winner =
          incoming.timestamp >= existing.updatedAt ? incoming : null;
        if (winner) {
          this.applyOperation(incoming);
          conflict.resolution = 'last-write-wins';
          conflict.resolvedValue = incoming.data;
          conflict.resolvedAt = new Date();
        }
        break;
      }

      case 'server-wins': {
        // Keep existing (server state)
        conflict.resolution = 'server-wins';
        conflict.resolvedValue = existing.value;
        conflict.resolvedAt = new Date();
        break;
      }

      case 'client-wins': {
        // Accept incoming
        this.applyOperation(incoming);
        conflict.resolution = 'client-wins';
        conflict.resolvedValue = incoming.data;
        conflict.resolvedAt = new Date();
        break;
      }

      case 'manual': {
        // Leave as pending for manual resolution
        break;
      }
    }

    this.conflicts.push(conflict);
    this.emit('sync:conflict', conflict);

    return {
      applied: conflict.resolution !== 'pending',
      conflict,
    };
  }

  /**
   * Apply an operation to the local state
   */
  private applyOperation(op: SyncOperation): void {
    if (op.type === 'delete') {
      const nsStore = this.state.store.get(op.namespace);
      if (nsStore) nsStore.delete(op.key);
      return;
    }

    if (!this.state.store.has(op.namespace)) {
      this.state.store.set(op.namespace, new Map());
    }
    const nsStore = this.state.store.get(op.namespace)!;

    const existing = nsStore.get(op.key);
    nsStore.set(op.key, {
      value: op.data,
      version: existing ? existing.version + 1 : 1,
      updatedBy: op.sourceDeviceId,
      updatedAt: op.timestamp,
      vectorClock: { ...op.vectorClock },
    });

    this.addToHistory(op);
  }

  /**
   * Merge an incoming vector clock with ours
   */
  private mergeVectorClock(incoming: Record<string, number>): void {
    for (const [device, clock] of Object.entries(incoming)) {
      this.state.vectorClock[device] = Math.max(
        this.state.vectorClock[device] || 0,
        clock
      );
    }
  }

  /**
   * Buffer an operation for syncing to other devices
   */
  private bufferOperation(op: SyncOperation): void {
    this.operationBuffer.push(op);

    // Trim buffer if too large
    if (this.operationBuffer.length > this.config.maxBufferSize) {
      this.operationBuffer = this.operationBuffer.slice(-this.config.maxBufferSize);
      this.emit('buffer:overflow', { dropped: 1 });
    }

    // Debounced sync notification
    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
    this.syncDebounceTimer = setTimeout(() => {
      this.emit('sync:ready', {
        operations: this.operationBuffer.length,
      });
    }, this.config.syncDebounceMs);
  }

  /**
   * Add operation to history
   */
  private addToHistory(op: SyncOperation): void {
    this.operationHistory.push(op);
    if (this.operationHistory.length > this.config.maxHistory) {
      this.operationHistory = this.operationHistory.slice(-this.config.maxHistory);
    }
  }

  /**
   * Record operation timestamp for ops/min calculation
   */
  private recordOpTimestamp(): void {
    const now = Date.now();
    this.opsTimestamps.push(now);
    // Keep only last 5 minutes
    const fiveMinAgo = now - 300000;
    this.opsTimestamps = this.opsTimestamps.filter((t) => t > fiveMinAgo);
  }

  /**
   * Get the most recent sync time across all devices
   */
  private getLastSyncTime(): Date | null {
    let latest: Date | null = null;
    for (const device of this.devices.values()) {
      if (device.lastSync && (!latest || device.lastSync > latest)) {
        latest = device.lastSync;
      }
    }
    return latest;
  }

  /**
   * Infer device capabilities from type
   */
  private inferCapabilities(type: DeviceType): DeviceCapability[] {
    switch (type) {
      case 'glasses':
        return ['camera', 'microphone', 'speaker', 'gps'];
      case 'phone':
        return ['camera', 'microphone', 'speaker', 'display', 'gps', 'storage', 'notification'];
      case 'dashboard':
        return ['display', 'storage', 'compute'];
      case 'companion':
        return ['display', 'storage', 'notification'];
      case 'api':
        return ['compute', 'storage'];
      default:
        return [];
    }
  }
}
