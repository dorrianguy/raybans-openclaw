/**
 * Platform Orchestrator — The master coordinator for Ray-Bans × OpenClaw.
 *
 * This is the single entry point that boots the entire platform, initializes
 * all agents, manages lifecycle, and provides a unified API for:
 * - Starting/stopping the platform
 * - Processing voice commands → routing to agents
 * - Processing images → routing to specialists
 * - Managing sessions (inventory, meetings, inspections)
 * - Health monitoring across all subsystems
 * - Graceful shutdown with state persistence
 *
 * Think of this as the "main()" of the glasses platform.
 *
 * 🌙 Night Shift Agent — Night #28
 */

import { EventEmitter } from 'events';
import type {
  AgentConfig,
  CapturedImage,
  VisionAnalysis,
  VoiceCommand,
  VoiceIntent,
  InventorySession,
  PipelineResult,
  GeoLocation,
  SceneType,
} from '../types.js';

// ─── Platform Types ─────────────────────────────────────────────

export interface PlatformConfig {
  /** Agent configuration (vision model, API keys, etc.) */
  agent: AgentConfig;
  /** Which modules to enable */
  modules: ModuleFlags;
  /** Auto-start on init */
  autoStart?: boolean;
  /** Enable demo mode (no real hardware) */
  demoMode?: boolean;
  /** Max concurrent image processing */
  maxConcurrentProcessing?: number;
  /** Voice feedback language */
  voiceLanguage?: string;
  /** Default notification volume (0-1) */
  notificationVolume?: number;
  /** Enable telemetry */
  telemetryEnabled?: boolean;
  /** Platform name (for branding) */
  platformName?: string;
}

export interface ModuleFlags {
  vision?: boolean;
  inventory?: boolean;
  memory?: boolean;
  networking?: boolean;
  deals?: boolean;
  security?: boolean;
  meeting?: boolean;
  inspection?: boolean;
  translation?: boolean;
  debug?: boolean;
  contextAware?: boolean;
  chainEngine?: boolean;
  notifications?: boolean;
  analytics?: boolean;
  billing?: boolean;
  storeLayout?: boolean;
  voiceRouter?: boolean;
  dashboard?: boolean;
  persistence?: boolean;
  nodeBridge?: boolean;
  imageScheduler?: boolean;
  healthMonitor?: boolean;
  privacy?: boolean;
  featureFlags?: boolean;
  activation?: boolean;
}

export type PlatformStatus = 'uninitialized' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'error';

export interface ModuleHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'disabled';
  lastCheck: string;
  message?: string;
  uptimeMs?: number;
}

export interface PlatformHealthReport {
  status: PlatformStatus;
  overallHealth: 'healthy' | 'degraded' | 'unhealthy';
  modules: ModuleHealth[];
  uptime: number;
  startedAt: string;
  memoryUsageMB: number;
  activeSession?: string;
  stats: PlatformStats;
}

export interface PlatformStats {
  imagesProcessed: number;
  voiceCommandsHandled: number;
  agentInvocations: number;
  errorsRecovered: number;
  totalUptimeMs: number;
  sessionsCompleted: number;
}

export interface VoiceResponse {
  text: string;
  priority: 'high' | 'normal' | 'low';
  agent: string;
}

export interface ImageProcessingResult {
  imageId: string;
  analysis?: VisionAnalysis;
  agentResults: AgentResult[];
  voiceResponses: VoiceResponse[];
  processingTimeMs: number;
}

export interface AgentResult {
  agentName: string;
  success: boolean;
  data?: unknown;
  error?: string;
  processingTimeMs: number;
}

export type PlatformEventType =
  | 'platform:starting'
  | 'platform:started'
  | 'platform:stopping'
  | 'platform:stopped'
  | 'platform:error'
  | 'platform:paused'
  | 'platform:resumed'
  | 'module:initialized'
  | 'module:error'
  | 'module:health_changed'
  | 'image:received'
  | 'image:processed'
  | 'voice:received'
  | 'voice:response'
  | 'agent:invoked'
  | 'agent:completed'
  | 'session:started'
  | 'session:ended';

