/**
 * Tests for Multi-Session Coordinator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MultiSessionCoordinator,
  type SessionConfig,
  type InventorySession,
  type HandoffRequest,
} from './multi-session';

// ─── Helpers ──────────────────────────────────────────────────────────────

function createCoordinator(config: SessionConfig = {}): MultiSessionCoordinator {
  return new MultiSessionCoordinator(config);
}

function createTestSession(
  coord: MultiSessionCoordinator,
  overrides: Partial<Parameters<MultiSessionCoordinator['createSession']>[0]> = {}
): InventorySession {
  return coord.createSession({
    name: 'Test Inventory',
    storeId: 'store-001',
    storeName: 'Test Store',
    ...overrides,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('MultiSessionCoordinator', () => {
  let coord: MultiSessionCoordinator;

  beforeEach(() => {
    coord = createCoordinator();
  });

  // ── Constructor ───────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates with default config', () => {
      const c = createCoordinator();
      expect(c).toBeDefined();
      expect(c.getSessions()).toEqual([]);
    });

    it('accepts custom config', () => {
      const c = createCoordinator({
        maxConcurrent: 5,
        sessionTimeoutMs: 3600000,
      });
      expect(c).toBeDefined();
    });
  });

  // ── Session Lifecycle ─────────────────────────────────────────────────

  describe('createSession', () => {
    it('creates a pending session', () => {
      const session = createTestSession(coord);
      expect(session.id).toBeDefined();
      expect(session.status).toBe('pending');
      expect(session.name).toBe('Test Inventory');
      expect(session.storeId).toBe('store-001');
    });

    it('accepts zones', () => {
      const session = createTestSession(coord, {
        zones: [
          { id: 'z1', name: 'Aisle 1' },
          { id: 'z2', name: 'Aisle 2' },
        ],
      });
      expect(session.zones.length).toBe(2);
      expect(session.zones[0].status).toBe('pending');
    });

    it('accepts members', () => {
      const session = createTestSession(coord, {
        members: [
          { userId: 'user1', name: 'Alice', role: 'lead' },
          { userId: 'user2', name: 'Bob', role: 'counter' },
        ],
      });
      expect(session.members.length).toBe(2);
      expect(session.members[0].role).toBe('lead');
    });

    it('enforces max concurrent sessions', () => {
      const c = createCoordinator({ maxConcurrent: 2 });
      createTestSession(c);
      createTestSession(c);

      expect(() => createTestSession(c)).toThrow(/Maximum concurrent sessions/);
    });

    it('emits session:created event', () => {
      const handler = vi.fn();
      coord.on('session:created', handler);
      createTestSession(coord);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('sets default priority to normal', () => {
      const session = createTestSession(coord);
      expect(session.priority).toBe('normal');
    });

    it('accepts custom priority', () => {
      const session = createTestSession(coord, { priority: 'critical' });
      expect(session.priority).toBe('critical');
    });

    it('accepts tags', () => {
      const session = createTestSession(coord, { tags: ['quarterly', 'full-count'] });
      expect(session.tags).toEqual(['quarterly', 'full-count']);
    });
  });

  describe('startSession', () => {
    it('starts a pending session', () => {
      const session = createTestSession(coord);
      const started = coord.startSession(session.id);
      expect(started.status).toBe('active');
      expect(started.startedAt).toBeDefined();
    });

    it('emits session:started event', () => {
      const handler = vi.fn();
      coord.on('session:started', handler);
      const session = createTestSession(coord);
      coord.startSession(session.id);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('throws for non-pending session', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);
      coord.completeSession(session.id);
      expect(() => coord.startSession(session.id)).toThrow();
    });
  });

  describe('pauseSession', () => {
    it('pauses an active session', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);
      const paused = coord.pauseSession(session.id, 'Lunch break');
      expect(paused.status).toBe('paused');
      expect(paused.pausedAt).toBeDefined();
    });

    it('records reason in notes', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);
      coord.pauseSession(session.id, 'Shift change');
      expect(session.notes.some((n) => n.includes('Shift change'))).toBe(true);
    });

    it('throws for non-active session', () => {
      const session = createTestSession(coord);
      expect(() => coord.pauseSession(session.id)).toThrow();
    });
  });

  describe('resumeSession', () => {
    it('resumes a paused session', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);
      coord.pauseSession(session.id);
      const resumed = coord.resumeSession(session.id);
      expect(resumed.status).toBe('active');
    });
  });

  describe('completeSession', () => {
    it('completes an active session', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);
      const completed = coord.completeSession(session.id);
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeDefined();
    });

    it('completes a pending session', () => {
      const session = createTestSession(coord);
      const completed = coord.completeSession(session.id);
      expect(completed.status).toBe('completed');
    });

    it('records completion notes', () => {
      const session = createTestSession(coord);
      coord.completeSession(session.id, 'All zones counted');
      expect(session.notes.some((n) => n.includes('All zones counted'))).toBe(true);
    });

    it('throws for already completed session', () => {
      const session = createTestSession(coord);
      coord.completeSession(session.id);
      expect(() => coord.completeSession(session.id)).toThrow();
    });

    it('emits session:completed event', () => {
      const handler = vi.fn();
      coord.on('session:completed', handler);
      const session = createTestSession(coord);
      coord.completeSession(session.id);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelSession', () => {
    it('cancels a session with reason', () => {
      const session = createTestSession(coord);
      const cancelled = coord.cancelSession(session.id, 'Wrong store');
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.notes.some((n) => n.includes('Wrong store'))).toBe(true);
    });

    it('throws for completed session', () => {
      const session = createTestSession(coord);
      coord.completeSession(session.id);
      expect(() => coord.cancelSession(session.id, 'Too late')).toThrow();
    });
  });

  // ── Item Tracking ─────────────────────────────────────────────────────

  describe('addItem', () => {
    it('adds items to an active session', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);
      coord.addItem(session.id, 'SKU-001', 'Widget A', 10);

      const items = coord.getSessionItems(session.id);
      expect(items.size).toBe(1);
      expect(items.get('SKU-001')!.count).toBe(10);
    });

    it('updates item count with confidence weighting', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);

      coord.addItem(session.id, 'SKU-001', 'Widget A', 10, 0.8);
      coord.addItem(session.id, 'SKU-001', 'Widget A', 14, 0.9);

      const items = coord.getSessionItems(session.id);
      const item = items.get('SKU-001')!;
      // Weighted: (10 * 0.8 + 14 * 0.9) / (0.8 + 0.9) = (8 + 12.6) / 1.7 = 12.12 → 12
      expect(item.count).toBeCloseTo(12, 0);
    });

    it('updates session itemCount', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);

      coord.addItem(session.id, 'SKU-001', 'Widget A', 10);
      coord.addItem(session.id, 'SKU-002', 'Widget B', 5);
      expect(session.itemCount).toBe(2);
    });

    it('tracks member contributions', () => {
      const session = createTestSession(coord, {
        members: [{ userId: 'alice', name: 'Alice', role: 'counter' }],
      });
      coord.startSession(session.id);

      coord.addItem(session.id, 'SKU-001', 'Widget', 10, 1.0, 'alice');
      coord.addItem(session.id, 'SKU-002', 'Gadget', 5, 1.0, 'alice');

      const member = session.members.find((m) => m.userId === 'alice')!;
      expect(member.itemsCounted).toBe(2);
    });

    it('throws for non-active session', () => {
      const session = createTestSession(coord);
      expect(() =>
        coord.addItem(session.id, 'SKU-001', 'Widget', 10)
      ).toThrow(/Cannot add items/);
    });

    it('emits item:added event', () => {
      const handler = vi.fn();
      coord.on('item:added', handler);
      const session = createTestSession(coord);
      coord.startSession(session.id);
      coord.addItem(session.id, 'SKU-001', 'Widget', 10);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits split_needed when max items reached', () => {
      const c = createCoordinator({ maxItemsPerSession: 3 });
      const handler = vi.fn();
      c.on('session:split_needed', handler);

      const session = createTestSession(c);
      c.startSession(session.id);
      c.addItem(session.id, 'A', 'A', 1);
      c.addItem(session.id, 'B', 'B', 1);
      c.addItem(session.id, 'C', 'C', 1);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('flagItem', () => {
    it('flags an item for review', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);
      coord.addItem(session.id, 'SKU-001', 'Widget', 10);
      coord.flagItem(session.id, 'SKU-001', 'Count seems wrong');

      expect(session.flaggedCount).toBe(1);
      expect(session.notes.some((n) => n.includes('SKU-001'))).toBe(true);
    });

    it('throws for unknown item', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);
      expect(() =>
        coord.flagItem(session.id, 'NOPE', 'reason')
      ).toThrow(/not found/);
    });
  });

  // ── Zone Management ───────────────────────────────────────────────────

  describe('zone management', () => {
    it('adds zones to a session', () => {
      const session = createTestSession(coord);
      coord.addZone(session.id, 'z1', 'Aisle 1');
      expect(session.zones.length).toBe(1);
    });

    it('prevents duplicate zones', () => {
      const session = createTestSession(coord);
      coord.addZone(session.id, 'z1', 'Aisle 1');
      expect(() => coord.addZone(session.id, 'z1', 'Dup')).toThrow(/already exists/);
    });

    it('starts a zone', () => {
      const session = createTestSession(coord, {
        zones: [{ id: 'z1', name: 'Aisle 1' }],
      });
      const zone = coord.startZone(session.id, 'z1', 'alice');
      expect(zone.status).toBe('in_progress');
      expect(zone.assignedTo).toBe('alice');
      expect(zone.startedAt).toBeDefined();
    });

    it('completes a zone', () => {
      const session = createTestSession(coord, {
        zones: [{ id: 'z1', name: 'Aisle 1' }],
        members: [{ userId: 'alice', name: 'Alice', role: 'counter' }],
      });
      coord.startZone(session.id, 'z1', 'alice');
      const zone = coord.completeZone(session.id, 'z1', 50);

      expect(zone.status).toBe('completed');
      expect(zone.completedAt).toBeDefined();
      expect(zone.itemCount).toBe(50);

      const alice = session.members.find((m) => m.userId === 'alice')!;
      expect(alice.zonesCompleted).toContain('z1');
    });

    it('emits all_zones_complete when all done', () => {
      const handler = vi.fn();
      coord.on('session:all_zones_complete', handler);

      const session = createTestSession(coord, {
        zones: [
          { id: 'z1', name: 'A1' },
          { id: 'z2', name: 'A2' },
        ],
      });
      coord.completeZone(session.id, 'z1');
      expect(handler).not.toHaveBeenCalled();

      coord.completeZone(session.id, 'z2');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('marks a zone for recount', () => {
      const session = createTestSession(coord, {
        zones: [{ id: 'z1', name: 'Aisle 1' }],
      });
      coord.completeZone(session.id, 'z1');
      const zone = coord.markZoneForRecount(session.id, 'z1', 'Counts too low');
      expect(zone.status).toBe('needs_recount');
    });

    it('throws for unknown zone', () => {
      const session = createTestSession(coord);
      expect(() => coord.startZone(session.id, 'nope')).toThrow(/not found/);
    });
  });

  // ── Team Management ───────────────────────────────────────────────────

  describe('member management', () => {
    it('adds a member to a session', () => {
      const session = createTestSession(coord);
      const member = coord.addMember(session.id, 'bob', 'Bob', 'counter');
      expect(member.userId).toBe('bob');
      expect(member.role).toBe('counter');
    });

    it('prevents duplicate active members', () => {
      const session = createTestSession(coord);
      coord.addMember(session.id, 'bob', 'Bob');
      expect(() => coord.addMember(session.id, 'bob', 'Bob')).toThrow(
        /already an active member/
      );
    });

    it('removes a member', () => {
      const session = createTestSession(coord);
      coord.addMember(session.id, 'bob', 'Bob');
      coord.removeMember(session.id, 'bob');

      const active = coord.getActiveMembers(session.id);
      expect(active.length).toBe(0);
    });

    it('unassigns zones when member leaves', () => {
      const session = createTestSession(coord, {
        zones: [{ id: 'z1', name: 'Aisle 1' }],
      });
      coord.addMember(session.id, 'bob', 'Bob');
      coord.startZone(session.id, 'z1', 'bob');
      coord.removeMember(session.id, 'bob');

      expect(session.zones[0].assignedTo).toBeUndefined();
    });

    it('throws when removing non-member', () => {
      const session = createTestSession(coord);
      expect(() => coord.removeMember(session.id, 'nobody')).toThrow();
    });
  });

  // ── Session Handoffs ──────────────────────────────────────────────────

  describe('handoff', () => {
    it('hands off a session to another user', () => {
      const session = createTestSession(coord, {
        members: [{ userId: 'alice', name: 'Alice', role: 'lead' }],
      });
      coord.startSession(session.id);

      const result = coord.handoff({
        sessionId: session.id,
        fromUserId: 'alice',
        toUserId: 'bob',
        reason: 'Shift change',
        timestamp: Date.now(),
      });

      expect(result.handoffFrom).toBe('alice');
      expect(result.handoffTo).toBe('bob');
      expect(result.members.find((m) => m.userId === 'bob' && !m.leftAt)).toBeDefined();
    });

    it('transfers zone assignments', () => {
      const session = createTestSession(coord, {
        zones: [{ id: 'z1', name: 'A1' }],
      });
      coord.startSession(session.id);
      coord.startZone(session.id, 'z1', 'alice');

      coord.handoff({
        sessionId: session.id,
        fromUserId: 'alice',
        toUserId: 'bob',
        reason: 'Break',
        timestamp: Date.now(),
        zones: ['z1'],
      });

      expect(session.zones[0].assignedTo).toBe('bob');
    });

    it('records handoff in history', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);

      coord.handoff({
        sessionId: session.id,
        fromUserId: 'alice',
        toUserId: 'bob',
        reason: 'Test',
        timestamp: Date.now(),
      });

      const history = coord.getHandoffHistory(session.id);
      expect(history.length).toBe(1);
    });

    it('throws when handoffs disabled', () => {
      const c = createCoordinator({ allowHandoffs: false });
      const session = createTestSession(c);
      c.startSession(session.id);

      expect(() =>
        c.handoff({
          sessionId: session.id,
          fromUserId: 'a',
          toUserId: 'b',
          reason: 'test',
          timestamp: Date.now(),
        })
      ).toThrow(/disabled/);
    });

    it('throws for completed session', () => {
      const session = createTestSession(coord);
      coord.completeSession(session.id);

      expect(() =>
        coord.handoff({
          sessionId: session.id,
          fromUserId: 'a',
          toUserId: 'b',
          reason: 'test',
          timestamp: Date.now(),
        })
      ).toThrow();
    });
  });

  // ── Cross-Session Analytics ───────────────────────────────────────────

  describe('getCrossSessionItems', () => {
    it('finds items appearing in multiple sessions', () => {
      const s1 = createTestSession(coord, { name: 'Count 1' });
      const s2 = createTestSession(coord, { name: 'Count 2' });
      coord.startSession(s1.id);
      coord.startSession(s2.id);

      coord.addItem(s1.id, 'SKU-001', 'Widget', 10);
      coord.addItem(s2.id, 'SKU-001', 'Widget', 12);

      const cross = coord.getCrossSessionItems();
      expect(cross.length).toBe(1);
      expect(cross[0].sku).toBe('SKU-001');
      expect(cross[0].sessions.length).toBe(2);
    });

    it('detects discrepancies', () => {
      const s1 = createTestSession(coord);
      const s2 = createTestSession(coord);
      coord.startSession(s1.id);
      coord.startSession(s2.id);

      coord.addItem(s1.id, 'SKU-001', 'Widget', 10);
      coord.addItem(s2.id, 'SKU-001', 'Widget', 20); // 100% variance

      const cross = coord.getCrossSessionItems();
      expect(cross[0].discrepancy).toBe(true);
      expect(cross[0].maxVariance).toBeGreaterThan(0.1);
    });

    it('filters by store', () => {
      const s1 = createTestSession(coord, { storeId: 'store-A', storeName: 'A' });
      const s2 = createTestSession(coord, { storeId: 'store-B', storeName: 'B' });
      coord.startSession(s1.id);
      coord.startSession(s2.id);

      coord.addItem(s1.id, 'SKU-001', 'Widget', 10);
      coord.addItem(s2.id, 'SKU-001', 'Widget', 10);

      const cross = coord.getCrossSessionItems('store-A');
      expect(cross.length).toBe(0); // Only 1 session per store
    });

    it('excludes cancelled sessions', () => {
      const s1 = createTestSession(coord);
      const s2 = createTestSession(coord);
      coord.startSession(s1.id);
      coord.startSession(s2.id);

      coord.addItem(s1.id, 'SKU-001', 'Widget', 10);
      coord.addItem(s2.id, 'SKU-001', 'Widget', 10);
      coord.cancelSession(s2.id, 'Wrong data');

      const cross = coord.getCrossSessionItems();
      expect(cross.length).toBe(0);
    });
  });

  // ── Aggregated Progress ───────────────────────────────────────────────

  describe('getAggregatedProgress', () => {
    it('aggregates progress across sessions', () => {
      const s1 = createTestSession(coord, {
        zones: [{ id: 'z1', name: 'A1' }],
      });
      const s2 = createTestSession(coord, {
        storeId: 'store-002',
        storeName: 'Store 2',
        zones: [
          { id: 'z2', name: 'B1' },
          { id: 'z3', name: 'B2' },
        ],
      });

      coord.startSession(s1.id);
      coord.startSession(s2.id);
      coord.addItem(s1.id, 'A', 'A', 5);
      coord.addItem(s2.id, 'B', 'B', 10);
      coord.completeZone(s1.id, 'z1');

      const progress = coord.getAggregatedProgress();
      expect(progress.totalSessions).toBe(2);
      expect(progress.activeSessions).toBe(2);
      expect(progress.totalItems).toBe(2);
      expect(progress.totalZones).toBe(3);
      expect(progress.completedZones).toBe(1);
      expect(progress.overallProgress).toBeCloseTo(33.33, 0);
      expect(progress.byStore.length).toBe(2);
    });

    it('handles empty state', () => {
      const progress = coord.getAggregatedProgress();
      expect(progress.totalSessions).toBe(0);
      expect(progress.overallProgress).toBe(0);
    });

    it('tracks priority distribution', () => {
      createTestSession(coord, { priority: 'critical' });
      createTestSession(coord, { priority: 'high' });
      createTestSession(coord, { priority: 'normal' });
      createTestSession(coord, { priority: 'normal' });

      const progress = coord.getAggregatedProgress();
      expect(progress.byPriority.critical).toBe(1);
      expect(progress.byPriority.high).toBe(1);
      expect(progress.byPriority.normal).toBe(2);
    });
  });

  // ── Session Queries ───────────────────────────────────────────────────

  describe('getSessions', () => {
    it('returns all sessions', () => {
      createTestSession(coord, { name: 'A' });
      createTestSession(coord, { name: 'B' });
      expect(coord.getSessions().length).toBe(2);
    });

    it('filters by status', () => {
      const s1 = createTestSession(coord);
      const s2 = createTestSession(coord);
      coord.startSession(s1.id);

      const active = coord.getSessions({ status: 'active' });
      expect(active.length).toBe(1);

      const pending = coord.getSessions({ status: 'pending' });
      expect(pending.length).toBe(1);
    });

    it('filters by multiple statuses', () => {
      const s1 = createTestSession(coord);
      const s2 = createTestSession(coord);
      coord.startSession(s1.id);

      const results = coord.getSessions({ status: ['active', 'pending'] });
      expect(results.length).toBe(2);
    });

    it('filters by storeId', () => {
      createTestSession(coord, { storeId: 'A' });
      createTestSession(coord, { storeId: 'B' });

      expect(coord.getSessions({ storeId: 'A' }).length).toBe(1);
    });

    it('filters by priority', () => {
      createTestSession(coord, { priority: 'critical' });
      createTestSession(coord, { priority: 'low' });

      expect(coord.getSessions({ priority: 'critical' }).length).toBe(1);
    });

    it('filters by member', () => {
      const s1 = createTestSession(coord);
      coord.addMember(s1.id, 'alice', 'Alice');
      createTestSession(coord);

      expect(coord.getSessions({ memberId: 'alice' }).length).toBe(1);
    });

    it('sorts by priority descending', () => {
      createTestSession(coord, { priority: 'low', name: 'Low' });
      createTestSession(coord, { priority: 'critical', name: 'Critical' });
      createTestSession(coord, { priority: 'high', name: 'High' });

      const sessions = coord.getSessions();
      expect(sessions[0].priority).toBe('critical');
      expect(sessions[1].priority).toBe('high');
      expect(sessions[2].priority).toBe('low');
    });
  });

  describe('getSession', () => {
    it('returns session by ID', () => {
      const session = createTestSession(coord);
      expect(coord.getSession(session.id)).toBe(session);
    });

    it('returns undefined for unknown ID', () => {
      expect(coord.getSession('nope')).toBeUndefined();
    });
  });

  describe('getActiveSessionCount', () => {
    it('counts active, pending, and paused sessions', () => {
      const s1 = createTestSession(coord); // pending
      const s2 = createTestSession(coord);
      coord.startSession(s2.id); // active
      const s3 = createTestSession(coord);
      coord.startSession(s3.id);
      coord.pauseSession(s3.id); // paused
      const s4 = createTestSession(coord);
      coord.completeSession(s4.id); // completed

      expect(coord.getActiveSessionCount()).toBe(3);
    });
  });

  // ── Session Splitting ─────────────────────────────────────────────────

  describe('splitByZones', () => {
    it('splits a session into child sessions', () => {
      const session = createTestSession(coord, {
        zones: [
          { id: 'z1', name: 'Aisle 1' },
          { id: 'z2', name: 'Aisle 2' },
          { id: 'z3', name: 'Aisle 3' },
        ],
      });

      const split = coord.splitByZones(session.id, [
        { name: 'Team A', zoneIds: ['z1', 'z2'] },
        { name: 'Team B', zoneIds: ['z3'] },
      ]);

      expect(split.newSessionIds.length).toBe(2);
      expect(session.childSessionIds.length).toBe(2);

      const childA = coord.getSession(split.newSessionIds[0])!;
      expect(childA.zones.length).toBe(2);
      expect(childA.parentSessionId).toBe(session.id);
    });

    it('copies items to child sessions', () => {
      const session = createTestSession(coord, {
        zones: [
          { id: 'z1', name: 'A1' },
          { id: 'z2', name: 'A2' },
        ],
      });
      coord.startSession(session.id);
      coord.addItem(session.id, 'SKU-1', 'Widget', 10);

      const split = coord.splitByZones(session.id, [
        { name: 'Split', zoneIds: ['z1'] },
      ]);

      const childItems = coord.getSessionItems(split.newSessionIds[0]);
      expect(childItems.has('SKU-1')).toBe(true);
    });

    it('throws for completed session', () => {
      const session = createTestSession(coord);
      coord.completeSession(session.id);
      expect(() =>
        coord.splitByZones(session.id, [{ name: 'X', zoneIds: [] }])
      ).toThrow();
    });
  });

  // ── Inactivity Management ─────────────────────────────────────────────

  describe('checkInactiveSessions', () => {
    it('auto-pauses inactive sessions', () => {
      const c = createCoordinator({ inactivityTimeoutMs: 100 });
      const session = createTestSession(c);
      c.startSession(session.id);

      // Simulate inactivity
      session.lastActivityAt = Date.now() - 200;

      const results = c.checkInactiveSessions();
      expect(results.length).toBe(1);
      expect(results[0].action).toBe('paused');
      expect(session.status).toBe('paused');
    });

    it('times out old sessions', () => {
      const c = createCoordinator({ sessionTimeoutMs: 100 });
      const session = createTestSession(c);
      c.startSession(session.id);

      // Simulate old session
      session.startedAt = Date.now() - 200;
      session.lastActivityAt = Date.now();

      const results = c.checkInactiveSessions();
      expect(results.length).toBe(1);
      expect(results[0].action).toBe('timed_out');
      expect(session.status).toBe('error');
    });

    it('does not affect paused or completed sessions', () => {
      const c = createCoordinator({ inactivityTimeoutMs: 100 });
      const s1 = createTestSession(c);
      c.startSession(s1.id);
      c.pauseSession(s1.id);
      s1.lastActivityAt = Date.now() - 200;

      const results = c.checkInactiveSessions();
      expect(results.length).toBe(0);
    });
  });

  // ── Voice Summaries ───────────────────────────────────────────────────

  describe('voice summaries', () => {
    it('generates session voice summary', () => {
      const session = createTestSession(coord, {
        zones: [{ id: 'z1', name: 'A1' }],
      });
      coord.startSession(session.id);
      coord.addItem(session.id, 'A', 'Widget', 10);

      const summary = coord.getSessionVoiceSummary(session.id);
      expect(summary).toContain('Test Inventory');
      expect(summary).toContain('Test Store');
      expect(summary).toContain('active');
      expect(summary).toContain('1 items counted');
    });

    it('generates overall voice summary', () => {
      const s1 = createTestSession(coord);
      const s2 = createTestSession(coord);
      coord.startSession(s1.id);
      coord.startSession(s2.id);

      const summary = coord.getOverallVoiceSummary();
      expect(summary).toContain('2 total sessions');
      expect(summary).toContain('2 active');
    });

    it('handles no sessions', () => {
      expect(coord.getOverallVoiceSummary()).toBe(
        'No inventory sessions in progress.'
      );
    });

    it('handles unknown session ID', () => {
      expect(coord.getSessionVoiceSummary('nope')).toBe('Session not found.');
    });
  });

  // ── Cleanup ───────────────────────────────────────────────────────────

  describe('pruneOldSessions', () => {
    it('removes old completed sessions', () => {
      const s1 = createTestSession(coord);
      coord.completeSession(s1.id);
      s1.completedAt = Date.now() - 200;

      const pruned = coord.pruneOldSessions(100);
      expect(pruned).toBe(1);
      expect(coord.getSession(s1.id)).toBeUndefined();
    });

    it('does not prune active sessions', () => {
      const s1 = createTestSession(coord);
      coord.startSession(s1.id);
      s1.createdAt = Date.now() - 200;

      expect(coord.pruneOldSessions(100)).toBe(0);
    });
  });

  describe('deleteSession', () => {
    it('deletes a session', () => {
      const session = createTestSession(coord);
      expect(coord.deleteSession(session.id)).toBe(true);
      expect(coord.getSession(session.id)).toBeUndefined();
    });

    it('returns false for unknown session', () => {
      expect(coord.deleteSession('nope')).toBe(false);
    });
  });

  describe('clearAll', () => {
    it('clears all data', () => {
      createTestSession(coord);
      createTestSession(coord);
      coord.clearAll();
      expect(coord.getSessions().length).toBe(0);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles session with no zones', () => {
      const session = createTestSession(coord);
      coord.startSession(session.id);
      coord.completeSession(session.id);
      expect(session.status).toBe('completed');
    });

    it('handles session with no members', () => {
      const session = createTestSession(coord);
      expect(coord.getActiveMembers(session.id)).toEqual([]);
    });

    it('handles multiple stores in aggregation', () => {
      for (let i = 0; i < 5; i++) {
        createTestSession(coord, {
          storeId: `store-${i}`,
          storeName: `Store ${i}`,
        });
      }

      const progress = coord.getAggregatedProgress();
      expect(progress.byStore.length).toBe(5);
    });
  });
});
