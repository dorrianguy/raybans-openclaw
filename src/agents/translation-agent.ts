/**
 * Translation Agent — Deep Translation + Cultural Intelligence
 *
 * Not just translation — full cultural context, etiquette guidance,
 * and communication coaching for international situations.
 *
 * Feature #9 from VISION-FEATURES-SPEC.md
 *
 * Capabilities:
 * - OCR + language detection on any text in view
 * - Full translation with cultural context
 * - Menu translation with dish descriptions
 * - Sign/direction translation with local tips
 * - Cultural etiquette coaching based on location
 * - Business meeting cultural guidance
 * - Voice-friendly TTS output in user's language
 *
 * 🌙 Built by Night Shift Agent
 */

import type { VisionAnalysis } from '../types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface TranslationConfig {
  /** User's preferred language (ISO 639-1, e.g. 'en') */
  preferredLanguage: string;
  /** Translation depth mode */
  defaultMode: TranslationMode;
  /** Include cultural context by default */
  culturalContext: boolean;
  /** Include etiquette notes by default */
  etiquetteNotes: boolean;
  /** Max items in translation history */
  maxHistory: number;
  /** Known languages the user speaks (skip translation for these) */
  knownLanguages: string[];
  /** Current country (ISO 3166-1 alpha-2) for cultural context */
  currentCountry?: string;
}

export type TranslationMode =
  | 'quick'       // Just the translation
  | 'full'        // Translation + cultural notes
  | 'conversation' // Continuous translation assistance
  | 'cultural_coach'; // Etiquette guidance based on situation

export interface TranslationResult {
  id: string;
  /** Original text (source language) */
  originalText: string;
  /** Detected source language */
  sourceLanguage: string;
  /** Source language display name */
  sourceLanguageName: string;
  /** Target language */
  targetLanguage: string;
  /** Translated text */
  translatedText: string;
  /** Cultural context notes */
  culturalNotes?: string[];
  /** Etiquette advice */
  etiquetteTips?: string[];
  /** For menus: dish descriptions */
  menuItems?: MenuTranslation[];
  /** For signs: practical guidance */
  signGuidance?: string;
  /** Confidence 0-1 */
  confidence: number;
  /** Type of content translated */
  contentType: TranslatedContentType;
  /** Timestamp */
  translatedAt: string;
  /** Image ID that was translated */
  imageId?: string;
}

export type TranslatedContentType =
  | 'menu'
  | 'sign'
  | 'document'
  | 'business_card'
  | 'label'
  | 'screen'
  | 'conversation'
  | 'general';

export interface MenuTranslation {
  /** Original dish name */
  originalName: string;
  /** Translated name */
  translatedName: string;
  /** Description of the dish */
  description: string;
  /** Price if visible */
  price?: string;
  /** Dietary info */
  dietary?: string[];
  /** Is it a local specialty? */
  isLocalSpecialty: boolean;
  /** Spice level if applicable */
  spiceLevel?: 'mild' | 'medium' | 'hot' | 'very_hot';
}

export interface CulturalBriefing {
  /** Country/region */
  country: string;
  /** Key etiquette rules */
  etiquette: EtiquetteRule[];
  /** Common phrases to know */
  usefulPhrases: PhraseEntry[];
  /** Tipping customs */
  tippingCustom?: string;
  /** Business meeting norms */
  businessNorms?: string[];
  /** Things to avoid */
  taboos?: string[];
}

export interface EtiquetteRule {
  category: 'greeting' | 'dining' | 'business' | 'social' | 'gesture' | 'dress' | 'general';
  rule: string;
  importance: 'critical' | 'important' | 'helpful';
}

export interface PhraseEntry {
  /** English meaning */
  english: string;
  /** Phrase in local language */
  local: string;
  /** Pronunciation guide */
  pronunciation?: string;
  /** When to use it */
  context: string;
}

export interface TranslationAgentStats {
  totalTranslations: number;
  languagesEncountered: string[];
  menuItemsTranslated: number;
  signsTranslated: number;
  documentsTranslated: number;
  culturalBriefingsGiven: number;
}

// ─── Language Data ──────────────────────────────────────────────

const LANGUAGE_NAMES: Record<string, string> = {
  af: 'Afrikaans', ar: 'Arabic', bg: 'Bulgarian', bn: 'Bengali',
  ca: 'Catalan', cs: 'Czech', cy: 'Welsh', da: 'Danish',
  de: 'German', el: 'Greek', en: 'English', es: 'Spanish',
  et: 'Estonian', fa: 'Persian', fi: 'Finnish', fr: 'French',
  gu: 'Gujarati', he: 'Hebrew', hi: 'Hindi', hr: 'Croatian',
  hu: 'Hungarian', id: 'Indonesian', it: 'Italian', ja: 'Japanese',
  ka: 'Georgian', kn: 'Kannada', ko: 'Korean', lt: 'Lithuanian',
  lv: 'Latvian', mk: 'Macedonian', ml: 'Malayalam', mr: 'Marathi',
  ms: 'Malay', ne: 'Nepali', nl: 'Dutch', no: 'Norwegian',
  pa: 'Punjabi', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian',
  ru: 'Russian', si: 'Sinhala', sk: 'Slovak', sl: 'Slovenian',
  sq: 'Albanian', sr: 'Serbian', sv: 'Swedish', sw: 'Swahili',
  ta: 'Tamil', te: 'Telugu', th: 'Thai', tl: 'Filipino',
  tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', vi: 'Vietnamese',
  zh: 'Chinese', 'zh-TW': 'Chinese (Traditional)',
};

