/**
 * Workflow Orchestrator — Multi-Step Agent Pipeline Chains
 *
 * Orchestrates complex multi-agent workflows where the output of one
 * step feeds into the next. Supports branching, parallel execution,
 * conditional routing, error handling, and resume-from-failure.
 *
 * Examples:
 * - Inventory scan: capture → analyze → identify → price check → record → notify
 * - Meeting flow: pre-research → transcribe → extract actions → follow-up
 * - Security check: scan → classify → escalate → alert
 *
 * Key features:
 * - DAG-based step execution (directed acyclic graph)
 * - Conditional branching based on step output
 * - Parallel step execution
 * - Timeout per step and per workflow
 * - Retry with backoff per step
 * - Workflow templates (pre-built for common patterns)
 * - Execution history for debugging
 * - Voice-friendly status updates
 *
 * @module workflows/workflow-orchestrator
 * @openclaw/raybans-vision
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'retrying';

export interface WorkflowDefinition {
  /** Unique workflow ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description?: string;
  /** Category for grouping */
  category?: string;
  /** Ordered steps */
  steps: StepDefinition[];
  /** Global workflow timeout (ms) */
  timeoutMs?: number;
  /** Maximum retries for the entire workflow */
  maxRetries?: number;
  /** Workflow-level metadata */
  metadata?: Record<string, unknown>;
}

export interface StepDefinition {
  /** Unique step ID within the workflow */
  id: string;
  /** Human-readable name */
  name: string;
  /** Which agent/handler processes this step */
  handler: string;
  /** Step timeout (ms) */
  timeoutMs?: number;
  /** Max retries for this step */
  maxRetries?: number;
  /** Retry delay base (ms, exponential backoff applied) */
  retryDelayMs?: number;
  /** Steps that must complete before this one runs */
  dependsOn?: string[];
  /** Condition function: receives workflow context, returns whether to run */
  condition?: (context: WorkflowContext) => boolean;
  /** Whether this step can run in parallel with siblings */
  parallel?: boolean;
  /** Whether failure of this step should fail the entire workflow */
  critical?: boolean;
  /** Transform input before passing to handler */
  inputTransform?: (context: WorkflowContext) => Record<string, unknown>;
  /** Transform output before storing in context */
  outputTransform?: (result: unknown) => Record<string, unknown>;
  /** Step-level metadata */
  metadata?: Record<string, unknown>;
}

export interface WorkflowContext {
  /** Workflow execution ID */
  executionId: string;
  /** Workflow definition ID */
  workflowId: string;
  /** Input data that started the workflow */
  input: Record<string, unknown>;
  /** Accumulated results from each step (step_id → output) */
  stepResults: Record<string, unknown>;
  /** Current variables (mutable across steps) */
  variables: Record<string, unknown>;
  /** Execution metadata */
  metadata: Record<string, unknown>;
  /** Workflow start time */
  startedAt: string;
}

export interface StepExecution {
  stepId: string;
  stepName: string;
  handler: string;
  status: StepStatus;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  attempt: number;
  maxRetries: number;
}

export interface WorkflowExecution {
  /** Unique execution ID */
  id: string;
  /** Workflow definition ID */
  workflowId: string;
  /** Workflow name */
  workflowName: string;
  /** Current status */
  status: WorkflowStatus;
  /** Input data */
  input: Record<string, unknown>;
  /** Final output (from last step or aggregated) */
  output?: Record<string, unknown>;
  /** Per-step execution records */
  steps: StepExecution[];
  /** Error message if failed */
  error?: string;
  /** Execution context */
  context: WorkflowContext;
  /** Started at */
  startedAt: string;
  /** Completed at */
  completedAt?: string;
  /** Total duration (ms) */
  durationMs?: number;
  /** Current step being executed */
  currentStep?: string;
  /** Steps completed count */
  completedSteps: number;
  /** Total steps count */
  totalSteps: number;
}

export type StepHandler = (
  input: Record<string, unknown>,
  context: WorkflowContext,
) => Promise<unknown>;

export interface WorkflowOrchestratorConfig {
  /** Default step timeout (ms) */
  defaultStepTimeoutMs?: number;
  /** Default step retries */
  defaultStepRetries?: number;
  /** Default retry delay (ms) */
  defaultRetryDelayMs?: number;
  /** Maximum concurrent workflow executions */
  maxConcurrentExecutions?: number;
  /** Maximum execution history to keep */
  maxHistorySize?: number;
}

