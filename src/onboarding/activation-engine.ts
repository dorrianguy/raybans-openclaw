/**
 * Activation Engine — User onboarding, activation tracking, churn prevention
 *
 * Guides new users from signup to "aha moment" and tracks engagement health.
 * Critical for reducing churn and increasing LTV (lifetime value).
 *
 * Revenue angle:
 * - Free trial conversion is the #1 revenue lever for SaaS
 * - Reducing churn by 5% increases profit by 25-95% (Bain & Company)
 * - Users who complete onboarding have 70% higher retention
 * - Automated engagement nudges reduce support costs
 *
 * @module activation-engine
 */

import { EventEmitter } from 'events';

// ─── Types ─────────────────────────────────────────────────────────────

export type OnboardingStage =
  | 'signup'             // Account created
  | 'device_paired'      // Ray-Bans connected via OpenClaw node
  | 'first_capture'      // First image captured through glasses
  | 'first_agent'        // First agent used (inventory, security, etc.)
  | 'first_voice'        // First voice command processed
  | 'first_export'       // First data export (CSV, report)
  | 'first_session'      // First complete inventory session
  | 'invited_team'       // Invited a team member (multi-store plan signal)
  | 'billing_setup'      // Payment method added
  | 'activated';         // Fully activated — experienced the "aha moment"

export type EngagementLevel = 'new' | 'exploring' | 'engaged' | 'power_user' | 'at_risk' | 'churned';

export type ChurnRisk = 'low' | 'medium' | 'high' | 'critical';

export interface UserActivation {
  userId: string;
  currentStage: OnboardingStage;
  completedStages: Set<OnboardingStage>;
  stageTimestamps: Map<OnboardingStage, number>;
  engagementLevel: EngagementLevel;
  churnRisk: ChurnRisk;
  signupAt: number;
  lastActiveAt: number;
  activatedAt?: number;
  // Engagement metrics
  totalSessions: number;
  totalCaptures: number;
  totalVoiceCommands: number;
  totalExports: number;
  agentsUsed: Set<string>;
  daysActive: number;
  streakDays: number;
  longestStreak: number;
  // Onboarding
  checklistProgress: number;   // 0-100
  onboardingTour: boolean;
  tooltipsShown: Set<string>;
  // Plan
  plan: string;
  trialEndsAt?: number;
  // Nudges
  lastNudgeAt?: number;
  nudgeCount: number;
  suppressNudges: boolean;
}

export interface OnboardingChecklist {
  id: string;
  title: string;
  description: string;
  stage: OnboardingStage;
  completed: boolean;
  completedAt?: number;
  order: number;
  reward?: string;           // "Unlock: Store Layout Mapping"
  estimatedMinutes: number;
}

export interface EngagementNudge {
  id: string;
  type: NudgeType;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
  priority: number;          // 1 = highest
  channel: NudgeChannel;
  triggerCondition: NudgeTrigger;
}

export type NudgeType =
  | 'onboarding_reminder'   // Haven't completed next step
  | 'feature_discovery'     // Haven't tried a key feature
  | 'win_moment'            // Celebrate an achievement
  | 'churn_prevention'      // Re-engagement for at-risk users
  | 'upgrade_prompt'        // Suggest plan upgrade
  | 'trial_expiring'        // Trial ending soon
  | 'tips_and_tricks';      // Usage tips

export type NudgeChannel = 'tts' | 'push' | 'email' | 'dashboard' | 'in_app';

export interface NudgeTrigger {
  daysInactive?: number;
  stageNotReached?: OnboardingStage;
  daysSinceSignup?: number;
  sessionsLessThan?: number;
  trialDaysRemaining?: number;
  churnRisk?: ChurnRisk;
}

export interface ActivationMetrics {
  totalUsers: number;
  activatedUsers: number;
  activationRate: number;
  averageTimeToActivation: number;  // ms
  stageConversion: Record<OnboardingStage, { reached: number; dropoff: number }>;
  engagementDistribution: Record<EngagementLevel, number>;
  churnRiskDistribution: Record<ChurnRisk, number>;
  averageChecklistProgress: number;
  trialConversionRate: number;
  nudgeEffectiveness: number;  // % of nudged users who re-engaged
}

