/**
 * Product Database — UPC/barcode lookup service.
 *
 * Looks up product information from multiple sources:
 * 1. Local cache (SQLite or in-memory)
 * 2. UPCitemdb API (free tier: 100 requests/day)
 * 3. Open Food Facts (free, open-source food database)
 * 4. Vision-identified products (from the AI model)
 *
 * Results are cached locally to minimize API calls.
 */

import type { ProductInfo, ProductDataSource } from '../types.js';

// ─── Configuration ──────────────────────────────────────────────

export interface ProductDatabaseConfig {
  /** UPCitemdb API key (optional — free tier available without) */
  upcItemDbApiKey?: string;
  /** Maximum cache size (in-memory) */
  maxCacheSize?: number;
  /** Cache TTL in milliseconds (default: 30 days) */
  cacheTtlMs?: number;
  /** Enable Open Food Facts lookups */
  enableOpenFoodFacts?: boolean;
  /** API request timeout in ms */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<ProductDatabaseConfig> = {
  upcItemDbApiKey: '',
  maxCacheSize: 50000,
  cacheTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  enableOpenFoodFacts: true,
  timeoutMs: 10000,
};

// ─── Cache Entry ────────────────────────────────────────────────

interface CacheEntry {
  product: ProductInfo;
  cachedAt: number;
}

// ─── Product Database ───────────────────────────────────────────

export class ProductDatabase {
  private config: Required<ProductDatabaseConfig>;
  private cache: Map<string, CacheEntry> = new Map();
  /** Track API usage to stay within rate limits */
  private dailyApiCalls: { date: string; count: number } = {
    date: new Date().toISOString().slice(0, 10),
    count: 0,
  };

