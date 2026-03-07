/**
 * Context Router — The brain that decides which specialist agent handles each image.
 *
 * When an image arrives, the router analyzes it and determines:
 * 1. What context the user is in (retail, meeting, networking event, etc.)
 * 2. Which specialist agent(s) should handle it
 * 3. What priority/urgency to assign
 *
 * The router supports:
 * - Automatic mode detection from vision analysis
 * - Manual mode override via voice ("price check", "who is this?")
 * - Concurrent routing (image goes to multiple agents if relevant)
 * - Context stickiness (stays in current mode unless scene clearly changes)
 * - Priority routing (security alerts override everything)
 *
 * Architecture:
 *   Image → Context Router → [ Agent A, Agent B, ... ] → Responses → TTS/Dashboard
 */

import { EventEmitter } from 'eventemitter3';
import type {
  CapturedImage,
  VisionAnalysis,
  SceneType,
  VoiceIntent,
  PipelineResult,
} from '../types.js';

// ─── Types ──────────────────────────────────────────────────────

/**
 * A specialist agent that the router can dispatch to.
 */
export interface SpecialistAgent {
  /** Unique agent identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Scene types this agent is best suited for */
  sceneTypes: SceneType[];
  /** Voice intents that should route to this agent */
  voiceIntents: VoiceIntent[];
  /** Keywords in scene descriptions that trigger this agent */
  keywords: string[];
  /** Priority (lower = higher priority, e.g., security = 1) */
  priority: number;
  /** Whether this agent can run concurrently with others */
  concurrent: boolean;
  /** Whether this agent is currently enabled */
  enabled: boolean;
  /** The handler function */
  handle: (
    image: CapturedImage,
    analysis: VisionAnalysis,
    context: RoutingContext,
  ) => Promise<AgentResponse>;
}

/**
 * Context passed to each agent when routing.
 */
export interface RoutingContext {
  /** Current user mode (may be set by voice or auto-detected) */
  activeMode: RoutingMode | null;
  /** How the routing was triggered */
  trigger: 'auto' | 'voice' | 'manual';
  /** Voice intent if triggered by voice */
  voiceIntent?: VoiceIntent;
  /** Voice parameters (e.g., "aisle 3") */
  voiceParams?: Record<string, string>;
  /** Previous routing decisions (for context stickiness) */
  recentModes: RoutingMode[];
  /** User location if available */
  location?: { latitude: number; longitude: number };
}

/**
 * Response from a specialist agent.
 */
export interface AgentResponse {
  /** Agent that produced this response */
  agentId: string;
  /** Human-readable agent name */
  agentName?: string;
  /** Whether the agent successfully handled the image */
  handled?: boolean;
  /** Whether the operation succeeded */
  success?: boolean;
  /** Voice response for TTS (keep under 30s) */
  voiceResponse?: string;
  /** TTS text (alias for voiceResponse) */
  ttsText?: string;
  /** Structured data output */
  data?: unknown;
  /** Human-readable summary */
  summary?: string;
  /** Confidence that this agent was the right choice (0-1) */
  confidence?: number;
  /** Priority of the response (for ordering when multiple agents respond) */
  priority: number;
  /** Processing time in ms */
  processingTimeMs?: number;
}

/**
 * High-level user activity modes.
 */
export type RoutingMode =
  | 'inventory'       // Walking a store counting products
  | 'networking'      // At an event, scanning badges/cards
  | 'shopping'        // Browsing as a consumer
  | 'meeting'         // In a meeting (transcription + slides)
  | 'inspection'      // Walking a property/site
  | 'debugging'       // Looking at code/screens
  | 'memory'          // General life indexing
  | 'security'        // Threat/safety analysis
  | 'translation'     // Reading foreign text
  | 'deals'           // Price checking / deal analysis
  | 'general';        // No specific mode

/**
 * A routing decision.
 */
export interface RoutingDecision {
  /** Agents selected to handle this image */
  agents: SpecialistAgent[];
  /** The determined mode */
  mode: RoutingMode;
  /** Confidence in the routing decision (0-1) */
  confidence: number;
  /** Why this routing was chosen */
  reason: string;
  /** Timestamp */
  timestamp: string;
}

