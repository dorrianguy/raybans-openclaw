/**
 * Privacy Engine — GDPR/CCPA compliance, data retention, anonymization, consent management
 *
 * Smart glasses capture sensitive visual data constantly. This engine ensures:
 * - Users control what's stored and for how long
 * - Personal data can be fully erased (right to be forgotten)
 * - Data is anonymized for analytics without losing utility
 * - Consent is tracked and auditable
 * - Privacy zones suppress capture automatically
 * - Face blurring / PII redaction is enforced
 *
 * Revenue angle: Enterprise customers ($199-499/mo) REQUIRE privacy compliance.
 * HIPAA, SOC2, and GDPR compliance unlock healthcare, finance, and EU markets.
 *
 * @module privacy-engine
 */

import { EventEmitter } from 'events';

// ─── Types ─────────────────────────────────────────────────────────────

export type PrivacyRegulation = 'gdpr' | 'ccpa' | 'hipaa' | 'pipeda' | 'lgpd' | 'custom';

export type ConsentCategory =
  | 'image_capture'        // Camera usage
  | 'voice_recording'      // Microphone usage
  | 'location_tracking'    // GPS data
  | 'face_recognition'     // Facial identification
  | 'ocr_text'             // Text extraction from images
  | 'barcode_scanning'     // Product identification
  | 'analytics'            // Usage analytics
  | 'cloud_processing'     // Sending data to cloud APIs
  | 'data_sharing'         // Sharing with third parties
  | 'marketing'            // Marketing communications
  | 'biometric'            // Biometric data processing
  | 'health_data';         // Health-related data

export type ConsentStatus = 'granted' | 'denied' | 'withdrawn' | 'not_requested';

export interface ConsentRecord {
  id: string;
  userId: string;
  category: ConsentCategory;
  status: ConsentStatus;
  grantedAt?: number;
  withdrawnAt?: number;
  expiresAt?: number;
  source: 'explicit' | 'implied' | 'default' | 'legal_basis';
  version: string;           // Consent policy version
  ipAddress?: string;        // For audit trail (hashed)
  metadata?: Record<string, string>;
}

export interface DataRetentionPolicy {
  id: string;
  name: string;
  description: string;
  dataCategory: DataCategory;
  retentionDays: number;       // 0 = no retention, -1 = forever
  regulation: PrivacyRegulation;
  autoDelete: boolean;
  anonymizeAfterDays?: number; // Anonymize before deleting
  enabled: boolean;
}

export type DataCategory =
  | 'captured_images'
  | 'processed_results'
  | 'voice_recordings'
  | 'transcripts'
  | 'gps_locations'
  | 'face_embeddings'
  | 'contact_info'
  | 'inventory_data'
  | 'analytics_events'
  | 'session_data'
  | 'user_profiles'
  | 'billing_data'
  | 'audit_logs';

export interface PIIDetection {
  type: PIIType;
  value: string;           // The detected PII (for processing, not storage)
  confidence: number;      // 0-1
  location: {
    field?: string;        // JSON field path
    startIndex?: number;   // Text position
    endIndex?: number;
  };
  action: 'redact' | 'mask' | 'hash' | 'encrypt' | 'flag';
}

export type PIIType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'name'
  | 'address'
  | 'ip_address'
  | 'date_of_birth'
  | 'license_plate'
  | 'passport'
  | 'medical_id'
  | 'bank_account'
  | 'face'
  | 'fingerprint'
  | 'custom';

export interface PrivacyZone {
  id: string;
  name: string;
  type: 'geofence' | 'wifi' | 'bluetooth' | 'manual' | 'schedule';
  enabled: boolean;
  restrictions: PrivacyRestriction[];
  // Geofence
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  // WiFi
  ssid?: string;
  // Bluetooth
  deviceId?: string;
  // Schedule
  schedule?: {
    days: number[];        // 0-6, Sunday=0
    startHour: number;
    endHour: number;
    timezone: string;
  };
  createdAt: number;
}

export type PrivacyRestriction =
  | 'no_capture'           // Disable camera entirely
  | 'no_voice'             // Disable microphone
  | 'no_faces'             // Blur all faces
  | 'no_text'              // Skip OCR
  | 'no_location'          // Stop GPS tracking
  | 'no_storage'           // Process but don't store
  | 'local_only'           // No cloud processing
  | 'no_biometric';        // No face recognition or biometric processing

export interface DataSubjectRequest {
  id: string;
  userId: string;
  type: DSRType;
  status: 'pending' | 'processing' | 'completed' | 'rejected';
  requestedAt: number;
  completedAt?: number;
  deadline: number;         // Must complete by this time (30 days for GDPR)
  categories?: DataCategory[];
  reason?: string;
  result?: DSRResult;
}

export type DSRType =
  | 'access'               // Right to access (GDPR Art. 15)
  | 'rectification'        // Right to correct (GDPR Art. 16)
  | 'erasure'              // Right to be forgotten (GDPR Art. 17)
  | 'portability'          // Right to data portability (GDPR Art. 20)
  | 'restriction'          // Right to restrict processing (GDPR Art. 18)
  | 'objection';           // Right to object (GDPR Art. 21)

export interface DSRResult {
  processedCategories: DataCategory[];
  recordsAffected: number;
  exportPath?: string;     // For access/portability
  errors?: string[];
}

export interface AnonymizationResult {
  originalFields: number;
  anonymizedFields: number;
  technique: AnonymizationTechnique;
  reversible: boolean;
}

