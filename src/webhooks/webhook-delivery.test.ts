/**
 * Tests for Webhook Delivery Engine
 * 🌙 Night Shift Agent — Night #35
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebhookDeliveryEngine, type WebhookDelivery } from './webhook-delivery.js';

// Mock HTTP sender
function createMockSender(
  responses: Array<{ status: number; body: string }> = [{ status: 200, body: 'OK' }]
) {
  let callIndex = 0;
  const sender = vi.fn(async (url: string, payload: string, headers: Record<string, string>, timeoutMs: number) => {
    const response = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return { status: response.status, body: response.body, timeMs: 50 };
  });
  return sender;
}

function createFailingSender(errorMsg = 'Connection refused') {
  return vi.fn(async () => {
    throw new Error(errorMsg);
  });
}

describe('WebhookDeliveryEngine', () => {
  let engine: WebhookDeliveryEngine;
  let mockSender: ReturnType<typeof createMockSender>;

  beforeEach(() => {
    mockSender = createMockSender();
    engine = new WebhookDeliveryEngine(
      { maxRetries: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 10 },
      mockSender
    );
  });

  // ─── Registration ──────────────────────────────────────────────────

  describe('Webhook Registration', () => {
    it('should register a webhook', () => {
      const wh = engine.registerWebhook({
        tenantId: 't1',
        name: 'POS Webhook',
        url: 'https://example.com/webhook',
        events: ['inventory.item.scanned'],
      });

      expect(wh.id).toMatch(/^wh_/);
      expect(wh.name).toBe('POS Webhook');
      expect(wh.url).toBe('https://example.com/webhook');
      expect(wh.status).toBe('active');
      expect(wh.healthScore).toBe(100);
      expect(wh.secret).toMatch(/^whsec_/);
      expect(wh.events).toContain('inventory.item.scanned');
    });

    it('should reject invalid URLs', () => {
      expect(() =>
        engine.registerWebhook({
          tenantId: 't1',
          name: 'Bad',
          url: 'not-a-url',
          events: ['custom'],
        })
      ).toThrow('Invalid webhook URL');
    });

    it('should reject duplicate URLs per tenant', () => {
      engine.registerWebhook({
        tenantId: 't1',
        name: 'First',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      expect(() =>
        engine.registerWebhook({
          tenantId: 't1',
          name: 'Second',
          url: 'https://example.com/hook',
          events: ['custom'],
        })
      ).toThrow('already exists');
    });

    it('should allow same URL for different tenants', () => {
      engine.registerWebhook({
        tenantId: 't1',
        name: 'T1',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      const wh = engine.registerWebhook({
        tenantId: 't2',
        name: 'T2',
        url: 'https://example.com/hook',
        events: ['custom'],
      });
      expect(wh).toBeDefined();
    });

    it('should enforce tenant webhook limit', () => {
      const eng = new WebhookDeliveryEngine(
        { maxWebhooksPerTenant: 2 },
        mockSender
      );

      eng.registerWebhook({ tenantId: 't1', name: 'W1', url: 'https://a.com/1', events: ['custom'] });
      eng.registerWebhook({ tenantId: 't1', name: 'W2', url: 'https://a.com/2', events: ['custom'] });

      expect(() =>
        eng.registerWebhook({ tenantId: 't1', name: 'W3', url: 'https://a.com/3', events: ['custom'] })
      ).toThrow('Maximum webhooks');
    });

    it('should accept custom secret', () => {
      const wh = engine.registerWebhook({
        tenantId: 't1',
        name: 'Custom',
        url: 'https://example.com/hook',
        events: ['custom'],
        secret: 'my-custom-secret',
      });
      expect(wh.secret).toBe('my-custom-secret');
    });

    it('should accept custom headers', () => {
      const wh = engine.registerWebhook({
        tenantId: 't1',
        name: 'Headers',
        url: 'https://example.com/hook',
        events: ['custom'],
        headers: { 'X-API-Key': 'abc123' },
      });
      expect(wh.headers['X-API-Key']).toBe('abc123');
    });

    it('should emit webhook:created event', () => {
      const handler = vi.fn();
      engine.on('webhook:created', handler);
      engine.registerWebhook({
        tenantId: 't1',
        name: 'Evt',
        url: 'https://example.com/hook',
        events: ['custom'],
      });
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  // ─── Webhook Management ────────────────────────────────────────────

  describe('Webhook Management', () => {
    let webhookId: string;

    beforeEach(() => {
      const wh = engine.registerWebhook({
        tenantId: 't1',
        name: 'Manage',
        url: 'https://example.com/hook',
        events: ['custom'],
      });
      webhookId = wh.id;
    });

    it('should get webhook by ID', () => {
      expect(engine.getWebhook(webhookId)).toBeDefined();
      expect(engine.getWebhook('fake')).toBeUndefined();
    });

    it('should get webhooks by tenant', () => {
      const results = engine.getWebhooksByTenant('t1');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(webhookId);
    });

    it('should update webhook properties', () => {
      const updated = engine.updateWebhook(webhookId, {
        name: 'Updated Name',
        headers: { 'X-New': 'value' },
      });
      expect(updated.name).toBe('Updated Name');
      expect(updated.headers['X-New']).toBe('value');
    });

    it('should reject invalid URL on update', () => {
      expect(() =>
        engine.updateWebhook(webhookId, { url: 'invalid' })
      ).toThrow('Invalid webhook URL');
    });

    it('should update events', () => {
      const updated = engine.updateWebhook(webhookId, {
        events: ['inventory.item.scanned', 'inventory.session.completed'],
      });
      expect(updated.events).toHaveLength(2);
    });

    it('should delete a webhook', () => {
      engine.deleteWebhook(webhookId);
      expect(engine.getWebhook(webhookId)).toBeUndefined();
    });

    it('should throw when deleting nonexistent webhook', () => {
      expect(() => engine.deleteWebhook('fake')).toThrow('not found');
    });

    it('should pause and resume a webhook', () => {
      engine.pauseWebhook(webhookId);
      expect(engine.getWebhook(webhookId)!.status).toBe('paused');

      engine.resumeWebhook(webhookId);
      expect(engine.getWebhook(webhookId)!.status).toBe('active');
    });

    it('should not resume a disabled webhook', () => {
      // Force disable
      const wh = engine.getWebhook(webhookId)!;
      wh.status = 'disabled';
      expect(() => engine.resumeWebhook(webhookId)).toThrow('disabled');
    });

    it('should reactivate a disabled webhook', () => {
      const wh = engine.getWebhook(webhookId)!;
      wh.status = 'disabled';
      wh.consecutiveFailures = 10;
      wh.healthScore = 5;

      engine.reactivateWebhook(webhookId);
      const updated = engine.getWebhook(webhookId)!;
      expect(updated.status).toBe('active');
      expect(updated.consecutiveFailures).toBe(0);
      expect(updated.healthScore).toBe(50);
    });

    it('should rotate webhook secret', () => {
      const oldSecret = engine.getWebhook(webhookId)!.secret;
      const newSecret = engine.rotateSecret(webhookId);
      expect(newSecret).not.toBe(oldSecret);
      expect(newSecret).toMatch(/^whsec_/);
    });
  });

  // ─── Event Dispatching ─────────────────────────────────────────────

  describe('Event Dispatching', () => {
    beforeEach(() => {
      engine.registerWebhook({
        tenantId: 't1',
        name: 'Test Hook',
        url: 'https://example.com/hook',
        events: ['inventory.item.scanned', 'inventory.session.completed'],
      });
    });

    it('should dispatch an event to matching webhooks', async () => {
      const deliveries = await engine.dispatch('t1', 'inventory.item.scanned', { sku: 'ABC123' });

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].status).toBe('delivered');
      expect(deliveries[0].event).toBe('inventory.item.scanned');
      expect(mockSender).toHaveBeenCalledOnce();
    });

    it('should not dispatch to non-subscribed events', async () => {
      const deliveries = await engine.dispatch('t1', 'billing.payment.failed', { amount: 99 });
      expect(deliveries).toHaveLength(0);
      expect(mockSender).not.toHaveBeenCalled();
    });

    it('should not dispatch to paused webhooks', async () => {
      const wh = engine.getWebhooksByTenant('t1')[0];
      engine.pauseWebhook(wh.id);

      const deliveries = await engine.dispatch('t1', 'inventory.item.scanned', {});
      expect(deliveries).toHaveLength(0);
    });

    it('should dispatch to multiple webhooks', async () => {
      engine.registerWebhook({
        tenantId: 't1',
        name: 'Second Hook',
        url: 'https://other.com/hook',
        events: ['inventory.item.scanned'],
      });

      const deliveries = await engine.dispatch('t1', 'inventory.item.scanned', {});
      expect(deliveries).toHaveLength(2);
    });

    it('should include signature in delivery', async () => {
      const deliveries = await engine.dispatch('t1', 'inventory.item.scanned', {});
      expect(deliveries[0].signature).toMatch(/^sha256=/);
    });

    it('should set delivery metadata', async () => {
      const deliveries = await engine.dispatch('t1', 'inventory.item.scanned', { sku: 'X' });
      const d = deliveries[0];
      expect(d.id).toMatch(/^dlv_/);
      expect(d.tenantId).toBe('t1');
      expect(d.attempts).toBe(1);
      expect(d.deliveredAt).toBeDefined();
      expect(d.responseStatus).toBe(200);
      expect(d.responseTimeMs).toBeDefined();
    });

    it('should track delivery in history', async () => {
      await engine.dispatch('t1', 'inventory.item.scanned', {});
      const history = engine.getDeliveryHistory({ tenantId: 't1' });
      expect(history.length).toBeGreaterThanOrEqual(1);
    });

    it('should reject oversized payloads', async () => {
      const eng = new WebhookDeliveryEngine(
        { maxPayloadSizeBytes: 100 },
        mockSender
      );
      eng.registerWebhook({
        tenantId: 't1',
        name: 'Small',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      await expect(
        eng.dispatch('t1', 'custom', { data: 'x'.repeat(200) })
      ).rejects.toThrow('exceeds maximum size');
    });

    it('should emit delivery:success event', async () => {
      const handler = vi.fn();
      engine.on('delivery:success', handler);
      await engine.dispatch('t1', 'inventory.item.scanned', {});
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  // ─── Retry & Failure ───────────────────────────────────────────────

  describe('Retry & Failure', () => {
    it('should retry on failure and eventually deliver', async () => {
      const sender = createMockSender([
        { status: 500, body: 'Server Error' },
        { status: 200, body: 'OK' },
      ]);
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 5 },
        sender
      );

      eng.registerWebhook({
        tenantId: 't1',
        name: 'Retry',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      const deliveries = await eng.dispatch('t1', 'custom', {});
      expect(deliveries[0].status).toBe('delivered');
      expect(deliveries[0].attempts).toBe(2);
      expect(sender).toHaveBeenCalledTimes(2);
    });

    it('should move to dead letter after max retries', async () => {
      const sender = createMockSender([
        { status: 500, body: 'Error' },
        { status: 500, body: 'Error' },
        { status: 500, body: 'Error' },
      ]);
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 5 },
        sender
      );

      eng.registerWebhook({
        tenantId: 't1',
        name: 'Fail',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      const dlqHandler = vi.fn();
      eng.on('delivery:dead_letter', dlqHandler);

      const deliveries = await eng.dispatch('t1', 'custom', {});
      expect(deliveries[0].status).toBe('failed');
      expect(deliveries[0].attempts).toBe(3); // 1 initial + 2 retries
      expect(dlqHandler).toHaveBeenCalledOnce();
    });

    it('should retry on network errors', async () => {
      let callCount = 0;
      const sender = vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('ECONNREFUSED');
        return { status: 200, body: 'OK', timeMs: 10 };
      });

      const eng = new WebhookDeliveryEngine(
        { maxRetries: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 5 },
        sender
      );

      eng.registerWebhook({
        tenantId: 't1',
        name: 'Net',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      const deliveries = await eng.dispatch('t1', 'custom', {});
      expect(deliveries[0].status).toBe('delivered');
    });

    it('should emit delivery:retrying event', async () => {
      const sender = createMockSender([
        { status: 500, body: 'Error' },
        { status: 200, body: 'OK' },
      ]);
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 5 },
        sender
      );

      eng.registerWebhook({
        tenantId: 't1',
        name: 'Retry Evt',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      const handler = vi.fn();
      eng.on('delivery:retrying', handler);

      await eng.dispatch('t1', 'custom', {});
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should emit delivery:failed event', async () => {
      const sender = createFailingSender();
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 0, initialRetryDelayMs: 1 },
        sender
      );

      eng.registerWebhook({
        tenantId: 't1',
        name: 'Fail',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      const handler = vi.fn();
      eng.on('delivery:failed', handler);

      await eng.dispatch('t1', 'custom', {});
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  // ─── Health Management ─────────────────────────────────────────────

  describe('Health Management', () => {
    it('should increase health on success', async () => {
      const wh = engine.registerWebhook({
        tenantId: 't1',
        name: 'Health',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      // Force low health
      const webhook = engine.getWebhook(wh.id)!;
      webhook.healthScore = 50;

      await engine.dispatch('t1', 'custom', {});
      expect(engine.getWebhook(wh.id)!.healthScore).toBe(55);
    });

    it('should decrease health on failure', async () => {
      const sender = createFailingSender();
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 0, initialRetryDelayMs: 1 },
        sender
      );

      const wh = eng.registerWebhook({
        tenantId: 't1',
        name: 'Fail Health',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      await eng.dispatch('t1', 'custom', {});
      expect(eng.getWebhook(wh.id)!.healthScore).toBe(85); // 100 - 15
    });

    it('should auto-disable after consecutive failures', async () => {
      const sender = createFailingSender();
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 0, initialRetryDelayMs: 1, autoDisableAfterFailures: 3 },
        sender
      );

      const wh = eng.registerWebhook({
        tenantId: 't1',
        name: 'AutoDisable',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      const disableHandler = vi.fn();
      eng.on('webhook:disabled', disableHandler);

      for (let i = 0; i < 3; i++) {
        await eng.dispatch('t1', 'custom', {});
      }

      expect(eng.getWebhook(wh.id)!.status).toBe('disabled');
      expect(disableHandler).toHaveBeenCalledOnce();
    });

    it('should reset consecutive failures on success', async () => {
      // Create engine with a sender that fails first, then succeeds
      const failThenSucceed = createMockSender([
        { status: 500, body: 'Error' },
        { status: 500, body: 'Error' },
        { status: 200, body: 'OK' },
      ]);
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 2, initialRetryDelayMs: 1, maxRetryDelayMs: 5, autoDisableAfterFailures: 100 },
        failThenSucceed
      );

      const wh = eng.registerWebhook({
        tenantId: 't1',
        name: 'Reset',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      // First dispatch: fails twice then succeeds on 3rd attempt
      await eng.dispatch('t1', 'custom', {});
      // After successful delivery, consecutive failures should be reset
      expect(eng.getWebhook(wh.id)!.consecutiveFailures).toBe(0);
      expect(eng.getWebhook(wh.id)!.status).toBe('active');
    });

    it('should provide health report', async () => {
      const wh = engine.registerWebhook({
        tenantId: 't1',
        name: 'Report',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      await engine.dispatch('t1', 'custom', {});

      const report = engine.getHealthReport(wh.id);
      expect(report.healthScore).toBeGreaterThan(0);
      expect(report.status).toBe('active');
      expect(report.successRate).toBe(100);
      expect(report.recommendation).toContain('healthy');
    });

    it('should emit health:degraded when score drops below threshold', async () => {
      const sender = createFailingSender();
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 0, initialRetryDelayMs: 1, healthScoreThreshold: 80, autoDisableAfterFailures: 100 },
        sender
      );

      const wh = eng.registerWebhook({
        tenantId: 't1',
        name: 'Degrade',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      const handler = vi.fn();
      eng.on('health:degraded', handler);

      // 2 failures: 100 - 15 - 15 = 70 < 80
      await eng.dispatch('t1', 'custom', {});
      await eng.dispatch('t1', 'custom', {});

      expect(handler).toHaveBeenCalled();
    });
  });

  // ─── Signature Verification ────────────────────────────────────────

  describe('Signature Verification', () => {
    it('should sign and verify payloads', () => {
      const payload = '{"test": true}';
      const secret = 'test-secret';
      const signature = engine.signPayload(payload, secret);

      expect(signature).toMatch(/^sha256=/);
      expect(engine.verifySignature(payload, signature, secret)).toBe(true);
    });

    it('should reject tampered payloads', () => {
      const secret = 'test-secret';
      const signature = engine.signPayload('{"original": true}', secret);
      expect(engine.verifySignature('{"tampered": true}', signature, secret)).toBe(false);
    });

    it('should reject wrong secret', () => {
      const payload = '{"test": true}';
      const signature = engine.signPayload(payload, 'correct-secret');
      expect(engine.verifySignature(payload, signature, 'wrong-secret')).toBe(false);
    });
  });

  // ─── Dead Letter Queue ─────────────────────────────────────────────

  describe('Dead Letter Queue', () => {
    it('should populate DLQ on permanent failure', async () => {
      const sender = createFailingSender();
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 0, initialRetryDelayMs: 1 },
        sender
      );

      eng.registerWebhook({
        tenantId: 't1',
        name: 'DLQ',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      await eng.dispatch('t1', 'custom', { data: 'test' });

      const dlq = eng.getDeadLetterQueue();
      expect(dlq).toHaveLength(1);
      expect(dlq[0].reason).toContain('Connection refused');
      expect(dlq[0].canReplay).toBe(true);
    });

    it('should filter DLQ by webhook', async () => {
      const sender = createFailingSender();
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 0, initialRetryDelayMs: 1 },
        sender
      );

      const wh1 = eng.registerWebhook({
        tenantId: 't1',
        name: 'DLQ1',
        url: 'https://a.com/hook',
        events: ['custom'],
      });
      eng.registerWebhook({
        tenantId: 't1',
        name: 'DLQ2',
        url: 'https://b.com/hook',
        events: ['custom'],
      });

      await eng.dispatch('t1', 'custom', {});

      const filtered = eng.getDeadLetterQueue({ webhookId: wh1.id });
      expect(filtered).toHaveLength(1);
    });

    it('should clear DLQ', async () => {
      const sender = createFailingSender();
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 0, initialRetryDelayMs: 1 },
        sender
      );

      eng.registerWebhook({
        tenantId: 't1',
        name: 'Clear',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      await eng.dispatch('t1', 'custom', {});
      const cleared = eng.clearDeadLetterQueue();
      expect(cleared).toBe(1);
      expect(eng.getDeadLetterQueue()).toHaveLength(0);
    });

    it('should trim DLQ when exceeding max', async () => {
      const sender = createFailingSender();
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 0, initialRetryDelayMs: 1, maxDeadLetterEntries: 3 },
        sender
      );

      eng.registerWebhook({
        tenantId: 't1',
        name: 'Trim',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      for (let i = 0; i < 5; i++) {
        await eng.dispatch('t1', 'custom', { i });
      }

      const dlq = eng.getDeadLetterQueue();
      expect(dlq.length).toBeLessThanOrEqual(3);
    });
  });

  // ─── Batch Dispatch ────────────────────────────────────────────────

  describe('Batch Dispatch', () => {
    it('should dispatch multiple events in batch', async () => {
      engine.registerWebhook({
        tenantId: 't1',
        name: 'Batch',
        url: 'https://example.com/hook',
        events: ['inventory.item.scanned', 'inventory.session.completed'],
      });

      const deliveries = await engine.dispatchBatch('t1', [
        { event: 'inventory.item.scanned', payload: { sku: 'A' } },
        { event: 'inventory.item.scanned', payload: { sku: 'B' } },
        { event: 'inventory.session.completed', payload: { total: 100 } },
      ]);

      expect(deliveries).toHaveLength(3);
      expect(deliveries.every(d => d.status === 'delivered')).toBe(true);
    });
  });

  // ─── Rate Limiting ─────────────────────────────────────────────────

  describe('Rate Limiting', () => {
    it('should skip webhook when rate limited', async () => {
      const eng = new WebhookDeliveryEngine(
        { rateLimitPerMinute: 2, maxRetries: 0, initialRetryDelayMs: 1 },
        mockSender
      );

      eng.registerWebhook({
        tenantId: 't1',
        name: 'RateLimited',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      const handler = vi.fn();
      eng.on('rate_limit:hit', handler);

      await eng.dispatch('t1', 'custom', {}); // 1
      await eng.dispatch('t1', 'custom', {}); // 2
      const third = await eng.dispatch('t1', 'custom', {}); // rate limited

      expect(third).toHaveLength(0);
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  // ─── Delivery History ──────────────────────────────────────────────

  describe('Delivery History', () => {
    beforeEach(() => {
      engine.registerWebhook({
        tenantId: 't1',
        name: 'History',
        url: 'https://example.com/hook',
        events: ['inventory.item.scanned', 'custom'],
      });
    });

    it('should track delivery history', async () => {
      await engine.dispatch('t1', 'inventory.item.scanned', {});
      await engine.dispatch('t1', 'custom', {});

      const history = engine.getDeliveryHistory();
      expect(history).toHaveLength(2);
    });

    it('should filter by event type', async () => {
      await engine.dispatch('t1', 'inventory.item.scanned', {});
      await engine.dispatch('t1', 'custom', {});

      const filtered = engine.getDeliveryHistory({ event: 'custom' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].event).toBe('custom');
    });

    it('should filter by status', async () => {
      await engine.dispatch('t1', 'custom', {});

      const delivered = engine.getDeliveryHistory({ status: 'delivered' });
      expect(delivered.length).toBeGreaterThanOrEqual(1);
    });

    it('should limit results', async () => {
      for (let i = 0; i < 5; i++) {
        await engine.dispatch('t1', 'custom', {});
      }

      const limited = engine.getDeliveryHistory({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('should trim delivery history when over max', async () => {
      const eng = new WebhookDeliveryEngine(
        { maxDeliveryHistory: 5, maxRetries: 0, initialRetryDelayMs: 1 },
        mockSender
      );

      eng.registerWebhook({
        tenantId: 't1',
        name: 'Trim',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      for (let i = 0; i < 10; i++) {
        await eng.dispatch('t1', 'custom', {});
      }

      const history = eng.getDeliveryHistory();
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });

  // ─── Stats ─────────────────────────────────────────────────────────

  describe('Stats', () => {
    it('should provide platform stats', async () => {
      engine.registerWebhook({
        tenantId: 't1',
        name: 'Stats',
        url: 'https://example.com/hook',
        events: ['custom', 'inventory.item.scanned'],
      });

      await engine.dispatch('t1', 'custom', {});
      await engine.dispatch('t1', 'inventory.item.scanned', {});

      const stats = engine.getStats();
      expect(stats.totalWebhooks).toBe(1);
      expect(stats.activeWebhooks).toBe(1);
      expect(stats.totalDeliveries).toBe(2);
      expect(stats.successfulDeliveries).toBe(2);
      expect(stats.overallSuccessRate).toBe(100);
      expect(stats.topEvents).toHaveLength(2);
    });

    it('should filter stats by tenant', async () => {
      engine.registerWebhook({
        tenantId: 't1',
        name: 'T1',
        url: 'https://a.com/hook',
        events: ['custom'],
      });
      engine.registerWebhook({
        tenantId: 't2',
        name: 'T2',
        url: 'https://b.com/hook',
        events: ['custom'],
      });

      await engine.dispatch('t1', 'custom', {});
      await engine.dispatch('t2', 'custom', {});

      const t1Stats = engine.getStats('t1');
      expect(t1Stats.totalWebhooks).toBe(1);
      expect(t1Stats.totalDeliveries).toBe(1);
    });
  });

  // ─── Voice Summary ────────────────────────────────────────────────

  describe('Voice Summary', () => {
    it('should generate voice summary', async () => {
      engine.registerWebhook({
        tenantId: 't1',
        name: 'Voice',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      await engine.dispatch('t1', 'custom', {});

      const summary = engine.getVoiceSummary('t1');
      expect(summary).toContain('1 webhooks configured');
      expect(summary).toContain('1 active');
      expect(summary).toContain('100% success rate');
    });

    it('should mention failing webhooks in summary', async () => {
      const sender = createFailingSender();
      const eng = new WebhookDeliveryEngine(
        { maxRetries: 0, initialRetryDelayMs: 1, healthScoreThreshold: 90, autoDisableAfterFailures: 100 },
        sender
      );

      eng.registerWebhook({
        tenantId: 't1',
        name: 'Failing',
        url: 'https://example.com/hook',
        events: ['custom'],
      });

      await eng.dispatch('t1', 'custom', {});

      const summary = eng.getVoiceSummary('t1');
      expect(summary).toContain('failing');
    });
  });
});
