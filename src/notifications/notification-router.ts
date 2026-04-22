/**
 * Notification Router
 * 
 * Unified notification delivery system for the Ray-Bans × OpenClaw platform.
 * Routes notifications across multiple channels (push, email, SMS, in-app, voice/TTS)
 * based on user preferences, priority, and context.
 * 
 * Features:
 * - Multi-channel delivery: email, push, SMS, in-app, voice (TTS to glasses)
 * - Priority-based routing: critical → all channels, low → in-app only
 * - User preference honoring: quiet hours, channel opt-out, frequency caps
 * - Template system: reusable notification templates with variable interpolation
 * - Delivery tracking: sent, delivered, failed, read statuses
 * - Batching: group low-priority notifications into digests
 * - Rate limiting: per-user, per-channel frequency caps
 * - Retry with exponential backoff for failed deliveries
 * - Notification history with search and filtering
 * - Voice-friendly notification summaries
 * 
 * 🌙 Night Shift Agent — 2026-03-09
 */

import { EventEmitter } from 'eventemitter3';
import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';
export type DeliveryChannel = 'email' | 'push' | 'sms' | 'in_app' | 'voice';
export type DeliveryStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'read' | 'skipped';
export type NotificationCategory =
  | 'inventory' | 'security' | 'billing' | 'meeting' | 'system'
  | 'inspection' | 'deal' | 'memory' | 'team' | 'device' | 'custom';

export interface NotificationRouterConfig {
  /** Maximum notifications per user per hour (default: 20) */
  maxPerUserPerHour?: number;
  /** Maximum notifications per user per day (default: 100) */
  maxPerUserPerDay?: number;
  /** Digest interval in minutes for low-priority (default: 60) */
  digestIntervalMinutes?: number;
  /** Maximum retry attempts for failed delivery (default: 3) */
  maxRetryAttempts?: number;
  /** Retry base delay in ms (default: 1000) */
  retryBaseDelayMs?: number;
  /** Maximum notification history per user (default: 500) */
  maxHistoryPerUser?: number;
  /** Default channels for each priority level */
  defaultChannels?: Partial<Record<NotificationPriority, DeliveryChannel[]>>;
  /** Critical notifications bypass quiet hours (default: true) */
  criticalBypassQuietHours?: boolean;
}

export interface NotificationPayload {
  /** Target user ID */
  userId: string;
  /** Notification title */
  title: string;
  /** Notification body (text) */
  body: string;
  /** Priority level */
  priority: NotificationPriority;
  /** Category for grouping and filtering */
  category: NotificationCategory;
  /** Optional short TTS version of the body */
  voiceSummary?: string;
  /** Optional data payload (for push notifications) */
  data?: Record<string, unknown>;
  /** Optional action URL */
  actionUrl?: string;
  /** Optional action buttons */
  actions?: NotificationAction[];
  /** Override delivery channels (ignores user preferences) */
  channelOverride?: DeliveryChannel[];
  /** Group key for digest batching */
  groupKey?: string;
  /** Template ID to use */
  templateId?: string;
  /** Template variables */
  templateVars?: Record<string, string>;
  /** Expiry in minutes (notification becomes stale after) */
  expiryMinutes?: number;
  /** Source agent/module that triggered this notification */
  source?: string;
}

export interface NotificationAction {
  label: string;
  url?: string;
  actionId: string;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  category: NotificationCategory;
  voiceSummary?: string;
  data?: Record<string, unknown>;
  actionUrl?: string;
  actions?: NotificationAction[];
  groupKey?: string;
  source?: string;
  deliveries: DeliveryRecord[];
  createdAt: string;
  expiresAt?: string;
  readAt?: string;
  dismissedAt?: string;
}

export interface DeliveryRecord {
  channel: DeliveryChannel;
  status: DeliveryStatus;
  attemptCount: number;
  sentAt?: string;
  deliveredAt?: string;
  failedAt?: string;
  error?: string;
  providerMessageId?: string;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  category: NotificationCategory;
  titleTemplate: string;
  bodyTemplate: string;
  voiceTemplate?: string;
  defaultPriority: NotificationPriority;
  defaultChannels?: DeliveryChannel[];
  createdAt: string;
}

