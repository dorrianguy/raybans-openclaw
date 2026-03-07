/**
 * Multi-Store Comparison Engine — Ray-Bans × OpenClaw
 *
 * Cross-session, cross-store inventory comparison with:
 * - Variance analysis (what's different between stores)
 * - Price comparison across locations
 * - Stock level trend detection
 * - Out-of-stock identification across locations
 * - Product availability matrix
 * - Competitive price intelligence
 * - Voice-friendly comparison summaries
 *
 * Use cases:
 * - Multi-location retail chains comparing stock across stores
 * - Regional managers checking consistency
 * - Price auditing between competitive stores
 * - Franchise compliance (same products, same prices)
 * - Trend detection over time (same store, different sessions)
 *
 * 🌙 Night Shift Agent — 2026-03-07
 */

// ─── Types ──────────────────────────────────────────────────────

export interface ComparisonItem {
  /** Product identifier (SKU or UPC) */
  sku: string;
  /** Product name */
  name: string;
  /** Brand */
  brand?: string;
  /** Category */
  category?: string;
  /** Quantity at this location */
  quantity: number;
  /** Price at this location */
  price?: number;
  /** Aisle location */
  aisle?: string;
  /** Source session ID */
  sessionId: string;
  /** Store identifier */
  storeId: string;
  /** Store name */
  storeName?: string;
  /** When this data was captured */
  capturedAt: string;
}

export interface StoreSnapshot {
  /** Unique store identifier */
  storeId: string;
  /** Human-readable store name */
  storeName: string;
  /** Session ID this snapshot came from */
  sessionId: string;
  /** When the snapshot was taken */
  capturedAt: string;
  /** All items in this snapshot */
  items: ComparisonItem[];
}

export type VarianceType =
  | 'quantity_difference'   // Same product, different counts
  | 'price_difference'      // Same product, different prices
  | 'missing_at_store'      // Product exists at one store but not another
  | 'exclusive_product'     // Product only at one store
  | 'category_gap'          // Entire category missing at a store
  | 'overstocked'           // Significantly more than average
  | 'understocked';         // Significantly less than average

export type VarianceSeverity = 'critical' | 'warning' | 'info';

export interface Variance {
  /** Type of variance detected */
  type: VarianceType;
  /** Severity level */
  severity: VarianceSeverity;
  /** Product SKU (if product-level) */
  sku?: string;
  /** Product name */
  productName?: string;
  /** Category (if category-level) */
  category?: string;
  /** Stores involved */
  storeIds: string[];
  /** Store names involved */
  storeNames: string[];
  /** Numeric values by store (quantity or price) */
  values: Record<string, number>;
  /** Description of the variance */
  description: string;
  /** Suggested action */
  suggestion?: string;
}

export interface PriceComparison {
  sku: string;
  productName: string;
  brand?: string;
  category?: string;
  /** Price at each store */
  priceByStore: Record<string, number>;
  /** Store names */
  storeNames: Record<string, string>;
  /** Lowest price */
  lowestPrice: number;
  /** Store with lowest price */
  lowestPriceStore: string;
  /** Highest price */
  highestPrice: number;
  /** Store with highest price */
  highestPriceStore: string;
  /** Price spread (max - min) */
  spread: number;
  /** Price spread as percentage of average */
  spreadPercent: number;
  /** Average price */
  averagePrice: number;
}

export interface AvailabilityMatrix {
  /** Product SKU */
  sku: string;
  /** Product name */
  productName: string;
  /** Whether the product is available at each store (true = in stock) */
  availableAt: Record<string, boolean>;
  /** Quantity at each store (0 if missing) */
  quantityAt: Record<string, number>;
  /** Number of stores that have it */
  storeCount: number;
  /** Total number of stores compared */
  totalStores: number;
  /** Availability percentage */
  availabilityPercent: number;
}

export interface ComparisonReport {
  /** Report title */
  title: string;
  /** When the comparison was generated */
  generatedAt: string;
  /** Stores included */
  stores: { storeId: string; storeName: string; sessionId: string; itemCount: number; capturedAt: string }[];
  /** Summary statistics */
  summary: ComparisonSummary;
  /** All variances detected */
  variances: Variance[];
  /** Price comparisons for products found at multiple stores */
  priceComparisons: PriceComparison[];
  /** Availability matrix */
  availability: AvailabilityMatrix[];
  /** Category-level breakdown */
  categoryBreakdown: CategoryComparison[];
}

