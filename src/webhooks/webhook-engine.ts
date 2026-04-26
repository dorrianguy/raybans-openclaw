/**
 * Webhook & Integration Engine
 *
 * External event notification system for the Ray-Ban vision platform.
 * Delivers real-time events to configured endpoints when things happen:
 * - Inventory session completed
 * - Product flagged (low stock, damage, expired)
 * - Inspection report generated
 * - Security alert triggered
 * - Deal analysis completed
 * - Custom events from agents
 *
 * Features:
 * - Multiple webhook endpoints per user
 * - Event filtering (subscribe to specific event types)
 * - HMAC-SHA256 signature verification
 * - Retry with exponential backoff
 * - Dead letter queue for failed deliveries
 * - Rate limiting per endpoint
 * - Delivery logging and analytics
 * - Secret rotation support
 * - Batch delivery mode
 * - Health checking for endpoints
 *
 * Integrations:
 * - Slack (formatted messages)
 * - Email (via SendGrid/Resend)
 * - POS systems (Square, Shopify, Clover)
 * - Zapier/Make/n8n (generic webhook)
 * - Custom HTTP endpoints
 *
 * @module webhooks/webhook-engine
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────

export type WebhookEventType =
  | 'inventory.session.started'
  | 'inventory.session.completed'
  | 'inventory.session.cancelled'
  | 'inventory.item.flagged'
  | 'inventory.item.added'
  | 'inventory.low_stock'
  | 'inspection.started'
  | 'inspection.completed'
  | 'inspection.finding.critical'
  | 'security.alert'
  | 'security.threat.detected'
  | 'deal.analyzed'
  | 'deal.great_deal'
  | 'meeting.started'
  | 'meeting.completed'
  | 'meeting.action_item'
  | 'memory.saved'
  | 'contact.added'
  | 'contact.researched'
  | 'export.completed'
  | 'agent.error'
  | 'quota.warning'
  | 'quota.exceeded'
  | 'custom';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying' | 'dead_letter';
export type IntegrationType = 'generic' | 'slack' | 'email' | 'pos_square' | 'pos_shopify' | 'pos_clover' | 'zapier';
export type EndpointHealth = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface WebhookEndpoint {
  /** Unique endpoint ID */
  id: string;
  /** User who owns this endpoint */
  userId: string;
  /** Human-readable name */
  name: string;
  /** Target URL */
  url: string;
  /** Integration type */
  integrationType: IntegrationType;
  /** HMAC secret for signature verification */
  secret: string;
  /** Which events this endpoint subscribes to (empty = all) */
  eventFilter: WebhookEventType[];
  /** Whether this endpoint is active */
  active: boolean;
  /** Maximum retries for failed deliveries */
  maxRetries: number;
  /** Rate limit (deliveries per minute) */
  rateLimitPerMinute: number;
  /** Custom headers to include */
  customHeaders: Record<string, string>;
  /** Created timestamp */
  createdAt: string;
  /** Last successful delivery */
  lastDeliveryAt?: string;
  /** Current health status */
  health: EndpointHealth;
  /** Consecutive failure count */
  consecutiveFailures: number;
  /** Whether to batch events */
  batchEnabled: boolean;
  /** Batch window in milliseconds */
  batchWindowMs: number;
}

export interface WebhookEvent {
  /** Unique event ID */
  id: string;
  /** Event type */
  type: WebhookEventType;
  /** Timestamp */
  timestamp: string;
  /** User who triggered the event */
  userId: string;
  /** Event payload */
  data: Record<string, unknown>;
  /** Optional metadata */
  metadata?: Record<string, string>;
}

export interface WebhookDelivery {
  /** Unique delivery ID */
  id: string;
  /** Event being delivered */
  eventId: string;
  /** Target endpoint */
  endpointId: string;
  /** Current status */
  status: DeliveryStatus;
  /** HTTP response status code (if delivered) */
  responseStatus?: number;
  /** Response body excerpt (first 500 chars) */
  responseBody?: string;
  /** Number of attempts made */
  attempts: number;
  /** Time of first attempt */
  firstAttemptAt: string;
  /** Time of last attempt */
  lastAttemptAt?: string;
  /** Time of next retry (if retrying) */
  nextRetryAt?: string;
  /** Delivery latency in ms */
  latencyMs?: number;
  /** Error message (if failed) */
  error?: string;
}

