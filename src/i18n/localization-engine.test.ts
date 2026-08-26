/**
 * Localization Engine Tests
 * 🌙 Night Shift Agent — Shift #34
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalizationEngine,
  DEFAULT_LOCALIZATION_CONFIG,
  BUILT_IN_PACKS,
} from './localization-engine.js';
import type { SupportedLocale, LanguagePack, LocalizationConfig } from './localization-engine.js';

describe('LocalizationEngine', () => {
  let engine: LocalizationEngine;

  beforeEach(() => {
    engine = new LocalizationEngine();
  });

  // ─── Initialization ───────────────────────────────────────────

  describe('initialization', () => {
    it('should initialize with default locale', () => {
      expect(engine.getLocale()).toBe('en');
    });

    it('should auto-load English pack on creation', () => {
      expect(engine.getLoadedLocales()).toContain('en');
    });

    it('should accept custom config', () => {
      const custom = new LocalizationEngine({ defaultLocale: 'es' });
      expect(custom.getLocale()).toBe('es');
    });

    it('should load fallback chain packs', () => {
      const eng = new LocalizationEngine({ fallbackChain: ['es', 'en'] });
      const locales = eng.getLoadedLocales();
      expect(locales).toContain('en');
      expect(locales).toContain('es');
    });
  });

  // ─── Pack Management ──────────────────────────────────────────

  describe('pack management', () => {
    it('should load built-in packs', () => {
      expect(engine.loadBuiltInPack('es')).toBe(true);
      expect(engine.getLoadedLocales()).toContain('es');
    });

    it('should return false for unknown packs', () => {
      expect(engine.loadBuiltInPack('zz' as SupportedLocale)).toBe(false);
    });

    it('should register custom packs', () => {
      const customPack: LanguagePack = {
        locale: 'de',
        nativeName: 'Deutsch',
        englishName: 'German',
        direction: 'ltr',
        dateFormats: {
          short: 'DD.MM.YYYY',
          medium: 'D. MMM YYYY',
          long: 'D. MMMM YYYY',
          time: 'HH:mm',
          dateTime: 'D. MMM YYYY HH:mm',
          relative: {
            justNow: 'gerade eben',
            minutesAgo: 'vor {count} Minuten',
            hoursAgo: 'vor {count} Stunden',
            daysAgo: 'vor {count} Tagen',
            weeksAgo: 'vor {count} Wochen',
          },
        },
        numberFormat: { decimal: ',', thousands: '.', grouping: 3 },
        currencyFormat: {
          defaultCurrency: 'EUR',
          symbol: '€',
          symbolPosition: 'after',
          decimalPlaces: 2,
          thousandsSeparator: '.',
          decimalSeparator: ',',
        },
        pluralRules: { categories: ['one', 'other'], select: (n) => n === 1 ? 'one' : 'other' },
        translations: {
          common: {
            'action.start': 'Starten',
            'action.stop': 'Stoppen',
          },
        },
      };
      engine.registerPack(customPack);
      expect(engine.getLoadedLocales()).toContain('de');
    });

    it('should unload packs but not the default', () => {
      engine.loadBuiltInPack('es');
      expect(engine.unloadPack('es')).toBe(true);
      expect(engine.getLoadedLocales()).not.toContain('es');
    });

    it('should not unload default locale pack', () => {
      expect(engine.unloadPack('en')).toBe(false);
      expect(engine.getLoadedLocales()).toContain('en');
    });

    it('should get pack info', () => {
      const info = engine.getPackInfo('en');
      expect(info).not.toBeNull();
      expect(info!.nativeName).toBe('English');
      expect(info!.direction).toBe('ltr');
    });

    it('should return null for unknown pack info', () => {
      expect(engine.getPackInfo('zz' as SupportedLocale)).toBeNull();
    });
  });

  // ─── Locale Management ────────────────────────────────────────

  describe('locale management', () => {
    it('should set locale', () => {
      engine.loadBuiltInPack('es');
      expect(engine.setLocale('es')).toBe(true);
      expect(engine.getLocale()).toBe('es');
    });

    it('should auto-load locale when setting if available', () => {
      expect(engine.setLocale('fr')).toBe(true);
      expect(engine.getLocale()).toBe('fr');
    });

    it('should return false for unavailable locale', () => {
      expect(engine.setLocale('zz' as SupportedLocale)).toBe(false);
    });

    it('should emit locale:changed event', () => {
      let event: any = null;
      engine.on('locale:changed', (e) => { event = e; });
      engine.loadBuiltInPack('es');
      engine.setLocale('es');
      expect(event).not.toBeNull();
      expect(event.from).toBe('en');
      expect(event.to).toBe('es');
    });

    it('should detect locale from user preference', () => {
      const locale = engine.detectLocale({ userPreference: 'es' });
      expect(locale).toBe('es');
    });

    it('should detect locale from browser language', () => {
      const locale = engine.detectLocale({ browserLang: 'fr-FR' });
      expect(locale).toBe('fr');
    });

    it('should detect locale from timezone', () => {
      const locale = engine.detectLocale({ timezone: 'Asia/Tokyo' });
      expect(locale).toBe('ja');
    });

    it('should fall back to default for unknown signals', () => {
      const locale = engine.detectLocale({ timezone: 'Unknown/Zone' });
      expect(locale).toBe('en');
    });

    it('should prioritize user preference over browser language', () => {
      const locale = engine.detectLocale({ userPreference: 'ja', browserLang: 'fr' });
      expect(locale).toBe('ja');
    });
  });

  // ─── Translation ──────────────────────────────────────────────

  describe('translation', () => {
    it('should translate a simple key', () => {
      const result = engine.t('action.start');
      expect(result).toBe('Start');
    });

    it('should translate with namespace prefix', () => {
      const result = engine.t('action.stop');
      expect(result).toBe('Stop');
    });

    it('should translate voice keys', () => {
      const result = engine.t('voice.sessionPaused');
      expect(result).toBe('Session paused.');
    });

    it('should translate billing keys', () => {
      const result = engine.t('billing.free');
      expect(result).toBe('Free');
    });

    it('should translate error keys', () => {
      // The key in the 'errors' namespace is stored as 'error.generic'
      // Access it via the namespace option since the prefix doesn't match a namespace name
      const result = engine.t('error.generic', { namespace: 'errors' });
      expect(result).toContain('Something went wrong');
    });

    it('should interpolate variables', () => {
      const result = engine.t('voice.aisleComplete', {
        vars: { aisle: '3', items: 147, flags: 3 },
      });
      expect(result).toContain('3');
      expect(result).toContain('147');
    });

    it('should return key for missing translations', () => {
      const result = engine.t('nonexistent.key');
      expect(result).toBe('nonexistent.key');
    });

    it('should throw on missing translation in strict mode', () => {
      const strict = new LocalizationEngine({ throwOnMissing: true });
      expect(() => strict.t('nonexistent.key')).toThrow();
    });

    it('should track missing keys', () => {
      engine.t('missing.key1');
      engine.t('missing.key2');
      const missing = engine.getMissingKeys();
      expect(missing.length).toBeGreaterThanOrEqual(2);
    });

    it('should translate in Spanish', () => {
      engine.setLocale('es');
      expect(engine.t('action.start')).toBe('Iniciar');
      expect(engine.t('action.stop')).toBe('Detener');
    });

    it('should translate in French', () => {
      engine.setLocale('fr');
      expect(engine.t('action.start')).toBe('Démarrer');
    });

    it('should translate in Japanese', () => {
      engine.setLocale('ja');
      expect(engine.t('action.start')).toBe('開始');
    });

    it('should translate in Arabic', () => {
      engine.setLocale('ar');
      expect(engine.t('action.start')).toBe('ابدأ');
    });

    it('should fall back to English for missing translations in other locales', () => {
      engine.setLocale('es');
      // 'onboarding.welcome' is not in Spanish pack, should fall back to English
      const result = engine.t('onboarding.welcome');
      expect(result).toBe('Welcome to Inventory Vision');
    });

    it('should cache translations', () => {
      engine.t('action.start');
      engine.t('action.start');
      const stats = engine.getStats();
      expect(stats.cacheHits).toBeGreaterThan(0);
    });

    it('should translate with explicit locale override', () => {
      engine.loadBuiltInPack('es');
      const english = engine.tLocale('en', 'action.start');
      const spanish = engine.tLocale('es' as SupportedLocale, 'action.start');
      expect(english).toBe('Start');
      expect(spanish).toBe('Iniciar');
    });

    it('should check key existence', () => {
      expect(engine.has('action.start')).toBe(true);
      expect(engine.has('nonexistent.key.here')).toBe(false);
    });

    it('should get keys for a namespace', () => {
      const keys = engine.getKeys('common');
      expect(keys.length).toBeGreaterThan(0);
      expect(keys).toContain('action.start');
    });

    it('should handle ICU plurals in English', () => {
      const result = engine.t('time.minutesAgo', { count: 1, vars: { count: 1 } });
      expect(result).toContain('1');
      expect(result).toContain('minute');
      expect(result).not.toContain('minutes');
    });

    it('should handle ICU plurals for multiple', () => {
      const result = engine.t('time.minutesAgo', { count: 5, vars: { count: 5 } });
      expect(result).toContain('5');
      expect(result).toContain('minutes');
    });

    it('should clear missing keys', () => {
      engine.t('missing.key');
      expect(engine.getMissingKeys().length).toBeGreaterThan(0);
      engine.clearMissingKeys();
      expect(engine.getMissingKeys().length).toBe(0);
    });
  });

  // ─── Number Formatting ────────────────────────────────────────

  describe('number formatting', () => {
    it('should format numbers in English', () => {
      expect(engine.formatNumber(1234567.89, 2)).toBe('1,234,567.89');
    });

    it('should format numbers in Spanish', () => {
      engine.setLocale('es');
      expect(engine.formatNumber(1234567.89, 2)).toBe('1.234.567,89');
    });

    it('should format numbers in French', () => {
      engine.setLocale('fr');
      expect(engine.formatNumber(1234567.89, 2)).toBe('1 234 567,89');
    });

    it('should format small numbers without separators', () => {
      expect(engine.formatNumber(42)).toBe('42');
    });

    it('should handle negative numbers', () => {
      expect(engine.formatNumber(-1234)).toBe('-1,234');
    });

    it('should format with specified decimals', () => {
      expect(engine.formatNumber(3.14159, 2)).toBe('3.14');
    });
  });

  // ─── Currency Formatting ──────────────────────────────────────

  describe('currency formatting', () => {
    it('should format USD in English', () => {
      expect(engine.formatCurrency(79)).toBe('$79.00');
    });

    it('should format with thousands', () => {
      expect(engine.formatCurrency(1234.56)).toBe('$1,234.56');
    });

    it('should format EUR in French (symbol after)', () => {
      engine.setLocale('fr');
      const result = engine.formatCurrency(79);
      expect(result).toContain('€');
      expect(result).toContain('79');
    });

    it('should format JPY with no decimals', () => {
      engine.setLocale('ja');
      const result = engine.formatCurrency(1000);
      expect(result).toContain('¥');
      expect(result).not.toContain('.');
    });

    it('should format with custom symbol', () => {
      const result = engine.formatCurrency(50, '£');
      expect(result).toContain('£');
    });
  });

  // ─── Percentage Formatting ────────────────────────────────────

  describe('percentage formatting', () => {
    it('should format percentages', () => {
      expect(engine.formatPercent(95)).toBe('95%');
    });

    it('should format with decimals', () => {
      expect(engine.formatPercent(95.5, 1)).toBe('95.5%');
    });
  });

  // ─── Relative Time Formatting ─────────────────────────────────

  describe('relative time formatting', () => {
    it('should show "just now" for recent times', () => {
      const result = engine.formatRelativeTime(Date.now() - 5000);
      expect(result).toBe('just now');
    });

    it('should show minutes ago', () => {
      const result = engine.formatRelativeTime(Date.now() - 300000); // 5 minutes
      expect(result).toContain('5');
      expect(result).toContain('minute');
    });

    it('should show hours ago', () => {
      const result = engine.formatRelativeTime(Date.now() - 7200000); // 2 hours
      expect(result).toContain('2');
      expect(result).toContain('hour');
    });

    it('should show days ago', () => {
      const result = engine.formatRelativeTime(Date.now() - 172800000); // 2 days
      expect(result).toContain('2');
      expect(result).toContain('day');
    });

    it('should show weeks ago', () => {
      const result = engine.formatRelativeTime(Date.now() - 1209600000); // 2 weeks
      expect(result).toContain('2');
      expect(result).toContain('week');
    });

    it('should format relative time in Spanish', () => {
      engine.setLocale('es');
      const result = engine.formatRelativeTime(Date.now() - 5000);
      expect(result).toBe('justo ahora');
    });

    it('should format relative time in Japanese', () => {
      engine.setLocale('ja');
      const result = engine.formatRelativeTime(Date.now() - 5000);
      expect(result).toBe('たった今');
    });
  });

  // ─── Voice Summaries ──────────────────────────────────────────

  describe('voice summaries', () => {
    it('should generate session start voice summary', () => {
      const result = engine.voiceSummary('sessionStart');
      expect(result).toContain('session started');
    });

    it('should generate session complete voice summary with variables', () => {
      const result = engine.voiceSummary('sessionComplete', {
        items: 500,
        aisles: 12,
        accuracy: 95,
      });
      expect(result).toContain('500');
      expect(result).toContain('12');
      expect(result).toContain('95');
    });

    it('should generate progress voice summary', () => {
      const result = engine.voiceSummary('progress', { percent: 75, remaining: 3 });
      expect(result).toContain('75');
      expect(result).toContain('3');
    });

    it('should generate low stock voice summary', () => {
      const result = engine.voiceSummary('lowStock', { product: 'Tide Pods', count: 2 });
      expect(result).toContain('Tide Pods');
      expect(result).toContain('2');
    });

    it('should generate mismatch voice summary', () => {
      const result = engine.voiceSummary('mismatch', {
        expected: 'Tide Pods 42ct',
        actual: 'Tide Pods 28ct',
      });
      expect(result).toContain('Tide Pods 42ct');
      expect(result).toContain('Tide Pods 28ct');
    });

    it('should generate voice summary in Spanish', () => {
      engine.setLocale('es');
      const result = engine.voiceSummary('sessionStart');
      expect(result).toContain('inventario');
    });
  });

  // ─── Text Direction ───────────────────────────────────────────

  describe('text direction', () => {
    it('should return LTR for English', () => {
      expect(engine.getDirection()).toBe('ltr');
      expect(engine.isRTL()).toBe(false);
    });

    it('should return RTL for Arabic', () => {
      engine.setLocale('ar');
      expect(engine.getDirection()).toBe('rtl');
      expect(engine.isRTL()).toBe(true);
    });

    it('should return LTR for Japanese', () => {
      engine.setLocale('ja');
      expect(engine.getDirection()).toBe('ltr');
      expect(engine.isRTL()).toBe(false);
    });
  });

  // ─── Statistics ───────────────────────────────────────────────

  describe('statistics', () => {
    it('should return valid stats', () => {
      const stats = engine.getStats();
      expect(stats.currentLocale).toBe('en');
      expect(stats.loadedPacks).toBeGreaterThanOrEqual(1);
      expect(stats.totalKeys).toBeGreaterThan(0);
    });

    it('should track cache stats', () => {
      engine.t('action.start');
      engine.t('action.start'); // cache hit
      const stats = engine.getStats();
      expect(stats.cacheHits).toBeGreaterThanOrEqual(1);
    });

    it('should track missing key count', () => {
      engine.t('missing.key.abc');
      const stats = engine.getStats();
      expect(stats.missingKeys).toBeGreaterThanOrEqual(1);
    });

    it('should generate voice summary', () => {
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('English');
      expect(summary).toContain('language packs loaded');
    });
  });

  // ─── Built-in Packs ──────────────────────────────────────────

  describe('built-in packs', () => {
    it('should have 5 built-in packs', () => {
      expect(Object.keys(BUILT_IN_PACKS).length).toBe(5);
    });

    it('should include en, es, fr, ja, ar', () => {
      expect(BUILT_IN_PACKS).toHaveProperty('en');
      expect(BUILT_IN_PACKS).toHaveProperty('es');
      expect(BUILT_IN_PACKS).toHaveProperty('fr');
      expect(BUILT_IN_PACKS).toHaveProperty('ja');
      expect(BUILT_IN_PACKS).toHaveProperty('ar');
    });

    it('should have all required namespaces in English', () => {
      const pack = BUILT_IN_PACKS['en']();
      const namespaces = Object.keys(pack.translations);
      expect(namespaces).toContain('common');
      expect(namespaces).toContain('dashboard');
      expect(namespaces).toContain('voice');
      expect(namespaces).toContain('reports');
      expect(namespaces).toContain('billing');
      expect(namespaces).toContain('errors');
      expect(namespaces).toContain('inventory');
      expect(namespaces).toContain('agents');
      expect(namespaces).toContain('onboarding');
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle region variants by falling back to base locale', () => {
      engine.loadBuiltInPack('es');
      engine.setLocale('es-MX' as SupportedLocale);
      // Should still find translations from 'es' base pack
      expect(engine.t('action.start')).toBe('Iniciar');
    });

    it('should handle cache eviction', () => {
      const small = new LocalizationEngine({ maxCacheSize: 5 });
      // Fill cache
      for (let i = 0; i < 10; i++) {
        small.t('action.start', { vars: { i } });
      }
      // Should still work
      const result = small.t('action.start');
      expect(result).toBe('Start');
    });

    it('should emit translation:missing event', () => {
      let emitted = false;
      engine.on('translation:missing', () => { emitted = true; });
      engine.t('definitely.missing.key');
      expect(emitted).toBe(true);
    });

    it('should emit translation:fallback event', () => {
      let emitted = false;
      engine.on('translation:fallback', () => { emitted = true; });
      engine.setLocale('es');
      engine.t('onboarding.welcome'); // Only in English
      expect(emitted).toBe(true);
    });

    it('should handle empty variables gracefully', () => {
      const result = engine.t('action.start', { vars: {} });
      expect(result).toBe('Start');
    });

    it('should handle default config values', () => {
      expect(DEFAULT_LOCALIZATION_CONFIG.defaultLocale).toBe('en');
      expect(DEFAULT_LOCALIZATION_CONFIG.logMissing).toBe(true);
      expect(DEFAULT_LOCALIZATION_CONFIG.maxCacheSize).toBe(5000);
    });
  });
});