export interface ComparisonSummary {
  totalStores: number;
  totalUniqueProducts: number;
  productsInAllStores: number;
  productsInSomeStores: number;
  exclusiveProducts: number;
  totalVariances: number;
  criticalVariances: number;
  warningVariances: number;
  avgPriceSpreadPercent: number;
  avgStockVariance: number;
}

export interface CategoryComparison {
  category: string;
  /** Product count per store */
  productCountByStore: Record<string, number>;
  /** Total quantity per store */
  totalQuantityByStore: Record<string, number>;
  /** Average price per store (where priced) */
  avgPriceByStore: Record<string, number>;
  /** Number of stores that carry this category */
  storesCoverage: number;
}

export interface TrendDataPoint {
  sessionId: string;
  capturedAt: string;
  quantity: number;
  price?: number;
}

export interface ProductTrend {
  sku: string;
  productName: string;
  storeId: string;
  storeName: string;
  dataPoints: TrendDataPoint[];
  /** Trend direction based on linear regression */
  quantityTrend: 'increasing' | 'decreasing' | 'stable';
  /** Average quantity change per session */
  avgQuantityDelta: number;
  /** Price trend (if enough data) */
  priceTrend?: 'increasing' | 'decreasing' | 'stable';
}

export interface ComparisonConfig {
  /** Quantity difference threshold to flag as variance (percentage) */
  quantityVarianceThresholdPercent: number;
  /** Price difference threshold to flag as variance (percentage) */
  priceVarianceThresholdPercent: number;
  /** Minimum quantity to consider "overstocked" vs average (multiplier) */
  overstockMultiplier: number;
  /** Maximum quantity to consider "understocked" vs average (multiplier) */
  understockMultiplier: number;
  /** Include products with zero quantity in comparisons */
  includeZeroQuantity: boolean;
  /** Minimum data points needed for trend analysis */
  minTrendDataPoints: number;
}

export const DEFAULT_COMPARISON_CONFIG: ComparisonConfig = {
  quantityVarianceThresholdPercent: 20,
  priceVarianceThresholdPercent: 10,
  overstockMultiplier: 2.0,
  understockMultiplier: 0.3,
  includeZeroQuantity: true,
  minTrendDataPoints: 3,
};

// ─── Main Engine ────────────────────────────────────────────────

export class StoreComparisonEngine {
  private config: ComparisonConfig;
  private snapshots: Map<string, StoreSnapshot> = new Map();

  constructor(config: Partial<ComparisonConfig> = {}) {
    this.config = { ...DEFAULT_COMPARISON_CONFIG, ...config };
  }

  // ─── Snapshot Management ──────────────────────────────────

  /**
   * Add a store inventory snapshot for comparison.
   * Key is storeId — adding a new snapshot for the same store replaces the previous one.
   */
  addSnapshot(snapshot: StoreSnapshot): void {
    this.snapshots.set(snapshot.storeId, snapshot);
  }

  /**
   * Remove a store snapshot.
   */
  removeSnapshot(storeId: string): boolean {
    return this.snapshots.delete(storeId);
  }

  /**
   * Get all loaded snapshots.
   */
  getSnapshots(): StoreSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  /**
   * Clear all snapshots.
   */
  clearSnapshots(): void {
    this.snapshots.clear();
  }

  /**
   * Get number of loaded snapshots.
   */
  getSnapshotCount(): number {
    return this.snapshots.size;
  }

  // ─── Comparison Analysis ──────────────────────────────────

