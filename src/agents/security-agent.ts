/**
 * Security Agent — Passive threat detection and situational awareness.
 *
 * Scans your environment for digital and physical security risks:
 * - QR code decode + URL reputation analysis
 * - ATM/payment terminal anomaly detection
 * - Document/contract clause risk flagging
 * - Phishing email/text detection on screens
 * - Wi-Fi network spoofing detection
 * - USB drop / suspicious device identification
 *
 * Operates in two modes:
 * 1. **Passive** — runs on every auto-snap, flags HIGH/CRITICAL silently
 * 2. **Active** — triggered by "Is this safe?" voice command for deep scan
 *
 * Alert levels:
 * - CRITICAL → immediate TTS alert
 * - HIGH → TTS alert within 5 seconds
 * - MEDIUM → logged, available via voice query
 * - LOW → logged silently
 *
 * Revenue: Core platform safety feature. Enterprise tier adds compliance
 * reporting and API integration. Powers "Situational Awareness" feature.
 *
 * Usage:
 *   const agent = new SecurityAgent({ ... });
 *   const result = await agent.scanForThreats(image, analysis);
 *   // → { level: 'HIGH', threats: [{ type: 'phishing_qr', ... }] }
 */

import { EventEmitter } from 'eventemitter3';
import type {
  CapturedImage,
  VisionAnalysis,
  ExtractedText,
  DecodedBarcode,
  PipelineResult,
} from '../types.js';
import type { RoutingContext, AgentResponse } from '../routing/context-router.js';

// ─── Types ──────────────────────────────────────────────────────

export type ThreatLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

export type ThreatCategory =
  | 'phishing_qr'          // QR code pointing to phishing site
  | 'malicious_url'        // URL with known bad reputation
  | 'suspicious_redirect'  // URL with excessive redirects
  | 'atm_skimmer'          // Modified ATM/payment terminal
  | 'suspicious_device'    // USB drop, hidden camera, etc.
  | 'phishing_screen'      // Phishing email/text visible on screen
  | 'wifi_spoofing'        // Fake Wi-Fi network
  | 'contract_risk'        // Risky clause in contract/document
  | 'hidden_fee'           // Hidden fees in fine print
  | 'auto_renewal'         // Auto-renewal trap
  | 'non_compete'          // Non-compete clause
  | 'data_exposure'        // Sensitive data visible (passwords, keys)
  | 'shoulder_surfing'     // Screen visible to others in public
  | 'fake_credential'      // Fake badge or ID
  | 'expired_cert'         // Expired safety/security certificate
  | 'physical_anomaly';    // Physical security concern

export interface ThreatDetection {
  /** Unique detection ID */
  id: string;
  /** What kind of threat */
  category: ThreatCategory;
  /** Severity level */
  level: ThreatLevel;
  /** Human-readable description */
  description: string;
  /** Specific evidence found */
  evidence: string;
  /** Recommended action */
  recommendation: string;
  /** Confidence in the detection 0-1 */
  confidence: number;
  /** Source data (URL, text, etc.) */
  sourceData?: string;
  /** When detected */
  detectedAt: string;
  /** Image that triggered the detection */
  imageId: string;
}

export interface SecurityScanResult {
  /** Overall threat level (highest of all detections) */
  overallLevel: ThreatLevel;
  /** Individual threat detections */
  threats: ThreatDetection[];
  /** QR codes decoded and analyzed */
  qrAnalysis: QRAnalysis[];
  /** URLs found and checked */
  urlChecks: URLCheck[];
  /** Document clauses flagged */
  documentFlags: DocumentFlag[];
  /** Processing time */
  processingTimeMs: number;
  /** Whether TTS alert should fire */
  requiresAlert: boolean;
  /** TTS alert text (if requiresAlert) */
  alertText?: string;
}

export interface QRAnalysis {
  /** Raw QR data */
  rawData: string;
  /** Decoded URL (if it's a URL) */
  url?: string;
  /** Is it a URL? */
  isUrl: boolean;
  /** Domain extracted */
  domain?: string;
  /** Domain age in days (if known) */
  domainAgeDays?: number;
  /** Has valid SSL? */
  hasSSL?: boolean;
  /** Number of redirects */
  redirectCount: number;
  /** Final destination URL (after redirects) */
  finalUrl?: string;
  /** Is it on a known phishing list? */
  isKnownPhishing: boolean;
  /** Is it a URL shortener? */
  isShortener: boolean;
  /** Risk score 0-1 */
  riskScore: number;
  /** Risk explanation */
  riskExplanation: string;
}

export interface URLCheck {
  /** The URL analyzed */
  url: string;
  /** Domain */
  domain: string;
  /** Is the domain suspicious? */
  isSuspicious: boolean;
  /** Reasons for suspicion */
  suspicionReasons: string[];
  /** Risk score 0-1 */
  riskScore: number;
}

