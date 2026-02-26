/**
 * Analytics Engine — Usage tracking, performance metrics, and insights.
 *
 * Tracks everything that matters for:
 *   1. User insights: Which features are used most? Time saved? Value generated?
 *   2. Performance: Vision model latency, agent accuracy, processing times
 *   3. Business metrics: Sessions per day, agents activated, items scanned
 *   4. Subscription optimization: What features justify the price tier?
 *   5. Revenue features: Cost savings calculations, ROI reports
 *
 * Privacy-first: All data stays local. Nothing phones home without consent.
 *
 * Key metrics:
 *   - Images processed per session/day/week
 *   - Agent invocations and response times
 *   - TTS deliveries and suppressions
 *   - Items scanned (inventory, deals, contacts)
 *   - Error rates and recovery
 *   - User engagement (session duration, active time)
 *   - Estimated value generated (money saved on deals, time saved on inspections)
 *
 * @module analytics/analytics-engine
 */

import { EventEmitter } from 'eventemitter3';

// ─── Types ──────────────────────────────────────────────────────

/**
 * Categories of events we track.
 */
export type AnalyticsEventCategory =
  | 'image'       // Image capture and processing
  | 'agent'       // Agent invocations
  | 'voice'       // Voice commands and TTS
  | 'chain'       // Chain workflow events
  | 'inventory'   // Inventory-specific events
  | 'notification' // Notification events
  | 'session'     // User session events
  | 'error'       // Errors and recovery
  | 'export'      // Report/export generation
  | 'search'      // Memory/search queries
  | 'value';      // Value generation events (savings, time saved)

/**
 * A single analytics event.
 */
export interface AnalyticsEvent {
  /** Unique event ID */
  id: string;
  /** Event category */
  category: AnalyticsEventCategory;
  /** Specific action within the category */
  action: string;
  /** Human-readable label */
  label?: string;
  /** Numeric value (e.g., processing time in ms, items counted, dollars saved) */
  value?: number;
  /** ISO timestamp */
  timestamp: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Duration in ms (for timed events) */
  durationMs?: number;
  /** Whether the event represents a success or failure */
  success?: boolean;
  /** Source agent */
  agentId?: string;
  /** Associated session ID */
  sessionId?: string;
}

/**
 * Time bucket for aggregated metrics.
 */
export type TimeBucket = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'all';

/**
 * Aggregated metric for a time period.
 */
export interface AggregatedMetric {
  /** Metric name */
  name: string;
  /** Time bucket */
  bucket: TimeBucket;
  /** Start of the time period */
  periodStart: string;
  /** Number of events */
  count: number;
  /** Sum of values */
  totalValue: number;
  /** Average value */
  averageValue: number;
  /** Min value */
  minValue: number;
  /** Max value */
  maxValue: number;
  /** P95 value (if tracked) */
  p95Value?: number;
  /** Success rate (0-1) */
  successRate: number;
}

/**
 * Agent performance metrics.
 */
export interface AgentMetrics {
  agentId: string;
  agentName?: string;
  totalInvocations: number;
  successfulInvocations: number;
  failedInvocations: number;
  averageResponseTimeMs: number;
  p95ResponseTimeMs: number;
  maxResponseTimeMs: number;
  totalProcessingTimeMs: number;
  successRate: number;
  /** When the agent was last invoked */
  lastInvokedAt?: string;
}

/**
 * Session metrics.
 */
export interface SessionMetrics {
  /** Total sessions */
  totalSessions: number;
  /** Average session duration in minutes */
  averageSessionDurationMin: number;
  /** Total active time in minutes */
  totalActiveTimeMin: number;
  /** Images captured this period */
  imagesCaptured: number;
  /** Images processed this period */
  imagesProcessed: number;
  /** Voice commands this period */
  voiceCommands: number;
  /** TTS deliveries this period */
  ttsDeliveries: number;
  /** Chains executed */
  chainsExecuted: number;
  /** Most used agent */
  topAgent?: string;
  /** Most common voice command */
  topVoiceCommand?: string;
}

