/**
 * Context Chain Engine — Feature #10: The Power Move
 *
 * Combines multiple specialist agents into intelligent multi-step workflows
 * that adapt to the user's situation. This is what makes the platform
 * DRAMATICALLY more valuable than individual agents.
 *
 * Example chains:
 *
 * Sales Meeting Chain:
 *   Pre-meeting (calendar trigger) → research attendees → prepare briefing
 *   During meeting → transcription + slides + real-time intel
 *   Post-meeting → summary → action items → follow-up email draft → CRM update
 *
 * Shopping Trip Chain:
 *   Enter store → pull up shopping list → price comparison mode
 *   Per item → snap → compare prices + nutrition check
 *   Checkout → snap receipt → log expenses → check for missed items
 *
 * Travel Chain:
 *   Arrive → translation mode → cultural briefing → local safety notes
 *   Walking → POI identification → restaurant recs → navigation
 *
 * Architecture:
 *   Trigger (calendar/voice/geo/auto) → Chain Definition → Phase Executor
 *   → Agent Orchestrator → Results Aggregator → TTS/Dashboard Delivery
 *
 * @module chains/context-chain-engine
 */

import { EventEmitter } from 'eventemitter3';
import type {
  CapturedImage,
  VisionAnalysis,
  GeoLocation,
} from '../types.js';

// ─── Types ──────────────────────────────────────────────────────

/**
 * Trigger types that can activate a chain.
 */
export type ChainTriggerType =
  | 'voice'       // User says "start sales mode"
  | 'calendar'    // Calendar event about to start
  | 'geo'         // Entered a geofenced area
  | 'time'        // Scheduled time trigger
  | 'scene'       // Scene type detected (retail, office, etc.)
  | 'manual'      // Explicitly started via API/dashboard
  | 'auto';       // Auto-detected from context

/**
 * Defines when a chain should be triggered.
 */
export interface ChainTrigger {
  /** Trigger type */
  type: ChainTriggerType;
  /** Voice phrases that activate this chain */
  voicePhrases?: string[];
  /** Calendar event title patterns (regex) */
  calendarPatterns?: string[];
  /** Geofence area */
  geoFence?: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    label?: string;
  };
  /** Scene types that activate this chain */
  sceneTypes?: string[];
  /** Time-based scheduling (cron-like) */
  schedule?: string;
  /** Priority of this trigger (lower = higher priority) */
  priority?: number;
}

/**
 * Timing configuration for a chain phase.
 */
export interface PhaseTiming {
  /** When this phase should activate relative to the trigger */
  type: 'before' | 'at' | 'during' | 'after' | 'immediate';
  /** Offset in minutes (e.g., 30 = "30 minutes before") */
  offsetMinutes?: number;
  /** Duration limit in minutes */
  maxDurationMinutes?: number;
}

/**
 * A single action within a phase.
 */
export interface ChainAction {
  /** Unique action identifier */
  id: string;
  /** Which agent handles this action */
  agentId: string;
  /** Human-readable description */
  description: string;
  /** Input parameters for the agent */
  params?: Record<string, unknown>;
  /** Actions that must complete before this one starts */
  dependsOn?: string[];
  /** Whether this action is optional (won't fail the phase) */
  optional?: boolean;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Retry count on failure */
  retries?: number;
  /** How to deliver the result */
  delivery?: ActionDelivery;
  /** Condition: only run if this returns true */
  condition?: (context: ChainExecutionContext) => boolean;
}

/**
 * How an action's result should be delivered.
 */
export interface ActionDelivery {
  /** Deliver via TTS */
  tts?: boolean;
  /** Push to dashboard */
  dashboard?: boolean;
  /** Store in memory */
  memory?: boolean;
  /** Send notification */
  notification?: boolean;
  /** Custom delivery channel */
  channel?: string;
}

/**
 * A phase is a group of actions that execute together
 * at a particular timing within the chain.
 */
export interface ChainPhase {
  /** Unique phase identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** When this phase executes */
  timing: PhaseTiming;
  /** Actions to execute in this phase */
  actions: ChainAction[];
  /** Execute actions in parallel (true) or sequence (false) */
  parallel?: boolean;
  /** Continue to next phase even if this one fails */
  continueOnFailure?: boolean;
}

/**
 * A chain definition describes a complete multi-agent workflow.
 */
export interface ChainDefinition {
  /** Unique chain identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this chain does */
  description: string;
  /** What triggers this chain */
  triggers: ChainTrigger[];
  /** Ordered phases of execution */
  phases: ChainPhase[];
  /** Whether this chain is enabled */
  enabled: boolean;
  /** Maximum total execution time in minutes */
  maxDurationMinutes?: number;
  /** Tags for organization */
  tags?: string[];
  /** User who created this chain */
  createdBy?: string;
  /** ISO timestamp */
  createdAt?: string;
}

/**
 * Runtime state of a chain instance.
 */
export type ChainInstanceStatus =
  | 'pending'      // Waiting for trigger
  | 'pre'          // Pre-phase executing
  | 'active'       // Main phases executing
  | 'post'         // Post-phase executing
  | 'completed'    // All phases done
  | 'failed'       // Critical failure
  | 'cancelled'    // User cancelled
  | 'timeout';     // Exceeded max duration

/**
 * Runtime state of a single action.
 */
