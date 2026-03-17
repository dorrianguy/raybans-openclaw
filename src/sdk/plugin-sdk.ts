/**
 * Plugin SDK & Agent Registry
 * 
 * The foundation for the Vision App Store (Revenue Feature #13).
 * Third-party developers can build custom vision agents that plug
 * into the Ray-Bans × OpenClaw platform.
 * 
 * Architecture:
 * - AgentPlugin: base interface for all plugins
 * - PluginRegistry: manages lifecycle (register, enable, disable, uninstall)
 * - PluginSandbox: resource limits and permission enforcement
 * - PluginMarketplace: discovery, rating, revenue sharing
 * 
 * 🌙 Night Shift Agent — 2026-03-16
 */

import { EventEmitter } from 'events';

// ──── Plugin Types ────

export type PluginStatus = 'installed' | 'enabled' | 'disabled' | 'errored' | 'updating';

export type PluginCategory =
  | 'inventory'
  | 'inspection'
  | 'security'
  | 'productivity'
  | 'health'
  | 'navigation'
  | 'education'
  | 'entertainment'
  | 'accessibility'
  | 'industrial'
  | 'agriculture'
  | 'custom';

export type PluginPermission =
  | 'camera:read'           // Access camera captures
  | 'camera:control'        // Trigger camera snaps
  | 'microphone:read'       // Access voice input
  | 'tts:speak'             // Deliver TTS responses
  | 'location:read'         // Access GPS data
  | 'storage:read'          // Read persistent storage
  | 'storage:write'         // Write to persistent storage
  | 'network:outbound'      // Make external HTTP calls
  | 'notification:send'     // Push notifications
  | 'analytics:write'       // Track analytics events
  | 'user:profile'          // Read user profile info
  | 'billing:usage'         // Report usage for billing
  | 'chain:register'        // Register in context chains
  | 'voice:commands'        // Register voice commands
  | 'device:sensors';       // Access device sensors (accelerometer, etc.)

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: PluginAuthor;
  category: PluginCategory;
  permissions: PluginPermission[];
  icon?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  minPlatformVersion?: string;
  maxPlatformVersion?: string;
  pricing?: PluginPricing;
  tags?: string[];
  screenshots?: string[];
  readme?: string;
}

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
  verified?: boolean;
}

export interface PluginPricing {
  model: 'free' | 'one_time' | 'subscription' | 'usage' | 'freemium';
  price?: number;         // In cents (for one_time or subscription)
  currency?: string;      // Default: 'usd'
  interval?: 'monthly' | 'yearly';
  usageRate?: number;     // Per-use price in cents
  trialDays?: number;
  revenueSplit?: number;  // Platform percentage (default: 30%)
}

export interface PluginResourceLimits {
  maxMemoryMB: number;          // Max memory usage
  maxCpuTimeMs: number;         // Max CPU time per invocation
  maxStorageBytes: number;      // Max persistent storage
  maxNetworkRequestsPerMin: number;
  maxTtsPerMin: number;
  maxCameraSnapsPerMin: number;
  maxInvocationsPerHour: number;
  timeoutMs: number;            // Per-invocation timeout
}

export const DEFAULT_RESOURCE_LIMITS: PluginResourceLimits = {
  maxMemoryMB: 64,
  maxCpuTimeMs: 5000,
  maxStorageBytes: 50 * 1024 * 1024, // 50MB
  maxNetworkRequestsPerMin: 30,
  maxTtsPerMin: 6,
  maxCameraSnapsPerMin: 10,
  maxInvocationsPerHour: 500,
  timeoutMs: 10000,
};

// ──── Plugin Interface ────

export interface PluginContext {
  pluginId: string;
  storage: PluginStorage;
  logger: PluginLogger;
  permissions: Set<PluginPermission>;
  resourceUsage: ResourceUsageTracker;
}

export interface PluginStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  clear(): Promise<void>;
  getUsedBytes(): number;
}