/** Cultural briefings for common travel destinations */
const CULTURAL_DATABASE: Record<string, CulturalBriefing> = {
  JP: {
    country: 'Japan',
    etiquette: [
      { category: 'greeting', rule: 'Bow when greeting. Deeper bows show more respect.', importance: 'critical' },
      { category: 'business', rule: 'Exchange business cards with both hands. Study the card before putting it away.', importance: 'critical' },
      { category: 'dining', rule: 'Never stick chopsticks upright in rice — it resembles funeral incense.', importance: 'critical' },
      { category: 'social', rule: 'Remove shoes when entering homes, temples, and many restaurants.', importance: 'critical' },
      { category: 'dining', rule: 'Slurping noodles is considered polite and shows enjoyment.', importance: 'helpful' },
      { category: 'gesture', rule: 'Pointing with your finger is rude. Use an open hand to gesture.', importance: 'important' },
      { category: 'social', rule: 'Speaking loudly on trains and in public is considered very rude.', importance: 'important' },
    ],
    usefulPhrases: [
      { english: 'Thank you', local: 'ありがとうございます', pronunciation: 'Arigatou gozaimasu', context: 'Polite thank you — use everywhere' },
      { english: 'Excuse me', local: 'すみません', pronunciation: 'Sumimasen', context: 'Getting attention, apologizing, or passing by' },
      { english: 'How much?', local: 'いくらですか', pronunciation: 'Ikura desu ka', context: 'Asking price at shops and restaurants' },
      { english: 'Delicious!', local: 'おいしい', pronunciation: 'Oishii', context: 'Complimenting food — chefs love hearing this' },
      { english: 'I don\'t understand', local: 'わかりません', pronunciation: 'Wakarimasen', context: 'When lost in conversation' },
    ],
    tippingCustom: 'Do NOT tip in Japan. It can be considered rude or confusing. Service is included.',
    businessNorms: [
      'Exchange cards with both hands, Japanese text facing the recipient',
      'Study the card carefully before putting it in a cardholder (never your pocket)',
      'Seniority matters — address the highest-ranking person first',
      'Silence in meetings is normal and shows contemplation, not disagreement',
      'Decisions often happen outside formal meetings (nemawashi)',
    ],
    taboos: [
      'Blowing your nose in public (step away)',
      'Tipping at restaurants',
      'Walking and eating simultaneously',
      'Wearing shoes indoors',
    ],
  },
  KR: {
    country: 'South Korea',
    etiquette: [
      { category: 'dining', rule: 'The eldest person starts eating first. Wait for them.', importance: 'critical' },
      { category: 'social', rule: 'Use both hands when giving/receiving anything from elders.', importance: 'critical' },
      { category: 'dining', rule: 'Never pour your own drink. Others pour for you, and you pour for them.', importance: 'important' },
      { category: 'business', rule: 'Age and hierarchy are very important. Address people by title + family name.', importance: 'critical' },
      { category: 'gesture', rule: 'Beckon with palm down, not up (palm up is for dogs).', importance: 'important' },
    ],
    usefulPhrases: [
      { english: 'Thank you', local: '감사합니다', pronunciation: 'Gamsahamnida', context: 'Formal thank you' },
      { english: 'Hello', local: '안녕하세요', pronunciation: 'Annyeonghaseyo', context: 'Standard polite greeting' },
      { english: 'How much?', local: '얼마에요?', pronunciation: 'Eolmayeyo?', context: 'Asking prices' },
      { english: 'Delicious!', local: '맛있어요!', pronunciation: 'Mashisseoyo!', context: 'Complimenting food' },
    ],
    tippingCustom: 'Tipping is not customary in Korea and can sometimes cause confusion.',
    businessNorms: [
      'Soju (drinking) is central to business bonding',
      'Business cards with both hands',
      'Age/seniority hierarchy strictly observed',
    ],
    taboos: [
      'Writing someone\'s name in red ink (associated with death)',
      'Refusing a drink from a superior without explanation',
    ],
  },
  CN: {
    country: 'China',
    etiquette: [
      { category: 'business', rule: 'Present business cards with both hands, Chinese text facing up.', importance: 'critical' },
      { category: 'dining', rule: 'The host orders and pays. Do not fight over the bill — offer once, then accept gracefully.', importance: 'important' },
      { category: 'social', rule: 'Avoid discussing politics, Tibet, Taiwan, or Tiananmen.', importance: 'critical' },
      { category: 'gesture', rule: 'The number 4 is unlucky (sounds like "death"). Avoid giving 4 of anything.', importance: 'important' },
      { category: 'greeting', rule: 'Handshakes are common in business. Slight nod shows respect.', importance: 'helpful' },
    ],
    usefulPhrases: [
      { english: 'Thank you', local: '谢谢', pronunciation: 'Xièxie', context: 'Universal thank you' },
      { english: 'Hello', local: '你好', pronunciation: 'Nǐ hǎo', context: 'Standard greeting' },
      { english: 'How much?', local: '多少钱?', pronunciation: 'Duōshao qián?', context: 'Asking price' },
      { english: 'Delicious!', local: '好吃!', pronunciation: 'Hǎo chī!', context: 'Complimenting food' },
    ],
    tippingCustom: 'Tipping is not traditional in China. Some upscale Western hotels may accept tips.',
    taboos: [
      'Sticking chopsticks upright in rice',
      'Giving clocks as gifts (sounds like "funeral")',
      'Wrapping gifts in white (mourning color)',
    ],
  },
  FR: {
    country: 'France',
    etiquette: [
      { category: 'greeting', rule: 'Greet with "Bonjour" when entering any shop or restaurant. It\'s considered rude not to.', importance: 'critical' },
      { category: 'dining', rule: 'Bread goes directly on the table, not on the plate. Tear it, don\'t cut it.', importance: 'helpful' },
      { category: 'social', rule: 'La bise (cheek kisses) varies by region: 1-4 kisses. Follow their lead.', importance: 'important' },
      { category: 'dining', rule: 'Don\'t ask for ketchup or modifications at a nice restaurant.', importance: 'important' },
      { category: 'business', rule: 'Be on time but expect meetings to run long. Relationships matter more than agendas.', importance: 'helpful' },
    ],
    usefulPhrases: [
      { english: 'Hello', local: 'Bonjour', pronunciation: 'Bohn-ZHOOR', context: 'Use EVERY time you enter a shop' },
      { english: 'Thank you', local: 'Merci', pronunciation: 'Mair-SEE', context: 'Basic thanks' },
      { english: 'Please', local: 'S\'il vous plaît', pronunciation: 'See voo PLAY', context: 'Very important — always say please' },
      { english: 'The bill, please', local: 'L\'addition, s\'il vous plaît', pronunciation: 'Lah-dee-SYOHN see voo PLAY', context: 'Waiters won\'t bring it until asked' },
    ],
    tippingCustom: 'Service is included (service compris). Small extra tip (1-2€) appreciated but not expected.',
    taboos: [
      'Speaking English loudly without first trying French',
      'Discussing money or salary',
      'Rushing through meals',
    ],
  },
  DE: {
    country: 'Germany',
    etiquette: [
      { category: 'business', rule: 'Punctuality is sacred. Being 5 minutes late is considered rude.', importance: 'critical' },
      { category: 'greeting', rule: 'Use formal "Sie" (you) until invited to use informal "du".', importance: 'important' },
      { category: 'dining', rule: 'Keep hands visible on the table (not in your lap) while eating.', importance: 'helpful' },
      { category: 'social', rule: 'Recycling is serious. Learn the color-coded bin system.', importance: 'helpful' },
    ],
    usefulPhrases: [
      { english: 'Thank you', local: 'Danke', pronunciation: 'DAHN-kuh', context: 'Basic thanks' },
      { english: 'Hello', local: 'Hallo', pronunciation: 'HAH-loh', context: 'Casual greeting' },
      { english: 'Please', local: 'Bitte', pronunciation: 'BIT-uh', context: 'Also means "you\'re welcome"' },
      { english: 'The bill, please', local: 'Die Rechnung, bitte', pronunciation: 'Dee REKH-noong BIT-uh', context: 'At restaurants' },
    ],
    tippingCustom: 'Round up to nearest euro or add 5-10%. Say the total amount you want to pay including tip.',
  },
  MX: {
    country: 'Mexico',
    etiquette: [
      { category: 'greeting', rule: 'Greetings are warm — expect handshakes, hugs, or cheek kisses depending on familiarity.', importance: 'important' },
      { category: 'dining', rule: 'Meals are social events. Lunch is the main meal (2-4 PM) and can last 2+ hours.', importance: 'helpful' },
      { category: 'social', rule: '"Mañana" doesn\'t literally mean tomorrow — it means "not right now."', importance: 'helpful' },
      { category: 'business', rule: 'Personal relationships precede business. Expect small talk before getting to work.', importance: 'important' },
    ],
    usefulPhrases: [
      { english: 'Thank you', local: 'Gracias', pronunciation: 'GRAH-see-ahs', context: 'Universal' },
      { english: 'How much?', local: '¿Cuánto cuesta?', pronunciation: 'KWAHN-toh KWES-tah', context: 'Asking price' },
      { english: 'The bill, please', local: 'La cuenta, por favor', pronunciation: 'Lah KWEN-tah por fah-VOR', context: 'At restaurants' },
      { english: 'Where is...?', local: '¿Dónde está...?', pronunciation: 'DOHN-day es-TAH', context: 'Asking directions' },
    ],
    tippingCustom: '10-15% at restaurants. Propinas are appreciated by service workers everywhere.',
  },
  IT: {
    country: 'Italy',
    etiquette: [
      { category: 'dining', rule: 'Never order cappuccino after 11 AM. Espresso is the afternoon coffee.', importance: 'important' },
      { category: 'dining', rule: 'No parmesan on seafood pasta. Ever.', importance: 'important' },
      { category: 'social', rule: '"La bella figura" — Italians care deeply about appearance and impression.', importance: 'helpful' },
      { category: 'greeting', rule: 'Two cheek kisses are standard among friends. Right cheek first.', importance: 'helpful' },
    ],
    usefulPhrases: [
      { english: 'Thank you', local: 'Grazie', pronunciation: 'GRAH-tsee-eh', context: 'Universal' },
      { english: 'The bill, please', local: 'Il conto, per favore', pronunciation: 'Eel KOHN-toh pair fah-VOH-reh', context: 'At restaurants' },
      { english: 'Delicious!', local: 'Buonissimo!', pronunciation: 'Bwoh-NEE-see-moh', context: 'Complimenting food' },
    ],
    tippingCustom: '"Coperto" (cover charge) is usually included. Small tip (1-2€) appreciated but not expected.',
  },
  BR: {
    country: 'Brazil',
    etiquette: [
      { category: 'social', rule: 'Brazilians are very physical — expect close proximity, touching, and hugs.', importance: 'important' },
      { category: 'gesture', rule: 'The "OK" hand sign (thumb + index circle) is VERY offensive in Brazil.', importance: 'critical' },
      { category: 'dining', rule: 'Meals are social and can last hours. Don\'t rush.', importance: 'helpful' },
    ],
    usefulPhrases: [
      { english: 'Thank you', local: 'Obrigado (m) / Obrigada (f)', pronunciation: 'Oh-bree-GAH-doo / Oh-bree-GAH-dah', context: 'Gender-specific!' },
      { english: 'Hello', local: 'Oi!', pronunciation: 'Oy', context: 'Casual, friendly greeting' },
      { english: 'How much?', local: 'Quanto custa?', pronunciation: 'KWAHN-too KOOS-tah', context: 'Asking price' },
    ],
    tippingCustom: '10% is usually included on the bill ("10% de serviço"). Additional tip appreciated.',
  },
  IN: {
    country: 'India',
    etiquette: [
      { category: 'social', rule: 'Use your right hand for eating, giving, and receiving. Left hand is considered unclean.', importance: 'critical' },
      { category: 'greeting', rule: '"Namaste" with palms together is a respectful greeting.', importance: 'important' },
      { category: 'social', rule: 'Remove shoes before entering homes and temples.', importance: 'critical' },
      { category: 'dining', rule: 'Many Indians are vegetarian. Ask before assuming what someone eats.', importance: 'important' },
      { category: 'gesture', rule: 'Head wobble doesn\'t mean "no" — it usually means agreement or acknowledgment.', importance: 'helpful' },
    ],
    usefulPhrases: [
      { english: 'Hello', local: 'नमस्ते', pronunciation: 'Nuh-MUS-tay', context: 'Universal respectful greeting' },
      { english: 'Thank you', local: 'धन्यवाद', pronunciation: 'Dun-yuh-VAHD', context: 'Formal thanks (in Hindi)' },
      { english: 'How much?', local: 'कितना है?', pronunciation: 'Kit-NAH hai?', context: 'Asking price' },
    ],
    tippingCustom: '10% at restaurants. Small tips for rickshaw drivers and hotel staff appreciated.',
  },
  TH: {
    country: 'Thailand',
    etiquette: [
      { category: 'social', rule: 'Never touch someone\'s head — it\'s the most sacred part of the body.', importance: 'critical' },
      { category: 'social', rule: 'Never point your feet at people or Buddha images.', importance: 'critical' },
      { category: 'social', rule: 'The Royal Family is deeply revered. Lèse-majesté is a criminal offense.', importance: 'critical' },
      { category: 'greeting', rule: 'The "wai" (palms together with slight bow) is the standard greeting.', importance: 'important' },
      { category: 'dress', rule: 'Cover shoulders and knees when visiting temples.', importance: 'critical' },
    ],
    usefulPhrases: [
      { english: 'Thank you', local: 'ขอบคุณ', pronunciation: 'Khob khun (ka/krap)', context: 'Add ka (female) or krap (male)' },
      { english: 'Hello', local: 'สวัสดี', pronunciation: 'Sawadee (ka/krap)', context: 'Standard greeting with gender particle' },
      { english: 'How much?', local: 'เท่าไหร่?', pronunciation: 'Tao rai?', context: 'Asking price — essential for markets' },
    ],
    tippingCustom: 'Not expected but appreciated. Round up at restaurants. 20-50 baht for good service.',
  },
};

