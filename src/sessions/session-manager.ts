/**
 * Session Manager — Multi-Device Session Coordination
 * 
 * Manages concurrent sessions across glasses, phone, dashboard, and API clients.
 * Handles device handoffs, session lifecycle, activity tracking, and real-time sync.
 * 
 * Key capabilities:
 * - Multi-device session binding (glasses + phone + dashboard simultaneously)
 * - Session lifecycle: create → active → paused → resumed → completed/expired
 * - Device handoff (transfer active session between devices)
 * - Activity heartbeat tracking with configurable timeout
 * - Session metadata, tags, and notes
 * - Concurrent session limits per user/plan
 * - Session history with search and filtering
 * - Voice-friendly session summaries for TTS delivery
 * 
 * @module sessions/session-manager
 */

import { EventEmitter } from 'events';

// ─── Types ────────────────────────────────────────────────────────────────

export type DeviceType = 'glasses' | 'phone' | 'dashboard' | 'companion' | 'api' | 'cli';

export type SessionStatus = 'active' | 'paused' | 'completed' | 'expired' | 'cancelled' | 'error';

export type SessionType =
  | 'inventory'
  | 'inspection'
  | 'meeting'
  | 'shopping'
  | 'networking'
  | 'security_patrol'
  | 'translation'
  | 'debugging'
  | 'general'
  | 'custom';

export interface DeviceInfo {
  deviceId: string;
  type: DeviceType;
  name?: string;
  connectedAt: number;
  lastHeartbeat: number;
  capabilities: DeviceCapability[];
  metadata?: Record<string, unknown>;
}

export type DeviceCapability =
  | 'camera'
  | 'microphone'
  | 'speaker'
  | 'display'
  | 'gps'
  | 'accelerometer'
  | 'touch'
  | 'keyboard'
  | 'barcode_scanner';

export interface Session {
  id: string;
  userId: string;
  type: SessionType;
  status: SessionStatus;
  title?: string;
  description?: string;
  devices: DeviceInfo[];
  primaryDeviceId?: string;
  createdAt: number;
  startedAt?: number;
  pausedAt?: number;
  completedAt?: number;
  lastActivityAt: number;
  expiresAt?: number;
  duration: number; // total active time in ms (excludes paused time)
  pausedDuration: number; // total paused time in ms
  tags: string[];
  notes: string[];
  metadata: Record<string, unknown>;
  agentIds: string[]; // which agents are active in this session
  stats: SessionStats;
}

export interface SessionStats {
  imagesProcessed: number;
  voiceCommands: number;
  agentInvocations: number;
  itemsScanned: number;
  errorsEncountered: number;
  deviceHandoffs: number;
  pauseCount: number;
}

export interface SessionQuery {
  userId?: string;
  status?: SessionStatus | SessionStatus[];
  type?: SessionType | SessionType[];
  deviceType?: DeviceType;
  tags?: string[];
  after?: number;
  before?: number;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'lastActivityAt' | 'duration';
  sortOrder?: 'asc' | 'desc';
}

export interface SessionManagerConfig {
  maxSessionsPerUser: number;
  maxDevicesPerSession: number;
  sessionTimeoutMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  maxSessionHistory: number;
  autoExpireEnabled: boolean;
  autoExpireCheckIntervalMs: number;
  maxTagsPerSession: number;
  maxNotesPerSession: number;
  maxTitleLength: number;
  maxNoteLength: number;
}

export const DEFAULT_SESSION_CONFIG: SessionManagerConfig = {
  maxSessionsPerUser: 5,
  maxDevicesPerSession: 8,
  sessionTimeoutMs: 4 * 60 * 60 * 1000, // 4 hours
  heartbeatIntervalMs: 30_000, // 30 seconds
  heartbeatTimeoutMs: 120_000, // 2 minutes — device considered disconnected
  maxSessionHistory: 1000,
  autoExpireEnabled: true,
  autoExpireCheckIntervalMs: 60_000, // check every minute
  maxTagsPerSession: 20,
  maxNotesPerSession: 100,
  maxTitleLength: 200,
  maxNoteLength: 1000,
};

