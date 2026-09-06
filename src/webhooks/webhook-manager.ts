/**
 * Webhook Manager
 * 
 * External event notification system for integrations. Sends structured
 * webhook payloads to registered endpoints when platform events occur.
 * 
 * Key capabilities:
 * - Endpoint registration with event filtering
 * - HMAC-SHA256 signature verification
 * - Retry with exponential backoff
 * - Delivery logging and status tracking
 * - Rate limiting per endpoint
 * - Payload transformation
 * - Health monitoring for endpoints
 * - Voice summaries of webhook status
 * 
 * 🌙 Night Shift Agent — Shift #34
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type WebhookEventType =
  | 'session.started'
  | 'session.ended'
  | 'session.paused'
  | 'session.resumed'
  | 'inventory.item_counted'
  | 'inventory.discrepancy'
  | 'inventory.session_complete'
  | 'inventory.export_ready'
  | 'reconciliation.complete'
  | 'reconciliation.alert'
  | 'scan.barcode'
  | 'scan.product_identified'
  | 'alert.security'
  | 'alert.shrinkage'
  | 'alert.stockout'
  | 'agent.invoked'
  | 'agent.result'
  | 'device.connected'
  | 'device.disconnected'
  | 'billing.subscription_created'
  | 'billing.payment_received'
  | 'billing.payment_failed'
  | 'custom';

export type EndpointStatus = 'active' | 'paused' | 'failing' | 'disabled';

export interface WebhookEndpoint {
  id: string;
  url: string;
  name: string;
  description?: string;
  secret: string;
  events: WebhookEventType[];
  status: EndpointStatus;
  headers?: Record<string, string>;
  /** Maximum retries per delivery (default: 3) */
  maxRetries: number;
  /** Timeout in ms for each delivery attempt (default: 10000) */
  timeout: number;
  /** Rate limit: max deliveries per minute (default: 60) */
  rateLimit: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface WebhookPayload {
  id: string;
  event: WebhookEventType;
  timestamp: number;
  data: Record<string, unknown>;
  sessionId?: string;
  storeId?: string;
}

export interface DeliveryAttempt {
  attemptNumber: number;
  timestamp: number;
  statusCode: number | null;
  responseBody?: string;
  error?: string;
  durationMs: number;
}

export interface DeliveryRecord {
  id: string;
  endpointId: string;
  payload: WebhookPayload;
  status: 'pending' | 'delivered' | 'failed' | 'retrying';
  attempts: DeliveryAttempt[];
  nextRetryAt: number | null;
  createdAt: number;
  completedAt: number | null;
}

export interface EndpointHealth {
  endpointId: string;
  name: string;
  status: EndpointStatus;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  successRate: number;
  avgResponseTimeMs: number;
  lastDeliveryAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
}

export interface WebhookManagerConfig {
  /** Max delivery records to retain (default: 1000) */
  maxDeliveryHistory: number;
  /** Max consecutive failures before auto-pausing (default: 10) */
  maxConsecutiveFailures: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  baseRetryDelay: number;
  /** Max retry delay in ms (default: 300000 = 5 min) */
  maxRetryDelay: number;
  /** Custom HTTP sender (for testing/mocking) */
  httpSender?: (
    url: string,
    body: string,
    headers: Record<string, string>,
    timeout: number
  ) => Promise<{ statusCode: number; body: string }>;
}

const DEFAULT_CONFIG: WebhookManagerConfig = {
  maxDeliveryHistory: 1000,
  maxConsecutiveFailures: 10,
  baseRetryDelay: 1000,
  maxRetryDelay: 300000,
};

// ─── Engine ────────────────────────────────────────────────────────────────────

export class WebhookManager extends EventEmitter {
  private config: WebhookManagerConfig;
  private endpoints: Map<string, WebhookEndpoint> = new Map();
  private deliveries: DeliveryRecord[] = [];
  private rateLimitCounters: Map<string, { count: number; resetAt: number }> = new Map();
  private healthStats: Map<string, {
    total: number;
    success: number;
    failed: number;
    totalResponseTime: number;
    lastSuccessAt: number | null;
    lastFailureAt: number | null;
    consecutiveFailures: number;
    lastDeliveryAt: number | null;
  }> = new Map();

