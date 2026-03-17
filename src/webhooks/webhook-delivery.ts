/**
 * Webhook Delivery Engine
 * 
 * Reliable webhook delivery for external integrations.
 * Supports: inventory events, alerts, session completions,
 * agent results, billing events, and custom events.
 * 
 * Features:
 * - HMAC-SHA256 signature verification
 * - Exponential backoff retry with jitter
 * - Dead letter queue for failed deliveries
 * - Rate limiting per endpoint
 * - Event filtering (subscribe to specific events)
 * - Delivery logging and metrics
 * - Circuit breaker per endpoint
 * - Batch delivery support
 * 
 * 🌙 Night Shift Agent — 2026-03-16
 */

import { EventEmitter } from 'events';
import { createHmac, randomBytes } from 'crypto';

// ──── Types ────

export type WebhookEventType =
  | 'inventory.session.started'
  | 'inventory.session.completed'
  | 'inventory.session.paused'
  | 'inventory.session.cancelled'
  | 'inventory.item.scanned'
  | 'inventory.item.flagged'
  | 'inventory.export.ready'
  | 'agent.invoked'
  | 'agent.error'
  | 'agent.result'
  | 'security.threat.detected'
  | 'security.alert.critical'
  | 'billing.subscription.created'
  | 'billing.subscription.cancelled'
  | 'billing.payment.succeeded'
  | 'billing.payment.failed'
  | 'billing.trial.ending'
  | 'session.user.connected'
  | 'session.user.disconnected'
  | 'device.connected'
  | 'device.disconnected'
  | 'device.low_battery'
  | 'plugin.installed'
  | 'plugin.error'
  | 'system.health.degraded'
  | 'system.health.recovered'
  | 'custom';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying' | 'dead_letter';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;                // HMAC signing secret
  events: WebhookEventType[];    // Which events to deliver (* for all)
  enabled: boolean;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  
  // Rate limiting
  maxDeliveriesPerMin?: number;  // Default: 60
  
  // Circuit breaker
  failureThreshold?: number;     // Failures before opening circuit (default: 5)
  recoveryTimeMs?: number;       // Time in open state before half-open (default: 60000)
  
  // Headers
  customHeaders?: Record<string, string>;
}

export interface WebhookPayload {
  id: string;
  type: WebhookEventType;
  timestamp: number;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface DeliveryAttempt {
  attemptNumber: number;
  timestamp: number;
  statusCode?: number;
  responseBody?: string;
  durationMs: number;
  error?: string;
  success: boolean;
}

export interface DeliveryRecord {
  id: string;
  endpointId: string;
  payload: WebhookPayload;
  status: DeliveryStatus;
  attempts: DeliveryAttempt[];
  createdAt: number;
  completedAt?: number;
  nextRetryAt?: number;
}

export interface EndpointCircuitBreaker {
  state: CircuitState;
  failureCount: number;
  lastFailureAt?: number;
  openedAt?: number;
  halfOpenAttempts: number;
}

export interface WebhookDeliveryConfig {
  maxRetries: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  timeoutMs: number;
  maxPayloadSize: number;         // bytes
  maxEndpoints: number;
  maxDeadLetterSize: number;
  maxDeliveryHistory: number;
  defaultRatePerMin: number;
  batchSize: number;              // Max events per batch delivery
  batchWindowMs: number;          // Time to collect events before batch send
  signatureHeader: string;        // Header name for HMAC signature
  timestampHeader: string;        // Header name for timestamp
  deliveryIdHeader: string;       // Header name for delivery ID
}

export const DEFAULT_WEBHOOK_CONFIG: WebhookDeliveryConfig = {
  maxRetries: 5,
  baseRetryDelayMs: 1000,
  maxRetryDelayMs: 300000,       // 5 minutes
  timeoutMs: 10000,
  maxPayloadSize: 1024 * 1024,  // 1MB
  maxEndpoints: 50,
  maxDeadLetterSize: 1000,
  maxDeliveryHistory: 5000,
  defaultRatePerMin: 60,
  batchSize: 10,
  batchWindowMs: 5000,
  signatureHeader: 'X-OpenClaw-Signature',
  timestampHeader: 'X-OpenClaw-Timestamp',
  deliveryIdHeader: 'X-OpenClaw-Delivery-ID',
};

export interface WebhookDeliveryEvents {
  'delivery:success': (record: DeliveryRecord) => void;
  'delivery:failed': (record: DeliveryRecord) => void;
  'delivery:retrying': (record: DeliveryRecord, attempt: number) => void;
  'delivery:dead_letter': (record: DeliveryRecord) => void;
  'endpoint:circuit_open': (endpointId: string) => void;
  'endpoint:circuit_close': (endpointId: string) => void;
  'endpoint:rate_limited': (endpointId: string) => void;
}

// ──── HTTP Client Interface (injectable for testing) ────

export interface HttpClient {
  post(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<HttpResponse>;
}

export interface HttpResponse {
  status: number;
  body: string;
}

// ──── Default HTTP Client (uses fetch) ────

class DefaultHttpClient implements HttpClient {
  async post(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
        signal: controller.signal,
      });
      const responseBody = await response.text();
      return { status: response.status, body: responseBody };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ──── Webhook Delivery Engine ────

export class WebhookDeliveryEngine extends EventEmitter {
  private config: WebhookDeliveryConfig;
  private endpoints: Map<string, WebhookEndpoint> = new Map();
  private deliveries: Map<string, DeliveryRecord> = new Map();
  private deadLetterQueue: DeliveryRecord[] = [];
  private circuitBreakers: Map<string, EndpointCircuitBreaker> = new Map();
  private rateLimitCounters: Map<string, { count: number; windowStart: number }> = new Map();
  private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private httpClient: HttpClient;

