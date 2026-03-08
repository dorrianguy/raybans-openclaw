/**
 * Health Monitor & Diagnostics Engine
 * 
 * System-wide health checking, performance tracking, and self-healing
 * for the Ray-Bans × OpenClaw platform. Monitors all subsystems,
 * detects degradation, and triggers automated recovery.
 * 
 * 🌙 Night Shift Agent — 2026-03-04
 */

import { EventEmitter } from 'events';

// ─── Types ───────────────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export type ComponentType =
  | 'agent'
  | 'bridge'
  | 'storage'
  | 'voice'
  | 'api'
  | 'external'
  | 'plugin'
  | 'infrastructure';

export interface HealthCheckConfig {
  /** Component name */
  name: string;
  /** Component type for grouping */
  type: ComponentType;
  /** Health check function — returns true if healthy */
  check: () => Promise<boolean>;
  /** Check interval in ms */
  intervalMs: number;
  /** Timeout for individual health check */
  timeoutMs?: number;
  /** Number of consecutive failures before marking unhealthy */
  unhealthyThreshold?: number;
  /** Number of consecutive failures before marking degraded */
  degradedThreshold?: number;
  /** Number of consecutive successes to recover from unhealthy */
  recoveryThreshold?: number;
  /** Critical component — affects overall system health */
  critical?: boolean;
  /** Auto-recovery function (called when unhealthy) */
  recover?: () => Promise<boolean>;
  /** Max recovery attempts before giving up */
  maxRecoveryAttempts?: number;
  /** Metadata for display */
  metadata?: Record<string, any>;
}

export interface ComponentHealth {
  name: string;
  type: ComponentType;
  status: HealthStatus;
  lastCheck: Date | null;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalChecks: number;
  totalFailures: number;
  uptime: number; // percentage 0-100
  averageCheckMs: number;
  lastCheckMs: number;
  lastError: string | null;
  recovering: boolean;
  recoveryAttempts: number;
  critical: boolean;
  metadata: Record<string, any>;
}

export interface SystemHealth {
  status: HealthStatus;
  timestamp: Date;
  uptime: number; // percentage
  components: ComponentHealth[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
    critical: { total: number; healthy: number };
  };
  alerts: HealthAlert[];
  diagnostics: DiagnosticsData;
}

export interface HealthAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  component: string;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
  resolvedAt: Date | null;
}

export interface DiagnosticsData {
  memoryUsageMB: number;
  memoryLimitMB: number;
  memoryUsagePercent: number;
  cpuUsagePercent: number | null;
  eventLoopDelayMs: number;
  activeTimers: number;
  activeChecks: number;
  uptimeSeconds: number;
  nodeVersion: string;
  platform: string;
}

export interface HealthMonitorConfig {
  /** Default check interval for components without explicit interval */
  defaultIntervalMs?: number;
  /** Whether to start monitoring automatically */
  autoStart?: boolean;
  /** Max alerts to retain */
  maxAlerts?: number;
  /** Enable auto-recovery */
  enableRecovery?: boolean;
  /** Alert callback for external integrations */
  onAlert?: (alert: HealthAlert) => void;
}

interface ComponentState {
  config: Required<HealthCheckConfig>;
  health: ComponentHealth;
  timer: ReturnType<typeof setInterval> | null;
  checkTimes: number[];
}

// ─── Health Monitor ──────────────────────────────────────────────────────────

export class HealthMonitor extends EventEmitter {
  private components: Map<string, ComponentState> = new Map();
  private alerts: HealthAlert[] = [];
  private alertIdCounter = 0;
  private config: Required<HealthMonitorConfig>;
  private running = false;
  private startedAt: Date | null = null;

  constructor(config: HealthMonitorConfig = {}) {
    super();
    this.config = {
      defaultIntervalMs: config.defaultIntervalMs ?? 30000,
      autoStart: config.autoStart ?? false,
      maxAlerts: config.maxAlerts ?? 200,
      enableRecovery: config.enableRecovery ?? true,
      onAlert: config.onAlert ?? (() => {}),
    };
  }

