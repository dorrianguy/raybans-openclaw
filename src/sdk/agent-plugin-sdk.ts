/**
 * Agent Plugin SDK
 * 
 * The framework for third-party agents to integrate with the Ray-Ban platform.
 * This is the "App Store" foundation — any developer can build a vision agent
 * that plugs into the glasses pipeline.
 * 
 * Architecture:
 * - PluginManifest: declares what the agent does, needs, and provides
 * - PluginSandbox: isolation layer for untrusted plugins
 * - PluginRegistry: manages installed plugins, lifecycle, and permissions
 * - PluginMarketplace: discovery, ratings, and revenue sharing
 * 
 * @module sdk/agent-plugin-sdk
 */

import { EventEmitter } from 'events';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PluginManifest {
  /** Unique plugin identifier (reverse domain: com.company.plugin-name) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Version (semver) */
  version: string;
  /** Plugin description */
  description: string;
  /** Author information */
  author: PluginAuthor;
  /** Plugin category */
  category: PluginCategory;
  /** Required permissions */
  permissions: PluginPermission[];
  /** SDK version compatibility */
  sdkVersion: string;
  /** Entry point module path */
  entryPoint: string;
  /** Scene types this plugin handles */
  sceneTypes?: string[];
  /** Voice commands this plugin registers */
  voiceCommands?: PluginVoiceCommand[];
  /** Configuration schema */
  configSchema?: PluginConfigField[];
  /** Pricing model */
  pricing?: PluginPricing;
  /** Plugin icon URL */
  icon?: string;
  /** Screenshots */
  screenshots?: string[];
  /** Tags for discovery */
  tags?: string[];
  /** Min Ray-Ban firmware version */
  minFirmware?: string;
  /** Dependencies on other plugins */
  dependencies?: string[];
}

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
  verified?: boolean;
}

export type PluginCategory =
  | 'inventory'
  | 'inspection'
  | 'navigation'
  | 'safety'
  | 'productivity'
  | 'social'
  | 'shopping'
  | 'health'
  | 'education'
  | 'entertainment'
  | 'accessibility'
  | 'developer'
  | 'enterprise'
  | 'other';

export type PluginPermission =
  | 'camera'        // Access to camera stream
  | 'microphone'    // Access to microphone
  | 'tts'           // Can speak through glasses
  | 'gps'           // Access to location
  | 'storage'       // Can persist data
  | 'network'       // Can make network requests
  | 'contacts'      // Access to contact list
  | 'calendar'      // Access to calendar
  | 'notifications' // Can send notifications
  | 'billing'       // Can trigger billing events
  | 'vision'        // Access to vision pipeline
  | 'memory'        // Access to visual memory store
  | 'agents'        // Can invoke other agents
  | 'system'        // System-level access
  | 'background';   // Can run in background

export interface PluginVoiceCommand {
  /** Command phrase pattern */
  phrase: string;
  /** Description for help */
  description: string;
  /** Parameters extracted from voice */
  parameters?: Array<{ name: string; type: string; required: boolean }>;
}

export interface PluginConfigField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';
  label: string;
  description?: string;
  required: boolean;
  default?: unknown;
  options?: Array<{ label: string; value: string }>;
  validation?: { min?: number; max?: number; pattern?: string };
}

export interface PluginPricing {
  model: 'free' | 'paid' | 'subscription' | 'freemium' | 'pay_per_use';
  price?: number; // In cents
  interval?: 'month' | 'year' | 'one_time';
  trialDays?: number;
  revenueShare?: number; // Platform takes this % (default: 30%)
  perUsePrice?: number; // Cents per use for pay_per_use
}

// ─── Plugin Lifecycle ────────────────────────────────────────────────────────

export type PluginState = 'installed' | 'enabled' | 'disabled' | 'error' | 'updating';

export interface InstalledPlugin {
  manifest: PluginManifest;
  state: PluginState;
  installedAt: number;
  updatedAt: number;
  enabledAt?: number;
  config: Record<string, unknown>;
  error?: string;
  stats: PluginStats;
}

