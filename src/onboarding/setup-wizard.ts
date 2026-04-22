/**
 * Setup Wizard Engine — First-run experience for Ray-Bans × OpenClaw.
 *
 * Guides new users through:
 * 1. Welcome & account creation
 * 2. Hardware pairing (Ray-Bans ↔ phone ↔ OpenClaw)
 * 3. Agent configuration (which features to enable)
 * 4. Store profile setup (for inventory users)
 * 5. First inventory session walkthrough
 * 6. Export & results review
 *
 * Designed to be voice-first (TTS prompts + voice responses)
 * with a companion web/mobile UI showing progress.
 *
 * The goal: Dorrian's cousin puts on glasses, follows voice prompts,
 * and completes his first inventory in under 30 minutes of setup.
 */

import { EventEmitter } from 'eventemitter3';

// ─── Types ──────────────────────────────────────────────────────

export type WizardStepId =
  | 'welcome'
  | 'account'
  | 'hardware_pairing'
  | 'connectivity_test'
  | 'agent_selection'
  | 'store_profile'
  | 'voice_calibration'
  | 'first_scan_tutorial'
  | 'practice_scan'
  | 'subscription'
  | 'complete';

export type WizardStepStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface WizardStep {
  /** Step identifier */
  id: WizardStepId;
  /** Display order */
  order: number;
  /** Human-readable title */
  title: string;
  /** Description shown to user */
  description: string;
  /** TTS prompt to read aloud */
  voicePrompt: string;
  /** Can this step be skipped? */
  skippable: boolean;
  /** Current status */
  status: WizardStepStatus;
  /** Data collected in this step */
  data: Record<string, unknown>;
  /** When this step was started */
  startedAt?: string;
  /** When this step was completed */
  completedAt?: string;
  /** Duration in seconds */
  durationSec?: number;
  /** Estimated time to complete (seconds) */
  estimatedTimeSec: number;
  /** Prerequisites: step IDs that must be completed first */
  prerequisites: WizardStepId[];
  /** Help text for troubleshooting */
  helpText: string;
  /** UI component type for the companion app */
  uiComponent: string;
  /** Voice commands accepted in this step */
  voiceCommands: string[];
}

export interface StoreProfile {
  /** Store name */
  name: string;
  /** Store type */
  type: StoreType;
  /** Approximate number of SKUs */
  estimatedSKUs: number;
  /** Number of aisles */
  aisleCount: number;
  /** Address (optional) */
  address?: string;
  /** POS system (for future integration) */
  posSystem?: string;
  /** Categories tracked */
  categories: string[];
  /** Average shelf depth */
  defaultDepthFactor: number;
  /** Auto-snap interval preference */
  autoSnapIntervalSec: number;
}

export type StoreType =
  | 'convenience'
  | 'grocery'
  | 'hardware'
  | 'clothing'
  | 'electronics'
  | 'pharmacy'
  | 'warehouse'
  | 'specialty'
  | 'other';

export interface HardwarePairingStatus {
  /** Are the Ray-Bans connected via Bluetooth? */
  glassesConnected: boolean;
  /** Is the phone/relay running OpenClaw node? */
  nodeRunning: boolean;
  /** Can we take a camera snap? */
  cameraWorking: boolean;
  /** Can we play TTS through glasses speaker? */
  audioWorking: boolean;
  /** GPS available? */
  gpsAvailable: boolean;
  /** Battery level of glasses (0-100) */
  glassesBattery?: number;
  /** Device ID of the paired node */
  deviceId?: string;
  /** Last successful ping time */
  lastPingAt?: string;
}

export interface WizardProgress {
  /** Wizard session ID */
  sessionId: string;
  /** Current step */
  currentStep: WizardStepId;
  /** All steps with status */
  steps: WizardStep[];
  /** Overall progress 0-1 */
  progress: number;
  /** Total steps */
  totalSteps: number;
  /** Completed steps */
  completedSteps: number;
  /** Estimated time remaining (seconds) */
  estimatedTimeRemainingSec: number;
  /** Hardware pairing status */
  hardwareStatus: HardwarePairingStatus;
  /** Store profile (populated during setup) */
  storeProfile?: StoreProfile;
  /** When the wizard started */
  startedAt: string;
  /** When the wizard completed */
  completedAt?: string;
}

