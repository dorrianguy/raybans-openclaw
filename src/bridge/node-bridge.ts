/**
 * OpenClaw Node Bridge — Connects Ray-Ban smart glasses to the platform.
 *
 * The Ray-Bans pair to a phone, which runs as an OpenClaw paired node.
 * This bridge talks to the OpenClaw gateway to:
 * - Capture images from the glasses camera (camera_snap)
 * - Receive audio input (mic → STT pipeline)
 * - Send TTS audio back to glasses speaker
 * - Monitor device connectivity
 *
 * Architecture:
 *   Ray-Ban Glasses → Phone (OpenClaw Node) → Gateway → This Bridge → Agents
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import type { CapturedImage, CaptureTrigger, GeoLocation } from '../types.js';

// ─── Configuration ──────────────────────────────────────────────

export interface NodeBridgeConfig {
  /** OpenClaw gateway URL (e.g., http://localhost:9315) */
  gatewayUrl: string;
  /** Gateway authentication token */
  gatewayToken: string;
  /** Node ID of the paired phone/glasses device */
  nodeId: string;
  /** Camera facing to use (back = glasses camera, front = selfie) */
  cameraFacing?: 'front' | 'back';
  /** Maximum image width in pixels (downscale for faster processing) */
  maxImageWidth?: number;
  /** Image quality (0-100 for JPEG) */
  imageQuality?: number;
  /** Timeout for camera snap in ms */
  snapTimeoutMs?: number;
  /** Timeout for TTS delivery in ms */
  ttsTimeoutMs?: number;
  /** Enable debug logging */
  debug?: boolean;
}

const DEFAULT_CONFIG: Partial<NodeBridgeConfig> = {
  cameraFacing: 'back',
  maxImageWidth: 1920,
  imageQuality: 85,
  snapTimeoutMs: 15000,
  ttsTimeoutMs: 10000,
  debug: false,
};

// ─── Events ─────────────────────────────────────────────────────

export interface NodeBridgeEvents {
  /** Image captured from glasses camera */
  'image:captured': (image: CapturedImage) => void;
  /** Voice transcription received from glasses mic */
  'voice:input': (text: string, confidence: number) => void;
  /** Device connectivity changed */
  'device:status': (connected: boolean, deviceInfo?: DeviceInfo) => void;
  /** TTS delivered to glasses speaker */
  'tts:delivered': (text: string) => void;
  /** An error occurred */
  'error': (source: string, message: string) => void;
  /** Debug log */
  'log': (message: string) => void;
}

export interface DeviceInfo {
  nodeId: string;
  name?: string;
  platform?: string;
  batteryLevel?: number;
  isCharging?: boolean;
  lastSeen?: string;
}

// ─── Response Types ─────────────────────────────────────────────

interface CameraSnapResponse {
  ok: boolean;
  image?: string; // base64 encoded
  mimeType?: string;
  width?: number;
  height?: number;
  error?: string;
}

interface NodeStatusResponse {
  ok: boolean;
  nodes?: Array<{
    id: string;
    name?: string;
    platform?: string;
    lastSeen?: string;
    online?: boolean;
  }>;
}

interface LocationResponse {
  ok: boolean;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  altitude?: number;
}

// ─── Bridge Implementation ──────────────────────────────────────

export class NodeBridge extends EventEmitter<NodeBridgeEvents> {
  private config: Required<NodeBridgeConfig>;
  private connected = false;
  private lastDeviceInfo: DeviceInfo | null = null;
  private snapInProgress = false;

  constructor(config: NodeBridgeConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<NodeBridgeConfig>;
  }

  // ─── Camera Operations ──────────────────────────────────────

  /**
   * Capture a single image from the Ray-Ban camera.
   * This calls the OpenClaw node's camera_snap endpoint.
   */
  async captureImage(
    trigger: CaptureTrigger = 'auto',
    voiceAnnotation?: string
  ): Promise<CapturedImage | null> {
    if (this.snapInProgress) {
      this.log('Snap already in progress, skipping');
      return null;
    }

    this.snapInProgress = true;
    const startTime = Date.now();

    try {
      this.log(`Capturing image (trigger: ${trigger})...`);

      const response = await this.callGateway<CameraSnapResponse>(
        'camera_snap',
        {
          node: this.config.nodeId,
          facing: this.config.cameraFacing,
          maxWidth: this.config.maxImageWidth,
          quality: this.config.imageQuality,
        },
        this.config.snapTimeoutMs
      );

      if (!response.ok || !response.image) {
        this.emit('error', 'camera', response.error || 'Failed to capture image');
        return null;
      }

      // Get device location if available
      const location = await this.getDeviceLocation();

      const capturedImage: CapturedImage = {
        id: uuidv4(),
        buffer: Buffer.from(response.image, 'base64'),
        mimeType: (response.mimeType as CapturedImage['mimeType']) || 'image/jpeg',
        capturedAt: new Date().toISOString(),
        location: location || undefined,
        deviceId: this.config.nodeId,
        trigger,
        voiceAnnotation,
      };

      this.log(
        `Image captured: ${capturedImage.id} ` +
        `(${(capturedImage.buffer.length / 1024).toFixed(0)}KB, ${Date.now() - startTime}ms)`
      );
      this.emit('image:captured', capturedImage);

      return capturedImage;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.emit('error', 'camera', `Capture failed: ${msg}`);
      return null;
    } finally {
      this.snapInProgress = false;
    }
  }

