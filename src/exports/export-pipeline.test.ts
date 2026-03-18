/**
 * Export Pipeline Engine — Tests
 * 🌙 Night Shift Agent — Shift #24
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ExportPipeline,
  type ExportRequest,
  type ExportFilter,
  type ExportDataSource,
} from './export-pipeline.js';

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_INVENTORY = [
  { sku: 'UPC-001', name: 'DeWalt Drill', category: 'Power Tools', quantity: 8, price: 149.99, location: 'Aisle 3', confidence: 0.95, method: 'barcode', flags: '', lastSeen: Date.now(), createdAt: Date.now() },
  { sku: 'UPC-002', name: 'Milwaukee Impact', category: 'Power Tools', quantity: 5, price: 179.99, location: 'Aisle 3', confidence: 0.9, method: 'visual', flags: 'low_stock', lastSeen: Date.now(), createdAt: Date.now() },
  { sku: 'UPC-003', name: 'Tide Pods 42ct', category: 'Cleaning', quantity: 24, price: 12.99, location: 'Aisle 7', confidence: 0.98, method: 'barcode', flags: '', lastSeen: Date.now(), createdAt: Date.now() },
  { sku: 'UPC-004', name: 'Coca-Cola 12pk', category: 'Beverages', quantity: 36, price: 6.99, location: 'Aisle 5', confidence: 0.85, method: 'visual', flags: '', lastSeen: Date.now(), createdAt: Date.now() },
  { sku: 'UPC-005', name: 'Clorox Bleach', category: 'Cleaning', quantity: 12, price: 4.99, location: 'Aisle 7', confidence: 0.92, method: 'shelf_label', flags: '', lastSeen: Date.now(), createdAt: Date.now() },
];

const MOCK_CONTACTS = [
  { name: 'Sarah Chen', company: 'Stripe', title: 'VP Engineering', email: 'sarah@stripe.com', phone: '555-0100', linkedIn: 'linkedin.com/in/sarachen', notes: 'Met at TechCrunch', metAt: 'TechCrunch Disrupt', metDate: Date.now() },
  { name: 'John Smith', company: 'Google', title: 'Staff Engineer', email: 'john@google.com', phone: '555-0200', linkedIn: 'linkedin.com/in/johnsmith', notes: 'Interested in AI', metAt: 'AI Summit', metDate: Date.now() },
];

function registerMockProviders(pipeline: ExportPipeline): void {
  pipeline.registerDataProvider('inventory_items', (filters, sort, limit) => {
    let data = [...MOCK_INVENTORY];

    // Apply filters
    for (const filter of filters) {
      data = data.filter(row => {
        const val = (row as Record<string, unknown>)[filter.field];
        switch (filter.operator) {
          case 'eq': return val === filter.value;
          case 'gt': return typeof val === 'number' && val > (filter.value as number);
          case 'contains': return typeof val === 'string' && val.toLowerCase().includes(String(filter.value).toLowerCase());
          default: return true;
        }
      });
    }

    // Apply sort
    if (sort) {
      data.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[sort.field];
        const bVal = (b as Record<string, unknown>)[sort.field];
        const cmp = String(aVal).localeCompare(String(bVal));
        return sort.order === 'desc' ? -cmp : cmp;
      });
    }

    if (limit) data = data.slice(0, limit);
    return data;
  });

  pipeline.registerDataProvider('contacts', () => [...MOCK_CONTACTS]);
  pipeline.registerDataProvider('audit_log', () => [
    { timestamp: Date.now(), action: 'login', category: 'auth', actor: 'dorrian', resource: 'session', severity: 'info', details: 'Password auth', ipAddress: '192.168.1.1' },
  ]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ExportPipeline', () => {
  let pipeline: ExportPipeline;

  beforeEach(() => {
    pipeline = new ExportPipeline();
    registerMockProviders(pipeline);
  });

  // ─── Templates ───────────────────────────────────────────────────────

  describe('Templates', () => {
    it('has built-in templates', () => {
      const templates = pipeline.listTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(6);
    });

    it('lists templates by data source', () => {
      const invTemplates = pipeline.listTemplates('inventory_items');
      expect(invTemplates.length).toBeGreaterThanOrEqual(2);
      expect(invTemplates.every(t => t.dataSource === 'inventory_items')).toBe(true);
    });

    it('gets a specific template', () => {
      const template = pipeline.getTemplate('inventory-full');
      expect(template).toBeDefined();
      expect(template!.name).toBe('Full Inventory Report');
      expect(template!.columns.length).toBeGreaterThan(0);
    });

    it('creates custom templates', () => {
      const template = pipeline.createTemplate({
        name: 'My Custom Export',
        description: 'Custom format',
        dataSource: 'inventory_items',
        defaultFormat: 'csv',
        columns: [
          { field: 'name', header: 'Product', visible: true },
          { field: 'quantity', header: 'Qty', format: 'number', visible: true },
        ],
        defaultFilters: [],
        createdBy: 'user-1',
      });

      expect(template.id).toBeTruthy();
      expect(pipeline.getTemplate(template.id)).toBeDefined();
    });

    it('deletes custom templates', () => {
      const template = pipeline.createTemplate({
        name: 'Deletable',
        description: 'test',
        dataSource: 'inventory_items',
        defaultFormat: 'csv',
        columns: [],
        defaultFilters: [],
        createdBy: 'user-1',
      });

      expect(pipeline.deleteTemplate(template.id)).toBe(true);
      expect(pipeline.getTemplate(template.id)).toBeUndefined();
    });

    it('prevents deleting built-in templates', () => {
      expect(pipeline.deleteTemplate('inventory-full')).toBe(false);
      expect(pipeline.getTemplate('inventory-full')).toBeDefined();
    });
  });

  // ─── CSV Export ──────────────────────────────────────────────────────

  describe('CSV Export', () => {
    it('exports inventory as CSV', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'csv');

      expect(job.status).toBe('completed');
      expect(job.processedRows).toBe(5);
      expect(job.outputContent).toBeTruthy();

      const lines = job.outputContent!.split('\n');
      expect(lines.length).toBeGreaterThan(1); // header + data
    });

    it('includes headers by default', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'csv');
      const firstLine = job.outputContent!.split('\n')[0];
      expect(firstLine).toContain('sku');
    });

    it('excludes headers when requested', async () => {
      const exportJob = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        delivery: 'download',
        includeHeaders: false,
      });
      const job = await pipeline.processExport(exportJob.id);
      const lines = job.outputContent!.split('\n');
      // First line should be data, not headers
      expect(lines[0]).not.toContain('sku');
    });

    it('escapes CSV special characters', async () => {
      pipeline.registerDataProvider('custom' as ExportDataSource, () => [
        { name: 'Item "with" quotes', value: 'has,comma', note: 'has\nnewline' },
      ]);

      const job = await pipeline.quickExport('user-1', 'custom' as ExportDataSource, 'csv');
      expect(job.outputContent).toContain('"Item ""with"" quotes"');
      expect(job.outputContent).toContain('"has,comma"');
    });
  });

  // ─── TSV Export ──────────────────────────────────────────────────────

  describe('TSV Export', () => {
    it('exports as TSV', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'tsv');

      expect(job.status).toBe('completed');
      const lines = job.outputContent!.split('\n');
      expect(lines[0].split('\t').length).toBeGreaterThan(1);
    });
  });

  // ─── JSON Export ─────────────────────────────────────────────────────

  describe('JSON Export', () => {
    it('exports as JSON with metadata', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'json');

      expect(job.status).toBe('completed');
      const parsed = JSON.parse(job.outputContent!);
      expect(parsed.exportedAt).toBeTruthy();
      expect(parsed.dataSource).toBe('inventory_items');
      expect(parsed.totalRows).toBe(5);
      expect(parsed.data).toHaveLength(5);
    });

    it('includes branding in JSON export', async () => {
      const exportJob = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'json',
        delivery: 'download',
        branding: { companyName: 'Mike\'s Hardware' },
      });
      const job = await pipeline.processExport(exportJob.id);

      const parsed = JSON.parse(job.outputContent!);
      expect(parsed.company).toBe("Mike's Hardware");
    });
  });

  // ─── JSONL Export ────────────────────────────────────────────────────

  describe('JSONL Export', () => {
    it('exports as JSONL (one JSON per line)', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'jsonl');

      expect(job.status).toBe('completed');
      const lines = job.outputContent!.split('\n').filter(l => l);
      expect(lines).toHaveLength(5);

      // Each line should be valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });

  // ─── Markdown Export ─────────────────────────────────────────────────

  describe('Markdown Export', () => {
    it('exports as Markdown table', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'markdown');

      expect(job.status).toBe('completed');
      expect(job.outputContent).toContain('|');
      expect(job.outputContent).toContain('---');
    });

    it('includes branding in Markdown', async () => {
      const exportJob = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'markdown',
        delivery: 'download',
        branding: {
          companyName: "Mike's Hardware",
          headerText: 'Monthly Inventory Report',
          confidential: true,
          footerText: 'Generated by Inventory Vision',
        },
      });
      const job = await pipeline.processExport(exportJob.id);

      expect(job.outputContent).toContain("Mike's Hardware");
      expect(job.outputContent).toContain('Monthly Inventory Report');
      expect(job.outputContent).toContain('CONFIDENTIAL');
      expect(job.outputContent).toContain('Generated by Inventory Vision');
    });
  });

  // ─── HTML Export ─────────────────────────────────────────────────────

  describe('HTML Export', () => {
    it('exports as HTML', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'html');

      expect(job.status).toBe('completed');
      expect(job.outputContent).toContain('<!DOCTYPE html>');
      expect(job.outputContent).toContain('<table>');
      expect(job.outputContent).toContain('<th>');
    });

    it('applies custom branding color', async () => {
      const exportJob = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'html',
        delivery: 'download',
        branding: { primaryColor: '#ff5722' },
      });
      const job = await pipeline.processExport(exportJob.id);
      expect(job.outputContent).toContain('#ff5722');
    });
  });

  // ─── XML Export ──────────────────────────────────────────────────────

  describe('XML Export', () => {
    it('exports as XML', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'xml');

      expect(job.status).toBe('completed');
      expect(job.outputContent).toContain('<?xml');
      expect(job.outputContent).toContain('<export>');
      expect(job.outputContent).toContain('<row>');
    });
  });

  // ─── Templates in Export ─────────────────────────────────────────────

  describe('Template-based Export', () => {
    it('applies template columns', async () => {
      const exportJob = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        template: 'inventory-full',
        delivery: 'download',
      });
      const job = await pipeline.processExport(exportJob.id);

      expect(job.status).toBe('completed');
      const firstLine = job.outputContent!.split('\n')[0];
      expect(firstLine).toContain('SKU/UPC');
      expect(firstLine).toContain('Product Name');
    });

    it('formats currency values', async () => {
      const exportJob = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        template: 'inventory-full',
        delivery: 'download',
      });
      const job = await pipeline.processExport(exportJob.id);
      expect(job.outputContent).toContain('$149.99');
    });

    it('formats percentage values', async () => {
      const exportJob = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        template: 'inventory-full',
        delivery: 'download',
      });
      const job = await pipeline.processExport(exportJob.id);
      expect(job.outputContent).toContain('95.0%');
    });

    it('selects specific columns from template', async () => {
      const exportJob = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        template: 'inventory-full',
        columns: ['sku', 'name', 'quantity'],
        delivery: 'download',
      });
      const job = await pipeline.processExport(exportJob.id);

      const firstLine = job.outputContent!.split('\n')[0];
      expect(firstLine).toContain('SKU/UPC');
      expect(firstLine).not.toContain('Location');
    });
  });

  // ─── Filtering ───────────────────────────────────────────────────────

  describe('Filtering', () => {
    it('applies filters on export', async () => {
      const exportJob = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'json',
        delivery: 'download',
        filters: [{ field: 'category', operator: 'eq', value: 'Cleaning' }],
      });
      const job = await pipeline.processExport(exportJob.id);

      const parsed = JSON.parse(job.outputContent!);
      expect(parsed.data).toHaveLength(2);
    });

    it('applies date range filter', async () => {
      const exportJob = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'json',
        delivery: 'download',
        dateRange: { from: Date.now() + 9999999 },
      });
      const job = await pipeline.processExport(exportJob.id);

      const parsed = JSON.parse(job.outputContent!);
      expect(parsed.data).toHaveLength(0);
    });
  });

  // ─── Job Management ──────────────────────────────────────────────────

  describe('Job Management', () => {
    it('creates export jobs', () => {
      const job = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        delivery: 'download',
      });

      expect(job.id).toBeTruthy();
      expect(job.status).toBe('pending');
      expect(job.progress).toBe(0);
    });

    it('tracks job status through lifecycle', async () => {
      const created = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        delivery: 'download',
      });
      expect(created.status).toBe('pending');

      const completed = await pipeline.processExport(created.id);
      expect(completed.status).toBe('completed');
      expect(completed.progress).toBe(100);
      expect(completed.startedAt).toBeTruthy();
      expect(completed.completedAt).toBeTruthy();
    });

    it('retrieves job by id', async () => {
      const created = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        delivery: 'download',
      });

      const retrieved = pipeline.getJob(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
    });

    it('retrieves job content', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'csv');
      const content = pipeline.getJobContent(job.id);
      expect(content).toBeTruthy();
    });

    it('returns undefined content for non-completed jobs', () => {
      const job = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        delivery: 'download',
      });
      expect(pipeline.getJobContent(job.id)).toBeUndefined();
    });

    it('cancels pending jobs', () => {
      const job = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        delivery: 'download',
      });

      expect(pipeline.cancelExport(job.id)).toBe(true);
      expect(pipeline.getJob(job.id)!.status).toBe('cancelled');
    });

    it('cannot cancel completed jobs', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'csv');
      expect(pipeline.cancelExport(job.id)).toBe(false);
    });

    it('lists jobs by user', async () => {
      await pipeline.quickExport('user-1', 'inventory_items', 'csv');
      await pipeline.quickExport('user-2', 'contacts', 'csv');

      const user1Jobs = pipeline.listJobs('user-1');
      expect(user1Jobs).toHaveLength(1);
    });

    it('lists jobs by status', async () => {
      await pipeline.quickExport('user-1', 'inventory_items', 'csv');
      pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        delivery: 'download',
      });

      expect(pipeline.listJobs(undefined, 'completed')).toHaveLength(1);
      expect(pipeline.listJobs(undefined, 'pending')).toHaveLength(1);
    });

    it('cleans up expired jobs', async () => {
      const p = new ExportPipeline({ expirationMs: 1 }); // expires immediately
      registerMockProviders(p);
      await p.quickExport('user-1', 'inventory_items', 'csv');

      // Wait a tiny bit
      await new Promise(r => setTimeout(r, 5));

      const cleaned = p.cleanupExpired();
      expect(cleaned).toBe(1);
    });
  });

  // ─── Error Handling ──────────────────────────────────────────────────

  describe('Error Handling', () => {
    it('fails for unknown data source', async () => {
      const job = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'unknown_source' as ExportDataSource,
        format: 'csv',
        delivery: 'download',
      });

      const result = await pipeline.processExport(job.id);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('No data provider');
    });

    it('fails for non-existent job', async () => {
      await expect(pipeline.processExport('nonexistent')).rejects.toThrow();
    });

    it('fails for already processed job', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'csv');
      await expect(pipeline.processExport(job.id)).rejects.toThrow();
    });

    it('respects max concurrent exports', async () => {
      const p = new ExportPipeline({ maxConcurrentExports: 1 });
      registerMockProviders(p);

      const job1 = p.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        delivery: 'download',
      });

      // Start processing (will hold one slot)
      const promise1 = p.processExport(job1.id);

      const job2 = p.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        delivery: 'download',
      });

      // Wait for first to complete before trying second
      await promise1;

      // Now second should work (first freed the slot)
      const result2 = await p.processExport(job2.id);
      expect(result2.status).toBe('completed');
    });
  });

  // ─── Schedules ───────────────────────────────────────────────────────

  describe('Schedules', () => {
    it('creates export schedules', () => {
      const schedule = pipeline.createSchedule({
        userId: 'user-1',
        name: 'Daily Inventory',
        request: {
          dataSource: 'inventory_items',
          format: 'csv',
          delivery: 'email',
          deliveryConfig: { email: 'dorrian@example.com' },
        },
        cronExpression: '0 9 * * *',
        enabled: true,
      });

      expect(schedule.id).toBeTruthy();
      expect(schedule.name).toBe('Daily Inventory');
      expect(schedule.runCount).toBe(0);
    });

    it('lists schedules by user', () => {
      pipeline.createSchedule({
        userId: 'user-1',
        name: 'Daily',
        request: { dataSource: 'inventory_items', format: 'csv', delivery: 'download' },
        cronExpression: '0 9 * * *',
        enabled: true,
      });
      pipeline.createSchedule({
        userId: 'user-2',
        name: 'Weekly',
        request: { dataSource: 'contacts', format: 'csv', delivery: 'download' },
        cronExpression: '0 9 * * 1',
        enabled: true,
      });

      expect(pipeline.listSchedules('user-1')).toHaveLength(1);
      expect(pipeline.listSchedules()).toHaveLength(2);
    });

    it('updates schedule properties', () => {
      const schedule = pipeline.createSchedule({
        userId: 'user-1',
        name: 'Original',
        request: { dataSource: 'inventory_items', format: 'csv', delivery: 'download' },
        cronExpression: '0 9 * * *',
        enabled: true,
      });

      const updated = pipeline.updateSchedule(schedule.id, {
        name: 'Updated',
        enabled: false,
      });

      expect(updated!.name).toBe('Updated');
      expect(updated!.enabled).toBe(false);
    });

    it('deletes schedules', () => {
      const schedule = pipeline.createSchedule({
        userId: 'user-1',
        name: 'Deletable',
        request: { dataSource: 'inventory_items', format: 'csv', delivery: 'download' },
        cronExpression: '0 9 * * *',
        enabled: true,
      });

      expect(pipeline.deleteSchedule(schedule.id)).toBe(true);
      expect(pipeline.getSchedule(schedule.id)).toBeUndefined();
    });

    it('runs scheduled export', async () => {
      const schedule = pipeline.createSchedule({
        userId: 'user-1',
        name: 'Test Run',
        request: { dataSource: 'inventory_items', format: 'csv', delivery: 'download' },
        cronExpression: '0 9 * * *',
        enabled: true,
      });

      const job = await pipeline.runSchedule(schedule.id);
      expect(job).not.toBeNull();
      expect(job!.status).toBe('completed');

      const updatedSchedule = pipeline.getSchedule(schedule.id);
      expect(updatedSchedule!.lastRunAt).toBeTruthy();
      expect(updatedSchedule!.runCount).toBe(1);
    });

    it('returns null for non-existent schedule run', async () => {
      const result = await pipeline.runSchedule('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ─── Stats ───────────────────────────────────────────────────────────

  describe('Stats', () => {
    it('tracks export statistics', async () => {
      await pipeline.quickExport('user-1', 'inventory_items', 'csv');
      await pipeline.quickExport('user-1', 'contacts', 'json');

      const stats = pipeline.getStats();
      expect(stats.totalExports).toBe(2);
      expect(stats.exportsByFormat['csv']).toBe(1);
      expect(stats.exportsByFormat['json']).toBe(1);
      expect(stats.exportsBySource['inventory_items']).toBe(1);
      expect(stats.exportsBySource['contacts']).toBe(1);
      expect(stats.totalRowsExported).toBeGreaterThan(0);
      expect(stats.totalBytesExported).toBeGreaterThan(0);
    });

    it('tracks active schedules in stats', () => {
      pipeline.createSchedule({
        userId: 'user-1',
        name: 'Active',
        request: { dataSource: 'inventory_items', format: 'csv', delivery: 'download' },
        cronExpression: '0 9 * * *',
        enabled: true,
      });
      pipeline.createSchedule({
        userId: 'user-1',
        name: 'Disabled',
        request: { dataSource: 'contacts', format: 'csv', delivery: 'download' },
        cronExpression: '0 9 * * *',
        enabled: false,
      });

      const stats = pipeline.getStats();
      expect(stats.activeSchedules).toBe(1);
    });

    it('tracks recent exports', async () => {
      await pipeline.quickExport('user-1', 'inventory_items', 'csv');
      await pipeline.quickExport('user-1', 'contacts', 'json');

      const stats = pipeline.getStats();
      expect(stats.recentExports).toHaveLength(2);
      expect(stats.recentExports[0].completedAt).toBeGreaterThanOrEqual(stats.recentExports[1].completedAt);
    });
  });

  // ─── Voice Summary ───────────────────────────────────────────────────

  describe('Voice Summary', () => {
    it('summarizes completed job', async () => {
      const job = await pipeline.quickExport('user-1', 'inventory_items', 'csv');
      const summary = pipeline.voiceJobSummary(job.id);

      expect(summary).toContain('complete');
      expect(summary).toContain('5 rows');
      expect(summary).toContain('CSV');
    });

    it('summarizes pending job', () => {
      const job = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        delivery: 'download',
      });
      const summary = pipeline.voiceJobSummary(job.id);
      expect(summary).toContain('queued');
    });

    it('summarizes failed job', async () => {
      const job = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'unknown' as ExportDataSource,
        format: 'csv',
        delivery: 'download',
      });
      await pipeline.processExport(job.id);
      const summary = pipeline.voiceJobSummary(job.id);
      expect(summary).toContain('failed');
    });

    it('generates stats summary', async () => {
      await pipeline.quickExport('user-1', 'inventory_items', 'csv');
      const summary = pipeline.voiceStatsSummary();
      expect(summary).toContain('1 total exports');
    });

    it('handles unknown job', () => {
      const summary = pipeline.voiceJobSummary('nonexistent');
      expect(summary).toContain('not found');
    });
  });

  // ─── Events ──────────────────────────────────────────────────────────

  describe('Events', () => {
    it('emits export lifecycle events', async () => {
      const events: string[] = [];
      pipeline.on('export:created', () => events.push('created'));
      pipeline.on('export:started', () => events.push('started'));
      pipeline.on('export:completed', () => events.push('completed'));

      await pipeline.quickExport('user-1', 'inventory_items', 'csv');

      expect(events).toEqual(['created', 'started', 'completed']);
    });

    it('emits failed event on error', async () => {
      const events: string[] = [];
      pipeline.on('export:failed', () => events.push('failed'));

      const job = pipeline.createExport({
        userId: 'user-1',
        dataSource: 'unknown' as ExportDataSource,
        format: 'csv',
        delivery: 'download',
      });
      await pipeline.processExport(job.id);

      expect(events).toContain('failed');
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('handles empty data source', async () => {
      pipeline.registerDataProvider('products', () => []);
      const job = await pipeline.quickExport('user-1', 'products', 'csv');
      expect(job.status).toBe('completed');
      expect(job.processedRows).toBe(0);
    });

    it('handles empty data source in markdown', async () => {
      pipeline.registerDataProvider('products', () => []);
      const job = await pipeline.quickExport('user-1', 'products', 'markdown');
      expect(job.status).toBe('completed');
      expect(job.outputContent).toContain('No data');
    });

    it('handles data with special characters in XML', async () => {
      pipeline.registerDataProvider('custom' as ExportDataSource, () => [
        { name: '<Script>alert("xss")</script>', value: 'a&b' },
      ]);
      const job = await pipeline.quickExport('user-1', 'custom' as ExportDataSource, 'xml');
      expect(job.outputContent).not.toContain('<Script>');
      expect(job.outputContent).toContain('&lt;Script&gt;');
    });

    it('handles data with special characters in HTML', async () => {
      pipeline.registerDataProvider('custom' as ExportDataSource, () => [
        { name: '<b>bold</b>', value: '"quotes"' },
      ]);
      const job = await pipeline.quickExport('user-1', 'custom' as ExportDataSource, 'html');
      expect(job.outputContent).toContain('&lt;b&gt;');
    });
  });

  // ─── Date Formatting ────────────────────────────────────────────────

  describe('Date Formatting', () => {
    it('formats dates in US format', async () => {
      const p = new ExportPipeline({ dateFormat: 'us' });
      registerMockProviders(p);

      const template = p.createTemplate({
        name: 'US Dates',
        description: 'test',
        dataSource: 'inventory_items',
        defaultFormat: 'csv',
        columns: [
          { field: 'lastSeen', header: 'Last Seen', format: 'date', visible: true },
        ],
        defaultFilters: [],
        createdBy: 'test',
      });

      const exportJob = p.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        template: template.id,
        delivery: 'download',
      });
      const job = await p.processExport(exportJob.id);

      // US format: M/D/YYYY
      expect(job.outputContent).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    });

    it('formats dates in EU format', async () => {
      const p = new ExportPipeline({ dateFormat: 'eu' });
      registerMockProviders(p);

      const template = p.createTemplate({
        name: 'EU Dates',
        description: 'test',
        dataSource: 'inventory_items',
        defaultFormat: 'csv',
        columns: [
          { field: 'lastSeen', header: 'Last Seen', format: 'date', visible: true },
        ],
        defaultFilters: [],
        createdBy: 'test',
      });

      const exportJob = p.createExport({
        userId: 'user-1',
        dataSource: 'inventory_items',
        format: 'csv',
        template: template.id,
        delivery: 'download',
      });
      const job = await p.processExport(exportJob.id);

      // EU format: D/M/YYYY
      expect(job.outputContent).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    });
  });
});
