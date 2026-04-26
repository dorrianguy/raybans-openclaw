/**
 * Plugin Registry — Dynamic agent plugin management for Ray-Bans × OpenClaw.
 *
 * Turns a collection of specialist agents into a real platform with:
 * - Dynamic agent registration and discovery
 * - Configuration management per agent
 * - Dependency resolution between plugins
 * - Lifecycle management (install, enable, disable, uninstall)
 * - Health monitoring and automatic recovery
 * - Permission system for agent capabilities
 * - Hook system for cross-plugin communication
 * - Marketplace-ready metadata (version, author, pricing tier)
 *
 * This is the foundation for Feature #13 (Vision App Store / Marketplace)
 * from the REVENUE-FEATURES spec. Third-party developers will use this API
 * to register their agents into the platform.
 */

import { EventEmitter } from 'eventemitter3';

// ─── Types ──────────────────────────────────────────────────────

/**
 * Plugin states follow a strict lifecycle:
 *   registered → installed → enabled → disabled → uninstalled
 *   Any state can transition to 'error' and back via recovery.
 */
export type PluginState =
  | 'registered'   // Metadata known, not yet installed
  | 'installed'    // Code loaded, not yet active
  | 'enabled'      // Active and processing
  | 'disabled'     // Loaded but not processing
  | 'uninstalled'  // Removed, pending cleanup
  | 'error';       // Something went wrong

export type PluginCategory =
  | 'agent'         // Specialist agent (inventory, networking, etc.)
  | 'pipeline'      // Image processing pipeline stage
  | 'integration'   // External service integration
  | 'export'        // Data export format
  | 'voice'         // Voice command handler
  | 'ui'            // Dashboard UI component
  | 'analytics'     // Analytics/tracking extension
  | 'chain'         // Context chain template
  | 'notification'  // Notification channel
  | 'storage';      // Storage backend

export type PluginCapability =
  | 'camera:read'         // Can access camera images
  | 'camera:control'      // Can trigger camera snaps
  | 'audio:input'         // Can receive audio/voice
  | 'audio:output'        // Can produce TTS output
  | 'storage:read'        // Can read persistent storage
  | 'storage:write'       // Can write to persistent storage
  | 'network:local'       // Can make local network requests
  | 'network:internet'    // Can make internet requests
  | 'location:read'       // Can access GPS data
  | 'contacts:read'       // Can read contact database
  | 'contacts:write'      // Can modify contact database
  | 'billing:read'        // Can read billing status
  | 'notifications:send'  // Can send notifications
  | 'agents:invoke'       // Can invoke other agents
  | 'ui:dashboard';       // Can add dashboard widgets

export type PricingTier =
  | 'free'        // Available in all plans
  | 'solo'        // Solo Store ($79/mo) and above
  | 'multi'       // Multi-Store ($199/mo) and above
  | 'enterprise'  // Enterprise ($499/mo) only
  | 'addon';      // Separate purchase

export interface PluginMetadata {
  /** Unique plugin identifier (reverse-domain recommended: com.openclaw.inventory) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description (1-2 sentences) */
  description: string;
  /** Semantic version */
  version: string;
  /** Plugin author/organization */
  author: string;
  /** Author's website/profile */
  authorUrl?: string;
  /** Plugin homepage/repository */
  homepage?: string;
  /** License (SPDX identifier) */
  license?: string;
  /** Plugin category */
  category: PluginCategory;
  /** Feature icon (emoji or icon name) */
  icon: string;
  /** Required capabilities */
  capabilities: PluginCapability[];
  /** Minimum pricing tier required */
  pricingTier: PricingTier;
  /** IDs of plugins this depends on */
  dependencies: string[];
  /** IDs of plugins that conflict (can't be enabled simultaneously) */
  conflicts: string[];
  /** Minimum platform version */
  minPlatformVersion?: string;
  /** Tags for discovery/search */
  tags: string[];
  /** Whether this is a core (built-in) plugin */
  isCore: boolean;
}

export interface PluginConfig {
  /** Plugin-specific configuration key-value pairs */
  [key: string]: unknown;
}

export interface PluginConfigSchema {
  /** Configuration key */
  key: string;
  /** Human-readable label */
  label: string;
  /** Description */
  description: string;
  /** Value type */
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';
  /** Default value */
  defaultValue: unknown;
  /** For select/multiselect: available options */
  options?: Array<{ value: string | number; label: string }>;
  /** Validation: required field */
  required?: boolean;
  /** Validation: min value (numbers) */
  min?: number;
  /** Validation: max value (numbers) */
  max?: number;
  /** Validation: regex pattern (strings) */
  pattern?: string;
}

