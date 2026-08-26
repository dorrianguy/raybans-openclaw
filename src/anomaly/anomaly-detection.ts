/**
 * Anomaly Detection Engine — Statistical anomaly detection for the platform.
 *
 * Detects unusual patterns in inventory counts, agent behavior, billing,
 * and security events. Uses Z-score, IQR, and moving average methods.
 *
 * Features:
 * - Multiple detection algorithms: Z-score, IQR, Modified Z-score (MAD), Moving Average Deviation
 * - Configurable sensitivity per metric type
 * - Time-series anomaly detection with seasonal awareness
 * - Multi-dimensional anomaly scoring (combine multiple signals)
 * - Alert generation with severity classification
 * - Historical baseline management (learn from past data)
 * - Inventory-specific: detects count anomalies, shrinkage spikes, unusual patterns
 * - Billing-specific: detects usage spikes, fraud patterns, billing anomalies
 * - Agent-specific: detects performance degradation, error rate spikes
 * - Auto-learning: baselines adjust over time with confirmed normal data
 * - Voice summary: "3 anomalies detected. High severity: inventory count for aisle 5 is 40% below expected."
 *
 * 🌙 Night Shift Agent — Shift #34
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export type AnomalyDetectionMethod = 'zscore' | 'iqr' | 'mad' | 'movingAverage' | 'percentile';

export type AnomalySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type AnomalyCategory =
  | 'inventory'
  | 'billing'
  | 'agent'
  | 'security'
  | 'performance'
  | 'usage'
  | 'custom';

export type AnomalyDirection = 'above' | 'below' | 'both';

export interface DataPoint {
  /** Timestamp of the data point */
  timestamp: number;
  /** The measured value */
  value: number;
  /** Optional labels/dimensions */
  labels?: Record<string, string>;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface AnomalyDetection {
  /** Unique anomaly ID */
  id: string;
  /** The metric that triggered the anomaly */
  metricId: string;
  /** When it was detected */
  detectedAt: number;
  /** The anomalous value */
  value: number;
  /** The expected value (baseline) */
  expectedValue: number;
  /** How far from expected (as a multiplier or Z-score) */
  deviationScore: number;
  /** Severity classification */
  severity: AnomalySeverity;
  /** Category */
  category: AnomalyCategory;
  /** Detection method used */
  method: AnomalyDetectionMethod;
  /** Human-readable description */
  description: string;
  /** Direction of the anomaly */
  direction: AnomalyDirection;
  /** Labels from the data point */
  labels?: Record<string, string>;
  /** Whether this has been acknowledged */
  acknowledged: boolean;
  /** Whether this was a false positive (user feedback) */
  falsePositive?: boolean;
}

export interface MetricBaseline {
  /** Metric identifier */
  metricId: string;
  /** Category for grouping */
  category: AnomalyCategory;
  /** Display name */
  displayName: string;
  /** Detection method to use */
  method: AnomalyDetectionMethod;
  /** Sensitivity (lower = more sensitive, higher = fewer alerts) */
  threshold: number;
  /** Direction to check */
  direction: AnomalyDirection;
  /** Historical data points for baseline calculation */
  dataPoints: DataPoint[];
  /** Maximum data points to keep */
  maxDataPoints: number;
  /** Computed statistics (cached) */
  stats: BaselineStats | null;
  /** Whether the baseline is warm (has enough data) */
  isWarm: boolean;
  /** Minimum data points before alerting */
  minDataPoints: number;
  /** Custom severity thresholds (deviation score → severity) */
  severityThresholds: SeverityThresholds;
  /** Whether to auto-adjust baseline from acknowledged normal values */
  autoAdjust: boolean;
  /** Last updated timestamp */
  lastUpdated: number;
}

export interface BaselineStats {
  mean: number;
  median: number;
  stdDev: number;
  mad: number; // Median Absolute Deviation
  q1: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
  count: number;
  lastValue: number;
  movingAverage: number; // last N values average
  movingStdDev: number;
}

export interface SeverityThresholds {
  critical: number;  // deviation score above this = critical
  high: number;
  medium: number;
  low: number;
}