  /**
   * Register a component for health monitoring
   */
  registerComponent(check: HealthCheckConfig): void {
    if (this.components.has(check.name)) {
      throw new Error(`Component "${check.name}" is already registered`);
    }

    const fullConfig: Required<HealthCheckConfig> = {
      name: check.name,
      type: check.type,
      check: check.check,
      intervalMs: check.intervalMs ?? this.config.defaultIntervalMs,
      timeoutMs: check.timeoutMs ?? 5000,
      unhealthyThreshold: check.unhealthyThreshold ?? 3,
      degradedThreshold: check.degradedThreshold ?? 1,
      recoveryThreshold: check.recoveryThreshold ?? 2,
      critical: check.critical ?? false,
      recover: check.recover ?? (async () => false),
      maxRecoveryAttempts: check.maxRecoveryAttempts ?? 3,
      metadata: check.metadata ?? {},
    };

    const state: ComponentState = {
      config: fullConfig,
      health: {
        name: check.name,
        type: check.type,
        status: 'unknown',
        lastCheck: null,
        lastSuccess: null,
        lastFailure: null,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        totalChecks: 0,
        totalFailures: 0,
        uptime: 100,
        averageCheckMs: 0,
        lastCheckMs: 0,
        lastError: null,
        recovering: false,
        recoveryAttempts: 0,
        critical: fullConfig.critical,
        metadata: fullConfig.metadata,
      },
      timer: null,
      checkTimes: [],
    };

    this.components.set(check.name, state);

    // If monitor is already running, start this component's checks
    if (this.running) {
      this.startComponentChecks(state);
    }

    this.emit('component:registered', { name: check.name, type: check.type });
  }

  /**
   * Unregister a component
   */
  unregisterComponent(name: string): boolean {
    const state = this.components.get(name);
    if (!state) return false;

    if (state.timer) {
      clearInterval(state.timer);
    }

    this.components.delete(name);
    this.emit('component:unregistered', { name });
    return true;
  }

  /**
   * Start monitoring all registered components
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date();

    for (const state of this.components.values()) {
      this.startComponentChecks(state);
    }

    this.emit('started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const state of this.components.values()) {
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
    }

    this.emit('stopped');
  }

  /**
   * Run a single health check for a specific component
   */
  async checkComponent(name: string): Promise<ComponentHealth> {
    const state = this.components.get(name);
    if (!state) throw new Error(`Component "${name}" not registered`);

    await this.runCheck(state);
    return { ...state.health };
  }

  /**
   * Run health checks on ALL components immediately
   */
  async checkAll(): Promise<SystemHealth> {
    const promises = Array.from(this.components.values()).map((state) => this.runCheck(state));
    await Promise.allSettled(promises);
    return this.getSystemHealth();
  }

  /**
   * Get current system-wide health status
   */
  getSystemHealth(): SystemHealth {
    const components: ComponentHealth[] = [];
    let healthy = 0;
    let degraded = 0;
    let unhealthy = 0;
    let unknown = 0;
    let criticalTotal = 0;
    let criticalHealthy = 0;

    for (const state of this.components.values()) {
      const health = { ...state.health };
      components.push(health);

      switch (health.status) {
        case 'healthy':
          healthy++;
          break;
        case 'degraded':
          degraded++;
          break;
        case 'unhealthy':
          unhealthy++;
          break;
        case 'unknown':
          unknown++;
          break;
      }

      if (health.critical) {
        criticalTotal++;
        if (health.status === 'healthy') criticalHealthy++;
      }
    }

    const total = components.length;

    // Overall system status
    let status: HealthStatus = 'healthy';
    if (unhealthy > 0 && components.some((c) => c.critical && c.status === 'unhealthy')) {
      status = 'unhealthy';
    } else if (unhealthy > 0 || degraded > 0) {
      status = 'degraded';
    } else if (unknown > 0 && healthy === 0) {
      status = 'unknown';
    }

    // Overall uptime
    const uptimes = components.filter((c) => c.totalChecks > 0).map((c) => c.uptime);
    const overallUptime =
      uptimes.length > 0
        ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length
        : 100;

    const activeAlerts = this.alerts.filter((a) => !a.resolvedAt);

    return {
      status,
      timestamp: new Date(),
      uptime: Math.round(overallUptime * 100) / 100,
      components,
      summary: {
        total,
        healthy,
        degraded,
        unhealthy,
        unknown,
        critical: { total: criticalTotal, healthy: criticalHealthy },
      },
      alerts: activeAlerts,
      diagnostics: this.getDiagnostics(),
    };
  }