export interface ActivationEngineConfig {
  activationStages: OnboardingStage[];   // Stages required for "activated"
  churnThresholdDays: number;            // Days inactive before "churned"
  atRiskThresholdDays: number;           // Days inactive before "at_risk"
  nudgeCooldownHours: number;            // Min hours between nudges
  maxNudgesPerUser: number;              // Max nudges before suppressing
  trialDays: number;
  engagementThresholds: {
    exploring: number;     // Min sessions
    engaged: number;
    powerUser: number;
  };
}

export interface ActivationEngineEvents {
  'user:signup': { userId: string };
  'user:activated': { userId: string; timeToActivation: number };
  'user:stage_completed': { userId: string; stage: OnboardingStage };
  'user:engagement_changed': { userId: string; from: EngagementLevel; to: EngagementLevel };
  'user:churn_risk_changed': { userId: string; risk: ChurnRisk };
  'user:churned': { userId: string; daysSinceActive: number };
  'nudge:sent': { userId: string; nudgeId: string; type: NudgeType };
  'nudge:suppressed': { userId: string; reason: string };
  'trial:expiring': { userId: string; daysRemaining: number };
  'trial:expired': { userId: string };
  'milestone:reached': { userId: string; milestone: string };
}

// ─── Default Config ────────────────────────────────────────────────────

export const DEFAULT_ACTIVATION_CONFIG: ActivationEngineConfig = {
  activationStages: ['device_paired', 'first_capture', 'first_agent', 'first_voice'],
  churnThresholdDays: 30,
  atRiskThresholdDays: 14,
  nudgeCooldownHours: 48,
  maxNudgesPerUser: 10,
  trialDays: 14,
  engagementThresholds: {
    exploring: 2,
    engaged: 10,
    powerUser: 50,
  },
};

// ─── Default Checklist ────────────────────────────────────────────────

const DEFAULT_CHECKLIST: Omit<OnboardingChecklist, 'completed' | 'completedAt'>[] = [
  {
    id: 'connect-glasses',
    title: 'Connect Your Ray-Bans',
    description: 'Pair your Meta Ray-Bans with the OpenClaw companion app',
    stage: 'device_paired',
    order: 1,
    reward: 'Unlock: Live Camera Feed',
    estimatedMinutes: 5,
  },
  {
    id: 'first-snap',
    title: 'Take Your First Photo',
    description: 'Capture an image through your glasses — just look and say "take a photo"',
    stage: 'first_capture',
    order: 2,
    reward: 'Unlock: Visual Memory Search',
    estimatedMinutes: 1,
  },
  {
    id: 'try-agent',
    title: 'Try an AI Agent',
    description: 'Use any agent — try inventory scanning, price checking, or document reading',
    stage: 'first_agent',
    order: 3,
    reward: 'Unlock: Multi-Agent Mode',
    estimatedMinutes: 3,
  },
  {
    id: 'voice-command',
    title: 'Use a Voice Command',
    description: 'Say "Hey, start inventory" or "What am I looking at?"',
    stage: 'first_voice',
    order: 4,
    reward: 'Unlock: Custom Voice Commands',
    estimatedMinutes: 1,
  },
  {
    id: 'complete-session',
    title: 'Complete an Inventory Session',
    description: 'Walk through a space and complete a full inventory count',
    stage: 'first_session',
    order: 5,
    reward: 'Unlock: Export & Reports',
    estimatedMinutes: 15,
  },
  {
    id: 'export-data',
    title: 'Export Your Data',
    description: 'Download your inventory as CSV or generate a PDF report',
    stage: 'first_export',
    order: 6,
    reward: 'Unlock: Scheduled Reports',
    estimatedMinutes: 2,
  },
  {
    id: 'invite-team',
    title: 'Invite a Team Member',
    description: 'Add someone to your organization (Multi-Store plan feature)',
    stage: 'invited_team',
    order: 7,
    reward: 'Unlock: Team Dashboard',
    estimatedMinutes: 3,
  },
  {
    id: 'setup-billing',
    title: 'Add Payment Method',
    description: 'Subscribe to keep access after your free trial',
    stage: 'billing_setup',
    order: 8,
    estimatedMinutes: 2,
  },
];

