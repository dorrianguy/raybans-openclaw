/**
 * Dashboard Widget System — Component infrastructure for the web dashboard.
 *
 * Defines the widget types, layouts, and data contracts that the React
 * frontend renders. Each widget is a self-contained unit with:
 * - A type (stat card, chart, table, feed, map, etc.)
 * - A data source (API endpoint or computed from other widgets)
 * - Layout configuration (grid position, size)
 * - Refresh behavior (polling interval or SSE-driven)
 * - Interactive actions (click, drill-down, filter)
 *
 * The server generates widget configs; the frontend renders them.
 * This decouples the data layer from the UI layer.
 */

import { EventEmitter } from 'eventemitter3';

// ─── Widget Types ───────────────────────────────────────────────

export type WidgetType =
  | 'stat_card'      // Single metric with trend
  | 'progress_bar'   // Session progress indicator
  | 'item_table'     // Sortable/filterable inventory table
  | 'item_feed'      // Real-time scrolling feed of detected items
  | 'category_chart' // Pie/donut chart of inventory by category
  | 'aisle_map'      // Visual aisle coverage map
  | 'flag_list'      // Items that need attention
  | 'agent_status'   // Which AI agents are active
  | 'voice_log'      // Recent voice commands
  | 'image_gallery'  // Recent captures with analysis
  | 'activity_timeline' // Timeline of session events
  | 'health_monitor' // System health (battery, connection, etc.)
  | 'revenue_meter'  // Value saved/ROI calculator
  | 'export_panel'   // Export options (CSV, Excel, etc.)
  | 'comparison'     // Current vs previous inventory comparison
  | 'custom';        // Custom/plugin widget

export type WidgetSize = 'small' | 'medium' | 'large' | 'full';

export interface WidgetPosition {
  /** Column (0-based, in a 12-column grid) */
  col: number;
  /** Row (0-based) */
  row: number;
  /** Column span (1-12) */
  colSpan: number;
  /** Row span */
  rowSpan: number;
}

export interface WidgetAction {
  /** Action identifier */
  id: string;
  /** Display label */
  label: string;
  /** Icon (emoji or icon name) */
  icon: string;
  /** Action type */
  type: 'link' | 'api_call' | 'modal' | 'filter' | 'export' | 'toggle';
  /** Target URL or API endpoint */
  target?: string;
  /** HTTP method for api_call */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Is this a primary action? */
  primary?: boolean;
  /** Confirmation required? */
  confirm?: boolean;
  /** Confirmation message */
  confirmMessage?: string;
}

export interface WidgetRefresh {
  /** Refresh type */
  type: 'poll' | 'sse' | 'manual';
  /** Poll interval in ms (for type=poll) */
  intervalMs?: number;
  /** SSE event types to listen for (for type=sse) */
  sseEvents?: string[];
}

export interface WidgetConfig {
  /** Unique widget ID */
  id: string;
  /** Widget type */
  type: WidgetType;
  /** Display title */
  title: string;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Widget size hint */
  size: WidgetSize;
  /** Grid position */
  position: WidgetPosition;
  /** Data source API endpoint */
  dataSource: string;
  /** Refresh behavior */
  refresh: WidgetRefresh;
  /** Available actions */
  actions: WidgetAction[];
  /** Widget-specific configuration */
  options: Record<string, unknown>;
  /** Is this widget visible? */
  visible: boolean;
  /** Required pricing tier */
  pricingTier: 'free' | 'solo' | 'multi' | 'enterprise';
  /** Associated plugin ID (for plugin widgets) */
  pluginId?: string;
}

// ─── Dashboard Layout ───────────────────────────────────────────

export type DashboardView = 'live' | 'sessions' | 'analytics' | 'settings' | 'store';

export interface DashboardLayout {
  /** Layout identifier */
  id: string;
  /** Dashboard view this layout belongs to */
  view: DashboardView;
  /** Human-readable name */
  name: string;
  /** Widgets in this layout */
  widgets: WidgetConfig[];
  /** Number of grid columns */
  gridColumns: number;
  /** Background theme */
  theme: 'light' | 'dark' | 'auto';
  /** Is this the default layout? */
  isDefault: boolean;
}

