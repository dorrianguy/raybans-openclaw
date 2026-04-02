/**
 * Multi-Session Coordinator — Run multiple concurrent inventory sessions
 *
 * Enterprise feature for:
 * - Parallel inventory counts across multiple stores/zones
 * - Team coordination (multiple counters in same store)
 * - Session handoffs between shifts
 * - Cross-session analytics and reconciliation
 * - Priority-based resource allocation
 * - Real-time progress aggregation
 * - Voice-friendly status for any session
 *
 * @module sessions/multi-session
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionConfig {
  /** Maximum concurrent sessions (default: 10) */
  maxConcurrent?: number;
  /** Session timeout in ms (default: 8 hours) */
  sessionTimeoutMs?: number;
  /** Auto-pause inactive sessions after ms (default: 30 min) */
  inactivityTimeoutMs?: number;
  /** Enable cross-session deduplication (default: true) */
  crossSessionDedup?: boolean;
  /** Max items per session before split (default: 50000) */
  maxItemsPerSession?: number;
  /** Enable session handoffs (default: true) */
  allowHandoffs?: boolean;
}

export type SessionStatus = 'pending' | 'active' | 'paused' | 'completing' | 'completed' | 'cancelled' | 'error' | 'handed_off';

export type SessionPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

const PRIORITY_WEIGHTS: Record<SessionPriority, number> = {
  critical: 5,
  high: 4,
  normal: 3,
  low: 2,
  background: 1,
};

export interface SessionMember {
  userId: string;
  name: string;
  role: 'lead' | 'counter' | 'reviewer' | 'observer';
  joinedAt: number;
  leftAt?: number;
  itemsCounted: number;
  zonesCompleted: string[];
}

export interface InventorySession {
  id: string;
  name: string;
  storeId: string;
  storeName: string;
  status: SessionStatus;
  priority: SessionPriority;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  pausedAt?: number;
  lastActivityAt: number;
  members: SessionMember[];
  zones: SessionZone[];
  itemCount: number;
  flaggedCount: number;
  estimatedCompletion?: number;
  notes: string[];
  tags: string[];
  parentSessionId?: string;
  childSessionIds: string[];
  handoffFrom?: string;
  handoffTo?: string;
  metadata: Record<string, unknown>;
}

export interface SessionZone {
  id: string;
  name: string;
  assignedTo?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'needs_recount';
  itemCount: number;
  startedAt?: number;
  completedAt?: number;
}

export interface CrossSessionItem {
  sku: string;
  name: string;
  sessions: Array<{
    sessionId: string;
    count: number;
    confidence: number;
  }>;
  totalCount: number;
  discrepancy: boolean;
  maxVariance: number;
}

export interface SessionSplit {
  originalSessionId: string;
  newSessionIds: string[];
  splitBy: 'zone' | 'category' | 'manual';
  splitAt: number;
}

export interface AggregatedProgress {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  totalItems: number;
  totalFlagged: number;
  totalZones: number;
  completedZones: number;
  overallProgress: number;
  estimatedCompletionTime?: number;
  byStore: Array<{
    storeId: string;
    storeName: string;
    sessions: number;
    items: number;
    progress: number;
  }>;
  byPriority: Record<SessionPriority, number>;
}

export interface HandoffRequest {
  sessionId: string;
  fromUserId: string;
  toUserId: string;
  reason: string;
  timestamp: number;
  zones?: string[];
  notes?: string;
}

// ─── Multi-Session Coordinator ──────────────────────────────────────────────

export class MultiSessionCoordinator extends EventEmitter {
  private config: Required<SessionConfig>;
  private sessions: Map<string, InventorySession> = new Map();
  private items: Map<string, Map<string, { count: number; confidence: number; name: string }>> = new Map();
  private handoffHistory: HandoffRequest[] = [];
  private sessionCounter = 0;

