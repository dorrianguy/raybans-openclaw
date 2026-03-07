/**
 * Circuit Breaker & Error Recovery Engine
 * 
 * Production-grade fault tolerance for the Ray-Bans × OpenClaw platform.
 * Protects all external API calls, agent invocations, and infrastructure
 * from cascading failures with circuit breakers, bulkheads, retries,
 * fallbacks, and graceful degradation.
 * 
 * 🌙 Night Shift Agent — 2026-03-04
 */

import { EventEmitter } from 'events';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Name for logging/metrics */
  name: string;
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Percentage of failures (0-1) to trigger open. Used instead of count if set */
  failureRateThreshold?: number;
  /** Minimum number of calls before rate-based threshold is evaluated */
  minimumCalls?: number;
  /** Time in ms the circuit stays open before trying half-open */
  resetTimeoutMs: number;
  /** Number of successful calls in half-open to close the circuit */
  halfOpenSuccessThreshold?: number;
  /** Timeout for individual calls in ms */
  callTimeoutMs?: number;
  /** Maximum concurrent calls (bulkhead pattern) */
  maxConcurrent?: number;
  /** Sliding window size for failure rate calculation */
  slidingWindowSize?: number;
  /** Errors to ignore (don't count as failures) */
  ignoreErrors?: (error: Error) => boolean;
  /** Custom health check function for half-open probing */
  healthCheck?: () => Promise<boolean>;
}

export interface RetryConfig {
  /** Max number of retry attempts */
  maxAttempts: number;
  /** Initial delay in ms */
  initialDelayMs: number;
  /** Maximum delay in ms */
  maxDelayMs: number;
  /** Backoff multiplier (e.g., 2 for exponential) */
  backoffMultiplier: number;
  /** Add jitter to prevent thundering herd */
  jitter: boolean;
  /** Errors that should NOT be retried (e.g., 4xx client errors) */
  nonRetryableErrors?: (error: Error) => boolean;
  /** Called before each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export interface FallbackConfig<T> {
  /** Primary fallback function */
  primary?: () => T | Promise<T>;
  /** Secondary fallback (if primary also fails) */
  secondary?: () => T | Promise<T>;
  /** Static default value */
  defaultValue?: T;
  /** Cache last successful result as fallback */
  useCachedResult?: boolean;
}

export interface BulkheadConfig {
  /** Maximum concurrent executions */
  maxConcurrent: number;
  /** Maximum queue size for waiting requests */
  maxQueue: number;
  /** Queue timeout in ms */
  queueTimeoutMs: number;
}

export interface CircuitMetrics {
  name: string;
  state: CircuitState;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  rejectedCalls: number;
  timedOutCalls: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  failureRate: number;
  averageResponseTimeMs: number;
  p95ResponseTimeMs: number;
  stateChanges: Array<{ from: CircuitState; to: CircuitState; timestamp: Date }>;
  lastStateChange: Date | null;
  openCount: number;
  bulkhead: {
    activeCalls: number;
    queuedCalls: number;
    rejectedCalls: number;
  };
}

interface SlidingWindowEntry {
  success: boolean;
  timestamp: number;
  responseTimeMs: number;
}