  /**
   * Capture a burst of images (useful for product scanning — multiple angles).
   */
  async captureBurst(
    count: number,
    intervalMs = 500,
    trigger: CaptureTrigger = 'auto'
  ): Promise<CapturedImage[]> {
    const images: CapturedImage[] = [];

    for (let i = 0; i < count; i++) {
      const img = await this.captureImage(trigger);
      if (img) images.push(img);

      if (i < count - 1) {
        await this.sleep(intervalMs);
      }
    }

    this.log(`Burst complete: ${images.length}/${count} images captured`);
    return images;
  }

  // ─── Audio / TTS Operations ─────────────────────────────────

  /**
   * Send a TTS response to the glasses speaker.
   * Text is spoken through the glasses' built-in speakers.
   */
  async speak(text: string): Promise<boolean> {
    try {
      this.log(`TTS: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);

      const response = await this.callGateway<{ ok: boolean; error?: string }>(
        'notify',
        {
          node: this.config.nodeId,
          title: 'Vision AI',
          body: text,
          // When OpenClaw supports TTS routing to node speaker,
          // this would use a tts-specific endpoint. For now, we
          // use notify which shows + reads the notification.
        },
        this.config.ttsTimeoutMs
      );

      if (response.ok) {
        this.emit('tts:delivered', text);
        return true;
      }

      this.emit('error', 'tts', response.error || 'TTS delivery failed');
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.emit('error', 'tts', `TTS failed: ${msg}`);
      return false;
    }
  }

  // ─── Device Status ──────────────────────────────────────────

  /**
   * Check if the paired device/glasses are connected and reachable.
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await this.callGateway<NodeStatusResponse>(
        'status',
        { node: this.config.nodeId },
        5000
      );

      if (!response.ok) {
        this.setConnected(false);
        return false;
      }

      const node = response.nodes?.find((n) => n.id === this.config.nodeId);
      if (!node) {
        this.setConnected(false);
        return false;
      }

      this.lastDeviceInfo = {
        nodeId: node.id,
        name: node.name,
        platform: node.platform,
        lastSeen: node.lastSeen,
      };

      const isOnline = node.online !== false;
      this.setConnected(isOnline);
      return isOnline;
    } catch {
      this.setConnected(false);
      return false;
    }
  }

  /**
   * Get the device location (GPS from phone).
   */
  async getDeviceLocation(): Promise<GeoLocation | null> {
    try {
      const response = await this.callGateway<LocationResponse>(
        'location_get',
        { node: this.config.nodeId },
        5000
      );

      if (
        response.ok &&
        response.latitude !== undefined &&
        response.longitude !== undefined
      ) {
        return {
          latitude: response.latitude,
          longitude: response.longitude,
          accuracy: response.accuracy,
          altitude: response.altitude,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get the last known device info.
   */
  getDeviceInfo(): DeviceInfo | null {
    return this.lastDeviceInfo ? { ...this.lastDeviceInfo } : null;
  }

  /**
   * Check if currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ─── Periodic Health Check ──────────────────────────────────

  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start periodic device health checks.
   */
  startHealthCheck(intervalMs = 30000): void {
    this.stopHealthCheck();
    this.healthCheckInterval = setInterval(async () => {
      await this.checkConnection();
    }, intervalMs);
    this.log(`Health check started (every ${intervalMs / 1000}s)`);
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      this.log('Health check stopped');
    }
  }

  /**
   * Graceful shutdown — stop health checks, clean up.
   */
  shutdown(): void {
    this.stopHealthCheck();
    this.removeAllListeners();
    this.log('Node bridge shut down');
  }

  // ─── Private ──────────────────────────────────────────────

  /**
   * Make a request to the OpenClaw gateway's node API.
   */
  private async callGateway<T>(
    action: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `${this.config.gatewayUrl}/api/nodes/${action}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.gatewayToken}`,
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Gateway API error ${response.status}: ${body}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private setConnected(connected: boolean): void {
    if (this.connected !== connected) {
      this.connected = connected;
      this.emit('device:status', connected, this.lastDeviceInfo || undefined);
      this.log(`Device ${connected ? 'connected' : 'disconnected'}`);
    }
  }

  private log(message: string): void {
    if (this.config.debug) {
      this.emit('log', `[NodeBridge] ${message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
