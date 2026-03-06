/**
 * Tests for Telemetry & Observability Engine
 * @module telemetry/telemetry-engine.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TelemetryEngine,
  TelemetryConfig,
  LogLevel,
} from './telemetry-engine.js';

// ─── Helpers ────────────────────────────────────────────────────

function createEngine(overrides?: Partial<TelemetryConfig>): TelemetryEngine {
  return new TelemetryEngine({
    minLevel: 'debug',
    consoleOutput: false,
    ...overrides,
  });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('TelemetryEngine — Logging', () => {
  let engine: TelemetryEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('should log at different levels', () => {
    const d = engine.debug('test', 'debug message');
    const i = engine.info('test', 'info message');
    const w = engine.warn('test', 'warn message');
    const e = engine.error('test', 'error message');
    const f = engine.fatal('test', 'fatal message');

    expect(d?.level).toBe('debug');
    expect(i?.level).toBe('info');
    expect(w?.level).toBe('warn');
    expect(e?.level).toBe('error');
    expect(f?.level).toBe('fatal');
  });

  it('should filter by minimum level', () => {
    const engine = createEngine({ minLevel: 'warn' });
    expect(engine.debug('test', 'hidden')).toBeNull();
    expect(engine.info('test', 'hidden')).toBeNull();
    expect(engine.warn('test', 'visible')).not.toBeNull();
    expect(engine.error('test', 'visible')).not.toBeNull();
  });

  it('should include structured data', () => {
    const entry = engine.info('vision', 'processed image', { imageId: 'img_1', duration: 150 });
    expect(entry?.data?.imageId).toBe('img_1');
    expect(entry?.data?.duration).toBe(150);
  });

  it('should sanitize sensitive data', () => {
    const entry = engine.info('test', 'with sensitive', {
      password: 'secret123',
      apiKey: 'sk-live-12345',
      buffer: Buffer.from('image data'),
      imageData: 'base64...',
      normalField: 'visible',
    });

    expect(entry?.data?.password).toBe('[REDACTED]');
    expect(entry?.data?.apiKey).toBe('[REDACTED]');
    expect(entry?.data?.buffer).toContain('Buffer');
    expect(entry?.data?.buffer).toContain('bytes');
    expect(entry?.data?.imageData).toBe('[REDACTED]');
    expect(entry?.data?.normalField).toBe('visible');
  });

  it('should redact file paths in strings', () => {
    const entry = engine.info('test', 'path data', {
      path: 'Error at C:\\Users\\john\\project\\file.ts:42',
    });
    expect(entry?.data?.path).toContain('[REDACTED]');
    expect(entry?.data?.path).not.toContain('john');
  });

  it('should redact email addresses', () => {
    const entry = engine.info('test', 'email data', {
      info: 'Contact user@example.com for help',
    });
    expect(entry?.data?.info).toContain('[REDACTED]');
    expect(entry?.data?.info).not.toContain('user@example.com');
  });

  it('should include correlation and span IDs', () => {
    const entry = engine.log('info', 'test', 'traced', undefined, {
      correlationId: 'req_123',
      spanId: 'span_456',
    });
    expect(entry?.correlationId).toBe('req_123');
    expect(entry?.spanId).toBe('span_456');
  });

  it('should include tags', () => {
    const entry = engine.log('info', 'test', 'tagged', undefined, { tags: ['inventory', 'scan'] });
    expect(entry?.tags).toEqual(['inventory', 'scan']);
  });

  it('should extract error info from Error object', () => {
    const err = new Error('Something broke');
    const entry = engine.error('test', 'operation failed', err);
    expect(entry?.error).toBeDefined();
    expect(entry?.error?.name).toBe('Error');
    expect(entry?.error?.message).toBe('Something broke');
    expect(entry?.error?.stack).toBeDefined();
  });

  it('should extract error info from string', () => {
    const entry = engine.error('test', 'string error', 'bad thing happened');
    expect(entry?.error?.message).toBe('bad thing happened');
  });

  it('should handle missing error gracefully', () => {
    const entry = engine.error('test', 'no error object');
    expect(entry?.error?.message).toBe('Unknown error');
  });

  it('should cap buffer size', () => {
    const engine = createEngine({ maxBufferSize: 5 });
    for (let i = 0; i < 10; i++) {
      engine.info('test', `message ${i}`);
    }
    const logs = engine.exportLogs();
    expect(logs.length).toBe(5);
    expect(logs[0].message).toBe('message 5'); // Oldest kept
  });

  it('should emit log events', () => {
    const handler = vi.fn();
    engine.on('log', handler);
    engine.info('test', 'event test');
    expect(handler).toHaveBeenCalled();
  });

  it('should apply sampling for debug logs', () => {
    const engine = createEngine({ samplingRate: 0 }); // Sample none
    const entry = engine.debug('test', 'should be sampled out');
    expect(entry).toBeNull();
  });

  it('should not sample warn/error/fatal', () => {
    const engine = createEngine({ samplingRate: 0 });
    expect(engine.warn('test', 'always logged')).not.toBeNull();
    expect(engine.error('test', 'always logged')).not.toBeNull();
    expect(engine.fatal('test', 'always logged')).not.toBeNull();
  });
});

describe('TelemetryEngine — Timing Spans', () => {
  let engine: TelemetryEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('should start and end a span', async () => {
    const spanId = engine.startSpan('test_operation');
    await new Promise(r => setTimeout(r, 10));
    const span = engine.endSpan(spanId);

    expect(span).toBeDefined();
    expect(span!.name).toBe('test_operation');
    expect(span!.durationMs).toBeGreaterThanOrEqual(9);
    expect(span!.success).toBe(true);
  });

  it('should create nested spans', () => {
    const parentId = engine.startSpan('parent');
    const childId = engine.startSpan('child', { parentId });
    engine.endSpan(childId);
    engine.endSpan(parentId);

    const completed = engine.getCompletedSpans();
    const child = completed.find(s => s.name === 'child');
    expect(child?.parentId).toBe(parentId);
  });

  it('should mark failed spans', () => {
    const spanId = engine.startSpan('failing');
    const span = engine.endSpan(spanId, { success: false, error: 'timeout' });
    expect(span?.success).toBe(false);
    expect(span?.error).toBe('timeout');
  });

  it('should return undefined for unknown span', () => {
    expect(engine.endSpan('nonexistent')).toBeUndefined();
  });

  it('should track active spans', () => {
    const id1 = engine.startSpan('active1');
    const id2 = engine.startSpan('active2');
    expect(engine.getActiveSpans()).toHaveLength(2);

    engine.endSpan(id1);
    expect(engine.getActiveSpans()).toHaveLength(1);
  });

  it('should filter completed spans by name', () => {
    engine.startSpan('a');
    engine.startSpan('b');
    engine.endSpan(engine.getActiveSpans().find(s => s.name === 'a')!.id);
    engine.endSpan(engine.getActiveSpans().find(s => s.name === 'b')!.id);

    const aSpans = engine.getCompletedSpans({ name: 'a' });
    expect(aSpans).toHaveLength(1);
    expect(aSpans[0].name).toBe('a');
  });

  it('should limit completed spans', () => {
    for (let i = 0; i < 5; i++) {
      const id = engine.startSpan(`span_${i}`);
      engine.endSpan(id);
    }
    const last2 = engine.getCompletedSpans({ limit: 2 });
    expect(last2).toHaveLength(2);
  });

  it('should include span metadata', () => {
    const id = engine.startSpan('meta', { metadata: { key: 'value' } });
    const span = engine.endSpan(id, { metadata: { result: 'ok' } });
    expect(span?.metadata?.key).toBe('value');
    expect(span?.metadata?.result).toBe('ok');
  });

  it('should emit span events', () => {
    const startHandler = vi.fn();
    const completeHandler = vi.fn();
    engine.on('span:started', startHandler);
    engine.on('span:completed', completeHandler);

    const id = engine.startSpan('evented');
    engine.endSpan(id);

    expect(startHandler).toHaveBeenCalled();
    expect(completeHandler).toHaveBeenCalled();
  });
});

describe('TelemetryEngine — time() helper', () => {
  let engine: TelemetryEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('should time a successful async function', async () => {
    const result = await engine.time('fetch_data', async () => {
      await new Promise(r => setTimeout(r, 10));
      return 42;
    });

    expect(result).toBe(42);
    const spans = engine.getCompletedSpans({ name: 'fetch_data' });
    expect(spans).toHaveLength(1);
    expect(spans[0].success).toBe(true);
    expect(spans[0].durationMs).toBeGreaterThanOrEqual(9);
  });

  it('should time a failing async function', async () => {
    await expect(
      engine.time('failing_op', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');

    const spans = engine.getCompletedSpans({ name: 'failing_op' });
    expect(spans).toHaveLength(1);
    expect(spans[0].success).toBe(false);
    expect(spans[0].error).toBe('boom');
  });
});

describe('TelemetryEngine — Metrics', () => {
  let engine: TelemetryEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('should increment a counter', () => {
    engine.increment('requests');
    engine.increment('requests');
    engine.increment('requests', 3);

    const metric = engine.getMetric('requests');
    expect(metric?.type).toBe('counter');
    expect(metric?.value).toBe(5);
  });

  it('should set a gauge', () => {
    engine.gauge('memory_usage', 75.5, 'percent');
    const metric = engine.getMetric('memory_usage');
    expect(metric?.type).toBe('gauge');
    expect(metric?.value).toBe(75.5);
    expect(metric?.unit).toBe('percent');

    // Gauge replaces value
    engine.gauge('memory_usage', 80.2, 'percent');
    expect(engine.getMetric('memory_usage')?.value).toBe(80.2);
  });

  it('should record histogram values', () => {
    engine.histogram('response_time', 100, 'ms');
    engine.histogram('response_time', 150, 'ms');
    engine.histogram('response_time', 200, 'ms');
    engine.histogram('response_time', 50, 'ms');

    const metric = engine.getMetric('response_time');
    expect(metric?.type).toBe('histogram');
    expect(metric?.values).toHaveLength(4);
  });

  it('should calculate histogram percentile', () => {
    for (let i = 1; i <= 100; i++) {
      engine.histogram('latency', i, 'ms');
    }

    const p50 = engine.getPercentile('latency', 0.5);
    expect(p50).toBe(50);

    const p95 = engine.getPercentile('latency', 0.95);
    expect(p95).toBe(95);

    const p99 = engine.getPercentile('latency', 0.99);
    expect(p99).toBe(99);
  });

  it('should return undefined percentile for unknown metric', () => {
    expect(engine.getPercentile('unknown', 0.5)).toBeUndefined();
  });

  it('should support tagged metrics', () => {
    engine.increment('requests', 1, { agent: 'inventory' });
    engine.increment('requests', 2, { agent: 'networking' });
    engine.increment('requests', 3, { agent: 'inventory' });

    expect(engine.getMetric('requests', { agent: 'inventory' })?.value).toBe(4);
    expect(engine.getMetric('requests', { agent: 'networking' })?.value).toBe(2);
  });

  it('should get all metrics', () => {
    engine.increment('a');
    engine.gauge('b', 1);
    engine.histogram('c', 1);

    const all = engine.getAllMetrics();
    expect(all).toHaveLength(3);
  });

  it('should cap histogram values at 1000', () => {
    for (let i = 0; i < 1100; i++) {
      engine.histogram('big_hist', i);
    }
    const metric = engine.getMetric('big_hist');
    expect(metric?.values?.length).toBe(1000);
  });
});

describe('TelemetryEngine — Session Analytics', () => {
  let engine: TelemetryEngine;

  beforeEach(() => {
    engine = createEngine({ sessionId: 'test_session' });
  });

  it('should track standard events', () => {
    engine.trackEvent('snap', 5);
    engine.trackEvent('product_identified', 3);
    engine.trackEvent('barcode_scanned', 2);
    engine.trackEvent('voice_command', 1);
    engine.trackEvent('export', 1);

    const analytics = engine.getSessionAnalytics();
    expect(analytics.totalSnaps).toBe(5);
    expect(analytics.totalProductsIdentified).toBe(3);
    expect(analytics.totalBarcodesScanned).toBe(2);
    expect(analytics.totalVoiceCommands).toBe(1);
    expect(analytics.totalExports).toBe(1);
  });

  it('should track custom feature events', () => {
    engine.trackEvent('deal_analysis', 2);
    engine.trackEvent('security_scan', 1);

    const analytics = engine.getSessionAnalytics();
    expect(analytics.featureUsage['deal_analysis']).toBe(2);
    expect(analytics.featureUsage['security_scan']).toBe(1);
  });

  it('should track agent invocations', () => {
    engine.trackAgentInvocation('inventory');
    engine.trackAgentInvocation('networking');
    engine.trackAgentInvocation('inventory');

    const analytics = engine.getSessionAnalytics();
    expect(analytics.agentInvocations['inventory']).toBe(2);
    expect(analytics.agentInvocations['networking']).toBe(1);
  });

  it('should track vision processing time', () => {
    engine.trackEvent('snap', 2);  // Track snaps separately
    engine.trackVisionProcessing(100);
    engine.trackVisionProcessing(200);

    const analytics = engine.getSessionAnalytics();
    expect(analytics.totalSnaps).toBe(2);
    expect(analytics.avgVisionProcessingMs).toBe(150);
  });

  it('should track offline time', () => {
    engine.trackOfflineTime(5000);
    engine.trackOfflineTime(3000);

    const analytics = engine.getSessionAnalytics();
    expect(analytics.offlineTimeMs).toBe(8000);
  });

  it('should have correct session ID', () => {
    expect(engine.getSessionAnalytics().sessionId).toBe('test_session');
  });

  it('should track errors in session', () => {
    engine.error('test', 'error 1');
    engine.error('test', 'error 2');
    engine.fatal('test', 'fatal error');

    expect(engine.getSessionAnalytics().totalErrors).toBe(3);
  });

  it('should emit session events', () => {
    const handler = vi.fn();
    engine.on('session:event', handler);
    engine.trackEvent('snap');
    expect(handler).toHaveBeenCalledWith({ event: 'snap', count: 1 });
  });
});

describe('TelemetryEngine — Summary', () => {
  let engine: TelemetryEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('should generate comprehensive summary', () => {
    engine.info('test', 'info log');
    engine.error('test', 'error log');

    const id = engine.startSpan('op');
    engine.endSpan(id);

    engine.increment('count');

    const summary = engine.getSummary();
    expect(summary.totalLogs).toBe(2);
    expect(summary.logsByLevel.info).toBe(1);
    expect(summary.logsByLevel.error).toBe(1);
    expect(summary.totalSpans).toBe(1);
    expect(summary.spanSuccessRate).toBe(1);
    expect(summary.uniqueErrors).toBe(1);
    expect(summary.metrics.length).toBeGreaterThan(0);
    expect(summary.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should track top error', () => {
    engine.error('test', 'common error', 'timeout');
    engine.error('test', 'common error', 'timeout');
    engine.error('test', 'rare error', 'permission denied');

    const summary = engine.getSummary();
    expect(summary.topError?.message).toBe('timeout');
    expect(summary.topError?.count).toBe(2);
  });

  it('should calculate span success rate', () => {
    for (let i = 0; i < 3; i++) {
      const id = engine.startSpan('good');
      engine.endSpan(id, { success: true });
    }
    const failId = engine.startSpan('bad');
    engine.endSpan(failId, { success: false });

    const summary = engine.getSummary();
    expect(summary.spanSuccessRate).toBe(0.75);
  });

  it('should handle empty state', () => {
    const summary = engine.getSummary();
    expect(summary.totalLogs).toBe(0);
    expect(summary.totalSpans).toBe(0);
    expect(summary.spanSuccessRate).toBe(1);
    expect(summary.uniqueErrors).toBe(0);
  });
});

describe('TelemetryEngine — Voice Summary', () => {
  it('should produce voice summary with session data', () => {
    const engine = createEngine();
    engine.trackEvent('snap', 100);
    engine.trackEvent('product_identified', 50);
    engine.trackVisionProcessing(150);

    const summary = engine.getVoiceSummary();
    expect(summary).toContain('100 images captured');
    expect(summary).toContain('50 products identified');
    expect(summary).toContain('no errors');
  });

  it('should mention errors in voice summary', () => {
    const engine = createEngine();
    engine.error('test', 'first error', 'timeout');
    engine.error('test', 'second error', 'timeout');

    const summary = engine.getVoiceSummary();
    expect(summary).toContain('error');
    expect(summary).toContain('timeout');
  });

  it('should mention success rate', () => {
    const engine = createEngine();
    const id = engine.startSpan('op');
    engine.endSpan(id);

    const summary = engine.getVoiceSummary();
    expect(summary).toContain('100%');
  });

  it('should mention uptime', () => {
    const engine = createEngine();
    const summary = engine.getVoiceSummary();
    expect(summary).toContain('running');
    expect(summary).toContain('minutes');
  });
});

describe('TelemetryEngine — Export', () => {
  let engine: TelemetryEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('should export logs with level filter', () => {
    engine.info('test', 'info');
    engine.warn('test', 'warn');
    engine.error('test', 'error');

    const errors = engine.exportLogs({ level: 'error' });
    expect(errors).toHaveLength(1);
    expect(errors[0].level).toBe('error');
  });

  it('should export logs with source filter', () => {
    engine.info('vision', 'from vision');
    engine.info('inventory', 'from inventory');

    const vision = engine.exportLogs({ source: 'vision' });
    expect(vision).toHaveLength(1);
  });

  it('should export logs with limit', () => {
    for (let i = 0; i < 20; i++) engine.info('test', `msg ${i}`);
    const limited = engine.exportLogs({ limit: 5 });
    expect(limited).toHaveLength(5);
  });

  it('should export diagnostics', () => {
    engine.info('test', 'log');
    engine.startSpan('op');
    engine.increment('metric');

    const diag = engine.exportDiagnostics();
    expect(diag.summary).toBeDefined();
    expect(diag.recentLogs.length).toBeGreaterThan(0);
    expect(diag.activeSpans.length).toBe(1);
    expect(diag.metrics.length).toBeGreaterThan(0);
    expect(diag.session).toBeDefined();
  });
});

describe('TelemetryEngine — Sink Flushing', () => {
  it('should flush to sink', async () => {
    const sink = vi.fn(async () => {});
    const engine = createEngine({ sink, sinkFlushIntervalMs: 0 });

    engine.info('test', 'message 1');
    engine.info('test', 'message 2');

    await engine.flushToSink();
    expect(sink).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ message: 'message 1' }),
    ]));
  });

  it('should not flush when no sink configured', async () => {
    const engine = createEngine();
    await engine.flushToSink(); // Should not throw
  });

  it('should re-queue on sink error', async () => {
    const sink = vi.fn(async () => { throw new Error('network error'); });
    const engine = createEngine({ sink, sinkFlushIntervalMs: 0 });

    engine.info('test', 'will retry');
    await engine.flushToSink();

    // Should be re-queued for next flush attempt
    const errorHandler = vi.fn();
    engine.on('sink:error', errorHandler);
    await engine.flushToSink();
    expect(sink).toHaveBeenCalledTimes(2);
  });
});

describe('TelemetryEngine — Reset & Destroy', () => {
  it('should reset all state', () => {
    const engine = createEngine();
    engine.info('test', 'log');
    engine.startSpan('op');
    engine.increment('metric');
    engine.trackEvent('snap');

    engine.reset();

    expect(engine.exportLogs()).toHaveLength(0);
    expect(engine.getActiveSpans()).toHaveLength(0);
    expect(engine.getCompletedSpans()).toHaveLength(0);
    expect(engine.getAllMetrics()).toHaveLength(0);
    expect(engine.getSessionAnalytics().totalSnaps).toBe(0);
  });

  it('should emit reset event', () => {
    const engine = createEngine();
    const handler = vi.fn();
    engine.on('telemetry:reset', handler);
    engine.reset();
    expect(handler).toHaveBeenCalled();
  });

  it('should destroy without error', () => {
    const engine = createEngine({ sinkFlushIntervalMs: 100, sink: async () => {} });
    engine.destroy();
    // Should not throw
  });
});

describe('TelemetryEngine — Privacy', () => {
  let engine: TelemetryEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('should never log buffer contents', () => {
    const entry = engine.info('test', 'buffer test', {
      rawBuffer: Buffer.from('sensitive image data'),
    });
    expect(entry?.data?.rawBuffer).toContain('Buffer');
    expect(entry?.data?.rawBuffer).toContain('bytes');
  });

  it('should redact Stripe keys', () => {
    const entry = engine.info('test', 'key test', {
      detail: 'Key is sk-live-abcdefghijklmnopqrstuvwxyz123',
    });
    expect(entry?.data?.detail).toContain('[REDACTED]');
    expect(entry?.data?.detail).not.toContain('sk-live');
  });

  it('should redact Windows paths in error stacks', () => {
    const err = new Error('test');
    err.stack = 'Error: test\n  at Object.<anonymous> (C:\\Users\\dorrian\\project\\src\\index.ts:42:5)';
    const entry = engine.error('test', 'stack error', err);
    expect(entry?.error?.stack).not.toContain('dorrian');
  });

  it('should redact Linux paths in error stacks', () => {
    const err = new Error('test');
    err.stack = 'Error: test\n  at /home/user/project/src/index.ts:42:5';
    const entry = engine.error('test', 'stack error', err);
    expect(entry?.error?.stack).not.toContain('/home/user');
  });

  it('should never log fields named password/secret/token/apiKey', () => {
    const entry = engine.info('test', 'sensitive fields', {
      password: 'hunter2',
      secret: 'shh',
      token: 'abc123',
      api_key: 'xyz',
      safe: 'visible',
    });

    expect(entry?.data?.password).toBe('[REDACTED]');
    expect(entry?.data?.secret).toBe('[REDACTED]');
    expect(entry?.data?.token).toBe('[REDACTED]');
    expect(entry?.data?.api_key).toBe('[REDACTED]');
    expect(entry?.data?.safe).toBe('visible');
  });
});
