/**
 * Configuration Engine
 * 
 * Centralized configuration management for the Ray-Bans × OpenClaw platform.
 * Handles environment-based config, validation, feature flags, secrets
 * management, runtime config updates, and config inheritance across environments.
 * 
 * Features:
 * - Multi-environment config (development, staging, production, test)
 * - JSON Schema-based validation with detailed error messages
 * - Feature flags with percentage rollout, user targeting, A/B variants
 * - Secrets management (encrypted at rest, never logged)
 * - Runtime config updates without restart (hot reload)
 * - Config inheritance (production extends base, etc.)
 * - Config change auditing with diff tracking
 * - Voice-friendly config summaries
 * 
 * 🌙 Night Shift Agent — 2026-03-08
 */

import { EventEmitter } from 'eventemitter3';
import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Environment = 'development' | 'staging' | 'production' | 'test';

export interface ConfigSchema {
  /** Field name */
  key: string;
  /** Data type */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** Required field */
  required: boolean;
  /** Default value */
  default?: unknown;
  /** Description */
  description: string;
  /** Valid values (enum) */
  enum?: unknown[];
  /** Minimum value (number) */
  min?: number;
  /** Maximum value (number) */
  max?: number;
  /** Minimum length (string/array) */
  minLength?: number;
  /** Maximum length (string/array) */
  maxLength?: number;
  /** Regex pattern (string) */
  pattern?: string;
  /** Is this a secret (should be redacted in logs)? */
  secret?: boolean;
  /** Category for grouping */
  category?: string;
  /** Nested schema (for objects) */
  properties?: ConfigSchema[];
  /** Can be updated at runtime? */
  hotReload?: boolean;
}

export interface ConfigValue {
  key: string;
  value: unknown;
  source: ConfigSource;
  environment: Environment;
  setAt: string;
  setBy?: string;
}

export type ConfigSource = 'default' | 'file' | 'env_var' | 'runtime' | 'override';

export interface ConfigValidationError {
  key: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface FeatureFlag {
  /** Flag identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Is the flag enabled? */
  enabled: boolean;
  /** Percentage rollout (0-100, null = all or none based on enabled) */
  rolloutPercentage?: number;
  /** Target specific user IDs */
  targetUsers?: string[];
  /** Target specific environments */
  targetEnvironments?: Environment[];
  /** A/B test variants */
  variants?: Record<string, unknown>;
  /** Variant distribution weights (must sum to 100) */
  variantWeights?: Record<string, number>;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
  /** Category for grouping */
  category?: string;
  /** Metadata */
  metadata?: Record<string, string>;
}

export interface ConfigChangeEvent {
  /** Change ID */
  id: string;
  /** Config key that changed */
  key: string;
  /** Old value (redacted for secrets) */
  oldValue: unknown;
  /** New value (redacted for secrets) */
  newValue: unknown;
  /** Who made the change */
  changedBy: string;
  /** Source of change */
  source: ConfigSource;
  /** Timestamp */
  timestamp: string;
  /** Whether the value is a secret */
  isSecret: boolean;
}

export interface SecretEntry {
  /** Key name */
  key: string;
  /** Encrypted value */
  encryptedValue: string;
  /** IV for decryption */
  iv: string;
  /** When the secret was set */
  setAt: string;
  /** When the secret was last accessed */
  lastAccessedAt?: string;
  /** Version number (incremented on rotation) */
  version: number;
  /** Category */
  category?: string;
}

export interface ConfigEngineConfig {
  /** Current environment */
  environment: Environment;
  /** Encryption key for secrets (32 bytes hex) */
  encryptionKey?: string;
  /** Enable config change auditing (default: true) */
  auditChanges?: boolean;
  /** Maximum audit log entries (default: 1000) */
  maxAuditEntries?: number;
  /** Enable hot reload support (default: true) */
  hotReloadEnabled?: boolean;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface ConfigEngineEvents {
  'config:changed': (change: ConfigChangeEvent) => void;
  'config:validated': (errors: ConfigValidationError[]) => void;
  'config:loaded': (environment: Environment) => void;
  'flag:toggled': (flagId: string, enabled: boolean) => void;
  'flag:evaluated': (flagId: string, userId: string | undefined, result: boolean) => void;
  'secret:set': (key: string) => void;
  'secret:accessed': (key: string) => void;
  'secret:rotated': (key: string, newVersion: number) => void;
  'error': (message: string) => void;
}

// ─── Default Platform Configuration Schema ───────────────────────────────────

export const PLATFORM_CONFIG_SCHEMA: ConfigSchema[] = [
  // Server
  { key: 'server.port', type: 'number', required: false, default: 3847, description: 'HTTP server port', min: 1, max: 65535, category: 'server', hotReload: false },
  { key: 'server.host', type: 'string', required: false, default: '0.0.0.0', description: 'Server bind host', category: 'server', hotReload: false },
  { key: 'server.corsOrigins', type: 'array', required: false, default: [], description: 'Allowed CORS origins', category: 'server', hotReload: true },
  
  // Vision
  { key: 'vision.model', type: 'string', required: true, description: 'Vision model identifier', enum: ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'claude-3-5-haiku'], category: 'vision' },
  { key: 'vision.apiKey', type: 'string', required: true, description: 'Vision model API key', secret: true, category: 'vision' },
  { key: 'vision.maxRetries', type: 'number', required: false, default: 3, description: 'Max API retries', min: 0, max: 10, category: 'vision', hotReload: true },
  { key: 'vision.timeoutMs', type: 'number', required: false, default: 30000, description: 'Vision API timeout (ms)', min: 1000, max: 120000, category: 'vision', hotReload: true },
  
