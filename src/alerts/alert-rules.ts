/**
 * Alert Rules Engine — Meta Ray-Bans × OpenClaw
 *
 * User-definable alert rules with conditions and actions. The intelligence
 * layer that makes the platform proactive — detecting patterns and
 * triggering automated responses.
 *
 * Features:
 * - Composable conditions: AND/OR/NOT with nested groups
 * - 12+ condition types: threshold, change, pattern, schedule, geo, etc.
 * - 7+ action types: notify, voice, export, webhook, email, escalate, script
 * - Alert severity levels with escalation chains
 * - Cooldown periods to prevent alert storms
 * - Alert acknowledgment and resolution workflow
 * - Built-in rule templates for common scenarios
 * - Alert history with analytics
 * - Voice-friendly alert summaries for TTS
 *
 * 🌙 Night Shift Agent — Shift #24
 */

import { EventEmitter } from 'events';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical' | 'emergency';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved' | 'expired' | 'silenced';
export type ConditionOperator = 'AND' | 'OR';
export type ComparisonOp = 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'not_contains' | 'matches' | 'between' | 'in';

export type ConditionType =
  | 'threshold'        // value crosses a threshold
  | 'change'           // value changes by N or N%
  | 'absence'          // value hasn't been updated in N seconds
  | 'pattern'          // regex match on a string field
  | 'frequency'        // event occurs N times in M seconds
  | 'anomaly'          // value deviates from rolling average
  | 'comparison'       // compare two fields
  | 'time_window'      // condition true during specific hours
  | 'geo_fence'        // location-based trigger
  | 'sequence'         // events happen in a specific order
  | 'composite'        // nested condition group
  | 'custom';          // user-defined function

export type ActionType =
  | 'notify'           // send notification through notification router
  | 'voice'            // TTS alert through glasses
  | 'export'           // trigger an export
  | 'webhook'          // call a webhook
  | 'email'            // send email
  | 'escalate'         // escalate to higher severity
  | 'auto_resolve'     // auto-resolve after conditions clear
  | 'log'              // log to audit trail
  | 'custom';          // user-defined function

export interface AlertCondition {
  type: ConditionType;
  field?: string;
  operator?: ComparisonOp;
  value?: unknown;
  // Threshold-specific
  threshold?: number;
  direction?: 'above' | 'below' | 'equal';
  // Change-specific
  changeAmount?: number;
  changePercent?: number;
  changeWindow?: number; // ms
  // Absence-specific
  absenceTimeout?: number; // ms
  // Frequency-specific
  frequencyCount?: number;
  frequencyWindow?: number; // ms
  // Anomaly-specific
  anomalyStdDev?: number;
  anomalyWindow?: number; // ms, for rolling average
  // Time window
  timeWindowStart?: string; // HH:MM
  timeWindowEnd?: string;   // HH:MM
  timeWindowDays?: number[];  // 0=Sun ... 6=Sat
  // Geo fence
  geoCenter?: { lat: number; lng: number };
  geoRadius?: number; // meters
  geoTrigger?: 'enter' | 'exit' | 'both';
  // Composite
  conditions?: AlertCondition[];
  conditionOperator?: ConditionOperator;
  // Custom
  evaluator?: (context: EvaluationContext) => boolean;
}

export interface AlertAction {
  type: ActionType;
  // Notify
  channels?: string[];
  message?: string;
  // Voice
  voiceMessage?: string;
  voicePriority?: 'normal' | 'high' | 'urgent';
  // Webhook
  webhookUrl?: string;
  webhookHeaders?: Record<string, string>;
  // Email
  emailTo?: string[];
  emailSubject?: string;
  emailBody?: string;
  // Export
  exportSource?: string;
  exportFormat?: string;
  // Escalate
  escalateTo?: AlertSeverity;
  escalateAfter?: number; // ms without acknowledgment
  // Log
  logCategory?: string;
  logDetails?: string;
  // Custom
  handler?: (alert: Alert, context: EvaluationContext) => void;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: AlertSeverity;
  conditions: AlertCondition[];
  conditionOperator: ConditionOperator;
  actions: AlertAction[];
  cooldownMs: number; // minimum time between firings
  maxFirings?: number; // max times this rule can fire (0 = unlimited)
  autoResolveMs?: number; // auto-resolve after N ms if conditions clear
  tags: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  lastFiredAt?: number;
  fireCount: number;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  details: Record<string, unknown>;
  createdAt: number;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  resolvedAt?: number;
  resolvedBy?: string;
  silencedUntil?: number;
  escalatedAt?: number;
  escalatedTo?: AlertSeverity;
  tags: string[];
}

