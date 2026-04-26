/**
 * Billing Engine — Stripe-powered subscription management
 *
 * Handles the full billing lifecycle for the Ray-Bans × OpenClaw platform:
 * - Customer creation and management
 * - Subscription lifecycle (create, upgrade, downgrade, cancel, reactivate)
 * - Usage-based billing for pay-per-count tiers
 * - Webhook processing for Stripe events
 * - Plan entitlements and feature gating
 * - Invoice and payment history
 * - Trial management
 * - Proration for mid-cycle plan changes
 *
 * @module billing/billing-engine
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export type PlanId =
  | 'free'
  | 'solo_store'
  | 'multi_store'
  | 'enterprise'
  | 'pay_per_count';

export type BillingInterval = 'monthly' | 'yearly';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

export type WebhookEventType =
  | 'checkout.session.completed'
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'customer.subscription.trial_will_end'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'invoice.finalized'
  | 'payment_intent.succeeded'
  | 'payment_intent.payment_failed'
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  description: string;
  prices: {
    monthly: number; // in cents
    yearly: number;  // in cents (annual total)
  };
  /** Stripe price IDs (set during configuration) */
  stripePriceIds?: {
    monthly?: string;
    yearly?: string;
  };
  /** Feature entitlements */
  entitlements: PlanEntitlements;
  /** Trial period in days (0 = no trial) */
  trialDays: number;
  /** Is this plan available for new signups? */
  available: boolean;
  /** Sort order for display */
  sortOrder: number;
}

export interface PlanEntitlements {
  /** Maximum number of store locations */
  maxStores: number;
  /** Maximum SKUs tracked */
  maxSkus: number;
  /** Maximum inventory sessions per month */
  maxSessionsPerMonth: number;
  /** Can export to CSV/Excel */
  exportCsv: boolean;
  /** Can export to integrations (QuickBooks, Xero, etc.) */
  exportIntegrations: boolean;
  /** POS integration (Square, Shopify, Clover) */
  posIntegration: boolean;
  /** Shrinkage analytics */
  shrinkageAnalytics: boolean;
  /** API access */
  apiAccess: boolean;
  /** Custom reporting */
  customReporting: boolean;
  /** Priority/dedicated support */
  prioritySupport: boolean;
  /** Number of team members */
  maxTeamMembers: number;
  /** Real-time dashboard */
  realtimeDashboard: boolean;
  /** Historical comparison */
  historicalComparison: boolean;
  /** Agent features enabled */
  agentFeatures: string[];
  /** Usage-based: price per item counted (in cents, 0 = unlimited) */
  perItemCostCents: number;
  /** Usage-based: minimum charge per session (in cents) */
  minSessionChargeCents: number;
}

export interface Customer {
  id: string;
  email: string;
  name?: string;
  companyName?: string;
  stripeCustomerId?: string;
  planId: PlanId;
  subscriptionStatus: SubscriptionStatus;
  stripeSubscriptionId?: string;
  billingInterval?: BillingInterval;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  trialEndsAt?: string;
  cancelAt?: string;
  canceledAt?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, string>;
}

export interface UsageRecord {
  id: string;
  customerId: string;
  sessionId: string;
  itemsCounted: number;
  timestamp: string;
  reported: boolean;
  stripeUsageRecordId?: string;
}

export interface Invoice {
  id: string;
  customerId: string;
  stripeInvoiceId?: string;
  amount: number; // in cents
  currency: string;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  paidAt?: string;
  items: InvoiceLineItem[];
  createdAt: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: number; // in cents
  amount: number; // in cents
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_account' | 'other';
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
}

export interface CheckoutSession {
  url: string;
  sessionId: string;
  expiresAt: string;
}

export interface PortalSession {
  url: string;
}

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  data: Record<string, unknown>;
  createdAt: string;
  processed: boolean;
  processedAt?: string;
  error?: string;
}

export interface BillingEngineConfig {
  /** Stripe secret key */
  stripeSecretKey?: string;
  /** Stripe webhook signing secret */
  webhookSecret?: string;
  /** Base URL for success/cancel redirects */
  baseUrl: string;
  /** Enable test/sandbox mode */
  testMode: boolean;
  /** Default trial period for new subscriptions */
  defaultTrialDays: number;
  /** Allow plan downgrades */
  allowDowngrades: boolean;
  /** Proration behavior: 'create_prorations' | 'none' | 'always_invoice' */
  prorationBehavior: 'create_prorations' | 'none' | 'always_invoice';
  /** Grace period for past_due before cancellation (days) */
  pastDueGraceDays: number;
  /** Auto-cancel after grace period */
  autoCancelPastDue: boolean;
  /** Webhook event retention (days) */
  webhookRetentionDays: number;
  /** Maximum stored webhook events */
  maxWebhookEvents: number;
}

export interface BillingEngineEvents {
  'customer:created': (customer: Customer) => void;
  'customer:updated': (customer: Customer) => void;
  'customer:deleted': (customerId: string) => void;
  'subscription:created': (customer: Customer) => void;
  'subscription:updated': (customer: Customer, previousPlan: PlanId) => void;
  'subscription:canceled': (customer: Customer) => void;
  'subscription:reactivated': (customer: Customer) => void;
  'subscription:trial_ending': (customer: Customer, daysLeft: number) => void;
  'subscription:past_due': (customer: Customer) => void;
  'invoice:paid': (invoice: Invoice) => void;
  'invoice:failed': (invoice: Invoice) => void;
  'usage:recorded': (record: UsageRecord) => void;
  'usage:limit_approaching': (customer: Customer, usagePercent: number) => void;
  'webhook:received': (event: WebhookEvent) => void;
  'webhook:processed': (event: WebhookEvent) => void;
  'webhook:error': (event: WebhookEvent, error: Error) => void;
  'entitlement:exceeded': (customer: Customer, entitlement: string, current: number, limit: number) => void;
}

