/**
 * Integration Tests — End-to-end flow with mocked vision model.
 *
 * Tests the full pipeline: image → context router → agent → response
 * Using mocked vision model (no API calls needed for testing).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextRouter, type SpecialistAgent, type AgentResponse } from '../routing/context-router.js';
import { NetworkingAgent } from '../agents/networking-agent.js';
import { DealAnalysisAgent, type DealSearchResult } from '../agents/deal-agent.js';
import { VoiceCommandRouter, parseVoiceCommand } from '../voice/voice-command-router.js';
import type { CapturedImage, VisionAnalysis, VoiceCommand } from '../types.js';

// ─── Mock Factories ─────────────────────────────────────────────

function makeImage(overrides: Partial<CapturedImage> = {}): CapturedImage {
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    buffer: Buffer.from('test-image-data'),
    mimeType: 'image/jpeg',
    capturedAt: new Date().toISOString(),
    deviceId: 'raybans-test',
    trigger: 'auto',
    ...overrides,
  };
}

// Simulated vision analysis results for different scenarios
const MOCK_ANALYSES = {
  retailShelf: (): VisionAnalysis => ({
    imageId: 'img-retail',
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 850,
    sceneDescription: 'Retail store shelf with Sony headphones and Bose speakers displayed on a Best Buy shelf',
    sceneType: 'retail_shelf',
    extractedText: [
      { text: 'Sony WH-1000XM5', confidence: 0.95, textType: 'label' },
      { text: '$349.99', confidence: 0.93, textType: 'price' },
      { text: 'Bose QC Ultra', confidence: 0.91, textType: 'label' },
      { text: '$429.99', confidence: 0.90, textType: 'price' },
    ],
    detectedObjects: [
      { label: 'headphones box', confidence: 0.92 },
      { label: 'headphones box', confidence: 0.89 },
    ],
    products: [
      {
        name: 'Sony WH-1000XM5',
        brand: 'Sony',
        category: 'Headphones',
        confidence: 0.92,
        identificationMethod: 'visual',
        upc: '027242923782',
        estimatedCount: 4,
        countConfidence: 0.85,
        priceOnShelf: 349.99,
      },
    ],
    barcodes: [
      { data: '027242923782', format: 'UPC-A', confidence: 0.88 },
    ],
    quality: {
      score: 0.85,
      isBlurry: false,
      hasGlare: false,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: true,
    },
  }),

  conferenceBadge: (): VisionAnalysis => ({
    imageId: 'img-badge',
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 620,
    sceneDescription: 'A person at a tech conference wearing a name badge',
    sceneType: 'person',
    extractedText: [
      { text: 'Emily Park', confidence: 0.96, textType: 'label' },
      { text: 'Director of Product', confidence: 0.91, textType: 'other' },
      { text: 'Vercel Inc.', confidence: 0.89, textType: 'label' },
      { text: 'emily@vercel.com', confidence: 0.87, textType: 'other' },
    ],
    detectedObjects: [
      { label: 'person', confidence: 0.95 },
      { label: 'name badge', confidence: 0.92 },
    ],
    products: [],
    barcodes: [],
    quality: {
      score: 0.82,
      isBlurry: false,
      hasGlare: false,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: false,
    },
  }),

  vehicleLot: (): VisionAnalysis => ({
    imageId: 'img-vehicle',
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 780,
    sceneDescription: 'A 2025 Honda Civic on a dealer lot with window sticker showing price and details',
    sceneType: 'vehicle',
    extractedText: [
      { text: '2025 Honda Civic Sport', confidence: 0.94, textType: 'label' },
      { text: '$28,900', confidence: 0.93, textType: 'price' },
      { text: '15,200 miles', confidence: 0.88, textType: 'other' },
      { text: '2HGFE2F51RH123456', confidence: 0.82, textType: 'other' },
    ],
    detectedObjects: [
      { label: 'car', confidence: 0.97 },
      { label: 'window sticker', confidence: 0.85 },
    ],
    products: [],
    barcodes: [],
    quality: {
      score: 0.80,
      isBlurry: false,
      hasGlare: true,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: false,
    },
  }),

  whiteboard: (): VisionAnalysis => ({
    imageId: 'img-whiteboard',
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 550,
    sceneDescription: 'A whiteboard in a meeting room with architecture diagrams and action items',
    sceneType: 'whiteboard',
    extractedText: [
      { text: 'Sprint Planning', confidence: 0.92, textType: 'other' },
      { text: 'TODO: Migrate to v2 API', confidence: 0.88, textType: 'other' },
      { text: 'Action: @mike review PR #247', confidence: 0.85, textType: 'other' },
      { text: 'Deadline: March 1st', confidence: 0.83, textType: 'other' },
    ],
    detectedObjects: [
      { label: 'whiteboard', confidence: 0.96 },
      { label: 'markers', confidence: 0.78 },
    ],
    products: [],
    barcodes: [],
    quality: {
      score: 0.75,
      isBlurry: false,
      hasGlare: true,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: false,
    },
  }),
};

// ─── Integration Tests ──────────────────────────────────────────

describe('E2E Integration: Full Pipeline', () => {
  let router: ContextRouter;
  let networkingAgent: NetworkingAgent;
  let dealAgent: DealAnalysisAgent;
  let voiceRouter: VoiceCommandRouter;

  beforeEach(() => {
    // Set up the full system
    router = new ContextRouter({ debug: true });
    voiceRouter = new VoiceCommandRouter();

    // Set up networking agent with mock search
    networkingAgent = new NetworkingAgent({
      searchFn: async (query: string) => {
        if (query.includes('Vercel')) {
          return [
            {
              title: 'Vercel raises $250M Series E',
              url: 'https://techcrunch.com/vercel-funding',
              snippet: 'Vercel raised $250 million in a Series E round led by a16z, valuing the company at $3.25 billion.',
            },
          ];
        }
        return [];
      },
      autoResearch: true,
      debug: true,
    });

    // Set up deal agent with mock search
    dealAgent = new DealAnalysisAgent({
      searchFn: async (query: string): Promise<DealSearchResult[]> => {
        if (query.includes('Sony') || query.includes('027242923782')) {
          return [
            { title: 'Sony XM5 Amazon', url: 'https://www.amazon.com/sony-xm5', snippet: 'Sony WH-1000XM5 - $279.99', price: 279.99 },
            { title: 'Sony XM5 Best Buy', url: 'https://www.bestbuy.com/sony-xm5', snippet: 'Sony WH-1000XM5 - $299.99', price: 299.99 },
          ];
        }
        if (query.includes('Honda') || query.includes('Civic')) {
          return [
            { title: 'Honda Civic KBB', url: 'https://www.kbb.com/honda-civic', snippet: 'Fair market value $25,500', price: 25500 },
            { title: 'Honda Civic CarGurus', url: 'https://www.cargurus.com/honda-civic', snippet: 'Great deal at $26,800', price: 26800 },
          ];
        }
        return [];
      },
      debug: true,
    });

    // Register agents as specialist handlers with the router
    const networkingSpec: SpecialistAgent = {
      id: 'networking',
      name: 'Networking Agent',
      sceneTypes: ['person'],
      voiceIntents: ['what_is_this'],
      keywords: ['badge', 'card', 'person', 'name', 'conference'],
      priority: 3,
      concurrent: false,
      enabled: true,
      handle: async (image, analysis, context) =>
        networkingAgent.handle(image, analysis, context),
    };

    const dealsSpec: SpecialistAgent = {
      id: 'deals',
      name: 'Deal Analysis Agent',
      sceneTypes: ['retail_shelf', 'vehicle', 'property'],
      voiceIntents: ['price_check'],
      keywords: ['price', 'deal', 'cost', 'buy', 'sale'],
      priority: 4,
      concurrent: false,
      enabled: true,
      handle: async (image, analysis, context) =>
        dealAgent.handle(image, analysis, context),
    };

    router.registerAgent(networkingSpec);
    router.registerAgent(dealsSpec);
  });

  describe('Scenario: Shopping at Best Buy', () => {
    it('should route shelf image to deal agent and get price comparison', async () => {
      const image = makeImage({ trigger: 'voice' });
      const analysis = MOCK_ANALYSES.retailShelf();

      const responses = await router.route(image, analysis, 'voice', 'price_check');

      expect(responses.length).toBeGreaterThanOrEqual(1);

      const dealResponse = responses.find((r) => r.agentId === 'deals');
      expect(dealResponse).toBeDefined();
      expect(dealResponse!.handled).toBe(true);
      expect(dealResponse!.voiceResponse).toBeDefined();
      expect(dealResponse!.voiceResponse).toContain('Sony');
    });

    it('should provide savings information', async () => {
      const image = makeImage({ trigger: 'voice' });
      const analysis = MOCK_ANALYSES.retailShelf();

      const responses = await router.route(image, analysis, 'voice', 'price_check');
      const dealResponse = responses.find((r) => r.agentId === 'deals');
      const deal = dealResponse?.data?.deal as any;

      expect(deal).toBeDefined();
      expect(deal.askingPrice).toBe(349.99);
      expect(deal.marketPrices.length).toBeGreaterThan(0);
      // Amazon price is $279.99 vs $349.99 asking
      expect(deal.potentialSavings).toBeGreaterThan(0);
    });
  });

  describe('Scenario: Conference Networking', () => {
    it('should route badge scan to networking agent', async () => {
      const image = makeImage({ trigger: 'voice' });
      const analysis = MOCK_ANALYSES.conferenceBadge();

      const responses = await router.route(image, analysis, 'voice', 'what_is_this');

      const networkResponse = responses.find((r) => r.agentId === 'networking');
      expect(networkResponse).toBeDefined();
      expect(networkResponse!.handled).toBe(true);
      expect(networkResponse!.voiceResponse).toContain('Emily Park');
    });

    it('should research the person and include funding info', async () => {
      const image = makeImage({ trigger: 'voice' });
      const analysis = MOCK_ANALYSES.conferenceBadge();

      const responses = await router.route(image, analysis, 'voice', 'what_is_this');
      const networkResponse = responses.find((r) => r.agentId === 'networking');
      const contact = networkResponse?.data?.contact as any;

      expect(contact).toBeDefined();
      expect(contact.name).toBe('Emily Park');
      expect(contact.research).toBeDefined();
      expect(contact.research.fundingEvents.length).toBeGreaterThan(0);
    });

    it('should save the contact for later lookup', async () => {
      const image = makeImage({ trigger: 'voice' });
      const analysis = MOCK_ANALYSES.conferenceBadge();

      await router.route(image, analysis, 'voice', 'what_is_this');

      const contacts = networkingAgent.getContacts();
      expect(contacts.length).toBeGreaterThan(0);
      expect(contacts[0].name).toBe('Emily Park');
      expect(contacts[0].email).toBe('emily@vercel.com');
    });
  });

  describe('Scenario: Car Dealership Visit', () => {
    it('should route vehicle image to deal agent', async () => {
      const image = makeImage({ trigger: 'voice' });
      const analysis = MOCK_ANALYSES.vehicleLot();

      const responses = await router.route(image, analysis, 'voice', 'price_check');
      const dealResponse = responses.find((r) => r.agentId === 'deals');

      expect(dealResponse).toBeDefined();
      expect(dealResponse!.handled).toBe(true);
    });

    it('should extract vehicle info and compare to market', async () => {
      const image = makeImage({ trigger: 'voice' });
      const analysis = MOCK_ANALYSES.vehicleLot();

      const responses = await router.route(image, analysis, 'voice', 'price_check');
      const dealResponse = responses.find((r) => r.agentId === 'deals');
      const deal = dealResponse?.data?.deal as any;

      expect(deal).toBeDefined();
      expect(deal.category).toBe('vehicle');
      expect(deal.item.vehicleInfo).toBeDefined();
      expect(deal.item.vehicleInfo.make).toBe('Honda');
      expect(deal.askingPrice).toBe(28900);
      expect(deal.marketPrices.length).toBeGreaterThan(0);
      // Asking $28,900 vs market ~$25,500-26,800 → overpriced
      expect(['overpriced', 'fair_price']).toContain(deal.verdict);
    });

    it('should include negotiation leverage points', async () => {
      const image = makeImage({ trigger: 'voice' });
      const analysis = MOCK_ANALYSES.vehicleLot();

      const responses = await router.route(image, analysis, 'voice', 'price_check');
      const deal = responses.find((r) => r.agentId === 'deals')?.data?.deal as any;

      expect(deal.negotiationPoints.length).toBeGreaterThan(0);
    });
  });

  describe('Voice Command → Router Integration', () => {
    it('should parse voice command and route to correct agent', () => {
      const command = parseVoiceCommand('price check');
      expect(command.intent).toBe('price_check');

      const agent = router.routeVoiceCommand(command.intent, command.params);
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('deals');
    });

    it('should parse "who is this" and route to networking', () => {
      const command = parseVoiceCommand('who is this');
      expect(command.intent).toBe('what_is_this');

      const agent = router.routeVoiceCommand(command.intent, command.params);
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('networking');
    });

    it('should set router mode from voice command', () => {
      parseVoiceCommand('start inventory');
      router.routeVoiceCommand('inventory_start', {});

      expect(router.getMode()).toBe('inventory');
    });
  });

  describe('Mode Switching', () => {
    it('should switch from deals to networking when scene changes', async () => {
      // First: shopping
      router.setMode('deals');
      const shelfImage = makeImage();
      await router.route(shelfImage, MOCK_ANALYSES.retailShelf(), 'auto');
      expect(router.getMode()).toBe('deals');

      // Then: conference encounter — voice intent changes mode
      // what_is_this is general, but the scene + agent routing handles it
      const badgeImage = makeImage();
      const responses = await router.route(badgeImage, MOCK_ANALYSES.conferenceBadge(), 'voice', 'what_is_this');
      // The networking agent should have handled it
      const networkResponse = responses.find((r) => r.agentId === 'networking');
      expect(networkResponse).toBeDefined();
      expect(networkResponse!.handled).toBe(true);
    });
  });

  describe('Error Resilience', () => {
    it('should handle agent errors without crashing the router', async () => {
      // Add a faulty agent
      router.registerAgent({
        id: 'faulty',
        name: 'Faulty Agent',
        sceneTypes: ['retail_shelf'],
        voiceIntents: [],
        keywords: ['product'],
        priority: 1,
        concurrent: true,
        enabled: true,
        handle: async () => { throw new Error('Agent explosion!'); },
      });

      const image = makeImage();
      const analysis = MOCK_ANALYSES.retailShelf();

      // Should not throw — faulty agent error is caught
      const responses = await router.route(image, analysis);
      expect(responses).toBeDefined();
      // At least the faulty agent should have a failed response
      const faultyResponse = responses.find((r) => r.agentId === 'faulty');
      if (faultyResponse) {
        expect(faultyResponse.handled).toBe(false);
      }
    });
  });

  describe('Stats Aggregation', () => {
    it('should track stats across multiple routing decisions', async () => {
      await router.route(makeImage(), MOCK_ANALYSES.retailShelf(), 'voice', 'price_check');
      await router.route(makeImage(), MOCK_ANALYSES.conferenceBadge(), 'voice', 'what_is_this');
      await router.route(makeImage(), MOCK_ANALYSES.vehicleLot(), 'voice', 'price_check');

      const routerStats = router.getStats();
      expect(routerStats.totalRoutes).toBe(3);

      const networkingStats = networkingAgent.getStats();
      expect(networkingStats.totalScans).toBeGreaterThanOrEqual(1);

      const dealStats = dealAgent.getStats();
      expect(dealStats.totalAnalyses).toBeGreaterThanOrEqual(2);
    });
  });
});