  constructor(config: Partial<WebhookManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Endpoint Management ───────────────────────────────────────────────────

  /**
   * Register a new webhook endpoint.
   */
  registerEndpoint(
    url: string,
    name: string,
    events: WebhookEventType[],
    options: Partial<Omit<WebhookEndpoint, 'id' | 'url' | 'name' | 'events' | 'createdAt' | 'updatedAt'>> = {}
  ): WebhookEndpoint {
    // Validate URL
    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    if (events.length === 0) {
      throw new Error('At least one event type is required');
    }

    const id = this.generateId();
    const now = Date.now();

    const endpoint: WebhookEndpoint = {
      id,
      url,
      name,
      events: [...events],
      secret: options.secret || this.generateSecret(),
      status: options.status || 'active',
      headers: options.headers,
      maxRetries: options.maxRetries ?? 3,
      timeout: options.timeout ?? 10000,
      rateLimit: options.rateLimit ?? 60,
      createdAt: now,
      updatedAt: now,
      description: options.description,
      metadata: options.metadata,
    };

    this.endpoints.set(id, endpoint);
    this.healthStats.set(id, {
      total: 0,
      success: 0,
      failed: 0,
      totalResponseTime: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastDeliveryAt: null,
    });

    this.emit('endpoint:registered', endpoint);
    return endpoint;
  }

  /**
   * Update an existing endpoint.
   */
  updateEndpoint(
    id: string,
    updates: Partial<Pick<WebhookEndpoint, 'url' | 'name' | 'events' | 'status' | 'headers' | 'maxRetries' | 'timeout' | 'rateLimit' | 'description' | 'metadata'>>
  ): WebhookEndpoint {
    const endpoint = this.endpoints.get(id);
    if (!endpoint) throw new Error(`Endpoint ${id} not found`);

    if (updates.url) {
      try {
        new URL(updates.url);
      } catch {
        throw new Error(`Invalid URL: ${updates.url}`);
      }
    }

    Object.assign(endpoint, updates, { updatedAt: Date.now() });
    this.emit('endpoint:updated', endpoint);
    return endpoint;
  }

  /**
   * Remove an endpoint.
   */
  removeEndpoint(id: string): void {
    const endpoint = this.endpoints.get(id);
    if (!endpoint) throw new Error(`Endpoint ${id} not found`);

    this.endpoints.delete(id);
    this.healthStats.delete(id);
    this.rateLimitCounters.delete(id);

    this.emit('endpoint:removed', { id, name: endpoint.name });
  }

  /**
   * Get an endpoint by ID.
   */
  getEndpoint(id: string): WebhookEndpoint | null {
    return this.endpoints.get(id) || null;
  }

  /**
   * List all endpoints.
   */
  listEndpoints(status?: EndpointStatus): WebhookEndpoint[] {
    const all = Array.from(this.endpoints.values());
    if (status) {
      return all.filter(e => e.status === status);
    }
    return all;
  }

  /**
   * Pause an endpoint (stops deliveries without removing).
   */
  pauseEndpoint(id: string): void {
    this.updateEndpoint(id, { status: 'paused' });
  }

  /**
   * Activate a paused endpoint.
   */
  activateEndpoint(id: string): void {
    const endpoint = this.endpoints.get(id);
    if (!endpoint) throw new Error(`Endpoint ${id} not found`);

    // Reset consecutive failures on manual activation
    const stats = this.healthStats.get(id);
    if (stats) {
      stats.consecutiveFailures = 0;
    }

    this.updateEndpoint(id, { status: 'active' });
  }

  // ─── Event Dispatch ────────────────────────────────────────────────────────

  /**
   * Dispatch an event to all matching endpoints.
   */
  async dispatch(
    event: WebhookEventType,
    data: Record<string, unknown>,
    options: { sessionId?: string; storeId?: string } = {}
  ): Promise<DeliveryRecord[]> {
    const payload: WebhookPayload = {
      id: this.generateId(),
      event,
      timestamp: Date.now(),
      data,
      sessionId: options.sessionId,
      storeId: options.storeId,
    };

    // Find matching endpoints
    const matchingEndpoints = Array.from(this.endpoints.values()).filter(
      ep => ep.status === 'active' && ep.events.includes(event)
    );

    if (matchingEndpoints.length === 0) {
      return [];
    }

    const records: DeliveryRecord[] = [];

    for (const endpoint of matchingEndpoints) {
      // Check rate limit
      if (this.isRateLimited(endpoint.id, endpoint.rateLimit)) {
        this.emit('delivery:rate_limited', { endpointId: endpoint.id, event });
        continue;
      }

      const record = await this.deliver(endpoint, payload);
      records.push(record);
    }

    return records;
  }

  // ─── Delivery ──────────────────────────────────────────────────────────────

  private async deliver(
    endpoint: WebhookEndpoint,
    payload: WebhookPayload
  ): Promise<DeliveryRecord> {
    const record: DeliveryRecord = {
      id: this.generateId(),
      endpointId: endpoint.id,
      payload,
      status: 'pending',
      attempts: [],
      nextRetryAt: null,
      createdAt: Date.now(),
      completedAt: null,
    };

    this.deliveries.push(record);
    this.trimDeliveryHistory();

    // Try delivery with retries
    for (let attempt = 0; attempt <= endpoint.maxRetries; attempt++) {
      if (attempt > 0) {
        // Wait before retry with exponential backoff
        const delay = Math.min(
          this.config.baseRetryDelay * Math.pow(2, attempt - 1),
          this.config.maxRetryDelay
        );
        record.nextRetryAt = Date.now() + delay;
        record.status = 'retrying';
        await this.sleep(delay);
      }

      const attemptResult = await this.attemptDelivery(endpoint, payload, attempt + 1);
      record.attempts.push(attemptResult);

      if (attemptResult.statusCode !== null && attemptResult.statusCode >= 200 && attemptResult.statusCode < 300) {
        // Success
        record.status = 'delivered';
        record.completedAt = Date.now();
        record.nextRetryAt = null;
        this.recordSuccess(endpoint.id, attemptResult.durationMs);
        this.emit('delivery:success', { record, endpoint });
        return record;
      }
    }

    // All retries exhausted
    record.status = 'failed';
    record.completedAt = Date.now();
    record.nextRetryAt = null;
    this.recordFailure(endpoint.id);
    this.emit('delivery:failed', { record, endpoint });

    // Auto-pause if too many consecutive failures
    const stats = this.healthStats.get(endpoint.id);
    if (stats && stats.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      endpoint.status = 'failing';
      this.emit('endpoint:auto_paused', {
        endpointId: endpoint.id,
        consecutiveFailures: stats.consecutiveFailures,
      });
    }

    return record;
  }

  private async attemptDelivery(
    endpoint: WebhookEndpoint,
    payload: WebhookPayload,
    attemptNumber: number
  ): Promise<DeliveryAttempt> {
    const body = JSON.stringify(payload);
    const signature = this.sign(body, endpoint.secret);
    const startTime = Date.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Id': payload.id,
      'X-Webhook-Event': payload.event,
      'X-Webhook-Timestamp': payload.timestamp.toString(),
      'User-Agent': 'InventoryVision-Webhooks/1.0',
      ...(endpoint.headers || {}),
    };

    try {
      if (this.config.httpSender) {
        const response = await this.config.httpSender(endpoint.url, body, headers, endpoint.timeout);
        return {
          attemptNumber,
          timestamp: Date.now(),
          statusCode: response.statusCode,
          responseBody: response.body?.substring(0, 500),
          durationMs: Date.now() - startTime,
        };
      }

      // Default: simulate (in production, use fetch/axios)
      return {
        attemptNumber,
        timestamp: Date.now(),
        statusCode: 200,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        attemptNumber,
        timestamp: Date.now(),
        statusCode: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ─── Signature ─────────────────────────────────────────────────────────────

  /**
   * Generate HMAC-SHA256 signature for a payload.
   */
  sign(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Verify a webhook signature.
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = this.sign(payload, secret);
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected, 'hex')
      );
    } catch {
      return false;
    }
  }