// ─── Theme Configuration ────────────────────────────────────────

export interface DashboardTheme {
  /** Theme name */
  name: string;
  /** Primary brand color */
  primaryColor: string;
  /** Secondary color */
  secondaryColor: string;
  /** Background color */
  backgroundColor: string;
  /** Card/widget background */
  cardBackground: string;
  /** Text color */
  textColor: string;
  /** Muted text color */
  mutedTextColor: string;
  /** Border color */
  borderColor: string;
  /** Success color (green) */
  successColor: string;
  /** Warning color (yellow) */
  warningColor: string;
  /** Danger color (red) */
  dangerColor: string;
  /** Info color (blue) */
  infoColor: string;
  /** Font family */
  fontFamily: string;
  /** Border radius (px) */
  borderRadius: number;
  /** Shadow style */
  shadow: string;
}

const DARK_THEME: DashboardTheme = {
  name: 'dark',
  primaryColor: '#3B82F6',    // Blue-500
  secondaryColor: '#8B5CF6',  // Purple-500
  backgroundColor: '#0F172A', // Slate-900
  cardBackground: '#1E293B',  // Slate-800
  textColor: '#F8FAFC',       // Slate-50
  mutedTextColor: '#94A3B8',  // Slate-400
  borderColor: '#334155',     // Slate-700
  successColor: '#22C55E',    // Green-500
  warningColor: '#F59E0B',    // Amber-500
  dangerColor: '#EF4444',     // Red-500
  infoColor: '#06B6D4',       // Cyan-500
  fontFamily: "'Inter', -apple-system, sans-serif",
  borderRadius: 12,
  shadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
};

const LIGHT_THEME: DashboardTheme = {
  name: 'light',
  primaryColor: '#2563EB',
  secondaryColor: '#7C3AED',
  backgroundColor: '#F8FAFC',
  cardBackground: '#FFFFFF',
  textColor: '#0F172A',
  mutedTextColor: '#64748B',
  borderColor: '#E2E8F0',
  successColor: '#16A34A',
  warningColor: '#D97706',
  dangerColor: '#DC2626',
  infoColor: '#0891B2',
  fontFamily: "'Inter', -apple-system, sans-serif",
  borderRadius: 12,
  shadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
};

// ─── Events ─────────────────────────────────────────────────────

export interface WidgetSystemEvents {
  'widget:added': (widgetId: string, view: DashboardView) => void;
  'widget:removed': (widgetId: string) => void;
  'widget:updated': (widgetId: string) => void;
  'layout:changed': (view: DashboardView) => void;
  'theme:changed': (theme: DashboardTheme) => void;
  'view:changed': (view: DashboardView) => void;
}

// ─── Widget System Configuration ────────────────────────────────

export interface WidgetSystemConfig {
  /** Default theme */
  defaultTheme: 'light' | 'dark' | 'auto';
  /** Maximum widgets per view */
  maxWidgetsPerView: number;
  /** Grid columns */
  gridColumns: number;
  /** Current pricing tier (for gating) */
  pricingTier: 'free' | 'solo' | 'multi' | 'enterprise';
}

const DEFAULT_CONFIG: WidgetSystemConfig = {
  defaultTheme: 'dark',
  maxWidgetsPerView: 20,
  gridColumns: 12,
  pricingTier: 'solo',
};

// ─── Tier Hierarchy ─────────────────────────────────────────────

const TIER_LEVEL: Record<string, number> = {
  free: 0,
  solo: 1,
  multi: 2,
  enterprise: 3,
};

// ─── Widget System Implementation ───────────────────────────────

export class WidgetSystem extends EventEmitter<WidgetSystemEvents> {
  private config: WidgetSystemConfig;
  private layouts: Map<DashboardView, DashboardLayout> = new Map();
  private currentView: DashboardView = 'live';
  private theme: DashboardTheme;
  private widgetCounter = 0;