export interface PluginHealthStatus {
  /** Is the plugin healthy? */
  healthy: boolean;
  /** Last health check timestamp */
  lastCheckAt: string;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Last error message if unhealthy */
  lastError?: string;
  /** Average response time in ms */
  avgResponseTimeMs: number;
  /** Total invocations since enabled */
  totalInvocations: number;
  /** Successful invocations */
  successfulInvocations: number;
  /** Uptime percentage (0-1) */
  uptime: number;
}

export interface PluginInstance {
  /** Plugin metadata */
  metadata: PluginMetadata;
  /** Current state */
  state: PluginState;
  /** Plugin-specific configuration */
  config: PluginConfig;
  /** Configuration schema (for UI generation) */
  configSchema: PluginConfigSchema[];
  /** Health status */
  health: PluginHealthStatus;
  /** When the plugin was registered */
  registeredAt: string;
  /** When the plugin was last enabled */
  enabledAt?: string;
  /** When the plugin was last disabled */
  disabledAt?: string;
  /** Error details if in error state */
  error?: string;
  /** Granted capabilities (may be subset of requested) */
  grantedCapabilities: PluginCapability[];
}

export interface PluginHook {
  /** Hook name (e.g., 'image:analyzed', 'inventory:item-added') */
  hookName: string;
  /** Plugin that registered the hook */
  pluginId: string;
  /** Priority (lower = first) */
  priority: number;
  /** The hook handler */
  handler: (data: unknown) => unknown | Promise<unknown>;
}

// ─── Registry Configuration ─────────────────────────────────────

export interface PluginRegistryConfig {
  /** Maximum number of plugins (default: 100) */
  maxPlugins: number;
  /** Health check interval in ms (default: 60000 = 1 min) */
  healthCheckIntervalMs: number;
  /** Max consecutive failures before auto-disable (default: 5) */
  maxConsecutiveFailures: number;
  /** Enable auto-recovery (default: true) */
  autoRecovery: boolean;
  /** Auto-recovery delay in ms (default: 30000 = 30s) */
  autoRecoveryDelayMs: number;
  /** Max recovery attempts per plugin (default: 3) */
  maxRecoveryAttempts: number;
  /** Default capabilities granted to all plugins */
  defaultCapabilities: PluginCapability[];
  /** Capabilities that require explicit user approval */
  restrictedCapabilities: PluginCapability[];
  /** Current user's pricing tier */
  currentPricingTier: PricingTier;
}

const DEFAULT_CONFIG: PluginRegistryConfig = {
  maxPlugins: 100,
  healthCheckIntervalMs: 60000,
  maxConsecutiveFailures: 5,
  autoRecovery: true,
  autoRecoveryDelayMs: 30000,
  maxRecoveryAttempts: 3,
  defaultCapabilities: ['camera:read', 'storage:read', 'audio:output'],
  restrictedCapabilities: ['network:internet', 'contacts:write', 'billing:read'],
  currentPricingTier: 'free',
};

// ─── Events ─────────────────────────────────────────────────────

export interface PluginRegistryEvents {
  'plugin:registered': (plugin: PluginInstance) => void;
  'plugin:installed': (pluginId: string) => void;
  'plugin:enabled': (pluginId: string) => void;
  'plugin:disabled': (pluginId: string, reason: string) => void;
  'plugin:uninstalled': (pluginId: string) => void;
  'plugin:error': (pluginId: string, error: string) => void;
  'plugin:recovered': (pluginId: string) => void;
  'plugin:config-changed': (pluginId: string, config: PluginConfig) => void;
  'hook:registered': (hookName: string, pluginId: string) => void;
  'hook:triggered': (hookName: string, pluginCount: number) => void;
  'health:check': (results: Map<string, boolean>) => void;
  'capability:granted': (pluginId: string, capability: PluginCapability) => void;
  'capability:denied': (pluginId: string, capability: PluginCapability, reason: string) => void;
}

// ─── Pricing Tier Hierarchy ─────────────────────────────────────

const TIER_HIERARCHY: Record<PricingTier, number> = {
  free: 0,
  solo: 1,
  multi: 2,
  enterprise: 3,
  addon: 99, // addon bypasses tier check
};

// ─── Plugin Registry Implementation ─────────────────────────────