/**
 * Value generation metrics (the money slide).
 */
export interface ValueMetrics {
  /** Estimated money saved (deals, price comparisons) */
  estimatedMoneySaved: number;
  /** Currency code */
  currency: string;
  /** Estimated time saved in minutes */
  estimatedTimeSavedMin: number;
  /** Items inventoried */
  itemsInventoried: number;
  /** Contacts scanned */
  contactsScanned: number;
  /** Inspections completed */
  inspectionsCompleted: number;
  /** Security threats detected */
  threatsDetected: number;
  /** Meetings transcribed */
  meetingsTranscribed: number;
  /** Translations performed */
  translationsPerformed: number;
  /** Debug assists */
  debugAssists: number;
  /** Deals analyzed */
  dealsAnalyzed: number;
}

/**
 * Full dashboard overview combining all metrics.
 */
export interface AnalyticsDashboard {
  /** Time period */
  period: TimeBucket;
  /** Start of period */
  periodStart: string;
  /** End of period */
  periodEnd: string;
  /** Session metrics */
  sessions: SessionMetrics;
  /** Value metrics */
  value: ValueMetrics;
  /** Agent performance */
  agents: AgentMetrics[];
  /** Top-level stats */
  totalEvents: number;
  /** Error rate */
  errorRate: number;
  /** Events by category */
  eventsByCategory: Record<string, number>;
}

/**
 * Configuration for the Analytics Engine.
 */
export interface AnalyticsEngineConfig {
  /** Maximum events to keep in memory */
  maxEventsInMemory: number;
  /** Whether to track detailed event metadata */
  detailedTracking: boolean;
  /** Default currency for value calculations */
  currency: string;
  /** Enable debug logging */
  debug: boolean;
}

export const DEFAULT_ANALYTICS_CONFIG: AnalyticsEngineConfig = {
  maxEventsInMemory: 10_000,
  detailedTracking: true,
  currency: 'USD',
  debug: false,
};

/**
 * Events emitted by the analytics engine.
 */
export interface AnalyticsEngineEvents {
  'analytics:event': (event: AnalyticsEvent) => void;
  'analytics:milestone': (name: string, value: number) => void;
}

// ─── Engine Implementation ──────────────────────────────────────

let eventCounter = 0;
function generateEventId(): string {
  eventCounter++;
  return `evt-${Date.now()}-${eventCounter}`;
}

/**
 * Analytics Engine — Track everything, understand everything.
 *
 * Usage:
 * ```ts
 * const analytics = new AnalyticsEngine();
 *
 * // Track an event
 * analytics.track('agent', 'invocation', {
 *   label: 'security_agent',
 *   value: 150, // ms response time
 *   agentId: 'security',
 *   success: true,
 * });
 *
 * // Track value generation
 * analytics.trackValue('deal_savings', 69.99);
 *
 * // Get dashboard overview
 * const dashboard = analytics.getDashboard('day');
 *
 * // Get agent-specific metrics
 * const metrics = analytics.getAgentMetrics('security');
 * ```
 */
export class AnalyticsEngine extends EventEmitter<AnalyticsEngineEvents> {
  private config: AnalyticsEngineConfig;
  private events: AnalyticsEvent[] = [];
  private milestones: Map<string, number> = new Map();
  private activeTimers: Map<string, number> = new Map();
  private sessionStarts: Map<string, number> = new Map();

