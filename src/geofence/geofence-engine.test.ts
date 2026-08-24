/**
 * Tests for Geofence Engine
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GeofenceEngine,
  haversineDistance,
  pointInPolygon,
  isInsideFence,
  polygonCentroid,
  fenceCenter,
  isWithinSchedule,
  FENCE_TEMPLATES,
  DEFAULT_GEOFENCE_CONFIG,
} from './geofence-engine.js';
import type {
  GeoPoint,
  FenceGeometry,
  Geofence,
  FenceTransition,
  TimeWindow,
  GeofenceEngineConfig,
} from './geofence-engine.js';

// Test locations
const TIMES_SQUARE: GeoPoint = { lat: 40.758, lng: -73.9855 };
const EMPIRE_STATE: GeoPoint = { lat: 40.7484, lng: -73.9857 };
const CENTRAL_PARK: GeoPoint = { lat: 40.7829, lng: -73.9654 };
const STATUE_LIBERTY: GeoPoint = { lat: 40.6892, lng: -74.0445 };
const BROOKLYN_BRIDGE: GeoPoint = { lat: 40.7061, lng: -73.9969 };

// Helper: generate a square polygon around a point
function squareAround(center: GeoPoint, sizeMeters: number): GeoPoint[] {
  const delta = sizeMeters / 111320; // rough degree offset
  return [
    { lat: center.lat + delta, lng: center.lng - delta },
    { lat: center.lat + delta, lng: center.lng + delta },
    { lat: center.lat - delta, lng: center.lng + delta },
    { lat: center.lat - delta, lng: center.lng - delta },
  ];
}

describe('Utility Functions', () => {
  describe('haversineDistance', () => {
    it('calculates distance between two points', () => {
      const dist = haversineDistance(TIMES_SQUARE, EMPIRE_STATE);
      // Times Square to Empire State is ~1.1 km
      expect(dist).toBeGreaterThan(900);
      expect(dist).toBeLessThan(1300);
    });

    it('returns 0 for same point', () => {
      const dist = haversineDistance(TIMES_SQUARE, TIMES_SQUARE);
      expect(dist).toBe(0);
    });

    it('calculates long distances correctly', () => {
      const dist = haversineDistance(TIMES_SQUARE, STATUE_LIBERTY);
      // Times Square to Statue of Liberty is ~8.5 km
      expect(dist).toBeGreaterThan(5000);
      expect(dist).toBeLessThan(12000);
    });

    it('is symmetric', () => {
      const d1 = haversineDistance(TIMES_SQUARE, CENTRAL_PARK);
      const d2 = haversineDistance(CENTRAL_PARK, TIMES_SQUARE);
      expect(Math.abs(d1 - d2)).toBeLessThan(0.01);
    });
  });

  describe('pointInPolygon', () => {
    it('detects point inside a square', () => {
      const square = squareAround(TIMES_SQUARE, 100);
      expect(pointInPolygon(TIMES_SQUARE, square)).toBe(true);
    });

    it('detects point outside a square', () => {
      const square = squareAround(TIMES_SQUARE, 10);
      expect(pointInPolygon(CENTRAL_PARK, square)).toBe(false);
    });

    it('handles triangle', () => {
      const triangle: GeoPoint[] = [
        { lat: 40.76, lng: -73.99 },
        { lat: 40.75, lng: -73.98 },
        { lat: 40.76, lng: -73.98 },
      ];
      const inside: GeoPoint = { lat: 40.757, lng: -73.985 };
      expect(pointInPolygon(inside, triangle)).toBe(true);
    });

    it('returns false for fewer than 3 vertices', () => {
      expect(pointInPolygon(TIMES_SQUARE, [])).toBe(false);
      expect(pointInPolygon(TIMES_SQUARE, [{ lat: 0, lng: 0 }])).toBe(false);
      expect(pointInPolygon(TIMES_SQUARE, [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).toBe(false);
    });
  });

  describe('isInsideFence', () => {
    it('checks circle fence', () => {
      const geometry: FenceGeometry = {
        shape: 'circle',
        center: TIMES_SQUARE,
        radiusMeters: 2000,
      };
      expect(isInsideFence(EMPIRE_STATE, geometry)).toBe(true);
      expect(isInsideFence(STATUE_LIBERTY, geometry)).toBe(false);
    });

    it('checks polygon fence', () => {
      const geometry: FenceGeometry = {
        shape: 'polygon',
        vertices: squareAround(TIMES_SQUARE, 500),
      };
      expect(isInsideFence(TIMES_SQUARE, geometry)).toBe(true);
      expect(isInsideFence(CENTRAL_PARK, geometry)).toBe(false);
    });
  });

  describe('polygonCentroid', () => {
    it('calculates centroid of a square', () => {
      const square = squareAround(TIMES_SQUARE, 100);
      const centroid = polygonCentroid(square);
      expect(Math.abs(centroid.lat - TIMES_SQUARE.lat)).toBeLessThan(0.001);
      expect(Math.abs(centroid.lng - TIMES_SQUARE.lng)).toBeLessThan(0.001);
    });

    it('returns origin for empty array', () => {
      const c = polygonCentroid([]);
      expect(c.lat).toBe(0);
      expect(c.lng).toBe(0);
    });
  });

  describe('fenceCenter', () => {
    it('returns center for circle', () => {
      const c = fenceCenter({ shape: 'circle', center: TIMES_SQUARE, radiusMeters: 100 });
      expect(c).toEqual(TIMES_SQUARE);
    });

    it('returns centroid for polygon', () => {
      const vertices = squareAround(EMPIRE_STATE, 50);
      const c = fenceCenter({ shape: 'polygon', vertices });
      expect(Math.abs(c.lat - EMPIRE_STATE.lat)).toBeLessThan(0.001);
    });
  });

  describe('isWithinSchedule', () => {
    it('returns true for empty schedule (always active)', () => {
      expect(isWithinSchedule([])).toBe(true);
    });

    it('detects time within window', () => {
      const window: TimeWindow = { startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 };
      const noon = new Date('2026-08-23T12:00:00');
      expect(isWithinSchedule([window], noon)).toBe(true);
    });

    it('detects time outside window', () => {
      const window: TimeWindow = { startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 };
      const late = new Date('2026-08-23T20:00:00');
      expect(isWithinSchedule([window], late)).toBe(false);
    });

    it('handles overnight window', () => {
      const window: TimeWindow = { startHour: 22, startMinute: 0, endHour: 6, endMinute: 0 };
      const midnight = new Date('2026-08-23T00:30:00');
      expect(isWithinSchedule([window], midnight)).toBe(true);

      const afternoon = new Date('2026-08-23T14:00:00');
      expect(isWithinSchedule([window], afternoon)).toBe(false);
    });

    it('filters by day of week', () => {
      const window: TimeWindow = {
        startHour: 9, startMinute: 0, endHour: 17, endMinute: 0,
        daysOfWeek: [1, 2, 3, 4, 5], // weekdays only
      };
      // Aug 23, 2026 is a Sunday (day 0)
      const sunday = new Date('2026-08-23T12:00:00');
      expect(isWithinSchedule([window], sunday)).toBe(false);

      // Aug 24, 2026 is a Monday (day 1)
      const monday = new Date('2026-08-24T12:00:00');
      expect(isWithinSchedule([window], monday)).toBe(true);
    });

    it('matches any window in array', () => {
      const windows: TimeWindow[] = [
        { startHour: 6, startMinute: 0, endHour: 9, endMinute: 0 },
        { startHour: 17, startMinute: 0, endHour: 20, endMinute: 0 },
      ];
      const morning = new Date('2026-08-23T07:00:00');
      const midday = new Date('2026-08-23T12:00:00');
      const evening = new Date('2026-08-23T18:00:00');

      expect(isWithinSchedule(windows, morning)).toBe(true);
      expect(isWithinSchedule(windows, midday)).toBe(false);
      expect(isWithinSchedule(windows, evening)).toBe(true);
    });
  });
});

describe('GeofenceEngine', () => {
  let engine: GeofenceEngine;

  beforeEach(() => {
    engine = new GeofenceEngine({
      gpsSmoothing: false, // disable for predictable tests
      breadcrumbIntervalMs: 0, // always record
      defaultCooldownMs: 0, // no cooldown in tests
      defaultDwellTimeMs: 60000,
    });
  });

  afterEach(() => {
    engine.destroy();
  });

  describe('Fence CRUD', () => {
    it('creates a circle fence', () => {
      const fence = engine.createFence({
        name: 'Test Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 100 },
        category: 'store',
      });

      expect(fence.id).toBeTruthy();
      expect(fence.name).toBe('Test Store');
      expect(fence.category).toBe('store');
      expect(fence.enabled).toBe(true);
      expect(fence.geometry.shape).toBe('circle');
    });

    it('creates a polygon fence', () => {
      const vertices = squareAround(CENTRAL_PARK, 200);
      const fence = engine.createFence({
        name: 'Park Zone',
        geometry: { shape: 'polygon', vertices },
        category: 'custom',
      });

      expect(fence.geometry.shape).toBe('polygon');
      if (fence.geometry.shape === 'polygon') {
        expect(fence.geometry.vertices).toHaveLength(4);
      }
    });

    it('rejects polygon with fewer than 3 vertices', () => {
      expect(() =>
        engine.createFence({
          name: 'Bad',
          geometry: { shape: 'polygon', vertices: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] },
        })
      ).toThrow('at least 3 vertices');
    });

    it('rejects circle with non-positive radius', () => {
      expect(() =>
        engine.createFence({
          name: 'Bad',
          geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 0 },
        })
      ).toThrow('radius must be positive');
    });

    it('enforces max fences limit', () => {
      const engine2 = new GeofenceEngine({ maxFences: 2 });
      engine2.createFence({ name: 'A', geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 10 } });
      engine2.createFence({ name: 'B', geometry: { shape: 'circle', center: EMPIRE_STATE, radiusMeters: 10 } });
      expect(() =>
        engine2.createFence({ name: 'C', geometry: { shape: 'circle', center: CENTRAL_PARK, radiusMeters: 10 } })
      ).toThrow('Maximum fence limit');
      engine2.destroy();
    });

    it('updates a fence', () => {
      const fence = engine.createFence({
        name: 'Old Name',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 },
      });

      const updated = engine.updateFence(fence.id, { name: 'New Name', enabled: false });
      expect(updated.name).toBe('New Name');
      expect(updated.enabled).toBe(false);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(fence.createdAt);
    });

    it('update rejects invalid geometry', () => {
      const fence = engine.createFence({
        name: 'Test',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 },
      });

      expect(() =>
        engine.updateFence(fence.id, {
          geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: -5 },
        })
      ).toThrow('radius must be positive');
    });

    it('throws on updating non-existent fence', () => {
      expect(() => engine.updateFence('nonexistent', { name: 'X' })).toThrow('Fence not found');
    });

    it('deletes a fence', () => {
      const fence = engine.createFence({
        name: 'Deletable',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 },
      });

      expect(engine.deleteFence(fence.id)).toBe(true);
      expect(engine.getFence(fence.id)).toBeUndefined();
    });

    it('returns false when deleting non-existent fence', () => {
      expect(engine.deleteFence('nope')).toBe(false);
    });

    it('lists fences with filters', () => {
      engine.createFence({ name: 'Store 1', geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 }, category: 'store', tags: ['nyc'] });
      engine.createFence({ name: 'Office', geometry: { shape: 'circle', center: EMPIRE_STATE, radiusMeters: 30 }, category: 'office', enabled: false });
      engine.createFence({ name: 'Store 2', geometry: { shape: 'circle', center: CENTRAL_PARK, radiusMeters: 50 }, category: 'store', tags: ['nyc'] });

      expect(engine.listFences().length).toBe(3);
      expect(engine.listFences({ category: 'store' }).length).toBe(2);
      expect(engine.listFences({ enabled: true }).length).toBe(2);
      expect(engine.listFences({ tag: 'nyc' }).length).toBe(2);
    });

    it('lists fences near a point', () => {
      engine.createFence({ name: 'Near', geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 } });
      engine.createFence({ name: 'Far', geometry: { shape: 'circle', center: STATUE_LIBERTY, radiusMeters: 50 } });

      const near = engine.listFences({ nearPoint: EMPIRE_STATE, withinMeters: 2000 });
      expect(near.length).toBe(1);
      expect(near[0].name).toBe('Near');
    });

    it('emits events on CRUD', () => {
      const created = vi.fn();
      const updated = vi.fn();
      const deleted = vi.fn();

      engine.on('fence:created', created);
      engine.on('fence:updated', updated);
      engine.on('fence:deleted', deleted);

      const fence = engine.createFence({ name: 'Test', geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 } });
      expect(created).toHaveBeenCalledOnce();

      engine.updateFence(fence.id, { name: 'Updated' });
      expect(updated).toHaveBeenCalledOnce();

      engine.deleteFence(fence.id);
      expect(deleted).toHaveBeenCalledWith(fence.id);
    });
  });

  describe('Templates', () => {
    it('creates fence from template', () => {
      const fence = engine.createFenceFromTemplate('retail_store', TIMES_SQUARE, 'My Shop');
      expect(fence.name).toBe('My Shop');
      expect(fence.category).toBe('store');
      expect(fence.agentRules.length).toBeGreaterThan(0);
      if (fence.geometry.shape === 'circle') {
        expect(fence.geometry.radiusMeters).toBe(50);
      }
    });

    it('uses template name if no name provided', () => {
      const fence = engine.createFenceFromTemplate('warehouse', EMPIRE_STATE);
      expect(fence.name).toBe('Warehouse');
    });

    it('throws for unknown template', () => {
      expect(() => engine.createFenceFromTemplate('nonexistent', TIMES_SQUARE))
        .toThrow('Unknown template');
    });

    it('has all expected templates', () => {
      expect(Object.keys(FENCE_TEMPLATES)).toEqual(
        expect.arrayContaining(['retail_store', 'warehouse', 'office', 'client_site', 'competitor_store', 'event_venue', 'airport'])
      );
    });
  });

  describe('Groups', () => {
    it('creates and retrieves a group', () => {
      const group = engine.createGroup('NYC Stores', 'All New York stores', '#FF0000');
      expect(group.id).toBeTruthy();
      expect(group.name).toBe('NYC Stores');
      expect(group.color).toBe('#FF0000');

      expect(engine.getGroup(group.id)).toEqual(group);
    });

    it('associates fences with groups', () => {
      const group = engine.createGroup('My Group');
      const fence = engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 },
        groupId: group.id,
      });

      const updatedGroup = engine.getGroup(group.id);
      expect(updatedGroup?.fenceIds).toContain(fence.id);
    });

    it('lists groups', () => {
      engine.createGroup('Group A');
      engine.createGroup('Group B');
      expect(engine.listGroups().length).toBe(2);
    });

    it('deletes group and removes associations', () => {
      const group = engine.createGroup('Deletable');
      const fence = engine.createFence({
        name: 'In Group',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 },
        groupId: group.id,
      });

      engine.deleteGroup(group.id);
      expect(engine.getGroup(group.id)).toBeUndefined();

      const updatedFence = engine.getFence(fence.id);
      expect(updatedFence?.groupId).toBeUndefined();
    });

    it('returns false for deleting non-existent group', () => {
      expect(engine.deleteGroup('nope')).toBe(false);
    });

    it('filters fences by group', () => {
      const group = engine.createGroup('Group');
      engine.createFence({ name: 'In', geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 }, groupId: group.id });
      engine.createFence({ name: 'Out', geometry: { shape: 'circle', center: EMPIRE_STATE, radiusMeters: 50 } });

      expect(engine.listFences({ groupId: group.id }).length).toBe(1);
    });
  });

  describe('Location Updates & Transitions', () => {
    it('triggers enter event when entering a fence', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'inventory', voiceAnnouncement: 'Welcome to the store!' }],
      });

      const enterHandler = vi.fn();
      engine.on('fence:enter', enterHandler);

      // Start outside
      engine.updateLocation(CENTRAL_PARK);
      expect(enterHandler).not.toHaveBeenCalled();

      // Move inside
      const transitions = engine.updateLocation(TIMES_SQUARE);
      expect(transitions.length).toBe(1);
      expect(transitions[0].type).toBe('enter');
      expect(transitions[0].fenceName).toBe('Store');
      expect(transitions[0].triggeredAgents).toContain('inventory');
      expect(transitions[0].voiceAnnouncement).toBe('Welcome to the store!');
      expect(enterHandler).toHaveBeenCalledOnce();
    });

    it('triggers exit event when leaving a fence', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'inventory' }],
      });

      const exitHandler = vi.fn();
      engine.on('fence:exit', exitHandler);

      // Enter
      engine.updateLocation(TIMES_SQUARE);

      // Leave
      const transitions = engine.updateLocation(CENTRAL_PARK);
      expect(transitions.length).toBe(1);
      expect(transitions[0].type).toBe('exit');
      expect(transitions[0].dwellDurationMs).toBeGreaterThanOrEqual(0);
      expect(exitHandler).toHaveBeenCalledOnce();
    });

    it('does not trigger when moving within a fence', () => {
      engine.createFence({
        name: 'Big Zone',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 5000 },
        agentRules: [{ agentId: 'inventory' }],
      });

      const enterHandler = vi.fn();
      engine.on('fence:enter', enterHandler);

      // Enter
      engine.updateLocation(TIMES_SQUARE);
      expect(enterHandler).toHaveBeenCalledOnce();

      // Move within
      const transitions = engine.updateLocation(EMPIRE_STATE);
      expect(transitions.length).toBe(0);
      expect(enterHandler).toHaveBeenCalledOnce(); // still only once
    });

    it('handles multiple fences simultaneously', () => {
      engine.createFence({
        name: 'Big Zone',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 5000 },
        agentRules: [{ agentId: 'security' }],
      });
      engine.createFence({
        name: 'Small Zone',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 100 },
        agentRules: [{ agentId: 'inventory' }],
      });

      // Enter both at once
      const transitions = engine.updateLocation(TIMES_SQUARE);
      expect(transitions.length).toBe(2);

      const current = engine.getCurrentFences();
      expect(current.length).toBe(2);
    });

    it('skips disabled fences', () => {
      engine.createFence({
        name: 'Disabled',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        enabled: false,
      });

      const transitions = engine.updateLocation(TIMES_SQUARE);
      expect(transitions.length).toBe(0);
    });

    it('respects schedule windows', () => {
      engine.createFence({
        name: 'Business Hours Only',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        schedule: [{ startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }],
        agentRules: [{ agentId: 'inventory' }],
      });

      // Outside business hours
      const late = new Date('2026-08-23T20:00:00');
      const transitions1 = engine.updateLocation(TIMES_SQUARE, undefined, undefined, undefined, late);
      expect(transitions1.length).toBe(0);

      // During business hours
      const midday = new Date('2026-08-23T12:00:00');
      const transitions2 = engine.updateLocation(TIMES_SQUARE, undefined, undefined, undefined, midday);
      expect(transitions2.length).toBe(1);
    });

    it('filters by accuracy', () => {
      const engine2 = new GeofenceEngine({ minAccuracyMeters: 50, gpsSmoothing: false, defaultCooldownMs: 0, breadcrumbIntervalMs: 0 });
      engine2.createFence({
        name: 'Test',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'inventory' }],
      });

      // Poor accuracy — ignored
      const transitions = engine2.updateLocation(TIMES_SQUARE, 100);
      expect(transitions.length).toBe(0);

      // Good accuracy — processed
      const transitions2 = engine2.updateLocation(TIMES_SQUARE, 20);
      expect(transitions2.length).toBe(1);

      engine2.destroy();
    });

    it('respects cooldown between re-entries', () => {
      const engine2 = new GeofenceEngine({
        gpsSmoothing: false,
        breadcrumbIntervalMs: 0,
        defaultCooldownMs: 60000, // 1 minute cooldown
      });

      engine2.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'inventory' }],
      });

      // Enter
      engine2.updateLocation(TIMES_SQUARE);
      // Exit
      engine2.updateLocation(CENTRAL_PARK);

      // Try to re-enter immediately (within cooldown)
      const transitions = engine2.updateLocation(TIMES_SQUARE);
      expect(transitions.length).toBe(0);

      engine2.destroy();
    });

    it('only triggers onEnter agents on enter and onExit agents on exit', () => {
      engine.createFence({
        name: 'Test',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [
          { agentId: 'greeting', onEnter: true, onExit: false },
          { agentId: 'farewell', onEnter: false, onExit: true },
        ],
      });

      const enterTransitions = engine.updateLocation(TIMES_SQUARE);
      expect(enterTransitions[0].triggeredAgents).toContain('greeting');
      expect(enterTransitions[0].triggeredAgents).not.toContain('farewell');

      const exitTransitions = engine.updateLocation(CENTRAL_PARK);
      expect(exitTransitions[0].triggeredAgents).toContain('farewell');
      // onEnter defaults to true, so 'greeting' would be included in exit agents filter with onExit !== false
      // but we set greeting.onExit = false, so it should be excluded from exit
      // Actually, 'greeting' has onExit: false, so it should not appear
      // Let's verify the agent rule: exitRules filter where r.onExit !== false
      // greeting has onExit: false → excluded ✓
      // farewell has onExit: true → included ✓
    });
  });

  describe('Dwell Events', () => {
    it('triggers dwell event after configured time', async () => {
      vi.useFakeTimers();

      const engine2 = new GeofenceEngine({
        gpsSmoothing: false,
        breadcrumbIntervalMs: 0,
        defaultCooldownMs: 0,
        defaultDwellTimeMs: 5000,
      });

      engine2.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [
          { agentId: 'inventory', onDwell: true, voiceAnnouncement: 'You\'ve been here a while!' },
        ],
      });

      const dwellHandler = vi.fn();
      engine2.on('fence:dwell', dwellHandler);

      engine2.updateLocation(TIMES_SQUARE);
      expect(dwellHandler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5001);
      expect(dwellHandler).toHaveBeenCalledOnce();

      const transition = dwellHandler.mock.calls[0][0] as FenceTransition;
      expect(transition.type).toBe('dwell');
      expect(transition.triggeredAgents).toContain('inventory');

      engine2.destroy();
      vi.useRealTimers();
    });

    it('cancels dwell timer on exit', () => {
      vi.useFakeTimers();

      const engine2 = new GeofenceEngine({
        gpsSmoothing: false,
        breadcrumbIntervalMs: 0,
        defaultCooldownMs: 0,
        defaultDwellTimeMs: 10000,
      });

      engine2.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'inventory', onDwell: true }],
      });

      const dwellHandler = vi.fn();
      engine2.on('fence:dwell', dwellHandler);

      // Enter
      engine2.updateLocation(TIMES_SQUARE);
      // Exit before dwell time
      vi.advanceTimersByTime(3000);
      engine2.updateLocation(CENTRAL_PARK);

      // Advance past dwell time — should NOT fire
      vi.advanceTimersByTime(10000);
      expect(dwellHandler).not.toHaveBeenCalled();

      engine2.destroy();
      vi.useRealTimers();
    });
  });

  describe('GPS Smoothing', () => {
    it('smooths GPS jitter with rolling average', () => {
      const engine2 = new GeofenceEngine({
        gpsSmoothing: true,
        smoothingWindowSize: 3,
        breadcrumbIntervalMs: 0,
        defaultCooldownMs: 0,
      });

      engine2.createFence({
        name: 'Precise Zone',
        geometry: { shape: 'circle', center: { lat: 40.7580, lng: -73.9855 }, radiusMeters: 10 },
        agentRules: [{ agentId: 'test' }],
      });

      // First location — no smoothing yet (single point)
      engine2.updateLocation({ lat: 40.7580, lng: -73.9855 });

      // Second — starts smoothing
      engine2.updateLocation({ lat: 40.7581, lng: -73.9856 });

      const loc = engine2.getLastLocation();
      expect(loc).toBeTruthy();
      // Should be average of 2 points
      if (loc) {
        expect(loc.lat).toBeCloseTo(40.75805, 4);
      }

      engine2.destroy();
    });
  });

  describe('Breadcrumbs', () => {
    it('records breadcrumbs on location update', () => {
      engine.updateLocation(TIMES_SQUARE);
      engine.updateLocation(EMPIRE_STATE);

      const crumbs = engine.getBreadcrumbs();
      expect(crumbs.length).toBe(2);
      expect(crumbs[0].location).toEqual(TIMES_SQUARE);
    });

    it('associates fences with breadcrumbs', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
      });

      engine.updateLocation(TIMES_SQUARE);
      const crumbs = engine.getBreadcrumbs();
      expect(crumbs[0].fenceIds.length).toBe(1);
    });

    it('filters breadcrumbs by fence', () => {
      const fence = engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
      });

      engine.updateLocation(TIMES_SQUARE);
      engine.updateLocation(CENTRAL_PARK);

      const crumbs = engine.getBreadcrumbs({ fenceId: fence.id });
      expect(crumbs.length).toBe(1);
    });

    it('limits breadcrumb count', () => {
      const engine2 = new GeofenceEngine({
        maxBreadcrumbs: 3,
        gpsSmoothing: false,
        breadcrumbIntervalMs: 0,
        defaultCooldownMs: 0,
      });

      for (let i = 0; i < 5; i++) {
        engine2.updateLocation({ lat: 40 + i * 0.001, lng: -73 });
      }

      expect(engine2.getBreadcrumbs().length).toBe(3);
      engine2.destroy();
    });

    it('filters breadcrumbs by time', () => {
      engine.updateLocation(TIMES_SQUARE);
      const afterFirst = Date.now() + 1; // +1 to ensure strict after
      engine.updateLocation(EMPIRE_STATE);

      const crumbs = engine.getBreadcrumbs({ since: afterFirst });
      // Both may have same timestamp in fast execution; just verify filter works
      expect(crumbs.length).toBeLessThanOrEqual(1);
    });

    it('emits location:updated event', () => {
      const handler = vi.fn();
      engine.on('location:updated', handler);

      engine.updateLocation(TIMES_SQUARE);
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('Queries', () => {
    it('getCurrentFences returns active fences', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
      });

      expect(engine.getCurrentFences().length).toBe(0);
      engine.updateLocation(TIMES_SQUARE);
      expect(engine.getCurrentFences().length).toBe(1);
    });

    it('isInsideAnyFence works', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
      });

      expect(engine.isInsideAnyFence()).toBe(false);
      engine.updateLocation(TIMES_SQUARE);
      expect(engine.isInsideAnyFence()).toBe(true);
    });

    it('isInsideFence checks specific fence', () => {
      const fence = engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
      });

      expect(engine.isInsideFence(fence.id)).toBe(false);
      engine.updateLocation(TIMES_SQUARE);
      expect(engine.isInsideFence(fence.id)).toBe(true);
    });

    it('getTransitions returns history', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'test' }],
      });

      engine.updateLocation(TIMES_SQUARE); // enter
      engine.updateLocation(CENTRAL_PARK); // exit

      const all = engine.getTransitions();
      expect(all.length).toBe(2);
      // Both enter and exit should be present
      const types = all.map((t) => t.type);
      expect(types).toContain('enter');
      expect(types).toContain('exit');
    });

    it('filters transitions by type', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'test' }],
      });

      engine.updateLocation(TIMES_SQUARE);
      engine.updateLocation(CENTRAL_PARK);

      expect(engine.getTransitions({ type: 'enter' }).length).toBe(1);
      expect(engine.getTransitions({ type: 'exit' }).length).toBe(1);
    });

    it('limits transition results', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'test' }],
      });

      engine.updateLocation(TIMES_SQUARE);
      engine.updateLocation(CENTRAL_PARK);

      expect(engine.getTransitions({ limit: 1 }).length).toBe(1);
    });
  });

  describe('Distance / Proximity', () => {
    it('calculates distance to fence', () => {
      const fence = engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 100 },
      });

      engine.updateLocation(EMPIRE_STATE);
      const dist = engine.distanceToFence(fence.id);
      expect(dist).toBeTruthy();
      expect(dist!).toBeGreaterThan(800); // ~1.1km minus 100m radius
    });

    it('returns 0 when inside a circle fence', () => {
      const fence = engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 2000 },
      });

      engine.updateLocation(TIMES_SQUARE);
      const dist = engine.distanceToFence(fence.id);
      expect(dist).toBe(0);
    });

    it('returns null without location', () => {
      const fence = engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 100 },
      });
      expect(engine.distanceToFence(fence.id)).toBeNull();
    });

    it('returns null for non-existent fence', () => {
      engine.updateLocation(TIMES_SQUARE);
      expect(engine.distanceToFence('nope')).toBeNull();
    });

    it('finds nearest fences', () => {
      engine.createFence({ name: 'Near', geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 } });
      engine.createFence({ name: 'Far', geometry: { shape: 'circle', center: STATUE_LIBERTY, radiusMeters: 50 } });
      engine.createFence({ name: 'Mid', geometry: { shape: 'circle', center: EMPIRE_STATE, radiusMeters: 50 } });

      engine.updateLocation(TIMES_SQUARE);
      const nearest = engine.nearestFences(2);
      expect(nearest.length).toBe(2);
      expect(nearest[0].fence.name).toBe('Near');
      expect(nearest[0].distanceMeters).toBeLessThan(nearest[1].distanceMeters);
    });

    it('returns empty without location', () => {
      engine.createFence({ name: 'Test', geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 } });
      expect(engine.nearestFences()).toEqual([]);
    });
  });

  describe('Statistics', () => {
    it('tracks enter and exit counts', () => {
      const fence = engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'test' }],
      });

      engine.updateLocation(TIMES_SQUARE); // enter
      engine.updateLocation(CENTRAL_PARK); // exit

      const stats = engine.getFenceStats(fence.id);
      expect(stats).toBeTruthy();
      expect(stats!.totalEnters).toBe(1);
      expect(stats!.totalExits).toBe(1);
      expect(stats!.totalDwellTimeMs).toBeGreaterThanOrEqual(0);
      expect(stats!.lastEntered).toBeTruthy();
      expect(stats!.lastExited).toBeTruthy();
    });

    it('calculates average dwell time', () => {
      const fence = engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'test' }],
      });

      // Two visits
      engine.updateLocation(TIMES_SQUARE);
      engine.updateLocation(CENTRAL_PARK);
      engine.updateLocation(TIMES_SQUARE);
      engine.updateLocation(CENTRAL_PARK);

      const stats = engine.getFenceStats(fence.id);
      expect(stats!.totalExits).toBe(2);
      expect(stats!.averageDwellTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('getAllStats returns stats for all fences', () => {
      engine.createFence({ name: 'A', geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 } });
      engine.createFence({ name: 'B', geometry: { shape: 'circle', center: EMPIRE_STATE, radiusMeters: 50 } });

      const allStats = engine.getAllStats();
      expect(allStats.length).toBe(2);
    });

    it('getDwellTime returns current dwell time', () => {
      const fence = engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
      });

      engine.updateLocation(TIMES_SQUARE);
      const dwell = engine.getDwellTime(fence.id);
      expect(dwell).toBeGreaterThanOrEqual(0);
    });

    it('getDwellTime returns 0 when not inside', () => {
      const fence = engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
      });
      expect(engine.getDwellTime(fence.id)).toBe(0);
    });
  });

  describe('Voice Summary', () => {
    it('generates summary when no fences', () => {
      const summary = engine.generateVoiceSummary();
      expect(summary).toContain('No geofence activity');
    });

    it('generates summary when inside fences', () => {
      engine.createFence({
        name: 'Downtown Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'test' }],
      });

      engine.updateLocation(TIMES_SQUARE);
      const summary = engine.generateVoiceSummary();
      expect(summary).toContain('Downtown Store');
      expect(summary).toContain('Currently inside 1 zone');
    });

    it('includes transition history', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'test' }],
      });

      engine.updateLocation(TIMES_SQUARE);
      engine.updateLocation(CENTRAL_PARK);

      const summary = engine.generateVoiceSummary();
      expect(summary).toContain('Last activity');
      // Should mention either 'left' or 'entered' depending on sort order
      expect(summary).toMatch(/left|entered|settled/);
    });

    it('shows zone count', () => {
      engine.createFence({ name: 'A', geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 } });
      engine.createFence({ name: 'B', geometry: { shape: 'circle', center: EMPIRE_STATE, radiusMeters: 50 } });

      // Need a transition for the summary to include "Last activity"
      // Without a transition, it just shows "no geofence activity" + zone count
      const summary = engine.generateVoiceSummary();
      expect(summary).toContain('2 zone');
    });
  });

  describe('Import/Export', () => {
    it('exports and imports fences', () => {
      engine.createFence({ name: 'Store 1', geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 50 }, category: 'store' });
      engine.createFence({ name: 'Office', geometry: { shape: 'circle', center: EMPIRE_STATE, radiusMeters: 30 }, category: 'office' });

      const exported = engine.exportFences();
      expect(exported.length).toBe(2);

      // Import into new engine
      const engine2 = new GeofenceEngine();
      const imported = engine2.importFences(exported.map(({ id, createdAt, updatedAt, ...rest }) => rest));
      expect(imported.length).toBe(2);
      expect(engine2.listFences().length).toBe(2);
      engine2.destroy();
    });
  });

  describe('Cleanup', () => {
    it('clearHistory removes transitions and breadcrumbs', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'test' }],
      });

      engine.updateLocation(TIMES_SQUARE);
      engine.updateLocation(CENTRAL_PARK);

      engine.clearHistory();
      expect(engine.getTransitions().length).toBe(0);
      expect(engine.getBreadcrumbs().length).toBe(0);
    });

    it('reset clears everything', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
      });

      engine.updateLocation(TIMES_SQUARE);
      engine.reset();

      expect(engine.listFences().length).toBe(0);
      expect(engine.getCurrentFences().length).toBe(0);
      expect(engine.getTransitions().length).toBe(0);
      expect(engine.getBreadcrumbs().length).toBe(0);
      expect(engine.getLastLocation()).toBeNull();
    });

    it('delete fence cleans up active state', () => {
      const fence = engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
      });

      engine.updateLocation(TIMES_SQUARE);
      expect(engine.isInsideFence(fence.id)).toBe(true);

      engine.deleteFence(fence.id);
      expect(engine.isInsideFence(fence.id)).toBe(false);
      expect(engine.getCurrentFences().length).toBe(0);
    });
  });

  describe('Polygon Fences', () => {
    it('detects enter/exit for polygon fence', () => {
      const vertices = squareAround(TIMES_SQUARE, 200);
      engine.createFence({
        name: 'Square Zone',
        geometry: { shape: 'polygon', vertices },
        agentRules: [{ agentId: 'test' }],
      });

      const enterTransitions = engine.updateLocation(TIMES_SQUARE);
      expect(enterTransitions.length).toBe(1);
      expect(enterTransitions[0].type).toBe('enter');

      const exitTransitions = engine.updateLocation(CENTRAL_PARK);
      expect(exitTransitions.length).toBe(1);
      expect(exitTransitions[0].type).toBe('exit');
    });
  });

  describe('Edge Cases', () => {
    it('handles rapid location updates gracefully', () => {
      engine.createFence({
        name: 'Store',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [{ agentId: 'test' }],
      });

      // Rapid fire
      for (let i = 0; i < 100; i++) {
        const inside = i % 2 === 0;
        engine.updateLocation(inside ? TIMES_SQUARE : CENTRAL_PARK);
      }

      // Should still be in a consistent state
      expect(engine.listFences().length).toBe(1);
    });

    it('handles fence with no agent rules', () => {
      engine.createFence({
        name: 'Silent Zone',
        geometry: { shape: 'circle', center: TIMES_SQUARE, radiusMeters: 200 },
        agentRules: [],
      });

      const transitions = engine.updateLocation(TIMES_SQUARE);
      expect(transitions.length).toBe(1);
      expect(transitions[0].triggeredAgents.length).toBe(0);
    });

    it('default config has sensible values', () => {
      expect(DEFAULT_GEOFENCE_CONFIG.maxFences).toBe(500);
      expect(DEFAULT_GEOFENCE_CONFIG.maxBreadcrumbs).toBe(10000);
      expect(DEFAULT_GEOFENCE_CONFIG.defaultDwellTimeMs).toBe(60000);
    });
  });
});
