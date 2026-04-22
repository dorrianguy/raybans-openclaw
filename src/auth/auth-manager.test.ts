/**
 * Tests for Auth & API Key Manager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AuthManager,
  DEFAULT_AUTH_CONFIG,
  ALL_SCOPES,
  PLAN_SCOPES,
  type ApiKey,
  type Scope,
  type AuthResult,
} from './auth-manager.js';

describe('AuthManager', () => {
  let manager: AuthManager;

  beforeEach(() => {
    manager = new AuthManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  // ─── API Key Creation ─────────────────────────────────────────────────

  describe('createKey', () => {
    it('should create an API key with required fields', () => {
      const { key, rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Production Key',
        scopes: ['inventory:read', 'inventory:write'],
      });

      expect(key.id).toMatch(/^key_/);
      expect(key.userId).toBe('user1');
      expect(key.name).toBe('Production Key');
      expect(key.scopes).toEqual(['inventory:read', 'inventory:write']);
      expect(key.status).toBe('active');
      expect(key.environment).toBe('production');
      expect(key.usageCount).toBe(0);
      expect(key.keyPrefix).toBeDefined();
      expect(key.keyHash).toBeDefined();
      expect(rawKey).toContain('rv_prod_');
    });

    it('should generate unique keys', () => {
      const { rawKey: key1 } = manager.createKey({
        userId: 'user1',
        name: 'Key 1',
        scopes: ['inventory:read'],
      });
      const { rawKey: key2 } = manager.createKey({
        userId: 'user1',
        name: 'Key 2',
        scopes: ['inventory:read'],
      });

      expect(key1).not.toBe(key2);
    });

    it('should support different environments', () => {
      const { rawKey: prodKey } = manager.createKey({
        userId: 'user1',
        name: 'Prod',
        scopes: ['inventory:read'],
        environment: 'production',
      });
      const { rawKey: devKey } = manager.createKey({
        userId: 'user1',
        name: 'Dev',
        scopes: ['inventory:read'],
        environment: 'development',
      });
      const { rawKey: stgKey } = manager.createKey({
        userId: 'user1',
        name: 'Stg',
        scopes: ['inventory:read'],
        environment: 'staging',
      });

      expect(prodKey).toContain('rv_prod_');
      expect(devKey).toContain('rv_dev_');
      expect(stgKey).toContain('rv_stg_');
    });

    it('should set expiration based on config', () => {
      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      expect(key.expiresAt).toBeDefined();
      const expectedExpiry = key.createdAt + DEFAULT_AUTH_CONFIG.defaultKeyExpirationMs;
      expect(key.expiresAt).toBe(expectedExpiry);
    });

    it('should accept custom expiration', () => {
      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
        expiresInMs: 60_000, // 1 minute
      });

      expect(key.expiresAt! - key.createdAt).toBe(60_000);
    });

    it('should enforce max keys per user', () => {
      const mgr = new AuthManager({ maxKeysPerUser: 2 });

      mgr.createKey({ userId: 'user1', name: 'K1', scopes: ['inventory:read'] });
      mgr.createKey({ userId: 'user1', name: 'K2', scopes: ['inventory:read'] });

      expect(() =>
        mgr.createKey({ userId: 'user1', name: 'K3', scopes: ['inventory:read'] })
      ).toThrow('maximum of 2 API keys');

      mgr.destroy();
    });

    it('should validate scopes', () => {
      expect(() =>
        manager.createKey({
          userId: 'user1',
          name: 'Key',
          scopes: ['invalid:scope' as Scope],
        })
      ).toThrow('Invalid scope');
    });

    it('should emit key:created event', () => {
      const handler = vi.fn();
      manager.on('key:created', handler);

      manager.createKey({ userId: 'user1', name: 'Key', scopes: ['inventory:read'] });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].userId).toBe('user1');
      expect(handler.mock.calls[0][1]).toContain('rv_prod_');
    });

    it('should accept IP whitelist', () => {
      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
        ipWhitelist: ['192.168.1.1', '10.0.0.1'],
      });

      expect(key.ipWhitelist).toEqual(['192.168.1.1', '10.0.0.1']);
    });

    it('should accept rate limit overrides', () => {
      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
        rateLimitPerMinute: 120,
        rateLimitPerDay: 50000,
      });

      expect(key.rateLimitPerMinute).toBe(120);
      expect(key.rateLimitPerDay).toBe(50000);
    });
  });

  // ─── Key Authentication ───────────────────────────────────────────────

  describe('authenticateKey', () => {
    it('should authenticate a valid key', () => {
      const { rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read', 'inventory:write'],
      });

      const result = manager.authenticateKey(rawKey);
      expect(result.authenticated).toBe(true);
      expect(result.userId).toBe('user1');
      expect(result.scopes).toContain('inventory:read');
    });

    it('should reject invalid keys', () => {
      const result = manager.authenticateKey('rv_prod_invalidkey');
      expect(result.authenticated).toBe(false);
      expect(result.reason).toBe('invalid_key');
    });

    it('should reject revoked keys', () => {
      const { key, rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      manager.revokeKey(key.id, 'compromised');

      const result = manager.authenticateKey(rawKey);
      expect(result.authenticated).toBe(false);
      expect(result.reason).toBe('key_revoked');
    });

    it('should reject expired keys', () => {
      const { key, rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
        expiresInMs: 1, // expires immediately
      });

      // Wait for expiry
      const internalKey = (manager as any).keys.get(key.id)!;
      internalKey.expiresAt = Date.now() - 1000;

      const result = manager.authenticateKey(rawKey);
      expect(result.authenticated).toBe(false);
      expect(result.reason).toBe('key_expired');
    });

    it('should check required scopes', () => {
      const { rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      // Should pass with matching scope
      const result1 = manager.authenticateKey(rawKey, {
        requiredScopes: ['inventory:read'],
      });
      expect(result1.authenticated).toBe(true);

      // Should fail with missing scope
      const result2 = manager.authenticateKey(rawKey, {
        requiredScopes: ['inventory:write'],
      });
      expect(result2.authenticated).toBe(false);
      expect(result2.reason).toBe('insufficient_scopes');
    });

    it('should allow admin:* to bypass scope checks', () => {
      const { rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Admin Key',
        scopes: ['admin:*'],
      });

      const result = manager.authenticateKey(rawKey, {
        requiredScopes: ['inventory:write', 'billing:read', 'users:write'],
      });
      expect(result.authenticated).toBe(true);
    });

    it('should check IP whitelist', () => {
      const { rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
        ipWhitelist: ['192.168.1.1'],
      });

      const result1 = manager.authenticateKey(rawKey, { ipAddress: '192.168.1.1' });
      expect(result1.authenticated).toBe(true);

      const result2 = manager.authenticateKey(rawKey, { ipAddress: '10.0.0.1' });
      expect(result2.authenticated).toBe(false);
      expect(result2.reason).toBe('ip_not_allowed');
    });

    it('should increment usage count', () => {
      const { key, rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      manager.authenticateKey(rawKey);
      manager.authenticateKey(rawKey);
      manager.authenticateKey(rawKey);

      const updated = manager.getKey(key.id)!;
      expect(updated.usageCount).toBe(3);
      expect(updated.lastUsedAt).toBeDefined();
    });

    it('should emit auth:success event', () => {
      const handler = vi.fn();
      manager.on('auth:success', handler);

      const { rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      manager.authenticateKey(rawKey);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].authenticated).toBe(true);
    });

    it('should emit auth:failure event', () => {
      const handler = vi.fn();
      manager.on('auth:failure', handler);

      manager.authenticateKey('rv_prod_invalid');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should enforce per-key rate limits', () => {
      const mgr = new AuthManager({ defaultRateLimitPerMinute: 3 });

      const { rawKey } = mgr.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      expect(mgr.authenticateKey(rawKey).authenticated).toBe(true);
      expect(mgr.authenticateKey(rawKey).authenticated).toBe(true);
      expect(mgr.authenticateKey(rawKey).authenticated).toBe(true);
      expect(mgr.authenticateKey(rawKey).authenticated).toBe(false);

      const lastResult = mgr.authenticateKey(rawKey);
      expect(lastResult.reason).toBe('rate_limited');

      mgr.destroy();
    });
  });

  // ─── Key Revocation ───────────────────────────────────────────────────

  describe('revokeKey', () => {
    it('should revoke a key', () => {
      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      manager.revokeKey(key.id, 'compromised');

      const updated = manager.getKey(key.id)!;
      expect(updated.status).toBe('revoked');
      expect(updated.revokedAt).toBeDefined();
      expect(updated.revokedReason).toBe('compromised');
    });

    it('should emit key:revoked event', () => {
      const handler = vi.fn();
      manager.on('key:revoked', handler);

      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      manager.revokeKey(key.id, 'test');
      expect(handler).toHaveBeenCalledWith(key.id, 'test');
    });

    it('should throw for nonexistent key', () => {
      expect(() => manager.revokeKey('nonexistent', 'test')).toThrow('not found');
    });

    it('should throw for already revoked key', () => {
      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      manager.revokeKey(key.id);
      expect(() => manager.revokeKey(key.id)).toThrow('already revoked');
    });
  });

  // ─── Key Rotation ─────────────────────────────────────────────────────

  describe('rotateKey', () => {
    it('should create a new key and put old key in rotation mode', () => {
      const { key: oldKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read', 'sessions:read'],
      });

      const { newKey, rawKey, graceUntil } = manager.rotateKey(oldKey.id);

      // New key should be active with same scopes
      expect(newKey.status).toBe('active');
      expect(newKey.scopes).toEqual(oldKey.scopes);
      expect(newKey.userId).toBe(oldKey.userId);
      expect(newKey.rotatedFromId).toBe(oldKey.id);
      expect(rawKey).toContain('rv_prod_');

      // Old key should be in rotating status
      const updatedOld = manager.getKey(oldKey.id)!;
      expect(updatedOld.status).toBe('rotating');
      expect(updatedOld.rotationGraceUntil).toBe(graceUntil);
    });

    it('should emit key:rotated event', () => {
      const handler = vi.fn();
      manager.on('key:rotated', handler);

      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      const { newKey } = manager.rotateKey(key.id);
      expect(handler).toHaveBeenCalledWith(key.id, newKey.id);
    });

    it('should only rotate active keys', () => {
      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      manager.revokeKey(key.id);
      expect(() => manager.rotateKey(key.id)).toThrow('Can only rotate active keys');
    });

    it('should allow old key during grace period', () => {
      const { key: oldKey, rawKey: oldRawKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      manager.rotateKey(oldKey.id);

      // Old key should still work during grace period
      // (It's in 'rotating' status with a future graceUntil)
      const internalOldKey = (manager as any).keys.get(oldKey.id)!;
      // The old key is 'rotating' but not expired, so it should still authenticate
      // Set expiresAt to past but graceUntil to future
      internalOldKey.expiresAt = Date.now() - 1000;
      internalOldKey.rotationGraceUntil = Date.now() + 100000;

      const result = manager.authenticateKey(oldRawKey);
      expect(result.authenticated).toBe(true);
    });
  });

  // ─── Key Queries ──────────────────────────────────────────────────────

  describe('key queries', () => {
    it('should get active keys for a user', () => {
      manager.createKey({ userId: 'user1', name: 'K1', scopes: ['inventory:read'] });
      manager.createKey({ userId: 'user1', name: 'K2', scopes: ['inventory:read'] });
      const { key: k3 } = manager.createKey({ userId: 'user1', name: 'K3', scopes: ['inventory:read'] });
      manager.revokeKey(k3.id);

      const active = manager.getActiveKeysForUser('user1');
      expect(active.length).toBe(2);
    });

    it('should get all keys including revoked', () => {
      manager.createKey({ userId: 'user1', name: 'K1', scopes: ['inventory:read'] });
      const { key: k2 } = manager.createKey({ userId: 'user1', name: 'K2', scopes: ['inventory:read'] });
      manager.revokeKey(k2.id);

      const all = manager.getAllKeysForUser('user1');
      expect(all.length).toBe(2);
    });

    it('should check scope on key', () => {
      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read', 'sessions:read'],
      });

      expect(manager.hasScope(key.id, 'inventory:read')).toBe(true);
      expect(manager.hasScope(key.id, 'inventory:write')).toBe(false);
    });

    it('admin:* should match any scope', () => {
      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Admin',
        scopes: ['admin:*'],
      });

      expect(manager.hasScope(key.id, 'inventory:write')).toBe(true);
      expect(manager.hasScope(key.id, 'billing:read')).toBe(true);
    });
  });

  // ─── Session Management ───────────────────────────────────────────────

  describe('createSession', () => {
    it('should create a session with token', () => {
      const session = manager.createSession({
        userId: 'user1',
        deviceId: 'phone-1',
      });

      expect(session.id).toMatch(/^ses_/);
      expect(session.userId).toBe('user1');
      expect(session.token).toBeDefined();
      expect(session.token.length).toBe(96); // 48 bytes hex
      expect(session.deviceId).toBe('phone-1');
    });

    it('should auto-expire oldest session when limit reached', () => {
      const mgr = new AuthManager({ maxSessionsPerUser: 2 });

      const s1 = mgr.createSession({ userId: 'user1' });
      mgr.createSession({ userId: 'user1' });
      mgr.createSession({ userId: 'user1' }); // Should expire s1

      const active = mgr.getActiveSessionsForUser('user1');
      expect(active.length).toBeLessThanOrEqual(2);

      mgr.destroy();
    });

    it('should emit session:created event', () => {
      const handler = vi.fn();
      manager.on('session:created', handler);

      manager.createSession({ userId: 'user1' });
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('validateSession', () => {
    it('should validate a valid session token', () => {
      const session = manager.createSession({ userId: 'user1' });
      const result = manager.validateSession(session.token);

      expect(result.authenticated).toBe(true);
      expect(result.userId).toBe('user1');
    });

    it('should reject invalid tokens', () => {
      const result = manager.validateSession('invalid-token');
      expect(result.authenticated).toBe(false);
      expect(result.reason).toBe('invalid_session');
    });

    it('should reject expired sessions', () => {
      const session = manager.createSession({ userId: 'user1', expiresInMs: 1 });

      // Manually expire
      const internalSession = (manager as any).sessions.get(session.id)!;
      internalSession.expiresAt = Date.now() - 1000;

      const result = manager.validateSession(session.token);
      expect(result.authenticated).toBe(false);
      expect(result.reason).toBe('session_expired');
    });

    it('should update lastActivityAt on validation', () => {
      const session = manager.createSession({ userId: 'user1' });
      const beforeActivity = session.lastActivityAt;

      manager.validateSession(session.token);

      const internalSession = (manager as any).sessions.get(session.id);
      expect(internalSession.lastActivityAt).toBeGreaterThanOrEqual(beforeActivity);
    });
  });

  describe('revokeAllSessions', () => {
    it('should revoke all sessions for a user', () => {
      manager.createSession({ userId: 'user1' });
      manager.createSession({ userId: 'user1' });
      manager.createSession({ userId: 'user2' });

      const count = manager.revokeAllSessions('user1');
      expect(count).toBe(2);

      expect(manager.getActiveSessionsForUser('user1').length).toBe(0);
      expect(manager.getActiveSessionsForUser('user2').length).toBe(1);
    });
  });

  // ─── Usage Tracking ───────────────────────────────────────────────────

  describe('usage tracking', () => {
    it('should record and query usage', () => {
      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      manager.recordUsage({
        keyId: key.id,
        timestamp: Date.now(),
        endpoint: '/api/inventory',
        method: 'GET',
        statusCode: 200,
        latencyMs: 45,
      });

      manager.recordUsage({
        keyId: key.id,
        timestamp: Date.now(),
        endpoint: '/api/inventory',
        method: 'GET',
        statusCode: 500,
        latencyMs: 120,
      });

      const stats = manager.getKeyUsageStats(key.id);
      expect(stats.totalRequests).toBe(2);
      expect(stats.averageLatencyMs).toBe(82.5);
      expect(stats.errorRate).toBe(0.5);
      expect(stats.topEndpoints['/api/inventory']).toBe(2);
    });

    it('should filter by time range', () => {
      const { key } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      manager.recordUsage({
        keyId: key.id,
        timestamp: Date.now(),
        endpoint: '/api/test',
        method: 'GET',
        statusCode: 200,
        latencyMs: 10,
      });

      const stats = manager.getKeyUsageStats(key.id);
      expect(stats.last24h).toBe(1);
      expect(stats.last7d).toBe(1);
    });
  });

  // ─── Scope Helpers ────────────────────────────────────────────────────

  describe('scope helpers', () => {
    it('should return correct scopes for plans', () => {
      const freeScopes = manager.getScopesForPlan('free');
      expect(freeScopes).toContain('inventory:read');
      expect(freeScopes).not.toContain('inventory:write');

      const enterpriseScopes = manager.getScopesForPlan('enterprise');
      expect(enterpriseScopes).toContain('admin:*');
    });

    it('should check scope inclusion statically', () => {
      expect(AuthManager.scopeIncludes(['inventory:read', 'sessions:read'], 'inventory:read')).toBe(true);
      expect(AuthManager.scopeIncludes(['inventory:read'], 'inventory:write')).toBe(false);
      expect(AuthManager.scopeIncludes(['admin:*'], 'billing:write')).toBe(true);
    });
  });

  // ─── Stats & Summary ─────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct counts', () => {
      const { key: k1 } = manager.createKey({ userId: 'user1', name: 'K1', scopes: ['inventory:read'] });
      manager.createKey({ userId: 'user1', name: 'K2', scopes: ['inventory:read'] });
      manager.revokeKey(k1.id);
      manager.createSession({ userId: 'user1' });

      const stats = manager.getStats();
      expect(stats.totalKeys).toBe(2);
      expect(stats.activeKeys).toBe(1);
      expect(stats.revokedKeys).toBe(1);
      expect(stats.activeSessions).toBe(1);
    });
  });

  describe('generateVoiceSummary', () => {
    it('should generate a voice summary', () => {
      manager.createKey({ userId: 'user1', name: 'K1', scopes: ['inventory:read'] });
      manager.createSession({ userId: 'user1' });

      const summary = manager.generateVoiceSummary();
      expect(summary).toContain('1 API key total');
      expect(summary).toContain('1 active session');
    });
  });

  // ─── Cleanup ──────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('should expire timed-out sessions and keys', () => {
      const session = manager.createSession({ userId: 'user1' });
      const { key } = manager.createKey({ userId: 'user1', name: 'K1', scopes: ['inventory:read'] });

      // Manually expire
      const internalSession = (manager as any).sessions.get(session.id)!;
      internalSession.expiresAt = Date.now() - 1000;

      const internalKey = (manager as any).keys.get(key.id)!;
      internalKey.expiresAt = Date.now() - 1000;

      const result = manager.cleanup();
      expect(result.expiredSessions).toBe(1);
      expect(result.expiredKeys).toBe(1);

      expect(manager.getActiveSessionsForUser('user1').length).toBe(0);
      expect(manager.getKey(key.id)!.status).toBe('expired');
    });

    it('should expire rotating keys past grace period', () => {
      const { key } = manager.createKey({ userId: 'user1', name: 'K1', scopes: ['inventory:read'] });
      manager.rotateKey(key.id);

      const internalKey = (manager as any).keys.get(key.id)!;
      internalKey.rotationGraceUntil = Date.now() - 1000;

      const result = manager.cleanup();
      expect(result.expiredKeys).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty IP whitelist (allow all)', () => {
      const { rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
        ipWhitelist: [],
      });

      // Empty whitelist should not restrict
      const result = manager.authenticateKey(rawKey, { ipAddress: '1.2.3.4' });
      expect(result.authenticated).toBe(true);
    });

    it('should handle multiple scopes correctly', () => {
      const { rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read', 'inventory:write', 'sessions:read'],
      });

      const result = manager.authenticateKey(rawKey, {
        requiredScopes: ['inventory:read', 'sessions:read'],
      });
      expect(result.authenticated).toBe(true);
    });

    it('should fail if any required scope is missing', () => {
      const { rawKey } = manager.createKey({
        userId: 'user1',
        name: 'Key',
        scopes: ['inventory:read'],
      });

      const result = manager.authenticateKey(rawKey, {
        requiredScopes: ['inventory:read', 'inventory:write'],
      });
      expect(result.authenticated).toBe(false);
      expect(result.reason).toBe('insufficient_scopes');
    });
  });
});
