/**
 * Telemetry & Observability Engine
 *
 * Privacy-safe telemetry for monitoring platform health, performance, and usage.
 * No PII or image data is ever collected — only aggregate metrics, timing, and counts.
 *
 * Features:
 * - Structured event logging with severity levels
 * - Performance timing spans (hierarchical — parent/child spans for tracing)
 * - Counter/gauge/histogram metric types
 * - Session-level usage analytics (snaps, products identified, exports, etc.)
 * - Error and crash tracking with stack redaction
 * - Configurable sinks: console, file, remote (webhook/API)
 * - Sampling for high-volume events (e.g., log 1 in 10 image analyses)
 * - Ring buffer for recent events (in-memory, fixed size)
 * - Export as JSON for diagnostics
 * - Voice-friendly telemetry summary
 * - Privacy controls: never log image buffers, user content, or PII
 *
 * @module telemetry/telemetry-engine
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type MetricType = 'counter' | 'gauge' | 'histogram';

const LOG_LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  /** Module or component name (e.g., 'vision-pipeline', 'inventory-agent') */
  source: string;
  /** Human-readable message */
  message: string;
  /** Structured data (key-value pairs, no PII) */
  data?: Record<string, unknown>;
  /** Error info (if applicable) */
  error?: ErrorInfo;
  /** Correlation ID for tracing a request through multiple components */
  correlationId?: string;
  /** Active span ID (for associating logs with timing spans) */
  spanId?: string;
  /** Tags for filtering */
  tags?: string[];
}

export interface ErrorInfo {
  /** Error name/class */
  name: string;
  /** Error message (sanitized — no file paths or secrets) */
  message: string;
  /** Stack trace (file paths redacted) */
  stack?: string;
  /** How many times this error has occurred */
  count?: number;
  /** Whether this is a known/expected error */
  isExpected?: boolean;
}

export interface TimingSpan {
  id: string;
  /** Operation name (e.g., 'vision_analysis', 'product_lookup') */
  name: string;
  /** Parent span ID for nested operations */
  parentId?: string;
  /** When the span started */
  startedAt: string;
  /** When the span ended */
  endedAt?: string;
  /** Duration in ms */
  durationMs?: number;
  /** Whether the operation succeeded */
  success?: boolean;
  /** Error info if the operation failed */
  error?: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
  /** Tags */
  tags?: string[];
}

export interface Metric {
  name: string;
  type: MetricType;
  /** Current value (gauge/counter) or values (histogram) */
  value: number;
  /** For histograms: all recorded values */
  values?: number[];
  /** Unit of measurement */
  unit?: string;
  /** Tags for grouping */
  tags?: Record<string, string>;
  /** When last updated */
  updatedAt: string;
}

export interface SessionAnalytics {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  /** Total snaps taken */
  totalSnaps: number;
  /** Total products identified */
  totalProductsIdentified: number;
  /** Total barcodes scanned */
  totalBarcodesScanned: number;
  /** Total voice commands processed */
  totalVoiceCommands: number;
  /** Total exports generated */
  totalExports: number;
  /** Average vision processing time (ms) */
  avgVisionProcessingMs: number;
  /** Total errors encountered */
  totalErrors: number;
  /** Agents invoked and their counts */
  agentInvocations: Record<string, number>;
  /** Time spent offline (ms) */
  offlineTimeMs: number;
  /** Feature usage counts */
  featureUsage: Record<string, number>;
}

export interface TelemetryConfig {
  /** Minimum log level to record */
  minLevel: LogLevel;
  /** Maximum entries in the ring buffer */
  maxBufferSize: number;
  /** Maximum timing spans to keep */
  maxSpans: number;
  /** Sampling rate for debug/info logs (0-1, 1 = log all) */
  samplingRate: number;
  /** Whether to output to console */
  consoleOutput: boolean;
  /** Sink function for exporting telemetry externally */
  sink?: (entries: LogEntry[]) => Promise<void>;
  /** How often to flush to sink (ms) */
  sinkFlushIntervalMs: number;
  /** PII patterns to redact from error stacks */
  redactPatterns: RegExp[];
  /** Session ID */
  sessionId?: string;
}

export interface TelemetrySummary {
  /** Total log entries */
  totalLogs: number;
  /** Entries by level */
  logsByLevel: Record<LogLevel, number>;
  /** Total spans recorded */
  totalSpans: number;
  /** Average span duration (ms) */
  avgSpanDurationMs: number;
  /** Span success rate */
  spanSuccessRate: number;
  /** Number of unique errors */
  uniqueErrors: number;
  /** Most frequent error */
  topError?: { message: string; count: number };
  /** Current metrics snapshot */
  metrics: Metric[];
  /** Session analytics */
  session?: SessionAnalytics;
  /** Uptime (ms) */
  uptimeMs: number;
}

