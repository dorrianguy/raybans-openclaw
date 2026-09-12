/**
 * Customer Feedback Engine — Meta Ray-Bans × OpenClaw
 *
 * NPS surveys, in-app feedback, satisfaction tracking, churn prediction,
 * and feature request management. Critical for SaaS retention and growth.
 *
 * Key capabilities:
 * - NPS (Net Promoter Score) survey system with timing triggers
 * - In-session micro-feedback (thumbs up/down on agent responses)
 * - CSAT (Customer Satisfaction Score) after sessions
 * - CES (Customer Effort Score) for onboarding/setup
 * - Feature request collection and voting
 * - Churn prediction signals based on usage patterns
 * - Sentiment trend analysis
 * - Voice-friendly feedback collection ("How was that session?")
 * - Feedback → product insight pipeline
 *
 * 🌙 Night Shift Agent — Night #36
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────────────────

export type FeedbackType =
  | 'nps'          // Net Promoter Score (0-10)
  | 'csat'         // Customer Satisfaction (1-5)
  | 'ces'          // Customer Effort Score (1-7)
  | 'thumbs'       // Binary thumbs up/down
  | 'text'         // Free-text feedback
  | 'bug_report'   // Bug report
  | 'feature_request' // Feature request
  | 'voice';       // Voice-collected feedback

export type NPSCategory = 'promoter' | 'passive' | 'detractor';

export type SentimentLevel = 'very_positive' | 'positive' | 'neutral' | 'negative' | 'very_negative';

export type ChurnRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';

export type FeedbackTrigger =
  | 'post_session'     // After completing a session
  | 'milestone'        // After reaching a usage milestone
  | 'periodic'         // Regular interval (e.g., monthly)
  | 'manual'           // User-initiated
  | 'voice_prompt'     // Voice-triggered ("Hey, how was that?")
  | 'onboarding'       // After onboarding steps
  | 'support_ticket'   // After support interaction
  | 'feature_first_use'; // After first time using a feature

export interface FeedbackEntry {
  id: string;
  customerId: string;
  type: FeedbackType;
  trigger: FeedbackTrigger;
  timestamp: number;
  score: number | null;       // NPS: 0-10, CSAT: 1-5, CES: 1-7, Thumbs: 0|1
  text: string | null;        // Optional comment
  tags: string[];
  context: {
    sessionId?: string;
    agentId?: string;
    feature?: string;
    planId?: string;
    daysSinceSignup?: number;
    sessionsCompleted?: number;
  };
  sentiment: SentimentLevel | null;
  responded: boolean;         // Did we follow up?
  responseText: string | null;
}

export interface NPSResult {
  score: number;              // -100 to 100
  totalResponses: number;
  promoters: number;
  passives: number;
  detractors: number;
  promoterPercentage: number;
  detractorPercentage: number;
  trend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
}

export interface CSATResult {
  averageScore: number;       // 1-5
  totalResponses: number;
  distribution: Record<number, number>; // score → count
  satisfactionRate: number;   // % scoring 4 or 5
}

export interface CESResult {
  averageScore: number;       // 1-7
  totalResponses: number;
  lowEffortRate: number;      // % scoring 5-7 (low effort = good)
}

export interface FeatureRequest {
  id: string;
  title: string;
  description: string;
  submittedBy: string;        // customerId
  submittedAt: number;
  votes: Set<string>;         // customerIds who voted
  status: 'new' | 'under_review' | 'planned' | 'in_progress' | 'shipped' | 'declined';
  priority: 'low' | 'medium' | 'high' | 'critical';
  tags: string[];
  category: string;
  revenue_impact: number | null; // estimated MRR impact
}

export interface CustomerHealth {
  customerId: string;
  lastActive: number;
  sessionsLast30Days: number;
  feedbackScoreAvg: number | null;
  recentSentiment: SentimentLevel;
  churnRisk: ChurnRisk;
  churnSignals: string[];
  healthScore: number;       // 0-100
  daysSinceLastFeedback: number | null;
}

export interface SurveySchedule {
  customerId: string;
  surveyType: FeedbackType;
  scheduledAt: number;
  trigger: FeedbackTrigger;
  sent: boolean;
  sentAt: number | null;
  completed: boolean;
  completedAt: number | null;
}

export interface FeedbackInsight {
  topic: string;
  mentions: number;
  sentiment: SentimentLevel;
  sampleFeedback: string[];
  recommendation: string;
}

export interface FeedbackEngineConfig {
  /** NPS survey frequency (ms) — default 90 days */
  npsIntervalMs: number;
  /** CSAT survey after every N sessions */
  csatSessionInterval: number;
  /** CES survey after onboarding */
  cesAfterOnboarding: boolean;
  /** Minimum sessions before first NPS */
  minSessionsForNPS: number;
  /** Maximum surveys per customer per month */
  maxSurveysPerMonth: number;
  /** Churn risk: days of inactivity thresholds */
  inactivityThresholds: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  /** Enable voice-based feedback collection */
  voiceFeedback: boolean;
  /** Auto-respond to detractors */
  autoRespondDetractors: boolean;
  /** Maximum feedback entries to retain */
  maxEntries: number;
  /** Feature request voting enabled */
  featureVoting: boolean;
}

