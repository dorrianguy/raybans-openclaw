/**
 * Backend Client Service
 *
 * WebSocket + REST client that connects the companion app to the
 * existing raybans-openclaw DashboardApiServer backend.
 *
 * Handles:
 * - WebSocket connection for real-time frame streaming and agent responses
 * - REST API calls for health, settings, sessions, and one-shot requests
 * - Offline frame queue with automatic flush on reconnect
 * - Authentication via bearer token
 * - Heartbeat/keepalive for connection monitoring
 */

import type { BufferedFrame } from './camera-capture';
import {
  DEFAULT_BACKEND_URL,
  DEFAULT_WS_URL,
  API_TIMEOUT_MS,
  WS_RECONNECT_DELAY_MS,
  WS_MAX_RECONNECT_ATTEMPTS,
  WS_HEARTBEAT_INTERVAL_MS,
} from '../utils/constants';

// ─── Types (aligned with backend types) ─────────────────────────

/** Maps to backend RoutingMode */
export type RoutingMode =
  | 'inventory' | 'networking' | 'shopping' | 'meeting'
  | 'inspection' | 'debugging' | 'memory' | 'security'
  | 'translation' | 'deals' | 'general';

/** Maps to backend AgentResponse */
export interface AgentResponse {
  agentId: string;
  handled: boolean;
  voiceResponse?: string;
  data?: Record<string, unknown>;
  confidence: number;
  priority: number;
  processingTimeMs: number;
}

/** Maps to backend VoiceCommand */
export interface VoiceCommand {
  rawText: string;
  intent: string;
  params: Record<string, string>;
  confidence: number;
  timestamp: string;
}

/** Maps to backend SpecialistAgent info for the app */
export interface AgentInfo {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
}

/** Maps to backend RoutingDecision */
export interface RoutingDecision {
  agents: AgentInfo[];
  mode: RoutingMode;
  confidence: number;
  reason: string;
  timestamp: string;
}

/** Health response from /api/health */
export interface HealthStatus {
  status: 'ok' | 'error';
  uptime: number;
  liveSession: { id: string; status: string; name: string } | null;
  db: Record<string, number>;
  connectedClients: number;
}

// ─── WebSocket Message Types ────────────────────────────────────

export type WSOutgoingMessage =
  | { type: 'frame'; frameId: string; data: string; mimeType: string; trigger: string; voiceAnnotation?: string; timestamp: string }
  | { type: 'voice_command'; text: string; timestamp: string }
  | { type: 'gesture'; gesture: string; timestamp: string }
  | { type: 'status'; connectionState: string; batteryLevel: number | null }
  | { type: 'ping' };

export type WSIncomingMessage =
  | { type: 'agent_response'; response: AgentResponse }
  | { type: 'routing_decision'; decision: RoutingDecision }
  | { type: 'voice_command_result'; command: VoiceCommand }
  | { type: 'session:updated'; session: unknown; itemCount: number }
  | { type: 'item:updated'; item: unknown }
  | { type: 'item:flagged'; item: unknown; flag: string }
  | { type: 'tts_audio'; audioData: string; format: string; agentId: string }
  | { type: 'connected'; clientId: string }
  | { type: 'error'; message: string }
  | { type: 'pong' };

// ─── Client Configuration ───────────────────────────────────────

export interface BackendClientConfig {
  /** REST API base URL */
  baseUrl: string;
  /** WebSocket URL */
  wsUrl: string;
  /** Optional auth token */
  authToken?: string;
  /** Request timeout in ms */
  timeoutMs: number;
  /** Enable auto-reconnect for WebSocket */
  autoReconnect: boolean;
  /** Max WebSocket reconnect attempts */
  maxReconnectAttempts: number;
  /** Heartbeat interval in ms */
  heartbeatIntervalMs: number;
}

export const DEFAULT_CLIENT_CONFIG: BackendClientConfig = {
  baseUrl: DEFAULT_BACKEND_URL,
  wsUrl: DEFAULT_WS_URL,
  authToken: undefined,
  timeoutMs: API_TIMEOUT_MS,
  autoReconnect: true,
  maxReconnectAttempts: WS_MAX_RECONNECT_ATTEMPTS,
  heartbeatIntervalMs: WS_HEARTBEAT_INTERVAL_MS,
};

// ─── Client Callbacks ───────────────────────────────────────────