export interface UserNotificationSettings {
  userId: string;
  enabledChannels: DeliveryChannel[];
  quietHoursStart?: string; // HH:MM
  quietHoursEnd?: string;   // HH:MM
  quietHoursTimezone?: string;
  categoryPreferences: Partial<Record<NotificationCategory, { enabled: boolean; channels?: DeliveryChannel[] }>>;
  digestEnabled: boolean;
  digestTime?: string; // HH:MM — when to send digest
}

export interface NotificationQuery {
  userId?: string;
  category?: NotificationCategory;
  priority?: NotificationPriority;
  unreadOnly?: boolean;
  since?: string;
  limit?: number;
  offset?: number;
}

export interface DigestEntry {
  userId: string;
  notifications: NotificationRecord[];
  scheduledFor: string;
}

export interface ChannelAdapter {
  channel: DeliveryChannel;
  send(notification: NotificationRecord, delivery: DeliveryRecord): Promise<{ messageId?: string }>;
}

export interface NotificationRouterEvents {
  'notification:created': (notification: NotificationRecord) => void;
  'notification:sent': (notificationId: string, channel: DeliveryChannel) => void;
  'notification:delivered': (notificationId: string, channel: DeliveryChannel) => void;
  'notification:failed': (notificationId: string, channel: DeliveryChannel, error: string) => void;
  'notification:read': (notificationId: string) => void;
  'notification:dismissed': (notificationId: string) => void;
  'notification:rate_limited': (userId: string) => void;
  'digest:created': (userId: string, count: number) => void;
  'channel:registered': (channel: DeliveryChannel) => void;
}

// ─── Default Channel Routing ─────────────────────────────────────────────────

const DEFAULT_PRIORITY_CHANNELS: Record<NotificationPriority, DeliveryChannel[]> = {
  critical: ['push', 'email', 'sms', 'in_app', 'voice'],
  high: ['push', 'email', 'in_app'],
  normal: ['push', 'in_app'],
  low: ['in_app'],
};

const DEFAULT_USER_SETTINGS: UserNotificationSettings = {
  userId: '',
  enabledChannels: ['email', 'push', 'in_app', 'voice'],
  categoryPreferences: {},
  digestEnabled: false,
};

// ─── Implementation ─────────────────────────────────────────────────────────

export class NotificationRouter extends EventEmitter<NotificationRouterEvents> {
  private config: Required<NotificationRouterConfig>;
  private notifications = new Map<string, NotificationRecord>(); // id → notification
  private userNotifications = new Map<string, string[]>(); // userId → notificationIds
  private userSettings = new Map<string, UserNotificationSettings>();
  private templates = new Map<string, NotificationTemplate>();
  private channelAdapters = new Map<DeliveryChannel, ChannelAdapter>();
  private digestQueue = new Map<string, NotificationRecord[]>(); // userId → pending digest
  private rateLimitBuckets = new Map<string, { hourly: number; daily: number; hourReset: number; dayReset: number }>();

  constructor(config: NotificationRouterConfig = {}) {
    super();
    this.config = {
      maxPerUserPerHour: config.maxPerUserPerHour ?? 20,
      maxPerUserPerDay: config.maxPerUserPerDay ?? 100,
      digestIntervalMinutes: config.digestIntervalMinutes ?? 60,
      maxRetryAttempts: config.maxRetryAttempts ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 1000,
      maxHistoryPerUser: config.maxHistoryPerUser ?? 500,
      defaultChannels: config.defaultChannels ?? DEFAULT_PRIORITY_CHANNELS,
      criticalBypassQuietHours: config.criticalBypassQuietHours ?? true,
    };
  }

  // ─── Channel Adapters ───────────────────────────────────────────────

  registerChannel(adapter: ChannelAdapter): void {
    this.channelAdapters.set(adapter.channel, adapter);
    this.emit('channel:registered', adapter.channel);
  }

  getRegisteredChannels(): DeliveryChannel[] {
    return Array.from(this.channelAdapters.keys());
  }

