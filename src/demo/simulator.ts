/**
 * Demo Simulator — Run the full platform without hardware.
 *
 * Critical for:
 * 1. Investor demos ("Look what the glasses can do")
 * 2. Developer testing without physical Ray-Bans
 * 3. Trade show booth displays
 * 4. Dorrian's testing at any time
 *
 * Simulates the full pipeline: image capture → vision analysis → agents → voice
 * Uses pre-built scenarios that showcase each feature.
 *
 * 🌙 Night Shift Agent — Night #28
 */

import { EventEmitter } from 'events';
import type {
  VisionAnalysis,
  CapturedImage,
  VoiceCommand,
  DetectedProduct,
  ExtractedText,
  DetectedObject,
  DecodedBarcode,
  SceneType,
  VoiceIntent,
  GeoLocation,
} from '../types.js';

// ─── Simulator Types ────────────────────────────────────────────

export interface SimulatorConfig {
  /** Speed multiplier (1 = real-time, 2 = 2x speed, 0.5 = half speed) */
  speed?: number;
  /** Enable voice output simulation */
  simulateVoice?: boolean;
  /** Auto-advance through scenario steps */
  autoAdvance?: boolean;
  /** Delay between auto-advance steps (ms, before speed multiplier) */
  stepDelayMs?: number;
  /** Random variation in timing (0-1, 0 = exact, 1 = ±100%) */
  jitter?: number;
  /** Callback for voice output */
  onVoiceOutput?: (text: string, agent: string) => void;
  /** Callback for each step */
  onStep?: (step: SimulationStep, index: number, total: number) => void;
}

export interface SimulationScenario {
  /** Unique scenario identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this scenario demonstrates */
  description: string;
  /** Which features are showcased */
  features: string[];
  /** Estimated demo time in seconds (at 1x speed) */
  estimatedDurationSec: number;
  /** The steps to execute */
  steps: SimulationStep[];
}

export interface SimulationStep {
  /** What this step represents */
  description: string;
  /** Type of simulation event */
  type: 'image' | 'voice' | 'event' | 'narration' | 'pause';
  /** Delay before this step (ms, before speed multiplier) */
  delayMs: number;
  /** For image steps: the simulated analysis */
  analysis?: VisionAnalysis;
  /** For voice steps: the simulated command */
  voiceCommand?: VoiceCommand;
  /** For narration: text to speak/display */
  narration?: string;
  /** For event steps: what happened */
  eventType?: string;
  eventData?: Record<string, unknown>;
  /** Expected voice response (for verification in tests) */
  expectedResponse?: string;
}

export interface SimulatorState {
  running: boolean;
  paused: boolean;
  currentScenarioId: string | null;
  currentStepIndex: number;
  totalSteps: number;
  elapsedMs: number;
  completedScenarios: string[];
}

export type SimulatorEventType =
  | 'sim:started'
  | 'sim:stopped'
  | 'sim:paused'
  | 'sim:resumed'
  | 'sim:step'
  | 'sim:scenario_started'
  | 'sim:scenario_completed'
  | 'sim:voice_output'
  | 'sim:image_simulated'
  | 'sim:error';

// ─── Simulator Class ────────────────────────────────────────────

export class DemoSimulator extends EventEmitter {
  private config: SimulatorConfig;
  private state: SimulatorState;
  private scenarios: Map<string, SimulationScenario> = new Map();
  private abortController: AbortController | null = null;

  constructor(config?: SimulatorConfig) {
    super();
    this.config = {
      speed: 1,
      simulateVoice: true,
      autoAdvance: true,
      stepDelayMs: 2000,
      jitter: 0.1,
      ...config,
    };
    this.state = {
      running: false,
      paused: false,
      currentScenarioId: null,
      currentStepIndex: 0,
      totalSteps: 0,
      elapsedMs: 0,
      completedScenarios: [],
    };

    // Register all built-in scenarios
    for (const scenario of BUILT_IN_SCENARIOS) {
      this.scenarios.set(scenario.id, scenario);
    }
  }

  // ─── Scenario Management ──────────────────────────────────

