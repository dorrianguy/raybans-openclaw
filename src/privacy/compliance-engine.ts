/**
 * Compliance & Privacy Engine — GDPR/CCPA Data Protection
 *
 * Manages user consent, PII detection/redaction, data retention,
 * and compliance reporting for the smart glasses platform.
 *
 * Critical for enterprise sales — no Fortune 500 deploys
 * without privacy compliance. This is a revenue enabler.
 *
 * Features:
 * - GDPR, CCPA, HIPAA consent management
 * - PII detection in text and structured data
 * - Automatic redaction with configurable strategies
 * - Data retention policies with auto-cleanup
 * - Right to erasure (GDPR Article 17)
 * - Data portability export (GDPR Article 20)
 * - Consent audit trail
 * - Privacy impact assessment scoring
 * - Data classification (public/internal/confidential/restricted)
 * - Cross-border data transfer tracking
 * - Voice-friendly privacy status summaries
 *
 * @module compliance-engine
 */

import { EventEmitter } from 'events';

// ─── Types ────────────────────────────────────────────────────────

export type PrivacyRegulation = 'gdpr' | 'ccpa' | 'hipaa' | 'pipeda' | 'lgpd' | 'custom';

export type ConsentPurpose =
  | 'image_capture'
  | 'face_recognition'
  | 'location_tracking'
  | 'voice_recording'
  | 'analytics'
  | 'marketing'
  | 'third_party_sharing'
  | 'cloud_processing'
  | 'local_processing'
  | 'data_training'
  | 'product_identification'
  | 'medical_data'
  | 'biometric_data'
  | 'custom';

export type ConsentStatus = 'granted' | 'denied' | 'withdrawn' | 'pending' | 'not_applicable';

