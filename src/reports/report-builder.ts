/**
 * Report Builder Engine — Ray-Bans × OpenClaw
 *
 * Generates professional structured reports from inventory sessions,
 * inspections, comparisons, and other platform data. Outputs:
 * - Structured markdown reports
 * - JSON data exports
 * - Voice-friendly summaries
 * - Executive summary briefs
 *
 * Template-based system with customizable sections, branding,
 * conditional rendering, and compliance-ready formatting.
 *
 * 🌙 Night Shift Agent — 2026-03-07
 */

// ─── Types ──────────────────────────────────────────────────────

export type ReportFormat = 'markdown' | 'json' | 'csv' | 'voice';

export type ReportType =
  | 'inventory_session'        // Single session inventory report
  | 'inventory_comparison'     // Multi-store comparison report
  | 'inspection'               // Property/facility inspection report
  | 'meeting_summary'          // Meeting intelligence summary
  | 'deal_analysis'            // Deal/price analysis report
  | 'security_scan'            // Security assessment report
  | 'daily_summary'            // End-of-day summary
  | 'weekly_digest'            // Weekly digest
  | 'custom';                  // Custom template

export type SectionType =
  | 'header'
  | 'summary'
  | 'table'
  | 'list'
  | 'metrics'
  | 'chart_data'
  | 'findings'
  | 'recommendations'
  | 'images'
  | 'timeline'
  | 'text'
  | 'divider'
  | 'footer';

export interface ReportSection {
  /** Section identifier */
  id: string;
  /** Section type determines rendering */
  type: SectionType;
  /** Section title */
  title?: string;
  /** Raw content for text/markdown sections */
  content?: string;
  /** Structured data for tables, lists, metrics */
  data?: unknown;
  /** Whether to include this section (for conditional rendering) */
  visible: boolean;
  /** Display order */
  order: number;
  /** Subsections (nested) */
  subsections?: ReportSection[];
}

export interface ReportMetric {
  /** Metric label */
  label: string;
  /** Metric value */
  value: number | string;
  /** Unit (e.g., "$", "items", "%") */
  unit?: string;
  /** Previous value for comparison */
  previousValue?: number;
  /** Change direction indicator */
  trend?: 'up' | 'down' | 'stable';
  /** Whether this metric is highlighted/important */
  highlighted?: boolean;
}

export interface ReportFinding {
  /** Finding severity */
  severity: 'critical' | 'major' | 'minor' | 'info';
  /** Short title */
  title: string;
  /** Detailed description */
  description: string;
  /** Location/context */
  location?: string;
  /** Recommended action */
  recommendation?: string;
  /** Image references */
  imageRefs?: string[];
  /** Estimated cost to address */
  estimatedCost?: number;
}

export interface TableData {
  /** Column headers */
  headers: string[];
  /** Row data */
  rows: (string | number | null)[][];
  /** Column alignments */
  alignments?: ('left' | 'center' | 'right')[];
  /** Footer/totals row */
  footer?: (string | number | null)[];
  /** Sort column index */
  sortColumn?: number;
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
}

export interface TimelineEvent {
  /** Timestamp */
  timestamp: string;
  /** Event description */
  description: string;
  /** Event type/icon */
  type: 'start' | 'milestone' | 'issue' | 'completion' | 'note';
  /** Duration (for spans) */
  durationMs?: number;
}

export interface ReportTemplate {
  /** Template identifier */
  id: string;
  /** Template display name */
  name: string;
  /** Report type this template is for */
  reportType: ReportType;
  /** Section layout */
  sections: ReportSection[];
  /** Branding/styling config */
  branding: ReportBranding;
  /** Auto-calculate certain metrics */
  autoCalculations: AutoCalculation[];
}

export interface ReportBranding {
  /** Company/product name in header */
  companyName: string;
  /** Report title prefix */
  titlePrefix?: string;
  /** Footer text */
  footerText?: string;
  /** Include generated timestamp */
  showTimestamp: boolean;
  /** Include "Confidential" watermark */
  confidential: boolean;
  /** Report numbering format */
  numberFormat?: string;
}

export interface AutoCalculation {
  /** Target section ID to populate */
  targetSectionId: string;
  /** Calculation type */
  type: 'sum' | 'average' | 'count' | 'min' | 'max' | 'percentage';
  /** Source data path */
  sourcePath: string;
  /** Label for the calculated metric */
  label: string;
  /** Unit */
  unit?: string;
}

