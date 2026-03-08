/**
 * Tests for Migration Engine
 * 🌙 Night Shift Agent — 2026-03-08
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MigrationEngine,
  createTableMigration,
  addColumnMigration,
  createIndexMigration,
  seedDataMigration,
  type Migration,
  type MigrationEngineConfig,
  type MigrationContext,
} from './migration-engine.js';

function createEngine(overrides?: Partial<MigrationEngineConfig>): MigrationEngine {
  return new MigrationEngine({
    environment: 'test',
    ...overrides,
  });
}

function simpleMigration(version: string, name?: string): Migration {
  return {
    version,
    name: name ?? `migration_${version}`,
    description: `Test migration ${version}`,
    up: (ctx) => {
      ctx.execute(`CREATE TABLE test_${version} (id TEXT PRIMARY KEY)`);
      ctx.log(`Applied migration ${version}`);
    },
    down: (ctx) => {
      ctx.execute(`DROP TABLE test_${version}`);
      ctx.log(`Rolled back migration ${version}`);
    },
  };
}

describe('MigrationEngine', () => {

  // ─── Registration ────────────────────────────────────────────────

  describe('Migration Registration', () => {

    it('should register a single migration', () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      
      expect(engine.getMigration('001')).not.toBeNull();
      expect(engine.getMigration('001')!.name).toBe('migration_001');
    });

    it('should register multiple migrations', () => {
      const engine = createEngine();
      engine.registerAll([
        simpleMigration('001'),
        simpleMigration('002'),
        simpleMigration('003'),
      ]);
      
      expect(engine.getAllMigrations()).toHaveLength(3);
    });

    it('should return null for unregistered migration', () => {
      const engine = createEngine();
      expect(engine.getMigration('nonexistent')).toBeNull();
    });

    it('should return migrations in version order', () => {
      const engine = createEngine();
      engine.registerAll([
        simpleMigration('003'),
        simpleMigration('001'),
        simpleMigration('002'),
      ]);
      
      const all = engine.getAllMigrations();
      expect(all[0].version).toBe('001');
      expect(all[1].version).toBe('002');
      expect(all[2].version).toBe('003');
    });
  });

  // ─── Migrate Up ─────────────────────────────────────────────────

  describe('Migrate Up', () => {

    it('should apply all pending migrations', async () => {
      const engine = createEngine();
      engine.registerAll([
        simpleMigration('001'),
        simpleMigration('002'),
        simpleMigration('003'),
      ]);
      
      const result = await engine.migrateUp();
      
      expect(result.applied).toEqual(['001', '002', '003']);
      expect(result.errors).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should skip already applied migrations', async () => {
      const engine = createEngine();
      engine.registerAll([
        simpleMigration('001'),
        simpleMigration('002'),
        simpleMigration('003'),
      ]);
      
      await engine.migrateUp();
      const result = await engine.migrateUp();
      
      expect(result.applied).toHaveLength(0);
    });

    it('should apply up to a specific version', async () => {
      const engine = createEngine();
      engine.registerAll([
        simpleMigration('001'),
        simpleMigration('002'),
        simpleMigration('003'),
      ]);
      
      const result = await engine.migrateUp({ to: '002' });
      
      expect(result.applied).toEqual(['001', '002']);
      expect(engine.getCurrentVersion()).toBe('002');
    });

    it('should stop on first error', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      engine.register({
        version: '002',
        name: 'failing',
        description: 'This fails',
        up: () => { throw new Error('Migration failed!'); },
        down: (ctx) => { ctx.log('rolled back'); },
      });
      engine.register(simpleMigration('003'));
      
      const result = await engine.migrateUp();
      
      expect(result.applied).toEqual(['001']);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].version).toBe('002');
      expect(result.errors[0].error).toContain('Migration failed');
      // Migration 003 should NOT have been applied
      expect(engine.isApplied('003')).toBe(false);
    });

    it('should support dry run', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002')]);
      
      const result = await engine.migrateUp({ dryRun: true });
      
      expect(result.applied).toEqual(['001', '002']);
      // But nothing should actually be recorded
      expect(engine.getCurrentVersion()).toBeNull();
      expect(engine.isApplied('001')).toBe(false);
    });

    it('should support async migration functions', async () => {
      const engine = createEngine();
      engine.register({
        version: '001',
        name: 'async_migration',
        description: 'Async test',
        up: async (ctx) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          ctx.execute('CREATE TABLE async_test (id TEXT)');
        },
        down: async (ctx) => {
          ctx.execute('DROP TABLE async_test');
        },
      });
      
      const result = await engine.migrateUp();
      expect(result.applied).toEqual(['001']);
      expect(result.durationMs).toBeGreaterThanOrEqual(10);
    });

    it('should track batch numbers', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002')]);
      
      await engine.migrateUp();
      
      engine.register(simpleMigration('003'));
      await engine.migrateUp();
      
      const record1 = engine.getRecord('001')!;
      const record3 = engine.getRecord('003')!;
      
      // Different batches
      expect(record1.batchNumber).not.toBe(record3.batchNumber);
    });

    it('should emit events during migration', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      
      const startHandler = vi.fn();
      const completeHandler = vi.fn();
      const logHandler = vi.fn();
      const statementHandler = vi.fn();
      const batchStartHandler = vi.fn();
      const batchCompleteHandler = vi.fn();
      
      engine.on('migration:start', startHandler);
      engine.on('migration:complete', completeHandler);
      engine.on('migration:log', logHandler);
      engine.on('migration:statement', statementHandler);
      engine.on('batch:start', batchStartHandler);
      engine.on('batch:complete', batchCompleteHandler);
      
      await engine.migrateUp();
      
      expect(startHandler).toHaveBeenCalledWith('001', 'up');
      expect(completeHandler).toHaveBeenCalled();
      expect(logHandler).toHaveBeenCalledWith('001', 'Applied migration 001');
      expect(statementHandler).toHaveBeenCalled();
      expect(batchStartHandler).toHaveBeenCalled();
      expect(batchCompleteHandler).toHaveBeenCalled();
    });
  });

  // ─── Migrate Down ───────────────────────────────────────────────

  describe('Migrate Down', () => {

    it('should rollback the last migration', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002'), simpleMigration('003')]);
      await engine.migrateUp();
      
      const result = await engine.migrateDown();
      
      expect(result.rolledBack).toEqual(['003']);
      expect(engine.getCurrentVersion()).toBe('002');
    });

    it('should rollback multiple steps', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002'), simpleMigration('003')]);
      await engine.migrateUp();
      
      const result = await engine.migrateDown({ steps: 2 });
      
      expect(result.rolledBack).toEqual(['003', '002']);
      expect(engine.getCurrentVersion()).toBe('001');
    });

    it('should rollback all migrations', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002')]);
      await engine.migrateUp();
      
      const result = await engine.migrateDown({ steps: 10 });
      
      expect(result.rolledBack).toEqual(['002', '001']);
      expect(engine.getCurrentVersion()).toBeNull();
    });

    it('should handle rollback of nothing gracefully', async () => {
      const engine = createEngine();
      const result = await engine.migrateDown();
      
      expect(result.rolledBack).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should block rollback of irreversible migration', async () => {
      const engine = createEngine({ allowIrreversible: false });
      engine.register({
        version: '001',
        name: 'irreversible',
        description: 'Cannot undo',
        reversible: false,
        up: (ctx) => { ctx.execute('CREATE TABLE x (id TEXT)'); },
        down: (ctx) => { ctx.execute('DROP TABLE x'); },
      });
      
      await engine.migrateUp();
      const result = await engine.migrateDown();
      
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('not reversible');
    });

    it('should allow rollback of irreversible when configured', async () => {
      const engine = createEngine({ allowIrreversible: true });
      engine.register({
        version: '001',
        name: 'irreversible',
        description: 'Cannot undo',
        reversible: false,
        up: (ctx) => { ctx.execute('CREATE TABLE x (id TEXT)'); },
        down: (ctx) => { ctx.execute('DROP TABLE x'); },
      });
      
      await engine.migrateUp();
      const result = await engine.migrateDown();
      
      expect(result.rolledBack).toEqual(['001']);
    });

    it('should emit rolled_back event', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      await engine.migrateUp();
      
      const handler = vi.fn();
      engine.on('migration:rolled_back', handler);
      
      await engine.migrateDown();
      expect(handler).toHaveBeenCalledWith('001');
    });

    it('should support dry run for rollback', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002')]);
      await engine.migrateUp();
      
      const result = await engine.migrateDown({ dryRun: true });
      
      expect(result.rolledBack).toEqual(['002']);
      // But it should still be applied
      expect(engine.isApplied('002')).toBe(true);
    });
  });

  // ─── Run Single ─────────────────────────────────────────────────

  describe('Run Single', () => {

    it('should run a single migration up', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      
      const result = await engine.runSingle('001', 'up');
      
      expect(result.success).toBe(true);
      expect(engine.isApplied('001')).toBe(true);
    });

    it('should run a single migration down', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      await engine.migrateUp();
      
      const result = await engine.runSingle('001', 'down');
      
      expect(result.success).toBe(true);
      expect(engine.isApplied('001')).toBe(false);
    });

    it('should handle nonexistent migration', async () => {
      const engine = createEngine();
      const result = await engine.runSingle('999', 'up');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should report failure on error', async () => {
      const engine = createEngine();
      engine.register({
        version: '001',
        name: 'failing',
        description: 'Fails',
        up: () => { throw new Error('Boom'); },
        down: () => {},
      });
      
      const result = await engine.runSingle('001', 'up');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Boom');
    });
  });

  // ─── Status ─────────────────────────────────────────────────────

  describe('Status', () => {

    it('should return null version when no migrations applied', () => {
      const engine = createEngine();
      expect(engine.getCurrentVersion()).toBeNull();
    });

    it('should track current version', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002')]);
      await engine.migrateUp();
      
      expect(engine.getCurrentVersion()).toBe('002');
    });

    it('should report pending migrations', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002'), simpleMigration('003')]);
      await engine.migrateUp({ to: '001' });
      
      const pending = engine.getPending();
      expect(pending).toHaveLength(2);
      expect(pending[0].version).toBe('002');
    });

    it('should report applied migrations', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002')]);
      await engine.migrateUp();
      
      const applied = engine.getApplied();
      expect(applied).toHaveLength(2);
    });

    it('should check if specific migration is applied', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002')]);
      await engine.migrateUp({ to: '001' });
      
      expect(engine.isApplied('001')).toBe(true);
      expect(engine.isApplied('002')).toBe(false);
    });

    it('should report up-to-date status', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      
      expect(engine.isUpToDate()).toBe(false);
      await engine.migrateUp();
      expect(engine.isUpToDate()).toBe(true);
    });

    it('should get individual migration record', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      await engine.migrateUp();
      
      const record = engine.getRecord('001');
      expect(record).not.toBeNull();
      expect(record!.status).toBe('completed');
      expect(record!.direction).toBe('up');
      expect(record!.appliedAt).toBeTruthy();
      expect(record!.statements.length).toBeGreaterThan(0);
      expect(record!.logs.length).toBeGreaterThan(0);
    });

    it('should return null for missing record', () => {
      const engine = createEngine();
      expect(engine.getRecord('nonexistent')).toBeNull();
    });

    it('should include failed records in all records', async () => {
      const engine = createEngine();
      engine.register({
        version: '001',
        name: 'failing',
        description: 'Fails',
        up: () => { throw new Error('fail'); },
        down: () => {},
      });
      
      await engine.migrateUp();
      
      const all = engine.getAllRecords();
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe('failed');
    });
  });

  // ─── Migration Plan ─────────────────────────────────────────────

  describe('Migration Plan', () => {

    it('should generate an up plan', () => {
      const engine = createEngine();
      engine.registerAll([
        { ...simpleMigration('001'), estimatedDurationMs: 100 },
        { ...simpleMigration('002'), estimatedDurationMs: 200 },
        { ...simpleMigration('003'), estimatedDurationMs: 300 },
      ]);
      
      const plan = engine.getPlan('up');
      expect(plan.migrations).toHaveLength(3);
      expect(plan.totalEstimatedMs).toBe(600);
      expect(plan.currentVersion).toBeNull();
      expect(plan.targetVersion).toBe('003');
      expect(plan.isRollback).toBe(false);
    });

    it('should generate a down plan', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002')]);
      await engine.migrateUp();
      
      const plan = engine.getPlan('down');
      expect(plan.migrations).toHaveLength(2);
      expect(plan.isRollback).toBe(true);
    });

    it('should plan up to a specific version', () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002'), simpleMigration('003')]);
      
      const plan = engine.getPlan('up', '002');
      expect(plan.migrations).toHaveLength(2);
      expect(plan.targetVersion).toBe('002');
    });

    it('should reflect applied migrations in plan', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002'), simpleMigration('003')]);
      await engine.migrateUp({ to: '001' });
      
      const plan = engine.getPlan('up');
      expect(plan.migrations).toHaveLength(2);
      expect(plan.currentVersion).toBe('001');
    });
  });

  // ─── Integrity ──────────────────────────────────────────────────

  describe('Integrity', () => {

    it('should verify integrity when checksums match', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      await engine.migrateUp();
      
      const issues = engine.verifyIntegrity();
      expect(issues).toHaveLength(0);
    });

    it('should detect modified migrations', async () => {
      const engine = createEngine();
      const m = simpleMigration('001');
      engine.register(m);
      await engine.migrateUp();
      
      // Modify the migration after applying
      engine.register({
        ...m,
        up: (ctx) => { ctx.execute('DIFFERENT SQL'); },
      });
      
      const issues = engine.verifyIntegrity();
      expect(issues).toHaveLength(1);
      expect(issues[0].issue).toContain('Checksum mismatch');
    });

    it('should detect missing migrations', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      await engine.migrateUp();
      
      // Import state to a new engine without registering the migration
      const engine2 = createEngine();
      engine2.importState(engine.exportState());
      
      const issues = engine2.verifyIntegrity();
      expect(issues).toHaveLength(1);
      expect(issues[0].issue).toContain('not found');
    });

    it('should check dependencies', () => {
      const engine = createEngine();
      engine.register({
        ...simpleMigration('002'),
        dependencies: ['001', '999'],
      });
      engine.register(simpleMigration('001'));
      
      const issues = engine.checkDependencies();
      expect(issues.some(i => i.issue.includes("'999' not found"))).toBe(true);
    });

    it('should detect forward dependencies', () => {
      const engine = createEngine();
      engine.register({
        ...simpleMigration('001'),
        dependencies: ['002'], // 002 > 001
      });
      engine.register(simpleMigration('002'));
      
      const issues = engine.checkDependencies();
      expect(issues.some(i => i.issue.includes('version >= current'))).toBe(true);
    });
  });

  // ─── Lock Management ────────────────────────────────────────────

  describe('Lock Management', () => {

    it('should prevent concurrent migrations', async () => {
      const engine = createEngine();
      engine.register({
        version: '001',
        name: 'slow',
        description: 'Slow migration',
        up: async (ctx) => {
          await new Promise(resolve => setTimeout(resolve, 50));
          ctx.execute('CREATE TABLE slow (id TEXT)');
        },
        down: (ctx) => { ctx.execute('DROP TABLE slow'); },
      });
      engine.register(simpleMigration('002'));
      
      // Start first migration
      const p1 = engine.migrateUp();
      // Try to start second immediately
      const p2 = engine.migrateUp();
      
      const [r1, r2] = await Promise.all([p1, p2]);
      
      // One should succeed, one should fail with lock timeout
      const hasLockError = r1.errors.some(e => e.error.includes('lock')) ||
                           r2.errors.some(e => e.error.includes('lock'));
      expect(hasLockError).toBe(true);
    });

    it('should report lock status', () => {
      const engine = createEngine();
      expect(engine.isLocked()).toBe(false);
    });

    it('should force release lock', async () => {
      const engine = createEngine();
      engine.register({
        version: '001',
        name: 'slow',
        description: 'Slow',
        up: async () => { await new Promise(resolve => setTimeout(resolve, 100)); },
        down: () => {},
      });
      
      // Start migration (acquires lock)
      const p = engine.migrateUp();
      
      // Force release
      engine.forceReleaseLock();
      expect(engine.isLocked()).toBe(false);
      
      await p;
    });

    it('should not use lock during dry run', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      
      await engine.migrateUp({ dryRun: true });
      expect(engine.isLocked()).toBe(false);
    });
  });

  // ─── Migration Context ──────────────────────────────────────────

  describe('Migration Context', () => {

    it('should provide execute function that records statements', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      await engine.migrateUp();
      
      const record = engine.getRecord('001')!;
      expect(record.statements).toContain('CREATE TABLE test_001 (id TEXT PRIMARY KEY)');
    });

    it('should provide log function that records messages', async () => {
      const engine = createEngine();
      engine.register(simpleMigration('001'));
      await engine.migrateUp();
      
      const record = engine.getRecord('001')!;
      expect(record.logs).toContain('Applied migration 001');
    });

    it('should provide state management', async () => {
      const engine = createEngine();
      engine.register({
        version: '001',
        name: 'stateful',
        description: 'Uses state',
        up: (ctx) => {
          ctx.setState('rowsUpdated', 42);
          ctx.log(`Updated ${ctx.getState('rowsUpdated')} rows`);
        },
        down: () => {},
      });
      
      await engine.migrateUp();
      
      const record = engine.getRecord('001')!;
      expect(record.state['rowsUpdated']).toBe(42);
    });

    it('should provide dryRun flag to context', async () => {
      let seenDryRun: boolean | undefined;
      
      const engine = createEngine();
      engine.register({
        version: '001',
        name: 'check_dry_run',
        description: 'Checks dry run',
        up: (ctx) => {
          seenDryRun = ctx.dryRun;
          if (!ctx.dryRun) {
            ctx.execute('REAL SQL');
          }
        },
        down: () => {},
      });
      
      await engine.migrateUp({ dryRun: true });
      expect(seenDryRun).toBe(true);
      
      await engine.migrateUp({ dryRun: false });
      expect(seenDryRun).toBe(false);
    });

    it('should provide environment to context', async () => {
      let seenEnv: string | undefined;
      
      const engine = createEngine({ environment: 'staging' });
      engine.register({
        version: '001',
        name: 'env_check',
        description: 'Checks env',
        up: (ctx) => { seenEnv = ctx.environment; },
        down: () => {},
      });
      
      await engine.migrateUp();
      expect(seenEnv).toBe('staging');
    });
  });

  // ─── Migration Generators ───────────────────────────────────────

  describe('Migration Generators', () => {

    it('should generate create table migration', async () => {
      const engine = createEngine();
      const migration = createTableMigration('001', 'users', [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'email', type: 'TEXT', nullable: false, unique: true },
        { name: 'name', type: 'TEXT' },
        { name: 'created_at', type: 'TEXT', default: "CURRENT_TIMESTAMP" },
      ]);
      
      engine.register(migration);
      await engine.migrateUp();
      
      const record = engine.getRecord('001')!;
      expect(record.statements[0]).toContain('CREATE TABLE');
      expect(record.statements[0]).toContain('users');
      expect(record.statements[0]).toContain('PRIMARY KEY');
      expect(record.statements[0]).toContain('NOT NULL');
      expect(record.statements[0]).toContain('UNIQUE');
      
      // Rollback
      await engine.migrateDown();
      const afterDown = engine.getRecord('001');
      expect(afterDown).toBeNull(); // Record removed on rollback
    });

    it('should generate add column migration', async () => {
      const engine = createEngine();
      const migration = addColumnMigration('001', 'users', {
        name: 'avatar_url',
        type: 'TEXT',
        nullable: true,
      });
      
      engine.register(migration);
      await engine.migrateUp();
      
      const record = engine.getRecord('001')!;
      expect(record.statements[0]).toContain('ALTER TABLE');
      expect(record.statements[0]).toContain('avatar_url');
      expect(record.name).toBe('add_avatar_url_to_users');
    });

    it('should generate create index migration', async () => {
      const engine = createEngine();
      const migration = createIndexMigration('001', 'users', ['email'], {
        unique: true,
      });
      
      engine.register(migration);
      await engine.migrateUp();
      
      const record = engine.getRecord('001')!;
      expect(record.statements[0]).toContain('CREATE UNIQUE INDEX');
      expect(record.statements[0]).toContain('idx_users_email');
    });

    it('should generate composite index migration', async () => {
      const engine = createEngine();
      const migration = createIndexMigration('001', 'sessions', ['user_id', 'store_id']);
      
      engine.register(migration);
      await engine.migrateUp();
      
      const record = engine.getRecord('001')!;
      expect(record.statements[0]).toContain('user_id, store_id');
    });

    it('should generate seed data migration', async () => {
      const engine = createEngine();
      const migration = seedDataMigration('001', 'plans', [
        { id: 'free', name: 'Free', price: 0 },
        { id: 'solo', name: 'Solo', price: 79 },
        { id: 'multi', name: 'Multi', price: 199 },
      ]);
      
      engine.register(migration);
      await engine.migrateUp();
      
      const record = engine.getRecord('001')!;
      expect(record.statements).toHaveLength(3);
      expect(record.statements[0]).toContain("INSERT INTO plans");
      expect(record.statements[0]).toContain("'free'");
      expect(record.statements[1]).toContain("'solo'");
    });

    it('should handle seed data with single quotes', async () => {
      const engine = createEngine();
      const migration = seedDataMigration('001', 'notes', [
        { id: '1', text: "It's a test" },
      ]);
      
      engine.register(migration);
      await engine.migrateUp();
      
      const record = engine.getRecord('001')!;
      expect(record.statements[0]).toContain("It''s a test");
    });

    it('should clear seed data on rollback by default', async () => {
      const engine = createEngine();
      const migration = seedDataMigration('001', 'plans', [
        { id: 'free', name: 'Free' },
      ]);
      
      engine.register(migration);
      await engine.migrateUp();
      
      // Rollback should issue DELETE
      const statementsHandler = vi.fn();
      engine.on('migration:statement', statementsHandler);
      
      await engine.migrateDown();
      
      const deleteCall = statementsHandler.mock.calls.find(([, stmt]: [string, string]) =>
        stmt.includes('DELETE')
      );
      expect(deleteCall).toBeDefined();
    });

    it('should skip seed data removal when clearOnDown is false', async () => {
      const engine = createEngine();
      const migration = seedDataMigration('001', 'plans', [
        { id: 'free', name: 'Free' },
      ], { clearOnDown: false });
      
      engine.register(migration);
      await engine.migrateUp();
      
      const statementsHandler = vi.fn();
      engine.on('migration:statement', statementsHandler);
      
      await engine.migrateDown();
      
      // Should NOT have a DELETE statement
      const deleteCall = statementsHandler.mock.calls.find(([, stmt]: [string, string]) =>
        stmt.includes('DELETE')
      );
      expect(deleteCall).toBeUndefined();
    });
  });

  // ─── State Serialization ────────────────────────────────────────

  describe('State Serialization', () => {

    it('should export and import state', async () => {
      const engine1 = createEngine();
      engine1.registerAll([simpleMigration('001'), simpleMigration('002')]);
      await engine1.migrateUp();
      
      const state = engine1.exportState();
      
      const engine2 = createEngine();
      engine2.registerAll([simpleMigration('001'), simpleMigration('002'), simpleMigration('003')]);
      engine2.importState(state);
      
      expect(engine2.getCurrentVersion()).toBe('002');
      expect(engine2.isApplied('001')).toBe(true);
      expect(engine2.isApplied('002')).toBe(true);
      expect(engine2.isApplied('003')).toBe(false);
    });
  });

  // ─── Stats ──────────────────────────────────────────────────────

  describe('Stats', () => {

    it('should return comprehensive stats', async () => {
      const engine = createEngine();
      engine.registerAll([
        { ...simpleMigration('001'), category: 'schema' },
        { ...simpleMigration('002'), category: 'schema' },
        { ...simpleMigration('003'), category: 'data' },
      ]);
      
      await engine.migrateUp({ to: '002' });
      
      const stats = engine.getStats();
      expect(stats.totalMigrations).toBe(3);
      expect(stats.applied).toBe(2);
      expect(stats.pending).toBe(1);
      expect(stats.failed).toBe(0);
      expect(stats.currentVersion).toBe('002');
      expect(stats.isUpToDate).toBe(false);
      expect(stats.isLocked).toBe(false);
      expect(stats.categories['schema']).toBe(2);
      expect(stats.categories['data']).toBe(1);
    });

    it('should track failed migration count', async () => {
      const engine = createEngine();
      engine.register({
        version: '001',
        name: 'fail',
        description: 'Fails',
        up: () => { throw new Error('fail'); },
        down: () => {},
      });
      
      await engine.migrateUp();
      
      const stats = engine.getStats();
      expect(stats.failed).toBe(1);
    });
  });

  // ─── Voice Summary ──────────────────────────────────────────────

  describe('Voice Summary', () => {

    it('should generate a summary with no migrations', () => {
      const engine = createEngine();
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('No migrations have been applied');
    });

    it('should generate a summary with applied migrations', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002')]);
      await engine.migrateUp();
      
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('version 002');
      expect(summary).toContain('2 of 2');
      expect(summary).toContain('up to date');
    });

    it('should warn about pending migrations', async () => {
      const engine = createEngine();
      engine.registerAll([simpleMigration('001'), simpleMigration('002'), simpleMigration('003')]);
      await engine.migrateUp({ to: '001' });
      
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('2 pending');
    });
  });

  // ─── Full Lifecycle Test ────────────────────────────────────────

  describe('Full Lifecycle', () => {

    it('should handle a complete migration lifecycle', async () => {
      const engine = createEngine();
      
      // Register initial schema
      engine.registerAll([
        createTableMigration('001', 'users', [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'email', type: 'TEXT', nullable: false },
          { name: 'name', type: 'TEXT' },
        ]),
        createTableMigration('002', 'sessions', [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'user_id', type: 'TEXT', nullable: false },
          { name: 'created_at', type: 'TEXT' },
        ]),
        createIndexMigration('003', 'sessions', ['user_id']),
        seedDataMigration('004', 'users', [
          { id: 'admin', email: 'admin@example.com', name: 'Admin' },
        ]),
      ]);
      
      // Apply all
      const upResult = await engine.migrateUp();
      expect(upResult.applied).toEqual(['001', '002', '003', '004']);
      expect(engine.getCurrentVersion()).toBe('004');
      expect(engine.isUpToDate()).toBe(true);
      
      // Add a new migration
      engine.register(addColumnMigration('005', 'users', {
        name: 'avatar_url',
        type: 'TEXT',
        nullable: true,
      }));
      
      expect(engine.isUpToDate()).toBe(false);
      
      // Apply new migration
      const upResult2 = await engine.migrateUp();
      expect(upResult2.applied).toEqual(['005']);
      expect(engine.getCurrentVersion()).toBe('005');
      
      // Rollback last migration
      const downResult = await engine.migrateDown();
      expect(downResult.rolledBack).toEqual(['005']);
      expect(engine.getCurrentVersion()).toBe('004');
      
      // Rollback 2 more
      const downResult2 = await engine.migrateDown({ steps: 2 });
      expect(downResult2.rolledBack).toEqual(['004', '003']);
      expect(engine.getCurrentVersion()).toBe('002');
      
      // Re-apply
      const upResult3 = await engine.migrateUp();
      expect(upResult3.applied).toEqual(['003', '004', '005']);
      expect(engine.isUpToDate()).toBe(true);
      
      // Verify integrity
      const issues = engine.verifyIntegrity();
      expect(issues).toHaveLength(0);
    });
  });
});