export interface PlatformEvents {
  'platform:starting': () => void;
  'platform:started': () => void;
  'platform:stopping': () => void;
  'platform:stopped': () => void;
  'platform:error': (error: Error) => void;
  'platform:paused': () => void;
  'platform:resumed': () => void;
  'module:initialized': (module: string) => void;
  'module:error': (module: string, error: Error) => void;
  'module:health_changed': (health: ModuleHealth) => void;
  'image:received': (imageId: string) => void;
  'image:processed': (result: ImageProcessingResult) => void;
  'voice:received': (command: VoiceCommand) => void;
  'voice:response': (response: VoiceResponse) => void;
  'agent:invoked': (agentName: string, imageId: string) => void;
  'agent:completed': (result: AgentResult) => void;
  'session:started': (type: string, id: string) => void;
  'session:ended': (type: string, id: string) => void;
}

// ─── Default Config ─────────────────────────────────────────────

export const DEFAULT_MODULE_FLAGS: ModuleFlags = {
  vision: true,
  inventory: true,
  memory: true,
  networking: true,
  deals: true,
  security: true,
  meeting: true,
  inspection: true,
  translation: true,
  debug: true,
  contextAware: true,
  chainEngine: true,
  notifications: true,
  analytics: true,
  billing: false,      // Needs Stripe keys
  storeLayout: true,
  voiceRouter: true,
  dashboard: false,     // Optional — runs on separate port
  persistence: true,
  nodeBridge: false,    // Needs real hardware
  imageScheduler: false, // Needs node bridge
  healthMonitor: true,
  privacy: true,
  featureFlags: true,
  activation: true,
};

// ─── Registered Agent Interface ─────────────────────────────────

export interface RegisteredAgent {
  name: string;
  description: string;
  /** Scene types this agent handles */
  sceneTypes: SceneType[];
  /** Voice intents this agent handles */
  voiceIntents: VoiceIntent[];
  /** Priority (lower = higher priority, security=1, inventory=5) */
  priority: number;
  /** Whether this agent is currently enabled */
  enabled: boolean;
  /** Process an image through this agent */
  processImage: (analysis: VisionAnalysis, context: ProcessingContext) => Promise<AgentResult>;
  /** Handle a voice command */
  handleVoiceCommand?: (command: VoiceCommand) => Promise<VoiceResponse | null>;
  /** Get agent health */
  getHealth: () => ModuleHealth;
  /** Initialize the agent */
  init?: () => Promise<void>;
  /** Shutdown the agent */
  shutdown?: () => Promise<void>;
}

export interface ProcessingContext {
  sessionId?: string;
  location?: GeoLocation;
  currentMode?: string;
  userPreferences?: Record<string, unknown>;
  previousAnalyses?: VisionAnalysis[];
}

// ─── Platform Class ─────────────────────────────────────────────

export class Platform extends EventEmitter {
  private config: PlatformConfig;
  private status: PlatformStatus = 'uninitialized';
  private agents: Map<string, RegisteredAgent> = new Map();
  private startedAt: string | null = null;
  private stats: PlatformStats = {
    imagesProcessed: 0,
    voiceCommandsHandled: 0,
    agentInvocations: 0,
    errorsRecovered: 0,
    totalUptimeMs: 0,
    sessionsCompleted: 0,
  };
  private processingQueue: string[] = [];
  private activeProcessing = 0;
  private healthCheckIntervalId: ReturnType<typeof setInterval> | null = null;
  private moduleHealthMap: Map<string, ModuleHealth> = new Map();
  private voiceResponseQueue: VoiceResponse[] = [];
  private sessionRegistry: Map<string, { type: string; startedAt: string; id: string }> = new Map();

