/**
 * API Rate Limiter Tests — Night Shift #30
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ApiRateLimiter, type PlanTier, type RateLimitRule } from './api-rate-limiter';

describe('ApiRateLimiter', () => {
  let limiter: ApiRateLimiter;

  beforeEach(() => {
    limiter = new ApiRateLimiter({ cleanupIntervalMs: 0 }); // disable cleanup timer
  });

  afterEach(() => {
    limiter.destroy();
  });

  // ── Basic Rate Limiting ────────────────────────────────────────────────

  describe('basic rate limiting', () => {
    it('should allow requests under the limit', () => {
      const result = limiter.checkLimit('customer-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
      expect(result.cost).toBe(1);
    });

    it('should include rate limit headers', () => {
      const result = limiter.checkLimit('customer-1');
      expect(result.headers['X-RateLimit-Limit']).toBeDefined();
      expect(result.headers['X-RateLimit-Remaining']).toBeDefined();
      expect(result.headers['X-RateLimit-Reset']).toBeDefined();
    });

    it('should decrement remaining on each request', () => {
      const r1 = limiter.checkLimit('customer-1');
      const r2 = limiter.checkLimit('customer-1');
      expect(r2.remaining).toBeLessThan(r1.remaining);
    });

    it('should deny when limit is exhausted', () => {
      // Use a custom plan with very low limits
      const tightLimiter = new ApiRateLimiter({
        planLimits: {
          free: {
            global: {
              maxRequests: 3,
              windowMs: 60000,
              burstAllowance: 0,
              graceRequests: 0,
            },
          },
          solo: { global: { maxRequests: 100, windowMs: 3600000 } },
          multi: { global: { maxRequests: 500, windowMs: 3600000 } },
          enterprise: { global: { maxRequests: 5000, windowMs: 3600000 } },
          internal: { global: { maxRequests: 100000, windowMs: 3600000 } },
        },
        cleanupIntervalMs: 0,
      });

      tightLimiter.checkLimit('customer-1');
      tightLimiter.checkLimit('customer-1');
      tightLimiter.checkLimit('customer-1');
      const denied = tightLimiter.checkLimit('customer-1');

      expect(denied.allowed).toBe(false);
      expect(denied.retryAfterMs).toBeGreaterThan(0);
      tightLimiter.destroy();
    });
  });

  // ── Plan-Based Limits ──────────────────────────────────────────────────

  describe('plan-based limits', () => {
    it('should use default plan (free) for unknown customers', () => {
      expect(limiter.getCustomerPlan('unknown')).toBe('free');
    });

    it('should use assigned plan', () => {
      limiter.setCustomerPlan('cust-1', 'enterprise');
      expect(limiter.getCustomerPlan('cust-1')).toBe('enterprise');
    });

    it('should remove customer plan', () => {
      limiter.setCustomerPlan('cust-1', 'solo');
      limiter.removeCustomer('cust-1');
      expect(limiter.getCustomerPlan('cust-1')).toBe('free');
    });

    it('should apply different limits per plan', () => {
      limiter.setCustomerPlan('free-user', 'free');
      limiter.setCustomerPlan('enterprise-user', 'enterprise');

      // Both should get allowed, but with different limits
      const freeResult = limiter.checkLimit('free-user');
      const entResult = limiter.checkLimit('enterprise-user');

      expect(freeResult.allowed).toBe(true);
      expect(entResult.allowed).toBe(true);
      // Enterprise should have higher limit
      expect(entResult.limit).toBeGreaterThan(freeResult.limit);
    });
  });

  // ── Endpoint-Specific Limits ───────────────────────────────────────────

  describe('endpoint limits', () => {
    it('should apply endpoint-specific rules', () => {
      // Free plan has /api/vision at 20 req/hr with cost 5
      const visionResult = limiter.checkLimit('customer-1', '/api/vision');
      expect(visionResult.allowed).toBe(true);
      expect(visionResult.cost).toBe(5);
    });

    it('should use global limits for unknown endpoints', () => {
      const result = limiter.checkLimit('customer-1', '/api/unknown');
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(1); // global default cost
    });

    it('should enforce endpoint limits independently', () => {
      const tightLimiter = new ApiRateLimiter({
        planLimits: {
          free: {
            global: { maxRequests: 100, windowMs: 60000, graceRequests: 0 },
            endpoints: {
              '/api/vision': {
                maxRequests: 2,
                windowMs: 60000,
                costPerRequest: 1,
              },
            },
          },
          solo: { global: { maxRequests: 1000, windowMs: 3600000 } },
          multi: { global: { maxRequests: 5000, windowMs: 3600000 } },
          enterprise: { global: { maxRequests: 50000, windowMs: 3600000 } },
          internal: { global: { maxRequests: 100000, windowMs: 3600000 } },
        },
        cleanupIntervalMs: 0,
      });

      tightLimiter.checkLimit('c1', '/api/vision');
      tightLimiter.checkLimit('c1', '/api/vision');
      const third = tightLimiter.checkLimit('c1', '/api/vision');

      expect(third.allowed).toBe(false);

      // But global should still work
      const globalReq = tightLimiter.checkLimit('c1');
      expect(globalReq.allowed).toBe(true);

      tightLimiter.destroy();
    });
  });

  // ── Grace Period ───────────────────────────────────────────────────────

  describe('grace period', () => {
    it('should allow grace requests regardless of tokens', () => {
      // Free plan has 20 grace requests by default
      for (let i = 0; i < 20; i++) {
        const result = limiter.checkLimit('new-user');
        expect(result.allowed).toBe(true);
      }
    });

    it('should track grace usage', () => {
      limiter.checkLimit('grace-user');
      const usage = limiter.getCustomerUsage('grace-user');
      expect(usage).not.toBeNull();
      expect(usage!.graceRemaining).toBeLessThan(20);
    });
  });

  // ── Whitelist / Blacklist ──────────────────────────────────────────────

  describe('whitelist', () => {
    it('should always allow whitelisted customers', () => {
      limiter.addToWhitelist('vip');

      for (let i = 0; i < 1000; i++) {
        expect(limiter.checkLimit('vip').allowed).toBe(true);
      }

      expect(limiter.isWhitelisted('vip')).toBe(true);
    });

    it('should return unlimited in headers for whitelisted', () => {
      limiter.addToWhitelist('vip');
      const result = limiter.checkLimit('vip');
      expect(result.headers['X-RateLimit-Limit']).toBe('unlimited');
    });

    it('should remove from whitelist', () => {
      limiter.addToWhitelist('vip');
      limiter.removeFromWhitelist('vip');
      expect(limiter.isWhitelisted('vip')).toBe(false);
    });
  });

  describe('blacklist', () => {
    it('should always deny blacklisted customers', () => {
      limiter.addToBlacklist('bad-actor');
      const result = limiter.checkLimit('bad-actor');
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(Infinity);
    });

    it('should move from whitelist to blacklist', () => {
      limiter.addToWhitelist('customer');
      limiter.addToBlacklist('customer');
      expect(limiter.isBlacklisted('customer')).toBe(true);
      expect(limiter.isWhitelisted('customer')).toBe(false);
    });

    it('should move from blacklist to whitelist', () => {
      limiter.addToBlacklist('customer');
      limiter.addToWhitelist('customer');
      expect(limiter.isWhitelisted('customer')).toBe(true);
      expect(limiter.isBlacklisted('customer')).toBe(false);
    });

    it('should remove from blacklist', () => {
      limiter.addToBlacklist('bad');
      limiter.removeFromBlacklist('bad');
      expect(limiter.isBlacklisted('bad')).toBe(false);
    });
  });

  // ── IP-Based Limiting ──────────────────────────────────────────────────

  describe('IP limiting', () => {
    it('should rate limit by IP', () => {
      const result = limiter.checkIpLimit('192.168.1.1');
      expect(result.allowed).toBe(true);
    });

    it('should deny blacklisted IPs', () => {
      limiter.addToBlacklist('10.0.0.1');
      expect(limiter.checkIpLimit('10.0.0.1').allowed).toBe(false);
    });

    it('should allow whitelisted IPs', () => {
      limiter.addToWhitelist('10.0.0.2');
      expect(limiter.checkIpLimit('10.0.0.2').allowed).toBe(true);
    });

    it('should enforce IP limits separately from customer limits', () => {
      // Different IPs get separate buckets
      limiter.checkIpLimit('1.1.1.1');
      limiter.checkIpLimit('2.2.2.2');

      // Both should be allowed
      expect(limiter.checkIpLimit('1.1.1.1').allowed).toBe(true);
      expect(limiter.checkIpLimit('2.2.2.2').allowed).toBe(true);
    });
  });

  // ── Concurrency Limiting ──────────────────────────────────────────────

  describe('concurrency', () => {
    it('should track concurrency slots', () => {
      // Need to check limit first to create the bucket
      limiter.checkLimit('c1');

      expect(limiter.acquireConcurrency('c1')).toBe(true);
      limiter.releaseConcurrency('c1');
    });

    it('should deny when max concurrent reached', () => {
      // Create a plan with maxConcurrent = 1
      const concLimiter = new ApiRateLimiter({
        planLimits: {
          free: {
            global: {
              maxRequests: 100,
              windowMs: 60000,
              maxConcurrent: 1,
              graceRequests: 0,
            },
          },
          solo: { global: { maxRequests: 1000, windowMs: 3600000 } },
          multi: { global: { maxRequests: 5000, windowMs: 3600000 } },
          enterprise: { global: { maxRequests: 50000, windowMs: 3600000 } },
          internal: { global: { maxRequests: 100000, windowMs: 3600000 } },
        },
        cleanupIntervalMs: 0,
      });

      concLimiter.checkLimit('c1'); // create bucket
      expect(concLimiter.acquireConcurrency('c1')).toBe(true);
      expect(concLimiter.acquireConcurrency('c1')).toBe(false);

      concLimiter.releaseConcurrency('c1');
      expect(concLimiter.acquireConcurrency('c1')).toBe(true);

      concLimiter.destroy();
    });

    it('should handle release without acquire', () => {
      // Should not throw
      limiter.releaseConcurrency('nonexistent');
    });
  });

  // ── Cost-Based Limiting ────────────────────────────────────────────────

  describe('cost-based limiting', () => {
    it('should consume more tokens for expensive endpoints', () => {
      const result = limiter.checkLimit('cust-1', '/api/vision');
      expect(result.cost).toBe(5); // vision costs 5 tokens per request
    });

    it('should default to cost 1 for global', () => {
      const result = limiter.checkLimit('cust-1');
      expect(result.cost).toBe(1);
    });
  });

  // ── Customer Usage ─────────────────────────────────────────────────────

  describe('customer usage', () => {
    it('should return null for unknown customers', () => {
      expect(limiter.getCustomerUsage('unknown')).toBeNull();
    });

    it('should track customer usage', () => {
      limiter.checkLimit('tracked');
      limiter.checkLimit('tracked');
      limiter.checkLimit('tracked');

      const usage = limiter.getCustomerUsage('tracked');
      expect(usage).not.toBeNull();
      expect(usage!.totalRequests).toBe(3);
      expect(usage!.plan).toBe('free');
    });
  });

  // ── Plan Limits Introspection ──────────────────────────────────────────

  describe('plan limits', () => {
    it('should return plan configuration', () => {
      const free = limiter.getPlanLimits('free');
      expect(free).toBeDefined();
      expect(free!.global.maxRequests).toBe(100);
    });

    it('should return undefined for unknown plans', () => {
      expect(limiter.getPlanLimits('unknown' as PlanTier)).toBeUndefined();
    });
  });

  // ── Metrics ────────────────────────────────────────────────────────────

  describe('metrics', () => {
    it('should track total allowed and denied', () => {
      limiter.checkLimit('cust-1');
      limiter.checkLimit('cust-1');
      limiter.addToBlacklist('bad');
      limiter.checkLimit('bad');

      const metrics = limiter.getMetrics();
      expect(metrics.totalAllowed).toBe(2);
      expect(metrics.totalDenied).toBe(1);
    });

    it('should track total cost', () => {
      limiter.checkLimit('cust-1');
      limiter.checkLimit('cust-1', '/api/vision');

      const metrics = limiter.getMetrics();
      expect(metrics.totalCost).toBeGreaterThan(1); // vision costs 5
    });

    it('should track plan breakdown', () => {
      limiter.setCustomerPlan('solo-user', 'solo');
      limiter.checkLimit('solo-user');

      const metrics = limiter.getMetrics();
      expect(metrics.planBreakdown['solo']).toBeDefined();
      expect(metrics.planBreakdown['solo'].allowed).toBe(1);
    });

    it('should list top denied customers', () => {
      const tightLimiter = new ApiRateLimiter({
        planLimits: {
          free: {
            global: {
              maxRequests: 1,
              windowMs: 60000,
              burstAllowance: 0,
              graceRequests: 0,
            },
          },
          solo: { global: { maxRequests: 100, windowMs: 3600000 } },
          multi: { global: { maxRequests: 500, windowMs: 3600000 } },
          enterprise: { global: { maxRequests: 5000, windowMs: 3600000 } },
          internal: { global: { maxRequests: 100000, windowMs: 3600000 } },
        },
        cleanupIntervalMs: 0,
      });

      tightLimiter.checkLimit('abuser');
      tightLimiter.checkLimit('abuser');
      tightLimiter.checkLimit('abuser');

      const metrics = tightLimiter.getMetrics();
      expect(metrics.topDenied.length).toBeGreaterThan(0);
      expect(metrics.topDenied[0].id).toBe('abuser');
      tightLimiter.destroy();
    });

    it('should reset metrics', () => {
      limiter.checkLimit('cust-1');
      limiter.resetMetrics();

      const metrics = limiter.getMetrics();
      expect(metrics.totalAllowed).toBe(0);
      expect(metrics.totalDenied).toBe(0);
    });
  });

  // ── Voice Summary ──────────────────────────────────────────────────────

  describe('voice summary', () => {
    it('should handle idle state', () => {
      expect(limiter.getVoiceSummary()).toContain('idle');
    });

    it('should generate summary with activity', () => {
      limiter.checkLimit('cust-1');
      limiter.checkLimit('cust-1');

      const summary = limiter.getVoiceSummary();
      expect(summary).toContain('requests');
      expect(summary).toContain('allowed');
    });
  });

  // ── Destroy ────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should clean up all state', () => {
      limiter.setCustomerPlan('c1', 'solo');
      limiter.addToWhitelist('w1');
      limiter.checkLimit('c1');

      limiter.destroy();

      // After destroy, checking should still work (fresh state)
      const newLimiter = new ApiRateLimiter({ cleanupIntervalMs: 0 });
      expect(newLimiter.getCustomerPlan('c1')).toBe('free');
      newLimiter.destroy();
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle rapid-fire requests', () => {
      let allowed = 0;
      for (let i = 0; i < 50; i++) {
        if (limiter.checkLimit('rapid-fire').allowed) allowed++;
      }
      expect(allowed).toBeGreaterThan(0);
      expect(allowed).toBeLessThanOrEqual(50);
    });

    it('should isolate customers from each other', () => {
      // Customer A hitting limit shouldn't affect Customer B
      const tightLimiter = new ApiRateLimiter({
        planLimits: {
          free: {
            global: {
              maxRequests: 2,
              windowMs: 60000,
              burstAllowance: 0,
              graceRequests: 0,
            },
          },
          solo: { global: { maxRequests: 100, windowMs: 3600000 } },
          multi: { global: { maxRequests: 500, windowMs: 3600000 } },
          enterprise: { global: { maxRequests: 5000, windowMs: 3600000 } },
          internal: { global: { maxRequests: 100000, windowMs: 3600000 } },
        },
        cleanupIntervalMs: 0,
      });

      tightLimiter.checkLimit('A');
      tightLimiter.checkLimit('A');
      tightLimiter.checkLimit('A'); // denied

      // B should still be allowed
      expect(tightLimiter.checkLimit('B').allowed).toBe(true);
      tightLimiter.destroy();
    });

    it('should handle empty string customer ID', () => {
      const result = limiter.checkLimit('');
      expect(result.allowed).toBe(true);
    });
  });
});
