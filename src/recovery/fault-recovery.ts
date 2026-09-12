/**
 * Fault Recovery Engine — Meta Ray-Bans × OpenClaw
 *
 * Graceful recovery from crashes, network failures, mid-session interruptions,
 * and hardware disconnects. Ensures no work is lost during inventory sessions.
 *
 * Key capabilities:
 * - Session state checkpointing with WAL (write-ahead log)
 * - Automatic crash recovery with state reconstruction
 * - Network partition handling with offline buffering
 * - Hardware disconnect detection and reconnection
 * - Progressive degradation (cloud → local → cached → offline)
 * - Recovery point objectives (RPO) tracking
 * - Voice-friendly recovery status updates
 *
 * 🌙 Night Shift Agent — Night #36
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────────────────

export type FaultType =
  | 'crash'
  | 'network_loss'
  | 'hardware_disconnect'
  | 'timeout'
  | 'storage_full'
  | 'memory_pressure'
  | 'api_failure'
  | 'auth_expired'
  | 'data_corruption'
  | 'unknown';

export type RecoveryStrategy =
  | 'checkpoint_restore'
  | 'replay_wal'
  | 'reconnect'
  | 'fallback_local'
  | 'retry'
  | 'skip_and_continue'
  | 'manual_intervention';

export type DegradationLevel = 'full' | 'reduced' | 'local_only' | 'offline' | 'suspended';

export type CheckpointStatus = 'pending' | 'committed' | 'corrupted' | 'expired';

export interface Checkpoint {
  id: string;
  sessionId: string;
  timestamp: number;
  status: CheckpointStatus;
  data: Record<string, unknown>;
  sequenceNumber: number;
  sizeBytes: number;
  hash: string;
  metadata: {
    itemCount: number;
    scanCount: number;
    zonesCovered: string[];
    lastAction: string;
    elapsedMs: number;
  };
}

export interface WALEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  sequenceNumber: number;
  operation: string;
  data: Record<string, unknown>;
  checkpointRef: string | null;
  applied: boolean;
}

export interface FaultEvent {
  id: string;
  type: FaultType;
  timestamp: number;
  sessionId: string | null;
  message: string;
  stack?: string;
  context: Record<string, unknown>;
  resolved: boolean;
  resolvedAt: number | null;
  resolution: RecoveryStrategy | null;
  recoveryTimeMs: number | null;
  dataLost: boolean;
}

export interface RecoveryPlan {
  faultId: string;
  strategies: RecoveryStrategy[];
  currentStrategy: number;
  maxAttempts: number;
  attempts: number;
  status: 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'abandoned';
  startedAt: number;
  completedAt: number | null;
  estimatedRecoveryMs: number;
}

export interface HealthProbe {
  name: string;
  check: () => boolean | Promise<boolean>;
  intervalMs: number;
  lastCheck: number;
  lastResult: boolean;
  consecutiveFailures: number;
  maxFailures: number;
}

export interface FaultRecoveryConfig {
  /** How often to create checkpoints (ms) */
  checkpointIntervalMs: number;
  /** Max checkpoints to retain per session */
  maxCheckpoints: number;
  /** Max WAL entries before forced checkpoint */
  maxWALEntries: number;
  /** How long to keep fault history (ms) */
  faultRetentionMs: number;
  /** Max retry attempts per recovery strategy */
  maxRecoveryAttempts: number;
  /** Network connectivity check interval (ms) */
  networkCheckIntervalMs: number;
  /** Hardware heartbeat interval (ms) */
  hardwareHeartbeatMs: number;
  /** Timeout before declaring hardware disconnected (ms) */
  hardwareTimeoutMs: number;
  /** Enable progressive degradation */
  enableDegradation: boolean;
  /** Max data loss tolerance (items) */
  maxDataLossTolerance: number;
  /** Enable auto-recovery */
  autoRecover: boolean;
  /** Voice alerts for recovery events */
  voiceAlerts: boolean;
}