interface QueuedCall<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  queuedAt: number;
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = 'closed';
  private config: Required<CircuitBreakerConfig>;
  private slidingWindow: SlidingWindowEntry[] = [];
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalCalls = 0;
  private successfulCalls = 0;
  private failedCalls = 0;
  private rejectedCalls = 0;
  private timedOutCalls = 0;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;
  private lastStateChange: Date | null = null;
  private stateChanges: Array<{ from: CircuitState; to: CircuitState; timestamp: Date }> = [];
  private openCount = 0;
  private openedAt: number | null = null;
  private halfOpenTimer: ReturnType<typeof setTimeout> | null = null;

  // Bulkhead
  private activeCalls = 0;
  private callQueue: QueuedCall<any>[] = [];
  private bulkheadRejectedCalls = 0;

  // Cached result for fallback
  private cachedResult: { value: any; timestamp: number } | null = null;

  constructor(config: CircuitBreakerConfig) {
    super();
    this.config = {
      failureThreshold: config.failureThreshold,
      failureRateThreshold: config.failureRateThreshold ?? 0.5,
      minimumCalls: config.minimumCalls ?? 10,
      resetTimeoutMs: config.resetTimeoutMs,
      halfOpenSuccessThreshold: config.halfOpenSuccessThreshold ?? 3,
      callTimeoutMs: config.callTimeoutMs ?? 30000,
      maxConcurrent: config.maxConcurrent ?? 10,
      slidingWindowSize: config.slidingWindowSize ?? 100,
      name: config.name,
      ignoreErrors: config.ignoreErrors ?? (() => false),
      healthCheck: config.healthCheck ?? (async () => true),
    };
  }

  /**
   * Execute a function through the circuit breaker with full protection:
   * circuit state check → bulkhead → timeout → execution → metrics update
   */
  async execute<T>(fn: () => Promise<T>, fallback?: FallbackConfig<T>): Promise<T> {
    this.totalCalls++;

    // Check circuit state
    if (this.state === 'open') {
      // Check if reset timeout has elapsed
      if (this.openedAt && Date.now() - this.openedAt >= this.config.resetTimeoutMs) {
        this.transitionTo('half-open');
      } else {
        this.rejectedCalls++;
        this.emit('rejected', { name: this.config.name, state: this.state });
        return this.handleFallback(fallback, new CircuitOpenError(this.config.name));
      }
    }

    // Bulkhead check
    if (this.activeCalls >= this.config.maxConcurrent) {
      this.bulkheadRejectedCalls++;
      this.rejectedCalls++;
      this.emit('bulkhead:rejected', { name: this.config.name, active: this.activeCalls });
      return this.handleFallback(
        fallback,
        new BulkheadFullError(this.config.name, this.activeCalls)
      );
    }

    this.activeCalls++;
    const startTime = Date.now();

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(fn);
      const responseTimeMs = Date.now() - startTime;

      this.recordSuccess(responseTimeMs);
      this.cachedResult = { value: result, timestamp: Date.now() };
      this.activeCalls--;

      // Process queued calls
      this.processQueue();

      return result;
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      this.activeCalls--;

      const err = error instanceof Error ? error : new Error(String(error));

      // Check if this error should be ignored
      if (this.config.ignoreErrors(err)) {
        this.emit('ignored', { name: this.config.name, error: err });
        throw err;
      }

      this.recordFailure(responseTimeMs, err);
      this.processQueue();

      return this.handleFallback(fallback, err);
    }
  }

  /**
   * Execute with a timeout wrapper
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.config.callTimeoutMs || this.config.callTimeoutMs <= 0) {
      return fn();
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.timedOutCalls++;
        reject(new CallTimeoutError(this.config.name, this.config.callTimeoutMs));
      }, this.config.callTimeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Record a successful call
   */
  private recordSuccess(responseTimeMs: number): void {
    this.successfulCalls++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccess = new Date();

    this.addToSlidingWindow({ success: true, timestamp: Date.now(), responseTimeMs });

    if (this.state === 'half-open') {
      if (this.consecutiveSuccesses >= this.config.halfOpenSuccessThreshold) {
        this.transitionTo('closed');
      }
    }

    this.emit('success', {
      name: this.config.name,
      responseTimeMs,
      state: this.state,
    });
  }

  /**
   * Record a failed call
   */
  private recordFailure(responseTimeMs: number, error: Error): void {
    this.failedCalls++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailure = new Date();

    this.addToSlidingWindow({ success: false, timestamp: Date.now(), responseTimeMs });

    if (this.state === 'half-open') {
      // Any failure in half-open goes back to open
      this.transitionTo('open');
    } else if (this.state === 'closed') {
      // Check if we should open the circuit
      if (this.shouldOpen()) {
        this.transitionTo('open');
      }
    }

    this.emit('failure', {
      name: this.config.name,
      error,
      responseTimeMs,
      consecutiveFailures: this.consecutiveFailures,
      state: this.state,
    });
  }

  /**
   * Determine if the circuit should open based on failure threshold or rate
   */
  private shouldOpen(): boolean {
    // Count-based threshold
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      return true;
    }

    // Rate-based threshold
    if (this.config.failureRateThreshold !== undefined && this.config.failureRateThreshold < 1) {
      const recentCalls = this.slidingWindow;
      if (recentCalls.length >= this.config.minimumCalls) {
        const failures = recentCalls.filter((e) => !e.success).length;
        const rate = failures / recentCalls.length;
        if (rate >= this.config.failureRateThreshold) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Transition to a new circuit state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;
    this.lastStateChange = new Date();
    this.stateChanges.push({ from: oldState, to: newState, timestamp: new Date() });

    // Keep last 50 state changes
    if (this.stateChanges.length > 50) {
      this.stateChanges = this.stateChanges.slice(-50);
    }

    if (newState === 'open') {
      this.openedAt = Date.now();
      this.openCount++;
      this.consecutiveSuccesses = 0;

      // Schedule transition to half-open
      if (this.halfOpenTimer) clearTimeout(this.halfOpenTimer);
      this.halfOpenTimer = setTimeout(() => {
        if (this.state === 'open') {
          this.transitionTo('half-open');
        }
      }, this.config.resetTimeoutMs);
    } else if (newState === 'half-open') {
      this.consecutiveSuccesses = 0;
      this.consecutiveFailures = 0;
    } else if (newState === 'closed') {
      this.openedAt = null;
      this.consecutiveFailures = 0;
      if (this.halfOpenTimer) {
        clearTimeout(this.halfOpenTimer);
        this.halfOpenTimer = null;
      }
    }

    this.emit('state-change', {
      name: this.config.name,
      from: oldState,
      to: newState,
      timestamp: this.lastStateChange,
    });
  }

  /**
   * Add entry to the sliding window
   */
  private addToSlidingWindow(entry: SlidingWindowEntry): void {
    this.slidingWindow.push(entry);
    if (this.slidingWindow.length > this.config.slidingWindowSize) {
      this.slidingWindow.shift();
    }
  }

  /**
   * Handle fallback when circuit is open or call fails
   */
  private async handleFallback<T>(
    fallback: FallbackConfig<T> | undefined,
    error: Error
  ): Promise<T> {
    if (!fallback) throw error;

    // Try primary fallback
    if (fallback.primary) {
      try {
        const result = await fallback.primary();
        this.emit('fallback:primary', { name: this.config.name, error });
        return result;
      } catch (primaryError) {
        this.emit('fallback:primary-failed', { name: this.config.name, error: primaryError });
      }
    }

    // Try secondary fallback
    if (fallback.secondary) {
      try {
        const result = await fallback.secondary();
        this.emit('fallback:secondary', { name: this.config.name, error });
        return result;
      } catch (secondaryError) {
        this.emit('fallback:secondary-failed', { name: this.config.name, error: secondaryError });
      }
    }

    // Try cached result
    if (fallback.useCachedResult && this.cachedResult) {
      this.emit('fallback:cached', {
        name: this.config.name,
        error,
        cachedAt: new Date(this.cachedResult.timestamp),
      });
      return this.cachedResult.value as T;
    }

    // Try default value
    if (fallback.defaultValue !== undefined) {
      this.emit('fallback:default', { name: this.config.name, error });
      return fallback.defaultValue;
    }

    throw error;
  }

  /**
   * Process queued calls (bulkhead drain)
   */
  private processQueue(): void {
    while (this.callQueue.length > 0 && this.activeCalls < this.config.maxConcurrent) {
      const queued = this.callQueue.shift()!;

      // Check if queued call has timed out
      if (Date.now() - queued.queuedAt > 30000) {
        queued.reject(new Error('Queue timeout'));
        continue;
      }

      this.execute(queued.execute)
        .then(queued.resolve)
        .catch(queued.reject);
    }
  }

  /**
   * Manually force the circuit open (e.g., during maintenance)
   */
  forceOpen(): void {
    this.transitionTo('open');
    this.emit('forced-open', { name: this.config.name });
  }

  /**
   * Manually force the circuit closed (e.g., after fixing the issue)
   */
  forceClosed(): void {
    this.transitionTo('closed');
    this.emit('forced-closed', { name: this.config.name });
  }

  /**
   * Reset all metrics and state
   */
  reset(): void {
    this.state = 'closed';
    this.slidingWindow = [];
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.totalCalls = 0;
    this.successfulCalls = 0;
    this.failedCalls = 0;
    this.rejectedCalls = 0;
    this.timedOutCalls = 0;
    this.lastFailure = null;
    this.lastSuccess = null;
    this.lastStateChange = null;
    this.stateChanges = [];
    this.openCount = 0;
    this.openedAt = null;
    this.activeCalls = 0;
    this.callQueue = [];
    this.bulkheadRejectedCalls = 0;
    this.cachedResult = null;
    if (this.halfOpenTimer) {
      clearTimeout(this.halfOpenTimer);
      this.halfOpenTimer = null;
    }
    this.emit('reset', { name: this.config.name });
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics(): CircuitMetrics {
    const responseTimes = this.slidingWindow.map((e) => e.responseTimeMs).sort((a, b) => a - b);
    const avgResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;
    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p95ResponseTime = responseTimes.length > 0 ? responseTimes[p95Index] || 0 : 0;

    const recentFailures = this.slidingWindow.filter((e) => !e.success).length;
    const failureRate =
      this.slidingWindow.length > 0 ? recentFailures / this.slidingWindow.length : 0;

    return {
      name: this.config.name,
      state: this.state,
      totalCalls: this.totalCalls,
      successfulCalls: this.successfulCalls,
      failedCalls: this.failedCalls,
      rejectedCalls: this.rejectedCalls,
      timedOutCalls: this.timedOutCalls,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      failureRate,
      averageResponseTimeMs: Math.round(avgResponseTime),
      p95ResponseTimeMs: Math.round(p95ResponseTime),
      stateChanges: [...this.stateChanges],
      lastStateChange: this.lastStateChange,
      openCount: this.openCount,
      bulkhead: {
        activeCalls: this.activeCalls,
        queuedCalls: this.callQueue.length,
        rejectedCalls: this.bulkheadRejectedCalls,
      },
    };
  }

  /**
   * Destroy the circuit breaker and clean up
   */
  destroy(): void {
    if (this.halfOpenTimer) {
      clearTimeout(this.halfOpenTimer);
      this.halfOpenTimer = null;
    }
    this.callQueue = [];
    this.removeAllListeners();
  }
}

// ─── Retry with Backoff ──────────────────────────────────────────────────────

export class RetryExecutor {
  private config: Required<RetryConfig>;

  constructor(config: RetryConfig) {
    this.config = {
      maxAttempts: config.maxAttempts,
      initialDelayMs: config.initialDelayMs,
      maxDelayMs: config.maxDelayMs,
      backoffMultiplier: config.backoffMultiplier,
      jitter: config.jitter ?? true,
      nonRetryableErrors: config.nonRetryableErrors ?? (() => false),
      onRetry: config.onRetry ?? (() => {}),
    };
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is non-retryable
        if (this.config.nonRetryableErrors(lastError)) {
          throw lastError;
        }

        // If we've exhausted all retries, throw
        if (attempt >= this.config.maxAttempts) {
          throw lastError;
        }

        // Calculate delay
        const delay = this.calculateDelay(attempt);
        this.config.onRetry(attempt + 1, lastError, delay);

        // Wait before next attempt
        await this.sleep(delay);
      }
    }

    throw lastError || new Error('Retry exhausted');
  }

  /**
   * Calculate delay for a given attempt with exponential backoff + jitter
   */
  private calculateDelay(attempt: number): number {
    let delay = this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt);
    delay = Math.min(delay, this.config.maxDelayMs);

    if (this.config.jitter) {
      // Full jitter: random between 0 and calculated delay
      delay = Math.floor(Math.random() * delay);
    }

    return delay;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Resilience Pipeline ─────────────────────────────────────────────────────

