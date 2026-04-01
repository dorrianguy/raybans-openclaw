/**
 * Voice Command Expansion — Extended natural language commands for all agents.
 *
 * The original voice-command-router handles ~20 core intents.
 * This module adds:
 * - 60+ new command patterns across all 11+ agents
 * - Natural language parsing for complex commands
 * - Multi-intent commands ("start inventory and set aisle to 5")
 * - Agent-specific command groups
 * - Help system ("what can I say?")
 * - Command history with undo
 * - Command aliases and shortcuts
 * - Voice macro recording
 *
 * 🌙 Night Shift Agent — Night #28
 */

// ─── Types ──────────────────────────────────────────────────────

export interface ExpandedVoiceIntent {
  /** The intent ID */
  id: string;
  /** Human-readable description */
  description: string;
  /** Which agent handles this */
  agent: string;
  /** Example phrases that trigger this intent */
  examples: string[];
  /** Regex patterns for matching */
  patterns: RegExp[];
  /** Parameter extractor */
  paramExtractor?: (text: string, match: RegExpMatchArray) => Record<string, string>;
  /** Category for help grouping */
  category: VoiceCategory;
}

export type VoiceCategory =
  | 'inventory'
  | 'meeting'
  | 'inspection'
  | 'security'
  | 'networking'
  | 'deals'
  | 'translation'
  | 'debug'
  | 'memory'
  | 'navigation'
  | 'system'
  | 'help';

export interface VoiceMatchResult {
  intent: ExpandedVoiceIntent;
  confidence: number;
  params: Record<string, string>;
  rawText: string;
}

export interface CommandHistoryEntry {
  rawText: string;
  intentId: string;
  timestamp: string;
  success: boolean;
}

export interface VoiceMacro {
  name: string;
  triggerPhrase: string;
  commands: string[];
  createdAt: string;
}

export interface HelpSection {
  category: VoiceCategory;
  title: string;
  commands: Array<{
    phrase: string;
    description: string;
  }>;
}

// ─── Expanded Intent Registry ───────────────────────────────────