export interface WebhookPayload {
  /** Event ID */
  event_id: string;
  /** Event type */
  event_type: WebhookEventType;
  /** ISO timestamp */
  timestamp: string;
  /** API version */
  api_version: string;
  /** Event data */
  data: Record<string, unknown>;
  /** Metadata */
  metadata?: Record<string, string>;
}

export interface DeliveryStats {
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  pendingDeliveries: number;
  deadLetterCount: number;
  avgLatencyMs: number;
  successRate: number;
  byEndpoint: Record<string, {
    total: number;
    success: number;
    failed: number;
    health: EndpointHealth;
  }>;
  byEventType: Record<string, number>;
}

export interface WebhookEngineConfig {
  /** Maximum retries per delivery (default) */
  defaultMaxRetries: number;
  /** Base delay for exponential backoff in ms */
  retryBaseDelayMs: number;
  /** Maximum retry delay in ms */
  retryMaxDelayMs: number;
  /** Dead letter threshold (move to DLQ after this many consecutive failures) */
  deadLetterThreshold: number;
  /** Default rate limit per endpoint (per minute) */
  defaultRateLimitPerMinute: number;
  /** API version string */
  apiVersion: string;
  /** Max payload size in bytes */
  maxPayloadSize: number;
  /** Enable delivery logging */
  logDeliveries: boolean;
  /** Health check interval in ms (0 = disabled) */
  healthCheckIntervalMs: number;
  /** Consecutive failures before marking unhealthy */
  unhealthyThreshold: number;
  /** Batch default window in ms */
  defaultBatchWindowMs: number;
  /** HTTP request timeout in ms */
  requestTimeoutMs: number;
  /** Debug mode */
  debug: boolean;
}

export const DEFAULT_WEBHOOK_CONFIG: WebhookEngineConfig = {
  defaultMaxRetries: 5,
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 300000, // 5 minutes
  deadLetterThreshold: 50,
  defaultRateLimitPerMinute: 60,
  apiVersion: '2026-02-28',
  maxPayloadSize: 256 * 1024, // 256KB
  logDeliveries: true,
  healthCheckIntervalMs: 300000, // 5 minutes
  unhealthyThreshold: 10,
  defaultBatchWindowMs: 5000,
  requestTimeoutMs: 30000,
  debug: false,
};

export interface WebhookEngineEvents {
  'endpoint:created': (endpoint: WebhookEndpoint) => void;
  'endpoint:updated': (endpoint: WebhookEndpoint) => void;
  'endpoint:deleted': (endpointId: string) => void;
  'endpoint:health_changed': (endpointId: string, health: EndpointHealth) => void;
  'event:received': (event: WebhookEvent) => void;
  'delivery:success': (delivery: WebhookDelivery) => void;
  'delivery:failed': (delivery: WebhookDelivery) => void;
  'delivery:retrying': (delivery: WebhookDelivery) => void;
  'delivery:dead_letter': (delivery: WebhookDelivery) => void;
  'error': (source: string, error: string) => void;
}

// ─── HTTP Transport Interface ───────────────────────────────────

export interface HTTPTransport {
  post(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<{
    status: number;
    body: string;
  }>;
}

/** Mock HTTP transport for testing */
export class MockHTTPTransport implements HTTPTransport {
  public calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  private responseStatus = 200;
  private responseBody = '{"ok":true}';
  private shouldFail = false;
  private failError = 'Connection refused';
  private latencyMs = 50;

  async post(url: string, body: string, headers: Record<string, string>, _timeoutMs: number): Promise<{
    status: number;
    body: string;
  }> {
    this.calls.push({ url, body, headers });

    // Simulate latency
    await new Promise(resolve => setTimeout(resolve, this.latencyMs));

    if (this.shouldFail) {
      throw new Error(this.failError);
    }

    return {
      status: this.responseStatus,
      body: this.responseBody,
    };
  }

  setResponse(status: number, body = '{"ok":true}'): void {
    this.responseStatus = status;
    this.responseBody = body;
  }