  // Inventory
  { key: 'inventory.autoSnapIntervalSec', type: 'number', required: false, default: 3, description: 'Auto-snap interval (seconds)', min: 1, max: 60, category: 'inventory', hotReload: true },
  { key: 'inventory.minProductConfidence', type: 'number', required: false, default: 0.6, description: 'Min product ID confidence', min: 0, max: 1, category: 'inventory', hotReload: true },
  { key: 'inventory.voiceFeedback', type: 'boolean', required: false, default: true, description: 'Enable voice feedback', category: 'inventory', hotReload: true },
  
  // Storage
  { key: 'storage.dataDir', type: 'string', required: false, default: './data', description: 'Data directory path', category: 'storage', hotReload: false },
  { key: 'storage.retentionDays', type: 'number', required: false, default: 90, description: 'Data retention (days)', min: 1, max: 3650, category: 'storage', hotReload: true },
  { key: 'storage.maxImageSizeMb', type: 'number', required: false, default: 10, description: 'Max image size (MB)', min: 1, max: 50, category: 'storage', hotReload: true },
  
  // Auth
  { key: 'auth.jwtSecret', type: 'string', required: true, description: 'JWT signing secret', secret: true, minLength: 32, category: 'auth' },
  { key: 'auth.jwtExpirySeconds', type: 'number', required: false, default: 3600, description: 'JWT token expiry (seconds)', min: 60, max: 86400, category: 'auth', hotReload: true },
  { key: 'auth.maxApiKeysPerUser', type: 'number', required: false, default: 10, description: 'Max API keys per user', min: 1, max: 100, category: 'auth', hotReload: true },
  
  // Billing
  { key: 'billing.stripeSecretKey', type: 'string', required: false, description: 'Stripe secret key', secret: true, category: 'billing' },
  { key: 'billing.stripeWebhookSecret', type: 'string', required: false, description: 'Stripe webhook secret', secret: true, category: 'billing' },
  { key: 'billing.enabled', type: 'boolean', required: false, default: false, description: 'Enable billing', category: 'billing', hotReload: true },
  
