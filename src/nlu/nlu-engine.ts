/**
 * Natural Language Understanding Engine
 * 
 * Beyond regex pattern matching — intent classification with context memory,
 * slot filling, multi-turn dialogue, disambiguation, and learning.
 * 
 * The glasses are voice-first. Users speak naturally:
 *   "What's the price on that?"
 *   "Add it to my inventory count"
 *   "Who was that person I just met?"
 *   "How does this compare to the one I saw yesterday?"
 * 
 * This engine:
 * 1. Classifies intents using TF-IDF scoring + contextual boosting
 * 2. Extracts slots (entities) from natural speech
 * 3. Manages multi-turn dialogue state
 * 4. Resolves ambiguous references ("that", "it", "the other one")
 * 5. Learns from user corrections
 * 
 * @module nlu/nlu-engine
 */

import { EventEmitter } from 'events';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Intent {
  id: string;
  name: string;
  category: IntentCategory;
  description: string;
  examples: string[];
  slots: SlotDefinition[];
  priority: number;
  /** Boost multiplier when context matches (e.g., intent "add item" boosted when in inventory mode) */
  contextBoost?: Record<string, number>;
  /** Required slots before executing */
  requiredSlots?: string[];
  /** Follow-up intents that are likely after this one */
  followUpIntents?: string[];
  /** Custom handler ID for the agent/module */
  handler?: string;
}

export type IntentCategory =
  | 'inventory'
  | 'navigation'
  | 'search'
  | 'control'
  | 'social'
  | 'information'
  | 'shopping'
  | 'safety'
  | 'meeting'
  | 'inspection'
  | 'debug'
  | 'translation'
  | 'system'
  | 'custom';

export interface SlotDefinition {
  name: string;
  type: SlotType;
  required: boolean;
  prompt?: string; // Ask this if slot is missing
  examples?: string[];
  /** Entity extraction patterns */
  patterns?: RegExp[];
  /** Enum values for 'enum' type */
  values?: string[];
  /** Default value if not provided */
  defaultValue?: unknown;
}

export type SlotType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'time'
  | 'location'
  | 'product'
  | 'person'
  | 'enum'
  | 'entity';

export interface ClassifiedIntent {
  intentId: string;
  intentName: string;
  category: IntentCategory;
  confidence: number;
  slots: Record<string, SlotValue>;
  missingSlots: string[];
  rawText: string;
  normalizedText: string;
  ambiguous: boolean;
  alternatives: Array<{ intentId: string; confidence: number }>;
  contextUsed: boolean;
  turnId: string;
}

export interface SlotValue {
  name: string;
  value: unknown;
  type: SlotType;
  raw: string;
  confidence: number;
  fromContext: boolean;
}

export interface DialogueTurn {
  id: string;
  timestamp: number;
  userText: string;
  classification: ClassifiedIntent;
  response?: string;
  completed: boolean;
}

export interface DialogueState {
  currentContext: string;
  activeMode: string | null;
  turns: DialogueTurn[];
  slotMemory: Record<string, SlotValue>;
  recentEntities: RecentEntity[];
  expectations: string[]; // Intent IDs expected next
  lastIntentId: string | null;
}

export interface RecentEntity {
  type: string;
  value: unknown;
  label: string;
  timestamp: number;
  source: 'voice' | 'vision' | 'system';
}

export interface NLUConfig {
  /** Max dialogue turns to keep in memory (default: 20) */
  maxTurns: number;
  /** Min confidence to accept classification (default: 0.3) */
  minConfidence: number;
  /** Ambiguity threshold — difference between top two intents (default: 0.15) */
  ambiguityThreshold: number;
  /** Max recent entities to track (default: 50) */
  maxRecentEntities: number;
  /** Entity max age in ms (default: 300000 = 5 min) */
  entityMaxAge: number;
  /** Context boost multiplier (default: 1.5) */
  contextBoostMultiplier: number;
  /** Follow-up boost multiplier (default: 1.3) */
  followUpBoostMultiplier: number;
  /** Enable learning from corrections (default: true) */
  enableLearning: boolean;
  /** Max learned patterns per intent (default: 100) */
  maxLearnedPatterns: number;
}

export interface NLUEvents {
  'intent:classified': (result: ClassifiedIntent) => void;
  'intent:ambiguous': (result: ClassifiedIntent) => void;
  'slot:missing': (intentId: string, slotName: string, prompt: string) => void;
  'slot:filled': (intentId: string, slotName: string, value: SlotValue) => void;
  'context:changed': (oldContext: string, newContext: string) => void;
  'mode:changed': (oldMode: string | null, newMode: string | null) => void;
  'entity:tracked': (entity: RecentEntity) => void;
  'correction:learned': (intentId: string, pattern: string) => void;
  'error': (error: Error) => void;
}

export interface NLUStats {
  totalClassifications: number;
  intentCounts: Record<string, number>;
  avgConfidence: number;
  ambiguousCount: number;
  correctionCount: number;
  slotFillRate: number;
  topIntents: Array<{ id: string; count: number }>;
}

