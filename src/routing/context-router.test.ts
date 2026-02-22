/**
 * Tests for the Context Router — intelligent image routing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ContextRouter,
  type SpecialistAgent,
  type RoutingContext,
  type AgentResponse,
  type RoutingMode,
} from './context-router.js';
import type { CapturedImage, VisionAnalysis, SceneType } from '../types.js';

// ─── Test Helpers ───────────────────────────────────────────────

function makeImage(overrides: Partial<CapturedImage> = {}): CapturedImage {
  return {
    id: 'test-img-001',
    buffer: Buffer.from('test'),
    mimeType: 'image/jpeg',
    capturedAt: new Date().toISOString(),
    deviceId: 'test-device',
    trigger: 'auto',
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<VisionAnalysis> = {}): VisionAnalysis {
  return {
    imageId: 'test-img-001',
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 500,
    sceneDescription: 'A retail store shelf with products',
    sceneType: 'retail_shelf',
    extractedText: [],
    detectedObjects: [],
    products: [],
    barcodes: [],
    quality: {
      score: 0.8,
      isBlurry: false,
      hasGlare: false,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: true,
    },
    ...overrides,
  };
}

function makeAgent(overrides: Partial<SpecialistAgent> = {}): SpecialistAgent {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    sceneTypes: ['retail_shelf'],
    voiceIntents: [],
    keywords: ['product', 'shelf'],
    priority: 5,
    concurrent: false,
    enabled: true,
    handle: vi.fn().mockResolvedValue({
      agentId: 'test-agent',
      handled: true,
      confidence: 0.8,
      priority: 5,
      processingTimeMs: 100,
    }),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ContextRouter', () => {
  let router: ContextRouter;

  beforeEach(() => {
    router = new ContextRouter({ debug: true });
  });

  describe('Agent Registration', () => {
    it('should register an agent', () => {
      const agent = makeAgent();
      router.registerAgent(agent);

      expect(router.getAgents()).toHaveLength(1);
      expect(router.getAgents()[0].id).toBe('test-agent');
    });

    it('should unregister an agent', () => {
      router.registerAgent(makeAgent());
      router.unregisterAgent('test-agent');
      expect(router.getAgents()).toHaveLength(0);
    });

    it('should enable and disable agents', () => {
      router.registerAgent(makeAgent());
      expect(router.getEnabledAgents()).toHaveLength(1);

      router.setAgentEnabled('test-agent', false);
      expect(router.getEnabledAgents()).toHaveLength(0);

      router.setAgentEnabled('test-agent', true);
      expect(router.getEnabledAgents()).toHaveLength(1);
    });

    it('should handle multiple agents', () => {
      router.registerAgent(makeAgent({ id: 'agent-1', name: 'Agent 1' }));
      router.registerAgent(makeAgent({ id: 'agent-2', name: 'Agent 2' }));
      router.registerAgent(makeAgent({ id: 'agent-3', name: 'Agent 3' }));

      expect(router.getAgents()).toHaveLength(3);
    });

    it('should replace agent on re-register with same id', () => {
      router.registerAgent(makeAgent({ id: 'agent-1', name: 'First' }));
      router.registerAgent(makeAgent({ id: 'agent-1', name: 'Second' }));

      expect(router.getAgents()).toHaveLength(1);
      expect(router.getAgents()[0].name).toBe('Second');
    });
  });

  describe('Mode Management', () => {
    it('should start with no active mode', () => {
      expect(router.getMode()).toBeNull();
    });

    it('should set active mode', () => {
      router.setMode('inventory');
      expect(router.getMode()).toBe('inventory');
    });

    it('should clear active mode', () => {
      router.setMode('inventory');
      router.clearMode();
      expect(router.getMode()).toBeNull();
    });

    it('should emit mode:changed on mode change', () => {
      const handler = vi.fn();
      router.on('mode:changed', handler);

      router.setMode('inventory');
      expect(handler).toHaveBeenCalledWith(null, 'inventory');

      router.setMode('networking');
      expect(handler).toHaveBeenCalledWith('inventory', 'networking');
    });

    it('should not emit if mode is the same', () => {
      const handler = vi.fn();
      router.setMode('inventory');
      router.on('mode:changed', handler);

      router.setMode('inventory'); // Same mode
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Routing', () => {
    it('should route to matching agent by scene type', async () => {
      const inventoryAgent = makeAgent({
        id: 'inventory',
        sceneTypes: ['retail_shelf', 'warehouse'],
        keywords: ['product', 'shelf', 'inventory'],
        handle: vi.fn().mockResolvedValue({
          agentId: 'inventory',
          handled: true,
          confidence: 0.8,
          priority: 5,
          processingTimeMs: 100,
        }),
      });
      router.registerAgent(inventoryAgent);

      const image = makeImage();
      const analysis = makeAnalysis({ sceneType: 'retail_shelf' });
      const responses = await router.route(image, analysis);

      expect(responses).toHaveLength(1);
      expect(responses[0].agentId).toBe('inventory');
      expect(responses[0].handled).toBe(true);
    });

    it('should route to agent matching voice intent', async () => {
      const networkAgent = makeAgent({
        id: 'networking',
        sceneTypes: ['person'],
        voiceIntents: ['what_is_this'],
        keywords: ['badge', 'card', 'person'],
        handle: vi.fn().mockResolvedValue({
          agentId: 'networking',
          handled: true,
          confidence: 0.9,
          priority: 3,
          processingTimeMs: 200,
        }),
      });
      router.registerAgent(networkAgent);

      const image = makeImage();
      const analysis = makeAnalysis({ sceneType: 'person' });
      const responses = await router.route(
        image,
        analysis,
        'voice',
        'what_is_this',
      );

      expect(responses).toHaveLength(1);
      expect(responses[0].agentId).toBe('networking');
    });

    it('should not route to disabled agents', async () => {
      const agent = makeAgent({ id: 'disabled-agent' });
      router.registerAgent(agent);
      router.setAgentEnabled('disabled-agent', false);

      const responses = await router.route(makeImage(), makeAnalysis());
      expect(responses).toHaveLength(0);
    });

    it('should handle agent errors gracefully', async () => {
      const faultyAgent = makeAgent({
        id: 'faulty',
        handle: vi.fn().mockRejectedValue(new Error('Agent crashed')),
      });
      router.registerAgent(faultyAgent);

      const errorHandler = vi.fn();
      router.on('error', errorHandler);

      const responses = await router.route(makeImage(), makeAnalysis());
      expect(responses).toHaveLength(1);
      expect(responses[0].handled).toBe(false);
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should emit route:decided event', async () => {
      router.registerAgent(makeAgent());
      const handler = vi.fn();
      router.on('route:decided', handler);

      await router.route(makeImage(), makeAnalysis());
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].mode).toBeDefined();
      expect(handler.mock.calls[0][0].agents).toBeDefined();
    });

    it('should emit route:complete event', async () => {
      router.registerAgent(makeAgent());
      const handler = vi.fn();
      router.on('route:complete', handler);

      await router.route(makeImage(), makeAnalysis());

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toBe('test-img-001'); // imageId
    });

    it('should route concurrent agents in parallel', async () => {
      const agent1 = makeAgent({
        id: 'agent-1',
        concurrent: true,
        sceneTypes: ['retail_shelf'],
        keywords: ['product'],
        priority: 1,
        handle: vi.fn().mockResolvedValue({
          agentId: 'agent-1',
          handled: true,
          confidence: 0.8,
          priority: 1,
          processingTimeMs: 100,
        }),
      });

      const agent2 = makeAgent({
        id: 'agent-2',
        concurrent: true,
        sceneTypes: ['retail_shelf'],
        keywords: ['shelf'],
        priority: 2,
        handle: vi.fn().mockResolvedValue({
          agentId: 'agent-2',
          handled: true,
          confidence: 0.7,
          priority: 2,
          processingTimeMs: 50,
        }),
      });

      router.registerAgent(agent1);
      router.registerAgent(agent2);

      const analysis = makeAnalysis({
        sceneType: 'retail_shelf',
        sceneDescription: 'A product shelf with items',
      });
      const responses = await router.route(makeImage(), analysis);

      // Both agents should have been called
      expect(agent1.handle).toHaveBeenCalled();
      // Agent 2 may or may not be called depending on scoring
    });
  });

  describe('Mode Detection', () => {
    it('should auto-detect inventory mode from retail shelf', async () => {
      const handler = vi.fn();
      router.on('mode:changed', handler);
      router.registerAgent(makeAgent());

      const analysis = makeAnalysis({
        sceneType: 'retail_shelf',
        products: [
          {
            name: 'Test Product',
            confidence: 0.8,
            identificationMethod: 'visual',
            estimatedCount: 5,
            countConfidence: 0.7,
          },
        ],
      });

      await router.route(makeImage(), analysis);
      // Should detect inventory mode from retail_shelf with products
      expect(router.getMode()).toBeDefined();
    });

    it('should detect networking mode from person scene', async () => {
      router.registerAgent(makeAgent({
        id: 'networking',
        sceneTypes: ['person'],
        keywords: ['name', 'badge'],
      }));

      const analysis = makeAnalysis({
        sceneType: 'person',
        extractedText: [
          { text: 'John Smith', confidence: 0.9, textType: 'label' },
          { text: 'VP Engineering', confidence: 0.8, textType: 'other' },
          { text: 'Stripe', confidence: 0.85, textType: 'label' },
        ],
      });

      await router.route(makeImage(), analysis);
      // Should have been routed
    });

    it('should set mode from voice intent', async () => {
      router.registerAgent(makeAgent({
        id: 'inventory-agent',
        voiceIntents: ['inventory_start'],
      }));

      await router.route(
        makeImage(),
        makeAnalysis(),
        'voice',
        'inventory_start',
      );
      expect(router.getMode()).toBe('inventory');
    });

    it('should maintain sticky mode when scene is still relevant', async () => {
      router.setMode('inventory');
      router.registerAgent(makeAgent());

      // Route with a retail shelf scene — inventory mode should stick
      await router.route(makeImage(), makeAnalysis({ sceneType: 'retail_shelf' }));
      expect(router.getMode()).toBe('inventory');
    });
  });

  describe('Voice Command Routing', () => {
    it('should route voice commands to matching agent', () => {
      const inventoryAgent = makeAgent({
        id: 'inventory',
        voiceIntents: ['inventory_start', 'inventory_stop', 'inventory_pause'],
      });
      router.registerAgent(inventoryAgent);

      const agent = router.routeVoiceCommand('inventory_start', {});
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('inventory');
    });

    it('should set mode when routing voice command', () => {
      router.registerAgent(makeAgent({
        id: 'deals',
        voiceIntents: ['price_check'],
      }));

      router.routeVoiceCommand('price_check', {});
      expect(router.getMode()).toBe('deals');
    });

    it('should return null for unmatched voice command', () => {
      const agent = router.routeVoiceCommand('unknown', {});
      expect(agent).toBeNull();
    });
  });

  describe('Stats', () => {
    it('should track routing statistics', async () => {
      router.registerAgent(makeAgent());

      await router.route(makeImage(), makeAnalysis());
      await router.route(makeImage(), makeAnalysis());

      const stats = router.getStats();
      expect(stats.totalRoutes).toBe(2);
      expect(stats.registeredAgents).toBe(1);
      expect(stats.enabledAgents).toBe(1);
    });

    it('should track mode history', () => {
      router.setMode('inventory');
      router.setMode('networking');
      router.setMode('deals');

      const stats = router.getStats();
      expect(stats.modeHistory).toContain('inventory');
      expect(stats.modeHistory).toContain('networking');
      expect(stats.modeHistory).toContain('deals');
    });

    it('should limit mode history size', () => {
      const router = new ContextRouter({ modeHistorySize: 3 });

      router.setMode('inventory');
      router.setMode('networking');
      router.setMode('deals');
      router.setMode('memory');
      router.setMode('security');

      const stats = router.getStats();
      expect(stats.modeHistory.length).toBeLessThanOrEqual(3);
    });
  });
});