export interface ActionExecution {
  actionId: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'timeout';
  startedAt?: string;
  completedAt?: string;
  result?: ActionResult;
  error?: string;
  retryCount: number;
}

/**
 * Result from a completed action.
 */
export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** Structured data output from the agent */
  data?: unknown;
  /** Voice response text (for TTS) */
  voiceResponse?: string;
  /** Human-readable summary */
  summary?: string;
  /** Processing time in ms */
  processingTimeMs: number;
  /** Delivery status */
  delivered?: Record<string, boolean>;
}

/**
 * Runtime state of a phase execution.
 */
export interface PhaseExecution {
  phaseId: string;
  phaseName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  actions: ActionExecution[];
}

/**
 * A running chain instance.
 */
export interface ChainInstance {
  /** Unique instance ID */
  instanceId: string;
  /** The chain definition being executed */
  chainId: string;
  /** Chain name (for display) */
  chainName: string;
  /** Current status */
  status: ChainInstanceStatus;
  /** How it was triggered */
  triggerType: ChainTriggerType;
  /** Trigger context */
  triggerData?: Record<string, unknown>;
  /** ISO timestamp when started */
  startedAt: string;
  /** ISO timestamp when completed */
  completedAt?: string;
  /** Phase execution states */
  phases: PhaseExecution[];
  /** Shared context across all actions in this chain */
  sharedContext: Record<string, unknown>;
  /** Accumulated voice responses (for batched TTS) */
  voiceQueue: string[];
  /** Error messages */
  errors: string[];
}

/**
 * Context available to each action during chain execution.
 */
export interface ChainExecutionContext {
  /** The chain instance */
  instance: ChainInstance;
  /** Current phase */
  currentPhase: PhaseExecution;
  /** Results from previous actions (by action ID) */
  previousResults: Map<string, ActionResult>;
  /** Shared context (writable) */
  sharedContext: Record<string, unknown>;
  /** Current location */
  location?: GeoLocation;
  /** Current time */
  currentTime: string;
  /** Most recent image capture (if any) */
  latestImage?: CapturedImage;
  /** Most recent vision analysis (if any) */
  latestAnalysis?: VisionAnalysis;
}

/**
 * Agent handler that the chain engine can dispatch to.
 */
export interface ChainAgentHandler {
  /** Agent identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Execute an action */
  execute: (
    action: ChainAction,
    context: ChainExecutionContext,
  ) => Promise<ActionResult>;
}

/**
 * Configuration for the Context Chain Engine.
 */
export interface ChainEngineConfig {
  /** Maximum concurrent chain instances */
  maxConcurrentChains: number;
  /** Default action timeout in ms */
  defaultActionTimeoutMs: number;
  /** Default action retries */
  defaultRetries: number;
  /** Whether to batch TTS responses or deliver immediately */
  batchTts: boolean;
  /** Enable detailed execution logging */
  debug: boolean;
}

export const DEFAULT_CHAIN_CONFIG: ChainEngineConfig = {
  maxConcurrentChains: 3,
  defaultActionTimeoutMs: 30_000,
  defaultRetries: 1,
  batchTts: true,
  debug: false,
};

/**
 * Events emitted by the chain engine.
 */
export interface ChainEngineEvents {
  'chain:started': (instance: ChainInstance) => void;
  'chain:phase:started': (instanceId: string, phase: PhaseExecution) => void;
  'chain:phase:completed': (instanceId: string, phase: PhaseExecution) => void;
  'chain:action:started': (instanceId: string, action: ActionExecution) => void;
  'chain:action:completed': (instanceId: string, action: ActionExecution) => void;
  'chain:action:failed': (instanceId: string, action: ActionExecution, error: string) => void;
  'chain:completed': (instance: ChainInstance) => void;
  'chain:failed': (instance: ChainInstance, error: string) => void;
  'chain:cancelled': (instance: ChainInstance) => void;
  'chain:tts': (instanceId: string, text: string) => void;
  'chain:error': (instanceId: string, error: string) => void;
}

// ─── Engine Implementation ──────────────────────────────────────

let instanceCounter = 0;
function generateInstanceId(): string {
  instanceCounter++;
  return `chain-${Date.now()}-${instanceCounter}`;
}

/**
 * Context Chain Engine — Orchestrates multi-agent workflows.
 *
 * Usage:
 * ```ts
 * const engine = new ContextChainEngine();
 *
 * // Register agent handlers
 * engine.registerAgent({
 *   id: 'networking',
 *   name: 'Networking Agent',
 *   execute: async (action, ctx) => { ... },
 * });
 *
 * // Register chain definitions
 * engine.registerChain(salesMeetingChain);
 *
 * // Start a chain
 * const instance = await engine.startChain('sales_meeting', 'voice', {
 *   meetingTitle: 'Q3 Planning',
 *   attendees: ['alice@corp.com'],
 * });
 *
 * // Monitor progress
 * engine.on('chain:action:completed', (id, action) => {
 *   console.log(`${action.agentId} completed: ${action.result?.summary}`);
 * });
 * ```
 */
export class ContextChainEngine extends EventEmitter<ChainEngineEvents> {
  private config: ChainEngineConfig;
  private chains: Map<string, ChainDefinition> = new Map();
  private agents: Map<string, ChainAgentHandler> = new Map();
  private instances: Map<string, ChainInstance> = new Map();
  private completedInstances: ChainInstance[] = [];