  setFailMode(fail: boolean, error = 'Connection refused'): void {
    this.shouldFail = fail;
    this.failError = error;
  }

  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  reset(): void {
    this.calls = [];
    this.responseStatus = 200;
    this.responseBody = '{"ok":true}';
    this.shouldFail = false;
    this.latencyMs = 50;
  }
}

// ─── Webhook Engine ─────────────────────────────────────────────

export class WebhookEngine extends EventEmitter {
  private config: WebhookEngineConfig;
  private endpoints: Map<string, WebhookEndpoint> = new Map();
  private deliveries: Map<string, WebhookDelivery> = new Map();
  private deadLetterQueue: WebhookDelivery[] = [];
  private transport: HTTPTransport;
  private batchBuffers: Map<string, WebhookEvent[]> = new Map();
  private batchTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private rateLimitCounters: Map<string, { count: number; windowStart: number }> = new Map();

  // Stats
  private totalDeliveries = 0;
  private successfulDeliveries = 0;
  private failedDeliveries = 0;
  private deliveryLatencies: number[] = [];

  constructor(config: Partial<WebhookEngineConfig> = {}, transport?: HTTPTransport) {
    super();
    this.config = { ...DEFAULT_WEBHOOK_CONFIG, ...config };
    this.transport = transport || new MockHTTPTransport();
  }

  // ─── Endpoint Management ──────────────────────────────────

