/**
 * Voice Command Router — Parses voice input and routes to the correct handler.
 *
 * Smart glasses are voice-first UX. This router:
 * 1. Takes raw transcribed text from STT
 * 2. Classifies the intent
 * 3. Extracts parameters
 * 4. Returns a structured VoiceCommand
 *
 * Uses pattern matching + fuzzy matching (no ML needed for MVP).
 * Can be upgraded to LLM-based classification later.
 */

import type { VoiceCommand, VoiceIntent } from '../types.js';

// ─── Command Patterns ───────────────────────────────────────────

interface CommandPattern {
  intent: VoiceIntent;
  patterns: RegExp[];
  /** Extract named params from the matched text */
  paramExtractor?: (text: string, match: RegExpMatchArray) => Record<string, string>;
}

const COMMAND_PATTERNS: CommandPattern[] = [
  // ── Inventory Commands ──────────────────────────────────
  {
    intent: 'inventory_start',
    patterns: [
      /\b(?:start|begin|open)\s+(?:the\s+)?inventory\b/i,
      /\binventory\s+(?:start|begin|on)\b/i,
      /\blet'?s?\s+(?:start|begin)\s+(?:the\s+)?(?:count(?:ing)?|inventory)\b/i,
      /\bstart\s+(?:the\s+)?count(?:ing)?\b/i,
    ],
  },
  {
    intent: 'inventory_stop',
    patterns: [
      /\b(?:stop|end|finish|complete)\s+(?:the\s+)?inventory\b/i,
      /\binventory\s+(?:stop|end|done|complete|off)\b/i,
      /\b(?:we'?re|i'?m)\s+done\s+(?:with\s+)?(?:the\s+)?(?:count|inventory)\b/i,
      /\bstop\s+(?:the\s+)?count(?:ing)?\b/i,
    ],
  },
  {
    intent: 'inventory_pause',
    patterns: [
      /\bpause\s+(?:the\s+)?(?:inventory|counting|count)\b/i,
      /\binventory\s+pause\b/i,
      /\btake\s+a\s+break\b/i,
      /\bhold\s+on\b/i,
    ],
  },
  {
    intent: 'inventory_resume',
    patterns: [
      /\bresume\s+(?:the\s+)?(?:inventory|counting|count)\b/i,
      /\bcontinue\s+(?:the\s+)?(?:inventory|counting|count)\b/i,
      /\binventory\s+resume\b/i,
      /\bkeep\s+going\b/i,
      /\bback\s+to\s+(?:it|work|counting)\b/i,
    ],
  },
  {
    intent: 'inventory_set_aisle',
    patterns: [
      /\b(?:this\s+is\s+)?aisle\s+(\w+)\b/i,
      /\bmoving\s+to\s+aisle\s+(\w+)\b/i,
      /\bnow\s+(?:in|on)\s+aisle\s+(\w+)\b/i,
      /\bset\s+aisle\s+(?:to\s+)?(\w+)\b/i,
    ],
    paramExtractor: (_text, match) => ({ aisle: match[1] }),
  },
  {
    intent: 'inventory_set_section',
    patterns: [
      /\b(?:this\s+(?:is|section)\s+)?(?:the\s+)?(\w[\w\s]*?)\s+section\b/i,
      /\bsection\s+(?:is\s+)?(\w[\w\s]*?)(?:\s+now)?\b/i,
      /\bmoving\s+to\s+(?:the\s+)?(\w[\w\s]*?)\s+(?:section|area)\b/i,
    ],
    paramExtractor: (_text, match) => ({ section: match[1].trim() }),
  },
  {
    intent: 'inventory_set_depth',
    patterns: [
      /\b(?:this\s+)?shelf\s+is\s+(\d+)\s+deep\b/i,
      /\b(\d+)\s+(?:deep|rows?\s+deep)\b/i,
      /\bset\s+depth\s+(?:to\s+)?(\d+)\b/i,
      /\bdepth\s+(?:is\s+)?(\d+)\b/i,
    ],
    paramExtractor: (_text, match) => ({ depth: match[1] }),
  },
  {
    intent: 'inventory_manual_count',
    patterns: [
      /\b(?:that'?s|there'?s|count\s+is|i\s+see)\s+(\d+)\s+(?:of\s+)?(?:the\s+)?(.+)/i,
      /\b(\d+)\s+(?:cases?|units?|boxes?|packs?|bottles?|cans?|bags?|items?)\s+(?:of\s+)?(.+)/i,
      /\bmark\s+(\d+)\s+(?:for\s+)?(.+)/i,
    ],
    paramExtractor: (_text, match) => ({
      count: match[1],
      product: match[2].trim(),
    }),
  },
  {
    intent: 'inventory_skip',
    patterns: [
      /\bskip\s+(?:this|that)\s*(?:aisle|section|shelf)?\b/i,
      /\balready\s+counted\s+(?:this|that|here)\b/i,
      /\bpass\s+(?:on\s+)?(?:this|that)\b/i,
    ],
  },
  {
    intent: 'inventory_annotate',
    patterns: [
      /\bnote(?:\s*:)?\s+(.+)/i,
      /\bannotate(?:\s*:)?\s+(.+)/i,
      /\badd\s+(?:a\s+)?note(?:\s*:)?\s+(.+)/i,
    ],
    paramExtractor: (_text, match) => ({ annotation: match[1].trim() }),
  },

  // ── General Commands ────────────────────────────────────
  {
    intent: 'remember_this',
    patterns: [
      /\bremember\s+this\b/i,
      /\bsave\s+(?:this|that)\b/i,
      /\bkeep\s+(?:this|that)\b/i,
      /\bstore\s+(?:this|that)\b/i,
      /\bdon'?t\s+forget\s+(?:this|that)\b/i,
    ],
  },
  {
    intent: 'take_photo',
    patterns: [
      /\btake\s+(?:a\s+)?(?:photo|picture|pic|snap|snapshot|shot)\b/i,
      /\bsnap\s+(?:this|that|it)\b/i,
      /\bcapture\s+(?:this|that|it)\b/i,
    ],
  },
  {
    intent: 'what_is_this',
    patterns: [
      /\bwhat\s+(?:is|are)\s+(?:this|that|these|those)\b/i,
      /\bwho\s+(?:is|are)\s+(?:this|that|they)\b/i,
      /\bidentify\s+(?:this|that|them)\b/i,
      /\btell\s+me\s+(?:about|what)\s+(?:this|that)\b/i,
      /\bwhat\s+(?:am\s+I|are\s+we)\s+looking\s+at\b/i,
      /\bwho\s+(?:am\s+I|are\s+we)\s+(?:looking|talking)\s+(?:at|to)\b/i,
    ],
  },
  {
    intent: 'price_check',
    patterns: [
      /\bprice\s+check\b/i,
      /\bhow\s+much\s+(?:is|does|for)\s+(?:this|that)\b/i,
      /\bwhat'?s?\s+(?:this|that|it)\s+worth\b/i,
      /\bcheck\s+(?:the\s+)?price\b/i,
    ],
  },
  {
    intent: 'translate',
    patterns: [
      /\btranslate\s+(?:this|that)\b/i,
      /\bwhat\s+does\s+(?:this|that)\s+say\b/i,
      /\bread\s+(?:this|that)\s+(?:to|for)\s+me\b/i,
    ],
  },
  {
    intent: 'debug_this',
    patterns: [
      /\bdebug\s+(?:this|that)\b/i,
      /\bwhat'?s?\s+wrong\s+(?:here|with\s+(?:this|that))\b/i,
      /\bread\s+(?:this|the)\s+(?:code|error|stack\s*trace)\b/i,
      /\bfix\s+(?:this|that)\b/i,
    ],
  },
  {
    intent: 'start_meeting',
    patterns: [
      /\bstart\s+(?:the\s+)?meeting\s*(?:mode)?\b/i,
      /\bmeeting\s+(?:on|start|mode)\b/i,
      /\bbegin\s+(?:the\s+)?meeting\b/i,
    ],
  },
  {
    intent: 'end_meeting',
    patterns: [
      /\bend\s+(?:the\s+)?meeting\b/i,
      /\bmeeting\s+(?:off|end|over|done)\b/i,
      /\bstop\s+(?:the\s+)?meeting\b/i,
    ],
  },
  {
    intent: 'privacy_mode',
    patterns: [
      /\bprivacy\s+(?:mode|on)\b/i,
      /\bpause\s+(?:recording|capture|everything)\b/i,
      /\bgo\s+(?:dark|silent|private)\b/i,
      /\bstop\s+(?:recording|capture|listening)\b/i,
    ],
  },
  {
    intent: 'resume_capture',
    patterns: [
      /\bresume\s+(?:recording|capture)\b/i,
      /\bprivacy\s+off\b/i,
      /\bback\s+online\b/i,
      /\bstart\s+(?:recording|capture)\s+again\b/i,
    ],
  },
  {
    intent: 'delete_recent',
    patterns: [
      /\bdelete\s+(?:the\s+)?last\s+(\w+)\b/i,
      /\berase\s+(?:the\s+)?last\s+(\w+)\b/i,
      /\bforget\s+(?:the\s+)?last\s+(\w+)\b/i,
    ],
    paramExtractor: (_text, match) => ({ timeframe: match[1] }),
  },
  {
    intent: 'status_report',
    patterns: [
      /\bstatus\s*(?:report)?\b/i,
      /\bhow\s+(?:are\s+we|am\s+I)\s+doing\b/i,
      /\bprogress\s*(?:report|update)?\b/i,
      /\bgive\s+me\s+(?:a\s+)?(?:status|update|summary)\b/i,
    ],
  },
];

