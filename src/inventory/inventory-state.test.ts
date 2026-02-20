/**
 * Tests for InventoryStateManager — the core inventory tracking engine.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InventoryStateManager } from './inventory-state.js';
import type { DetectedProduct, VisionAnalysis, ImageQuality, StoreLocation } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeProduct(overrides: Partial<DetectedProduct> = {}): DetectedProduct {
  return {
    name: 'Test Product',
    brand: 'TestBrand',
    category: 'General',
    confidence: 0.9,
    identificationMethod: 'visual',
    estimatedCount: 5,
    countConfidence: 0.85,
    ...overrides,
  };
}

function makeAnalysis(
  imageId: string,
  products: DetectedProduct[] = [],
  barcodes: VisionAnalysis['barcodes'] = []
): VisionAnalysis {
  return {
    imageId,
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 500,
    sceneDescription: 'Test shelf',
    sceneType: 'retail_shelf',
    extractedText: [],
    detectedObjects: [],
    products,
    barcodes,
    quality: {
      score: 0.9,
      isBlurry: false,
      hasGlare: false,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: true,
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('InventoryStateManager', () => {
  let manager: InventoryStateManager;

  beforeEach(() => {
    manager = new InventoryStateManager('Test Count', {}, 'Test Store');
  });

  // ── Session Lifecycle ──────────────────────────────────────

  describe('Session Lifecycle', () => {
    it('should create a new session with correct defaults', () => {
      const session = manager.getSession();
      expect(session.name).toBe('Test Count');
      expect(session.storeName).toBe('Test Store');
      expect(session.status).toBe('active');
      expect(session.id).toBeTruthy();
      expect(session.startedAt).toBeTruthy();
      expect(session.completedAt).toBeUndefined();
      expect(session.stats.totalItems).toBe(0);
      expect(session.stats.totalSKUs).toBe(0);
    });

    it('should pause and resume', () => {
      expect(manager.isActive()).toBe(true);

      manager.pause();
      expect(manager.getStatus()).toBe('paused');
      expect(manager.isActive()).toBe(false);

      manager.resume();
      expect(manager.getStatus()).toBe('active');
      expect(manager.isActive()).toBe(true);
    });

    it('should not pause when not active', () => {
      manager.complete();
      manager.pause(); // should be a no-op
      expect(manager.getStatus()).toBe('completed');
    });

    it('should not resume when not paused', () => {
      manager.resume(); // should be a no-op (was active, not paused)
      expect(manager.getStatus()).toBe('active');
    });

    it('should complete a session', () => {
      const session = manager.complete();
      expect(session.status).toBe('completed');
      expect(session.completedAt).toBeTruthy();
    });

    it('should cancel a session', () => {
      manager.cancel();
      expect(manager.getStatus()).toBe('cancelled');
    });

    it('should emit session:changed on lifecycle events', () => {
      const listener = vi.fn();
      manager.on('session:changed', listener);

      manager.pause();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].status).toBe('paused');

      manager.resume();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1][0].status).toBe('active');
    });
  });

  // ── Location Tracking ──────────────────────────────────────

  describe('Location Tracking', () => {
    it('should set and get current location', () => {
      manager.setCurrentLocation({ aisle: '3', shelf: 'B', section: 'Cleaning' });
      const loc = manager.getCurrentLocation();
      expect(loc.aisle).toBe('3');
      expect(loc.shelf).toBe('B');
      expect(loc.section).toBe('Cleaning');
    });

    it('should track aisles covered', () => {
      manager.setAisle('1');
      manager.setAisle('2');
      manager.setAisle('3');
      manager.setAisle('1'); // Duplicate — should not add

      const stats = manager.getStats();
      expect(stats.aislesCovered).toEqual(['1', '2', '3']);
    });

    it('should set aisle and section independently', () => {
      manager.setAisle('5');
      manager.setSection('Frozen Foods');
      const loc = manager.getCurrentLocation();
      expect(loc.aisle).toBe('5');
      expect(loc.section).toBe('Frozen Foods');
    });
  });

  // ── Product Management ─────────────────────────────────────

  describe('Product Management', () => {
    it('should add a new product from analysis', () => {
      const product = makeProduct({ name: 'Tide Pods 42ct', upc: '012345678901' });
      const analysis = makeAnalysis('img-001', [product]);

      const items = manager.processAnalysis(analysis);
      expect(items.length).toBe(1);
      expect(items[0].name).toBe('Tide Pods 42ct');
      expect(items[0].sku).toBe('012345678901');
      expect(items[0].quantity).toBe(5);
    });

    it('should skip low-confidence products', () => {
      const product = makeProduct({ confidence: 0.1 }); // Below default threshold (0.6)
      const analysis = makeAnalysis('img-001', [product]);

      const items = manager.processAnalysis(analysis);
      expect(items.length).toBe(0);
    });

    it('should deduplicate products by UPC', () => {
      const product1 = makeProduct({ name: 'Tide Pods', upc: '012345678901', estimatedCount: 5 });
      const product2 = makeProduct({ name: 'Tide Pods', upc: '012345678901', estimatedCount: 8, countConfidence: 0.95 });

      manager.processAnalysis(makeAnalysis('img-001', [product1]));
      manager.processAnalysis(makeAnalysis('img-002', [product2]));

      const items = manager.getAllItems();
      expect(items.length).toBe(1);
      // Should take the higher confidence count
      expect(items[0].quantity).toBe(8);
      expect(items[0].imageRefs).toContain('img-001');
      expect(items[0].imageRefs).toContain('img-002');
    });

    it('should deduplicate products by exact name match', () => {
      const product1 = makeProduct({ name: 'DeWalt Drill Kit', estimatedCount: 3 });
      const product2 = makeProduct({ name: 'DeWalt Drill Kit', estimatedCount: 4, countConfidence: 0.95 });

      manager.processAnalysis(makeAnalysis('img-001', [product1]));
      manager.processAnalysis(makeAnalysis('img-002', [product2]));

      const items = manager.getAllItems();
      expect(items.length).toBe(1);
    });

    it('should not double-count from the same image', () => {
      const product = makeProduct({ name: 'Widget', upc: '111111111111', estimatedCount: 5 });
      const analysis = makeAnalysis('img-001', [product]);

      manager.processAnalysis(analysis);
      manager.processAnalysis(analysis); // Same image ID

      const items = manager.getAllItems();
      expect(items.length).toBe(1);
      expect(items[0].imageRefs.length).toBe(1); // Only one image ref
    });

    it('should create placeholder for unmatched barcodes', () => {
      const analysis = makeAnalysis('img-001', [], [
        { data: '999888777666', format: 'UPC-A', confidence: 0.95 },
      ]);

      const items = manager.processAnalysis(analysis);
      expect(items.length).toBe(1);
      expect(items[0].sku).toBe('999888777666');
      expect(items[0].identificationMethod).toBe('barcode');
    });

    it('should not process when session is not active', () => {
      manager.pause();
      const analysis = makeAnalysis('img-001', [makeProduct()]);
      const items = manager.processAnalysis(analysis);
      expect(items.length).toBe(0);
    });

    it('should handle manual count for existing product', () => {
      const product = makeProduct({ name: 'Coca-Cola 12 Pack', upc: '049000000429' });
      manager.processAnalysis(makeAnalysis('img-001', [product]));

      const item = manager.manualCount({
        productIdentifier: '049000000429',
        count: 24,
      });

      expect(item).toBeTruthy();
      expect(item!.quantity).toBe(24);
      expect(item!.countConfidence).toBe(1.0);
      expect(item!.manuallyVerified).toBe(true);
    });

    it('should handle manual count for new product', () => {
      const item = manager.manualCount({
        productIdentifier: 'Bulk Nails 3 inch',
        count: 500,
      });

      expect(item).toBeTruthy();
      expect(item!.name).toBe('Bulk Nails 3 inch');
      expect(item!.quantity).toBe(500);
      expect(item!.identificationMethod).toBe('voice_override');
      expect(item!.manuallyVerified).toBe(true);
    });

    it('should enrich product data on update', () => {
      // First image — no brand or category info
      const product1 = makeProduct({ name: 'Widget X', brand: undefined, category: undefined, estimatedCount: 3 });
      manager.processAnalysis(makeAnalysis('img-001', [product1]));

      // Verify brand/category are missing
      expect(manager.getAllItems()[0].brand).toBeUndefined();

      // Second image — has brand + category
      const product2 = makeProduct({
        name: 'Widget X',
        brand: 'WidgetCo',
        category: 'Hardware',
        estimatedCount: 3,
      });
      manager.processAnalysis(makeAnalysis('img-002', [product2]));

      const items = manager.getAllItems();
      expect(items[0].brand).toBe('WidgetCo');
      expect(items[0].category).toBe('Hardware');
    });
  });

  // ── Flagging ───────────────────────────────────────────────

  describe('Flagging', () => {
    it('should flag empty spots', () => {
      const product = makeProduct({ estimatedCount: 0, countConfidence: 0.9 });
      manager.processAnalysis(makeAnalysis('img-001', [product]));

      const flagged = manager.getFlaggedItems();
      expect(flagged.length).toBe(1);
      expect(flagged[0].flags).toContain('empty_spot');
    });

    it('should flag low stock', () => {
      const product = makeProduct({ estimatedCount: 1, countConfidence: 0.9 });
      manager.processAnalysis(makeAnalysis('img-001', [product]));

      const flagged = manager.getFlaggedItems();
      expect(flagged[0].flags).toContain('low_stock');
    });

    it('should flag low confidence counts', () => {
      const product = makeProduct({ countConfidence: 0.2 });
      manager.processAnalysis(makeAnalysis('img-001', [product]));

      const flagged = manager.getFlaggedItems();
      expect(flagged[0].flags).toContain('low_confidence');
    });

    it('should emit item:flagged event', () => {
      const listener = vi.fn();
      manager.on('item:flagged', listener);

      const product = makeProduct({ estimatedCount: 0 });
      manager.processAnalysis(makeAnalysis('img-001', [product]));

      expect(listener).toHaveBeenCalled();
    });

    it('should remove low_confidence flag on manual verify', () => {
      const product = makeProduct({ countConfidence: 0.2, name: 'LowConf Item' });
      manager.processAnalysis(makeAnalysis('img-001', [product]));

      const flaggedBefore = manager.getFlaggedItems();
      expect(flaggedBefore[0].flags).toContain('low_confidence');

      manager.manualCount({ productIdentifier: 'LowConf Item', count: 10 });

      const item = manager.getAllItems().find(i => i.name === 'LowConf Item');
      expect(item!.flags).not.toContain('low_confidence');
      expect(item!.flags).not.toContain('needs_recount');
    });
  });

  // ── Queries ────────────────────────────────────────────────

  describe('Queries', () => {
    beforeEach(() => {
      manager.setAisle('1');
      manager.processAnalysis(makeAnalysis('img-001', [
        makeProduct({ name: 'DeWalt Hammer', brand: 'DeWalt', category: 'Tools', upc: '100000000001', estimatedCount: 10, priceOnShelf: 29.99 }),
      ]));
      manager.processAnalysis(makeAnalysis('img-002', [
        makeProduct({ name: 'Craftsman Screwdriver Set', brand: 'Craftsman', category: 'Tools', upc: '100000000002', estimatedCount: 5, priceOnShelf: 49.99 }),
      ]));

      manager.setAisle('2');
      manager.processAnalysis(makeAnalysis('img-003', [
        makeProduct({ name: 'Behr Premium Paint', brand: 'Behr', category: 'Paint', upc: '200000000001', estimatedCount: 20, priceOnShelf: 14.99 }),
      ]));
    });

    it('should get item by ID', () => {
      const allItems = manager.getAllItems();
      const item = manager.getItem(allItems[0].id);
      expect(item).toBeTruthy();
      expect(item!.name).toBe('DeWalt Hammer');
    });

    it('should get item by SKU', () => {
      const item = manager.getItemBySku('100000000001');
      expect(item).toBeTruthy();
      expect(item!.name).toBe('DeWalt Hammer');
    });

    it('should get all items', () => {
      expect(manager.getAllItems().length).toBe(3);
    });

    it('should filter by category', () => {
      const tools = manager.getItemsByCategory('Tools');
      expect(tools.length).toBe(2);
    });

    it('should filter by aisle', () => {
      const aisle1 = manager.getItemsByAisle('1');
      expect(aisle1.length).toBe(2);

      const aisle2 = manager.getItemsByAisle('2');
      expect(aisle2.length).toBe(1);
    });

    it('should count total items', () => {
      expect(manager.getItemCount()).toBe(3); // 3 unique SKUs
      expect(manager.getTotalQuantity()).toBe(35); // 10 + 5 + 20
    });

    it('should calculate total value', () => {
      // 10 * 29.99 + 5 * 49.99 + 20 * 14.99 = 299.90 + 249.95 + 299.80 = 849.65
      expect(manager.getTotalValue()).toBeCloseTo(849.65, 2);
    });

    it('should get low confidence items', () => {
      manager.processAnalysis(makeAnalysis('img-003', [
        makeProduct({ name: 'Sketchy Item', countConfidence: 0.3 }),
      ]));

      const lowConf = manager.getLowConfidenceItems(0.7);
      expect(lowConf.length).toBe(1);
      expect(lowConf[0].name).toBe('Sketchy Item');
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe('Stats', () => {
    it('should track images processed', () => {
      manager.processAnalysis(makeAnalysis('img-001', [makeProduct()]));
      manager.processAnalysis(makeAnalysis('img-002', [makeProduct({ name: 'Other' })]));

      const stats = manager.getStats();
      expect(stats.imagesProcessed).toBe(2);
      expect(stats.imagesCaptured).toBe(2);
    });

    it('should track total SKUs and items', () => {
      manager.processAnalysis(makeAnalysis('img-001', [
        makeProduct({ name: 'Alpha Widget', brand: 'Alpha', upc: '300000000001', estimatedCount: 5 }),
        makeProduct({ name: 'Beta Gadget', brand: 'Beta', upc: '300000000002', estimatedCount: 10 }),
      ]));

      const stats = manager.getStats();
      expect(stats.totalSKUs).toBe(2);
      expect(stats.totalItems).toBe(15);
    });

    it('should track flagged items count', () => {
      manager.processAnalysis(makeAnalysis('img-001', [
        makeProduct({ name: 'Normal', estimatedCount: 10 }),
        makeProduct({ name: 'Empty', estimatedCount: 0 }),
        makeProduct({ name: 'Low', estimatedCount: 1 }),
      ]));

      const stats = manager.getStats();
      expect(stats.flaggedItems).toBe(2);
    });

    it('should estimate accuracy based on confidence', () => {
      // All high confidence
      manager.processAnalysis(makeAnalysis('img-001', [
        makeProduct({ countConfidence: 0.95 }),
        makeProduct({ name: 'B', countConfidence: 0.9 }),
      ]));

      const stats = manager.getStats();
      expect(stats.estimatedAccuracy).toBeGreaterThan(0.5);
    });

    it('should emit stats:updated event', () => {
      const listener = vi.fn();
      manager.on('stats:updated', listener);

      manager.processAnalysis(makeAnalysis('img-001', [makeProduct()]));
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle analysis with no products', () => {
      const items = manager.processAnalysis(makeAnalysis('img-001', []));
      expect(items.length).toBe(0);
      expect(manager.getStats().imagesProcessed).toBe(1);
    });

    it('should handle products with special characters in name', () => {
      const product = makeProduct({ name: "M&M's Peanut 10.7oz (King Size)" });
      manager.processAnalysis(makeAnalysis('img-001', [product]));

      const items = manager.getAllItems();
      expect(items[0].name).toBe("M&M's Peanut 10.7oz (King Size)");
    });

    it('should handle duplicate products in same analysis', () => {
      const product = makeProduct({ name: 'Widget', upc: '111111111111', estimatedCount: 3 });
      // Same product appearing twice in one analysis (e.g., visible at two spots)
      const analysis = makeAnalysis('img-001', [product, { ...product, estimatedCount: 2 }]);

      const items = manager.processAnalysis(analysis);
      // Should merge — second instance updates the first
      expect(manager.getAllItems().length).toBe(1);
    });

    it('should return copies not references', () => {
      manager.processAnalysis(makeAnalysis('img-001', [makeProduct()]));
      const items1 = manager.getAllItems();
      const items2 = manager.getAllItems();

      // Mutating one copy should not affect the other
      items1[0].quantity = 9999;
      expect(items2[0].quantity).not.toBe(9999);
    });
  });
});