/**
 * Combines Circuit Breaker + Retry + Fallback into a single resilient execution pipeline.
 * Use this for all external API calls and agent invocations.
 */
export class ResiliencePipeline<T = any> {
  private circuitBreaker: CircuitBreaker;
  private retryExecutor: RetryExecutor | null;
  private fallbackConfig: FallbackConfig<T> | null;

  constructor(
    circuitBreakerConfig: CircuitBreakerConfig,
    retryConfig?: RetryConfig,
    fallbackConfig?: FallbackConfig<T>
  ) {
    this.circuitBreaker = new CircuitBreaker(circuitBreakerConfig);
    this.retryExecutor = retryConfig ? new RetryExecutor(retryConfig) : null;
    this.fallbackConfig = fallbackConfig ?? null;
  }

  /**
   * Execute through the full resilience pipeline:
   * Circuit Breaker → Retry → Fallback
   */
  async execute(fn: () => Promise<T>): Promise<T> {
    const wrappedFn = this.retryExecutor
      ? () => this.retryExecutor!.execute(fn)
      : fn;

    return this.circuitBreaker.execute(wrappedFn, this.fallbackConfig ?? undefined);
  }

  /**
   * Get circuit breaker metrics
   */
  getMetrics(): CircuitMetrics {
    return this.circuitBreaker.getMetrics();
  }