// ─── Default Config ──────────────────────────────────────────────────────────

export const DEFAULT_NLU_CONFIG: NLUConfig = {
  maxTurns: 20,
  minConfidence: 0.3,
  ambiguityThreshold: 0.15,
  maxRecentEntities: 50,
  entityMaxAge: 300000,
  contextBoostMultiplier: 1.5,
  followUpBoostMultiplier: 1.3,
  enableLearning: true,
  maxLearnedPatterns: 100,
};

// ─── Text Processing Utilities ───────────────────────────────────────────────

/** Normalize text for comparison: lowercase, trim, remove punctuation */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s'-]/g, '')
    .replace(/\s+/g, ' ');
}

/** Tokenize text into words */
export function tokenize(text: string): string[] {
  return normalizeText(text).split(/\s+/).filter(w => w.length > 0);
}

/** Common English stop words */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'must', 'need',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'it', 'its',
  'to', 'of', 'in', 'for', 'on', 'at', 'by', 'with', 'from',
  'up', 'out', 'if', 'or', 'and', 'but', 'not', 'no', 'so',
  'just', 'about', 'also', 'then', 'than', 'too', 'very',
  'that', 'this', 'these', 'those', 'there', 'here',
  'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
  'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'only', 'own', 'same',
]);

/** Remove stop words from tokens */
export function removeStopWords(tokens: string[]): string[] {
  return tokens.filter(t => !STOP_WORDS.has(t));
}

/** Compute TF (term frequency) for tokens */
export function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  // Normalize
  for (const [key, val] of tf) {
    tf.set(key, val / tokens.length);
  }
  return tf;
}

/** Compute similarity between two token sets using cosine-like TF scoring */
export function computeTokenSimilarity(queryTokens: string[], docTokens: string[]): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  const querySet = new Set(queryTokens);
  const docSet = new Set(docTokens);

  let overlap = 0;
  for (const token of querySet) {
    if (docSet.has(token)) overlap++;
  }

  // Jaccard-like similarity with length normalization
  const union = new Set([...queryTokens, ...docTokens]).size;
  const jaccardBase = union > 0 ? overlap / union : 0;

  // Boost for query coverage (how much of the query is represented)
  const queryCoverage = querySet.size > 0 ? overlap / querySet.size : 0;

  // Combined score
  return jaccardBase * 0.4 + queryCoverage * 0.6;
}

// ─── Slot Extractors ─────────────────────────────────────────────────────────

/** Extract a number from text */
export function extractNumber(text: string): number | null {
  // Match standalone numbers including decimals
  const match = text.match(/\b(\d+(?:\.\d+)?)\b/);
  return match ? parseFloat(match[1]) : null;
}

/** Extract a boolean intent from text */
export function extractBoolean(text: string): boolean | null {
  const normalized = normalizeText(text);
  if (/\b(yes|yeah|yep|sure|ok|okay|correct|right|affirmative|true|enable|on)\b/.test(normalized)) return true;
  if (/\b(no|nope|nah|cancel|wrong|negative|false|disable|off)\b/.test(normalized)) return false;
  return null;
}

/** Extract time expressions */
export function extractTime(text: string): string | null {
  // "at 3pm", "3:30", "15:00", "noon", "midnight"
  const patterns = [
    /\b(\d{1,2}:\d{2}(?:\s*[ap]m)?)\b/i,
    /\b(\d{1,2}\s*[ap]m)\b/i,
    /\b(noon|midnight)\b/i,
  ];
  for (const p of patterns) {
    const match = text.match(p);
    if (match) return match[1];
  }
  return null;
}

/** Extract location expressions */
export function extractLocation(text: string): string | null {
  // "in aisle 5", "section B", "row 3", "shelf 2"
  const patterns = [
    /\b(?:in\s+)?aisle\s+(\w+)/i,
    /\b(?:in\s+)?section\s+(\w+)/i,
    /\b(?:in\s+)?row\s+(\w+)/i,
    /\b(?:on\s+)?shelf\s+(\w+)/i,
    /\b(?:in\s+)?zone\s+(\w+)/i,
    /\b(?:in\s+the\s+)?(\w+)\s+(?:department|area|room|section)/i,
  ];
  for (const p of patterns) {
    const match = text.match(p);
    if (match) return match[1];
  }
  return null;
}

/** Extract person name */
export function extractPerson(text: string): string | null {
  // Simple heuristic: capitalized words after certain cues
  const patterns = [
    /\b(?:named?|called?|is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:said|told|asked|mentioned)/,
  ];
  for (const p of patterns) {
    const match = text.match(p);
    if (match) return match[1];
  }
  return null;
}

/** Extract product name/reference */
export function extractProduct(text: string): string | null {
  const patterns = [
    /\b(?:the\s+)?(?:product|item|thing)\s+(?:called\s+)?["']([^"']+)["']/i,
    /\b(?:find|scan|look up|check)\s+(?:the\s+)?(.+?)(?:\s+(?:for|in|on|please)|\s*$)/i,
  ];
  for (const p of patterns) {
    const match = text.match(p);
    if (match) return match[1].trim();
  }
  return null;
}