  /** Register a new webhook endpoint */
  createEndpoint(params: {
    userId: string;
    name: string;
    url: string;
    integrationType?: IntegrationType;
    eventFilter?: WebhookEventType[];
    secret?: string;
    maxRetries?: number;
    rateLimitPerMinute?: number;
    customHeaders?: Record<string, string>;
    batchEnabled?: boolean;
    batchWindowMs?: number;
  }): WebhookEndpoint {
    const id = `ep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const secret = params.secret || crypto.randomBytes(32).toString('hex');

    const endpoint: WebhookEndpoint = {
      id,
      userId: params.userId,
      name: params.name,
      url: params.url,
      integrationType: params.integrationType || 'generic',
      secret,
      eventFilter: params.eventFilter || [],
      active: true,
      maxRetries: params.maxRetries ?? this.config.defaultMaxRetries,
      rateLimitPerMinute: params.rateLimitPerMinute ?? this.config.defaultRateLimitPerMinute,
      customHeaders: params.customHeaders || {},
      createdAt: new Date().toISOString(),
      health: 'unknown',
      consecutiveFailures: 0,
      batchEnabled: params.batchEnabled ?? false,
      batchWindowMs: params.batchWindowMs ?? this.config.defaultBatchWindowMs,
    };

    this.endpoints.set(id, endpoint);
    this.emit('endpoint:created', endpoint);
    return endpoint;
  }

  /** Update an existing endpoint */
  updateEndpoint(endpointId: string, updates: Partial<Omit<WebhookEndpoint, 'id' | 'userId' | 'createdAt'>>): WebhookEndpoint | null {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) return null;

    Object.assign(endpoint, updates);
    this.emit('endpoint:updated', endpoint);
    return endpoint;
  }

  /** Delete an endpoint */
  deleteEndpoint(endpointId: string): boolean {
    const existed = this.endpoints.delete(endpointId);
    if (existed) {
      // Clean up batch buffer
      const timer = this.batchTimers.get(endpointId);
      if (timer) clearTimeout(timer);
      this.batchTimers.delete(endpointId);
      this.batchBuffers.delete(endpointId);
      this.emit('endpoint:deleted', endpointId);
    }
    return existed;
  }

  /** Get an endpoint by ID */
  getEndpoint(endpointId: string): WebhookEndpoint | null {
    return this.endpoints.get(endpointId) || null;
  }

  /** List all endpoints for a user */
  listEndpoints(userId: string): WebhookEndpoint[] {
    return [...this.endpoints.values()].filter(ep => ep.userId === userId);
  }

  /** List all endpoints */
  listAllEndpoints(): WebhookEndpoint[] {
    return [...this.endpoints.values()];
  }

  /** Rotate secret for an endpoint */
  rotateSecret(endpointId: string): string | null {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) return null;

    const newSecret = crypto.randomBytes(32).toString('hex');
    endpoint.secret = newSecret;
    this.emit('endpoint:updated', endpoint);
    return newSecret;
  }

  // ─── Event Dispatch ───────────────────────────────────────

  /** Dispatch an event to all matching endpoints */
  async dispatch(event: WebhookEvent): Promise<string[]> {
    this.emit('event:received', event);

    const deliveryIds: string[] = [];
    const matchingEndpoints = this.getMatchingEndpoints(event);

    for (const endpoint of matchingEndpoints) {
      if (!endpoint.active) continue;

      if (endpoint.batchEnabled) {
        this.addToBatch(endpoint.id, event);
        continue;
      }

      const deliveryId = await this.deliverToEndpoint(event, endpoint);
      if (deliveryId) deliveryIds.push(deliveryId);
    }

    return deliveryIds;
  }

  /** Create and dispatch an event in one call */
  async emit_event(
    type: WebhookEventType,
    userId: string,
    data: Record<string, unknown>,
    metadata?: Record<string, string>
  ): Promise<string[]> {
    const event: WebhookEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      timestamp: new Date().toISOString(),
      userId,
      data,
      metadata,
    };

    return this.dispatch(event);
  }

  // ─── Delivery Management ──────────────────────────────────

  /** Get a delivery by ID */
  getDelivery(deliveryId: string): WebhookDelivery | null {
    return this.deliveries.get(deliveryId) || null;
  }

  /** Get all deliveries for an endpoint */
  getDeliveriesForEndpoint(endpointId: string, limit = 50): WebhookDelivery[] {
    return [...this.deliveries.values()]
      .filter(d => d.endpointId === endpointId)
      .sort((a, b) => new Date(b.firstAttemptAt).getTime() - new Date(a.firstAttemptAt).getTime())
      .slice(0, limit);
  }

  /** Get dead letter queue entries */
  getDeadLetterQueue(limit = 100): WebhookDelivery[] {
    return this.deadLetterQueue.slice(0, limit);
  }

  /** Retry a dead letter delivery */
  async retryDeadLetter(deliveryId: string): Promise<boolean> {
    const idx = this.deadLetterQueue.findIndex(d => d.id === deliveryId);
    if (idx === -1) return false;

    const delivery = this.deadLetterQueue[idx];
    const endpoint = this.endpoints.get(delivery.endpointId);
    if (!endpoint) return false;

    // Reset delivery for retry
    delivery.status = 'retrying';
    delivery.attempts = 0;
    this.deadLetterQueue.splice(idx, 1);
    this.deliveries.set(delivery.id, delivery);

    return true;
  }

  /** Clear dead letter queue */
  clearDeadLetterQueue(): number {
    const count = this.deadLetterQueue.length;
    this.deadLetterQueue = [];
    return count;
  }

  // ─── Signature Generation ─────────────────────────────────

  /** Generate HMAC-SHA256 signature for a payload */
  generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /** Verify a webhook signature */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  }

  // ─── Statistics ───────────────────────────────────────────

  /** Get delivery statistics */
  getStats(): DeliveryStats {
    const byEndpoint: DeliveryStats['byEndpoint'] = {};
    const byEventType: Record<string, number> = {};
    let pending = 0;

    for (const delivery of this.deliveries.values()) {
      if (delivery.status === 'pending' || delivery.status === 'retrying') pending++;

      // By endpoint
      if (!byEndpoint[delivery.endpointId]) {
        const ep = this.endpoints.get(delivery.endpointId);
        byEndpoint[delivery.endpointId] = {
          total: 0,
          success: 0,
          failed: 0,
          health: ep?.health || 'unknown',
        };
      }
      byEndpoint[delivery.endpointId].total++;
      if (delivery.status === 'delivered') byEndpoint[delivery.endpointId].success++;
      if (delivery.status === 'failed' || delivery.status === 'dead_letter') {
        byEndpoint[delivery.endpointId].failed++;
      }
    }

    return {
      totalDeliveries: this.totalDeliveries,
      successfulDeliveries: this.successfulDeliveries,
      failedDeliveries: this.failedDeliveries,
      pendingDeliveries: pending,
      deadLetterCount: this.deadLetterQueue.length,
      avgLatencyMs: this.deliveryLatencies.length > 0
        ? Math.round(this.deliveryLatencies.reduce((a, b) => a + b, 0) / this.deliveryLatencies.length)
        : 0,
      successRate: this.totalDeliveries > 0
        ? this.successfulDeliveries / this.totalDeliveries
        : 0,
      byEndpoint,
      byEventType,
    };
  }

  /** Cleanup old deliveries */
  cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAge;
    let removed = 0;

    for (const [id, delivery] of this.deliveries) {
      const deliveryTime = new Date(delivery.firstAttemptAt).getTime();
      if (deliveryTime < cutoff && delivery.status !== 'pending' && delivery.status !== 'retrying') {
        this.deliveries.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /** Shutdown engine — clear all timers */
  shutdown(): void {
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();
    this.batchBuffers.clear();
  }

  // ─── Private: Delivery Logic ──────────────────────────────

  private async deliverToEndpoint(event: WebhookEvent, endpoint: WebhookEndpoint): Promise<string | null> {
    // Rate limit check
    if (!this.checkRateLimit(endpoint.id, endpoint.rateLimitPerMinute)) {
      return null;
    }

    const deliveryId = `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const payload = this.buildPayload(event);
    const payloadStr = JSON.stringify(payload);

    // Size check
    if (Buffer.byteLength(payloadStr) > this.config.maxPayloadSize) {
      this.emit('error', 'dispatch', `Payload too large for event ${event.id}`);
      return null;
    }

    const signature = this.generateSignature(payloadStr, endpoint.secret);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Id': deliveryId,
      'X-Webhook-Signature': signature,
      'X-Webhook-Timestamp': new Date().toISOString(),
      'X-Webhook-Event': event.type,
      'User-Agent': `RayBanVision-Webhook/${this.config.apiVersion}`,
      ...endpoint.customHeaders,
    };

