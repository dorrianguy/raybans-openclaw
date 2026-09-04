/**
 * Webhook Delivery Engine
 * 
 * Reliable outbound webhook system for integrating with POS systems,
 * external dashboards, CRM, and third-party services. Features:
 * 
 * - Webhook registration with URL validation and secret signing
 * - HMAC-SHA256 signature for payload verification
 * - Exponential backoff retry with configurable attempts
 * - Dead letter queue for permanently failed deliveries
 * - Event filtering per webhook (subscribe to specific events)
 * - Delivery history with response tracking
 * - Rate limiting per webhook endpoint
 * - Batch delivery for high-throughput scenarios
 * - Webhook health scoring and auto-disable
 * - Replay capability for debugging
 * 
 * 🌙 Built by Night Shift Agent — Night #35
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type WebhookEventType =
  | 'inventory.session.started' | 'inventory.session.completed' | 'inventory.session.paused'
  | 'inventory.item.scanned' | 'inventory.item.counted' | 'inventory.discrepancy.detected'
  | 'inventory.export.ready'
  | 'agent.invoked' | 'agent.completed' | 'agent.error'
  | 'security.threat.detected' | 'security.alert.critical'
  | 'billing.subscription.created' | 'billing.subscription.cancelled' | 'billing.payment.failed'
  | 'billing.invoice.paid'
  | 'user.created' | 'user.deleted' | 'user.role.changed'
  | 'device.connected' | 'device.disconnected' | 'device.error'
  | 'system.health.degraded' | 'system.health.recovered'
  | 'store.layout.completed' | 'store.comparison.ready'
  | 'custom';

export type DeliveryStatus = 'pending' | 'delivering' | 'delivered' | 'failed' | 'dead_letter';

export type WebhookStatus = 'active' | 'paused' | 'disabled' | 'failing';

export interface Webhook {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  status: WebhookStatus;
  headers: Record<string, string>;
  metadata: Record<string, unknown>;
  healthScore: number;           // 0-100, auto-calculated
  consecutiveFailures: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastDeliveryAt?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  createdAt: number;
  updatedAt: number;
  disabledAt?: number;
  disableReason?: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  tenantId: string;
  event: WebhookEventType;
  payload: Record<string, unknown>;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: number;
  responseStatus?: number;
  responseBody?: string;
  responseTimeMs?: number;
  error?: string;
  signature: string;
  createdAt: number;
  deliveredAt?: number;
  lastAttemptAt?: number;
}

export interface DeadLetterEntry {
  delivery: WebhookDelivery;
  reason: string;
  failedAt: number;
  canReplay: boolean;
}

export interface WebhookDeliveryConfig {
  maxRetries: number;
  initialRetryDelayMs: number;
  maxRetryDelayMs: number;
  backoffMultiplier: number;
  deliveryTimeoutMs: number;
  maxWebhooksPerTenant: number;
  maxEventsPerWebhook: number;
  maxPayloadSizeBytes: number;
  healthScoreThreshold: number;     // Below this, auto-disable
  autoDisableAfterFailures: number;
  maxDeliveryHistory: number;
  maxDeadLetterEntries: number;
  rateLimitPerMinute: number;
  batchSize: number;
  signatureAlgorithm: 'sha256' | 'sha512';
}

export interface WebhookDeliveryEvents {
  'webhook:created': (webhook: Webhook) => void;
  'webhook:updated': (webhook: Webhook) => void;
  'webhook:disabled': (webhookId: string, reason: string) => void;
  'webhook:reactivated': (webhookId: string) => void;
  'delivery:success': (delivery: WebhookDelivery) => void;
  'delivery:failed': (delivery: WebhookDelivery) => void;
  'delivery:retrying': (delivery: WebhookDelivery, attempt: number) => void;
  'delivery:dead_letter': (entry: DeadLetterEntry) => void;
  'health:degraded': (webhookId: string, score: number) => void;
  'rate_limit:hit': (webhookId: string) => void;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: WebhookDeliveryConfig = {
  maxRetries: 5,
  initialRetryDelayMs: 1000,
  maxRetryDelayMs: 300000, // 5 minutes
  backoffMultiplier: 2,
  deliveryTimeoutMs: 30000,
  maxWebhooksPerTenant: 20,
  maxEventsPerWebhook: 30,
  maxPayloadSizeBytes: 1_000_000, // 1 MB
  healthScoreThreshold: 20,
  autoDisableAfterFailures: 10,
  maxDeliveryHistory: 1000,
  maxDeadLetterEntries: 500,
  rateLimitPerMinute: 60,
  batchSize: 10,
  signatureAlgorithm: 'sha256',
};

// ─── Engine ──────────────────────────────────────────────────────────────────

export class WebhookDeliveryEngine extends EventEmitter {
  private webhooks: Map<string, Webhook> = new Map();
  private deliveries: WebhookDelivery[] = [];
  private deadLetterQueue: DeadLetterEntry[] = [];
  private rateLimitCounters: Map<string, { count: number; windowStart: number }> = new Map();
  private config: WebhookDeliveryConfig;
  private idCounter = 0;

  // Pluggable HTTP sender for testing
  private httpSender: (
    url: string,
    payload: string,
    headers: Record<string, string>,
    timeoutMs: number
  ) => Promise<{ status: number; body: string; timeMs: number }>;

  constructor(
    config?: Partial<WebhookDeliveryConfig>,
    httpSender?: (
      url: string, payload: string, headers: Record<string, string>, timeoutMs: number
    ) => Promise<{ status: number; body: string; timeMs: number }>
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.httpSender = httpSender ?? this.defaultHttpSender.bind(this);
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${++this.idCounter}`;
  }

  // ─── Webhook Registration ────────────────────────────────────────────

  registerWebhook(params: {
    tenantId: string;
    name: string;
    url: string;
    events: WebhookEventType[];
    secret?: string;
    headers?: Record<string, string>;
    metadata?: Record<string, unknown>;
  }): Webhook {
    // Validate URL
    if (!this.isValidUrl(params.url)) {
      throw new Error(`Invalid webhook URL: ${params.url}`);
    }

    // Check tenant limit
    const tenantWebhooks = this.getWebhooksByTenant(params.tenantId);
    if (tenantWebhooks.length >= this.config.maxWebhooksPerTenant) {
      throw new Error(`Maximum webhooks per tenant reached (${this.config.maxWebhooksPerTenant})`);
    }

    // Check event limit
    if (params.events.length > this.config.maxEventsPerWebhook) {
      throw new Error(`Maximum events per webhook reached (${this.config.maxEventsPerWebhook})`);
    }

    // Check for duplicate URL per tenant
    if (tenantWebhooks.some(w => w.url === params.url)) {
      throw new Error('Webhook with this URL already exists for this tenant');
    }

    const webhook: Webhook = {
      id: this.generateId('wh'),
      tenantId: params.tenantId,
      name: params.name,
      url: params.url,
      secret: params.secret ?? this.generateSecret(),
      events: [...params.events],
      status: 'active',
      headers: params.headers ?? {},
      metadata: params.metadata ?? {},
      healthScore: 100,
      consecutiveFailures: 0,
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.webhooks.set(webhook.id, webhook);
    this.emit('webhook:created', webhook);
    return webhook;
  }

  getWebhook(webhookId: string): Webhook | undefined {
    return this.webhooks.get(webhookId);
  }

  getWebhooksByTenant(tenantId: string): Webhook[] {
    return Array.from(this.webhooks.values()).filter(w => w.tenantId === tenantId);
  }

  updateWebhook(webhookId: string, updates: {
    name?: string;
    url?: string;
    events?: WebhookEventType[];
    headers?: Record<string, string>;
    metadata?: Record<string, unknown>;
  }): Webhook {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) throw new Error(`Webhook '${webhookId}' not found`);

    if (updates.url) {
      if (!this.isValidUrl(updates.url)) {
        throw new Error(`Invalid webhook URL: ${updates.url}`);
      }
      webhook.url = updates.url;
    }
    if (updates.name !== undefined) webhook.name = updates.name;
    if (updates.events) {
      if (updates.events.length > this.config.maxEventsPerWebhook) {
        throw new Error(`Maximum events per webhook reached (${this.config.maxEventsPerWebhook})`);
      }
      webhook.events = [...updates.events];
    }
    if (updates.headers) webhook.headers = { ...updates.headers };
    if (updates.metadata) webhook.metadata = { ...webhook.metadata, ...updates.metadata };

    webhook.updatedAt = Date.now();
    this.webhooks.set(webhookId, webhook);
    this.emit('webhook:updated', webhook);
    return webhook;
  }

  deleteWebhook(webhookId: string): void {
    if (!this.webhooks.has(webhookId)) {
      throw new Error(`Webhook '${webhookId}' not found`);
    }
    this.webhooks.delete(webhookId);
    // Clean up deliveries
    this.deliveries = this.deliveries.filter(d => d.webhookId !== webhookId);
  }

  pauseWebhook(webhookId: string): void {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) throw new Error(`Webhook '${webhookId}' not found`);
    webhook.status = 'paused';
    webhook.updatedAt = Date.now();
    this.webhooks.set(webhookId, webhook);
  }

  resumeWebhook(webhookId: string): void {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) throw new Error(`Webhook '${webhookId}' not found`);
    if (webhook.status === 'disabled') {
      throw new Error('Cannot resume a disabled webhook. Use reactivateWebhook().');
    }
    webhook.status = 'active';
    webhook.updatedAt = Date.now();
    this.webhooks.set(webhookId, webhook);
  }

  reactivateWebhook(webhookId: string): void {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) throw new Error(`Webhook '${webhookId}' not found`);

    webhook.status = 'active';
    webhook.consecutiveFailures = 0;
    webhook.healthScore = 50; // Reset to moderate health
    webhook.disabledAt = undefined;
    webhook.disableReason = undefined;
    webhook.updatedAt = Date.now();

    this.webhooks.set(webhookId, webhook);
    this.emit('webhook:reactivated', webhookId);
  }

  rotateSecret(webhookId: string): string {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) throw new Error(`Webhook '${webhookId}' not found`);

    webhook.secret = this.generateSecret();
    webhook.updatedAt = Date.now();
    this.webhooks.set(webhookId, webhook);
    return webhook.secret;
  }

  // ─── Event Dispatching ───────────────────────────────────────────────

  async dispatch(
    tenantId: string,
    event: WebhookEventType,
    payload: Record<string, unknown>
  ): Promise<WebhookDelivery[]> {
    // Find all matching webhooks for this tenant and event
    const webhooks = this.getWebhooksByTenant(tenantId).filter(
      w => w.status === 'active' && w.events.includes(event)
    );

    if (webhooks.length === 0) return [];

    // Validate payload size
    const payloadStr = JSON.stringify(payload);
    if (payloadStr.length > this.config.maxPayloadSizeBytes) {
      throw new Error(`Payload exceeds maximum size (${this.config.maxPayloadSizeBytes} bytes)`);
    }

    const deliveries: WebhookDelivery[] = [];

    for (const webhook of webhooks) {
      // Rate limit check
      if (this.isRateLimited(webhook.id)) {
        this.emit('rate_limit:hit', webhook.id);
        continue;
      }

      const delivery = await this.deliverToWebhook(webhook, event, payload);
      deliveries.push(delivery);
    }

    return deliveries;
  }

  async dispatchBatch(
    tenantId: string,
    events: Array<{ event: WebhookEventType; payload: Record<string, unknown> }>
  ): Promise<WebhookDelivery[]> {
    const allDeliveries: WebhookDelivery[] = [];

    // Process in batches
    for (let i = 0; i < events.length; i += this.config.batchSize) {
      const batch = events.slice(i, i + this.config.batchSize);
      const promises = batch.map(({ event, payload }) =>
        this.dispatch(tenantId, event, payload)
      );

      const results = await Promise.allSettled(promises);
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allDeliveries.push(...result.value);
        }
      }
    }

    return allDeliveries;
  }

  private async deliverToWebhook(
    webhook: Webhook,
    event: WebhookEventType,
    payload: Record<string, unknown>
  ): Promise<WebhookDelivery> {
    const fullPayload = {
      id: this.generateId('evt'),
      type: event,
      timestamp: new Date().toISOString(),
      tenantId: webhook.tenantId,
      data: payload,
    };

    const payloadStr = JSON.stringify(fullPayload);
    const signature = this.signPayload(payloadStr, webhook.secret);

    const delivery: WebhookDelivery = {
      id: this.generateId('dlv'),
      webhookId: webhook.id,
      tenantId: webhook.tenantId,
      event,
      payload: fullPayload,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.config.maxRetries + 1,
      signature,
      createdAt: Date.now(),
    };

    // Attempt delivery with retries
    await this.attemptDelivery(delivery, webhook);

    // Store delivery
    this.deliveries.push(delivery);
    this.trimDeliveryHistory();

    // Update rate limiter
    this.incrementRateLimit(webhook.id);

    return delivery;
  }

  private async attemptDelivery(delivery: WebhookDelivery, webhook: Webhook): Promise<void> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      delivery.attempts = attempt + 1;
      delivery.status = 'delivering';
      delivery.lastAttemptAt = Date.now();

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': delivery.signature,
          'X-Webhook-Event': delivery.event,
          'X-Webhook-Delivery-Id': delivery.id,
          'X-Webhook-Timestamp': new Date().toISOString(),
          ...webhook.headers,
        };

        const response = await this.httpSender(
          webhook.url,
          JSON.stringify(delivery.payload),
          headers,
          this.config.deliveryTimeoutMs
        );

        delivery.responseStatus = response.status;
        delivery.responseBody = response.body.slice(0, 1000); // Truncate
        delivery.responseTimeMs = response.timeMs;

        if (response.status >= 200 && response.status < 300) {
          // Success
          delivery.status = 'delivered';
          delivery.deliveredAt = Date.now();
          this.updateWebhookHealth(webhook, true);
          this.emit('delivery:success', delivery);
          return;
        } else {
          lastError = `HTTP ${response.status}: ${response.body.slice(0, 200)}`;
        }
      } catch (err: any) {
        lastError = err.message ?? 'Unknown error';
      }

      // If not the last attempt, wait before retrying
      if (attempt < this.config.maxRetries) {
        const delay = this.calculateRetryDelay(attempt);
        delivery.nextRetryAt = Date.now() + delay;
        this.emit('delivery:retrying', delivery, attempt + 1);
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    delivery.status = 'failed';
    delivery.error = lastError;
    this.updateWebhookHealth(webhook, false);
    this.emit('delivery:failed', delivery);

    // Move to dead letter queue
    this.addToDeadLetter(delivery, lastError ?? 'Max retries exhausted');
  }

  private calculateRetryDelay(attempt: number): number {
    const delay = this.config.initialRetryDelayMs * Math.pow(this.config.backoffMultiplier, attempt);
    // Add jitter (±20%)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, this.config.maxRetryDelayMs);
  }

  // ─── Signature ───────────────────────────────────────────────────────

  signPayload(payload: string, secret: string): string {
    const algo = this.config.signatureAlgorithm;
    return `${algo}=` + crypto.createHmac(algo, secret).update(payload).digest('hex');
  }

  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = this.signPayload(payload, secret);
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      );
    } catch {
      return false;
    }
  }

  // ─── Health Management ───────────────────────────────────────────────

  private updateWebhookHealth(webhook: Webhook, success: boolean): void {
    webhook.totalDeliveries++;
    webhook.lastDeliveryAt = Date.now();

    if (success) {
      webhook.successfulDeliveries++;
      webhook.consecutiveFailures = 0;
      webhook.lastSuccessAt = Date.now();
      // Recover health
      webhook.healthScore = Math.min(100, webhook.healthScore + 5);
      if (webhook.status === 'failing') {
        webhook.status = 'active';
      }
    } else {
      webhook.failedDeliveries++;
      webhook.consecutiveFailures++;
      webhook.lastFailureAt = Date.now();
      // Decrease health
      webhook.healthScore = Math.max(0, webhook.healthScore - 15);

      // Check for auto-disable
      if (webhook.consecutiveFailures >= this.config.autoDisableAfterFailures) {
        webhook.status = 'disabled';
        webhook.disabledAt = Date.now();
        webhook.disableReason = `Auto-disabled after ${webhook.consecutiveFailures} consecutive failures`;
        this.emit('webhook:disabled', webhook.id, webhook.disableReason);
      } else if (webhook.healthScore < this.config.healthScoreThreshold) {
        webhook.status = 'failing';
        this.emit('health:degraded', webhook.id, webhook.healthScore);
      }
    }

    this.webhooks.set(webhook.id, webhook);
  }

  getHealthReport(webhookId: string): {
    healthScore: number;
    status: WebhookStatus;
    successRate: number;
    consecutiveFailures: number;
    totalDeliveries: number;
    averageResponseMs: number;
    lastSuccess: string | null;
    lastFailure: string | null;
    recommendation: string;
  } {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) throw new Error(`Webhook '${webhookId}' not found`);

    const successRate = webhook.totalDeliveries > 0
      ? Math.round((webhook.successfulDeliveries / webhook.totalDeliveries) * 100)
      : 100;

    // Calculate average response time from recent deliveries
    const recentDeliveries = this.deliveries
      .filter(d => d.webhookId === webhookId && d.responseTimeMs !== undefined)
      .slice(-50);
    const avgResponseMs = recentDeliveries.length > 0
      ? Math.round(recentDeliveries.reduce((sum, d) => sum + (d.responseTimeMs ?? 0), 0) / recentDeliveries.length)
      : 0;

    let recommendation: string;
    if (webhook.healthScore >= 80) {
      recommendation = 'Webhook is healthy. No action needed.';
    } else if (webhook.healthScore >= 50) {
      recommendation = 'Webhook is degraded. Check endpoint availability.';
    } else if (webhook.healthScore >= 20) {
      recommendation = 'Webhook is unhealthy. Review endpoint configuration and server logs.';
    } else {
      recommendation = 'Webhook is critically unhealthy. Consider disabling and investigating.';
    }

    return {
      healthScore: webhook.healthScore,
      status: webhook.status,
      successRate,
      consecutiveFailures: webhook.consecutiveFailures,
      totalDeliveries: webhook.totalDeliveries,
      averageResponseMs: avgResponseMs,
      lastSuccess: webhook.lastSuccessAt ? new Date(webhook.lastSuccessAt).toISOString() : null,
      lastFailure: webhook.lastFailureAt ? new Date(webhook.lastFailureAt).toISOString() : null,
      recommendation,
    };
  }

  // ─── Dead Letter Queue ───────────────────────────────────────────────

  private addToDeadLetter(delivery: WebhookDelivery, reason: string): void {
    const entry: DeadLetterEntry = {
      delivery: { ...delivery },
      reason,
      failedAt: Date.now(),
      canReplay: true,
    };

    this.deadLetterQueue.push(entry);
    this.emit('delivery:dead_letter', entry);

    // Trim
    if (this.deadLetterQueue.length > this.config.maxDeadLetterEntries) {
      this.deadLetterQueue = this.deadLetterQueue.slice(-Math.floor(this.config.maxDeadLetterEntries * 0.75));
    }
  }

  getDeadLetterQueue(filters?: {
    webhookId?: string;
    tenantId?: string;
    event?: WebhookEventType;
    limit?: number;
  }): DeadLetterEntry[] {
    let results = [...this.deadLetterQueue];

    if (filters?.webhookId) {
      results = results.filter(e => e.delivery.webhookId === filters.webhookId);
    }
    if (filters?.tenantId) {
      results = results.filter(e => e.delivery.tenantId === filters.tenantId);
    }
    if (filters?.event) {
      results = results.filter(e => e.delivery.event === filters.event);
    }

    results.sort((a, b) => b.failedAt - a.failedAt);

    if (filters?.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  async replayDeadLetter(entryIndex: number): Promise<WebhookDelivery | null> {
    if (entryIndex < 0 || entryIndex >= this.deadLetterQueue.length) {
      return null;
    }

    const entry = this.deadLetterQueue[entryIndex];
    if (!entry.canReplay) return null;

    const webhook = this.webhooks.get(entry.delivery.webhookId);
    if (!webhook || webhook.status !== 'active') return null;

    // Re-dispatch
    const deliveries = await this.dispatch(
      entry.delivery.tenantId,
      entry.delivery.event,
      entry.delivery.payload.data as Record<string, unknown>
    );

    // Remove from DLQ on success
    if (deliveries.length > 0 && deliveries[0].status === 'delivered') {
      this.deadLetterQueue.splice(entryIndex, 1);
    }

    return deliveries[0] ?? null;
  }

  clearDeadLetterQueue(webhookId?: string): number {
    const before = this.deadLetterQueue.length;
    if (webhookId) {
      this.deadLetterQueue = this.deadLetterQueue.filter(
        e => e.delivery.webhookId !== webhookId
      );
    } else {
      this.deadLetterQueue = [];
    }
    return before - this.deadLetterQueue.length;
  }

  // ─── Delivery History ────────────────────────────────────────────────

  getDeliveryHistory(filters?: {
    webhookId?: string;
    tenantId?: string;
    event?: WebhookEventType;
    status?: DeliveryStatus;
    since?: number;
    limit?: number;
  }): WebhookDelivery[] {
    let results = [...this.deliveries];

    if (filters?.webhookId) {
      results = results.filter(d => d.webhookId === filters.webhookId);
    }
    if (filters?.tenantId) {
      results = results.filter(d => d.tenantId === filters.tenantId);
    }
    if (filters?.event) {
      results = results.filter(d => d.event === filters.event);
    }
    if (filters?.status) {
      results = results.filter(d => d.status === filters.status);
    }
    if (filters?.since) {
      results = results.filter(d => d.createdAt >= filters.since!);
    }

    results.sort((a, b) => b.createdAt - a.createdAt);

    if (filters?.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  private trimDeliveryHistory(): void {
    if (this.deliveries.length > this.config.maxDeliveryHistory) {
      this.deliveries = this.deliveries.slice(-Math.floor(this.config.maxDeliveryHistory * 0.75));
    }
  }

  // ─── Rate Limiting ───────────────────────────────────────────────────

  private isRateLimited(webhookId: string): boolean {
    const counter = this.rateLimitCounters.get(webhookId);
    const now = Date.now();

    if (!counter || now - counter.windowStart > 60000) {
      // New window
      return false;
    }

    return counter.count >= this.config.rateLimitPerMinute;
  }

  private incrementRateLimit(webhookId: string): void {
    const now = Date.now();
    const counter = this.rateLimitCounters.get(webhookId);

    if (!counter || now - counter.windowStart > 60000) {
      this.rateLimitCounters.set(webhookId, { count: 1, windowStart: now });
    } else {
      counter.count++;
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────

  getStats(tenantId?: string): {
    totalWebhooks: number;
    activeWebhooks: number;
    failingWebhooks: number;
    disabledWebhooks: number;
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    deadLetterCount: number;
    overallSuccessRate: number;
    topEvents: Array<{ event: string; count: number }>;
  } {
    let webhooks = Array.from(this.webhooks.values());
    let deliveries = this.deliveries;
    let dlq = this.deadLetterQueue;

    if (tenantId) {
      webhooks = webhooks.filter(w => w.tenantId === tenantId);
      deliveries = deliveries.filter(d => d.tenantId === tenantId);
      dlq = dlq.filter(e => e.delivery.tenantId === tenantId);
    }

    const successCount = deliveries.filter(d => d.status === 'delivered').length;
    const failCount = deliveries.filter(d => d.status === 'failed' || d.status === 'dead_letter').length;

    // Top events
    const eventCounts = new Map<string, number>();
    for (const d of deliveries) {
      eventCounts.set(d.event, (eventCounts.get(d.event) ?? 0) + 1);
    }
    const topEvents = Array.from(eventCounts.entries())
      .map(([event, count]) => ({ event, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalWebhooks: webhooks.length,
      activeWebhooks: webhooks.filter(w => w.status === 'active').length,
      failingWebhooks: webhooks.filter(w => w.status === 'failing').length,
      disabledWebhooks: webhooks.filter(w => w.status === 'disabled').length,
      totalDeliveries: deliveries.length,
      successfulDeliveries: successCount,
      failedDeliveries: failCount,
      deadLetterCount: dlq.length,
      overallSuccessRate: deliveries.length > 0
        ? Math.round((successCount / deliveries.length) * 100)
        : 100,
      topEvents,
    };
  }

  // ─── Voice Summary ───────────────────────────────────────────────────

  getVoiceSummary(tenantId: string): string {
    const stats = this.getStats(tenantId);
    const parts: string[] = [];

    parts.push(`${stats.totalWebhooks} webhooks configured.`);
    parts.push(`${stats.activeWebhooks} active.`);

    if (stats.failingWebhooks > 0) {
      parts.push(`Warning: ${stats.failingWebhooks} webhooks failing.`);
    }
    if (stats.disabledWebhooks > 0) {
      parts.push(`${stats.disabledWebhooks} disabled.`);
    }

    parts.push(`${stats.totalDeliveries} total deliveries, ${stats.overallSuccessRate}% success rate.`);

    if (stats.deadLetterCount > 0) {
      parts.push(`${stats.deadLetterCount} messages in dead letter queue.`);
    }

    return parts.join(' ');
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  private generateSecret(): string {
    return 'whsec_' + crypto.randomBytes(32).toString('hex');
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async defaultHttpSender(
    url: string,
    payload: string,
    headers: Record<string, string>,
    timeoutMs: number
  ): Promise<{ status: number; body: string; timeMs: number }> {
    // Default implementation — would use fetch in production
    throw new Error('HTTP sender not configured. Provide a custom sender for testing.');
  }
}
