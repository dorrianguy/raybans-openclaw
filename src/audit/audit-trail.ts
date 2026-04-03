/**
 * Audit Trail Engine — Immutable Event Logging for Compliance & Enterprise
 *
 * Every action on the platform generates an audit event. Critical for:
 * - SOC 2 / ISO 27001 compliance
 * - Enterprise customer requirements
 * - Incident investigation
 * - Usage analytics for billing verification
 * - Legal defensibility (who did what, when, with what data)
 *
 * Design: append-only log with cryptographic chaining (hash chain)
 * for tamper detection. Events are immutable once written.
 *
 * @module audit/audit-trail
 * @openclaw/raybans-vision
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────

export type AuditEventCategory =
  | 'auth'           // login, logout, token refresh, API key usage
  | 'user'           // user CRUD, preference changes
  | 'team'           // team management, invitations
  | 'inventory'      // session lifecycle, item changes
  | 'vision'         // image analysis events
  | 'agent'          // agent routing, processing
  | 'billing'        // subscription changes, payment events
  | 'config'         // configuration changes
  | 'export'         // data exports
  | 'admin'          // CLI commands, system administration
  | 'security'       // threat detections, access denials
  | 'data'           // data access, deletion, retention
  | 'integration'    // webhook, API, third-party events
  | 'system';        // system lifecycle, health events

export type AuditSeverity = 'info' | 'warning' | 'critical';

export type AuditOutcome = 'success' | 'failure' | 'denied' | 'error';

export interface AuditEvent {
  /** Unique event ID (UUIDv4) */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** Event category */
  category: AuditEventCategory;
  /** Specific action within category (e.g., 'user.login', 'inventory.session.start') */
  action: string;
  /** Who performed the action */
  actor: AuditActor;
  /** What was acted upon */
  target?: AuditTarget;
  /** Success/failure/denied */
  outcome: AuditOutcome;
  /** Severity level */
  severity: AuditSeverity;
  /** Human-readable description */
  description: string;
  /** Structured metadata (action-specific) */
  metadata?: Record<string, unknown>;
  /** IP address of the request (if applicable) */
  ipAddress?: string;
  /** User agent string */
  userAgent?: string;
  /** Correlation ID for tracing related events */
  correlationId?: string;
  /** SHA-256 hash of this event + previous hash (chain integrity) */
  hash?: string;
  /** Sequence number in the chain */
  sequence?: number;
}

export interface AuditActor {
  /** Actor type */
  type: 'user' | 'api_key' | 'system' | 'agent' | 'cron';
  /** Actor identifier (user ID, API key prefix, agent name) */
  id: string;
  /** Human-readable name */
  name?: string;
  /** User role at time of action */
  role?: string;
}

export interface AuditTarget {
  /** Target type (e.g., 'user', 'session', 'item', 'config') */
  type: string;
  /** Target identifier */
  id: string;
  /** Human-readable label */
  label?: string;
  /** Changed fields (before/after for updates) */
  changes?: AuditChange[];
}

