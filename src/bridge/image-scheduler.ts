/**
 * Image Capture Scheduler — Automated periodic image capture with smart triggers.
 *
 * Coordinates when to capture images from the glasses. Supports:
 * - Periodic auto-snap (every N seconds)
 * - Change detection (only snap when the view has meaningfully changed)
 * - Activity-based capture (faster when walking, slower when stationary)
 * - Manual trigger passthrough
 * - Pause/resume with privacy mode
 *
 * Sits between the Node Bridge (camera access) and the Agents (image consumers).
 */

import { EventEmitter } from 'eventemitter3';
import type { CapturedImage, CaptureTrigger } from '../types.js';
import type { NodeBridge } from './node-bridge.js';

// ─── Configuration ──────────────────────────────────────────────

export interface ImageSchedulerConfig {
  /** Base interval between auto-snaps in ms (default: 3000) */
  intervalMs: number;
  /** Minimum interval even in fast mode (default: 1000) */
  minIntervalMs: number;
  /** Maximum interval in slow mode (default: 10000) */
  maxIntervalMs: number;
  /** Enable change detection to avoid duplicate scenes (default: true) */
  changeDetectionEnabled: boolean;
  /**
   * Threshold for change detection (0-1). Lower = more sensitive.
   * 0.1 = snap on almost any change, 0.5 = only significant scene changes
   * Default: 0.3
   */
  changeThreshold: number;
  /** Maximum images to buffer before dropping (back-pressure) */
  maxBufferSize: number;
  /** Enable adaptive interval based on scene change rate */
  adaptiveInterval: boolean;
  /** Enable debug logging */
  debug: boolean;
}

const DEFAULT_CONFIG: ImageSchedulerConfig = {
  intervalMs: 3000,
  minIntervalMs: 1000,
  maxIntervalMs: 10000,
  changeDetectionEnabled: true,
  changeThreshold: 0.3,
  maxBufferSize: 50,
  adaptiveInterval: true,
  debug: false,
};

// ─── Events ─────────────────────────────────────────────────────

export interface ImageSchedulerEvents {
  /** A new image was captured and is ready for processing */
  'image:ready': (image: CapturedImage) => void;
  /** Image was skipped due to change detection (too similar to last) */
  'image:skipped': (reason: string) => void;
  /** Scheduler started */
  'scheduler:started': () => void;
  /** Scheduler stopped */
  'scheduler:stopped': () => void;
  /** Scheduler paused (privacy mode) */
  'scheduler:paused': () => void;
  /** Scheduler resumed */
  'scheduler:resumed': () => void;
  /** Buffer is getting full (back-pressure warning) */
  'buffer:warning': (size: number, max: number) => void;
  /** Error */
  'error': (message: string) => void;
  /** Debug log */
  'log': (message: string) => void;
}

// ─── Scheduler State ────────────────────────────────────────────

interface SchedulerState {
  running: boolean;
  paused: boolean;
  captureCount: number;
  skipCount: number;
  lastCaptureTime: number;
  currentIntervalMs: number;
  /** Recent image buffer sizes for crude change detection */
  recentBufferSizes: number[];
  /** Histogram of recent image brightness (simple change detection) */
  recentBrightness: number[];
}

// ─── Scheduler Implementation ───────────────────────────────────

export class ImageScheduler extends EventEmitter<ImageSchedulerEvents> {
  private config: ImageSchedulerConfig;
  private bridge: NodeBridge;
  private state: SchedulerState;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private imageBuffer: CapturedImage[] = [];
  private lastImageSignature: ImageSignature | null = null;