// ─── Events ─────────────────────────────────────────────────────

export interface ContextRouterEvents {
  /** Routing decision made */
  'route:decided': (decision: RoutingDecision) => void;
  /** Agent response received */
  'agent:response': (response: AgentResponse) => void;
  /** All agents done for this image */
  'route:complete': (
    imageId: string,
    responses: AgentResponse[],
    totalMs: number,
  ) => void;
  /** Mode changed */
  'mode:changed': (from: RoutingMode | null, to: RoutingMode) => void;
  /** Error */
  'error': (source: string, message: string) => void;
  /** Debug log */
  'log': (message: string) => void;
}

// ─── Configuration ──────────────────────────────────────────────

export interface ContextRouterConfig {
  /** How many recent modes to track for stickiness */
  modeHistorySize?: number;
  /** Confidence threshold to switch modes automatically (0-1) */
  modeSwitchThreshold?: number;
  /** Maximum time to wait for all agents (ms) */
  agentTimeoutMs?: number;
  /** Enable debug logging */
  debug?: boolean;
}

const DEFAULT_CONFIG: Required<ContextRouterConfig> = {
  modeHistorySize: 10,
  modeSwitchThreshold: 0.6,
  agentTimeoutMs: 30000,
  debug: false,
};

// ─── Scene → Mode Mapping ───────────────────────────────────────

const SCENE_MODE_MAP: Record<SceneType, RoutingMode[]> = {
  retail_shelf: ['inventory', 'shopping', 'deals'],
  warehouse: ['inventory', 'inspection'],
  office: ['meeting', 'memory', 'debugging'],
  outdoor: ['memory', 'translation', 'security'],
  kitchen: ['memory', 'general'],
  workshop: ['inspection', 'debugging', 'memory'],
  document: ['memory', 'translation', 'security'],
  screen: ['debugging', 'memory'],
  whiteboard: ['meeting', 'memory'],
  person: ['networking', 'memory'],
  vehicle: ['deals', 'inspection'],
  property: ['inspection', 'deals'],
  unknown: ['general', 'memory'],
};

const VOICE_MODE_MAP: Partial<Record<VoiceIntent, RoutingMode>> = {
  inventory_start: 'inventory',
  inventory_stop: 'inventory',
  inventory_pause: 'inventory',
  inventory_resume: 'inventory',
  inventory_annotate: 'inventory',
  inventory_set_aisle: 'inventory',
  inventory_set_section: 'inventory',
  inventory_set_depth: 'inventory',
  inventory_manual_count: 'inventory',
  inventory_skip: 'inventory',
  price_check: 'deals',
  what_is_this: 'general',
  translate: 'translation',
  debug_this: 'debugging',
  start_meeting: 'meeting',
  end_meeting: 'meeting',
  remember_this: 'memory',
  take_photo: 'memory',
  privacy_mode: 'general',
  resume_capture: 'general',
};

// ─── Router Implementation ──────────────────────────────────────

export class ContextRouter extends EventEmitter<ContextRouterEvents> {
  private config: Required<ContextRouterConfig>;
  private agents: Map<string, SpecialistAgent> = new Map();
  private activeMode: RoutingMode | null = null;
  private modeHistory: RoutingMode[] = [];
  private routeCount = 0;

  constructor(config: ContextRouterConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Agent Registration ─────────────────────────────────────

  /**
   * Register a specialist agent with the router.
   */
  registerAgent(agent: SpecialistAgent): void {
    this.agents.set(agent.id, agent);
    this.log(`Registered agent: ${agent.name} (${agent.id})`);
  }

  /**
   * Unregister an agent.
   */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.log(`Unregistered agent: ${agentId}`);
  }