export interface ReportConfig {
  /** Default branding */
  defaultBranding: ReportBranding;
  /** Maximum sections per report */
  maxSections: number;
  /** Maximum table rows (truncate if exceeded) */
  maxTableRows: number;
  /** Date format for display */
  dateFormat: 'iso' | 'us' | 'eu' | 'relative';
  /** Include empty sections */
  includeEmptySections: boolean;
  /** Voice summary max characters */
  voiceSummaryMaxChars: number;
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  defaultBranding: {
    companyName: 'Ray-Bans × OpenClaw',
    titlePrefix: '',
    footerText: '🌙 Generated by Ray-Bans × OpenClaw Vision Platform',
    showTimestamp: true,
    confidential: false,
  },
  maxSections: 50,
  maxTableRows: 500,
  dateFormat: 'us',
  includeEmptySections: false,
  voiceSummaryMaxChars: 500,
};

export interface GeneratedReport {
  /** Report type */
  type: ReportType;
  /** Report title */
  title: string;
  /** When generated */
  generatedAt: string;
  /** Sections */
  sections: ReportSection[];
  /** Branding */
  branding: ReportBranding;
  /** Export in different formats */
  toMarkdown: () => string;
  toJSON: () => object;
  toCSV: () => string;
  toVoiceSummary: () => string;
}

// ─── Built-in Templates ─────────────────────────────────────────

const INVENTORY_SESSION_TEMPLATE: ReportTemplate = {
  id: 'inventory-session-v1',
  name: 'Inventory Session Report',
  reportType: 'inventory_session',
  sections: [
    { id: 'header', type: 'header', visible: true, order: 0 },
    { id: 'executive-summary', type: 'summary', title: 'Executive Summary', visible: true, order: 1 },
    { id: 'key-metrics', type: 'metrics', title: 'Key Metrics', visible: true, order: 2 },
    { id: 'product-table', type: 'table', title: 'Product Inventory', visible: true, order: 3 },
    { id: 'flagged-items', type: 'findings', title: 'Flagged Items', visible: true, order: 4 },
    { id: 'category-breakdown', type: 'table', title: 'Category Breakdown', visible: true, order: 5 },
    { id: 'timeline', type: 'timeline', title: 'Session Timeline', visible: true, order: 6 },
    { id: 'recommendations', type: 'recommendations', title: 'Recommendations', visible: true, order: 7 },
    { id: 'footer', type: 'footer', visible: true, order: 99 },
  ],
  branding: DEFAULT_REPORT_CONFIG.defaultBranding,
  autoCalculations: [],
};

const INSPECTION_TEMPLATE: ReportTemplate = {
  id: 'inspection-v1',
  name: 'Inspection Report',
  reportType: 'inspection',
  sections: [
    { id: 'header', type: 'header', visible: true, order: 0 },
    { id: 'executive-summary', type: 'summary', title: 'Executive Summary', visible: true, order: 1 },
    { id: 'overall-condition', type: 'metrics', title: 'Overall Condition', visible: true, order: 2 },
    { id: 'findings', type: 'findings', title: 'Findings', visible: true, order: 3 },
    { id: 'area-breakdown', type: 'table', title: 'Area Breakdown', visible: true, order: 4 },
    { id: 'cost-estimates', type: 'metrics', title: 'Remediation Cost Estimates', visible: true, order: 5 },
    { id: 'recommendations', type: 'recommendations', title: 'Recommendations', visible: true, order: 6 },
    { id: 'images', type: 'images', title: 'Photo Evidence', visible: true, order: 7 },
    { id: 'footer', type: 'footer', visible: true, order: 99 },
  ],
  branding: {
    ...DEFAULT_REPORT_CONFIG.defaultBranding,
    confidential: true,
  },
  autoCalculations: [],
};

