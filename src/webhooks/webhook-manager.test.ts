/**
 * Webhook Manager Tests
 * 🌙 Night Shift Agent — Shift #34
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WebhookManager,
  WebhookEventType,
} from './webhook-manager';

// Mock HTTP sender for testing
function createMockSender(statusCode: number = 200, body: string = 'OK') {
  return vi.fn().mockResolvedValue({ statusCode, body });
}

function createFailingSender(error: string = 'Connection refused') {
  return vi.fn().mockRejectedValue(new Error(error));
}

describe('WebhookManager', () => {
  let manager: WebhookManager;
  let mockSender: ReturnType<typeof createMockSender>;

  beforeEach(() => {
    mockSender = createMockSender();
    manager = new WebhookManager({ httpSender: mockSender });
  });

  // ─── Endpoint Registration ─────────────────────────────────────────────────

  describe('registerEndpoint()', () => {
    it('should register a new endpoint', () => {
      const ep = manager.registerEndpoint(
        'https://example.com/webhook',
        'Test Hook',
        ['inventory.item_counted']
      );
      expect(ep.id).toBeTruthy();
      expect(ep.url).toBe('https://example.com/webhook');
      expect(ep.name).toBe('Test Hook');
      expect(ep.status).toBe('active');
    });

    it('should generate a secret if not provided', () => {
      const ep = manager.registerEndpoint(
        'https://example.com/webhook',
        'Test',
        ['session.started']
      );
      expect(ep.secret).toBeTruthy();
      expect(ep.secret.length).toBeGreaterThan(16);
    });

    it('should use provided secret', () => {
      const ep = manager.registerEndpoint(
        'https://example.com/webhook',
        'Test',
        ['session.started'],
        { secret: 'my-secret' }
      );
      expect(ep.secret).toBe('my-secret');
    });

    it('should reject invalid URLs', () => {
      expect(() => manager.registerEndpoint(
        'not-a-url',
        'Test',
        ['session.started']
      )).toThrow('Invalid URL');
    });

    it('should reject empty events', () => {
      expect(() => manager.registerEndpoint(
        'https://example.com/webhook',
        'Test',
        []
      )).toThrow('At least one event');
    });

    it('should emit endpoint:registered event', () => {
      const listener = vi.fn();
      manager.on('endpoint:registered', listener);
      manager.registerEndpoint('https://example.com/webhook', 'Test', ['session.started']);
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should set default config values', () => {
      const ep = manager.registerEndpoint(
        'https://example.com/webhook',
        'Test',
        ['session.started']
      );
      expect(ep.maxRetries).toBe(3);
      expect(ep.timeout).toBe(10000);
      expect(ep.rateLimit).toBe(60);
    });

    it('should accept custom config values', () => {
      const ep = manager.registerEndpoint(
        'https://example.com/webhook',
        'Test',
        ['session.started'],
        { maxRetries: 5, timeout: 30000, rateLimit: 100 }
      );
      expect(ep.maxRetries).toBe(5);
      expect(ep.timeout).toBe(30000);
      expect(ep.rateLimit).toBe(100);
    });
  });

  // ─── Endpoint Management ───────────────────────────────────────────────────

  describe('endpoint management', () => {
    it('should get endpoint by ID', () => {
      const ep = manager.registerEndpoint('https://example.com', 'Test', ['session.started']);
      expect(manager.getEndpoint(ep.id)).not.toBeNull();
    });

    it('should return null for unknown endpoint', () => {
      expect(manager.getEndpoint('nonexistent')).toBeNull();
    });

    it('should list all endpoints', () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      manager.registerEndpoint('https://b.com', 'B', ['session.ended']);
      expect(manager.listEndpoints()).toHaveLength(2);
    });

    it('should filter by status', () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      const ep = manager.registerEndpoint('https://b.com', 'B', ['session.ended']);
      manager.pauseEndpoint(ep.id);
      expect(manager.listEndpoints('active')).toHaveLength(1);
      expect(manager.listEndpoints('paused')).toHaveLength(1);
    });

    it('should update endpoint', () => {
      const ep = manager.registerEndpoint('https://example.com', 'Test', ['session.started']);
      manager.updateEndpoint(ep.id, { name: 'Updated' });
      expect(manager.getEndpoint(ep.id)?.name).toBe('Updated');
    });

    it('should validate URL on update', () => {
      const ep = manager.registerEndpoint('https://example.com', 'Test', ['session.started']);
      expect(() => manager.updateEndpoint(ep.id, { url: 'bad-url' })).toThrow('Invalid URL');
    });

    it('should remove endpoint', () => {
      const ep = manager.registerEndpoint('https://example.com', 'Test', ['session.started']);
      manager.removeEndpoint(ep.id);
      expect(manager.getEndpoint(ep.id)).toBeNull();
    });

    it('should throw when removing unknown endpoint', () => {
      expect(() => manager.removeEndpoint('nonexistent')).toThrow('not found');
    });

    it('should pause and activate endpoint', () => {
      const ep = manager.registerEndpoint('https://example.com', 'Test', ['session.started']);
      manager.pauseEndpoint(ep.id);
      expect(manager.getEndpoint(ep.id)?.status).toBe('paused');
      manager.activateEndpoint(ep.id);
      expect(manager.getEndpoint(ep.id)?.status).toBe('active');
    });
  });

  // ─── Event Dispatch ────────────────────────────────────────────────────────

  describe('dispatch()', () => {
    it('should dispatch to matching endpoints', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      manager.registerEndpoint('https://b.com', 'B', ['session.ended']);
      
      const records = await manager.dispatch('session.started', { test: true });
      expect(records).toHaveLength(1);
      expect(mockSender).toHaveBeenCalledTimes(1);
    });

    it('should dispatch to multiple matching endpoints', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      manager.registerEndpoint('https://b.com', 'B', ['session.started']);
      
      const records = await manager.dispatch('session.started', { test: true });
      expect(records).toHaveLength(2);
    });

    it('should not dispatch to paused endpoints', async () => {
      const ep = manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      manager.pauseEndpoint(ep.id);
      
      const records = await manager.dispatch('session.started', { test: true });
      expect(records).toHaveLength(0);
    });

    it('should not dispatch to non-matching events', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.ended']);
      
      const records = await manager.dispatch('session.started', { test: true });
      expect(records).toHaveLength(0);
    });

    it('should include session and store IDs', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['inventory.item_counted']);
      
      await manager.dispatch('inventory.item_counted', { sku: 'A1' }, {
        sessionId: 'sess-1',
        storeId: 'store-1',
      });

      const call = mockSender.mock.calls[0];
      const payload = JSON.parse(call[0 + 1]); // body is second arg
      expect(payload.sessionId).toBe('sess-1');
      expect(payload.storeId).toBe('store-1');
    });

    it('should emit delivery:success on success', async () => {
      const listener = vi.fn();
      manager.on('delivery:success', listener);
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      
      await manager.dispatch('session.started', {});
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should mark delivery as delivered on success', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      
      const records = await manager.dispatch('session.started', {});
      expect(records[0].status).toBe('delivered');
    });
  });

  // ─── Delivery Failure & Retry ──────────────────────────────────────────────

  describe('failure handling', () => {
    it('should retry on failure', async () => {
      const failSender = createMockSender(500, 'Server Error');
      const mgr = new WebhookManager({ httpSender: failSender, baseRetryDelay: 1 });
      mgr.registerEndpoint('https://a.com', 'A', ['session.started'], { maxRetries: 2 });
      
      const records = await mgr.dispatch('session.started', {});
      expect(records[0].status).toBe('failed');
      expect(records[0].attempts).toHaveLength(3); // 1 initial + 2 retries
    });

    it('should mark delivery as failed after max retries', async () => {
      const failSender = createMockSender(500);
      const mgr = new WebhookManager({ httpSender: failSender, baseRetryDelay: 1 });
      mgr.registerEndpoint('https://a.com', 'A', ['session.started'], { maxRetries: 1 });
      
      const records = await mgr.dispatch('session.started', {});
      expect(records[0].status).toBe('failed');
    });

    it('should emit delivery:failed on failure', async () => {
      const listener = vi.fn();
      const failSender = createMockSender(500);
      const mgr = new WebhookManager({ httpSender: failSender, baseRetryDelay: 1 });
      mgr.on('delivery:failed', listener);
      mgr.registerEndpoint('https://a.com', 'A', ['session.started'], { maxRetries: 0 });
      
      await mgr.dispatch('session.started', {});
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should handle connection errors', async () => {
      const errSender = createFailingSender('ECONNREFUSED');
      const mgr = new WebhookManager({ httpSender: errSender, baseRetryDelay: 1 });
      mgr.registerEndpoint('https://a.com', 'A', ['session.started'], { maxRetries: 0 });
      
      const records = await mgr.dispatch('session.started', {});
      expect(records[0].status).toBe('failed');
      expect(records[0].attempts[0].error).toContain('ECONNREFUSED');
    });

    it('should auto-pause after consecutive failures', async () => {
      const failSender = createMockSender(500);
      const mgr = new WebhookManager({
        httpSender: failSender,
        baseRetryDelay: 1,
        maxConsecutiveFailures: 3,
      });
      const ep = mgr.registerEndpoint('https://a.com', 'A', ['session.started'], { maxRetries: 0 });
      
      await mgr.dispatch('session.started', {});
      await mgr.dispatch('session.started', {});
      await mgr.dispatch('session.started', {});
      
      expect(mgr.getEndpoint(ep.id)?.status).toBe('failing');
    });

    it('should reset consecutive failures on success', async () => {
      // First send fails, second succeeds
      let callCount = 0;
      const mixedSender = vi.fn().mockImplementation(async () => {
        callCount++;
        return { statusCode: callCount <= 2 ? 500 : 200, body: '' };
      });
      const mgr = new WebhookManager({
        httpSender: mixedSender,
        baseRetryDelay: 1,
        maxConsecutiveFailures: 5,
      });
      const ep = mgr.registerEndpoint('https://a.com', 'A', ['session.started'], { maxRetries: 0 });
      
      await mgr.dispatch('session.started', {});
      await mgr.dispatch('session.started', {});
      
      const health = mgr.getEndpointHealth(ep.id);
      expect(health?.consecutiveFailures).toBe(2);
      
      await mgr.dispatch('session.started', {});
      const healthAfter = mgr.getEndpointHealth(ep.id);
      expect(healthAfter?.consecutiveFailures).toBe(0);
    });
  });

  // ─── Signature ─────────────────────────────────────────────────────────────

  describe('signature', () => {
    it('should sign payloads with HMAC-SHA256', () => {
      const sig = manager.sign('{"test": true}', 'my-secret');
      expect(sig).toBeTruthy();
      expect(sig.length).toBe(64); // SHA-256 hex
    });

    it('should verify valid signatures', () => {
      const payload = '{"test": true}';
      const secret = 'my-secret';
      const sig = manager.sign(payload, secret);
      expect(manager.verifySignature(payload, sig, secret)).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const payload = '{"test": true}';
      expect(manager.verifySignature(payload, 'invalid', 'my-secret')).toBe(false);
    });

    it('should reject tampered payloads', () => {
      const secret = 'my-secret';
      const sig = manager.sign('{"test": true}', secret);
      expect(manager.verifySignature('{"test": false}', sig, secret)).toBe(false);
    });

    it('should include signature in delivery headers', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started'], {
        secret: 'test-secret',
      });
      
      await manager.dispatch('session.started', { hello: 'world' });
      
      const headers = mockSender.mock.calls[0][2];
      expect(headers['X-Webhook-Signature']).toBeTruthy();
      expect(headers['X-Webhook-Event']).toBe('session.started');
    });
  });

  // ─── Rate Limiting ─────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('should enforce rate limits', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started'], {
        rateLimit: 3,
      });
      
      // Fire 5 events rapidly
      for (let i = 0; i < 5; i++) {
        await manager.dispatch('session.started', { i });
      }
      
      // Only 3 should have been delivered
      expect(mockSender).toHaveBeenCalledTimes(3);
    });

    it('should emit rate_limited event', async () => {
      const listener = vi.fn();
      manager.on('delivery:rate_limited', listener);
      manager.registerEndpoint('https://a.com', 'A', ['session.started'], {
        rateLimit: 1,
      });
      
      await manager.dispatch('session.started', {});
      await manager.dispatch('session.started', {});
      
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ─── Health Tracking ───────────────────────────────────────────────────────

  describe('health tracking', () => {
    it('should track delivery stats', async () => {
      const ep = manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      
      await manager.dispatch('session.started', {});
      await manager.dispatch('session.started', {});
      
      const health = manager.getEndpointHealth(ep.id);
      expect(health?.totalDeliveries).toBe(2);
      expect(health?.successfulDeliveries).toBe(2);
      expect(health?.successRate).toBe(100);
    });

    it('should track failed deliveries', async () => {
      const failSender = createMockSender(500);
      const mgr = new WebhookManager({ httpSender: failSender, baseRetryDelay: 1 });
      const ep = mgr.registerEndpoint('https://a.com', 'A', ['session.started'], { maxRetries: 0 });
      
      await mgr.dispatch('session.started', {});
      
      const health = mgr.getEndpointHealth(ep.id);
      expect(health?.failedDeliveries).toBe(1);
      expect(health?.successRate).toBe(0);
    });

    it('should return null for unknown endpoint', () => {
      expect(manager.getEndpointHealth('nonexistent')).toBeNull();
    });

    it('should get all endpoint health', () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      manager.registerEndpoint('https://b.com', 'B', ['session.ended']);
      
      const health = manager.getAllHealth();
      expect(health).toHaveLength(2);
    });

    it('should track average response time', async () => {
      const slowSender = vi.fn().mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 10));
        return { statusCode: 200, body: 'OK' };
      });
      const mgr = new WebhookManager({ httpSender: slowSender });
      const ep = mgr.registerEndpoint('https://a.com', 'A', ['session.started']);
      
      await mgr.dispatch('session.started', {});
      
      const health = mgr.getEndpointHealth(ep.id);
      expect(health?.avgResponseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Delivery History ──────────────────────────────────────────────────────

  describe('delivery history', () => {
    it('should store delivery records', async () => {
      const ep = manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      await manager.dispatch('session.started', {});
      
      const deliveries = manager.getDeliveries(ep.id);
      expect(deliveries).toHaveLength(1);
    });

    it('should filter by status', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      await manager.dispatch('session.started', {});
      
      expect(manager.getDeliveries(undefined, { status: 'delivered' })).toHaveLength(1);
      expect(manager.getDeliveries(undefined, { status: 'failed' })).toHaveLength(0);
    });

    it('should filter by event type', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started', 'session.ended']);
      await manager.dispatch('session.started', {});
      await manager.dispatch('session.ended', {});
      
      expect(manager.getDeliveries(undefined, { event: 'session.started' })).toHaveLength(1);
    });

    it('should limit results', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      for (let i = 0; i < 10; i++) {
        await manager.dispatch('session.started', { i });
      }
      
      expect(manager.getDeliveries(undefined, { limit: 5 })).toHaveLength(5);
    });

    it('should get specific delivery', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      const records = await manager.dispatch('session.started', {});
      
      const delivery = manager.getDelivery(records[0].id);
      expect(delivery).not.toBeNull();
      expect(delivery?.status).toBe('delivered');
    });

    it('should clear delivery history', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      await manager.dispatch('session.started', {});
      
      manager.clearDeliveries();
      expect(manager.getDeliveries()).toHaveLength(0);
    });

    it('should enforce max delivery history', async () => {
      const mgr = new WebhookManager({ httpSender: mockSender, maxDeliveryHistory: 5 });
      mgr.registerEndpoint('https://a.com', 'A', ['session.started']);
      
      for (let i = 0; i < 10; i++) {
        await mgr.dispatch('session.started', { i });
      }
      
      expect(mgr.getDeliveries().length).toBeLessThanOrEqual(5);
    });
  });

  // ─── Voice Summary ─────────────────────────────────────────────────────────

  describe('voice summary', () => {
    it('should summarize with no endpoints', () => {
      const summary = manager.generateVoiceSummary();
      expect(summary).toContain('No webhook');
    });

    it('should summarize active endpoints', () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      manager.registerEndpoint('https://b.com', 'B', ['session.ended']);
      
      const summary = manager.generateVoiceSummary();
      expect(summary).toContain('2 webhook endpoints');
      expect(summary).toContain('2 active');
    });

    it('should mention failing endpoints', async () => {
      const failSender = createMockSender(500);
      const mgr = new WebhookManager({
        httpSender: failSender,
        baseRetryDelay: 1,
        maxConsecutiveFailures: 1,
      });
      mgr.registerEndpoint('https://a.com', 'A', ['session.started'], { maxRetries: 0 });
      await mgr.dispatch('session.started', {});
      
      const summary = mgr.generateVoiceSummary();
      expect(summary).toContain('failing');
    });

    it('should include recent delivery stats', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      await manager.dispatch('session.started', {});
      
      const summary = manager.generateVoiceSummary();
      expect(summary).toContain('1 deliveries');
      expect(summary).toContain('1 successful');
    });
  });

  // ─── Custom Headers ────────────────────────────────────────────────────────

  describe('custom headers', () => {
    it('should include custom headers in delivery', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started'], {
        headers: { 'X-Custom': 'test-value' },
      });
      
      await manager.dispatch('session.started', {});
      
      const headers = mockSender.mock.calls[0][2];
      expect(headers['X-Custom']).toBe('test-value');
    });

    it('should always include standard headers', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      
      await manager.dispatch('session.started', {});
      
      const headers = mockSender.mock.calls[0][2];
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Webhook-Signature']).toBeTruthy();
      expect(headers['X-Webhook-Event']).toBe('session.started');
      expect(headers['User-Agent']).toContain('InventoryVision');
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle multiple event types on one endpoint', async () => {
      manager.registerEndpoint('https://a.com', 'A', [
        'session.started',
        'session.ended',
        'inventory.item_counted',
      ]);
      
      await manager.dispatch('session.started', {});
      await manager.dispatch('session.ended', {});
      await manager.dispatch('inventory.item_counted', { sku: 'A1' });
      
      expect(mockSender).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent dispatches', async () => {
      manager.registerEndpoint('https://a.com', 'A', ['session.started']);
      
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(manager.dispatch('session.started', { i }));
      }
      
      const results = await Promise.all(promises);
      expect(results.flat()).toHaveLength(5);
    });

    it('should not crash when no matching endpoints', async () => {
      const records = await manager.dispatch('session.started', {});
      expect(records).toHaveLength(0);
    });

    it('should handle endpoint with zero retries', async () => {
      const failSender = createMockSender(500);
      const mgr = new WebhookManager({ httpSender: failSender });
      mgr.registerEndpoint('https://a.com', 'A', ['session.started'], { maxRetries: 0 });
      
      const records = await mgr.dispatch('session.started', {});
      expect(records[0].attempts).toHaveLength(1);
      expect(records[0].status).toBe('failed');
    });

    it('should reset consecutive failures on manual activation', async () => {
      const failSender = createMockSender(500);
      const mgr = new WebhookManager({
        httpSender: failSender,
        baseRetryDelay: 1,
        maxConsecutiveFailures: 2,
      });
      const ep = mgr.registerEndpoint('https://a.com', 'A', ['session.started'], { maxRetries: 0 });
      
      await mgr.dispatch('session.started', {});
      await mgr.dispatch('session.started', {});
      
      expect(mgr.getEndpoint(ep.id)?.status).toBe('failing');
      
      mgr.activateEndpoint(ep.id);
      expect(mgr.getEndpoint(ep.id)?.status).toBe('active');
      expect(mgr.getEndpointHealth(ep.id)?.consecutiveFailures).toBe(0);
    });
  });
});