// ─── Router ─────────────────────────────────────────────────────

export class VoiceCommandRouter {
  private patterns: CommandPattern[];
  private customPatterns: CommandPattern[] = [];

  constructor() {
    this.patterns = [...COMMAND_PATTERNS];
  }

  /**
   * Parse a voice transcription into a structured command.
   */
  parse(rawText: string): VoiceCommand {
    const timestamp = new Date().toISOString();
    const text = rawText.trim();

    if (!text) {
      return {
        rawText: text,
        intent: 'unknown',
        params: {},
        confidence: 0,
        timestamp,
      };
    }

    // Try all patterns (built-in + custom)
    const allPatterns = [...this.customPatterns, ...this.patterns];

    for (const pattern of allPatterns) {
      for (const regex of pattern.patterns) {
        const match = text.match(regex);
        if (match) {
          const params = pattern.paramExtractor
            ? pattern.paramExtractor(text, match)
            : {};

          return {
            rawText: text,
            intent: pattern.intent,
            params,
            confidence: this.calculateConfidence(text, match),
            timestamp,
          };
        }
      }
    }

    // No match found
    return {
      rawText: text,
      intent: 'unknown',
      params: {},
      confidence: 0,
      timestamp,
    };
  }

  /**
   * Register a custom command pattern.
   */
  addCommand(command: CommandPattern): void {
    this.customPatterns.push(command);
  }

