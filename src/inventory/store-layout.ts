/**
 * Store Layout Mapper — Spatial tracking for inventory walkthroughs
 *
 * Maps the physical structure of a store during inventory sessions:
 * - Zone/department/aisle/section/shelf hierarchy
 * - GPS correlation and waypoint tracking
 * - Coverage tracking (what's been counted vs. missed)
 * - Optimal route suggestion
 * - Layout persistence and comparison between visits
 * - Heat maps of item density and value
 * - Walk path reconstruction
 *
 * @module inventory/store-layout
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export type ZoneType =
  | 'entrance'
  | 'checkout'
  | 'department'
  | 'aisle'
  | 'endcap'
  | 'display'
  | 'backroom'
  | 'cold_storage'
  | 'loading_dock'
  | 'office'
  | 'restroom'
  | 'custom';

export type CoverageStatus = 'not_visited' | 'partial' | 'complete' | 'needs_recount';

export type MovementDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down' | 'stationary';

export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  timestamp: string;
}

export interface StoreLayout {
  id: string;
  storeName: string;
  storeAddress?: string;
  /** Bounding box of the store (GPS corners) */
  bounds?: {
    northWest: GeoPoint;
    southEast: GeoPoint;
  };
  zones: Zone[];
  /** Walk path from this layout session */
  walkPath: Waypoint[];
  createdAt: string;
  updatedAt: string;
  /** Total area coverage percentage */
  coveragePercent: number;
  metadata: Record<string, string>;
}

export interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  /** Parent zone ID for hierarchy (aisle inside department) */
  parentId?: string;
  /** Physical description */
  description?: string;
  /** GPS boundaries for this zone */
  boundary?: GeoPoint[];
  /** Sections within this zone (e.g., shelves within an aisle) */
  sections: Section[];
  /** Coverage status */
  coverage: CoverageStatus;
  /** Items counted in this zone */
  itemCount: number;
  /** Estimated total items (for coverage calculation) */
  estimatedTotalItems?: number;
  /** Time spent in this zone (ms) */
  timeSpentMs: number;
  /** When this zone was first visited */
  firstVisitedAt?: string;
  /** When this zone was last visited */
  lastVisitedAt?: string;
  /** Number of images captured in this zone */
  imageCount: number;
  /** Sort order for display */
  sortOrder: number;
  /** Tags for categorization */
  tags: string[];
}

export interface Section {
  id: string;
  name: string;
  /** Position within the zone (left, center, right, top, bottom) */
  position: string;
  /** Shelf levels (top, eye, waist, bottom) */
  shelfLevel?: string;
  /** Items in this section */
  itemCount: number;
  /** Coverage */
  coverage: CoverageStatus;
  /** Depth of products (rows deep) */
  depth?: number;
  /** Image IDs associated with this section */
  imageIds: string[];
}

export interface Waypoint {
  id: string;
  point: GeoPoint;
  /** Movement direction at this point */
  direction: MovementDirection;
  /** Speed in m/s (estimated from GPS changes) */
  speed: number;
  /** Current zone at this point */
  zoneId?: string;
  /** Items visible from this point */
  itemsVisible: number;
  /** Image captured at this point */
  imageId?: string;
  /** Voice annotation at this point */
  annotation?: string;
}

export interface LayoutComparison {
  previousLayoutId: string;
  currentLayoutId: string;
  newZones: string[];
  removedZones: string[];
  changedZones: { zoneId: string; changes: string[] }[];
  coverageDiff: number;
  itemCountDiff: number;
  timeDiffMs: number;
}

export interface HeatmapCell {
  zoneId: string;
  zoneName: string;
  itemCount: number;
  itemDensity: number; // items per image
  estimatedValue: number; // dollars
  timeSpent: number; // ms
  coverage: CoverageStatus;
  intensity: number; // 0-1 for visualization
}

export interface RouteRecommendation {
  zones: string[];
  estimatedTimeMinutes: number;
  estimatedItems: number;
  reason: string;
}

export interface StoreLayoutConfig {
  /** Maximum zones per layout */
  maxZones: number;
  /** Maximum sections per zone */
  maxSectionsPerZone: number;
  /** Maximum waypoints stored */
  maxWaypoints: number;
  /** GPS distance threshold for zone detection (meters) */
  zoneDetectionRadiusMeters: number;
  /** Minimum time in zone before counting as visited (ms) */
  minZoneVisitTimeMs: number;
  /** Auto-complete coverage after this % of sections counted */
  autoCompleteThreshold: number;
  /** GPS sample rate for walk path (ms) */
  walkPathSampleRateMs: number;
  /** Enable route optimization */
  enableRouteOptimization: boolean;
}

