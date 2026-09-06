/**
 * Inventory Reconciliation Engine
 * 
 * Compares inventory counts across sessions, POS data, and expected values
 * to identify discrepancies, shrinkage, and anomalies.
 * 
 * Key capabilities:
 * - Cross-session comparison (this count vs. last count)
 * - POS reconciliation (counted vs. sold/received records)
 * - Shrinkage detection with root cause classification
 * - Variance analysis with statistical confidence
 * - Auto-generated discrepancy reports
 * - Voice-friendly summaries for real-time alerts
 * 
 * 🌙 Night Shift Agent — Shift #34
 */

import { EventEmitter } from 'events';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ReconciliationItem {
  sku: string;
  name: string;
  category?: string;
  location?: string;
  expectedQuantity: number;
  countedQuantity: number;
  unitCost?: number;
  unitPrice?: number;
}

export interface POSRecord {
  sku: string;
  name: string;
  quantitySold: number;
  quantityReceived: number;
  quantityReturned: number;
  quantityTransferred: number;
  periodStart: number;
  periodEnd: number;
}

export interface SessionSnapshot {
  sessionId: string;
  storeId: string;
  timestamp: number;
  items: Map<string, { quantity: number; confidence: number }>;
}

export type ShrinkageCategory =
  | 'theft_external'
  | 'theft_internal'
  | 'administrative_error'
  | 'vendor_fraud'
  | 'damage'
  | 'expiration'
  | 'miscount'
  | 'unknown';

export type VarianceDirection = 'over' | 'under' | 'match';

export interface VarianceResult {
  sku: string;
  name: string;
  category?: string;
  location?: string;
  expected: number;
  counted: number;
  variance: number;
  variancePercent: number;
  direction: VarianceDirection;
  valueLost: number;
  valueAtRetail: number;
  confidence: number;
  shrinkageCategory: ShrinkageCategory;
  flags: string[];
}

export interface ReconciliationReport {
  id: string;
  storeId: string;
  timestamp: number;
  periodStart: number;
  periodEnd: number;
  summary: ReconciliationSummary;
  variances: VarianceResult[];
  categoryBreakdown: Map<string, CategorySummary>;
  locationBreakdown: Map<string, LocationSummary>;
  shrinkageBreakdown: Map<ShrinkageCategory, ShrinkageSummary>;
  recommendations: string[];
}

export interface ReconciliationSummary {
  totalSkus: number;
  matchedSkus: number;
  overSkus: number;
  underSkus: number;
  matchRate: number;
  totalExpected: number;
  totalCounted: number;
  totalVariance: number;
  totalShrinkageValue: number;
  totalShrinkageRetail: number;
  shrinkageRate: number;
  highSeverityCount: number;
  mediumSeverityCount: number;
  lowSeverityCount: number;
}

export interface CategorySummary {
  category: string;
  totalSkus: number;
  totalVariance: number;
  shrinkageValue: number;
  shrinkageRate: number;
  topLosses: { sku: string; name: string; valueLost: number }[];
}

export interface LocationSummary {
  location: string;
  totalSkus: number;
  totalVariance: number;
  shrinkageValue: number;
  shrinkageRate: number;
}

export interface ShrinkageSummary {
  category: ShrinkageCategory;
  count: number;
  totalUnits: number;
  totalValue: number;
  percentage: number;
}

export interface ReconciliationConfig {
  /** Variance threshold (%) below which items are considered matching (default: 2) */
  matchThreshold: number;
  /** High severity threshold (%) for variance alerts (default: 20) */
  highSeverityThreshold: number;
  /** Medium severity threshold (%) for variance alerts (default: 10) */
  mediumSeverityThreshold: number;
  /** Minimum unit value to flag for investigation (default: 10) */
  minValueForFlag: number;
  /** Maximum items to include in voice summary (default: 5) */
  voiceSummaryMaxItems: number;
  /** Enable auto-categorization of shrinkage causes (default: true) */
  autoCategorize: boolean;
  /** Minimum confidence for counted items to be included (default: 0.5) */
  minCountConfidence: number;
  /** Maximum report history to retain (default: 100) */
  maxReportHistory: number;
}