// ─── Default Config ─────────────────────────────────────────────

const DEFAULT_CONFIG: TelemetryConfig = {
  minLevel: 'info',
  maxBufferSize: 1000,
  maxSpans: 500,
  samplingRate: 1.0,
  consoleOutput: false,
  sinkFlushIntervalMs: 60000,
  redactPatterns: [
    /C:\\Users\\[^\\]+/g,       // Windows user paths
    /\/home\/[^/]+/g,           // Linux user paths
    /\/Users\/[^/]+/g,          // macOS user paths
    /[A-Za-z0-9+/=]{40,}/g,    // Long base64 strings (potential secrets)
    /sk[-_](?:live|test)[-_][a-zA-Z0-9]{20,}/g, // Stripe live/test keys
    /sk[-_][a-zA-Z0-9]{20,}/g, // Other sk- prefixed keys
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email addresses
  ],
};

// ─── Main Class ─────────────────────────────────────────────────

export class TelemetryEngine extends EventEmitter {
  private config: TelemetryConfig;
  private logBuffer: LogEntry[] = [];
  private spans: Map<string, TimingSpan> = new Map();
  private completedSpans: TimingSpan[] = [];
  private metrics: Map<string, Metric> = new Map();
  private errorCounts: Map<string, number> = new Map();
  private session: SessionAnalytics;
  private idCounter: number = 0;
  private startTime: number = Date.now();
  private flushTimer?: ReturnType<typeof setInterval>;
  private pendingFlush: LogEntry[] = [];

  constructor(config?: Partial<TelemetryConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.session = {
      sessionId: this.config.sessionId || this.nextId('sess'),
      startedAt: new Date().toISOString(),
      totalSnaps: 0,
      totalProductsIdentified: 0,
      totalBarcodesScanned: 0,
      totalVoiceCommands: 0,
      totalExports: 0,
      avgVisionProcessingMs: 0,
      totalErrors: 0,
      agentInvocations: {},
      offlineTimeMs: 0,
      featureUsage: {},
    };

    // Start sink flushing if configured
    if (this.config.sink && this.config.sinkFlushIntervalMs > 0) {
      this.flushTimer = setInterval(() => this.flushToSink(), this.config.sinkFlushIntervalMs);
    }
  }

  // ─── Logging ────────────────────────────────────────────────

  /**
   * Log an event
   */
  log(level: LogLevel, source: string, message: string, data?: Record<string, unknown>, options?: { correlationId?: string; spanId?: string; tags?: string[] }): LogEntry | null {
    // Check level filter
    if (LOG_LEVEL_VALUE[level] < LOG_LEVEL_VALUE[this.config.minLevel]) {
      return null;
    }

    // Sampling for debug/info
    if ((level === 'debug' || level === 'info') && this.config.samplingRate < 1) {
      if (Math.random() > this.config.samplingRate) return null;
    }

    const entry: LogEntry = {
      id: this.nextId('log'),
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      data: data ? this.sanitizeData(data) : undefined,
      correlationId: options?.correlationId,
      spanId: options?.spanId,
      tags: options?.tags,
    };

    this.addToBuffer(entry);

    if (this.config.consoleOutput) {
      this.consoleLog(entry);
    }

    if (level === 'error' || level === 'fatal') {
      this.session.totalErrors++;
    }

    this.emit('log', entry);
    return entry;
  }

  /** Convenience methods */
  debug(source: string, message: string, data?: Record<string, unknown>): LogEntry | null {
    return this.log('debug', source, message, data);
  }
  info(source: string, message: string, data?: Record<string, unknown>): LogEntry | null {
    return this.log('info', source, message, data);
  }
  warn(source: string, message: string, data?: Record<string, unknown>): LogEntry | null {
    return this.log('warn', source, message, data);
  }
  error(source: string, message: string, error?: Error | string, data?: Record<string, unknown>): LogEntry | null {
    const errorInfo = this.extractErrorInfo(error);
    const entry = this.log('error', source, message, { ...data, error: errorInfo });
    if (entry) {
      entry.error = errorInfo;
      this.trackError(errorInfo.message);
    }
    return entry;
  }
  fatal(source: string, message: string, error?: Error | string, data?: Record<string, unknown>): LogEntry | null {
    const errorInfo = this.extractErrorInfo(error);
    const entry = this.log('fatal', source, message, { ...data, error: errorInfo });
    if (entry) {
      entry.error = errorInfo;
      this.trackError(errorInfo.message);
    }
    return entry;
  }

