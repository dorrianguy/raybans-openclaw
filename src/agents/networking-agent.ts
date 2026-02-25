/**
 * Networking Agent — Your personal intel analyst at events and meetings.
 *
 * Snap a name badge, business card, or person at a conference.
 * Agent reads the info, researches the person, and whispers a
 * 15-30 second briefing through the glasses speaker.
 *
 * Features:
 * - Name badge / business card OCR extraction
 * - Contact info parsing (name, title, company, email, phone, socials)
 * - Web research: LinkedIn-style profile, company intel, recent news
 * - Pre-meeting briefing from calendar attendees
 * - Contact auto-save with gathered intel
 * - Conversation openers based on research
 * - Follow-up reminders after events
 *
 * Revenue: Part of the core platform, but enhances "Sales Meeting Intelligence"
 * feature ($79-999/mo for sales teams).
 *
 * Usage:
 *   const agent = new NetworkingAgent({ ... });
 *   const result = await agent.processCard(image, analysis);
 *   // → "Sarah Chen, VP Eng at Stripe. They raised Series C last month.
 *   //    Ask about their infrastructure scaling challenges."
 */

import { EventEmitter } from 'eventemitter3';
import type {
  CapturedImage,
  VisionAnalysis,
  ExtractedText,
  PipelineResult,
} from '../types.js';
import type { RoutingContext, AgentResponse } from '../routing/context-router.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ContactInfo {
  /** Unique contact ID */
  id: string;
  /** Full name */
  name: string;
  /** First name (parsed) */
  firstName?: string;
  /** Last name (parsed) */
  lastName?: string;
  /** Job title */
  title?: string;
  /** Company/organization */
  company?: string;
  /** Email address */
  email?: string;
  /** Phone number */
  phone?: string;
  /** LinkedIn URL or handle */
  linkedin?: string;
  /** Twitter/X handle */
  twitter?: string;
  /** Website URL */
  website?: string;
  /** Other social media handles */
  socials: Record<string, string>;
  /** Where/when we met */
  context: ContactContext;
  /** Research gathered about this person */
  research?: PersonResearch;
  /** Images associated with this contact */
  imageRefs: string[];
  /** When this contact was first scanned */
  createdAt: string;
  /** When the contact was last updated */
  updatedAt: string;
  /** Notes added by the user */
  notes: string[];
  /** Tags for organization */
  tags: string[];
}

export interface ContactContext {
  /** Where we met */
  location?: string;
  /** Event/conference name */
  event?: string;
  /** How we met */
  circumstance?: string;
  /** Date of first meeting */
  datemet: string;
  /** GPS coordinates if available */
  latitude?: number;
  longitude?: number;
}

export interface PersonResearch {
  /** Professional summary */
  summary?: string;
  /** Company description */
  companyDescription?: string;
  /** Recent company news */
  companyNews: NewsItem[];
  /** Funding/financial events */
  fundingEvents: FundingEvent[];
  /** Suggested conversation topics */
  conversationTopics: string[];
  /** Suggested ice breakers */
  iceBreakers: string[];
  /** Professional interests/topics they post about */
  interests: string[];
  /** Mutual connections (if detectable) */
  mutualConnections: string[];
  /** When this research was gathered */
  researchedAt: string;
  /** Data sources used */
  sources: string[];
}

export interface NewsItem {
  title: string;
  source: string;
  date: string;
  url?: string;
  summary: string;
}

export interface FundingEvent {
  round: string;
  amount?: string;
  date: string;
  investors?: string[];
}

// ─── Configuration ──────────────────────────────────────────────

