/**
 * Tests for ImageScheduler — automated capture with change detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImageScheduler, type ImageSchedulerConfig } from './image-scheduler.js';
import { EventEmitter } from 'eventemitter3';
import type { CapturedImage, CaptureTrigger } from '../types.js';

// ─── Mock Node Bridge ───────────────────────────────────────────

class MockNodeBridge extends EventEmitter {
  private _connected = true;
  captureCount = 0;

  constructor() {
    super();
  }

  isConnected(): boolean {
    return this._connected;
  }

  setConnected(value: boolean): void {
    this._connected = value;
  }

  async captureImage(
    trigger: CaptureTrigger = 'auto',
    voiceAnnotation?: string
  ): Promise<CapturedImage | null> {
    if (!this._connected) return null;
    this.captureCount++;

    // Generate slightly different image data each time to pass change detection
    const data = `image-data-${this.captureCount}-${Date.now()}-${Math.random()}`;
    return {
      id: `img-${this.captureCount}`,
      buffer: Buffer.from(data),
      mimeType: 'image/jpeg',
      capturedAt: new Date().toISOString(),
      deviceId: 'test-device',
      trigger,
      voiceAnnotation,
    };
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ImageScheduler - Construction', () => {
  it('should create with default config', () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any);
    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.isPaused()).toBe(false);
  });

  it('should accept custom config', () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 5000,
      changeDetectionEnabled: false,
    });

    const stats = scheduler.getStats();
    expect(stats.running).toBe(false);
    expect(stats.captureCount).toBe(0);
  });
});

describe('ImageScheduler - Start/Stop', () => {
  it('should start and emit event', () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000, // Very long interval so we control timing
    });

    const startHandler = vi.fn();
    scheduler.on('scheduler:started', startHandler);

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    expect(startHandler).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('should stop and emit event', () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
    });

    const stopHandler = vi.fn();
    scheduler.on('scheduler:stopped', stopHandler);

    scheduler.start();
    scheduler.stop();

    expect(scheduler.isRunning()).toBe(false);
    expect(stopHandler).toHaveBeenCalledTimes(1);
  });

  it('should not start twice', () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
    });

    const startHandler = vi.fn();
    scheduler.on('scheduler:started', startHandler);

    scheduler.start();
    scheduler.start(); // Should no-op
    expect(startHandler).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('should reset counts on start', () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
    });

    scheduler.start();
    scheduler.stop();
    scheduler.start();

    expect(scheduler.getStats().captureCount).toBe(0);
    scheduler.stop();
  });
});

describe('ImageScheduler - Pause/Resume', () => {
  it('should pause and resume', () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
    });

    scheduler.start();
    expect(scheduler.isPaused()).toBe(false);

    scheduler.pause();
    expect(scheduler.isPaused()).toBe(true);
    expect(scheduler.isRunning()).toBe(true); // Still "running" but paused

    scheduler.resume();
    expect(scheduler.isPaused()).toBe(false);

    scheduler.stop();
  });

  it('should emit pause/resume events', () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
    });

    const pauseHandler = vi.fn();
    const resumeHandler = vi.fn();
    scheduler.on('scheduler:paused', pauseHandler);
    scheduler.on('scheduler:resumed', resumeHandler);

    scheduler.start();
    scheduler.pause();
    expect(pauseHandler).toHaveBeenCalledTimes(1);

    scheduler.resume();
    expect(resumeHandler).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('should not pause when not running', () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any);

    const handler = vi.fn();
    scheduler.on('scheduler:paused', handler);

    scheduler.pause();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('ImageScheduler - Manual Trigger', () => {
  it('should capture on manual trigger', async () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
      changeDetectionEnabled: false, // Disable to avoid skips
    });

    // Need to mark bridge as connected
    bridge.setConnected(true);

    // Don't need to start scheduler for manual triggers
    // but the scheduler.triggerManual needs the bridge
    const readyHandler = vi.fn();
    scheduler.on('image:ready', readyHandler);

    scheduler.start();
    const image = await scheduler.triggerManual('manual', 'Test annotation');

    expect(image).not.toBeNull();
    expect(image!.trigger).toBe('manual');
    expect(image!.voiceAnnotation).toBe('Test annotation');
    expect(readyHandler).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('should return null when bridge is disconnected', async () => {
    const bridge = new MockNodeBridge();
    bridge.setConnected(false);

    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
    });

    scheduler.start();
    const image = await scheduler.triggerManual();
    expect(image).toBeNull();

    scheduler.stop();
  });
});

describe('ImageScheduler - Change Detection', () => {
  it('should skip identical images when change detection is on', async () => {
    const bridge = new MockNodeBridge();
    // Override to return identical data
    bridge.captureImage = async () => ({
      id: `img-${Date.now()}`,
      buffer: Buffer.from('identical-content-that-never-changes'),
      mimeType: 'image/jpeg',
      capturedAt: new Date().toISOString(),
      deviceId: 'test',
      trigger: 'auto',
    });

    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
      changeDetectionEnabled: true,
      changeThreshold: 0.3,
    });

    const readyHandler = vi.fn();
    const skipHandler = vi.fn();
    scheduler.on('image:ready', readyHandler);
    scheduler.on('image:skipped', skipHandler);

    scheduler.start();

    // First trigger — should accept (no previous image)
    await scheduler.triggerManual('auto');

    // Second trigger with identical data — should skip
    await scheduler.triggerManual('auto');

    expect(readyHandler).toHaveBeenCalledTimes(1);
    expect(skipHandler).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('should accept images that differ significantly', async () => {
    const bridge = new MockNodeBridge();
    let callIndex = 0;
    bridge.captureImage = async () => {
      callIndex++;
      // Generate very different data each time
      const data = callIndex === 1
        ? 'A'.repeat(1000)
        : 'Z'.repeat(2000); // Different size AND content

      return {
        id: `img-${callIndex}`,
        buffer: Buffer.from(data),
        mimeType: 'image/jpeg',
        capturedAt: new Date().toISOString(),
        deviceId: 'test',
        trigger: 'auto',
      };
    };

    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
      changeDetectionEnabled: true,
      changeThreshold: 0.1,
    });

    const readyHandler = vi.fn();
    scheduler.on('image:ready', readyHandler);

    scheduler.start();
    await scheduler.triggerManual('auto');
    await scheduler.triggerManual('auto');

    expect(readyHandler).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('should bypass change detection for manual triggers', async () => {
    const bridge = new MockNodeBridge();
    bridge.captureImage = async (trigger) => ({
      id: `img-${Date.now()}`,
      buffer: Buffer.from('identical-data'),
      mimeType: 'image/jpeg',
      capturedAt: new Date().toISOString(),
      deviceId: 'test',
      trigger: trigger || 'auto',
    });

    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
      changeDetectionEnabled: true,
    });

    const readyHandler = vi.fn();
    scheduler.on('image:ready', readyHandler);

    scheduler.start();
    await scheduler.triggerManual('auto'); // First auto — accepted
    await scheduler.triggerManual('manual'); // Manual — accepted (bypasses change detection)

    expect(readyHandler).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});

describe('ImageScheduler - Buffer Management', () => {
  it('should add images to buffer', async () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
      changeDetectionEnabled: false,
    });

    scheduler.start();
    await scheduler.triggerManual();
    await scheduler.triggerManual();

    expect(scheduler.getStats().bufferSize).toBe(2);
    scheduler.stop();
  });

  it('should drain buffer and clear it', async () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
      changeDetectionEnabled: false,
    });

    scheduler.start();
    await scheduler.triggerManual();
    await scheduler.triggerManual();
    await scheduler.triggerManual();

    const drained = scheduler.drainBuffer();
    expect(drained.length).toBe(3);
    expect(scheduler.getStats().bufferSize).toBe(0);

    scheduler.stop();
  });

  it('should skip capture when buffer is full', async () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
      changeDetectionEnabled: false,
      maxBufferSize: 2,
    });

    const warningHandler = vi.fn();
    scheduler.on('buffer:warning', warningHandler);

    scheduler.start();
    await scheduler.triggerManual();
    await scheduler.triggerManual();
    await scheduler.triggerManual(); // Should be rejected

    expect(warningHandler).toHaveBeenCalledTimes(1);
    expect(scheduler.getStats().bufferSize).toBe(2);

    scheduler.stop();
  });
});

describe('ImageScheduler - Config Updates', () => {
  it('should update config on the fly', () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 3000,
    });

    scheduler.updateConfig({ intervalMs: 5000 });
    // Config update doesn't throw
    expect(true).toBe(true);
  });
});

describe('ImageScheduler - Stats', () => {
  it('should track capture and skip counts', async () => {
    const bridge = new MockNodeBridge();
    const scheduler = new ImageScheduler(bridge as any, {
      intervalMs: 100000,
      changeDetectionEnabled: false,
    });

    scheduler.start();
    await scheduler.triggerManual();
    await scheduler.triggerManual();

    const stats = scheduler.getStats();
    expect(stats.captureCount).toBe(2);
    expect(stats.running).toBe(true);
    expect(stats.paused).toBe(false);

    scheduler.stop();
  });
});