export interface SessionManagerEvents {
  'session:created': (session: Session) => void;
  'session:started': (session: Session) => void;
  'session:paused': (session: Session, reason?: string) => void;
  'session:resumed': (session: Session) => void;
  'session:completed': (session: Session, summary: SessionSummary) => void;
  'session:expired': (session: Session) => void;
  'session:cancelled': (session: Session, reason?: string) => void;
  'session:error': (session: Session, error: string) => void;
  'device:connected': (sessionId: string, device: DeviceInfo) => void;
  'device:disconnected': (sessionId: string, deviceId: string, reason: string) => void;
  'device:heartbeat': (sessionId: string, deviceId: string) => void;
  'device:handoff': (sessionId: string, fromDeviceId: string, toDeviceId: string) => void;
  'limit:approaching': (userId: string, current: number, max: number) => void;
  'limit:reached': (userId: string, max: number) => void;
}

export interface SessionSummary {
  sessionId: string;
  type: SessionType;
  duration: number;
  pausedDuration: number;
  deviceCount: number;
  stats: SessionStats;
  tags: string[];
  noteCount: number;
  voiceSummary: string;
}

export interface HandoffResult {
  success: boolean;
  fromDevice: string;
  toDevice: string;
  reason?: string;
}

// ─── Session Manager ──────────────────────────────────────────────────────