  /**
   * Enable or disable a specific agent.
   */
  setAgentEnabled(agentId: string, enabled: boolean): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.enabled = enabled;
      this.log(`Agent ${agentId}: ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Get all registered agents.
   */
  getAgents(): SpecialistAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get currently enabled agents.
   */
  getEnabledAgents(): SpecialistAgent[] {
    return Array.from(this.agents.values()).filter((a) => a.enabled);
  }

  // ─── Mode Management ───────────────────────────────────────

  /**
   * Manually set the active mode (e.g., from a voice command).
   */
  setMode(mode: RoutingMode): void {
    const old = this.activeMode;
    this.activeMode = mode;
    this.pushModeHistory(mode);
    if (old !== mode) {
      this.emit('mode:changed', old, mode);
      this.log(`Mode changed: ${old || 'none'} → ${mode}`);
    }
  }

  /**
   * Clear the active mode (return to auto-detection).
   */
  clearMode(): void {
    const old = this.activeMode;
    this.activeMode = null;
    if (old) {
      this.emit('mode:changed', old, 'general');
      this.log('Mode cleared — returning to auto-detection');
    }
  }

  /**
   * Get the current active mode.
   */
  getMode(): RoutingMode | null {
    return this.activeMode;
  }

  // ─── Routing ────────────────────────────────────────────────

  /**
   * Route an analyzed image to the appropriate specialist agent(s).
   *
   * This is the main entry point. Call this after vision analysis completes.
   */
  async route(
    image: CapturedImage,
    analysis: VisionAnalysis,
    trigger: 'auto' | 'voice' | 'manual' = 'auto',
    voiceIntent?: VoiceIntent,
    voiceParams?: Record<string, string>,
  ): Promise<AgentResponse[]> {
    const startTime = Date.now();
    this.routeCount++;

    // 1. Determine which mode we're in
    const mode = this.determineMode(analysis, trigger, voiceIntent);

    // 2. Select agents for this routing
    const decision = this.selectAgents(analysis, mode, voiceIntent);

    this.emit('route:decided', decision);
    this.log(
      `Route #${this.routeCount}: mode=${decision.mode}, ` +
      `agents=[${decision.agents.map((a) => a.id).join(', ')}], ` +
      `confidence=${decision.confidence.toFixed(2)}, reason="${decision.reason}"`,
    );

    if (decision.agents.length === 0) {
      this.log('No agents selected — image will only go to memory');
      return [];
    }

    // 3. Build routing context
    const context: RoutingContext = {
      activeMode: this.activeMode,
      trigger,
      voiceIntent,
      voiceParams,
      recentModes: [...this.modeHistory],
      location: image.location
        ? { latitude: image.location.latitude, longitude: image.location.longitude }
        : undefined,
    };

    // 4. Dispatch to agents (concurrent or sequential based on agent config)
    const responses = await this.dispatchToAgents(
      decision.agents,
      image,
      analysis,
      context,
    );

    const totalMs = Date.now() - startTime;
    this.emit('route:complete', image.id, responses, totalMs);
    this.log(
      `Route #${this.routeCount} complete: ${responses.length} responses in ${totalMs}ms`,
    );

