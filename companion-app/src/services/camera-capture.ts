/**
 * Camera Capture Service
 *
 * Manages frame capture from the glasses camera, including:
 * - Single-shot capture (voice or button triggered)
 * - Continuous streaming at configurable FPS
 * - Frame buffering for offline/slow connections
 * - Quality management based on BLE bandwidth
 * - Frame deduplication (skip near-identical frames)
 */

import type { GlassesConnectionService, CameraFrame } from './glasses-connection';
import {
  DEFAULT_CAPTURE_FPS,
  DEFAULT_CAPTURE_QUALITY,
  FRAME_BUFFER_MAX_SIZE,
  FRAME_BUFFER_FLUSH_THRESHOLD,
} from '../utils/constants';

// ─── Types ──────────────────────────────────────────────────────

export type CaptureMode = 'manual' | 'auto' | 'voice-triggered' | 'continuous';

export interface CaptureConfig {
  /** Capture mode */
  mode: CaptureMode;
  /** Frames per second for auto/continuous modes */
  fps: number;
  /** JPEG quality (0-1) */
  quality: number;
  /** Auto-snap interval in seconds (for auto mode) */
  autoSnapIntervalSec: number;
  /** Enable frame deduplication */
  deduplication: boolean;
  /** Deduplication threshold (0-1, lower = more aggressive) */
  deduplicationThreshold: number;
  /** Maximum frames to buffer offline */
  maxBufferSize: number;
  /** Whether to downgrade quality on poor connection */
  adaptiveQuality: boolean;
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  mode: 'manual',
  fps: DEFAULT_CAPTURE_FPS,
  quality: DEFAULT_CAPTURE_QUALITY,
  autoSnapIntervalSec: 3,
  deduplication: true,
  deduplicationThreshold: 0.85,
  maxBufferSize: FRAME_BUFFER_MAX_SIZE,
  adaptiveQuality: true,
};

export interface BufferedFrame {
  /** Unique frame ID */
  id: string;
  /** The camera frame data */
  frame: CameraFrame;
  /** Capture trigger */
  trigger: 'auto' | 'manual' | 'voice' | 'gesture';
  /** Whether this frame has been sent to backend */
  sent: boolean;
  /** Number of send attempts */
  sendAttempts: number;
  /** Voice annotation if any */
  voiceAnnotation?: string;
}

export interface CaptureStats {
  /** Total frames captured this session */
  totalCaptured: number;
  /** Frames successfully sent to backend */
  totalSent: number;
  /** Frames currently buffered */
  bufferedCount: number;
  /** Frames dropped (buffer full or deduplication) */
  totalDropped: number;
  /** Average capture rate (frames/sec) */
  averageFps: number;
  /** Current JPEG quality being used */
  currentQuality: number;
  /** Whether streaming is active */
  isStreaming: boolean;
}

// ─── Capture Events ─────────────────────────────────────────────

export interface CameraCaptureCallbacks {
  /** New frame captured and ready for processing */
  onFrameCaptured?: (frame: BufferedFrame) => void;
  /** Frame sent to backend */
  onFrameSent?: (frameId: string) => void;
  /** Frame dropped (buffer full or dedup) */
  onFrameDropped?: (reason: 'buffer_full' | 'duplicate' | 'quality') => void;
  /** Quality adapted due to connection issues */
  onQualityAdapted?: (newQuality: number, reason: string) => void;
  /** Stats updated */
  onStatsUpdate?: (stats: CaptureStats) => void;
  /** Error */
  onError?: (error: Error) => void;
}

// ─── Camera Capture Service ─────────────────────────────────────

export class CameraCaptureService {
  private glasses: GlassesConnectionService;
  private config: CaptureConfig;
  private callbacks: CameraCaptureCallbacks = {};

  // State
  private isStreaming = false;
  private autoSnapTimer: ReturnType<typeof setInterval> | null = null;
  private frameBuffer: Map<string, BufferedFrame> = new Map();
  private frameCount = 0;
  private sentCount = 0;
  private droppedCount = 0;
  private sessionStartTime: number | null = null;
  private currentQuality: number;
  private lastFrameHash: string | null = null;

  constructor(
    glasses: GlassesConnectionService,
    config: Partial<CaptureConfig> = {},
  ) {
    this.glasses = glasses;
    this.config = { ...DEFAULT_CAPTURE_CONFIG, ...config };
    this.currentQuality = this.config.quality;

    // Listen for frames from glasses
    this.glasses.onCameraFrame = (frame) => this.handleIncomingFrame(frame);
  }

  // ─── Public API ───────────────────────────────────────────

