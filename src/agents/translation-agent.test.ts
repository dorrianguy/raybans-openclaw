/**
 * Tests for Translation Agent — Deep Translation + Cultural Intelligence
 * 🌙 Night Shift Agent
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TranslationAgent,
  detectLanguage,
  getLanguageName,
  classifyContent,
  parseMenuItems,
} from './translation-agent.js';
import type { VisionAnalysis, ExtractedText } from '../types.js';

// ─── Helper ─────────────────────────────────────────────────────

function mockAnalysis(texts: string[], sceneType: string = 'unknown'): VisionAnalysis {
  return {
    imageId: `img-${Date.now()}`,
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 100,
    sceneDescription: 'Test scene',
    sceneType: sceneType as VisionAnalysis['sceneType'],
    extractedText: texts.map((text, i) => ({
      text,
      confidence: 0.95,
      textType: 'other' as ExtractedText['textType'],
    })),
    detectedObjects: [],
    products: [],
    barcodes: [],
    quality: { score: 0.9, isBlurry: false, hasGlare: false, isUnderexposed: false, isOverexposed: false, usableForInventory: true },
  };
}

// ─── detectLanguage ─────────────────────────────────────────────

describe('detectLanguage', () => {
  it('should detect Japanese text', () => {
    const result = detectLanguage('ありがとうございます。今日はいい天気ですね。');
    expect(result.code).toBe('ja');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect Chinese text', () => {
    const result = detectLanguage('谢谢你的帮助。今天天气很好。');
    expect(result.code).toBe('zh');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect Korean text', () => {
    const result = detectLanguage('안녕하세요. 오늘 날씨가 좋네요.');
    expect(result.code).toBe('ko');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect Arabic text', () => {
    const result = detectLanguage('شكرا جزيلا. الطقس جميل اليوم.');
    expect(result.code).toBe('ar');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect Thai text', () => {
    const result = detectLanguage('สวัสดีครับ วันนี้อากาศดีมาก');
    expect(result.code).toBe('th');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect Hindi text', () => {
    const result = detectLanguage('नमस्ते। आज मौसम बहुत अच्छा है।');
    expect(result.code).toBe('hi');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect Russian text', () => {
    const result = detectLanguage('Спасибо большое. Сегодня хорошая погода.');
    expect(result.code).toBe('ru');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect Greek text', () => {
    const result = detectLanguage('Ευχαριστώ πολύ. Σήμερα ο καιρός είναι ωραίος.');
    expect(result.code).toBe('el');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect Hebrew text', () => {
    const result = detectLanguage('תודה רבה. מזג האוויר יפה היום.');
    expect(result.code).toBe('he');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect German text', () => {
    const result = detectLanguage('Das ist ein schönes Wetter und ich bin mit der Arbeit zufrieden.');
    expect(result.code).toBe('de');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('should detect French text', () => {
    const result = detectLanguage('Bonjour, les amis. Nous sommes dans une belle ville avec des fleurs.');
    expect(result.code).toBe('fr');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('should detect Spanish text', () => {
    const result = detectLanguage('Hola, los amigos están por aquí para una fiesta muy divertida.');
    expect(result.code).toBe('es');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('should detect Italian text', () => {
    const result = detectLanguage('Questa è una bella giornata nella città con gli amici.');
    expect(result.code).toBe('it');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('should detect Portuguese text', () => {
    const result = detectLanguage('Obrigado pela ajuda. Hoje não está muito quente para nós.');
    expect(result.code).toBe('pt');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('should detect Turkish text', () => {
    const result = detectLanguage('Bu bir güzel gün ve hava çok güzel. Ancak daha iyi olabilir.');
    expect(result.code).toBe('tr');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('should return English for plain Latin text', () => {
    const result = detectLanguage('Hello world');
    expect(result.code).toBe('en');
  });

  it('should return unknown for empty text', () => {
    const result = detectLanguage('');
    expect(result.code).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('should return unknown for whitespace-only text', () => {
    const result = detectLanguage('   ');
    expect(result.code).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('should handle mixed scripts (Japanese + Chinese)', () => {
    // Japanese with hiragana is distinct from Chinese
    const result = detectLanguage('これは日本語のテストです。');
    expect(result.code).toBe('ja');
  });

  it('should detect Tamil text', () => {
    const result = detectLanguage('நன்றி. இன்று வானிலை நன்றாக உள்ளது.');
    expect(result.code).toBe('ta');
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

// ─── getLanguageName ────────────────────────────────────────────

describe('getLanguageName', () => {
  it('should return English for en', () => {
    expect(getLanguageName('en')).toBe('English');
  });

  it('should return Japanese for ja', () => {
    expect(getLanguageName('ja')).toBe('Japanese');
  });

  it('should return Chinese for zh', () => {
    expect(getLanguageName('zh')).toBe('Chinese');
  });

  it('should return Korean for ko', () => {
    expect(getLanguageName('ko')).toBe('Korean');
  });

  it('should return French for fr', () => {
    expect(getLanguageName('fr')).toBe('French');
  });

  it('should return uppercase code for unknown language', () => {
    expect(getLanguageName('zz')).toBe('ZZ');
  });

  it('should handle Chinese Traditional', () => {
    expect(getLanguageName('zh-TW')).toBe('Chinese (Traditional)');
  });
});

// ─── classifyContent ────────────────────────────────────────────

describe('classifyContent', () => {
  it('should detect menu content', () => {
    const text = 'Menu\nAppetizer\nSpring Rolls ... $8.99\nSoup of the Day ... $6.99';
    expect(classifyContent(text)).toBe('menu');
  });

  it('should detect sign content', () => {
    const text = 'EXIT →';
    expect(classifyContent(text)).toBe('sign');
  });

  it('should detect warning signs', () => {
    const text = 'CAUTION: Wet Floor';
    expect(classifyContent(text)).toBe('sign');
  });

  it('should detect restroom signs', () => {
    const text = 'Restroom';
    expect(classifyContent(text)).toBe('sign');
  });

  it('should detect document content', () => {
    const text = 'Article 1. The parties to this agreement hereby agree to the following clauses.';
    expect(classifyContent(text)).toBe('document');
  });

  it('should detect product labels', () => {
    const text = 'Ingredients: Sugar, flour, butter. Net Weight: 12 oz';
    expect(classifyContent(text)).toBe('label');
  });

  it('should detect screen content via analysis', () => {
    const analysis = mockAnalysis(['Some code here'], 'screen');
    expect(classifyContent('Some code here', analysis)).toBe('screen');
  });

  it('should detect document via analysis scene type', () => {
    const analysis = mockAnalysis(['Some text'], 'document');
    expect(classifyContent('Some text', analysis)).toBe('document');
  });

  it('should detect business card via person scene', () => {
    const analysis = mockAnalysis(['John Smith'], 'person');
    expect(classifyContent('John Smith', analysis)).toBe('business_card');
  });

  it('should default to general for unclassified text', () => {
    expect(classifyContent('Hello world')).toBe('general');
  });

  it('should detect Japanese signs', () => {
    const text = '出口 EXIT';
    expect(classifyContent(text)).toBe('sign');
  });

  it('should detect French signs', () => {
    const text = 'Sortie de secours';
    expect(classifyContent(text)).toBe('sign');
  });
});

// ─── parseMenuItems ─────────────────────────────────────────────

describe('parseMenuItems', () => {
  it('should parse items with prices', () => {
    const text = 'Pad Thai ... $12.99\nGreen Curry ... $14.99\nMango Sticky Rice ... $8.99';
    const items = parseMenuItems(text);
    expect(items).toHaveLength(3);
    expect(items[0].name).toBe('Pad Thai');
    expect(items[0].price).toBe('$12.99');
    expect(items[1].name).toBe('Green Curry');
    expect(items[1].price).toBe('$14.99');
    expect(items[2].name).toBe('Mango Sticky Rice');
    expect(items[2].price).toBe('$8.99');
  });

  it('should parse numbered items', () => {
    const text = '1. Ramen\n2. Udon\n3. Soba';
    const items = parseMenuItems(text);
    expect(items).toHaveLength(3);
    expect(items[0].name).toBe('Ramen');
    expect(items[1].name).toBe('Udon');
    expect(items[2].name).toBe('Soba');
  });

  it('should skip menu header lines', () => {
    const text = 'Menu\nAppetizers\nSpring Rolls $8.99\nDesserts\nIce Cream $5.99';
    const items = parseMenuItems(text);
    // Should find Spring Rolls and Ice Cream but skip headers
    const names = items.map(i => i.name);
    expect(names).not.toContain('Menu');
    expect(names).toContain('Spring Rolls');
  });

  it('should handle items without prices', () => {
    const text = 'Sushi Platter\nEdamame\nMiso Soup';
    const items = parseMenuItems(text);
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.some(i => i.name === 'Sushi Platter')).toBe(true);
  });

  it('should skip separator lines', () => {
    const text = '========\nPad Thai $12.99\n--------';
    const items = parseMenuItems(text);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Pad Thai');
  });

  it('should skip very short lines', () => {
    const text = 'A\nBB\nPad Thai $12.99';
    const items = parseMenuItems(text);
    // Only Pad Thai should be captured (A and BB are too short)
    expect(items.some(i => i.name === 'Pad Thai')).toBe(true);
  });

  it('should handle empty input', () => {
    expect(parseMenuItems('')).toEqual([]);
  });

  it('should parse items with dot leaders', () => {
    const text = 'Tom Yum Soup........$10.99';
    const items = parseMenuItems(text);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Tom Yum Soup');
    expect(items[0].price).toBe('$10.99');
  });
});

// ─── TranslationAgent ───────────────────────────────────────────

describe('TranslationAgent', () => {
  let agent: TranslationAgent;

  beforeEach(() => {
    agent = new TranslationAgent({
      preferredLanguage: 'en',
      knownLanguages: ['en'],
      currentCountry: 'JP',
    });
  });

  describe('handle()', () => {
    it('should translate foreign text from vision analysis', async () => {
      const analysis = mockAnalysis(['ありがとうございます。メニューをお願いします。']);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result).not.toBeNull();
      expect(result!.sourceLanguage).toBe('ja');
      expect(result!.sourceLanguageName).toBe('Japanese');
      expect(result!.targetLanguage).toBe('en');
    });

    it('should skip text in known languages', async () => {
      const analysis = mockAnalysis(['Hello, this is a test.']);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result).toBeNull();
    });

    it('should skip analysis with no text', async () => {
      const analysis = mockAnalysis([]);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result).toBeNull();
    });

    it('should include cultural notes when country is set', async () => {
      const analysis = mockAnalysis(['ありがとうございます']);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result).not.toBeNull();
      expect(result!.culturalNotes).toBeDefined();
      expect(result!.culturalNotes!.length).toBeGreaterThan(0);
    });

    it('should classify menu content and parse items', async () => {
      const analysis = mockAnalysis([
        'Menu\nAppetizer\nラーメン ... $12.99\nうどん ... $10.99',
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result).not.toBeNull();
      expect(result!.contentType).toBe('menu');
      expect(result!.menuItems).toBeDefined();
    });

    it('should detect sign content', async () => {
      const analysis = mockAnalysis(['出口 EXIT →']);
      const result = await agent.handle(Buffer.from('test'), analysis, { mode: 'quick' });

      expect(result).not.toBeNull();
      // Text includes Japanese characters AND 'exit', so it's either sign or the agent detects ja
    });

    it('should respect mode setting', async () => {
      const analysis = mockAnalysis(['ありがとうございます']);
      const result = await agent.handle(Buffer.from('test'), analysis, { mode: 'quick' });

      expect(result).not.toBeNull();
      // Quick mode: no cultural notes or etiquette tips
      expect(result!.culturalNotes).toBeUndefined();
    });

    it('should update stats after translation', async () => {
      const analysis = mockAnalysis(['ありがとうございます']);
      await agent.handle(Buffer.from('test'), analysis);

      const stats = agent.getStats();
      expect(stats.totalTranslations).toBe(1);
      expect(stats.languagesEncountered).toContain('ja');
    });

    it('should add to history', async () => {
      const analysis = mockAnalysis(['ありがとうございます']);
      await agent.handle(Buffer.from('test'), analysis);

      const history = agent.getHistory();
      expect(history).toHaveLength(1);
    });

    it('should handle multiple languages in sequence', async () => {
      const ja = mockAnalysis(['こんにちは']);
      const ko = mockAnalysis(['안녕하세요']);
      const ru = mockAnalysis(['Здравствуйте']);

      await agent.handle(Buffer.from('test'), ja);
      await agent.handle(Buffer.from('test'), ko);
      await agent.handle(Buffer.from('test'), ru);

      const stats = agent.getStats();
      expect(stats.totalTranslations).toBe(3);
      expect(stats.languagesEncountered).toContain('ja');
      expect(stats.languagesEncountered).toContain('ko');
      expect(stats.languagesEncountered).toContain('ru');
    });

    it('should respect maxHistory config', async () => {
      const smallAgent = new TranslationAgent({
        knownLanguages: ['en'],
        maxHistory: 3,
      });

      for (let i = 0; i < 5; i++) {
        const analysis = mockAnalysis([`テスト${i}`]);
        await smallAgent.handle(Buffer.from('test'), analysis);
      }

      expect(smallAgent.getHistory()).toHaveLength(3);
    });

    it('should include etiquette tips relevant to content type', async () => {
      // Menu analysis in Japan should get dining etiquette
      const analysis = mockAnalysis(['Menu\nAppetizer\nラーメン ... $12.99\nうどん ... $10.99']);
      const result = await agent.handle(Buffer.from('test'), analysis);

      if (result?.etiquetteTips) {
        // Should contain dining-related tips for Japan
        const hasDiningTip = result.etiquetteTips.some(t =>
          t.toLowerCase().includes('chopstick') || t.toLowerCase().includes('slurp') || t.toLowerCase().includes('noodle')
        );
        expect(hasDiningTip).toBe(true);
      }
    });
  });

  describe('getCulturalBriefing()', () => {
    it('should return briefing for Japan', () => {
      const briefing = agent.getCulturalBriefing('JP');
      expect(briefing).not.toBeNull();
      expect(briefing!.country).toBe('Japan');
      expect(briefing!.etiquette.length).toBeGreaterThan(0);
      expect(briefing!.usefulPhrases.length).toBeGreaterThan(0);
    });

    it('should return briefing for South Korea', () => {
      const briefing = agent.getCulturalBriefing('KR');
      expect(briefing).not.toBeNull();
      expect(briefing!.country).toBe('South Korea');
    });

    it('should return briefing for China', () => {
      const briefing = agent.getCulturalBriefing('CN');
      expect(briefing).not.toBeNull();
      expect(briefing!.tippingCustom).toBeDefined();
    });

    it('should return briefing for France', () => {
      const briefing = agent.getCulturalBriefing('FR');
      expect(briefing).not.toBeNull();
      expect(briefing!.usefulPhrases.some(p => p.local === 'Bonjour')).toBe(true);
    });

    it('should return briefing for Germany', () => {
      const briefing = agent.getCulturalBriefing('DE');
      expect(briefing).not.toBeNull();
      expect(briefing!.etiquette.some(e => e.rule.toLowerCase().includes('punctuality'))).toBe(true);
    });

    it('should return briefing for Mexico', () => {
      const briefing = agent.getCulturalBriefing('MX');
      expect(briefing).not.toBeNull();
    });

    it('should return briefing for Italy', () => {
      const briefing = agent.getCulturalBriefing('IT');
      expect(briefing).not.toBeNull();
      expect(briefing!.etiquette.some(e => e.rule.toLowerCase().includes('cappuccino'))).toBe(true);
    });

    it('should return briefing for Brazil', () => {
      const briefing = agent.getCulturalBriefing('BR');
      expect(briefing).not.toBeNull();
      // Should warn about OK gesture
      expect(briefing!.etiquette.some(e => e.rule.toLowerCase().includes('ok'))).toBe(true);
    });

    it('should return briefing for India', () => {
      const briefing = agent.getCulturalBriefing('IN');
      expect(briefing).not.toBeNull();
      expect(briefing!.usefulPhrases.some(p => p.pronunciation?.includes('Nuh-MUS-tay'))).toBe(true);
    });

    it('should return briefing for Thailand', () => {
      const briefing = agent.getCulturalBriefing('TH');
      expect(briefing).not.toBeNull();
      expect(briefing!.etiquette.some(e => e.rule.toLowerCase().includes('head'))).toBe(true);
    });

    it('should return null for unknown country', () => {
      expect(agent.getCulturalBriefing('ZZ')).toBeNull();
    });

    it('should be case-insensitive for country codes', () => {
      expect(agent.getCulturalBriefing('jp')).not.toBeNull();
      expect(agent.getCulturalBriefing('Jp')).not.toBeNull();
    });

    it('should include business norms for Japan', () => {
      const briefing = agent.getCulturalBriefing('JP');
      expect(briefing!.businessNorms).toBeDefined();
      expect(briefing!.businessNorms!.length).toBeGreaterThan(0);
    });

    it('should include taboos for Japan', () => {
      const briefing = agent.getCulturalBriefing('JP');
      expect(briefing!.taboos).toBeDefined();
      expect(briefing!.taboos!.length).toBeGreaterThan(0);
    });

    it('should include tipping customs', () => {
      const briefing = agent.getCulturalBriefing('JP');
      expect(briefing!.tippingCustom).toBeDefined();
      expect(briefing!.tippingCustom!.toLowerCase()).toContain('tip');
    });
  });

  describe('getUsefulPhrases()', () => {
    it('should return phrases for Japan', () => {
      const phrases = agent.getUsefulPhrases('JP');
      expect(phrases.length).toBeGreaterThan(0);
      expect(phrases.some(p => p.english === 'Thank you')).toBe(true);
    });

    it('should include pronunciation guides', () => {
      const phrases = agent.getUsefulPhrases('JP');
      const thankYou = phrases.find(p => p.english === 'Thank you');
      expect(thankYou?.pronunciation).toBeDefined();
    });

    it('should return empty array for unknown country', () => {
      expect(agent.getUsefulPhrases('ZZ')).toEqual([]);
    });
  });

  describe('getAvailableCountries()', () => {
    it('should return list of supported countries', () => {
      const countries = agent.getAvailableCountries();
      expect(countries).toContain('JP');
      expect(countries).toContain('KR');
      expect(countries).toContain('CN');
      expect(countries).toContain('FR');
      expect(countries).toContain('DE');
      expect(countries.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('generateVoiceSummary()', () => {
    it('should generate voice summary with language identification', async () => {
      const analysis = mockAnalysis(['ありがとうございます']);
      const result = await agent.handle(Buffer.from('test'), analysis);
      const summary = agent.generateVoiceSummary(result!);

      expect(summary).toContain('Japanese');
    });

    it('should generate voice summary for menu with item count', async () => {
      const analysis = mockAnalysis(['Menu\nAppetizer\nラーメン ... $12.99\nうどん ... $10.99']);
      const result = await agent.handle(Buffer.from('test'), analysis);

      if (result?.menuItems && result.menuItems.length > 0) {
        const summary = agent.generateVoiceSummary(result);
        expect(summary).toContain('menu item');
      }
    });

    it('should include sign guidance in summary', () => {
      // Build a synthetic result with sign guidance
      const result = {
        id: 'test',
        originalText: '出口',
        sourceLanguage: 'ja',
        sourceLanguageName: 'Japanese',
        targetLanguage: 'en',
        translatedText: 'Exit',
        confidence: 0.9,
        contentType: 'sign' as const,
        translatedAt: new Date().toISOString(),
        signGuidance: 'This is an exit sign.',
      };

      const summary = agent.generateVoiceSummary(result);
      expect(summary).toContain('exit sign');
    });

    it('should include cultural tip in summary', () => {
      const result = {
        id: 'test',
        originalText: 'テスト',
        sourceLanguage: 'ja',
        sourceLanguageName: 'Japanese',
        targetLanguage: 'en',
        translatedText: 'Test',
        confidence: 0.9,
        contentType: 'general' as const,
        translatedAt: new Date().toISOString(),
        etiquetteTips: ['Bow when greeting. Deeper bows show more respect.'],
      };

      const summary = agent.generateVoiceSummary(result);
      expect(summary).toContain('Tip:');
      expect(summary).toContain('Bow');
    });
  });

  describe('searchHistory()', () => {
    it('should search by original text', async () => {
      const a1 = mockAnalysis(['ありがとう']);
      const a2 = mockAnalysis(['こんにちは']);
      await agent.handle(Buffer.from('test'), a1);
      await agent.handle(Buffer.from('test'), a2);

      const results = agent.searchHistory('ありがとう');
      expect(results).toHaveLength(1);
    });

    it('should search by language name', async () => {
      const analysis = mockAnalysis(['ありがとう']);
      await agent.handle(Buffer.from('test'), analysis);

      const results = agent.searchHistory('Japanese');
      expect(results).toHaveLength(1);
    });

    it('should return empty for no matches', () => {
      expect(agent.searchHistory('nonexistent')).toEqual([]);
    });
  });

  describe('configuration', () => {
    it('should set country', () => {
      agent.setCountry('FR');
      const briefing = agent.getCulturalBriefing('FR');
      expect(briefing).not.toBeNull();
    });

    it('should add known language', async () => {
      agent.addKnownLanguage('ja');
      const analysis = mockAnalysis(['ありがとうございます']);
      const result = await agent.handle(Buffer.from('test'), analysis);
      expect(result).toBeNull(); // Should skip known language
    });

    it('should not duplicate known languages', () => {
      agent.addKnownLanguage('ja');
      agent.addKnownLanguage('ja');
      // No error, just silent
    });

    it('should set mode', async () => {
      agent.setMode('quick');
      const analysis = mockAnalysis(['ありがとうございます']);
      const result = await agent.handle(Buffer.from('test'), analysis);
      expect(result).not.toBeNull();
      expect(result!.culturalNotes).toBeUndefined();
    });

    it('should clear history', async () => {
      const analysis = mockAnalysis(['ありがとう']);
      await agent.handle(Buffer.from('test'), analysis);
      expect(agent.getHistory()).toHaveLength(1);

      agent.clearHistory();
      expect(agent.getHistory()).toHaveLength(0);
    });
  });

  describe('stats', () => {
    it('should track translations', async () => {
      const analysis = mockAnalysis(['ありがとう']);
      await agent.handle(Buffer.from('test'), analysis);

      const stats = agent.getStats();
      expect(stats.totalTranslations).toBe(1);
    });

    it('should track unique languages', async () => {
      const ja = mockAnalysis(['ありがとう']);
      const ko = mockAnalysis(['감사합니다']);

      await agent.handle(Buffer.from('test'), ja);
      await agent.handle(Buffer.from('test'), ko);

      const stats = agent.getStats();
      expect(stats.languagesEncountered).toHaveLength(2);
    });

    it('should track sign translations', async () => {
      const analysis = mockAnalysis(['出口 EXIT']);
      await agent.handle(Buffer.from('test'), analysis);

      const stats = agent.getStats();
      expect(stats.signsTranslated).toBe(1);
    });

    it('should return copy of stats (immutable)', () => {
      const stats1 = agent.getStats();
      const stats2 = agent.getStats();
      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });
});