  constructor(config: SessionConfig = {}) {
    super();
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 10,
      sessionTimeoutMs: config.sessionTimeoutMs ?? 8 * 60 * 60 * 1000,
      inactivityTimeoutMs: config.inactivityTimeoutMs ?? 30 * 60 * 1000,
      crossSessionDedup: config.crossSessionDedup ?? true,
      maxItemsPerSession: config.maxItemsPerSession ?? 50000,
      allowHandoffs: config.allowHandoffs ?? true,
    };
  }

  // ─── Session Lifecycle ──────────────────────────────────────────────────

  /**
   * Create a new inventory session.
   */
  createSession(params: {
    name: string;
    storeId: string;
    storeName: string;
    priority?: SessionPriority;
    zones?: Array<{ id: string; name: string }>;
    members?: Array<{ userId: string; name: string; role: SessionMember['role'] }>;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): InventorySession {
    const activeCount = this.getActiveSessionCount();
    if (activeCount >= this.config.maxConcurrent) {
      throw new Error(
        `Maximum concurrent sessions (${this.config.maxConcurrent}) reached. ` +
        `Complete or cancel an existing session first.`
      );
    }

    const id = `session_${++this.sessionCounter}_${Date.now()}`;
    const now = Date.now();

    const session: InventorySession = {
      id,
      name: params.name,
      storeId: params.storeId,
      storeName: params.storeName,
      status: 'pending',
      priority: params.priority ?? 'normal',
      createdAt: now,
      lastActivityAt: now,
      members: (params.members ?? []).map((m) => ({
        ...m,
        joinedAt: now,
        itemsCounted: 0,
        zonesCompleted: [],
      })),
      zones: (params.zones ?? []).map((z) => ({
        ...z,
        status: 'pending' as const,
        itemCount: 0,
      })),
      itemCount: 0,
      flaggedCount: 0,
      notes: [],
      tags: params.tags ?? [],
      childSessionIds: [],
      metadata: params.metadata ?? {},
    };

    this.sessions.set(id, session);
    this.items.set(id, new Map());
    this.emit('session:created', session);

    return session;
  }

  /**
   * Start a pending session.
   */
  startSession(sessionId: string): InventorySession {
    const session = this.getSessionOrThrow(sessionId);
    if (session.status !== 'pending' && session.status !== 'paused') {
      throw new Error(`Cannot start session in '${session.status}' status`);
    }

    const now = Date.now();
    session.status = 'active';
    session.startedAt = session.startedAt ?? now;
    session.lastActivityAt = now;
    if (session.pausedAt) {
      session.pausedAt = undefined;
    }

    this.emit('session:started', session);
    return session;
  }

  /**
   * Pause an active session.
   */
  pauseSession(sessionId: string, reason?: string): InventorySession {
    const session = this.getSessionOrThrow(sessionId);
    if (session.status !== 'active') {
      throw new Error(`Cannot pause session in '${session.status}' status`);
    }

    session.status = 'paused';
    session.pausedAt = Date.now();
    session.lastActivityAt = Date.now();
    if (reason) {
      session.notes.push(`Paused: ${reason} (${new Date().toISOString()})`);
    }

    this.emit('session:paused', { session, reason });
    return session;
  }

  /**
   * Resume a paused session.
   */
  resumeSession(sessionId: string): InventorySession {
    return this.startSession(sessionId);
  }

  /**
   * Complete a session.
   */
  completeSession(sessionId: string, notes?: string): InventorySession {
    const session = this.getSessionOrThrow(sessionId);
    if (session.status === 'completed' || session.status === 'cancelled') {
      throw new Error(`Session already in '${session.status}' status`);
    }

    session.status = 'completed';
    session.completedAt = Date.now();
    session.lastActivityAt = Date.now();
    if (notes) {
      session.notes.push(`Completed: ${notes}`);
    }

    this.emit('session:completed', session);
    return session;
  }

  /**
   * Cancel a session.
   */
  cancelSession(sessionId: string, reason: string): InventorySession {
    const session = this.getSessionOrThrow(sessionId);
    if (session.status === 'completed' || session.status === 'cancelled') {
      throw new Error(`Session already in '${session.status}' status`);
    }

    session.status = 'cancelled';
    session.completedAt = Date.now();
    session.lastActivityAt = Date.now();
    session.notes.push(`Cancelled: ${reason}`);

    this.emit('session:cancelled', { session, reason });
    return session;
  }

  // ─── Item Tracking ──────────────────────────────────────────────────────

  /**
   * Add or update an item in a session.
   */
  addItem(
    sessionId: string,
    sku: string,
    name: string,
    count: number,
    confidence: number = 1.0,
    memberId?: string
  ): void {
    const session = this.getSessionOrThrow(sessionId);
    if (session.status !== 'active') {
      throw new Error(`Cannot add items to session in '${session.status}' status`);
    }

    const sessionItems = this.items.get(sessionId)!;
    const existing = sessionItems.get(sku);

    if (existing) {
      // Confidence-weighted merge
      const totalConf = existing.confidence + confidence;
      existing.count = Math.round(
        (existing.count * existing.confidence + count * confidence) / totalConf
      );
      existing.confidence = Math.min(1.0, totalConf / 2);
    } else {
      sessionItems.set(sku, { count, confidence, name });
    }

    session.itemCount = sessionItems.size;
    session.lastActivityAt = Date.now();

    // Update member stats
    if (memberId) {
      const member = session.members.find((m) => m.userId === memberId);
      if (member) {
        member.itemsCounted++;
      }
    }

    this.emit('item:added', { sessionId, sku, name, count, confidence });

    // Check split threshold
    if (session.itemCount >= this.config.maxItemsPerSession) {
      this.emit('session:split_needed', {
        sessionId,
        itemCount: session.itemCount,
        maxItems: this.config.maxItemsPerSession,
      });
    }
  }

  /**
   * Flag an item for review.
   */
  flagItem(sessionId: string, sku: string, reason: string): void {
    const session = this.getSessionOrThrow(sessionId);
    const sessionItems = this.items.get(sessionId)!;

    if (!sessionItems.has(sku)) {
      throw new Error(`Item ${sku} not found in session ${sessionId}`);
    }

    session.flaggedCount++;
    session.lastActivityAt = Date.now();
    session.notes.push(`Flagged ${sku}: ${reason}`);

    this.emit('item:flagged', { sessionId, sku, reason });
  }

  /**
   * Get items for a session.
   */
  getSessionItems(sessionId: string): Map<string, { count: number; confidence: number; name: string }> {
    if (!this.items.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return this.items.get(sessionId)!;
  }

  // ─── Zone Management ────────────────────────────────────────────────────

  /**
   * Add a zone to a session.
   */
  addZone(sessionId: string, zoneId: string, zoneName: string): SessionZone {
    const session = this.getSessionOrThrow(sessionId);
    if (session.zones.find((z) => z.id === zoneId)) {
      throw new Error(`Zone ${zoneId} already exists in session`);
    }

    const zone: SessionZone = {
      id: zoneId,
      name: zoneName,
      status: 'pending',
      itemCount: 0,
    };

    session.zones.push(zone);
    session.lastActivityAt = Date.now();
    this.emit('zone:added', { sessionId, zone });
    return zone;
  }

  /**
   * Start counting in a zone.
   */
  startZone(sessionId: string, zoneId: string, assignedTo?: string): SessionZone {
    const session = this.getSessionOrThrow(sessionId);
    const zone = session.zones.find((z) => z.id === zoneId);
    if (!zone) throw new Error(`Zone ${zoneId} not found in session`);

    zone.status = 'in_progress';
    zone.startedAt = Date.now();
    zone.assignedTo = assignedTo;
    session.lastActivityAt = Date.now();

    this.emit('zone:started', { sessionId, zone });
    return zone;
  }

  /**
   * Complete a zone.
   */
  completeZone(sessionId: string, zoneId: string, itemCount?: number): SessionZone {
    const session = this.getSessionOrThrow(sessionId);
    const zone = session.zones.find((z) => z.id === zoneId);
    if (!zone) throw new Error(`Zone ${zoneId} not found in session`);

    zone.status = 'completed';
    zone.completedAt = Date.now();
    if (itemCount !== undefined) zone.itemCount = itemCount;
    session.lastActivityAt = Date.now();

    // Update member zone completions
    if (zone.assignedTo) {
      const member = session.members.find((m) => m.userId === zone.assignedTo);
      if (member) {
        member.zonesCompleted.push(zoneId);
      }
    }

    this.emit('zone:completed', { sessionId, zone });

    // Check if all zones are done
    const allComplete = session.zones.every(
      (z) => z.status === 'completed'
    );
    if (allComplete && session.zones.length > 0) {
      this.emit('session:all_zones_complete', session);
    }

    return zone;
  }

  /**
   * Mark a zone for recount.
   */
  markZoneForRecount(sessionId: string, zoneId: string, reason: string): SessionZone {
    const session = this.getSessionOrThrow(sessionId);
    const zone = session.zones.find((z) => z.id === zoneId);
    if (!zone) throw new Error(`Zone ${zoneId} not found in session`);

    zone.status = 'needs_recount';
    zone.completedAt = undefined;
    session.lastActivityAt = Date.now();
    session.notes.push(`Zone ${zone.name} needs recount: ${reason}`);

    this.emit('zone:recount', { sessionId, zone, reason });
    return zone;
  }

  // ─── Team Management ────────────────────────────────────────────────────

  /**
   * Add a member to a session.
   */
  addMember(
    sessionId: string,
    userId: string,
    name: string,
    role: SessionMember['role'] = 'counter'
  ): SessionMember {
    const session = this.getSessionOrThrow(sessionId);

    if (session.members.find((m) => m.userId === userId && !m.leftAt)) {
      throw new Error(`User ${userId} is already an active member`);
    }

    const member: SessionMember = {
      userId,
      name,
      role,
      joinedAt: Date.now(),
      itemsCounted: 0,
      zonesCompleted: [],
    };

    session.members.push(member);
    session.lastActivityAt = Date.now();

    this.emit('member:joined', { sessionId, member });
    return member;
  }

  /**
   * Remove a member from a session.
   */
  removeMember(sessionId: string, userId: string): void {
    const session = this.getSessionOrThrow(sessionId);
    const member = session.members.find((m) => m.userId === userId && !m.leftAt);
    if (!member) throw new Error(`User ${userId} is not an active member`);

    member.leftAt = Date.now();
    session.lastActivityAt = Date.now();

    // Unassign their zones
    for (const zone of session.zones) {
      if (zone.assignedTo === userId && zone.status === 'in_progress') {
        zone.assignedTo = undefined;
      }
    }

    this.emit('member:left', { sessionId, member });
  }

  /**
   * Get active members of a session.
   */
  getActiveMembers(sessionId: string): SessionMember[] {
    const session = this.getSessionOrThrow(sessionId);
    return session.members.filter((m) => !m.leftAt);
  }

  // ─── Session Handoffs ───────────────────────────────────────────────────

  /**
   * Hand off a session (or specific zones) to another user.
   */
  handoff(request: HandoffRequest): InventorySession {
    if (!this.config.allowHandoffs) {
      throw new Error('Session handoffs are disabled');
    }

    const session = this.getSessionOrThrow(request.sessionId);
    if (session.status !== 'active' && session.status !== 'paused') {
      throw new Error(`Cannot hand off session in '${session.status}' status`);
    }

    // Record handoff
    this.handoffHistory.push(request);
    session.handoffFrom = request.fromUserId;
    session.handoffTo = request.toUserId;
    session.lastActivityAt = Date.now();
    session.notes.push(
      `Handoff from ${request.fromUserId} to ${request.toUserId}: ${request.reason}`
    );

    // Transfer zone assignments if specified
    if (request.zones) {
      for (const zoneId of request.zones) {
        const zone = session.zones.find((z) => z.id === zoneId);
        if (zone) {
          zone.assignedTo = request.toUserId;
        }
      }
    }

    // Update member records
    const fromMember = session.members.find(
      (m) => m.userId === request.fromUserId && !m.leftAt
    );
    if (fromMember) {
      fromMember.leftAt = Date.now();
    }

    // Add new member if not already present
    if (!session.members.find((m) => m.userId === request.toUserId && !m.leftAt)) {
      session.members.push({
        userId: request.toUserId,
        name: request.toUserId,
        role: fromMember?.role ?? 'counter',
        joinedAt: Date.now(),
        itemsCounted: 0,
        zonesCompleted: [],
      });
    }

    this.emit('session:handoff', { session, request });
    return session;
  }

  /**
   * Get handoff history.
   */
  getHandoffHistory(sessionId?: string): HandoffRequest[] {
    if (sessionId) {
      return this.handoffHistory.filter((h) => h.sessionId === sessionId);
    }
    return [...this.handoffHistory];
  }

  // ─── Cross-Session Analytics ────────────────────────────────────────────

  /**
   * Find items that appear in multiple sessions (for reconciliation).
   */
  getCrossSessionItems(storeId?: string): CrossSessionItem[] {
    const skuMap = new Map<string, CrossSessionItem>();

    for (const [sessionId, sessionItems] of this.items) {
      const session = this.sessions.get(sessionId);
      if (!session) continue;
      if (storeId && session.storeId !== storeId) continue;
      if (session.status === 'cancelled') continue;

      for (const [sku, item] of sessionItems) {
        if (!skuMap.has(sku)) {
          skuMap.set(sku, {
            sku,
            name: item.name,
            sessions: [],
            totalCount: 0,
            discrepancy: false,
            maxVariance: 0,
          });
        }

        const cross = skuMap.get(sku)!;
        cross.sessions.push({
          sessionId,
          count: item.count,
          confidence: item.confidence,
        });
      }
    }

    // Calculate totals and discrepancies
    for (const item of skuMap.values()) {
      if (item.sessions.length > 1) {
        const counts = item.sessions.map((s) => s.count);
        const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
        item.totalCount = counts.reduce((a, b) => a + b, 0);

        // Max variance = max absolute difference between any two counts / average
        let maxDiff = 0;
        for (let i = 0; i < counts.length; i++) {
          for (let j = i + 1; j < counts.length; j++) {
            maxDiff = Math.max(maxDiff, Math.abs(counts[i] - counts[j]));
          }
        }
        item.maxVariance = avg > 0 ? maxDiff / avg : 0;
        item.discrepancy = item.maxVariance > 0.1; // 10% threshold
      } else {
        item.totalCount = item.sessions[0]?.count ?? 0;
      }
    }

    return Array.from(skuMap.values())
      .filter((item) => item.sessions.length > 1)
      .sort((a, b) => b.maxVariance - a.maxVariance);
  }

  /**
   * Get aggregated progress across all sessions.
   */
  getAggregatedProgress(): AggregatedProgress {
    const sessions = Array.from(this.sessions.values()).filter(
      (s) => s.status !== 'cancelled'
    );

    const storeMap = new Map<string, {
      storeId: string;
      storeName: string;
      sessions: number;
      items: number;
      completedZones: number;
      totalZones: number;
    }>();

    const byPriority: Record<SessionPriority, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
      background: 0,
    };

    let totalZones = 0;
    let completedZones = 0;

    for (const session of sessions) {
      byPriority[session.priority]++;

      totalZones += session.zones.length;
      const sessionCompleted = session.zones.filter((z) => z.status === 'completed').length;
      completedZones += sessionCompleted;

      if (!storeMap.has(session.storeId)) {
        storeMap.set(session.storeId, {
          storeId: session.storeId,
          storeName: session.storeName,
          sessions: 0,
          items: 0,
          completedZones: 0,
          totalZones: 0,
        });
      }
      const store = storeMap.get(session.storeId)!;
      store.sessions++;
      store.items += session.itemCount;
      store.completedZones += sessionCompleted;
      store.totalZones += session.zones.length;
    }

    const totalItems = sessions.reduce((sum, s) => sum + s.itemCount, 0);
    const totalFlagged = sessions.reduce((sum, s) => sum + s.flaggedCount, 0);
    const activeSessions = sessions.filter((s) => s.status === 'active').length;
    const completedSessions = sessions.filter((s) => s.status === 'completed').length;

    const overallProgress = totalZones > 0 ? completedZones / totalZones : 0;

    return {
      totalSessions: sessions.length,
      activeSessions,
      completedSessions,
      totalItems,
      totalFlagged,
      totalZones,
      completedZones,
      overallProgress: Math.round(overallProgress * 10000) / 100,
      byStore: Array.from(storeMap.values()).map((s) => ({
        ...s,
        progress: s.totalZones > 0
          ? Math.round((s.completedZones / s.totalZones) * 10000) / 100
          : 0,
      })),
      byPriority,
    };
  }

  // ─── Session Queries ────────────────────────────────────────────────────

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): InventorySession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions, optionally filtered.
   */
  getSessions(filter?: {
    status?: SessionStatus | SessionStatus[];
    storeId?: string;
    priority?: SessionPriority;
    memberId?: string;
  }): InventorySession[] {
    let sessions = Array.from(this.sessions.values());

    if (filter) {
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        sessions = sessions.filter((s) => statuses.includes(s.status));
      }
      if (filter.storeId) {
        sessions = sessions.filter((s) => s.storeId === filter.storeId);
      }
      if (filter.priority) {
        sessions = sessions.filter((s) => s.priority === filter.priority);
      }
      if (filter.memberId) {
        sessions = sessions.filter((s) =>
          s.members.some((m) => m.userId === filter.memberId && !m.leftAt)
        );
      }
    }

    // Sort by priority weight descending, then by creation time
    return sessions.sort((a, b) => {
      const pDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
      return pDiff !== 0 ? pDiff : a.createdAt - b.createdAt;
    });
  }

  /**
   * Get count of active (non-completed, non-cancelled) sessions.
   */
  getActiveSessionCount(): number {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === 'active' || s.status === 'pending' || s.status === 'paused'
    ).length;
  }

  /**
   * Get sessions for a specific store.
   */
  getStoreSessions(storeId: string): InventorySession[] {
    return this.getSessions({ storeId });
  }

  // ─── Session Splitting ──────────────────────────────────────────────────

  /**
   * Split a session by zones — creates child sessions for zone groups.
   */
  splitByZones(
    sessionId: string,
    zoneGroups: Array<{ name: string; zoneIds: string[] }>
  ): SessionSplit {
    const parent = this.getSessionOrThrow(sessionId);
    if (parent.status === 'completed' || parent.status === 'cancelled') {
      throw new Error('Cannot split a finished session');
    }

    const newSessionIds: string[] = [];

    for (const group of zoneGroups) {
      const zones = parent.zones.filter((z) => group.zoneIds.includes(z.id));
      if (zones.length === 0) continue;

      const child = this.createSession({
        name: `${parent.name} — ${group.name}`,
        storeId: parent.storeId,
        storeName: parent.storeName,
        priority: parent.priority,
        zones: zones.map((z) => ({ id: z.id, name: z.name })),
        tags: [...parent.tags, 'split'],
        metadata: { ...parent.metadata, parentSessionId: sessionId },
      });

      child.parentSessionId = sessionId;
      parent.childSessionIds.push(child.id);
      newSessionIds.push(child.id);

      // Copy items for the zones
      const parentItems = this.items.get(sessionId)!;
      const childItems = this.items.get(child.id)!;
      for (const [sku, item] of parentItems) {
        childItems.set(sku, { ...item });
      }
    }

    const split: SessionSplit = {
      originalSessionId: sessionId,
      newSessionIds,
      splitBy: 'zone',
      splitAt: Date.now(),
    };

    this.emit('session:split', split);
    return split;
  }

  // ─── Inactivity Management ──────────────────────────────────────────────

  /**
   * Check for and handle inactive sessions.
   */
  checkInactiveSessions(): Array<{ sessionId: string; action: 'paused' | 'timed_out' }> {
    const now = Date.now();
    const results: Array<{ sessionId: string; action: 'paused' | 'timed_out' }> = [];

    for (const session of this.sessions.values()) {
      if (session.status !== 'active') continue;

      const inactiveTime = now - session.lastActivityAt;

      if (session.startedAt && now - session.startedAt > this.config.sessionTimeoutMs) {
        session.status = 'error';
        session.notes.push(`Session timed out after ${Math.round(this.config.sessionTimeoutMs / 3600000)}h`);
        results.push({ sessionId: session.id, action: 'timed_out' });
        this.emit('session:timeout', session);
      } else if (inactiveTime > this.config.inactivityTimeoutMs) {
        session.status = 'paused';
        session.pausedAt = now;
        session.notes.push('Auto-paused due to inactivity');
        results.push({ sessionId: session.id, action: 'paused' });
        this.emit('session:auto_paused', session);
      }
    }

    return results;
  }

  // ─── Voice Summary ──────────────────────────────────────────────────────

  /**
   * Generate a TTS-friendly session status.
   */
  getSessionVoiceSummary(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return 'Session not found.';

    const parts: string[] = [];
    parts.push(`${session.name} at ${session.storeName}.`);
    parts.push(`Status: ${session.status}.`);
    parts.push(`${session.itemCount} items counted.`);

    if (session.flaggedCount > 0) {
      parts.push(`${session.flaggedCount} items flagged.`);
    }

    const completedZones = session.zones.filter((z) => z.status === 'completed').length;
    if (session.zones.length > 0) {
      parts.push(`${completedZones} of ${session.zones.length} zones complete.`);
    }

    const activeMembers = session.members.filter((m) => !m.leftAt);
    if (activeMembers.length > 0) {
      parts.push(`${activeMembers.length} team member${activeMembers.length > 1 ? 's' : ''} active.`);
    }

    return parts.join(' ');
  }

  /**
   * Generate a TTS-friendly overall summary.
   */
  getOverallVoiceSummary(): string {
    const progress = this.getAggregatedProgress();

    if (progress.totalSessions === 0) {
      return 'No inventory sessions in progress.';
    }

    const parts: string[] = [];
    parts.push(`${progress.totalSessions} total sessions.`);
    parts.push(`${progress.activeSessions} active, ${progress.completedSessions} completed.`);
    parts.push(`${progress.totalItems} items counted across all sessions.`);

    if (progress.totalZones > 0) {
      parts.push(`Overall progress: ${progress.overallProgress}%.`);
    }

    if (progress.totalFlagged > 0) {
      parts.push(`${progress.totalFlagged} items flagged for review.`);
    }

    return parts.join(' ');
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Remove completed/cancelled sessions older than the given age.
   */
  pruneOldSessions(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;

    for (const [id, session] of this.sessions) {
      if (
        (session.status === 'completed' || session.status === 'cancelled') &&
        (session.completedAt ?? session.createdAt) < cutoff
      ) {
        this.sessions.delete(id);
        this.items.delete(id);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Delete a specific session.
   */
  deleteSession(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.sessions.delete(sessionId);
    this.items.delete(sessionId);
    return true;
  }

  /**
   * Clear all sessions.
   */
  clearAll(): void {
    this.sessions.clear();
    this.items.clear();
    this.handoffHistory = [];
    this.sessionCounter = 0;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private getSessionOrThrow(sessionId: string): InventorySession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session;
  }
}