export interface NetworkingAgentConfig {
  /** Web search function — injected for testability */
  searchFn?: (query: string) => Promise<SearchResult[]>;
  /** Web fetch function — injected for testability */
  fetchFn?: (url: string) => Promise<string>;
  /** Maximum research time per person (ms) */
  maxResearchTimeMs?: number;
  /** Enable auto-research on every scan (vs. on-demand) */
  autoResearch?: boolean;
  /** Maximum contacts to cache in memory */
  maxContactsCache?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const DEFAULT_CONFIG: Required<NetworkingAgentConfig> = {
  searchFn: async () => [],
  fetchFn: async () => '',
  maxResearchTimeMs: 15000,
  autoResearch: true,
  maxContactsCache: 500,
  debug: false,
};

// ─── Events ─────────────────────────────────────────────────────

export interface NetworkingAgentEvents {
  /** Contact extracted from image */
  'contact:extracted': (contact: ContactInfo) => void;
  /** Research completed for a contact */
  'contact:researched': (contact: ContactInfo) => void;
  /** Contact saved/updated */
  'contact:saved': (contact: ContactInfo) => void;
  /** Voice briefing ready */
  'voice:briefing': (text: string) => void;
  /** Error */
  'error': (source: string, message: string) => void;
  /** Debug log */
  'log': (message: string) => void;
}

// ─── Agent Implementation ───────────────────────────────────────

export class NetworkingAgent extends EventEmitter<NetworkingAgentEvents> {
  private config: Required<NetworkingAgentConfig>;
  private contacts: Map<string, ContactInfo> = new Map();
  private scanCount = 0;

