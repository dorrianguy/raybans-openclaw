/**
 * Tests for ExportService — inventory report generation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ExportService } from './export-service.js';
import type { InventoryItem, InventorySession } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'item-1',
    sessionId: 'session-1',
    sku: '012345678901',
    name: 'Test Product',
    brand: 'TestBrand',
    category: 'General',
    variant: '16oz',
    quantity: 10,
    countConfidence: 0.9,
    identificationMethod: 'barcode',
    location: { aisle: '1', shelf: 'A', section: 'Front' },
    priceOnShelf: 4.99,
    flags: [],
    imageRefs: ['img-001'],
    firstSeenAt: '2026-02-19T14:00:00Z',
    lastSeenAt: '2026-02-19T14:05:00Z',
    manuallyVerified: false,
    ...overrides,
  };
}

function makeSession(overrides: Partial<InventorySession> = {}): InventorySession {
  return {
    id: 'session-1',
    name: 'Test Count',
    storeName: 'Test Store',
    startedAt: '2026-02-19T14:00:00Z',
    completedAt: '2026-02-19T17:00:00Z',
    status: 'completed',
    config: {
      autoSnapIntervalSec: 3,
      defaultDepthFactor: 1,
      minProductConfidence: 0.6,
      minCountConfidence: 0.5,
      voiceFeedbackEnabled: true,
      voiceUpdateInterval: 50,
      categoryFilter: [],
    },
    stats: {
      totalItems: 100,
      totalSKUs: 20,
      imagesProcessed: 50,
      imagesCaptured: 50,
      flaggedItems: 3,
      estimatedAccuracy: 0.88,
      aislesCovered: ['1', '2', '3'],
      startTime: '2026-02-19T14:00:00Z',
      lastUpdateTime: '2026-02-19T17:00:00Z',
      itemsPerMinute: 10,
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ExportService', () => {
  let service: ExportService;
  let items: InventoryItem[];
  let session: InventorySession;

  beforeEach(() => {
    service = new ExportService();
    session = makeSession();
    items = [
      makeItem({
        id: 'item-1',
        name: 'Hammer',
        brand: 'DeWalt',
        category: 'Tools',
        sku: '100000000001',
        quantity: 15,
        priceOnShelf: 24.99,
        location: { aisle: '1' },
      }),
      makeItem({
        id: 'item-2',
        name: 'Screwdriver Set',
        brand: 'Craftsman',
        category: 'Tools',
        sku: '100000000002',
        quantity: 8,
        priceOnShelf: 19.99,
        location: { aisle: '1' },
      }),
      makeItem({
        id: 'item-3',
        name: 'Paint Bucket',
        brand: 'Behr',
        category: 'Paint',
        sku: '200000000001',
        quantity: 30,
        priceOnShelf: 34.99,
        location: { aisle: '2' },
        flags: ['low_stock'],
      }),
    ];
  });

  // ── CSV Export ─────────────────────────────────────────────

  describe('CSV Export', () => {
    it('should generate valid CSV', () => {
      const csv = service.export(items, session, { format: 'csv' });
      expect(csv).toContain('SKU/UPC');
      expect(csv).toContain('Product Name');
      expect(csv).toContain('Quantity');
      expect(csv).toContain('Hammer');
      expect(csv).toContain('Screwdriver Set');
      expect(csv).toContain('Paint Bucket');
    });

    it('should include header metadata', () => {
      const csv = service.export(items, session, {
        format: 'csv',
        includeHeader: true,
      });
      expect(csv).toContain('# Inventory Report: Test Count');
      expect(csv).toContain('# Store: Test Store');
      expect(csv).toContain('# Total SKUs: 3');
    });

    it('should exclude header when disabled', () => {
      const csv = service.export(items, session, {
        format: 'csv',
        includeHeader: false,
      });
      expect(csv).not.toContain('# Inventory Report');
    });

    it('should include summary totals', () => {
      const csv = service.export(items, session, {
        format: 'csv',
        includeSummary: true,
      });
      expect(csv).toContain('TOTALS');
    });

    it('should escape commas in values', () => {
      const itemWithComma = makeItem({
        id: 'item-comma',
        name: 'Nuts, Bolts, and Washers Set',
      });
      const csv = service.export([itemWithComma], session, { format: 'csv' });
      expect(csv).toContain('"Nuts, Bolts, and Washers Set"');
    });

    it('should escape quotes in values', () => {
      const itemWithQuote = makeItem({
        id: 'item-quote',
        name: 'DeWalt 20V "Max" Drill',
      });
      const csv = service.export([itemWithQuote], session, { format: 'csv' });
      expect(csv).toContain('""Max""');
    });
  });

  // ── TSV Export ─────────────────────────────────────────────

  describe('TSV Export', () => {
    it('should use tab delimiters', () => {
      const tsv = service.export(items, session, { format: 'tsv', includeHeader: false, includeSummary: false });
      const dataLines = tsv.split('\n');
      // The header row should have tabs
      expect(dataLines[0]).toContain('\t');
      // Data rows should have tabs
      expect(dataLines[1]).toContain('\t');
    });
  });

  // ── JSON Export ────────────────────────────────────────────

  describe('JSON Export', () => {
    it('should generate valid JSON', () => {
      const json = service.export(items, session, { format: 'json' });
      const parsed = JSON.parse(json);
      expect(parsed).toBeTruthy();
      expect(parsed.items).toHaveLength(3);
    });

    it('should include report metadata', () => {
      const json = JSON.parse(service.export(items, session, { format: 'json' }));
      expect(json.report.name).toBe('Test Count');
      expect(json.report.store).toBe('Test Store');
      expect(json.report.status).toBe('completed');
    });

    it('should include summary stats', () => {
      const json = JSON.parse(service.export(items, session, { format: 'json' }));
      expect(json.summary.totalSKUs).toBe(3);
      expect(json.summary.totalItems).toBe(53); // 15 + 8 + 30
    });

    it('should calculate total value', () => {
      const json = JSON.parse(service.export(items, session, { format: 'json' }));
      // 15 * 24.99 + 8 * 19.99 + 30 * 34.99
      const expected = 15 * 24.99 + 8 * 19.99 + 30 * 34.99;
      expect(json.summary.totalValue).toBeCloseTo(expected, 2);
    });

    it('should include item details', () => {
      const json = JSON.parse(service.export(items, session, { format: 'json' }));
      const hammer = json.items.find((i: any) => i.name === 'Hammer');
      expect(hammer.sku).toBe('100000000001');
      expect(hammer.quantity).toBe(15);
      expect(hammer.unitPrice).toBe(24.99);
      expect(hammer.totalValue).toBeCloseTo(374.85, 2);
    });
  });

  // ── Filtering ──────────────────────────────────────────────

  describe('Filtering', () => {
    it('should filter by category', () => {
      const csv = service.export(items, session, {
        format: 'csv',
        categoryFilter: ['Tools'],
        includeHeader: false,
        includeSummary: false,
      });
      expect(csv).toContain('Hammer');
      expect(csv).toContain('Screwdriver');
      expect(csv).not.toContain('Paint Bucket');
    });

    it('should filter by aisle', () => {
      const csv = service.export(items, session, {
        format: 'csv',
        aisleFilter: ['2'],
        includeHeader: false,
        includeSummary: false,
      });
      expect(csv).toContain('Paint Bucket');
      expect(csv).not.toContain('Hammer');
    });

    it('should filter flagged only', () => {
      const csv = service.export(items, session, {
        format: 'csv',
        flaggedOnly: true,
        includeHeader: false,
        includeSummary: false,
      });
      expect(csv).toContain('Paint Bucket'); // Has low_stock flag
      expect(csv).not.toContain('Hammer');
    });
  });

  // ── Sorting ────────────────────────────────────────────────

  describe('Sorting', () => {
    it('should sort by name ascending', () => {
      const json = JSON.parse(
        service.export(items, session, {
          format: 'json',
          sortBy: 'name',
          sortDirection: 'asc',
        })
      );
      expect(json.items[0].name).toBe('Hammer');
      expect(json.items[1].name).toBe('Paint Bucket');
      expect(json.items[2].name).toBe('Screwdriver Set');
    });

    it('should sort by quantity descending', () => {
      const json = JSON.parse(
        service.export(items, session, {
          format: 'json',
          sortBy: 'quantity',
          sortDirection: 'desc',
        })
      );
      expect(json.items[0].quantity).toBe(30);
      expect(json.items[1].quantity).toBe(15);
      expect(json.items[2].quantity).toBe(8);
    });
  });

  // ── Summary Report ─────────────────────────────────────────

  describe('Summary Report', () => {
    it('should generate markdown summary', () => {
      const md = service.generateSummary(items, session);
      expect(md).toContain('# Inventory Report: Test Count');
      expect(md).toContain('Total SKUs');
      expect(md).toContain('Total Items');
      expect(md).toContain('By Category');
      expect(md).toContain('Tools');
      expect(md).toContain('Paint');
    });

    it('should include low stock section when applicable', () => {
      const md = service.generateSummary(items, session);
      expect(md).toContain('Low Stock');
      expect(md).toContain('Paint Bucket');
    });

    it('should include category breakdown', () => {
      const md = service.generateSummary(items, session);
      expect(md).toContain('Tools');
      expect(md).toContain('Paint');
    });
  });

  // ── Voice Summary ──────────────────────────────────────────

  describe('Voice Summary', () => {
    it('should generate concise voice summary', () => {
      const voice = service.generateVoiceSummary(items, session);
      expect(voice).toContain('3 unique products');
      expect(voice).toContain('53 total items');
    });

    it('should mention flagged items', () => {
      const voice = service.generateVoiceSummary(items, session);
      expect(voice).toContain('flagged');
    });

    it('should mention low stock items', () => {
      const voice = service.generateVoiceSummary(items, session);
      expect(voice).toContain('running low');
      expect(voice).toContain('Paint Bucket');
    });

    it('should include accuracy estimate', () => {
      const voice = service.generateVoiceSummary(items, session);
      expect(voice).toContain('accuracy');
      expect(voice).toContain('percent');
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle empty items array', () => {
      const csv = service.export([], session);
      expect(csv).toBeTruthy(); // Should still produce headers
    });

    it('should handle items with no price', () => {
      const noPriceItem = makeItem({ priceOnShelf: undefined });
      const csv = service.export([noPriceItem], session, { format: 'csv' });
      expect(csv).toBeTruthy();
    });

    it('should handle items with no location', () => {
      const noLocItem = makeItem({ location: {} });
      const csv = service.export([noLocItem], session, { format: 'csv' });
      expect(csv).toBeTruthy();
    });

    it('should handle in-progress session', () => {
      const activeSession = makeSession({
        status: 'active',
        completedAt: undefined,
      });
      const md = service.generateSummary(items, activeSession);
      expect(md).toContain('In progress');
    });
  });
});