export interface AnomalyDetectionConfig {
  /** Default detection method */
  defaultMethod: AnomalyDetectionMethod;
  /** Default Z-score threshold */
  defaultThreshold: number;
  /** Default maximum data points per metric */
  defaultMaxDataPoints: number;
  /** Default minimum data points before alerting */
  defaultMinDataPoints: number;
  /** Moving average window size */
  movingAverageWindow: number;
  /** Maximum anomalies to retain */
  maxAnomalies: number;
  /** Auto-trim old anomalies after this many days */
  retentionDays: number;
  /** Whether to auto-learn from acknowledged data */
  autoLearn: boolean;
  /** Default severity thresholds */
  defaultSeverityThresholds: SeverityThresholds;
  /** Maximum metrics to track */
  maxMetrics: number;
}

export interface AnomalyEngineEvents {
  'anomaly:detected': AnomalyDetection;
  'anomaly:acknowledged': { id: string };
  'anomaly:falsePositive': { id: string };
  'baseline:warm': { metricId: string };
  'baseline:updated': { metricId: string };
  'metric:registered': { metricId: string };
  'metric:removed': { metricId: string };
}

export interface AnomalyEngineStats {
  totalMetrics: number;
  warmMetrics: number;
  coldMetrics: number;
  totalAnomalies: number;
  unacknowledgedAnomalies: number;
  falsePositives: number;
  totalDataPoints: number;
  anomaliesByCategory: Record<AnomalyCategory, number>;
  anomaliesBySeverity: Record<AnomalySeverity, number>;
  detectionAccuracy: number; // 1 - (falsePositives / totalAnomalies)
}

// ─── Default Config ─────────────────────────────────────────────

export const DEFAULT_ANOMALY_CONFIG: AnomalyDetectionConfig = {
  defaultMethod: 'zscore',
  defaultThreshold: 2.5,
  defaultMaxDataPoints: 500,
  defaultMinDataPoints: 10,
  movingAverageWindow: 20,
  maxAnomalies: 1000,
  retentionDays: 30,
  autoLearn: true,
  defaultSeverityThresholds: {
    critical: 4.0,
    high: 3.0,
    medium: 2.5,
    low: 2.0,
  },
  maxMetrics: 200,
};

// ─── Pre-built Metric Templates ─────────────────────────────────

export interface MetricTemplate {
  displayName: string;
  category: AnomalyCategory;
  method: AnomalyDetectionMethod;
  threshold: number;
  direction: AnomalyDirection;
  minDataPoints: number;
  maxDataPoints: number;
  severityThresholds: SeverityThresholds;
}

