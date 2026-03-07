/**
 * Tests for Report Builder Engine
 * 🌙 Night Shift Agent — 2026-03-07
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReportBuilder,
  ReportSection,
  ReportMetric,
  ReportFinding,
  TableData,
  TimelineEvent,
  DEFAULT_REPORT_CONFIG,
  BUILT_IN_TEMPLATES,
  ReportTemplate,
} from './report-builder';

// ─── Helpers ────────────────────────────────────────────────────

function createBuilder(config: Partial<typeof DEFAULT_REPORT_CONFIG> = {}) {
  return new ReportBuilder(config);
}

function makeBasicSections(): ReportSection[] {
  return [
    {
      id: 'header',
      type: 'header',
      title: 'Test Report',
      content: 'Test location',
      visible: true,
      order: 0,
    },
    {
      id: 'summary',
      type: 'summary',
      title: 'Summary',
      content: 'This is a test summary.',
      visible: true,
      order: 1,
    },
    {
      id: 'metrics',
      type: 'metrics',
      title: 'Key Metrics',
      data: [
        { label: 'Total Items', value: 42, unit: 'items' },
        { label: 'Issues', value: 3, highlighted: true },
      ] as ReportMetric[],
      visible: true,
      order: 2,
    },
  ];
}

// ─── Template Management ────────────────────────────────────────

describe('ReportBuilder — Templates', () => {
  it('should list built-in templates', () => {
    const builder = createBuilder();
    const templates = builder.listTemplates();

    expect(templates).toContain('inventory-session-v1');
    expect(templates).toContain('inspection-v1');
    expect(templates).toContain('daily-summary-v1');
  });

  it('should get a built-in template', () => {
    const builder = createBuilder();
    const template = builder.getTemplate('inventory-session-v1');

    expect(template).toBeDefined();
    expect(template?.name).toBe('Inventory Session Report');
    expect(template?.sections.length).toBeGreaterThan(0);
  });

  it('should register and retrieve custom templates', () => {
    const builder = createBuilder();

    const custom: ReportTemplate = {
      id: 'my-template',
      name: 'My Custom Template',
      reportType: 'custom',
      sections: [],
      branding: DEFAULT_REPORT_CONFIG.defaultBranding,
      autoCalculations: [],
    };

    builder.registerTemplate(custom);

    const retrieved = builder.getTemplate('my-template');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('My Custom Template');
  });

  it('should include custom templates in list', () => {
    const builder = createBuilder();

    builder.registerTemplate({
      id: 'custom-1',
      name: 'Custom',
      reportType: 'custom',
      sections: [],
      branding: DEFAULT_REPORT_CONFIG.defaultBranding,
      autoCalculations: [],
    });

    const templates = builder.listTemplates();
    expect(templates).toContain('custom-1');
  });

  it('should return undefined for unknown template', () => {
    const builder = createBuilder();
    expect(builder.getTemplate('nonexistent')).toBeUndefined();
  });
});

// ─── Report Building ────────────────────────────────────────────

describe('ReportBuilder — Report Building', () => {
  it('should build a basic report', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Test Report',
      sections: makeBasicSections(),
    });

    expect(report.type).toBe('custom');
    expect(report.title).toBe('Test Report');
    expect(report.generatedAt).toBeTruthy();
    expect(report.sections.length).toBeGreaterThan(0);
  });

  it('should sort sections by order', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Test',
      sections: [
        { id: 'c', type: 'text', content: 'Third', visible: true, order: 3 },
        { id: 'a', type: 'text', content: 'First', visible: true, order: 1 },
        { id: 'b', type: 'text', content: 'Second', visible: true, order: 2 },
      ],
    });

    expect(report.sections[0].id).toBe('a');
    expect(report.sections[1].id).toBe('b');
    expect(report.sections[2].id).toBe('c');
  });

  it('should filter invisible sections', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Test',
      sections: [
        { id: 'visible', type: 'text', content: 'Show', visible: true, order: 1 },
        { id: 'hidden', type: 'text', content: 'Hide', visible: false, order: 2 },
      ],
    });

    expect(report.sections).toHaveLength(1);
    expect(report.sections[0].id).toBe('visible');
  });

  it('should filter empty sections by default', () => {
    const builder = createBuilder({ includeEmptySections: false });
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Test',
      sections: [
        { id: 'with-content', type: 'text', content: 'Has content', visible: true, order: 1 },
        { id: 'empty', type: 'text', visible: true, order: 2 }, // No content
      ],
    });

    expect(report.sections).toHaveLength(1);
  });

  it('should include empty sections when configured', () => {
    const builder = createBuilder({ includeEmptySections: true });
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Test',
      sections: [
        { id: 'with-content', type: 'text', content: 'Has content', visible: true, order: 1 },
        { id: 'empty', type: 'text', visible: true, order: 2 },
      ],
    });

    expect(report.sections).toHaveLength(2);
  });

  it('should apply branding', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Test',
      sections: [],
      branding: { companyName: 'My Company' },
    });

    expect(report.branding.companyName).toBe('My Company');
  });

  it('should apply title prefix from branding', () => {
    const builder = createBuilder({
      defaultBranding: {
        ...DEFAULT_REPORT_CONFIG.defaultBranding,
        titlePrefix: '[DRAFT]',
      },
    });

    const report = builder.buildReport({
      reportType: 'custom',
      title: 'My Report',
      sections: [],
    });

    expect(report.title).toBe('[DRAFT] My Report');
  });

  it('should truncate sections beyond maxSections', () => {
    const builder = createBuilder({ maxSections: 3 });
    const sections: ReportSection[] = [];
    for (let i = 0; i < 10; i++) {
      sections.push({
        id: `section-${i}`,
        type: 'text',
        content: `Content ${i}`,
        visible: true,
        order: i,
      });
    }

    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Test',
      sections,
    });

    expect(report.sections.length).toBeLessThanOrEqual(3);
  });
});

// ─── Markdown Rendering ─────────────────────────────────────────

describe('ReportBuilder — Markdown Rendering', () => {
  it('should render a complete markdown report', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Markdown Test',
      sections: makeBasicSections(),
    });

    const md = report.toMarkdown();
    expect(md).toContain('# Test Report');
    expect(md).toContain('## Summary');
    expect(md).toContain('This is a test summary');
    expect(md).toContain('## Key Metrics');
    expect(md).toContain('Total Items');
  });

  it('should include confidential banner', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Secret',
      sections: makeBasicSections(),
      branding: { confidential: true },
    });

    const md = report.toMarkdown();
    expect(md).toContain('CONFIDENTIAL');
  });

  it('should render tables correctly', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Table Test',
      sections: [
        {
          id: 'table',
          type: 'table',
          title: 'Products',
          data: {
            headers: ['Name', 'Qty', 'Price'],
            rows: [
              ['Cola', 24, '$1.99'],
              ['Chips', 15, '$3.49'],
            ],
            footer: ['TOTAL', 39, '$5.48'],
          } as TableData,
          visible: true,
          order: 1,
        },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('| Name | Qty | Price |');
    expect(md).toContain('| Cola | 24 | $1.99 |');
    expect(md).toContain('TOTAL');
  });

  it('should render findings with severity emojis', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Findings Test',
      sections: [
        {
          id: 'findings',
          type: 'findings',
          title: 'Issues',
          data: [
            { severity: 'critical', title: 'Mold detected', description: 'Black mold in bathroom', location: 'Bathroom' },
            { severity: 'minor', title: 'Peeling paint', description: 'Minor paint peeling', location: 'Hallway' },
          ] as ReportFinding[],
          visible: true,
          order: 1,
        },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('🔴');
    expect(md).toContain('🟡');
    expect(md).toContain('Mold detected');
    expect(md).toContain('**Severity:** CRITICAL');
    expect(md).toContain('**Location:** Bathroom');
  });

  it('should render recommendations as numbered list', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Recs Test',
      sections: [
        {
          id: 'recs',
          type: 'recommendations',
          title: 'Action Items',
          data: ['Fix the roof', 'Replace windows', 'Paint exterior'],
          visible: true,
          order: 1,
        },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('1. Fix the roof');
    expect(md).toContain('2. Replace windows');
    expect(md).toContain('3. Paint exterior');
  });

  it('should render lists', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'List Test',
      sections: [
        {
          id: 'notes',
          type: 'list',
          title: 'Notes',
          data: ['First note', 'Second note'],
          visible: true,
          order: 1,
        },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('- First note');
    expect(md).toContain('- Second note');
  });

  it('should render timeline', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Timeline Test',
      sections: [
        {
          id: 'timeline',
          type: 'timeline',
          title: 'Session Timeline',
          data: [
            { timestamp: '2026-03-07T10:00:00Z', description: 'Session started', type: 'start' },
            { timestamp: '2026-03-07T10:30:00Z', description: 'Found issue', type: 'issue' },
            { timestamp: '2026-03-07T11:00:00Z', description: 'Session complete', type: 'completion' },
          ] as TimelineEvent[],
          visible: true,
          order: 1,
        },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('🟢');
    expect(md).toContain('⚠️');
    expect(md).toContain('✅');
    expect(md).toContain('Session started');
  });

  it('should render highlighted metrics in bold', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Metrics Test',
      sections: [
        {
          id: 'metrics',
          type: 'metrics',
          title: 'Stats',
          data: [
            { label: 'Critical Issues', value: 5, highlighted: true },
            { label: 'Normal Stat', value: 10 },
          ] as ReportMetric[],
          visible: true,
          order: 1,
        },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('**Critical Issues:**');
  });

  it('should include footer with timestamp', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Footer Test',
      sections: makeBasicSections(),
    });

    const md = report.toMarkdown();
    expect(md).toContain('Generated');
    expect(md).toContain('Ray-Bans × OpenClaw');
  });

  it('should render divider', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Divider Test',
      sections: [
        { id: 'text1', type: 'text', content: 'Above', visible: true, order: 1 },
        { id: 'div', type: 'divider', visible: true, order: 2 },
        { id: 'text2', type: 'text', content: 'Below', visible: true, order: 3 },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('---');
  });

  it('should truncate table rows', () => {
    const builder = createBuilder({ maxTableRows: 3 });

    const rows: (string | number)[][] = [];
    for (let i = 0; i < 10; i++) {
      rows.push([`Product ${i}`, i, `$${i}.99`]);
    }

    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Truncation Test',
      sections: [
        {
          id: 'table',
          type: 'table',
          title: 'Big Table',
          data: { headers: ['Name', 'Qty', 'Price'], rows } as TableData,
          visible: true,
          order: 1,
        },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('more rows');
  });
});

// ─── JSON Rendering ─────────────────────────────────────────────

describe('ReportBuilder — JSON Rendering', () => {
  it('should render valid JSON', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'JSON Test',
      sections: makeBasicSections(),
    });

    const json = report.toJSON();
    expect(json).toBeDefined();
    expect((json as any).title).toBe('JSON Test');
    expect((json as any).type).toBe('custom');
    expect((json as any).sections).toBeDefined();
  });

  it('should include all section data in JSON', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'JSON Data Test',
      sections: [
        {
          id: 'metrics',
          type: 'metrics',
          title: 'Stats',
          data: [{ label: 'Count', value: 42 }] as ReportMetric[],
          visible: true,
          order: 1,
        },
      ],
    });

    const json = report.toJSON() as any;
    expect(json.sections[0].data).toBeDefined();
    expect(json.sections[0].data[0].value).toBe(42);
  });
});

// ─── CSV Rendering ──────────────────────────────────────────────

describe('ReportBuilder — CSV Rendering', () => {
  it('should render tables as CSV', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'CSV Test',
      sections: [
        {
          id: 'table',
          type: 'table',
          title: 'Products',
          data: {
            headers: ['Name', 'Qty', 'Price'],
            rows: [
              ['Cola', 24, '$1.99'],
              ['Chips', 15, '$3.49'],
            ],
          } as TableData,
          visible: true,
          order: 1,
        },
      ],
    });

    const csv = report.toCSV();
    expect(csv).toContain('Name,Qty,Price');
    expect(csv).toContain('Cola,24,$1.99');
    expect(csv).toContain('Chips,15,$3.49');
  });

  it('should escape CSV values with commas', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'CSV Escape Test',
      sections: [
        {
          id: 'table',
          type: 'table',
          title: 'Test',
          data: {
            headers: ['Name', 'Description'],
            rows: [['Item A', 'Has a, comma']],
          } as TableData,
          visible: true,
          order: 1,
        },
      ],
    });

    const csv = report.toCSV();
    expect(csv).toContain('"Has a, comma"');
  });

  it('should include footer row in CSV', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'CSV Footer',
      sections: [
        {
          id: 'table',
          type: 'table',
          title: 'Test',
          data: {
            headers: ['Name', 'Qty'],
            rows: [['A', 10], ['B', 20]],
            footer: ['TOTAL', 30],
          } as TableData,
          visible: true,
          order: 1,
        },
      ],
    });

    const csv = report.toCSV();
    expect(csv).toContain('TOTAL,30');
  });
});

// ─── Voice Summary ──────────────────────────────────────────────

describe('ReportBuilder — Voice Summary', () => {
  it('should generate voice summary from summary section', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Voice Test',
      sections: [
        {
          id: 'summary',
          type: 'summary',
          title: 'Summary',
          content: 'Found 42 items across 3 categories.',
          visible: true,
          order: 1,
        },
      ],
    });

    const voice = report.toVoiceSummary();
    expect(voice).toContain('42 items');
  });

  it('should include highlighted metrics', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Voice Metrics',
      sections: [
        {
          id: 'metrics',
          type: 'metrics',
          title: 'Stats',
          data: [
            { label: 'Critical Issues', value: 5, highlighted: true },
            { label: 'Normal', value: 10 }, // Not highlighted
          ] as ReportMetric[],
          visible: true,
          order: 1,
        },
      ],
    });

    const voice = report.toVoiceSummary();
    expect(voice).toContain('Critical Issues: 5');
    expect(voice).not.toContain('Normal');
  });

  it('should mention critical findings', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Voice Findings',
      sections: [
        {
          id: 'findings',
          type: 'findings',
          title: 'Issues',
          data: [
            { severity: 'critical', title: 'Water leak', description: 'Active leak', location: 'Basement' },
            { severity: 'minor', title: 'Scratch', description: 'Surface scratch' },
          ] as ReportFinding[],
          visible: true,
          order: 1,
        },
      ],
    });

    const voice = report.toVoiceSummary();
    expect(voice).toContain('1 critical issue');
    expect(voice).toContain('Water leak');
    expect(voice).toContain('Basement');
  });

  it('should truncate long summaries', () => {
    const builder = createBuilder({ voiceSummaryMaxChars: 50 });
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Long Voice',
      sections: [
        {
          id: 'summary',
          type: 'summary',
          title: 'Summary',
          content: 'This is a very long summary that goes on and on and on and on about many many things.',
          visible: true,
          order: 1,
        },
      ],
    });

    const voice = report.toVoiceSummary();
    expect(voice.length).toBeLessThanOrEqual(50);
    expect(voice).toContain('...');
  });

  it('should handle empty report gracefully', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Empty',
      sections: [],
    });

    const voice = report.toVoiceSummary();
    expect(voice).toContain('no notable findings');
  });
});

// ─── Inventory Report Builder ───────────────────────────────────

describe('ReportBuilder — Inventory Report', () => {
  it('should build inventory report', () => {
    const builder = createBuilder();
    const report = builder.buildInventoryReport({
      sessionName: 'Morning Count',
      storeName: 'Downtown Store',
      startTime: '2026-03-07T08:00:00Z',
      endTime: '2026-03-07T09:30:00Z',
      items: [
        { name: 'Cola', sku: 'SKU-001', quantity: 24, price: 1.99, category: 'Beverages', aisle: 'A1' },
        { name: 'Chips', sku: 'SKU-002', quantity: 15, price: 3.49, category: 'Snacks', aisle: 'A2' },
        { name: 'Bread', sku: 'SKU-003', quantity: 8, price: 2.99, category: 'Bakery', aisle: 'A3', flags: ['low_stock'] },
      ],
    });

    expect(report.type).toBe('inventory_session');
    expect(report.title).toContain('Morning Count');
  });

  it('should include key metrics', () => {
    const builder = createBuilder();
    const report = builder.buildInventoryReport({
      sessionName: 'Test',
      startTime: '2026-03-07T08:00:00Z',
      items: [
        { name: 'Cola', sku: 'SKU-001', quantity: 24, price: 1.99, category: 'Beverages' },
        { name: 'Chips', sku: 'SKU-002', quantity: 15, price: 3.49, category: 'Snacks' },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('Total Items');
    expect(md).toContain('Unique Products');
  });

  it('should include flagged items section', () => {
    const builder = createBuilder();
    const report = builder.buildInventoryReport({
      sessionName: 'Test',
      startTime: '2026-03-07T08:00:00Z',
      items: [
        { name: 'Empty Slot', sku: 'SKU-001', quantity: 0, category: 'Beverages', flags: ['empty_spot'] },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('Flagged Items');
    expect(md).toContain('Empty Slot');
  });

  it('should include category breakdown', () => {
    const builder = createBuilder();
    const report = builder.buildInventoryReport({
      sessionName: 'Test',
      startTime: '2026-03-07T08:00:00Z',
      items: [
        { name: 'Cola', sku: 'SKU-001', quantity: 24, price: 1.99, category: 'Beverages' },
        { name: 'Water', sku: 'SKU-002', quantity: 36, price: 0.99, category: 'Beverages' },
        { name: 'Chips', sku: 'SKU-003', quantity: 15, price: 3.49, category: 'Snacks' },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('Category Breakdown');
    expect(md).toContain('Beverages');
    expect(md).toContain('Snacks');
  });

  it('should include notes when provided', () => {
    const builder = createBuilder();
    const report = builder.buildInventoryReport({
      sessionName: 'Test',
      startTime: '2026-03-07T08:00:00Z',
      items: [{ name: 'Cola', sku: 'SKU-001', quantity: 24 }],
      notes: ['Aisle 3 was blocked', 'Recount needed for dairy section'],
    });

    const md = report.toMarkdown();
    expect(md).toContain('Aisle 3 was blocked');
  });

  it('should calculate total value', () => {
    const builder = createBuilder();
    const report = builder.buildInventoryReport({
      sessionName: 'Test',
      startTime: '2026-03-07T08:00:00Z',
      items: [
        { name: 'Cola', sku: 'SKU-001', quantity: 10, price: 2.00 },
        { name: 'Chips', sku: 'SKU-002', quantity: 5, price: 4.00 },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('$40.00'); // 10*2 + 5*4 = 40
  });

  it('should generate voice summary for inventory', () => {
    const builder = createBuilder();
    const report = builder.buildInventoryReport({
      sessionName: 'Morning Count',
      storeName: 'Downtown',
      startTime: '2026-03-07T08:00:00Z',
      endTime: '2026-03-07T09:30:00Z',
      items: [
        { name: 'Cola', sku: 'SKU-001', quantity: 24, price: 1.99, category: 'Beverages' },
        { name: 'Low Stock', sku: 'SKU-002', quantity: 2, category: 'Snacks', flags: ['low_stock'] },
      ],
    });

    const voice = report.toVoiceSummary();
    expect(voice).toContain('Morning Count');
    expect(voice.length).toBeGreaterThan(0);
  });
});

// ─── Inspection Report Builder ──────────────────────────────────

describe('ReportBuilder — Inspection Report', () => {
  it('should build inspection report', () => {
    const builder = createBuilder();
    const report = builder.buildInspectionReport({
      inspectionType: 'Property',
      propertyName: '123 Main St',
      address: '123 Main St, Anytown, USA',
      inspectorName: 'John Doe',
      date: '2026-03-07T10:00:00Z',
      areas: [
        {
          name: 'Kitchen',
          condition: 'good',
          findings: [
            { severity: 'minor', title: 'Worn countertop', description: 'Laminate showing wear', recommendation: 'Replace countertop' },
          ],
          imageCount: 5,
        },
        {
          name: 'Bathroom',
          condition: 'poor',
          findings: [
            { severity: 'critical', title: 'Mold growth', description: 'Black mold on ceiling', recommendation: 'Professional mold remediation' },
            { severity: 'major', title: 'Leaking faucet', description: 'Constant drip from hot water tap', recommendation: 'Replace faucet cartridge' },
          ],
          imageCount: 8,
        },
      ],
      overallCondition: 'fair',
      estimatedRemediationCost: 5500,
    });

    expect(report.type).toBe('inspection');
    expect(report.branding.confidential).toBe(true);
  });

  it('should include overall condition', () => {
    const builder = createBuilder();
    const report = builder.buildInspectionReport({
      inspectionType: 'Property',
      propertyName: 'Test Property',
      date: '2026-03-07',
      areas: [],
      overallCondition: 'good',
    });

    const md = report.toMarkdown();
    expect(md).toContain('GOOD');
  });

  it('should include findings sorted by severity', () => {
    const builder = createBuilder();
    const report = builder.buildInspectionReport({
      inspectionType: 'Property',
      propertyName: 'Test',
      date: '2026-03-07',
      areas: [
        {
          name: 'Room A',
          condition: 'fair',
          findings: [
            { severity: 'minor', title: 'Minor issue XYZ', description: 'Small thing' },
            { severity: 'critical', title: 'Big problem ABC', description: 'Serious issue' },
          ],
          imageCount: 2,
        },
      ],
      overallCondition: 'fair',
    });

    // Check that in the findings section, critical appears before minor
    const findingsSection = report.sections.find(s => s.type === 'findings');
    expect(findingsSection).toBeDefined();
    const findings = findingsSection!.data as any[];
    expect(findings[0].severity).toBe('critical');
    expect(findings[1].severity).toBe('minor');
  });

  it('should include area breakdown table', () => {
    const builder = createBuilder();
    const report = builder.buildInspectionReport({
      inspectionType: 'Property',
      propertyName: 'Test',
      date: '2026-03-07',
      areas: [
        { name: 'Kitchen', condition: 'good', findings: [], imageCount: 3 },
        { name: 'Bathroom', condition: 'poor', findings: [], imageCount: 5 },
      ],
      overallCondition: 'fair',
    });

    const md = report.toMarkdown();
    expect(md).toContain('Area Breakdown');
    expect(md).toContain('Kitchen');
    expect(md).toContain('Bathroom');
  });

  it('should include remediation cost when provided', () => {
    const builder = createBuilder();
    const report = builder.buildInspectionReport({
      inspectionType: 'Property',
      propertyName: 'Test',
      date: '2026-03-07',
      areas: [],
      overallCondition: 'poor',
      estimatedRemediationCost: 15000,
    });

    const md = report.toMarkdown();
    expect(md).toContain('15,000');
  });

  it('should generate recommendations based on findings', () => {
    const builder = createBuilder();
    const report = builder.buildInspectionReport({
      inspectionType: 'Property',
      propertyName: 'Test',
      date: '2026-03-07',
      areas: [
        {
          name: 'Basement',
          condition: 'critical',
          findings: [
            { severity: 'critical', title: 'Foundation crack', description: 'Crack in foundation', recommendation: 'Hire structural engineer' },
          ],
          imageCount: 2,
        },
      ],
      overallCondition: 'critical',
    });

    const md = report.toMarkdown();
    expect(md).toContain('Recommendations');
    expect(md).toContain('Hire structural engineer');
    expect(md).toContain('follow-up inspection');
  });

  it('should generate voice summary for inspection', () => {
    const builder = createBuilder();
    const report = builder.buildInspectionReport({
      inspectionType: 'Property',
      propertyName: '123 Main St',
      date: '2026-03-07',
      areas: [
        {
          name: 'Kitchen',
          condition: 'good',
          findings: [{ severity: 'critical', title: 'Gas leak', description: 'Smell of gas near stove' }],
          imageCount: 3,
        },
      ],
      overallCondition: 'fair',
    });

    const voice = report.toVoiceSummary();
    expect(voice).toContain('critical');
    expect(voice).toContain('Gas leak');
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────

describe('ReportBuilder — Edge Cases', () => {
  it('should handle report with no sections', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Empty',
      sections: [],
    });

    expect(report.sections).toHaveLength(0);
    const md = report.toMarkdown();
    expect(md).toBeTruthy();
  });

  it('should handle items without prices', () => {
    const builder = createBuilder();
    const report = builder.buildInventoryReport({
      sessionName: 'Test',
      startTime: '2026-03-07T08:00:00Z',
      items: [
        { name: 'Unknown Item', sku: 'SKU-001', quantity: 5 },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('Unknown Item');
    expect(md).toContain('$0.00');
  });

  it('should handle empty items list', () => {
    const builder = createBuilder();
    const report = builder.buildInventoryReport({
      sessionName: 'Empty Session',
      startTime: '2026-03-07T08:00:00Z',
      items: [],
    });

    expect(report.sections.length).toBeGreaterThan(0);
    const voice = report.toVoiceSummary();
    expect(voice).toContain('0 total items');
  });

  it('should handle null values in table cells', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Null Test',
      sections: [
        {
          id: 'table',
          type: 'table',
          title: 'Data',
          data: {
            headers: ['A', 'B'],
            rows: [['value', null]],
          } as TableData,
          visible: true,
          order: 1,
        },
      ],
    });

    const md = report.toMarkdown();
    expect(md).toContain('value');
    // Should not throw
  });

  it('should handle special characters in CSV', () => {
    const builder = createBuilder();
    const report = builder.buildReport({
      reportType: 'custom',
      title: 'Special Chars',
      sections: [
        {
          id: 'table',
          type: 'table',
          title: 'Data',
          data: {
            headers: ['Name', 'Desc'],
            rows: [
              ['Item "A"', 'Has "quotes"'],
              ['Item B', 'Has\nnewline'],
            ],
          } as TableData,
          visible: true,
          order: 1,
        },
      ],
    });

    const csv = report.toCSV();
    expect(csv).toContain('""');  // Escaped quotes
  });

  it('should render multiple formats from same report', () => {
    const builder = createBuilder();
    const report = builder.buildInventoryReport({
      sessionName: 'Multi-format',
      startTime: '2026-03-07T08:00:00Z',
      items: [
        { name: 'Cola', sku: 'SKU-001', quantity: 24, price: 1.99, category: 'Beverages' },
      ],
    });

    const md = report.toMarkdown();
    const json = report.toJSON();
    const csv = report.toCSV();
    const voice = report.toVoiceSummary();

    expect(md).toContain('Cola');
    expect((json as any).title).toContain('Multi-format');
    expect(csv).toContain('Cola');
    expect(voice.length).toBeGreaterThan(0);
  });
});
