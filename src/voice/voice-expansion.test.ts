/**
 * Tests for Voice Command Expansion
 *
 * 🌙 Night Shift Agent — Night #28
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  VoiceExpansion,
  EXPANDED_INTENTS,
} from './voice-expansion.js';
import type { VoiceCategory } from './voice-expansion.js';

// ─── Tests ──────────────────────────────────────────────────────

describe('VoiceExpansion', () => {
  let voice: VoiceExpansion;

  beforeEach(() => {
    voice = new VoiceExpansion();
  });

  // ── Initialization ────────────────────────────────────────

  describe('Initialization', () => {
    it('loads all expanded intents', () => {
      expect(voice.getIntentCount()).toBeGreaterThanOrEqual(35);
    });

    it('covers all expected categories', () => {
      const expectedCategories: VoiceCategory[] = [
        'inventory', 'meeting', 'inspection', 'security',
        'networking', 'deals', 'translation', 'debug',
        'memory', 'navigation', 'system', 'help',
      ];

      expect(voice.getCategoryCount()).toBeGreaterThanOrEqual(expectedCategories.length);
    });

    it('has default aliases', () => {
      const aliases = voice.getAliases();
      expect(aliases.size).toBeGreaterThanOrEqual(5);
      expect(aliases.get('inv')).toBe('start inventory');
      expect(aliases.get('done')).toBe('stop inventory');
    });
  });

  // ── Inventory Commands ────────────────────────────────────

  describe('Inventory Commands', () => {
    it('matches "export to CSV"', () => {
      const result = voice.match('export to CSV');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inventory_export_csv');
    });

    it('matches "download the report"', () => {
      const result = voice.match('download the report');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inventory_export_csv');
    });

    it('matches "how many items so far?"', () => {
      const result = voice.match('how many items so far?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inventory_summary');
    });

    it('matches "what\'s the count"', () => {
      const result = voice.match("what's the count");
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inventory_summary');
    });

    it('matches "flag this"', () => {
      const result = voice.match('flag this');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inventory_flag_item');
    });

    it('matches "needs recount"', () => {
      const result = voice.match('needs recount');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inventory_flag_item');
    });

    it('matches "new store"', () => {
      const result = voice.match('new store');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inventory_change_store');
    });
  });

  // ── Meeting Commands ──────────────────────────────────────

  describe('Meeting Commands', () => {
    it('matches "start meeting"', () => {
      const result = voice.match('start meeting');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('meeting_start');
    });

    it('matches "record this meeting"', () => {
      const result = voice.match('record this meeting');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('meeting_start');
    });

    it('matches "end meeting"', () => {
      const result = voice.match('end meeting');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('meeting_end');
    });

    it('matches "meeting over"', () => {
      const result = voice.match('meeting over');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('meeting_end');
    });

    it('matches "action item: John to review docs"', () => {
      const result = voice.match('action item: John to review docs');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('meeting_action_item');
      expect(result!.params.item).toBe('John to review docs');
    });

    it('matches "decision: we\'re going with React"', () => {
      const result = voice.match("decision: we're going with React");
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('meeting_decision');
      expect(result!.params.decision).toContain('React');
    });

    it('matches "meeting summary"', () => {
      const result = voice.match('meeting summary');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('meeting_summary');
    });

    it('matches "what have we discussed?"', () => {
      const result = voice.match('what have we discussed?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('meeting_summary');
    });
  });

  // ── Inspection Commands ───────────────────────────────────

  describe('Inspection Commands', () => {
    it('matches "start inspection"', () => {
      const result = voice.match('start inspection');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inspection_start');
    });

    it('matches "begin walkthrough"', () => {
      const result = voice.match('begin walkthrough');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inspection_start');
    });

    it('matches "next room"', () => {
      const result = voice.match('next room');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inspection_next_room');
    });

    it('matches "moving to kitchen"', () => {
      const result = voice.match('moving to kitchen');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inspection_next_room');
      expect(result!.params.room).toBe('kitchen');
    });

    it('matches "end inspection"', () => {
      const result = voice.match('end inspection');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inspection_end');
    });

    it('matches "generate report"', () => {
      const result = voice.match('generate the report');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('inspection_end');
    });
  });

  // ── Security Commands ─────────────────────────────────────

  describe('Security Commands', () => {
    it('matches "is this QR code safe?"', () => {
      const result = voice.match('is this QR code safe?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('security_scan_qr');
    });

    it('matches "scan this QR"', () => {
      const result = voice.match('scan this QR');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('security_scan_qr');
    });

    it('matches "check this contract"', () => {
      const result = voice.match('check this contract');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('security_check_document');
    });

    it('matches "any red flags?"', () => {
      const result = voice.match('any red flags?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('security_check_document');
    });

    it('matches "any threats today?"', () => {
      const result = voice.match('any threats today?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('security_alert_history');
    });

    it('matches "security report"', () => {
      const result = voice.match('security report');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('security_alert_history');
    });
  });

  // ── Networking Commands ───────────────────────────────────

  describe('Networking Commands', () => {
    it('matches "who is this?"', () => {
      const result = voice.match('who is this?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('networking_scan_badge');
    });

    it('matches "scan their badge"', () => {
      const result = voice.match('scan their badge');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('networking_scan_badge');
    });

    it('matches "who have I met?"', () => {
      const result = voice.match('who have I met?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('networking_list_contacts');
    });

    it('matches "draft follow-up"', () => {
      const result = voice.match('draft follow-up');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('networking_draft_followup');
    });
  });

  // ── Deal Commands ─────────────────────────────────────────

  describe('Deal Commands', () => {
    it('matches "price check"', () => {
      const result = voice.match('price check');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('deals_price_check');
    });

    it('matches "is this a good deal?"', () => {
      const result = voice.match('is this a good deal?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('deals_price_check');
    });

    it('matches "how much is this?"', () => {
      const result = voice.match('how much is this?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('deals_price_check');
    });

    it('matches "negotiation tips"', () => {
      const result = voice.match('negotiation tips');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('deals_negotiate');
    });

    it('matches "give me leverage"', () => {
      const result = voice.match('give me negotiation leverage');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('deals_negotiate');
    });

    it('matches "deals today"', () => {
      const result = voice.match('deals today');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('deals_history');
    });
  });

  // ── Translation Commands ──────────────────────────────────

  describe('Translation Commands', () => {
    it('matches "translate this"', () => {
      const result = voice.match('translate this');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('translation_read');
    });

    it('matches "what does that say?"', () => {
      const result = voice.match('what does that say?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('translation_read');
    });

    it('matches "cultural tips"', () => {
      const result = voice.match('cultural tips');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('translation_cultural_brief');
    });
  });

  // ── Debug Commands ────────────────────────────────────────

  describe('Debug Commands', () => {
    it('matches "debug this"', () => {
      const result = voice.match('debug this');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('debug_analyze');
    });

    it('matches "what\'s wrong with this code?"', () => {
      const result = voice.match("what's wrong with this code?");
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('debug_analyze');
    });

    it('matches "fix this error"', () => {
      const result = voice.match('fix this error');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('debug_analyze');
    });

    it('matches "explain this code"', () => {
      const result = voice.match('explain this code');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('debug_explain');
    });
  });

  // ── Memory Commands ───────────────────────────────────────

  describe('Memory Commands', () => {
    it('matches "remember this"', () => {
      const result = voice.match('remember this');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('memory_remember');
    });

    it('matches "save this to memory"', () => {
      const result = voice.match('save this to memory');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('memory_remember');
    });

    it('matches "what was on that whiteboard?"', () => {
      const result = voice.match('what was on that whiteboard?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('memory_search');
      expect(result!.params.query).toContain('whiteboard');
    });

    it('matches "find the business card"', () => {
      const result = voice.match('find the business card');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('memory_search');
      expect(result!.params.query).toContain('business card');
    });

    it('matches "delete that"', () => {
      const result = voice.match('delete that');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('memory_delete_recent');
    });
  });

  // ── System Commands ───────────────────────────────────────

  describe('System Commands', () => {
    it('matches "status"', () => {
      const result = voice.match('status');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('system_status');
    });

    it('matches "privacy mode"', () => {
      const result = voice.match('privacy mode');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('system_privacy_on');
    });

    it('matches "stop capturing"', () => {
      const result = voice.match('stop capturing');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('system_privacy_on');
    });

    it('matches "resume capturing"', () => {
      const result = voice.match('resume capturing');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('system_privacy_off');
    });
  });

  // ── Help Commands ─────────────────────────────────────────

  describe('Help Commands', () => {
    it('matches "help"', () => {
      const result = voice.match('help');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('help_general');
    });

    it('matches "what can I say?"', () => {
      const result = voice.match('what can I say?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('help_general');
    });

    it('matches "help with inventory"', () => {
      const result = voice.match('help with inventory');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('help_category');
      expect(result!.params.category).toBe('inventory');
    });

    it('matches "meeting commands"', () => {
      const result = voice.match('meeting commands');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('help_category');
      expect(result!.params.category).toBe('meeting');
    });
  });

  // ── Context & Navigation ──────────────────────────────────

  describe('Context Commands', () => {
    it('matches "what is this?"', () => {
      const result = voice.match('what is this?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('context_what_am_i_looking_at');
    });

    it('matches "what am I looking at?"', () => {
      const result = voice.match('what am I looking at?');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('context_what_am_i_looking_at');
    });

    it('matches "convert 350 degrees"', () => {
      const result = voice.match('convert 350 degrees');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('context_convert');
      expect(result!.params.value).toContain('350');
    });
  });

  // ── Aliases ───────────────────────────────────────────────

  describe('Aliases', () => {
    it('resolves "inv" alias', () => {
      // "inv" maps to "start inventory" — verify alias resolves
      const aliases = voice.getAliases();
      expect(aliases.get('inv')).toBe('start inventory');
    });

    it('resolves "meeting" alias to start meeting', () => {
      const result = voice.match('meeting');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('meeting_start');
    });

    it('adds custom aliases', () => {
      voice.addAlias('scan', 'price check');
      const result = voice.match('scan');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('deals_price_check');
    });

    it('removes aliases', () => {
      voice.addAlias('test', 'help');
      expect(voice.removeAlias('test')).toBe(true);
      expect(voice.removeAlias('test')).toBe(false);
    });

    it('lists all aliases', () => {
      const aliases = voice.getAliases();
      expect(aliases.size).toBeGreaterThanOrEqual(5);
    });
  });

  // ── Macros ────────────────────────────────────────────────

  describe('Macros', () => {
    it('records a macro', () => {
      const macro = voice.recordMacro('morning', 'good morning', [
        'start inventory',
        'aisle 1',
      ]);

      expect(macro.name).toBe('morning');
      expect(macro.commands).toHaveLength(2);
    });

    it('gets a macro by name', () => {
      voice.recordMacro('test', 'run test', ['help']);
      expect(voice.getMacro('test')).toBeDefined();
    });

    it('lists all macros', () => {
      voice.recordMacro('a', 'trigger a', ['help']);
      voice.recordMacro('b', 'trigger b', ['status']);

      expect(voice.listMacros()).toHaveLength(2);
    });

    it('deletes a macro', () => {
      voice.recordMacro('temp', 'temp trigger', ['help']);
      expect(voice.deleteMacro('temp')).toBe(true);
      expect(voice.getMacro('temp')).toBeUndefined();
    });

    it('expands macros by trigger phrase', () => {
      voice.recordMacro('morning', 'good morning', ['start inventory', 'aisle 1']);

      const expanded = voice.expandMacro('good morning');

      expect(expanded).toEqual(['start inventory', 'aisle 1']);
    });

    it('returns null for unknown macro trigger', () => {
      expect(voice.expandMacro('unknown trigger')).toBeNull();
    });
  });

  // ── History ───────────────────────────────────────────────

  describe('History', () => {
    it('tracks command history', () => {
      voice.match('price check');
      voice.match('help');

      const history = voice.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].intentId).toBe('deals_price_check');
      expect(history[1].intentId).toBe('help_general');
    });

    it('gets last command', () => {
      voice.match('start meeting');
      voice.match('end meeting');

      const last = voice.getLastCommand();
      expect(last?.intentId).toBe('meeting_end');
    });

    it('respects history limit', () => {
      const smallHistory = new VoiceExpansion(undefined, 3);

      smallHistory.match('help');
      smallHistory.match('status');
      smallHistory.match('price check');
      smallHistory.match('translate this');
      smallHistory.match('debug this');

      expect(smallHistory.getHistory().length).toBeLessThanOrEqual(3);
    });

    it('clears history', () => {
      voice.match('help');
      voice.match('status');
      voice.clearHistory();

      expect(voice.getHistory()).toHaveLength(0);
    });

    it('only records successful matches', () => {
      voice.match('ajklsdjfklasjdf'); // gibberish, should not match
      expect(voice.getHistory()).toHaveLength(0);
    });
  });

  // ── Help System ───────────────────────────────────────────

  describe('Help System', () => {
    it('generates help for all categories', () => {
      const help = voice.generateHelp();
      expect(help.length).toBeGreaterThanOrEqual(10);

      for (const section of help) {
        expect(section.title).toBeTruthy();
        expect(section.commands.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('generates help for a specific category', () => {
      const help = voice.generateHelp('inventory');
      expect(help).toHaveLength(1);
      expect(help[0].category).toBe('inventory');
      expect(help[0].commands.length).toBeGreaterThanOrEqual(2);
    });

    it('generates voice-friendly help text', () => {
      const text = voice.generateVoiceHelp();
      expect(text).toContain('categories');
      expect(text.length).toBeGreaterThan(20);
    });

    it('generates voice help for specific category', () => {
      const text = voice.generateVoiceHelp('inventory');
      expect(text).toContain('Inventory');
    });
  });

  // ── matchAll ──────────────────────────────────────────────

  describe('matchAll', () => {
    it('returns all matching intents sorted by confidence', () => {
      const results = voice.matchAll('help');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].intent.id).toBe('help_general');
    });

    it('returns empty array for no match', () => {
      const results = voice.matchAll('xyzzy plugh');
      expect(results).toHaveLength(0);
    });
  });

  // ── Stats ─────────────────────────────────────────────────

  describe('Stats', () => {
    it('returns correct stats', () => {
      voice.match('help');
      voice.recordMacro('test', 'run', ['help']);
      voice.addAlias('h', 'help');

      const stats = voice.getStats();

      expect(stats.intents).toBeGreaterThanOrEqual(35);
      expect(stats.categories).toBeGreaterThanOrEqual(10);
      expect(stats.history).toBe(1);
      expect(stats.macros).toBe(1);
      expect(stats.aliases).toBeGreaterThanOrEqual(6); // 5 default + 1 custom
    });
  });

  // ── Edge Cases ────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('handles empty string', () => {
      const result = voice.match('');
      // May or may not match something, should not crash
      expect(() => voice.match('')).not.toThrow();
    });

    it('handles very long input', () => {
      const long = 'help me with inventory because I need to count the items on the shelf in aisle 3 of the store right now please';
      const result = voice.match(long);
      // Should match something
      expect(result).not.toBeNull();
    });

    it('handles special characters', () => {
      expect(() => voice.match('what\'s the count?')).not.toThrow();
      expect(() => voice.match("what's this! #@$%")).not.toThrow();
    });

    it('case insensitive matching', () => {
      const lower = voice.match('help');
      const upper = voice.match('HELP');
      const mixed = voice.match('HeLp');

      expect(lower?.intent.id).toBe('help_general');
      expect(upper?.intent.id).toBe('help_general');
      expect(mixed?.intent.id).toBe('help_general');
    });

    it('custom intents via constructor', () => {
      const custom = new VoiceExpansion([
        {
          id: 'custom_test',
          description: 'Custom test intent',
          agent: 'test',
          examples: ['test command'],
          patterns: [/\btest\s+command\b/i],
          category: 'system',
        },
      ]);

      const result = custom.match('test command');
      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe('custom_test');
    });
  });
});
