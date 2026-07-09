/**
 * Real-Time Streaming Pipeline
 * 
 * WebSocket-based continuous frame processing for live glasses feed.
 * Handles frame ingestion, deduplication, priority routing, back-pressure,
 * adaptive quality, and real-time result delivery.
 * 
 * The glasses capture 1-30 FPS. We need to:
 * 1. Accept frames via WebSocket or HTTP chunked
 * 2. Deduplicate near-identical frames (change detection)
 * 3. Route "interesting" frames to vision pipeline
 * 4. Deliver results to TTS + dashboard in real-time
 * 5. Handle back-pressure when processing can't keep up
 * 
 * @module streaming/streaming-pipeline
 */

import { EventEmitter } from 'events';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StreamFrame {
  id: string;
  timestamp: number;
  data: Buffer | Uint8Array;
  width?: number;
  height?: number;
  format?: 'jpeg' | 'png' | 'webp' | 'raw';
  metadata?: Record<string, unknown>;
  source?: 'glasses' | 'companion' | 'webcam' | 'upload';
  gps?: { lat: number; lng: number; accuracy?: number };
}

export interface FrameAnalysis {
  frameId: string;
  timestamp: number;
  processingTimeMs: number;
  changeScore: number;
  interestScore: number;
  sceneType?: string;
  dropped: boolean;
  dropReason?: DropReason;
  routedTo?: string[];
  results?: Record<string, unknown>;
}

export type DropReason =
  | 'duplicate'
  | 'back_pressure'
  | 'quality_too_low'
  | 'rate_limited'
  | 'pipeline_paused'
  | 'buffer_full';

export type StreamState = 'idle' | 'streaming' | 'paused' | 'draining' | 'error';

export interface StreamSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  state: StreamState;
  framesReceived: number;
  framesProcessed: number;
  framesDropped: number;
  avgProcessingMs: number;
  avgChangeScore: number;
  peakFps: number;
  currentFps: number;
  bufferUtilization: number;
  adaptiveQuality: QualityLevel;
  dropReasons: Record<DropReason, number>;
}

export type QualityLevel = 'ultra' | 'high' | 'medium' | 'low' | 'minimal';

export interface StreamingPipelineConfig {
  /** Max frames buffered before dropping (default: 30) */
  maxBufferSize: number;
  /** Min change score to process a frame (0-1, default: 0.15) */
  changeThreshold: number;
  /** Min interest score to route to agents (0-1, default: 0.3) */
  interestThreshold: number;
  /** Max concurrent processing tasks (default: 3) */
  maxConcurrent: number;
  /** Target FPS for processing (default: 2) */
  targetProcessingFps: number;
  /** Back-pressure threshold (buffer % before dropping, default: 0.8) */
  backPressureThreshold: number;
  /** Enable adaptive quality (default: true) */
  adaptiveQuality: boolean;
  /** Quality level adjustment interval in ms (default: 5000) */
  qualityAdjustInterval: number;
  /** Frame signature size for dedup (default: 64) */
  signatureSize: number;
  /** History size for change detection (default: 10) */
  historySize: number;
  /** Max frame age before discard in ms (default: 10000) */
  maxFrameAge: number;
  /** Enable scene change burst mode — process extra frames when scene changes (default: true) */
  sceneChangeBurst: boolean;
  /** Burst processing count on scene change (default: 3) */
  burstFrameCount: number;
  /** Vision handler for processing frames */
  processFrame?: (frame: StreamFrame, quality: QualityLevel) => Promise<FrameProcessResult>;
  /** Route handler for dispatching results to agents */
  routeResult?: (result: FrameProcessResult) => Promise<string[]>;
}

export interface FrameProcessResult {
  frameId: string;
  sceneType?: string;
  objects?: Array<{ name: string; confidence: number }>;
  text?: string[];
  products?: Array<{ name: string; barcode?: string }>;
  interestScore: number;
  metadata?: Record<string, unknown>;
}

export interface StreamingPipelineEvents {
  'frame:received': (frame: StreamFrame) => void;
  'frame:processed': (analysis: FrameAnalysis) => void;
  'frame:dropped': (frameId: string, reason: DropReason) => void;
  'frame:routed': (frameId: string, agents: string[]) => void;
  'scene:changed': (oldScene: string | undefined, newScene: string) => void;
  'quality:adjusted': (oldLevel: QualityLevel, newLevel: QualityLevel, reason: string) => void;
  'backpressure:start': (bufferUtilization: number) => void;
  'backpressure:end': (bufferUtilization: number) => void;
  'session:started': (sessionId: string) => void;
  'session:ended': (session: StreamSession) => void;
  'error': (error: Error) => void;
}