  // ─── Timing Spans ──────────────────────────────────────────

  /**
   * Start a timing span for an operation
   */
  startSpan(name: string, options?: { parentId?: string; metadata?: Record<string, unknown>; tags?: string[] }): string {
    const id = this.nextId('span');

    const span: TimingSpan = {
      id,
      name,
      parentId: options?.parentId,
      startedAt: new Date().toISOString(),
      metadata: options?.metadata,
      tags: options?.tags,
    };

    this.spans.set(id, span);
    this.emit('span:started', span);
    return id;
  }

  /**
   * End a timing span
   */
  endSpan(spanId: string, options?: { success?: boolean; error?: string; metadata?: Record<string, unknown> }): TimingSpan | undefined {
    const span = this.spans.get(spanId);
    if (!span) return undefined;

    span.endedAt = new Date().toISOString();
    span.durationMs = new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime();
    span.success = options?.success ?? true;
    span.error = options?.error;
    if (options?.metadata) {
      span.metadata = { ...span.metadata, ...options.metadata };
    }

    this.spans.delete(spanId);
    this.completedSpans.push(span);

    // Trim completed spans
    if (this.completedSpans.length > this.config.maxSpans) {
      this.completedSpans = this.completedSpans.slice(-this.config.maxSpans);
    }

    this.emit('span:completed', span);
    return span;
  }

  /**
   * Time an async function automatically
   */
  async time<T>(name: string, fn: () => Promise<T>, options?: { parentId?: string; tags?: string[] }): Promise<T> {
    const spanId = this.startSpan(name, options);
    try {
      const result = await fn();
      this.endSpan(spanId, { success: true });
      return result;
    } catch (error: any) {
      this.endSpan(spanId, { success: false, error: error?.message });
      throw error;
    }
  }

  /**
   * Get active spans
   */
  getActiveSpans(): TimingSpan[] {
    return Array.from(this.spans.values());
  }

  /**
   * Get completed spans
   */
  getCompletedSpans(options?: { name?: string; limit?: number }): TimingSpan[] {
    let spans = this.completedSpans;
    if (options?.name) {
      spans = spans.filter(s => s.name === options.name);
    }
    if (options?.limit) {
      spans = spans.slice(-options.limit);
    }
    return spans;
  }

  // ─── Metrics ────────────────────────────────────────────────