  constructor(config: Partial<WebhookDeliveryConfig> = {}, httpClient?: HttpClient) {
    super();
    this.config = { ...DEFAULT_WEBHOOK_CONFIG, ...config };
    this.httpClient = httpClient ?? new DefaultHttpClient();
  }

  // ── Endpoint Management ──

  registerEndpoint(endpoint: Omit<WebhookEndpoint, 'id' | 'createdAt' | 'updatedAt'>): WebhookEndpoint {
    if (this.endpoints.size >= this.config.maxEndpoints) {
      throw new Error(`Maximum number of endpoints reached (${this.config.maxEndpoints})`);
    }

    if (!endpoint.url || !endpoint.url.startsWith('http')) {
      throw new Error('Endpoint URL must start with http:// or https://');
    }

    if (!endpoint.secret || endpoint.secret.length < 16) {
      throw new Error('Endpoint secret must be at least 16 characters');
    }

    if (!endpoint.events || endpoint.events.length === 0) {
      throw new Error('Endpoint must subscribe to at least one event type');
    }

    const id = this.generateId();
    const now = Date.now();

    const full: WebhookEndpoint = {
      ...endpoint,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.endpoints.set(id, full);
    this.circuitBreakers.set(id, {
      state: 'closed',
      failureCount: 0,
      halfOpenAttempts: 0,
    });

    return full;
  }

  updateEndpoint(id: string, updates: Partial<Pick<WebhookEndpoint, 'url' | 'events' | 'enabled' | 'description' | 'customHeaders' | 'maxDeliveriesPerMin'>>): WebhookEndpoint {
    const endpoint = this.endpoints.get(id);
    if (!endpoint) throw new Error(`Endpoint "${id}" not found`);

    if (updates.url && !updates.url.startsWith('http')) {
      throw new Error('Endpoint URL must start with http:// or https://');
    }

    Object.assign(endpoint, updates, { updatedAt: Date.now() });
    return endpoint;
  }

  removeEndpoint(id: string): void {
    if (!this.endpoints.has(id)) {
      throw new Error(`Endpoint "${id}" not found`);
    }
    this.endpoints.delete(id);
    this.circuitBreakers.delete(id);
    this.rateLimitCounters.delete(id);

    // Cancel pending retries for this endpoint
    const timer = this.retryTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(id);
    }
  }

  getEndpoint(id: string): WebhookEndpoint | undefined {
    return this.endpoints.get(id);
  }

  listEndpoints(): WebhookEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  rotateSecret(id: string): string {
    const endpoint = this.endpoints.get(id);
    if (!endpoint) throw new Error(`Endpoint "${id}" not found`);

    const newSecret = randomBytes(32).toString('hex');
    endpoint.secret = newSecret;
    endpoint.updatedAt = Date.now();
    return newSecret;
  }

  // ── Dispatch Events ──