  constructor(config: NetworkingAgentConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Context Router Handler ─────────────────────────────────

  /**
   * Handle a routed image from the context router.
   * This is the main entry point from the routing system.
   */
  async handle(
    image: CapturedImage,
    analysis: VisionAnalysis,
    context: RoutingContext,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      const contact = await this.processImage(image, analysis);

      if (!contact) {
        return {
          agentId: 'networking',
          handled: false,
          confidence: 0.2,
          priority: 5,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // Build voice briefing
      const briefing = this.buildBriefing(contact);

      return {
        agentId: 'networking',
        handled: true,
        voiceResponse: briefing,
        data: { contact },
        confidence: 0.85,
        priority: 3,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      this.emit('error', 'handle', String(err));
      return {
        agentId: 'networking',
        handled: false,
        confidence: 0,
        priority: 99,
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  // ─── Processing ─────────────────────────────────────────────

  /**
   * Process an image to extract contact information.
   */
  async processImage(
    image: CapturedImage,
    analysis: VisionAnalysis,
  ): Promise<ContactInfo | null> {
    this.scanCount++;
    this.log(`Processing image #${this.scanCount} for contacts`);

    // Extract contact info from the vision analysis
    const extracted = this.extractContactFromAnalysis(analysis);

    if (!extracted) {
      this.log('No contact information found in image');
      return null;
    }

    this.log(`Extracted contact: ${extracted.name} (${extracted.company || 'unknown company'})`);

    // Check if we already have this contact
    const existing = this.findExistingContact(extracted);
    if (existing) {
      this.log(`Found existing contact: ${existing.name}`);
      const merged = this.mergeContactInfo(existing, extracted);
      merged.imageRefs.push(image.id);
      this.contacts.set(merged.id, merged);
      this.emit('contact:saved', merged);
      return merged;
    }

    // New contact — set up the full record
    const contact: ContactInfo = {
      ...extracted,
      name: extracted.name ?? 'Unknown',
      id: this.generateContactId(extracted.name ?? 'Unknown'),
      context: {
        datemet: image.capturedAt,
        latitude: image.location?.latitude,
        longitude: image.location?.longitude,
      },
      imageRefs: [image.id],
      createdAt: image.capturedAt,
      updatedAt: image.capturedAt,
      notes: [],
      tags: [],
      socials: extracted.socials || {},
    };

    // Auto-research if enabled
    if (this.config.autoResearch && (contact.name || contact.company)) {
      try {
        contact.research = await this.researchPerson(contact);
        this.emit('contact:researched', contact);
      } catch (err) {
        this.log(`Research failed for ${contact.name}: ${err}`);
      }
    }

    // Cache the contact
    this.contacts.set(contact.id, contact);
    this.emit('contact:extracted', contact);
    this.emit('contact:saved', contact);

    // Enforce cache limit
    this.enforceCacheLimit();

    return contact;
  }

  // ─── Extraction ─────────────────────────────────────────────

  /**
   * Extract contact information from vision analysis.
   * Parses text found on badges, cards, and name plates.
   */
  extractContactFromAnalysis(
    analysis: VisionAnalysis,
  ): Partial<ContactInfo> | null {
    const texts = analysis.extractedText;
    if (texts.length === 0) return null;

    // Combine all text for parsing
    const allText = texts.map((t) => t.text).join('\n');

    // Try to extract structured contact info
    const name = this.extractName(allText, texts);
    if (!name) return null;

    const parsedName = this.parseName(name);

    return {
      name,
      firstName: parsedName.first,
      lastName: parsedName.last,
      title: this.extractTitle(allText),
      company: this.extractCompany(allText, texts),
      email: this.extractEmail(allText),
      phone: this.extractPhone(allText),
      linkedin: this.extractLinkedIn(allText),
      twitter: this.extractTwitter(allText),
      website: this.extractWebsite(allText),
      socials: this.extractSocials(allText),
    };
  }

  /**
   * Extract a person's name from text.
   */
  private extractName(fullText: string, texts: ExtractedText[]): string | null {
    // Strategy 1: Look for text tagged as a name/label near person context
    const labelTexts = texts.filter(
      (t) => t.textType === 'label' || t.textType === 'other',
    );

    // Strategy 2: Look for name patterns
    // Names are typically the first or most prominent text on a badge/card
    const lines = fullText.split('\n').map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      // Skip lines that look like titles, emails, phones, URLs
      if (this.looksLikeEmail(line)) continue;
      if (this.looksLikePhone(line)) continue;
      if (this.looksLikeUrl(line)) continue;
      if (this.looksLikeTitle(line)) continue;
      if (this.looksLikeCompany(line)) continue;

      // A name is typically 2-4 words, each capitalized, no special chars
      const namePattern = /^[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){1,3}$/;
      if (namePattern.test(line) && line.length >= 3 && line.length <= 60) {
        return line;
      }
    }

    // Strategy 3: First line that's short and doesn't match other patterns
    for (const line of lines) {
      const wordCount = line.split(/\s+/).length;
      if (
        line.length >= 3 &&
        line.length <= 40 &&
        wordCount >= 2 &&
        wordCount <= 4 &&
        !this.looksLikeEmail(line) &&
        !this.looksLikePhone(line) &&
        !this.looksLikeUrl(line) &&
        !this.looksLikeTitle(line) &&
        !this.looksLikeCompany(line)
      ) {
        return line;
      }
    }

    return null;
  }

  /**
   * Parse a full name into first and last.
   */
  private parseName(fullName: string): { first?: string; last?: string } {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 0) return {};
    if (parts.length === 1) return { first: parts[0] };
    return {
      first: parts[0],
      last: parts.slice(1).join(' '),
    };
  }

  /**
   * Extract job title from text.
   */
  private extractTitle(text: string): string | undefined {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    // Common title patterns
    const titlePatterns = [
      /\b(CEO|CTO|CFO|COO|CMO|CIO|CISO|VP|SVP|EVP|Director|Manager|Lead|Head|Chief|Principal|Senior|Junior|Staff|Associate|Partner|Founder|Co-Founder)\b/i,
      /\b(Engineer|Developer|Designer|Analyst|Consultant|Architect|Scientist|Researcher|Strategist|Coordinator|Specialist|Administrator)\b/i,
      /\b(President|Chairman|Secretary|Treasurer|Officer)\b/i,
    ];

    for (const line of lines) {
      if (this.looksLikeEmail(line)) continue;
      if (this.looksLikePhone(line)) continue;
      if (this.looksLikeUrl(line)) continue;

      for (const pattern of titlePatterns) {
        if (pattern.test(line) && line.length <= 80) {
          return line;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract company name from text.
   */
  private extractCompany(text: string, texts: ExtractedText[]): string | undefined {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    // Company indicators
    const companyPatterns = [
      /\b(Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation|Company|Co\.?|Group|Holdings|Partners|Ventures|Labs|Studio|Agency|Consulting)\b/i,
      /\b(Technologies|Solutions|Systems|Services|Networks|Digital|Global|International)\b/i,
    ];

    for (const line of lines) {
      if (this.looksLikeEmail(line)) continue;
      if (this.looksLikePhone(line)) continue;
      if (this.looksLikeUrl(line)) continue;

      for (const pattern of companyPatterns) {
        if (pattern.test(line) && line.length <= 60) {
          return line;
        }
      }
    }

    // Check if any text was labeled as company by vision model
    for (const t of texts) {
      if (t.textType === 'label' && this.looksLikeCompany(t.text)) {
        return t.text;
      }
    }

    return undefined;
  }

  /**
   * Extract email from text.
   */
  private extractEmail(text: string): string | undefined {
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const match = text.match(emailPattern);
    return match ? match[0].toLowerCase() : undefined;
  }

  /**
   * Extract phone number from text.
   */
  private extractPhone(text: string): string | undefined {
    const phonePatterns = [
      /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
      /(?:\+\d{1,3}[-.\s]?)?\d{10,12}/,
    ];
    for (const pattern of phonePatterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    return undefined;
  }

  /**
   * Extract LinkedIn URL or handle from text.
   */
  private extractLinkedIn(text: string): string | undefined {
    const patterns = [
      /linkedin\.com\/in\/[a-zA-Z0-9_-]+/i,
      /(?:linkedin|li):\s*([a-zA-Z0-9_-]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    return undefined;
  }

  /**
   * Extract Twitter/X handle from text.
   */
  private extractTwitter(text: string): string | undefined {
    // Check twitter/x URLs first (most reliable)
    const urlPatterns = [
      /(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/i,
    ];
    for (const pattern of urlPatterns) {
      const match = text.match(pattern);
      if (match?.[1]) return `@${match[1]}`;
    }

    // Look for @ handles that are NOT email addresses
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip emails
      if (this.looksLikeEmail(trimmed)) continue;
      // Match standalone @handle (not part of an email)
      const handleMatch = trimmed.match(/(?:^|[\s(])@([a-zA-Z0-9_]{1,15})(?:\s|$|[),.])/);
      if (handleMatch?.[1]) return `@${handleMatch[1]}`;
    }
    return undefined;
  }

  /**
   * Extract website URL from text.
   */
  private extractWebsite(text: string): string | undefined {
    const urlPattern =
      /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/i;
    const match = text.match(urlPattern);
    if (match) {
      const url = match[0];
      // Skip social media and email domains
      if (
        /linkedin|twitter|facebook|instagram|github|x\.com/i.test(url)
      ) {
        return undefined;
      }
      return url;
    }
    return undefined;
  }

  /**
   * Extract other social media handles from text.
   */
  private extractSocials(text: string): Record<string, string> {
    const socials: Record<string, string> = {};

    const patterns: [string, RegExp][] = [
      ['github', /github\.com\/([a-zA-Z0-9_-]+)/i],
      ['instagram', /instagram\.com\/([a-zA-Z0-9_.]+)/i],
      ['facebook', /facebook\.com\/([a-zA-Z0-9_.]+)/i],
    ];

    for (const [platform, pattern] of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        socials[platform] = match[1];
      }
    }

    return socials;
  }

  // ─── Research ───────────────────────────────────────────────

  /**
   * Research a person by name and company.
   */
  async researchPerson(contact: ContactInfo): Promise<PersonResearch> {
    this.log(`Researching: ${contact.name}${contact.company ? ` at ${contact.company}` : ''}`);
    const startTime = Date.now();

    const research: PersonResearch = {
      companyNews: [],
      fundingEvents: [],
      conversationTopics: [],
      iceBreakers: [],
      interests: [],
      mutualConnections: [],
      researchedAt: new Date().toISOString(),
      sources: [],
    };

    const searchQueries: string[] = [];

    // Build search queries
    if (contact.name && contact.company) {
      searchQueries.push(`"${contact.name}" "${contact.company}"`);
    }
    if (contact.company) {
      searchQueries.push(`"${contact.company}" news recent`);
      searchQueries.push(`"${contact.company}" funding`);
    }
    if (contact.linkedin) {
      searchQueries.push(`site:linkedin.com ${contact.name}`);
    }

    // Execute searches within time budget
    const deadline = startTime + this.config.maxResearchTimeMs;
    const searchResults: SearchResult[] = [];

    for (const query of searchQueries) {
      if (Date.now() >= deadline) break;

      try {
        const results = await this.config.searchFn(query);
        searchResults.push(...results);
        research.sources.push(`search: ${query}`);
      } catch (err) {
        this.log(`Search failed: ${query}: ${err}`);
      }
    }

    // Parse search results into structured research
    this.parseResearchResults(research, searchResults, contact);

    // Generate conversation topics and ice breakers
    research.conversationTopics = this.generateConversationTopics(contact, research);
    research.iceBreakers = this.generateIceBreakers(contact, research);

    // Build summary
    research.summary = this.buildResearchSummary(contact, research);

    const elapsed = Date.now() - startTime;
    this.log(`Research complete for ${contact.name}: ${elapsed}ms, ${searchResults.length} results`);

    return research;
  }

  /**
   * Parse search results into structured research data.
   */
  private parseResearchResults(
    research: PersonResearch,
    results: SearchResult[],
    contact: ContactInfo,
  ): void {
    for (const result of results) {
      const snippet = result.snippet.toLowerCase();
      const title = result.title.toLowerCase();

      // Company news detection — normalize company name for matching
      // "Stripe Inc." → match "stripe", "Stripe Inc" → match "stripe"
      const companyNormalized = contact.company
        ?.toLowerCase()
        .replace(/\s*(inc\.?|llc|ltd\.?|corp\.?|co\.?|company|group|holdings)\s*/gi, ' ')
        .replace(/[.,]+/g, '')
        .trim();
      const companyMatches = companyNormalized && (
        snippet.includes(companyNormalized) ||
        title.includes(companyNormalized)
      );

      if (contact.company && companyMatches) {
        // Funding detection
        if (/(?:raised?|funding|series [a-z]|seed|round|million|billion|investment)/i.test(result.snippet)) {
          const fundingMatch = result.snippet.match(
            /(?:raised?|secured?)\s+\$?([\d.]+)\s*(million|billion|M|B)/i,
          );
          const roundMatch = result.snippet.match(
            /(seed|series [a-z]|pre-seed|bridge|extension)/i,
          );

          research.fundingEvents.push({
            round: roundMatch?.[1] || 'Unknown',
            amount: fundingMatch
              ? `$${fundingMatch[1]}${fundingMatch[2]}`
              : undefined,
            date: new Date().toISOString().split('T')[0],
          });
        }

        // General news
        research.companyNews.push({
          title: result.title,
          source: new URL(result.url).hostname,
          date: new Date().toISOString().split('T')[0],
          url: result.url,
          summary: result.snippet.slice(0, 200),
        });
      }

      // Interests detection from personal results
      if (contact.name && snippet.includes(contact.name.toLowerCase())) {
        const topicPatterns = [
          /(?:talks? about|writes? about|passionate about|expert in|focusing on|working on)\s+([^.]+)/i,
          /(?:published|authored|wrote|presented)\s+(?:.*?(?:about|on))\s+([^.]+)/i,
        ];
        for (const pattern of topicPatterns) {
          const match = result.snippet.match(pattern);
          if (match?.[1] && match[1].length < 80) {
            research.interests.push(match[1].trim());
          }
        }
      }
    }

    // Deduplicate
    research.interests = [...new Set(research.interests)];
    research.companyNews = research.companyNews.slice(0, 5);
    research.fundingEvents = research.fundingEvents.slice(0, 3);
  }

  /**
   * Generate conversation topics based on research.
   */
  private generateConversationTopics(
    contact: ContactInfo,
    research: PersonResearch,
  ): string[] {
    const topics: string[] = [];

    // Recent funding
    if (research.fundingEvents.length > 0) {
      const latest = research.fundingEvents[0];
      topics.push(
        `Recent ${latest.round} funding${latest.amount ? ` (${latest.amount})` : ''} — ask about growth plans`,
      );
    }

    // Company news
    if (research.companyNews.length > 0) {
      topics.push(
        `Recent news: ${research.companyNews[0].title.slice(0, 80)}`,
      );
    }

    // Their interests
    for (const interest of research.interests.slice(0, 2)) {
      topics.push(`They're interested in: ${interest}`);
    }

    // Role-based topics
    if (contact.title) {
      const title = contact.title.toLowerCase();
      if (title.includes('eng') || title.includes('dev') || title.includes('cto')) {
        topics.push('Ask about their tech stack and scaling challenges');
      }
      if (title.includes('product') || title.includes('design')) {
        topics.push('Ask about their product roadmap and user research');
      }
      if (title.includes('sales') || title.includes('marketing') || title.includes('cmo')) {
        topics.push('Ask about their go-to-market strategy');
      }
      if (title.includes('ceo') || title.includes('founder')) {
        topics.push('Ask about their founding story and vision');
      }
    }

    return topics.slice(0, 5);
  }

  /**
   * Generate ice breaker suggestions.
   */
  private generateIceBreakers(
    contact: ContactInfo,
    research: PersonResearch,
  ): string[] {
    const breakers: string[] = [];

    if (research.fundingEvents.length > 0) {
      breakers.push(
        `"Congrats on the recent funding! What's the team most excited to tackle next?"`,
      );
    }

    if (research.companyNews.length > 0) {
      breakers.push(
        `"I saw the news about ${research.companyNews[0].title.slice(0, 40)}... — tell me more about that."`,
      );
    }

    if (contact.title && contact.company) {
      breakers.push(
        `"What's the most exciting thing happening at ${contact.company} right now?"`,
      );
    }

    if (research.interests.length > 0) {
      breakers.push(
        `"I hear you're into ${research.interests[0]} — I'd love to hear your take."`,
      );
    }

    // Generic fallbacks
    breakers.push(`"What brought you here today?"`);

    return breakers.slice(0, 3);
  }

  /**
   * Build a research summary.
   */
  private buildResearchSummary(
    contact: ContactInfo,
    research: PersonResearch,
  ): string {
    const parts: string[] = [];

    if (contact.title && contact.company) {
      parts.push(`${contact.title} at ${contact.company}.`);
    } else if (contact.company) {
      parts.push(`Works at ${contact.company}.`);
    }

    if (research.fundingEvents.length > 0) {
      const latest = research.fundingEvents[0];
      parts.push(
        `Company recently raised ${latest.amount || 'funding'} (${latest.round}).`,
      );
    }

    if (research.companyNews.length > 0) {
      parts.push(`Recent: ${research.companyNews[0].summary.slice(0, 100)}.`);
    }

    if (research.interests.length > 0) {
      parts.push(`Interested in: ${research.interests.join(', ')}.`);
    }

    return parts.join(' ');
  }

  // ─── Voice Briefing ────────────────────────────────────────

  /**
   * Build a TTS-friendly briefing for a contact.
   * Target: 15-30 seconds of speech (roughly 40-80 words).
   */
  buildBriefing(contact: ContactInfo): string {
    const parts: string[] = [];

    // Name and title
    if (contact.title && contact.company) {
      parts.push(`${contact.name}, ${contact.title} at ${contact.company}.`);
    } else if (contact.company) {
      parts.push(`${contact.name} from ${contact.company}.`);
    } else {
      parts.push(`${contact.name}.`);
    }

    // Key research insight (just the most important one)
    if (contact.research) {
      if (contact.research.fundingEvents.length > 0) {
        const latest = contact.research.fundingEvents[0];
        parts.push(
          `They just raised ${latest.amount || latest.round} funding.`,
        );
      } else if (contact.research.companyNews.length > 0) {
        const news = contact.research.companyNews[0];
        parts.push(`Recent news: ${news.title.slice(0, 60)}.`);
      } else if (contact.research.interests.length > 0) {
        parts.push(
          `They're focused on ${contact.research.interests[0]}.`,
        );
      }

      // Conversation opener
      if (contact.research.iceBreakers.length > 0) {
        parts.push(`Try: ${contact.research.iceBreakers[0]}`);
      }
    }

    const briefing = parts.join(' ');
    this.emit('voice:briefing', briefing);
    return briefing;
  }

  // ─── Contact Management ─────────────────────────────────────

  /**
   * Find an existing contact that matches new extraction.
   */
  findExistingContact(extracted: Partial<ContactInfo>): ContactInfo | null {
    for (const contact of this.contacts.values()) {
      // Match by email (most unique)
      if (extracted.email && contact.email === extracted.email) {
        return contact;
      }

      // Match by name + company
      if (
        extracted.name &&
        extracted.company &&
        contact.name.toLowerCase() === extracted.name.toLowerCase() &&
        contact.company?.toLowerCase() === extracted.company?.toLowerCase()
      ) {
        return contact;
      }

      // Match by exact name (less reliable but useful)
      if (
        extracted.name &&
        contact.name.toLowerCase() === extracted.name.toLowerCase()
      ) {
        return contact;
      }
    }

    return null;
  }

  /**
   * Merge new info into an existing contact.
   */
  private mergeContactInfo(
    existing: ContactInfo,
    newInfo: Partial<ContactInfo>,
  ): ContactInfo {
    return {
      ...existing,
      // Update fields only if the new info has a value and existing doesn't
      title: newInfo.title || existing.title,
      company: newInfo.company || existing.company,
      email: newInfo.email || existing.email,
      phone: newInfo.phone || existing.phone,
      linkedin: newInfo.linkedin || existing.linkedin,
      twitter: newInfo.twitter || existing.twitter,
      website: newInfo.website || existing.website,
      socials: { ...existing.socials, ...(newInfo.socials || {}) },
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Add a note to a contact.
   */
  addNote(contactId: string, note: string): boolean {
    const contact = this.contacts.get(contactId);
    if (!contact) return false;

    contact.notes.push(note);
    contact.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Get all contacts.
   */
  getContacts(): ContactInfo[] {
    return Array.from(this.contacts.values());
  }

  /**
   * Get a contact by ID.
   */
  getContact(id: string): ContactInfo | null {
    return this.contacts.get(id) || null;
  }

  /**
   * Search contacts by name, company, or tag.
   */
  searchContacts(query: string): ContactInfo[] {
    const q = query.toLowerCase();
    return Array.from(this.contacts.values()).filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q)) ||
      c.notes.some((n) => n.toLowerCase().includes(q)),
    );
  }

  /**
   * Get scan statistics.
   */
  getStats(): {
    totalScans: number;
    totalContacts: number;
    contactsWithResearch: number;
  } {
    const contacts = Array.from(this.contacts.values());
    return {
      totalScans: this.scanCount,
      totalContacts: contacts.length,
      contactsWithResearch: contacts.filter((c) => c.research).length,
    };
  }

  // ─── Private: Helpers ───────────────────────────────────────

  private looksLikeEmail(text: string): boolean {
    return /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text);
  }

  private looksLikePhone(text: string): boolean {
    return /^\+?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(text.trim());
  }

  private looksLikeUrl(text: string): boolean {
    return /^(?:https?:\/\/|www\.)/i.test(text.trim());
  }

  private looksLikeTitle(text: string): boolean {
    return /\b(CEO|CTO|CFO|VP|Director|Manager|Engineer|Designer|Developer|Lead|Head|Chief|Partner|Founder)\b/i.test(text);
  }

  private looksLikeCompany(text: string): boolean {
    return /\b(Inc|LLC|Ltd|Corp|Company|Co\.|Group|Holdings|Technologies|Solutions|Labs|Studio)\b/i.test(text);
  }

  private generateContactId(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const suffix = Date.now().toString(36).slice(-4);
    return `contact-${slug}-${suffix}`;
  }

  private enforceCacheLimit(): void {
    if (this.contacts.size > this.config.maxContactsCache) {
      // Remove oldest contacts
      const sorted = Array.from(this.contacts.entries())
        .sort(([, a], [, b]) => a.createdAt.localeCompare(b.createdAt));

      const toRemove = sorted.slice(0, this.contacts.size - this.config.maxContactsCache);
      for (const [id] of toRemove) {
        this.contacts.delete(id);
      }
    }
  }

  private log(message: string): void {
    if (this.config.debug) {
      this.emit('log', `[NetworkingAgent] ${message}`);
    }
  }
}
