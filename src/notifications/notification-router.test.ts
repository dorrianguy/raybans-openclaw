/**
 * Tests for Notification Router
 * 🌙 Night Shift Agent — 2026-03-09
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotificationRouter,
  NotificationPayload,
  NotificationRecord,
  ChannelAdapter,
  DeliveryChannel,
  DeliveryRecord,
} from './notification-router.js';

function createRouter(config = {}): NotificationRouter {
  return new NotificationRouter(config);
}

function mockAdapter(channel: DeliveryChannel, shouldFail = false): ChannelAdapter {
  return {
    channel,
    send: async (notification: NotificationRecord, delivery: DeliveryRecord) => {
      if (shouldFail) throw new Error(`${channel} delivery failed`);
      return { messageId: `msg_${channel}_${notification.id.slice(0, 8)}` };
    },
  };
}

function basicPayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    userId: 'user-1',
    title: 'Test Notification',
    body: 'This is a test notification body.',
    priority: 'normal',
    category: 'inventory',
    ...overrides,
  };
}

describe('NotificationRouter', () => {
  let router: NotificationRouter;

  beforeEach(() => {
    router = createRouter();
    router.registerChannel(mockAdapter('email'));
    router.registerChannel(mockAdapter('push'));
    router.registerChannel(mockAdapter('in_app'));
    router.registerChannel(mockAdapter('voice'));
    router.registerChannel(mockAdapter('sms'));
  });

  // ─── Channel Registration ────────────────────────────────────────

  describe('Channel Registration', () => {
    it('registers a channel adapter', () => {
      const r = createRouter();
      r.registerChannel(mockAdapter('email'));
      expect(r.getRegisteredChannels()).toContain('email');
    });

    it('lists all registered channels', () => {
      expect(router.getRegisteredChannels().length).toBe(5);
    });

    it('emits channel:registered event', () => {
      const r = createRouter();
      const fn = vi.fn();
      r.on('channel:registered', fn);
      r.registerChannel(mockAdapter('push'));
      expect(fn).toHaveBeenCalledWith('push');
    });
  });

  // ─── Sending Notifications ───────────────────────────────────────

  describe('Sending Notifications', () => {
    it('creates and sends a notification', async () => {
      const record = await router.send(basicPayload());
      expect(record.id).toBeTruthy();
      expect(record.title).toBe('Test Notification');
      expect(record.body).toBe('This is a test notification body.');
      expect(record.category).toBe('inventory');
      expect(record.priority).toBe('normal');
      expect(record.deliveries.length).toBeGreaterThan(0);
    });

    it('delivers to default channels for priority', async () => {
      const record = await router.send(basicPayload({ priority: 'critical' }));
      const channels = record.deliveries.map(d => d.channel);
      // Critical sends to all channels
      expect(channels).toContain('push');
      expect(channels).toContain('email');
      expect(channels).toContain('in_app');
    });

    it('normal priority sends to push + in_app', async () => {
      const record = await router.send(basicPayload({ priority: 'normal' }));
      const channels = record.deliveries.map(d => d.channel);
      expect(channels).toContain('push');
      expect(channels).toContain('in_app');
    });

    it('low priority sends to in_app only', async () => {
      const record = await router.send(basicPayload({ priority: 'low' }));
      const channels = record.deliveries.map(d => d.channel);
      expect(channels).toEqual(['in_app']);
    });

    it('channel override bypasses defaults', async () => {
      const record = await router.send(basicPayload({
        priority: 'low',
        channelOverride: ['email', 'sms'],
      }));
      const channels = record.deliveries.map(d => d.channel);
      expect(channels).toEqual(['email', 'sms']);
    });

    it('sets delivery status to sent on success', async () => {
      const record = await router.send(basicPayload());
      const sentDeliveries = record.deliveries.filter(d => d.status === 'sent');
      expect(sentDeliveries.length).toBeGreaterThan(0);
    });

    it('includes provider message ID on success', async () => {
      const record = await router.send(basicPayload({ channelOverride: ['email'] }));
      const emailDelivery = record.deliveries.find(d => d.channel === 'email');
      expect(emailDelivery?.providerMessageId).toBeTruthy();
    });

    it('handles delivery failure', async () => {
      const r = createRouter({ maxRetryAttempts: 1 });
      r.registerChannel(mockAdapter('email', true));
      r.registerChannel(mockAdapter('in_app'));

      const record = await r.send(basicPayload({ channelOverride: ['email'] }));
      const emailDelivery = record.deliveries.find(d => d.channel === 'email');
      expect(emailDelivery?.status).toBe('failed');
      expect(emailDelivery?.error).toContain('email delivery failed');
    });

    it('emits notification:created event', async () => {
      const fn = vi.fn();
      router.on('notification:created', fn);
      await router.send(basicPayload());
      expect(fn).toHaveBeenCalled();
    });

    it('emits notification:sent event', async () => {
      const fn = vi.fn();
      router.on('notification:sent', fn);
      await router.send(basicPayload());
      expect(fn).toHaveBeenCalled();
    });

    it('emits notification:failed event', async () => {
      const r = createRouter({ maxRetryAttempts: 1 });
      r.registerChannel(mockAdapter('email', true));
      const fn = vi.fn();
      r.on('notification:failed', fn);
      await r.send(basicPayload({ channelOverride: ['email'] }));
      expect(fn).toHaveBeenCalled();
    });

    it('sets expiry time based on expiryMinutes', async () => {
      const record = await router.send(basicPayload({ expiryMinutes: 30 }));
      expect(record.expiresAt).toBeTruthy();
      const expiresAt = new Date(record.expiresAt!).getTime();
      const createdAt = new Date(record.createdAt).getTime();
      expect(expiresAt - createdAt).toBeGreaterThanOrEqual(30 * 60_000 - 100);
    });

    it('stores notification data and actions', async () => {
      const record = await router.send(basicPayload({
        data: { sessionId: 'sess-123' },
        actionUrl: '/dashboard/inventory/sess-123',
        actions: [
          { label: 'View', actionId: 'view', url: '/view' },
          { label: 'Dismiss', actionId: 'dismiss' },
        ],
        source: 'inventory-agent',
      }));
      expect(record.data?.sessionId).toBe('sess-123');
      expect(record.actionUrl).toBe('/dashboard/inventory/sess-123');
      expect(record.actions?.length).toBe(2);
      expect(record.source).toBe('inventory-agent');
    });

    it('sends batch notifications', async () => {
      const results = await router.sendBatch([
        basicPayload({ title: 'First' }),
        basicPayload({ title: 'Second' }),
        basicPayload({ title: 'Third' }),
      ]);
      expect(results.length).toBe(3);
      expect(results[0].title).toBe('First');
      expect(results[2].title).toBe('Third');
    });

    it('includes voice summary', async () => {
      const record = await router.send(basicPayload({
        voiceSummary: 'You scanned 42 items.',
      }));
      expect(record.voiceSummary).toBe('You scanned 42 items.');
    });

    it('skips delivery for unregistered channels', async () => {
      const r = createRouter();
      // No channels registered
      const record = await r.send(basicPayload({ channelOverride: ['push'] }));
      expect(record.deliveries[0].status).toBe('skipped');
    });
  });

  // ─── User Settings ───────────────────────────────────────────────

  describe('User Settings', () => {
    it('returns default settings for unknown user', () => {
      const settings = router.getUserSettings('unknown');
      expect(settings.enabledChannels.length).toBeGreaterThan(0);
      expect(settings.digestEnabled).toBe(false);
    });

    it('stores and retrieves user settings', () => {
      router.setUserSettings({
        userId: 'user-1',
        enabledChannels: ['push', 'in_app'],
        categoryPreferences: {},
        digestEnabled: true,
      });
      const settings = router.getUserSettings('user-1');
      expect(settings.enabledChannels).toEqual(['push', 'in_app']);
      expect(settings.digestEnabled).toBe(true);
    });

    it('filters channels by user settings', async () => {
      router.setUserSettings({
        userId: 'user-1',
        enabledChannels: ['in_app'], // only in_app
        categoryPreferences: {},
        digestEnabled: false,
      });
      const record = await router.send(basicPayload({ priority: 'critical' }));
      const channels = record.deliveries.map(d => d.channel);
      expect(channels).toEqual(['in_app']);
    });

    it('disables category notifications', async () => {
      router.setUserSettings({
        userId: 'user-1',
        enabledChannels: ['email', 'push', 'in_app'],
        categoryPreferences: {
          inventory: { enabled: false },
        },
        digestEnabled: false,
      });
      const record = await router.send(basicPayload({ category: 'inventory' }));
      const channels = record.deliveries.map(d => d.channel);
      // Disabled category falls back to in_app only
      expect(channels).toEqual(['in_app']);
    });

    it('respects category-specific channels', async () => {
      router.setUserSettings({
        userId: 'user-1',
        enabledChannels: ['email', 'push', 'in_app', 'voice'],
        categoryPreferences: {
          security: { enabled: true, channels: ['push', 'voice'] },
        },
        digestEnabled: false,
      });
      const record = await router.send(basicPayload({
        category: 'security',
        priority: 'high', // default: push, email, in_app
      }));
      const channels = record.deliveries.map(d => d.channel);
      // Intersects priority channels (push, email, in_app) with category channels (push, voice)
      expect(channels).toContain('push');
      expect(channels).not.toContain('email');
    });
  });

  // ─── Digest ──────────────────────────────────────────────────────

  describe('Digest', () => {
    it('queues low-priority notifications for digest when enabled', async () => {
      router.setUserSettings({
        userId: 'user-1',
        enabledChannels: ['email', 'in_app'],
        categoryPreferences: {},
        digestEnabled: true,
      });
      await router.send(basicPayload({ priority: 'low', title: 'Low 1' }));
      await router.send(basicPayload({ priority: 'low', title: 'Low 2' }));

      const queue = router.getDigestQueue('user-1');
      expect(queue.length).toBe(2);
    });

    it('does not digest non-low priority', async () => {
      router.setUserSettings({
        userId: 'user-1',
        enabledChannels: ['email', 'in_app'],
        categoryPreferences: {},
        digestEnabled: true,
      });
      await router.send(basicPayload({ priority: 'normal' }));
      const queue = router.getDigestQueue('user-1');
      expect(queue.length).toBe(0);
    });

    it('flushes digest queue', async () => {
      router.setUserSettings({
        userId: 'user-1',
        enabledChannels: ['email', 'in_app'],
        categoryPreferences: {},
        digestEnabled: true,
      });
      await router.send(basicPayload({ priority: 'low', title: 'Low 1' }));
      await router.send(basicPayload({ priority: 'low', title: 'Low 2' }));

      const flushed = router.flushDigest('user-1');
      expect(flushed.length).toBe(2);
      expect(router.getDigestQueue('user-1').length).toBe(0);
    });

    it('emits digest:created on flush', async () => {
      router.setUserSettings({
        userId: 'user-1',
        enabledChannels: ['email', 'in_app'],
        categoryPreferences: {},
        digestEnabled: true,
      });
      await router.send(basicPayload({ priority: 'low' }));

      const fn = vi.fn();
      router.on('digest:created', fn);
      router.flushDigest('user-1');
      expect(fn).toHaveBeenCalledWith('user-1', 1);
    });

    it('does not digest with channelOverride', async () => {
      router.setUserSettings({
        userId: 'user-1',
        enabledChannels: ['email', 'in_app'],
        categoryPreferences: {},
        digestEnabled: true,
      });
      await router.send(basicPayload({ priority: 'low', channelOverride: ['push'] }));
      expect(router.getDigestQueue('user-1').length).toBe(0);
    });
  });

  // ─── Templates ───────────────────────────────────────────────────

  describe('Templates', () => {
    it('registers a notification template', () => {
      const template = router.registerTemplate({
        name: 'Inventory Complete',
        category: 'inventory',
        titleTemplate: 'Inventory Session Complete',
        bodyTemplate: 'Session "{{sessionName}}" finished. {{itemCount}} items scanned.',
        voiceTemplate: 'Your inventory session is complete. {{itemCount}} items scanned.',
        defaultPriority: 'normal',
      });
      expect(template.id).toBeTruthy();
      expect(template.name).toBe('Inventory Complete');
    });

    it('retrieves a template by ID', () => {
      const tpl = router.registerTemplate({
        name: 'Test',
        category: 'system',
        titleTemplate: 'Test',
        bodyTemplate: 'Test body',
        defaultPriority: 'low',
      });
      expect(router.getTemplate(tpl.id)?.name).toBe('Test');
    });

    it('lists templates filtered by category', () => {
      router.registerTemplate({ name: 'A', category: 'inventory', titleTemplate: 'A', bodyTemplate: 'A', defaultPriority: 'normal' });
      router.registerTemplate({ name: 'B', category: 'security', titleTemplate: 'B', bodyTemplate: 'B', defaultPriority: 'high' });
      router.registerTemplate({ name: 'C', category: 'inventory', titleTemplate: 'C', bodyTemplate: 'C', defaultPriority: 'low' });

      expect(router.listTemplates('inventory').length).toBe(2);
      expect(router.listTemplates('security').length).toBe(1);
      expect(router.listTemplates().length).toBe(3);
    });

    it('deletes a template', () => {
      const tpl = router.registerTemplate({ name: 'X', category: 'system', titleTemplate: 'X', bodyTemplate: 'X', defaultPriority: 'low' });
      expect(router.deleteTemplate(tpl.id)).toBe(true);
      expect(router.getTemplate(tpl.id)).toBeUndefined();
    });

    it('sends notification using template with variable interpolation', async () => {
      const tpl = router.registerTemplate({
        name: 'Inventory Complete',
        category: 'inventory',
        titleTemplate: 'Session {{sessionName}} Complete',
        bodyTemplate: '{{itemCount}} items scanned in {{duration}}.',
        voiceTemplate: 'Session done. {{itemCount}} items.',
        defaultPriority: 'normal',
      });

      const record = await router.send(basicPayload({
        templateId: tpl.id,
        templateVars: { sessionName: 'Store #42', itemCount: '287', duration: '45 minutes' },
      }));

      expect(record.title).toBe('Session Store #42 Complete');
      expect(record.body).toBe('287 items scanned in 45 minutes.');
      expect(record.voiceSummary).toBe('Session done. 287 items.');
    });

    it('preserves unresolved template variables', async () => {
      const tpl = router.registerTemplate({
        name: 'Test',
        category: 'system',
        titleTemplate: 'Hello {{name}}, you have {{count}} items',
        bodyTemplate: 'Details: {{missing}}',
        defaultPriority: 'normal',
      });

      const record = await router.send(basicPayload({
        templateId: tpl.id,
        templateVars: { name: 'Alice' }, // count and missing are not provided
      }));

      expect(record.title).toBe('Hello Alice, you have {{count}} items');
      expect(record.body).toBe('Details: {{missing}}');
    });
  });

  // ─── Delivery Confirmation ────────────────────────────────────────

  describe('Delivery Confirmation', () => {
    it('confirms delivery', async () => {
      const record = await router.send(basicPayload({ channelOverride: ['email'] }));
      router.confirmDelivery(record.id, 'email');
      const updated = router.getNotification(record.id)!;
      const emailDelivery = updated.deliveries.find(d => d.channel === 'email');
      expect(emailDelivery?.status).toBe('delivered');
      expect(emailDelivery?.deliveredAt).toBeTruthy();
    });

    it('emits notification:delivered event', async () => {
      const record = await router.send(basicPayload({ channelOverride: ['push'] }));
      const fn = vi.fn();
      router.on('notification:delivered', fn);
      router.confirmDelivery(record.id, 'push');
      expect(fn).toHaveBeenCalledWith(record.id, 'push');
    });
  });

  // ─── Retry ────────────────────────────────────────────────────────

  describe('Retry', () => {
    it('retries failed deliveries', async () => {
      const r = createRouter({ maxRetryAttempts: 1 });
      r.registerChannel(mockAdapter('email', true)); // will fail
      const record = await r.send(basicPayload({ channelOverride: ['email'] }));
      expect(record.deliveries[0].status).toBe('failed');

      // Now register a working adapter and retry
      r.registerChannel(mockAdapter('email', false));
      const retried = await r.retryFailed(record.id);
      expect(retried).toBe(true);
    });

    it('returns false for notification with no failed deliveries', async () => {
      const record = await router.send(basicPayload());
      const result = await router.retryFailed(record.id);
      expect(result).toBe(false);
    });

    it('returns false for unknown notification', async () => {
      const result = await router.retryFailed('nonexistent');
      expect(result).toBe(false);
    });
  });

  // ─── Read/Dismiss ────────────────────────────────────────────────

  describe('Read & Dismiss', () => {
    it('marks notification as read', async () => {
      const record = await router.send(basicPayload());
      router.markAsRead(record.id);
      expect(router.getNotification(record.id)!.readAt).toBeTruthy();
    });

    it('emits notification:read event', async () => {
      const record = await router.send(basicPayload());
      const fn = vi.fn();
      router.on('notification:read', fn);
      router.markAsRead(record.id);
      expect(fn).toHaveBeenCalledWith(record.id);
    });

    it('does not emit twice for already-read notification', async () => {
      const record = await router.send(basicPayload());
      router.markAsRead(record.id);
      const fn = vi.fn();
      router.on('notification:read', fn);
      router.markAsRead(record.id); // second call
      expect(fn).not.toHaveBeenCalled();
    });

    it('marks all as read for a user', async () => {
      await router.send(basicPayload({ title: 'A' }));
      await router.send(basicPayload({ title: 'B' }));
      await router.send(basicPayload({ title: 'C' }));
      const count = router.markAllAsRead('user-1');
      expect(count).toBe(3);
      expect(router.getUnreadCount('user-1')).toBe(0);
    });

    it('dismisses notification', async () => {
      const record = await router.send(basicPayload());
      router.dismissNotification(record.id);
      expect(router.getNotification(record.id)!.dismissedAt).toBeTruthy();
    });
  });

  // ─── Querying ────────────────────────────────────────────────────

  describe('Querying', () => {
    beforeEach(async () => {
      await router.send(basicPayload({ userId: 'user-1', title: 'Inv 1', category: 'inventory', priority: 'normal' }));
      await router.send(basicPayload({ userId: 'user-1', title: 'Sec 1', category: 'security', priority: 'high' }));
      await router.send(basicPayload({ userId: 'user-2', title: 'Inv 2', category: 'inventory', priority: 'low' }));
    });

    it('queries all notifications', () => {
      const { notifications, total } = router.queryNotifications();
      expect(total).toBe(3);
    });

    it('filters by userId', () => {
      const { notifications, total } = router.queryNotifications({ userId: 'user-1' });
      expect(total).toBe(2);
    });

    it('filters by category', () => {
      const { notifications } = router.queryNotifications({ category: 'security' });
      expect(notifications.length).toBe(1);
      expect(notifications[0].title).toBe('Sec 1');
    });

    it('filters by priority', () => {
      const { notifications } = router.queryNotifications({ priority: 'high' });
      expect(notifications.length).toBe(1);
    });

    it('filters unread only', async () => {
      const all = router.queryNotifications({ userId: 'user-1' });
      router.markAsRead(all.notifications[0].id);
      const { total } = router.queryNotifications({ userId: 'user-1', unreadOnly: true });
      expect(total).toBe(1);
    });

    it('paginates results', () => {
      const { notifications: page1 } = router.queryNotifications({ limit: 2, offset: 0 });
      expect(page1.length).toBe(2);
      const { notifications: page2 } = router.queryNotifications({ limit: 2, offset: 2 });
      expect(page2.length).toBe(1);
    });

    it('sorts newest first', () => {
      const { notifications } = router.queryNotifications();
      for (let i = 1; i < notifications.length; i++) {
        expect(notifications[i - 1].createdAt >= notifications[i].createdAt).toBe(true);
      }
    });
  });

  describe('Unread Count', () => {
    it('counts unread notifications', async () => {
      await router.send(basicPayload({ userId: 'user-1' }));
      await router.send(basicPayload({ userId: 'user-1' }));
      expect(router.getUnreadCount('user-1')).toBe(2);
    });

    it('decrements on read', async () => {
      const r1 = await router.send(basicPayload({ userId: 'user-1' }));
      await router.send(basicPayload({ userId: 'user-1' }));
      router.markAsRead(r1.id);
      expect(router.getUnreadCount('user-1')).toBe(1);
    });

    it('returns 0 for unknown user', () => {
      expect(router.getUnreadCount('nobody')).toBe(0);
    });

    it('breaks down unread by category', async () => {
      await router.send(basicPayload({ userId: 'user-1', category: 'inventory' }));
      await router.send(basicPayload({ userId: 'user-1', category: 'inventory' }));
      await router.send(basicPayload({ userId: 'user-1', category: 'security' }));
      const byCategory = router.getUnreadByCategory('user-1');
      expect(byCategory.inventory).toBe(2);
      expect(byCategory.security).toBe(1);
    });
  });

  // ─── Rate Limiting ───────────────────────────────────────────────

  describe('Rate Limiting', () => {
    it('rate limits per user per hour', async () => {
      const r = createRouter({ maxPerUserPerHour: 3 });
      r.registerChannel(mockAdapter('in_app'));

      for (let i = 0; i < 3; i++) {
        await r.send(basicPayload());
      }
      // 4th should be rate limited
      const fn = vi.fn();
      r.on('notification:rate_limited', fn);
      const record = await r.send(basicPayload());
      expect(fn).toHaveBeenCalledWith('user-1');
      expect(record.deliveries[0].status).toBe('skipped');
    });

    it('rate limits per user per day', async () => {
      const r = createRouter({ maxPerUserPerHour: 100, maxPerUserPerDay: 3 });
      r.registerChannel(mockAdapter('in_app'));

      for (let i = 0; i < 3; i++) {
        await r.send(basicPayload());
      }
      const fn = vi.fn();
      r.on('notification:rate_limited', fn);
      await r.send(basicPayload());
      expect(fn).toHaveBeenCalled();
    });
  });

  // ─── Statistics ──────────────────────────────────────────────────

  describe('Statistics', () => {
    it('returns correct stats', async () => {
      await router.send(basicPayload({ category: 'inventory', priority: 'normal' }));
      await router.send(basicPayload({ category: 'security', priority: 'high' }));
      await router.send(basicPayload({ category: 'inventory', priority: 'low' }));

      const stats = router.getStats();
      expect(stats.totalNotifications).toBe(3);
      expect(stats.byCategory.inventory).toBe(2);
      expect(stats.byCategory.security).toBe(1);
      expect(stats.byPriority.normal).toBe(1);
      expect(stats.byPriority.high).toBe(1);
      expect(stats.byPriority.low).toBe(1);
      expect(stats.unreadTotal).toBe(3);
    });

    it('tracks delivery success rate', async () => {
      await router.send(basicPayload({ channelOverride: ['email'] }));
      const stats = router.getStats();
      expect(stats.deliverySuccessRate).toBe(1);
    });

    it('tracks failed deliveries in stats', async () => {
      const r = createRouter({ maxRetryAttempts: 1 });
      r.registerChannel(mockAdapter('email', true));
      await r.send(basicPayload({ channelOverride: ['email'] }));

      const stats = r.getStats();
      expect(stats.byChannel.email.failed).toBe(1);
    });
  });

  // ─── Voice Summary ──────────────────────────────────────────────

  describe('Voice Summary', () => {
    it('reports no notifications', () => {
      expect(router.getVoiceSummary('user-1')).toBe('No new notifications.');
    });

    it('summarizes unread notifications', async () => {
      await router.send(basicPayload({ userId: 'user-1', category: 'inventory' }));
      await router.send(basicPayload({ userId: 'user-1', category: 'security' }));
      const summary = router.getVoiceSummary('user-1');
      expect(summary).toContain('2 unread notifications');
    });

    it('includes category breakdown', async () => {
      await router.send(basicPayload({ userId: 'user-1', category: 'inventory' }));
      await router.send(basicPayload({ userId: 'user-1', category: 'inventory' }));
      await router.send(basicPayload({ userId: 'user-1', category: 'billing' }));
      const summary = router.getVoiceSummary('user-1');
      expect(summary).toContain('inventory');
      expect(summary).toContain('billing');
    });
  });

  // ─── Cleanup ─────────────────────────────────────────────────────

  describe('Cleanup', () => {
    it('removes expired notifications', async () => {
      // Create a notification with a very short expiry
      const record = await router.send(basicPayload({ expiryMinutes: 1 }));
      // Manually backdate the expiresAt to be in the past
      const notification = router.getNotification(record.id)!;
      (notification as any).expiresAt = new Date(Date.now() - 1000).toISOString();
      const removed = router.cleanupExpired();
      expect(removed).toBe(1);
      expect(router.getNotification(record.id)).toBeUndefined();
    });

    it('does not remove non-expired notifications', async () => {
      await router.send(basicPayload({ expiryMinutes: 60 }));
      const removed = router.cleanupExpired();
      expect(removed).toBe(0);
    });

    it('enforces history limit per user', async () => {
      const r = createRouter({ maxHistoryPerUser: 3 });
      r.registerChannel(mockAdapter('in_app'));

      for (let i = 0; i < 5; i++) {
        await r.send(basicPayload({ userId: 'user-1', title: `N${i}` }));
      }
      const removed = r.enforceHistoryLimit('user-1');
      expect(removed).toBe(2);
      expect(r.queryNotifications({ userId: 'user-1' }).total).toBe(3);
    });
  });
});