export interface WizardConfig {
  /** Skip non-essential steps for experienced users */
  quickMode: boolean;
  /** Voice-only mode (no companion screen) */
  voiceOnlyMode: boolean;
  /** Default store type (pre-fill) */
  defaultStoreType?: StoreType;
  /** Auto-advance to next step on completion */
  autoAdvance: boolean;
  /** Timeout per step before offering help (seconds) */
  stepTimeoutSec: number;
  /** Celebration sounds/TTS on milestone completion */
  celebrationEnabled: boolean;
  /** Language for prompts */
  language: string;
}

const DEFAULT_WIZARD_CONFIG: WizardConfig = {
  quickMode: false,
  voiceOnlyMode: false,
  autoAdvance: true,
  stepTimeoutSec: 300, // 5 minutes
  celebrationEnabled: true,
  language: 'en',
};

// ─── Events ─────────────────────────────────────────────────────

export interface WizardEvents {
  'step:started': (stepId: WizardStepId) => void;
  'step:completed': (stepId: WizardStepId, data: Record<string, unknown>) => void;
  'step:skipped': (stepId: WizardStepId) => void;
  'step:failed': (stepId: WizardStepId, error: string) => void;
  'step:timeout': (stepId: WizardStepId) => void;
  'wizard:started': (sessionId: string) => void;
  'wizard:completed': (progress: WizardProgress) => void;
  'wizard:abandoned': (progress: WizardProgress) => void;
  'hardware:status-changed': (status: HardwarePairingStatus) => void;
  'voice:prompt': (text: string, stepId: WizardStepId) => void;
  'progress:updated': (progress: number) => void;
}

// ─── Store Type Presets ─────────────────────────────────────────

export interface StorePreset {
  type: StoreType;
  label: string;
  icon: string;
  description: string;
  defaults: {
    estimatedSKUs: number;
    aisleCount: number;
    autoSnapIntervalSec: number;
    defaultDepthFactor: number;
    categories: string[];
  };
}

const STORE_PRESETS: StorePreset[] = [
  {
    type: 'convenience',
    label: 'Convenience Store',
    icon: '🏪',
    description: 'Small retail: gas station shops, bodegas, corner stores. 500-3,000 SKUs.',
    defaults: {
      estimatedSKUs: 1500,
      aisleCount: 6,
      autoSnapIntervalSec: 3,
      defaultDepthFactor: 2,
      categories: ['beverages', 'snacks', 'tobacco', 'candy', 'dairy', 'frozen', 'grocery', 'health', 'household'],
    },
  },
  {
    type: 'grocery',
    label: 'Grocery Store',
    icon: '🛒',
    description: 'Full-size supermarket or grocery. 10,000-50,000 SKUs.',
    defaults: {
      estimatedSKUs: 25000,
      aisleCount: 14,
      autoSnapIntervalSec: 2,
      defaultDepthFactor: 3,
      categories: ['produce', 'dairy', 'meat', 'seafood', 'bakery', 'deli', 'frozen', 'beverages', 'snacks', 'cereal', 'canned', 'condiments', 'baking', 'health', 'household', 'pet'],
    },
  },
  {
    type: 'hardware',
    label: 'Hardware Store',
    icon: '🔧',
    description: 'Tools, building materials, home improvement. 5,000-30,000 SKUs.',
    defaults: {
      estimatedSKUs: 15000,
      aisleCount: 12,
      autoSnapIntervalSec: 3,
      defaultDepthFactor: 2,
      categories: ['tools', 'fasteners', 'electrical', 'plumbing', 'lumber', 'paint', 'garden', 'safety', 'automotive'],
    },
  },
  {
    type: 'clothing',
    label: 'Clothing Store',
    icon: '👕',
    description: 'Apparel and fashion retail. 1,000-10,000 SKUs.',
    defaults: {
      estimatedSKUs: 3000,
      aisleCount: 8,
      autoSnapIntervalSec: 4,
      defaultDepthFactor: 1,
      categories: ['tops', 'bottoms', 'dresses', 'outerwear', 'shoes', 'accessories', 'undergarments', 'activewear'],
    },
  },
  {
    type: 'electronics',
    label: 'Electronics Store',
    icon: '📱',
    description: 'Consumer electronics, computers, accessories. 2,000-15,000 SKUs.',
    defaults: {
      estimatedSKUs: 5000,
      aisleCount: 10,
      autoSnapIntervalSec: 3,
      defaultDepthFactor: 1,
      categories: ['phones', 'computers', 'tablets', 'audio', 'gaming', 'cameras', 'accessories', 'cables', 'storage', 'smart-home'],
    },
  },
  {
    type: 'pharmacy',
    label: 'Pharmacy / Drug Store',
    icon: '💊',
    description: 'Pharmacy, health & beauty, front-store retail. 5,000-20,000 SKUs.',
    defaults: {
      estimatedSKUs: 10000,
      aisleCount: 10,
      autoSnapIntervalSec: 3,
      defaultDepthFactor: 3,
      categories: ['otc-medicine', 'vitamins', 'first-aid', 'personal-care', 'beauty', 'baby', 'household', 'snacks', 'beverages', 'seasonal'],
    },
  },
  {
    type: 'warehouse',
    label: 'Warehouse / Distribution',
    icon: '🏭',
    description: 'Bulk storage, pallets, distribution center. Variable SKUs.',
    defaults: {
      estimatedSKUs: 5000,
      aisleCount: 20,
      autoSnapIntervalSec: 4,
      defaultDepthFactor: 5,
      categories: ['pallets', 'cases', 'loose', 'overstock', 'returns', 'inbound', 'outbound'],
    },
  },
  {
    type: 'specialty',
    label: 'Specialty Store',
    icon: '🎨',
    description: 'Niche retail: wine, crafts, sports, books, etc. Variable SKUs.',
    defaults: {
      estimatedSKUs: 3000,
      aisleCount: 6,
      autoSnapIntervalSec: 3,
      defaultDepthFactor: 2,
      categories: ['general'],
    },
  },
  {
    type: 'other',
    label: 'Other / Custom',
    icon: '📦',
    description: 'Custom store type. Set your own categories and layout.',
    defaults: {
      estimatedSKUs: 2000,
      aisleCount: 8,
      autoSnapIntervalSec: 3,
      defaultDepthFactor: 2,
      categories: ['general'],
    },
  },
];