const DAILY_SUMMARY_TEMPLATE: ReportTemplate = {
  id: 'daily-summary-v1',
  name: 'Daily Summary',
  reportType: 'daily_summary',
  sections: [
    { id: 'header', type: 'header', visible: true, order: 0 },
    { id: 'highlights', type: 'summary', title: 'Today\'s Highlights', visible: true, order: 1 },
    { id: 'metrics', type: 'metrics', title: 'Activity Metrics', visible: true, order: 2 },
    { id: 'sessions', type: 'table', title: 'Sessions', visible: true, order: 3 },
    { id: 'notable-findings', type: 'findings', title: 'Notable Findings', visible: true, order: 4 },
    { id: 'footer', type: 'footer', visible: true, order: 99 },
  ],
  branding: DEFAULT_REPORT_CONFIG.defaultBranding,
  autoCalculations: [],
};

export const BUILT_IN_TEMPLATES: Record<string, ReportTemplate> = {
  'inventory-session-v1': INVENTORY_SESSION_TEMPLATE,
  'inspection-v1': INSPECTION_TEMPLATE,
  'daily-summary-v1': DAILY_SUMMARY_TEMPLATE,
};

// ─── Severity emoji map ─────────────────────────────────────────

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  major: '🟠',
  minor: '🟡',
  info: '🔵',
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  info: 3,
};

// ─── Main Builder Class ─────────────────────────────────────────

export class ReportBuilder {
  private config: ReportConfig;
  private customTemplates: Map<string, ReportTemplate> = new Map();

  constructor(config: Partial<ReportConfig> = {}) {
    this.config = { ...DEFAULT_REPORT_CONFIG, ...config };
    if (config.defaultBranding) {
      this.config.defaultBranding = { ...DEFAULT_REPORT_CONFIG.defaultBranding, ...config.defaultBranding };
    }
  }

  // ─── Template Management ──────────────────────────────────

  /**
   * Register a custom report template.
   */
  registerTemplate(template: ReportTemplate): void {
    this.customTemplates.set(template.id, template);
  }

  /**
   * Get a template by ID (checks custom first, then built-in).
   */
  getTemplate(id: string): ReportTemplate | undefined {
    return this.customTemplates.get(id) || BUILT_IN_TEMPLATES[id];
  }

  /**
   * List all available template IDs.
   */
  listTemplates(): string[] {
    const builtIn = Object.keys(BUILT_IN_TEMPLATES);
    const custom = Array.from(this.customTemplates.keys());
    return [...new Set([...builtIn, ...custom])];
  }

  // ─── Report Generation ────────────────────────────────────

  /**
   * Build a report from a template and data.
   */
  buildReport(options: {
    templateId?: string;
    reportType: ReportType;
    title: string;
    sections: ReportSection[];
    branding?: Partial<ReportBranding>;
  }): GeneratedReport {
    const template = options.templateId
      ? this.getTemplate(options.templateId)
      : undefined;

    const branding: ReportBranding = {
      ...this.config.defaultBranding,
      ...(template?.branding || {}),
      ...(options.branding || {}),
    };

    // Sort sections by order
    let sections = [...options.sections].sort((a, b) => a.order - b.order);

    // Filter invisible and empty sections
    if (!this.config.includeEmptySections) {
      sections = sections.filter(s => s.visible && this.sectionHasContent(s));
    } else {
      sections = sections.filter(s => s.visible);
    }

    // Truncate if too many
    if (sections.length > this.config.maxSections) {
      sections = sections.slice(0, this.config.maxSections);
    }

    const report: GeneratedReport = {
      type: options.reportType,
      title: branding.titlePrefix
        ? `${branding.titlePrefix} ${options.title}`
        : options.title,
      generatedAt: new Date().toISOString(),
      sections,
      branding,
      toMarkdown: () => this.renderMarkdown(report),
      toJSON: () => this.renderJSON(report),
      toCSV: () => this.renderCSV(report),
      toVoiceSummary: () => this.renderVoiceSummary(report),
    };

    return report;
  }

