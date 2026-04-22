/**
 * Auth & API Key Manager — Authentication and Access Control
 *
 * Manages user authentication, API keys, scopes, rate limits per key,
 * key rotation, and access logging. The gateway between the outside world
 * and the platform.
 *
 * Key capabilities:
 * - API key generation with prefix and scoped permissions
 * - Key rotation with grace periods
 * - Per-key rate limiting (separate from global rate limits)
 * - Key usage tracking and analytics
 * - Scope-based access control (read, write, admin per resource)
 * - User authentication with session tokens
 * - Key revocation with audit trail
 * - Voice-friendly auth status summaries
 *
 * @module auth/auth-manager
 */

import { EventEmitter } from 'events';
import { createHash, randomBytes } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────

export type KeyStatus = 'active' | 'expired' | 'revoked' | 'rotating';

export type Scope =
  | 'inventory:read'
  | 'inventory:write'
  | 'sessions:read'
  | 'sessions:write'
  | 'agents:read'
  | 'agents:invoke'
  | 'analytics:read'
  | 'export:read'
  | 'export:write'
  | 'billing:read'
  | 'billing:write'
  | 'users:read'
  | 'users:write'
  | 'admin:*'
  | 'webhook:manage';

export const ALL_SCOPES: Scope[] = [
  'inventory:read', 'inventory:write',
  'sessions:read', 'sessions:write',
  'agents:read', 'agents:invoke',
  'analytics:read',
  'export:read', 'export:write',
  'billing:read', 'billing:write',
  'users:read', 'users:write',
  'admin:*',
  'webhook:manage',
];

export const PLAN_SCOPES: Record<string, Scope[]> = {
  free: ['inventory:read', 'sessions:read', 'export:read'],
  solo_store: ['inventory:read', 'inventory:write', 'sessions:read', 'sessions:write', 'agents:read', 'agents:invoke', 'analytics:read', 'export:read', 'export:write'],
  multi_store: ['inventory:read', 'inventory:write', 'sessions:read', 'sessions:write', 'agents:read', 'agents:invoke', 'analytics:read', 'export:read', 'export:write', 'billing:read', 'users:read', 'webhook:manage'],
  enterprise: [...ALL_SCOPES],
};

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyHash: string; // SHA-256 hash of the actual key — never store the raw key
  keyPrefix: string; // First 8 chars for identification: "rv_prod_xxxx..."
  scopes: Scope[];
  status: KeyStatus;
  environment: 'production' | 'staging' | 'development';
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
  revokedAt?: number;
  revokedReason?: string;
  rotatedFromId?: string; // Previous key ID if this was created via rotation
  rotationGraceUntil?: number; // Old key stays valid until this time
  usageCount: number;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  metadata?: Record<string, unknown>;
  ipWhitelist?: string[];
}

export interface AuthSession {
  id: string;
  userId: string;
  token: string; // session token
  deviceId?: string;
  createdAt: number;
  expiresAt: number;
  lastActivityAt: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface KeyUsageRecord {
  keyId: string;
  timestamp: number;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  ipAddress?: string;
}

export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  keyId?: string;
  scopes?: Scope[];
  reason?: string;
}

export interface AuthManagerConfig {
  maxKeysPerUser: number;
  maxSessionsPerUser: number;
  defaultKeyExpirationMs: number;
  sessionExpirationMs: number;
  rotationGracePeriodMs: number;
  defaultRateLimitPerMinute: number;
  defaultRateLimitPerDay: number;
  maxUsageHistory: number;
  keyPrefix: string;
}

export const DEFAULT_AUTH_CONFIG: AuthManagerConfig = {
  maxKeysPerUser: 10,
  maxSessionsPerUser: 20,
  defaultKeyExpirationMs: 365 * 24 * 60 * 60 * 1000, // 1 year
  sessionExpirationMs: 24 * 60 * 60 * 1000, // 24 hours
  rotationGracePeriodMs: 24 * 60 * 60 * 1000, // 24 hours
  defaultRateLimitPerMinute: 60,
  defaultRateLimitPerDay: 10000,
  maxUsageHistory: 50000,
  keyPrefix: 'rv',
};

