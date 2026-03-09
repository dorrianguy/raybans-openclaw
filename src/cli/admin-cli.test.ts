/**
 * Tests for Admin CLI
 * 🌙 Night Shift Agent — 2026-03-09
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AdminCli,
  ParsedCommand,
  CommandResult,
  CommandHandler,
} from './admin-cli.js';

function createCli(config = {}): AdminCli {
  return new AdminCli({ version: '1.0.0-test', ...config });
}

describe('AdminCli', () => {
  let cli: AdminCli;

  beforeEach(() => {
    cli = createCli();
  });

  // ─── Command Parsing ────────────────────────────────────────────

  describe('Command Parsing', () => {
    it('parses a simple command', () => {
      const cmd = cli.parseCommand('config get server.port');
      expect(cmd.category).toBe('config');
      expect(cmd.action).toBe('get');
      expect(cmd.args).toEqual(['server.port']);
    });

    it('parses command with options', () => {
      const cmd = cli.parseCommand('migrate up --dry-run');
      expect(cmd.category).toBe('migrate');
      expect(cmd.action).toBe('up');
      expect(cmd.options['dry-run']).toBe(true);
    });

    it('parses key=value options', () => {
      const cmd = cli.parseCommand('migrate down --steps=3');
      expect(cmd.options['steps']).toBe('3');
    });

    it('parses --format as output format', () => {
      const cmd = cli.parseCommand('config list --format=json');
      expect(cmd.format).toBe('json');
    });

    it('parses quoted arguments', () => {
      const cmd = cli.parseCommand('config set name "John Doe"');
      expect(cmd.args).toEqual(['name', 'John Doe']);
    });

    it('parses single-quoted arguments', () => {
      const cmd = cli.parseCommand("config set greeting 'hello world'");
      expect(cmd.args).toEqual(['greeting', 'hello world']);
    });

    it('handles empty input', () => {
      const cmd = cli.parseCommand('');
      expect(cmd.category).toBe('help');
    });

    it('handles command with no action', () => {
      const cmd = cli.parseCommand('config');
      expect(cmd.category).toBe('config');
      expect(cmd.action).toBe('');
    });

    it('preserves raw input', () => {
      const cmd = cli.parseCommand('config set foo bar');
      expect(cmd.raw).toBe('config set foo bar');
    });

    it('resolves aliases', () => {
      const cmd = cli.parseCommand('v');
      expect(cmd.category).toBe('system');
      expect(cmd.action).toBe('version');
    });

    it('resolves status alias', () => {
      const cmd = cli.parseCommand('status');
      expect(cmd.category).toBe('system');
      expect(cmd.action).toBe('status');
    });
  });

  // ─── Command Execution ──────────────────────────────────────────

  describe('Command Execution', () => {
    it('executes a command and returns result', async () => {
      const result = await cli.execute('system version');
      expect(result.success).toBe(true);
      expect(result.message).toContain('1.0.0-test');
    });

    it('returns error for unknown command', async () => {
      const result = await cli.execute('nonexistent something');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown command');
    });

    it('shows category help when no action given', async () => {
      const result = await cli.execute('config');
      expect(result.success).toBe(true);
      expect(result.message).toContain('config');
    });

    it('emits command:execute event', async () => {
      const fn = vi.fn();
      cli.on('command:execute', fn);
      await cli.execute('system version');
      expect(fn).toHaveBeenCalled();
    });

    it('emits command:complete event', async () => {
      const fn = vi.fn();
      cli.on('command:complete', fn);
      await cli.execute('system version');
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'system', action: 'version' }),
        expect.objectContaining({ success: true })
      );
    });

    it('emits command:error on handler exception', async () => {
      const errorHandler: CommandHandler = {
        execute: async () => { throw new Error('Boom!'); },
        getHelp: () => ({ command: 'test', description: 'test', subcommands: [], examples: [] }),
      };
      cli.registerHandler('plugins' as any, errorHandler);
      const fn = vi.fn();
      cli.on('command:error', fn);
      const result = await cli.execute('plugins crash');
      expect(result.success).toBe(false);
      expect(fn).toHaveBeenCalled();
    });
  });

  // ─── Help ────────────────────────────────────────────────────────

  describe('Help', () => {
    it('shows general help', async () => {
      const result = await cli.execute('help');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Available commands');
      expect(result.message).toContain('config');
      expect(result.message).toContain('health');
      expect(result.message).toContain('migrate');
      expect(result.message).toContain('system');
    });

    it('shows help for specific command', async () => {
      const result = await cli.execute('help config');
      expect(result.success).toBe(true);
      expect(result.message).toContain('config');
      expect(result.message).toContain('get');
      expect(result.message).toContain('set');
      expect(result.message).toContain('list');
    });

    it('returns error for unknown help topic', async () => {
      const result = await cli.execute('help nonexistent');
      expect(result.success).toBe(false);
    });

    it('includes voice summary', async () => {
      const result = await cli.execute('help');
      expect(result.voiceSummary).toContain('command categories');
    });

    it('shows aliases in help', async () => {
      const result = await cli.execute('help');
      expect(result.message).toContain('Aliases');
    });

    it('empty input shows help', async () => {
      const result = await cli.execute('');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Available commands');
    });
  });

  // ─── Config Commands ─────────────────────────────────────────────

  describe('Config Commands', () => {
    it('sets and gets a config value', async () => {
      await cli.execute('config set server.port 3847');
      const result = await cli.execute('config get server.port');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ key: 'server.port', value: 3847 });
    });

    it('sets a string value', async () => {
      await cli.execute('config set app.name "Ray-Bans Platform"');
      const result = await cli.execute('config get app.name');
      expect(result.success).toBe(true);
      expect((result.data as any).value).toBe('Ray-Bans Platform');
    });

    it('returns error for missing key on get', async () => {
      const result = await cli.execute('config get nonexistent.key');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('lists all config values', async () => {
      await cli.execute('config set a 1');
      await cli.execute('config set b 2');
      const result = await cli.execute('config list');
      expect(result.success).toBe(true);
      expect(result.table).toBeTruthy();
      expect(result.table!.rows.length).toBe(2);
    });

    it('returns empty list message', async () => {
      const result = await cli.execute('config list');
      expect(result.message).toContain('No configuration values');
    });

    it('shows current environment', async () => {
      const result = await cli.execute('config env');
      expect(result.success).toBe(true);
      expect(result.message).toContain('development');
    });

    it('sets environment', async () => {
      const result = await cli.execute('config env production');
      expect(result.success).toBe(true);
      expect(result.message).toContain('production');
    });

    it('rejects invalid environment', async () => {
      const result = await cli.execute('config env invalid');
      expect(result.success).toBe(false);
    });

    it('validates configuration', async () => {
      const result = await cli.execute('config validate');
      expect(result.success).toBe(true);
      expect(result.message).toContain('valid');
    });

    it('exports configuration', async () => {
      await cli.execute('config set x 42');
      const result = await cli.execute('config export');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ x: 42 });
    });

    it('resets a config key', async () => {
      await cli.execute('config set foo bar');
      const result = await cli.execute('config reset foo');
      expect(result.success).toBe(true);
      const get = await cli.execute('config get foo');
      expect(get.success).toBe(false);
    });

    it('reports unknown subcommand', async () => {
      const result = await cli.execute('config unknown');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown config subcommand');
    });

    it('requires key for get', async () => {
      const result = await cli.execute('config get');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Usage');
    });

    it('requires key and value for set', async () => {
      const result = await cli.execute('config set');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Usage');
    });
  });

  // ─── Health Commands ─────────────────────────────────────────────

  describe('Health Commands', () => {
    it('shows system health status', async () => {
      const result = await cli.execute('health status');
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('overall');
      expect(result.voiceSummary).toBeTruthy();
    });

    it('checks a specific component', async () => {
      const result = await cli.execute('health check persistence');
      expect(result.success).toBe(true);
      expect(result.message).toContain('persistence');
    });

    it('returns error for unknown component', async () => {
      const result = await cli.execute('health check nonexistent');
      expect(result.success).toBe(false);
    });

    it('lists all components', async () => {
      const result = await cli.execute('health list');
      expect(result.success).toBe(true);
      expect(result.table).toBeTruthy();
      expect(result.table!.rows.length).toBeGreaterThan(0);
    });

    it('runs diagnostics', async () => {
      const result = await cli.execute('health diagnostics');
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('nodeVersion');
      expect(result.voiceSummary).toBeTruthy();
    });

    it('allows setting component status', async () => {
      cli.healthHandler.setComponentStatus('custom', 'degraded', 'Test');
      const result = await cli.execute('health check custom');
      expect(result.message).toContain('degraded');
    });
  });

  // ─── Migrate Commands ────────────────────────────────────────────

  describe('Migrate Commands', () => {
    beforeEach(() => {
      cli.migrateHandler.addMigration('001', 'create_users_table', true);
      cli.migrateHandler.addMigration('002', 'add_teams_table', true);
      cli.migrateHandler.addMigration('003', 'add_sessions_table', false);
      cli.migrateHandler.addMigration('004', 'add_inventory_table', false);
    });

    it('shows migration status', async () => {
      const result = await cli.execute('migrate status');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ applied: 2, pending: 2, total: 4 });
      expect(result.table).toBeTruthy();
    });

    it('runs pending migrations', async () => {
      const result = await cli.execute('migrate up');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Applied 2');

      // Check all are now applied
      const status = await cli.execute('migrate status');
      expect((status.data as any).pending).toBe(0);
    });

    it('dry-runs migrations', async () => {
      const result = await cli.execute('migrate up --dry-run');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ dryRun: true, count: 2 });
      expect(result.message).toContain('Would apply');

      // Nothing actually applied
      const status = await cli.execute('migrate status');
      expect((status.data as any).pending).toBe(2);
    });

    it('shows no pending migrations', async () => {
      await cli.execute('migrate up');
      const result = await cli.execute('migrate up');
      expect(result.message).toContain('No pending');
    });

    it('rolls back last migration', async () => {
      await cli.execute('migrate up'); // apply all
      const result = await cli.execute('migrate down');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Rolled back 1');
    });

    it('rolls back N steps', async () => {
      await cli.execute('migrate up');
      const result = await cli.execute('migrate down --steps=2');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Rolled back 2');
    });

    it('dry-runs rollback', async () => {
      await cli.execute('migrate up');
      const result = await cli.execute('migrate down --dry-run');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Would rollback');
    });

    it('shows migration plan', async () => {
      const result = await cli.execute('migrate plan');
      expect(result.success).toBe(true);
      expect(result.message).toContain('add_sessions_table');
    });

    it('verifies migration integrity', async () => {
      const result = await cli.execute('migrate verify');
      expect(result.success).toBe(true);
      expect(result.message).toContain('checksums match');
    });

    it('rejects reset without --confirm', async () => {
      const result = await cli.execute('migrate reset');
      expect(result.success).toBe(false);
      expect(result.message).toContain('DANGER');
    });

    it('resets all migrations with --confirm', async () => {
      await cli.execute('migrate up');
      const result = await cli.execute('migrate reset --confirm');
      expect(result.success).toBe(true);
      expect(result.warnings).toContain('All migrations have been rolled back. Database is in initial state.');
    });
  });

  // ─── System Commands ─────────────────────────────────────────────

  describe('System Commands', () => {
    it('shows version', async () => {
      const result = await cli.execute('system version');
      expect(result.success).toBe(true);
      expect(result.message).toContain('1.0.0-test');
    });

    it('shows system status', async () => {
      const result = await cli.execute('system status');
      expect(result.success).toBe(true);
      expect(result.message).toContain('running');
    });

    it('shows system info', async () => {
      const result = await cli.execute('system info');
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('version');
      expect(result.data).toHaveProperty('nodeVersion');
    });

    it('version alias works', async () => {
      const result = await cli.execute('v');
      expect(result.success).toBe(true);
      expect(result.message).toContain('1.0.0-test');
    });
  });

  // ─── Aliases ─────────────────────────────────────────────────────

  describe('Aliases', () => {
    it('adds a custom alias', async () => {
      cli.addAlias('port', 'config get server.port');
      await cli.execute('config set server.port 8080');
      const result = await cli.execute('port');
      expect(result.success).toBe(true);
    });

    it('removes an alias', () => {
      cli.addAlias('test', 'system version');
      expect(cli.removeAlias('test')).toBe(true);
      expect(cli.removeAlias('test')).toBe(false);
    });

    it('lists aliases', () => {
      const aliases = cli.getAliases();
      expect(aliases.has('v')).toBe(true);
      expect(aliases.get('v')).toBe('system version');
    });
  });

  // ─── History ─────────────────────────────────────────────────────

  describe('History', () => {
    it('records command history', async () => {
      await cli.execute('system version');
      await cli.execute('health status');
      const history = cli.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].command).toBe('system version');
      expect(history[1].command).toBe('health status');
    });

    it('records success/failure', async () => {
      await cli.execute('system version');
      await cli.execute('nonexistent cmd');
      const history = cli.getHistory();
      expect(history[0].success).toBe(true);
      expect(history[1].success).toBe(false);
    });

    it('records duration', async () => {
      await cli.execute('system version');
      const history = cli.getHistory();
      expect(history[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('limits history size', async () => {
      const smallCli = createCli({ maxHistory: 3 });
      for (let i = 0; i < 5; i++) {
        await smallCli.execute('system version');
      }
      expect(smallCli.getHistory().length).toBe(3);
    });

    it('clears history', async () => {
      await cli.execute('system version');
      cli.clearHistory();
      expect(cli.getHistory().length).toBe(0);
    });

    it('gets recent history with limit', async () => {
      await cli.execute('system version');
      await cli.execute('health status');
      await cli.execute('config list');
      const recent = cli.getHistory(2);
      expect(recent.length).toBe(2);
      expect(recent[0].command).toBe('health status');
    });
  });

  // ─── Handler Management ──────────────────────────────────────────

  describe('Handler Management', () => {
    it('registers a custom handler', async () => {
      const customHandler: CommandHandler = {
        execute: async () => ({ success: true, message: 'Custom result' }),
        getHelp: () => ({ command: 'plugins', description: 'Custom plugins', subcommands: [], examples: [] }),
      };
      cli.registerHandler('plugins', customHandler);
      const result = await cli.execute('plugins list');
      expect(result.success).toBe(true);
      expect(result.message).toBe('Custom result');
    });

    it('lists categories', () => {
      const categories = cli.getCategories();
      expect(categories).toContain('config');
      expect(categories).toContain('health');
      expect(categories).toContain('migrate');
      expect(categories).toContain('system');
    });

    it('gets a handler by category', () => {
      expect(cli.getHandler('config')).toBeTruthy();
      expect(cli.getHandler('nonexistent' as any)).toBeUndefined();
    });
  });

  // ─── Output Formatting ───────────────────────────────────────────

  describe('Output Formatting', () => {
    it('formats as text (default)', async () => {
      const result = await cli.execute('system version');
      const output = cli.formatOutput(result);
      expect(output).toContain('1.0.0-test');
    });

    it('formats as JSON', async () => {
      const result = await cli.execute('system version');
      const output = cli.formatOutput(result, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.version).toBe('1.0.0-test');
    });

    it('formats as table', async () => {
      await cli.execute('config set a 1');
      await cli.execute('config set b 2');
      const result = await cli.execute('config list');
      const output = cli.formatOutput(result, 'table');
      expect(output).toContain('Key');
      expect(output).toContain('Value');
      expect(output).toContain('---');
    });

    it('formats as voice', async () => {
      const result = await cli.execute('health status');
      const output = cli.formatOutput(result, 'voice');
      expect(output.length).toBeGreaterThan(0);
      // Voice output should be concise
      expect(output.length).toBeLessThan(200);
    });

    it('falls back to message for table format without table data', async () => {
      const result = await cli.execute('system version');
      const output = cli.formatOutput(result, 'table');
      expect(output).toContain('1.0.0-test');
    });

    it('falls back to message for voice format without voice summary', async () => {
      const result = await cli.execute('config set x 1');
      const output = cli.formatOutput(result, 'voice');
      expect(output.length).toBeGreaterThan(0);
    });
  });
});