  constructor(config: Partial<ChainEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CHAIN_CONFIG, ...config };
  }

  // ─── Registration ───────────────────────────────────────────

  /**
   * Register a chain definition.
   */
  registerChain(chain: ChainDefinition): void {
    if (!chain.id || !chain.name) {
      throw new Error('Chain must have an id and name');
    }
    if (!chain.phases || chain.phases.length === 0) {
      throw new Error('Chain must have at least one phase');
    }
    this.chains.set(chain.id, chain);
  }

  /**
   * Unregister a chain definition.
   */
  unregisterChain(chainId: string): boolean {
    return this.chains.delete(chainId);
  }

  /**
   * Get a chain definition by ID.
   */
  getChain(chainId: string): ChainDefinition | undefined {
    return this.chains.get(chainId);
  }

  /**
   * Get all registered chain definitions.
   */
  getAllChains(): ChainDefinition[] {
    return Array.from(this.chains.values());
  }

  /**
   * Register an agent handler that can execute chain actions.
   */
  registerAgent(agent: ChainAgentHandler): void {
    if (!agent.id || !agent.name) {
      throw new Error('Agent must have an id and name');
    }
    this.agents.set(agent.id, agent);
  }

  /**
   * Unregister an agent handler.
   */
  unregisterAgent(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  /**
   * Get all registered agents.
   */
  getAllAgents(): ChainAgentHandler[] {
    return Array.from(this.agents.values());
  }

  // ─── Chain Lifecycle ────────────────────────────────────────

  /**
   * Start a chain instance.
   */
  async startChain(
    chainId: string,
    triggerType: ChainTriggerType,
    triggerData?: Record<string, unknown>,
  ): Promise<ChainInstance> {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain not found: ${chainId}`);
    }
    if (!chain.enabled) {
      throw new Error(`Chain is disabled: ${chainId}`);
    }

    // Check concurrent limit
    const activeCount = Array.from(this.instances.values()).filter(
      (i) => i.status === 'active' || i.status === 'pre' || i.status === 'post',
    ).length;

    if (activeCount >= this.config.maxConcurrentChains) {
      throw new Error(
        `Maximum concurrent chains reached (${this.config.maxConcurrentChains}). ` +
          `Cancel an existing chain first.`,
      );
    }

    // Create instance
    const instance: ChainInstance = {
      instanceId: generateInstanceId(),
      chainId: chain.id,
      chainName: chain.name,
      status: 'pending',
      triggerType,
      triggerData,
      startedAt: new Date().toISOString(),
      phases: chain.phases.map((phase) => ({
        phaseId: phase.id,
        phaseName: phase.name,
        status: 'pending' as const,
        actions: phase.actions.map((action) => ({
          actionId: action.id,
          agentId: action.agentId,
          status: 'pending' as const,
          retryCount: 0,
        })),
      })),
      sharedContext: { ...(triggerData || {}) },
      voiceQueue: [],
      errors: [],
    };

    this.instances.set(instance.instanceId, instance);
    this.emit('chain:started', instance);

    // Execute phases asynchronously
    this.executeChain(instance, chain).catch((err) => {
      instance.status = 'failed';
      instance.errors.push(String(err));
      this.emit('chain:failed', instance, String(err));
    });

    return instance;
  }

  /**
   * Cancel a running chain instance.
   */
  cancelChain(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    if (instance.status === 'completed' || instance.status === 'failed' || instance.status === 'cancelled') {
      return false;
    }

    instance.status = 'cancelled';
    instance.completedAt = new Date().toISOString();
    this.archiveInstance(instance);
    this.emit('chain:cancelled', instance);
    return true;
  }

  /**
   * Get a running or completed chain instance.
   */
  getInstance(instanceId: string): ChainInstance | undefined {
    return this.instances.get(instanceId) ||
      this.completedInstances.find((i) => i.instanceId === instanceId);
  }

  /**
   * Get all active chain instances.
   */
  getActiveInstances(): ChainInstance[] {
    return Array.from(this.instances.values()).filter(
      (i) => i.status === 'active' || i.status === 'pre' || i.status === 'post' || i.status === 'pending',
    );
  }

  /**
   * Get completed chain instances (recent history).
   */
  getCompletedInstances(limit = 20): ChainInstance[] {
    return this.completedInstances.slice(-limit);
  }

  /**
   * Feed an image/analysis to all active chains (for "during" phases).
   */
  feedImage(image: CapturedImage, analysis: VisionAnalysis): void {
    for (const instance of this.instances.values()) {
      if (instance.status === 'active') {
        instance.sharedContext._latestImage = image;
        instance.sharedContext._latestAnalysis = analysis;
      }
    }
  }

  // ─── Chain Execution ────────────────────────────────────────

  private async executeChain(
    instance: ChainInstance,
    chain: ChainDefinition,
  ): Promise<void> {
    const startTime = Date.now();
    const maxDuration = (chain.maxDurationMinutes || 480) * 60_000; // default 8 hours

    try {
      // Sort phases by timing
      const sortedPhases = this.sortPhasesByTiming(chain.phases);

      for (let i = 0; i < sortedPhases.length; i++) {
        // Check for cancellation or timeout
        if (instance.status === 'cancelled') return;
        if (Date.now() - startTime > maxDuration) {
          instance.status = 'timeout';
          instance.completedAt = new Date().toISOString();
          this.archiveInstance(instance);
          this.emit('chain:failed', instance, 'Chain exceeded maximum duration');
          return;
        }

        const phaseDef = sortedPhases[i];
        const phaseExec = instance.phases.find((p) => p.phaseId === phaseDef.id);
        if (!phaseExec) continue;

        // Update instance status based on phase timing
        if (phaseDef.timing.type === 'before') {
          instance.status = 'pre';
        } else if (phaseDef.timing.type === 'after') {
          instance.status = 'post';
        } else {
          instance.status = 'active';
        }

        await this.executePhase(instance, phaseDef, phaseExec);

        // Check if phase failed and we should stop
        if (phaseExec.status === 'failed' && !phaseDef.continueOnFailure) {
          instance.status = 'failed';
          instance.completedAt = new Date().toISOString();
          instance.errors.push(`Phase "${phaseDef.name}" failed`);
          this.archiveInstance(instance);
          this.emit('chain:failed', instance, `Phase "${phaseDef.name}" failed`);
          return;
        }
      }

      // All phases completed
      instance.status = 'completed';
      instance.completedAt = new Date().toISOString();
      this.archiveInstance(instance);
      this.emit('chain:completed', instance);
    } catch (err) {
      instance.status = 'failed';
      instance.completedAt = new Date().toISOString();
      instance.errors.push(String(err));
      this.archiveInstance(instance);
      this.emit('chain:failed', instance, String(err));
    }
  }

  private async executePhase(
    instance: ChainInstance,
    phaseDef: ChainPhase,
    phaseExec: PhaseExecution,
  ): Promise<void> {
    phaseExec.status = 'running';
    phaseExec.startedAt = new Date().toISOString();
    this.emit('chain:phase:started', instance.instanceId, phaseExec);

    try {
      // Build execution context
      const previousResults = this.buildPreviousResults(instance);

      if (phaseDef.parallel) {
        // Execute all actions in parallel
        await this.executeActionsParallel(instance, phaseDef, phaseExec, previousResults);
      } else {
        // Execute actions sequentially, respecting dependencies
        await this.executeActionsSequential(instance, phaseDef, phaseExec, previousResults);
      }

      // Determine phase status based on action outcomes
      const failedActions = phaseExec.actions.filter((a) => a.status === 'failed');
      const requiredFailed = failedActions.filter((a) => {
        const actionDef = phaseDef.actions.find((ad) => ad.id === a.actionId);
        return actionDef && !actionDef.optional;
      });

      if (requiredFailed.length > 0) {
        phaseExec.status = 'failed';
      } else {
        phaseExec.status = 'completed';
      }
    } catch (err) {
      phaseExec.status = 'failed';
      instance.errors.push(`Phase ${phaseDef.id}: ${String(err)}`);
    }

    phaseExec.completedAt = new Date().toISOString();
    this.emit('chain:phase:completed', instance.instanceId, phaseExec);
  }

  private async executeActionsParallel(
    instance: ChainInstance,
    phaseDef: ChainPhase,
    phaseExec: PhaseExecution,
    previousResults: Map<string, ActionResult>,
  ): Promise<void> {
    const promises = phaseDef.actions.map(async (actionDef) => {
      const actionExec = phaseExec.actions.find((a) => a.actionId === actionDef.id);
      if (!actionExec) return;

      // Check condition
      if (actionDef.condition) {
        const ctx = this.buildActionContext(instance, phaseExec, previousResults);
        if (!actionDef.condition(ctx)) {
          actionExec.status = 'skipped';
          return;
        }
      }

      await this.executeAction(instance, phaseDef, actionDef, actionExec, phaseExec, previousResults);
    });

    await Promise.allSettled(promises);
  }

  private async executeActionsSequential(
    instance: ChainInstance,
    phaseDef: ChainPhase,
    phaseExec: PhaseExecution,
    previousResults: Map<string, ActionResult>,
  ): Promise<void> {
    // Build dependency graph for topological ordering
    const executed = new Set<string>();
    const actionMap = new Map(phaseDef.actions.map((a) => [a.id, a]));

    const canExecute = (action: ChainAction): boolean => {
      if (!action.dependsOn || action.dependsOn.length === 0) return true;
      return action.dependsOn.every((dep) => executed.has(dep));
    };

    const remaining = new Set(phaseDef.actions.map((a) => a.id));

    while (remaining.size > 0) {
      // Check for cancellation
      if (instance.status === 'cancelled') return;

      // Find all actions that can execute now
      const ready: ChainAction[] = [];
      for (const id of remaining) {
        const action = actionMap.get(id);
        if (action && canExecute(action)) {
          ready.push(action);
        }
      }

      if (ready.length === 0) {
        // Deadlock — remaining actions have unmet dependencies
        for (const id of remaining) {
          const actionExec = phaseExec.actions.find((a) => a.actionId === id);
          if (actionExec) {
            actionExec.status = 'skipped';
            actionExec.error = 'Unmet dependencies';
          }
        }
        break;
      }

      // Execute ready actions (in parallel if they all have the same dep level)
      await Promise.allSettled(
        ready.map(async (actionDef) => {
          const actionExec = phaseExec.actions.find((a) => a.actionId === actionDef.id);
          if (!actionExec) return;

          // Check condition
          if (actionDef.condition) {
            const ctx = this.buildActionContext(instance, phaseExec, previousResults);
            if (!actionDef.condition(ctx)) {
              actionExec.status = 'skipped';
              remaining.delete(actionDef.id);
              executed.add(actionDef.id);
              return;
            }
          }

          await this.executeAction(instance, phaseDef, actionDef, actionExec, phaseExec, previousResults);
          remaining.delete(actionDef.id);
          executed.add(actionDef.id);

          // Store result for downstream dependencies
          if (actionExec.result) {
            previousResults.set(actionDef.id, actionExec.result);
          }
        }),
      );
    }
  }

  private async executeAction(
    instance: ChainInstance,
    _phaseDef: ChainPhase,
    actionDef: ChainAction,
    actionExec: ActionExecution,
    phaseExec: PhaseExecution,
    previousResults: Map<string, ActionResult>,
  ): Promise<void> {
    const agent = this.agents.get(actionDef.agentId);
    if (!agent) {
      actionExec.status = 'failed';
      actionExec.error = `Agent not found: ${actionDef.agentId}`;
      this.emit('chain:action:failed', instance.instanceId, actionExec, actionExec.error);
      return;
    }

    const maxRetries = actionDef.retries ?? this.config.defaultRetries;
    const timeout = actionDef.timeoutMs ?? this.config.defaultActionTimeoutMs;

    actionExec.status = 'running';
    actionExec.startedAt = new Date().toISOString();
    this.emit('chain:action:started', instance.instanceId, actionExec);

    let lastError = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (instance.status === 'cancelled') {
        actionExec.status = 'skipped';
        return;
      }

      try {
        actionExec.retryCount = attempt;
        const ctx = this.buildActionContext(instance, phaseExec, previousResults);

        // Execute with timeout
        const result = await this.executeWithTimeout(
          agent.execute(actionDef, ctx),
          timeout,
        );

        actionExec.result = result;
        actionExec.status = result.success ? 'completed' : 'failed';
        actionExec.completedAt = new Date().toISOString();

        // Handle delivery
        if (result.success && result.voiceResponse && actionDef.delivery?.tts !== false) {
          instance.voiceQueue.push(result.voiceResponse);
          this.emit('chain:tts', instance.instanceId, result.voiceResponse);
        }

        if (result.success) {
          // Store result data in shared context
          instance.sharedContext[`result_${actionDef.id}`] = result.data;
          this.emit('chain:action:completed', instance.instanceId, actionExec);
          return;
        }

        lastError = result.summary || 'Action returned unsuccessful';
      } catch (err) {
        lastError = String(err);
      }
    }

    // All retries exhausted
    actionExec.status = 'failed';
    actionExec.error = lastError;
    actionExec.completedAt = new Date().toISOString();
    instance.errors.push(`Action ${actionDef.id}: ${lastError}`);
    this.emit('chain:action:failed', instance.instanceId, actionExec, lastError);
  }

  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Action timed out after ${timeoutMs}ms`)), timeoutMs);
      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // ─── Helpers ────────────────────────────────────────────────

  private buildActionContext(
    instance: ChainInstance,
    phaseExec: PhaseExecution,
    previousResults: Map<string, ActionResult>,
  ): ChainExecutionContext {
    return {
      instance,
      currentPhase: phaseExec,
      previousResults,
      sharedContext: instance.sharedContext,
      location: instance.sharedContext._location as GeoLocation | undefined,
      currentTime: new Date().toISOString(),
      latestImage: instance.sharedContext._latestImage as CapturedImage | undefined,
      latestAnalysis: instance.sharedContext._latestAnalysis as VisionAnalysis | undefined,
    };
  }

  private buildPreviousResults(instance: ChainInstance): Map<string, ActionResult> {
    const results = new Map<string, ActionResult>();
    for (const phase of instance.phases) {
      for (const action of phase.actions) {
        if (action.result) {
          results.set(action.actionId, action.result);
        }
      }
    }
    return results;
  }

  private sortPhasesByTiming(phases: ChainPhase[]): ChainPhase[] {
    const order: Record<PhaseTiming['type'], number> = {
      before: 0,
      immediate: 1,
      at: 2,
      during: 3,
      after: 4,
    };

    return [...phases].sort((a, b) => {
      const aOrder = order[a.timing.type] ?? 2;
      const bOrder = order[b.timing.type] ?? 2;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Within same type, sort by offset (smaller offset = earlier)
      const aOffset = a.timing.offsetMinutes ?? 0;
      const bOffset = b.timing.offsetMinutes ?? 0;
      return bOffset - aOffset; // Larger offset = earlier (e.g., 30min before > 10min before)
    });
  }

  private archiveInstance(instance: ChainInstance): void {
    this.instances.delete(instance.instanceId);
    this.completedInstances.push(instance);
    // Keep history bounded
    if (this.completedInstances.length > 100) {
      this.completedInstances = this.completedInstances.slice(-50);
    }
  }

  // ─── Trigger Matching ───────────────────────────────────────

  /**
   * Check if a voice phrase matches any registered chain triggers.
   * Returns the chain ID and trigger if matched.
   */
  matchVoiceTrigger(phrase: string): { chainId: string; trigger: ChainTrigger } | null {
    const normalized = phrase.toLowerCase().trim();

    for (const chain of this.chains.values()) {
      if (!chain.enabled) continue;

      for (const trigger of chain.triggers) {
        if (trigger.type !== 'voice' || !trigger.voicePhrases) continue;

        for (const voicePhrase of trigger.voicePhrases) {
          if (normalized.includes(voicePhrase.toLowerCase())) {
            return { chainId: chain.id, trigger };
          }
        }
      }
    }

    return null;
  }

  /**
   * Check if a scene type matches any registered chain triggers.
   */
  matchSceneTrigger(sceneType: string): { chainId: string; trigger: ChainTrigger }[] {
    const matches: { chainId: string; trigger: ChainTrigger }[] = [];

    for (const chain of this.chains.values()) {
      if (!chain.enabled) continue;

      for (const trigger of chain.triggers) {
        if (trigger.type !== 'scene' || !trigger.sceneTypes) continue;

        if (trigger.sceneTypes.includes(sceneType)) {
          matches.push({ chainId: chain.id, trigger });
        }
      }
    }

    return matches;
  }

  /**
   * Check if a location matches any geofence triggers.
   */
  matchGeoTrigger(location: GeoLocation): { chainId: string; trigger: ChainTrigger }[] {
    const matches: { chainId: string; trigger: ChainTrigger }[] = [];

    for (const chain of this.chains.values()) {
      if (!chain.enabled) continue;

      for (const trigger of chain.triggers) {
        if (trigger.type !== 'geo' || !trigger.geoFence) continue;

        const distance = this.haversineDistance(
          location.latitude,
          location.longitude,
          trigger.geoFence.latitude,
          trigger.geoFence.longitude,
        );

        if (distance <= trigger.geoFence.radiusMeters) {
          matches.push({ chainId: chain.id, trigger });
        }
      }
    }

    return matches;
  }

  /**
   * Check if a calendar event matches any chain triggers.
   */
  matchCalendarTrigger(eventTitle: string): { chainId: string; trigger: ChainTrigger }[] {
    const matches: { chainId: string; trigger: ChainTrigger }[] = [];

    for (const chain of this.chains.values()) {
      if (!chain.enabled) continue;

      for (const trigger of chain.triggers) {
        if (trigger.type !== 'calendar' || !trigger.calendarPatterns) continue;

        for (const pattern of trigger.calendarPatterns) {
          try {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(eventTitle)) {
              matches.push({ chainId: chain.id, trigger });
              break; // Don't add same chain twice
            }
          } catch {
            // Invalid regex, skip
          }
        }
      }
    }

    return matches;
  }

  /**
   * Haversine distance between two GPS coordinates in meters.
   */
  private haversineDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number,
  ): number {
    const R = 6_371_000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  // ─── Statistics ─────────────────────────────────────────────

  /**
   * Get overall engine statistics.
   */
  getStats(): ChainEngineStats {
    const allInstances = [
      ...Array.from(this.instances.values()),
      ...this.completedInstances,
    ];

    const completed = allInstances.filter((i) => i.status === 'completed');
    const failed = allInstances.filter((i) => i.status === 'failed');
    const cancelled = allInstances.filter((i) => i.status === 'cancelled');

    let totalActions = 0;
    let completedActions = 0;
    let failedActions = 0;
    let totalProcessingMs = 0;

    for (const inst of allInstances) {
      for (const phase of inst.phases) {
        for (const action of phase.actions) {
          totalActions++;
          if (action.status === 'completed') {
            completedActions++;
            totalProcessingMs += action.result?.processingTimeMs || 0;
          } else if (action.status === 'failed') {
            failedActions++;
          }
        }
      }
    }

    return {
      registeredChains: this.chains.size,
      registeredAgents: this.agents.size,
      activeInstances: this.getActiveInstances().length,
      completedInstances: completed.length,
      failedInstances: failed.length,
      cancelledInstances: cancelled.length,
      totalActions,
      completedActions,
      failedActions,
      averageActionTimeMs: completedActions > 0 ? totalProcessingMs / completedActions : 0,
      chainSuccessRate: allInstances.length > 0
        ? completed.length / allInstances.length
        : 0,
    };
  }
}