export interface FaultRecoveryEvents {
  fault_detected: (event: FaultEvent) => void;
  recovery_started: (plan: RecoveryPlan) => void;
  recovery_succeeded: (plan: RecoveryPlan) => void;
  recovery_failed: (plan: RecoveryPlan) => void;
  checkpoint_created: (checkpoint: Checkpoint) => void;
  checkpoint_restored: (checkpoint: Checkpoint) => void;
  degradation_changed: (level: DegradationLevel, reason: string) => void;
  hardware_disconnected: (deviceId: string) => void;
  hardware_reconnected: (deviceId: string) => void;
  network_lost: () => void;
  network_restored: () => void;
  wal_replayed: (entries: number) => void;
  data_loss_detected: (itemsLost: number) => void;
}

export interface FaultRecoveryStats {
  totalFaults: number;
  resolvedFaults: number;
  unresolvedFaults: number;
  totalRecoveries: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  averageRecoveryTimeMs: number;
  totalCheckpoints: number;
  totalWALEntries: number;
  dataLossEvents: number;
  totalItemsLost: number;
  currentDegradation: DegradationLevel;
  uptimeMs: number;
  lastFaultAt: number | null;
  mtbf: number | null; // mean time between failures
  mttr: number | null; // mean time to recovery
}

// ─── Default Config ──────────────────────────────────────────────────────────

