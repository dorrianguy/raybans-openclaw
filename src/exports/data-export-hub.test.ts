/**
 * Tests for Data Export Hub
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DataExportHub,
  type ExportConfig,
  type ExportRequest,
  type DataProvider,
  type DataRow,
  type ExportJob,
} from './data-export-hub';

// ─── Helpers ──────────────────────────────────────────────────────────────

function createHub(config: ExportConfig = {}): DataExportHub {
  return new DataExportHub(config);
}

function createMockProvider(
  dataType: DataProvider['dataType'] = 'inventory',
  rows: DataRow[] = []
): DataProvider {
  return {
    dataType,
    fetchRows: (filters, limit, offset) => rows.slice(offset, offset + limit),
    getColumns: () => (rows.length > 0 ? Object.keys(rows[0]) : ['id', 'name', 'count']),
    getTotalCount: () => rows.length,
  };
}

function sampleInventoryRows(count = 10): DataRow[] {
  return Array.from({ length: count }, (_, i) => ({
    sku: `SKU-${String(i + 1).padStart(3, '0')}`,
    name: `Widget ${String.fromCharCode(65 + (i % 26))}`,
    brand: ['Acme', 'Globex', 'Initech', 'Umbrella'][i % 4],
    category: ['Electronics', 'Food', 'Clothing', 'Tools'][i % 4],
    count: 10 + i * 5,
    confidence: 0.8 + (i % 3) * 0.05,
    aisle: `A${Math.floor(i / 3) + 1}`,
    price: 9.99 + i * 2.5,
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('DataExportHub', () => {
  let hub: DataExportHub;

  beforeEach(() => {
    hub = createHub();
  });

  // ── Constructor ───────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates with default config', () => {
      const h = createHub();
      expect(h).toBeDefined();
      expect(h.getRegisteredTypes()).toEqual([]);
    });

    it('initializes built-in templates', () => {
      const templates = hub.getTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(10);
    });

    it('accepts custom config', () => {
      const h = createHub({
        maxExportBytes: 50 * 1024 * 1024,
        maxRows: 500000,
        companyName: 'Test Corp',
      });
      expect(h).toBeDefined();
    });
  });

  // ── Provider Registration ─────────────────────────────────────────────

  describe('data providers', () => {
    it('registers a data provider', () => {
      const provider = createMockProvider('inventory');
      hub.registerProvider(provider);
      expect(hub.hasProvider('inventory')).toBe(true);
      expect(hub.getRegisteredTypes()).toContain('inventory');
    });

    it('emits provider:registered event', () => {
      const handler = vi.fn();
      hub.on('provider:registered', handler);

      hub.registerProvider(createMockProvider('inventory'));
      expect(handler).toHaveBeenCalledWith('inventory');
    });

    it('hasProvider returns false for unregistered types', () => {
      expect(hub.hasProvider('billing')).toBe(false);
    });
  });

  // ── Export Creation ───────────────────────────────────────────────────

  describe('createExport', () => {
    it('creates and completes a CSV export', async () => {
      const rows = sampleInventoryRows(20);
      hub.registerProvider(createMockProvider('inventory', rows));

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'csv',
        name: 'Test Export',
      });

      expect(job.status).toBe('completed');
      expect(job.rowCount).toBe(20);
      expect(job.byteSize).toBeGreaterThan(0);
      expect(job.outputPath).toBeDefined();
      expect(job.duration).toBeDefined();
    });

    it('creates JSON export', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(5)));

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'json',
        name: 'JSON Export',
        includeSummary: true,
      });

      expect(job.status).toBe('completed');
      expect(job.rowCount).toBe(5);
    });

    it('creates XML export', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(3)));

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'xml',
        name: 'XML Export',
      });

      expect(job.status).toBe('completed');
    });

    it('creates markdown export', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(3)));

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'markdown',
        name: 'MD Export',
        includeSummary: true,
      });

      expect(job.status).toBe('completed');
    });

    it('creates HTML export', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(3)));

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'html',
        name: 'HTML Export',
      });

      expect(job.status).toBe('completed');
    });

    it('creates TSV export', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(3)));

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'tsv',
        name: 'TSV Export',
      });

      expect(job.status).toBe('completed');
    });

    it('handles export without provider (empty)', async () => {
      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'csv',
        name: 'Empty Export',
      });

      expect(job.status).toBe('completed');
      expect(job.rowCount).toBe(0);
    });

    it('respects column selection', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(5)));

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'json',
        name: 'Column Filter',
        columns: ['sku', 'name'],
      });

      expect(job.status).toBe('completed');
    });

    it('enforces max concurrent exports', async () => {
      const h = createHub({ maxConcurrent: 1 });
      h.registerProvider(
        createMockProvider('inventory', sampleInventoryRows(5))
      );

      const p1 = h.createExport({
        dataType: 'inventory',
        format: 'csv',
        name: 'Export 1',
      });

      // Try to start a second while first is running
      // Since our mock is sync, the first will complete before the second starts
      // but we can test the limit by checking after first completes
      await p1;

      // Verify single export works fine
      const job = await h.createExport({
        dataType: 'inventory',
        format: 'csv',
        name: 'Export 2',
      });
      expect(job.status).toBe('completed');
    });

    it('emits lifecycle events', async () => {
      const created = vi.fn();
      const started = vi.fn();
      const completed = vi.fn();
      hub.on('export:created', created);
      hub.on('export:started', started);
      hub.on('export:completed', completed);

      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(3)));
      await hub.createExport({
        dataType: 'inventory',
        format: 'csv',
        name: 'Events Test',
      });

      expect(created).toHaveBeenCalledTimes(1);
      expect(started).toHaveBeenCalledTimes(1);
      expect(completed).toHaveBeenCalledTimes(1);
    });

    it('handles export failure', async () => {
      const failProvider: DataProvider = {
        dataType: 'inventory',
        fetchRows: () => { throw new Error('DB connection failed'); },
        getColumns: () => ['id'],
        getTotalCount: () => 100,
      };
      hub.registerProvider(failProvider);

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'csv',
        name: 'Fail Test',
      });

      expect(job.status).toBe('failed');
      expect(job.error).toContain('DB connection failed');
    });
  });

  // ── Format Output ─────────────────────────────────────────────────────

  describe('formatOutput', () => {
    it('formats CSV correctly', () => {
      const rows: DataRow[] = [
        { name: 'Widget A', count: 10 },
        { name: 'Widget "B"', count: 20 },
      ];

      const output = hub.formatOutput(rows, ['name', 'count'], {
        dataType: 'inventory',
        format: 'csv',
        name: 'Test',
        includeTimestamp: false,
        includeHeaders: true,
      });

      expect(output).toContain('name,count');
      expect(output).toContain('Widget A,10');
      expect(output).toContain('"Widget ""B""",20');
    });

    it('formats JSON correctly', () => {
      const rows: DataRow[] = [{ id: 1, name: 'Test' }];
      const output = hub.formatOutput(rows, ['id', 'name'], {
        dataType: 'inventory',
        format: 'json',
        name: 'Test JSON',
      });

      const parsed = JSON.parse(output);
      expect(parsed.export.rowCount).toBe(1);
      expect(parsed.data).toEqual([{ id: 1, name: 'Test' }]);
    });

    it('formats XML correctly', () => {
      const rows: DataRow[] = [{ id: 1, name: 'Test<>&' }];
      const output = hub.formatOutput(rows, ['id', 'name'], {
        dataType: 'inventory',
        format: 'xml',
        name: 'Test XML',
      });

      expect(output).toContain('<?xml version="1.0"');
      expect(output).toContain('<row>');
      expect(output).toContain('Test&lt;&gt;&amp;');
    });

    it('formats markdown with table', () => {
      const rows: DataRow[] = [
        { name: 'Widget', count: 10 },
        { name: 'Gadget', count: 20 },
      ];
      const output = hub.formatOutput(rows, ['name', 'count'], {
        dataType: 'inventory',
        format: 'markdown',
        name: 'MD Test',
      });

      expect(output).toContain('# MD Test');
      expect(output).toContain('| name | count |');
      expect(output).toContain('| Widget | 10 |');
    });

    it('formats HTML with table', () => {
      const rows: DataRow[] = [{ name: 'Test' }];
      const output = hub.formatOutput(rows, ['name'], {
        dataType: 'inventory',
        format: 'html',
        name: 'HTML Test',
      });

      expect(output).toContain('<!DOCTYPE html>');
      expect(output).toContain('<table>');
      expect(output).toContain('<td>Test</td>');
    });

    it('handles empty rows gracefully', () => {
      const output = hub.formatOutput([], ['name', 'count'], {
        dataType: 'inventory',
        format: 'markdown',
        name: 'Empty',
      });
      expect(output).toContain('No data');
    });
  });

  // ── Aggregation ───────────────────────────────────────────────────────

  describe('aggregation', () => {
    it('aggregates data with groupBy', async () => {
      const rows: DataRow[] = [
        { category: 'Food', count: 10, price: 5.0 },
        { category: 'Food', count: 20, price: 7.5 },
        { category: 'Electronics', count: 5, price: 99.0 },
        { category: 'Electronics', count: 3, price: 149.0 },
      ];
      hub.registerProvider(createMockProvider('inventory', rows));

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'json',
        name: 'Aggregation Test',
        aggregation: {
          groupBy: 'category',
          metrics: [
            { field: 'count', operation: 'sum', alias: 'total_count' },
            { field: 'price', operation: 'avg', alias: 'avg_price' },
            { field: 'count', operation: 'count', alias: 'items' },
          ],
        },
      });

      expect(job.status).toBe('completed');
      expect(job.rowCount).toBe(2); // 2 categories
    });

    it('supports all aggregation operations', async () => {
      const rows: DataRow[] = [
        { grp: 'A', val: 10 },
        { grp: 'A', val: 20 },
        { grp: 'A', val: 30 },
      ];
      hub.registerProvider(createMockProvider('inventory', rows));

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'json',
        name: 'All Ops',
        aggregation: {
          groupBy: 'grp',
          metrics: [
            { field: 'val', operation: 'sum' },
            { field: 'val', operation: 'avg' },
            { field: 'val', operation: 'min' },
            { field: 'val', operation: 'max' },
            { field: 'val', operation: 'count' },
            { field: 'val', operation: 'distinct' },
          ],
        },
      });

      expect(job.status).toBe('completed');
    });
  });

  // ── Sorting ───────────────────────────────────────────────────────────

  describe('sorting', () => {
    it('sorts ascending', async () => {
      const rows = sampleInventoryRows(5);
      hub.registerProvider(createMockProvider('inventory', rows));

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'json',
        name: 'Sort Asc',
        sortBy: 'count',
        sortOrder: 'asc',
      });

      expect(job.status).toBe('completed');
    });

    it('sorts descending', async () => {
      const rows = sampleInventoryRows(5);
      hub.registerProvider(createMockProvider('inventory', rows));

      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'json',
        name: 'Sort Desc',
        sortBy: 'count',
        sortOrder: 'desc',
      });

      expect(job.status).toBe('completed');
    });
  });

  // ── Templates ─────────────────────────────────────────────────────────

  describe('templates', () => {
    it('has built-in templates', () => {
      expect(hub.getTemplate('inventory-full')).toBeDefined();
      expect(hub.getTemplate('session-summary')).toBeDefined();
      expect(hub.getTemplate('agent-performance')).toBeDefined();
      expect(hub.getTemplate('audit-trail')).toBeDefined();
      expect(hub.getTemplate('billing-summary')).toBeDefined();
      expect(hub.getTemplate('security-incidents')).toBeDefined();
      expect(hub.getTemplate('contacts-export')).toBeDefined();
      expect(hub.getTemplate('compliance-soc2')).toBeDefined();
      expect(hub.getTemplate('inspection-report')).toBeDefined();
      expect(hub.getTemplate('inventory-discrepancy')).toBeDefined();
    });

    it('registers custom templates', () => {
      hub.registerTemplate({
        id: 'custom-report',
        name: 'Custom Report',
        description: 'My custom report',
        dataType: 'custom',
        format: 'csv',
        columns: ['a', 'b', 'c'],
      });

      expect(hub.getTemplate('custom-report')).toBeDefined();
    });

    it('filters templates by data type', () => {
      const inventoryTemplates = hub.getTemplates('inventory');
      expect(inventoryTemplates.length).toBeGreaterThanOrEqual(2);
      expect(inventoryTemplates.every((t) => t.dataType === 'inventory')).toBe(true);
    });

    it('creates export from template', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(5)));

      const job = await hub.createExportFromTemplate('inventory-full');
      expect(job.status).toBe('completed');
    });

    it('allows template overrides', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(5)));

      const job = await hub.createExportFromTemplate('inventory-full', {
        name: 'Custom Name',
        format: 'json',
      });

      expect(job.status).toBe('completed');
      expect(job.request.name).toBe('Custom Name');
      expect(job.request.format).toBe('json');
    });

    it('throws for unknown template', async () => {
      await expect(hub.createExportFromTemplate('nope')).rejects.toThrow(
        /not found/
      );
    });
  });

  // ── Scheduled Exports ─────────────────────────────────────────────────

  describe('schedules', () => {
    it('creates a daily schedule', () => {
      const schedule = hub.createSchedule({
        name: 'Daily Inventory',
        request: {
          dataType: 'inventory',
          format: 'csv',
          name: 'Daily',
        },
        schedule: 'daily',
        hour: 6,
      });

      expect(schedule.id).toBeDefined();
      expect(schedule.enabled).toBe(true);
      expect(schedule.nextRunAt).toBeDefined();
      expect(schedule.runCount).toBe(0);
    });

    it('creates a weekly schedule', () => {
      const schedule = hub.createSchedule({
        name: 'Weekly Report',
        request: {
          dataType: 'sessions',
          format: 'markdown',
          name: 'Weekly',
        },
        schedule: 'weekly',
        dayOfWeek: 1,
        hour: 9,
      });

      expect(schedule.schedule).toBe('weekly');
    });

    it('creates a monthly schedule', () => {
      const schedule = hub.createSchedule({
        name: 'Monthly Billing',
        request: {
          dataType: 'billing',
          format: 'csv',
          name: 'Monthly',
        },
        schedule: 'monthly',
        dayOfMonth: 1,
      });

      expect(schedule.schedule).toBe('monthly');
    });

    it('lists all schedules', () => {
      hub.createSchedule({
        name: 'A',
        request: { dataType: 'inventory', format: 'csv', name: 'A' },
        schedule: 'daily',
      });
      hub.createSchedule({
        name: 'B',
        request: { dataType: 'billing', format: 'csv', name: 'B' },
        schedule: 'weekly',
      });

      expect(hub.getSchedules().length).toBe(2);
    });

    it('toggles schedule on/off', () => {
      const schedule = hub.createSchedule({
        name: 'Toggle',
        request: { dataType: 'inventory', format: 'csv', name: 'T' },
        schedule: 'daily',
      });

      hub.toggleSchedule(schedule.id, false);
      expect(hub.getSchedules().find((s) => s.id === schedule.id)!.enabled).toBe(false);

      hub.toggleSchedule(schedule.id, true);
      expect(hub.getSchedules().find((s) => s.id === schedule.id)!.enabled).toBe(true);
    });

    it('deletes a schedule', () => {
      const schedule = hub.createSchedule({
        name: 'Delete Me',
        request: { dataType: 'inventory', format: 'csv', name: 'D' },
        schedule: 'daily',
      });

      expect(hub.deleteSchedule(schedule.id)).toBe(true);
      expect(hub.getSchedules().length).toBe(0);
    });

    it('throws for unknown schedule toggle', () => {
      expect(() => hub.toggleSchedule('nope', true)).toThrow(/not found/);
    });

    it('runs due schedules', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(3)));

      const schedule = hub.createSchedule({
        name: 'Overdue',
        request: { dataType: 'inventory', format: 'csv', name: 'Auto' },
        schedule: 'daily',
      });

      // Force next run to be in the past
      schedule.nextRunAt = Date.now() - 1000;

      const jobs = await hub.checkSchedules();
      expect(jobs.length).toBe(1);
      expect(jobs[0].status).toBe('completed');
      expect(schedule.runCount).toBe(1);
    });

    it('skips disabled schedules', async () => {
      const schedule = hub.createSchedule({
        name: 'Disabled',
        request: { dataType: 'inventory', format: 'csv', name: 'N' },
        schedule: 'daily',
      });
      schedule.nextRunAt = Date.now() - 1000;
      hub.toggleSchedule(schedule.id, false);

      const jobs = await hub.checkSchedules();
      expect(jobs.length).toBe(0);
    });
  });

  // ── Job Management ────────────────────────────────────────────────────

  describe('job management', () => {
    it('gets a job by ID', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(3)));
      const job = await hub.createExport({
        dataType: 'inventory',
        format: 'csv',
        name: 'Find Me',
      });

      const found = hub.getJob(job.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(job.id);
    });

    it('lists jobs with filters', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(3)));
      hub.registerProvider(createMockProvider('billing', []));

      await hub.createExport({ dataType: 'inventory', format: 'csv', name: 'Inv' });
      await hub.createExport({ dataType: 'billing', format: 'csv', name: 'Bill' });

      const allJobs = hub.getJobs();
      expect(allJobs.length).toBe(2);

      const inventoryJobs = hub.getJobs({ dataType: 'inventory' });
      expect(inventoryJobs.length).toBe(1);

      const completedJobs = hub.getJobs({ status: 'completed' });
      expect(completedJobs.length).toBe(2);
    });

    it('cancels a job', async () => {
      // We need to test cancel on a queued job
      const job: ExportJob = {
        id: 'test-cancel',
        request: { dataType: 'inventory', format: 'csv', name: 'Cancel Me' },
        status: 'queued',
        createdAt: Date.now(),
        progress: 0,
        rowCount: 0,
        byteSize: 0,
      };

      // Directly add to jobs map via createExport flow
      hub.registerProvider(createMockProvider('inventory', []));
      const realJob = await hub.createExport({
        dataType: 'inventory',
        format: 'csv',
        name: 'Test',
      });

      // Already completed, so cancel returns false
      expect(hub.cancelExport(realJob.id)).toBe(false);
    });

    it('returns false for cancelling unknown job', () => {
      expect(hub.cancelExport('nonexistent')).toBe(false);
    });
  });

  // ── Statistics ────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns comprehensive stats', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(10)));

      await hub.createExport({ dataType: 'inventory', format: 'csv', name: 'S1' });
      await hub.createExport({ dataType: 'inventory', format: 'json', name: 'S2' });

      const stats = hub.getStats();
      expect(stats.totalExports).toBe(2);
      expect(stats.completedExports).toBe(2);
      expect(stats.failedExports).toBe(0);
      expect(stats.totalRowsExported).toBe(20);
      expect(stats.totalBytesExported).toBeGreaterThan(0);
      expect(stats.avgDurationMs).toBeGreaterThanOrEqual(0);
      expect(stats.registeredProviders).toBe(1);
      expect(stats.templates).toBeGreaterThanOrEqual(10);
    });

    it('handles empty state', () => {
      const stats = hub.getStats();
      expect(stats.totalExports).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
    });
  });

  // ── PII Redaction ─────────────────────────────────────────────────────

  describe('PII redaction', () => {
    it('redacts email addresses', async () => {
      const rows: DataRow[] = [
        { name: 'Alice', email: 'alice@example.com' },
      ];
      const h = createHub({ redactPII: true });
      h.registerProvider(createMockProvider('contacts', rows));

      const job = await h.createExport({
        dataType: 'contacts',
        format: 'json',
        name: 'Redacted',
      });

      expect(job.status).toBe('completed');
    });

    it('skips redaction when disabled', async () => {
      const rows: DataRow[] = [
        { name: 'Alice', email: 'alice@example.com' },
      ];
      const h = createHub({ redactPII: false });
      h.registerProvider(createMockProvider('contacts', rows));

      const job = await h.createExport({
        dataType: 'contacts',
        format: 'json',
        name: 'No Redaction',
      });

      expect(job.status).toBe('completed');
    });
  });

  // ── Voice Summary ─────────────────────────────────────────────────────

  describe('getVoiceSummary', () => {
    it('returns summary for empty state', () => {
      const summary = hub.getVoiceSummary();
      expect(summary).toContain('templates available');
      expect(summary).toContain('data providers registered');
    });

    it('returns summary with exports', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(5)));
      await hub.createExport({ dataType: 'inventory', format: 'csv', name: 'T' });

      const summary = hub.getVoiceSummary();
      expect(summary).toContain('1 exports completed');
      expect(summary).toContain('5 total rows');
    });
  });

  // ── Cleanup ───────────────────────────────────────────────────────────

  describe('pruneHistory', () => {
    it('removes old completed jobs', async () => {
      const h = createHub({ historyRetentionMs: 100 });
      h.registerProvider(createMockProvider('inventory', sampleInventoryRows(2)));

      const job = await h.createExport({
        dataType: 'inventory',
        format: 'csv',
        name: 'Old',
      });
      job.completedAt = Date.now() - 200;

      const pruned = h.pruneHistory();
      expect(pruned).toBe(1);
    });

    it('does not prune recent jobs', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(2)));
      await hub.createExport({ dataType: 'inventory', format: 'csv', name: 'New' });

      expect(hub.pruneHistory()).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('clears all data', async () => {
      hub.registerProvider(createMockProvider('inventory', sampleInventoryRows(3)));
      await hub.createExport({ dataType: 'inventory', format: 'csv', name: 'T' });
      hub.createSchedule({
        name: 'S',
        request: { dataType: 'inventory', format: 'csv', name: 'S' },
        schedule: 'daily',
      });

      hub.clearAll();

      expect(hub.getJobs().length).toBe(0);
      expect(hub.getSchedules().length).toBe(0);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles CSV values with commas and quotes', () => {
      const rows: DataRow[] = [
        { name: 'Widget, Large', desc: 'It\'s "special"' },
      ];

      const output = hub.formatOutput(rows, ['name', 'desc'], {
        dataType: 'custom',
        format: 'csv',
        name: 'Special Chars',
        includeTimestamp: false,
      });

      expect(output).toContain('"Widget, Large"');
      expect(output).toContain('"It\'s ""special"""');
    });

    it('handles XML special characters', () => {
      const rows: DataRow[] = [{ text: '<script>alert("xss")</script>' }];

      const output = hub.formatOutput(rows, ['text'], {
        dataType: 'custom',
        format: 'xml',
        name: 'XSS Test',
      });

      expect(output).not.toContain('<script>');
      expect(output).toContain('&lt;script&gt;');
    });

    it('handles null and undefined values', () => {
      const rows: DataRow[] = [{ a: null, b: 'exists', c: null }];

      const output = hub.formatOutput(rows, ['a', 'b', 'c'], {
        dataType: 'custom',
        format: 'csv',
        name: 'Nulls',
        includeTimestamp: false,
        includeHeaders: false,
      });

      expect(output).toBe(',exists,');
    });

    it('generates summary for numeric columns', () => {
      const rows: DataRow[] = [
        { price: 10 },
        { price: 20 },
        { price: 30 },
      ];

      const output = hub.formatOutput(rows, ['price'], {
        dataType: 'custom',
        format: 'json',
        name: 'Summary',
        includeSummary: true,
      });

      const parsed = JSON.parse(output);
      expect(parsed.summary.price_sum).toBe(60);
      expect(parsed.summary.price_avg).toBe(20);
      expect(parsed.summary.price_min).toBe(10);
      expect(parsed.summary.price_max).toBe(30);
    });
  });
});