export interface PluginLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface ResourceUsageTracker {
  memoryUsedMB: number;
  cpuTimeUsedMs: number;
  networkRequestsThisMin: number;
  ttsThisMin: number;
  cameraSnapsThisMin: number;
  invocationsThisHour: number;
  storageUsedBytes: number;
}

export interface AgentPlugin {
  manifest: PluginManifest;
  
  /** Called when plugin is first installed */
  onInstall?(ctx: PluginContext): Promise<void>;
  
  /** Called when plugin is enabled */
  onEnable?(ctx: PluginContext): Promise<void>;
  
  /** Called when plugin is disabled */
  onDisable?(ctx: PluginContext): Promise<void>;
  
  /** Called when plugin is uninstalled */
  onUninstall?(ctx: PluginContext): Promise<void>;
  
  /** Process a captured image */
  processImage?(ctx: PluginContext, image: PluginImageInput): Promise<PluginResponse>;
  
  /** Process a voice command */
  processVoice?(ctx: PluginContext, command: PluginVoiceInput): Promise<PluginResponse>;
  
  /** Handle a custom event */
  handleEvent?(ctx: PluginContext, event: PluginEvent): Promise<PluginResponse>;
  
  /** Return voice commands this plugin handles */
  getVoiceCommands?(): PluginVoiceCommand[];
  
  /** Return scene types this plugin is interested in */
  getSceneTypes?(): string[];
  
  /** Health check */
  healthCheck?(ctx: PluginContext): Promise<boolean>;
}

export interface PluginImageInput {
  imageBuffer: Buffer;
  analysis?: {
    sceneType?: string;
    objects?: Array<{ label: string; confidence: number }>;
    text?: string[];
    barcodes?: Array<{ data: string; format: string }>;
  };
  location?: { latitude: number; longitude: number };
  timestamp: number;
}

export interface PluginVoiceInput {
  text: string;
  intent?: string;
  parameters?: Record<string, string>;
  timestamp: number;
}

export interface PluginEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface PluginVoiceCommand {
  intent: string;
  patterns: string[];
  description: string;
  examples: string[];
}

export interface PluginResponse {
  success: boolean;
  ttsMessage?: string;
  dashboardData?: Record<string, unknown>;
  notifications?: Array<{
    title: string;
    body: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
  }>;
  metadata?: Record<string, unknown>;
  error?: string;
}

// ──── Plugin Registry ────

export interface PluginRegistryConfig {
  maxPlugins: number;
  resourceLimits: PluginResourceLimits;
  autoEnableOnInstall: boolean;
  allowUntrustedPlugins: boolean;
  marketplaceUrl?: string;
}

export const DEFAULT_REGISTRY_CONFIG: PluginRegistryConfig = {
  maxPlugins: 50,
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
  autoEnableOnInstall: false,
  allowUntrustedPlugins: false,
  marketplaceUrl: 'https://marketplace.openclaw.ai',
};

export interface PluginRegistryEvents {
  'plugin:installed': (pluginId: string, manifest: PluginManifest) => void;
  'plugin:enabled': (pluginId: string) => void;
  'plugin:disabled': (pluginId: string) => void;
  'plugin:uninstalled': (pluginId: string) => void;
  'plugin:error': (pluginId: string, error: Error) => void;
  'plugin:invoked': (pluginId: string, method: string, durationMs: number) => void;
  'plugin:resource_limit': (pluginId: string, resource: string, current: number, limit: number) => void;
  'plugin:permission_denied': (pluginId: string, permission: PluginPermission) => void;
}

interface InstalledPlugin {
  plugin: AgentPlugin;
  status: PluginStatus;
  installedAt: number;
  enabledAt?: number;
  lastInvokedAt?: number;
  errorCount: number;
  lastError?: string;
  invocationCount: number;
  totalProcessingMs: number;
  resourceUsage: ResourceUsageTracker;
  storage: InMemoryPluginStorage;
}