export interface StoreLayoutEvents {
  'zone:entered': (zone: Zone) => void;
  'zone:exited': (zone: Zone, timeSpent: number) => void;
  'zone:completed': (zone: Zone) => void;
  'section:counted': (section: Section, zone: Zone) => void;
  'coverage:updated': (coveragePercent: number) => void;
  'coverage:complete': (layout: StoreLayout) => void;
  'waypoint:added': (waypoint: Waypoint) => void;
  'route:recommended': (recommendation: RouteRecommendation) => void;
  'layout:saved': (layout: StoreLayout) => void;
}

// ─── Default Config ─────────────────────────────────────────────

export const DEFAULT_LAYOUT_CONFIG: StoreLayoutConfig = {
  maxZones: 200,
  maxSectionsPerZone: 50,
  maxWaypoints: 5000,
  zoneDetectionRadiusMeters: 5,
  minZoneVisitTimeMs: 5000,
  autoCompleteThreshold: 0.9,
  walkPathSampleRateMs: 2000,
  enableRouteOptimization: true,
};

// ─── Store Layout Mapper ────────────────────────────────────────

export class StoreLayoutMapper extends EventEmitter {
  private config: StoreLayoutConfig;
  private layouts: Map<string, StoreLayout> = new Map();
  private activeLayoutId: string | null = null;
  private currentZoneId: string | null = null;
  private zoneEntryTime: number = 0;
  private idCounter = 0;

  constructor(config: Partial<StoreLayoutConfig> = {}) {
    super();
    this.config = { ...DEFAULT_LAYOUT_CONFIG, ...config };
  }

  // ─── Layout Lifecycle ───────────────────────────────────────

  /** Create a new store layout session */
  createLayout(storeName: string, storeAddress?: string): StoreLayout {
    const id = `layout_${++this.idCounter}_${Date.now()}`;
    const now = new Date().toISOString();

    const layout: StoreLayout = {
      id,
      storeName,
      storeAddress,
      zones: [],
      walkPath: [],
      createdAt: now,
      updatedAt: now,
      coveragePercent: 0,
      metadata: {},
    };

    this.layouts.set(id, layout);
    this.activeLayoutId = id;
    return layout;
  }

  /** Get the currently active layout */
  getActiveLayout(): StoreLayout | null {
    if (!this.activeLayoutId) return null;
    return this.layouts.get(this.activeLayoutId) || null;
  }

  /** Get a layout by ID */
  getLayout(layoutId: string): StoreLayout | undefined {
    return this.layouts.get(layoutId);
  }

  /** Set the active layout */
  setActiveLayout(layoutId: string): void {
    if (!this.layouts.has(layoutId)) {
      throw new Error(`Layout not found: ${layoutId}`);
    }
    this.activeLayoutId = layoutId;
  }

  /** Complete and save the current layout */
  completeLayout(layoutId?: string): StoreLayout {
    const id = layoutId || this.activeLayoutId;
    if (!id) throw new Error('No active layout');

    const layout = this.layouts.get(id);
    if (!layout) throw new Error(`Layout not found: ${id}`);

    // Finalize zone coverage
    this._recalculateCoverage(layout);
    layout.updatedAt = new Date().toISOString();

    if (layout.coveragePercent >= this.config.autoCompleteThreshold * 100) {
      this.emit('coverage:complete', layout);
    }

    this.emit('layout:saved', layout);

    if (this.activeLayoutId === id) {
      this.activeLayoutId = null;
      this.currentZoneId = null;
    }

    return layout;
  }