  /**
   * Get the circuit breaker instance for event listening
   */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Force circuit open
   */
  forceOpen(): void {
    this.circuitBreaker.forceOpen();
  }

  /**
   * Force circuit closed
   */
  forceClosed(): void {
    this.circuitBreaker.forceClosed();
  }

  /**
   * Reset the pipeline
   */
  reset(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.circuitBreaker.destroy();
  }
}

// ─── Resilience Registry ─────────────────────────────────────────────────────

/**
 * Global registry for all circuit breakers in the platform.
 * Use this to monitor and manage all resilience pipelines from one place.
 */
export class ResilienceRegistry {
  private pipelines: Map<string, ResiliencePipeline<any>> = new Map();

  /**
   * Register a pre-built pipeline
   */
  register(name: string, pipeline: ResiliencePipeline<any>): void {
    if (this.pipelines.has(name)) {
      throw new Error(`Pipeline "${name}" already registered`);
    }
    this.pipelines.set(name, pipeline);
  }

  /**
   * Get a registered pipeline
   */
  get<T>(name: string): ResiliencePipeline<T> | undefined {
    return this.pipelines.get(name) as ResiliencePipeline<T> | undefined;
  }

  /**
   * Get metrics for all registered pipelines
   */
  getAllMetrics(): Record<string, CircuitMetrics> {
    const metrics: Record<string, CircuitMetrics> = {};
    for (const [name, pipeline] of this.pipelines) {
      metrics[name] = pipeline.getMetrics();
    }
    return metrics;
  }