// ─── Built-in Intents ────────────────────────────────────────────────────────

export const BUILT_IN_INTENTS: Intent[] = [
  // ── Inventory ──
  {
    id: 'inventory.start',
    name: 'Start Inventory',
    category: 'inventory',
    description: 'Begin an inventory counting session',
    examples: [
      'start inventory', 'begin counting', 'start a count', 'new inventory session',
      'lets start counting', 'begin inventory scan', 'start scanning',
      'time to count', 'begin the count', 'start inventory count',
    ],
    slots: [
      { name: 'storeName', type: 'string', required: false, prompt: 'Which store?' },
      { name: 'zone', type: 'location', required: false },
    ],
    priority: 1,
    contextBoost: { inventory: 1.2, idle: 1.1 },
    followUpIntents: ['inventory.set_aisle', 'inventory.scan'],
    handler: 'inventory',
  },
  {
    id: 'inventory.stop',
    name: 'Stop Inventory',
    category: 'inventory',
    description: 'End the current inventory session',
    examples: [
      'stop inventory', 'end counting', 'finish the count', 'done counting',
      'wrap up inventory', 'complete the session', 'stop scanning',
      'thats it', 'were done', 'end session',
    ],
    slots: [],
    priority: 1,
    contextBoost: { inventory: 1.5 },
    handler: 'inventory',
  },
  {
    id: 'inventory.pause',
    name: 'Pause Inventory',
    category: 'inventory',
    description: 'Pause the current inventory session',
    examples: [
      'pause', 'pause inventory', 'take a break', 'hold on',
      'pause counting', 'pause the scan', 'stop for now',
    ],
    slots: [],
    priority: 1,
    contextBoost: { inventory: 1.5 },
    handler: 'inventory',
  },
  {
    id: 'inventory.resume',
    name: 'Resume Inventory',
    category: 'inventory',
    description: 'Resume a paused inventory session',
    examples: [
      'resume', 'resume counting', 'continue', 'keep going',
      'start again', 'unpause', 'resume scanning', 'back to counting',
    ],
    slots: [],
    priority: 1,
    contextBoost: { inventory: 1.5 },
    handler: 'inventory',
  },
  {
    id: 'inventory.set_aisle',
    name: 'Set Aisle',
    category: 'inventory',
    description: 'Set the current aisle or location',
    examples: [
      'aisle 5', 'moving to aisle 3', 'now in aisle 7', 'aisle twelve',
      'section B', 'row 3', 'going to the next aisle', 'next aisle',
    ],
    slots: [
      { name: 'aisle', type: 'string', required: true, prompt: 'Which aisle?' },
    ],
    priority: 2,
    contextBoost: { inventory: 2.0 },
    handler: 'inventory',
  },
  {
    id: 'inventory.scan',
    name: 'Scan Item',
    category: 'inventory',
    description: 'Scan or count an item',
    examples: [
      'scan this', 'count this', 'add this item', 'got one here',
      'scan the shelf', 'count these', 'theres five of these',
    ],
    slots: [
      { name: 'count', type: 'number', required: false, defaultValue: 1 },
      { name: 'product', type: 'product', required: false },
    ],
    priority: 2,
    contextBoost: { inventory: 1.8 },
    handler: 'inventory',
  },
  {
    id: 'inventory.manual_count',
    name: 'Manual Count',
    category: 'inventory',
    description: 'Set a manual count for an item',
    examples: [
      'set count to 24', 'manual count 50', 'there are 12', 'count is 30',
      'update count to 100', 'override count 15', 'actually theres 8',
    ],
    slots: [
      { name: 'count', type: 'number', required: true, prompt: 'How many?' },
    ],
    priority: 2,
    contextBoost: { inventory: 2.0 },
    handler: 'inventory',
  },
  {
    id: 'inventory.status',
    name: 'Inventory Status',
    category: 'inventory',
    description: 'Get current inventory session status',
    examples: [
      'inventory status', 'how many items', 'count so far', 'progress update',
      'hows the count going', 'where are we', 'summary',
    ],
    slots: [],
    priority: 3,
    contextBoost: { inventory: 1.5 },
    handler: 'inventory',
  },
  {
    id: 'inventory.export',
    name: 'Export Inventory',
    category: 'inventory',
    description: 'Export inventory data',
    examples: [
      'export inventory', 'generate report', 'download csv', 'send me the data',
      'export to csv', 'create report', 'email me the results',
    ],
    slots: [
      { name: 'format', type: 'enum', required: false, values: ['csv', 'json', 'pdf'], defaultValue: 'csv' },
    ],
    priority: 3,
    contextBoost: { inventory: 1.3 },
    handler: 'inventory',
  },

  // ── Navigation / Search ──
  {
    id: 'search.memory',
    name: 'Search Memory',
    category: 'search',
    description: 'Search through visual memory',
    examples: [
      'what was on that whiteboard', 'find the sign I saw earlier',
      'search my photos', 'remember that document', 'find the price tag I saw',
      'when did I see that', 'show me what I captured yesterday',
    ],
    slots: [
      { name: 'query', type: 'string', required: true, prompt: 'What are you looking for?' },
      { name: 'timeRange', type: 'string', required: false },
    ],
    priority: 2,
    handler: 'memory',
  },
  {
    id: 'search.product',
    name: 'Product Search',
    category: 'shopping',
    description: 'Look up a product',
    examples: [
      'whats this product', 'look this up', 'find this item',
      'product info', 'tell me about this', 'what am I looking at',
    ],
    slots: [
      { name: 'product', type: 'product', required: false },
    ],
    priority: 2,
    handler: 'deals',
  },

  // ── Price / Shopping ──
  {
    id: 'shopping.price_check',
    name: 'Price Check',
    category: 'shopping',
    description: 'Check the price or compare prices',
    examples: [
      'price check', 'how much is this', 'whats the price',
      'is this a good deal', 'compare prices', 'is this worth it',
      'check the price on this', 'find me a better price',
    ],
    slots: [
      { name: 'product', type: 'product', required: false },
    ],
    priority: 2,
    contextBoost: { shopping: 1.5 },
    handler: 'deals',
  },

  // ── Social / Networking ──
  {
    id: 'social.identify',
    name: 'Identify Person',
    category: 'social',
    description: 'Identify or look up a person',
    examples: [
      'who is this', 'who is that', 'scan their badge', 'read their name tag',
      'who am I talking to', 'identify this person', 'scan this business card',
    ],
    slots: [
      { name: 'person', type: 'person', required: false },
    ],
    priority: 2,
    contextBoost: { networking: 1.5, meeting: 1.3 },
    handler: 'networking',
  },

  // ── Meeting ──
  {
    id: 'meeting.start',
    name: 'Start Meeting',
    category: 'meeting',
    description: 'Start recording a meeting',
    examples: [
      'start meeting', 'begin meeting recording', 'record this meeting',
      'start transcription', 'meeting mode', 'start the meeting',
    ],
    slots: [
      { name: 'meetingName', type: 'string', required: false, prompt: 'What meeting is this?' },
    ],
    priority: 1,
    followUpIntents: ['meeting.action_item', 'meeting.decision'],
    handler: 'meeting',
  },
  {
    id: 'meeting.end',
    name: 'End Meeting',
    category: 'meeting',
    description: 'End the current meeting recording',
    examples: [
      'end meeting', 'stop recording', 'meeting over', 'wrap up the meeting',
      'finish the meeting', 'stop the meeting',
    ],
    slots: [],
    priority: 1,
    contextBoost: { meeting: 1.5 },
    handler: 'meeting',
  },
  {
    id: 'meeting.action_item',
    name: 'Add Action Item',
    category: 'meeting',
    description: 'Add an action item from the meeting',
    examples: [
      'action item', 'add a task', 'note that as an action',
      'to do', 'follow up on that', 'remember to do that',
    ],
    slots: [
      { name: 'task', type: 'string', required: true, prompt: 'What needs to be done?' },
      { name: 'assignee', type: 'person', required: false },
    ],
    priority: 2,
    contextBoost: { meeting: 2.0 },
    handler: 'meeting',
  },
  {
    id: 'meeting.decision',
    name: 'Record Decision',
    category: 'meeting',
    description: 'Record a decision made in the meeting',
    examples: [
      'we decided', 'decision made', 'thats decided', 'record that decision',
      'mark that as a decision', 'agreed on that',
    ],
    slots: [
      { name: 'decision', type: 'string', required: true, prompt: 'What was decided?' },
    ],
    priority: 2,
    contextBoost: { meeting: 2.0 },
    handler: 'meeting',
  },

  // ── Safety ──
  {
    id: 'safety.scan_qr',
    name: 'Scan QR Code',
    category: 'safety',
    description: 'Scan and analyze a QR code',
    examples: [
      'scan this qr code', 'check this qr', 'is this qr code safe',
      'read the qr code', 'analyze this code',
    ],
    slots: [],
    priority: 2,
    handler: 'security',
  },
  {
    id: 'safety.check_document',
    name: 'Check Document',
    category: 'safety',
    description: 'Analyze a document or contract for risks',
    examples: [
      'check this contract', 'analyze this document', 'is this safe to sign',
      'review this agreement', 'scan this document',
    ],
    slots: [],
    priority: 2,
    handler: 'security',
  },

  // ── Inspection ──
  {
    id: 'inspection.start',
    name: 'Start Inspection',
    category: 'inspection',
    description: 'Start a property or space inspection',
    examples: [
      'start inspection', 'begin walkthrough', 'inspect this place',
      'start the inspection', 'property inspection mode',
    ],
    slots: [
      { name: 'type', type: 'enum', required: false, values: ['property', 'server_room', 'construction', 'warehouse', 'vehicle', 'general'] },
      { name: 'name', type: 'string', required: false },
    ],
    priority: 1,
    handler: 'inspection',
  },
  {
    id: 'inspection.next_room',
    name: 'Next Room',
    category: 'inspection',
    description: 'Move to the next room or section',
    examples: [
      'next room', 'moving on', 'next section', 'go to kitchen',
      'now in the bathroom', 'moving to bedroom', 'next area',
    ],
    slots: [
      { name: 'room', type: 'string', required: false, prompt: 'Which room?' },
    ],
    priority: 2,
    contextBoost: { inspection: 2.0 },
    handler: 'inspection',
  },

  // ── Translation ──
  {
    id: 'translation.translate',
    name: 'Translate',
    category: 'translation',
    description: 'Translate text in view',
    examples: [
      'translate this', 'what does that say', 'read that sign',
      'translate the menu', 'what language is this', 'translate to english',
    ],
    slots: [
      { name: 'targetLanguage', type: 'string', required: false, defaultValue: 'english' },
    ],
    priority: 2,
    handler: 'translation',
  },

  // ── Debug ──
  {
    id: 'debug.analyze',
    name: 'Debug Code',
    category: 'debug',
    description: 'Analyze code or error on screen',
    examples: [
      'debug this', 'whats wrong with this code', 'analyze this error',
      'fix this bug', 'explain this error', 'help with this code',
    ],
    slots: [],
    priority: 2,
    handler: 'debug',
  },

  // ── System / Control ──
  {
    id: 'system.photo',
    name: 'Take Photo',
    category: 'control',
    description: 'Take a photo / remember this',
    examples: [
      'take a photo', 'snap this', 'capture this', 'remember this',
      'save this', 'take a picture', 'screenshot',
    ],
    slots: [
      { name: 'annotation', type: 'string', required: false },
    ],
    priority: 1,
    handler: 'system',
  },
  {
    id: 'system.status',
    name: 'System Status',
    category: 'system',
    description: 'Get system status',
    examples: [
      'system status', 'how are you doing', 'battery status',
      'connection status', 'are you connected', 'whats your status',
    ],
    slots: [],
    priority: 3,
    handler: 'system',
  },
  {
    id: 'system.privacy',
    name: 'Privacy Toggle',
    category: 'control',
    description: 'Toggle privacy mode',
    examples: [
      'privacy mode', 'stop recording', 'go private', 'mute',
      'disable camera', 'turn off recording', 'privacy on',
      'privacy off', 'resume recording',
    ],
    slots: [
      { name: 'enabled', type: 'boolean', required: false },
    ],
    priority: 1,
    handler: 'system',
  },
  {
    id: 'system.help',
    name: 'Help',
    category: 'system',
    description: 'Get help or list available commands',
    examples: [
      'help', 'what can you do', 'list commands', 'how do I',
      'show me what you can do', 'guide', 'tutorial',
    ],
    slots: [],
    priority: 3,
    handler: 'system',
  },
];