  async dispatch(type: WebhookEventType, data: Record<string, unknown>, metadata?: Record<string, unknown>): Promise<DeliveryRecord[]> {
    const payload: WebhookPayload = {
      id: this.generateId(),
      type,
      timestamp: Date.now(),
      data,
      metadata,
    };

    // Check payload size
    const payloadStr = JSON.stringify(payload);
    if (payloadStr.length > this.config.maxPayloadSize) {
      throw new Error(`Payload size (${payloadStr.length}) exceeds maximum (${this.config.maxPayloadSize})`);
    }

    const records: DeliveryRecord[] = [];

    for (const [, endpoint] of this.endpoints) {
      if (!endpoint.enabled) continue;
      if (!this.eventMatchesEndpoint(type, endpoint)) continue;

      const record = await this.deliverToEndpoint(endpoint, payload);
      records.push(record);
    }

    return records;
  }

  // ── Delivery ──

  private async deliverToEndpoint(endpoint: WebhookEndpoint, payload: WebhookPayload): Promise<DeliveryRecord> {
    const record: DeliveryRecord = {
      id: this.generateId(),
      endpointId: endpoint.id,
      payload,
      status: 'pending',
      attempts: [],
      createdAt: Date.now(),
    };

    this.storeDeliveryRecord(record);

    // Check circuit breaker
    const cb = this.circuitBreakers.get(endpoint.id);
    if (cb && cb.state === 'open') {
      // Check if recovery time has passed
      if (cb.openedAt && Date.now() - cb.openedAt > (endpoint.recoveryTimeMs ?? 60000)) {
        cb.state = 'half_open';
        cb.halfOpenAttempts = 0;
      } else {
        record.status = 'failed';
        record.completedAt = Date.now();
        record.attempts.push({
          attemptNumber: 0,
          timestamp: Date.now(),
          durationMs: 0,
          error: 'Circuit breaker open',
          success: false,
        });
        return record;
      }
    }

    // Check rate limit
    if (!this.checkRateLimit(endpoint)) {
      record.status = 'failed';
      record.completedAt = Date.now();
      record.attempts.push({
        attemptNumber: 0,
        timestamp: Date.now(),
        durationMs: 0,
        error: 'Rate limit exceeded',
        success: false,
      });
      this.emit('endpoint:rate_limited', endpoint.id);
      return record;
    }

    // Attempt delivery
    await this.attemptDelivery(record, endpoint, 1);

    return record;
  }