  constructor(config: Partial<WidgetSystemConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.theme = this.config.defaultTheme === 'light' ? LIGHT_THEME : DARK_THEME;
    this.initializeDefaultLayouts();
  }

  // ─── Layout Management ──────────────────────────────────────

  /**
   * Get the layout for a specific view.
   */
  getLayout(view: DashboardView): DashboardLayout | undefined {
    return this.layouts.get(view);
  }

  /**
   * Get all layouts.
   */
  getAllLayouts(): DashboardLayout[] {
    return Array.from(this.layouts.values());
  }

  /**
   * Get the current view.
   */
  getCurrentView(): DashboardView {
    return this.currentView;
  }

  /**
   * Switch to a different view.
   */
  switchView(view: DashboardView): DashboardLayout | undefined {
    this.currentView = view;
    this.emit('view:changed', view);
    return this.layouts.get(view);
  }

  /**
   * Get widgets for the current view.
   */
  getCurrentWidgets(): WidgetConfig[] {
    const layout = this.layouts.get(this.currentView);
    if (!layout) return [];
    return layout.widgets.filter(w => w.visible && this.isWidgetAllowed(w));
  }

  // ─── Widget Management ──────────────────────────────────────

  /**
   * Add a widget to a view.
   */
  addWidget(view: DashboardView, widget: WidgetConfig): void {
    const layout = this.layouts.get(view);
    if (!layout) {
      throw new Error(`Unknown view: ${view}`);
    }

    if (layout.widgets.length >= this.config.maxWidgetsPerView) {
      throw new Error(`Maximum widgets reached for view "${view}" (${this.config.maxWidgetsPerView})`);
    }

    if (layout.widgets.some(w => w.id === widget.id)) {
      throw new Error(`Widget "${widget.id}" already exists in view "${view}"`);
    }

    layout.widgets.push(widget);
    this.emit('widget:added', widget.id, view);
  }

  /**
   * Remove a widget from a view.
   */
  removeWidget(view: DashboardView, widgetId: string): void {
    const layout = this.layouts.get(view);
    if (!layout) {
      throw new Error(`Unknown view: ${view}`);
    }

    const index = layout.widgets.findIndex(w => w.id === widgetId);
    if (index === -1) {
      throw new Error(`Widget "${widgetId}" not found in view "${view}"`);
    }

    layout.widgets.splice(index, 1);
    this.emit('widget:removed', widgetId);
  }

  /**
   * Update a widget's configuration.
   */
  updateWidget(view: DashboardView, widgetId: string, updates: Partial<WidgetConfig>): void {
    const layout = this.layouts.get(view);
    if (!layout) {
      throw new Error(`Unknown view: ${view}`);
    }

    const widget = layout.widgets.find(w => w.id === widgetId);
    if (!widget) {
      throw new Error(`Widget "${widgetId}" not found in view "${view}"`);
    }

    Object.assign(widget, updates);
    this.emit('widget:updated', widgetId);
  }

  /**
   * Get a specific widget by ID across all views.
   */
  getWidget(widgetId: string): { widget: WidgetConfig; view: DashboardView } | undefined {
    for (const [view, layout] of this.layouts) {
      const widget = layout.widgets.find(w => w.id === widgetId);
      if (widget) return { widget, view };
    }
    return undefined;
  }

  /**
   * Toggle widget visibility.
   */
  toggleWidget(view: DashboardView, widgetId: string): boolean {
    const layout = this.layouts.get(view);
    if (!layout) return false;

    const widget = layout.widgets.find(w => w.id === widgetId);
    if (!widget) return false;

    widget.visible = !widget.visible;
    this.emit('widget:updated', widgetId);
    return widget.visible;
  }

  /**
   * Check if a widget is allowed by the current pricing tier.
   */
  isWidgetAllowed(widget: WidgetConfig): boolean {
    return TIER_LEVEL[this.config.pricingTier] >= TIER_LEVEL[widget.pricingTier];
  }