  /**
   * Get all registered intents.
   */
  getRegisteredIntents(): VoiceIntent[] {
    const intents = new Set<VoiceIntent>();
    for (const pattern of [...this.patterns, ...this.customPatterns]) {
      intents.add(pattern.intent);
    }
    return Array.from(intents);
  }

  /**
   * Get help text for all commands (for voice prompt: "what can I say?").
   */
  getHelpText(): string {
    const commands = [
      '📦 Inventory: "Start inventory", "Pause", "Resume", "Stop inventory"',
      '📍 Location: "Aisle 3", "This is the cleaning section"',
      '🔢 Counting: "That\'s 24 of the Tide Pods", "Shelf is 3 deep"',
      '📝 Notes: "Note: water damage on ceiling"',
      '⏭️ Navigation: "Skip this aisle", "Already counted"',
      '📸 Capture: "Remember this", "Take a photo"',
      '❓ Identify: "What is this?", "Price check"',
      '🔒 Privacy: "Privacy mode", "Resume capture"',
      '📊 Status: "Status report", "How are we doing?"',
    ];
    return commands.join('\n');
  }

  // ─── Private ──────────────────────────────────────────────

  /**
   * Calculate confidence based on how much of the input was matched.
   */
  private calculateConfidence(text: string, match: RegExpMatchArray): number {
    const matchLength = match[0].length;
    const textLength = text.length;

    // Ratio of matched text to total text
    const ratio = matchLength / textLength;

    // Higher confidence when more of the text is the command
    if (ratio > 0.8) return 0.95;
    if (ratio > 0.5) return 0.85;
    if (ratio > 0.3) return 0.75;
    return 0.65;
  }
}

/**
 * Convenience: create a router and parse in one call.
 */
export function parseVoiceCommand(text: string): VoiceCommand {
  const router = new VoiceCommandRouter();
  return router.parse(text);
}