  /** List all layouts (optionally filtered by store name) */
  listLayouts(storeName?: string): StoreLayout[] {
    let layouts = Array.from(this.layouts.values());
    if (storeName) {
      const lower = storeName.toLowerCase();
      layouts = layouts.filter(l => l.storeName.toLowerCase().includes(lower));
    }
    return layouts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Delete a layout */
  deleteLayout(layoutId: string): boolean {
    if (this.activeLayoutId === layoutId) {
      this.activeLayoutId = null;
      this.currentZoneId = null;
    }
    return this.layouts.delete(layoutId);
  }

  // ─── Zone Management ────────────────────────────────────────

  /** Add a zone to the active layout */
  addZone(params: {
    name: string;
    type: ZoneType;
    parentId?: string;
    description?: string;
    boundary?: GeoPoint[];
    estimatedTotalItems?: number;
    tags?: string[];
  }): Zone {
    const layout = this._requireActiveLayout();

    if (layout.zones.length >= this.config.maxZones) {
      throw new Error(`Maximum zones (${this.config.maxZones}) reached`);
    }

    // Check for duplicate names within same parent
    const exists = layout.zones.find(
      z => z.name.toLowerCase() === params.name.toLowerCase() && z.parentId === params.parentId
    );
    if (exists) {
      throw new Error(`Zone "${params.name}" already exists in this scope`);
    }

    const zone: Zone = {
      id: `zone_${++this.idCounter}_${Date.now()}`,
      name: params.name,
      type: params.type,
      parentId: params.parentId,
      description: params.description,
      boundary: params.boundary,
      sections: [],
      coverage: 'not_visited',
      itemCount: 0,
      estimatedTotalItems: params.estimatedTotalItems,
      timeSpentMs: 0,
      imageCount: 0,
      sortOrder: layout.zones.length,
      tags: params.tags || [],
    };

    layout.zones.push(zone);
    layout.updatedAt = new Date().toISOString();

    return zone;
  }

  /** Get a zone by ID from the active layout */
  getZone(zoneId: string): Zone | undefined {
    const layout = this._requireActiveLayout();
    return layout.zones.find(z => z.id === zoneId);
  }

  /** Get zones by type */
  getZonesByType(type: ZoneType): Zone[] {
    const layout = this._requireActiveLayout();
    return layout.zones.filter(z => z.type === type);
  }

  /** Get child zones of a parent */
  getChildZones(parentId: string): Zone[] {
    const layout = this._requireActiveLayout();
    return layout.zones.filter(z => z.parentId === parentId);
  }

  /** Update a zone */
  updateZone(zoneId: string, updates: Partial<Pick<Zone, 'name' | 'description' | 'type' | 'estimatedTotalItems' | 'tags'>>): Zone {
    const layout = this._requireActiveLayout();
    const zone = layout.zones.find(z => z.id === zoneId);
    if (!zone) throw new Error(`Zone not found: ${zoneId}`);

    if (updates.name !== undefined) zone.name = updates.name;
    if (updates.description !== undefined) zone.description = updates.description;
    if (updates.type !== undefined) zone.type = updates.type;
    if (updates.estimatedTotalItems !== undefined) zone.estimatedTotalItems = updates.estimatedTotalItems;
    if (updates.tags !== undefined) zone.tags = updates.tags;

    layout.updatedAt = new Date().toISOString();
    return zone;
  }

  /** Remove a zone */
  removeZone(zoneId: string): boolean {
    const layout = this._requireActiveLayout();
    const idx = layout.zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return false;

    // Also remove child zones
    const childIds = layout.zones.filter(z => z.parentId === zoneId).map(z => z.id);
    layout.zones = layout.zones.filter(z => z.id !== zoneId && z.parentId !== zoneId);

    if (this.currentZoneId === zoneId) {
      this.currentZoneId = null;
    }

    layout.updatedAt = new Date().toISOString();
    this._recalculateCoverage(layout);
    return true;
  }

  /** Enter a zone (start tracking time) */
  enterZone(zoneId: string): Zone {
    const layout = this._requireActiveLayout();
    const zone = layout.zones.find(z => z.id === zoneId);
    if (!zone) throw new Error(`Zone not found: ${zoneId}`);

    // Exit previous zone if any
    if (this.currentZoneId && this.currentZoneId !== zoneId) {
      this.exitZone();
    }

    this.currentZoneId = zoneId;
    this.zoneEntryTime = Date.now();

    if (!zone.firstVisitedAt) {
      zone.firstVisitedAt = new Date().toISOString();
    }
    zone.lastVisitedAt = new Date().toISOString();

    if (zone.coverage === 'not_visited') {
      zone.coverage = 'partial';
      this._recalculateCoverage(layout);
    }

    this.emit('zone:entered', zone);
    return zone;
  }

  /** Exit the current zone */
  exitZone(): Zone | null {
    if (!this.currentZoneId) return null;

    const layout = this._requireActiveLayout();
    const zone = layout.zones.find(z => z.id === this.currentZoneId);
    if (!zone) {
      this.currentZoneId = null;
      return null;
    }

    const timeSpent = Date.now() - this.zoneEntryTime;
    zone.timeSpentMs += timeSpent;
    zone.lastVisitedAt = new Date().toISOString();

    this.emit('zone:exited', zone, timeSpent);
    this.currentZoneId = null;
    return zone;
  }

  /** Get the current zone */
  getCurrentZone(): Zone | null {
    if (!this.currentZoneId) return null;
    const layout = this.getActiveLayout();
    if (!layout) return null;
    return layout.zones.find(z => z.id === this.currentZoneId) || null;
  }

  /** Mark a zone as complete */
  markZoneComplete(zoneId: string): Zone {
    const layout = this._requireActiveLayout();
    const zone = layout.zones.find(z => z.id === zoneId);
    if (!zone) throw new Error(`Zone not found: ${zoneId}`);

    zone.coverage = 'complete';
    layout.updatedAt = new Date().toISOString();
    this._recalculateCoverage(layout);

    this.emit('zone:completed', zone);
    return zone;
  }

  /** Mark a zone as needing recount */
  markZoneForRecount(zoneId: string): Zone {
    const layout = this._requireActiveLayout();
    const zone = layout.zones.find(z => z.id === zoneId);
    if (!zone) throw new Error(`Zone not found: ${zoneId}`);

    zone.coverage = 'needs_recount';
    layout.updatedAt = new Date().toISOString();
    this._recalculateCoverage(layout);
    return zone;
  }

  // ─── Section Management ─────────────────────────────────────

  /** Add a section to a zone */
  addSection(zoneId: string, params: {
    name: string;
    position?: string;
    shelfLevel?: string;
    depth?: number;
  }): Section {
    const layout = this._requireActiveLayout();
    const zone = layout.zones.find(z => z.id === zoneId);
    if (!zone) throw new Error(`Zone not found: ${zoneId}`);

    if (zone.sections.length >= this.config.maxSectionsPerZone) {
      throw new Error(`Maximum sections (${this.config.maxSectionsPerZone}) reached for zone "${zone.name}"`);
    }

    const section: Section = {
      id: `sec_${++this.idCounter}_${Date.now()}`,
      name: params.name,
      position: params.position || 'center',
      shelfLevel: params.shelfLevel,
      itemCount: 0,
      coverage: 'not_visited',
      depth: params.depth,
      imageIds: [],
    };

    zone.sections.push(section);
    layout.updatedAt = new Date().toISOString();
    return section;
  }

  /** Record items counted in a section */
  recordSectionCount(zoneId: string, sectionId: string, itemCount: number, imageId?: string): Section {
    const layout = this._requireActiveLayout();
    const zone = layout.zones.find(z => z.id === zoneId);
    if (!zone) throw new Error(`Zone not found: ${zoneId}`);

    const section = zone.sections.find(s => s.id === sectionId);
    if (!section) throw new Error(`Section not found: ${sectionId}`);

    section.itemCount += itemCount;
    section.coverage = 'complete';
    if (imageId) {
      section.imageIds.push(imageId);
    }

    // Update zone counts
    zone.itemCount = zone.sections.reduce((sum, s) => sum + s.itemCount, 0);
    zone.imageCount = zone.sections.reduce((sum, s) => sum + s.imageIds.length, 0);

    // Check if all sections complete → zone complete
    const allSectionsComplete = zone.sections.length > 0 &&
      zone.sections.every(s => s.coverage === 'complete');
    if (allSectionsComplete) {
      zone.coverage = 'complete';
      this.emit('zone:completed', zone);
    } else if (zone.coverage === 'not_visited') {
      zone.coverage = 'partial';
    }

    layout.updatedAt = new Date().toISOString();
    this._recalculateCoverage(layout);

    this.emit('section:counted', section, zone);
    return section;
  }

  // ─── Walk Path ──────────────────────────────────────────────

  /** Add a waypoint to the walk path */
  addWaypoint(params: {
    point: GeoPoint;
    direction?: MovementDirection;
    speed?: number;
    imageId?: string;
    annotation?: string;
    itemsVisible?: number;
  }): Waypoint {
    const layout = this._requireActiveLayout();

    if (layout.walkPath.length >= this.config.maxWaypoints) {
      // Remove oldest waypoints (keep recent)
      layout.walkPath = layout.walkPath.slice(-Math.floor(this.config.maxWaypoints * 0.75));
    }

    const waypoint: Waypoint = {
      id: `wp_${++this.idCounter}_${Date.now()}`,
      point: params.point,
      direction: params.direction || this._estimateDirection(layout.walkPath, params.point),
      speed: params.speed || this._estimateSpeed(layout.walkPath, params.point),
      zoneId: this.currentZoneId || undefined,
      itemsVisible: params.itemsVisible || 0,
      imageId: params.imageId,
      annotation: params.annotation,
    };

    layout.walkPath.push(waypoint);
    layout.updatedAt = new Date().toISOString();

    // Auto-detect zone from GPS if boundaries exist
    if (!this.currentZoneId) {
      const detectedZone = this._detectZoneFromGPS(layout, params.point);
      if (detectedZone) {
        this.enterZone(detectedZone.id);
        waypoint.zoneId = detectedZone.id;
      }
    }

    this.emit('waypoint:added', waypoint);

    // Update layout bounds
    this._updateBounds(layout, params.point);

    return waypoint;
  }

  /** Get the walk path for a layout */
  getWalkPath(layoutId?: string): Waypoint[] {
    const id = layoutId || this.activeLayoutId;
    if (!id) return [];
    const layout = this.layouts.get(id);
    return layout?.walkPath || [];
  }

  /** Calculate total distance walked (meters) */
  calculateDistanceWalked(layoutId?: string): number {
    const path = this.getWalkPath(layoutId);
    if (path.length < 2) return 0;

    let totalDistance = 0;
    for (let i = 1; i < path.length; i++) {
      totalDistance += this._haversineDistance(
        path[i - 1].point,
        path[i].point
      );
    }
    return totalDistance;
  }

  /** Calculate total time walked (ms) */
  calculateTimeWalked(layoutId?: string): number {
    const path = this.getWalkPath(layoutId);
    if (path.length < 2) return 0;

    const first = new Date(path[0].point.timestamp).getTime();
    const last = new Date(path[path.length - 1].point.timestamp).getTime();
    return last - first;
  }

  // ─── Coverage ───────────────────────────────────────────────

  /** Get coverage summary */
  getCoverageSummary(layoutId?: string): {
    totalZones: number;
    completedZones: number;
    partialZones: number;
    notVisitedZones: number;
    needsRecountZones: number;
    coveragePercent: number;
    totalItems: number;
    totalImages: number;
    totalTimeMs: number;
  } {
    const id = layoutId || this.activeLayoutId;
    if (!id) {
      return {
        totalZones: 0, completedZones: 0, partialZones: 0,
        notVisitedZones: 0, needsRecountZones: 0, coveragePercent: 0,
        totalItems: 0, totalImages: 0, totalTimeMs: 0,
      };
    }

    const layout = this.layouts.get(id);
    if (!layout) {
      return {
        totalZones: 0, completedZones: 0, partialZones: 0,
        notVisitedZones: 0, needsRecountZones: 0, coveragePercent: 0,
        totalItems: 0, totalImages: 0, totalTimeMs: 0,
      };
    }

    const zones = layout.zones;
    return {
      totalZones: zones.length,
      completedZones: zones.filter(z => z.coverage === 'complete').length,
      partialZones: zones.filter(z => z.coverage === 'partial').length,
      notVisitedZones: zones.filter(z => z.coverage === 'not_visited').length,
      needsRecountZones: zones.filter(z => z.coverage === 'needs_recount').length,
      coveragePercent: layout.coveragePercent,
      totalItems: zones.reduce((sum, z) => sum + z.itemCount, 0),
      totalImages: zones.reduce((sum, z) => sum + z.imageCount, 0),
      totalTimeMs: zones.reduce((sum, z) => sum + z.timeSpentMs, 0),
    };
  }

  /** Get uncovered zones (not visited or needs recount) */
  getUncoveredZones(layoutId?: string): Zone[] {
    const id = layoutId || this.activeLayoutId;
    if (!id) return [];
    const layout = this.layouts.get(id);
    if (!layout) return [];

    return layout.zones.filter(
      z => z.coverage === 'not_visited' || z.coverage === 'needs_recount'
    );
  }

  // ─── Route Optimization ─────────────────────────────────────

  /** Suggest an optimal route through uncovered zones */
  suggestRoute(layoutId?: string): RouteRecommendation {
    const uncovered = this.getUncoveredZones(layoutId);

    if (uncovered.length === 0) {
      return {
        zones: [],
        estimatedTimeMinutes: 0,
        estimatedItems: 0,
        reason: 'All zones have been covered!',
      };
    }

    // Sort by: needs_recount first, then by sort order, then by estimated items (most first)
    const sorted = [...uncovered].sort((a, b) => {
      if (a.coverage === 'needs_recount' && b.coverage !== 'needs_recount') return -1;
      if (b.coverage === 'needs_recount' && a.coverage !== 'needs_recount') return 1;
      return a.sortOrder - b.sortOrder;
    });

    const zoneIds = sorted.map(z => z.id);
    const estimatedItems = sorted.reduce((sum, z) => sum + (z.estimatedTotalItems || 50), 0);
    const estimatedTimeMinutes = Math.ceil(estimatedItems / 100) * 5; // ~100 items per 5 min

    const recommendation: RouteRecommendation = {
      zones: zoneIds,
      estimatedTimeMinutes,
      estimatedItems,
      reason: uncovered.some(z => z.coverage === 'needs_recount')
        ? `${uncovered.filter(z => z.coverage === 'needs_recount').length} zones need recount, ${uncovered.filter(z => z.coverage === 'not_visited').length} zones not yet visited`
        : `${uncovered.length} zones remaining to visit`,
    };

    this.emit('route:recommended', recommendation);
    return recommendation;
  }

  // ─── Heat Map ───────────────────────────────────────────────

  /** Generate a heat map of item density across zones */
  generateHeatmap(layoutId?: string): HeatmapCell[] {
    const id = layoutId || this.activeLayoutId;
    if (!id) return [];
    const layout = this.layouts.get(id);
    if (!layout) return [];

    const maxItemCount = Math.max(...layout.zones.map(z => z.itemCount), 1);

    return layout.zones.map(z => ({
      zoneId: z.id,
      zoneName: z.name,
      itemCount: z.itemCount,
      itemDensity: z.imageCount > 0 ? z.itemCount / z.imageCount : 0,
      estimatedValue: 0, // would need price data
      timeSpent: z.timeSpentMs,
      coverage: z.coverage,
      intensity: z.itemCount / maxItemCount,
    }));
  }

  // ─── Layout Comparison ──────────────────────────────────────

  /** Compare two layouts (e.g., this month vs. last month) */
  compareLayouts(previousId: string, currentId: string): LayoutComparison {
    const prev = this.layouts.get(previousId);
    const curr = this.layouts.get(currentId);
    if (!prev) throw new Error(`Layout not found: ${previousId}`);
    if (!curr) throw new Error(`Layout not found: ${currentId}`);

    const prevZoneNames = new Set(prev.zones.map(z => z.name));
    const currZoneNames = new Set(curr.zones.map(z => z.name));

    const newZones = curr.zones
      .filter(z => !prevZoneNames.has(z.name))
      .map(z => z.name);

    const removedZones = prev.zones
      .filter(z => !currZoneNames.has(z.name))
      .map(z => z.name);

    const changedZones: { zoneId: string; changes: string[] }[] = [];
    for (const currZone of curr.zones) {
      const prevZone = prev.zones.find(z => z.name === currZone.name);
      if (!prevZone) continue;

      const changes: string[] = [];
      if (currZone.itemCount !== prevZone.itemCount) {
        const diff = currZone.itemCount - prevZone.itemCount;
        changes.push(`Items: ${diff > 0 ? '+' : ''}${diff}`);
      }
      if (currZone.sections.length !== prevZone.sections.length) {
        changes.push(`Sections: ${prevZone.sections.length} → ${currZone.sections.length}`);
      }
      if (currZone.coverage !== prevZone.coverage) {
        changes.push(`Coverage: ${prevZone.coverage} → ${currZone.coverage}`);
      }

      if (changes.length > 0) {
        changedZones.push({ zoneId: currZone.id, changes });
      }
    }

    const prevItems = prev.zones.reduce((sum, z) => sum + z.itemCount, 0);
    const currItems = curr.zones.reduce((sum, z) => sum + z.itemCount, 0);
    const prevTime = prev.zones.reduce((sum, z) => sum + z.timeSpentMs, 0);
    const currTime = curr.zones.reduce((sum, z) => sum + z.timeSpentMs, 0);

    return {
      previousLayoutId: previousId,
      currentLayoutId: currentId,
      newZones,
      removedZones,
      changedZones,
      coverageDiff: curr.coveragePercent - prev.coveragePercent,
      itemCountDiff: currItems - prevItems,
      timeDiffMs: currTime - prevTime,
    };
  }

  // ─── Voice Summary ──────────────────────────────────────────

  /** Generate a voice-friendly progress summary */
  getVoiceSummary(layoutId?: string): string {
    const summary = this.getCoverageSummary(layoutId);

    if (summary.totalZones === 0) {
      return 'No zones have been set up yet. Start by adding zones to your store layout.';
    }

    const parts: string[] = [];

    if (summary.completedZones === summary.totalZones) {
      parts.push(`All ${summary.totalZones} zones are complete!`);
    } else {
      parts.push(`${summary.completedZones} of ${summary.totalZones} zones complete.`);
    }

    parts.push(`${summary.totalItems.toLocaleString()} items counted so far.`);

    if (summary.notVisitedZones > 0) {
      parts.push(`${summary.notVisitedZones} zone${summary.notVisitedZones > 1 ? 's' : ''} not yet visited.`);
    }

    if (summary.needsRecountZones > 0) {
      parts.push(`${summary.needsRecountZones} zone${summary.needsRecountZones > 1 ? 's' : ''} flagged for recount.`);
    }

    const minutes = Math.round(summary.totalTimeMs / 60000);
    if (minutes > 0) {
      parts.push(`Total time: ${minutes} minute${minutes !== 1 ? 's' : ''}.`);
    }

    parts.push(`Coverage: ${Math.round(summary.coveragePercent)}%.`);

    return parts.join(' ');
  }

  // ─── Quick Setup Templates ──────────────────────────────────

  /** Set up zones from a template (convenience for common store types) */
  setupFromTemplate(template: 'convenience_store' | 'grocery' | 'hardware' | 'clothing' | 'warehouse'): Zone[] {
    const templates: Record<string, Array<{ name: string; type: ZoneType }>> = {
      convenience_store: [
        { name: 'Entrance', type: 'entrance' },
        { name: 'Checkout Counter', type: 'checkout' },
        { name: 'Beverages', type: 'aisle' },
        { name: 'Snacks', type: 'aisle' },
        { name: 'Grocery', type: 'aisle' },
        { name: 'Personal Care', type: 'aisle' },
        { name: 'Coolers', type: 'cold_storage' },
        { name: 'Frozen', type: 'cold_storage' },
        { name: 'Endcap Front', type: 'endcap' },
        { name: 'Endcap Back', type: 'endcap' },
        { name: 'Behind Counter', type: 'display' },
        { name: 'Backroom', type: 'backroom' },
      ],
      grocery: [
        { name: 'Entrance', type: 'entrance' },
        { name: 'Produce', type: 'department' },
        { name: 'Bakery', type: 'department' },
        { name: 'Deli', type: 'department' },
        { name: 'Meat', type: 'department' },
        { name: 'Seafood', type: 'department' },
        { name: 'Dairy', type: 'cold_storage' },
        { name: 'Frozen Foods', type: 'cold_storage' },
        { name: 'Aisle 1 - Cereal/Breakfast', type: 'aisle' },
        { name: 'Aisle 2 - Canned Goods', type: 'aisle' },
        { name: 'Aisle 3 - Pasta/Sauces', type: 'aisle' },
        { name: 'Aisle 4 - Snacks/Chips', type: 'aisle' },
        { name: 'Aisle 5 - Beverages', type: 'aisle' },
        { name: 'Aisle 6 - Cleaning', type: 'aisle' },
        { name: 'Aisle 7 - Personal Care', type: 'aisle' },
        { name: 'Checkout', type: 'checkout' },
        { name: 'Backroom', type: 'backroom' },
      ],
      hardware: [
        { name: 'Entrance', type: 'entrance' },
        { name: 'Tools', type: 'department' },
        { name: 'Electrical', type: 'department' },
        { name: 'Plumbing', type: 'department' },
        { name: 'Paint', type: 'department' },
        { name: 'Lumber', type: 'department' },
        { name: 'Fasteners', type: 'aisle' },
        { name: 'Garden', type: 'department' },
        { name: 'Outdoor', type: 'department' },
        { name: 'Checkout', type: 'checkout' },
        { name: 'Loading Dock', type: 'loading_dock' },
        { name: 'Backroom', type: 'backroom' },
      ],
      clothing: [
        { name: 'Entrance', type: 'entrance' },
        { name: 'Women\'s', type: 'department' },
        { name: 'Men\'s', type: 'department' },
        { name: 'Kids', type: 'department' },
        { name: 'Shoes', type: 'department' },
        { name: 'Accessories', type: 'department' },
        { name: 'Sale/Clearance', type: 'display' },
        { name: 'Fitting Rooms', type: 'custom' },
        { name: 'Checkout', type: 'checkout' },
        { name: 'Backroom', type: 'backroom' },
      ],
      warehouse: [
        { name: 'Receiving', type: 'loading_dock' },
        { name: 'Zone A', type: 'department' },
        { name: 'Zone B', type: 'department' },
        { name: 'Zone C', type: 'department' },
        { name: 'Zone D', type: 'department' },
        { name: 'Cold Storage', type: 'cold_storage' },
        { name: 'Shipping', type: 'loading_dock' },
        { name: 'Office', type: 'office' },
      ],
    };

    const zoneTemplates = templates[template];
    if (!zoneTemplates) throw new Error(`Unknown template: ${template}`);

    const zones: Zone[] = [];
    for (const t of zoneTemplates) {
      zones.push(this.addZone({ name: t.name, type: t.type }));
    }
    return zones;
  }

  // ─── Private Helpers ────────────────────────────────────────

  private _requireActiveLayout(): StoreLayout {
    if (!this.activeLayoutId) throw new Error('No active layout');
    const layout = this.layouts.get(this.activeLayoutId);
    if (!layout) throw new Error('Active layout not found');
    return layout;
  }

  private _recalculateCoverage(layout: StoreLayout): void {
    if (layout.zones.length === 0) {
      layout.coveragePercent = 0;
      return;
    }

    const completed = layout.zones.filter(z => z.coverage === 'complete').length;
    const partial = layout.zones.filter(z => z.coverage === 'partial').length;

    // Complete zones count 100%, partial count 50%
    layout.coveragePercent = ((completed + partial * 0.5) / layout.zones.length) * 100;

    this.emit('coverage:updated', layout.coveragePercent);
  }

  private _estimateDirection(path: Waypoint[], newPoint: GeoPoint): MovementDirection {
    if (path.length === 0) return 'stationary';

    const last = path[path.length - 1].point;
    const latDiff = newPoint.latitude - last.latitude;
    const lngDiff = newPoint.longitude - last.longitude;

    if (Math.abs(latDiff) < 0.000001 && Math.abs(lngDiff) < 0.000001) {
      return 'stationary';
    }

    if (Math.abs(latDiff) > Math.abs(lngDiff)) {
      return latDiff > 0 ? 'north' : 'south';
    } else {
      return lngDiff > 0 ? 'east' : 'west';
    }
  }

  private _estimateSpeed(path: Waypoint[], newPoint: GeoPoint): number {
    if (path.length === 0) return 0;

    const last = path[path.length - 1];
    const distance = this._haversineDistance(last.point, newPoint);
    const timeDiffMs = new Date(newPoint.timestamp).getTime() - new Date(last.point.timestamp).getTime();

    if (timeDiffMs <= 0) return 0;
    return distance / (timeDiffMs / 1000); // m/s
  }

  private _haversineDistance(p1: GeoPoint, p2: GeoPoint): number {
    const R = 6371000; // Earth's radius in meters
    const lat1 = (p1.latitude * Math.PI) / 180;
    const lat2 = (p2.latitude * Math.PI) / 180;
    const dLat = ((p2.latitude - p1.latitude) * Math.PI) / 180;
    const dLon = ((p2.longitude - p1.longitude) * Math.PI) / 180;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  private _detectZoneFromGPS(layout: StoreLayout, point: GeoPoint): Zone | null {
    for (const zone of layout.zones) {
      if (!zone.boundary || zone.boundary.length < 3) continue;

      // Simple point-in-polygon check
      if (this._isPointInPolygon(point, zone.boundary)) {
        return zone;
      }
    }
    return null;
  }

  private _isPointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = polygon[i].latitude;
      const xi = polygon[i].longitude;
      const yj = polygon[j].latitude;
      const xj = polygon[j].longitude;

      const intersect = ((yi > point.latitude) !== (yj > point.latitude)) &&
        (point.longitude < (xj - xi) * (point.latitude - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }

    return inside;
  }

  private _updateBounds(layout: StoreLayout, point: GeoPoint): void {
    if (!layout.bounds) {
      layout.bounds = {
        northWest: { ...point },
        southEast: { ...point },
      };
      return;
    }

    if (point.latitude > layout.bounds.northWest.latitude) {
      layout.bounds.northWest.latitude = point.latitude;
    }
    if (point.longitude < layout.bounds.northWest.longitude) {
      layout.bounds.northWest.longitude = point.longitude;
    }
    if (point.latitude < layout.bounds.southEast.latitude) {
      layout.bounds.southEast.latitude = point.latitude;
    }
    if (point.longitude > layout.bounds.southEast.longitude) {
      layout.bounds.southEast.longitude = point.longitude;
    }
  }

  /** Reset all data (for testing) */
  reset(): void {
    this.layouts.clear();
    this.activeLayoutId = null;
    this.currentZoneId = null;
    this.zoneEntryTime = 0;
    this.idCounter = 0;
  }
}
