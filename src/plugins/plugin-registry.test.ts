/**
 * Tests for PluginRegistry — the dynamic agent plugin system.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PluginRegistry,
  PluginMetadata,
  PluginConfigSchema,
  PluginConfig,
  PluginInstance,
  PluginCapability,
  PricingTier,
} from './plugin-registry.js';

// ─── Test Helpers ───────────────────────────────────────────────

function makePlugin(overrides: Partial<PluginMetadata> = {}): PluginMetadata {
  return {
    id: overrides.id !== undefined ? overrides.id : 'com.test.plugin',
    name: overrides.name || 'Test Plugin',
    description: overrides.description || 'A test plugin',
    version: overrides.version !== undefined ? overrides.version : '1.0.0',
    author: overrides.author || 'Test',
    category: overrides.category || 'agent',
    icon: overrides.icon || '🧪',
    capabilities: overrides.capabilities || ['camera:read'],
    pricingTier: overrides.pricingTier || 'free',
    dependencies: overrides.dependencies || [],
    conflicts: overrides.conflicts || [],
    tags: overrides.tags || ['test'],
    isCore: overrides.isCore || false,
  };
}

function createAndEnable(
  registry: PluginRegistry,
  overrides: Partial<PluginMetadata> = {}
): PluginInstance {
  const meta = makePlugin(overrides);
  const instance = registry.register(meta);
  registry.install(meta.id);
  registry.enable(meta.id);
  return instance;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry({ currentPricingTier: 'enterprise' });
  });

  // ─── Registration ───────────────────────────────────────────

  describe('register', () => {
    it('should register a new plugin', () => {
      const meta = makePlugin();
      const instance = registry.register(meta);

      expect(instance.metadata.id).toBe('com.test.plugin');
      expect(instance.state).toBe('registered');
      expect(registry.size).toBe(1);
    });

    it('should reject duplicate IDs', () => {
      registry.register(makePlugin());
      expect(() => registry.register(makePlugin())).toThrow('already registered');
    });

    it('should reject empty plugin ID', () => {
      expect(() => registry.register(makePlugin({ id: '' }))).toThrow('Invalid plugin');
    });

    it('should reject single-character ID', () => {
      expect(() => registry.register(makePlugin({ id: 'x' }))).toThrow('Invalid plugin ID');
    });

    it('should reject ID longer than 128 chars', () => {
      expect(() => registry.register(makePlugin({ id: 'a'.repeat(129) }))).toThrow('Invalid plugin ID');
    });

    it('should reject invalid version format', () => {
      expect(() => registry.register(makePlugin({ version: 'latest' }))).toThrow('Invalid version');
    });

    it('should accept valid semver versions', () => {
      const instance = registry.register(makePlugin({ version: '2.1.3' }));
      expect(instance.metadata.version).toBe('2.1.3');
    });

    it('should accept semver with pre-release suffix', () => {
      const instance = registry.register(makePlugin({ version: '1.0.0-beta.1' }));
      expect(instance.metadata.version).toBe('1.0.0-beta.1');
    });

    it('should enforce max plugins limit', () => {
      const smallRegistry = new PluginRegistry({ maxPlugins: 2, currentPricingTier: 'enterprise' });
      smallRegistry.register(makePlugin({ id: 'p1' }));
      smallRegistry.register(makePlugin({ id: 'p2' }));
      expect(() => smallRegistry.register(makePlugin({ id: 'p3' }))).toThrow('Plugin limit reached');
    });

    it('should set registeredAt timestamp', () => {
      const instance = registry.register(makePlugin());
      expect(instance.registeredAt).toBeTruthy();
      expect(new Date(instance.registeredAt).getTime()).toBeGreaterThan(0);
    });

    it('should initialize health as healthy', () => {
      const instance = registry.register(makePlugin());
      expect(instance.health.healthy).toBe(true);
      expect(instance.health.consecutiveFailures).toBe(0);
      expect(instance.health.uptime).toBe(1);
    });

    it('should grant default capabilities', () => {
      const meta = makePlugin({ capabilities: ['camera:read', 'storage:read'] });
      const instance = registry.register(meta);
      expect(instance.grantedCapabilities).toContain('camera:read');
      expect(instance.grantedCapabilities).toContain('storage:read');
    });

    it('should NOT auto-grant restricted capabilities', () => {
      const meta = makePlugin({ capabilities: ['camera:read', 'network:internet'] });
      const instance = registry.register(meta);
      expect(instance.grantedCapabilities).toContain('camera:read');
      expect(instance.grantedCapabilities).not.toContain('network:internet');
    });

    it('should emit plugin:registered event', () => {
      const handler = vi.fn();
      registry.on('plugin:registered', handler);
      registry.register(makePlugin());
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should store default config', () => {
      const instance = registry.register(makePlugin(), [], { key: 'value' });
      expect(instance.config.key).toBe('value');
    });
  });

  // ─── Install ────────────────────────────────────────────────

  describe('install', () => {
    it('should install a registered plugin', () => {
      registry.register(makePlugin());
      registry.install('com.test.plugin');
      expect(registry.getPlugin('com.test.plugin')!.state).toBe('installed');
    });

    it('should reject installing non-registered plugin', () => {
      registry.register(makePlugin());
      registry.install('com.test.plugin');
      expect(() => registry.install('com.test.plugin')).toThrow('Cannot install');
    });

    it('should reject if pricing tier insufficient', () => {
      const freeRegistry = new PluginRegistry({ currentPricingTier: 'free' });
      freeRegistry.register(makePlugin({ pricingTier: 'enterprise' }));
      expect(() => freeRegistry.install('com.test.plugin')).toThrow('requires tier');
    });

    it('should allow addon tier regardless of user tier', () => {
      const freeRegistry = new PluginRegistry({ currentPricingTier: 'free' });
      freeRegistry.register(makePlugin({ pricingTier: 'addon' }));
      freeRegistry.install('com.test.plugin');
      expect(freeRegistry.getPlugin('com.test.plugin')!.state).toBe('installed');
    });

    it('should emit plugin:installed event', () => {
      const handler = vi.fn();
      registry.on('plugin:installed', handler);
      registry.register(makePlugin());
      registry.install('com.test.plugin');
      expect(handler).toHaveBeenCalledWith('com.test.plugin');
    });

    it('should throw for unknown plugin', () => {
      expect(() => registry.install('nonexistent')).toThrow('not found');
    });
  });

  // ─── Enable ─────────────────────────────────────────────────

  describe('enable', () => {
    it('should enable an installed plugin', () => {
      registry.register(makePlugin());
      registry.install('com.test.plugin');
      registry.enable('com.test.plugin');
      expect(registry.getPlugin('com.test.plugin')!.state).toBe('enabled');
    });

    it('should enable a disabled plugin', () => {
      createAndEnable(registry);
      registry.disable('com.test.plugin');
      registry.enable('com.test.plugin');
      expect(registry.getPlugin('com.test.plugin')!.state).toBe('enabled');
    });

    it('should reject enabling from registered state', () => {
      registry.register(makePlugin());
      expect(() => registry.enable('com.test.plugin')).toThrow('Cannot enable');
    });

    it('should check dependencies', () => {
      registry.register(makePlugin({ id: 'dep', dependencies: [] }));
      registry.register(makePlugin({ id: 'child', dependencies: ['dep'] }));
      registry.install('child');
      expect(() => registry.enable('child')).toThrow('Missing dependencies');
    });

    it('should succeed when dependencies are enabled', () => {
      createAndEnable(registry, { id: 'dep' });
      registry.register(makePlugin({ id: 'child', dependencies: ['dep'] }));
      registry.install('child');
      registry.enable('child');
      expect(registry.getPlugin('child')!.state).toBe('enabled');
    });

    it('should check conflicts', () => {
      createAndEnable(registry, { id: 'plugin-a' });
      registry.register(makePlugin({ id: 'plugin-b', conflicts: ['plugin-a'] }));
      registry.install('plugin-b');
      expect(() => registry.enable('plugin-b')).toThrow('conflicts');
    });

    it('should set enabledAt timestamp', () => {
      createAndEnable(registry);
      expect(registry.getPlugin('com.test.plugin')!.enabledAt).toBeTruthy();
    });

    it('should emit plugin:enabled event', () => {
      const handler = vi.fn();
      registry.on('plugin:enabled', handler);
      registry.register(makePlugin());
      registry.install('com.test.plugin');
      registry.enable('com.test.plugin');
      expect(handler).toHaveBeenCalledWith('com.test.plugin');
    });

    it('should clear previous error on re-enable', () => {
      createAndEnable(registry);
      const plugin = registry.getPlugin('com.test.plugin')!;
      plugin.error = 'old error';
      registry.disable('com.test.plugin');
      registry.enable('com.test.plugin');
      expect(registry.getPlugin('com.test.plugin')!.error).toBeUndefined();
    });
  });

  // ─── Disable ────────────────────────────────────────────────

  describe('disable', () => {
    it('should disable an enabled plugin', () => {
      createAndEnable(registry);
      registry.disable('com.test.plugin');
      expect(registry.getPlugin('com.test.plugin')!.state).toBe('disabled');
    });

    it('should reject disabling a non-enabled plugin', () => {
      registry.register(makePlugin());
      registry.install('com.test.plugin');
      expect(() => registry.disable('com.test.plugin')).toThrow('Cannot disable');
    });

    it('should prevent disabling if dependents exist', () => {
      createAndEnable(registry, { id: 'dep' });
      createAndEnable(registry, { id: 'child', dependencies: ['dep'] });
      expect(() => registry.disable('dep')).toThrow('depend on it');
    });

    it('should allow disabling with error_recovery reason even with dependents', () => {
      createAndEnable(registry, { id: 'dep' });
      createAndEnable(registry, { id: 'child', dependencies: ['dep'] });
      registry.disable('dep', 'error_recovery');
      expect(registry.getPlugin('dep')!.state).toBe('disabled');
    });

    it('should set disabledAt timestamp', () => {
      createAndEnable(registry);
      registry.disable('com.test.plugin');
      expect(registry.getPlugin('com.test.plugin')!.disabledAt).toBeTruthy();
    });

    it('should remove hooks from disabled plugin', () => {
      createAndEnable(registry);
      registry.registerHook('test:hook', 'com.test.plugin', vi.fn());
      expect(registry.getRegisteredHooks()).toContain('test:hook');
      registry.disable('com.test.plugin');
      expect(registry.getRegisteredHooks()).not.toContain('test:hook');
    });

    it('should emit plugin:disabled event', () => {
      createAndEnable(registry);
      const handler = vi.fn();
      registry.on('plugin:disabled', handler);
      registry.disable('com.test.plugin', 'test-reason');
      expect(handler).toHaveBeenCalledWith('com.test.plugin', 'test-reason');
    });

    it('should allow disabling from error state', () => {
      createAndEnable(registry);
      const plugin = registry.getPlugin('com.test.plugin')!;
      plugin.state = 'error';
      registry.disable('com.test.plugin');
      expect(plugin.state).toBe('disabled');
    });
  });

  // ─── Uninstall ──────────────────────────────────────────────

  describe('uninstall', () => {
    it('should uninstall a disabled plugin', () => {
      createAndEnable(registry);
      registry.disable('com.test.plugin');
      registry.uninstall('com.test.plugin');
      expect(registry.getPlugin('com.test.plugin')).toBeUndefined();
      expect(registry.size).toBe(0);
    });

    it('should auto-disable before uninstalling an enabled plugin', () => {
      createAndEnable(registry);
      registry.uninstall('com.test.plugin');
      expect(registry.getPlugin('com.test.plugin')).toBeUndefined();
    });

    it('should uninstall an installed (not enabled) plugin', () => {
      registry.register(makePlugin());
      registry.install('com.test.plugin');
      registry.uninstall('com.test.plugin');
      expect(registry.size).toBe(0);
    });

    it('should reject if dependents exist', () => {
      createAndEnable(registry, { id: 'dep' });
      createAndEnable(registry, { id: 'child', dependencies: ['dep'] });
      expect(() => registry.uninstall('dep')).toThrow('depend on it');
    });

    it('should emit plugin:uninstalled event', () => {
      const handler = vi.fn();
      registry.on('plugin:uninstalled', handler);
      createAndEnable(registry);
      registry.disable('com.test.plugin');
      registry.uninstall('com.test.plugin');
      expect(handler).toHaveBeenCalledWith('com.test.plugin');
    });

    it('should clean up hooks on uninstall', () => {
      createAndEnable(registry);
      registry.registerHook('myhook', 'com.test.plugin', vi.fn());
      registry.uninstall('com.test.plugin');
      expect(registry.getRegisteredHooks()).toHaveLength(0);
    });
  });

  // ─── Error & Recovery ───────────────────────────────────────

  describe('error and recovery', () => {
    it('should track consecutive failures', () => {
      createAndEnable(registry);
      registry.reportError('com.test.plugin', 'boom');
      expect(registry.getPlugin('com.test.plugin')!.health.consecutiveFailures).toBe(1);
      expect(registry.getPlugin('com.test.plugin')!.health.lastError).toBe('boom');
    });

    it('should auto-disable after max failures', () => {
      const noRecovery = new PluginRegistry({
        currentPricingTier: 'enterprise',
        maxConsecutiveFailures: 3,
        autoRecovery: false,
      });
      createAndEnable(noRecovery, { id: 'fragile' });

      noRecovery.reportError('fragile', 'e1');
      noRecovery.reportError('fragile', 'e2');
      expect(noRecovery.getPlugin('fragile')!.state).toBe('enabled');

      noRecovery.reportError('fragile', 'e3');
      expect(noRecovery.getPlugin('fragile')!.state).toBe('error');
    });

    it('should reset failures on success', () => {
      createAndEnable(registry);
      registry.reportError('com.test.plugin', 'e1');
      registry.reportError('com.test.plugin', 'e2');
      registry.reportSuccess('com.test.plugin', 50);
      expect(registry.getPlugin('com.test.plugin')!.health.consecutiveFailures).toBe(0);
      expect(registry.getPlugin('com.test.plugin')!.health.healthy).toBe(true);
    });

    it('should track invocation stats on success', () => {
      createAndEnable(registry);
      registry.reportSuccess('com.test.plugin', 100);
      registry.reportSuccess('com.test.plugin', 200);
      const health = registry.getPlugin('com.test.plugin')!.health;
      expect(health.totalInvocations).toBe(2);
      expect(health.successfulInvocations).toBe(2);
      expect(health.avgResponseTimeMs).toBe(150);
    });

    it('should calculate uptime correctly', () => {
      createAndEnable(registry);
      registry.reportSuccess('com.test.plugin', 50);
      registry.reportSuccess('com.test.plugin', 50);
      expect(registry.getPlugin('com.test.plugin')!.health.uptime).toBe(1);
    });

    it('should not crash on reportSuccess for unknown plugin', () => {
      registry.reportSuccess('nonexistent', 50);
      // Should not throw
    });

    it('should emit plugin:error event', () => {
      createAndEnable(registry);
      const handler = vi.fn();
      registry.on('plugin:error', handler);
      registry.reportError('com.test.plugin', 'test error');
      expect(handler).toHaveBeenCalledWith('com.test.plugin', 'test error');
    });

    it('should schedule auto-recovery when configured', () => {
      vi.useFakeTimers();
      const recoveryRegistry = new PluginRegistry({
        currentPricingTier: 'enterprise',
        maxConsecutiveFailures: 2,
        autoRecovery: true,
        autoRecoveryDelayMs: 1000,
        maxRecoveryAttempts: 3,
      });

      createAndEnable(recoveryRegistry, { id: 'recoverable' });
      recoveryRegistry.reportError('recoverable', 'e1');
      recoveryRegistry.reportError('recoverable', 'e2');
      expect(recoveryRegistry.getPlugin('recoverable')!.state).toBe('error');

      // Fast-forward past recovery delay
      vi.advanceTimersByTime(1100);
      expect(recoveryRegistry.getPlugin('recoverable')!.state).toBe('enabled');

      vi.useRealTimers();
    });
  });

  // ─── Configuration ──────────────────────────────────────────

  describe('configuration', () => {
    const schema: PluginConfigSchema[] = [
      { key: 'name', label: 'Name', description: 'Plugin name', type: 'string', defaultValue: '', required: true },
      { key: 'count', label: 'Count', description: 'Item count', type: 'number', defaultValue: 10, min: 1, max: 100 },
      { key: 'enabled', label: 'Enabled', description: 'Is enabled', type: 'boolean', defaultValue: true },
      { key: 'mode', label: 'Mode', description: 'Operating mode', type: 'select', defaultValue: 'auto', options: [{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' }] },
    ];

    it('should get plugin config', () => {
      registry.register(makePlugin(), schema, { name: 'Test', count: 5 });
      const config = registry.getConfig('com.test.plugin');
      expect(config.name).toBe('Test');
      expect(config.count).toBe(5);
    });

    it('should update plugin config', () => {
      createAndEnable(registry);
      registry.setConfig('com.test.plugin', { key: 'new-value' });
      expect(registry.getConfig('com.test.plugin').key).toBe('new-value');
    });

    it('should emit config-changed event', () => {
      createAndEnable(registry);
      const handler = vi.fn();
      registry.on('plugin:config-changed', handler);
      registry.setConfig('com.test.plugin', { x: 1 });
      expect(handler).toHaveBeenCalled();
    });

    it('should validate required fields', () => {
      const errors = registry.validateConfig({}, schema);
      expect(errors).toContain('"name" is required');
    });

    it('should validate number range (min)', () => {
      const errors = registry.validateConfig({ name: 'x', count: 0 }, schema);
      expect(errors.some(e => e.includes('>= 1'))).toBe(true);
    });

    it('should validate number range (max)', () => {
      const errors = registry.validateConfig({ name: 'x', count: 200 }, schema);
      expect(errors.some(e => e.includes('<= 100'))).toBe(true);
    });

    it('should validate boolean type', () => {
      const errors = registry.validateConfig({ name: 'x', enabled: 'yes' }, schema);
      expect(errors.some(e => e.includes('boolean'))).toBe(true);
    });

    it('should validate select options', () => {
      const errors = registry.validateConfig({ name: 'x', mode: 'invalid' }, schema);
      expect(errors.some(e => e.includes('must be one of'))).toBe(true);
    });

    it('should validate string type', () => {
      const errors = registry.validateConfig({ name: 42 }, schema);
      expect(errors.some(e => e.includes('must be a string'))).toBe(true);
    });

    it('should validate number type', () => {
      const errors = registry.validateConfig({ name: 'x', count: 'abc' }, schema);
      expect(errors.some(e => e.includes('must be a number'))).toBe(true);
    });

    it('should accept valid config', () => {
      const errors = registry.validateConfig({ name: 'Test', count: 50, enabled: true, mode: 'manual' }, schema);
      expect(errors).toHaveLength(0);
    });

    it('should skip undefined optional fields', () => {
      const errors = registry.validateConfig({ name: 'Test' }, schema);
      expect(errors).toHaveLength(0);
    });

    it('should reject config that fails validation during setConfig', () => {
      registry.register(makePlugin(), schema, { name: 'Test' });
      registry.install('com.test.plugin');
      expect(() => registry.setConfig('com.test.plugin', { name: '' })).toThrow('Invalid config');
    });

    it('should validate multiselect type', () => {
      const multiSchema: PluginConfigSchema[] = [
        { key: 'tags', label: 'Tags', description: 'Tags', type: 'multiselect', defaultValue: [], options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      ];
      expect(registry.validateConfig({ tags: 'not-array' }, multiSchema)).toContainEqual(expect.stringContaining('must be an array'));
      expect(registry.validateConfig({ tags: ['a', 'c'] }, multiSchema)).toContainEqual(expect.stringContaining('invalid option'));
      expect(registry.validateConfig({ tags: ['a', 'b'] }, multiSchema)).toHaveLength(0);
    });

    it('should validate string pattern', () => {
      const patternSchema: PluginConfigSchema[] = [
        { key: 'email', label: 'Email', description: 'Email', type: 'string', defaultValue: '', pattern: '^[^@]+@[^@]+$' },
      ];
      expect(registry.validateConfig({ email: 'invalid' }, patternSchema)).toContainEqual(expect.stringContaining('pattern'));
      expect(registry.validateConfig({ email: 'test@example.com' }, patternSchema)).toHaveLength(0);
    });

    it('should validate NaN as invalid number', () => {
      const errors = registry.validateConfig({ name: 'x', count: NaN }, schema);
      expect(errors.some(e => e.includes('must be a number'))).toBe(true);
    });
  });

  // ─── Hook System ────────────────────────────────────────────

  describe('hooks', () => {
    it('should register a hook', () => {
      createAndEnable(registry);
      registry.registerHook('test:event', 'com.test.plugin', vi.fn());
      expect(registry.getRegisteredHooks()).toContain('test:event');
    });

    it('should require enabled plugin for hook registration', () => {
      registry.register(makePlugin());
      expect(() => registry.registerHook('test', 'com.test.plugin', vi.fn())).toThrow('must be enabled');
    });

    it('should trigger hooks in priority order', async () => {
      createAndEnable(registry, { id: 'p1' });
      createAndEnable(registry, { id: 'p2' });

      const order: string[] = [];
      registry.registerHook('process', 'p2', () => { order.push('p2'); }, 20);
      registry.registerHook('process', 'p1', () => { order.push('p1'); }, 10);

      await registry.triggerHook('process', {});
      expect(order).toEqual(['p1', 'p2']);
    });

    it('should pass data through hook chain', async () => {
      createAndEnable(registry, { id: 'p1' });
      createAndEnable(registry, { id: 'p2' });

      registry.registerHook('transform', 'p1', (data: unknown) => (data as number) + 1, 1);
      registry.registerHook('transform', 'p2', (data: unknown) => (data as number) * 2, 2);

      const result = await registry.triggerHook('transform', 5);
      expect(result).toBe(12); // (5 + 1) * 2
    });

    it('should skip hooks from disabled plugins', async () => {
      createAndEnable(registry, { id: 'p1' });
      const handler = vi.fn();
      registry.registerHook('test', 'p1', handler);
      registry.disable('p1');

      await registry.triggerHook('test', {});
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle hook errors gracefully', async () => {
      createAndEnable(registry);
      registry.registerHook('fail', 'com.test.plugin', () => { throw new Error('boom'); });

      // Should not throw
      const result = await registry.triggerHook('fail', 'data');
      expect(result).toBe('data'); // Original data returned
    });

    it('should report errors on failed hooks', async () => {
      createAndEnable(registry);
      registry.registerHook('fail', 'com.test.plugin', () => { throw new Error('boom'); });
      await registry.triggerHook('fail', {});
      expect(registry.getPlugin('com.test.plugin')!.health.consecutiveFailures).toBe(1);
    });

    it('should return original data if no hooks registered', async () => {
      const result = await registry.triggerHook('nonexistent', 42);
      expect(result).toBe(42);
    });

    it('should emit hook:triggered event', async () => {
      createAndEnable(registry);
      registry.registerHook('evt', 'com.test.plugin', vi.fn());
      const handler = vi.fn();
      registry.on('hook:triggered', handler);
      await registry.triggerHook('evt', {});
      expect(handler).toHaveBeenCalledWith('evt', 1);
    });

    it('should support async hook handlers', async () => {
      createAndEnable(registry);
      registry.registerHook('async', 'com.test.plugin', async (data: unknown) => {
        return (data as number) + 10;
      });
      const result = await registry.triggerHook('async', 5);
      expect(result).toBe(15);
    });
  });

  // ─── Queries ────────────────────────────────────────────────

  describe('queries', () => {
    it('should list all plugins', () => {
      registry.register(makePlugin({ id: 'p1' }));
      registry.register(makePlugin({ id: 'p2' }));
      expect(registry.listPlugins()).toHaveLength(2);
    });

    it('should filter by state', () => {
      createAndEnable(registry, { id: 'enabled1' });
      registry.register(makePlugin({ id: 'registered1' }));
      expect(registry.listPlugins({ state: 'enabled' })).toHaveLength(1);
      expect(registry.listPlugins({ state: 'registered' })).toHaveLength(1);
    });

    it('should filter by category', () => {
      registry.register(makePlugin({ id: 'agent1', category: 'agent' }));
      registry.register(makePlugin({ id: 'export1', category: 'export' }));
      expect(registry.listPlugins({ category: 'agent' })).toHaveLength(1);
    });

    it('should filter by tag', () => {
      registry.register(makePlugin({ id: 'p1', tags: ['retail', 'inventory'] }));
      registry.register(makePlugin({ id: 'p2', tags: ['developer'] }));
      expect(registry.listPlugins({ tag: 'retail' })).toHaveLength(1);
    });

    it('should filter by pricing tier', () => {
      registry.register(makePlugin({ id: 'p1', pricingTier: 'free' }));
      registry.register(makePlugin({ id: 'p2', pricingTier: 'enterprise' }));
      expect(registry.listPlugins({ pricingTier: 'free' })).toHaveLength(1);
    });

    it('should search by name', () => {
      registry.register(makePlugin({ id: 'p1', name: 'Inventory Vision' }));
      registry.register(makePlugin({ id: 'p2', name: 'Debug Helper' }));
      expect(registry.listPlugins({ search: 'inventory' })).toHaveLength(1);
    });

    it('should search by description', () => {
      registry.register(makePlugin({ id: 'p1', description: 'Scan barcodes on shelves' }));
      registry.register(makePlugin({ id: 'p2', description: 'Translate text' }));
      expect(registry.listPlugins({ search: 'barcode' })).toHaveLength(1);
    });

    it('should search by tags', () => {
      registry.register(makePlugin({ id: 'p1', tags: ['barcode-scanner'] }));
      registry.register(makePlugin({ id: 'p2', tags: ['translation'] }));
      expect(registry.listPlugins({ search: 'barcode' })).toHaveLength(1);
    });

    it('should get enabled plugins', () => {
      createAndEnable(registry, { id: 'p1' });
      registry.register(makePlugin({ id: 'p2' }));
      expect(registry.getEnabledPlugins()).toHaveLength(1);
    });

    it('should get enabled plugins by category', () => {
      createAndEnable(registry, { id: 'a1', category: 'agent' });
      createAndEnable(registry, { id: 'e1', category: 'export' });
      expect(registry.getEnabledByCategory('agent')).toHaveLength(1);
    });
  });

  // ─── Dependencies ──────────────────────────────────────────

  describe('dependencies', () => {
    it('should detect missing dependencies', () => {
      const meta = makePlugin({ dependencies: ['dep1', 'dep2'] });
      registry.register(meta);
      expect(registry.checkDependencies(meta)).toEqual(['dep1', 'dep2']);
    });

    it('should detect partially met dependencies', () => {
      createAndEnable(registry, { id: 'dep1' });
      const meta = makePlugin({ id: 'child', dependencies: ['dep1', 'dep2'] });
      registry.register(meta);
      expect(registry.checkDependencies(meta)).toEqual(['dep2']);
    });

    it('should report no missing deps when all satisfied', () => {
      createAndEnable(registry, { id: 'dep1' });
      const meta = makePlugin({ id: 'child', dependencies: ['dep1'] });
      expect(registry.checkDependencies(meta)).toEqual([]);
    });

    it('should detect conflicts', () => {
      createAndEnable(registry, { id: 'existing' });
      const meta = makePlugin({ id: 'new', conflicts: ['existing'] });
      expect(registry.checkConflicts(meta)).toEqual(['existing']);
    });

    it('should not flag non-enabled plugins as conflicts', () => {
      registry.register(makePlugin({ id: 'existing' }));
      const meta = makePlugin({ id: 'new', conflicts: ['existing'] });
      expect(registry.checkConflicts(meta)).toEqual([]);
    });

    it('should find dependents', () => {
      createAndEnable(registry, { id: 'parent' });
      createAndEnable(registry, { id: 'child', dependencies: ['parent'] });
      expect(registry.getDependents('parent')).toEqual(['child']);
    });

    it('should resolve install order', () => {
      registry.register(makePlugin({ id: 'base' }));
      registry.register(makePlugin({ id: 'mid', dependencies: ['base'] }));
      registry.register(makePlugin({ id: 'top', dependencies: ['mid'] }));

      const order = registry.resolveInstallOrder('top');
      expect(order).toEqual(['base', 'mid', 'top']);
    });

    it('should handle circular dependency detection in resolveInstallOrder', () => {
      // Circular deps won't infinite loop because of visited set
      registry.register(makePlugin({ id: 'alpha', dependencies: ['bravo'] }));
      registry.register(makePlugin({ id: 'bravo', dependencies: ['alpha'] }));
      const order = registry.resolveInstallOrder('alpha');
      // Should terminate — order may vary but shouldn't hang
      expect(order.length).toBeGreaterThan(0);
    });
  });

  // ─── Capabilities ──────────────────────────────────────────

  describe('capabilities', () => {
    it('should check capability existence', () => {
      const meta = makePlugin({ capabilities: ['camera:read'] });
      registry.register(meta);
      expect(registry.hasCapability('com.test.plugin', 'camera:read')).toBe(true);
      expect(registry.hasCapability('com.test.plugin', 'network:internet')).toBe(false);
    });

    it('should grant restricted capability explicitly', () => {
      const meta = makePlugin({ capabilities: ['network:internet'] });
      registry.register(meta);
      expect(registry.hasCapability('com.test.plugin', 'network:internet')).toBe(false);
      registry.grantCapability('com.test.plugin', 'network:internet');
      expect(registry.hasCapability('com.test.plugin', 'network:internet')).toBe(true);
    });

    it('should emit capability:granted event', () => {
      const meta = makePlugin({ capabilities: ['network:internet'] });
      registry.register(meta);
      const handler = vi.fn();
      registry.on('capability:granted', handler);
      registry.grantCapability('com.test.plugin', 'network:internet');
      expect(handler).toHaveBeenCalledWith('com.test.plugin', 'network:internet');
    });

    it('should not duplicate already-granted capability', () => {
      const meta = makePlugin({ capabilities: ['camera:read'] });
      registry.register(meta);
      const before = registry.getPlugin('com.test.plugin')!.grantedCapabilities.length;
      registry.grantCapability('com.test.plugin', 'camera:read');
      const after = registry.getPlugin('com.test.plugin')!.grantedCapabilities.length;
      expect(after).toBe(before);
    });

    it('should return false for unknown plugin', () => {
      expect(registry.hasCapability('nonexistent', 'camera:read')).toBe(false);
    });
  });

  // ─── Pricing Tiers ─────────────────────────────────────────

  describe('pricing tiers', () => {
    it('should allow free plugins on free tier', () => {
      const freeReg = new PluginRegistry({ currentPricingTier: 'free' });
      freeReg.register(makePlugin({ pricingTier: 'free' }));
      freeReg.install('com.test.plugin'); // Should not throw
    });

    it('should block solo plugins on free tier', () => {
      const freeReg = new PluginRegistry({ currentPricingTier: 'free' });
      freeReg.register(makePlugin({ pricingTier: 'solo' }));
      expect(() => freeReg.install('com.test.plugin')).toThrow('requires tier');
    });

    it('should allow solo plugins on multi tier', () => {
      const multiReg = new PluginRegistry({ currentPricingTier: 'multi' });
      multiReg.register(makePlugin({ pricingTier: 'solo' }));
      multiReg.install('com.test.plugin'); // Should not throw
    });

    it('should allow enterprise plugins on enterprise tier', () => {
      registry.register(makePlugin({ pricingTier: 'enterprise' }));
      registry.install('com.test.plugin'); // Should not throw
    });

    it('should block enterprise plugins on solo tier', () => {
      const soloReg = new PluginRegistry({ currentPricingTier: 'solo' });
      soloReg.register(makePlugin({ pricingTier: 'enterprise' }));
      expect(() => soloReg.install('com.test.plugin')).toThrow('requires tier');
    });
  });

  // ─── Stats ──────────────────────────────────────────────────

  describe('stats', () => {
    it('should return correct stats', () => {
      createAndEnable(registry, { id: 'p1', category: 'agent' });
      createAndEnable(registry, { id: 'p2', category: 'export' });
      registry.register(makePlugin({ id: 'p3', category: 'agent' }));

      const stats = registry.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byState['enabled']).toBe(2);
      expect(stats.byState['registered']).toBe(1);
      expect(stats.byCategory['agent']).toBe(2);
      expect(stats.byCategory['export']).toBe(1);
      expect(stats.healthyCount).toBe(2);
    });
  });

  // ─── Health Checks ──────────────────────────────────────────

  describe('health checks', () => {
    it('should run health checks on enabled plugins', () => {
      createAndEnable(registry, { id: 'p1' });
      createAndEnable(registry, { id: 'p2' });
      registry.register(makePlugin({ id: 'p3' })); // Not enabled

      const results = registry.runHealthChecks();
      expect(results.size).toBe(2);
      expect(results.get('p1')).toBe(true);
      expect(results.get('p2')).toBe(true);
    });

    it('should mark unhealthy plugins in check', () => {
      createAndEnable(registry);
      const plugin = registry.getPlugin('com.test.plugin')!;
      plugin.health.consecutiveFailures = 10;

      const results = registry.runHealthChecks();
      expect(results.get('com.test.plugin')).toBe(false);
    });

    it('should start and stop health check timer', () => {
      vi.useFakeTimers();
      registry.startHealthChecks();
      registry.startHealthChecks(); // Should not double-start
      registry.stopHealthChecks();
      vi.useRealTimers();
    });

    it('should emit health:check event', () => {
      createAndEnable(registry);
      const handler = vi.fn();
      registry.on('health:check', handler);
      registry.runHealthChecks();
      expect(handler).toHaveBeenCalled();
    });
  });

  // ─── Core Plugins ──────────────────────────────────────────

  describe('core plugins', () => {
    it('should define 11 core plugins', () => {
      const core = PluginRegistry.getCorePlugins();
      expect(core.length).toBe(11);
    });

    it('should have unique IDs for all core plugins', () => {
      const core = PluginRegistry.getCorePlugins();
      const ids = new Set(core.map(p => p.id));
      expect(ids.size).toBe(core.length);
    });

    it('should mark all core plugins as isCore', () => {
      const core = PluginRegistry.getCorePlugins();
      for (const plugin of core) {
        expect(plugin.isCore).toBe(true);
      }
    });

    it('should have valid versions for all core plugins', () => {
      const core = PluginRegistry.getCorePlugins();
      for (const plugin of core) {
        expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
      }
    });

    it('should register all core plugins via convenience method', () => {
      registry.registerCorePlugins();
      expect(registry.size).toBe(11);
    });

    it('should include inventory agent in core plugins', () => {
      const core = PluginRegistry.getCorePlugins();
      const inv = core.find(p => p.id === 'com.openclaw.inventory');
      expect(inv).toBeTruthy();
      expect(inv!.pricingTier).toBe('solo');
      expect(inv!.dependencies).toContain('com.openclaw.memory');
    });

    it('should include chains engine requiring multi tier', () => {
      const core = PluginRegistry.getCorePlugins();
      const chains = core.find(p => p.id === 'com.openclaw.chains');
      expect(chains).toBeTruthy();
      expect(chains!.pricingTier).toBe('multi');
    });
  });

  // ─── State Export ──────────────────────────────────────────

  describe('state export', () => {
    it('should export registry state', () => {
      createAndEnable(registry, { id: 'p1' });
      registry.setConfig('p1', { mode: 'turbo' });
      const state = registry.exportState();

      expect(state.plugins).toHaveLength(1);
      expect(state.plugins[0].id).toBe('p1');
      expect(state.plugins[0].state).toBe('enabled');
      expect(state.plugins[0].config.mode).toBe('turbo');
    });

    it('should export multiple plugins', () => {
      createAndEnable(registry, { id: 'p1' });
      registry.register(makePlugin({ id: 'p2' }));
      const state = registry.exportState();
      expect(state.plugins).toHaveLength(2);
    });
  });
});