// ─── Language Detection ─────────────────────────────────────────

interface LanguageSignature {
  code: string;
  patterns: RegExp[];
  /** Unique characters/scripts that identify this language */
  scriptTest?: RegExp;
}

const LANGUAGE_SIGNATURES: LanguageSignature[] = [
  // CJK languages (script-based detection)
  { code: 'ja', patterns: [/[\u3040-\u309F]/], scriptTest: /[\u3040-\u309F\u30A0-\u30FF]/ }, // Hiragana/Katakana
  { code: 'zh', patterns: [/[\u4E00-\u9FFF]/], scriptTest: /[\u4E00-\u9FFF]/ }, // CJK unified
  { code: 'ko', patterns: [/[\uAC00-\uD7AF]/], scriptTest: /[\uAC00-\uD7AF\u1100-\u11FF]/ }, // Hangul
  // Arabic script
  { code: 'ar', patterns: [/[\u0600-\u06FF]/], scriptTest: /[\u0600-\u06FF]/ },
  // Devanagari (Hindi)
  { code: 'hi', patterns: [/[\u0900-\u097F]/], scriptTest: /[\u0900-\u097F]/ },
  // Thai
  { code: 'th', patterns: [/[\u0E00-\u0E7F]/], scriptTest: /[\u0E00-\u0E7F]/ },
  // Cyrillic (Russian)
  { code: 'ru', patterns: [/[\u0400-\u04FF]/], scriptTest: /[\u0400-\u04FF]/ },
  // Greek
  { code: 'el', patterns: [/[\u0370-\u03FF]/], scriptTest: /[\u0370-\u03FF]/ },
  // Hebrew
  { code: 'he', patterns: [/[\u0590-\u05FF]/], scriptTest: /[\u0590-\u05FF]/ },
  // Georgian
  { code: 'ka', patterns: [/[\u10A0-\u10FF]/], scriptTest: /[\u10A0-\u10FF]/ },
  // Tamil
  { code: 'ta', patterns: [/[\u0B80-\u0BFF]/], scriptTest: /[\u0B80-\u0BFF]/ },
  // Telugu
  { code: 'te', patterns: [/[\u0C00-\u0C7F]/], scriptTest: /[\u0C00-\u0C7F]/ },
  // Latin-based (use word/pattern heuristics)
  { code: 'de', patterns: [/\b(und|der|die|das|ist|ein|nicht|ich|mit|für|auf|sich|den|des|dem|werden)\b/i] },
  { code: 'fr', patterns: [/\b(les|des|une|est|pas|que|pour|dans|avec|sur|sont|mais|tout|cette|nous)\b/i] },
  { code: 'es', patterns: [/\b(los|las|una|del|por|con|para|está|pero|más|como|todo|esta|han|muy)\b/i] },
  { code: 'it', patterns: [/\b(gli|del|per|che|una|con|sono|anche|dalla|tutto|questa|molto|nella|hanno)\b/i] },
  { code: 'pt', patterns: [/\b(dos|das|uma|para|com|não|mais|como|está|são|pela|todo|essa|muito|também)\b/i] },
  { code: 'nl', patterns: [/\b(het|een|van|dat|met|voor|niet|ook|maar|zijn|nog|bij|dit|uit|wel)\b/i] },
  { code: 'sv', patterns: [/\b(och|det|att|för|med|den|som|har|var|inte|ett|kan|ska|till|från)\b/i] },
  { code: 'pl', patterns: [/\b(nie|jest|się|jak|ale|był|tak|już|jeszcze|tylko|jego|może|przez|bardzo)\b/i] },
  { code: 'tr', patterns: [/\b(bir|ve|bu|ile|için|var|olarak|daha|olan|ancak|gibi|ise|çok|kadar|sonra)\b/i] },
  { code: 'vi', patterns: [/\b(của|và|là|cho|với|không|một|được|có|trong|này|người|đã|những)\b/i] },
];