  // ─── Theme Management ───────────────────────────────────────

  /**
   * Get the current theme.
   */
  getTheme(): DashboardTheme {
    return { ...this.theme };
  }

  /**
   * Set the theme.
   */
  setTheme(theme: 'light' | 'dark'): void {
    this.theme = theme === 'light' ? LIGHT_THEME : DARK_THEME;
    this.emit('theme:changed', this.theme);
  }

  /**
   * Get both available themes.
   */
  getAvailableThemes(): DashboardTheme[] {
    return [LIGHT_THEME, DARK_THEME];
  }

  // ─── Widget Generators ──────────────────────────────────────

  /**
   * Generate a unique widget ID.
   */
  private nextWidgetId(prefix: string): string {
    return `${prefix}-${++this.widgetCounter}`;
  }

  /**
   * Create a stat card widget config.
   */
  static createStatCard(overrides: Partial<WidgetConfig> & { id: string; title: string }): WidgetConfig {
    return {
      type: 'stat_card',
      subtitle: undefined,
      size: 'small',
      position: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
      dataSource: '/api/live',
      refresh: { type: 'sse', sseEvents: ['session:updated'] },
      actions: [],
      options: {},
      visible: true,
      pricingTier: 'free',
      ...overrides,
    };
  }

  /**
   * Create a table widget config.
   */
  static createTable(overrides: Partial<WidgetConfig> & { id: string; title: string }): WidgetConfig {
    return {
      type: 'item_table',
      subtitle: undefined,
      size: 'large',
      position: { col: 0, row: 0, colSpan: 12, rowSpan: 4 },
      dataSource: '/api/live/items',
      refresh: { type: 'sse', sseEvents: ['item:updated'] },
      actions: [
        { id: 'export-csv', label: 'Export CSV', icon: '📥', type: 'export', target: '/api/sessions/{id}/export?format=csv' },
        { id: 'export-json', label: 'Export JSON', icon: '📋', type: 'export', target: '/api/sessions/{id}/export?format=json' },
      ],
      options: {
        pageSize: 50,
        sortable: true,
        filterable: true,
        searchable: true,
        columns: ['name', 'sku', 'quantity', 'category', 'aisle', 'confidence', 'flags'],
      },
      visible: true,
      pricingTier: 'free',
      ...overrides,
    };
  }

  // ─── Default Layout Initialization ──────────────────────────

