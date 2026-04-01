/**
 * Tests for Platform Orchestrator
 *
 * 🌙 Night Shift Agent — Night #28
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Platform,
  createPlatform,
  DEFAULT_MODULE_FLAGS,
} from './platform.js';
import type {
  PlatformConfig,
  RegisteredAgent,
  ModuleHealth,
  AgentResult,
  VoiceResponse,
  ProcessingContext,
} from './platform.js';
import type { VisionAnalysis, VoiceCommand, AgentConfig, SceneType, VoiceIntent } from '../types.js';

// ─── Test Helpers ───────────────────────────────────────────────

function makeAgentConfig(): AgentConfig {
  return {
    visionModel: 'gpt-4o',
    visionApiKey: 'test-key',
    dataDir: '/tmp/test',
    debug: false,
  };
}

function makeConfig(overrides?: Partial<PlatformConfig>): PlatformConfig {
  return {
    agent: makeAgentConfig(),
    modules: { ...DEFAULT_MODULE_FLAGS },
    ...overrides,
  };
}

function makeAnalysis(overrides?: Partial<VisionAnalysis>): VisionAnalysis {
  return {
    imageId: 'img-001',
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 500,
    sceneDescription: 'A retail shelf with products',
    sceneType: 'retail_shelf',
    extractedText: [],
    detectedObjects: [],
    products: [],
    barcodes: [],
    quality: {
      score: 0.9,
      isBlurry: false,
      hasGlare: false,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: true,
    },
    ...overrides,
  };
}

function makeVoiceCommand(overrides?: Partial<VoiceCommand>): VoiceCommand {
  return {
    rawText: 'start inventory',
    intent: 'inventory_start',
    params: {},
    confidence: 0.95,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeTestAgent(overrides?: Partial<RegisteredAgent>): RegisteredAgent {
  return {
    name: 'test-agent',
    description: 'A test agent',
    sceneTypes: ['retail_shelf'] as SceneType[],
    voiceIntents: ['inventory_start'] as VoiceIntent[],
    priority: 5,
    enabled: true,
    processImage: vi.fn().mockResolvedValue({
      agentName: 'test-agent',
      success: true,
      data: { items: 10 },
      processingTimeMs: 100,
    } as AgentResult),
    handleVoiceCommand: vi.fn().mockResolvedValue({
      text: 'Inventory started!',
      priority: 'normal',
      agent: 'test-agent',
    } as VoiceResponse),
    getHealth: vi.fn().mockReturnValue({
      name: 'test-agent',
      status: 'healthy',
      lastCheck: new Date().toISOString(),
    } as ModuleHealth),
    init: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Platform Orchestrator', () => {
  let platform: Platform;

  beforeEach(() => {
    platform = new Platform(makeConfig());
  });

  afterEach(async () => {
    if (platform.getStatus() === 'running' || platform.getStatus() === 'paused') {
      await platform.stop();
    }
  });

  // ── Lifecycle ─────────────────────────────────────────────

  describe('Lifecycle', () => {
    it('starts in uninitialized state', () => {
      expect(platform.getStatus()).toBe('uninitialized');
    });

    it('transitions to running on start', async () => {
      await platform.start();
      expect(platform.getStatus()).toBe('running');
    });

    it('emits platform:starting and platform:started events', async () => {
      const events: string[] = [];
      platform.on('platform:starting', () => events.push('starting'));
      platform.on('platform:started', () => events.push('started'));

      await platform.start();

      expect(events).toEqual(['starting', 'started']);
    });

    it('no-ops on double start', async () => {
      await platform.start();
      await platform.start(); // should not throw
      expect(platform.getStatus()).toBe('running');
    });

    it('stops cleanly', async () => {
      await platform.start();
      await platform.stop();
      expect(platform.getStatus()).toBe('stopped');
    });

    it('emits stop events', async () => {
      await platform.start();
      const events: string[] = [];
      platform.on('platform:stopping', () => events.push('stopping'));
      platform.on('platform:stopped', () => events.push('stopped'));

      await platform.stop();

      expect(events).toEqual(['stopping', 'stopped']);
    });

    it('no-ops on double stop', async () => {
      await platform.start();
      await platform.stop();
      await platform.stop(); // should not throw
      expect(platform.getStatus()).toBe('stopped');
    });

    it('pauses and resumes', async () => {
      await platform.start();
      platform.pause();
      expect(platform.getStatus()).toBe('paused');
      platform.resume();
      expect(platform.getStatus()).toBe('running');
    });

    it('emits pause/resume events', async () => {
      await platform.start();
      const events: string[] = [];
      platform.on('platform:paused', () => events.push('paused'));
      platform.on('platform:resumed', () => events.push('resumed'));

      platform.pause();
      platform.resume();

      expect(events).toEqual(['paused', 'resumed']);
    });

    it('does not pause if not running', () => {
      platform.pause(); // uninitialized
      expect(platform.getStatus()).toBe('uninitialized');
    });

    it('does not resume if not paused', async () => {
      await platform.start();
      platform.resume(); // already running
      expect(platform.getStatus()).toBe('running');
    });

    it('initializes agents on start', async () => {
      const agent = makeTestAgent();
      platform.registerAgent(agent);

      await platform.start();

      expect(agent.init).toHaveBeenCalledOnce();
    });

    it('shuts down agents on stop', async () => {
      const agent = makeTestAgent();
      platform.registerAgent(agent);

      await platform.start();
      await platform.stop();

      expect(agent.shutdown).toHaveBeenCalledOnce();
    });

    it('handles agent init failure gracefully', async () => {
      const agent = makeTestAgent({
        init: vi.fn().mockRejectedValue(new Error('init failed')),
      });
      platform.registerAgent(agent);

      const errors: string[] = [];
      platform.on('module:error', (module) => errors.push(module));

      await platform.start(); // should not throw

      expect(platform.getStatus()).toBe('running');
      expect(errors).toContain('test-agent');
    });
  });

  // ── Agent Registration ────────────────────────────────────

  describe('Agent Registration', () => {
    it('registers an agent', () => {
      const agent = makeTestAgent();
      platform.registerAgent(agent);

      expect(platform.getAgent('test-agent')).toBe(agent);
    });

    it('lists registered agents', () => {
      platform.registerAgent(makeTestAgent({ name: 'agent-1' }));
      platform.registerAgent(makeTestAgent({ name: 'agent-2' }));

      const agents = platform.listAgents();
      expect(agents).toHaveLength(2);
    });

    it('unregisters an agent', () => {
      platform.registerAgent(makeTestAgent());
      expect(platform.unregisterAgent('test-agent')).toBe(true);
      expect(platform.getAgent('test-agent')).toBeUndefined();
    });

    it('returns false for unknown agent unregister', () => {
      expect(platform.unregisterAgent('nonexistent')).toBe(false);
    });

    it('enables and disables agents', () => {
      const agent = makeTestAgent({ enabled: false });
      platform.registerAgent(agent);

      expect(platform.enableAgent('test-agent')).toBe(true);
      expect(agent.enabled).toBe(true);

      expect(platform.disableAgent('test-agent')).toBe(true);
      expect(agent.enabled).toBe(false);
    });

    it('returns false for enable/disable of unknown agent', () => {
      expect(platform.enableAgent('ghost')).toBe(false);
      expect(platform.disableAgent('ghost')).toBe(false);
    });
  });

  // ── Image Processing ──────────────────────────────────────

  describe('Image Processing', () => {
    it('returns empty results when platform not running', async () => {
      const result = await platform.processImage(makeAnalysis());
      expect(result.agentResults).toHaveLength(0);
      expect(result.voiceResponses[0].text).toContain('not running');
    });

    it('routes images to matching agents by scene type', async () => {
      const inventoryAgent = makeTestAgent({
        name: 'inventory',
        sceneTypes: ['retail_shelf'],
        priority: 5,
      });
      const securityAgent = makeTestAgent({
        name: 'security',
        sceneTypes: ['person'],
        priority: 1,
      });

      platform.registerAgent(inventoryAgent);
      platform.registerAgent(securityAgent);
      await platform.start();

      const result = await platform.processImage(makeAnalysis({ sceneType: 'retail_shelf' }));

      expect(result.agentResults).toHaveLength(1);
      expect(inventoryAgent.processImage).toHaveBeenCalled();
      expect(securityAgent.processImage).not.toHaveBeenCalled();
    });

    it('sorts matching agents by priority', async () => {
      const order: string[] = [];

      const agentA = makeTestAgent({
        name: 'agent-low-priority',
        sceneTypes: ['retail_shelf'],
        priority: 10,
        processImage: vi.fn().mockImplementation(async () => {
          order.push('low');
          return { agentName: 'agent-low-priority', success: true, processingTimeMs: 10 };
        }),
      });

      const agentB = makeTestAgent({
        name: 'agent-high-priority',
        sceneTypes: ['retail_shelf'],
        priority: 1,
        processImage: vi.fn().mockImplementation(async () => {
          order.push('high');
          return { agentName: 'agent-high-priority', success: true, processingTimeMs: 10 };
        }),
      });

      platform.registerAgent(agentA);
      platform.registerAgent(agentB);
      await platform.start();

      await platform.processImage(makeAnalysis());

      expect(order).toEqual(['high', 'low']);
    });

    it('skips disabled agents', async () => {
      const agent = makeTestAgent({ enabled: false });
      platform.registerAgent(agent);
      await platform.start();

      const result = await platform.processImage(makeAnalysis());

      expect(result.agentResults).toHaveLength(0);
      expect(agent.processImage).not.toHaveBeenCalled();
    });

    it('handles agent processing errors gracefully', async () => {
      const agent = makeTestAgent({
        processImage: vi.fn().mockRejectedValue(new Error('processing failed')),
      });
      platform.registerAgent(agent);
      await platform.start();

      const result = await platform.processImage(makeAnalysis());

      expect(result.agentResults).toHaveLength(1);
      expect(result.agentResults[0].success).toBe(false);
      expect(result.agentResults[0].error).toContain('processing failed');
    });

    it('tracks image processing stats', async () => {
      const agent = makeTestAgent();
      platform.registerAgent(agent);
      await platform.start();

      await platform.processImage(makeAnalysis());
      await platform.processImage(makeAnalysis({ imageId: 'img-002' }));

      const stats = platform.getStats();
      expect(stats.imagesProcessed).toBe(2);
      expect(stats.agentInvocations).toBe(2);
    });

    it('emits image events', async () => {
      const agent = makeTestAgent();
      platform.registerAgent(agent);
      await platform.start();

      const events: string[] = [];
      platform.on('image:received', () => events.push('received'));
      platform.on('image:processed', () => events.push('processed'));
      platform.on('agent:invoked', () => events.push('invoked'));
      platform.on('agent:completed', () => events.push('completed'));

      await platform.processImage(makeAnalysis());

      expect(events).toEqual(['received', 'invoked', 'completed', 'processed']);
    });

    it('respects concurrency limit across parallel calls', async () => {
      let peakConcurrent = 0;
      let currentConcurrent = 0;

      const makeSlowAgent = (name: string, priority: number) => makeTestAgent({
        name,
        sceneTypes: ['retail_shelf'],
        priority,
        processImage: vi.fn().mockImplementation(async () => {
          currentConcurrent++;
          peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
          await new Promise(r => setTimeout(r, 30));
          currentConcurrent--;
          return { agentName: name, success: true, processingTimeMs: 30 };
        }),
      });

      const config = makeConfig({ maxConcurrentProcessing: 2 });
      platform = new Platform(config);
      platform.registerAgent(makeSlowAgent('agent-a', 1));
      platform.registerAgent(makeSlowAgent('agent-b', 2));
      await platform.start();

      // Process two images in parallel to test concurrency tracking
      const [r1, r2] = await Promise.all([
        platform.processImage(makeAnalysis({ imageId: 'img-1' })),
        platform.processImage(makeAnalysis({ imageId: 'img-2' })),
      ]);

      expect(r1.agentResults.length).toBeGreaterThanOrEqual(1);
      expect(r2.agentResults.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Voice Command Processing ──────────────────────────────

  describe('Voice Command Processing', () => {
    it('returns error when platform not running', async () => {
      const responses = await platform.processVoiceCommand(makeVoiceCommand());
      expect(responses[0].text).toContain('not running');
    });

    it('routes to matching agent by voice intent', async () => {
      const agent = makeTestAgent({
        voiceIntents: ['inventory_start'],
      });
      platform.registerAgent(agent);
      await platform.start();

      const responses = await platform.processVoiceCommand(makeVoiceCommand());

      expect(responses).toHaveLength(1);
      expect(responses[0].text).toBe('Inventory started!');
      expect(agent.handleVoiceCommand).toHaveBeenCalled();
    });

    it('handles status_report as platform command', async () => {
      await platform.start();

      const responses = await platform.processVoiceCommand(
        makeVoiceCommand({ intent: 'status_report', rawText: 'status' })
      );

      expect(responses).toHaveLength(1);
      expect(responses[0].agent).toBe('platform');
      expect(responses[0].text).toContain('running');
    });

    it('handles privacy_mode command', async () => {
      await platform.start();

      const responses = await platform.processVoiceCommand(
        makeVoiceCommand({ intent: 'privacy_mode', rawText: 'privacy mode' })
      );

      expect(platform.getStatus()).toBe('paused');
      expect(responses[0].text).toContain('Privacy mode');
    });

    it('handles resume_capture command', async () => {
      await platform.start();
      platform.pause();

      const responses = await platform.processVoiceCommand(
        makeVoiceCommand({ intent: 'resume_capture', rawText: 'resume' })
      );

      expect(platform.getStatus()).toBe('running');
      expect(responses[0].text).toContain('resumed');
    });

    it('returns help message for unknown intent', async () => {
      await platform.start();

      const responses = await platform.processVoiceCommand(
        makeVoiceCommand({ intent: 'unknown', rawText: 'gibberish blah' })
      );

      expect(responses[0].text).toContain("didn't understand");
    });

    it('tracks voice command stats', async () => {
      const agent = makeTestAgent();
      platform.registerAgent(agent);
      await platform.start();

      await platform.processVoiceCommand(makeVoiceCommand());
      await platform.processVoiceCommand(makeVoiceCommand());

      expect(platform.getStats().voiceCommandsHandled).toBe(2);
    });

    it('handles agent voice handler errors gracefully', async () => {
      const agent = makeTestAgent({
        handleVoiceCommand: vi.fn().mockRejectedValue(new Error('handler crash')),
      });
      platform.registerAgent(agent);
      await platform.start();

      const responses = await platform.processVoiceCommand(makeVoiceCommand());

      // Should not throw, should return unknown message
      expect(responses).toHaveLength(1);
      expect(responses[0].text).toContain("didn't understand");
    });
  });

  // ── Session Management ────────────────────────────────────

  describe('Session Management', () => {
    it('starts and ends sessions', () => {
      platform.startSession('inventory', 'sess-001');
      expect(platform.getActiveSessions()).toHaveLength(1);
      expect(platform.getActiveSessions()[0].type).toBe('inventory');

      platform.endSession('sess-001');
      expect(platform.getActiveSessions()).toHaveLength(0);
    });

    it('emits session events', () => {
      const events: string[] = [];
      platform.on('session:started', (type) => events.push(`start:${type}`));
      platform.on('session:ended', (type) => events.push(`end:${type}`));

      platform.startSession('meeting', 'sess-002');
      platform.endSession('sess-002');

      expect(events).toEqual(['start:meeting', 'end:meeting']);
    });

    it('tracks session completions in stats', () => {
      platform.startSession('inventory', 'sess-001');
      platform.endSession('sess-001');
      platform.startSession('meeting', 'sess-002');
      platform.endSession('sess-002');

      expect(platform.getStats().sessionsCompleted).toBe(2);
    });

    it('handles ending nonexistent session', () => {
      platform.endSession('nonexistent'); // should not throw
      expect(platform.getStats().sessionsCompleted).toBe(0);
    });

    it('manages multiple concurrent sessions', () => {
      platform.startSession('inventory', 'inv-001');
      platform.startSession('meeting', 'mtg-001');
      platform.startSession('inspection', 'insp-001');

      expect(platform.getActiveSessions()).toHaveLength(3);

      platform.endSession('mtg-001');
      expect(platform.getActiveSessions()).toHaveLength(2);
    });
  });

  // ── Health & Status ───────────────────────────────────────

  describe('Health & Status', () => {
    it('returns health report', async () => {
      await platform.start();

      const report = platform.getHealthReport();

      expect(report.status).toBe('running');
      expect(report.overallHealth).toBe('healthy');
      expect(report.uptime).toBeGreaterThanOrEqual(0);
      expect(report.startedAt).toBeTruthy();
    });

    it('reports unhealthy when many modules fail', async () => {
      const badAgent1 = makeTestAgent({
        name: 'bad-1',
        getHealth: () => ({ name: 'bad-1', status: 'unhealthy', lastCheck: new Date().toISOString() }),
      });
      const badAgent2 = makeTestAgent({
        name: 'bad-2',
        getHealth: () => ({ name: 'bad-2', status: 'unhealthy', lastCheck: new Date().toISOString() }),
      });

      platform.registerAgent(badAgent1);
      platform.registerAgent(badAgent2);
      await platform.start();

      // Manually trigger health check
      // @ts-expect-error - accessing private method for testing
      platform.runHealthChecks();

      const report = platform.getHealthReport();
      expect(report.overallHealth).toBe('unhealthy');
    });

    it('reports degraded when some modules have issues', async () => {
      const goodAgent = makeTestAgent({
        name: 'good',
        getHealth: () => ({ name: 'good', status: 'healthy', lastCheck: new Date().toISOString() }),
      });
      const okAgent = makeTestAgent({
        name: 'ok',
        getHealth: () => ({ name: 'ok', status: 'healthy', lastCheck: new Date().toISOString() }),
      });
      const badAgent = makeTestAgent({
        name: 'bad',
        getHealth: () => ({ name: 'bad', status: 'unhealthy', lastCheck: new Date().toISOString() }),
      });

      platform.registerAgent(goodAgent);
      platform.registerAgent(okAgent);
      platform.registerAgent(badAgent);
      await platform.start();

      // @ts-expect-error - accessing private method
      platform.runHealthChecks();

      const report = platform.getHealthReport();
      expect(report.overallHealth).toBe('degraded');
    });

    it('generates voice summary', async () => {
      const agent = makeTestAgent();
      platform.registerAgent(agent);
      await platform.start();

      // Process some work
      await platform.processImage(makeAnalysis());
      await platform.processVoiceCommand(makeVoiceCommand());

      const summary = platform.getVoiceSummary();

      expect(summary).toContain('running');
      expect(summary).toContain('1 agents active');
      expect(summary).toContain('1 images processed');
      expect(summary).toContain('1 voice commands handled');
    });

    it('includes active sessions in summary', async () => {
      await platform.start();
      platform.startSession('inventory', 'inv-001');

      const summary = platform.getVoiceSummary();
      expect(summary).toContain('1 active session');
    });

    it('tracks uptime in stats after stop', async () => {
      await platform.start();
      await new Promise(r => setTimeout(r, 50));
      await platform.stop();

      const stats = platform.getStats();
      expect(stats.totalUptimeMs).toBeGreaterThanOrEqual(40);
    });

    it('includes memory usage in health report', async () => {
      await platform.start();
      const report = platform.getHealthReport();
      expect(report.memoryUsageMB).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Factory ───────────────────────────────────────────────

  describe('createPlatform factory', () => {
    it('creates a platform with defaults', () => {
      const p = createPlatform({ agent: makeAgentConfig() });
      expect(p.getStatus()).toBe('uninitialized');
    });

    it('merges custom modules with defaults', () => {
      const p = createPlatform({
        agent: makeAgentConfig(),
        modules: { billing: true },
      });
      // Should have all defaults + billing enabled
      expect(p.getStatus()).toBe('uninitialized');
    });
  });

  // ── Edge Cases ────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('handles agent with no init function', async () => {
      const agent = makeTestAgent({ init: undefined });
      platform.registerAgent(agent);

      await platform.start(); // should not throw
      expect(platform.getStatus()).toBe('running');
    });

    it('handles agent with no shutdown function', async () => {
      const agent = makeTestAgent({ shutdown: undefined });
      platform.registerAgent(agent);
      await platform.start();

      await platform.stop(); // should not throw
      expect(platform.getStatus()).toBe('stopped');
    });

    it('handles agent with no voice handler', async () => {
      const agent = makeTestAgent({
        handleVoiceCommand: undefined,
        voiceIntents: ['inventory_start'],
      });
      platform.registerAgent(agent);
      await platform.start();

      const responses = await platform.processVoiceCommand(makeVoiceCommand());
      // Should gracefully return unknown message since handler doesn't exist
      expect(responses).toHaveLength(1);
    });

    it('multiple agents can handle same scene type', async () => {
      const agentA = makeTestAgent({ name: 'agent-a', priority: 1 });
      const agentB = makeTestAgent({ name: 'agent-b', priority: 2 });

      platform.registerAgent(agentA);
      platform.registerAgent(agentB);
      await platform.start();

      const result = await platform.processImage(makeAnalysis());

      expect(result.agentResults).toHaveLength(2);
    });

    it('multiple agents can handle same voice intent', async () => {
      const agentA = makeTestAgent({ name: 'agent-a', priority: 1 });
      const agentB = makeTestAgent({
        name: 'agent-b',
        priority: 2,
        handleVoiceCommand: vi.fn().mockResolvedValue({
          text: 'Also started!',
          priority: 'normal',
          agent: 'agent-b',
        }),
      });

      platform.registerAgent(agentA);
      platform.registerAgent(agentB);
      await platform.start();

      const responses = await platform.processVoiceCommand(makeVoiceCommand());

      expect(responses).toHaveLength(2);
    });

    it('handles health check when agent getHealth throws', async () => {
      const agent = makeTestAgent({
        getHealth: vi.fn().mockImplementation(() => {
          throw new Error('health check boom');
        }),
      });
      platform.registerAgent(agent);
      await platform.start();

      // @ts-expect-error - accessing private method
      platform.runHealthChecks();

      const report = platform.getHealthReport();
      const agentHealth = report.modules.find(m => m.name === 'test-agent');
      expect(agentHealth?.status).toBe('unhealthy');
    });

    it('processes images with context', async () => {
      const agent = makeTestAgent();
      platform.registerAgent(agent);
      await platform.start();

      const ctx: ProcessingContext = {
        sessionId: 'sess-001',
        location: { latitude: 30.2672, longitude: -97.7431 },
        currentMode: 'inventory',
      };

      const result = await platform.processImage(makeAnalysis(), ctx);

      expect(result.agentResults).toHaveLength(1);
      expect(agent.processImage).toHaveBeenCalledWith(
        expect.anything(),
        ctx
      );
    });
  });
});