export interface BillingStats {
  totalCustomers: number;
  activeSubscriptions: number;
  trialingCustomers: number;
  pastDueCustomers: number;
  canceledCustomers: number;
  mrr: number; // monthly recurring revenue in cents
  planDistribution: Record<PlanId, number>;
  totalRevenue: number; // all-time in cents
  totalUsageRecords: number;
  webhookEventsProcessed: number;
}

// ─── Default Config ─────────────────────────────────────────────

export const DEFAULT_BILLING_CONFIG: BillingEngineConfig = {
  baseUrl: 'http://localhost:3847',
  testMode: true,
  defaultTrialDays: 14,
  allowDowngrades: true,
  prorationBehavior: 'create_prorations',
  pastDueGraceDays: 7,
  autoCancelPastDue: true,
  webhookRetentionDays: 30,
  maxWebhookEvents: 10000,
};

// ─── Plan Definitions ───────────────────────────────────────────

export const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Try Inventory Vision with basic features',
    prices: { monthly: 0, yearly: 0 },
    entitlements: {
      maxStores: 1,
      maxSkus: 100,
      maxSessionsPerMonth: 2,
      exportCsv: true,
      exportIntegrations: false,
      posIntegration: false,
      shrinkageAnalytics: false,
      apiAccess: false,
      customReporting: false,
      prioritySupport: false,
      maxTeamMembers: 1,
      realtimeDashboard: true,
      historicalComparison: false,
      agentFeatures: ['inventory', 'memory'],
      perItemCostCents: 0,
      minSessionChargeCents: 0,
    },
    trialDays: 0,
    available: true,
    sortOrder: 0,
  },
  solo_store: {
    id: 'solo_store',
    name: 'Solo Store',
    description: 'Everything you need for a single retail location',
    prices: { monthly: 7900, yearly: 79000 }, // $79/mo, $790/yr (save ~$158)
    entitlements: {
      maxStores: 1,
      maxSkus: 5000,
      maxSessionsPerMonth: -1, // unlimited
      exportCsv: true,
      exportIntegrations: false,
      posIntegration: false,
      shrinkageAnalytics: false,
      apiAccess: false,
      customReporting: false,
      prioritySupport: false,
      maxTeamMembers: 3,
      realtimeDashboard: true,
      historicalComparison: true,
      agentFeatures: ['inventory', 'memory', 'context', 'security'],
      perItemCostCents: 0,
      minSessionChargeCents: 0,
    },
    trialDays: 14,
    available: true,
    sortOrder: 1,
  },
  multi_store: {
    id: 'multi_store',
    name: 'Multi-Store',
    description: 'Manage inventory across multiple locations',
    prices: { monthly: 19900, yearly: 199000 }, // $199/mo, $1990/yr
    entitlements: {
      maxStores: 5,
      maxSkus: 25000,
      maxSessionsPerMonth: -1,
      exportCsv: true,
      exportIntegrations: true,
      posIntegration: true,
      shrinkageAnalytics: true,
      apiAccess: false,
      customReporting: false,
      prioritySupport: true,
      maxTeamMembers: 10,
      realtimeDashboard: true,
      historicalComparison: true,
      agentFeatures: ['inventory', 'memory', 'context', 'security', 'deals', 'inspection'],
      perItemCostCents: 0,
      minSessionChargeCents: 0,
    },
    trialDays: 14,
    available: true,
    sortOrder: 2,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited stores, custom integrations, dedicated support',
    prices: { monthly: 49900, yearly: 499000 }, // $499/mo, $4990/yr
    entitlements: {
      maxStores: -1, // unlimited
      maxSkus: -1,
      maxSessionsPerMonth: -1,
      exportCsv: true,
      exportIntegrations: true,
      posIntegration: true,
      shrinkageAnalytics: true,
      apiAccess: true,
      customReporting: true,
      prioritySupport: true,
      maxTeamMembers: -1,
      realtimeDashboard: true,
      historicalComparison: true,
      agentFeatures: [
        'inventory', 'memory', 'context', 'security', 'deals',
        'inspection', 'networking', 'meeting', 'translation', 'debug',
      ],
      perItemCostCents: 0,
      minSessionChargeCents: 0,
    },
    trialDays: 30,
    available: true,
    sortOrder: 3,
  },
  pay_per_count: {
    id: 'pay_per_count',
    name: 'Pay Per Count',
    description: 'Only pay when you count — perfect for seasonal inventory',
    prices: { monthly: 0, yearly: 0 }, // usage-based
    entitlements: {
      maxStores: -1,
      maxSkus: -1,
      maxSessionsPerMonth: -1,
      exportCsv: true,
      exportIntegrations: false,
      posIntegration: false,
      shrinkageAnalytics: false,
      apiAccess: false,
      customReporting: false,
      prioritySupport: false,
      maxTeamMembers: 1,
      realtimeDashboard: true,
      historicalComparison: false,
      agentFeatures: ['inventory', 'memory'],
      perItemCostCents: 2, // $0.02 per item
      minSessionChargeCents: 20000, // $200 minimum per session
    },
    trialDays: 0,
    available: true,
    sortOrder: 4,
  },
};

// ─── Billing Engine ─────────────────────────────────────────────

