/**
 * Tests for WidgetSystem — dashboard component infrastructure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WidgetSystem,
  WidgetConfig,
  DashboardView,
} from './widget-system.js';

// ─── Tests ──────────────────────────────────────────────────────

describe('WidgetSystem', () => {
  let system: WidgetSystem;

  beforeEach(() => {
    system = new WidgetSystem();
  });

  // ─── Initialization ─────────────────────────────────────────

  describe('initialization', () => {
    it('should create with default config', () => {
      expect(system).toBeTruthy();
    });

    it('should initialize 5 default layouts', () => {
      const layouts = system.getAllLayouts();
      expect(layouts.length).toBe(5);
    });

    it('should have all expected views', () => {
      expect(system.getLayout('live')).toBeTruthy();
      expect(system.getLayout('sessions')).toBeTruthy();
      expect(system.getLayout('analytics')).toBeTruthy();
      expect(system.getLayout('settings')).toBeTruthy();
      expect(system.getLayout('store')).toBeTruthy();
    });

    it('should start on live view', () => {
      expect(system.getCurrentView()).toBe('live');
    });

    it('should default to dark theme', () => {
      expect(system.getTheme().name).toBe('dark');
    });

    it('should support light theme', () => {
      const lightSystem = new WidgetSystem({ defaultTheme: 'light' });
      expect(lightSystem.getTheme().name).toBe('light');
    });

    it('should have widgets in the live layout', () => {
      const live = system.getLayout('live');
      expect(live!.widgets.length).toBeGreaterThan(0);
    });
  });

  // ─── Live Layout ────────────────────────────────────────────

  describe('live layout', () => {
    it('should have stat cards', () => {
      const live = system.getLayout('live')!;
      const statCards = live.widgets.filter(w => w.type === 'stat_card');
      expect(statCards.length).toBe(4);
    });

    it('should have items counted stat', () => {
      const live = system.getLayout('live')!;
      const itemsStat = live.widgets.find(w => w.id === 'stat-items');
      expect(itemsStat).toBeTruthy();
      expect(itemsStat!.title).toBe('Items Counted');
    });

    it('should have progress bar', () => {
      const live = system.getLayout('live')!;
      const progress = live.widgets.find(w => w.type === 'progress_bar');
      expect(progress).toBeTruthy();
    });

    it('should have live item feed', () => {
      const live = system.getLayout('live')!;
      const feed = live.widgets.find(w => w.type === 'item_feed');
      expect(feed).toBeTruthy();
    });

    it('should have flag list', () => {
      const live = system.getLayout('live')!;
      const flags = live.widgets.find(w => w.type === 'flag_list');
      expect(flags).toBeTruthy();
    });

    it('should have category chart', () => {
      const live = system.getLayout('live')!;
      const chart = live.widgets.find(w => w.type === 'category_chart');
      expect(chart).toBeTruthy();
    });

    it('should have aisle map', () => {
      const live = system.getLayout('live')!;
      const map = live.widgets.find(w => w.type === 'aisle_map');
      expect(map).toBeTruthy();
    });

    it('should have item table', () => {
      const live = system.getLayout('live')!;
      const table = live.widgets.find(w => w.type === 'item_table');
      expect(table).toBeTruthy();
    });

    it('should have health monitor', () => {
      const live = system.getLayout('live')!;
      const health = live.widgets.find(w => w.type === 'health_monitor');
      expect(health).toBeTruthy();
    });

    it('should have agent status', () => {
      const live = system.getLayout('live')!;
      const agents = live.widgets.find(w => w.type === 'agent_status');
      expect(agents).toBeTruthy();
    });

    it('should have export actions on item table', () => {
      const live = system.getLayout('live')!;
      const table = live.widgets.find(w => w.id === 'item-table');
      expect(table!.actions.length).toBeGreaterThan(0);
      expect(table!.actions.some(a => a.type === 'export')).toBe(true);
    });

    it('should use SSE for real-time widgets', () => {
      const live = system.getLayout('live')!;
      const sseWidgets = live.widgets.filter(w => w.refresh.type === 'sse');
      expect(sseWidgets.length).toBeGreaterThanOrEqual(5);
    });

    it('should use polling for health monitor', () => {
      const live = system.getLayout('live')!;
      const health = live.widgets.find(w => w.id === 'health-monitor');
      expect(health!.refresh.type).toBe('poll');
      expect(health!.refresh.intervalMs).toBe(10000);
    });

    it('should have stop/pause actions on progress bar', () => {
      const live = system.getLayout('live')!;
      const progress = live.widgets.find(w => w.type === 'progress_bar');
      expect(progress!.actions.length).toBe(2);
      const stop = progress!.actions.find(a => a.id === 'stop');
      expect(stop!.confirm).toBe(true);
    });
  });

  // ─── Sessions Layout ────────────────────────────────────────

  describe('sessions layout', () => {
    it('should have sessions list table', () => {
      const sessions = system.getLayout('sessions')!;
      expect(sessions.widgets.some(w => w.id === 'sessions-list')).toBe(true);
    });

    it('should have comparison widget', () => {
      const sessions = system.getLayout('sessions')!;
      const comparison = sessions.widgets.find(w => w.type === 'comparison');
      expect(comparison).toBeTruthy();
      expect(comparison!.pricingTier).toBe('multi'); // Gated
    });

    it('should have new session action', () => {
      const sessions = system.getLayout('sessions')!;
      const list = sessions.widgets.find(w => w.id === 'sessions-list');
      expect(list!.actions.some(a => a.id === 'new-session')).toBe(true);
    });
  });

  // ─── Analytics Layout ───────────────────────────────────────

  describe('analytics layout', () => {
    it('should have revenue meter', () => {
      const analytics = system.getLayout('analytics')!;
      expect(analytics.widgets.some(w => w.type === 'revenue_meter')).toBe(true);
    });

    it('should have activity timeline', () => {
      const analytics = system.getLayout('analytics')!;
      expect(analytics.widgets.some(w => w.type === 'activity_timeline')).toBe(true);
    });
  });

  // ─── View Navigation ───────────────────────────────────────

  describe('view navigation', () => {
    it('should switch views', () => {
      system.switchView('sessions');
      expect(system.getCurrentView()).toBe('sessions');
    });

    it('should return layout when switching', () => {
      const layout = system.switchView('analytics');
      expect(layout).toBeTruthy();
      expect(layout!.view).toBe('analytics');
    });

    it('should emit view:changed event', () => {
      const handler = vi.fn();
      system.on('view:changed', handler);
      system.switchView('settings');
      expect(handler).toHaveBeenCalledWith('settings');
    });

    it('should return undefined for non-existent view', () => {
      const layout = system.switchView('nonexistent' as DashboardView);
      expect(layout).toBeUndefined();
    });
  });

  // ─── Widget Management ──────────────────────────────────────

  describe('widget management', () => {
    it('should add a widget to a view', () => {
      const widget = WidgetSystem.createStatCard({
        id: 'custom-stat',
        title: 'Custom Metric',
      });

      system.addWidget('live', widget);
      const found = system.getWidget('custom-stat');
      expect(found).toBeTruthy();
      expect(found!.view).toBe('live');
    });

    it('should reject duplicate widget IDs', () => {
      expect(() =>
        system.addWidget('live', WidgetSystem.createStatCard({
          id: 'stat-items', // Already exists
          title: 'Duplicate',
        }))
      ).toThrow('already exists');
    });

    it('should enforce max widgets per view', () => {
      const smallSystem = new WidgetSystem({ maxWidgetsPerView: 2, pricingTier: 'enterprise' });
      // Clear default widgets first
      const live = smallSystem.getLayout('live')!;
      live.widgets = [];

      smallSystem.addWidget('live', WidgetSystem.createStatCard({ id: 'w1', title: 'W1' }));
      smallSystem.addWidget('live', WidgetSystem.createStatCard({ id: 'w2', title: 'W2' }));
      expect(() =>
        smallSystem.addWidget('live', WidgetSystem.createStatCard({ id: 'w3', title: 'W3' }))
      ).toThrow('Maximum widgets');
    });

    it('should throw for unknown view when adding', () => {
      const widget = WidgetSystem.createStatCard({ id: 'test', title: 'Test' });
      expect(() => system.addWidget('nonexistent' as DashboardView, widget)).toThrow('Unknown view');
    });

    it('should remove a widget', () => {
      system.removeWidget('live', 'stat-items');
      expect(system.getWidget('stat-items')).toBeUndefined();
    });

    it('should throw when removing non-existent widget', () => {
      expect(() => system.removeWidget('live', 'nonexistent')).toThrow('not found');
    });

    it('should throw for unknown view when removing', () => {
      expect(() => system.removeWidget('nonexistent' as DashboardView, 'test')).toThrow('Unknown view');
    });

    it('should update a widget', () => {
      system.updateWidget('live', 'stat-items', { title: 'New Title' });
      const found = system.getWidget('stat-items');
      expect(found!.widget.title).toBe('New Title');
    });

    it('should throw when updating non-existent widget', () => {
      expect(() => system.updateWidget('live', 'nonexistent', {})).toThrow('not found');
    });

    it('should emit widget:added event', () => {
      const handler = vi.fn();
      system.on('widget:added', handler);
      system.addWidget('live', WidgetSystem.createStatCard({ id: 'new-w', title: 'New' }));
      expect(handler).toHaveBeenCalledWith('new-w', 'live');
    });

    it('should emit widget:removed event', () => {
      const handler = vi.fn();
      system.on('widget:removed', handler);
      system.removeWidget('live', 'stat-items');
      expect(handler).toHaveBeenCalledWith('stat-items');
    });

    it('should emit widget:updated event', () => {
      const handler = vi.fn();
      system.on('widget:updated', handler);
      system.updateWidget('live', 'stat-items', { visible: false });
      expect(handler).toHaveBeenCalledWith('stat-items');
    });
  });

  // ─── Widget Visibility ──────────────────────────────────────

  describe('widget visibility', () => {
    it('should toggle widget visibility', () => {
      const initial = system.getWidget('stat-items')!.widget.visible;
      const newState = system.toggleWidget('live', 'stat-items');
      expect(newState).toBe(!initial);
    });

    it('should return false for unknown view', () => {
      expect(system.toggleWidget('nonexistent' as DashboardView, 'stat-items')).toBe(false);
    });

    it('should return false for unknown widget', () => {
      expect(system.toggleWidget('live', 'nonexistent')).toBe(false);
    });

    it('should filter invisible widgets in getCurrentWidgets', () => {
      const before = system.getCurrentWidgets().length;
      system.toggleWidget('live', 'stat-items'); // Hide it
      const after = system.getCurrentWidgets().length;
      expect(after).toBe(before - 1);
    });
  });

  // ─── Pricing Tier Gating ────────────────────────────────────

  describe('pricing tier gating', () => {
    it('should allow free widgets on free tier', () => {
      const freeSystem = new WidgetSystem({ pricingTier: 'free' });
      const freeWidget = WidgetSystem.createStatCard({ id: 'test', title: 'Test', pricingTier: 'free' });
      expect(freeSystem.isWidgetAllowed(freeWidget)).toBe(true);
    });

    it('should block solo widgets on free tier', () => {
      const freeSystem = new WidgetSystem({ pricingTier: 'free' });
      const soloWidget = WidgetSystem.createStatCard({ id: 'test', title: 'Test', pricingTier: 'solo' });
      expect(freeSystem.isWidgetAllowed(soloWidget)).toBe(false);
    });

    it('should allow solo widgets on solo tier', () => {
      const soloSystem = new WidgetSystem({ pricingTier: 'solo' });
      const soloWidget = WidgetSystem.createStatCard({ id: 'test', title: 'Test', pricingTier: 'solo' });
      expect(soloSystem.isWidgetAllowed(soloWidget)).toBe(true);
    });

    it('should allow enterprise widgets on enterprise tier', () => {
      const entSystem = new WidgetSystem({ pricingTier: 'enterprise' });
      const entWidget = WidgetSystem.createStatCard({ id: 'test', title: 'Test', pricingTier: 'enterprise' });
      expect(entSystem.isWidgetAllowed(entWidget)).toBe(true);
    });

    it('should filter gated widgets in getCurrentWidgets', () => {
      const freeSystem = new WidgetSystem({ pricingTier: 'free' });
      const allWidgets = freeSystem.getLayout('live')!.widgets;
      const visibleWidgets = freeSystem.getCurrentWidgets();
      // Some live widgets are gated to 'solo'
      expect(visibleWidgets.length).toBeLessThan(allWidgets.length);
    });
  });

  // ─── Theme ──────────────────────────────────────────────────

  describe('theme', () => {
    it('should get current theme', () => {
      const theme = system.getTheme();
      expect(theme.name).toBe('dark');
      expect(theme.primaryColor).toBeTruthy();
    });

    it('should switch to light theme', () => {
      system.setTheme('light');
      expect(system.getTheme().name).toBe('light');
    });

    it('should switch back to dark theme', () => {
      system.setTheme('light');
      system.setTheme('dark');
      expect(system.getTheme().name).toBe('dark');
    });

    it('should emit theme:changed event', () => {
      const handler = vi.fn();
      system.on('theme:changed', handler);
      system.setTheme('light');
      expect(handler).toHaveBeenCalled();
    });

    it('should return two available themes', () => {
      const themes = system.getAvailableThemes();
      expect(themes.length).toBe(2);
      expect(themes.map(t => t.name)).toContain('light');
      expect(themes.map(t => t.name)).toContain('dark');
    });

    it('should have complete theme properties', () => {
      const theme = system.getTheme();
      expect(theme.primaryColor).toBeTruthy();
      expect(theme.secondaryColor).toBeTruthy();
      expect(theme.backgroundColor).toBeTruthy();
      expect(theme.textColor).toBeTruthy();
      expect(theme.successColor).toBeTruthy();
      expect(theme.warningColor).toBeTruthy();
      expect(theme.dangerColor).toBeTruthy();
      expect(theme.fontFamily).toBeTruthy();
      expect(theme.borderRadius).toBeGreaterThan(0);
    });
  });

  // ─── Static Helpers ─────────────────────────────────────────

  describe('static helpers', () => {
    it('should create a stat card', () => {
      const card = WidgetSystem.createStatCard({ id: 'test', title: 'Test Metric' });
      expect(card.type).toBe('stat_card');
      expect(card.title).toBe('Test Metric');
      expect(card.size).toBe('small');
    });

    it('should create a table', () => {
      const table = WidgetSystem.createTable({ id: 'test', title: 'Test Table' });
      expect(table.type).toBe('item_table');
      expect(table.size).toBe('large');
      expect(table.actions.length).toBeGreaterThan(0);
    });

    it('should allow overriding stat card defaults', () => {
      const card = WidgetSystem.createStatCard({
        id: 'custom',
        title: 'Custom',
        size: 'large',
        pricingTier: 'enterprise',
      });
      expect(card.size).toBe('large');
      expect(card.pricingTier).toBe('enterprise');
    });
  });

  // ─── Serialization ─────────────────────────────────────────

  describe('serialization', () => {
    it('should export all layouts', () => {
      const exported = system.exportLayouts();
      expect(Object.keys(exported)).toContain('live');
      expect(Object.keys(exported)).toContain('sessions');
      expect(Object.keys(exported)).toContain('analytics');
    });

    it('should import layouts', () => {
      const exported = system.exportLayouts();
      const newSystem = new WidgetSystem();
      newSystem.importLayouts(exported);
      expect(newSystem.getLayout('live')!.widgets.length).toBe(exported.live.widgets.length);
    });

    it('should reset layout to defaults', () => {
      system.removeWidget('live', 'stat-items');
      const before = system.getLayout('live')!.widgets.length;
      system.resetLayout('live');
      const after = system.getLayout('live')!.widgets.length;
      expect(after).toBeGreaterThan(before);
    });

    it('should emit layout:changed on reset', () => {
      const handler = vi.fn();
      system.on('layout:changed', handler);
      system.resetLayout('live');
      expect(handler).toHaveBeenCalledWith('live');
    });
  });

  // ─── Utility ────────────────────────────────────────────────

  describe('utility', () => {
    it('should count total widgets', () => {
      const count = system.getTotalWidgetCount();
      expect(count).toBeGreaterThan(10);
    });

    it('should get widget IDs for a view', () => {
      const ids = system.getWidgetIds('live');
      expect(ids).toContain('stat-items');
      expect(ids).toContain('item-table');
    });

    it('should return empty for unknown view', () => {
      expect(system.getWidgetIds('nonexistent' as DashboardView)).toEqual([]);
    });

    it('should find widgets across views', () => {
      const found = system.getWidget('sessions-list');
      expect(found).toBeTruthy();
      expect(found!.view).toBe('sessions');
    });

    it('should return undefined for non-existent widget', () => {
      expect(system.getWidget('nonexistent')).toBeUndefined();
    });
  });
});
