/**
 * Voice Session Controller
 * 
 * Full hands-free session lifecycle management for the glasses platform.
 * This is the UX glue that ties everything together — the user talks,
 * the controller manages state, agents, and feedback.
 * 
 * Key capabilities:
 * - Session lifecycle (start → pause → resume → end)
 * - Multi-mode support (inventory, inspection, networking, shopping, etc.)
 * - Voice command queue with priority
 * - Agent coordination and result routing
 * - Continuous feedback loop (progress, alerts, summaries)
 * - Session handoff between devices
 * - Auto-save and recovery
 * - Session templates for common workflows
 * 
 * 🌙 Night Shift Agent — Shift #34
 */

import { EventEmitter } from 'events';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SessionMode = 
  | 'inventory'
  | 'inspection'
  | 'networking'
  | 'shopping'
  | 'meeting'
  | 'security'
  | 'exploration'
  | 'debug'
  | 'translation'
  | 'general';

export type SessionStatus = 
  | 'idle'
  | 'active'
  | 'paused'
  | 'completing'
  | 'completed'
  | 'cancelled'
  | 'error';

export type FeedbackLevel = 'verbose' | 'normal' | 'minimal' | 'silent';

export interface SessionConfig {
  /** Session mode determines which agents are active */
  mode: SessionMode;
  /** Store/location identifier */
  storeId?: string;
  /** Human-readable session name */
  name?: string;
  /** How much voice feedback to give */
  feedbackLevel: FeedbackLevel;
  /** Auto-save interval in ms (default: 60000 = 1 minute) */
  autoSaveInterval: number;
  /** Auto-pause after inactivity in ms (0 = disabled, default: 300000 = 5 min) */
  inactivityTimeout: number;
  /** Maximum session duration in ms (0 = unlimited, default: 14400000 = 4 hours) */
  maxDuration: number;
  /** Enable progress announcements (default: true) */
  announceProgress: boolean;
  /** Progress announcement interval in ms (default: 300000 = 5 min) */
  progressInterval: number;
  /** Enable privacy mode (no image capture, no TTS) */
  privacyMode: boolean;
  /** Device ID for this session */
  deviceId?: string;
}

export interface SessionState {
  id: string;
  config: SessionConfig;
  status: SessionStatus;
  startedAt: number;
  pausedAt: number | null;
  resumedAt: number | null;
  completedAt: number | null;
  totalPausedMs: number;
  activeAgents: string[];
  commandCount: number;
  imageCount: number;
  lastActivityAt: number;
  metadata: Record<string, unknown>;
  checkpoints: SessionCheckpoint[];
}

export interface SessionCheckpoint {
  timestamp: number;
  label: string;
  data: Record<string, unknown>;
}

export interface VoiceCommand {
  id: string;
  text: string;
  intent: string;
  params: Record<string, string>;
  priority: number;
  timestamp: number;
  processed: boolean;
  result?: string;
}

export interface CommandResult {
  commandId: string;
  success: boolean;
  response?: string;
  voiceFeedback?: string;
  data?: Record<string, unknown>;
}

export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  mode: SessionMode;
  config: Partial<SessionConfig>;
  setupCommands: string[];
  agents: string[];
}

export interface SessionSummary {
  id: string;
  mode: SessionMode;
  duration: string;
  durationMs: number;
  commandCount: number;
  imageCount: number;
  checkpoints: number;
  status: SessionStatus;
  highlights: string[];
}

export interface SessionControllerConfig {
  /** Maximum concurrent sessions (default: 3) */
  maxConcurrent: number;
  /** Maximum command queue size (default: 50) */
  maxCommandQueue: number;
  /** Maximum checkpoints per session (default: 100) */
  maxCheckpoints: number;
  /** Default session config */
  defaults: Partial<SessionConfig>;
}

const DEFAULT_SESSION_CONFIG: SessionConfig = {
  mode: 'general',
  feedbackLevel: 'normal',
  autoSaveInterval: 60000,
  inactivityTimeout: 300000,
  maxDuration: 14400000,
  announceProgress: true,
  progressInterval: 300000,
  privacyMode: false,
};

const DEFAULT_CONTROLLER_CONFIG: SessionControllerConfig = {
  maxConcurrent: 3,
  maxCommandQueue: 50,
  maxCheckpoints: 100,
  defaults: {},
};

// ─── Built-in Templates ────────────────────────────────────────────────────────

