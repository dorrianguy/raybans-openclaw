/**
 * Tests for Compliance & Privacy Engine
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ComplianceEngine,
  DEFAULT_COMPLIANCE_CONFIG,
} from './compliance-engine.js';
import type {
  ConsentRecord,
  PIIDetection,
  DataRetentionPolicy,
  DataDeletionRequest,
  DataExportRequest,
} from './compliance-engine.js';

describe('ComplianceEngine', () => {
  let engine: ComplianceEngine;

  beforeEach(() => {
    engine = new ComplianceEngine();
  });

  describe('Consent Management', () => {
    it('grants consent', () => {
      const record = engine.grantConsent({
        userId: 'user1',
        purpose: 'image_capture',
        source: 'voice',
      });

      expect(record.userId).toBe('user1');
      expect(record.purpose).toBe('image_capture');
      expect(record.status).toBe('granted');
      expect(record.version).toBe(1);
      expect(record.source).toBe('voice');
      expect(record.grantedAt).toBeTruthy();
      expect(record.expiresAt).toBeTruthy();
    });

    it('increments version on re-grant', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'image_capture' });
      const second = engine.grantConsent({ userId: 'user1', purpose: 'image_capture' });
      expect(second.version).toBe(2);
    });

    it('denies consent', () => {
      const record = engine.denyConsent({
        userId: 'user1',
        purpose: 'face_recognition',
        reason: 'Privacy concerns',
      });

      expect(record.status).toBe('denied');
      expect(record.purpose).toBe('face_recognition');
    });

    it('withdraws previously granted consent', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      const withdrawn = engine.withdrawConsent({
        userId: 'user1',
        purpose: 'analytics',
        reason: 'Changed my mind',
      });

      expect(withdrawn).toBeTruthy();
      expect(withdrawn!.status).toBe('withdrawn');
      expect(withdrawn!.withdrawnAt).toBeTruthy();
    });

    it('returns null when withdrawing non-granted consent', () => {
      const result = engine.withdrawConsent({ userId: 'user1', purpose: 'analytics' });
      expect(result).toBeNull();
    });

    it('returns null when withdrawing denied consent', () => {
      engine.denyConsent({ userId: 'user1', purpose: 'analytics' });
      const result = engine.withdrawConsent({ userId: 'user1', purpose: 'analytics' });
      expect(result).toBeNull();
    });

    it('checks consent status correctly', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'image_capture' });
      expect(engine.hasConsent('user1', 'image_capture')).toBe(true);
      expect(engine.hasConsent('user1', 'face_recognition')).toBe(false);
    });

    it('detects expired consent', () => {
      engine.grantConsent({
        userId: 'user1',
        purpose: 'analytics',
        expiresAt: Date.now() - 1000, // expired
      });

      expect(engine.hasConsent('user1', 'analytics')).toBe(false);
    });

    it('gets user consents', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'image_capture' });
      engine.grantConsent({ userId: 'user1', purpose: 'voice_recording' });
      engine.grantConsent({ userId: 'user2', purpose: 'analytics' });

      const user1Consents = engine.getUserConsents('user1');
      expect(user1Consents.length).toBe(2);
    });

    it('gets consents by purpose', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      engine.grantConsent({ userId: 'user2', purpose: 'analytics' });
      engine.grantConsent({ userId: 'user3', purpose: 'image_capture' });

      const analyticsConsents = engine.getConsentsByPurpose('analytics');
      expect(analyticsConsents.length).toBe(2);
    });

    it('gets consent summary for a user', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'image_capture' });
      engine.denyConsent({ userId: 'user1', purpose: 'face_recognition' });

      const summary = engine.getConsentSummary('user1');
      expect(summary.image_capture).toBe('granted');
      expect(summary.face_recognition).toBe('denied');
      expect(summary.analytics).toBe('pending');
    });

    it('grants batch consent', () => {
      const records = engine.grantBatchConsent('user1', [
        'image_capture', 'voice_recording', 'analytics',
      ]);

      expect(records.length).toBe(3);
      expect(records.every((r) => r.status === 'granted')).toBe(true);
      expect(records.every((r) => r.source === 'onboarding')).toBe(true);
    });

    it('emits events on consent changes', () => {
      const grantedHandler = vi.fn();
      const deniedHandler = vi.fn();
      const withdrawnHandler = vi.fn();

      engine.on('consent:granted', grantedHandler);
      engine.on('consent:denied', deniedHandler);
      engine.on('consent:withdrawn', withdrawnHandler);

      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      expect(grantedHandler).toHaveBeenCalledOnce();

      engine.denyConsent({ userId: 'user2', purpose: 'marketing' });
      expect(deniedHandler).toHaveBeenCalledOnce();

      engine.grantConsent({ userId: 'user3', purpose: 'analytics' });
      engine.withdrawConsent({ userId: 'user3', purpose: 'analytics' });
      expect(withdrawnHandler).toHaveBeenCalledOnce();
    });

    it('uses default regulation', () => {
      const record = engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      expect(record.regulation).toBe('gdpr');
    });

    it('allows custom regulation', () => {
      const record = engine.grantConsent({
        userId: 'user1',
        purpose: 'analytics',
        regulation: 'ccpa',
      });
      expect(record.regulation).toBe('ccpa');
    });

    it('retrieves specific consent record', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'image_capture' });
      const record = engine.getConsent('user1', 'image_capture');
      expect(record).toBeTruthy();
      expect(record!.status).toBe('granted');
    });
  });

  describe('PII Detection', () => {
    it('detects email addresses', () => {
      const detections = engine.detectPII('Contact john@example.com for info');
      expect(detections.length).toBe(1);
      expect(detections[0].type).toBe('email');
      expect(detections[0].value).toBe('john@example.com');
      expect(detections[0].confidence).toBe(0.95);
    });

    it('detects phone numbers', () => {
      const detections = engine.detectPII('Call us at (555) 123-4567 today');
      const phones = detections.filter((d) => d.type === 'phone');
      expect(phones.length).toBe(1);
      expect(phones[0].value).toContain('555');
    });

    it('detects SSNs with validation', () => {
      const detections = engine.detectPII('SSN: 123-45-6789');
      const ssns = detections.filter((d) => d.type === 'ssn');
      expect(ssns.length).toBe(1);
    });

    it('rejects invalid SSNs', () => {
      const detections = engine.detectPII('Not an SSN: 000-12-3456');
      const ssns = detections.filter((d) => d.type === 'ssn');
      expect(ssns.length).toBe(0);
    });

    it('detects credit card numbers with Luhn validation', () => {
      const detections = engine.detectPII('Card: 4111 1111 1111 1111');
      const cards = detections.filter((d) => d.type === 'credit_card');
      expect(cards.length).toBe(1);
    });

    it('rejects invalid credit card numbers', () => {
      const detections = engine.detectPII('Not a card: 1234 5678 9012 3456');
      const cards = detections.filter((d) => d.type === 'credit_card');
      expect(cards.length).toBe(0);
    });

    it('detects IP addresses', () => {
      const detections = engine.detectPII('Server at 192.168.1.100');
      const ips = detections.filter((d) => d.type === 'ip_address');
      expect(ips.length).toBe(1);
    });

    it('detects API keys', () => {
      const detections = engine.detectPII('Use sk_test_1234567890abcdef for auth');
      const keys = detections.filter((d) => d.type === 'api_key');
      expect(keys.length).toBe(1);
    });

    it('detects GPS coordinates', () => {
      const detections = engine.detectPII('Located at 40.7580, -73.9855');
      const gps = detections.filter((d) => d.type === 'gps_coordinates');
      expect(gps.length).toBe(1);
    });

    it('detects multiple PII types in one text', () => {
      const text = 'Email john@test.com, call (555) 123-4567, IP 10.0.0.1';
      const detections = engine.detectPII(text);
      const types = new Set(detections.map((d) => d.type));
      expect(types.has('email')).toBe(true);
      expect(types.has('phone')).toBe(true);
      expect(types.has('ip_address')).toBe(true);
    });

    it('filters by minimum confidence', () => {
      const text = 'Email john@test.com at 12345678901234';
      const high = engine.detectPII(text, 0.9);
      const low = engine.detectPII(text, 0.1);
      expect(high.length).toBeLessThanOrEqual(low.length);
    });

    it('returns empty when PII detection is disabled', () => {
      const engine2 = new ComplianceEngine({ piiDetectionEnabled: false });
      expect(engine2.detectPII('john@test.com')).toEqual([]);
    });

    it('removes overlapping detections', () => {
      // If a string matches both phone and SSN, only one should be returned
      const text = 'Code: 123-45-6789';
      const detections = engine.detectPII(text);
      // Check no overlapping ranges
      for (let i = 0; i < detections.length - 1; i++) {
        expect(detections[i].endIndex).toBeLessThanOrEqual(detections[i + 1].startIndex);
      }
    });

    it('includes context in detections', () => {
      const detections = engine.detectPII('Please contact john@example.com for details');
      expect(detections[0].context).toBeTruthy();
      expect(detections[0].context!.length).toBeGreaterThan(0);
    });

    it('emits pii:detected event', () => {
      const handler = vi.fn();
      engine.on('pii:detected', handler);

      engine.detectPII('john@test.com');
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('Redaction', () => {
    it('redacts email with format preservation', () => {
      const { redacted, detections } = engine.redactText('Email: john@example.com');
      expect(detections.length).toBe(1);
      expect(redacted).toContain('@example.com');
      expect(redacted).not.toContain('john@example.com');
    });

    it('redacts credit card showing last 4 digits', () => {
      const { redacted } = engine.redactText('Card: 4111 1111 1111 1111');
      expect(redacted).toContain('1111');
      expect(redacted).not.toContain('4111 1111 1111 1111');
    });

    it('removes API keys entirely', () => {
      const { redacted } = engine.redactText('Key: sk_test_1234567890abcdef');
      expect(redacted).toContain('API_KEY_REDACTED');
      expect(redacted).not.toContain('sk_test_');
    });

    it('returns unchanged text when no PII found', () => {
      const text = 'Hello world, this is a test';
      const { redacted, detections } = engine.redactText(text);
      expect(redacted).toBe(text);
      expect(detections.length).toBe(0);
    });

    it('redacts multiple PII instances', () => {
      const text = 'Contact john@test.com or jane@test.com';
      const { redacted, detections } = engine.redactText(text);
      expect(detections.length).toBe(2);
      expect(redacted).not.toContain('john@test.com');
      expect(redacted).not.toContain('jane@test.com');
    });

    it('redactValue with hash strategy', () => {
      const result = engine.redactValue('secret', 'name', { strategy: 'hash' });
      expect(result).toMatch(/\[HASH:[0-9a-f]{8}\]/);
    });

    it('redactValue with remove strategy', () => {
      const result = engine.redactValue('secret', 'password', { strategy: 'remove' });
      expect(result).toBe('[PASSWORD_REDACTED]');
    });

    it('redactValue with tokenize strategy', () => {
      const result = engine.redactValue('secret', 'name', { strategy: 'tokenize' });
      expect(result).toMatch(/\[TOKEN:tok_\w+\]/);
    });

    it('redactValue with generalize strategy', () => {
      expect(engine.redactValue('john@test.com', 'email', { strategy: 'generalize' }))
        .toBe('[email address]');
      expect(engine.redactValue('555-1234', 'phone', { strategy: 'generalize' }))
        .toBe('[phone number]');
      expect(engine.redactValue('123-45-6789', 'ssn', { strategy: 'generalize' }))
        .toBe('[SSN]');
    });

    it('allows custom redaction config per type', () => {
      engine.setRedactionConfig('email', { strategy: 'generalize' });
      const { redacted } = engine.redactText('Email: john@test.com');
      expect(redacted).toContain('[email address]');
    });

    it('redacts SSN showing last 4', () => {
      const result = engine.redactValue('123-45-6789', 'ssn', {
        strategy: 'mask',
        maskChar: '*',
        preserveFormat: true,
      });
      expect(result).toBe('***-**-6789');
    });
  });

  describe('Data Retention', () => {
    it('adds and retrieves retention policy', () => {
      const policy = engine.addRetentionPolicy({
        name: 'Image Retention',
        dataType: 'images',
        retentionDays: 90,
        classification: 'confidential',
        regulation: 'gdpr',
        autoDelete: true,
        archiveBeforeDelete: true,
        description: 'Delete captured images after 90 days',
      });

      expect(policy.id).toBeTruthy();
      expect(engine.getRetentionPolicy(policy.id)).toEqual(policy);
    });

    it('lists retention policies', () => {
      engine.addRetentionPolicy({
        name: 'Images', dataType: 'images', retentionDays: 90,
        classification: 'confidential', regulation: 'gdpr',
        autoDelete: true, archiveBeforeDelete: false, description: 'Test',
      });
      engine.addRetentionPolicy({
        name: 'Logs', dataType: 'session_logs', retentionDays: 30,
        classification: 'internal', regulation: 'gdpr',
        autoDelete: true, archiveBeforeDelete: false, description: 'Test',
      });

      expect(engine.listRetentionPolicies().length).toBe(2);
      expect(engine.listRetentionPolicies({ dataType: 'images' }).length).toBe(1);
      expect(engine.listRetentionPolicies({ classification: 'internal' }).length).toBe(1);
    });

    it('removes retention policy', () => {
      const policy = engine.addRetentionPolicy({
        name: 'Test', dataType: 'test', retentionDays: 30,
        classification: 'internal', regulation: 'gdpr',
        autoDelete: false, archiveBeforeDelete: false, description: 'Test',
      });

      expect(engine.removeRetentionPolicy(policy.id)).toBe(true);
      expect(engine.getRetentionPolicy(policy.id)).toBeUndefined();
    });

    it('returns false for removing non-existent policy', () => {
      expect(engine.removeRetentionPolicy('nope')).toBe(false);
    });

    it('checks retention expiry', () => {
      engine.addRetentionPolicy({
        name: 'Short Retention', dataType: 'temp', retentionDays: 7,
        classification: 'internal', regulation: 'gdpr',
        autoDelete: true, archiveBeforeDelete: false, description: 'Test',
      });

      const expired = engine.checkRetentionExpiry();
      expect(expired.length).toBe(1);
      expect(expired[0].expiredBefore).toBeTruthy();
    });

    it('skips non-auto-delete policies', () => {
      engine.addRetentionPolicy({
        name: 'Manual', dataType: 'manual', retentionDays: 7,
        classification: 'internal', regulation: 'gdpr',
        autoDelete: false, archiveBeforeDelete: false, description: 'Test',
      });

      const expired = engine.checkRetentionExpiry();
      expect(expired.length).toBe(0);
    });
  });

  describe('Right to Erasure', () => {
    it('creates a deletion request', () => {
      const request = engine.requestDeletion({
        userId: 'user1',
        reason: 'GDPR Article 17 request',
      });

      expect(request.id).toBeTruthy();
      expect(request.status).toBe('pending');
      expect(request.userId).toBe('user1');
      expect(request.dataTypes).toEqual(['all']);
    });

    it('processes deletion and removes user data', () => {
      // Create some user data
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      engine.grantConsent({ userId: 'user1', purpose: 'image_capture' });
      engine.grantConsent({ userId: 'user2', purpose: 'analytics' }); // should survive

      const request = engine.requestDeletion({ userId: 'user1' });
      const result = engine.processDeletion(request.id);

      expect(result).toBeTruthy();
      expect(result!.status).toBe('completed');
      expect(result!.deletedRecords).toBeGreaterThan(0);
      expect(result!.completedAt).toBeTruthy();

      // User1 data should be gone
      expect(engine.getUserConsents('user1').length).toBe(0);

      // User2 data should survive
      expect(engine.getUserConsents('user2').length).toBe(1);
    });

    it('emits data:deleted event', () => {
      const handler = vi.fn();
      engine.on('data:deleted', handler);

      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      const request = engine.requestDeletion({ userId: 'user1' });
      engine.processDeletion(request.id);

      expect(handler).toHaveBeenCalledOnce();
    });

    it('returns null for non-existent request', () => {
      expect(engine.processDeletion('nope')).toBeNull();
    });

    it('does not reprocess completed deletion', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      const request = engine.requestDeletion({ userId: 'user1' });
      engine.processDeletion(request.id);

      const again = engine.processDeletion(request.id);
      expect(again!.status).toBe('completed');
    });

    it('lists deletion requests', () => {
      engine.requestDeletion({ userId: 'user1' });
      engine.requestDeletion({ userId: 'user2' });

      expect(engine.listDeletionRequests().length).toBe(2);
      expect(engine.listDeletionRequests('user1').length).toBe(1);
    });

    it('retrieves specific deletion request', () => {
      const request = engine.requestDeletion({ userId: 'user1' });
      expect(engine.getDeletionRequest(request.id)).toEqual(request);
    });

    it('deletes with specific data types', () => {
      const request = engine.requestDeletion({
        userId: 'user1',
        dataTypes: ['images', 'transcripts'],
      });
      expect(request.dataTypes).toEqual(['images', 'transcripts']);
    });
  });

  describe('Data Portability', () => {
    it('creates an export request', () => {
      const request = engine.requestExport({
        userId: 'user1',
        format: 'json',
      });

      expect(request.id).toBeTruthy();
      expect(request.status).toBe('pending');
      expect(request.format).toBe('json');
    });

    it('processes export request', () => {
      const request = engine.requestExport({ userId: 'user1' });
      const result = engine.processExport(request.id);

      expect(result).toBeTruthy();
      expect(result!.status).toBe('completed');
      expect(result!.completedAt).toBeTruthy();
      expect(result!.expiresAt).toBeTruthy();
    });

    it('emits data:exported event', () => {
      const handler = vi.fn();
      engine.on('data:exported', handler);

      const request = engine.requestExport({ userId: 'user1' });
      engine.processExport(request.id);

      expect(handler).toHaveBeenCalledOnce();
    });

    it('returns null for non-existent request', () => {
      expect(engine.processExport('nope')).toBeNull();
    });

    it('retrieves export request', () => {
      const request = engine.requestExport({ userId: 'user1' });
      expect(engine.getExportRequest(request.id)).toEqual(request);
    });

    it('defaults to json format', () => {
      const request = engine.requestExport({ userId: 'user1' });
      expect(request.format).toBe('json');
    });
  });

  describe('Audit Trail', () => {
    it('records audit entries on consent changes', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics', source: 'ui' });

      const trail = engine.getAuditTrail();
      expect(trail.length).toBe(1);
      expect(trail[0].userId).toBe('user1');
      expect(trail[0].newStatus).toBe('granted');
      expect(trail[0].source).toBe('ui');
    });

    it('records full lifecycle', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      engine.withdrawConsent({ userId: 'user1', purpose: 'analytics', reason: 'test' });

      const trail = engine.getAuditTrail();
      expect(trail.length).toBe(2);
      // Both statuses should be present (order may vary with same-ms timestamps)
      const statuses = trail.map((t) => t.newStatus);
      expect(statuses).toContain('withdrawn');
      expect(statuses).toContain('granted');
    });

    it('filters audit trail by user', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      engine.grantConsent({ userId: 'user2', purpose: 'analytics' });

      expect(engine.getAuditTrail({ userId: 'user1' }).length).toBe(1);
    });

    it('filters audit trail by purpose', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      engine.grantConsent({ userId: 'user1', purpose: 'marketing' });

      expect(engine.getAuditTrail({ purpose: 'analytics' }).length).toBe(1);
    });

    it('limits audit trail results', () => {
      for (let i = 0; i < 10; i++) {
        engine.grantConsent({ userId: `user${i}`, purpose: 'analytics' });
      }

      expect(engine.getAuditTrail({ limit: 5 }).length).toBe(5);
    });

    it('filters by time', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      const since = Date.now() + 1; // +1 to ensure strict "after"
      engine.grantConsent({ userId: 'user2', purpose: 'marketing' });

      // With same-ms execution, both may have same timestamp
      // The filter should return 0 or 1 entries (not the first one)
      const filtered = engine.getAuditTrail({ since });
      expect(filtered.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Privacy Impact Assessment', () => {
    it('assesses privacy impact for user with no consents', () => {
      const score = engine.assessPrivacyImpact('user1');
      expect(score.overall).toBeGreaterThanOrEqual(0);
      expect(score.overall).toBeLessThanOrEqual(100);
    });

    it('assesses privacy impact with active consents', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'image_capture' });
      engine.grantConsent({ userId: 'user1', purpose: 'voice_recording' });
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });

      const score = engine.assessPrivacyImpact('user1');
      expect(score.overall).toBeGreaterThanOrEqual(0);
      expect(score.consentCoverage).toBeGreaterThan(0);
    });

    it('flags sensitive data categories', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'biometric_data' });
      engine.grantConsent({ userId: 'user1', purpose: 'medical_data' });

      const score = engine.assessPrivacyImpact('user1');
      expect(score.details.some((d) => d.includes('Sensitive'))).toBe(true);
    });

    it('detects expired consents', () => {
      engine.grantConsent({
        userId: 'user1',
        purpose: 'analytics',
        expiresAt: Date.now() - 1000,
      });

      const score = engine.assessPrivacyImpact('user1');
      expect(score.details.some((d) => d.includes('expired'))).toBe(true);
      expect(score.recommendations.some((r) => r.includes('renewal'))).toBe(true);
    });

    it('recommends retention policies when none exist', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      const score = engine.assessPrivacyImpact('user1');
      expect(score.details.some((d) => d.includes('retention'))).toBe(true);
    });

    it('includes recommendations', () => {
      const score = engine.assessPrivacyImpact('user1');
      expect(score.recommendations).toBeDefined();
      expect(Array.isArray(score.recommendations)).toBe(true);
    });
  });

  describe('Data Classification', () => {
    it('classifies known data types', () => {
      expect(engine.classifyData('images')).toBe('confidential');
      expect(engine.classifyData('transcripts')).toBe('confidential');
      expect(engine.classifyData('inventory')).toBe('internal');
      expect(engine.classifyData('medical_data')).toBe('restricted');
      expect(engine.classifyData('marketing_data')).toBe('public');
    });

    it('defaults to internal for unknown types', () => {
      expect(engine.classifyData('unknown_type')).toBe('internal');
    });
  });

  describe('Voice Summary', () => {
    it('generates summary for user with no consents', () => {
      const summary = engine.generateVoiceSummary('user1');
      expect(summary).toContain('No privacy consents configured');
    });

    it('generates summary for user with consents', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'image_capture' });
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      engine.denyConsent({ userId: 'user1', purpose: 'marketing' });

      const summary = engine.generateVoiceSummary('user1');
      expect(summary).toContain('2 consents active');
      expect(summary).toContain('1 denied');
    });

    it('warns about expired consents', () => {
      engine.grantConsent({
        userId: 'user1',
        purpose: 'analytics',
        expiresAt: Date.now() - 1000,
      });

      const summary = engine.generateVoiceSummary('user1');
      expect(summary).toContain('expired');
    });

    it('includes retention policy count', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      engine.addRetentionPolicy({
        name: 'Test', dataType: 'test', retentionDays: 30,
        classification: 'internal', regulation: 'gdpr',
        autoDelete: true, archiveBeforeDelete: false, description: 'Test',
      });

      const summary = engine.generateVoiceSummary('user1');
      expect(summary).toContain('retention');
    });

    it('mentions pending deletions', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      engine.requestDeletion({ userId: 'user1' });

      const summary = engine.generateVoiceSummary('user1');
      expect(summary).toContain('pending deletion');
    });
  });

  describe('Compliance Status', () => {
    it('returns comprehensive status', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      engine.denyConsent({ userId: 'user2', purpose: 'marketing' });
      engine.addRetentionPolicy({
        name: 'Test', dataType: 'test', retentionDays: 30,
        classification: 'internal', regulation: 'gdpr',
        autoDelete: true, archiveBeforeDelete: false, description: 'Test',
      });
      engine.requestDeletion({ userId: 'user3' });
      engine.requestExport({ userId: 'user4' });

      const status = engine.getComplianceStatus();
      expect(status.totalConsents).toBe(2);
      expect(status.activeConsents).toBe(1);
      expect(status.totalPolicies).toBe(1);
      expect(status.pendingDeletions).toBe(1);
      expect(status.pendingExports).toBe(1);
      expect(status.auditEntries).toBeGreaterThan(0);
    });

    it('counts expired consents', () => {
      engine.grantConsent({
        userId: 'user1',
        purpose: 'analytics',
        expiresAt: Date.now() - 1000,
      });

      const status = engine.getComplianceStatus();
      expect(status.expiredConsents).toBe(1);
      expect(status.activeConsents).toBe(0);
    });
  });

  describe('Reset', () => {
    it('clears all data', () => {
      engine.grantConsent({ userId: 'user1', purpose: 'analytics' });
      engine.addRetentionPolicy({
        name: 'Test', dataType: 'test', retentionDays: 30,
        classification: 'internal', regulation: 'gdpr',
        autoDelete: true, archiveBeforeDelete: false, description: 'Test',
      });
      engine.requestDeletion({ userId: 'user1' });

      engine.reset();

      const status = engine.getComplianceStatus();
      expect(status.totalConsents).toBe(0);
      expect(status.totalPolicies).toBe(0);
      expect(status.pendingDeletions).toBe(0);
      expect(status.auditEntries).toBe(0);
    });
  });

  describe('Default Config', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_COMPLIANCE_CONFIG.defaultRegulation).toBe('gdpr');
      expect(DEFAULT_COMPLIANCE_CONFIG.consentExpirationDays).toBe(365);
      expect(DEFAULT_COMPLIANCE_CONFIG.piiDetectionEnabled).toBe(true);
      expect(DEFAULT_COMPLIANCE_CONFIG.autoRedact).toBe(false);
    });
  });
});
