/**
 * Tests for the Networking Agent — badge/card scanning and person research.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NetworkingAgent,
  type ContactInfo,
  type NetworkingAgentConfig,
  type SearchResult,
} from './networking-agent.js';
import type { CapturedImage, VisionAnalysis, ExtractedText } from '../types.js';

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
    sceneDescription: 'A person wearing a name badge at a conference',
    sceneType: 'person',
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
      usableForInventory: false,
    },
    ...overrides,
  };
}

function makeBadgeAnalysis(): VisionAnalysis {
  return makeAnalysis({
    extractedText: [
      { text: 'Sarah Chen', confidence: 0.95, textType: 'label' },
      { text: 'VP of Engineering', confidence: 0.9, textType: 'other' },
      { text: 'Stripe Inc.', confidence: 0.88, textType: 'label' },
      { text: 'sarah.chen@stripe.com', confidence: 0.85, textType: 'other' },
    ],
  });
}

function makeBusinessCardAnalysis(): VisionAnalysis {
  return makeAnalysis({
    extractedText: [
      { text: 'Michael Rodriguez', confidence: 0.92, textType: 'label' },
      { text: 'Chief Technology Officer', confidence: 0.9, textType: 'other' },
      { text: 'Acme Technologies Inc.', confidence: 0.88, textType: 'label' },
      { text: 'michael@acmetech.com', confidence: 0.87, textType: 'other' },
      { text: '+1 (555) 123-4567', confidence: 0.85, textType: 'other' },
      { text: 'linkedin.com/in/michaelrodriguez', confidence: 0.83, textType: 'other' },
      { text: 'Twitter: @mrodriguez', confidence: 0.82, textType: 'other' },
      { text: 'www.acmetech.com', confidence: 0.80, textType: 'other' },
    ],
  });
}

function makeSearchResults(): SearchResult[] {
  return [
    {
      title: 'Sarah Chen - VP of Engineering at Stripe | LinkedIn',
      url: 'https://linkedin.com/in/sarahchen',
      snippet: 'Sarah Chen is VP of Engineering at Stripe. She previously worked at Google and focuses on distributed systems.',
    },
    {
      title: 'Stripe raises $6.5 billion Series I',
      url: 'https://techcrunch.com/stripe-funding',
      snippet: 'Stripe raised $6.5 billion in a Series I round, valuing the company at $50 billion.',
    },
    {
      title: 'Sarah Chen talks about scaling infrastructure',
      url: 'https://blog.stripe.com/scaling',
      snippet: 'Sarah Chen writes about infrastructure scaling challenges at Stripe and building resilient payment systems.',
    },
  ];
}

// ─── Tests ──────────────────────────────────────────────────────

describe('NetworkingAgent', () => {
  let agent: NetworkingAgent;

  beforeEach(() => {
    agent = new NetworkingAgent({
      searchFn: async () => [],
      autoResearch: false,
      debug: true,
    });
  });

  describe('Contact Extraction', () => {
    it('should extract contact from a name badge', async () => {
      const result = await agent.processImage(makeImage(), makeBadgeAnalysis());

      expect(result).toBeDefined();
      expect(result!.name).toBe('Sarah Chen');
      expect(result!.email).toBe('sarah.chen@stripe.com');
    });

    it('should extract full business card info', async () => {
      const result = await agent.processImage(makeImage(), makeBusinessCardAnalysis());

      expect(result).toBeDefined();
      expect(result!.name).toBe('Michael Rodriguez');
      expect(result!.title).toContain('Chief Technology Officer');
      expect(result!.company).toContain('Acme Technologies');
      expect(result!.email).toBe('michael@acmetech.com');
      expect(result!.phone).toBe('+1 (555) 123-4567');
      expect(result!.linkedin).toContain('linkedin.com/in/michaelrodriguez');
      expect(result!.twitter).toBe('@mrodriguez');
      expect(result!.website).toContain('acmetech.com');
    });

    it('should return null when no contact info found', async () => {
      const analysis = makeAnalysis({
        extractedText: [
          { text: 'EXIT', confidence: 0.9, textType: 'sign' },
        ],
      });
      const result = await agent.processImage(makeImage(), analysis);
      expect(result).toBeNull();
    });

    it('should return null for empty text', async () => {
      const result = await agent.processImage(makeImage(), makeAnalysis());
      expect(result).toBeNull();
    });

    it('should extract name even without company', async () => {
      const analysis = makeAnalysis({
        extractedText: [
          { text: 'Jane Smith', confidence: 0.9, textType: 'label' },
        ],
      });
      const result = await agent.processImage(makeImage(), analysis);
      expect(result).toBeDefined();
      expect(result!.name).toBe('Jane Smith');
    });

    it('should parse first and last name correctly', async () => {
      const analysis = makeAnalysis({
        extractedText: [
          { text: 'John Michael Smith', confidence: 0.9, textType: 'label' },
        ],
      });
      const result = await agent.processImage(makeImage(), analysis);
      expect(result).toBeDefined();
      expect(result!.firstName).toBe('John');
      expect(result!.lastName).toBe('Michael Smith');
    });
  });

  describe('Contact Management', () => {
    it('should deduplicate contacts by email', async () => {
      // First scan
      await agent.processImage(makeImage({ id: 'img-1' }), makeBadgeAnalysis());

      // Second scan with same email
      await agent.processImage(makeImage({ id: 'img-2' }), makeBadgeAnalysis());

      expect(agent.getContacts()).toHaveLength(1);
      expect(agent.getContacts()[0].imageRefs).toContain('img-1');
      expect(agent.getContacts()[0].imageRefs).toContain('img-2');
    });

    it('should deduplicate contacts by name', async () => {
      const analysis1 = makeAnalysis({
        extractedText: [
          { text: 'John Doe', confidence: 0.9, textType: 'label' },
        ],
      });
      const analysis2 = makeAnalysis({
        extractedText: [
          { text: 'John Doe', confidence: 0.85, textType: 'label' },
          { text: 'john@example.com', confidence: 0.8, textType: 'other' },
        ],
      });

      await agent.processImage(makeImage({ id: 'img-1' }), analysis1);
      await agent.processImage(makeImage({ id: 'img-2' }), analysis2);

      const contacts = agent.getContacts();
      expect(contacts).toHaveLength(1);
      // Should have merged the email from the second scan
      expect(contacts[0].email).toBe('john@example.com');
    });

    it('should add notes to a contact', async () => {
      const contact = await agent.processImage(makeImage(), makeBadgeAnalysis());

      const success = agent.addNote(contact!.id, 'Met at TechCrunch Disrupt');
      expect(success).toBe(true);

      const found = agent.getContact(contact!.id);
      expect(found!.notes).toContain('Met at TechCrunch Disrupt');
    });

    it('should search contacts by name', async () => {
      await agent.processImage(
        makeImage(),
        makeAnalysis({
          extractedText: [
            { text: 'Alice Johnson', confidence: 0.9, textType: 'label' },
          ],
        }),
      );
      await agent.processImage(
        makeImage({ id: 'img-2' }),
        makeAnalysis({
          extractedText: [
            { text: 'Bob Wilson', confidence: 0.9, textType: 'label' },
          ],
        }),
      );

      const results = agent.searchContacts('alice');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice Johnson');
    });

    it('should search contacts by company', async () => {
      await agent.processImage(makeImage(), makeBusinessCardAnalysis());

      const results = agent.searchContacts('acme');
      expect(results).toHaveLength(1);
    });

    it('should enforce cache limit', async () => {
      const agent = new NetworkingAgent({
        autoResearch: false,
        maxContactsCache: 2,
        debug: true,
      });

      for (let i = 0; i < 5; i++) {
        const analysis = makeAnalysis({
          extractedText: [
            { text: `Person Number${i}`, confidence: 0.9, textType: 'label' },
          ],
        });
        await agent.processImage(makeImage({ id: `img-${i}` }), analysis);
      }

      expect(agent.getContacts().length).toBeLessThanOrEqual(2);
    });
  });

  describe('Research', () => {
    it('should research a person with search results', async () => {
      const agent = new NetworkingAgent({
        searchFn: async () => makeSearchResults(),
        autoResearch: true,
        debug: true,
      });

      const contact = await agent.processImage(makeImage(), makeBadgeAnalysis());

      expect(contact).toBeDefined();
      expect(contact!.research).toBeDefined();
      expect(contact!.research!.sources.length).toBeGreaterThan(0);
    });

    it('should detect funding events from search results', async () => {
      const agent = new NetworkingAgent({
        searchFn: async () => makeSearchResults(),
        autoResearch: true,
        debug: true,
      });

      const contact = await agent.processImage(makeImage(), makeBadgeAnalysis());

      expect(contact!.research!.fundingEvents.length).toBeGreaterThan(0);
      expect(contact!.research!.fundingEvents[0].amount).toContain('6.5');
    });

    it('should generate conversation topics', async () => {
      const agent = new NetworkingAgent({
        searchFn: async () => makeSearchResults(),
        autoResearch: true,
        debug: true,
      });

      const contact = await agent.processImage(makeImage(), makeBadgeAnalysis());

      expect(contact!.research!.conversationTopics.length).toBeGreaterThan(0);
    });

    it('should generate ice breakers', async () => {
      const agent = new NetworkingAgent({
        searchFn: async () => makeSearchResults(),
        autoResearch: true,
        debug: true,
      });

      const contact = await agent.processImage(makeImage(), makeBadgeAnalysis());

      expect(contact!.research!.iceBreakers.length).toBeGreaterThan(0);
    });

    it('should handle research failure gracefully', async () => {
      const agent = new NetworkingAgent({
        searchFn: async () => {
          throw new Error('Network error');
        },
        autoResearch: true,
        debug: true,
      });

      // Should not throw
      const contact = await agent.processImage(makeImage(), makeBadgeAnalysis());
      expect(contact).toBeDefined();
      expect(contact!.name).toBe('Sarah Chen');
    });

    it('should build a research summary', async () => {
      const agent = new NetworkingAgent({
        searchFn: async () => makeSearchResults(),
        autoResearch: true,
        debug: true,
      });

      const contact = await agent.processImage(makeImage(), makeBadgeAnalysis());

      expect(contact!.research!.summary).toBeDefined();
      expect(contact!.research!.summary!.length).toBeGreaterThan(0);
    });
  });

  describe('Voice Briefing', () => {
    it('should build a briefing with name and title', async () => {
      const contact = await agent.processImage(makeImage(), makeBadgeAnalysis());
      const briefing = agent.buildBriefing(contact!);

      expect(briefing).toContain('Sarah Chen');
    });

    it('should include company in briefing', async () => {
      const contact = await agent.processImage(makeImage(), makeBusinessCardAnalysis());
      const briefing = agent.buildBriefing(contact!);

      expect(briefing).toContain('Acme Technologies');
    });

    it('should include research insights in briefing', async () => {
      const agent = new NetworkingAgent({
        searchFn: async () => makeSearchResults(),
        autoResearch: true,
        debug: true,
      });

      const contact = await agent.processImage(makeImage(), makeBadgeAnalysis());
      const briefing = agent.buildBriefing(contact!);

      // Should mention funding or news
      expect(briefing.length).toBeGreaterThan(20);
    });

    it('should emit voice:briefing event', async () => {
      const handler = vi.fn();
      agent.on('voice:briefing', handler);

      const contact = await agent.processImage(makeImage(), makeBadgeAnalysis());
      agent.buildBriefing(contact!);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Context Router Handler', () => {
    it('should return handled response for valid badge', async () => {
      const response = await agent.handle(
        makeImage(),
        makeBadgeAnalysis(),
        {
          activeMode: 'networking',
          trigger: 'voice',
          recentModes: [],
        },
      );

      expect(response.agentId).toBe('networking');
      expect(response.handled).toBe(true);
      expect(response.voiceResponse).toBeDefined();
      expect(response.confidence).toBeGreaterThan(0.5);
    });

    it('should return not-handled for image without contacts', async () => {
      const response = await agent.handle(
        makeImage(),
        makeAnalysis(),
        {
          activeMode: 'networking',
          trigger: 'auto',
          recentModes: [],
        },
      );

      expect(response.handled).toBe(false);
      expect(response.confidence).toBeLessThan(0.5);
    });
  });

  describe('Extraction Patterns', () => {
    it('should extract email addresses', () => {
      const result = agent.extractContactFromAnalysis(
        makeAnalysis({
          extractedText: [
            { text: 'John Smith', confidence: 0.9, textType: 'label' },
            { text: 'john.smith@company.co', confidence: 0.8, textType: 'other' },
          ],
        }),
      );

      expect(result!.email).toBe('john.smith@company.co');
    });

    it('should extract phone numbers', () => {
      const result = agent.extractContactFromAnalysis(
        makeAnalysis({
          extractedText: [
            { text: 'Jane Doe', confidence: 0.9, textType: 'label' },
            { text: '(555) 987-6543', confidence: 0.8, textType: 'other' },
          ],
        }),
      );

      expect(result!.phone).toBe('(555) 987-6543');
    });

    it('should extract LinkedIn URLs', () => {
      const result = agent.extractContactFromAnalysis(
        makeAnalysis({
          extractedText: [
            { text: 'Bob Williams', confidence: 0.9, textType: 'label' },
            {
              text: 'linkedin.com/in/bob-williams',
              confidence: 0.8,
              textType: 'other',
            },
          ],
        }),
      );

      expect(result!.linkedin).toContain('linkedin.com/in/bob-williams');
    });

    it('should extract GitHub handle', () => {
      const result = agent.extractContactFromAnalysis(
        makeAnalysis({
          extractedText: [
            { text: 'Dev Person', confidence: 0.9, textType: 'label' },
            {
              text: 'github.com/devperson',
              confidence: 0.8,
              textType: 'other',
            },
          ],
        }),
      );

      expect(result!.socials.github).toBe('devperson');
    });

    it('should skip email-only lines as names', () => {
      const result = agent.extractContactFromAnalysis(
        makeAnalysis({
          extractedText: [
            { text: 'hello@world.com', confidence: 0.9, textType: 'other' },
            { text: 'Real Name', confidence: 0.85, textType: 'label' },
          ],
        }),
      );

      expect(result).toBeDefined();
      expect(result!.name).toBe('Real Name');
    });
  });

  describe('Stats', () => {
    it('should track scan statistics', async () => {
      await agent.processImage(makeImage(), makeBadgeAnalysis());
      await agent.processImage(makeImage(), makeAnalysis());

      const stats = agent.getStats();
      expect(stats.totalScans).toBe(2);
      expect(stats.totalContacts).toBe(1);
    });
  });
});
