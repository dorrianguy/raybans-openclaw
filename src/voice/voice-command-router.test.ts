/**
 * Tests for VoiceCommandRouter — voice command parsing and intent classification.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceCommandRouter, parseVoiceCommand } from './voice-command-router.js';

describe('VoiceCommandRouter', () => {
  let router: VoiceCommandRouter;

  beforeEach(() => {
    router = new VoiceCommandRouter();
  });

  // ── Inventory Commands ─────────────────────────────────────

  describe('Inventory Start', () => {
    const phrases = [
      'Start inventory',
      'begin the inventory',
      'inventory start',
      "let's start the count",
      "let's begin counting",
      'start counting',
    ];

    for (const phrase of phrases) {
      it(`should parse: "${phrase}"`, () => {
        const cmd = router.parse(phrase);
        expect(cmd.intent).toBe('inventory_start');
        expect(cmd.confidence).toBeGreaterThan(0.5);
      });
    }
  });

  describe('Inventory Stop', () => {
    const phrases = [
      'Stop inventory',
      'end the inventory',
      'inventory done',
      "we're done with the count",
      'finish inventory',
      'stop counting',
    ];

    for (const phrase of phrases) {
      it(`should parse: "${phrase}"`, () => {
        const cmd = router.parse(phrase);
        expect(cmd.intent).toBe('inventory_stop');
      });
    }
  });

  describe('Inventory Pause/Resume', () => {
    it('should parse pause commands', () => {
      expect(router.parse('pause the inventory').intent).toBe('inventory_pause');
      expect(router.parse('take a break').intent).toBe('inventory_pause');
      expect(router.parse('hold on').intent).toBe('inventory_pause');
    });

    it('should parse resume commands', () => {
      expect(router.parse('resume the inventory').intent).toBe('inventory_resume');
      expect(router.parse('continue counting').intent).toBe('inventory_resume');
      expect(router.parse('keep going').intent).toBe('inventory_resume');
      expect(router.parse('back to it').intent).toBe('inventory_resume');
    });
  });

  describe('Aisle Setting', () => {
    it('should extract aisle number', () => {
      const cmd = router.parse('Aisle 3');
      expect(cmd.intent).toBe('inventory_set_aisle');
      expect(cmd.params.aisle).toBe('3');
    });

    it('should handle "this is aisle X"', () => {
      const cmd = router.parse('This is aisle 5');
      expect(cmd.intent).toBe('inventory_set_aisle');
      expect(cmd.params.aisle).toBe('5');
    });

    it('should handle "moving to aisle X"', () => {
      const cmd = router.parse('Moving to aisle 12');
      expect(cmd.intent).toBe('inventory_set_aisle');
      expect(cmd.params.aisle).toBe('12');
    });

    it('should handle letter aisles', () => {
      const cmd = router.parse('Now in aisle B');
      expect(cmd.intent).toBe('inventory_set_aisle');
      expect(cmd.params.aisle).toBe('B');
    });
  });

  describe('Section Setting', () => {
    it('should extract section name', () => {
      const cmd = router.parse('This is the cleaning section');
      expect(cmd.intent).toBe('inventory_set_section');
      expect(cmd.params.section).toBeTruthy();
    });

    it('should handle "moving to X section"', () => {
      const cmd = router.parse('Moving to the frozen foods section');
      expect(cmd.intent).toBe('inventory_set_section');
    });
  });

  describe('Depth Setting', () => {
    it('should extract depth number', () => {
      const cmd = router.parse('This shelf is 3 deep');
      expect(cmd.intent).toBe('inventory_set_depth');
      expect(cmd.params.depth).toBe('3');
    });

    it('should handle "set depth to X"', () => {
      const cmd = router.parse('Set depth to 4');
      expect(cmd.intent).toBe('inventory_set_depth');
      expect(cmd.params.depth).toBe('4');
    });

    it('should handle "X rows deep"', () => {
      const cmd = router.parse('2 rows deep');
      expect(cmd.intent).toBe('inventory_set_depth');
      expect(cmd.params.depth).toBe('2');
    });
  });

  describe('Manual Count', () => {
    it('should extract count and product', () => {
      const cmd = router.parse("That's 24 of the Tide Pods");
      expect(cmd.intent).toBe('inventory_manual_count');
      expect(cmd.params.count).toBe('24');
      expect(cmd.params.product).toContain('Tide Pods');
    });

    it('should handle "X cases of Y"', () => {
      const cmd = router.parse('12 cases of Coca-Cola');
      expect(cmd.intent).toBe('inventory_manual_count');
      expect(cmd.params.count).toBe('12');
      expect(cmd.params.product).toContain('Coca-Cola');
    });

    it('should handle "X units of Y"', () => {
      const cmd = router.parse('6 units of DeWalt Drill');
      expect(cmd.intent).toBe('inventory_manual_count');
      expect(cmd.params.count).toBe('6');
    });

    it('should handle "I see X Y"', () => {
      const cmd = router.parse('I see 15 bags of cement');
      expect(cmd.intent).toBe('inventory_manual_count');
      expect(cmd.params.count).toBe('15');
    });
  });

  describe('Skip', () => {
    it('should parse skip commands', () => {
      expect(router.parse('skip this aisle').intent).toBe('inventory_skip');
      expect(router.parse('already counted this').intent).toBe('inventory_skip');
      expect(router.parse('pass on this').intent).toBe('inventory_skip');
    });
  });

  describe('Annotations', () => {
    it('should extract annotation text', () => {
      const cmd = router.parse('Note: water damage on ceiling near window');
      expect(cmd.intent).toBe('inventory_annotate');
      expect(cmd.params.annotation).toBe('water damage on ceiling near window');
    });

    it('should handle "add a note"', () => {
      const cmd = router.parse('Add a note: shelf needs repair');
      expect(cmd.intent).toBe('inventory_annotate');
      expect(cmd.params.annotation).toBe('shelf needs repair');
    });
  });

  // ── General Commands ───────────────────────────────────────

  describe('General Commands', () => {
    it('should parse "remember this"', () => {
      expect(router.parse('Remember this').intent).toBe('remember_this');
      expect(router.parse('Save this').intent).toBe('remember_this');
      expect(router.parse("Don't forget this").intent).toBe('remember_this');
    });

    it('should parse "take a photo"', () => {
      expect(router.parse('Take a photo').intent).toBe('take_photo');
      expect(router.parse('Snap this').intent).toBe('take_photo');
      expect(router.parse('Capture it').intent).toBe('take_photo');
    });

    it('should parse "what is this"', () => {
      expect(router.parse('What is this?').intent).toBe('what_is_this');
      expect(router.parse('What are these?').intent).toBe('what_is_this');
      expect(router.parse('Identify this').intent).toBe('what_is_this');
    });

    it('should parse "price check"', () => {
      expect(router.parse('Price check').intent).toBe('price_check');
      expect(router.parse('How much is this?').intent).toBe('price_check');
      expect(router.parse("What's this worth?").intent).toBe('price_check');
    });

    it('should parse "translate"', () => {
      expect(router.parse('Translate this').intent).toBe('translate');
      expect(router.parse('What does this say?').intent).toBe('translate');
    });

    it('should parse "debug this"', () => {
      expect(router.parse('Debug this').intent).toBe('debug_this');
      expect(router.parse("What's wrong here?").intent).toBe('debug_this');
      expect(router.parse('Read this code').intent).toBe('debug_this');
    });

    it('should parse meeting commands', () => {
      expect(router.parse('Start meeting').intent).toBe('start_meeting');
      expect(router.parse('Meeting on').intent).toBe('start_meeting');
      expect(router.parse('End meeting').intent).toBe('end_meeting');
      expect(router.parse('Meeting done').intent).toBe('end_meeting');
    });

    it('should parse privacy commands', () => {
      expect(router.parse('Privacy mode').intent).toBe('privacy_mode');
      expect(router.parse('Go dark').intent).toBe('privacy_mode');
      expect(router.parse('Stop recording').intent).toBe('privacy_mode');
      expect(router.parse('Resume recording').intent).toBe('resume_capture');
      expect(router.parse('Back online').intent).toBe('resume_capture');
    });

    it('should parse delete commands with timeframe', () => {
      const cmd = router.parse('Delete the last hour');
      expect(cmd.intent).toBe('delete_recent');
      expect(cmd.params.timeframe).toBe('hour');
    });

    it('should parse status commands', () => {
      expect(router.parse('Status report').intent).toBe('status_report');
      expect(router.parse('How are we doing?').intent).toBe('status_report');
      expect(router.parse('Give me a summary').intent).toBe('status_report');
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should return unknown for empty input', () => {
      const cmd = router.parse('');
      expect(cmd.intent).toBe('unknown');
      expect(cmd.confidence).toBe(0);
    });

    it('should return unknown for gibberish', () => {
      const cmd = router.parse('asdfqwer zzzzz');
      expect(cmd.intent).toBe('unknown');
    });

    it('should handle mixed case', () => {
      expect(router.parse('START INVENTORY').intent).toBe('inventory_start');
      expect(router.parse('pRiCe ChEcK').intent).toBe('price_check');
    });

    it('should have timestamp on every command', () => {
      const cmd = router.parse('anything');
      expect(cmd.timestamp).toBeTruthy();
      // Should be valid ISO date
      expect(() => new Date(cmd.timestamp)).not.toThrow();
    });

    it('should preserve raw text', () => {
      const text = '  Start the inventory please  ';
      const cmd = router.parse(text);
      expect(cmd.rawText).toBe(text.trim());
    });
  });

  // ── Custom Commands ────────────────────────────────────────

  describe('Custom Commands', () => {
    it('should register and match custom commands', () => {
      router.addCommand({
        intent: 'price_check', // reuse an existing intent
        patterns: [/\bcheck\s+barcode\b/i],
      });

      const cmd = router.parse('check barcode');
      expect(cmd.intent).toBe('price_check');
    });

    it('should prioritize custom commands over built-in', () => {
      // Custom patterns are checked first
      router.addCommand({
        intent: 'inventory_start',
        patterns: [/\bgo\s+time\b/i],
      });

      const cmd = router.parse('go time');
      expect(cmd.intent).toBe('inventory_start');
    });
  });

  // ── Utility ────────────────────────────────────────────────

  describe('Utility Functions', () => {
    it('should list registered intents', () => {
      const intents = router.getRegisteredIntents();
      expect(intents).toContain('inventory_start');
      expect(intents).toContain('inventory_stop');
      expect(intents).toContain('remember_this');
      expect(intents).toContain('status_report');
      expect(intents.length).toBeGreaterThan(15);
    });

    it('should generate help text', () => {
      const help = router.getHelpText();
      expect(help).toContain('Inventory');
      expect(help).toContain('Location');
      expect(help).toContain('Privacy');
    });

    it('parseVoiceCommand convenience function works', () => {
      const cmd = parseVoiceCommand('Start inventory');
      expect(cmd.intent).toBe('inventory_start');
    });
  });
});
