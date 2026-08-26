/**
 * Customer Feedback Engine — In-app feedback, NPS scoring, and support ticketing.
 *
 * Critical for SaaS retention: understand customer satisfaction, collect feature
 * requests, manage support tickets, and track NPS (Net Promoter Score).
 *
 * Features:
 * - NPS survey system (0-10 scoring with follow-up questions)
 * - CSAT (Customer Satisfaction) surveys (1-5 stars)
 * - Feature request collection and voting
 * - Bug report pipeline with auto-categorization
 * - Support ticket lifecycle (open → assigned → in-progress → resolved → closed)
 * - Sentiment analysis on free-text feedback (keyword-based)
 * - Customer health scoring (usage + satisfaction + engagement)
 * - Churn risk detection from feedback patterns
 * - Feedback analytics (trends, top requests, satisfaction over time)
 * - Voice-first feedback collection via glasses ("Rate your experience")
 * - Automated follow-up triggers (low NPS → outreach)
 *
 * 🌙 Night Shift Agent — Shift #34
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export type FeedbackType = 'nps' | 'csat' | 'feature_request' | 'bug_report' | 'general' | 'voice';

export type NPSCategory = 'promoter' | 'passive' | 'detractor';

export type TicketStatus = 'open' | 'assigned' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';

export type TicketPriority = 'critical' | 'high' | 'medium' | 'low';

export type SentimentScore = 'very_positive' | 'positive' | 'neutral' | 'negative' | 'very_negative';

export type ChurnRisk = 'high' | 'medium' | 'low' | 'none';

export type FeatureRequestStatus = 'submitted' | 'under_review' | 'planned' | 'in_progress' | 'shipped' | 'declined';

export interface Feedback {
  id: string;
  type: FeedbackType;
  customerId: string;
  tenantId?: string;
  /** NPS score (0-10) or CSAT score (1-5) */
  score?: number;
  /** Free-text comment */
  comment?: string;
  /** Analyzed sentiment */
  sentiment?: SentimentScore;
  /** What triggered the feedback (session_end, manual, scheduled, voice) */
  trigger: string;
  /** Tags for categorization */
  tags: string[];
  /** Context (what was the user doing) */
  context?: FeedbackContext;
  /** Timestamp */
  createdAt: number;
  /** Whether follow-up was triggered */
  followUpTriggered: boolean;
}

export interface FeedbackContext {
  /** Active session type when feedback was given */
  sessionType?: string;
  /** Number of items scanned (if inventory) */
  itemsScanned?: number;
  /** Agent that was active */
  activeAgent?: string;
  /** Duration of the session */
  sessionDurationMin?: number;
  /** Device type */
  deviceType?: string;
  /** User's plan */
  plan?: string;
}

export interface SupportTicket {
  id: string;
  customerId: string;
  tenantId?: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  /** Assigned support agent */
  assignedTo?: string;
  /** Related feedback ID */
  feedbackId?: string;
  /** Tags */
  tags: string[];
  /** Conversation thread */
  messages: TicketMessage[];
  /** Resolution notes */
  resolution?: string;
  /** Time tracking */
  createdAt: number;
  updatedAt: number;
  firstResponseAt?: number;
  resolvedAt?: number;
  closedAt?: number;
  /** SLA tracking */
  slaBreached: boolean;
  /** Customer satisfaction after resolution */
  resolutionSatisfaction?: number;
}

export interface TicketMessage {
  id: string;
  authorId: string;
  authorType: 'customer' | 'agent' | 'system';
  content: string;
  timestamp: number;
  attachments?: string[];
}

export interface FeatureRequest {
  id: string;
  title: string;
  description: string;
  customerId: string;
  tenantId?: string;
  status: FeatureRequestStatus;
  votes: Set<string>;  // set of customer IDs who voted
  priority: number;    // computed from votes + customer value
  category: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** Optional link to related ticket or shipped feature */
  relatedIds: string[];
}

export interface CustomerHealthScore {
  customerId: string;
  /** Overall health 0-100 */
  overallScore: number;
  /** Component scores */
  components: {
    satisfaction: number;     // from NPS/CSAT scores (0-100)
    engagement: number;       // from usage frequency (0-100)
    supportHealth: number;    // inverse of ticket volume/severity (0-100)
    featureAdoption: number;  // % of features used (0-100)
  };
  /** Churn risk assessment */
  churnRisk: ChurnRisk;
  /** Risk factors */
  riskFactors: string[];
  /** Recommended actions */
  recommendations: string[];
  /** Last updated */
  calculatedAt: number;
}

