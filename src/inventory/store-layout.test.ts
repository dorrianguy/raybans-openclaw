/**
 * Tests for StoreLayoutMapper — Spatial tracking for inventory walkthroughs
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StoreLayoutMapper,
  DEFAULT_LAYOUT_CONFIG,
  type GeoPoint,
  type ZoneType,
} from './store-layout.js';

function makePoint(lat: number, lng: number, offsetMs = 0): GeoPoint {
  return {
    latitude: lat,
    longitude: lng,
    accuracy: 3,
    timestamp: new Date(Date.now() + offsetMs).toISOString(),
  };
}

describe('StoreLayoutMapper', () => {
  let mapper: StoreLayoutMapper;

  beforeEach(() => {
    mapper = new StoreLayoutMapper();
  });

  // ─── Layout Lifecycle ───────────────────────────────────────

  describe('Layout Lifecycle', () => {
    it('should create a layout', () => {
      const layout = mapper.createLayout('Test Store', '123 Main St');
      expect(layout.id).toBeDefined();
      expect(layout.storeName).toBe('Test Store');
      expect(layout.storeAddress).toBe('123 Main St');
      expect(layout.zones).toHaveLength(0);
      expect(layout.walkPath).toHaveLength(0);
      expect(layout.coveragePercent).toBe(0);
    });

    it('should set active layout on creation', () => {
      const layout = mapper.createLayout('Test');
      expect(mapper.getActiveLayout()?.id).toBe(layout.id);
    });

    it('should get layout by ID', () => {
      const layout = mapper.createLayout('Test');
      expect(mapper.getLayout(layout.id)).toBeDefined();
      expect(mapper.getLayout('nonexistent')).toBeUndefined();
    });

    it('should set active layout', () => {
      const l1 = mapper.createLayout('Store 1');
      const l2 = mapper.createLayout('Store 2');
      expect(mapper.getActiveLayout()?.id).toBe(l2.id);

      mapper.setActiveLayout(l1.id);
      expect(mapper.getActiveLayout()?.id).toBe(l1.id);
    });

    it('should throw when setting nonexistent layout as active', () => {
      expect(() => mapper.setActiveLayout('fake')).toThrow('not found');
    });

    it('should complete a layout', () => {
      const layout = mapper.createLayout('Test');
      mapper.addZone({ name: 'Zone 1', type: 'aisle' });
      mapper.markZoneComplete(mapper.getActiveLayout()!.zones[0].id);

      const completed = mapper.completeLayout();
      expect(completed.coveragePercent).toBe(100);
      expect(mapper.getActiveLayout()).toBeNull();
    });

    it('should emit coverage:complete when threshold met', () => {
      const spy = vi.fn();
      mapper.on('coverage:complete', spy);

      mapper.createLayout('Test');
      mapper.addZone({ name: 'Zone 1', type: 'aisle' });
      mapper.markZoneComplete(mapper.getActiveLayout()!.zones[0].id);
      mapper.completeLayout();

      expect(spy).toHaveBeenCalled();
    });

    it('should list layouts', () => {
      mapper.createLayout('Alpha Store');
      mapper.createLayout('Beta Store');
      mapper.createLayout('Alpha Mini');

      expect(mapper.listLayouts().length).toBe(3);
      expect(mapper.listLayouts('alpha').length).toBe(2);
    });

    it('should delete a layout', () => {
      const layout = mapper.createLayout('Delete Me');
      expect(mapper.deleteLayout(layout.id)).toBe(true);
      expect(mapper.getLayout(layout.id)).toBeUndefined();
      expect(mapper.getActiveLayout()).toBeNull();
    });

    it('should throw when completing without active layout', () => {
      expect(() => mapper.completeLayout()).toThrow('No active layout');
    });
  });

  // ─── Zone Management ────────────────────────────────────────

  describe('Zone Management', () => {
    beforeEach(() => {
      mapper.createLayout('Test Store');
    });

    it('should add a zone', () => {
      const zone = mapper.addZone({
        name: 'Aisle 1',
        type: 'aisle',
        description: 'First aisle - snacks',
        tags: ['food', 'snacks'],
      });
      expect(zone.id).toBeDefined();
      expect(zone.name).toBe('Aisle 1');
      expect(zone.type).toBe('aisle');
      expect(zone.coverage).toBe('not_visited');
      expect(zone.itemCount).toBe(0);
      expect(zone.tags).toContain('snacks');
    });

    it('should enforce max zones', () => {
      const smallMapper = new StoreLayoutMapper({ maxZones: 3 });
      smallMapper.createLayout('Small');
      smallMapper.addZone({ name: 'Z1', type: 'aisle' });
      smallMapper.addZone({ name: 'Z2', type: 'aisle' });
      smallMapper.addZone({ name: 'Z3', type: 'aisle' });
      expect(() => smallMapper.addZone({ name: 'Z4', type: 'aisle' })).toThrow('Maximum zones');
    });

    it('should prevent duplicate zone names in same scope', () => {
      mapper.addZone({ name: 'Beverages', type: 'aisle' });
      expect(() => mapper.addZone({ name: 'Beverages', type: 'aisle' })).toThrow('already exists');
    });

    it('should allow same name in different parent scopes', () => {
      const dept1 = mapper.addZone({ name: 'Dept 1', type: 'department' });
      const dept2 = mapper.addZone({ name: 'Dept 2', type: 'department' });
      // Same name "Shelf A" under different parents should work
      const s1 = mapper.addZone({ name: 'Shelf A', type: 'aisle', parentId: dept1.id });
      const s2 = mapper.addZone({ name: 'Shelf A', type: 'aisle', parentId: dept2.id });
      expect(s1.id).not.toBe(s2.id);
    });

    it('should get zone by ID', () => {
      const zone = mapper.addZone({ name: 'Test', type: 'aisle' });
      expect(mapper.getZone(zone.id)).toBeDefined();
      expect(mapper.getZone('fake')).toBeUndefined();
    });

    it('should get zones by type', () => {
      mapper.addZone({ name: 'Aisle 1', type: 'aisle' });
      mapper.addZone({ name: 'Checkout', type: 'checkout' });
      mapper.addZone({ name: 'Aisle 2', type: 'aisle' });
      expect(mapper.getZonesByType('aisle').length).toBe(2);
      expect(mapper.getZonesByType('checkout').length).toBe(1);
    });

    it('should get child zones', () => {
      const parent = mapper.addZone({ name: 'Produce', type: 'department' });
      mapper.addZone({ name: 'Fruits', type: 'aisle', parentId: parent.id });
      mapper.addZone({ name: 'Vegetables', type: 'aisle', parentId: parent.id });
      mapper.addZone({ name: 'Unrelated', type: 'aisle' });

      expect(mapper.getChildZones(parent.id).length).toBe(2);
    });

    it('should update a zone', () => {
      const zone = mapper.addZone({ name: 'Old Name', type: 'aisle' });
      const updated = mapper.updateZone(zone.id, {
        name: 'New Name',
        description: 'Updated description',
        estimatedTotalItems: 200,
        tags: ['updated'],
      });
      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('Updated description');
      expect(updated.estimatedTotalItems).toBe(200);
      expect(updated.tags).toContain('updated');
    });

    it('should throw when updating nonexistent zone', () => {
      expect(() => mapper.updateZone('fake', { name: 'x' })).toThrow('not found');
    });

    it('should remove a zone', () => {
      const zone = mapper.addZone({ name: 'Remove Me', type: 'aisle' });
      expect(mapper.removeZone(zone.id)).toBe(true);
      expect(mapper.getZone(zone.id)).toBeUndefined();
    });

    it('should return false when removing nonexistent zone', () => {
      expect(mapper.removeZone('fake')).toBe(false);
    });

    it('should remove child zones when parent removed', () => {
      const parent = mapper.addZone({ name: 'Parent', type: 'department' });
      mapper.addZone({ name: 'Child 1', type: 'aisle', parentId: parent.id });
      mapper.addZone({ name: 'Child 2', type: 'aisle', parentId: parent.id });

      mapper.removeZone(parent.id);
      expect(mapper.getActiveLayout()!.zones.length).toBe(0);
    });
  });

  // ─── Zone Entry/Exit ───────────────────────────────────────

  describe('Zone Entry/Exit', () => {
    beforeEach(() => {
      mapper.createLayout('Test Store');
    });

    it('should enter a zone', () => {
      const zone = mapper.addZone({ name: 'Aisle 1', type: 'aisle' });
      const entered = mapper.enterZone(zone.id);
      expect(entered.coverage).toBe('partial');
      expect(entered.firstVisitedAt).toBeDefined();
      expect(mapper.getCurrentZone()?.id).toBe(zone.id);
    });

    it('should emit zone:entered event', () => {
      const spy = vi.fn();
      mapper.on('zone:entered', spy);
      const zone = mapper.addZone({ name: 'Aisle 1', type: 'aisle' });
      mapper.enterZone(zone.id);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('should exit a zone and track time', async () => {
      const zone = mapper.addZone({ name: 'Aisle 1', type: 'aisle' });
      mapper.enterZone(zone.id);

      // Small delay to accumulate time
      await new Promise(r => setTimeout(r, 50));

      const exited = mapper.exitZone();
      expect(exited).toBeDefined();
      expect(exited!.timeSpentMs).toBeGreaterThanOrEqual(40);
      expect(mapper.getCurrentZone()).toBeNull();
    });

    it('should auto-exit previous zone when entering new one', () => {
      const spy = vi.fn();
      mapper.on('zone:exited', spy);

      const z1 = mapper.addZone({ name: 'Zone 1', type: 'aisle' });
      const z2 = mapper.addZone({ name: 'Zone 2', type: 'aisle' });

      mapper.enterZone(z1.id);
      mapper.enterZone(z2.id); // should auto-exit z1

      expect(spy).toHaveBeenCalledOnce();
      expect(mapper.getCurrentZone()?.id).toBe(z2.id);
    });

    it('should return null when exiting with no current zone', () => {
      expect(mapper.exitZone()).toBeNull();
    });

    it('should throw for nonexistent zone', () => {
      expect(() => mapper.enterZone('fake')).toThrow('not found');
    });

    it('should mark zone as complete', () => {
      const zone = mapper.addZone({ name: 'Zone', type: 'aisle' });
      const completed = mapper.markZoneComplete(zone.id);
      expect(completed.coverage).toBe('complete');
    });

    it('should emit zone:completed event', () => {
      const spy = vi.fn();
      mapper.on('zone:completed', spy);
      const zone = mapper.addZone({ name: 'Zone', type: 'aisle' });
      mapper.markZoneComplete(zone.id);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('should mark zone for recount', () => {
      const zone = mapper.addZone({ name: 'Zone', type: 'aisle' });
      mapper.markZoneComplete(zone.id);
      const marked = mapper.markZoneForRecount(zone.id);
      expect(marked.coverage).toBe('needs_recount');
    });

    it('should not keep firstVisitedAt on re-entry', () => {
      const zone = mapper.addZone({ name: 'Zone', type: 'aisle' });
      mapper.enterZone(zone.id);
      const firstVisit = mapper.getZone(zone.id)!.firstVisitedAt;
      mapper.exitZone();

      // Re-enter
      mapper.enterZone(zone.id);
      expect(mapper.getZone(zone.id)!.firstVisitedAt).toBe(firstVisit);
    });
  });

  // ─── Section Management ─────────────────────────────────────

  describe('Section Management', () => {
    let zoneId: string;

    beforeEach(() => {
      mapper.createLayout('Test Store');
      const zone = mapper.addZone({ name: 'Aisle 1', type: 'aisle' });
      zoneId = zone.id;
    });

    it('should add a section', () => {
      const section = mapper.addSection(zoneId, {
        name: 'Left Shelf',
        position: 'left',
        shelfLevel: 'eye',
        depth: 3,
      });
      expect(section.id).toBeDefined();
      expect(section.name).toBe('Left Shelf');
      expect(section.position).toBe('left');
      expect(section.shelfLevel).toBe('eye');
      expect(section.depth).toBe(3);
    });

    it('should enforce max sections per zone', () => {
      const smallMapper = new StoreLayoutMapper({ maxSectionsPerZone: 2 });
      smallMapper.createLayout('Small');
      const z = smallMapper.addZone({ name: 'Zone', type: 'aisle' });
      smallMapper.addSection(z.id, { name: 'S1' });
      smallMapper.addSection(z.id, { name: 'S2' });
      expect(() => smallMapper.addSection(z.id, { name: 'S3' })).toThrow('Maximum sections');
    });

    it('should record section count', () => {
      const section = mapper.addSection(zoneId, { name: 'Shelf' });
      const counted = mapper.recordSectionCount(zoneId, section.id, 25, 'img_123');
      expect(counted.itemCount).toBe(25);
      expect(counted.coverage).toBe('complete');
      expect(counted.imageIds).toContain('img_123');

      // Zone should have updated count
      const zone = mapper.getZone(zoneId)!;
      expect(zone.itemCount).toBe(25);
      expect(zone.imageCount).toBe(1);
    });

    it('should accumulate section counts', () => {
      const section = mapper.addSection(zoneId, { name: 'Shelf' });
      mapper.recordSectionCount(zoneId, section.id, 10);
      mapper.recordSectionCount(zoneId, section.id, 15);
      const zone = mapper.getZone(zoneId)!;
      expect(zone.itemCount).toBe(25);
    });

    it('should auto-complete zone when all sections complete', () => {
      const spy = vi.fn();
      mapper.on('zone:completed', spy);

      const s1 = mapper.addSection(zoneId, { name: 'Left' });
      const s2 = mapper.addSection(zoneId, { name: 'Right' });

      mapper.recordSectionCount(zoneId, s1.id, 10);
      expect(spy).not.toHaveBeenCalled();

      mapper.recordSectionCount(zoneId, s2.id, 15);
      expect(spy).toHaveBeenCalled();
      expect(mapper.getZone(zoneId)!.coverage).toBe('complete');
    });

    it('should emit section:counted event', () => {
      const spy = vi.fn();
      mapper.on('section:counted', spy);
      const section = mapper.addSection(zoneId, { name: 'Shelf' });
      mapper.recordSectionCount(zoneId, section.id, 10);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('should throw for nonexistent zone', () => {
      expect(() => mapper.addSection('fake', { name: 'x' })).toThrow('not found');
    });

    it('should throw for nonexistent section', () => {
      expect(() => mapper.recordSectionCount(zoneId, 'fake', 10)).toThrow('not found');
    });
  });

  // ─── Walk Path ──────────────────────────────────────────────

  describe('Walk Path', () => {
    beforeEach(() => {
      mapper.createLayout('Test Store');
    });

    it('should add waypoints', () => {
      const wp = mapper.addWaypoint({
        point: makePoint(44.9537, -93.0900),
        itemsVisible: 5,
      });
      expect(wp.id).toBeDefined();
      expect(wp.direction).toBe('stationary');
      expect(wp.itemsVisible).toBe(5);
    });

    it('should estimate direction from movement', () => {
      mapper.addWaypoint({ point: makePoint(44.9537, -93.0900) });
      const wp2 = mapper.addWaypoint({ point: makePoint(44.9540, -93.0900, 2000) }); // moved north
      expect(wp2.direction).toBe('north');
    });

    it('should estimate east/west direction', () => {
      mapper.addWaypoint({ point: makePoint(44.9537, -93.0900) });
      const wp2 = mapper.addWaypoint({ point: makePoint(44.9537, -93.0890, 2000) }); // moved east
      expect(wp2.direction).toBe('east');
    });

    it('should estimate speed', () => {
      mapper.addWaypoint({ point: makePoint(44.9537, -93.0900) });
      // Move ~111m north over 10 seconds
      const wp = mapper.addWaypoint({ point: makePoint(44.9547, -93.0900, 10000) });
      expect(wp.speed).toBeGreaterThan(0);
    });

    it('should trim old waypoints when limit exceeded', () => {
      const smallMapper = new StoreLayoutMapper({ maxWaypoints: 10 });
      smallMapper.createLayout('Test');

      for (let i = 0; i < 15; i++) {
        smallMapper.addWaypoint({ point: makePoint(44.95 + i * 0.001, -93.09, i * 1000) });
      }

      const path = smallMapper.getWalkPath();
      expect(path.length).toBeLessThanOrEqual(10);
    });

    it('should emit waypoint:added event', () => {
      const spy = vi.fn();
      mapper.on('waypoint:added', spy);
      mapper.addWaypoint({ point: makePoint(44.9537, -93.0900) });
      expect(spy).toHaveBeenCalledOnce();
    });

    it('should update layout bounds', () => {
      mapper.addWaypoint({ point: makePoint(44.95, -93.09) });
      mapper.addWaypoint({ point: makePoint(44.96, -93.08) });
      mapper.addWaypoint({ point: makePoint(44.94, -93.10) });

      const layout = mapper.getActiveLayout()!;
      expect(layout.bounds).toBeDefined();
      expect(layout.bounds!.northWest.latitude).toBe(44.96);
      expect(layout.bounds!.southEast.latitude).toBe(44.94);
    });

    it('should calculate distance walked', () => {
      mapper.addWaypoint({ point: makePoint(44.9537, -93.0900) });
      mapper.addWaypoint({ point: makePoint(44.9547, -93.0900, 5000) }); // ~111m north
      const distance = mapper.calculateDistanceWalked();
      expect(distance).toBeGreaterThan(100);
      expect(distance).toBeLessThan(200);
    });

    it('should return 0 distance with no waypoints', () => {
      expect(mapper.calculateDistanceWalked()).toBe(0);
    });

    it('should calculate time walked', () => {
      mapper.addWaypoint({ point: makePoint(44.95, -93.09) });
      mapper.addWaypoint({ point: makePoint(44.96, -93.09, 60000) }); // 60 seconds later
      const time = mapper.calculateTimeWalked();
      expect(time).toBeGreaterThanOrEqual(59000);
      expect(time).toBeLessThanOrEqual(61000);
    });

    it('should associate waypoint with current zone', () => {
      const zone = mapper.addZone({ name: 'Zone 1', type: 'aisle' });
      mapper.enterZone(zone.id);
      const wp = mapper.addWaypoint({ point: makePoint(44.95, -93.09) });
      expect(wp.zoneId).toBe(zone.id);
    });

    it('should return empty path for no layout', () => {
      const emptyMapper = new StoreLayoutMapper();
      expect(emptyMapper.getWalkPath()).toHaveLength(0);
    });
  });

  // ─── Coverage ───────────────────────────────────────────────

  describe('Coverage', () => {
    beforeEach(() => {
      mapper.createLayout('Test Store');
    });

    it('should calculate coverage summary', () => {
      mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.addZone({ name: 'Z2', type: 'aisle' });
      mapper.addZone({ name: 'Z3', type: 'aisle' });

      const z1 = mapper.getActiveLayout()!.zones[0];
      mapper.markZoneComplete(z1.id);

      const summary = mapper.getCoverageSummary();
      expect(summary.totalZones).toBe(3);
      expect(summary.completedZones).toBe(1);
      expect(summary.notVisitedZones).toBe(2);
    });

    it('should count partial coverage as 50%', () => {
      mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.addZone({ name: 'Z2', type: 'aisle' });

      const z1 = mapper.getActiveLayout()!.zones[0];
      mapper.enterZone(z1.id); // makes it partial

      const summary = mapper.getCoverageSummary();
      // 1 partial (50%) + 1 not_visited (0%) out of 2 = 25%
      expect(summary.coveragePercent).toBe(25);
    });

    it('should return empty summary without layout', () => {
      const emptyMapper = new StoreLayoutMapper();
      const summary = emptyMapper.getCoverageSummary();
      expect(summary.totalZones).toBe(0);
    });

    it('should get uncovered zones', () => {
      mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.addZone({ name: 'Z2', type: 'aisle' });
      mapper.addZone({ name: 'Z3', type: 'aisle' });

      const z1 = mapper.getActiveLayout()!.zones[0];
      mapper.markZoneComplete(z1.id);

      const uncovered = mapper.getUncoveredZones();
      expect(uncovered.length).toBe(2);
    });

    it('should include needs_recount in uncovered', () => {
      const zone = mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.markZoneComplete(zone.id);
      mapper.markZoneForRecount(zone.id);

      const uncovered = mapper.getUncoveredZones();
      expect(uncovered.length).toBe(1);
      expect(uncovered[0].coverage).toBe('needs_recount');
    });

    it('should emit coverage:updated event', () => {
      const spy = vi.fn();
      mapper.on('coverage:updated', spy);

      mapper.addZone({ name: 'Z1', type: 'aisle' });
      const z1 = mapper.getActiveLayout()!.zones[0];
      mapper.markZoneComplete(z1.id);

      expect(spy).toHaveBeenCalled();
    });
  });

  // ─── Route Optimization ─────────────────────────────────────

  describe('Route Optimization', () => {
    beforeEach(() => {
      mapper.createLayout('Test Store');
    });

    it('should suggest route through uncovered zones', () => {
      mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.addZone({ name: 'Z2', type: 'aisle' });
      mapper.addZone({ name: 'Z3', type: 'aisle' });

      const route = mapper.suggestRoute();
      expect(route.zones.length).toBe(3);
      expect(route.estimatedTimeMinutes).toBeGreaterThan(0);
    });

    it('should prioritize recount zones', () => {
      const z1 = mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.addZone({ name: 'Z2', type: 'aisle' });
      mapper.markZoneComplete(z1.id);
      mapper.markZoneForRecount(z1.id);

      const route = mapper.suggestRoute();
      expect(route.zones[0]).toBe(z1.id); // recount first
    });

    it('should return empty route when all covered', () => {
      const z1 = mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.markZoneComplete(z1.id);

      const route = mapper.suggestRoute();
      expect(route.zones.length).toBe(0);
      expect(route.reason).toContain('covered');
    });

    it('should emit route:recommended event', () => {
      const spy = vi.fn();
      mapper.on('route:recommended', spy);
      mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.suggestRoute();
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ─── Heat Map ───────────────────────────────────────────────

  describe('Heat Map', () => {
    it('should generate heatmap data', () => {
      mapper.createLayout('Test');
      const z1 = mapper.addZone({ name: 'Busy Aisle', type: 'aisle' });
      const z2 = mapper.addZone({ name: 'Quiet Aisle', type: 'aisle' });

      const s1 = mapper.addSection(z1.id, { name: 'Shelf 1' });
      mapper.recordSectionCount(z1.id, s1.id, 100, 'img1');

      const heatmap = mapper.generateHeatmap();
      expect(heatmap.length).toBe(2);

      const busy = heatmap.find(h => h.zoneName === 'Busy Aisle')!;
      expect(busy.itemCount).toBe(100);
      expect(busy.intensity).toBe(1); // highest

      const quiet = heatmap.find(h => h.zoneName === 'Quiet Aisle')!;
      expect(quiet.itemCount).toBe(0);
      expect(quiet.intensity).toBe(0);
    });

    it('should return empty heatmap without layout', () => {
      expect(mapper.generateHeatmap()).toHaveLength(0);
    });
  });

  // ─── Layout Comparison ──────────────────────────────────────

  describe('Layout Comparison', () => {
    it('should compare two layouts', () => {
      const l1 = mapper.createLayout('Store - January');
      mapper.addZone({ name: 'Aisle 1', type: 'aisle' });
      mapper.addZone({ name: 'Aisle 2', type: 'aisle' });
      const z1 = mapper.getActiveLayout()!.zones[0];
      const s1 = mapper.addSection(z1.id, { name: 'Shelf' });
      mapper.recordSectionCount(z1.id, s1.id, 50);

      const l2 = mapper.createLayout('Store - February');
      mapper.addZone({ name: 'Aisle 1', type: 'aisle' });
      mapper.addZone({ name: 'Aisle 3', type: 'aisle' }); // new zone
      const z1b = mapper.getActiveLayout()!.zones[0];
      const s1b = mapper.addSection(z1b.id, { name: 'Shelf' });
      mapper.recordSectionCount(z1b.id, s1b.id, 75);

      const comparison = mapper.compareLayouts(l1.id, l2.id);
      expect(comparison.newZones).toContain('Aisle 3');
      expect(comparison.removedZones).toContain('Aisle 2');
      expect(comparison.itemCountDiff).toBe(75 - 50);
      expect(comparison.changedZones.length).toBeGreaterThan(0);
    });

    it('should throw for nonexistent layouts', () => {
      mapper.createLayout('Test');
      expect(() => mapper.compareLayouts('fake1', 'fake2')).toThrow('not found');
    });
  });

  // ─── Voice Summary ─────────────────────────────────────────

  describe('Voice Summary', () => {
    it('should generate voice summary', () => {
      mapper.createLayout('Test');
      mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.addZone({ name: 'Z2', type: 'aisle' });

      const z1 = mapper.getActiveLayout()!.zones[0];
      mapper.markZoneComplete(z1.id);
      const s1 = mapper.addSection(z1.id, { name: 'S1' });
      mapper.recordSectionCount(z1.id, s1.id, 50);

      const summary = mapper.getVoiceSummary();
      expect(summary).toContain('1 of 2 zones complete');
      expect(summary).toContain('50 items');
      expect(summary).toContain('1 zone not yet visited');
    });

    it('should handle all zones complete', () => {
      mapper.createLayout('Test');
      const z = mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.markZoneComplete(z.id);
      const summary = mapper.getVoiceSummary();
      expect(summary).toContain('All 1 zones are complete');
    });

    it('should handle empty layout', () => {
      mapper.createLayout('Test');
      const summary = mapper.getVoiceSummary();
      expect(summary).toContain('No zones');
    });
  });

  // ─── Store Templates ───────────────────────────────────────

  describe('Store Templates', () => {
    beforeEach(() => {
      mapper.createLayout('Template Store');
    });

    it('should set up convenience store template', () => {
      const zones = mapper.setupFromTemplate('convenience_store');
      expect(zones.length).toBeGreaterThanOrEqual(10);
      expect(zones.some(z => z.name === 'Checkout Counter')).toBe(true);
      expect(zones.some(z => z.name === 'Beverages')).toBe(true);
      expect(zones.some(z => z.type === 'cold_storage')).toBe(true);
    });

    it('should set up grocery template', () => {
      const zones = mapper.setupFromTemplate('grocery');
      expect(zones.length).toBeGreaterThanOrEqual(15);
      expect(zones.some(z => z.name === 'Produce')).toBe(true);
      expect(zones.some(z => z.name === 'Bakery')).toBe(true);
    });

    it('should set up hardware template', () => {
      const zones = mapper.setupFromTemplate('hardware');
      expect(zones.some(z => z.name === 'Tools')).toBe(true);
      expect(zones.some(z => z.name === 'Lumber')).toBe(true);
    });

    it('should set up clothing template', () => {
      const zones = mapper.setupFromTemplate('clothing');
      expect(zones.some(z => z.name === "Women's")).toBe(true);
      expect(zones.some(z => z.name === 'Fitting Rooms')).toBe(true);
    });

    it('should set up warehouse template', () => {
      const zones = mapper.setupFromTemplate('warehouse');
      expect(zones.some(z => z.name === 'Receiving')).toBe(true);
      expect(zones.some(z => z.type === 'loading_dock')).toBe(true);
    });

    it('should throw for unknown template', () => {
      expect(() => mapper.setupFromTemplate('spaceship' as any)).toThrow('Unknown template');
    });
  });

  // ─── GPS Zone Detection ────────────────────────────────────

  describe('GPS Zone Detection', () => {
    it('should auto-detect zone from GPS boundaries', () => {
      mapper.createLayout('GPS Store');

      // Define a zone with GPS boundary (simple rectangle)
      mapper.addZone({
        name: 'Zone A',
        type: 'aisle',
        boundary: [
          makePoint(44.95, -93.09),
          makePoint(44.96, -93.09),
          makePoint(44.96, -93.08),
          makePoint(44.95, -93.08),
        ],
      });

      const spy = vi.fn();
      mapper.on('zone:entered', spy);

      // Walk into the zone
      mapper.addWaypoint({ point: makePoint(44.955, -93.085) });

      expect(spy).toHaveBeenCalled();
      expect(mapper.getCurrentZone()?.name).toBe('Zone A');
    });

    it('should not detect zone when outside boundaries', () => {
      mapper.createLayout('GPS Store');
      mapper.addZone({
        name: 'Zone A',
        type: 'aisle',
        boundary: [
          makePoint(44.95, -93.09),
          makePoint(44.96, -93.09),
          makePoint(44.96, -93.08),
          makePoint(44.95, -93.08),
        ],
      });

      const spy = vi.fn();
      mapper.on('zone:entered', spy);

      // Walk outside the zone
      mapper.addWaypoint({ point: makePoint(44.97, -93.07) });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle operations without active layout', () => {
      expect(() => mapper.addZone({ name: 'x', type: 'aisle' })).toThrow('No active layout');
      expect(() => mapper.addWaypoint({ point: makePoint(0, 0) })).toThrow('No active layout');
    });

    it('should handle default config', () => {
      const defaultMapper = new StoreLayoutMapper();
      expect(defaultMapper.getActiveLayout()).toBeNull();
    });

    it('should reset all data', () => {
      mapper.createLayout('Test');
      mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.reset();
      expect(mapper.getActiveLayout()).toBeNull();
      expect(mapper.listLayouts()).toHaveLength(0);
    });

    it('should handle multiple layouts independently', () => {
      const l1 = mapper.createLayout('Store 1');
      mapper.addZone({ name: 'Z1-A', type: 'aisle' });

      const l2 = mapper.createLayout('Store 2');
      mapper.addZone({ name: 'Z2-A', type: 'aisle' });

      expect(mapper.getLayout(l1.id)!.zones.length).toBe(1);
      expect(mapper.getLayout(l2.id)!.zones.length).toBe(1);
    });

    it('should clear current zone when active layout changes', () => {
      const l1 = mapper.createLayout('Store 1');
      const z = mapper.addZone({ name: 'Z1', type: 'aisle' });
      mapper.enterZone(z.id);

      mapper.deleteLayout(l1.id);
      expect(mapper.getCurrentZone()).toBeNull();
    });
  });
});