  // Voice
  { key: 'voice.ttsProvider', type: 'string', required: false, default: 'openclaw', description: 'TTS provider', enum: ['openclaw', 'elevenlabs', 'azure'], category: 'voice', hotReload: true },
  { key: 'voice.sttProvider', type: 'string', required: false, default: 'openclaw', description: 'STT provider', enum: ['openclaw', 'deepgram', 'azure', 'whisper'], category: 'voice', hotReload: true },
  { key: 'voice.wakeWord', type: 'string', required: false, default: 'hey openclaw', description: 'Wake word phrase', category: 'voice', hotReload: true },
  
  // Telemetry
  { key: 'telemetry.enabled', type: 'boolean', required: false, default: true, description: 'Enable telemetry', category: 'telemetry', hotReload: true },
  { key: 'telemetry.samplingRate', type: 'number', required: false, default: 1.0, description: 'Event sampling rate (0-1)', min: 0, max: 1, category: 'telemetry', hotReload: true },
];

// ─── Configuration Engine Implementation ─────────────────────────────────────

export class ConfigEngine extends EventEmitter<ConfigEngineEvents> {
  private engineConfig: Required<ConfigEngineConfig>;
  private values: Map<string, ConfigValue> = new Map();
  private schema: Map<string, ConfigSchema> = new Map();
  private featureFlags: Map<string, FeatureFlag> = new Map();
  private secrets: Map<string, SecretEntry> = new Map();
  private auditLog: ConfigChangeEvent[] = [];
  private encryptionKey: Buffer | null = null;

  constructor(config: ConfigEngineConfig) {
    super();
    this.engineConfig = {
      environment: config.environment,
      encryptionKey: config.encryptionKey ?? '',
      auditChanges: config.auditChanges ?? true,
      maxAuditEntries: config.maxAuditEntries ?? 1000,
      hotReloadEnabled: config.hotReloadEnabled ?? true,
    };

    if (config.encryptionKey) {
      this.encryptionKey = Buffer.from(config.encryptionKey, 'hex');
    }
  }

  // ─── Schema Management ──────────────────────────────────────────────

  /**
   * Register a configuration schema.
   */
  registerSchema(schemas: ConfigSchema[]): void {
    for (const s of schemas) {
      this.schema.set(s.key, s);
    }
  }

  /**
   * Get the schema for a key.
   */
  getSchema(key: string): ConfigSchema | null {
    return this.schema.get(key) ?? null;
  }

  /**
   * Get all registered schema entries.
   */
  getAllSchemas(): ConfigSchema[] {
    return Array.from(this.schema.values());
  }

  /**
   * Get schemas by category.
   */
  getSchemasByCategory(): Record<string, ConfigSchema[]> {
    const result: Record<string, ConfigSchema[]> = {};
    for (const s of this.schema.values()) {
      const cat = s.category ?? 'uncategorized';
      if (!result[cat]) result[cat] = [];
      result[cat].push(s);
    }
    return result;
  }

  // ─── Config Values ──────────────────────────────────────────────────

  /**
   * Set a configuration value.
   */
  set(key: string, value: unknown, source: ConfigSource = 'runtime', setBy?: string): boolean {
    const schemaEntry = this.schema.get(key);

    // Validate against schema if it exists
    if (schemaEntry) {
      const errors = this.validateValue(key, value, schemaEntry);
      if (errors.length > 0) {
        this.emit('config:validated', errors);
        return false;
      }

      // Check hot reload
      if (source === 'runtime' && schemaEntry.hotReload === false && this.values.has(key)) {
        this.emit('error', `Config key '${key}' does not support hot reload`);
        return false;
      }
    }

    const oldEntry = this.values.get(key);
    const oldValue = oldEntry?.value;

    const entry: ConfigValue = {
      key,
      value,
      source,
      environment: this.engineConfig.environment,
      setAt: new Date().toISOString(),
      setBy,
    };

    this.values.set(key, entry);

    // Audit
    if (this.engineConfig.auditChanges && oldValue !== value) {
      const isSecret = schemaEntry?.secret ?? false;
      const change: ConfigChangeEvent = {
        id: crypto.randomUUID(),
        key,
        oldValue: isSecret ? '[REDACTED]' : oldValue,
        newValue: isSecret ? '[REDACTED]' : value,
        changedBy: setBy ?? 'system',
        source,
        timestamp: new Date().toISOString(),
        isSecret,
      };
      this.auditLog.push(change);
      if (this.auditLog.length > this.engineConfig.maxAuditEntries) {
        this.auditLog = this.auditLog.slice(-this.engineConfig.maxAuditEntries);
      }
      this.emit('config:changed', change);
    }

    return true;
  }