  /**
   * Get component health by name
   */
  getComponentHealth(name: string): ComponentHealth | undefined {
    const state = this.components.get(name);
    return state ? { ...state.health } : undefined;
  }

  /**
   * Get all active (unresolved) alerts
   */
  getAlerts(options?: {
    severity?: 'info' | 'warning' | 'critical';
    component?: string;
    includeResolved?: boolean;
  }): HealthAlert[] {
    let filtered = [...this.alerts];

    if (!options?.includeResolved) {
      filtered = filtered.filter((a) => !a.resolvedAt);
    }

    if (options?.severity) {
      filtered = filtered.filter((a) => a.severity === options.severity);
    }

    if (options?.component) {
      filtered = filtered.filter((a) => a.component === options.component);
    }

    return filtered;
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    this.emit('alert:acknowledged', alert);
    return true;
  }

  /**
   * Get runtime diagnostics
   */
  getDiagnostics(): DiagnosticsData {
    const memUsage = process.memoryUsage();
    const uptimeSeconds = this.startedAt
      ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000)
      : 0;

    return {
      memoryUsageMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      memoryLimitMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      memoryUsagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
      cpuUsagePercent: null, // Would need os module or perf_hooks
      eventLoopDelayMs: 0, // Placeholder — real impl would use perf_hooks
      activeTimers: Array.from(this.components.values()).filter((s) => s.timer !== null).length,
      activeChecks: this.components.size,
      uptimeSeconds,
      nodeVersion: process.version,
      platform: process.platform,
    };
  }

  /**
   * Generate a voice-friendly health summary for TTS
   */
  getVoiceSummary(): string {
    const health = this.getSystemHealth();
    const { summary } = health;

    if (health.status === 'healthy') {
      return `All ${summary.total} systems are healthy. Overall uptime is ${health.uptime.toFixed(1)} percent.`;
    }

    const parts: string[] = [];

    if (summary.unhealthy > 0) {
      const unhealthyNames = health.components
        .filter((c) => c.status === 'unhealthy')
        .map((c) => c.name)
        .join(', ');
      parts.push(`${summary.unhealthy} system${summary.unhealthy > 1 ? 's' : ''} down: ${unhealthyNames}`);
    }

    if (summary.degraded > 0) {
      parts.push(`${summary.degraded} system${summary.degraded > 1 ? 's' : ''} degraded`);
    }

    parts.push(`${summary.healthy} of ${summary.total} healthy`);

    if (health.alerts.length > 0) {
      const criticalAlerts = health.alerts.filter((a) => a.severity === 'critical');
      if (criticalAlerts.length > 0) {
        parts.push(`${criticalAlerts.length} critical alert${criticalAlerts.length > 1 ? 's' : ''}`);
      }
    }

    return parts.join('. ') + '.';
  }

  /**
   * Check if monitor is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get list of registered component names
   */
  listComponents(): string[] {
    return Array.from(this.components.keys());
  }

  /**
   * Destroy and clean up
   */
  destroy(): void {
    this.stop();
    this.components.clear();
    this.alerts = [];
    this.removeAllListeners();
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  /**
   * Start periodic checks for a component
   */
  private startComponentChecks(state: ComponentState): void {
    // Run initial check
    this.runCheck(state).catch(() => {});

    // Set up periodic checks
    state.timer = setInterval(() => {
      this.runCheck(state).catch(() => {});
    }, state.config.intervalMs);
  }

  /**
   * Run a single health check
   */
  private async runCheck(state: ComponentState): Promise<void> {
    const startTime = Date.now();
    const { config, health } = state;

    try {
      // Run check with timeout
      const result = await this.runWithTimeout(
        config.check(),
        config.timeoutMs
      );

      const checkMs = Date.now() - startTime;
      this.recordCheckTime(state, checkMs);

      health.lastCheck = new Date();
      health.totalChecks++;
      health.lastCheckMs = checkMs;

      if (result) {
        this.handleSuccess(state);
      } else {
        this.handleFailure(state, 'Health check returned false');
      }
    } catch (error) {
      const checkMs = Date.now() - startTime;
      this.recordCheckTime(state, checkMs);

      health.lastCheck = new Date();
      health.totalChecks++;
      health.lastCheckMs = checkMs;

      const errMsg = error instanceof Error ? error.message : String(error);
      this.handleFailure(state, errMsg);
    }
  }

  /**
   * Handle a successful health check
   */
  private handleSuccess(state: ComponentState): void {
    const { health } = state;
    const previousStatus = health.status;

    health.consecutiveSuccesses++;
    health.consecutiveFailures = 0;
    health.lastSuccess = new Date();
    health.lastError = null;
    health.recovering = false;
    health.recoveryAttempts = 0;

    // Update uptime
    this.updateUptime(health);

    // Status transition
    if (previousStatus === 'unhealthy' || previousStatus === 'degraded') {
      if (health.consecutiveSuccesses >= state.config.recoveryThreshold) {
        health.status = 'healthy';
        this.emit('component:recovered', { name: health.name, from: previousStatus });

        // Resolve related alerts
        this.resolveAlerts(health.name);
      }
    } else {
      health.status = 'healthy';
    }

    this.emit('check:success', { name: health.name, status: health.status });
  }

  /**
   * Handle a failed health check
   */
  private handleFailure(state: ComponentState, errorMessage: string): void {
    const { config, health } = state;
    const previousStatus = health.status;

    health.consecutiveFailures++;
    health.consecutiveSuccesses = 0;
    health.lastFailure = new Date();
    health.lastError = errorMessage;
    health.totalFailures++;

    // Update uptime
    this.updateUptime(health);

    // Status transition
    if (health.consecutiveFailures >= config.unhealthyThreshold) {
      health.status = 'unhealthy';

      if (previousStatus !== 'unhealthy') {
        const alert = this.createAlert(
          health.critical ? 'critical' : 'warning',
          health.name,
          `${health.name} is unhealthy after ${health.consecutiveFailures} consecutive failures: ${errorMessage}`
        );

        this.emit('component:unhealthy', { name: health.name, error: errorMessage, alert });

        // Attempt recovery
        if (this.config.enableRecovery && config.recover) {
          this.attemptRecovery(state);
        }
      }
    } else if (health.consecutiveFailures >= config.degradedThreshold) {
      health.status = 'degraded';

      if (previousStatus === 'healthy' || previousStatus === 'unknown') {
        this.createAlert(
          'warning',
          health.name,
          `${health.name} is degraded: ${errorMessage}`
        );

        this.emit('component:degraded', { name: health.name, error: errorMessage });
      }
    }

    this.emit('check:failure', {
      name: health.name,
      error: errorMessage,
      consecutiveFailures: health.consecutiveFailures,
      status: health.status,
    });
  }

  /**
   * Attempt automatic recovery
   */
  private async attemptRecovery(state: ComponentState): Promise<void> {
    const { config, health } = state;

    if (health.recovering) return;
    if (health.recoveryAttempts >= config.maxRecoveryAttempts) {
      this.createAlert(
        'critical',
        health.name,
        `Recovery failed for ${health.name} after ${health.recoveryAttempts} attempts`
      );
      this.emit('recovery:exhausted', { name: health.name, attempts: health.recoveryAttempts });
      return;
    }

    health.recovering = true;
    health.recoveryAttempts++;

    this.emit('recovery:attempting', {
      name: health.name,
      attempt: health.recoveryAttempts,
    });

    try {
      const recovered = await this.runWithTimeout(
        config.recover(),
        config.timeoutMs * 2
      );

      if (recovered) {
        this.emit('recovery:success', { name: health.name, attempt: health.recoveryAttempts });
        // Recovery will be confirmed on the next successful health check
      } else {
        this.emit('recovery:failed', {
          name: health.name,
          attempt: health.recoveryAttempts,
          reason: 'Recovery function returned false',
        });
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.emit('recovery:failed', {
        name: health.name,
        attempt: health.recoveryAttempts,
        reason: errMsg,
      });
    }

    health.recovering = false;
  }

  /**
   * Record check time for average calculation
   */
  private recordCheckTime(state: ComponentState, ms: number): void {
    state.checkTimes.push(ms);
    // Keep last 100 check times
    if (state.checkTimes.length > 100) {
      state.checkTimes.shift();
    }
    state.health.averageCheckMs = Math.round(
      state.checkTimes.reduce((a, b) => a + b, 0) / state.checkTimes.length
    );
  }

  /**
   * Update uptime percentage
   */
  private updateUptime(health: ComponentHealth): void {
    if (health.totalChecks > 0) {
      health.uptime = Math.round(
        ((health.totalChecks - health.totalFailures) / health.totalChecks) * 10000
      ) / 100;
    }
  }

  /**
   * Create and store an alert
   */
  private createAlert(
    severity: 'info' | 'warning' | 'critical',
    component: string,
    message: string
  ): HealthAlert {
    const alert: HealthAlert = {
      id: `alert-${++this.alertIdCounter}`,
      severity,
      component,
      message,
      timestamp: new Date(),
      acknowledged: false,
      resolvedAt: null,
    };

    this.alerts.push(alert);

    // Trim old alerts
    if (this.alerts.length > this.config.maxAlerts) {
      this.alerts = this.alerts.slice(-this.config.maxAlerts);
    }

    this.config.onAlert(alert);
    this.emit('alert', alert);

    return alert;
  }

  /**
   * Resolve all active alerts for a component
   */
  private resolveAlerts(componentName: string): void {
    const now = new Date();
    for (const alert of this.alerts) {
      if (alert.component === componentName && !alert.resolvedAt) {
        alert.resolvedAt = now;
        this.emit('alert:resolved', alert);
      }
    }
  }

  /**
   * Run a promise with timeout
   */
  private runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Health check timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
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
}

// ─── Pre-built Health Checks ─────────────────────────────────────────────────

/**
 * Factory for common health check configurations used across the platform.
 */
export const HealthChecks = {
  /**
   * Check if a SQLite database is accessible
   */
  sqlite: (name: string, queryFn: () => Promise<any>): HealthCheckConfig => ({
    name,
    type: 'storage',
    check: async () => {
      try {
        await queryFn();
        return true;
      } catch {
        return false;
      }
    },
    intervalMs: 30000,
    timeoutMs: 5000,
    critical: true,
    unhealthyThreshold: 2,
  }),

  /**
   * Check if an external API is reachable
   */
  externalApi: (name: string, pingFn: () => Promise<boolean>): HealthCheckConfig => ({
    name,
    type: 'external',
    check: pingFn,
    intervalMs: 60000,
    timeoutMs: 10000,
    unhealthyThreshold: 3,
    degradedThreshold: 1,
  }),

  /**
   * Check if the OpenClaw node bridge is connected
   */
  nodeBridge: (name: string, isConnected: () => boolean): HealthCheckConfig => ({
    name,
    type: 'bridge',
    check: async () => isConnected(),
    intervalMs: 15000,
    timeoutMs: 3000,
    critical: true,
    unhealthyThreshold: 2,
  }),

  /**
   * Check if voice services (STT/TTS) are working
   */
  voiceService: (name: string, testFn: () => Promise<boolean>): HealthCheckConfig => ({
    name,
    type: 'voice',
    check: testFn,
    intervalMs: 60000,
    timeoutMs: 10000,
    unhealthyThreshold: 3,
  }),

  /**
   * Check if an agent can process a basic test case
   */
  agent: (name: string, testFn: () => Promise<boolean>): HealthCheckConfig => ({
    name,
    type: 'agent',
    check: testFn,
    intervalMs: 120000,
    timeoutMs: 15000,
    unhealthyThreshold: 2,
    degradedThreshold: 1,
  }),

  /**
   * Check memory usage doesn't exceed threshold
   */
  memory: (thresholdPercent: number = 85): HealthCheckConfig => ({
    name: 'memory',
    type: 'infrastructure',
    check: async () => {
      const mem = process.memoryUsage();
      const usagePercent = (mem.heapUsed / mem.heapTotal) * 100;
      return usagePercent < thresholdPercent;
    },
    intervalMs: 30000,
    timeoutMs: 1000,
    critical: true,
    unhealthyThreshold: 3,
    degradedThreshold: 1,
  }),

  /**
   * Generic custom health check
   */
  custom: (
    name: string,
    type: ComponentType,
    check: () => Promise<boolean>,
    options?: Partial<HealthCheckConfig>
  ): HealthCheckConfig => ({
    name,
    type,
    check,
    intervalMs: options?.intervalMs ?? 30000,
    timeoutMs: options?.timeoutMs ?? 5000,
    ...options,
  }),
};