// ─── NLU Engine ──────────────────────────────────────────────────────────────

export class NLUEngine extends EventEmitter {
  private config: NLUConfig;
  private intents: Map<string, Intent> = new Map();
  private intentTokenCache: Map<string, string[][]> = new Map();
  private dialogue: DialogueState;
  private stats: NLUStats;
  private learnedPatterns: Map<string, string[]> = new Map();
  private turnCounter = 0;

  constructor(config: Partial<NLUConfig> = {}) {
    super();
    this.config = { ...DEFAULT_NLU_CONFIG, ...config };

    this.dialogue = {
      currentContext: 'idle',
      activeMode: null,
      turns: [],
      slotMemory: {},
      recentEntities: [],
      expectations: [],
      lastIntentId: null,
    };

    this.stats = {
      totalClassifications: 0,
      intentCounts: {},
      avgConfidence: 0,
      ambiguousCount: 0,
      correctionCount: 0,
      slotFillRate: 0,
      topIntents: [],
    };

    // Register built-in intents
    for (const intent of BUILT_IN_INTENTS) {
      this.registerIntent(intent);
    }
  }

  // ─── Intent Registration ─────────────────────────────────────────────────

  registerIntent(intent: Intent): void {
    this.intents.set(intent.id, intent);

    // Pre-tokenize examples for fast matching
    const tokenized = intent.examples.map(ex =>
      removeStopWords(tokenize(ex)),
    );
    this.intentTokenCache.set(intent.id, tokenized);
  }