export type AnonymizationTechnique =
  | 'pseudonymization'     // Replace with pseudonym (reversible with key)
  | 'generalization'       // Reduce precision (age 27 → age range 25-30)
  | 'suppression'          // Remove entirely
  | 'noise_addition'       // Add statistical noise
  | 'k_anonymity'          // Ensure k-1 identical records exist
  | 'hashing';             // One-way hash

export interface PrivacyAuditEntry {
  id: string;
  timestamp: number;
  action: string;
  userId?: string;
  category?: DataCategory;
  regulation?: PrivacyRegulation;
  details: string;
  ipAddress?: string;
}

export interface PrivacyEngineConfig {
  defaultRegulation: PrivacyRegulation;
  enabledRegulations: PrivacyRegulation[];
  consentRequired: boolean;
  defaultRetentionDays: number;
  piiDetectionEnabled: boolean;
  autoAnonymize: boolean;
  auditLogEnabled: boolean;
  maxAuditEntries: number;
  dsrDeadlineDays: number;      // Default: 30 (GDPR)
  maxPrivacyZones: number;
  consentExpiryDays: number;    // How long consent is valid
  minAnonymizationK: number;    // k-anonymity threshold
}

export interface PrivacyEngineEvents {
  'consent:granted': { userId: string; category: ConsentCategory };
  'consent:withdrawn': { userId: string; category: ConsentCategory };
  'pii:detected': { type: PIIType; action: string };
  'data:deleted': { userId: string; category: DataCategory; count: number };
  'data:anonymized': { category: DataCategory; count: number };
  'zone:entered': { zoneId: string; restrictions: PrivacyRestriction[] };
  'zone:exited': { zoneId: string };
  'dsr:created': { requestId: string; type: DSRType };
  'dsr:completed': { requestId: string; type: DSRType; recordsAffected: number };
  'retention:cleaned': { category: DataCategory; deletedCount: number };
  'violation:detected': { regulation: PrivacyRegulation; description: string };
  'audit:logged': { action: string };
}

export interface PrivacyReport {
  generatedAt: number;
  regulation: PrivacyRegulation;
  consentSummary: {
    totalUsers: number;
    consentsByCategory: Record<ConsentCategory, { granted: number; denied: number; pending: number }>;
  };
  retentionSummary: {
    activePolicies: number;
    overdueCleanups: number;
    dataCategories: { category: DataCategory; recordCount: number; oldestRecord?: number }[];
  };
  dsrSummary: {
    total: number;
    pending: number;
    completed: number;
    averageCompletionDays: number;
    overdue: number;
  };
  piiSummary: {
    totalDetections: number;
    byType: Record<string, number>;
    redactedCount: number;
  };
  privacyZones: number;
  auditEntriesCount: number;
  complianceScore: number;    // 0-100
}

// ─── Default Config ────────────────────────────────────────────────────

export const DEFAULT_PRIVACY_CONFIG: PrivacyEngineConfig = {
  defaultRegulation: 'gdpr',
  enabledRegulations: ['gdpr', 'ccpa'],
  consentRequired: true,
  defaultRetentionDays: 90,
  piiDetectionEnabled: true,
  autoAnonymize: true,
  auditLogEnabled: true,
  maxAuditEntries: 50000,
  dsrDeadlineDays: 30,
  maxPrivacyZones: 50,
  consentExpiryDays: 365,
  minAnonymizationK: 5,
};

// ─── PII Detection Patterns ───────────────────────────────────────────

const PII_PATTERNS: Record<PIIType, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,
  phone: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  credit_card: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  name: /\b[A-Z][a-z]+\s[A-Z][a-z]+\b/g,  // Simple — enhanced in production
  address: /\b\d{1,5}\s[A-Z][a-zA-Z\s]+(?:St|Ave|Blvd|Dr|Ln|Rd|Way|Ct|Pl)\b/gi,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  date_of_birth: /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g,
  license_plate: /\b[A-Z0-9]{2,3}[-\s]?[A-Z0-9]{3,4}\b/g,
  passport: /\b[A-Z]\d{8}\b/g,
  medical_id: /\b(?:MRN|NPI|DEA)[-:\s]?\d{6,10}\b/gi,
  bank_account: /\b\d{8,17}\b/g,  // Simplified — context-dependent in production
  face: /(?:)/,  // Detected via vision, not regex
  fingerprint: /(?:)/,  // Detected via vision, not regex
  custom: /(?:)/,
};

// ─── Default Retention Policies ───────────────────────────────────────