export interface WorkflowOrchestratorEvents {
  'workflow:started': (execution: WorkflowExecution) => void;
  'workflow:completed': (execution: WorkflowExecution) => void;
  'workflow:failed': (execution: WorkflowExecution) => void;
  'workflow:cancelled': (executionId: string) => void;
  'step:started': (executionId: string, step: StepExecution) => void;
  'step:completed': (executionId: string, step: StepExecution) => void;
  'step:failed': (executionId: string, step: StepExecution) => void;
  'step:skipped': (executionId: string, stepId: string, reason: string) => void;
  'step:retrying': (executionId: string, stepId: string, attempt: number) => void;
}

// ─── Default Configuration ──────────────────────────────────────

const DEFAULT_CONFIG: Required<WorkflowOrchestratorConfig> = {
  defaultStepTimeoutMs: 30_000,
  defaultStepRetries: 2,
  defaultRetryDelayMs: 1000,
  maxConcurrentExecutions: 10,
  maxHistorySize: 1000,
};

// ─── Implementation ─────────────────────────────────────────────

export class WorkflowOrchestrator extends EventEmitter {
  private config: Required<WorkflowOrchestratorConfig>;
  private definitions: Map<string, WorkflowDefinition> = new Map();
  private handlers: Map<string, StepHandler> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private executionHistory: WorkflowExecution[] = [];
  private activeCount: number = 0;

  constructor(config: WorkflowOrchestratorConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Registration ───────────────────────────────────────────

  /**
   * Register a workflow definition
   */
  registerWorkflow(definition: WorkflowDefinition): void {
    // Validate DAG — no circular dependencies
    this.validateDAG(definition);
    this.definitions.set(definition.id, definition);
  }

  /**
   * Unregister a workflow definition
   */
  unregisterWorkflow(id: string): boolean {
    return this.definitions.delete(id);
  }

  /**
   * Register a step handler
   */
  registerHandler(name: string, handler: StepHandler): void {
    this.handlers.set(name, handler);
  }

  /**
   * Unregister a step handler
   */
  unregisterHandler(name: string): boolean {
    return this.handlers.delete(name);
  }

  /**
   * Get a registered workflow definition
   */
  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.definitions.get(id);
  }

  /**
   * List all registered workflows
   */
  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * List all registered handlers
   */
  listHandlers(): string[] {
    return Array.from(this.handlers.keys());
  }

  // ─── Execution ──────────────────────────────────────────────

  /**
   * Execute a workflow by ID with the given input
   */
  async execute(
    workflowId: string,
    input: Record<string, unknown> = {},
  ): Promise<WorkflowExecution> {
    const definition = this.definitions.get(workflowId);
    if (!definition) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Check concurrency limit
    if (this.activeCount >= this.config.maxConcurrentExecutions) {
      throw new Error(`Maximum concurrent executions (${this.config.maxConcurrentExecutions}) reached`);
    }

    const executionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const context: WorkflowContext = {
      executionId,
      workflowId: definition.id,
      input: { ...input },
      stepResults: {},
      variables: {},
      metadata: { ...(definition.metadata || {}) },
      startedAt: now,
    };

    const execution: WorkflowExecution = {
      id: executionId,
      workflowId: definition.id,
      workflowName: definition.name,
      status: 'running',
      input: { ...input },
      steps: definition.steps.map(s => ({
        stepId: s.id,
        stepName: s.name,
        handler: s.handler,
        status: 'pending' as StepStatus,
        attempt: 0,
        maxRetries: s.maxRetries ?? this.config.defaultStepRetries,
      })),
      context,
      startedAt: now,
      completedSteps: 0,
      totalSteps: definition.steps.length,
    };

    this.executions.set(executionId, execution);
    this.activeCount++;

    this.emit('workflow:started', execution);

    try {
      // Execute with optional global timeout
      if (definition.timeoutMs) {
        await Promise.race([
          this.executeSteps(definition, execution, context),
          this.timeout(definition.timeoutMs, `Workflow ${definition.name} timed out after ${definition.timeoutMs}ms`),
        ]);
      } else {
        await this.executeSteps(definition, execution, context);
      }

      // Aggregate output from all completed steps
      execution.output = { ...context.stepResults };
      execution.status = 'completed';
      execution.completedAt = new Date().toISOString();
      execution.durationMs = Date.now() - new Date(execution.startedAt).getTime();

      this.emit('workflow:completed', execution);
    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : String(error);
      execution.completedAt = new Date().toISOString();
      execution.durationMs = Date.now() - new Date(execution.startedAt).getTime();

      this.emit('workflow:failed', execution);
    } finally {
      this.activeCount--;
      this.archiveExecution(execution);
    }

    return execution;
  }

