/**
 * Notification Engine — Smart notification routing and priority management.
 *
 * When you're wearing smart glasses, notification overload is a real problem.
 * This engine ensures:
 *   1. Only important things get spoken aloud (TTS)
 *   2. Low-priority items are silently logged
 *   3. Notifications are batched intelligently (not rapid-fire)
 *   4. Context-aware: quiet during meetings, concise while driving
 *   5. Rate-limited: no more than N notifications per minute
 *   6. Deduplication: don't repeat the same alert
 *   7. Escalation: if something keeps happening, raise its priority
 *
 * Delivery channels:
 *   - TTS (spoken through glasses speaker)
 *   - Dashboard (push to web dashboard via SSE)
 *   - Silent log (recorded but not delivered immediately)
 *   - Vibration pattern (if glasses support haptic)
 *   - Phone push notification (via companion app)
 *
 * @module notifications/notification-engine
 */

import { EventEmitter } from 'eventemitter3';

// ─── Types ──────────────────────────────────────────────────────

/**
 * Priority levels for notifications.
 * Lower number = higher priority.
 */
export type NotificationPriority = 'critical' | 'high' | 'medium' | 'low' | 'silent';

export const PRIORITY_VALUES: Record<NotificationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  silent: 4,
};

/**
 * Notification categories for grouping and filtering.
 */
export type NotificationCategory =
  | 'security'     // Threats, phishing, suspicious activity
  | 'inventory'    // Low stock, misplaced items, count discrepancies
  | 'meeting'      // Action items, meeting starting, summary ready
  | 'deal'         // Price alerts, deal verdicts
  | 'navigation'   // Directions, arrivals, geofence events
  | 'social'       // Contact found, networking intel
  | 'health'       // Nutrition alerts, medication reminders
  | 'system'       // Battery low, connection lost, errors
  | 'inspection'   // Findings, safety hazards
  | 'translation'  // Translation ready, cultural tip
  | 'debug'        // Code fix found, error identified
  | 'context'      // Contextual help, identification
  | 'chain'        // Chain phase started/completed
  | 'custom';      // User-defined

/**
 * Delivery channel for a notification.
 */
export type DeliveryChannel =
  | 'tts'          // Spoken through glasses speaker
  | 'dashboard'    // Pushed to web dashboard via SSE
  | 'silent'       // Recorded but not delivered
  | 'haptic'       // Vibration pattern (if supported)
  | 'phone'        // Push notification to companion app
  | 'sound';       // Audio chime/tone (not TTS)

/**
 * User context for smart routing decisions.
 */
export type UserContext =
  | 'idle'         // Not doing anything specific
  | 'meeting'      // In a meeting (only critical interruptions)
  | 'driving'      // Driving (audio only, keep it brief)
  | 'shopping'     // Shopping (price/product alerts welcome)
  | 'working'      // Working/coding (debug alerts welcome)
  | 'inspecting'   // Doing an inspection (findings welcome)
  | 'networking'   // At an event (contact info welcome)
  | 'sleeping'     // Do not disturb (critical only)
  | 'traveling';   // Traveling (translation/navigation welcome)

/**
 * A notification to be delivered.
 */
export interface Notification {
  /** Unique notification ID */
  id: string;
  /** Priority level */
  priority: NotificationPriority;
  /** Category for grouping */
  category: NotificationCategory;
  /** Short title (for dashboard display) */
  title: string;
  /** Detailed message */
  message: string;
  /** TTS text (may differ from message — shorter, more conversational) */
  ttsText?: string;
  /** Source agent that generated this notification */
  sourceAgent?: string;
  /** ISO timestamp */
  createdAt: string;
  /** Optional data payload */
  data?: unknown;
  /** Deduplification key (notifications with same key within window are deduplicated) */
  dedupeKey?: string;
  /** Tags for filtering */
  tags?: string[];
  /** Whether this notification should expire */
  expiresAt?: string;
  /** Group ID for batching related notifications */
  groupId?: string;
}