// ─── Tutorial Steps for First Scan ──────────────────────────────

export interface TutorialAction {
  /** Instruction text */
  instruction: string;
  /** TTS prompt */
  voicePrompt: string;
  /** Expected outcome */
  expectedOutcome: string;
  /** Timeout before hint (seconds) */
  hintAfterSec: number;
  /** Hint text if user is stuck */
  hint: string;
  /** Is this action required or optional? */
  required: boolean;
}

const FIRST_SCAN_TUTORIAL: TutorialAction[] = [
  {
    instruction: 'Look at a shelf with products facing you.',
    voicePrompt: 'Look at a shelf with products facing you. I\'ll identify what I see.',
    expectedOutcome: 'At least one product identified',
    hintAfterSec: 15,
    hint: 'Try to get a clear view of the product labels and barcodes. Stand about 3 feet from the shelf.',
    required: true,
  },
  {
    instruction: 'Say "This is aisle 1" to set your location.',
    voicePrompt: 'Now say "this is aisle 1" to tell me where we are.',
    expectedOutcome: 'Aisle set via voice command',
    hintAfterSec: 10,
    hint: 'Say "this is aisle 1" or "aisle one" clearly.',
    required: true,
  },
  {
    instruction: 'Walk slowly past the shelf. I\'ll count automatically.',
    voicePrompt: 'Great! Now walk slowly along the shelf. I\'ll count products as you go. Keep a steady pace.',
    expectedOutcome: 'Multiple products counted during walk',
    hintAfterSec: 20,
    hint: 'Walk at about half your normal speed. I capture images every few seconds.',
    required: true,
  },
  {
    instruction: 'Say "How many items?" to hear your progress.',
    voicePrompt: 'Try asking "how many items?" and I\'ll tell you the count so far.',
    expectedOutcome: 'Status report delivered via TTS',
    hintAfterSec: 10,
    hint: 'Say "how many items" or "status report".',
    required: false,
  },
  {
    instruction: 'Point at a product and say "This is 12 of Coca-Cola."',
    voicePrompt: 'See a product you recognize? Point at it and say something like "this is 12 of Coca-Cola" to override my count.',
    expectedOutcome: 'Manual count override recorded',
    hintAfterSec: 15,
    hint: 'Say "this is" followed by a number and the product name.',
    required: false,
  },
  {
    instruction: 'Say "Stop inventory" when you\'re done.',
    voicePrompt: 'When you\'re ready to finish, say "stop inventory" and I\'ll generate your report.',
    expectedOutcome: 'Inventory session stopped',
    hintAfterSec: 10,
    hint: 'Say "stop inventory" or "end inventory".',
    required: true,
  },
];

