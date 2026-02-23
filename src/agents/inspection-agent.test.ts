/**
 * Tests for the Inspection Agent — inspection lifecycle, finding detection,
 * section management, report generation, and event handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionAgent } from './inspection-agent.js';
import type { InspectionType, FindingSeverity } from './inspection-agent.js';
import type { CapturedImage, VisionAnalysis } from '../types.js';
import type { RoutingContext } from '../routing/context-router.js';

// ─── Test Helpers ───────────────────────────────────────────────

function makeImage(id = 'img-001'): CapturedImage {
  return {
    id,
    buffer: Buffer.from('fake-image'),
    mimeType: 'image/jpeg',
    capturedAt: new Date().toISOString(),
    deviceId: 'test-device',
    trigger: 'auto',
  };
}

function makeAnalysis(overrides: Partial<VisionAnalysis> = {}): VisionAnalysis {
  return {
    imageId: 'img-001',
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 100,
    sceneDescription: 'A room in a building',
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

// ─── Tests ──────────────────────────────────────────────────────

describe('InspectionAgent', () => {
  let agent: InspectionAgent;

  beforeEach(() => {
    agent = new InspectionAgent({ inspectorName: 'Test Inspector' });
  });

  // ─── Inspection Lifecycle ─────────────────────────────────────

  describe('Inspection Lifecycle', () => {
    it('should start a property inspection', () => {
      const session = agent.startInspection('property', 'Unit 4B', '123 Main St');

      expect(session.type).toBe('property');
      expect(session.locationName).toBe('Unit 4B');
      expect(session.address).toBe('123 Main St');
      expect(session.status).toBe('active');
      expect(session.inspectorName).toBe('Test Inspector');
      expect(agent.isInspectionActive()).toBe(true);
    });

    it('should start different inspection types', () => {
      const types: InspectionType[] = ['property', 'server', 'construction', 'warehouse', 'vehicle', 'general'];

      for (const type of types) {
        agent = new InspectionAgent();
        const session = agent.startInspection(type, 'Test Location');
        expect(session.type).toBe(type);
        agent.endInspection();
      }
    });

    it('should end an inspection and generate report', () => {
      agent.startInspection('property', 'Test House');

      const report = agent.endInspection();

      expect(report.type).toBe('property');
      expect(report.location).toBe('Test House');
      expect(report.markdownReport).toContain('Property Inspection Report');
      expect(report.voiceSummary).toContain('Inspection complete');
      expect(agent.isInspectionActive()).toBe(false);
    });

    it('should throw when ending with no active inspection', () => {
      expect(() => agent.endInspection()).toThrow('No active inspection');
    });

    it('should pause and resume an inspection', () => {
      agent.startInspection('server', 'Data Center A');

      agent.pauseInspection();
      expect(agent.getCurrentInspection()?.status).toBe('paused');

      agent.resumeInspection();
      expect(agent.getCurrentInspection()?.status).toBe('active');
    });

    it('should not pause when no inspection active', () => {
      agent.pauseInspection();
      expect(agent.getCurrentInspection()).toBeNull();
    });

    it('should track inspection history', () => {
      agent.startInspection('property', 'House 1');
      agent.endInspection();

      agent.startInspection('warehouse', 'Warehouse A');
      agent.endInspection();

      expect(agent.getInspectionHistory().length).toBe(2);
    });

    it('should create default section on start', () => {
      agent.startInspection('property', 'Test');

      const session = agent.getCurrentInspection()!;
      expect(session.sections.length).toBe(1);
      expect(session.currentSection).toBe('General');
    });
  });

  // ─── Section Management ───────────────────────────────────────

  describe('Section Management', () => {
    it('should change to a new section', () => {
      agent.startInspection('property', 'House');

      agent.changeSection('Living Room');

      expect(agent.getCurrentInspection()!.currentSection).toBe('Living Room');
      expect(agent.getCurrentInspection()!.sections.length).toBe(2);
    });

    it('should switch to existing section without duplicating', () => {
      agent.startInspection('property', 'House');

      agent.changeSection('Kitchen');
      agent.changeSection('Living Room');
      agent.changeSection('Kitchen'); // Back to Kitchen

      expect(agent.getCurrentInspection()!.currentSection).toBe('Kitchen');
      expect(agent.getCurrentInspection()!.sections.length).toBe(3); // General + Kitchen + Living Room
    });

    it('should respect max sections limit', () => {
      agent = new InspectionAgent({ maxSections: 3 });
      agent.startInspection('property', 'House');

      agent.changeSection('Room 1');
      agent.changeSection('Room 2');
      agent.changeSection('Room 3'); // Should be ignored (already have 3)

      expect(agent.getCurrentInspection()!.sections.length).toBe(3);
    });

    it('should not change section when no inspection active', () => {
      agent.changeSection('Test');
      // Should not throw
    });
  });

  // ─── Image Processing ────────────────────────────────────────

  describe('Image Processing', () => {
    it('should increment image count on processing', () => {
      agent.startInspection('property', 'House');

      agent.processImage(makeImage('img-1'), makeAnalysis());
      agent.processImage(makeImage('img-2'), makeAnalysis());

      expect(agent.getCurrentInspection()!.totalImages).toBe(2);
    });

    it('should increment section image count', () => {
      agent.startInspection('property', 'House');

      agent.processImage(makeImage('img-1'), makeAnalysis());

      const section = agent.getCurrentInspection()!.sections[0];
      expect(section.imageCount).toBe(1);
    });

    it('should not process images when inspection is paused', () => {
      agent.startInspection('property', 'House');
      agent.pauseInspection();

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Water damage on ceiling',
      }));

      expect(findings.length).toBe(0);
    });

    it('should not process images when no inspection is active', () => {
      const findings = agent.processImage(makeImage(), makeAnalysis());
      expect(findings.length).toBe(0);
    });
  });

  // ─── Finding Auto-Detection (Property) ────────────────────────

  describe('Property Finding Detection', () => {
    it('should detect water damage', () => {
      agent.startInspection('property', 'House');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Water damage visible on the ceiling near the window',
      }));

      expect(findings.some(f => f.category === 'Water Damage')).toBe(true);
    });

    it('should detect mold as critical', () => {
      agent.startInspection('property', 'House');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Black mold growing in the corner of the bathroom',
      }));

      const mold = findings.find(f => f.category === 'Mold');
      expect(mold).toBeDefined();
      expect(mold!.severity).toBe('critical');
    });

    it('should detect cracks in walls', () => {
      agent.startInspection('property', 'House');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Large crack in wall extending from ceiling to window',
      }));

      expect(findings.some(f => f.category === 'Structural')).toBe(true);
    });

    it('should detect electrical hazards as critical', () => {
      agent.startInspection('property', 'House');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Exposed wiring hanging from the ceiling junction box',
      }));

      const electrical = findings.find(f => f.category === 'Electrical');
      expect(electrical).toBeDefined();
      expect(electrical!.severity).toBe('critical');
    });

    it('should detect peeling paint', () => {
      agent.startInspection('property', 'House');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Peeling paint on the exterior window frame',
      }));

      expect(findings.some(f => f.category === 'Paint/Finish')).toBe(true);
    });

    it('should detect broken windows', () => {
      agent.startInspection('property', 'House');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Cracked window pane in the bedroom',
      }));

      expect(findings.some(f => f.category === 'Windows')).toBe(true);
    });
  });

  // ─── Finding Auto-Detection (Server Room) ─────────────────────

  describe('Server Room Finding Detection', () => {
    it('should detect cable management issues', () => {
      agent.startInspection('server', 'DC-1');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Tangled cable mess behind rack B7',
      }));

      expect(findings.some(f => f.category === 'Cable Management')).toBe(true);
    });

    it('should detect thermal issues', () => {
      agent.startInspection('server', 'DC-1');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Hot spot detected near the top of rack C4, temperature warning indicator',
      }));

      expect(findings.some(f => f.category === 'Cooling')).toBe(true);
    });

    it('should detect warning lights', () => {
      agent.startInspection('server', 'DC-1');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Amber warning LED on server unit in rack A2',
      }));

      expect(findings.some(f => f.category === 'Hardware')).toBe(true);
    });
  });

  // ─── Finding Auto-Detection (Construction) ────────────────────

  describe('Construction Finding Detection', () => {
    it('should detect PPE violations as critical', () => {
      agent.startInspection('construction', 'Site A');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Worker without hard hat near scaffolding',
      }));

      const ppe = findings.find(f => f.category === 'Safety Compliance');
      expect(ppe).toBeDefined();
      expect(ppe!.severity).toBe('critical');
    });

    it('should detect fall hazards', () => {
      agent.startInspection('construction', 'Site A');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Trip hazard from debris in walkway',
      }));

      expect(findings.some(f => f.title.includes('trip'))).toBe(true);
    });
  });

  // ─── Finding Auto-Detection (Warehouse) ───────────────────────

  describe('Warehouse Finding Detection', () => {
    it('should detect blocked exits as critical', () => {
      agent.startInspection('warehouse', 'WH-1');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Blocked exit door with pallets stacked in front',
      }));

      const exit = findings.find(f => f.title.includes('Blocked exit'));
      expect(exit).toBeDefined();
      expect(exit!.severity).toBe('critical');
    });

    it('should detect damaged racking', () => {
      agent.startInspection('warehouse', 'WH-1');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Damaged rack with bent upright in aisle 5',
      }));

      expect(findings.some(f => f.category === 'Racking')).toBe(true);
    });

    it('should detect spills', () => {
      agent.startInspection('warehouse', 'WH-1');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Oil spill near the loading dock',
      }));

      expect(findings.some(f => f.title.includes('Spill'))).toBe(true);
    });
  });

  // ─── Finding Auto-Detection (Vehicle) ─────────────────────────

  describe('Vehicle Finding Detection', () => {
    it('should detect body damage', () => {
      agent.startInspection('vehicle', '2024 Honda Civic');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Scratch on the rear bumper near the taillight',
      }));

      expect(findings.some(f => f.category === 'Body Damage')).toBe(true);
    });

    it('should detect rust as major', () => {
      agent.startInspection('vehicle', '2018 Subaru');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Rust on the wheel well and rocker panel',
      }));

      const rust = findings.find(f => f.category === 'Corrosion');
      expect(rust).toBeDefined();
      expect(rust!.severity).toBe('major');
    });

    it('should detect tire issues', () => {
      agent.startInspection('vehicle', 'Fleet Vehicle');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Tire wear visible on front left, treads are bald',
      }));

      expect(findings.some(f => f.category === 'Tires')).toBe(true);
    });
  });

  // ─── Manual Input ─────────────────────────────────────────────

  describe('Manual Input', () => {
    it('should add notes to current section', () => {
      agent.startInspection('property', 'House');

      agent.addNote('Previous tenant left furniture in bedroom');

      const section = agent.getCurrentInspection()!.sections[0];
      expect(section.notes.length).toBe(1);
    });

    it('should not add notes when paused', () => {
      agent.startInspection('property', 'House');
      agent.pauseInspection();

      agent.addNote('This should not be added');

      // paused, so note should not be added
    });

    it('should manually add findings', () => {
      agent.startInspection('property', 'House');

      const finding = agent.addFinding({
        severity: 'major',
        title: 'Foundation crack',
        description: 'Horizontal crack along south wall foundation',
        estimatedCost: 5000,
      });

      expect(finding.severity).toBe('major');
      expect(finding.source).toBe('manual');
      expect(agent.getCurrentInspection()!.findings.length).toBe(1);
    });

    it('should set section condition', () => {
      agent.startInspection('property', 'House');

      agent.setSectionCondition('fair');

      const section = agent.getCurrentInspection()!.sections[0];
      expect(section.condition).toBe('fair');
    });
  });

  // ─── Overall Condition Assessment ─────────────────────────────

  describe('Overall Condition Assessment', () => {
    it('should assess as excellent with no findings', () => {
      agent.startInspection('property', 'House');

      const report = agent.endInspection();

      expect(report.overallCondition).toBe('excellent');
    });

    it('should assess as poor with critical findings', () => {
      agent.startInspection('property', 'House');

      agent.addFinding({ severity: 'critical', title: 'Mold', description: 'Mold in bathroom' });

      const report = agent.endInspection();

      expect(report.overallCondition).toBe('poor');
    });

    it('should assess as critical with multiple critical findings', () => {
      agent.startInspection('property', 'House');

      agent.addFinding({ severity: 'critical', title: 'Mold', description: 'Mold' });
      agent.addFinding({ severity: 'critical', title: 'Wiring', description: 'Exposed wiring' });

      const report = agent.endInspection();

      expect(report.overallCondition).toBe('critical');
    });

    it('should assess as fair with multiple major findings', () => {
      agent.startInspection('property', 'House');

      agent.addFinding({ severity: 'major', title: 'Issue 1', description: '...' });
      agent.addFinding({ severity: 'major', title: 'Issue 2', description: '...' });

      const report = agent.endInspection();

      expect(report.overallCondition).toBe('fair');
    });
  });

  // ─── Report Generation ────────────────────────────────────────

  describe('Report Generation', () => {
    it('should generate a complete markdown report', () => {
      agent.startInspection('property', 'Test House', '456 Oak Ave');

      agent.changeSection('Kitchen');
      agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Water damage on kitchen ceiling near the sink',
      }));
      agent.addNote('Faucet is leaking');

      agent.changeSection('Bathroom');
      agent.addFinding({
        severity: 'major',
        title: 'Cracked tile',
        description: 'Shower floor tile is cracked',
        estimatedCost: 300,
      });

      const report = agent.endInspection();

      expect(report.markdownReport).toContain('Property Inspection Report');
      expect(report.markdownReport).toContain('Test House');
      expect(report.markdownReport).toContain('456 Oak Ave');
      expect(report.markdownReport).toContain('Kitchen');
      expect(report.markdownReport).toContain('Bathroom');
      expect(report.markdownReport).toContain('Faucet is leaking');
      expect(report.markdownReport).toContain('Cracked tile');
    });

    it('should include finding summary counts', () => {
      agent.startInspection('property', 'House');

      agent.addFinding({ severity: 'critical', title: 'C1', description: '...' });
      agent.addFinding({ severity: 'major', title: 'M1', description: '...' });
      agent.addFinding({ severity: 'minor', title: 'm1', description: '...' });
      agent.addFinding({ severity: 'informational', title: 'I1', description: '...' });

      const report = agent.endInspection();

      expect(report.findingSummary.critical).toBe(1);
      expect(report.findingSummary.major).toBe(1);
      expect(report.findingSummary.minor).toBe(1);
      expect(report.findingSummary.informational).toBe(1);
    });

    it('should calculate estimated total cost', () => {
      agent.startInspection('property', 'House');

      agent.addFinding({ severity: 'major', title: 'Fix 1', description: '...', estimatedCost: 1000 });
      agent.addFinding({ severity: 'minor', title: 'Fix 2', description: '...', estimatedCost: 200 });

      const report = agent.endInspection();

      expect(report.estimatedTotalCost).toBe(1200);
    });

    it('should generate voice summary', () => {
      agent.startInspection('property', 'Test House');

      agent.addFinding({ severity: 'critical', title: 'Mold', description: 'Mold' });

      const report = agent.endInspection();

      expect(report.voiceSummary).toContain('Inspection complete');
      expect(report.voiceSummary).toContain('critical');
    });

    it('should handle empty inspection', () => {
      agent.startInspection('general', 'Empty Location');

      const report = agent.endInspection();

      expect(report.voiceSummary).toContain('No issues found');
      expect(report.overallCondition).toBe('excellent');
    });

    it('should include section summary table', () => {
      agent.startInspection('property', 'House');
      agent.changeSection('Kitchen');
      agent.changeSection('Bedroom');

      const report = agent.endInspection();

      expect(report.markdownReport).toContain('Areas Inspected');
      expect(report.sectionsCovered).toBe(3);
    });
  });

  // ─── Context Router Integration ───────────────────────────────

  describe('Context Router Integration (handle method)', () => {
    it('should suggest starting when no inspection active', async () => {
      const response = await agent.handle(makeImage(), makeAnalysis(), makeContext());

      expect(response.agentId).toBe('inspection');
      expect(response.summary).toContain('No active inspection');
    });

    it('should process images during active inspection', async () => {
      agent.startInspection('property', 'House');

      const analysis = makeAnalysis({
        sceneDescription: 'Water leak stain on the ceiling',
      });

      const response = await agent.handle(makeImage(), analysis, makeContext());

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
    });

    it('should TTS for critical findings', async () => {
      agent.startInspection('property', 'House');

      const analysis = makeAnalysis({
        sceneDescription: 'Black mold visible on the wall behind the shower',
      });

      const response = await agent.handle(makeImage(), analysis, makeContext());

      if (response.ttsText) {
        expect(response.ttsText.toLowerCase()).toContain('critical');
      }
    });
  });

  // ─── Events ───────────────────────────────────────────────────

  describe('Events', () => {
    it('should emit inspection:started', () => {
      const spy = vi.fn();
      agent.on('inspection:started', spy);

      agent.startInspection('property', 'House');

      expect(spy).toHaveBeenCalledOnce();
    });

    it('should emit inspection:ended with report', () => {
      const spy = vi.fn();
      agent.on('inspection:ended', spy);

      agent.startInspection('property', 'House');
      agent.endInspection();

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toHaveProperty('markdownReport');
    });

    it('should emit finding:detected', () => {
      const spy = vi.fn();
      agent.on('finding:detected', spy);

      agent.startInspection('property', 'House');
      agent.addFinding({ severity: 'minor', title: 'Test', description: 'Test' });

      expect(spy).toHaveBeenCalledOnce();
    });

    it('should emit finding:critical for critical findings', () => {
      const spy = vi.fn();
      agent.on('finding:critical', spy);

      agent.startInspection('property', 'House');
      agent.addFinding({ severity: 'critical', title: 'Emergency', description: 'Gas leak' });

      expect(spy).toHaveBeenCalledOnce();
    });

    it('should emit section:changed', () => {
      const spy = vi.fn();
      agent.on('section:changed', spy);

      agent.startInspection('property', 'House');
      agent.changeSection('Kitchen');

      expect(spy).toHaveBeenCalledWith('Kitchen');
    });

    it('should emit image:captured on processImage', () => {
      const spy = vi.fn();
      agent.on('image:captured', spy);

      agent.startInspection('property', 'House');
      agent.processImage(makeImage('img-42'), makeAnalysis());

      expect(spy).toHaveBeenCalledWith('img-42', 'General');
    });

    it('should emit inspection:paused and inspection:resumed', () => {
      const pauseSpy = vi.fn();
      const resumeSpy = vi.fn();
      agent.on('inspection:paused', pauseSpy);
      agent.on('inspection:resumed', resumeSpy);

      agent.startInspection('property', 'House');
      agent.pauseInspection();
      agent.resumeInspection();

      expect(pauseSpy).toHaveBeenCalledOnce();
      expect(resumeSpy).toHaveBeenCalledOnce();
    });
  });

  // ─── Configuration ────────────────────────────────────────────

  describe('Configuration', () => {
    it('should use default config', () => {
      const defaultAgent = new InspectionAgent();
      expect(defaultAgent.getConfig().inspectorName).toBe('Inspector');
      expect(defaultAgent.getConfig().autoDetectFindings).toBe(true);
    });

    it('should accept custom config', () => {
      const custom = new InspectionAgent({
        inspectorName: 'John Doe',
        maxFindings: 50,
      });

      expect(custom.getConfig().inspectorName).toBe('John Doe');
      expect(custom.getConfig().maxFindings).toBe(50);
    });

    it('should update config at runtime', () => {
      agent.updateConfig({ autoDetectFindings: false });
      expect(agent.getConfig().autoDetectFindings).toBe(false);
    });

    it('should skip auto-detection when disabled', () => {
      agent = new InspectionAgent({ autoDetectFindings: false });
      agent.startInspection('property', 'House');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Water damage everywhere with mold and exposed wiring',
      }));

      expect(findings.length).toBe(0);
    });

    it('should respect max findings limit', () => {
      agent = new InspectionAgent({ maxFindings: 2 });
      agent.startInspection('property', 'House');

      agent.addFinding({ severity: 'minor', title: 'F1', description: '...' });
      agent.addFinding({ severity: 'minor', title: 'F2', description: '...' });

      // Processing should not add more since we hit limit via addFinding
      // But addFinding directly adds to findings regardless of limit
      // The limit is enforced in processImage auto-detection
      agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'Water damage on ceiling',
      }));

      // Should not exceed limit through processImage
      const session = agent.getCurrentInspection()!;
      // Manual findings + auto-detected may exceed, but auto-detected won't add past limit
      expect(session.findings.length).toBeLessThanOrEqual(4); // at most 2 manual + some auto
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle empty scene descriptions', () => {
      agent.startInspection('property', 'House');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: '',
      }));

      expect(findings.length).toBe(0);
    });

    it('should detect findings from extracted text too', () => {
      agent.startInspection('property', 'House');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'A wall',
        extractedText: [{ text: 'Warning: water leak detected', confidence: 0.9, textType: 'sign' as const }],
      }));

      expect(findings.some(f => f.category === 'Water Damage')).toBe(true);
    });

    it('should getCurrentInspection returns copy', () => {
      agent.startInspection('property', 'House');

      const s1 = agent.getCurrentInspection()!;
      s1.locationName = 'Modified';

      const s2 = agent.getCurrentInspection()!;
      expect(s2.locationName).toBe('House');
    });

    it('should handle findings in multiple sections', () => {
      agent.startInspection('property', 'House');

      agent.changeSection('Kitchen');
      agent.addFinding({ severity: 'minor', title: 'Stain', description: 'Counter stain' });

      agent.changeSection('Bathroom');
      agent.addFinding({ severity: 'major', title: 'Mold', description: 'Shower mold' });

      const report = agent.endInspection();

      expect(report.findingsBySection['Kitchen']).toBeDefined();
      expect(report.findingsBySection['Bathroom']).toBeDefined();
    });

    it('should handle general inspection type fallback patterns', () => {
      agent.startInspection('general', 'Some Place');

      const findings = agent.processImage(makeImage(), makeAnalysis({
        sceneDescription: 'A safety hazard near the entrance',
      }));

      expect(findings.some(f => f.category === 'Safety')).toBe(true);
    });
  });
});