export interface NPSResults {
  totalResponses: number;
  promoters: number;
  passives: number;
  detractors: number;
  npsScore: number; // -100 to 100
  promoterPercentage: number;
  passivePercentage: number;
  detractorPercentage: number;
  averageScore: number;
  trend: 'improving' | 'stable' | 'declining';
}

export interface FeedbackEngineConfig {
  /** SLA for first response (hours) */
  slaFirstResponseHours: number;
  /** SLA for resolution (hours) */
  slaResolutionHours: number;
  /** Auto-trigger follow-up for NPS detractors */
  autoFollowUpDetractors: boolean;
  /** NPS survey cooldown (days between surveys per customer) */
  npsSurveyCooldownDays: number;
  /** Maximum tickets to retain */
  maxTickets: number;
  /** Maximum feedback entries to retain */
  maxFeedback: number;
  /** Maximum feature requests */
  maxFeatureRequests: number;
  /** Churn risk threshold for NPS (below this = high risk) */
  churnRiskNPSThreshold: number;
  /** Weights for health score components */
  healthWeights: {
    satisfaction: number;
    engagement: number;
    supportHealth: number;
    featureAdoption: number;
  };
}

export interface FeedbackEngineEvents {
  'feedback:submitted': Feedback;
  'feedback:followup': { feedbackId: string; customerId: string; reason: string };
  'ticket:created': SupportTicket;
  'ticket:updated': { ticketId: string; status: TicketStatus };
  'ticket:sla_breach': { ticketId: string; type: 'first_response' | 'resolution' };
  'ticket:resolved': { ticketId: string };
  'feature:requested': FeatureRequest;
  'feature:voted': { requestId: string; customerId: string };
  'feature:status_changed': { requestId: string; status: FeatureRequestStatus };
  'churn:risk_detected': { customerId: string; risk: ChurnRisk; factors: string[] };
  'nps:detractor': { feedbackId: string; customerId: string; score: number };
}

export interface FeedbackEngineStats {
  totalFeedback: number;
  totalTickets: number;
  openTickets: number;
  resolvedTickets: number;
  totalFeatureRequests: number;
  nps: NPSResults;
  averageCSAT: number;
  averageFirstResponseHours: number;
  averageResolutionHours: number;
  slaBreachRate: number;
  topCategories: { category: string; count: number }[];
  sentimentBreakdown: Record<SentimentScore, number>;
}

// ─── Default Config ─────────────────────────────────────────────

export const DEFAULT_FEEDBACK_CONFIG: FeedbackEngineConfig = {
  slaFirstResponseHours: 4,
  slaResolutionHours: 24,
  autoFollowUpDetractors: true,
  npsSurveyCooldownDays: 30,
  maxTickets: 5000,
  maxFeedback: 10000,
  maxFeatureRequests: 1000,
  churnRiskNPSThreshold: 6,
  healthWeights: {
    satisfaction: 0.35,
    engagement: 0.30,
    supportHealth: 0.20,
    featureAdoption: 0.15,
  },
};

// ─── Sentiment Keywords ─────────────────────────────────────────

const SENTIMENT_KEYWORDS: Record<SentimentScore, string[]> = {
  very_positive: [
    'amazing', 'incredible', 'outstanding', 'excellent', 'fantastic', 'love',
    'perfect', 'brilliant', 'superb', 'exceeded expectations', 'game changer',
    'life saver', 'best ever', 'blown away', 'revolutionary',
  ],
  positive: [
    'good', 'great', 'nice', 'helpful', 'useful', 'works well', 'satisfied',
    'happy', 'recommend', 'easy to use', 'impressed', 'solid', 'reliable',
    'efficient', 'smooth',
  ],
  neutral: [
    'okay', 'ok', 'fine', 'decent', 'average', 'adequate', 'expected',
    'so-so', 'nothing special', 'functional', 'does the job',
  ],
  negative: [
    'bad', 'poor', 'disappointing', 'frustrating', 'difficult', 'slow',
    'confusing', 'buggy', 'unreliable', 'expensive', 'not worth', 'annoying',
    'issues', 'problems', 'struggle',
  ],
  very_negative: [
    'terrible', 'horrible', 'awful', 'worst', 'hate', 'useless', 'broken',
    'waste of money', 'scam', 'disaster', 'unacceptable', 'furious',
    'canceling', 'switching', 'refund',
  ],
};

