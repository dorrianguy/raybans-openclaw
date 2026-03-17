/**
 * Tests for Notification Engine.
 *
 * @module notifications/notification-engine.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  NotificationEngine,
  PRIORITY_VALUES,
  DEFAULT_NOTIFICATION_CONFIG,
  type Notification,
  type NotificationPriority,
  type NotificationCategory,
  type UserContext,
  type DeliveredNotification,
} from './notification-engine.js';

// ─── Helpers ────────────────────────────────────────────────────

function createNotification(overrides: Partial<Omit<Notification, 'id' | 'createdAt'>> = {}): Omit<Notification, 'id' | 'createdAt'> {
  return {
    priority: 'medium',
    category: 'system',
    title: 'Test notification',
    message: 'This is a test notification',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('NotificationEngine', () => {
  let engine: NotificationEngine;

  beforeEach(() => {
    engine = new NotificationEngine();
  });

  afterEach(() => {
    engine.reset();
  });

  // ─── Basic Delivery ───────────────────────────────────────

  describe('Basic Notification Delivery', () => {
    it('should deliver a notification and assign an ID', () => {
      const result = engine.notify(createNotification());
      expect(result).not.toBeNull();
      expect(result!.id).toBeTruthy();
      expect(result!.id).toMatch(/^notif-/);
    });

    it('should set createdAt timestamp', () => {
      const result = engine.notify(createNotification());
      expect(result!.createdAt).toBeTruthy();
      expect(new Date(result!.createdAt).getTime()).toBeGreaterThan(0);
    });

    it('should emit notification:queued event', () => {
      const queued = vi.fn();
      engine.on('notification:queued', queued);

      engine.notify(createNotification());
      expect(queued).toHaveBeenCalledTimes(1);
    });

    it('should emit notification:delivered event', () => {
      const delivered = vi.fn();
      engine.on('notification:delivered', delivered);

      engine.notify(createNotification());
      expect(delivered).toHaveBeenCalledTimes(1);
      expect(delivered.mock.calls[0][0].deliveredVia).toBeDefined();
    });

    it('should track delivered notifications', () => {
      engine.notify(createNotification());
      engine.notify(createNotification());
      engine.notify(createNotification());

      const recent = engine.getRecentDeliveries();
      expect(recent).toHaveLength(3);
    });

    it('should use custom id if provided', () => {
      const result = engine.notify(createNotification({ id: 'custom-123' } as any));
      expect(result!.id).toBe('custom-123');
    });
  });

  // ─── Priority Routing ─────────────────────────────────────

  describe('Priority-Based Routing', () => {
    it('should deliver critical notifications via TTS', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.notify(createNotification({ priority: 'critical' }));
      expect(tts).toHaveBeenCalledTimes(1);
    });

    it('should deliver high notifications via TTS in idle context', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.setContext('idle');
      engine.notify(createNotification({ priority: 'high' }));
      expect(tts).toHaveBeenCalledTimes(1);
    });

    it('should NOT deliver medium notifications via TTS by default', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.notify(createNotification({ priority: 'medium' }));
      // Medium only gets TTS for security category
      expect(tts).toHaveBeenCalledTimes(0);
    });

    it('should deliver medium security notifications via TTS', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.notify(createNotification({ priority: 'medium', category: 'security' }));
      expect(tts).toHaveBeenCalledTimes(1);
    });

    it('should suppress TTS for silent priority', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.notify(createNotification({ priority: 'silent' }));
      expect(tts).toHaveBeenCalledTimes(0);
    });

    it('should always send dashboard for non-silent', () => {
      const dashboard = vi.fn();
      engine.on('notification:dashboard', dashboard);

      engine.notify(createNotification({ priority: 'low' }));
      expect(dashboard).toHaveBeenCalledTimes(1);
    });

    it('should NOT send dashboard for silent priority', () => {
      const dashboard = vi.fn();
      engine.on('notification:dashboard', dashboard);

      engine.notify(createNotification({ priority: 'silent' }));
      expect(dashboard).toHaveBeenCalledTimes(0);
    });
  });

  describe('Priority Values', () => {
    it('should have correct priority ordering', () => {
      expect(PRIORITY_VALUES.critical).toBeLessThan(PRIORITY_VALUES.high);
      expect(PRIORITY_VALUES.high).toBeLessThan(PRIORITY_VALUES.medium);
      expect(PRIORITY_VALUES.medium).toBeLessThan(PRIORITY_VALUES.low);
      expect(PRIORITY_VALUES.low).toBeLessThan(PRIORITY_VALUES.silent);
    });
  });

  // ─── Context-Aware Routing ────────────────────────────────

  describe('Context-Aware Routing', () => {
    it('should suppress TTS during meetings (non-critical)', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.setContext('meeting');
      engine.notify(createNotification({ priority: 'medium' }));
      expect(tts).toHaveBeenCalledTimes(0);
    });

    it('should still TTS critical during meetings', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.setContext('meeting');
      engine.notify(createNotification({ priority: 'critical' }));
      expect(tts).toHaveBeenCalledTimes(1);
    });

    it('should suppress everything except critical during sleeping', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.setContext('sleeping');
      engine.notify(createNotification({ priority: 'high' }));
      expect(tts).toHaveBeenCalledTimes(0);
    });

    it('should TTS critical during sleeping', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.setContext('sleeping');
      engine.notify(createNotification({ priority: 'critical' }));
      expect(tts).toHaveBeenCalledTimes(1);
    });

    it('should get/set context', () => {
      expect(engine.getContext()).toBe('idle');
      engine.setContext('working');
      expect(engine.getContext()).toBe('working');
    });

    it('should allow high TTS in shopping context', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.setContext('shopping');
      engine.notify(createNotification({ priority: 'high' }));
      expect(tts).toHaveBeenCalledTimes(1);
    });
  });

  // ─── TTS Rate Limiting ───────────────────────────────────

  describe('TTS Rate Limiting', () => {
    it('should respect max TTS per minute', () => {
      const engine2 = new NotificationEngine({
        maxTtsPerMinute: 2,
        minTtsCooldownSec: 0,
      });

      const tts = vi.fn();
      engine2.on('notification:tts', tts);

      engine2.notify(createNotification({ priority: 'critical' }));
      engine2.notify(createNotification({ priority: 'critical' }));
      engine2.notify(createNotification({ priority: 'critical' }));

      // Only 2 should have TTS, 3rd should be suppressed
      expect(tts).toHaveBeenCalledTimes(2);
    });

    it('should respect cooldown between TTS', () => {
      const engine2 = new NotificationEngine({
        maxTtsPerMinute: 10,
        minTtsCooldownSec: 60, // 60 second cooldown
      });

      const tts = vi.fn();
      engine2.on('notification:tts', tts);

      engine2.notify(createNotification({ priority: 'critical' }));
      engine2.notify(createNotification({ priority: 'critical' }));

      // First should succeed, second should be rate-limited
      expect(tts).toHaveBeenCalledTimes(1);
    });

    it('should mark TTS as suppressed when rate-limited', () => {
      const engine2 = new NotificationEngine({
        maxTtsPerMinute: 1,
        minTtsCooldownSec: 0,
      });

      const suppressed = vi.fn();
      engine2.on('notification:suppressed', suppressed);

      engine2.notify(createNotification({ priority: 'critical' }));
      engine2.notify(createNotification({ priority: 'critical' }));

      expect(suppressed).toHaveBeenCalledTimes(1);
      expect(suppressed.mock.calls[0][1]).toBe('rate_limited');
    });

    it('should report isTtsAvailable correctly', () => {
      expect(engine.isTtsAvailable()).toBe(true);

      engine.setTtsEnabled(false);
      expect(engine.isTtsAvailable()).toBe(false);

      engine.setTtsEnabled(true);
      expect(engine.isTtsAvailable()).toBe(true);
    });
  });

  // ─── TTS Text Preparation ────────────────────────────────

  describe('TTS Text', () => {
    it('should use ttsText if provided', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.notify(createNotification({
        priority: 'critical',
        message: 'Long detailed message',
        ttsText: 'Short voice version',
      }));

      expect(tts).toHaveBeenCalledWith('Short voice version', 'critical');
    });

    it('should fall back to message if no ttsText', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.notify(createNotification({
        priority: 'critical',
        message: 'The message itself',
      }));

      expect(tts).toHaveBeenCalledWith('The message itself', 'critical');
    });

    it('should truncate long TTS text', () => {
      const engine2 = new NotificationEngine({ maxTtsLength: 20 });
      const tts = vi.fn();
      engine2.on('notification:tts', tts);

      engine2.notify(createNotification({
        priority: 'critical',
        message: 'This is a very long message that should be truncated',
      }));

      expect(tts.mock.calls[0][0].length).toBeLessThanOrEqual(20);
      expect(tts.mock.calls[0][0]).toMatch(/\.\.\.$/);
    });
  });

  // ─── Deduplication ────────────────────────────────────────

  describe('Deduplication', () => {
    it('should deduplicate notifications with same key within window', () => {
      const deduped = vi.fn();
      engine.on('notification:deduplicated', deduped);

      engine.notify(createNotification({ dedupeKey: 'same-key', priority: 'high' }));
      engine.notify(createNotification({ dedupeKey: 'same-key', priority: 'high' }));

      expect(deduped).toHaveBeenCalledTimes(1);
    });

    it('should return null for deduplicated notification', () => {
      engine.notify(createNotification({ dedupeKey: 'key1' }));
      const second = engine.notify(createNotification({ dedupeKey: 'key1' }));
      expect(second).toBeNull();
    });

    it('should allow different dedupe keys', () => {
      const result1 = engine.notify(createNotification({ dedupeKey: 'key-a' }));
      const result2 = engine.notify(createNotification({ dedupeKey: 'key-b' }));
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
    });

    it('should not deduplicate if no dedupeKey', () => {
      const result1 = engine.notify(createNotification());
      const result2 = engine.notify(createNotification());
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
    });
  });

  // ─── Escalation ───────────────────────────────────────────

  describe('Escalation', () => {
    it('should escalate after 3 repeated deduplicated notifications', () => {
      const escalated = vi.fn();
      engine.on('notification:escalated', escalated);

      // First: delivered
      engine.notify(createNotification({ dedupeKey: 'repeat', priority: 'low' }));
      // Second: deduped
      engine.notify(createNotification({ dedupeKey: 'repeat', priority: 'low' }));
      // Third: deduped
      engine.notify(createNotification({ dedupeKey: 'repeat', priority: 'low' }));
      // Fourth: deduped + escalation trigger (count = 3)
      engine.notify(createNotification({ dedupeKey: 'repeat', priority: 'low' }));

      expect(escalated).toHaveBeenCalled();
      const [, from, to] = escalated.mock.calls[0];
      expect(from).toBe('low');
      expect(to).toBe('medium');
    });

    it('should not escalate critical (already highest)', () => {
      const escalated = vi.fn();
      engine.on('notification:escalated', escalated);

      engine.notify(createNotification({ dedupeKey: 'crit', priority: 'critical' }));
      engine.notify(createNotification({ dedupeKey: 'crit', priority: 'critical' }));
      engine.notify(createNotification({ dedupeKey: 'crit', priority: 'critical' }));
      engine.notify(createNotification({ dedupeKey: 'crit', priority: 'critical' }));

      expect(escalated).not.toHaveBeenCalled();
    });
  });

  // ─── Expiry ───────────────────────────────────────────────

  describe('Notification Expiry', () => {
    it('should reject expired notifications', () => {
      const expired = vi.fn();
      engine.on('notification:expired', expired);

      const result = engine.notify(createNotification({
        expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired 1 second ago
      }));

      expect(result).toBeNull();
      expect(expired).toHaveBeenCalledTimes(1);
    });

    it('should accept non-expired notifications', () => {
      const result = engine.notify(createNotification({
        expiresAt: new Date(Date.now() + 60000).toISOString(), // Expires in 1 minute
      }));

      expect(result).not.toBeNull();
    });
  });

  // ─── Batching ─────────────────────────────────────────────

  describe('Notification Batching', () => {
    it('should batch notifications with the same groupId', () => {
      const batched = vi.fn();
      engine.on('notification:batched', batched);

      const engine2 = new NotificationEngine({ maxBatchSize: 3, batchWindowMs: 100 });
      engine2.on('notification:batched', batched);

      engine2.notify(createNotification({ groupId: 'group-1', priority: 'low' }));
      engine2.notify(createNotification({ groupId: 'group-1', priority: 'low' }));
      engine2.notify(createNotification({ groupId: 'group-1', priority: 'low' }));

      // Batch should flush at maxBatchSize
      expect(batched).toHaveBeenCalledTimes(1);
      expect(batched.mock.calls[0][1]).toHaveLength(3);
    });

    it('should NOT batch critical notifications', () => {
      const delivered = vi.fn();
      engine.on('notification:delivered', delivered);

      engine.notify(createNotification({ groupId: 'group-1', priority: 'critical' }));

      expect(delivered).toHaveBeenCalledTimes(1);
    });

    it('should NOT batch high notifications', () => {
      const delivered = vi.fn();
      engine.on('notification:delivered', delivered);

      engine.notify(createNotification({ groupId: 'group-1', priority: 'high' }));

      expect(delivered).toHaveBeenCalledTimes(1);
    });

    it('should flush batch after window timeout', async () => {
      const engine2 = new NotificationEngine({ batchWindowMs: 50, maxBatchSize: 100 });

      const batched = vi.fn();
      engine2.on('notification:batched', batched);

      engine2.notify(createNotification({ groupId: 'group-1', priority: 'low' }));
      engine2.notify(createNotification({ groupId: 'group-1', priority: 'low' }));

      expect(batched).not.toHaveBeenCalled();

      await new Promise((r) => setTimeout(r, 100));

      expect(batched).toHaveBeenCalledTimes(1);
      expect(batched.mock.calls[0][1]).toHaveLength(2);

      engine2.reset();
    });
  });

  // ─── Quiet Hours ──────────────────────────────────────────

  describe('Quiet Hours', () => {
    it('should recognize when quiet hours are set', () => {
      engine.setQuietHours(23, 7); // 11pm - 7am
      // We can't easily test time-dependent behavior, but we can test the API
      expect(engine.getStats().isQuietHours).toBeDefined();
    });

    it('should clear quiet hours', () => {
      engine.setQuietHours(23, 7);
      engine.clearQuietHours();
      expect(engine.getStats().isQuietHours).toBe(false);
    });

    it('should suppress TTS for quiet hours notification', () => {
      const suppressed = vi.fn();
      engine.on('notification:suppressed', suppressed);

      // Set quiet hours to cover current time
      const currentHour = new Date().getHours();
      engine.setQuietHours(currentHour, (currentHour + 1) % 24);

      engine.notify(createNotification({ priority: 'high' }));

      expect(suppressed).toHaveBeenCalled();
      if (suppressed.mock.calls.length > 0) {
        expect(suppressed.mock.calls[0][1]).toBe('quiet_hours');
      }
    });
  });

  // ─── Acknowledgment ───────────────────────────────────────

  describe('Acknowledgment', () => {
    it('should acknowledge a notification by ID', () => {
      const result = engine.notify(createNotification({ priority: 'high' }));
      expect(engine.acknowledge(result!.id)).toBe(true);
    });

    it('should return false for non-existent notification', () => {
      expect(engine.acknowledge('nonexistent')).toBe(false);
    });

    it('should track acknowledged status in deliveries', () => {
      const result = engine.notify(createNotification({ priority: 'high' }));
      engine.acknowledge(result!.id);

      const deliveries = engine.getRecentDeliveries({ acknowledged: true });
      expect(deliveries).toHaveLength(1);
    });
  });

  // ─── Filtering ────────────────────────────────────────────

  describe('Delivery Filtering', () => {
    it('should filter by category', () => {
      engine.notify(createNotification({ category: 'security' }));
      engine.notify(createNotification({ category: 'meeting' }));
      engine.notify(createNotification({ category: 'security' }));

      const security = engine.getRecentDeliveries({ category: 'security' });
      expect(security).toHaveLength(2);
    });

    it('should filter by priority', () => {
      engine.notify(createNotification({ priority: 'high' }));
      engine.notify(createNotification({ priority: 'low' }));
      engine.notify(createNotification({ priority: 'high' }));

      const high = engine.getRecentDeliveries({ priority: 'high' });
      expect(high).toHaveLength(2);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        engine.notify(createNotification());
      }

      const limited = engine.getRecentDeliveries({ limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });

  // ─── Custom Rules ─────────────────────────────────────────

  describe('Custom Delivery Rules', () => {
    it('should add custom delivery rule', () => {
      engine.addRule({
        minPriority: 'low',
        categories: ['inventory'],
        contexts: ['shopping'],
        channels: ['tts', 'phone'],
      });

      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.setContext('shopping');
      engine.notify(createNotification({ priority: 'low', category: 'inventory' }));

      expect(tts).toHaveBeenCalledTimes(1);
    });
  });

  // ─── TTS Toggle ───────────────────────────────────────────

  describe('TTS Global Toggle', () => {
    it('should disable TTS globally', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.setTtsEnabled(false);
      engine.notify(createNotification({ priority: 'critical' }));

      expect(tts).toHaveBeenCalledTimes(0);
    });

    it('should re-enable TTS', () => {
      const tts = vi.fn();
      engine.on('notification:tts', tts);

      engine.setTtsEnabled(false);
      engine.setTtsEnabled(true);
      engine.notify(createNotification({ priority: 'critical' }));

      expect(tts).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Statistics ───────────────────────────────────────────

  describe('Statistics', () => {
    it('should return initial stats', () => {
      const stats = engine.getStats();
      expect(stats.totalDelivered).toBe(0);
      expect(stats.ttsSuppressed).toBe(0);
      expect(stats.acknowledged).toBe(0);
      expect(stats.ttsInLastMinute).toBe(0);
      expect(stats.currentContext).toBe('idle');
      expect(stats.isQuietHours).toBe(false);
    });

    it('should track delivery counts', () => {
      engine.notify(createNotification({ priority: 'high' }));
      engine.notify(createNotification({ priority: 'low' }));
      engine.notify(createNotification({ priority: 'critical' }));

      const stats = engine.getStats();
      expect(stats.totalDelivered).toBe(3);
    });

    it('should track by category', () => {
      engine.notify(createNotification({ category: 'security' }));
      engine.notify(createNotification({ category: 'security' }));
      engine.notify(createNotification({ category: 'meeting' }));

      const stats = engine.getStats();
      expect(stats.byCategory.security).toBe(2);
      expect(stats.byCategory.meeting).toBe(1);
    });

    it('should track by priority', () => {
      engine.notify(createNotification({ priority: 'critical' }));
      engine.notify(createNotification({ priority: 'high' }));
      engine.notify(createNotification({ priority: 'high' }));

      const stats = engine.getStats();
      expect(stats.byPriority.critical).toBe(1);
      expect(stats.byPriority.high).toBe(2);
    });

    it('should track TTS in last minute', () => {
      engine.notify(createNotification({ priority: 'critical' }));
      const stats = engine.getStats();
      expect(stats.ttsInLastMinute).toBe(1);
    });
  });

  // ─── Reset ────────────────────────────────────────────────

  describe('Reset', () => {
    it('should clear all state on reset', () => {
      engine.notify(createNotification());
      engine.notify(createNotification({ dedupeKey: 'key' }));

      engine.reset();

      const stats = engine.getStats();
      expect(stats.totalDelivered).toBe(0);
      expect(stats.dedupeCacheSize).toBe(0);
      expect(stats.ttsInLastMinute).toBe(0);
    });
  });

  // ─── Default Config ───────────────────────────────────────

  describe('Default Configuration', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_NOTIFICATION_CONFIG.maxTtsPerMinute).toBe(6);
      expect(DEFAULT_NOTIFICATION_CONFIG.minTtsCooldownSec).toBe(5);
      expect(DEFAULT_NOTIFICATION_CONFIG.maxTtsLength).toBe(200);
      expect(DEFAULT_NOTIFICATION_CONFIG.dedupeWindowSec).toBe(60);
      expect(DEFAULT_NOTIFICATION_CONFIG.batchWindowMs).toBe(2000);
      expect(DEFAULT_NOTIFICATION_CONFIG.maxBatchSize).toBe(5);
      expect(DEFAULT_NOTIFICATION_CONFIG.ttsEnabled).toBe(true);
      expect(DEFAULT_NOTIFICATION_CONFIG.userContext).toBe('idle');
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle rapid-fire notifications without crashing', () => {
      for (let i = 0; i < 100; i++) {
        engine.notify(createNotification({
          priority: ['critical', 'high', 'medium', 'low', 'silent'][i % 5] as NotificationPriority,
          category: 'system',
          title: `Notification ${i}`,
        }));
      }

      const stats = engine.getStats();
      expect(stats.totalDelivered).toBeGreaterThan(0);
    });

    it('should bound history size', () => {
      for (let i = 0; i < 600; i++) {
        engine.notify(createNotification({ title: `N${i}` }));
      }

      const recent = engine.getRecentDeliveries({ limit: 1000 });
      expect(recent.length).toBeLessThanOrEqual(500);
    });

    it('should handle empty notification fields', () => {
      const result = engine.notify({
        priority: 'medium',
        category: 'system',
        title: '',
        message: '',
      });
      expect(result).not.toBeNull();
    });
  });
});