  /**
   * Quick builder for inventory session reports.
   */
  buildInventoryReport(data: {
    sessionName: string;
    storeName?: string;
    startTime: string;
    endTime?: string;
    items: {
      name: string;
      sku: string;
      quantity: number;
      category?: string;
      price?: number;
      flags?: string[];
      aisle?: string;
    }[];
    notes?: string[];
  }): GeneratedReport {
    const totalItems = data.items.reduce((sum, i) => sum + i.quantity, 0);
    const uniqueProducts = data.items.length;
    const flaggedCount = data.items.filter(i => i.flags && i.flags.length > 0).length;
    const totalValue = data.items
      .filter(i => i.price)
      .reduce((sum, i) => sum + (i.price! * i.quantity), 0);

    // Category breakdown
    const categories = new Map<string, { count: number; quantity: number; value: number }>();
    for (const item of data.items) {
      const cat = item.category || 'Uncategorized';
      if (!categories.has(cat)) categories.set(cat, { count: 0, quantity: 0, value: 0 });
      const c = categories.get(cat)!;
      c.count++;
      c.quantity += item.quantity;
      if (item.price) c.value += item.price * item.quantity;
    }

    const sections: ReportSection[] = [
      {
        id: 'header',
        type: 'header',
        title: `Inventory Report: ${data.sessionName}`,
        content: data.storeName ? `Store: ${data.storeName}` : undefined,
        visible: true,
        order: 0,
      },
      {
        id: 'executive-summary',
        type: 'summary',
        title: 'Executive Summary',
        content: this.buildInventorySummaryText(data, totalItems, uniqueProducts, flaggedCount, totalValue),
        visible: true,
        order: 1,
      },
      {
        id: 'key-metrics',
        type: 'metrics',
        title: 'Key Metrics',
        data: [
          { label: 'Total Items', value: totalItems, unit: 'items' },
          { label: 'Unique Products', value: uniqueProducts, unit: 'SKUs' },
          { label: 'Flagged Items', value: flaggedCount, unit: 'items', highlighted: flaggedCount > 0 },
          { label: 'Estimated Value', value: `$${totalValue.toFixed(2)}`, unit: '' },
          { label: 'Categories', value: categories.size },
        ] as ReportMetric[],
        visible: true,
        order: 2,
      },
      {
        id: 'product-table',
        type: 'table',
        title: 'Product Inventory',
        data: {
          headers: ['Product', 'SKU', 'Qty', 'Price', 'Category', 'Aisle', 'Flags'],
          rows: data.items
            .sort((a, b) => (a.category || '').localeCompare(b.category || ''))
            .map(item => [
              item.name,
              item.sku,
              item.quantity,
              item.price ? `$${item.price.toFixed(2)}` : '-',
              item.category || '-',
              item.aisle || '-',
              item.flags?.join(', ') || '',
            ]),
          footer: ['TOTAL', '', totalItems, totalValue > 0 ? `$${totalValue.toFixed(2)}` : '-', '', '', ''],
        } as TableData,
        visible: true,
        order: 3,
      },
      {
        id: 'flagged-items',
        type: 'findings',
        title: 'Flagged Items',
        data: data.items
          .filter(i => i.flags && i.flags.length > 0)
          .map(item => ({
            severity: item.flags!.includes('empty_spot') || item.flags!.includes('low_stock') ? 'major' : 'minor',
            title: item.name,
            description: `Flags: ${item.flags!.join(', ')}`,
            location: item.aisle ? `Aisle ${item.aisle}` : undefined,
          })) as ReportFinding[],
        visible: flaggedCount > 0,
        order: 4,
      },
      {
        id: 'category-breakdown',
        type: 'table',
        title: 'Category Breakdown',
        data: {
          headers: ['Category', 'Products', 'Total Qty', 'Total Value'],
          rows: Array.from(categories.entries())
            .sort((a, b) => b[1].value - a[1].value)
            .map(([cat, stats]) => [
              cat,
              stats.count,
              stats.quantity,
              stats.value > 0 ? `$${stats.value.toFixed(2)}` : '-',
            ]),
        } as TableData,
        visible: true,
        order: 5,
      },
    ];

    if (data.notes && data.notes.length > 0) {
      sections.push({
        id: 'notes',
        type: 'list',
        title: 'Notes',
        data: data.notes,
        visible: true,
        order: 6,
      });
    }

    sections.push({
      id: 'footer',
      type: 'footer',
      visible: true,
      order: 99,
    });

    return this.buildReport({
      reportType: 'inventory_session',
      title: `Inventory Report: ${data.sessionName}`,
      sections,
    });
  }