export interface ChainEngineStats {
  registeredChains: number;
  registeredAgents: number;
  activeInstances: number;
  completedInstances: number;
  failedInstances: number;
  cancelledInstances: number;
  totalActions: number;
  completedActions: number;
  failedActions: number;
  averageActionTimeMs: number;
  chainSuccessRate: number;
}

// ─── Built-in Chain Templates ───────────────────────────────────

/**
 * Sales Meeting Chain — the quintessential multi-agent workflow.
 */
export const SALES_MEETING_CHAIN: ChainDefinition = {
  id: 'sales_meeting',
  name: 'Sales Meeting Intelligence',
  description: 'Pre-meeting research → live transcription + intel → post-meeting summary + follow-up',
  enabled: true,
  tags: ['sales', 'meeting', 'enterprise'],
  triggers: [
    {
      type: 'voice',
      voicePhrases: ['start sales mode', 'sales meeting', 'start sales meeting'],
    },
    {
      type: 'calendar',
      calendarPatterns: ['sales.*meeting', 'client.*call', 'prospect.*demo', 'pipeline.*review'],
    },
  ],
  phases: [
    {
      id: 'pre_meeting',
      name: 'Pre-Meeting Research',
      timing: { type: 'before', offsetMinutes: 30 },
      parallel: true,
      actions: [
        {
          id: 'research_attendees',
          agentId: 'networking',
          description: 'Research all meeting attendees',
          delivery: { tts: true, memory: true },
        },
        {
          id: 'company_intel',
          agentId: 'deal_analysis',
          description: 'Pull company financials and recent news',
          delivery: { dashboard: true, memory: true },
          optional: true,
        },
      ],
    },
    {
      id: 'briefing',
      name: 'Deliver Briefing',
      timing: { type: 'before', offsetMinutes: 5 },
      parallel: false,
      actions: [
        {
          id: 'prepare_briefing',
          agentId: 'meeting',
          description: 'Synthesize research into a 30-second TTS briefing',
          dependsOn: ['research_attendees'],
          delivery: { tts: true },
        },
      ],
    },
    {
      id: 'active_meeting',
      name: 'Live Meeting Intelligence',
      timing: { type: 'during' },
      parallel: true,
      continueOnFailure: true,
      actions: [
        {
          id: 'transcription',
          agentId: 'meeting',
          description: 'Live transcription with speaker diarization',
          delivery: { dashboard: true, memory: true },
        },
        {
          id: 'slide_capture',
          agentId: 'meeting',
          description: 'Capture and OCR presentation slides',
          delivery: { memory: true },
          optional: true,
        },
        {
          id: 'real_time_research',
          agentId: 'deal_analysis',
          description: 'Research competitors/products mentioned in real-time',
          delivery: { tts: true },
          optional: true,
        },
      ],
    },
    {
      id: 'post_meeting',
      name: 'Post-Meeting Summary',
      timing: { type: 'after' },
      parallel: false,
      actions: [
        {
          id: 'generate_summary',
          agentId: 'meeting',
          description: 'Generate meeting summary with action items',
          dependsOn: ['transcription'],
          delivery: { tts: true, dashboard: true, memory: true },
        },
        {
          id: 'draft_followup',
          agentId: 'meeting',
          description: 'Draft follow-up email based on discussion',
          dependsOn: ['generate_summary'],
          delivery: { dashboard: true, notification: true },
          optional: true,
        },
      ],
    },
  ],
};

