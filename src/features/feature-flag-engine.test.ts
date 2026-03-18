/**
 * Tests for Feature Flag Engine
 * Covers: flag CRUD, rules, evaluation strategies, experiments, A/B testing,
 * overrides, conditions, caching, audit logging, statistical significance
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FeatureFlagEngine,
  DEFAULT_FLAG_CONFIG,
  type EvaluationContext,
  type RolloutStrategy,
  type RingLevel,
} from './feature-flag-engine.js';

describe('FeatureFlagEngine', () => {
  let engine: FeatureFlagEngine;

  beforeEach(() => {
    engine = new FeatureFlagEngine();
  });

  const baseContext: EvaluationContext = { userId: 'user-1', plan: 'pro', region: 'US' };

  // ─── Constructor & Config ────────────────────────────────────────

  describe('constructor', () => {
    it('should create with default config', () => {
      const stats = engine.getStats();
      expect(stats.totalFlags).toBe(0);
      expect(stats.totalExperiments).toBe(0);
    });

    it('should accept custom config', () => {
      const custom = new FeatureFlagEngine({ maxFlags: 10 });
      for (let i = 0; i < 10; i++) {
        custom.createFlag({ id: `flag-${i}`, name: `Flag ${i}` });
      }
      expect(() => custom.createFlag({ id: 'flag-11', name: 'Too many' })).toThrow(/maximum/i);
    });
  });

  // ─── Flag CRUD ──────────────────────────────────────────────────

  describe('flag CRUD', () => {
    it('should create a flag', () => {
      const flag = engine.createFlag({
        id: 'test-flag',
        name: 'Test Flag',
        description: 'A test flag',
        tags: ['test'],
      });

      expect(flag.id).toBe('test-flag');
      expect(flag.status).toBe('inactive');
      expect(flag.valueType).toBe('boolean');
      expect(flag.defaultValue).toBe(false);
    });

    it('should not create duplicate flags', () => {
      engine.createFlag({ id: 'dupe', name: 'Flag' });
      expect(() => engine.createFlag({ id: 'dupe', name: 'Flag 2' })).toThrow(/already exists/i);
    });

    it('should get a flag by ID', () => {
      engine.createFlag({ id: 'lookup', name: 'Lookup' });
      expect(engine.getFlag('lookup')).toBeDefined();
      expect(engine.getFlag('nonexistent')).toBeUndefined();
    });

    it('should get all flags', () => {
      engine.createFlag({ id: 'f1', name: 'F1', tags: ['a'] });
      engine.createFlag({ id: 'f2', name: 'F2', tags: ['b'] });
      engine.createFlag({ id: 'f3', name: 'F3', tags: ['a'], category: 'agent' });

      expect(engine.getAllFlags()).toHaveLength(3);
      expect(engine.getAllFlags({ tag: 'a' })).toHaveLength(2);
      expect(engine.getAllFlags({ category: 'agent' })).toHaveLength(1);
    });

    it('should update a flag', () => {
      engine.createFlag({ id: 'upd', name: 'Before' });
      const updated = engine.updateFlag('upd', { name: 'After', tags: ['updated'] });
      expect(updated!.name).toBe('After');
      expect(updated!.tags).toContain('updated');
    });

    it('should return null updating nonexistent flag', () => {
      expect(engine.updateFlag('nope', { name: 'X' })).toBeNull();
    });

    it('should toggle flag status', () => {
      engine.createFlag({ id: 'tog', name: 'Toggle' });
      expect(engine.getFlag('tog')!.status).toBe('inactive');

      engine.toggleFlag('tog');
      expect(engine.getFlag('tog')!.status).toBe('active');

      engine.toggleFlag('tog');
      expect(engine.getFlag('tog')!.status).toBe('inactive');

      engine.toggleFlag('tog', true);
      expect(engine.getFlag('tog')!.status).toBe('active');
    });

    it('should archive a flag', () => {
      engine.createFlag({ id: 'arch', name: 'Archive Me' });
      expect(engine.archiveFlag('arch')).toBe(true);
      expect(engine.getFlag('arch')!.status).toBe('archived');
      expect(engine.archiveFlag('nonexistent')).toBe(false);
    });

    it('should delete a flag', () => {
      engine.createFlag({ id: 'del', name: 'Delete Me' });
      expect(engine.deleteFlag('del')).toBe(true);
      expect(engine.getFlag('del')).toBeUndefined();
    });

    it('should filter by status', () => {
      engine.createFlag({ id: 'a1', name: 'A1' });
      engine.createFlag({ id: 'a2', name: 'A2' });
      engine.toggleFlag('a1', true);

      expect(engine.getAllFlags({ status: 'active' })).toHaveLength(1);
      expect(engine.getAllFlags({ status: 'inactive' })).toHaveLength(1);
    });

    it('should emit events', () => {
      const created = vi.fn();
      const toggled = vi.fn();
      const archived = vi.fn();
      engine.on('flag:created', created);
      engine.on('flag:toggled', toggled);
      engine.on('flag:archived', archived);

      engine.createFlag({ id: 'ev', name: 'Event' });
      expect(created).toHaveBeenCalledWith({ flagId: 'ev' });

      engine.toggleFlag('ev', true);
      expect(toggled).toHaveBeenCalledWith({ flagId: 'ev', active: true });

      engine.archiveFlag('ev');
      expect(archived).toHaveBeenCalledWith({ flagId: 'ev' });
    });
  });

  // ─── Rules ──────────────────────────────────────────────────────

  describe('rules', () => {
    it('should add a rule to a flag', () => {
      engine.createFlag({ id: 'r1', name: 'R1' });
      const rule = engine.addRule('r1', {
        priority: 1,
        strategy: 'all',
        value: true,
        enabled: true,
      });

      expect(rule).not.toBeNull();
      expect(rule!.id).toBeDefined();
      expect(engine.getFlag('r1')!.rules).toHaveLength(1);
    });

    it('should sort rules by priority', () => {
      engine.createFlag({ id: 'r2', name: 'R2' });
      engine.addRule('r2', { priority: 3, strategy: 'all', value: 'c', enabled: true });
      engine.addRule('r2', { priority: 1, strategy: 'all', value: 'a', enabled: true });
      engine.addRule('r2', { priority: 2, strategy: 'all', value: 'b', enabled: true });

      const rules = engine.getFlag('r2')!.rules;
      expect(rules[0].priority).toBe(1);
      expect(rules[1].priority).toBe(2);
      expect(rules[2].priority).toBe(3);
    });

    it('should remove a rule', () => {
      engine.createFlag({ id: 'r3', name: 'R3' });
      const rule = engine.addRule('r3', { priority: 1, strategy: 'all', value: true, enabled: true });
      expect(engine.removeRule('r3', rule!.id)).toBe(true);
      expect(engine.getFlag('r3')!.rules).toHaveLength(0);
    });

    it('should update a rule', () => {
      engine.createFlag({ id: 'r4', name: 'R4' });
      const rule = engine.addRule('r4', { priority: 1, strategy: 'percentage', value: true, percentage: 50, enabled: true });
      const updated = engine.updateRule('r4', rule!.id, { percentage: 80 });
      expect(updated!.percentage).toBe(80);
    });

    it('should enforce max rules per flag', () => {
      const engine2 = new FeatureFlagEngine({ maxRulesPerFlag: 2 });
      engine2.createFlag({ id: 'mr', name: 'MR' });
      engine2.addRule('mr', { priority: 1, strategy: 'all', value: true, enabled: true });
      engine2.addRule('mr', { priority: 2, strategy: 'all', value: false, enabled: true });
      expect(() => engine2.addRule('mr', { priority: 3, strategy: 'all', value: true, enabled: true })).toThrow(/maximum/i);
    });
  });

  // ─── Evaluation: Basic Strategies ───────────────────────────────

  describe('evaluation - basic strategies', () => {
    it('should return default for inactive flag', () => {
      engine.createFlag({ id: 'inactive', name: 'Inactive', defaultValue: false });
      const result = engine.evaluate('inactive', baseContext);
      expect(result.value).toBe(false);
      expect(result.reason).toBe('disabled');
    });

    it('should return not_found for missing flag', () => {
      const result = engine.evaluate('missing', baseContext);
      expect(result.value).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('should evaluate "all" strategy', () => {
      engine.createFlag({ id: 'all', name: 'All' });
      engine.toggleFlag('all', true);
      engine.addRule('all', { priority: 1, strategy: 'all', value: true, enabled: true });

      expect(engine.isEnabled('all', baseContext)).toBe(true);
    });

    it('should evaluate "none" strategy', () => {
      engine.createFlag({ id: 'none', name: 'None' });
      engine.toggleFlag('none', true);
      engine.addRule('none', { priority: 1, strategy: 'none', value: true, enabled: true });

      expect(engine.isEnabled('none', baseContext)).toBe(false);
    });

    it('should evaluate "user_list" strategy', () => {
      engine.createFlag({ id: 'ul', name: 'UserList' });
      engine.toggleFlag('ul', true);
      engine.addRule('ul', {
        priority: 1, strategy: 'user_list', value: true,
        userIds: ['user-1', 'user-2'],
        enabled: true,
      });

      expect(engine.isEnabled('ul', { userId: 'user-1' })).toBe(true);
      expect(engine.isEnabled('ul', { userId: 'user-3' })).toBe(false);
    });

    it('should evaluate "plan" strategy', () => {
      engine.createFlag({ id: 'plan', name: 'Plan' });
      engine.toggleFlag('plan', true);
      engine.addRule('plan', {
        priority: 1, strategy: 'plan', value: true,
        plans: ['pro', 'enterprise'],
        enabled: true,
      });

      expect(engine.isEnabled('plan', { userId: 'u1', plan: 'pro' })).toBe(true);
      expect(engine.isEnabled('plan', { userId: 'u2', plan: 'free' })).toBe(false);
      expect(engine.isEnabled('plan', { userId: 'u3' })).toBe(false); // No plan
    });

    it('should evaluate "region" strategy', () => {
      engine.createFlag({ id: 'region', name: 'Region' });
      engine.toggleFlag('region', true);
      engine.addRule('region', {
        priority: 1, strategy: 'region', value: true,
        regions: ['US', 'CA', 'UK'],
        enabled: true,
      });

      expect(engine.isEnabled('region', { userId: 'u1', region: 'US' })).toBe(true);
      expect(engine.isEnabled('region', { userId: 'u2', region: 'JP' })).toBe(false);
    });

    it('should evaluate "schedule" strategy', () => {
      engine.createFlag({ id: 'sched', name: 'Schedule' });
      engine.toggleFlag('sched', true);
      engine.addRule('sched', {
        priority: 1, strategy: 'schedule', value: true,
        schedule: {
          startTime: Date.now() - 3600000,
          endTime: Date.now() + 3600000,
        },
        enabled: true,
      });

      expect(engine.isEnabled('sched', baseContext)).toBe(true);
    });

    it('should not match schedule before start time', () => {
      engine.createFlag({ id: 'sched2', name: 'Schedule2' });
      engine.toggleFlag('sched2', true);
      engine.addRule('sched2', {
        priority: 1, strategy: 'schedule', value: true,
        schedule: {
          startTime: Date.now() + 3600000,
        },
        enabled: true,
      });

      expect(engine.isEnabled('sched2', baseContext)).toBe(false);
    });

    it('should not match schedule after end time', () => {
      engine.createFlag({ id: 'sched3', name: 'Schedule3' });
      engine.toggleFlag('sched3', true);
      engine.addRule('sched3', {
        priority: 1, strategy: 'schedule', value: true,
        schedule: {
          startTime: Date.now() - 7200000,
          endTime: Date.now() - 3600000,
        },
        enabled: true,
      });

      expect(engine.isEnabled('sched3', baseContext)).toBe(false);
    });
  });

  // ─── Evaluation: Percentage Strategy ────────────────────────────

  describe('evaluation - percentage strategy', () => {
    it('should consistently bucket the same user', () => {
      engine.createFlag({ id: 'pct', name: 'Pct' });
      engine.toggleFlag('pct', true);
      engine.addRule('pct', {
        priority: 1, strategy: 'percentage', value: true,
        percentage: 50,
        enabled: true,
      });

      const result1 = engine.evaluate('pct', { userId: 'consistent-user' });
      engine.clearCache();
      const result2 = engine.evaluate('pct', { userId: 'consistent-user' });

      expect(result1.value).toBe(result2.value);
    });

    it('should include 100% of users at 100%', () => {
      engine.createFlag({ id: 'pct100', name: 'Pct100' });
      engine.toggleFlag('pct100', true);
      engine.addRule('pct100', {
        priority: 1, strategy: 'percentage', value: true,
        percentage: 100,
        enabled: true,
      });

      // Test 20 users — all should be included
      for (let i = 0; i < 20; i++) {
        expect(engine.isEnabled('pct100', { userId: `user-${i}` })).toBe(true);
        engine.clearCache();
      }
    });

    it('should include 0% of users at 0%', () => {
      engine.createFlag({ id: 'pct0', name: 'Pct0' });
      engine.toggleFlag('pct0', true);
      engine.addRule('pct0', {
        priority: 1, strategy: 'percentage', value: true,
        percentage: 0,
        enabled: true,
      });

      for (let i = 0; i < 20; i++) {
        expect(engine.isEnabled('pct0', { userId: `user-${i}` })).toBe(false);
        engine.clearCache();
      }
    });
  });

  // ─── Evaluation: Ring Strategy ──────────────────────────────────

  describe('evaluation - ring strategy', () => {
    beforeEach(() => {
      engine.createFlag({ id: 'ring', name: 'Ring' });
      engine.toggleFlag('ring', true);
      engine.addRule('ring', {
        priority: 1, strategy: 'ring', value: true,
        ring: 'beta',
        enabled: true,
      });
    });

    it('should include internal users (lower ring)', () => {
      expect(engine.isEnabled('ring', { userId: 'u1', ring: 'internal' })).toBe(true);
    });

    it('should include alpha users', () => {
      expect(engine.isEnabled('ring', { userId: 'u2', ring: 'alpha' })).toBe(true);
    });

    it('should include beta users (exact match)', () => {
      expect(engine.isEnabled('ring', { userId: 'u3', ring: 'beta' })).toBe(true);
    });

    it('should exclude GA users (higher ring)', () => {
      expect(engine.isEnabled('ring', { userId: 'u4', ring: 'ga' })).toBe(false);
    });

    it('should use default ring when not specified', () => {
      // Default ring is 'ga'
      expect(engine.isEnabled('ring', { userId: 'u5' })).toBe(false);
    });
  });

  // ─── Evaluation: Gradual Rollout ────────────────────────────────

  describe('evaluation - gradual rollout', () => {
    it('should increase percentage over time', () => {
      const now = Date.now();
      engine.createFlag({ id: 'grad', name: 'Gradual' });
      engine.toggleFlag('grad', true);
      engine.addRule('grad', {
        priority: 1, strategy: 'gradual', value: true,
        gradual: {
          startPercentage: 0,
          endPercentage: 100,
          startTime: now - 50000,
          endTime: now + 50000,
        },
        enabled: true,
      });

      // At midpoint, about 50% of users should be included
      let included = 0;
      for (let i = 0; i < 100; i++) {
        engine.clearCache();
        if (engine.isEnabled('grad', { userId: `gradual-user-${i}` })) {
          included++;
        }
      }

      // Should be roughly 50% ± 20% (statistical variance)
      expect(included).toBeGreaterThan(20);
      expect(included).toBeLessThan(80);
    });

    it('should not include anyone before start', () => {
      engine.createFlag({ id: 'grad2', name: 'Grad2' });
      engine.toggleFlag('grad2', true);
      engine.addRule('grad2', {
        priority: 1, strategy: 'gradual', value: true,
        gradual: {
          startPercentage: 0,
          endPercentage: 100,
          startTime: Date.now() + 100000,
          endTime: Date.now() + 200000,
        },
        enabled: true,
      });

      expect(engine.isEnabled('grad2', baseContext)).toBe(false);
    });
  });

  // ─── Evaluation: Conditions ─────────────────────────────────────

  describe('evaluation - conditions', () => {
    beforeEach(() => {
      engine.createFlag({ id: 'cond', name: 'Conditional' });
      engine.toggleFlag('cond', true);
    });

    it('should evaluate equals condition', () => {
      engine.addRule('cond', {
        priority: 1, strategy: 'all', value: true,
        condition: { field: 'country', operator: 'equals', value: 'US' },
        enabled: true,
      });

      expect(engine.isEnabled('cond', { userId: 'u1', properties: { country: 'US' } })).toBe(true);
      expect(engine.isEnabled('cond', { userId: 'u2', properties: { country: 'UK' } })).toBe(false);
    });

    it('should evaluate not_equals condition', () => {
      engine.addRule('cond', {
        priority: 1, strategy: 'all', value: true,
        condition: { field: 'status', operator: 'not_equals', value: 'banned' },
        enabled: true,
      });

      expect(engine.isEnabled('cond', { userId: 'u1', properties: { status: 'active' } })).toBe(true);
      expect(engine.isEnabled('cond', { userId: 'u2', properties: { status: 'banned' } })).toBe(false);
    });

    it('should evaluate contains condition', () => {
      engine.addRule('cond', {
        priority: 1, strategy: 'all', value: true,
        condition: { field: 'email', operator: 'contains', value: '@company.com' },
        enabled: true,
      });

      expect(engine.isEnabled('cond', { userId: 'u1', properties: { email: 'john@company.com' } })).toBe(true);
      expect(engine.isEnabled('cond', { userId: 'u2', properties: { email: 'john@gmail.com' } })).toBe(false);
    });

    it('should evaluate greater_than condition', () => {
      engine.addRule('cond', {
        priority: 1, strategy: 'all', value: true,
        condition: { field: 'age', operator: 'greater_than', value: 18 },
        enabled: true,
      });

      expect(engine.isEnabled('cond', { userId: 'u1', properties: { age: 25 } })).toBe(true);
      expect(engine.isEnabled('cond', { userId: 'u2', properties: { age: 16 } })).toBe(false);
    });

    it('should evaluate less_than condition', () => {
      engine.addRule('cond', {
        priority: 1, strategy: 'all', value: true,
        condition: { field: 'score', operator: 'less_than', value: 100 },
        enabled: true,
      });

      expect(engine.isEnabled('cond', { userId: 'u1', properties: { score: 50 } })).toBe(true);
      expect(engine.isEnabled('cond', { userId: 'u2', properties: { score: 150 } })).toBe(false);
    });

    it('should evaluate in condition', () => {
      engine.addRule('cond', {
        priority: 1, strategy: 'all', value: true,
        condition: { field: 'role', operator: 'in', value: ['admin', 'manager'] },
        enabled: true,
      });

      expect(engine.isEnabled('cond', { userId: 'u1', properties: { role: 'admin' } })).toBe(true);
      expect(engine.isEnabled('cond', { userId: 'u2', properties: { role: 'viewer' } })).toBe(false);
    });

    it('should evaluate exists condition', () => {
      engine.addRule('cond', {
        priority: 1, strategy: 'all', value: true,
        condition: { field: 'premium', operator: 'exists', value: true },
        enabled: true,
      });

      expect(engine.isEnabled('cond', { userId: 'u1', properties: { premium: true } })).toBe(true);
      expect(engine.isEnabled('cond', { userId: 'u2', properties: {} })).toBe(false);
    });

    it('should evaluate regex condition', () => {
      engine.addRule('cond', {
        priority: 1, strategy: 'all', value: true,
        condition: { field: 'email', operator: 'regex', value: '^.*@internal\\.com$' },
        enabled: true,
      });

      expect(engine.isEnabled('cond', { userId: 'u1', properties: { email: 'test@internal.com' } })).toBe(true);
      expect(engine.isEnabled('cond', { userId: 'u2', properties: { email: 'test@external.com' } })).toBe(false);
    });
  });

  // ─── User Overrides ─────────────────────────────────────────────

  describe('user overrides', () => {
    it('should override evaluation for specific user', () => {
      engine.createFlag({ id: 'ov', name: 'Override' });
      engine.toggleFlag('ov', true);
      engine.addRule('ov', { priority: 1, strategy: 'none', value: false, enabled: true });

      // Without override — should be false
      expect(engine.isEnabled('ov', { userId: 'vip' })).toBe(false);

      // With override — should be true
      engine.setOverride('ov', 'vip', true);
      engine.clearCache();
      expect(engine.isEnabled('ov', { userId: 'vip' })).toBe(true);

      // Other users still false
      engine.clearCache();
      expect(engine.isEnabled('ov', { userId: 'regular' })).toBe(false);
    });

    it('should remove overrides', () => {
      engine.createFlag({ id: 'ov2', name: 'Override2' });
      engine.toggleFlag('ov2', true);
      engine.setOverride('ov2', 'user1', true);

      expect(engine.removeOverride('ov2', 'user1')).toBe(true);
      expect(engine.removeOverride('ov2', 'nonexistent')).toBe(false);
    });

    it('should get all overrides for a flag', () => {
      engine.setOverride('flag1', 'user1', true);
      engine.setOverride('flag1', 'user2', false);

      const overrides = engine.getOverrides('flag1');
      expect(overrides.size).toBe(2);
    });
  });

  // ─── Convenience Methods ────────────────────────────────────────

  describe('convenience methods', () => {
    it('should getString with fallback', () => {
      engine.createFlag({ id: 'str', name: 'String', valueType: 'string', defaultValue: 'hello' });
      engine.toggleFlag('str', true);
      engine.addRule('str', { priority: 1, strategy: 'all', value: 'world', enabled: true });

      expect(engine.getString('str', baseContext)).toBe('world');
      expect(engine.getString('missing', baseContext, 'fallback')).toBe('fallback');
    });

    it('should getNumber with fallback', () => {
      engine.createFlag({ id: 'num', name: 'Number', valueType: 'number', defaultValue: 0 });
      engine.toggleFlag('num', true);
      engine.addRule('num', { priority: 1, strategy: 'all', value: 42, enabled: true });

      expect(engine.getNumber('num', baseContext)).toBe(42);
      expect(engine.getNumber('missing', baseContext, 99)).toBe(99);
    });

    it('should evaluateAll active flags', () => {
      engine.createFlag({ id: 'a', name: 'A' });
      engine.createFlag({ id: 'b', name: 'B' });
      engine.toggleFlag('a', true);
      engine.toggleFlag('b', true);
      engine.addRule('a', { priority: 1, strategy: 'all', value: true, enabled: true });
      engine.addRule('b', { priority: 1, strategy: 'all', value: 'test', enabled: true });

      const all = engine.evaluateAll(baseContext);
      expect(all.size).toBe(2);
      expect(all.get('a')).toBe(true);
      expect(all.get('b')).toBe('test');
    });
  });

  // ─── Rule Priority ──────────────────────────────────────────────

  describe('rule priority', () => {
    it('should evaluate higher-priority rules first', () => {
      engine.createFlag({ id: 'pri', name: 'Priority' });
      engine.toggleFlag('pri', true);

      engine.addRule('pri', { priority: 2, strategy: 'all', value: 'low', enabled: true });
      engine.addRule('pri', { priority: 1, strategy: 'all', value: 'high', enabled: true });

      const result = engine.evaluate('pri', baseContext);
      expect(result.value).toBe('high');
    });

    it('should skip disabled rules', () => {
      engine.createFlag({ id: 'dis', name: 'Disabled' });
      engine.toggleFlag('dis', true);

      engine.addRule('dis', { priority: 1, strategy: 'all', value: 'disabled', enabled: false });
      engine.addRule('dis', { priority: 2, strategy: 'all', value: 'enabled', enabled: true });

      const result = engine.evaluate('dis', baseContext);
      expect(result.value).toBe('enabled');
    });

    it('should fall through to default when no rules match', () => {
      engine.createFlag({ id: 'fall', name: 'Fallthrough', defaultValue: 'default_val' });
      engine.toggleFlag('fall', true);

      engine.addRule('fall', {
        priority: 1, strategy: 'user_list', value: 'matched',
        userIds: ['other-user'],
        enabled: true,
      });

      const result = engine.evaluate('fall', { userId: 'different-user' });
      expect(result.value).toBe('default_val');
      expect(result.reason).toBe('default');
    });
  });

  // ─── Experiments / A/B Testing ──────────────────────────────────

  describe('experiments', () => {
    it('should create an experiment', () => {
      engine.createFlag({ id: 'exp-flag', name: 'Experiment Flag' });

      const experiment = engine.createExperiment({
        id: 'exp-1',
        name: 'Pricing Test',
        flagId: 'exp-flag',
        variants: [
          { id: 'control', name: 'Control', value: 79, weight: 50 },
          { id: 'test', name: 'Test', value: 99, weight: 50 },
        ],
        sampleSize: 1000,
        metric: 'revenue',
      });

      expect(experiment.status).toBe('draft');
      expect(experiment.variants).toHaveLength(2);
    });

    it('should validate variant weights sum to 100', () => {
      engine.createFlag({ id: 'exp-flag2', name: 'Flag2' });

      expect(() => engine.createExperiment({
        id: 'bad-exp',
        name: 'Bad',
        flagId: 'exp-flag2',
        variants: [
          { id: 'a', name: 'A', value: 1, weight: 30 },
          { id: 'b', name: 'B', value: 2, weight: 30 },
        ],
      })).toThrow(/100/);
    });

    it('should start an experiment', () => {
      engine.createFlag({ id: 'ef', name: 'EF' });
      engine.createExperiment({
        id: 'e1',
        name: 'E1',
        flagId: 'ef',
        variants: [
          { id: 'a', name: 'A', value: true, weight: 50 },
          { id: 'b', name: 'B', value: false, weight: 50 },
        ],
      });

      const started = engine.startExperiment('e1');
      expect(started!.status).toBe('running');
      expect(started!.startedAt).toBeDefined();
    });

    it('should assign consistent variants', () => {
      engine.createFlag({ id: 'ef2', name: 'EF2' });
      engine.createExperiment({
        id: 'e2',
        name: 'E2',
        flagId: 'ef2',
        variants: [
          { id: 'ctrl', name: 'Control', value: 'A', weight: 50 },
          { id: 'test', name: 'Test', value: 'B', weight: 50 },
        ],
      });
      engine.startExperiment('e2');

      const v1 = engine.getVariant('e2', 'user-42');
      const v2 = engine.getVariant('e2', 'user-42');
      expect(v1!.id).toBe(v2!.id);
    });

    it('should record impressions and conversions', () => {
      engine.createFlag({ id: 'ef3', name: 'EF3' });
      engine.createExperiment({
        id: 'e3',
        name: 'E3',
        flagId: 'ef3',
        variants: [
          { id: 'ctrl', name: 'Control', value: true, weight: 50 },
          { id: 'test', name: 'Test', value: false, weight: 50 },
        ],
      });
      engine.startExperiment('e3');

      engine.recordImpression('e3', 'ctrl');
      engine.recordImpression('e3', 'ctrl');
      engine.recordConversion('e3', 'ctrl', 10);

      const exp = engine.getExperiment('e3')!;
      const ctrl = exp.variants.find(v => v.id === 'ctrl')!;
      expect(ctrl.impressions).toBe(2);
      expect(ctrl.conversions).toBe(1);
      expect(ctrl.conversionRate).toBe(0.5);
      expect(ctrl.revenue).toBe(10);
    });

    it('should complete experiment and determine winner', () => {
      engine.createFlag({ id: 'ef4', name: 'EF4' });
      engine.createExperiment({
        id: 'e4',
        name: 'E4',
        flagId: 'ef4',
        variants: [
          { id: 'ctrl', name: 'Control', value: true, weight: 50 },
          { id: 'test', name: 'Test', value: false, weight: 50 },
        ],
      });
      engine.startExperiment('e4');

      // Simulate: test has better conversion
      for (let i = 0; i < 100; i++) {
        engine.recordImpression('e4', 'ctrl');
        engine.recordImpression('e4', 'test');
      }
      for (let i = 0; i < 20; i++) engine.recordConversion('e4', 'ctrl');
      for (let i = 0; i < 35; i++) engine.recordConversion('e4', 'test');

      const completed = engine.completeExperiment('e4');
      expect(completed!.status).toBe('completed');
      expect(completed!.winningVariant).toBe('test');
    });

    it('should calculate statistical significance', () => {
      engine.createFlag({ id: 'ef5', name: 'EF5' });
      engine.createExperiment({
        id: 'e5',
        name: 'E5',
        flagId: 'ef5',
        variants: [
          { id: 'a', name: 'A', value: 1, weight: 50 },
          { id: 'b', name: 'B', value: 2, weight: 50 },
        ],
      });
      engine.startExperiment('e5');

      // Simulate large sample with clear difference
      for (let i = 0; i < 1000; i++) {
        engine.recordImpression('e5', 'a');
        engine.recordImpression('e5', 'b');
      }
      for (let i = 0; i < 100; i++) engine.recordConversion('e5', 'a');
      for (let i = 0; i < 200; i++) engine.recordConversion('e5', 'b');

      const sig = engine.calculateSignificance('e5', 'a', 'b');
      expect(sig.significant).toBe(true);
      expect(sig.confidence).toBeGreaterThanOrEqual(95);
      expect(sig.winner).toBe('b');
    });

    it('should return not significant for small samples', () => {
      engine.createFlag({ id: 'ef6', name: 'EF6' });
      engine.createExperiment({
        id: 'e6',
        name: 'E6',
        flagId: 'ef6',
        variants: [
          { id: 'a', name: 'A', value: 1, weight: 50 },
          { id: 'b', name: 'B', value: 2, weight: 50 },
        ],
      });
      engine.startExperiment('e6');

      // Too few impressions
      for (let i = 0; i < 10; i++) {
        engine.recordImpression('e6', 'a');
        engine.recordImpression('e6', 'b');
      }

      const sig = engine.calculateSignificance('e6', 'a', 'b');
      expect(sig.significant).toBe(false);
    });

    it('should enforce max experiments', () => {
      const engine2 = new FeatureFlagEngine({ maxExperiments: 1 });
      engine2.createFlag({ id: 'f1', name: 'F1' });
      engine2.createExperiment({
        id: 'e1', name: 'E1', flagId: 'f1',
        variants: [{ id: 'a', name: 'A', value: 1, weight: 100 }],
      });

      expect(() => engine2.createExperiment({
        id: 'e2', name: 'E2', flagId: 'f1',
        variants: [{ id: 'a', name: 'A', value: 1, weight: 100 }],
      })).toThrow(/maximum/i);
    });

    it('should get all experiments', () => {
      engine.createFlag({ id: 'f1', name: 'F1' });
      engine.createExperiment({
        id: 'e1', name: 'E1', flagId: 'f1',
        variants: [{ id: 'a', name: 'A', value: 1, weight: 100 }],
      });
      engine.createExperiment({
        id: 'e2', name: 'E2', flagId: 'f1',
        variants: [{ id: 'a', name: 'A', value: 1, weight: 100 }],
      });

      expect(engine.getAllExperiments()).toHaveLength(2);
    });
  });

  // ─── Platform Flags ─────────────────────────────────────────────

  describe('platform flags', () => {
    it('should create platform-specific flags', () => {
      const flags = engine.createPlatformFlags();
      expect(flags.length).toBeGreaterThanOrEqual(10);
      expect(engine.getFlag('agent:inventory')).toBeDefined();
      expect(engine.getFlag('agent:security')).toBeDefined();
      expect(engine.getFlag('billing:pay_per_count')).toBeDefined();
    });

    it('should not create duplicates on re-call', () => {
      engine.createPlatformFlags();
      const count1 = engine.getAllFlags().length;
      engine.createPlatformFlags();
      const count2 = engine.getAllFlags().length;
      expect(count1).toBe(count2);
    });
  });

  // ─── Caching ────────────────────────────────────────────────────

  describe('caching', () => {
    it('should cache evaluations', () => {
      engine.createFlag({ id: 'cached', name: 'Cached' });
      engine.toggleFlag('cached', true);
      engine.addRule('cached', { priority: 1, strategy: 'all', value: 'v1', enabled: true });

      engine.evaluate('cached', baseContext);
      // Change the rule value
      const flag = engine.getFlag('cached')!;
      flag.rules[0].value = 'v2';

      // Should still return cached value
      const cached = engine.evaluate('cached', baseContext);
      expect(cached.value).toBe('v1');
    });

    it('should clear cache on flag toggle', () => {
      engine.createFlag({ id: 'cc', name: 'CC' });
      engine.toggleFlag('cc', true);
      engine.addRule('cc', { priority: 1, strategy: 'all', value: 'original', enabled: true });
      engine.evaluate('cc', baseContext);

      engine.toggleFlag('cc', false);
      engine.toggleFlag('cc', true);

      const result = engine.evaluate('cc', baseContext);
      expect(result.value).toBe('original'); // Re-evaluated
    });

    it('should clear all cache', () => {
      engine.createFlag({ id: 'ca', name: 'CA' });
      engine.toggleFlag('ca', true);
      engine.evaluate('ca', baseContext);

      engine.clearCache();
      expect(engine.getStats().cacheSize).toBe(0);
    });
  });

  // ─── Audit Log ──────────────────────────────────────────────────

  describe('audit log', () => {
    it('should log flag creation', () => {
      engine.createFlag({ id: 'aud', name: 'Audit' });
      const log = engine.getAuditLog({ flagId: 'aud' });
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].action).toBe('created');
    });

    it('should filter by action', () => {
      engine.createFlag({ id: 'a1', name: 'A1' });
      engine.toggleFlag('a1', true);

      const toggleLog = engine.getAuditLog({ action: 'toggled' });
      expect(toggleLog.length).toBe(1);
    });

    it('should limit results', () => {
      for (let i = 0; i < 10; i++) {
        engine.createFlag({ id: `l${i}`, name: `L${i}` });
      }
      const limited = engine.getAuditLog({ limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it('should not log when audit is disabled', () => {
      const noAudit = new FeatureFlagEngine({ enableAudit: false });
      noAudit.createFlag({ id: 'na', name: 'NA' });
      expect(noAudit.getAuditLog()).toHaveLength(0);
    });
  });

  // ─── Stats & Voice ──────────────────────────────────────────────

  describe('stats and voice', () => {
    it('should return comprehensive stats', () => {
      engine.createFlag({ id: 's1', name: 'S1' });
      engine.createFlag({ id: 's2', name: 'S2' });
      engine.toggleFlag('s1', true);
      engine.archiveFlag('s2');
      engine.addRule('s1', { priority: 1, strategy: 'all', value: true, enabled: true });
      engine.setOverride('s1', 'user1', false);

      const stats = engine.getStats();
      expect(stats.totalFlags).toBe(2);
      expect(stats.activeFlags).toBe(1);
      expect(stats.archivedFlags).toBe(1);
      expect(stats.totalRules).toBe(1);
      expect(stats.totalOverrides).toBe(1);
    });

    it('should generate voice summary', () => {
      engine.createFlag({ id: 'v1', name: 'V1' });
      engine.toggleFlag('v1', true);

      const summary = engine.generateVoiceSummary();
      expect(summary).toContain('feature flag');
    });

    it('should reset engine', () => {
      engine.createFlag({ id: 'r', name: 'R' });
      engine.reset();
      expect(engine.getStats().totalFlags).toBe(0);
      expect(engine.getStats().auditEntries).toBe(0);
    });
  });
});
