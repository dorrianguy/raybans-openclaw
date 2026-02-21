/**
 * Tests for MemoryAgent — Perfect Memory / Life Indexing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryAgent, type MemoryAgentConfig } from './memory-agent.js';
import { EventEmitter } from 'eventemitter3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CapturedImage, CaptureTrigger } from '../types.js';

// ─── Mock Node Bridge ───────────────────────────────────────────

class MockNodeBridge extends EventEmitter {
  private _connected = true;
  captureCount = 0;

  isConnected(): boolean {
    return this._connected;
  }

  setConnected(v: boolean): void {
    this._connected = v;
  }

  async captureImage(
    trigger: CaptureTrigger = 'auto',
    voiceAnnotation?: string
  ): Promise<CapturedImage | null> {
    if (!this._connected) return null;
    this.captureCount++;

    return {
      id: `img-${this.captureCount}-${Date.now()}`,
      buffer: Buffer.from(`image-data-${this.captureCount}`),
      mimeType: 'image/jpeg',
      capturedAt: new Date().toISOString(),
      deviceId: 'test-device',
      trigger,
      voiceAnnotation,
    };
  }
}

// ─── Mock Vision Pipeline ───────────────────────────────────────

// We'll mock the internal fetch call used by VisionPipeline
const mockFetch = vi.fn();

// ─── Test Setup ─────────────────────────────────────────────────

let tempDir: string;
let agent: MemoryAgent;
let bridge: MockNodeBridge;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'raybans-memory-test-'));
}

function createAgent(overrides: Partial<MemoryAgentConfig> = {}): MemoryAgent {
  return new MemoryAgent({
    apiKey: 'test-api-key',
    model: 'gpt-4o',
    dataDir: tempDir,
    captureIntervalSec: 300, // Long interval so auto-capture doesn't fire
    retentionDays: 30,
    debug: true,
    ...overrides,
  });
}

beforeEach(() => {
  tempDir = makeTempDir();
  bridge = new MockNodeBridge();
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  try {
    if (agent) agent.shutdown();
  } catch { /* already shut down */ }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ─── Construction ───────────────────────────────────────────────

describe('MemoryAgent - Construction', () => {
  it('should create with config', () => {
    agent = createAgent();
    expect(agent).toBeDefined();
    expect(agent.isRunning()).toBe(false);
    expect(agent.isPrivacyMode()).toBe(false);
  });

  it('should initialize persistence layer', () => {
    agent = createAgent();
    const stats = agent.getStats();
    expect(stats.totalMemories).toBe(0);
    expect(stats.totalImages).toBe(0);
  });
});

// ─── Lifecycle ──────────────────────────────────────────────────

describe('MemoryAgent - Lifecycle', () => {
  it('should start and emit voice response', () => {
    agent = createAgent();
    const voiceHandler = vi.fn();
    agent.on('voice:response', voiceHandler);

    agent.start(bridge as any);

    expect(agent.isRunning()).toBe(true);
    expect(voiceHandler).toHaveBeenCalledWith(
      expect.stringContaining('Memory mode active')
    );

    agent.stop();
  });

  it('should stop and report count', () => {
    agent = createAgent();
    const voiceHandler = vi.fn();
    agent.on('voice:response', voiceHandler);

    agent.start(bridge as any);
    agent.stop();

    expect(agent.isRunning()).toBe(false);
    expect(voiceHandler).toHaveBeenCalledWith(
      expect.stringContaining('Memory mode off')
    );
  });

  it('should not start twice', () => {
    agent = createAgent();
    agent.start(bridge as any);
    agent.start(bridge as any); // Should no-op
    expect(agent.isRunning()).toBe(true);
    agent.stop();
  });
});

// ─── Privacy Mode ───────────────────────────────────────────────

describe('MemoryAgent - Privacy', () => {
  it('should enable privacy mode', () => {
    agent = createAgent();
    agent.start(bridge as any);

    const privacyHandler = vi.fn();
    agent.on('privacy:changed', privacyHandler);

    agent.enablePrivacy();

    expect(agent.isPrivacyMode()).toBe(true);
    expect(privacyHandler).toHaveBeenCalledWith(true);

    agent.stop();
  });

  it('should disable privacy mode', () => {
    agent = createAgent();
    agent.start(bridge as any);

    agent.enablePrivacy();
    agent.disablePrivacy();

    expect(agent.isPrivacyMode()).toBe(false);

    agent.stop();
  });

  it('should emit voice feedback on privacy toggle', () => {
    agent = createAgent();
    const voiceHandler = vi.fn();
    agent.on('voice:response', voiceHandler);

    agent.start(bridge as any);
    agent.enablePrivacy();

    expect(voiceHandler).toHaveBeenCalledWith(
      expect.stringContaining('Privacy mode on')
    );

    agent.disablePrivacy();
    expect(voiceHandler).toHaveBeenCalledWith(
      expect.stringContaining('Privacy mode off')
    );

    agent.stop();
  });
});