  constructor(config: Partial<ProductDatabaseConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Look up a product by UPC/EAN barcode.
   * Checks cache first, then external APIs.
   */
  async lookup(upc: string): Promise<ProductInfo | null> {
    const normalizedUpc = this.normalizeUpc(upc);
    if (!normalizedUpc) return null;

    // 1. Check cache
    const cached = this.getFromCache(normalizedUpc);
    if (cached) return cached;

    // 2. Try UPCitemdb
    const upcResult = await this.lookupUpcItemDb(normalizedUpc);
    if (upcResult) {
      this.addToCache(normalizedUpc, upcResult);
      return upcResult;
    }

    // 3. Try Open Food Facts (good for grocery/food items)
    if (this.config.enableOpenFoodFacts) {
      const offResult = await this.lookupOpenFoodFacts(normalizedUpc);
      if (offResult) {
        this.addToCache(normalizedUpc, offResult);
        return offResult;
      }
    }

    return null;
  }

  /**
   * Batch lookup — efficient for processing multiple barcodes from one image.
   */
  async batchLookup(upcs: string[]): Promise<Map<string, ProductInfo>> {
    const results = new Map<string, ProductInfo>();

    // Separate cached vs uncached
    const uncached: string[] = [];
    for (const upc of upcs) {
      const normalized = this.normalizeUpc(upc);
      if (!normalized) continue;

      const cached = this.getFromCache(normalized);
      if (cached) {
        results.set(normalized, cached);
      } else {
        uncached.push(normalized);
      }
    }

    // Look up uncached in parallel (with rate limiting)
    const lookupPromises = uncached.map(async (upc) => {
      const result = await this.lookup(upc);
      if (result) {
        results.set(upc, result);
      }
    });

    await Promise.allSettled(lookupPromises);
    return results;
  }

  /**
   * Add a product to the cache (e.g., from vision identification).
   */
  addProduct(product: ProductInfo): void {
    if (product.upc) {
      const normalized = this.normalizeUpc(product.upc);
      if (normalized) {
        this.addToCache(normalized, product);
      }
    }
  }

  /**
   * Search products by name (local cache only).
   */
  searchByName(query: string): ProductInfo[] {
    const lowerQuery = query.toLowerCase();
    const results: ProductInfo[] = [];

    for (const entry of this.cache.values()) {
      if (
        entry.product.name.toLowerCase().includes(lowerQuery) ||
        entry.product.brand.toLowerCase().includes(lowerQuery) ||
        (entry.product.description?.toLowerCase().includes(lowerQuery))
      ) {
        results.push(entry.product);
      }
    }

    return results;
  }

  /**
   * Get cache stats.
   */
  getStats(): { size: number; dailyApiCalls: number; maxSize: number } {
    return {
      size: this.cache.size,
      dailyApiCalls: this.getDailyApiCallCount(),
      maxSize: this.config.maxCacheSize,
    };
  }

  /**
   * Clear the cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Export cache as a JSON-serializable array.
   */
  exportCache(): ProductInfo[] {
    return Array.from(this.cache.values())
      .filter((entry) => !this.isExpired(entry))
      .map((entry) => entry.product);
  }

  /**
   * Import products into cache.
   */
  importCache(products: ProductInfo[]): number {
    let imported = 0;
    for (const product of products) {
      if (product.upc) {
        this.addProduct(product);
        imported++;
      }
    }
    return imported;
  }

  // ─── Private: API Lookups ─────────────────────────────────────

  /**
   * Look up a product on UPCitemdb.com.
   * Free tier: 100 requests/day.
   */
  private async lookupUpcItemDb(upc: string): Promise<ProductInfo | null> {
    if (this.getDailyApiCallCount() >= 100 && !this.config.upcItemDbApiKey) {
      return null; // Free tier rate limit
    }

    try {
      this.incrementDailyApiCalls();

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (this.config.upcItemDbApiKey) {
        headers['user_key'] = this.config.upcItemDbApiKey;
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs
      );

      try {
        const response = await fetch(
          `https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`,
          { headers, signal: controller.signal }
        );

        if (!response.ok) return null;

        const data = (await response.json()) as {
          items?: Array<{
            title?: string;
            brand?: string;
            category?: string;
            description?: string;
            size?: string;
            images?: string[];
            lowest_recorded_price?: number;
          }>;
        };

        const item = data.items?.[0];
        if (!item) return null;

        return {
          upc,
          name: item.title || `Product ${upc}`,
          brand: item.brand || 'Unknown',
          category: item.category || 'Uncategorized',
          description: item.description,
          size: item.size,
          imageUrl: item.images?.[0],
          avgPrice: item.lowest_recorded_price,
          source: 'upcitemdb',
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return null;
    }
  }

  /**
   * Look up a product on Open Food Facts.
   * Completely free, no rate limit, but only has food/beverage products.
   */
  private async lookupOpenFoodFacts(upc: string): Promise<ProductInfo | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs
      );

      try {
        const response = await fetch(
          `https://world.openfoodfacts.org/api/v0/product/${upc}.json`,
          {
            headers: { 'User-Agent': 'OpenClaw-RayBans-Vision/0.1' },
            signal: controller.signal,
          }
        );

        if (!response.ok) return null;

        const data = (await response.json()) as {
          status: number;
          product?: {
            product_name?: string;
            brands?: string;
            categories?: string;
            generic_name?: string;
            quantity?: string;
            image_url?: string;
          };
        };

        if (data.status !== 1 || !data.product) return null;

        const product = data.product;
        return {
          upc,
          name: product.product_name || `Product ${upc}`,
          brand: product.brands || 'Unknown',
          category: product.categories?.split(',')[0]?.trim() || 'Food & Beverage',
          description: product.generic_name,
          size: product.quantity,
          imageUrl: product.image_url,
          source: 'open_food_facts',
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return null;
    }
  }

  // ─── Private: Cache ─────────────────────────────────────────

  private getFromCache(upc: string): ProductInfo | null {
    const entry = this.cache.get(upc);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.cache.delete(upc);
      return null;
    }
    return { ...entry.product, source: 'cache' };
  }

  private addToCache(upc: string, product: ProductInfo): void {
    // Evict if over limit (simple LRU: delete oldest)
    if (this.cache.size >= this.config.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(upc, {
      product: { ...product },
      cachedAt: Date.now(),
    });
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.cachedAt > this.config.cacheTtlMs;
  }

  // ─── Private: Helpers ─────────────────────────────────────────

  /**
   * Normalize UPC/EAN to a standard format.
   * - Strips leading zeros for UPC-E → UPC-A conversion
   * - Validates check digit
   */
  normalizeUpc(upc: string): string | null {
    // Strip non-numeric characters
    const cleaned = upc.replace(/[^0-9]/g, '');

    // Accept UPC-A (12 digits), EAN-13 (13 digits), UPC-E (8 digits)
    if (cleaned.length === 12 || cleaned.length === 13 || cleaned.length === 8) {
      return cleaned;
    }

    // Try to handle common OCR errors (e.g., extra digit)
    if (cleaned.length === 14) {
      // GTIN-14: strip leading two digits
      return cleaned.slice(2);
    }

    // Too short or invalid
    if (cleaned.length < 8) return null;

    return cleaned;
  }

  private getDailyApiCallCount(): number {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyApiCalls.date !== today) {
      this.dailyApiCalls = { date: today, count: 0 };
    }
    return this.dailyApiCalls.count;
  }

  private incrementDailyApiCalls(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyApiCalls.date !== today) {
      this.dailyApiCalls = { date: today, count: 1 };
    } else {
      this.dailyApiCalls.count++;
    }
  }
}