export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private config: SessionManagerConfig;
  private expireTimer: ReturnType<typeof setInterval> | null = null;
  private idCounter: number = 0;

  constructor(config: Partial<SessionManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config };

    if (this.config.autoExpireEnabled) {
      this.startAutoExpire();
    }
  }

  // ─── Session Lifecycle ────────────────────────────────────────────────

  /**
   * Create a new session. Does not start it — call start() after creation.
   */
  createSession(params: {
    userId: string;
    type: SessionType;
    title?: string;
    description?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    agentIds?: string[];
  }): Session {
    // Check concurrent session limit
    const activeCount = this.getActiveSessionCount(params.userId);
    if (activeCount >= this.config.maxSessionsPerUser) {
      this.emit('limit:reached', params.userId, this.config.maxSessionsPerUser);
      throw new Error(
        `User ${params.userId} has reached the maximum of ${this.config.maxSessionsPerUser} concurrent sessions`
      );
    }

    if (activeCount >= this.config.maxSessionsPerUser - 1) {
      this.emit('limit:approaching', params.userId, activeCount + 1, this.config.maxSessionsPerUser);
    }

    const now = Date.now();
    const id = this.generateId();

    const title = params.title
      ? params.title.slice(0, this.config.maxTitleLength)
      : undefined;

    const tags = (params.tags || []).slice(0, this.config.maxTagsPerSession);

    const session: Session = {
      id,
      userId: params.userId,
      type: params.type,
      status: 'active',
      title,
      description: params.description,
      devices: [],
      createdAt: now,
      startedAt: now,
      lastActivityAt: now,
      expiresAt: now + this.config.sessionTimeoutMs,
      duration: 0,
      pausedDuration: 0,
      tags,
      notes: [],
      metadata: params.metadata || {},
      agentIds: params.agentIds || [],
      stats: {
        imagesProcessed: 0,
        voiceCommands: 0,
        agentInvocations: 0,
        itemsScanned: 0,
        errorsEncountered: 0,
        deviceHandoffs: 0,
        pauseCount: 0,
      },
    };

    this.sessions.set(id, session);
    this.trimHistory();
    this.emit('session:created', { ...session });

    return { ...session };
  }

  /**
   * Pause a session. Tracks paused time separately.
   */
  pauseSession(sessionId: string, reason?: string): Session {
    const session = this.getSessionOrThrow(sessionId);

    if (session.status !== 'active') {
      throw new Error(`Cannot pause session in '${session.status}' status`);
    }

    const now = Date.now();

    // Accumulate active time
    const activeStart = session.startedAt || session.createdAt;
    const lastResumeOrStart = session.pausedAt
      ? session.lastActivityAt // last resume
      : activeStart;
    session.duration += now - lastResumeOrStart;

    session.status = 'paused';
    session.pausedAt = now;
    session.lastActivityAt = now;
    session.stats.pauseCount++;

    this.emit('session:paused', { ...session }, reason);
    return { ...session };
  }

  /**
   * Resume a paused session.
   */
  resumeSession(sessionId: string): Session {
    const session = this.getSessionOrThrow(sessionId);

    if (session.status !== 'paused') {
      throw new Error(`Cannot resume session in '${session.status}' status`);
    }

    const now = Date.now();
    if (session.pausedAt) {
      session.pausedDuration += now - session.pausedAt;
    }

    session.status = 'active';
    session.pausedAt = undefined;
    session.lastActivityAt = now;

    this.emit('session:resumed', { ...session });
    return { ...session };
  }

  /**
   * Complete a session normally.
   */
  completeSession(sessionId: string): SessionSummary {
    const session = this.getSessionOrThrow(sessionId);

    if (session.status === 'completed' || session.status === 'cancelled') {
      throw new Error(`Session is already '${session.status}'`);
    }

    const now = Date.now();

    // Finalize duration
    if (session.status === 'active') {
      const lastActive = session.pausedAt
        ? session.lastActivityAt
        : (session.startedAt || session.createdAt);
      // Duration from last active period
      const timeSinceLastActive = now - session.lastActivityAt;
      session.duration += timeSinceLastActive;
    } else if (session.status === 'paused' && session.pausedAt) {
      session.pausedDuration += now - session.pausedAt;
    }

    session.status = 'completed';
    session.completedAt = now;
    session.lastActivityAt = now;

    const summary = this.generateSummary(session);
    this.emit('session:completed', { ...session }, summary);

    return summary;
  }

  /**
   * Cancel a session.
   */
  cancelSession(sessionId: string, reason?: string): Session {
    const session = this.getSessionOrThrow(sessionId);

    if (session.status === 'completed' || session.status === 'cancelled') {
      throw new Error(`Session is already '${session.status}'`);
    }

    const now = Date.now();
    session.status = 'cancelled';
    session.completedAt = now;
    session.lastActivityAt = now;

    this.emit('session:cancelled', { ...session }, reason);
    return { ...session };
  }

  // ─── Device Management ────────────────────────────────────────────────

  /**
   * Connect a device to a session.
   */
  connectDevice(sessionId: string, device: {
    deviceId: string;
    type: DeviceType;
    name?: string;
    capabilities?: DeviceCapability[];
    metadata?: Record<string, unknown>;
  }): DeviceInfo {
    const session = this.getSessionOrThrow(sessionId);

    if (session.status !== 'active' && session.status !== 'paused') {
      throw new Error(`Cannot connect device to session in '${session.status}' status`);
    }

    if (session.devices.length >= this.config.maxDevicesPerSession) {
      throw new Error(
        `Session has reached the maximum of ${this.config.maxDevicesPerSession} connected devices`
      );
    }

    // Check for duplicate device
    const existing = session.devices.find(d => d.deviceId === device.deviceId);
    if (existing) {
      // Update heartbeat on reconnect
      existing.lastHeartbeat = Date.now();
      existing.connectedAt = Date.now();
      this.emit('device:connected', sessionId, { ...existing });
      return { ...existing };
    }

    const now = Date.now();
    const deviceInfo: DeviceInfo = {
      deviceId: device.deviceId,
      type: device.type,
      name: device.name,
      connectedAt: now,
      lastHeartbeat: now,
      capabilities: device.capabilities || this.getDefaultCapabilities(device.type),
      metadata: device.metadata,
    };

    session.devices.push(deviceInfo);

    // First device becomes primary
    if (!session.primaryDeviceId) {
      session.primaryDeviceId = device.deviceId;
    }

    session.lastActivityAt = now;

    this.emit('device:connected', sessionId, { ...deviceInfo });
    return { ...deviceInfo };
  }

  /**
   * Disconnect a device from a session.
   */
  disconnectDevice(sessionId: string, deviceId: string, reason: string = 'manual'): void {
    const session = this.getSessionOrThrow(sessionId);

    const deviceIndex = session.devices.findIndex(d => d.deviceId === deviceId);
    if (deviceIndex === -1) {
      throw new Error(`Device ${deviceId} not found in session ${sessionId}`);
    }

    session.devices.splice(deviceIndex, 1);

    // If primary device disconnected, reassign
    if (session.primaryDeviceId === deviceId) {
      session.primaryDeviceId = session.devices.length > 0
        ? session.devices[0].deviceId
        : undefined;
    }

    session.lastActivityAt = Date.now();

    this.emit('device:disconnected', sessionId, deviceId, reason);
  }

  /**
   * Record a device heartbeat.
   */
  deviceHeartbeat(sessionId: string, deviceId: string): void {
    const session = this.getSessionOrThrow(sessionId);

    const device = session.devices.find(d => d.deviceId === deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found in session ${sessionId}`);
    }

    device.lastHeartbeat = Date.now();
    session.lastActivityAt = Date.now();

    this.emit('device:heartbeat', sessionId, deviceId);
  }

  /**
   * Hand off primary control from one device to another.
   */
  handoffDevice(sessionId: string, fromDeviceId: string, toDeviceId: string): HandoffResult {
    const session = this.getSessionOrThrow(sessionId);

    const fromDevice = session.devices.find(d => d.deviceId === fromDeviceId);
    const toDevice = session.devices.find(d => d.deviceId === toDeviceId);

    if (!fromDevice) {
      return { success: false, fromDevice: fromDeviceId, toDevice: toDeviceId, reason: 'Source device not found' };
    }

    if (!toDevice) {
      return { success: false, fromDevice: fromDeviceId, toDevice: toDeviceId, reason: 'Target device not found' };
    }

    session.primaryDeviceId = toDeviceId;
    session.stats.deviceHandoffs++;
    session.lastActivityAt = Date.now();

    this.emit('device:handoff', sessionId, fromDeviceId, toDeviceId);

    return { success: true, fromDevice: fromDeviceId, toDevice: toDeviceId };
  }

  /**
   * Check for timed-out devices and disconnect them.
   */
  checkDeviceTimeouts(sessionId: string): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    const now = Date.now();
    const timedOut: string[] = [];

    for (const device of [...session.devices]) {
      if (now - device.lastHeartbeat > this.config.heartbeatTimeoutMs) {
        timedOut.push(device.deviceId);
        this.disconnectDevice(sessionId, device.deviceId, 'heartbeat_timeout');
      }
    }

    return timedOut;
  }

  // ─── Session Metadata ─────────────────────────────────────────────────

  /**
   * Add a tag to a session.
   */
  addTag(sessionId: string, tag: string): void {
    const session = this.getSessionOrThrow(sessionId);

    if (session.tags.length >= this.config.maxTagsPerSession) {
      throw new Error(`Session has reached the maximum of ${this.config.maxTagsPerSession} tags`);
    }

    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag) return;

    if (!session.tags.includes(normalizedTag)) {
      session.tags.push(normalizedTag);
    }
  }

  /**
   * Remove a tag from a session.
   */
  removeTag(sessionId: string, tag: string): void {
    const session = this.getSessionOrThrow(sessionId);

    const normalizedTag = tag.trim().toLowerCase();
    const index = session.tags.indexOf(normalizedTag);
    if (index !== -1) {
      session.tags.splice(index, 1);
    }
  }

  /**
   * Add a note to a session.
   */
  addNote(sessionId: string, note: string): void {
    const session = this.getSessionOrThrow(sessionId);

    if (session.notes.length >= this.config.maxNotesPerSession) {
      throw new Error(`Session has reached the maximum of ${this.config.maxNotesPerSession} notes`);
    }

    const trimmedNote = note.slice(0, this.config.maxNoteLength);
    session.notes.push(trimmedNote);
    session.lastActivityAt = Date.now();
  }

  /**
   * Update session metadata.
   */
  updateMetadata(sessionId: string, metadata: Record<string, unknown>): void {
    const session = this.getSessionOrThrow(sessionId);
    Object.assign(session.metadata, metadata);
    session.lastActivityAt = Date.now();
  }

  /**
   * Record a stat increment.
   */
  incrementStat(sessionId: string, stat: keyof SessionStats, amount: number = 1): void {
    const session = this.getSessionOrThrow(sessionId);
    session.stats[stat] += amount;
    session.lastActivityAt = Date.now();
  }

  /**
   * Add an agent to the session's active agents.
   */
  addAgent(sessionId: string, agentId: string): void {
    const session = this.getSessionOrThrow(sessionId);
    if (!session.agentIds.includes(agentId)) {
      session.agentIds.push(agentId);
    }
  }

  /**
   * Remove an agent from the session.
   */
  removeAgent(sessionId: string, agentId: string): void {
    const session = this.getSessionOrThrow(sessionId);
    const index = session.agentIds.indexOf(agentId);
    if (index !== -1) {
      session.agentIds.splice(index, 1);
    }
  }

  // ─── Session Queries ──────────────────────────────────────────────────

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    return session ? { ...session, devices: [...session.devices] } : undefined;
  }

  /**
   * Get all sessions matching a query.
   */
  querySessions(query: SessionQuery = {}): Session[] {
    let results = Array.from(this.sessions.values());

    if (query.userId) {
      results = results.filter(s => s.userId === query.userId);
    }

    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      results = results.filter(s => statuses.includes(s.status));
    }

    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      results = results.filter(s => types.includes(s.type));
    }

    if (query.deviceType) {
      results = results.filter(s =>
        s.devices.some(d => d.type === query.deviceType)
      );
    }

    if (query.tags && query.tags.length > 0) {
      const searchTags = query.tags.map(t => t.toLowerCase());
      results = results.filter(s =>
        searchTags.every(tag => s.tags.includes(tag))
      );
    }

    if (query.after) {
      results = results.filter(s => s.createdAt >= query.after!);
    }

    if (query.before) {
      results = results.filter(s => s.createdAt <= query.before!);
    }

    // Sort
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';
    results.sort((a, b) => {
      const aVal = a[sortBy] as number;
      const bVal = b[sortBy] as number;
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Pagination
    const offset = query.offset || 0;
    const limit = query.limit || 50;
    results = results.slice(offset, offset + limit);

    return results.map(s => ({ ...s, devices: [...s.devices] }));
  }

  /**
   * Get count of active sessions for a user.
   */
  getActiveSessionCount(userId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && (session.status === 'active' || session.status === 'paused')) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get all active sessions.
   */
  getActiveSessions(): Session[] {
    return this.querySessions({ status: ['active', 'paused'] });
  }

  /**
   * Get sessions with a specific device type connected.
   */
  getSessionsByDevice(deviceType: DeviceType): Session[] {
    return this.querySessions({
      status: ['active', 'paused'],
      deviceType,
    });
  }

  // ─── Auto-Expire ──────────────────────────────────────────────────────

  /**
   * Check for and expire timed-out sessions.
   */
  expireSessions(): string[] {
    const now = Date.now();
    const expired: string[] = [];

    for (const session of this.sessions.values()) {
      if (
        (session.status === 'active' || session.status === 'paused') &&
        session.expiresAt &&
        now >= session.expiresAt
      ) {
        session.status = 'expired';
        session.completedAt = now;
        session.lastActivityAt = now;
        expired.push(session.id);
        this.emit('session:expired', { ...session });
      }
    }

    return expired;
  }

  // ─── Summary & Voice ──────────────────────────────────────────────────

  /**
   * Generate a summary for a session.
   */
  generateSummary(session: Session): SessionSummary {
    const s = typeof session === 'string' ? this.getSessionOrThrow(session as string) : session;

    return {
      sessionId: s.id,
      type: s.type,
      duration: s.duration,
      pausedDuration: s.pausedDuration,
      deviceCount: s.devices.length,
      stats: { ...s.stats },
      tags: [...s.tags],
      noteCount: s.notes.length,
      voiceSummary: this.generateVoiceSummary(s),
    };
  }

  /**
   * Generate a TTS-friendly voice summary.
   */
  generateVoiceSummary(sessionOrId: Session | string): string {
    const session = typeof sessionOrId === 'string'
      ? this.getSessionOrThrow(sessionOrId)
      : sessionOrId;

    const parts: string[] = [];

    // Session type and duration
    const durationMins = Math.round(session.duration / 60000);
    const typeLabel = session.type.replace(/_/g, ' ');
    parts.push(`${typeLabel} session`);

    if (durationMins > 0) {
      if (durationMins >= 60) {
        const hours = Math.floor(durationMins / 60);
        const mins = durationMins % 60;
        parts[0] += `, ${hours} hour${hours > 1 ? 's' : ''}${mins > 0 ? ` ${mins} minutes` : ''}`;
      } else {
        parts[0] += `, ${durationMins} minute${durationMins > 1 ? 's' : ''}`;
      }
    }
    parts[0] += '.';

    // Stats highlights
    const { stats } = session;
    const highlights: string[] = [];

    if (stats.imagesProcessed > 0) {
      highlights.push(`${stats.imagesProcessed} image${stats.imagesProcessed > 1 ? 's' : ''} processed`);
    }
    if (stats.itemsScanned > 0) {
      highlights.push(`${stats.itemsScanned} item${stats.itemsScanned > 1 ? 's' : ''} scanned`);
    }
    if (stats.voiceCommands > 0) {
      highlights.push(`${stats.voiceCommands} voice command${stats.voiceCommands > 1 ? 's' : ''}`);
    }
    if (stats.agentInvocations > 0) {
      highlights.push(`${stats.agentInvocations} agent call${stats.agentInvocations > 1 ? 's' : ''}`);
    }

    if (highlights.length > 0) {
      parts.push(highlights.join(', ') + '.');
    }

    // Device info
    if (session.devices.length > 0) {
      const deviceTypes = [...new Set(session.devices.map(d => d.type))];
      parts.push(`Devices: ${deviceTypes.join(', ')}.`);
    }

    // Errors
    if (stats.errorsEncountered > 0) {
      parts.push(`${stats.errorsEncountered} error${stats.errorsEncountered > 1 ? 's' : ''} encountered.`);
    }

    return parts.join(' ');
  }

  // ─── Utility ──────────────────────────────────────────────────────────

  /**
   * Get total session count.
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get overall stats across all sessions.
   */
  getGlobalStats(): {
    totalSessions: number;
    activeSessions: number;
    pausedSessions: number;
    completedSessions: number;
    expiredSessions: number;
    cancelledSessions: number;
    totalImages: number;
    totalVoiceCommands: number;
    totalItemsScanned: number;
    totalDuration: number;
    averageDuration: number;
    uniqueUsers: number;
  } {
    const sessions = Array.from(this.sessions.values());
    const uniqueUsers = new Set(sessions.map(s => s.userId));

    const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);
    const completedSessions = sessions.filter(s => s.status === 'completed');

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.status === 'active').length,
      pausedSessions: sessions.filter(s => s.status === 'paused').length,
      completedSessions: completedSessions.length,
      expiredSessions: sessions.filter(s => s.status === 'expired').length,
      cancelledSessions: sessions.filter(s => s.status === 'cancelled').length,
      totalImages: sessions.reduce((sum, s) => sum + s.stats.imagesProcessed, 0),
      totalVoiceCommands: sessions.reduce((sum, s) => sum + s.stats.voiceCommands, 0),
      totalItemsScanned: sessions.reduce((sum, s) => sum + s.stats.itemsScanned, 0),
      totalDuration,
      averageDuration: completedSessions.length > 0
        ? totalDuration / completedSessions.length
        : 0,
      uniqueUsers: uniqueUsers.size,
    };
  }

  /**
   * Destroy the session manager and clean up timers.
   */
  destroy(): void {
    if (this.expireTimer) {
      clearInterval(this.expireTimer);
      this.expireTimer = null;
    }
    this.removeAllListeners();
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private getSessionOrThrow(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return session;
  }

  private generateId(): string {
    this.idCounter++;
    return `ses_${Date.now()}_${this.idCounter}`;
  }

  private getDefaultCapabilities(type: DeviceType): DeviceCapability[] {
    switch (type) {
      case 'glasses':
        return ['camera', 'microphone', 'speaker', 'gps', 'accelerometer'];
      case 'phone':
        return ['camera', 'microphone', 'speaker', 'display', 'gps', 'touch'];
      case 'dashboard':
        return ['display', 'keyboard'];
      case 'companion':
        return ['display', 'touch', 'gps'];
      case 'api':
        return [];
      case 'cli':
        return ['keyboard'];
      default:
        return [];
    }
  }

  private startAutoExpire(): void {
    this.expireTimer = setInterval(() => {
      this.expireSessions();
    }, this.config.autoExpireCheckIntervalMs);
  }

  private trimHistory(): void {
    if (this.sessions.size <= this.config.maxSessionHistory) return;

    // Sort by lastActivityAt — remove oldest completed/expired/cancelled first
    const terminalSessions = Array.from(this.sessions.entries())
      .filter(([, s]) => s.status === 'completed' || s.status === 'expired' || s.status === 'cancelled')
      .sort(([, a], [, b]) => a.lastActivityAt - b.lastActivityAt);

    const toRemove = this.sessions.size - this.config.maxSessionHistory;
    for (let i = 0; i < Math.min(toRemove, terminalSessions.length); i++) {
      this.sessions.delete(terminalSessions[i][0]);
    }
  }
}