export class PluginRegistry extends EventEmitter<PluginRegistryEvents> {
  private config: PluginRegistryConfig;
  private plugins: Map<string, PluginInstance> = new Map();
  private hooks: Map<string, PluginHook[]> = new Map();
  private recoveryAttempts: Map<string, number> = new Map();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<PluginRegistryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Plugin Lifecycle ───────────────────────────────────────

  /**
   * Register a new plugin with the registry.
   * Does NOT enable it — just makes it known.
   */
  register(
    metadata: PluginMetadata,
    configSchema: PluginConfigSchema[] = [],
    defaultConfig: PluginConfig = {}
  ): PluginInstance {
    // Validate ID format
    if (!metadata.id || metadata.id.length < 2 || metadata.id.length > 128) {
      throw new Error(`Invalid plugin ID: "${metadata.id}" (must be 2-128 characters)`);
    }

    // Check for duplicates
    if (this.plugins.has(metadata.id)) {
      throw new Error(`Plugin "${metadata.id}" is already registered`);
    }

    // Check capacity
    if (this.plugins.size >= this.config.maxPlugins) {
      throw new Error(`Plugin limit reached (${this.config.maxPlugins})`);
    }

    // Validate version format (semver-ish)
    if (!/^\d+\.\d+\.\d+/.test(metadata.version)) {
      throw new Error(`Invalid version format: "${metadata.version}" (expected semver)`);
    }

    // Build granted capabilities
    const grantedCapabilities = this.resolveCapabilities(metadata);

    const instance: PluginInstance = {
      metadata,
      state: 'registered',
      config: { ...defaultConfig },
      configSchema,
      health: {
        healthy: true,
        lastCheckAt: new Date().toISOString(),
        consecutiveFailures: 0,
        avgResponseTimeMs: 0,
        totalInvocations: 0,
        successfulInvocations: 0,
        uptime: 1,
      },
      registeredAt: new Date().toISOString(),
      grantedCapabilities,
    };

    this.plugins.set(metadata.id, instance);
    this.emit('plugin:registered', instance);

    return instance;
  }

  /**
   * Install a registered plugin (load its code/resources).
   */
  install(pluginId: string): void {
    const plugin = this.getPluginOrThrow(pluginId);

    if (plugin.state !== 'registered') {
      throw new Error(`Cannot install plugin in state "${plugin.state}" (must be "registered")`);
    }

    // Check pricing tier
    if (!this.checkPricingTier(plugin.metadata.pricingTier)) {
      throw new Error(
        `Plugin "${pluginId}" requires tier "${plugin.metadata.pricingTier}" ` +
        `but current tier is "${this.config.currentPricingTier}"`
      );
    }

    plugin.state = 'installed';
    this.emit('plugin:installed', pluginId);
  }

  /**
   * Enable a plugin (start processing).
   */
  enable(pluginId: string): void {
    const plugin = this.getPluginOrThrow(pluginId);

    if (plugin.state !== 'installed' && plugin.state !== 'disabled') {
      throw new Error(
        `Cannot enable plugin in state "${plugin.state}" (must be "installed" or "disabled")`
      );
    }

    // Check dependencies are enabled
    const missingDeps = this.checkDependencies(plugin.metadata);
    if (missingDeps.length > 0) {
      throw new Error(
        `Missing dependencies for "${pluginId}": ${missingDeps.join(', ')}`
      );
    }

    // Check conflicts
    const conflicts = this.checkConflicts(plugin.metadata);
    if (conflicts.length > 0) {
      throw new Error(
        `Plugin "${pluginId}" conflicts with enabled plugins: ${conflicts.join(', ')}`
      );
    }

    plugin.state = 'enabled';
    plugin.enabledAt = new Date().toISOString();
    plugin.error = undefined;
    this.recoveryAttempts.delete(pluginId);
    this.emit('plugin:enabled', pluginId);
  }

  /**
   * Disable a plugin (stop processing but keep loaded).
   */
  disable(pluginId: string, reason: string = 'manual'): void {
    const plugin = this.getPluginOrThrow(pluginId);

    if (plugin.state !== 'enabled' && plugin.state !== 'error') {
      throw new Error(
        `Cannot disable plugin in state "${plugin.state}" (must be "enabled" or "error")`
      );
    }

    // Check if any enabled plugins depend on this one
    const dependents = this.getDependents(pluginId);
    if (dependents.length > 0 && reason !== 'error_recovery') {
      throw new Error(
        `Cannot disable "${pluginId}" — these plugins depend on it: ${dependents.join(', ')}`
      );
    }

    plugin.state = 'disabled';
    plugin.disabledAt = new Date().toISOString();

    // Remove hooks registered by this plugin
    this.removePluginHooks(pluginId);

    this.emit('plugin:disabled', pluginId, reason);
  }