export interface FeedbackEngineEvents {
  feedback_received: (entry: FeedbackEntry) => void;
  nps_detractor: (entry: FeedbackEntry) => void;
  churn_risk_changed: (health: CustomerHealth) => void;
  survey_scheduled: (schedule: SurveySchedule) => void;
  feature_requested: (request: FeatureRequest) => void;
  feature_voted: (request: FeatureRequest, voterId: string) => void;
  milestone_reached: (customerId: string, milestone: string) => void;
  insight_generated: (insight: FeedbackInsight) => void;
}

export interface FeedbackEngineStats {
  totalFeedback: number;
  feedbackByType: Record<FeedbackType, number>;
  npsScore: number | null;
  csatScore: number | null;
  cesScore: number | null;
  totalFeatureRequests: number;
  churnRiskBreakdown: Record<ChurnRisk, number>;
  averageSentiment: SentimentLevel;
  responseRate: number;         // % of surveys completed
  activeCustomers: number;
  surveysPending: number;
}

// ─── Default Config ──────────────────────────────────────────────────────────

export const DEFAULT_FEEDBACK_CONFIG: FeedbackEngineConfig = {
  npsIntervalMs: 90 * 24 * 3600_000,   // 90 days
  csatSessionInterval: 5,               // after every 5 sessions
  cesAfterOnboarding: true,
  minSessionsForNPS: 3,
  maxSurveysPerMonth: 3,
  inactivityThresholds: {
    low: 7,
    medium: 14,
    high: 30,
    critical: 60,
  },
  voiceFeedback: true,
  autoRespondDetractors: true,
  maxEntries: 50_000,
  featureVoting: true,
};

// ─── Sentiment Analysis ──────────────────────────────────────────────────────

const POSITIVE_WORDS = new Set([
  'great', 'awesome', 'excellent', 'love', 'amazing', 'fantastic',
  'perfect', 'wonderful', 'brilliant', 'outstanding', 'incredible',
  'helpful', 'impressive', 'efficient', 'fast', 'easy', 'smooth',
  'accurate', 'reliable', 'useful', 'superb', 'best', 'thank',
  'thanks', 'good', 'nice', 'happy', 'pleased', 'satisfied',
]);

const NEGATIVE_WORDS = new Set([
  'bad', 'terrible', 'awful', 'hate', 'horrible', 'worst',
  'broken', 'useless', 'slow', 'crash', 'bug', 'error',
  'frustrating', 'annoying', 'disappointing', 'confusing',
  'difficult', 'wrong', 'fail', 'failed', 'poor', 'waste',
  'expensive', 'unreliable', 'inaccurate', 'laggy', 'stuck',
  'sucks', 'trash', 'garbage', 'rubbish', 'painful',
]);

function analyzeSentiment(text: string): SentimentLevel {
  if (!text || text.trim().length === 0) return 'neutral';

  const words = text.toLowerCase().split(/\s+/);
  let positive = 0;
  let negative = 0;

  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '');
    if (POSITIVE_WORDS.has(clean)) positive++;
    if (NEGATIVE_WORDS.has(clean)) negative++;
  }

  const total = positive + negative;
  if (total === 0) return 'neutral';

  const ratio = positive / total;
  if (ratio >= 0.8 && positive >= 2) return 'very_positive';
  if (ratio >= 0.6) return 'positive';
  if (ratio <= 0.2 && negative >= 2) return 'very_negative';
  if (ratio <= 0.4) return 'negative';
  return 'neutral';
}