// ─── Auto-categorization Keywords ───────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'scanning': ['scan', 'barcode', 'capture', 'camera', 'image', 'photo', 'vision', 'recognition'],
  'accuracy': ['count', 'accurate', 'wrong', 'incorrect', 'error', 'missed', 'inaccurate', 'miscount'],
  'performance': ['slow', 'fast', 'speed', 'lag', 'freeze', 'crash', 'loading', 'timeout', 'performance'],
  'ui/ux': ['interface', 'dashboard', 'button', 'display', 'design', 'layout', 'confusing', 'navigation'],
  'voice': ['voice', 'tts', 'speech', 'command', 'microphone', 'speak', 'hear', 'audio'],
  'export': ['export', 'csv', 'excel', 'spreadsheet', 'report', 'download', 'data'],
  'billing': ['billing', 'payment', 'invoice', 'charge', 'subscription', 'pricing', 'plan', 'upgrade'],
  'connectivity': ['connection', 'offline', 'bluetooth', 'wifi', 'disconnect', 'pair', 'sync'],
  'glasses': ['glasses', 'ray-ban', 'meta', 'lens', 'frame', 'wearable', 'hardware'],
  'integration': ['integration', 'api', 'pos', 'shopify', 'square', 'quickbooks', 'connect'],
};

// ─── Feedback Engine ────────────────────────────────────────────

export class FeedbackEngine extends EventEmitter {
  private config: FeedbackEngineConfig;
  private feedback: Feedback[] = [];
  private tickets: Map<string, SupportTicket> = new Map();
  private featureRequests: Map<string, FeatureRequest> = new Map();
  private counters = { feedback: 0, tickets: 0, features: 0, messages: 0 };
  private lastNPSSurvey: Map<string, number> = new Map(); // customerId → timestamp