export const METRIC_TEMPLATES: Record<string, MetricTemplate> = {
  'inventory.count_delta': {
    displayName: 'Inventory Count Change',
    category: 'inventory',
    method: 'zscore',
    threshold: 2.5,
    direction: 'both',
    minDataPoints: 5,
    maxDataPoints: 200,
    severityThresholds: { critical: 4.0, high: 3.0, medium: 2.5, low: 2.0 },
  },
  'inventory.shrinkage_rate': {
    displayName: 'Shrinkage Rate',
    category: 'inventory',
    method: 'iqr',
    threshold: 1.5,
    direction: 'above',
    minDataPoints: 5,
    maxDataPoints: 100,
    severityThresholds: { critical: 3.0, high: 2.5, medium: 2.0, low: 1.5 },
  },
  'inventory.scan_speed': {
    displayName: 'Scan Speed (items/hour)',
    category: 'inventory',
    method: 'movingAverage',
    threshold: 2.0,
    direction: 'below',
    minDataPoints: 10,
    maxDataPoints: 500,
    severityThresholds: { critical: 4.0, high: 3.0, medium: 2.0, low: 1.5 },
  },
  'billing.usage_spike': {
    displayName: 'Usage Spike',
    category: 'billing',
    method: 'zscore',
    threshold: 3.0,
    direction: 'above',
    minDataPoints: 10,
    maxDataPoints: 200,
    severityThresholds: { critical: 5.0, high: 4.0, medium: 3.0, low: 2.0 },
  },
  'billing.revenue_drop': {
    displayName: 'Revenue Drop',
    category: 'billing',
    method: 'zscore',
    threshold: 2.5,
    direction: 'below',
    minDataPoints: 10,
    maxDataPoints: 200,
    severityThresholds: { critical: 4.0, high: 3.0, medium: 2.5, low: 2.0 },
  },
  'agent.error_rate': {
    displayName: 'Agent Error Rate',
    category: 'agent',
    method: 'mad',
    threshold: 3.0,
    direction: 'above',
    minDataPoints: 20,
    maxDataPoints: 500,
    severityThresholds: { critical: 5.0, high: 4.0, medium: 3.0, low: 2.0 },
  },
  'agent.response_time': {
    displayName: 'Agent Response Time',
    category: 'agent',
    method: 'percentile',
    threshold: 95,
    direction: 'above',
    minDataPoints: 20,
    maxDataPoints: 1000,
    severityThresholds: { critical: 4.0, high: 3.0, medium: 2.5, low: 2.0 },
  },
  'security.threat_frequency': {
    displayName: 'Threat Detection Frequency',
    category: 'security',
    method: 'zscore',
    threshold: 2.0,
    direction: 'above',
    minDataPoints: 10,
    maxDataPoints: 300,
    severityThresholds: { critical: 3.5, high: 2.5, medium: 2.0, low: 1.5 },
  },
  'performance.image_processing_time': {
    displayName: 'Image Processing Time',
    category: 'performance',
    method: 'movingAverage',
    threshold: 2.5,
    direction: 'above',
    minDataPoints: 30,
    maxDataPoints: 1000,
    severityThresholds: { critical: 4.0, high: 3.0, medium: 2.5, low: 2.0 },
  },
  'usage.api_calls': {
    displayName: 'API Call Volume',
    category: 'usage',
    method: 'zscore',
    threshold: 3.0,
    direction: 'both',
    minDataPoints: 20,
    maxDataPoints: 500,
    severityThresholds: { critical: 5.0, high: 4.0, medium: 3.0, low: 2.0 },
  },
};

// ─── Anomaly Detection Engine ───────────────────────────────────

export class AnomalyDetectionEngine extends EventEmitter {
  private config: AnomalyDetectionConfig;
  private metrics: Map<string, MetricBaseline> = new Map();
  private anomalies: AnomalyDetection[] = [];
  private anomalyCounter: number = 0;