/**
 * Shopping Trip Chain — price intelligence + nutrition + receipt logging.
 */
export const SHOPPING_TRIP_CHAIN: ChainDefinition = {
  id: 'shopping_trip',
  name: 'Smart Shopping Assistant',
  description: 'Shopping list → price comparison → nutrition check → receipt logging',
  enabled: true,
  tags: ['consumer', 'shopping', 'deals'],
  triggers: [
    {
      type: 'voice',
      voicePhrases: ['start shopping', 'shopping mode', 'going shopping'],
    },
    {
      type: 'scene',
      sceneTypes: ['retail_shelf'],
    },
  ],
  phases: [
    {
      id: 'setup',
      name: 'Shopping Setup',
      timing: { type: 'immediate' },
      parallel: false,
      actions: [
        {
          id: 'load_list',
          agentId: 'context',
          description: 'Load shopping list and dietary preferences',
          delivery: { tts: true },
        },
      ],
    },
    {
      id: 'active_shopping',
      name: 'Active Shopping',
      timing: { type: 'during' },
      parallel: true,
      continueOnFailure: true,
      actions: [
        {
          id: 'price_check',
          agentId: 'deal_analysis',
          description: 'Compare prices for each scanned product',
          delivery: { tts: true, dashboard: true },
        },
        {
          id: 'nutrition_check',
          agentId: 'context',
          description: 'Check nutrition against dietary preferences',
          delivery: { tts: true },
          optional: true,
        },
        {
          id: 'security_scan',
          agentId: 'security',
          description: 'Scan QR codes and payment terminals for threats',
          delivery: { tts: true },
          optional: true,
        },
      ],
    },
    {
      id: 'checkout',
      name: 'Checkout & Receipt',
      timing: { type: 'after' },
      parallel: false,
      actions: [
        {
          id: 'scan_receipt',
          agentId: 'memory',
          description: 'Capture and OCR receipt for expense tracking',
          delivery: { memory: true },
        },
        {
          id: 'trip_summary',
          agentId: 'deal_analysis',
          description: 'Summarize total spend and savings found',
          dependsOn: ['scan_receipt'],
          delivery: { tts: true },
        },
      ],
    },
  ],
};