export interface PluginStats {
  invocations: number;
  errors: number;
  avgResponseMs: number;
  totalProcessingMs: number;
  lastInvoked?: number;
  lastError?: string;
  rating?: number;
  reviews?: number;
}

// ─── Plugin API (what plugins can access) ────────────────────────────────────

export interface PluginAPI {
  /** Get current frame/image data */
  getCurrentFrame(): Promise<PluginFrame | null>;
  /** Process image through vision pipeline */
  analyzeImage(image: Buffer, mode?: string): Promise<PluginVisionResult>;
  /** Speak text through glasses */
  speak(text: string, priority?: 'low' | 'medium' | 'high'): Promise<void>;
  /** Send notification */
  notify(title: string, body: string, priority?: string): Promise<void>;
  /** Get GPS location */
  getLocation(): Promise<{ lat: number; lng: number; accuracy: number } | null>;
  /** Store data (scoped to plugin) */
  store(key: string, value: unknown): Promise<void>;
  /** Retrieve stored data */
  retrieve(key: string): Promise<unknown | null>;
  /** Delete stored data */
  deleteData(key: string): Promise<void>;
  /** Search visual memory */
  searchMemory(query: string, limit?: number): Promise<PluginMemoryResult[]>;
  /** Get user config for this plugin */
  getConfig(): Record<string, unknown>;
  /** Log a message (visible in plugin dashboard) */
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void;
  /** Track a metric */
  trackMetric(name: string, value: number): void;
  /** Report usage for billing */
  reportUsage(units: number, description?: string): Promise<void>;
  /** Invoke another agent */
  invokeAgent(agentId: string, data: Record<string, unknown>): Promise<unknown>;
}

export interface PluginFrame {
  data: Buffer;
  width: number;
  height: number;
  timestamp: number;
  gps?: { lat: number; lng: number };
}

export interface PluginVisionResult {
  sceneType: string;
  objects: Array<{ name: string; confidence: number }>;
  text: string[];
  products: Array<{ name: string; barcode?: string }>;
}

export interface PluginMemoryResult {
  id: string;
  timestamp: number;
  description: string;
  text?: string;
  relevance: number;
}

// ─── Plugin Interface (what plugins must implement) ──────────────────────────

export interface PluginHandler {
  /** Called when plugin is first enabled */
  onEnable?(api: PluginAPI): Promise<void>;
  /** Called when plugin is disabled */
  onDisable?(): Promise<void>;
  /** Called when a frame is routed to this plugin */
  onFrame?(frame: PluginFrame, api: PluginAPI): Promise<PluginResponse>;
  /** Called when a voice command matches */
  onVoiceCommand?(command: string, params: Record<string, unknown>, api: PluginAPI): Promise<PluginResponse>;
  /** Called periodically for background processing */
  onHeartbeat?(api: PluginAPI): Promise<void>;
  /** Called when config changes */
  onConfigChange?(config: Record<string, unknown>, api: PluginAPI): Promise<void>;
}

export interface PluginResponse {
  /** Text to speak */
  ttsText?: string;
  /** Data to display on dashboard */
  dashboardData?: Record<string, unknown>;
  /** Notification to send */
  notification?: { title: string; body: string };
  /** Data to store */
  storeData?: Record<string, unknown>;
  /** Metadata about the response */
  metadata?: Record<string, unknown>;
}

// ─── Plugin Registry Events ──────────────────────────────────────────────────

export interface PluginRegistryEvents {
  'plugin:installed': (manifest: PluginManifest) => void;
  'plugin:uninstalled': (pluginId: string) => void;
  'plugin:enabled': (pluginId: string) => void;
  'plugin:disabled': (pluginId: string) => void;
  'plugin:error': (pluginId: string, error: Error) => void;
  'plugin:invoked': (pluginId: string, responseTimeMs: number) => void;
  'plugin:config_changed': (pluginId: string, config: Record<string, unknown>) => void;
  'permission:requested': (pluginId: string, permission: PluginPermission) => void;
  'permission:granted': (pluginId: string, permission: PluginPermission) => void;
  'permission:denied': (pluginId: string, permission: PluginPermission) => void;
}

