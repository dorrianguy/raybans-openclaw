/**
 * Companion WebSocket Endpoint
 *
 * Adds real-time WebSocket communication between the companion app and
 * the existing DashboardApiServer. This handles:
 *
 * - Frame streaming from glasses → vision pipeline
 * - Voice command routing
 * - Agent response delivery
 * - TTS audio streaming
 * - Device status updates
 *
 * Architecture:
 *   Companion App ←WebSocket→ This Handler ←→ ContextRouter + VoiceCommandRouter
 *
 * To integrate with the existing api-server.ts, call:
 *   setupCompanionWebSocket(server, contextRouter, voiceRouter)
 *
 * The WebSocket endpoint is at: ws://host:3847/api/companion
 */

import * as http from 'http';
import { EventEmitter } from 'eventemitter3';
import type { CapturedImage, CaptureTrigger, VoiceCommand } from '../types.js';
import type { ContextRouter, AgentResponse, RoutingDecision } from '../routing/context-router.js';
import type { VoiceCommandRouter } from '../voice/voice-command-router.js';
import type { VisionPipeline } from '../vision/vision-pipeline.js';

// ─── Types ──────────────────────────────────────────────────────

export interface CompanionWSConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Max frame size in bytes (default: 5MB) */
  maxFrameSize?: number;
  /** Heartbeat timeout in ms (default: 60s) */
  heartbeatTimeoutMs?: number;
}

export interface CompanionWSEvents {
  /** Companion app connected */
  'companion:connected': (clientId: string) => void;
  /** Companion app disconnected */
  'companion:disconnected': (clientId: string) => void;
  /** Frame received from companion */
  'companion:frame': (frameId: string, clientId: string) => void;
  /** Voice command received */
  'companion:voice': (text: string, clientId: string) => void;
  /** Error */
  'error': (message: string) => void;
  /** Debug log */
  'log': (message: string) => void;
}

interface CompanionClient {
  id: string;
  socket: WebSocket;
  connectedAt: number;
  lastHeartbeat: number;
  deviceInfo?: {
    connectionState: string;
    batteryLevel: number | null;
  };
}

// Note: This uses the native WebSocket upgrade path from http.Server.
// For the actual WebSocket implementation, we'll use a simple approach
// compatible with Node's http module. In production, use 'ws' package.

// ─── Message Types (must match companion-app backend-client.ts) ──

interface WSFrameMessage {
  type: 'frame';
  frameId: string;
  data: string; // base64 JPEG
  mimeType: string;
  trigger: string;
  voiceAnnotation?: string;
  timestamp: string;
}

interface WSVoiceMessage {
  type: 'voice_command';
  text: string;
  timestamp: string;
}

interface WSGestureMessage {
  type: 'gesture';
  gesture: string;
  timestamp: string;
}

interface WSStatusMessage {
  type: 'status';
  connectionState: string;
  batteryLevel: number | null;
}

interface WSPingMessage {
  type: 'ping';
}

type WSIncomingMessage =
  | WSFrameMessage
  | WSVoiceMessage
  | WSGestureMessage
  | WSStatusMessage
  | WSPingMessage;

interface WSAgentResponseMessage {
  type: 'agent_response';
  response: AgentResponse;
}

interface WSRoutingDecisionMessage {
  type: 'routing_decision';
  decision: RoutingDecision;
}

interface WSVoiceCommandResultMessage {
  type: 'voice_command_result';
  command: VoiceCommand;
}

interface WSTtsAudioMessage {
  type: 'tts_audio';
  audioData: string;
  format: string;
  agentId: string;
}

interface WSErrorMessage {
  type: 'error';
  message: string;
}

type WSOutgoingMessage =
  | WSAgentResponseMessage
  | WSRoutingDecisionMessage
  | WSVoiceCommandResultMessage
  | WSTtsAudioMessage
  | WSErrorMessage
  | { type: 'connected'; clientId: string }
  | { type: 'pong' };

// ─── Companion WebSocket Handler ────────────────────────────────

export class CompanionWebSocketHandler extends EventEmitter<CompanionWSEvents> {
  private config: Required<CompanionWSConfig>;
  private clients: Map<string, CompanionClient> = new Map();
  private clientIdCounter = 0;
  private contextRouter: ContextRouter | null = null;
  private voiceRouter: VoiceCommandRouter | null = null;
  private visionPipeline: VisionPipeline | null = null;
  private heartbeatChecker: ReturnType<typeof setInterval> | null = null;

