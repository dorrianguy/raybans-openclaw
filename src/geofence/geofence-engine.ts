/**
 * Geofence Engine — Location-Aware Agent Activation
 *
 * Automatically triggers agents and chains when the user enters/exits
 * geographic regions. Powers features like:
 * - "Start inventory mode when I arrive at the store"
 * - "Switch to meeting mode at the office"
 * - "Activate translation agent at the airport"
 *
 * Features:
 * - Circular and polygon geofences
 * - Enter/exit/dwell events
 * - Configurable dwell time thresholds
 * - Agent activation rules per fence
 * - Fence groups (e.g., "All Stores", "Competitors")
 * - Schedule-aware fences (only active during business hours)
 * - GPS smoothing to prevent jitter-triggered events
 * - Breadcrumb trail with fence association
 * - Fence templates for common location types
 * - Voice announcements on transitions
 * - Statistics and history tracking
 *
 * @module geofence-engine
 */

import { EventEmitter } from 'events';

// ─── Types ────────────────────────────────────────────────────────

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type FenceShape = 'circle' | 'polygon';

export interface CircleFence {
  shape: 'circle';
  center: GeoPoint;
  radiusMeters: number;
}

export interface PolygonFence {
  shape: 'polygon';
  vertices: GeoPoint[]; // minimum 3
}

export type FenceGeometry = CircleFence | PolygonFence;

export interface TimeWindow {
  startHour: number; // 0-23
  startMinute: number; // 0-59
  endHour: number;
  endMinute: number;
  daysOfWeek?: number[]; // 0=Sunday, 1=Monday, etc.
}

export interface FenceAgentRule {
  agentId: string;
  onEnter?: boolean; // activate agent on enter (default true)
  onExit?: boolean; // deactivate agent on exit (default true)
  onDwell?: boolean; // activate after dwell time
  config?: Record<string, unknown>; // agent-specific config
  voiceAnnouncement?: string; // TTS when triggered
}

export type FenceCategory =
  | 'store'
  | 'warehouse'
  | 'office'
  | 'home'
  | 'client_site'
  | 'competitor'
  | 'event_venue'
  | 'airport'
  | 'hospital'
  | 'school'
  | 'restaurant'
  | 'gym'
  | 'custom';

