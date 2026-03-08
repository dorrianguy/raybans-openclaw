/**
 * Tests for API Gateway & Authentication Middleware
 * 🌙 Night Shift Agent — 2026-03-08
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ApiGateway,
  type ApiGatewayConfig,
  type Permission,
  type UserRole,
  type ApiKeyScope,
  type RouteDefinition,
} from './api-gateway.js';

function createGateway(overrides?: Partial<ApiGatewayConfig>): ApiGateway {
  return new ApiGateway({
    jwtSecret: 'test-secret-key-for-testing-only-32chars',
    jwtExpirySeconds: 3600,
    refreshExpirySeconds: 86400,
    ...overrides,
  });
}

describe('ApiGateway', () => {

  // ─── JWT Token Management ────────────────────────────────────────────

  describe('JWT Token Management', () => {

    it('should issue a JWT token with correct claims', () => {
      const gw = createGateway();
      const result = gw.issueToken('user-1', 'test@example.com', 'operator');
      
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.expiresIn).toBe(3600);
      expect(result.accessToken.split('.')).toHaveLength(3);
    });

    it('should verify a valid JWT token', () => {
      const gw = createGateway();
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'admin');
      
      const payload = gw.verifyToken(accessToken);
      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe('user-1');
      expect(payload!.email).toBe('test@example.com');
      expect(payload!.role).toBe('admin');
      expect(payload!.permissions).toContain('admin:all');
    });

    it('should reject an expired JWT token', () => {
      const gw = createGateway({ jwtExpirySeconds: -1 });
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'operator');
      
      const payload = gw.verifyToken(accessToken);
      expect(payload).toBeNull();
    });

    it('should reject a tampered JWT token', () => {
      const gw = createGateway();
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'operator');
      
      // Tamper with the payload
      const parts = accessToken.split('.');
      parts[1] = parts[1] + 'tampered';
      const tampered = parts.join('.');
      
      const payload = gw.verifyToken(tampered);
      expect(payload).toBeNull();
    });

    it('should reject a token signed with wrong secret', () => {
      const gw1 = createGateway({ jwtSecret: 'secret-one-aaaa-bbbb-cccc-dddd' });
      const gw2 = createGateway({ jwtSecret: 'secret-two-aaaa-bbbb-cccc-dddd' });
      
      const { accessToken } = gw1.issueToken('user-1', 'test@example.com', 'operator');
      const payload = gw2.verifyToken(accessToken);
      expect(payload).toBeNull();
    });

    it('should reject a malformed JWT token', () => {
      const gw = createGateway();
      expect(gw.verifyToken('not.a.valid.token')).toBeNull();
      expect(gw.verifyToken('')).toBeNull();
      expect(gw.verifyToken('single')).toBeNull();
    });

    it('should revoke a JWT token by JTI', () => {
      const gw = createGateway();
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'operator');
      
      const payload = gw.verifyToken(accessToken);
      expect(payload).not.toBeNull();
      
      // Revoke
      gw.revokeToken(payload!.jti);
      
      // Should no longer verify
      expect(gw.verifyToken(accessToken)).toBeNull();
    });

    it('should include org ID in JWT when provided', () => {
      const gw = createGateway();
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'operator', 'org-42');
      
      const payload = gw.verifyToken(accessToken);
      expect(payload!.org).toBe('org-42');
    });

    it('should emit token:issued event', () => {
      const gw = createGateway();
      const handler = vi.fn();
      gw.on('token:issued', handler);
      
      gw.issueToken('user-1', 'test@example.com', 'operator');
      expect(handler).toHaveBeenCalledWith('user-1');
    });

    it('should revoke all user refresh tokens', () => {
      const gw = createGateway();
      gw.issueToken('user-1', 'a@b.com', 'operator');
      gw.issueToken('user-1', 'a@b.com', 'operator');
      gw.issueToken('user-2', 'c@d.com', 'viewer');
      
      const revokedCount = gw.revokeAllUserTokens('user-1');
      expect(revokedCount).toBe(2);
      
      // user-2 tokens should be unaffected
      const revokedCount2 = gw.revokeAllUserTokens('user-2');
      expect(revokedCount2).toBe(1);
    });
  });

  // ─── Refresh Token ───────────────────────────────────────────────────

  describe('Refresh Token', () => {

    it('should refresh an access token with valid refresh token', () => {
      const gw = createGateway();
      const { refreshToken } = gw.issueToken('user-1', 'test@example.com', 'operator');
      
      const result = gw.refreshAccessToken(refreshToken);
      expect(result).not.toBeNull();
      expect(result!.accessToken).toBeTruthy();
      expect(result!.refreshToken).toBeTruthy();
    });

    it('should rotate refresh token on use (old one becomes invalid)', () => {
      const gw = createGateway();
      const { refreshToken } = gw.issueToken('user-1', 'test@example.com', 'operator');
      
      // Use refresh token
      const result = gw.refreshAccessToken(refreshToken);
      expect(result).not.toBeNull();
      
      // Try to reuse old refresh token
      const result2 = gw.refreshAccessToken(refreshToken);
      expect(result2).toBeNull();
    });

    it('should reject invalid refresh token format', () => {
      const gw = createGateway();
      expect(gw.refreshAccessToken('not-a-valid-format')).toBeNull();
    });

    it('should reject non-existent refresh token', () => {
      const gw = createGateway();
      expect(gw.refreshAccessToken('fake-id:fake-token')).toBeNull();
    });

    it('should reject refresh token with wrong raw value', () => {
      const gw = createGateway();
      const { refreshToken } = gw.issueToken('user-1', 'test@example.com', 'operator');
      const [id] = refreshToken.split(':');
      
      expect(gw.refreshAccessToken(`${id}:wrong-raw-value`)).toBeNull();
    });
  });

  // ─── API Key Management ──────────────────────────────────────────────

  describe('API Key Management', () => {

    it('should create an API key', () => {
      const gw = createGateway();
      const result = gw.createApiKey('user-1', 'Test Key', 'full');
      
      expect(result).not.toBeNull();
      expect(result!.key.name).toBe('Test Key');
      expect(result!.key.scope).toBe('full');
      expect(result!.key.userId).toBe('user-1');
      expect(result!.key.revoked).toBe(false);
      expect(result!.rawKey.startsWith('rbk_')).toBe(true);
    });

    it('should verify a valid API key', () => {
      const gw = createGateway();
      const { rawKey } = gw.createApiKey('user-1', 'Test Key', 'read_only')!;
      
      const key = gw.verifyApiKey(rawKey);
      expect(key).not.toBeNull();
      expect(key!.name).toBe('Test Key');
      expect(key!.usageCount).toBe(1);
    });

    it('should reject an invalid API key', () => {
      const gw = createGateway();
      expect(gw.verifyApiKey('rbk_invalid_key_value')).toBeNull();
    });

    it('should reject a revoked API key', () => {
      const gw = createGateway();
      const { key, rawKey } = gw.createApiKey('user-1', 'Test Key', 'full')!;
      
      gw.revokeApiKey(key.id);
      expect(gw.verifyApiKey(rawKey)).toBeNull();
    });

    it('should reject an expired API key', () => {
      const gw = createGateway();
      const result = gw.createApiKey('user-1', 'Expiring Key', 'full', {
        expiresInDays: -1, // Already expired
      });
      
      expect(result).not.toBeNull();
      expect(gw.verifyApiKey(result!.rawKey)).toBeNull();
    });

    it('should enforce max API keys per user', () => {
      const gw = createGateway({ maxApiKeysPerUser: 2 });
      
      expect(gw.createApiKey('user-1', 'Key 1', 'full')).not.toBeNull();
      expect(gw.createApiKey('user-1', 'Key 2', 'full')).not.toBeNull();
      expect(gw.createApiKey('user-1', 'Key 3', 'full')).toBeNull();
    });

    it('should allow more keys after revoking', () => {
      const gw = createGateway({ maxApiKeysPerUser: 2 });
      
      const key1 = gw.createApiKey('user-1', 'Key 1', 'full')!;
      gw.createApiKey('user-1', 'Key 2', 'full');
      
      // At limit
      expect(gw.createApiKey('user-1', 'Key 3', 'full')).toBeNull();
      
      // Revoke one
      gw.revokeApiKey(key1.key.id);
      
      // Now should work
      expect(gw.createApiKey('user-1', 'Key 3', 'full')).not.toBeNull();
    });

    it('should rotate an API key', () => {
      const gw = createGateway();
      const { key: oldKey, rawKey: oldRawKey } = gw.createApiKey('user-1', 'Test Key', 'full')!;
      
      const rotated = gw.rotateApiKey(oldKey.id);
      expect(rotated).not.toBeNull();
      expect(rotated!.key.name).toBe('Test Key');
      expect(rotated!.key.scope).toBe('full');
      
      // Old key should be revoked
      expect(gw.verifyApiKey(oldRawKey)).toBeNull();
      
      // New key should work
      expect(gw.verifyApiKey(rotated!.rawKey)).not.toBeNull();
    });

    it('should not rotate a revoked key', () => {
      const gw = createGateway();
      const { key } = gw.createApiKey('user-1', 'Test Key', 'full')!;
      gw.revokeApiKey(key.id);
      
      expect(gw.rotateApiKey(key.id)).toBeNull();
    });

    it('should list API keys for a user', () => {
      const gw = createGateway();
      gw.createApiKey('user-1', 'Key A', 'full');
      gw.createApiKey('user-1', 'Key B', 'read_only');
      gw.createApiKey('user-2', 'Key C', 'full');
      
      const user1Keys = gw.listApiKeys('user-1');
      expect(user1Keys).toHaveLength(2);
      expect(user1Keys.map(k => k.name).sort()).toEqual(['Key A', 'Key B']);
    });

    it('should exclude revoked keys unless requested', () => {
      const gw = createGateway();
      const { key } = gw.createApiKey('user-1', 'Key A', 'full')!;
      gw.createApiKey('user-1', 'Key B', 'full');
      gw.revokeApiKey(key.id);
      
      expect(gw.listApiKeys('user-1')).toHaveLength(1);
      expect(gw.listApiKeys('user-1', true)).toHaveLength(2);
    });

    it('should track usage count', () => {
      const gw = createGateway();
      const { rawKey } = gw.createApiKey('user-1', 'Test', 'full')!;
      
      gw.verifyApiKey(rawKey);
      gw.verifyApiKey(rawKey);
      gw.verifyApiKey(rawKey);
      
      const key = gw.verifyApiKey(rawKey)!;
      expect(key.usageCount).toBe(4);
    });

    it('should assign correct permissions per scope', () => {
      const gw = createGateway();
      
      const fullKey = gw.createApiKey('user-1', 'Full', 'full')!;
      expect(fullKey.key.permissions).toContain('inventory:read');
      expect(fullKey.key.permissions).toContain('inventory:write');
      expect(fullKey.key.permissions).toContain('analytics:export');
      
      const readKey = gw.createApiKey('user-1', 'Read', 'read_only')!;
      expect(readKey.key.permissions).toContain('inventory:read');
      expect(readKey.key.permissions).not.toContain('inventory:write');
      
      const invKey = gw.createApiKey('user-1', 'Inv', 'inventory_only')!;
      expect(invKey.key.permissions).toContain('inventory:read');
      expect(invKey.key.permissions).toContain('sessions:write');
      expect(invKey.key.permissions).not.toContain('analytics:read');
    });

    it('should support custom permissions', () => {
      const gw = createGateway();
      const result = gw.createApiKey('user-1', 'Custom', 'custom', {
        permissions: ['inventory:read', 'export:generate'],
      });
      
      expect(result!.key.permissions).toEqual(['inventory:read', 'export:generate']);
    });

    it('should support IP restrictions on keys', () => {
      const gw = createGateway();
      const { rawKey, key } = gw.createApiKey('user-1', 'Restricted', 'full', {
        allowedIps: ['192.168.1.1', '10.0.0.1'],
      })!;
      
      expect(key.allowedIps).toEqual(['192.168.1.1', '10.0.0.1']);
    });

    it('should support metadata on keys', () => {
      const gw = createGateway();
      const { key } = gw.createApiKey('user-1', 'With Meta', 'full', {
        metadata: { environment: 'production', team: 'backend' },
      })!;
      
      expect(key.metadata).toEqual({ environment: 'production', team: 'backend' });
    });

    it('should get API key by ID', () => {
      const gw = createGateway();
      const { key } = gw.createApiKey('user-1', 'Test', 'full')!;
      
      expect(gw.getApiKey(key.id)!.name).toBe('Test');
      expect(gw.getApiKey('nonexistent')).toBeNull();
    });

    it('should emit key events', () => {
      const gw = createGateway();
      const createdHandler = vi.fn();
      const revokedHandler = vi.fn();
      const rotatedHandler = vi.fn();
      
      gw.on('key:created', createdHandler);
      gw.on('key:revoked', revokedHandler);
      gw.on('key:rotated', rotatedHandler);
      
      const { key } = gw.createApiKey('user-1', 'Test', 'full')!;
      expect(createdHandler).toHaveBeenCalled();
      
      gw.rotateApiKey(key.id);
      expect(revokedHandler).not.toHaveBeenCalled(); // Rotation doesn't emit revoke separately
      expect(rotatedHandler).toHaveBeenCalled();
    });
  });

  // ─── Authentication Middleware ────────────────────────────────────────

  describe('Authentication Middleware', () => {

    it('should authenticate with valid Bearer token', () => {
      const gw = createGateway();
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'operator');
      
      const result = gw.authenticate(`Bearer ${accessToken}`, '127.0.0.1');
      expect('error' in result).toBe(false);
      
      const auth = result as any;
      expect(auth.method).toBe('jwt');
      expect(auth.userId).toBe('user-1');
      expect(auth.email).toBe('test@example.com');
      expect(auth.role).toBe('operator');
    });

    it('should authenticate with valid API key', () => {
      const gw = createGateway();
      const { rawKey } = gw.createApiKey('user-1', 'Test', 'full')!;
      
      const result = gw.authenticate(`ApiKey ${rawKey}`, '127.0.0.1');
      expect('error' in result).toBe(false);
      
      const auth = result as any;
      expect(auth.method).toBe('api_key');
      expect(auth.userId).toBe('user-1');
      expect(auth.role).toBe('api_client');
    });

    it('should authenticate with X-API-Key header format', () => {
      const gw = createGateway();
      const { rawKey } = gw.createApiKey('user-1', 'Test', 'full')!;
      
      const result = gw.authenticate(`X-API-Key ${rawKey}`, '127.0.0.1');
      expect('error' in result).toBe(false);
    });

    it('should reject missing auth header', () => {
      const gw = createGateway();
      const result = gw.authenticate(undefined, '127.0.0.1') as { error: string; status: number };
      
      expect(result.error).toBe('Authentication required');
      expect(result.status).toBe(401);
    });

    it('should reject invalid Bearer token', () => {
      const gw = createGateway();
      const result = gw.authenticate('Bearer invalid-token', '127.0.0.1') as { error: string; status: number };
      
      expect(result.error).toBe('Invalid or expired token');
      expect(result.status).toBe(401);
    });

    it('should reject unsupported auth method', () => {
      const gw = createGateway();
      const result = gw.authenticate('Basic dXNlcjpwYXNz', '127.0.0.1') as { error: string; status: number };
      
      expect(result.error).toBe('Unsupported authentication method');
      expect(result.status).toBe(401);
    });

    it('should block IPs in blocklist', () => {
      const gw = createGateway({ ipBlocklist: ['10.0.0.99'] });
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'admin');
      
      const result = gw.authenticate(`Bearer ${accessToken}`, '10.0.0.99') as { error: string; status: number };
      expect(result.error).toBe('Forbidden');
      expect(result.status).toBe(403);
    });

    it('should block IPs not in allowlist', () => {
      const gw = createGateway({ ipAllowlist: ['192.168.1.1', '10.0.0.1'] });
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'admin');
      
      // Allowed IP
      const result1 = gw.authenticate(`Bearer ${accessToken}`, '192.168.1.1');
      expect('error' in result1).toBe(false);
      
      // Not allowed IP
      const result2 = gw.authenticate(`Bearer ${accessToken}`, '99.99.99.99') as { error: string; status: number };
      expect(result2.error).toBe('Forbidden');
      expect(result2.status).toBe(403);
    });

    it('should enforce API key IP restrictions', () => {
      const gw = createGateway();
      const { rawKey } = gw.createApiKey('user-1', 'Restricted', 'full', {
        allowedIps: ['192.168.1.1'],
      })!;
      
      // Allowed IP
      const result1 = gw.authenticate(`ApiKey ${rawKey}`, '192.168.1.1');
      expect('error' in result1).toBe(false);
      
      // Not allowed IP
      const result2 = gw.authenticate(`ApiKey ${rawKey}`, '10.0.0.5') as { error: string; status: number };
      expect(result2.error).toBe('Forbidden');
      expect(result2.status).toBe(403);
    });

    it('should emit auth events', () => {
      const gw = createGateway();
      const successHandler = vi.fn();
      const failHandler = vi.fn();
      gw.on('auth:success', successHandler);
      gw.on('auth:failure', failHandler);
      
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'operator');
      gw.authenticate(`Bearer ${accessToken}`, '127.0.0.1');
      expect(successHandler).toHaveBeenCalled();
      
      gw.authenticate('Bearer bad-token', '127.0.0.1');
      expect(failHandler).toHaveBeenCalled();
    });
  });

  // ─── Authorization ───────────────────────────────────────────────────

  describe('Authorization', () => {

    it('should authorize when user has required permissions', () => {
      const gw = createGateway();
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'operator');
      const payload = gw.verifyToken(accessToken)!;
      
      const request = {
        method: 'jwt' as const,
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        permissions: payload.permissions,
        timestamp: new Date().toISOString(),
        clientIp: '127.0.0.1',
      };
      
      expect(gw.authorize(request, ['inventory:read'])).toBe(true);
      expect(gw.authorize(request, ['inventory:write'])).toBe(true);
    });

    it('should deny when user lacks required permissions', () => {
      const gw = createGateway();
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'viewer');
      const payload = gw.verifyToken(accessToken)!;
      
      const request = {
        method: 'jwt' as const,
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        permissions: payload.permissions,
        timestamp: new Date().toISOString(),
        clientIp: '127.0.0.1',
      };
      
      // Viewers can read but not write
      expect(gw.authorize(request, ['inventory:read'])).toBe(true);
      expect(gw.authorize(request, ['inventory:write'])).toBe(false);
    });

    it('should grant admin all permissions', () => {
      const gw = createGateway();
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'admin');
      const payload = gw.verifyToken(accessToken)!;
      
      const request = {
        method: 'jwt' as const,
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        permissions: payload.permissions,
        timestamp: new Date().toISOString(),
        clientIp: '127.0.0.1',
      };
      
      expect(gw.authorize(request, ['billing:manage', 'users:delete', 'config:write'])).toBe(true);
    });

    it('should authorize empty permission list', () => {
      const gw = createGateway();
      const request = {
        method: 'jwt' as const,
        userId: 'u1',
        role: 'viewer' as const,
        permissions: [] as Permission[],
        timestamp: new Date().toISOString(),
        clientIp: '127.0.0.1',
      };
      
      expect(gw.authorize(request, [])).toBe(true);
    });

    it('should authorize by role', () => {
      const gw = createGateway();
      const request = {
        method: 'jwt' as const,
        userId: 'u1',
        role: 'manager' as UserRole,
        permissions: [] as Permission[],
        timestamp: new Date().toISOString(),
        clientIp: '127.0.0.1',
      };
      
      expect(gw.authorizeRole(request, ['admin', 'manager'])).toBe(true);
      expect(gw.authorizeRole(request, ['admin', 'owner'])).toBe(false);
      expect(gw.authorizeRole(request, [])).toBe(true);
    });

    it('should combine auth + authz with checkAccess', () => {
      const gw = createGateway();
      const { accessToken } = gw.issueToken('user-1', 'test@example.com', 'operator');
      
      // Should succeed
      const result1 = gw.checkAccess(`Bearer ${accessToken}`, '127.0.0.1', ['inventory:read']);
      expect('error' in result1).toBe(false);
      
      // Should fail — operator can't manage billing
      const result2 = gw.checkAccess(`Bearer ${accessToken}`, '127.0.0.1', ['billing:manage']);
      expect('error' in result2).toBe(true);
      expect((result2 as any).status).toBe(403);
    });
  });

  // ─── Role Permissions ────────────────────────────────────────────────

  describe('Role Permissions', () => {

    it('should resolve admin permissions', () => {
      const gw = createGateway();
      const perms = gw.resolveRolePermissions('admin');
      expect(perms).toContain('admin:all');
    });

    it('should resolve owner permissions (everything except admin:all)', () => {
      const gw = createGateway();
      const perms = gw.resolveRolePermissions('owner');
      expect(perms).toContain('inventory:read');
      expect(perms).toContain('billing:manage');
      expect(perms).toContain('users:delete');
      expect(perms).not.toContain('admin:all');
    });

    it('should resolve viewer permissions (read only)', () => {
      const gw = createGateway();
      const perms = gw.resolveRolePermissions('viewer');
      expect(perms).toContain('inventory:read');
      expect(perms).toContain('sessions:read');
      expect(perms).not.toContain('inventory:write');
      expect(perms).not.toContain('billing:manage');
    });

    it('should resolve operator permissions', () => {
      const gw = createGateway();
      const perms = gw.resolveRolePermissions('operator');
      expect(perms).toContain('inventory:read');
      expect(perms).toContain('inventory:write');
      expect(perms).not.toContain('users:write');
      expect(perms).not.toContain('billing:manage');
    });

    it('should validate permissions', () => {
      const gw = createGateway();
      expect(gw.isValidPermission('inventory:read')).toBe(true);
      expect(gw.isValidPermission('admin:all')).toBe(true);
      expect(gw.isValidPermission('fake:permission')).toBe(false);
    });

    it('should resolve scope permissions', () => {
      const gw = createGateway();
      
      const readOnly = gw.resolveScopePermissions('read_only');
      expect(readOnly).toContain('inventory:read');
      expect(readOnly).not.toContain('inventory:write');
      
      const exportOnly = gw.resolveScopePermissions('export_only');
      expect(exportOnly).toContain('export:generate');
      expect(exportOnly).not.toContain('agents:read');
      
      const custom = gw.resolveScopePermissions('custom', ['memory:read']);
      expect(custom).toEqual(['memory:read']);
    });
  });

  // ─── Rate Limiting ───────────────────────────────────────────────────

  describe('Rate Limiting', () => {

    it('should allow requests within rate limit', () => {
      const gw = createGateway();
      
      const result = gw.checkRateLimit('user-1', 100);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
    });

    it('should block when rate limit exceeded', () => {
      const gw = createGateway();
      
      // Exhaust the limit
      for (let i = 0; i < 5; i++) {
        gw.checkRateLimit('user-1', 5);
      }
      
      const result = gw.checkRateLimit('user-1', 5);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should track different keys independently', () => {
      const gw = createGateway();
      
      for (let i = 0; i < 5; i++) {
        gw.checkRateLimit('user-1', 5);
      }
      
      // user-1 exhausted, user-2 should be fine
      expect(gw.checkRateLimit('user-1', 5).allowed).toBe(false);
      expect(gw.checkRateLimit('user-2', 5).allowed).toBe(true);
    });

    it('should cleanup expired buckets', () => {
      const gw = createGateway();
      
      gw.checkRateLimit('user-1', 100);
      gw.checkRateLimit('user-2', 100);
      
      // Manually expire by manipulating internal state
      const stats = gw.getStats();
      expect(stats.rateLimitBuckets).toBe(2);
      
      const cleaned = gw.cleanupRateLimits();
      // Buckets are fresh so won't be cleaned
      expect(cleaned).toBe(0);
    });

    it('should emit rate exceeded event', () => {
      const gw = createGateway();
      const handler = vi.fn();
      gw.on('rate:exceeded', handler);
      
      for (let i = 0; i < 3; i++) {
        gw.checkRateLimit('test-key', 3);
      }
      gw.checkRateLimit('test-key', 3);
      
      expect(handler).toHaveBeenCalledWith('test-key', '');
    });
  });

  // ─── Request Logging ─────────────────────────────────────────────────

  describe('Request Logging', () => {

    it('should log requests', () => {
      const gw = createGateway();
      
      gw.logRequest({
        requestId: 'req-1',
        method: 'GET',
        path: '/api/v1/inventory',
        clientIp: '127.0.0.1',
        authMethod: 'jwt',
        userId: 'user-1',
        statusCode: 200,
        responseTimeMs: 42,
        requestSize: 0,
        responseSize: 1024,
        timestamp: new Date().toISOString(),
      });
      
      const logs = gw.getRequestLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].path).toBe('/api/v1/inventory');
    });

    it('should filter logs by userId', () => {
      const gw = createGateway();
      
      gw.logRequest({ requestId: '1', method: 'GET', path: '/a', clientIp: '1', authMethod: 'jwt', userId: 'u1', statusCode: 200, responseTimeMs: 1, requestSize: 0, responseSize: 0, timestamp: new Date().toISOString() });
      gw.logRequest({ requestId: '2', method: 'GET', path: '/b', clientIp: '1', authMethod: 'jwt', userId: 'u2', statusCode: 200, responseTimeMs: 1, requestSize: 0, responseSize: 0, timestamp: new Date().toISOString() });
      
      const logs = gw.getRequestLogs({ userId: 'u1' });
      expect(logs).toHaveLength(1);
      expect(logs[0].path).toBe('/a');
    });

    it('should filter logs by method', () => {
      const gw = createGateway();
      
      gw.logRequest({ requestId: '1', method: 'GET', path: '/a', clientIp: '1', authMethod: 'none', statusCode: 200, responseTimeMs: 1, requestSize: 0, responseSize: 0, timestamp: new Date().toISOString() });
      gw.logRequest({ requestId: '2', method: 'POST', path: '/b', clientIp: '1', authMethod: 'none', statusCode: 201, responseTimeMs: 1, requestSize: 100, responseSize: 0, timestamp: new Date().toISOString() });
      
      const logs = gw.getRequestLogs({ method: 'POST' });
      expect(logs).toHaveLength(1);
      expect(logs[0].path).toBe('/b');
    });

    it('should filter logs by status code range', () => {
      const gw = createGateway();
      
      gw.logRequest({ requestId: '1', method: 'GET', path: '/ok', clientIp: '1', authMethod: 'none', statusCode: 200, responseTimeMs: 1, requestSize: 0, responseSize: 0, timestamp: new Date().toISOString() });
      gw.logRequest({ requestId: '2', method: 'GET', path: '/err', clientIp: '1', authMethod: 'none', statusCode: 500, responseTimeMs: 1, requestSize: 0, responseSize: 0, timestamp: new Date().toISOString() });
      
      const errorLogs = gw.getRequestLogs({ minStatus: 500 });
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].path).toBe('/err');
    });

    it('should limit log results', () => {
      const gw = createGateway();
      
      for (let i = 0; i < 10; i++) {
        gw.logRequest({ requestId: `r-${i}`, method: 'GET', path: `/p${i}`, clientIp: '1', authMethod: 'none', statusCode: 200, responseTimeMs: 1, requestSize: 0, responseSize: 0, timestamp: new Date().toISOString() });
      }
      
      const logs = gw.getRequestLogs({ limit: 3 });
      expect(logs).toHaveLength(3);
    });

    it('should redact PII from logs', () => {
      const gw = createGateway({ redactPii: true });
      
      gw.logRequest({
        requestId: '1',
        method: 'GET',
        path: '/api/users/test@example.com/profile',
        clientIp: '1',
        authMethod: 'jwt',
        statusCode: 200,
        responseTimeMs: 1,
        requestSize: 0,
        responseSize: 0,
        timestamp: new Date().toISOString(),
      });
      
      const logs = gw.getRequestLogs();
      expect(logs[0].path).toContain('[REDACTED_EMAIL]');
      expect(logs[0].path).not.toContain('test@example.com');
    });

    it('should not log when logging is disabled', () => {
      const gw = createGateway({ requestLogging: false });
      
      gw.logRequest({ requestId: '1', method: 'GET', path: '/a', clientIp: '1', authMethod: 'none', statusCode: 200, responseTimeMs: 1, requestSize: 0, responseSize: 0, timestamp: new Date().toISOString() });
      
      expect(gw.getRequestLogs()).toHaveLength(0);
    });

    it('should cap log history at 10,000', () => {
      const gw = createGateway();
      
      for (let i = 0; i < 10005; i++) {
        gw.logRequest({ requestId: `r-${i}`, method: 'GET', path: `/p`, clientIp: '1', authMethod: 'none', statusCode: 200, responseTimeMs: 1, requestSize: 0, responseSize: 0, timestamp: new Date().toISOString() });
      }
      
      const allLogs = gw.getRequestLogs({ limit: 20000 });
      expect(allLogs.length).toBeLessThanOrEqual(10000);
    });
  });

  // ─── Request Analytics ───────────────────────────────────────────────

  describe('Request Analytics', () => {

    it('should compute request analytics', () => {
      const gw = createGateway();
      
      gw.logRequest({ requestId: '1', method: 'GET', path: '/api/inventory', clientIp: '1', authMethod: 'jwt', statusCode: 200, responseTimeMs: 100, requestSize: 0, responseSize: 512, timestamp: new Date().toISOString() });
      gw.logRequest({ requestId: '2', method: 'POST', path: '/api/sessions', clientIp: '1', authMethod: 'jwt', statusCode: 201, responseTimeMs: 200, requestSize: 256, responseSize: 128, timestamp: new Date().toISOString() });
      gw.logRequest({ requestId: '3', method: 'GET', path: '/api/inventory', clientIp: '1', authMethod: 'api_key', statusCode: 500, responseTimeMs: 50, requestSize: 0, responseSize: 64, timestamp: new Date().toISOString() });
      
      const analytics = gw.getRequestAnalytics();
      expect(analytics.totalRequests).toBe(3);
      expect(analytics.requestsByMethod['GET']).toBe(2);
      expect(analytics.requestsByMethod['POST']).toBe(1);
      expect(analytics.requestsByStatus['2xx']).toBe(2);
      expect(analytics.requestsByStatus['5xx']).toBe(1);
      expect(analytics.avgResponseTimeMs).toBe(117); // (100+200+50)/3 rounded
      expect(analytics.errorRate).toBeCloseTo(1/3);
      expect(analytics.topEndpoints[0].path).toBe('/api/inventory');
      expect(analytics.topEndpoints[0].count).toBe(2);
    });

    it('should handle empty analytics', () => {
      const gw = createGateway();
      const analytics = gw.getRequestAnalytics();
      expect(analytics.totalRequests).toBe(0);
      expect(analytics.avgResponseTimeMs).toBe(0);
      expect(analytics.errorRate).toBe(0);
    });
  });

  // ─── CORS ────────────────────────────────────────────────────────────

  describe('CORS', () => {

    it('should allow all origins by default (empty list)', () => {
      const gw = createGateway({ corsOrigins: [] });
      expect(gw.isOriginAllowed('https://example.com')).toBe(true);
    });

    it('should check specific allowed origins', () => {
      const gw = createGateway({ corsOrigins: ['https://dashboard.example.com', 'http://localhost:3000'] });
      
      expect(gw.isOriginAllowed('https://dashboard.example.com')).toBe(true);
      expect(gw.isOriginAllowed('http://localhost:3000')).toBe(true);
      expect(gw.isOriginAllowed('https://evil.com')).toBe(false);
    });

    it('should allow wildcard origin', () => {
      const gw = createGateway({ corsOrigins: ['*'] });
      expect(gw.isOriginAllowed('https://anything.com')).toBe(true);
    });

    it('should generate CORS headers', () => {
      const gw = createGateway({ corsOrigins: [] });
      const headers = gw.getCorsHeaders('https://example.com');
      
      expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
      expect(headers['Access-Control-Allow-Methods']).toContain('GET');
      expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
    });

    it('should not include CORS headers for blocked origin', () => {
      const gw = createGateway({ corsOrigins: ['https://allowed.com'] });
      const headers = gw.getCorsHeaders('https://blocked.com');
      
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });
  });

  // ─── Route Matching ──────────────────────────────────────────────────

  describe('Route Matching', () => {

    it('should match exact routes', () => {
      const gw = createGateway();
      gw.registerRoute({ method: 'GET', path: '/api/v1/health', handler: 'healthCheck' });
      
      const match = gw.matchRoute('GET', '/api/v1/health');
      expect(match).not.toBeNull();
      expect(match!.route.handler).toBe('healthCheck');
      expect(match!.params).toEqual({});
    });

    it('should extract path parameters', () => {
      const gw = createGateway();
      gw.registerRoute({ method: 'GET', path: '/api/v1/sessions/:sessionId', handler: 'getSession' });
      
      const match = gw.matchRoute('GET', '/api/v1/sessions/abc-123');
      expect(match).not.toBeNull();
      expect(match!.params.sessionId).toBe('abc-123');
    });

    it('should extract multiple path parameters', () => {
      const gw = createGateway();
      gw.registerRoute({ method: 'GET', path: '/api/v1/sessions/:sessionId/items/:itemId', handler: 'getItem' });
      
      const match = gw.matchRoute('GET', '/api/v1/sessions/s1/items/i2');
      expect(match).not.toBeNull();
      expect(match!.params.sessionId).toBe('s1');
      expect(match!.params.itemId).toBe('i2');
    });

    it('should match by HTTP method', () => {
      const gw = createGateway();
      gw.registerRoute({ method: 'GET', path: '/api/v1/items', handler: 'listItems' });
      gw.registerRoute({ method: 'POST', path: '/api/v1/items', handler: 'createItem' });
      
      expect(gw.matchRoute('GET', '/api/v1/items')!.route.handler).toBe('listItems');
      expect(gw.matchRoute('POST', '/api/v1/items')!.route.handler).toBe('createItem');
    });

    it('should return null for unmatched routes', () => {
      const gw = createGateway();
      gw.registerRoute({ method: 'GET', path: '/api/v1/health', handler: 'health' });
      
      expect(gw.matchRoute('GET', '/api/v1/nonexistent')).toBeNull();
      expect(gw.matchRoute('POST', '/api/v1/health')).toBeNull();
    });

    it('should register multiple routes at once', () => {
      const gw = createGateway();
      gw.registerRoutes([
        { method: 'GET', path: '/a', handler: 'ha' },
        { method: 'GET', path: '/b', handler: 'hb' },
      ]);
      
      expect(gw.getRoutes()).toHaveLength(2);
    });
  });

  // ─── State Serialization ─────────────────────────────────────────────

  describe('State Serialization', () => {

    it('should export and import state', () => {
      const gw1 = createGateway();
      gw1.createApiKey('user-1', 'Key A', 'full');
      gw1.createApiKey('user-2', 'Key B', 'read_only');
      gw1.issueToken('user-1', 'a@b.com', 'admin');
      gw1.revokeToken('some-jti');
      gw1.registerRoute({ method: 'GET', path: '/test', handler: 'test' });
      
      const state = gw1.exportState();
      
      const gw2 = createGateway();
      gw2.importState(state);
      
      // Keys should be imported
      expect(gw2.listApiKeys('user-1')).toHaveLength(1);
      expect(gw2.listApiKeys('user-2')).toHaveLength(1);
      
      // Routes should be imported
      expect(gw2.getRoutes()).toHaveLength(1);
      
      // Revoked JTIs should be imported
      const stats = gw2.getStats();
      expect(stats.revokedJtis).toBe(1);
    });

    it('should handle partial import', () => {
      const gw = createGateway();
      gw.importState({ apiKeys: [] });
      expect(gw.getStats().totalApiKeys).toBe(0);
    });
  });

  // ─── Gateway Stats ───────────────────────────────────────────────────

  describe('Gateway Stats', () => {

    it('should return accurate stats', () => {
      const gw = createGateway();
      
      gw.createApiKey('user-1', 'Active', 'full');
      const { key } = gw.createApiKey('user-1', 'Revoked', 'full')!;
      gw.revokeApiKey(key.id);
      gw.issueToken('user-1', 'a@b.com', 'admin');
      gw.revokeToken('jti-1');
      gw.registerRoute({ method: 'GET', path: '/test', handler: 'test' });
      
      const stats = gw.getStats();
      expect(stats.totalApiKeys).toBe(2);
      expect(stats.activeApiKeys).toBe(1);
      expect(stats.revokedKeys).toBe(1);
      expect(stats.totalRefreshTokens).toBe(1);
      expect(stats.activeRefreshTokens).toBe(1);
      expect(stats.revokedJtis).toBe(1);
      expect(stats.registeredRoutes).toBe(1);
    });
  });

  // ─── Voice Summary ──────────────────────────────────────────────────

  describe('Voice Summary', () => {

    it('should generate a voice summary', () => {
      const gw = createGateway();
      gw.createApiKey('user-1', 'Test', 'full');
      
      gw.logRequest({ requestId: '1', method: 'GET', path: '/test', clientIp: '1', authMethod: 'jwt', statusCode: 200, responseTimeMs: 50, requestSize: 0, responseSize: 0, timestamp: new Date().toISOString() });
      
      const summary = gw.getVoiceSummary();
      expect(summary).toContain('1 requests');
      expect(summary).toContain('50 milliseconds');
      expect(summary).toContain('1 active API keys');
    });

    it('should warn about high error rates', () => {
      const gw = createGateway();
      
      gw.logRequest({ requestId: '1', method: 'GET', path: '/test', clientIp: '1', authMethod: 'none', statusCode: 500, responseTimeMs: 1, requestSize: 0, responseSize: 0, timestamp: new Date().toISOString() });
      
      const summary = gw.getVoiceSummary();
      expect(summary).toContain('error rate');
    });
  });
});
