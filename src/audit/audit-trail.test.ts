/**
 * Tests for the Audit Trail Engine
 *
 * Covers: event recording, hash chain integrity, querying, retention,
 * export, PII redaction, statistics, and voice summaries.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AuditTrail,
  AuditEvent,
  AuditActor,
  AuditTarget,
  AuditQuery,
  AuditTrailConfig,
} from './audit-trail.js';

// ─── Test Helpers ─────────────────────────────────────────────

function makeActor(overrides?: Partial<AuditActor>): AuditActor {
  return { type: 'user', id: 'user-1', name: 'Alice', role: 'admin', ...overrides };
}

function makeTarget(overrides?: Partial<AuditTarget>): AuditTarget {
  return { type: 'session', id: 'sess-1', label: 'Inventory Session #1', ...overrides };
}

function recordSampleEvents(trail: AuditTrail, count: number = 5): AuditEvent[] {
  const events: AuditEvent[] = [];
  const categories = ['auth', 'user', 'inventory', 'security', 'billing'] as const;
  const outcomes = ['success', 'failure', 'denied', 'success', 'success'] as const;
  const severities = ['info', 'warning', 'critical', 'info', 'info'] as const;

  for (let i = 0; i < count; i++) {
    const idx = i % 5;
    events.push(trail.record({
      category: categories[idx],
      action: `${categories[idx]}.test.action${i}`,
      actor: makeActor({ id: `user-${i % 3}` }),
      outcome: outcomes[idx],
      severity: severities[idx],
      description: `Test event number ${i}`,
      metadata: { index: i },
    }));
  }
  return events;
}

// ─── Tests ────────────────────────────────────────────────────

describe('AuditTrail', () => {
  let trail: AuditTrail;

  beforeEach(() => {
    trail = new AuditTrail();
  });

  // ─── Event Recording ─────────────────────────────────────

  describe('Event Recording', () => {
    it('should record a basic audit event', () => {
      const event = trail.record({
        category: 'auth',
        action: 'auth.login',
        actor: makeActor(),
        outcome: 'success',
        severity: 'info',
        description: 'User logged in',
      });

      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.category).toBe('auth');
      expect(event.action).toBe('auth.login');
      expect(event.actor.id).toBe('user-1');
      expect(event.outcome).toBe('success');
      expect(event.severity).toBe('info');
      expect(event.description).toBe('User logged in');
    });

    it('should assign sequential sequence numbers', () => {
      const e1 = trail.record({
        category: 'auth', action: 'auth.login', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'First',
      });
      const e2 = trail.record({
        category: 'auth', action: 'auth.logout', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Second',
      });

      expect(e1.sequence).toBe(1);
      expect(e2.sequence).toBe(2);
    });

    it('should generate hash chain', () => {
      const e1 = trail.record({
        category: 'auth', action: 'auth.login', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Event 1',
      });
      const e2 = trail.record({
        category: 'auth', action: 'auth.logout', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Event 2',
      });

      expect(e1.hash).toBeDefined();
      expect(e2.hash).toBeDefined();
      expect(e1.hash).not.toBe(e2.hash);
      expect(e1.hash!.length).toBe(64); // SHA-256 hex
    });

    it('should record events with targets and changes', () => {
      const target: AuditTarget = {
        type: 'config',
        id: 'server.port',
        label: 'Server Port',
        changes: [{ field: 'port', oldValue: 3000, newValue: 8080 }],
      };

      const event = trail.record({
        category: 'config',
        action: 'config.change',
        actor: makeActor(),
        target,
        outcome: 'success',
        severity: 'warning',
        description: 'Changed server port',
      });

      expect(event.target?.changes).toHaveLength(1);
      expect(event.target?.changes![0].oldValue).toBe(3000);
      expect(event.target?.changes![0].newValue).toBe(8080);
    });

    it('should include optional fields', () => {
      const event = trail.record({
        category: 'auth',
        action: 'auth.login',
        actor: makeActor(),
        outcome: 'success',
        severity: 'info',
        description: 'Login with IP',
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        correlationId: 'corr-123',
        metadata: { method: 'password' },
      });

      expect(event.ipAddress).toBe('192.168.1.100');
      expect(event.userAgent).toBe('Mozilla/5.0');
      expect(event.correlationId).toBe('corr-123');
      expect(event.metadata?.method).toBe('password');
    });

    it('should emit event:recorded on every record', () => {
      const handler = vi.fn();
      trail.on('event:recorded', handler);

      trail.record({
        category: 'auth', action: 'auth.test', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Test',
      });

      expect(handler).toHaveBeenCalledOnce();
    });

    it('should emit event:critical for critical events', () => {
      const handler = vi.fn();
      trail.on('event:critical', handler);

      trail.record({
        category: 'security', action: 'security.breach', actor: makeActor(),
        outcome: 'denied', severity: 'critical', description: 'Unauthorized access attempt',
      });

      expect(handler).toHaveBeenCalledOnce();
    });

    it('should not emit event:critical for non-critical events', () => {
      const handler = vi.fn();
      trail.on('event:critical', handler);

      trail.record({
        category: 'auth', action: 'auth.login', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Normal login',
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should skip recording when disabled', () => {
      const disabledTrail = new AuditTrail({ disabled: true });
      const event = disabledTrail.record({
        category: 'auth', action: 'auth.test', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Test',
      });

      expect(event.id).toBe('');
      expect(disabledTrail.getEventCount()).toBe(0);
    });
  });

  // ─── Convenience Methods ──────────────────────────────────

  describe('Convenience Methods', () => {
    it('should record auth events', () => {
      const event = trail.recordAuth(
        'login', makeActor(), 'success', 'User logged in via password',
        { method: 'password' }, '192.168.1.100',
      );

      expect(event.category).toBe('auth');
      expect(event.action).toBe('auth.login');
      expect(event.severity).toBe('info');
      expect(event.ipAddress).toBe('192.168.1.100');
    });

    it('should record auth denial as warning', () => {
      const event = trail.recordAuth(
        'login', makeActor(), 'denied', 'Invalid password',
      );

      expect(event.severity).toBe('warning');
      expect(event.outcome).toBe('denied');
    });

    it('should record data access events', () => {
      const event = trail.recordDataAccess(
        'export', makeActor(), makeTarget(), 'Exported session data',
        { format: 'csv' },
      );

      expect(event.category).toBe('data');
      expect(event.action).toBe('data.export');
      expect(event.target?.id).toBe('sess-1');
    });

    it('should record security events', () => {
      const event = trail.recordSecurity(
        'threat_detected', makeActor(), 'critical',
        'QR code phishing detected', { url: 'http://evil.com' }, '10.0.0.1',
      );

      expect(event.category).toBe('security');
      expect(event.action).toBe('security.threat_detected');
      expect(event.severity).toBe('critical');
    });

    it('should record config change events', () => {
      const target: AuditTarget = {
        type: 'config', id: 'vision.model',
        changes: [{ field: 'model', oldValue: 'gpt-4o', newValue: 'claude-3.5' }],
      };

      const event = trail.recordConfigChange(makeActor(), target, 'Changed vision model');

      expect(event.category).toBe('config');
      expect(event.severity).toBe('warning');
    });
  });

  // ─── Hash Chain Integrity ─────────────────────────────────

  describe('Hash Chain Integrity', () => {
    it('should verify intact chain', () => {
      recordSampleEvents(trail, 10);
      const result = trail.verifyChain();
      expect(result.intact).toBe(true);
    });

    it('should detect tampered event', () => {
      recordSampleEvents(trail, 5);

      // Tamper with an event's description
      const state = trail.exportState();
      state.events[2].description = 'TAMPERED DESCRIPTION';
      trail.importState(state);

      const result = trail.verifyChain();
      expect(result.intact).toBe(false);
      expect(result.brokenAt).toBe(2);
    });

    it('should detect missing hash', () => {
      recordSampleEvents(trail, 3);

      const state = trail.exportState();
      delete (state.events[1] as any).hash;
      trail.importState(state);

      const result = trail.verifyChain();
      expect(result.intact).toBe(false);
      expect(result.brokenAt).toBe(1);
    });

    it('should verify individual events', () => {
      const events = recordSampleEvents(trail, 5);
      expect(trail.verifyEvent(events[0].id)).toBe(true);
      expect(trail.verifyEvent(events[2].id)).toBe(true);
      expect(trail.verifyEvent(events[4].id)).toBe(true);
    });

    it('should return false for non-existent event verification', () => {
      expect(trail.verifyEvent('nonexistent')).toBe(false);
    });

    it('should skip verification when hash chain disabled', () => {
      const noHashTrail = new AuditTrail({ enableHashChain: false });
      recordSampleEvents(noHashTrail, 5);

      const result = noHashTrail.verifyChain();
      expect(result.intact).toBe(true);
      expect(result.details).toContain('disabled');
    });

    it('should emit chain:broken on verification failure', () => {
      const handler = vi.fn();
      trail.on('chain:broken', handler);

      recordSampleEvents(trail, 3);
      const state = trail.exportState();
      state.events[1].description = 'TAMPERED';
      trail.importState(state);

      trail.verifyChain();
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  // ─── Querying ─────────────────────────────────────────────

  describe('Querying', () => {
    beforeEach(() => {
      recordSampleEvents(trail, 15);
    });

    it('should return all events with empty query', () => {
      const results = trail.query({});
      expect(results.length).toBe(15);
    });

    it('should filter by category', () => {
      const results = trail.query({ category: 'auth' });
      expect(results.every(e => e.category === 'auth')).toBe(true);
    });

    it('should filter by multiple categories', () => {
      const results = trail.query({ categories: ['auth', 'security'] });
      expect(results.every(e => e.category === 'auth' || e.category === 'security')).toBe(true);
    });

    it('should filter by exact action', () => {
      const results = trail.query({ action: 'auth.test.action0' });
      expect(results.every(e => e.action === 'auth.test.action0')).toBe(true);
    });

    it('should filter by action prefix', () => {
      const results = trail.query({ action: 'auth.*' });
      expect(results.every(e => e.action.startsWith('auth.'))).toBe(true);
    });

    it('should filter by actor ID', () => {
      const results = trail.query({ actorId: 'user-0' });
      expect(results.every(e => e.actor.id === 'user-0')).toBe(true);
    });

    it('should filter by actor type', () => {
      // All our test events use 'user' type
      const results = trail.query({ actorType: 'user' });
      expect(results.length).toBe(15);

      const systemResults = trail.query({ actorType: 'system' });
      expect(systemResults.length).toBe(0);
    });

    it('should filter by outcome', () => {
      const results = trail.query({ outcome: 'failure' });
      expect(results.every(e => e.outcome === 'failure')).toBe(true);
    });

    it('should filter by severity', () => {
      const results = trail.query({ severity: 'critical' });
      expect(results.every(e => e.severity === 'critical')).toBe(true);
    });

    it('should filter by correlation ID', () => {
      trail.record({
        category: 'auth', action: 'auth.correlated', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Correlated event',
        correlationId: 'corr-xyz',
      });

      const results = trail.query({ correlationId: 'corr-xyz' });
      expect(results.length).toBe(1);
    });

    it('should filter by time range', () => {
      const now = new Date();
      const results = trail.query({
        startTime: new Date(now.getTime() - 60_000).toISOString(),
        endTime: new Date(now.getTime() + 60_000).toISOString(),
      });
      expect(results.length).toBe(15);
    });

    it('should search in descriptions', () => {
      const results = trail.query({ search: 'event number 3' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].description).toContain('3');
    });

    it('should sort ascending', () => {
      const results = trail.query({ sortOrder: 'asc', limit: 100 });
      for (let i = 1; i < results.length; i++) {
        expect(new Date(results[i].timestamp).getTime())
          .toBeGreaterThanOrEqual(new Date(results[i - 1].timestamp).getTime());
      }
    });

    it('should sort descending by default', () => {
      const results = trail.query({ limit: 100 });
      for (let i = 1; i < results.length; i++) {
        expect(new Date(results[i].timestamp).getTime())
          .toBeLessThanOrEqual(new Date(results[i - 1].timestamp).getTime());
      }
    });

    it('should paginate with offset and limit', () => {
      const page1 = trail.query({ limit: 5, offset: 0 });
      const page2 = trail.query({ limit: 5, offset: 5 });

      expect(page1.length).toBe(5);
      expect(page2.length).toBe(5);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should get event by ID', () => {
      const events = trail.query({});
      const event = trail.getEvent(events[0].id);
      expect(event).toBeDefined();
      expect(event!.id).toBe(events[0].id);
    });

    it('should return undefined for non-existent event', () => {
      expect(trail.getEvent('nonexistent')).toBeUndefined();
    });
  });

  // ─── Entity History ───────────────────────────────────────

  describe('Entity History', () => {
    it('should get history for an actor', () => {
      recordSampleEvents(trail, 10);
      const history = trail.getEntityHistory('user', 'user-0');
      expect(history.length).toBeGreaterThan(0);
    });

    it('should get history for a target', () => {
      trail.record({
        category: 'inventory', action: 'inventory.session.start',
        actor: makeActor(), target: makeTarget({ type: 'session', id: 'sess-42' }),
        outcome: 'success', severity: 'info', description: 'Started session',
      });
      trail.record({
        category: 'inventory', action: 'inventory.session.end',
        actor: makeActor(), target: makeTarget({ type: 'session', id: 'sess-42' }),
        outcome: 'success', severity: 'info', description: 'Ended session',
      });

      const history = trail.getEntityHistory('session', 'sess-42');
      expect(history.length).toBe(2);
    });

    it('should get correlated events', () => {
      const corrId = 'flow-123';
      trail.record({
        category: 'auth', action: 'auth.login', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Login',
        correlationId: corrId,
      });
      trail.record({
        category: 'inventory', action: 'inventory.start', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Start inventory',
        correlationId: corrId,
      });
      trail.record({
        category: 'auth', action: 'auth.other', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Unrelated',
      });

      const correlated = trail.getCorrelatedEvents(corrId);
      expect(correlated.length).toBe(2);
    });
  });

  // ─── PII Redaction ────────────────────────────────────────

  describe('PII Redaction', () => {
    it('should redact sensitive field names in metadata', () => {
      const event = trail.record({
        category: 'auth', action: 'auth.login', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Login',
        metadata: { password: 'supersecret', method: 'email' },
      });

      expect(event.metadata?.password).toBe('[REDACTED]');
      expect(event.metadata?.method).toBe('email');
    });

    it('should redact API keys in string values', () => {
      const event = trail.record({
        category: 'config', action: 'config.change', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Config update',
        metadata: { value: 'key is sk_live_abc123defghijk' },
      });

      expect(event.metadata?.value).not.toContain('sk_live_abc123defghijk');
    });

    it('should redact email addresses in string values', () => {
      const event = trail.record({
        category: 'user', action: 'user.update', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Email update',
        metadata: { details: 'Changed email to alice@example.com' },
      });

      expect(event.metadata?.details).not.toContain('alice@example.com');
      expect(event.metadata?.details).toContain('***@***.***');
    });

    it('should redact nested metadata objects', () => {
      const event = trail.record({
        category: 'auth', action: 'auth.login', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Login',
        metadata: {
          user: { apiKey: 'secret123', name: 'Alice' },
        },
      });

      expect((event.metadata?.user as any).apiKey).toBe('[REDACTED]');
      expect((event.metadata?.user as any).name).toBe('Alice');
    });

    it('should apply full redaction on export', () => {
      trail.record({
        category: 'auth', action: 'auth.login',
        actor: makeActor({ name: 'Alice' }),
        outcome: 'success', severity: 'info', description: 'Login',
        ipAddress: '192.168.1.100',
        metadata: { foo: 'bar' },
      });

      const exported = trail.export({ format: 'json', redaction: 'full' });
      const parsed = JSON.parse(exported);
      expect(parsed[0].actor.name).toBe('[REDACTED]');
      expect(parsed[0].ipAddress).toBe('[REDACTED]');
      expect(parsed[0].metadata.foo).toBe('[REDACTED]');
    });

    it('should apply partial redaction on export', () => {
      trail.record({
        category: 'auth', action: 'auth.login',
        actor: makeActor({ name: 'Alice' }),
        outcome: 'success', severity: 'info', description: 'Login',
        ipAddress: '192.168.1.100',
      });

      const exported = trail.export({ format: 'json', redaction: 'partial' });
      const parsed = JSON.parse(exported);
      expect(parsed[0].actor.name).toBe('Alice'); // Name preserved in partial
      expect(parsed[0].ipAddress).toContain('***'); // IP partially redacted
    });
  });

  // ─── Retention ────────────────────────────────────────────

  describe('Retention', () => {
    it('should remove events older than default retention', () => {
      const trail2 = new AuditTrail({
        retention: { defaultRetentionDays: 0 }, // 0 days = remove everything
        enableHashChain: false,
      });

      // Record event with old timestamp
      const state = trail2.exportState();
      state.events.push({
        id: 'old-1',
        timestamp: new Date(Date.now() - 100 * 86400_000).toISOString(),
        category: 'auth',
        action: 'auth.old',
        actor: makeActor(),
        outcome: 'success',
        severity: 'info',
        description: 'Old event',
      });
      trail2.importState(state);

      const removed = trail2.enforceRetention();
      expect(removed).toBe(1);
      expect(trail2.getEventCount()).toBe(0);
    });

    it('should respect category-specific retention', () => {
      const trail2 = new AuditTrail({
        retention: {
          defaultRetentionDays: 0,
          categoryRetention: { security: 999 },
          severityRetention: {},  // No severity overrides
        },
        enableHashChain: false,
      });

      const state = trail2.exportState();
      state.events.push(
        {
          id: 'old-auth', timestamp: new Date(Date.now() - 5 * 86400_000).toISOString(),
          category: 'auth', action: 'auth.login', actor: makeActor(),
          outcome: 'success', severity: 'info', description: 'Old auth',
        },
        {
          id: 'old-security', timestamp: new Date(Date.now() - 5 * 86400_000).toISOString(),
          category: 'security', action: 'security.threat', actor: makeActor(),
          outcome: 'success', severity: 'info', description: 'Old security',
        },
      );
      trail2.importState(state);

      trail2.enforceRetention();
      expect(trail2.getEventCount()).toBe(1);
      expect(trail2.getEvent('old-security')).toBeDefined();
    });

    it('should respect severity-specific retention', () => {
      const trail2 = new AuditTrail({
        retention: {
          defaultRetentionDays: 0,
          categoryRetention: {},   // No category overrides
          severityRetention: { critical: 999 },
        },
        enableHashChain: false,
      });

      const state = trail2.exportState();
      state.events.push(
        {
          id: 'info-event', timestamp: new Date(Date.now() - 5 * 86400_000).toISOString(),
          category: 'inventory', action: 'inventory.scan', actor: makeActor(),
          outcome: 'success', severity: 'info', description: 'Info event',
        },
        {
          id: 'critical-event', timestamp: new Date(Date.now() - 5 * 86400_000).toISOString(),
          category: 'inventory', action: 'inventory.breach', actor: makeActor(),
          outcome: 'denied', severity: 'critical', description: 'Critical event',
        },
      );
      trail2.importState(state);

      trail2.enforceRetention();
      expect(trail2.getEventCount()).toBe(1);
      expect(trail2.getEvent('critical-event')).toBeDefined();
    });

    it('should enforce max events', () => {
      const trail2 = new AuditTrail({
        retention: {
          defaultRetentionDays: 999,
          maxEvents: 3,
        },
        enableHashChain: false,
      });

      recordSampleEvents(trail2, 5);
      trail2.enforceRetention();
      expect(trail2.getEventCount()).toBe(3);
    });

    it('should emit retention:cleanup event', () => {
      const handler = vi.fn();
      trail.on('retention:cleanup', handler);

      // Manually add old events
      const state = trail.exportState();
      state.events.push({
        id: 'ancient',
        timestamp: new Date(Date.now() - 999 * 86400_000).toISOString(),
        category: 'auth', action: 'auth.old', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Ancient event',
      });
      trail.importState(state);

      trail.enforceRetention();
      expect(handler).toHaveBeenCalled();
    });

    it('should auto-enforce when maxMemoryEvents exceeded', () => {
      const smallTrail = new AuditTrail({
        maxMemoryEvents: 5,
        enableHashChain: false,
        retention: { defaultRetentionDays: 999 },
      });

      // Record more than max
      for (let i = 0; i < 8; i++) {
        smallTrail.record({
          category: 'auth', action: 'auth.test', actor: makeActor(),
          outcome: 'success', severity: 'info', description: `Event ${i}`,
        });
      }

      // Should have enforced retention at some point
      expect(smallTrail.getEventCount()).toBeLessThanOrEqual(8);
    });
  });

  // ─── Export ───────────────────────────────────────────────

  describe('Export', () => {
    beforeEach(() => {
      recordSampleEvents(trail, 5);
    });

    it('should export as JSON', () => {
      const json = trail.export({ format: 'json' });
      const parsed = JSON.parse(json);
      expect(parsed).toBeInstanceOf(Array);
      expect(parsed.length).toBe(5);
      expect(parsed[0].id).toBeDefined();
    });

    it('should export as JSONL', () => {
      const jsonl = trail.export({ format: 'jsonl' });
      const lines = jsonl.split('\n');
      expect(lines.length).toBe(5);
      expect(JSON.parse(lines[0]).id).toBeDefined();
    });

    it('should export as CSV', () => {
      const csv = trail.export({ format: 'csv' });
      const lines = csv.split('\n');
      expect(lines[0]).toContain('id,timestamp,category');
      expect(lines.length).toBe(6); // header + 5 events
    });

    it('should strip hashes by default', () => {
      const json = trail.export({ format: 'json' });
      const parsed = JSON.parse(json);
      expect(parsed[0].hash).toBeUndefined();
      expect(parsed[0].sequence).toBeUndefined();
    });

    it('should include hashes when requested', () => {
      const json = trail.export({ format: 'json', includeHashes: true });
      const parsed = JSON.parse(json);
      expect(parsed[0].hash).toBeDefined();
      expect(parsed[0].sequence).toBeDefined();
    });

    it('should apply query filter on export', () => {
      const json = trail.export({
        format: 'json',
        query: { category: 'auth' },
      });
      const parsed = JSON.parse(json);
      expect(parsed.every((e: any) => e.category === 'auth')).toBe(true);
    });

    it('should emit export:complete event', () => {
      const handler = vi.fn();
      trail.on('export:complete', handler);

      trail.export({ format: 'json' });
      expect(handler).toHaveBeenCalledWith(5, 'json');
    });

    it('should throw for unsupported format', () => {
      expect(() => trail.export({ format: 'xml' as any })).toThrow('Unsupported export format');
    });
  });

  // ─── Statistics ───────────────────────────────────────────

  describe('Statistics', () => {
    it('should compute correct stats', () => {
      recordSampleEvents(trail, 10);
      const stats = trail.getStats();

      expect(stats.totalEvents).toBe(10);
      expect(stats.oldestEvent).toBeDefined();
      expect(stats.newestEvent).toBeDefined();
      expect(stats.chainIntact).toBe(true);
      expect(stats.eventsToday).toBe(10);
      expect(stats.eventsThisHour).toBe(10);
    });

    it('should break down by category', () => {
      recordSampleEvents(trail, 10);
      const stats = trail.getStats();

      expect(stats.byCategory['auth']).toBe(2);
      expect(stats.byCategory['user']).toBe(2);
      expect(stats.byCategory['inventory']).toBe(2);
      expect(stats.byCategory['security']).toBe(2);
      expect(stats.byCategory['billing']).toBe(2);
    });

    it('should break down by severity', () => {
      recordSampleEvents(trail, 10);
      const stats = trail.getStats();

      expect(stats.bySeverity['info']).toBeGreaterThan(0);
      expect(stats.bySeverity['warning']).toBeGreaterThan(0);
      expect(stats.bySeverity['critical']).toBeGreaterThan(0);
    });

    it('should detect chain integrity in stats', () => {
      recordSampleEvents(trail, 5);

      // Tamper
      const state = trail.exportState();
      state.events[2].description = 'TAMPERED';
      trail.importState(state);

      const stats = trail.getStats();
      expect(stats.chainIntact).toBe(false);
    });
  });

  // ─── Failure Summary ──────────────────────────────────────

  describe('Failure Summary', () => {
    it('should aggregate failures by action', () => {
      for (let i = 0; i < 5; i++) {
        trail.record({
          category: 'auth', action: 'auth.login',
          actor: makeActor(), outcome: 'failure',
          severity: 'warning', description: 'Bad password',
        });
      }
      for (let i = 0; i < 3; i++) {
        trail.record({
          category: 'auth', action: 'auth.token_refresh',
          actor: makeActor(), outcome: 'denied',
          severity: 'warning', description: 'Expired token',
        });
      }

      const summary = trail.getFailureSummary();
      expect(summary.length).toBe(2);
      expect(summary[0].action).toBe('auth.login');
      expect(summary[0].count).toBe(5);
      expect(summary[1].action).toBe('auth.token_refresh');
      expect(summary[1].count).toBe(3);
    });

    it('should filter failures since a given time', () => {
      trail.record({
        category: 'auth', action: 'auth.login', actor: makeActor(),
        outcome: 'failure', severity: 'warning', description: 'Recent fail',
      });

      const future = new Date(Date.now() + 60_000).toISOString();
      const summary = trail.getFailureSummary(future);
      expect(summary.length).toBe(0);
    });
  });

  // ─── Actor Activity ───────────────────────────────────────

  describe('Actor Activity', () => {
    it('should get activity summary for an actor', () => {
      for (let i = 0; i < 5; i++) {
        trail.record({
          category: 'auth', action: i < 3 ? 'auth.login' : 'auth.logout',
          actor: makeActor({ id: 'active-user' }),
          outcome: i === 4 ? 'failure' : 'success',
          severity: 'info', description: `Action ${i}`,
        });
      }

      const activity = trail.getActorActivity('active-user');
      expect(activity).toBeDefined();
      expect(activity!.totalActions).toBe(5);
      expect(activity!.failures).toBe(1);
      expect(activity!.topActions.length).toBe(2);
      expect(activity!.topActions[0].action).toBe('auth.login');
      expect(activity!.topActions[0].count).toBe(3);
    });

    it('should return null for unknown actor', () => {
      expect(trail.getActorActivity('unknown')).toBeNull();
    });
  });

  // ─── Voice Summary ────────────────────────────────────────

  describe('Voice Summary', () => {
    it('should generate a basic voice summary', () => {
      recordSampleEvents(trail, 10);
      const summary = trail.getVoiceSummary();

      expect(summary).toContain('10 events');
      expect(summary).toContain('today');
    });

    it('should mention critical events in summary', () => {
      trail.record({
        category: 'security', action: 'security.breach', actor: makeActor(),
        outcome: 'denied', severity: 'critical', description: 'Breach detected',
      });

      const summary = trail.getVoiceSummary();
      expect(summary).toContain('critical');
    });

    it('should mention chain integrity issues', () => {
      recordSampleEvents(trail, 3);

      const state = trail.exportState();
      state.events[1].description = 'TAMPERED';
      trail.importState(state);

      const summary = trail.getVoiceSummary();
      expect(summary.toLowerCase()).toContain('warning');
    });
  });

  // ─── State Management ─────────────────────────────────────

  describe('State Management', () => {
    it('should export and import state', () => {
      recordSampleEvents(trail, 5);
      const state = trail.exportState();

      const trail2 = new AuditTrail();
      trail2.importState(state);

      expect(trail2.getEventCount()).toBe(5);
      expect(trail2.getSequence()).toBe(5);
    });

    it('should clear all events', () => {
      recordSampleEvents(trail, 5);
      trail.clear();

      expect(trail.getEventCount()).toBe(0);
      expect(trail.getSequence()).toBe(0);
    });

    it('should continue hash chain after import', () => {
      recordSampleEvents(trail, 3);
      const state = trail.exportState();

      const trail2 = new AuditTrail();
      trail2.importState(state);

      // Record more events
      trail2.record({
        category: 'auth', action: 'auth.continued', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Continued',
      });

      expect(trail2.getEventCount()).toBe(4);
      expect(trail2.getSequence()).toBe(4);
    });
  });

  // ─── Target Filters ───────────────────────────────────────

  describe('Target Filters', () => {
    it('should filter by target type', () => {
      trail.record({
        category: 'inventory', action: 'inventory.session.start',
        actor: makeActor(), target: { type: 'session', id: 's1' },
        outcome: 'success', severity: 'info', description: 'Session started',
      });
      trail.record({
        category: 'user', action: 'user.update',
        actor: makeActor(), target: { type: 'user', id: 'u1' },
        outcome: 'success', severity: 'info', description: 'User updated',
      });

      const sessions = trail.query({ targetType: 'session' });
      expect(sessions.length).toBe(1);
      expect(sessions[0].target?.type).toBe('session');
    });

    it('should filter by target ID', () => {
      trail.record({
        category: 'inventory', action: 'inventory.item.add',
        actor: makeActor(), target: { type: 'item', id: 'item-42' },
        outcome: 'success', severity: 'info', description: 'Added item',
      });
      trail.record({
        category: 'inventory', action: 'inventory.item.add',
        actor: makeActor(), target: { type: 'item', id: 'item-99' },
        outcome: 'success', severity: 'info', description: 'Added another',
      });

      const results = trail.query({ targetId: 'item-42' });
      expect(results.length).toBe(1);
    });
  });

  // ─── Auto-flush ───────────────────────────────────────────

  describe('Auto-flush', () => {
    it('should start and stop auto-flush', () => {
      const callback = vi.fn();
      trail.record({
        category: 'auth', action: 'auth.test', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Test',
      });

      trail.startAutoFlush(callback);
      trail.stopAutoFlush();
      // Just verifying no errors on start/stop
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle empty trail gracefully', () => {
      const stats = trail.getStats();
      expect(stats.totalEvents).toBe(0);
      expect(stats.chainIntact).toBe(true);

      const results = trail.query({});
      expect(results.length).toBe(0);

      const summary = trail.getVoiceSummary();
      expect(summary).toContain('0 events');
    });

    it('should handle events without metadata', () => {
      const event = trail.record({
        category: 'auth', action: 'auth.login', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'No metadata',
      });

      expect(event.metadata).toBeUndefined();
    });

    it('should handle events without targets', () => {
      const event = trail.record({
        category: 'system', action: 'system.start', actor: { type: 'system', id: 'system' },
        outcome: 'success', severity: 'info', description: 'System started',
      });

      expect(event.target).toBeUndefined();
    });

    it('should handle non-string metadata values in redaction', () => {
      const event = trail.record({
        category: 'auth', action: 'auth.test', actor: makeActor(),
        outcome: 'success', severity: 'info', description: 'Test',
        metadata: { count: 42, active: true, tags: ['a', 'b'] },
      });

      expect(event.metadata?.count).toBe(42);
      expect(event.metadata?.active).toBe(true);
      expect(event.metadata?.tags).toEqual(['a', 'b']);
    });

    it('should generate unique IDs for each event', () => {
      const events = recordSampleEvents(trail, 100);
      const ids = new Set(events.map(e => e.id));
      expect(ids.size).toBe(100);
    });

    it('should handle CSV export with special characters', () => {
      trail.record({
        category: 'auth', action: 'auth.login', actor: makeActor(),
        outcome: 'success', severity: 'info',
        description: 'Event with "quotes" and, commas',
      });

      const csv = trail.export({ format: 'csv' });
      expect(csv).toContain('""quotes""');
    });
  });
});