/**
 * Property Walkthrough Chain — inspection + documentation + valuation.
 */
export const PROPERTY_WALKTHROUGH_CHAIN: ChainDefinition = {
  id: 'property_walkthrough',
  name: 'Property Walkthrough',
  description: 'Full property inspection + condition report + valuation',
  enabled: true,
  tags: ['real_estate', 'inspection', 'professional'],
  triggers: [
    {
      type: 'voice',
      voicePhrases: ['start property walkthrough', 'inspect property', 'start inspection'],
    },
  ],
  phases: [
    {
      id: 'setup',
      name: 'Inspection Setup',
      timing: { type: 'immediate' },
      parallel: false,
      actions: [
        {
          id: 'init_inspection',
          agentId: 'inspection',
          description: 'Initialize property inspection with location data',
          delivery: { tts: true },
        },
      ],
    },
    {
      id: 'active_inspection',
      name: 'Room-by-Room Inspection',
      timing: { type: 'during' },
      parallel: true,
      continueOnFailure: true,
      actions: [
        {
          id: 'document_rooms',
          agentId: 'inspection',
          description: 'Auto-capture and assess each room',
          delivery: { dashboard: true },
        },
        {
          id: 'memory_capture',
          agentId: 'memory',
          description: 'Store all captures in visual memory for reference',
          delivery: { memory: true },
        },
        {
          id: 'security_check',
          agentId: 'security',
          description: 'Flag safety hazards and security concerns',
          delivery: { tts: true },
          optional: true,
        },
      ],
    },
    {
      id: 'report',
      name: 'Generate Report',
      timing: { type: 'after' },
      parallel: false,
      actions: [
        {
          id: 'generate_report',
          agentId: 'inspection',
          description: 'Generate professional inspection report',
          dependsOn: ['document_rooms'],
          delivery: { dashboard: true, notification: true },
        },
        {
          id: 'valuation',
          agentId: 'deal_analysis',
          description: 'Estimate property value based on condition findings',
          dependsOn: ['generate_report'],
          delivery: { tts: true, dashboard: true },
          optional: true,
        },
      ],
    },
  ],
};