  private async attemptDelivery(record: DeliveryRecord, endpoint: WebhookEndpoint, attemptNumber: number): Promise<void> {
    const payloadStr = JSON.stringify(record.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.signPayload(payloadStr, timestamp, endpoint.secret);

    const headers: Record<string, string> = {
      [this.config.signatureHeader]: signature,
      [this.config.timestampHeader]: timestamp,
      [this.config.deliveryIdHeader]: record.id,
      ...(endpoint.customHeaders ?? {}),
    };

    const startTime = Date.now();

    try {
      const response = await this.httpClient.post(
        endpoint.url,
        payloadStr,
        headers,
        this.config.timeoutMs
      );

      const duration = Date.now() - startTime;
      const success = response.status >= 200 && response.status < 300;

      record.attempts.push({
        attemptNumber,
        timestamp: Date.now(),
        statusCode: response.status,
        responseBody: response.body.substring(0, 500), // Trim long responses
        durationMs: duration,
        success,
      });

      if (success) {
        record.status = 'delivered';
        record.completedAt = Date.now();
        this.updateCircuitBreaker(endpoint.id, true);
        this.emit('delivery:success', record);
      } else {
        this.handleFailedAttempt(record, endpoint, attemptNumber, `HTTP ${response.status}`);
      }
    } catch (err) {
      const duration = Date.now() - startTime;
      record.attempts.push({
        attemptNumber,
        timestamp: Date.now(),
        durationMs: duration,
        error: (err as Error).message,
        success: false,
      });

      this.handleFailedAttempt(record, endpoint, attemptNumber, (err as Error).message);
    }
  }

  private handleFailedAttempt(record: DeliveryRecord, endpoint: WebhookEndpoint, attemptNumber: number, reason: string): void {
    this.updateCircuitBreaker(endpoint.id, false);

    if (attemptNumber >= this.config.maxRetries) {
      // Move to dead letter queue
      record.status = 'dead_letter';
      record.completedAt = Date.now();
      this.addToDeadLetter(record);
      this.emit('delivery:dead_letter', record);
      this.emit('delivery:failed', record);
    } else {
      // Schedule retry
      record.status = 'retrying';
      const delay = this.calculateRetryDelay(attemptNumber);
      record.nextRetryAt = Date.now() + delay;

      this.emit('delivery:retrying', record, attemptNumber);

      const timer = setTimeout(async () => {
        this.retryTimers.delete(record.id);
        // Re-fetch endpoint (it may have changed)
        const ep = this.endpoints.get(record.endpointId);
        if (ep && ep.enabled) {
          await this.attemptDelivery(record, ep, attemptNumber + 1);
        } else {
          record.status = 'failed';
          record.completedAt = Date.now();
        }
      }, delay);

      this.retryTimers.set(record.id, timer);
    }
  }

  // ── Signature ──

  signPayload(payload: string, timestamp: string, secret: string): string {
    const data = `${timestamp}.${payload}`;
    return `v1=${createHmac('sha256', secret).update(data).digest('hex')}`;
  }

  verifySignature(payload: string, timestamp: string, signature: string, secret: string): boolean {
    const expected = this.signPayload(payload, timestamp, secret);
    
    // Constant-time comparison
    if (expected.length !== signature.length) return false;
    
    let result = 0;
    for (let i = 0; i < expected.length; i++) {
      result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return result === 0;
  }

  // ── Circuit Breaker ──

  private updateCircuitBreaker(endpointId: string, success: boolean): void {
    const cb = this.circuitBreakers.get(endpointId);
    if (!cb) return;

    if (success) {
      if (cb.state === 'half_open') {
        cb.state = 'closed';
        cb.failureCount = 0;
        this.emit('endpoint:circuit_close', endpointId);
      } else {
        cb.failureCount = Math.max(0, cb.failureCount - 1);
      }
    } else {
      cb.failureCount++;
      cb.lastFailureAt = Date.now();

      const endpoint = this.endpoints.get(endpointId);
      const threshold = endpoint?.failureThreshold ?? 5;

      if (cb.failureCount >= threshold && cb.state === 'closed') {
        cb.state = 'open';
        cb.openedAt = Date.now();
        this.emit('endpoint:circuit_open', endpointId);
      }
    }
  }

  getCircuitState(endpointId: string): CircuitState | undefined {
    return this.circuitBreakers.get(endpointId)?.state;
  }

  resetCircuitBreaker(endpointId: string): void {
    const cb = this.circuitBreakers.get(endpointId);
    if (!cb) throw new Error(`Endpoint "${endpointId}" not found`);
    cb.state = 'closed';
    cb.failureCount = 0;
    cb.openedAt = undefined;
    cb.halfOpenAttempts = 0;
  }

  // ── Rate Limiting ──

  private checkRateLimit(endpoint: WebhookEndpoint): boolean {
    const maxRate = endpoint.maxDeliveriesPerMin ?? this.config.defaultRatePerMin;
    const counter = this.rateLimitCounters.get(endpoint.id);
    const now = Date.now();

    if (!counter || now - counter.windowStart > 60000) {
      this.rateLimitCounters.set(endpoint.id, { count: 1, windowStart: now });
      return true;
    }

    if (counter.count >= maxRate) {
      return false;
    }

    counter.count++;
    return true;
  }

  // ── Retry Delay ──

  private calculateRetryDelay(attempt: number): number {
    const base = this.config.baseRetryDelayMs;
    const delay = Math.min(base * Math.pow(2, attempt - 1), this.config.maxRetryDelayMs);
    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(delay + jitter));
  }

  // ── Dead Letter Queue ──

  private addToDeadLetter(record: DeliveryRecord): void {
    this.deadLetterQueue.push(record);
    if (this.deadLetterQueue.length > this.config.maxDeadLetterSize) {
      this.deadLetterQueue.shift();
    }
  }

  getDeadLetterQueue(): DeliveryRecord[] {
    return [...this.deadLetterQueue];
  }

  async replayDeadLetter(deliveryId: string): Promise<DeliveryRecord | undefined> {
    const index = this.deadLetterQueue.findIndex(r => r.id === deliveryId);
    if (index === -1) return undefined;

    const record = this.deadLetterQueue[index];
    const endpoint = this.endpoints.get(record.endpointId);
    if (!endpoint || !endpoint.enabled) return undefined;

    // Remove from DLQ
    this.deadLetterQueue.splice(index, 1);

    // Reset and redeliver
    record.status = 'pending';
    record.attempts = [];
    record.completedAt = undefined;
    record.nextRetryAt = undefined;

    await this.attemptDelivery(record, endpoint, 1);
    return record;
  }

  clearDeadLetterQueue(): number {
    const count = this.deadLetterQueue.length;
    this.deadLetterQueue = [];
    return count;
  }

  // ── Delivery History ──

  getDeliveryRecord(id: string): DeliveryRecord | undefined {
    return this.deliveries.get(id);
  }

  getDeliveryHistory(endpointId?: string, limit = 50): DeliveryRecord[] {
    let records = Array.from(this.deliveries.values());

    if (endpointId) {
      records = records.filter(r => r.endpointId === endpointId);
    }

    return records
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  private storeDeliveryRecord(record: DeliveryRecord): void {
    this.deliveries.set(record.id, record);

    // Trim history
    if (this.deliveries.size > this.config.maxDeliveryHistory) {
      const oldest = Array.from(this.deliveries.entries())
        .sort((a, b) => a[1].createdAt - b[1].createdAt);
      const toRemove = oldest.slice(0, this.deliveries.size - this.config.maxDeliveryHistory);
      for (const [id] of toRemove) {
        this.deliveries.delete(id);
      }
    }
  }

  // ── Event Matching ──

  private eventMatchesEndpoint(type: WebhookEventType, endpoint: WebhookEndpoint): boolean {
    if (endpoint.events.includes('custom')) return true; // Wildcard
    if (endpoint.events.includes(type)) return true;

    // Check prefix matching (e.g., 'inventory.*' matches 'inventory.session.started')
    const typeParts = type.split('.');
    for (const event of endpoint.events) {
      if (event.endsWith('.*')) {
        const prefix = event.slice(0, -2);
        if (type.startsWith(prefix)) return true;
      }
      // Also match top-level category
      const eventParts = event.split('.');
      if (eventParts[0] === typeParts[0] && eventParts.length === 1) {
        // e.g., subscribing to 'inventory' matches all inventory events
        // Only if explicitly handled as a category subscription
      }
    }

    return false;
  }

  // ── Stats ──

  getStats(): WebhookDeliveryStats {
    let totalDeliveries = 0;
    let successfulDeliveries = 0;
    let failedDeliveries = 0;
    let pendingDeliveries = 0;
    let totalAttempts = 0;
    let totalLatencyMs = 0;

    for (const [, record] of this.deliveries) {
      totalDeliveries++;
      if (record.status === 'delivered') {
        successfulDeliveries++;
        // Use first successful attempt latency
        const successAttempt = record.attempts.find(a => a.success);
        if (successAttempt) {
          totalLatencyMs += successAttempt.durationMs;
        }
      } else if (record.status === 'failed' || record.status === 'dead_letter') {
        failedDeliveries++;
      } else {
        pendingDeliveries++;
      }
      totalAttempts += record.attempts.length;
    }

    return {
      totalEndpoints: this.endpoints.size,
      enabledEndpoints: Array.from(this.endpoints.values()).filter(e => e.enabled).length,
      totalDeliveries,
      successfulDeliveries,
      failedDeliveries,
      pendingDeliveries,
      deadLetterCount: this.deadLetterQueue.length,
      totalAttempts,
      avgLatencyMs: successfulDeliveries > 0 ? Math.round(totalLatencyMs / successfulDeliveries) : 0,
      successRate: totalDeliveries > 0 ? successfulDeliveries / totalDeliveries : 0,
    };
  }

  getVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];
    parts.push(`${stats.totalEndpoints} webhook endpoints, ${stats.enabledEndpoints} active.`);
    if (stats.totalDeliveries > 0) {
      parts.push(`${stats.successfulDeliveries} of ${stats.totalDeliveries} deliveries successful.`);
      parts.push(`Average latency: ${stats.avgLatencyMs}ms.`);
    }
    if (stats.deadLetterCount > 0) {
      parts.push(`${stats.deadLetterCount} messages in dead letter queue.`);
    }
    return parts.join(' ');
  }

  // ── Cleanup ──

  destroy(): void {
    for (const [, timer] of this.retryTimers) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
  }

  // ── Helpers ──

  private generateId(): string {
    return `whk_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
  }
}

// ──── Stats Type ────

export interface WebhookDeliveryStats {
  totalEndpoints: number;
  enabledEndpoints: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  pendingDeliveries: number;
  deadLetterCount: number;
  totalAttempts: number;
  avgLatencyMs: number;
  successRate: number;
}