// ──── In-Memory Plugin Storage ────

class InMemoryPluginStorage implements PluginStorage {
  private data: Map<string, string> = new Map();
  private maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    // Check storage limit
    const currentSize = this.getUsedBytes();
    const newEntrySize = key.length + value.length;
    const existingSize = this.data.has(key) 
      ? key.length + (this.data.get(key)?.length ?? 0) 
      : 0;
    
    if (currentSize - existingSize + newEntrySize > this.maxBytes) {
      throw new Error(`Storage limit exceeded: ${this.maxBytes} bytes`);
    }
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.data.keys());
    if (!prefix) return keys;
    return keys.filter(k => k.startsWith(prefix));
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  getUsedBytes(): number {
    let total = 0;
    for (const [k, v] of this.data) {
      total += k.length + v.length;
    }
    return total;
  }
}

// ──── Plugin Logger ────

class ScopedPluginLogger implements PluginLogger {
  private pluginId: string;
  private logs: Array<{ level: string; message: string; timestamp: number; data?: Record<string, unknown> }> = [];
  private maxLogs = 1000;

  constructor(pluginId: string) {
    this.pluginId = pluginId;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.append('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.append('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.append('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.append('error', message, data);
  }

  getLogs() {
    return [...this.logs];
  }

  private append(level: string, message: string, data?: Record<string, unknown>) {
    this.logs.push({ level, message, timestamp: Date.now(), data });
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-Math.floor(this.maxLogs * 0.75));
    }
  }
}

// ──── Plugin Registry Implementation ────

export class PluginRegistry extends EventEmitter {
  private config: PluginRegistryConfig;
  private plugins: Map<string, InstalledPlugin> = new Map();
  private loggers: Map<string, ScopedPluginLogger> = new Map();
  private permissionGrants: Map<string, Set<PluginPermission>> = new Map();

  constructor(config: Partial<PluginRegistryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
  }

  // ── Install / Uninstall ──

  async install(plugin: AgentPlugin): Promise<void> {
    const { id } = plugin.manifest;

    if (this.plugins.has(id)) {
      throw new Error(`Plugin "${id}" is already installed`);
    }

    if (this.plugins.size >= this.config.maxPlugins) {
      throw new Error(`Maximum number of plugins reached (${this.config.maxPlugins})`);
    }

    // Validate manifest
    this.validateManifest(plugin.manifest);

    // Check trust
    if (!this.config.allowUntrustedPlugins && !plugin.manifest.author.verified) {
      throw new Error(`Untrusted plugin "${id}": author not verified`);
    }

    const storage = new InMemoryPluginStorage(this.config.resourceLimits.maxStorageBytes);
    const logger = new ScopedPluginLogger(id);
    this.loggers.set(id, logger);

    const installed: InstalledPlugin = {
      plugin,
      status: 'installed',
      installedAt: Date.now(),
      errorCount: 0,
      invocationCount: 0,
      totalProcessingMs: 0,
      resourceUsage: this.createResourceTracker(),
      storage,
    };

    this.plugins.set(id, installed);
    this.permissionGrants.set(id, new Set(plugin.manifest.permissions));

    // Run onInstall hook
    if (plugin.onInstall) {
      try {
        const ctx = this.createContext(id);
        await plugin.onInstall(ctx);
      } catch (err) {
        installed.status = 'errored';
        installed.lastError = (err as Error).message;
        installed.errorCount++;
        this.emit('plugin:error', id, err as Error);
      }
    }

    this.emit('plugin:installed', id, plugin.manifest);

    // Auto-enable if configured
    if (this.config.autoEnableOnInstall && installed.status !== 'errored') {
      await this.enable(id);
    }
  }