export interface AuditChange {
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface AuditQuery {
  /** Filter by category */
  category?: AuditEventCategory;
  /** Filter by categories (OR) */
  categories?: AuditEventCategory[];
  /** Filter by action (supports prefix match with '*') */
  action?: string;
  /** Filter by actor ID */
  actorId?: string;
  /** Filter by actor type */
  actorType?: AuditActor['type'];
  /** Filter by target type */
  targetType?: string;
  /** Filter by target ID */
  targetId?: string;
  /** Filter by outcome */
  outcome?: AuditOutcome;
  /** Filter by severity */
  severity?: AuditSeverity;
  /** Filter by correlation ID */
  correlationId?: string;
  /** Start time (ISO) */
  startTime?: string;
  /** End time (ISO) */
  endTime?: string;
  /** Full-text search in description */
  search?: string;
  /** Pagination offset */
  offset?: number;
  /** Pagination limit */
  limit?: number;
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

export interface AuditRetentionPolicy {
  /** Default retention in days */
  defaultRetentionDays: number;
  /** Per-category overrides */
  categoryRetention?: Partial<Record<AuditEventCategory, number>>;
  /** Per-severity overrides (critical events kept longer) */
  severityRetention?: Partial<Record<AuditSeverity, number>>;
  /** Maximum total events (oldest evicted first, respecting retention) */
  maxEvents?: number;
}

export interface AuditStats {
  totalEvents: number;
  oldestEvent?: string;
  newestEvent?: string;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  byOutcome: Record<string, number>;
  byActorType: Record<string, number>;
  chainIntact: boolean;
  eventsToday: number;
  eventsThisHour: number;
}

export interface AuditExportOptions {
  /** Export format */
  format: 'json' | 'csv' | 'jsonl';
  /** Query to filter exported events */
  query?: AuditQuery;
  /** Include hash chain data */
  includeHashes?: boolean;
  /** PII redaction level */
  redaction?: 'none' | 'partial' | 'full';
}

export interface AuditTrailConfig {
  /** Enable hash chain for tamper detection */
  enableHashChain?: boolean;
  /** Retention policy */
  retention?: AuditRetentionPolicy;
  /** Auto-flush to persistent storage interval (ms) */
  flushIntervalMs?: number;
  /** Maximum events in memory before forcing flush */
  maxMemoryEvents?: number;
  /** PII fields to auto-redact in metadata */
  redactFields?: string[];
  /** Disable audit (for testing only) */
  disabled?: boolean;
}

export interface AuditTrailEvents {
  'event:recorded': (event: AuditEvent) => void;
  'event:critical': (event: AuditEvent) => void;
  'chain:broken': (details: { expected: string; actual: string; sequence: number }) => void;
  'retention:cleanup': (removed: number) => void;
  'export:complete': (count: number, format: string) => void;
}

// ─── Default Configuration ──────────────────────────────────────

const DEFAULT_CONFIG: Required<AuditTrailConfig> = {
  enableHashChain: true,
  retention: {
    defaultRetentionDays: 90,
    categoryRetention: {
      auth: 365,
      security: 365,
      billing: 730, // 2 years for financial records
      admin: 365,
    },
    severityRetention: {
      critical: 730,
      warning: 180,
      info: 90,
    },
    maxEvents: 1_000_000,
  },
  flushIntervalMs: 30_000,
  maxMemoryEvents: 10_000,
  redactFields: ['password', 'token', 'secret', 'apiKey', 'creditCard', 'ssn'],
  disabled: false,
};

// ─── PII Redaction Patterns ─────────────────────────────────────

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '***@***.***' },
  { pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, replacement: '***-**-****' },
  { pattern: /\b(?:sk|pk|rk)[-_](?:live|test)[-_][A-Za-z0-9]{10,}/g, replacement: 'sk_***_redacted' },
  { pattern: /\b[0-9]{13,19}\b/g, replacement: '****-****-****-****' },
];

// ─── Implementation ─────────────────────────────────────────────

