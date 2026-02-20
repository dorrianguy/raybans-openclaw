/**
 * Tests for ProductDatabase — UPC lookup and caching.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProductDatabase } from './product-database.js';
import type { ProductInfo } from '../types.js';

describe('ProductDatabase', () => {
  let db: ProductDatabase;

  beforeEach(() => {
    db = new ProductDatabase({
      enableOpenFoodFacts: false, // Disable for unit tests
      maxCacheSize: 100,
      cacheTtlMs: 60000,
    });
  });

  // ── UPC Normalization ──────────────────────────────────────

  describe('UPC Normalization', () => {
    it('should accept valid UPC-A (12 digits)', () => {
      expect(db.normalizeUpc('012345678901')).toBe('012345678901');
    });

    it('should accept valid EAN-13 (13 digits)', () => {
      expect(db.normalizeUpc('0123456789012')).toBe('0123456789012');
    });

    it('should accept valid UPC-E (8 digits)', () => {
      expect(db.normalizeUpc('01234565')).toBe('01234565');
    });

    it('should strip non-numeric characters', () => {
      expect(db.normalizeUpc('012-345-678-901')).toBe('012345678901');
    });

    it('should handle GTIN-14 (strip leading 2 digits)', () => {
      expect(db.normalizeUpc('00012345678901')).toBe('012345678901');
    });

    it('should reject too-short codes', () => {
      expect(db.normalizeUpc('12345')).toBeNull();
    });

    it('should reject empty strings', () => {
      expect(db.normalizeUpc('')).toBeNull();
    });

    it('should handle codes with spaces', () => {
      expect(db.normalizeUpc('012 345 678 901')).toBe('012345678901');
    });
  });

  // ── Cache Operations ───────────────────────────────────────

  describe('Cache', () => {
    const testProduct: ProductInfo = {
      upc: '012345678901',
      name: 'Test Product',
      brand: 'TestBrand',
      category: 'General',
      source: 'manual',
    };

    it('should add and retrieve products from cache', () => {
      db.addProduct(testProduct);

      // Can't directly test cache hit since lookup calls external API
      // But searchByName should find it
      const results = db.searchByName('Test Product');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Test Product');
    });

    it('should search by brand name', () => {
      db.addProduct(testProduct);
      const results = db.searchByName('TestBrand');
      expect(results.length).toBe(1);
    });

    it('should search case-insensitively', () => {
      db.addProduct(testProduct);
      const results = db.searchByName('test product');
      expect(results.length).toBe(1);
    });

    it('should return empty for no matches', () => {
      db.addProduct(testProduct);
      const results = db.searchByName('nonexistent');
      expect(results.length).toBe(0);
    });

    it('should clear cache', () => {
      db.addProduct(testProduct);
      expect(db.getStats().size).toBe(1);

      db.clearCache();
      expect(db.getStats().size).toBe(0);
    });

    it('should report stats', () => {
      const stats = db.getStats();
      expect(stats.size).toBe(0);
      expect(stats.dailyApiCalls).toBe(0);
      expect(stats.maxSize).toBe(100);
    });

    it('should evict oldest entries when cache is full', () => {
      const smallDb = new ProductDatabase({ maxCacheSize: 3 });

      for (let i = 0; i < 5; i++) {
        smallDb.addProduct({
          upc: `00000000000${i}`,
          name: `Product ${i}`,
          brand: 'Brand',
          category: 'Cat',
          source: 'manual',
        });
      }

      expect(smallDb.getStats().size).toBe(3);
    });

    it('should export and import cache', () => {
      db.addProduct(testProduct);
      db.addProduct({
        upc: '999888777666',
        name: 'Second Product',
        brand: 'Brand2',
        category: 'Cat2',
        source: 'manual',
      });

      const exported = db.exportCache();
      expect(exported.length).toBe(2);

      const newDb = new ProductDatabase();
      const imported = newDb.importCache(exported);
      expect(imported).toBe(2);
      expect(newDb.getStats().size).toBe(2);
    });

    it('should not import products without UPC', () => {
      const noUpcProduct: ProductInfo = {
        upc: '',
        name: 'No UPC',
        brand: 'Brand',
        category: 'Cat',
        source: 'manual',
      };

      // Empty string normalizes to null, so it shouldn't import
      // Actually empty string won't pass the truthy check in addProduct
      const newDb = new ProductDatabase();
      const imported = newDb.importCache([noUpcProduct]);
      expect(imported).toBe(0);
    });
  });

  // ── Lookup (mocked) ────────────────────────────────────────

  describe('Lookup with mocked APIs', () => {
    beforeEach(() => {
      // Mock fetch globally
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return cached result without API call', async () => {
      db.addProduct({
        upc: '012345678901',
        name: 'Cached Product',
        brand: 'Brand',
        category: 'Cat',
        source: 'manual',
      });

      const result = await db.lookup('012345678901');
      expect(result).toBeTruthy();
      expect(result!.name).toBe('Cached Product');
      expect(result!.source).toBe('cache');
      // fetch should NOT have been called
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should call UPCitemdb API for uncached product', async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                title: 'API Product',
                brand: 'API Brand',
                category: 'API Cat',
                description: 'From API',
              },
            ],
          }),
      };
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse as Response);

      const result = await db.lookup('012345678901');
      expect(result).toBeTruthy();
      expect(result!.name).toBe('API Product');
      expect(result!.source).toBe('upcitemdb');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should return null when API returns no items', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      };
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse as Response);

      const result = await db.lookup('012345678901');
      expect(result).toBeNull();
    });

    it('should return null when API fails', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const result = await db.lookup('012345678901');
      expect(result).toBeNull();
    });

    it('should return null for invalid UPC', async () => {
      const result = await db.lookup('invalid');
      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should cache API results for future lookups', async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                title: 'Cached After Lookup',
                brand: 'Brand',
                category: 'Cat',
              },
            ],
          }),
      };
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse as Response);

      // First lookup — hits API
      await db.lookup('012345678901');
      expect(fetch).toHaveBeenCalledTimes(1);

      // Second lookup — should hit cache
      const result2 = await db.lookup('012345678901');
      expect(result2!.source).toBe('cache');
      expect(fetch).toHaveBeenCalledTimes(1); // No additional calls
    });

    it('should batch lookup efficiently', async () => {
      // Pre-cache one product
      db.addProduct({
        upc: '111111111111',
        name: 'Pre-cached',
        brand: 'Brand',
        category: 'Cat',
        source: 'manual',
      });

      // Mock for the uncached one
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            items: [{ title: 'From API', brand: 'B', category: 'C' }],
          }),
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

      const results = await db.batchLookup([
        '111111111111', // cached
        '222222222222', // uncached
      ]);

      expect(results.size).toBe(2);
      // Only one API call (for the uncached one)
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