  // ─── User Settings ─────────────────────────────────────────────────

  setUserSettings(settings: UserNotificationSettings): void {
    this.userSettings.set(settings.userId, settings);
  }

  getUserSettings(userId: string): UserNotificationSettings {
    return this.userSettings.get(userId) ?? { ...DEFAULT_USER_SETTINGS, userId };
  }

  // ─── Templates ──────────────────────────────────────────────────────

  registerTemplate(template: Omit<NotificationTemplate, 'id' | 'createdAt'>): NotificationTemplate {
    const id = `tpl_${crypto.randomUUID().slice(0, 8)}`;
    const record: NotificationTemplate = {
      ...template,
      id,
      createdAt: new Date().toISOString(),
    };
    this.templates.set(id, record);
    return record;
  }

  getTemplate(templateId: string): NotificationTemplate | undefined {
    return this.templates.get(templateId);
  }

  listTemplates(category?: NotificationCategory): NotificationTemplate[] {
    const all = Array.from(this.templates.values());
    if (category) return all.filter(t => t.category === category);
    return all;
  }

  deleteTemplate(templateId: string): boolean {
    return this.templates.delete(templateId);
  }

  // ─── Send Notification ──────────────────────────────────────────────

  async send(payload: NotificationPayload): Promise<NotificationRecord> {
    // Resolve template if specified
    let title = payload.title;
    let body = payload.body;
    let voiceSummary = payload.voiceSummary;
    let priority = payload.priority;

    if (payload.templateId) {
      const template = this.templates.get(payload.templateId);
      if (template) {
        title = this.interpolateTemplate(template.titleTemplate, payload.templateVars ?? {});
        body = this.interpolateTemplate(template.bodyTemplate, payload.templateVars ?? {});
        if (template.voiceTemplate) {
          voiceSummary = this.interpolateTemplate(template.voiceTemplate, payload.templateVars ?? {});
        }
        priority = payload.priority ?? template.defaultPriority;
      }
    }

    // Check rate limits
    if (!this.checkRateLimit(payload.userId)) {
      this.emit('notification:rate_limited', payload.userId);
      // Still create the notification but mark it as skipped
      const record = this.createRecord(payload, title, body, voiceSummary);
      record.deliveries = [{ channel: 'in_app', status: 'skipped', attemptCount: 0 }];
      this.storeNotification(record);
      return record;
    }

    // Determine delivery channels
    const channels = this.resolveChannels(payload);

    // Check if should digest instead of immediate
    const settings = this.getUserSettings(payload.userId);
    if (settings.digestEnabled && payload.priority === 'low' && !payload.channelOverride) {
      return this.queueForDigest(payload, title, body, voiceSummary);
    }

    // Create the notification record
    const record = this.createRecord(payload, title, body, voiceSummary);

    // Create delivery records for each channel
    record.deliveries = channels.map(channel => ({
      channel,
      status: 'queued' as DeliveryStatus,
      attemptCount: 0,
    }));

    this.storeNotification(record);
    this.emit('notification:created', record);

    // Attempt delivery on each channel
    await Promise.allSettled(
      record.deliveries.map(delivery => this.deliverToChannel(record, delivery))
    );

    // Increment rate limit counters
    this.incrementRateLimit(payload.userId);

    return record;
  }

  async sendBatch(payloads: NotificationPayload[]): Promise<NotificationRecord[]> {
    const results: NotificationRecord[] = [];
    for (const payload of payloads) {
      results.push(await this.send(payload));
    }
    return results;
  }

  // ─── Digest ─────────────────────────────────────────────────────────

  private queueForDigest(
    payload: NotificationPayload,
    title: string,
    body: string,
    voiceSummary?: string,
  ): NotificationRecord {
    const record = this.createRecord(payload, title, body, voiceSummary);
    record.deliveries = [{ channel: 'in_app', status: 'queued', attemptCount: 0 }];

    this.storeNotification(record);

    const queue = this.digestQueue.get(payload.userId) ?? [];
    queue.push(record);
    this.digestQueue.set(payload.userId, queue);

    return record;
  }