// ─── Default Nudges ──────────────────────────────────────────────────

const DEFAULT_NUDGES: EngagementNudge[] = [
  {
    id: 'nudge-pair-device',
    type: 'onboarding_reminder',
    title: 'Ready to Get Started?',
    message: 'Connect your Ray-Bans to unlock AI vision. It only takes 5 minutes!',
    actionLabel: 'Connect Now',
    priority: 1,
    channel: 'email',
    triggerCondition: { stageNotReached: 'device_paired', daysSinceSignup: 1 },
  },
  {
    id: 'nudge-first-capture',
    type: 'onboarding_reminder',
    title: 'Take Your First Photo!',
    message: 'Your glasses are connected — now capture your first image. Just look at something interesting and say "take a photo".',
    priority: 2,
    channel: 'push',
    triggerCondition: { stageNotReached: 'first_capture', daysSinceSignup: 2 },
  },
  {
    id: 'nudge-try-inventory',
    type: 'feature_discovery',
    title: 'Try Inventory Scanning',
    message: 'Walk through your store and say "start inventory" — watch the magic happen.',
    priority: 3,
    channel: 'tts',
    triggerCondition: { stageNotReached: 'first_agent', daysSinceSignup: 3 },
  },
  {
    id: 'nudge-churn-7d',
    type: 'churn_prevention',
    title: 'We Miss You!',
    message: 'It\'s been a week since your last session. Your glasses are ready to work — scan a shelf, read a price, or just explore.',
    priority: 1,
    channel: 'email',
    triggerCondition: { daysInactive: 7 },
  },
  {
    id: 'nudge-churn-14d',
    type: 'churn_prevention',
    title: 'Your AI Vision Misses You',
    message: 'It\'s been 2 weeks. Here\'s what you can do in 5 minutes: scan your entire snack aisle, read a foreign menu, or check a price.',
    priority: 1,
    channel: 'email',
    triggerCondition: { daysInactive: 14, churnRisk: 'high' },
  },
  {
    id: 'nudge-trial-3d',
    type: 'trial_expiring',
    title: 'Trial Ending Soon',
    message: 'Your free trial ends in 3 days. Subscribe now to keep your visual history and AI agents.',
    actionLabel: 'Subscribe Now',
    priority: 1,
    channel: 'push',
    triggerCondition: { trialDaysRemaining: 3 },
  },
  {
    id: 'nudge-trial-1d',
    type: 'trial_expiring',
    title: 'Last Day of Your Trial!',
    message: 'Your trial expires tomorrow. Don\'t lose access — plans start at $79/mo.',
    actionLabel: 'Choose a Plan',
    priority: 1,
    channel: 'email',
    triggerCondition: { trialDaysRemaining: 1 },
  },
  {
    id: 'nudge-upgrade-power',
    type: 'upgrade_prompt',
    title: 'You\'re a Power User!',
    message: 'You\'ve completed 50+ sessions. Upgrade to Multi-Store for unlimited team members and priority support.',
    actionLabel: 'Upgrade',
    priority: 2,
    channel: 'dashboard',
    triggerCondition: { sessionsLessThan: -1 }, // Special: triggered programmatically
  },
];

// ─── Milestones ──────────────────────────────────────────────────────

interface Milestone {
  id: string;
  name: string;
  description: string;
  threshold: number;
  metric: 'sessions' | 'captures' | 'voice_commands' | 'exports' | 'days_active' | 'streak';
  badge?: string;
}