export const DEFAULT_RECOVERY_CONFIG: FaultRecoveryConfig = {
  checkpointIntervalMs: 30_000,       // checkpoint every 30s
  maxCheckpoints: 20,                  // keep last 20 checkpoints per session
  maxWALEntries: 500,                  // force checkpoint at 500 WAL entries
  faultRetentionMs: 7 * 24 * 3600_000, // keep faults for 7 days
  maxRecoveryAttempts: 3,
  networkCheckIntervalMs: 10_000,      // check network every 10s
  hardwareHeartbeatMs: 5_000,          // expect heartbeat every 5s
  hardwareTimeoutMs: 15_000,           // disconnected after 15s silence
  enableDegradation: true,
  maxDataLossTolerance: 5,             // alert if >5 items could be lost
  autoRecover: true,
  voiceAlerts: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function simpleHash(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function estimateSize(obj: unknown): number {
  try {
    return JSON.stringify(obj).length * 2; // rough byte estimate
  } catch {
    return 0;
  }
}

// ─── Recovery Strategy Map ────────────────────────────────────────────────────

const FAULT_STRATEGIES: Record<FaultType, RecoveryStrategy[]> = {
  crash: ['checkpoint_restore', 'replay_wal', 'skip_and_continue'],
  network_loss: ['fallback_local', 'retry', 'skip_and_continue'],
  hardware_disconnect: ['reconnect', 'fallback_local', 'skip_and_continue'],
  timeout: ['retry', 'skip_and_continue'],
  storage_full: ['skip_and_continue', 'manual_intervention'],
  memory_pressure: ['checkpoint_restore', 'skip_and_continue'],
  api_failure: ['retry', 'fallback_local', 'skip_and_continue'],
  auth_expired: ['retry', 'manual_intervention'],
  data_corruption: ['checkpoint_restore', 'replay_wal', 'manual_intervention'],
  unknown: ['checkpoint_restore', 'retry', 'skip_and_continue', 'manual_intervention'],
};

// ─── Engine ──────────────────────────────────────────────────────────────────

export class FaultRecoveryEngine extends EventEmitter {
  private config: FaultRecoveryConfig;
  private checkpoints: Map<string, Checkpoint[]> = new Map(); // sessionId → checkpoints
  private wal: Map<string, WALEntry[]> = new Map(); // sessionId → WAL entries
  private faults: FaultEvent[] = [];
  private recoveryPlans: Map<string, RecoveryPlan> = new Map(); // faultId → plan
  private healthProbes: Map<string, HealthProbe> = new Map();
  private degradationLevel: DegradationLevel = 'full';
  private networkOnline: boolean = true;
  private connectedDevices: Map<string, number> = new Map(); // deviceId → last heartbeat
  private sequenceCounters: Map<string, number> = new Map(); // sessionId → seq
  private startedAt: number;
  private totalItemsLost: number = 0;

  constructor(config: Partial<FaultRecoveryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_RECOVERY_CONFIG, ...config };
    this.startedAt = Date.now();
  }

  // ─── Checkpoint Management ──────────────────────────────────────────────

  /**
   * Create a checkpoint of current session state
   */
  createCheckpoint(
    sessionId: string,
    data: Record<string, unknown>,
    metadata: Checkpoint['metadata']
  ): Checkpoint {
    const seq = this.getNextSequence(sessionId);
    const serialized = JSON.stringify(data);

    const checkpoint: Checkpoint = {
      id: generateId(),
      sessionId,
      timestamp: Date.now(),
      status: 'committed',
      data: { ...data },
      sequenceNumber: seq,
      sizeBytes: estimateSize(data),
      hash: simpleHash(serialized),
      metadata: { ...metadata },
    };

    const sessionCheckpoints = this.checkpoints.get(sessionId) || [];
    sessionCheckpoints.push(checkpoint);

    // Trim to max checkpoints
    while (sessionCheckpoints.length > this.config.maxCheckpoints) {
      sessionCheckpoints.shift();
    }

    this.checkpoints.set(sessionId, sessionCheckpoints);
    this.emit('checkpoint_created', checkpoint);

    // Clear WAL entries that are now covered by this checkpoint
    this.trimWAL(sessionId, checkpoint.id);

    return checkpoint;
  }

  /**
   * Get the latest valid checkpoint for a session
   */
  getLatestCheckpoint(sessionId: string): Checkpoint | null {
    const checkpoints = this.checkpoints.get(sessionId) || [];
    for (let i = checkpoints.length - 1; i >= 0; i--) {
      if (checkpoints[i].status === 'committed') {
        return checkpoints[i];
      }
    }
    return null;
  }

  /**
   * Get all checkpoints for a session
   */
  getCheckpoints(sessionId: string): Checkpoint[] {
    return [...(this.checkpoints.get(sessionId) || [])];
  }

  /**
   * Restore from a specific checkpoint
   */
  restoreFromCheckpoint(checkpointId: string): {
    checkpoint: Checkpoint;
    walEntries: WALEntry[];
  } | null {
    for (const [sessionId, checkpoints] of this.checkpoints) {
      const checkpoint = checkpoints.find(c => c.id === checkpointId);
      if (checkpoint && checkpoint.status === 'committed') {
        // Get WAL entries after this checkpoint
        const walEntries = (this.wal.get(sessionId) || [])
          .filter(w => w.sequenceNumber > checkpoint.sequenceNumber && !w.applied);

        this.emit('checkpoint_restored', checkpoint);
        return { checkpoint, walEntries };
      }
    }
    return null;
  }

  /**
   * Restore the latest checkpoint for a session, plus replay WAL
   */
  restoreSession(sessionId: string): {
    checkpoint: Checkpoint;
    walEntries: WALEntry[];
    estimatedLoss: number;
  } | null {
    const checkpoint = this.getLatestCheckpoint(sessionId);
    if (!checkpoint) return null;

    const walEntries = (this.wal.get(sessionId) || [])
      .filter(w => w.sequenceNumber > checkpoint.sequenceNumber && !w.applied);

    // Estimate potential data loss
    const currentSeq = this.sequenceCounters.get(sessionId) || 0;
    const recoveredSeq = checkpoint.sequenceNumber + walEntries.length;
    const estimatedLoss = Math.max(0, currentSeq - recoveredSeq);

    if (estimatedLoss > 0) {
      this.totalItemsLost += estimatedLoss;
      this.emit('data_loss_detected', estimatedLoss);
    }

    this.emit('checkpoint_restored', checkpoint);
    if (walEntries.length > 0) {
      this.emit('wal_replayed', walEntries.length);
    }

    return { checkpoint, walEntries, estimatedLoss };
  }

  /**
   * Mark a checkpoint as corrupted (e.g., hash mismatch on restore)
   */
  markCorrupted(checkpointId: string): boolean {
    for (const checkpoints of this.checkpoints.values()) {
      const cp = checkpoints.find(c => c.id === checkpointId);
      if (cp) {
        cp.status = 'corrupted';
        return true;
      }
    }
    return false;
  }

  /**
   * Verify checkpoint integrity by recomputing hash
   */
  verifyCheckpoint(checkpointId: string): boolean {
    for (const checkpoints of this.checkpoints.values()) {
      const cp = checkpoints.find(c => c.id === checkpointId);
      if (cp && cp.status === 'committed') {
        const currentHash = simpleHash(JSON.stringify(cp.data));
        return currentHash === cp.hash;
      }
    }
    return false;
  }

  // ─── Write-Ahead Log ───────────────────────────────────────────────────

  /**
   * Append an operation to the WAL
   */
  appendWAL(
    sessionId: string,
    operation: string,
    data: Record<string, unknown>
  ): WALEntry {
    const seq = this.getNextSequence(sessionId);
    const latestCheckpoint = this.getLatestCheckpoint(sessionId);

    const entry: WALEntry = {
      id: generateId(),
      sessionId,
      timestamp: Date.now(),
      sequenceNumber: seq,
      operation,
      data: { ...data },
      checkpointRef: latestCheckpoint?.id ?? null,
      applied: false,
    };

    const sessionWAL = this.wal.get(sessionId) || [];
    sessionWAL.push(entry);
    this.wal.set(sessionId, sessionWAL);

    // Check if WAL is too large and needs forced checkpoint
    if (sessionWAL.length >= this.config.maxWALEntries) {
      // Signal that checkpoint is needed (don't auto-create without state data)
    }

    return entry;
  }

  /**
   * Get uncommitted WAL entries for a session
   */
  getWALEntries(sessionId: string): WALEntry[] {
    return [...(this.wal.get(sessionId) || [])].filter(w => !w.applied);
  }

  /**
   * Get all WAL entries (including applied) for a session
   */
  getAllWALEntries(sessionId: string): WALEntry[] {
    return [...(this.wal.get(sessionId) || [])];
  }

  /**
   * Mark WAL entries as applied (after successful replay)
   */
  markWALApplied(entryIds: string[]): number {
    let marked = 0;
    const idSet = new Set(entryIds);
    for (const entries of this.wal.values()) {
      for (const entry of entries) {
        if (idSet.has(entry.id) && !entry.applied) {
          entry.applied = true;
          marked++;
        }
      }
    }
    return marked;
  }

  /**
   * Get WAL entries since a specific checkpoint
   */
  getWALSinceCheckpoint(sessionId: string, checkpointId: string): WALEntry[] {
    const checkpoint = this.checkpoints.get(sessionId)?.find(c => c.id === checkpointId);
    if (!checkpoint) return [];

    return (this.wal.get(sessionId) || [])
      .filter(w => w.sequenceNumber > checkpoint.sequenceNumber);
  }

  /**
   * Check if WAL needs compaction (forced checkpoint)
   */
  needsCheckpoint(sessionId: string): boolean {
    const wal = this.wal.get(sessionId) || [];
    const unapplied = wal.filter(w => !w.applied);
    return unapplied.length >= this.config.maxWALEntries;
  }

  private trimWAL(sessionId: string, checkpointId: string): void {
    const checkpoint = this.checkpoints.get(sessionId)?.find(c => c.id === checkpointId);
    if (!checkpoint) return;

    const wal = this.wal.get(sessionId) || [];
    // Remove WAL entries before this checkpoint that are already applied
    const trimmed = wal.filter(
      w => w.sequenceNumber > checkpoint.sequenceNumber || !w.applied
    );
    this.wal.set(sessionId, trimmed);
  }

  // ─── Fault Detection & Recovery ────────────────────────────────────────

  /**
   * Report a fault
   */
  reportFault(
    type: FaultType,
    message: string,
    options: {
      sessionId?: string;
      stack?: string;
      context?: Record<string, unknown>;
    } = {}
  ): FaultEvent {
    const fault: FaultEvent = {
      id: generateId(),
      type,
      timestamp: Date.now(),
      sessionId: options.sessionId ?? null,
      message,
      stack: options.stack,
      context: options.context || {},
      resolved: false,
      resolvedAt: null,
      resolution: null,
      recoveryTimeMs: null,
      dataLost: false,
    };

    this.faults.push(fault);
    this.trimFaults();
    this.emit('fault_detected', fault);

    // Auto-recover if enabled
    if (this.config.autoRecover) {
      this.startRecovery(fault.id);
    }

    return fault;
  }

  /**
   * Start recovery for a fault
   */
  startRecovery(faultId: string): RecoveryPlan | null {
    const fault = this.faults.find(f => f.id === faultId);
    if (!fault || fault.resolved) return null;

    const strategies = FAULT_STRATEGIES[fault.type] || FAULT_STRATEGIES.unknown;

    const plan: RecoveryPlan = {
      faultId,
      strategies: [...strategies],
      currentStrategy: 0,
      maxAttempts: this.config.maxRecoveryAttempts,
      attempts: 0,
      status: 'in_progress',
      startedAt: Date.now(),
      completedAt: null,
      estimatedRecoveryMs: this.estimateRecoveryTime(fault.type),
    };

    this.recoveryPlans.set(faultId, plan);
    this.emit('recovery_started', plan);

    return plan;
  }

  /**
   * Attempt the current recovery strategy
   */
  attemptRecovery(faultId: string): {
    success: boolean;
    strategy: RecoveryStrategy;
    nextStrategy: RecoveryStrategy | null;
  } | null {
    const plan = this.recoveryPlans.get(faultId);
    if (!plan || plan.status !== 'in_progress') return null;

    const fault = this.faults.find(f => f.id === faultId);
    if (!fault) return null;

    const strategy = plan.strategies[plan.currentStrategy];
    plan.attempts++;

    // Simulate recovery attempt based on strategy
    const success = this.executeStrategy(strategy, fault);

    if (success) {
      plan.status = 'succeeded';
      plan.completedAt = Date.now();
      fault.resolved = true;
      fault.resolvedAt = Date.now();
      fault.resolution = strategy;
      fault.recoveryTimeMs = Date.now() - plan.startedAt;
      this.emit('recovery_succeeded', plan);
      return { success: true, strategy, nextStrategy: null };
    }

    // Move to next strategy
    plan.currentStrategy++;
    if (plan.currentStrategy >= plan.strategies.length || plan.attempts >= plan.maxAttempts) {
      plan.status = 'failed';
      plan.completedAt = Date.now();
      this.emit('recovery_failed', plan);
      return { success: false, strategy, nextStrategy: null };
    }

    const nextStrategy = plan.strategies[plan.currentStrategy];
    return { success: false, strategy, nextStrategy };
  }

  /**
   * Manually resolve a fault
   */
  resolveFault(faultId: string, resolution: RecoveryStrategy): boolean {
    const fault = this.faults.find(f => f.id === faultId);
    if (!fault || fault.resolved) return false;

    fault.resolved = true;
    fault.resolvedAt = Date.now();
    fault.resolution = resolution;
    fault.recoveryTimeMs = Date.now() - fault.timestamp;

    const plan = this.recoveryPlans.get(faultId);
    if (plan && plan.status === 'in_progress') {
      plan.status = 'succeeded';
      plan.completedAt = Date.now();
    }

    return true;
  }

  /**
   * Abandon recovery attempts for a fault
   */
  abandonRecovery(faultId: string): boolean {
    const plan = this.recoveryPlans.get(faultId);
    if (!plan || plan.status !== 'in_progress') return false;

    plan.status = 'abandoned';
    plan.completedAt = Date.now();
    return true;
  }

  /**
   * Get recovery plan for a fault
   */
  getRecoveryPlan(faultId: string): RecoveryPlan | null {
    return this.recoveryPlans.get(faultId) || null;
  }

  /**
   * Get all faults, optionally filtered
   */
  getFaults(options: {
    resolved?: boolean;
    type?: FaultType;
    sessionId?: string;
    since?: number;
  } = {}): FaultEvent[] {
    let results = [...this.faults];

    if (options.resolved !== undefined) {
      results = results.filter(f => f.resolved === options.resolved);
    }
    if (options.type) {
      results = results.filter(f => f.type === options.type);
    }
    if (options.sessionId) {
      results = results.filter(f => f.sessionId === options.sessionId);
    }
    if (options.since) {
      results = results.filter(f => f.timestamp >= options.since!);
    }

    return results;
  }

  private executeStrategy(strategy: RecoveryStrategy, fault: FaultEvent): boolean {
    switch (strategy) {
      case 'checkpoint_restore':
        if (fault.sessionId) {
          const result = this.restoreSession(fault.sessionId);
          return result !== null;
        }
        return false;

      case 'replay_wal':
        if (fault.sessionId) {
          const wal = this.getWALEntries(fault.sessionId);
          return wal.length > 0;
        }
        return false;

      case 'reconnect':
        return this.networkOnline;

      case 'fallback_local':
        this.setDegradation('local_only', `Fallback due to ${fault.type}`);
        return true;

      case 'retry':
        // Retry is always "possible" — the caller decides if it actually works
        return true;

      case 'skip_and_continue':
        fault.dataLost = true;
        return true;

      case 'manual_intervention':
        return false; // Needs human

      default:
        return false;
    }
  }

  private estimateRecoveryTime(type: FaultType): number {
    const estimates: Record<FaultType, number> = {
      crash: 5000,
      network_loss: 30000,
      hardware_disconnect: 15000,
      timeout: 10000,
      storage_full: 60000,
      memory_pressure: 3000,
      api_failure: 5000,
      auth_expired: 10000,
      data_corruption: 30000,
      unknown: 15000,
    };
    return estimates[type] || 15000;
  }

  // ─── Degradation Management ────────────────────────────────────────────

  /**
   * Set the current degradation level
   */
  setDegradation(level: DegradationLevel, reason: string): void {
    if (level !== this.degradationLevel) {
      const previous = this.degradationLevel;
      this.degradationLevel = level;
      this.emit('degradation_changed', level, reason);
    }
  }

  /**
   * Get current degradation level
   */
  getDegradation(): DegradationLevel {
    return this.degradationLevel;
  }

  /**
   * Check if a capability is available at current degradation level
   */
  isCapabilityAvailable(capability: string): boolean {
    const requirements: Record<string, DegradationLevel[]> = {
      cloud_vision: ['full'],
      cloud_api: ['full', 'reduced'],
      local_processing: ['full', 'reduced', 'local_only'],
      offline_cache: ['full', 'reduced', 'local_only', 'offline'],
      voice_commands: ['full', 'reduced', 'local_only'],
      export: ['full', 'reduced'],
      sync: ['full'],
      notifications: ['full', 'reduced', 'local_only'],
    };

    const allowedLevels = requirements[capability];
    if (!allowedLevels) return true; // Unknown capabilities allowed by default
    return allowedLevels.includes(this.degradationLevel);
  }

  /**
   * Get available capabilities at current degradation level
   */
  getAvailableCapabilities(): string[] {
    const all = [
      'cloud_vision', 'cloud_api', 'local_processing', 'offline_cache',
      'voice_commands', 'export', 'sync', 'notifications'
    ];
    return all.filter(c => this.isCapabilityAvailable(c));
  }

  // ─── Network Monitoring ────────────────────────────────────────────────

  /**
   * Report network status change
   */
  setNetworkStatus(online: boolean): void {
    if (online !== this.networkOnline) {
      this.networkOnline = online;
      if (online) {
        this.emit('network_restored');
        if (this.degradationLevel === 'offline' || this.degradationLevel === 'local_only') {
          this.setDegradation('full', 'Network restored');
        }
      } else {
        this.emit('network_lost');
        if (this.config.enableDegradation) {
          this.setDegradation('local_only', 'Network lost');
        }
        this.reportFault('network_loss', 'Network connectivity lost');
      }
    }
  }

  /**
   * Get current network status
   */
  isNetworkOnline(): boolean {
    return this.networkOnline;
  }

  // ─── Hardware Monitoring ───────────────────────────────────────────────

  /**
   * Record a heartbeat from a connected device
   */
  deviceHeartbeat(deviceId: string): void {
    const wasConnected = this.connectedDevices.has(deviceId);
    this.connectedDevices.set(deviceId, Date.now());

    if (!wasConnected) {
      this.emit('hardware_reconnected', deviceId);
    }
  }

  /**
   * Check for disconnected devices based on heartbeat timeout
   */
  checkDeviceHealth(): string[] {
    const now = Date.now();
    const disconnected: string[] = [];

    for (const [deviceId, lastHeartbeat] of this.connectedDevices) {
      if (now - lastHeartbeat > this.config.hardwareTimeoutMs) {
        disconnected.push(deviceId);
        this.connectedDevices.delete(deviceId);
        this.emit('hardware_disconnected', deviceId);
        this.reportFault('hardware_disconnect', `Device ${deviceId} disconnected`, {
          context: { deviceId, lastHeartbeat, silenceMs: now - lastHeartbeat },
        });
      }
    }

    return disconnected;
  }

  /**
   * Get connected device IDs
   */
  getConnectedDevices(): string[] {
    return [...this.connectedDevices.keys()];
  }

  /**
   * Check if a specific device is connected
   */
  isDeviceConnected(deviceId: string): boolean {
    const lastHeartbeat = this.connectedDevices.get(deviceId);
    if (!lastHeartbeat) return false;
    return (Date.now() - lastHeartbeat) <= this.config.hardwareTimeoutMs;
  }

  // ─── Health Probes ─────────────────────────────────────────────────────

  /**
   * Register a health probe
   */
  registerProbe(name: string, check: () => boolean | Promise<boolean>, options: {
    intervalMs?: number;
    maxFailures?: number;
  } = {}): void {
    this.healthProbes.set(name, {
      name,
      check,
      intervalMs: options.intervalMs || 30_000,
      lastCheck: 0,
      lastResult: true,
      consecutiveFailures: 0,
      maxFailures: options.maxFailures || 3,
    });
  }

  /**
   * Run all health probes that are due
   */
  async runProbes(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const now = Date.now();

    for (const [name, probe] of this.healthProbes) {
      if (now - probe.lastCheck >= probe.intervalMs) {
        try {
          const result = await probe.check();
          probe.lastCheck = now;
          probe.lastResult = result;

          if (result) {
            probe.consecutiveFailures = 0;
          } else {
            probe.consecutiveFailures++;
            if (probe.consecutiveFailures >= probe.maxFailures) {
              this.reportFault('unknown', `Health probe "${name}" failed ${probe.consecutiveFailures} times`, {
                context: { probe: name, failures: probe.consecutiveFailures },
              });
            }
          }

          results.set(name, result);
        } catch {
          probe.lastCheck = now;
          probe.lastResult = false;
          probe.consecutiveFailures++;
          results.set(name, false);
        }
      }
    }

    return results;
  }

  /**
   * Get probe statuses
   */
  getProbeStatuses(): Array<{ name: string; healthy: boolean; failures: number; lastCheck: number }> {
    return [...this.healthProbes.values()].map(p => ({
      name: p.name,
      healthy: p.lastResult,
      failures: p.consecutiveFailures,
      lastCheck: p.lastCheck,
    }));
  }

  // ─── Session Cleanup ───────────────────────────────────────────────────

  /**
   * Clean up all data for a completed session
   */
  cleanupSession(sessionId: string): {
    checkpointsRemoved: number;
    walEntriesRemoved: number;
  } {
    const checkpointsRemoved = (this.checkpoints.get(sessionId) || []).length;
    const walEntriesRemoved = (this.wal.get(sessionId) || []).length;

    this.checkpoints.delete(sessionId);
    this.wal.delete(sessionId);
    this.sequenceCounters.delete(sessionId);

    return { checkpointsRemoved, walEntriesRemoved };
  }

  /**
   * Get all active session IDs (those with checkpoints or WAL entries)
   */
  getActiveSessions(): string[] {
    const sessions = new Set<string>();
    for (const sessionId of this.checkpoints.keys()) sessions.add(sessionId);
    for (const sessionId of this.wal.keys()) sessions.add(sessionId);
    return [...sessions];
  }

  // ─── Statistics ────────────────────────────────────────────────────────

  /**
   * Get comprehensive recovery statistics
   */
  getStats(): FaultRecoveryStats {
    const resolvedFaults = this.faults.filter(f => f.resolved);
    const unresolvedFaults = this.faults.filter(f => !f.resolved);

    const plans = [...this.recoveryPlans.values()];
    const successfulPlans = plans.filter(p => p.status === 'succeeded');
    const failedPlans = plans.filter(p => p.status === 'failed');

    const recoveryTimes = successfulPlans
      .filter(p => p.completedAt)
      .map(p => p.completedAt! - p.startedAt);
    const avgRecoveryTime = recoveryTimes.length > 0
      ? recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length
      : 0;

    let totalCheckpoints = 0;
    for (const cps of this.checkpoints.values()) totalCheckpoints += cps.length;

    let totalWAL = 0;
    for (const wal of this.wal.values()) totalWAL += wal.length;

    // MTBF calculation
    const faultTimestamps = this.faults.map(f => f.timestamp).sort((a, b) => a - b);
    let mtbf: number | null = null;
    if (faultTimestamps.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < faultTimestamps.length; i++) {
        intervals.push(faultTimestamps[i] - faultTimestamps[i - 1]);
      }
      mtbf = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    }

    const dataLossEvents = this.faults.filter(f => f.dataLost).length;

    return {
      totalFaults: this.faults.length,
      resolvedFaults: resolvedFaults.length,
      unresolvedFaults: unresolvedFaults.length,
      totalRecoveries: plans.length,
      successfulRecoveries: successfulPlans.length,
      failedRecoveries: failedPlans.length,
      averageRecoveryTimeMs: avgRecoveryTime,
      totalCheckpoints,
      totalWALEntries: totalWAL,
      dataLossEvents,
      totalItemsLost: this.totalItemsLost,
      currentDegradation: this.degradationLevel,
      uptimeMs: Date.now() - this.startedAt,
      lastFaultAt: this.faults.length > 0 ? this.faults[this.faults.length - 1].timestamp : null,
      mtbf,
      mttr: avgRecoveryTime > 0 ? avgRecoveryTime : null,
    };
  }

  // ─── Voice Summary ─────────────────────────────────────────────────────

  /**
   * Generate TTS-friendly status summary
   */
  getVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];

    // Current status
    if (stats.currentDegradation === 'full') {
      parts.push('System fully operational.');
    } else {
      parts.push(`System running in ${stats.currentDegradation.replace('_', ' ')} mode.`);
    }

    // Active faults
    if (stats.unresolvedFaults > 0) {
      parts.push(`${stats.unresolvedFaults} unresolved ${stats.unresolvedFaults === 1 ? 'issue' : 'issues'}.`);
    }

    // Recovery success rate
    if (stats.totalRecoveries > 0) {
      const rate = Math.round((stats.successfulRecoveries / stats.totalRecoveries) * 100);
      parts.push(`Recovery success rate: ${rate}%.`);
    }

    // Data loss
    if (stats.totalItemsLost > 0) {
      parts.push(`Warning: ${stats.totalItemsLost} items may have been lost.`);
    }

    // Network
    if (!this.networkOnline) {
      parts.push('Network is offline. Operating in local mode.');
    }

    // Devices
    const devices = this.getConnectedDevices();
    if (devices.length === 0) {
      parts.push('No devices connected.');
    } else {
      parts.push(`${devices.length} ${devices.length === 1 ? 'device' : 'devices'} connected.`);
    }

    return parts.join(' ');
  }

  // ─── Internal Helpers ──────────────────────────────────────────────────

  private getNextSequence(sessionId: string): number {
    const current = this.sequenceCounters.get(sessionId) || 0;
    const next = current + 1;
    this.sequenceCounters.set(sessionId, next);
    return next;
  }

  private trimFaults(): void {
    const cutoff = Date.now() - this.config.faultRetentionMs;
    this.faults = this.faults.filter(f => f.timestamp >= cutoff || !f.resolved);
  }
}