// ─── Search ─────────────────────────────────────────────────────

describe('MemoryAgent - Search', () => {
  it('should return empty results for empty memory', () => {
    agent = createAgent();
    const result = agent.search('whiteboard');

    expect(result.entries).toEqual([]);
    expect(result.totalResults).toBe(0);
    expect(result.query).toBe('whiteboard');
    expect(result.searchTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should emit search results event', () => {
    agent = createAgent();
    const handler = vi.fn();
    agent.on('search:results', handler);

    agent.search('test query');
    expect(handler).toHaveBeenCalledWith('test query', 0);
  });

  it('should return voice-friendly response for no results', () => {
    agent = createAgent();
    const voiceHandler = vi.fn();
    agent.on('voice:response', voiceHandler);

    agent.searchAndSpeak('nonexistent thing');

    expect(voiceHandler).toHaveBeenCalledWith(
      expect.stringContaining("don't have any memories")
    );
  });

  it('should limit search results', () => {
    agent = createAgent();
    const result = agent.search('anything', 5);
    expect(result.entries.length).toBeLessThanOrEqual(5);
  });
});

// ─── Browse ─────────────────────────────────────────────────────

describe('MemoryAgent - Browse', () => {
  it('should browse all memories', () => {
    agent = createAgent();
    const entries = agent.browse();
    expect(entries).toEqual([]);
  });

  it('should get recent memories', () => {
    agent = createAgent();
    const entries = agent.getRecentMemories(24);
    expect(entries).toEqual([]);
  });
});

// ─── Stats ──────────────────────────────────────────────────────

describe('MemoryAgent - Stats', () => {
  it('should return correct stats for empty memory', () => {
    agent = createAgent();
    const stats = agent.getStats();

    expect(stats.totalMemories).toBe(0);
    expect(stats.totalImages).toBe(0);
    expect(stats.indexedThisSession).toBe(0);
  });

  it('should generate voice status report', () => {
    agent = createAgent();
    const report = agent.getStatusReport();

    expect(report).toContain('Memory status');
    expect(report).toContain('0 total memories');
    expect(report).toContain('Currently stopped');
  });

  it('should report active state in status', () => {
    agent = createAgent();
    agent.start(bridge as any);

    const report = agent.getStatusReport();
    expect(report).toContain('Currently active');

    agent.stop();
  });

  it('should report privacy mode in status', () => {
    agent = createAgent();
    agent.start(bridge as any);
    agent.enablePrivacy();

    const report = agent.getStatusReport();
    expect(report).toContain('privacy mode');

    agent.stop();
  });
});

// ─── Cleanup ────────────────────────────────────────────────────

describe('MemoryAgent - Cleanup', () => {
  it('should run cleanup without errors', () => {
    agent = createAgent({ retentionDays: 7 });
    const count = agent.runCleanup();
    expect(count).toBe(0); // Empty DB, nothing to clean
  });

  it('should skip cleanup when retention is disabled', () => {
    agent = createAgent({ retentionDays: 0 });
    const count = agent.runCleanup();
    expect(count).toBe(0);
  });
});

// ─── Shutdown ───────────────────────────────────────────────────

describe('MemoryAgent - Shutdown', () => {
  it('should shut down cleanly', () => {
    agent = createAgent();
    agent.start(bridge as any);
    agent.shutdown();
    expect(agent.isRunning()).toBe(false);
  });
});

// ─── Delete Recent ──────────────────────────────────────────────

describe('MemoryAgent - Delete Recent', () => {
  it('should handle "1 hour" timeframe', () => {
    agent = createAgent();
    const voiceHandler = vi.fn();
    agent.on('voice:response', voiceHandler);

    agent.deleteRecent('1 hour');
    expect(voiceHandler).toHaveBeenCalledWith(
      expect.stringContaining('Deleted')
    );
  });

  it('should handle "30 minutes" timeframe', () => {
    agent = createAgent();
    const voiceHandler = vi.fn();
    agent.on('voice:response', voiceHandler);

    agent.deleteRecent('30 minutes');
    expect(voiceHandler).toHaveBeenCalledWith(
      expect.stringContaining('Deleted')
    );
  });

  it('should reject invalid timeframes', () => {
    agent = createAgent();
    const voiceHandler = vi.fn();
    agent.on('voice:response', voiceHandler);

    agent.deleteRecent('some random text');
    expect(voiceHandler).toHaveBeenCalledWith(
      expect.stringContaining("didn't understand")
    );
  });
});