/**
 * Travel Explorer Chain — translation + cultural intelligence + safety.
 */
export const TRAVEL_EXPLORER_CHAIN: ChainDefinition = {
  id: 'travel_explorer',
  name: 'Travel Explorer',
  description: 'Translation + cultural briefing + safety alerts + POI identification',
  enabled: true,
  tags: ['travel', 'international', 'consumer'],
  triggers: [
    {
      type: 'voice',
      voicePhrases: ['travel mode', 'start travel mode', 'exploring mode'],
    },
  ],
  phases: [
    {
      id: 'arrival',
      name: 'Arrival Briefing',
      timing: { type: 'immediate' },
      parallel: true,
      actions: [
        {
          id: 'cultural_briefing',
          agentId: 'translation',
          description: 'Deliver cultural briefing for current location',
          delivery: { tts: true, memory: true },
        },
        {
          id: 'safety_briefing',
          agentId: 'security',
          description: 'Local safety notes and common scams',
          delivery: { tts: true },
        },
      ],
    },
    {
      id: 'exploration',
      name: 'Active Exploration',
      timing: { type: 'during' },
      parallel: true,
      continueOnFailure: true,
      actions: [
        {
          id: 'translate_signs',
          agentId: 'translation',
          description: 'Auto-translate signs, menus, and text in view',
          delivery: { tts: true },
        },
        {
          id: 'identify_pois',
          agentId: 'memory',
          description: 'Identify and log points of interest',
          delivery: { tts: true, memory: true },
          optional: true,
        },
        {
          id: 'threat_monitoring',
          agentId: 'security',
          description: 'Passive monitoring for scams, fake QR codes, etc.',
          delivery: { tts: true },
          optional: true,
        },
      ],
    },
    {
      id: 'summary',
      name: 'Day Summary',
      timing: { type: 'after' },
      parallel: false,
      actions: [
        {
          id: 'day_summary',
          agentId: 'memory',
          description: 'Summarize the day — places visited, photos, contacts made',
          delivery: { tts: true, dashboard: true, memory: true },
        },
      ],
    },
  ],
};