export interface BackendClientCallbacks {
  /** WebSocket connection state changed */
  onConnectionChange?: (connected: boolean) => void;
  /** Agent response received */
  onAgentResponse?: (response: AgentResponse) => void;
  /** Routing decision received */
  onRoutingDecision?: (decision: RoutingDecision) => void;
  /** Voice command result from backend */
  onVoiceCommandResult?: (command: VoiceCommand) => void;
  /** TTS audio received for playback */
  onTtsAudio?: (audioData: string, format: string, agentId: string) => void;
  /** Session update from backend */
  onSessionUpdate?: (data: unknown) => void;
  /** Error */
  onError?: (error: Error) => void;
}

// ─── Backend Client Service ─────────────────────────────────────

export class BackendClientService {
  private config: BackendClientConfig;
  private callbacks: BackendClientCallbacks = {};
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private offlineQueue: WSOutgoingMessage[] = [];

  constructor(config: Partial<BackendClientConfig> = {}) {
    this.config = { ...DEFAULT_CLIENT_CONFIG, ...config };
  }

  // ─── Public API ───────────────────────────────────────────

  get isConnected(): boolean {
    return this.wsConnected;
  }

  /** Set event callbacks */
  setCallbacks(callbacks: BackendClientCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Update configuration (e.g., new backend URL) */
  updateConfig(config: Partial<BackendClientConfig>): void {
    const urlChanged = config.baseUrl !== undefined || config.wsUrl !== undefined;
    this.config = { ...this.config, ...config };

    // Reconnect if URL changed
    if (urlChanged && this.wsConnected) {
      this.disconnectWs();
      this.connectWs();
    }
  }

  // ── WebSocket Methods ─────────────────────────────────────

  /** Connect WebSocket for real-time communication */
  async connectWs(): Promise<void> {
    if (this.ws && this.wsConnected) return;

    const wsUrl = `${this.config.wsUrl}/api/companion`;

    return new Promise((resolve, reject) => {
      try {
        const headers: Record<string, string> = {};
        if (this.config.authToken) {
          headers.Authorization = `Bearer ${this.config.authToken}`;
        }

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[BackendClient] WebSocket connected');
          this.wsConnected = true;
          this.reconnectAttempts = 0;
          this.callbacks.onConnectionChange?.(true);
          this.startHeartbeat();
          this.flushOfflineQueue();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as WSIncomingMessage;
            this.handleWsMessage(msg);
          } catch {
            console.warn('[BackendClient] Failed to parse WS message');
          }
        };

        this.ws.onerror = (_event) => {
          const error = new Error('WebSocket connection error');
          this.callbacks.onError?.(error);
          if (!this.wsConnected) reject(error);
        };

        this.ws.onclose = () => {
          console.log('[BackendClient] WebSocket disconnected');
          this.wsConnected = false;
          this.stopHeartbeat();
          this.callbacks.onConnectionChange?.(false);

          if (this.config.autoReconnect) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /** Disconnect WebSocket */
  disconnectWs(): void {
    this.config.autoReconnect = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.wsConnected = false;
  }

  /** Send a camera frame to the backend */
  sendFrame(frame: BufferedFrame): void {
    const msg: WSOutgoingMessage = {
      type: 'frame',
      frameId: frame.id,
      data: frame.frame.data,
      mimeType: frame.frame.mimeType,
      trigger: frame.trigger,
      voiceAnnotation: frame.voiceAnnotation,
      timestamp: frame.frame.timestamp,
    };

    this.sendWsMessage(msg);
  }

  /** Send a voice command to the backend */
  sendVoiceCommand(text: string): void {
    const msg: WSOutgoingMessage = {
      type: 'voice_command',
      text,
      timestamp: new Date().toISOString(),
    };

    this.sendWsMessage(msg);
  }

  /** Send a gesture event to the backend */
  sendGesture(gesture: string): void {
    const msg: WSOutgoingMessage = {
      type: 'gesture',
      gesture,
      timestamp: new Date().toISOString(),
    };

    this.sendWsMessage(msg);
  }

  /** Send glasses status to the backend */
  sendStatus(connectionState: string, batteryLevel: number | null): void {
    const msg: WSOutgoingMessage = {
      type: 'status',
      connectionState,
      batteryLevel,
    };

    this.sendWsMessage(msg);
  }

  // ── REST Methods ──────────────────────────────────────────

  /** Check backend health */
  async getHealth(): Promise<HealthStatus> {
    return this.get<HealthStatus>('/api/health');
  }

  /** Get current live session */
  async getLiveSession(): Promise<{ active: boolean; session?: unknown }> {
    return this.get('/api/live');
  }

  /** Get live session items */
  async getLiveItems(params?: Record<string, string>): Promise<{ items: unknown[]; total: number }> {
    return this.get('/api/live/items', params);
  }

  /** List sessions */
  async listSessions(params?: Record<string, string>): Promise<{ sessions: unknown[] }> {
    return this.get('/api/sessions', params);
  }

  /** Get session by ID */
  async getSession(sessionId: string): Promise<{ session: unknown }> {
    return this.get(`/api/sessions/${sessionId}`);
  }

  /** Search memory */
  async searchMemory(query: string, limit = 20): Promise<{ results: unknown[] }> {
    return this.get('/api/memory/search', { q: query, limit: String(limit) });
  }

  /** Get memory stats */
  async getMemoryStats(): Promise<Record<string, number>> {
    return this.get('/api/memory/stats');
  }

  /** Get routing stats */
  async getRoutingStats(): Promise<Record<string, unknown>> {
    return this.get('/api/routing/stats');
  }

  /** Get agent list */
  async getAgents(): Promise<{ agents: AgentInfo[] }> {
    return this.get('/api/agents');
  }

  /** Enable/disable an agent */
  async setAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
    await this.post(`/api/agents/${agentId}`, { enabled });
  }

  /** Send a single frame via REST (fallback when WebSocket is down) */
  async sendFrameRest(frame: BufferedFrame): Promise<AgentResponse[]> {
    const body = {
      frameId: frame.id,
      data: frame.frame.data,
      mimeType: frame.frame.mimeType,
      trigger: frame.trigger,
      voiceAnnotation: frame.voiceAnnotation,
      timestamp: frame.frame.timestamp,
    };

    return this.post<AgentResponse[]>('/api/companion/frame', body);
  }

  /** Send a voice command via REST */
  async sendVoiceCommandRest(text: string): Promise<VoiceCommand> {
    return this.post<VoiceCommand>('/api/companion/voice', { text });
  }

  // ─── Private: WebSocket ───────────────────────────────────

  private sendWsMessage(msg: WSOutgoingMessage): void {
    if (this.ws && this.wsConnected) {
      this.ws.send(JSON.stringify(msg));
    } else {
      // Queue for when we reconnect
      this.offlineQueue.push(msg);
      console.log(`[BackendClient] Queued message (${this.offlineQueue.length} in queue)`);
    }
  }

  private handleWsMessage(msg: WSIncomingMessage): void {
    switch (msg.type) {
      case 'agent_response':
        this.callbacks.onAgentResponse?.(msg.response);
        break;

      case 'routing_decision':
        this.callbacks.onRoutingDecision?.(msg.decision);
        break;

      case 'voice_command_result':
        this.callbacks.onVoiceCommandResult?.(msg.command);
        break;

      case 'tts_audio':
        this.callbacks.onTtsAudio?.(msg.audioData, msg.format, msg.agentId);
        break;

      case 'session:updated':
      case 'item:updated':
      case 'item:flagged':
        this.callbacks.onSessionUpdate?.(msg);
        break;

      case 'connected':
        console.log(`[BackendClient] Server assigned client ID: ${msg.clientId}`);
        break;

      case 'error':
        this.callbacks.onError?.(new Error(msg.message));
        break;

      case 'pong':
        // Heartbeat acknowledged
        break;
    }
  }

  private flushOfflineQueue(): void {
    if (this.offlineQueue.length === 0) return;

    console.log(`[BackendClient] Flushing ${this.offlineQueue.length} queued messages`);
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];

    for (const msg of queue) {
      this.sendWsMessage(msg);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.log('[BackendClient] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = WS_RECONNECT_DELAY_MS * Math.pow(1.5, this.reconnectAttempts - 1);

    console.log(
      `[BackendClient] Reconnecting in ${delay}ms ` +
      `(attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.connectWs().catch((err) => {
        console.error('[BackendClient] Reconnect failed:', err);
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendWsMessage({ type: 'ping' });
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Private: REST Helpers ────────────────────────────────

  private async get<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
    let url = `${this.config.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${responseBody}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.authToken) {
      headers.Authorization = `Bearer ${this.config.authToken}`;
    }
    return headers;
  }

  /** Clean up all resources */
  dispose(): void {
    this.disconnectWs();
    this.offlineQueue = [];
  }
}
