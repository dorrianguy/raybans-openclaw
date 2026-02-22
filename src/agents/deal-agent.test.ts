/**
 * Tests for the Deal Analysis Agent — price intelligence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DealAnalysisAgent,
  type DealAnalysisAgentConfig,
  type DealSearchResult,
  type DealVerdict,
} from './deal-agent.js';
import type { CapturedImage, VisionAnalysis } from '../types.js';

// ─── Test Helpers ───────────────────────────────────────────────

function makeImage(overrides: Partial<CapturedImage> = {}): CapturedImage {
  return {
    id: 'test-img-001',
    buffer: Buffer.from('test'),
    mimeType: 'image/jpeg',
    capturedAt: '2026-02-21T23:00:00.000Z',
    deviceId: 'test-device',
    trigger: 'voice',
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<VisionAnalysis> = {}): VisionAnalysis {
  return {
    imageId: 'test-img-001',
    analyzedAt: '2026-02-21T23:00:00.000Z',
    processingTimeMs: 500,
    sceneDescription: 'A product on a store shelf',
    sceneType: 'retail_shelf',
    extractedText: [],
    detectedObjects: [],
    products: [],
    barcodes: [],
    quality: {
      score: 0.8,
      isBlurry: false,
      hasGlare: false,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: true,
    },
    ...overrides,
  };
}

function makeProductAnalysis(): VisionAnalysis {
  return makeAnalysis({
    sceneDescription: 'A Sony WH-1000XM5 headphone box on a shelf with price tag',
    products: [
      {
        name: 'Sony WH-1000XM5',
        brand: 'Sony',
        category: 'Headphones',
        variant: 'Black',
        confidence: 0.92,
        identificationMethod: 'visual',
        upc: '027242923782',
        estimatedCount: 3,
        countConfidence: 0.85,
        priceOnShelf: 349.99,
      },
    ],
    extractedText: [
      { text: '$349.99', confidence: 0.95, textType: 'price' },
      { text: 'Sony WH-1000XM5 Wireless Noise Cancelling', confidence: 0.9, textType: 'label' },
    ],
  });
}

function makeVehicleAnalysis(): VisionAnalysis {
  return makeAnalysis({
    sceneDescription: 'A 2024 Toyota RAV4 on a dealer lot with window sticker',
    sceneType: 'vehicle',
    extractedText: [
      { text: '2024 Toyota RAV4 XLE', confidence: 0.9, textType: 'label' },
      { text: '$34,500', confidence: 0.92, textType: 'price' },
      { text: '12,350 miles', confidence: 0.88, textType: 'other' },
      { text: 'JTMRWRFV5RD123456', confidence: 0.85, textType: 'other' },
    ],
    products: [],
  });
}

function makePropertyAnalysis(): VisionAnalysis {
  return makeAnalysis({
    sceneDescription: 'A for-sale sign in front of a house',
    sceneType: 'property',
    extractedText: [
      { text: '123 Oak Street', confidence: 0.9, textType: 'label' },
      { text: '3 bed 2 bath', confidence: 0.88, textType: 'other' },
      { text: '1,850 sq ft', confidence: 0.87, textType: 'other' },
      { text: '$425,000', confidence: 0.92, textType: 'price' },
      { text: 'Built 1975', confidence: 0.83, textType: 'other' },
    ],
    products: [],
  });
}

function makePriceSearchResults(): DealSearchResult[] {
  return [
    {
      title: 'Sony WH-1000XM5 - Amazon.com',
      url: 'https://www.amazon.com/Sony-WH-1000XM5',
      snippet: 'Sony WH-1000XM5 Wireless Industry Leading Noise Canceling Headphones - $279.99',
      price: 279.99,
    },
    {
      title: 'Sony WH-1000XM5 - Best Buy',
      url: 'https://www.bestbuy.com/sony-xm5',
      snippet: 'Buy Sony WH-1000XM5 for $299.99 with free shipping',
      price: 299.99,
    },
    {
      title: 'Sony WH-1000XM5 Used - eBay',
      url: 'https://www.ebay.com/sony-xm5-used',
      snippet: 'Pre-owned Sony WH-1000XM5 - $219.00 free shipping',
      price: 219.00,
    },
  ];
}

// ─── Tests ──────────────────────────────────────────────────────

describe('DealAnalysisAgent', () => {
  let agent: DealAnalysisAgent;

  beforeEach(() => {
    agent = new DealAnalysisAgent({
      searchFn: async () => [],
      debug: true,
    });
  });

  describe('Category Detection', () => {
    it('should detect product from retail shelf', () => {
      const analysis = makeAnalysis({ sceneType: 'retail_shelf' });
      expect(agent.detectCategory(analysis)).toBe('product');
    });

    it('should detect product from barcodes', () => {
      const analysis = makeAnalysis({
        sceneType: 'unknown',
        barcodes: [
          { data: '012345678901', format: 'UPC-A', confidence: 0.9 },
        ],
      });
      expect(agent.detectCategory(analysis)).toBe('product');
    });

    it('should detect vehicle from scene type', () => {
      expect(agent.detectCategory(makeVehicleAnalysis())).toBe('vehicle');
    });

    it('should detect vehicle from VIN', () => {
      const analysis = makeAnalysis({
        extractedText: [
          { text: 'VIN: 1HGCG1658WA007984', confidence: 0.9, textType: 'other' },
        ],
      });
      expect(agent.detectCategory(analysis)).toBe('vehicle');
    });

    it('should detect vehicle from automotive keywords', () => {
      const analysis = makeAnalysis({
        extractedText: [
          { text: 'MSRP $45,000', confidence: 0.9, textType: 'price' },
          { text: '35,000 miles', confidence: 0.85, textType: 'other' },
        ],
      });
      expect(agent.detectCategory(analysis)).toBe('vehicle');
    });

    it('should detect real estate from property type', () => {
      expect(agent.detectCategory(makePropertyAnalysis())).toBe('real_estate');
    });

    it('should detect real estate from listing keywords', () => {
      const analysis = makeAnalysis({
        extractedText: [
          { text: '4 beds 3 baths', confidence: 0.9, textType: 'other' },
          { text: '2,400 sqft', confidence: 0.85, textType: 'other' },
        ],
      });
      expect(agent.detectCategory(analysis)).toBe('real_estate');
    });

    it('should fall back to general for unknown scenes', () => {
      const analysis = makeAnalysis({
        sceneType: 'unknown',
        extractedText: [],
        products: [],
        barcodes: [],
      });
      expect(agent.detectCategory(analysis)).toBe('general');
    });
  });

  describe('Price Extraction', () => {
    it('should extract price from price-tagged text', () => {
      const analysis = makeAnalysis({
        extractedText: [
          { text: '$49.99', confidence: 0.95, textType: 'price' },
        ],
      });
      expect(agent.extractAskingPrice(analysis)).toBe(49.99);
    });

    it('should extract price with comma separators', () => {
      const analysis = makeAnalysis({
        extractedText: [
          { text: '$1,299.99', confidence: 0.9, textType: 'price' },
        ],
      });
      expect(agent.extractAskingPrice(analysis)).toBe(1299.99);
    });

    it('should extract price from product shelf price', () => {
      const analysis = makeAnalysis({
        products: [
          {
            name: 'Test',
            confidence: 0.8,
            identificationMethod: 'visual',
            estimatedCount: 1,
            countConfidence: 0.7,
            priceOnShelf: 29.99,
          },
        ],
      });
      expect(agent.extractAskingPrice(analysis)).toBe(29.99);
    });

    it('should return undefined when no price visible', () => {
      expect(agent.extractAskingPrice(makeAnalysis())).toBeUndefined();
    });
  });

  describe('Price Parsing', () => {
    it('should parse $XX.XX format', () => {
      expect(agent.parsePrice('$29.99')).toBe(29.99);
    });

    it('should parse $X,XXX format', () => {
      expect(agent.parsePrice('$1,499')).toBe(1499);
    });

    it('should parse $X,XXX.XX format', () => {
      expect(agent.parsePrice('$34,500.00')).toBe(34500);
    });

    it('should parse USD prefix', () => {
      expect(agent.parsePrice('USD 199.99')).toBe(199.99);
    });

    it('should parse "dollars" suffix', () => {
      expect(agent.parsePrice('50 dollars')).toBe(50);
    });

    it('should return null for non-price text', () => {
      expect(agent.parsePrice('hello world')).toBeNull();
    });

    it('should return null for zero price', () => {
      expect(agent.parsePrice('$0.00')).toBeNull();
    });
  });

  describe('Verdict Determination', () => {
    it('should return great_deal when 30%+ below market', () => {
      const agent = new DealAnalysisAgent();
      const verdict = agent.determineVerdict(70, 100, []);
      expect(verdict).toBe('great_deal');
    });

    it('should return good_deal when 10-30% below market', () => {
      const verdict = agent.determineVerdict(85, 100, []);
      expect(verdict).toBe('good_deal');
    });

    it('should return fair_price when within 10% of market', () => {
      const verdict = agent.determineVerdict(95, 100, []);
      expect(verdict).toBe('fair_price');
    });

    it('should return overpriced when 10-30% above market', () => {
      const verdict = agent.determineVerdict(120, 100, []);
      expect(verdict).toBe('overpriced');
    });

    it('should return rip_off when 30%+ above market', () => {
      const verdict = agent.determineVerdict(150, 100, []);
      expect(verdict).toBe('rip_off');
    });

    it('should return unknown when no asking price', () => {
      const verdict = agent.determineVerdict(undefined, 100, []);
      expect(verdict).toBe('unknown');
    });

    it('should return unknown when no fair value', () => {
      const verdict = agent.determineVerdict(100, undefined, []);
      expect(verdict).toBe('unknown');
    });
  });

  describe('Fair Market Value Calculation', () => {
    it('should calculate median for odd number of prices', () => {
      const prices = [
        { source: 'A', price: 100, observedAt: '' },
        { source: 'B', price: 200, observedAt: '' },
        { source: 'C', price: 300, observedAt: '' },
      ];
      expect(agent.calculateFairValue(prices)).toBe(200);
    });

    it('should calculate median for even number of prices', () => {
      const prices = [
        { source: 'A', price: 100, observedAt: '' },
        { source: 'B', price: 200, observedAt: '' },
        { source: 'C', price: 300, observedAt: '' },
        { source: 'D', price: 400, observedAt: '' },
      ];
      expect(agent.calculateFairValue(prices)).toBe(250);
    });

    it('should handle single price', () => {
      const prices = [{ source: 'A', price: 150, observedAt: '' }];
      expect(agent.calculateFairValue(prices)).toBe(150);
    });

    it('should return undefined for empty prices', () => {
      expect(agent.calculateFairValue([])).toBeUndefined();
    });
  });

  describe('Savings Calculation', () => {
    it('should calculate savings vs cheapest option', () => {
      const prices = [
        { source: 'Amazon', price: 280, observedAt: '' },
        { source: 'eBay', price: 220, observedAt: '' },
      ];
      const savings = agent.calculateSavings(350, prices);

      expect(savings).toBeDefined();
      expect(savings!.amount).toBe(130);
      expect(savings!.percent).toBe(37);
    });

    it('should return undefined when asking price is lowest', () => {
      const prices = [
        { source: 'Amazon', price: 400, observedAt: '' },
      ];
      const savings = agent.calculateSavings(350, prices);
      expect(savings).toBeUndefined();
    });

    it('should return undefined with no prices', () => {
      expect(agent.calculateSavings(100, [])).toBeUndefined();
    });
  });

  describe('Product Analysis', () => {
    it('should analyze a product with price comparison', async () => {
      const agent = new DealAnalysisAgent({
        searchFn: async () => makePriceSearchResults(),
        debug: true,
      });

      const deal = await agent.analyze(makeImage(), makeProductAnalysis());

      expect(deal).toBeDefined();
      expect(deal!.category).toBe('product');
      expect(deal!.item.name).toContain('Sony');
      expect(deal!.askingPrice).toBe(349.99);
      expect(deal!.marketPrices.length).toBeGreaterThan(0);
      expect(deal!.verdict).not.toBe('unknown');
    });

    it('should find alternatives when product is overpriced', async () => {
      const agent = new DealAnalysisAgent({
        searchFn: async () => makePriceSearchResults(),
        findAlternatives: true,
        debug: true,
      });

      const deal = await agent.analyze(makeImage(), makeProductAnalysis());

      expect(deal!.alternatives.length).toBeGreaterThan(0);
    });
  });

  describe('Vehicle Analysis', () => {
    it('should extract vehicle info from analysis', () => {
      const info = agent.extractItemInfo(makeVehicleAnalysis(), 'vehicle');

      expect(info.name).toContain('Toyota');
      expect(info.vehicleInfo).toBeDefined();
      expect(info.vehicleInfo!.year).toBe(2024);
      expect(info.vehicleInfo!.make).toBe('Toyota');
      expect(info.vehicleInfo!.model).toContain('RAV4');
      expect(info.vehicleInfo!.mileage).toBe(12350);
    });

    it('should extract VIN from vehicle', () => {
      const info = agent.extractItemInfo(makeVehicleAnalysis(), 'vehicle');
      expect(info.vehicleInfo!.vin).toBe('JTMRWRFV5RD123456');
    });

    it('should generate vehicle-specific negotiation points', () => {
      const points = agent.generateNegotiationPoints(
        'vehicle',
        {
          name: '2024 Toyota RAV4',
          vehicleInfo: { year: 2024, make: 'Toyota', model: 'RAV4', mileage: 65000 },
        },
        34500,
        31000,
        [],
      );

      expect(points.length).toBeGreaterThan(0);
      expect(points.some((p) => p.includes('above fair market'))).toBe(true);
    });

    it('should warn about high mileage', () => {
      const agent = new DealAnalysisAgent({ debug: true });
      // We test the warning generation indirectly through the full analysis
      const info = {
        name: 'Test Vehicle',
        vehicleInfo: { mileage: 160000 },
      };
      const negotiationPoints = agent.generateNegotiationPoints(
        'vehicle', info, 20000, 15000, [],
      );
      // Should mention vehicle history
      expect(negotiationPoints.some((p) =>
        p.toLowerCase().includes('carfax') || p.toLowerCase().includes('history'),
      )).toBe(true);
    });
  });

  describe('Real Estate Analysis', () => {
    it('should extract property info from analysis', () => {
      const info = agent.extractItemInfo(makePropertyAnalysis(), 'real_estate');

      expect(info.propertyInfo).toBeDefined();
      expect(info.propertyInfo!.address).toContain('123 Oak');
      expect(info.propertyInfo!.beds).toBe(3);
      expect(info.propertyInfo!.baths).toBe(2);
      expect(info.propertyInfo!.sqft).toBe(1850);
      expect(info.propertyInfo!.yearBuilt).toBe(1975);
    });

    it('should generate real estate negotiation points', () => {
      const points = agent.generateNegotiationPoints(
        'real_estate',
        {
          name: '123 Oak St',
          propertyInfo: { yearBuilt: 1965, beds: 3, baths: 2 },
        },
        425000,
        380000,
        [],
      );

      expect(points.length).toBeGreaterThan(0);
      expect(points.some((p) => p.includes('disclosure'))).toBe(true);
      expect(points.some((p) => p.includes('lead paint') || p.includes('1980'))).toBe(true);
    });
  });

  describe('Voice Output', () => {
    it('should build a voice verdict for a product', async () => {
      const agent = new DealAnalysisAgent({
        searchFn: async () => makePriceSearchResults(),
        debug: true,
      });

      const deal = await agent.analyze(makeImage(), makeProductAnalysis());
      const verdict = agent.buildVoiceVerdict(deal!);

      expect(verdict).toContain('Sony');
      expect(verdict).toContain('349');
      expect(verdict.length).toBeGreaterThan(30);
      expect(verdict.length).toBeLessThan(500); // Roughly 30 sec of speech
    });

    it('should emit voice:verdict event', async () => {
      const agent = new DealAnalysisAgent({
        searchFn: async () => makePriceSearchResults(),
        debug: true,
      });
      const handler = vi.fn();
      agent.on('voice:verdict', handler);

      const deal = await agent.analyze(makeImage(), makeProductAnalysis());
      agent.buildVoiceVerdict(deal!);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Context Router Handler', () => {
    it('should return handled response for product with price', async () => {
      const agent = new DealAnalysisAgent({
        searchFn: async () => makePriceSearchResults(),
        debug: true,
      });

      const response = await agent.handle(
        makeImage(),
        makeProductAnalysis(),
        { activeMode: 'deals', trigger: 'voice', recentModes: [] },
      );

      expect(response.agentId).toBe('deals');
      expect(response.handled).toBe(true);
      expect(response.voiceResponse).toBeDefined();
    });

    it('should return not-handled for unidentifiable image', async () => {
      const response = await agent.handle(
        makeImage(),
        makeAnalysis({ sceneType: 'unknown' }),
        { activeMode: 'deals', trigger: 'auto', recentModes: [] },
      );

      expect(response.handled).toBe(false);
    });
  });

  describe('History', () => {
    it('should track deal history', async () => {
      const agent = new DealAnalysisAgent({
        searchFn: async () => makePriceSearchResults(),
        trackHistory: true,
        debug: true,
      });

      await agent.analyze(makeImage(), makeProductAnalysis());
      await agent.analyze(makeImage({ id: 'img-2' }), makeProductAnalysis());

      expect(agent.getHistory()).toHaveLength(2);
    });

    it('should enforce history limit', async () => {
      const agent = new DealAnalysisAgent({
        searchFn: async () => [],
        trackHistory: true,
        maxHistorySize: 2,
        debug: true,
      });

      for (let i = 0; i < 5; i++) {
        await agent.analyze(
          makeImage({ id: `img-${i}` }),
          makeProductAnalysis(),
        );
      }

      expect(agent.getHistory().length).toBeLessThanOrEqual(2);
    });

    it('should search history by name', async () => {
      const agent = new DealAnalysisAgent({
        searchFn: async () => makePriceSearchResults(),
        trackHistory: true,
        debug: true,
      });

      await agent.analyze(makeImage(), makeProductAnalysis());

      const results = agent.searchHistory('sony');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Stats', () => {
    it('should track analysis statistics', async () => {
      const agent = new DealAnalysisAgent({
        searchFn: async () => makePriceSearchResults(),
        trackHistory: true,
        debug: true,
      });

      await agent.analyze(makeImage(), makeProductAnalysis());

      const stats = agent.getStats();
      expect(stats.totalAnalyses).toBe(1);
      expect(stats.historySize).toBe(1);
    });

    it('should track verdict breakdown', async () => {
      const agent = new DealAnalysisAgent({
        searchFn: async () => makePriceSearchResults(),
        trackHistory: true,
        debug: true,
      });

      await agent.analyze(makeImage(), makeProductAnalysis());

      const stats = agent.getStats();
      const totalVerdicts = Object.values(stats.verdictBreakdown).reduce(
        (a, b) => a + b,
        0,
      );
      expect(totalVerdicts).toBe(1);
    });
  });
});