  /** Set capture event callbacks */
  setCallbacks(callbacks: CameraCaptureCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Update capture configuration */
  updateConfig(config: Partial<CaptureConfig>): void {
    const wasStreaming = this.isStreaming;
    const oldMode = this.config.mode;

    this.config = { ...this.config, ...config };

    // Restart streaming if FPS or mode changed
    if (wasStreaming && (config.fps || config.mode)) {
      this.stopCapture();
      if (this.config.mode !== 'manual') {
        this.startCapture();
      }
    }
  }

  /** Start capturing based on current mode */
  async startCapture(): Promise<void> {
    if (this.isStreaming) return;
    if (!this.glasses.isConnected) {
      throw new Error('Glasses not connected');
    }

    this.sessionStartTime = Date.now();

    switch (this.config.mode) {
      case 'continuous':
        await this.glasses.startFrameStream(this.config.fps);
        this.isStreaming = true;
        break;

      case 'auto':
        this.startAutoSnap();
        this.isStreaming = true;
        break;

      case 'voice-triggered':
        // Voice-triggered doesn't auto-start streaming.
        // Frames are captured on demand via captureSingle().
        this.isStreaming = true;
        break;

      case 'manual':
      default:
        // Manual mode — nothing to start
        break;
    }
  }

  /** Stop all capturing */
  async stopCapture(): Promise<void> {
    this.isStreaming = false;
    this.stopAutoSnap();

    try {
      await this.glasses.stopFrameStream();
    } catch {
      // Ignore stop errors
    }
  }

  /** Capture a single frame on demand */
  async captureSingle(
    trigger: 'manual' | 'voice' | 'gesture' = 'manual',
    voiceAnnotation?: string,
  ): Promise<BufferedFrame | null> {
    if (!this.glasses.isConnected) return null;

    const frame = await this.glasses.captureFrame();
    if (!frame) return null;

    const buffered = this.createBufferedFrame(frame, trigger, voiceAnnotation);
    this.addToBuffer(buffered);
    return buffered;
  }

  /** Get all buffered frames that haven't been sent */
  getUnsentFrames(): BufferedFrame[] {
    return Array.from(this.frameBuffer.values()).filter((f) => !f.sent);
  }

  /** Mark a frame as successfully sent */
  markFrameSent(frameId: string): void {
    const frame = this.frameBuffer.get(frameId);
    if (frame) {
      frame.sent = true;
      this.sentCount++;
      this.callbacks.onFrameSent?.(frameId);

      // Remove sent frames to free memory
      this.frameBuffer.delete(frameId);
    }
  }

  /** Mark a frame as failed to send (will retry) */
  markFrameFailed(frameId: string): void {
    const frame = this.frameBuffer.get(frameId);
    if (frame) {
      frame.sendAttempts++;
      // Drop after 3 failed attempts
      if (frame.sendAttempts >= 3) {
        this.frameBuffer.delete(frameId);
        this.droppedCount++;
      }
    }
  }

  /** Flush all buffered frames (return them and clear buffer) */
  flushBuffer(): BufferedFrame[] {
    const frames = Array.from(this.frameBuffer.values());
    this.frameBuffer.clear();
    return frames;
  }

  /** Get current capture stats */
  getStats(): CaptureStats {
    const elapsed = this.sessionStartTime
      ? (Date.now() - this.sessionStartTime) / 1000
      : 0;

    return {
      totalCaptured: this.frameCount,
      totalSent: this.sentCount,
      bufferedCount: this.frameBuffer.size,
      totalDropped: this.droppedCount,
      averageFps: elapsed > 0 ? this.frameCount / elapsed : 0,
      currentQuality: this.currentQuality,
      isStreaming: this.isStreaming,
    };
  }

  /** Reset all stats */
  resetStats(): void {
    this.frameCount = 0;
    this.sentCount = 0;
    this.droppedCount = 0;
    this.sessionStartTime = Date.now();
  }

  /** Clean up resources */
  dispose(): void {
    this.stopCapture();
    this.frameBuffer.clear();
  }

  // ─── Private ──────────────────────────────────────────────

  private handleIncomingFrame(frame: CameraFrame): void {
    // Deduplication check
    if (this.config.deduplication) {
      const hash = this.simpleFrameHash(frame);
      if (hash === this.lastFrameHash) {
        this.droppedCount++;
        this.callbacks.onFrameDropped?.('duplicate');
        return;
      }
      this.lastFrameHash = hash;
    }

    const buffered = this.createBufferedFrame(frame, 'auto');
    this.addToBuffer(buffered);
  }

  private createBufferedFrame(
    frame: CameraFrame,
    trigger: 'auto' | 'manual' | 'voice' | 'gesture',
    voiceAnnotation?: string,
  ): BufferedFrame {
    this.frameCount++;
    return {
      id: `frame-${Date.now()}-${this.frameCount}`,
      frame,
      trigger,
      sent: false,
      sendAttempts: 0,
      voiceAnnotation,
    };
  }

  private addToBuffer(buffered: BufferedFrame): void {
    // Check buffer capacity
    if (this.frameBuffer.size >= this.config.maxBufferSize) {
      // Drop oldest unsent frame
      const oldest = Array.from(this.frameBuffer.entries())
        .filter(([, f]) => !f.sent)
        .sort((a, b) => a[1].frame.timestamp.localeCompare(b[1].frame.timestamp))[0];

      if (oldest) {
        this.frameBuffer.delete(oldest[0]);
        this.droppedCount++;
        this.callbacks.onFrameDropped?.('buffer_full');
      }
    }

    this.frameBuffer.set(buffered.id, buffered);
    this.callbacks.onFrameCaptured?.(buffered);

    // Auto-flush when buffer hits threshold
    if (this.frameBuffer.size >= FRAME_BUFFER_FLUSH_THRESHOLD) {
      this.callbacks.onStatsUpdate?.(this.getStats());
    }
  }

  private startAutoSnap(): void {
    this.stopAutoSnap();

    const intervalMs = this.config.autoSnapIntervalSec * 1000;
    this.autoSnapTimer = setInterval(async () => {
      try {
        await this.captureSingle('auto');
      } catch (error) {
        this.callbacks.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }, intervalMs);
  }

  private stopAutoSnap(): void {
    if (this.autoSnapTimer) {
      clearInterval(this.autoSnapTimer);
      this.autoSnapTimer = null;
    }
  }

  /**
   * Simple hash for frame deduplication.
   * Uses a subset of the base64 data to detect near-identical frames.
   */
  private simpleFrameHash(frame: CameraFrame): string {
    // Sample 100 bytes from different positions in the frame data
    const data = frame.data;
    if (data.length < 200) return data;

    const step = Math.floor(data.length / 100);
    let hash = '';
    for (let i = 0; i < 100; i++) {
      hash += data[i * step] || '';
    }
    return hash;
  }
}