// ─── Default Config ──────────────────────────────────────────────────────────

export const DEFAULT_STREAMING_CONFIG: StreamingPipelineConfig = {
  maxBufferSize: 30,
  changeThreshold: 0.15,
  interestThreshold: 0.3,
  maxConcurrent: 3,
  targetProcessingFps: 2,
  backPressureThreshold: 0.8,
  adaptiveQuality: true,
  qualityAdjustInterval: 5000,
  signatureSize: 64,
  historySize: 10,
  maxFrameAge: 10000,
  sceneChangeBurst: true,
  burstFrameCount: 3,
};

// ─── Quality Presets ─────────────────────────────────────────────────────────

export const QUALITY_PRESETS: Record<QualityLevel, {
  maxWidth: number;
  jpegQuality: number;
  skipFrameRatio: number;
  enableOcr: boolean;
  enableProductId: boolean;
  enableBarcode: boolean;
  description: string;
}> = {
  ultra: {
    maxWidth: 4032,
    jpegQuality: 95,
    skipFrameRatio: 0,
    enableOcr: true,
    enableProductId: true,
    enableBarcode: true,
    description: 'Full resolution, all features. Use when connected to power.',
  },
  high: {
    maxWidth: 2048,
    jpegQuality: 85,
    skipFrameRatio: 0,
    enableOcr: true,
    enableProductId: true,
    enableBarcode: true,
    description: 'Balanced quality for most use cases.',
  },
  medium: {
    maxWidth: 1280,
    jpegQuality: 75,
    skipFrameRatio: 0.25,
    enableOcr: true,
    enableProductId: true,
    enableBarcode: true,
    description: 'Reduced resolution, maintains features.',
  },
  low: {
    maxWidth: 800,
    jpegQuality: 60,
    skipFrameRatio: 0.5,
    enableOcr: true,
    enableProductId: false,
    enableBarcode: true,
    description: 'Low bandwidth mode. Barcode + OCR only.',
  },
  minimal: {
    maxWidth: 480,
    jpegQuality: 40,
    skipFrameRatio: 0.75,
    enableOcr: false,
    enableProductId: false,
    enableBarcode: true,
    description: 'Emergency low-power mode. Barcode scanning only.',
  },
};

// ─── Frame Signature ─────────────────────────────────────────────────────────

/**
 * Computes a lightweight signature for change detection.
 * Samples bytes at fixed intervals and computes a hash-like fingerprint.
 */
export function computeFrameSignature(data: Buffer | Uint8Array, size: number): number[] {
  const sig: number[] = [];
  const buf = data instanceof Buffer ? data : Buffer.from(data);
  if (buf.length === 0) return sig;

  const step = Math.max(1, Math.floor(buf.length / size));
  for (let i = 0; i < size && i * step < buf.length; i++) {
    sig.push(buf[i * step]);
  }
  return sig;
}

/**
 * Computes change score between two signatures (0 = identical, 1 = completely different).
 */
export function computeChangeScore(sig1: number[], sig2: number[]): number {
  if (sig1.length === 0 || sig2.length === 0) return 1;
  const len = Math.min(sig1.length, sig2.length);
  let diff = 0;
  for (let i = 0; i < len; i++) {
    diff += Math.abs(sig1[i] - sig2[i]);
  }
  return diff / (len * 255);
}

/**
 * Estimates frame interest score based on data characteristics.
 * Higher entropy / complexity = more interesting.
 */
export function estimateInterestScore(data: Buffer | Uint8Array): number {
  const buf = data instanceof Buffer ? data : Buffer.from(data);
  if (buf.length === 0) return 0;

  // Sample 256 bytes for entropy estimation
  const sampleSize = Math.min(256, buf.length);
  const step = Math.max(1, Math.floor(buf.length / sampleSize));
  const histogram = new Uint32Array(256);
  let sampleCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    const idx = i * step;
    if (idx < buf.length) {
      histogram[buf[idx]]++;
      sampleCount++;
    }
  }

  if (sampleCount === 0) return 0;

  // Shannon entropy
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (histogram[i] > 0) {
      const p = histogram[i] / sampleCount;
      entropy -= p * Math.log2(p);
    }
  }

  // Normalize to 0-1 (max entropy for 256 symbols is 8 bits)
  return Math.min(1, entropy / 8);
}