const MILESTONES: Milestone[] = [
  { id: 'first-session', name: 'First Session', description: 'Complete your first inventory session', threshold: 1, metric: 'sessions', badge: '🏁' },
  { id: '10-sessions', name: 'Regular', description: 'Complete 10 inventory sessions', threshold: 10, metric: 'sessions', badge: '⭐' },
  { id: '50-sessions', name: 'Veteran', description: 'Complete 50 inventory sessions', threshold: 50, metric: 'sessions', badge: '🏆' },
  { id: '100-captures', name: 'Shutterbug', description: 'Capture 100 images', threshold: 100, metric: 'captures', badge: '📸' },
  { id: '1000-captures', name: 'Eagle Eye', description: 'Capture 1,000 images', threshold: 1000, metric: 'captures', badge: '🦅' },
  { id: '50-voice', name: 'Voice Pro', description: 'Use 50 voice commands', threshold: 50, metric: 'voice_commands', badge: '🎙️' },
  { id: '7-day-streak', name: 'Week Warrior', description: '7-day usage streak', threshold: 7, metric: 'streak', badge: '🔥' },
  { id: '30-day-streak', name: 'Monthly Maven', description: '30-day usage streak', threshold: 30, metric: 'streak', badge: '💎' },
  { id: '30-days-active', name: 'Loyal User', description: 'Active for 30 different days', threshold: 30, metric: 'days_active', badge: '❤️' },
];

// ─── Activation Engine Implementation ─────────────────────────────────

export class ActivationEngine extends EventEmitter {
  private config: ActivationEngineConfig;
  private users: Map<string, UserActivation> = new Map();
  private nudges: EngagementNudge[] = [];
  private milestones: Milestone[] = [...MILESTONES];
  private achievedMilestones: Map<string, Set<string>> = new Map(); // userId → milestoneIds
  private nudgeHistory: Map<string, Array<{ nudgeId: string; sentAt: number }>> = new Map();

