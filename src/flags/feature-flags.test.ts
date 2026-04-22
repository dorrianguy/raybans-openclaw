/**
 * Tests for Feature Flag System
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FeatureFlagManager,
  DEFAULT_FLAG_CONFIG,
  type FeatureFlag,
  type EvaluationContext,
  type PlanId,
} from './feature-flags.js';

describe('FeatureFlagManager', () => {
  let manager: FeatureFlagManager;

  beforeEach(() => {
    manager = new FeatureFlagManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  // ─── Flag Creation ────────────────────────────────────────────────────

  describe('createFlag', () => {
    it('should create a flag with required fields', () => {
      const flag = manager.createFlag({
        id: 'inventory_vision',
        name: 'Inventory Vision',
      });

      expect(flag.id).toBe('inventory_vision');
      expect(flag.name).toBe('Inventory Vision');
      expect(flag.status).toBe('disabled');
      expect(flag.category).toBe('core');
      expect(flag.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('should create a flag with all optional fields', () => {
      const flag = manager.createFlag({
        id: 'test',
        name: 'Test Flag',
        description: 'A test flag',
        category: 'experimental',
        status: 'enabled',
        allowedPlans: ['enterprise'],
        rolloutPercentage: 50,
        enabledUsers: ['user1'],
        disabledUsers: ['user2'],
        dependsOn: [],
        owner: 'dorrian',
        tags: ['beta', 'inventory'],
        metadata: { version: 2 },
      });

      expect(flag.description).toBe('A test flag');
      expect(flag.category).toBe('experimental');
      expect(flag.status).toBe('enabled');
      expect(flag.allowedPlans).toEqual(['enterprise']);
      expect(flag.rolloutPercentage).toBe(50);
      expect(flag.enabledUsers).toEqual(['user1']);
      expect(flag.disabledUsers).toEqual(['user2']);
      expect(flag.owner).toBe('dorrian');
      expect(flag.tags).toEqual(['beta', 'inventory']);
    });

    it('should throw on duplicate flag ID', () => {
      manager.createFlag({ id: 'test', name: 'Test' });
      expect(() => manager.createFlag({ id: 'test', name: 'Test 2' })).toThrow("already exists");
    });

    it('should throw on invalid rollout percentage', () => {
      expect(() =>
        manager.createFlag({ id: 'test', name: 'Test', rolloutPercentage: -1 })
      ).toThrow('between 0 and 100');

      expect(() =>
        manager.createFlag({ id: 'test', name: 'Test', rolloutPercentage: 101 })
      ).toThrow('between 0 and 100');
    });

    it('should validate variant weights sum to 100', () => {
      expect(() =>
        manager.createFlag({
          id: 'test',
          name: 'Test',
          variants: [
            { id: 'a', name: 'A', weight: 30 },
            { id: 'b', name: 'B', weight: 30 },
          ],
        })
      ).toThrow('weights must sum to 100');
    });

    it('should accept valid variant weights', () => {
      const flag = manager.createFlag({
        id: 'test',
        name: 'Test',
        variants: [
          { id: 'a', name: 'A', weight: 50 },
          { id: 'b', name: 'B', weight: 50 },
        ],
      });
      expect(flag.variants?.length).toBe(2);
    });

    it('should check dependency flags exist', () => {
      expect(() =>
        manager.createFlag({ id: 'test', name: 'Test', dependsOn: ['nonexistent'] })
      ).toThrow("Dependency flag 'nonexistent' not found");
    });

    it('should enforce max flags limit', () => {
      const mgr = new FeatureFlagManager({ maxFlags: 2 });
      mgr.createFlag({ id: 'f1', name: 'F1' });
      mgr.createFlag({ id: 'f2', name: 'F2' });
      expect(() => mgr.createFlag({ id: 'f3', name: 'F3' })).toThrow('Maximum of 2 flags');
      mgr.destroy();
    });

    it('should emit flag:created event', () => {
      const handler = vi.fn();
      manager.on('flag:created', handler);

      manager.createFlag({ id: 'test', name: 'Test' });
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].id).toBe('test');
    });
  });

  // ─── Flag Update ──────────────────────────────────────────────────────

  describe('updateFlag', () => {
    it('should update flag fields', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'disabled' });

      const updated = manager.updateFlag('test', {
        status: 'enabled',
        name: 'Updated Test',
      });

      expect(updated.status).toBe('enabled');
      expect(updated.name).toBe('Updated Test');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);
    });

    it('should emit flag:updated event with changes', () => {
      manager.createFlag({ id: 'test', name: 'Test' });

      const handler = vi.fn();
      manager.on('flag:updated', handler);

      manager.updateFlag('test', { name: 'New Name' });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][1]).toContain('name');
    });

    it('should emit flag:status_changed event', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'disabled' });

      const handler = vi.fn();
      manager.on('flag:status_changed', handler);

      manager.updateFlag('test', { status: 'enabled' });

      expect(handler).toHaveBeenCalledWith('test', 'disabled', 'enabled');
    });

    it('should throw for nonexistent flag', () => {
      expect(() => manager.updateFlag('nonexistent', { name: 'X' })).toThrow('not found');
    });

    it('should validate rollout percentage on update', () => {
      manager.createFlag({ id: 'test', name: 'Test' });
      expect(() => manager.updateFlag('test', { rolloutPercentage: 150 })).toThrow('between 0 and 100');
    });
  });

  // ─── Flag Delete ──────────────────────────────────────────────────────

  describe('deleteFlag', () => {
    it('should delete a flag', () => {
      manager.createFlag({ id: 'test', name: 'Test' });
      manager.deleteFlag('test');

      expect(manager.getFlag('test')).toBeUndefined();
      expect(manager.getFlagCount()).toBe(0);
    });

    it('should emit flag:deleted event', () => {
      manager.createFlag({ id: 'test', name: 'Test' });

      const handler = vi.fn();
      manager.on('flag:deleted', handler);

      manager.deleteFlag('test');
      expect(handler).toHaveBeenCalledWith('test');
    });

    it('should throw for nonexistent flag', () => {
      expect(() => manager.deleteFlag('nonexistent')).toThrow('not found');
    });

    it('should prevent deletion of flags with dependents', () => {
      manager.createFlag({ id: 'base', name: 'Base', status: 'enabled' });
      manager.createFlag({ id: 'child', name: 'Child', dependsOn: ['base'] });

      expect(() => manager.deleteFlag('base')).toThrow("flag 'child' depends on it");
    });
  });

  // ─── Flag Queries ─────────────────────────────────────────────────────

  describe('getters', () => {
    beforeEach(() => {
      manager.createFlag({ id: 'f1', name: 'F1', category: 'core', tags: ['inventory'] });
      manager.createFlag({ id: 'f2', name: 'F2', category: 'agent', tags: ['ai'] });
      manager.createFlag({ id: 'f3', name: 'F3', category: 'core', tags: ['inventory', 'ai'] });
    });

    it('should get all flags', () => {
      expect(manager.getAllFlags().length).toBe(3);
    });

    it('should get flags by category', () => {
      const core = manager.getFlagsByCategory('core');
      expect(core.length).toBe(2);
    });

    it('should get flags by tag', () => {
      const inventory = manager.getFlagsByTag('inventory');
      expect(inventory.length).toBe(2);

      const ai = manager.getFlagsByTag('ai');
      expect(ai.length).toBe(2);
    });

    it('should get flag count', () => {
      expect(manager.getFlagCount()).toBe(3);
    });
  });

  // ─── Flag Evaluation ──────────────────────────────────────────────────

  describe('isEnabled', () => {
    it('should return false for disabled flags', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'disabled' });
      expect(manager.isEnabled('test', { userId: 'user1' })).toBe(false);
    });

    it('should return true for enabled flags', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'enabled' });
      expect(manager.isEnabled('test', { userId: 'user1' })).toBe(true);
    });

    it('should return false for nonexistent flags', () => {
      expect(manager.isEnabled('nonexistent', { userId: 'user1' })).toBe(false);
    });
  });

  describe('evaluate — user overrides', () => {
    it('should enable for whitelisted users', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        enabledUsers: ['vip-user'],
      });

      const result = manager.evaluate('test', { userId: 'vip-user' });
      expect(result.result).toBe(true);
      expect(result.reason).toBe('user_override_enabled');
    });

    it('should disable for blacklisted users', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'enabled',
        disabledUsers: ['banned-user'],
      });

      const result = manager.evaluate('test', { userId: 'banned-user' });
      expect(result.result).toBe(false);
      expect(result.reason).toBe('user_override_disabled');
    });

    it('should prioritize disabled override over enabled override', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'enabled',
        enabledUsers: ['user1'],
        disabledUsers: ['user1'],
      });

      expect(manager.isEnabled('test', { userId: 'user1' })).toBe(false);
    });
  });

  describe('evaluate — plan gating', () => {
    it('should enable for allowed plans', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        allowedPlans: ['enterprise', 'multi_store'],
      });

      expect(manager.isEnabled('test', { userId: 'user1', planId: 'enterprise' })).toBe(true);
      expect(manager.isEnabled('test', { userId: 'user1', planId: 'multi_store' })).toBe(true);
    });

    it('should disable for non-allowed plans', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        allowedPlans: ['enterprise'],
      });

      const result = manager.evaluate('test', { userId: 'user1', planId: 'free' });
      expect(result.result).toBe(false);
      expect(result.reason).toBe('plan_denied');
    });

    it('should disable when no plan provided for plan-gated flag', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        allowedPlans: ['enterprise'],
      });

      expect(manager.isEnabled('test', { userId: 'user1' })).toBe(false);
    });
  });

  describe('evaluate — time windows', () => {
    it('should disable before enableAfter', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        enableAfter: Date.now() + 100000,
      });

      const result = manager.evaluate('test', { userId: 'user1' });
      expect(result.result).toBe(false);
      expect(result.reason).toBe('time_window_inactive');
    });

    it('should enable after enableAfter', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        enableAfter: Date.now() - 100000,
      });

      expect(manager.isEnabled('test', { userId: 'user1' })).toBe(true);
    });

    it('should disable after enableUntil', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        enableUntil: Date.now() - 100000,
      });

      const result = manager.evaluate('test', { userId: 'user1' });
      expect(result.result).toBe(false);
      expect(result.reason).toBe('time_window_inactive');
    });

    it('should enable within time window', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        enableAfter: Date.now() - 100000,
        enableUntil: Date.now() + 100000,
      });

      expect(manager.isEnabled('test', { userId: 'user1' })).toBe(true);
    });
  });

  describe('evaluate — rollout percentage', () => {
    it('should include/exclude users deterministically', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        rolloutPercentage: 50,
      });

      // Same user should always get the same result
      const result1 = manager.isEnabled('test', { userId: 'consistent-user' });
      const result2 = manager.isEnabled('test', { userId: 'consistent-user' });
      expect(result1).toBe(result2);
    });

    it('should include everyone at 100%', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'enabled',
        rolloutPercentage: 100,
      });

      // At 100%, all users should be included
      for (let i = 0; i < 20; i++) {
        expect(manager.isEnabled('test', { userId: `user${i}` })).toBe(true);
      }
    });

    it('should exclude everyone at 0%', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        rolloutPercentage: 0,
      });

      for (let i = 0; i < 20; i++) {
        expect(manager.isEnabled('test', { userId: `user${i}` })).toBe(false);
      }
    });

    it('should distribute users across rollout range', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        rolloutPercentage: 50,
      });

      let enabledCount = 0;
      const total = 100;
      for (let i = 0; i < total; i++) {
        if (manager.isEnabled('test', { userId: `user-${i}` })) {
          enabledCount++;
        }
      }

      // Should be roughly 50%, allow ±25% variance
      expect(enabledCount).toBeGreaterThan(20);
      expect(enabledCount).toBeLessThan(80);
    });
  });

  describe('evaluate — dependencies', () => {
    it('should disable when dependency is disabled', () => {
      manager.createFlag({ id: 'base', name: 'Base', status: 'disabled' });
      manager.createFlag({ id: 'child', name: 'Child', status: 'enabled', dependsOn: ['base'] });

      const result = manager.evaluate('child', { userId: 'user1' });
      expect(result.result).toBe(false);
      expect(result.reason).toBe('dependency_not_met');
    });

    it('should enable when all dependencies are enabled', () => {
      manager.createFlag({ id: 'base', name: 'Base', status: 'enabled' });
      manager.createFlag({ id: 'child', name: 'Child', status: 'enabled', dependsOn: ['base'] });

      expect(manager.isEnabled('child', { userId: 'user1' })).toBe(true);
    });

    it('should disable when any dependency is disabled', () => {
      manager.createFlag({ id: 'base1', name: 'Base1', status: 'enabled' });
      manager.createFlag({ id: 'base2', name: 'Base2', status: 'disabled' });
      manager.createFlag({ id: 'child', name: 'Child', status: 'enabled', dependsOn: ['base1', 'base2'] });

      expect(manager.isEnabled('child', { userId: 'user1' })).toBe(false);
    });
  });

  // ─── A/B Testing Variants ─────────────────────────────────────────────

  describe('getVariant', () => {
    it('should return a variant for enabled flags', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'enabled',
        variants: [
          { id: 'control', name: 'Control', weight: 50 },
          { id: 'treatment', name: 'Treatment', weight: 50 },
        ],
      });

      const variant = manager.getVariant('test', { userId: 'user1' });
      expect(variant).toBeDefined();
      expect(['control', 'treatment']).toContain(variant!.id);
    });

    it('should return undefined for disabled flags', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'disabled',
        variants: [
          { id: 'a', name: 'A', weight: 50 },
          { id: 'b', name: 'B', weight: 50 },
        ],
      });

      const variant = manager.getVariant('test', { userId: 'user1' });
      expect(variant).toBeUndefined();
    });

    it('should return undefined for flags without variants', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'enabled' });
      const variant = manager.getVariant('test', { userId: 'user1' });
      expect(variant).toBeUndefined();
    });

    it('should return consistent variant for same user', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'enabled',
        variants: [
          { id: 'a', name: 'A', weight: 50 },
          { id: 'b', name: 'B', weight: 50 },
        ],
      });

      const v1 = manager.getVariant('test', { userId: 'consistent-user' });
      const v2 = manager.getVariant('test', { userId: 'consistent-user' });
      expect(v1!.id).toBe(v2!.id);
    });

    it('should respect variant weight distribution', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'enabled',
        variants: [
          { id: 'a', name: 'A', weight: 80 },
          { id: 'b', name: 'B', weight: 20 },
        ],
      });

      let countA = 0;
      let countB = 0;
      for (let i = 0; i < 100; i++) {
        const v = manager.getVariant('test', { userId: `user-${i}` });
        if (v?.id === 'a') countA++;
        else countB++;
      }

      // A should be ~80%, allow some variance
      expect(countA).toBeGreaterThan(50);
      expect(countB).toBeGreaterThan(0);
    });
  });

  // ─── Bulk Flag Evaluation ─────────────────────────────────────────────

  describe('getEnabledFlags', () => {
    it('should return all enabled flags for a context', () => {
      manager.createFlag({ id: 'f1', name: 'F1', status: 'enabled' });
      manager.createFlag({ id: 'f2', name: 'F2', status: 'disabled' });
      manager.createFlag({ id: 'f3', name: 'F3', status: 'enabled' });

      const enabled = manager.getEnabledFlags({ userId: 'user1' });
      expect(enabled).toEqual(['f1', 'f3']);
    });

    it('should respect plan gating', () => {
      manager.createFlag({ id: 'f1', name: 'F1', status: 'enabled' });
      manager.createFlag({
        id: 'f2', name: 'F2', status: 'conditional',
        allowedPlans: ['enterprise'],
      });

      const freeUser = manager.getEnabledFlags({ userId: 'user1', planId: 'free' });
      expect(freeUser).toEqual(['f1']);

      const enterpriseUser = manager.getEnabledFlags({ userId: 'user1', planId: 'enterprise' });
      expect(enterpriseUser).toEqual(['f1', 'f2']);
    });
  });

  // ─── Bulk Operations ──────────────────────────────────────────────────

  describe('enableFlag / disableFlag', () => {
    it('should enable a flag', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'disabled' });
      manager.enableFlag('test');

      expect(manager.getFlag('test')!.status).toBe('enabled');
    });

    it('should disable a flag', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'enabled' });
      manager.disableFlag('test');

      expect(manager.getFlag('test')!.status).toBe('disabled');
    });
  });

  describe('enableForUser / disableForUser', () => {
    it('should add user to enabled list', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'conditional' });
      manager.enableForUser('test', 'vip-user');

      expect(manager.isEnabled('test', { userId: 'vip-user' })).toBe(true);
    });

    it('should add user to disabled list', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'enabled' });
      manager.disableForUser('test', 'bad-user');

      expect(manager.isEnabled('test', { userId: 'bad-user' })).toBe(false);
    });

    it('should move user from disabled to enabled', () => {
      manager.createFlag({
        id: 'test', name: 'Test', status: 'conditional',
        disabledUsers: ['user1'],
      });

      manager.enableForUser('test', 'user1');

      const flag = manager.getFlag('test')!;
      expect(flag.enabledUsers).toContain('user1');
      expect(flag.disabledUsers).not.toContain('user1');
    });

    it('should move user from enabled to disabled', () => {
      manager.createFlag({
        id: 'test', name: 'Test', status: 'conditional',
        enabledUsers: ['user1'],
      });

      manager.disableForUser('test', 'user1');

      const flag = manager.getFlag('test')!;
      expect(flag.disabledUsers).toContain('user1');
      expect(flag.enabledUsers).not.toContain('user1');
    });

    it('should throw for nonexistent flag', () => {
      expect(() => manager.enableForUser('nonexistent', 'user1')).toThrow('not found');
      expect(() => manager.disableForUser('nonexistent', 'user1')).toThrow('not found');
    });

    it('should enforce max user overrides', () => {
      const mgr = new FeatureFlagManager({ maxUserOverridesPerFlag: 2 });
      mgr.createFlag({ id: 'test', name: 'Test' });
      mgr.enableForUser('test', 'user1');
      mgr.enableForUser('test', 'user2');

      expect(() => mgr.enableForUser('test', 'user3')).toThrow('Maximum of 2 user overrides');

      mgr.destroy();
    });
  });

  describe('setRollout', () => {
    it('should set rollout percentage and status to conditional', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'disabled' });
      manager.setRollout('test', 25);

      const flag = manager.getFlag('test')!;
      expect(flag.rolloutPercentage).toBe(25);
      expect(flag.status).toBe('conditional');
    });
  });

  // ─── Audit Log ────────────────────────────────────────────────────────

  describe('audit log', () => {
    it('should record evaluations', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'enabled' });
      manager.isEnabled('test', { userId: 'user1' });
      manager.isEnabled('test', { userId: 'user2' });

      const log = manager.getAuditLog();
      expect(log.length).toBe(2);
    });

    it('should filter audit log by flagId', () => {
      manager.createFlag({ id: 'f1', name: 'F1', status: 'enabled' });
      manager.createFlag({ id: 'f2', name: 'F2', status: 'enabled' });

      manager.isEnabled('f1', { userId: 'user1' });
      manager.isEnabled('f2', { userId: 'user1' });

      const log = manager.getAuditLog({ flagId: 'f1' });
      expect(log.length).toBe(1);
    });

    it('should filter audit log by userId', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'enabled' });
      manager.isEnabled('test', { userId: 'user1' });
      manager.isEnabled('test', { userId: 'user2' });

      const log = manager.getAuditLog({ userId: 'user1' });
      expect(log.length).toBe(1);
    });

    it('should limit audit log results', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'enabled' });
      for (let i = 0; i < 10; i++) {
        manager.isEnabled('test', { userId: `user${i}` });
      }

      const log = manager.getAuditLog({ limit: 3 });
      expect(log.length).toBe(3);
    });

    it('should trim audit log when exceeding max', () => {
      const mgr = new FeatureFlagManager({ maxAuditLog: 10 });
      mgr.createFlag({ id: 'test', name: 'Test', status: 'enabled' });

      for (let i = 0; i < 15; i++) {
        mgr.isEnabled('test', { userId: `user${i}` });
      }

      const log = mgr.getAuditLog({ limit: 100 });
      expect(log.length).toBeLessThanOrEqual(10);

      mgr.destroy();
    });

    it('should not record evaluations when audit disabled', () => {
      const mgr = new FeatureFlagManager({ auditEnabled: false });
      mgr.createFlag({ id: 'test', name: 'Test', status: 'enabled' });
      mgr.isEnabled('test', { userId: 'user1' });

      const log = mgr.getAuditLog();
      expect(log.length).toBe(0);

      mgr.destroy();
    });
  });

  describe('getFlagStats', () => {
    it('should calculate evaluation stats', () => {
      manager.createFlag({ id: 'test', name: 'Test', status: 'enabled' });
      manager.isEnabled('test', { userId: 'user1' }); // true
      manager.isEnabled('test', { userId: 'user2' }); // true

      const stats = manager.getFlagStats('test');
      expect(stats.totalEvaluations).toBe(2);
      expect(stats.enabledCount).toBe(2);
      expect(stats.enableRate).toBe(1);
    });

    it('should track evaluation reasons', () => {
      manager.createFlag({
        id: 'test', name: 'Test', status: 'enabled',
        disabledUsers: ['blocked'],
      });
      manager.isEnabled('test', { userId: 'user1' }); // enabled
      manager.isEnabled('test', { userId: 'blocked' }); // disabled

      const stats = manager.getFlagStats('test');
      expect(stats.topReasons['flag_enabled']).toBe(1);
      expect(stats.topReasons['user_override_disabled']).toBe(1);
    });
  });

  // ─── Summary ──────────────────────────────────────────────────────────

  describe('getSummary', () => {
    it('should return correct counts', () => {
      manager.createFlag({ id: 'f1', name: 'F1', status: 'enabled', category: 'core' });
      manager.createFlag({ id: 'f2', name: 'F2', status: 'disabled', category: 'core' });
      manager.createFlag({ id: 'f3', name: 'F3', status: 'conditional', category: 'agent' });

      const summary = manager.getSummary();
      expect(summary.totalFlags).toBe(3);
      expect(summary.enabled).toBe(1);
      expect(summary.disabled).toBe(1);
      expect(summary.conditional).toBe(1);
      expect(summary.byCategory).toEqual({ core: 2, agent: 1 });
    });
  });

  describe('generateVoiceSummary', () => {
    it('should generate a voice-friendly summary', () => {
      manager.createFlag({ id: 'f1', name: 'F1', status: 'enabled', category: 'core' });
      manager.createFlag({ id: 'f2', name: 'F2', status: 'disabled', category: 'agent' });

      const summary = manager.generateVoiceSummary();
      expect(summary).toContain('2 feature flags configured');
      expect(summary).toContain('1 enabled');
      expect(summary).toContain('1 disabled');
    });
  });

  // ─── Platform Flags ───────────────────────────────────────────────────

  describe('createPlatformFlags', () => {
    it('should create all standard platform flags', () => {
      manager.createPlatformFlags();

      expect(manager.getFlagCount()).toBeGreaterThanOrEqual(10);
      expect(manager.getFlag('inventory_vision')).toBeDefined();
      expect(manager.getFlag('voice_commands')).toBeDefined();
      expect(manager.getFlag('barcode_scanning')).toBeDefined();
      expect(manager.getFlag('security_agent')).toBeDefined();
      expect(manager.getFlag('dark_mode')).toBeDefined();
    });

    it('should not duplicate flags on repeated calls', () => {
      manager.createPlatformFlags();
      const count1 = manager.getFlagCount();

      manager.createPlatformFlags();
      expect(manager.getFlagCount()).toBe(count1);
    });

    it('should gate premium features by plan', () => {
      manager.createPlatformFlags();

      // Free users shouldn't get security agent
      expect(manager.isEnabled('security_agent', { userId: 'u1', planId: 'free' })).toBe(false);

      // Enterprise users should
      expect(manager.isEnabled('security_agent', { userId: 'u1', planId: 'enterprise' })).toBe(true);

      // Debug agent = enterprise only
      expect(manager.isEnabled('debug_agent', { userId: 'u1', planId: 'solo_store' })).toBe(false);
      expect(manager.isEnabled('debug_agent', { userId: 'u1', planId: 'enterprise' })).toBe(true);
    });
  });

  // ─── Complex Evaluation Scenarios ─────────────────────────────────────

  describe('complex scenarios', () => {
    it('should handle plan + rollout combo', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        allowedPlans: ['enterprise'],
        rolloutPercentage: 50,
      });

      // Free users should never get it
      for (let i = 0; i < 20; i++) {
        expect(manager.isEnabled('test', { userId: `user${i}`, planId: 'free' })).toBe(false);
      }

      // Enterprise users get it ~50% of the time
      let enabled = 0;
      for (let i = 0; i < 100; i++) {
        if (manager.isEnabled('test', { userId: `ent${i}`, planId: 'enterprise' })) {
          enabled++;
        }
      }
      expect(enabled).toBeGreaterThan(20);
      expect(enabled).toBeLessThan(80);
    });

    it('should allow user override to bypass plan restrictions', () => {
      manager.createFlag({
        id: 'test',
        name: 'Test',
        status: 'conditional',
        allowedPlans: ['enterprise'],
        enabledUsers: ['vip-free-user'],
      });

      // VIP user on free plan should still get access
      expect(manager.isEnabled('test', { userId: 'vip-free-user', planId: 'free' })).toBe(true);
    });

    it('should handle chained dependencies', () => {
      manager.createFlag({ id: 'base', name: 'Base', status: 'enabled' });
      manager.createFlag({ id: 'mid', name: 'Mid', status: 'enabled', dependsOn: ['base'] });
      manager.createFlag({ id: 'top', name: 'Top', status: 'enabled', dependsOn: ['mid'] });

      expect(manager.isEnabled('top', { userId: 'user1' })).toBe(true);

      // Disable base — should cascade
      manager.disableFlag('base');
      expect(manager.isEnabled('top', { userId: 'user1' })).toBe(false);
    });
  });
});
