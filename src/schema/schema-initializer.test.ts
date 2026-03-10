/**
 * Tests for the Schema Initializer
 *
 * Covers: table definitions, SQL generation, migration ordering,
 * validation, FTS5, pragmas, and statistics.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SchemaInitializer,
  ALL_MIGRATIONS,
  generateCreateTableSQL,
  generateCreateIndexSQL,
  generateDropTableSQL,
  generateMigrationSQL,
  TableDefinition,
  IndexDefinition,
} from './schema-initializer.js';

// ─── Tests ────────────────────────────────────────────────────

describe('SchemaInitializer', () => {
  let initializer: SchemaInitializer;

  beforeEach(() => {
    initializer = new SchemaInitializer();
  });

  // ─── Migration Definitions ────────────────────────────────

  describe('Migration Definitions', () => {
    it('should have 10 migration versions', () => {
      expect(ALL_MIGRATIONS.length).toBe(10);
    });

    it('should have sequential version numbers', () => {
      for (let i = 0; i < ALL_MIGRATIONS.length; i++) {
        expect(ALL_MIGRATIONS[i].version).toBe(i + 1);
      }
    });

    it('should have unique migration names', () => {
      const names = ALL_MIGRATIONS.map(m => m.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('should cover all categories', () => {
      const categories = ALL_MIGRATIONS.map(m => m.category);
      expect(categories).toContain('core');
      expect(categories).toContain('inventory');
      expect(categories).toContain('vision');
      expect(categories).toContain('agents');
      expect(categories).toContain('billing');
      expect(categories).toContain('audit');
      expect(categories).toContain('notifications');
      expect(categories).toContain('webhooks');
      expect(categories).toContain('devices');
      expect(categories).toContain('config');
    });

    it('should have core tables first (dependency order)', () => {
      expect(ALL_MIGRATIONS[0].category).toBe('core');
    });
  });

  // ─── Table Definitions ────────────────────────────────────

  describe('Table Definitions', () => {
    it('should define at least 20 tables', () => {
      const tableCount = initializer.getAllTableNames().length;
      expect(tableCount).toBeGreaterThanOrEqual(20);
    });

    it('should have no duplicate table names', () => {
      const names = initializer.getAllTableNames();
      expect(new Set(names).size).toBe(names.length);
    });

    it('should have primary keys on every table', () => {
      for (const migration of ALL_MIGRATIONS) {
        for (const table of migration.tables) {
          const hasPK = table.columns.some(c => c.primaryKey);
          expect(hasPK, `Table ${table.name} has no primary key`).toBe(true);
        }
      }
    });

    it('should have created_at on most tables', () => {
      let withCreatedAt = 0;
      let total = 0;
      for (const migration of ALL_MIGRATIONS) {
        for (const table of migration.tables) {
          total++;
          if (table.columns.some(c => c.name === 'created_at')) {
            withCreatedAt++;
          }
        }
      }
      // Many tables should have created_at (some use different timestamp column names)
      expect(withCreatedAt).toBeGreaterThan(total * 0.4);
    });

    it('should define users table correctly', () => {
      const users = initializer.getTableDefinition('users');
      expect(users).toBeDefined();
      expect(users!.columns.some(c => c.name === 'id' && c.primaryKey)).toBe(true);
      expect(users!.columns.some(c => c.name === 'email' && c.unique)).toBe(true);
      expect(users!.columns.some(c => c.name === 'password_hash')).toBe(true);
      expect(users!.columns.some(c => c.name === 'status')).toBe(true);
      expect(users!.columns.some(c => c.name === 'preferences')).toBe(true);
    });

    it('should define inventory_sessions table correctly', () => {
      const sessions = initializer.getTableDefinition('inventory_sessions');
      expect(sessions).toBeDefined();
      expect(sessions!.columns.some(c => c.name === 'user_id')).toBe(true);
      expect(sessions!.columns.some(c => c.name === 'status')).toBe(true);
      expect(sessions!.columns.some(c => c.name === 'item_count')).toBe(true);
      expect(sessions!.foreignKeys).toBeDefined();
      expect(sessions!.foreignKeys!.length).toBeGreaterThan(0);
    });

    it('should define subscriptions table with Stripe fields', () => {
      const subs = initializer.getTableDefinition('subscriptions');
      expect(subs).toBeDefined();
      expect(subs!.columns.some(c => c.name === 'stripe_customer_id')).toBe(true);
      expect(subs!.columns.some(c => c.name === 'stripe_subscription_id')).toBe(true);
      expect(subs!.columns.some(c => c.name === 'plan')).toBe(true);
      expect(subs!.columns.some(c => c.name === 'billing_interval')).toBe(true);
    });

    it('should define audit_events table with hash chain support', () => {
      const audit = initializer.getTableDefinition('audit_events');
      expect(audit).toBeDefined();
      expect(audit!.columns.some(c => c.name === 'sequence' && c.unique)).toBe(true);
      expect(audit!.columns.some(c => c.name === 'hash')).toBe(true);
      expect(audit!.columns.some(c => c.name === 'correlation_id')).toBe(true);
    });

    it('should define captured_images table', () => {
      const images = initializer.getTableDefinition('captured_images');
      expect(images).toBeDefined();
      expect(images!.columns.some(c => c.name === 'file_path')).toBe(true);
      expect(images!.columns.some(c => c.name === 'device_id')).toBe(true);
      expect(images!.columns.some(c => c.name === 'trigger_type')).toBe(true);
    });

    it('should define contacts table for networking agent', () => {
      const contacts = initializer.getTableDefinition('contacts');
      expect(contacts).toBeDefined();
      expect(contacts!.columns.some(c => c.name === 'name')).toBe(true);
      expect(contacts!.columns.some(c => c.name === 'company')).toBe(true);
      expect(contacts!.columns.some(c => c.name === 'linkedin')).toBe(true);
      expect(contacts!.columns.some(c => c.name === 'research')).toBe(true);
    });

    it('should return undefined for non-existent table', () => {
      expect(initializer.getTableDefinition('nonexistent')).toBeUndefined();
    });
  });

  // ─── SQL Generation ───────────────────────────────────────

  describe('SQL Generation', () => {
    it('should generate CREATE TABLE SQL', () => {
      const table: TableDefinition = {
        name: 'test_table',
        columns: [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'name', type: 'TEXT' },
          { name: 'count', type: 'INTEGER', default: 0 },
          { name: 'active', type: 'BOOLEAN', default: true },
          { name: 'data', type: 'JSON', nullable: true },
        ],
      };

      const sql = generateCreateTableSQL(table);
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS test_table');
      expect(sql).toContain('id TEXT PRIMARY KEY');
      expect(sql).toContain('name TEXT');
      expect(sql).toContain("count INTEGER DEFAULT 0");
      expect(sql).toContain('active BOOLEAN DEFAULT 1');
    });

    it('should generate CREATE TABLE with foreign keys', () => {
      const table: TableDefinition = {
        name: 'child_table',
        columns: [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'parent_id', type: 'TEXT' },
        ],
        foreignKeys: [
          {
            columns: ['parent_id'],
            references: { table: 'parent_table', columns: ['id'] },
            onDelete: 'CASCADE',
          },
        ],
      };

      const sql = generateCreateTableSQL(table);
      expect(sql).toContain('FOREIGN KEY (parent_id) REFERENCES parent_table(id) ON DELETE CASCADE');
    });

    it('should generate CREATE TABLE with CHECK constraints', () => {
      const table: TableDefinition = {
        name: 'checked_table',
        columns: [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'status', type: 'TEXT', check: "status IN ('a','b','c')" },
        ],
      };

      const sql = generateCreateTableSQL(table);
      expect(sql).toContain("CHECK(status IN ('a','b','c'))");
    });

    it('should generate CREATE TABLE with CURRENT_TIMESTAMP default', () => {
      const table: TableDefinition = {
        name: 'ts_table',
        columns: [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
        ],
      };

      const sql = generateCreateTableSQL(table);
      expect(sql).toContain('DEFAULT CURRENT_TIMESTAMP');
      // Should NOT have quotes around CURRENT_TIMESTAMP
      expect(sql).not.toContain("DEFAULT 'CURRENT_TIMESTAMP'");
    });

    it('should generate CREATE TABLE with string defaults', () => {
      const table: TableDefinition = {
        name: 'str_table',
        columns: [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'role', type: 'TEXT', default: 'viewer' },
        ],
      };

      const sql = generateCreateTableSQL(table);
      expect(sql).toContain("DEFAULT 'viewer'");
    });

    it('should generate CREATE TABLE with NULL default', () => {
      const table: TableDefinition = {
        name: 'null_table',
        columns: [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'optional', type: 'TEXT', default: null },
        ],
      };

      const sql = generateCreateTableSQL(table);
      expect(sql).toContain('DEFAULT NULL');
    });

    it('should generate CREATE INDEX SQL', () => {
      const index: IndexDefinition = {
        name: 'idx_test',
        columns: ['user_id', 'status'],
      };

      const sql = generateCreateIndexSQL('test_table', index);
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_test');
      expect(sql).toContain('ON test_table(user_id, status)');
    });

    it('should generate UNIQUE INDEX SQL', () => {
      const index: IndexDefinition = {
        name: 'idx_unique_test',
        columns: ['email'],
        unique: true,
      };

      const sql = generateCreateIndexSQL('users', index);
      expect(sql).toContain('CREATE UNIQUE INDEX');
    });

    it('should generate partial INDEX SQL', () => {
      const index: IndexDefinition = {
        name: 'idx_partial',
        columns: ['status'],
        where: "status = 'active'",
      };

      const sql = generateCreateIndexSQL('users', index);
      expect(sql).toContain("WHERE status = 'active'");
    });

    it('should generate DROP TABLE SQL', () => {
      const sql = generateDropTableSQL('test_table');
      expect(sql).toBe('DROP TABLE IF EXISTS test_table;');
    });

    it('should generate complete migration SQL', () => {
      const migration = ALL_MIGRATIONS[0]; // Core tables
      const sql = generateMigrationSQL(migration);

      expect(sql.up.length).toBeGreaterThan(0);
      expect(sql.down.length).toBeGreaterThan(0);

      // Up should contain CREATE TABLE
      expect(sql.up.some(s => s.includes('CREATE TABLE'))).toBe(true);
      // Down should contain DROP TABLE
      expect(sql.down.some(s => s.includes('DROP TABLE'))).toBe(true);
    });

    it('should generate down migration in reverse order', () => {
      const migration = ALL_MIGRATIONS[0]; // Core tables
      const sql = generateMigrationSQL(migration);

      // Last table defined should be first to drop (for FK safety)
      const lastTable = migration.tables[migration.tables.length - 1].name;
      expect(sql.down[0]).toContain(lastTable);
    });
  });

  // ─── generateSQL & generateAllSQL ─────────────────────────

  describe('Instance SQL Generation', () => {
    it('should generate SQL for a specific version', () => {
      const sql = initializer.generateSQL(1);
      expect(sql).not.toBeNull();
      expect(sql!.up.length).toBeGreaterThan(0);
      expect(sql!.down.length).toBeGreaterThan(0);
    });

    it('should return null for non-existent version', () => {
      expect(initializer.generateSQL(999)).toBeNull();
    });

    it('should generate SQL for all migrations', () => {
      const allSQL = initializer.generateAllSQL();
      expect(allSQL.length).toBe(10);
      for (const sql of allSQL) {
        expect(sql.up.length).toBeGreaterThan(0);
        expect(sql.down.length).toBeGreaterThan(0);
        expect(sql.name).toBeDefined();
      }
    });

    it('should generate valid SQL for every table', () => {
      const allSQL = initializer.generateAllSQL();
      for (const sql of allSQL) {
        for (const statement of sql.up) {
          // Should be valid SQL-ish
          expect(
            statement.includes('CREATE TABLE') || statement.includes('CREATE INDEX') || statement.includes('CREATE UNIQUE INDEX')
          ).toBe(true);
        }
      }
    });
  });

  // ─── Pragmas ──────────────────────────────────────────────

  describe('Pragmas', () => {
    it('should generate WAL pragma by default', () => {
      const pragmas = initializer.getPragmaStatements();
      expect(pragmas.some(p => p.includes('journal_mode=WAL'))).toBe(true);
    });

    it('should generate foreign keys pragma', () => {
      const pragmas = initializer.getPragmaStatements();
      expect(pragmas.some(p => p.includes('foreign_keys=ON'))).toBe(true);
    });

    it('should generate cache_size pragma', () => {
      const pragmas = initializer.getPragmaStatements();
      expect(pragmas.some(p => p.includes('cache_size='))).toBe(true);
    });

    it('should skip WAL when disabled', () => {
      const noWAL = new SchemaInitializer({ enableWAL: false });
      const pragmas = noWAL.getPragmaStatements();
      expect(pragmas.some(p => p.includes('journal_mode=WAL'))).toBe(false);
    });

    it('should skip foreign keys when disabled', () => {
      const noFK = new SchemaInitializer({ enableForeignKeys: false });
      const pragmas = noFK.getPragmaStatements();
      expect(pragmas.some(p => p.includes('foreign_keys=ON'))).toBe(false);
    });
  });

  // ─── FTS5 ─────────────────────────────────────────────────

  describe('FTS5 Virtual Tables', () => {
    it('should generate FTS5 statements', () => {
      const fts = initializer.getFTS5Statements();
      expect(fts.length).toBeGreaterThanOrEqual(3);
    });

    it('should create memory_fts table', () => {
      const fts = initializer.getFTS5Statements();
      expect(fts.some(s => s.includes('memory_fts'))).toBe(true);
      expect(fts.some(s => s.includes('scene_description'))).toBe(true);
    });

    it('should create products_fts table', () => {
      const fts = initializer.getFTS5Statements();
      expect(fts.some(s => s.includes('products_fts'))).toBe(true);
    });

    it('should create contacts_fts table', () => {
      const fts = initializer.getFTS5Statements();
      expect(fts.some(s => s.includes('contacts_fts'))).toBe(true);
    });

    it('should reference correct content tables', () => {
      const fts = initializer.getFTS5Statements();
      expect(fts.some(s => s.includes("content='memory_index'"))).toBe(true);
      expect(fts.some(s => s.includes("content='products'"))).toBe(true);
      expect(fts.some(s => s.includes("content='contacts'"))).toBe(true);
    });
  });

  // ─── Migration Tracking ───────────────────────────────────

  describe('Migration Tracking', () => {
    it('should track applied migrations', () => {
      initializer.markApplied(1);
      initializer.markApplied(2);

      expect(initializer.isApplied(1)).toBe(true);
      expect(initializer.isApplied(2)).toBe(true);
      expect(initializer.isApplied(3)).toBe(false);
    });

    it('should return pending versions', () => {
      initializer.markApplied(1);
      initializer.markApplied(2);

      const pending = initializer.getPendingVersions();
      expect(pending).not.toContain(1);
      expect(pending).not.toContain(2);
      expect(pending).toContain(3);
      expect(pending.length).toBe(8); // 10 total - 2 applied
    });

    it('should return empty pending when all applied', () => {
      for (let i = 1; i <= 10; i++) {
        initializer.markApplied(i);
      }
      expect(initializer.getPendingVersions().length).toBe(0);
    });

    it('should emit migration:applied event', () => {
      let emitted = false;
      initializer.on('migration:applied', (version, name) => {
        emitted = true;
        expect(version).toBe(1);
        expect(name).toBe('create_core_tables');
      });

      initializer.markApplied(1);
      expect(emitted).toBe(true);
    });

    it('should reset applied state', () => {
      initializer.markApplied(1);
      initializer.markApplied(2);
      initializer.reset();

      expect(initializer.isApplied(1)).toBe(false);
      expect(initializer.isApplied(2)).toBe(false);
    });
  });

  // ─── Statistics ───────────────────────────────────────────

  describe('Statistics', () => {
    it('should compute correct stats', () => {
      const stats = initializer.getStats();

      expect(stats.migrations).toBe(10);
      expect(stats.tables).toBeGreaterThanOrEqual(20);
      expect(stats.columns).toBeGreaterThan(100);
      expect(stats.indexes).toBeGreaterThan(40);
      expect(stats.foreignKeys).toBeGreaterThan(10);
      expect(stats.applied).toBe(0);
      expect(stats.pending).toBe(10);
    });

    it('should update stats after applying migrations', () => {
      initializer.markApplied(1);
      initializer.markApplied(2);

      const stats = initializer.getStats();
      expect(stats.applied).toBe(2);
      expect(stats.pending).toBe(8);
    });
  });

  // ─── Validation ───────────────────────────────────────────

  describe('Validation', () => {
    it('should validate the built-in schema', () => {
      const result = initializer.validate();
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should have no duplicate table names', () => {
      const names = initializer.getAllTableNames();
      const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
      expect(duplicates.length).toBe(0);
    });

    it('should have no duplicate index names', () => {
      const indexNames: string[] = [];
      for (const migration of ALL_MIGRATIONS) {
        for (const table of migration.tables) {
          if (table.indexes) {
            for (const idx of table.indexes) {
              indexNames.push(idx.name);
            }
          }
        }
      }
      const duplicates = indexNames.filter((n, i) => indexNames.indexOf(n) !== i);
      expect(duplicates.length).toBe(0);
    });

    it('should have all foreign keys referencing existing tables', () => {
      const allTables = initializer.getAllTableNames();
      for (const migration of ALL_MIGRATIONS) {
        for (const table of migration.tables) {
          if (table.foreignKeys) {
            for (const fk of table.foreignKeys) {
              expect(
                allTables.includes(fk.references.table),
                `FK in ${table.name} references non-existent table ${fk.references.table}`,
              ).toBe(true);
            }
          }
        }
      }
    });

    it('should have all index columns existing in their table', () => {
      for (const migration of ALL_MIGRATIONS) {
        for (const table of migration.tables) {
          if (table.indexes) {
            const colNames = table.columns.map(c => c.name);
            for (const idx of table.indexes) {
              for (const col of idx.columns) {
                expect(
                  colNames.includes(col),
                  `Index ${idx.name} references non-existent column ${col} in ${table.name}`,
                ).toBe(true);
              }
            }
          }
        }
      }
    });
  });

  // ─── Voice Summary ────────────────────────────────────────

  describe('Voice Summary', () => {
    it('should generate a voice summary', () => {
      const summary = initializer.getVoiceSummary();
      expect(summary).toContain('tables');
      expect(summary).toContain('columns');
      expect(summary).toContain('indexes');
      expect(summary).toContain('migrations');
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle UNIQUE columns without being primary key', () => {
      const table: TableDefinition = {
        name: 'unique_test',
        columns: [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'email', type: 'TEXT', unique: true },
        ],
      };

      const sql = generateCreateTableSQL(table);
      expect(sql).toContain('email TEXT UNIQUE');
    });

    it('should handle AUTOINCREMENT columns', () => {
      const table: TableDefinition = {
        name: 'auto_test',
        columns: [
          { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
          { name: 'name', type: 'TEXT' },
        ],
      };

      const sql = generateCreateTableSQL(table);
      expect(sql).toContain('AUTOINCREMENT');
    });

    it('should handle multiple foreign keys on same table', () => {
      const table: TableDefinition = {
        name: 'multi_fk',
        columns: [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'user_id', type: 'TEXT' },
          { name: 'team_id', type: 'TEXT' },
        ],
        foreignKeys: [
          { columns: ['user_id'], references: { table: 'users', columns: ['id'] } },
          { columns: ['team_id'], references: { table: 'teams', columns: ['id'] }, onDelete: 'SET NULL' },
        ],
      };

      const sql = generateCreateTableSQL(table);
      expect(sql).toContain('REFERENCES users(id)');
      expect(sql).toContain('REFERENCES teams(id) ON DELETE SET NULL');
    });

    it('should get specific migration by version', () => {
      const m = initializer.getMigration(5);
      expect(m).toBeDefined();
      expect(m!.category).toBe('billing');
    });

    it('should return undefined for non-existent migration version', () => {
      expect(initializer.getMigration(999)).toBeUndefined();
    });
  });
});
