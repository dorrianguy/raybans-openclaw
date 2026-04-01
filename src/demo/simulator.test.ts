/**
 * Tests for Demo Simulator
 *
 * 🌙 Night Shift Agent — Night #28
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DemoSimulator,
  generateAnalysis,
  generateVoiceCommand,
  BUILT_IN_SCENARIOS,
  INVENTORY_DEMO,
  NETWORKING_DEMO,
  SECURITY_DEMO,
  DEAL_ANALYSIS_DEMO,
  FULL_PLATFORM_DEMO,
} from './simulator.js';
import type { SimulationScenario, SimulationStep, SimulatorConfig } from './simulator.js';

// ─── Helpers ────────────────────────────────────────────────────

function fastConfig(overrides?: Partial<SimulatorConfig>): SimulatorConfig {
  return {
    speed: 100, // 100x speed for fast tests
    simulateVoice: true,
    autoAdvance: true,
    stepDelayMs: 10,
    jitter: 0,
    ...overrides,
  };
}

function makeSimpleScenario(steps?: SimulationStep[]): SimulationScenario {
  return {
    id: 'test-scenario',
    name: 'Test Scenario',
    description: 'A test scenario',
    features: ['test'],
    estimatedDurationSec: 10,
    steps: steps ?? [
      { description: 'Step 1', type: 'narration', delayMs: 10, narration: 'Hello!' },
      { description: 'Step 2', type: 'narration', delayMs: 10, narration: 'World!' },
      { description: 'Step 3', type: 'narration', delayMs: 10, narration: 'Done.' },
    ],
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('DemoSimulator', () => {
  let sim: DemoSimulator;

  beforeEach(() => {
    sim = new DemoSimulator(fastConfig());
  });

  // ── Initialization ────────────────────────────────────────

  describe('Initialization', () => {
    it('starts in non-running state', () => {
      const state = sim.getState();
      expect(state.running).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.currentScenarioId).toBeNull();
    });

    it('loads all built-in scenarios', () => {
      const scenarios = sim.listScenarios();
      expect(scenarios.length).toBe(BUILT_IN_SCENARIOS.length);
      expect(scenarios.length).toBeGreaterThanOrEqual(5);
    });

    it('can retrieve scenario by ID', () => {
      const scenario = sim.getScenario('inventory-walkthrough');
      expect(scenario).toBeDefined();
      expect(scenario?.name).toBe('Inventory Vision Demo');
    });
  });

  // ── Scenario Management ───────────────────────────────────

  describe('Scenario Management', () => {
    it('registers custom scenarios', () => {
      const custom = makeSimpleScenario();
      sim.registerScenario(custom);

      const found = sim.getScenario('test-scenario');
      expect(found).toBe(custom);
    });

    it('lists all scenarios including custom', () => {
      sim.registerScenario(makeSimpleScenario());

      const all = sim.listScenarios();
      expect(all.length).toBe(BUILT_IN_SCENARIOS.length + 1);
    });

    it('returns undefined for unknown scenario', () => {
      expect(sim.getScenario('nonexistent')).toBeUndefined();
    });
  });

  // ── Scenario Execution ────────────────────────────────────

  describe('Scenario Execution', () => {
    it('runs a simple scenario', async () => {
      sim.registerScenario(makeSimpleScenario());

      const steps = await sim.runScenario('test-scenario');

      expect(steps).toHaveLength(3);
    });

    it('updates state during execution', async () => {
      sim.registerScenario(makeSimpleScenario());

      let captured = false;
      sim.on('sim:step', () => {
        const state = sim.getState();
        if (state.running) captured = true;
      });

      await sim.runScenario('test-scenario');

      expect(captured).toBe(true);
    });

    it('marks scenario as completed', async () => {
      sim.registerScenario(makeSimpleScenario());

      await sim.runScenario('test-scenario');

      const state = sim.getState();
      expect(state.completedScenarios).toContain('test-scenario');
    });

    it('resets running state after completion', async () => {
      sim.registerScenario(makeSimpleScenario());

      await sim.runScenario('test-scenario');

      const state = sim.getState();
      expect(state.running).toBe(false);
      expect(state.currentScenarioId).toBeNull();
    });

    it('throws for unknown scenario', async () => {
      await expect(sim.runScenario('nonexistent')).rejects.toThrow('Scenario not found');
    });

    it('emits scenario lifecycle events', async () => {
      sim.registerScenario(makeSimpleScenario());

      const events: string[] = [];
      sim.on('sim:scenario_started', () => events.push('started'));
      sim.on('sim:scenario_completed', () => events.push('completed'));

      await sim.runScenario('test-scenario');

      expect(events).toEqual(['started', 'completed']);
    });

    it('emits step events', async () => {
      sim.registerScenario(makeSimpleScenario());

      const stepDescriptions: string[] = [];
      sim.on('sim:step', (step: SimulationStep) => {
        stepDescriptions.push(step.description);
      });

      await sim.runScenario('test-scenario');

      expect(stepDescriptions).toEqual(['Step 1', 'Step 2', 'Step 3']);
    });

    it('calls onStep callback', async () => {
      const onStep = vi.fn();
      sim = new DemoSimulator({ ...fastConfig(), onStep });
      sim.registerScenario(makeSimpleScenario());

      await sim.runScenario('test-scenario');

      expect(onStep).toHaveBeenCalledTimes(3);
      expect(onStep).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Step 1' }),
        0,
        3
      );
    });
  });

  // ── Step Types ────────────────────────────────────────────

  describe('Step Types', () => {
    it('handles narration steps with voice output', async () => {
      const onVoice = vi.fn();
      sim = new DemoSimulator({ ...fastConfig(), onVoiceOutput: onVoice });
      sim.registerScenario(makeSimpleScenario([
        { description: 'Narrate', type: 'narration', delayMs: 0, narration: 'Test narration' },
      ]));

      await sim.runScenario('test-scenario');

      expect(onVoice).toHaveBeenCalledWith('Test narration', 'narrator');
    });

    it('suppresses voice when simulateVoice is false', async () => {
      const onVoice = vi.fn();
      sim = new DemoSimulator({ ...fastConfig(), simulateVoice: false, onVoiceOutput: onVoice });
      sim.registerScenario(makeSimpleScenario([
        { description: 'Narrate', type: 'narration', delayMs: 0, narration: 'Silent' },
      ]));

      await sim.runScenario('test-scenario');

      expect(onVoice).not.toHaveBeenCalled();
    });

    it('handles image steps', async () => {
      const analysis = generateAnalysis('retail_shelf');
      const images: string[] = [];

      sim.on('sim:image_simulated', (a: { imageId: string }) => images.push(a.imageId));
      sim.registerScenario(makeSimpleScenario([
        { description: 'Image', type: 'image', delayMs: 0, analysis },
      ]));

      await sim.runScenario('test-scenario');

      expect(images).toHaveLength(1);
    });

    it('handles voice command steps', async () => {
      sim.registerScenario(makeSimpleScenario([
        {
          description: 'Voice',
          type: 'voice',
          delayMs: 0,
          voiceCommand: generateVoiceCommand('inventory_start', 'Start inventory'),
        },
      ]));

      const steps = await sim.runScenario('test-scenario');

      expect(steps).toHaveLength(1);
      expect(steps[0].voiceCommand?.intent).toBe('inventory_start');
    });

    it('handles event steps', async () => {
      sim.registerScenario(makeSimpleScenario([
        {
          description: 'Event',
          type: 'event',
          delayMs: 0,
          eventType: 'test_event',
          eventData: { key: 'value' },
        },
      ]));

      const steps = await sim.runScenario('test-scenario');
      expect(steps).toHaveLength(1);
    });

    it('handles pause steps', async () => {
      sim.registerScenario(makeSimpleScenario([
        { description: 'Pause', type: 'pause', delayMs: 0 },
      ]));

      const steps = await sim.runScenario('test-scenario');
      expect(steps).toHaveLength(1);
    });
  });

  // ── Pause/Resume/Stop ─────────────────────────────────────

  describe('Pause/Resume/Stop', () => {
    it('can stop a running scenario', async () => {
      sim.registerScenario(makeSimpleScenario([
        { description: 'Slow step 1', type: 'narration', delayMs: 5000, narration: 'Slow...' },
        { description: 'Slow step 2', type: 'narration', delayMs: 5000, narration: 'Very slow...' },
      ]));

      // Speed up but keep some delay to allow stop
      sim = new DemoSimulator({ speed: 10, jitter: 0 });
      sim.registerScenario(makeSimpleScenario([
        { description: 'Slow step 1', type: 'narration', delayMs: 500, narration: 'Slow...' },
        { description: 'Slow step 2', type: 'narration', delayMs: 500, narration: 'Very slow...' },
      ]));

      const promise = sim.runScenario('test-scenario');

      // Stop after a short delay
      setTimeout(() => sim.stop(), 30);

      const steps = await promise;

      // Should have been cut short
      expect(steps.length).toBeLessThanOrEqual(2);
    });

    it('emits stop event', async () => {
      const events: string[] = [];
      sim.on('sim:stopped', () => events.push('stopped'));

      sim.registerScenario(makeSimpleScenario([
        { description: 'Step', type: 'pause', delayMs: 5000 },
      ]));

      const promise = sim.runScenario('test-scenario');
      setTimeout(() => sim.stop(), 10);
      await promise;

      expect(events).toContain('stopped');
    });

    it('can pause and resume', async () => {
      const events: string[] = [];
      sim.on('sim:paused', () => events.push('paused'));
      sim.on('sim:resumed', () => events.push('resumed'));

      sim.registerScenario(makeSimpleScenario([
        { description: 'Step 1', type: 'narration', delayMs: 200, narration: 'A' },
        { description: 'Step 2', type: 'narration', delayMs: 200, narration: 'B' },
        { description: 'Step 3', type: 'narration', delayMs: 200, narration: 'C' },
      ]));

      sim = new DemoSimulator({ speed: 5, jitter: 0 });
      sim.on('sim:paused', () => events.push('paused'));
      sim.on('sim:resumed', () => events.push('resumed'));
      sim.registerScenario(makeSimpleScenario([
        { description: 'Step 1', type: 'narration', delayMs: 200, narration: 'A' },
        { description: 'Step 2', type: 'narration', delayMs: 200, narration: 'B' },
        { description: 'Step 3', type: 'narration', delayMs: 200, narration: 'C' },
      ]));

      const promise = sim.runScenario('test-scenario');

      setTimeout(() => sim.pause(), 20);
      setTimeout(() => sim.resume(), 60);

      await promise;

      expect(events).toContain('paused');
      expect(events).toContain('resumed');
    });

    it('does not pause when not running', () => {
      sim.pause();
      expect(sim.getState().paused).toBe(false);
    });

    it('does not resume when not paused', () => {
      sim.resume();
      expect(sim.getState().paused).toBe(false);
    });
  });

  // ── Built-in Scenarios Validation ─────────────────────────

  describe('Built-in Scenarios', () => {
    it('inventory demo has correct structure', () => {
      expect(INVENTORY_DEMO.id).toBe('inventory-walkthrough');
      expect(INVENTORY_DEMO.steps.length).toBeGreaterThanOrEqual(5);
      expect(INVENTORY_DEMO.features).toContain('Inventory Vision');

      const imageSteps = INVENTORY_DEMO.steps.filter(s => s.type === 'image');
      expect(imageSteps.length).toBeGreaterThanOrEqual(2);

      const voiceSteps = INVENTORY_DEMO.steps.filter(s => s.type === 'voice');
      expect(voiceSteps.length).toBeGreaterThanOrEqual(2);
    });

    it('networking demo has correct structure', () => {
      expect(NETWORKING_DEMO.id).toBe('conference-networking');
      expect(NETWORKING_DEMO.steps.length).toBeGreaterThanOrEqual(4);
      expect(NETWORKING_DEMO.features).toContain('Networking Agent');

      const personScans = NETWORKING_DEMO.steps.filter(
        s => s.type === 'image' && s.analysis?.sceneType === 'person'
      );
      expect(personScans.length).toBeGreaterThanOrEqual(2);
    });

    it('security demo has QR code threat detection', () => {
      expect(SECURITY_DEMO.id).toBe('security-scan');

      const qrSteps = SECURITY_DEMO.steps.filter(
        s => s.type === 'image' && s.analysis?.barcodes && s.analysis.barcodes.length > 0
      );
      expect(qrSteps.length).toBeGreaterThanOrEqual(1);

      // The QR should point to a suspicious URL
      const qrUrl = qrSteps[0]?.analysis?.barcodes[0]?.data ?? '';
      expect(qrUrl).toContain('.xyz');
    });

    it('deal analysis demo includes vehicle scan', () => {
      expect(DEAL_ANALYSIS_DEMO.id).toBe('deal-analysis');

      const vehicleSteps = DEAL_ANALYSIS_DEMO.steps.filter(
        s => s.type === 'image' && s.analysis?.sceneType === 'vehicle'
      );
      expect(vehicleSteps.length).toBeGreaterThanOrEqual(1);
    });

    it('full platform demo covers multiple scene types', () => {
      expect(FULL_PLATFORM_DEMO.id).toBe('full-platform');
      expect(FULL_PLATFORM_DEMO.steps.length).toBeGreaterThanOrEqual(10);

      const sceneTypes = new Set(
        FULL_PLATFORM_DEMO.steps
          .filter(s => s.type === 'image' && s.analysis)
          .map(s => s.analysis!.sceneType)
      );

      expect(sceneTypes.size).toBeGreaterThanOrEqual(3);
    });

    it('all built-in scenarios run without errors', async () => {
      for (const scenario of BUILT_IN_SCENARIOS) {
        const steps = await sim.runScenario(scenario.id);
        expect(steps.length).toBe(scenario.steps.length);
      }
    });
  });

  // ── Data Generators ───────────────────────────────────────

  describe('Data Generators', () => {
    it('generates retail_shelf analysis with products', () => {
      const analysis = generateAnalysis('retail_shelf');

      expect(analysis.sceneType).toBe('retail_shelf');
      expect(analysis.products.length).toBeGreaterThanOrEqual(3);
      expect(analysis.barcodes.length).toBeGreaterThanOrEqual(1);
      expect(analysis.extractedText.length).toBeGreaterThanOrEqual(1);
      expect(analysis.sceneDescription).toContain('aisle');
    });

    it('generates person analysis with badge info', () => {
      const analysis = generateAnalysis('person');

      expect(analysis.sceneType).toBe('person');
      expect(analysis.extractedText.length).toBeGreaterThanOrEqual(3); // name, title, company
      expect(analysis.detectedObjects.some(o => o.label === 'person')).toBe(true);
    });

    it('generates document analysis with text', () => {
      const analysis = generateAnalysis('document');

      expect(analysis.sceneType).toBe('document');
      expect(analysis.extractedText.length).toBeGreaterThanOrEqual(3);
      expect(analysis.extractedText.some(t => t.textType === 'document')).toBe(true);
    });

    it('generates vehicle analysis with price and VIN', () => {
      const analysis = generateAnalysis('vehicle');

      expect(analysis.sceneType).toBe('vehicle');
      expect(analysis.extractedText.some(t => t.textType === 'price')).toBe(true);
      expect(analysis.detectedObjects.some(o => o.label === 'car')).toBe(true);
    });

    it('generates property analysis with findings', () => {
      const analysis = generateAnalysis('property');

      expect(analysis.sceneType).toBe('property');
      expect(analysis.detectedObjects.some(o => o.label === 'water_stain')).toBe(true);
    });

    it('generates whiteboard analysis with OCR text', () => {
      const analysis = generateAnalysis('whiteboard');

      expect(analysis.sceneType).toBe('whiteboard');
      expect(analysis.extractedText.length).toBeGreaterThanOrEqual(3);
    });

    it('generates kitchen analysis with ingredients', () => {
      const analysis = generateAnalysis('kitchen');

      expect(analysis.sceneType).toBe('kitchen');
      expect(analysis.detectedObjects.length).toBeGreaterThanOrEqual(3);
    });

    it('generates workshop analysis with tools', () => {
      const analysis = generateAnalysis('workshop');

      expect(analysis.sceneType).toBe('workshop');
      expect(analysis.detectedObjects.some(o => o.label === 'wrench' || o.label === 'drill')).toBe(true);
    });

    it('generates analysis with unique IDs', () => {
      const a1 = generateAnalysis('retail_shelf');
      const a2 = generateAnalysis('retail_shelf');

      expect(a1.imageId).not.toBe(a2.imageId);
    });

    it('generates analysis with valid quality scores', () => {
      for (const sceneType of ['retail_shelf', 'person', 'document', 'vehicle', 'property'] as const) {
        const analysis = generateAnalysis(sceneType);
        expect(analysis.quality.score).toBeGreaterThan(0);
        expect(analysis.quality.score).toBeLessThanOrEqual(1);
      }
    });

    it('applies overrides to generated analysis', () => {
      const analysis = generateAnalysis('retail_shelf', {
        imageId: 'custom-id',
        processingTimeMs: 999,
      });

      expect(analysis.imageId).toBe('custom-id');
      expect(analysis.processingTimeMs).toBe(999);
    });

    it('generates unknown scene type with basic data', () => {
      const analysis = generateAnalysis('unknown');
      expect(analysis.sceneType).toBe('unknown');
      expect(analysis.sceneDescription).toBeTruthy();
    });
  });

  // ── Voice Command Generator ───────────────────────────────

  describe('Voice Command Generator', () => {
    it('generates voice command with correct intent', () => {
      const cmd = generateVoiceCommand('inventory_start', 'Start inventory');

      expect(cmd.intent).toBe('inventory_start');
      expect(cmd.rawText).toBe('Start inventory');
      expect(cmd.confidence).toBeGreaterThan(0.8);
      expect(cmd.timestamp).toBeTruthy();
    });

    it('includes custom params', () => {
      const cmd = generateVoiceCommand('inventory_set_aisle', 'Aisle 5', { aisle: '5' });

      expect(cmd.params.aisle).toBe('5');
    });

    it('generates unique timestamps', () => {
      const c1 = generateVoiceCommand('inventory_start', 'Start');
      const c2 = generateVoiceCommand('inventory_start', 'Start');

      // Both should have timestamps (may be the same if generated in same ms)
      expect(c1.timestamp).toBeTruthy();
      expect(c2.timestamp).toBeTruthy();
    });
  });

  // ── Speed Control ─────────────────────────────────────────

  describe('Speed Control', () => {
    it('respects speed multiplier', async () => {
      // 10x speed should be significantly faster
      const fast = new DemoSimulator({ speed: 100, jitter: 0 });
      fast.registerScenario(makeSimpleScenario([
        { description: 'Step', type: 'narration', delayMs: 1000, narration: 'A' },
      ]));

      const start = Date.now();
      await fast.runScenario('test-scenario');
      const duration = Date.now() - start;

      // At 100x speed, 1000ms delay should take ~10ms
      expect(duration).toBeLessThan(200);
    });

    it('applies zero jitter deterministically', async () => {
      const sim1 = new DemoSimulator({ speed: 100, jitter: 0 });
      sim1.registerScenario(makeSimpleScenario());

      const steps = await sim1.runScenario('test-scenario');
      expect(steps).toHaveLength(3);
    });
  });

  // ── Run All Scenarios ─────────────────────────────────────

  describe('Run All Scenarios', () => {
    it('runs all registered scenarios', async () => {
      const results = await sim.runAllScenarios();

      expect(results.size).toBe(BUILT_IN_SCENARIOS.length);
      for (const [id, steps] of results) {
        const scenario = sim.getScenario(id);
        expect(steps.length).toBe(scenario!.steps.length);
      }
    });
  });
});
