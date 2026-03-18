/**
 * Tests for Privacy Engine
 * Covers: consent management, PII detection, data retention, privacy zones,
 * data subject requests, anonymization, audit logging, compliance reports
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PrivacyEngine,
  DEFAULT_PRIVACY_CONFIG,
  type ConsentCategory,
  type DataCategory,
  type PIIType,
  type PrivacyRestriction,
  type AnonymizationTechnique,
} from './privacy-engine.js';

describe('PrivacyEngine', () => {
  let engine: PrivacyEngine;

  beforeEach(() => {
    engine = new PrivacyEngine();
  });

  // ─── Constructor & Config ────────────────────────────────────────

  describe('constructor', () => {
    it('should create with default config', () => {
      const stats = engine.getStats();
      expect(stats.retentionPolicies).toBeGreaterThan(0);
      expect(stats.totalConsents).toBe(0);
    });

    it('should accept partial config overrides', () => {
      const custom = new PrivacyEngine({
        defaultRegulation: 'ccpa',
        defaultRetentionDays: 30,
        consentRequired: false,
      });
      // Consent not required means hasConsent always returns true
      expect(custom.hasConsent('user1', 'image_capture')).toBe(true);
    });

    it('should load default retention policies', () => {
      const policies = engine.getAllRetentionPolicies();
      expect(policies.length).toBeGreaterThanOrEqual(8);
      expect(policies.find(p => p.dataCategory === 'captured_images')).toBeDefined();
      expect(policies.find(p => p.dataCategory === 'voice_recordings')).toBeDefined();
      expect(policies.find(p => p.dataCategory === 'audit_logs')).toBeDefined();
    });
  });

  // ─── Consent Management ──────────────────────────────────────────

  describe('consent management', () => {
    it('should grant consent for a category', () => {
      const record = engine.grantConsent('user1', 'image_capture');
      expect(record.status).toBe('granted');
      expect(record.userId).toBe('user1');
      expect(record.category).toBe('image_capture');
      expect(record.grantedAt).toBeDefined();
    });

    it('should check consent status', () => {
      expect(engine.hasConsent('user1', 'image_capture')).toBe(false);
      engine.grantConsent('user1', 'image_capture');
      expect(engine.hasConsent('user1', 'image_capture')).toBe(true);
    });

    it('should withdraw consent', () => {
      engine.grantConsent('user1', 'voice_recording');
      expect(engine.hasConsent('user1', 'voice_recording')).toBe(true);

      const withdrawn = engine.withdrawConsent('user1', 'voice_recording');
      expect(withdrawn).not.toBeNull();
      expect(withdrawn!.status).toBe('withdrawn');
      expect(withdrawn!.withdrawnAt).toBeDefined();
      expect(engine.hasConsent('user1', 'voice_recording')).toBe(false);
    });

    it('should return null when withdrawing non-existent consent', () => {
      expect(engine.withdrawConsent('nobody', 'analytics')).toBeNull();
    });

    it('should handle consent expiry', () => {
      const pastExpiry = Date.now() - 1000;
      engine.grantConsent('user1', 'location_tracking', { expiresAt: pastExpiry });
      expect(engine.hasConsent('user1', 'location_tracking')).toBe(false);
    });

    it('should get all consents for a user', () => {
      engine.grantConsent('user1', 'image_capture');
      engine.grantConsent('user1', 'voice_recording');
      engine.grantConsent('user2', 'analytics');

      const user1Consents = engine.getUserConsents('user1');
      expect(user1Consents).toHaveLength(2);
      expect(user1Consents.every(c => c.userId === 'user1')).toBe(true);
    });

    it('should grant bulk consent', () => {
      const categories: ConsentCategory[] = ['image_capture', 'voice_recording', 'analytics'];
      const records = engine.grantBulkConsent('user1', categories, { version: '2.0' });

      expect(records).toHaveLength(3);
      for (const cat of categories) {
        expect(engine.hasConsent('user1', cat)).toBe(true);
      }
      expect(records[0].version).toBe('2.0');
    });

    it('should emit events on consent changes', () => {
      const grantFn = vi.fn();
      const withdrawFn = vi.fn();
      engine.on('consent:granted', grantFn);
      engine.on('consent:withdrawn', withdrawFn);

      engine.grantConsent('user1', 'analytics');
      expect(grantFn).toHaveBeenCalledWith({ userId: 'user1', category: 'analytics' });

      engine.withdrawConsent('user1', 'analytics');
      expect(withdrawFn).toHaveBeenCalledWith({ userId: 'user1', category: 'analytics' });
    });

    it('should track consent source and metadata', () => {
      const record = engine.grantConsent('user1', 'marketing', {
        source: 'explicit',
        version: '3.1',
        ipAddress: '192.168.1.1',
        metadata: { campaign: 'spring2026' },
      });

      expect(record.source).toBe('explicit');
      expect(record.version).toBe('3.1');
      expect(record.ipAddress).toBe('192.168.1.1');
      expect(record.metadata?.campaign).toBe('spring2026');
    });

    it('should get consent summary across all users', () => {
      engine.grantConsent('user1', 'image_capture');
      engine.grantConsent('user2', 'image_capture');
      engine.grantConsent('user1', 'voice_recording');
      engine.withdrawConsent('user1', 'voice_recording');

      const summary = engine.getConsentSummary();
      expect(summary.image_capture.granted).toBe(2);
      expect(summary.voice_recording.denied).toBe(1);
    });

    it('should not require consent when consentRequired is false', () => {
      const noConsent = new PrivacyEngine({ consentRequired: false });
      expect(noConsent.hasConsent('anyone', 'biometric')).toBe(true);
    });
  });

  // ─── PII Detection ──────────────────────────────────────────────

  describe('PII detection', () => {
    it('should detect email addresses', () => {
      const detections = engine.detectPII('Contact me at john@example.com for details');
      expect(detections.length).toBeGreaterThanOrEqual(1);
      expect(detections.find(d => d.type === 'email')).toBeDefined();
      expect(detections.find(d => d.type === 'email')!.value).toBe('john@example.com');
    });

    it('should detect phone numbers', () => {
      const detections = engine.detectPII('Call 555-123-4567 or (800) 555-0199');
      const phones = detections.filter(d => d.type === 'phone');
      expect(phones.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect SSNs with validation', () => {
      const detections = engine.detectPII('SSN: 123-45-6789');
      const ssns = detections.filter(d => d.type === 'ssn');
      expect(ssns.length).toBe(1);
      expect(ssns[0].value).toContain('123');
    });

    it('should reject invalid SSNs', () => {
      // SSN starting with 000 is invalid
      const detections = engine.detectPII('Number: 000-12-3456');
      const ssns = detections.filter(d => d.type === 'ssn');
      expect(ssns.length).toBe(0);
    });

    it('should detect credit card numbers with Luhn validation', () => {
      // 4111-1111-1111-1111 passes Luhn
      const detections = engine.detectPII('Card: 4111 1111 1111 1111');
      const cards = detections.filter(d => d.type === 'credit_card');
      expect(cards.length).toBe(1);
    });

    it('should reject invalid credit card numbers', () => {
      // 1234-5678-9012-3456 fails Luhn
      const detections = engine.detectPII('Card: 1234 5678 9012 3456');
      const cards = detections.filter(d => d.type === 'credit_card');
      expect(cards.length).toBe(0);
    });

    it('should detect IP addresses with validation', () => {
      const detections = engine.detectPII('Server: 192.168.1.100');
      const ips = detections.filter(d => d.type === 'ip_address');
      expect(ips.length).toBe(1);
    });

    it('should reject invalid IP addresses', () => {
      const detections = engine.detectPII('Version: 999.999.999.999');
      const ips = detections.filter(d => d.type === 'ip_address');
      expect(ips.length).toBe(0);
    });

    it('should detect medical IDs', () => {
      const detections = engine.detectPII('Patient MRN:12345678 on file');
      const meds = detections.filter(d => d.type === 'medical_id');
      expect(meds.length).toBe(1);
    });

    it('should detect multiple PII types in one text', () => {
      const text = 'Name: John Smith, Email: john@test.com, SSN: 123-45-6789, Phone: 555-123-4567';
      const detections = engine.detectPII(text, { includeNames: true });
      const types = new Set(detections.map(d => d.type));
      expect(types.size).toBeGreaterThanOrEqual(3);
    });

    it('should return empty when PII detection is disabled', () => {
      const noPii = new PrivacyEngine({ piiDetectionEnabled: false });
      const detections = noPii.detectPII('john@example.com 123-45-6789');
      expect(detections).toHaveLength(0);
    });

    it('should emit pii:detected event', () => {
      const fn = vi.fn();
      engine.on('pii:detected', fn);
      engine.detectPII('john@example.com');
      expect(fn).toHaveBeenCalled();
    });

    it('should assign confidence scores by type', () => {
      const detections = engine.detectPII('john@example.com');
      const email = detections.find(d => d.type === 'email');
      expect(email!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should assign default actions by severity', () => {
      const detections = engine.detectPII('SSN: 123-45-6789, email: a@b.com');
      const ssn = detections.find(d => d.type === 'ssn');
      const email = detections.find(d => d.type === 'email');
      expect(ssn!.action).toBe('redact');
      expect(email!.action).toBe('hash');
    });
  });

  // ─── PII Redaction ──────────────────────────────────────────────

  describe('PII redaction', () => {
    it('should redact PII from text', () => {
      const { redacted, detections } = engine.redactPII('Contact: john@example.com');
      expect(redacted).toContain('[EMAIL_REDACTED]');
      expect(redacted).not.toContain('john@example.com');
      expect(detections.length).toBeGreaterThan(0);
    });

    it('should redact multiple PII types', () => {
      const { redacted } = engine.redactPII('Email: test@test.com, SSN: 123-45-6789');
      expect(redacted).toContain('[EMAIL_REDACTED]');
      expect(redacted).toContain('[SSN_REDACTED]');
    });

    it('should use custom placeholder', () => {
      const { redacted } = engine.redactPII('Email: test@test.com', { placeholder: '***' });
      expect(redacted).toContain('***');
      expect(redacted).not.toContain('test@test.com');
    });

    it('should handle text with no PII', () => {
      const { redacted, detections } = engine.redactPII('Hello world, nice day');
      expect(redacted).toBe('Hello world, nice day');
      expect(detections).toHaveLength(0);
    });

    it('should support custom PII patterns', () => {
      engine.addCustomPIIPattern('employee_id', /EMP-\d{5}/g);
      const detections = engine.detectPII('Employee EMP-12345 reported');
      expect(detections.find(d => d.type === 'custom')).toBeDefined();
    });
  });

  // ─── Data Retention ─────────────────────────────────────────────

  describe('data retention', () => {
    it('should have default retention policies', () => {
      const policies = engine.getAllRetentionPolicies();
      expect(policies.length).toBeGreaterThan(0);

      const images = policies.find(p => p.dataCategory === 'captured_images');
      expect(images).toBeDefined();
      expect(images!.retentionDays).toBe(30);
      expect(images!.autoDelete).toBe(true);
    });

    it('should set custom retention policy', () => {
      engine.setRetentionPolicy({
        id: 'custom-1',
        name: 'Custom Policy',
        description: 'Test',
        dataCategory: 'session_data',
        retentionDays: 7,
        regulation: 'ccpa',
        autoDelete: true,
        enabled: true,
      });

      const policy = engine.getRetentionPolicy('custom-1');
      expect(policy).toBeDefined();
      expect(policy!.retentionDays).toBe(7);
    });

    it('should get retention for a specific category', () => {
      const policy = engine.getRetentionForCategory('voice_recordings');
      expect(policy).toBeDefined();
      expect(policy!.retentionDays).toBe(7);
    });

    it('should identify expired categories', () => {
      const expired = engine.getExpiredCategories();
      expect(expired.length).toBeGreaterThan(0);
      // All non-forever policies should have a cutoff
      for (const item of expired) {
        expect(item.cutoffDate).toBeLessThan(Date.now());
      }
    });

    it('should identify categories needing anonymization', () => {
      const due = engine.getAnonymizationDue();
      // captured_images has anonymizeAfterDays: 7
      expect(due.find(d => d.category === 'captured_images')).toBeDefined();
    });

    it('should not expire forever-retention policies', () => {
      const expired = engine.getExpiredCategories();
      const auditPolicy = expired.find(e => e.category === 'audit_logs');
      expect(auditPolicy).toBeUndefined(); // -1 retention = forever
    });

    it('should record deletion operations', () => {
      const fn = vi.fn();
      engine.on('data:deleted', fn);

      engine.recordDeletion('user1', 'captured_images', 50);
      expect(fn).toHaveBeenCalledWith({ userId: 'user1', category: 'captured_images', count: 50 });
    });

    it('should record anonymization operations', () => {
      const fn = vi.fn();
      engine.on('data:anonymized', fn);

      engine.recordAnonymization('gps_locations', 100);
      expect(fn).toHaveBeenCalledWith({ category: 'gps_locations', count: 100 });
    });
  });

  // ─── Privacy Zones ──────────────────────────────────────────────

  describe('privacy zones', () => {
    it('should create a geofence privacy zone', () => {
      const zone = engine.addPrivacyZone({
        id: 'zone-home',
        name: 'Home',
        type: 'geofence',
        enabled: true,
        latitude: 30.2672,
        longitude: -97.7431,
        radiusMeters: 100,
        restrictions: ['no_capture', 'no_voice'],
      });

      expect(zone.id).toBe('zone-home');
      expect(zone.createdAt).toBeDefined();
    });

    it('should check location against geofence zones', () => {
      engine.addPrivacyZone({
        id: 'zone-office',
        name: 'Office',
        type: 'geofence',
        enabled: true,
        latitude: 30.2672,
        longitude: -97.7431,
        radiusMeters: 500,
        restrictions: ['no_faces', 'local_only'],
      });

      // Inside the zone
      const inside = engine.checkLocationPrivacy(30.2672, -97.7431);
      expect(inside.inZone).toBe(true);
      expect(inside.restrictions.has('no_faces')).toBe(true);
      expect(inside.restrictions.has('local_only')).toBe(true);

      // Outside the zone (far away)
      const outside = engine.checkLocationPrivacy(31.0, -98.0);
      expect(outside.inZone).toBe(false);
    });

    it('should emit zone entered/exited events', () => {
      const enterFn = vi.fn();
      const exitFn = vi.fn();
      engine.on('zone:entered', enterFn);
      engine.on('zone:exited', exitFn);

      engine.addPrivacyZone({
        id: 'zone-1',
        name: 'Test',
        type: 'geofence',
        enabled: true,
        latitude: 0,
        longitude: 0,
        radiusMeters: 1000,
        restrictions: ['no_capture'],
      });

      engine.checkLocationPrivacy(0, 0); // Enter
      expect(enterFn).toHaveBeenCalled();

      engine.checkLocationPrivacy(90, 90); // Exit (far away)
      expect(exitFn).toHaveBeenCalled();
    });

    it('should check WiFi-based privacy zones', () => {
      engine.addPrivacyZone({
        id: 'zone-wifi',
        name: 'Office WiFi',
        type: 'wifi',
        enabled: true,
        ssid: 'CorpNet-5G',
        restrictions: ['no_capture', 'no_text'],
      });

      const match = engine.checkWifiPrivacy('CorpNet-5G');
      expect(match.inZone).toBe(true);
      expect(match.restrictions.has('no_capture')).toBe(true);

      const noMatch = engine.checkWifiPrivacy('HomeWiFi');
      expect(noMatch.inZone).toBe(false);
    });

    it('should check schedule-based privacy zones', () => {
      const now = new Date();
      const currentDay = now.getDay();
      const currentHour = now.getHours();

      engine.addPrivacyZone({
        id: 'zone-schedule',
        name: 'Night Mode',
        type: 'schedule',
        enabled: true,
        schedule: {
          days: [currentDay],
          startHour: currentHour,
          endHour: currentHour + 1,
          timezone: 'UTC',
        },
        restrictions: ['no_capture', 'no_voice'],
      });

      const check = engine.checkSchedulePrivacy();
      expect(check.activeZones.length).toBe(1);
      expect(check.restrictions.has('no_capture')).toBe(true);
    });

    it('should handle manual zone enter/exit', () => {
      engine.addPrivacyZone({
        id: 'zone-manual',
        name: 'Hospital',
        type: 'manual',
        enabled: true,
        restrictions: ['no_capture', 'no_voice', 'no_biometric'],
      });

      expect(engine.enterManualZone('zone-manual')).toBe(true);
      const restrictions = engine.getActiveRestrictions();
      expect(restrictions.has('no_capture')).toBe(true);
      expect(restrictions.has('no_biometric')).toBe(true);

      expect(engine.exitManualZone('zone-manual')).toBe(true);
      expect(engine.getActiveRestrictions().size).toBe(0);
    });

    it('should not enter non-manual zone manually', () => {
      engine.addPrivacyZone({
        id: 'zone-geo',
        name: 'Geo',
        type: 'geofence',
        enabled: true,
        latitude: 0,
        longitude: 0,
        radiusMeters: 100,
        restrictions: ['no_capture'],
      });

      expect(engine.enterManualZone('zone-geo')).toBe(false);
    });

    it('should remove a privacy zone', () => {
      engine.addPrivacyZone({
        id: 'to-remove',
        name: 'Temp',
        type: 'manual',
        enabled: true,
        restrictions: ['no_capture'],
      });

      expect(engine.removePrivacyZone('to-remove')).toBe(true);
      expect(engine.getPrivacyZone('to-remove')).toBeUndefined();
    });

    it('should enforce max privacy zones limit', () => {
      const engine2 = new PrivacyEngine({ maxPrivacyZones: 2 });
      engine2.addPrivacyZone({ id: 'z1', name: 'Z1', type: 'manual', enabled: true, restrictions: ['no_capture'] });
      engine2.addPrivacyZone({ id: 'z2', name: 'Z2', type: 'manual', enabled: true, restrictions: ['no_voice'] });

      expect(() => engine2.addPrivacyZone({
        id: 'z3', name: 'Z3', type: 'manual', enabled: true, restrictions: ['no_text'],
      })).toThrow(/maximum/i);
    });

    it('should get all privacy zones', () => {
      engine.addPrivacyZone({ id: 'z1', name: 'Z1', type: 'manual', enabled: true, restrictions: ['no_capture'] });
      engine.addPrivacyZone({ id: 'z2', name: 'Z2', type: 'manual', enabled: true, restrictions: ['no_voice'] });

      expect(engine.getAllPrivacyZones()).toHaveLength(2);
    });

    it('should skip disabled geofence zones', () => {
      engine.addPrivacyZone({
        id: 'z-disabled',
        name: 'Disabled',
        type: 'geofence',
        enabled: false,
        latitude: 0,
        longitude: 0,
        radiusMeters: 100000,
        restrictions: ['no_capture'],
      });

      const result = engine.checkLocationPrivacy(0, 0);
      expect(result.inZone).toBe(false);
    });
  });

  // ─── Data Subject Requests ──────────────────────────────────────

  describe('data subject requests (DSR)', () => {
    it('should create a DSR', () => {
      const dsr = engine.createDSR('user1', 'access');
      expect(dsr.id).toBeDefined();
      expect(dsr.userId).toBe('user1');
      expect(dsr.type).toBe('access');
      expect(dsr.status).toBe('pending');
      expect(dsr.deadline).toBeGreaterThan(Date.now());
    });

    it('should process an erasure DSR', () => {
      const dsr = engine.createDSR('user1', 'erasure', {
        categories: ['captured_images', 'gps_locations'],
      });

      const processed = engine.processDSR(dsr.id);
      expect(processed).not.toBeNull();
      expect(processed!.status).toBe('completed');
      expect(processed!.completedAt).toBeDefined();
      expect(processed!.result!.recordsAffected).toBeGreaterThan(0);
    });

    it('should process an access DSR', () => {
      const dsr = engine.createDSR('user1', 'access');
      const processed = engine.processDSR(dsr.id);
      expect(processed!.status).toBe('completed');
      expect(processed!.result!.processedCategories.length).toBeGreaterThan(0);
    });

    it('should not process already-completed DSR', () => {
      const dsr = engine.createDSR('user1', 'portability');
      engine.processDSR(dsr.id);
      const second = engine.processDSR(dsr.id);
      expect(second).toBeNull();
    });

    it('should track overdue DSRs', () => {
      const dsr = engine.createDSR('user1', 'erasure');
      // Manually set deadline to the past
      const stored = engine.getDSR(dsr.id)!;
      stored.deadline = Date.now() - 1000;

      const overdue = engine.getOverdueDSRs();
      expect(overdue).toHaveLength(1);
    });

    it('should get DSRs for a user', () => {
      engine.createDSR('user1', 'access');
      engine.createDSR('user1', 'erasure');
      engine.createDSR('user2', 'portability');

      expect(engine.getUserDSRs('user1')).toHaveLength(2);
      expect(engine.getUserDSRs('user2')).toHaveLength(1);
    });

    it('should emit DSR events', () => {
      const createFn = vi.fn();
      const completeFn = vi.fn();
      engine.on('dsr:created', createFn);
      engine.on('dsr:completed', completeFn);

      const dsr = engine.createDSR('user1', 'erasure');
      expect(createFn).toHaveBeenCalled();

      engine.processDSR(dsr.id);
      expect(completeFn).toHaveBeenCalledWith(expect.objectContaining({
        type: 'erasure',
        recordsAffected: expect.any(Number),
      }));
    });

    it('should set correct deadline based on config', () => {
      const customEngine = new PrivacyEngine({ dsrDeadlineDays: 15 });
      const dsr = customEngine.createDSR('user1', 'access');
      const expectedDeadline = dsr.requestedAt + (15 * 86400000);
      expect(dsr.deadline).toBe(expectedDeadline);
    });

    it('should get all DSRs', () => {
      engine.createDSR('u1', 'access');
      engine.createDSR('u2', 'erasure');
      engine.createDSR('u3', 'portability');

      expect(engine.getAllDSRs()).toHaveLength(3);
    });
  });

  // ─── Anonymization ──────────────────────────────────────────────

  describe('anonymization', () => {
    const testRecord = {
      id: '123',
      name: 'John Smith',
      email: 'john@example.com',
      phone: '555-123-4567',
      ssn: '123-45-6789',
      age: 35,
      city: 'Austin',
    };

    it('should anonymize by suppression', () => {
      const { anonymized, result } = engine.anonymizeRecord(testRecord, 'suppression');
      expect(anonymized.name).toBeUndefined();
      expect(anonymized.email).toBeUndefined();
      expect(anonymized.phone).toBeUndefined();
      expect(anonymized.ssn).toBeUndefined();
      expect(anonymized.id).toBe('123');  // Non-PII preserved
      expect(anonymized.age).toBe(35);
      expect(result.technique).toBe('suppression');
      expect(result.anonymizedFields).toBeGreaterThan(0);
    });

    it('should anonymize by hashing', () => {
      const { anonymized, result } = engine.anonymizeRecord(testRecord, 'hashing');
      expect(anonymized.email).toBeDefined();
      expect(anonymized.email).not.toBe('john@example.com');
      expect(typeof anonymized.email).toBe('string');
      expect(result.technique).toBe('hashing');
    });

    it('should anonymize by pseudonymization', () => {
      const { anonymized, result } = engine.anonymizeRecord(testRecord, 'pseudonymization');
      expect(anonymized.name).toBeDefined();
      expect(typeof anonymized.name).toBe('string');
      expect((anonymized.name as string).startsWith('anon_')).toBe(true);
      expect(result.reversible).toBe(true);
    });

    it('should anonymize by generalization (numeric)', () => {
      const record = { name: 'Test', age: 27 };
      const { anonymized } = engine.anonymizeRecord(record, 'generalization');
      expect(anonymized.name).toBeUndefined(); // Suppressed (non-numeric PII)
      expect(anonymized.age).toBe(27); // age is not a PII field
    });

    it('should anonymize text', () => {
      const { anonymized, piiCount } = engine.anonymizeText('Call john@test.com at 555-123-4567');
      expect(anonymized).toContain('[EMAIL_REDACTED]');
      expect(piiCount).toBeGreaterThan(0);
    });

    it('should report non-reversibility for suppression', () => {
      const { result } = engine.anonymizeRecord(testRecord, 'suppression');
      expect(result.reversible).toBe(false);
    });
  });

  // ─── Audit Log ──────────────────────────────────────────────────

  describe('audit log', () => {
    it('should log consent operations', () => {
      engine.grantConsent('user1', 'image_capture');
      const log = engine.getAuditLog({ action: 'consent_granted' });
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].userId).toBe('user1');
    });

    it('should filter audit log by user', () => {
      engine.grantConsent('user1', 'analytics');
      engine.grantConsent('user2', 'analytics');

      const user1Log = engine.getAuditLog({ userId: 'user1' });
      expect(user1Log.every(e => e.userId === 'user1')).toBe(true);
    });

    it('should filter audit log by time', () => {
      const before = Date.now();
      engine.grantConsent('user1', 'image_capture');

      const log = engine.getAuditLog({ since: before });
      expect(log.length).toBeGreaterThan(0);
    });

    it('should limit audit log results', () => {
      for (let i = 0; i < 10; i++) {
        engine.grantConsent(`user${i}`, 'analytics');
      }

      const limited = engine.getAuditLog({ limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it('should trim audit log when over max', () => {
      const small = new PrivacyEngine({ maxAuditEntries: 5 });
      for (let i = 0; i < 20; i++) {
        small.grantConsent(`user${i}`, 'analytics');
      }

      const log = small.getAuditLog();
      expect(log.length).toBeLessThanOrEqual(5);
    });

    it('should not log when audit is disabled', () => {
      const noAudit = new PrivacyEngine({ auditLogEnabled: false });
      noAudit.grantConsent('user1', 'analytics');
      expect(noAudit.getAuditLog()).toHaveLength(0);
    });
  });

  // ─── Compliance Reports ─────────────────────────────────────────

  describe('compliance reports', () => {
    it('should generate a full report', () => {
      engine.grantConsent('user1', 'image_capture');
      engine.grantConsent('user2', 'image_capture');
      engine.createDSR('user1', 'access');
      engine.detectPII('test@test.com');

      const report = engine.generateReport();
      expect(report.regulation).toBe('gdpr');
      expect(report.consentSummary.totalUsers).toBe(2);
      expect(report.retentionSummary.activePolicies).toBeGreaterThan(0);
      expect(report.dsrSummary.total).toBe(1);
      expect(report.dsrSummary.pending).toBe(1);
      expect(report.piiSummary.totalDetections).toBeGreaterThan(0);
      expect(report.complianceScore).toBeGreaterThanOrEqual(0);
      expect(report.complianceScore).toBeLessThanOrEqual(100);
    });

    it('should penalize score for overdue DSRs', () => {
      const dsr = engine.createDSR('user1', 'erasure');
      engine.getDSR(dsr.id)!.deadline = Date.now() - 1000;

      const report = engine.generateReport();
      expect(report.complianceScore).toBeLessThan(100);
    });

    it('should generate for specific regulation', () => {
      const report = engine.generateReport('ccpa');
      expect(report.regulation).toBe('ccpa');
    });

    it('should generate voice summary', () => {
      engine.grantConsent('user1', 'analytics');
      const summary = engine.generateVoiceSummary();
      expect(summary).toContain('Privacy compliance score');
      expect(summary.length).toBeGreaterThan(20);
    });

    it('should mention overdue DSRs in voice summary', () => {
      const dsr = engine.createDSR('user1', 'erasure');
      engine.getDSR(dsr.id)!.deadline = Date.now() - 1000;

      const summary = engine.generateVoiceSummary();
      expect(summary.toLowerCase()).toContain('overdue');
    });
  });

  // ─── Stats & Reset ──────────────────────────────────────────────

  describe('stats and reset', () => {
    it('should return comprehensive stats', () => {
      engine.grantConsent('user1', 'image_capture');
      engine.addPrivacyZone({ id: 'z1', name: 'Z1', type: 'manual', enabled: true, restrictions: ['no_capture'] });
      engine.enterManualZone('z1');
      engine.createDSR('user1', 'access');
      engine.detectPII('test@test.com');

      const stats = engine.getStats();
      expect(stats.totalConsents).toBe(1);
      expect(stats.activeConsents).toBe(1);
      expect(stats.privacyZones).toBe(1);
      expect(stats.activeZones).toBe(1);
      expect(stats.pendingDSRs).toBe(1);
      expect(stats.piiDetections).toBeGreaterThan(0);
      expect(stats.auditEntries).toBeGreaterThan(0);
    });

    it('should reset all state', () => {
      engine.grantConsent('user1', 'analytics');
      engine.addPrivacyZone({ id: 'z1', name: 'Z1', type: 'manual', enabled: true, restrictions: ['no_capture'] });
      engine.createDSR('user1', 'access');

      engine.reset();

      const stats = engine.getStats();
      expect(stats.totalConsents).toBe(0);
      expect(stats.privacyZones).toBe(0);
      expect(stats.pendingDSRs).toBe(0);
      expect(stats.auditEntries).toBe(0);
      // Retention policies should be reloaded
      expect(stats.retentionPolicies).toBeGreaterThan(0);
    });
  });
});