export interface EvaluationContext {
  timestamp: number;
  data: Record<string, unknown>;
  previousData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AlertStats {
  totalRules: number;
  enabledRules: number;
  totalAlerts: number;
  alertsByStatus: Record<string, number>;
  alertsBySeverity: Record<string, number>;
  topFiringRules: Array<{ ruleId: string; name: string; count: number }>;
  averageTimeToAcknowledge: number;
  averageTimeToResolve: number;
  alertsLast24h: number;
  alertsLast7d: number;
}

// ─── Built-in Rule Templates ─────────────────────────────────────────────────

export interface RuleTemplate {
  name: string;
  description: string;
  severity: AlertSeverity;
  conditions: AlertCondition[];
  conditionOperator: ConditionOperator;
  actions: AlertAction[];
  cooldownMs: number;
  tags: string[];
}

const RULE_TEMPLATES: Record<string, RuleTemplate> = {
  'low-stock': {
    name: 'Low Stock Alert',
    description: 'Alerts when inventory quantity drops below threshold',
    severity: 'warning',
    conditions: [{
      type: 'threshold',
      field: 'quantity',
      threshold: 5,
      direction: 'below',
    }],
    conditionOperator: 'AND',
    actions: [
      { type: 'voice', voiceMessage: 'Low stock detected: {{product}} has only {{quantity}} units remaining.', voicePriority: 'high' },
      { type: 'notify', message: 'Low stock: {{product}} - {{quantity}} units', channels: ['push', 'in_app'] },
    ],
    cooldownMs: 4 * 60 * 60 * 1000, // 4 hours
    tags: ['inventory', 'stock'],
  },
  'out-of-stock': {
    name: 'Out of Stock Alert',
    description: 'Critical alert when a product reaches zero inventory',
    severity: 'critical',
    conditions: [{
      type: 'threshold',
      field: 'quantity',
      threshold: 0,
      direction: 'equal',
    }],
    conditionOperator: 'AND',
    actions: [
      { type: 'voice', voiceMessage: 'CRITICAL: {{product}} is out of stock!', voicePriority: 'urgent' },
      { type: 'notify', message: 'OUT OF STOCK: {{product}}', channels: ['push', 'email', 'in_app'] },
      { type: 'log', logCategory: 'inventory', logDetails: 'Product out of stock' },
    ],
    cooldownMs: 1 * 60 * 60 * 1000, // 1 hour
    tags: ['inventory', 'critical'],
  },
  'price-mismatch': {
    name: 'Price Mismatch Detected',
    description: 'Alerts when scanned price differs from expected price',
    severity: 'warning',
    conditions: [{
      type: 'comparison',
      field: 'scannedPrice',
      operator: 'ne',
      value: 'expectedPrice',
    }],
    conditionOperator: 'AND',
    actions: [
      { type: 'voice', voiceMessage: 'Price mismatch: {{product}} shows {{scannedPrice}} but expected {{expectedPrice}}.', voicePriority: 'normal' },
      { type: 'notify', message: 'Price mismatch on {{product}}', channels: ['in_app'] },
    ],
    cooldownMs: 5 * 60 * 1000, // 5 minutes
    tags: ['inventory', 'pricing'],
  },
  'security-threat': {
    name: 'Security Threat Detected',
    description: 'Alert on high/critical security findings',
    severity: 'critical',
    conditions: [{
      type: 'threshold',
      field: 'threatLevel',
      operator: 'gte',
      threshold: 0.7,
      direction: 'above',
    }],
    conditionOperator: 'AND',
    actions: [
      { type: 'voice', voiceMessage: 'Security alert: {{threat}}. Risk level: high.', voicePriority: 'urgent' },
      { type: 'notify', message: '🔒 Security: {{threat}}', channels: ['push', 'email'] },
      { type: 'log', logCategory: 'security', logDetails: 'Threat detected' },
    ],
    cooldownMs: 60 * 1000, // 1 minute
    tags: ['security', 'critical'],
  },
  'inspection-finding': {
    name: 'Critical Inspection Finding',
    description: 'Alert on critical severity inspection findings',
    severity: 'critical',
    conditions: [{
      type: 'threshold',
      field: 'findingSeverity',
      operator: 'eq',
      value: 'critical',
    }],
    conditionOperator: 'AND',
    actions: [
      { type: 'voice', voiceMessage: 'Critical finding in {{area}}: {{finding}}.', voicePriority: 'urgent' },
      { type: 'notify', message: '⚠️ Critical finding: {{finding}}', channels: ['push', 'email', 'in_app'] },
    ],
    cooldownMs: 0, // always fire for critical findings
    tags: ['inspection', 'critical'],
  },
  'inactivity': {
    name: 'Session Inactivity',
    description: 'Alert when no activity detected for extended period',
    severity: 'info',
    conditions: [{
      type: 'absence',
      field: 'lastActivity',
      absenceTimeout: 30 * 60 * 1000, // 30 minutes
    }],
    conditionOperator: 'AND',
    actions: [
      { type: 'voice', voiceMessage: 'No activity detected for 30 minutes. Session may have been left running.' },
      { type: 'notify', message: 'Inventory session idle for 30 minutes', channels: ['in_app'] },
    ],
    cooldownMs: 30 * 60 * 1000,
    tags: ['session', 'inactivity'],
  },
  'daily-summary': {
    name: 'Daily Summary',
    description: 'Scheduled daily summary at end of business',
    severity: 'info',
    conditions: [{
      type: 'time_window',
      timeWindowStart: '17:00',
      timeWindowEnd: '17:30',
      timeWindowDays: [1, 2, 3, 4, 5], // Mon-Fri
    }],
    conditionOperator: 'AND',
    actions: [
      { type: 'voice', voiceMessage: 'End of day summary: {{totalItems}} items counted, {{sessions}} sessions today, {{flaggedItems}} items flagged.' },
      { type: 'export', exportSource: 'inventory_items', exportFormat: 'csv' },
      { type: 'email', emailSubject: 'Daily Inventory Summary', emailBody: 'Today: {{totalItems}} items, {{flaggedItems}} flagged' },
    ],
    cooldownMs: 23 * 60 * 60 * 1000, // 23 hours
    tags: ['scheduled', 'summary'],
  },
  'anomaly-detection': {
    name: 'Count Anomaly Detected',
    description: 'Alert when item count deviates significantly from historical average',
    severity: 'warning',
    conditions: [{
      type: 'anomaly',
      field: 'quantity',
      anomalyStdDev: 2,
      anomalyWindow: 7 * 24 * 60 * 60 * 1000, // 7 days
    }],
    conditionOperator: 'AND',
    actions: [
      { type: 'voice', voiceMessage: 'Unusual count for {{product}}: {{quantity}} vs average {{average}}. Possible shrinkage or counting error.' },
      { type: 'notify', message: '📊 Anomaly: {{product}} count unusual', channels: ['push', 'in_app'] },
    ],
    cooldownMs: 12 * 60 * 60 * 1000, // 12 hours
    tags: ['inventory', 'anomaly'],
  },
};

// ─── Alert Rules Engine Implementation ───────────────────────────────────────

export class AlertRulesEngine extends EventEmitter {
  private rules: Map<string, AlertRule> = new Map();
  private alerts: Map<string, Alert> = new Map();
  private eventHistory: Array<{ field: string; value: unknown; timestamp: number }> = [];
  private maxHistorySize = 10_000;