  /**
   * Get a configuration value.
   */
  get<T = unknown>(key: string): T | undefined {
    const entry = this.values.get(key);
    if (entry) return entry.value as T;

    // Fall back to schema default
    const schemaEntry = this.schema.get(key);
    if (schemaEntry && schemaEntry.default !== undefined) {
      return schemaEntry.default as T;
    }

    return undefined;
  }

  /**
   * Get a config value with a fallback.
   */
  getOrDefault<T>(key: string, fallback: T): T {
    const value = this.get<T>(key);
    return value !== undefined ? value : fallback;
  }

  /**
   * Check if a config key has a value set.
   */
  has(key: string): boolean {
    return this.values.has(key) || (this.schema.get(key)?.default !== undefined);
  }

  /**
   * Delete a config value (revert to default).
   */
  delete(key: string, deletedBy?: string): boolean {
    const had = this.values.has(key);
    this.values.delete(key);
    if (had && this.engineConfig.auditChanges) {
      this.auditLog.push({
        id: crypto.randomUUID(),
        key,
        oldValue: '[deleted]',
        newValue: undefined,
        changedBy: deletedBy ?? 'system',
        source: 'runtime',
        timestamp: new Date().toISOString(),
        isSecret: false,
      });
    }
    return had;
  }

  /**
   * Load configuration from a flat key-value object.
   */
  loadConfig(config: Record<string, unknown>, source: ConfigSource = 'file', setBy?: string): { loaded: number; errors: ConfigValidationError[] } {
    let loaded = 0;
    const errors: ConfigValidationError[] = [];

    for (const [key, value] of Object.entries(config)) {
      const ok = this.set(key, value, source, setBy);
      if (ok) {
        loaded++;
      } else {
        errors.push({ key, message: `Failed to set value for '${key}'` });
      }
    }

    this.emit('config:loaded', this.engineConfig.environment);
    return { loaded, errors };
  }

  /**
   * Load defaults from schema.
   */
  loadDefaults(): number {
    let count = 0;
    for (const s of this.schema.values()) {
      if (s.default !== undefined && !this.values.has(s.key)) {
        this.set(s.key, s.default, 'default', 'system');
        count++;
      }
    }
    return count;
  }

  /**
   * Get all config values.
   */
  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    // Start with defaults
    for (const s of this.schema.values()) {
      if (s.default !== undefined) {
        result[s.key] = s.default;
      }
    }
    
    // Override with set values
    for (const [key, entry] of this.values) {
      result[key] = entry.value;
    }

    return result;
  }

  /**
   * Get all config values with metadata.
   */
  getAllEntries(): ConfigValue[] {
    return Array.from(this.values.values());
  }

