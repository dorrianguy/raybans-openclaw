/**
 * Tests for Multi-Store Comparison Engine
 * 🌙 Night Shift Agent — 2026-03-07
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  StoreComparisonEngine,
  StoreSnapshot,
  ComparisonItem,
  ComparisonConfig,
} from './store-comparison';

// ─── Helpers ────────────────────────────────────────────────────

function makeItem(overrides: Partial<ComparisonItem> = {}): ComparisonItem {
  return {
    sku: 'SKU-001',
    name: 'Test Product',
    quantity: 10,
    sessionId: 'session-1',
    storeId: 'store-A',
    capturedAt: '2026-03-07T10:00:00Z',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<StoreSnapshot> & { items?: ComparisonItem[] } = {}): StoreSnapshot {
  return {
    storeId: 'store-A',
    storeName: 'Store Alpha',
    sessionId: 'session-1',
    capturedAt: '2026-03-07T10:00:00Z',
    items: [],
    ...overrides,
  };
}

function createTwoStoreEngine(): StoreComparisonEngine {
  const engine = new StoreComparisonEngine();

  engine.addSnapshot(makeSnapshot({
    storeId: 'store-A',
    storeName: 'Store Alpha',
    sessionId: 'session-A',
    items: [
      makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 24, price: 1.99, category: 'Beverages', storeId: 'store-A' }),
      makeItem({ sku: 'SKU-002', name: 'Chips', quantity: 15, price: 3.49, category: 'Snacks', storeId: 'store-A' }),
      makeItem({ sku: 'SKU-003', name: 'Bread', quantity: 8, price: 2.99, category: 'Bakery', storeId: 'store-A' }),
      makeItem({ sku: 'SKU-004', name: 'Milk', quantity: 12, price: 4.49, category: 'Dairy', storeId: 'store-A' }),
    ],
  }));

  engine.addSnapshot(makeSnapshot({
    storeId: 'store-B',
    storeName: 'Store Beta',
    sessionId: 'session-B',
    items: [
      makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 20, price: 2.29, category: 'Beverages', storeId: 'store-B' }),
      makeItem({ sku: 'SKU-002', name: 'Chips', quantity: 18, price: 3.49, category: 'Snacks', storeId: 'store-B' }),
      makeItem({ sku: 'SKU-005', name: 'Yogurt', quantity: 30, price: 5.99, category: 'Dairy', storeId: 'store-B' }),
    ],
  }));

  return engine;
}

// ─── Snapshot Management ────────────────────────────────────────

describe('StoreComparisonEngine — Snapshot Management', () => {
  it('should add and retrieve snapshots', () => {
    const engine = new StoreComparisonEngine();
    engine.addSnapshot(makeSnapshot({ storeId: 'store-A', storeName: 'Store A' }));

    const snapshots = engine.getSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].storeId).toBe('store-A');
  });

  it('should replace snapshot for same storeId', () => {
    const engine = new StoreComparisonEngine();
    engine.addSnapshot(makeSnapshot({ storeId: 'store-A', storeName: 'Old Name' }));
    engine.addSnapshot(makeSnapshot({ storeId: 'store-A', storeName: 'New Name' }));

    const snapshots = engine.getSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].storeName).toBe('New Name');
  });

  it('should remove a snapshot', () => {
    const engine = new StoreComparisonEngine();
    engine.addSnapshot(makeSnapshot({ storeId: 'store-A' }));

    expect(engine.removeSnapshot('store-A')).toBe(true);
    expect(engine.getSnapshots()).toHaveLength(0);
  });

  it('should return false when removing nonexistent snapshot', () => {
    const engine = new StoreComparisonEngine();
    expect(engine.removeSnapshot('nonexistent')).toBe(false);
  });

  it('should clear all snapshots', () => {
    const engine = new StoreComparisonEngine();
    engine.addSnapshot(makeSnapshot({ storeId: 'store-A' }));
    engine.addSnapshot(makeSnapshot({ storeId: 'store-B' }));

    engine.clearSnapshots();
    expect(engine.getSnapshotCount()).toBe(0);
  });

  it('should count snapshots', () => {
    const engine = new StoreComparisonEngine();
    expect(engine.getSnapshotCount()).toBe(0);

    engine.addSnapshot(makeSnapshot({ storeId: 'store-A' }));
    expect(engine.getSnapshotCount()).toBe(1);

    engine.addSnapshot(makeSnapshot({ storeId: 'store-B' }));
    expect(engine.getSnapshotCount()).toBe(2);
  });
});

// ─── Variance Detection ────────────────────────────────────────

describe('StoreComparisonEngine — Variance Detection', () => {
  it('should detect missing products (exclusive in 2-store setup)', () => {
    const engine = createTwoStoreEngine();
    const variances = engine.detectVariances();

    // With only 2 stores, items at one store only are "exclusive_product"
    const exclusive = variances.filter(v => v.type === 'exclusive_product');
    // Bread, Milk (Store A only), Yogurt (Store B only) = 3
    expect(exclusive.length).toBeGreaterThanOrEqual(3);

    const breadExclusive = exclusive.find(v => v.productName === 'Bread');
    expect(breadExclusive).toBeDefined();
  });

  it('should detect missing_at_store in 3-store setup', () => {
    const engine = new StoreComparisonEngine();

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A', storeName: 'Store A',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 10, storeId: 'store-A' })],
    }));
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-B', storeName: 'Store B',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 10, storeId: 'store-B' })],
    }));
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-C', storeName: 'Store C',
      items: [], // Missing Cola
    }));

    const variances = engine.detectVariances();
    const missing = variances.filter(v => v.type === 'missing_at_store');
    expect(missing.length).toBeGreaterThanOrEqual(1);
    expect(missing[0].storeIds).toContain('store-C');
  });

  it('should detect exclusive products', () => {
    const engine = createTwoStoreEngine();
    const variances = engine.detectVariances();

    const exclusive = variances.filter(v => v.type === 'exclusive_product');
    // Yogurt only at Store Beta
    const yogurt = exclusive.find(v => v.productName === 'Yogurt');
    expect(yogurt).toBeDefined();
  });

  it('should detect price differences', () => {
    const engine = createTwoStoreEngine();
    const variances = engine.detectVariances();

    const priceVars = variances.filter(v => v.type === 'price_difference');
    // Cola: $1.99 vs $2.29 = ~14% spread (above 10% default threshold)
    const cola = priceVars.find(v => v.productName === 'Cola');
    expect(cola).toBeDefined();
    expect(cola?.severity).toBe('warning');
  });

  it('should not flag small price differences', () => {
    const engine = new StoreComparisonEngine();

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A',
      storeName: 'Store A',
      items: [makeItem({ sku: 'SKU-001', name: 'Chips', price: 3.49, storeId: 'store-A' })],
    }));

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-B',
      storeName: 'Store B',
      items: [makeItem({ sku: 'SKU-001', name: 'Chips', price: 3.49, storeId: 'store-B' })],
    }));

    const variances = engine.detectVariances();
    const priceVars = variances.filter(v => v.type === 'price_difference');
    expect(priceVars).toHaveLength(0);
  });

  it('should detect understocked items', () => {
    const engine = new StoreComparisonEngine({
      quantityVarianceThresholdPercent: 20,
      understockMultiplier: 0.3,
    });

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A',
      storeName: 'Store A',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 100, storeId: 'store-A' })],
    }));

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-B',
      storeName: 'Store B',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 5, storeId: 'store-B' })],
    }));

    const variances = engine.detectVariances();
    const understocked = variances.filter(v => v.type === 'understocked');
    expect(understocked).toHaveLength(1);
    expect(understocked[0].severity).toBe('critical');
    expect(understocked[0].storeNames[0]).toBe('Store B');
  });

  it('should detect overstocked items', () => {
    const engine = new StoreComparisonEngine({
      quantityVarianceThresholdPercent: 20,
      overstockMultiplier: 2.0,
    });

    // Need 3 stores so one is clearly above 2x average
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A',
      storeName: 'Store A',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 10, storeId: 'store-A' })],
    }));

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-B',
      storeName: 'Store B',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 10, storeId: 'store-B' })],
    }));

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-C',
      storeName: 'Store C',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 100, storeId: 'store-C' })],
    }));

    const variances = engine.detectVariances();
    const overstocked = variances.filter(v => v.type === 'overstocked');
    expect(overstocked.length).toBeGreaterThanOrEqual(1);
    expect(overstocked.some(v => v.storeNames.includes('Store C'))).toBe(true);
  });

  it('should detect category gaps', () => {
    const engine = createTwoStoreEngine();
    const variances = engine.detectVariances();

    const categoryGaps = variances.filter(v => v.type === 'category_gap');
    // Bakery only at Store Alpha
    const bakeryGap = categoryGaps.find(v => v.category === 'Bakery');
    expect(bakeryGap).toBeDefined();
    expect(bakeryGap?.storeIds).toContain('store-B');
  });

  it('should return empty variances with fewer than 2 stores', () => {
    const engine = new StoreComparisonEngine();
    engine.addSnapshot(makeSnapshot({ storeId: 'store-A' }));

    const variances = engine.detectVariances();
    expect(variances).toHaveLength(0);
  });

  it('should include suggestions for variances', () => {
    const engine = createTwoStoreEngine();
    const variances = engine.detectVariances();

    const withSuggestions = variances.filter(v => v.suggestion);
    expect(withSuggestions.length).toBeGreaterThan(0);
  });
});

// ─── Price Comparison ───────────────────────────────────────────

describe('StoreComparisonEngine — Price Comparison', () => {
  it('should compare prices across stores', () => {
    const engine = createTwoStoreEngine();
    const comparisons = engine.comparePrices();

    // Cola and Chips are at both stores with prices
    expect(comparisons.length).toBeGreaterThanOrEqual(1);
  });

  it('should identify lowest and highest price stores', () => {
    const engine = createTwoStoreEngine();
    const comparisons = engine.comparePrices();

    const cola = comparisons.find(c => c.productName === 'Cola');
    if (cola) {
      expect(cola.lowestPrice).toBe(1.99);
      expect(cola.lowestPriceStore).toBe('store-A');
      expect(cola.highestPrice).toBe(2.29);
      expect(cola.highestPriceStore).toBe('store-B');
    }
  });

  it('should calculate price spread', () => {
    const engine = createTwoStoreEngine();
    const comparisons = engine.comparePrices();

    const cola = comparisons.find(c => c.productName === 'Cola');
    if (cola) {
      expect(cola.spread).toBeCloseTo(0.30, 1);
      expect(cola.spreadPercent).toBeGreaterThan(0);
    }
  });

  it('should sort by spread percentage (biggest first)', () => {
    const engine = createTwoStoreEngine();
    const comparisons = engine.comparePrices();

    for (let i = 1; i < comparisons.length; i++) {
      expect(comparisons[i].spreadPercent).toBeLessThanOrEqual(comparisons[i - 1].spreadPercent);
    }
  });

  it('should skip products without prices at multiple stores', () => {
    const engine = new StoreComparisonEngine();

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A',
      storeName: 'Store A',
      items: [makeItem({ sku: 'SKU-001', name: 'Thing', price: 9.99, storeId: 'store-A' })],
    }));

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-B',
      storeName: 'Store B',
      items: [makeItem({ sku: 'SKU-001', name: 'Thing', storeId: 'store-B' })], // no price
    }));

    const comparisons = engine.comparePrices();
    expect(comparisons).toHaveLength(0);
  });

  it('should handle three stores', () => {
    const engine = new StoreComparisonEngine();

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A', storeName: 'A',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', price: 1.99, storeId: 'store-A' })],
    }));
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-B', storeName: 'B',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', price: 2.49, storeId: 'store-B' })],
    }));
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-C', storeName: 'C',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', price: 1.79, storeId: 'store-C' })],
    }));

    const comparisons = engine.comparePrices();
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].lowestPrice).toBe(1.79);
    expect(comparisons[0].highestPrice).toBe(2.49);
    expect(Object.keys(comparisons[0].priceByStore)).toHaveLength(3);
  });
});

// ─── Availability Matrix ────────────────────────────────────────

describe('StoreComparisonEngine — Availability Matrix', () => {
  it('should build availability matrix', () => {
    const engine = createTwoStoreEngine();
    const matrix = engine.buildAvailabilityMatrix();

    expect(matrix.length).toBeGreaterThan(0);
  });

  it('should show 100% for products at all stores', () => {
    const engine = createTwoStoreEngine();
    const matrix = engine.buildAvailabilityMatrix();

    const cola = matrix.find(m => m.productName === 'Cola');
    expect(cola?.availabilityPercent).toBe(100);
    expect(cola?.storeCount).toBe(2);
  });

  it('should show 50% for products at one of two stores', () => {
    const engine = createTwoStoreEngine();
    const matrix = engine.buildAvailabilityMatrix();

    const bread = matrix.find(m => m.productName === 'Bread');
    expect(bread?.availabilityPercent).toBe(50);
    expect(bread?.storeCount).toBe(1);
  });

  it('should track quantities per store', () => {
    const engine = createTwoStoreEngine();
    const matrix = engine.buildAvailabilityMatrix();

    const cola = matrix.find(m => m.productName === 'Cola');
    expect(cola?.quantityAt['store-A']).toBe(24);
    expect(cola?.quantityAt['store-B']).toBe(20);
  });

  it('should sort by availability (least available first)', () => {
    const engine = createTwoStoreEngine();
    const matrix = engine.buildAvailabilityMatrix();

    for (let i = 1; i < matrix.length; i++) {
      expect(matrix[i].availabilityPercent).toBeGreaterThanOrEqual(matrix[i - 1].availabilityPercent);
    }
  });

  it('should show 0 quantity for missing stores', () => {
    const engine = createTwoStoreEngine();
    const matrix = engine.buildAvailabilityMatrix();

    const bread = matrix.find(m => m.productName === 'Bread');
    expect(bread?.quantityAt['store-B']).toBe(0);
    expect(bread?.availableAt['store-B']).toBe(false);
  });
});

// ─── Category Breakdown ────────────────────────────────────────

describe('StoreComparisonEngine — Category Breakdown', () => {
  it('should compare categories across stores', () => {
    const engine = createTwoStoreEngine();
    const breakdown = engine.compareCategoryBreakdown();

    expect(breakdown.length).toBeGreaterThan(0);
  });

  it('should count products per category per store', () => {
    const engine = createTwoStoreEngine();
    const breakdown = engine.compareCategoryBreakdown();

    const beverages = breakdown.find(c => c.category === 'Beverages');
    expect(beverages?.productCountByStore['store-A']).toBe(1);
    expect(beverages?.productCountByStore['store-B']).toBe(1);
  });

  it('should track total quantity per category per store', () => {
    const engine = createTwoStoreEngine();
    const breakdown = engine.compareCategoryBreakdown();

    const beverages = breakdown.find(c => c.category === 'Beverages');
    expect(beverages?.totalQuantityByStore['store-A']).toBe(24);
    expect(beverages?.totalQuantityByStore['store-B']).toBe(20);
  });

  it('should track average price per category per store', () => {
    const engine = createTwoStoreEngine();
    const breakdown = engine.compareCategoryBreakdown();

    const beverages = breakdown.find(c => c.category === 'Beverages');
    expect(beverages?.avgPriceByStore['store-A']).toBeCloseTo(1.99, 1);
    expect(beverages?.avgPriceByStore['store-B']).toBeCloseTo(2.29, 1);
  });

  it('should track store coverage per category', () => {
    const engine = createTwoStoreEngine();
    const breakdown = engine.compareCategoryBreakdown();

    const bakery = breakdown.find(c => c.category === 'Bakery');
    expect(bakery?.storesCoverage).toBe(1); // Only Store A has Bakery

    const beverages = breakdown.find(c => c.category === 'Beverages');
    expect(beverages?.storesCoverage).toBe(2); // Both stores
  });

  it('should sort by store coverage (least coverage first)', () => {
    const engine = createTwoStoreEngine();
    const breakdown = engine.compareCategoryBreakdown();

    for (let i = 1; i < breakdown.length; i++) {
      expect(breakdown[i].storesCoverage).toBeGreaterThanOrEqual(breakdown[i - 1].storesCoverage);
    }
  });
});

// ─── Trend Analysis ─────────────────────────────────────────────

describe('StoreComparisonEngine — Trend Analysis', () => {
  it('should detect increasing quantity trend', () => {
    const engine = new StoreComparisonEngine({ minTrendDataPoints: 3 });

    const sessions: StoreSnapshot[] = [
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-1', capturedAt: '2026-01-01', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 10, storeId: 'store-A' }),
      ]}),
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-2', capturedAt: '2026-01-08', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 20, storeId: 'store-A' }),
      ]}),
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-3', capturedAt: '2026-01-15', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 30, storeId: 'store-A' }),
      ]}),
    ];

    const trend = engine.analyzeTrend('SKU-001', sessions);
    expect(trend).not.toBeNull();
    expect(trend!.quantityTrend).toBe('increasing');
    expect(trend!.avgQuantityDelta).toBe(10);
  });

  it('should detect decreasing quantity trend', () => {
    const engine = new StoreComparisonEngine({ minTrendDataPoints: 3 });

    const sessions: StoreSnapshot[] = [
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-1', capturedAt: '2026-01-01', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 50, storeId: 'store-A' }),
      ]}),
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-2', capturedAt: '2026-01-08', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 30, storeId: 'store-A' }),
      ]}),
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-3', capturedAt: '2026-01-15', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 10, storeId: 'store-A' }),
      ]}),
    ];

    const trend = engine.analyzeTrend('SKU-001', sessions);
    expect(trend!.quantityTrend).toBe('decreasing');
  });

  it('should detect stable trend', () => {
    const engine = new StoreComparisonEngine({ minTrendDataPoints: 3 });

    const sessions: StoreSnapshot[] = [
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-1', capturedAt: '2026-01-01', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 20, storeId: 'store-A' }),
      ]}),
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-2', capturedAt: '2026-01-08', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 20, storeId: 'store-A' }),
      ]}),
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-3', capturedAt: '2026-01-15', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 21, storeId: 'store-A' }),
      ]}),
    ];

    const trend = engine.analyzeTrend('SKU-001', sessions);
    expect(trend!.quantityTrend).toBe('stable');
  });

  it('should return null with insufficient data points', () => {
    const engine = new StoreComparisonEngine({ minTrendDataPoints: 3 });

    const sessions: StoreSnapshot[] = [
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-1', capturedAt: '2026-01-01', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 20, storeId: 'store-A' }),
      ]}),
    ];

    const trend = engine.analyzeTrend('SKU-001', sessions);
    expect(trend).toBeNull();
  });

  it('should return null for unknown SKU', () => {
    const engine = new StoreComparisonEngine({ minTrendDataPoints: 3 });

    const sessions: StoreSnapshot[] = [
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-1', capturedAt: '2026-01-01', items: [] }),
    ];

    const trend = engine.analyzeTrend('SKU-NONEXISTENT', sessions);
    expect(trend).toBeNull();
  });

  it('should track price trend when data is available', () => {
    const engine = new StoreComparisonEngine({ minTrendDataPoints: 3 });

    const sessions: StoreSnapshot[] = [
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-1', capturedAt: '2026-01-01', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 20, price: 1.99, storeId: 'store-A' }),
      ]}),
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-2', capturedAt: '2026-01-08', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 20, price: 2.49, storeId: 'store-A' }),
      ]}),
      makeSnapshot({ storeId: 'store-A', storeName: 'A', sessionId: 's-3', capturedAt: '2026-01-15', items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 20, price: 2.99, storeId: 'store-A' }),
      ]}),
    ];

    const trend = engine.analyzeTrend('SKU-001', sessions);
    expect(trend!.priceTrend).toBe('increasing');
  });
});

// ─── Full Report ────────────────────────────────────────────────

describe('StoreComparisonEngine — Full Report', () => {
  it('should generate a complete comparison report', () => {
    const engine = createTwoStoreEngine();
    const report = engine.generateReport();

    expect(report.title).toBeTruthy();
    expect(report.generatedAt).toBeTruthy();
    expect(report.stores).toHaveLength(2);
    expect(report.summary).toBeDefined();
    expect(report.variances).toBeDefined();
    expect(report.priceComparisons).toBeDefined();
    expect(report.availability).toBeDefined();
    expect(report.categoryBreakdown).toBeDefined();
  });

  it('should count total unique products', () => {
    const engine = createTwoStoreEngine();
    const report = engine.generateReport();

    // SKU-001 (Cola), SKU-002 (Chips), SKU-003 (Bread), SKU-004 (Milk), SKU-005 (Yogurt) = 5
    expect(report.summary.totalUniqueProducts).toBe(5);
  });

  it('should count products in all stores', () => {
    const engine = createTwoStoreEngine();
    const report = engine.generateReport();

    // Cola and Chips are at both stores = 2
    expect(report.summary.productsInAllStores).toBe(2);
  });

  it('should count exclusive products', () => {
    const engine = createTwoStoreEngine();
    const report = engine.generateReport();

    // Bread, Milk (Store A only), Yogurt (Store B only) = 3
    expect(report.summary.exclusiveProducts).toBe(3);
  });

  it('should use custom title', () => {
    const engine = createTwoStoreEngine();
    const report = engine.generateReport('My Custom Report');

    expect(report.title).toBe('My Custom Report');
  });

  it('should generate empty report with single store', () => {
    const engine = new StoreComparisonEngine();
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A',
      items: [makeItem()],
    }));

    const report = engine.generateReport();
    expect(report.summary.totalVariances).toBe(0);
    expect(report.variances).toHaveLength(0);
  });

  it('should include store details', () => {
    const engine = createTwoStoreEngine();
    const report = engine.generateReport();

    expect(report.stores[0].itemCount).toBe(4);
    expect(report.stores[1].itemCount).toBe(3);
  });
});

// ─── Voice Summary ──────────────────────────────────────────────

describe('StoreComparisonEngine — Voice Summary', () => {
  it('should generate comparison voice summary', () => {
    const engine = createTwoStoreEngine();
    const summary = engine.getVoiceSummary();

    expect(summary).toContain('2 stores');
    expect(summary).toContain('5 unique products');
  });

  it('should handle insufficient stores', () => {
    const engine = new StoreComparisonEngine();
    engine.addSnapshot(makeSnapshot());

    const summary = engine.getVoiceSummary();
    expect(summary).toContain('at least two');
  });

  it('should mention critical issues', () => {
    const engine = new StoreComparisonEngine({
      quantityVarianceThresholdPercent: 10,
      understockMultiplier: 0.3,
    });

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A', storeName: 'Store A',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 100, storeId: 'store-A' })],
    }));
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-B', storeName: 'Store B',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 2, storeId: 'store-B' })],
    }));

    const summary = engine.getVoiceSummary();
    expect(summary).toContain('critical');
  });
});

// ─── Markdown Report ────────────────────────────────────────────

describe('StoreComparisonEngine — Markdown Report', () => {
  it('should generate markdown report', () => {
    const engine = createTwoStoreEngine();
    const markdown = engine.generateMarkdownReport();

    expect(markdown).toContain('# ');
    expect(markdown).toContain('## Summary');
    expect(markdown).toContain('Stores compared');
    expect(markdown).toContain('Unique products');
  });

  it('should include store breakdown', () => {
    const engine = createTwoStoreEngine();
    const markdown = engine.generateMarkdownReport();

    expect(markdown).toContain('Store Alpha');
    expect(markdown).toContain('Store Beta');
  });

  it('should include price differences section', () => {
    const engine = createTwoStoreEngine();
    const markdown = engine.generateMarkdownReport();

    expect(markdown).toContain('Price Differences');
  });

  it('should include availability section', () => {
    const engine = createTwoStoreEngine();
    const markdown = engine.generateMarkdownReport();

    expect(markdown).toContain('Availability');
  });
});

// ─── Config ─────────────────────────────────────────────────────

describe('StoreComparisonEngine — Configuration', () => {
  it('should use default config', () => {
    const engine = new StoreComparisonEngine();
    // Default thresholds
    expect(engine).toBeDefined();
  });

  it('should apply custom thresholds', () => {
    const engine = new StoreComparisonEngine({
      priceVarianceThresholdPercent: 50, // Only flag 50%+ differences
    });

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A', storeName: 'A',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', price: 1.99, storeId: 'store-A' })],
    }));
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-B', storeName: 'B',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', price: 2.29, storeId: 'store-B' })],
    }));

    const variances = engine.detectVariances();
    const priceVars = variances.filter(v => v.type === 'price_difference');
    expect(priceVars).toHaveLength(0); // 14% < 50% threshold
  });

  it('should exclude zero quantity items when configured', () => {
    const engine = new StoreComparisonEngine({ includeZeroQuantity: false });

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A', storeName: 'A',
      items: [
        makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 10, storeId: 'store-A' }),
        makeItem({ sku: 'SKU-002', name: 'Chips', quantity: 0, storeId: 'store-A' }),
      ],
    }));
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-B', storeName: 'B',
      items: [makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 10, storeId: 'store-B' })],
    }));

    const matrix = engine.buildAvailabilityMatrix();
    // Chips with quantity 0 should be excluded
    const chips = matrix.find(m => m.productName === 'Chips');
    expect(chips).toBeUndefined();
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────

describe('StoreComparisonEngine — Edge Cases', () => {
  it('should handle empty snapshots', () => {
    const engine = new StoreComparisonEngine();
    engine.addSnapshot(makeSnapshot({ storeId: 'store-A', items: [] }));
    engine.addSnapshot(makeSnapshot({ storeId: 'store-B', items: [] }));

    const report = engine.generateReport();
    expect(report.summary.totalUniqueProducts).toBe(0);
    expect(report.variances).toHaveLength(0);
  });

  it('should handle items without category', () => {
    const engine = new StoreComparisonEngine();
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A', storeName: 'A',
      items: [makeItem({ sku: 'SKU-001', name: 'Mystery', storeId: 'store-A' })],
    }));
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-B', storeName: 'B',
      items: [makeItem({ sku: 'SKU-002', name: 'Other', storeId: 'store-B' })],
    }));

    const breakdown = engine.compareCategoryBreakdown();
    const uncategorized = breakdown.find(c => c.category === 'Uncategorized');
    expect(uncategorized).toBeDefined();
  });

  it('should handle many stores', () => {
    const engine = new StoreComparisonEngine();

    for (let i = 0; i < 10; i++) {
      engine.addSnapshot(makeSnapshot({
        storeId: `store-${i}`,
        storeName: `Store ${i}`,
        sessionId: `session-${i}`,
        items: [
          makeItem({ sku: 'SKU-001', name: 'Cola', quantity: 10 + i, price: 1.99 + i * 0.1, storeId: `store-${i}` }),
        ],
      }));
    }

    const report = engine.generateReport();
    expect(report.summary.totalStores).toBe(10);
    expect(report.summary.totalUniqueProducts).toBe(1);
  });

  it('should handle products with same name but different SKUs', () => {
    const engine = new StoreComparisonEngine();

    engine.addSnapshot(makeSnapshot({
      storeId: 'store-A', storeName: 'A',
      items: [
        makeItem({ sku: 'SKU-001', name: 'Cola 12oz', storeId: 'store-A' }),
        makeItem({ sku: 'SKU-002', name: 'Cola 20oz', storeId: 'store-A' }),
      ],
    }));
    engine.addSnapshot(makeSnapshot({
      storeId: 'store-B', storeName: 'B',
      items: [
        makeItem({ sku: 'SKU-001', name: 'Cola 12oz', storeId: 'store-B' }),
      ],
    }));

    const matrix = engine.buildAvailabilityMatrix();
    expect(matrix).toHaveLength(2); // Two different SKUs
  });
});