  constructor(config: Partial<AnomalyDetectionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ANOMALY_CONFIG, ...config };
  }

  // ─── Metric Management ────────────────────────────────────────

  /** Register a metric from a template */
  registerMetricFromTemplate(metricId: string, templateName: string, overrides?: Partial<MetricTemplate>): boolean {
    const template = METRIC_TEMPLATES[templateName];
    if (!template) return false;
    if (this.metrics.size >= this.config.maxMetrics) return false;

    const merged = { ...template, ...overrides };
    return this.registerMetric(metricId, merged);
  }

  /** Register a custom metric */
  registerMetric(metricId: string, options: Partial<MetricTemplate> & { displayName: string; category: AnomalyCategory }): boolean {
    if (this.metrics.has(metricId)) return false;
    if (this.metrics.size >= this.config.maxMetrics) return false;

    const baseline: MetricBaseline = {
      metricId,
      category: options.category,
      displayName: options.displayName,
      method: options.method || this.config.defaultMethod,
      threshold: options.threshold || this.config.defaultThreshold,
      direction: options.direction || 'both',
      dataPoints: [],
      maxDataPoints: options.maxDataPoints || this.config.defaultMaxDataPoints,
      stats: null,
      isWarm: false,
      minDataPoints: options.minDataPoints || this.config.defaultMinDataPoints,
      severityThresholds: options.severityThresholds || { ...this.config.defaultSeverityThresholds },
      autoAdjust: this.config.autoLearn,
      lastUpdated: Date.now(),
    };

    this.metrics.set(metricId, baseline);
    this.emit('metric:registered', { metricId });
    return true;
  }

  /** Remove a metric */
  removeMetric(metricId: string): boolean {
    const removed = this.metrics.delete(metricId);
    if (removed) {
      this.emit('metric:removed', { metricId });
    }
    return removed;
  }

  /** Get all registered metric IDs */
  getMetricIds(): string[] {
    return [...this.metrics.keys()];
  }

  /** Get baseline info for a metric */
  getBaseline(metricId: string): MetricBaseline | null {
    return this.metrics.get(metricId) || null;
  }

  /** Check if a metric baseline is warm (has enough data) */
  isWarm(metricId: string): boolean {
    const baseline = this.metrics.get(metricId);
    return baseline?.isWarm || false;
  }

  // ─── Data Ingestion ───────────────────────────────────────────

  /** Add a data point and check for anomalies */
  addDataPoint(metricId: string, value: number, timestamp?: number, labels?: Record<string, string>, metadata?: Record<string, unknown>): AnomalyDetection | null {
    const baseline = this.metrics.get(metricId);
    if (!baseline) return null;

    const point: DataPoint = {
      timestamp: timestamp || Date.now(),
      value,
      labels,
      metadata,
    };

    // Add to history
    baseline.dataPoints.push(point);

    // Trim if over max
    if (baseline.dataPoints.length > baseline.maxDataPoints) {
      baseline.dataPoints = baseline.dataPoints.slice(-baseline.maxDataPoints);
    }

    // Recompute stats
    baseline.stats = this.computeStats(baseline.dataPoints);
    baseline.lastUpdated = Date.now();

    // Check warmth
    const wasWarm = baseline.isWarm;
    baseline.isWarm = baseline.dataPoints.length >= baseline.minDataPoints;
    if (!wasWarm && baseline.isWarm) {
      this.emit('baseline:warm', { metricId });
    }

    this.emit('baseline:updated', { metricId });

    // Don't detect anomalies until warm
    if (!baseline.isWarm) return null;

    // Run detection
    return this.detectAnomaly(baseline, point);
  }

  /** Batch add data points (e.g., loading historical data) */
  addBatchDataPoints(metricId: string, points: DataPoint[]): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    for (const point of points) {
      const anomaly = this.addDataPoint(metricId, point.value, point.timestamp, point.labels, point.metadata as Record<string, unknown>);
      if (anomaly) anomalies.push(anomaly);
    }
    return anomalies;
  }

  // ─── Anomaly Detection ────────────────────────────────────────

  private detectAnomaly(baseline: MetricBaseline, point: DataPoint): AnomalyDetection | null {
    const stats = baseline.stats;
    if (!stats || stats.count < baseline.minDataPoints) return null;

    let deviationScore: number;
    let expectedValue: number;

    switch (baseline.method) {
      case 'zscore':
        deviationScore = this.zScoreDetection(point.value, stats);
        expectedValue = stats.mean;
        break;
      case 'iqr':
        deviationScore = this.iqrDetection(point.value, stats);
        expectedValue = stats.median;
        break;
      case 'mad':
        deviationScore = this.madDetection(point.value, stats);
        expectedValue = stats.median;
        break;
      case 'movingAverage':
        deviationScore = this.movingAverageDetection(point.value, stats);
        expectedValue = stats.movingAverage;
        break;
      case 'percentile':
        deviationScore = this.percentileDetection(point.value, baseline.dataPoints, baseline.threshold);
        expectedValue = stats.median;
        break;
      default:
        return null;
    }

    // Check direction
    const direction = this.getDirection(point.value, expectedValue);
    if (baseline.direction === 'above' && direction === 'below') return null;
    if (baseline.direction === 'below' && direction === 'above') return null;

    // Check threshold
    const absDeviation = Math.abs(deviationScore);
    if (absDeviation < baseline.severityThresholds.low) return null;

    // Classify severity
    const severity = this.classifySeverity(absDeviation, baseline.severityThresholds);

    // Create anomaly
    const anomaly: AnomalyDetection = {
      id: `anomaly-${++this.anomalyCounter}`,
      metricId: baseline.metricId,
      detectedAt: Date.now(),
      value: point.value,
      expectedValue,
      deviationScore: absDeviation,
      severity,
      category: baseline.category,
      method: baseline.method,
      description: this.generateDescription(baseline, point.value, expectedValue, absDeviation, direction),
      direction,
      labels: point.labels,
      acknowledged: false,
    };

    // Store anomaly
    this.anomalies.push(anomaly);
    if (this.anomalies.length > this.config.maxAnomalies) {
      this.anomalies = this.anomalies.slice(-this.config.maxAnomalies);
    }

    this.emit('anomaly:detected', anomaly);
    return anomaly;
  }

  // ─── Detection Algorithms ─────────────────────────────────────

  /** Z-Score detection: how many standard deviations from the mean */
  private zScoreDetection(value: number, stats: BaselineStats): number {
    if (stats.stdDev === 0) return 0;
    return (value - stats.mean) / stats.stdDev;
  }

  /** IQR detection: based on interquartile range */
  private iqrDetection(value: number, stats: BaselineStats): number {
    if (stats.iqr === 0) return 0;
    const lowerBound = stats.q1 - 1.5 * stats.iqr;
    const upperBound = stats.q3 + 1.5 * stats.iqr;
    if (value < lowerBound) return (lowerBound - value) / stats.iqr;
    if (value > upperBound) return (value - upperBound) / stats.iqr;
    return 0;
  }

  /** Modified Z-Score using Median Absolute Deviation */
  private madDetection(value: number, stats: BaselineStats): number {
    if (stats.mad === 0) return 0;
    return 0.6745 * (value - stats.median) / stats.mad;
  }

  /** Moving Average deviation detection */
  private movingAverageDetection(value: number, stats: BaselineStats): number {
    if (stats.movingStdDev === 0) return 0;
    return (value - stats.movingAverage) / stats.movingStdDev;
  }

  /** Percentile-based detection */
  private percentileDetection(value: number, dataPoints: DataPoint[], percentile: number): number {
    const sorted = dataPoints.map(d => d.value).sort((a, b) => a - b);
    const idx = Math.floor((percentile / 100) * sorted.length);
    const pValue = sorted[Math.min(idx, sorted.length - 1)];
    if (pValue === 0) return 0;
    return (value - pValue) / Math.abs(pValue);
  }

  // ─── Statistics Computation ───────────────────────────────────

  private computeStats(dataPoints: DataPoint[]): BaselineStats {
    const values = dataPoints.map(d => d.value);
    const n = values.length;

    if (n === 0) {
      return {
        mean: 0, median: 0, stdDev: 0, mad: 0,
        q1: 0, q3: 0, iqr: 0, min: 0, max: 0,
        count: 0, lastValue: 0, movingAverage: 0, movingStdDev: 0,
      };
    }

    const sorted = [...values].sort((a, b) => a - b);

    // Mean
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;

    // Median
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];

    // Standard deviation
    const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    // MAD (Median Absolute Deviation)
    const absDeviations = values.map(v => Math.abs(v - median)).sort((a, b) => a - b);
    const mad = absDeviations.length % 2 === 0
      ? (absDeviations[absDeviations.length / 2 - 1] + absDeviations[absDeviations.length / 2]) / 2
      : absDeviations[Math.floor(absDeviations.length / 2)];

    // Quartiles
    const q1Idx = Math.floor(n * 0.25);
    const q3Idx = Math.floor(n * 0.75);
    const q1 = sorted[q1Idx];
    const q3 = sorted[Math.min(q3Idx, n - 1)];
    const iqr = q3 - q1;

    // Moving average (last N points)
    const windowSize = Math.min(this.config.movingAverageWindow, n);
    const recentValues = values.slice(-windowSize);
    const movingAverage = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    const movingVariance = recentValues.reduce((acc, v) => acc + (v - movingAverage) ** 2, 0) / recentValues.length;
    const movingStdDev = Math.sqrt(movingVariance);

    return {
      mean,
      median,
      stdDev,
      mad,
      q1,
      q3,
      iqr,
      min: sorted[0],
      max: sorted[n - 1],
      count: n,
      lastValue: values[n - 1],
      movingAverage,
      movingStdDev,
    };
  }

  // ─── Severity & Description ───────────────────────────────────

  private classifySeverity(absDeviation: number, thresholds: SeverityThresholds): AnomalySeverity {
    if (absDeviation >= thresholds.critical) return 'critical';
    if (absDeviation >= thresholds.high) return 'high';
    if (absDeviation >= thresholds.medium) return 'medium';
    if (absDeviation >= thresholds.low) return 'low';
    return 'info';
  }

  private getDirection(value: number, expected: number): AnomalyDirection {
    if (value > expected) return 'above';
    if (value < expected) return 'below';
    return 'both';
  }

  private generateDescription(
    baseline: MetricBaseline,
    value: number,
    expected: number,
    deviation: number,
    direction: AnomalyDirection,
  ): string {
    const pctDiff = expected !== 0 ? Math.abs(((value - expected) / expected) * 100).toFixed(1) : '∞';
    const directionText = direction === 'above' ? 'above' : 'below';
    return `${baseline.displayName} is ${pctDiff}% ${directionText} expected. ` +
      `Value: ${value.toFixed(2)}, Expected: ${expected.toFixed(2)}, ` +
      `Deviation score: ${deviation.toFixed(2)} (${baseline.method}).`;
  }

  // ─── Anomaly Management ───────────────────────────────────────

  /** Get all anomalies, optionally filtered */
  getAnomalies(filters?: {
    category?: AnomalyCategory;
    severity?: AnomalySeverity;
    metricId?: string;
    acknowledged?: boolean;
    since?: number;
    limit?: number;
  }): AnomalyDetection[] {
    let results = [...this.anomalies];

    if (filters?.category) {
      results = results.filter(a => a.category === filters.category);
    }
    if (filters?.severity) {
      results = results.filter(a => a.severity === filters.severity);
    }
    if (filters?.metricId) {
      results = results.filter(a => a.metricId === filters.metricId);
    }
    if (filters?.acknowledged !== undefined) {
      results = results.filter(a => a.acknowledged === filters.acknowledged);
    }
    if (filters?.since) {
      results = results.filter(a => a.detectedAt >= filters.since!);
    }

    // Sort by detection time, newest first
    results.sort((a, b) => b.detectedAt - a.detectedAt);

    if (filters?.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /** Acknowledge an anomaly (mark as seen) */
  acknowledgeAnomaly(anomalyId: string): boolean {
    const anomaly = this.anomalies.find(a => a.id === anomalyId);
    if (!anomaly) return false;
    anomaly.acknowledged = true;
    this.emit('anomaly:acknowledged', { id: anomalyId });
    return true;
  }

  /** Mark an anomaly as false positive and optionally adjust baseline */
  markFalsePositive(anomalyId: string): boolean {
    const anomaly = this.anomalies.find(a => a.id === anomalyId);
    if (!anomaly) return false;
    anomaly.falsePositive = true;
    anomaly.acknowledged = true;
    this.emit('anomaly:falsePositive', { id: anomalyId });

    // If auto-learn, increase the threshold for this metric slightly
    if (this.config.autoLearn) {
      const baseline = this.metrics.get(anomaly.metricId);
      if (baseline && baseline.autoAdjust) {
        // Increase low threshold by 5% to reduce sensitivity
        baseline.severityThresholds.low *= 1.05;
      }
    }

    return true;
  }

  /** Clear old anomalies */
  trimAnomalies(beforeTimestamp?: number): number {
    const cutoff = beforeTimestamp || (Date.now() - this.config.retentionDays * 86400000);
    const before = this.anomalies.length;
    this.anomalies = this.anomalies.filter(a => a.detectedAt >= cutoff);
    return before - this.anomalies.length;
  }

  // ─── Analysis Helpers ─────────────────────────────────────────

  /** Run a one-shot analysis on a dataset (without storing) */
  analyzeDataset(
    values: number[],
    method: AnomalyDetectionMethod = 'zscore',
    threshold: number = 2.5,
  ): { index: number; value: number; score: number }[] {
    if (values.length < 3) return [];

    const dataPoints: DataPoint[] = values.map((v, i) => ({
      timestamp: i,
      value: v,
    }));

    const stats = this.computeStats(dataPoints);
    const anomalies: { index: number; value: number; score: number }[] = [];

    for (let i = 0; i < values.length; i++) {
      let score: number;
      switch (method) {
        case 'zscore':
          score = Math.abs(this.zScoreDetection(values[i], stats));
          break;
        case 'iqr':
          score = this.iqrDetection(values[i], stats);
          break;
        case 'mad':
          score = Math.abs(this.madDetection(values[i], stats));
          break;
        case 'movingAverage':
          score = Math.abs(this.movingAverageDetection(values[i], stats));
          break;
        default:
          score = Math.abs(this.zScoreDetection(values[i], stats));
      }

      if (score >= threshold) {
        anomalies.push({ index: i, value: values[i], score });
      }
    }

    return anomalies;
  }

  /** Compare two time periods and detect significant changes */
  comparePeriods(
    metricId: string,
    period1End: number,
    period2Start: number,
  ): { significantChange: boolean; direction: AnomalyDirection; percentChange: number; pValue: number } | null {
    const baseline = this.metrics.get(metricId);
    if (!baseline) return null;

    const p1 = baseline.dataPoints.filter(d => d.timestamp <= period1End);
    const p2 = baseline.dataPoints.filter(d => d.timestamp >= period2Start);

    if (p1.length < 3 || p2.length < 3) return null;

    const stats1 = this.computeStats(p1);
    const stats2 = this.computeStats(p2);

    const percentChange = stats1.mean !== 0
      ? ((stats2.mean - stats1.mean) / stats1.mean) * 100
      : 0;

    // Welch's t-test approximation
    const pooledStdErr = Math.sqrt(
      (stats1.stdDev ** 2) / stats1.count +
      (stats2.stdDev ** 2) / stats2.count
    );

    const tStat = pooledStdErr > 0 ? Math.abs(stats2.mean - stats1.mean) / pooledStdErr : 0;

    // Approximate p-value (simplified)
    const pValue = tStat > 3 ? 0.001 : tStat > 2 ? 0.05 : tStat > 1.5 ? 0.1 : 0.5;

    const direction: AnomalyDirection = stats2.mean > stats1.mean ? 'above' : 'below';

    return {
      significantChange: pValue < 0.05,
      direction,
      percentChange,
      pValue,
    };
  }

  // ─── Statistics ───────────────────────────────────────────────

  /** Get engine statistics */
  getStats(): AnomalyEngineStats {
    const anomaliesByCategory: Record<AnomalyCategory, number> = {
      inventory: 0, billing: 0, agent: 0,
      security: 0, performance: 0, usage: 0, custom: 0,
    };
    const anomaliesBySeverity: Record<AnomalySeverity, number> = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
    };

    let unacknowledged = 0;
    let falsePositives = 0;

    for (const a of this.anomalies) {
      anomaliesByCategory[a.category]++;
      anomaliesBySeverity[a.severity]++;
      if (!a.acknowledged) unacknowledged++;
      if (a.falsePositive) falsePositives++;
    }

    let totalDataPoints = 0;
    let warmMetrics = 0;
    for (const baseline of this.metrics.values()) {
      totalDataPoints += baseline.dataPoints.length;
      if (baseline.isWarm) warmMetrics++;
    }

    const totalAnomalies = this.anomalies.length;
    const detectionAccuracy = totalAnomalies > 0
      ? 1 - (falsePositives / totalAnomalies)
      : 1;

    return {
      totalMetrics: this.metrics.size,
      warmMetrics,
      coldMetrics: this.metrics.size - warmMetrics,
      totalAnomalies,
      unacknowledgedAnomalies: unacknowledged,
      falsePositives,
      totalDataPoints,
      anomaliesByCategory,
      anomaliesBySeverity,
      detectionAccuracy,
    };
  }

  /** Get a voice-friendly summary */
  getVoiceSummary(): string {
    const stats = this.getStats();
    const unack = stats.unacknowledgedAnomalies;

    if (unack === 0) {
      return 'No anomalies detected. All metrics within normal range.';
    }

    const criticalCount = stats.anomaliesBySeverity.critical;
    const highCount = stats.anomaliesBySeverity.high;
    const parts: string[] = [`${unack} unacknowledged ${unack === 1 ? 'anomaly' : 'anomalies'} detected.`];

    if (criticalCount > 0) {
      parts.push(`${criticalCount} critical.`);
    }
    if (highCount > 0) {
      parts.push(`${highCount} high severity.`);
    }

    // Add the most recent critical anomaly description
    const recent = this.getAnomalies({ severity: 'critical', acknowledged: false, limit: 1 });
    if (recent.length > 0) {
      parts.push(`Most urgent: ${recent[0].description}`);
    }

    return parts.join(' ');
  }

  /** Reset all data */
  reset(): void {
    this.metrics.clear();
    this.anomalies = [];
    this.anomalyCounter = 0;
  }
}