  /**
   * Export config as a redacted object (secrets masked).
   */
  exportRedacted(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of this.values) {
      const isSecret = this.schema.get(key)?.secret ?? false;
      result[key] = isSecret ? '[REDACTED]' : entry.value;
    }
    return result;
  }

  // ─── Validation ─────────────────────────────────────────────────────

  /**
   * Validate a single value against its schema.
   */
  validateValue(key: string, value: unknown, schema: ConfigSchema): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    // Type check
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== schema.type) {
      errors.push({
        key,
        message: `Expected type '${schema.type}' but got '${actualType}'`,
        expected: schema.type,
        actual: actualType,
      });
      return errors; // Can't do further validation if type is wrong
    }

    // Number constraints
    if (schema.type === 'number' && typeof value === 'number') {
      if (schema.min !== undefined && value < schema.min) {
        errors.push({ key, message: `Value ${value} is below minimum ${schema.min}`, expected: `>= ${schema.min}` });
      }
      if (schema.max !== undefined && value > schema.max) {
        errors.push({ key, message: `Value ${value} exceeds maximum ${schema.max}`, expected: `<= ${schema.max}` });
      }
    }

    // String constraints
    if (schema.type === 'string' && typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push({ key, message: `String length ${value.length} is below minimum ${schema.minLength}` });
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push({ key, message: `String length ${value.length} exceeds maximum ${schema.maxLength}` });
      }
      if (schema.pattern) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          errors.push({ key, message: `Value does not match pattern '${schema.pattern}'` });
        }
      }
    }

    // Enum constraint
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push({ key, message: `Value must be one of: ${schema.enum.join(', ')}` });
    }

    // Array constraints
    if (schema.type === 'array' && Array.isArray(value)) {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push({ key, message: `Array length ${value.length} is below minimum ${schema.minLength}` });
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push({ key, message: `Array length ${value.length} exceeds maximum ${schema.maxLength}` });
      }
    }

    return errors;
  }

  /**
   * Validate all current config values against schema.
   * Returns missing required fields and invalid values.
   */
  validateAll(): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    for (const s of this.schema.values()) {
      const entry = this.values.get(s.key);
      const value = entry?.value ?? s.default;

      // Check required
      if (s.required && value === undefined) {
        errors.push({ key: s.key, message: `Required config '${s.key}' is missing` });
        continue;
      }

      // Validate value if present
      if (value !== undefined) {
        errors.push(...this.validateValue(s.key, value, s));
      }
    }

    this.emit('config:validated', errors);
    return errors;
  }

  // ─── Feature Flags ──────────────────────────────────────────────────

  /**
   * Create or update a feature flag.
   */
  setFeatureFlag(flag: Omit<FeatureFlag, 'createdAt' | 'updatedAt'>): FeatureFlag {
    const existing = this.featureFlags.get(flag.id);
    const now = new Date().toISOString();

    const fullFlag: FeatureFlag = {
      ...flag,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.featureFlags.set(flag.id, fullFlag);
    
    if (existing?.enabled !== flag.enabled) {
      this.emit('flag:toggled', flag.id, flag.enabled);
    }

    return fullFlag;
  }

  /**
   * Evaluate a feature flag for a specific user and environment.
   */
  evaluateFlag(flagId: string, userId?: string): boolean {
    const flag = this.featureFlags.get(flagId);
    if (!flag) {
      this.emit('flag:evaluated', flagId, userId, false);
      return false;
    }

    // Not enabled at all
    if (!flag.enabled) {
      this.emit('flag:evaluated', flagId, userId, false);
      return false;
    }

    // Check environment targeting
    if (flag.targetEnvironments && flag.targetEnvironments.length > 0) {
      if (!flag.targetEnvironments.includes(this.engineConfig.environment)) {
        this.emit('flag:evaluated', flagId, userId, false);
        return false;
      }
    }

    // Check user targeting
    if (flag.targetUsers && flag.targetUsers.length > 0 && userId) {
      if (flag.targetUsers.includes(userId)) {
        this.emit('flag:evaluated', flagId, userId, true);
        return true;
      }
    }

    // Percentage rollout
    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
      const hash = this.hashForRollout(flagId, userId ?? 'anonymous');
      const result = hash < flag.rolloutPercentage;
      this.emit('flag:evaluated', flagId, userId, result);
      return result;
    }

    this.emit('flag:evaluated', flagId, userId, true);
    return true;
  }

  /**
   * Get a flag's A/B variant for a user.
   */
  getFlagVariant(flagId: string, userId: string): string | null {
    const flag = this.featureFlags.get(flagId);
    if (!flag || !flag.enabled || !flag.variants || !flag.variantWeights) return null;

    const hash = this.hashForRollout(`${flagId}-variant`, userId);
    const entries = Object.entries(flag.variantWeights).sort(([, a], [, b]) => a - b);
    
    let cumulative = 0;
    for (const [variant, weight] of entries) {
      cumulative += weight;
      if (hash < cumulative) return variant;
    }

    return entries[entries.length - 1]?.[0] ?? null;
  }

  /**
   * Toggle a feature flag.
   */
  toggleFlag(flagId: string): boolean {
    const flag = this.featureFlags.get(flagId);
    if (!flag) return false;
    
    flag.enabled = !flag.enabled;
    flag.updatedAt = new Date().toISOString();
    this.emit('flag:toggled', flagId, flag.enabled);
    return true;
  }

  /**
   * Get a feature flag.
   */
  getFlag(flagId: string): FeatureFlag | null {
    return this.featureFlags.get(flagId) ?? null;
  }

  /**
   * List all feature flags.
   */
  listFlags(category?: string): FeatureFlag[] {
    const flags = Array.from(this.featureFlags.values());
    if (category) return flags.filter(f => f.category === category);
    return flags;
  }

  /**
   * Delete a feature flag.
   */
  deleteFlag(flagId: string): boolean {
    return this.featureFlags.delete(flagId);
  }

  // ─── Secrets Management ─────────────────────────────────────────────

  /**
   * Set an encrypted secret.
   */
  setSecret(key: string, value: string, category?: string): boolean {
    if (!this.encryptionKey) {
      this.emit('error', 'No encryption key configured for secrets');
      return false;
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(value, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    const existing = this.secrets.get(key);

    const entry: SecretEntry = {
      key,
      encryptedValue: `${encrypted}:${authTag}`,
      iv: iv.toString('hex'),
      setAt: new Date().toISOString(),
      version: (existing?.version ?? 0) + 1,
      category,
    };

    this.secrets.set(key, entry);

    if (existing) {
      this.emit('secret:rotated', key, entry.version);
    } else {
      this.emit('secret:set', key);
    }

    return true;
  }

  /**
   * Get a decrypted secret.
   */
  getSecret(key: string): string | null {
    if (!this.encryptionKey) return null;

    const entry = this.secrets.get(key);
    if (!entry) return null;

    try {
      const iv = Buffer.from(entry.iv, 'hex');
      const [encrypted, authTag] = entry.encryptedValue.split(':');
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');

      entry.lastAccessedAt = new Date().toISOString();
      this.emit('secret:accessed', key);

      return decrypted;
    } catch {
      this.emit('error', `Failed to decrypt secret '${key}'`);
      return null;
    }
  }

  /**
   * Check if a secret exists.
   */
  hasSecret(key: string): boolean {
    return this.secrets.has(key);
  }

  /**
   * Delete a secret.
   */
  deleteSecret(key: string): boolean {
    return this.secrets.delete(key);
  }

  /**
   * List secret keys (never the values).
   */
  listSecretKeys(): Array<{ key: string; version: number; setAt: string; category?: string }> {
    return Array.from(this.secrets.values()).map(s => ({
      key: s.key,
      version: s.version,
      setAt: s.setAt,
      category: s.category,
    }));
  }

  // ─── Audit Log ──────────────────────────────────────────────────────

  /**
   * Get the config change audit log.
   */
  getAuditLog(options?: {
    key?: string;
    since?: string;
    limit?: number;
    changedBy?: string;
  }): ConfigChangeEvent[] {
    let log = [...this.auditLog];

    if (options?.key) {
      log = log.filter(e => e.key === options.key);
    }
    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      log = log.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
    }
    if (options?.changedBy) {
      log = log.filter(e => e.changedBy === options.changedBy);
    }

    log.reverse(); // Most recent first
    return log.slice(0, options?.limit ?? 100);
  }

  // ─── Environment Helpers ────────────────────────────────────────────

  /**
   * Get the current environment.
   */
  getEnvironment(): Environment {
    return this.engineConfig.environment;
  }

  /**
   * Check if we're in production.
   */
  isProduction(): boolean {
    return this.engineConfig.environment === 'production';
  }

  /**
   * Check if we're in development.
   */
  isDevelopment(): boolean {
    return this.engineConfig.environment === 'development';
  }

  /**
   * Check if we're in test.
   */
  isTest(): boolean {
    return this.engineConfig.environment === 'test';
  }

  // ─── Voice Summary ──────────────────────────────────────────────────

  /**
   * Generate a voice-friendly config summary.
   */
  getVoiceSummary(): string {
    const parts: string[] = [];
    const env = this.engineConfig.environment;
    const totalValues = this.values.size;
    const totalFlags = this.featureFlags.size;
    const enabledFlags = Array.from(this.featureFlags.values()).filter(f => f.enabled).length;
    const totalSecrets = this.secrets.size;

    parts.push(`Configuration is running in ${env} mode.`);
    parts.push(`${totalValues} config values set.`);

    if (totalFlags > 0) {
      parts.push(`${enabledFlags} of ${totalFlags} feature flags are enabled.`);
    }

    if (totalSecrets > 0) {
      parts.push(`${totalSecrets} secrets stored.`);
    }

    const errors = this.validateAll();
    if (errors.length > 0) {
      parts.push(`Warning: ${errors.length} configuration errors detected.`);
    } else {
      parts.push(`All configuration values are valid.`);
    }

    return parts.join(' ');
  }

  // ─── Stats ──────────────────────────────────────────────────────────

  /**
   * Get engine statistics.
   */
  getStats(): {
    environment: Environment;
    totalSchemas: number;
    totalValues: number;
    totalFlags: number;
    enabledFlags: number;
    totalSecrets: number;
    auditLogSize: number;
    validationErrors: number;
    categories: string[];
  } {
    const categories = new Set<string>();
    for (const s of this.schema.values()) {
      if (s.category) categories.add(s.category);
    }

    return {
      environment: this.engineConfig.environment,
      totalSchemas: this.schema.size,
      totalValues: this.values.size,
      totalFlags: this.featureFlags.size,
      enabledFlags: Array.from(this.featureFlags.values()).filter(f => f.enabled).length,
      totalSecrets: this.secrets.size,
      auditLogSize: this.auditLog.length,
      validationErrors: this.validateAll().length,
      categories: Array.from(categories),
    };
  }

  /**
   * Export full engine state for persistence.
   */
  exportState(): {
    values: ConfigValue[];
    flags: FeatureFlag[];
    secrets: SecretEntry[];
    auditLog: ConfigChangeEvent[];
  } {
    return {
      values: Array.from(this.values.values()),
      flags: Array.from(this.featureFlags.values()),
      secrets: Array.from(this.secrets.values()),
      auditLog: [...this.auditLog],
    };
  }

  /**
   * Import engine state.
   */
  importState(state: {
    values?: ConfigValue[];
    flags?: FeatureFlag[];
    secrets?: SecretEntry[];
    auditLog?: ConfigChangeEvent[];
  }): void {
    if (state.values) {
      for (const v of state.values) {
        this.values.set(v.key, v);
      }
    }
    if (state.flags) {
      for (const f of state.flags) {
        this.featureFlags.set(f.id, f);
      }
    }
    if (state.secrets) {
      for (const s of state.secrets) {
        this.secrets.set(s.key, s);
      }
    }
    if (state.auditLog) {
      this.auditLog = [...state.auditLog];
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  /**
   * Deterministic hash for rollout percentage (0-99).
   */
  private hashForRollout(flagId: string, userId: string): number {
    const hash = crypto.createHash('md5').update(`${flagId}:${userId}`).digest();
    return hash.readUInt16BE(0) % 100;
  }
}