  constructor(config: PlatformConfig) {
    super();
    this.config = {
      ...config,
      modules: { ...DEFAULT_MODULE_FLAGS, ...config.modules },
      maxConcurrentProcessing: config.maxConcurrentProcessing ?? 3,
      platformName: config.platformName ?? 'Ray-Bans × OpenClaw',
      voiceLanguage: config.voiceLanguage ?? 'en-US',
      notificationVolume: config.notificationVolume ?? 0.8,
      telemetryEnabled: config.telemetryEnabled ?? true,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.status === 'running') return;
    if (this.status === 'starting') return;

    this.status = 'starting';
    this.emit('platform:starting');
    this.startedAt = new Date().toISOString();

    try {
      // Initialize all registered agents
      const initPromises: Promise<void>[] = [];
      for (const [name, agent] of this.agents) {
        if (agent.enabled && agent.init) {
          initPromises.push(
            agent.init().then(() => {
              this.moduleHealthMap.set(name, {
                name,
                status: 'healthy',
                lastCheck: new Date().toISOString(),
              });
              this.emit('module:initialized', name);
            }).catch((err: Error) => {
              this.moduleHealthMap.set(name, {
                name,
                status: 'unhealthy',
                lastCheck: new Date().toISOString(),
                message: err.message,
              });
              this.emit('module:error', name, err);
              this.stats.errorsRecovered++;
            })
          );
        }
      }
      await Promise.allSettled(initPromises);

      // Start health check loop
      this.healthCheckIntervalId = setInterval(() => {
        this.runHealthChecks();
      }, 30_000); // every 30 seconds

      this.status = 'running';
      this.emit('platform:started');
    } catch (error) {
      this.status = 'error';
      this.emit('platform:error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'stopped' || this.status === 'stopping') return;

    this.status = 'stopping';
    this.emit('platform:stopping');

    // Clear health checks
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = null;
    }

    // Shutdown all agents
    const shutdownPromises: Promise<void>[] = [];
    for (const [, agent] of this.agents) {
      if (agent.shutdown) {
        shutdownPromises.push(
          agent.shutdown().catch(() => {
            // Swallow shutdown errors
          })
        );
      }
    }
    await Promise.allSettled(shutdownPromises);

    // Calculate total uptime
    if (this.startedAt) {
      this.stats.totalUptimeMs += Date.now() - new Date(this.startedAt).getTime();
    }

    this.status = 'stopped';
    this.emit('platform:stopped');
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.emit('platform:paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.status = 'running';
    this.emit('platform:resumed');
  }

  // ─── Agent Registration ─────────────────────────────────────

  registerAgent(agent: RegisteredAgent): void {
    this.agents.set(agent.name, agent);
    this.moduleHealthMap.set(agent.name, {
      name: agent.name,
      status: agent.enabled ? 'healthy' : 'disabled',
      lastCheck: new Date().toISOString(),
    });
  }

  unregisterAgent(name: string): boolean {
    this.moduleHealthMap.delete(name);
    return this.agents.delete(name);
  }

  getAgent(name: string): RegisteredAgent | undefined {
    return this.agents.get(name);
  }

  listAgents(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  enableAgent(name: string): boolean {
    const agent = this.agents.get(name);
    if (!agent) return false;
    agent.enabled = true;
    const health = this.moduleHealthMap.get(name);
    if (health) {
      health.status = 'healthy';
      health.lastCheck = new Date().toISOString();
    }
    return true;
  }

  disableAgent(name: string): boolean {
    const agent = this.agents.get(name);
    if (!agent) return false;
    agent.enabled = false;
    const health = this.moduleHealthMap.get(name);
    if (health) {
      health.status = 'disabled';
      health.lastCheck = new Date().toISOString();
    }
    return true;
  }

  // ─── Image Processing ───────────────────────────────────────

  async processImage(
    analysis: VisionAnalysis,
    context?: ProcessingContext
  ): Promise<ImageProcessingResult> {
    if (this.status !== 'running') {
      return {
        imageId: analysis.imageId,
        agentResults: [],
        voiceResponses: [{
          text: 'Platform is not running. Please start first.',
          priority: 'high',
          agent: 'platform',
        }],
        processingTimeMs: 0,
      };
    }

    const startTime = Date.now();
    this.emit('image:received', analysis.imageId);

    const agentResults: AgentResult[] = [];
    const voiceResponses: VoiceResponse[] = [];
    const ctx = context ?? {};

    // Find all matching agents by scene type, sorted by priority
    const matchingAgents = this.getMatchingAgents(analysis.sceneType);

    // Process through each matching agent
    for (const agent of matchingAgents) {
      if (this.activeProcessing >= (this.config.maxConcurrentProcessing ?? 3)) {
        break; // Respect concurrency limit
      }

      this.activeProcessing++;
      this.emit('agent:invoked', agent.name, analysis.imageId);

      try {
        const agentStart = Date.now();
        const result = await agent.processImage(analysis, ctx);
        result.processingTimeMs = Date.now() - agentStart;
        agentResults.push(result);
        this.stats.agentInvocations++;
        this.emit('agent:completed', result);
      } catch (error) {
        const errResult: AgentResult = {
          agentName: agent.name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          processingTimeMs: Date.now() - startTime,
        };
        agentResults.push(errResult);
        this.stats.errorsRecovered++;
      } finally {
        this.activeProcessing--;
      }
    }

    this.stats.imagesProcessed++;

    const result: ImageProcessingResult = {
      imageId: analysis.imageId,
      analysis,
      agentResults,
      voiceResponses,
      processingTimeMs: Date.now() - startTime,
    };

    this.emit('image:processed', result);
    return result;
  }

  // ─── Voice Command Processing ───────────────────────────────

  async processVoiceCommand(command: VoiceCommand): Promise<VoiceResponse[]> {
    if (this.status !== 'running' && this.status !== 'paused') {
      return [{
        text: 'Platform is not running.',
        priority: 'high',
        agent: 'platform',
      }];
    }

    this.emit('voice:received', command);
    this.stats.voiceCommandsHandled++;

    const responses: VoiceResponse[] = [];

    // Handle platform-level commands first
    const platformResponse = this.handlePlatformCommand(command);
    if (platformResponse) {
      responses.push(platformResponse);
      return responses;
    }

    // Find agents that handle this voice intent
    const handlers = this.getVoiceHandlers(command.intent);

    for (const agent of handlers) {
      if (agent.handleVoiceCommand) {
        try {
          const response = await agent.handleVoiceCommand(command);
          if (response) {
            responses.push(response);
            this.emit('voice:response', response);
          }
        } catch {
          // Agent voice handler failed — don't crash the platform
          this.stats.errorsRecovered++;
        }
      }
    }

    if (responses.length === 0) {
      responses.push({
        text: `I didn't understand "${command.rawText}". Try saying "help" for available commands.`,
        priority: 'normal',
        agent: 'platform',
      });
    }

    return responses;
  }

  // ─── Session Management ─────────────────────────────────────

  startSession(type: string, id: string): void {
    this.sessionRegistry.set(id, {
      type,
      startedAt: new Date().toISOString(),
      id,
    });
    this.emit('session:started', type, id);
  }

  endSession(id: string): void {
    const session = this.sessionRegistry.get(id);
    if (session) {
      this.sessionRegistry.delete(id);
      this.stats.sessionsCompleted++;
      this.emit('session:ended', session.type, id);
    }
  }

  getActiveSessions(): Array<{ type: string; id: string; startedAt: string }> {
    return Array.from(this.sessionRegistry.values());
  }

  // ─── Health & Status ────────────────────────────────────────

  getStatus(): PlatformStatus {
    return this.status;
  }

  getHealthReport(): PlatformHealthReport {
    const modules = Array.from(this.moduleHealthMap.values());
    const unhealthyCount = modules.filter(m => m.status === 'unhealthy').length;
    const degradedCount = modules.filter(m => m.status === 'degraded').length;

    let overallHealth: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (unhealthyCount > modules.length / 2) overallHealth = 'unhealthy';
    else if (unhealthyCount > 0 || degradedCount > 0) overallHealth = 'degraded';

    const uptime = this.startedAt
      ? Date.now() - new Date(this.startedAt).getTime()
      : 0;

    return {
      status: this.status,
      overallHealth,
      modules,
      uptime,
      startedAt: this.startedAt ?? '',
      memoryUsageMB: Math.round((process?.memoryUsage?.()?.heapUsed ?? 0) / 1024 / 1024),
      activeSession: this.getActiveSessions()[0]?.id,
      stats: { ...this.stats },
    };
  }

  getStats(): PlatformStats {
    return { ...this.stats };
  }

  getVoiceSummary(): string {
    const report = this.getHealthReport();
    const enabledAgents = this.listAgents().filter(a => a.enabled);
    const sessions = this.getActiveSessions();

    let summary = `${this.config.platformName} is ${report.status}. `;
    summary += `${enabledAgents.length} agents active. `;

    if (sessions.length > 0) {
      summary += `${sessions.length} active session${sessions.length > 1 ? 's' : ''}. `;
    }

    summary += `Overall health: ${report.overallHealth}. `;

    if (report.stats.imagesProcessed > 0) {
      summary += `${report.stats.imagesProcessed} images processed. `;
    }
    if (report.stats.voiceCommandsHandled > 0) {
      summary += `${report.stats.voiceCommandsHandled} voice commands handled. `;
    }

    return summary.trim();
  }

  // ─── Private Helpers ────────────────────────────────────────

  private getMatchingAgents(sceneType: SceneType): RegisteredAgent[] {
    const matching: RegisteredAgent[] = [];
    for (const agent of this.agents.values()) {
      if (!agent.enabled) continue;
      if (agent.sceneTypes.includes(sceneType) || agent.sceneTypes.includes('unknown' as SceneType)) {
        matching.push(agent);
      }
    }
    // Sort by priority (lower number = higher priority)
    matching.sort((a, b) => a.priority - b.priority);
    return matching;
  }

  private getVoiceHandlers(intent: VoiceIntent): RegisteredAgent[] {
    const handlers: RegisteredAgent[] = [];
    for (const agent of this.agents.values()) {
      if (!agent.enabled) continue;
      if (agent.voiceIntents.includes(intent)) {
        handlers.push(agent);
      }
    }
    handlers.sort((a, b) => a.priority - b.priority);
    return handlers;
  }

  private handlePlatformCommand(command: VoiceCommand): VoiceResponse | null {
    switch (command.intent) {
      case 'status_report':
        return {
          text: this.getVoiceSummary(),
          priority: 'normal',
          agent: 'platform',
        };
      case 'privacy_mode':
        this.pause();
        return {
          text: 'Privacy mode activated. All capture paused.',
          priority: 'high',
          agent: 'platform',
        };
      case 'resume_capture':
        this.resume();
        return {
          text: 'Capture resumed.',
          priority: 'normal',
          agent: 'platform',
        };
      default:
        return null;
    }
  }

  private runHealthChecks(): void {
    for (const [name, agent] of this.agents) {
      if (!agent.enabled) continue;
      try {
        const health = agent.getHealth();
        const prev = this.moduleHealthMap.get(name);
        this.moduleHealthMap.set(name, health);
        if (prev && prev.status !== health.status) {
          this.emit('module:health_changed', health);
        }
      } catch {
        this.moduleHealthMap.set(name, {
          name,
          status: 'unhealthy',
          lastCheck: new Date().toISOString(),
          message: 'Health check failed',
        });
      }
    }
  }
}

// ─── Quick Factory ──────────────────────────────────────────────

export function createPlatform(config: Partial<PlatformConfig> & { agent: AgentConfig }): Platform {
  return new Platform({
    ...config,
    modules: { ...DEFAULT_MODULE_FLAGS, ...config.modules },
  });
}