export interface AuthManagerEvents {
  'key:created': (key: ApiKey, rawKey: string) => void;
  'key:revoked': (keyId: string, reason: string) => void;
  'key:rotated': (oldKeyId: string, newKeyId: string) => void;
  'key:expired': (keyId: string) => void;
  'key:used': (keyId: string, endpoint: string) => void;
  'key:rate_limited': (keyId: string, type: 'minute' | 'day') => void;
  'auth:success': (result: AuthResult) => void;
  'auth:failure': (result: AuthResult) => void;
  'session:created': (session: AuthSession) => void;
  'session:expired': (sessionId: string) => void;
}

// ─── Auth Manager ──────────────────────────────────────────────────────────

export class AuthManager extends EventEmitter {
  private keys: Map<string, ApiKey> = new Map();
  private sessions: Map<string, AuthSession> = new Map();
  private usageHistory: KeyUsageRecord[] = [];
  private rateLimitCounters: Map<string, { minute: number[]; day: number[] }> = new Map();
  private config: AuthManagerConfig;
  private idCounter: number = 0;

  constructor(config: Partial<AuthManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_AUTH_CONFIG, ...config };
  }

  // ─── API Key Management ───────────────────────────────────────────────

  /**
   * Create a new API key. Returns the raw key — this is the ONLY time it's available.
   */
  createKey(params: {
    userId: string;
    name: string;
    scopes: Scope[];
    environment?: 'production' | 'staging' | 'development';
    expiresInMs?: number;
    rateLimitPerMinute?: number;
    rateLimitPerDay?: number;
    ipWhitelist?: string[];
    metadata?: Record<string, unknown>;
  }): { key: ApiKey; rawKey: string } {
    // Check key limit
    const userKeys = this.getActiveKeysForUser(params.userId);
    if (userKeys.length >= this.config.maxKeysPerUser) {
      throw new Error(`User has reached the maximum of ${this.config.maxKeysPerUser} API keys`);
    }

    // Validate scopes
    for (const scope of params.scopes) {
      if (!ALL_SCOPES.includes(scope)) {
        throw new Error(`Invalid scope: '${scope}'`);
      }
    }

    const now = Date.now();
    const environment = params.environment || 'production';
    const rawKey = this.generateRawKey(environment);
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12);
    const id = this.generateId('key');

    const key: ApiKey = {
      id,
      userId: params.userId,
      name: params.name,
      keyHash,
      keyPrefix,
      scopes: [...params.scopes],
      status: 'active',
      environment,
      createdAt: now,
      expiresAt: params.expiresInMs ? now + params.expiresInMs : now + this.config.defaultKeyExpirationMs,
      usageCount: 0,
      rateLimitPerMinute: params.rateLimitPerMinute || this.config.defaultRateLimitPerMinute,
      rateLimitPerDay: params.rateLimitPerDay || this.config.defaultRateLimitPerDay,
      ipWhitelist: params.ipWhitelist,
      metadata: params.metadata,
    };

    this.keys.set(id, key);
    this.emit('key:created', { ...key }, rawKey);

    return { key: { ...key }, rawKey };
  }

  /**
   * Authenticate a request with an API key.
   */
  authenticateKey(rawKey: string, options?: {
    requiredScopes?: Scope[];
    ipAddress?: string;
    endpoint?: string;
  }): AuthResult {
    const keyHash = this.hashKey(rawKey);

    // Find key by hash
    let matchedKey: ApiKey | undefined;
    for (const key of this.keys.values()) {
      if (key.keyHash === keyHash) {
        matchedKey = key;
        break;
      }
    }

    if (!matchedKey) {
      const result: AuthResult = { authenticated: false, reason: 'invalid_key' };
      this.emit('auth:failure', result);
      return result;
    }

    // Check status
    if (matchedKey.status === 'revoked') {
      const result: AuthResult = { authenticated: false, keyId: matchedKey.id, reason: 'key_revoked' };
      this.emit('auth:failure', result);
      return result;
    }

    if (matchedKey.status === 'expired') {
      const result: AuthResult = { authenticated: false, keyId: matchedKey.id, reason: 'key_expired' };
      this.emit('auth:failure', result);
      return result;
    }

    // Check if key has expired by date
    const now = Date.now();
    if (matchedKey.expiresAt && now > matchedKey.expiresAt) {
      // Check rotation grace period
      if (matchedKey.status === 'rotating' && matchedKey.rotationGraceUntil && now <= matchedKey.rotationGraceUntil) {
        // Still within grace period — allow
      } else {
        matchedKey.status = 'expired';
        this.emit('key:expired', matchedKey.id);
        const result: AuthResult = { authenticated: false, keyId: matchedKey.id, reason: 'key_expired' };
        this.emit('auth:failure', result);
        return result;
      }
    }

    // Check IP whitelist
    if (matchedKey.ipWhitelist && matchedKey.ipWhitelist.length > 0 && options?.ipAddress) {
      if (!matchedKey.ipWhitelist.includes(options.ipAddress)) {
        const result: AuthResult = { authenticated: false, keyId: matchedKey.id, reason: 'ip_not_allowed' };
        this.emit('auth:failure', result);
        return result;
      }
    }

    // Check rate limits
    if (!this.checkRateLimit(matchedKey.id, matchedKey.rateLimitPerMinute, matchedKey.rateLimitPerDay)) {
      const result: AuthResult = { authenticated: false, keyId: matchedKey.id, userId: matchedKey.userId, reason: 'rate_limited' };
      this.emit('auth:failure', result);
      return result;
    }

    // Check required scopes
    if (options?.requiredScopes && options.requiredScopes.length > 0) {
      const hasAllScopes = options.requiredScopes.every(scope =>
        matchedKey!.scopes.includes(scope) || matchedKey!.scopes.includes('admin:*')
      );
      if (!hasAllScopes) {
        const result: AuthResult = {
          authenticated: false,
          keyId: matchedKey.id,
          userId: matchedKey.userId,
          scopes: matchedKey.scopes,
          reason: 'insufficient_scopes',
        };
        this.emit('auth:failure', result);
        return result;
      }
    }

    // Success — update usage
    matchedKey.lastUsedAt = now;
    matchedKey.usageCount++;
    this.recordRateLimit(matchedKey.id);

    if (options?.endpoint) {
      this.emit('key:used', matchedKey.id, options.endpoint);
    }

    const result: AuthResult = {
      authenticated: true,
      userId: matchedKey.userId,
      keyId: matchedKey.id,
      scopes: [...matchedKey.scopes],
    };
    this.emit('auth:success', result);

    return result;
  }

  /**
   * Revoke an API key.
   */
  revokeKey(keyId: string, reason: string = 'manual'): void {
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Key '${keyId}' not found`);
    if (key.status === 'revoked') throw new Error('Key is already revoked');

    key.status = 'revoked';
    key.revokedAt = Date.now();
    key.revokedReason = reason;

    this.emit('key:revoked', keyId, reason);
  }

  /**
   * Rotate an API key — creates a new key and adds a grace period to the old one.
   */
  rotateKey(keyId: string): { newKey: ApiKey; rawKey: string; graceUntil: number } {
    const oldKey = this.keys.get(keyId);
    if (!oldKey) throw new Error(`Key '${keyId}' not found`);
    if (oldKey.status !== 'active') throw new Error('Can only rotate active keys');

    const graceUntil = Date.now() + this.config.rotationGracePeriodMs;

    // Create new key with same settings
    const { key: newKey, rawKey } = this.createKey({
      userId: oldKey.userId,
      name: `${oldKey.name} (rotated)`,
      scopes: [...oldKey.scopes],
      environment: oldKey.environment,
      rateLimitPerMinute: oldKey.rateLimitPerMinute,
      rateLimitPerDay: oldKey.rateLimitPerDay,
      ipWhitelist: oldKey.ipWhitelist,
      metadata: { ...oldKey.metadata, rotatedFrom: oldKey.id },
    });

    // Put old key in rotation mode with grace period
    oldKey.status = 'rotating';
    oldKey.rotationGraceUntil = graceUntil;

    // Link new key to old
    const internalNewKey = this.keys.get(newKey.id)!;
    internalNewKey.rotatedFromId = oldKey.id;

    this.emit('key:rotated', keyId, newKey.id);

    return { newKey: { ...internalNewKey }, rawKey, graceUntil };
  }

  /**
   * Get key by ID.
   */
  getKey(keyId: string): ApiKey | undefined {
    const key = this.keys.get(keyId);
    return key ? { ...key } : undefined;
  }

  /**
   * Get all active keys for a user.
   */
  getActiveKeysForUser(userId: string): ApiKey[] {
    return Array.from(this.keys.values())
      .filter(k => k.userId === userId && (k.status === 'active' || k.status === 'rotating'))
      .map(k => ({ ...k }));
  }

  /**
   * Get all keys for a user (including revoked/expired).
   */
  getAllKeysForUser(userId: string): ApiKey[] {
    return Array.from(this.keys.values())
      .filter(k => k.userId === userId)
      .map(k => ({ ...k }));
  }

  /**
   * Check if a key has a specific scope.
   */
  hasScope(keyId: string, scope: Scope): boolean {
    const key = this.keys.get(keyId);
    if (!key) return false;
    return key.scopes.includes(scope) || key.scopes.includes('admin:*');
  }

  // ─── Session Management ───────────────────────────────────────────────

  /**
   * Create an auth session (for dashboard/UI login).
   */
  createSession(params: {
    userId: string;
    deviceId?: string;
    ipAddress?: string;
    userAgent?: string;
    expiresInMs?: number;
  }): AuthSession {
    // Check session limit
    const userSessions = this.getActiveSessionsForUser(params.userId);
    if (userSessions.length >= this.config.maxSessionsPerUser) {
      // Expire oldest session
      const oldest = userSessions.sort((a, b) => a.createdAt - b.createdAt)[0];
      this.expireSession(oldest.id);
    }

    const now = Date.now();
    const id = this.generateId('ses');
    const token = this.generateSessionToken();

    const session: AuthSession = {
      id,
      userId: params.userId,
      token,
      deviceId: params.deviceId,
      createdAt: now,
      expiresAt: now + (params.expiresInMs || this.config.sessionExpirationMs),
      lastActivityAt: now,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    };

    this.sessions.set(id, session);
    this.emit('session:created', { ...session });

    return { ...session };
  }

  /**
   * Validate a session token.
   */
  validateSession(token: string): AuthResult {
    for (const session of this.sessions.values()) {
      if (session.token === token) {
        const now = Date.now();
        if (now > session.expiresAt) {
          this.expireSession(session.id);
          return { authenticated: false, reason: 'session_expired' };
        }

        session.lastActivityAt = now;
        return {
          authenticated: true,
          userId: session.userId,
        };
      }
    }

    return { authenticated: false, reason: 'invalid_session' };
  }

  /**
   * Expire a session.
   */
  expireSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.emit('session:expired', sessionId);
    }
  }

  /**
   * Get active sessions for a user.
   */
  getActiveSessionsForUser(userId: string): AuthSession[] {
    const now = Date.now();
    return Array.from(this.sessions.values())
      .filter(s => s.userId === userId && s.expiresAt > now)
      .map(s => ({ ...s }));
  }

  /**
   * Revoke all sessions for a user (force logout).
   */
  revokeAllSessions(userId: string): number {
    let count = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.userId === userId) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  // ─── Usage Tracking ───────────────────────────────────────────────────

  /**
   * Record API key usage.
   */
  recordUsage(record: KeyUsageRecord): void {
    this.usageHistory.push(record);

    // Trim
    if (this.usageHistory.length > this.config.maxUsageHistory) {
      this.usageHistory = this.usageHistory.slice(-Math.floor(this.config.maxUsageHistory * 0.75));
    }
  }

  /**
   * Get usage stats for a key.
   */
  getKeyUsageStats(keyId: string): {
    totalRequests: number;
    last24h: number;
    last7d: number;
    averageLatencyMs: number;
    errorRate: number;
    topEndpoints: Record<string, number>;
  } {
    const records = this.usageHistory.filter(r => r.keyId === keyId);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const last24h = records.filter(r => now - r.timestamp < day);
    const last7d = records.filter(r => now - r.timestamp < 7 * day);

    const totalLatency = records.reduce((sum, r) => sum + r.latencyMs, 0);
    const errors = records.filter(r => r.statusCode >= 400);

    const topEndpoints: Record<string, number> = {};
    for (const r of records) {
      topEndpoints[r.endpoint] = (topEndpoints[r.endpoint] || 0) + 1;
    }

    return {
      totalRequests: records.length,
      last24h: last24h.length,
      last7d: last7d.length,
      averageLatencyMs: records.length > 0 ? totalLatency / records.length : 0,
      errorRate: records.length > 0 ? errors.length / records.length : 0,
      topEndpoints,
    };
  }

  // ─── Scope Helpers ────────────────────────────────────────────────────

  /**
   * Get default scopes for a plan.
   */
  getScopesForPlan(planId: string): Scope[] {
    return PLAN_SCOPES[planId] || PLAN_SCOPES.free;
  }

  /**
   * Check if a scope set includes a required scope.
   */
  static scopeIncludes(userScopes: Scope[], requiredScope: Scope): boolean {
    return userScopes.includes(requiredScope) || userScopes.includes('admin:*');
  }

  // ─── Summary ──────────────────────────────────────────────────────────

  /**
   * Get overall auth stats.
   */
  getStats(): {
    totalKeys: number;
    activeKeys: number;
    revokedKeys: number;
    expiredKeys: number;
    activeSessions: number;
    totalUsage: number;
  } {
    const keys = Array.from(this.keys.values());
    const now = Date.now();
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.expiresAt > now);

    return {
      totalKeys: keys.length,
      activeKeys: keys.filter(k => k.status === 'active').length,
      revokedKeys: keys.filter(k => k.status === 'revoked').length,
      expiredKeys: keys.filter(k => k.status === 'expired').length,
      activeSessions: activeSessions.length,
      totalUsage: this.usageHistory.length,
    };
  }

  /**
   * Generate a TTS-friendly voice summary.
   */
  generateVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];

    parts.push(`${stats.totalKeys} API key${stats.totalKeys !== 1 ? 's' : ''} total.`);
    parts.push(`${stats.activeKeys} active, ${stats.revokedKeys} revoked.`);
    parts.push(`${stats.activeSessions} active session${stats.activeSessions !== 1 ? 's' : ''}.`);

    if (stats.totalUsage > 0) {
      parts.push(`${stats.totalUsage.toLocaleString()} API requests recorded.`);
    }

    return parts.join(' ');
  }

  /**
   * Expire all timed-out sessions and keys.
   */
  cleanup(): { expiredSessions: number; expiredKeys: number } {
    const now = Date.now();
    let expiredSessions = 0;
    let expiredKeys = 0;

    // Expire sessions
    for (const [id, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
        this.emit('session:expired', id);
        expiredSessions++;
      }
    }

    // Expire keys
    for (const key of this.keys.values()) {
      if (key.status === 'active' && key.expiresAt && now > key.expiresAt) {
        key.status = 'expired';
        this.emit('key:expired', key.id);
        expiredKeys++;
      }
      // Check rotating keys past grace period
      if (key.status === 'rotating' && key.rotationGraceUntil && now > key.rotationGraceUntil) {
        key.status = 'expired';
        this.emit('key:expired', key.id);
        expiredKeys++;
      }
    }

    return { expiredSessions, expiredKeys };
  }

  /**
   * Destroy and clean up.
   */
  destroy(): void {
    this.removeAllListeners();
    this.keys.clear();
    this.sessions.clear();
    this.usageHistory = [];
    this.rateLimitCounters.clear();
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private generateId(prefix: string): string {
    this.idCounter++;
    return `${prefix}_${Date.now()}_${this.idCounter}`;
  }

  private generateRawKey(environment: string): string {
    const envPrefix = environment === 'production' ? 'prod' : environment === 'staging' ? 'stg' : 'dev';
    const random = randomBytes(32).toString('hex');
    return `${this.config.keyPrefix}_${envPrefix}_${random}`;
  }

  private generateSessionToken(): string {
    return randomBytes(48).toString('hex');
  }

  private hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  private checkRateLimit(keyId: string, perMinute: number, perDay: number): boolean {
    const now = Date.now();
    const counter = this.rateLimitCounters.get(keyId);
    if (!counter) return true;

    const minuteAgo = now - 60_000;
    const dayAgo = now - 86_400_000;

    const recentMinute = counter.minute.filter(t => t > minuteAgo);
    const recentDay = counter.day.filter(t => t > dayAgo);

    if (recentMinute.length >= perMinute) {
      this.emit('key:rate_limited', keyId, 'minute');
      return false;
    }

    if (recentDay.length >= perDay) {
      this.emit('key:rate_limited', keyId, 'day');
      return false;
    }

    return true;
  }

  private recordRateLimit(keyId: string): void {
    const now = Date.now();
    if (!this.rateLimitCounters.has(keyId)) {
      this.rateLimitCounters.set(keyId, { minute: [], day: [] });
    }

    const counter = this.rateLimitCounters.get(keyId)!;
    counter.minute.push(now);
    counter.day.push(now);

    // Trim old entries periodically
    if (counter.minute.length > 200) {
      const minuteAgo = now - 60_000;
      counter.minute = counter.minute.filter(t => t > minuteAgo);
    }
    if (counter.day.length > 20000) {
      const dayAgo = now - 86_400_000;
      counter.day = counter.day.filter(t => t > dayAgo);
    }
  }
}
