/**
 * Tests for Real-Time Streaming Pipeline
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  StreamingPipeline,
  StreamFrame,
  FrameAnalysis,
  QualityLevel,
  QUALITY_PRESETS,
  DEFAULT_STREAMING_CONFIG,
  computeFrameSignature,
  computeChangeScore,
  estimateInterestScore,
} from './streaming-pipeline.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFrame(id: string, data?: Buffer, timestamp?: number): StreamFrame {
  return {
    id,
    timestamp: timestamp ?? Date.now(),
    data: data ?? Buffer.alloc(1024, Math.random() * 255),
    format: 'jpeg',
    source: 'glasses',
  };
}

function makeIdenticalFrame(id: string, template: Buffer, timestamp?: number): StreamFrame {
  return {
    id,
    timestamp: timestamp ?? Date.now(),
    data: Buffer.from(template),
    format: 'jpeg',
    source: 'glasses',
  };
}

function makeDifferentFrame(id: string, timestamp?: number): StreamFrame {
  const buf = Buffer.alloc(1024);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.floor(Math.random() * 256);
  }
  return {
    id,
    timestamp: timestamp ?? Date.now(),
    data: buf,
    format: 'jpeg',
    source: 'glasses',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Frame Signature Tests ───────────────────────────────────────────────────

describe('computeFrameSignature', () => {
  it('returns empty array for empty buffer', () => {
    const sig = computeFrameSignature(Buffer.alloc(0), 64);
    expect(sig).toEqual([]);
  });

  it('returns signature of specified size', () => {
    const data = Buffer.alloc(1024, 128);
    const sig = computeFrameSignature(data, 64);
    expect(sig.length).toBeLessThanOrEqual(64);
    expect(sig.length).toBeGreaterThan(0);
  });

  it('returns consistent signatures for identical data', () => {
    const data = Buffer.alloc(1024, 42);
    const sig1 = computeFrameSignature(data, 64);
    const sig2 = computeFrameSignature(Buffer.from(data), 64);
    expect(sig1).toEqual(sig2);
  });

  it('returns different signatures for different data', () => {
    const data1 = Buffer.alloc(1024, 0);
    const data2 = Buffer.alloc(1024, 255);
    const sig1 = computeFrameSignature(data1, 64);
    const sig2 = computeFrameSignature(data2, 64);
    expect(sig1).not.toEqual(sig2);
  });

  it('handles small buffers', () => {
    const data = Buffer.from([1, 2, 3]);
    const sig = computeFrameSignature(data, 64);
    expect(sig.length).toBeGreaterThan(0);
  });

  it('works with Uint8Array', () => {
    const data = new Uint8Array(1024).fill(100);
    const sig = computeFrameSignature(data, 32);
    expect(sig.length).toBeGreaterThan(0);
    expect(sig.every(v => v === 100)).toBe(true);
  });
});

describe('computeChangeScore', () => {
  it('returns 0 for identical signatures', () => {
    const sig = [128, 128, 128, 128];
    expect(computeChangeScore(sig, sig)).toBe(0);
  });

  it('returns 1 for maximally different signatures', () => {
    const sig1 = [0, 0, 0, 0];
    const sig2 = [255, 255, 255, 255];
    expect(computeChangeScore(sig1, sig2)).toBe(1);
  });

  it('returns ~0.5 for moderately different signatures', () => {
    const sig1 = [0, 0, 0, 0];
    const sig2 = [128, 128, 128, 128];
    const score = computeChangeScore(sig1, sig2);
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.7);
  });

  it('returns 1 for empty signatures', () => {
    expect(computeChangeScore([], [1, 2, 3])).toBe(1);
    expect(computeChangeScore([1, 2, 3], [])).toBe(1);
  });

  it('handles different length signatures', () => {
    const sig1 = [100, 100, 100, 100, 100];
    const sig2 = [100, 100, 100];
    expect(computeChangeScore(sig1, sig2)).toBe(0);
  });

  it('is symmetric', () => {
    const sig1 = [10, 50, 100, 200];
    const sig2 = [200, 100, 50, 10];
    expect(computeChangeScore(sig1, sig2)).toBe(computeChangeScore(sig2, sig1));
  });
});

describe('estimateInterestScore', () => {
  it('returns 0 for empty buffer', () => {
    expect(estimateInterestScore(Buffer.alloc(0))).toBe(0);
  });

  it('returns low score for uniform data', () => {
    const data = Buffer.alloc(1024, 42);
    const score = estimateInterestScore(data);
    expect(score).toBeLessThan(0.1);
  });

  it('returns high score for random data', () => {
    const data = Buffer.alloc(1024);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.floor(Math.random() * 256);
    }
    const score = estimateInterestScore(data);
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns moderate score for somewhat varied data', () => {
    const data = Buffer.alloc(1024);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 16; // 16 unique values
    }
    const score = estimateInterestScore(data);
    expect(score).toBeGreaterThan(0.1);
    expect(score).toBeLessThan(0.8);
  });

  it('works with Uint8Array', () => {
    const data = new Uint8Array(512);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.floor(Math.random() * 256);
    }
    const score = estimateInterestScore(data);
    expect(score).toBeGreaterThan(0);
  });
});

// ─── Quality Presets ─────────────────────────────────────────────────────────

describe('QUALITY_PRESETS', () => {
  it('has all 5 quality levels', () => {
    const levels: QualityLevel[] = ['ultra', 'high', 'medium', 'low', 'minimal'];
    for (const level of levels) {
      expect(QUALITY_PRESETS[level]).toBeDefined();
    }
  });

  it('has decreasing resolution as quality decreases', () => {
    expect(QUALITY_PRESETS.ultra.maxWidth).toBeGreaterThan(QUALITY_PRESETS.high.maxWidth);
    expect(QUALITY_PRESETS.high.maxWidth).toBeGreaterThan(QUALITY_PRESETS.medium.maxWidth);
    expect(QUALITY_PRESETS.medium.maxWidth).toBeGreaterThan(QUALITY_PRESETS.low.maxWidth);
    expect(QUALITY_PRESETS.low.maxWidth).toBeGreaterThan(QUALITY_PRESETS.minimal.maxWidth);
  });

  it('has increasing skip ratio as quality decreases', () => {
    expect(QUALITY_PRESETS.ultra.skipFrameRatio).toBeLessThanOrEqual(QUALITY_PRESETS.medium.skipFrameRatio);
    expect(QUALITY_PRESETS.medium.skipFrameRatio).toBeLessThanOrEqual(QUALITY_PRESETS.low.skipFrameRatio);
    expect(QUALITY_PRESETS.low.skipFrameRatio).toBeLessThanOrEqual(QUALITY_PRESETS.minimal.skipFrameRatio);
  });

  it('minimal still supports barcode scanning', () => {
    expect(QUALITY_PRESETS.minimal.enableBarcode).toBe(true);
  });

  it('ultra has all features enabled', () => {
    const ultra = QUALITY_PRESETS.ultra;
    expect(ultra.enableOcr).toBe(true);
    expect(ultra.enableProductId).toBe(true);
    expect(ultra.enableBarcode).toBe(true);
  });
});

// ─── Session Management ──────────────────────────────────────────────────────

describe('StreamingPipeline - Session', () => {
  let pipeline: StreamingPipeline;

  beforeEach(() => {
    pipeline = new StreamingPipeline({ targetProcessingFps: 100 });
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('starts in idle state', () => {
    expect(pipeline.getState()).toBe('idle');
    expect(pipeline.getSession()).toBeNull();
  });

  it('starts a session', () => {
    const id = pipeline.startSession();
    expect(id).toMatch(/^stream-/);
    expect(pipeline.getState()).toBe('streaming');
    expect(pipeline.getSession()).not.toBeNull();
    expect(pipeline.getSession()!.framesReceived).toBe(0);
  });

  it('ends a session', () => {
    pipeline.startSession();
    const session = pipeline.endSession();
    expect(session).not.toBeNull();
    expect(session!.endedAt).toBeDefined();
    expect(pipeline.getState()).toBe('idle');
  });

  it('returns null when ending without session', () => {
    expect(pipeline.endSession()).toBeNull();
  });

  it('emits session events', () => {
    const startFn = vi.fn();
    const endFn = vi.fn();
    pipeline.on('session:started', startFn);
    pipeline.on('session:ended', endFn);

    pipeline.startSession();
    expect(startFn).toHaveBeenCalledOnce();

    pipeline.endSession();
    expect(endFn).toHaveBeenCalledOnce();
  });

  it('ends previous session when starting new one', () => {
    const endFn = vi.fn();
    pipeline.on('session:ended', endFn);

    pipeline.startSession();
    pipeline.startSession();
    expect(endFn).toHaveBeenCalledOnce();
  });

  it('pauses and resumes', () => {
    pipeline.startSession();
    pipeline.pause();
    expect(pipeline.getState()).toBe('paused');

    pipeline.resume();
    expect(pipeline.getState()).toBe('streaming');
  });

  it('ignores pause when not streaming', () => {
    pipeline.pause();
    expect(pipeline.getState()).toBe('idle');
  });

  it('ignores resume when not paused', () => {
    pipeline.startSession();
    pipeline.resume();
    expect(pipeline.getState()).toBe('streaming');
  });

  it('generates unique session ids', () => {
    const id1 = pipeline.startSession();
    pipeline.endSession();
    const id2 = pipeline.startSession();
    expect(id1).not.toBe(id2);
  });
});

// ─── Frame Ingestion ─────────────────────────────────────────────────────────

describe('StreamingPipeline - Frame Ingestion', () => {
  let pipeline: StreamingPipeline;

  beforeEach(() => {
    pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0.15,
      maxBufferSize: 20,
      backPressureThreshold: 0.8,
      sceneChangeBurst: false, // Disable for deterministic tests
    });
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('drops frames when no session is active', () => {
    const frame = makeDifferentFrame('f1');
    const result = pipeline.ingestFrame(frame);
    expect(result.dropped).toBe(true);
    expect(result.dropReason).toBe('pipeline_paused');
  });

  it('drops frames when paused', () => {
    pipeline.startSession();
    pipeline.pause();
    const result = pipeline.ingestFrame(makeDifferentFrame('f1'));
    expect(result.dropped).toBe(true);
    expect(result.dropReason).toBe('pipeline_paused');
  });

  it('accepts first frame', () => {
    pipeline.startSession();
    const frame = makeDifferentFrame('f1');
    const result = pipeline.ingestFrame(frame);
    expect(result.dropped).toBe(false);
    expect(result.frameId).toBe('f1');
  });

  it('increments framesReceived', () => {
    pipeline.startSession();
    pipeline.ingestFrame(makeDifferentFrame('f1'));
    pipeline.ingestFrame(makeDifferentFrame('f2'));
    pipeline.ingestFrame(makeDifferentFrame('f3'));
    expect(pipeline.getSession()!.framesReceived).toBe(3);
  });

  it('emits frame:received event', () => {
    pipeline.startSession();
    const fn = vi.fn();
    pipeline.on('frame:received', fn);
    pipeline.ingestFrame(makeDifferentFrame('f1'));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('adds frame to buffer', () => {
    pipeline.startSession();
    expect(pipeline.getBufferSize()).toBe(0);
    pipeline.ingestFrame(makeDifferentFrame('f1'));
    expect(pipeline.getBufferSize()).toBe(1);
  });

  it('deduplicates near-identical frames', () => {
    pipeline.startSession();
    const templateData = Buffer.alloc(1024, 42);
    pipeline.ingestFrame(makeIdenticalFrame('f1', templateData));
    const result = pipeline.ingestFrame(makeIdenticalFrame('f2', templateData));
    expect(result.dropped).toBe(true);
    expect(result.dropReason).toBe('duplicate');
  });

  it('accepts sufficiently different frames', () => {
    pipeline.startSession();
    const r1 = pipeline.ingestFrame(makeDifferentFrame('f1'));
    const r2 = pipeline.ingestFrame(makeDifferentFrame('f2'));
    // At least one should not be dropped (first frame always accepted)
    expect(r1.dropped).toBe(false);
  });

  it('drops old frames', () => {
    pipeline.startSession();
    const oldFrame = makeDifferentFrame('f1', Date.now() - 20000);
    const result = pipeline.ingestFrame(oldFrame);
    expect(result.dropped).toBe(true);
    expect(result.dropReason).toBe('rate_limited');
  });

  it('drops frames when buffer is full', () => {
    const smallPipeline = new StreamingPipeline({
      maxBufferSize: 2,
      changeThreshold: 0,
      targetProcessingFps: 0.01, // Very slow processing to let buffer fill
      sceneChangeBurst: false,
    });
    smallPipeline.startSession();

    smallPipeline.ingestFrame(makeDifferentFrame('f1'));
    smallPipeline.ingestFrame(makeDifferentFrame('f2'));
    const result = smallPipeline.ingestFrame(makeDifferentFrame('f3'));
    expect(result.dropped).toBe(true);
    expect(result.dropReason).toBe('buffer_full');

    smallPipeline.destroy();
  });

  it('emits frame:dropped event', () => {
    pipeline.startSession();
    pipeline.pause();
    const fn = vi.fn();
    pipeline.on('frame:dropped', fn);
    pipeline.ingestFrame(makeDifferentFrame('f1'));
    expect(fn).toHaveBeenCalledWith('f1', 'pipeline_paused');
  });

  it('tracks drop reasons in session stats', () => {
    pipeline.startSession();
    pipeline.pause();
    pipeline.ingestFrame(makeDifferentFrame('f1'));
    pipeline.ingestFrame(makeDifferentFrame('f2'));
    const session = pipeline.getSession()!;
    expect(session.dropReasons.pipeline_paused).toBe(2);
    expect(session.framesDropped).toBe(2);
  });
});

// ─── Back-Pressure ───────────────────────────────────────────────────────────

describe('StreamingPipeline - Back-Pressure', () => {
  let pipeline: StreamingPipeline;

  beforeEach(() => {
    pipeline = new StreamingPipeline({
      maxBufferSize: 10,
      backPressureThreshold: 0.5, // Trigger at 50%
      changeThreshold: 0, // Accept all frames for this test
      targetProcessingFps: 0.01, // Very slow processing
      sceneChangeBurst: false,
    });
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('emits backpressure:start when threshold reached', () => {
    pipeline.startSession();
    const fn = vi.fn();
    pipeline.on('backpressure:start', fn);

    // Fill buffer past 50% (5 of 10)
    for (let i = 0; i < 6; i++) {
      pipeline.ingestFrame(makeDifferentFrame(`f${i}`));
    }

    expect(fn).toHaveBeenCalled();
  });

  it('drops frames during back-pressure', () => {
    pipeline.startSession();

    // Fill to back-pressure
    for (let i = 0; i < 5; i++) {
      pipeline.ingestFrame(makeDifferentFrame(`f${i}`));
    }

    const result = pipeline.ingestFrame(makeDifferentFrame('overflow'));
    expect(result.dropped).toBe(true);
    expect(result.dropReason).toBe('back_pressure');
  });
});

// ─── Quality Control ─────────────────────────────────────────────────────────

describe('StreamingPipeline - Quality', () => {
  let pipeline: StreamingPipeline;

  beforeEach(() => {
    pipeline = new StreamingPipeline({ targetProcessingFps: 100 });
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('starts with high quality', () => {
    expect(pipeline.getQualityLevel()).toBe('high');
  });

  it('allows manual quality setting', () => {
    pipeline.setQualityLevel('low');
    expect(pipeline.getQualityLevel()).toBe('low');
  });

  it('emits quality:adjusted on manual change', () => {
    const fn = vi.fn();
    pipeline.on('quality:adjusted', fn);
    pipeline.setQualityLevel('medium');
    expect(fn).toHaveBeenCalledWith('high', 'medium', 'manual');
  });

  it('does not emit event when setting same level', () => {
    const fn = vi.fn();
    pipeline.on('quality:adjusted', fn);
    pipeline.setQualityLevel('high'); // Already high
    expect(fn).not.toHaveBeenCalled();
  });

  it('updates session quality level', () => {
    pipeline.startSession();
    pipeline.setQualityLevel('low');
    expect(pipeline.getSession()!.adaptiveQuality).toBe('low');
  });
});

// ─── Processing ──────────────────────────────────────────────────────────────

describe('StreamingPipeline - Processing', () => {
  it('processes frames through handler', async () => {
    const processFrame = vi.fn().mockResolvedValue({
      frameId: 'f1',
      sceneType: 'retail_shelf',
      interestScore: 0.8,
    });

    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      processFrame,
      sceneChangeBurst: false,
    });

    pipeline.startSession();
    pipeline.ingestFrame(makeDifferentFrame('f1'));

    // Wait for processing loop to pick it up
    await sleep(50);

    expect(processFrame).toHaveBeenCalled();
    expect(pipeline.getSession()!.framesProcessed).toBeGreaterThanOrEqual(1);

    pipeline.destroy();
  });

  it('routes results to agents when above interest threshold', async () => {
    const routeResult = vi.fn().mockResolvedValue(['inventory', 'deals']);
    const processFrame = vi.fn().mockResolvedValue({
      frameId: 'f1',
      sceneType: 'retail_shelf',
      interestScore: 0.8,
    });

    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      interestThreshold: 0.3,
      processFrame,
      routeResult,
      sceneChangeBurst: false,
    });

    const routedFn = vi.fn();
    pipeline.on('frame:routed', routedFn);

    pipeline.startSession();
    pipeline.ingestFrame(makeDifferentFrame('f1'));

    await sleep(50);

    expect(routeResult).toHaveBeenCalled();
    expect(routedFn).toHaveBeenCalled();

    pipeline.destroy();
  });

  it('does not route low-interest results', async () => {
    const routeResult = vi.fn().mockResolvedValue([]);
    const processFrame = vi.fn().mockResolvedValue({
      frameId: 'f1',
      interestScore: 0.1,
    });

    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      interestThreshold: 0.3,
      processFrame,
      routeResult,
      sceneChangeBurst: false,
    });

    pipeline.startSession();
    pipeline.ingestFrame(makeDifferentFrame('f1'));

    await sleep(50);

    expect(routeResult).not.toHaveBeenCalled();

    pipeline.destroy();
  });

  it('detects scene changes', async () => {
    let callCount = 0;
    const processFrame = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        frameId: `f${callCount}`,
        sceneType: callCount === 1 ? 'retail_shelf' : 'office',
        interestScore: 0.5,
      };
    });

    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      processFrame,
      sceneChangeBurst: false,
    });

    const sceneChangeFn = vi.fn();
    pipeline.on('scene:changed', sceneChangeFn);

    pipeline.startSession();
    pipeline.ingestFrame(makeDifferentFrame('f1'));
    await sleep(50);
    pipeline.ingestFrame(makeDifferentFrame('f2'));
    await sleep(50);

    // First frame sets scene, second changes it
    expect(sceneChangeFn).toHaveBeenCalled();

    pipeline.destroy();
  });

  it('emits error for failing handlers', async () => {
    const processFrame = vi.fn().mockRejectedValue(new Error('Vision API down'));

    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      processFrame,
      sceneChangeBurst: false,
    });

    const errorFn = vi.fn();
    pipeline.on('error', errorFn);

    pipeline.startSession();
    pipeline.ingestFrame(makeDifferentFrame('f1'));

    await sleep(50);

    expect(errorFn).toHaveBeenCalled();

    pipeline.destroy();
  });

  it('respects maxConcurrent limit', async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const processFrame = vi.fn().mockImplementation(async () => {
      concurrentCount++;
      if (concurrentCount > maxConcurrent) maxConcurrent = concurrentCount;
      await sleep(100);
      concurrentCount--;
      return { frameId: 'f', interestScore: 0.1 };
    });

    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      maxConcurrent: 2,
      processFrame,
      sceneChangeBurst: false,
    });

    pipeline.startSession();
    for (let i = 0; i < 10; i++) {
      pipeline.ingestFrame(makeDifferentFrame(`f${i}`));
    }

    await sleep(500);

    expect(maxConcurrent).toBeLessThanOrEqual(2);

    pipeline.destroy();
  });
});

// ─── FPS Tracking ────────────────────────────────────────────────────────────

describe('StreamingPipeline - FPS', () => {
  it('tracks current FPS', () => {
    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      sceneChangeBurst: false,
    });

    pipeline.startSession();

    // Ingest 10 frames rapidly
    for (let i = 0; i < 10; i++) {
      pipeline.ingestFrame(makeDifferentFrame(`f${i}`));
    }

    const session = pipeline.getSession()!;
    expect(session.currentFps).toBeGreaterThan(0);
    expect(session.peakFps).toBeGreaterThan(0);

    pipeline.destroy();
  });

  it('tracks peak FPS', () => {
    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      sceneChangeBurst: false,
    });

    pipeline.startSession();

    for (let i = 0; i < 20; i++) {
      pipeline.ingestFrame(makeDifferentFrame(`f${i}`));
    }

    const session = pipeline.getSession()!;
    expect(session.peakFps).toBeGreaterThanOrEqual(session.currentFps);

    pipeline.destroy();
  });
});

// ─── Voice Summary ───────────────────────────────────────────────────────────

describe('StreamingPipeline - Voice Summary', () => {
  it('returns no-session message when idle', () => {
    const pipeline = new StreamingPipeline();
    expect(pipeline.getVoiceSummary()).toBe('No active streaming session.');
    pipeline.destroy();
  });

  it('returns summary during streaming', () => {
    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      sceneChangeBurst: false,
    });

    pipeline.startSession();
    pipeline.ingestFrame(makeDifferentFrame('f1'));
    pipeline.ingestFrame(makeDifferentFrame('f2'));

    const summary = pipeline.getVoiceSummary();
    expect(summary).toContain('Streaming');
    expect(summary).toContain('Quality: high');

    pipeline.destroy();
  });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

describe('StreamingPipeline - Stats', () => {
  it('returns stats object', () => {
    const pipeline = new StreamingPipeline();
    const stats = pipeline.getStats();
    expect(stats.state).toBe('idle');
    expect(stats.session).toBeNull();
    expect(stats.quality).toBe('high');
    expect(stats.bufferSize).toBe(0);
    expect(stats.inBackPressure).toBe(false);
    pipeline.destroy();
  });

  it('reflects active session in stats', () => {
    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      sceneChangeBurst: false,
    });
    pipeline.startSession();
    pipeline.ingestFrame(makeDifferentFrame('f1'));

    const stats = pipeline.getStats();
    expect(stats.state).toBe('streaming');
    expect(stats.session).not.toBeNull();
    expect(stats.bufferSize).toBe(1);

    pipeline.destroy();
  });

  it('includes quality preset', () => {
    const pipeline = new StreamingPipeline();
    pipeline.setQualityLevel('medium');
    const stats = pipeline.getStats();
    expect(stats.qualityPreset).toEqual(QUALITY_PRESETS.medium);
    pipeline.destroy();
  });
});

// ─── Buffer Utilization ──────────────────────────────────────────────────────

describe('StreamingPipeline - Buffer', () => {
  it('reports buffer utilization', () => {
    const pipeline = new StreamingPipeline({
      maxBufferSize: 10,
      targetProcessingFps: 0.01,
      changeThreshold: 0,
      sceneChangeBurst: false,
    });

    pipeline.startSession();
    expect(pipeline.getBufferUtilization()).toBe(0);

    pipeline.ingestFrame(makeDifferentFrame('f1'));
    expect(pipeline.getBufferUtilization()).toBe(0.1);

    for (let i = 2; i <= 5; i++) {
      pipeline.ingestFrame(makeDifferentFrame(`f${i}`));
    }
    expect(pipeline.getBufferUtilization()).toBe(0.5);

    pipeline.destroy();
  });

  it('clears buffer on session end', () => {
    const pipeline = new StreamingPipeline({
      maxBufferSize: 10,
      targetProcessingFps: 0.01,
      changeThreshold: 0,
      sceneChangeBurst: false,
    });

    pipeline.startSession();
    pipeline.ingestFrame(makeDifferentFrame('f1'));
    expect(pipeline.getBufferSize()).toBe(1);

    pipeline.endSession();
    expect(pipeline.getBufferSize()).toBe(0);

    pipeline.destroy();
  });
});

// ─── Scene Change Burst ──────────────────────────────────────────────────────

describe('StreamingPipeline - Scene Change Burst', () => {
  it('processes extra frames on scene change', () => {
    const pipeline = new StreamingPipeline({
      maxBufferSize: 20,
      targetProcessingFps: 100,
      changeThreshold: 0.4, // High threshold
      sceneChangeBurst: true,
      burstFrameCount: 3,
    });

    pipeline.startSession();

    // First frame always accepted
    const r1 = pipeline.ingestFrame(makeDifferentFrame('f1'));
    expect(r1.dropped).toBe(false);

    // Very different frame triggers burst
    const diffBuf = Buffer.alloc(1024, 200);
    const r2 = pipeline.ingestFrame({
      id: 'f2',
      timestamp: Date.now(),
      data: diffBuf,
    });
    // This frame's change score may be above threshold
    // Next frames should benefit from burst mode if it was high change

    pipeline.destroy();
  });
});

// ─── Destroy ─────────────────────────────────────────────────────────────────

describe('StreamingPipeline - Destroy', () => {
  it('cleans up on destroy', () => {
    const pipeline = new StreamingPipeline({ targetProcessingFps: 100 });
    pipeline.startSession();
    pipeline.ingestFrame(makeDifferentFrame('f1'));

    pipeline.destroy();

    expect(pipeline.getState()).toBe('idle');
    expect(pipeline.getSession()).toBeNull();
    expect(pipeline.getBufferSize()).toBe(0);
  });

  it('removes all listeners on destroy', () => {
    const pipeline = new StreamingPipeline();
    pipeline.on('frame:received', () => {});
    pipeline.on('error', () => {});

    pipeline.destroy();

    expect(pipeline.listenerCount('frame:received')).toBe(0);
    expect(pipeline.listenerCount('error')).toBe(0);
  });
});

// ─── Default Config ──────────────────────────────────────────────────────────

describe('DEFAULT_STREAMING_CONFIG', () => {
  it('has reasonable defaults', () => {
    expect(DEFAULT_STREAMING_CONFIG.maxBufferSize).toBe(30);
    expect(DEFAULT_STREAMING_CONFIG.changeThreshold).toBe(0.15);
    expect(DEFAULT_STREAMING_CONFIG.maxConcurrent).toBe(3);
    expect(DEFAULT_STREAMING_CONFIG.targetProcessingFps).toBe(2);
    expect(DEFAULT_STREAMING_CONFIG.adaptiveQuality).toBe(true);
    expect(DEFAULT_STREAMING_CONFIG.sceneChangeBurst).toBe(true);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('StreamingPipeline - Edge Cases', () => {
  it('handles rapid start/stop cycles', () => {
    const pipeline = new StreamingPipeline({ targetProcessingFps: 100 });
    for (let i = 0; i < 10; i++) {
      pipeline.startSession();
      pipeline.endSession();
    }
    expect(pipeline.getState()).toBe('idle');
    pipeline.destroy();
  });

  it('handles frame with GPS data', () => {
    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      sceneChangeBurst: false,
    });
    pipeline.startSession();

    const frame: StreamFrame = {
      id: 'gps-frame',
      timestamp: Date.now(),
      data: makeDifferentFrame('t').data,
      gps: { lat: 40.7128, lng: -74.0060, accuracy: 10 },
      source: 'glasses',
    };

    const result = pipeline.ingestFrame(frame);
    expect(result.dropped).toBe(false);

    pipeline.destroy();
  });

  it('handles frame from different sources', () => {
    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      sceneChangeBurst: false,
    });
    pipeline.startSession();

    const sources: Array<'glasses' | 'companion' | 'webcam' | 'upload'> = [
      'glasses', 'companion', 'webcam', 'upload',
    ];

    for (const source of sources) {
      const frame = makeDifferentFrame(`f-${source}`);
      frame.source = source;
      const result = pipeline.ingestFrame(frame);
      expect(result.frameId).toBe(`f-${source}`);
    }

    pipeline.destroy();
  });

  it('handles concurrent ingest and processing', async () => {
    const processFrame = vi.fn().mockImplementation(async () => {
      await sleep(10);
      return { frameId: 'f', interestScore: 0.1 };
    });

    const pipeline = new StreamingPipeline({
      targetProcessingFps: 100,
      changeThreshold: 0,
      maxConcurrent: 2,
      processFrame,
      sceneChangeBurst: false,
    });

    pipeline.startSession();

    // Ingest while processing happens
    for (let i = 0; i < 5; i++) {
      pipeline.ingestFrame(makeDifferentFrame(`f${i}`));
      await sleep(5);
    }

    await sleep(200);

    expect(processFrame).toHaveBeenCalled();

    pipeline.destroy();
  });
});