const DEFAULT_CONFIG: ReconciliationConfig = {
  matchThreshold: 2,
  highSeverityThreshold: 20,
  mediumSeverityThreshold: 10,
  minValueForFlag: 10,
  voiceSummaryMaxItems: 5,
  autoCategorize: true,
  minCountConfidence: 0.5,
  maxReportHistory: 100,
};

// ─── Shrinkage Classification Rules ────────────────────────────────────────────

interface ShrinkageRule {
  category: ShrinkageCategory;
  match: (item: ReconciliationItem, variance: number, context: ClassificationContext) => boolean;
  priority: number;
}

interface ClassificationContext {
  highTheftCategories: Set<string>;
  highDamageCategories: Set<string>;
  vendorIssueCategories: Set<string>;
  expirableCategories: Set<string>;
  posData?: Map<string, POSRecord>;
}

const SHRINKAGE_RULES: ShrinkageRule[] = [
  // Small electronics, alcohol, cosmetics — likely external theft
  {
    category: 'theft_external',
    match: (item, variance, ctx) => {
      if (variance >= 0) return false;
      const cat = (item.category || '').toLowerCase();
      return ctx.highTheftCategories.has(cat) && Math.abs(variance) >= 3;
    },
    priority: 1,
  },
  // Large variance in low-visibility areas — possible internal theft
  {
    category: 'theft_internal',
    match: (item, variance, _ctx) => {
      if (variance >= 0) return false;
      const loc = (item.location || '').toLowerCase();
      const isBackArea = loc.includes('backroom') || loc.includes('stockroom') || loc.includes('warehouse');
      return isBackArea && Math.abs(variance) >= 5;
    },
    priority: 2,
  },
  // Overages often indicate receiving or scanning errors
  {
    category: 'administrative_error',
    match: (item, variance) => {
      return variance > 0;
    },
    priority: 5,
  },
  // Items that expire — could be damage/writeoff
  {
    category: 'expiration',
    match: (item, variance, ctx) => {
      if (variance >= 0) return false;
      const cat = (item.category || '').toLowerCase();
      return ctx.expirableCategories.has(cat);
    },
    priority: 3,
  },
  // Fragile items — damage
  {
    category: 'damage',
    match: (item, variance, ctx) => {
      if (variance >= 0) return false;
      const cat = (item.category || '').toLowerCase();
      return ctx.highDamageCategories.has(cat);
    },
    priority: 4,
  },
  // Vendor-heavy categories — vendor fraud
  {
    category: 'vendor_fraud',
    match: (item, variance, ctx) => {
      if (variance >= 0) return false;
      const cat = (item.category || '').toLowerCase();
      if (!ctx.vendorIssueCategories.has(cat)) return false;
      // If POS shows goods received but not found, vendor may have short-shipped
      if (ctx.posData) {
        const pos = ctx.posData.get(item.sku);
        if (pos && pos.quantityReceived > 0 && Math.abs(variance) > pos.quantityReceived * 0.1) {
          return true;
        }
      }
      return false;
    },
    priority: 3,
  },
  // Default fallback
  {
    category: 'unknown',
    match: () => true,
    priority: 100,
  },
];

// Default category sets for shrinkage classification
const DEFAULT_HIGH_THEFT: Set<string> = new Set([
  'electronics', 'alcohol', 'cosmetics', 'fragrances', 'jewelry',
  'tobacco', 'razors', 'batteries', 'medicine', 'otc',
  'health', 'beauty', 'small_appliances', 'gaming',
]);

const DEFAULT_HIGH_DAMAGE: Set<string> = new Set([
  'glass', 'ceramics', 'produce', 'bakery', 'floral',
  'frozen', 'fragile', 'wine', 'eggs',
]);

const DEFAULT_VENDOR_ISSUE: Set<string> = new Set([
  'produce', 'bakery', 'deli', 'meat', 'seafood',
  'dairy', 'vendor_managed',
]);

const DEFAULT_EXPIRABLE: Set<string> = new Set([
  'produce', 'bakery', 'deli', 'meat', 'seafood',
  'dairy', 'frozen', 'snacks', 'beverages', 'prepared_foods',
]);

// ─── Engine ────────────────────────────────────────────────────────────────────

export class ReconciliationEngine extends EventEmitter {
  private config: ReconciliationConfig;
  private reports: ReconciliationReport[] = [];
  private classificationContext: ClassificationContext;
  private snapshots: Map<string, SessionSnapshot[]> = new Map(); // storeId → snapshots