  /**
   * Quick builder for inspection reports.
   */
  buildInspectionReport(data: {
    inspectionType: string;
    propertyName: string;
    address?: string;
    inspectorName?: string;
    date: string;
    areas: {
      name: string;
      condition: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
      findings: ReportFinding[];
      imageCount: number;
    }[];
    overallCondition: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    estimatedRemediationCost?: number;
  }): GeneratedReport {
    const totalFindings = data.areas.reduce((sum, a) => sum + a.findings.length, 0);
    const criticalFindings = data.areas.reduce((sum, a) =>
      sum + a.findings.filter(f => f.severity === 'critical').length, 0);
    const majorFindings = data.areas.reduce((sum, a) =>
      sum + a.findings.filter(f => f.severity === 'major').length, 0);

    const sections: ReportSection[] = [
      {
        id: 'header',
        type: 'header',
        title: `${data.inspectionType} Inspection: ${data.propertyName}`,
        content: [
          data.address ? `Address: ${data.address}` : null,
          data.inspectorName ? `Inspector: ${data.inspectorName}` : null,
          `Date: ${this.formatDate(data.date)}`,
        ].filter(Boolean).join('\n'),
        visible: true,
        order: 0,
      },
      {
        id: 'executive-summary',
        type: 'summary',
        title: 'Executive Summary',
        content: this.buildInspectionSummaryText(data, totalFindings, criticalFindings, majorFindings),
        visible: true,
        order: 1,
      },
      {
        id: 'overall-condition',
        type: 'metrics',
        title: 'Overall Assessment',
        data: [
          { label: 'Overall Condition', value: data.overallCondition.toUpperCase(), highlighted: true },
          { label: 'Total Findings', value: totalFindings },
          { label: 'Critical', value: criticalFindings, highlighted: criticalFindings > 0 },
          { label: 'Major', value: majorFindings, highlighted: majorFindings > 0 },
          ...(data.estimatedRemediationCost ? [{
            label: 'Est. Remediation', value: `$${data.estimatedRemediationCost.toLocaleString()}`, unit: ''
          }] : []),
        ] as ReportMetric[],
        visible: true,
        order: 2,
      },
      {
        id: 'findings',
        type: 'findings',
        title: 'Detailed Findings',
        data: data.areas.flatMap(a => a.findings.map(f => ({
          ...f,
          location: f.location || a.name,
        } as ReportFinding))).sort((a, b) =>
          (SEVERITY_ORDER[a.severity] ?? 99) -
          (SEVERITY_ORDER[b.severity] ?? 99)
        ),
        visible: totalFindings > 0,
        order: 3,
      },
      {
        id: 'area-breakdown',
        type: 'table',
        title: 'Area Breakdown',
        data: {
          headers: ['Area', 'Condition', 'Findings', 'Images'],
          rows: data.areas.map(a => [
            a.name,
            a.condition.toUpperCase(),
            a.findings.length,
            a.imageCount,
          ]),
        } as TableData,
        visible: true,
        order: 4,
      },
      {
        id: 'recommendations',
        type: 'recommendations',
        title: 'Recommendations',
        data: this.buildInspectionRecommendations(data),
        visible: true,
        order: 5,
      },
      {
        id: 'footer',
        type: 'footer',
        visible: true,
        order: 99,
      },
    ];

    return this.buildReport({
      reportType: 'inspection',
      title: `${data.inspectionType} Inspection: ${data.propertyName}`,
      sections,
      branding: { confidential: true },
    });
  }

  // ─── Rendering ────────────────────────────────────────────

  /**
   * Render report as Markdown.
   */
  renderMarkdown(report: GeneratedReport): string {
    const lines: string[] = [];
    const b = report.branding;

    // Confidential banner
    if (b.confidential) {
      lines.push('> ⚠️ **CONFIDENTIAL** — Do not distribute without authorization');
      lines.push('');
    }

    for (const section of report.sections) {
      const rendered = this.renderSectionMarkdown(section);
      if (rendered) {
        lines.push(rendered);
        lines.push('');
      }
    }

    // Footer
    if (b.showTimestamp) {
      lines.push('---');
      lines.push(`*${b.footerText || b.companyName}*`);
      lines.push(`*Generated: ${this.formatDate(report.generatedAt)}*`);
    }

    return lines.join('\n');
  }

  /**
   * Render report as JSON.
   */
  renderJSON(report: GeneratedReport): object {
    return {
      type: report.type,
      title: report.title,
      generatedAt: report.generatedAt,
      branding: report.branding,
      sections: report.sections.map(s => ({
        id: s.id,
        type: s.type,
        title: s.title,
        content: s.content,
        data: s.data,
      })),
    };
  }