  async uninstall(pluginId: string): Promise<void> {
    const installed = this.plugins.get(pluginId);
    if (!installed) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    // Disable first if enabled
    if (installed.status === 'enabled') {
      await this.disable(pluginId);
    }

    // Run onUninstall hook
    if (installed.plugin.onUninstall) {
      try {
        const ctx = this.createContext(pluginId);
        await installed.plugin.onUninstall(ctx);
      } catch (err) {
        this.emit('plugin:error', pluginId, err as Error);
      }
    }

    // Clean up storage
    await installed.storage.clear();

    this.plugins.delete(pluginId);
    this.loggers.delete(pluginId);
    this.permissionGrants.delete(pluginId);

    this.emit('plugin:uninstalled', pluginId);
  }

  // ── Enable / Disable ──

  async enable(pluginId: string): Promise<void> {
    const installed = this.plugins.get(pluginId);
    if (!installed) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    if (installed.status === 'enabled') {
      return; // Already enabled
    }

    if (installed.plugin.onEnable) {
      try {
        const ctx = this.createContext(pluginId);
        await installed.plugin.onEnable(ctx);
      } catch (err) {
        installed.status = 'errored';
        installed.lastError = (err as Error).message;
        installed.errorCount++;
        this.emit('plugin:error', pluginId, err as Error);
        throw err;
      }
    }

    installed.status = 'enabled';
    installed.enabledAt = Date.now();
    this.emit('plugin:enabled', pluginId);
  }

  async disable(pluginId: string): Promise<void> {
    const installed = this.plugins.get(pluginId);
    if (!installed) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    if (installed.status === 'disabled' || installed.status === 'installed') {
      return; // Already not active
    }

    if (installed.plugin.onDisable) {
      try {
        const ctx = this.createContext(pluginId);
        await installed.plugin.onDisable(ctx);
      } catch (err) {
        this.emit('plugin:error', pluginId, err as Error);
      }
    }

    installed.status = 'disabled';
    this.emit('plugin:disabled', pluginId);
  }

  // ── Invoke Plugins ──

  async processImage(image: PluginImageInput): Promise<Map<string, PluginResponse>> {
    const results = new Map<string, PluginResponse>();

    for (const [id, installed] of this.plugins) {
      if (installed.status !== 'enabled') continue;
      if (!installed.plugin.processImage) continue;

      // Check if plugin cares about this scene type
      if (image.analysis?.sceneType && installed.plugin.getSceneTypes) {
        const sceneTypes = installed.plugin.getSceneTypes();
        if (sceneTypes.length > 0 && !sceneTypes.includes(image.analysis.sceneType)) {
          continue;
        }
      }

      // Check resource limits
      if (!this.checkResourceLimits(id, 'invocation')) continue;

      const startTime = Date.now();
      try {
        const ctx = this.createContext(id);
        const response = await this.executeWithTimeout(
          () => installed.plugin.processImage!(ctx, image),
          this.config.resourceLimits.timeoutMs,
        );
        const duration = Date.now() - startTime;

        installed.invocationCount++;
        installed.totalProcessingMs += duration;
        installed.lastInvokedAt = Date.now();
        installed.resourceUsage.invocationsThisHour++;
        installed.resourceUsage.cpuTimeUsedMs += duration;

        results.set(id, response);
        this.emit('plugin:invoked', id, 'processImage', duration);
      } catch (err) {
        const duration = Date.now() - startTime;
        installed.invocationCount++;
        installed.errorCount++;
        installed.lastError = (err as Error).message;
        installed.totalProcessingMs += duration;
        installed.resourceUsage.invocationsThisHour++;

        results.set(id, {
          success: false,
          error: (err as Error).message,
        });
        this.emit('plugin:error', id, err as Error);

        // Auto-disable after 10 consecutive errors
        if (installed.errorCount >= 10) {
          installed.status = 'errored';
          this.emit('plugin:disabled', id);
        }
      }
    }

    return results;
  }

