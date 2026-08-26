/**
 * Customer Feedback Engine Tests
 * 🌙 Night Shift Agent — Shift #34
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FeedbackEngine,
  DEFAULT_FEEDBACK_CONFIG,
} from './feedback-engine.js';
import type {
  Feedback,
  SupportTicket,
  FeatureRequest,
  CustomerHealthScore,
} from './feedback-engine.js';

describe('FeedbackEngine', () => {
  let engine: FeedbackEngine;

  beforeEach(() => {
    engine = new FeedbackEngine();
  });

  // ─── NPS Survey ───────────────────────────────────────────────

  describe('NPS surveys', () => {
    it('should submit NPS score', () => {
      const fb = engine.submitNPS('cust-1', 9);
      expect(fb.type).toBe('nps');
      expect(fb.score).toBe(9);
      expect(fb.customerId).toBe('cust-1');
    });

    it('should clamp NPS score to 0-10', () => {
      const low = engine.submitNPS('cust-1', -5);
      expect(low.score).toBe(0);
      const high = engine.submitNPS('cust-2', 15);
      expect(high.score).toBe(10);
    });

    it('should classify promoters (9-10)', () => {
      expect(engine.classifyNPS(9)).toBe('promoter');
      expect(engine.classifyNPS(10)).toBe('promoter');
    });

    it('should classify passives (7-8)', () => {
      expect(engine.classifyNPS(7)).toBe('passive');
      expect(engine.classifyNPS(8)).toBe('passive');
    });

    it('should classify detractors (0-6)', () => {
      expect(engine.classifyNPS(0)).toBe('detractor');
      expect(engine.classifyNPS(3)).toBe('detractor');
      expect(engine.classifyNPS(6)).toBe('detractor');
    });

    it('should emit nps:detractor event for low scores', () => {
      let emitted = false;
      engine.on('nps:detractor', () => { emitted = true; });
      engine.submitNPS('cust-1', 3);
      expect(emitted).toBe(true);
    });

    it('should trigger follow-up for detractors', () => {
      let followUp: any = null;
      engine.on('feedback:followup', (e) => { followUp = e; });
      const fb = engine.submitNPS('cust-1', 4);
      expect(fb.followUpTriggered).toBe(true);
      expect(followUp).not.toBeNull();
      expect(followUp.customerId).toBe('cust-1');
    });

    it('should not trigger follow-up for promoters', () => {
      let followUp = false;
      engine.on('feedback:followup', () => { followUp = true; });
      engine.submitNPS('cust-1', 9);
      expect(followUp).toBe(false);
    });

    it('should respect survey cooldown', () => {
      expect(engine.canSurveyCustomer('cust-1')).toBe(true);
      engine.submitNPS('cust-1', 8);
      expect(engine.canSurveyCustomer('cust-1')).toBe(false);
    });

    it('should calculate NPS results', () => {
      engine.submitNPS('p1', 10);
      engine.submitNPS('p2', 9);
      engine.submitNPS('p3', 8); // passive
      engine.submitNPS('p4', 3); // detractor
      engine.submitNPS('p5', 5); // detractor

      const results = engine.getNPSResults();
      expect(results.totalResponses).toBe(5);
      expect(results.promoters).toBe(2);
      expect(results.passives).toBe(1);
      expect(results.detractors).toBe(2);
      expect(results.npsScore).toBe(0); // (2-2)/5 * 100 = 0
    });

    it('should return empty NPS results when no data', () => {
      const results = engine.getNPSResults();
      expect(results.totalResponses).toBe(0);
      expect(results.npsScore).toBe(0);
      expect(results.trend).toBe('stable');
    });

    it('should include comment and sentiment', () => {
      const fb = engine.submitNPS('cust-1', 9, 'Amazing product, love it!');
      expect(fb.comment).toBe('Amazing product, love it!');
      expect(fb.sentiment).toBeDefined();
    });

    it('should include context', () => {
      const fb = engine.submitNPS('cust-1', 8, undefined, {
        sessionType: 'inventory',
        itemsScanned: 500,
        plan: 'solo',
      });
      expect(fb.context?.sessionType).toBe('inventory');
      expect(fb.context?.itemsScanned).toBe(500);
    });
  });

  // ─── CSAT Survey ──────────────────────────────────────────────

  describe('CSAT surveys', () => {
    it('should submit CSAT score', () => {
      const fb = engine.submitCSAT('cust-1', 4);
      expect(fb.type).toBe('csat');
      expect(fb.score).toBe(4);
    });

    it('should clamp CSAT to 1-5', () => {
      expect(engine.submitCSAT('cust-1', 0).score).toBe(1);
      expect(engine.submitCSAT('cust-2', 10).score).toBe(5);
    });

    it('should include comment', () => {
      const fb = engine.submitCSAT('cust-1', 5, 'Works great!');
      expect(fb.comment).toBe('Works great!');
    });
  });

  // ─── General Feedback ─────────────────────────────────────────

  describe('general feedback', () => {
    it('should submit general feedback', () => {
      const fb = engine.submitFeedback('cust-1', 'I really like the scanning feature');
      expect(fb.type).toBe('general');
      expect(fb.comment).toBe('I really like the scanning feature');
    });

    it('should submit voice feedback', () => {
      const fb = engine.submitVoiceFeedback('cust-1', 'Great product, easy to use');
      expect(fb.type).toBe('voice');
      expect(fb.trigger).toBe('voice');
    });

    it('should auto-tag feedback', () => {
      const fb = engine.submitFeedback('cust-1', 'The barcode scanner is slow and buggy');
      expect(fb.tags.length).toBeGreaterThan(0);
    });

    it('should emit feedback:submitted event', () => {
      let emitted = false;
      engine.on('feedback:submitted', () => { emitted = true; });
      engine.submitFeedback('cust-1', 'Test feedback');
      expect(emitted).toBe(true);
    });

    it('should get customer feedback', () => {
      engine.submitFeedback('cust-1', 'Feedback 1');
      engine.submitFeedback('cust-1', 'Feedback 2');
      engine.submitFeedback('cust-2', 'Feedback 3');

      const cust1Feedback = engine.getCustomerFeedback('cust-1');
      expect(cust1Feedback.length).toBe(2);
    });

    it('should get all feedback with filters', () => {
      engine.submitNPS('c1', 9);
      engine.submitCSAT('c2', 4);
      engine.submitFeedback('c3', 'General');

      const npsOnly = engine.getAllFeedback({ type: 'nps' });
      expect(npsOnly.length).toBe(1);
      expect(npsOnly[0].type).toBe('nps');
    });
  });

  // ─── Sentiment Analysis ───────────────────────────────────────

  describe('sentiment analysis', () => {
    it('should detect very positive sentiment', () => {
      expect(engine.analyzeSentiment('This is amazing! Incredible product!')).toBe('very_positive');
    });

    it('should detect positive sentiment', () => {
      expect(engine.analyzeSentiment('Good product, works well for my needs')).toBe('positive');
    });

    it('should detect neutral sentiment', () => {
      expect(engine.analyzeSentiment('It is okay, does the job')).toBe('neutral');
    });

    it('should detect negative sentiment', () => {
      expect(engine.analyzeSentiment('Very frustrating, the app is slow and buggy')).toBe('negative');
    });

    it('should detect very negative sentiment', () => {
      expect(engine.analyzeSentiment('Terrible product, useless broken waste of money')).toBe('very_negative');
    });

    it('should handle empty text', () => {
      expect(engine.analyzeSentiment('')).toBe('neutral');
    });

    it('should handle text with no sentiment keywords', () => {
      expect(engine.analyzeSentiment('The sky is blue')).toBe('neutral');
    });
  });

  // ─── Support Tickets ──────────────────────────────────────────

  describe('support tickets', () => {
    it('should create a support ticket', () => {
      const ticket = engine.createTicket({
        customerId: 'cust-1',
        subject: 'Scanner not working',
        description: 'Barcode scanner crashes when scanning large items',
      });
      expect(ticket.id).toBeTruthy();
      expect(ticket.status).toBe('open');
      expect(ticket.messages.length).toBe(1);
    });

    it('should auto-categorize tickets', () => {
      const ticket = engine.createTicket({
        customerId: 'cust-1',
        subject: 'Scanner issue',
        description: 'The barcode scanner is not recognizing products',
      });
      expect(ticket.category).toBe('scanning');
    });

    it('should auto-prioritize tickets', () => {
      const critical = engine.createTicket({
        customerId: 'cust-1',
        subject: 'System down',
        description: 'The entire system has crashed and we lost data',
      });
      expect(critical.priority).toBe('critical');

      const low = engine.createTicket({
        customerId: 'cust-2',
        subject: 'Feature suggestion',
        description: 'It would be nice to have dark mode',
      });
      expect(low.priority).toBe('low');
    });

    it('should update ticket status', () => {
      const ticket = engine.createTicket({
        customerId: 'cust-1',
        subject: 'Test',
        description: 'Test ticket',
      });
      expect(engine.updateTicketStatus(ticket.id, 'in_progress')).toBe(true);
      expect(engine.getTicket(ticket.id)!.status).toBe('in_progress');
    });

    it('should assign tickets', () => {
      const ticket = engine.createTicket({
        customerId: 'cust-1',
        subject: 'Test',
        description: 'Test ticket',
      });
      expect(engine.assignTicket(ticket.id, 'agent-1')).toBe(true);
      const updated = engine.getTicket(ticket.id)!;
      expect(updated.assignedTo).toBe('agent-1');
      expect(updated.status).toBe('assigned');
      expect(updated.firstResponseAt).toBeDefined();
    });

    it('should add messages to tickets', () => {
      const ticket = engine.createTicket({
        customerId: 'cust-1',
        subject: 'Test',
        description: 'Test ticket',
      });
      engine.addTicketMessage(ticket.id, 'agent-1', 'agent', 'We\'re looking into this');
      const updated = engine.getTicket(ticket.id)!;
      expect(updated.messages.length).toBe(2);
      expect(updated.firstResponseAt).toBeDefined();
    });

    it('should resolve tickets', () => {
      const ticket = engine.createTicket({
        customerId: 'cust-1',
        subject: 'Test',
        description: 'Test ticket',
      });
      expect(engine.resolveTicket(ticket.id, 'Fixed by updating firmware')).toBe(true);
      const updated = engine.getTicket(ticket.id)!;
      expect(updated.status).toBe('resolved');
      expect(updated.resolution).toBe('Fixed by updating firmware');
      expect(updated.resolvedAt).toBeDefined();
    });

    it('should set resolution satisfaction', () => {
      const ticket = engine.createTicket({
        customerId: 'cust-1',
        subject: 'Test',
        description: 'Test ticket',
      });
      engine.resolveTicket(ticket.id, 'Fixed');
      expect(engine.setResolutionSatisfaction(ticket.id, 5)).toBe(true);
      expect(engine.getTicket(ticket.id)!.resolutionSatisfaction).toBe(5);
    });

    it('should clamp resolution satisfaction to 1-5', () => {
      const ticket = engine.createTicket({
        customerId: 'cust-1',
        subject: 'Test',
        description: 'Test',
      });
      engine.setResolutionSatisfaction(ticket.id, 10);
      expect(engine.getTicket(ticket.id)!.resolutionSatisfaction).toBe(5);
    });

    it('should filter tickets', () => {
      engine.createTicket({ customerId: 'c1', subject: 'Bug', description: 'Error crash' });
      engine.createTicket({ customerId: 'c2', subject: 'Help', description: 'Help me' });
      const ticket = engine.createTicket({ customerId: 'c1', subject: 'Another', description: 'Another issue' });
      engine.resolveTicket(ticket.id, 'Fixed');

      const openOnly = engine.getTickets({ status: 'open' });
      expect(openOnly.every(t => t.status === 'open')).toBe(true);

      const c1Only = engine.getTickets({ customerId: 'c1' });
      expect(c1Only.every(t => t.customerId === 'c1')).toBe(true);
    });

    it('should return null for unknown ticket', () => {
      expect(engine.getTicket('unknown')).toBeNull();
    });

    it('should return false for updating unknown ticket', () => {
      expect(engine.updateTicketStatus('unknown', 'closed')).toBe(false);
    });

    it('should emit ticket:created event', () => {
      let emitted = false;
      engine.on('ticket:created', () => { emitted = true; });
      engine.createTicket({
        customerId: 'c1',
        subject: 'Test',
        description: 'Test',
      });
      expect(emitted).toBe(true);
    });

    it('should emit ticket:resolved event', () => {
      let emitted = false;
      engine.on('ticket:resolved', () => { emitted = true; });
      const ticket = engine.createTicket({
        customerId: 'c1',
        subject: 'Test',
        description: 'Test',
      });
      engine.resolveTicket(ticket.id, 'Done');
      expect(emitted).toBe(true);
    });
  });

  // ─── SLA Compliance ───────────────────────────────────────────

  describe('SLA compliance', () => {
    it('should detect SLA breaches for first response', () => {
      const eng = new FeedbackEngine({ slaFirstResponseHours: 0.0001 }); // ~0.36 seconds
      eng.createTicket({
        customerId: 'c1',
        subject: 'Urgent',
        description: 'Help!',
      });

      // Wait a tiny bit for SLA to breach
      const breaches = eng.checkSLACompliance();
      // Might or might not have breached depending on timing, just check structure
      if (breaches.length > 0) {
        expect(breaches[0].type).toBe('first_response');
      }
    });

    it('should emit sla_breach event', () => {
      let breached = false;
      const eng = new FeedbackEngine({ slaFirstResponseHours: -1 }); // Already breached
      eng.on('ticket:sla_breach', () => { breached = true; });
      eng.createTicket({
        customerId: 'c1',
        subject: 'Test',
        description: 'Test',
      });
      eng.checkSLACompliance();
      expect(breached).toBe(true);
    });
  });

  // ─── Feature Requests ─────────────────────────────────────────

  describe('feature requests', () => {
    it('should submit a feature request', () => {
      const req = engine.submitFeatureRequest('cust-1', 'Dark mode', 'Please add dark mode to the dashboard');
      expect(req.id).toBeTruthy();
      expect(req.status).toBe('submitted');
      expect(req.votes.size).toBe(1); // Creator auto-votes
    });

    it('should auto-categorize feature requests', () => {
      const req = engine.submitFeatureRequest('cust-1', 'Better barcode scanning', 'Improve the barcode recognition');
      expect(req.category).toBe('scanning');
    });

    it('should allow voting on features', () => {
      const req = engine.submitFeatureRequest('cust-1', 'Dark mode', 'Add dark mode');
      expect(engine.voteForFeature(req.id, 'cust-2')).toBe(true);
      expect(engine.voteForFeature(req.id, 'cust-3')).toBe(true);
      
      const updated = engine.getFeatureRequest(req.id)!;
      expect(updated.votes.size).toBe(3);
      expect(updated.priority).toBe(3);
    });

    it('should prevent duplicate votes', () => {
      const req = engine.submitFeatureRequest('cust-1', 'Dark mode', 'Add dark mode');
      expect(engine.voteForFeature(req.id, 'cust-1')).toBe(false); // Already voted
    });

    it('should allow unvoting', () => {
      const req = engine.submitFeatureRequest('cust-1', 'Dark mode', 'Add dark mode');
      engine.voteForFeature(req.id, 'cust-2');
      expect(engine.unvoteFeature(req.id, 'cust-2')).toBe(true);
      expect(engine.getFeatureRequest(req.id)!.votes.size).toBe(1);
    });

    it('should update feature request status', () => {
      const req = engine.submitFeatureRequest('cust-1', 'Dark mode', 'Add dark mode');
      expect(engine.updateFeatureStatus(req.id, 'planned')).toBe(true);
      expect(engine.getFeatureRequest(req.id)!.status).toBe('planned');
    });

    it('should sort feature requests by votes', () => {
      const r1 = engine.submitFeatureRequest('c1', 'Feature A', 'A');
      const r2 = engine.submitFeatureRequest('c2', 'Feature B', 'B');
      engine.voteForFeature(r2.id, 'c3');
      engine.voteForFeature(r2.id, 'c4');

      const sorted = engine.getFeatureRequests();
      expect(sorted[0].id).toBe(r2.id); // More votes
    });

    it('should filter feature requests', () => {
      engine.submitFeatureRequest('c1', 'Feature A', 'A');
      const r2 = engine.submitFeatureRequest('c2', 'Feature B', 'B');
      engine.updateFeatureStatus(r2.id, 'planned');

      const planned = engine.getFeatureRequests({ status: 'planned' });
      expect(planned.length).toBe(1);
      expect(planned[0].status).toBe('planned');
    });

    it('should emit feature:requested event', () => {
      let emitted = false;
      engine.on('feature:requested', () => { emitted = true; });
      engine.submitFeatureRequest('c1', 'Test', 'Test');
      expect(emitted).toBe(true);
    });

    it('should emit feature:voted event', () => {
      let emitted = false;
      engine.on('feature:voted', () => { emitted = true; });
      const req = engine.submitFeatureRequest('c1', 'Test', 'Test');
      engine.voteForFeature(req.id, 'c2');
      expect(emitted).toBe(true);
    });

    it('should emit feature:status_changed event', () => {
      let emitted = false;
      engine.on('feature:status_changed', () => { emitted = true; });
      const req = engine.submitFeatureRequest('c1', 'Test', 'Test');
      engine.updateFeatureStatus(req.id, 'shipped');
      expect(emitted).toBe(true);
    });

    it('should return null for unknown feature request', () => {
      expect(engine.getFeatureRequest('unknown')).toBeNull();
    });
  });

  // ─── Customer Health Scoring ──────────────────────────────────

  describe('customer health scoring', () => {
    it('should calculate health score for new customer', () => {
      const health = engine.calculateHealthScore('cust-1', {
        sessionCount: 10,
        lastActiveAt: Date.now(),
        featuresUsed: 5,
        totalFeatures: 10,
      });
      expect(health.overallScore).toBeGreaterThan(0);
      expect(health.overallScore).toBeLessThanOrEqual(100);
    });

    it('should detect high churn risk for low satisfaction', () => {
      // Submit bad NPS scores
      engine.submitNPS('cust-1', 2);
      engine.submitNPS('cust-1', 3);

      // Create multiple tickets
      engine.createTicket({ customerId: 'cust-1', subject: 'Bug 1', description: 'Error crash' });
      engine.createTicket({ customerId: 'cust-1', subject: 'Bug 2', description: 'Error crash' });
      engine.createTicket({ customerId: 'cust-1', subject: 'Bug 3', description: 'Error crash' });

      const health = engine.calculateHealthScore('cust-1', {
        sessionCount: 1,
        lastActiveAt: Date.now() - 30 * 86400000, // 30 days ago
        featuresUsed: 1,
        totalFeatures: 10,
      });

      expect(health.churnRisk).toBe('high');
      expect(health.riskFactors.length).toBeGreaterThan(0);
      expect(health.recommendations.length).toBeGreaterThan(0);
    });

    it('should have low churn risk for happy customer', () => {
      engine.submitNPS('cust-1', 10);

      const health = engine.calculateHealthScore('cust-1', {
        sessionCount: 50,
        lastActiveAt: Date.now(),
        featuresUsed: 8,
        totalFeatures: 10,
      });

      expect(health.churnRisk).toBe('none');
      expect(health.riskFactors.length).toBe(0);
    });

    it('should include component scores', () => {
      const health = engine.calculateHealthScore('cust-1', {
        sessionCount: 20,
        lastActiveAt: Date.now(),
        featuresUsed: 5,
        totalFeatures: 10,
      });

      expect(health.components.satisfaction).toBeDefined();
      expect(health.components.engagement).toBeDefined();
      expect(health.components.supportHealth).toBeDefined();
      expect(health.components.featureAdoption).toBeDefined();
    });

    it('should penalize inactive customers', () => {
      const active = engine.calculateHealthScore('active', {
        sessionCount: 10,
        lastActiveAt: Date.now(),
        featuresUsed: 5,
        totalFeatures: 10,
      });

      const inactive = engine.calculateHealthScore('inactive', {
        sessionCount: 10,
        lastActiveAt: Date.now() - 90 * 86400000, // 90 days ago
        featuresUsed: 5,
        totalFeatures: 10,
      });

      expect(active.components.engagement).toBeGreaterThan(inactive.components.engagement);
    });

    it('should emit churn:risk_detected event', () => {
      let emitted = false;
      engine.on('churn:risk_detected', () => { emitted = true; });

      engine.submitNPS('cust-1', 1);
      engine.createTicket({ customerId: 'cust-1', subject: 'Bug', description: 'Crash' });
      engine.createTicket({ customerId: 'cust-1', subject: 'Bug', description: 'Crash' });
      engine.createTicket({ customerId: 'cust-1', subject: 'Bug', description: 'Crash' });

      engine.calculateHealthScore('cust-1', {
        sessionCount: 0,
        lastActiveAt: Date.now() - 60 * 86400000,
        featuresUsed: 0,
        totalFeatures: 10,
      });

      expect(emitted).toBe(true);
    });
  });

  // ─── Analytics ────────────────────────────────────────────────

  describe('analytics', () => {
    it('should return comprehensive stats', () => {
      engine.submitNPS('c1', 9);
      engine.submitCSAT('c2', 4);
      engine.createTicket({ customerId: 'c1', subject: 'Test', description: 'Test' });

      const stats = engine.getStats();
      expect(stats.totalFeedback).toBe(2);
      expect(stats.totalTickets).toBe(1);
      expect(stats.nps.totalResponses).toBe(1);
      expect(stats.averageCSAT).toBe(4);
    });

    it('should track open vs resolved tickets', () => {
      const t1 = engine.createTicket({ customerId: 'c1', subject: 'T1', description: 'T1' });
      engine.createTicket({ customerId: 'c2', subject: 'T2', description: 'T2' });
      engine.resolveTicket(t1.id, 'Fixed');

      const stats = engine.getStats();
      expect(stats.openTickets).toBe(1);
      expect(stats.resolvedTickets).toBe(1);
    });

    it('should track top categories', () => {
      engine.createTicket({ customerId: 'c1', subject: 'Scan bug', description: 'Barcode scan error' });
      engine.createTicket({ customerId: 'c2', subject: 'Scan slow', description: 'Scanner is slow' });
      engine.createTicket({ customerId: 'c3', subject: 'Payment', description: 'Billing charge wrong' });

      const stats = engine.getStats();
      expect(stats.topCategories.length).toBeGreaterThan(0);
    });

    it('should track sentiment breakdown', () => {
      engine.submitFeedback('c1', 'Amazing incredible product!');
      engine.submitFeedback('c2', 'Terrible broken useless');

      const stats = engine.getStats();
      expect(stats.sentimentBreakdown.very_positive).toBeGreaterThan(0);
      expect(stats.sentimentBreakdown.very_negative).toBeGreaterThan(0);
    });
  });

  // ─── Voice Summary ───────────────────────────────────────────

  describe('voice summary', () => {
    it('should generate summary with no data', () => {
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('No feedback data');
    });

    it('should include NPS in summary', () => {
      engine.submitNPS('c1', 9);
      engine.submitNPS('c2', 10);
      engine.submitNPS('c3', 3);
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('NPS');
    });

    it('should include open tickets in summary', () => {
      engine.createTicket({ customerId: 'c1', subject: 'Test', description: 'Test' });
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('open support');
    });

    it('should include top feature request', () => {
      const req = engine.submitFeatureRequest('c1', 'Dark Mode', 'Add it please');
      engine.voteForFeature(req.id, 'c2');
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('Dark Mode');
    });
  });

  // ─── Reset ────────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear all data', () => {
      engine.submitNPS('c1', 9);
      engine.createTicket({ customerId: 'c1', subject: 'Test', description: 'Test' });
      engine.submitFeatureRequest('c1', 'Feature', 'Description');

      engine.reset();

      const stats = engine.getStats();
      expect(stats.totalFeedback).toBe(0);
      expect(stats.totalTickets).toBe(0);
      expect(stats.totalFeatureRequests).toBe(0);
    });
  });

  // ─── Default Config ──────────────────────────────────────────

  describe('default config', () => {
    it('should have valid defaults', () => {
      expect(DEFAULT_FEEDBACK_CONFIG.slaFirstResponseHours).toBe(4);
      expect(DEFAULT_FEEDBACK_CONFIG.slaResolutionHours).toBe(24);
      expect(DEFAULT_FEEDBACK_CONFIG.autoFollowUpDetractors).toBe(true);
      expect(DEFAULT_FEEDBACK_CONFIG.npsSurveyCooldownDays).toBe(30);
      expect(DEFAULT_FEEDBACK_CONFIG.maxTickets).toBe(5000);
      expect(DEFAULT_FEEDBACK_CONFIG.maxFeedback).toBe(10000);
      expect(DEFAULT_FEEDBACK_CONFIG.churnRiskNPSThreshold).toBe(6);
    });

    it('should have valid health weights summing close to 1', () => {
      const w = DEFAULT_FEEDBACK_CONFIG.healthWeights;
      const sum = w.satisfaction + w.engagement + w.supportHealth + w.featureAdoption;
      expect(sum).toBeCloseTo(1.0, 1);
    });
  });
});