    return responses;
  }

  /**
   * Route based on a voice command (no image analysis needed).
   * Used for commands like "start inventory" that don't need vision.
   */
  routeVoiceCommand(
    intent: VoiceIntent,
    params: Record<string, string>,
  ): SpecialistAgent | null {
    const mode = VOICE_MODE_MAP[intent];
    if (mode) {
      this.setMode(mode);
    }

    // Find the agent that handles this voice intent
    for (const agent of this.agents.values()) {
      if (agent.enabled && agent.voiceIntents.includes(intent)) {
        return agent;
      }
    }

    return null;
  }

  // ─── Routing Stats ─────────────────────────────────────────

  /**
   * Get routing statistics.
   */
  getStats(): {
    totalRoutes: number;
    activeMode: RoutingMode | null;
    registeredAgents: number;
    enabledAgents: number;
    modeHistory: RoutingMode[];
  } {
    return {
      totalRoutes: this.routeCount,
      activeMode: this.activeMode,
      registeredAgents: this.agents.size,
      enabledAgents: this.getEnabledAgents().length,
      modeHistory: [...this.modeHistory],
    };
  }

  // ─── Private: Mode Detection ────────────────────────────────

  /**
   * Determine the routing mode from analysis + context.
   */
  private determineMode(
    analysis: VisionAnalysis,
    trigger: 'auto' | 'voice' | 'manual',
    voiceIntent?: VoiceIntent,
  ): RoutingMode {
    // Voice command takes priority
    if (voiceIntent && VOICE_MODE_MAP[voiceIntent]) {
      const mode = VOICE_MODE_MAP[voiceIntent]!;
      this.setMode(mode);
      return mode;
    }

    // If we have a sticky mode and it's still relevant, keep it
    if (this.activeMode && this.isModeStillRelevant(analysis, this.activeMode)) {
      return this.activeMode;
    }

    // Auto-detect from scene type
    const candidateModes = SCENE_MODE_MAP[analysis.sceneType] || ['general'];
    const bestMode = this.scoreModes(analysis, candidateModes);

    // Only auto-switch if confidence is high enough
    if (this.activeMode && bestMode.confidence < this.config.modeSwitchThreshold) {
      return this.activeMode;
    }

    if (bestMode.mode !== this.activeMode) {
      // Don't set mode for general — let it float
      if (bestMode.mode !== 'general') {
        this.setMode(bestMode.mode);
      }
    }

    return bestMode.mode;
  }

  /**
   * Check if the current mode is still relevant for this scene.
   */
  private isModeStillRelevant(
    analysis: VisionAnalysis,
    mode: RoutingMode,
  ): boolean {
    const relevantScenes = Object.entries(SCENE_MODE_MAP)
      .filter(([, modes]) => modes.includes(mode))
      .map(([scene]) => scene as SceneType);

    return relevantScenes.includes(analysis.sceneType);
  }

  /**
   * Score candidate modes based on scene analysis.
   */
  private scoreModes(
    analysis: VisionAnalysis,
    candidates: RoutingMode[],
  ): { mode: RoutingMode; confidence: number } {
    let bestMode = candidates[0] || 'general';
    let bestScore = 0;

    for (const mode of candidates) {
      let score = 0.5; // Base score for being a candidate

      // Boost based on analysis content
      switch (mode) {
        case 'inventory':
          if (analysis.products.length > 0) score += 0.3;
          if (analysis.barcodes.length > 0) score += 0.2;
          if (analysis.extractedText.some((t) => t.textType === 'price')) score += 0.1;
          break;

        case 'networking':
          if (analysis.sceneType === 'person') score += 0.3;
          if (analysis.extractedText.some((t) =>
            t.text.toLowerCase().match(/\b(name|title|company|email|phone|@)\b/)
          )) score += 0.2;
          break;

        case 'deals':
          if (analysis.extractedText.some((t) => t.textType === 'price')) score += 0.3;
          if (analysis.sceneType === 'vehicle') score += 0.2;
          break;

        case 'debugging':
          if (analysis.sceneType === 'screen') score += 0.3;
          if (analysis.extractedText.some((t) =>
            t.text.match(/error|exception|stack|trace|undefined|null|warning/i)
          )) score += 0.3;
          break;

        case 'meeting':
          if (analysis.sceneType === 'whiteboard') score += 0.3;
          if (analysis.detectedObjects.some((o) =>
            o.label.toLowerCase().match(/slide|presentation|screen|projector/)
          )) score += 0.2;
          break;

        case 'translation':
          // Would need language detection — simplified for now
          break;

        case 'security':
          if (analysis.barcodes.some((b) => b.format === 'QR')) score += 0.2;
          break;

        case 'memory':
          // Memory always gets a moderate base score
          score = 0.3;
          break;
      }

      // Boost if this mode has been recent (stickiness)
      const recentCount = this.modeHistory.filter((m) => m === mode).length;
      score += recentCount * 0.05;

      if (score > bestScore) {
        bestScore = score;
        bestMode = mode;
      }
    }

    return { mode: bestMode, confidence: Math.min(1, bestScore) };
  }

  // ─── Private: Agent Selection ───────────────────────────────

  /**
   * Select which agents should handle this routing.
   */
  private selectAgents(
    analysis: VisionAnalysis,
    mode: RoutingMode,
    voiceIntent?: VoiceIntent,
  ): RoutingDecision {
    const enabledAgents = this.getEnabledAgents();
    const selected: SpecialistAgent[] = [];
    let confidence = 0;
    let reason = '';

    // Voice intent gets direct routing
    if (voiceIntent) {
      const voiceAgent = enabledAgents.find((a) =>
        a.voiceIntents.includes(voiceIntent),
      );
      if (voiceAgent) {
        selected.push(voiceAgent);
        confidence = 0.95;
        reason = `Voice command: ${voiceIntent}`;
      }
    }

    // If no voice match, route by scene type + keywords
    if (selected.length === 0) {
      // Score each agent
      const scored = enabledAgents.map((agent) => ({
        agent,
        score: this.scoreAgentForAnalysis(agent, analysis, mode),
      }));

      // Sort by score descending, then by priority ascending
      scored.sort((a, b) => {
        if (Math.abs(a.score - b.score) > 0.1) return b.score - a.score;
        return a.agent.priority - b.agent.priority;
      });

      // Take the best agent(s)
      if (scored.length > 0 && scored[0].score > 0.3) {
        selected.push(scored[0].agent);
        confidence = scored[0].score;
        reason = `Best match for ${analysis.sceneType} in ${mode} mode`;

        // Add concurrent agents that also scored well
        for (let i = 1; i < scored.length; i++) {
          if (scored[i].score > 0.5 && scored[i].agent.concurrent) {
            selected.push(scored[i].agent);
          }
        }
      }
    }

    return {
      agents: selected,
      mode,
      confidence,
      reason: reason || `No strong match for ${analysis.sceneType}`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Score how well an agent matches the current analysis.
   */
  private scoreAgentForAnalysis(
    agent: SpecialistAgent,
    analysis: VisionAnalysis,
    mode: RoutingMode,
  ): number {
    let score = 0;

    // Scene type match
    if (agent.sceneTypes.includes(analysis.sceneType)) {
      score += 0.4;
    }

    // Keyword match in scene description
    const descLower = analysis.sceneDescription.toLowerCase();
    const matchedKeywords = agent.keywords.filter((kw) =>
      descLower.includes(kw.toLowerCase()),
    );
    score += Math.min(0.3, matchedKeywords.length * 0.1);

    // Mode match — check if this agent handles the current mode
    // (inferred from scene types overlapping with mode's scenes)
    const modeScenes = Object.entries(SCENE_MODE_MAP)
      .filter(([, modes]) => modes.includes(mode))
      .map(([scene]) => scene as SceneType);
    const modeOverlap = agent.sceneTypes.filter((s) => modeScenes.includes(s));
    if (modeOverlap.length > 0) {
      score += 0.2;
    }

    return Math.min(1, score);
  }

  // ─── Private: Dispatch ──────────────────────────────────────

  /**
   * Dispatch image to selected agents and collect responses.
   */
  private async dispatchToAgents(
    agents: SpecialistAgent[],
    image: CapturedImage,
    analysis: VisionAnalysis,
    context: RoutingContext,
  ): Promise<AgentResponse[]> {
    const timeout = this.config.agentTimeoutMs;

    // Run all selected agents concurrently with timeout
    const promises = agents.map(async (agent) => {
      try {
        const result = await Promise.race([
          agent.handle(image, analysis, context),
          new Promise<AgentResponse>((_, reject) =>
            setTimeout(() => reject(new Error('Agent timeout')), timeout),
          ),
        ]);
        this.emit('agent:response', result);
        return result;
      } catch (err) {
        const errorResponse: AgentResponse = {
          agentId: agent.id,
          handled: false,
          confidence: 0,
          priority: 99,
          processingTimeMs: timeout,
        };
        this.emit(
          'error',
          `agent:${agent.id}`,
          `Agent failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return errorResponse;
      }
    });

    const responses = await Promise.all(promises);

    // Sort by priority (lower = higher priority), then by confidence
    responses.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });

    return responses;
  }

  // ─── Private: Helpers ───────────────────────────────────────

  private pushModeHistory(mode: RoutingMode): void {
    this.modeHistory.push(mode);
    if (this.modeHistory.length > this.config.modeHistorySize) {
      this.modeHistory.shift();
    }
  }

  private log(message: string): void {
    if (this.config.debug) {
      this.emit('log', `[ContextRouter] ${message}`);
    }
  }
}