function classifyNPS(score: number): NPSCategory {
  if (score >= 9) return 'promoter';
  if (score >= 7) return 'passive';
  return 'detractor';
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class FeedbackEngine extends EventEmitter {
  private config: FeedbackEngineConfig;
  private feedback: FeedbackEntry[] = [];
  private featureRequests: Map<string, FeatureRequest> = new Map();
  private customerProfiles: Map<string, {
    firstSeen: number;
    sessionsCompleted: number;
    lastActive: number;
    lastNPSSent: number;
    surveysThisMonth: number;
    monthReset: number;
  }> = new Map();
  private schedules: SurveySchedule[] = [];

  constructor(config: Partial<FeedbackEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_FEEDBACK_CONFIG, ...config };
  }

  // ─── Feedback Collection ────────────────────────────────────────────────

  /**
   * Submit NPS feedback (0-10 scale)
   */
  submitNPS(
    customerId: string,
    score: number,
    options: {
      text?: string;
      trigger?: FeedbackTrigger;
      context?: FeedbackEntry['context'];
    } = {}
  ): FeedbackEntry {
    if (score < 0 || score > 10) throw new Error('NPS score must be 0-10');

    const entry = this.createEntry(customerId, 'nps', {
      score: Math.round(score),
      text: options.text || null,
      trigger: options.trigger || 'periodic',
      context: options.context || {},
    });

    // Alert on detractors
    if (classifyNPS(score) === 'detractor') {
      this.emit('nps_detractor', entry);
    }

    return entry;
  }

  /**
   * Submit CSAT feedback (1-5 stars)
   */
  submitCSAT(
    customerId: string,
    score: number,
    options: {
      text?: string;
      trigger?: FeedbackTrigger;
      context?: FeedbackEntry['context'];
    } = {}
  ): FeedbackEntry {
    if (score < 1 || score > 5) throw new Error('CSAT score must be 1-5');

    return this.createEntry(customerId, 'csat', {
      score: Math.round(score),
      text: options.text || null,
      trigger: options.trigger || 'post_session',
      context: options.context || {},
    });
  }

  /**
   * Submit CES feedback (1-7 scale, 7 = very easy)
   */
  submitCES(
    customerId: string,
    score: number,
    options: {
      text?: string;
      context?: FeedbackEntry['context'];
    } = {}
  ): FeedbackEntry {
    if (score < 1 || score > 7) throw new Error('CES score must be 1-7');

    return this.createEntry(customerId, 'ces', {
      score: Math.round(score),
      text: options.text || null,
      trigger: 'onboarding',
      context: options.context || {},
    });
  }

  /**
   * Submit thumbs up/down feedback
   */
  submitThumbs(
    customerId: string,
    thumbsUp: boolean,
    options: {
      text?: string;
      context?: FeedbackEntry['context'];
    } = {}
  ): FeedbackEntry {
    return this.createEntry(customerId, 'thumbs', {
      score: thumbsUp ? 1 : 0,
      text: options.text || null,
      trigger: 'manual',
      context: options.context || {},
    });
  }

  /**
   * Submit free-text feedback
   */
  submitText(
    customerId: string,
    text: string,
    options: {
      tags?: string[];
      trigger?: FeedbackTrigger;
      context?: FeedbackEntry['context'];
    } = {}
  ): FeedbackEntry {
    return this.createEntry(customerId, 'text', {
      score: null,
      text,
      trigger: options.trigger || 'manual',
      context: options.context || {},
      tags: options.tags,
    });
  }

  /**
   * Submit a bug report
   */
  submitBugReport(
    customerId: string,
    description: string,
    options: {
      tags?: string[];
      context?: FeedbackEntry['context'];
    } = {}
  ): FeedbackEntry {
    return this.createEntry(customerId, 'bug_report', {
      score: null,
      text: description,
      trigger: 'manual',
      context: options.context || {},
      tags: [...(options.tags || []), 'bug'],
    });
  }

  /**
   * Submit voice-collected feedback
   */
  submitVoiceFeedback(
    customerId: string,
    transcript: string,
    options: {
      context?: FeedbackEntry['context'];
    } = {}
  ): FeedbackEntry {
    // Analyze transcript for implicit score
    const sentiment = analyzeSentiment(transcript);
    const implicitScore = this.sentimentToScore(sentiment);

    return this.createEntry(customerId, 'voice', {
      score: implicitScore,
      text: transcript,
      trigger: 'voice_prompt',
      context: options.context || {},
    });
  }

  // ─── Feature Requests ──────────────────────────────────────────────────

  /**
   * Submit a feature request
   */
  submitFeatureRequest(
    customerId: string,
    title: string,
    description: string,
    options: {
      tags?: string[];
      category?: string;
      priority?: FeatureRequest['priority'];
    } = {}
  ): FeatureRequest {
    const request: FeatureRequest = {
      id: generateId(),
      title,
      description,
      submittedBy: customerId,
      submittedAt: Date.now(),
      votes: new Set([customerId]), // auto-vote by submitter
      status: 'new',
      priority: options.priority || 'medium',
      tags: options.tags || [],
      category: options.category || 'general',
      revenue_impact: null,
    };

    this.featureRequests.set(request.id, request);
    this.emit('feature_requested', request);

    // Also record as feedback
    this.createEntry(customerId, 'feature_request', {
      score: null,
      text: `${title}: ${description}`,
      trigger: 'manual',
      context: {},
      tags: options.tags,
    });

    return request;
  }

  /**
   * Vote for a feature request
   */
  voteForFeature(requestId: string, customerId: string): boolean {
    const request = this.featureRequests.get(requestId);
    if (!request) return false;

    if (request.votes.has(customerId)) return false; // already voted

    request.votes.add(customerId);
    this.emit('feature_voted', request, customerId);
    return true;
  }

  /**
   * Remove vote from a feature request
   */
  unvoteFeature(requestId: string, customerId: string): boolean {
    const request = this.featureRequests.get(requestId);
    if (!request) return false;
    return request.votes.delete(customerId);
  }

  /**
   * Update feature request status
   */
  updateFeatureStatus(
    requestId: string,
    status: FeatureRequest['status'],
    options: { priority?: FeatureRequest['priority']; revenue_impact?: number } = {}
  ): boolean {
    const request = this.featureRequests.get(requestId);
    if (!request) return false;

    request.status = status;
    if (options.priority) request.priority = options.priority;
    if (options.revenue_impact !== undefined) request.revenue_impact = options.revenue_impact;

    return true;
  }

  /**
   * Get feature requests sorted by votes
   */
  getFeatureRequests(options: {
    status?: FeatureRequest['status'];
    category?: string;
    sortBy?: 'votes' | 'date' | 'priority';
    limit?: number;
  } = {}): Array<FeatureRequest & { voteCount: number }> {
    let results = [...this.featureRequests.values()];

    if (options.status) {
      results = results.filter(r => r.status === options.status);
    }
    if (options.category) {
      results = results.filter(r => r.category === options.category);
    }

    const sortBy = options.sortBy || 'votes';
    results.sort((a, b) => {
      switch (sortBy) {
        case 'votes': return b.votes.size - a.votes.size;
        case 'date': return b.submittedAt - a.submittedAt;
        case 'priority': {
          const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        default: return 0;
      }
    });

    const limited = options.limit ? results.slice(0, options.limit) : results;
    return limited.map(r => ({ ...r, votes: new Set(r.votes), voteCount: r.votes.size }));
  }

  /**
   * Get a single feature request
   */
  getFeatureRequest(requestId: string): (FeatureRequest & { voteCount: number }) | null {
    const req = this.featureRequests.get(requestId);
    if (!req) return null;
    return { ...req, votes: new Set(req.votes), voteCount: req.votes.size };
  }

  // ─── Metrics & Analysis ────────────────────────────────────────────────

  /**
   * Calculate NPS score
   */
  calculateNPS(options: { since?: number; customerId?: string } = {}): NPSResult {
    let entries = this.feedback.filter(f => f.type === 'nps' && f.score !== null);

    if (options.since) {
      entries = entries.filter(f => f.timestamp >= options.since!);
    }
    if (options.customerId) {
      entries = entries.filter(f => f.customerId === options.customerId);
    }

    if (entries.length === 0) {
      return {
        score: 0,
        totalResponses: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
        promoterPercentage: 0,
        detractorPercentage: 0,
        trend: 'insufficient_data',
      };
    }

    let promoters = 0, passives = 0, detractors = 0;
    for (const entry of entries) {
      const cat = classifyNPS(entry.score!);
      if (cat === 'promoter') promoters++;
      else if (cat === 'passive') passives++;
      else detractors++;
    }

    const total = entries.length;
    const promoterPct = (promoters / total) * 100;
    const detractorPct = (detractors / total) * 100;
    const score = Math.round(promoterPct - detractorPct);

    // Trend: compare first half to second half
    const trend = this.calculateNPSTrend(entries);

    return {
      score,
      totalResponses: total,
      promoters,
      passives,
      detractors,
      promoterPercentage: Math.round(promoterPct * 10) / 10,
      detractorPercentage: Math.round(detractorPct * 10) / 10,
      trend,
    };
  }

  /**
   * Calculate CSAT score
   */
  calculateCSAT(options: { since?: number } = {}): CSATResult {
    let entries = this.feedback.filter(f => f.type === 'csat' && f.score !== null);

    if (options.since) {
      entries = entries.filter(f => f.timestamp >= options.since!);
    }

    if (entries.length === 0) {
      return {
        averageScore: 0,
        totalResponses: 0,
        distribution: {},
        satisfactionRate: 0,
      };
    }

    const distribution: Record<number, number> = {};
    let sum = 0;
    let satisfied = 0;

    for (const entry of entries) {
      const score = entry.score!;
      sum += score;
      distribution[score] = (distribution[score] || 0) + 1;
      if (score >= 4) satisfied++;
    }

    return {
      averageScore: Math.round((sum / entries.length) * 10) / 10,
      totalResponses: entries.length,
      distribution,
      satisfactionRate: Math.round((satisfied / entries.length) * 100 * 10) / 10,
    };
  }

  /**
   * Calculate CES score
   */
  calculateCES(options: { since?: number } = {}): CESResult {
    let entries = this.feedback.filter(f => f.type === 'ces' && f.score !== null);

    if (options.since) {
      entries = entries.filter(f => f.timestamp >= options.since!);
    }

    if (entries.length === 0) {
      return { averageScore: 0, totalResponses: 0, lowEffortRate: 0 };
    }

    let sum = 0;
    let lowEffort = 0;

    for (const entry of entries) {
      const score = entry.score!;
      sum += score;
      if (score >= 5) lowEffort++;
    }

    return {
      averageScore: Math.round((sum / entries.length) * 10) / 10,
      totalResponses: entries.length,
      lowEffortRate: Math.round((lowEffort / entries.length) * 100 * 10) / 10,
    };
  }

  /**
   * Calculate thumbs up ratio
   */
  getThumbsRatio(options: {
    agentId?: string;
    feature?: string;
    since?: number;
  } = {}): { up: number; down: number; ratio: number; total: number } {
    let entries = this.feedback.filter(f => f.type === 'thumbs' && f.score !== null);

    if (options.since) entries = entries.filter(f => f.timestamp >= options.since!);
    if (options.agentId) entries = entries.filter(f => f.context.agentId === options.agentId);
    if (options.feature) entries = entries.filter(f => f.context.feature === options.feature);

    const up = entries.filter(f => f.score === 1).length;
    const down = entries.filter(f => f.score === 0).length;
    const total = up + down;

    return {
      up,
      down,
      ratio: total > 0 ? Math.round((up / total) * 100) / 100 : 0,
      total,
    };
  }

  // ─── Customer Health ───────────────────────────────────────────────────

  /**
   * Track customer activity (call after each session)
   */
  trackActivity(customerId: string): void {
    const profile = this.getOrCreateProfile(customerId);
    profile.sessionsCompleted++;
    profile.lastActive = Date.now();

    // Check for milestones
    const milestones = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
    if (milestones.includes(profile.sessionsCompleted)) {
      this.emit('milestone_reached', customerId, `${profile.sessionsCompleted}_sessions`);
    }
  }

  /**
   * Assess customer health and churn risk
   */
  assessCustomerHealth(customerId: string): CustomerHealth {
    const profile = this.getOrCreateProfile(customerId);
    const now = Date.now();
    const daysSinceActive = (now - profile.lastActive) / (24 * 3600_000);

    // Calculate feedback average
    const customerFeedback = this.feedback.filter(
      f => f.customerId === customerId && f.score !== null
    );
    const feedbackAvg = customerFeedback.length > 0
      ? customerFeedback.reduce((sum, f) => sum + (f.score || 0), 0) / customerFeedback.length
      : null;

    // Sessions in last 30 days
    const thirtyDaysAgo = now - 30 * 24 * 3600_000;
    const recentFeedback = customerFeedback.filter(f => f.timestamp >= thirtyDaysAgo);

    // Recent sentiment
    const recentTexts = this.feedback
      .filter(f => f.customerId === customerId && f.text && f.timestamp >= thirtyDaysAgo);
    const recentSentiment = recentTexts.length > 0
      ? this.aggregateSentiment(recentTexts.map(f => f.sentiment).filter((s): s is SentimentLevel => s !== null))
      : 'neutral';

    // Churn signals
    const churnSignals: string[] = [];
    const thresholds = this.config.inactivityThresholds;

    if (daysSinceActive > thresholds.low) {
      churnSignals.push(`Inactive for ${Math.round(daysSinceActive)} days`);
    }
    if (feedbackAvg !== null && feedbackAvg < 3) {
      churnSignals.push('Low feedback scores');
    }
    if (recentSentiment === 'negative' || recentSentiment === 'very_negative') {
      churnSignals.push('Negative recent sentiment');
    }
    if (profile.sessionsCompleted < 3 && daysSinceActive > 7) {
      churnSignals.push('Low adoption — few sessions completed');
    }

    // NPS detractor check
    const lastNPS = customerFeedback
      .filter(f => f.type === 'nps')
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (lastNPS && lastNPS.score !== null && classifyNPS(lastNPS.score) === 'detractor') {
      churnSignals.push('NPS detractor');
    }

    // Churn risk level
    let churnRisk: ChurnRisk = 'none';
    if (daysSinceActive > thresholds.critical || churnSignals.length >= 4) {
      churnRisk = 'critical';
    } else if (daysSinceActive > thresholds.high || churnSignals.length >= 3) {
      churnRisk = 'high';
    } else if (daysSinceActive > thresholds.medium || churnSignals.length >= 2) {
      churnRisk = 'medium';
    } else if (daysSinceActive > thresholds.low || churnSignals.length >= 1) {
      churnRisk = 'low';
    }

    // Health score (0-100)
    let healthScore = 100;
    healthScore -= Math.min(40, daysSinceActive * 2); // -2 per day inactive, max -40
    healthScore -= churnSignals.length * 10;            // -10 per signal
    if (feedbackAvg !== null) {
      healthScore += (feedbackAvg - 3) * 5;             // bonus/penalty from feedback
    }
    healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

    // Last feedback
    const lastFeedbackEntry = this.feedback
      .filter(f => f.customerId === customerId)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    const daysSinceLastFeedback = lastFeedbackEntry
      ? (now - lastFeedbackEntry.timestamp) / (24 * 3600_000)
      : null;

    const health: CustomerHealth = {
      customerId,
      lastActive: profile.lastActive,
      sessionsLast30Days: profile.sessionsCompleted, // simplified
      feedbackScoreAvg: feedbackAvg ? Math.round(feedbackAvg * 10) / 10 : null,
      recentSentiment,
      churnRisk,
      churnSignals,
      healthScore,
      daysSinceLastFeedback: daysSinceLastFeedback !== null ? Math.round(daysSinceLastFeedback) : null,
    };

    this.emit('churn_risk_changed', health);
    return health;
  }

  /**
   * Get all customers at a specific churn risk level
   */
  getAtRiskCustomers(minRisk: ChurnRisk = 'medium'): CustomerHealth[] {
    const riskLevels: ChurnRisk[] = ['critical', 'high', 'medium', 'low', 'none'];
    const minIndex = riskLevels.indexOf(minRisk);

    const results: CustomerHealth[] = [];
    for (const [customerId] of this.customerProfiles) {
      const health = this.assessCustomerHealth(customerId);
      const riskIndex = riskLevels.indexOf(health.churnRisk);
      if (riskIndex <= minIndex) {
        results.push(health);
      }
    }

    return results.sort((a, b) => a.healthScore - b.healthScore);
  }

  // ─── Survey Scheduling ─────────────────────────────────────────────────

  /**
   * Schedule a survey for a customer
   */
  scheduleSurvey(
    customerId: string,
    surveyType: FeedbackType,
    trigger: FeedbackTrigger,
    scheduledAt?: number
  ): SurveySchedule {
    const schedule: SurveySchedule = {
      customerId,
      surveyType,
      scheduledAt: scheduledAt || Date.now(),
      trigger,
      sent: false,
      sentAt: null,
      completed: false,
      completedAt: null,
    };

    this.schedules.push(schedule);
    this.emit('survey_scheduled', schedule);
    return schedule;
  }

  /**
   * Check if a customer is eligible for a survey (not over-surveyed)
   */
  canSurvey(customerId: string): boolean {
    const profile = this.getOrCreateProfile(customerId);
    const now = Date.now();

    // Reset monthly counter if needed
    if (now - profile.monthReset > 30 * 24 * 3600_000) {
      profile.surveysThisMonth = 0;
      profile.monthReset = now;
    }

    return profile.surveysThisMonth < this.config.maxSurveysPerMonth;
  }

  /**
   * Mark a survey as sent
   */
  markSurveySent(customerId: string, surveyType: FeedbackType): boolean {
    const schedule = this.schedules.find(
      s => s.customerId === customerId && s.surveyType === surveyType && !s.sent
    );
    if (!schedule) return false;

    schedule.sent = true;
    schedule.sentAt = Date.now();

    const profile = this.getOrCreateProfile(customerId);
    profile.surveysThisMonth++;

    return true;
  }

  /**
   * Get pending surveys
   */
  getPendingSurveys(customerId?: string): SurveySchedule[] {
    let results = this.schedules.filter(s => !s.completed);
    if (customerId) {
      results = results.filter(s => s.customerId === customerId);
    }
    return results;
  }

  // ─── Feedback Query ────────────────────────────────────────────────────

  /**
   * Get all feedback with optional filters
   */
  getFeedback(options: {
    customerId?: string;
    type?: FeedbackType;
    since?: number;
    sentiment?: SentimentLevel;
    limit?: number;
  } = {}): FeedbackEntry[] {
    let results = [...this.feedback];

    if (options.customerId) results = results.filter(f => f.customerId === options.customerId);
    if (options.type) results = results.filter(f => f.type === options.type);
    if (options.since) results = results.filter(f => f.timestamp >= options.since!);
    if (options.sentiment) results = results.filter(f => f.sentiment === options.sentiment);

    results.sort((a, b) => b.timestamp - a.timestamp);

    if (options.limit) results = results.slice(0, options.limit);
    return results;
  }

  /**
   * Respond to feedback
   */
  respondToFeedback(feedbackId: string, responseText: string): boolean {
    const entry = this.feedback.find(f => f.id === feedbackId);
    if (!entry) return false;

    entry.responded = true;
    entry.responseText = responseText;
    return true;
  }

  // ─── Insights ──────────────────────────────────────────────────────────

  /**
   * Generate feedback insights from recent feedback
   */
  generateInsights(options: { since?: number; minMentions?: number } = {}): FeedbackInsight[] {
    const since = options.since || Date.now() - 30 * 24 * 3600_000;
    const minMentions = options.minMentions || 2;

    const recentFeedback = this.feedback.filter(
      f => f.timestamp >= since && f.text
    );

    if (recentFeedback.length === 0) return [];

    // Extract common topics from tags and text keywords
    const topicCounts = new Map<string, { count: number; sentiment: SentimentLevel[]; samples: string[] }>();

    for (const entry of recentFeedback) {
      const topics = [...entry.tags];

      // Extract keywords from text
      if (entry.text) {
        const words = entry.text.toLowerCase().split(/\s+/)
          .filter(w => w.length > 4)
          .map(w => w.replace(/[^a-z]/g, ''))
          .filter(w => w.length > 4);

        for (const word of words) {
          if (!topics.includes(word)) topics.push(word);
        }
      }

      for (const topic of topics) {
        const existing = topicCounts.get(topic) || { count: 0, sentiment: [], samples: [] };
        existing.count++;
        if (entry.sentiment) existing.sentiment.push(entry.sentiment);
        if (entry.text && existing.samples.length < 3) existing.samples.push(entry.text);
        topicCounts.set(topic, existing);
      }
    }

    // Filter to significant topics
    const insights: FeedbackInsight[] = [];
    for (const [topic, data] of topicCounts) {
      if (data.count >= minMentions) {
        const sentiment = this.aggregateSentiment(data.sentiment);
        insights.push({
          topic,
          mentions: data.count,
          sentiment,
          sampleFeedback: data.samples,
          recommendation: this.generateRecommendation(topic, sentiment, data.count),
        });
      }
    }

    insights.sort((a, b) => b.mentions - a.mentions);

    for (const insight of insights) {
      this.emit('insight_generated', insight);
    }

    return insights;
  }

  // ─── Statistics ────────────────────────────────────────────────────────

  /**
   * Get comprehensive feedback statistics
   */
  getStats(): FeedbackEngineStats {
    const byType: Record<FeedbackType, number> = {
      nps: 0, csat: 0, ces: 0, thumbs: 0,
      text: 0, bug_report: 0, feature_request: 0, voice: 0,
    };

    for (const entry of this.feedback) {
      byType[entry.type]++;
    }

    const nps = this.calculateNPS();
    const csat = this.calculateCSAT();
    const ces = this.calculateCES();

    // Average sentiment
    const sentiments = this.feedback
      .map(f => f.sentiment)
      .filter((s): s is SentimentLevel => s !== null);
    const avgSentiment = sentiments.length > 0 ? this.aggregateSentiment(sentiments) : 'neutral';

    // Response rate
    const scheduledSurveys = this.schedules.filter(s => s.sent);
    const completedSurveys = scheduledSurveys.filter(s => s.completed);
    const responseRate = scheduledSurveys.length > 0
      ? Math.round((completedSurveys.length / scheduledSurveys.length) * 100)
      : 0;

    // Churn breakdown
    const churnBreakdown: Record<ChurnRisk, number> = {
      none: 0, low: 0, medium: 0, high: 0, critical: 0,
    };
    for (const [customerId] of this.customerProfiles) {
      const health = this.assessCustomerHealth(customerId);
      churnBreakdown[health.churnRisk]++;
    }

    return {
      totalFeedback: this.feedback.length,
      feedbackByType: byType,
      npsScore: nps.totalResponses > 0 ? nps.score : null,
      csatScore: csat.totalResponses > 0 ? csat.averageScore : null,
      cesScore: ces.totalResponses > 0 ? ces.averageScore : null,
      totalFeatureRequests: this.featureRequests.size,
      churnRiskBreakdown: churnBreakdown,
      averageSentiment: avgSentiment,
      responseRate,
      activeCustomers: this.customerProfiles.size,
      surveysPending: this.schedules.filter(s => !s.completed).length,
    };
  }

  // ─── Voice Summary ─────────────────────────────────────────────────────

  /**
   * Generate TTS-friendly summary
   */
  getVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];

    // NPS
    if (stats.npsScore !== null) {
      parts.push(`Net Promoter Score: ${stats.npsScore}.`);
      if (stats.npsScore >= 50) parts.push('Excellent.');
      else if (stats.npsScore >= 30) parts.push('Good.');
      else if (stats.npsScore >= 0) parts.push('Needs improvement.');
      else parts.push('Critical — many detractors.');
    }

    // CSAT
    if (stats.csatScore !== null) {
      parts.push(`Customer satisfaction: ${stats.csatScore} out of 5.`);
    }

    // Churn risk
    const atRisk = stats.churnRiskBreakdown.high + stats.churnRiskBreakdown.critical;
    if (atRisk > 0) {
      parts.push(`${atRisk} ${atRisk === 1 ? 'customer' : 'customers'} at high churn risk.`);
    }

    // Feature requests
    if (stats.totalFeatureRequests > 0) {
      parts.push(`${stats.totalFeatureRequests} feature ${stats.totalFeatureRequests === 1 ? 'request' : 'requests'} open.`);
    }

    // Total feedback
    parts.push(`${stats.totalFeedback} total feedback entries from ${stats.activeCustomers} ${stats.activeCustomers === 1 ? 'customer' : 'customers'}.`);

    return parts.join(' ');
  }

  // ─── Internal Helpers ──────────────────────────────────────────────────

  private createEntry(
    customerId: string,
    type: FeedbackType,
    options: {
      score: number | null;
      text: string | null;
      trigger: FeedbackTrigger;
      context: FeedbackEntry['context'];
      tags?: string[];
    }
  ): FeedbackEntry {
    const sentiment = options.text ? analyzeSentiment(options.text) : null;

    const entry: FeedbackEntry = {
      id: generateId(),
      customerId,
      type,
      trigger: options.trigger,
      timestamp: Date.now(),
      score: options.score,
      text: options.text,
      tags: options.tags || [],
      context: options.context,
      sentiment,
      responded: false,
      responseText: null,
    };

    this.feedback.push(entry);
    this.trimEntries();
    this.getOrCreateProfile(customerId);
    this.emit('feedback_received', entry);

    return entry;
  }

  private getOrCreateProfile(customerId: string) {
    if (!this.customerProfiles.has(customerId)) {
      this.customerProfiles.set(customerId, {
        firstSeen: Date.now(),
        sessionsCompleted: 0,
        lastActive: Date.now(),
        lastNPSSent: 0,
        surveysThisMonth: 0,
        monthReset: Date.now(),
      });
    }
    return this.customerProfiles.get(customerId)!;
  }

  private sentimentToScore(sentiment: SentimentLevel): number {
    const map: Record<SentimentLevel, number> = {
      very_positive: 5,
      positive: 4,
      neutral: 3,
      negative: 2,
      very_negative: 1,
    };
    return map[sentiment];
  }

  private aggregateSentiment(sentiments: SentimentLevel[]): SentimentLevel {
    if (sentiments.length === 0) return 'neutral';

    const scores: Record<SentimentLevel, number> = {
      very_positive: 5,
      positive: 4,
      neutral: 3,
      negative: 2,
      very_negative: 1,
    };

    const avg = sentiments.reduce((sum, s) => sum + scores[s], 0) / sentiments.length;

    if (avg >= 4.5) return 'very_positive';
    if (avg >= 3.5) return 'positive';
    if (avg >= 2.5) return 'neutral';
    if (avg >= 1.5) return 'negative';
    return 'very_negative';
  }

  private calculateNPSTrend(entries: FeedbackEntry[]): NPSResult['trend'] {
    if (entries.length < 4) return 'insufficient_data';

    const mid = Math.floor(entries.length / 2);
    const firstHalf = entries.slice(0, mid);
    const secondHalf = entries.slice(mid);

    const firstAvg = firstHalf.reduce((sum, e) => sum + (e.score || 0), 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, e) => sum + (e.score || 0), 0) / secondHalf.length;

    const diff = secondAvg - firstAvg;
    if (diff > 0.5) return 'improving';
    if (diff < -0.5) return 'declining';
    return 'stable';
  }

  private generateRecommendation(topic: string, sentiment: SentimentLevel, mentions: number): string {
    if (sentiment === 'very_negative' || sentiment === 'negative') {
      return `"${topic}" has ${mentions} negative mentions. Investigate and address customer concerns.`;
    }
    if (sentiment === 'very_positive' || sentiment === 'positive') {
      return `"${topic}" is well-received (${mentions} positive mentions). Consider highlighting in marketing.`;
    }
    return `"${topic}" mentioned ${mentions} times with mixed sentiment. Monitor for trends.`;
  }

  private trimEntries(): void {
    while (this.feedback.length > this.config.maxEntries) {
      this.feedback.shift();
    }
  }
}

// ─── Exported Utilities ──────────────────────────────────────────────────────

export { analyzeSentiment, classifyNPS };