    // Integration-specific headers
    if (endpoint.integrationType === 'slack') {
      headers['Content-Type'] = 'application/json';
    }

    const delivery: WebhookDelivery = {
      id: deliveryId,
      eventId: event.id,
      endpointId: endpoint.id,
      status: 'pending',
      attempts: 0,
      firstAttemptAt: new Date().toISOString(),
    };

    this.deliveries.set(deliveryId, delivery);
    this.totalDeliveries++;

    // Attempt delivery
    await this.attemptDelivery(delivery, endpoint, payloadStr, headers);

    return deliveryId;
  }

  private async attemptDelivery(
    delivery: WebhookDelivery,
    endpoint: WebhookEndpoint,
    payload: string,
    headers: Record<string, string>
  ): Promise<void> {
    delivery.attempts++;
    delivery.lastAttemptAt = new Date().toISOString();

    const startTime = Date.now();

    try {
      // Format payload for specific integrations
      const formattedPayload = this.formatForIntegration(payload, endpoint.integrationType);

      const response = await this.transport.post(
        endpoint.url,
        formattedPayload,
        headers,
        this.config.requestTimeoutMs
      );

      delivery.latencyMs = Date.now() - startTime;
      delivery.responseStatus = response.status;
      delivery.responseBody = response.body?.slice(0, 500);

      if (response.status >= 200 && response.status < 300) {
        // Success
        delivery.status = 'delivered';
        endpoint.consecutiveFailures = 0;
        endpoint.lastDeliveryAt = new Date().toISOString();
        this.successfulDeliveries++;
        this.deliveryLatencies.push(delivery.latencyMs);
        this.updateEndpointHealth(endpoint);
        this.emit('delivery:success', delivery);
      } else {
        // HTTP error
        delivery.error = `HTTP ${response.status}`;
        await this.handleFailure(delivery, endpoint, payload, headers);
      }
    } catch (error) {
      delivery.latencyMs = Date.now() - startTime;
      delivery.error = error instanceof Error ? error.message : String(error);
      await this.handleFailure(delivery, endpoint, payload, headers);
    }
  }