export class BillingEngine extends EventEmitter {
  private config: BillingEngineConfig;
  private customers: Map<string, Customer> = new Map();
  private customersByEmail: Map<string, string> = new Map(); // email → id
  private customersByStripeId: Map<string, string> = new Map(); // stripeCustomerId → id
  private usageRecords: UsageRecord[] = [];
  private invoices: Invoice[] = [];
  private webhookEvents: WebhookEvent[] = [];
  private idCounter = 0;

  constructor(config: Partial<BillingEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_BILLING_CONFIG, ...config };
  }

  // ─── Plan Management ────────────────────────────────────────

  /** Get all available plans */
  getPlans(): PlanDefinition[] {
    return Object.values(PLAN_DEFINITIONS)
      .filter(p => p.available)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /** Get a specific plan definition */
  getPlan(planId: PlanId): PlanDefinition | undefined {
    return PLAN_DEFINITIONS[planId];
  }

  /** Get entitlements for a plan */
  getEntitlements(planId: PlanId): PlanEntitlements | undefined {
    return PLAN_DEFINITIONS[planId]?.entitlements;
  }

  /** Compare two plans (for upgrade/downgrade display) */
  comparePlans(fromPlan: PlanId, toPlan: PlanId): PlanComparison {
    const from = PLAN_DEFINITIONS[fromPlan];
    const to = PLAN_DEFINITIONS[toPlan];
    if (!from || !to) {
      throw new Error(`Unknown plan: ${fromPlan} or ${toPlan}`);
    }

    const isUpgrade = to.sortOrder > from.sortOrder;
    const isDowngrade = to.sortOrder < from.sortOrder;
    const priceDiffMonthly = to.prices.monthly - from.prices.monthly;

    const gains: string[] = [];
    const losses: string[] = [];

    const ef = from.entitlements;
    const et = to.entitlements;

    if (et.maxStores > ef.maxStores || (et.maxStores === -1 && ef.maxStores !== -1)) {
      gains.push(`Stores: ${ef.maxStores === -1 ? '∞' : ef.maxStores} → ${et.maxStores === -1 ? '∞' : et.maxStores}`);
    } else if (ef.maxStores > et.maxStores && et.maxStores !== -1) {
      losses.push(`Stores: ${ef.maxStores === -1 ? '∞' : ef.maxStores} → ${et.maxStores}`);
    }

    if (et.maxSkus > ef.maxSkus || (et.maxSkus === -1 && ef.maxSkus !== -1)) {
      gains.push(`SKUs: ${ef.maxSkus === -1 ? '∞' : ef.maxSkus} → ${et.maxSkus === -1 ? '∞' : et.maxSkus}`);
    } else if (ef.maxSkus > et.maxSkus && et.maxSkus !== -1) {
      losses.push(`SKUs: ${ef.maxSkus === -1 ? '∞' : ef.maxSkus} → ${et.maxSkus}`);
    }

    if (!ef.posIntegration && et.posIntegration) gains.push('POS Integration');
    if (ef.posIntegration && !et.posIntegration) losses.push('POS Integration');
    if (!ef.shrinkageAnalytics && et.shrinkageAnalytics) gains.push('Shrinkage Analytics');
    if (ef.shrinkageAnalytics && !et.shrinkageAnalytics) losses.push('Shrinkage Analytics');
    if (!ef.apiAccess && et.apiAccess) gains.push('API Access');
    if (ef.apiAccess && !et.apiAccess) losses.push('API Access');
    if (!ef.customReporting && et.customReporting) gains.push('Custom Reporting');
    if (ef.customReporting && !et.customReporting) losses.push('Custom Reporting');
    if (!ef.prioritySupport && et.prioritySupport) gains.push('Priority Support');
    if (ef.prioritySupport && !et.prioritySupport) losses.push('Priority Support');
    if (!ef.exportIntegrations && et.exportIntegrations) gains.push('Integration Exports');
    if (ef.exportIntegrations && !et.exportIntegrations) losses.push('Integration Exports');

    const newFeatures = et.agentFeatures.filter(f => !ef.agentFeatures.includes(f));
    const lostFeatures = ef.agentFeatures.filter(f => !et.agentFeatures.includes(f));
    if (newFeatures.length > 0) gains.push(`New agents: ${newFeatures.join(', ')}`);
    if (lostFeatures.length > 0) losses.push(`Lost agents: ${lostFeatures.join(', ')}`);

    return { isUpgrade, isDowngrade, isSame: !isUpgrade && !isDowngrade, priceDiffMonthly, gains, losses };
  }

  // ─── Customer Management ────────────────────────────────────

  /** Create a new customer */
  createCustomer(params: {
    email: string;
    name?: string;
    companyName?: string;
    planId?: PlanId;
    stripeCustomerId?: string;
    metadata?: Record<string, string>;
  }): Customer {
    if (this.customersByEmail.has(params.email)) {
      throw new Error(`Customer with email ${params.email} already exists`);
    }

    const id = `cust_${++this.idCounter}_${Date.now()}`;
    const plan = params.planId || 'free';
    const planDef = PLAN_DEFINITIONS[plan];
    if (!planDef) throw new Error(`Unknown plan: ${plan}`);

    const now = new Date().toISOString();
    const customer: Customer = {
      id,
      email: params.email,
      name: params.name,
      companyName: params.companyName,
      stripeCustomerId: params.stripeCustomerId,
      planId: plan,
      subscriptionStatus: plan === 'free' ? 'active' : 'incomplete',
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata || {},
    };

    this.customers.set(id, customer);
    this.customersByEmail.set(params.email, id);
    if (params.stripeCustomerId) {
      this.customersByStripeId.set(params.stripeCustomerId, id);
    }

    this.emit('customer:created', customer);
    return customer;
  }

  /** Get a customer by ID */
  getCustomer(customerId: string): Customer | undefined {
    return this.customers.get(customerId);
  }

  /** Get a customer by email */
  getCustomerByEmail(email: string): Customer | undefined {
    const id = this.customersByEmail.get(email);
    return id ? this.customers.get(id) : undefined;
  }

  /** Get a customer by Stripe customer ID */
  getCustomerByStripeId(stripeCustomerId: string): Customer | undefined {
    const id = this.customersByStripeId.get(stripeCustomerId);
    return id ? this.customers.get(id) : undefined;
  }

  /** Update customer details */
  updateCustomer(customerId: string, updates: Partial<Pick<Customer, 'name' | 'companyName' | 'metadata'>>): Customer {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer not found: ${customerId}`);

    if (updates.name !== undefined) customer.name = updates.name;
    if (updates.companyName !== undefined) customer.companyName = updates.companyName;
    if (updates.metadata) customer.metadata = { ...customer.metadata, ...updates.metadata };
    customer.updatedAt = new Date().toISOString();

    this.emit('customer:updated', customer);
    return customer;
  }

  /** Delete a customer */
  deleteCustomer(customerId: string): boolean {
    const customer = this.customers.get(customerId);
    if (!customer) return false;

    this.customers.delete(customerId);
    this.customersByEmail.delete(customer.email);
    if (customer.stripeCustomerId) {
      this.customersByStripeId.delete(customer.stripeCustomerId);
    }

    this.emit('customer:deleted', customerId);
    return true;
  }

  /** List all customers with optional filters */
  listCustomers(filters?: {
    planId?: PlanId;
    status?: SubscriptionStatus;
    search?: string;
    limit?: number;
    offset?: number;
  }): { customers: Customer[]; total: number } {
    let results = Array.from(this.customers.values());

    if (filters?.planId) {
      results = results.filter(c => c.planId === filters.planId);
    }
    if (filters?.status) {
      results = results.filter(c => c.subscriptionStatus === filters.status);
    }
    if (filters?.search) {
      const s = filters.search.toLowerCase();
      results = results.filter(c =>
        c.email.toLowerCase().includes(s) ||
        (c.name && c.name.toLowerCase().includes(s)) ||
        (c.companyName && c.companyName.toLowerCase().includes(s))
      );
    }

    const total = results.length;
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 50;
    results = results.slice(offset, offset + limit);

    return { customers: results, total };
  }

  // ─── Subscription Lifecycle ─────────────────────────────────

  /** Start a subscription (called after Stripe checkout or directly for free plans) */
  startSubscription(customerId: string, params: {
    planId: PlanId;
    billingInterval?: BillingInterval;
    stripeSubscriptionId?: string;
    trialDays?: number;
  }): Customer {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer not found: ${customerId}`);

    const plan = PLAN_DEFINITIONS[params.planId];
    if (!plan) throw new Error(`Unknown plan: ${params.planId}`);

    const previousPlan = customer.planId;
    const now = new Date();
    const trialDays = params.trialDays ?? plan.trialDays;

    customer.planId = params.planId;
    customer.billingInterval = params.billingInterval || 'monthly';
    customer.stripeSubscriptionId = params.stripeSubscriptionId;
    customer.currentPeriodStart = now.toISOString();
    customer.updatedAt = now.toISOString();

    if (trialDays > 0) {
      customer.subscriptionStatus = 'trialing';
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + trialDays);
      customer.trialEndsAt = trialEnd.toISOString();
      customer.currentPeriodEnd = trialEnd.toISOString();
    } else {
      customer.subscriptionStatus = 'active';
      const periodEnd = new Date(now);
      if (customer.billingInterval === 'yearly') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }
      customer.currentPeriodEnd = periodEnd.toISOString();
    }

    customer.cancelAt = undefined;
    customer.canceledAt = undefined;

    if (previousPlan !== params.planId) {
      this.emit('subscription:updated', customer, previousPlan);
    }
    this.emit('subscription:created', customer);
    return customer;
  }

  /** Change plan (upgrade or downgrade) */
  changePlan(customerId: string, newPlanId: PlanId, billingInterval?: BillingInterval): Customer {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer not found: ${customerId}`);

    const newPlan = PLAN_DEFINITIONS[newPlanId];
    if (!newPlan) throw new Error(`Unknown plan: ${newPlanId}`);

    const comparison = this.comparePlans(customer.planId, newPlanId);
    if (comparison.isDowngrade && !this.config.allowDowngrades) {
      throw new Error('Plan downgrades are not allowed');
    }

    const previousPlan = customer.planId;
    customer.planId = newPlanId;
    if (billingInterval) {
      customer.billingInterval = billingInterval;
    }
    customer.updatedAt = new Date().toISOString();

    this.emit('subscription:updated', customer, previousPlan);
    return customer;
  }

  /** Cancel a subscription */
  cancelSubscription(customerId: string, params?: {
    atPeriodEnd?: boolean;
    reason?: string;
  }): Customer {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer not found: ${customerId}`);

    const now = new Date().toISOString();

    if (params?.atPeriodEnd && customer.currentPeriodEnd) {
      // Cancel at end of billing period
      customer.cancelAt = customer.currentPeriodEnd;
      customer.metadata._cancelReason = params?.reason || 'user_requested';
    } else {
      // Cancel immediately
      customer.subscriptionStatus = 'canceled';
      customer.canceledAt = now;
      customer.cancelAt = now;
      customer.metadata._cancelReason = params?.reason || 'user_requested';
    }

    customer.updatedAt = now;
    this.emit('subscription:canceled', customer);
    return customer;
  }

  /** Reactivate a canceled subscription (before period end) */
  reactivateSubscription(customerId: string): Customer {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer not found: ${customerId}`);

    if (customer.subscriptionStatus === 'canceled' && !customer.currentPeriodEnd) {
      throw new Error('Cannot reactivate — subscription has fully expired');
    }

    // If canceled at period end, just remove the cancellation
    if (customer.cancelAt && customer.subscriptionStatus !== 'canceled') {
      customer.cancelAt = undefined;
      delete customer.metadata._cancelReason;
      customer.updatedAt = new Date().toISOString();
      this.emit('subscription:reactivated', customer);
      return customer;
    }

    // If actually canceled, restart
    if (customer.subscriptionStatus === 'canceled') {
      customer.subscriptionStatus = 'active';
      customer.cancelAt = undefined;
      customer.canceledAt = undefined;
      delete customer.metadata._cancelReason;
      const now = new Date();
      customer.currentPeriodStart = now.toISOString();
      const end = new Date(now);
      if (customer.billingInterval === 'yearly') {
        end.setFullYear(end.getFullYear() + 1);
      } else {
        end.setMonth(end.getMonth() + 1);
      }
      customer.currentPeriodEnd = end.toISOString();
      customer.updatedAt = now.toISOString();
      this.emit('subscription:reactivated', customer);
      return customer;
    }

    return customer;
  }

  /** Pause a subscription */
  pauseSubscription(customerId: string): Customer {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer not found: ${customerId}`);

    if (customer.subscriptionStatus !== 'active' && customer.subscriptionStatus !== 'trialing') {
      throw new Error(`Cannot pause subscription in status: ${customer.subscriptionStatus}`);
    }

    customer.subscriptionStatus = 'paused';
    customer.updatedAt = new Date().toISOString();
    this.emit('subscription:updated', customer, customer.planId);
    return customer;
  }

  /** Resume a paused subscription */
  resumeSubscription(customerId: string): Customer {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer not found: ${customerId}`);

    if (customer.subscriptionStatus !== 'paused') {
      throw new Error(`Cannot resume — subscription is not paused (status: ${customer.subscriptionStatus})`);
    }

    customer.subscriptionStatus = 'active';
    customer.updatedAt = new Date().toISOString();
    this.emit('subscription:reactivated', customer);
    return customer;
  }

  // ─── Entitlement Checks ─────────────────────────────────────

  /** Check if a customer has access to a specific feature */
  hasEntitlement(customerId: string, feature: string): boolean {
    const customer = this.customers.get(customerId);
    if (!customer) return false;

    // Only active or trialing subscriptions have entitlements
    if (customer.subscriptionStatus !== 'active' && customer.subscriptionStatus !== 'trialing') {
      return false;
    }

    const entitlements = PLAN_DEFINITIONS[customer.planId]?.entitlements;
    if (!entitlements) return false;

    // Check boolean entitlements
    const boolKeys: (keyof PlanEntitlements)[] = [
      'exportCsv', 'exportIntegrations', 'posIntegration',
      'shrinkageAnalytics', 'apiAccess', 'customReporting',
      'prioritySupport', 'realtimeDashboard', 'historicalComparison',
    ];
    if (boolKeys.includes(feature as keyof PlanEntitlements)) {
      return entitlements[feature as keyof PlanEntitlements] === true;
    }

    // Check agent features
    if (feature.startsWith('agent:')) {
      const agentName = feature.slice(6);
      return entitlements.agentFeatures.includes(agentName);
    }

    return false;
  }

  /** Check if a customer is within their store limit */
  canAddStore(customerId: string, currentStoreCount: number): boolean {
    const customer = this.customers.get(customerId);
    if (!customer) return false;

    const entitlements = PLAN_DEFINITIONS[customer.planId]?.entitlements;
    if (!entitlements) return false;
    if (entitlements.maxStores === -1) return true; // unlimited
    return currentStoreCount < entitlements.maxStores;
  }

  /** Check if a customer is within their SKU limit */
  canAddSku(customerId: string, currentSkuCount: number): boolean {
    const customer = this.customers.get(customerId);
    if (!customer) return false;

    const entitlements = PLAN_DEFINITIONS[customer.planId]?.entitlements;
    if (!entitlements) return false;
    if (entitlements.maxSkus === -1) return true;
    return currentSkuCount < entitlements.maxSkus;
  }

  /** Check if a customer can start a new session this month */
  canStartSession(customerId: string, sessionsThisMonth: number): boolean {
    const customer = this.customers.get(customerId);
    if (!customer) return false;

    if (customer.subscriptionStatus !== 'active' && customer.subscriptionStatus !== 'trialing') {
      return false;
    }

    const entitlements = PLAN_DEFINITIONS[customer.planId]?.entitlements;
    if (!entitlements) return false;
    if (entitlements.maxSessionsPerMonth === -1) return true;
    return sessionsThisMonth < entitlements.maxSessionsPerMonth;
  }

  /** Check a numeric entitlement and emit event if approaching limit */
  checkLimit(customerId: string, entitlement: string, current: number): {
    allowed: boolean;
    limit: number;
    remaining: number;
    percentUsed: number;
  } {
    const customer = this.customers.get(customerId);
    if (!customer) return { allowed: false, limit: 0, remaining: 0, percentUsed: 100 };

    const entitlements = PLAN_DEFINITIONS[customer.planId]?.entitlements;
    if (!entitlements) return { allowed: false, limit: 0, remaining: 0, percentUsed: 100 };

    const limitMap: Record<string, number> = {
      stores: entitlements.maxStores,
      skus: entitlements.maxSkus,
      sessions: entitlements.maxSessionsPerMonth,
      team_members: entitlements.maxTeamMembers,
    };

    const limit = limitMap[entitlement];
    if (limit === undefined) return { allowed: false, limit: 0, remaining: 0, percentUsed: 100 };
    if (limit === -1) return { allowed: true, limit: -1, remaining: Infinity, percentUsed: 0 };

    const allowed = current < limit;
    const remaining = Math.max(0, limit - current);
    const percentUsed = limit > 0 ? (current / limit) * 100 : 0;

    if (percentUsed >= 80 && percentUsed < 100) {
      this.emit('usage:limit_approaching', customer, percentUsed);
    }
    if (current >= limit) {
      this.emit('entitlement:exceeded', customer, entitlement, current, limit);
    }

    return { allowed, limit, remaining, percentUsed };
  }

  // ─── Usage Tracking ─────────────────────────────────────────

  /** Record usage for pay-per-count billing */
  recordUsage(customerId: string, sessionId: string, itemsCounted: number): UsageRecord {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer not found: ${customerId}`);

    const record: UsageRecord = {
      id: `usage_${++this.idCounter}_${Date.now()}`,
      customerId,
      sessionId,
      itemsCounted,
      timestamp: new Date().toISOString(),
      reported: false,
    };

    this.usageRecords.push(record);
    this.emit('usage:recorded', record);
    return record;
  }

  /** Get usage summary for a customer in a billing period */
  getUsageSummary(customerId: string, periodStart?: string, periodEnd?: string): {
    totalItems: number;
    totalSessions: number;
    estimatedCost: number;
    records: UsageRecord[];
  } {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer not found: ${customerId}`);

    let records = this.usageRecords.filter(r => r.customerId === customerId);

    if (periodStart) {
      records = records.filter(r => r.timestamp >= periodStart);
    }
    if (periodEnd) {
      records = records.filter(r => r.timestamp <= periodEnd);
    }

    const totalItems = records.reduce((sum, r) => sum + r.itemsCounted, 0);
    const totalSessions = records.length;
    const entitlements = PLAN_DEFINITIONS[customer.planId]?.entitlements;
    const perItemCost = entitlements?.perItemCostCents || 0;
    const minCharge = entitlements?.minSessionChargeCents || 0;

    let estimatedCost = totalItems * perItemCost;
    // Apply minimum per-session charges
    for (const record of records) {
      const sessionCost = record.itemsCounted * perItemCost;
      if (sessionCost < minCharge) {
        estimatedCost += (minCharge - sessionCost);
      }
    }

    return { totalItems, totalSessions, estimatedCost, records };
  }

  /** Mark usage records as reported to Stripe */
  markUsageReported(recordIds: string[]): void {
    for (const record of this.usageRecords) {
      if (recordIds.includes(record.id)) {
        record.reported = true;
      }
    }
  }

  // ─── Invoice Management ─────────────────────────────────────

  /** Create an invoice (usually triggered by webhook) */
  createInvoice(params: {
    customerId: string;
    amount: number;
    currency?: string;
    status?: InvoiceStatus;
    periodStart: string;
    periodEnd: string;
    stripeInvoiceId?: string;
    items?: InvoiceLineItem[];
  }): Invoice {
    const customer = this.customers.get(params.customerId);
    if (!customer) throw new Error(`Customer not found: ${params.customerId}`);

    const invoice: Invoice = {
      id: `inv_${++this.idCounter}_${Date.now()}`,
      customerId: params.customerId,
      stripeInvoiceId: params.stripeInvoiceId,
      amount: params.amount,
      currency: params.currency || 'usd',
      status: params.status || 'open',
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      items: params.items || [],
      createdAt: new Date().toISOString(),
    };

    this.invoices.push(invoice);
    return invoice;
  }

  /** Mark an invoice as paid */
  markInvoicePaid(invoiceId: string): Invoice {
    const invoice = this.invoices.find(i => i.id === invoiceId);
    if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);

    invoice.status = 'paid';
    invoice.paidAt = new Date().toISOString();

    this.emit('invoice:paid', invoice);
    return invoice;
  }

  /** Mark an invoice as failed */
  markInvoiceFailed(invoiceId: string): Invoice {
    const invoice = this.invoices.find(i => i.id === invoiceId);
    if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);

    invoice.status = 'uncollectible';
    this.emit('invoice:failed', invoice);
    return invoice;
  }

  /** Get invoices for a customer */
  getInvoices(customerId: string, limit = 10): Invoice[] {
    return this.invoices
      .filter(i => i.customerId === customerId)
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
      .slice(0, limit);
  }

  // ─── Checkout & Portal ──────────────────────────────────────

  /** Generate a checkout session URL (returns mock in test mode) */
  createCheckoutSession(customerId: string, planId: PlanId, interval: BillingInterval = 'monthly'): CheckoutSession {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer not found: ${customerId}`);

    const plan = PLAN_DEFINITIONS[planId];
    if (!plan) throw new Error(`Unknown plan: ${planId}`);

    if (plan.prices.monthly === 0 && plan.id !== 'pay_per_count') {
      // Free plan doesn't need checkout
      this.startSubscription(customerId, { planId, billingInterval: interval });
      return {
        url: `${this.config.baseUrl}/billing/success?plan=${planId}`,
        sessionId: `cs_free_${Date.now()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    }

    const sessionId = `cs_${this.config.testMode ? 'test' : 'live'}_${Date.now()}`;

    return {
      url: `${this.config.baseUrl}/checkout?session=${sessionId}&plan=${planId}&interval=${interval}`,
      sessionId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  /** Generate a customer portal URL */
  createPortalSession(customerId: string): PortalSession {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer not found: ${customerId}`);

    return {
      url: `${this.config.baseUrl}/portal?customer=${customerId}`,
    };
  }

  // ─── Webhook Processing ─────────────────────────────────────

  /** Process an incoming Stripe webhook event */
  processWebhook(eventType: WebhookEventType, data: Record<string, unknown>): WebhookEvent {
    const event: WebhookEvent = {
      id: `evt_${++this.idCounter}_${Date.now()}`,
      type: eventType,
      data,
      createdAt: new Date().toISOString(),
      processed: false,
    };

    this.webhookEvents.push(event);
    this.emit('webhook:received', event);

    try {
      this._handleWebhookEvent(event);
      event.processed = true;
      event.processedAt = new Date().toISOString();
      this.emit('webhook:processed', event);
    } catch (err) {
      event.error = err instanceof Error ? err.message : String(err);
      this.emit('webhook:error', event, err instanceof Error ? err : new Error(String(err)));
    }

    // Trim old webhook events
    this._trimWebhookEvents();

    return event;
  }

  private _handleWebhookEvent(event: WebhookEvent): void {
    const data = event.data;

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const stripeCustomerId = data.customer as string;
        const customer = this.getCustomerByStripeId(stripeCustomerId);
        if (!customer) break;

        const status = data.status as SubscriptionStatus;
        const previousStatus = customer.subscriptionStatus;
        customer.subscriptionStatus = status;
        customer.stripeSubscriptionId = data.id as string;
        customer.updatedAt = new Date().toISOString();

        if (data.current_period_start) {
          customer.currentPeriodStart = new Date((data.current_period_start as number) * 1000).toISOString();
        }
        if (data.current_period_end) {
          customer.currentPeriodEnd = new Date((data.current_period_end as number) * 1000).toISOString();
        }
        if (data.trial_end) {
          customer.trialEndsAt = new Date((data.trial_end as number) * 1000).toISOString();
        }
        if (data.cancel_at) {
          customer.cancelAt = new Date((data.cancel_at as number) * 1000).toISOString();
        }

        if (status === 'past_due' && previousStatus !== 'past_due') {
          this.emit('subscription:past_due', customer);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const stripeCustomerId = data.customer as string;
        const customer = this.getCustomerByStripeId(stripeCustomerId);
        if (!customer) break;

        customer.subscriptionStatus = 'canceled';
        customer.canceledAt = new Date().toISOString();
        customer.updatedAt = new Date().toISOString();
        this.emit('subscription:canceled', customer);
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const stripeCustomerId = data.customer as string;
        const customer = this.getCustomerByStripeId(stripeCustomerId);
        if (!customer) break;

        const trialEnd = data.trial_end as number;
        const daysLeft = Math.ceil((trialEnd * 1000 - Date.now()) / (24 * 60 * 60 * 1000));
        this.emit('subscription:trial_ending', customer, daysLeft);
        break;
      }

      case 'invoice.paid': {
        const stripeCustomerId = data.customer as string;
        const customer = this.getCustomerByStripeId(stripeCustomerId);
        if (!customer) break;

        const invoice = this.createInvoice({
          customerId: customer.id,
          amount: data.amount_paid as number || 0,
          status: 'paid',
          periodStart: data.period_start
            ? new Date((data.period_start as number) * 1000).toISOString()
            : new Date().toISOString(),
          periodEnd: data.period_end
            ? new Date((data.period_end as number) * 1000).toISOString()
            : new Date().toISOString(),
          stripeInvoiceId: data.id as string,
        });
        invoice.paidAt = new Date().toISOString();

        // Ensure subscription is active after successful payment
        if (customer.subscriptionStatus === 'past_due') {
          customer.subscriptionStatus = 'active';
          customer.updatedAt = new Date().toISOString();
        }
        break;
      }

      case 'invoice.payment_failed': {
        const stripeCustomerId = data.customer as string;
        const customer = this.getCustomerByStripeId(stripeCustomerId);
        if (!customer) break;

        customer.subscriptionStatus = 'past_due';
        customer.updatedAt = new Date().toISOString();
        this.emit('subscription:past_due', customer);
        break;
      }

      default:
        break;
    }
  }

  private _trimWebhookEvents(): void {
    if (this.webhookEvents.length > this.config.maxWebhookEvents) {
      const cutoff = Math.floor(this.config.maxWebhookEvents * 0.75);
      this.webhookEvents = this.webhookEvents.slice(-cutoff);
    }
  }

  // ─── Revenue Calculation ────────────────────────────────────

  /** Calculate MRR (Monthly Recurring Revenue) */
  calculateMRR(): number {
    let mrr = 0;
    for (const customer of this.customers.values()) {
      if (customer.subscriptionStatus !== 'active' && customer.subscriptionStatus !== 'trialing') {
        continue;
      }

      const plan = PLAN_DEFINITIONS[customer.planId];
      if (!plan) continue;

      if (customer.billingInterval === 'yearly') {
        mrr += Math.round(plan.prices.yearly / 12);
      } else {
        mrr += plan.prices.monthly;
      }
    }
    return mrr;
  }

  /** Calculate ARR (Annual Recurring Revenue) */
  calculateARR(): number {
    return this.calculateMRR() * 12;
  }

  /** Calculate total revenue from paid invoices */
  calculateTotalRevenue(): number {
    return this.invoices
      .filter(i => i.status === 'paid')
      .reduce((sum, i) => sum + i.amount, 0);
  }

  /** Calculate churn rate (canceled in last 30 days / total active at start) */
  calculateChurnRate(days = 30): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const canceledRecently = Array.from(this.customers.values()).filter(
      c => c.subscriptionStatus === 'canceled' && c.canceledAt && c.canceledAt >= cutoff
    ).length;

    const totalActive = Array.from(this.customers.values()).filter(
      c => c.subscriptionStatus === 'active' || c.subscriptionStatus === 'trialing'
    ).length;

    if (totalActive + canceledRecently === 0) return 0;
    return canceledRecently / (totalActive + canceledRecently);
  }

  /** Calculate ARPU (Average Revenue Per User) */
  calculateARPU(): number {
    const activeCustomers = Array.from(this.customers.values()).filter(
      c => c.subscriptionStatus === 'active' || c.subscriptionStatus === 'trialing'
    );
    if (activeCustomers.length === 0) return 0;
    return Math.round(this.calculateMRR() / activeCustomers.length);
  }

  // ─── Statistics ─────────────────────────────────────────────

  /** Get comprehensive billing statistics */
  getStats(): BillingStats {
    const customers = Array.from(this.customers.values());
    const planDist: Record<PlanId, number> = {
      free: 0, solo_store: 0, multi_store: 0, enterprise: 0, pay_per_count: 0,
    };

    let active = 0;
    let trialing = 0;
    let pastDue = 0;
    let canceled = 0;

    for (const c of customers) {
      planDist[c.planId]++;
      switch (c.subscriptionStatus) {
        case 'active': active++; break;
        case 'trialing': trialing++; break;
        case 'past_due': pastDue++; break;
        case 'canceled': canceled++; break;
      }
    }

    return {
      totalCustomers: customers.length,
      activeSubscriptions: active,
      trialingCustomers: trialing,
      pastDueCustomers: pastDue,
      canceledCustomers: canceled,
      mrr: this.calculateMRR(),
      planDistribution: planDist,
      totalRevenue: this.calculateTotalRevenue(),
      totalUsageRecords: this.usageRecords.length,
      webhookEventsProcessed: this.webhookEvents.filter(e => e.processed).length,
    };
  }

  /** Get pricing display data for frontend */
  getPricingDisplay(): PricingDisplayItem[] {
    return this.getPlans()
      .filter(p => p.id !== 'free' || p.prices.monthly === 0)
      .map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        monthlyPrice: p.prices.monthly / 100,
        yearlyPrice: p.prices.yearly / 100,
        yearlyMonthlyEquivalent: Math.round(p.prices.yearly / 12) / 100,
        yearlySavings: (p.prices.monthly * 12 - p.prices.yearly) / 100,
        trialDays: p.trialDays,
        highlights: this._getPlanHighlights(p),
        cta: this._getPlanCTA(p),
        popular: p.id === 'solo_store',
      }));
  }

  private _getPlanHighlights(plan: PlanDefinition): string[] {
    const h: string[] = [];
    const e = plan.entitlements;

    if (e.maxStores === -1) h.push('Unlimited stores');
    else h.push(`${e.maxStores} store${e.maxStores > 1 ? 's' : ''}`);

    if (e.maxSkus === -1) h.push('Unlimited SKUs');
    else h.push(`Up to ${e.maxSkus.toLocaleString()} SKUs`);

    if (e.maxSessionsPerMonth === -1) h.push('Unlimited inventory sessions');
    else h.push(`${e.maxSessionsPerMonth} sessions/month`);

    if (e.exportCsv) h.push('CSV/Excel export');
    if (e.posIntegration) h.push('POS integration');
    if (e.shrinkageAnalytics) h.push('Shrinkage analytics');
    if (e.apiAccess) h.push('API access');
    if (e.customReporting) h.push('Custom reporting');
    if (e.prioritySupport) h.push('Priority support');
    if (e.historicalComparison) h.push('Historical comparison');
    if (e.exportIntegrations) h.push('QuickBooks/Xero export');

    if (e.maxTeamMembers === -1) h.push('Unlimited team members');
    else if (e.maxTeamMembers > 1) h.push(`${e.maxTeamMembers} team members`);

    if (e.perItemCostCents > 0) {
      h.push(`$${(e.perItemCostCents / 100).toFixed(2)}/item counted`);
      h.push(`$${(e.minSessionChargeCents / 100).toFixed(0)} minimum per session`);
    }

    return h;
  }

  private _getPlanCTA(plan: PlanDefinition): string {
    if (plan.id === 'free') return 'Start Free';
    if (plan.id === 'pay_per_count') return 'Get Started';
    if (plan.trialDays > 0) return `Start ${plan.trialDays}-Day Trial`;
    return 'Subscribe';
  }

  /** Reset all data (for testing) */
  reset(): void {
    this.customers.clear();
    this.customersByEmail.clear();
    this.customersByStripeId.clear();
    this.usageRecords = [];
    this.invoices = [];
    this.webhookEvents = [];
    this.idCounter = 0;
  }
}

// ─── Additional Types ───────────────────────────────────────────

export interface PlanComparison {
  isUpgrade: boolean;
  isDowngrade: boolean;
  isSame: boolean;
  priceDiffMonthly: number; // in cents
  gains: string[];
  losses: string[];
}

export interface PricingDisplayItem {
  id: PlanId;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  yearlyMonthlyEquivalent: number;
  yearlySavings: number;
  trialDays: number;
  highlights: string[];
  cta: string;
  popular: boolean;
}
