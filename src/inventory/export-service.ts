/**
 * Export Service — Generate inventory reports in CSV/Excel/JSON formats.
 *
 * Takes an inventory session's items and produces downloadable reports
 * that store owners can use in their POS or accounting system.
 */

import type { InventoryItem, InventorySession, InventoryFlag } from '../types.js';

// ─── Types ──────────────────────────────────────────────────────

export type ExportFormat = 'csv' | 'json' | 'tsv';

export interface ExportOptions {
  /** Which format to export */
  format: ExportFormat;
  /** Which columns to include (empty = all) */
  columns?: ExportColumn[];
  /** Sort by this column */
  sortBy?: ExportColumn;
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
  /** Only include items matching these categories */
  categoryFilter?: string[];
  /** Only include items in these aisles */
  aisleFilter?: string[];
  /** Only include flagged items */
  flaggedOnly?: boolean;
  /** Include session metadata header */
  includeHeader?: boolean;
  /** Include summary row at the end */
  includeSummary?: boolean;
  /** Custom date format for timestamps */
  dateFormat?: 'iso' | 'us' | 'eu';
}

export type ExportColumn =
  | 'sku'
  | 'name'
  | 'brand'
  | 'category'
  | 'variant'
  | 'quantity'
  | 'price'
  | 'totalValue'
  | 'aisle'
  | 'shelf'
  | 'section'
  | 'confidence'
  | 'method'
  | 'flags'
  | 'verified'
  | 'firstSeen'
  | 'lastSeen';

const ALL_COLUMNS: ExportColumn[] = [
  'sku', 'name', 'brand', 'category', 'variant', 'quantity',
  'price', 'totalValue', 'aisle', 'shelf', 'section',
  'confidence', 'method', 'flags', 'verified', 'firstSeen', 'lastSeen',
];

const COLUMN_HEADERS: Record<ExportColumn, string> = {
  sku: 'SKU/UPC',
  name: 'Product Name',
  brand: 'Brand',
  category: 'Category',
  variant: 'Size/Variant',
  quantity: 'Quantity',
  price: 'Unit Price',
  totalValue: 'Total Value',
  aisle: 'Aisle',
  shelf: 'Shelf',
  section: 'Section',
  confidence: 'Confidence',
  method: 'ID Method',
  flags: 'Flags',
  verified: 'Verified',
  firstSeen: 'First Seen',
  lastSeen: 'Last Seen',
};

const DEFAULT_OPTIONS: ExportOptions = {
  format: 'csv',
  columns: ALL_COLUMNS,
  sortBy: 'category',
  sortDirection: 'asc',
  flaggedOnly: false,
  includeHeader: true,
  includeSummary: true,
  dateFormat: 'us',
};

// ─── Export Service ─────────────────────────────────────────────

export class ExportService {

  /**
   * Export inventory items to the specified format.
   * Returns the file content as a string (CSV/TSV/JSON).
   */
  export(
    items: InventoryItem[],
    session: InventorySession,
    options: Partial<ExportOptions> = {}
  ): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const columns = opts.columns || ALL_COLUMNS;

    // Apply filters
    let filtered = this.applyFilters(items, opts);

    // Apply sorting
    filtered = this.applySorting(filtered, opts);

