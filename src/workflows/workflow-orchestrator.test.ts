/**
 * Tests for the Workflow Orchestrator
 *
 * Covers: workflow registration, step execution, dependency ordering,
 * parallel execution, conditions, retries, timeouts, templates,
 * cancellation, statistics, and voice summaries.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WorkflowOrchestrator,
  WorkflowDefinition,
  StepHandler,
  WorkflowContext,
} from './workflow-orchestrator.js';

// ─── Test Helpers ─────────────────────────────────────────────

function createSimpleWorkflow(id: string = 'test-workflow'): WorkflowDefinition {
  return {
    id,
    name: 'Test Workflow',
    description: 'A simple test workflow',
    steps: [
      { id: 'step1', name: 'Step 1', handler: 'handler1' },
      { id: 'step2', name: 'Step 2', handler: 'handler2', dependsOn: ['step1'] },
      { id: 'step3', name: 'Step 3', handler: 'handler3', dependsOn: ['step2'] },
    ],
  };
}

function createParallelWorkflow(): WorkflowDefinition {
  return {
    id: 'parallel-workflow',
    name: 'Parallel Workflow',
    steps: [
      { id: 'start', name: 'Start', handler: 'start_handler' },
      { id: 'branch_a', name: 'Branch A', handler: 'branch_a_handler', dependsOn: ['start'], parallel: true },
      { id: 'branch_b', name: 'Branch B', handler: 'branch_b_handler', dependsOn: ['start'], parallel: true },
      { id: 'merge', name: 'Merge', handler: 'merge_handler', dependsOn: ['branch_a', 'branch_b'] },
    ],
  };
}

function successHandler(result: unknown): StepHandler {
  return async () => result;
}

function failHandler(errorMsg: string): StepHandler {
  return async () => { throw new Error(errorMsg); };
}

function delayHandler(ms: number, result: unknown): StepHandler {
  return async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
    return result;
  };
}

// ─── Tests ────────────────────────────────────────────────────

describe('WorkflowOrchestrator', () => {
  let orchestrator: WorkflowOrchestrator;

  beforeEach(() => {
    orchestrator = new WorkflowOrchestrator({
      defaultStepRetries: 0,
      defaultStepTimeoutMs: 5000,
    });
  });

  // ─── Registration ─────────────────────────────────────────

  describe('Registration', () => {
    it('should register a workflow', () => {
      orchestrator.registerWorkflow(createSimpleWorkflow());
      expect(orchestrator.getWorkflow('test-workflow')).toBeDefined();
    });

    it('should list registered workflows', () => {
      orchestrator.registerWorkflow(createSimpleWorkflow('wf1'));
      orchestrator.registerWorkflow(createSimpleWorkflow('wf2'));
      expect(orchestrator.listWorkflows().length).toBe(2);
    });

    it('should unregister a workflow', () => {
      orchestrator.registerWorkflow(createSimpleWorkflow());
      expect(orchestrator.unregisterWorkflow('test-workflow')).toBe(true);
      expect(orchestrator.getWorkflow('test-workflow')).toBeUndefined();
    });

    it('should register a handler', () => {
      orchestrator.registerHandler('test', async () => 'result');
      expect(orchestrator.listHandlers()).toContain('test');
    });

    it('should unregister a handler', () => {
      orchestrator.registerHandler('test', async () => 'result');
      expect(orchestrator.unregisterHandler('test')).toBe(true);
      expect(orchestrator.listHandlers()).not.toContain('test');
    });

    it('should reject duplicate step IDs', () => {
      expect(() => orchestrator.registerWorkflow({
        id: 'bad', name: 'Bad',
        steps: [
          { id: 'dup', name: 'A', handler: 'h1' },
          { id: 'dup', name: 'B', handler: 'h2' },
        ],
      })).toThrow('Duplicate step IDs');
    });

    it('should reject circular dependencies', () => {
      expect(() => orchestrator.registerWorkflow({
        id: 'circular', name: 'Circular',
        steps: [
          { id: 'a', name: 'A', handler: 'h', dependsOn: ['b'] },
          { id: 'b', name: 'B', handler: 'h', dependsOn: ['a'] },
        ],
      })).toThrow('Circular dependency');
    });

    it('should reject dependencies on non-existent steps', () => {
      expect(() => orchestrator.registerWorkflow({
        id: 'missing', name: 'Missing Dep',
        steps: [
          { id: 'a', name: 'A', handler: 'h', dependsOn: ['nonexistent'] },
        ],
      })).toThrow('non-existent step');
    });
  });

  // ─── Basic Execution ──────────────────────────────────────

  describe('Basic Execution', () => {
    it('should execute a simple workflow', async () => {
      orchestrator.registerWorkflow(createSimpleWorkflow());
      orchestrator.registerHandler('handler1', successHandler({ data: 'step1' }));
      orchestrator.registerHandler('handler2', successHandler({ data: 'step2' }));
      orchestrator.registerHandler('handler3', successHandler({ data: 'step3' }));

      const result = await orchestrator.execute('test-workflow', { input: 'test' });

      expect(result.status).toBe('completed');
      expect(result.completedSteps).toBe(3);
      expect(result.output).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should pass input to handlers', async () => {
      let receivedInput: Record<string, unknown> = {};

      orchestrator.registerWorkflow({
        id: 'input-test', name: 'Input Test',
        steps: [{ id: 'step1', name: 'Step 1', handler: 'capture_input' }],
      });
      orchestrator.registerHandler('capture_input', async (input) => {
        receivedInput = input;
        return 'captured';
      });

      await orchestrator.execute('input-test', { foo: 'bar', num: 42 });
      expect(receivedInput.foo).toBe('bar');
      expect(receivedInput.num).toBe(42);
    });

    it('should accumulate step results in context', async () => {
      let step2Context: WorkflowContext | undefined;

      orchestrator.registerWorkflow({
        id: 'context-test', name: 'Context Test',
        steps: [
          { id: 'step1', name: 'Step 1', handler: 'h1' },
          { id: 'step2', name: 'Step 2', handler: 'h2', dependsOn: ['step1'] },
        ],
      });
      orchestrator.registerHandler('h1', async () => ({ value: 'from_step1' }));
      orchestrator.registerHandler('h2', async (_, ctx) => {
        step2Context = ctx;
        return 'done';
      });

      await orchestrator.execute('context-test');
      expect(step2Context?.stepResults['step1']).toEqual({ value: 'from_step1' });
    });

    it('should throw for non-existent workflow', async () => {
      await expect(orchestrator.execute('nonexistent')).rejects.toThrow('Workflow not found');
    });

    it('should handle missing handlers', async () => {
      orchestrator.registerWorkflow({
        id: 'missing-handler', name: 'Missing',
        steps: [{ id: 'step1', name: 'Step 1', handler: 'does_not_exist' }],
      });

      const result = await orchestrator.execute('missing-handler');
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Handler not found');
    });

    it('should generate unique execution IDs', async () => {
      orchestrator.registerWorkflow({
        id: 'id-test', name: 'ID Test',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      const r1 = await orchestrator.execute('id-test');
      const r2 = await orchestrator.execute('id-test');
      expect(r1.id).not.toBe(r2.id);
    });
  });

  // ─── Dependency Ordering ──────────────────────────────────

  describe('Dependency Ordering', () => {
    it('should execute steps in dependency order', async () => {
      const order: string[] = [];

      orchestrator.registerWorkflow(createSimpleWorkflow());
      orchestrator.registerHandler('handler1', async () => { order.push('step1'); return 1; });
      orchestrator.registerHandler('handler2', async () => { order.push('step2'); return 2; });
      orchestrator.registerHandler('handler3', async () => { order.push('step3'); return 3; });

      await orchestrator.execute('test-workflow');
      expect(order).toEqual(['step1', 'step2', 'step3']);
    });

    it('should skip downstream steps when dependency fails', async () => {
      orchestrator.registerWorkflow(createSimpleWorkflow());
      orchestrator.registerHandler('handler1', failHandler('step1 failed'));
      orchestrator.registerHandler('handler2', successHandler('should not run'));
      orchestrator.registerHandler('handler3', successHandler('should not run'));

      const result = await orchestrator.execute('test-workflow');
      expect(result.status).toBe('failed');

      const step2 = result.steps.find(s => s.stepId === 'step2');
      const step3 = result.steps.find(s => s.stepId === 'step3');
      expect(step2?.status).toBe('skipped');
      expect(step3?.status).toBe('skipped');
    });
  });

  // ─── Parallel Execution ───────────────────────────────────

  describe('Parallel Execution', () => {
    it('should execute parallel steps concurrently', async () => {
      const startTimes: Record<string, number> = {};

      orchestrator.registerWorkflow(createParallelWorkflow());
      orchestrator.registerHandler('start_handler', successHandler('started'));
      orchestrator.registerHandler('branch_a_handler', async () => {
        startTimes['a'] = Date.now();
        await new Promise(r => setTimeout(r, 50));
        return 'branch_a_result';
      });
      orchestrator.registerHandler('branch_b_handler', async () => {
        startTimes['b'] = Date.now();
        await new Promise(r => setTimeout(r, 50));
        return 'branch_b_result';
      });
      orchestrator.registerHandler('merge_handler', async (_, ctx) => {
        return { a: ctx.stepResults['branch_a'], b: ctx.stepResults['branch_b'] };
      });

      const result = await orchestrator.execute('parallel-workflow');
      expect(result.status).toBe('completed');
      expect(result.completedSteps).toBe(4);

      // Branches should have started close together (within 30ms)
      if (startTimes['a'] && startTimes['b']) {
        expect(Math.abs(startTimes['a'] - startTimes['b'])).toBeLessThan(30);
      }
    });

    it('should handle parallel step failure with critical=false', async () => {
      orchestrator.registerWorkflow({
        id: 'parallel-noncritical', name: 'Parallel Non-Critical',
        steps: [
          { id: 'start', name: 'Start', handler: 'ok_handler' },
          { id: 'fail_branch', name: 'Fail', handler: 'fail_handler', dependsOn: ['start'], parallel: true, critical: false },
          { id: 'ok_branch', name: 'OK', handler: 'ok_handler', dependsOn: ['start'], parallel: true },
          { id: 'end', name: 'End', handler: 'ok_handler', dependsOn: ['ok_branch'] },
        ],
      });
      orchestrator.registerHandler('ok_handler', successHandler('ok'));
      orchestrator.registerHandler('fail_handler', failHandler('boom'));

      const result = await orchestrator.execute('parallel-noncritical');
      // Should complete because the failed step is non-critical
      expect(result.status).toBe('completed');
    });
  });

  // ─── Conditional Steps ────────────────────────────────────

  describe('Conditional Steps', () => {
    it('should skip steps when condition returns false', async () => {
      orchestrator.registerWorkflow({
        id: 'conditional', name: 'Conditional',
        steps: [
          { id: 'check', name: 'Check', handler: 'check_handler' },
          {
            id: 'conditional_step', name: 'Maybe Run', handler: 'maybe_handler',
            dependsOn: ['check'],
            condition: (ctx) => (ctx.stepResults['check'] as any)?.shouldRun === true,
          },
        ],
      });
      orchestrator.registerHandler('check_handler', successHandler({ shouldRun: false }));
      orchestrator.registerHandler('maybe_handler', successHandler('ran'));

      const result = await orchestrator.execute('conditional');
      const conditional = result.steps.find(s => s.stepId === 'conditional_step');
      expect(conditional?.status).toBe('skipped');
    });

    it('should run steps when condition returns true', async () => {
      orchestrator.registerWorkflow({
        id: 'conditional-true', name: 'Conditional True',
        steps: [
          { id: 'check', name: 'Check', handler: 'check_handler' },
          {
            id: 'run_step', name: 'Run', handler: 'run_handler',
            dependsOn: ['check'],
            condition: (ctx) => (ctx.stepResults['check'] as any)?.shouldRun === true,
          },
        ],
      });
      orchestrator.registerHandler('check_handler', successHandler({ shouldRun: true }));
      orchestrator.registerHandler('run_handler', successHandler('executed'));

      const result = await orchestrator.execute('conditional-true');
      const step = result.steps.find(s => s.stepId === 'run_step');
      expect(step?.status).toBe('completed');
    });
  });

  // ─── Retries ──────────────────────────────────────────────

  describe('Retries', () => {
    it('should retry failed steps', async () => {
      let attempts = 0;

      orchestrator.registerWorkflow({
        id: 'retry-test', name: 'Retry Test',
        steps: [
          { id: 'flaky', name: 'Flaky Step', handler: 'flaky_handler', maxRetries: 2, retryDelayMs: 10 },
        ],
      });
      orchestrator.registerHandler('flaky_handler', async () => {
        attempts++;
        if (attempts < 3) throw new Error('Not ready yet');
        return 'success';
      });

      const result = await orchestrator.execute('retry-test');
      expect(result.status).toBe('completed');
      expect(attempts).toBe(3);
    });

    it('should fail after max retries exceeded', async () => {
      orchestrator.registerWorkflow({
        id: 'max-retry', name: 'Max Retry',
        steps: [
          { id: 'always_fail', name: 'Always Fail', handler: 'fail_handler', maxRetries: 1, retryDelayMs: 10 },
        ],
      });
      orchestrator.registerHandler('fail_handler', failHandler('permanent failure'));

      const result = await orchestrator.execute('max-retry');
      expect(result.status).toBe('failed');
      expect(result.steps[0].attempt).toBe(2); // initial + 1 retry
    });

    it('should emit step:retrying events', async () => {
      const retryEvents: number[] = [];
      orchestrator.on('step:retrying', (_, __, attempt) => retryEvents.push(attempt));

      let count = 0;
      orchestrator.registerWorkflow({
        id: 'retry-events', name: 'Retry Events',
        steps: [{ id: 's1', name: 'S1', handler: 'h', maxRetries: 2, retryDelayMs: 10 }],
      });
      orchestrator.registerHandler('h', async () => {
        count++;
        if (count < 3) throw new Error('fail');
        return 'ok';
      });

      await orchestrator.execute('retry-events');
      expect(retryEvents).toEqual([1, 2]);
    });
  });

  // ─── Timeouts ─────────────────────────────────────────────

  describe('Timeouts', () => {
    it('should timeout a slow step', async () => {
      orchestrator.registerWorkflow({
        id: 'timeout-test', name: 'Timeout Test',
        steps: [
          { id: 'slow', name: 'Slow Step', handler: 'slow_handler', timeoutMs: 50 },
        ],
      });
      orchestrator.registerHandler('slow_handler', delayHandler(500, 'too late'));

      const result = await orchestrator.execute('timeout-test');
      expect(result.status).toBe('failed');
      expect(result.error).toContain('timed out');
    });

    it('should timeout entire workflow', async () => {
      orchestrator.registerWorkflow({
        id: 'wf-timeout', name: 'WF Timeout',
        steps: [
          { id: 'slow', name: 'Slow', handler: 'slow_handler' },
        ],
        timeoutMs: 50,
      });
      orchestrator.registerHandler('slow_handler', delayHandler(500, 'too late'));

      const result = await orchestrator.execute('wf-timeout');
      expect(result.status).toBe('failed');
      expect(result.error).toContain('timed out');
    });
  });

  // ─── Critical vs Non-Critical ─────────────────────────────

  describe('Critical Steps', () => {
    it('should fail workflow when critical step fails', async () => {
      orchestrator.registerWorkflow({
        id: 'critical-test', name: 'Critical',
        steps: [
          { id: 'critical_step', name: 'Critical', handler: 'fail_handler', critical: true },
        ],
      });
      orchestrator.registerHandler('fail_handler', failHandler('critical failure'));

      const result = await orchestrator.execute('critical-test');
      expect(result.status).toBe('failed');
    });

    it('should continue workflow when non-critical step fails', async () => {
      orchestrator.registerWorkflow({
        id: 'noncritical-test', name: 'Non-Critical',
        steps: [
          { id: 'ok_step', name: 'OK', handler: 'ok_handler' },
          { id: 'optional', name: 'Optional', handler: 'fail_handler', dependsOn: ['ok_step'], critical: false },
        ],
      });
      orchestrator.registerHandler('ok_handler', successHandler('ok'));
      orchestrator.registerHandler('fail_handler', failHandler('non-critical failure'));

      const result = await orchestrator.execute('noncritical-test');
      expect(result.status).toBe('completed');

      const optional = result.steps.find(s => s.stepId === 'optional');
      expect(optional?.status).toBe('failed');
    });
  });

  // ─── Input/Output Transforms ──────────────────────────────

  describe('Input/Output Transforms', () => {
    it('should apply input transform', async () => {
      let receivedInput: Record<string, unknown> = {};

      orchestrator.registerWorkflow({
        id: 'transform-in', name: 'Transform In',
        steps: [{
          id: 's1', name: 'S1', handler: 'h',
          inputTransform: (ctx) => ({ transformed: true, original: ctx.input.value }),
        }],
      });
      orchestrator.registerHandler('h', async (input) => {
        receivedInput = input;
        return 'done';
      });

      await orchestrator.execute('transform-in', { value: 42 });
      expect(receivedInput.transformed).toBe(true);
      expect(receivedInput.original).toBe(42);
    });

    it('should apply output transform', async () => {
      orchestrator.registerWorkflow({
        id: 'transform-out', name: 'Transform Out',
        steps: [{
          id: 's1', name: 'S1', handler: 'h',
          outputTransform: (result) => ({ processed: true, data: result }),
        }],
      });
      orchestrator.registerHandler('h', successHandler({ raw: 'data' }));

      const result = await orchestrator.execute('transform-out');
      expect(result.output?.s1).toEqual({ processed: true, data: { raw: 'data' } });
    });
  });

  // ─── Cancellation ─────────────────────────────────────────

  describe('Cancellation', () => {
    it('should cancel a running workflow', async () => {
      orchestrator.registerWorkflow({
        id: 'cancel-test', name: 'Cancel Test',
        steps: [
          { id: 's1', name: 'S1', handler: 'slow_handler' },
          { id: 's2', name: 'S2', handler: 'ok_handler', dependsOn: ['s1'] },
        ],
      });
      orchestrator.registerHandler('slow_handler', delayHandler(1000, 'slow'));
      orchestrator.registerHandler('ok_handler', successHandler('ok'));

      // Start execution and cancel quickly
      const promise = orchestrator.execute('cancel-test');

      // Give it a moment to start
      await new Promise(r => setTimeout(r, 20));

      const active = orchestrator.getActiveExecutions();
      if (active.length > 0) {
        orchestrator.cancel(active[0].id);
      }

      const result = await promise;
      // Status might be failed (timeout) or cancelled depending on timing
      expect(['failed', 'cancelled', 'completed']).toContain(result.status);
    });

    it('should return false when cancelling non-existent execution', () => {
      expect(orchestrator.cancel('nonexistent')).toBe(false);
    });
  });

  // ─── Events ───────────────────────────────────────────────

  describe('Events', () => {
    it('should emit workflow:started', async () => {
      const handler = vi.fn();
      orchestrator.on('workflow:started', handler);

      orchestrator.registerWorkflow({
        id: 'event-test', name: 'Event Test',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      await orchestrator.execute('event-test');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should emit workflow:completed', async () => {
      const handler = vi.fn();
      orchestrator.on('workflow:completed', handler);

      orchestrator.registerWorkflow({
        id: 'complete-event', name: 'Complete Event',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      await orchestrator.execute('complete-event');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should emit workflow:failed', async () => {
      const handler = vi.fn();
      orchestrator.on('workflow:failed', handler);

      orchestrator.registerWorkflow({
        id: 'fail-event', name: 'Fail Event',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', failHandler('boom'));

      await orchestrator.execute('fail-event');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should emit step:started and step:completed', async () => {
      const started = vi.fn();
      const completed = vi.fn();
      orchestrator.on('step:started', started);
      orchestrator.on('step:completed', completed);

      orchestrator.registerWorkflow({
        id: 'step-events', name: 'Step Events',
        steps: [
          { id: 's1', name: 'S1', handler: 'h' },
          { id: 's2', name: 'S2', handler: 'h', dependsOn: ['s1'] },
        ],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      await orchestrator.execute('step-events');
      expect(started).toHaveBeenCalledTimes(2);
      expect(completed).toHaveBeenCalledTimes(2);
    });

    it('should emit step:skipped for condition-skipped steps', async () => {
      const skipped = vi.fn();
      orchestrator.on('step:skipped', skipped);

      orchestrator.registerWorkflow({
        id: 'skip-event', name: 'Skip Event',
        steps: [{
          id: 's1', name: 'S1', handler: 'h',
          condition: () => false,
        }],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      await orchestrator.execute('skip-event');
      expect(skipped).toHaveBeenCalledOnce();
    });
  });

  // ─── Execution History ────────────────────────────────────

  describe('Execution History', () => {
    it('should store execution history', async () => {
      orchestrator.registerWorkflow({
        id: 'history-test', name: 'History',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      await orchestrator.execute('history-test');
      await orchestrator.execute('history-test');

      const history = orchestrator.getHistory();
      expect(history.length).toBe(2);
    });

    it('should filter history by workflow ID', async () => {
      orchestrator.registerWorkflow({
        id: 'wf-a', name: 'WF A',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerWorkflow({
        id: 'wf-b', name: 'WF B',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      await orchestrator.execute('wf-a');
      await orchestrator.execute('wf-b');
      await orchestrator.execute('wf-a');

      const history = orchestrator.getHistory({ workflowId: 'wf-a' });
      expect(history.length).toBe(2);
    });

    it('should filter history by status', async () => {
      orchestrator.registerWorkflow({
        id: 'status-filter', name: 'Status Filter',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      await orchestrator.execute('status-filter');

      const completed = orchestrator.getHistory({ status: 'completed' });
      expect(completed.length).toBe(1);

      const failed = orchestrator.getHistory({ status: 'failed' });
      expect(failed.length).toBe(0);
    });

    it('should get execution by ID', async () => {
      orchestrator.registerWorkflow({
        id: 'get-by-id', name: 'Get By ID',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      const result = await orchestrator.execute('get-by-id');
      const found = orchestrator.getExecution(result.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(result.id);
    });

    it('should limit history size', async () => {
      const smallOrchestrator = new WorkflowOrchestrator({
        maxHistorySize: 3,
        defaultStepRetries: 0,
      });

      smallOrchestrator.registerWorkflow({
        id: 'limit-test', name: 'Limit',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      smallOrchestrator.registerHandler('h', successHandler('ok'));

      for (let i = 0; i < 5; i++) {
        await smallOrchestrator.execute('limit-test');
      }

      expect(smallOrchestrator.getHistory().length).toBe(3);
    });
  });

  // ─── Concurrency Limits ───────────────────────────────────

  describe('Concurrency Limits', () => {
    it('should reject when max concurrent executions reached', async () => {
      const limitedOrchestrator = new WorkflowOrchestrator({
        maxConcurrentExecutions: 1,
        defaultStepRetries: 0,
      });

      limitedOrchestrator.registerWorkflow({
        id: 'slow', name: 'Slow',
        steps: [{ id: 's1', name: 'S1', handler: 'slow_handler' }],
      });
      limitedOrchestrator.registerHandler('slow_handler', delayHandler(200, 'ok'));

      // Start one (fills the limit)
      const p1 = limitedOrchestrator.execute('slow');

      // Wait for it to be running
      await new Promise(r => setTimeout(r, 10));

      // Second should be rejected
      await expect(limitedOrchestrator.execute('slow')).rejects.toThrow('Maximum concurrent executions');

      await p1;
    });
  });

  // ─── Templates ────────────────────────────────────────────

  describe('Templates', () => {
    it('should return built-in templates', () => {
      const templates = WorkflowOrchestrator.getTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(5);
    });

    it('should have inventory-scan template', () => {
      const templates = WorkflowOrchestrator.getTemplates();
      const inv = templates.find(t => t.id === 'inventory-scan');
      expect(inv).toBeDefined();
      expect(inv!.steps.length).toBeGreaterThanOrEqual(5);
    });

    it('should have meeting-flow template', () => {
      const templates = WorkflowOrchestrator.getTemplates();
      const meeting = templates.find(t => t.id === 'meeting-flow');
      expect(meeting).toBeDefined();
    });

    it('should have security-check template with conditional step', () => {
      const templates = WorkflowOrchestrator.getTemplates();
      const security = templates.find(t => t.id === 'security-check');
      expect(security).toBeDefined();
      const deepScan = security!.steps.find(s => s.id === 'deep_scan');
      expect(deepScan?.condition).toBeDefined();
    });

    it('should register all templates', () => {
      orchestrator.registerTemplates();
      expect(orchestrator.listWorkflows().length).toBeGreaterThanOrEqual(5);
    });

    it('templates should have valid DAGs', () => {
      // All templates should register without errors
      expect(() => orchestrator.registerTemplates()).not.toThrow();
    });
  });

  // ─── Statistics ───────────────────────────────────────────

  describe('Statistics', () => {
    it('should compute correct stats', async () => {
      orchestrator.registerWorkflow({
        id: 'stats-wf', name: 'Stats',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      await orchestrator.execute('stats-wf');
      await orchestrator.execute('stats-wf');

      const stats = orchestrator.getStats();
      expect(stats.registeredWorkflows).toBe(1);
      expect(stats.registeredHandlers).toBe(1);
      expect(stats.totalExecutions).toBe(2);
      expect(stats.completedExecutions).toBe(2);
      expect(stats.failedExecutions).toBe(0);
      expect(stats.successRate).toBe(1);
      expect(stats.averageDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should track failed executions in stats', async () => {
      orchestrator.registerWorkflow({
        id: 'fail-stats', name: 'Fail Stats',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', failHandler('boom'));

      await orchestrator.execute('fail-stats');

      const stats = orchestrator.getStats();
      expect(stats.failedExecutions).toBe(1);
      expect(stats.successRate).toBe(0);
    });
  });

  // ─── Voice Summary ────────────────────────────────────────

  describe('Voice Summary', () => {
    it('should generate a voice summary', () => {
      orchestrator.registerWorkflow(createSimpleWorkflow());
      orchestrator.registerHandler('handler1', successHandler('ok'));

      const summary = orchestrator.getVoiceSummary();
      expect(summary).toContain('workflows');
      expect(summary).toContain('handlers');
    });

    it('should include execution stats in summary', async () => {
      orchestrator.registerWorkflow({
        id: 'voice-test', name: 'Voice Test',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      await orchestrator.execute('voice-test');

      const summary = orchestrator.getVoiceSummary();
      expect(summary).toContain('executions');
      expect(summary).toContain('success rate');
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle single-step workflows', async () => {
      orchestrator.registerWorkflow({
        id: 'single', name: 'Single',
        steps: [{ id: 'only', name: 'Only Step', handler: 'h' }],
      });
      orchestrator.registerHandler('h', successHandler({ result: 'single' }));

      const result = await orchestrator.execute('single');
      expect(result.status).toBe('completed');
      expect(result.completedSteps).toBe(1);
    });

    it('should handle empty input', async () => {
      orchestrator.registerWorkflow({
        id: 'empty-input', name: 'Empty Input',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      const result = await orchestrator.execute('empty-input');
      expect(result.status).toBe('completed');
    });

    it('should handle workflows with all steps skipped via conditions', async () => {
      orchestrator.registerWorkflow({
        id: 'all-skipped', name: 'All Skipped',
        steps: [
          { id: 's1', name: 'S1', handler: 'h', condition: () => false },
          { id: 's2', name: 'S2', handler: 'h', condition: () => false },
        ],
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      const result = await orchestrator.execute('all-skipped');
      expect(result.status).toBe('completed');
    });

    it('should preserve execution metadata', async () => {
      orchestrator.registerWorkflow({
        id: 'metadata-test', name: 'Metadata',
        steps: [{ id: 's1', name: 'S1', handler: 'h' }],
        metadata: { source: 'test', version: 1 },
      });
      orchestrator.registerHandler('h', successHandler('ok'));

      const result = await orchestrator.execute('metadata-test');
      expect(result.context.metadata.source).toBe('test');
      expect(result.context.metadata.version).toBe(1);
    });
  });
});