export interface Geofence {
  id: string;
  name: string;
  description?: string;
  category: FenceCategory;
  geometry: FenceGeometry;
  enabled: boolean;
  groupId?: string; // for grouping fences
  tags?: string[];
  agentRules: FenceAgentRule[];
  dwellTimeMs?: number; // time before dwell event fires (default 60000)
  cooldownMs?: number; // min time between re-entry events (default 300000)
  schedule?: TimeWindow[]; // when fence is active (empty = always)
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface FenceGroup {
  id: string;
  name: string;
  description?: string;
  color?: string; // for map display
  fenceIds: string[];
  createdAt: number;
}

export type TransitionType = 'enter' | 'exit' | 'dwell';

export interface FenceTransition {
  id: string;
  fenceId: string;
  fenceName: string;
  type: TransitionType;
  timestamp: number;
  location: GeoPoint;
  triggeredAgents: string[];
  voiceAnnouncement?: string;
  dwellDurationMs?: number; // for exit events, how long inside
}

export interface Breadcrumb {
  location: GeoPoint;
  timestamp: number;
  accuracy?: number; // meters
  speed?: number; // m/s
  heading?: number; // degrees
  fenceIds: string[]; // which fences contain this point
}

export interface FenceStats {
  fenceId: string;
  fenceName: string;
  totalEnters: number;
  totalExits: number;
  totalDwells: number;
  totalDwellTimeMs: number;
  averageDwellTimeMs: number;
  lastEntered?: number;
  lastExited?: number;
  longestDwellMs: number;
}

export interface GeofenceEngineConfig {
  maxFences?: number; // default 500
  maxBreadcrumbs?: number; // default 10000
  maxTransitions?: number; // default 5000
  gpsSmoothing?: boolean; // default true
  smoothingWindowSize?: number; // default 3 (rolling average)
  minAccuracyMeters?: number; // ignore readings worse than this (default 100)
  defaultDwellTimeMs?: number; // default 60000
  defaultCooldownMs?: number; // default 300000
  breadcrumbIntervalMs?: number; // minimum time between breadcrumbs (default 5000)
}

export interface GeofenceEngineEvents {
  'fence:enter': (transition: FenceTransition) => void;
  'fence:exit': (transition: FenceTransition) => void;
  'fence:dwell': (transition: FenceTransition) => void;
  'fence:created': (fence: Geofence) => void;
  'fence:updated': (fence: Geofence) => void;
  'fence:deleted': (fenceId: string) => void;
  'location:updated': (breadcrumb: Breadcrumb) => void;
  'error': (error: Error) => void;
}

export const DEFAULT_GEOFENCE_CONFIG: GeofenceEngineConfig = {
  maxFences: 500,
  maxBreadcrumbs: 10000,
  maxTransitions: 5000,
  gpsSmoothing: true,
  smoothingWindowSize: 3,
  minAccuracyMeters: 100,
  defaultDwellTimeMs: 60000,
  defaultCooldownMs: 300000,
  breadcrumbIntervalMs: 5000,
};

// ─── Fence Templates ────────────────────────────────────────────

export interface FenceTemplate {
  name: string;
  category: FenceCategory;
  radiusMeters: number;
  dwellTimeMs: number;
  agentRules: FenceAgentRule[];
  description: string;
}

export const FENCE_TEMPLATES: Record<string, FenceTemplate> = {
  retail_store: {
    name: 'Retail Store',
    category: 'store',
    radiusMeters: 50,
    dwellTimeMs: 30000,
    agentRules: [
      { agentId: 'inventory', onEnter: true, onExit: true, voiceAnnouncement: 'Arrived at store. Inventory mode ready.' },
      { agentId: 'deal-analysis', onEnter: true, onExit: true },
    ],
    description: 'Standard retail store with inventory + deal analysis',
  },
  warehouse: {
    name: 'Warehouse',
    category: 'warehouse',
    radiusMeters: 100,
    dwellTimeMs: 60000,
    agentRules: [
      { agentId: 'inventory', onEnter: true, onExit: true, voiceAnnouncement: 'Warehouse zone entered. Starting inventory scan.' },
      { agentId: 'security', onEnter: true, onExit: true },
    ],
    description: 'Warehouse with inventory + security monitoring',
  },
  office: {
    name: 'Office',
    category: 'office',
    radiusMeters: 30,
    dwellTimeMs: 120000,
    agentRules: [
      { agentId: 'meeting', onEnter: true, onExit: true, voiceAnnouncement: 'Welcome to the office.' },
      { agentId: 'debug', onEnter: true, onExit: true },
    ],
    description: 'Office with meeting + debug agents',
  },
  client_site: {
    name: 'Client Site',
    category: 'client_site',
    radiusMeters: 50,
    dwellTimeMs: 60000,
    agentRules: [
      { agentId: 'networking', onEnter: true, onExit: true, voiceAnnouncement: 'Arrived at client site. Networking mode active.' },
      { agentId: 'meeting', onEnter: true, onExit: true },
      { agentId: 'inspection', onEnter: true, onExit: true },
    ],
    description: 'Client visit with networking + meeting + inspection',
  },
  competitor_store: {
    name: 'Competitor Store',
    category: 'competitor',
    radiusMeters: 50,
    dwellTimeMs: 30000,
    agentRules: [
      { agentId: 'deal-analysis', onEnter: true, onExit: true, voiceAnnouncement: 'Competitor location detected. Price comparison active.' },
      { agentId: 'security', onEnter: true, onExit: false },
    ],
    description: 'Competitor store with price intelligence',
  },
  event_venue: {
    name: 'Event Venue',
    category: 'event_venue',
    radiusMeters: 200,
    dwellTimeMs: 300000,
    agentRules: [
      { agentId: 'networking', onEnter: true, onExit: true, voiceAnnouncement: 'Event venue. Networking mode activated.' },
      { agentId: 'meeting', onEnter: true, onExit: true },
      { agentId: 'translation', onEnter: true, onExit: true },
    ],
    description: 'Conference/event with networking + translation',
  },
  airport: {
    name: 'Airport',
    category: 'airport',
    radiusMeters: 500,
    dwellTimeMs: 600000,
    agentRules: [
      { agentId: 'translation', onEnter: true, onExit: true, voiceAnnouncement: 'Airport zone. Translation ready.' },
      { agentId: 'security', onEnter: true, onExit: true },
    ],
    description: 'Airport with translation + security awareness',
  },
};

// ─── Utility Functions ──────────────────────────────────────────

const EARTH_RADIUS_METERS = 6371000;

/**
 * Haversine distance between two GPS points in meters
 */
export function haversineDistance(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Ray-casting point-in-polygon test
 */
export function pointInPolygon(point: GeoPoint, vertices: GeoPoint[]): boolean {
  if (vertices.length < 3) return false;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const vi = vertices[i];
    const vj = vertices[j];
    if (
      vi.lng > point.lng !== vj.lng > point.lng &&
      point.lat < ((vj.lat - vi.lat) * (point.lng - vi.lng)) / (vj.lng - vi.lng) + vi.lat
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Check if a point is inside a geofence
 */
export function isInsideFence(point: GeoPoint, geometry: FenceGeometry): boolean {
  if (geometry.shape === 'circle') {
    const dist = haversineDistance(point, geometry.center);
    return dist <= geometry.radiusMeters;
  }
  return pointInPolygon(point, geometry.vertices);
}

/**
 * Calculate the centroid of a polygon
 */
export function polygonCentroid(vertices: GeoPoint[]): GeoPoint {
  if (vertices.length === 0) return { lat: 0, lng: 0 };
  const sum = vertices.reduce(
    (acc, v) => ({ lat: acc.lat + v.lat, lng: acc.lng + v.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: sum.lat / vertices.length, lng: sum.lng / vertices.length };
}

/**
 * Get the center point of a fence (for distance calculations)
 */
export function fenceCenter(geometry: FenceGeometry): GeoPoint {
  if (geometry.shape === 'circle') return geometry.center;
  return polygonCentroid(geometry.vertices);
}

/**
 * Check if current time falls within a schedule window
 */
export function isWithinSchedule(schedule: TimeWindow[], now?: Date): boolean {
  if (schedule.length === 0) return true; // empty schedule = always active

  const date = now ?? new Date();
  const currentHour = date.getHours();
  const currentMinute = date.getMinutes();
  const currentDay = date.getDay();
  const currentMinutes = currentHour * 60 + currentMinute;

  for (const window of schedule) {
    // Check day of week
    if (window.daysOfWeek && window.daysOfWeek.length > 0) {
      if (!window.daysOfWeek.includes(currentDay)) continue;
    }

    const startMinutes = window.startHour * 60 + window.startMinute;
    const endMinutes = window.endHour * 60 + window.endMinute;

    if (startMinutes <= endMinutes) {
      // Normal range (e.g., 9:00-17:00)
      if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) return true;
    } else {
      // Overnight range (e.g., 22:00-06:00)
      if (currentMinutes >= startMinutes || currentMinutes <= endMinutes) return true;
    }
  }

  return false;
}

function generateId(): string {
  return `gf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Engine ─────────────────────────────────────────────────────

export class GeofenceEngine extends EventEmitter {
  private config: Required<GeofenceEngineConfig>;
  private fences: Map<string, Geofence> = new Map();
  private groups: Map<string, FenceGroup> = new Map();
  private transitions: FenceTransition[] = [];
  private breadcrumbs: Breadcrumb[] = [];

  // Current state tracking
  private currentFences: Set<string> = new Set(); // fence IDs currently inside
  private fenceEntryTimes: Map<string, number> = new Map(); // when entered
  private dwellTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private lastExitTimes: Map<string, number> = new Map(); // for cooldown
  private lastLocation: GeoPoint | null = null;
  private lastBreadcrumbTime = 0;
  private smoothingBuffer: GeoPoint[] = [];

  // Stats
  private stats: Map<string, FenceStats> = new Map();

  constructor(config: GeofenceEngineConfig = {}) {
    super();
    this.config = { ...DEFAULT_GEOFENCE_CONFIG, ...config } as Required<GeofenceEngineConfig>;
  }

  // ─── Fence CRUD ───────────────────────────────────────────────

  createFence(params: {
    name: string;
    geometry: FenceGeometry;
    category?: FenceCategory;
    description?: string;
    enabled?: boolean;
    groupId?: string;
    tags?: string[];
    agentRules?: FenceAgentRule[];
    dwellTimeMs?: number;
    cooldownMs?: number;
    schedule?: TimeWindow[];
    metadata?: Record<string, unknown>;
  }): Geofence {
    if (this.fences.size >= this.config.maxFences) {
      throw new Error(`Maximum fence limit reached (${this.config.maxFences})`);
    }

    // Validate geometry
    if (params.geometry.shape === 'polygon' && params.geometry.vertices.length < 3) {
      throw new Error('Polygon fence requires at least 3 vertices');
    }
    if (params.geometry.shape === 'circle' && params.geometry.radiusMeters <= 0) {
      throw new Error('Circle fence radius must be positive');
    }

    const now = Date.now();
    const fence: Geofence = {
      id: generateId(),
      name: params.name,
      description: params.description,
      category: params.category ?? 'custom',
      geometry: params.geometry,
      enabled: params.enabled ?? true,
      groupId: params.groupId,
      tags: params.tags ?? [],
      agentRules: params.agentRules ?? [],
      dwellTimeMs: params.dwellTimeMs ?? this.config.defaultDwellTimeMs,
      cooldownMs: params.cooldownMs ?? this.config.defaultCooldownMs,
      schedule: params.schedule ?? [],
      metadata: params.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };

    this.fences.set(fence.id, fence);
    this.initStats(fence.id, fence.name);

    // If in a group, add to group
    if (fence.groupId) {
      const group = this.groups.get(fence.groupId);
      if (group) {
        group.fenceIds.push(fence.id);
      }
    }

    this.emit('fence:created', fence);
    return fence;
  }

  createFenceFromTemplate(
    templateKey: string,
    location: GeoPoint,
    name?: string,
    overrides?: Partial<Geofence>
  ): Geofence {
    const template = FENCE_TEMPLATES[templateKey];
    if (!template) {
      throw new Error(`Unknown template: ${templateKey}. Available: ${Object.keys(FENCE_TEMPLATES).join(', ')}`);
    }

    return this.createFence({
      name: name ?? template.name,
      description: template.description,
      category: template.category,
      geometry: {
        shape: 'circle',
        center: location,
        radiusMeters: template.radiusMeters,
      },
      agentRules: [...template.agentRules],
      dwellTimeMs: template.dwellTimeMs,
      ...overrides,
    });
  }

  updateFence(fenceId: string, updates: Partial<Omit<Geofence, 'id' | 'createdAt'>>): Geofence {
    const fence = this.fences.get(fenceId);
    if (!fence) throw new Error(`Fence not found: ${fenceId}`);

    if (updates.geometry) {
      if (updates.geometry.shape === 'polygon' && updates.geometry.vertices.length < 3) {
        throw new Error('Polygon fence requires at least 3 vertices');
      }
      if (updates.geometry.shape === 'circle' && updates.geometry.radiusMeters <= 0) {
        throw new Error('Circle fence radius must be positive');
      }
    }

    Object.assign(fence, updates, { updatedAt: Date.now() });
    this.emit('fence:updated', fence);
    return fence;
  }

  deleteFence(fenceId: string): boolean {
    const fence = this.fences.get(fenceId);
    if (!fence) return false;

    // Clean up state
    this.currentFences.delete(fenceId);
    this.fenceEntryTimes.delete(fenceId);
    this.lastExitTimes.delete(fenceId);

    const timer = this.dwellTimers.get(fenceId);
    if (timer) {
      clearTimeout(timer);
      this.dwellTimers.delete(fenceId);
    }

    // Remove from group
    if (fence.groupId) {
      const group = this.groups.get(fence.groupId);
      if (group) {
        group.fenceIds = group.fenceIds.filter((id) => id !== fenceId);
      }
    }

    this.fences.delete(fenceId);
    this.emit('fence:deleted', fenceId);
    return true;
  }

  getFence(fenceId: string): Geofence | undefined {
    return this.fences.get(fenceId);
  }

  listFences(filter?: {
    category?: FenceCategory;
    groupId?: string;
    enabled?: boolean;
    tag?: string;
    nearPoint?: GeoPoint;
    withinMeters?: number;
  }): Geofence[] {
    let fences = Array.from(this.fences.values());

    if (filter) {
      if (filter.category) fences = fences.filter((f) => f.category === filter.category);
      if (filter.groupId) fences = fences.filter((f) => f.groupId === filter.groupId);
      if (filter.enabled !== undefined) fences = fences.filter((f) => f.enabled === filter.enabled);
      if (filter.tag) fences = fences.filter((f) => f.tags?.includes(filter.tag!));
      if (filter.nearPoint && filter.withinMeters) {
        fences = fences.filter((f) => {
          const center = fenceCenter(f.geometry);
          return haversineDistance(filter.nearPoint!, center) <= filter.withinMeters!;
        });
      }
    }

    return fences;
  }

  // ─── Groups ───────────────────────────────────────────────────

  createGroup(name: string, description?: string, color?: string): FenceGroup {
    const group: FenceGroup = {
      id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      description,
      color,
      fenceIds: [],
      createdAt: Date.now(),
    };
    this.groups.set(group.id, group);
    return group;
  }

  getGroup(groupId: string): FenceGroup | undefined {
    return this.groups.get(groupId);
  }

  listGroups(): FenceGroup[] {
    return Array.from(this.groups.values());
  }

  deleteGroup(groupId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    // Remove group association from fences
    for (const fenceId of group.fenceIds) {
      const fence = this.fences.get(fenceId);
      if (fence) {
        fence.groupId = undefined;
      }
    }

    this.groups.delete(groupId);
    return true;
  }

  // ─── Location Updates ─────────────────────────────────────────

  updateLocation(
    location: GeoPoint,
    accuracy?: number,
    speed?: number,
    heading?: number,
    now?: Date
  ): FenceTransition[] {
    // Accuracy filter
    if (accuracy !== undefined && accuracy > this.config.minAccuracyMeters) {
      return [];
    }

    // GPS smoothing
    let smoothed = location;
    if (this.config.gpsSmoothing) {
      this.smoothingBuffer.push(location);
      if (this.smoothingBuffer.length > this.config.smoothingWindowSize) {
        this.smoothingBuffer.shift();
      }
      if (this.smoothingBuffer.length >= 2) {
        smoothed = this.smoothLocation();
      }
    }

    this.lastLocation = smoothed;

    // Record breadcrumb
    const currentTime = Date.now();
    const transitions: FenceTransition[] = [];

    if (currentTime - this.lastBreadcrumbTime >= this.config.breadcrumbIntervalMs) {
      const containingFences = this.findContainingFences(smoothed, now);
      const breadcrumb: Breadcrumb = {
        location: smoothed,
        timestamp: currentTime,
        accuracy,
        speed,
        heading,
        fenceIds: containingFences,
      };

      this.breadcrumbs.push(breadcrumb);
      if (this.breadcrumbs.length > this.config.maxBreadcrumbs) {
        this.breadcrumbs.splice(0, this.breadcrumbs.length - this.config.maxBreadcrumbs);
      }

      this.lastBreadcrumbTime = currentTime;
      this.emit('location:updated', breadcrumb);
    }

    // Check fence transitions
    const activeFences = this.getActiveFences(now);

    for (const fence of activeFences) {
      const inside = isInsideFence(smoothed, fence.geometry);
      const wasInside = this.currentFences.has(fence.id);

      if (inside && !wasInside) {
        // ENTER event
        const cooldown = fence.cooldownMs ?? this.config.defaultCooldownMs;
        const lastExit = this.lastExitTimes.get(fence.id) ?? 0;

        if (currentTime - lastExit >= cooldown) {
          this.currentFences.add(fence.id);
          this.fenceEntryTimes.set(fence.id, currentTime);

          const enterRules = fence.agentRules.filter((r) => r.onEnter !== false);
          const transition: FenceTransition = {
            id: generateId(),
            fenceId: fence.id,
            fenceName: fence.name,
            type: 'enter',
            timestamp: currentTime,
            location: smoothed,
            triggeredAgents: enterRules.map((r) => r.agentId),
            voiceAnnouncement: enterRules.find((r) => r.voiceAnnouncement)?.voiceAnnouncement,
          };

          this.recordTransition(transition);
          transitions.push(transition);
          this.emit('fence:enter', transition);

          // Update stats
          this.updateStatsEnter(fence.id, currentTime);

          // Start dwell timer
          const dwellTime = fence.dwellTimeMs ?? this.config.defaultDwellTimeMs;
          const dwellRules = fence.agentRules.filter((r) => r.onDwell);
          if (dwellRules.length > 0) {
            const timer = setTimeout(() => {
              if (this.currentFences.has(fence.id)) {
                const dwellTransition: FenceTransition = {
                  id: generateId(),
                  fenceId: fence.id,
                  fenceName: fence.name,
                  type: 'dwell',
                  timestamp: Date.now(),
                  location: this.lastLocation ?? smoothed,
                  triggeredAgents: dwellRules.map((r) => r.agentId),
                  voiceAnnouncement: dwellRules.find((r) => r.voiceAnnouncement)?.voiceAnnouncement,
                  dwellDurationMs: dwellTime,
                };

                this.recordTransition(dwellTransition);
                this.updateStatsDwell(fence.id, dwellTime);
                this.emit('fence:dwell', dwellTransition);
              }
              this.dwellTimers.delete(fence.id);
            }, dwellTime);

            this.dwellTimers.set(fence.id, timer);
          }
        }
      } else if (!inside && wasInside) {
        // EXIT event
        this.currentFences.delete(fence.id);
        const entryTime = this.fenceEntryTimes.get(fence.id) ?? currentTime;
        const dwellDuration = currentTime - entryTime;
        this.fenceEntryTimes.delete(fence.id);
        this.lastExitTimes.set(fence.id, currentTime);

        // Cancel dwell timer
        const timer = this.dwellTimers.get(fence.id);
        if (timer) {
          clearTimeout(timer);
          this.dwellTimers.delete(fence.id);
        }

        const exitRules = fence.agentRules.filter((r) => r.onExit !== false);
        const transition: FenceTransition = {
          id: generateId(),
          fenceId: fence.id,
          fenceName: fence.name,
          type: 'exit',
          timestamp: currentTime,
          location: smoothed,
          triggeredAgents: exitRules.map((r) => r.agentId),
          voiceAnnouncement: exitRules.find((r) => r.voiceAnnouncement)?.voiceAnnouncement,
          dwellDurationMs: dwellDuration,
        };

        this.recordTransition(transition);
        transitions.push(transition);
        this.emit('fence:exit', transition);

        // Update stats
        this.updateStatsExit(fence.id, currentTime, dwellDuration);
      }
    }

    return transitions;
  }

  // ─── Queries ──────────────────────────────────────────────────

  getCurrentFences(): Geofence[] {
    return Array.from(this.currentFences)
      .map((id) => this.fences.get(id))
      .filter(Boolean) as Geofence[];
  }

  isInsideAnyFence(): boolean {
    return this.currentFences.size > 0;
  }

  isInsideFence(fenceId: string): boolean {
    return this.currentFences.has(fenceId);
  }

  getTransitions(filter?: {
    fenceId?: string;
    type?: TransitionType;
    since?: number;
    limit?: number;
  }): FenceTransition[] {
    let results = [...this.transitions];

    if (filter) {
      if (filter.fenceId) results = results.filter((t) => t.fenceId === filter.fenceId);
      if (filter.type) results = results.filter((t) => t.type === filter.type);
      if (filter.since) results = results.filter((t) => t.timestamp >= filter.since!);
    }

    results.sort((a, b) => b.timestamp - a.timestamp);
    if (filter?.limit) results = results.slice(0, filter.limit);

    return results;
  }

  getBreadcrumbs(filter?: {
    since?: number;
    fenceId?: string;
    limit?: number;
  }): Breadcrumb[] {
    let results = [...this.breadcrumbs];

    if (filter) {
      if (filter.since) results = results.filter((b) => b.timestamp >= filter.since!);
      if (filter.fenceId) results = results.filter((b) => b.fenceIds.includes(filter.fenceId!));
    }

    if (filter?.limit) results = results.slice(-filter.limit);
    return results;
  }

  getLastLocation(): GeoPoint | null {
    return this.lastLocation;
  }

  // ─── Distance / Proximity ────────────────────────────────────

  distanceToFence(fenceId: string): number | null {
    if (!this.lastLocation) return null;
    const fence = this.fences.get(fenceId);
    if (!fence) return null;

    const center = fenceCenter(fence.geometry);
    const distance = haversineDistance(this.lastLocation, center);

    // For circles, subtract the radius to get distance to boundary
    if (fence.geometry.shape === 'circle') {
      return Math.max(0, distance - fence.geometry.radiusMeters);
    }

    return distance;
  }

  nearestFences(limit = 5): Array<{ fence: Geofence; distanceMeters: number }> {
    if (!this.lastLocation) return [];

    const results = Array.from(this.fences.values())
      .filter((f) => f.enabled)
      .map((fence) => ({
        fence,
        distanceMeters: haversineDistance(this.lastLocation!, fenceCenter(fence.geometry)),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    return results.slice(0, limit);
  }

  // ─── Statistics ───────────────────────────────────────────────

  getFenceStats(fenceId: string): FenceStats | undefined {
    return this.stats.get(fenceId);
  }

  getAllStats(): FenceStats[] {
    return Array.from(this.stats.values());
  }

  getDwellTime(fenceId: string): number {
    if (!this.currentFences.has(fenceId)) return 0;
    const entryTime = this.fenceEntryTimes.get(fenceId);
    if (!entryTime) return 0;
    return Date.now() - entryTime;
  }

  // ─── Voice Summary ────────────────────────────────────────────

  generateVoiceSummary(): string {
    const current = this.getCurrentFences();

    if (current.length === 0 && this.transitions.length === 0 && this.fences.size === 0) {
      return 'No geofence activity. No locations configured.';
    }

    const parts: string[] = [];

    if (current.length > 0) {
      const names = current.map((f) => f.name).join(', ');
      parts.push(`Currently inside ${current.length} zone${current.length > 1 ? 's' : ''}: ${names}.`);

      // Add dwell times
      for (const fence of current) {
        const dwellMs = this.getDwellTime(fence.id);
        if (dwellMs > 60000) {
          const mins = Math.floor(dwellMs / 60000);
          parts.push(`Been at ${fence.name} for ${mins} minute${mins > 1 ? 's' : ''}.`);
        }
      }
    } else {
      parts.push('Not inside any geofence zone.');
    }

    // Recent transitions
    const recentTransitions = this.getTransitions({ limit: 3 });
    if (recentTransitions.length > 0) {
      const last = recentTransitions[0];
      const ago = Math.floor((Date.now() - last.timestamp) / 60000);
      const typeVerb = last.type === 'enter' ? 'entered' : last.type === 'exit' ? 'left' : 'settled into';
      parts.push(`Last activity: ${typeVerb} ${last.fenceName} ${ago} minute${ago !== 1 ? 's' : ''} ago.`);
    }

    // Total fences
    parts.push(`${this.fences.size} zone${this.fences.size !== 1 ? 's' : ''} configured.`);

    return parts.join(' ');
  }

  // ─── Bulk Operations ─────────────────────────────────────────

  importFences(fences: Array<Omit<Geofence, 'id' | 'createdAt' | 'updatedAt'>>): Geofence[] {
    return fences.map((f) =>
      this.createFence({
        name: f.name,
        geometry: f.geometry,
        category: f.category,
        description: f.description,
        enabled: f.enabled,
        groupId: f.groupId,
        tags: f.tags,
        agentRules: f.agentRules,
        dwellTimeMs: f.dwellTimeMs,
        cooldownMs: f.cooldownMs,
        schedule: f.schedule,
        metadata: f.metadata,
      })
    );
  }

  exportFences(): Geofence[] {
    return Array.from(this.fences.values());
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  clearHistory(): void {
    this.transitions = [];
    this.breadcrumbs = [];
  }

  reset(): void {
    // Clear timers
    for (const timer of this.dwellTimers.values()) {
      clearTimeout(timer);
    }

    this.fences.clear();
    this.groups.clear();
    this.transitions = [];
    this.breadcrumbs = [];
    this.currentFences.clear();
    this.fenceEntryTimes.clear();
    this.dwellTimers.clear();
    this.lastExitTimes.clear();
    this.stats.clear();
    this.lastLocation = null;
    this.lastBreadcrumbTime = 0;
    this.smoothingBuffer = [];
  }

  destroy(): void {
    for (const timer of this.dwellTimers.values()) {
      clearTimeout(timer);
    }
    this.dwellTimers.clear();
    this.removeAllListeners();
  }

  // ─── Private Helpers ──────────────────────────────────────────

  private smoothLocation(): GeoPoint {
    const buf = this.smoothingBuffer;
    const lat = buf.reduce((sum, p) => sum + p.lat, 0) / buf.length;
    const lng = buf.reduce((sum, p) => sum + p.lng, 0) / buf.length;
    return { lat, lng };
  }

  private findContainingFences(point: GeoPoint, now?: Date): string[] {
    const fenceIds: string[] = [];
    for (const fence of this.fences.values()) {
      if (!fence.enabled) continue;
      if (fence.schedule && fence.schedule.length > 0 && !isWithinSchedule(fence.schedule, now)) continue;
      if (isInsideFence(point, fence.geometry)) {
        fenceIds.push(fence.id);
      }
    }
    return fenceIds;
  }

  private getActiveFences(now?: Date): Geofence[] {
    return Array.from(this.fences.values()).filter((f) => {
      if (!f.enabled) return false;
      if (f.schedule && f.schedule.length > 0 && !isWithinSchedule(f.schedule, now)) return false;
      return true;
    });
  }

  private recordTransition(transition: FenceTransition): void {
    this.transitions.push(transition);
    if (this.transitions.length > this.config.maxTransitions) {
      this.transitions.splice(0, this.transitions.length - this.config.maxTransitions);
    }
  }

  private initStats(fenceId: string, fenceName: string): void {
    this.stats.set(fenceId, {
      fenceId,
      fenceName,
      totalEnters: 0,
      totalExits: 0,
      totalDwells: 0,
      totalDwellTimeMs: 0,
      averageDwellTimeMs: 0,
      longestDwellMs: 0,
    });
  }

  private updateStatsEnter(fenceId: string, timestamp: number): void {
    const s = this.stats.get(fenceId);
    if (s) {
      s.totalEnters++;
      s.lastEntered = timestamp;
    }
  }

  private updateStatsExit(fenceId: string, timestamp: number, dwellDuration: number): void {
    const s = this.stats.get(fenceId);
    if (s) {
      s.totalExits++;
      s.lastExited = timestamp;
      s.totalDwellTimeMs += dwellDuration;
      s.averageDwellTimeMs = s.totalDwellTimeMs / s.totalExits;
      if (dwellDuration > s.longestDwellMs) {
        s.longestDwellMs = dwellDuration;
      }
    }
  }

  private updateStatsDwell(fenceId: string, _dwellTime: number): void {
    const s = this.stats.get(fenceId);
    if (s) {
      s.totalDwells++;
    }
  }
}