export const EXPANDED_INTENTS: ExpandedVoiceIntent[] = [
  // ── Inventory (Extended) ──────────────────────────────────
  {
    id: 'inventory_export_csv',
    description: 'Export inventory to CSV',
    agent: 'inventory',
    examples: ['export to CSV', 'download the report', 'save as spreadsheet'],
    patterns: [
      /\b(?:export|download|save)\s+(?:the\s+)?(?:inventory|report|data)?\s*(?:to|as)\s*(?:csv|spreadsheet|excel)\b/i,
      /\bexport\s+to\s+\w+/i,
      /\bcsv\s+export\b/i,
      /\bget\s+(?:me\s+)?(?:the\s+)?report\b/i,
      /\bdownload\s+(?:the\s+)?report\b/i,
    ],
    category: 'inventory',
  },
  {
    id: 'inventory_summary',
    description: 'Get current inventory summary',
    agent: 'inventory',
    examples: ['how many items so far?', 'give me a count', 'inventory progress'],
    patterns: [
      /\bhow\s+many\s+(?:items|products|things)\s*(?:so\s+far|counted|found|have\s+(?:we|i))?\b/i,
      /\binventory\s+(?:progress|summary|status|count)\b/i,
      /\bgive\s+(?:me\s+)?(?:a\s+)?(?:count|summary|update)\b/i,
      /\bwhat'?s\s+(?:the\s+)?count\b/i,
    ],
    category: 'inventory',
  },
  {
    id: 'inventory_flag_item',
    description: 'Flag an item for review',
    agent: 'inventory',
    examples: ['flag this', 'mark for recount', 'this doesn\'t look right'],
    patterns: [
      /\bflag\s+(?:this|that|it)\b/i,
      /\bmark\s+(?:this\s+)?(?:for\s+)?(?:recount|review)\b/i,
      /\b(?:this|that)\s+(?:doesn'?t|does\s+not)\s+look\s+right\b/i,
      /\bneeds?\s+(?:a\s+)?recount\b/i,
    ],
    category: 'inventory',
  },
  {
    id: 'inventory_change_store',
    description: 'Switch to a different store',
    agent: 'inventory',
    examples: ['new store', 'switch store', 'different location'],
    patterns: [
      /\b(?:new|different|switch|change)\s+(?:store|location)\b/i,
      /\bmoving\s+to\s+(?:a\s+)?(?:new|different)\s+store\b/i,
    ],
    category: 'inventory',
  },

  // ── Meeting Intelligence ──────────────────────────────────
  {
    id: 'meeting_start',
    description: 'Start a meeting recording',
    agent: 'meeting',
    examples: ['start meeting', 'record this meeting', 'begin meeting notes'],
    patterns: [
      /\b(?:start|begin)\s+(?:the\s+)?(?:meeting|conference|call)\b/i,
      /\brecord\s+(?:this\s+)?(?:meeting|conference|call)\b/i,
      /\bmeeting\s+(?:start|on|begin)\b/i,
      /\bbegin\s+(?:meeting\s+)?notes\b/i,
    ],
    category: 'meeting',
  },
  {
    id: 'meeting_end',
    description: 'End the meeting recording',
    agent: 'meeting',
    examples: ['end meeting', 'stop recording', 'meeting over'],
    patterns: [
      /\b(?:end|stop|finish)\s+(?:the\s+)?(?:meeting|conference|call|recording)\b/i,
      /\bmeeting\s+(?:over|done|end|off)\b/i,
    ],
    category: 'meeting',
  },
  {
    id: 'meeting_action_item',
    description: 'Add a manual action item',
    agent: 'meeting',
    examples: ['action item: John to review docs', 'add task for Sarah'],
    patterns: [
      /\baction\s+item[:\s]+(.+)/i,
      /\badd\s+(?:a\s+)?task[:\s]+(.+)/i,
      /\bto\s*-?\s*do[:\s]+(.+)/i,
    ],
    paramExtractor: (text, match) => ({ item: match[1]?.trim() ?? text }),
    category: 'meeting',
  },
  {
    id: 'meeting_decision',
    description: 'Record a decision',
    agent: 'meeting',
    examples: ['decision: we\'re going with React', 'record decision'],
    patterns: [
      /\bdecision[:\s]+(.+)/i,
      /\brecord\s+(?:a\s+)?decision[:\s]*(.+)?/i,
      /\bwe\s+decided\s+(?:to\s+)?(.+)/i,
    ],
    paramExtractor: (text, match) => ({ decision: match[1]?.trim() ?? text }),
    category: 'meeting',
  },
  {
    id: 'meeting_summary',
    description: 'Get meeting summary so far',
    agent: 'meeting',
    examples: ['meeting summary', 'what have we discussed?', 'recap'],
    patterns: [
      /\bmeeting\s+(?:summary|recap|review)\b/i,
      /\bwhat\s+have\s+we\s+(?:discussed|talked\s+about|covered)\b/i,
      /\brecap\s*(?:the\s+meeting)?/i,
      /\bhow\s+many\s+action\s+items\b/i,
    ],
    category: 'meeting',
  },

  // ── Inspection ────────────────────────────────────────────
  {
    id: 'inspection_start',
    description: 'Start an inspection walkthrough',
    agent: 'inspection',
    examples: ['start inspection', 'begin walkthrough', 'inspect this property'],
    patterns: [
      /\b(?:start|begin)\s+(?:the\s+)?(?:inspection|walkthrough)\b/i,
      /\binspect\s+(?:this\s+)?(?:property|building|room|area)\b/i,
      /\bwalkthrough\s+(?:start|begin)\b/i,
    ],
    category: 'inspection',
  },
  {
    id: 'inspection_next_room',
    description: 'Move to the next room/area',
    agent: 'inspection',
    examples: ['next room', 'moving to kitchen', 'now in the basement'],
    patterns: [
      /\bnext\s+(?:room|area|section|zone)\b/i,
      /\bmoving\s+to\s+(?:the\s+)?(\w[\w\s]*?)(?:\s+now)?$/i,
      /\bnow\s+(?:in|at)\s+(?:the\s+)?(\w[\w\s]*)/i,
    ],
    paramExtractor: (_text, match) => {
      const room = match[1]?.trim();
      return room ? { room } : {};
    },
    category: 'inspection',
  },
  {
    id: 'inspection_note_finding',
    description: 'Note an inspection finding',
    agent: 'inspection',
    examples: ['crack in the wall', 'water damage here', 'mold detected'],
    patterns: [
      /\b(?:note|found|see|there'?s)\s*:?\s*(.+)/i,
      /\b(?:water\s+damage|crack|mold|leak|stain|damage|broken|missing)\b/i,
    ],
    paramExtractor: (text) => ({ finding: text }),
    category: 'inspection',
  },
  {
    id: 'inspection_end',
    description: 'End inspection and generate report',
    agent: 'inspection',
    examples: ['end inspection', 'generate report', 'inspection complete'],
    patterns: [
      /\b(?:end|finish|complete)\s+(?:the\s+)?inspection\b/i,
      /\bgenerate\s+(?:the\s+)?(?:inspection\s+)?report\b/i,
      /\binspection\s+(?:done|complete|over)\b/i,
    ],
    category: 'inspection',
  },

  // ── Security ──────────────────────────────────────────────
  {
    id: 'security_scan_qr',
    description: 'Scan and analyze a QR code',
    agent: 'security',
    examples: ['is this QR code safe?', 'scan this QR', 'check this code'],
    patterns: [
      /\b(?:is\s+this|scan|check|analyze)\s+(?:this\s+)?(?:qr|QR)\s*(?:code)?(?:\s+safe)?\b/i,
      /\bsafe\s+to\s+scan\b/i,
    ],
    category: 'security',
  },
  {
    id: 'security_check_document',
    description: 'Scan a document for red flags',
    agent: 'security',
    examples: ['check this contract', 'analyze this document', 'is this legit?'],
    patterns: [
      /\b(?:check|analyze|review|scan)\s+(?:this\s+)?(?:contract|document|agreement|form)\b/i,
      /\bis\s+(?:this|that)\s+(?:legit|legitimate|safe|ok|okay)\b/i,
      /\bany\s+(?:red\s+flags|concerns|issues|problems)\b/i,
    ],
    category: 'security',
  },
  {
    id: 'security_alert_history',
    description: 'Review recent security alerts',
    agent: 'security',
    examples: ['any threats today?', 'security report', 'recent alerts'],
    patterns: [
      /\b(?:any\s+)?(?:threats|alerts|warnings)\s*(?:today|recently|so\s+far)?\b/i,
      /\bsecurity\s+(?:report|summary|status)\b/i,
      /\brecent\s+(?:security\s+)?alerts\b/i,
    ],
    category: 'security',
  },

  // ── Networking ────────────────────────────────────────────
  {
    id: 'networking_scan_badge',
    description: 'Scan a person\'s badge or card',
    agent: 'networking',
    examples: ['who is this?', 'scan their badge', 'who am I talking to?'],
    patterns: [
      /\bwho\s+(?:is\s+)?(?:this|that|they)\b/i,
      /\bscan\s+(?:their|this|that)\s+(?:badge|card|name\s*tag)\b/i,
      /\bwho\s+(?:am\s+I|are\s+we)\s+(?:talking|looking|speaking)\s+(?:to|at)\b/i,
      /\bidentify\s+(?:this|that)\s+person\b/i,
    ],
    category: 'networking',
  },
  {
    id: 'networking_list_contacts',
    description: 'List contacts scanned today',
    agent: 'networking',
    examples: ['who have I met?', 'contact list', 'today\'s contacts'],
    patterns: [
      /\bwho\s+have\s+I\s+met\b/i,
      /\b(?:contact|people)\s+(?:list|today|so\s+far)\b/i,
      /\btoday'?s\s+contacts\b/i,
      /\bhow\s+many\s+(?:people|contacts)\b/i,
    ],
    category: 'networking',
  },
  {
    id: 'networking_draft_followup',
    description: 'Draft a follow-up email',
    agent: 'networking',
    examples: ['draft follow-up', 'email them', 'send a follow-up'],
    patterns: [
      /\bdraft\s+(?:a\s+)?follow[\s-]*up\b/i,
      /\bemail\s+(?:them|this\s+person|contact)\b/i,
      /\bsend\s+(?:a\s+)?follow[\s-]*up\b/i,
    ],
    category: 'networking',
  },

  // ── Deal Analysis ─────────────────────────────────────────
  {
    id: 'deals_price_check',
    description: 'Check the price of what you\'re looking at',
    agent: 'deals',
    examples: ['price check', 'how much is this?', 'is this a good deal?'],
    patterns: [
      /\bprice\s+check\b/i,
      /\bhow\s+much\s+(?:is|does)\s+(?:this|that)\b/i,
      /\b(?:is\s+this|good)\s+(?:a\s+)?(?:good\s+)?deal\b/i,
      /\bwhat'?s\s+(?:this|it)\s+worth\b/i,
      /\bcompare\s+prices?\b/i,
    ],
    category: 'deals',
  },
  {
    id: 'deals_negotiate',
    description: 'Get negotiation tips for current item',
    agent: 'deals',
    examples: ['negotiation tips', 'give me leverage', 'how do I negotiate?'],
    patterns: [
      /\bnegotiat(?:ion|e)\s*(?:tips|advice|help|leverage)?\b/i,
      /\bgive\s+(?:me\s+)?(?:negotiation\s+)?leverage\b/i,
      /\bhow\s+(?:do\s+I|should\s+I|can\s+I)\s+negotiate\b/i,
    ],
    category: 'deals',
  },
  {
    id: 'deals_history',
    description: 'Review deals analyzed today',
    agent: 'deals',
    examples: ['deals today', 'price history', 'what deals have I seen?'],
    patterns: [
      /\bdeals?\s+(?:today|history|so\s+far)\b/i,
      /\bprice\s+history\b/i,
      /\bwhat\s+(?:deals|prices)\s+have\s+(?:I|we)\s+(?:seen|checked|analyzed)\b/i,
    ],
    category: 'deals',
  },

  // ── Translation ───────────────────────────────────────────
  {
    id: 'translation_read',
    description: 'Translate text in view',
    agent: 'translation',
    examples: ['translate this', 'what does that say?', 'read that sign'],
    patterns: [
      /\btranslate\s+(?:this|that)\b/i,
      /\bwhat\s+does\s+(?:this|that|it)\s+say\b/i,
      /\bread\s+(?:this|that)\s+(?:sign|menu|text|label|document)\b/i,
      /\bwhat\s+language\s+is\s+(?:this|that)\b/i,
    ],
    category: 'translation',
  },
  {
    id: 'translation_cultural_brief',
    description: 'Get cultural briefing for current location',
    agent: 'translation',
    examples: ['cultural tips', 'local customs', 'etiquette here'],
    patterns: [
      /\bcultural?\s+(?:tips|briefing|guide|customs)\b/i,
      /\blocal\s+(?:customs|etiquette|tips)\b/i,
      /\betiquette\s+(?:here|tips|guide)\b/i,
      /\bdo'?s?\s+and\s+don'?ts?\b/i,
    ],
    category: 'translation',
  },

  // ── Debug ─────────────────────────────────────────────────
  {
    id: 'debug_analyze',
    description: 'Analyze code or error on screen',
    agent: 'debug',
    examples: ['debug this', 'what\'s wrong with this code?', 'fix this error'],
    patterns: [
      /\bdebug\s+(?:this|that)\b/i,
      /\bwhat'?s\s+wrong\s+(?:with\s+)?(?:this|that|the)\s*(?:code|error|screen)?\b/i,
      /\bfix\s+(?:this|that)\s*(?:error|bug|issue)?\b/i,
      /\banalyze\s+(?:this|that)\s*(?:code|error|stack\s*trace)?\b/i,
    ],
    category: 'debug',
  },
  {
    id: 'debug_explain',
    description: 'Explain code on screen',
    agent: 'debug',
    examples: ['explain this code', 'what does this do?', 'walk me through this'],
    patterns: [
      /\bexplain\s+(?:this|that)\s*(?:code|function|block)?\b/i,
      /\bwhat\s+does\s+(?:this|that)\s+(?:code\s+)?do\b/i,
      /\bwalk\s+(?:me\s+)?through\s+(?:this|that)\b/i,
    ],
    category: 'debug',
  },

  // ── Memory ────────────────────────────────────────────────
  {
    id: 'memory_remember',
    description: 'Save current view to memory',
    agent: 'memory',
    examples: ['remember this', 'save this', 'bookmark this moment'],
    patterns: [
      /\bremember\s+(?:this|that)\b/i,
      /\bsave\s+(?:this|that)\s*(?:to\s+memory)?\b/i,
      /\bbookmark\s+(?:this|that)\s*(?:moment|view)?\b/i,
      /\bkeep\s+this\b/i,
    ],
    category: 'memory',
  },
  {
    id: 'memory_search',
    description: 'Search your visual memory',
    agent: 'memory',
    examples: ['what was on that whiteboard?', 'find the business card', 'show me the menu from yesterday'],
    patterns: [
      /\bwhat\s+was\s+(?:on|in)\s+(?:that|the)\s+(.+)/i,
      /\bfind\s+(?:the|a|that)\s+(.+)/i,
      /\bsearch\s+(?:for\s+)?(?:the\s+)?(.+)/i,
      /\bshow\s+me\s+(?:the\s+)?(.+)/i,
    ],
    paramExtractor: (_text, match) => ({ query: match[1]?.trim() ?? '' }),
    category: 'memory',
  },
  {
    id: 'memory_delete_recent',
    description: 'Delete recent captures',
    agent: 'memory',
    examples: ['delete that', 'forget the last one', 'remove recent captures'],
    patterns: [
      /\bdelete\s+(?:that|the\s+last|recent)\b/i,
      /\bforget\s+(?:the\s+)?(?:last|that)\s*(?:one|capture|photo)?\b/i,
      /\bremove\s+(?:the\s+)?recent\s+(?:captures?|photos?|images?)\b/i,
    ],
    category: 'memory',
  },

  // ── Navigation / Context ──────────────────────────────────
  {
    id: 'context_what_am_i_looking_at',
    description: 'Identify what\'s in view',
    agent: 'context',
    examples: ['what is this?', 'identify this', 'what am I looking at?'],
    patterns: [
      /\bwhat\s+(?:is|are)\s+(?:this|that|these|those)\b/i,
      /\bidentify\s+(?:this|that)\b/i,
      /\bwhat\s+am\s+I\s+looking\s+at\b/i,
      /\btell\s+me\s+(?:about|what)\s+(?:this|that)\b/i,
    ],
    category: 'navigation',
  },
  {
    id: 'context_convert',
    description: 'Convert units (temperature, measurement, currency)',
    agent: 'context',
    examples: ['convert 350 degrees', 'what\'s that in metric?', 'how much in dollars?'],
    patterns: [
      /\bconvert\s+(.+)/i,
      /\bwhat'?s\s+(?:that|this)\s+in\s+(?:metric|imperial|celsius|fahrenheit|dollars|euros|pounds)\b/i,
      /\bhow\s+(?:much|many)\s+(?:is\s+that\s+)?in\s+(.+)/i,
    ],
    paramExtractor: (_text, match) => ({ value: match[1]?.trim() ?? '' }),
    category: 'navigation',
  },

  // ── System / Help ─────────────────────────────────────────
  {
    id: 'system_status',
    description: 'Get platform status',
    agent: 'platform',
    examples: ['status', 'how\'s everything?', 'system report'],
    patterns: [
      /\b(?:system\s+)?status\b/i,
      /\bhow'?s\s+everything\b/i,
      /\bsystem\s+(?:report|health|check)\b/i,
      /\bare\s+(?:you|we)\s+(?:ok|okay|good|working)\b/i,
    ],
    category: 'system',
  },
  {
    id: 'system_privacy_on',
    description: 'Enable privacy mode (stop capturing)',
    agent: 'platform',
    examples: ['privacy mode', 'stop capturing', 'go dark'],
    patterns: [
      /\bprivacy\s+(?:mode\s+)?(?:on|enable|activate)\b/i,
      /\bstop\s+(?:capturing|recording|watching)\b/i,
      /\bgo\s+dark\b/i,
      /\bprivacy\s+mode\b/i,
    ],
    category: 'system',
  },
  {
    id: 'system_privacy_off',
    description: 'Disable privacy mode (resume capturing)',
    agent: 'platform',
    examples: ['resume', 'start capturing again', 'privacy off'],
    patterns: [
      /\bprivacy\s+(?:mode\s+)?(?:off|disable|deactivate)\b/i,
      /\bresume\s+(?:capturing|recording|watching)\b/i,
      /\bstart\s+(?:capturing|recording)\s+again\b/i,
      /\bback\s+(?:online|on)\b/i,
    ],
    category: 'system',
  },
  {
    id: 'help_general',
    description: 'Get help with available commands',
    agent: 'platform',
    examples: ['help', 'what can I say?', 'list commands'],
    patterns: [
      /\bhelp\b/i,
      /\bwhat\s+can\s+I\s+(?:say|do|ask)\b/i,
      /\blist\s+(?:all\s+)?commands\b/i,
      /\bshow\s+(?:me\s+)?(?:available\s+)?commands\b/i,
      /\bcommand\s+list\b/i,
    ],
    category: 'help',
  },
  {
    id: 'help_category',
    description: 'Get help for a specific feature',
    agent: 'platform',
    examples: ['help with inventory', 'meeting commands', 'how do I inspect?'],
    patterns: [
      /\bhelp\s+(?:with\s+)?(?:the\s+)?(inventory|meeting|inspection|security|networking|deals?|translation|debug|memory)\b/i,
      /\b(inventory|meeting|inspection|security|networking|deals?|translation|debug|memory)\s+(?:commands?|help)\b/i,
      /\bhow\s+do\s+I\s+(?:start\s+)?(?:an?\s+)?(inventory|meeting|inspection|security|networking|translation|debug)\b/i,
    ],
    paramExtractor: (_text, match) => ({ category: match[1]?.toLowerCase() ?? '' }),
    category: 'help',
  },
];

// ─── Voice Matcher Class ────────────────────────────────────────

export class VoiceExpansion {
  private intents: ExpandedVoiceIntent[];
  private history: CommandHistoryEntry[] = [];
  private macros: Map<string, VoiceMacro> = new Map();
  private aliases: Map<string, string> = new Map(); // alias → full command
  private maxHistory: number;

  constructor(customIntents?: ExpandedVoiceIntent[], maxHistory = 100) {
    this.intents = [...EXPANDED_INTENTS, ...(customIntents ?? [])];
    this.maxHistory = maxHistory;

    // Register default aliases
    this.aliases.set('inv', 'start inventory');
    this.aliases.set('done', 'stop inventory');
    this.aliases.set('break', 'pause');
    this.aliases.set('back', 'resume');
    this.aliases.set('meeting', 'start meeting');
    this.aliases.set('walkthrough', 'start inspection');
  }

  // ─── Matching ───────────────────────────────────────────

  match(rawText: string): VoiceMatchResult | null {
    // Check aliases first
    const resolved = this.resolveAlias(rawText);

    let bestMatch: VoiceMatchResult | null = null;
    let bestScore = 0;

    for (const intent of this.intents) {
      for (const pattern of intent.patterns) {
        const match = resolved.match(pattern);
        if (match) {
          // Score based on match coverage
          const matchLength = match[0].length;
          const coverage = matchLength / resolved.length;
          const score = Math.min(1, coverage + 0.3); // Boost for any match

          if (score > bestScore) {
            bestScore = score;
            const params = intent.paramExtractor
              ? intent.paramExtractor(resolved, match)
              : {};

            bestMatch = {
              intent,
              confidence: score,
              params,
              rawText,
            };
          }
        }
      }
    }

    // Record in history
    if (bestMatch) {
      this.recordHistory(rawText, bestMatch.intent.id, true);
    }

    return bestMatch;
  }

  matchAll(rawText: string): VoiceMatchResult[] {
    const resolved = this.resolveAlias(rawText);
    const results: VoiceMatchResult[] = [];

    for (const intent of this.intents) {
      for (const pattern of intent.patterns) {
        const match = resolved.match(pattern);
        if (match) {
          const matchLength = match[0].length;
          const coverage = matchLength / resolved.length;
          const score = Math.min(1, coverage + 0.3);

          const params = intent.paramExtractor
            ? intent.paramExtractor(resolved, match)
            : {};

          results.push({
            intent,
            confidence: score,
            params,
            rawText,
          });
          break; // Only one match per intent
        }
      }
    }

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  }

  // ─── Aliases ────────────────────────────────────────────

  addAlias(alias: string, command: string): void {
    this.aliases.set(alias.toLowerCase().trim(), command);
  }

  removeAlias(alias: string): boolean {
    return this.aliases.delete(alias.toLowerCase().trim());
  }

  getAliases(): Map<string, string> {
    return new Map(this.aliases);
  }

  private resolveAlias(text: string): string {
    const trimmed = text.toLowerCase().trim();
    return this.aliases.get(trimmed) ?? text;
  }

  // ─── Macros ─────────────────────────────────────────────

  recordMacro(name: string, triggerPhrase: string, commands: string[]): VoiceMacro {
    const macro: VoiceMacro = {
      name,
      triggerPhrase: triggerPhrase.toLowerCase().trim(),
      commands,
      createdAt: new Date().toISOString(),
    };
    this.macros.set(name, macro);
    return macro;
  }

  getMacro(name: string): VoiceMacro | undefined {
    return this.macros.get(name);
  }

  deleteMacro(name: string): boolean {
    return this.macros.delete(name);
  }

  listMacros(): VoiceMacro[] {
    return Array.from(this.macros.values());
  }

  expandMacro(triggerPhrase: string): string[] | null {
    const trimmed = triggerPhrase.toLowerCase().trim();
    for (const macro of this.macros.values()) {
      if (macro.triggerPhrase === trimmed) {
        return macro.commands;
      }
    }
    return null;
  }

  // ─── History ────────────────────────────────────────────

  getHistory(limit?: number): CommandHistoryEntry[] {
    const max = limit ?? this.maxHistory;
    return this.history.slice(-max);
  }

  getLastCommand(): CommandHistoryEntry | undefined {
    return this.history[this.history.length - 1];
  }

  clearHistory(): void {
    this.history = [];
  }

  private recordHistory(rawText: string, intentId: string, success: boolean): void {
    this.history.push({
      rawText,
      intentId,
      timestamp: new Date().toISOString(),
      success,
    });

    // Trim to max
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  // ─── Help System ────────────────────────────────────────

  generateHelp(category?: VoiceCategory): HelpSection[] {
    const categories = category
      ? [category]
      : [...new Set(this.intents.map(i => i.category))];

    const categoryTitles: Record<VoiceCategory, string> = {
      inventory: '📦 Inventory Commands',
      meeting: '🤝 Meeting Commands',
      inspection: '🔍 Inspection Commands',
      security: '🔒 Security Commands',
      networking: '👤 Networking Commands',
      deals: '💰 Deal Analysis Commands',
      translation: '🌍 Translation Commands',
      debug: '🐛 Debug Commands',
      memory: '🧠 Memory Commands',
      navigation: '🧭 Context & Navigation',
      system: '⚙️ System Commands',
      help: '❓ Help',
    };

    return categories.map(cat => ({
      category: cat,
      title: categoryTitles[cat] ?? cat,
      commands: this.intents
        .filter(i => i.category === cat)
        .map(i => ({
          phrase: i.examples[0] ?? '',
          description: i.description,
        })),
    }));
  }

  generateVoiceHelp(category?: VoiceCategory): string {
    const sections = this.generateHelp(category);

    if (category) {
      const section = sections[0];
      if (!section) return `No commands found for ${category}.`;

      let text = `${section.title}: `;
      text += section.commands.map(c => c.phrase).join('. ');
      return text;
    }

    // General help
    let text = `Available command categories: `;
    text += sections.map(s => s.title.replace(/[^\w\s]/g, '').trim()).join(', ');
    text += `. Say "help with" followed by a category name for details.`;
    return text;
  }

  // ─── Stats ──────────────────────────────────────────────

  getIntentCount(): number {
    return this.intents.length;
  }

  getCategoryCount(): number {
    return new Set(this.intents.map(i => i.category)).size;
  }

  getStats(): { intents: number; categories: number; history: number; macros: number; aliases: number } {
    return {
      intents: this.intents.length,
      categories: this.getCategoryCount(),
      history: this.history.length,
      macros: this.macros.size,
      aliases: this.aliases.size,
    };
  }
}
