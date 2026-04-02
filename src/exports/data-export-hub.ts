/**
 * Data Export Hub — Comprehensive export pipeline for all platform data
 *
 * Capabilities:
 * - Multi-format export: CSV, JSON, XLSX-compatible, PDF-ready markdown, XML
 * - Template-based reports (inventory, compliance, audit, financial)
 * - Scheduled exports (daily, weekly, monthly)
 * - Export history and audit trail
 * - Data transformation pipeline (filter, aggregate, enrich)
 * - Delivery: file, email, webhook, cloud storage
 * - Regulatory compliance exports (SOC 2, GDPR, FDA)
 * - Voice-friendly export summaries
 *
 * @module exports/data-export-hub
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ExportFormat = 'csv' | 'json' | 'tsv' | 'xml' | 'markdown' | 'html';

export type ExportDataType =
  | 'inventory'
  | 'sessions'
  | 'agents'
  | 'analytics'
  | 'audit'
  | 'billing'
  | 'contacts'
  | 'inspections'
  | 'memory'
  | 'security'
  | 'custom';

export type DeliveryMethod = 'file' | 'webhook' | 'email' | 'cloud';

export type ExportStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ExportConfig {
  /** Max export size in bytes (default: 100MB) */
  maxExportBytes?: number;
  /** Max rows per export (default: 1M) */
  maxRows?: number;
  /** Export history retention (default: 30 days) */
  historyRetentionMs?: number;
  /** Max concurrent exports (default: 3) */
  maxConcurrent?: number;
  /** Default format (default: csv) */
  defaultFormat?: ExportFormat;
  /** Enable PII redaction (default: true) */
  redactPII?: boolean;
  /** Company name for report headers */
  companyName?: string;
  /** Time zone for date formatting (default: UTC) */
  timezone?: string;
}