/**
 * A delivered notification with delivery metadata.
 */
export interface DeliveredNotification extends Notification {
  /** How it was delivered */
  deliveredVia: DeliveryChannel[];
  /** When it was delivered */
  deliveredAt: string;
  /** Whether the user acknowledged it */
  acknowledged: boolean;
  /** TTS was suppressed (e.g., in meeting) */
  ttsSuppressed: boolean;
}

/**
 * Configuration for the notification engine.
 */
export interface NotificationEngineConfig {
  /** Maximum TTS notifications per minute */
  maxTtsPerMinute: number;
  /** Minimum seconds between TTS notifications */
  minTtsCooldownSec: number;
  /** Maximum TTS text length (characters) */
  maxTtsLength: number;
  /** Deduplication window in seconds */
  dedupeWindowSec: number;
  /** Batch window in milliseconds — group rapid notifications */
  batchWindowMs: number;
  /** Maximum batch size before forcing delivery */
  maxBatchSize: number;
  /** Whether TTS is globally enabled */
  ttsEnabled: boolean;
  /** Whether haptic is available */
  hapticAvailable: boolean;
  /** Whether phone push is available */
  phonePushAvailable: boolean;
  /** Quiet hours (no TTS except critical) */
  quietHoursStart?: number; // Hour (0-23)
  quietHoursEnd?: number;   // Hour (0-23)
  /** Current user context */
  userContext: UserContext;
  /** Custom priority thresholds per context */
  contextThresholds?: Partial<Record<UserContext, NotificationPriority>>;
  /** Enable debug logging */
  debug: boolean;
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationEngineConfig = {
  maxTtsPerMinute: 6,
  minTtsCooldownSec: 5,
  maxTtsLength: 200,
  dedupeWindowSec: 60,
  batchWindowMs: 2000,
  maxBatchSize: 5,
  ttsEnabled: true,
  hapticAvailable: false,
  phonePushAvailable: false,
  userContext: 'idle',
  debug: false,
};

/**
 * Delivery routing rule — maps priority + category + context to channels.
 */
export interface DeliveryRule {
  /** Minimum priority to trigger this rule (inclusive) */
  minPriority: NotificationPriority;
  /** Categories this rule applies to (empty = all) */
  categories?: NotificationCategory[];
  /** User contexts this rule applies to (empty = all) */
  contexts?: UserContext[];
  /** Channels to deliver through */
  channels: DeliveryChannel[];
  /** Override TTS text with shorter version */
  truncateTts?: number;
}

/**
 * Events emitted by the notification engine.
 */
export interface NotificationEngineEvents {
  'notification:queued': (notification: Notification) => void;
  'notification:delivered': (notification: DeliveredNotification) => void;
  'notification:deduplicated': (notification: Notification, existingId: string) => void;
  'notification:expired': (notification: Notification) => void;
  'notification:batched': (groupId: string, notifications: Notification[]) => void;
  'notification:tts': (text: string, priority: NotificationPriority) => void;
  'notification:dashboard': (notification: DeliveredNotification) => void;
  'notification:phone': (notification: DeliveredNotification) => void;
  'notification:suppressed': (notification: Notification, reason: string) => void;
  'notification:escalated': (notification: Notification, from: NotificationPriority, to: NotificationPriority) => void;
}

// ─── Engine Implementation ──────────────────────────────────────

let notificationCounter = 0;
function generateNotificationId(): string {
  notificationCounter++;
  return `notif-${Date.now()}-${notificationCounter}`;
}

/**
 * Notification Engine — Smart notification routing for smart glasses.
 *
 * Usage:
 * ```ts
 * const engine = new NotificationEngine();
 *
 * // Send a notification
 * engine.notify({
 *   priority: 'high',
 *   category: 'security',
 *   title: 'Phishing detected',
 *   message: 'That QR code redirects to a phishing site',
 *   ttsText: 'Warning — that QR code is a phishing attempt. Don\'t scan it.',
 * });
 *
 * // Listen for TTS delivery
 * engine.on('notification:tts', (text, priority) => {
 *   glasses.speak(text);
 * });
 *
 * // Update context
 * engine.setContext('meeting'); // Will suppress non-critical TTS
 * ```
 */
export class NotificationEngine extends EventEmitter<NotificationEngineEvents> {
  private config: NotificationEngineConfig;
  private deliveryRules: DeliveryRule[];
  private recentDeliveries: DeliveredNotification[] = [];
  private dedupeCache: Map<string, { id: string; timestamp: number }> = new Map();
  private ttsTimestamps: number[] = [];
  private lastTtsTime = 0;
  private batchBuffer: Map<string, Notification[]> = new Map();
  private batchTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private escalationCounts: Map<string, number> = new Map();

