/**
 * Alert Rules Engine — Tests
 * 🌙 Night Shift Agent — Shift #24
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AlertRulesEngine,
  type AlertCondition,
  type AlertAction,
  type EvaluationContext,
} from './alert-rules.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(data: Record<string, unknown>, previous?: Record<string, unknown>): EvaluationContext {
  return {
    timestamp: Date.now(),
    data,
    previousData: previous,
    metadata: {},
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AlertRulesEngine', () => {
  let engine: AlertRulesEngine;

  beforeEach(() => {
    engine = new AlertRulesEngine();
  });

  // ─── Rule Management ─────────────────────────────────────────────────

  describe('Rule Management', () => {
    it('creates a rule', () => {
      const rule = engine.createRule(
        'Test Rule', 'A test rule', 'warning',
        [{ type: 'threshold', field: 'quantity', threshold: 5, direction: 'below' }],
        [{ type: 'notify', message: 'Low stock!' }],
      );

      expect(rule.id).toBeTruthy();
      expect(rule.name).toBe('Test Rule');
      expect(rule.enabled).toBe(true);
      expect(rule.fireCount).toBe(0);
    });

    it('gets a rule by id', () => {
      const rule = engine.createRule('Test', '', 'info', [], []);
      expect(engine.getRule(rule.id)).toBeDefined();
    });

    it('lists all rules', () => {
      engine.createRule('Rule 1', '', 'info', [], []);
      engine.createRule('Rule 2', '', 'warning', [], []);

      const rules = engine.listRules();
      expect(rules).toHaveLength(2);
    });

    it('lists rules by enabled status', () => {
      const r1 = engine.createRule('Enabled', '', 'info', [], []);
      const r2 = engine.createRule('Disabled', '', 'info', [], []);
      engine.disableRule(r2.id);

      expect(engine.listRules({ enabled: true })).toHaveLength(1);
      expect(engine.listRules({ enabled: false })).toHaveLength(1);
    });

    it('lists rules by severity', () => {
      engine.createRule('Info', '', 'info', [], []);
      engine.createRule('Warning', '', 'warning', [], []);
      engine.createRule('Critical', '', 'critical', [], []);

      expect(engine.listRules({ severity: 'warning' })).toHaveLength(1);
    });

    it('lists rules by tags', () => {
      engine.createRule('Inv', '', 'info', [], [], { tags: ['inventory'] });
      engine.createRule('Sec', '', 'info', [], [], { tags: ['security'] });

      expect(engine.listRules({ tags: ['inventory'] })).toHaveLength(1);
    });

    it('updates a rule', () => {
      const rule = engine.createRule('Original', '', 'info', [], []);
      const updated = engine.updateRule(rule.id, { name: 'Updated', severity: 'warning' });

      expect(updated!.name).toBe('Updated');
      expect(updated!.severity).toBe('warning');
    });

    it('returns null for updating non-existent rule', () => {
      expect(engine.updateRule('nonexistent', { name: 'X' })).toBeNull();
    });

    it('deletes a rule', () => {
      const rule = engine.createRule('Test', '', 'info', [], []);
      expect(engine.deleteRule(rule.id)).toBe(true);
      expect(engine.getRule(rule.id)).toBeUndefined();
    });

    it('enables and disables rules', () => {
      const rule = engine.createRule('Test', '', 'info', [], []);

      engine.disableRule(rule.id);
      expect(engine.getRule(rule.id)!.enabled).toBe(false);

      engine.enableRule(rule.id);
      expect(engine.getRule(rule.id)!.enabled).toBe(true);
    });
  });

  // ─── Templates ───────────────────────────────────────────────────────

  describe('Templates', () => {
    it('lists available templates', () => {
      const templates = engine.listTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(8);
      expect(templates.some(t => t.id === 'low-stock')).toBe(true);
      expect(templates.some(t => t.id === 'security-threat')).toBe(true);
    });

    it('creates rule from template', () => {
      const rule = engine.createFromTemplate('low-stock');
      expect(rule).not.toBeNull();
      expect(rule!.name).toBe('Low Stock Alert');
      expect(rule!.severity).toBe('warning');
      expect(rule!.conditions).toHaveLength(1);
      expect(rule!.actions.length).toBeGreaterThan(0);
    });

    it('allows overriding template properties', () => {
      const rule = engine.createFromTemplate('low-stock', {
        name: 'Custom Low Stock',
        severity: 'critical',
      });
      expect(rule!.name).toBe('Custom Low Stock');
      expect(rule!.severity).toBe('critical');
    });

    it('returns null for non-existent template', () => {
      expect(engine.createFromTemplate('nonexistent')).toBeNull();
    });
  });

  // ─── Threshold Conditions ────────────────────────────────────────────

  describe('Threshold Conditions', () => {
    it('fires when value is below threshold', () => {
      engine.createRule(
        'Low Stock', '', 'warning',
        [{ type: 'threshold', field: 'quantity', threshold: 5, direction: 'below' }],
        [{ type: 'notify', message: 'Low stock: {{product}}' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ quantity: 3, product: 'Widget' }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].message).toContain('Widget');
    });

    it('does not fire when value is above threshold', () => {
      engine.createRule(
        'Low Stock', '', 'warning',
        [{ type: 'threshold', field: 'quantity', threshold: 5, direction: 'below' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ quantity: 10 }));
      expect(alerts).toHaveLength(0);
    });

    it('fires on equal threshold', () => {
      engine.createRule(
        'Out of Stock', '', 'critical',
        [{ type: 'threshold', field: 'quantity', threshold: 0, direction: 'equal' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ quantity: 0 }));
      expect(alerts).toHaveLength(1);
    });

    it('fires on above threshold', () => {
      engine.createRule(
        'Overstock', '', 'info',
        [{ type: 'threshold', field: 'quantity', threshold: 100, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ quantity: 150 }));
      expect(alerts).toHaveLength(1);
    });
  });

  // ─── Change Conditions ───────────────────────────────────────────────

  describe('Change Conditions', () => {
    it('detects absolute value change', () => {
      engine.createRule(
        'Big Change', '', 'warning',
        [{ type: 'change', field: 'price', changeAmount: 10 }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ price: 50 }, { price: 35 }));
      expect(alerts).toHaveLength(1);
    });

    it('detects percentage change', () => {
      engine.createRule(
        'Price Jump', '', 'warning',
        [{ type: 'change', field: 'price', changePercent: 20 }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ price: 130 }, { price: 100 }));
      expect(alerts).toHaveLength(1);
    });

    it('does not fire for small changes', () => {
      engine.createRule(
        'Big Change', '', 'warning',
        [{ type: 'change', field: 'price', changeAmount: 10 }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ price: 52 }, { price: 50 }));
      expect(alerts).toHaveLength(0);
    });
  });

  // ─── Absence Conditions ──────────────────────────────────────────────

  describe('Absence Conditions', () => {
    it('fires when field value exceeds timeout', () => {
      engine.createRule(
        'Inactivity', '', 'info',
        [{ type: 'absence', field: 'lastActivity', absenceTimeout: 1000 }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({
        lastActivity: Date.now() - 5000, // 5 seconds ago
      }));
      expect(alerts).toHaveLength(1);
    });

    it('does not fire when activity is recent', () => {
      engine.createRule(
        'Inactivity', '', 'info',
        [{ type: 'absence', field: 'lastActivity', absenceTimeout: 60000 }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({
        lastActivity: Date.now() - 1000,
      }));
      expect(alerts).toHaveLength(0);
    });
  });

  // ─── Pattern Conditions ──────────────────────────────────────────────

  describe('Pattern Conditions', () => {
    it('matches regex patterns', () => {
      engine.createRule(
        'Error Pattern', '', 'warning',
        [{ type: 'pattern', field: 'message', value: 'error|fail' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ message: 'Connection error detected' }));
      expect(alerts).toHaveLength(1);
    });

    it('does not match non-matching patterns', () => {
      engine.createRule(
        'Error Pattern', '', 'warning',
        [{ type: 'pattern', field: 'message', value: 'error|fail' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ message: 'All systems normal' }));
      expect(alerts).toHaveLength(0);
    });
  });

  // ─── Comparison Conditions ───────────────────────────────────────────

  describe('Comparison Conditions', () => {
    it('compares two fields', () => {
      engine.createRule(
        'Price Mismatch', '', 'warning',
        [{ type: 'comparison', field: 'scannedPrice', operator: 'ne', value: 'expectedPrice' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({
        scannedPrice: 15.99,
        expectedPrice: 12.99,
      }));
      expect(alerts).toHaveLength(1);
    });

    it('compares against static value', () => {
      engine.createRule(
        'Status Check', '', 'info',
        [{ type: 'comparison', field: 'status', operator: 'eq', value: 'active' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ status: 'active' }));
      expect(alerts).toHaveLength(1);
    });

    it('supports contains operator', () => {
      engine.createRule(
        'Name Check', '', 'info',
        [{ type: 'comparison', field: 'name', operator: 'contains', value: 'DeWalt' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ name: 'DeWalt 20V Drill Kit' }));
      expect(alerts).toHaveLength(1);
    });

    it('supports in operator', () => {
      engine.createRule(
        'Category Check', '', 'info',
        [{ type: 'comparison', field: 'category', operator: 'in', value: ['Tools', 'Hardware'] }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ category: 'Tools' }));
      expect(alerts).toHaveLength(1);
    });

    it('supports between operator', () => {
      engine.createRule(
        'Price Range', '', 'info',
        [{ type: 'comparison', field: 'price', operator: 'between', value: [10, 20] }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ price: 15 }));
      expect(alerts).toHaveLength(1);

      const noAlerts = engine.evaluate(makeContext({ price: 25 }));
      expect(noAlerts).toHaveLength(0);
    });
  });

  // ─── Time Window Conditions ──────────────────────────────────────────

  describe('Time Window Conditions', () => {
    it('fires within time window', () => {
      const now = new Date();
      const hour = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const nextMin = String(now.getMinutes() + 1).padStart(2, '0');

      engine.createRule(
        'Scheduled', '', 'info',
        [{ type: 'time_window', timeWindowStart: `${hour}:${min}`, timeWindowEnd: `${hour}:${nextMin}` }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({}));
      expect(alerts).toHaveLength(1);
    });

    it('does not fire outside time window', () => {
      engine.createRule(
        'Scheduled', '', 'info',
        [{ type: 'time_window', timeWindowStart: '03:00', timeWindowEnd: '03:01' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      // Construct a context at a different time
      const context = makeContext({});
      const testDate = new Date(2026, 0, 1, 14, 30); // 2:30 PM
      context.timestamp = testDate.getTime();

      const alerts = engine.evaluate(context);
      expect(alerts).toHaveLength(0);
    });

    it('filters by day of week', () => {
      const now = new Date();
      const today = now.getDay();

      engine.createRule(
        'Weekday Only', '', 'info',
        [{
          type: 'time_window',
          timeWindowStart: '00:00',
          timeWindowEnd: '23:59',
          timeWindowDays: [(today + 1) % 7], // tomorrow, not today
        }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({}));
      expect(alerts).toHaveLength(0);
    });
  });

  // ─── Geo Fence Conditions ────────────────────────────────────────────

  describe('Geo Fence Conditions', () => {
    it('fires when entering geo fence', () => {
      engine.createRule(
        'At Store', '', 'info',
        [{
          type: 'geo_fence',
          geoCenter: { lat: 44.9537, lng: -93.0900 },
          geoRadius: 100, // 100 meters
          geoTrigger: 'enter',
        }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({
        latitude: 44.9537,
        longitude: -93.0900,
      }));
      expect(alerts).toHaveLength(1);
    });

    it('fires when exiting geo fence', () => {
      engine.createRule(
        'Left Store', '', 'info',
        [{
          type: 'geo_fence',
          geoCenter: { lat: 44.9537, lng: -93.0900 },
          geoRadius: 100,
          geoTrigger: 'exit',
        }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({
        latitude: 45.0000,
        longitude: -93.0000,
      }));
      expect(alerts).toHaveLength(1);
    });

    it('does not fire without location data', () => {
      engine.createRule(
        'At Store', '', 'info',
        [{
          type: 'geo_fence',
          geoCenter: { lat: 44.9537, lng: -93.0900 },
          geoRadius: 100,
        }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({}));
      expect(alerts).toHaveLength(0);
    });
  });

  // ─── Composite Conditions ────────────────────────────────────────────

  describe('Composite Conditions', () => {
    it('evaluates nested AND conditions', () => {
      engine.createRule(
        'Complex Rule', '', 'warning',
        [{
          type: 'composite',
          conditionOperator: 'AND',
          conditions: [
            { type: 'threshold', field: 'quantity', threshold: 10, direction: 'below' },
            { type: 'comparison', field: 'category', operator: 'eq', value: 'Power Tools' },
          ],
        }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const match = engine.evaluate(makeContext({ quantity: 3, category: 'Power Tools' }));
      expect(match).toHaveLength(1);

      const noMatch = engine.evaluate(makeContext({ quantity: 3, category: 'Cleaning' }));
      expect(noMatch).toHaveLength(0);
    });

    it('evaluates nested OR conditions', () => {
      engine.createRule(
        'Either Rule', '', 'warning',
        [{
          type: 'composite',
          conditionOperator: 'OR',
          conditions: [
            { type: 'threshold', field: 'quantity', threshold: 0, direction: 'equal' },
            { type: 'threshold', field: 'confidence', threshold: 0.5, direction: 'below' },
          ],
        }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const match1 = engine.evaluate(makeContext({ quantity: 0, confidence: 0.9 }));
      expect(match1).toHaveLength(1);

      const match2 = engine.evaluate(makeContext({ quantity: 10, confidence: 0.3 }));
      expect(match2).toHaveLength(1);
    });
  });

  // ─── Custom Conditions ───────────────────────────────────────────────

  describe('Custom Conditions', () => {
    it('supports custom evaluator functions', () => {
      engine.createRule(
        'Custom', '', 'info',
        [{
          type: 'custom',
          evaluator: (ctx) => {
            const price = ctx.data.price as number;
            const quantity = ctx.data.quantity as number;
            return price * quantity > 1000;
          },
        }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const match = engine.evaluate(makeContext({ price: 150, quantity: 8 }));
      expect(match).toHaveLength(1);

      const noMatch = engine.evaluate(makeContext({ price: 10, quantity: 5 }));
      expect(noMatch).toHaveLength(0);
    });
  });

  // ─── Cooldown ────────────────────────────────────────────────────────

  describe('Cooldown', () => {
    it('respects cooldown period', () => {
      engine.createRule(
        'Cooldown Test', '', 'warning',
        [{ type: 'threshold', field: 'value', threshold: 10, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 60_000 }, // 1 minute
      );

      const first = engine.evaluate(makeContext({ value: 15 }));
      expect(first).toHaveLength(1);

      // Second evaluation within cooldown
      const second = engine.evaluate(makeContext({ value: 15 }));
      expect(second).toHaveLength(0);
    });

    it('fires again after cooldown expires', () => {
      const rule = engine.createRule(
        'Cooldown Test', '', 'warning',
        [{ type: 'threshold', field: 'value', threshold: 10, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 }, // no cooldown
      );

      const first = engine.evaluate(makeContext({ value: 15 }));
      expect(first).toHaveLength(1);

      const second = engine.evaluate(makeContext({ value: 15 }));
      expect(second).toHaveLength(1);
    });
  });

  // ─── Max Firings ─────────────────────────────────────────────────────

  describe('Max Firings', () => {
    it('stops firing after max firings reached', () => {
      engine.createRule(
        'Limited', '', 'info',
        [{ type: 'threshold', field: 'value', threshold: 10, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0, maxFirings: 2 },
      );

      engine.evaluate(makeContext({ value: 15 }));
      engine.evaluate(makeContext({ value: 15 }));
      const third = engine.evaluate(makeContext({ value: 15 }));
      expect(third).toHaveLength(0);
    });
  });

  // ─── AND/OR Rule Logic ───────────────────────────────────────────────

  describe('Rule-level AND/OR', () => {
    it('AND requires all conditions', () => {
      engine.createRule(
        'Multi-AND', '', 'warning',
        [
          { type: 'threshold', field: 'quantity', threshold: 5, direction: 'below' },
          { type: 'comparison', field: 'status', operator: 'eq', value: 'active' },
        ],
        [{ type: 'notify' }],
        { cooldownMs: 0, conditionOperator: 'AND' },
      );

      const match = engine.evaluate(makeContext({ quantity: 3, status: 'active' }));
      expect(match).toHaveLength(1);

      const noMatch = engine.evaluate(makeContext({ quantity: 3, status: 'inactive' }));
      expect(noMatch).toHaveLength(0);
    });

    it('OR requires any condition', () => {
      engine.createRule(
        'Multi-OR', '', 'warning',
        [
          { type: 'threshold', field: 'quantity', threshold: 5, direction: 'below' },
          { type: 'comparison', field: 'status', operator: 'eq', value: 'inactive' },
        ],
        [{ type: 'notify' }],
        { cooldownMs: 0, conditionOperator: 'OR' },
      );

      // Only first condition met
      const match = engine.evaluate(makeContext({ quantity: 3, status: 'active' }));
      expect(match).toHaveLength(1);
    });
  });

  // ─── Alert Lifecycle ─────────────────────────────────────────────────

  describe('Alert Lifecycle', () => {
    beforeEach(() => {
      engine.createRule(
        'Test Alert', '', 'warning',
        [{ type: 'threshold', field: 'value', threshold: 10, direction: 'above' }],
        [{ type: 'notify', message: 'Value is {{value}}' }],
        { cooldownMs: 0 },
      );
    });

    it('creates active alerts', () => {
      const alerts = engine.evaluate(makeContext({ value: 15 }));
      expect(alerts[0].status).toBe('active');
      expect(alerts[0].severity).toBe('warning');
    });

    it('acknowledges alerts', () => {
      const alerts = engine.evaluate(makeContext({ value: 15 }));
      const ack = engine.acknowledgeAlert(alerts[0].id, 'dorrian');

      expect(ack).toBe(true);
      const alert = engine.getAlert(alerts[0].id);
      expect(alert!.status).toBe('acknowledged');
      expect(alert!.acknowledgedBy).toBe('dorrian');
    });

    it('resolves alerts', () => {
      const alerts = engine.evaluate(makeContext({ value: 15 }));
      engine.resolveAlert(alerts[0].id, 'dorrian');

      const alert = engine.getAlert(alerts[0].id);
      expect(alert!.status).toBe('resolved');
      expect(alert!.resolvedBy).toBe('dorrian');
    });

    it('silences alerts', () => {
      const alerts = engine.evaluate(makeContext({ value: 15 }));
      engine.silenceAlert(alerts[0].id, 60000);

      const alert = engine.getAlert(alerts[0].id);
      expect(alert!.status).toBe('silenced');
      expect(alert!.silencedUntil).toBeGreaterThan(Date.now());
    });

    it('cannot acknowledge resolved alerts', () => {
      const alerts = engine.evaluate(makeContext({ value: 15 }));
      engine.resolveAlert(alerts[0].id, 'dorrian');

      expect(engine.acknowledgeAlert(alerts[0].id, 'dorrian')).toBe(false);
    });

    it('bulk acknowledges alerts', () => {
      engine.evaluate(makeContext({ value: 15 }));
      engine.evaluate(makeContext({ value: 20 }));

      const active = engine.listAlerts({ status: 'active' });
      const count = engine.bulkAcknowledge(active.map(a => a.id), 'dorrian');
      expect(count).toBe(active.length);
    });

    it('bulk resolves alerts', () => {
      engine.evaluate(makeContext({ value: 15 }));
      engine.evaluate(makeContext({ value: 20 }));

      const all = engine.listAlerts();
      const count = engine.bulkResolve(all.map(a => a.id), 'dorrian');
      expect(count).toBe(all.length);
    });
  });

  // ─── Alert Listing & Filtering ───────────────────────────────────────

  describe('Alert Listing', () => {
    beforeEach(() => {
      engine.createRule('Warning', '', 'warning',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0, tags: ['tag-a'] },
      );
      engine.createRule('Critical', '', 'critical',
        [{ type: 'threshold', field: 'v', threshold: 10, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0, tags: ['tag-b'] },
      );

      engine.evaluate(makeContext({ v: 7 }));
      engine.evaluate(makeContext({ v: 15 }));
    });

    it('lists all alerts', () => {
      expect(engine.listAlerts().length).toBeGreaterThanOrEqual(2);
    });

    it('filters by severity', () => {
      const critical = engine.listAlerts({ severity: 'critical' });
      expect(critical.every(a => a.severity === 'critical')).toBe(true);
    });

    it('filters by status', () => {
      const active = engine.listAlerts({ status: 'active' });
      expect(active.every(a => a.status === 'active')).toBe(true);
    });

    it('filters by tags', () => {
      const tagged = engine.listAlerts({ tags: ['tag-a'] });
      expect(tagged.every(a => a.tags.includes('tag-a'))).toBe(true);
    });

    it('limits results', () => {
      const limited = engine.listAlerts({ limit: 1 });
      expect(limited).toHaveLength(1);
    });

    it('sorts by newest first', () => {
      const alerts = engine.listAlerts();
      for (let i = 1; i < alerts.length; i++) {
        expect(alerts[i - 1].createdAt).toBeGreaterThanOrEqual(alerts[i].createdAt);
      }
    });
  });

  // ─── Active Alert Count ──────────────────────────────────────────────

  describe('Active Alert Count', () => {
    it('counts active alerts by severity', () => {
      engine.createRule('W', '', 'warning',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );
      engine.createRule('C', '', 'critical',
        [{ type: 'threshold', field: 'v', threshold: 10, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      engine.evaluate(makeContext({ v: 7 }));
      engine.evaluate(makeContext({ v: 15 }));

      const count = engine.getActiveAlertCount();
      expect(count.total).toBeGreaterThanOrEqual(2);
      expect(count.bySeverity['warning']).toBeGreaterThanOrEqual(1);
      expect(count.bySeverity['critical']).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Actions ─────────────────────────────────────────────────────────

  describe('Actions', () => {
    it('emits voice action events', () => {
      const events: any[] = [];
      engine.on('action:voice', (e) => events.push(e));

      engine.createRule('Voice', '', 'warning',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'voice', voiceMessage: 'Alert: value is {{v}}', voicePriority: 'urgent' }],
        { cooldownMs: 0 },
      );

      engine.evaluate(makeContext({ v: 10 }));
      expect(events).toHaveLength(1);
      expect(events[0].message).toContain('10');
      expect(events[0].priority).toBe('urgent');
    });

    it('emits notify action events', () => {
      const events: any[] = [];
      engine.on('action:notify', (e) => events.push(e));

      engine.createRule('Notify', '', 'info',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'notify', message: 'Alert!', channels: ['push', 'email'] }],
        { cooldownMs: 0 },
      );

      engine.evaluate(makeContext({ v: 10 }));
      expect(events).toHaveLength(1);
      expect(events[0].channels).toEqual(['push', 'email']);
    });

    it('emits webhook action events', () => {
      const events: any[] = [];
      engine.on('action:webhook', (e) => events.push(e));

      engine.createRule('Webhook', '', 'info',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'webhook', webhookUrl: 'https://example.com/hook' }],
        { cooldownMs: 0 },
      );

      engine.evaluate(makeContext({ v: 10 }));
      expect(events).toHaveLength(1);
      expect(events[0].url).toBe('https://example.com/hook');
    });

    it('emits email action events', () => {
      const events: any[] = [];
      engine.on('action:email', (e) => events.push(e));

      engine.createRule('Email', '', 'info',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'email', emailTo: ['dorrian@example.com'], emailSubject: 'Alert: {{v}}' }],
        { cooldownMs: 0 },
      );

      engine.evaluate(makeContext({ v: 10 }));
      expect(events).toHaveLength(1);
      expect(events[0].to).toEqual(['dorrian@example.com']);
      expect(events[0].subject).toContain('10');
    });

    it('handles escalation action', () => {
      engine.createRule('Escalate', '', 'warning',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'escalate', escalateTo: 'critical' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ v: 10 }));
      expect(alerts[0].severity).toBe('critical');
      expect(alerts[0].escalatedTo).toBe('critical');
    });

    it('executes custom action handlers', () => {
      let customCalled = false;

      engine.createRule('Custom', '', 'info',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'custom', handler: () => { customCalled = true; } }],
        { cooldownMs: 0 },
      );

      engine.evaluate(makeContext({ v: 10 }));
      expect(customCalled).toBe(true);
    });

    it('executes multiple actions per rule', () => {
      const events: string[] = [];
      engine.on('action:voice', () => events.push('voice'));
      engine.on('action:notify', () => events.push('notify'));
      engine.on('action:log', () => events.push('log'));

      engine.createRule('Multi', '', 'warning',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [
          { type: 'voice', voiceMessage: 'Alert!' },
          { type: 'notify', message: 'Alert!' },
          { type: 'log', logCategory: 'test' },
        ],
        { cooldownMs: 0 },
      );

      engine.evaluate(makeContext({ v: 10 }));
      expect(events).toEqual(['voice', 'notify', 'log']);
    });
  });

  // ─── Message Interpolation ───────────────────────────────────────────

  describe('Message Interpolation', () => {
    it('interpolates context data into messages', () => {
      engine.createRule('Interpolate', '', 'warning',
        [{ type: 'threshold', field: 'quantity', threshold: 5, direction: 'below' }],
        [{ type: 'notify', message: 'Low stock: {{product}} has {{quantity}} units' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({
        quantity: 3,
        product: 'DeWalt Drill',
      }));
      expect(alerts[0].message).toBe('Low stock: DeWalt Drill has 3 units');
    });

    it('preserves unmatched placeholders', () => {
      engine.createRule('Unmatched', '', 'info',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'notify', message: 'Missing: {{nonexistent}}' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ v: 10 }));
      expect(alerts[0].message).toBe('Missing: {{nonexistent}}');
    });
  });

  // ─── Stats ───────────────────────────────────────────────────────────

  describe('Stats', () => {
    it('tracks comprehensive stats', () => {
      engine.createRule('R1', '', 'warning',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      engine.evaluate(makeContext({ v: 10 }));
      engine.evaluate(makeContext({ v: 15 }));

      const stats = engine.getStats();
      expect(stats.totalRules).toBe(1);
      expect(stats.enabledRules).toBe(1);
      expect(stats.totalAlerts).toBe(2);
      expect(stats.alertsLast24h).toBe(2);
      expect(stats.topFiringRules).toHaveLength(1);
      expect(stats.topFiringRules[0].count).toBe(2);
    });
  });

  // ─── Voice Summary ───────────────────────────────────────────────────

  describe('Voice Summary', () => {
    it('summarizes no active alerts', () => {
      const summary = engine.voiceSummary();
      expect(summary).toContain('No active alerts');
      expect(summary).toContain('All clear');
    });

    it('summarizes active alerts by severity', () => {
      engine.createRule('W', '', 'warning',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );
      engine.createRule('C', '', 'critical',
        [{ type: 'threshold', field: 'v', threshold: 10, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      engine.evaluate(makeContext({ v: 7 }));
      engine.evaluate(makeContext({ v: 15 }));

      const summary = engine.voiceSummary();
      expect(summary).toContain('active alert');
      expect(summary).toContain('critical');
      expect(summary).toContain('warning');
    });

    it('generates alert detail voice summary', () => {
      engine.createRule('Test', '', 'warning',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'notify', message: 'Value exceeded' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ v: 10 }));
      const detail = engine.voiceAlertDetail(alerts[0].id);

      expect(detail).toContain('warning');
      expect(detail).toContain('Test');
      expect(detail).toContain('just now');
    });

    it('handles unknown alert in voice detail', () => {
      expect(engine.voiceAlertDetail('nonexistent')).toContain('not found');
    });
  });

  // ─── Cleanup ─────────────────────────────────────────────────────────

  describe('Cleanup', () => {
    it('cleans up old resolved alerts', () => {
      engine.createRule('Test', '', 'info',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ v: 10 }));
      engine.resolveAlert(alerts[0].id, 'dorrian');

      // Manually set createdAt to old
      const alert = engine.getAlert(alerts[0].id)!;
      (alert as any).createdAt = Date.now() - 30 * 24 * 60 * 60 * 1000;

      const cleaned = engine.cleanupResolved(7 * 24 * 60 * 60 * 1000);
      expect(cleaned).toBe(1);
    });
  });

  // ─── Events ──────────────────────────────────────────────────────────

  describe('Events', () => {
    it('emits rule lifecycle events', () => {
      const events: string[] = [];
      engine.on('rule:created', () => events.push('created'));
      engine.on('rule:updated', () => events.push('updated'));
      engine.on('rule:deleted', () => events.push('deleted'));

      const rule = engine.createRule('Test', '', 'info', [], []);
      engine.updateRule(rule.id, { name: 'Updated' });
      engine.deleteRule(rule.id);

      expect(events).toEqual(['created', 'updated', 'deleted']);
    });

    it('emits alert lifecycle events', () => {
      const events: string[] = [];
      engine.on('alert:fired', () => events.push('fired'));
      engine.on('alert:acknowledged', () => events.push('acked'));
      engine.on('alert:resolved', () => events.push('resolved'));

      engine.createRule('Test', '', 'info',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      const alerts = engine.evaluate(makeContext({ v: 10 }));
      engine.acknowledgeAlert(alerts[0].id, 'user');
      engine.resolveAlert(alerts[0].id, 'user');

      expect(events).toEqual(['fired', 'acked', 'resolved']);
    });
  });

  // ─── Disabled Rules ──────────────────────────────────────────────────

  describe('Disabled Rules', () => {
    it('does not evaluate disabled rules', () => {
      const rule = engine.createRule('Test', '', 'info',
        [{ type: 'threshold', field: 'v', threshold: 5, direction: 'above' }],
        [{ type: 'notify' }],
        { cooldownMs: 0 },
      );

      engine.disableRule(rule.id);
      const alerts = engine.evaluate(makeContext({ v: 10 }));
      expect(alerts).toHaveLength(0);
    });
  });
});