export class AuditTrail extends EventEmitter {
  private events: AuditEvent[] = [];
  private config: Required<AuditTrailConfig>;
  private lastHash: string = '0'.repeat(64); // Genesis hash
  private sequence: number = 0;
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor(config: AuditTrailConfig = {}) {
    super();
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      retention: { ...DEFAULT_CONFIG.retention, ...(config.retention || {}) },
    };
  }

  // ─── Core: Record Events ────────────────────────────────────

  /**
   * Record an audit event. This is the primary entry point.
   * Events are immutable once recorded.
   */
  record(input: Omit<AuditEvent, 'id' | 'timestamp' | 'hash' | 'sequence'>): AuditEvent {
    if (this.config.disabled) {
      return { ...input, id: '', timestamp: '', sequence: 0 } as AuditEvent;
    }

    const event: AuditEvent = {
      ...input,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      metadata: input.metadata ? this.redactMetadata(input.metadata) : undefined,
    };

    // Hash chain
    if (this.config.enableHashChain) {
      this.sequence++;
      event.sequence = this.sequence;
      event.hash = this.computeHash(event, this.lastHash);
      this.lastHash = event.hash;
    }

    this.events.push(event);

    // Emit events
    this.emit('event:recorded', event);
    if (event.severity === 'critical') {
      this.emit('event:critical', event);
    }

    // Memory pressure check
    if (this.config.maxMemoryEvents && this.events.length > this.config.maxMemoryEvents) {
      this.enforceRetention();
    }

    return event;
  }

  /**
   * Convenience: record an auth event
   */
  recordAuth(
    action: string,
    actor: AuditActor,
    outcome: AuditOutcome,
    description: string,
    metadata?: Record<string, unknown>,
    ipAddress?: string,
  ): AuditEvent {
    return this.record({
      category: 'auth',
      action: `auth.${action}`,
      actor,
      outcome,
      severity: outcome === 'denied' ? 'warning' : 'info',
      description,
      metadata,
      ipAddress,
    });
  }

  /**
   * Convenience: record a data access event
   */
  recordDataAccess(
    action: string,
    actor: AuditActor,
    target: AuditTarget,
    description: string,
    metadata?: Record<string, unknown>,
  ): AuditEvent {
    return this.record({
      category: 'data',
      action: `data.${action}`,
      actor,
      target,
      outcome: 'success',
      severity: 'info',
      description,
      metadata,
    });
  }

  /**
   * Convenience: record a security event
   */
  recordSecurity(
    action: string,
    actor: AuditActor,
    severity: AuditSeverity,
    description: string,
    metadata?: Record<string, unknown>,
    ipAddress?: string,
  ): AuditEvent {
    return this.record({
      category: 'security',
      action: `security.${action}`,
      actor,
      outcome: severity === 'critical' ? 'denied' : 'success',
      severity,
      description,
      metadata,
      ipAddress,
    });
  }

  /**
   * Convenience: record a config change event
   */
  recordConfigChange(
    actor: AuditActor,
    target: AuditTarget,
    description: string,
  ): AuditEvent {
    return this.record({
      category: 'config',
      action: 'config.change',
      actor,
      target,
      outcome: 'success',
      severity: 'warning',
      description,
    });
  }

  // ─── Query ──────────────────────────────────────────────────

  /**
   * Query audit events with filters
   */
  query(q: AuditQuery = {}): AuditEvent[] {
    let results = [...this.events];

    // Category filter
    if (q.category) {
      results = results.filter(e => e.category === q.category);
    }
    if (q.categories && q.categories.length > 0) {
      const cats = new Set(q.categories);
      results = results.filter(e => cats.has(e.category));
    }

    // Action filter (supports prefix with *)
    if (q.action) {
      if (q.action.endsWith('*')) {
        const prefix = q.action.slice(0, -1);
        results = results.filter(e => e.action.startsWith(prefix));
      } else {
        results = results.filter(e => e.action === q.action);
      }
    }

    // Actor filters
    if (q.actorId) {
      results = results.filter(e => e.actor.id === q.actorId);
    }
    if (q.actorType) {
      results = results.filter(e => e.actor.type === q.actorType);
    }

    // Target filters
    if (q.targetType) {
      results = results.filter(e => e.target?.type === q.targetType);
    }
    if (q.targetId) {
      results = results.filter(e => e.target?.id === q.targetId);
    }

    // Outcome & severity
    if (q.outcome) {
      results = results.filter(e => e.outcome === q.outcome);
    }
    if (q.severity) {
      results = results.filter(e => e.severity === q.severity);
    }

    // Correlation
    if (q.correlationId) {
      results = results.filter(e => e.correlationId === q.correlationId);
    }

    // Time range
    if (q.startTime) {
      const start = new Date(q.startTime).getTime();
      results = results.filter(e => new Date(e.timestamp).getTime() >= start);
    }
    if (q.endTime) {
      const end = new Date(q.endTime).getTime();
      results = results.filter(e => new Date(e.timestamp).getTime() <= end);
    }

    // Full-text search in description
    if (q.search) {
      const searchLower = q.search.toLowerCase();
      results = results.filter(e =>
        e.description.toLowerCase().includes(searchLower) ||
        e.action.toLowerCase().includes(searchLower),
      );
    }

    // Sort
    const order = q.sortOrder || 'desc';
    results.sort((a, b) => {
      const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return order === 'asc' ? diff : -diff;
    });

    // Pagination
    const offset = q.offset || 0;
    const limit = q.limit || 100;
    return results.slice(offset, offset + limit);
  }

  /**
   * Get a single event by ID
   */
  getEvent(id: string): AuditEvent | undefined {
    return this.events.find(e => e.id === id);
  }

  /**
   * Get events for a specific entity (all events where entity is actor or target)
   */
  getEntityHistory(entityType: string, entityId: string): AuditEvent[] {
    return this.events.filter(e =>
      (e.actor.id === entityId) ||
      (e.target?.type === entityType && e.target?.id === entityId),
    ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Get correlated events (same correlationId)
   */
  getCorrelatedEvents(correlationId: string): AuditEvent[] {
    return this.events
      .filter(e => e.correlationId === correlationId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  // ─── Hash Chain Verification ────────────────────────────────

  /**
   * Verify the integrity of the entire hash chain.
   * Returns true if chain is intact, false if tampered.
   */
  verifyChain(): { intact: boolean; brokenAt?: number; details?: string } {
    if (!this.config.enableHashChain) {
      return { intact: true, details: 'Hash chain disabled' };
    }

    let previousHash = '0'.repeat(64);

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      if (!event.hash || !event.sequence) {
        return {
          intact: false,
          brokenAt: i,
          details: `Event ${i} missing hash or sequence`,
        };
      }

      const expectedHash = this.computeHash(event, previousHash);
      if (event.hash !== expectedHash) {
        this.emit('chain:broken', {
          expected: expectedHash,
          actual: event.hash,
          sequence: event.sequence,
        });
        return {
          intact: false,
          brokenAt: i,
          details: `Hash mismatch at sequence ${event.sequence}`,
        };
      }

      previousHash = event.hash;
    }

    return { intact: true };
  }

  /**
   * Verify a single event hasn't been tampered with
   * (requires the event before it)
   */
  verifyEvent(eventId: string): boolean {
    const idx = this.events.findIndex(e => e.id === eventId);
    if (idx === -1) return false;

    const event = this.events[idx];
    if (!event.hash) return true; // No hash chain

    const prevHash = idx === 0 ? '0'.repeat(64) : this.events[idx - 1].hash!;
    const expectedHash = this.computeHash(event, prevHash);
    return event.hash === expectedHash;
  }

  // ─── Retention & Cleanup ────────────────────────────────────

  /**
   * Enforce retention policy — remove expired events
   */
  enforceRetention(): number {
    const now = Date.now();
    const retention = this.config.retention;
    const beforeCount = this.events.length;

    this.events = this.events.filter(event => {
      const eventAge = now - new Date(event.timestamp).getTime();
      const eventAgeDays = eventAge / (1000 * 60 * 60 * 24);

      // Check severity-specific retention
      if (retention.severityRetention?.[event.severity]) {
        return eventAgeDays <= retention.severityRetention[event.severity]!;
      }

      // Check category-specific retention
      if (retention.categoryRetention?.[event.category]) {
        return eventAgeDays <= retention.categoryRetention[event.category]!;
      }

      // Default retention
      return eventAgeDays <= retention.defaultRetentionDays;
    });

    // Enforce max events
    if (retention.maxEvents && this.events.length > retention.maxEvents) {
      this.events = this.events.slice(-retention.maxEvents);
    }

    const removed = beforeCount - this.events.length;
    if (removed > 0) {
      this.emit('retention:cleanup', removed);
    }

    return removed;
  }

  // ─── Export ─────────────────────────────────────────────────

  /**
   * Export audit events in various formats
   */
  export(options: AuditExportOptions): string {
    let events = options.query ? this.query(options.query) : [...this.events];

    // Apply redaction
    if (options.redaction && options.redaction !== 'none') {
      events = events.map(e => this.redactEvent(e, options.redaction!));
    }

    // Strip hashes if not requested
    if (!options.includeHashes) {
      events = events.map(e => {
        const { hash, sequence, ...rest } = e;
        return rest as AuditEvent;
      });
    }

    const count = events.length;

    switch (options.format) {
      case 'json':
        this.emit('export:complete', count, 'json');
        return JSON.stringify(events, null, 2);

      case 'jsonl':
        this.emit('export:complete', count, 'jsonl');
        return events.map(e => JSON.stringify(e)).join('\n');

      case 'csv': {
        const headers = [
          'id', 'timestamp', 'category', 'action', 'actor_type', 'actor_id',
          'actor_name', 'target_type', 'target_id', 'outcome', 'severity',
          'description', 'ip_address', 'correlation_id',
        ];
        const rows = events.map(e => [
          e.id,
          e.timestamp,
          e.category,
          e.action,
          e.actor.type,
          e.actor.id,
          e.actor.name || '',
          e.target?.type || '',
          e.target?.id || '',
          e.outcome,
          e.severity,
          `"${(e.description || '').replace(/"/g, '""')}"`,
          e.ipAddress || '',
          e.correlationId || '',
        ].join(','));

        this.emit('export:complete', count, 'csv');
        return [headers.join(','), ...rows].join('\n');
      }

      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  }

  // ─── Statistics ─────────────────────────────────────────────

  /**
   * Get audit trail statistics
   */
  getStats(): AuditStats {
    const now = Date.now();
    const hourAgo = now - 3600_000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const dayStart = startOfDay.getTime();

    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};
    const byActorType: Record<string, number> = {};
    let eventsToday = 0;
    let eventsThisHour = 0;

    for (const event of this.events) {
      byCategory[event.category] = (byCategory[event.category] || 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
      byOutcome[event.outcome] = (byOutcome[event.outcome] || 0) + 1;
      byActorType[event.actor.type] = (byActorType[event.actor.type] || 0) + 1;

      const ts = new Date(event.timestamp).getTime();
      if (ts >= dayStart) eventsToday++;
      if (ts >= hourAgo) eventsThisHour++;
    }

    const chainResult = this.config.enableHashChain ? this.verifyChain() : { intact: true };

    return {
      totalEvents: this.events.length,
      oldestEvent: this.events[0]?.timestamp,
      newestEvent: this.events[this.events.length - 1]?.timestamp,
      byCategory,
      bySeverity,
      byOutcome,
      byActorType,
      chainIntact: chainResult.intact,
      eventsToday,
      eventsThisHour,
    };
  }

  /**
   * Get failed/denied action summary (useful for security review)
   */
  getFailureSummary(since?: string): Array<{ action: string; count: number; lastOccurrence: string }> {
    const startTime = since ? new Date(since).getTime() : 0;
    const failures = this.events.filter(
      e => (e.outcome === 'failure' || e.outcome === 'denied') &&
           new Date(e.timestamp).getTime() >= startTime,
    );

    const grouped = new Map<string, { count: number; lastOccurrence: string }>();
    for (const event of failures) {
      const existing = grouped.get(event.action);
      if (!existing) {
        grouped.set(event.action, { count: 1, lastOccurrence: event.timestamp });
      } else {
        existing.count++;
        if (event.timestamp > existing.lastOccurrence) {
          existing.lastOccurrence = event.timestamp;
        }
      }
    }

    return Array.from(grouped.entries())
      .map(([action, data]) => ({ action, ...data }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get actor activity summary
   */
  getActorActivity(actorId: string): {
    totalActions: number;
    firstSeen: string;
    lastSeen: string;
    topActions: Array<{ action: string; count: number }>;
    failures: number;
  } | null {
    const actorEvents = this.events.filter(e => e.actor.id === actorId);
    if (actorEvents.length === 0) return null;

    const actionCounts = new Map<string, number>();
    let failures = 0;
    for (const event of actorEvents) {
      actionCounts.set(event.action, (actionCounts.get(event.action) || 0) + 1);
      if (event.outcome === 'failure' || event.outcome === 'denied') failures++;
    }

    const topActions = Array.from(actionCounts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalActions: actorEvents.length,
      firstSeen: actorEvents[0].timestamp,
      lastSeen: actorEvents[actorEvents.length - 1].timestamp,
      topActions,
      failures,
    };
  }

  // ─── Voice Summary ──────────────────────────────────────────

  /**
   * Generate a voice-friendly summary of the audit trail
   */
  getVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];

    parts.push(`Audit trail has ${stats.totalEvents} events`);
    parts.push(`${stats.eventsToday} today, ${stats.eventsThisHour} in the last hour`);

    if (!stats.chainIntact) {
      parts.push('WARNING: hash chain integrity violation detected');
    }

    const critical = stats.bySeverity['critical'] || 0;
    if (critical > 0) {
      parts.push(`${critical} critical events recorded`);
    }

    const denied = stats.byOutcome['denied'] || 0;
    const failures = stats.byOutcome['failure'] || 0;
    if (denied > 0 || failures > 0) {
      parts.push(`${denied} access denials, ${failures} failures`);
    }

    return parts.join('. ') + '.';
  }

  // ─── State Management ───────────────────────────────────────

  /**
   * Get total event count
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Get the current sequence number
   */
  getSequence(): number {
    return this.sequence;
  }

  /**
   * Export state for persistence
   */
  exportState(): {
    events: AuditEvent[];
    lastHash: string;
    sequence: number;
  } {
    return {
      events: [...this.events],
      lastHash: this.lastHash,
      sequence: this.sequence,
    };
  }

  /**
   * Import state from persistence
   */
  importState(state: {
    events: AuditEvent[];
    lastHash: string;
    sequence: number;
  }): void {
    this.events = [...state.events];
    this.lastHash = state.lastHash;
    this.sequence = state.sequence;
  }

  /**
   * Clear all events (use with caution — typically only for testing)
   */
  clear(): void {
    this.events = [];
    this.lastHash = '0'.repeat(64);
    this.sequence = 0;
  }

  /**
   * Start auto-flush timer
   */
  startAutoFlush(callback: (events: AuditEvent[]) => void): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => {
      if (this.events.length > 0) {
        callback([...this.events]);
      }
    }, this.config.flushIntervalMs);
  }

  /**
   * Stop auto-flush timer
   */
  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  // ─── Private Helpers ────────────────────────────────────────

  private computeHash(event: AuditEvent, previousHash: string): string {
    const payload = `${previousHash}|${event.id}|${event.timestamp}|${event.category}|${event.action}|${event.actor.type}:${event.actor.id}|${event.outcome}|${event.severity}|${event.description}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  private redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (this.config.redactFields.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        redacted[key] = this.redactPII(value);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        redacted[key] = this.redactMetadata(value as Record<string, unknown>);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  private redactPII(value: string): string {
    let result = value;
    for (const { pattern, replacement } of PII_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  private redactEvent(event: AuditEvent, level: 'partial' | 'full'): AuditEvent {
    const redacted = { ...event };

    if (level === 'full') {
      // Full redaction: remove all PII
      redacted.actor = {
        ...redacted.actor,
        name: redacted.actor.name ? '[REDACTED]' : undefined,
      };
      redacted.ipAddress = redacted.ipAddress ? '[REDACTED]' : undefined;
      redacted.userAgent = redacted.userAgent ? '[REDACTED]' : undefined;
      if (redacted.metadata) {
        redacted.metadata = Object.fromEntries(
          Object.entries(redacted.metadata).map(([k]) => [k, '[REDACTED]']),
        );
      }
    } else {
      // Partial: redact sensitive fields only
      redacted.ipAddress = redacted.ipAddress
        ? redacted.ipAddress.replace(/(\d+\.\d+\.\d+\.)\d+/, '$1***')
        : undefined;
      if (redacted.metadata) {
        redacted.metadata = this.redactMetadata(redacted.metadata);
      }
    }

    return redacted;
  }
}
