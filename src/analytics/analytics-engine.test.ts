/**
 * Tests for Analytics Engine.
 *
 * @module analytics/analytics-engine.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AnalyticsEngine,
  DEFAULT_ANALYTICS_CONFIG,
  type AnalyticsEvent,
  type AnalyticsEventCategory,
  type TimeBucket,
} from './analytics-engine.js';

// ─── Tests ──────────────────────────────────────────────────────

describe('AnalyticsEngine', () => {
  let engine: AnalyticsEngine;

  beforeEach(() => {
    engine = new AnalyticsEngine();
  });

  // ─── Basic Event Tracking ─────────────────────────────────

  describe('Event Tracking', () => {
    it('should track a basic event', () => {
      const event = engine.track('image', 'captured');
      expect(event).toBeDefined();
      expect(event.id).toMatch(/^evt-/);
      expect(event.category).toBe('image');
      expect(event.action).toBe('captured');
      expect(event.timestamp).toBeTruthy();
    });

    it('should track event with options', () => {
      const event = engine.track('agent', 'invocation', {
        label: 'security_agent',
        value: 150,
        durationMs: 150,
        success: true,
        agentId: 'security',
        metadata: { threat: 'phishing' },
      });

      expect(event.label).toBe('security_agent');
      expect(event.value).toBe(150);
      expect(event.durationMs).toBe(150);
      expect(event.success).toBe(true);
      expect(event.agentId).toBe('security');
      expect(event.metadata?.threat).toBe('phishing');
    });

    it('should emit analytics:event on track', () => {
      const handler = vi.fn();
      engine.on('analytics:event', handler);

      engine.track('image', 'captured');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should increment total events', () => {
      engine.track('image', 'captured');
      engine.track('agent', 'invocation');
      engine.track('voice', 'command');
      expect(engine.getTotalEvents()).toBe(3);
    });

    it('should bound memory when exceeding max events', () => {
      const small = new AnalyticsEngine({ maxEventsInMemory: 10 });
      for (let i = 0; i < 20; i++) {
        small.track('image', 'captured');
      }
      // Should have trimmed to ~75% of max
      expect(small.getTotalEvents()).toBeLessThanOrEqual(10);
    });
  });

  // ─── Convenience Trackers ─────────────────────────────────

  describe('Convenience Trackers', () => {
    it('should track image capture', () => {
      const event = engine.trackImageCapture('img-123', 'auto');
      expect(event.category).toBe('image');
      expect(event.action).toBe('captured');
      expect(event.label).toBe('auto');
    });

    it('should track image processed', () => {
      const event = engine.trackImageProcessed('img-123', 250, true);
      expect(event.category).toBe('image');
      expect(event.action).toBe('processed');
      expect(event.durationMs).toBe(250);
      expect(event.success).toBe(true);
    });

    it('should track agent invocation', () => {
      const event = engine.trackAgentInvocation('security', 'scan', 100, true);
      expect(event.agentId).toBe('security');
      expect(event.durationMs).toBe(100);
      expect(event.success).toBe(true);
    });

    it('should track voice command', () => {
      const event = engine.trackVoiceCommand('price_check', 0.95);
      expect(event.category).toBe('voice');
      expect(event.action).toBe('command');
      expect(event.label).toBe('price_check');
      expect(event.value).toBe(0.95);
    });

    it('should track TTS delivery', () => {
      const event = engine.trackTtsDelivery('high', 150);
      expect(event.category).toBe('voice');
      expect(event.action).toBe('tts_delivered');
      expect(event.value).toBe(150);
    });

    it('should track error', () => {
      const event = engine.trackError('vision_pipeline', 'Model timeout');
      expect(event.category).toBe('error');
      expect(event.action).toBe('vision_pipeline');
      expect(event.success).toBe(false);
    });

    it('should track chain completion', () => {
      const event = engine.trackChainCompleted('sales_meeting', 5000, true);
      expect(event.category).toBe('chain');
      expect(event.action).toBe('completed');
      expect(event.durationMs).toBe(5000);
    });
  });

  // ─── Value Tracking ───────────────────────────────────────

  describe('Value Tracking', () => {
    it('should track value generation events', () => {
      const event = engine.trackValue('deal_savings', 69.99);
      expect(event.category).toBe('value');
      expect(event.action).toBe('deal_savings');
      expect(event.value).toBe(69.99);
      expect(event.success).toBe(true);
    });

    it('should aggregate value metrics', () => {
      engine.trackValue('deal_savings', 25.00);
      engine.trackValue('deal_savings', 50.00);
      engine.trackValue('time_saved', 30); // 30 minutes

      const metrics = engine.getValueMetrics('all');
      expect(metrics.estimatedMoneySaved).toBe(75.00);
      expect(metrics.estimatedTimeSavedMin).toBe(30);
    });

    it('should count agent-specific value events', () => {
      engine.track('inventory', 'item_counted');
      engine.track('inventory', 'item_counted');
      engine.track('inventory', 'item_counted');

      engine.track('agent', 'networking_scan', { agentId: 'networking' });
      engine.track('agent', 'security_threat', { agentId: 'security' });
      engine.track('agent', 'deal_analyzed', { agentId: 'deal' });
      engine.track('agent', 'deal_analyzed', { agentId: 'deal' });

      const metrics = engine.getValueMetrics('all');
      expect(metrics.itemsInventoried).toBe(3);
      expect(metrics.contactsScanned).toBe(1);
      expect(metrics.threatsDetected).toBe(1);
      expect(metrics.dealsAnalyzed).toBe(2);
    });
  });

  // ─── Timer Tracking ───────────────────────────────────────

  describe('Timer Tracking', () => {
    it('should start and stop a timer', async () => {
      const timerId = engine.startTimer('vision_processing');

      await new Promise((r) => setTimeout(r, 50));

      const event = engine.stopTimer(timerId, 'image', 'processed', {
        success: true,
      });

      expect(event).not.toBeNull();
      expect(event!.durationMs).toBeGreaterThanOrEqual(40); // Allow some variance
      expect(event!.category).toBe('image');
    });

    it('should return null for unknown timer', () => {
      const event = engine.stopTimer('nonexistent', 'image', 'processed');
      expect(event).toBeNull();
    });
  });

  // ─── Session Tracking ─────────────────────────────────────

  describe('Session Tracking', () => {
    it('should track session start and end', async () => {
      engine.startSession('session-1');

      await new Promise((r) => setTimeout(r, 50));

      engine.endSession('session-1');

      const events = engine.getEvents({ category: 'session' });
      expect(events).toHaveLength(2);
      expect(events[0].action).toBe('start');
      expect(events[1].action).toBe('end');
      expect(events[1].durationMs).toBeGreaterThanOrEqual(40);
    });

    it('should handle ending non-existent session', () => {
      // Should not throw
      engine.endSession('nonexistent');
      const events = engine.getEvents({ category: 'session', action: 'end' });
      expect(events).toHaveLength(1);
      expect(events[0].durationMs).toBe(0);
    });
  });

  // ─── Event Querying ───────────────────────────────────────

  describe('Event Querying', () => {
    beforeEach(() => {
      engine.track('image', 'captured', { success: true });
      engine.track('image', 'captured', { success: true });
      engine.track('image', 'processed', { success: true, durationMs: 100 });
      engine.track('agent', 'invocation', { agentId: 'security', success: true });
      engine.track('agent', 'invocation', { agentId: 'networking', success: false });
      engine.track('error', 'pipeline', { label: 'timeout' });
    });

    it('should filter by category', () => {
      const images = engine.getEvents({ category: 'image' });
      expect(images).toHaveLength(3);
    });

    it('should filter by action', () => {
      const captured = engine.getEvents({ category: 'image', action: 'captured' });
      expect(captured).toHaveLength(2);
    });

    it('should filter by agentId', () => {
      const security = engine.getEvents({ agentId: 'security' });
      expect(security).toHaveLength(1);
    });

    it('should filter by success', () => {
      const failures = engine.getEvents({ success: false });
      expect(failures).toHaveLength(1);
    });

    it('should respect limit', () => {
      const limited = engine.getEvents({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('should filter by time range', () => {
      const all = engine.getEvents({
        since: new Date(Date.now() - 60000).toISOString(),
      });
      expect(all.length).toBe(6);
    });
  });

  // ─── Aggregated Metrics ───────────────────────────────────

  describe('Aggregated Metrics', () => {
    it('should compute aggregated metrics', () => {
      engine.track('image', 'processed', { value: 100, success: true });
      engine.track('image', 'processed', { value: 200, success: true });
      engine.track('image', 'processed', { value: 300, success: false });

      const metric = engine.getAggregatedMetric('image', 'processed', 'all');

      expect(metric.name).toBe('image.processed');
      expect(metric.count).toBe(3);
      expect(metric.totalValue).toBe(600);
      expect(metric.averageValue).toBe(200);
      expect(metric.minValue).toBe(100);
      expect(metric.maxValue).toBe(300);
      expect(metric.successRate).toBeCloseTo(0.667, 1);
    });

    it('should handle empty data', () => {
      const metric = engine.getAggregatedMetric('image', 'captured', 'day');
      expect(metric.count).toBe(0);
      expect(metric.totalValue).toBe(0);
      expect(metric.averageValue).toBe(0);
    });

    it('should compute P95', () => {
      for (let i = 1; i <= 100; i++) {
        engine.track('image', 'processed', { value: i });
      }

      const metric = engine.getAggregatedMetric('image', 'processed', 'all');
      expect(metric.p95Value).toBeGreaterThanOrEqual(95);
      expect(metric.p95Value).toBeLessThanOrEqual(100);
    });
  });

  // ─── Agent Metrics ────────────────────────────────────────

  describe('Agent Metrics', () => {
    it('should compute agent performance metrics', () => {
      engine.trackAgentInvocation('security', 'scan', 100, true);
      engine.trackAgentInvocation('security', 'scan', 200, true);
      engine.trackAgentInvocation('security', 'scan', 500, false);

      const metrics = engine.getAgentMetrics('security');

      expect(metrics.agentId).toBe('security');
      expect(metrics.totalInvocations).toBe(3);
      expect(metrics.successfulInvocations).toBe(2);
      expect(metrics.failedInvocations).toBe(1);
      expect(metrics.averageResponseTimeMs).toBeGreaterThan(0);
      expect(metrics.successRate).toBeCloseTo(0.667, 1);
      expect(metrics.maxResponseTimeMs).toBe(500);
      expect(metrics.lastInvokedAt).toBeTruthy();
    });

    it('should handle agent with no events', () => {
      const metrics = engine.getAgentMetrics('nonexistent');
      expect(metrics.totalInvocations).toBe(0);
      expect(metrics.successRate).toBe(0);
      expect(metrics.averageResponseTimeMs).toBe(0);
    });

    it('should compute P95 response time', () => {
      for (let i = 0; i < 100; i++) {
        engine.trackAgentInvocation('fast', 'scan', i * 10, true);
      }

      const metrics = engine.getAgentMetrics('fast');
      expect(metrics.p95ResponseTimeMs).toBeGreaterThanOrEqual(900);
    });
  });

  // ─── Session Metrics ──────────────────────────────────────

  describe('Session Metrics', () => {
    it('should compute session metrics', () => {
      engine.track('session', 'end', { durationMs: 30 * 60_000, sessionId: 's1' });
      engine.track('session', 'end', { durationMs: 60 * 60_000, sessionId: 's2' });
      engine.trackImageCapture('img-1', 'auto');
      engine.trackImageCapture('img-2', 'manual');
      engine.trackImageProcessed('img-1', 100, true);
      engine.trackVoiceCommand('price_check', 0.9);
      engine.trackTtsDelivery('high', 50);

      const metrics = engine.getSessionMetrics('all');

      expect(metrics.totalSessions).toBe(2);
      expect(metrics.averageSessionDurationMin).toBe(45);
      expect(metrics.imagesCaptured).toBe(2);
      expect(metrics.imagesProcessed).toBe(1);
      expect(metrics.voiceCommands).toBe(1);
      expect(metrics.ttsDeliveries).toBe(1);
    });

    it('should find top agent', () => {
      engine.track('agent', 'scan', { agentId: 'security' });
      engine.track('agent', 'scan', { agentId: 'security' });
      engine.track('agent', 'scan', { agentId: 'security' });
      engine.track('agent', 'analyze', { agentId: 'deal' });

      const metrics = engine.getSessionMetrics('all');
      expect(metrics.topAgent).toBe('security');
    });

    it('should find top voice command', () => {
      engine.trackVoiceCommand('price_check', 0.9);
      engine.trackVoiceCommand('price_check', 0.8);
      engine.trackVoiceCommand('translate', 0.95);

      const metrics = engine.getSessionMetrics('all');
      expect(metrics.topVoiceCommand).toBe('price_check');
    });
  });

  // ─── Dashboard ────────────────────────────────────────────

  describe('Dashboard Overview', () => {
    it('should generate full dashboard', () => {
      engine.trackImageCapture('img-1', 'auto');
      engine.trackImageProcessed('img-1', 100, true);
      engine.trackAgentInvocation('security', 'scan', 150, true);
      engine.trackVoiceCommand('price_check', 0.9);
      engine.trackValue('deal_savings', 25.00);
      engine.trackError('pipeline', 'timeout');

      const dashboard = engine.getDashboard('all');

      expect(dashboard.period).toBe('all');
      expect(dashboard.totalEvents).toBeGreaterThan(0);
      expect(dashboard.sessions).toBeDefined();
      expect(dashboard.value).toBeDefined();
      expect(dashboard.agents).toBeDefined();
      expect(dashboard.eventsByCategory).toBeDefined();
      expect(dashboard.errorRate).toBeGreaterThan(0);
    });

    it('should include agent metrics in dashboard', () => {
      engine.trackAgentInvocation('security', 'scan', 100, true);
      engine.trackAgentInvocation('networking', 'scan', 200, true);

      const dashboard = engine.getDashboard('all');
      expect(dashboard.agents).toHaveLength(2);
      expect(dashboard.agents.map((a) => a.agentId).sort()).toEqual(['networking', 'security']);
    });

    it('should respect time bucket', () => {
      const dashboard = engine.getDashboard('hour');
      expect(dashboard.period).toBe('hour');
      expect(dashboard.periodStart).toBeTruthy();
      expect(dashboard.periodEnd).toBeTruthy();
    });
  });

  // ─── Time Buckets ─────────────────────────────────────────

  describe('Time Buckets', () => {
    it('should filter events by minute bucket', () => {
      engine.track('image', 'captured');
      const metric = engine.getAggregatedMetric('image', 'captured', 'minute');
      expect(metric.count).toBe(1);
    });

    it('should filter events by hour bucket', () => {
      engine.track('image', 'captured');
      const metric = engine.getAggregatedMetric('image', 'captured', 'hour');
      expect(metric.count).toBe(1);
    });

    it('should filter events by day bucket', () => {
      engine.track('image', 'captured');
      const metric = engine.getAggregatedMetric('image', 'captured', 'day');
      expect(metric.count).toBe(1);
    });

    it('should filter events by week bucket', () => {
      engine.track('image', 'captured');
      const metric = engine.getAggregatedMetric('image', 'captured', 'week');
      expect(metric.count).toBe(1);
    });

    it('should filter events by month bucket', () => {
      engine.track('image', 'captured');
      const metric = engine.getAggregatedMetric('image', 'captured', 'month');
      expect(metric.count).toBe(1);
    });

    it('should get all events with "all" bucket', () => {
      engine.track('image', 'captured');
      const metric = engine.getAggregatedMetric('image', 'captured', 'all');
      expect(metric.count).toBe(1);
    });
  });

  // ─── Milestones ───────────────────────────────────────────

  describe('Milestones', () => {
    it('should emit milestone when threshold reached', () => {
      const milestone = vi.fn();
      engine.on('analytics:milestone', milestone);

      for (let i = 0; i < 11; i++) {
        engine.trackImageCapture(`img-${i}`, 'auto');
      }

      expect(milestone).toHaveBeenCalledWith('image_captured', 10);
    });

    it('should emit agent milestone', () => {
      const milestone = vi.fn();
      engine.on('analytics:milestone', milestone);

      for (let i = 0; i < 11; i++) {
        engine.trackAgentInvocation('security', 'scan', 100, true);
      }

      expect(milestone).toHaveBeenCalledWith('agent_invocation', 10);
    });

    it('should not emit same milestone twice', () => {
      const milestone = vi.fn();
      engine.on('analytics:milestone', milestone);

      for (let i = 0; i < 15; i++) {
        engine.trackImageCapture(`img-${i}`, 'auto');
      }

      const calls = milestone.mock.calls.filter(
        ([name, val]) => name === 'image_captured' && val === 10,
      );
      expect(calls).toHaveLength(1);
    });
  });

  // ─── Reset ────────────────────────────────────────────────

  describe('Reset', () => {
    it('should clear all tracked data', () => {
      engine.track('image', 'captured');
      engine.track('agent', 'invocation');
      engine.startTimer('test');
      engine.startSession('s1');

      engine.reset();

      expect(engine.getTotalEvents()).toBe(0);
      expect(engine.getEvents()).toHaveLength(0);
    });
  });

  // ─── Configuration ────────────────────────────────────────

  describe('Configuration', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_ANALYTICS_CONFIG.maxEventsInMemory).toBe(10_000);
      expect(DEFAULT_ANALYTICS_CONFIG.detailedTracking).toBe(true);
      expect(DEFAULT_ANALYTICS_CONFIG.currency).toBe('USD');
    });

    it('should strip metadata when detailedTracking is false', () => {
      const sparse = new AnalyticsEngine({ detailedTracking: false });
      const event = sparse.track('image', 'captured', {
        metadata: { imageId: 'test' },
      });
      expect(event.metadata).toBeUndefined();
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle rapid tracking without crashing', () => {
      for (let i = 0; i < 1000; i++) {
        engine.track('image', 'captured', { value: i });
      }
      expect(engine.getTotalEvents()).toBeGreaterThan(0);
    });

    it('should handle undefined values in aggregation', () => {
      engine.track('image', 'captured'); // No value
      engine.track('image', 'captured', { value: 100 });

      const metric = engine.getAggregatedMetric('image', 'captured', 'all');
      expect(metric.count).toBe(2);
      expect(metric.totalValue).toBe(100);
      expect(metric.averageValue).toBe(100); // Only 1 value
    });

    it('should handle empty event list for metrics', () => {
      const metrics = engine.getAgentMetrics('nonexistent');
      expect(metrics.totalInvocations).toBe(0);
      expect(metrics.successRate).toBe(0);

      const session = engine.getSessionMetrics('day');
      expect(session.totalSessions).toBe(0);

      const value = engine.getValueMetrics('day');
      expect(value.estimatedMoneySaved).toBe(0);
    });
  });
});