  registerScenario(scenario: SimulationScenario): void {
    this.scenarios.set(scenario.id, scenario);
  }

  getScenario(id: string): SimulationScenario | undefined {
    return this.scenarios.get(id);
  }

  listScenarios(): SimulationScenario[] {
    return Array.from(this.scenarios.values());
  }

  // ─── Execution ────────────────────────────────────────────

  async runScenario(scenarioId: string): Promise<SimulationStep[]> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }

    this.state.running = true;
    this.state.paused = false;
    this.state.currentScenarioId = scenarioId;
    this.state.currentStepIndex = 0;
    this.state.totalSteps = scenario.steps.length;
    this.state.elapsedMs = 0;

    this.abortController = new AbortController();

    this.emit('sim:scenario_started', scenario);

    const executedSteps: SimulationStep[] = [];

    try {
      for (let i = 0; i < scenario.steps.length; i++) {
        if (this.abortController.signal.aborted) break;

        // Wait while paused
        while (this.state.paused && !this.abortController.signal.aborted) {
          await this.delay(100);
        }
        if (this.abortController.signal.aborted) break;

        const step = scenario.steps[i];
        this.state.currentStepIndex = i;

        // Apply delay with speed and jitter
        const delay = this.computeDelay(step.delayMs);
        if (delay > 0) {
          await this.delay(delay);
        }
        if (this.abortController.signal.aborted) break;

        // Execute the step
        await this.executeStep(step, i, scenario.steps.length);
        executedSteps.push(step);
        this.state.elapsedMs += step.delayMs;
      }

      if (!this.abortController.signal.aborted) {
        this.state.completedScenarios.push(scenarioId);
        this.emit('sim:scenario_completed', scenario);
      }
    } finally {
      this.state.running = false;
      this.state.currentScenarioId = null;
      this.abortController = null;
    }

    return executedSteps;
  }

  async runAllScenarios(): Promise<Map<string, SimulationStep[]>> {
    const results = new Map<string, SimulationStep[]>();
    for (const [id] of this.scenarios) {
      const steps = await this.runScenario(id);
      results.set(id, steps);
    }
    return results;
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.state.running = false;
    this.emit('sim:stopped');
  }

  pause(): void {
    if (!this.state.running) return;
    this.state.paused = true;
    this.emit('sim:paused');
  }

  resume(): void {
    if (!this.state.paused) return;
    this.state.paused = false;
    this.emit('sim:resumed');
  }

  getState(): SimulatorState {
    return { ...this.state };
  }

  // ─── Private ──────────────────────────────────────────────

  private async executeStep(step: SimulationStep, index: number, total: number): Promise<void> {
    this.emit('sim:step', step, index, total);
    this.config.onStep?.(step, index, total);

    switch (step.type) {
      case 'image':
        if (step.analysis) {
          this.emit('sim:image_simulated', step.analysis);
        }
        break;

      case 'voice':
        if (step.voiceCommand) {
          // Simulate voice input processing
        }
        break;

      case 'narration':
        if (step.narration && this.config.simulateVoice) {
          this.emit('sim:voice_output', step.narration, 'narrator');
          this.config.onVoiceOutput?.(step.narration, 'narrator');
        }
        break;

      case 'event':
        // Events are just markers
        break;

      case 'pause':
        // Explicit pause
        break;
    }
  }

  private computeDelay(baseMs: number): number {
    const speed = this.config.speed ?? 1;
    const jitter = this.config.jitter ?? 0;
    const variation = jitter > 0 ? 1 + (Math.random() * 2 - 1) * jitter : 1;
    return Math.max(0, Math.round(baseMs * variation / speed));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ─── Simulated Data Generators ──────────────────────────────────

export function generateAnalysis(
  sceneType: SceneType,
  overrides?: Partial<VisionAnalysis>
): VisionAnalysis {
  const base: VisionAnalysis = {
    imageId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 800 + Math.random() * 400,
    sceneDescription: '',
    sceneType,
    extractedText: [],
    detectedObjects: [],
    products: [],
    barcodes: [],
    quality: {
      score: 0.85 + Math.random() * 0.15,
      isBlurry: false,
      hasGlare: false,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: true,
    },
    ...overrides,
  };

  // Fill in scene-specific data
  switch (sceneType) {
    case 'retail_shelf':
      return fillRetailShelf(base);
    case 'person':
      return fillPerson(base);
    case 'document':
      return fillDocument(base);
    case 'vehicle':
      return fillVehicle(base);
    case 'property':
      return fillProperty(base);
    case 'whiteboard':
      return fillWhiteboard(base);
    case 'kitchen':
      return fillKitchen(base);
    case 'workshop':
      return fillWorkshop(base);
    default:
      base.sceneDescription = 'A general scene';
      return base;
  }
}

function fillRetailShelf(analysis: VisionAnalysis): VisionAnalysis {
  analysis.sceneDescription = 'Grocery store aisle with cereal and snacks on shelves. Multiple product facings visible.';
  analysis.products = [
    makeProduct('Cheerios Original', 'General Mills', 'Cereal', '18 oz', '049000006469', 5, 0.92, 4.99),
    makeProduct('Lucky Charms', 'General Mills', 'Cereal', '14.9 oz', '016000275263', 3, 0.88, 5.49),
    makeProduct('Honey Nut Cheerios', 'General Mills', 'Cereal', '15.4 oz', '016000275270', 7, 0.95, 4.79),
    makeProduct('Frosted Flakes', 'Kellogg\'s', 'Cereal', '13.5 oz', '038000199530', 4, 0.85, 4.49),
    makeProduct('Raisin Bran', 'Kellogg\'s', 'Cereal', '16.6 oz', '038000596261', 2, 0.78, 4.29),
  ];
  analysis.barcodes = [
    { data: '049000006469', format: 'UPC-A', confidence: 0.98 },
    { data: '016000275263', format: 'UPC-A', confidence: 0.95 },
  ];
  analysis.extractedText = [
    { text: '$4.99', confidence: 0.97, textType: 'price' },
    { text: '$5.49', confidence: 0.95, textType: 'price' },
    { text: 'BUY 2 SAVE $1', confidence: 0.92, textType: 'sign' },
  ];
  analysis.detectedObjects = [
    { label: 'cereal_box', confidence: 0.95 },
    { label: 'shelf', confidence: 0.99 },
    { label: 'price_tag', confidence: 0.93 },
  ];
  return analysis;
}

function fillPerson(analysis: VisionAnalysis): VisionAnalysis {
  analysis.sceneDescription = 'Person wearing a conference badge. Name visible on badge.';
  analysis.extractedText = [
    { text: 'Sarah Chen', confidence: 0.95, textType: 'label' },
    { text: 'VP of Engineering', confidence: 0.9, textType: 'label' },
    { text: 'Stripe', confidence: 0.93, textType: 'label' },
    { text: 'sarah@stripe.com', confidence: 0.88, textType: 'label' },
    { text: 'TechCrunch Disrupt 2026', confidence: 0.92, textType: 'sign' },
  ];
  analysis.detectedObjects = [
    { label: 'person', confidence: 0.99 },
    { label: 'badge', confidence: 0.95 },
    { label: 'lanyard', confidence: 0.88 },
  ];
  return analysis;
}

function fillDocument(analysis: VisionAnalysis): VisionAnalysis {
  analysis.sceneDescription = 'Contract document with legal text. Multiple clauses visible.';
  analysis.extractedText = [
    { text: 'SERVICE AGREEMENT', confidence: 0.98, textType: 'document' },
    { text: 'This agreement automatically renews for successive 12-month periods unless cancelled in writing 30 days prior to renewal date.', confidence: 0.9, textType: 'document' },
    { text: 'Early termination fee of $500 applies if cancelled within the first 6 months.', confidence: 0.88, textType: 'document' },
    { text: 'All disputes shall be settled by binding arbitration.', confidence: 0.92, textType: 'document' },
    { text: 'Effective Date: April 1, 2026', confidence: 0.95, textType: 'document' },
  ];
  return analysis;
}

function fillVehicle(analysis: VisionAnalysis): VisionAnalysis {
  analysis.sceneDescription = 'Used car on a dealership lot. Price sticker visible on windshield.';
  analysis.extractedText = [
    { text: '2023 Honda Accord EX-L', confidence: 0.95, textType: 'label' },
    { text: '$28,995', confidence: 0.97, textType: 'price' },
    { text: 'Stock #: A4782', confidence: 0.9, textType: 'label' },
    { text: '32,450 miles', confidence: 0.88, textType: 'label' },
    { text: 'VIN: 1HGCV2F56PA012345', confidence: 0.85, textType: 'label' },
  ];
  analysis.detectedObjects = [
    { label: 'car', confidence: 0.99 },
    { label: 'price_sticker', confidence: 0.93 },
    { label: 'license_plate', confidence: 0.85 },
  ];
  return analysis;
}

function fillProperty(analysis: VisionAnalysis): VisionAnalysis {
  analysis.sceneDescription = 'Living room interior during a home inspection. Water stain visible on ceiling.';
  analysis.extractedText = [];
  analysis.detectedObjects = [
    { label: 'water_stain', confidence: 0.87, attributes: { location: 'ceiling', severity: 'moderate' } },
    { label: 'couch', confidence: 0.95 },
    { label: 'window', confidence: 0.92 },
    { label: 'hardwood_floor', confidence: 0.9 },
    { label: 'ceiling_fan', confidence: 0.88 },
  ];
  return analysis;
}

function fillWhiteboard(analysis: VisionAnalysis): VisionAnalysis {
  analysis.sceneDescription = 'Meeting room whiteboard with architectural diagrams and action items.';
  analysis.extractedText = [
    { text: 'Q2 Product Roadmap', confidence: 0.95, textType: 'document' },
    { text: 'Action: Dave — finalize API spec by Friday', confidence: 0.88, textType: 'document' },
    { text: 'Decision: Go with microservices architecture', confidence: 0.9, textType: 'document' },
    { text: 'TODO: Review security audit results', confidence: 0.85, textType: 'document' },
    { text: 'Budget: $45K for Q2 infrastructure', confidence: 0.87, textType: 'document' },
  ];
  return analysis;
}

function fillKitchen(analysis: VisionAnalysis): VisionAnalysis {
  analysis.sceneDescription = 'Home kitchen with ingredients laid out on counter. Recipe book open.';
  analysis.extractedText = [
    { text: '350°F for 25 minutes', confidence: 0.92, textType: 'document' },
    { text: '2 cups all-purpose flour', confidence: 0.9, textType: 'document' },
    { text: '1 tsp baking soda', confidence: 0.88, textType: 'document' },
  ];
  analysis.detectedObjects = [
    { label: 'flour_bag', confidence: 0.9 },
    { label: 'eggs', confidence: 0.95 },
    { label: 'mixing_bowl', confidence: 0.88 },
    { label: 'oven', confidence: 0.97 },
    { label: 'recipe_book', confidence: 0.85 },
  ];
  return analysis;
}

function fillWorkshop(analysis: VisionAnalysis): VisionAnalysis {
  analysis.sceneDescription = 'Workshop bench with tools and a partially assembled project.';
  analysis.extractedText = [
    { text: 'M8 x 1.25', confidence: 0.85, textType: 'label' },
    { text: 'Torque: 25 Nm', confidence: 0.88, textType: 'label' },
  ];
  analysis.detectedObjects = [
    { label: 'wrench', confidence: 0.92 },
    { label: 'bolt', confidence: 0.88, attributes: { size: 'M8', thread: '1.25' } },
    { label: 'drill', confidence: 0.95 },
    { label: 'workbench', confidence: 0.97 },
  ];
  return analysis;
}

function makeProduct(
  name: string, brand: string, category: string, variant: string,
  upc: string, count: number, confidence: number, price: number
): DetectedProduct {
  return {
    name, brand, category, variant, upc,
    confidence,
    identificationMethod: 'barcode',
    estimatedCount: count,
    countConfidence: confidence * 0.9,
    priceOnShelf: price,
  };
}

// ─── Voice Command Generators ───────────────────────────────────

export function generateVoiceCommand(
  intent: VoiceIntent,
  rawText: string,
  params?: Record<string, string>
): VoiceCommand {
  return {
    rawText,
    intent,
    params: params ?? {},
    confidence: 0.85 + Math.random() * 0.15,
    timestamp: new Date().toISOString(),
  };
}

// ─── Built-in Scenarios ─────────────────────────────────────────

export const INVENTORY_DEMO: SimulationScenario = {
  id: 'inventory-walkthrough',
  name: 'Inventory Vision Demo',
  description: 'Walk through a grocery store aisle counting products. The core money feature.',
  features: ['Inventory Vision', 'Voice Commands', 'Product ID', 'Export'],
  estimatedDurationSec: 60,
  steps: [
    {
      description: 'Narrator introduces the demo',
      type: 'narration',
      delayMs: 0,
      narration: 'Welcome to Inventory Vision. Watch as we count an entire grocery aisle just by walking through it.',
    },
    {
      description: 'User starts inventory via voice',
      type: 'voice',
      delayMs: 2000,
      voiceCommand: generateVoiceCommand('inventory_start', 'Start inventory'),
      expectedResponse: 'Inventory session started',
    },
    {
      description: 'User sets aisle',
      type: 'voice',
      delayMs: 1500,
      voiceCommand: generateVoiceCommand('inventory_set_aisle', 'This is aisle 3', { aisle: '3' }),
      expectedResponse: 'Aisle set to 3',
    },
    {
      description: 'First shelf scan — cereal section',
      type: 'image',
      delayMs: 3000,
      analysis: generateAnalysis('retail_shelf'),
    },
    {
      description: 'Narrator explains what happened',
      type: 'narration',
      delayMs: 1000,
      narration: '5 products identified. 2 barcodes scanned. Total count: 21 items. Let me keep walking.',
    },
    {
      description: 'Second shelf scan — more cereals',
      type: 'image',
      delayMs: 3000,
      analysis: generateAnalysis('retail_shelf', {
        imageId: 'sim-shelf-002',
        sceneDescription: 'Continuation of cereal aisle. Organic and specialty cereals.',
      }),
    },
    {
      description: 'User annotates an issue',
      type: 'voice',
      delayMs: 2000,
      voiceCommand: generateVoiceCommand('inventory_annotate', 'Note: empty spot here, looks like they\'re out of Grape Nuts'),
    },
    {
      description: 'Third scan — snacks section',
      type: 'image',
      delayMs: 3000,
      analysis: generateAnalysis('retail_shelf', {
        imageId: 'sim-shelf-003',
        sceneDescription: 'Snack aisle with chips, crackers, and trail mix.',
      }),
    },
    {
      description: 'User completes inventory',
      type: 'voice',
      delayMs: 2000,
      voiceCommand: generateVoiceCommand('inventory_stop', 'Stop inventory'),
      expectedResponse: 'complete',
    },
    {
      description: 'Summary narration',
      type: 'narration',
      delayMs: 1000,
      narration: 'Inventory complete. 47 products counted across aisle 3 in under 2 minutes. Report exported to CSV. That would have taken a human team 45 minutes with a clipboard.',
    },
  ],
};

export const NETWORKING_DEMO: SimulationScenario = {
  id: 'conference-networking',
  name: 'Conference Networking Demo',
  description: 'Scan conference badges and get instant background intel on who you\'re talking to.',
  features: ['Networking Agent', 'Badge OCR', 'Web Research', 'Voice Briefing'],
  estimatedDurationSec: 45,
  steps: [
    {
      description: 'Arriving at conference',
      type: 'narration',
      delayMs: 0,
      narration: 'You just arrived at TechCrunch Disrupt. Let\'s network smarter.',
    },
    {
      description: 'Scan first person\'s badge',
      type: 'image',
      delayMs: 3000,
      analysis: generateAnalysis('person'),
    },
    {
      description: 'AI provides briefing',
      type: 'narration',
      delayMs: 1500,
      narration: 'Sarah Chen, VP of Engineering at Stripe. They just raised $6.5 billion Series I. Try asking about their new developer experience platform.',
    },
    {
      description: 'Second person at the drinks table',
      type: 'image',
      delayMs: 4000,
      analysis: generateAnalysis('person', {
        imageId: 'sim-person-002',
        sceneDescription: 'Person wearing a startup hoodie with a conference badge.',
        extractedText: [
          { text: 'Marcus Rivera', confidence: 0.94, textType: 'label' },
          { text: 'CTO & Co-founder', confidence: 0.9, textType: 'label' },
          { text: 'NeuralPath AI', confidence: 0.92, textType: 'label' },
          { text: '@marcusrivera', confidence: 0.87, textType: 'label' },
        ],
      }),
    },
    {
      description: 'AI briefing on second person',
      type: 'narration',
      delayMs: 1500,
      narration: 'Marcus Rivera, CTO of NeuralPath AI. Early stage startup, Y Combinator W26. Building edge AI inference. You share a background in computer vision — great conversation starter.',
    },
    {
      description: 'User asks for contact review',
      type: 'voice',
      delayMs: 2000,
      voiceCommand: generateVoiceCommand('status_report', 'How many people have I met today?'),
    },
    {
      description: 'Contact summary',
      type: 'narration',
      delayMs: 1000,
      narration: 'You\'ve scanned 2 contacts today. Both saved to your CRM. Want me to draft follow-up emails?',
    },
  ],
};

export const SECURITY_DEMO: SimulationScenario = {
  id: 'security-scan',
  name: 'Security Agent Demo',
  description: 'Detect threats: QR code phishing, contract traps, suspicious activity.',
  features: ['Security Agent', 'QR Analysis', 'Contract Review', 'Threat Detection'],
  estimatedDurationSec: 40,
  steps: [
    {
      description: 'Walking past a suspicious QR code poster',
      type: 'narration',
      delayMs: 0,
      narration: 'Let\'s test the security features. Looking at a QR code on a random poster.',
    },
    {
      description: 'QR code scan',
      type: 'image',
      delayMs: 2000,
      analysis: generateAnalysis('document', {
        imageId: 'sim-qr-001',
        sceneDescription: 'A poster with a QR code advertising a free gift card.',
        extractedText: [
          { text: 'SCAN FOR FREE $100 GIFT CARD!', confidence: 0.95, textType: 'sign' },
          { text: 'Limited time offer!', confidence: 0.9, textType: 'sign' },
        ],
        barcodes: [
          { data: 'https://paypa1-verify.xyz/claim?ref=abc123', format: 'QR', confidence: 0.98 },
        ],
      }),
    },
    {
      description: 'Security alert',
      type: 'narration',
      delayMs: 500,
      narration: 'WARNING: This QR code is a phishing attempt. The URL mimics PayPal but uses a suspicious .xyz domain with a "1" instead of "l". Do NOT scan this with your phone.',
    },
    {
      description: 'Looking at a contract',
      type: 'image',
      delayMs: 3000,
      analysis: generateAnalysis('document'),
    },
    {
      description: 'Contract analysis',
      type: 'narration',
      delayMs: 1000,
      narration: 'Contract flagged 3 concerns: auto-renewal clause every 12 months, $500 early termination fee, and mandatory binding arbitration. Read carefully before signing.',
    },
  ],
};

export const DEAL_ANALYSIS_DEMO: SimulationScenario = {
  id: 'deal-analysis',
  name: 'Deal Analysis Demo',
  description: 'Real-time price intelligence while shopping. Is it a deal or a rip-off?',
  features: ['Deal Agent', 'Price Comparison', 'Market Research', 'Voice Verdict'],
  estimatedDurationSec: 35,
  steps: [
    {
      description: 'At a car dealership',
      type: 'narration',
      delayMs: 0,
      narration: 'Walking a car dealership lot. Let\'s see what the AI thinks of these prices.',
    },
    {
      description: 'Looking at a car',
      type: 'image',
      delayMs: 3000,
      analysis: generateAnalysis('vehicle'),
    },
    {
      description: 'Price verdict',
      type: 'narration',
      delayMs: 1500,
      narration: '2023 Honda Accord EX-L asking $28,995 with 32K miles. KBB fair market value: $26,800. This is $2,195 over market. Overpriced. Negotiate or walk.',
    },
    {
      description: 'User asks for negotiation tips',
      type: 'voice',
      delayMs: 2000,
      voiceCommand: generateVoiceCommand('price_check', 'Give me negotiation leverage'),
    },
    {
      description: 'Negotiation intel',
      type: 'narration',
      delayMs: 1000,
      narration: 'Leverage: 1. It\'s been on the lot 45 days — dealers get nervous at 60. 2. Similar Accords on CarGurus within 50 miles start at $26,400. 3. Offer $25,500 and settle at $27,000.',
    },
  ],
};

export const FULL_PLATFORM_DEMO: SimulationScenario = {
  id: 'full-platform',
  name: 'Full Platform Showcase',
  description: 'Everything the glasses can do in one walkthrough. The investor pitch demo.',
  features: ['All Features'],
  estimatedDurationSec: 120,
  steps: [
    {
      description: 'Platform intro',
      type: 'narration',
      delayMs: 0,
      narration: 'Welcome to Ray-Bans times OpenClaw. Smart glasses that understand what you see. Let me show you.',
    },
    // Inventory
    {
      description: 'Start inventory demo segment',
      type: 'narration',
      delayMs: 3000,
      narration: 'Feature 1: Inventory Vision. Walk any store aisle, count every product, hands-free.',
    },
    {
      description: 'Voice: start inventory',
      type: 'voice',
      delayMs: 2000,
      voiceCommand: generateVoiceCommand('inventory_start', 'Start inventory'),
    },
    {
      description: 'Scan shelf',
      type: 'image',
      delayMs: 2000,
      analysis: generateAnalysis('retail_shelf'),
    },
    {
      description: 'Inventory result',
      type: 'narration',
      delayMs: 1000,
      narration: '5 products identified, 21 items counted in 3 seconds. That replaces a $10,000 inventory service.',
    },
    // Networking
    {
      description: 'Transition to networking',
      type: 'narration',
      delayMs: 3000,
      narration: 'Feature 2: Conference Networking. Scan any badge, get instant intel.',
    },
    {
      description: 'Scan badge',
      type: 'image',
      delayMs: 2000,
      analysis: generateAnalysis('person'),
    },
    {
      description: 'Networking result',
      type: 'narration',
      delayMs: 1000,
      narration: 'Sarah Chen from Stripe. Background research complete. Suggested ice breaker ready.',
    },
    // Security
    {
      description: 'Transition to security',
      type: 'narration',
      delayMs: 3000,
      narration: 'Feature 3: Security. Your personal threat detector.',
    },
    {
      description: 'QR scan',
      type: 'image',
      delayMs: 2000,
      analysis: generateAnalysis('document', {
        barcodes: [{ data: 'https://g00gle-login.xyz/auth', format: 'QR', confidence: 0.98 }],
      }),
    },
    {
      description: 'Security alert',
      type: 'narration',
      delayMs: 500,
      narration: 'THREAT DETECTED. Phishing QR code impersonating Google. Do not scan.',
    },
    // Meeting
    {
      description: 'Transition to meeting',
      type: 'narration',
      delayMs: 3000,
      narration: 'Feature 4: Meeting Intelligence. Never forget an action item again.',
    },
    {
      description: 'Whiteboard capture',
      type: 'image',
      delayMs: 2000,
      analysis: generateAnalysis('whiteboard'),
    },
    {
      description: 'Meeting result',
      type: 'narration',
      delayMs: 1000,
      narration: 'Captured: Q2 roadmap, 1 decision about microservices, 1 action item for Dave, and a budget note. All searchable later.',
    },
    // Closing
    {
      description: 'Demo closing',
      type: 'narration',
      delayMs: 3000,
      narration: 'That\'s 4 of our 11 AI agents. Each one saves hours per week. Inventory Vision alone replaces a $10,000 service. We charge $79 per month. Questions?',
    },
  ],
};

export const BUILT_IN_SCENARIOS: SimulationScenario[] = [
  INVENTORY_DEMO,
  NETWORKING_DEMO,
  SECURITY_DEMO,
  DEAL_ANALYSIS_DEMO,
  FULL_PLATFORM_DEMO,
];