  /**
   * Render report tables as CSV.
   */
  renderCSV(report: GeneratedReport): string {
    const csvParts: string[] = [];

    for (const section of report.sections) {
      if (section.type === 'table' && section.data) {
        const table = section.data as TableData;
        if (section.title) {
          csvParts.push(`# ${section.title}`);
        }
        csvParts.push(table.headers.join(','));
        for (const row of table.rows.slice(0, this.config.maxTableRows)) {
          csvParts.push(row.map(cell => this.escapeCSV(String(cell ?? ''))).join(','));
        }
        if (table.footer) {
          csvParts.push(table.footer.map(cell => this.escapeCSV(String(cell ?? ''))).join(','));
        }
        csvParts.push('');
      }
    }

    return csvParts.join('\n');
  }

  /**
   * Render voice-friendly summary.
   */
  renderVoiceSummary(report: GeneratedReport): string {
    const parts: string[] = [];

    // Find the summary section
    const summarySection = report.sections.find(s => s.type === 'summary');
    if (summarySection?.content) {
      parts.push(summarySection.content);
    }

    // Add key metrics
    const metricsSection = report.sections.find(s => s.type === 'metrics');
    if (metricsSection?.data) {
      const metrics = metricsSection.data as ReportMetric[];
      const highlighted = metrics.filter(m => m.highlighted);
      for (const m of highlighted) {
        parts.push(`${m.label}: ${m.value}${m.unit ? ` ${m.unit}` : ''}.`);
      }
    }

    // Mention critical findings
    const findingsSection = report.sections.find(s => s.type === 'findings');
    if (findingsSection?.data) {
      const findings = findingsSection.data as ReportFinding[];
      const critical = findings.filter(f => f.severity === 'critical');
      if (critical.length > 0) {
        parts.push(`${critical.length} critical ${critical.length === 1 ? 'issue' : 'issues'} found.`);
        if (critical.length <= 3) {
          for (const f of critical) {
            parts.push(f.title + (f.location ? ` in ${f.location}` : '') + '.');
          }
        }
      }
    }

    let result = parts.join(' ');

    // Truncate for voice
    if (result.length > this.config.voiceSummaryMaxChars) {
      result = result.slice(0, this.config.voiceSummaryMaxChars - 3) + '...';
    }

    return result || 'Report generated with no notable findings.';
  }

  // ─── Section Rendering ────────────────────────────────────

  private renderSectionMarkdown(section: ReportSection): string | null {
    switch (section.type) {
      case 'header':
        return this.renderHeaderMarkdown(section);
      case 'summary':
        return this.renderSummaryMarkdown(section);
      case 'metrics':
        return this.renderMetricsMarkdown(section);
      case 'table':
        return this.renderTableMarkdown(section);
      case 'findings':
        return this.renderFindingsMarkdown(section);
      case 'recommendations':
        return this.renderRecommendationsMarkdown(section);
      case 'list':
        return this.renderListMarkdown(section);
      case 'timeline':
        return this.renderTimelineMarkdown(section);
      case 'text':
        return section.content ? `## ${section.title || 'Details'}\n\n${section.content}` : null;
      case 'divider':
        return '---';
      case 'footer':
        return null; // Footer handled in main render
      case 'images':
        return this.renderImagesMarkdown(section);
      default:
        return null;
    }
  }

  private renderHeaderMarkdown(section: ReportSection): string {
    const lines = [`# ${section.title || 'Report'}`];
    if (section.content) lines.push(section.content);
    return lines.join('\n');
  }

  private renderSummaryMarkdown(section: ReportSection): string | null {
    if (!section.content) return null;
    return `## ${section.title || 'Summary'}\n\n${section.content}`;
  }

  private renderMetricsMarkdown(section: ReportSection): string | null {
    if (!section.data) return null;
    const metrics = section.data as ReportMetric[];
    if (metrics.length === 0) return null;

    const lines = [`## ${section.title || 'Metrics'}`];
    for (const m of metrics) {
      const marker = m.highlighted ? '**' : '';
      const trend = m.trend === 'up' ? ' ↑' : m.trend === 'down' ? ' ↓' : '';
      lines.push(`- ${marker}${m.label}:${marker} ${m.value}${m.unit ? ` ${m.unit}` : ''}${trend}`);
    }
    return lines.join('\n');
  }

