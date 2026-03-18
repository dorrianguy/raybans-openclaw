/**
 * Tests for Activation Engine
 * Covers: user registration, stage completion, activity tracking, engagement levels,
 * churn risk, onboarding checklist, nudges, trial management, milestones, metrics
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ActivationEngine,
  DEFAULT_ACTIVATION_CONFIG,
  type OnboardingStage,
  type EngagementLevel,
  type ChurnRisk,
} from './activation-engine.js';

describe('ActivationEngine', () => {
  let engine: ActivationEngine;

  beforeEach(() => {
    engine = new ActivationEngine();
  });

  // ─── Constructor & Config ────────────────────────────────────────

  describe('constructor', () => {
    it('should create with default config', () => {
      const stats = engine.getStats();
      expect(stats.totalUsers).toBe(0);
    });

    it('should accept custom config', () => {
      const custom = new ActivationEngine({
        trialDays: 30,
        churnThresholdDays: 60,
      });
      const user = custom.registerUser('u1');
      expect(user.trialEndsAt).toBeDefined();
      // 30 days trial
      const diff = (user.trialEndsAt! - user.signupAt) / 86400000;
      expect(diff).toBe(30);
    });
  });

  // ─── User Registration ──────────────────────────────────────────

  describe('user registration', () => {
    it('should register a new user', () => {
      const user = engine.registerUser('user-1');
      expect(user.userId).toBe('user-1');
      expect(user.currentStage).toBe('signup');
      expect(user.completedStages.has('signup')).toBe(true);
      expect(user.engagementLevel).toBe('new');
      expect(user.churnRisk).toBe('low');
      expect(user.plan).toBe('trial');
    });

    it('should set trial end date', () => {
      const user = engine.registerUser('u1');
      expect(user.trialEndsAt).toBeDefined();
      const trialDays = (user.trialEndsAt! - user.signupAt) / 86400000;
      expect(trialDays).toBe(14); // Default
    });

    it('should accept custom plan', () => {
      const user = engine.registerUser('u1', { plan: 'pro' });
      expect(user.plan).toBe('pro');
    });

    it('should accept custom trial duration', () => {
      const user = engine.registerUser('u1', { trialDays: 30 });
      const trialDays = (user.trialEndsAt! - user.signupAt) / 86400000;
      expect(trialDays).toBe(30);
    });

    it('should emit signup event', () => {
      const fn = vi.fn();
      engine.on('user:signup', fn);
      engine.registerUser('u1');
      expect(fn).toHaveBeenCalledWith({ userId: 'u1' });
    });

    it('should get user by ID', () => {
      engine.registerUser('u1');
      expect(engine.getUser('u1')).toBeDefined();
      expect(engine.getUser('nonexistent')).toBeUndefined();
    });

    it('should get all users', () => {
      engine.registerUser('u1');
      engine.registerUser('u2');
      expect(engine.getAllUsers()).toHaveLength(2);
    });
  });

  // ─── Stage Completion ──────────────────────────────────────────

  describe('stage completion', () => {
    it('should complete a stage', () => {
      engine.registerUser('u1');
      const result = engine.completeStage('u1', 'device_paired');
      expect(result.completed).toBe(true);
      expect(result.progress).toBeGreaterThan(0);

      const user = engine.getUser('u1')!;
      expect(user.completedStages.has('device_paired')).toBe(true);
      expect(user.currentStage).toBe('device_paired');
    });

    it('should not re-complete a stage', () => {
      engine.registerUser('u1');
      engine.completeStage('u1', 'device_paired');
      const result = engine.completeStage('u1', 'device_paired');
      expect(result.completed).toBe(false);
    });

    it('should return false for unknown user', () => {
      const result = engine.completeStage('nobody', 'first_capture');
      expect(result.completed).toBe(false);
      expect(result.progress).toBe(0);
    });

    it('should emit stage_completed event', () => {
      const fn = vi.fn();
      engine.on('user:stage_completed', fn);
      engine.registerUser('u1');
      engine.completeStage('u1', 'first_capture');
      expect(fn).toHaveBeenCalledWith({ userId: 'u1', stage: 'first_capture' });
    });

    it('should activate user when all required stages complete', () => {
      const fn = vi.fn();
      engine.on('user:activated', fn);

      engine.registerUser('u1');
      // Complete all required stages
      for (const stage of DEFAULT_ACTIVATION_CONFIG.activationStages) {
        engine.completeStage('u1', stage);
      }

      expect(fn).toHaveBeenCalled();
      expect(fn.mock.calls[0][0].timeToActivation).toBeGreaterThanOrEqual(0);
      expect(engine.getUser('u1')!.currentStage).toBe('activated');
    });

    it('should not activate with partial stages', () => {
      engine.registerUser('u1');
      engine.completeStage('u1', 'device_paired');
      engine.completeStage('u1', 'first_capture');
      // Missing first_agent and first_voice

      expect(engine.getUser('u1')!.currentStage).not.toBe('activated');
    });

    it('should track progress percentage', () => {
      engine.registerUser('u1');
      const result1 = engine.completeStage('u1', 'device_paired');
      expect(result1.progress).toBeGreaterThan(0);
      expect(result1.progress).toBeLessThan(100);

      const result2 = engine.completeStage('u1', 'first_capture');
      expect(result2.progress).toBeGreaterThan(result1.progress);
    });
  });

  // ─── Activity Tracking ─────────────────────────────────────────

  describe('activity tracking', () => {
    it('should track session activity', () => {
      engine.registerUser('u1');
      engine.recordActivity('u1', { type: 'session' });
      engine.recordActivity('u1', { type: 'session' });

      expect(engine.getUser('u1')!.totalSessions).toBe(2);
    });

    it('should track capture activity', () => {
      engine.registerUser('u1');
      engine.recordActivity('u1', { type: 'capture' });
      expect(engine.getUser('u1')!.totalCaptures).toBe(1);
    });

    it('should track voice commands', () => {
      engine.registerUser('u1');
      engine.recordActivity('u1', { type: 'voice_command' });
      expect(engine.getUser('u1')!.totalVoiceCommands).toBe(1);
    });

    it('should track exports', () => {
      engine.registerUser('u1');
      engine.recordActivity('u1', { type: 'export' });
      expect(engine.getUser('u1')!.totalExports).toBe(1);
    });

    it('should track agents used', () => {
      engine.registerUser('u1');
      engine.recordActivity('u1', { type: 'agent_use', agentId: 'inventory' });
      engine.recordActivity('u1', { type: 'agent_use', agentId: 'security' });
      engine.recordActivity('u1', { type: 'agent_use', agentId: 'inventory' }); // Dedup

      expect(engine.getUser('u1')!.agentsUsed.size).toBe(2);
    });

    it('should update lastActiveAt', () => {
      engine.registerUser('u1');
      const before = engine.getUser('u1')!.lastActiveAt;

      // Small delay
      engine.recordActivity('u1', { type: 'session' });
      expect(engine.getUser('u1')!.lastActiveAt).toBeGreaterThanOrEqual(before);
    });

    it('should ignore activity for unknown users', () => {
      // Should not throw
      engine.recordActivity('nobody', { type: 'session' });
    });
  });

  // ─── Engagement Levels ─────────────────────────────────────────

  describe('engagement levels', () => {
    it('should start as new', () => {
      engine.registerUser('u1');
      expect(engine.getUser('u1')!.engagementLevel).toBe('new');
    });

    it('should progress to exploring', () => {
      engine.registerUser('u1');
      for (let i = 0; i < 2; i++) {
        engine.recordActivity('u1', { type: 'session' });
      }
      expect(engine.getUser('u1')!.engagementLevel).toBe('exploring');
    });

    it('should progress to engaged', () => {
      engine.registerUser('u1');
      for (let i = 0; i < 10; i++) {
        engine.recordActivity('u1', { type: 'session' });
      }
      expect(engine.getUser('u1')!.engagementLevel).toBe('engaged');
    });

    it('should progress to power_user', () => {
      engine.registerUser('u1');
      for (let i = 0; i < 50; i++) {
        engine.recordActivity('u1', { type: 'session' });
      }
      expect(engine.getUser('u1')!.engagementLevel).toBe('power_user');
    });

    it('should emit engagement_changed event', () => {
      const fn = vi.fn();
      engine.on('user:engagement_changed', fn);

      engine.registerUser('u1');
      for (let i = 0; i < 2; i++) {
        engine.recordActivity('u1', { type: 'session' });
      }

      expect(fn).toHaveBeenCalledWith({ userId: 'u1', from: 'new', to: 'exploring' });
    });
  });

  // ─── Churn Risk ─────────────────────────────────────────────────

  describe('churn risk', () => {
    it('should be low for active users', () => {
      engine.registerUser('u1');
      const results = engine.evaluateChurnRisk();
      expect(results[0].risk).toBe('low');
    });

    it('should be medium after 7 days inactive', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      user.lastActiveAt = Date.now() - (8 * 86400000);

      const results = engine.evaluateChurnRisk();
      expect(results[0].risk).toBe('medium');
    });

    it('should be high after 14 days inactive', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      user.lastActiveAt = Date.now() - (15 * 86400000);

      const results = engine.evaluateChurnRisk();
      expect(results[0].risk).toBe('high');
    });

    it('should be critical after 30 days inactive', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      user.lastActiveAt = Date.now() - (31 * 86400000);

      const results = engine.evaluateChurnRisk();
      expect(results[0].risk).toBe('critical');
    });

    it('should emit churn_risk_changed event', () => {
      const fn = vi.fn();
      engine.on('user:churn_risk_changed', fn);

      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      user.lastActiveAt = Date.now() - (15 * 86400000);

      engine.evaluateChurnRisk();
      expect(fn).toHaveBeenCalledWith({ userId: 'u1', risk: 'high' });
    });

    it('should emit churned event', () => {
      const fn = vi.fn();
      engine.on('user:churned', fn);

      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      user.lastActiveAt = Date.now() - (31 * 86400000);

      engine.evaluateChurnRisk();
      expect(fn).toHaveBeenCalled();
    });

    it('should mark churned users engagement', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      user.lastActiveAt = Date.now() - (31 * 86400000);

      engine.evaluateChurnRisk();
      expect(user.engagementLevel).toBe('churned');
    });
  });

  // ─── Onboarding Checklist ──────────────────────────────────────

  describe('onboarding checklist', () => {
    it('should return checklist for user', () => {
      engine.registerUser('u1');
      const checklist = engine.getChecklist('u1');
      expect(checklist.length).toBeGreaterThan(0);
      expect(checklist[0].order).toBe(1);
    });

    it('should mark completed items', () => {
      engine.registerUser('u1');
      engine.completeStage('u1', 'device_paired');

      const checklist = engine.getChecklist('u1');
      const paired = checklist.find(c => c.stage === 'device_paired');
      expect(paired!.completed).toBe(true);
      expect(paired!.completedAt).toBeDefined();
    });

    it('should return empty for unknown user', () => {
      expect(engine.getChecklist('nobody')).toHaveLength(0);
    });

    it('should get next recommended action', () => {
      engine.registerUser('u1');
      const next = engine.getNextAction('u1');
      expect(next).not.toBeNull();
      expect(next!.completed).toBe(false);
    });

    it('should return null when all items complete', () => {
      engine.registerUser('u1');
      const stages: OnboardingStage[] = [
        'device_paired', 'first_capture', 'first_agent', 'first_voice',
        'first_session', 'first_export', 'invited_team', 'billing_setup',
      ];
      for (const s of stages) {
        engine.completeStage('u1', s);
      }

      expect(engine.getNextAction('u1')).toBeNull();
    });
  });

  // ─── Nudges ─────────────────────────────────────────────────────

  describe('nudges', () => {
    it('should find applicable nudges for new user', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      // Simulate 1 day since signup
      user.signupAt = Date.now() - (1.5 * 86400000);
      user.lastActiveAt = Date.now() - (1.5 * 86400000);

      const nudges = engine.getApplicableNudges('u1');
      expect(nudges.length).toBeGreaterThan(0);
    });

    it('should respect nudge cooldown', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      user.signupAt = Date.now() - (2 * 86400000);
      user.lastActiveAt = Date.now() - (2 * 86400000);
      user.lastNudgeAt = Date.now() - 3600000; // 1 hour ago (within 48h cooldown)

      const nudges = engine.getApplicableNudges('u1');
      expect(nudges).toHaveLength(0);
    });

    it('should respect max nudges limit', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      user.nudgeCount = DEFAULT_ACTIVATION_CONFIG.maxNudgesPerUser;

      const nudges = engine.getApplicableNudges('u1');
      expect(nudges).toHaveLength(0);
    });

    it('should respect suppress nudges flag', () => {
      engine.registerUser('u1');
      engine.suppressNudges('u1', true);
      expect(engine.getApplicableNudges('u1')).toHaveLength(0);
    });

    it('should not re-send already sent nudges', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      user.signupAt = Date.now() - (2 * 86400000);
      user.lastActiveAt = Date.now() - (2 * 86400000);

      const nudges = engine.getApplicableNudges('u1');
      if (nudges.length > 0) {
        engine.recordNudgeSent('u1', nudges[0].id);
        const after = engine.getApplicableNudges('u1');
        // Should not contain the sent nudge (also cooldown blocks all)
        const sent = after.find(n => n.id === nudges[0].id);
        expect(sent).toBeUndefined();
      }
    });

    it('should record nudge sent', () => {
      const fn = vi.fn();
      engine.on('nudge:sent', fn);

      engine.registerUser('u1');
      engine.recordNudgeSent('u1', 'nudge-pair-device');

      expect(fn).toHaveBeenCalled();
      expect(engine.getUser('u1')!.nudgeCount).toBe(1);
    });

    it('should not match nudge for completed stage', () => {
      engine.registerUser('u1');
      engine.completeStage('u1', 'device_paired');
      const user = engine.getUser('u1')!;
      user.signupAt = Date.now() - (2 * 86400000);

      const nudges = engine.getApplicableNudges('u1');
      const pairNudge = nudges.find(n => n.triggerCondition.stageNotReached === 'device_paired');
      expect(pairNudge).toBeUndefined();
    });

    it('should add custom nudge', () => {
      engine.addNudge({
        id: 'custom-1',
        type: 'tips_and_tricks',
        title: 'Custom Tip',
        message: 'Try this cool feature!',
        priority: 5,
        channel: 'dashboard',
        triggerCondition: { sessionsLessThan: 5 },
      });

      engine.registerUser('u1');
      const nudges = engine.getApplicableNudges('u1');
      expect(nudges.find(n => n.id === 'custom-1')).toBeDefined();
    });
  });

  // ─── Trial Management ──────────────────────────────────────────

  describe('trial management', () => {
    it('should detect expiring trials', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      user.trialEndsAt = Date.now() + (2 * 86400000); // 2 days left

      const { expiring } = engine.checkTrials();
      expect(expiring.length).toBe(1);
      expect(expiring[0].daysRemaining).toBeLessThanOrEqual(3);
    });

    it('should detect expired trials', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;
      user.trialEndsAt = Date.now() - 86400000; // Expired yesterday

      const { expired } = engine.checkTrials();
      expect(expired.length).toBe(1);
    });

    it('should emit trial events', () => {
      const expiringFn = vi.fn();
      const expiredFn = vi.fn();
      engine.on('trial:expiring', expiringFn);
      engine.on('trial:expired', expiredFn);

      engine.registerUser('u1');
      engine.getUser('u1')!.trialEndsAt = Date.now() + (2 * 86400000);

      engine.registerUser('u2');
      engine.getUser('u2')!.trialEndsAt = Date.now() - 86400000;

      engine.checkTrials();
      expect(expiringFn).toHaveBeenCalled();
      expect(expiredFn).toHaveBeenCalled();
    });

    it('should convert trial to paid', () => {
      engine.registerUser('u1');
      expect(engine.convertTrial('u1', 'pro')).toBe(true);

      const user = engine.getUser('u1')!;
      expect(user.plan).toBe('pro');
      expect(user.trialEndsAt).toBeUndefined();
    });

    it('should return false converting unknown user', () => {
      expect(engine.convertTrial('nobody', 'pro')).toBe(false);
    });

    it('should skip non-trial users', () => {
      engine.registerUser('u1', { plan: 'pro' });
      const { expiring, expired } = engine.checkTrials();
      expect(expiring).toHaveLength(0);
      expect(expired).toHaveLength(0);
    });
  });

  // ─── Milestones ─────────────────────────────────────────────────

  describe('milestones', () => {
    it('should award session milestone', () => {
      const fn = vi.fn();
      engine.on('milestone:reached', fn);

      engine.registerUser('u1');
      engine.recordActivity('u1', { type: 'session' }); // 1st session

      expect(fn).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'u1',
        milestone: expect.stringContaining('First Session'),
      }));
    });

    it('should award capture milestone at 100', () => {
      const fn = vi.fn();
      engine.on('milestone:reached', fn);

      engine.registerUser('u1');
      for (let i = 0; i < 100; i++) {
        engine.recordActivity('u1', { type: 'capture' });
      }

      const milestoneNames = fn.mock.calls.map((c: any) => c[0].milestone);
      expect(milestoneNames.some((m: string) => m.includes('Shutterbug'))).toBe(true);
    });

    it('should not re-award milestones', () => {
      const fn = vi.fn();
      engine.on('milestone:reached', fn);

      engine.registerUser('u1');
      engine.recordActivity('u1', { type: 'session' });
      const count1 = fn.mock.calls.length;

      engine.recordActivity('u1', { type: 'session' });
      // Should not re-fire first-session milestone
      const firstSessionCalls = fn.mock.calls.filter(
        (c: any) => c[0].milestone.includes('First Session')
      );
      expect(firstSessionCalls.length).toBe(1);
    });

    it('should get user milestones', () => {
      engine.registerUser('u1');
      engine.recordActivity('u1', { type: 'session' });

      const milestones = engine.getUserMilestones('u1');
      expect(milestones.length).toBeGreaterThan(0);
    });

    it('should get all available milestones', () => {
      expect(engine.getAllMilestones().length).toBeGreaterThan(0);
    });
  });

  // ─── Streaks ────────────────────────────────────────────────────

  describe('streaks', () => {
    it('should maintain streak for consecutive day activity', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;

      // Simulate activity yesterday
      user.lastActiveAt = Date.now() - (1 * 86400000);
      engine.recordActivity('u1', { type: 'session' });

      expect(user.streakDays).toBe(2);
    });

    it('should reset streak after gap', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;

      // Simulate 3 days ago
      user.lastActiveAt = Date.now() - (3 * 86400000);
      user.streakDays = 5;
      engine.recordActivity('u1', { type: 'session' });

      expect(user.streakDays).toBe(1); // Reset
    });

    it('should track longest streak', () => {
      engine.registerUser('u1');
      const user = engine.getUser('u1')!;

      user.lastActiveAt = Date.now() - 86400000;
      user.streakDays = 1;
      engine.recordActivity('u1', { type: 'session' }); // streak = 2
      expect(user.longestStreak).toBe(2);

      // Break streak
      user.lastActiveAt = Date.now() - (3 * 86400000);
      engine.recordActivity('u1', { type: 'session' }); // streak reset to 1
      expect(user.streakDays).toBe(1);
      expect(user.longestStreak).toBe(2); // Preserved
    });
  });

  // ─── Metrics ────────────────────────────────────────────────────

  describe('metrics', () => {
    it('should generate empty metrics', () => {
      const metrics = engine.getMetrics();
      expect(metrics.totalUsers).toBe(0);
      expect(metrics.activationRate).toBe(0);
    });

    it('should calculate activation rate', () => {
      engine.registerUser('u1');
      engine.registerUser('u2');
      engine.registerUser('u3');

      // Activate u1
      for (const stage of DEFAULT_ACTIVATION_CONFIG.activationStages) {
        engine.completeStage('u1', stage);
      }

      const metrics = engine.getMetrics();
      expect(metrics.totalUsers).toBe(3);
      expect(metrics.activatedUsers).toBe(1);
      expect(metrics.activationRate).toBe(33); // 1/3
    });

    it('should track stage conversion funnel', () => {
      engine.registerUser('u1');
      engine.registerUser('u2');
      engine.registerUser('u3');

      engine.completeStage('u1', 'device_paired');
      engine.completeStage('u2', 'device_paired');
      engine.completeStage('u1', 'first_capture');

      const metrics = engine.getMetrics();
      expect(metrics.stageConversion.signup.reached).toBe(3);
      expect(metrics.stageConversion.device_paired.reached).toBe(2);
      expect(metrics.stageConversion.first_capture.reached).toBe(1);
    });

    it('should track engagement distribution', () => {
      engine.registerUser('u1');
      engine.registerUser('u2');
      for (let i = 0; i < 10; i++) {
        engine.recordActivity('u2', { type: 'session' });
      }

      const metrics = engine.getMetrics();
      expect(metrics.engagementDistribution.new).toBe(1);
      expect(metrics.engagementDistribution.engaged).toBe(1);
    });

    it('should track churn risk distribution', () => {
      engine.registerUser('u1');
      engine.registerUser('u2');
      engine.getUser('u2')!.lastActiveAt = Date.now() - (15 * 86400000);
      engine.evaluateChurnRisk();

      const metrics = engine.getMetrics();
      expect(metrics.churnRiskDistribution.low).toBe(1);
      expect(metrics.churnRiskDistribution.high).toBe(1);
    });

    it('should calculate average checklist progress', () => {
      engine.registerUser('u1');
      engine.registerUser('u2');
      engine.completeStage('u1', 'device_paired');
      engine.completeStage('u1', 'first_capture');

      const metrics = engine.getMetrics();
      expect(metrics.averageChecklistProgress).toBeGreaterThan(0);
    });
  });

  // ─── Voice Summary ──────────────────────────────────────────────

  describe('voice summary', () => {
    it('should generate a voice summary', () => {
      engine.registerUser('u1');
      engine.registerUser('u2');
      for (const stage of DEFAULT_ACTIVATION_CONFIG.activationStages) {
        engine.completeStage('u1', stage);
      }

      const summary = engine.generateVoiceSummary();
      expect(summary).toContain('2 total users');
      expect(summary).toContain('activation rate');
    });
  });

  // ─── Stats & Reset ──────────────────────────────────────────────

  describe('stats and reset', () => {
    it('should return comprehensive stats', () => {
      engine.registerUser('u1');
      engine.registerUser('u2');
      engine.recordNudgeSent('u1', 'nudge-1');
      engine.recordActivity('u1', { type: 'session' }); // Triggers milestone

      const stats = engine.getStats();
      expect(stats.totalUsers).toBe(2);
      expect(stats.trialUsers).toBe(2);
      expect(stats.totalNudgesSent).toBe(1);
      expect(stats.totalMilestonesAchieved).toBeGreaterThan(0);
    });

    it('should reset all state', () => {
      engine.registerUser('u1');
      engine.reset();

      const stats = engine.getStats();
      expect(stats.totalUsers).toBe(0);
      expect(stats.totalNudgesSent).toBe(0);
    });
  });
});