export interface DocumentFlag {
  /** The flagged clause/text */
  text: string;
  /** What type of concern */
  flagType: 'hidden_fee' | 'auto_renewal' | 'non_compete' | 'liability_waiver' |
    'arbitration' | 'data_collection' | 'cancellation_penalty' | 'price_escalation' |
    'intellectual_property' | 'termination_clause' | 'other';
  /** Severity */
  severity: 'high' | 'medium' | 'low';
  /** Plain-English explanation */
  explanation: string;
  /** What to watch out for */
  advice: string;
}

export interface SecurityAgentConfig {
  /** Enable passive scanning (runs on auto-snaps) */
  passiveScanEnabled: boolean;
  /** Minimum threat level to trigger TTS alert */
  alertThreshold: ThreatLevel;
  /** Enable QR code analysis */
  qrAnalysisEnabled: boolean;
  /** Enable URL reputation checking */
  urlCheckEnabled: boolean;
  /** Enable document/contract analysis */
  documentAnalysisEnabled: boolean;
  /** Enable physical security scanning */
  physicalScanEnabled: boolean;
  /** Known safe domains (won't trigger alerts) */
  trustedDomains: string[];
  /** Known Wi-Fi networks (won't trigger spoofing alerts) */
  trustedNetworks: string[];
  /** Custom web research function */
  webSearch?: (query: string) => Promise<string[]>;
  /** Maximum scan history to keep */
  maxHistory: number;
}

export const DEFAULT_SECURITY_CONFIG: SecurityAgentConfig = {
  passiveScanEnabled: true,
  alertThreshold: 'high',
  qrAnalysisEnabled: true,
  urlCheckEnabled: true,
  documentAnalysisEnabled: true,
  physicalScanEnabled: true,
  trustedDomains: [],
  trustedNetworks: [],
  maxHistory: 500,
};

export interface SecurityAgentEvents {
  'threat:detected': (threat: ThreatDetection) => void;
  'threat:critical': (threat: ThreatDetection) => void;
  'scan:complete': (result: SecurityScanResult) => void;
  'qr:decoded': (analysis: QRAnalysis) => void;
  'document:flagged': (flags: DocumentFlag[]) => void;
}

// ─── Known Patterns ─────────────────────────────────────────────

/** Common URL shortener domains */
const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd',
  'buff.ly', 'adf.ly', 'bl.ink', 'lnkd.in', 'db.tt', 'qr.ae',
  'rebrand.ly', 'shorturl.at', 'cutt.ly', 'rb.gy', 'v.gd',
]);

/** Suspicious TLD patterns */
const SUSPICIOUS_TLDS = new Set([
  '.xyz', '.top', '.club', '.wang', '.win', '.bid', '.stream',
  '.gdn', '.racing', '.loan', '.download', '.review', '.science',
  '.party', '.click', '.link', '.work', '.date', '.faith',
  '.cricket', '.accountant', '.trade', '.webcam',
]);

/** Domains known to be safe — skip phishing checks */
const KNOWN_SAFE_DOMAINS = new Set([
  'google.com', 'www.google.com', 'docs.google.com', 'maps.google.com',
  'paypal.com', 'www.paypal.com',
  'apple.com', 'www.apple.com',
  'microsoft.com', 'www.microsoft.com',
  'amazon.com', 'www.amazon.com',
  'netflix.com', 'www.netflix.com',
  'facebook.com', 'www.facebook.com',
  'github.com', 'www.github.com',
]);

/** Known phishing patterns in URLs — applied to hostname only */
const PHISHING_DOMAIN_PATTERNS = [
  /paypal/i,
  /apple/i,
  /microsoft/i,
  /google/i,
  /amazon/i,
  /netflix/i,
  /facebook/i,
];

/** Known phishing patterns in URLs — applied to full URL */
const PHISHING_URL_PATTERNS = [
  /bank.*login/i,
  /secure.*update.*account/i,
  /verify.*identity/i,
  /suspended.*account/i,
  /confirm.*password/i,
  /\.php\?.*(?:id|user|pass|login)=/i,
];