  /**
   * Generate a full comparison report across all loaded snapshots.
   */
  generateReport(title?: string): ComparisonReport {
    const snapshots = this.getSnapshots();

    if (snapshots.length < 2) {
      return this.emptyReport(title || 'Store Comparison', snapshots);
    }

    const variances = this.detectVariances();
    const priceComparisons = this.comparePrices();
    const availability = this.buildAvailabilityMatrix();
    const categoryBreakdown = this.compareCategoryBreakdown();
    const summary = this.buildSummary(variances, priceComparisons, availability);

    return {
      title: title || `Store Comparison: ${snapshots.map(s => s.storeName).join(' vs ')}`,
      generatedAt: new Date().toISOString(),
      stores: snapshots.map(s => ({
        storeId: s.storeId,
        storeName: s.storeName,
        sessionId: s.sessionId,
        itemCount: s.items.length,
        capturedAt: s.capturedAt,
      })),
      summary,
      variances,
      priceComparisons,
      availability,
      categoryBreakdown,
    };
  }

  /**
   * Detect variances between stores.
   */
  detectVariances(): Variance[] {
    const variances: Variance[] = [];
    const snapshots = this.getSnapshots();
    if (snapshots.length < 2) return variances;

    const productMap = this.buildProductMap();
    const storeIds = snapshots.map(s => s.storeId);
    const storeNameMap = this.getStoreNameMap();

    for (const [sku, storeData] of productMap.entries()) {
      const storesWithProduct = Object.keys(storeData);
      const productName = storeData[storesWithProduct[0]]?.name || sku;

      // Missing product detection
      if (storesWithProduct.length < storeIds.length) {
        const missingStores = storeIds.filter(id => !storesWithProduct.includes(id));

        for (const missingStore of missingStores) {
          variances.push({
            type: storesWithProduct.length === 1 ? 'exclusive_product' : 'missing_at_store',
            severity: 'warning',
            sku,
            productName,
            storeIds: [...storesWithProduct, missingStore],
            storeNames: [...storesWithProduct, missingStore].map(id => storeNameMap[id] || id),
            values: { ...this.getQuantities(storeData), [missingStore]: 0 },
            description: storesWithProduct.length === 1
              ? `${productName} only found at ${storeNameMap[storesWithProduct[0]] || storesWithProduct[0]}`
              : `${productName} missing at ${storeNameMap[missingStore] || missingStore}`,
            suggestion: `Check if ${productName} should be stocked at ${storeNameMap[missingStore] || missingStore}`,
          });
        }
      }

      // Quantity variance detection (only for products at 2+ stores)
      if (storesWithProduct.length >= 2) {
        const quantities = storesWithProduct.map(sid => storeData[sid].quantity);
        const avgQty = quantities.reduce((a, b) => a + b, 0) / quantities.length;

        if (avgQty > 0) {
          for (const sid of storesWithProduct) {
            const qty = storeData[sid].quantity;
            const deviation = Math.abs(qty - avgQty) / avgQty * 100;

            if (deviation > this.config.quantityVarianceThresholdPercent) {
              const isOver = qty > avgQty * this.config.overstockMultiplier;
              const isUnder = qty < avgQty * this.config.understockMultiplier;

              if (isOver || isUnder) {
                variances.push({
                  type: isOver ? 'overstocked' : 'understocked',
                  severity: isUnder ? 'critical' : 'warning',
                  sku,
                  productName,
                  storeIds: [sid],
                  storeNames: [storeNameMap[sid] || sid],
                  values: this.getQuantities(storeData),
                  description: isOver
                    ? `${productName} overstocked at ${storeNameMap[sid] || sid}: ${qty} vs avg ${Math.round(avgQty)}`
                    : `${productName} understocked at ${storeNameMap[sid] || sid}: ${qty} vs avg ${Math.round(avgQty)}`,
                  suggestion: isOver
                    ? `Consider transferring stock from ${storeNameMap[sid] || sid} to lower-stock locations`
                    : `Restock ${productName} at ${storeNameMap[sid] || sid}`,
                });
              }
            }
          }
        }

        // Price variance detection
        const prices = storesWithProduct
          .filter(sid => storeData[sid].price != null && storeData[sid].price! > 0)
          .map(sid => ({ storeId: sid, price: storeData[sid].price! }));

        if (prices.length >= 2) {
          const avgPrice = prices.reduce((a, b) => a + b.price, 0) / prices.length;
          const minPrice = Math.min(...prices.map(p => p.price));
          const maxPrice = Math.max(...prices.map(p => p.price));
          const spread = maxPrice - minPrice;
          const spreadPercent = avgPrice > 0 ? (spread / avgPrice) * 100 : 0;

          if (spreadPercent > this.config.priceVarianceThresholdPercent) {
            const priceValues: Record<string, number> = {};
            for (const p of prices) priceValues[p.storeId] = p.price;

            variances.push({
              type: 'price_difference',
              severity: spreadPercent > 25 ? 'critical' : 'warning',
              sku,
              productName,
              storeIds: prices.map(p => p.storeId),
              storeNames: prices.map(p => storeNameMap[p.storeId] || p.storeId),
              values: priceValues,
              description: `${productName} price varies ${spreadPercent.toFixed(1)}%: $${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`,
              suggestion: `Investigate pricing for ${productName} — ${spreadPercent.toFixed(1)}% spread across stores`,
            });
          }
        }
      }
    }

    // Category gap detection
    const categoryMap = this.buildCategoryMap();
    for (const [category, storesWithCategory] of categoryMap.entries()) {
      if (storesWithCategory.size < storeIds.length) {
        const missingStores = storeIds.filter(id => !storesWithCategory.has(id));
        for (const missingStore of missingStores) {
          variances.push({
            type: 'category_gap',
            severity: 'info',
            category,
            storeIds: [missingStore],
            storeNames: [storeNameMap[missingStore] || missingStore],
            values: {},
            description: `Category "${category}" not found at ${storeNameMap[missingStore] || missingStore}`,
            suggestion: `Check if ${storeNameMap[missingStore] || missingStore} should carry "${category}" products`,
          });
        }
      }
    }

    return variances;
  }