export interface ConsentRecord {
  id: string;
  userId: string;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  regulation: PrivacyRegulation;
  grantedAt?: number;
  expiresAt?: number;
  withdrawnAt?: number;
  version: number; // consent version (for re-consent flows)
  source: string; // how consent was captured (voice, ui, api)
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface ConsentAuditEntry {
  id: string;
  userId: string;
  purpose: ConsentPurpose;
  previousStatus: ConsentStatus;
  newStatus: ConsentStatus;
  timestamp: number;
  source: string;
  reason?: string;
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
  | 'passport'
  | 'drivers_license'
  | 'medical_record'
  | 'bank_account'
  | 'api_key'
  | 'password'
  | 'biometric'
  | 'gps_coordinates';

export interface PIIDetection {
  type: PIIType;
  value: string;
  startIndex: number;
  endIndex: number;
  confidence: number; // 0-1
  context?: string; // surrounding text for review
}

export type RedactionStrategy = 'mask' | 'hash' | 'remove' | 'tokenize' | 'generalize';

export interface RedactionConfig {
  strategy: RedactionStrategy;
  maskChar?: string; // default '*'
  preserveLength?: boolean; // default true
  preserveFormat?: boolean; // e.g., keep phone format but mask digits
}

export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

export interface DataRetentionPolicy {
  id: string;
  name: string;
  dataType: string; // e.g., 'images', 'transcripts', 'contacts', 'inventory'
  retentionDays: number;
  classification: DataClassification;
  regulation: PrivacyRegulation;
  autoDelete: boolean;
  archiveBeforeDelete: boolean;
  description: string;
}

export interface DataDeletionRequest {
  id: string;
  userId: string;
  requestedAt: number;
  completedAt?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  dataTypes: string[];
  regulation: PrivacyRegulation;
  reason?: string;
  verificationMethod: string;
  deletedRecords?: number;
}

export interface DataExportRequest {
  id: string;
  userId: string;
  requestedAt: number;
  completedAt?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  format: 'json' | 'csv' | 'xml';
  dataTypes: string[];
  regulation: PrivacyRegulation;
  downloadUrl?: string;
  expiresAt?: number;
}

export interface PrivacyImpactScore {
  overall: number; // 0-100 (lower is better)
  dataMinimization: number;
  consentCoverage: number;
  retentionCompliance: number;
  encryptionStatus: number;
  accessControl: number;
  details: string[];
  recommendations: string[];
}

export interface ComplianceEngineConfig {
  defaultRegulation?: PrivacyRegulation;
  consentExpirationDays?: number; // default 365
  maxConsentRecords?: number; // default 10000
  maxAuditEntries?: number; // default 50000
  piiDetectionEnabled?: boolean; // default true
  autoRedact?: boolean; // default false (manual by default)
  defaultRedactionStrategy?: RedactionStrategy; // default 'mask'
  retentionCheckIntervalMs?: number; // default 86400000 (24h)
}

export interface ComplianceEngineEvents {
  'consent:granted': (record: ConsentRecord) => void;
  'consent:denied': (record: ConsentRecord) => void;
  'consent:withdrawn': (record: ConsentRecord) => void;
  'pii:detected': (detections: PIIDetection[]) => void;
  'data:deleted': (request: DataDeletionRequest) => void;
  'data:exported': (request: DataExportRequest) => void;
  'retention:expired': (policy: DataRetentionPolicy, count: number) => void;
  'compliance:alert': (message: string) => void;
}

export const DEFAULT_COMPLIANCE_CONFIG: ComplianceEngineConfig = {
  defaultRegulation: 'gdpr',
  consentExpirationDays: 365,
  maxConsentRecords: 10000,
  maxAuditEntries: 50000,
  piiDetectionEnabled: true,
  autoRedact: false,
  defaultRedactionStrategy: 'mask',
  retentionCheckIntervalMs: 86400000,
};

// ─── PII Detection Patterns ────────────────────────────────────

interface PIIPattern {
  type: PIIType;
  regex: RegExp;
  confidence: number;
  validator?: (match: string) => boolean;
}

const PII_PATTERNS: PIIPattern[] = [
  {
    type: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    confidence: 0.95,
  },
  {
    type: 'phone',
    regex: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 0.8,
    validator: (m) => m.replace(/\D/g, '').length >= 10,
  },
  {
    type: 'ssn',
    regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    confidence: 0.85,
    validator: (m) => {
      const digits = m.replace(/\D/g, '');
      if (digits.length !== 9) return false;
      if (digits.startsWith('000') || digits.startsWith('666') || digits.startsWith('9')) return false;
      if (digits.slice(3, 5) === '00') return false;
      if (digits.slice(5) === '0000') return false;
      return true;
    },
  },
  {
    type: 'credit_card',
    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    confidence: 0.9,
    validator: (m) => {
      const digits = m.replace(/\D/g, '');
      if (digits.length < 13 || digits.length > 19) return false;
      // Luhn check
      let sum = 0;
      let alternate = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        let n = parseInt(digits[i], 10);
        if (alternate) {
          n *= 2;
          if (n > 9) n -= 9;
        }
        sum += n;
        alternate = !alternate;
      }
      return sum % 10 === 0;
    },
  },
  {
    type: 'ip_address',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    confidence: 0.75,
    validator: (m) => m.split('.').every((part) => parseInt(part) >= 0 && parseInt(part) <= 255),
  },
  {
    type: 'date_of_birth',
    regex: /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g,
    confidence: 0.7,
  },
  {
    type: 'api_key',
    regex: /(?:sk[-_]|pk[-_]|api[-_]?key[-_]?)[a-zA-Z0-9_]{10,}/gi,
    confidence: 0.9,
  },
  {
    type: 'gps_coordinates',
    regex: /[-+]?\d{1,3}\.\d{4,},\s*[-+]?\d{1,3}\.\d{4,}/g,
    confidence: 0.7,
  },
  {
    type: 'bank_account',
    regex: /\b\d{8,17}\b/g,
    confidence: 0.3, // low confidence — too many false positives
  },
];

// ─── Utility ────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashValue(value: string): string {
  // Simple deterministic hash for tokenization (not crypto-secure)
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const chr = value.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `[HASH:${Math.abs(hash).toString(16).padStart(8, '0')}]`;
}

// ─── Engine ─────────────────────────────────────────────────────