  private initializeDefaultLayouts(): void {
    // ── Live View ───────────────────────────────
    this.layouts.set('live', {
      id: 'live-default',
      view: 'live',
      name: 'Live Inventory',
      gridColumns: this.config.gridColumns,
      theme: 'auto',
      isDefault: true,
      widgets: [
        // Row 0: Stat cards
        {
          id: 'stat-items',
          type: 'stat_card',
          title: 'Items Counted',
          subtitle: 'Total products identified',
          size: 'small',
          position: { col: 0, row: 0, colSpan: 3, rowSpan: 1 },
          dataSource: '/api/live',
          refresh: { type: 'sse', sseEvents: ['session:updated'] },
          actions: [],
          options: { metric: 'itemCount', icon: '📦', format: 'number', trend: true },
          visible: true,
          pricingTier: 'free',
        },
        {
          id: 'stat-skus',
          type: 'stat_card',
          title: 'Unique SKUs',
          subtitle: 'Distinct products',
          size: 'small',
          position: { col: 3, row: 0, colSpan: 3, rowSpan: 1 },
          dataSource: '/api/live',
          refresh: { type: 'sse', sseEvents: ['session:updated'] },
          actions: [],
          options: { metric: 'skuCount', icon: '🏷️', format: 'number' },
          visible: true,
          pricingTier: 'free',
        },
        {
          id: 'stat-value',
          type: 'stat_card',
          title: 'Total Value',
          subtitle: 'Estimated inventory value',
          size: 'small',
          position: { col: 6, row: 0, colSpan: 3, rowSpan: 1 },
          dataSource: '/api/live',
          refresh: { type: 'sse', sseEvents: ['session:updated'] },
          actions: [],
          options: { metric: 'totalValue', icon: '💰', format: 'currency' },
          visible: true,
          pricingTier: 'solo',
        },
        {
          id: 'stat-flags',
          type: 'stat_card',
          title: 'Flagged Items',
          subtitle: 'Needs attention',
          size: 'small',
          position: { col: 9, row: 0, colSpan: 3, rowSpan: 1 },
          dataSource: '/api/live',
          refresh: { type: 'sse', sseEvents: ['item:flagged'] },
          actions: [
            { id: 'view-flags', label: 'View All', icon: '🔍', type: 'filter', target: '?flagged=true' },
          ],
          options: { metric: 'flaggedCount', icon: '⚠️', format: 'number', colorWhenAbove: 5 },
          visible: true,
          pricingTier: 'free',
        },

        // Row 1: Progress bar
        {
          id: 'session-progress',
          type: 'progress_bar',
          title: 'Inventory Progress',
          subtitle: 'Aisle completion',
          size: 'full',
          position: { col: 0, row: 1, colSpan: 12, rowSpan: 1 },
          dataSource: '/api/live',
          refresh: { type: 'sse', sseEvents: ['session:updated'] },
          actions: [
            { id: 'pause', label: 'Pause', icon: '⏸️', type: 'api_call', target: '/api/live/pause', method: 'POST' },
            { id: 'stop', label: 'Stop & Export', icon: '⏹️', type: 'api_call', target: '/api/live/stop', method: 'POST', confirm: true, confirmMessage: 'Stop the inventory session and generate the report?' },
          ],
          options: { showAisles: true, showTime: true, showRate: true },
          visible: true,
          pricingTier: 'free',
        },

        // Row 2: Live feed + flag list
        {
          id: 'item-feed',
          type: 'item_feed',
          title: 'Live Feed',
          subtitle: 'Items being detected',
          size: 'medium',
          position: { col: 0, row: 2, colSpan: 8, rowSpan: 3 },
          dataSource: '/api/events',
          refresh: { type: 'sse', sseEvents: ['item:updated'] },
          actions: [],
          options: { maxItems: 50, showImages: true, showConfidence: true },
          visible: true,
          pricingTier: 'free',
        },
        {
          id: 'flag-list',
          type: 'flag_list',
          title: 'Attention Needed',
          subtitle: 'Items with flags',
          size: 'medium',
          position: { col: 8, row: 2, colSpan: 4, rowSpan: 3 },
          dataSource: '/api/live/items?flagged=true',
          refresh: { type: 'sse', sseEvents: ['item:flagged'] },
          actions: [],
          options: { groupByFlag: true, showCount: true },
          visible: true,
          pricingTier: 'free',
        },

        // Row 5: Category chart + aisle map
        {
          id: 'category-chart',
          type: 'category_chart',
          title: 'By Category',
          subtitle: 'Inventory breakdown',
          size: 'medium',
          position: { col: 0, row: 5, colSpan: 6, rowSpan: 3 },
          dataSource: '/api/live/items',
          refresh: { type: 'sse', sseEvents: ['session:updated'] },
          actions: [],
          options: { chartType: 'donut', showLegend: true, showValues: true, maxCategories: 10 },
          visible: true,
          pricingTier: 'solo',
        },
        {
          id: 'aisle-map',
          type: 'aisle_map',
          title: 'Store Coverage',
          subtitle: 'Aisles scanned',
          size: 'medium',
          position: { col: 6, row: 5, colSpan: 6, rowSpan: 3 },
          dataSource: '/api/live',
          refresh: { type: 'sse', sseEvents: ['session:updated'] },
          actions: [],
          options: { showHeatmap: true, showLabels: true },
          visible: true,
          pricingTier: 'solo',
        },

        // Row 8: Full item table
        {
          id: 'item-table',
          type: 'item_table',
          title: 'Inventory Items',
          subtitle: 'Complete item listing',
          size: 'full',
          position: { col: 0, row: 8, colSpan: 12, rowSpan: 4 },
          dataSource: '/api/live/items',
          refresh: { type: 'sse', sseEvents: ['item:updated'] },
          actions: [
            { id: 'export-csv', label: 'Export CSV', icon: '📥', type: 'export', target: '/api/sessions/{id}/export?format=csv', primary: true },
            { id: 'export-json', label: 'Export JSON', icon: '📋', type: 'export', target: '/api/sessions/{id}/export?format=json' },
          ],
          options: {
            pageSize: 50,
            sortable: true,
            filterable: true,
            searchable: true,
            columns: ['name', 'sku', 'quantity', 'category', 'aisle', 'price', 'confidence', 'flags'],
          },
          visible: true,
          pricingTier: 'free',
        },

        // Row 12: Health + agent status
        {
          id: 'health-monitor',
          type: 'health_monitor',
          title: 'System Health',
          size: 'medium',
          position: { col: 0, row: 12, colSpan: 6, rowSpan: 2 },
          dataSource: '/api/health',
          refresh: { type: 'poll', intervalMs: 10000 },
          actions: [],
          options: { showBattery: true, showConnection: true, showGPS: true },
          visible: true,
          pricingTier: 'free',
        },
        {
          id: 'agent-status',
          type: 'agent_status',
          title: 'AI Agents',
          subtitle: 'Active agent modules',
          size: 'medium',
          position: { col: 6, row: 12, colSpan: 6, rowSpan: 2 },
          dataSource: '/api/agents',
          refresh: { type: 'poll', intervalMs: 30000 },
          actions: [],
          options: { showToggle: true, showHealth: true },
          visible: true,
          pricingTier: 'free',
        },
      ],
    });

    // ── Sessions View ───────────────────────────
    this.layouts.set('sessions', {
      id: 'sessions-default',
      view: 'sessions',
      name: 'Session History',
      gridColumns: this.config.gridColumns,
      theme: 'auto',
      isDefault: true,
      widgets: [
        {
          id: 'sessions-list',
          type: 'item_table',
          title: 'Inventory Sessions',
          subtitle: 'Past and current sessions',
          size: 'full',
          position: { col: 0, row: 0, colSpan: 12, rowSpan: 6 },
          dataSource: '/api/sessions',
          refresh: { type: 'poll', intervalMs: 60000 },
          actions: [
            { id: 'new-session', label: 'New Session', icon: '➕', type: 'modal', primary: true },
          ],
          options: {
            pageSize: 20,
            sortable: true,
            filterable: true,
            searchable: true,
            columns: ['name', 'store', 'date', 'items', 'skus', 'accuracy', 'duration', 'status'],
          },
          visible: true,
          pricingTier: 'free',
        },
        {
          id: 'sessions-comparison',
          type: 'comparison',
          title: 'Session Comparison',
          subtitle: 'Compare inventories over time',
          size: 'full',
          position: { col: 0, row: 6, colSpan: 12, rowSpan: 4 },
          dataSource: '/api/sessions/compare',
          refresh: { type: 'manual' },
          actions: [],
          options: { maxSessions: 5, showDiff: true, showTrend: true },
          visible: true,
          pricingTier: 'multi',
        },
      ],
    });

    // ── Analytics View ──────────────────────────
    this.layouts.set('analytics', {
      id: 'analytics-default',
      view: 'analytics',
      name: 'Analytics',
      gridColumns: this.config.gridColumns,
      theme: 'auto',
      isDefault: true,
      widgets: [
        {
          id: 'revenue-meter',
          type: 'revenue_meter',
          title: 'Value Generated',
          subtitle: 'Estimated savings from using Inventory Vision',
          size: 'large',
          position: { col: 0, row: 0, colSpan: 12, rowSpan: 2 },
          dataSource: '/api/analytics/value',
          refresh: { type: 'poll', intervalMs: 60000 },
          actions: [],
          options: {
            showTimeSaved: true,
            showMoneySaved: true,
            showAccuracyImprovement: true,
            showROI: true,
          },
          visible: true,
          pricingTier: 'solo',
        },
        {
          id: 'analytics-timeline',
          type: 'activity_timeline',
          title: 'Activity History',
          subtitle: 'Recent inventory activities',
          size: 'full',
          position: { col: 0, row: 2, colSpan: 12, rowSpan: 4 },
          dataSource: '/api/analytics/timeline',
          refresh: { type: 'poll', intervalMs: 60000 },
          actions: [],
          options: { timeRange: '30d', groupBy: 'day' },
          visible: true,
          pricingTier: 'solo',
        },
      ],
    });

    // ── Settings View ───────────────────────────
    this.layouts.set('settings', {
      id: 'settings-default',
      view: 'settings',
      name: 'Settings',
      gridColumns: this.config.gridColumns,
      theme: 'auto',
      isDefault: true,
      widgets: [
        {
          id: 'export-panel',
          type: 'export_panel',
          title: 'Export & Integration',
          subtitle: 'Data export and POS integration settings',
          size: 'large',
          position: { col: 0, row: 0, colSpan: 12, rowSpan: 3 },
          dataSource: '/api/settings/export',
          refresh: { type: 'manual' },
          actions: [],
          options: {
            formats: ['csv', 'json', 'excel', 'quickbooks'],
            integrations: ['square', 'shopify', 'clover'],
          },
          visible: true,
          pricingTier: 'free',
        },
      ],
    });

    // ── Store View ──────────────────────────────
    this.layouts.set('store', {
      id: 'store-default',
      view: 'store',
      name: 'Store Profile',
      gridColumns: this.config.gridColumns,
      theme: 'auto',
      isDefault: true,
      widgets: [
        {
          id: 'store-profile',
          type: 'custom',
          title: 'Store Information',
          subtitle: 'Store details and configuration',
          size: 'large',
          position: { col: 0, row: 0, colSpan: 12, rowSpan: 3 },
          dataSource: '/api/store/profile',
          refresh: { type: 'manual' },
          actions: [
            { id: 'edit-store', label: 'Edit', icon: '✏️', type: 'modal' },
          ],
          options: {},
          visible: true,
          pricingTier: 'free',
        },
        {
          id: 'store-layout-map',
          type: 'aisle_map',
          title: 'Store Layout',
          subtitle: 'Aisle and section map from your last walkthrough',
          size: 'large',
          position: { col: 0, row: 3, colSpan: 12, rowSpan: 4 },
          dataSource: '/api/store/layout',
          refresh: { type: 'manual' },
          actions: [],
          options: { showHeatmap: true, showLabels: true, interactive: true },
          visible: true,
          pricingTier: 'solo',
        },
      ],
    });
  }

  // ─── Serialization ──────────────────────────────────────────

  /**
   * Export all layouts for persistence.
   */
  exportLayouts(): Record<string, DashboardLayout> {
    const result: Record<string, DashboardLayout> = {};
    for (const [view, layout] of this.layouts) {
      result[view] = layout;
    }
    return result;
  }

  /**
   * Import layouts from saved state.
   */
  importLayouts(data: Record<string, DashboardLayout>): void {
    for (const [view, layout] of Object.entries(data)) {
      this.layouts.set(view as DashboardView, layout);
    }
  }

  /**
   * Reset a view to its default layout.
   */
  resetLayout(view: DashboardView): void {
    // Re-initialize will overwrite
    this.initializeDefaultLayouts();
    this.emit('layout:changed', view);
  }

  /**
   * Get total widget count across all views.
   */
  getTotalWidgetCount(): number {
    let count = 0;
    for (const layout of this.layouts.values()) {
      count += layout.widgets.length;
    }
    return count;
  }

  /**
   * Get all widget IDs for a specific view.
   */
  getWidgetIds(view: DashboardView): string[] {
    const layout = this.layouts.get(view);
    if (!layout) return [];
    return layout.widgets.map(w => w.id);
  }
}