  async processVoice(input: PluginVoiceInput): Promise<Map<string, PluginResponse>> {
    const results = new Map<string, PluginResponse>();

    for (const [id, installed] of this.plugins) {
      if (installed.status !== 'enabled') continue;
      if (!installed.plugin.processVoice) continue;

      // Check if plugin handles this intent
      if (input.intent && installed.plugin.getVoiceCommands) {
        const commands = installed.plugin.getVoiceCommands();
        const handlesIntent = commands.some(c => c.intent === input.intent);
        if (!handlesIntent) continue;
      }

      if (!this.checkResourceLimits(id, 'invocation')) continue;

      const startTime = Date.now();
      try {
        const ctx = this.createContext(id);
        const response = await this.executeWithTimeout(
          () => installed.plugin.processVoice!(ctx, input),
          this.config.resourceLimits.timeoutMs,
        );
        const duration = Date.now() - startTime;

        installed.invocationCount++;
        installed.totalProcessingMs += duration;
        installed.lastInvokedAt = Date.now();
        installed.resourceUsage.invocationsThisHour++;

        results.set(id, response);
        this.emit('plugin:invoked', id, 'processVoice', duration);
      } catch (err) {
        installed.errorCount++;
        installed.lastError = (err as Error).message;
        results.set(id, { success: false, error: (err as Error).message });
        this.emit('plugin:error', id, err as Error);
      }
    }

    return results;
  }

  async dispatchEvent(event: PluginEvent): Promise<Map<string, PluginResponse>> {
    const results = new Map<string, PluginResponse>();

    for (const [id, installed] of this.plugins) {
      if (installed.status !== 'enabled') continue;
      if (!installed.plugin.handleEvent) continue;
      if (!this.checkResourceLimits(id, 'invocation')) continue;

      const startTime = Date.now();
      try {
        const ctx = this.createContext(id);
        const response = await this.executeWithTimeout(
          () => installed.plugin.handleEvent!(ctx, event),
          this.config.resourceLimits.timeoutMs,
        );
        const duration = Date.now() - startTime;

        installed.invocationCount++;
        installed.totalProcessingMs += duration;
        installed.lastInvokedAt = Date.now();
        installed.resourceUsage.invocationsThisHour++;

        results.set(id, response);
        this.emit('plugin:invoked', id, 'handleEvent', duration);
      } catch (err) {
        installed.errorCount++;
        installed.lastError = (err as Error).message;
        results.set(id, { success: false, error: (err as Error).message });
        this.emit('plugin:error', id, err as Error);
      }
    }

    return results;
  }

  // ── Query ──

  getPlugin(pluginId: string): AgentPlugin | undefined {
    return this.plugins.get(pluginId)?.plugin;
  }

  getPluginStatus(pluginId: string): PluginStatus | undefined {
    return this.plugins.get(pluginId)?.status;
  }

  getPluginInfo(pluginId: string): PluginInfo | undefined {
    const installed = this.plugins.get(pluginId);
    if (!installed) return undefined;

    return {
      manifest: installed.plugin.manifest,
      status: installed.status,
      installedAt: installed.installedAt,
      enabledAt: installed.enabledAt,
      lastInvokedAt: installed.lastInvokedAt,
      errorCount: installed.errorCount,
      lastError: installed.lastError,
      invocationCount: installed.invocationCount,
      avgProcessingMs: installed.invocationCount > 0
        ? Math.round(installed.totalProcessingMs / installed.invocationCount)
        : 0,
      storageUsedBytes: installed.storage.getUsedBytes(),
    };
  }

  listPlugins(filter?: { status?: PluginStatus; category?: PluginCategory }): PluginInfo[] {
    const result: PluginInfo[] = [];

    for (const [, installed] of this.plugins) {
      if (filter?.status && installed.status !== filter.status) continue;
      if (filter?.category && installed.plugin.manifest.category !== filter.category) continue;

      const info = this.getPluginInfo(installed.plugin.manifest.id);
      if (info) result.push(info);
    }

    return result;
  }