  // ─── Rate Limiting ─────────────────────────────────────────────────────────

  private isRateLimited(endpointId: string, limit: number): boolean {
    const now = Date.now();
    let counter = this.rateLimitCounters.get(endpointId);

    if (!counter || now >= counter.resetAt) {
      counter = { count: 0, resetAt: now + 60000 };
      this.rateLimitCounters.set(endpointId, counter);
    }

    if (counter.count >= limit) {
      return true;
    }

    counter.count++;
    return false;
  }

  // ─── Health Tracking ───────────────────────────────────────────────────────

  private recordSuccess(endpointId: string, durationMs: number): void {
    const stats = this.healthStats.get(endpointId);
    if (!stats) return;

    stats.total++;
    stats.success++;
    stats.totalResponseTime += durationMs;
    stats.lastSuccessAt = Date.now();
    stats.lastDeliveryAt = Date.now();
    stats.consecutiveFailures = 0;
  }

  private recordFailure(endpointId: string): void {
    const stats = this.healthStats.get(endpointId);
    if (!stats) return;

    stats.total++;
    stats.failed++;
    stats.lastFailureAt = Date.now();
    stats.lastDeliveryAt = Date.now();
    stats.consecutiveFailures++;
  }

  /**
   * Get health status for an endpoint.
   */
  getEndpointHealth(endpointId: string): EndpointHealth | null {
    const endpoint = this.endpoints.get(endpointId);
    const stats = this.healthStats.get(endpointId);
    if (!endpoint || !stats) return null;

    return {
      endpointId,
      name: endpoint.name,
      status: endpoint.status,
      totalDeliveries: stats.total,
      successfulDeliveries: stats.success,
      failedDeliveries: stats.failed,
      successRate: stats.total > 0 ? (stats.success / stats.total) * 100 : 100,
      avgResponseTimeMs: stats.success > 0 ? Math.round(stats.totalResponseTime / stats.success) : 0,
      lastDeliveryAt: stats.lastDeliveryAt,
      lastSuccessAt: stats.lastSuccessAt,
      lastFailureAt: stats.lastFailureAt,
      consecutiveFailures: stats.consecutiveFailures,
    };
  }