// ─── Setup Wizard Implementation ────────────────────────────────

export class SetupWizard extends EventEmitter<WizardEvents> {
  private config: WizardConfig;
  private progress: WizardProgress;
  private stepTimeouts: Map<WizardStepId, ReturnType<typeof setTimeout>> = new Map();

  constructor(config: Partial<WizardConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WIZARD_CONFIG, ...config };
    this.progress = this.initializeProgress();
  }

  // ─── Initialization ─────────────────────────────────────────

  private initializeProgress(): WizardProgress {
    const steps = this.buildSteps();

    return {
      sessionId: `wizard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      currentStep: 'welcome',
      steps,
      progress: 0,
      totalSteps: steps.length,
      completedSteps: 0,
      estimatedTimeRemainingSec: steps.reduce((s, step) => s + step.estimatedTimeSec, 0),
      hardwareStatus: {
        glassesConnected: false,
        nodeRunning: false,
        cameraWorking: false,
        audioWorking: false,
        gpsAvailable: false,
      },
      startedAt: new Date().toISOString(),
    };
  }

  private buildSteps(): WizardStep[] {
    const steps: WizardStep[] = [
      {
        id: 'welcome',
        order: 0,
        title: 'Welcome to Inventory Vision',
        description: 'Let\'s get you set up. This takes about 15 minutes.',
        voicePrompt: 'Welcome to Inventory Vision! I\'m your AI inventory assistant. Let\'s get set up — it takes about 15 minutes. Say "let\'s go" when you\'re ready.',
        skippable: false,
        status: 'pending',
        data: {},
        estimatedTimeSec: 30,
        prerequisites: [],
        helpText: 'Just say "let\'s go" or "start" to begin.',
        uiComponent: 'WelcomeScreen',
        voiceCommands: ['let\'s go', 'start', 'begin', 'ready', 'next'],
      },
      {
        id: 'account',
        order: 1,
        title: 'Create Your Account',
        description: 'Email and password for your inventory dashboard.',
        voicePrompt: 'First, let\'s set up your account. You can do this on the companion screen, or I\'ll walk you through it by voice.',
        skippable: true,
        status: 'pending',
        data: {},
        estimatedTimeSec: 60,
        prerequisites: ['welcome'],
        helpText: 'Enter your email address on the companion screen, or say "skip" to create an account later.',
        uiComponent: 'AccountSetup',
        voiceCommands: ['skip', 'next', 'done'],
      },
      {
        id: 'hardware_pairing',
        order: 2,
        title: 'Connect Your Glasses',
        description: 'Pair your Ray-Bans with OpenClaw.',
        voicePrompt: 'Now let\'s connect your glasses. Make sure your Ray-Bans are on and Bluetooth is enabled on your phone. I\'ll check the connection.',
        skippable: false,
        status: 'pending',
        data: {},
        estimatedTimeSec: 120,
        prerequisites: ['welcome'],
        helpText: 'Ensure Ray-Bans are powered on, Meta View app is open, and Bluetooth is enabled. The glasses should appear as a paired device.',
        uiComponent: 'HardwarePairing',
        voiceCommands: ['retry', 'check connection', 'skip', 'help'],
      },
      {
        id: 'connectivity_test',
        order: 3,
        title: 'Test Your Setup',
        description: 'Quick test: camera, audio, and GPS.',
        voicePrompt: 'Let\'s run a quick test. I\'m going to take a photo, play a sound, and check your GPS. Hold still for a moment.',
        skippable: false,
        status: 'pending',
        data: {},
        estimatedTimeSec: 45,
        prerequisites: ['hardware_pairing'],
        helpText: 'This tests that the camera can capture images, the speaker works for voice feedback, and GPS is available for location tracking.',
        uiComponent: 'ConnectivityTest',
        voiceCommands: ['retry', 'test again', 'next', 'skip'],
      },
      {
        id: 'agent_selection',
        order: 4,
        title: 'Choose Your Features',
        description: 'Select which AI features to enable.',
        voicePrompt: 'Which features would you like to use? Inventory scanning is on by default. You can also enable price checking, security alerts, and more. Say "inventory only" for just the basics, or "all features" for everything.',
        skippable: true,
        status: 'pending',
        data: {},
        estimatedTimeSec: 60,
        prerequisites: ['welcome'],
        helpText: 'Choose which AI agents to enable. You can change this anytime in settings.',
        uiComponent: 'AgentSelection',
        voiceCommands: ['inventory only', 'all features', 'next', 'skip'],
      },
      {
        id: 'store_profile',
        order: 5,
        title: 'Set Up Your Store',
        description: 'Tell me about your store so I can optimize for it.',
        voicePrompt: 'Tell me about your store. What kind of store is it? Say something like "it\'s a convenience store" or "hardware store".',
        skippable: false,
        status: 'pending',
        data: {},
        estimatedTimeSec: 90,
        prerequisites: ['welcome'],
        helpText: 'I\'ll pre-configure categories, scan speed, and shelf settings based on your store type.',
        uiComponent: 'StoreProfile',
        voiceCommands: [
          'convenience store', 'grocery store', 'hardware store',
          'clothing store', 'electronics store', 'pharmacy',
          'warehouse', 'specialty store', 'other', 'next', 'skip',
        ],
      },
      {
        id: 'voice_calibration',
        order: 6,
        title: 'Voice Calibration',
        description: 'Let me learn your voice for better accuracy.',
        voicePrompt: 'Let\'s calibrate your voice. Please say: "Start inventory in aisle one."',
        skippable: true,
        status: 'pending',
        data: {},
        estimatedTimeSec: 45,
        prerequisites: ['hardware_pairing'],
        helpText: 'Speak naturally at the volume you\'d use in the store. This helps me understand you better in noisy environments.',
        uiComponent: 'VoiceCalibration',
        voiceCommands: ['start inventory in aisle one', 'skip', 'next', 'retry'],
      },
      {
        id: 'first_scan_tutorial',
        order: 7,
        title: 'Your First Scan',
        description: 'Walk through the scanning tutorial step by step.',
        voicePrompt: 'Time for your first scan! I\'ll walk you through it step by step. First, look at a shelf with products facing you.',
        skippable: false,
        status: 'pending',
        data: {},
        estimatedTimeSec: 180,
        prerequisites: ['hardware_pairing', 'store_profile'],
        helpText: 'Follow the voice prompts. I\'ll guide you through scanning a shelf, setting locations, and using voice commands.',
        uiComponent: 'ScanTutorial',
        voiceCommands: ['help', 'repeat', 'skip step', 'next', 'what do I do'],
      },
      {
        id: 'practice_scan',
        order: 8,
        title: 'Practice Run',
        description: 'Try scanning one full aisle on your own.',
        voicePrompt: 'Now try on your own! Walk down one aisle at your normal pace. I\'ll count everything I see. Say "start inventory" to begin.',
        skippable: true,
        status: 'pending',
        data: {},
        estimatedTimeSec: 120,
        prerequisites: ['first_scan_tutorial'],
        helpText: 'This is a practice run. Walk at a comfortable pace. I\'ll give you feedback as you go.',
        uiComponent: 'PracticeScan',
        voiceCommands: ['start inventory', 'stop inventory', 'pause', 'resume', 'how many items', 'status', 'skip'],
      },
      {
        id: 'subscription',
        order: 9,
        title: 'Choose Your Plan',
        description: 'Select a subscription plan or continue with free trial.',
        voicePrompt: 'You\'re all set up! You have a 14-day free trial. You can choose a plan anytime from the dashboard.',
        skippable: true,
        status: 'pending',
        data: {},
        estimatedTimeSec: 60,
        prerequisites: ['welcome'],
        helpText: 'Choose a plan or continue with the free trial. You won\'t be charged during the trial.',
        uiComponent: 'SubscriptionSelect',
        voiceCommands: ['free trial', 'solo plan', 'skip', 'next', 'tell me about plans'],
      },
      {
        id: 'complete',
        order: 10,
        title: 'All Set!',
        description: 'Setup complete. Ready to start your first real inventory.',
        voicePrompt: 'Setup complete! You\'re ready to start your first real inventory. Just say "start inventory" anytime. Good luck!',
        skippable: false,
        status: 'pending',
        data: {},
        estimatedTimeSec: 15,
        prerequisites: [],
        helpText: 'You can start a real inventory session anytime by saying "start inventory".',
        uiComponent: 'SetupComplete',
        voiceCommands: ['start inventory', 'done', 'thanks'],
      },
    ];

    // In quick mode, mark tutorial steps as skippable
    if (this.config.quickMode) {
      for (const step of steps) {
        if (['voice_calibration', 'practice_scan', 'first_scan_tutorial'].includes(step.id)) {
          step.skippable = true;
        }
      }
    }

    return steps;
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  /**
   * Start the wizard.
   */
  start(): WizardProgress {
    this.progress = this.initializeProgress();
    this.emit('wizard:started', this.progress.sessionId);
    this.goToStep('welcome');
    return this.getProgress();
  }

  /**
   * Get current progress.
   */
  getProgress(): WizardProgress {
    return { ...this.progress };
  }

  /**
   * Get the current step.
   */
  getCurrentStep(): WizardStep | undefined {
    return this.progress.steps.find(s => s.id === this.progress.currentStep);
  }

  /**
   * Get a step by ID.
   */
  getStep(stepId: WizardStepId): WizardStep | undefined {
    return this.progress.steps.find(s => s.id === stepId);
  }

  // ─── Step Navigation ────────────────────────────────────────

  /**
   * Navigate to a specific step.
   */
  goToStep(stepId: WizardStepId): void {
    const step = this.progress.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Unknown step: ${stepId}`);
    }

    // Check prerequisites
    const unmet = step.prerequisites.filter(prereq => {
      const prereqStep = this.progress.steps.find(s => s.id === prereq);
      return !prereqStep || (prereqStep.status !== 'completed' && prereqStep.status !== 'skipped');
    });

    if (unmet.length > 0 && stepId !== 'welcome' && stepId !== 'complete') {
      throw new Error(`Prerequisites not met for "${stepId}": ${unmet.join(', ')}`);
    }

    // Deactivate current step
    const currentStep = this.getCurrentStep();
    if (currentStep && currentStep.status === 'active') {
      // Don't override completed/skipped status
    }

    // Activate new step
    this.progress.currentStep = stepId;
    step.status = 'active';
    step.startedAt = new Date().toISOString();

    // Set timeout
    this.clearStepTimeout(stepId);
    if (this.config.stepTimeoutSec > 0) {
      const timeout = setTimeout(() => {
        this.emit('step:timeout', stepId);
      }, this.config.stepTimeoutSec * 1000);
      this.stepTimeouts.set(stepId, timeout);
    }

    this.emit('step:started', stepId);
    this.emit('voice:prompt', step.voicePrompt, stepId);
  }

  /**
   * Complete the current step and optionally advance.
   */
  completeStep(stepId: WizardStepId, data: Record<string, unknown> = {}): void {
    const step = this.progress.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Unknown step: ${stepId}`);
    }

    step.status = 'completed';
    step.completedAt = new Date().toISOString();
    step.data = { ...step.data, ...data };

    if (step.startedAt) {
      step.durationSec = Math.round(
        (new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 1000
      );
    }

    this.clearStepTimeout(stepId);
    this.updateProgress();
    this.emit('step:completed', stepId, step.data);

    // Auto-advance
    if (this.config.autoAdvance) {
      const nextStep = this.getNextStep();
      if (nextStep) {
        this.goToStep(nextStep.id);
      } else {
        // Wizard complete
        this.completeWizard();
      }
    }
  }

  /**
   * Skip a step.
   */
  skipStep(stepId: WizardStepId): void {
    const step = this.progress.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Unknown step: ${stepId}`);
    }

    if (!step.skippable) {
      throw new Error(`Step "${stepId}" cannot be skipped`);
    }

    step.status = 'skipped';
    step.completedAt = new Date().toISOString();

    this.clearStepTimeout(stepId);
    this.updateProgress();
    this.emit('step:skipped', stepId);

    // Auto-advance
    if (this.config.autoAdvance) {
      const nextStep = this.getNextStep();
      if (nextStep) {
        this.goToStep(nextStep.id);
      } else {
        this.completeWizard();
      }
    }
  }

  /**
   * Mark a step as failed.
   */
  failStep(stepId: WizardStepId, error: string): void {
    const step = this.progress.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Unknown step: ${stepId}`);
    }

    step.status = 'failed';
    step.data.error = error;

    this.clearStepTimeout(stepId);
    this.emit('step:failed', stepId, error);
  }

  /**
   * Get the next uncompleted step.
   */
  getNextStep(): WizardStep | undefined {
    const currentOrder = this.getCurrentStep()?.order ?? -1;

    return this.progress.steps
      .filter(s => s.order > currentOrder && s.status === 'pending')
      .sort((a, b) => a.order - b.order)[0];
  }

  /**
   * Get the previous step.
   */
  getPreviousStep(): WizardStep | undefined {
    const currentOrder = this.getCurrentStep()?.order ?? 999;

    return this.progress.steps
      .filter(s => s.order < currentOrder)
      .sort((a, b) => b.order - a.order)[0];
  }

  /**
   * Go back to the previous step.
   */
  goBack(): void {
    const prev = this.getPreviousStep();
    if (!prev) {
      throw new Error('No previous step');
    }

    // Reset current step to pending
    const current = this.getCurrentStep();
    if (current) {
      current.status = 'pending';
    }

    prev.status = 'pending';
    this.goToStep(prev.id);
  }

  // ─── Hardware Pairing ───────────────────────────────────────

  /**
   * Update hardware pairing status.
   */
  updateHardwareStatus(status: Partial<HardwarePairingStatus>): void {
    this.progress.hardwareStatus = {
      ...this.progress.hardwareStatus,
      ...status,
    };

    this.emit('hardware:status-changed', this.progress.hardwareStatus);
  }

  /**
   * Check if hardware is ready for inventory.
   */
  isHardwareReady(): boolean {
    const h = this.progress.hardwareStatus;
    return h.glassesConnected && h.nodeRunning && h.cameraWorking && h.audioWorking;
  }

  /**
   * Get hardware pairing checklist.
   */
  getHardwareChecklist(): Array<{ label: string; status: boolean; help: string }> {
    const h = this.progress.hardwareStatus;
    return [
      {
        label: 'Glasses connected',
        status: h.glassesConnected,
        help: 'Make sure your Ray-Bans are on and paired via Bluetooth.',
      },
      {
        label: 'OpenClaw node running',
        status: h.nodeRunning,
        help: 'The OpenClaw companion app needs to be running on your phone.',
      },
      {
        label: 'Camera working',
        status: h.cameraWorking,
        help: 'We need camera access. Check permissions in the Meta View app.',
      },
      {
        label: 'Audio working',
        status: h.audioWorking,
        help: 'Glasses speaker needs to be connected for voice feedback.',
      },
      {
        label: 'GPS available',
        status: h.gpsAvailable,
        help: 'GPS helps with store mapping. Optional but recommended.',
      },
    ];
  }

  // ─── Store Profile ──────────────────────────────────────────

  /**
   * Get all store type presets.
   */
  getStorePresets(): StorePreset[] {
    return [...STORE_PRESETS];
  }

  /**
   * Get a specific store type preset.
   */
  getStorePreset(type: StoreType): StorePreset | undefined {
    return STORE_PRESETS.find(p => p.type === type);
  }

  /**
   * Set the store profile from a preset with optional overrides.
   */
  setStoreProfile(type: StoreType, overrides: Partial<StoreProfile> = {}): StoreProfile {
    const preset = this.getStorePreset(type);
    if (!preset) {
      throw new Error(`Unknown store type: ${type}`);
    }

    const profile: StoreProfile = {
      name: overrides.name || '',
      type,
      estimatedSKUs: overrides.estimatedSKUs || preset.defaults.estimatedSKUs,
      aisleCount: overrides.aisleCount || preset.defaults.aisleCount,
      address: overrides.address,
      posSystem: overrides.posSystem,
      categories: overrides.categories || preset.defaults.categories,
      defaultDepthFactor: overrides.defaultDepthFactor || preset.defaults.defaultDepthFactor,
      autoSnapIntervalSec: overrides.autoSnapIntervalSec || preset.defaults.autoSnapIntervalSec,
    };

    this.progress.storeProfile = profile;
    return profile;
  }

  // ─── Tutorial ───────────────────────────────────────────────

  /**
   * Get the first-scan tutorial steps.
   */
  getTutorialActions(): TutorialAction[] {
    return [...FIRST_SCAN_TUTORIAL];
  }

  /**
   * Get a specific tutorial action by index.
   */
  getTutorialAction(index: number): TutorialAction | undefined {
    return FIRST_SCAN_TUTORIAL[index];
  }

  /**
   * Get the number of tutorial actions.
   */
  getTutorialLength(): number {
    return FIRST_SCAN_TUTORIAL.length;
  }

  // ─── Voice Summaries ────────────────────────────────────────

  /**
   * Generate a voice-friendly progress summary.
   */
  getVoiceSummary(): string {
    const completed = this.progress.completedSteps;
    const total = this.progress.totalSteps;
    const remaining = Math.ceil(this.progress.estimatedTimeRemainingSec / 60);
    const current = this.getCurrentStep();

    if (completed === 0) {
      return `Welcome! We have ${total} setup steps. It should take about ${remaining} minutes. Let's get started.`;
    }

    if (completed === total) {
      return 'Setup is complete! You\'re ready to start your first real inventory.';
    }

    return `${completed} of ${total} steps complete. About ${remaining} minutes remaining. ${current ? `Current step: ${current.title}.` : ''}`;
  }

  /**
   * Get a congratulations message for step completion.
   */
  getStepCelebration(stepId: WizardStepId): string | null {
    if (!this.config.celebrationEnabled) return null;

    const celebrations: Partial<Record<WizardStepId, string>> = {
      hardware_pairing: 'Glasses connected! Looking good. 😎',
      connectivity_test: 'All systems go! Camera, audio, and GPS are working perfectly.',
      store_profile: 'Store profile saved. I\'ll optimize my scanning for your store type.',
      first_scan_tutorial: 'You nailed it! You\'re a natural.',
      practice_scan: 'Practice complete! You\'re ready for the real thing.',
      complete: 'Congratulations! Setup is done. Time to count some inventory!',
    };

    return celebrations[stepId] || null;
  }

  // ─── Wizard Completion ──────────────────────────────────────

  /**
   * Complete the wizard.
   */
  private completeWizard(): void {
    this.progress.completedAt = new Date().toISOString();
    this.progress.progress = 1;

    // Mark the complete step
    const completeStep = this.progress.steps.find(s => s.id === 'complete');
    if (completeStep) {
      completeStep.status = 'completed';
      completeStep.completedAt = new Date().toISOString();
    }

    // Clear all timeouts
    for (const [stepId] of this.stepTimeouts) {
      this.clearStepTimeout(stepId);
    }

    this.emit('wizard:completed', this.getProgress());
  }

  /**
   * Abandon the wizard (user quits mid-setup).
   */
  abandon(): void {
    // Clear all timeouts
    for (const [stepId] of this.stepTimeouts) {
      this.clearStepTimeout(stepId);
    }

    this.emit('wizard:abandoned', this.getProgress());
  }

  /**
   * Check if the wizard is complete.
   */
  isComplete(): boolean {
    return this.progress.completedAt !== undefined;
  }

  // ─── Internal ───────────────────────────────────────────────

  private updateProgress(): void {
    const completed = this.progress.steps.filter(
      s => s.status === 'completed' || s.status === 'skipped'
    ).length;

    this.progress.completedSteps = completed;
    this.progress.progress = completed / this.progress.totalSteps;

    // Recalculate estimated time remaining
    const remaining = this.progress.steps.filter(
      s => s.status === 'pending' || s.status === 'active'
    );
    this.progress.estimatedTimeRemainingSec = remaining.reduce(
      (s, step) => s + step.estimatedTimeSec, 0
    );

    this.emit('progress:updated', this.progress.progress);
  }

  private clearStepTimeout(stepId: WizardStepId): void {
    const timeout = this.stepTimeouts.get(stepId);
    if (timeout) {
      clearTimeout(timeout);
      this.stepTimeouts.delete(stepId);
    }
  }

  // ─── Export ─────────────────────────────────────────────────

  /**
   * Export the wizard's collected data (for creating inventory session config).
   */
  exportSetupData(): {
    storeProfile?: StoreProfile;
    selectedAgents: string[];
    hardwareStatus: HardwarePairingStatus;
    completedSteps: WizardStepId[];
    skippedSteps: WizardStepId[];
    totalSetupTimeSec: number;
  } {
    const completedSteps = this.progress.steps
      .filter(s => s.status === 'completed')
      .map(s => s.id);

    const skippedSteps = this.progress.steps
      .filter(s => s.status === 'skipped')
      .map(s => s.id);

    const agentStep = this.progress.steps.find(s => s.id === 'agent_selection');
    const selectedAgents = (agentStep?.data.selectedAgents as string[]) || ['inventory'];

    const totalSetupTimeSec = this.progress.steps
      .filter(s => s.durationSec)
      .reduce((s, step) => s + (step.durationSec || 0), 0);

    return {
      storeProfile: this.progress.storeProfile,
      selectedAgents,
      hardwareStatus: this.progress.hardwareStatus,
      completedSteps,
      skippedSteps,
      totalSetupTimeSec,
    };
  }
}