/**
 * Conference Networking Chain — badge scanning + research + contact management.
 */
export const CONFERENCE_NETWORKING_CHAIN: ChainDefinition = {
  id: 'conference_networking',
  name: 'Conference Networking',
  description: 'Badge scanning + attendee research + contact management + follow-up',
  enabled: true,
  tags: ['networking', 'professional', 'events'],
  triggers: [
    {
      type: 'voice',
      voicePhrases: ['conference mode', 'networking mode', 'start networking'],
    },
    {
      type: 'scene',
      sceneTypes: ['person'],
    },
  ],
  phases: [
    {
      id: 'active_networking',
      name: 'Active Networking',
      timing: { type: 'during' },
      parallel: true,
      continueOnFailure: true,
      actions: [
        {
          id: 'scan_badges',
          agentId: 'networking',
          description: 'Scan name badges and business cards',
          delivery: { tts: true, memory: true, dashboard: true },
        },
        {
          id: 'security_check',
          agentId: 'security',
          description: 'Check QR codes on materials and badges',
          delivery: { tts: true },
          optional: true,
        },
      ],
    },
    {
      id: 'post_event',
      name: 'Post-Event Summary',
      timing: { type: 'after' },
      parallel: false,
      actions: [
        {
          id: 'contact_summary',
          agentId: 'networking',
          description: 'Summary of all contacts made with notes',
          delivery: { tts: true, dashboard: true, memory: true },
        },
        {
          id: 'followup_drafts',
          agentId: 'networking',
          description: 'Draft follow-up messages for key contacts',
          dependsOn: ['contact_summary'],
          delivery: { dashboard: true, notification: true },
          optional: true,
        },
      ],
    },
  ],
};

/**
 * All built-in chain templates.
 */
export const BUILT_IN_CHAINS: ChainDefinition[] = [
  SALES_MEETING_CHAIN,
  SHOPPING_TRIP_CHAIN,
  PROPERTY_WALKTHROUGH_CHAIN,
  TRAVEL_EXPLORER_CHAIN,
  CONFERENCE_NETWORKING_CHAIN,
];