  constructor(config: Partial<ReconciliationConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.classificationContext = {
      highTheftCategories: DEFAULT_HIGH_THEFT,
      highDamageCategories: DEFAULT_HIGH_DAMAGE,
      vendorIssueCategories: DEFAULT_VENDOR_ISSUE,
      expirableCategories: DEFAULT_EXPIRABLE,
    };
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  getConfig(): ReconciliationConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<ReconciliationConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  setClassificationCategories(
    type: 'theft' | 'damage' | 'vendor' | 'expirable',
    categories: string[]
  ): void {
    const set = new Set(categories.map(c => c.toLowerCase()));
    switch (type) {
      case 'theft':
        this.classificationContext.highTheftCategories = set;
        break;
      case 'damage':
        this.classificationContext.highDamageCategories = set;
        break;
      case 'vendor':
        this.classificationContext.vendorIssueCategories = set;
        break;
      case 'expirable':
        this.classificationContext.expirableCategories = set;
        break;
    }
  }

  // ─── Snapshot Management ───────────────────────────────────────────────────

  addSnapshot(snapshot: SessionSnapshot): void {
    const existing = this.snapshots.get(snapshot.storeId) || [];
    existing.push(snapshot);
    // Keep sorted by timestamp
    existing.sort((a, b) => a.timestamp - b.timestamp);
    this.snapshots.set(snapshot.storeId, existing);
  }

  getSnapshots(storeId: string): SessionSnapshot[] {
    return this.snapshots.get(storeId) || [];
  }

  getLatestSnapshot(storeId: string): SessionSnapshot | null {
    const snaps = this.snapshots.get(storeId) || [];
    return snaps.length > 0 ? snaps[snaps.length - 1] : null;
  }

  clearSnapshots(storeId: string): void {
    this.snapshots.delete(storeId);
  }

  // ─── Core Reconciliation ───────────────────────────────────────────────────

  /**
   * Reconcile counted items against expected quantities.
   * Expected quantities can come from:
   *   - Previous session snapshot
   *   - POS data (opening + received - sold)
   *   - Manual expected counts
   */
  reconcile(
    storeId: string,
    items: ReconciliationItem[],
    posData?: Map<string, POSRecord>
  ): ReconciliationReport {
    const ctx: ClassificationContext = {
      ...this.classificationContext,
      posData,
    };

    // Calculate variances
    const variances: VarianceResult[] = items.map(item => 
      this.calculateVariance(item, ctx)
    );

    // Sort by absolute value lost (biggest losses first)
    variances.sort((a, b) => Math.abs(b.valueLost) - Math.abs(a.valueLost));

    // Build summary
    const summary = this.buildSummary(variances, items);

    // Build breakdowns
    const categoryBreakdown = this.buildCategoryBreakdown(variances);
    const locationBreakdown = this.buildLocationBreakdown(variances);
    const shrinkageBreakdown = this.buildShrinkageBreakdown(variances);

    // Generate recommendations
    const recommendations = this.generateRecommendations(variances, summary, shrinkageBreakdown);

    const report: ReconciliationReport = {
      id: this.generateId(),
      storeId,
      timestamp: Date.now(),
      periodStart: posData ? Math.min(...Array.from(posData.values()).map(p => p.periodStart)) : Date.now(),
      periodEnd: Date.now(),
      summary,
      variances,
      categoryBreakdown,
      locationBreakdown,
      shrinkageBreakdown,
      recommendations,
    };

    // Store report
    this.reports.push(report);
    if (this.reports.length > this.config.maxReportHistory) {
      this.reports = this.reports.slice(-this.config.maxReportHistory);
    }

    this.emit('reconciliation:complete', report);

    // Emit alerts for high-severity items
    const highSeverity = variances.filter(v => 
      v.direction === 'under' && 
      Math.abs(v.variancePercent) >= this.config.highSeverityThreshold
    );
    if (highSeverity.length > 0) {
      this.emit('reconciliation:alert', { severity: 'high', items: highSeverity });
    }

    return report;
  }

  /**
   * Reconcile two session snapshots against each other.
   * Useful for detecting changes between counts.
   */
  reconcileSnapshots(
    current: SessionSnapshot,
    previous: SessionSnapshot
  ): ReconciliationReport {
    const items: ReconciliationItem[] = [];
    const allSkus = new Set([
      ...Array.from(current.items.keys()),
      ...Array.from(previous.items.keys()),
    ]);

    for (const sku of allSkus) {
      const curr = current.items.get(sku);
      const prev = previous.items.get(sku);
      
      // Skip items below confidence threshold
      if (curr && curr.confidence < this.config.minCountConfidence) continue;
      if (prev && prev.confidence < this.config.minCountConfidence) continue;

      items.push({
        sku,
        name: sku, // Name not available from snapshots
        expectedQuantity: prev?.quantity || 0,
        countedQuantity: curr?.quantity || 0,
      });
    }

    return this.reconcile(current.storeId, items);
  }

  /**
   * Reconcile counted items against POS data.
   * Expected = previous count + received - sold - returned + transferred
   */
  reconcileWithPOS(
    storeId: string,
    countedItems: Map<string, { quantity: number; name: string; category?: string; location?: string }>,
    posData: Map<string, POSRecord>,
    previousCount?: Map<string, number>
  ): ReconciliationReport {
    const items: ReconciliationItem[] = [];
    const allSkus = new Set([
      ...Array.from(countedItems.keys()),
      ...Array.from(posData.keys()),
    ]);

    for (const sku of allSkus) {
      const counted = countedItems.get(sku);
      const pos = posData.get(sku);
      const prevQty = previousCount?.get(sku) || 0;

      // Calculate expected: previous + received - sold + returned - transferred
      let expected = prevQty;
      if (pos) {
        expected += pos.quantityReceived - pos.quantitySold + pos.quantityReturned - pos.quantityTransferred;
      }

      items.push({
        sku,
        name: counted?.name || pos?.name || sku,
        category: counted?.category,
        location: counted?.location,
        expectedQuantity: Math.max(0, expected),
        countedQuantity: counted?.quantity || 0,
      });
    }

    return this.reconcile(storeId, items, posData);
  }

  // ─── Report Access ─────────────────────────────────────────────────────────

  getReports(storeId?: string): ReconciliationReport[] {
    if (storeId) {
      return this.reports.filter(r => r.storeId === storeId);
    }
    return [...this.reports];
  }

  getLatestReport(storeId: string): ReconciliationReport | null {
    const reports = this.getReports(storeId);
    return reports.length > 0 ? reports[reports.length - 1] : null;
  }

  clearReports(): void {
    this.reports = [];
  }

  // ─── Trend Analysis ────────────────────────────────────────────────────────

  /**
   * Analyze shrinkage trends across multiple reports for a store.
   */
  analyzeTrend(storeId: string): {
    reports: number;
    avgShrinkageRate: number;
    shrinkageTrend: 'improving' | 'worsening' | 'stable' | 'insufficient_data';
    worstCategory: string | null;
    worstLocation: string | null;
    totalLoss: number;
  } {
    const reports = this.getReports(storeId);
    if (reports.length < 2) {
      return {
        reports: reports.length,
        avgShrinkageRate: reports.length === 1 ? reports[0].summary.shrinkageRate : 0,
        shrinkageTrend: 'insufficient_data',
        worstCategory: null,
        worstLocation: null,
        totalLoss: reports.reduce((sum, r) => sum + r.summary.totalShrinkageValue, 0),
      };
    }

    const rates = reports.map(r => r.summary.shrinkageRate);
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;

    // Determine trend using simple linear regression on recent rates
    const recentRates = rates.slice(-5);
    let trend: 'improving' | 'worsening' | 'stable' = 'stable';
    
    if (recentRates.length >= 2) {
      const firstHalf = recentRates.slice(0, Math.ceil(recentRates.length / 2));
      const secondHalf = recentRates.slice(Math.ceil(recentRates.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      
      const diff = secondAvg - firstAvg;
      if (diff > 1) trend = 'worsening';
      else if (diff < -1) trend = 'improving';
    }

    // Find worst category across all reports
    const categoryLosses = new Map<string, number>();
    const locationLosses = new Map<string, number>();
    
    for (const report of reports) {
      for (const [cat, summary] of report.categoryBreakdown) {
        categoryLosses.set(cat, (categoryLosses.get(cat) || 0) + summary.shrinkageValue);
      }
      for (const [loc, summary] of report.locationBreakdown) {
        locationLosses.set(loc, (locationLosses.get(loc) || 0) + summary.shrinkageValue);
      }
    }

    let worstCategory: string | null = null;
    let worstCategoryLoss = 0;
    for (const [cat, loss] of categoryLosses) {
      if (loss > worstCategoryLoss) {
        worstCategory = cat;
        worstCategoryLoss = loss;
      }
    }

    let worstLocation: string | null = null;
    let worstLocationLoss = 0;
    for (const [loc, loss] of locationLosses) {
      if (loss > worstLocationLoss) {
        worstLocation = loc;
        worstLocationLoss = loss;
      }
    }

    return {
      reports: reports.length,
      avgShrinkageRate: Math.round(avgRate * 100) / 100,
      shrinkageTrend: trend,
      worstCategory,
      worstLocation,
      totalLoss: reports.reduce((sum, r) => sum + r.summary.totalShrinkageValue, 0),
    };
  }

  // ─── Voice Summary ─────────────────────────────────────────────────────────

  generateVoiceSummary(report: ReconciliationReport): string {
    const { summary } = report;
    const parts: string[] = [];

    // Overall status
    if (summary.shrinkageRate <= 1) {
      parts.push(`Inventory reconciliation complete. Looking good — ${summary.matchRate.toFixed(0)}% match rate.`);
    } else if (summary.shrinkageRate <= 3) {
      parts.push(`Inventory reconciliation complete. ${summary.matchRate.toFixed(0)}% match rate. Some discrepancies found.`);
    } else {
      parts.push(`Inventory reconciliation complete. Attention needed — ${summary.shrinkageRate.toFixed(1)}% shrinkage rate detected.`);
    }

    // Key numbers
    parts.push(
      `${summary.totalSkus} items checked. ` +
      `${summary.matchedSkus} matched, ${summary.underSkus} under, ${summary.overSkus} over.`
    );

    // Value impact
    if (summary.totalShrinkageValue > 0) {
      parts.push(`Estimated loss: $${summary.totalShrinkageValue.toFixed(0)} at cost.`);
    }

    // Top losses
    const topLosses = report.variances
      .filter(v => v.direction === 'under' && v.valueLost > 0)
      .slice(0, this.config.voiceSummaryMaxItems);
    
    if (topLosses.length > 0) {
      parts.push('Top discrepancies:');
      for (const item of topLosses) {
        parts.push(
          `${item.name}: short ${Math.abs(item.variance)} units, ` +
          `$${item.valueLost.toFixed(0)} loss.`
        );
      }
    }

    // High severity alerts
    if (summary.highSeverityCount > 0) {
      parts.push(`${summary.highSeverityCount} high-severity items flagged for investigation.`);
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      parts.push(`Top recommendation: ${report.recommendations[0]}`);
    }

    return parts.join(' ');
  }

  // ─── Markdown Report ───────────────────────────────────────────────────────

  generateMarkdownReport(report: ReconciliationReport): string {
    const { summary } = report;
    const lines: string[] = [];

    lines.push(`# Inventory Reconciliation Report`);
    lines.push(`**Store:** ${report.storeId}`);
    lines.push(`**Date:** ${new Date(report.timestamp).toISOString()}`);
    lines.push(`**Report ID:** ${report.id}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total SKUs | ${summary.totalSkus} |`);
    lines.push(`| Matched | ${summary.matchedSkus} (${summary.matchRate.toFixed(1)}%) |`);
    lines.push(`| Over | ${summary.overSkus} |`);
    lines.push(`| Under | ${summary.underSkus} |`);
    lines.push(`| Shrinkage Rate | ${summary.shrinkageRate.toFixed(2)}% |`);
    lines.push(`| Shrinkage Value (cost) | $${summary.totalShrinkageValue.toFixed(2)} |`);
    lines.push(`| Shrinkage Value (retail) | $${summary.totalShrinkageRetail.toFixed(2)} |`);
    lines.push(`| High Severity | ${summary.highSeverityCount} |`);
    lines.push(`| Medium Severity | ${summary.mediumSeverityCount} |`);
    lines.push('');

    // Top discrepancies
    const topItems = report.variances
      .filter(v => v.direction !== 'match')
      .slice(0, 20);
    
    if (topItems.length > 0) {
      lines.push('## Top Discrepancies');
      lines.push('| SKU | Name | Expected | Counted | Variance | Value Lost | Category |');
      lines.push('|-----|------|----------|---------|----------|------------|----------|');
      for (const item of topItems) {
        const sign = item.variance > 0 ? '+' : '';
        lines.push(
          `| ${item.sku} | ${item.name} | ${item.expected} | ${item.counted} | ${sign}${item.variance} (${sign}${item.variancePercent.toFixed(1)}%) | $${item.valueLost.toFixed(2)} | ${item.shrinkageCategory} |`
        );
      }
      lines.push('');
    }

    // Shrinkage breakdown
    if (report.shrinkageBreakdown.size > 0) {
      lines.push('## Shrinkage Breakdown');
      lines.push('| Cause | Items | Units | Value | % of Total |');
      lines.push('|-------|-------|-------|-------|------------|');
      for (const [, cat] of report.shrinkageBreakdown) {
        lines.push(
          `| ${this.formatShrinkageCategory(cat.category)} | ${cat.count} | ${cat.totalUnits} | $${cat.totalValue.toFixed(2)} | ${cat.percentage.toFixed(1)}% |`
        );
      }
      lines.push('');
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('## Recommendations');
      for (const rec of report.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('*Generated by Inventory Vision × Reconciliation Engine*');

    return lines.join('\n');
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private calculateVariance(
    item: ReconciliationItem,
    ctx: ClassificationContext
  ): VarianceResult {
    const variance = item.countedQuantity - item.expectedQuantity;
    const variancePercent = item.expectedQuantity > 0
      ? (variance / item.expectedQuantity) * 100
      : (item.countedQuantity > 0 ? 100 : 0);

    const direction: VarianceDirection = 
      Math.abs(variancePercent) <= this.config.matchThreshold ? 'match' :
      variance > 0 ? 'over' : 'under';

    const unitCost = item.unitCost || 0;
    const unitPrice = item.unitPrice || unitCost;
    const valueLost = direction === 'under' ? Math.abs(variance) * unitCost : 0;
    const valueAtRetail = direction === 'under' ? Math.abs(variance) * unitPrice : 0;

    // Classify shrinkage
    let shrinkageCategory: ShrinkageCategory = 'unknown';
    if (this.config.autoCategorize && direction === 'under') {
      const sortedRules = [...SHRINKAGE_RULES].sort((a, b) => a.priority - b.priority);
      for (const rule of sortedRules) {
        if (rule.match(item, variance, ctx)) {
          shrinkageCategory = rule.category;
          break;
        }
      }
    } else if (direction === 'over') {
      shrinkageCategory = 'administrative_error';
    }

    // Generate flags
    const flags: string[] = [];
    if (direction === 'under' && Math.abs(variancePercent) >= this.config.highSeverityThreshold) {
      flags.push('high_severity');
    } else if (direction !== 'match' && Math.abs(variancePercent) >= this.config.mediumSeverityThreshold) {
      flags.push('medium_severity');
    }
    if (valueLost >= this.config.minValueForFlag) {
      flags.push('high_value_loss');
    }
    if (item.expectedQuantity > 0 && item.countedQuantity === 0) {
      flags.push('complete_stockout');
    }
    if (direction === 'over' && variance > item.expectedQuantity) {
      flags.push('major_overage');
    }

    // Confidence: higher when expected quantity is larger (bigger sample)
    const confidence = Math.min(1, 0.5 + (item.expectedQuantity / 100) * 0.5);

    return {
      sku: item.sku,
      name: item.name,
      category: item.category,
      location: item.location,
      expected: item.expectedQuantity,
      counted: item.countedQuantity,
      variance,
      variancePercent: Math.round(variancePercent * 100) / 100,
      direction,
      valueLost: Math.round(valueLost * 100) / 100,
      valueAtRetail: Math.round(valueAtRetail * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      shrinkageCategory,
      flags,
    };
  }

  private buildSummary(variances: VarianceResult[], items: ReconciliationItem[]): ReconciliationSummary {
    const matched = variances.filter(v => v.direction === 'match').length;
    const over = variances.filter(v => v.direction === 'over').length;
    const under = variances.filter(v => v.direction === 'under').length;
    const totalExpected = items.reduce((sum, i) => sum + i.expectedQuantity, 0);
    const totalCounted = items.reduce((sum, i) => sum + i.countedQuantity, 0);
    const totalVariance = totalCounted - totalExpected;
    const totalShrinkageValue = variances
      .filter(v => v.direction === 'under')
      .reduce((sum, v) => sum + v.valueLost, 0);
    const totalShrinkageRetail = variances
      .filter(v => v.direction === 'under')
      .reduce((sum, v) => sum + v.valueAtRetail, 0);
    const shrinkageRate = totalExpected > 0 
      ? (variances.filter(v => v.direction === 'under').reduce((sum, v) => sum + Math.abs(v.variance), 0) / totalExpected) * 100
      : 0;

    return {
      totalSkus: variances.length,
      matchedSkus: matched,
      overSkus: over,
      underSkus: under,
      matchRate: variances.length > 0 ? (matched / variances.length) * 100 : 100,
      totalExpected,
      totalCounted,
      totalVariance,
      totalShrinkageValue: Math.round(totalShrinkageValue * 100) / 100,
      totalShrinkageRetail: Math.round(totalShrinkageRetail * 100) / 100,
      shrinkageRate: Math.round(shrinkageRate * 100) / 100,
      highSeverityCount: variances.filter(v => v.flags.includes('high_severity')).length,
      mediumSeverityCount: variances.filter(v => v.flags.includes('medium_severity')).length,
      lowSeverityCount: variances.filter(v => 
        v.direction !== 'match' && 
        !v.flags.includes('high_severity') && 
        !v.flags.includes('medium_severity')
      ).length,
    };
  }

  private buildCategoryBreakdown(variances: VarianceResult[]): Map<string, CategorySummary> {
    const breakdown = new Map<string, CategorySummary>();

    for (const v of variances) {
      const cat = v.category || 'uncategorized';
      if (!breakdown.has(cat)) {
        breakdown.set(cat, {
          category: cat,
          totalSkus: 0,
          totalVariance: 0,
          shrinkageValue: 0,
          shrinkageRate: 0,
          topLosses: [],
        });
      }
      const summary = breakdown.get(cat)!;
      summary.totalSkus++;
      summary.totalVariance += v.variance;
      if (v.direction === 'under') {
        summary.shrinkageValue += v.valueLost;
        summary.topLosses.push({ sku: v.sku, name: v.name, valueLost: v.valueLost });
      }
    }

    // Sort top losses and calculate rates
    for (const [, summary] of breakdown) {
      summary.topLosses.sort((a, b) => b.valueLost - a.valueLost);
      summary.topLosses = summary.topLosses.slice(0, 5);
      const totalExpected = variances
        .filter(v => (v.category || 'uncategorized') === summary.category)
        .reduce((sum, v) => sum + v.expected, 0);
      summary.shrinkageRate = totalExpected > 0
        ? (Math.abs(summary.totalVariance) / totalExpected) * 100
        : 0;
      summary.shrinkageRate = Math.round(summary.shrinkageRate * 100) / 100;
      summary.shrinkageValue = Math.round(summary.shrinkageValue * 100) / 100;
    }

    return breakdown;
  }

  private buildLocationBreakdown(variances: VarianceResult[]): Map<string, LocationSummary> {
    const breakdown = new Map<string, LocationSummary>();

    for (const v of variances) {
      const loc = v.location || 'unknown';
      if (!breakdown.has(loc)) {
        breakdown.set(loc, {
          location: loc,
          totalSkus: 0,
          totalVariance: 0,
          shrinkageValue: 0,
          shrinkageRate: 0,
        });
      }
      const summary = breakdown.get(loc)!;
      summary.totalSkus++;
      summary.totalVariance += v.variance;
      if (v.direction === 'under') {
        summary.shrinkageValue += v.valueLost;
      }
    }

    // Calculate rates
    for (const [, summary] of breakdown) {
      const totalExpected = variances
        .filter(v => (v.location || 'unknown') === summary.location)
        .reduce((sum, v) => sum + v.expected, 0);
      summary.shrinkageRate = totalExpected > 0
        ? (Math.abs(summary.totalVariance) / totalExpected) * 100
        : 0;
      summary.shrinkageRate = Math.round(summary.shrinkageRate * 100) / 100;
      summary.shrinkageValue = Math.round(summary.shrinkageValue * 100) / 100;
    }

    return breakdown;
  }

  private buildShrinkageBreakdown(variances: VarianceResult[]): Map<ShrinkageCategory, ShrinkageSummary> {
    const breakdown = new Map<ShrinkageCategory, ShrinkageSummary>();
    const underItems = variances.filter(v => v.direction === 'under');
    const totalLoss = underItems.reduce((sum, v) => sum + v.valueLost, 0);

    for (const v of underItems) {
      if (!breakdown.has(v.shrinkageCategory)) {
        breakdown.set(v.shrinkageCategory, {
          category: v.shrinkageCategory,
          count: 0,
          totalUnits: 0,
          totalValue: 0,
          percentage: 0,
        });
      }
      const summary = breakdown.get(v.shrinkageCategory)!;
      summary.count++;
      summary.totalUnits += Math.abs(v.variance);
      summary.totalValue += v.valueLost;
    }

    // Calculate percentages
    for (const [, summary] of breakdown) {
      summary.percentage = totalLoss > 0 ? (summary.totalValue / totalLoss) * 100 : 0;
      summary.percentage = Math.round(summary.percentage * 100) / 100;
      summary.totalValue = Math.round(summary.totalValue * 100) / 100;
    }

    return breakdown;
  }

  private generateRecommendations(
    variances: VarianceResult[],
    summary: ReconciliationSummary,
    shrinkageBreakdown: Map<ShrinkageCategory, ShrinkageSummary>
  ): string[] {
    const recs: string[] = [];

    // High shrinkage rate
    if (summary.shrinkageRate > 5) {
      recs.push(
        `Shrinkage rate of ${summary.shrinkageRate.toFixed(1)}% exceeds industry average of 1.4%. ` +
        `Investigate top-loss items immediately.`
      );
    } else if (summary.shrinkageRate > 2) {
      recs.push(
        `Shrinkage rate of ${summary.shrinkageRate.toFixed(1)}% is above target. ` +
        `Focus on high-value discrepancies.`
      );
    }

    // Theft patterns
    const theftSummary = shrinkageBreakdown.get('theft_external');
    if (theftSummary && theftSummary.totalValue > 500) {
      recs.push(
        `External theft suspected in ${theftSummary.count} items ($${theftSummary.totalValue.toFixed(0)} loss). ` +
        `Consider additional security measures for affected categories.`
      );
    }

    const internalTheft = shrinkageBreakdown.get('theft_internal');
    if (internalTheft && internalTheft.count > 0) {
      recs.push(
        `Possible internal theft detected in backroom/stockroom areas. ` +
        `${internalTheft.count} items, $${internalTheft.totalValue.toFixed(0)} total.`
      );
    }

    // Complete stockouts
    const stockouts = variances.filter(v => v.flags.includes('complete_stockout'));
    if (stockouts.length > 0) {
      recs.push(
        `${stockouts.length} items have complete stockout (expected but not found). ` +
        `Verify if removed from shelves or if location has changed.`
      );
    }

    // Major overages
    const overages = variances.filter(v => v.flags.includes('major_overage'));
    if (overages.length > 0) {
      recs.push(
        `${overages.length} items show major overages. ` +
        `Check for receiving errors or miscategorized inventory.`
      );
    }

    // Vendor issues
    const vendorIssues = shrinkageBreakdown.get('vendor_fraud');
    if (vendorIssues && vendorIssues.count > 0) {
      recs.push(
        `${vendorIssues.count} items suggest vendor discrepancies. ` +
        `Cross-reference with purchase orders and receiving records.`
      );
    }

    // Recount suggestion for low-confidence items
    const lowConfidence = variances.filter(v => v.confidence < 0.6 && v.direction !== 'match');
    if (lowConfidence.length > 0) {
      recs.push(
        `${lowConfidence.length} discrepancies have low confidence. ` +
        `Consider recounting these items for accuracy.`
      );
    }

    return recs;
  }

  private formatShrinkageCategory(category: ShrinkageCategory): string {
    const labels: Record<ShrinkageCategory, string> = {
      theft_external: 'External Theft',
      theft_internal: 'Internal Theft',
      administrative_error: 'Admin Error',
      vendor_fraud: 'Vendor Discrepancy',
      damage: 'Damage/Breakage',
      expiration: 'Expiration/Spoilage',
      miscount: 'Miscount',
      unknown: 'Unknown',
    };
    return labels[category] || category;
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `recon-${timestamp}-${random}`;
  }
}