  /**
   * Get a summary of the system's resilience health
   */
  getHealthSummary(): {
    total: number;
    closed: number;
    open: number;
    halfOpen: number;
    healthScore: number;
    unhealthy: string[];
  } {
    let closed = 0;
    let open = 0;
    let halfOpen = 0;
    const unhealthy: string[] = [];

    for (const [name, pipeline] of this.pipelines) {
      const metrics = pipeline.getMetrics();
      switch (metrics.state) {
        case 'closed':
          closed++;
          break;
        case 'open':
          open++;
          unhealthy.push(name);
          break;
        case 'half-open':
          halfOpen++;
          break;
      }

      // Also flag high failure rates
      if (metrics.failureRate > 0.3 && metrics.state === 'closed') {
        unhealthy.push(`${name} (high failure rate: ${(metrics.failureRate * 100).toFixed(1)}%)`);
      }
    }

    const total = this.pipelines.size;
    const healthScore = total > 0 ? (closed + halfOpen * 0.5) / total : 1;

    return { total, closed, open, halfOpen, healthScore, unhealthy };
  }

  /**
   * Force all circuits open (emergency shutdown)
   */
  openAll(): void {
    for (const pipeline of this.pipelines.values()) {
      pipeline.forceOpen();
    }
  }

  /**
   * Reset all circuits
   */
  resetAll(): void {
    for (const pipeline of this.pipelines.values()) {
      pipeline.reset();
    }
  }

  /**
   * Unregister and destroy a pipeline
   */
  unregister(name: string): boolean {
    const pipeline = this.pipelines.get(name);
    if (pipeline) {
      pipeline.destroy();
      this.pipelines.delete(name);
      return true;
    }
    return false;
  }

  /**
   * Destroy all and clean up
   */
  destroyAll(): void {
    for (const pipeline of this.pipelines.values()) {
      pipeline.destroy();
    }
    this.pipelines.clear();
  }

  /**
   * List all registered pipeline names
   */
  list(): string[] {
    return Array.from(this.pipelines.keys());
  }

  /**
   * Get count of registered pipelines
   */
  get size(): number {
    return this.pipelines.size;
  }
}

// ─── Pre-built Resilience Profiles ───────────────────────────────────────────

/**
 * Factory for common resilience configurations used across the platform.
 */