  private renderTableMarkdown(section: ReportSection): string | null {
    if (!section.data) return null;
    const table = section.data as TableData;
    if (!table.headers || table.headers.length === 0) return null;

    const lines = [`## ${section.title || 'Table'}`];

    // Header row
    lines.push(`| ${table.headers.join(' | ')} |`);

    // Separator with alignments
    const alignments = table.alignments || table.headers.map(() => 'left');
    const separator = alignments.map(a => {
      if (a === 'center') return ':---:';
      if (a === 'right') return '---:';
      return '---';
    });
    lines.push(`| ${separator.join(' | ')} |`);

    // Data rows (truncated)
    const rowsToRender = table.rows.slice(0, this.config.maxTableRows);
    for (const row of rowsToRender) {
      lines.push(`| ${row.map(cell => String(cell ?? '')).join(' | ')} |`);
    }

    if (table.rows.length > this.config.maxTableRows) {
      lines.push(`| *...${table.rows.length - this.config.maxTableRows} more rows...* | ${table.headers.slice(1).map(() => '').join(' | ')} |`);
    }

    // Footer/totals row
    if (table.footer) {
      lines.push(`| **${table.footer.map(cell => String(cell ?? '')).join('** | **')}** |`);
    }

    return lines.join('\n');
  }

  private renderFindingsMarkdown(section: ReportSection): string | null {
    if (!section.data) return null;
    const findings = section.data as ReportFinding[];
    if (findings.length === 0) return null;

    const lines = [`## ${section.title || 'Findings'}`];

    for (const finding of findings) {
      const emoji = SEVERITY_EMOJI[finding.severity] || '⚪';
      lines.push(`### ${emoji} ${finding.title}`);
      lines.push(`- **Severity:** ${finding.severity.toUpperCase()}`);
      if (finding.location) lines.push(`- **Location:** ${finding.location}`);
      lines.push(`- ${finding.description}`);
      if (finding.recommendation) {
        lines.push(`- **Action:** ${finding.recommendation}`);
      }
      if (finding.estimatedCost) {
        lines.push(`- **Est. Cost:** $${finding.estimatedCost.toLocaleString()}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private renderRecommendationsMarkdown(section: ReportSection): string | null {
    if (!section.data) return null;
    const recommendations = section.data as string[];
    if (recommendations.length === 0) return null;

    const lines = [`## ${section.title || 'Recommendations'}`];
    for (let i = 0; i < recommendations.length; i++) {
      lines.push(`${i + 1}. ${recommendations[i]}`);
    }
    return lines.join('\n');
  }

  private renderListMarkdown(section: ReportSection): string | null {
    if (!section.data) return null;
    const items = section.data as string[];
    if (items.length === 0) return null;

    const lines = [`## ${section.title || 'Items'}`];
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    return lines.join('\n');
  }

  private renderTimelineMarkdown(section: ReportSection): string | null {
    if (!section.data) return null;
    const events = section.data as TimelineEvent[];
    if (events.length === 0) return null;

    const icons: Record<string, string> = {
      start: '🟢', milestone: '📍', issue: '⚠️', completion: '✅', note: '📝',
    };

    const lines = [`## ${section.title || 'Timeline'}`];
    for (const event of events) {
      const icon = icons[event.type] || '•';
      const time = this.formatDate(event.timestamp);
      const duration = event.durationMs ? ` (${this.formatDuration(event.durationMs)})` : '';
      lines.push(`- ${icon} **${time}**${duration} — ${event.description}`);
    }
    return lines.join('\n');
  }

  private renderImagesMarkdown(section: ReportSection): string | null {
    if (!section.data) return null;
    const images = section.data as { ref: string; caption: string }[];
    if (images.length === 0) return null;

    const lines = [`## ${section.title || 'Photos'}`];
    for (const img of images) {
      lines.push(`- 📷 [${img.caption}](${img.ref})`);
    }
    return lines.join('\n');
  }

  // ─── Helpers ──────────────────────────────────────────────

  private sectionHasContent(section: ReportSection): boolean {
    if (section.type === 'header' || section.type === 'footer' || section.type === 'divider') {
      return true;
    }
    if (section.content) return true;
    if (section.data) {
      if (Array.isArray(section.data)) return section.data.length > 0;
      if (typeof section.data === 'object') {
        const obj = section.data as Record<string, unknown>;
        if (obj.rows && Array.isArray(obj.rows)) return obj.rows.length > 0;
        if (obj.headers && Array.isArray(obj.headers)) return true;
        return Object.keys(obj).length > 0;
      }
      return true;
    }
    return false;
  }

  private formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      switch (this.config.dateFormat) {
        case 'us':
          return date.toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          });
        case 'eu':
          return date.toLocaleDateString('en-GB', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          });
        case 'relative': {
          const diff = Date.now() - date.getTime();
          const minutes = Math.floor(diff / 60000);
          if (minutes < 1) return 'just now';
          if (minutes < 60) return `${minutes}m ago`;
          const hours = Math.floor(minutes / 60);
          if (hours < 24) return `${hours}h ago`;
          const days = Math.floor(hours / 24);
          return `${days}d ago`;
        }
        default:
          return date.toISOString();
      }
    } catch {
      return dateStr;
    }
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private buildInventorySummaryText(
    data: { sessionName: string; storeName?: string; startTime: string; endTime?: string },
    totalItems: number,
    uniqueProducts: number,
    flaggedCount: number,
    totalValue: number
  ): string {
    const parts: string[] = [];

    parts.push(`Inventory session "${data.sessionName}"${data.storeName ? ` at ${data.storeName}` : ''} recorded ${totalItems} total items across ${uniqueProducts} unique products.`);

    if (totalValue > 0) {
      parts.push(`Estimated total inventory value: $${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
    }

    if (flaggedCount > 0) {
      parts.push(`${flaggedCount} items were flagged for attention.`);
    }

    if (data.startTime && data.endTime) {
      const duration = new Date(data.endTime).getTime() - new Date(data.startTime).getTime();
      parts.push(`Session duration: ${this.formatDuration(duration)}.`);
    }

    return parts.join(' ');
  }

  private buildInspectionSummaryText(
    data: {
      inspectionType: string;
      propertyName: string;
      overallCondition: string;
      areas: { findings: ReportFinding[] }[];
      estimatedRemediationCost?: number;
    },
    totalFindings: number,
    criticalFindings: number,
    majorFindings: number
  ): string {
    const parts: string[] = [];

    parts.push(`${data.inspectionType} inspection of ${data.propertyName} completed.`);
    parts.push(`Overall condition: ${data.overallCondition.toUpperCase()}.`);
    parts.push(`${totalFindings} findings across ${data.areas.length} areas inspected.`);

    if (criticalFindings > 0) {
      parts.push(`⚠️ ${criticalFindings} CRITICAL issue${criticalFindings > 1 ? 's' : ''} require immediate attention.`);
    }

    if (majorFindings > 0) {
      parts.push(`${majorFindings} major issue${majorFindings > 1 ? 's' : ''} noted.`);
    }

    if (data.estimatedRemediationCost) {
      parts.push(`Estimated remediation cost: $${data.estimatedRemediationCost.toLocaleString()}.`);
    }

    return parts.join(' ');
  }

  private buildInspectionRecommendations(data: {
    areas: {
      name: string;
      condition: string;
      findings: ReportFinding[];
    }[];
    overallCondition: string;
  }): string[] {
    const recommendations: string[] = [];

    // Critical findings first
    const criticalFindings = data.areas.flatMap(a =>
      a.findings.filter(f => f.severity === 'critical')
    );
    for (const f of criticalFindings) {
      recommendations.push(f.recommendation || `Address critical issue: ${f.title}`);
    }

    // Areas in poor/critical condition
    const poorAreas = data.areas.filter(a => a.condition === 'poor' || a.condition === 'critical');
    for (const area of poorAreas) {
      if (!criticalFindings.some(f => f.location === area.name)) {
        recommendations.push(`Prioritize repairs in ${area.name} (condition: ${area.condition})`);
      }
    }

    // General recommendation based on overall condition
    if (data.overallCondition === 'critical' || data.overallCondition === 'poor') {
      recommendations.push('Schedule follow-up inspection after remediation work is completed');
    }

    if (recommendations.length === 0) {
      recommendations.push('No immediate action required. Continue regular maintenance schedule.');
    }

    return recommendations;
  }
}