const BUILT_IN_TEMPLATES: SessionTemplate[] = [
  {
    id: 'quick-count',
    name: 'Quick Inventory Count',
    description: 'Fast inventory count for a single department or aisle',
    mode: 'inventory',
    config: {
      feedbackLevel: 'normal',
      announceProgress: true,
      progressInterval: 120000,
    },
    setupCommands: ['start inventory'],
    agents: ['inventory', 'barcode'],
  },
  {
    id: 'full-store-count',
    name: 'Full Store Inventory',
    description: 'Complete store inventory with layout mapping and reconciliation',
    mode: 'inventory',
    config: {
      feedbackLevel: 'normal',
      announceProgress: true,
      progressInterval: 300000,
      maxDuration: 28800000, // 8 hours
    },
    setupCommands: ['start inventory', 'enable layout mapping'],
    agents: ['inventory', 'barcode', 'layout', 'reconciliation'],
  },
  {
    id: 'property-inspection',
    name: 'Property Inspection',
    description: 'Walk-through inspection with auto-documentation',
    mode: 'inspection',
    config: {
      feedbackLevel: 'verbose',
      announceProgress: true,
      progressInterval: 600000,
    },
    setupCommands: ['start inspection'],
    agents: ['inspection', 'security'],
  },
  {
    id: 'conference-networking',
    name: 'Conference Networking',
    description: 'Badge scanning and contact intelligence at events',
    mode: 'networking',
    config: {
      feedbackLevel: 'minimal',
      announceProgress: false,
    },
    setupCommands: ['start networking'],
    agents: ['networking', 'security'],
  },
  {
    id: 'shopping-trip',
    name: 'Smart Shopping',
    description: 'Price comparison and deal hunting',
    mode: 'shopping',
    config: {
      feedbackLevel: 'normal',
      announceProgress: false,
    },
    setupCommands: ['start shopping'],
    agents: ['deals', 'context', 'nutrition'],
  },
  {
    id: 'team-meeting',
    name: 'Meeting Intelligence',
    description: 'Transcription, action items, and visual capture',
    mode: 'meeting',
    config: {
      feedbackLevel: 'silent',
      announceProgress: false,
      inactivityTimeout: 0,
    },
    setupCommands: ['start meeting'],
    agents: ['meeting', 'translation'],
  },
  {
    id: 'security-patrol',
    name: 'Security Patrol',
    description: 'Threat detection and incident documentation',
    mode: 'security',
    config: {
      feedbackLevel: 'normal',
      announceProgress: true,
      progressInterval: 600000,
    },
    setupCommands: ['start security scan'],
    agents: ['security', 'inspection'],
  },
];

// ─── Mode-to-Agents Mapping ────────────────────────────────────────────────────

const MODE_AGENTS: Record<SessionMode, string[]> = {
  inventory: ['inventory', 'barcode', 'layout', 'reconciliation'],
  inspection: ['inspection', 'security', 'context'],
  networking: ['networking', 'translation'],
  shopping: ['deals', 'context', 'barcode'],
  meeting: ['meeting', 'translation', 'context'],
  security: ['security', 'inspection'],
  exploration: ['memory', 'context', 'translation', 'deals'],
  debug: ['debug', 'context'],
  translation: ['translation', 'context'],
  general: ['context', 'memory'],
};

// ─── Controller ────────────────────────────────────────────────────────────────

export class SessionController extends EventEmitter {
  private controllerConfig: SessionControllerConfig;
  private sessions: Map<string, SessionState> = new Map();
  private activeSessionId: string | null = null;
  private commandQueues: Map<string, VoiceCommand[]> = new Map();
  private timers: Map<string, NodeJS.Timeout[]> = new Map();
  private templates: Map<string, SessionTemplate> = new Map();
  private commandHistory: VoiceCommand[] = [];

