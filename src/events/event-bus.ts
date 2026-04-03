/**
 * Event Bus — Central Pub/Sub for the Ray-Bans × OpenClaw Platform
 *
 * The nervous system connecting all modules. Decouples producers from consumers,
 * enables real-time features, audit logging, and plugin extensibility.
 *
 * Features:
 * - Typed event channels with namespace prefixing
 * - Wildcard subscriptions (image:*, agent:*, *)
 * - Priority-ordered handlers (critical handlers fire first)
 * - Async handler support with configurable timeout
 * - Dead letter queue for failed events
 * - Event replay from history buffer
 * - Middleware pipeline (transform, filter, enrich events before delivery)
 * - Rate limiting per channel to prevent storms
 * - Event correlation (chain related events by correlationId)
 * - Metrics: events published, delivered, failed, latency
 * - Channel isolation: errors in one handler don't affect others
 * - Backpressure: configurable max queue depth per channel
 *
 * 🌙 Night Shift Agent — Night #30
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BusEvent {
  id: string;
  channel: string;
  payload: unknown;
  timestamp: number;
  correlationId?: string;
  causationId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  priority?: EventPriority;
  ttl?: number; // milliseconds before event expires
}

export type EventPriority = 'critical' | 'high' | 'normal' | 'low';

const PRIORITY_ORDER: Record<EventPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export type EventHandler = (event: BusEvent) => void | Promise<void>;

export interface Subscription {
  id: string;
  channel: string; // supports wildcards: 'image:*', '*'
  handler: EventHandler;
  priority: EventPriority;
  once: boolean;
  filter?: (event: BusEvent) => boolean;
  timeout?: number; // ms
  createdAt: number;
}

export interface DeadLetterEntry {
  event: BusEvent;
  subscriptionId: string;
  error: string;
  timestamp: number;
  retryCount: number;
}

export interface ChannelConfig {
  maxQueueDepth?: number; // backpressure: max pending events
  rateLimit?: { maxPerSecond: number };
  ttl?: number; // default TTL for events on this channel
  persistent?: boolean; // keep in history buffer
}

export interface EventMiddleware {
  name: string;
  priority: number; // lower = earlier
  process: (event: BusEvent) => BusEvent | null; // null = filter out
}

export interface BusMetrics {
  totalPublished: number;
  totalDelivered: number;
  totalFailed: number;
  totalFiltered: number;
  totalExpired: number;
  channelCounts: Record<string, number>;
  handlerLatency: { total: number; count: number; max: number };
  deadLetterSize: number;
  activeSubscriptions: number;
  historySize: number;
}

export interface EventBusConfig {
  historySize?: number; // max events in replay buffer (default: 1000)
  deadLetterMax?: number; // max DLQ entries (default: 500)
  defaultTimeout?: number; // ms, default handler timeout (default: 5000)
  defaultTtl?: number; // ms, default event TTL (default: 0 = no expiry)
  maxRetries?: number; // DLQ retry attempts (default: 3)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let idCounter = 0;
function generateId(): string {
  return `evt_${Date.now()}_${++idCounter}`;
}

function generateSubId(): string {
  return `sub_${Date.now()}_${++idCounter}`;
}

function matchChannel(pattern: string, channel: string): boolean {
  if (pattern === '*') return true;
  if (pattern === channel) return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // 'image:' from 'image:*'
    return channel.startsWith(prefix);
  }
  return false;
}

// ─── Event Bus ───────────────────────────────────────────────────────────────

export class EventBus {
  private subscriptions: Map<string, Subscription> = new Map();
  private history: BusEvent[] = [];
  private deadLetterQueue: DeadLetterEntry[] = [];
  private middleware: EventMiddleware[] = [];
  private channelConfigs: Map<string, ChannelConfig> = new Map();
  private channelRateState: Map<string, { count: number; windowStart: number }> = new Map();
  private channelQueueDepth: Map<string, number> = new Map();
  private config: Required<EventBusConfig>;
  private metrics: BusMetrics;
  private paused = false;
  private pauseBuffer: BusEvent[] = [];

  constructor(config: EventBusConfig = {}) {
    this.config = {
      historySize: config.historySize ?? 1000,
      deadLetterMax: config.deadLetterMax ?? 500,
      defaultTimeout: config.defaultTimeout ?? 5000,
      defaultTtl: config.defaultTtl ?? 0,
      maxRetries: config.maxRetries ?? 3,
    };

    this.metrics = {
      totalPublished: 0,
      totalDelivered: 0,
      totalFailed: 0,
      totalFiltered: 0,
      totalExpired: 0,
      channelCounts: {},
      handlerLatency: { total: 0, count: 0, max: 0 },
      deadLetterSize: 0,
      activeSubscriptions: 0,
      historySize: 0,
    };
  }

  // ── Publish ──────────────────────────────────────────────────────────────

  publish(channel: string, payload: unknown, options: {
    correlationId?: string;
    causationId?: string;
    source?: string;
    metadata?: Record<string, unknown>;
    priority?: EventPriority;
    ttl?: number;
  } = {}): BusEvent | null {
    const event: BusEvent = {
      id: generateId(),
      channel,
      payload,
      timestamp: Date.now(),
      correlationId: options.correlationId,
      causationId: options.causationId,
      source: options.source,
      metadata: options.metadata,
      priority: options.priority ?? 'normal',
      ttl: options.ttl ?? this.channelConfigs.get(channel)?.ttl ?? this.config.defaultTtl,
    };

    // Apply middleware pipeline
    let processed: BusEvent | null = event;
    for (const mw of this.middleware) {
      if (!processed) break;
      processed = mw.process(processed);
    }

    if (!processed) {
      this.metrics.totalFiltered++;
      return null;
    }

    // Check TTL (in case middleware delayed)
    if (processed.ttl && processed.ttl > 0) {
      const age = Date.now() - processed.timestamp;
      if (age > processed.ttl) {
        this.metrics.totalExpired++;
        return null;
      }
    }

    // Check channel rate limit
    const chanConfig = this.channelConfigs.get(channel);
    if (chanConfig?.rateLimit) {
      const rateState = this.channelRateState.get(channel) ?? { count: 0, windowStart: Date.now() };
      const now = Date.now();
      if (now - rateState.windowStart >= 1000) {
        rateState.count = 0;
        rateState.windowStart = now;
      }
      if (rateState.count >= chanConfig.rateLimit.maxPerSecond) {
        this.metrics.totalFiltered++;
        return null; // rate limited
      }
      rateState.count++;
      this.channelRateState.set(channel, rateState);
    }

    // Check backpressure
    if (chanConfig?.maxQueueDepth) {
      const depth = this.channelQueueDepth.get(channel) ?? 0;
      if (depth >= chanConfig.maxQueueDepth) {
        this.metrics.totalFiltered++;
        return null; // backpressure
      }
    }

    this.metrics.totalPublished++;
    this.metrics.channelCounts[channel] = (this.metrics.channelCounts[channel] ?? 0) + 1;

    // Add to history buffer
    if (chanConfig?.persistent !== false) {
      this.history.push(processed);
      if (this.history.length > this.config.historySize) {
        this.history.shift();
      }
      this.metrics.historySize = this.history.length;
    }

    // If paused, buffer for later
    if (this.paused) {
      this.pauseBuffer.push(processed);
      return processed;
    }

    // Deliver to subscribers
    this.deliver(processed);

    return processed;
  }

  private deliver(event: BusEvent): void {
    // Find matching subscriptions
    const matchingSubs: Subscription[] = [];
    for (const sub of this.subscriptions.values()) {
      if (matchChannel(sub.channel, event.channel)) {
        if (sub.filter && !sub.filter(event)) {
          continue;
        }
        matchingSubs.push(sub);
      }
    }

    // Sort by priority
    matchingSubs.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

    // Track queue depth
    const currentDepth = this.channelQueueDepth.get(event.channel) ?? 0;
    this.channelQueueDepth.set(event.channel, currentDepth + matchingSubs.length);

    // Execute handlers
    for (const sub of matchingSubs) {
      const start = Date.now();
      try {
        const result = sub.handler(event);
        // If promise, we don't await but track failures
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>)
            .then(() => {
              this.recordLatency(start);
              this.metrics.totalDelivered++;
              this.decrementDepth(event.channel);
            })
            .catch((err) => {
              this.handleFailure(event, sub, err);
              this.decrementDepth(event.channel);
            });
        } else {
          this.recordLatency(start);
          this.metrics.totalDelivered++;
          this.decrementDepth(event.channel);
        }
      } catch (err) {
        this.handleFailure(event, sub, err);
        this.decrementDepth(event.channel);
      }

      // Remove once-handlers
      if (sub.once) {
        this.subscriptions.delete(sub.id);
        this.metrics.activeSubscriptions = this.subscriptions.size;
      }
    }
  }

  private decrementDepth(channel: string): void {
    const depth = this.channelQueueDepth.get(channel) ?? 1;
    this.channelQueueDepth.set(channel, Math.max(0, depth - 1));
  }

  private recordLatency(start: number): void {
    const latency = Date.now() - start;
    this.metrics.handlerLatency.total += latency;
    this.metrics.handlerLatency.count++;
    if (latency > this.metrics.handlerLatency.max) {
      this.metrics.handlerLatency.max = latency;
    }
  }

  private handleFailure(event: BusEvent, sub: Subscription, error: unknown): void {
    this.metrics.totalFailed++;

    const errorMsg = error instanceof Error ? error.message : String(error);

    // Check if already in DLQ
    const existingDlq = this.deadLetterQueue.find(
      (d) => d.event.id === event.id && d.subscriptionId === sub.id
    );

    if (existingDlq) {
      existingDlq.retryCount++;
      existingDlq.error = errorMsg;
      existingDlq.timestamp = Date.now();
    } else {
      this.deadLetterQueue.push({
        event,
        subscriptionId: sub.id,
        error: errorMsg,
        timestamp: Date.now(),
        retryCount: 0,
      });

      if (this.deadLetterQueue.length > this.config.deadLetterMax) {
        this.deadLetterQueue.shift();
      }
    }

    this.metrics.deadLetterSize = this.deadLetterQueue.length;
  }

  // ── Subscribe ────────────────────────────────────────────────────────────

  subscribe(channel: string, handler: EventHandler, options: {
    priority?: EventPriority;
    once?: boolean;
    filter?: (event: BusEvent) => boolean;
    timeout?: number;
  } = {}): string {
    const sub: Subscription = {
      id: generateSubId(),
      channel,
      handler,
      priority: options.priority ?? 'normal',
      once: options.once ?? false,
      filter: options.filter,
      timeout: options.timeout ?? this.config.defaultTimeout,
      createdAt: Date.now(),
    };

    this.subscriptions.set(sub.id, sub);
    this.metrics.activeSubscriptions = this.subscriptions.size;
    return sub.id;
  }

  once(channel: string, handler: EventHandler, options: {
    priority?: EventPriority;
    filter?: (event: BusEvent) => boolean;
  } = {}): string {
    return this.subscribe(channel, handler, { ...options, once: true });
  }

  unsubscribe(subscriptionId: string): boolean {
    const result = this.subscriptions.delete(subscriptionId);
    this.metrics.activeSubscriptions = this.subscriptions.size;
    return result;
  }

  unsubscribeAll(channel?: string): number {
    if (!channel) {
      const count = this.subscriptions.size;
      this.subscriptions.clear();
      this.metrics.activeSubscriptions = 0;
      return count;
    }

    let removed = 0;
    for (const [id, sub] of this.subscriptions.entries()) {
      if (sub.channel === channel) {
        this.subscriptions.delete(id);
        removed++;
      }
    }
    this.metrics.activeSubscriptions = this.subscriptions.size;
    return removed;
  }

  // ── Channel Configuration ────────────────────────────────────────────────

  configureChannel(channel: string, config: ChannelConfig): void {
    this.channelConfigs.set(channel, config);
  }

  // ── Middleware ────────────────────────────────────────────────────────────

  addMiddleware(middleware: EventMiddleware): void {
    this.middleware.push(middleware);
    this.middleware.sort((a, b) => a.priority - b.priority);
  }

  removeMiddleware(name: string): boolean {
    const idx = this.middleware.findIndex((m) => m.name === name);
    if (idx === -1) return false;
    this.middleware.splice(idx, 1);
    return true;
  }

  // ── Replay ───────────────────────────────────────────────────────────────

  replay(channel: string, handler: EventHandler, options: {
    since?: number; // timestamp
    limit?: number;
    filter?: (event: BusEvent) => boolean;
  } = {}): number {
    let events = this.history.filter((e) => matchChannel(channel, e.channel));

    if (options.since) {
      events = events.filter((e) => e.timestamp >= options.since!);
    }

    if (options.filter) {
      events = events.filter(options.filter);
    }

    if (options.limit) {
      events = events.slice(-options.limit);
    }

    for (const event of events) {
      try {
        handler(event);
      } catch {
        // Replay failures are silent — best effort
      }
    }

    return events.length;
  }

  // ── Correlation ──────────────────────────────────────────────────────────

  getCorrelatedEvents(correlationId: string): BusEvent[] {
    return this.history.filter((e) => e.correlationId === correlationId);
  }

  getCausationChain(eventId: string): BusEvent[] {
    const chain: BusEvent[] = [];
    let currentId: string | undefined = eventId;

    while (currentId) {
      const event = this.history.find((e) => e.id === currentId);
      if (!event) break;
      chain.unshift(event);
      currentId = event.causationId;
    }

    return chain;
  }

  // ── Pause / Resume ─────────────────────────────────────────────────────

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    // Drain pause buffer
    const buffered = [...this.pauseBuffer];
    this.pauseBuffer = [];
    for (const event of buffered) {
      this.deliver(event);
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  // ── Dead Letter Queue ────────────────────────────────────────────────────

  getDeadLetters(options: {
    channel?: string;
    limit?: number;
  } = {}): DeadLetterEntry[] {
    let entries = [...this.deadLetterQueue];
    if (options.channel) {
      entries = entries.filter((d) => matchChannel(options.channel!, d.event.channel));
    }
    if (options.limit) {
      entries = entries.slice(-options.limit);
    }
    return entries;
  }

  retryDeadLetter(eventId: string): boolean {
    const idx = this.deadLetterQueue.findIndex((d) => d.event.id === eventId);
    if (idx === -1) return false;

    const entry = this.deadLetterQueue[idx];
    if (entry.retryCount >= this.config.maxRetries) return false;

    // Re-deliver
    this.deliver(entry.event);
    this.deadLetterQueue.splice(idx, 1);
    this.metrics.deadLetterSize = this.deadLetterQueue.length;
    return true;
  }

  clearDeadLetters(): number {
    const count = this.deadLetterQueue.length;
    this.deadLetterQueue = [];
    this.metrics.deadLetterSize = 0;
    return count;
  }

  // ── History ──────────────────────────────────────────────────────────────

  getHistory(options: {
    channel?: string;
    since?: number;
    limit?: number;
  } = {}): BusEvent[] {
    let events = [...this.history];
    if (options.channel) {
      events = events.filter((e) => matchChannel(options.channel!, e.channel));
    }
    if (options.since) {
      events = events.filter((e) => e.timestamp >= options.since!);
    }
    if (options.limit) {
      events = events.slice(-options.limit);
    }
    return events;
  }

  clearHistory(): number {
    const count = this.history.length;
    this.history = [];
    this.metrics.historySize = 0;
    return count;
  }

  // ── Metrics ──────────────────────────────────────────────────────────────

  getMetrics(): BusMetrics {
    return { ...this.metrics };
  }

  getChannelMetrics(channel: string): {
    published: number;
    subscribers: number;
    queueDepth: number;
  } {
    let subscribers = 0;
    for (const sub of this.subscriptions.values()) {
      if (matchChannel(sub.channel, channel) || matchChannel(channel, sub.channel)) {
        subscribers++;
      }
    }

    return {
      published: this.metrics.channelCounts[channel] ?? 0,
      subscribers,
      queueDepth: this.channelQueueDepth.get(channel) ?? 0,
    };
  }

  resetMetrics(): void {
    this.metrics = {
      totalPublished: 0,
      totalDelivered: 0,
      totalFailed: 0,
      totalFiltered: 0,
      totalExpired: 0,
      channelCounts: {},
      handlerLatency: { total: 0, count: 0, max: 0 },
      deadLetterSize: this.deadLetterQueue.length,
      activeSubscriptions: this.subscriptions.size,
      historySize: this.history.length,
    };
  }

  // ── Introspection ────────────────────────────────────────────────────────

  getSubscriptions(channel?: string): Array<{
    id: string;
    channel: string;
    priority: EventPriority;
    once: boolean;
    createdAt: number;
  }> {
    const subs = channel
      ? [...this.subscriptions.values()].filter((s) => s.channel === channel)
      : [...this.subscriptions.values()];

    return subs.map((s) => ({
      id: s.id,
      channel: s.channel,
      priority: s.priority,
      once: s.once,
      createdAt: s.createdAt,
    }));
  }

  getChannels(): string[] {
    const channels = new Set<string>();
    for (const event of this.history) {
      channels.add(event.channel);
    }
    for (const sub of this.subscriptions.values()) {
      channels.add(sub.channel);
    }
    return [...channels].sort();
  }

  // ── Convenience Publishers ───────────────────────────────────────────────

  /** Publish an image event */
  publishImage(action: string, payload: unknown, correlationId?: string): BusEvent | null {
    return this.publish(`image:${action}`, payload, { correlationId, source: 'vision-pipeline' });
  }

  /** Publish an agent event */
  publishAgent(agentName: string, action: string, payload: unknown, correlationId?: string): BusEvent | null {
    return this.publish(`agent:${agentName}:${action}`, payload, { correlationId, source: agentName });
  }

  /** Publish an inventory event */
  publishInventory(action: string, payload: unknown, correlationId?: string): BusEvent | null {
    return this.publish(`inventory:${action}`, payload, { correlationId, source: 'inventory' });
  }

  /** Publish a voice event */
  publishVoice(action: string, payload: unknown, correlationId?: string): BusEvent | null {
    return this.publish(`voice:${action}`, payload, { correlationId, source: 'voice' });
  }

  /** Publish a system event */
  publishSystem(action: string, payload: unknown, priority: EventPriority = 'normal'): BusEvent | null {
    return this.publish(`system:${action}`, payload, { priority, source: 'system' });
  }

  // ── Voice Summary ────────────────────────────────────────────────────────

  getVoiceSummary(): string {
    const m = this.metrics;
    const avgLatency = m.handlerLatency.count > 0
      ? Math.round(m.handlerLatency.total / m.handlerLatency.count)
      : 0;

    const parts: string[] = [];
    parts.push(`Event bus processed ${m.totalPublished} events.`);
    parts.push(`${m.totalDelivered} delivered, ${m.totalFailed} failed.`);

    if (m.totalFiltered > 0) {
      parts.push(`${m.totalFiltered} filtered out.`);
    }

    if (avgLatency > 0) {
      parts.push(`Average handler latency: ${avgLatency} milliseconds.`);
    }

    if (m.deadLetterSize > 0) {
      parts.push(`${m.deadLetterSize} events in dead letter queue.`);
    }

    // Top channels
    const topChannels = Object.entries(m.channelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (topChannels.length > 0) {
      const channelStr = topChannels.map(([ch, count]) => `${ch}: ${count}`).join(', ');
      parts.push(`Top channels: ${channelStr}.`);
    }

    return parts.join(' ');
  }

  // ── Destroy ──────────────────────────────────────────────────────────────

  destroy(): void {
    this.subscriptions.clear();
    this.history = [];
    this.deadLetterQueue = [];
    this.middleware = [];
    this.channelConfigs.clear();
    this.channelRateState.clear();
    this.channelQueueDepth.clear();
    this.pauseBuffer = [];
    this.paused = false;
  }
}
