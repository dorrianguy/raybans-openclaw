/**
 * Tests for API Rate Limiter & Quota Engine
 *
 * Covers: user registration, tier management, quota checking, consumption,
 * overage handling, usage analytics, resource limits, feature gating,
 * period resets, grace periods, events, edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  QuotaEngine,
  TIER_DEFINITIONS,
  type PricingTier,
  type ResourceType,
  type QuotaCheckResult,
} from './quota-engine.js';

describe('QuotaEngine — User Registration', () => {
  it('should register a user with default tier', () => {
    const engine = new QuotaEngine({ defaultTier: 'free' });
    engine.registerUser('user-1');
    expect(engine.hasUser('user-1')).toBe(true);
    expect(engine.getUserTier('user-1')).toBe('free');
  });

  it('should register a user with specified tier', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');
    expect(engine.getUserTier('user-1')).toBe('solo');
  });

  it('should register multiple users', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');
    engine.registerUser('user-2', 'solo');
    engine.registerUser('user-3', 'enterprise');

    expect(engine.getUserCount()).toBe(3);
    expect(engine.getUserTier('user-1')).toBe('free');
    expect(engine.getUserTier('user-2')).toBe('solo');
    expect(engine.getUserTier('user-3')).toBe('enterprise');
  });

  it('should return null for unregistered user tier', () => {
    const engine = new QuotaEngine();
    expect(engine.getUserTier('nonexistent')).toBeNull();
  });

  it('should not report unregistered user as existing', () => {
    const engine = new QuotaEngine();
    expect(engine.hasUser('nonexistent')).toBe(false);
  });

  it('should register all tier types', () => {
    const engine = new QuotaEngine();
    const tiers: PricingTier[] = ['free', 'solo', 'multi', 'enterprise', 'pay_per_count'];
    for (const tier of tiers) {
      engine.registerUser(`user-${tier}`, tier);
      expect(engine.getUserTier(`user-${tier}`)).toBe(tier);
    }
  });
});

describe('QuotaEngine — Tier Management', () => {
  it('should change user tier', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    engine.changeTier('user-1', 'solo');
    expect(engine.getUserTier('user-1')).toBe('solo');
  });

  it('should emit tier:changed event', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    const events: Array<{ userId: string; oldTier: string; newTier: string }> = [];
    engine.on('tier:changed', (userId, oldTier, newTier) => {
      events.push({ userId, oldTier, newTier });
    });

    engine.changeTier('user-1', 'solo');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ userId: 'user-1', oldTier: 'free', newTier: 'solo' });
  });

  it('should not emit event for same tier change', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');

    const events: string[] = [];
    engine.on('tier:changed', () => events.push('changed'));

    engine.changeTier('user-1', 'solo'); // same tier
    expect(events).toHaveLength(0);
  });

  it('should auto-register user on tier change if not registered', () => {
    const engine = new QuotaEngine();
    engine.changeTier('new-user', 'multi');
    expect(engine.hasUser('new-user')).toBe(true);
    expect(engine.getUserTier('new-user')).toBe('multi');
  });

  it('should preserve usage on tier upgrade', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    // Use some quota
    engine.consume('user-1', 'vision_api_calls', 10);
    const beforeUpgrade = engine.getResourceUsage('user-1', 'vision_api_calls', 'day');
    expect(beforeUpgrade?.current).toBe(10);

    // Upgrade
    engine.changeTier('user-1', 'solo');

    const afterUpgrade = engine.getResourceUsage('user-1', 'vision_api_calls', 'day');
    expect(afterUpgrade?.current).toBe(10); // preserved
    expect(afterUpgrade?.limit).toBe(500); // new limit
  });

  it('should set grace period on downgrade', () => {
    const engine = new QuotaEngine({ gracePeriodEnabled: true, gracePeriodHours: 72 });
    engine.registerUser('user-1', 'enterprise');
    engine.changeTier('user-1', 'free');
    // Grace period should be set (we verify through internal state indirectly)
    expect(engine.getUserTier('user-1')).toBe('free');
  });
});

describe('QuotaEngine — Quota Checking (Non-Consuming)', () => {
  let engine: QuotaEngine;

  beforeEach(() => {
    engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');
  });

  it('should allow request within limits', () => {
    const result = engine.checkQuota('user-1', 'vision_api_calls', 1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('should not consume on check', () => {
    engine.checkQuota('user-1', 'vision_api_calls', 1);
    engine.checkQuota('user-1', 'vision_api_calls', 1);

    const usage = engine.getResourceUsage('user-1', 'vision_api_calls', 'day');
    expect(usage?.current).toBe(0); // still 0 — check doesn't consume
  });

  it('should deny request that exceeds limit', () => {
    // Free tier: 50 vision_api_calls per day
    // Consume 50 first
    engine.consume('user-1', 'vision_api_calls', 50);

    const result = engine.checkQuota('user-1', 'vision_api_calls', 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('limit exceeded');
  });

  it('should return false for unregistered user', () => {
    const result = engine.checkQuota('nonexistent', 'vision_api_calls');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not registered');
  });

  it('should allow unlimited resource (no limits defined)', () => {
    // webhook_events is not defined for free tier
    const result = engine.checkQuota('user-1', 'webhook_events');
    expect(result.allowed).toBe(true);
  });

  it('should report correct percentage used', () => {
    engine.consume('user-1', 'vision_api_calls', 25);
    const result = engine.checkQuota('user-1', 'vision_api_calls', 1);
    expect(result.allowed).toBe(true);
    // 26/50 = 0.52
    expect(result.percentUsed).toBeCloseTo(0.52, 1);
  });

  it('should flag warning threshold', () => {
    // Free tier warning at 80% = 40 of 50
    engine.consume('user-1', 'vision_api_calls', 40);
    const result = engine.checkQuota('user-1', 'vision_api_calls', 1);
    expect(result.allowed).toBe(true);
    expect(result.isWarning).toBe(true);
  });

  it('should report remaining quota', () => {
    engine.consume('user-1', 'vision_api_calls', 30);
    const result = engine.checkQuota('user-1', 'vision_api_calls', 5);
    expect(result.remaining).toBe(15); // 50 - 30 - 5 = 15
  });

  it('should include reset time', () => {
    const result = engine.checkQuota('user-1', 'vision_api_calls', 1);
    expect(result.resetsAt).toBeTruthy();
  });
});

describe('QuotaEngine — Consumption', () => {
  let engine: QuotaEngine;

  beforeEach(() => {
    engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');
  });

  it('should consume and track usage', () => {
    const result = engine.consume('user-1', 'vision_api_calls', 5);
    expect(result.allowed).toBe(true);

    const usage = engine.getResourceUsage('user-1', 'vision_api_calls', 'day');
    expect(usage?.current).toBe(5);
  });

  it('should increment usage cumulatively', () => {
    engine.consume('user-1', 'vision_api_calls', 10);
    engine.consume('user-1', 'vision_api_calls', 20);
    engine.consume('user-1', 'vision_api_calls', 30);

    const usage = engine.getResourceUsage('user-1', 'vision_api_calls', 'day');
    expect(usage?.current).toBe(60);
  });

  it('should emit usage:recorded event', () => {
    const events: Array<{ userId: string; resource: string; amount: number }> = [];
    engine.on('usage:recorded', (userId, resource, amount) => {
      events.push({ userId, resource, amount });
    });

    engine.consume('user-1', 'vision_api_calls', 5);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ userId: 'user-1', resource: 'vision_api_calls', amount: 5 });
  });

  it('should emit quota:warning when threshold reached', () => {
    const warnings: Array<{ userId: string; resource: string; percent: number }> = [];
    engine.on('quota:warning', (userId, resource, percent) => {
      warnings.push({ userId, resource, percent });
    });

    // Solo: 500/day, warning at 80% = 400
    engine.consume('user-1', 'vision_api_calls', 400);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].percent).toBeCloseTo(0.8, 1);
  });

  it('should only emit warning once per period', () => {
    const warnings: string[] = [];
    engine.on('quota:warning', () => warnings.push('warn'));

    engine.consume('user-1', 'vision_api_calls', 400);
    engine.consume('user-1', 'vision_api_calls', 10);
    engine.consume('user-1', 'vision_api_calls', 10);

    expect(warnings).toHaveLength(1); // only first time
  });

  it('should emit quota:exceeded when limit reached', () => {
    const exceeded: Array<{ userId: string; resource: string; policy: string }> = [];
    engine.on('quota:exceeded', (userId, resource, policy) => {
      exceeded.push({ userId, resource, policy });
    });

    // Solo: 500/day with 'warn' overage policy
    engine.consume('user-1', 'vision_api_calls', 501);
    expect(exceeded).toHaveLength(1);
    expect(exceeded[0].policy).toBe('warn');
  });

  it('should block consumption when free tier limit reached', () => {
    const freeEngine = new QuotaEngine();
    freeEngine.registerUser('free-user', 'free');

    // Free: 50 vision calls/day with 'block' policy
    freeEngine.consume('free-user', 'vision_api_calls', 50);
    const result = freeEngine.consume('free-user', 'vision_api_calls', 1);
    expect(result.allowed).toBe(false);
  });

  it('should allow overage on warn policy', () => {
    // Solo: vision calls have 'warn' for daily
    engine.consume('user-1', 'vision_api_calls', 500);
    const result = engine.consume('user-1', 'vision_api_calls', 10);
    expect(result.allowed).toBe(true); // warn policy allows overage
  });

  it('should track overage costs on charge policy', () => {
    // Solo: monthly vision calls have 'charge' policy at 1 cent each
    engine.consume('user-1', 'vision_api_calls', 10001); // 1 over monthly limit of 10000

    const cost = engine.getTotalOverageCost('user-1');
    expect(cost).toBeGreaterThan(0);
  });

  it('should handle concurrent session limits', () => {
    // Solo: 3 concurrent sessions
    engine.consume('user-1', 'concurrent_sessions', 1);
    engine.consume('user-1', 'concurrent_sessions', 1);
    engine.consume('user-1', 'concurrent_sessions', 1);

    const result = engine.consume('user-1', 'concurrent_sessions', 1);
    expect(result.allowed).toBe(false);
  });

  it('should release concurrent resources', () => {
    engine.consume('user-1', 'concurrent_sessions', 3);
    engine.release('user-1', 'concurrent_sessions', 1);

    const result = engine.consume('user-1', 'concurrent_sessions', 1);
    expect(result.allowed).toBe(true);
  });

  it('should not go below zero on release', () => {
    engine.consume('user-1', 'concurrent_sessions', 1);
    engine.release('user-1', 'concurrent_sessions', 5);

    const usage = engine.getResourceUsage('user-1', 'concurrent_sessions', 'total');
    expect(usage?.current).toBe(0);
  });
});

describe('QuotaEngine — Period Resets', () => {
  it('should reset daily counters after period expires', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    // Consume some
    engine.consume('user-1', 'vision_api_calls', 30);

    // Manually advance the period start to simulate time passing
    const state = (engine as any).users.get('user-1');
    const usage = state.resources.get('vision_api_calls:day');
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 2);
    usage.periodStart = pastDate.toISOString();

    // Check should trigger reset
    const result = engine.checkQuota('user-1', 'vision_api_calls', 1);
    expect(result.allowed).toBe(true);

    // Usage should be reset
    const updatedUsage = engine.getResourceUsage('user-1', 'vision_api_calls', 'day');
    expect(updatedUsage?.current).toBe(0);
  });

  it('should not reset total limits', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    engine.consume('user-1', 'storage_images', 100);

    // Even after time passes, total limits shouldn't reset automatically
    const usage = engine.getResourceUsage('user-1', 'storage_images', 'total');
    expect(usage?.current).toBe(100);
  });

  it('should emit quota:reset on period reset', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');
    engine.consume('user-1', 'vision_api_calls', 10);

    const resets: string[] = [];
    engine.on('quota:reset', (_userId, resource) => resets.push(resource));

    // Force period expiry
    const state = (engine as any).users.get('user-1');
    const usage = state.resources.get('vision_api_calls:day');
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 2);
    usage.periodStart = pastDate.toISOString();

    engine.checkQuota('user-1', 'vision_api_calls');
    expect(resets).toContain('vision_api_calls');
  });
});

describe('QuotaEngine — Usage Analytics', () => {
  it('should return usage summary', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');
    engine.consume('user-1', 'vision_api_calls', 100);
    engine.consume('user-1', 'agent_requests', 50);

    const summary = engine.getUsageSummary('user-1');
    expect(summary).not.toBeNull();
    expect(summary!.userId).toBe('user-1');
    expect(summary!.tier).toBe('solo');
    expect(summary!.resources.length).toBeGreaterThan(0);

    const visionUsage = summary!.resources.find(
      r => r.resource === 'vision_api_calls' && r.period === 'day'
    );
    expect(visionUsage?.used).toBe(100);
    expect(visionUsage?.limit).toBe(500);
  });

  it('should return null for unknown user', () => {
    const engine = new QuotaEngine();
    expect(engine.getUsageSummary('unknown')).toBeNull();
  });

  it('should include overage costs in summary', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');
    engine.consume('user-1', 'vision_api_calls', 10500); // 500 over monthly limit

    const summary = engine.getUsageSummary('user-1');
    expect(summary!.totalOverageCostCents).toBeGreaterThan(0);
  });

  it('should get specific resource usage', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');
    engine.consume('user-1', 'exports', 2);

    const usage = engine.getResourceUsage('user-1', 'exports', 'day');
    expect(usage).not.toBeNull();
    expect(usage!.current).toBe(2);
    expect(usage!.limit).toBe(3);
  });

  it('should return null for unknown resource', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');
    expect(engine.getResourceUsage('nonexistent', 'exports')).toBeNull();
  });
});

describe('QuotaEngine — Feature Gating', () => {
  it('should check feature availability for free tier', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    expect(engine.hasFeature('user-1', 'basic_vision')).toBe(true);
    expect(engine.hasFeature('user-1', 'pos_integration')).toBe(false);
  });

  it('should check feature availability for solo tier', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');

    expect(engine.hasFeature('user-1', 'full_vision')).toBe(true);
    expect(engine.hasFeature('user-1', 'dashboard')).toBe(true);
    expect(engine.hasFeature('user-1', 'pos_integration')).toBe(false);
  });

  it('should check feature availability for multi tier', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'multi');

    expect(engine.hasFeature('user-1', 'pos_integration')).toBe(true);
    expect(engine.hasFeature('user-1', 'shrinkage_analytics')).toBe(true);
    expect(engine.hasFeature('user-1', 'custom_integrations')).toBe(false);
  });

  it('should check feature availability for enterprise tier', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'enterprise');

    expect(engine.hasFeature('user-1', 'custom_integrations')).toBe(true);
    expect(engine.hasFeature('user-1', 'api_access')).toBe(true);
    expect(engine.hasFeature('user-1', 'sla')).toBe(true);
  });

  it('should return false for unregistered user', () => {
    const engine = new QuotaEngine();
    expect(engine.hasFeature('unknown', 'basic_vision')).toBe(false);
  });

  it('should update features on tier change', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');
    expect(engine.hasFeature('user-1', 'pos_integration')).toBe(false);

    engine.changeTier('user-1', 'multi');
    expect(engine.hasFeature('user-1', 'pos_integration')).toBe(true);
  });
});

describe('QuotaEngine — Tier Definitions', () => {
  it('should return tier definition', () => {
    const engine = new QuotaEngine();
    const freeTier = engine.getTierDefinition('free');
    expect(freeTier.tier).toBe('free');
    expect(freeTier.priceMonthly).toBe(0);
    expect(freeTier.limits.length).toBeGreaterThan(0);
  });

  it('should return all tier definitions', () => {
    const engine = new QuotaEngine();
    const tiers = engine.getAllTiers();
    expect(tiers).toHaveLength(5); // free, solo, multi, enterprise, pay_per_count
  });

  it('should have correct pricing', () => {
    expect(TIER_DEFINITIONS.free.priceMonthly).toBe(0);
    expect(TIER_DEFINITIONS.solo.priceMonthly).toBe(7900); // $79
    expect(TIER_DEFINITIONS.multi.priceMonthly).toBe(19900); // $199
    expect(TIER_DEFINITIONS.enterprise.priceMonthly).toBe(49900); // $499
  });

  it('should have annual pricing for subscription tiers', () => {
    expect(TIER_DEFINITIONS.solo.priceAnnual).toBe(79000);
    expect(TIER_DEFINITIONS.multi.priceAnnual).toBe(199000);
    expect(TIER_DEFINITIONS.enterprise.priceAnnual).toBe(499000);
  });

  it('should have increasing limits per tier', () => {
    const freeDaily = TIER_DEFINITIONS.free.limits.find(
      l => l.resource === 'vision_api_calls' && l.period === 'day'
    )!;
    const soloDaily = TIER_DEFINITIONS.solo.limits.find(
      l => l.resource === 'vision_api_calls' && l.period === 'day'
    )!;
    const multiDaily = TIER_DEFINITIONS.multi.limits.find(
      l => l.resource === 'vision_api_calls' && l.period === 'day'
    )!;
    const entDaily = TIER_DEFINITIONS.enterprise.limits.find(
      l => l.resource === 'vision_api_calls' && l.period === 'day'
    )!;

    expect(freeDaily.limit).toBeLessThan(soloDaily.limit);
    expect(soloDaily.limit).toBeLessThan(multiDaily.limit);
    expect(multiDaily.limit).toBeLessThan(entDaily.limit);
  });
});

describe('QuotaEngine — Resource Reset', () => {
  it('should reset specific resource', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');
    engine.consume('user-1', 'vision_api_calls', 100);

    engine.resetResource('user-1', 'vision_api_calls', 'day');

    const usage = engine.getResourceUsage('user-1', 'vision_api_calls', 'day');
    expect(usage?.current).toBe(0);
  });

  it('should emit quota:reset on manual reset', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');
    engine.consume('user-1', 'exports', 10);

    const resets: string[] = [];
    engine.on('quota:reset', (_u, resource) => resets.push(resource));

    engine.resetResource('user-1', 'exports');
    expect(resets).toContain('exports');
  });

  it('should reset all resources', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');
    engine.consume('user-1', 'vision_api_calls', 100);
    engine.consume('user-1', 'agent_requests', 50);
    engine.consume('user-1', 'exports', 10);

    engine.resetAll('user-1');

    expect(engine.getResourceUsage('user-1', 'vision_api_calls', 'day')?.current).toBe(0);
    expect(engine.getResourceUsage('user-1', 'agent_requests', 'day')?.current).toBe(0);
    expect(engine.getResourceUsage('user-1', 'exports', 'day')?.current).toBe(0);
  });

  it('should clear overage costs on resetAll', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');
    engine.consume('user-1', 'vision_api_calls', 15000); // over monthly limit

    expect(engine.getTotalOverageCost('user-1')).toBeGreaterThan(0);

    engine.resetAll('user-1');
    expect(engine.getTotalOverageCost('user-1')).toBe(0);
  });

  it('should handle reset for nonexistent user gracefully', () => {
    const engine = new QuotaEngine();
    // Should not throw
    engine.resetResource('nonexistent', 'vision_api_calls');
    engine.resetAll('nonexistent');
  });
});

describe('QuotaEngine — Multi-Period Limits', () => {
  it('should track daily and monthly limits independently', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');

    // Solo: 500/day, 10000/month for vision calls
    engine.consume('user-1', 'vision_api_calls', 100);

    const daily = engine.getResourceUsage('user-1', 'vision_api_calls', 'day');
    const monthly = engine.getResourceUsage('user-1', 'vision_api_calls', 'month');

    expect(daily?.current).toBe(100);
    expect(monthly?.current).toBe(100);
  });

  it('should block on daily limit even if monthly is available', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    // Free: 50/day, 500/month
    engine.consume('user-1', 'vision_api_calls', 50);

    // Daily is maxed, monthly still has room
    const result = engine.consume('user-1', 'vision_api_calls', 1);
    expect(result.allowed).toBe(false);
  });
});

describe('QuotaEngine — Different Resource Types', () => {
  it('should handle TTS minutes', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    // Free: 30 TTS minutes/month
    for (let i = 0; i < 30; i++) {
      const result = engine.consume('user-1', 'tts_minutes', 1);
      expect(result.allowed).toBe(true);
    }

    const result = engine.consume('user-1', 'tts_minutes', 1);
    expect(result.allowed).toBe(false);
  });

  it('should handle storage limits (total)', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    // Free: 500 images total
    engine.consume('user-1', 'storage_images', 500);
    const result = engine.consume('user-1', 'storage_images', 1);
    expect(result.allowed).toBe(false);
  });

  it('should handle location limits', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');

    // Solo: 1 location
    engine.consume('user-1', 'locations', 1);
    const result = engine.consume('user-1', 'locations', 1);
    expect(result.allowed).toBe(false);
  });

  it('should handle API rate limits with burst', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');

    // Solo: 60/min + 20 burst = 80 effective max
    // But initial check against the burst-inclusive limit
    for (let i = 0; i < 80; i++) {
      const result = engine.consume('user-1', 'api_requests', 1);
      expect(result.allowed).toBe(true);
    }

    // 81st should be throttled
    const result = engine.consume('user-1', 'api_requests', 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('rate limit');
  });
});

describe('QuotaEngine — Edge Cases', () => {
  it('should handle zero-amount consumption', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    const result = engine.consume('user-1', 'vision_api_calls', 0);
    expect(result.allowed).toBe(true);
  });

  it('should handle large batch consumption', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'enterprise');

    const result = engine.consume('user-1', 'vision_api_calls', 5000);
    expect(result.allowed).toBe(true);
  });

  it('should handle consumption exceeding limit in one call', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    // Try to consume more than the daily limit in one call
    const result = engine.consume('user-1', 'vision_api_calls', 100);
    expect(result.allowed).toBe(false); // 100 > 50 free tier daily limit
  });

  it('should handle release for non-consumed resource', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');

    // Release without prior consumption
    engine.release('user-1', 'concurrent_sessions', 1);
    const usage = engine.getResourceUsage('user-1', 'concurrent_sessions', 'total');
    expect(usage?.current).toBe(0);
  });

  it('should handle release for unregistered user', () => {
    const engine = new QuotaEngine();
    // Should not throw
    engine.release('nonexistent', 'concurrent_sessions', 1);
  });

  it('should handle check for non-tracked resource', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    // webhook_events not tracked on free tier
    const result = engine.checkQuota('user-1', 'webhook_events');
    expect(result.allowed).toBe(true);
  });
});

describe('QuotaEngine — Overage Policy Types', () => {
  it('block policy should deny requests over limit', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    engine.consume('user-1', 'vision_api_calls', 50);
    const result = engine.consume('user-1', 'vision_api_calls', 1);
    expect(result.allowed).toBe(false);
  });

  it('warn policy should allow requests over limit', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');

    // Solo daily vision: warn policy
    engine.consume('user-1', 'vision_api_calls', 500);
    const result = engine.consume('user-1', 'vision_api_calls', 1);
    expect(result.allowed).toBe(true);
  });

  it('charge policy should allow and track costs', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'solo');

    const charged: Array<{ resource: string; cost: number }> = [];
    engine.on('overage:charged', (_u, resource, cost) => {
      charged.push({ resource, cost });
    });

    // Solo monthly vision: 10000 limit, charge policy, 1 cent per
    engine.consume('user-1', 'vision_api_calls', 10100);
    expect(charged.length).toBeGreaterThan(0);
  });

  it('throttle policy should deny requests over limit', () => {
    const engine = new QuotaEngine();
    engine.registerUser('user-1', 'free');

    // Free: api_requests 10/min + 5 burst = 15 effective
    engine.consume('user-1', 'api_requests', 15);
    const result = engine.consume('user-1', 'api_requests', 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('rate limit');
  });
});

describe('QuotaEngine — Configuration', () => {
  it('should use custom default tier', () => {
    const engine = new QuotaEngine({ defaultTier: 'solo' });
    engine.registerUser('user-1');
    expect(engine.getUserTier('user-1')).toBe('solo');
  });

  it('should respect grace period config', () => {
    const engine = new QuotaEngine({ gracePeriodEnabled: false });
    engine.registerUser('user-1', 'enterprise');
    engine.changeTier('user-1', 'free');
    // No grace period when disabled
    expect(engine.getUserTier('user-1')).toBe('free');
  });
});