  constructor(config: Partial<ActivationEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ACTIVATION_CONFIG, ...config };
    this.nudges = [...DEFAULT_NUDGES];
  }

  // ─── User Management ───────────────────────────────────────────────

  /**
   * Register a new user
   */
  registerUser(userId: string, options: { plan?: string; trialDays?: number } = {}): UserActivation {
    const now = Date.now();
    const trialDays = options.trialDays ?? this.config.trialDays;

    const user: UserActivation = {
      userId,
      currentStage: 'signup',
      completedStages: new Set(['signup']),
      stageTimestamps: new Map([['signup', now]]),
      engagementLevel: 'new',
      churnRisk: 'low',
      signupAt: now,
      lastActiveAt: now,
      totalSessions: 0,
      totalCaptures: 0,
      totalVoiceCommands: 0,
      totalExports: 0,
      agentsUsed: new Set(),
      daysActive: 1,
      streakDays: 1,
      longestStreak: 1,
      checklistProgress: this.calculateProgress(new Set(['signup'])),
      onboardingTour: false,
      tooltipsShown: new Set(),
      plan: options.plan ?? 'trial',
      trialEndsAt: trialDays > 0 ? now + (trialDays * 86400000) : undefined,
      nudgeCount: 0,
      suppressNudges: false,
    };

    this.users.set(userId, user);
    this.achievedMilestones.set(userId, new Set());
    this.emit('user:signup', { userId });

    return user;
  }

  /**
   * Get a user's activation data
   */
  getUser(userId: string): UserActivation | undefined {
    return this.users.get(userId);
  }

  /**
   * Get all users
   */
  getAllUsers(): UserActivation[] {
    return Array.from(this.users.values());
  }

  // ─── Stage Completion ──────────────────────────────────────────────

  /**
   * Mark a stage as completed for a user
   */
  completeStage(userId: string, stage: OnboardingStage): {
    completed: boolean;
    activated: boolean;
    progress: number;
  } {
    const user = this.users.get(userId);
    if (!user) return { completed: false, activated: false, progress: 0 };

    if (user.completedStages.has(stage)) {
      return { completed: false, activated: user.currentStage === 'activated', progress: user.checklistProgress };
    }

    user.completedStages.add(stage);
    user.stageTimestamps.set(stage, Date.now());
    user.currentStage = stage;
    user.lastActiveAt = Date.now();

    const progress = this.calculateProgress(user.completedStages);
    user.checklistProgress = progress;

    this.emit('user:stage_completed', { userId, stage });

    // Check if user is now activated
    const activated = this.checkActivation(user);

    return { completed: true, activated, progress };
  }

  /**
   * Check if a user has reached the activation threshold
   */
  private checkActivation(user: UserActivation): boolean {
    if (user.currentStage === 'activated') return true;

    const requiredStages = this.config.activationStages;
    const allCompleted = requiredStages.every(s => user.completedStages.has(s));

    if (allCompleted && user.currentStage !== 'activated') {
      user.currentStage = 'activated';
      user.activatedAt = Date.now();
      user.completedStages.add('activated');
      user.stageTimestamps.set('activated', Date.now());

      const timeToActivation = user.activatedAt - user.signupAt;
      this.emit('user:activated', { userId: user.userId, timeToActivation });

      return true;
    }

    return false;
  }

  private calculateProgress(completedStages: Set<OnboardingStage>): number {
    const totalSteps = DEFAULT_CHECKLIST.length;
    const completedSteps = DEFAULT_CHECKLIST.filter(item =>
      completedStages.has(item.stage)
    ).length;
    return Math.round((completedSteps / totalSteps) * 100);
  }

  // ─── Activity Tracking ─────────────────────────────────────────────

  /**
   * Record user activity (called on each interaction)
   */
  recordActivity(userId: string, activity: {
    type: 'session' | 'capture' | 'voice_command' | 'export' | 'agent_use';
    agentId?: string;
  }): void {
    const user = this.users.get(userId);
    if (!user) return;

    const now = Date.now();
    const daysSinceLastActive = (now - user.lastActiveAt) / 86400000;

    // Update streak
    if (daysSinceLastActive <= 1.5) {
      // Same day or next day
      if (daysSinceLastActive > 0.5) {
        user.streakDays++;
        if (user.streakDays > user.longestStreak) {
          user.longestStreak = user.streakDays;
        }
      }
    } else {
      // Streak broken
      user.streakDays = 1;
    }

    user.lastActiveAt = now;

    // Increment activity counts
    switch (activity.type) {
      case 'session':
        user.totalSessions++;
        break;
      case 'capture':
        user.totalCaptures++;
        break;
      case 'voice_command':
        user.totalVoiceCommands++;
        break;
      case 'export':
        user.totalExports++;
        break;
      case 'agent_use':
        if (activity.agentId) {
          user.agentsUsed.add(activity.agentId);
        }
        break;
    }

    // Update days active (approximate)
    const totalDays = Math.ceil((now - user.signupAt) / 86400000);
    if (totalDays > user.daysActive) {
      user.daysActive = Math.min(totalDays, user.daysActive + 1);
    }

    // Re-evaluate engagement level
    this.updateEngagement(user);

    // Check milestones
    this.checkMilestones(user);
  }

  // ─── Engagement Evaluation ─────────────────────────────────────────

  /**
   * Update a user's engagement level based on activity
   */
  private updateEngagement(user: UserActivation): void {
    const prev = user.engagementLevel;
    const { exploring, engaged, powerUser } = this.config.engagementThresholds;

    if (user.totalSessions >= powerUser) {
      user.engagementLevel = 'power_user';
    } else if (user.totalSessions >= engaged) {
      user.engagementLevel = 'engaged';
    } else if (user.totalSessions >= exploring) {
      user.engagementLevel = 'exploring';
    } else {
      user.engagementLevel = 'new';
    }

    if (prev !== user.engagementLevel) {
      this.emit('user:engagement_changed', { userId: user.userId, from: prev, to: user.engagementLevel });
    }
  }

  /**
   * Evaluate churn risk for all users (run periodically)
   */
  evaluateChurnRisk(currentTime: number = Date.now()): {
    userId: string;
    risk: ChurnRisk;
    daysSinceActive: number;
  }[] {
    const results: { userId: string; risk: ChurnRisk; daysSinceActive: number }[] = [];

    for (const user of this.users.values()) {
      const daysSinceActive = (currentTime - user.lastActiveAt) / 86400000;
      const prevRisk = user.churnRisk;
      let risk: ChurnRisk;

      if (daysSinceActive >= this.config.churnThresholdDays) {
        risk = 'critical';
        if (user.engagementLevel !== 'churned') {
          user.engagementLevel = 'churned';
          this.emit('user:churned', { userId: user.userId, daysSinceActive: Math.round(daysSinceActive) });
        }
      } else if (daysSinceActive >= this.config.atRiskThresholdDays) {
        risk = 'high';
        if (user.engagementLevel !== 'at_risk' && user.engagementLevel !== 'churned') {
          const prev = user.engagementLevel;
          user.engagementLevel = 'at_risk';
          this.emit('user:engagement_changed', { userId: user.userId, from: prev, to: 'at_risk' });
        }
      } else if (daysSinceActive >= 7) {
        risk = 'medium';
      } else {
        risk = 'low';
      }

      user.churnRisk = risk;

      if (risk !== prevRisk) {
        this.emit('user:churn_risk_changed', { userId: user.userId, risk });
      }

      results.push({ userId: user.userId, risk, daysSinceActive: Math.round(daysSinceActive) });
    }

    return results;
  }

  // ─── Onboarding Checklist ──────────────────────────────────────────

  /**
   * Get the onboarding checklist for a user
   */
  getChecklist(userId: string): OnboardingChecklist[] {
    const user = this.users.get(userId);
    if (!user) return [];

    return DEFAULT_CHECKLIST.map(item => ({
      ...item,
      completed: user.completedStages.has(item.stage),
      completedAt: user.stageTimestamps.get(item.stage),
    }));
  }

  /**
   * Get the next recommended action for a user
   */
  getNextAction(userId: string): OnboardingChecklist | null {
    const checklist = this.getChecklist(userId);
    return checklist.find(item => !item.completed) ?? null;
  }

  // ─── Nudges ────────────────────────────────────────────────────────

  /**
   * Get applicable nudges for a user
   */
  getApplicableNudges(userId: string, currentTime: number = Date.now()): EngagementNudge[] {
    const user = this.users.get(userId);
    if (!user || user.suppressNudges) return [];

    // Check cooldown
    if (user.lastNudgeAt && (currentTime - user.lastNudgeAt) < this.config.nudgeCooldownHours * 3600000) {
      return [];
    }

    // Check max nudges
    if (user.nudgeCount >= this.config.maxNudgesPerUser) {
      return [];
    }

    const daysSinceSignup = (currentTime - user.signupAt) / 86400000;
    const daysSinceActive = (currentTime - user.lastActiveAt) / 86400000;
    const trialDaysRemaining = user.trialEndsAt
      ? Math.max(0, (user.trialEndsAt - currentTime) / 86400000)
      : undefined;

    const applicable: EngagementNudge[] = [];

    for (const nudge of this.nudges) {
      const trigger = nudge.triggerCondition;
      let matches = true;

      if (trigger.daysInactive !== undefined && daysSinceActive < trigger.daysInactive) {
        matches = false;
      }
      if (trigger.stageNotReached && user.completedStages.has(trigger.stageNotReached)) {
        matches = false;
      }
      if (trigger.daysSinceSignup !== undefined && daysSinceSignup < trigger.daysSinceSignup) {
        matches = false;
      }
      if (trigger.sessionsLessThan !== undefined && trigger.sessionsLessThan >= 0 &&
          user.totalSessions >= trigger.sessionsLessThan) {
        matches = false;
      }
      if (trigger.trialDaysRemaining !== undefined && trialDaysRemaining !== undefined &&
          trialDaysRemaining > trigger.trialDaysRemaining) {
        matches = false;
      }
      if (trigger.churnRisk && user.churnRisk !== trigger.churnRisk) {
        matches = false;
      }

      // Don't re-send nudges
      const history = this.nudgeHistory.get(userId) ?? [];
      if (history.some(h => h.nudgeId === nudge.id)) {
        matches = false;
      }

      if (matches) {
        applicable.push(nudge);
      }
    }

    return applicable.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Mark a nudge as sent
   */
  recordNudgeSent(userId: string, nudgeId: string): void {
    const user = this.users.get(userId);
    if (!user) return;

    user.lastNudgeAt = Date.now();
    user.nudgeCount++;

    const history = this.nudgeHistory.get(userId) ?? [];
    history.push({ nudgeId, sentAt: Date.now() });
    this.nudgeHistory.set(userId, history);

    const nudge = this.nudges.find(n => n.id === nudgeId);
    if (nudge) {
      this.emit('nudge:sent', { userId, nudgeId, type: nudge.type });
    }
  }

  /**
   * Suppress nudges for a user (user opted out)
   */
  suppressNudges(userId: string, suppress: boolean = true): void {
    const user = this.users.get(userId);
    if (user) {
      user.suppressNudges = suppress;
    }
  }

  /**
   * Add a custom nudge
   */
  addNudge(nudge: EngagementNudge): void {
    this.nudges.push(nudge);
  }

  // ─── Trial Management ──────────────────────────────────────────────

  /**
   * Check trial status for all users
   */
  checkTrials(currentTime: number = Date.now()): {
    expiring: { userId: string; daysRemaining: number }[];
    expired: { userId: string }[];
  } {
    const expiring: { userId: string; daysRemaining: number }[] = [];
    const expired: { userId: string }[] = [];

    for (const user of this.users.values()) {
      if (!user.trialEndsAt || user.plan !== 'trial') continue;

      const daysRemaining = (user.trialEndsAt - currentTime) / 86400000;

      if (daysRemaining <= 0) {
        expired.push({ userId: user.userId });
        this.emit('trial:expired', { userId: user.userId });
      } else if (daysRemaining <= 7) {
        expiring.push({ userId: user.userId, daysRemaining: Math.ceil(daysRemaining) });
        if (daysRemaining <= 3) {
          this.emit('trial:expiring', { userId: user.userId, daysRemaining: Math.ceil(daysRemaining) });
        }
      }
    }

    return { expiring, expired };
  }

  /**
   * Convert trial to paid plan
   */
  convertTrial(userId: string, plan: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;

    user.plan = plan;
    user.trialEndsAt = undefined;
    return true;
  }

  // ─── Milestones ────────────────────────────────────────────────────

  /**
   * Check and award milestones for a user
   */
  private checkMilestones(user: UserActivation): void {
    const achieved = this.achievedMilestones.get(user.userId) ?? new Set();

    for (const milestone of this.milestones) {
      if (achieved.has(milestone.id)) continue;

      let value: number;
      switch (milestone.metric) {
        case 'sessions': value = user.totalSessions; break;
        case 'captures': value = user.totalCaptures; break;
        case 'voice_commands': value = user.totalVoiceCommands; break;
        case 'exports': value = user.totalExports; break;
        case 'days_active': value = user.daysActive; break;
        case 'streak': value = user.streakDays; break;
        default: continue;
      }

      if (value >= milestone.threshold) {
        achieved.add(milestone.id);
        this.emit('milestone:reached', {
          userId: user.userId,
          milestone: `${milestone.badge ?? ''} ${milestone.name}`.trim(),
        });
      }
    }

    this.achievedMilestones.set(user.userId, achieved);
  }

  /**
   * Get achieved milestones for a user
   */
  getUserMilestones(userId: string): Milestone[] {
    const achieved = this.achievedMilestones.get(userId) ?? new Set();
    return this.milestones.filter(m => achieved.has(m.id));
  }

  /**
   * Get all available milestones
   */
  getAllMilestones(): Milestone[] {
    return [...this.milestones];
  }

  // ─── Metrics & Reporting ───────────────────────────────────────────

  /**
   * Generate activation metrics report
   */
  getMetrics(): ActivationMetrics {
    const users = Array.from(this.users.values());
    const total = users.length;
    if (total === 0) {
      return {
        totalUsers: 0,
        activatedUsers: 0,
        activationRate: 0,
        averageTimeToActivation: 0,
        stageConversion: {} as Record<OnboardingStage, { reached: number; dropoff: number }>,
        engagementDistribution: { new: 0, exploring: 0, engaged: 0, power_user: 0, at_risk: 0, churned: 0 },
        churnRiskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
        averageChecklistProgress: 0,
        trialConversionRate: 0,
        nudgeEffectiveness: 0,
      };
    }

    const activated = users.filter(u => u.activatedAt);
    const activationTimes = activated
      .map(u => u.activatedAt! - u.signupAt)
      .filter(t => t > 0);

    // Stage conversion funnel
    const stages: OnboardingStage[] = [
      'signup', 'device_paired', 'first_capture', 'first_agent',
      'first_voice', 'first_session', 'first_export', 'invited_team',
      'billing_setup', 'activated',
    ];

    const stageConversion: Record<string, { reached: number; dropoff: number }> = {};
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const reached = users.filter(u => u.completedStages.has(stage)).length;
      const prevReached = i > 0 ? users.filter(u => u.completedStages.has(stages[i - 1])).length : total;
      stageConversion[stage] = {
        reached,
        dropoff: prevReached > 0 ? Math.round((1 - reached / prevReached) * 100) : 0,
      };
    }

    // Engagement distribution
    const engagementDist: Record<EngagementLevel, number> = {
      new: 0, exploring: 0, engaged: 0, power_user: 0, at_risk: 0, churned: 0,
    };
    for (const u of users) {
      engagementDist[u.engagementLevel]++;
    }

    // Churn risk distribution
    const churnDist: Record<ChurnRisk, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const u of users) {
      churnDist[u.churnRisk]++;
    }

    // Trial conversion
    const trialUsers = users.filter(u => u.trialEndsAt || u.plan !== 'trial');
    const converted = trialUsers.filter(u => u.plan !== 'trial');

    // Nudge effectiveness
    const nudgedUsers = users.filter(u => u.nudgeCount > 0);
    const reEngaged = nudgedUsers.filter(u =>
      u.engagementLevel !== 'churned' && u.engagementLevel !== 'at_risk'
    );

    return {
      totalUsers: total,
      activatedUsers: activated.length,
      activationRate: Math.round((activated.length / total) * 100),
      averageTimeToActivation: activationTimes.length > 0
        ? activationTimes.reduce((s, t) => s + t, 0) / activationTimes.length
        : 0,
      stageConversion: stageConversion as Record<OnboardingStage, { reached: number; dropoff: number }>,
      engagementDistribution: engagementDist,
      churnRiskDistribution: churnDist,
      averageChecklistProgress: Math.round(users.reduce((s, u) => s + u.checklistProgress, 0) / total),
      trialConversionRate: trialUsers.length > 0
        ? Math.round((converted.length / trialUsers.length) * 100)
        : 0,
      nudgeEffectiveness: nudgedUsers.length > 0
        ? Math.round((reEngaged.length / nudgedUsers.length) * 100)
        : 0,
    };
  }

  /**
   * Generate a voice-friendly activation summary
   */
  generateVoiceSummary(): string {
    const metrics = this.getMetrics();
    const parts: string[] = [];

    parts.push(`${metrics.totalUsers} total users.`);
    parts.push(`${metrics.activationRate}% activation rate.`);

    if (metrics.churnRiskDistribution.critical > 0) {
      parts.push(`${metrics.churnRiskDistribution.critical} users at critical churn risk.`);
    }

    if (metrics.engagementDistribution.power_user > 0) {
      parts.push(`${metrics.engagementDistribution.power_user} power users.`);
    }

    parts.push(`Average checklist progress: ${metrics.averageChecklistProgress}%.`);

    return parts.join(' ');
  }

  // ─── Stats ─────────────────────────────────────────────────────────

  getStats(): {
    totalUsers: number;
    activatedUsers: number;
    atRiskUsers: number;
    churnedUsers: number;
    totalNudgesSent: number;
    totalMilestonesAchieved: number;
    trialUsers: number;
  } {
    const users = Array.from(this.users.values());
    let totalNudges = 0;
    for (const history of this.nudgeHistory.values()) {
      totalNudges += history.length;
    }
    let totalMilestones = 0;
    for (const set of this.achievedMilestones.values()) {
      totalMilestones += set.size;
    }

    return {
      totalUsers: users.length,
      activatedUsers: users.filter(u => u.activatedAt).length,
      atRiskUsers: users.filter(u => u.engagementLevel === 'at_risk').length,
      churnedUsers: users.filter(u => u.engagementLevel === 'churned').length,
      totalNudgesSent: totalNudges,
      totalMilestonesAchieved: totalMilestones,
      trialUsers: users.filter(u => u.plan === 'trial').length,
    };
  }

  /**
   * Reset engine state (for testing)
   */
  reset(): void {
    this.users.clear();
    this.achievedMilestones.clear();
    this.nudgeHistory.clear();
    this.nudges = [...DEFAULT_NUDGES];
    this.milestones = [...MILESTONES];
  }
}