const DEFAULT_RETENTION_POLICIES: DataRetentionPolicy[] = [
  {
    id: 'ret-images',
    name: 'Captured Images',
    description: 'Raw images from glasses camera',
    dataCategory: 'captured_images',
    retentionDays: 30,
    regulation: 'gdpr',
    autoDelete: true,
    anonymizeAfterDays: 7,
    enabled: true,
  },
  {
    id: 'ret-voice',
    name: 'Voice Recordings',
    description: 'Audio recordings from microphone',
    dataCategory: 'voice_recordings',
    retentionDays: 7,
    regulation: 'gdpr',
    autoDelete: true,
    enabled: true,
  },
  {
    id: 'ret-gps',
    name: 'GPS Locations',
    description: 'Location tracking data',
    dataCategory: 'gps_locations',
    retentionDays: 90,
    regulation: 'gdpr',
    autoDelete: true,
    anonymizeAfterDays: 30,
    enabled: true,
  },
  {
    id: 'ret-faces',
    name: 'Face Embeddings',
    description: 'Facial recognition data (biometric)',
    dataCategory: 'face_embeddings',
    retentionDays: 30,
    regulation: 'gdpr',
    autoDelete: true,
    enabled: true,
  },
  {
    id: 'ret-analytics',
    name: 'Analytics Events',
    description: 'Usage analytics and telemetry',
    dataCategory: 'analytics_events',
    retentionDays: 365,
    regulation: 'gdpr',
    autoDelete: true,
    anonymizeAfterDays: 90,
    enabled: true,
  },
  {
    id: 'ret-audit',
    name: 'Audit Logs',
    description: 'Privacy audit trail',
    dataCategory: 'audit_logs',
    retentionDays: -1,  // Forever — required for compliance
    regulation: 'gdpr',
    autoDelete: false,
    enabled: true,
  },
  {
    id: 'ret-inventory',
    name: 'Inventory Data',
    description: 'Inventory session results',
    dataCategory: 'inventory_data',
    retentionDays: 365,
    regulation: 'gdpr',
    autoDelete: true,
    enabled: true,
  },
  {
    id: 'ret-contacts',
    name: 'Contact Info',
    description: 'Scanned business cards and contacts',
    dataCategory: 'contact_info',
    retentionDays: 180,
    regulation: 'gdpr',
    autoDelete: true,
    anonymizeAfterDays: 90,
    enabled: true,
  },
];

// ─── Privacy Engine Implementation ────────────────────────────────────

export class PrivacyEngine extends EventEmitter {
  private config: PrivacyEngineConfig;
  private consents: Map<string, ConsentRecord> = new Map();
  private retentionPolicies: Map<string, DataRetentionPolicy> = new Map();
  private privacyZones: Map<string, PrivacyZone> = new Map();
  private activeZones: Set<string> = new Set();
  private dsrRequests: Map<string, DataSubjectRequest> = new Map();
  private auditLog: PrivacyAuditEntry[] = [];
  private piiStats: Map<PIIType, number> = new Map();
  private deletionLog: Map<string, { category: DataCategory; count: number; timestamp: number }[]> = new Map();
  private customPIIPatterns: Map<string, RegExp> = new Map();

  constructor(config: Partial<PrivacyEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_PRIVACY_CONFIG, ...config };