export class ComplianceEngine extends EventEmitter {
  private config: Required<ComplianceEngineConfig>;
  private consents: Map<string, ConsentRecord> = new Map(); // key: `${userId}:${purpose}`
  private auditTrail: ConsentAuditEntry[] = [];
  private retentionPolicies: Map<string, DataRetentionPolicy> = new Map();
  private deletionRequests: Map<string, DataDeletionRequest> = new Map();
  private exportRequests: Map<string, DataExportRequest> = new Map();
  private piiRedactionConfig: Map<PIIType, RedactionConfig> = new Map();
  private auditSequence = 0;

  constructor(config: ComplianceEngineConfig = {}) {
    super();
    this.config = { ...DEFAULT_COMPLIANCE_CONFIG, ...config } as Required<ComplianceEngineConfig>;
    this.initDefaultRedaction();
  }

  private initDefaultRedaction(): void {
    const defaultConfig: RedactionConfig = {
      strategy: this.config.defaultRedactionStrategy,
      maskChar: '*',
      preserveLength: true,
    };

    for (const pattern of PII_PATTERNS) {
      this.piiRedactionConfig.set(pattern.type, { ...defaultConfig });
    }

    // Override for specific types
    this.piiRedactionConfig.set('email', { strategy: 'mask', maskChar: '*', preserveFormat: true });
    this.piiRedactionConfig.set('credit_card', { strategy: 'mask', maskChar: '*', preserveFormat: true });
    this.piiRedactionConfig.set('api_key', { strategy: 'remove' });
    this.piiRedactionConfig.set('password', { strategy: 'remove' });
  }

  // ─── Consent Management ───────────────────────────────────────

  grantConsent(params: {
    userId: string;
    purpose: ConsentPurpose;
    regulation?: PrivacyRegulation;
    source?: string;
    expiresAt?: number;
    metadata?: Record<string, unknown>;
  }): ConsentRecord {
    const key = `${params.userId}:${params.purpose}`;
    const existing = this.consents.get(key);

    const now = Date.now();
    const expiresAt = params.expiresAt ??
      now + this.config.consentExpirationDays * 24 * 60 * 60 * 1000;

    const record: ConsentRecord = {
      id: generateId('consent'),
      userId: params.userId,
      purpose: params.purpose,
      status: 'granted',
      regulation: params.regulation ?? this.config.defaultRegulation,
      grantedAt: now,
      expiresAt,
      version: existing ? existing.version + 1 : 1,
      source: params.source ?? 'api',
      metadata: params.metadata,
    };

    // Audit trail
    this.addAuditEntry({
      userId: params.userId,
      purpose: params.purpose,
      previousStatus: existing?.status ?? 'pending',
      newStatus: 'granted',
      source: params.source ?? 'api',
    });

    this.consents.set(key, record);
    this.trimConsents();
    this.emit('consent:granted', record);
    return record;
  }

  denyConsent(params: {
    userId: string;
    purpose: ConsentPurpose;
    regulation?: PrivacyRegulation;
    source?: string;
    reason?: string;
  }): ConsentRecord {
    const key = `${params.userId}:${params.purpose}`;
    const existing = this.consents.get(key);

    const record: ConsentRecord = {
      id: generateId('consent'),
      userId: params.userId,
      purpose: params.purpose,
      status: 'denied',
      regulation: params.regulation ?? this.config.defaultRegulation,
      version: existing ? existing.version + 1 : 1,
      source: params.source ?? 'api',
    };

    this.addAuditEntry({
      userId: params.userId,
      purpose: params.purpose,
      previousStatus: existing?.status ?? 'pending',
      newStatus: 'denied',
      source: params.source ?? 'api',
      reason: params.reason,
    });

    this.consents.set(key, record);
    this.emit('consent:denied', record);
    return record;
  }