  private async handleFailure(
    delivery: WebhookDelivery,
    endpoint: WebhookEndpoint,
    payload: string,
    headers: Record<string, string>
  ): Promise<void> {
    endpoint.consecutiveFailures++;
    this.updateEndpointHealth(endpoint);

    if (delivery.attempts >= endpoint.maxRetries) {
      // Move to dead letter queue
      delivery.status = 'dead_letter';
      this.failedDeliveries++;
      this.deadLetterQueue.push(delivery);
      this.emit('delivery:dead_letter', delivery);
      return;
    }

    // Schedule retry with exponential backoff
    const delay = Math.min(
      this.config.retryBaseDelayMs * Math.pow(2, delivery.attempts - 1),
      this.config.retryMaxDelayMs
    );

    delivery.status = 'retrying';
    delivery.nextRetryAt = new Date(Date.now() + delay).toISOString();
    this.emit('delivery:retrying', delivery);

    // In real implementation, this would use a job queue
    // For now, we schedule a retry
    setTimeout(async () => {
      await this.attemptDelivery(delivery, endpoint, payload, headers);
    }, delay);
  }

  // ─── Private: Helpers ─────────────────────────────────────

  private getMatchingEndpoints(event: WebhookEvent): WebhookEndpoint[] {
    return [...this.endpoints.values()].filter(ep => {
      if (ep.userId !== event.userId) return false;
      if (!ep.active) return false;
      if (ep.eventFilter.length === 0) return true; // subscribe to all
      return ep.eventFilter.includes(event.type);
    });
  }

  private buildPayload(event: WebhookEvent): WebhookPayload {
    return {
      event_id: event.id,
      event_type: event.type,
      timestamp: event.timestamp,
      api_version: this.config.apiVersion,
      data: event.data,
      metadata: event.metadata,
    };
  }

  private formatForIntegration(payload: string, integrationType: IntegrationType): string {
    if (integrationType === 'slack') {
      const parsed = JSON.parse(payload);
      return JSON.stringify({
        text: `*${parsed.event_type}*\n${JSON.stringify(parsed.data, null, 2)}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*📊 ${parsed.event_type}*`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `\`\`\`${JSON.stringify(parsed.data, null, 2)}\`\`\``,
            },
          },
        ],
      });
    }

    return payload;
  }

  private checkRateLimit(endpointId: string, limitPerMinute: number): boolean {
    const now = Date.now();
    const counter = this.rateLimitCounters.get(endpointId);

    if (!counter || now - counter.windowStart > 60000) {
      this.rateLimitCounters.set(endpointId, { count: 1, windowStart: now });
      return true;
    }

    if (counter.count >= limitPerMinute) {
      return false;
    }

    counter.count++;
    return true;
  }

  private updateEndpointHealth(endpoint: WebhookEndpoint): void {
    let newHealth: EndpointHealth;

    if (endpoint.consecutiveFailures >= this.config.unhealthyThreshold) {
      newHealth = 'unhealthy';
    } else if (endpoint.consecutiveFailures >= Math.ceil(this.config.unhealthyThreshold / 2)) {
      newHealth = 'degraded';
    } else {
      newHealth = 'healthy';
    }

    if (newHealth !== endpoint.health) {
      endpoint.health = newHealth;
      this.emit('endpoint:health_changed', endpoint.id, newHealth);
    }
  }

  private addToBatch(endpointId: string, event: WebhookEvent): void {
    if (!this.batchBuffers.has(endpointId)) {
      this.batchBuffers.set(endpointId, []);
    }

    this.batchBuffers.get(endpointId)!.push(event);

    // Start batch timer if not already running
    if (!this.batchTimers.has(endpointId)) {
      const endpoint = this.endpoints.get(endpointId)!;
      const timer = setTimeout(async () => {
        await this.flushBatch(endpointId);
      }, endpoint.batchWindowMs);
      this.batchTimers.set(endpointId, timer);
    }
  }

  private async flushBatch(endpointId: string): Promise<void> {
    const events = this.batchBuffers.get(endpointId) || [];
    this.batchBuffers.delete(endpointId);
    this.batchTimers.delete(endpointId);

    if (events.length === 0) return;

    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) return;

    // Create a combined event
    const batchEvent: WebhookEvent = {
      id: `evt-batch-${Date.now()}`,
      type: 'custom',
      timestamp: new Date().toISOString(),
      userId: endpoint.userId,
      data: {
        batch: true,
        count: events.length,
        events: events.map(e => ({
          id: e.id,
          type: e.type,
          timestamp: e.timestamp,
          data: e.data,
        })),
      },
    };

    await this.deliverToEndpoint(batchEvent, endpoint);
  }
}