  constructor(config: Partial<SessionControllerConfig> = {}) {
    super();
    this.controllerConfig = { ...DEFAULT_CONTROLLER_CONFIG, ...config };
    
    // Register built-in templates
    for (const template of BUILT_IN_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  // ─── Session Lifecycle ─────────────────────────────────────────────────────

  /**
   * Start a new session.
   */
  startSession(config: Partial<SessionConfig> = {}): SessionState {
    // Check concurrent limit
    const activeSessions = Array.from(this.sessions.values())
      .filter(s => s.status === 'active' || s.status === 'paused');
    if (activeSessions.length >= this.controllerConfig.maxConcurrent) {
      throw new Error(
        `Maximum concurrent sessions (${this.controllerConfig.maxConcurrent}) reached. ` +
        `End an existing session first.`
      );
    }

    const sessionConfig: SessionConfig = {
      ...DEFAULT_SESSION_CONFIG,
      ...this.controllerConfig.defaults,
      ...config,
    };

    const id = this.generateId();
    const now = Date.now();
    const agents = MODE_AGENTS[sessionConfig.mode] || MODE_AGENTS.general;

    const state: SessionState = {
      id,
      config: sessionConfig,
      status: 'active',
      startedAt: now,
      pausedAt: null,
      resumedAt: null,
      completedAt: null,
      totalPausedMs: 0,
      activeAgents: [...agents],
      commandCount: 0,
      imageCount: 0,
      lastActivityAt: now,
      metadata: {},
      checkpoints: [],
    };

    this.sessions.set(id, state);
    this.commandQueues.set(id, []);
    this.activeSessionId = id;

    // Set up timers
    this.setupTimers(id, sessionConfig);

    this.emit('session:started', state);
    return state;
  }

  /**
   * Start a session from a template.
   */
  startFromTemplate(templateId: string, overrides: Partial<SessionConfig> = {}): SessionState {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template '${templateId}' not found`);
    }

    const config: Partial<SessionConfig> = {
      ...template.config,
      mode: template.mode,
      name: template.name,
      ...overrides,
    };

    const state = this.startSession(config);

    // Override agents from template
    state.activeAgents = [...template.agents];
    state.metadata.templateId = template.id;

    this.emit('session:template_applied', { sessionId: state.id, templateId });
    return state;
  }

  /**
   * Pause the current or specified session.
   */
  pauseSession(sessionId?: string): SessionState {
    const id = sessionId || this.activeSessionId;
    if (!id) throw new Error('No active session');

    const state = this.sessions.get(id);
    if (!state) throw new Error(`Session ${id} not found`);
    if (state.status !== 'active') throw new Error(`Session is ${state.status}, cannot pause`);

    state.status = 'paused';
    state.pausedAt = Date.now();
    state.lastActivityAt = Date.now();

    // Clear timers
    this.clearTimers(id);

    this.emit('session:paused', state);
    return state;
  }

  /**
   * Resume a paused session.
   */
  resumeSession(sessionId?: string): SessionState {
    const id = sessionId || this.activeSessionId;
    if (!id) throw new Error('No active session to resume');

    const state = this.sessions.get(id);
    if (!state) throw new Error(`Session ${id} not found`);
    if (state.status !== 'paused') throw new Error(`Session is ${state.status}, cannot resume`);

    const pauseDuration = Date.now() - (state.pausedAt || Date.now());
    state.totalPausedMs += pauseDuration;
    state.status = 'active';
    state.resumedAt = Date.now();
    state.pausedAt = null;
    state.lastActivityAt = Date.now();

    // Restart timers
    this.setupTimers(id, state.config);

    this.emit('session:resumed', state);
    return state;
  }

  /**
   * End a session with summary.
   */
  endSession(sessionId?: string): SessionSummary {
    const id = sessionId || this.activeSessionId;
    if (!id) throw new Error('No active session');

    const state = this.sessions.get(id);
    if (!state) throw new Error(`Session ${id} not found`);
    if (state.status === 'completed' || state.status === 'cancelled') {
      throw new Error(`Session already ${state.status}`);
    }

    state.status = 'completing';
    state.completedAt = Date.now();
    state.lastActivityAt = Date.now();

    // Calculate pause time if currently paused
    if (state.pausedAt) {
      state.totalPausedMs += Date.now() - state.pausedAt;
    }

    // Clear timers
    this.clearTimers(id);

    // Generate summary
    const summary = this.generateSessionSummary(state);
    state.status = 'completed';

    if (this.activeSessionId === id) {
      this.activeSessionId = null;
    }

    this.emit('session:ended', { state, summary });
    return summary;
  }

  /**
   * Cancel a session without summary.
   */
  cancelSession(sessionId?: string): void {
    const id = sessionId || this.activeSessionId;
    if (!id) throw new Error('No active session');

    const state = this.sessions.get(id);
    if (!state) throw new Error(`Session ${id} not found`);

    state.status = 'cancelled';
    state.completedAt = Date.now();
    this.clearTimers(id);

    if (this.activeSessionId === id) {
      this.activeSessionId = null;
    }

    this.emit('session:cancelled', state);
  }

  // ─── Session Queries ───────────────────────────────────────────────────────

  getSession(sessionId: string): SessionState | null {
    return this.sessions.get(sessionId) || null;
  }

  getActiveSession(): SessionState | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) || null;
  }

  getAllSessions(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): SessionState[] {
    return Array.from(this.sessions.values())
      .filter(s => s.status === 'active' || s.status === 'paused');
  }

  // ─── Command Processing ────────────────────────────────────────────────────

  /**
   * Queue a voice command for processing.
   */
  queueCommand(
    text: string,
    intent: string,
    params: Record<string, string> = {},
    priority: number = 5,
    sessionId?: string
  ): VoiceCommand {
    const id = sessionId || this.activeSessionId;
    if (!id) throw new Error('No active session for command');

    const state = this.sessions.get(id);
    if (!state) throw new Error(`Session ${id} not found`);
    if (state.status !== 'active') throw new Error(`Session is ${state.status}, cannot accept commands`);

    const queue = this.commandQueues.get(id) || [];

    // Enforce queue limit
    if (queue.length >= this.controllerConfig.maxCommandQueue) {
      // Remove oldest low-priority command
      const lowPriorityIdx = queue.findIndex(c => !c.processed && c.priority >= 5);
      if (lowPriorityIdx >= 0) {
        queue.splice(lowPriorityIdx, 1);
      } else {
        throw new Error('Command queue full');
      }
    }

    const command: VoiceCommand = {
      id: this.generateId(),
      text,
      intent,
      params,
      priority,
      timestamp: Date.now(),
      processed: false,
    };

    // Insert by priority (lower number = higher priority)
    const insertIdx = queue.findIndex(c => !c.processed && c.priority > priority);
    if (insertIdx >= 0) {
      queue.splice(insertIdx, 0, command);
    } else {
      queue.push(command);
    }

    this.commandQueues.set(id, queue);
    state.commandCount++;
    state.lastActivityAt = Date.now();

    this.commandHistory.push(command);

    this.emit('command:queued', { sessionId: id, command });
    return command;
  }

  /**
   * Get the next unprocessed command from the queue.
   */
  getNextCommand(sessionId?: string): VoiceCommand | null {
    const id = sessionId || this.activeSessionId;
    if (!id) return null;

    const queue = this.commandQueues.get(id) || [];
    return queue.find(c => !c.processed) || null;
  }

  /**
   * Mark a command as processed with result.
   */
  completeCommand(commandId: string, result: CommandResult): void {
    for (const [sessionId, queue] of this.commandQueues) {
      const cmd = queue.find(c => c.id === commandId);
      if (cmd) {
        cmd.processed = true;
        cmd.result = result.response;

        const state = this.sessions.get(sessionId);
        if (state) {
          state.lastActivityAt = Date.now();
        }

        this.emit('command:completed', { sessionId, command: cmd, result });
        return;
      }
    }
    throw new Error(`Command ${commandId} not found`);
  }

  /**
   * Get command history for a session.
   */
  getCommandHistory(sessionId?: string, limit: number = 50): VoiceCommand[] {
    if (sessionId) {
      const queue = this.commandQueues.get(sessionId) || [];
      return queue.filter(c => c.processed).slice(-limit);
    }
    return this.commandHistory.slice(-limit);
  }

  // ─── Image Tracking ────────────────────────────────────────────────────────

  /**
   * Record an image capture in the current session.
   */
  recordImage(sessionId?: string): void {
    const id = sessionId || this.activeSessionId;
    if (!id) return;

    const state = this.sessions.get(id);
    if (!state || state.status !== 'active') return;

    state.imageCount++;
    state.lastActivityAt = Date.now();

    this.emit('session:image_captured', { sessionId: id, count: state.imageCount });
  }

  // ─── Checkpoints ───────────────────────────────────────────────────────────

  /**
   * Save a checkpoint in the session (e.g., "aisle 5 complete").
   */
  addCheckpoint(
    label: string,
    data: Record<string, unknown> = {},
    sessionId?: string
  ): SessionCheckpoint {
    const id = sessionId || this.activeSessionId;
    if (!id) throw new Error('No active session');

    const state = this.sessions.get(id);
    if (!state) throw new Error(`Session ${id} not found`);

    const checkpoint: SessionCheckpoint = {
      timestamp: Date.now(),
      label,
      data,
    };

    state.checkpoints.push(checkpoint);

    // Enforce limit
    if (state.checkpoints.length > this.controllerConfig.maxCheckpoints) {
      state.checkpoints = state.checkpoints.slice(-this.controllerConfig.maxCheckpoints);
    }

    state.lastActivityAt = Date.now();
    this.emit('session:checkpoint', { sessionId: id, checkpoint });
    return checkpoint;
  }

  /**
   * Get checkpoints for a session.
   */
  getCheckpoints(sessionId?: string): SessionCheckpoint[] {
    const id = sessionId || this.activeSessionId;
    if (!id) return [];
    
    const state = this.sessions.get(id);
    return state?.checkpoints || [];
  }

  // ─── Mode Management ──────────────────────────────────────────────────────

  /**
   * Switch the mode of an active session.
   */
  switchMode(newMode: SessionMode, sessionId?: string): void {
    const id = sessionId || this.activeSessionId;
    if (!id) throw new Error('No active session');

    const state = this.sessions.get(id);
    if (!state) throw new Error(`Session ${id} not found`);
    if (state.status !== 'active' && state.status !== 'paused') {
      throw new Error(`Session is ${state.status}, cannot switch mode`);
    }

    const oldMode = state.config.mode;
    state.config.mode = newMode;
    state.activeAgents = [...(MODE_AGENTS[newMode] || MODE_AGENTS.general)];
    state.lastActivityAt = Date.now();

    // Add checkpoint for mode switch
    this.addCheckpoint(`Mode: ${oldMode} → ${newMode}`, { oldMode, newMode }, id);

    this.emit('session:mode_changed', { sessionId: id, oldMode, newMode });
  }

  // ─── Agent Management ─────────────────────────────────────────────────────

  /**
   * Add an agent to the active session.
   */
  addAgent(agentId: string, sessionId?: string): void {
    const id = sessionId || this.activeSessionId;
    if (!id) throw new Error('No active session');

    const state = this.sessions.get(id);
    if (!state) throw new Error(`Session ${id} not found`);

    if (!state.activeAgents.includes(agentId)) {
      state.activeAgents.push(agentId);
      this.emit('session:agent_added', { sessionId: id, agentId });
    }
  }

  /**
   * Remove an agent from the active session.
   */
  removeAgent(agentId: string, sessionId?: string): void {
    const id = sessionId || this.activeSessionId;
    if (!id) throw new Error('No active session');

    const state = this.sessions.get(id);
    if (!state) throw new Error(`Session ${id} not found`);

    const idx = state.activeAgents.indexOf(agentId);
    if (idx >= 0) {
      state.activeAgents.splice(idx, 1);
      this.emit('session:agent_removed', { sessionId: id, agentId });
    }
  }

  /**
   * Get active agents for a session.
   */
  getActiveAgents(sessionId?: string): string[] {
    const id = sessionId || this.activeSessionId;
    if (!id) return [];

    const state = this.sessions.get(id);
    return state?.activeAgents || [];
  }

  // ─── Metadata ──────────────────────────────────────────────────────────────

  setMetadata(key: string, value: unknown, sessionId?: string): void {
    const id = sessionId || this.activeSessionId;
    if (!id) return;

    const state = this.sessions.get(id);
    if (state) {
      state.metadata[key] = value;
    }
  }

  getMetadata(key: string, sessionId?: string): unknown {
    const id = sessionId || this.activeSessionId;
    if (!id) return undefined;

    const state = this.sessions.get(id);
    return state?.metadata[key];
  }

  // ─── Templates ─────────────────────────────────────────────────────────────

  /**
   * Register a custom session template.
   */
  registerTemplate(template: SessionTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Get all available templates.
   */
  getTemplates(): SessionTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get a specific template.
   */
  getTemplate(templateId: string): SessionTemplate | null {
    return this.templates.get(templateId) || null;
  }

  // ─── Feedback Level ────────────────────────────────────────────────────────

  /**
   * Change the feedback level during a session.
   */
  setFeedbackLevel(level: FeedbackLevel, sessionId?: string): void {
    const id = sessionId || this.activeSessionId;
    if (!id) return;

    const state = this.sessions.get(id);
    if (state) {
      state.config.feedbackLevel = level;
      this.emit('session:feedback_changed', { sessionId: id, level });
    }
  }

  /**
   * Check if voice feedback should be given based on current level.
   */
  shouldSpeak(priority: 'critical' | 'high' | 'normal' | 'low', sessionId?: string): boolean {
    const id = sessionId || this.activeSessionId;
    if (!id) return false;

    const state = this.sessions.get(id);
    if (!state) return false;

    if (state.config.privacyMode) return false;

    switch (state.config.feedbackLevel) {
      case 'silent': return priority === 'critical';
      case 'minimal': return priority === 'critical' || priority === 'high';
      case 'normal': return priority !== 'low';
      case 'verbose': return true;
      default: return priority !== 'low';
    }
  }

  // ─── Session Duration ──────────────────────────────────────────────────────

  /**
   * Get the active duration of a session (excluding paused time).
   */
  getActiveDuration(sessionId?: string): number {
    const id = sessionId || this.activeSessionId;
    if (!id) return 0;

    const state = this.sessions.get(id);
    if (!state) return 0;

    const endTime = state.completedAt || Date.now();
    let totalMs = endTime - state.startedAt;

    // Subtract paused time
    totalMs -= state.totalPausedMs;

    // If currently paused, also subtract current pause duration
    if (state.status === 'paused' && state.pausedAt) {
      totalMs -= (Date.now() - state.pausedAt);
    }

    return Math.max(0, totalMs);
  }

  /**
   * Format duration as human-readable string.
   */
  formatDuration(ms: number): string {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;

    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m ${seconds}s`;
  }

  // ─── Voice Summaries ───────────────────────────────────────────────────────

  /**
   * Generate a voice-friendly progress update.
   */
  generateProgressUpdate(sessionId?: string): string {
    const id = sessionId || this.activeSessionId;
    if (!id) return 'No active session.';

    const state = this.sessions.get(id);
    if (!state) return 'Session not found.';

    const duration = this.formatDuration(this.getActiveDuration(id));
    const parts: string[] = [];

    parts.push(`${state.config.mode} session running for ${duration}.`);

    if (state.imageCount > 0) {
      parts.push(`${state.imageCount} images captured.`);
    }

    if (state.commandCount > 0) {
      parts.push(`${state.commandCount} commands processed.`);
    }

    if (state.checkpoints.length > 0) {
      const lastCheckpoint = state.checkpoints[state.checkpoints.length - 1];
      parts.push(`Last checkpoint: ${lastCheckpoint.label}.`);
    }

    return parts.join(' ');
  }

  /**
   * Generate a voice-friendly session summary (for end-of-session).
   */
  generateVoiceSummary(sessionId?: string): string {
    const id = sessionId || this.activeSessionId;
    if (!id) return 'No session to summarize.';

    const state = this.sessions.get(id);
    if (!state) return 'Session not found.';

    const summary = this.generateSessionSummary(state);
    const parts: string[] = [];

    parts.push(`${state.config.mode} session complete. Duration: ${summary.duration}.`);
    
    if (summary.imageCount > 0) {
      parts.push(`${summary.imageCount} images captured.`);
    }

    if (summary.commandCount > 0) {
      parts.push(`${summary.commandCount} voice commands processed.`);
    }

    if (summary.checkpoints > 0) {
      parts.push(`${summary.checkpoints} checkpoints saved.`);
    }

    if (summary.highlights.length > 0) {
      parts.push(summary.highlights.join(' '));
    }

    return parts.join(' ');
  }

  // ─── Session Handoff ───────────────────────────────────────────────────────

  /**
   * Export session state for handoff to another device.
   */
  exportSession(sessionId?: string): string {
    const id = sessionId || this.activeSessionId;
    if (!id) throw new Error('No session to export');

    const state = this.sessions.get(id);
    if (!state) throw new Error(`Session ${id} not found`);

    const exportData = {
      state: { ...state },
      commands: this.commandQueues.get(id) || [],
      exportedAt: Date.now(),
    };

    return JSON.stringify(exportData);
  }

  /**
   * Import a session from another device.
   */
  importSession(data: string): SessionState {
    const parsed = JSON.parse(data);
    const state = parsed.state as SessionState;
    
    // Generate new ID to avoid conflicts
    const oldId = state.id;
    state.id = this.generateId();
    state.metadata.importedFrom = oldId;
    state.metadata.importedAt = Date.now();

    this.sessions.set(state.id, state);
    this.commandQueues.set(state.id, parsed.commands || []);

    if (state.status === 'active' || state.status === 'paused') {
      this.activeSessionId = state.id;
      if (state.status === 'active') {
        this.setupTimers(state.id, state.config);
      }
    }

    this.emit('session:imported', state);
    return state;
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Remove completed/cancelled sessions from memory.
   */
  cleanup(keepLast: number = 5): number {
    const completedSessions = Array.from(this.sessions.entries())
      .filter(([_, s]) => s.status === 'completed' || s.status === 'cancelled')
      .sort((a, b) => (a[1].completedAt || 0) - (b[1].completedAt || 0));

    const toRemove = completedSessions.slice(0, Math.max(0, completedSessions.length - keepLast));
    
    for (const [id] of toRemove) {
      this.sessions.delete(id);
      this.commandQueues.delete(id);
    }

    return toRemove.length;
  }

  /**
   * Destroy all sessions and clear state.
   */
  destroy(): void {
    for (const id of this.sessions.keys()) {
      this.clearTimers(id);
    }
    this.sessions.clear();
    this.commandQueues.clear();
    this.commandHistory = [];
    this.activeSessionId = null;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private setupTimers(sessionId: string, config: SessionConfig): void {
    const timers: NodeJS.Timeout[] = [];

    // Auto-save timer
    if (config.autoSaveInterval > 0) {
      const saveTimer = setInterval(() => {
        this.emit('session:auto_save', { sessionId });
      }, config.autoSaveInterval);
      timers.push(saveTimer);
    }

    // Inactivity timer
    if (config.inactivityTimeout > 0) {
      const inactivityTimer = setInterval(() => {
        const state = this.sessions.get(sessionId);
        if (state && state.status === 'active') {
          const elapsed = Date.now() - state.lastActivityAt;
          if (elapsed >= config.inactivityTimeout) {
            this.pauseSession(sessionId);
            this.emit('session:inactivity_pause', { sessionId, elapsed });
          }
        }
      }, Math.min(config.inactivityTimeout, 30000));
      timers.push(inactivityTimer);
    }

    // Progress announcement timer
    if (config.announceProgress && config.progressInterval > 0) {
      const progressTimer = setInterval(() => {
        const state = this.sessions.get(sessionId);
        if (state && state.status === 'active') {
          const update = this.generateProgressUpdate(sessionId);
          this.emit('session:progress', { sessionId, update });
        }
      }, config.progressInterval);
      timers.push(progressTimer);
    }

    // Max duration timer
    if (config.maxDuration > 0) {
      const maxTimer = setTimeout(() => {
        const state = this.sessions.get(sessionId);
        if (state && (state.status === 'active' || state.status === 'paused')) {
          this.emit('session:max_duration', { sessionId });
          this.endSession(sessionId);
        }
      }, config.maxDuration);
      timers.push(maxTimer);
    }

    this.timers.set(sessionId, timers);
  }

  private clearTimers(sessionId: string): void {
    const timers = this.timers.get(sessionId);
    if (timers) {
      for (const timer of timers) {
        clearInterval(timer);
        clearTimeout(timer);
      }
      this.timers.delete(sessionId);
    }
  }

  private generateSessionSummary(state: SessionState): SessionSummary {
    const durationMs = this.getActiveDuration(state.id);
    const duration = this.formatDuration(durationMs);

    const highlights: string[] = [];

    // Add mode-specific highlights
    if (state.config.mode === 'inventory' && state.imageCount > 0) {
      highlights.push(`Scanned ${state.imageCount} shelf sections.`);
    }
    if (state.config.mode === 'inspection' && state.checkpoints.length > 0) {
      highlights.push(`Inspected ${state.checkpoints.length} areas.`);
    }
    if (state.config.mode === 'networking' && state.imageCount > 0) {
      highlights.push(`Captured ${state.imageCount} contacts.`);
    }
    if (state.config.mode === 'meeting') {
      highlights.push('Meeting notes captured.');
    }

    return {
      id: state.id,
      mode: state.config.mode,
      duration,
      durationMs,
      commandCount: state.commandCount,
      imageCount: state.imageCount,
      checkpoints: state.checkpoints.length,
      status: state.status,
      highlights,
    };
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `sess-${timestamp}-${random}`;
  }
}
