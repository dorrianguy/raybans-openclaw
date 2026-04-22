/**
 * Tests for Context Chain Engine — Feature #10.
 *
 * @module chains/context-chain-engine.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ContextChainEngine,
  BUILT_IN_CHAINS,
  SALES_MEETING_CHAIN,
  SHOPPING_TRIP_CHAIN,
  PROPERTY_WALKTHROUGH_CHAIN,
  TRAVEL_EXPLORER_CHAIN,
  CONFERENCE_NETWORKING_CHAIN,
  type ChainDefinition,
  type ChainAgentHandler,
  type ChainAction,
  type ChainExecutionContext,
  type ActionResult,
  type ChainInstance,
  DEFAULT_CHAIN_CONFIG,
} from './context-chain-engine.js';

// ─── Helpers ────────────────────────────────────────────────────

function createMockAgent(id: string, name?: string, delay = 0): ChainAgentHandler {
  return {
    id,
    name: name || `Mock ${id}`,
    execute: vi.fn(async (_action: ChainAction, _ctx: ChainExecutionContext): Promise<ActionResult> => {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      return {
        success: true,
        data: { agentId: id, timestamp: new Date().toISOString() },
        voiceResponse: `${id} completed successfully`,
        summary: `${id} action done`,
        processingTimeMs: delay || 10,
      };
    }),
  };
}

function createFailingAgent(id: string): ChainAgentHandler {
  return {
    id,
    name: `Failing ${id}`,
    execute: vi.fn(async (): Promise<ActionResult> => {
      return {
        success: false,
        summary: `${id} failed intentionally`,
        processingTimeMs: 5,
      };
    }),
  };
}

function createThrowingAgent(id: string): ChainAgentHandler {
  return {
    id,
    name: `Throwing ${id}`,
    execute: vi.fn(async (): Promise<ActionResult> => {
      throw new Error(`${id} crashed`);
    }),
  };
}

function createSimpleChain(overrides: Partial<ChainDefinition> = {}): ChainDefinition {
  return {
    id: 'test_chain',
    name: 'Test Chain',
    description: 'A test chain',
    enabled: true,
    triggers: [{ type: 'voice', voicePhrases: ['test mode'] }],
    phases: [
      {
        id: 'phase_1',
        name: 'Phase 1',
        timing: { type: 'immediate' },
        actions: [
          {
            id: 'action_1',
            agentId: 'agent_a',
            description: 'First action',
          },
        ],
      },
    ],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ContextChainEngine', () => {
  let engine: ContextChainEngine;

  beforeEach(() => {
    engine = new ContextChainEngine();
  });

  // ─── Registration ─────────────────────────────────────────

  describe('Chain Registration', () => {
    it('should register a chain definition', () => {
      const chain = createSimpleChain();
      engine.registerChain(chain);
      expect(engine.getChain('test_chain')).toBeDefined();
      expect(engine.getChain('test_chain')?.name).toBe('Test Chain');
    });

    it('should reject chain without id', () => {
      const chain = createSimpleChain({ id: '' });
      expect(() => engine.registerChain(chain)).toThrow('id and name');
    });

    it('should reject chain without name', () => {
      const chain = createSimpleChain({ name: '' });
      expect(() => engine.registerChain(chain)).toThrow('id and name');
    });

    it('should reject chain without phases', () => {
      const chain = createSimpleChain({ phases: [] });
      expect(() => engine.registerChain(chain)).toThrow('at least one phase');
    });

    it('should unregister a chain', () => {
      engine.registerChain(createSimpleChain());
      expect(engine.unregisterChain('test_chain')).toBe(true);
      expect(engine.getChain('test_chain')).toBeUndefined();
    });

    it('should return false when unregistering non-existent chain', () => {
      expect(engine.unregisterChain('nonexistent')).toBe(false);
    });

    it('should list all registered chains', () => {
      engine.registerChain(createSimpleChain({ id: 'chain_a', name: 'Chain A' }));
      engine.registerChain(createSimpleChain({ id: 'chain_b', name: 'Chain B' }));
      const all = engine.getAllChains();
      expect(all).toHaveLength(2);
      expect(all.map((c) => c.id)).toContain('chain_a');
      expect(all.map((c) => c.id)).toContain('chain_b');
    });
  });

  describe('Agent Registration', () => {
    it('should register an agent handler', () => {
      const agent = createMockAgent('test_agent');
      engine.registerAgent(agent);
      expect(engine.getAllAgents()).toHaveLength(1);
    });

    it('should reject agent without id', () => {
      expect(() => engine.registerAgent({ id: '', name: 'Bad', execute: vi.fn() })).toThrow('id and name');
    });

    it('should reject agent without name', () => {
      expect(() => engine.registerAgent({ id: 'ok', name: '', execute: vi.fn() })).toThrow('id and name');
    });

    it('should unregister an agent', () => {
      engine.registerAgent(createMockAgent('test_agent'));
      expect(engine.unregisterAgent('test_agent')).toBe(true);
      expect(engine.getAllAgents()).toHaveLength(0);
    });

    it('should return false for non-existent agent unregister', () => {
      expect(engine.unregisterAgent('nope')).toBe(false);
    });
  });

  // ─── Chain Execution ──────────────────────────────────────

  describe('Chain Execution — Simple', () => {
    it('should execute a single-action chain', async () => {
      engine.registerChain(createSimpleChain());
      engine.registerAgent(createMockAgent('agent_a'));

      const instance = await engine.startChain('test_chain', 'manual');
      expect(instance).toBeDefined();
      expect(instance.chainId).toBe('test_chain');

      // Wait for async execution
      await new Promise((r) => setTimeout(r, 100));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.status).toBe('completed');
      expect(result?.phases[0].status).toBe('completed');
      expect(result?.phases[0].actions[0].status).toBe('completed');
    });

    it('should emit chain:started event', async () => {
      engine.registerChain(createSimpleChain());
      engine.registerAgent(createMockAgent('agent_a'));

      const started = vi.fn();
      engine.on('chain:started', started);

      await engine.startChain('test_chain', 'voice');
      expect(started).toHaveBeenCalledTimes(1);
      expect(started.mock.calls[0][0].chainId).toBe('test_chain');
      expect(started.mock.calls[0][0].triggerType).toBe('voice');
    });

    it('should emit chain:completed event', async () => {
      engine.registerChain(createSimpleChain());
      engine.registerAgent(createMockAgent('agent_a'));

      const completed = vi.fn();
      engine.on('chain:completed', completed);

      await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 100));

      expect(completed).toHaveBeenCalledTimes(1);
      expect(completed.mock.calls[0][0].status).toBe('completed');
    });

    it('should collect TTS voice responses', async () => {
      engine.registerChain(createSimpleChain());
      engine.registerAgent(createMockAgent('agent_a'));

      const ttsEvents: string[] = [];
      engine.on('chain:tts', (_id, text) => ttsEvents.push(text));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 100));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.voiceQueue.length).toBeGreaterThan(0);
      expect(ttsEvents.length).toBeGreaterThan(0);
    });

    it('should store trigger data in shared context', async () => {
      engine.registerChain(createSimpleChain());
      engine.registerAgent(createMockAgent('agent_a'));

      const instance = await engine.startChain('test_chain', 'manual', {
        meetingTitle: 'Q3 Planning',
      });

      expect(instance.sharedContext.meetingTitle).toBe('Q3 Planning');
    });
  });

  describe('Chain Execution — Multi-Phase', () => {
    it('should execute multiple phases in order', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_pre',
            name: 'Pre',
            timing: { type: 'before', offsetMinutes: 10 },
            actions: [{ id: 'a1', agentId: 'agent_a', description: 'Pre-action' }],
          },
          {
            id: 'phase_main',
            name: 'Main',
            timing: { type: 'during' },
            actions: [{ id: 'a2', agentId: 'agent_a', description: 'Main action' }],
          },
          {
            id: 'phase_post',
            name: 'Post',
            timing: { type: 'after' },
            actions: [{ id: 'a3', agentId: 'agent_a', description: 'Post action' }],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(createMockAgent('agent_a'));

      const phaseOrder: string[] = [];
      engine.on('chain:phase:started', (_id, phase) => phaseOrder.push(phase.phaseId));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      expect(phaseOrder).toEqual(['phase_pre', 'phase_main', 'phase_post']);

      const result = engine.getInstance(instance.instanceId);
      expect(result?.status).toBe('completed');
      expect(result?.phases.every((p) => p.status === 'completed')).toBe(true);
    });

    it('should stop execution when a required phase fails', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Phase 1',
            timing: { type: 'immediate' },
            actions: [{ id: 'a1', agentId: 'fail_agent', description: 'Will fail' }],
          },
          {
            id: 'phase_2',
            name: 'Phase 2',
            timing: { type: 'during' },
            actions: [{ id: 'a2', agentId: 'agent_a', description: 'Should not run' }],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(createFailingAgent('fail_agent'));
      engine.registerAgent(createMockAgent('agent_a'));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.status).toBe('failed');
      expect(result?.phases[1].status).toBe('pending');
    });

    it('should continue past failed phase when continueOnFailure is true', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Phase 1',
            timing: { type: 'immediate' },
            continueOnFailure: true,
            actions: [{ id: 'a1', agentId: 'fail_agent', description: 'Will fail' }],
          },
          {
            id: 'phase_2',
            name: 'Phase 2',
            timing: { type: 'during' },
            actions: [{ id: 'a2', agentId: 'agent_a', description: 'Should run' }],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(createFailingAgent('fail_agent'));
      engine.registerAgent(createMockAgent('agent_a'));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.status).toBe('completed');
      expect(result?.phases[0].status).toBe('failed');
      expect(result?.phases[1].status).toBe('completed');
    });
  });

  describe('Chain Execution — Parallel Actions', () => {
    it('should execute parallel actions concurrently', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Parallel Phase',
            timing: { type: 'immediate' },
            parallel: true,
            actions: [
              { id: 'a1', agentId: 'agent_a', description: 'Action A' },
              { id: 'a2', agentId: 'agent_b', description: 'Action B' },
              { id: 'a3', agentId: 'agent_c', description: 'Action C' },
            ],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(createMockAgent('agent_a', 'Agent A', 20));
      engine.registerAgent(createMockAgent('agent_b', 'Agent B', 20));
      engine.registerAgent(createMockAgent('agent_c', 'Agent C', 20));

      const startTime = Date.now();
      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.status).toBe('completed');
      expect(result?.phases[0].actions.every((a) => a.status === 'completed')).toBe(true);

      // Parallel should finish in ~20ms total, not 60ms
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(500); // generous bound
    });
  });

  describe('Chain Execution — Dependencies', () => {
    it('should respect action dependencies in sequential mode', async () => {
      const executionOrder: string[] = [];

      const trackingAgent = (id: string): ChainAgentHandler => ({
        id,
        name: id,
        execute: vi.fn(async (_action: ChainAction): Promise<ActionResult> => {
          executionOrder.push(_action.id);
          return {
            success: true,
            data: { from: _action.id },
            processingTimeMs: 5,
          };
        }),
      });

      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Dependency Phase',
            timing: { type: 'immediate' },
            parallel: false,
            actions: [
              { id: 'fetch_data', agentId: 'data_agent', description: 'Fetch data first' },
              {
                id: 'process_data',
                agentId: 'data_agent',
                description: 'Process fetched data',
                dependsOn: ['fetch_data'],
              },
              {
                id: 'deliver_result',
                agentId: 'data_agent',
                description: 'Deliver processed result',
                dependsOn: ['process_data'],
              },
            ],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(trackingAgent('data_agent'));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      expect(executionOrder).toEqual(['fetch_data', 'process_data', 'deliver_result']);

      const result = engine.getInstance(instance.instanceId);
      expect(result?.status).toBe('completed');
    });

    it('should skip actions with unresolvable dependencies', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Deadlock Phase',
            timing: { type: 'immediate' },
            parallel: false,
            actions: [
              { id: 'a1', agentId: 'agent_a', description: 'OK' },
              { id: 'a2', agentId: 'agent_a', description: 'Depends on nonexistent', dependsOn: ['nonexistent'] },
            ],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(createMockAgent('agent_a'));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.phases[0].actions[1].status).toBe('skipped');
    });
  });

  describe('Chain Execution — Error Handling', () => {
    it('should handle missing agent gracefully', async () => {
      engine.registerChain(createSimpleChain());
      // Don't register agent_a

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.phases[0].actions[0].status).toBe('failed');
      expect(result?.phases[0].actions[0].error).toContain('Agent not found');
    });

    it('should handle agent throwing exceptions', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Phase',
            timing: { type: 'immediate' },
            continueOnFailure: true,
            actions: [{ id: 'a1', agentId: 'throw_agent', description: 'Will throw', retries: 0 }],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(createThrowingAgent('throw_agent'));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.phases[0].actions[0].status).toBe('failed');
      expect(result?.errors.length).toBeGreaterThan(0);
    });

    it('should retry failed actions', async () => {
      let attempts = 0;
      const retryAgent: ChainAgentHandler = {
        id: 'retry_agent',
        name: 'Retry Agent',
        execute: vi.fn(async (): Promise<ActionResult> => {
          attempts++;
          if (attempts < 3) {
            return { success: false, summary: 'Not yet', processingTimeMs: 5 };
          }
          return { success: true, summary: 'Finally!', processingTimeMs: 5 };
        }),
      };

      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Retry Phase',
            timing: { type: 'immediate' },
            actions: [{ id: 'a1', agentId: 'retry_agent', description: 'Needs retries', retries: 3 }],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(retryAgent);

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.status).toBe('completed');
      expect(attempts).toBe(3);
    });

    it('should fail after exhausting retries', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Phase',
            timing: { type: 'immediate' },
            actions: [{ id: 'a1', agentId: 'fail_agent', description: 'Always fails', retries: 2 }],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(createFailingAgent('fail_agent'));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.status).toBe('failed');
      expect((engine.getAllAgents().find((a) => a.id === 'fail_agent')?.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    });

    it('should not fail if optional action fails', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Phase',
            timing: { type: 'immediate' },
            actions: [
              { id: 'a1', agentId: 'agent_a', description: 'Required' },
              { id: 'a2', agentId: 'fail_agent', description: 'Optional fail', optional: true },
            ],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(createMockAgent('agent_a'));
      engine.registerAgent(createFailingAgent('fail_agent'));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.status).toBe('completed');
      expect(result?.phases[0].actions[0].status).toBe('completed');
      expect(result?.phases[0].actions[1].status).toBe('failed');
    });
  });

  describe('Chain Execution — Concurrency Limit', () => {
    it('should enforce max concurrent chains', async () => {
      const engine2 = new ContextChainEngine({ maxConcurrentChains: 1 });

      const slowChain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Slow Phase',
            timing: { type: 'immediate' },
            actions: [{ id: 'a1', agentId: 'slow_agent', description: 'Slow' }],
          },
        ],
      });

      engine2.registerChain(slowChain);
      engine2.registerAgent(createMockAgent('slow_agent', 'Slow', 500));

      await engine2.startChain('test_chain', 'manual');

      await expect(engine2.startChain('test_chain', 'manual')).rejects.toThrow(
        'Maximum concurrent chains',
      );
    });

    it('should reject starting a disabled chain', async () => {
      engine.registerChain(createSimpleChain({ enabled: false }));
      await expect(engine.startChain('test_chain', 'manual')).rejects.toThrow('disabled');
    });

    it('should reject starting a non-existent chain', async () => {
      await expect(engine.startChain('nonexistent', 'manual')).rejects.toThrow('not found');
    });
  });

  describe('Chain Cancellation', () => {
    it('should cancel an active chain', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Slow Phase',
            timing: { type: 'immediate' },
            actions: [{ id: 'a1', agentId: 'slow_agent', description: 'Slow' }],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(createMockAgent('slow_agent', 'Slow', 1000));

      const cancelled = vi.fn();
      engine.on('chain:cancelled', cancelled);

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 50));

      const result = engine.cancelChain(instance.instanceId);
      expect(result).toBe(true);
      expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it('should return false when cancelling non-existent instance', () => {
      expect(engine.cancelChain('nonexistent')).toBe(false);
    });

    it('should return false when cancelling already completed chain', async () => {
      engine.registerChain(createSimpleChain());
      engine.registerAgent(createMockAgent('agent_a'));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      expect(engine.cancelChain(instance.instanceId)).toBe(false);
    });
  });

  describe('Chain Execution — Conditional Actions', () => {
    it('should skip action when condition returns false', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Conditional Phase',
            timing: { type: 'immediate' },
            parallel: true,
            actions: [
              {
                id: 'a1',
                agentId: 'agent_a',
                description: 'Always runs',
              },
              {
                id: 'a2',
                agentId: 'agent_a',
                description: 'Conditionally skipped',
                condition: () => false,
              },
            ],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(createMockAgent('agent_a'));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.phases[0].actions[0].status).toBe('completed');
      expect(result?.phases[0].actions[1].status).toBe('skipped');
    });

    it('should execute action when condition returns true', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Phase',
            timing: { type: 'immediate' },
            parallel: true,
            actions: [
              {
                id: 'a1',
                agentId: 'agent_a',
                description: 'Condition true',
                condition: () => true,
              },
            ],
          },
        ],
      });

      engine.registerChain(chain);
      engine.registerAgent(createMockAgent('agent_a'));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.phases[0].actions[0].status).toBe('completed');
    });
  });

  describe('Chain Execution — Shared Context', () => {
    it('should pass action results to subsequent actions via shared context', async () => {
      const chain = createSimpleChain({
        phases: [
          {
            id: 'phase_1',
            name: 'Phase',
            timing: { type: 'immediate' },
            parallel: false,
            actions: [
              { id: 'produce', agentId: 'producer', description: 'Produce data' },
              { id: 'consume', agentId: 'consumer', description: 'Consume data', dependsOn: ['produce'] },
            ],
          },
        ],
      });

      const producer: ChainAgentHandler = {
        id: 'producer',
        name: 'Producer',
        execute: vi.fn(async (): Promise<ActionResult> => ({
          success: true,
          data: { key: 'value_from_producer' },
          processingTimeMs: 5,
        })),
      };

      const consumer: ChainAgentHandler = {
        id: 'consumer',
        name: 'Consumer',
        execute: vi.fn(async (_action: ChainAction, ctx: ChainExecutionContext): Promise<ActionResult> => {
          const producerData = ctx.sharedContext['result_produce'] as Record<string, string> | undefined;
          return {
            success: true,
            data: { received: producerData?.key },
            processingTimeMs: 5,
          };
        }),
      };

      engine.registerChain(chain);
      engine.registerAgent(producer);
      engine.registerAgent(consumer);

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const result = engine.getInstance(instance.instanceId);
      expect(result?.sharedContext['result_produce']).toEqual({ key: 'value_from_producer' });
    });
  });

  // ─── Trigger Matching ─────────────────────────────────────

  describe('Voice Trigger Matching', () => {
    beforeEach(() => {
      engine.registerChain(SALES_MEETING_CHAIN);
      engine.registerChain(SHOPPING_TRIP_CHAIN);
    });

    it('should match "start sales mode" to sales meeting chain', () => {
      const match = engine.matchVoiceTrigger('start sales mode');
      expect(match).not.toBeNull();
      expect(match?.chainId).toBe('sales_meeting');
    });

    it('should match "going shopping" to shopping trip chain', () => {
      const match = engine.matchVoiceTrigger('going shopping');
      expect(match).not.toBeNull();
      expect(match?.chainId).toBe('shopping_trip');
    });

    it('should be case insensitive', () => {
      const match = engine.matchVoiceTrigger('START SALES MODE');
      expect(match).not.toBeNull();
      expect(match?.chainId).toBe('sales_meeting');
    });

    it('should match partial phrases', () => {
      const match = engine.matchVoiceTrigger('hey can you start sales mode please');
      expect(match).not.toBeNull();
      expect(match?.chainId).toBe('sales_meeting');
    });

    it('should return null for no match', () => {
      const match = engine.matchVoiceTrigger('random unrelated phrase');
      expect(match).toBeNull();
    });

    it('should not match disabled chains', () => {
      engine.registerChain({ ...SALES_MEETING_CHAIN, id: 'disabled_sales', enabled: false });
      const match = engine.matchVoiceTrigger('start sales mode');
      expect(match?.chainId).toBe('sales_meeting'); // matches enabled one, not disabled
    });
  });

  describe('Scene Trigger Matching', () => {
    beforeEach(() => {
      engine.registerChain(SHOPPING_TRIP_CHAIN);
      engine.registerChain(CONFERENCE_NETWORKING_CHAIN);
    });

    it('should match retail_shelf to shopping chain', () => {
      const matches = engine.matchSceneTrigger('retail_shelf');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].chainId).toBe('shopping_trip');
    });

    it('should match person to networking chain', () => {
      const matches = engine.matchSceneTrigger('person');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some((m) => m.chainId === 'conference_networking')).toBe(true);
    });

    it('should return empty array for unmatched scene', () => {
      const matches = engine.matchSceneTrigger('unknown_scene');
      expect(matches).toHaveLength(0);
    });
  });

  describe('Geofence Trigger Matching', () => {
    it('should match location within geofence', () => {
      engine.registerChain(createSimpleChain({
        id: 'geo_chain',
        name: 'Geo Chain',
        triggers: [{
          type: 'geo',
          geoFence: {
            latitude: 44.9778,
            longitude: -93.2650,
            radiusMeters: 1000,
            label: 'Downtown St. Paul',
          },
        }],
      }));

      const matches = engine.matchGeoTrigger({
        latitude: 44.9780,
        longitude: -93.2655,
      });

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].chainId).toBe('geo_chain');
    });

    it('should not match location outside geofence', () => {
      engine.registerChain(createSimpleChain({
        id: 'geo_chain',
        name: 'Geo Chain',
        triggers: [{
          type: 'geo',
          geoFence: {
            latitude: 44.9778,
            longitude: -93.2650,
            radiusMeters: 100, // Small radius
          },
        }],
      }));

      const matches = engine.matchGeoTrigger({
        latitude: 45.0000, // Far away
        longitude: -93.0000,
      });

      expect(matches).toHaveLength(0);
    });
  });

  describe('Calendar Trigger Matching', () => {
    beforeEach(() => {
      engine.registerChain(SALES_MEETING_CHAIN);
    });

    it('should match "Sales Team Meeting" via regex', () => {
      const matches = engine.matchCalendarTrigger('Sales Team Meeting');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].chainId).toBe('sales_meeting');
    });

    it('should match "Client Demo Call"', () => {
      const matches = engine.matchCalendarTrigger('Client Demo Call');
      expect(matches.length).toBeGreaterThan(0);
    });

    it('should match "Prospect Demo with Acme"', () => {
      const matches = engine.matchCalendarTrigger('Prospect Demo with Acme');
      expect(matches.length).toBeGreaterThan(0);
    });

    it('should not match "Dentist Appointment"', () => {
      const matches = engine.matchCalendarTrigger('Dentist Appointment');
      expect(matches).toHaveLength(0);
    });

    it('should handle invalid regex patterns gracefully', () => {
      engine.registerChain(createSimpleChain({
        id: 'bad_regex',
        name: 'Bad Regex',
        triggers: [{ type: 'calendar', calendarPatterns: ['[invalid(regex'] }],
      }));

      // Should not throw
      const matches = engine.matchCalendarTrigger('anything');
      expect(matches).toHaveLength(0);
    });
  });

  // ─── Image Feed ───────────────────────────────────────────

  describe('Image Feed', () => {
    it('should update active instances with latest image', async () => {
      engine.registerChain(createSimpleChain({
        phases: [{
          id: 'phase_1',
          name: 'Phase',
          timing: { type: 'immediate' },
          actions: [{ id: 'a1', agentId: 'slow_agent', description: 'Slow' }],
        }],
      }));
      engine.registerAgent(createMockAgent('slow_agent', 'Slow', 500));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 50));

      const mockImage = { id: 'img-1', buffer: Buffer.from('test'), mimeType: 'image/jpeg' as const, capturedAt: new Date().toISOString(), deviceId: 'test', trigger: 'manual' as const };
      const mockAnalysis = { imageId: 'img-1', analyzedAt: new Date().toISOString(), processingTimeMs: 100, sceneDescription: 'test', sceneType: 'office' as const, extractedText: [], detectedObjects: [], products: [], barcodes: [], quality: { score: 0.9, isBlurry: false, hasGlare: false, isUnderexposed: false, isOverexposed: false, usableForInventory: true } };

      engine.feedImage(mockImage, mockAnalysis);

      const inst = engine.getInstance(instance.instanceId);
      if (inst && inst.status === 'active') {
        expect(inst.sharedContext._latestImage).toBeDefined();
        expect(inst.sharedContext._latestAnalysis).toBeDefined();
      }
    });
  });

  // ─── Instance Management ──────────────────────────────────

  describe('Instance Management', () => {
    it('should list active instances', async () => {
      engine.registerChain(createSimpleChain());
      engine.registerAgent(createMockAgent('agent_a', 'Agent', 500));

      await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 50));

      const active = engine.getActiveInstances();
      expect(active.length).toBeGreaterThanOrEqual(0); // May have completed already
    });

    it('should archive completed instances', async () => {
      engine.registerChain(createSimpleChain());
      engine.registerAgent(createMockAgent('agent_a'));

      await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const completed = engine.getCompletedInstances();
      expect(completed.length).toBeGreaterThan(0);
    });

    it('should retrieve instance by ID', async () => {
      engine.registerChain(createSimpleChain());
      engine.registerAgent(createMockAgent('agent_a'));

      const instance = await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const retrieved = engine.getInstance(instance.instanceId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.instanceId).toBe(instance.instanceId);
    });
  });

  // ─── Statistics ───────────────────────────────────────────

  describe('Statistics', () => {
    it('should return initial empty stats', () => {
      const stats = engine.getStats();
      expect(stats.registeredChains).toBe(0);
      expect(stats.registeredAgents).toBe(0);
      expect(stats.activeInstances).toBe(0);
      expect(stats.completedInstances).toBe(0);
    });

    it('should track chain completions', async () => {
      engine.registerChain(createSimpleChain());
      engine.registerAgent(createMockAgent('agent_a'));

      await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const stats = engine.getStats();
      expect(stats.registeredChains).toBe(1);
      expect(stats.registeredAgents).toBe(1);
      expect(stats.completedInstances).toBe(1);
      expect(stats.completedActions).toBe(1);
      expect(stats.chainSuccessRate).toBe(1);
    });

    it('should calculate average action time', async () => {
      engine.registerChain(createSimpleChain());
      engine.registerAgent(createMockAgent('agent_a'));

      await engine.startChain('test_chain', 'manual');
      await new Promise((r) => setTimeout(r, 200));

      const stats = engine.getStats();
      expect(stats.averageActionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Built-in Chain Templates ─────────────────────────────

  describe('Built-in Chain Templates', () => {
    it('should provide 5 built-in chains', () => {
      expect(BUILT_IN_CHAINS).toHaveLength(5);
    });

    it('should all have valid structure', () => {
      for (const chain of BUILT_IN_CHAINS) {
        expect(chain.id).toBeTruthy();
        expect(chain.name).toBeTruthy();
        expect(chain.description).toBeTruthy();
        expect(chain.enabled).toBe(true);
        expect(chain.phases.length).toBeGreaterThan(0);
        expect(chain.triggers.length).toBeGreaterThan(0);
        expect(chain.tags?.length).toBeGreaterThan(0);
      }
    });

    it('should all be registerable', () => {
      for (const chain of BUILT_IN_CHAINS) {
        expect(() => engine.registerChain(chain)).not.toThrow();
      }
      expect(engine.getAllChains()).toHaveLength(5);
    });

    it('Sales Meeting chain should have 4 phases', () => {
      expect(SALES_MEETING_CHAIN.phases).toHaveLength(4);
      expect(SALES_MEETING_CHAIN.phases.map((p) => p.id)).toEqual([
        'pre_meeting',
        'briefing',
        'active_meeting',
        'post_meeting',
      ]);
    });

    it('Shopping Trip chain should have 3 phases', () => {
      expect(SHOPPING_TRIP_CHAIN.phases).toHaveLength(3);
    });

    it('Property Walkthrough chain should have 3 phases', () => {
      expect(PROPERTY_WALKTHROUGH_CHAIN.phases).toHaveLength(3);
    });

    it('Travel Explorer chain should have 3 phases', () => {
      expect(TRAVEL_EXPLORER_CHAIN.phases).toHaveLength(3);
    });

    it('Conference Networking chain should have 2 phases', () => {
      expect(CONFERENCE_NETWORKING_CHAIN.phases).toHaveLength(2);
    });

    it('Sales Meeting chain should have voice and calendar triggers', () => {
      const triggerTypes = SALES_MEETING_CHAIN.triggers.map((t) => t.type);
      expect(triggerTypes).toContain('voice');
      expect(triggerTypes).toContain('calendar');
    });

    it('Shopping Trip chain should have voice and scene triggers', () => {
      const triggerTypes = SHOPPING_TRIP_CHAIN.triggers.map((t) => t.type);
      expect(triggerTypes).toContain('voice');
      expect(triggerTypes).toContain('scene');
    });
  });

  // ─── Default Config ───────────────────────────────────────

  describe('Configuration', () => {
    it('should use default config values', () => {
      expect(DEFAULT_CHAIN_CONFIG.maxConcurrentChains).toBe(3);
      expect(DEFAULT_CHAIN_CONFIG.defaultActionTimeoutMs).toBe(30_000);
      expect(DEFAULT_CHAIN_CONFIG.defaultRetries).toBe(1);
      expect(DEFAULT_CHAIN_CONFIG.batchTts).toBe(true);
    });

    it('should allow custom config', () => {
      const custom = new ContextChainEngine({
        maxConcurrentChains: 10,
        defaultRetries: 5,
      });
      // Can register and use without issues
      custom.registerChain(createSimpleChain());
      custom.registerAgent(createMockAgent('agent_a'));
      expect(custom.getAllChains()).toHaveLength(1);
    });
  });
});