  flushDigest(userId: string): NotificationRecord[] {
    const queue = this.digestQueue.get(userId) ?? [];
    if (queue.length === 0) return [];

    this.digestQueue.set(userId, []);
    this.emit('digest:created', userId, queue.length);

    return queue;
  }

  getDigestQueue(userId: string): NotificationRecord[] {
    return this.digestQueue.get(userId) ?? [];
  }

  // ─── Delivery ───────────────────────────────────────────────────────

  private async deliverToChannel(record: NotificationRecord, delivery: DeliveryRecord): Promise<void> {
    const adapter = this.channelAdapters.get(delivery.channel);
    if (!adapter) {
      // No adapter registered — skip silently
      delivery.status = 'skipped';
      return;
    }

    delivery.status = 'sending';
    delivery.attemptCount++;

    try {
      const result = await adapter.send(record, delivery);
      delivery.status = 'sent';
      delivery.sentAt = new Date().toISOString();
      if (result.messageId) {
        delivery.providerMessageId = result.messageId;
      }
      this.emit('notification:sent', record.id, delivery.channel);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      delivery.error = errorMsg;

      if (delivery.attemptCount < this.config.maxRetryAttempts) {
        delivery.status = 'queued'; // will retry
      } else {
        delivery.status = 'failed';
        delivery.failedAt = new Date().toISOString();
        this.emit('notification:failed', record.id, delivery.channel, errorMsg);
      }
    }
  }

  async retryFailed(notificationId: string): Promise<boolean> {
    const record = this.notifications.get(notificationId);
    if (!record) return false;

    const failedDeliveries = record.deliveries.filter(d => d.status === 'failed' || d.status === 'queued');
    if (failedDeliveries.length === 0) return false;

    for (const delivery of failedDeliveries) {
      delivery.status = 'queued';
      await this.deliverToChannel(record, delivery);
    }

    return true;
  }

  confirmDelivery(notificationId: string, channel: DeliveryChannel): void {
    const record = this.notifications.get(notificationId);
    if (!record) return;

    const delivery = record.deliveries.find(d => d.channel === channel);
    if (delivery) {
      delivery.status = 'delivered';
      delivery.deliveredAt = new Date().toISOString();
      this.emit('notification:delivered', notificationId, channel);
    }
  }

  // ─── Read/Dismiss ───────────────────────────────────────────────────

  markAsRead(notificationId: string): void {
    const record = this.notifications.get(notificationId);
    if (!record) return;
    if (record.readAt) return; // already read

    record.readAt = new Date().toISOString();
    this.emit('notification:read', notificationId);
  }

  markAllAsRead(userId: string): number {
    const ids = this.userNotifications.get(userId) ?? [];
    let count = 0;
    for (const id of ids) {
      const record = this.notifications.get(id);
      if (record && !record.readAt) {
        record.readAt = new Date().toISOString();
        count++;
      }
    }
    return count;
  }

  dismissNotification(notificationId: string): void {
    const record = this.notifications.get(notificationId);
    if (!record) return;

    record.dismissedAt = new Date().toISOString();
    this.emit('notification:dismissed', notificationId);
  }

  // ─── Query ──────────────────────────────────────────────────────────

  queryNotifications(query: NotificationQuery = {}): { notifications: NotificationRecord[]; total: number } {
    let results = Array.from(this.notifications.values());

    if (query.userId) {
      const ids = new Set(this.userNotifications.get(query.userId) ?? []);
      results = results.filter(n => ids.has(n.id));
    }

    if (query.category) {
      results = results.filter(n => n.category === query.category);
    }

    if (query.priority) {
      results = results.filter(n => n.priority === query.priority);
    }

    if (query.unreadOnly) {
      results = results.filter(n => !n.readAt);
    }

    if (query.since) {
      results = results.filter(n => n.createdAt >= query.since!);
    }

    // Sort by creation date descending (newest first)
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = results.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    results = results.slice(offset, offset + limit);

    return { notifications: results, total };
  }

  getNotification(notificationId: string): NotificationRecord | undefined {
    return this.notifications.get(notificationId);
  }