  getEnabledPlugins(): AgentPlugin[] {
    const result: AgentPlugin[] = [];
    for (const [, installed] of this.plugins) {
      if (installed.status === 'enabled') {
        result.push(installed.plugin);
      }
    }
    return result;
  }

  getAllVoiceCommands(): Array<{ pluginId: string; command: PluginVoiceCommand }> {
    const commands: Array<{ pluginId: string; command: PluginVoiceCommand }> = [];

    for (const [id, installed] of this.plugins) {
      if (installed.status !== 'enabled') continue;
      if (!installed.plugin.getVoiceCommands) continue;

      for (const cmd of installed.plugin.getVoiceCommands()) {
        commands.push({ pluginId: id, command: cmd });
      }
    }

    return commands;
  }

  getPluginCount(): number {
    return this.plugins.size;
  }

  getPluginLogs(pluginId: string): Array<{ level: string; message: string; timestamp: number }> {
    const logger = this.loggers.get(pluginId);
    return logger?.getLogs() ?? [];
  }

  // ── Permission Management ──

  grantPermission(pluginId: string, permission: PluginPermission): void {
    const grants = this.permissionGrants.get(pluginId);
    if (!grants) throw new Error(`Plugin "${pluginId}" is not installed`);
    grants.add(permission);
  }

  revokePermission(pluginId: string, permission: PluginPermission): void {
    const grants = this.permissionGrants.get(pluginId);
    if (!grants) throw new Error(`Plugin "${pluginId}" is not installed`);
    grants.delete(permission);
  }

  hasPermission(pluginId: string, permission: PluginPermission): boolean {
    const grants = this.permissionGrants.get(pluginId);
    return grants?.has(permission) ?? false;
  }

  getPermissions(pluginId: string): PluginPermission[] {
    const grants = this.permissionGrants.get(pluginId);
    return grants ? Array.from(grants) : [];
  }

  // ── Health ──