    switch (opts.format) {
      case 'csv':
        return this.toCsv(filtered, session, columns, opts);
      case 'tsv':
        return this.toTsv(filtered, session, columns, opts);
      case 'json':
        return this.toJson(filtered, session, columns, opts);
      default:
        return this.toCsv(filtered, session, columns, opts);
    }
  }

  /**
   * Generate a summary report (markdown) for voice or text delivery.
   */
  generateSummary(items: InventoryItem[], session: InventorySession): string {
    const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
    const totalSKUs = items.length;
    const totalValue = items.reduce(
      (sum, i) => sum + (i.priceOnShelf || 0) * i.quantity,
      0
    );
    const flagged = items.filter((i) => i.flags.length > 0);
    const lowStock = items.filter((i) => i.flags.includes('low_stock'));
    const lowConfidence = items.filter(
      (i) => i.countConfidence < 0.7 && !i.manuallyVerified
    );
    const verified = items.filter((i) => i.manuallyVerified);
    const categories = this.groupByCategory(items);
    const aisles = this.groupByAisle(items);

    const duration = session.completedAt
      ? this.formatDuration(
          new Date(session.startedAt).getTime(),
          new Date(session.completedAt).getTime()
        )
      : 'In progress';

    let md = `# Inventory Report: ${session.name}\n\n`;
    md += `**Store:** ${session.storeName || 'N/A'}\n`;
    md += `**Date:** ${this.formatDate(session.startedAt, 'us')}\n`;
    md += `**Duration:** ${duration}\n`;
    md += `**Status:** ${session.status}\n\n`;

    md += `## Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total SKUs | ${totalSKUs.toLocaleString()} |\n`;
    md += `| Total Items | ${totalItems.toLocaleString()} |\n`;
    md += `| Estimated Value | $${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |\n`;
    md += `| Images Processed | ${session.stats.imagesProcessed} |\n`;
    md += `| Aisles Covered | ${session.stats.aislesCovered.length} |\n`;
    md += `| Estimated Accuracy | ${(session.stats.estimatedAccuracy * 100).toFixed(1)}% |\n`;
    md += `| Manually Verified | ${verified.length} |\n`;
    md += `| Flagged Items | ${flagged.length} |\n`;
    md += `| Items/Minute | ${session.stats.itemsPerMinute} |\n\n`;

    if (categories.length > 0) {
      md += `## By Category\n\n`;
      md += `| Category | SKUs | Items | Value |\n`;
      md += `|----------|------|-------|-------|\n`;
      for (const cat of categories) {
        md += `| ${cat.name} | ${cat.skus} | ${cat.items} | $${cat.value.toFixed(2)} |\n`;
      }
      md += '\n';
    }

    if (aisles.length > 0) {
      md += `## By Aisle\n\n`;
      md += `| Aisle | SKUs | Items |\n`;
      md += `|-------|------|-------|\n`;
      for (const aisle of aisles) {
        md += `| ${aisle.name} | ${aisle.skus} | ${aisle.items} |\n`;
      }
      md += '\n';
    }

    if (lowStock.length > 0) {
      md += `## ⚠️ Low Stock (${lowStock.length} items)\n\n`;
      for (const item of lowStock.slice(0, 20)) {
        md += `- **${item.name}** — ${item.quantity} remaining (Aisle ${item.location.aisle || '?'})\n`;
      }
      if (lowStock.length > 20) {
        md += `- ... and ${lowStock.length - 20} more\n`;
      }
      md += '\n';
    }

    if (lowConfidence.length > 0) {
      md += `## 🔍 Needs Review (${lowConfidence.length} items)\n\n`;
      for (const item of lowConfidence.slice(0, 10)) {
        md += `- **${item.name}** — Count: ${item.quantity}, Confidence: ${(item.countConfidence * 100).toFixed(0)}%\n`;
      }
      if (lowConfidence.length > 10) {
        md += `- ... and ${lowConfidence.length - 10} more\n`;
      }
      md += '\n';
    }

    return md;
  }

  /**
   * Generate a short voice-friendly summary (for TTS delivery).
   */
  generateVoiceSummary(items: InventoryItem[], session: InventorySession): string {
    const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
    const totalSKUs = items.length;
    const flagged = items.filter((i) => i.flags.length > 0);
    const lowStock = items.filter((i) => i.flags.includes('low_stock'));

    let summary = `Inventory ${session.status === 'completed' ? 'complete' : 'update'}. `;
    summary += `${totalSKUs} unique products found. ${totalItems} total items counted. `;
    summary += `${session.stats.aislesCovered.length} aisles covered. `;

    if (flagged.length > 0) {
      summary += `${flagged.length} items flagged for attention. `;
    }

    if (lowStock.length > 0) {
      summary += `${lowStock.length} items are running low. `;
      // Name the top 3 low stock items
      const topLow = lowStock.slice(0, 3);
      summary += `Includes: ${topLow.map((i) => i.name).join(', ')}. `;
    }

    summary += `Estimated accuracy: ${(session.stats.estimatedAccuracy * 100).toFixed(0)} percent.`;

    return summary;
  }

  // ─── Private: Format Generators ───────────────────────────────

  private toCsv(
    items: InventoryItem[],
    session: InventorySession,
    columns: ExportColumn[],
    opts: ExportOptions
  ): string {
    return this.toDelimited(items, session, columns, opts, ',');
  }

  private toTsv(
    items: InventoryItem[],
    session: InventorySession,
    columns: ExportColumn[],
    opts: ExportOptions
  ): string {
    return this.toDelimited(items, session, columns, opts, '\t');
  }

  private toDelimited(
    items: InventoryItem[],
    session: InventorySession,
    columns: ExportColumn[],
    opts: ExportOptions,
    delimiter: string
  ): string {
    const lines: string[] = [];

    // Header metadata
    if (opts.includeHeader) {
      lines.push(`# Inventory Report: ${session.name}`);
      lines.push(`# Store: ${session.storeName || 'N/A'}`);
      lines.push(`# Date: ${this.formatDate(session.startedAt, opts.dateFormat || 'us')}`);
      lines.push(`# Total SKUs: ${items.length}`);
      lines.push(`# Total Items: ${items.reduce((s, i) => s + i.quantity, 0)}`);
      lines.push('');
    }

    // Column headers
    lines.push(columns.map((col) => this.escapeDelimited(COLUMN_HEADERS[col], delimiter)).join(delimiter));

    // Data rows
    for (const item of items) {
      const row = columns.map((col) => {
        const value = this.getColumnValue(item, col, opts.dateFormat || 'us');
        return this.escapeDelimited(value, delimiter);
      });
      lines.push(row.join(delimiter));
    }

    // Summary row
    if (opts.includeSummary) {
      lines.push('');
      const totalQty = items.reduce((s, i) => s + i.quantity, 0);
      const totalVal = items.reduce(
        (s, i) => s + (i.priceOnShelf || 0) * i.quantity,
        0
      );
      lines.push(
        `# TOTALS: ${items.length} SKUs${delimiter}${totalQty} items${delimiter}$${totalVal.toFixed(2)} estimated value`
      );
    }

    return lines.join('\n');
  }

  private toJson(
    items: InventoryItem[],
    session: InventorySession,
    _columns: ExportColumn[],
    opts: ExportOptions
  ): string {
    const data = {
      report: {
        name: session.name,
        store: session.storeName,
        date: session.startedAt,
        completedAt: session.completedAt,
        status: session.status,
      },
      summary: {
        totalSKUs: items.length,
        totalItems: items.reduce((s, i) => s + i.quantity, 0),
        totalValue: items.reduce(
          (s, i) => s + (i.priceOnShelf || 0) * i.quantity,
          0
        ),
        imagesProcessed: session.stats.imagesProcessed,
        aislesCovered: session.stats.aislesCovered,
        estimatedAccuracy: session.stats.estimatedAccuracy,
        flaggedItems: items.filter((i) => i.flags.length > 0).length,
      },
      items: items.map((item) => ({
        sku: item.sku,
        name: item.name,
        brand: item.brand || '',
        category: item.category || '',
        variant: item.variant || '',
        quantity: item.quantity,
        unitPrice: item.priceOnShelf || null,
        totalValue: item.priceOnShelf
          ? item.priceOnShelf * item.quantity
          : null,
        location: item.location,
        confidence: item.countConfidence,
        identificationMethod: item.identificationMethod,
        flags: item.flags,
        manuallyVerified: item.manuallyVerified,
        firstSeen: item.firstSeenAt,
        lastSeen: item.lastSeenAt,
      })),
    };

    return JSON.stringify(data, null, 2);
  }

  // ─── Private: Filters & Sorting ───────────────────────────────

  private applyFilters(
    items: InventoryItem[],
    opts: ExportOptions
  ): InventoryItem[] {
    let filtered = [...items];

    if (opts.flaggedOnly) {
      filtered = filtered.filter((i) => i.flags.length > 0);
    }

    if (opts.categoryFilter && opts.categoryFilter.length > 0) {
      const categories = new Set(
        opts.categoryFilter.map((c) => c.toLowerCase())
      );
      filtered = filtered.filter(
        (i) => i.category && categories.has(i.category.toLowerCase())
      );
    }

    if (opts.aisleFilter && opts.aisleFilter.length > 0) {
      const aisles = new Set(opts.aisleFilter);
      filtered = filtered.filter(
        (i) => i.location.aisle && aisles.has(i.location.aisle)
      );
    }

    return filtered;
  }

  private applySorting(
    items: InventoryItem[],
    opts: ExportOptions
  ): InventoryItem[] {
    if (!opts.sortBy) return items;

    const direction = opts.sortDirection === 'desc' ? -1 : 1;

    return [...items].sort((a, b) => {
      const aVal = this.getSortValue(a, opts.sortBy!);
      const bVal = this.getSortValue(b, opts.sortBy!);

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * direction;
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * direction;
      }
      return 0;
    });
  }

  private getSortValue(item: InventoryItem, column: ExportColumn): string | number {
    switch (column) {
      case 'sku': return item.sku;
      case 'name': return item.name;
      case 'brand': return item.brand || '';
      case 'category': return item.category || '';
      case 'quantity': return item.quantity;
      case 'price': return item.priceOnShelf || 0;
      case 'totalValue': return (item.priceOnShelf || 0) * item.quantity;
      case 'confidence': return item.countConfidence;
      case 'aisle': return item.location.aisle || '';
      default: return item.name;
    }
  }

  private getColumnValue(
    item: InventoryItem,
    column: ExportColumn,
    dateFormat: string
  ): string {
    switch (column) {
      case 'sku': return item.sku;
      case 'name': return item.name;
      case 'brand': return item.brand || '';
      case 'category': return item.category || '';
      case 'variant': return item.variant || '';
      case 'quantity': return String(item.quantity);
      case 'price': return item.priceOnShelf ? `$${item.priceOnShelf.toFixed(2)}` : '';
      case 'totalValue':
        return item.priceOnShelf
          ? `$${(item.priceOnShelf * item.quantity).toFixed(2)}`
          : '';
      case 'aisle': return item.location.aisle || '';
      case 'shelf': return item.location.shelf || '';
      case 'section': return item.location.section || '';
      case 'confidence': return `${(item.countConfidence * 100).toFixed(0)}%`;
      case 'method': return item.identificationMethod;
      case 'flags': return item.flags.join(', ');
      case 'verified': return item.manuallyVerified ? 'Yes' : 'No';
      case 'firstSeen': return this.formatDate(item.firstSeenAt, dateFormat);
      case 'lastSeen': return this.formatDate(item.lastSeenAt, dateFormat);
      default: return '';
    }
  }

  // ─── Private: Helpers ─────────────────────────────────────────

  private escapeDelimited(value: string, delimiter: string): string {
    // If value contains delimiter, quotes, or newlines, wrap in quotes
    if (
      value.includes(delimiter) ||
      value.includes('"') ||
      value.includes('\n')
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private formatDate(iso: string, format: string): string {
    const d = new Date(iso);
    switch (format) {
      case 'us':
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      case 'eu':
        return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      default:
        return iso;
    }
  }

  private formatDuration(startMs: number, endMs: number): string {
    const diffMs = endMs - startMs;
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  private groupByCategory(
    items: InventoryItem[]
  ): Array<{ name: string; skus: number; items: number; value: number }> {
    const groups = new Map<string, { skus: number; items: number; value: number }>();

    for (const item of items) {
      const cat = item.category || 'Uncategorized';
      const existing = groups.get(cat) || { skus: 0, items: 0, value: 0 };
      existing.skus++;
      existing.items += item.quantity;
      existing.value += (item.priceOnShelf || 0) * item.quantity;
      groups.set(cat, existing);
    }

    return Array.from(groups.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.items - a.items);
  }

  private groupByAisle(
    items: InventoryItem[]
  ): Array<{ name: string; skus: number; items: number }> {
    const groups = new Map<string, { skus: number; items: number }>();

    for (const item of items) {
      const aisle = item.location.aisle || 'Unknown';
      const existing = groups.get(aisle) || { skus: 0, items: 0 };
      existing.skus++;
      existing.items += item.quantity;
      groups.set(aisle, existing);
    }

    return Array.from(groups.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