export const ResilienceProfiles = {
  /**
   * For vision API calls (OpenAI, Claude) — expensive, slow, critical
   */
  visionApi: (name: string = 'vision-api'): ResiliencePipeline<any> =>
    new ResiliencePipeline(
      {
        name,
        failureThreshold: 3,
        resetTimeoutMs: 30000,
        callTimeoutMs: 60000,
        maxConcurrent: 5,
        slidingWindowSize: 20,
        halfOpenSuccessThreshold: 2,
      },
      {
        maxAttempts: 2,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitter: true,
        nonRetryableErrors: (err) => {
          const msg = err.message.toLowerCase();
          return msg.includes('invalid api key') ||
            msg.includes('unauthorized') ||
            msg.includes('forbidden') ||
            msg.includes('content policy');
        },
      }
    ),

  /**
   * For product database lookups (UPC, barcodes) — fast, tolerant
   */
  productLookup: (name: string = 'product-lookup'): ResiliencePipeline<any> =>
    new ResiliencePipeline(
      {
        name,
        failureThreshold: 5,
        resetTimeoutMs: 15000,
        callTimeoutMs: 10000,
        maxConcurrent: 10,
        slidingWindowSize: 50,
      },
      {
        maxAttempts: 3,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitter: true,
      }
    ),

  /**
   * For web research (networking agent, deal agent) — variable latency
   */
  webResearch: (name: string = 'web-research'): ResiliencePipeline<any> =>
    new ResiliencePipeline(
      {
        name,
        failureThreshold: 5,
        resetTimeoutMs: 20000,
        callTimeoutMs: 15000,
        maxConcurrent: 8,
        slidingWindowSize: 30,
      },
      {
        maxAttempts: 2,
        initialDelayMs: 1000,
        maxDelayMs: 8000,
        backoffMultiplier: 2,
        jitter: true,
      }
    ),

  /**
   * For TTS/STT calls — latency-sensitive, needs fast fallback
   */
  voiceService: (name: string = 'voice-service'): ResiliencePipeline<any> =>
    new ResiliencePipeline(
      {
        name,
        failureThreshold: 3,
        resetTimeoutMs: 10000,
        callTimeoutMs: 5000,
        maxConcurrent: 3,
        slidingWindowSize: 20,
        halfOpenSuccessThreshold: 2,
      },
      {
        maxAttempts: 1,
        initialDelayMs: 500,
        maxDelayMs: 2000,
        backoffMultiplier: 2,
        jitter: true,
      }
    ),

  /**
   * For webhook delivery — persistent, high-volume
   */
  webhookDelivery: (name: string = 'webhook-delivery'): ResiliencePipeline<any> =>
    new ResiliencePipeline(
      {
        name,
        failureThreshold: 10,
        resetTimeoutMs: 60000,
        callTimeoutMs: 10000,
        maxConcurrent: 20,
        slidingWindowSize: 100,
        failureRateThreshold: 0.4,
        minimumCalls: 20,
      },
      {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 3,
        jitter: true,
      }
    ),

  /**
   * For Stripe billing operations — critical, low-volume
   */
  billing: (name: string = 'billing'): ResiliencePipeline<any> =>
    new ResiliencePipeline(
      {
        name,
        failureThreshold: 2,
        resetTimeoutMs: 45000,
        callTimeoutMs: 30000,
        maxConcurrent: 3,
        slidingWindowSize: 20,
        halfOpenSuccessThreshold: 3,
      },
      {
        maxAttempts: 3,
        initialDelayMs: 2000,
        maxDelayMs: 15000,
        backoffMultiplier: 2,
        jitter: true,
        nonRetryableErrors: (err) => {
          const msg = err.message.toLowerCase();
          return msg.includes('card_declined') ||
            msg.includes('invalid_request');
        },
      }
    ),

  /**
   * For SQLite/local operations — should almost never fail
   */
  localStorage: (name: string = 'local-storage'): ResiliencePipeline<any> =>
    new ResiliencePipeline(
      {
        name,
        failureThreshold: 3,
        resetTimeoutMs: 5000,
        callTimeoutMs: 5000,
        maxConcurrent: 20,
        slidingWindowSize: 50,
      },
      {
        maxAttempts: 2,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitter: false,
      }
    ),
};

// ─── Custom Error Types ──────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  constructor(circuitName: string) {
    super(`Circuit breaker "${circuitName}" is open — requests are being rejected`);
    this.name = 'CircuitOpenError';
  }
}

export class BulkheadFullError extends Error {
  constructor(circuitName: string, activeCalls: number) {
    super(
      `Bulkhead for "${circuitName}" is full (${activeCalls} active calls) — request rejected`
    );
    this.name = 'BulkheadFullError';
  }
}

export class CallTimeoutError extends Error {
  constructor(circuitName: string, timeoutMs: number) {
    super(`Call to "${circuitName}" timed out after ${timeoutMs}ms`);
    this.name = 'CallTimeoutError';
  }
}