  constructor(config: CompanionWSConfig = {}) {
    super();
    this.config = {
      debug: config.debug ?? false,
      maxFrameSize: config.maxFrameSize ?? 5 * 1024 * 1024,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 60_000,
    };
  }

  /**
   * Set the context router for dispatching frames to agents.
   */
  setContextRouter(router: ContextRouter): void {
    this.contextRouter = router;

    // Listen for agent responses and forward to companion
    router.on('agent:response', (response) => {
      this.broadcastToCompanions({
        type: 'agent_response',
        response,
      });
    });

    router.on('route:decided', (decision) => {
      this.broadcastToCompanions({
        type: 'routing_decision',
        decision,
      });
    });
  }

  /**
   * Set the voice command router.
   */
  setVoiceRouter(router: VoiceCommandRouter): void {
    this.voiceRouter = router;
  }

  /**
   * Set the vision pipeline for frame analysis.
   */
  setVisionPipeline(pipeline: VisionPipeline): void {
    this.visionPipeline = pipeline;
  }

  /**
   * Handle an HTTP upgrade request for WebSocket at /api/companion.
   * This should be called from the main HTTP server's 'upgrade' event.
   *
   * Note: This is a simplified implementation. In production,
   * use the 'ws' npm package for proper WebSocket handling.
   */
  handleUpgrade(
    req: http.IncomingMessage,
    socket: import('net').Socket,
    head: Buffer,
  ): void {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname !== '/api/companion') {
      socket.destroy();
      return;
    }

    // WebSocket handshake
    // In production, use the 'ws' package. This is a stub to show the integration point.
    this.log(`Companion WebSocket upgrade request from ${req.socket.remoteAddress}`);

    // The actual WebSocket upgrade would happen here with the 'ws' package:
    // wss.handleUpgrade(req, socket, head, (ws) => { ... });