// ─── Streaming Pipeline ──────────────────────────────────────────────────────

export class StreamingPipeline extends EventEmitter {
  private config: StreamingPipelineConfig;
  private state: StreamState = 'idle';
  private session: StreamSession | null = null;
  private buffer: StreamFrame[] = [];
  private processing = 0;
  private signatureHistory: number[][] = [];
  private lastScene: string | undefined;
  private fpsTracker: number[] = [];
  private qualityLevel: QualityLevel = 'high';
  private lastQualityAdjust = 0;
  private inBackPressure = false;
  private burstRemaining = 0;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private processTimer: ReturnType<typeof setInterval> | null = null;
  private totalProcessingMs = 0;
  private sessionCounter = 0;

  constructor(config: Partial<StreamingPipelineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_STREAMING_CONFIG, ...config };
  }

  // ─── Session Management ──────────────────────────────────────────────────

  startSession(): string {
    if (this.state === 'streaming') {
      this.endSession();
    }

    this.sessionCounter++;
    const sessionId = `stream-${Date.now()}-${this.sessionCounter}`;
    this.session = {
      id: sessionId,
      startedAt: Date.now(),
      state: 'streaming',
      framesReceived: 0,
      framesProcessed: 0,
      framesDropped: 0,
      avgProcessingMs: 0,
      avgChangeScore: 0,
      peakFps: 0,
      currentFps: 0,
      bufferUtilization: 0,
      adaptiveQuality: this.qualityLevel,
      dropReasons: {
        duplicate: 0,
        back_pressure: 0,
        quality_too_low: 0,
        rate_limited: 0,
        pipeline_paused: 0,
        buffer_full: 0,
      },
    };
    this.state = 'streaming';
    this.buffer = [];
    this.processing = 0;
    this.signatureHistory = [];
    this.lastScene = undefined;
    this.fpsTracker = [];
    this.totalProcessingMs = 0;
    this.inBackPressure = false;
    this.burstRemaining = 0;

    // Start the processing loop
    const intervalMs = Math.max(50, Math.floor(1000 / this.config.targetProcessingFps));
    this.processTimer = setInterval(() => this.processNextFrame(), intervalMs);

    this.emit('session:started', sessionId);
    return sessionId;
  }

  endSession(): StreamSession | null {
    if (!this.session) return null;

    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }

    this.session.endedAt = Date.now();
    this.session.state = 'idle';
    this.state = 'idle';

    const result = { ...this.session };
    this.emit('session:ended', result);
    this.session = null;
    this.buffer = [];
    return result;
  }

  pause(): void {
    if (this.state !== 'streaming') return;
    this.state = 'paused';
    if (this.session) this.session.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'streaming';
    if (this.session) this.session.state = 'streaming';
  }

  getState(): StreamState {
    return this.state;
  }

  getSession(): StreamSession | null {
    return this.session ? { ...this.session } : null;
  }

  getQualityLevel(): QualityLevel {
    return this.qualityLevel;
  }

  setQualityLevel(level: QualityLevel): void {
    const old = this.qualityLevel;
    if (old === level) return;
    this.qualityLevel = level;
    if (this.session) this.session.adaptiveQuality = level;
    this.emit('quality:adjusted', old, level, 'manual');
  }

  getBufferSize(): number {
    return this.buffer.length;
  }

  getBufferUtilization(): number {
    return this.buffer.length / this.config.maxBufferSize;
  }

  // ─── Frame Ingestion ─────────────────────────────────────────────────────

  ingestFrame(frame: StreamFrame): FrameAnalysis {
    const startTime = Date.now();

    if (!this.session) {
      return this.createDroppedAnalysis(frame, 'pipeline_paused', 0);
    }

    this.session.framesReceived++;
    this.trackFps();
    this.emit('frame:received', frame);

    // Check pipeline state
    if (this.state === 'paused') {
      return this.dropFrame(frame, 'pipeline_paused');
    }

    // Check frame age
    if (Date.now() - frame.timestamp > this.config.maxFrameAge) {
      return this.dropFrame(frame, 'rate_limited');
    }

    // Check buffer capacity
    if (this.buffer.length >= this.config.maxBufferSize) {
      return this.dropFrame(frame, 'buffer_full');
    }

    // Back-pressure detection
    const utilization = this.getBufferUtilization();
    if (this.session) this.session.bufferUtilization = utilization;

    if (utilization >= this.config.backPressureThreshold) {
      if (!this.inBackPressure) {
        this.inBackPressure = true;
        this.emit('backpressure:start', utilization);
      }
      return this.dropFrame(frame, 'back_pressure');
    } else if (this.inBackPressure && utilization < this.config.backPressureThreshold * 0.6) {
      this.inBackPressure = false;
      this.emit('backpressure:end', utilization);
    }

    // Compute signature and change score
    const signature = computeFrameSignature(
      frame.data,
      this.config.signatureSize,
    );
    const changeScore = this.signatureHistory.length > 0
      ? computeChangeScore(signature, this.signatureHistory[this.signatureHistory.length - 1])
      : 1;

    // Update session avg
    if (this.session) {
      const total = this.session.framesReceived;
      this.session.avgChangeScore =
        (this.session.avgChangeScore * (total - 1) + changeScore) / total;
    }

    // Dedup: skip near-identical frames (unless in burst mode)
    if (changeScore < this.config.changeThreshold && this.burstRemaining <= 0) {
      return this.dropFrame(frame, 'duplicate');
    }

    // Adaptive quality skip
    const preset = QUALITY_PRESETS[this.qualityLevel];
    if (preset.skipFrameRatio > 0 && Math.random() < preset.skipFrameRatio && this.burstRemaining <= 0) {
      return this.dropFrame(frame, 'quality_too_low');
    }

    // Scene change detection
    if (changeScore > 0.5 && this.config.sceneChangeBurst) {
      this.burstRemaining = this.config.burstFrameCount;
    }
    if (this.burstRemaining > 0) {
      this.burstRemaining--;
    }

    // Store signature
    this.signatureHistory.push(signature);
    if (this.signatureHistory.length > this.config.historySize) {
      this.signatureHistory.shift();
    }

    // Add to buffer
    this.buffer.push(frame);

    const processingMs = Date.now() - startTime;

    return {
      frameId: frame.id,
      timestamp: frame.timestamp,
      processingTimeMs: processingMs,
      changeScore,
      interestScore: estimateInterestScore(frame.data),
      dropped: false,
    };
  }

  // ─── Processing Loop ─────────────────────────────────────────────────────

  private async processNextFrame(): Promise<void> {
    if (this.state !== 'streaming' || this.buffer.length === 0) return;
    if (this.processing >= this.config.maxConcurrent) return;

    const frame = this.buffer.shift();
    if (!frame) return;

    this.processing++;
    const startTime = Date.now();

    try {
      let result: FrameProcessResult | undefined;
      let routedTo: string[] = [];

      // Process through vision pipeline
      if (this.config.processFrame) {
        result = await this.config.processFrame(frame, this.qualityLevel);

        // Scene change detection from result
        if (result.sceneType && result.sceneType !== this.lastScene) {
          const oldScene = this.lastScene;
          this.lastScene = result.sceneType;
          this.emit('scene:changed', oldScene, result.sceneType);
        }

        // Route to agents if interesting enough
        if (result.interestScore >= this.config.interestThreshold && this.config.routeResult) {
          routedTo = await this.config.routeResult(result);
          if (routedTo.length > 0) {
            this.emit('frame:routed', frame.id, routedTo);
          }
        }
      }

      const processingMs = Date.now() - startTime;
      this.totalProcessingMs += processingMs;

      if (this.session) {
        this.session.framesProcessed++;
        this.session.avgProcessingMs =
          this.totalProcessingMs / this.session.framesProcessed;
      }

      const analysis: FrameAnalysis = {
        frameId: frame.id,
        timestamp: frame.timestamp,
        processingTimeMs: processingMs,
        changeScore: 0,
        interestScore: result?.interestScore ?? 0,
        sceneType: result?.sceneType,
        dropped: false,
        routedTo: routedTo.length > 0 ? routedTo : undefined,
        results: result as unknown as Record<string, unknown>,
      };

      this.emit('frame:processed', analysis);

      // Adaptive quality adjustment
      if (this.config.adaptiveQuality) {
        this.adjustQuality(processingMs);
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.processing--;
    }
  }

  // ─── Adaptive Quality ────────────────────────────────────────────────────

  private adjustQuality(lastProcessingMs: number): void {
    const now = Date.now();
    if (now - this.lastQualityAdjust < this.config.qualityAdjustInterval) return;
    this.lastQualityAdjust = now;

    const levels: QualityLevel[] = ['ultra', 'high', 'medium', 'low', 'minimal'];
    const currentIdx = levels.indexOf(this.qualityLevel);
    const utilization = this.getBufferUtilization();
    const targetMs = 1000 / this.config.targetProcessingFps;

    let newIdx = currentIdx;
    let reason = '';

    // If processing is too slow or buffer is filling up, reduce quality
    if (lastProcessingMs > targetMs * 2 || utilization > 0.7) {
      newIdx = Math.min(currentIdx + 1, levels.length - 1);
      reason = lastProcessingMs > targetMs * 2
        ? `processing too slow (${lastProcessingMs}ms > ${targetMs * 2}ms)`
        : `buffer filling up (${Math.round(utilization * 100)}%)`;
    }
    // If processing is fast and buffer is nearly empty, increase quality
    else if (lastProcessingMs < targetMs * 0.5 && utilization < 0.2 && currentIdx > 0) {
      newIdx = currentIdx - 1;
      reason = `headroom available (${lastProcessingMs}ms, buffer ${Math.round(utilization * 100)}%)`;
    }

    if (newIdx !== currentIdx) {
      const oldLevel = this.qualityLevel;
      this.qualityLevel = levels[newIdx];
      if (this.session) this.session.adaptiveQuality = this.qualityLevel;
      this.emit('quality:adjusted', oldLevel, this.qualityLevel, reason);
    }
  }

  // ─── FPS Tracking ────────────────────────────────────────────────────────

  private trackFps(): void {
    const now = Date.now();
    this.fpsTracker.push(now);

    // Keep last 2 seconds
    const cutoff = now - 2000;
    while (this.fpsTracker.length > 0 && this.fpsTracker[0] < cutoff) {
      this.fpsTracker.shift();
    }

    const currentFps = this.fpsTracker.length / 2;
    if (this.session) {
      this.session.currentFps = currentFps;
      if (currentFps > this.session.peakFps) {
        this.session.peakFps = currentFps;
      }
    }
  }

  // ─── Drop Helpers ────────────────────────────────────────────────────────

  private dropFrame(frame: StreamFrame, reason: DropReason): FrameAnalysis {
    if (this.session) {
      this.session.framesDropped++;
      this.session.dropReasons[reason]++;
    }
    this.emit('frame:dropped', frame.id, reason);
    return this.createDroppedAnalysis(frame, reason, 0);
  }

  private createDroppedAnalysis(frame: StreamFrame, reason: DropReason, changeScore: number): FrameAnalysis {
    return {
      frameId: frame.id,
      timestamp: frame.timestamp,
      processingTimeMs: 0,
      changeScore,
      interestScore: 0,
      dropped: true,
      dropReason: reason,
    };
  }

  // ─── Voice Summary ───────────────────────────────────────────────────────

  getVoiceSummary(): string {
    if (!this.session) return 'No active streaming session.';

    const s = this.session;
    const dropRate = s.framesReceived > 0
      ? Math.round((s.framesDropped / s.framesReceived) * 100)
      : 0;
    const duration = Math.round((Date.now() - s.startedAt) / 1000);

    const parts: string[] = [];
    parts.push(`Streaming for ${duration} seconds.`);
    parts.push(`Processed ${s.framesProcessed} of ${s.framesReceived} frames.`);

    if (dropRate > 50) {
      parts.push(`Warning: ${dropRate}% frame drop rate.`);
    }

    parts.push(`Quality: ${this.qualityLevel}. Running at ${s.currentFps.toFixed(1)} FPS.`);

    if (this.inBackPressure) {
      parts.push('Under back-pressure — consider reducing capture rate.');
    }

    return parts.join(' ');
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  getStats(): {
    state: StreamState;
    session: StreamSession | null;
    quality: QualityLevel;
    qualityPreset: typeof QUALITY_PRESETS[QualityLevel];
    bufferSize: number;
    bufferUtilization: number;
    inBackPressure: boolean;
    processing: number;
  } {
    return {
      state: this.state,
      session: this.session ? { ...this.session } : null,
      quality: this.qualityLevel,
      qualityPreset: QUALITY_PRESETS[this.qualityLevel],
      bufferSize: this.buffer.length,
      bufferUtilization: this.getBufferUtilization(),
      inBackPressure: this.inBackPressure,
      processing: this.processing,
    };
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    this.endSession();
    this.removeAllListeners();
  }
}