/**
 * Detect language from text using script and pattern analysis.
 * Returns ISO 639-1 code and confidence score.
 */
export function detectLanguage(text: string): { code: string; confidence: number } {
  if (!text || text.trim().length === 0) {
    return { code: 'unknown', confidence: 0 };
  }

  const cleaned = text.trim();

  // First check script-based languages (most reliable)
  for (const sig of LANGUAGE_SIGNATURES) {
    if (sig.scriptTest && sig.scriptTest.test(cleaned)) {
      // Count characters matching this script
      const matches = cleaned.match(new RegExp(sig.scriptTest.source, 'g'));
      const ratio = (matches?.length ?? 0) / cleaned.replace(/\s/g, '').length;
      if (ratio > 0.1) {
        return { code: sig.code, confidence: Math.min(0.95, 0.5 + ratio) };
      }
    }
  }

  // For Latin-script languages, use word pattern matching
  const words = cleaned.toLowerCase().split(/\s+/);
  const scores: Record<string, number> = {};

  for (const sig of LANGUAGE_SIGNATURES) {
    if (sig.scriptTest) continue; // Skip script-based (already checked)
    let matchCount = 0;
    for (const pattern of sig.patterns) {
      for (const word of words) {
        if (pattern.test(word)) matchCount++;
      }
    }
    if (matchCount > 0) {
      scores[sig.code] = matchCount / words.length;
    }
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0.05) {
    return { code: best[0], confidence: Math.min(0.9, 0.3 + best[1] * 2) };
  }

  // Default to English for Latin text with no strong signal
  if (/^[a-zA-Z\s\d.,!?'"()-]+$/.test(cleaned)) {
    return { code: 'en', confidence: 0.5 };
  }

  return { code: 'unknown', confidence: 0 };
}

/**
 * Get the display name for a language code.
 */
export function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

// ─── Content Classification ─────────────────────────────────────

const MENU_PATTERNS = [
  /\bmenu\b/i, /\bmenú\b/i, /\bkarte\b/i, /\bcarte\b/i,
  /appetizer|entrée|dessert|beverage|soup|salad|main course/i,
  /前菜|メニュー|デザート|飲み物/,  // Japanese
  /菜单|开胃菜|甜点|饮料/,          // Chinese
  /\$\d+|\d+\s*(USD|EUR|GBP|JPY|CNY|KRW|THB|MXN)/i,
];

const SIGN_PATTERNS = [
  /\b(exit|entrance|stop|warning|caution|danger|parking|restroom|toilet)\b/i,
  /出口|入口|注意|危険|トイレ/,     // Japanese
  /出口|入口|注意|危险|厕所/,        // Chinese
  /salida|entrada|peligro|baño/i,   // Spanish
  /sortie|entrée|attention|toilettes/i, // French
  /ausgang|eingang|achtung|toilette/i,  // German
  /→|←|↑|↓|⬆|⬇|⬅|➡/,
];

/**
 * Classify what type of content was translated.
 */
export function classifyContent(text: string, analysis?: VisionAnalysis): TranslatedContentType {
  const lower = text.toLowerCase();

  // Check for menu patterns
  const menuScore = MENU_PATTERNS.reduce((score, p) => score + (p.test(text) ? 1 : 0), 0);
  if (menuScore >= 2) return 'menu';

  // Check for sign patterns
  const signScore = SIGN_PATTERNS.reduce((score, p) => score + (p.test(text) ? 1 : 0), 0);
  if (signScore >= 1) return 'sign';

  // Use vision analysis scene type if available
  if (analysis) {
    if (analysis.sceneType === 'document') return 'document';
    if (analysis.sceneType === 'screen') return 'screen';
    if (analysis.sceneType === 'person') return 'business_card';
  }

  // Check for document-like structure
  if (/article|section|clause|agreement|contract|policy/i.test(lower)) return 'document';

  // Check for product label patterns
  if (/ingredients|nutrition|net\s*w[t|eight]/i.test(lower)) return 'label';

  return 'general';
}

// ─── Menu Parser ────────────────────────────────────────────────

/**
 * Parse menu items from OCR text.
 * Looks for patterns like "dish name ... price" or numbered items.
 */
export function parseMenuItems(text: string): Array<{ name: string; price?: string }> {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const items: Array<{ name: string; price?: string }> = [];

  for (const line of lines) {
    // Skip obvious non-menu lines
    if (/^\s*(menu|carte|menú|karte|specials?|desserts?|beverages?|appetizers?)\s*$/i.test(line)) continue;

    // Pattern: "Item name ... $12.99" or "Item name 12.99"
    const priceMatch = line.match(/^(.+?)[\s.…_-]*(\$?\d+[.,]\d{2})\s*$/);
    if (priceMatch) {
      const name = priceMatch[1].replace(/[\s.…_-]+$/, '').trim();
      if (name.length > 1) {
        items.push({ name, price: priceMatch[2] });
      }
      continue;
    }

    // Pattern: numbered items "1. Dish name"
    const numberedMatch = line.match(/^\d+[.)\s]+(.+)/);
    if (numberedMatch) {
      const name = numberedMatch[1].trim();
      if (name.length > 1) {
        items.push({ name });
      }
      continue;
    }

    // Lines that look like dish names (reasonable length, no obvious noise)
    if (line.length > 3 && line.length < 80 && !/^[=\-*_]+$/.test(line)) {
      // Check if it could be a dish name (contains letters, not just numbers/symbols)
      if (/[a-zA-Z\u3000-\u9FFF\uAC00-\uD7AF]/.test(line)) {
        items.push({ name: line });
      }
    }
  }

  return items;
}