/** Contract clause risk patterns */
const CONTRACT_RISK_PATTERNS: Array<{
  pattern: RegExp;
  flagType: DocumentFlag['flagType'];
  severity: DocumentFlag['severity'];
  explanation: string;
  advice: string;
}> = [
  {
    pattern: /auto[- ]?renew(?:al|s|ing)?/i,
    flagType: 'auto_renewal',
    severity: 'high',
    explanation: 'This agreement automatically renews unless you cancel within a specific window.',
    advice: 'Set a calendar reminder to cancel before the renewal deadline if you don\'t want to continue.',
  },
  {
    pattern: /non[- ]?compete|non[- ]?competition|covenant not to compete/i,
    flagType: 'non_compete',
    severity: 'high',
    explanation: 'This clause restricts your ability to work in similar roles or industries after leaving.',
    advice: 'Check the duration, geographic scope, and industry scope. Negotiate narrower terms if possible.',
  },
  {
    pattern: /(?:hidden|additional|processing|convenience|service)\s+fee/i,
    flagType: 'hidden_fee',
    severity: 'medium',
    explanation: 'Additional fees beyond the stated price may apply.',
    advice: 'Calculate the total cost including all fees before committing.',
  },
  {
    pattern: /binding\s+arbitration|waive.*(?:right|class action)|mandatory\s+arbitration/i,
    flagType: 'arbitration',
    severity: 'medium',
    explanation: 'You waive your right to sue or join a class action. Disputes go to private arbitration.',
    advice: 'This limits your legal options. Consider whether this is acceptable for the value provided.',
  },
  {
    pattern: /(?:early\s+)?(?:termination|cancellation)\s+(?:fee|penalty|charge)/i,
    flagType: 'cancellation_penalty',
    severity: 'high',
    explanation: 'You may owe money if you cancel or terminate early.',
    advice: 'Check the exact penalty amount and when it applies. Ask if it can be waived or reduced.',
  },
  {
    pattern: /(?:liability|indemnif|hold\s+harmless).*(?:waiv|releas|disclaim)/i,
    flagType: 'liability_waiver',
    severity: 'medium',
    explanation: 'You may be releasing the other party from liability for damages or losses.',
    advice: 'Understand what risks you\'re assuming. Ensure you have adequate insurance if needed.',
  },
  {
    pattern: /(?:collect|share|sell|transfer).*(?:personal|data|information|usage)/i,
    flagType: 'data_collection',
    severity: 'medium',
    explanation: 'Your personal data may be collected, shared, or sold.',
    advice: 'Review what data is collected and with whom it\'s shared. Check opt-out options.',
  },
  {
    pattern: /(?:price|rate).*(?:increase|adjust|change|escalat)|(?:increase|adjust|change|escalat).*(?:price|rate)/i,
    flagType: 'price_escalation',
    severity: 'medium',
    explanation: 'Prices may increase during the contract period.',
    advice: 'Look for caps on increases and whether you can cancel if prices rise beyond your budget.',
  },
  {
    pattern: /(?:(?:intellectual\s+property|copyright|patent|trademark).*(?:assign|transfer|grant|license)|(?:assign|transfer|grant|license).*(?:intellectual\s+property|copyright|patent|trademark))/i,
    flagType: 'intellectual_property',
    severity: 'high',
    explanation: 'You may be transferring IP rights or granting a broad license to your work.',
    advice: 'Carefully review what rights you\'re giving up. Consider whether the scope is appropriate.',
  },
  {
    pattern: /terminat(?:e|ion).*(?:without cause|at any time|sole discretion|for any reason)/i,
    flagType: 'termination_clause',
    severity: 'medium',
    explanation: 'The other party can terminate the agreement without needing a specific reason.',
    advice: 'Check what happens to your obligations, payments, and data if they terminate.',
  },
];

/** Phishing email/message patterns in on-screen text */
const PHISHING_SCREEN_PATTERNS = [
  /your\s+account\s+(?:has\s+been|will\s+be)\s+(?:suspended|locked|deactivated|disabled)/i,
  /verify\s+your\s+(?:identity|account|email)\s+(?:immediately|now|within\s+\d)/i,
  /unusual\s+(?:activity|sign[- ]?in|login)\s+(?:detected|attempt)/i,
  /click\s+(?:here|below|the\s+link)\s+(?:to\s+(?:verify|confirm|unlock|restore))/i,
  /(?:you|your)\s+(?:(?:\w+\s+){0,4})(?:won|winner|selected|chosen).*?(?:\$|prize|gift|reward|winner)/i,
  /(?:urgent|immediate|action\s+required).*(?:password|account|billing)/i,
  /wire\s+transfer|western\s+union|money\s+gram|gift\s+card\s+(?:payment|code)/i,
  /(?:irs|tax|refund).*(?:claim|verify|pending)/i,
  /(?:nigerian|prince|inheritance|beneficiary).*(?:million|fortune|estate)/i,
];

/** Sensitive data patterns that shouldn't be visible */
const SENSITIVE_DATA_PATTERNS = [
  { pattern: /(?:api[_ ]?key|secret[_ ]?key|access[_ ]?token)\s*[:=]\s*\S+/i, type: 'API key' },
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S+/i, type: 'password' },
  { pattern: /(?:ssh-(?:rsa|ed25519|ecdsa)|BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY)/i, type: 'SSH key' },
  { pattern: /\b(?:sk|pk)[-_](?:live|test)[-_][a-zA-Z0-9]{24,}\b/i, type: 'Stripe key' },
  { pattern: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/, type: 'AWS access key' },
  { pattern: /\bghp_[a-zA-Z0-9]{30,}\b/, type: 'GitHub token' },
  { pattern: /\b\d{3}[-. ]?\d{2}[-. ]?\d{4}\b/, type: 'SSN (possible)' },
];

