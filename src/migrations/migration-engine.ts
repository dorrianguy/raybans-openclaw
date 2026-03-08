/**
 * Migration Engine
 * 
 * Database schema versioning and migration management for the Ray-Bans × OpenClaw
 * platform. Handles schema evolution, data migrations, rollbacks, and migration
 * health tracking for production deployments.
 * 
 * Features:
 * - Sequential migration with version tracking
 * - Up/down migrations with automatic rollback
 * - Dry-run mode to preview changes
 * - Migration locking to prevent concurrent migrations
 * - Migration health tracking (duration, errors, rollback count)
 * - Seed data management for initial setup
 * - Migration generators for common patterns
 * - Voice-friendly migration status summaries
 * 
 * 🌙 Night Shift Agent — 2026-03-08
 */

import { EventEmitter } from 'eventemitter3';
import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MigrationDirection = 'up' | 'down';
export type MigrationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back' | 'skipped';

export interface Migration {
  /** Unique migration version (e.g., '001', '002', or timestamp-based) */
  version: string;
  /** Human-readable name */
  name: string;
  /** Description of what this migration does */
  description: string;
  /** Up migration function (apply changes) */
  up: MigrationFn;
  /** Down migration function (rollback changes) */
  down: MigrationFn;
  /** Optional: dependencies (other migration versions that must run first) */
  dependencies?: string[];
  /** Optional: whether this migration is reversible */
  reversible?: boolean;
  /** Optional: estimated duration for progress tracking */
  estimatedDurationMs?: number;
  /** Optional: category for grouping */
  category?: MigrationCategory;
  /** Optional: batch group (migrations in same batch run together) */
  batch?: string;
}

export type MigrationFn = (context: MigrationContext) => Promise<void> | void;

export type MigrationCategory = 'schema' | 'data' | 'index' | 'seed' | 'cleanup' | 'custom';

export interface MigrationContext {
  /** Execute a SQL-like statement (abstracted for testing) */
  execute: (statement: string, params?: unknown[]) => void;
  /** Log a message during migration */
  log: (message: string) => void;
  /** Set a key-value pair in migration state */
  setState: (key: string, value: unknown) => void;
  /** Get a key-value pair from migration state */
  getState: (key: string) => unknown;
  /** Whether this is a dry run */
  dryRun: boolean;
  /** Current environment */
  environment: string;
}

export interface MigrationRecord {
  /** Migration version */
  version: string;
  /** Migration name */
  name: string;
  /** Current status */
  status: MigrationStatus;
  /** Direction when last run */
  direction: MigrationDirection;
  /** When applied */
  appliedAt?: string;
  /** When rolled back */
  rolledBackAt?: string;
  /** Duration in ms */
  durationMs?: number;
  /** Error message if failed */
  error?: string;
  /** Batch number (migrations run together) */
  batchNumber: number;
  /** Checksum for integrity verification */
  checksum: string;
  /** SQL statements executed (for audit) */
  statements: string[];
  /** Migration logs */
  logs: string[];
  /** Migration state data */
  state: Record<string, unknown>;
}

export interface MigrationPlan {
  /** Migrations to run */
  migrations: Array<{
    version: string;
    name: string;
    direction: MigrationDirection;
    category?: MigrationCategory;
    estimatedDurationMs?: number;
  }>;
  /** Total estimated duration */
  totalEstimatedMs: number;
  /** Current version before plan */
  currentVersion: string | null;
  /** Target version after plan */
  targetVersion: string;
  /** Whether this would be a rollback */
  isRollback: boolean;
}