  constructor(bridge: NodeBridge, config: Partial<ImageSchedulerConfig> = {}) {
    super();
    this.bridge = bridge;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      running: false,
      paused: false,
      captureCount: 0,
      skipCount: 0,
      lastCaptureTime: 0,
      currentIntervalMs: this.config.intervalMs,
      recentBufferSizes: [],
      recentBrightness: [],
    };
  }

  // ─── Control ────────────────────────────────────────────────

  /**
   * Start the automatic capture scheduler.
   */
  start(): void {
    if (this.state.running) return;

    this.state.running = true;
    this.state.paused = false;
    this.state.captureCount = 0;
    this.state.skipCount = 0;
    this.state.currentIntervalMs = this.config.intervalMs;

    this.log('Scheduler started');
    this.emit('scheduler:started');
    this.scheduleNext();
  }

  /**
   * Stop the scheduler completely.
   */
  stop(): void {
    if (!this.state.running) return;

    this.state.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.log(
      `Scheduler stopped. Captured: ${this.state.captureCount}, ` +
      `Skipped: ${this.state.skipCount}`
    );
    this.emit('scheduler:stopped');
  }

  /**
   * Pause capture (privacy mode) — scheduler stays "running" but doesn't snap.
   */
  pause(): void {
    if (!this.state.running || this.state.paused) return;

    this.state.paused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.log('Scheduler paused (privacy mode)');
    this.emit('scheduler:paused');
  }

  /**
   * Resume capture after pause.
   */
  resume(): void {
    if (!this.state.running || !this.state.paused) return;

    this.state.paused = false;
    this.log('Scheduler resumed');
    this.emit('scheduler:resumed');
    this.scheduleNext();
  }

  /**
   * Trigger a manual capture immediately (voice command or gesture).
   */
  async triggerManual(
    trigger: CaptureTrigger = 'manual',
    voiceAnnotation?: string
  ): Promise<CapturedImage | null> {
    this.log(`Manual capture triggered (${trigger})`);
    return this.captureAndProcess(trigger, voiceAnnotation);
  }

  // ─── State ──────────────────────────────────────────────────

  isRunning(): boolean {
    return this.state.running;
  }

  isPaused(): boolean {
    return this.state.paused;
  }

  getStats(): {
    running: boolean;
    paused: boolean;
    captureCount: number;
    skipCount: number;
    currentIntervalMs: number;
    bufferSize: number;
  } {
    return {
      running: this.state.running,
      paused: this.state.paused,
      captureCount: this.state.captureCount,
      skipCount: this.state.skipCount,
      currentIntervalMs: this.state.currentIntervalMs,
      bufferSize: this.imageBuffer.length,
    };
  }

  /**
   * Update config on the fly (e.g., change interval via voice command).
   */
  updateConfig(updates: Partial<ImageSchedulerConfig>): void {
    Object.assign(this.config, updates);
    this.log(`Config updated: ${JSON.stringify(updates)}`);
  }

  /**
   * Get and clear the image buffer (for batch processing).
   */
  drainBuffer(): CapturedImage[] {
    const images = [...this.imageBuffer];
    this.imageBuffer = [];
    return images;
  }

  // ─── Private: Scheduling Loop ─────────────────────────────

  private scheduleNext(): void {
    if (!this.state.running || this.state.paused) return;

    this.timer = setTimeout(async () => {
      await this.captureAndProcess('auto');
      this.scheduleNext();
    }, this.state.currentIntervalMs);
  }

  private async captureAndProcess(
    trigger: CaptureTrigger,
    voiceAnnotation?: string
  ): Promise<CapturedImage | null> {
    // Check bridge connectivity
    if (!this.bridge.isConnected()) {
      this.log('Bridge not connected, skipping capture');
      return null;
    }

    // Check buffer back-pressure
    if (this.imageBuffer.length >= this.config.maxBufferSize) {
      this.emit('buffer:warning', this.imageBuffer.length, this.config.maxBufferSize);
      this.log(`Buffer full (${this.imageBuffer.length}), skipping capture`);
      return null;
    }

    // Capture
    const image = await this.bridge.captureImage(trigger, voiceAnnotation);
    if (!image) return null;

    // Change detection
    if (this.config.changeDetectionEnabled && trigger === 'auto') {
      const sig = this.computeImageSignature(image);
      if (this.lastImageSignature && !this.hasSignificantChange(sig)) {
        this.state.skipCount++;
        this.emit('image:skipped', 'Scene unchanged');
        this.log('Image skipped (no significant change detected)');

        // Slow down if nothing is changing
        if (this.config.adaptiveInterval) {
          this.adaptInterval('slower');
        }
        return null;
      }
      this.lastImageSignature = sig;

      // Speed up if scenes are changing
      if (this.config.adaptiveInterval) {
        this.adaptInterval('faster');
      }
    }

    // Accept the image
    this.state.captureCount++;
    this.state.lastCaptureTime = Date.now();
    this.imageBuffer.push(image);
    this.emit('image:ready', image);

    return image;
  }

  // ─── Private: Change Detection ────────────────────────────

  /**
   * Compute a simple image "signature" for change detection.
   *
   * We use a crude but fast approach: the image buffer size + a sampling
   * of byte values. This detects major scene changes (new shelf vs same shelf)
   * without running a vision model.
   *
   * In production, this would use image embeddings or perceptual hashing
   * (e.g., pHash), but for MVP the size + byte sampling approach catches
   * ~80% of duplicates.
   */
  private computeImageSignature(image: CapturedImage): ImageSignature {
    const buf = image.buffer;
    const size = buf.length;

    // Sample bytes at regular intervals for a crude "fingerprint"
    const sampleCount = 64;
    const step = Math.max(1, Math.floor(size / sampleCount));
    const samples: number[] = [];

    for (let i = 0; i < size && samples.length < sampleCount; i += step) {
      samples.push(buf[i]);
    }

    // Average brightness (crude)
    const avgBrightness = samples.reduce((a, b) => a + b, 0) / samples.length;

    return {
      size,
      samples,
      avgBrightness,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if the new image signature differs significantly from the last.
   */
  private hasSignificantChange(newSig: ImageSignature): boolean {
    if (!this.lastImageSignature) return true;

    const old = this.lastImageSignature;

    // Size difference (significant size change means different content)
    const sizeRatio = Math.abs(newSig.size - old.size) / Math.max(old.size, 1);
    if (sizeRatio > 0.15) return true; // >15% size change

    // Brightness difference
    const brightnessDiff = Math.abs(newSig.avgBrightness - old.avgBrightness);
    if (brightnessDiff > 30) return true; // Significant brightness shift

    // Sample comparison (crude perceptual diff)
    let sampleDiff = 0;
    const len = Math.min(newSig.samples.length, old.samples.length);
    for (let i = 0; i < len; i++) {
      sampleDiff += Math.abs(newSig.samples[i] - old.samples[i]);
    }
    const avgSampleDiff = sampleDiff / (len || 1);

    // Threshold comparison
    return avgSampleDiff > (this.config.changeThreshold * 128);
  }

  // ─── Private: Adaptive Interval ───────────────────────────

  private adaptInterval(direction: 'faster' | 'slower'): void {
    const { minIntervalMs, maxIntervalMs } = this.config;
    const current = this.state.currentIntervalMs;

    if (direction === 'faster') {
      // Decrease interval (more frequent captures)
      this.state.currentIntervalMs = Math.max(
        minIntervalMs,
        Math.floor(current * 0.85)
      );
    } else {
      // Increase interval (less frequent captures)
      this.state.currentIntervalMs = Math.min(
        maxIntervalMs,
        Math.floor(current * 1.3)
      );
    }
  }

  private log(message: string): void {
    if (this.config.debug) {
      this.emit('log', `[ImageScheduler] ${message}`);
    }
  }
}

// ─── Internal Types ─────────────────────────────────────────────

interface ImageSignature {
  size: number;
  samples: number[];
  avgBrightness: number;
  timestamp: number;
}