  /**
   * Cancel a running workflow
   */
  cancel(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'running') return false;

    execution.status = 'cancelled';
    execution.completedAt = new Date().toISOString();
    execution.durationMs = Date.now() - new Date(execution.startedAt).getTime();

    // Cancel any pending steps
    for (const step of execution.steps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'cancelled';
      }
    }

    this.emit('workflow:cancelled', executionId);
    return true;
  }

  // ─── Execution History ──────────────────────────────────────

  /**
   * Get a specific execution
   */
  getExecution(id: string): WorkflowExecution | undefined {
    return this.executions.get(id) || this.executionHistory.find(e => e.id === id);
  }

  /**
   * Get execution history
   */
  getHistory(options?: {
    workflowId?: string;
    status?: WorkflowStatus;
    limit?: number;
  }): WorkflowExecution[] {
    let results = [...this.executionHistory];

    if (options?.workflowId) {
      results = results.filter(e => e.workflowId === options.workflowId);
    }
    if (options?.status) {
      results = results.filter(e => e.status === options.status);
    }

    const limit = options?.limit || 50;
    return results.slice(-limit);
  }

  /**
   * Get active executions
   */
  getActiveExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values()).filter(e => e.status === 'running');
  }

  // ─── Statistics ─────────────────────────────────────────────

  /**
   * Get orchestrator statistics
   */
  getStats(): {
    registeredWorkflows: number;
    registeredHandlers: number;
    activeExecutions: number;
    totalExecutions: number;
    completedExecutions: number;
    failedExecutions: number;
    averageDurationMs: number;
    successRate: number;
  } {
    const completed = this.executionHistory.filter(e => e.status === 'completed');
    const failed = this.executionHistory.filter(e => e.status === 'failed');
    const totalWithDuration = this.executionHistory.filter(e => e.durationMs);
    const avgDuration = totalWithDuration.length > 0
      ? totalWithDuration.reduce((sum, e) => sum + (e.durationMs || 0), 0) / totalWithDuration.length
      : 0;

    const total = this.executionHistory.length;

    return {
      registeredWorkflows: this.definitions.size,
      registeredHandlers: this.handlers.size,
      activeExecutions: this.activeCount,
      totalExecutions: total,
      completedExecutions: completed.length,
      failedExecutions: failed.length,
      averageDurationMs: Math.round(avgDuration),
      successRate: total > 0 ? completed.length / total : 0,
    };
  }

  /**
   * Generate a voice-friendly status summary
   */
  getVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];

    parts.push(`Workflow orchestrator has ${stats.registeredWorkflows} workflows and ${stats.registeredHandlers} handlers`);
    
    if (stats.activeExecutions > 0) {
      parts.push(`${stats.activeExecutions} currently running`);
    }

    if (stats.totalExecutions > 0) {
      const pct = Math.round(stats.successRate * 100);
      parts.push(`${stats.totalExecutions} total executions, ${pct}% success rate`);
      if (stats.averageDurationMs > 0) {
        parts.push(`average duration ${Math.round(stats.averageDurationMs / 1000)} seconds`);
      }
    }

    return parts.join('. ') + '.';
  }

  // ─── Templates ──────────────────────────────────────────────

  /**
   * Get pre-built workflow templates
   */
  static getTemplates(): WorkflowDefinition[] {
    return [
      // Inventory Scan Pipeline
      {
        id: 'inventory-scan',
        name: 'Inventory Scan Pipeline',
        description: 'Full inventory scanning workflow: capture → analyze → identify → price → record',
        category: 'inventory',
        steps: [
          { id: 'capture', name: 'Capture Image', handler: 'vision.capture', critical: true },
          { id: 'analyze', name: 'Analyze Scene', handler: 'vision.analyze', dependsOn: ['capture'], critical: true },
          { id: 'identify', name: 'Identify Products', handler: 'inventory.identify', dependsOn: ['analyze'] },
          { id: 'price_check', name: 'Price Lookup', handler: 'deal.price_check', dependsOn: ['identify'], parallel: true },
          { id: 'barcode_lookup', name: 'Barcode Lookup', handler: 'inventory.barcode', dependsOn: ['identify'], parallel: true },
          { id: 'record', name: 'Record Items', handler: 'inventory.record', dependsOn: ['price_check', 'barcode_lookup'] },
          { id: 'notify', name: 'Voice Update', handler: 'voice.notify', dependsOn: ['record'], critical: false },
        ],
        timeoutMs: 60_000,
      },

      // Meeting Intelligence Pipeline
      {
        id: 'meeting-flow',
        name: 'Meeting Intelligence Pipeline',
        description: 'Pre-meeting prep → live transcription → action extraction → follow-up',
        category: 'meeting',
        steps: [
          { id: 'research', name: 'Pre-Meeting Research', handler: 'meeting.research' },
          { id: 'transcribe', name: 'Transcribe Meeting', handler: 'meeting.transcribe', dependsOn: ['research'] },
          { id: 'extract_actions', name: 'Extract Action Items', handler: 'meeting.extract_actions', dependsOn: ['transcribe'] },
          { id: 'extract_decisions', name: 'Extract Decisions', handler: 'meeting.extract_decisions', dependsOn: ['transcribe'], parallel: true },
          { id: 'summarize', name: 'Generate Summary', handler: 'meeting.summarize', dependsOn: ['extract_actions', 'extract_decisions'] },
          { id: 'follow_up', name: 'Create Follow-Up', handler: 'meeting.follow_up', dependsOn: ['summarize'], critical: false },
        ],
        timeoutMs: 300_000, // 5 min
      },

      // Security Check Pipeline
      {
        id: 'security-check',
        name: 'Security Check Pipeline',
        description: 'Threat scan → classify → escalate → alert',
        category: 'security',
        steps: [
          { id: 'scan', name: 'Initial Scan', handler: 'security.scan', critical: true },
          { id: 'classify', name: 'Classify Threat', handler: 'security.classify', dependsOn: ['scan'] },
          {
            id: 'deep_scan', name: 'Deep Scan', handler: 'security.deep_scan',
            dependsOn: ['classify'],
            condition: (ctx) => {
              const result = ctx.stepResults['classify'] as any;
              return result?.threatLevel === 'high' || result?.threatLevel === 'critical';
            },
          },
          { id: 'alert', name: 'Send Alert', handler: 'security.alert', dependsOn: ['classify'] },
        ],
        timeoutMs: 15_000,
      },

      // Networking Contact Pipeline
      {
        id: 'networking-contact',
        name: 'Networking Contact Pipeline',
        description: 'Scan badge → extract info → research → briefing',
        category: 'networking',
        steps: [
          { id: 'scan', name: 'Scan Badge/Card', handler: 'networking.scan', critical: true },
          { id: 'extract', name: 'Extract Contact Info', handler: 'networking.extract', dependsOn: ['scan'] },
          { id: 'research', name: 'Web Research', handler: 'networking.research', dependsOn: ['extract'], critical: false, timeoutMs: 10_000 },
          { id: 'dedup', name: 'Dedup & Merge', handler: 'networking.dedup', dependsOn: ['extract'] },
          { id: 'briefing', name: 'Voice Briefing', handler: 'networking.briefing', dependsOn: ['research', 'dedup'] },
        ],
        timeoutMs: 20_000,
      },

      // Inspection Walkthrough Pipeline
      {
        id: 'inspection-walkthrough',
        name: 'Inspection Walkthrough Pipeline',
        description: 'Enter room → scan → detect findings → score → report',
        category: 'inspection',
        steps: [
          { id: 'enter', name: 'Enter Section', handler: 'inspection.enter_section', critical: true },
          { id: 'scan', name: 'Scan Room', handler: 'inspection.scan', dependsOn: ['enter'] },
          { id: 'detect', name: 'Detect Findings', handler: 'inspection.detect_findings', dependsOn: ['scan'] },
          { id: 'score', name: 'Score Condition', handler: 'inspection.score', dependsOn: ['detect'] },
          { id: 'report', name: 'Generate Report Section', handler: 'inspection.report', dependsOn: ['score'] },
          { id: 'voice_update', name: 'Voice Status', handler: 'voice.notify', dependsOn: ['score'], critical: false },
        ],
        timeoutMs: 45_000,
      },
    ];
  }

  /**
   * Register all built-in templates
   */
  registerTemplates(): void {
    for (const template of WorkflowOrchestrator.getTemplates()) {
      this.registerWorkflow(template);
    }
  }

  // ─── Private: Step Execution ────────────────────────────────

  private async executeSteps(
    definition: WorkflowDefinition,
    execution: WorkflowExecution,
    context: WorkflowContext,
  ): Promise<void> {
    const completed = new Set<string>();
    const failed = new Set<string>();
    const skipped = new Set<string>();

    // Build dependency graph
    const stepsById = new Map<string, StepDefinition>();
    for (const step of definition.steps) {
      stepsById.set(step.id, step);
    }

    // Process steps in dependency order
    while (completed.size + failed.size + skipped.size < definition.steps.length) {
      // Check if cancelled
      if (execution.status === 'cancelled') break;

      // Find runnable steps (all dependencies met)
      const runnable: StepDefinition[] = [];
      for (const step of definition.steps) {
        if (completed.has(step.id) || failed.has(step.id) || skipped.has(step.id)) continue;

        const deps = step.dependsOn || [];
        const depsComplete = deps.every(d => completed.has(d) || skipped.has(d));
        const depsFailed = deps.some(d => failed.has(d));

        if (depsFailed) {
          // Skip this step — a dependency failed
          skipped.add(step.id);
          const stepExec = execution.steps.find(s => s.stepId === step.id)!;
          stepExec.status = 'skipped';
          this.emit('step:skipped', execution.id, step.id, 'dependency failed');
          continue;
        }

        if (depsComplete) {
          runnable.push(step);
        }
      }

      if (runnable.length === 0) {
        // No progress possible — deadlock or all done
        break;
      }

      // Separate parallel and sequential steps
      const parallelSteps = runnable.filter(s => s.parallel);
      const sequentialSteps = runnable.filter(s => !s.parallel);

      // Execute parallel steps concurrently
      if (parallelSteps.length > 0) {
        const results = await Promise.allSettled(
          parallelSteps.map(step => this.executeStep(step, execution, context)),
        );

        for (let i = 0; i < parallelSteps.length; i++) {
          const step = parallelSteps[i];
          const result = results[i];
          if (result.status === 'fulfilled' && result.value) {
            completed.add(step.id);
            execution.completedSteps++;
          } else {
            if (step.critical !== false) {
              failed.add(step.id);
              throw new Error(`Critical step '${step.name}' failed: ${result.status === 'rejected' ? result.reason : 'unknown'}`);
            }
            // Non-critical: mark as failed but continue
            failed.add(step.id);
          }
        }
      }

      // Execute sequential steps one at a time
      for (const step of sequentialSteps) {
        if (execution.status === 'cancelled') break;

        try {
          const success = await this.executeStep(step, execution, context);
          if (success) {
            completed.add(step.id);
            execution.completedSteps++;
          } else {
            failed.add(step.id);
            if (step.critical !== false) {
              // Mark all remaining pending steps as skipped
              this.markRemainingSkipped(definition, execution, completed, failed, skipped);
              const stepExec = execution.steps.find(s => s.stepId === step.id);
              throw new Error(stepExec?.error || `Critical step '${step.name}' failed`);
            }
          }
        } catch (error) {
          if (!failed.has(step.id)) failed.add(step.id);
          if (step.critical !== false) {
            // Mark all remaining pending steps as skipped
            this.markRemainingSkipped(definition, execution, completed, failed, skipped);
            throw error;
          }
        }
      }
    }
  }

  private markRemainingSkipped(
    definition: WorkflowDefinition,
    execution: WorkflowExecution,
    completed: Set<string>,
    failed: Set<string>,
    skipped: Set<string>,
  ): void {
    for (const step of definition.steps) {
      if (!completed.has(step.id) && !failed.has(step.id) && !skipped.has(step.id)) {
        skipped.add(step.id);
        const stepExec = execution.steps.find(s => s.stepId === step.id);
        if (stepExec && stepExec.status === 'pending') {
          stepExec.status = 'skipped';
          this.emit('step:skipped', execution.id, step.id, 'upstream step failed');
        }
      }
    }
  }

  private async executeStep(
    step: StepDefinition,
    execution: WorkflowExecution,
    context: WorkflowContext,
  ): Promise<boolean> {
    const stepExec = execution.steps.find(s => s.stepId === step.id)!;
    const handler = this.handlers.get(step.handler);

    if (!handler) {
      stepExec.status = 'failed';
      stepExec.error = `Handler not found: ${step.handler}`;
      this.emit('step:failed', execution.id, stepExec);
      return false;
    }

    // Check condition
    if (step.condition && !step.condition(context)) {
      stepExec.status = 'skipped';
      this.emit('step:skipped', execution.id, step.id, 'condition not met');
      return true; // Skipped is OK, not a failure
    }

    // Build input
    const input = step.inputTransform
      ? step.inputTransform(context)
      : { ...context.input, ...context.stepResults };

    const maxRetries = step.maxRetries ?? this.config.defaultStepRetries;
    const retryDelay = step.retryDelayMs ?? this.config.defaultRetryDelayMs;
    const stepTimeout = step.timeoutMs ?? this.config.defaultStepTimeoutMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      stepExec.attempt = attempt + 1;
      stepExec.status = attempt > 0 ? 'retrying' : 'running';
      stepExec.startedAt = new Date().toISOString();
      stepExec.input = input;
      execution.currentStep = step.id;

      if (attempt > 0) {
        this.emit('step:retrying', execution.id, step.id, attempt);
        await this.delay(retryDelay * Math.pow(2, attempt - 1));
      }

      this.emit('step:started', execution.id, stepExec);

      try {
        let result: unknown;
        if (stepTimeout) {
          result = await Promise.race([
            handler(input, context),
            this.timeout(stepTimeout, `Step '${step.name}' timed out after ${stepTimeout}ms`),
          ]);
        } else {
          result = await handler(input, context);
        }

        // Transform output
        const output = step.outputTransform ? step.outputTransform(result) : result;

        stepExec.status = 'completed';
        stepExec.output = output;
        stepExec.completedAt = new Date().toISOString();
        stepExec.durationMs = Date.now() - new Date(stepExec.startedAt).getTime();

        // Store in context
        context.stepResults[step.id] = output;

        this.emit('step:completed', execution.id, stepExec);
        return true;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        stepExec.error = errorMsg;

        if (attempt >= maxRetries) {
          stepExec.status = 'failed';
          stepExec.completedAt = new Date().toISOString();
          stepExec.durationMs = Date.now() - new Date(stepExec.startedAt).getTime();
          this.emit('step:failed', execution.id, stepExec);
          return false;
        }
      }
    }

    return false;
  }

  // ─── Private: Validation ────────────────────────────────────

  private validateDAG(definition: WorkflowDefinition): void {
    const stepIds = new Set(definition.steps.map(s => s.id));

    // Check for duplicate step IDs
    if (stepIds.size !== definition.steps.length) {
      throw new Error('Duplicate step IDs in workflow definition');
    }

    // Check dependency references
    for (const step of definition.steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!stepIds.has(dep)) {
            throw new Error(`Step '${step.id}' depends on non-existent step '${dep}'`);
          }
        }
      }
    }

    // Check for cycles using DFS
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (stepId: string): void => {
      if (inStack.has(stepId)) {
        throw new Error(`Circular dependency detected involving step '${stepId}'`);
      }
      if (visited.has(stepId)) return;

      inStack.add(stepId);
      visited.add(stepId);

      const step = definition.steps.find(s => s.id === stepId);
      if (step?.dependsOn) {
        for (const dep of step.dependsOn) {
          dfs(dep);
        }
      }

      inStack.delete(stepId);
    };

    for (const step of definition.steps) {
      dfs(step.id);
    }
  }

  // ─── Private: Helpers ───────────────────────────────────────

  private archiveExecution(execution: WorkflowExecution): void {
    this.executions.delete(execution.id);
    this.executionHistory.push(execution);

    // Trim history
    while (this.executionHistory.length > this.config.maxHistorySize) {
      this.executionHistory.shift();
    }
  }

  private timeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
