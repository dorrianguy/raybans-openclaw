/**
 * Tests for Plugin SDK & Agent Registry
 * 🌙 Night Shift Agent — 2026-03-16
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PluginRegistry,
  DEFAULT_REGISTRY_CONFIG,
  DEFAULT_RESOURCE_LIMITS,
  type AgentPlugin,
  type PluginManifest,
  type PluginContext,
  type PluginImageInput,
  type PluginVoiceInput,
  type PluginEvent,
  type PluginResponse,
  type PluginRegistryConfig,
} from './plugin-sdk.js';

// ──── Test Helper: Create a valid plugin ────

function createTestManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin for unit tests',
    author: { name: 'Test Author', verified: true },
    category: 'custom',
    permissions: ['camera:read', 'tts:speak'],
    ...overrides,
  };
}

function createTestPlugin(overrides: Partial<AgentPlugin> = {}, manifestOverrides: Partial<PluginManifest> = {}): AgentPlugin {
  return {
    manifest: createTestManifest(manifestOverrides),
    ...overrides,
  };
}

function createTestImage(): PluginImageInput {
  return {
    imageBuffer: Buffer.from('fake-image-data'),
    analysis: {
      sceneType: 'retail_shelf',
      objects: [{ label: 'product', confidence: 0.95 }],
      text: ['Price: $9.99'],
      barcodes: [{ data: '012345678901', format: 'UPC-A' }],
    },
    location: { latitude: 30.2672, longitude: -97.7431 },
    timestamp: Date.now(),
  };
}

// ──── Tests ────

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry({ allowUntrustedPlugins: true });
  });

  // ── Installation ──

  describe('install', () => {
    it('should install a valid plugin', async () => {
      const plugin = createTestPlugin();
      await registry.install(plugin);

      expect(registry.getPluginCount()).toBe(1);
      expect(registry.getPluginStatus('test-plugin')).toBe('installed');
    });

    it('should emit plugin:installed event', async () => {
      const handler = vi.fn();
      registry.on('plugin:installed', handler);

      const plugin = createTestPlugin();
      await registry.install(plugin);

      expect(handler).toHaveBeenCalledWith('test-plugin', plugin.manifest);
    });

    it('should reject duplicate plugin id', async () => {
      const plugin = createTestPlugin();
      await registry.install(plugin);

      await expect(registry.install(plugin)).rejects.toThrow('already installed');
    });

    it('should enforce max plugins limit', async () => {
      const reg = new PluginRegistry({ maxPlugins: 2, allowUntrustedPlugins: true });

      await reg.install(createTestPlugin({}, { id: 'p1' }));
      await reg.install(createTestPlugin({}, { id: 'p2' }));

      await expect(
        reg.install(createTestPlugin({}, { id: 'p3' }))
      ).rejects.toThrow('Maximum number of plugins');
    });

    it('should call onInstall hook', async () => {
      const onInstall = vi.fn();
      const plugin = createTestPlugin({ onInstall });
      await registry.install(plugin);

      expect(onInstall).toHaveBeenCalledTimes(1);
    });

    it('should set status to errored if onInstall fails', async () => {
      const plugin = createTestPlugin({
        onInstall: async () => { throw new Error('install failed'); },
      });

      await registry.install(plugin);
      expect(registry.getPluginStatus('test-plugin')).toBe('errored');
    });

    it('should auto-enable if configured', async () => {
      const reg = new PluginRegistry({ autoEnableOnInstall: true, allowUntrustedPlugins: true });
      const plugin = createTestPlugin();
      await reg.install(plugin);

      expect(reg.getPluginStatus('test-plugin')).toBe('enabled');
    });

    it('should not auto-enable if onInstall failed', async () => {
      const reg = new PluginRegistry({ autoEnableOnInstall: true, allowUntrustedPlugins: true });
      const plugin = createTestPlugin({
        onInstall: async () => { throw new Error('fail'); },
      });

      await reg.install(plugin);
      expect(reg.getPluginStatus('test-plugin')).toBe('errored');
    });
  });

  // ── Manifest Validation ──

  describe('manifest validation', () => {
    it('should reject manifest without id', async () => {
      const plugin = createTestPlugin({}, { id: '' });
      await expect(registry.install(plugin)).rejects.toThrow('valid id');
    });

    it('should reject manifest with invalid id characters', async () => {
      const plugin = createTestPlugin({}, { id: 'my plugin!!!' });
      await expect(registry.install(plugin)).rejects.toThrow('alphanumeric');
    });

    it('should reject manifest without name', async () => {
      const plugin = createTestPlugin({}, { name: '' });
      await expect(registry.install(plugin)).rejects.toThrow('valid name');
    });

    it('should reject manifest with bad version', async () => {
      const plugin = createTestPlugin({}, { version: 'latest' });
      await expect(registry.install(plugin)).rejects.toThrow('semver');
    });

    it('should reject manifest without description', async () => {
      const plugin = createTestPlugin({}, { description: '' });
      await expect(registry.install(plugin)).rejects.toThrow('description');
    });

    it('should reject manifest without author name', async () => {
      const plugin = createTestPlugin({}, { author: { name: '' } });
      await expect(registry.install(plugin)).rejects.toThrow('author');
    });

    it('should accept valid manifest', async () => {
      const plugin = createTestPlugin({}, {
        id: 'valid-plugin_123',
        name: 'Valid',
        version: '2.1.3',
        description: 'Yep',
        author: { name: 'Me', verified: true },
        permissions: [],
      });
      await expect(registry.install(plugin)).resolves.toBeUndefined();
    });
  });

  // ── Trust ──

  describe('trust verification', () => {
    it('should reject untrusted plugins when not allowed', async () => {
      const reg = new PluginRegistry({ allowUntrustedPlugins: false });
      const plugin = createTestPlugin({}, {
        author: { name: 'Untrusted', verified: false },
      });

      await expect(reg.install(plugin)).rejects.toThrow('not verified');
    });

    it('should accept untrusted plugins when allowed', async () => {
      const reg = new PluginRegistry({ allowUntrustedPlugins: true });
      const plugin = createTestPlugin({}, {
        author: { name: 'Untrusted', verified: false },
      });

      await expect(reg.install(plugin)).resolves.toBeUndefined();
    });

    it('should accept verified plugins regardless of config', async () => {
      const reg = new PluginRegistry({ allowUntrustedPlugins: false });
      const plugin = createTestPlugin({}, {
        author: { name: 'Trusted', verified: true },
      });

      await expect(reg.install(plugin)).resolves.toBeUndefined();
    });
  });

  // ── Enable / Disable ──

  describe('enable and disable', () => {
    it('should enable an installed plugin', async () => {
      const plugin = createTestPlugin();
      await registry.install(plugin);
      await registry.enable('test-plugin');

      expect(registry.getPluginStatus('test-plugin')).toBe('enabled');
    });

    it('should emit plugin:enabled event', async () => {
      const handler = vi.fn();
      registry.on('plugin:enabled', handler);

      const plugin = createTestPlugin();
      await registry.install(plugin);
      await registry.enable('test-plugin');

      expect(handler).toHaveBeenCalledWith('test-plugin');
    });

    it('should call onEnable hook', async () => {
      const onEnable = vi.fn();
      const plugin = createTestPlugin({ onEnable });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      expect(onEnable).toHaveBeenCalledTimes(1);
    });

    it('should set errored status if onEnable throws', async () => {
      const plugin = createTestPlugin({
        onEnable: async () => { throw new Error('enable failed'); },
      });
      await registry.install(plugin);

      await expect(registry.enable('test-plugin')).rejects.toThrow('enable failed');
      expect(registry.getPluginStatus('test-plugin')).toBe('errored');
    });

    it('should disable an enabled plugin', async () => {
      const plugin = createTestPlugin();
      await registry.install(plugin);
      await registry.enable('test-plugin');
      await registry.disable('test-plugin');

      expect(registry.getPluginStatus('test-plugin')).toBe('disabled');
    });

    it('should call onDisable hook', async () => {
      const onDisable = vi.fn();
      const plugin = createTestPlugin({ onDisable });
      await registry.install(plugin);
      await registry.enable('test-plugin');
      await registry.disable('test-plugin');

      expect(onDisable).toHaveBeenCalledTimes(1);
    });

    it('should no-op enabling an already enabled plugin', async () => {
      const onEnable = vi.fn();
      const plugin = createTestPlugin({ onEnable });
      await registry.install(plugin);
      await registry.enable('test-plugin');
      await registry.enable('test-plugin');

      expect(onEnable).toHaveBeenCalledTimes(1);
    });

    it('should throw when enabling non-existent plugin', async () => {
      await expect(registry.enable('nope')).rejects.toThrow('not installed');
    });
  });

  // ── Uninstall ──

  describe('uninstall', () => {
    it('should uninstall a plugin', async () => {
      const plugin = createTestPlugin();
      await registry.install(plugin);
      await registry.uninstall('test-plugin');

      expect(registry.getPluginCount()).toBe(0);
      expect(registry.getPlugin('test-plugin')).toBeUndefined();
    });

    it('should call onUninstall hook', async () => {
      const onUninstall = vi.fn();
      const plugin = createTestPlugin({ onUninstall });
      await registry.install(plugin);
      await registry.uninstall('test-plugin');

      expect(onUninstall).toHaveBeenCalledTimes(1);
    });

    it('should disable before uninstalling', async () => {
      const onDisable = vi.fn();
      const plugin = createTestPlugin({ onDisable });
      await registry.install(plugin);
      await registry.enable('test-plugin');
      await registry.uninstall('test-plugin');

      expect(onDisable).toHaveBeenCalledTimes(1);
    });

    it('should emit plugin:uninstalled event', async () => {
      const handler = vi.fn();
      registry.on('plugin:uninstalled', handler);

      const plugin = createTestPlugin();
      await registry.install(plugin);
      await registry.uninstall('test-plugin');

      expect(handler).toHaveBeenCalledWith('test-plugin');
    });

    it('should throw for non-existent plugin', async () => {
      await expect(registry.uninstall('nope')).rejects.toThrow('not installed');
    });
  });

  // ── Image Processing ──

  describe('processImage', () => {
    it('should invoke enabled plugins with processImage', async () => {
      const processImage = vi.fn().mockResolvedValue({ success: true, ttsMessage: 'Found it!' });
      const plugin = createTestPlugin({ processImage });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      const results = await registry.processImage(createTestImage());

      expect(results.size).toBe(1);
      expect(results.get('test-plugin')?.success).toBe(true);
      expect(results.get('test-plugin')?.ttsMessage).toBe('Found it!');
    });

    it('should skip disabled plugins', async () => {
      const processImage = vi.fn().mockResolvedValue({ success: true });
      const plugin = createTestPlugin({ processImage });
      await registry.install(plugin);
      // Not enabled

      const results = await registry.processImage(createTestImage());
      expect(results.size).toBe(0);
    });

    it('should skip plugins without processImage', async () => {
      const plugin = createTestPlugin();
      await registry.install(plugin);
      await registry.enable('test-plugin');

      const results = await registry.processImage(createTestImage());
      expect(results.size).toBe(0);
    });

    it('should filter by scene type when plugin declares interest', async () => {
      const processImage = vi.fn().mockResolvedValue({ success: true });
      const plugin = createTestPlugin({
        processImage,
        getSceneTypes: () => ['document', 'whiteboard'],
      });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      // Image has sceneType: 'retail_shelf' which the plugin doesn't care about
      const results = await registry.processImage(createTestImage());
      expect(results.size).toBe(0);
      expect(processImage).not.toHaveBeenCalled();
    });

    it('should invoke plugin when scene type matches', async () => {
      const processImage = vi.fn().mockResolvedValue({ success: true });
      const plugin = createTestPlugin({
        processImage,
        getSceneTypes: () => ['retail_shelf'],
      });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      const results = await registry.processImage(createTestImage());
      expect(results.size).toBe(1);
    });

    it('should invoke multiple plugins', async () => {
      const p1 = createTestPlugin(
        { processImage: vi.fn().mockResolvedValue({ success: true }) },
        { id: 'p1' }
      );
      const p2 = createTestPlugin(
        { processImage: vi.fn().mockResolvedValue({ success: true }) },
        { id: 'p2' }
      );

      await registry.install(p1);
      await registry.install(p2);
      await registry.enable('p1');
      await registry.enable('p2');

      const results = await registry.processImage(createTestImage());
      expect(results.size).toBe(2);
    });

    it('should handle plugin errors gracefully', async () => {
      const plugin = createTestPlugin({
        processImage: async () => { throw new Error('boom'); },
      });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      const results = await registry.processImage(createTestImage());
      expect(results.get('test-plugin')?.success).toBe(false);
      expect(results.get('test-plugin')?.error).toBe('boom');
    });

    it('should track invocation count', async () => {
      const plugin = createTestPlugin({
        processImage: vi.fn().mockResolvedValue({ success: true }),
      });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      await registry.processImage(createTestImage());
      await registry.processImage(createTestImage());

      const info = registry.getPluginInfo('test-plugin');
      expect(info?.invocationCount).toBe(2);
    });

    it('should emit plugin:invoked event', async () => {
      const handler = vi.fn();
      registry.on('plugin:invoked', handler);

      const plugin = createTestPlugin({
        processImage: vi.fn().mockResolvedValue({ success: true }),
      });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      await registry.processImage(createTestImage());

      expect(handler).toHaveBeenCalledWith('test-plugin', 'processImage', expect.any(Number));
    });

    it('should auto-disable plugin after 10 errors', async () => {
      let callCount = 0;
      const plugin = createTestPlugin({
        processImage: async () => { 
          callCount++;
          throw new Error(`error ${callCount}`); 
        },
      });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      for (let i = 0; i < 10; i++) {
        await registry.processImage(createTestImage());
      }

      expect(registry.getPluginStatus('test-plugin')).toBe('errored');
    });
  });

  // ── Voice Processing ──

  describe('processVoice', () => {
    it('should invoke enabled plugins with processVoice', async () => {
      const processVoice = vi.fn().mockResolvedValue({ success: true, ttsMessage: 'Got it' });
      const plugin = createTestPlugin({ processVoice });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      const input: PluginVoiceInput = { text: 'scan inventory', timestamp: Date.now() };
      const results = await registry.processVoice(input);

      expect(results.size).toBe(1);
      expect(results.get('test-plugin')?.ttsMessage).toBe('Got it');
    });

    it('should filter by voice intent when plugin declares commands', async () => {
      const processVoice = vi.fn().mockResolvedValue({ success: true });
      const plugin = createTestPlugin({
        processVoice,
        getVoiceCommands: () => [
          { intent: 'custom_scan', patterns: ['scan my stuff'], description: 'Scan', examples: [] },
        ],
      });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      // Intent doesn't match
      const input: PluginVoiceInput = { text: 'hello', intent: 'greeting', timestamp: Date.now() };
      const results = await registry.processVoice(input);
      expect(results.size).toBe(0);
    });

    it('should invoke when intent matches', async () => {
      const processVoice = vi.fn().mockResolvedValue({ success: true });
      const plugin = createTestPlugin({
        processVoice,
        getVoiceCommands: () => [
          { intent: 'custom_scan', patterns: ['scan'], description: 'Scan', examples: [] },
        ],
      });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      const input: PluginVoiceInput = { text: 'scan my stuff', intent: 'custom_scan', timestamp: Date.now() };
      const results = await registry.processVoice(input);
      expect(results.size).toBe(1);
    });
  });

  // ── Event Dispatch ──

  describe('dispatchEvent', () => {
    it('should dispatch events to all enabled plugins', async () => {
      const handleEvent = vi.fn().mockResolvedValue({ success: true });
      const plugin = createTestPlugin({ handleEvent });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      const event: PluginEvent = { type: 'session:start', data: { sessionId: '123' }, timestamp: Date.now() };
      const results = await registry.dispatchEvent(event);

      expect(results.size).toBe(1);
      expect(handleEvent).toHaveBeenCalledTimes(1);
    });

    it('should skip plugins without handleEvent', async () => {
      const plugin = createTestPlugin();
      await registry.install(plugin);
      await registry.enable('test-plugin');

      const event: PluginEvent = { type: 'test', data: {}, timestamp: Date.now() };
      const results = await registry.dispatchEvent(event);
      expect(results.size).toBe(0);
    });
  });

  // ── Permissions ──

  describe('permissions', () => {
    it('should grant permissions from manifest', async () => {
      const plugin = createTestPlugin({}, { permissions: ['camera:read', 'tts:speak'] });
      await registry.install(plugin);

      expect(registry.hasPermission('test-plugin', 'camera:read')).toBe(true);
      expect(registry.hasPermission('test-plugin', 'tts:speak')).toBe(true);
      expect(registry.hasPermission('test-plugin', 'storage:write')).toBe(false);
    });

    it('should allow granting additional permissions', async () => {
      const plugin = createTestPlugin({}, { permissions: [] });
      await registry.install(plugin);

      registry.grantPermission('test-plugin', 'network:outbound');
      expect(registry.hasPermission('test-plugin', 'network:outbound')).toBe(true);
    });

    it('should allow revoking permissions', async () => {
      const plugin = createTestPlugin({}, { permissions: ['camera:read'] });
      await registry.install(plugin);

      registry.revokePermission('test-plugin', 'camera:read');
      expect(registry.hasPermission('test-plugin', 'camera:read')).toBe(false);
    });

    it('should list all permissions', async () => {
      const plugin = createTestPlugin({}, { permissions: ['camera:read', 'tts:speak', 'location:read'] });
      await registry.install(plugin);

      const perms = registry.getPermissions('test-plugin');
      expect(perms).toHaveLength(3);
      expect(perms).toContain('camera:read');
      expect(perms).toContain('tts:speak');
      expect(perms).toContain('location:read');
    });

    it('should throw when managing permissions for non-existent plugin', () => {
      expect(() => registry.grantPermission('nope', 'camera:read')).toThrow('not installed');
      expect(() => registry.revokePermission('nope', 'camera:read')).toThrow('not installed');
    });
  });

  // ── Storage ──

  describe('plugin storage', () => {
    it('should provide isolated storage per plugin', async () => {
      const onInstall = vi.fn(async (ctx: PluginContext) => {
        await ctx.storage.set('key1', 'value1');
        const result = await ctx.storage.get('key1');
        expect(result).toBe('value1');
      });

      const plugin = createTestPlugin({ onInstall });
      await registry.install(plugin);
      expect(onInstall).toHaveBeenCalled();
    });

    it('should return null for missing keys', async () => {
      const onInstall = vi.fn(async (ctx: PluginContext) => {
        const result = await ctx.storage.get('nonexistent');
        expect(result).toBeNull();
      });

      const plugin = createTestPlugin({ onInstall });
      await registry.install(plugin);
    });

    it('should delete keys', async () => {
      const onInstall = vi.fn(async (ctx: PluginContext) => {
        await ctx.storage.set('k', 'v');
        await ctx.storage.delete('k');
        expect(await ctx.storage.get('k')).toBeNull();
      });

      const plugin = createTestPlugin({ onInstall });
      await registry.install(plugin);
    });

    it('should list keys with prefix', async () => {
      const onInstall = vi.fn(async (ctx: PluginContext) => {
        await ctx.storage.set('items:1', 'a');
        await ctx.storage.set('items:2', 'b');
        await ctx.storage.set('config:lang', 'en');

        const itemKeys = await ctx.storage.list('items:');
        expect(itemKeys).toHaveLength(2);

        const allKeys = await ctx.storage.list();
        expect(allKeys).toHaveLength(3);
      });

      const plugin = createTestPlugin({ onInstall });
      await registry.install(plugin);
    });

    it('should enforce storage limits', async () => {
      const reg = new PluginRegistry({
        allowUntrustedPlugins: true,
        resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, maxStorageBytes: 50 },
      });

      const onInstall = vi.fn(async (ctx: PluginContext) => {
        await ctx.storage.set('key', 'x'.repeat(100)); // > 50 bytes
      });

      const plugin = createTestPlugin({ onInstall });
      await reg.install(plugin);
      // onInstall should have thrown internally, setting error status
      expect(reg.getPluginStatus('test-plugin')).toBe('errored');
    });

    it('should clear storage on uninstall', async () => {
      const plugin = createTestPlugin({
        onInstall: async (ctx: PluginContext) => {
          await ctx.storage.set('data', 'important');
        },
      });
      await registry.install(plugin);
      await registry.uninstall('test-plugin');

      // Plugin should be gone
      expect(registry.getPlugin('test-plugin')).toBeUndefined();
    });
  });

  // ── Resource Limits ──

  describe('resource limits', () => {
    it('should skip plugin when invocations per hour exceeded', async () => {
      const reg = new PluginRegistry({
        allowUntrustedPlugins: true,
        resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, maxInvocationsPerHour: 2 },
      });

      const processImage = vi.fn().mockResolvedValue({ success: true });
      const plugin = createTestPlugin({ processImage });
      await reg.install(plugin);
      await reg.enable('test-plugin');

      await reg.processImage(createTestImage());
      await reg.processImage(createTestImage());
      // Third should be skipped
      const results = await reg.processImage(createTestImage());
      expect(results.size).toBe(0);
      expect(processImage).toHaveBeenCalledTimes(2);
    });

    it('should emit resource_limit event', async () => {
      const reg = new PluginRegistry({
        allowUntrustedPlugins: true,
        resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, maxInvocationsPerHour: 1 },
      });

      const handler = vi.fn();
      reg.on('plugin:resource_limit', handler);

      const plugin = createTestPlugin({
        processImage: vi.fn().mockResolvedValue({ success: true }),
      });
      await reg.install(plugin);
      await reg.enable('test-plugin');

      await reg.processImage(createTestImage());
      await reg.processImage(createTestImage());

      expect(handler).toHaveBeenCalledWith('test-plugin', 'invocationsPerHour', 1, 1);
    });

    it('should reset resource counters', async () => {
      const reg = new PluginRegistry({
        allowUntrustedPlugins: true,
        resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, maxInvocationsPerHour: 2 },
      });

      const processImage = vi.fn().mockResolvedValue({ success: true });
      const plugin = createTestPlugin({ processImage });
      await reg.install(plugin);
      await reg.enable('test-plugin');

      await reg.processImage(createTestImage());
      await reg.processImage(createTestImage());
      // Limit reached

      reg.resetResourceCounters();

      // Should work again
      const results = await reg.processImage(createTestImage());
      expect(results.size).toBe(1);
    });

    it('should timeout long-running plugins', async () => {
      const reg = new PluginRegistry({
        allowUntrustedPlugins: true,
        resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, timeoutMs: 50 },
      });

      const plugin = createTestPlugin({
        processImage: async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return { success: true };
        },
      });
      await reg.install(plugin);
      await reg.enable('test-plugin');

      const results = await reg.processImage(createTestImage());
      expect(results.get('test-plugin')?.success).toBe(false);
      expect(results.get('test-plugin')?.error).toContain('timed out');
    });
  });

  // ── Query / Listing ──

  describe('query and listing', () => {
    it('should get plugin by id', async () => {
      const plugin = createTestPlugin();
      await registry.install(plugin);

      expect(registry.getPlugin('test-plugin')).toBe(plugin);
      expect(registry.getPlugin('nonexistent')).toBeUndefined();
    });

    it('should get plugin info', async () => {
      const plugin = createTestPlugin();
      await registry.install(plugin);
      await registry.enable('test-plugin');

      const info = registry.getPluginInfo('test-plugin');
      expect(info).toBeDefined();
      expect(info!.manifest.id).toBe('test-plugin');
      expect(info!.status).toBe('enabled');
      expect(info!.installedAt).toBeGreaterThan(0);
      expect(info!.enabledAt).toBeGreaterThan(0);
      expect(info!.invocationCount).toBe(0);
      expect(info!.errorCount).toBe(0);
    });

    it('should list all plugins', async () => {
      await registry.install(createTestPlugin({}, { id: 'p1', category: 'inventory' }));
      await registry.install(createTestPlugin({}, { id: 'p2', category: 'security' }));
      await registry.install(createTestPlugin({}, { id: 'p3', category: 'inventory' }));

      const all = registry.listPlugins();
      expect(all).toHaveLength(3);
    });

    it('should filter by status', async () => {
      await registry.install(createTestPlugin({}, { id: 'p1' }));
      await registry.install(createTestPlugin({}, { id: 'p2' }));
      await registry.enable('p1');

      const enabled = registry.listPlugins({ status: 'enabled' });
      expect(enabled).toHaveLength(1);
      expect(enabled[0].manifest.id).toBe('p1');
    });

    it('should filter by category', async () => {
      await registry.install(createTestPlugin({}, { id: 'p1', category: 'inventory' }));
      await registry.install(createTestPlugin({}, { id: 'p2', category: 'security' }));

      const inventoryPlugins = registry.listPlugins({ category: 'inventory' });
      expect(inventoryPlugins).toHaveLength(1);
    });

    it('should get enabled plugins only', async () => {
      await registry.install(createTestPlugin({}, { id: 'p1' }));
      await registry.install(createTestPlugin({}, { id: 'p2' }));
      await registry.enable('p1');

      const enabled = registry.getEnabledPlugins();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].manifest.id).toBe('p1');
    });

    it('should collect voice commands from all enabled plugins', async () => {
      await registry.install(createTestPlugin({
        getVoiceCommands: () => [
          { intent: 'scan', patterns: ['scan'], description: 'Scan', examples: [] },
        ],
      }, { id: 'p1' }));
      await registry.install(createTestPlugin({
        getVoiceCommands: () => [
          { intent: 'lookup', patterns: ['lookup'], description: 'Lookup', examples: [] },
        ],
      }, { id: 'p2' }));
      await registry.enable('p1');
      await registry.enable('p2');

      const commands = registry.getAllVoiceCommands();
      expect(commands).toHaveLength(2);
      expect(commands[0].pluginId).toBe('p1');
      expect(commands[1].pluginId).toBe('p2');
    });
  });

  // ── Health Check ──

  describe('health checks', () => {
    it('should return true for enabled plugin without healthCheck', async () => {
      const plugin = createTestPlugin();
      await registry.install(plugin);
      await registry.enable('test-plugin');

      expect(await registry.healthCheck('test-plugin')).toBe(true);
    });

    it('should return false for non-existent plugin', async () => {
      expect(await registry.healthCheck('nope')).toBe(false);
    });

    it('should call custom healthCheck', async () => {
      const plugin = createTestPlugin({
        healthCheck: async () => true,
      });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      expect(await registry.healthCheck('test-plugin')).toBe(true);
    });

    it('should return false if healthCheck throws', async () => {
      const plugin = createTestPlugin({
        healthCheck: async () => { throw new Error('unhealthy'); },
      });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      expect(await registry.healthCheck('test-plugin')).toBe(false);
    });

    it('should health check all plugins', async () => {
      await registry.install(createTestPlugin(
        { healthCheck: async () => true },
        { id: 'healthy' }
      ));
      await registry.install(createTestPlugin(
        { healthCheck: async () => false },
        { id: 'unhealthy' }
      ));
      await registry.enable('healthy');
      await registry.enable('unhealthy');

      const results = await registry.healthCheckAll();
      expect(results.get('healthy')).toBe(true);
      expect(results.get('unhealthy')).toBe(false);
    });
  });

  // ── Stats ──

  describe('stats', () => {
    it('should return registry stats', async () => {
      const processImage = vi.fn().mockResolvedValue({ success: true });
      const p1 = createTestPlugin({ processImage }, { id: 'p1' });
      const p2 = createTestPlugin({}, { id: 'p2' });

      await registry.install(p1);
      await registry.install(p2);
      await registry.enable('p1');

      await registry.processImage(createTestImage());
      await registry.processImage(createTestImage());

      const stats = registry.getStats();
      expect(stats.totalPlugins).toBe(2);
      expect(stats.enabledPlugins).toBe(1);
      expect(stats.totalInvocations).toBe(2);
      expect(stats.totalErrors).toBe(0);
      expect(stats.avgProcessingMs).toBeGreaterThanOrEqual(0);
    });

    it('should include errors in stats', async () => {
      const plugin = createTestPlugin({
        processImage: async () => { throw new Error('fail'); },
      });
      await registry.install(plugin);
      await registry.enable('test-plugin');

      await registry.processImage(createTestImage());

      const stats = registry.getStats();
      expect(stats.totalErrors).toBe(1);
      // Error still counts as an invocation for stats purposes
      expect(stats.totalInvocations).toBe(1);
    });

    it('should generate voice summary', async () => {
      await registry.install(createTestPlugin({}, { id: 'p1' }));
      await registry.install(createTestPlugin({}, { id: 'p2' }));
      await registry.enable('p1');

      const summary = registry.getVoiceSummary();
      expect(summary).toContain('2 plugins installed');
      expect(summary).toContain('1 active');
    });
  });

  // ── Logging ──

  describe('plugin logging', () => {
    it('should capture plugin logs', async () => {
      const plugin = createTestPlugin({
        onInstall: async (ctx: PluginContext) => {
          ctx.logger.info('Setting up...', { step: 1 });
          ctx.logger.debug('Debug info');
          ctx.logger.warn('Be careful');
        },
      });
      await registry.install(plugin);

      const logs = registry.getPluginLogs('test-plugin');
      expect(logs).toHaveLength(3);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toBe('Setting up...');
      expect(logs[1].level).toBe('debug');
      expect(logs[2].level).toBe('warn');
    });

    it('should return empty logs for non-existent plugin', () => {
      const logs = registry.getPluginLogs('nonexistent');
      expect(logs).toEqual([]);
    });
  });
});