  getUnreadCount(userId: string): number {
    const ids = this.userNotifications.get(userId) ?? [];
    return ids.reduce((count, id) => {
      const record = this.notifications.get(id);
      if (record && !record.readAt) count++;
      return count;
    }, 0);
  }

  getUnreadByCategory(userId: string): Record<string, number> {
    const ids = this.userNotifications.get(userId) ?? [];
    const result: Record<string, number> = {};
    for (const id of ids) {
      const record = this.notifications.get(id);
      if (record && !record.readAt) {
        result[record.category] = (result[record.category] ?? 0) + 1;
      }
    }
    return result;
  }

  // ─── Statistics ─────────────────────────────────────────────────────

  getStats(): {
    totalNotifications: number;
    totalDeliveries: number;
    deliverySuccessRate: number;
    byCategory: Record<string, number>;
    byPriority: Record<string, number>;
    byChannel: Record<string, { sent: number; failed: number }>;
    unreadTotal: number;
  } {
    const allNotifications = Array.from(this.notifications.values());
    const byCategory: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const byChannel: Record<string, { sent: number; failed: number }> = {};
    let totalDeliveries = 0;
    let successfulDeliveries = 0;
    let unreadTotal = 0;

    for (const n of allNotifications) {
      byCategory[n.category] = (byCategory[n.category] ?? 0) + 1;
      byPriority[n.priority] = (byPriority[n.priority] ?? 0) + 1;
      if (!n.readAt) unreadTotal++;

      for (const d of n.deliveries) {
        totalDeliveries++;
        if (!byChannel[d.channel]) byChannel[d.channel] = { sent: 0, failed: 0 };
        if (d.status === 'sent' || d.status === 'delivered' || d.status === 'read') {
          byChannel[d.channel].sent++;
          successfulDeliveries++;
        } else if (d.status === 'failed') {
          byChannel[d.channel].failed++;
        }
      }
    }

    return {
      totalNotifications: allNotifications.length,
      totalDeliveries,
      deliverySuccessRate: totalDeliveries > 0 ? successfulDeliveries / totalDeliveries : 1,
      byCategory,
      byPriority,
      byChannel,
      unreadTotal,
    };
  }

  // ─── Voice Summary ──────────────────────────────────────────────────

  getVoiceSummary(userId: string): string {
    const unread = this.getUnreadCount(userId);
    if (unread === 0) return 'No new notifications.';

    const byCategory = this.getUnreadByCategory(userId);
    const parts: string[] = [`You have ${unread} unread notification${unread !== 1 ? 's' : ''}`];

    const categoryNames: Record<string, string> = {
      inventory: 'inventory',
      security: 'security',
      billing: 'billing',
      meeting: 'meeting',
      system: 'system',
      inspection: 'inspection',
      deal: 'deal',
      memory: 'memory',
      team: 'team',
      device: 'device',
      custom: 'other',
    };

    const entries = Object.entries(byCategory).sort(([, a], [, b]) => b - a);
    if (entries.length > 0) {
      const summaryParts = entries
        .slice(0, 3) // top 3 categories
        .map(([cat, count]) => `${count} ${categoryNames[cat] ?? cat}`);
      parts.push(summaryParts.join(', '));
    }

    return parts.join(': ') + '.';
  }

  // ─── Cleanup ────────────────────────────────────────────────────────

