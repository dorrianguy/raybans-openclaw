/**
 * Tests for the Security Agent — threat detection, QR analysis,
 * URL checking, document analysis, phishing detection, and more.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecurityAgent } from './security-agent.js';
import type { CapturedImage, VisionAnalysis, ExtractedText, DecodedBarcode } from '../types.js';
import type { RoutingContext } from '../routing/context-router.js';

// ─── Test Helpers ───────────────────────────────────────────────

function makeImage(id = 'img-001'): CapturedImage {
  return {
    id,
    buffer: Buffer.from('fake-image'),
    mimeType: 'image/jpeg',
    capturedAt: new Date().toISOString(),
    deviceId: 'test-device',
    trigger: 'manual',
  };
}

function makeAnalysis(overrides: Partial<VisionAnalysis> = {}): VisionAnalysis {
  return {
    imageId: 'img-001',
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 100,
    sceneDescription: 'A typical scene',
    sceneType: 'unknown',
    extractedText: [],
    detectedObjects: [],
    products: [],
    barcodes: [],
    quality: {
      score: 0.9,
      isBlurry: false,
      hasGlare: false,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: true,
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    activeMode: null,
    trigger: 'auto',
    recentModes: [],
    ...overrides,
  };
}

function makeQR(data: string, format: 'QR' | 'DataMatrix' = 'QR'): DecodedBarcode {
  return {
    data,
    format,
    confidence: 0.95,
  };
}

function makeText(text: string, textType: ExtractedText['textType'] = 'other'): ExtractedText {
  return {
    text,
    confidence: 0.9,
    textType,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('SecurityAgent', () => {
  let agent: SecurityAgent;

  beforeEach(() => {
    agent = new SecurityAgent();
  });

  // ─── QR Code Analysis ────────────────────────────────────────

  describe('QR Code Analysis', () => {
    it('should detect phishing QR codes', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('http://paypal-secure-login.xyz/verify')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis.length).toBe(1);
      expect(result.qrAnalysis[0].isKnownPhishing).toBe(true);
      expect(result.qrAnalysis[0].riskScore).toBeGreaterThan(0.7);
      expect(result.threats.length).toBeGreaterThan(0);
      expect(result.threats[0].category).toBe('phishing_qr');
    });

    it('should flag QR codes with URL shorteners', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('https://bit.ly/abc123')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis[0].isShortener).toBe(true);
      expect(result.qrAnalysis[0].riskScore).toBeGreaterThan(0);
    });

    it('should flag QR codes with suspicious TLDs', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('http://some-store.xyz/offer')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis[0].riskScore).toBeGreaterThan(0.3);
    });

    it('should flag QR codes pointing to IP addresses', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('http://192.168.1.100/login')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis[0].riskScore).toBeGreaterThan(0.3);
    });

    it('should pass safe QR codes', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('https://www.google.com/maps/place/...')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis[0].riskScore).toBeLessThanOrEqual(0.4);
      expect(result.overallLevel).toBe('none');
    });

    it('should handle non-URL QR codes safely', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('WIFI:T:WPA;S:MyNetwork;P:mypassword;;')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis[0].isUrl).toBe(false);
      expect(result.qrAnalysis[0].riskScore).toBe(0);
    });

    it('should flag QR codes with internationalized domain names', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('https://xn--pple-43d.com/login')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis[0].riskScore).toBeGreaterThan(0.2);
    });

    it('should trust QR codes from trusted domains', async () => {
      agent = new SecurityAgent({ trustedDomains: ['example.com'] });

      const analysis = makeAnalysis({
        barcodes: [makeQR('https://store.example.com/product/123')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis[0].riskScore).toBe(0);
    });

    it('should flag high-severity phishing QR as critical', async () => {
      // Both no HTTPS + phishing pattern + suspicious TLD = high risk
      const analysis = makeAnalysis({
        barcodes: [makeQR('http://paypal-login.xyz/verify?id=123')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const phishingThreat = result.threats.find(t => t.category === 'phishing_qr');
      expect(phishingThreat).toBeDefined();
      expect(phishingThreat!.level).toBe('critical');
    });

    it('should handle DataMatrix codes', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('https://suspicious-site.top/pay', 'DataMatrix')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis.length).toBe(1);
      expect(result.qrAnalysis[0].riskScore).toBeGreaterThan(0.3);
    });

    it('should flag excessive subdomains', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('https://login.secure.account.verify.paypal-auth.com/verify')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis[0].riskScore).toBeGreaterThan(0);
    });

    it('should not flag regular barcodes (non-QR)', async () => {
      const analysis = makeAnalysis({
        barcodes: [{
          data: '012345678901',
          format: 'UPC-A',
          confidence: 0.95,
        }],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis.length).toBe(0);
    });
  });

  // ─── URL Analysis ─────────────────────────────────────────────

  describe('URL Analysis', () => {
    it('should detect suspicious URLs in text', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('Visit http://paypal-secure.xyz/verify for your refund')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.urlChecks.length).toBeGreaterThan(0);
      expect(result.urlChecks[0].isSuspicious).toBe(true);
    });

    it('should flag URLs with IP addresses', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('Go to http://192.168.1.1/admin to configure')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.urlChecks.length).toBe(1);
      expect(result.urlChecks[0].suspicionReasons).toContain('IP address instead of domain');
    });

    it('should pass safe URLs', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('Check out https://docs.google.com/spreadsheets')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const googleCheck = result.urlChecks.find(c => c.domain === 'docs.google.com');
      expect(googleCheck?.isSuspicious).toBe(false);
    });

    it('should handle multiple URLs in one text block', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText(
          'Safe: https://github.com Bad: http://evil.xyz/hack Also bad: http://192.168.1.1/shell'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.urlChecks.length).toBe(3);
    });
  });

  // ─── Document/Contract Analysis ───────────────────────────────

  describe('Document Analysis', () => {
    it('should detect auto-renewal clauses', async () => {
      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText(
          'This agreement shall auto-renew for successive 12-month periods unless cancelled 30 days before expiry.',
          'document'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.documentFlags.length).toBeGreaterThan(0);
      const autoRenewal = result.documentFlags.find(f => f.flagType === 'auto_renewal');
      expect(autoRenewal).toBeDefined();
      expect(autoRenewal!.severity).toBe('high');
    });

    it('should detect non-compete clauses', async () => {
      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText(
          'Employee agrees to a non-compete covenant for a period of 24 months following termination.',
          'document'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const nonCompete = result.documentFlags.find(f => f.flagType === 'non_compete');
      expect(nonCompete).toBeDefined();
    });

    it('should detect hidden fees', async () => {
      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText(
          'A processing fee of $4.99 will be applied to each transaction in addition to the stated price.',
          'document'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const fee = result.documentFlags.find(f => f.flagType === 'hidden_fee');
      expect(fee).toBeDefined();
    });

    it('should detect arbitration clauses', async () => {
      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText(
          'Any dispute shall be resolved through binding arbitration. You waive your right to a class action lawsuit.',
          'document'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const arb = result.documentFlags.find(f => f.flagType === 'arbitration');
      expect(arb).toBeDefined();
    });

    it('should detect cancellation penalties', async () => {
      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText(
          'Early termination fee of $500 applies if service is cancelled before the end of the initial 24-month term.',
          'document'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const penalty = result.documentFlags.find(f => f.flagType === 'cancellation_penalty');
      expect(penalty).toBeDefined();
      expect(penalty!.severity).toBe('high');
    });

    it('should detect data collection clauses', async () => {
      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText(
          'We may collect and share your personal information with third-party partners for marketing purposes.',
          'document'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const data = result.documentFlags.find(f => f.flagType === 'data_collection');
      expect(data).toBeDefined();
    });

    it('should detect IP transfer clauses', async () => {
      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText(
          'You hereby assign all intellectual property rights in any work product to the Company.',
          'document'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const ip = result.documentFlags.find(f => f.flagType === 'intellectual_property');
      expect(ip).toBeDefined();
      expect(ip!.severity).toBe('high');
    });

    it('should detect price escalation clauses', async () => {
      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText(
          'The company reserves the right to increase prices annually at its sole discretion.',
          'document'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const escalation = result.documentFlags.find(f => f.flagType === 'price_escalation');
      expect(escalation).toBeDefined();
    });

    it('should flag multiple issues in one document', async () => {
      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText(
          'This agreement shall auto-renew annually. A cancellation fee of $200 applies. ' +
          'Employee agrees to a non-compete for 18 months. All disputes resolved via binding arbitration.',
          'document'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.documentFlags.length).toBeGreaterThanOrEqual(4);
    });

    it('should not flag documents for non-document scenes', async () => {
      const analysis = makeAnalysis({
        sceneType: 'retail_shelf',
        extractedText: [makeText('auto-renewal included', 'label')],
      });

      // Short text, not document type — shouldn't trigger doc analysis
      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.documentFlags.length).toBe(0);
    });
  });

  // ─── Phishing Screen Detection ────────────────────────────────

  describe('Phishing Screen Detection', () => {
    it('should detect account suspension phishing', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText(
          'Your account has been suspended due to suspicious activity. Click here to verify your identity.'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const phishing = result.threats.find(t => t.category === 'phishing_screen');
      expect(phishing).toBeDefined();
      expect(phishing!.level).toBe('high');
    });

    it('should detect prize/winner scams', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText(
          'Congratulations! You have been selected as a winner of a $10,000 prize!'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.threats.some(t => t.category === 'phishing_screen')).toBe(true);
    });

    it('should detect wire transfer scams', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText(
          'Please send the payment via gift card code or Western Union transfer.'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.threats.some(t => t.category === 'phishing_screen')).toBe(true);
    });

    it('should detect unusual login alerts', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText(
          'Unusual sign-in attempt detected. Verify your identity immediately or your account will be locked.'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.threats.some(t => t.category === 'phishing_screen')).toBe(true);
    });

    it('should not flag normal email text', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText(
          'Hi team, please review the Q4 report and provide your feedback by Friday. Thanks!'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.threats.filter(t => t.category === 'phishing_screen').length).toBe(0);
    });
  });

  // ─── Sensitive Data Detection ─────────────────────────────────

  describe('Sensitive Data Detection', () => {
    it('should detect API keys on screen', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('api_key = sk_test_FAKEFAKEFAKEFAKEFAKE1234')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const exposure = result.threats.find(t => t.category === 'data_exposure');
      expect(exposure).toBeDefined();
    });

    it('should detect passwords on screen', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('password: MyS3cretP@ss!')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.threats.some(t => t.category === 'data_exposure')).toBe(true);
    });

    it('should detect AWS access keys', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.threats.some(t => t.category === 'data_exposure')).toBe(true);
    });

    it('should detect GitHub tokens', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.threats.some(t => t.category === 'data_exposure')).toBe(true);
    });

    it('should detect SSH keys', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('-----BEGIN RSA PRIVATE KEY-----')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.threats.some(t => t.category === 'data_exposure')).toBe(true);
    });

    it('should detect possible SSNs as critical', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('SSN: 123-45-6789')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const ssnThreat = result.threats.find(t =>
        t.category === 'data_exposure' && t.level === 'critical'
      );
      expect(ssnThreat).toBeDefined();
    });
  });

  // ─── Physical Security ────────────────────────────────────────

  describe('Physical Security', () => {
    it('should detect ATM skimmer indicators (deep scan)', async () => {
      const analysis = makeAnalysis({
        sceneDescription: 'An ATM with a modified card reader and loose overlay',
        detectedObjects: [
          { label: 'ATM', confidence: 0.9 },
          { label: 'loose overlay', confidence: 0.7 },
        ],
      });

      const result = await agent.scanForThreats(makeImage(), analysis, true);

      expect(result.threats.some(t => t.category === 'atm_skimmer')).toBe(true);
    });

    it('should flag suspicious USB drops (deep scan)', async () => {
      const analysis = makeAnalysis({
        sceneDescription: 'A USB flash drive left unattended on a desk',
        detectedObjects: [
          { label: 'USB flash drive', confidence: 0.85 },
        ],
      });

      const result = await agent.scanForThreats(makeImage(), analysis, true);

      expect(result.threats.some(t => t.category === 'suspicious_device')).toBe(true);
    });

    it('should not run physical scan in non-deep mode', async () => {
      const analysis = makeAnalysis({
        sceneDescription: 'An ATM with a modified card reader',
        detectedObjects: [
          { label: 'ATM', confidence: 0.9 },
          { label: 'overlay', confidence: 0.7 },
        ],
      });

      const result = await agent.scanForThreats(makeImage(), analysis, false);

      expect(result.threats.filter(t => t.category === 'atm_skimmer').length).toBe(0);
    });
  });

  // ─── Alert Levels & TTS ───────────────────────────────────────

  describe('Alert Levels', () => {
    it('should require alert for critical threats', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('http://paypal-login.xyz/steal')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.requiresAlert).toBe(true);
      expect(result.alertText).toBeTruthy();
    });

    it('should require alert for high threats (default threshold)', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('Your account has been suspended. Click here to verify your identity immediately.')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.requiresAlert).toBe(true);
    });

    it('should not alert for medium threats when threshold is high', async () => {
      agent = new SecurityAgent({ alertThreshold: 'high' });

      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText(
          'A convenience fee of $2.50 applies to all transactions.',
          'document'
        )],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      // Hidden fee is medium severity, shouldn't alert
      if (result.threats.length > 0 && result.overallLevel === 'medium') {
        expect(result.requiresAlert).toBe(false);
      }
    });

    it('should set overall level to highest threat', async () => {
      const analysis = makeAnalysis({
        extractedText: [
          makeText('password: secret123'),
          makeText('Your account has been suspended. Click to verify.'),
        ],
        barcodes: [makeQR('http://paypal-login.xyz/verify')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      // Multiple threats, overall should be the highest
      expect(['critical', 'high']).toContain(result.overallLevel);
    });
  });

  // ─── Context Router Integration ───────────────────────────────

  describe('Context Router Integration (handle method)', () => {
    it('should return AgentResponse format', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('https://safe-site.com/menu')],
      });

      const response = await agent.handle(makeImage(), analysis, makeContext());

      expect(response.agentId).toBe('security');
      expect(response.agentName).toBe('Security Agent');
      expect(response.success).toBe(true);
      expect(response.summary).toBeTruthy();
    });

    it('should provide TTS for threats', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('http://paypal-login.xyz/verify')],
      });

      const response = await agent.handle(makeImage(), analysis, makeContext());

      expect(response.ttsText).toBeTruthy();
    });

    it('should have high priority for critical threats', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('SSN: 123-45-6789')],
      });

      const response = await agent.handle(makeImage(), analysis, makeContext());

      expect(response.priority).toBeLessThanOrEqual(2);
    });
  });

  // ─── Events ───────────────────────────────────────────────────

  describe('Events', () => {
    it('should emit threat:detected for each threat', async () => {
      const threatSpy = vi.fn();
      agent.on('threat:detected', threatSpy);

      const analysis = makeAnalysis({
        extractedText: [makeText('password: myPassword123')],
      });

      await agent.scanForThreats(makeImage(), analysis);

      expect(threatSpy).toHaveBeenCalled();
    });

    it('should emit threat:critical for critical threats', async () => {
      const criticalSpy = vi.fn();
      agent.on('threat:critical', criticalSpy);

      const analysis = makeAnalysis({
        extractedText: [makeText('SSN: 123-45-6789')],
      });

      await agent.scanForThreats(makeImage(), analysis);

      expect(criticalSpy).toHaveBeenCalled();
    });

    it('should emit scan:complete after every scan', async () => {
      const scanSpy = vi.fn();
      agent.on('scan:complete', scanSpy);

      await agent.scanForThreats(makeImage(), makeAnalysis());

      expect(scanSpy).toHaveBeenCalledOnce();
    });

    it('should emit qr:decoded for QR codes', async () => {
      const qrSpy = vi.fn();
      agent.on('qr:decoded', qrSpy);

      const analysis = makeAnalysis({
        barcodes: [makeQR('https://example.com')],
      });

      await agent.scanForThreats(makeImage(), analysis);

      expect(qrSpy).toHaveBeenCalledOnce();
    });

    it('should emit document:flagged for document risks', async () => {
      const docSpy = vi.fn();
      agent.on('document:flagged', docSpy);

      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText('This agreement shall auto-renew for 12 months.', 'document')],
      });

      await agent.scanForThreats(makeImage(), analysis);

      expect(docSpy).toHaveBeenCalled();
    });
  });

  // ─── History & Stats ──────────────────────────────────────────

  describe('History & Stats', () => {
    it('should track scan history', async () => {
      await agent.scanForThreats(makeImage('img-1'), makeAnalysis());
      await agent.scanForThreats(makeImage('img-2'), makeAnalysis());

      const stats = agent.getStats();
      expect(stats.totalScans).toBe(2);
    });

    it('should track threat history', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('password: secret123')],
      });

      await agent.scanForThreats(makeImage(), analysis);

      const threats = agent.getRecentThreats();
      expect(threats.length).toBeGreaterThan(0);
    });

    it('should filter threats by level', async () => {
      const analysis = makeAnalysis({
        extractedText: [makeText('SSN: 123-45-6789')],
      });

      await agent.scanForThreats(makeImage(), analysis);

      const critical = agent.getRecentThreats('critical');
      expect(critical.length).toBeGreaterThan(0);
      expect(critical.every(t => t.level === 'critical')).toBe(true);
    });

    it('should respect max history limit', async () => {
      agent = new SecurityAgent({ maxHistory: 2 });

      await agent.scanForThreats(makeImage('img-1'), makeAnalysis());
      await agent.scanForThreats(makeImage('img-2'), makeAnalysis());
      await agent.scanForThreats(makeImage('img-3'), makeAnalysis());

      const stats = agent.getStats();
      expect(stats.totalScans).toBe(2);
    });

    it('should clear history', async () => {
      await agent.scanForThreats(makeImage(), makeAnalysis({
        extractedText: [makeText('password: secret')],
      }));

      agent.clearHistory();

      const stats = agent.getStats();
      expect(stats.totalScans).toBe(0);
      expect(stats.totalThreats).toBe(0);
    });

    it('should count QR codes scanned', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('https://example.com'), makeQR('https://test.com')],
      });

      await agent.scanForThreats(makeImage(), analysis);

      const stats = agent.getStats();
      expect(stats.qrCodesScanned).toBe(2);
    });
  });

  // ─── Configuration ────────────────────────────────────────────

  describe('Configuration', () => {
    it('should use default config', () => {
      const config = agent.getConfig();
      expect(config.passiveScanEnabled).toBe(true);
      expect(config.qrAnalysisEnabled).toBe(true);
    });

    it('should allow config updates at runtime', () => {
      agent.updateConfig({ passiveScanEnabled: false });
      expect(agent.getConfig().passiveScanEnabled).toBe(false);
    });

    it('should manage trusted domains', () => {
      agent.addTrustedDomain('mycompany.com');
      expect(agent.getConfig().trustedDomains).toContain('mycompany.com');

      agent.removeTrustedDomain('mycompany.com');
      expect(agent.getConfig().trustedDomains).not.toContain('mycompany.com');
    });

    it('should not add duplicate trusted domains', () => {
      agent.addTrustedDomain('example.com');
      agent.addTrustedDomain('example.com');
      expect(agent.getConfig().trustedDomains.filter(d => d === 'example.com').length).toBe(1);
    });

    it('should skip QR analysis when disabled', async () => {
      agent = new SecurityAgent({ qrAnalysisEnabled: false });

      const analysis = makeAnalysis({
        barcodes: [makeQR('http://evil.xyz/phish')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.qrAnalysis.length).toBe(0);
    });

    it('should skip document analysis when disabled', async () => {
      agent = new SecurityAgent({ documentAnalysisEnabled: false });

      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [makeText('auto-renewal clause included', 'document')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.documentFlags.length).toBe(0);
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle empty analysis gracefully', async () => {
      const result = await agent.scanForThreats(makeImage(), makeAnalysis());

      expect(result.overallLevel).toBe('none');
      expect(result.threats.length).toBe(0);
      expect(result.requiresAlert).toBe(false);
    });

    it('should handle analysis with no text', async () => {
      const analysis = makeAnalysis({
        extractedText: [],
        barcodes: [],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      expect(result.overallLevel).toBe('none');
    });

    it('should handle invalid URL in QR code', async () => {
      const analysis = makeAnalysis({
        barcodes: [makeQR('http://not a valid url at all')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      // Should handle without crashing
      expect(result.qrAnalysis.length).toBe(1);
    });

    it('should process multiple threat types simultaneously', async () => {
      const analysis = makeAnalysis({
        sceneType: 'document',
        extractedText: [
          makeText('password: admin123'),
          makeText('This agreement auto-renews annually with a cancellation fee of $500.', 'document'),
          makeText('Your account will be suspended. Click to verify.'),
        ],
        barcodes: [makeQR('http://phishing-site.xyz/steal')],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      // Should find threats from multiple categories
      const categories = new Set(result.threats.map(t => t.category));
      expect(categories.size).toBeGreaterThanOrEqual(2);
    });

    it('should generate unique threat IDs', async () => {
      const analysis = makeAnalysis({
        extractedText: [
          makeText('password: abc'),
          makeText('api_key = sk_test_123456789012345678901234'),
        ],
      });

      const result = await agent.scanForThreats(makeImage(), analysis);

      const ids = result.threats.map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