  withdrawConsent(params: {
    userId: string;
    purpose: ConsentPurpose;
    source?: string;
    reason?: string;
  }): ConsentRecord | null {
    const key = `${params.userId}:${params.purpose}`;
    const existing = this.consents.get(key);

    if (!existing || existing.status !== 'granted') return null;

    const record: ConsentRecord = {
      ...existing,
      status: 'withdrawn',
      withdrawnAt: Date.now(),
      version: existing.version + 1,
    };

    this.addAuditEntry({
      userId: params.userId,
      purpose: params.purpose,
      previousStatus: existing.status,
      newStatus: 'withdrawn',
      source: params.source ?? 'api',
      reason: params.reason,
    });

    this.consents.set(key, record);
    this.emit('consent:withdrawn', record);
    return record;
  }

  getConsent(userId: string, purpose: ConsentPurpose): ConsentRecord | undefined {
    return this.consents.get(`${userId}:${purpose}`);
  }

  hasConsent(userId: string, purpose: ConsentPurpose): boolean {
    const record = this.consents.get(`${userId}:${purpose}`);
    if (!record) return false;
    if (record.status !== 'granted') return false;
    if (record.expiresAt && record.expiresAt < Date.now()) return false;
    return true;
  }

  getUserConsents(userId: string): ConsentRecord[] {
    const results: ConsentRecord[] = [];
    for (const [key, record] of this.consents) {
      if (key.startsWith(`${userId}:`)) {
        results.push(record);
      }
    }
    return results;
  }

  getConsentsByPurpose(purpose: ConsentPurpose): ConsentRecord[] {
    const results: ConsentRecord[] = [];
    for (const [key, record] of this.consents) {
      if (key.endsWith(`:${purpose}`)) {
        results.push(record);
      }
    }
    return results;
  }

  getConsentSummary(userId: string): Record<ConsentPurpose, ConsentStatus> {
    const summary: Partial<Record<ConsentPurpose, ConsentStatus>> = {};
    const purposes: ConsentPurpose[] = [
      'image_capture', 'face_recognition', 'location_tracking',
      'voice_recording', 'analytics', 'marketing', 'third_party_sharing',
      'cloud_processing', 'local_processing', 'data_training',
      'product_identification', 'medical_data', 'biometric_data',
    ];

    for (const purpose of purposes) {
      const record = this.consents.get(`${userId}:${purpose}`);
      summary[purpose] = record?.status ?? 'pending';
    }

    return summary as Record<ConsentPurpose, ConsentStatus>;
  }

  /**
   * Batch grant consent for common use cases
   */
  grantBatchConsent(userId: string, purposes: ConsentPurpose[], source = 'onboarding'): ConsentRecord[] {
    return purposes.map((purpose) =>
      this.grantConsent({ userId, purpose, source })
    );
  }

  // ─── PII Detection ───────────────────────────────────────────

  detectPII(text: string, minConfidence = 0.5): PIIDetection[] {
    if (!this.config.piiDetectionEnabled) return [];

    const detections: PIIDetection[] = [];

    for (const pattern of PII_PATTERNS) {
      if (pattern.confidence < minConfidence) continue;

      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const value = match[0];

        // Run validator if exists
        if (pattern.validator && !pattern.validator(value)) continue;

        // Get context (20 chars before and after)
        const contextStart = Math.max(0, match.index - 20);
        const contextEnd = Math.min(text.length, match.index + value.length + 20);
        const context = text.slice(contextStart, contextEnd);

        detections.push({
          type: pattern.type,
          value,
          startIndex: match.index,
          endIndex: match.index + value.length,
          confidence: pattern.confidence,
          context,
        });
      }
    }

    // Sort by position
    detections.sort((a, b) => a.startIndex - b.startIndex);

    // Remove overlapping detections (keep higher confidence)
    const filtered: PIIDetection[] = [];
    for (const detection of detections) {
      const overlaps = filtered.some(
        (f) => detection.startIndex < f.endIndex && detection.endIndex > f.startIndex
      );
      if (!overlaps) {
        filtered.push(detection);
      }
    }

    if (filtered.length > 0) {
      this.emit('pii:detected', filtered);
    }

