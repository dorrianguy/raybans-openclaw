/**
 * Tests for Configuration Engine
 * 🌙 Night Shift Agent — 2026-03-08
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ConfigEngine,
  PLATFORM_CONFIG_SCHEMA,
  type ConfigEngineConfig,
  type ConfigSchema,
  type Environment,
} from './config-engine.js';
import * as crypto from 'crypto';

const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

function createEngine(overrides?: Partial<ConfigEngineConfig>): ConfigEngine {
  return new ConfigEngine({
    environment: 'test',
    encryptionKey: TEST_ENCRYPTION_KEY,
    ...overrides,
  });
}

describe('ConfigEngine', () => {

  // ─── Schema Management ───────────────────────────────────────────

  describe('Schema Management', () => {

    it('should register and retrieve schemas', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'server.port', type: 'number', required: true, description: 'Server port', min: 1, max: 65535 },
        { key: 'server.host', type: 'string', required: false, default: '0.0.0.0', description: 'Bind host' },
      ]);

      expect(engine.getSchema('server.port')).not.toBeNull();
      expect(engine.getSchema('server.port')!.type).toBe('number');
      expect(engine.getSchema('server.host')!.default).toBe('0.0.0.0');
      expect(engine.getSchema('nonexistent')).toBeNull();
    });

    it('should return all schemas', () => {
      const engine = createEngine();
      engine.registerSchema(PLATFORM_CONFIG_SCHEMA);
      
      const all = engine.getAllSchemas();
      expect(all.length).toBeGreaterThan(10);
    });

    it('should group schemas by category', () => {
      const engine = createEngine();
      engine.registerSchema(PLATFORM_CONFIG_SCHEMA);
      
      const byCategory = engine.getSchemasByCategory();
      expect(byCategory['server']).toBeDefined();
      expect(byCategory['vision']).toBeDefined();
      expect(byCategory['billing']).toBeDefined();
      expect(byCategory['server'].length).toBeGreaterThan(0);
    });
  });

  // ─── Config Values ──────────────────────────────────────────────

  describe('Config Values', () => {

    it('should set and get a value', () => {
      const engine = createEngine();
      engine.set('app.name', 'RayBans Vision');
      
      expect(engine.get('app.name')).toBe('RayBans Vision');
    });

    it('should return undefined for unset keys', () => {
      const engine = createEngine();
      expect(engine.get('nonexistent')).toBeUndefined();
    });

    it('should fall back to schema default', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'server.port', type: 'number', required: false, default: 3847, description: 'Port' },
      ]);
      
      expect(engine.get('server.port')).toBe(3847);
    });

    it('should override schema default with set value', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'server.port', type: 'number', required: false, default: 3847, description: 'Port' },
      ]);
      
      engine.set('server.port', 8080);
      expect(engine.get('server.port')).toBe(8080);
    });

    it('should support getOrDefault', () => {
      const engine = createEngine();
      expect(engine.getOrDefault('missing', 42)).toBe(42);
      
      engine.set('present', 100);
      expect(engine.getOrDefault('present', 42)).toBe(100);
    });

    it('should check if key has value', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'with.default', type: 'string', required: false, default: 'hi', description: 'Test' },
      ]);
      
      expect(engine.has('with.default')).toBe(true); // Has default
      expect(engine.has('no.value')).toBe(false);
      
      engine.set('explicit', 'value');
      expect(engine.has('explicit')).toBe(true);
    });

    it('should delete a config value', () => {
      const engine = createEngine();
      engine.set('key', 'value');
      expect(engine.has('key')).toBe(true);
      
      expect(engine.delete('key')).toBe(true);
      // After delete, falls back to schema default if exists — otherwise undefined
      expect(engine.get('key')).toBeUndefined();
      
      expect(engine.delete('nonexistent')).toBe(false);
    });

    it('should load config from object', () => {
      const engine = createEngine();
      const result = engine.loadConfig({
        'app.name': 'Test App',
        'app.version': '1.0.0',
        'server.port': 8080,
      });
      
      expect(result.loaded).toBe(3);
      expect(result.errors).toHaveLength(0);
      expect(engine.get('app.name')).toBe('Test App');
    });

    it('should load defaults from schema', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'a', type: 'string', required: false, default: 'hello', description: 'A' },
        { key: 'b', type: 'number', required: false, default: 42, description: 'B' },
        { key: 'c', type: 'boolean', required: true, description: 'C (no default)' },
      ]);
      
      const count = engine.loadDefaults();
      expect(count).toBe(2); // Only a and b have defaults
      expect(engine.get('a')).toBe('hello');
      expect(engine.get('b')).toBe(42);
    });

    it('should not overwrite existing values when loading defaults', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'x', type: 'number', required: false, default: 10, description: 'X' },
      ]);
      
      engine.set('x', 99);
      engine.loadDefaults();
      
      expect(engine.get('x')).toBe(99);
    });

    it('should get all values including defaults', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'a', type: 'string', required: false, default: 'default-a', description: 'A' },
      ]);
      engine.set('b', 'explicit-b');
      
      const all = engine.getAll();
      expect(all['a']).toBe('default-a');
      expect(all['b']).toBe('explicit-b');
    });

    it('should export redacted config', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'api.key', type: 'string', required: true, description: 'API Key', secret: true },
        { key: 'api.url', type: 'string', required: true, description: 'API URL' },
      ]);
      
      engine.set('api.key', 'sk-super-secret-123');
      engine.set('api.url', 'https://api.example.com');
      
      const redacted = engine.exportRedacted();
      expect(redacted['api.key']).toBe('[REDACTED]');
      expect(redacted['api.url']).toBe('https://api.example.com');
    });
  });

  // ─── Validation ─────────────────────────────────────────────────

  describe('Validation', () => {

    it('should validate type mismatch', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'port', type: 'number', required: false, description: 'Port' },
      ]);
      
      const ok = engine.set('port', 'not-a-number' as any);
      expect(ok).toBe(false);
    });

    it('should validate number min/max', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'port', type: 'number', required: false, description: 'Port', min: 1, max: 65535 },
      ]);
      
      expect(engine.set('port', 0)).toBe(false);
      expect(engine.set('port', 70000)).toBe(false);
      expect(engine.set('port', 3000)).toBe(true);
    });

    it('should validate string length', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'name', type: 'string', required: false, description: 'Name', minLength: 2, maxLength: 50 },
      ]);
      
      expect(engine.set('name', 'A')).toBe(false);
      expect(engine.set('name', 'A'.repeat(51))).toBe(false);
      expect(engine.set('name', 'Valid Name')).toBe(true);
    });

    it('should validate string pattern', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'email', type: 'string', required: false, description: 'Email', pattern: '^[^@]+@[^@]+$' },
      ]);
      
      expect(engine.set('email', 'notanemail')).toBe(false);
      expect(engine.set('email', 'test@example.com')).toBe(true);
    });

    it('should validate enum values', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'env', type: 'string', required: false, description: 'Environment', enum: ['dev', 'staging', 'prod'] },
      ]);
      
      expect(engine.set('env', 'invalid')).toBe(false);
      expect(engine.set('env', 'prod')).toBe(true);
    });

    it('should validate array constraints', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'tags', type: 'array', required: false, description: 'Tags', minLength: 1, maxLength: 5 },
      ]);
      
      expect(engine.set('tags', [])).toBe(false);
      expect(engine.set('tags', [1, 2, 3, 4, 5, 6])).toBe(false);
      expect(engine.set('tags', ['a', 'b'])).toBe(true);
    });

    it('should validate all config and report missing required fields', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'required.field', type: 'string', required: true, description: 'Required' },
        { key: 'optional.field', type: 'string', required: false, description: 'Optional' },
      ]);
      
      const errors = engine.validateAll();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.key === 'required.field')).toBe(true);
    });

    it('should pass validation when all required fields are set', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'name', type: 'string', required: true, description: 'Name' },
        { key: 'port', type: 'number', required: false, default: 3000, description: 'Port' },
      ]);
      
      engine.set('name', 'MyApp');
      
      const errors = engine.validateAll();
      expect(errors).toHaveLength(0);
    });

    it('should emit config:validated event', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'bad', type: 'number', required: false, description: 'Bad', min: 10 },
      ]);
      
      const handler = vi.fn();
      engine.on('config:validated', handler);
      
      engine.set('bad', 5);
      expect(handler).toHaveBeenCalled();
    });

    it('should block hot reload for non-hot-reloadable keys', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'port', type: 'number', required: false, default: 3000, description: 'Port', hotReload: false },
      ]);
      
      // First set (file source) is fine
      engine.set('port', 8080, 'file');
      expect(engine.get('port')).toBe(8080);
      
      // Runtime update should be blocked
      const ok = engine.set('port', 9090, 'runtime');
      expect(ok).toBe(false);
      expect(engine.get('port')).toBe(8080);
    });

    it('should allow hot reload for hot-reloadable keys', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'threshold', type: 'number', required: false, default: 0.5, description: 'Threshold', hotReload: true },
      ]);
      
      engine.set('threshold', 0.7, 'file');
      engine.set('threshold', 0.9, 'runtime');
      expect(engine.get('threshold')).toBe(0.9);
    });
  });

  // ─── Feature Flags ──────────────────────────────────────────────

  describe('Feature Flags', () => {

    it('should create a feature flag', () => {
      const engine = createEngine();
      const flag = engine.setFeatureFlag({
        id: 'dark-mode',
        name: 'Dark Mode',
        description: 'Enable dark theme',
        enabled: true,
      });
      
      expect(flag.id).toBe('dark-mode');
      expect(flag.enabled).toBe(true);
      expect(flag.createdAt).toBeTruthy();
    });

    it('should evaluate enabled flag as true', () => {
      const engine = createEngine();
      engine.setFeatureFlag({ id: 'feature-a', name: 'A', description: 'A', enabled: true });
      
      expect(engine.evaluateFlag('feature-a')).toBe(true);
    });

    it('should evaluate disabled flag as false', () => {
      const engine = createEngine();
      engine.setFeatureFlag({ id: 'feature-a', name: 'A', description: 'A', enabled: false });
      
      expect(engine.evaluateFlag('feature-a')).toBe(false);
    });

    it('should evaluate nonexistent flag as false', () => {
      const engine = createEngine();
      expect(engine.evaluateFlag('nonexistent')).toBe(false);
    });

    it('should support environment targeting', () => {
      const engine = createEngine({ environment: 'production' });
      engine.setFeatureFlag({
        id: 'prod-only',
        name: 'Prod Only',
        description: 'Only in prod',
        enabled: true,
        targetEnvironments: ['production'],
      });
      
      expect(engine.evaluateFlag('prod-only')).toBe(true);
      
      const devEngine = createEngine({ environment: 'development' });
      devEngine.setFeatureFlag({
        id: 'prod-only',
        name: 'Prod Only',
        description: 'Only in prod',
        enabled: true,
        targetEnvironments: ['production'],
      });
      
      expect(devEngine.evaluateFlag('prod-only')).toBe(false);
    });

    it('should support user targeting', () => {
      const engine = createEngine();
      engine.setFeatureFlag({
        id: 'beta-feature',
        name: 'Beta',
        description: 'Beta feature',
        enabled: true,
        targetUsers: ['user-42', 'user-99'],
        rolloutPercentage: 0, // 0% rollout but targeted users still get it
      });
      
      expect(engine.evaluateFlag('beta-feature', 'user-42')).toBe(true);
      expect(engine.evaluateFlag('beta-feature', 'user-99')).toBe(true);
    });

    it('should support percentage rollout', () => {
      const engine = createEngine();
      engine.setFeatureFlag({
        id: 'gradual-rollout',
        name: 'Gradual',
        description: 'Gradual rollout',
        enabled: true,
        rolloutPercentage: 50,
      });
      
      // Test with multiple users — some should get true, some false
      let trueCount = 0;
      for (let i = 0; i < 100; i++) {
        if (engine.evaluateFlag('gradual-rollout', `user-${i}`)) trueCount++;
      }
      
      // With 50% rollout and 100 users, expect roughly 50 (allow wide margin due to hash distribution)
      expect(trueCount).toBeGreaterThan(20);
      expect(trueCount).toBeLessThan(80);
    });

    it('should support 0% rollout (no one gets it except targeted)', () => {
      const engine = createEngine();
      engine.setFeatureFlag({
        id: 'zero-rollout',
        name: 'Zero',
        description: 'Zero rollout',
        enabled: true,
        rolloutPercentage: 0,
      });
      
      // With 0%, nobody should get it
      let trueCount = 0;
      for (let i = 0; i < 50; i++) {
        if (engine.evaluateFlag('zero-rollout', `user-${i}`)) trueCount++;
      }
      expect(trueCount).toBe(0);
    });

    it('should toggle a flag', () => {
      const engine = createEngine();
      engine.setFeatureFlag({ id: 'toggle-me', name: 'T', description: 'T', enabled: true });
      
      expect(engine.evaluateFlag('toggle-me')).toBe(true);
      
      engine.toggleFlag('toggle-me');
      expect(engine.evaluateFlag('toggle-me')).toBe(false);
      
      engine.toggleFlag('toggle-me');
      expect(engine.evaluateFlag('toggle-me')).toBe(true);
    });

    it('should return false when toggling nonexistent flag', () => {
      const engine = createEngine();
      expect(engine.toggleFlag('nonexistent')).toBe(false);
    });

    it('should get a flag', () => {
      const engine = createEngine();
      engine.setFeatureFlag({ id: 'f1', name: 'F1', description: 'D', enabled: true });
      
      expect(engine.getFlag('f1')!.name).toBe('F1');
      expect(engine.getFlag('nonexistent')).toBeNull();
    });

    it('should list flags', () => {
      const engine = createEngine();
      engine.setFeatureFlag({ id: 'f1', name: 'F1', description: 'D', enabled: true, category: 'ui' });
      engine.setFeatureFlag({ id: 'f2', name: 'F2', description: 'D', enabled: false, category: 'backend' });
      engine.setFeatureFlag({ id: 'f3', name: 'F3', description: 'D', enabled: true, category: 'ui' });
      
      expect(engine.listFlags()).toHaveLength(3);
      expect(engine.listFlags('ui')).toHaveLength(2);
      expect(engine.listFlags('backend')).toHaveLength(1);
    });

    it('should delete a flag', () => {
      const engine = createEngine();
      engine.setFeatureFlag({ id: 'f1', name: 'F1', description: 'D', enabled: true });
      
      expect(engine.deleteFlag('f1')).toBe(true);
      expect(engine.getFlag('f1')).toBeNull();
      expect(engine.deleteFlag('f1')).toBe(false);
    });

    it('should emit flag events', () => {
      const engine = createEngine();
      const toggleHandler = vi.fn();
      const evalHandler = vi.fn();
      
      engine.on('flag:toggled', toggleHandler);
      engine.on('flag:evaluated', evalHandler);
      
      engine.setFeatureFlag({ id: 'f1', name: 'F1', description: 'D', enabled: true });
      expect(toggleHandler).toHaveBeenCalledWith('f1', true);
      
      engine.evaluateFlag('f1', 'user-1');
      expect(evalHandler).toHaveBeenCalledWith('f1', 'user-1', true);
    });

    it('should support A/B variant selection', () => {
      const engine = createEngine();
      engine.setFeatureFlag({
        id: 'ab-test',
        name: 'AB Test',
        description: 'AB test',
        enabled: true,
        variants: { control: { color: 'blue' }, treatment: { color: 'green' } },
        variantWeights: { control: 50, treatment: 50 },
      });
      
      const variant = engine.getFlagVariant('ab-test', 'user-1');
      expect(['control', 'treatment']).toContain(variant);
    });

    it('should return null variant for disabled flag', () => {
      const engine = createEngine();
      engine.setFeatureFlag({
        id: 'ab-disabled',
        name: 'AB',
        description: 'AB',
        enabled: false,
        variants: { a: {}, b: {} },
        variantWeights: { a: 50, b: 50 },
      });
      
      expect(engine.getFlagVariant('ab-disabled', 'user-1')).toBeNull();
    });

    it('should return null variant for flag without variants', () => {
      const engine = createEngine();
      engine.setFeatureFlag({ id: 'no-variants', name: 'NV', description: 'NV', enabled: true });
      
      expect(engine.getFlagVariant('no-variants', 'user-1')).toBeNull();
    });
  });

  // ─── Secrets Management ─────────────────────────────────────────

  describe('Secrets Management', () => {

    it('should set and get a secret', () => {
      const engine = createEngine();
      
      expect(engine.setSecret('api.key', 'sk-super-secret')).toBe(true);
      expect(engine.getSecret('api.key')).toBe('sk-super-secret');
    });

    it('should encrypt secrets at rest', () => {
      const engine = createEngine();
      engine.setSecret('password', 'hunter2');
      
      // Export state to inspect encrypted form
      const state = engine.exportState();
      const secretEntry = state.secrets.find(s => s.key === 'password')!;
      
      expect(secretEntry.encryptedValue).not.toBe('hunter2');
      expect(secretEntry.encryptedValue).toContain(':'); // encrypted:authTag format
    });

    it('should return null for nonexistent secret', () => {
      const engine = createEngine();
      expect(engine.getSecret('nonexistent')).toBeNull();
    });

    it('should fail without encryption key', () => {
      const engine = createEngine({ encryptionKey: undefined });
      expect(engine.setSecret('key', 'value')).toBe(false);
      expect(engine.getSecret('key')).toBeNull();
    });

    it('should check secret existence', () => {
      const engine = createEngine();
      engine.setSecret('exists', 'value');
      
      expect(engine.hasSecret('exists')).toBe(true);
      expect(engine.hasSecret('missing')).toBe(false);
    });

    it('should delete a secret', () => {
      const engine = createEngine();
      engine.setSecret('temp', 'value');
      
      expect(engine.deleteSecret('temp')).toBe(true);
      expect(engine.getSecret('temp')).toBeNull();
      expect(engine.deleteSecret('temp')).toBe(false);
    });

    it('should increment version on secret rotation', () => {
      const engine = createEngine();
      engine.setSecret('rotating', 'v1');
      engine.setSecret('rotating', 'v2');
      engine.setSecret('rotating', 'v3');
      
      const keys = engine.listSecretKeys();
      const rotating = keys.find(k => k.key === 'rotating')!;
      expect(rotating.version).toBe(3);
    });

    it('should list secret keys without values', () => {
      const engine = createEngine();
      engine.setSecret('key1', 'secret1', 'auth');
      engine.setSecret('key2', 'secret2', 'billing');
      
      const keys = engine.listSecretKeys();
      expect(keys).toHaveLength(2);
      expect(keys[0]).toHaveProperty('key');
      expect(keys[0]).toHaveProperty('version');
      expect(keys[0]).toHaveProperty('setAt');
      expect(keys[0]).not.toHaveProperty('encryptedValue');
    });

    it('should emit secret events', () => {
      const engine = createEngine();
      const setHandler = vi.fn();
      const accessHandler = vi.fn();
      const rotateHandler = vi.fn();
      
      engine.on('secret:set', setHandler);
      engine.on('secret:accessed', accessHandler);
      engine.on('secret:rotated', rotateHandler);
      
      engine.setSecret('k', 'v1');
      expect(setHandler).toHaveBeenCalledWith('k');
      
      engine.getSecret('k');
      expect(accessHandler).toHaveBeenCalledWith('k');
      
      engine.setSecret('k', 'v2'); // Rotation
      expect(rotateHandler).toHaveBeenCalledWith('k', 2);
    });

    it('should handle corrupted encrypted data gracefully', () => {
      const engine = createEngine();
      engine.setSecret('test', 'value');
      
      // Corrupt the encrypted data
      const state = engine.exportState();
      state.secrets[0].encryptedValue = 'corrupted:data';
      
      const engine2 = createEngine();
      engine2.importState(state);
      
      const errorHandler = vi.fn();
      engine2.on('error', errorHandler);
      
      expect(engine2.getSecret('test')).toBeNull();
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  // ─── Audit Log ──────────────────────────────────────────────────

  describe('Audit Log', () => {

    it('should log config changes', () => {
      const engine = createEngine();
      engine.set('key', 'value1', 'file', 'admin');
      engine.set('key', 'value2', 'runtime', 'admin');
      
      const log = engine.getAuditLog();
      expect(log.length).toBeGreaterThanOrEqual(2);
    });

    it('should redact secret values in audit log', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'api.key', type: 'string', required: false, description: 'Key', secret: true },
      ]);
      
      engine.set('api.key', 'sk-secret-123');
      
      const log = engine.getAuditLog();
      const change = log.find(e => e.key === 'api.key');
      expect(change).toBeDefined();
      expect(change!.newValue).toBe('[REDACTED]');
      expect(change!.isSecret).toBe(true);
    });

    it('should filter audit log by key', () => {
      const engine = createEngine();
      engine.set('a', 1);
      engine.set('b', 2);
      engine.set('a', 3);
      
      const log = engine.getAuditLog({ key: 'a' });
      expect(log.every(e => e.key === 'a')).toBe(true);
    });

    it('should filter audit log by changedBy', () => {
      const engine = createEngine();
      engine.set('x', 1, 'runtime', 'alice');
      engine.set('y', 2, 'runtime', 'bob');
      
      const aliceLog = engine.getAuditLog({ changedBy: 'alice' });
      expect(aliceLog).toHaveLength(1);
      expect(aliceLog[0].changedBy).toBe('alice');
    });

    it('should limit audit log results', () => {
      const engine = createEngine();
      for (let i = 0; i < 20; i++) {
        engine.set(`key-${i}`, i);
      }
      
      const log = engine.getAuditLog({ limit: 5 });
      expect(log).toHaveLength(5);
    });

    it('should cap audit log size', () => {
      const engine = createEngine({ maxAuditEntries: 10 });
      for (let i = 0; i < 20; i++) {
        engine.set(`key-${i}`, i);
      }
      
      const log = engine.getAuditLog({ limit: 100 });
      expect(log.length).toBeLessThanOrEqual(10);
    });

    it('should not audit when disabled', () => {
      const engine = createEngine({ auditChanges: false });
      engine.set('key', 'value');
      
      const log = engine.getAuditLog();
      expect(log).toHaveLength(0);
    });

    it('should emit config:changed event', () => {
      const engine = createEngine();
      const handler = vi.fn();
      engine.on('config:changed', handler);
      
      engine.set('key', 'value1');
      expect(handler).toHaveBeenCalled();
      
      const change = handler.mock.calls[0][0];
      expect(change.key).toBe('key');
      expect(change.newValue).toBe('value1');
    });
  });

  // ─── Environment ────────────────────────────────────────────────

  describe('Environment', () => {

    it('should return current environment', () => {
      const engine = createEngine({ environment: 'production' });
      expect(engine.getEnvironment()).toBe('production');
    });

    it('should detect production', () => {
      expect(createEngine({ environment: 'production' }).isProduction()).toBe(true);
      expect(createEngine({ environment: 'development' }).isProduction()).toBe(false);
    });

    it('should detect development', () => {
      expect(createEngine({ environment: 'development' }).isDevelopment()).toBe(true);
      expect(createEngine({ environment: 'production' }).isDevelopment()).toBe(false);
    });

    it('should detect test', () => {
      expect(createEngine({ environment: 'test' }).isTest()).toBe(true);
      expect(createEngine({ environment: 'production' }).isTest()).toBe(false);
    });
  });

  // ─── State Serialization ────────────────────────────────────────

  describe('State Serialization', () => {

    it('should export and import full state', () => {
      const engine1 = createEngine();
      engine1.set('key1', 'value1');
      engine1.setFeatureFlag({ id: 'flag1', name: 'F1', description: 'D', enabled: true });
      engine1.setSecret('secret1', 'hidden');
      
      const state = engine1.exportState();
      
      const engine2 = createEngine();
      engine2.importState(state);
      
      expect(engine2.get('key1')).toBe('value1');
      expect(engine2.getFlag('flag1')!.enabled).toBe(true);
      expect(engine2.getSecret('secret1')).toBe('hidden');
    });

    it('should handle partial import', () => {
      const engine = createEngine();
      engine.importState({ values: [] });
      expect(engine.getStats().totalValues).toBe(0);
    });
  });

  // ─── Stats ──────────────────────────────────────────────────────

  describe('Stats', () => {

    it('should return comprehensive stats', () => {
      const engine = createEngine();
      engine.registerSchema(PLATFORM_CONFIG_SCHEMA);
      engine.set('app.name', 'Test');
      engine.setFeatureFlag({ id: 'f1', name: 'F1', description: 'D', enabled: true });
      engine.setFeatureFlag({ id: 'f2', name: 'F2', description: 'D', enabled: false });
      engine.setSecret('s1', 'v1');
      
      const stats = engine.getStats();
      expect(stats.environment).toBe('test');
      expect(stats.totalSchemas).toBe(PLATFORM_CONFIG_SCHEMA.length);
      expect(stats.totalValues).toBe(1);
      expect(stats.totalFlags).toBe(2);
      expect(stats.enabledFlags).toBe(1);
      expect(stats.totalSecrets).toBe(1);
      expect(stats.categories.length).toBeGreaterThan(0);
    });
  });

  // ─── Voice Summary ──────────────────────────────────────────────

  describe('Voice Summary', () => {

    it('should generate a voice summary', () => {
      const engine = createEngine();
      engine.set('key', 'value');
      engine.setFeatureFlag({ id: 'f1', name: 'F1', description: 'D', enabled: true });
      engine.setSecret('s1', 'v1');
      
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('test mode');
      expect(summary).toContain('config values');
      expect(summary).toContain('feature flags');
      expect(summary).toContain('secrets');
    });

    it('should warn about validation errors in voice summary', () => {
      const engine = createEngine();
      engine.registerSchema([
        { key: 'required', type: 'string', required: true, description: 'Required field' },
      ]);
      
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('configuration errors');
    });
  });

  // ─── Platform Schema ────────────────────────────────────────────

  describe('Platform Config Schema', () => {

    it('should have all categories covered', () => {
      const categories = new Set(PLATFORM_CONFIG_SCHEMA.map(s => s.category).filter(Boolean));
      expect(categories.has('server')).toBe(true);
      expect(categories.has('vision')).toBe(true);
      expect(categories.has('inventory')).toBe(true);
      expect(categories.has('storage')).toBe(true);
      expect(categories.has('auth')).toBe(true);
      expect(categories.has('billing')).toBe(true);
      expect(categories.has('voice')).toBe(true);
      expect(categories.has('telemetry')).toBe(true);
    });

    it('should mark sensitive fields as secret', () => {
      const secrets = PLATFORM_CONFIG_SCHEMA.filter(s => s.secret);
      expect(secrets.length).toBeGreaterThanOrEqual(3);
      expect(secrets.some(s => s.key.includes('apiKey') || s.key.includes('Secret'))).toBe(true);
    });

    it('should have valid defaults', () => {
      const engine = createEngine();
      engine.registerSchema(PLATFORM_CONFIG_SCHEMA);
      
      for (const s of PLATFORM_CONFIG_SCHEMA) {
        if (s.default !== undefined) {
          const errors = engine.validateValue(s.key, s.default, s);
          expect(errors).toHaveLength(0);
        }
      }
    });
  });
});