// ─── Translation Agent ──────────────────────────────────────────

const DEFAULT_CONFIG: TranslationConfig = {
  preferredLanguage: 'en',
  defaultMode: 'full',
  culturalContext: true,
  etiquetteNotes: true,
  maxHistory: 500,
  knownLanguages: ['en'],
};

export class TranslationAgent {
  private config: TranslationConfig;
  private history: TranslationResult[] = [];
  private stats: TranslationAgentStats = {
    totalTranslations: 0,
    languagesEncountered: [],
    menuItemsTranslated: 0,
    signsTranslated: 0,
    documentsTranslated: 0,
    culturalBriefingsGiven: 0,
  };

  constructor(config: Partial<TranslationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Handle a vision analysis result — detect and translate any foreign text.
   */
  async handle(
    _image: Buffer,
    analysis: VisionAnalysis,
    context?: { mode?: TranslationMode; country?: string }
  ): Promise<TranslationResult | null> {
    // Gather all extracted text
    const allText = analysis.extractedText
      .map(t => t.text)
      .join('\n')
      .trim();

    if (!allText) return null;

    // Detect language
    const detected = detectLanguage(allText);

    // Skip if the text is in a language the user knows
    if (this.config.knownLanguages.includes(detected.code)) {
      return null;
    }

    // Classify the content type
    const contentType = classifyContent(allText, analysis);

    // Build translation result
    const mode = context?.mode ?? this.config.defaultMode;
    const country = context?.country ?? this.config.currentCountry;

    const result = this.buildTranslation(
      allText,
      detected.code,
      contentType,
      mode,
      country,
      analysis
    );

    // Update stats
    this.updateStats(result);

    // Add to history
    this.history.unshift(result);
    if (this.history.length > this.config.maxHistory) {
      this.history = this.history.slice(0, this.config.maxHistory);
    }

    return result;
  }

  /**
   * Build a translation result (in production this would call a translation API;
   * for now it structures the detected content for the vision model to translate).
   */
  private buildTranslation(
    text: string,
    sourceLang: string,
    contentType: TranslatedContentType,
    mode: TranslationMode,
    country?: string,
    analysis?: VisionAnalysis,
  ): TranslationResult {
    const id = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result: TranslationResult = {
      id,
      originalText: text,
      sourceLanguage: sourceLang,
      sourceLanguageName: getLanguageName(sourceLang),
      targetLanguage: this.config.preferredLanguage,
      translatedText: '', // Would be filled by translation API/model
      confidence: 0.85,
      contentType,
      translatedAt: new Date().toISOString(),
      imageId: analysis?.imageId,
    };

    // Add cultural context if enabled
    if ((mode === 'full' || mode === 'cultural_coach') && this.config.culturalContext && country) {
      const briefing = this.getCulturalBriefing(country);
      if (briefing) {
        result.culturalNotes = briefing.etiquette
          .filter(e => e.importance === 'critical' || e.importance === 'important')
          .map(e => e.rule);
        result.etiquetteTips = briefing.etiquette
          .filter(e => this.isRelevantEtiquette(e, contentType))
          .map(e => e.rule);
      }
    }

    // Parse menu items if applicable
    if (contentType === 'menu') {
      const menuItems = parseMenuItems(text);
      result.menuItems = menuItems.map(item => ({
        originalName: item.name,
        translatedName: '', // Would be filled by translation
        description: '',    // Would be filled by translation
        price: item.price,
        isLocalSpecialty: false,
      }));
    }

    // Add sign guidance if applicable
    if (contentType === 'sign') {
      result.signGuidance = this.buildSignGuidance(text);
    }

    return result;
  }

  /**
   * Check if an etiquette rule is relevant to the current content type.
   */
  private isRelevantEtiquette(rule: EtiquetteRule, contentType: TranslatedContentType): boolean {
    if (contentType === 'menu' && rule.category === 'dining') return true;
    if (contentType === 'business_card' && rule.category === 'business') return true;
    if (contentType === 'sign' && rule.category === 'general') return true;
    if (contentType === 'document' && rule.category === 'business') return true;
    return false;
  }

  /**
   * Build practical guidance for translated signs.
   */
  private buildSignGuidance(text: string): string {
    const lower = text.toLowerCase();
    const guidance: string[] = [];

    if (/exit|sortie|salida|ausgang|出口/i.test(lower)) {
      guidance.push('This is an exit sign.');
    }
    if (/entrance|entrée|entrada|eingang|入口/i.test(lower)) {
      guidance.push('This is an entrance.');
    }
    if (/warning|attention|achtung|注意|caution|danger|peligro|危[険险]/i.test(lower)) {
      guidance.push('⚠️ Warning/caution sign — be alert.');
    }
    if (/restroom|toilet|baño|toilette|トイレ|厕所|화장실/i.test(lower)) {
      guidance.push('Restroom/toilet nearby.');
    }
    if (/parking|estacionamiento|parkplatz|駐車場/i.test(lower)) {
      guidance.push('Parking information.');
    }
    if (/no\s*(smoking|fumar|rauchen)|禁煙|禁烟/i.test(lower)) {
      guidance.push('No smoking area.');
    }

    return guidance.length > 0 ? guidance.join(' ') : 'Sign detected — refer to translation above.';
  }

  /**
   * Get a cultural briefing for a country.
   */
  getCulturalBriefing(countryCode: string): CulturalBriefing | null {
    return CULTURAL_DATABASE[countryCode.toUpperCase()] ?? null;
  }

  /**
   * Get all available cultural briefings.
   */
  getAvailableCountries(): string[] {
    return Object.keys(CULTURAL_DATABASE);
  }

  /**
   * Get useful phrases for a country.
   */
  getUsefulPhrases(countryCode: string): PhraseEntry[] {
    const briefing = this.getCulturalBriefing(countryCode);
    return briefing?.usefulPhrases ?? [];
  }

  /**
   * Generate a TTS-friendly voice summary of a translation.
   */
  generateVoiceSummary(result: TranslationResult): string {
    const parts: string[] = [];

    // Language identification
    parts.push(`This is ${result.sourceLanguageName}.`);

    // For menus
    if (result.contentType === 'menu' && result.menuItems && result.menuItems.length > 0) {
      parts.push(`I found ${result.menuItems.length} menu items.`);
      // Highlight first 3 items
      const preview = result.menuItems.slice(0, 3);
      for (const item of preview) {
        const priceNote = item.price ? ` for ${item.price}` : '';
        if (item.translatedName) {
          parts.push(`${item.originalName} is ${item.translatedName}${priceNote}.`);
        } else {
          parts.push(`${item.originalName}${priceNote}.`);
        }
        if (item.isLocalSpecialty) {
          parts.push('That\'s a local specialty — worth trying!');
        }
      }
      if (result.menuItems.length > 3) {
        parts.push(`Plus ${result.menuItems.length - 3} more items.`);
      }
    }

    // For signs
    if (result.contentType === 'sign' && result.signGuidance) {
      parts.push(result.signGuidance);
    }

    // General translation
    if (result.translatedText) {
      parts.push(`Translation: ${result.translatedText}`);
    }

    // Cultural tips (just the most critical one)
    if (result.etiquetteTips && result.etiquetteTips.length > 0) {
      parts.push(`Tip: ${result.etiquetteTips[0]}`);
    }

    return parts.join(' ');
  }

  /**
   * Get translation history.
   */
  getHistory(limit: number = 20): TranslationResult[] {
    return this.history.slice(0, limit);
  }

  /**
   * Search translation history.
   */
  searchHistory(query: string): TranslationResult[] {
    const lower = query.toLowerCase();
    return this.history.filter(
      r => r.originalText.toLowerCase().includes(lower) ||
           r.translatedText.toLowerCase().includes(lower) ||
           r.sourceLanguageName.toLowerCase().includes(lower)
    );
  }

  /**
   * Get agent statistics.
   */
  getStats(): TranslationAgentStats {
    return { ...this.stats };
  }

  /**
   * Update the current country (for cultural context).
   */
  setCountry(countryCode: string): void {
    this.config.currentCountry = countryCode.toUpperCase();
  }

  /**
   * Add a known language (won't translate text in this language).
   */
  addKnownLanguage(langCode: string): void {
    if (!this.config.knownLanguages.includes(langCode)) {
      this.config.knownLanguages.push(langCode);
    }
  }

  /**
   * Set the translation mode.
   */
  setMode(mode: TranslationMode): void {
    this.config.defaultMode = mode;
  }

  /**
   * Clear history.
   */
  clearHistory(): void {
    this.history = [];
  }

  private updateStats(result: TranslationResult): void {
    this.stats.totalTranslations++;

    if (!this.stats.languagesEncountered.includes(result.sourceLanguage)) {
      this.stats.languagesEncountered.push(result.sourceLanguage);
    }

    switch (result.contentType) {
      case 'menu':
        this.stats.menuItemsTranslated += result.menuItems?.length ?? 0;
        break;
      case 'sign':
        this.stats.signsTranslated++;
        break;
      case 'document':
        this.stats.documentsTranslated++;
        break;
    }

    if (result.culturalNotes && result.culturalNotes.length > 0) {
      this.stats.culturalBriefingsGiven++;
    }
  }
}