    // Load default retention policies
    for (const policy of DEFAULT_RETENTION_POLICIES) {
      this.retentionPolicies.set(policy.id, { ...policy });
    }
  }

  // ─── Consent Management ────────────────────────────────────────────

  /**
   * Grant consent for a specific data processing category
   */
  grantConsent(
    userId: string,
    category: ConsentCategory,
    options: {
      source?: ConsentRecord['source'];
      version?: string;
      expiresAt?: number;
      ipAddress?: string;
      metadata?: Record<string, string>;
    } = {}
  ): ConsentRecord {
    const id = `consent-${userId}-${category}`;
    const now = Date.now();

    const record: ConsentRecord = {
      id,
      userId,
      category,
      status: 'granted',
      grantedAt: now,
      expiresAt: options.expiresAt ?? (this.config.consentExpiryDays > 0
        ? now + this.config.consentExpiryDays * 86400000
        : undefined),
      source: options.source ?? 'explicit',
      version: options.version ?? '1.0',
      ipAddress: options.ipAddress,
      metadata: options.metadata,
    };

    this.consents.set(id, record);
    this.logAudit('consent_granted', userId, category as unknown as DataCategory, `Consent granted for ${category}`);
    this.emit('consent:granted', { userId, category });

    return record;
  }

  /**
   * Withdraw previously granted consent
   */
  withdrawConsent(userId: string, category: ConsentCategory): ConsentRecord | null {
    const id = `consent-${userId}-${category}`;
    const existing = this.consents.get(id);

    if (!existing || existing.status !== 'granted') {
      return null;
    }

    existing.status = 'withdrawn';
    existing.withdrawnAt = Date.now();

    this.logAudit('consent_withdrawn', userId, category as unknown as DataCategory, `Consent withdrawn for ${category}`);
    this.emit('consent:withdrawn', { userId, category });

    return existing;
  }

  /**
   * Check if consent is currently valid for a category
   */
  hasConsent(userId: string, category: ConsentCategory): boolean {
    if (!this.config.consentRequired) return true;

    const id = `consent-${userId}-${category}`;
    const record = this.consents.get(id);

    if (!record || record.status !== 'granted') return false;

    // Check expiry
    if (record.expiresAt && Date.now() > record.expiresAt) {
      record.status = 'withdrawn';
      record.withdrawnAt = Date.now();
      return false;
    }

    return true;
  }

  /**
   * Get all consent records for a user
   */
  getUserConsents(userId: string): ConsentRecord[] {
    return Array.from(this.consents.values())
      .filter(c => c.userId === userId);
  }

  /**
   * Get consent summary across all users
   */
  getConsentSummary(): Record<ConsentCategory, { granted: number; denied: number; pending: number }> {
    const summary: Record<string, { granted: number; denied: number; pending: number }> = {};
    const categories: ConsentCategory[] = [
      'image_capture', 'voice_recording', 'location_tracking', 'face_recognition',
      'ocr_text', 'barcode_scanning', 'analytics', 'cloud_processing',
      'data_sharing', 'marketing', 'biometric', 'health_data',
    ];

    for (const cat of categories) {
      summary[cat] = { granted: 0, denied: 0, pending: 0 };
    }

    for (const record of this.consents.values()) {
      if (summary[record.category]) {
        if (record.status === 'granted') {
          // Check expiry
          if (record.expiresAt && Date.now() > record.expiresAt) {
            summary[record.category].pending++;
          } else {
            summary[record.category].granted++;
          }
        } else if (record.status === 'denied' || record.status === 'withdrawn') {
          summary[record.category].denied++;
        } else {
          summary[record.category].pending++;
        }
      }
    }

    return summary as Record<ConsentCategory, { granted: number; denied: number; pending: number }>;
  }

  /**
   * Grant multiple consents at once (for onboarding flow)
   */
  grantBulkConsent(
    userId: string,
    categories: ConsentCategory[],
    options: { source?: ConsentRecord['source']; version?: string } = {}
  ): ConsentRecord[] {
    return categories.map(cat => this.grantConsent(userId, cat, options));
  }

  // ─── PII Detection ─────────────────────────────────────────────────

  /**
   * Scan text for PII (Personally Identifiable Information)
   */
  detectPII(text: string, options: { includeNames?: boolean } = {}): PIIDetection[] {
    if (!this.config.piiDetectionEnabled) return [];

    const detections: PIIDetection[] = [];
    const typesToCheck: PIIType[] = [
      'email', 'phone', 'ssn', 'credit_card', 'address',
      'ip_address', 'date_of_birth', 'license_plate', 'passport',
      'medical_id',
    ];

    if (options.includeNames) {
      typesToCheck.push('name');
    }

    for (const type of typesToCheck) {
      const pattern = PII_PATTERNS[type];
      if (!pattern || pattern.source === '(?:)') continue;

      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        // Validate specific types to reduce false positives
        if (type === 'ssn' && !this.isValidSSN(match[0])) continue;
        if (type === 'credit_card' && !this.isValidCreditCard(match[0])) continue;
        if (type === 'ip_address' && !this.isValidIP(match[0])) continue;

        const detection: PIIDetection = {
          type,
          value: match[0],
          confidence: this.getPIIConfidence(type, match[0]),
          location: {
            startIndex: match.index,
            endIndex: match.index + match[0].length,
          },
          action: this.getDefaultPIIAction(type),
        };

        detections.push(detection);

        // Track stats
        this.piiStats.set(type, (this.piiStats.get(type) ?? 0) + 1);
      }
    }

    // Check custom patterns
    for (const [name, pattern] of this.customPIIPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        detections.push({
          type: 'custom',
          value: match[0],
          confidence: 0.8,
          location: { startIndex: match.index, endIndex: match.index + match[0].length },
          action: 'redact',
        });
      }
    }

    if (detections.length > 0) {
      this.emit('pii:detected', { type: detections[0].type, action: detections[0].action });
    }

    return detections;
  }

  /**
   * Redact PII from text, replacing with placeholders
   */
  redactPII(text: string, options: { includeNames?: boolean; placeholder?: string } = {}): {
    redacted: string;
    detections: PIIDetection[];
  } {
    const detections = this.detectPII(text, options);
    let redacted = text;

    // Sort by position descending to avoid offset issues
    const sorted = [...detections].sort((a, b) =>
      (b.location.startIndex ?? 0) - (a.location.startIndex ?? 0)
    );

    for (const det of sorted) {
      if (det.location.startIndex !== undefined && det.location.endIndex !== undefined) {
        const replacement = options.placeholder ?? this.getRedactionPlaceholder(det.type);
        redacted = redacted.slice(0, det.location.startIndex) +
                   replacement +
                   redacted.slice(det.location.endIndex);
      }
    }

    return { redacted, detections };
  }

  /**
   * Register a custom PII detection pattern
   */
  addCustomPIIPattern(name: string, pattern: RegExp): void {
    this.customPIIPatterns.set(name, new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'));
  }

  private getRedactionPlaceholder(type: PIIType): string {
    const placeholders: Record<PIIType, string> = {
      email: '[EMAIL_REDACTED]',
      phone: '[PHONE_REDACTED]',
      ssn: '[SSN_REDACTED]',
      credit_card: '[CARD_REDACTED]',
      name: '[NAME_REDACTED]',
      address: '[ADDRESS_REDACTED]',
      ip_address: '[IP_REDACTED]',
      date_of_birth: '[DOB_REDACTED]',
      license_plate: '[PLATE_REDACTED]',
      passport: '[PASSPORT_REDACTED]',
      medical_id: '[MED_ID_REDACTED]',
      bank_account: '[ACCOUNT_REDACTED]',
      face: '[FACE_REDACTED]',
      fingerprint: '[BIOMETRIC_REDACTED]',
      custom: '[REDACTED]',
    };
    return placeholders[type] ?? '[REDACTED]';
  }

  private getPIIConfidence(type: PIIType, value: string): number {
    // Higher confidence for more specific patterns
    switch (type) {
      case 'email': return 0.95;
      case 'ssn': return 0.9;
      case 'credit_card': return 0.9;
      case 'phone': return 0.85;
      case 'ip_address': return 0.8;
      case 'passport': return 0.75;
      case 'medical_id': return 0.85;
      case 'license_plate': return 0.6;
      case 'address': return 0.7;
      case 'date_of_birth': return 0.65;
      case 'name': return 0.4; // Low — many false positives
      default: return 0.5;
    }
  }

  private getDefaultPIIAction(type: PIIType): PIIDetection['action'] {
    switch (type) {
      case 'ssn':
      case 'credit_card':
      case 'bank_account':
      case 'passport':
        return 'redact';
      case 'face':
      case 'fingerprint':
        return 'mask';
      case 'email':
      case 'phone':
        return 'hash';
      default:
        return 'flag';
    }
  }

  private isValidSSN(value: string): boolean {
    const clean = value.replace(/[-\s]/g, '');
    if (clean.length !== 9) return false;
    // SSN can't start with 000, 666, or 9xx
    const area = parseInt(clean.substring(0, 3));
    if (area === 0 || area === 666 || area >= 900) return false;
    // Group and serial can't be 0000
    const group = parseInt(clean.substring(3, 5));
    const serial = parseInt(clean.substring(5));
    return group > 0 && serial > 0;
  }

  private isValidCreditCard(value: string): boolean {
    const clean = value.replace(/[-\s]/g, '');
    if (clean.length < 13 || clean.length > 19) return false;
    // Luhn algorithm
    let sum = 0;
    let alternate = false;
    for (let i = clean.length - 1; i >= 0; i--) {
      let n = parseInt(clean[i], 10);
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alternate = !alternate;
    }
    return sum % 10 === 0;
  }

  private isValidIP(value: string): boolean {
    const parts = value.split('.');
    return parts.every(p => {
      const n = parseInt(p);
      return n >= 0 && n <= 255;
    });
  }

  // ─── Data Retention ─────────────────────────────────────────────────

  /**
   * Add or update a data retention policy
   */
  setRetentionPolicy(policy: DataRetentionPolicy): void {
    this.retentionPolicies.set(policy.id, { ...policy });
    this.logAudit('retention_policy_set', undefined, policy.dataCategory,
      `Retention policy "${policy.name}" set: ${policy.retentionDays} days`);
  }

  /**
   * Get a specific retention policy
   */
  getRetentionPolicy(id: string): DataRetentionPolicy | undefined {
    return this.retentionPolicies.get(id);
  }

  /**
   * Get all retention policies
   */
  getAllRetentionPolicies(): DataRetentionPolicy[] {
    return Array.from(this.retentionPolicies.values());
  }

  /**
   * Get retention policy for a specific data category
   */
  getRetentionForCategory(category: DataCategory): DataRetentionPolicy | undefined {
    return Array.from(this.retentionPolicies.values())
      .find(p => p.dataCategory === category && p.enabled);
  }

  /**
   * Check which data categories have expired records
   */
  getExpiredCategories(currentTime: number = Date.now()): {
    category: DataCategory;
    policy: DataRetentionPolicy;
    cutoffDate: number;
  }[] {
    const expired: { category: DataCategory; policy: DataRetentionPolicy; cutoffDate: number }[] = [];

    for (const policy of this.retentionPolicies.values()) {
      if (!policy.enabled || !policy.autoDelete || policy.retentionDays <= 0) continue;

      const cutoffDate = currentTime - (policy.retentionDays * 86400000);
      expired.push({
        category: policy.dataCategory,
        policy,
        cutoffDate,
      });
    }

    return expired;
  }

  /**
   * Get categories that need anonymization
   */
  getAnonymizationDue(currentTime: number = Date.now()): {
    category: DataCategory;
    policy: DataRetentionPolicy;
    cutoffDate: number;
  }[] {
    const due: { category: DataCategory; policy: DataRetentionPolicy; cutoffDate: number }[] = [];

    for (const policy of this.retentionPolicies.values()) {
      if (!policy.enabled || !policy.anonymizeAfterDays) continue;

      const cutoffDate = currentTime - (policy.anonymizeAfterDays * 86400000);
      due.push({
        category: policy.dataCategory,
        policy,
        cutoffDate,
      });
    }

    return due;
  }

  /**
   * Record a deletion operation (for audit trail)
   */
  recordDeletion(userId: string, category: DataCategory, count: number): void {
    const log = this.deletionLog.get(userId) ?? [];
    log.push({ category, count, timestamp: Date.now() });
    this.deletionLog.set(userId, log);

    this.logAudit('data_deleted', userId, category, `Deleted ${count} records from ${category}`);
    this.emit('data:deleted', { userId, category, count });
  }

  /**
   * Record anonymization operation
   */
  recordAnonymization(category: DataCategory, count: number): void {
    this.logAudit('data_anonymized', undefined, category, `Anonymized ${count} records in ${category}`);
    this.emit('data:anonymized', { category, count });
  }

  // ─── Privacy Zones ──────────────────────────────────────────────────

  /**
   * Create a privacy zone
   */
  addPrivacyZone(zone: Omit<PrivacyZone, 'createdAt'>): PrivacyZone {
    if (this.privacyZones.size >= this.config.maxPrivacyZones) {
      throw new Error(`Maximum privacy zones (${this.config.maxPrivacyZones}) reached`);
    }

    const fullZone: PrivacyZone = {
      ...zone,
      createdAt: Date.now(),
    };

    this.privacyZones.set(zone.id, fullZone);
    this.logAudit('zone_created', undefined, undefined, `Privacy zone "${zone.name}" created with restrictions: ${zone.restrictions.join(', ')}`);

    return fullZone;
  }

  /**
   * Remove a privacy zone
   */
  removePrivacyZone(id: string): boolean {
    const zone = this.privacyZones.get(id);
    if (!zone) return false;

    this.privacyZones.delete(id);
    this.activeZones.delete(id);
    this.logAudit('zone_removed', undefined, undefined, `Privacy zone "${zone.name}" removed`);

    return true;
  }

  /**
   * Get a privacy zone by ID
   */
  getPrivacyZone(id: string): PrivacyZone | undefined {
    return this.privacyZones.get(id);
  }

  /**
   * Get all privacy zones
   */
  getAllPrivacyZones(): PrivacyZone[] {
    return Array.from(this.privacyZones.values());
  }

  /**
   * Check if a GPS location is inside any privacy zone
   */
  checkLocationPrivacy(latitude: number, longitude: number): {
    inZone: boolean;
    zones: PrivacyZone[];
    restrictions: Set<PrivacyRestriction>;
  } {
    const matchingZones: PrivacyZone[] = [];
    const restrictions = new Set<PrivacyRestriction>();

    for (const zone of this.privacyZones.values()) {
      if (!zone.enabled || zone.type !== 'geofence') continue;
      if (zone.latitude === undefined || zone.longitude === undefined || zone.radiusMeters === undefined) continue;

      const distance = this.haversineDistance(
        latitude, longitude,
        zone.latitude, zone.longitude
      );

      if (distance <= zone.radiusMeters) {
        matchingZones.push(zone);
        for (const r of zone.restrictions) {
          restrictions.add(r);
        }
      }
    }

    if (matchingZones.length > 0) {
      for (const zone of matchingZones) {
        if (!this.activeZones.has(zone.id)) {
          this.activeZones.add(zone.id);
          this.emit('zone:entered', { zoneId: zone.id, restrictions: zone.restrictions });
        }
      }
    }

    // Check for zone exits
    for (const activeId of this.activeZones) {
      if (!matchingZones.find(z => z.id === activeId)) {
        this.activeZones.delete(activeId);
        this.emit('zone:exited', { zoneId: activeId });
      }
    }

    return {
      inZone: matchingZones.length > 0,
      zones: matchingZones,
      restrictions,
    };
  }

  /**
   * Check if a WiFi SSID matches any privacy zone
   */
  checkWifiPrivacy(ssid: string): {
    inZone: boolean;
    zone?: PrivacyZone;
    restrictions: Set<PrivacyRestriction>;
  } {
    const restrictions = new Set<PrivacyRestriction>();

    for (const zone of this.privacyZones.values()) {
      if (!zone.enabled || zone.type !== 'wifi' || !zone.ssid) continue;

      if (zone.ssid === ssid) {
        for (const r of zone.restrictions) {
          restrictions.add(r);
        }
        return { inZone: true, zone, restrictions };
      }
    }

    return { inZone: false, restrictions };
  }

  /**
   * Check schedule-based privacy zones
   */
  checkSchedulePrivacy(currentTime: number = Date.now()): {
    activeZones: PrivacyZone[];
    restrictions: Set<PrivacyRestriction>;
  } {
    const activeZones: PrivacyZone[] = [];
    const restrictions = new Set<PrivacyRestriction>();

    const now = new Date(currentTime);
    const day = now.getDay();
    const hour = now.getHours();

    for (const zone of this.privacyZones.values()) {
      if (!zone.enabled || zone.type !== 'schedule' || !zone.schedule) continue;

      const { days, startHour, endHour } = zone.schedule;
      const inDay = days.includes(day);
      const inHour = startHour <= endHour
        ? (hour >= startHour && hour < endHour)
        : (hour >= startHour || hour < endHour); // Overnight range

      if (inDay && inHour) {
        activeZones.push(zone);
        for (const r of zone.restrictions) {
          restrictions.add(r);
        }
      }
    }

    return { activeZones, restrictions };
  }

  /**
   * Get currently active restrictions from all active zones
   */
  getActiveRestrictions(): Set<PrivacyRestriction> {
    const restrictions = new Set<PrivacyRestriction>();
    for (const zoneId of this.activeZones) {
      const zone = this.privacyZones.get(zoneId);
      if (zone) {
        for (const r of zone.restrictions) {
          restrictions.add(r);
        }
      }
    }
    return restrictions;
  }

  /**
   * Enter a manual privacy zone
   */
  enterManualZone(zoneId: string): boolean {
    const zone = this.privacyZones.get(zoneId);
    if (!zone || zone.type !== 'manual') return false;

    this.activeZones.add(zoneId);
    this.emit('zone:entered', { zoneId, restrictions: zone.restrictions });
    return true;
  }

  /**
   * Exit a manual privacy zone
   */
  exitManualZone(zoneId: string): boolean {
    if (!this.activeZones.has(zoneId)) return false;

    this.activeZones.delete(zoneId);
    this.emit('zone:exited', { zoneId });
    return true;
  }

  // ─── Data Subject Requests (DSR) ───────────────────────────────────

  /**
   * Create a new Data Subject Request
   */
  createDSR(
    userId: string,
    type: DSRType,
    options: {
      categories?: DataCategory[];
      reason?: string;
    } = {}
  ): DataSubjectRequest {
    const id = `dsr-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const now = Date.now();

    const request: DataSubjectRequest = {
      id,
      userId,
      type,
      status: 'pending',
      requestedAt: now,
      deadline: now + (this.config.dsrDeadlineDays * 86400000),
      categories: options.categories,
      reason: options.reason,
    };

    this.dsrRequests.set(id, request);
    this.logAudit('dsr_created', userId, undefined, `DSR type "${type}" created. Deadline: ${new Date(request.deadline).toISOString()}`);
    this.emit('dsr:created', { requestId: id, type });

    return request;
  }

  /**
   * Process a Data Subject Request
   */
  processDSR(requestId: string): DataSubjectRequest | null {
    const request = this.dsrRequests.get(requestId);
    if (!request || request.status !== 'pending') return null;

    request.status = 'processing';

    // Simulate processing based on type
    const categories = request.categories ?? [
      'captured_images', 'processed_results', 'voice_recordings',
      'transcripts', 'gps_locations', 'face_embeddings',
      'contact_info', 'inventory_data', 'analytics_events',
      'session_data',
    ];

    let recordsAffected = 0;

    switch (request.type) {
      case 'erasure':
        // In production: would actually delete data across all stores
        recordsAffected = categories.length * 10; // Placeholder count
        for (const cat of categories) {
          this.recordDeletion(request.userId, cat, 10);
        }
        break;

      case 'access':
      case 'portability':
        // In production: would compile all data into an export
        recordsAffected = categories.length * 25;
        break;

      case 'rectification':
        recordsAffected = 1;
        break;

      case 'restriction':
        // Mark user's data as restricted (no further processing)
        recordsAffected = categories.length * 10;
        break;

      case 'objection':
        recordsAffected = categories.length * 5;
        break;
    }

    request.status = 'completed';
    request.completedAt = Date.now();
    request.result = {
      processedCategories: categories as DataCategory[],
      recordsAffected,
    };

    this.logAudit('dsr_completed', request.userId, undefined,
      `DSR "${request.type}" completed. ${recordsAffected} records affected.`);
    this.emit('dsr:completed', { requestId, type: request.type, recordsAffected });

    return request;
  }

  /**
   * Get a specific DSR
   */
  getDSR(requestId: string): DataSubjectRequest | undefined {
    return this.dsrRequests.get(requestId);
  }

  /**
   * Get all DSRs for a user
   */
  getUserDSRs(userId: string): DataSubjectRequest[] {
    return Array.from(this.dsrRequests.values())
      .filter(r => r.userId === userId);
  }

  /**
   * Get overdue DSRs
   */
  getOverdueDSRs(currentTime: number = Date.now()): DataSubjectRequest[] {
    return Array.from(this.dsrRequests.values())
      .filter(r => r.status === 'pending' && currentTime > r.deadline);
  }

  /**
   * Get all DSRs
   */
  getAllDSRs(): DataSubjectRequest[] {
    return Array.from(this.dsrRequests.values());
  }

  // ─── Data Anonymization ─────────────────────────────────────────────

  /**
   * Anonymize a data record by removing/masking PII fields
   */
  anonymizeRecord<T extends Record<string, unknown>>(
    record: T,
    technique: AnonymizationTechnique = 'suppression'
  ): { anonymized: T; result: AnonymizationResult } {
    const anonymized = { ...record };
    let anonymizedFields = 0;
    const totalFields = Object.keys(record).length;

    // Fields that are commonly PII
    const piiFields = new Set([
      'name', 'firstName', 'lastName', 'email', 'phone', 'address',
      'ssn', 'creditCard', 'dateOfBirth', 'dob', 'ipAddress', 'ip',
      'licensePlate', 'passport', 'medicalId', 'bankAccount',
      'faceEmbedding', 'fingerprint', 'photo', 'avatar',
    ]);

    for (const key of Object.keys(anonymized)) {
      if (piiFields.has(key) || piiFields.has(this.camelToSnake(key))) {
        switch (technique) {
          case 'suppression':
            (anonymized as Record<string, unknown>)[key] = undefined;
            break;
          case 'hashing':
            if (typeof record[key] === 'string') {
              (anonymized as Record<string, unknown>)[key] = this.simpleHash(record[key] as string);
            } else {
              (anonymized as Record<string, unknown>)[key] = undefined;
            }
            break;
          case 'pseudonymization':
            (anonymized as Record<string, unknown>)[key] = `anon_${this.simpleHash(String(record[key])).substring(0, 8)}`;
            break;
          case 'generalization':
            if (typeof record[key] === 'number') {
              // Round to nearest 10
              (anonymized as Record<string, unknown>)[key] = Math.round((record[key] as number) / 10) * 10;
            } else {
              (anonymized as Record<string, unknown>)[key] = undefined;
            }
            break;
          case 'noise_addition':
            if (typeof record[key] === 'number') {
              const noise = (Math.random() - 0.5) * 2 * (record[key] as number) * 0.1;
              (anonymized as Record<string, unknown>)[key] = (record[key] as number) + noise;
            } else {
              (anonymized as Record<string, unknown>)[key] = undefined;
            }
            break;
          default:
            (anonymized as Record<string, unknown>)[key] = undefined;
        }
        anonymizedFields++;
      }
    }

    return {
      anonymized,
      result: {
        originalFields: totalFields,
        anonymizedFields,
        technique,
        reversible: technique === 'pseudonymization',
      },
    };
  }

  /**
   * Anonymize text by replacing PII with generic labels
   */
  anonymizeText(text: string): { anonymized: string; piiCount: number } {
    const { redacted, detections } = this.redactPII(text, { includeNames: true });
    return { anonymized: redacted, piiCount: detections.length };
  }

  // ─── Audit Log ──────────────────────────────────────────────────────

  private logAudit(
    action: string,
    userId?: string,
    category?: DataCategory,
    details: string = ''
  ): void {
    if (!this.config.auditLogEnabled) return;

    const entry: PrivacyAuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      action,
      userId,
      category,
      details,
    };

    this.auditLog.push(entry);

    // Trim if over limit
    if (this.auditLog.length > this.config.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-Math.floor(this.config.maxAuditEntries * 0.75));
    }

    this.emit('audit:logged', { action });
  }

  /**
   * Get audit log entries with optional filtering
   */
  getAuditLog(options: {
    userId?: string;
    action?: string;
    category?: DataCategory;
    since?: number;
    limit?: number;
  } = {}): PrivacyAuditEntry[] {
    let entries = [...this.auditLog];

    if (options.userId) {
      entries = entries.filter(e => e.userId === options.userId);
    }
    if (options.action) {
      entries = entries.filter(e => e.action === options.action);
    }
    if (options.category) {
      entries = entries.filter(e => e.category === options.category);
    }
    if (options.since) {
      entries = entries.filter(e => e.timestamp >= options.since!);
    }

    entries.sort((a, b) => b.timestamp - a.timestamp);

    if (options.limit) {
      entries = entries.slice(0, options.limit);
    }

    return entries;
  }

  // ─── Compliance Reports ─────────────────────────────────────────────

  /**
   * Generate a full privacy compliance report
   */
  generateReport(regulation?: PrivacyRegulation): PrivacyReport {
    const reg = regulation ?? this.config.defaultRegulation;

    // Consent summary
    const consentSummary = this.getConsentSummary();
    const uniqueUsers = new Set(
      Array.from(this.consents.values()).map(c => c.userId)
    );

    // Retention summary
    const policies = this.getAllRetentionPolicies().filter(p => p.enabled);
    const expired = this.getExpiredCategories();

    // DSR summary
    const allDSRs = this.getAllDSRs();
    const completedDSRs = allDSRs.filter(r => r.status === 'completed' && r.completedAt);
    const avgCompletion = completedDSRs.length > 0
      ? completedDSRs.reduce((sum, r) => sum + (r.completedAt! - r.requestedAt), 0) /
        completedDSRs.length / 86400000
      : 0;

    // PII summary
    const piiByType: Record<string, number> = {};
    let totalPII = 0;
    for (const [type, count] of this.piiStats) {
      piiByType[type] = count;
      totalPII += count;
    }

    // Compliance score (simplified)
    let score = 100;
    const overdueCount = this.getOverdueDSRs().length;
    if (overdueCount > 0) score -= overdueCount * 10;
    if (expired.length > 0 && policies.some(p => p.autoDelete)) score -= 5;
    if (uniqueUsers.size > 0) {
      const grantedCount = Object.values(consentSummary)
        .reduce((sum, cat) => sum + cat.granted, 0);
      if (grantedCount === 0) score -= 20;
    }
    score = Math.max(0, Math.min(100, score));

    return {
      generatedAt: Date.now(),
      regulation: reg,
      consentSummary: {
        totalUsers: uniqueUsers.size,
        consentsByCategory: consentSummary,
      },
      retentionSummary: {
        activePolicies: policies.length,
        overdueCleanups: expired.length,
        dataCategories: policies.map(p => ({
          category: p.dataCategory,
          recordCount: 0, // Would be populated from actual data stores
          oldestRecord: undefined,
        })),
      },
      dsrSummary: {
        total: allDSRs.length,
        pending: allDSRs.filter(r => r.status === 'pending').length,
        completed: completedDSRs.length,
        averageCompletionDays: Math.round(avgCompletion * 10) / 10,
        overdue: overdueCount,
      },
      piiSummary: {
        totalDetections: totalPII,
        byType: piiByType,
        redactedCount: totalPII, // Simplified — would track separately
      },
      privacyZones: this.privacyZones.size,
      auditEntriesCount: this.auditLog.length,
      complianceScore: score,
    };
  }

  /**
   * Generate a voice-friendly privacy summary
   */
  generateVoiceSummary(): string {
    const report = this.generateReport();
    const parts: string[] = [];

    parts.push(`Privacy compliance score: ${report.complianceScore}%.`);

    if (report.dsrSummary.overdue > 0) {
      parts.push(`Warning: ${report.dsrSummary.overdue} overdue data subject requests need attention.`);
    }

    if (report.dsrSummary.pending > 0) {
      parts.push(`${report.dsrSummary.pending} data requests pending.`);
    }

    parts.push(`${report.privacyZones} privacy zones configured.`);
    parts.push(`${report.piiSummary.totalDetections} PII items detected and handled.`);

    return parts.join(' ');
  }

  // ─── Utility Methods ────────────────────────────────────────────────

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private camelToSnake(str: string): string {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase();
  }

  /**
   * Get engine statistics
   */
  getStats(): {
    totalConsents: number;
    activeConsents: number;
    retentionPolicies: number;
    privacyZones: number;
    activeZones: number;
    pendingDSRs: number;
    completedDSRs: number;
    overdueDSRs: number;
    auditEntries: number;
    piiDetections: number;
  } {
    const now = Date.now();
    const consents = Array.from(this.consents.values());
    const dsrs = Array.from(this.dsrRequests.values());

    return {
      totalConsents: consents.length,
      activeConsents: consents.filter(c =>
        c.status === 'granted' && (!c.expiresAt || c.expiresAt > now)
      ).length,
      retentionPolicies: this.retentionPolicies.size,
      privacyZones: this.privacyZones.size,
      activeZones: this.activeZones.size,
      pendingDSRs: dsrs.filter(r => r.status === 'pending').length,
      completedDSRs: dsrs.filter(r => r.status === 'completed').length,
      overdueDSRs: this.getOverdueDSRs().length,
      auditEntries: this.auditLog.length,
      piiDetections: Array.from(this.piiStats.values()).reduce((s, n) => s + n, 0),
    };
  }

  /**
   * Reset the engine (for testing)
   */
  reset(): void {
    this.consents.clear();
    this.privacyZones.clear();
    this.activeZones.clear();
    this.dsrRequests.clear();
    this.auditLog = [];
    this.piiStats.clear();
    this.deletionLog.clear();
    this.customPIIPatterns.clear();

    // Reload default retention policies
    this.retentionPolicies.clear();
    for (const policy of DEFAULT_RETENTION_POLICIES) {
      this.retentionPolicies.set(policy.id, { ...policy });
    }
  }
}