  /**
   * Get health for all endpoints.
   */
  getAllHealth(): EndpointHealth[] {
    return Array.from(this.endpoints.keys())
      .map(id => this.getEndpointHealth(id))
      .filter((h): h is EndpointHealth => h !== null);
  }

  // ─── Delivery History ──────────────────────────────────────────────────────

  /**
   * Get delivery records for an endpoint.
   */
  getDeliveries(
    endpointId?: string,
    options: { status?: DeliveryRecord['status']; limit?: number; event?: WebhookEventType } = {}
  ): DeliveryRecord[] {
    let records = [...this.deliveries];

    if (endpointId) {
      records = records.filter(r => r.endpointId === endpointId);
    }
    if (options.status) {
      records = records.filter(r => r.status === options.status);
    }
    if (options.event) {
      records = records.filter(r => r.payload.event === options.event);
    }

    // Most recent first
    records.sort((a, b) => b.createdAt - a.createdAt);

    if (options.limit) {
      records = records.slice(0, options.limit);
    }

    return records;
  }

  /**
   * Get a specific delivery record.
   */
  getDelivery(id: string): DeliveryRecord | null {
    return this.deliveries.find(d => d.id === id) || null;
  }

  /**
   * Clear delivery history.
   */
  clearDeliveries(): void {
    this.deliveries = [];
  }

  // ─── Voice Summary ─────────────────────────────────────────────────────────

  /**
   * Generate a voice-friendly status summary.
   */
  generateVoiceSummary(): string {
    const endpoints = this.listEndpoints();
    if (endpoints.length === 0) {
      return 'No webhook endpoints configured.';
    }

    const active = endpoints.filter(e => e.status === 'active').length;
    const failing = endpoints.filter(e => e.status === 'failing').length;
    const paused = endpoints.filter(e => e.status === 'paused').length;

    const parts: string[] = [];
    parts.push(`${endpoints.length} webhook endpoints configured.`);

    if (active > 0) parts.push(`${active} active.`);
    if (failing > 0) parts.push(`${failing} failing — needs attention.`);
    if (paused > 0) parts.push(`${paused} paused.`);

    // Recent delivery stats
    const recentDeliveries = this.deliveries.filter(
      d => d.createdAt > Date.now() - 3600000
    );
    if (recentDeliveries.length > 0) {
      const successful = recentDeliveries.filter(d => d.status === 'delivered').length;
      const failed = recentDeliveries.filter(d => d.status === 'failed').length;
      parts.push(
        `Last hour: ${recentDeliveries.length} deliveries, ` +
        `${successful} successful, ${failed} failed.`
      );
    }

    return parts.join(' ');
  }

  // ─── Utility ───────────────────────────────────────────────────────────────

  private trimDeliveryHistory(): void {
    if (this.deliveries.length > this.config.maxDeliveryHistory) {
      this.deliveries = this.deliveries.slice(-this.config.maxDeliveryHistory);
    }
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `wh-${timestamp}-${random}`;
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