  /**
   * Compare prices for products found at multiple stores.
   */
  comparePrices(): PriceComparison[] {
    const productMap = this.buildProductMap();
    const storeNameMap = this.getStoreNameMap();
    const comparisons: PriceComparison[] = [];

    for (const [sku, storeData] of productMap.entries()) {
      const storesWithPrice = Object.keys(storeData)
        .filter(sid => storeData[sid].price != null && storeData[sid].price! > 0);

      if (storesWithPrice.length < 2) continue;

      const priceByStore: Record<string, number> = {};
      const storeNames: Record<string, string> = {};
      for (const sid of storesWithPrice) {
        priceByStore[sid] = storeData[sid].price!;
        storeNames[sid] = storeNameMap[sid] || sid;
      }

      const prices = Object.values(priceByStore);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const spread = maxPrice - minPrice;
      const spreadPercent = avgPrice > 0 ? (spread / avgPrice) * 100 : 0;

      const lowestStore = storesWithPrice.find(s => priceByStore[s] === minPrice)!;
      const highestStore = storesWithPrice.find(s => priceByStore[s] === maxPrice)!;

      const first = storeData[storesWithPrice[0]];

      comparisons.push({
        sku,
        productName: first.name,
        brand: first.brand,
        category: first.category,
        priceByStore,
        storeNames,
        lowestPrice: minPrice,
        lowestPriceStore: lowestStore,
        highestPrice: maxPrice,
        highestPriceStore: highestStore,
        spread,
        spreadPercent: Math.round(spreadPercent * 10) / 10,
        averagePrice: Math.round(avgPrice * 100) / 100,
      });
    }

    // Sort by spread percentage (biggest differences first)
    comparisons.sort((a, b) => b.spreadPercent - a.spreadPercent);

    return comparisons;
  }

  /**
   * Build availability matrix showing which products are at which stores.
   */
  buildAvailabilityMatrix(): AvailabilityMatrix[] {
    const productMap = this.buildProductMap();
    const snapshots = this.getSnapshots();
    const storeIds = snapshots.map(s => s.storeId);
    const totalStores = storeIds.length;
    const matrix: AvailabilityMatrix[] = [];

    for (const [sku, storeData] of productMap.entries()) {
      const availableAt: Record<string, boolean> = {};
      const quantityAt: Record<string, number> = {};

      for (const sid of storeIds) {
        availableAt[sid] = sid in storeData;
        quantityAt[sid] = storeData[sid]?.quantity ?? 0;
      }

      const storeCount = Object.values(availableAt).filter(Boolean).length;
      const first = storeData[Object.keys(storeData)[0]];

      matrix.push({
        sku,
        productName: first.name,
        availableAt,
        quantityAt,
        storeCount,
        totalStores,
        availabilityPercent: totalStores > 0 ? Math.round((storeCount / totalStores) * 100) : 0,
      });
    }

    // Sort: least available first (to surface gaps)
    matrix.sort((a, b) => a.availabilityPercent - b.availabilityPercent);

    return matrix;
  }