  async healthCheck(pluginId: string): Promise<boolean> {
    const installed = this.plugins.get(pluginId);
    if (!installed) return false;
    if (!installed.plugin.healthCheck) return installed.status === 'enabled';

    try {
      const ctx = this.createContext(pluginId);
      return await installed.plugin.healthCheck(ctx);
    } catch {
      return false;
    }
  }

  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const [id] of this.plugins) {
      results.set(id, await this.healthCheck(id));
    }
    return results;
  }

  // ── Stats ──

  getStats(): PluginRegistryStats {
    let totalInvocations = 0;
    let totalErrors = 0;
    let totalProcessingMs = 0;
    let enabledCount = 0;

    for (const [, installed] of this.plugins) {
      totalInvocations += installed.invocationCount;
      totalErrors += installed.errorCount;
      totalProcessingMs += installed.totalProcessingMs;
      if (installed.status === 'enabled') enabledCount++;
    }

    return {
      totalPlugins: this.plugins.size,
      enabledPlugins: enabledCount,
      totalInvocations,
      totalErrors,
      totalProcessingMs,
      avgProcessingMs: totalInvocations > 0 ? Math.round(totalProcessingMs / totalInvocations) : 0,
      errorRate: totalInvocations > 0 ? totalErrors / totalInvocations : 0,
    };
  }

  getVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];
    parts.push(`${stats.totalPlugins} plugins installed, ${stats.enabledPlugins} active.`);
    if (stats.totalInvocations > 0) {
      parts.push(`${stats.totalInvocations} total invocations, average ${stats.avgProcessingMs}ms.`);
    }
    if (stats.totalErrors > 0) {
      parts.push(`${stats.totalErrors} errors, ${(stats.errorRate * 100).toFixed(1)}% error rate.`);
    }
    return parts.join(' ');
  }

  // ── Reset ──

  resetResourceCounters(): void {
    for (const [, installed] of this.plugins) {
      installed.resourceUsage = this.createResourceTracker();
    }
  }

  // ── Private Helpers ──

  private validateManifest(manifest: PluginManifest): void {
    if (!manifest.id || typeof manifest.id !== 'string') {
      throw new Error('Plugin manifest must have a valid id');
    }
    if (!/^[a-z0-9-_]+$/i.test(manifest.id)) {
      throw new Error('Plugin id must contain only alphanumeric characters, hyphens, and underscores');
    }
    if (!manifest.name || typeof manifest.name !== 'string') {
      throw new Error('Plugin manifest must have a valid name');
    }
    if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      throw new Error('Plugin manifest must have a valid semver version');
    }
    if (!manifest.description || typeof manifest.description !== 'string') {
      throw new Error('Plugin manifest must have a description');
    }
    if (!manifest.author || !manifest.author.name) {
      throw new Error('Plugin manifest must have an author with a name');
    }
    if (!manifest.permissions || !Array.isArray(manifest.permissions)) {
      throw new Error('Plugin manifest must declare permissions array');
    }
  }

  private createContext(pluginId: string): PluginContext {
    const installed = this.plugins.get(pluginId)!;
    const logger = this.loggers.get(pluginId)!;
    const permissions = this.permissionGrants.get(pluginId)!;

    return {
      pluginId,
      storage: installed.storage,
      logger,
      permissions,
      resourceUsage: { ...installed.resourceUsage },
    };
  }

  private createResourceTracker(): ResourceUsageTracker {
    return {
      memoryUsedMB: 0,
      cpuTimeUsedMs: 0,
      networkRequestsThisMin: 0,
      ttsThisMin: 0,
      cameraSnapsThisMin: 0,
      invocationsThisHour: 0,
      storageUsedBytes: 0,
    };
  }

  private checkResourceLimits(pluginId: string, resource: string): boolean {
    const installed = this.plugins.get(pluginId);
    if (!installed) return false;

    const limits = this.config.resourceLimits;
    const usage = installed.resourceUsage;

    if (resource === 'invocation' && usage.invocationsThisHour >= limits.maxInvocationsPerHour) {
      this.emit('plugin:resource_limit', pluginId, 'invocationsPerHour', usage.invocationsThisHour, limits.maxInvocationsPerHour);
      return false;
    }

    if (resource === 'tts' && usage.ttsThisMin >= limits.maxTtsPerMin) {
      this.emit('plugin:resource_limit', pluginId, 'ttsPerMin', usage.ttsThisMin, limits.maxTtsPerMin);
      return false;
    }

    if (resource === 'camera' && usage.cameraSnapsThisMin >= limits.maxCameraSnapsPerMin) {
      this.emit('plugin:resource_limit', pluginId, 'cameraSnapsPerMin', usage.cameraSnapsThisMin, limits.maxCameraSnapsPerMin);
      return false;
    }

    return true;
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Plugin execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      fn().then(
        (result) => { clearTimeout(timer); resolve(result); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  }
}

// ──── Marketplace Types ────

export interface PluginInfo {
  manifest: PluginManifest;
  status: PluginStatus;
  installedAt: number;
  enabledAt?: number;
  lastInvokedAt?: number;
  errorCount: number;
  lastError?: string;
  invocationCount: number;
  avgProcessingMs: number;
  storageUsedBytes: number;
}

export interface PluginRegistryStats {
  totalPlugins: number;
  enabledPlugins: number;
  totalInvocations: number;
  totalErrors: number;
  totalProcessingMs: number;
  avgProcessingMs: number;
  errorRate: number;
}

export interface MarketplaceListing {
  manifest: PluginManifest;
  rating: number;          // 0-5 stars
  reviewCount: number;
  downloadCount: number;
  featured: boolean;
  trending: boolean;
  publishedAt: number;
  updatedAt: number;
  verified: boolean;
  badges: string[];
}