  /**
   * Uninstall a plugin (remove it completely).
   */
  uninstall(pluginId: string): void {
    const plugin = this.getPluginOrThrow(pluginId);

    // Must be disabled or installed first
    if (plugin.state === 'enabled') {
      this.disable(pluginId, 'uninstalling');
    }

    // Check dependents
    const dependents = this.getDependents(pluginId);
    if (dependents.length > 0) {
      throw new Error(
        `Cannot uninstall "${pluginId}" — these plugins depend on it: ${dependents.join(', ')}`
      );
    }

    plugin.state = 'uninstalled';
    this.removePluginHooks(pluginId);
    this.plugins.delete(pluginId);
    this.recoveryAttempts.delete(pluginId);

    this.emit('plugin:uninstalled', pluginId);
  }

  // ─── Error & Recovery ───────────────────────────────────────

  /**
   * Report a plugin error. May trigger auto-recovery.
   */
  reportError(pluginId: string, error: string): void {
    const plugin = this.getPluginOrThrow(pluginId);

    plugin.health.consecutiveFailures++;
    plugin.health.lastError = error;
    plugin.health.healthy = false;

    this.emit('plugin:error', pluginId, error);

    // Auto-disable after too many failures
    if (plugin.health.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      plugin.state = 'error';
      plugin.error = `Auto-disabled after ${plugin.health.consecutiveFailures} consecutive failures: ${error}`;
      this.emit('plugin:disabled', pluginId, 'auto_error');

      // Try auto-recovery
      if (this.config.autoRecovery) {
        this.attemptRecovery(pluginId);
      }
    }
  }

  /**
   * Report a successful invocation (resets failure counter).
   */
  reportSuccess(pluginId: string, responseTimeMs: number): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    plugin.health.consecutiveFailures = 0;
    plugin.health.healthy = true;
    plugin.health.totalInvocations++;
    plugin.health.successfulInvocations++;
    plugin.health.lastCheckAt = new Date().toISOString();

    // Rolling average response time
    const prev = plugin.health.avgResponseTimeMs;
    const n = plugin.health.totalInvocations;
    plugin.health.avgResponseTimeMs = prev + (responseTimeMs - prev) / n;