  /**
   * Compare categories across stores.
   */
  compareCategoryBreakdown(): CategoryComparison[] {
    const snapshots = this.getSnapshots();
    const storeIds = snapshots.map(s => s.storeId);
    const categories = new Map<string, CategoryComparison>();

    for (const snapshot of snapshots) {
      const catGroups = new Map<string, ComparisonItem[]>();

      for (const item of snapshot.items) {
        const cat = item.category || 'Uncategorized';
        if (!catGroups.has(cat)) catGroups.set(cat, []);
        catGroups.get(cat)!.push(item);
      }

      for (const [cat, items] of catGroups.entries()) {
        if (!categories.has(cat)) {
          categories.set(cat, {
            category: cat,
            productCountByStore: {},
            totalQuantityByStore: {},
            avgPriceByStore: {},
            storesCoverage: 0,
          });
        }

        const comp = categories.get(cat)!;
        comp.productCountByStore[snapshot.storeId] = items.length;
        comp.totalQuantityByStore[snapshot.storeId] = items.reduce((sum, i) => sum + i.quantity, 0);

        const priced = items.filter(i => i.price != null && i.price > 0);
        if (priced.length > 0) {
          comp.avgPriceByStore[snapshot.storeId] =
            Math.round((priced.reduce((sum, i) => sum + i.price!, 0) / priced.length) * 100) / 100;
        }
      }
    }

    // Calculate store coverage
    for (const comp of categories.values()) {
      comp.storesCoverage = Object.keys(comp.productCountByStore).length;
    }

    return Array.from(categories.values())
      .sort((a, b) => a.storesCoverage - b.storesCoverage);
  }

  /**
   * Analyze quantity trends for a specific product across multiple sessions at the same store.
   */
  analyzeTrend(
    sku: string,
    sessions: StoreSnapshot[]
  ): ProductTrend | null {
    // Filter to sessions that contain this product
    const dataPoints: TrendDataPoint[] = [];

    for (const session of sessions) {
      const item = session.items.find(i => i.sku === sku);
      if (item) {
        dataPoints.push({
          sessionId: session.sessionId,
          capturedAt: session.capturedAt,
          quantity: item.quantity,
          price: item.price,
        });
      }
    }

    if (dataPoints.length < this.config.minTrendDataPoints) return null;

    // Sort by capture time
    dataPoints.sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());

    // Calculate quantity trend (simple linear regression)
    const quantityTrend = this.calculateTrend(dataPoints.map(d => d.quantity));
    const avgDelta = dataPoints.length > 1
      ? (dataPoints[dataPoints.length - 1].quantity - dataPoints[0].quantity) / (dataPoints.length - 1)
      : 0;

    // Calculate price trend if available
    const pricedPoints = dataPoints.filter(d => d.price != null);
    const priceTrend = pricedPoints.length >= this.config.minTrendDataPoints
      ? this.calculateTrend(pricedPoints.map(d => d.price!))
      : undefined;

    const firstSession = sessions[0];
    const firstItem = sessions.flatMap(s => s.items).find(i => i.sku === sku);