// ─── Plugin Registry Config ──────────────────────────────────────────────────

export interface PluginRegistryConfig {
  /** Max installed plugins (default: 50) */
  maxPlugins: number;
  /** Max concurrent plugin invocations (default: 5) */
  maxConcurrent: number;
  /** Plugin timeout in ms (default: 5000) */
  pluginTimeout: number;
  /** Auto-disable on repeated errors (default: 3) */
  maxConsecutiveErrors: number;
  /** Enable sandbox for untrusted plugins (default: true) */
  enableSandbox: boolean;
  /** Default revenue share percentage (default: 30) */
  defaultRevenueShare: number;
  /** Auto-grant safe permissions (default: true) */
  autoGrantSafe: boolean;
  /** Safe permissions that don't require user approval */
  safePermissions: PluginPermission[];
}

export const DEFAULT_REGISTRY_CONFIG: PluginRegistryConfig = {
  maxPlugins: 50,
  maxConcurrent: 5,
  pluginTimeout: 5000,
  maxConsecutiveErrors: 3,
  enableSandbox: true,
  defaultRevenueShare: 30,
  autoGrantSafe: true,
  safePermissions: ['storage', 'tts', 'notifications'],
};

// ─── Permission Validation ───────────────────────────────────────────────────

export const PERMISSION_DESCRIPTIONS: Record<PluginPermission, {
  label: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
}> = {
  camera: { label: 'Camera', description: 'Access the glasses camera for image capture', risk: 'high' },
  microphone: { label: 'Microphone', description: 'Access the microphone for voice input', risk: 'high' },
  tts: { label: 'Text-to-Speech', description: 'Speak text through the glasses speaker', risk: 'low' },
  gps: { label: 'Location', description: 'Access your GPS location', risk: 'medium' },
  storage: { label: 'Storage', description: 'Store data on your device', risk: 'low' },
  network: { label: 'Network', description: 'Make internet requests', risk: 'medium' },
  contacts: { label: 'Contacts', description: 'Access your contact list', risk: 'high' },
  calendar: { label: 'Calendar', description: 'Access your calendar events', risk: 'medium' },
  notifications: { label: 'Notifications', description: 'Send you notifications', risk: 'low' },
  billing: { label: 'Billing', description: 'Trigger billing events', risk: 'high' },
  vision: { label: 'Vision Pipeline', description: 'Process images through AI vision', risk: 'medium' },
  memory: { label: 'Visual Memory', description: 'Search your visual memory', risk: 'high' },
  agents: { label: 'Agent Access', description: 'Invoke other AI agents', risk: 'medium' },
  system: { label: 'System Access', description: 'Access system-level features', risk: 'high' },
  background: { label: 'Background', description: 'Run when not actively used', risk: 'medium' },
};