  constructor(config: Partial<NotificationEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_NOTIFICATION_CONFIG, ...config };
    this.deliveryRules = this.buildDefaultRules();
  }

  // ─── Core API ─────────────────────────────────────────────

  /**
   * Send a notification through the engine.
   * Returns the notification with an assigned ID, or null if deduplicated.
   */
  notify(input: Omit<Notification, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Notification | null {
    const notification: Notification = {
      id: input.id || generateNotificationId(),
      createdAt: input.createdAt || new Date().toISOString(),
      ...input,
    };

    // 1. Check expiry
    if (notification.expiresAt && new Date(notification.expiresAt) < new Date()) {
      this.emit('notification:expired', notification);
      return null;
    }

    // 2. Check deduplication
    if (notification.dedupeKey) {
      const existing = this.dedupeCache.get(notification.dedupeKey);
      if (existing && (Date.now() - existing.timestamp) < this.config.dedupeWindowSec * 1000) {
        this.emit('notification:deduplicated', notification, existing.id);

        // Track escalation — if the same thing keeps happening, raise priority
        const count = (this.escalationCounts.get(notification.dedupeKey) || 0) + 1;
        this.escalationCounts.set(notification.dedupeKey, count);

        if (count >= 3 && notification.priority !== 'critical') {
          const escalated = this.escalatePriority(notification);
          if (escalated) {
            this.emit('notification:escalated', notification, notification.priority, escalated.priority);
            return this.deliverNotification(escalated);
          }
        }

        return null;
      }

      this.dedupeCache.set(notification.dedupeKey, {
        id: notification.id,
        timestamp: Date.now(),
      });
    }

    // 3. Check batching
    if (notification.groupId && notification.priority !== 'critical' && notification.priority !== 'high') {
      return this.batchNotification(notification);
    }

    // 4. Deliver
    this.emit('notification:queued', notification);
    return this.deliverNotification(notification);
  }

  /**
   * Set the current user context (affects delivery routing).
   */
  setContext(context: UserContext): void {
    this.config.userContext = context;
  }

  /**
   * Get the current user context.
   */
  getContext(): UserContext {
    return this.config.userContext;
  }

  /**
   * Acknowledge a notification by ID.
   */
  acknowledge(notificationId: string): boolean {
    const delivered = this.recentDeliveries.find((d) => d.id === notificationId);
    if (delivered) {
      delivered.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * Get recent deliveries with optional filtering.
   */
  getRecentDeliveries(options?: {
    limit?: number;
    category?: NotificationCategory;
    priority?: NotificationPriority;
    acknowledged?: boolean;
  }): DeliveredNotification[] {
    let results = [...this.recentDeliveries];

    if (options?.category) {
      results = results.filter((d) => d.category === options.category);
    }
    if (options?.priority) {
      results = results.filter((d) => d.priority === options.priority);
    }
    if (options?.acknowledged !== undefined) {
      results = results.filter((d) => d.acknowledged === options.acknowledged);
    }

    const limit = options?.limit ?? 50;
    return results.slice(-limit);
  }

  /**
   * Enable or disable TTS globally.
   */
  setTtsEnabled(enabled: boolean): void {
    this.config.ttsEnabled = enabled;
  }

  /**
   * Check if TTS is currently available (enabled + not rate-limited + not in quiet hours).
   */
  isTtsAvailable(): boolean {
    if (!this.config.ttsEnabled) return false;
    if (this.isQuietHours()) return false;
    if (!this.canTts()) return false;
    return true;
  }

  /**
   * Set quiet hours.
   */
  setQuietHours(start: number, end: number): void {
    this.config.quietHoursStart = start;
    this.config.quietHoursEnd = end;
  }

  /**
   * Clear quiet hours.
   */
  clearQuietHours(): void {
    this.config.quietHoursStart = undefined;
    this.config.quietHoursEnd = undefined;
  }

  /**
   * Add a custom delivery rule.
   */
  addRule(rule: DeliveryRule): void {
    this.deliveryRules.push(rule);
    // Sort by priority (most restrictive first)
    this.deliveryRules.sort(
      (a, b) => PRIORITY_VALUES[a.minPriority] - PRIORITY_VALUES[b.minPriority],
    );
  }

  /**
   * Get engine statistics.
   */
  getStats(): NotificationEngineStats {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;

    const recentTts = this.ttsTimestamps.filter((t) => t > oneMinuteAgo).length;
    const totalDelivered = this.recentDeliveries.length;
    const ttsSuppressed = this.recentDeliveries.filter((d) => d.ttsSuppressed).length;
    const acknowledged = this.recentDeliveries.filter((d) => d.acknowledged).length;

    const byCategory: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const d of this.recentDeliveries) {
      byCategory[d.category] = (byCategory[d.category] || 0) + 1;
      byPriority[d.priority] = (byPriority[d.priority] || 0) + 1;
    }

    return {
      totalDelivered,
      ttsSuppressed,
      acknowledged,
      ttsInLastMinute: recentTts,
      ttsAvailable: this.isTtsAvailable(),
      currentContext: this.config.userContext,
      isQuietHours: this.isQuietHours(),
      batchesPending: this.batchBuffer.size,
      dedupeCacheSize: this.dedupeCache.size,
      escalationsPending: this.escalationCounts.size,
      byCategory,
      byPriority,
    };
  }

  /**
   * Clear all state (for testing or reset).
   */
  reset(): void {
    this.recentDeliveries = [];
    this.dedupeCache.clear();
    this.ttsTimestamps = [];
    this.lastTtsTime = 0;
    this.escalationCounts.clear();
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchBuffer.clear();
    this.batchTimers.clear();
  }

  // ─── Delivery Logic ───────────────────────────────────────

  private deliverNotification(notification: Notification): Notification {
    const channels = this.resolveChannels(notification);
    let ttsSuppressed = false;

    // Check if TTS should be delivered
    const shouldTts = channels.includes('tts') && this.config.ttsEnabled;

    if (shouldTts) {
      const canSpeak = this.canTts() && !this.isQuietHours();

      // In quiet hours, only critical gets TTS
      const quietOverride = this.isQuietHours() && notification.priority === 'critical';

      if (canSpeak || quietOverride) {
        const ttsText = this.prepareTtsText(notification);
        this.recordTts();
        this.emit('notification:tts', ttsText, notification.priority);
      } else {
        ttsSuppressed = true;
        this.emit('notification:suppressed', notification,
          this.isQuietHours() ? 'quiet_hours' : 'rate_limited');
      }
    }

    // Dashboard delivery
    if (channels.includes('dashboard')) {
      // Emit for SSE push
    }

    // Phone push
    if (channels.includes('phone') && this.config.phonePushAvailable) {
      // Would push to companion app
    }

    // Create delivered record
    const delivered: DeliveredNotification = {
      ...notification,
      deliveredVia: channels.filter((c) => !(c === 'tts' && ttsSuppressed)),
      deliveredAt: new Date().toISOString(),
      acknowledged: false,
      ttsSuppressed,
    };

    this.recentDeliveries.push(delivered);

    // Keep history bounded
    if (this.recentDeliveries.length > 500) {
      this.recentDeliveries = this.recentDeliveries.slice(-250);
    }

    this.emit('notification:delivered', delivered);

    if (channels.includes('dashboard')) {
      this.emit('notification:dashboard', delivered);
    }
    if (channels.includes('phone')) {
      this.emit('notification:phone', delivered);
    }

    return notification;
  }

  private resolveChannels(notification: Notification): DeliveryChannel[] {
    const context = this.config.userContext;
    const channels = new Set<DeliveryChannel>();

    // Find matching rules
    for (const rule of this.deliveryRules) {
      // Check priority
      if (PRIORITY_VALUES[notification.priority] > PRIORITY_VALUES[rule.minPriority]) {
        continue; // Notification priority is lower than rule threshold
      }

      // Check category
      if (rule.categories && rule.categories.length > 0 && !rule.categories.includes(notification.category)) {
        continue;
      }

      // Check context
      if (rule.contexts && rule.contexts.length > 0 && !rule.contexts.includes(context)) {
        continue;
      }

      // Rule matches — add channels
      for (const ch of rule.channels) {
        channels.add(ch);
      }
    }

    // Context-based suppressions
    if (context === 'sleeping' && notification.priority !== 'critical') {
      channels.delete('tts');
      channels.delete('sound');
      channels.delete('haptic');
    }

    if (context === 'meeting' && notification.priority !== 'critical' && notification.priority !== 'high') {
      channels.delete('tts');
      channels.delete('sound');
    }

    // Always log to dashboard for non-silent
    if (notification.priority !== 'silent') {
      channels.add('dashboard');
    }

    // Silent notifications only go to silent log
    if (notification.priority === 'silent') {
      channels.clear();
      channels.add('silent');
    }

    return Array.from(channels);
  }

  private buildDefaultRules(): DeliveryRule[] {
    return [
      // Critical — always TTS + haptic + phone
      {
        minPriority: 'critical',
        channels: ['tts', 'dashboard', 'haptic', 'phone'],
      },
      // High — TTS + dashboard (except during meetings/sleeping)
      {
        minPriority: 'high',
        channels: ['tts', 'dashboard'],
        contexts: ['idle', 'shopping', 'working', 'inspecting', 'networking', 'traveling'],
      },
      // High in meeting — dashboard + haptic only
      {
        minPriority: 'high',
        channels: ['dashboard', 'haptic'],
        contexts: ['meeting'],
      },
      // Medium security — always TTS (safety matters)
      {
        minPriority: 'medium',
        categories: ['security'],
        channels: ['tts', 'dashboard'],
      },
      // Medium — dashboard only
      {
        minPriority: 'medium',
        channels: ['dashboard'],
      },
      // Low — silent log
      {
        minPriority: 'low',
        channels: ['dashboard'],
      },
    ];
  }

  // ─── TTS Management ───────────────────────────────────────

  private canTts(): boolean {
    const now = Date.now();

    // Clean old timestamps
    const oneMinuteAgo = now - 60_000;
    this.ttsTimestamps = this.ttsTimestamps.filter((t) => t > oneMinuteAgo);

    // Check rate limit
    if (this.ttsTimestamps.length >= this.config.maxTtsPerMinute) {
      return false;
    }

    // Check cooldown
    if (now - this.lastTtsTime < this.config.minTtsCooldownSec * 1000) {
      return false;
    }

    return true;
  }

  private recordTts(): void {
    const now = Date.now();
    this.ttsTimestamps.push(now);
    this.lastTtsTime = now;
  }

  private prepareTtsText(notification: Notification): string {
    let text = notification.ttsText || notification.message;

    // Truncate if needed
    if (text.length > this.config.maxTtsLength) {
      text = text.substring(0, this.config.maxTtsLength - 3) + '...';
    }

    return text;
  }

  // ─── Quiet Hours ──────────────────────────────────────────

  private isQuietHours(): boolean {
    if (this.config.quietHoursStart === undefined || this.config.quietHoursEnd === undefined) {
      return false;
    }

    const now = new Date();
    const hour = now.getHours();
    const start = this.config.quietHoursStart;
    const end = this.config.quietHoursEnd;

    // Handle overnight ranges (e.g., 23-7)
    if (start > end) {
      return hour >= start || hour < end;
    }

    // Same-day range (e.g., 8-17)
    return hour >= start && hour < end;
  }

  // ─── Batching ─────────────────────────────────────────────

  private batchNotification(notification: Notification): Notification {
    const groupId = notification.groupId!;

    if (!this.batchBuffer.has(groupId)) {
      this.batchBuffer.set(groupId, []);
    }

    const batch = this.batchBuffer.get(groupId)!;
    batch.push(notification);

    // Force flush if batch is full
    if (batch.length >= this.config.maxBatchSize) {
      this.flushBatch(groupId);
      return notification;
    }

    // Reset batch timer
    const existingTimer = this.batchTimers.get(groupId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.batchTimers.set(
      groupId,
      setTimeout(() => this.flushBatch(groupId), this.config.batchWindowMs),
    );

    return notification;
  }

  private flushBatch(groupId: string): void {
    const batch = this.batchBuffer.get(groupId);
    if (!batch || batch.length === 0) return;

    this.batchBuffer.delete(groupId);
    const timer = this.batchTimers.get(groupId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(groupId);
    }

    this.emit('notification:batched', groupId, batch);

    // Find highest priority in the batch
    let highestPriority: NotificationPriority = 'silent';
    for (const n of batch) {
      if (PRIORITY_VALUES[n.priority] < PRIORITY_VALUES[highestPriority]) {
        highestPriority = n.priority;
      }
    }

    // Create a summary notification for the batch
    if (batch.length === 1) {
      this.deliverNotification(batch[0]);
    } else {
      const summary: Notification = {
        id: generateNotificationId(),
        priority: highestPriority,
        category: batch[0].category,
        title: `${batch.length} ${batch[0].category} updates`,
        message: batch.map((n) => n.title).join('. '),
        ttsText: `${batch.length} ${batch[0].category} updates. ${batch[0].title}.`,
        sourceAgent: batch[0].sourceAgent,
        createdAt: new Date().toISOString(),
        tags: ['batched'],
      };

      this.deliverNotification(summary);
    }
  }

  // ─── Escalation ───────────────────────────────────────────

  private escalatePriority(notification: Notification): Notification | null {
    const current = notification.priority;
    const escalation: Record<NotificationPriority, NotificationPriority | null> = {
      silent: 'low',
      low: 'medium',
      medium: 'high',
      high: 'critical',
      critical: null, // Can't escalate further
    };

    const next = escalation[current];
    if (!next) return null;

    return {
      ...notification,
      id: generateNotificationId(),
      priority: next,
      title: `[Escalated] ${notification.title}`,
      ttsText: notification.ttsText
        ? `Repeated alert: ${notification.ttsText}`
        : undefined,
      createdAt: new Date().toISOString(),
      tags: [...(notification.tags || []), 'escalated'],
    };
  }
}

export interface NotificationEngineStats {
  totalDelivered: number;
  ttsSuppressed: number;
  acknowledged: number;
  ttsInLastMinute: number;
  ttsAvailable: boolean;
  currentContext: UserContext;
  isQuietHours: boolean;
  batchesPending: number;
  dedupeCacheSize: number;
  escalationsPending: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
}