    return {
      sku,
      productName: firstItem?.name || sku,
      storeId: firstSession.storeId,
      storeName: firstSession.storeName,
      dataPoints,
      quantityTrend,
      avgQuantityDelta: Math.round(avgDelta * 10) / 10,
      priceTrend,
    };
  }

  // ─── Voice Summary ──────────────────────────────────────────

  /**
   * Generate a voice-friendly comparison summary.
   */
  getVoiceSummary(): string {
    const snapshots = this.getSnapshots();

    if (snapshots.length < 2) {
      return 'Need at least two store inventories to compare.';
    }

    const report = this.generateReport();
    const parts: string[] = [];

    parts.push(`Comparing ${report.summary.totalStores} stores with ${report.summary.totalUniqueProducts} unique products.`);

    if (report.summary.productsInAllStores > 0) {
      parts.push(`${report.summary.productsInAllStores} products found at all stores.`);
    }

    if (report.summary.exclusiveProducts > 0) {
      parts.push(`${report.summary.exclusiveProducts} products only at one store.`);
    }

    if (report.summary.criticalVariances > 0) {
      parts.push(`${report.summary.criticalVariances} critical issues found.`);
    }

    if (report.priceComparisons.length > 0) {
      const biggestSpread = report.priceComparisons[0];
      parts.push(
        `Biggest price difference: ${biggestSpread.productName} varies ${biggestSpread.spreadPercent}% across stores.`
      );
    }

    return parts.join(' ');
  }

  /**
   * Generate a markdown comparison report.
   */
  generateMarkdownReport(): string {
    const report = this.generateReport();
    const lines: string[] = [];

    lines.push(`# ${report.title}`);
    lines.push(`Generated: ${new Date(report.generatedAt).toLocaleString()}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push(`- **Stores compared:** ${report.summary.totalStores}`);
    lines.push(`- **Unique products:** ${report.summary.totalUniqueProducts}`);
    lines.push(`- **Products at all stores:** ${report.summary.productsInAllStores}`);
    lines.push(`- **Store-exclusive products:** ${report.summary.exclusiveProducts}`);
    lines.push(`- **Total variances:** ${report.summary.totalVariances} (${report.summary.criticalVariances} critical, ${report.summary.warningVariances} warning)`);
    lines.push(`- **Average price spread:** ${report.summary.avgPriceSpreadPercent}%`);
    lines.push('');

    // Store breakdown
    lines.push('## Stores');
    for (const store of report.stores) {
      lines.push(`- **${store.storeName}** (${store.storeId}): ${store.itemCount} items, captured ${new Date(store.capturedAt).toLocaleDateString()}`);
    }
    lines.push('');

    // Critical variances
    const critical = report.variances.filter(v => v.severity === 'critical');
    if (critical.length > 0) {
      lines.push('## 🚨 Critical Issues');
      for (const v of critical) {
        lines.push(`- **${v.productName || v.category}**: ${v.description}`);
        if (v.suggestion) lines.push(`  - Suggestion: ${v.suggestion}`);
      }
      lines.push('');
    }

    // Price comparisons (top 10)
    if (report.priceComparisons.length > 0) {
      lines.push('## 💰 Biggest Price Differences');
      const top = report.priceComparisons.slice(0, 10);
      for (const pc of top) {
        const storeLabels = Object.entries(pc.priceByStore)
          .map(([sid, price]) => `${pc.storeNames[sid]}: $${price.toFixed(2)}`)
          .join(', ');
        lines.push(`- **${pc.productName}** (${pc.spreadPercent}% spread): ${storeLabels}`);
      }
      lines.push('');
    }

    // Low availability products
    const lowAvail = report.availability.filter(a => a.availabilityPercent < 100);
    if (lowAvail.length > 0) {
      lines.push('## ⚠️ Incomplete Availability');
      const top = lowAvail.slice(0, 15);
      for (const a of top) {
        const storeList = Object.entries(a.availableAt)
          .filter(([, avail]) => !avail)
          .map(([sid]) => {
            const snap = this.snapshots.get(sid);
            return snap?.storeName || sid;
          })
          .join(', ');
        lines.push(`- **${a.productName}**: missing at ${storeList} (${a.availabilityPercent}% coverage)`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ─── Internal Helpers ─────────────────────────────────────

  private buildProductMap(): Map<string, Record<string, ComparisonItem>> {
    const map = new Map<string, Record<string, ComparisonItem>>();

    for (const snapshot of this.snapshots.values()) {
      for (const item of snapshot.items) {
        if (!this.config.includeZeroQuantity && item.quantity === 0) continue;

        if (!map.has(item.sku)) map.set(item.sku, {});
        map.get(item.sku)![snapshot.storeId] = item;
      }
    }

    return map;
  }

  private buildCategoryMap(): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();

    for (const snapshot of this.snapshots.values()) {
      for (const item of snapshot.items) {
        const cat = item.category || 'Uncategorized';
        if (!map.has(cat)) map.set(cat, new Set());
        map.get(cat)!.add(snapshot.storeId);
      }
    }

    return map;
  }

  private getStoreNameMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const snapshot of this.snapshots.values()) {
      map[snapshot.storeId] = snapshot.storeName;
    }
    return map;
  }

  private getQuantities(storeData: Record<string, ComparisonItem>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [sid, item] of Object.entries(storeData)) {
      result[sid] = item.quantity;
    }
    return result;
  }

  private buildSummary(
    variances: Variance[],
    priceComparisons: PriceComparison[],
    availability: AvailabilityMatrix[]
  ): ComparisonSummary {
    const snapshots = this.getSnapshots();
    const productMap = this.buildProductMap();
    const storeCount = snapshots.length;

    const allInAllStores = availability.filter(a => a.availabilityPercent === 100).length;
    const inSomeStores = availability.filter(a =>
      a.availabilityPercent > 0 && a.availabilityPercent < 100
    ).length;
    const exclusive = availability.filter(a => a.storeCount === 1).length;

    const avgSpread = priceComparisons.length > 0
      ? Math.round(
          (priceComparisons.reduce((sum, pc) => sum + pc.spreadPercent, 0) / priceComparisons.length) * 10
        ) / 10
      : 0;

    // Calculate average stock variance across all products at all stores
    let totalStockDeviation = 0;
    let stockDeviationCount = 0;
    for (const [, storeData] of productMap.entries()) {
      const quantities = Object.values(storeData).map(i => i.quantity);
      if (quantities.length >= 2) {
        const avg = quantities.reduce((a, b) => a + b, 0) / quantities.length;
        if (avg > 0) {
          for (const q of quantities) {
            totalStockDeviation += Math.abs(q - avg) / avg;
            stockDeviationCount++;
          }
        }
      }
    }

    const avgStockVariance = stockDeviationCount > 0
      ? Math.round((totalStockDeviation / stockDeviationCount) * 1000) / 10
      : 0;

    return {
      totalStores: storeCount,
      totalUniqueProducts: productMap.size,
      productsInAllStores: allInAllStores,
      productsInSomeStores: inSomeStores,
      exclusiveProducts: exclusive,
      totalVariances: variances.length,
      criticalVariances: variances.filter(v => v.severity === 'critical').length,
      warningVariances: variances.filter(v => v.severity === 'warning').length,
      avgPriceSpreadPercent: avgSpread,
      avgStockVariance,
    };
  }

  private calculateTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
    if (values.length < 2) return 'stable';

    // Simple linear regression slope
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i] - yMean);
      denominator += (i - xMean) ** 2;
    }

    if (denominator === 0) return 'stable';

    const slope = numerator / denominator;
    const relativeSlope = yMean !== 0 ? slope / Math.abs(yMean) : slope;

    // Threshold: less than 5% change per data point = stable
    if (Math.abs(relativeSlope) < 0.05) return 'stable';
    return relativeSlope > 0 ? 'increasing' : 'decreasing';
  }

  private emptyReport(title: string, snapshots: StoreSnapshot[]): ComparisonReport {
    return {
      title,
      generatedAt: new Date().toISOString(),
      stores: snapshots.map(s => ({
        storeId: s.storeId,
        storeName: s.storeName,
        sessionId: s.sessionId,
        itemCount: s.items.length,
        capturedAt: s.capturedAt,
      })),
      summary: {
        totalStores: snapshots.length,
        totalUniqueProducts: 0,
        productsInAllStores: 0,
        productsInSomeStores: 0,
        exclusiveProducts: 0,
        totalVariances: 0,
        criticalVariances: 0,
        warningVariances: 0,
        avgPriceSpreadPercent: 0,
        avgStockVariance: 0,
      },
      variances: [],
      priceComparisons: [],
      availability: [],
      categoryBreakdown: [],
    };
  }
}