  constructor(config: Partial<FeedbackEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_FEEDBACK_CONFIG, ...config };
  }

  // ─── NPS Survey ───────────────────────────────────────────────

  /** Check if a customer is eligible for an NPS survey */
  canSurveyCustomer(customerId: string): boolean {
    const lastSurvey = this.lastNPSSurvey.get(customerId);
    if (!lastSurvey) return true;
    const cooldownMs = this.config.npsSurveyCooldownDays * 86400000;
    return Date.now() - lastSurvey >= cooldownMs;
  }

  /** Submit an NPS score (0-10) */
  submitNPS(customerId: string, score: number, comment?: string, context?: FeedbackContext): Feedback {
    const clampedScore = Math.max(0, Math.min(10, Math.round(score)));

    const fb = this.createFeedback({
      type: 'nps',
      customerId,
      score: clampedScore,
      comment,
      trigger: 'nps_survey',
      context,
    });

    this.lastNPSSurvey.set(customerId, Date.now());

    // Auto-follow-up for detractors
    if (clampedScore <= 6) {
      this.emit('nps:detractor', { feedbackId: fb.id, customerId, score: clampedScore });
      if (this.config.autoFollowUpDetractors) {
        fb.followUpTriggered = true;
        this.emit('feedback:followup', {
          feedbackId: fb.id,
          customerId,
          reason: `NPS detractor (score: ${clampedScore})`,
        });
      }
    }

    return fb;
  }

  /** Submit a CSAT score (1-5) */
  submitCSAT(customerId: string, score: number, comment?: string, context?: FeedbackContext): Feedback {
    const clampedScore = Math.max(1, Math.min(5, Math.round(score)));
    return this.createFeedback({
      type: 'csat',
      customerId,
      score: clampedScore,
      comment,
      trigger: 'csat_survey',
      context,
    });
  }

  /** Submit general feedback */
  submitFeedback(customerId: string, comment: string, type: FeedbackType = 'general', context?: FeedbackContext): Feedback {
    return this.createFeedback({
      type,
      customerId,
      comment,
      trigger: 'manual',
      context,
    });
  }

  /** Submit voice feedback (collected via glasses) */
  submitVoiceFeedback(customerId: string, transcribedText: string, context?: FeedbackContext): Feedback {
    return this.createFeedback({
      type: 'voice',
      customerId,
      comment: transcribedText,
      trigger: 'voice',
      context,
    });
  }

  /** Get NPS results */
  getNPSResults(since?: number): NPSResults {
    let npsResponses = this.feedback.filter(f => f.type === 'nps' && f.score !== undefined);
    if (since) {
      npsResponses = npsResponses.filter(f => f.createdAt >= since);
    }

    const total = npsResponses.length;
    if (total === 0) {
      return {
        totalResponses: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
        npsScore: 0,
        promoterPercentage: 0,
        passivePercentage: 0,
        detractorPercentage: 0,
        averageScore: 0,
        trend: 'stable',
      };
    }

    let promoters = 0, passives = 0, detractors = 0;
    let sumScore = 0;

    for (const fb of npsResponses) {
      const score = fb.score!;
      sumScore += score;
      const cat = this.classifyNPS(score);
      if (cat === 'promoter') promoters++;
      else if (cat === 'passive') passives++;
      else detractors++;
    }

    const npsScore = Math.round(((promoters - detractors) / total) * 100);

    // Calculate trend (compare last 30% of responses to first 30%)
    const trend = this.calculateNPSTrend(npsResponses);

    return {
      totalResponses: total,
      promoters,
      passives,
      detractors,
      npsScore,
      promoterPercentage: Math.round((promoters / total) * 100),
      passivePercentage: Math.round((passives / total) * 100),
      detractorPercentage: Math.round((detractors / total) * 100),
      averageScore: Math.round((sumScore / total) * 10) / 10,
      trend,
    };
  }

  /** Classify an NPS score */
  classifyNPS(score: number): NPSCategory {
    if (score >= 9) return 'promoter';
    if (score >= 7) return 'passive';
    return 'detractor';
  }

  // ─── Support Tickets ──────────────────────────────────────────

  /** Create a support ticket */
  createTicket(options: {
    customerId: string;
    subject: string;
    description: string;
    priority?: TicketPriority;
    category?: string;
    tenantId?: string;
    feedbackId?: string;
    tags?: string[];
  }): SupportTicket {
    const id = `ticket-${++this.counters.tickets}`;
    const category = options.category || this.autoCategorize(options.subject + ' ' + options.description);

    const ticket: SupportTicket = {
      id,
      customerId: options.customerId,
      tenantId: options.tenantId,
      subject: options.subject,
      description: options.description,
      status: 'open',
      priority: options.priority || this.autoPrioritize(options.description),
      category,
      tags: options.tags || [],
      messages: [{
        id: `msg-${++this.counters.messages}`,
        authorId: options.customerId,
        authorType: 'customer',
        content: options.description,
        timestamp: Date.now(),
      }],
      feedbackId: options.feedbackId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      slaBreached: false,
    };

    this.tickets.set(id, ticket);

    // Trim if over max
    if (this.tickets.size > this.config.maxTickets) {
      const oldest = [...this.tickets.entries()]
        .filter(([, t]) => t.status === 'closed')
        .sort((a, b) => a[1].closedAt! - b[1].closedAt!)
        .slice(0, 100);
      for (const [key] of oldest) {
        this.tickets.delete(key);
      }
    }

    this.emit('ticket:created', ticket);
    return ticket;
  }

  /** Update ticket status */
  updateTicketStatus(ticketId: string, status: TicketStatus): boolean {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return false;

    const now = Date.now();
    ticket.status = status;
    ticket.updatedAt = now;

    if (status === 'resolved') {
      ticket.resolvedAt = now;
      this.emit('ticket:resolved', { ticketId });
    }
    if (status === 'closed') {
      ticket.closedAt = now;
    }

    this.emit('ticket:updated', { ticketId, status });
    return true;
  }

  /** Assign a ticket to a support agent */
  assignTicket(ticketId: string, agentId: string): boolean {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return false;

    ticket.assignedTo = agentId;
    ticket.status = 'assigned';
    ticket.updatedAt = Date.now();

    if (!ticket.firstResponseAt) {
      ticket.firstResponseAt = Date.now();
    }

    this.emit('ticket:updated', { ticketId, status: 'assigned' });
    return true;
  }

  /** Add a message to a ticket */
  addTicketMessage(ticketId: string, authorId: string, authorType: 'customer' | 'agent' | 'system', content: string): boolean {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return false;

    const message: TicketMessage = {
      id: `msg-${++this.counters.messages}`,
      authorId,
      authorType,
      content,
      timestamp: Date.now(),
    };

    ticket.messages.push(message);
    ticket.updatedAt = Date.now();

    // Track first response time
    if (authorType === 'agent' && !ticket.firstResponseAt) {
      ticket.firstResponseAt = Date.now();
    }

    return true;
  }

  /** Resolve a ticket with resolution notes */
  resolveTicket(ticketId: string, resolution: string): boolean {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return false;

    ticket.resolution = resolution;
    return this.updateTicketStatus(ticketId, 'resolved');
  }

  /** Set resolution satisfaction score */
  setResolutionSatisfaction(ticketId: string, score: number): boolean {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return false;

    ticket.resolutionSatisfaction = Math.max(1, Math.min(5, Math.round(score)));
    return true;
  }

  /** Check SLA compliance for all open tickets */
  checkSLACompliance(): { ticketId: string; type: 'first_response' | 'resolution'; hoursOverdue: number }[] {
    const breaches: { ticketId: string; type: 'first_response' | 'resolution'; hoursOverdue: number }[] = [];
    const now = Date.now();

    for (const [ticketId, ticket] of this.tickets) {
      if (ticket.status === 'closed' || ticket.status === 'resolved') continue;

      // First response SLA
      if (!ticket.firstResponseAt) {
        const hoursElapsed = (now - ticket.createdAt) / 3600000;
        if (hoursElapsed > this.config.slaFirstResponseHours) {
          const hoursOverdue = Math.round((hoursElapsed - this.config.slaFirstResponseHours) * 10) / 10;
          breaches.push({ ticketId, type: 'first_response', hoursOverdue });
          if (!ticket.slaBreached) {
            ticket.slaBreached = true;
            this.emit('ticket:sla_breach', { ticketId, type: 'first_response' });
          }
        }
      }

      // Resolution SLA
      const hoursOpen = (now - ticket.createdAt) / 3600000;
      if (hoursOpen > this.config.slaResolutionHours) {
        const hoursOverdue = Math.round((hoursOpen - this.config.slaResolutionHours) * 10) / 10;
        breaches.push({ ticketId, type: 'resolution', hoursOverdue });
        if (!ticket.slaBreached) {
          ticket.slaBreached = true;
          this.emit('ticket:sla_breach', { ticketId, type: 'resolution' });
        }
      }
    }

    return breaches;
  }

  /** Get tickets with optional filters */
  getTickets(filters?: {
    status?: TicketStatus;
    priority?: TicketPriority;
    customerId?: string;
    category?: string;
    assignedTo?: string;
    limit?: number;
  }): SupportTicket[] {
    let results = [...this.tickets.values()];

    if (filters?.status) results = results.filter(t => t.status === filters.status);
    if (filters?.priority) results = results.filter(t => t.priority === filters.priority);
    if (filters?.customerId) results = results.filter(t => t.customerId === filters.customerId);
    if (filters?.category) results = results.filter(t => t.category === filters.category);
    if (filters?.assignedTo) results = results.filter(t => t.assignedTo === filters.assignedTo);

    results.sort((a, b) => b.updatedAt - a.updatedAt);

    if (filters?.limit) results = results.slice(0, filters.limit);
    return results;
  }

  /** Get a specific ticket */
  getTicket(ticketId: string): SupportTicket | null {
    return this.tickets.get(ticketId) || null;
  }

  // ─── Feature Requests ─────────────────────────────────────────

  /** Submit a feature request */
  submitFeatureRequest(customerId: string, title: string, description: string, category?: string, tags?: string[]): FeatureRequest {
    const id = `feature-${++this.counters.features}`;
    const request: FeatureRequest = {
      id,
      title,
      description,
      customerId,
      status: 'submitted',
      votes: new Set([customerId]),
      priority: 1,
      category: category || this.autoCategorize(title + ' ' + description),
      tags: tags || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      relatedIds: [],
    };

    this.featureRequests.set(id, request);
    this.emit('feature:requested', request);
    return request;
  }

  /** Vote for a feature request */
  voteForFeature(requestId: string, customerId: string): boolean {
    const request = this.featureRequests.get(requestId);
    if (!request) return false;
    if (request.votes.has(customerId)) return false;

    request.votes.add(customerId);
    request.priority = request.votes.size;
    request.updatedAt = Date.now();

    this.emit('feature:voted', { requestId, customerId });
    return true;
  }

  /** Remove vote from a feature request */
  unvoteFeature(requestId: string, customerId: string): boolean {
    const request = this.featureRequests.get(requestId);
    if (!request) return false;

    const removed = request.votes.delete(customerId);
    if (removed) {
      request.priority = request.votes.size;
      request.updatedAt = Date.now();
    }
    return removed;
  }

  /** Update feature request status */
  updateFeatureStatus(requestId: string, status: FeatureRequestStatus): boolean {
    const request = this.featureRequests.get(requestId);
    if (!request) return false;

    request.status = status;
    request.updatedAt = Date.now();

    this.emit('feature:status_changed', { requestId, status });
    return true;
  }

  /** Get feature requests sorted by votes */
  getFeatureRequests(filters?: {
    status?: FeatureRequestStatus;
    category?: string;
    customerId?: string;
    limit?: number;
  }): FeatureRequest[] {
    let results = [...this.featureRequests.values()];

    if (filters?.status) results = results.filter(r => r.status === filters.status);
    if (filters?.category) results = results.filter(r => r.category === filters.category);
    if (filters?.customerId) results = results.filter(r => r.customerId === filters.customerId);

    // Sort by votes (priority) descending
    results.sort((a, b) => b.priority - a.priority);

    if (filters?.limit) results = results.slice(0, filters.limit);
    return results;
  }

  /** Get a specific feature request */
  getFeatureRequest(requestId: string): FeatureRequest | null {
    return this.featureRequests.get(requestId) || null;
  }

  // ─── Sentiment Analysis ───────────────────────────────────────

  /** Analyze sentiment of a text */
  analyzeSentiment(text: string): SentimentScore {
    if (!text || text.trim().length === 0) return 'neutral';
    const lower = text.toLowerCase();

    let scores: Record<SentimentScore, number> = {
      very_positive: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      very_negative: 0,
    };

    for (const [sentiment, keywords] of Object.entries(SENTIMENT_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lower.includes(keyword)) {
          scores[sentiment as SentimentScore]++;
        }
      }
    }

    // Find the highest scoring sentiment
    let maxScore = 0;
    let result: SentimentScore = 'neutral';

    for (const [sentiment, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        result = sentiment as SentimentScore;
      }
    }

    return result;
  }

  // ─── Customer Health ──────────────────────────────────────────

  /** Calculate customer health score */
  calculateHealthScore(
    customerId: string,
    engagement: { sessionCount: number; lastActiveAt: number; featuresUsed: number; totalFeatures: number },
  ): CustomerHealthScore {
    const weights = this.config.healthWeights;

    // Satisfaction (from NPS and CSAT)
    const customerFeedback = this.feedback.filter(f => f.customerId === customerId);
    const npsScores = customerFeedback.filter(f => f.type === 'nps').map(f => f.score!).filter(s => s !== undefined);
    const csatScores = customerFeedback.filter(f => f.type === 'csat').map(f => f.score!).filter(s => s !== undefined);

    let satisfaction = 50; // default
    if (npsScores.length > 0) {
      const avgNPS = npsScores.reduce((a, b) => a + b, 0) / npsScores.length;
      satisfaction = (avgNPS / 10) * 100;
    } else if (csatScores.length > 0) {
      const avgCSAT = csatScores.reduce((a, b) => a + b, 0) / csatScores.length;
      satisfaction = (avgCSAT / 5) * 100;
    }

    // Engagement (based on session frequency and recency)
    const daysSinceActive = (Date.now() - engagement.lastActiveAt) / 86400000;
    let engagementScore = Math.min(100, engagement.sessionCount * 5);
    if (daysSinceActive > 30) engagementScore *= 0.5;
    if (daysSinceActive > 60) engagementScore *= 0.3;
    if (daysSinceActive > 90) engagementScore = 10;

    // Support health (inverse of ticket problems)
    const openTickets = [...this.tickets.values()].filter(t => t.customerId === customerId && t.status !== 'closed' && t.status !== 'resolved');
    const breachedTickets = openTickets.filter(t => t.slaBreached);
    let supportHealth = 100;
    supportHealth -= openTickets.length * 10;
    supportHealth -= breachedTickets.length * 20;
    supportHealth = Math.max(0, supportHealth);

    // Feature adoption
    const featureAdoption = engagement.totalFeatures > 0
      ? (engagement.featuresUsed / engagement.totalFeatures) * 100
      : 50;

    // Overall weighted score
    const overallScore = Math.round(
      satisfaction * weights.satisfaction +
      engagementScore * weights.engagement +
      supportHealth * weights.supportHealth +
      featureAdoption * weights.featureAdoption
    );

    // Risk assessment
    const riskFactors: string[] = [];
    if (satisfaction < 40) riskFactors.push('Low satisfaction scores');
    if (daysSinceActive > 14) riskFactors.push(`Inactive for ${Math.round(daysSinceActive)} days`);
    if (openTickets.length >= 3) riskFactors.push(`${openTickets.length} unresolved support tickets`);
    if (breachedTickets.length > 0) riskFactors.push('SLA breached on support ticket');
    if (featureAdoption < 30) riskFactors.push('Low feature adoption');

    const negativeFeedback = customerFeedback.filter(f =>
      f.sentiment === 'negative' || f.sentiment === 'very_negative'
    );
    if (negativeFeedback.length >= 2) riskFactors.push('Multiple negative feedback submissions');

    // Churn risk
    let churnRisk: ChurnRisk = 'none';
    if (riskFactors.length >= 3 || overallScore < 30) churnRisk = 'high';
    else if (riskFactors.length >= 2 || overallScore < 50) churnRisk = 'medium';
    else if (riskFactors.length >= 1 || overallScore < 70) churnRisk = 'low';

    // Recommendations
    const recommendations: string[] = [];
    if (satisfaction < 50) recommendations.push('Schedule a customer success call');
    if (daysSinceActive > 14) recommendations.push('Send a re-engagement email');
    if (featureAdoption < 30) recommendations.push('Offer a product walkthrough');
    if (openTickets.length > 0) recommendations.push('Prioritize resolving open support tickets');
    if (churnRisk === 'high') recommendations.push('Immediate outreach recommended — high churn risk');

    if (churnRisk === 'high' || churnRisk === 'medium') {
      this.emit('churn:risk_detected', { customerId, risk: churnRisk, factors: riskFactors });
    }

    return {
      customerId,
      overallScore: Math.max(0, Math.min(100, overallScore)),
      components: {
        satisfaction: Math.round(satisfaction),
        engagement: Math.round(engagementScore),
        supportHealth: Math.round(supportHealth),
        featureAdoption: Math.round(featureAdoption),
      },
      churnRisk,
      riskFactors,
      recommendations,
      calculatedAt: Date.now(),
    };
  }

  // ─── Analytics ────────────────────────────────────────────────

  /** Get comprehensive engine stats */
  getStats(): FeedbackEngineStats {
    const nps = this.getNPSResults();

    const csatScores = this.feedback.filter(f => f.type === 'csat' && f.score !== undefined).map(f => f.score!);
    const averageCSAT = csatScores.length > 0
      ? Math.round((csatScores.reduce((a, b) => a + b, 0) / csatScores.length) * 10) / 10
      : 0;

    let openTickets = 0;
    let resolvedTickets = 0;
    let firstResponseTimes: number[] = [];
    let resolutionTimes: number[] = [];
    let slaBreaches = 0;
    const categoryCount: Record<string, number> = {};

    for (const ticket of this.tickets.values()) {
      if (ticket.status !== 'closed' && ticket.status !== 'resolved') openTickets++;
      if (ticket.status === 'resolved' || ticket.status === 'closed') resolvedTickets++;
      if (ticket.slaBreached) slaBreaches++;

      if (ticket.firstResponseAt) {
        firstResponseTimes.push((ticket.firstResponseAt - ticket.createdAt) / 3600000);
      }
      if (ticket.resolvedAt) {
        resolutionTimes.push((ticket.resolvedAt - ticket.createdAt) / 3600000);
      }

      categoryCount[ticket.category] = (categoryCount[ticket.category] || 0) + 1;
    }

    const avgFirstResponse = firstResponseTimes.length > 0
      ? Math.round((firstResponseTimes.reduce((a, b) => a + b, 0) / firstResponseTimes.length) * 10) / 10
      : 0;
    const avgResolution = resolutionTimes.length > 0
      ? Math.round((resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length) * 10) / 10
      : 0;

    const topCategories = Object.entries(categoryCount)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const sentimentBreakdown: Record<SentimentScore, number> = {
      very_positive: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      very_negative: 0,
    };
    for (const fb of this.feedback) {
      if (fb.sentiment) sentimentBreakdown[fb.sentiment]++;
    }

    return {
      totalFeedback: this.feedback.length,
      totalTickets: this.tickets.size,
      openTickets,
      resolvedTickets,
      totalFeatureRequests: this.featureRequests.size,
      nps,
      averageCSAT,
      averageFirstResponseHours: avgFirstResponse,
      averageResolutionHours: avgResolution,
      slaBreachRate: this.tickets.size > 0 ? Math.round((slaBreaches / this.tickets.size) * 100) : 0,
      topCategories,
      sentimentBreakdown,
    };
  }

  /** Get all feedback entries for a customer */
  getCustomerFeedback(customerId: string): Feedback[] {
    return this.feedback.filter(f => f.customerId === customerId);
  }

  /** Get all feedback */
  getAllFeedback(filters?: {
    type?: FeedbackType;
    sentiment?: SentimentScore;
    since?: number;
    limit?: number;
  }): Feedback[] {
    let results = [...this.feedback];

    if (filters?.type) results = results.filter(f => f.type === filters.type);
    if (filters?.sentiment) results = results.filter(f => f.sentiment === filters.sentiment);
    if (filters?.since) results = results.filter(f => f.createdAt >= filters.since!);

    results.sort((a, b) => b.createdAt - a.createdAt);

    if (filters?.limit) results = results.slice(0, filters.limit);
    return results;
  }

  /** Get voice-friendly summary */
  getVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];

    if (stats.nps.totalResponses > 0) {
      parts.push(`NPS score: ${stats.nps.npsScore}.`);
      if (stats.nps.trend !== 'stable') {
        parts.push(`Trend: ${stats.nps.trend}.`);
      }
    }

    if (stats.openTickets > 0) {
      parts.push(`${stats.openTickets} open support tickets.`);
    }

    if (stats.totalFeatureRequests > 0) {
      const topRequest = this.getFeatureRequests({ limit: 1 })[0];
      if (topRequest) {
        parts.push(`Top feature request: ${topRequest.title} with ${topRequest.votes.size} votes.`);
      }
    }

    if (stats.slaBreachRate > 0) {
      parts.push(`Warning: ${stats.slaBreachRate}% SLA breach rate.`);
    }

    return parts.length > 0 ? parts.join(' ') : 'No feedback data available yet.';
  }

  // ─── Internal Helpers ─────────────────────────────────────────

  private createFeedback(options: {
    type: FeedbackType;
    customerId: string;
    score?: number;
    comment?: string;
    trigger: string;
    context?: FeedbackContext;
    tenantId?: string;
  }): Feedback {
    const sentiment = options.comment ? this.analyzeSentiment(options.comment) : undefined;
    const tags = options.comment ? this.autoTag(options.comment) : [];

    const fb: Feedback = {
      id: `fb-${++this.counters.feedback}`,
      type: options.type,
      customerId: options.customerId,
      tenantId: options.tenantId,
      score: options.score,
      comment: options.comment,
      sentiment,
      trigger: options.trigger,
      tags,
      context: options.context,
      createdAt: Date.now(),
      followUpTriggered: false,
    };

    this.feedback.push(fb);

    // Trim if over max
    if (this.feedback.length > this.config.maxFeedback) {
      this.feedback = this.feedback.slice(-this.config.maxFeedback);
    }

    this.emit('feedback:submitted', fb);
    return fb;
  }

  private autoCategorize(text: string): string {
    const lower = text.toLowerCase();
    let bestCategory = 'general';
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      let score = 0;
      for (const keyword of keywords) {
        if (lower.includes(keyword)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    return bestCategory;
  }

  private autoPrioritize(text: string): TicketPriority {
    const lower = text.toLowerCase();

    const criticalKeywords = ['crash', 'down', 'broken', 'data loss', 'can\'t access', 'urgent', 'emergency', 'production'];
    const highKeywords = ['error', 'bug', 'not working', 'fail', 'incorrect', 'wrong'];
    const lowKeywords = ['suggestion', 'would be nice', 'feature request', 'minor', 'cosmetic'];

    if (criticalKeywords.some(k => lower.includes(k))) return 'critical';
    if (highKeywords.some(k => lower.includes(k))) return 'high';
    if (lowKeywords.some(k => lower.includes(k))) return 'low';
    return 'medium';
  }

  private autoTag(text: string): string[] {
    const lower = text.toLowerCase();
    const tags: string[] = [];

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lower.includes(keyword) && !tags.includes(category)) {
          tags.push(category);
          break;
        }
      }
    }

    return tags;
  }

  private calculateNPSTrend(responses: Feedback[]): 'improving' | 'stable' | 'declining' {
    if (responses.length < 6) return 'stable';

    const splitPoint = Math.floor(responses.length * 0.5);
    const older = responses.slice(0, splitPoint);
    const newer = responses.slice(splitPoint);

    const olderAvg = older.reduce((sum, f) => sum + (f.score || 0), 0) / older.length;
    const newerAvg = newer.reduce((sum, f) => sum + (f.score || 0), 0) / newer.length;

    const diff = newerAvg - olderAvg;
    if (diff > 0.5) return 'improving';
    if (diff < -0.5) return 'declining';
    return 'stable';
  }

  /** Reset all data */
  reset(): void {
    this.feedback = [];
    this.tickets.clear();
    this.featureRequests.clear();
    this.lastNPSSurvey.clear();
    this.counters = { feedback: 0, tickets: 0, features: 0, messages: 0 };
  }
}