  constructor(config: Partial<AnalyticsEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ANALYTICS_CONFIG, ...config };
  }

  // ─── Event Tracking ───────────────────────────────────────

  /**
   * Track an analytics event.
   */
  track(
    category: AnalyticsEventCategory,
    action: string,
    options?: {
      label?: string;
      value?: number;
      metadata?: Record<string, unknown>;
      durationMs?: number;
      success?: boolean;
      agentId?: string;
      sessionId?: string;
    },
  ): AnalyticsEvent {
    const event: AnalyticsEvent = {
      id: generateEventId(),
      category,
      action,
      label: options?.label,
      value: options?.value,
      timestamp: new Date().toISOString(),
      metadata: this.config.detailedTracking ? options?.metadata : undefined,
      durationMs: options?.durationMs,
      success: options?.success,
      agentId: options?.agentId,
      sessionId: options?.sessionId,
    };

    this.events.push(event);

    // Bound memory
    if (this.events.length > this.config.maxEventsInMemory) {
      this.events = this.events.slice(-Math.floor(this.config.maxEventsInMemory * 0.75));
    }

    this.emit('analytics:event', event);
    this.checkMilestones(event);

    return event;
  }

  /**
   * Track a value generation event (savings, time saved, etc.).
   */
  trackValue(
    type: string,
    amount: number,
    metadata?: Record<string, unknown>,
  ): AnalyticsEvent {
    return this.track('value', type, {
      value: amount,
      metadata,
      success: true,
    });
  }

  /**
   * Start a timer for a timed event.
   * Returns a timer ID to pass to stopTimer.
   */
  startTimer(label: string): string {
    const timerId = `timer-${label}-${Date.now()}`;
    this.activeTimers.set(timerId, Date.now());
    return timerId;
  }

  /**
   * Stop a timer and record the duration.
   */
  stopTimer(
    timerId: string,
    category: AnalyticsEventCategory,
    action: string,
    options?: {
      label?: string;
      success?: boolean;
      agentId?: string;
      metadata?: Record<string, unknown>;
    },
  ): AnalyticsEvent | null {
    const startTime = this.activeTimers.get(timerId);
    if (startTime === undefined) return null;

    const durationMs = Date.now() - startTime;
    this.activeTimers.delete(timerId);

    return this.track(category, action, {
      ...options,
      value: durationMs,
      durationMs,
    });
  }

  /**
   * Record a session start.
   */
  startSession(sessionId: string): void {
    this.sessionStarts.set(sessionId, Date.now());
    this.track('session', 'start', { sessionId });
  }

  /**
   * Record a session end.
   */
  endSession(sessionId: string): void {
    const startTime = this.sessionStarts.get(sessionId);
    const durationMs = startTime ? Date.now() - startTime : 0;
    this.sessionStarts.delete(sessionId);

    this.track('session', 'end', {
      sessionId,
      durationMs,
      value: durationMs,
    });
  }

  // ─── Querying ─────────────────────────────────────────────

  /**
   * Get events with optional filtering.
   */
  getEvents(options?: {
    category?: AnalyticsEventCategory;
    action?: string;
    agentId?: string;
    since?: string;
    until?: string;
    limit?: number;
    success?: boolean;
  }): AnalyticsEvent[] {
    let results = [...this.events];

    if (options?.category) {
      results = results.filter((e) => e.category === options.category);
    }
    if (options?.action) {
      results = results.filter((e) => e.action === options.action);
    }
    if (options?.agentId) {
      results = results.filter((e) => e.agentId === options.agentId);
    }
    if (options?.since) {
      const since = new Date(options.since).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() >= since);
    }
    if (options?.until) {
      const until = new Date(options.until).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() <= until);
    }
    if (options?.success !== undefined) {
      results = results.filter((e) => e.success === options.success);
    }

    return results.slice(-(options?.limit ?? 100));
  }

  /**
   * Get aggregated metrics for a specific event type.
   */
  getAggregatedMetric(
    category: AnalyticsEventCategory,
    action: string,
    bucket: TimeBucket = 'day',
  ): AggregatedMetric {
    const events = this.getEventsForBucket(category, action, bucket);
    return this.aggregateEvents(`${category}.${action}`, events, bucket);
  }

  /**
   * Get performance metrics for a specific agent.
   */
  getAgentMetrics(agentId: string): AgentMetrics {
    const agentEvents = this.events.filter(
      (e) => e.agentId === agentId && e.category === 'agent',
    );

    const successful = agentEvents.filter((e) => e.success === true);
    const failed = agentEvents.filter((e) => e.success === false);

    const responseTimes = agentEvents
      .filter((e) => e.durationMs !== undefined)
      .map((e) => e.durationMs!);

    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    const sortedTimes = [...responseTimes].sort((a, b) => a - b);
    const p95Index = Math.min(
      Math.ceil(sortedTimes.length * 0.95) - 1,
      sortedTimes.length - 1,
    );

    const lastEvent = agentEvents.length > 0
      ? agentEvents[agentEvents.length - 1]
      : undefined;

    return {
      agentId,
      totalInvocations: agentEvents.length,
      successfulInvocations: successful.length,
      failedInvocations: failed.length,
      averageResponseTimeMs: Math.round(avgResponseTime),
      p95ResponseTimeMs: sortedTimes.length > 0 ? sortedTimes[Math.max(0, p95Index)] : 0,
      maxResponseTimeMs: sortedTimes.length > 0 ? sortedTimes[sortedTimes.length - 1] : 0,
      totalProcessingTimeMs: responseTimes.reduce((a, b) => a + b, 0),
      successRate: agentEvents.length > 0 ? successful.length / agentEvents.length : 0,
      lastInvokedAt: lastEvent?.timestamp,
    };
  }

  /**
   * Get session metrics.
   */
  getSessionMetrics(bucket: TimeBucket = 'day'): SessionMetrics {
    const cutoff = this.getBucketCutoff(bucket);
    const recentEvents = this.events.filter(
      (e) => new Date(e.timestamp).getTime() >= cutoff,
    );

    const sessions = recentEvents.filter((e) => e.category === 'session' && e.action === 'end');
    const sessionDurations = sessions
      .filter((e) => e.durationMs !== undefined)
      .map((e) => e.durationMs! / 60_000);

    const avgDuration = sessionDurations.length > 0
      ? sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length
      : 0;

    const imagesCaptured = recentEvents.filter(
      (e) => e.category === 'image' && e.action === 'captured',
    ).length;

    const imagesProcessed = recentEvents.filter(
      (e) => e.category === 'image' && e.action === 'processed',
    ).length;

    const voiceCommands = recentEvents.filter(
      (e) => e.category === 'voice' && e.action === 'command',
    ).length;

    const ttsDeliveries = recentEvents.filter(
      (e) => e.category === 'voice' && e.action === 'tts_delivered',
    ).length;

    const chainsExecuted = recentEvents.filter(
      (e) => e.category === 'chain' && e.action === 'completed',
    ).length;

    // Find top agent
    const agentCounts: Record<string, number> = {};
    for (const e of recentEvents.filter((e) => e.category === 'agent')) {
      if (e.agentId) {
        agentCounts[e.agentId] = (agentCounts[e.agentId] || 0) + 1;
      }
    }
    const topAgent = Object.entries(agentCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

    // Find top voice command
    const voiceCounts: Record<string, number> = {};
    for (const e of recentEvents.filter((e) => e.category === 'voice' && e.action === 'command')) {
      const cmd = (e.label || 'unknown');
      voiceCounts[cmd] = (voiceCounts[cmd] || 0) + 1;
    }
    const topVoiceCommand = Object.entries(voiceCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

    return {
      totalSessions: sessions.length,
      averageSessionDurationMin: Math.round(avgDuration * 10) / 10,
      totalActiveTimeMin: Math.round(sessionDurations.reduce((a, b) => a + b, 0) * 10) / 10,
      imagesCaptured,
      imagesProcessed,
      voiceCommands,
      ttsDeliveries,
      chainsExecuted,
      topAgent,
      topVoiceCommand,
    };
  }

  /**
   * Get value generation metrics (the money slide).
   */
  getValueMetrics(bucket: TimeBucket = 'day'): ValueMetrics {
    const cutoff = this.getBucketCutoff(bucket);
    const valueEvents = this.events.filter(
      (e) => e.category === 'value' && new Date(e.timestamp).getTime() >= cutoff,
    );

    const sum = (action: string): number =>
      valueEvents
        .filter((e) => e.action === action)
        .reduce((total, e) => total + (e.value || 0), 0);

    const count = (category: AnalyticsEventCategory, action: string): number =>
      this.events.filter(
        (e) =>
          e.category === category &&
          e.action === action &&
          new Date(e.timestamp).getTime() >= cutoff,
      ).length;

    return {
      estimatedMoneySaved: Math.round(sum('deal_savings') * 100) / 100,
      currency: this.config.currency,
      estimatedTimeSavedMin: Math.round(sum('time_saved')),
      itemsInventoried: count('inventory', 'item_counted'),
      contactsScanned: count('agent', 'networking_scan'),
      inspectionsCompleted: count('agent', 'inspection_completed'),
      threatsDetected: count('agent', 'security_threat'),
      meetingsTranscribed: count('agent', 'meeting_transcribed'),
      translationsPerformed: count('agent', 'translation_performed'),
      debugAssists: count('agent', 'debug_assist'),
      dealsAnalyzed: count('agent', 'deal_analyzed'),
    };
  }

  /**
   * Get full dashboard overview.
   */
  getDashboard(bucket: TimeBucket = 'day'): AnalyticsDashboard {
    const cutoff = this.getBucketCutoff(bucket);
    const recentEvents = this.events.filter(
      (e) => new Date(e.timestamp).getTime() >= cutoff,
    );

    // Events by category
    const eventsByCategory: Record<string, number> = {};
    for (const e of recentEvents) {
      eventsByCategory[e.category] = (eventsByCategory[e.category] || 0) + 1;
    }

    // Error rate
    const errors = recentEvents.filter((e) => e.category === 'error').length;
    const errorRate = recentEvents.length > 0 ? errors / recentEvents.length : 0;

    // Unique agent IDs
    const agentIds = new Set(
      recentEvents
        .filter((e) => e.agentId)
        .map((e) => e.agentId!),
    );

    const agents = Array.from(agentIds).map((id) => this.getAgentMetrics(id));

    return {
      period: bucket,
      periodStart: new Date(cutoff).toISOString(),
      periodEnd: new Date().toISOString(),
      sessions: this.getSessionMetrics(bucket),
      value: this.getValueMetrics(bucket),
      agents,
      totalEvents: recentEvents.length,
      errorRate: Math.round(errorRate * 10000) / 10000,
      eventsByCategory,
    };
  }

  /**
   * Get total event count.
   */
  getTotalEvents(): number {
    return this.events.length;
  }

  /**
   * Clear all tracked data.
   */
  reset(): void {
    this.events = [];
    this.milestones.clear();
    this.activeTimers.clear();
    this.sessionStarts.clear();
  }

  // ─── Convenience Trackers ─────────────────────────────────

  /**
   * Track an image capture event.
   */
  trackImageCapture(imageId: string, trigger: string): AnalyticsEvent {
    return this.track('image', 'captured', {
      label: trigger,
      metadata: { imageId },
    });
  }

  /**
   * Track an image processing completion.
   */
  trackImageProcessed(imageId: string, durationMs: number, success: boolean): AnalyticsEvent {
    return this.track('image', 'processed', {
      value: durationMs,
      durationMs,
      success,
      metadata: { imageId },
    });
  }

  /**
   * Track an agent invocation.
   */
  trackAgentInvocation(
    agentId: string,
    action: string,
    durationMs: number,
    success: boolean,
    metadata?: Record<string, unknown>,
  ): AnalyticsEvent {
    return this.track('agent', action, {
      agentId,
      durationMs,
      value: durationMs,
      success,
      metadata,
    });
  }

  /**
   * Track a voice command.
   */
  trackVoiceCommand(intent: string, confidence: number): AnalyticsEvent {
    return this.track('voice', 'command', {
      label: intent,
      value: confidence,
      metadata: { intent, confidence },
    });
  }

  /**
   * Track a TTS delivery.
   */
  trackTtsDelivery(priority: string, length: number): AnalyticsEvent {
    return this.track('voice', 'tts_delivered', {
      label: priority,
      value: length,
    });
  }

  /**
   * Track an error.
   */
  trackError(source: string, message: string, metadata?: Record<string, unknown>): AnalyticsEvent {
    return this.track('error', source, {
      label: message,
      success: false,
      metadata,
    });
  }

  /**
   * Track a chain completion.
   */
  trackChainCompleted(chainId: string, durationMs: number, success: boolean): AnalyticsEvent {
    return this.track('chain', 'completed', {
      label: chainId,
      durationMs,
      value: durationMs,
      success,
    });
  }

  // ─── Milestones ───────────────────────────────────────────

  private checkMilestones(event: AnalyticsEvent): void {
    const milestoneThresholds: Record<string, number[]> = {
      image_captured: [10, 50, 100, 500, 1000, 5000, 10000],
      agent_invocation: [10, 50, 100, 500, 1000],
      items_inventoried: [100, 500, 1000, 5000, 10000],
      money_saved: [10, 50, 100, 500, 1000, 5000],
    };

    // Check image milestone
    if (event.category === 'image' && event.action === 'captured') {
      const count = this.events.filter(
        (e) => e.category === 'image' && e.action === 'captured',
      ).length;
      this.checkThreshold('image_captured', count, milestoneThresholds.image_captured);
    }

    // Check agent milestone
    if (event.category === 'agent') {
      const count = this.events.filter((e) => e.category === 'agent').length;
      this.checkThreshold('agent_invocation', count, milestoneThresholds.agent_invocation);
    }
  }

  private checkThreshold(name: string, current: number, thresholds: number[]): void {
    const lastMilestone = this.milestones.get(name) || 0;

    for (const threshold of thresholds) {
      if (current >= threshold && lastMilestone < threshold) {
        this.milestones.set(name, threshold);
        this.emit('analytics:milestone', name, threshold);
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  private getBucketCutoff(bucket: TimeBucket): number {
    const now = Date.now();
    switch (bucket) {
      case 'minute': return now - 60_000;
      case 'hour': return now - 3_600_000;
      case 'day': return now - 86_400_000;
      case 'week': return now - 604_800_000;
      case 'month': return now - 2_592_000_000;
      case 'all': return 0;
      default: return now - 86_400_000;
    }
  }

  private getEventsForBucket(
    category: AnalyticsEventCategory,
    action: string,
    bucket: TimeBucket,
  ): AnalyticsEvent[] {
    const cutoff = this.getBucketCutoff(bucket);
    return this.events.filter(
      (e) =>
        e.category === category &&
        e.action === action &&
        new Date(e.timestamp).getTime() >= cutoff,
    );
  }

  private aggregateEvents(
    name: string,
    events: AnalyticsEvent[],
    bucket: TimeBucket,
  ): AggregatedMetric {
    const values = events
      .filter((e) => e.value !== undefined)
      .map((e) => e.value!);

    const successful = events.filter((e) => e.success === true).length;
    const hasSuccessInfo = events.some((e) => e.success !== undefined);

    const sortedValues = [...values].sort((a, b) => a - b);
    const p95Index = Math.min(
      Math.ceil(sortedValues.length * 0.95) - 1,
      sortedValues.length - 1,
    );

    return {
      name,
      bucket,
      periodStart: new Date(this.getBucketCutoff(bucket)).toISOString(),
      count: events.length,
      totalValue: values.reduce((a, b) => a + b, 0),
      averageValue: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
      minValue: sortedValues.length > 0 ? sortedValues[0] : 0,
      maxValue: sortedValues.length > 0 ? sortedValues[sortedValues.length - 1] : 0,
      p95Value: sortedValues.length > 0 ? sortedValues[Math.max(0, p95Index)] : 0,
      successRate: hasSuccessInfo && events.length > 0 ? successful / events.length : 1,
    };
  }
}