// ─── Manifest Validation ─────────────────────────────────────────────────────

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateManifest(manifest: PluginManifest): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!manifest.id || manifest.id.length === 0) {
    errors.push('Plugin ID is required');
  } else if (!/^[a-z0-9]+\.[a-z0-9]+\.[a-z0-9-]+$/.test(manifest.id)) {
    errors.push('Plugin ID must be reverse domain format (e.g., com.company.plugin-name)');
  }

  if (!manifest.name || manifest.name.length === 0) {
    errors.push('Plugin name is required');
  } else if (manifest.name.length > 50) {
    warnings.push('Plugin name should be under 50 characters');
  }

  if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push('Version must be valid semver (e.g., 1.0.0)');
  }

  if (!manifest.description || manifest.description.length === 0) {
    errors.push('Description is required');
  } else if (manifest.description.length > 500) {
    warnings.push('Description should be under 500 characters');
  }

  if (!manifest.author || !manifest.author.name) {
    errors.push('Author name is required');
  }

  if (!manifest.category) {
    errors.push('Category is required');
  }

  if (!manifest.sdkVersion) {
    errors.push('SDK version is required');
  }

  if (!manifest.entryPoint) {
    errors.push('Entry point is required');
  }

  // Permission validation
  if (manifest.permissions) {
    const validPerms = Object.keys(PERMISSION_DESCRIPTIONS);
    for (const perm of manifest.permissions) {
      if (!validPerms.includes(perm)) {
        errors.push(`Unknown permission: ${perm}`);
      }
    }

    const highRisk = manifest.permissions.filter(
      p => PERMISSION_DESCRIPTIONS[p]?.risk === 'high',
    );
    if (highRisk.length > 3) {
      warnings.push(`Plugin requests ${highRisk.length} high-risk permissions — may deter users`);
    }
  }

  // Pricing validation
  if (manifest.pricing) {
    if (manifest.pricing.model === 'paid' || manifest.pricing.model === 'subscription') {
      if (!manifest.pricing.price || manifest.pricing.price <= 0) {
        errors.push('Paid plugins must have a price > 0');
      }
    }
    if (manifest.pricing.model === 'subscription' && !manifest.pricing.interval) {
      errors.push('Subscription plugins must specify an interval');
    }
    if (manifest.pricing.revenueShare !== undefined) {
      if (manifest.pricing.revenueShare < 0 || manifest.pricing.revenueShare > 100) {
        errors.push('Revenue share must be between 0 and 100');
      }
    }
  }

  // Voice command validation
  if (manifest.voiceCommands) {
    for (const cmd of manifest.voiceCommands) {
      if (!cmd.phrase) errors.push('Voice command phrase is required');
      if (!cmd.description) warnings.push(`Voice command "${cmd.phrase}" has no description`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Plugin Registry ─────────────────────────────────────────────────────────

export class PluginRegistry extends EventEmitter {
  private config: PluginRegistryConfig;
  private plugins: Map<string, InstalledPlugin> = new Map();
  private handlers: Map<string, PluginHandler> = new Map();
  private grantedPermissions: Map<string, Set<PluginPermission>> = new Map();
  private consecutiveErrors: Map<string, number> = new Map();
  private concurrent = 0;

  constructor(config: Partial<PluginRegistryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
  }

  // ─── Installation ──────────────────────────────────────────────

  install(manifest: PluginManifest, handler: PluginHandler): ManifestValidationResult {
    const validation = validateManifest(manifest);
    if (!validation.valid) return validation;

    if (this.plugins.size >= this.config.maxPlugins) {
      return {
        valid: false,
        errors: [`Maximum plugin limit reached (${this.config.maxPlugins})`],
        warnings: [],
      };
    }

    if (this.plugins.has(manifest.id)) {
      return {
        valid: false,
        errors: [`Plugin ${manifest.id} is already installed`],
        warnings: [],
      };
    }

    // Check dependencies
    if (manifest.dependencies) {
      for (const dep of manifest.dependencies) {
        if (!this.plugins.has(dep)) {
          return {
            valid: false,
            errors: [`Missing dependency: ${dep}`],
            warnings: validation.warnings,
          };
        }
      }
    }

    const installed: InstalledPlugin = {
      manifest,
      state: 'installed',
      installedAt: Date.now(),
      updatedAt: Date.now(),
      config: this.getDefaultConfig(manifest),
      stats: {
        invocations: 0,
        errors: 0,
        avgResponseMs: 0,
        totalProcessingMs: 0,
      },
    };

    this.plugins.set(manifest.id, installed);
    this.handlers.set(manifest.id, handler);

    // Auto-grant safe permissions
    if (this.config.autoGrantSafe) {
      const granted = new Set<PluginPermission>();
      for (const perm of manifest.permissions) {
        if (this.config.safePermissions.includes(perm)) {
          granted.add(perm);
          this.emit('permission:granted', manifest.id, perm);
        }
      }
      this.grantedPermissions.set(manifest.id, granted);
    } else {
      this.grantedPermissions.set(manifest.id, new Set());
    }

    this.emit('plugin:installed', manifest);
    return validation;
  }

  uninstall(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    // Disable first if enabled
    if (plugin.state === 'enabled') {
      this.disable(pluginId);
    }

    this.plugins.delete(pluginId);
    this.handlers.delete(pluginId);
    this.grantedPermissions.delete(pluginId);
    this.consecutiveErrors.delete(pluginId);

    this.emit('plugin:uninstalled', pluginId);
    return true;
  }

  // ─── Enable / Disable ──────────────────────────────────────────

  async enable(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    const handler = this.handlers.get(pluginId);
    if (!plugin || !handler) return false;

    if (plugin.state === 'enabled') return true;

    // Check required permissions
    const granted = this.grantedPermissions.get(pluginId) || new Set();
    const missingPerms = plugin.manifest.permissions.filter(p => !granted.has(p));
    if (missingPerms.length > 0) {
      for (const perm of missingPerms) {
        this.emit('permission:requested', pluginId, perm);
      }
      // Still allow enabling — permission checks happen at invocation time
    }

    try {
      if (handler.onEnable) {
        const api = this.createPluginAPI(pluginId);
        await handler.onEnable(api);
      }
      plugin.state = 'enabled';
      plugin.enabledAt = Date.now();
      this.consecutiveErrors.set(pluginId, 0);
      this.emit('plugin:enabled', pluginId);
      return true;
    } catch (err) {
      plugin.state = 'error';
      plugin.error = err instanceof Error ? err.message : String(err);
      this.emit('plugin:error', pluginId, err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  async disable(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    const handler = this.handlers.get(pluginId);
    if (!plugin) return false;

    if (plugin.state === 'disabled') return true;

    try {
      if (handler?.onDisable) {
        await handler.onDisable();
      }
    } catch {
      // Ignore disable errors
    }

    plugin.state = 'disabled';
    this.emit('plugin:disabled', pluginId);
    return true;
  }

  // ─── Invocation ────────────────────────────────────────────────

  async invokeFrame(pluginId: string, frame: PluginFrame): Promise<PluginResponse | null> {
    const plugin = this.plugins.get(pluginId);
    const handler = this.handlers.get(pluginId);
    if (!plugin || !handler || plugin.state !== 'enabled') return null;
    if (!handler.onFrame) return null;

    // Check permission
    if (!this.hasPermission(pluginId, 'camera')) {
      this.emit('permission:denied', pluginId, 'camera');
      return null;
    }

    // Concurrency check
    if (this.concurrent >= this.config.maxConcurrent) return null;

    this.concurrent++;
    const startTime = Date.now();

    try {
      const api = this.createPluginAPI(pluginId);
      const response = await Promise.race([
        handler.onFrame(frame, api),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Plugin timeout')), this.config.pluginTimeout),
        ),
      ]);

      const responseTimeMs = Date.now() - startTime;
      this.updateStats(pluginId, responseTimeMs, false);
      this.consecutiveErrors.set(pluginId, 0);
      this.emit('plugin:invoked', pluginId, responseTimeMs);

      return response;
    } catch (err) {
      this.handlePluginError(pluginId, err);
      return null;
    } finally {
      this.concurrent--;
    }
  }

  async invokeVoiceCommand(
    pluginId: string,
    command: string,
    params: Record<string, unknown>,
  ): Promise<PluginResponse | null> {
    const plugin = this.plugins.get(pluginId);
    const handler = this.handlers.get(pluginId);
    if (!plugin || !handler || plugin.state !== 'enabled') return null;
    if (!handler.onVoiceCommand) return null;

    this.concurrent++;
    const startTime = Date.now();

    try {
      const api = this.createPluginAPI(pluginId);
      const response = await Promise.race([
        handler.onVoiceCommand(command, params, api),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Plugin timeout')), this.config.pluginTimeout),
        ),
      ]);

      const responseTimeMs = Date.now() - startTime;
      this.updateStats(pluginId, responseTimeMs, false);
      this.consecutiveErrors.set(pluginId, 0);

      return response;
    } catch (err) {
      this.handlePluginError(pluginId, err);
      return null;
    } finally {
      this.concurrent--;
    }
  }

  // ─── Permission Management ─────────────────────────────────────

  grantPermission(pluginId: string, permission: PluginPermission): boolean {
    const granted = this.grantedPermissions.get(pluginId);
    if (!granted) return false;

    granted.add(permission);
    this.emit('permission:granted', pluginId, permission);
    return true;
  }

  revokePermission(pluginId: string, permission: PluginPermission): boolean {
    const granted = this.grantedPermissions.get(pluginId);
    if (!granted) return false;

    granted.delete(permission);
    this.emit('permission:denied', pluginId, permission);
    return true;
  }

  hasPermission(pluginId: string, permission: PluginPermission): boolean {
    const granted = this.grantedPermissions.get(pluginId);
    return granted ? granted.has(permission) : false;
  }

  getPermissions(pluginId: string): PluginPermission[] {
    const granted = this.grantedPermissions.get(pluginId);
    return granted ? Array.from(granted) : [];
  }

  // ─── Configuration ─────────────────────────────────────────────

  setConfig(pluginId: string, config: Record<string, unknown>): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    // Validate against schema
    if (plugin.manifest.configSchema) {
      for (const field of plugin.manifest.configSchema) {
        if (field.required && !(field.name in config)) {
          return false;
        }
      }
    }

    plugin.config = { ...plugin.config, ...config };
    plugin.updatedAt = Date.now();

    // Notify handler
    const handler = this.handlers.get(pluginId);
    if (handler?.onConfigChange && plugin.state === 'enabled') {
      const api = this.createPluginAPI(pluginId);
      handler.onConfigChange(plugin.config, api).catch(() => {});
    }

    this.emit('plugin:config_changed', pluginId, plugin.config);
    return true;
  }

  getConfig(pluginId: string): Record<string, unknown> | null {
    const plugin = this.plugins.get(pluginId);
    return plugin ? { ...plugin.config } : null;
  }

  // ─── Query ─────────────────────────────────────────────────────

  getPlugin(pluginId: string): InstalledPlugin | undefined {
    const plugin = this.plugins.get(pluginId);
    return plugin ? { ...plugin } : undefined;
  }

  getPlugins(): InstalledPlugin[] {
    return Array.from(this.plugins.values()).map(p => ({ ...p }));
  }

  getEnabledPlugins(): InstalledPlugin[] {
    return this.getPlugins().filter(p => p.state === 'enabled');
  }

  getPluginsByCategory(category: PluginCategory): InstalledPlugin[] {
    return this.getPlugins().filter(p => p.manifest.category === category);
  }

  getPluginsForScene(sceneType: string): InstalledPlugin[] {
    return this.getEnabledPlugins().filter(p =>
      p.manifest.sceneTypes?.includes(sceneType),
    );
  }

  getPluginCount(): number {
    return this.plugins.size;
  }

  // ─── Stats ─────────────────────────────────────────────────────

  private updateStats(pluginId: string, responseTimeMs: number, isError: boolean): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    plugin.stats.invocations++;
    plugin.stats.totalProcessingMs += responseTimeMs;
    plugin.stats.avgResponseMs =
      plugin.stats.totalProcessingMs / plugin.stats.invocations;
    plugin.stats.lastInvoked = Date.now();

    if (isError) {
      plugin.stats.errors++;
    }
  }

  private handlePluginError(pluginId: string, err: unknown): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    this.updateStats(pluginId, 0, true);
    plugin.stats.lastError = err instanceof Error ? err.message : String(err);

    const consecutive = (this.consecutiveErrors.get(pluginId) || 0) + 1;
    this.consecutiveErrors.set(pluginId, consecutive);

    this.emit('plugin:error', pluginId, err instanceof Error ? err : new Error(String(err)));

    // Auto-disable on too many consecutive errors
    if (consecutive >= this.config.maxConsecutiveErrors) {
      plugin.state = 'error';
      plugin.error = `Auto-disabled after ${consecutive} consecutive errors: ${plugin.stats.lastError}`;
    }
  }

  // ─── Plugin API Factory ────────────────────────────────────────

  private createPluginAPI(pluginId: string): PluginAPI {
    const plugin = this.plugins.get(pluginId)!;
    const storagePrefix = `plugin:${pluginId}:`;
    const storage = new Map<string, unknown>();

    return {
      getCurrentFrame: async () => null,
      analyzeImage: async () => ({
        sceneType: 'unknown',
        objects: [],
        text: [],
        products: [],
      }),
      speak: async () => {},
      notify: async () => {},
      getLocation: async () => {
        if (!this.hasPermission(pluginId, 'gps')) return null;
        return null;
      },
      store: async (key, value) => {
        if (!this.hasPermission(pluginId, 'storage')) return;
        storage.set(storagePrefix + key, value);
      },
      retrieve: async (key) => {
        return storage.get(storagePrefix + key) ?? null;
      },
      deleteData: async (key) => {
        storage.delete(storagePrefix + key);
      },
      searchMemory: async () => {
        if (!this.hasPermission(pluginId, 'memory')) return [];
        return [];
      },
      getConfig: () => ({ ...plugin.config }),
      log: () => {},
      trackMetric: () => {},
      reportUsage: async () => {},
      invokeAgent: async () => null,
    };
  }

  private getDefaultConfig(manifest: PluginManifest): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    if (manifest.configSchema) {
      for (const field of manifest.configSchema) {
        if (field.default !== undefined) {
          config[field.name] = field.default;
        }
      }
    }
    return config;
  }

  // ─── Voice Summary ─────────────────────────────────────────────

  getVoiceSummary(): string {
    const total = this.plugins.size;
    const enabled = this.getEnabledPlugins().length;
    const errored = Array.from(this.plugins.values()).filter(p => p.state === 'error').length;

    const parts: string[] = [];
    parts.push(`${total} plugins installed, ${enabled} enabled.`);
    if (errored > 0) {
      parts.push(`${errored} plugins have errors.`);
    }

    // Most active plugin
    const sorted = Array.from(this.plugins.values())
      .sort((a, b) => b.stats.invocations - a.stats.invocations);
    if (sorted.length > 0 && sorted[0].stats.invocations > 0) {
      parts.push(`Most active: ${sorted[0].manifest.name} with ${sorted[0].stats.invocations} uses.`);
    }

    return parts.join(' ');
  }

  // ─── Marketplace Helpers ───────────────────────────────────────

  getMarketplaceInfo(pluginId: string): {
    manifest: PluginManifest;
    stats: PluginStats;
    permissionDetails: Array<{ permission: PluginPermission; label: string; description: string; risk: string }>;
    pricingDisplay: string;
  } | null {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return null;

    const permissionDetails = plugin.manifest.permissions.map(p => ({
      permission: p,
      ...PERMISSION_DESCRIPTIONS[p],
    }));

    let pricingDisplay = 'Free';
    if (plugin.manifest.pricing) {
      const p = plugin.manifest.pricing;
      switch (p.model) {
        case 'paid':
          pricingDisplay = `$${(p.price! / 100).toFixed(2)} one-time`;
          break;
        case 'subscription':
          pricingDisplay = `$${(p.price! / 100).toFixed(2)}/${p.interval}`;
          break;
        case 'freemium':
          pricingDisplay = 'Free with premium features';
          break;
        case 'pay_per_use':
          pricingDisplay = `$${(p.perUsePrice! / 100).toFixed(2)} per use`;
          break;
      }
    }

    return {
      manifest: plugin.manifest,
      stats: { ...plugin.stats },
      permissionDetails,
      pricingDisplay,
    };
  }
}