  unregisterIntent(intentId: string): void {
    this.intents.delete(intentId);
    this.intentTokenCache.delete(intentId);
  }

  getIntent(intentId: string): Intent | undefined {
    return this.intents.get(intentId);
  }

  getIntents(): Intent[] {
    return Array.from(this.intents.values());
  }

  getIntentsByCategory(category: IntentCategory): Intent[] {
    return Array.from(this.intents.values()).filter(i => i.category === category);
  }

  // ─── Classification ──────────────────────────────────────────────────────

  classify(text: string): ClassifiedIntent {
    const normalizedText = normalizeText(text);
    const queryTokens = removeStopWords(tokenize(text));

    this.turnCounter++;
    const turnId = `turn-${this.turnCounter}`;

    // Score each intent
    const scores: Array<{ intentId: string; score: number }> = [];

    for (const [intentId, intent] of this.intents) {
      let score = this.scoreIntent(queryTokens, normalizedText, intentId, intent);

      // Apply context boost
      if (intent.contextBoost && intent.contextBoost[this.dialogue.currentContext]) {
        score *= intent.contextBoost[this.dialogue.currentContext] * this.config.contextBoostMultiplier;
      }

      // Apply follow-up boost
      if (this.dialogue.lastIntentId) {
        const lastIntent = this.intents.get(this.dialogue.lastIntentId);
        if (lastIntent?.followUpIntents?.includes(intentId)) {
          score *= this.config.followUpBoostMultiplier;
        }
      }

      // Apply expectation boost
      if (this.dialogue.expectations.includes(intentId)) {
        score *= 1.4;
      }

      scores.push({ intentId, score });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    const topScore = scores[0]?.score ?? 0;
    const secondScore = scores[1]?.score ?? 0;

    const bestIntentId = scores[0]?.intentId ?? '';
    const bestIntent = this.intents.get(bestIntentId);

    // Determine if result is ambiguous
    const ambiguous = topScore > 0 && (topScore - secondScore) < this.config.ambiguityThreshold;

    // Extract slots
    const slots: Record<string, SlotValue> = {};
    const missingSlots: string[] = [];
    let slotsFilled = 0;
    let slotsTotal = 0;

    if (bestIntent) {
      for (const slotDef of bestIntent.slots) {
        slotsTotal++;
        const extracted = this.extractSlot(text, normalizedText, slotDef);
        if (extracted) {
          slots[slotDef.name] = extracted;
          slotsFilled++;
        } else if (slotDef.required) {
          missingSlots.push(slotDef.name);
        } else if (slotDef.defaultValue !== undefined) {
          slots[slotDef.name] = {
            name: slotDef.name,
            value: slotDef.defaultValue,
            type: slotDef.type,
            raw: '',
            confidence: 0.5,
            fromContext: false,
          };
          slotsFilled++;
        }
      }
    }

    // Check context for missing required slots
    for (const slotName of missingSlots) {
      const contextSlot = this.dialogue.slotMemory[slotName];
      if (contextSlot && Date.now() - (contextSlot as any).timestamp < this.config.entityMaxAge) {
        slots[slotName] = { ...contextSlot, fromContext: true };
        const idx = missingSlots.indexOf(slotName);
        if (idx >= 0) missingSlots.splice(idx, 1);
        slotsFilled++;
      }
    }

    const result: ClassifiedIntent = {
      intentId: bestIntentId,
      intentName: bestIntent?.name ?? 'unknown',
      category: bestIntent?.category ?? 'custom',
      confidence: Math.min(1, topScore),
      slots,
      missingSlots,
      rawText: text,
      normalizedText,
      ambiguous,
      alternatives: scores.slice(1, 4).map(s => ({
        intentId: s.intentId,
        confidence: Math.min(1, s.score),
      })),
      contextUsed: Object.values(slots).some(s => s.fromContext),
      turnId,
    };

    // Update dialogue state
    this.updateDialogueState(result);

    // Update stats
    this.updateStats(result, slotsFilled, slotsTotal);

    // Emit events
    this.emit('intent:classified', result);
    if (ambiguous) {
      this.emit('intent:ambiguous', result);
    }
    for (const slotName of missingSlots) {
      const slotDef = bestIntent?.slots.find(s => s.name === slotName);
      if (slotDef?.prompt) {
        this.emit('slot:missing', bestIntentId, slotName, slotDef.prompt);
      }
    }

    return result;
  }

  // ─── Intent Scoring ──────────────────────────────────────────────────────

  private scoreIntent(queryTokens: string[], normalizedText: string, intentId: string, intent: Intent): number {
    const exampleTokens = this.intentTokenCache.get(intentId) || [];

    // 1. Token similarity against examples
    let maxSimilarity = 0;
    for (const exTokens of exampleTokens) {
      const sim = computeTokenSimilarity(queryTokens, exTokens);
      if (sim > maxSimilarity) maxSimilarity = sim;
    }

    // 2. Exact/partial match bonus
    let exactBonus = 0;
    for (const example of intent.examples) {
      const normalizedExample = normalizeText(example);
      if (normalizedText === normalizedExample) {
        exactBonus = 0.5;
        break;
      }
      if (normalizedText.includes(normalizedExample) || normalizedExample.includes(normalizedText)) {
        exactBonus = Math.max(exactBonus, 0.3);
      }
    }

    // 3. Learned patterns
    const learned = this.learnedPatterns.get(intentId) || [];
    for (const pattern of learned) {
      if (normalizedText.includes(normalizeText(pattern))) {
        maxSimilarity = Math.max(maxSimilarity, 0.7);
      }
    }

    // 4. Custom pattern match
    for (const slot of intent.slots) {
      if (slot.patterns) {
        for (const pattern of slot.patterns) {
          if (pattern.test(normalizedText)) {
            maxSimilarity = Math.max(maxSimilarity, 0.4);
          }
        }
      }
    }

    return maxSimilarity + exactBonus;
  }

  // ─── Slot Extraction ─────────────────────────────────────────────────────

  private extractSlot(rawText: string, normalizedText: string, slotDef: SlotDefinition): SlotValue | null {
    // Custom patterns first
    if (slotDef.patterns) {
      for (const pattern of slotDef.patterns) {
        const match = rawText.match(pattern) || normalizedText.match(pattern);
        if (match) {
          return {
            name: slotDef.name,
            value: match[1] ?? match[0],
            type: slotDef.type,
            raw: match[0],
            confidence: 0.9,
            fromContext: false,
          };
        }
      }
    }

    // Enum matching
    if (slotDef.type === 'enum' && slotDef.values) {
      for (const val of slotDef.values) {
        if (normalizedText.includes(val.toLowerCase())) {
          return {
            name: slotDef.name,
            value: val,
            type: 'enum',
            raw: val,
            confidence: 0.85,
            fromContext: false,
          };
        }
      }
    }

    // Type-specific extraction
    switch (slotDef.type) {
      case 'number': {
        const num = extractNumber(rawText);
        if (num !== null) {
          return {
            name: slotDef.name,
            value: num,
            type: 'number',
            raw: String(num),
            confidence: 0.8,
            fromContext: false,
          };
        }
        break;
      }
      case 'boolean': {
        const bool = extractBoolean(normalizedText);
        if (bool !== null) {
          return {
            name: slotDef.name,
            value: bool,
            type: 'boolean',
            raw: String(bool),
            confidence: 0.85,
            fromContext: false,
          };
        }
        break;
      }
      case 'time': {
        const time = extractTime(rawText);
        if (time) {
          return {
            name: slotDef.name,
            value: time,
            type: 'time',
            raw: time,
            confidence: 0.8,
            fromContext: false,
          };
        }
        break;
      }
      case 'location': {
        const loc = extractLocation(rawText);
        if (loc) {
          return {
            name: slotDef.name,
            value: loc,
            type: 'location',
            raw: loc,
            confidence: 0.75,
            fromContext: false,
          };
        }
        break;
      }
      case 'person': {
        const person = extractPerson(rawText);
        if (person) {
          return {
            name: slotDef.name,
            value: person,
            type: 'person',
            raw: person,
            confidence: 0.7,
            fromContext: false,
          };
        }
        break;
      }
      case 'product': {
        const product = extractProduct(rawText);
        if (product) {
          return {
            name: slotDef.name,
            value: product,
            type: 'product',
            raw: product,
            confidence: 0.65,
            fromContext: false,
          };
        }
        break;
      }
    }

    return null;
  }

  // ─── Dialogue State ──────────────────────────────────────────────────────

  private updateDialogueState(result: ClassifiedIntent): void {
    const intent = this.intents.get(result.intentId);

    // Update context based on intent category
    if (intent && result.confidence >= this.config.minConfidence) {
      const newContext = this.contextFromCategory(intent.category);
      if (newContext !== this.dialogue.currentContext) {
        const old = this.dialogue.currentContext;
        this.dialogue.currentContext = newContext;
        this.emit('context:changed', old, newContext);
      }

      // Update active mode
      const modeIntents = ['inventory.start', 'meeting.start', 'inspection.start'];
      const modeEndIntents = ['inventory.stop', 'meeting.end'];
      if (modeIntents.includes(result.intentId)) {
        const oldMode = this.dialogue.activeMode;
        this.dialogue.activeMode = intent.category;
        if (oldMode !== this.dialogue.activeMode) {
          this.emit('mode:changed', oldMode, this.dialogue.activeMode);
        }
      } else if (modeEndIntents.includes(result.intentId)) {
        const oldMode = this.dialogue.activeMode;
        this.dialogue.activeMode = null;
        if (oldMode !== null) {
          this.emit('mode:changed', oldMode, null);
        }
      }

      // Update expectations
      this.dialogue.expectations = intent.followUpIntents ?? [];

      // Store slots in memory
      for (const [name, slot] of Object.entries(result.slots)) {
        this.dialogue.slotMemory[name] = slot;
      }
    }

    // Add turn
    const turn: DialogueTurn = {
      id: result.turnId,
      timestamp: Date.now(),
      userText: result.rawText,
      classification: result,
      completed: result.missingSlots.length === 0,
    };
    this.dialogue.turns.push(turn);

    // Trim turns
    while (this.dialogue.turns.length > this.config.maxTurns) {
      this.dialogue.turns.shift();
    }

    this.dialogue.lastIntentId = result.intentId;
  }

  private contextFromCategory(category: IntentCategory): string {
    switch (category) {
      case 'inventory': return 'inventory';
      case 'meeting': return 'meeting';
      case 'shopping': return 'shopping';
      case 'social': return 'networking';
      case 'inspection': return 'inspection';
      case 'debug': return 'working';
      case 'translation': return 'traveling';
      default: return this.dialogue.currentContext;
    }
  }

  // ─── Entity Tracking ─────────────────────────────────────────────────────

  trackEntity(entity: RecentEntity): void {
    this.dialogue.recentEntities.push(entity);

    // Trim old entities
    const cutoff = Date.now() - this.config.entityMaxAge;
    this.dialogue.recentEntities = this.dialogue.recentEntities.filter(
      e => e.timestamp >= cutoff,
    );

    // Trim to max size
    while (this.dialogue.recentEntities.length > this.config.maxRecentEntities) {
      this.dialogue.recentEntities.shift();
    }

    this.emit('entity:tracked', entity);
  }

  getRecentEntities(type?: string): RecentEntity[] {
    const cutoff = Date.now() - this.config.entityMaxAge;
    const valid = this.dialogue.recentEntities.filter(e => e.timestamp >= cutoff);
    return type ? valid.filter(e => e.type === type) : valid;
  }

  resolveReference(reference: string): RecentEntity | null {
    const normalized = normalizeText(reference);
    const entities = this.getRecentEntities();

    // "that", "it", "this" — return most recent entity
    if (/\b(that|it|this|the one)\b/.test(normalized)) {
      return entities.length > 0 ? entities[entities.length - 1] : null;
    }

    // "the other one", "the previous one" — return second most recent
    if (/\b(other|previous|last|before)\b/.test(normalized)) {
      return entities.length > 1 ? entities[entities.length - 2] : null;
    }

    // Type-specific: "that person", "that product"
    const typeMap: Record<string, string> = {
      person: 'person',
      product: 'product',
      item: 'product',
      place: 'location',
      sign: 'text',
      document: 'text',
    };
    for (const [word, type] of Object.entries(typeMap)) {
      if (normalized.includes(word)) {
        const typed = entities.filter(e => e.type === type);
        return typed.length > 0 ? typed[typed.length - 1] : null;
      }
    }

    return null;
  }

  // ─── Learning ────────────────────────────────────────────────────────────

  learn(intentId: string, pattern: string): void {
    if (!this.config.enableLearning) return;
    if (!this.intents.has(intentId)) return;

    const patterns = this.learnedPatterns.get(intentId) || [];
    if (patterns.length >= this.config.maxLearnedPatterns) {
      patterns.shift();
    }
    patterns.push(pattern);
    this.learnedPatterns.set(intentId, patterns);

    this.stats.correctionCount++;
    this.emit('correction:learned', intentId, pattern);
  }

  correct(turnId: string, correctIntentId: string): void {
    const turn = this.dialogue.turns.find(t => t.id === turnId);
    if (turn && turn.classification.intentId !== correctIntentId) {
      this.learn(correctIntentId, turn.userText);
    }
  }

  // ─── Context Management ──────────────────────────────────────────────────

  setContext(context: string): void {
    const old = this.dialogue.currentContext;
    if (old !== context) {
      this.dialogue.currentContext = context;
      this.emit('context:changed', old, context);
    }
  }

  getContext(): string {
    return this.dialogue.currentContext;
  }

  getActiveMode(): string | null {
    return this.dialogue.activeMode;
  }

  getDialogueState(): DialogueState {
    return { ...this.dialogue };
  }

  resetDialogue(): void {
    this.dialogue = {
      currentContext: 'idle',
      activeMode: null,
      turns: [],
      slotMemory: {},
      recentEntities: [],
      expectations: [],
      lastIntentId: null,
    };
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  private updateStats(result: ClassifiedIntent, slotsFilled: number, slotsTotal: number): void {
    this.stats.totalClassifications++;
    this.stats.intentCounts[result.intentId] =
      (this.stats.intentCounts[result.intentId] || 0) + 1;

    // Running average confidence
    const n = this.stats.totalClassifications;
    this.stats.avgConfidence =
      (this.stats.avgConfidence * (n - 1) + result.confidence) / n;

    if (result.ambiguous) this.stats.ambiguousCount++;

    // Slot fill rate
    if (slotsTotal > 0) {
      this.stats.slotFillRate =
        (this.stats.slotFillRate * (n - 1) + slotsFilled / slotsTotal) / n;
    }

    // Top intents
    this.stats.topIntents = Object.entries(this.stats.intentCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([id, count]) => ({ id, count }));
  }

  getStats(): NLUStats {
    return { ...this.stats };
  }

  // ─── Voice Summary ───────────────────────────────────────────────────────

  getVoiceSummary(): string {
    const s = this.stats;
    if (s.totalClassifications === 0) return 'No commands processed yet.';

    const parts: string[] = [];
    parts.push(`Processed ${s.totalClassifications} commands.`);
    parts.push(`Average confidence: ${Math.round(s.avgConfidence * 100)}%.`);

    if (this.dialogue.activeMode) {
      parts.push(`Currently in ${this.dialogue.activeMode} mode.`);
    }

    if (s.topIntents.length > 0) {
      parts.push(`Most used: ${s.topIntents[0].id.replace('.', ' ')}.`);
    }

    return parts.join(' ');
  }
}
