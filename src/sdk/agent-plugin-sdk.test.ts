/**
 * Tests for Agent Plugin SDK
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PluginRegistry,
  PluginManifest,
  PluginHandler,
  PluginResponse,
  DEFAULT_REGISTRY_CONFIG,
  PERMISSION_DESCRIPTIONS,
  validateManifest,
} from './agent-plugin-sdk.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'com.test.my-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin for unit testing',
    author: { name: 'Test Author', email: 'test@example.com' },
    category: 'inventory',
    permissions: ['camera', 'tts', 'storage'],
    sdkVersion: '1.0.0',
    entryPoint: './index.js',
    ...overrides,
  };
}

function makeHandler(overrides: Partial<PluginHandler> = {}): PluginHandler {
  return {
    onEnable: vi.fn().mockResolvedValue(undefined),
    onDisable: vi.fn().mockResolvedValue(undefined),
    onFrame: vi.fn().mockResolvedValue({ ttsText: 'Processed frame' }),
    onVoiceCommand: vi.fn().mockResolvedValue({ ttsText: 'Command handled' }),
    ...overrides,
  };
}

// ─── Manifest Validation ─────────────────────────────────────────────────────

describe('validateManifest', () => {
  it('validates a correct manifest', () => {
    const result = validateManifest(makeManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing ID', () => {
    const result = validateManifest(makeManifest({ id: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ID'))).toBe(true);
  });

  it('rejects invalid ID format', () => {
    const result = validateManifest(makeManifest({ id: 'BadFormat' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('reverse domain'))).toBe(true);
  });

  it('rejects missing name', () => {
    const result = validateManifest(makeManifest({ name: '' }));
    expect(result.valid).toBe(false);
  });

  it('warns on long names', () => {
    const result = validateManifest(makeManifest({ name: 'A'.repeat(51) }));
    expect(result.warnings.some(w => w.includes('50 characters'))).toBe(true);
  });

  it('rejects invalid version', () => {
    const result = validateManifest(makeManifest({ version: 'bad' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('semver'))).toBe(true);
  });

  it('rejects missing description', () => {
    const result = validateManifest(makeManifest({ description: '' }));
    expect(result.valid).toBe(false);
  });

  it('rejects missing author', () => {
    const result = validateManifest(makeManifest({ author: { name: '' } }));
    expect(result.valid).toBe(false);
  });

  it('rejects missing category', () => {
    const result = validateManifest(makeManifest({ category: '' as any }));
    expect(result.valid).toBe(false);
  });

  it('rejects missing SDK version', () => {
    const result = validateManifest(makeManifest({ sdkVersion: '' }));
    expect(result.valid).toBe(false);
  });

  it('rejects missing entry point', () => {
    const result = validateManifest(makeManifest({ entryPoint: '' }));
    expect(result.valid).toBe(false);
  });

  it('rejects unknown permissions', () => {
    const result = validateManifest(makeManifest({
      permissions: ['camera', 'unknown_perm' as any],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unknown permission'))).toBe(true);
  });

  it('warns on many high-risk permissions', () => {
    const result = validateManifest(makeManifest({
      permissions: ['camera', 'microphone', 'contacts', 'memory'],
    }));
    expect(result.warnings.some(w => w.includes('high-risk'))).toBe(true);
  });

  it('rejects paid plugin without price', () => {
    const result = validateManifest(makeManifest({
      pricing: { model: 'paid', price: 0 },
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('price'))).toBe(true);
  });

  it('rejects subscription without interval', () => {
    const result = validateManifest(makeManifest({
      pricing: { model: 'subscription', price: 999 },
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('interval'))).toBe(true);
  });

  it('validates correct pricing', () => {
    const result = validateManifest(makeManifest({
      pricing: { model: 'subscription', price: 999, interval: 'month' },
    }));
    expect(result.valid).toBe(true);
  });

  it('validates free pricing', () => {
    const result = validateManifest(makeManifest({
      pricing: { model: 'free' },
    }));
    expect(result.valid).toBe(true);
  });

  it('rejects invalid revenue share', () => {
    const result = validateManifest(makeManifest({
      pricing: { model: 'paid', price: 999, revenueShare: 150 },
    }));
    expect(result.valid).toBe(false);
  });

  it('validates voice commands', () => {
    const result = validateManifest(makeManifest({
      voiceCommands: [
        { phrase: 'scan inventory', description: 'Scan the shelf' },
      ],
    }));
    expect(result.valid).toBe(true);
  });

  it('rejects voice command without phrase', () => {
    const result = validateManifest(makeManifest({
      voiceCommands: [{ phrase: '', description: 'test' }],
    }));
    expect(result.valid).toBe(false);
  });
});

// ─── Permission Descriptions ─────────────────────────────────────────────────

describe('PERMISSION_DESCRIPTIONS', () => {
  it('has all 15 permissions defined', () => {
    expect(Object.keys(PERMISSION_DESCRIPTIONS).length).toBe(15);
  });

  it('each permission has label, description, and risk', () => {
    for (const [_, desc] of Object.entries(PERMISSION_DESCRIPTIONS)) {
      expect(desc.label).toBeTruthy();
      expect(desc.description).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(desc.risk);
    }
  });

  it('camera is high risk', () => {
    expect(PERMISSION_DESCRIPTIONS.camera.risk).toBe('high');
  });

  it('storage is low risk', () => {
    expect(PERMISSION_DESCRIPTIONS.storage.risk).toBe('low');
  });

  it('tts is low risk', () => {
    expect(PERMISSION_DESCRIPTIONS.tts.risk).toBe('low');
  });
});

// ─── Plugin Registry ─────────────────────────────────────────────────────────

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  // ─── Installation ──────────────────────────────────────────────

  describe('Installation', () => {
    it('installs a valid plugin', () => {
      const result = registry.install(makeManifest(), makeHandler());
      expect(result.valid).toBe(true);
      expect(registry.getPluginCount()).toBe(1);
    });

    it('rejects invalid manifest', () => {
      const result = registry.install(makeManifest({ id: '' }), makeHandler());
      expect(result.valid).toBe(false);
      expect(registry.getPluginCount()).toBe(0);
    });

    it('rejects duplicate installation', () => {
      registry.install(makeManifest(), makeHandler());
      const result = registry.install(makeManifest(), makeHandler());
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('already installed'))).toBe(true);
    });

    it('respects max plugins limit', () => {
      const smallRegistry = new PluginRegistry({ maxPlugins: 2 });
      smallRegistry.install(makeManifest({ id: 'com.test.plugin-1' }), makeHandler());
      smallRegistry.install(makeManifest({ id: 'com.test.plugin-2' }), makeHandler());
      const result = smallRegistry.install(makeManifest({ id: 'com.test.plugin-3' }), makeHandler());
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Maximum'))).toBe(true);
    });

    it('emits plugin:installed event', () => {
      const fn = vi.fn();
      registry.on('plugin:installed', fn);
      registry.install(makeManifest(), makeHandler());
      expect(fn).toHaveBeenCalledOnce();
    });

    it('auto-grants safe permissions', () => {
      registry.install(makeManifest(), makeHandler());
      // tts and storage are safe by default
      expect(registry.hasPermission('com.test.my-plugin', 'tts')).toBe(true);
      expect(registry.hasPermission('com.test.my-plugin', 'storage')).toBe(true);
      // camera is not safe
      expect(registry.hasPermission('com.test.my-plugin', 'camera')).toBe(false);
    });

    it('does not auto-grant when disabled', () => {
      const noAutoRegistry = new PluginRegistry({ autoGrantSafe: false });
      noAutoRegistry.install(makeManifest(), makeHandler());
      expect(noAutoRegistry.hasPermission('com.test.my-plugin', 'tts')).toBe(false);
    });

    it('checks dependencies', () => {
      const result = registry.install(
        makeManifest({ dependencies: ['com.test.nonexistent'] }),
        makeHandler(),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing dependency'))).toBe(true);
    });

    it('allows plugins with satisfied dependencies', () => {
      registry.install(makeManifest({ id: 'com.test.dep-plugin' }), makeHandler());
      const result = registry.install(
        makeManifest({ id: 'com.test.dependent', dependencies: ['com.test.dep-plugin'] }),
        makeHandler(),
      );
      expect(result.valid).toBe(true);
    });
  });

  // ─── Uninstallation ────────────────────────────────────────────

  describe('Uninstallation', () => {
    it('uninstalls a plugin', () => {
      registry.install(makeManifest(), makeHandler());
      expect(registry.uninstall('com.test.my-plugin')).toBe(true);
      expect(registry.getPluginCount()).toBe(0);
    });

    it('returns false for unknown plugin', () => {
      expect(registry.uninstall('nonexistent')).toBe(false);
    });

    it('emits plugin:uninstalled event', () => {
      registry.install(makeManifest(), makeHandler());
      const fn = vi.fn();
      registry.on('plugin:uninstalled', fn);
      registry.uninstall('com.test.my-plugin');
      expect(fn).toHaveBeenCalledWith('com.test.my-plugin');
    });

    it('disables before uninstalling', async () => {
      const handler = makeHandler();
      registry.install(makeManifest(), handler);
      await registry.enable('com.test.my-plugin');
      registry.uninstall('com.test.my-plugin');
      expect(handler.onDisable).toHaveBeenCalled();
    });
  });

  // ─── Enable / Disable ──────────────────────────────────────────

  describe('Enable / Disable', () => {
    it('enables a plugin', async () => {
      const handler = makeHandler();
      registry.install(makeManifest(), handler);
      const result = await registry.enable('com.test.my-plugin');
      expect(result).toBe(true);
      expect(handler.onEnable).toHaveBeenCalled();
    });

    it('reports enabled state', async () => {
      registry.install(makeManifest(), makeHandler());
      await registry.enable('com.test.my-plugin');
      const plugin = registry.getPlugin('com.test.my-plugin');
      expect(plugin?.state).toBe('enabled');
    });

    it('disables a plugin', async () => {
      const handler = makeHandler();
      registry.install(makeManifest(), handler);
      await registry.enable('com.test.my-plugin');
      const result = await registry.disable('com.test.my-plugin');
      expect(result).toBe(true);
      expect(handler.onDisable).toHaveBeenCalled();
    });

    it('handles enable failure', async () => {
      const handler = makeHandler({
        onEnable: vi.fn().mockRejectedValue(new Error('Init failed')),
      });
      registry.install(makeManifest(), handler);
      const result = await registry.enable('com.test.my-plugin');
      expect(result).toBe(false);
      expect(registry.getPlugin('com.test.my-plugin')?.state).toBe('error');
    });

    it('emits plugin:enabled event', async () => {
      registry.install(makeManifest(), makeHandler());
      const fn = vi.fn();
      registry.on('plugin:enabled', fn);
      await registry.enable('com.test.my-plugin');
      expect(fn).toHaveBeenCalledWith('com.test.my-plugin');
    });

    it('emits plugin:disabled event', async () => {
      registry.install(makeManifest(), makeHandler());
      await registry.enable('com.test.my-plugin');
      const fn = vi.fn();
      registry.on('plugin:disabled', fn);
      await registry.disable('com.test.my-plugin');
      expect(fn).toHaveBeenCalledWith('com.test.my-plugin');
    });

    it('returns false for unknown plugin', async () => {
      expect(await registry.enable('nonexistent')).toBe(false);
      expect(await registry.disable('nonexistent')).toBe(false);
    });

    it('idempotent enable', async () => {
      registry.install(makeManifest(), makeHandler());
      await registry.enable('com.test.my-plugin');
      const result = await registry.enable('com.test.my-plugin');
      expect(result).toBe(true);
    });
  });

  // ─── Invocation ────────────────────────────────────────────────

  describe('Invocation', () => {
    const frame = {
      data: Buffer.alloc(100),
      width: 640,
      height: 480,
      timestamp: Date.now(),
    };

    it('invokes frame handler', async () => {
      const handler = makeHandler();
      registry.install(makeManifest(), handler);
      await registry.enable('com.test.my-plugin');
      registry.grantPermission('com.test.my-plugin', 'camera');

      const response = await registry.invokeFrame('com.test.my-plugin', frame);
      expect(response).not.toBeNull();
      expect(response!.ttsText).toBe('Processed frame');
      expect(handler.onFrame).toHaveBeenCalled();
    });

    it('returns null for disabled plugin', async () => {
      registry.install(makeManifest(), makeHandler());
      const response = await registry.invokeFrame('com.test.my-plugin', frame);
      expect(response).toBeNull();
    });

    it('returns null without camera permission', async () => {
      registry.install(makeManifest(), makeHandler());
      await registry.enable('com.test.my-plugin');
      // Camera permission not granted
      const response = await registry.invokeFrame('com.test.my-plugin', frame);
      expect(response).toBeNull();
    });

    it('invokes voice command handler', async () => {
      const handler = makeHandler();
      registry.install(makeManifest(), handler);
      await registry.enable('com.test.my-plugin');

      const response = await registry.invokeVoiceCommand(
        'com.test.my-plugin',
        'scan this',
        { count: 5 },
      );
      expect(response).not.toBeNull();
      expect(handler.onVoiceCommand).toHaveBeenCalled();
    });

    it('tracks invocation stats', async () => {
      registry.install(makeManifest(), makeHandler());
      await registry.enable('com.test.my-plugin');
      registry.grantPermission('com.test.my-plugin', 'camera');

      await registry.invokeFrame('com.test.my-plugin', frame);
      await registry.invokeFrame('com.test.my-plugin', frame);

      const plugin = registry.getPlugin('com.test.my-plugin');
      expect(plugin?.stats.invocations).toBe(2);
    });

    it('emits plugin:invoked event', async () => {
      registry.install(makeManifest(), makeHandler());
      await registry.enable('com.test.my-plugin');
      registry.grantPermission('com.test.my-plugin', 'camera');

      const fn = vi.fn();
      registry.on('plugin:invoked', fn);
      await registry.invokeFrame('com.test.my-plugin', frame);
      expect(fn).toHaveBeenCalled();
    });

    it('handles plugin errors', async () => {
      const handler = makeHandler({
        onFrame: vi.fn().mockRejectedValue(new Error('Processing failed')),
      });
      registry.install(makeManifest(), handler);
      await registry.enable('com.test.my-plugin');
      registry.grantPermission('com.test.my-plugin', 'camera');

      const errorFn = vi.fn();
      registry.on('plugin:error', errorFn);

      const response = await registry.invokeFrame('com.test.my-plugin', frame);
      expect(response).toBeNull();
      expect(errorFn).toHaveBeenCalled();
    });

    it('auto-disables on consecutive errors', async () => {
      const errorRegistry = new PluginRegistry({ maxConsecutiveErrors: 2 });
      const handler = makeHandler({
        onFrame: vi.fn().mockRejectedValue(new Error('Fail')),
      });
      errorRegistry.install(makeManifest(), handler);
      await errorRegistry.enable('com.test.my-plugin');
      errorRegistry.grantPermission('com.test.my-plugin', 'camera');

      await errorRegistry.invokeFrame('com.test.my-plugin', { ...frame });
      await errorRegistry.invokeFrame('com.test.my-plugin', { ...frame });

      const plugin = errorRegistry.getPlugin('com.test.my-plugin');
      expect(plugin?.state).toBe('error');
    });

    it('returns null for plugin without frame handler', async () => {
      const handler = makeHandler({ onFrame: undefined });
      registry.install(makeManifest(), handler);
      await registry.enable('com.test.my-plugin');
      registry.grantPermission('com.test.my-plugin', 'camera');

      const response = await registry.invokeFrame('com.test.my-plugin', frame);
      expect(response).toBeNull();
    });
  });

  // ─── Permissions ───────────────────────────────────────────────

  describe('Permissions', () => {
    it('grants permissions', () => {
      registry.install(makeManifest(), makeHandler());
      registry.grantPermission('com.test.my-plugin', 'camera');
      expect(registry.hasPermission('com.test.my-plugin', 'camera')).toBe(true);
    });

    it('revokes permissions', () => {
      registry.install(makeManifest(), makeHandler());
      registry.grantPermission('com.test.my-plugin', 'camera');
      registry.revokePermission('com.test.my-plugin', 'camera');
      expect(registry.hasPermission('com.test.my-plugin', 'camera')).toBe(false);
    });

    it('lists granted permissions', () => {
      registry.install(makeManifest(), makeHandler());
      registry.grantPermission('com.test.my-plugin', 'camera');
      const perms = registry.getPermissions('com.test.my-plugin');
      expect(perms).toContain('camera');
      expect(perms).toContain('tts'); // auto-granted
      expect(perms).toContain('storage'); // auto-granted
    });

    it('returns false for unknown plugin', () => {
      expect(registry.grantPermission('nonexistent', 'camera')).toBe(false);
      expect(registry.revokePermission('nonexistent', 'camera')).toBe(false);
    });

    it('returns empty array for unknown plugin', () => {
      expect(registry.getPermissions('nonexistent')).toEqual([]);
    });

    it('emits permission events', () => {
      registry.install(makeManifest(), makeHandler());
      const grantFn = vi.fn();
      const denyFn = vi.fn();
      registry.on('permission:granted', grantFn);
      registry.on('permission:denied', denyFn);

      registry.grantPermission('com.test.my-plugin', 'camera');
      expect(grantFn).toHaveBeenCalledWith('com.test.my-plugin', 'camera');

      registry.revokePermission('com.test.my-plugin', 'camera');
      expect(denyFn).toHaveBeenCalledWith('com.test.my-plugin', 'camera');
    });
  });

  // ─── Configuration ─────────────────────────────────────────────

  describe('Configuration', () => {
    it('gets default config', () => {
      registry.install(makeManifest({
        configSchema: [
          { name: 'threshold', type: 'number', label: 'Threshold', required: false, default: 0.5 },
        ],
      }), makeHandler());

      const config = registry.getConfig('com.test.my-plugin');
      expect(config?.threshold).toBe(0.5);
    });

    it('sets config', () => {
      registry.install(makeManifest(), makeHandler());
      const result = registry.setConfig('com.test.my-plugin', { threshold: 0.8 });
      expect(result).toBe(true);
      expect(registry.getConfig('com.test.my-plugin')?.threshold).toBe(0.8);
    });

    it('returns null for unknown plugin', () => {
      expect(registry.getConfig('nonexistent')).toBeNull();
    });

    it('returns false for unknown plugin set', () => {
      expect(registry.setConfig('nonexistent', {})).toBe(false);
    });

    it('validates required config fields', () => {
      registry.install(makeManifest({
        configSchema: [
          { name: 'apiKey', type: 'string', label: 'API Key', required: true },
        ],
      }), makeHandler());

      // Missing required field
      const result = registry.setConfig('com.test.my-plugin', {});
      expect(result).toBe(false);
    });

    it('emits config changed event', () => {
      registry.install(makeManifest(), makeHandler());
      const fn = vi.fn();
      registry.on('plugin:config_changed', fn);
      registry.setConfig('com.test.my-plugin', { key: 'value' });
      expect(fn).toHaveBeenCalled();
    });
  });

  // ─── Query ─────────────────────────────────────────────────────

  describe('Query', () => {
    beforeEach(() => {
      registry.install(makeManifest({ id: 'com.test.plugin-1', category: 'inventory', sceneTypes: ['retail_shelf'] }), makeHandler());
      registry.install(makeManifest({ id: 'com.test.plugin-2', category: 'safety', sceneTypes: ['outdoor'] }), makeHandler());
      registry.install(makeManifest({ id: 'com.test.plugin-3', category: 'inventory' }), makeHandler());
    });

    it('gets plugin by id', () => {
      const plugin = registry.getPlugin('com.test.plugin-1');
      expect(plugin).toBeDefined();
      expect(plugin?.manifest.id).toBe('com.test.plugin-1');
    });

    it('returns undefined for unknown plugin', () => {
      expect(registry.getPlugin('nonexistent')).toBeUndefined();
    });

    it('lists all plugins', () => {
      expect(registry.getPlugins().length).toBe(3);
    });

    it('lists enabled plugins', async () => {
      await registry.enable('com.test.plugin-1');
      expect(registry.getEnabledPlugins().length).toBe(1);
    });

    it('filters by category', () => {
      const inventory = registry.getPluginsByCategory('inventory');
      expect(inventory.length).toBe(2);
    });

    it('filters by scene type', async () => {
      await registry.enable('com.test.plugin-1');
      await registry.enable('com.test.plugin-2');
      const retail = registry.getPluginsForScene('retail_shelf');
      expect(retail.length).toBe(1);
      expect(retail[0].manifest.id).toBe('com.test.plugin-1');
    });

    it('reports plugin count', () => {
      expect(registry.getPluginCount()).toBe(3);
    });
  });

  // ─── Voice Summary ─────────────────────────────────────────────

  describe('Voice Summary', () => {
    it('returns summary with counts', () => {
      registry.install(makeManifest(), makeHandler());
      const summary = registry.getVoiceSummary();
      expect(summary).toContain('1 plugins installed');
      expect(summary).toContain('0 enabled');
    });

    it('mentions errors', async () => {
      const handler = makeHandler({
        onEnable: vi.fn().mockRejectedValue(new Error('fail')),
      });
      registry.install(makeManifest(), handler);
      await registry.enable('com.test.my-plugin');
      const summary = registry.getVoiceSummary();
      expect(summary).toContain('errors');
    });
  });

  // ─── Marketplace Info ──────────────────────────────────────────

  describe('Marketplace Info', () => {
    it('returns marketplace info', () => {
      registry.install(makeManifest({
        pricing: { model: 'subscription', price: 999, interval: 'month' },
      }), makeHandler());

      const info = registry.getMarketplaceInfo('com.test.my-plugin');
      expect(info).not.toBeNull();
      expect(info!.pricingDisplay).toContain('$9.99');
      expect(info!.pricingDisplay).toContain('month');
    });

    it('shows Free for free plugins', () => {
      registry.install(makeManifest({
        pricing: { model: 'free' },
      }), makeHandler());

      const info = registry.getMarketplaceInfo('com.test.my-plugin');
      expect(info!.pricingDisplay).toBe('Free');
    });

    it('shows freemium display', () => {
      registry.install(makeManifest({
        pricing: { model: 'freemium' },
      }), makeHandler());

      const info = registry.getMarketplaceInfo('com.test.my-plugin');
      expect(info!.pricingDisplay).toContain('premium');
    });

    it('shows pay-per-use display', () => {
      registry.install(makeManifest({
        pricing: { model: 'pay_per_use', perUsePrice: 50 },
      }), makeHandler());

      const info = registry.getMarketplaceInfo('com.test.my-plugin');
      expect(info!.pricingDisplay).toContain('per use');
    });

    it('includes permission details', () => {
      registry.install(makeManifest(), makeHandler());
      const info = registry.getMarketplaceInfo('com.test.my-plugin');
      expect(info!.permissionDetails.length).toBe(3);
      expect(info!.permissionDetails.find(p => p.permission === 'camera')).toBeDefined();
    });

    it('returns null for unknown plugin', () => {
      expect(registry.getMarketplaceInfo('nonexistent')).toBeNull();
    });
  });

  // ─── Default Config ────────────────────────────────────────────

  describe('DEFAULT_REGISTRY_CONFIG', () => {
    it('has reasonable defaults', () => {
      expect(DEFAULT_REGISTRY_CONFIG.maxPlugins).toBe(50);
      expect(DEFAULT_REGISTRY_CONFIG.maxConcurrent).toBe(5);
      expect(DEFAULT_REGISTRY_CONFIG.pluginTimeout).toBe(5000);
      expect(DEFAULT_REGISTRY_CONFIG.maxConsecutiveErrors).toBe(3);
      expect(DEFAULT_REGISTRY_CONFIG.enableSandbox).toBe(true);
      expect(DEFAULT_REGISTRY_CONFIG.defaultRevenueShare).toBe(30);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('handles multiple plugins', () => {
      for (let i = 0; i < 10; i++) {
        registry.install(
          makeManifest({ id: `com.test.plugin-${i}` }),
          makeHandler(),
        );
      }
      expect(registry.getPluginCount()).toBe(10);
    });

    it('handles rapid enable/disable', async () => {
      registry.install(makeManifest(), makeHandler());
      for (let i = 0; i < 5; i++) {
        await registry.enable('com.test.my-plugin');
        await registry.disable('com.test.my-plugin');
      }
      expect(registry.getPlugin('com.test.my-plugin')?.state).toBe('disabled');
    });

    it('handles concurrent invocations', async () => {
      const handler = makeHandler({
        onFrame: vi.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 10));
          return { ttsText: 'done' };
        }),
      });
      registry.install(makeManifest(), handler);
      await registry.enable('com.test.my-plugin');
      registry.grantPermission('com.test.my-plugin', 'camera');

      const frame = { data: Buffer.alloc(100), width: 640, height: 480, timestamp: Date.now() };
      const results = await Promise.all([
        registry.invokeFrame('com.test.my-plugin', frame),
        registry.invokeFrame('com.test.my-plugin', frame),
        registry.invokeFrame('com.test.my-plugin', frame),
      ]);

      const successful = results.filter(r => r !== null);
      expect(successful.length).toBeGreaterThan(0);
    });
  });
});