    // For now, we document the expected behavior:
    this.log('WebSocket upgrade — implement with "ws" package in production');
  }

  /**
   * Register a connected companion client.
   * Called when WebSocket connection is established.
   */
  registerClient(ws: any /* WebSocket from 'ws' package */): string {
    const clientId = `companion-${++this.clientIdCounter}`;

    const client: CompanionClient = {
      id: clientId,
      socket: ws,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    this.clients.set(clientId, client);
    this.emit('companion:connected', clientId);
    this.log(`Companion connected: ${clientId} (${this.clients.size} total)`);

    // Send connected acknowledgment
    this.sendToClient(clientId, { type: 'connected', clientId });

    // Set up message handler
    ws.on('message', (data: string | Buffer) => {
      this.handleMessage(clientId, data);
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      this.emit('companion:disconnected', clientId);
      this.log(`Companion disconnected: ${clientId} (${this.clients.size} total)`);
    });

    ws.on('error', (err: Error) => {
      this.emit('error', `Client ${clientId} error: ${err.message}`);
    });

    // Start heartbeat checker if not running
    if (!this.heartbeatChecker) {
      this.startHeartbeatChecker();
    }

    return clientId;
  }

  /**
   * Send a message to a specific companion client.
   */
  sendToClient(clientId: string, message: WSOutgoingMessage): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.socket.send(JSON.stringify(message));
      } catch {
        this.clients.delete(clientId);
      }
    }
  }

  /**
   * Broadcast a message to all connected companions.
   */
  broadcastToCompanions(message: WSOutgoingMessage): void {
    const payload = JSON.stringify(message);
    for (const [id, client] of this.clients) {
      try {
        client.socket.send(payload);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  /**
   * Send TTS audio to companion for glasses playback.
   */
  sendTtsAudio(audioData: string, format: string, agentId: string): void {
    this.broadcastToCompanions({
      type: 'tts_audio',
      audioData,
      format,
      agentId,
    });
  }

  /**
   * Get the number of connected companion clients.
   */
  get connectedCount(): number {
    return this.clients.size;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.heartbeatChecker) {
      clearInterval(this.heartbeatChecker);
      this.heartbeatChecker = null;
    }

    for (const [id, client] of this.clients) {
      try {
        client.socket.close();
      } catch {
        // Ignore
      }
    }
    this.clients.clear();
  }

  // ─── Private: Message Handling ────────────────────────────

  private handleMessage(clientId: string, rawData: string | Buffer): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.lastHeartbeat = Date.now();

    try {
      const data = typeof rawData === 'string'
        ? rawData
        : rawData.toString('utf-8');

      const msg = JSON.parse(data) as WSIncomingMessage;

      switch (msg.type) {
        case 'frame':
          this.handleFrame(clientId, msg);
          break;
        case 'voice_command':
          this.handleVoiceCommand(clientId, msg);
          break;
        case 'gesture':
          this.handleGesture(clientId, msg);
          break;
        case 'status':
          this.handleStatus(clientId, msg);
          break;
        case 'ping':
          this.sendToClient(clientId, { type: 'pong' });
          break;
        default:
          this.log(`Unknown message type from ${clientId}`);
      }
    } catch (err) {
      this.emit('error', `Failed to parse message from ${clientId}: ${err}`);
    }
  }

  private async handleFrame(clientId: string, msg: WSFrameMessage): Promise<void> {
    this.emit('companion:frame', msg.frameId, clientId);
    this.log(`Frame ${msg.frameId} from ${clientId} (trigger: ${msg.trigger})`);

    if (!this.visionPipeline || !this.contextRouter) {
      this.sendToClient(clientId, {
        type: 'error',
        message: 'Vision pipeline or context router not configured',
      });
      return;
    }

    try {
      // Convert base64 frame to CapturedImage
      const imageBuffer = Buffer.from(msg.data, 'base64');
      const capturedImage: CapturedImage = {
        id: msg.frameId,
        buffer: imageBuffer,
        mimeType: msg.mimeType as 'image/jpeg' | 'image/png',
        capturedAt: msg.timestamp,
        deviceId: `companion-${clientId}`,
        trigger: msg.trigger as CaptureTrigger,
        voiceAnnotation: msg.voiceAnnotation,
      };

      // Run through vision pipeline
      const analysis = await this.visionPipeline.analyze(capturedImage);

      if (analysis.success && analysis.data) {
        // Route to agents
        const responses = await this.contextRouter.route(
          capturedImage,
          analysis.data,
          msg.voiceAnnotation ? 'voice' : 'auto',
        );

        // Responses are automatically broadcast via the contextRouter event listeners
        this.log(`Frame ${msg.frameId}: ${responses.length} agent responses`);
      }
    } catch (err) {
      this.emit('error', `Frame processing error: ${err}`);
      this.sendToClient(clientId, {
        type: 'error',
        message: `Frame processing failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private handleVoiceCommand(clientId: string, msg: WSVoiceMessage): void {
    this.emit('companion:voice', msg.text, clientId);
    this.log(`Voice command from ${clientId}: "${msg.text}"`);

    if (!this.voiceRouter) {
      this.sendToClient(clientId, {
        type: 'error',
        message: 'Voice router not configured',
      });
      return;
    }

    // Parse the voice command
    const command = this.voiceRouter.parse(msg.text);

    // Send back the parsed command
    this.sendToClient(clientId, {
      type: 'voice_command_result',
      command,
    });

    // Route to appropriate agent via context router
    if (this.contextRouter && command.intent !== 'unknown') {
      const agent = this.contextRouter.routeVoiceCommand(command.intent, command.params);
      if (agent) {
        this.log(`Voice command routed to agent: ${agent.id}`);
      }
    }
  }

  private handleGesture(clientId: string, msg: WSGestureMessage): void {
    this.log(`Gesture from ${clientId}: ${msg.gesture}`);

    // Temple tap = capture photo
    if (msg.gesture === 'double_tap') {
      // Trigger a capture from the companion app side
      // (the companion app handles the actual capture, we just acknowledge)
      this.log('Double tap gesture — companion should trigger capture');
    }
  }

  private handleStatus(clientId: string, msg: WSStatusMessage): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.deviceInfo = {
        connectionState: msg.connectionState,
        batteryLevel: msg.batteryLevel,
      };
    }
  }

  // ─── Private: Heartbeat ───────────────────────────────────

  private startHeartbeatChecker(): void {
    this.heartbeatChecker = setInterval(() => {
      const now = Date.now();
      for (const [id, client] of this.clients) {
        if (now - client.lastHeartbeat > this.config.heartbeatTimeoutMs) {
          this.log(`Client ${id} heartbeat timeout — disconnecting`);
          try {
            client.socket.close();
          } catch {
            // Ignore
          }
          this.clients.delete(id);
          this.emit('companion:disconnected', id);
        }
      }

      // Stop checker if no clients
      if (this.clients.size === 0 && this.heartbeatChecker) {
        clearInterval(this.heartbeatChecker);
        this.heartbeatChecker = null;
      }
    }, 30_000);
  }

  // ─── Private: Helpers ─────────────────────────────────────

  private log(message: string): void {
    if (this.config.debug) {
      this.emit('log', `[CompanionWS] ${message}`);
    }
  }
}