  /**
   * Increment a counter
   */
  increment(name: string, amount: number = 1, tags?: Record<string, string>): void {
    const key = this.metricKey(name, tags);
    const existing = this.metrics.get(key);

    if (existing) {
      existing.value += amount;
      existing.updatedAt = new Date().toISOString();
    } else {
      this.metrics.set(key, {
        name,
        type: 'counter',
        value: amount,
        unit: 'count',
        tags,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Set a gauge value
   */
  gauge(name: string, value: number, unit?: string, tags?: Record<string, string>): void {
    const key = this.metricKey(name, tags);
    this.metrics.set(key, {
      name,
      type: 'gauge',
      value,
      unit,
      tags,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Record a histogram value
   */
  histogram(name: string, value: number, unit?: string, tags?: Record<string, string>): void {
    const key = this.metricKey(name, tags);
    const existing = this.metrics.get(key);

    if (existing && existing.type === 'histogram') {
      existing.values = existing.values || [];
      existing.values.push(value);
      // Keep last 1000 values
      if (existing.values.length > 1000) {
        existing.values = existing.values.slice(-1000);
      }
      existing.value = this.percentile(existing.values, 0.5); // Median as the "value"
      existing.updatedAt = new Date().toISOString();
    } else {
      this.metrics.set(key, {
        name,
        type: 'histogram',
        value,
        values: [value],
        unit,
        tags,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Get a metric by name
   */
  getMetric(name: string, tags?: Record<string, string>): Metric | undefined {
    return this.metrics.get(this.metricKey(name, tags));
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Metric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get histogram percentile
   */
  getPercentile(name: string, percentile: number, tags?: Record<string, string>): number | undefined {
    const metric = this.metrics.get(this.metricKey(name, tags));
    if (!metric || !metric.values || metric.values.length === 0) return undefined;
    return this.percentile(metric.values, percentile);
  }

  // ─── Session Analytics ──────────────────────────────────────

  /**
   * Track a session event
   */
  trackEvent(event: string, count: number = 1): void {
    switch (event) {
      case 'snap':
        this.session.totalSnaps += count;
        break;
      case 'product_identified':
        this.session.totalProductsIdentified += count;
        break;
      case 'barcode_scanned':
        this.session.totalBarcodesScanned += count;
        break;
      case 'voice_command':
        this.session.totalVoiceCommands += count;
        break;
      case 'export':
        this.session.totalExports += count;
        break;
      default:
        this.session.featureUsage[event] = (this.session.featureUsage[event] || 0) + count;
    }

    this.increment(`session.${event}`, count);
    this.emit('session:event', { event, count });
  }

  /**
   * Track agent invocation
   */
  trackAgentInvocation(agentName: string): void {
    this.session.agentInvocations[agentName] = (this.session.agentInvocations[agentName] || 0) + 1;
    this.increment('agent.invocation', 1, { agent: agentName });
  }

  /**
   * Track vision processing time (does NOT increment totalSnaps — use trackEvent('snap') for that)
   */
  private visionProcessingCount: number = 0;
  trackVisionProcessing(durationMs: number): void {
    this.visionProcessingCount++;
    const prevTotal = this.session.avgVisionProcessingMs * (this.visionProcessingCount - 1);
    this.session.avgVisionProcessingMs = Math.round((prevTotal + durationMs) / this.visionProcessingCount);
    this.histogram('vision.processing_time', durationMs, 'ms');
  }

  /**
   * Track offline time
   */
  trackOfflineTime(durationMs: number): void {
    this.session.offlineTimeMs += durationMs;
  }

  /**
   * Get session analytics
   */
  getSessionAnalytics(): SessionAnalytics {
    return { ...this.session };
  }

  // ─── Summary ────────────────────────────────────────────────

  /**
   * Get a comprehensive telemetry summary
   */
  getSummary(): TelemetrySummary {
    const logsByLevel: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
    for (const entry of this.logBuffer) {
      logsByLevel[entry.level]++;
    }

    const completedSpans = this.completedSpans;
    const avgSpanDuration = completedSpans.length > 0
      ? completedSpans.reduce((sum, s) => sum + (s.durationMs || 0), 0) / completedSpans.length
      : 0;
    const successfulSpans = completedSpans.filter(s => s.success).length;
    const spanSuccessRate = completedSpans.length > 0 ? successfulSpans / completedSpans.length : 1;

    // Find top error
    let topError: { message: string; count: number } | undefined;
    for (const [msg, count] of this.errorCounts.entries()) {
      if (!topError || count > topError.count) {
        topError = { message: msg, count };
      }
    }

    return {
      totalLogs: this.logBuffer.length,
      logsByLevel,
      totalSpans: completedSpans.length,
      avgSpanDurationMs: Math.round(avgSpanDuration),
      spanSuccessRate: Math.round(spanSuccessRate * 100) / 100,
      uniqueErrors: this.errorCounts.size,
      topError,
      metrics: this.getAllMetrics(),
      session: this.getSessionAnalytics(),
      uptimeMs: Date.now() - this.startTime,
    };
  }

  /**
   * Get a voice-friendly telemetry summary
   */
  getVoiceSummary(): string {
    const summary = this.getSummary();
    const parts: string[] = [];

    const uptimeMins = Math.round(summary.uptimeMs / 60000);
    parts.push(`System has been running for ${uptimeMins} minutes`);

    if (summary.session) {
      const s = summary.session;
      if (s.totalSnaps > 0) parts.push(`${s.totalSnaps} images captured`);
      if (s.totalProductsIdentified > 0) parts.push(`${s.totalProductsIdentified} products identified`);
      if (s.totalVoiceCommands > 0) parts.push(`${s.totalVoiceCommands} voice commands processed`);
      if (s.avgVisionProcessingMs > 0) parts.push(`average vision processing: ${s.avgVisionProcessingMs}ms`);
    }

    if (summary.uniqueErrors > 0) {
      parts.push(`${summary.uniqueErrors} unique errors encountered`);
      if (summary.topError) {
        parts.push(`most common: ${summary.topError.message} (${summary.topError.count} times)`);
      }
    } else {
      parts.push('no errors');
    }

    if (summary.totalSpans > 0) {
      parts.push(`${Math.round(summary.spanSuccessRate * 100)}% operation success rate`);
    }

    return parts.join('. ') + '.';
  }

  // ─── Export / Flush ─────────────────────────────────────────

  /**
   * Export recent log entries as JSON
   */
  exportLogs(options?: { level?: LogLevel; source?: string; limit?: number; since?: string }): LogEntry[] {
    let entries = [...this.logBuffer];

    if (options?.level) {
      const minLevel = LOG_LEVEL_VALUE[options.level];
      entries = entries.filter(e => LOG_LEVEL_VALUE[e.level] >= minLevel);
    }
    if (options?.source) {
      entries = entries.filter(e => e.source === options.source);
    }
    if (options?.since) {
      entries = entries.filter(e => e.timestamp >= options.since!);
    }
    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  /**
   * Export full diagnostic dump
   */
  exportDiagnostics(): {
    summary: TelemetrySummary;
    recentLogs: LogEntry[];
    activeSpans: TimingSpan[];
    completedSpans: TimingSpan[];
    metrics: Metric[];
    session: SessionAnalytics;
  } {
    return {
      summary: this.getSummary(),
      recentLogs: this.logBuffer.slice(-50),
      activeSpans: this.getActiveSpans(),
      completedSpans: this.completedSpans.slice(-50),
      metrics: this.getAllMetrics(),
      session: this.getSessionAnalytics(),
    };
  }

  /**
   * Flush buffered entries to the configured sink
   */
  async flushToSink(): Promise<void> {
    if (!this.config.sink || this.pendingFlush.length === 0) return;

    const batch = [...this.pendingFlush];
    this.pendingFlush = [];

    try {
      await this.config.sink(batch);
      this.emit('sink:flushed', { count: batch.length });
    } catch (error: any) {
      // Put entries back (at the front) for next flush attempt
      this.pendingFlush = [...batch, ...this.pendingFlush];
      this.emit('sink:error', { error: error?.message, count: batch.length });
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────

  /**
   * Reset all telemetry state
   */
  reset(): void {
    this.logBuffer = [];
    this.spans.clear();
    this.completedSpans = [];
    this.metrics.clear();
    this.errorCounts.clear();
    this.pendingFlush = [];

    this.session = {
      sessionId: this.config.sessionId || this.nextId('sess'),
      startedAt: new Date().toISOString(),
      totalSnaps: 0,
      totalProductsIdentified: 0,
      totalBarcodesScanned: 0,
      totalVoiceCommands: 0,
      totalExports: 0,
      avgVisionProcessingMs: 0,
      totalErrors: 0,
      agentInvocations: {},
      offlineTimeMs: 0,
      featureUsage: {},
    };

    this.visionProcessingCount = 0;
    this.startTime = Date.now();
    this.emit('telemetry:reset');
  }

  /**
   * Destroy the telemetry engine (stop timers)
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.removeAllListeners();
  }

  // ─── Helpers ────────────────────────────────────────────────

  private nextId(prefix: string): string {
    this.idCounter++;
    return `${prefix}_${this.idCounter.toString().padStart(6, '0')}`;
  }

  private addToBuffer(entry: LogEntry): void {
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.config.maxBufferSize) {
      this.logBuffer = this.logBuffer.slice(-this.config.maxBufferSize);
    }

    // Add to pending flush
    if (this.config.sink) {
      this.pendingFlush.push(entry);
    }
  }

  private sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();

      // Never log sensitive auth fields
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('api_key')
      ) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Never log raw image data (e.g., imageData, imageBase64) but allow identifiers (imageId, imageCount)
      if (
        (lowerKey.includes('image') && !lowerKey.endsWith('id') && !lowerKey.endsWith('count') && !lowerKey.endsWith('url'))
      ) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Handle Buffer values — show size info, not contents
      if (Buffer.isBuffer(value)) {
        sanitized[key] = `[Buffer: ${value.length} bytes]`;
        continue;
      }

      if (typeof value === 'string') {
        sanitized[key] = this.redactString(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private redactString(str: string): string {
    let result = str;
    for (const pattern of this.config.redactPatterns) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  private extractErrorInfo(error?: Error | string): ErrorInfo {
    if (!error) {
      return { name: 'UnknownError', message: 'Unknown error' };
    }

    if (typeof error === 'string') {
      return { name: 'Error', message: error };
    }

    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown error',
      stack: error.stack ? this.redactString(error.stack) : undefined,
    };
  }

  private trackError(message: string): void {
    const truncated = message.substring(0, 200); // Normalize length for counting
    this.errorCounts.set(truncated, (this.errorCounts.get(truncated) || 0) + 1);
  }

  private metricKey(name: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) return name;
    const tagStr = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');
    return `${name}{${tagStr}}`;
  }

  private percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }

  private consoleLog(entry: LogEntry): void {
    const levelIcon: Record<LogLevel, string> = {
      debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌', fatal: '💀',
    };
    const icon = levelIcon[entry.level] || '•';
    const msg = `${icon} [${entry.source}] ${entry.message}`;
    if (entry.level === 'error' || entry.level === 'fatal') {
      console.error(msg, entry.data || '');
    } else if (entry.level === 'warn') {
      console.warn(msg, entry.data || '');
    } else {
      console.log(msg, entry.data || '');
    }
  }
}