    // Update uptime
    plugin.health.uptime =
      plugin.health.successfulInvocations / Math.max(1, plugin.health.totalInvocations);
  }

  /**
   * Attempt to recover an errored plugin.
   */
  private attemptRecovery(pluginId: string): void {
    const attempts = this.recoveryAttempts.get(pluginId) || 0;

    if (attempts >= this.config.maxRecoveryAttempts) {
      return; // Give up
    }

    this.recoveryAttempts.set(pluginId, attempts + 1);

    // Schedule recovery
    setTimeout(() => {
      const plugin = this.plugins.get(pluginId);
      if (!plugin || plugin.state !== 'error') return;

      // Reset health counters
      plugin.health.consecutiveFailures = 0;
      plugin.health.healthy = true;
      plugin.state = 'disabled';

      try {
        this.enable(pluginId);
        this.emit('plugin:recovered', pluginId);
      } catch {
        // Recovery failed — will be tried again if under max attempts
        plugin.state = 'error';
      }
    }, this.config.autoRecoveryDelayMs);
  }

  // ─── Configuration ──────────────────────────────────────────

  /**
   * Get plugin configuration.
   */
  getConfig(pluginId: string): PluginConfig {
    const plugin = this.getPluginOrThrow(pluginId);
    return { ...plugin.config };
  }

  /**
   * Update plugin configuration. Validates against schema.
   */
  setConfig(pluginId: string, newConfig: PluginConfig): void {
    const plugin = this.getPluginOrThrow(pluginId);

    // Validate against schema
    const errors = this.validateConfig(newConfig, plugin.configSchema);
    if (errors.length > 0) {
      throw new Error(`Invalid config: ${errors.join('; ')}`);
    }

    plugin.config = { ...plugin.config, ...newConfig };
    this.emit('plugin:config-changed', pluginId, plugin.config);
  }

  /**
   * Validate a config object against a schema.
   */
  validateConfig(config: PluginConfig, schema: PluginConfigSchema[]): string[] {
    const errors: string[] = [];

    for (const field of schema) {
      const value = config[field.key];

      // Required check
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push(`"${field.key}" is required`);
        continue;
      }

      if (value === undefined || value === null) continue;

      // Type check
      switch (field.type) {
        case 'string':
          if (typeof value !== 'string') {
            errors.push(`"${field.key}" must be a string`);
          } else if (field.pattern && !new RegExp(field.pattern).test(value)) {
            errors.push(`"${field.key}" does not match pattern ${field.pattern}`);
          }
          break;

        case 'number':
          if (typeof value !== 'number' || isNaN(value)) {
            errors.push(`"${field.key}" must be a number`);
          } else {
            if (field.min !== undefined && value < field.min) {
              errors.push(`"${field.key}" must be >= ${field.min}`);
            }
            if (field.max !== undefined && value > field.max) {
              errors.push(`"${field.key}" must be <= ${field.max}`);
            }
          }
          break;

        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push(`"${field.key}" must be a boolean`);
          }
          break;

        case 'select':
          if (field.options && !field.options.some(o => o.value === value)) {
            errors.push(`"${field.key}" must be one of: ${field.options.map(o => o.value).join(', ')}`);
          }
          break;

        case 'multiselect':
          if (!Array.isArray(value)) {
            errors.push(`"${field.key}" must be an array`);
          } else if (field.options) {
            const validValues = new Set(field.options.map(o => o.value));
            for (const v of value) {
              if (!validValues.has(v)) {
                errors.push(`"${field.key}" contains invalid option: ${v}`);
              }
            }
          }
          break;
      }
    }

    return errors;
  }

  // ─── Hook System ────────────────────────────────────────────

  /**
   * Register a hook handler.
   */
  registerHook(
    hookName: string,
    pluginId: string,
    handler: (data: unknown) => unknown | Promise<unknown>,
    priority: number = 10
  ): void {
    // Verify plugin exists and is enabled
    const plugin = this.getPluginOrThrow(pluginId);
    if (plugin.state !== 'enabled') {
      throw new Error(`Plugin "${pluginId}" must be enabled to register hooks`);
    }

    const hook: PluginHook = { hookName, pluginId, priority, handler };

    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }

    const hookList = this.hooks.get(hookName)!;
    hookList.push(hook);

    // Sort by priority (lower first)
    hookList.sort((a, b) => a.priority - b.priority);

    this.emit('hook:registered', hookName, pluginId);
  }

  /**
   * Trigger a hook — all registered handlers are called in priority order.
   * Returns the (possibly modified) data after all handlers run.
   */
  async triggerHook(hookName: string, data: unknown): Promise<unknown> {
    const hookList = this.hooks.get(hookName);
    if (!hookList || hookList.length === 0) return data;

    let result = data;
    let handlerCount = 0;

    for (const hook of hookList) {
      // Only invoke hooks from enabled plugins
      const plugin = this.plugins.get(hook.pluginId);
      if (!plugin || plugin.state !== 'enabled') continue;

      try {
        const hookResult = await hook.handler(result);
        if (hookResult !== undefined) {
          result = hookResult;
        }
        handlerCount++;
      } catch (err) {
        this.reportError(hook.pluginId, `Hook "${hookName}" error: ${err}`);
      }
    }

    this.emit('hook:triggered', hookName, handlerCount);
    return result;
  }

  /**
   * Get all hook names that have handlers registered.
   */
  getRegisteredHooks(): string[] {
    return Array.from(this.hooks.keys()).filter(k => {
      const list = this.hooks.get(k);
      return list && list.length > 0;
    });
  }

  /**
   * Remove all hooks registered by a specific plugin.
   */
  private removePluginHooks(pluginId: string): void {
    for (const [hookName, hookList] of this.hooks) {
      const filtered = hookList.filter(h => h.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.hooks.delete(hookName);
      } else {
        this.hooks.set(hookName, filtered);
      }
    }
  }

  // ─── Queries ────────────────────────────────────────────────

  /**
   * Get a plugin by ID. Returns undefined if not found.
   */
  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get a plugin by ID, throw if not found.
   */
  private getPluginOrThrow(pluginId: string): PluginInstance {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" not found`);
    }
    return plugin;
  }

  /**
   * List all plugins, optionally filtered.
   */
  listPlugins(filter?: {
    state?: PluginState;
    category?: PluginCategory;
    tag?: string;
    search?: string;
    pricingTier?: PricingTier;
  }): PluginInstance[] {
    let result = Array.from(this.plugins.values());

    if (filter) {
      if (filter.state) {
        result = result.filter(p => p.state === filter.state);
      }
      if (filter.category) {
        result = result.filter(p => p.metadata.category === filter.category);
      }
      if (filter.tag) {
        result = result.filter(p => p.metadata.tags.includes(filter.tag!));
      }
      if (filter.pricingTier) {
        result = result.filter(p => p.metadata.pricingTier === filter.pricingTier);
      }
      if (filter.search) {
        const q = filter.search.toLowerCase();
        result = result.filter(p =>
          p.metadata.name.toLowerCase().includes(q) ||
          p.metadata.description.toLowerCase().includes(q) ||
          p.metadata.tags.some(t => t.toLowerCase().includes(q))
        );
      }
    }

    return result;
  }

  /**
   * Get all enabled plugins.
   */
  getEnabledPlugins(): PluginInstance[] {
    return this.listPlugins({ state: 'enabled' });
  }

  /**
   * Get all enabled plugins of a specific category.
   */
  getEnabledByCategory(category: PluginCategory): PluginInstance[] {
    return Array.from(this.plugins.values())
      .filter(p => p.state === 'enabled' && p.metadata.category === category);
  }

  /**
   * Get the total count of plugins by state.
   */
  getStats(): {
    total: number;
    byState: Record<PluginState, number>;
    byCategory: Record<string, number>;
    hooks: number;
    healthyCount: number;
    unhealthyCount: number;
  } {
    const byState: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let healthyCount = 0;
    let unhealthyCount = 0;

    for (const plugin of this.plugins.values()) {
      byState[plugin.state] = (byState[plugin.state] || 0) + 1;
      byCategory[plugin.metadata.category] = (byCategory[plugin.metadata.category] || 0) + 1;

      if (plugin.state === 'enabled') {
        if (plugin.health.healthy) healthyCount++;
        else unhealthyCount++;
      }
    }

    return {
      total: this.plugins.size,
      byState: byState as Record<PluginState, number>,
      byCategory,
      hooks: Array.from(this.hooks.values()).reduce((s, list) => s + list.length, 0),
      healthyCount,
      unhealthyCount,
    };
  }

  // ─── Dependency Resolution ──────────────────────────────────

  /**
   * Check if all dependencies are satisfied for a plugin.
   * Returns array of missing dependency IDs.
   */
  checkDependencies(metadata: PluginMetadata): string[] {
    const missing: string[] = [];

    for (const depId of metadata.dependencies) {
      const dep = this.plugins.get(depId);
      if (!dep || dep.state !== 'enabled') {
        missing.push(depId);
      }
    }

    return missing;
  }

  /**
   * Check for conflicts with currently enabled plugins.
   * Returns array of conflicting plugin IDs.
   */
  checkConflicts(metadata: PluginMetadata): string[] {
    const conflicts: string[] = [];

    for (const conflictId of metadata.conflicts) {
      const conflict = this.plugins.get(conflictId);
      if (conflict && conflict.state === 'enabled') {
        conflicts.push(conflictId);
      }
    }

    return conflicts;
  }

  /**
   * Get plugins that depend on the given plugin.
   * Only returns enabled dependents.
   */
  getDependents(pluginId: string): string[] {
    const dependents: string[] = [];

    for (const plugin of this.plugins.values()) {
      if (
        plugin.state === 'enabled' &&
        plugin.metadata.dependencies.includes(pluginId)
      ) {
        dependents.push(plugin.metadata.id);
      }
    }

    return dependents;
  }

  /**
   * Resolve install order for a plugin and its dependencies.
   * Returns plugins in order they should be installed/enabled.
   */
  resolveInstallOrder(pluginId: string): string[] {
    const plugin = this.getPluginOrThrow(pluginId);
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);

      const p = this.plugins.get(id);
      if (!p) return;

      for (const depId of p.metadata.dependencies) {
        visit(depId);
      }

      order.push(id);
    };

    visit(pluginId);
    return order;
  }

  // ─── Capabilities ──────────────────────────────────────────

  /**
   * Check if a plugin has a specific capability.
   */
  hasCapability(pluginId: string, capability: PluginCapability): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    return plugin.grantedCapabilities.includes(capability);
  }

  /**
   * Grant a restricted capability to a plugin (user approval).
   */
  grantCapability(pluginId: string, capability: PluginCapability): void {
    const plugin = this.getPluginOrThrow(pluginId);

    if (plugin.grantedCapabilities.includes(capability)) return;

    plugin.grantedCapabilities.push(capability);
    this.emit('capability:granted', pluginId, capability);
  }

  /**
   * Resolve which capabilities to grant on registration.
   */
  private resolveCapabilities(metadata: PluginMetadata): PluginCapability[] {
    const granted: PluginCapability[] = [];

    for (const cap of metadata.capabilities) {
      if (this.config.defaultCapabilities.includes(cap)) {
        granted.push(cap);
      } else if (!this.config.restrictedCapabilities.includes(cap)) {
        // Not default, not restricted — grant it
        granted.push(cap);
      }
      // Restricted capabilities require explicit grantCapability() call
    }

    return granted;
  }

  /**
   * Check if the current pricing tier meets a requirement.
   */
  private checkPricingTier(required: PricingTier): boolean {
    if (required === 'addon') return true; // addons are always installable (paid separately)
    return TIER_HIERARCHY[this.config.currentPricingTier] >= TIER_HIERARCHY[required];
  }

  // ─── Health Monitoring ──────────────────────────────────────

  /**
   * Start periodic health checks.
   */
  startHealthChecks(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(() => {
      this.runHealthChecks();
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Run health checks on all enabled plugins.
   */
  runHealthChecks(): Map<string, boolean> {
    const results = new Map<string, boolean>();

    for (const plugin of this.plugins.values()) {
      if (plugin.state !== 'enabled') continue;

      const isHealthy = plugin.health.consecutiveFailures < this.config.maxConsecutiveFailures;
      plugin.health.healthy = isHealthy;
      plugin.health.lastCheckAt = new Date().toISOString();
      results.set(plugin.metadata.id, isHealthy);
    }

    this.emit('health:check', results);
    return results;
  }

  // ─── Built-in Plugin Definitions ────────────────────────────

  /**
   * Get metadata for all built-in (core) plugins.
   * These correspond to the 11 specialist agents already built.
   */
  static getCorePlugins(): PluginMetadata[] {
    return [
      {
        id: 'com.openclaw.memory',
        name: 'Perfect Memory',
        description: 'Index your visual world into searchable memory. Ask about anything you\'ve ever seen.',
        version: '1.0.0',
        author: 'OpenClaw',
        category: 'agent',
        icon: '🧠',
        capabilities: ['camera:read', 'storage:read', 'storage:write', 'audio:output'],
        pricingTier: 'free',
        dependencies: [],
        conflicts: [],
        tags: ['memory', 'search', 'ocr', 'indexing', 'core'],
        isCore: true,
      },
      {
        id: 'com.openclaw.inventory',
        name: 'Inventory Vision',
        description: 'Walk through a store. Look at shelves. Get a complete inventory. The money feature.',
        version: '1.0.0',
        author: 'OpenClaw',
        category: 'agent',
        icon: '📦',
        capabilities: ['camera:read', 'camera:control', 'storage:read', 'storage:write', 'audio:input', 'audio:output'],
        pricingTier: 'solo',
        dependencies: ['com.openclaw.memory'],
        conflicts: [],
        tags: ['inventory', 'retail', 'barcode', 'counting', 'core', 'revenue'],
        isCore: true,
      },
      {
        id: 'com.openclaw.networking',
        name: 'Networking Superpower',
        description: 'Scan badges and cards. Get instant intel on anyone you meet.',
        version: '1.0.0',
        author: 'OpenClaw',
        category: 'agent',
        icon: '🤝',
        capabilities: ['camera:read', 'network:internet', 'contacts:write', 'audio:output'],
        pricingTier: 'solo',
        dependencies: [],
        conflicts: [],
        tags: ['networking', 'contacts', 'badges', 'conferences', 'core'],
        isCore: true,
      },
      {
        id: 'com.openclaw.deals',
        name: 'Deal Intelligence',
        description: 'Real-time price intelligence for any purchase — cars, retail, real estate.',
        version: '1.0.0',
        author: 'OpenClaw',
        category: 'agent',
        icon: '💰',
        capabilities: ['camera:read', 'network:internet', 'audio:output'],
        pricingTier: 'solo',
        dependencies: [],
        conflicts: [],
        tags: ['pricing', 'deals', 'shopping', 'vehicles', 'real-estate', 'core'],
        isCore: true,
      },
      {
        id: 'com.openclaw.security',
        name: 'Situational Awareness',
        description: 'Passive security monitoring. QR code safety, contract analysis, threat detection.',
        version: '1.0.0',
        author: 'OpenClaw',
        category: 'agent',
        icon: '🔒',
        capabilities: ['camera:read', 'network:internet', 'audio:output', 'notifications:send'],
        pricingTier: 'free',
        dependencies: [],
        conflicts: [],
        tags: ['security', 'safety', 'qr-codes', 'contracts', 'core'],
        isCore: true,
      },
      {
        id: 'com.openclaw.meeting',
        name: 'Meeting Intelligence',
        description: 'Capture meetings hands-free. Transcription, slides, action items, summaries.',
        version: '1.0.0',
        author: 'OpenClaw',
        category: 'agent',
        icon: '🗣️',
        capabilities: ['camera:read', 'audio:input', 'storage:write', 'audio:output'],
        pricingTier: 'solo',
        dependencies: ['com.openclaw.memory'],
        conflicts: [],
        tags: ['meetings', 'transcription', 'action-items', 'whiteboards', 'core'],
        isCore: true,
      },
      {
        id: 'com.openclaw.inspection',
        name: 'Inspection Agent',
        description: 'Walk through any space. Get a professional inspection report with photos.',
        version: '1.0.0',
        author: 'OpenClaw',
        category: 'agent',
        icon: '📋',
        capabilities: ['camera:read', 'camera:control', 'storage:write', 'audio:input', 'audio:output', 'location:read'],
        pricingTier: 'solo',
        dependencies: [],
        conflicts: [],
        tags: ['inspection', 'property', 'construction', 'server-room', 'core'],
        isCore: true,
      },
      {
        id: 'com.openclaw.translation',
        name: 'Deep Translation',
        description: 'Not just translation — full cultural context, etiquette, and communication coaching.',
        version: '1.0.0',
        author: 'OpenClaw',
        category: 'agent',
        icon: '🌍',
        capabilities: ['camera:read', 'audio:output', 'network:internet'],
        pricingTier: 'free',
        dependencies: [],
        conflicts: [],
        tags: ['translation', 'languages', 'culture', 'travel', 'core'],
        isCore: true,
      },
      {
        id: 'com.openclaw.debug',
        name: 'Hands-Free Debugging',
        description: 'Look at any screen with code or errors. Get the fix through your speaker.',
        version: '1.0.0',
        author: 'OpenClaw',
        category: 'agent',
        icon: '💻',
        capabilities: ['camera:read', 'audio:output'],
        pricingTier: 'free',
        dependencies: [],
        conflicts: [],
        tags: ['debugging', 'code', 'errors', 'developer', 'core'],
        isCore: true,
      },
      {
        id: 'com.openclaw.context',
        name: 'Context-Aware Assistant',
        description: 'Understands what you\'re doing and helps without being asked.',
        version: '1.0.0',
        author: 'OpenClaw',
        category: 'agent',
        icon: '🎯',
        capabilities: ['camera:read', 'audio:output', 'storage:read'],
        pricingTier: 'free',
        dependencies: [],
        conflicts: [],
        tags: ['context', 'kitchen', 'grocery', 'workshop', 'gym', 'core'],
        isCore: true,
      },
      {
        id: 'com.openclaw.chains',
        name: 'Context Chains',
        description: 'Multi-agent workflows that adapt to your situation. The power move.',
        version: '1.0.0',
        author: 'OpenClaw',
        category: 'chain',
        icon: '🔗',
        capabilities: ['agents:invoke', 'audio:output', 'storage:read'],
        pricingTier: 'multi',
        dependencies: [],
        conflicts: [],
        tags: ['chains', 'workflows', 'automation', 'multi-agent', 'core'],
        isCore: true,
      },
    ];
  }

  /**
   * Register all core plugins. Convenience method for platform startup.
   */
  registerCorePlugins(): void {
    for (const metadata of PluginRegistry.getCorePlugins()) {
      this.register(metadata);
    }
  }

  // ─── Serialization ──────────────────────────────────────────

  /**
   * Export registry state for persistence.
   */
  exportState(): {
    plugins: Array<{
      id: string;
      state: PluginState;
      config: PluginConfig;
      grantedCapabilities: PluginCapability[];
    }>;
  } {
    const plugins: Array<{
      id: string;
      state: PluginState;
      config: PluginConfig;
      grantedCapabilities: PluginCapability[];
    }> = [];

    for (const plugin of this.plugins.values()) {
      plugins.push({
        id: plugin.metadata.id,
        state: plugin.state,
        config: plugin.config,
        grantedCapabilities: plugin.grantedCapabilities,
      });
    }

    return { plugins };
  }

  /**
   * Get the total plugin count.
   */
  get size(): number {
    return this.plugins.size;
  }
}