export interface MigrationEngineConfig {
  /** Current environment */
  environment: string;
  /** Lock timeout in ms (default: 30000) */
  lockTimeoutMs?: number;
  /** Enable dry run by default */
  dryRun?: boolean;
  /** Max migration history to keep */
  maxHistory?: number;
  /** Allow running migrations without rollback support */
  allowIrreversible?: boolean;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface MigrationEngineEvents {
  'migration:start': (version: string, direction: MigrationDirection) => void;
  'migration:complete': (version: string, direction: MigrationDirection, durationMs: number) => void;
  'migration:failed': (version: string, direction: MigrationDirection, error: string) => void;
  'migration:rolled_back': (version: string) => void;
  'migration:log': (version: string, message: string) => void;
  'migration:statement': (version: string, statement: string) => void;
  'batch:start': (batchNumber: number, count: number) => void;
  'batch:complete': (batchNumber: number, count: number, durationMs: number) => void;
  'lock:acquired': () => void;
  'lock:released': () => void;
  'lock:timeout': () => void;
  'error': (message: string) => void;
}

// ─── Built-in Migration Generators ───────────────────────────────────────────

/**
 * Generate a "create table" migration.
 */
export function createTableMigration(
  version: string,
  tableName: string,
  columns: Array<{ name: string; type: string; nullable?: boolean; primaryKey?: boolean; default?: string; unique?: boolean }>,
  options?: { description?: string }
): Migration {
  return {
    version,
    name: `create_${tableName}`,
    description: options?.description ?? `Create ${tableName} table`,
    category: 'schema',
    reversible: true,
    up: (ctx) => {
      const cols = columns.map(c => {
        let def = `${c.name} ${c.type}`;
        if (c.primaryKey) def += ' PRIMARY KEY';
        if (!c.nullable && !c.primaryKey) def += ' NOT NULL';
        if (c.default !== undefined) def += ` DEFAULT ${c.default}`;
        if (c.unique) def += ' UNIQUE';
        return def;
      });
      ctx.execute(`CREATE TABLE IF NOT EXISTS ${tableName} (${cols.join(', ')})`);
      ctx.log(`Created table ${tableName} with ${columns.length} columns`);
    },
    down: (ctx) => {
      ctx.execute(`DROP TABLE IF EXISTS ${tableName}`);
      ctx.log(`Dropped table ${tableName}`);
    },
  };
}

/**
 * Generate an "add column" migration.
 */
export function addColumnMigration(
  version: string,
  tableName: string,
  column: { name: string; type: string; nullable?: boolean; default?: string },
  options?: { description?: string }
): Migration {
  return {
    version,
    name: `add_${column.name}_to_${tableName}`,
    description: options?.description ?? `Add ${column.name} column to ${tableName}`,
    category: 'schema',
    reversible: true,
    up: (ctx) => {
      let stmt = `ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.type}`;
      if (!column.nullable) stmt += ' NOT NULL';
      if (column.default !== undefined) stmt += ` DEFAULT ${column.default}`;
      ctx.execute(stmt);
      ctx.log(`Added column ${column.name} to ${tableName}`);
    },
    down: (ctx) => {
      ctx.execute(`ALTER TABLE ${tableName} DROP COLUMN ${column.name}`);
      ctx.log(`Dropped column ${column.name} from ${tableName}`);
    },
  };
}

/**
 * Generate a "create index" migration.
 */
export function createIndexMigration(
  version: string,
  tableName: string,
  columns: string[],
  options?: { unique?: boolean; indexName?: string; description?: string }
): Migration {
  const indexName = options?.indexName ?? `idx_${tableName}_${columns.join('_')}`;
  const unique = options?.unique ? 'UNIQUE ' : '';
  
  return {
    version,
    name: `create_index_${indexName}`,
    description: options?.description ?? `Create ${unique}index on ${tableName}(${columns.join(', ')})`,
    category: 'index',
    reversible: true,
    up: (ctx) => {
      ctx.execute(`CREATE ${unique}INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columns.join(', ')})`);
      ctx.log(`Created index ${indexName}`);
    },
    down: (ctx) => {
      ctx.execute(`DROP INDEX IF EXISTS ${indexName}`);
      ctx.log(`Dropped index ${indexName}`);
    },
  };
}

/**
 * Generate a seed data migration.
 */
export function seedDataMigration(
  version: string,
  tableName: string,
  rows: Record<string, unknown>[],
  options?: { description?: string; clearOnDown?: boolean }
): Migration {
  return {
    version,
    name: `seed_${tableName}`,
    description: options?.description ?? `Seed ${rows.length} rows into ${tableName}`,
    category: 'seed',
    reversible: true,
    up: (ctx) => {
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = Object.values(row).map(v =>
          typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v)
        );
        ctx.execute(`INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${vals.join(', ')})`);
      }
      ctx.log(`Seeded ${rows.length} rows into ${tableName}`);
    },
    down: (ctx) => {
      if (options?.clearOnDown !== false) {
        ctx.execute(`DELETE FROM ${tableName}`);
        ctx.log(`Cleared seed data from ${tableName}`);
      } else {
        ctx.log(`Skipping seed data removal for ${tableName}`);
      }
    },
  };
}