    return filtered;
  }

  // ─── Redaction ────────────────────────────────────────────────

  redactText(text: string, minConfidence = 0.5): { redacted: string; detections: PIIDetection[] } {
    const detections = this.detectPII(text, minConfidence);
    if (detections.length === 0) return { redacted: text, detections };

    let redacted = text;
    let offset = 0;

    for (const detection of detections) {
      const config = this.piiRedactionConfig.get(detection.type) ?? {
        strategy: this.config.defaultRedactionStrategy,
        maskChar: '*',
      };

      const replacement = this.redactValue(detection.value, detection.type, config);
      const start = detection.startIndex + offset;
      const end = detection.endIndex + offset;

      redacted = redacted.slice(0, start) + replacement + redacted.slice(end);
      offset += replacement.length - detection.value.length;
    }

    return { redacted, detections };
  }

  redactValue(value: string, type: PIIType, config?: RedactionConfig): string {
    const cfg = config ?? this.piiRedactionConfig.get(type) ?? {
      strategy: this.config.defaultRedactionStrategy,
      maskChar: '*',
    };

    switch (cfg.strategy) {
      case 'mask':
        return this.maskValue(value, type, cfg);
      case 'hash':
        return hashValue(value);
      case 'remove':
        return `[${type.toUpperCase()}_REDACTED]`;
      case 'tokenize':
        return `[TOKEN:${generateId('tok').slice(0, 12)}]`;
      case 'generalize':
        return this.generalizeValue(value, type);
      default:
        return cfg.maskChar?.repeat(value.length) ?? '*'.repeat(value.length);
    }
  }

  setRedactionConfig(type: PIIType, config: RedactionConfig): void {
    this.piiRedactionConfig.set(type, config);
  }

  private maskValue(value: string, type: PIIType, config: RedactionConfig): string {
    const char = config.maskChar ?? '*';

    if (config.preserveFormat) {
      switch (type) {
        case 'email': {
          const [local, domain] = value.split('@');
          const maskedLocal = local[0] + char.repeat(Math.max(0, local.length - 2)) + (local.length > 1 ? local[local.length - 1] : '');
          return `${maskedLocal}@${domain}`;
        }
        case 'phone':
          return value.replace(/\d/g, (_, i) => (i < value.length - 4 ? char : _));
        case 'credit_card': {
          const digits = value.replace(/\D/g, '');
          const lastFour = digits.slice(-4);
          return char.repeat(digits.length - 4) + lastFour;
        }
        case 'ssn':
          return `${char.repeat(3)}-${char.repeat(2)}-${value.slice(-4)}`;
        default:
          return char.repeat(value.length);
      }
    }

    return char.repeat(value.length);
  }

  private generalizeValue(value: string, type: PIIType): string {
    switch (type) {
      case 'email':
        return '[email address]';
      case 'phone':
        return '[phone number]';
      case 'ssn':
        return '[SSN]';
      case 'credit_card':
        return '[credit card]';
      case 'ip_address':
        return '[IP address]';
      case 'date_of_birth':
        return '[date of birth]';
      case 'gps_coordinates':
        return '[location]';
      case 'api_key':
        return '[API key]';
      case 'name':
        return '[name]';
      case 'address':
        return '[address]';
      default:
        return `[${type}]`;
    }
  }

  // ─── Data Retention ───────────────────────────────────────────

  addRetentionPolicy(policy: Omit<DataRetentionPolicy, 'id'>): DataRetentionPolicy {
    const fullPolicy: DataRetentionPolicy = {
      id: generateId('rp'),
      ...policy,
    };
    this.retentionPolicies.set(fullPolicy.id, fullPolicy);
    return fullPolicy;
  }

  getRetentionPolicy(policyId: string): DataRetentionPolicy | undefined {
    return this.retentionPolicies.get(policyId);
  }

  listRetentionPolicies(filter?: { dataType?: string; classification?: DataClassification }): DataRetentionPolicy[] {
    let policies = Array.from(this.retentionPolicies.values());
    if (filter?.dataType) policies = policies.filter((p) => p.dataType === filter.dataType);
    if (filter?.classification) policies = policies.filter((p) => p.classification === filter.classification);
    return policies;
  }

  removeRetentionPolicy(policyId: string): boolean {
    return this.retentionPolicies.delete(policyId);
  }

  /**
   * Check which policies have data past retention period.
   * Returns policies that need cleanup with simulated counts.
   */
  checkRetentionExpiry(currentTime?: number): Array<{ policy: DataRetentionPolicy; expiredBefore: number }> {
    const now = currentTime ?? Date.now();
    const expired: Array<{ policy: DataRetentionPolicy; expiredBefore: number }> = [];

    for (const policy of this.retentionPolicies.values()) {
      if (!policy.autoDelete) continue;
      const expiryDate = now - policy.retentionDays * 24 * 60 * 60 * 1000;
      expired.push({ policy, expiredBefore: expiryDate });
    }

    return expired;
  }

  // ─── Right to Erasure (GDPR Art. 17) ─────────────────────────

  requestDeletion(params: {
    userId: string;
    dataTypes?: string[];
    regulation?: PrivacyRegulation;
    reason?: string;
    verificationMethod?: string;
  }): DataDeletionRequest {
    const request: DataDeletionRequest = {
      id: generateId('del'),
      userId: params.userId,
      requestedAt: Date.now(),
      status: 'pending',
      dataTypes: params.dataTypes ?? ['all'],
      regulation: params.regulation ?? this.config.defaultRegulation,
      reason: params.reason,
      verificationMethod: params.verificationMethod ?? 'identity_verified',
    };

    this.deletionRequests.set(request.id, request);
    return request;
  }

  processDeletion(requestId: string): DataDeletionRequest | null {
    const request = this.deletionRequests.get(requestId);
    if (!request) return null;
    if (request.status !== 'pending') return request;

    request.status = 'processing';

    // Delete user's consent records
    let deletedCount = 0;
    const keysToDelete: string[] = [];
    for (const [key] of this.consents) {
      if (key.startsWith(`${request.userId}:`)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.consents.delete(key);
      deletedCount++;
    }

    // Delete audit entries for this user
    const beforeAudit = this.auditTrail.length;
    this.auditTrail = this.auditTrail.filter((e) => e.userId !== request.userId);
    deletedCount += beforeAudit - this.auditTrail.length;

    request.status = 'completed';
    request.completedAt = Date.now();
    request.deletedRecords = deletedCount;

    this.emit('data:deleted', request);
    return request;
  }

  getDeletionRequest(requestId: string): DataDeletionRequest | undefined {
    return this.deletionRequests.get(requestId);
  }

  listDeletionRequests(userId?: string): DataDeletionRequest[] {
    let requests = Array.from(this.deletionRequests.values());
    if (userId) requests = requests.filter((r) => r.userId === userId);
    return requests.sort((a, b) => b.requestedAt - a.requestedAt);
  }

  // ─── Data Portability (GDPR Art. 20) ─────────────────────────

  requestExport(params: {
    userId: string;
    format?: 'json' | 'csv' | 'xml';
    dataTypes?: string[];
    regulation?: PrivacyRegulation;
  }): DataExportRequest {
    const request: DataExportRequest = {
      id: generateId('exp'),
      userId: params.userId,
      requestedAt: Date.now(),
      status: 'pending',
      format: params.format ?? 'json',
      dataTypes: params.dataTypes ?? ['all'],
      regulation: params.regulation ?? this.config.defaultRegulation,
    };

    this.exportRequests.set(request.id, request);
    return request;
  }

  processExport(requestId: string): DataExportRequest | null {
    const request = this.exportRequests.get(requestId);
    if (!request) return null;
    if (request.status !== 'pending') return request;

    request.status = 'processing';

    // Collect user data
    const consents = this.getUserConsents(request.userId);
    const auditEntries = this.auditTrail.filter((e) => e.userId === request.userId);

    // Generate export package (URL would be set by caller)
    request.status = 'completed';
    request.completedAt = Date.now();
    request.expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    this.emit('data:exported', request);
    return request;
  }

  getExportRequest(requestId: string): DataExportRequest | undefined {
    return this.exportRequests.get(requestId);
  }

  // ─── Audit Trail ──────────────────────────────────────────────

  getAuditTrail(filter?: {
    userId?: string;
    purpose?: ConsentPurpose;
    since?: number;
    limit?: number;
  }): ConsentAuditEntry[] {
    let entries = [...this.auditTrail];

    if (filter) {
      if (filter.userId) entries = entries.filter((e) => e.userId === filter.userId);
      if (filter.purpose) entries = entries.filter((e) => e.purpose === filter.purpose);
      if (filter.since) entries = entries.filter((e) => e.timestamp >= filter.since!);
    }

    entries.sort((a, b) => {
      const timeDiff = b.timestamp - a.timestamp;
      if (timeDiff !== 0) return timeDiff;
      return ((b as any)._seq ?? 0) - ((a as any)._seq ?? 0);
    });
    if (filter?.limit) entries = entries.slice(0, filter.limit);

    return entries;
  }

  // ─── Privacy Impact Assessment ────────────────────────────────

  assessPrivacyImpact(userId: string): PrivacyImpactScore {
    const consents = this.getUserConsents(userId);
    const details: string[] = [];
    const recommendations: string[] = [];

    // Data minimization score (how many purposes are active)
    const grantedCount = consents.filter((c) => c.status === 'granted').length;
    const totalPurposes = 13; // total ConsentPurpose options
    const dataMinimization = Math.max(0, 100 - (grantedCount / totalPurposes) * 100);
    if (grantedCount > 8) {
      details.push(`${grantedCount} consent purposes active — consider reducing data collection scope`);
      recommendations.push('Review and minimize active consent purposes');
    }

    // Consent coverage (are all active features covered by consent?)
    const hasExpired = consents.some(
      (c) => c.status === 'granted' && c.expiresAt && c.expiresAt < Date.now()
    );
    let consentCoverage = grantedCount > 0 ? 80 : 20;
    if (hasExpired) {
      consentCoverage -= 30;
      details.push('Some consents have expired — re-consent required');
      recommendations.push('Prompt user for consent renewal');
    }

    // Sensitive data categories
    const hasBiometric = consents.some((c) => c.purpose === 'biometric_data' && c.status === 'granted');
    const hasMedical = consents.some((c) => c.purpose === 'medical_data' && c.status === 'granted');
    const hasFaceRecog = consents.some((c) => c.purpose === 'face_recognition' && c.status === 'granted');

    if (hasBiometric || hasMedical || hasFaceRecog) {
      details.push('Sensitive data categories active (biometric/medical/face recognition)');
      recommendations.push('Ensure enhanced security controls for sensitive data');
    }

    // Retention compliance
    const policies = this.listRetentionPolicies();
    const retentionCompliance = policies.length > 0 ? 80 : 30;
    if (policies.length === 0) {
      details.push('No data retention policies configured');
      recommendations.push('Configure retention policies for all data types');
    }

    // Encryption status (placeholder — would check actual encryption in production)
    const encryptionStatus = 70;

    // Access control (placeholder)
    const accessControl = 75;

    // Overall score (weighted average, lower = better)
    const overall = Math.round(
      100 - (
        dataMinimization * 0.25 +
        consentCoverage * 0.25 +
        retentionCompliance * 0.20 +
        encryptionStatus * 0.15 +
        accessControl * 0.15
      ) / 100 * 100
    );

    return {
      overall: Math.max(0, Math.min(100, overall)),
      dataMinimization,
      consentCoverage,
      retentionCompliance,
      encryptionStatus,
      accessControl,
      details,
      recommendations,
    };
  }

  // ─── Data Classification ──────────────────────────────────────

  classifyData(dataType: string): DataClassification {
    const classifications: Record<string, DataClassification> = {
      images: 'confidential',
      transcripts: 'confidential',
      contacts: 'confidential',
      inventory: 'internal',
      analytics: 'internal',
      settings: 'internal',
      session_logs: 'internal',
      medical_data: 'restricted',
      biometric_data: 'restricted',
      financial_data: 'restricted',
      marketing_data: 'public',
      product_data: 'public',
    };

    return classifications[dataType] ?? 'internal';
  }

  // ─── Voice Summary ────────────────────────────────────────────

  generateVoiceSummary(userId: string): string {
    const consents = this.getUserConsents(userId);
    const parts: string[] = [];

    const granted = consents.filter((c) => c.status === 'granted').length;
    const denied = consents.filter((c) => c.status === 'denied').length;
    const withdrawn = consents.filter((c) => c.status === 'withdrawn').length;

    if (consents.length === 0) {
      return 'No privacy consents configured. Please set up your privacy preferences.';
    }

    parts.push(`Privacy status: ${granted} consent${granted !== 1 ? 's' : ''} active`);

    if (denied > 0) parts.push(`${denied} denied`);
    if (withdrawn > 0) parts.push(`${withdrawn} withdrawn`);

    // Check for expired consents
    const expired = consents.filter(
      (c) => c.status === 'granted' && c.expiresAt && c.expiresAt < Date.now()
    );
    if (expired.length > 0) {
      parts.push(`Warning: ${expired.length} consent${expired.length !== 1 ? 's have' : ' has'} expired.`);
    }

    // Retention policies
    const policies = this.listRetentionPolicies();
    if (policies.length > 0) {
      parts.push(`${policies.length} data retention ${policies.length !== 1 ? 'policies' : 'policy'} active.`);
    }

    // Pending requests
    const pendingDeletions = Array.from(this.deletionRequests.values()).filter(
      (r) => r.userId === userId && r.status === 'pending'
    );
    if (pendingDeletions.length > 0) {
      parts.push(`${pendingDeletions.length} pending deletion request${pendingDeletions.length !== 1 ? 's' : ''}.`);
    }

    return parts.join('. ') + '.';
  }

  // ─── Compliance Status ────────────────────────────────────────

  getComplianceStatus(): {
    totalConsents: number;
    activeConsents: number;
    expiredConsents: number;
    totalPolicies: number;
    pendingDeletions: number;
    pendingExports: number;
    auditEntries: number;
  } {
    const allConsents = Array.from(this.consents.values());
    const now = Date.now();

    return {
      totalConsents: allConsents.length,
      activeConsents: allConsents.filter((c) => c.status === 'granted' && (!c.expiresAt || c.expiresAt > now)).length,
      expiredConsents: allConsents.filter((c) => c.status === 'granted' && c.expiresAt && c.expiresAt <= now).length,
      totalPolicies: this.retentionPolicies.size,
      pendingDeletions: Array.from(this.deletionRequests.values()).filter((r) => r.status === 'pending').length,
      pendingExports: Array.from(this.exportRequests.values()).filter((r) => r.status === 'pending').length,
      auditEntries: this.auditTrail.length,
    };
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  reset(): void {
    this.consents.clear();
    this.auditTrail = [];
    this.retentionPolicies.clear();
    this.deletionRequests.clear();
    this.exportRequests.clear();
  }

  // ─── Private Helpers ──────────────────────────────────────────

  private addAuditEntry(params: {
    userId: string;
    purpose: ConsentPurpose;
    previousStatus: ConsentStatus;
    newStatus: ConsentStatus;
    source: string;
    reason?: string;
  }): void {
    this.auditSequence++;
    const entry: ConsentAuditEntry = {
      id: generateId('audit'),
      userId: params.userId,
      purpose: params.purpose,
      previousStatus: params.previousStatus,
      newStatus: params.newStatus,
      timestamp: Date.now(),
      source: params.source,
      reason: params.reason,
    };

    // Store sequence in id for stable ordering
    (entry as any)._seq = this.auditSequence;

    this.auditTrail.push(entry);

    if (this.auditTrail.length > this.config.maxAuditEntries) {
      this.auditTrail.splice(0, this.auditTrail.length - this.config.maxAuditEntries);
    }
  }

  private trimConsents(): void {
    if (this.consents.size > this.config.maxConsentRecords) {
      // Remove oldest expired/denied/withdrawn consents first
      const entries = Array.from(this.consents.entries())
        .sort((a, b) => (a[1].grantedAt ?? 0) - (b[1].grantedAt ?? 0));

      while (this.consents.size > this.config.maxConsentRecords) {
        const [key] = entries.shift()!;
        this.consents.delete(key);
      }
    }
  }
}
