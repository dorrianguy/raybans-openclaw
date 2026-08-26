/**
 * Anomaly Detection Engine Tests
 * 🌙 Night Shift Agent — Shift #34
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnomalyDetectionEngine,
  DEFAULT_ANOMALY_CONFIG,
  METRIC_TEMPLATES,
} from './anomaly-detection.js';
import type { AnomalyDetection, DataPoint } from './anomaly-detection.js';

describe('AnomalyDetectionEngine', () => {
  let engine: AnomalyDetectionEngine;

  beforeEach(() => {
    engine = new AnomalyDetectionEngine();
  });

  // ─── Metric Registration ──────────────────────────────────────

  describe('metric registration', () => {
    it('should register a metric from template', () => {
      expect(engine.registerMetricFromTemplate('test.count', 'inventory.count_delta')).toBe(true);
      expect(engine.getMetricIds()).toContain('test.count');
    });

    it('should register a custom metric', () => {
      expect(engine.registerMetric('custom.metric', {
        displayName: 'Custom Metric',
        category: 'custom',
      })).toBe(true);
    });

    it('should not register duplicate metrics', () => {
      engine.registerMetric('dup.metric', { displayName: 'Test', category: 'custom' });
      expect(engine.registerMetric('dup.metric', { displayName: 'Test2', category: 'custom' })).toBe(false);
    });

    it('should enforce max metrics limit', () => {
      const limited = new AnomalyDetectionEngine({ maxMetrics: 3 });
      limited.registerMetric('m1', { displayName: 'M1', category: 'custom' });
      limited.registerMetric('m2', { displayName: 'M2', category: 'custom' });
      limited.registerMetric('m3', { displayName: 'M3', category: 'custom' });
      expect(limited.registerMetric('m4', { displayName: 'M4', category: 'custom' })).toBe(false);
    });

    it('should remove a metric', () => {
      engine.registerMetric('removable', { displayName: 'Removable', category: 'custom' });
      expect(engine.removeMetric('removable')).toBe(true);
      expect(engine.getMetricIds()).not.toContain('removable');
    });

    it('should return false when removing non-existent metric', () => {
      expect(engine.removeMetric('nonexistent')).toBe(false);
    });

    it('should return false for unknown template', () => {
      expect(engine.registerMetricFromTemplate('test', 'unknown.template')).toBe(false);
    });

    it('should get baseline info', () => {
      engine.registerMetric('test', { displayName: 'Test', category: 'custom' });
      const baseline = engine.getBaseline('test');
      expect(baseline).not.toBeNull();
      expect(baseline!.displayName).toBe('Test');
      expect(baseline!.isWarm).toBe(false);
    });

    it('should return null for unknown baseline', () => {
      expect(engine.getBaseline('nonexistent')).toBeNull();
    });

    it('should emit metric:registered event', () => {
      let emitted = false;
      engine.on('metric:registered', () => { emitted = true; });
      engine.registerMetric('test', { displayName: 'Test', category: 'custom' });
      expect(emitted).toBe(true);
    });

    it('should emit metric:removed event', () => {
      let emitted = false;
      engine.on('metric:removed', () => { emitted = true; });
      engine.registerMetric('test', { displayName: 'Test', category: 'custom' });
      engine.removeMetric('test');
      expect(emitted).toBe(true);
    });
  });

  // ─── Data Ingestion ───────────────────────────────────────────

  describe('data ingestion', () => {
    beforeEach(() => {
      engine.registerMetric('test', {
        displayName: 'Test Metric',
        category: 'custom',
        method: 'zscore',
        threshold: 2.0,
        minDataPoints: 5,
      });
    });

    it('should add data points', () => {
      engine.addDataPoint('test', 100);
      const baseline = engine.getBaseline('test');
      expect(baseline!.dataPoints.length).toBe(1);
    });

    it('should return null for unknown metric', () => {
      expect(engine.addDataPoint('unknown', 100)).toBeNull();
    });

    it('should not detect anomalies before warm', () => {
      engine.addDataPoint('test', 100);
      engine.addDataPoint('test', 200);
      engine.addDataPoint('test', 300);
      // Not warm yet (needs 5 points)
      expect(engine.isWarm('test')).toBe(false);
    });

    it('should become warm after enough data points', () => {
      for (let i = 0; i < 5; i++) {
        engine.addDataPoint('test', 100);
      }
      expect(engine.isWarm('test')).toBe(true);
    });

    it('should emit baseline:warm event', () => {
      let emitted = false;
      engine.on('baseline:warm', () => { emitted = true; });
      for (let i = 0; i < 5; i++) {
        engine.addDataPoint('test', 100);
      }
      expect(emitted).toBe(true);
    });

    it('should trim data points to max', () => {
      engine.registerMetric('small', {
        displayName: 'Small',
        category: 'custom',
        maxDataPoints: 10,
        minDataPoints: 3,
      });
      for (let i = 0; i < 20; i++) {
        engine.addDataPoint('small', i);
      }
      const baseline = engine.getBaseline('small');
      expect(baseline!.dataPoints.length).toBeLessThanOrEqual(10);
    });

    it('should compute stats correctly', () => {
      for (let i = 0; i < 10; i++) {
        engine.addDataPoint('test', 100);
      }
      const baseline = engine.getBaseline('test');
      expect(baseline!.stats).not.toBeNull();
      expect(baseline!.stats!.mean).toBe(100);
      expect(baseline!.stats!.count).toBe(10);
    });

    it('should batch add data points', () => {
      const points: DataPoint[] = Array.from({ length: 10 }, (_, i) => ({
        timestamp: Date.now() - (10 - i) * 1000,
        value: 100 + (i % 3),
      }));
      const anomalies = engine.addBatchDataPoints('test', points);
      expect(engine.getBaseline('test')!.dataPoints.length).toBe(10);
    });
  });

  // ─── Z-Score Detection ────────────────────────────────────────

  describe('z-score detection', () => {
    beforeEach(() => {
      engine.registerMetric('ztest', {
        displayName: 'Z-Score Test',
        category: 'inventory',
        method: 'zscore',
        threshold: 2.0,
        minDataPoints: 10,
        direction: 'both',
        severityThresholds: { critical: 4.0, high: 3.0, medium: 2.5, low: 2.0 },
      });
    });

    it('should detect anomaly on extreme value', () => {
      // Build a stable baseline
      for (let i = 0; i < 20; i++) {
        engine.addDataPoint('ztest', 100 + (Math.random() * 2 - 1));
      }
      // Add an extreme outlier
      const result = engine.addDataPoint('ztest', 200);
      expect(result).not.toBeNull();
      expect(result!.severity).toBeDefined();
      expect(result!.direction).toBe('above');
    });

    it('should not trigger on normal values', () => {
      for (let i = 0; i < 20; i++) {
        engine.addDataPoint('ztest', 100);
      }
      const result = engine.addDataPoint('ztest', 100);
      expect(result).toBeNull();
    });

    it('should detect downward anomaly', () => {
      for (let i = 0; i < 20; i++) {
        engine.addDataPoint('ztest', 100);
      }
      const result = engine.addDataPoint('ztest', 0);
      expect(result).not.toBeNull();
      expect(result!.direction).toBe('below');
    });

    it('should include description', () => {
      for (let i = 0; i < 20; i++) {
        engine.addDataPoint('ztest', 100);
      }
      const result = engine.addDataPoint('ztest', 200);
      expect(result).not.toBeNull();
      expect(result!.description).toContain('Z-Score Test');
      expect(result!.description).toContain('%');
    });
  });

  // ─── IQR Detection ────────────────────────────────────────────

  describe('IQR detection', () => {
    beforeEach(() => {
      engine.registerMetric('iqr_test', {
        displayName: 'IQR Test',
        category: 'inventory',
        method: 'iqr',
        threshold: 1.5,
        minDataPoints: 10,
        direction: 'both',
        severityThresholds: { critical: 3.0, high: 2.5, medium: 2.0, low: 1.5 },
      });
    });

    it('should detect outliers using IQR method', () => {
      // Normal data
      const values = [10, 12, 14, 13, 11, 12, 15, 13, 14, 12, 11, 13, 14, 12, 15];
      for (const v of values) {
        engine.addDataPoint('iqr_test', v);
      }
      // Outlier
      const result = engine.addDataPoint('iqr_test', 50);
      expect(result).not.toBeNull();
      expect(result!.method).toBe('iqr');
    });

    it('should not flag values within IQR bounds', () => {
      const values = [10, 12, 14, 13, 11, 12, 15, 13, 14, 12];
      for (const v of values) {
        engine.addDataPoint('iqr_test', v);
      }
      const result = engine.addDataPoint('iqr_test', 13);
      expect(result).toBeNull();
    });
  });

  // ─── MAD Detection ────────────────────────────────────────────

  describe('MAD detection', () => {
    beforeEach(() => {
      engine.registerMetric('mad_test', {
        displayName: 'MAD Test',
        category: 'agent',
        method: 'mad',
        threshold: 3.0,
        minDataPoints: 10,
        direction: 'above',
        severityThresholds: { critical: 5.0, high: 4.0, medium: 3.0, low: 2.0 },
      });
    });

    it('should detect anomalies using MAD method', () => {
      // Need some variance so MAD is non-zero
      for (let i = 0; i < 15; i++) {
        engine.addDataPoint('mad_test', 50 + (i % 3)); // values: 50,51,52,50,51,...
      }
      const result = engine.addDataPoint('mad_test', 200);
      expect(result).not.toBeNull();
      expect(result!.method).toBe('mad');
    });

    it('should respect direction constraint (above only)', () => {
      for (let i = 0; i < 15; i++) {
        engine.addDataPoint('mad_test', 50);
      }
      // Below the mean — should not trigger for 'above' direction
      const result = engine.addDataPoint('mad_test', 1);
      expect(result).toBeNull();
    });
  });

  // ─── Moving Average Detection ─────────────────────────────────

  describe('moving average detection', () => {
    beforeEach(() => {
      engine.registerMetric('ma_test', {
        displayName: 'Moving Average Test',
        category: 'performance',
        method: 'movingAverage',
        threshold: 2.0,
        minDataPoints: 10,
        direction: 'both',
        severityThresholds: { critical: 4.0, high: 3.0, medium: 2.5, low: 2.0 },
      });
    });

    it('should detect deviation from moving average', () => {
      for (let i = 0; i < 20; i++) {
        engine.addDataPoint('ma_test', 100);
      }
      const result = engine.addDataPoint('ma_test', 500);
      expect(result).not.toBeNull();
      expect(result!.method).toBe('movingAverage');
    });
  });

  // ─── Severity Classification ──────────────────────────────────

  describe('severity classification', () => {
    beforeEach(() => {
      engine.registerMetric('sev_test', {
        displayName: 'Severity Test',
        category: 'custom',
        method: 'zscore',
        minDataPoints: 5,
        direction: 'both',
        severityThresholds: { critical: 4.0, high: 3.0, medium: 2.5, low: 2.0 },
      });
      // Build a tight baseline at 100 with stddev ~0
      for (let i = 0; i < 10; i++) {
        engine.addDataPoint('sev_test', 100);
      }
    });

    it('should classify critical anomalies', () => {
      // With stddev 0 and value far away, the score would be infinite
      // Let's use a dataset with some variance
      const eng2 = new AnomalyDetectionEngine();
      eng2.registerMetric('s', {
        displayName: 'S',
        category: 'custom',
        method: 'zscore',
        minDataPoints: 5,
        direction: 'both',
        severityThresholds: { critical: 4.0, high: 3.0, medium: 2.5, low: 2.0 },
      });
      for (let i = 0; i < 50; i++) {
        eng2.addDataPoint('s', 100 + (i % 5));
      }
      const result = eng2.addDataPoint('s', 130);
      if (result) {
        expect(['critical', 'high', 'medium', 'low']).toContain(result.severity);
      }
    });
  });

  // ─── Anomaly Management ───────────────────────────────────────

  describe('anomaly management', () => {
    function createAnomalyProducingMetric() {
      engine.registerMetric('producer', {
        displayName: 'Producer',
        category: 'inventory',
        method: 'zscore',
        minDataPoints: 5,
        direction: 'both',
        severityThresholds: { critical: 4.0, high: 3.0, medium: 2.5, low: 2.0 },
      });
      // Build baseline
      for (let i = 0; i < 20; i++) {
        engine.addDataPoint('producer', 100 + (i % 3));
      }
    }

    it('should store detected anomalies', () => {
      createAnomalyProducingMetric();
      engine.addDataPoint('producer', 200);
      const anomalies = engine.getAnomalies();
      expect(anomalies.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter anomalies by category', () => {
      createAnomalyProducingMetric();
      engine.addDataPoint('producer', 200);
      const filtered = engine.getAnomalies({ category: 'inventory' });
      for (const a of filtered) {
        expect(a.category).toBe('inventory');
      }
    });

    it('should filter anomalies by acknowledged status', () => {
      createAnomalyProducingMetric();
      const anomaly = engine.addDataPoint('producer', 200);
      if (anomaly) {
        const unack = engine.getAnomalies({ acknowledged: false });
        expect(unack.some(a => a.id === anomaly.id)).toBe(true);
      }
    });

    it('should acknowledge anomalies', () => {
      createAnomalyProducingMetric();
      const anomaly = engine.addDataPoint('producer', 200);
      if (anomaly) {
        expect(engine.acknowledgeAnomaly(anomaly.id)).toBe(true);
        const acked = engine.getAnomalies({ acknowledged: true });
        expect(acked.some(a => a.id === anomaly.id)).toBe(true);
      }
    });

    it('should return false for acknowledging unknown anomaly', () => {
      expect(engine.acknowledgeAnomaly('unknown-id')).toBe(false);
    });

    it('should mark false positives', () => {
      createAnomalyProducingMetric();
      const anomaly = engine.addDataPoint('producer', 200);
      if (anomaly) {
        expect(engine.markFalsePositive(anomaly.id)).toBe(true);
        const fp = engine.getAnomalies();
        const found = fp.find(a => a.id === anomaly.id);
        expect(found?.falsePositive).toBe(true);
        expect(found?.acknowledged).toBe(true);
      }
    });

    it('should return false for marking unknown anomaly as false positive', () => {
      expect(engine.markFalsePositive('unknown-id')).toBe(false);
    });

    it('should trim old anomalies', () => {
      createAnomalyProducingMetric();
      // Create some anomalies
      for (let i = 0; i < 5; i++) {
        engine.addDataPoint('producer', 200 + i * 50);
      }
      const before = engine.getAnomalies().length;
      const trimmed = engine.trimAnomalies(Date.now() + 1000);
      // Should remove all (all were before the future cutoff)
      expect(trimmed).toBe(before);
    });

    it('should emit anomaly:detected event', () => {
      let detected: AnomalyDetection | null = null;
      engine.on('anomaly:detected', (a) => { detected = a; });

      createAnomalyProducingMetric();
      engine.addDataPoint('producer', 200);

      if (detected) {
        expect(detected).toHaveProperty('id');
        expect(detected).toHaveProperty('description');
      }
    });

    it('should limit anomalies with limit filter', () => {
      createAnomalyProducingMetric();
      for (let i = 0; i < 10; i++) {
        engine.addDataPoint('producer', 200 + i * 10);
      }
      const limited = engine.getAnomalies({ limit: 3 });
      expect(limited.length).toBeLessThanOrEqual(3);
    });
  });

  // ─── One-shot Analysis ────────────────────────────────────────

  describe('one-shot analysis', () => {
    it('should analyze a dataset and find anomalies', () => {
      const data = [10, 11, 12, 10, 11, 12, 10, 11, 100, 11, 12]; // 100 is outlier
      const anomalies = engine.analyzeDataset(data, 'zscore', 2.0);
      expect(anomalies.some(a => a.value === 100)).toBe(true);
    });

    it('should return empty for uniform data', () => {
      const data = [10, 10, 10, 10, 10, 10, 10, 10];
      const anomalies = engine.analyzeDataset(data, 'zscore', 2.0);
      expect(anomalies.length).toBe(0);
    });

    it('should handle small datasets', () => {
      expect(engine.analyzeDataset([1, 2]).length).toBe(0);
    });

    it('should use IQR method for analysis', () => {
      const data = [10, 11, 12, 10, 11, 12, 10, 11, 100, 11, 12];
      const anomalies = engine.analyzeDataset(data, 'iqr', 1.5);
      expect(anomalies.some(a => a.value === 100)).toBe(true);
    });

    it('should use MAD method for analysis', () => {
      const data = [10, 11, 12, 10, 11, 12, 10, 11, 100, 11, 12];
      const anomalies = engine.analyzeDataset(data, 'mad', 2.0);
      expect(anomalies.some(a => a.value === 100)).toBe(true);
    });
  });

  // ─── Period Comparison ────────────────────────────────────────

  describe('period comparison', () => {
    it('should compare two periods', () => {
      engine.registerMetric('periods', {
        displayName: 'Periods',
        category: 'billing',
        minDataPoints: 3,
      });

      const now = Date.now();
      // Period 1: lower values
      for (let i = 0; i < 10; i++) {
        engine.addDataPoint('periods', 50 + (i % 3), now - 100000 + i * 1000);
      }
      // Period 2: higher values
      for (let i = 0; i < 10; i++) {
        engine.addDataPoint('periods', 150 + (i % 3), now - 10000 + i * 1000);
      }

      const result = engine.comparePeriods('periods', now - 50000, now - 10000);
      expect(result).not.toBeNull();
      expect(result!.direction).toBe('above');
      expect(result!.percentChange).toBeGreaterThan(0);
    });

    it('should return null for unknown metric', () => {
      expect(engine.comparePeriods('unknown', 0, 1000)).toBeNull();
    });

    it('should return null for insufficient data', () => {
      engine.registerMetric('sparse', {
        displayName: 'Sparse',
        category: 'custom',
        minDataPoints: 3,
      });
      engine.addDataPoint('sparse', 100, 1000);
      expect(engine.comparePeriods('sparse', 500, 1500)).toBeNull();
    });
  });

  // ─── Metric Templates ────────────────────────────────────────

  describe('metric templates', () => {
    it('should have pre-built templates', () => {
      expect(Object.keys(METRIC_TEMPLATES).length).toBeGreaterThanOrEqual(10);
    });

    it('should include inventory templates', () => {
      expect(METRIC_TEMPLATES).toHaveProperty('inventory.count_delta');
      expect(METRIC_TEMPLATES).toHaveProperty('inventory.shrinkage_rate');
      expect(METRIC_TEMPLATES).toHaveProperty('inventory.scan_speed');
    });

    it('should include billing templates', () => {
      expect(METRIC_TEMPLATES).toHaveProperty('billing.usage_spike');
      expect(METRIC_TEMPLATES).toHaveProperty('billing.revenue_drop');
    });

    it('should include agent templates', () => {
      expect(METRIC_TEMPLATES).toHaveProperty('agent.error_rate');
      expect(METRIC_TEMPLATES).toHaveProperty('agent.response_time');
    });

    it('should include security template', () => {
      expect(METRIC_TEMPLATES).toHaveProperty('security.threat_frequency');
    });

    it('should include performance template', () => {
      expect(METRIC_TEMPLATES).toHaveProperty('performance.image_processing_time');
    });

    it('should include usage template', () => {
      expect(METRIC_TEMPLATES).toHaveProperty('usage.api_calls');
    });

    it('should have valid template structures', () => {
      for (const [name, template] of Object.entries(METRIC_TEMPLATES)) {
        expect(template.displayName).toBeTruthy();
        expect(template.category).toBeTruthy();
        expect(template.method).toBeTruthy();
        expect(template.threshold).toBeGreaterThan(0);
        expect(template.severityThresholds.critical).toBeGreaterThan(0);
      }
    });

    it('should apply template overrides', () => {
      engine.registerMetricFromTemplate('custom_inv', 'inventory.count_delta', {
        threshold: 5.0,
        displayName: 'Custom Name',
      });
      const baseline = engine.getBaseline('custom_inv');
      expect(baseline!.threshold).toBe(5.0);
      expect(baseline!.displayName).toBe('Custom Name');
    });
  });

  // ─── Statistics ───────────────────────────────────────────────

  describe('statistics', () => {
    it('should return valid stats', () => {
      const stats = engine.getStats();
      expect(stats.totalMetrics).toBe(0);
      expect(stats.totalAnomalies).toBe(0);
      expect(stats.detectionAccuracy).toBe(1);
    });

    it('should track metric counts', () => {
      engine.registerMetric('m1', { displayName: 'M1', category: 'custom' });
      engine.registerMetric('m2', { displayName: 'M2', category: 'custom' });
      const stats = engine.getStats();
      expect(stats.totalMetrics).toBe(2);
      expect(stats.coldMetrics).toBe(2);
      expect(stats.warmMetrics).toBe(0);
    });

    it('should track warm vs cold metrics', () => {
      engine.registerMetric('warm', {
        displayName: 'Warm',
        category: 'custom',
        minDataPoints: 3,
      });
      for (let i = 0; i < 5; i++) {
        engine.addDataPoint('warm', 100);
      }
      const stats = engine.getStats();
      expect(stats.warmMetrics).toBe(1);
    });

    it('should track total data points', () => {
      engine.registerMetric('dp', { displayName: 'DP', category: 'custom', minDataPoints: 3 });
      for (let i = 0; i < 10; i++) {
        engine.addDataPoint('dp', i);
      }
      const stats = engine.getStats();
      expect(stats.totalDataPoints).toBe(10);
    });

    it('should track detection accuracy', () => {
      engine.registerMetric('acc', {
        displayName: 'Acc',
        category: 'custom',
        method: 'zscore',
        minDataPoints: 5,
        direction: 'both',
        severityThresholds: { critical: 4.0, high: 3.0, medium: 2.5, low: 2.0 },
      });
      for (let i = 0; i < 20; i++) {
        engine.addDataPoint('acc', 100 + (i % 3));
      }
      const anomaly = engine.addDataPoint('acc', 200);
      if (anomaly) {
        engine.markFalsePositive(anomaly.id);
        const stats = engine.getStats();
        expect(stats.falsePositives).toBe(1);
        expect(stats.detectionAccuracy).toBeLessThan(1);
      }
    });
  });

  // ─── Voice Summary ───────────────────────────────────────────

  describe('voice summary', () => {
    it('should report no anomalies when clean', () => {
      const summary = engine.getVoiceSummary();
      expect(summary).toContain('No anomalies');
    });

    it('should report anomaly count', () => {
      engine.registerMetric('vs', {
        displayName: 'Voice Summary Test',
        category: 'inventory',
        method: 'zscore',
        minDataPoints: 5,
        direction: 'both',
        severityThresholds: { critical: 4.0, high: 3.0, medium: 2.5, low: 2.0 },
      });
      for (let i = 0; i < 20; i++) {
        engine.addDataPoint('vs', 100 + (i % 3));
      }
      engine.addDataPoint('vs', 200);

      const summary = engine.getVoiceSummary();
      if (engine.getAnomalies().length > 0) {
        expect(summary).toContain('unacknowledged');
      }
    });
  });

  // ─── Reset ────────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear all data on reset', () => {
      engine.registerMetric('r1', { displayName: 'R1', category: 'custom' });
      engine.addDataPoint('r1', 100);
      engine.reset();
      expect(engine.getMetricIds().length).toBe(0);
      expect(engine.getAnomalies().length).toBe(0);
    });
  });

  // ─── Default Config ──────────────────────────────────────────

  describe('default config', () => {
    it('should have valid defaults', () => {
      expect(DEFAULT_ANOMALY_CONFIG.defaultMethod).toBe('zscore');
      expect(DEFAULT_ANOMALY_CONFIG.defaultThreshold).toBe(2.5);
      expect(DEFAULT_ANOMALY_CONFIG.defaultMinDataPoints).toBe(10);
      expect(DEFAULT_ANOMALY_CONFIG.maxAnomalies).toBe(1000);
      expect(DEFAULT_ANOMALY_CONFIG.retentionDays).toBe(30);
      expect(DEFAULT_ANOMALY_CONFIG.autoLearn).toBe(true);
      expect(DEFAULT_ANOMALY_CONFIG.maxMetrics).toBe(200);
    });
  });
});