// ─── Migration Engine Implementation ─────────────────────────────────────────

export class MigrationEngine extends EventEmitter<MigrationEngineEvents> {
  private config: Required<MigrationEngineConfig>;
  private migrations: Map<string, Migration> = new Map();
  private records: Map<string, MigrationRecord> = new Map();
  private batchCounter: number = 0;
  private locked: boolean = false;
  private lockHolder: string | null = null;
  private lockTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: MigrationEngineConfig) {
    super();
    this.config = {
      environment: config.environment,
      lockTimeoutMs: config.lockTimeoutMs ?? 30000,
      dryRun: config.dryRun ?? false,
      maxHistory: config.maxHistory ?? 1000,
      allowIrreversible: config.allowIrreversible ?? false,
    };
  }

  // ─── Migration Registration ─────────────────────────────────────────

  /**
   * Register a single migration.
   */
  register(migration: Migration): void {
    this.migrations.set(migration.version, migration);
  }

  /**
   * Register multiple migrations.
   */
  registerAll(migrations: Migration[]): void {
    for (const m of migrations) {
      this.register(m);
    }
  }

  /**
   * Get a registered migration by version.
   */
  getMigration(version: string): Migration | null {
    return this.migrations.get(version) ?? null;
  }

  /**
   * Get all registered migrations in version order.
   */
  getAllMigrations(): Migration[] {
    return Array.from(this.migrations.values())
      .sort((a, b) => a.version.localeCompare(b.version));
  }

  // ─── Migration Execution ────────────────────────────────────────────

  /**
   * Run all pending migrations (up).
   */
  async migrateUp(options?: { dryRun?: boolean; to?: string }): Promise<{
    applied: string[];
    errors: Array<{ version: string; error: string }>;
    durationMs: number;
  }> {
    const dryRun = options?.dryRun ?? this.config.dryRun;
    const applied: string[] = [];
    const errors: Array<{ version: string; error: string }> = [];
    const startTime = Date.now();

    // Acquire lock
    if (!dryRun && !this.acquireLock()) {
      return { applied, errors: [{ version: '*', error: 'Migration lock timeout' }], durationMs: 0 };
    }

    try {
      this.batchCounter++;
      const batch = this.batchCounter;
      const pending = this.getPending();

      this.emit('batch:start', batch, pending.length);

      for (const migration of pending) {
        if (options?.to && migration.version > options.to) break;

        try {
          await this.runMigration(migration, 'up', batch, dryRun);
          applied.push(migration.version);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push({ version: migration.version, error: errorMsg });
          break; // Stop on first error
        }
      }

      const durationMs = Date.now() - startTime;
      this.emit('batch:complete', batch, applied.length, durationMs);

      return { applied, errors, durationMs };
    } finally {
      if (!dryRun) this.releaseLock();
    }
  }

  /**
   * Rollback the last batch of migrations.
   */
  async migrateDown(options?: { dryRun?: boolean; steps?: number }): Promise<{
    rolledBack: string[];
    errors: Array<{ version: string; error: string }>;
    durationMs: number;
  }> {
    const dryRun = options?.dryRun ?? this.config.dryRun;
    const steps = options?.steps ?? 1;
    const rolledBack: string[] = [];
    const errors: Array<{ version: string; error: string }> = [];
    const startTime = Date.now();

    if (!dryRun && !this.acquireLock()) {
      return { rolledBack, errors: [{ version: '*', error: 'Migration lock timeout' }], durationMs: 0 };
    }

    try {
      const applied = this.getApplied().reverse();
      const toRollback = applied.slice(0, steps);

      for (const record of toRollback) {
        const migration = this.migrations.get(record.version);
        if (!migration) {
          errors.push({ version: record.version, error: 'Migration not found' });
          continue;
        }

        if (migration.reversible === false && !this.config.allowIrreversible) {
          errors.push({ version: record.version, error: 'Migration is not reversible' });
          break;
        }

        try {
          await this.runMigration(migration, 'down', record.batchNumber, dryRun);
          rolledBack.push(migration.version);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push({ version: migration.version, error: errorMsg });
          break;
        }
      }

      return { rolledBack, errors, durationMs: Date.now() - startTime };
    } finally {
      if (!dryRun) this.releaseLock();
    }
  }

  /**
   * Run a single migration.
   */
  async runSingle(version: string, direction: MigrationDirection, options?: { dryRun?: boolean }): Promise<{
    success: boolean;
    error?: string;
    durationMs: number;
  }> {
    const migration = this.migrations.get(version);
    if (!migration) return { success: false, error: 'Migration not found', durationMs: 0 };

    const dryRun = options?.dryRun ?? this.config.dryRun;
    const startTime = Date.now();

    try {
      this.batchCounter++;
      await this.runMigration(migration, direction, this.batchCounter, dryRun);
      return { success: true, durationMs: Date.now() - startTime };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error, durationMs: Date.now() - startTime };
    }
  }

  // ─── Migration Plan ─────────────────────────────────────────────────

  /**
   * Generate a migration plan without executing.
   */
  getPlan(direction: MigrationDirection = 'up', to?: string): MigrationPlan {
    const current = this.getCurrentVersion();
    const migrations: MigrationPlan['migrations'] = [];
    let totalEstimatedMs = 0;

    if (direction === 'up') {
      const pending = this.getPending();
      for (const m of pending) {
        if (to && m.version > to) break;
        migrations.push({
          version: m.version,
          name: m.name,
          direction: 'up',
          category: m.category,
          estimatedDurationMs: m.estimatedDurationMs,
        });
        totalEstimatedMs += m.estimatedDurationMs ?? 0;
      }
    } else {
      const applied = this.getApplied().reverse();
      for (const r of applied) {
        if (to && r.version < to) break;
        const m = this.migrations.get(r.version);
        migrations.push({
          version: r.version,
          name: r.name,
          direction: 'down',
          category: m?.category,
          estimatedDurationMs: m?.estimatedDurationMs,
        });
        totalEstimatedMs += m?.estimatedDurationMs ?? 0;
      }
    }

    return {
      migrations,
      totalEstimatedMs,
      currentVersion: current,
      targetVersion: migrations.length > 0
        ? (direction === 'up' ? migrations[migrations.length - 1].version : (migrations[0]?.version ?? current ?? ''))
        : current ?? '',
      isRollback: direction === 'down',
    };
  }

  // ─── Status ─────────────────────────────────────────────────────────

  /**
   * Get the current schema version.
   */
  getCurrentVersion(): string | null {
    const applied = this.getApplied();
    return applied.length > 0 ? applied[applied.length - 1].version : null;
  }

  /**
   * Get all pending (not yet applied) migrations.
   */
  getPending(): Migration[] {
    const appliedVersions = new Set(
      this.getApplied().map(r => r.version)
    );

    return this.getAllMigrations()
      .filter(m => !appliedVersions.has(m.version));
  }

  /**
   * Get all applied migration records.
   */
  getApplied(): MigrationRecord[] {
    return Array.from(this.records.values())
      .filter(r => r.status === 'completed')
      .sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Get the migration record for a specific version.
   */
  getRecord(version: string): MigrationRecord | null {
    return this.records.get(version) ?? null;
  }

  /**
   * Get all migration records (including failed/rolled back).
   */
  getAllRecords(): MigrationRecord[] {
    return Array.from(this.records.values())
      .sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Check if a specific migration has been applied.
   */
  isApplied(version: string): boolean {
    const record = this.records.get(version);
    return record?.status === 'completed';
  }

  /**
   * Check if all migrations are applied.
   */
  isUpToDate(): boolean {
    return this.getPending().length === 0;
  }

  // ─── Integrity ──────────────────────────────────────────────────────

  /**
   * Verify migration integrity (checksums match registered migrations).
   */
  verifyIntegrity(): Array<{ version: string; issue: string }> {
    const issues: Array<{ version: string; issue: string }> = [];

    for (const record of this.getApplied()) {
      const migration = this.migrations.get(record.version);
      if (!migration) {
        issues.push({ version: record.version, issue: 'Applied migration not found in registry' });
        continue;
      }

      const currentChecksum = this.computeChecksum(migration);
      if (currentChecksum !== record.checksum) {
        issues.push({ version: record.version, issue: 'Checksum mismatch — migration was modified after applying' });
      }
    }

    return issues;
  }

  /**
   * Check for dependency issues.
   */
  checkDependencies(): Array<{ version: string; issue: string }> {
    const issues: Array<{ version: string; issue: string }> = [];
    const allVersions = new Set(Array.from(this.migrations.keys()));

    for (const m of this.migrations.values()) {
      if (m.dependencies) {
        for (const dep of m.dependencies) {
          if (!allVersions.has(dep)) {
            issues.push({ version: m.version, issue: `Dependency '${dep}' not found` });
          }
          if (dep >= m.version) {
            issues.push({ version: m.version, issue: `Dependency '${dep}' has version >= current` });
          }
        }
      }
    }

    return issues;
  }

  // ─── Lock Management ────────────────────────────────────────────────

  /**
   * Check if migrations are currently locked.
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Force release the migration lock.
   */
  forceReleaseLock(): void {
    this.locked = false;
    this.lockHolder = null;
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout);
      this.lockTimeout = null;
    }
    this.emit('lock:released');
  }

  // ─── Voice Summary ──────────────────────────────────────────────────

  /**
   * Generate a voice-friendly migration status summary.
   */
  getVoiceSummary(): string {
    const parts: string[] = [];
    const current = this.getCurrentVersion();
    const pending = this.getPending();
    const applied = this.getApplied();
    const total = this.migrations.size;

    if (current) {
      parts.push(`Database is at version ${current}.`);
    } else {
      parts.push('No migrations have been applied yet.');
    }

    parts.push(`${applied.length} of ${total} migrations applied.`);

    if (pending.length > 0) {
      parts.push(`${pending.length} pending migrations.`);
    } else {
      parts.push('Database is up to date.');
    }

    if (this.locked) {
      parts.push('Warning: Migration lock is active.');
    }

    const integrity = this.verifyIntegrity();
    if (integrity.length > 0) {
      parts.push(`Warning: ${integrity.length} integrity issues detected.`);
    }

    return parts.join(' ');
  }

  // ─── Stats ──────────────────────────────────────────────────────────

  /**
   * Get migration engine statistics.
   */
  getStats(): {
    totalMigrations: number;
    applied: number;
    pending: number;
    failed: number;
    rolledBack: number;
    currentVersion: string | null;
    isUpToDate: boolean;
    isLocked: boolean;
    totalBatches: number;
    avgDurationMs: number;
    categories: Record<string, number>;
  } {
    const allRecords = Array.from(this.records.values());
    const applied = allRecords.filter(r => r.status === 'completed');
    const durations = applied.filter(r => r.durationMs).map(r => r.durationMs!);
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    const categories: Record<string, number> = {};
    for (const m of this.migrations.values()) {
      const cat = m.category ?? 'uncategorized';
      categories[cat] = (categories[cat] ?? 0) + 1;
    }

    return {
      totalMigrations: this.migrations.size,
      applied: applied.length,
      pending: this.getPending().length,
      failed: allRecords.filter(r => r.status === 'failed').length,
      rolledBack: allRecords.filter(r => r.status === 'rolled_back').length,
      currentVersion: this.getCurrentVersion(),
      isUpToDate: this.isUpToDate(),
      isLocked: this.locked,
      totalBatches: this.batchCounter,
      avgDurationMs: avgDuration,
      categories,
    };
  }

  /**
   * Export full engine state for persistence.
   */
  exportState(): {
    records: MigrationRecord[];
    batchCounter: number;
  } {
    return {
      records: Array.from(this.records.values()),
      batchCounter: this.batchCounter,
    };
  }

  /**
   * Import engine state.
   */
  importState(state: {
    records?: MigrationRecord[];
    batchCounter?: number;
  }): void {
    if (state.records) {
      for (const r of state.records) {
        this.records.set(r.version, r);
      }
    }
    if (state.batchCounter !== undefined) {
      this.batchCounter = state.batchCounter;
    }
  }

  // ─── Private ────────────────────────────────────────────────────────

  private async runMigration(
    migration: Migration,
    direction: MigrationDirection,
    batch: number,
    dryRun: boolean
  ): Promise<void> {
    const startTime = Date.now();
    const statements: string[] = [];
    const logs: string[] = [];
    const state: Record<string, unknown> = {};

    this.emit('migration:start', migration.version, direction);

    const context: MigrationContext = {
      execute: (statement: string) => {
        statements.push(statement);
        this.emit('migration:statement', migration.version, statement);
      },
      log: (message: string) => {
        logs.push(message);
        this.emit('migration:log', migration.version, message);
      },
      setState: (key: string, value: unknown) => {
        state[key] = value;
      },
      getState: (key: string) => state[key],
      dryRun,
      environment: this.config.environment,
    };

    try {
      const fn = direction === 'up' ? migration.up : migration.down;
      await fn(context);

      const durationMs = Date.now() - startTime;

      const record: MigrationRecord = {
        version: migration.version,
        name: migration.name,
        status: direction === 'up' ? 'completed' : 'rolled_back',
        direction,
        appliedAt: direction === 'up' ? new Date().toISOString() : undefined,
        rolledBackAt: direction === 'down' ? new Date().toISOString() : undefined,
        durationMs,
        batchNumber: batch,
        checksum: this.computeChecksum(migration),
        statements,
        logs,
        state,
      };

      if (!dryRun) {
        if (direction === 'down') {
          // On rollback, remove the record (migration is no longer applied)
          this.records.delete(migration.version);
        } else {
          this.records.set(migration.version, record);
        }
      }

      this.emit('migration:complete', migration.version, direction, durationMs);

      if (direction === 'down') {
        this.emit('migration:rolled_back', migration.version);
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      const record: MigrationRecord = {
        version: migration.version,
        name: migration.name,
        status: 'failed',
        direction,
        durationMs,
        error: errorMsg,
        batchNumber: batch,
        checksum: this.computeChecksum(migration),
        statements,
        logs,
        state,
      };

      if (!dryRun) {
        this.records.set(migration.version, record);
      }

      this.emit('migration:failed', migration.version, direction, errorMsg);
      throw err;
    }
  }

  private acquireLock(): boolean {
    if (this.locked) {
      this.emit('lock:timeout');
      return false;
    }

    this.locked = true;
    this.lockHolder = crypto.randomUUID();
    this.emit('lock:acquired');

    // Auto-release after timeout
    this.lockTimeout = setTimeout(() => {
      this.forceReleaseLock();
      this.emit('lock:timeout');
    }, this.config.lockTimeoutMs);

    return true;
  }

  private releaseLock(): void {
    this.locked = false;
    this.lockHolder = null;
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout);
      this.lockTimeout = null;
    }
    this.emit('lock:released');
  }

  private computeChecksum(migration: Migration): string {
    // Checksum based on version + name + function source
    const content = `${migration.version}:${migration.name}:${migration.up.toString()}:${migration.down.toString()}`;
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }
}