// ─── Security Agent ─────────────────────────────────────────────

export class SecurityAgent extends EventEmitter<SecurityAgentEvents> {
  private config: SecurityAgentConfig;
  private scanHistory: SecurityScanResult[] = [];
  private threatHistory: ThreatDetection[] = [];
  private threatIdCounter = 0;

  constructor(config: Partial<SecurityAgentConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config };
  }

  // ─── Main Entry (SpecialistAgent interface) ─────────────────

  /**
   * Handle an image routed by the Context Router.
   */
  async handle(
    image: CapturedImage,
    analysis: VisionAnalysis,
    context: RoutingContext,
  ): Promise<AgentResponse> {
    const isActiveScan = context.trigger === 'voice' &&
      (context.voiceIntent === 'what_is_this' || context.voiceIntent === 'status_report');

    const result = await this.scanForThreats(image, analysis, isActiveScan);

    return {
      agentId: 'security',
      agentName: 'Security Agent',
      success: true,
      data: result,
      summary: this.buildSummary(result),
      ttsText: result.alertText || (result.threats.length > 0
        ? this.buildBriefAlert(result)
        : undefined),
      priority: this.levelToPriority(result.overallLevel),
    };
  }

  // ─── Core Scanning ────────────────────────────────────────────

  /**
   * Full threat scan of an image and its analysis.
   */
  async scanForThreats(
    image: CapturedImage,
    analysis: VisionAnalysis,
    deepScan = false,
  ): Promise<SecurityScanResult> {
    const startTime = Date.now();
    const threats: ThreatDetection[] = [];
    const qrAnalysis: QRAnalysis[] = [];
    const urlChecks: URLCheck[] = [];
    const documentFlags: DocumentFlag[] = [];

    // 1. QR code analysis
    if (this.config.qrAnalysisEnabled) {
      const qrResults = this.analyzeQRCodes(analysis.barcodes || [], image.id);
      qrAnalysis.push(...qrResults.analyses);
      threats.push(...qrResults.threats);
    }

    // 2. URL analysis from extracted text
    if (this.config.urlCheckEnabled) {
      const urlResults = this.analyzeURLsInText(analysis.extractedText || [], image.id);
      urlChecks.push(...urlResults.checks);
      threats.push(...urlResults.threats);
    }

    // 3. Document/contract analysis
    if (this.config.documentAnalysisEnabled && this.isDocumentScene(analysis)) {
      const docResults = this.analyzeDocument(analysis.extractedText || [], image.id);
      documentFlags.push(...docResults.flags);
      threats.push(...docResults.threats);
    }

    // 4. Phishing screen detection
    const phishingResults = this.detectPhishingOnScreen(analysis.extractedText || [], image.id);
    threats.push(...phishingResults);

    // 5. Sensitive data exposure
    const sensitiveResults = this.detectSensitiveData(analysis.extractedText || [], image.id);
    threats.push(...sensitiveResults);

    // 6. Physical security (deep scan only or active mode)
    if (deepScan && this.config.physicalScanEnabled) {
      const physicalResults = this.analyzePhysicalSecurity(analysis, image.id);
      threats.push(...physicalResults);
    }

    // Determine overall level
    const overallLevel = this.getHighestThreatLevel(threats);

    // Determine if alert is needed
    const requiresAlert = this.shouldAlert(overallLevel);
    const alertText = requiresAlert ? this.buildAlertText(threats) : undefined;

    const result: SecurityScanResult = {
      overallLevel,
      threats,
      qrAnalysis,
      urlChecks,
      documentFlags,
      processingTimeMs: Date.now() - startTime,
      requiresAlert,
      alertText,
    };

    // Store history
    this.addToHistory(result);
    threats.forEach(t => {
      this.threatHistory.push(t);
      this.emit('threat:detected', t);
      if (t.level === 'critical') {
        this.emit('threat:critical', t);
      }
    });

    if (documentFlags.length > 0) {
      this.emit('document:flagged', documentFlags);
    }

    this.emit('scan:complete', result);

    return result;
  }

  // ─── QR Code Analysis ────────────────────────────────────────

  /**
   * Analyze QR codes for malicious content.
   */
  analyzeQRCodes(
    barcodes: VisionAnalysis['barcodes'],
    imageId: string,
  ): { analyses: QRAnalysis[]; threats: ThreatDetection[] } {
    const analyses: QRAnalysis[] = [];
    const threats: ThreatDetection[] = [];

    const qrCodes = barcodes.filter(b => b.format === 'QR' || b.format === 'DataMatrix');

    for (const qr of qrCodes) {
      const analysis = this.analyzeQRData(qr.data);
      analyses.push(analysis);

      this.emit('qr:decoded', analysis);

      if (analysis.riskScore > 0.7) {
        threats.push(this.createThreat({
          category: analysis.isKnownPhishing ? 'phishing_qr' : 'malicious_url',
          level: analysis.riskScore > 0.85 ? 'critical' : 'high',
          description: `Suspicious QR code detected: ${analysis.riskExplanation}`,
          evidence: `QR data: ${qr.data.substring(0, 100)}`,
          recommendation: `Do NOT scan this QR code. ${analysis.isKnownPhishing ? 'It leads to a known phishing site.' : 'The destination URL is suspicious.'}`,
          confidence: Math.min(analysis.riskScore + 0.1, 1),
          sourceData: qr.data,
          imageId,
        }));
      } else if (analysis.riskScore > 0.4) {
        threats.push(this.createThreat({
          category: 'suspicious_redirect',
          level: 'medium',
          description: `QR code with moderate risk: ${analysis.riskExplanation}`,
          evidence: `QR data: ${qr.data.substring(0, 100)}`,
          recommendation: 'Proceed with caution. Verify the destination before entering any information.',
          confidence: analysis.riskScore,
          sourceData: qr.data,
          imageId,
        }));
      }
    }

    return { analyses, threats };
  }

  /**
   * Analyze raw QR data for risk factors.
   */
  analyzeQRData(data: string): QRAnalysis {
    const result: QRAnalysis = {
      rawData: data,
      isUrl: false,
      redirectCount: 0,
      isKnownPhishing: false,
      isShortener: false,
      riskScore: 0,
      riskExplanation: 'No issues found',
    };

    // Check if it's a URL
    const urlMatch = data.match(/^https?:\/\/.+/i);
    if (!urlMatch) {
      // Non-URL QR codes are generally safe
      result.riskExplanation = 'Non-URL QR code — data content only';
      return result;
    }

    result.isUrl = true;
    result.url = data;

    try {
      const url = new URL(data);
      result.domain = url.hostname;

      let riskFactors: string[] = [];
      let riskScore = 0;

      // Check trusted domains
      if (this.config.trustedDomains.some(d => url.hostname.endsWith(d))) {
        result.riskScore = 0;
        result.riskExplanation = 'Trusted domain';
        return result;
      }

      // No SSL
      if (url.protocol === 'http:') {
        riskScore += 0.3;
        riskFactors.push('no HTTPS');
        result.hasSSL = false;
      } else {
        result.hasSSL = true;
      }

      // URL shortener
      if (URL_SHORTENERS.has(url.hostname)) {
        riskScore += 0.25;
        riskFactors.push('URL shortener (destination hidden)');
        result.isShortener = true;
      }

      // Suspicious TLD
      const tld = '.' + url.hostname.split('.').pop();
      if (SUSPICIOUS_TLDS.has(tld)) {
        riskScore += 0.35;
        riskFactors.push(`suspicious TLD (${tld})`);
      }

      // Known safe domains — skip phishing checks
      if (KNOWN_SAFE_DOMAINS.has(url.hostname) ||
          KNOWN_SAFE_DOMAINS.has(url.hostname.replace(/^www\./, ''))) {
        result.riskScore = Math.min(riskScore, 1);
        result.riskExplanation = riskFactors.length > 0
          ? riskFactors.join('; ')
          : 'Known safe domain';
        return result;
      }

      // Domain phishing patterns (brand impersonation)
      for (const pattern of PHISHING_DOMAIN_PATTERNS) {
        if (pattern.test(url.hostname)) {
          riskScore += 0.5;
          riskFactors.push('domain impersonates a known brand');
          result.isKnownPhishing = true;
          break;
        }
      }

      // Full URL phishing patterns
      if (!result.isKnownPhishing) {
        for (const pattern of PHISHING_URL_PATTERNS) {
          if (pattern.test(data)) {
            riskScore += 0.5;
            riskFactors.push('matches known phishing pattern');
            result.isKnownPhishing = true;
            break;
          }
        }
      }

      // IP address instead of domain
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname)) {
        riskScore += 0.4;
        riskFactors.push('IP address instead of domain name');
      }

      // Excessive subdomains
      const subdomainCount = url.hostname.split('.').length - 2;
      if (subdomainCount > 3) {
        riskScore += 0.2;
        riskFactors.push(`excessive subdomains (${subdomainCount})`);
      }

      // Long path with suspicious params
      if (url.search.length > 200) {
        riskScore += 0.15;
        riskFactors.push('excessively long URL parameters');
      }

      // Homograph attack indicators (mixed scripts in domain)
      if (/xn--/.test(url.hostname)) {
        riskScore += 0.3;
        riskFactors.push('internationalized domain name (possible homograph attack)');
      }

      result.riskScore = Math.min(riskScore, 1);
      result.riskExplanation = riskFactors.length > 0
        ? riskFactors.join('; ')
        : 'No issues found';

    } catch {
      result.riskScore = 0.5;
      result.riskExplanation = 'Invalid URL format';
    }

    return result;
  }

  // ─── URL Analysis ─────────────────────────────────────────────

  /**
   * Analyze URLs found in extracted text.
   */
  analyzeURLsInText(
    texts: ExtractedText[],
    imageId: string,
  ): { checks: URLCheck[]; threats: ThreatDetection[] } {
    const checks: URLCheck[] = [];
    const threats: ThreatDetection[] = [];
    const urlRegex = /https?:\/\/[^\s<>"']+/gi;

    for (const textEntry of texts) {
      const urls = textEntry.text.match(urlRegex) || [];
      for (const url of urls) {
        const check = this.checkURL(url);
        checks.push(check);

        if (check.riskScore > 0.6) {
          threats.push(this.createThreat({
            category: 'malicious_url',
            level: check.riskScore > 0.8 ? 'high' : 'medium',
            description: `Suspicious URL detected: ${check.suspicionReasons.join(', ')}`,
            evidence: `URL: ${url.substring(0, 100)}`,
            recommendation: 'Do not visit this URL. It shows signs of being malicious.',
            confidence: check.riskScore,
            sourceData: url,
            imageId,
          }));
        }
      }
    }

    return { checks, threats };
  }

  /**
   * Check a single URL for risk factors.
   */
  checkURL(urlStr: string): URLCheck {
    const reasons: string[] = [];
    let riskScore = 0;

    try {
      const url = new URL(urlStr);
      const domain = url.hostname;

      // Trusted?
      if (this.config.trustedDomains.some(d => domain.endsWith(d))) {
        return { url: urlStr, domain, isSuspicious: false, suspicionReasons: [], riskScore: 0 };
      }

      // Known safe domains
      if (KNOWN_SAFE_DOMAINS.has(domain) || KNOWN_SAFE_DOMAINS.has(domain.replace(/^www\./, ''))) {
        return { url: urlStr, domain, isSuspicious: false, suspicionReasons: [], riskScore: 0 };
      }

      if (url.protocol === 'http:') {
        riskScore += 0.2;
        reasons.push('no HTTPS');
      }

      const tld = '.' + domain.split('.').pop();
      if (SUSPICIOUS_TLDS.has(tld)) {
        riskScore += 0.3;
        reasons.push(`suspicious TLD (${tld})`);
      }

      // Domain impersonation
      for (const pattern of PHISHING_DOMAIN_PATTERNS) {
        if (pattern.test(domain)) {
          riskScore += 0.5;
          reasons.push('domain impersonates known brand');
          break;
        }
      }

      // Full URL patterns
      for (const pattern of PHISHING_URL_PATTERNS) {
        if (pattern.test(urlStr)) {
          riskScore += 0.5;
          reasons.push('matches phishing pattern');
          break;
        }
      }

      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
        riskScore += 0.35;
        reasons.push('IP address instead of domain');
      }

      return {
        url: urlStr,
        domain,
        isSuspicious: riskScore > 0.3,
        suspicionReasons: reasons,
        riskScore: Math.min(riskScore, 1),
      };
    } catch {
      return {
        url: urlStr,
        domain: 'unknown',
        isSuspicious: true,
        suspicionReasons: ['invalid URL'],
        riskScore: 0.5,
      };
    }
  }

  // ─── Document Analysis ────────────────────────────────────────

  /**
   * Analyze document text for risky clauses.
   */
  analyzeDocument(
    texts: ExtractedText[],
    imageId: string,
  ): { flags: DocumentFlag[]; threats: ThreatDetection[] } {
    const flags: DocumentFlag[] = [];
    const threats: ThreatDetection[] = [];
    const fullText = texts.map(t => t.text).join(' ');

    for (const riskPattern of CONTRACT_RISK_PATTERNS) {
      const match = fullText.match(riskPattern.pattern);
      if (match) {
        // Extract surrounding context (up to 200 chars around match)
        const idx = fullText.indexOf(match[0]);
        const start = Math.max(0, idx - 80);
        const end = Math.min(fullText.length, idx + match[0].length + 80);
        const context = fullText.substring(start, end).trim();

        flags.push({
          text: context,
          flagType: riskPattern.flagType,
          severity: riskPattern.severity,
          explanation: riskPattern.explanation,
          advice: riskPattern.advice,
        });

        if (riskPattern.severity === 'high') {
          threats.push(this.createThreat({
            category: 'contract_risk',
            level: 'medium',
            description: `Contract risk: ${riskPattern.explanation}`,
            evidence: context.substring(0, 150),
            recommendation: riskPattern.advice,
            confidence: 0.8,
            sourceData: context,
            imageId,
          }));
        }
      }
    }

    return { flags, threats };
  }

  // ─── Phishing Screen Detection ────────────────────────────────

  /**
   * Detect phishing emails/messages visible on screen.
   */
  detectPhishingOnScreen(
    texts: ExtractedText[],
    imageId: string,
  ): ThreatDetection[] {
    const threats: ThreatDetection[] = [];
    const fullText = texts.map(t => t.text).join(' ');

    for (const pattern of PHISHING_SCREEN_PATTERNS) {
      const match = fullText.match(pattern);
      if (match) {
        const idx = fullText.indexOf(match[0]);
        const start = Math.max(0, idx - 50);
        const end = Math.min(fullText.length, idx + match[0].length + 50);
        const context = fullText.substring(start, end).trim();

        threats.push(this.createThreat({
          category: 'phishing_screen',
          level: 'high',
          description: 'Possible phishing message detected on screen.',
          evidence: context.substring(0, 150),
          recommendation: 'This message shows signs of a phishing attack. Do not click any links or provide personal information.',
          confidence: 0.75,
          sourceData: context,
          imageId,
        }));
        break; // One phishing detection per scan is enough
      }
    }

    return threats;
  }

  // ─── Sensitive Data Detection ─────────────────────────────────

  /**
   * Detect sensitive data (passwords, API keys, etc.) visible on screen.
   */
  detectSensitiveData(
    texts: ExtractedText[],
    imageId: string,
  ): ThreatDetection[] {
    const threats: ThreatDetection[] = [];
    const fullText = texts.map(t => t.text).join(' ');

    for (const { pattern, type } of SENSITIVE_DATA_PATTERNS) {
      if (pattern.test(fullText)) {
        threats.push(this.createThreat({
          category: 'data_exposure',
          level: type === 'SSN (possible)' ? 'critical' : 'high',
          description: `Sensitive data visible: ${type}`,
          evidence: `${type} detected in visible text`,
          recommendation: `A ${type} is visible on screen. Ensure this is intentional and not being viewed in a public space.`,
          confidence: 0.7,
          imageId,
        }));
      }
    }

    return threats;
  }

  // ─── Physical Security Analysis ───────────────────────────────

  /**
   * Analyze scene for physical security concerns.
   * Uses detected objects and scene context.
   */
  analyzePhysicalSecurity(
    analysis: VisionAnalysis,
    imageId: string,
  ): ThreatDetection[] {
    const threats: ThreatDetection[] = [];
    const objects = analysis.detectedObjects || [];
    const description = analysis.sceneDescription?.toLowerCase() || '';

    // Check for ATM/payment terminal anomalies
    const hasATM = objects.some(o =>
      o.label.toLowerCase().includes('atm') ||
      o.label.toLowerCase().includes('payment terminal') ||
      o.label.toLowerCase().includes('card reader')
    );

    if (hasATM) {
      // Check for skimmer indicators
      const hasOverlay = objects.some(o =>
        o.label.toLowerCase().includes('overlay') ||
        o.label.toLowerCase().includes('attachment') ||
        o.label.toLowerCase().includes('loose')
      );

      if (hasOverlay || description.includes('modified') || description.includes('loose')) {
        threats.push(this.createThreat({
          category: 'atm_skimmer',
          level: 'critical',
          description: 'Possible card skimmer detected on ATM/payment terminal.',
          evidence: 'Unusual overlay or attachment detected on card reading device.',
          recommendation: 'Do NOT insert your card. Report to the establishment and contact your bank if you already used it.',
          confidence: 0.6,
          imageId,
        }));
      }
    }

    // Check for suspicious USB devices
    const hasUSB = objects.some(o =>
      o.label.toLowerCase().includes('usb') ||
      o.label.toLowerCase().includes('flash drive') ||
      o.label.toLowerCase().includes('thumb drive')
    );

    if (hasUSB && (description.includes('dropped') || description.includes('left') || description.includes('unattended'))) {
      threats.push(this.createThreat({
        category: 'suspicious_device',
        level: 'high',
        description: 'Unattended USB device detected. Could be a malicious "USB drop" attack.',
        evidence: 'USB device found in unattended location.',
        recommendation: 'Do NOT plug this into your computer. It could contain malware. Report it to IT security.',
        confidence: 0.65,
        imageId,
      }));
    }

    return threats;
  }

  // ─── Helper Methods ───────────────────────────────────────────

  private isDocumentScene(analysis: VisionAnalysis): boolean {
    return analysis.sceneType === 'document' ||
      (analysis.extractedText || []).some(t =>
        t.textType === 'document' ||
        t.text.length > 200
      );
  }

  private createThreat(params: Omit<ThreatDetection, 'id' | 'detectedAt'>): ThreatDetection {
    return {
      ...params,
      id: `threat-${++this.threatIdCounter}`,
      detectedAt: new Date().toISOString(),
    };
  }

  private getHighestThreatLevel(threats: ThreatDetection[]): ThreatLevel {
    const levels: ThreatLevel[] = ['critical', 'high', 'medium', 'low'];
    for (const level of levels) {
      if (threats.some(t => t.level === level)) return level;
    }
    return 'none';
  }

  private shouldAlert(level: ThreatLevel): boolean {
    const levels: ThreatLevel[] = ['critical', 'high', 'medium', 'low', 'none'];
    const thresholdIdx = levels.indexOf(this.config.alertThreshold);
    const levelIdx = levels.indexOf(level);
    return levelIdx <= thresholdIdx && levelIdx < levels.indexOf('none');
  }

  private levelToPriority(level: ThreatLevel): number {
    switch (level) {
      case 'critical': return 1;
      case 'high': return 2;
      case 'medium': return 5;
      case 'low': return 8;
      case 'none': return 10;
    }
  }

  private buildAlertText(threats: ThreatDetection[]): string {
    const critical = threats.filter(t => t.level === 'critical');
    const high = threats.filter(t => t.level === 'high');

    if (critical.length > 0) {
      return `Security alert! ${critical[0].description} ${critical[0].recommendation}`;
    }
    if (high.length > 0) {
      return `Heads up — ${high[0].description} ${high[0].recommendation}`;
    }
    return '';
  }

  private buildBriefAlert(result: SecurityScanResult): string {
    const { threats } = result;
    if (threats.length === 0) return '';

    const top = threats.sort((a, b) => {
      const levels: ThreatLevel[] = ['critical', 'high', 'medium', 'low'];
      return levels.indexOf(a.level) - levels.indexOf(b.level);
    })[0];

    return `${top.level === 'critical' ? 'Critical security alert' : 'Security warning'}: ${top.description}`;
  }

  private buildSummary(result: SecurityScanResult): string {
    const parts: string[] = [];

    if (result.threats.length === 0) {
      return 'Security scan clear — no threats detected.';
    }

    const byLevel = {
      critical: result.threats.filter(t => t.level === 'critical').length,
      high: result.threats.filter(t => t.level === 'high').length,
      medium: result.threats.filter(t => t.level === 'medium').length,
      low: result.threats.filter(t => t.level === 'low').length,
    };

    const levelParts: string[] = [];
    if (byLevel.critical) levelParts.push(`${byLevel.critical} critical`);
    if (byLevel.high) levelParts.push(`${byLevel.high} high`);
    if (byLevel.medium) levelParts.push(`${byLevel.medium} medium`);
    if (byLevel.low) levelParts.push(`${byLevel.low} low`);

    parts.push(`${result.threats.length} threats found (${levelParts.join(', ')})`);

    if (result.qrAnalysis.length > 0) {
      parts.push(`${result.qrAnalysis.length} QR codes analyzed`);
    }
    if (result.documentFlags.length > 0) {
      parts.push(`${result.documentFlags.length} contract clauses flagged`);
    }

    return parts.join('. ') + '.';
  }

  // ─── History & Stats ──────────────────────────────────────────

  private addToHistory(result: SecurityScanResult): void {
    this.scanHistory.push(result);
    if (this.scanHistory.length > this.config.maxHistory) {
      this.scanHistory.shift();
    }
  }

  /** Get recent threats, optionally filtered by level. */
  getRecentThreats(level?: ThreatLevel, limit = 20): ThreatDetection[] {
    let threats = [...this.threatHistory];
    if (level) {
      threats = threats.filter(t => t.level === level);
    }
    return threats.slice(-limit);
  }

  /** Get scan statistics. */
  getStats(): {
    totalScans: number;
    totalThreats: number;
    threatsByLevel: Record<ThreatLevel, number>;
    threatsByCategory: Record<string, number>;
    qrCodesScanned: number;
    documentsAnalyzed: number;
  } {
    const threatsByLevel: Record<ThreatLevel, number> = {
      critical: 0, high: 0, medium: 0, low: 0, none: 0,
    };
    const threatsByCategory: Record<string, number> = {};
    let qrCodesScanned = 0;
    let documentsAnalyzed = 0;

    for (const threat of this.threatHistory) {
      threatsByLevel[threat.level]++;
      threatsByCategory[threat.category] = (threatsByCategory[threat.category] || 0) + 1;
    }

    for (const scan of this.scanHistory) {
      qrCodesScanned += scan.qrAnalysis.length;
      documentsAnalyzed += scan.documentFlags.length > 0 ? 1 : 0;
    }

    return {
      totalScans: this.scanHistory.length,
      totalThreats: this.threatHistory.length,
      threatsByLevel,
      threatsByCategory,
      qrCodesScanned,
      documentsAnalyzed,
    };
  }

  /** Clear all history. */
  clearHistory(): void {
    this.scanHistory = [];
    this.threatHistory = [];
  }

  /** Get current config (read-only). */
  getConfig(): Readonly<SecurityAgentConfig> {
    return { ...this.config };
  }

  /** Update config at runtime. */
  updateConfig(patch: Partial<SecurityAgentConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  /** Add a domain to the trusted list. */
  addTrustedDomain(domain: string): void {
    if (!this.config.trustedDomains.includes(domain)) {
      this.config.trustedDomains.push(domain);
    }
  }

  /** Remove a domain from the trusted list. */
  removeTrustedDomain(domain: string): void {
    this.config.trustedDomains = this.config.trustedDomains.filter(d => d !== domain);
  }
}