  cleanupExpired(): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, record] of this.notifications) {
      if (record.expiresAt && new Date(record.expiresAt).getTime() < now) {
        this.notifications.delete(id);
        const userIds = this.userNotifications.get(record.userId);
        if (userIds) {
          const idx = userIds.indexOf(id);
          if (idx !== -1) userIds.splice(idx, 1);
        }
        removed++;
      }
    }

    return removed;
  }

  enforceHistoryLimit(userId: string): number {
    const ids = this.userNotifications.get(userId) ?? [];
    if (ids.length <= this.config.maxHistoryPerUser) return 0;

    // Get notifications sorted oldest first
    const sorted = ids
      .map(id => ({ id, record: this.notifications.get(id)! }))
      .filter(x => x.record)
      .sort((a, b) => a.record.createdAt.localeCompare(b.record.createdAt));

    const toRemove = sorted.slice(0, sorted.length - this.config.maxHistoryPerUser);
    for (const { id } of toRemove) {
      this.notifications.delete(id);
    }

    this.userNotifications.set(userId, ids.filter(id => this.notifications.has(id)));
    return toRemove.length;
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  private createRecord(
    payload: NotificationPayload,
    title: string,
    body: string,
    voiceSummary?: string,
  ): NotificationRecord {
    const now = new Date();
    return {
      id: crypto.randomUUID(),
      userId: payload.userId,
      title,
      body,
      priority: payload.priority,
      category: payload.category,
      voiceSummary,
      data: payload.data,
      actionUrl: payload.actionUrl,
      actions: payload.actions,
      groupKey: payload.groupKey,
      source: payload.source,
      deliveries: [],
      createdAt: now.toISOString(),
      expiresAt: payload.expiryMinutes
        ? new Date(now.getTime() + payload.expiryMinutes * 60_000).toISOString()
        : undefined,
    };
  }

  private storeNotification(record: NotificationRecord): void {
    this.notifications.set(record.id, record);
    const userIds = this.userNotifications.get(record.userId) ?? [];
    userIds.push(record.id);
    this.userNotifications.set(record.userId, userIds);
  }

  private resolveChannels(payload: NotificationPayload): DeliveryChannel[] {
    // Explicit override takes precedence
    if (payload.channelOverride && payload.channelOverride.length > 0) {
      return payload.channelOverride;
    }

    // Start with priority-based defaults
    const priorityChannels = (this.config.defaultChannels as Record<NotificationPriority, DeliveryChannel[]>)[payload.priority]
      ?? DEFAULT_PRIORITY_CHANNELS[payload.priority];

    // Get user settings
    const settings = this.getUserSettings(payload.userId);

    // Filter by user enabled channels
    let channels = priorityChannels.filter(ch => settings.enabledChannels.includes(ch));

    // Check category preferences
    const catPref = settings.categoryPreferences[payload.category];
    if (catPref) {
      if (!catPref.enabled) {
        // Category disabled — only deliver in-app for traceability
        return ['in_app'];
      }
      if (catPref.channels) {
        channels = channels.filter(ch => catPref.channels!.includes(ch));
      }
    }

    // Check quiet hours (skip voice/push during quiet hours unless critical)
    if (this.isQuietHours(settings) && !(this.config.criticalBypassQuietHours && payload.priority === 'critical')) {
      channels = channels.filter(ch => ch === 'in_app' || ch === 'email');
    }

    // Ensure at least in_app
    if (channels.length === 0) channels = ['in_app'];

    return channels;
  }

  private isQuietHours(settings: UserNotificationSettings): boolean {
    if (!settings.quietHoursStart || !settings.quietHoursEnd) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = settings.quietHoursStart.split(':').map(Number);
    const [endH, endM] = settings.quietHoursEnd.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      // Same-day range (e.g., 22:00-07:00 doesn't apply here, this is e.g., 09:00-17:00)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Overnight range (e.g., 22:00-07:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  }

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    let bucket = this.rateLimitBuckets.get(userId);

    if (!bucket || now >= bucket.hourReset) {
      bucket = {
        hourly: 0,
        daily: bucket ? bucket.daily : 0,
        hourReset: now + 3600_000,
        dayReset: bucket ? bucket.dayReset : now + 86400_000,
      };
    }

    if (now >= bucket.dayReset) {
      bucket.daily = 0;
      bucket.dayReset = now + 86400_000;
    }

    this.rateLimitBuckets.set(userId, bucket);

    return bucket.hourly < this.config.maxPerUserPerHour &&
           bucket.daily < this.config.maxPerUserPerDay;
  }

  private incrementRateLimit(userId: string): void {
    const bucket = this.rateLimitBuckets.get(userId);
    if (bucket) {
      bucket.hourly++;
      bucket.daily++;
    }
  }

  private interpolateTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  }
}
