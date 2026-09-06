/**
 * Reconciliation Engine Tests
 * 🌙 Night Shift Agent — Shift #34
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ReconciliationEngine,
  ReconciliationItem,
  POSRecord,
  SessionSnapshot,
} from './reconciliation-engine';

describe('ReconciliationEngine', () => {
  let engine: ReconciliationEngine;

  beforeEach(() => {
    engine = new ReconciliationEngine();
  });

  // ─── Basic Reconciliation ──────────────────────────────────────────────────

  describe('reconcile()', () => {
    it('should identify matching items within threshold', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 100, countedQuantity: 99 },
        { sku: 'A2', name: 'Gadget', expectedQuantity: 50, countedQuantity: 50 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.summary.matchedSkus).toBe(2);
      expect(report.summary.matchRate).toBe(100);
    });

    it('should detect under-counted items', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 100, countedQuantity: 80 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.summary.underSkus).toBe(1);
      expect(report.variances[0].direction).toBe('under');
      expect(report.variances[0].variance).toBe(-20);
      expect(report.variances[0].variancePercent).toBe(-20);
    });

    it('should detect over-counted items', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 50, countedQuantity: 60 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.summary.overSkus).toBe(1);
      expect(report.variances[0].direction).toBe('over');
      expect(report.variances[0].variance).toBe(10);
    });

    it('should calculate variance percentage correctly', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 200, countedQuantity: 170 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].variancePercent).toBe(-15);
    });

    it('should handle zero expected quantity', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 0, countedQuantity: 5 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].direction).toBe('over');
      expect(report.variances[0].variancePercent).toBe(100);
    });

    it('should handle both zero expected and counted', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 0, countedQuantity: 0 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].direction).toBe('match');
    });

    it('should calculate value lost using unit cost', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 100, countedQuantity: 90, unitCost: 5.00 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].valueLost).toBe(50.00);
    });

    it('should calculate retail value using unit price', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 100, countedQuantity: 90, unitCost: 5.00, unitPrice: 9.99 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].valueLost).toBe(50.00);
      expect(report.variances[0].valueAtRetail).toBe(99.90);
    });

    it('should not assign value lost to over items', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 50, countedQuantity: 60, unitCost: 10.00 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].valueLost).toBe(0);
    });

    it('should sort variances by value lost descending', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Cheap', expectedQuantity: 100, countedQuantity: 90, unitCost: 1 },
        { sku: 'A2', name: 'Expensive', expectedQuantity: 100, countedQuantity: 90, unitCost: 50 },
        { sku: 'A3', name: 'Mid', expectedQuantity: 100, countedQuantity: 90, unitCost: 10 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].name).toBe('Expensive');
      expect(report.variances[1].name).toBe('Mid');
      expect(report.variances[2].name).toBe('Cheap');
    });

    it('should emit reconciliation:complete event', () => {
      const listener = vi.fn();
      engine.on('reconciliation:complete', listener);
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 100, countedQuantity: 100 },
      ];
      engine.reconcile('store-1', items);
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should emit reconciliation:alert for high-severity items', () => {
      const listener = vi.fn();
      engine.on('reconciliation:alert', listener);
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 100, countedQuantity: 50 }, // 50% shortage
      ];
      engine.reconcile('store-1', items);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].severity).toBe('high');
    });

    it('should not emit alert for low-severity items', () => {
      const listener = vi.fn();
      engine.on('reconciliation:alert', listener);
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 100, countedQuantity: 95 },
      ];
      engine.reconcile('store-1', items);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ─── Summary Calculation ───────────────────────────────────────────────────

  describe('summary', () => {
    it('should calculate total expected and counted', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W1', expectedQuantity: 100, countedQuantity: 90 },
        { sku: 'A2', name: 'W2', expectedQuantity: 50, countedQuantity: 55 },
        { sku: 'A3', name: 'W3', expectedQuantity: 75, countedQuantity: 75 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.summary.totalExpected).toBe(225);
      expect(report.summary.totalCounted).toBe(220);
      expect(report.summary.totalVariance).toBe(-5);
    });

    it('should calculate shrinkage rate correctly', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W1', expectedQuantity: 100, countedQuantity: 90 },
        { sku: 'A2', name: 'W2', expectedQuantity: 100, countedQuantity: 100 },
      ];
      const report = engine.reconcile('store-1', items);
      // 10 missing out of 200 total = 5%
      expect(report.summary.shrinkageRate).toBe(5);
    });

    it('should calculate total shrinkage value', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W1', expectedQuantity: 100, countedQuantity: 90, unitCost: 5 },
        { sku: 'A2', name: 'W2', expectedQuantity: 100, countedQuantity: 85, unitCost: 10 },
      ];
      const report = engine.reconcile('store-1', items);
      // (10 * 5) + (15 * 10) = 50 + 150 = 200
      expect(report.summary.totalShrinkageValue).toBe(200);
    });

    it('should count severity levels', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W1', expectedQuantity: 100, countedQuantity: 50 }, // 50% - high
        { sku: 'A2', name: 'W2', expectedQuantity: 100, countedQuantity: 85 }, // 15% - medium
        { sku: 'A3', name: 'W3', expectedQuantity: 100, countedQuantity: 95 }, // 5% - low
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.summary.highSeverityCount).toBe(1);
      expect(report.summary.mediumSeverityCount).toBe(1);
      expect(report.summary.lowSeverityCount).toBe(1);
    });
  });

  // ─── Shrinkage Classification ──────────────────────────────────────────────

  describe('shrinkage classification', () => {
    it('should classify high-theft categories as external theft', () => {
      const items: ReconciliationItem[] = [
        { sku: 'E1', name: 'AirPods', category: 'electronics', expectedQuantity: 20, countedQuantity: 15 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].shrinkageCategory).toBe('theft_external');
    });

    it('should classify backroom shortages as internal theft', () => {
      const items: ReconciliationItem[] = [
        { sku: 'B1', name: 'TV', location: 'backroom', expectedQuantity: 20, countedQuantity: 10 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].shrinkageCategory).toBe('theft_internal');
    });

    it('should classify overages as administrative error', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 50, countedQuantity: 60 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].shrinkageCategory).toBe('administrative_error');
    });

    it('should classify perishable shortages as expiration', () => {
      const items: ReconciliationItem[] = [
        { sku: 'P1', name: 'Milk', category: 'dairy', expectedQuantity: 50, countedQuantity: 40 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].shrinkageCategory).toBe('expiration');
    });

    it('should classify fragile items as damage', () => {
      const items: ReconciliationItem[] = [
        { sku: 'G1', name: 'Wine Bottle', category: 'wine', expectedQuantity: 24, countedQuantity: 20 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].shrinkageCategory).toBe('damage');
    });

    it('should provide shrinkage breakdown in report', () => {
      const items: ReconciliationItem[] = [
        { sku: 'E1', name: 'AirPods', category: 'electronics', expectedQuantity: 20, countedQuantity: 15, unitCost: 100 },
        { sku: 'P1', name: 'Milk', category: 'dairy', expectedQuantity: 50, countedQuantity: 40, unitCost: 3 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.shrinkageBreakdown.size).toBeGreaterThan(0);
      
      const theftSummary = report.shrinkageBreakdown.get('theft_external');
      expect(theftSummary).toBeDefined();
      expect(theftSummary!.totalValue).toBe(500); // 5 * $100
    });

    it('should allow custom classification categories', () => {
      engine.setClassificationCategories('theft', ['custom_category']);
      const items: ReconciliationItem[] = [
        { sku: 'C1', name: 'Custom', category: 'custom_category', expectedQuantity: 20, countedQuantity: 15 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].shrinkageCategory).toBe('theft_external');
    });

    it('should skip auto-categorization when disabled', () => {
      engine.updateConfig({ autoCategorize: false });
      const items: ReconciliationItem[] = [
        { sku: 'E1', name: 'AirPods', category: 'electronics', expectedQuantity: 20, countedQuantity: 15 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].shrinkageCategory).toBe('unknown');
    });
  });

  // ─── Flags ─────────────────────────────────────────────────────────────────

  describe('flags', () => {
    it('should flag high severity items', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 60 }, // 40%
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].flags).toContain('high_severity');
    });

    it('should flag medium severity items', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 85 }, // 15%
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].flags).toContain('medium_severity');
    });

    it('should flag complete stockouts', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 10, countedQuantity: 0 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].flags).toContain('complete_stockout');
    });

    it('should flag high value losses', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 95, unitCost: 50 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].flags).toContain('high_value_loss');
    });

    it('should flag major overages', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 10, countedQuantity: 30 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].flags).toContain('major_overage');
    });
  });

  // ─── Category & Location Breakdown ─────────────────────────────────────────

  describe('breakdowns', () => {
    it('should build category breakdown', () => {
      const items: ReconciliationItem[] = [
        { sku: 'E1', name: 'TV', category: 'electronics', expectedQuantity: 10, countedQuantity: 8, unitCost: 200 },
        { sku: 'E2', name: 'Phone', category: 'electronics', expectedQuantity: 20, countedQuantity: 18, unitCost: 500 },
        { sku: 'F1', name: 'Bread', category: 'bakery', expectedQuantity: 50, countedQuantity: 45, unitCost: 2 },
      ];
      const report = engine.reconcile('store-1', items);
      const electronics = report.categoryBreakdown.get('electronics');
      expect(electronics).toBeDefined();
      expect(electronics!.totalSkus).toBe(2);
      expect(electronics!.shrinkageValue).toBe(1400); // (2*200) + (2*500)
    });

    it('should build location breakdown', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W1', location: 'aisle-1', expectedQuantity: 100, countedQuantity: 90, unitCost: 5 },
        { sku: 'A2', name: 'W2', location: 'aisle-1', expectedQuantity: 50, countedQuantity: 45, unitCost: 10 },
        { sku: 'A3', name: 'W3', location: 'aisle-2', expectedQuantity: 75, countedQuantity: 75 },
      ];
      const report = engine.reconcile('store-1', items);
      const aisle1 = report.locationBreakdown.get('aisle-1');
      expect(aisle1).toBeDefined();
      expect(aisle1!.totalSkus).toBe(2);
      expect(aisle1!.shrinkageValue).toBe(100); // (10*5) + (5*10)
    });

    it('should handle items without category/location', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W1', expectedQuantity: 100, countedQuantity: 90 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.categoryBreakdown.has('uncategorized')).toBe(true);
      expect(report.locationBreakdown.has('unknown')).toBe(true);
    });
  });

  // ─── POS Reconciliation ────────────────────────────────────────────────────

  describe('reconcileWithPOS()', () => {
    it('should calculate expected from POS data', () => {
      const counted = new Map([
        ['SKU-1', { quantity: 85, name: 'Widget' }],
      ]);
      const posData = new Map<string, POSRecord>([
        ['SKU-1', {
          sku: 'SKU-1',
          name: 'Widget',
          quantitySold: 15,
          quantityReceived: 10,
          quantityReturned: 2,
          quantityTransferred: 0,
          periodStart: Date.now() - 86400000,
          periodEnd: Date.now(),
        }],
      ]);
      const previousCount = new Map([['SKU-1', 100]]);
      
      const report = engine.reconcileWithPOS('store-1', counted, posData, previousCount);
      // Expected = 100 + 10 - 15 + 2 - 0 = 97
      const v = report.variances.find(v => v.sku === 'SKU-1')!;
      expect(v.expected).toBe(97);
      expect(v.counted).toBe(85);
      expect(v.variance).toBe(-12);
    });

    it('should handle items only in POS (not counted)', () => {
      const counted = new Map<string, { quantity: number; name: string }>();
      const posData = new Map<string, POSRecord>([
        ['SKU-1', {
          sku: 'SKU-1',
          name: 'Widget',
          quantitySold: 5,
          quantityReceived: 20,
          quantityReturned: 0,
          quantityTransferred: 0,
          periodStart: Date.now() - 86400000,
          periodEnd: Date.now(),
        }],
      ]);
      const previousCount = new Map([['SKU-1', 10]]);
      
      const report = engine.reconcileWithPOS('store-1', counted, posData, previousCount);
      const v = report.variances.find(v => v.sku === 'SKU-1')!;
      expect(v.expected).toBe(25); // 10 + 20 - 5
      expect(v.counted).toBe(0);
    });

    it('should handle items only counted (not in POS)', () => {
      const counted = new Map([
        ['SKU-NEW', { quantity: 10, name: 'New Item' }],
      ]);
      const posData = new Map<string, POSRecord>();
      
      const report = engine.reconcileWithPOS('store-1', counted, posData);
      const v = report.variances.find(v => v.sku === 'SKU-NEW')!;
      expect(v.expected).toBe(0);
      expect(v.counted).toBe(10);
    });

    it('should not allow negative expected quantities', () => {
      const counted = new Map([
        ['SKU-1', { quantity: 5, name: 'Widget' }],
      ]);
      const posData = new Map<string, POSRecord>([
        ['SKU-1', {
          sku: 'SKU-1',
          name: 'Widget',
          quantitySold: 100,
          quantityReceived: 0,
          quantityReturned: 0,
          quantityTransferred: 0,
          periodStart: Date.now() - 86400000,
          periodEnd: Date.now(),
        }],
      ]);
      const previousCount = new Map([['SKU-1', 50]]);
      
      const report = engine.reconcileWithPOS('store-1', counted, posData, previousCount);
      const v = report.variances.find(v => v.sku === 'SKU-1')!;
      expect(v.expected).toBe(0); // max(0, 50 - 100) = 0
    });
  });

  // ─── Snapshot Reconciliation ───────────────────────────────────────────────

  describe('reconcileSnapshots()', () => {
    it('should compare two session snapshots', () => {
      const previous: SessionSnapshot = {
        sessionId: 'session-1',
        storeId: 'store-1',
        timestamp: Date.now() - 86400000,
        items: new Map([
          ['SKU-1', { quantity: 100, confidence: 0.9 }],
          ['SKU-2', { quantity: 50, confidence: 0.8 }],
        ]),
      };
      const current: SessionSnapshot = {
        sessionId: 'session-2',
        storeId: 'store-1',
        timestamp: Date.now(),
        items: new Map([
          ['SKU-1', { quantity: 90, confidence: 0.95 }],
          ['SKU-2', { quantity: 52, confidence: 0.85 }],
        ]),
      };
      
      const report = engine.reconcileSnapshots(current, previous);
      expect(report.variances).toHaveLength(2);
      
      const sku1 = report.variances.find(v => v.sku === 'SKU-1')!;
      expect(sku1.expected).toBe(100);
      expect(sku1.counted).toBe(90);
    });

    it('should detect items only in current snapshot', () => {
      const previous: SessionSnapshot = {
        sessionId: 'session-1',
        storeId: 'store-1',
        timestamp: Date.now() - 86400000,
        items: new Map([['SKU-1', { quantity: 100, confidence: 0.9 }]]),
      };
      const current: SessionSnapshot = {
        sessionId: 'session-2',
        storeId: 'store-1',
        timestamp: Date.now(),
        items: new Map([
          ['SKU-1', { quantity: 90, confidence: 0.9 }],
          ['SKU-NEW', { quantity: 20, confidence: 0.9 }],
        ]),
      };
      
      const report = engine.reconcileSnapshots(current, previous);
      const newItem = report.variances.find(v => v.sku === 'SKU-NEW')!;
      expect(newItem.expected).toBe(0);
      expect(newItem.counted).toBe(20);
    });

    it('should detect items missing from current snapshot', () => {
      const previous: SessionSnapshot = {
        sessionId: 'session-1',
        storeId: 'store-1',
        timestamp: Date.now() - 86400000,
        items: new Map([
          ['SKU-1', { quantity: 100, confidence: 0.9 }],
          ['SKU-GONE', { quantity: 30, confidence: 0.9 }],
        ]),
      };
      const current: SessionSnapshot = {
        sessionId: 'session-2',
        storeId: 'store-1',
        timestamp: Date.now(),
        items: new Map([['SKU-1', { quantity: 90, confidence: 0.9 }]]),
      };
      
      const report = engine.reconcileSnapshots(current, previous);
      const gone = report.variances.find(v => v.sku === 'SKU-GONE')!;
      expect(gone.expected).toBe(30);
      expect(gone.counted).toBe(0);
    });

    it('should skip low-confidence items', () => {
      engine.updateConfig({ minCountConfidence: 0.7 });
      const previous: SessionSnapshot = {
        sessionId: 's1',
        storeId: 'store-1',
        timestamp: Date.now() - 86400000,
        items: new Map([['SKU-1', { quantity: 100, confidence: 0.5 }]]),
      };
      const current: SessionSnapshot = {
        sessionId: 's2',
        storeId: 'store-1',
        timestamp: Date.now(),
        items: new Map([['SKU-1', { quantity: 80, confidence: 0.9 }]]),
      };
      
      const report = engine.reconcileSnapshots(current, previous);
      // Previous item should be skipped due to low confidence
      expect(report.variances).toHaveLength(0);
    });
  });

  // ─── Snapshot Management ───────────────────────────────────────────────────

  describe('snapshot management', () => {
    it('should store and retrieve snapshots', () => {
      const snapshot: SessionSnapshot = {
        sessionId: 's1',
        storeId: 'store-1',
        timestamp: Date.now(),
        items: new Map(),
      };
      engine.addSnapshot(snapshot);
      expect(engine.getSnapshots('store-1')).toHaveLength(1);
    });

    it('should sort snapshots by timestamp', () => {
      engine.addSnapshot({
        sessionId: 's2',
        storeId: 'store-1',
        timestamp: 2000,
        items: new Map(),
      });
      engine.addSnapshot({
        sessionId: 's1',
        storeId: 'store-1',
        timestamp: 1000,
        items: new Map(),
      });
      const snaps = engine.getSnapshots('store-1');
      expect(snaps[0].sessionId).toBe('s1');
      expect(snaps[1].sessionId).toBe('s2');
    });

    it('should get latest snapshot', () => {
      engine.addSnapshot({
        sessionId: 's1',
        storeId: 'store-1',
        timestamp: 1000,
        items: new Map(),
      });
      engine.addSnapshot({
        sessionId: 's2',
        storeId: 'store-1',
        timestamp: 2000,
        items: new Map(),
      });
      const latest = engine.getLatestSnapshot('store-1');
      expect(latest?.sessionId).toBe('s2');
    });

    it('should return null for missing store', () => {
      expect(engine.getLatestSnapshot('nonexistent')).toBeNull();
    });

    it('should clear snapshots', () => {
      engine.addSnapshot({
        sessionId: 's1',
        storeId: 'store-1',
        timestamp: 1000,
        items: new Map(),
      });
      engine.clearSnapshots('store-1');
      expect(engine.getSnapshots('store-1')).toHaveLength(0);
    });
  });

  // ─── Report Management ─────────────────────────────────────────────────────

  describe('report management', () => {
    it('should store reports', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 100 },
      ];
      engine.reconcile('store-1', items);
      expect(engine.getReports()).toHaveLength(1);
    });

    it('should filter reports by store', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 100 },
      ];
      engine.reconcile('store-1', items);
      engine.reconcile('store-2', items);
      expect(engine.getReports('store-1')).toHaveLength(1);
      expect(engine.getReports('store-2')).toHaveLength(1);
    });

    it('should get latest report for store', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 100 },
      ];
      engine.reconcile('store-1', items);
      const report = engine.getLatestReport('store-1');
      expect(report).not.toBeNull();
    });

    it('should return null when no reports exist', () => {
      expect(engine.getLatestReport('store-1')).toBeNull();
    });

    it('should enforce max report history', () => {
      engine.updateConfig({ maxReportHistory: 3 });
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 100 },
      ];
      for (let i = 0; i < 5; i++) {
        engine.reconcile('store-1', items);
      }
      expect(engine.getReports().length).toBeLessThanOrEqual(3);
    });

    it('should clear reports', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 100 },
      ];
      engine.reconcile('store-1', items);
      engine.clearReports();
      expect(engine.getReports()).toHaveLength(0);
    });
  });

  // ─── Trend Analysis ────────────────────────────────────────────────────────

  describe('analyzeTrend()', () => {
    it('should return insufficient_data for less than 2 reports', () => {
      const result = engine.analyzeTrend('store-1');
      expect(result.shrinkageTrend).toBe('insufficient_data');
    });

    it('should return insufficient_data with single report', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 90, unitCost: 5 },
      ];
      engine.reconcile('store-1', items);
      const result = engine.analyzeTrend('store-1');
      expect(result.shrinkageTrend).toBe('insufficient_data');
      expect(result.reports).toBe(1);
    });

    it('should detect worsening trend', () => {
      // Create reports with increasing shrinkage
      for (let i = 0; i < 4; i++) {
        const items: ReconciliationItem[] = [
          { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 100 - (i * 10) - 5 },
        ];
        engine.reconcile('store-1', items);
      }
      const result = engine.analyzeTrend('store-1');
      expect(result.shrinkageTrend).toBe('worsening');
    });

    it('should detect improving trend', () => {
      // Create reports with decreasing shrinkage
      for (let i = 0; i < 4; i++) {
        const items: ReconciliationItem[] = [
          { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 60 + (i * 10) },
        ];
        engine.reconcile('store-1', items);
      }
      const result = engine.analyzeTrend('store-1');
      expect(result.shrinkageTrend).toBe('improving');
    });

    it('should track total loss across reports', () => {
      for (let i = 0; i < 3; i++) {
        const items: ReconciliationItem[] = [
          { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 90, unitCost: 10 },
        ];
        engine.reconcile('store-1', items);
      }
      const result = engine.analyzeTrend('store-1');
      expect(result.totalLoss).toBe(300); // 3 reports * $100 each
    });

    it('should find worst category', () => {
      const items: ReconciliationItem[] = [
        { sku: 'E1', name: 'TV', category: 'electronics', expectedQuantity: 10, countedQuantity: 5, unitCost: 200 },
        { sku: 'F1', name: 'Bread', category: 'bakery', expectedQuantity: 50, countedQuantity: 45, unitCost: 2 },
      ];
      engine.reconcile('store-1', items);
      engine.reconcile('store-1', items);
      const result = engine.analyzeTrend('store-1');
      expect(result.worstCategory).toBe('electronics');
    });
  });

  // ─── Configuration ─────────────────────────────────────────────────────────

  describe('configuration', () => {
    it('should use custom match threshold', () => {
      engine.updateConfig({ matchThreshold: 5 });
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 96 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].direction).toBe('match');
    });

    it('should use custom severity thresholds', () => {
      engine.updateConfig({ highSeverityThreshold: 30, mediumSeverityThreshold: 15 });
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 75 }, // 25% - now medium, not high
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].flags).toContain('medium_severity');
      expect(report.variances[0].flags).not.toContain('high_severity');
    });

    it('should return current config', () => {
      const config = engine.getConfig();
      expect(config.matchThreshold).toBe(2);
      expect(config.highSeverityThreshold).toBe(20);
    });
  });

  // ─── Recommendations ──────────────────────────────────────────────────────

  describe('recommendations', () => {
    it('should recommend investigation for high shrinkage', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 80 },
        { sku: 'A2', name: 'X', expectedQuantity: 100, countedQuantity: 85 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations.some(r => r.includes('hrinkage rate'))).toBe(true);
    });

    it('should flag complete stockouts', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 10, countedQuantity: 0 },
        { sku: 'A2', name: 'X', expectedQuantity: 100, countedQuantity: 100 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.recommendations.some(r => r.includes('stockout'))).toBe(true);
    });

    it('should recommend recount for low-confidence items', () => {
      // Low confidence happens when expected quantity is very small
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 5, countedQuantity: 3 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.recommendations.some(r => r.includes('recount') || r.includes('confidence'))).toBe(true);
    });
  });

  // ─── Voice Summary ─────────────────────────────────────────────────────────

  describe('generateVoiceSummary()', () => {
    it('should generate positive summary for good match', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 100 },
        { sku: 'A2', name: 'X', expectedQuantity: 50, countedQuantity: 50 },
      ];
      const report = engine.reconcile('store-1', items);
      const summary = engine.generateVoiceSummary(report);
      expect(summary).toContain('Looking good');
      expect(summary).toContain('100%');
    });

    it('should generate alert summary for high shrinkage', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', expectedQuantity: 100, countedQuantity: 80, unitCost: 10 },
      ];
      const report = engine.reconcile('store-1', items);
      const summary = engine.generateVoiceSummary(report);
      expect(summary).toContain('Attention');
      expect(summary).toContain('Widget');
      expect(summary).toContain('short');
    });

    it('should include value estimates', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 50, unitCost: 20 },
      ];
      const report = engine.reconcile('store-1', items);
      const summary = engine.generateVoiceSummary(report);
      expect(summary).toContain('$1000');
    });

    it('should limit top discrepancies in voice', () => {
      engine.updateConfig({ voiceSummaryMaxItems: 2 });
      const items: ReconciliationItem[] = [];
      for (let i = 0; i < 10; i++) {
        items.push({
          sku: `A${i}`,
          name: `Item${i}`,
          expectedQuantity: 100,
          countedQuantity: 80,
          unitCost: i + 1,
        });
      }
      const report = engine.reconcile('store-1', items);
      const summary = engine.generateVoiceSummary(report);
      // Should mention "Top discrepancies" but not list all 10
      const mentionedItems = items.filter(i => summary.includes(i.name)).length;
      expect(mentionedItems).toBeLessThanOrEqual(2);
    });
  });

  // ─── Markdown Report ───────────────────────────────────────────────────────

  describe('generateMarkdownReport()', () => {
    it('should generate valid markdown', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'Widget', category: 'electronics', expectedQuantity: 100, countedQuantity: 90, unitCost: 10 },
        { sku: 'A2', name: 'Gadget', expectedQuantity: 50, countedQuantity: 50 },
      ];
      const report = engine.reconcile('store-1', items);
      const md = engine.generateMarkdownReport(report);
      expect(md).toContain('# Inventory Reconciliation Report');
      expect(md).toContain('store-1');
      expect(md).toContain('Widget');
      expect(md).toContain('Shrinkage Rate');
    });

    it('should include shrinkage breakdown', () => {
      const items: ReconciliationItem[] = [
        { sku: 'E1', name: 'TV', category: 'electronics', expectedQuantity: 10, countedQuantity: 5, unitCost: 200 },
      ];
      const report = engine.reconcile('store-1', items);
      const md = engine.generateMarkdownReport(report);
      expect(md).toContain('Shrinkage Breakdown');
      expect(md).toContain('External Theft');
    });

    it('should include recommendations', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 50, unitCost: 50 },
      ];
      const report = engine.reconcile('store-1', items);
      const md = engine.generateMarkdownReport(report);
      expect(md).toContain('Recommendations');
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty items array', () => {
      const report = engine.reconcile('store-1', []);
      expect(report.summary.totalSkus).toBe(0);
      expect(report.summary.matchRate).toBe(100);
    });

    it('should handle single item', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 100 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.summary.totalSkus).toBe(1);
      expect(report.summary.matchedSkus).toBe(1);
    });

    it('should handle large variance correctly', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 1, countedQuantity: 1000 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].direction).toBe('over');
    });

    it('should handle very small expected quantities', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 1, countedQuantity: 0 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].variancePercent).toBe(-100);
    });

    it('should handle items with no cost', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 50 },
      ];
      const report = engine.reconcile('store-1', items);
      expect(report.variances[0].valueLost).toBe(0);
    });

    it('should generate unique report IDs', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 100 },
      ];
      const r1 = engine.reconcile('store-1', items);
      const r2 = engine.reconcile('store-1', items);
      expect(r1.id).not.toBe(r2.id);
    });

    it('should handle multiple stores independently', () => {
      const items: ReconciliationItem[] = [
        { sku: 'A1', name: 'W', expectedQuantity: 100, countedQuantity: 90 },
      ];
      engine.reconcile('store-1', items);
      engine.reconcile('store-2', items);
      
      expect(engine.getReports('store-1')).toHaveLength(1);
      expect(engine.getReports('store-2')).toHaveLength(1);
      expect(engine.getReports()).toHaveLength(2);
    });
  });
});