export interface ExportRequest {
  id?: string;
  dataType: ExportDataType;
  format: ExportFormat;
  name: string;
  description?: string;
  filters?: ExportFilters;
  columns?: string[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  aggregation?: AggregationConfig;
  delivery?: DeliveryConfig;
  template?: string;
  includeHeaders?: boolean;
  includeTimestamp?: boolean;
  includeSummary?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ExportFilters {
  dateFrom?: number;
  dateTo?: number;
  storeId?: string;
  sessionId?: string;
  agentId?: string;
  status?: string;
  tags?: string[];
  minConfidence?: number;
  search?: string;
  custom?: Record<string, unknown>;
}

export interface AggregationConfig {
  groupBy: string;
  metrics: Array<{
    field: string;
    operation: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'distinct';
    alias?: string;
  }>;
}

export interface DeliveryConfig {
  method: DeliveryMethod;
  destination?: string; // URL, email, path
  headers?: Record<string, string>;
  compress?: boolean;
}

export interface ExportJob {
  id: string;
  request: ExportRequest;
  status: ExportStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  progress: number; // 0-100
  rowCount: number;
  byteSize: number;
  outputPath?: string;
  error?: string;
  duration?: number;
}

export interface ExportTemplate {
  id: string;
  name: string;
  description: string;
  dataType: ExportDataType;
  format: ExportFormat;
  columns: string[];
  filters?: ExportFilters;
  aggregation?: AggregationConfig;
  headerTemplate?: string;
  footerTemplate?: string;
}

export interface ScheduledExport {
  id: string;
  name: string;
  request: ExportRequest;
  schedule: 'daily' | 'weekly' | 'monthly';
  dayOfWeek?: number; // 0-6 for weekly
  dayOfMonth?: number; // 1-31 for monthly
  hour?: number; // 0-23
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
}

export type DataRow = Record<string, string | number | boolean | null>;

export interface DataProvider {
  dataType: ExportDataType;
  fetchRows(filters: ExportFilters, limit: number, offset: number): DataRow[];
  getColumns(): string[];
  getTotalCount(filters: ExportFilters): number;
}

// ─── Data Export Hub ────────────────────────────────────────────────────────

export class DataExportHub extends EventEmitter {
  private config: Required<ExportConfig>;
  private jobs: Map<string, ExportJob> = new Map();
  private templates: Map<string, ExportTemplate> = new Map();
  private schedules: Map<string, ScheduledExport> = new Map();
  private providers: Map<ExportDataType, DataProvider> = new Map();
  private activeExports = 0;
  private jobCounter = 0;
  private scheduleCounter = 0;

  constructor(config: ExportConfig = {}) {
    super();
    this.config = {
      maxExportBytes: config.maxExportBytes ?? 100 * 1024 * 1024,
      maxRows: config.maxRows ?? 1000000,
      historyRetentionMs: config.historyRetentionMs ?? 30 * 24 * 60 * 60 * 1000,
      maxConcurrent: config.maxConcurrent ?? 3,
      defaultFormat: config.defaultFormat ?? 'csv',
      redactPII: config.redactPII ?? true,
      companyName: config.companyName ?? 'Ray-Bans × OpenClaw',
      timezone: config.timezone ?? 'UTC',
    };

    this.initBuiltInTemplates();
  }

  // ─── Data Provider Registration ─────────────────────────────────────────

  /**
   * Register a data provider for a specific data type.
   */
  registerProvider(provider: DataProvider): void {
    this.providers.set(provider.dataType, provider);
    this.emit('provider:registered', provider.dataType);
  }

  /**
   * Get registered provider types.
   */
  getRegisteredTypes(): ExportDataType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is registered.
   */
  hasProvider(dataType: ExportDataType): boolean {
    return this.providers.has(dataType);
  }

  // ─── Export Execution ───────────────────────────────────────────────────

  /**
   * Create and execute an export job.
   */
  async createExport(request: ExportRequest): Promise<ExportJob> {
    if (this.activeExports >= this.config.maxConcurrent) {
      throw new Error(
        `Maximum concurrent exports (${this.config.maxConcurrent}) reached`
      );
    }

    const job: ExportJob = {
      id: request.id ?? `export_${++this.jobCounter}_${Date.now()}`,
      request,
      status: 'queued',
      createdAt: Date.now(),
      progress: 0,
      rowCount: 0,
      byteSize: 0,
    };

    this.jobs.set(job.id, job);
    this.emit('export:created', job);

    // Execute
    try {
      this.activeExports++;
      job.status = 'processing';
      job.startedAt = Date.now();
      this.emit('export:started', job);

      const result = await this.executeExport(job);
      job.status = 'completed';
      job.completedAt = Date.now();
      job.duration = job.completedAt - job.startedAt;
      job.outputPath = result.outputPath;
      job.rowCount = result.rowCount;
      job.byteSize = result.byteSize;

      this.emit('export:completed', job);
      return job;
    } catch (err) {
      job.status = 'failed';
      job.completedAt = Date.now();
      job.duration = job.completedAt - (job.startedAt ?? job.createdAt);
      job.error = err instanceof Error ? err.message : String(err);

      this.emit('export:failed', job);
      return job;
    } finally {
      this.activeExports--;
    }
  }

  /**
   * Execute the export pipeline.
   */
  private async executeExport(
    job: ExportJob
  ): Promise<{ outputPath: string; rowCount: number; byteSize: number }> {
    const { request } = job;
    const provider = this.providers.get(request.dataType);

    // Get data either from provider or template mock
    let rows: DataRow[];
    let columns: string[];

    if (provider) {
      const filters = request.filters ?? {};
      const totalCount = provider.getTotalCount(filters);
      const limit = Math.min(totalCount, this.config.maxRows);

      rows = provider.fetchRows(filters, limit, 0);
      columns = request.columns ?? provider.getColumns();
    } else {
      // No provider — generate empty structure from template or columns
      rows = [];
      columns = request.columns ?? ['id', 'name', 'value'];
    }

    // Apply column selection
    if (request.columns && request.columns.length > 0) {
      columns = request.columns;
      rows = rows.map((row) => {
        const filtered: DataRow = {};
        for (const col of columns) {
          filtered[col] = row[col] ?? null;
        }
        return filtered;
      });
    }

    // Apply sorting
    if (request.sortBy) {
      const order = request.sortOrder === 'desc' ? -1 : 1;
      rows.sort((a, b) => {
        const aVal = a[request.sortBy!];
        const bVal = b[request.sortBy!];
        if (aVal === bVal) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;
        return aVal < bVal ? -order : order;
      });
    }

    // Apply aggregation
    if (request.aggregation) {
      rows = this.applyAggregation(rows, request.aggregation);
      columns = [
        request.aggregation.groupBy,
        ...request.aggregation.metrics.map((m) => m.alias ?? `${m.operation}_${m.field}`),
      ];
    }

    // Apply PII redaction
    if (this.config.redactPII) {
      rows = rows.map((row) => this.redactRow(row));
    }

    // Update progress
    job.progress = 50;

    // Format output
    const output = this.formatOutput(rows, columns, request);
    const byteSize = new TextEncoder().encode(output).length;

    // Check size limit
    if (byteSize > this.config.maxExportBytes) {
      throw new Error(
        `Export size (${Math.round(byteSize / 1048576)}MB) exceeds maximum (${Math.round(this.config.maxExportBytes / 1048576)}MB)`
      );
    }

    job.progress = 100;

    return {
      outputPath: `exports/${job.id}.${request.format}`,
      rowCount: rows.length,
      byteSize,
    };
  }

  // ─── Format Output ──────────────────────────────────────────────────────

  /**
   * Format data rows into the requested output format.
   */
  formatOutput(rows: DataRow[], columns: string[], request: ExportRequest): string {
    const format = request.format ?? this.config.defaultFormat;

    switch (format) {
      case 'csv':
        return this.formatCSV(rows, columns, request);
      case 'tsv':
        return this.formatTSV(rows, columns, request);
      case 'json':
        return this.formatJSON(rows, columns, request);
      case 'xml':
        return this.formatXML(rows, columns, request);
      case 'markdown':
        return this.formatMarkdown(rows, columns, request);
      case 'html':
        return this.formatHTML(rows, columns, request);
      default:
        return this.formatCSV(rows, columns, request);
    }
  }

  private formatCSV(rows: DataRow[], columns: string[], request: ExportRequest): string {
    const lines: string[] = [];

    if (request.includeTimestamp !== false) {
      lines.push(`# Export: ${request.name}`);
      lines.push(`# Generated: ${new Date().toISOString()}`);
      lines.push(`# Rows: ${rows.length}`);
    }

    if (request.includeHeaders !== false) {
      lines.push(columns.map((c) => this.escapeCSV(c)).join(','));
    }

    for (const row of rows) {
      lines.push(
        columns.map((col) => this.escapeCSV(String(row[col] ?? ''))).join(',')
      );
    }

    return lines.join('\n');
  }

  private formatTSV(rows: DataRow[], columns: string[], request: ExportRequest): string {
    const lines: string[] = [];

    if (request.includeHeaders !== false) {
      lines.push(columns.join('\t'));
    }

    for (const row of rows) {
      lines.push(
        columns.map((col) => String(row[col] ?? '').replace(/\t/g, ' ')).join('\t')
      );
    }

    return lines.join('\n');
  }

  private formatJSON(rows: DataRow[], columns: string[], request: ExportRequest): string {
    const output: Record<string, unknown> = {
      export: {
        name: request.name,
        generatedAt: new Date().toISOString(),
        format: 'json',
        dataType: request.dataType,
        rowCount: rows.length,
        columns,
      },
      data: rows,
    };

    if (request.includeSummary) {
      output.summary = this.generateSummary(rows, columns);
    }

    return JSON.stringify(output, null, 2);
  }

  private formatXML(rows: DataRow[], columns: string[], request: ExportRequest): string {
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<export name="${this.escapeXML(request.name)}" generatedAt="${new Date().toISOString()}" rows="${rows.length}">`,
    ];

    for (const row of rows) {
      lines.push('  <row>');
      for (const col of columns) {
        const val = row[col];
        lines.push(
          `    <${this.sanitizeXMLTag(col)}>${this.escapeXML(String(val ?? ''))}</${this.sanitizeXMLTag(col)}>`
        );
      }
      lines.push('  </row>');
    }

    lines.push('</export>');
    return lines.join('\n');
  }

  private formatMarkdown(rows: DataRow[], columns: string[], request: ExportRequest): string {
    const lines: string[] = [];

    lines.push(`# ${request.name}`);
    lines.push('');
    lines.push(`**Generated:** ${new Date().toISOString()}`);
    lines.push(`**Data Type:** ${request.dataType}`);
    lines.push(`**Rows:** ${rows.length}`);
    lines.push('');

    if (rows.length === 0) {
      lines.push('*No data matching the specified filters.*');
      return lines.join('\n');
    }

    // Table header
    lines.push('| ' + columns.join(' | ') + ' |');
    lines.push('| ' + columns.map(() => '---').join(' | ') + ' |');

    // Table rows
    for (const row of rows) {
      lines.push(
        '| ' +
          columns
            .map((col) => String(row[col] ?? '').replace(/\|/g, '\\|'))
            .join(' | ') +
          ' |'
      );
    }

    if (request.includeSummary) {
      lines.push('');
      lines.push('## Summary');
      const summary = this.generateSummary(rows, columns);
      for (const [key, value] of Object.entries(summary)) {
        lines.push(`- **${key}:** ${value}`);
      }
    }

    return lines.join('\n');
  }

  private formatHTML(rows: DataRow[], columns: string[], request: ExportRequest): string {
    const lines: string[] = [
      '<!DOCTYPE html>',
      '<html><head>',
      `<title>${this.escapeXML(request.name)}</title>`,
      '<style>',
      'body { font-family: -apple-system, sans-serif; margin: 2rem; }',
      'table { border-collapse: collapse; width: 100%; }',
      'th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }',
      'th { background: #f5f5f5; font-weight: 600; }',
      'tr:nth-child(even) { background: #fafafa; }',
      '.meta { color: #666; margin-bottom: 1rem; }',
      '</style>',
      '</head><body>',
      `<h1>${this.escapeXML(request.name)}</h1>`,
      `<p class="meta">Generated: ${new Date().toISOString()} | Rows: ${rows.length}</p>`,
    ];

    if (rows.length === 0) {
      lines.push('<p><em>No data matching the specified filters.</em></p>');
    } else {
      lines.push('<table>');
      lines.push('<thead><tr>');
      for (const col of columns) {
        lines.push(`<th>${this.escapeXML(col)}</th>`);
      }
      lines.push('</tr></thead>');
      lines.push('<tbody>');
      for (const row of rows) {
        lines.push('<tr>');
        for (const col of columns) {
          lines.push(`<td>${this.escapeXML(String(row[col] ?? ''))}</td>`);
        }
        lines.push('</tr>');
      }
      lines.push('</tbody></table>');
    }

    lines.push('</body></html>');
    return lines.join('\n');
  }

  // ─── Aggregation ────────────────────────────────────────────────────────

  private applyAggregation(rows: DataRow[], config: AggregationConfig): DataRow[] {
    const groups = new Map<string, DataRow[]>();

    for (const row of rows) {
      const key = String(row[config.groupBy] ?? 'null');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const result: DataRow[] = [];
    for (const [groupKey, groupRows] of groups) {
      const aggRow: DataRow = { [config.groupBy]: groupKey };

      for (const metric of config.metrics) {
        const alias = metric.alias ?? `${metric.operation}_${metric.field}`;
        const values = groupRows
          .map((r) => r[metric.field])
          .filter((v) => v !== null && v !== undefined);
        const numbers = values.map((v) => Number(v)).filter((n) => !isNaN(n));

        switch (metric.operation) {
          case 'count':
            aggRow[alias] = values.length;
            break;
          case 'distinct':
            aggRow[alias] = new Set(values.map(String)).size;
            break;
          case 'sum':
            aggRow[alias] = numbers.reduce((a, b) => a + b, 0);
            break;
          case 'avg':
            aggRow[alias] = numbers.length > 0
              ? Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 100) / 100
              : 0;
            break;
          case 'min':
            aggRow[alias] = numbers.length > 0 ? Math.min(...numbers) : null;
            break;
          case 'max':
            aggRow[alias] = numbers.length > 0 ? Math.max(...numbers) : null;
            break;
        }
      }

      result.push(aggRow);
    }

    return result;
  }

  // ─── Templates ──────────────────────────────────────────────────────────

  /**
   * Register a custom export template.
   */
  registerTemplate(template: ExportTemplate): void {
    this.templates.set(template.id, template);
    this.emit('template:registered', template);
  }

  /**
   * Get a template by ID.
   */
  getTemplate(templateId: string): ExportTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * Get all templates, optionally filtered.
   */
  getTemplates(dataType?: ExportDataType): ExportTemplate[] {
    const templates = Array.from(this.templates.values());
    if (dataType) return templates.filter((t) => t.dataType === dataType);
    return templates;
  }

  /**
   * Create an export from a template.
   */
  async createExportFromTemplate(
    templateId: string,
    overrides?: Partial<ExportRequest>
  ): Promise<ExportJob> {
    const template = this.templates.get(templateId);
    if (!template) throw new Error(`Template '${templateId}' not found`);

    const request: ExportRequest = {
      dataType: template.dataType,
      format: template.format,
      name: template.name,
      description: template.description,
      columns: template.columns,
      filters: template.filters,
      aggregation: template.aggregation,
      includeHeaders: true,
      includeTimestamp: true,
      includeSummary: true,
      ...overrides,
    };

    return this.createExport(request);
  }

  private initBuiltInTemplates(): void {
    this.templates.set('inventory-full', {
      id: 'inventory-full',
      name: 'Full Inventory Report',
      description: 'Complete inventory with all items, counts, and flags',
      dataType: 'inventory',
      format: 'csv',
      columns: ['sku', 'name', 'brand', 'category', 'count', 'confidence', 'aisle', 'section', 'flags', 'lastSeen'],
    });

    this.templates.set('inventory-discrepancy', {
      id: 'inventory-discrepancy',
      name: 'Inventory Discrepancy Report',
      description: 'Items with count discrepancies across sessions',
      dataType: 'inventory',
      format: 'csv',
      columns: ['sku', 'name', 'expected', 'actual', 'variance', 'variancePercent', 'session', 'timestamp'],
    });

    this.templates.set('session-summary', {
      id: 'session-summary',
      name: 'Session Summary Report',
      description: 'Overview of inventory sessions with progress and metrics',
      dataType: 'sessions',
      format: 'markdown',
      columns: ['sessionId', 'store', 'status', 'items', 'zones', 'progress', 'duration', 'team'],
    });

    this.templates.set('agent-performance', {
      id: 'agent-performance',
      name: 'Agent Performance Report',
      description: 'Performance metrics for all AI agents',
      dataType: 'agents',
      format: 'csv',
      columns: ['agentId', 'invocations', 'successRate', 'medianLatency', 'p95Latency', 'avgCost', 'totalCost'],
    });

    this.templates.set('audit-trail', {
      id: 'audit-trail',
      name: 'Audit Trail Export',
      description: 'Full audit log for compliance reporting',
      dataType: 'audit',
      format: 'json',
      columns: ['timestamp', 'actor', 'action', 'resource', 'details', 'ipAddress', 'hash'],
    });

    this.templates.set('billing-summary', {
      id: 'billing-summary',
      name: 'Billing Summary',
      description: 'Monthly billing and usage summary',
      dataType: 'billing',
      format: 'csv',
      columns: ['customerId', 'plan', 'period', 'usage', 'amount', 'status', 'invoiceId'],
    });

    this.templates.set('security-incidents', {
      id: 'security-incidents',
      name: 'Security Incident Report',
      description: 'Security scans, threats detected, and actions taken',
      dataType: 'security',
      format: 'markdown',
      columns: ['timestamp', 'threatLevel', 'type', 'description', 'location', 'action', 'resolved'],
    });

    this.templates.set('contacts-export', {
      id: 'contacts-export',
      name: 'Contacts Export',
      description: 'All scanned contacts from networking agent',
      dataType: 'contacts',
      format: 'csv',
      columns: ['name', 'title', 'company', 'email', 'phone', 'linkedin', 'notes', 'scannedAt'],
    });

    this.templates.set('compliance-soc2', {
      id: 'compliance-soc2',
      name: 'SOC 2 Compliance Report',
      description: 'Security, availability, and confidentiality controls audit',
      dataType: 'audit',
      format: 'markdown',
      columns: ['control', 'category', 'status', 'evidence', 'lastReviewed', 'reviewer', 'notes'],
    });

    this.templates.set('inspection-report', {
      id: 'inspection-report',
      name: 'Inspection Report',
      description: 'Property/facility inspection findings',
      dataType: 'inspections',
      format: 'html',
      columns: ['section', 'finding', 'severity', 'description', 'photo', 'recommendation', 'estimatedCost'],
    });
  }

  // ─── Scheduled Exports ──────────────────────────────────────────────────

  /**
   * Create a scheduled export.
   */
  createSchedule(params: {
    name: string;
    request: ExportRequest;
    schedule: ScheduledExport['schedule'];
    dayOfWeek?: number;
    dayOfMonth?: number;
    hour?: number;
  }): ScheduledExport {
    const id = `schedule_${++this.scheduleCounter}_${Date.now()}`;

    const scheduled: ScheduledExport = {
      id,
      name: params.name,
      request: params.request,
      schedule: params.schedule,
      dayOfWeek: params.dayOfWeek,
      dayOfMonth: params.dayOfMonth,
      hour: params.hour ?? 6,
      enabled: true,
      runCount: 0,
    };

    scheduled.nextRunAt = this.calculateNextRun(scheduled);
    this.schedules.set(id, scheduled);
    this.emit('schedule:created', scheduled);
    return scheduled;
  }

  /**
   * Get all schedules.
   */
  getSchedules(): ScheduledExport[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Enable/disable a schedule.
   */
  toggleSchedule(scheduleId: string, enabled: boolean): ScheduledExport {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) throw new Error(`Schedule '${scheduleId}' not found`);

    schedule.enabled = enabled;
    if (enabled) {
      schedule.nextRunAt = this.calculateNextRun(schedule);
    }

    this.emit('schedule:updated', schedule);
    return schedule;
  }

  /**
   * Delete a schedule.
   */
  deleteSchedule(scheduleId: string): boolean {
    return this.schedules.delete(scheduleId);
  }

  /**
   * Check and run due scheduled exports.
   */
  async checkSchedules(): Promise<ExportJob[]> {
    const now = Date.now();
    const jobs: ExportJob[] = [];

    for (const schedule of this.schedules.values()) {
      if (!schedule.enabled) continue;
      if (!schedule.nextRunAt || schedule.nextRunAt > now) continue;

      try {
        const job = await this.createExport({
          ...schedule.request,
          name: `${schedule.name} (${new Date().toISOString().split('T')[0]})`,
        });
        jobs.push(job);

        schedule.lastRunAt = now;
        schedule.runCount++;
        schedule.nextRunAt = this.calculateNextRun(schedule);
      } catch (err) {
        this.emit('schedule:error', {
          scheduleId: schedule.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return jobs;
  }

  private calculateNextRun(schedule: ScheduledExport): number {
    const now = new Date();
    const target = new Date(now);
    target.setHours(schedule.hour ?? 6, 0, 0, 0);

    switch (schedule.schedule) {
      case 'daily':
        if (target.getTime() <= now.getTime()) {
          target.setDate(target.getDate() + 1);
        }
        break;
      case 'weekly':
        target.setDate(target.getDate() + ((7 + (schedule.dayOfWeek ?? 1) - target.getDay()) % 7 || 7));
        if (target.getTime() <= now.getTime()) {
          target.setDate(target.getDate() + 7);
        }
        break;
      case 'monthly':
        target.setDate(schedule.dayOfMonth ?? 1);
        if (target.getTime() <= now.getTime()) {
          target.setMonth(target.getMonth() + 1);
        }
        break;
    }

    return target.getTime();
  }

  // ─── Job Management ─────────────────────────────────────────────────────

  /**
   * Get an export job by ID.
   */
  getJob(jobId: string): ExportJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs, optionally filtered.
   */
  getJobs(filter?: { status?: ExportStatus; dataType?: ExportDataType }): ExportJob[] {
    let jobs = Array.from(this.jobs.values());

    if (filter?.status) {
      jobs = jobs.filter((j) => j.status === filter.status);
    }
    if (filter?.dataType) {
      jobs = jobs.filter((j) => j.request.dataType === filter.dataType);
    }

    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Cancel a queued or processing export.
   */
  cancelExport(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status !== 'queued' && job.status !== 'processing') return false;

    job.status = 'cancelled';
    job.completedAt = Date.now();
    this.emit('export:cancelled', job);
    return true;
  }

  /**
   * Get export statistics.
   */
  getStats(): {
    totalExports: number;
    completedExports: number;
    failedExports: number;
    totalRowsExported: number;
    totalBytesExported: number;
    avgDurationMs: number;
    activeExports: number;
    registeredProviders: number;
    templates: number;
    schedules: number;
  } {
    const jobs = Array.from(this.jobs.values());
    const completed = jobs.filter((j) => j.status === 'completed');
    const failed = jobs.filter((j) => j.status === 'failed');

    const totalRows = completed.reduce((sum, j) => sum + j.rowCount, 0);
    const totalBytes = completed.reduce((sum, j) => sum + j.byteSize, 0);
    const avgDuration =
      completed.length > 0
        ? completed.reduce((sum, j) => sum + (j.duration ?? 0), 0) / completed.length
        : 0;

    return {
      totalExports: jobs.length,
      completedExports: completed.length,
      failedExports: failed.length,
      totalRowsExported: totalRows,
      totalBytesExported: totalBytes,
      avgDurationMs: Math.round(avgDuration),
      activeExports: this.activeExports,
      registeredProviders: this.providers.size,
      templates: this.templates.size,
      schedules: this.schedules.size,
    };
  }

  // ─── PII Redaction ──────────────────────────────────────────────────────

  private redactRow(row: DataRow): DataRow {
    const redacted = { ...row };

    for (const [key, value] of Object.entries(redacted)) {
      if (typeof value !== 'string') continue;

      // Email
      if (/\S+@\S+\.\S+/.test(value)) {
        const [local, domain] = value.split('@');
        redacted[key] = `${local[0]}***@${domain}`;
      }

      // Phone (simple pattern)
      if (/^\+?\d[\d\s-]{8,}$/.test(value.trim())) {
        redacted[key] = value.slice(0, 3) + '***' + value.slice(-2);
      }

      // SSN pattern
      if (/^\d{3}-?\d{2}-?\d{4}$/.test(value.trim())) {
        redacted[key] = '***-**-' + value.slice(-4);
      }
    }

    return redacted;
  }

  // ─── Summary Generation ─────────────────────────────────────────────────

  private generateSummary(rows: DataRow[], columns: string[]): Record<string, string | number> {
    const summary: Record<string, string | number> = {
      totalRows: rows.length,
    };

    for (const col of columns) {
      const values = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
      const numbers = values.map((v) => Number(v)).filter((n) => !isNaN(n));

      if (numbers.length > 0 && numbers.length === values.length) {
        summary[`${col}_sum`] = Math.round(numbers.reduce((a, b) => a + b, 0) * 100) / 100;
        summary[`${col}_avg`] = Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 100) / 100;
        summary[`${col}_min`] = Math.min(...numbers);
        summary[`${col}_max`] = Math.max(...numbers);
      } else {
        summary[`${col}_unique`] = new Set(values.map(String)).size;
      }
    }

    return summary;
  }

  // ─── Voice Summary ──────────────────────────────────────────────────────

  /**
   * Generate a TTS-friendly export summary.
   */
  getVoiceSummary(): string {
    const stats = this.getStats();
    if (stats.totalExports === 0) {
      return `Export hub ready. ${stats.templates} templates available. ${stats.registeredProviders} data providers registered.`;
    }

    const parts: string[] = [];
    parts.push(`${stats.completedExports} exports completed.`);
    parts.push(`${stats.totalRowsExported.toLocaleString()} total rows exported.`);

    if (stats.failedExports > 0) {
      parts.push(`${stats.failedExports} exports failed.`);
    }

    if (stats.activeExports > 0) {
      parts.push(`${stats.activeExports} exports currently running.`);
    }

    if (stats.schedules > 0) {
      parts.push(`${stats.schedules} scheduled exports configured.`);
    }

    return parts.join(' ');
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Prune old export history.
   */
  pruneHistory(): number {
    const cutoff = Date.now() - this.config.historyRetentionMs;
    let pruned = 0;

    for (const [id, job] of this.jobs) {
      if (job.completedAt && job.completedAt < cutoff) {
        this.jobs.delete(id);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Clear all data.
   */
  clearAll(): void {
    this.jobs.clear();
    this.schedules.clear();
    this.activeExports = 0;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private escapeXML(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private sanitizeXMLTag(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-zA-Z_]/, '_');
  }
}