  constructor() {
    super();
  }

  // ─── Rule Management ─────────────────────────────────────────────────

  createRule(
    name: string,
    description: string,
    severity: AlertSeverity,
    conditions: AlertCondition[],
    actions: AlertAction[],
    options: {
      conditionOperator?: ConditionOperator;
      cooldownMs?: number;
      maxFirings?: number;
      autoResolveMs?: number;
      tags?: string[];
      createdBy?: string;
    } = {},
  ): AlertRule {
    const now = Date.now();
    const rule: AlertRule = {
      id: `rule-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description,
      enabled: true,
      severity,
      conditions,
      conditionOperator: options.conditionOperator ?? 'AND',
      actions,
      cooldownMs: options.cooldownMs ?? 300_000, // 5 min default
      maxFirings: options.maxFirings,
      autoResolveMs: options.autoResolveMs,
      tags: options.tags ?? [],
      createdBy: options.createdBy ?? 'system',
      createdAt: now,
      updatedAt: now,
      fireCount: 0,
    };

    this.rules.set(rule.id, rule);
    this.emit('rule:created', { id: rule.id, name: rule.name });
    return rule;
  }

  createFromTemplate(templateId: string, overrides: Partial<Pick<AlertRule, 'name' | 'severity' | 'cooldownMs' | 'tags'>> & { createdBy?: string } = {}): AlertRule | null {
    const template = RULE_TEMPLATES[templateId];
    if (!template) return null;

    return this.createRule(
      overrides.name ?? template.name,
      template.description,
      overrides.severity ?? template.severity,
      template.conditions,
      template.actions,
      {
        conditionOperator: template.conditionOperator,
        cooldownMs: overrides.cooldownMs ?? template.cooldownMs,
        tags: overrides.tags ?? template.tags,
        createdBy: overrides.createdBy ?? 'template',
      },
    );
  }

  getRule(id: string): AlertRule | undefined {
    return this.rules.get(id);
  }

  listRules(options: { enabled?: boolean; tags?: string[]; severity?: AlertSeverity } = {}): AlertRule[] {
    let rules = [...this.rules.values()];

    if (options.enabled !== undefined) {
      rules = rules.filter(r => r.enabled === options.enabled);
    }
    if (options.tags && options.tags.length > 0) {
      rules = rules.filter(r => options.tags!.some(t => r.tags.includes(t)));
    }
    if (options.severity) {
      rules = rules.filter(r => r.severity === options.severity);
    }

    return rules;
  }

  updateRule(id: string, updates: Partial<Pick<AlertRule, 'name' | 'description' | 'enabled' | 'severity' | 'cooldownMs' | 'conditions' | 'actions' | 'tags'>>): AlertRule | null {
    const rule = this.rules.get(id);
    if (!rule) return null;

    if (updates.name !== undefined) rule.name = updates.name;
    if (updates.description !== undefined) rule.description = updates.description;
    if (updates.enabled !== undefined) rule.enabled = updates.enabled;
    if (updates.severity !== undefined) rule.severity = updates.severity;
    if (updates.cooldownMs !== undefined) rule.cooldownMs = updates.cooldownMs;
    if (updates.conditions !== undefined) rule.conditions = updates.conditions;
    if (updates.actions !== undefined) rule.actions = updates.actions;
    if (updates.tags !== undefined) rule.tags = updates.tags;
    rule.updatedAt = Date.now();

    this.emit('rule:updated', { id: rule.id, name: rule.name });
    return rule;
  }

  deleteRule(id: string): boolean {
    const deleted = this.rules.delete(id);
    if (deleted) this.emit('rule:deleted', { id });
    return deleted;
  }

  enableRule(id: string): boolean {
    const rule = this.rules.get(id);
    if (!rule) return false;
    rule.enabled = true;
    rule.updatedAt = Date.now();
    return true;
  }

  disableRule(id: string): boolean {
    const rule = this.rules.get(id);
    if (!rule) return false;
    rule.enabled = false;
    rule.updatedAt = Date.now();
    return true;
  }

  listTemplates(): Array<{ id: string; name: string; description: string; severity: AlertSeverity }> {
    return Object.entries(RULE_TEMPLATES).map(([id, t]) => ({
      id,
      name: t.name,
      description: t.description,
      severity: t.severity,
    }));
  }

  // ─── Evaluation ──────────────────────────────────────────────────────

  evaluate(context: EvaluationContext): Alert[] {
    const firedAlerts: Alert[] = [];

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Check cooldown
      if (rule.lastFiredAt && (Date.now() - rule.lastFiredAt) < rule.cooldownMs) {
        continue;
      }

      // Check max firings
      if (rule.maxFirings && rule.fireCount >= rule.maxFirings) {
        continue;
      }

      // Evaluate conditions
      const matches = this.evaluateConditions(rule.conditions, rule.conditionOperator, context);

      if (matches) {
        const alert = this.fireAlert(rule, context);
        firedAlerts.push(alert);
      }
    }

    // Record event history
    for (const [field, value] of Object.entries(context.data)) {
      this.eventHistory.push({ field, value, timestamp: context.timestamp });
    }
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }

    return firedAlerts;
  }

  private evaluateConditions(
    conditions: AlertCondition[],
    operator: ConditionOperator,
    context: EvaluationContext,
  ): boolean {
    if (conditions.length === 0) return false;

    const results = conditions.map(c => this.evaluateCondition(c, context));

    if (operator === 'AND') {
      return results.every(r => r);
    }
    return results.some(r => r);
  }

  private evaluateCondition(condition: AlertCondition, context: EvaluationContext): boolean {
    switch (condition.type) {
      case 'threshold':
        return this.evalThreshold(condition, context);
      case 'change':
        return this.evalChange(condition, context);
      case 'absence':
        return this.evalAbsence(condition, context);
      case 'pattern':
        return this.evalPattern(condition, context);
      case 'frequency':
        return this.evalFrequency(condition, context);
      case 'anomaly':
        return this.evalAnomaly(condition, context);
      case 'comparison':
        return this.evalComparison(condition, context);
      case 'time_window':
        return this.evalTimeWindow(condition, context);
      case 'geo_fence':
        return this.evalGeoFence(condition, context);
      case 'composite':
        return this.evaluateConditions(
          condition.conditions ?? [],
          condition.conditionOperator ?? 'AND',
          context,
        );
      case 'custom':
        return condition.evaluator?.(context) ?? false;
      default:
        return false;
    }
  }

  private evalThreshold(condition: AlertCondition, context: EvaluationContext): boolean {
    const value = context.data[condition.field ?? ''];
    if (typeof value !== 'number' || condition.threshold === undefined) return false;

    switch (condition.direction) {
      case 'above': return value > condition.threshold;
      case 'below': return value < condition.threshold;
      case 'equal': return value === condition.threshold;
      default:
        // Fallback to operator-based comparison
        return this.compareValues(value, condition.operator ?? 'gt', condition.threshold);
    }
  }

  private evalChange(condition: AlertCondition, context: EvaluationContext): boolean {
    const currentValue = context.data[condition.field ?? ''];
    const previousValue = context.previousData?.[condition.field ?? ''];

    if (typeof currentValue !== 'number' || typeof previousValue !== 'number') return false;

    if (condition.changeAmount !== undefined) {
      return Math.abs(currentValue - previousValue) >= condition.changeAmount;
    }

    if (condition.changePercent !== undefined && previousValue !== 0) {
      const percentChange = Math.abs((currentValue - previousValue) / previousValue) * 100;
      return percentChange >= condition.changePercent;
    }

    return false;
  }

  private evalAbsence(condition: AlertCondition, context: EvaluationContext): boolean {
    const lastUpdate = context.data[condition.field ?? ''] as number | undefined;
    if (lastUpdate === undefined || condition.absenceTimeout === undefined) return false;

    return (context.timestamp - lastUpdate) > condition.absenceTimeout;
  }

  private evalPattern(condition: AlertCondition, context: EvaluationContext): boolean {
    const value = context.data[condition.field ?? ''];
    if (typeof value !== 'string' || typeof condition.value !== 'string') return false;

    try {
      const regex = new RegExp(condition.value, 'i');
      return regex.test(value);
    } catch {
      return false;
    }
  }

  private evalFrequency(condition: AlertCondition, context: EvaluationContext): boolean {
    if (!condition.frequencyCount || !condition.frequencyWindow) return false;

    const field = condition.field ?? '';
    const windowStart = context.timestamp - condition.frequencyWindow;

    const recentEvents = this.eventHistory.filter(
      e => e.field === field && e.timestamp >= windowStart
    );

    return recentEvents.length >= condition.frequencyCount;
  }

  private evalAnomaly(condition: AlertCondition, context: EvaluationContext): boolean {
    const value = context.data[condition.field ?? ''];
    if (typeof value !== 'number') return false;

    const field = condition.field ?? '';
    const windowStart = context.timestamp - (condition.anomalyWindow ?? 7 * 24 * 60 * 60 * 1000);

    const historicalValues = this.eventHistory
      .filter(e => e.field === field && e.timestamp >= windowStart && typeof e.value === 'number')
      .map(e => e.value as number);

    if (historicalValues.length < 3) return false; // Need enough data

    const mean = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;
    const variance = historicalValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / historicalValues.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return value !== mean;

    const deviations = Math.abs(value - mean) / stdDev;
    return deviations >= (condition.anomalyStdDev ?? 2);
  }

  private evalComparison(condition: AlertCondition, context: EvaluationContext): boolean {
    const value = context.data[condition.field ?? ''];
    let compareValue = condition.value;

    // If value is a string, it might be a reference to another field
    if (typeof compareValue === 'string' && context.data[compareValue] !== undefined) {
      compareValue = context.data[compareValue];
    }

    return this.compareValues(value, condition.operator ?? 'eq', compareValue);
  }

  private evalTimeWindow(condition: AlertCondition, context: EvaluationContext): boolean {
    const now = new Date(context.timestamp);
    const currentDay = now.getDay();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Check day of week
    if (condition.timeWindowDays && condition.timeWindowDays.length > 0) {
      if (!condition.timeWindowDays.includes(currentDay)) return false;
    }

    // Check time range
    if (condition.timeWindowStart && condition.timeWindowEnd) {
      return currentTime >= condition.timeWindowStart && currentTime <= condition.timeWindowEnd;
    }

    return true;
  }

  private evalGeoFence(condition: AlertCondition, context: EvaluationContext): boolean {
    const lat = context.data['latitude'] as number | undefined;
    const lng = context.data['longitude'] as number | undefined;

    if (lat === undefined || lng === undefined || !condition.geoCenter || !condition.geoRadius) {
      return false;
    }

    const distance = this.haversineDistance(lat, lng, condition.geoCenter.lat, condition.geoCenter.lng);
    const isInside = distance <= condition.geoRadius;

    switch (condition.geoTrigger ?? 'enter') {
      case 'enter': return isInside;
      case 'exit': return !isInside;
      case 'both': return true;
      default: return isInside;
    }
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private compareValues(value: unknown, operator: ComparisonOp, compareValue: unknown): boolean {
    switch (operator) {
      case 'eq': return value === compareValue;
      case 'ne': return value !== compareValue;
      case 'gt': return typeof value === 'number' && typeof compareValue === 'number' && value > compareValue;
      case 'lt': return typeof value === 'number' && typeof compareValue === 'number' && value < compareValue;
      case 'gte': return typeof value === 'number' && typeof compareValue === 'number' && value >= compareValue;
      case 'lte': return typeof value === 'number' && typeof compareValue === 'number' && value <= compareValue;
      case 'contains':
        return typeof value === 'string' && typeof compareValue === 'string' &&
          value.toLowerCase().includes(compareValue.toLowerCase());
      case 'not_contains':
        return typeof value === 'string' && typeof compareValue === 'string' &&
          !value.toLowerCase().includes(compareValue.toLowerCase());
      case 'matches':
        if (typeof value !== 'string' || typeof compareValue !== 'string') return false;
        try { return new RegExp(compareValue, 'i').test(value); } catch { return false; }
      case 'in':
        return Array.isArray(compareValue) && compareValue.includes(value);
      case 'between':
        if (typeof value !== 'number' || !Array.isArray(compareValue) || compareValue.length !== 2) return false;
        return value >= (compareValue[0] as number) && value <= (compareValue[1] as number);
      default:
        return false;
    }
  }

  // ─── Alert Lifecycle ─────────────────────────────────────────────────

  private fireAlert(rule: AlertRule, context: EvaluationContext): Alert {
    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      status: 'active',
      message: this.interpolateMessage(rule.actions[0]?.message ?? rule.name, context),
      details: { ...context.data },
      createdAt: Date.now(),
      tags: [...rule.tags],
    };

    this.alerts.set(alert.id, alert);
    rule.lastFiredAt = Date.now();
    rule.fireCount++;

    // Execute actions
    for (const action of rule.actions) {
      this.executeAction(action, alert, context);
    }

    this.emit('alert:fired', {
      alertId: alert.id,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: alert.severity,
    });

    return alert;
  }

  private executeAction(action: AlertAction, alert: Alert, context: EvaluationContext): void {
    switch (action.type) {
      case 'voice':
        this.emit('action:voice', {
          alertId: alert.id,
          message: this.interpolateMessage(action.voiceMessage ?? alert.message, context),
          priority: action.voicePriority ?? 'normal',
        });
        break;

      case 'notify':
        this.emit('action:notify', {
          alertId: alert.id,
          message: this.interpolateMessage(action.message ?? alert.message, context),
          channels: action.channels ?? ['in_app'],
        });
        break;

      case 'webhook':
        this.emit('action:webhook', {
          alertId: alert.id,
          url: action.webhookUrl,
          headers: action.webhookHeaders,
          payload: { alert, context: context.data },
        });
        break;

      case 'email':
        this.emit('action:email', {
          alertId: alert.id,
          to: action.emailTo,
          subject: this.interpolateMessage(action.emailSubject ?? alert.ruleName, context),
          body: this.interpolateMessage(action.emailBody ?? alert.message, context),
        });
        break;

      case 'export':
        this.emit('action:export', {
          alertId: alert.id,
          source: action.exportSource,
          format: action.exportFormat,
        });
        break;

      case 'escalate':
        if (action.escalateTo) {
          alert.escalatedAt = Date.now();
          alert.escalatedTo = action.escalateTo;
          alert.severity = action.escalateTo;
          this.emit('alert:escalated', { alertId: alert.id, to: action.escalateTo });
        }
        break;

      case 'log':
        this.emit('action:log', {
          alertId: alert.id,
          category: action.logCategory,
          details: this.interpolateMessage(action.logDetails ?? '', context),
        });
        break;

      case 'custom':
        if (action.handler) {
          try {
            action.handler(alert, context);
          } catch {
            // Swallow custom handler errors
          }
        }
        break;
    }
  }

  private interpolateMessage(template: string, context: EvaluationContext): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = context.data[key] ?? context.metadata?.[key];
      return value !== undefined ? String(value) : `{{${key}}}`;
    });
  }

  // ─── Alert Management ────────────────────────────────────────────────

  getAlert(id: string): Alert | undefined {
    return this.alerts.get(id);
  }

  listAlerts(options: {
    status?: AlertStatus;
    severity?: AlertSeverity;
    ruleId?: string;
    tags?: string[];
    limit?: number;
  } = {}): Alert[] {
    let alerts = [...this.alerts.values()];

    if (options.status) alerts = alerts.filter(a => a.status === options.status);
    if (options.severity) alerts = alerts.filter(a => a.severity === options.severity);
    if (options.ruleId) alerts = alerts.filter(a => a.ruleId === options.ruleId);
    if (options.tags && options.tags.length > 0) {
      alerts = alerts.filter(a => options.tags!.some(t => a.tags.includes(t)));
    }

    alerts.sort((a, b) => b.createdAt - a.createdAt);

    if (options.limit) alerts = alerts.slice(0, options.limit);
    return alerts;
  }

  acknowledgeAlert(alertId: string, userId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status !== 'active') return false;

    alert.status = 'acknowledged';
    alert.acknowledgedAt = Date.now();
    alert.acknowledgedBy = userId;

    this.emit('alert:acknowledged', { alertId, userId });
    return true;
  }

  resolveAlert(alertId: string, userId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status === 'resolved') return false;

    alert.status = 'resolved';
    alert.resolvedAt = Date.now();
    alert.resolvedBy = userId;

    this.emit('alert:resolved', { alertId, userId });
    return true;
  }

  silenceAlert(alertId: string, durationMs: number): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.status = 'silenced';
    alert.silencedUntil = Date.now() + durationMs;

    this.emit('alert:silenced', { alertId, until: alert.silencedUntil });
    return true;
  }

  bulkAcknowledge(alertIds: string[], userId: string): number {
    let count = 0;
    for (const id of alertIds) {
      if (this.acknowledgeAlert(id, userId)) count++;
    }
    return count;
  }

  bulkResolve(alertIds: string[], userId: string): number {
    let count = 0;
    for (const id of alertIds) {
      if (this.resolveAlert(id, userId)) count++;
    }
    return count;
  }

  getActiveAlertCount(): { total: number; bySeverity: Record<string, number> } {
    const active = [...this.alerts.values()].filter(a => a.status === 'active');
    const bySeverity: Record<string, number> = {};

    for (const alert of active) {
      bySeverity[alert.severity] = (bySeverity[alert.severity] ?? 0) + 1;
    }

    return { total: active.length, bySeverity };
  }

  // ─── Stats ───────────────────────────────────────────────────────────

  getStats(): AlertStats {
    const allAlerts = [...this.alerts.values()];
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const alertsByStatus: Record<string, number> = {};
    const alertsBySeverity: Record<string, number> = {};
    let totalAckTime = 0;
    let ackCount = 0;
    let totalResolveTime = 0;
    let resolveCount = 0;

    for (const alert of allAlerts) {
      alertsByStatus[alert.status] = (alertsByStatus[alert.status] ?? 0) + 1;
      alertsBySeverity[alert.severity] = (alertsBySeverity[alert.severity] ?? 0) + 1;

      if (alert.acknowledgedAt) {
        totalAckTime += alert.acknowledgedAt - alert.createdAt;
        ackCount++;
      }
      if (alert.resolvedAt) {
        totalResolveTime += alert.resolvedAt - alert.createdAt;
        resolveCount++;
      }
    }

    const topFiringRules = [...this.rules.values()]
      .filter(r => r.fireCount > 0)
      .sort((a, b) => b.fireCount - a.fireCount)
      .slice(0, 10)
      .map(r => ({ ruleId: r.id, name: r.name, count: r.fireCount }));

    return {
      totalRules: this.rules.size,
      enabledRules: [...this.rules.values()].filter(r => r.enabled).length,
      totalAlerts: allAlerts.length,
      alertsByStatus,
      alertsBySeverity,
      topFiringRules,
      averageTimeToAcknowledge: ackCount > 0 ? Math.round(totalAckTime / ackCount) : 0,
      averageTimeToResolve: resolveCount > 0 ? Math.round(totalResolveTime / resolveCount) : 0,
      alertsLast24h: allAlerts.filter(a => now - a.createdAt < day).length,
      alertsLast7d: allAlerts.filter(a => now - a.createdAt < 7 * day).length,
    };
  }

  // ─── Voice Summary ───────────────────────────────────────────────────

  voiceSummary(): string {
    const active = this.getActiveAlertCount();
    if (active.total === 0) {
      return 'No active alerts. All clear.';
    }

    const parts = [`${active.total} active alert${active.total === 1 ? '' : 's'}.`];

    if (active.bySeverity['emergency']) {
      parts.push(`${active.bySeverity['emergency']} emergency.`);
    }
    if (active.bySeverity['critical']) {
      parts.push(`${active.bySeverity['critical']} critical.`);
    }
    if (active.bySeverity['warning']) {
      parts.push(`${active.bySeverity['warning']} warning${(active.bySeverity['warning'] ?? 0) > 1 ? 's' : ''}.`);
    }
    if (active.bySeverity['info']) {
      parts.push(`${active.bySeverity['info']} informational.`);
    }

    return parts.join(' ');
  }

  voiceAlertDetail(alertId: string): string {
    const alert = this.alerts.get(alertId);
    if (!alert) return 'Alert not found.';

    const age = Date.now() - alert.createdAt;
    const ageStr = age < 60000 ? 'just now' :
      age < 3600000 ? `${Math.round(age / 60000)} minutes ago` :
      `${Math.round(age / 3600000)} hours ago`;

    return `${alert.severity} alert from ${alert.ruleName}: ${alert.message}. Triggered ${ageStr}. Status: ${alert.status}.`;
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────

  cleanupResolved(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    let cleaned = 0;

    for (const [id, alert] of this.alerts) {
      if (
        (alert.status === 'resolved' || alert.status === 'expired') &&
        alert.createdAt < cutoff
      ) {
        this.alerts.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}
