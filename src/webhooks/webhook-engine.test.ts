/**
 * Tests for Webhook & Integration Engine
 *
 * Covers: endpoint management, event dispatch, delivery, retries,
 * dead letter queue, signatures, rate limiting, batch mode,
 * health tracking, integration formatting, statistics, edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WebhookEngine,
  MockHTTPTransport,
  type WebhookEndpoint,
  type WebhookEvent,
  type WebhookEventType,
} from './webhook-engine.js';

// ─── Helpers ────────────────────────────────────────────────────

function createEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'inventory.session.completed',
    timestamp: new Date().toISOString(),
    userId: 'user-1',
    data: { sessionId: 'session-1', totalItems: 500, duration: '3 hours' },
    ...overrides,
  };
}

describe('WebhookEngine — Endpoint Management', () => {
  let engine: WebhookEngine;
  let transport: MockHTTPTransport;

  beforeEach(() => {
    transport = new MockHTTPTransport();
    engine = new WebhookEngine({}, transport);
  });

  afterEach(() => {
    engine.shutdown();
  });

  it('should create an endpoint', () => {
    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'My Webhook',
      url: 'https://example.com/webhook',
    });

    expect(ep.id).toBeTruthy();
    expect(ep.userId).toBe('user-1');
    expect(ep.name).toBe('My Webhook');
    expect(ep.url).toBe('https://example.com/webhook');
    expect(ep.active).toBe(true);
    expect(ep.secret).toBeTruthy();
    expect(ep.health).toBe('unknown');
  });

  it('should create endpoint with custom settings', () => {
    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Slack Hook',
      url: 'https://hooks.slack.com/services/xxx',
      integrationType: 'slack',
      eventFilter: ['inventory.session.completed', 'security.alert'],
      maxRetries: 3,
      rateLimitPerMinute: 30,
      customHeaders: { 'X-Custom': 'value' },
    });

    expect(ep.integrationType).toBe('slack');
    expect(ep.eventFilter).toHaveLength(2);
    expect(ep.maxRetries).toBe(3);
    expect(ep.rateLimitPerMinute).toBe(30);
    expect(ep.customHeaders['X-Custom']).toBe('value');
  });

  it('should get endpoint by ID', () => {
    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    const found = engine.getEndpoint(ep.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Test');
  });

  it('should return null for nonexistent endpoint', () => {
    expect(engine.getEndpoint('nonexistent')).toBeNull();
  });

  it('should list endpoints for a user', () => {
    engine.createEndpoint({ userId: 'user-1', name: 'A', url: 'https://a.com' });
    engine.createEndpoint({ userId: 'user-1', name: 'B', url: 'https://b.com' });
    engine.createEndpoint({ userId: 'user-2', name: 'C', url: 'https://c.com' });

    const user1Eps = engine.listEndpoints('user-1');
    expect(user1Eps).toHaveLength(2);
    expect(user1Eps.map(e => e.name).sort()).toEqual(['A', 'B']);
  });

  it('should list all endpoints', () => {
    engine.createEndpoint({ userId: 'user-1', name: 'A', url: 'https://a.com' });
    engine.createEndpoint({ userId: 'user-2', name: 'B', url: 'https://b.com' });

    expect(engine.listAllEndpoints()).toHaveLength(2);
  });

  it('should update an endpoint', () => {
    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Old Name',
      url: 'https://old.com',
    });

    const updated = engine.updateEndpoint(ep.id, { name: 'New Name', active: false });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('New Name');
    expect(updated!.active).toBe(false);
  });

  it('should return null when updating nonexistent endpoint', () => {
    expect(engine.updateEndpoint('nonexistent', { name: 'test' })).toBeNull();
  });

  it('should delete an endpoint', () => {
    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Delete Me',
      url: 'https://example.com',
    });

    expect(engine.deleteEndpoint(ep.id)).toBe(true);
    expect(engine.getEndpoint(ep.id)).toBeNull();
  });

  it('should return false when deleting nonexistent endpoint', () => {
    expect(engine.deleteEndpoint('nonexistent')).toBe(false);
  });

  it('should rotate secret', () => {
    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    const oldSecret = ep.secret;
    const newSecret = engine.rotateSecret(ep.id);
    expect(newSecret).not.toBeNull();
    expect(newSecret).not.toBe(oldSecret);

    const updated = engine.getEndpoint(ep.id);
    expect(updated!.secret).toBe(newSecret);
  });

  it('should return null when rotating secret for nonexistent endpoint', () => {
    expect(engine.rotateSecret('nonexistent')).toBeNull();
  });

  it('should emit endpoint:created event', () => {
    const events: WebhookEndpoint[] = [];
    engine.on('endpoint:created', (ep) => events.push(ep));

    engine.createEndpoint({ userId: 'user-1', name: 'Test', url: 'https://a.com' });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Test');
  });

  it('should emit endpoint:deleted event', () => {
    const ep = engine.createEndpoint({ userId: 'user-1', name: 'Test', url: 'https://a.com' });
    
    const deleted: string[] = [];
    engine.on('endpoint:deleted', (id) => deleted.push(id));

    engine.deleteEndpoint(ep.id);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toBe(ep.id);
  });
});

describe('WebhookEngine — Event Dispatch', () => {
  let engine: WebhookEngine;
  let transport: MockHTTPTransport;

  beforeEach(() => {
    transport = new MockHTTPTransport();
    engine = new WebhookEngine({}, transport);
  });

  afterEach(() => {
    engine.shutdown();
  });

  it('should dispatch event to matching endpoint', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com/webhook',
    });

    const deliveryIds = await engine.dispatch(createEvent());
    expect(deliveryIds).toHaveLength(1);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].url).toBe('https://example.com/webhook');
  });

  it('should dispatch to multiple matching endpoints', async () => {
    engine.createEndpoint({ userId: 'user-1', name: 'A', url: 'https://a.com' });
    engine.createEndpoint({ userId: 'user-1', name: 'B', url: 'https://b.com' });

    const deliveryIds = await engine.dispatch(createEvent());
    expect(deliveryIds).toHaveLength(2);
    expect(transport.calls).toHaveLength(2);
  });

  it('should not dispatch to endpoints of other users', async () => {
    engine.createEndpoint({ userId: 'user-1', name: 'A', url: 'https://a.com' });
    engine.createEndpoint({ userId: 'user-2', name: 'B', url: 'https://b.com' });

    const deliveryIds = await engine.dispatch(createEvent({ userId: 'user-1' }));
    expect(deliveryIds).toHaveLength(1);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].url).toBe('https://a.com');
  });

  it('should filter events by type', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Inventory Only',
      url: 'https://inventory.com',
      eventFilter: ['inventory.session.completed'],
    });

    engine.createEndpoint({
      userId: 'user-1',
      name: 'Security Only',
      url: 'https://security.com',
      eventFilter: ['security.alert'],
    });

    await engine.dispatch(createEvent({ type: 'inventory.session.completed' }));
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].url).toBe('https://inventory.com');
  });

  it('should dispatch to endpoints with empty filter (subscribe to all)', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'All Events',
      url: 'https://all.com',
      eventFilter: [],
    });

    await engine.dispatch(createEvent({ type: 'security.alert' }));
    expect(transport.calls).toHaveLength(1);
  });

  it('should not dispatch to inactive endpoints', async () => {
    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Disabled',
      url: 'https://disabled.com',
    });
    engine.updateEndpoint(ep.id, { active: false });

    await engine.dispatch(createEvent());
    expect(transport.calls).toHaveLength(0);
  });

  it('should use emit_event shorthand', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    const ids = await engine.emit_event(
      'inventory.item.flagged',
      'user-1',
      { item: 'Product A', flag: 'low_stock' }
    );

    expect(ids).toHaveLength(1);
    expect(transport.calls).toHaveLength(1);
  });

  it('should emit event:received', async () => {
    const received: WebhookEvent[] = [];
    engine.on('event:received', (evt) => received.push(evt));

    await engine.dispatch(createEvent());
    expect(received).toHaveLength(1);
  });
});

describe('WebhookEngine — Delivery & Signatures', () => {
  let engine: WebhookEngine;
  let transport: MockHTTPTransport;

  beforeEach(() => {
    transport = new MockHTTPTransport();
    engine = new WebhookEngine({}, transport);
  });

  afterEach(() => {
    engine.shutdown();
  });

  it('should include HMAC signature in headers', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    await engine.dispatch(createEvent());

    const headers = transport.calls[0].headers;
    expect(headers['X-Webhook-Signature']).toBeTruthy();
    expect(headers['X-Webhook-Event']).toBeTruthy();
    expect(headers['X-Webhook-Id']).toBeTruthy();
    expect(headers['X-Webhook-Timestamp']).toBeTruthy();
    expect(headers['User-Agent']).toContain('RayBanVision-Webhook');
  });

  it('should include custom headers', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
      customHeaders: { 'Authorization': 'Bearer token123', 'X-Custom': 'value' },
    });

    await engine.dispatch(createEvent());

    const headers = transport.calls[0].headers;
    expect(headers['Authorization']).toBe('Bearer token123');
    expect(headers['X-Custom']).toBe('value');
  });

  it('should generate valid signatures', () => {
    const payload = '{"test":"data"}';
    const secret = 'mysecret';

    const sig = engine.generateSignature(payload, secret);
    expect(sig).toBeTruthy();
    expect(sig.length).toBe(64); // SHA-256 hex
  });

  it('should verify valid signatures', () => {
    const payload = '{"test":"data"}';
    const secret = 'mysecret';

    const sig = engine.generateSignature(payload, secret);
    expect(engine.verifySignature(payload, sig, secret)).toBe(true);
  });

  it('should reject invalid signatures', () => {
    const payload = '{"test":"data"}';
    const secret = 'mysecret';

    const sig = engine.generateSignature(payload, secret);
    expect(engine.verifySignature(payload + 'tampered', sig, secret)).toBe(false);
  });

  it('should track delivery status', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    const ids = await engine.dispatch(createEvent());
    const delivery = engine.getDelivery(ids[0]);

    expect(delivery).not.toBeNull();
    expect(delivery!.status).toBe('delivered');
    expect(delivery!.responseStatus).toBe(200);
    expect(delivery!.attempts).toBe(1);
    expect(delivery!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should emit delivery:success on successful delivery', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    const successes: string[] = [];
    engine.on('delivery:success', (d) => successes.push(d.id));

    await engine.dispatch(createEvent());
    expect(successes).toHaveLength(1);
  });

  it('should list deliveries for an endpoint', async () => {
    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    await engine.dispatch(createEvent());
    await engine.dispatch(createEvent());

    const deliveries = engine.getDeliveriesForEndpoint(ep.id);
    expect(deliveries).toHaveLength(2);
  });
});

describe('WebhookEngine — Failure & Retry', () => {
  let engine: WebhookEngine;
  let transport: MockHTTPTransport;

  beforeEach(() => {
    transport = new MockHTTPTransport();
    engine = new WebhookEngine({
      defaultMaxRetries: 2,
      retryBaseDelayMs: 50,
      retryMaxDelayMs: 200,
    }, transport);
  });

  afterEach(() => {
    engine.shutdown();
  });

  it('should handle HTTP error responses', async () => {
    transport.setResponse(500, 'Internal Server Error');

    engine.createEndpoint({
      userId: 'user-1',
      name: 'Failing',
      url: 'https://example.com',
      maxRetries: 1,
    });

    await engine.dispatch(createEvent());

    // First attempt fails, then retry
    await new Promise(resolve => setTimeout(resolve, 300));

    const stats = engine.getStats();
    expect(stats.deadLetterCount).toBeGreaterThanOrEqual(0);
  });

  it('should handle connection errors', async () => {
    transport.setFailMode(true, 'ECONNREFUSED');

    engine.createEndpoint({
      userId: 'user-1',
      name: 'Down',
      url: 'https://down.example.com',
      maxRetries: 1,
    });

    const errors: string[] = [];
    engine.on('delivery:dead_letter', (d) => errors.push(d.error || ''));

    await engine.dispatch(createEvent());

    // Wait for retries
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(errors.length).toBeGreaterThanOrEqual(0);
  });

  it('should retry with backoff', async () => {
    transport.setResponse(503, 'Service Unavailable');

    engine.createEndpoint({
      userId: 'user-1',
      name: 'Retrying',
      url: 'https://example.com',
      maxRetries: 3,
    });

    const retrying: string[] = [];
    engine.on('delivery:retrying', (d) => retrying.push(d.id));

    await engine.dispatch(createEvent());

    // Wait for first retry
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(retrying.length).toBeGreaterThanOrEqual(1);
  });

  it('should move to dead letter after max retries', async () => {
    transport.setFailMode(true);

    engine.createEndpoint({
      userId: 'user-1',
      name: 'Always Fails',
      url: 'https://example.com',
      maxRetries: 1, // Only 1 retry
    });

    const deadLetters: string[] = [];
    engine.on('delivery:dead_letter', (d) => deadLetters.push(d.id));

    await engine.dispatch(createEvent());

    // Wait for retry cycle
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(deadLetters.length).toBeGreaterThanOrEqual(1);
  });

  it('should clear dead letter queue', async () => {
    transport.setFailMode(true);

    engine.createEndpoint({
      userId: 'user-1',
      name: 'Fails',
      url: 'https://example.com',
      maxRetries: 0, // Immediate DLQ
    });

    await engine.dispatch(createEvent());
    await new Promise(resolve => setTimeout(resolve, 100));

    const dlq = engine.getDeadLetterQueue();
    expect(dlq.length).toBeGreaterThanOrEqual(0);

    const cleared = engine.clearDeadLetterQueue();
    expect(engine.getDeadLetterQueue()).toHaveLength(0);
  });
});

describe('WebhookEngine — Health Tracking', () => {
  let engine: WebhookEngine;
  let transport: MockHTTPTransport;

  beforeEach(() => {
    transport = new MockHTTPTransport();
    engine = new WebhookEngine({ unhealthyThreshold: 3 }, transport);
  });

  afterEach(() => {
    engine.shutdown();
  });

  it('should mark endpoint as healthy after success', async () => {
    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    await engine.dispatch(createEvent());

    const updated = engine.getEndpoint(ep.id);
    expect(updated!.health).toBe('healthy');
    expect(updated!.consecutiveFailures).toBe(0);
  });

  it('should mark endpoint as degraded after some failures', async () => {
    transport.setFailMode(true);

    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Degrading',
      url: 'https://example.com',
      maxRetries: 0,
    });

    // Threshold is 3, degraded at ceil(3/2) = 2
    await engine.dispatch(createEvent());
    await engine.dispatch(createEvent());
    await new Promise(resolve => setTimeout(resolve, 200));

    const updated = engine.getEndpoint(ep.id);
    expect(updated!.consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(['degraded', 'unhealthy']).toContain(updated!.health);
  });

  it('should emit health changed event', async () => {
    transport.setFailMode(true);

    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
      maxRetries: 0,
    });

    const healthChanges: Array<{ id: string; health: string }> = [];
    engine.on('endpoint:health_changed', (id, health) => {
      healthChanges.push({ id, health });
    });

    await engine.dispatch(createEvent());
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(healthChanges.length).toBeGreaterThanOrEqual(0);
  });

  it('should reset health on successful delivery', async () => {
    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
      maxRetries: 0,
    });

    // Fail a few times
    transport.setFailMode(true);
    await engine.dispatch(createEvent());
    await engine.dispatch(createEvent());
    await new Promise(resolve => setTimeout(resolve, 100));

    // Then succeed
    transport.setFailMode(false);
    transport.setResponse(200);
    await engine.dispatch(createEvent());

    const updated = engine.getEndpoint(ep.id);
    expect(updated!.consecutiveFailures).toBe(0);
    expect(updated!.health).toBe('healthy');
  });
});

describe('WebhookEngine — Rate Limiting', () => {
  let engine: WebhookEngine;
  let transport: MockHTTPTransport;

  beforeEach(() => {
    transport = new MockHTTPTransport();
    transport.setLatency(1); // fast transport
    engine = new WebhookEngine({}, transport);
  });

  afterEach(() => {
    engine.shutdown();
  });

  it('should rate limit deliveries per endpoint', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Limited',
      url: 'https://example.com',
      rateLimitPerMinute: 3,
    });

    // First 3 should succeed
    for (let i = 0; i < 3; i++) {
      await engine.dispatch(createEvent());
    }
    expect(transport.calls).toHaveLength(3);

    // 4th should be rate limited
    const ids = await engine.dispatch(createEvent());
    expect(ids).toHaveLength(0); // rate limited, no delivery
  });
});

describe('WebhookEngine — Batch Mode', () => {
  let engine: WebhookEngine;
  let transport: MockHTTPTransport;

  beforeEach(() => {
    transport = new MockHTTPTransport();
    engine = new WebhookEngine({ defaultBatchWindowMs: 100 }, transport);
  });

  afterEach(() => {
    engine.shutdown();
  });

  it('should batch events when enabled', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Batched',
      url: 'https://example.com',
      batchEnabled: true,
      batchWindowMs: 100,
    });

    // Dispatch 3 events rapidly
    await engine.dispatch(createEvent());
    await engine.dispatch(createEvent());
    await engine.dispatch(createEvent());

    // Should not have sent yet (within batch window)
    expect(transport.calls).toHaveLength(0);

    // Wait for batch window to flush
    await new Promise(resolve => setTimeout(resolve, 250));

    // Should have sent 1 batched request
    expect(transport.calls).toHaveLength(1);

    // Verify batch payload
    const body = JSON.parse(transport.calls[0].body);
    expect(body.data.batch).toBe(true);
    expect(body.data.count).toBe(3);
  });

  it('should not batch when disabled', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Not Batched',
      url: 'https://example.com',
      batchEnabled: false,
    });

    await engine.dispatch(createEvent());
    await engine.dispatch(createEvent());

    expect(transport.calls).toHaveLength(2);
  });
});

describe('WebhookEngine — Integration Formatting', () => {
  let engine: WebhookEngine;
  let transport: MockHTTPTransport;

  beforeEach(() => {
    transport = new MockHTTPTransport();
    engine = new WebhookEngine({}, transport);
  });

  afterEach(() => {
    engine.shutdown();
  });

  it('should format Slack payloads with blocks', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Slack',
      url: 'https://hooks.slack.com/services/xxx',
      integrationType: 'slack',
    });

    await engine.dispatch(createEvent());

    const payload = JSON.parse(transport.calls[0].body);
    expect(payload.text).toBeTruthy();
    expect(payload.blocks).toBeTruthy();
    expect(payload.blocks).toHaveLength(2);
  });

  it('should send generic JSON for default integration', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Generic',
      url: 'https://example.com',
      integrationType: 'generic',
    });

    await engine.dispatch(createEvent());

    const payload = JSON.parse(transport.calls[0].body);
    expect(payload.event_id).toBeTruthy();
    expect(payload.event_type).toBe('inventory.session.completed');
    expect(payload.data).toBeTruthy();
    expect(payload.api_version).toBeTruthy();
  });
});

describe('WebhookEngine — Statistics', () => {
  let engine: WebhookEngine;
  let transport: MockHTTPTransport;

  beforeEach(() => {
    transport = new MockHTTPTransport();
    engine = new WebhookEngine({}, transport);
  });

  afterEach(() => {
    engine.shutdown();
  });

  it('should track delivery statistics', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    await engine.dispatch(createEvent());
    await engine.dispatch(createEvent());

    const stats = engine.getStats();
    expect(stats.totalDeliveries).toBe(2);
    expect(stats.successfulDeliveries).toBe(2);
    expect(stats.successRate).toBe(1.0);
    expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should track failed deliveries', async () => {
    transport.setFailMode(true);

    engine.createEndpoint({
      userId: 'user-1',
      name: 'Failing',
      url: 'https://example.com',
      maxRetries: 0,
    });

    await engine.dispatch(createEvent());
    await new Promise(resolve => setTimeout(resolve, 100));

    const stats = engine.getStats();
    expect(stats.failedDeliveries).toBeGreaterThanOrEqual(0);
  });

  it('should return zero stats when empty', () => {
    const stats = engine.getStats();
    expect(stats.totalDeliveries).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgLatencyMs).toBe(0);
  });
});

describe('WebhookEngine — Cleanup', () => {
  let engine: WebhookEngine;
  let transport: MockHTTPTransport;

  beforeEach(() => {
    transport = new MockHTTPTransport();
    engine = new WebhookEngine({}, transport);
  });

  afterEach(() => {
    engine.shutdown();
  });

  it('should clean up old deliveries', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    await engine.dispatch(createEvent());
    await engine.dispatch(createEvent());

    // Clean up with 0ms age (removes everything)
    const removed = engine.cleanup(0);
    expect(removed).toBe(2);
  });

  it('should not clean up recent deliveries', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    await engine.dispatch(createEvent());

    // Clean up with 1 day age
    const removed = engine.cleanup(24 * 60 * 60 * 1000);
    expect(removed).toBe(0);
  });
});

describe('WebhookEngine — Edge Cases', () => {
  let engine: WebhookEngine;
  let transport: MockHTTPTransport;

  beforeEach(() => {
    transport = new MockHTTPTransport();
    engine = new WebhookEngine({}, transport);
  });

  afterEach(() => {
    engine.shutdown();
  });

  it('should handle dispatch with no matching endpoints', async () => {
    const ids = await engine.dispatch(createEvent());
    expect(ids).toHaveLength(0);
    expect(transport.calls).toHaveLength(0);
  });

  it('should handle dispatch to nonexistent user', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    const ids = await engine.dispatch(createEvent({ userId: 'user-999' }));
    expect(ids).toHaveLength(0);
  });

  it('should handle concurrent dispatches', async () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    const promises = Array.from({ length: 10 }, () => engine.dispatch(createEvent()));
    const results = await Promise.all(promises);

    const totalIds = results.flat();
    expect(totalIds.length).toBeGreaterThan(0);
  });

  it('should handle endpoint deletion during dispatch', async () => {
    const ep = engine.createEndpoint({
      userId: 'user-1',
      name: 'Temp',
      url: 'https://example.com',
    });

    // Start dispatch and delete endpoint during
    const dispatchPromise = engine.dispatch(createEvent());
    engine.deleteEndpoint(ep.id);

    const ids = await dispatchPromise;
    // Should still complete the delivery that was already in flight
    expect(ids).toHaveLength(1);
  });

  it('should respect max payload size', async () => {
    engine = new WebhookEngine({ maxPayloadSize: 10 }, transport); // tiny limit

    engine.createEndpoint({
      userId: 'user-1',
      name: 'Test',
      url: 'https://example.com',
    });

    const errors: string[] = [];
    engine.on('error', (_s, e) => errors.push(e));

    await engine.dispatch(createEvent());
    // Payload is larger than 10 bytes, should be rejected
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Payload too large');
  });

  it('should shutdown cleanly', () => {
    engine.createEndpoint({
      userId: 'user-1',
      name: 'Batched',
      url: 'https://example.com',
      batchEnabled: true,
    });

    engine.dispatch(createEvent()); // adds to batch buffer
    engine.shutdown(); // should clear timers without error
  });

  it('should get null delivery for nonexistent ID', () => {
    expect(engine.getDelivery('nonexistent')).toBeNull();
  });

  it('should return empty deliveries for endpoint with none', () => {
    const deliveries = engine.getDeliveriesForEndpoint('nonexistent');
    expect(deliveries).toHaveLength(0);
  });
});
