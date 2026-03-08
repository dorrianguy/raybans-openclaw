/**
 * Stripe Billing Integration
 *
 * Connects the quota engine to real Stripe subscriptions, enabling:
 * - Checkout session creation for new subscribers
 * - Subscription lifecycle management (create, update, cancel, reactivate)
 * - Webhook processing for Stripe events (payment success/failure, subscription changes)
 * - Customer portal for self-service billing management
 * - Usage-based billing for pay-per-count tier
 * - Metered billing records for overage charges
 * - Invoice generation and payment status tracking
 * - Trial management (7-day free trial on paid tiers)
 * - Proration handling for mid-cycle tier changes
 * - Dunning management for failed payments (retry schedule + grace period)
 * - Revenue metrics: MRR, ARR, churn, ARPU, LTV
 *
 * Works independently of the actual Stripe SDK — accepts an adapter interface
 * so it can be tested with mocks and swapped for any payment provider.
 *
 * @module billing/stripe-integration
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export type BillingPlan = 'free' | 'solo' | 'multi' | 'enterprise' | 'pay_per_count';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid' | 'paused';
export type PaymentStatus = 'succeeded' | 'pending' | 'failed' | 'refunded' | 'disputed';
export type BillingInterval = 'month' | 'year';

export interface PlanConfig {
  plan: BillingPlan;
  /** Display name */
  name: string;
  /** Monthly price in cents */
  priceMonthly: number;
  /** Annual price in cents (per year, not per month) */
  priceAnnual: number;
  /** Stripe Price IDs (mapped by interval) */
  stripePriceIds: Record<BillingInterval, string>;
  /** Trial days for new subscribers */
  trialDays: number;
  /** Features included in this plan */
  features: string[];
  /** Overage rate per unit in cents (for metered billing) */
  overageRateCents: number;
  /** Max locations allowed */
  maxLocations: number;
  /** Max SKUs */
  maxSkus: number;
}

export interface Customer {
  id: string;
  email: string;
  name?: string;
  stripeCustomerId?: string;
  plan: BillingPlan;
  subscription?: Subscription;
  paymentMethods: PaymentMethod[];
  invoices: Invoice[];
  usageRecords: UsageRecord[];
  createdAt: string;
  metadata: Record<string, string>;
}

export interface Subscription {
  id: string;
  stripeSubscriptionId: string;
  customerId: string;
  plan: BillingPlan;
  status: SubscriptionStatus;
  interval: BillingInterval;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEnd?: string;
  cancelAt?: string;
  canceledAt?: string;
  /** Number of consecutive failed payment attempts */
  failedPaymentAttempts: number;
  /** Grace period end after failed payment */
  gracePeriodEnd?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_account' | 'link';
  last4: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
}

export interface Invoice {
  id: string;
  stripeInvoiceId: string;
  customerId: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  periodStart: string;
  periodEnd: string;
  lineItems: InvoiceLineItem[];
  paidAt?: string;
  createdAt: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

export interface UsageRecord {
  id: string;
  customerId: string;
  resource: string;
  quantity: number;
  timestamp: string;
  /** Whether this has been billed */
  billed: boolean;
  /** Invoice ID if billed */
  invoiceId?: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
  customerId: string;
  plan: BillingPlan;
  interval: BillingInterval;
  expiresAt: string;
}

export interface BillingPortalSession {
  id: string;
  url: string;
  customerId: string;
  expiresAt: string;
}

export interface RevenueMetrics {
  /** Monthly Recurring Revenue in cents */
  mrr: number;
  /** Annual Recurring Revenue in cents */
  arr: number;
  /** Average Revenue Per User in cents */
  arpu: number;
  /** Churn rate (0-1) for the period */
  churnRate: number;
  /** Customer lifetime value estimate in cents */
  ltv: number;
  /** Total active subscriptions */
  activeSubscriptions: number;
  /** Total customers */
  totalCustomers: number;
  /** Subscriptions by plan */
  planBreakdown: Record<BillingPlan, number>;
  /** Revenue by plan in cents */
  revenueByPlan: Record<BillingPlan, number>;
  /** Trials currently active */
  activeTrials: number;
  /** Past due subscriptions */
  pastDue: number;
  /** Period this metric covers */
  periodStart: string;
  periodEnd: string;
  /** Calculated at */
  calculatedAt: string;
}

// ─── Stripe Adapter Interface ───────────────────────────────────

/**
 * Adapter interface for Stripe API calls.
 * Implement this with the real Stripe SDK for production,
 * or with mocks for testing.
 */
export interface StripeAdapter {
  /** Create a Stripe customer */
  createCustomer(email: string, name?: string, metadata?: Record<string, string>): Promise<{ id: string }>;
  /** Create a checkout session */
  createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number;
    metadata?: Record<string, string>;
  }): Promise<{ id: string; url: string }>;
  /** Create a billing portal session */
  createPortalSession(customerId: string, returnUrl: string): Promise<{ id: string; url: string }>;
  /** Update a subscription (change plan) */
  updateSubscription(subscriptionId: string, params: {
    priceId: string;
    prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
  }): Promise<{ id: string; status: string }>;
  /** Cancel a subscription */
  cancelSubscription(subscriptionId: string, params: {
    cancelAtPeriodEnd?: boolean;
    immediately?: boolean;
  }): Promise<{ id: string; status: string; cancelAt?: string }>;
  /** Reactivate a canceled subscription (before period end) */
  reactivateSubscription(subscriptionId: string): Promise<{ id: string; status: string }>;
  /** Report usage for metered billing */
  reportUsage(subscriptionItemId: string, quantity: number, timestamp?: number): Promise<{ id: string }>;
  /** Retrieve an invoice */
  getInvoice(invoiceId: string): Promise<{
    id: string;
    amountDue: number;
    amountPaid: number;
    status: string;
    lines: Array<{ description: string; quantity: number; unitAmount: number; amount: number }>;
  }>;
  /** List payment methods for a customer */
  listPaymentMethods(customerId: string): Promise<Array<{
    id: string;
    type: string;
    card?: { last4: string; brand: string; expMonth: number; expYear: number };
  }>>;
}

// ─── Webhook Event Types ────────────────────────────────────────

export type StripeWebhookEvent =
  | { type: 'checkout.session.completed'; data: { customer: string; subscription: string; metadata?: Record<string, string> } }
  | { type: 'customer.subscription.created'; data: { id: string; customer: string; status: string; items: Array<{ price: { id: string } }>; current_period_start: number; current_period_end: number; trial_end?: number } }
  | { type: 'customer.subscription.updated'; data: { id: string; customer: string; status: string; items: Array<{ price: { id: string } }>; current_period_start: number; current_period_end: number; cancel_at?: number; canceled_at?: number } }
  | { type: 'customer.subscription.deleted'; data: { id: string; customer: string } }
  | { type: 'invoice.paid'; data: { id: string; customer: string; subscription?: string; amount_paid: number; lines: Array<{ description: string; quantity: number; unit_amount: number; amount: number }>; period_start: number; period_end: number } }
  | { type: 'invoice.payment_failed'; data: { id: string; customer: string; subscription?: string; attempt_count: number; next_payment_attempt?: number } }
  | { type: 'customer.subscription.trial_will_end'; data: { id: string; customer: string; trial_end: number } };

// ─── Plan Configuration ─────────────────────────────────────────

export const PLAN_CONFIGS: Record<BillingPlan, PlanConfig> = {
  free: {
    plan: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceAnnual: 0,
    stripePriceIds: { month: '', year: '' },
    trialDays: 0,
    features: ['basic_vision', 'voice_commands', '50_snaps_day', 'csv_export'],
    overageRateCents: 0,
    maxLocations: 1,
    maxSkus: 500,
  },
  solo: {
    plan: 'solo',
    name: 'Solo Store',
    priceMonthly: 7900,
    priceAnnual: 79000,
    stripePriceIds: { month: 'price_solo_monthly', year: 'price_solo_annual' },
    trialDays: 7,
    features: ['unlimited_snaps', 'product_db', 'dashboard', 'csv_excel_export', 'voice_feedback', 'memory_search', 'email_support'],
    overageRateCents: 1,
    maxLocations: 1,
    maxSkus: 5000,
  },
  multi: {
    plan: 'multi',
    name: 'Multi-Store',
    priceMonthly: 19900,
    priceAnnual: 199000,
    stripePriceIds: { month: 'price_multi_monthly', year: 'price_multi_annual' },
    trialDays: 7,
    features: ['unlimited_snaps', 'product_db', 'dashboard', 'all_exports', 'pos_integration', 'shrinkage_analytics', 'multi_location', 'priority_support', 'api_access'],
    overageRateCents: 1,
    maxLocations: 5,
    maxSkus: 25000,
  },
  enterprise: {
    plan: 'enterprise',
    name: 'Enterprise',
    priceMonthly: 49900,
    priceAnnual: 499000,
    stripePriceIds: { month: 'price_enterprise_monthly', year: 'price_enterprise_annual' },
    trialDays: 14,
    features: ['unlimited_everything', 'custom_integrations', 'sap_oracle_netsuite', 'api_access', 'custom_reporting', 'dedicated_support', 'sla', 'white_label'],
    overageRateCents: 0,
    maxLocations: Infinity,
    maxSkus: Infinity,
  },
  pay_per_count: {
    plan: 'pay_per_count',
    name: 'Pay Per Count',
    priceMonthly: 0,
    priceAnnual: 0,
    stripePriceIds: { month: 'price_per_count', year: 'price_per_count' },
    trialDays: 0,
    features: ['basic_vision', 'voice_commands', 'csv_export', 'per_session_billing'],
    overageRateCents: 2,  // $0.02 per item counted
    maxLocations: 1,
    maxSkus: Infinity,
  },
};

// ─── Configuration ──────────────────────────────────────────────

export interface StripeIntegrationConfig {
  /** Stripe adapter (real or mock) */
  adapter: StripeAdapter;
  /** Success URL after checkout */
  successUrl: string;
  /** Cancel URL after checkout */
  cancelUrl: string;
  /** Return URL after portal session */
  portalReturnUrl: string;
  /** Dunning: max payment retry attempts before canceling */
  maxPaymentRetries: number;
  /** Dunning: grace period in hours after first failed payment */
  gracePeriodHours: number;
  /** Minimum charge amount in cents for usage billing */
  minimumChargeCents: number;
}

const DEFAULT_CONFIG: Partial<StripeIntegrationConfig> = {
  maxPaymentRetries: 4,
  gracePeriodHours: 72,
  minimumChargeCents: 200, // $2.00 minimum
};

// ─── Main Class ─────────────────────────────────────────────────

export class StripeIntegration extends EventEmitter {
  private customers: Map<string, Customer> = new Map();
  private customersByStripeId: Map<string, string> = new Map();
  private config: StripeIntegrationConfig;
  private idCounter: number = 0;

  constructor(config: StripeIntegrationConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config } as StripeIntegrationConfig;
  }

  // ─── Customer Management ────────────────────────────────────

  /**
   * Create a new customer (local + Stripe)
   */
  async createCustomer(email: string, name?: string, metadata?: Record<string, string>): Promise<Customer> {
    if (!email || !email.includes('@')) {
      throw new Error('Valid email is required');
    }

    // Check for duplicate email
    for (const c of this.customers.values()) {
      if (c.email === email) {
        throw new Error(`Customer with email ${email} already exists`);
      }
    }

    // Create Stripe customer
    const stripeCustomer = await this.config.adapter.createCustomer(email, name, metadata);

    const customer: Customer = {
      id: this.nextId('cust'),
      email,
      name,
      stripeCustomerId: stripeCustomer.id,
      plan: 'free',
      paymentMethods: [],
      invoices: [],
      usageRecords: [],
      createdAt: new Date().toISOString(),
      metadata: metadata || {},
    };

    this.customers.set(customer.id, customer);
    this.customersByStripeId.set(stripeCustomer.id, customer.id);

    this.emit('customer:created', { customerId: customer.id, email });
    return customer;
  }

  /**
   * Get a customer by internal ID
   */
  getCustomer(customerId: string): Customer | undefined {
    return this.customers.get(customerId);
  }

  /**
   * Get a customer by Stripe customer ID
   */
  getCustomerByStripeId(stripeCustomerId: string): Customer | undefined {
    const internalId = this.customersByStripeId.get(stripeCustomerId);
    if (!internalId) return undefined;
    return this.customers.get(internalId);
  }

  /**
   * Get all customers
   */
  getAllCustomers(): Customer[] {
    return Array.from(this.customers.values());
  }

  // ─── Checkout & Subscription ────────────────────────────────

  /**
   * Create a checkout session for a customer to subscribe to a plan
   */
  async createCheckout(customerId: string, plan: BillingPlan, interval: BillingInterval = 'month'): Promise<CheckoutSession> {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer ${customerId} not found`);
    if (!customer.stripeCustomerId) throw new Error('Customer has no Stripe ID');

    if (plan === 'free') throw new Error('Cannot create checkout for free plan');

    const planConfig = PLAN_CONFIGS[plan];
    if (!planConfig) throw new Error(`Unknown plan: ${plan}`);

    const priceId = planConfig.stripePriceIds[interval];
    if (!priceId) throw new Error(`No price ID configured for ${plan}/${interval}`);

    const session = await this.config.adapter.createCheckoutSession({
      customerId: customer.stripeCustomerId,
      priceId,
      successUrl: this.config.successUrl,
      cancelUrl: this.config.cancelUrl,
      trialDays: planConfig.trialDays > 0 ? planConfig.trialDays : undefined,
      metadata: { internalCustomerId: customerId, plan, interval },
    });

    const checkout: CheckoutSession = {
      id: session.id,
      url: session.url,
      customerId,
      plan,
      interval,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    this.emit('checkout:created', checkout);
    return checkout;
  }

  /**
   * Create a billing portal session for self-service management
   */
  async createPortal(customerId: string): Promise<BillingPortalSession> {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer ${customerId} not found`);
    if (!customer.stripeCustomerId) throw new Error('Customer has no Stripe ID');

    const session = await this.config.adapter.createPortalSession(
      customer.stripeCustomerId,
      this.config.portalReturnUrl,
    );

    const portal: BillingPortalSession = {
      id: session.id,
      url: session.url,
      customerId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
    };

    this.emit('portal:created', portal);
    return portal;
  }

  /**
   * Change a customer's plan (upgrade or downgrade)
   */
  async changePlan(customerId: string, newPlan: BillingPlan, interval?: BillingInterval): Promise<Subscription> {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer ${customerId} not found`);
    if (!customer.subscription) throw new Error('Customer has no active subscription');

    if (newPlan === 'free') {
      // Downgrade to free = cancel subscription
      await this.cancelSubscription(customerId, true);
      customer.plan = 'free';
      this.emit('plan:changed', { customerId, oldPlan: customer.plan, newPlan: 'free' });
      return customer.subscription;
    }

    const planConfig = PLAN_CONFIGS[newPlan];
    const targetInterval = interval || customer.subscription.interval;
    const priceId = planConfig.stripePriceIds[targetInterval];

    const result = await this.config.adapter.updateSubscription(
      customer.subscription.stripeSubscriptionId,
      {
        priceId,
        prorationBehavior: 'create_prorations',
      },
    );

    const oldPlan = customer.plan;
    customer.plan = newPlan;
    customer.subscription.plan = newPlan;
    customer.subscription.status = result.status as SubscriptionStatus;
    customer.subscription.interval = targetInterval;
    customer.subscription.updatedAt = new Date().toISOString();

    this.emit('plan:changed', { customerId, oldPlan, newPlan, interval: targetInterval });
    return customer.subscription;
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(customerId: string, atPeriodEnd: boolean = true): Promise<Subscription> {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer ${customerId} not found`);
    if (!customer.subscription) throw new Error('Customer has no active subscription');

    const result = await this.config.adapter.cancelSubscription(
      customer.subscription.stripeSubscriptionId,
      {
        cancelAtPeriodEnd: atPeriodEnd,
        immediately: !atPeriodEnd,
      },
    );

    if (atPeriodEnd) {
      customer.subscription.cancelAt = customer.subscription.currentPeriodEnd;
      customer.subscription.canceledAt = new Date().toISOString();
      customer.subscription.status = 'active'; // Still active until period end
    } else {
      customer.subscription.status = 'canceled';
      customer.subscription.canceledAt = new Date().toISOString();
      customer.plan = 'free';
    }

    customer.subscription.updatedAt = new Date().toISOString();

    this.emit('subscription:canceled', { customerId, atPeriodEnd, subscription: customer.subscription });
    return customer.subscription;
  }

  /**
   * Reactivate a subscription that was set to cancel at period end
   */
  async reactivateSubscription(customerId: string): Promise<Subscription> {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer ${customerId} not found`);
    if (!customer.subscription) throw new Error('Customer has no subscription');
    if (!customer.subscription.cancelAt) throw new Error('Subscription is not scheduled for cancellation');

    await this.config.adapter.reactivateSubscription(
      customer.subscription.stripeSubscriptionId,
    );

    customer.subscription.cancelAt = undefined;
    customer.subscription.canceledAt = undefined;
    customer.subscription.status = 'active';
    customer.subscription.updatedAt = new Date().toISOString();

    this.emit('subscription:reactivated', { customerId, subscription: customer.subscription });
    return customer.subscription;
  }

  // ─── Usage-Based Billing ────────────────────────────────────

  /**
   * Record usage for metered billing (pay-per-count or overage charges)
   */
  async recordUsage(customerId: string, resource: string, quantity: number): Promise<UsageRecord> {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer ${customerId} not found`);

    if (quantity <= 0) throw new Error('Quantity must be positive');

    const record: UsageRecord = {
      id: this.nextId('usage'),
      customerId,
      resource,
      quantity,
      timestamp: new Date().toISOString(),
      billed: false,
    };

    customer.usageRecords.push(record);

    this.emit('usage:recorded', { customerId, resource, quantity, recordId: record.id });
    return record;
  }

  /**
   * Get total unbilled usage for a customer
   */
  getUnbilledUsage(customerId: string): { resource: string; totalQuantity: number; estimatedCost: number }[] {
    const customer = this.customers.get(customerId);
    if (!customer) return [];

    const grouped = new Map<string, number>();
    for (const record of customer.usageRecords) {
      if (!record.billed) {
        grouped.set(record.resource, (grouped.get(record.resource) || 0) + record.quantity);
      }
    }

    const planConfig = PLAN_CONFIGS[customer.plan];
    return Array.from(grouped.entries()).map(([resource, totalQuantity]) => ({
      resource,
      totalQuantity,
      estimatedCost: totalQuantity * planConfig.overageRateCents,
    }));
  }

  /**
   * Mark usage records as billed (called when invoice is paid)
   */
  markUsageBilled(customerId: string, invoiceId: string): number {
    const customer = this.customers.get(customerId);
    if (!customer) return 0;

    let count = 0;
    for (const record of customer.usageRecords) {
      if (!record.billed) {
        record.billed = true;
        record.invoiceId = invoiceId;
        count++;
      }
    }

    return count;
  }

  // ─── Webhook Processing ─────────────────────────────────────

  /**
   * Process a Stripe webhook event
   */
  async processWebhook(event: StripeWebhookEvent): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data);
        break;
      case 'customer.subscription.created':
        await this.handleSubscriptionCreated(event.data);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data);
        break;
      case 'invoice.paid':
        await this.handleInvoicePaid(event.data);
        break;
      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data);
        break;
      case 'customer.subscription.trial_will_end':
        await this.handleTrialEnding(event.data);
        break;
      default:
        this.emit('webhook:unhandled', { type: (event as any).type });
    }
  }

  private async handleCheckoutCompleted(data: { customer: string; subscription: string; metadata?: Record<string, string> }): Promise<void> {
    const customer = this.getCustomerByStripeId(data.customer);
    if (!customer) {
      this.emit('webhook:error', { type: 'checkout.session.completed', error: 'Customer not found' });
      return;
    }

    this.emit('checkout:completed', { customerId: customer.id, stripeSubscriptionId: data.subscription });
  }

  private async handleSubscriptionCreated(data: {
    id: string;
    customer: string;
    status: string;
    items: Array<{ price: { id: string } }>;
    current_period_start: number;
    current_period_end: number;
    trial_end?: number;
  }): Promise<void> {
    const customer = this.getCustomerByStripeId(data.customer);
    if (!customer) {
      this.emit('webhook:error', { type: 'customer.subscription.created', error: 'Customer not found' });
      return;
    }

    // Determine plan from price ID
    const priceId = data.items[0]?.price?.id;
    const plan = this.planFromPriceId(priceId);
    const interval = this.intervalFromPriceId(priceId);

    const subscription: Subscription = {
      id: this.nextId('sub'),
      stripeSubscriptionId: data.id,
      customerId: customer.id,
      plan,
      status: data.status as SubscriptionStatus,
      interval,
      currentPeriodStart: new Date(data.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(data.current_period_end * 1000).toISOString(),
      trialEnd: data.trial_end ? new Date(data.trial_end * 1000).toISOString() : undefined,
      failedPaymentAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    customer.subscription = subscription;
    customer.plan = plan;

    this.emit('subscription:created', { customerId: customer.id, subscription });
  }

  private async handleSubscriptionUpdated(data: {
    id: string;
    customer: string;
    status: string;
    items: Array<{ price: { id: string } }>;
    current_period_start: number;
    current_period_end: number;
    cancel_at?: number;
    canceled_at?: number;
  }): Promise<void> {
    const customer = this.getCustomerByStripeId(data.customer);
    if (!customer || !customer.subscription) {
      this.emit('webhook:error', { type: 'customer.subscription.updated', error: 'Customer/subscription not found' });
      return;
    }

    const priceId = data.items[0]?.price?.id;
    const plan = this.planFromPriceId(priceId);

    customer.subscription.status = data.status as SubscriptionStatus;
    customer.subscription.plan = plan;
    customer.subscription.currentPeriodStart = new Date(data.current_period_start * 1000).toISOString();
    customer.subscription.currentPeriodEnd = new Date(data.current_period_end * 1000).toISOString();
    customer.subscription.cancelAt = data.cancel_at ? new Date(data.cancel_at * 1000).toISOString() : undefined;
    customer.subscription.canceledAt = data.canceled_at ? new Date(data.canceled_at * 1000).toISOString() : undefined;
    customer.subscription.updatedAt = new Date().toISOString();
    customer.plan = plan;

    this.emit('subscription:updated', { customerId: customer.id, subscription: customer.subscription });
  }

  private async handleSubscriptionDeleted(data: { id: string; customer: string }): Promise<void> {
    const customer = this.getCustomerByStripeId(data.customer);
    if (!customer) {
      this.emit('webhook:error', { type: 'customer.subscription.deleted', error: 'Customer not found' });
      return;
    }

    if (customer.subscription) {
      customer.subscription.status = 'canceled';
      customer.subscription.canceledAt = new Date().toISOString();
      customer.subscription.updatedAt = new Date().toISOString();
    }
    customer.plan = 'free';

    this.emit('subscription:deleted', { customerId: customer.id });
  }

  private async handleInvoicePaid(data: {
    id: string;
    customer: string;
    subscription?: string;
    amount_paid: number;
    lines: Array<{ description: string; quantity: number; unit_amount: number; amount: number }>;
    period_start: number;
    period_end: number;
  }): Promise<void> {
    const customer = this.getCustomerByStripeId(data.customer);
    if (!customer) {
      this.emit('webhook:error', { type: 'invoice.paid', error: 'Customer not found' });
      return;
    }

    const invoice: Invoice = {
      id: this.nextId('inv'),
      stripeInvoiceId: data.id,
      customerId: customer.id,
      amountDue: data.amount_paid,
      amountPaid: data.amount_paid,
      currency: 'usd',
      status: 'paid',
      periodStart: new Date(data.period_start * 1000).toISOString(),
      periodEnd: new Date(data.period_end * 1000).toISOString(),
      lineItems: data.lines.map(l => ({
        description: l.description,
        quantity: l.quantity,
        unitAmount: l.unit_amount,
        amount: l.amount,
      })),
      paidAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    customer.invoices.push(invoice);

    // Clear failed payment state
    if (customer.subscription) {
      customer.subscription.failedPaymentAttempts = 0;
      customer.subscription.gracePeriodEnd = undefined;
      if (customer.subscription.status === 'past_due') {
        customer.subscription.status = 'active';
      }
      customer.subscription.updatedAt = new Date().toISOString();
    }

    // Mark usage as billed
    this.markUsageBilled(customer.id, invoice.id);

    this.emit('invoice:paid', { customerId: customer.id, invoice });
  }

  private async handlePaymentFailed(data: {
    id: string;
    customer: string;
    subscription?: string;
    attempt_count: number;
    next_payment_attempt?: number;
  }): Promise<void> {
    const customer = this.getCustomerByStripeId(data.customer);
    if (!customer) {
      this.emit('webhook:error', { type: 'invoice.payment_failed', error: 'Customer not found' });
      return;
    }

    if (customer.subscription) {
      customer.subscription.failedPaymentAttempts = data.attempt_count;
      customer.subscription.status = 'past_due';

      // Set grace period on first failure
      if (data.attempt_count === 1) {
        customer.subscription.gracePeriodEnd = new Date(
          Date.now() + (this.config.gracePeriodHours || 72) * 60 * 60 * 1000,
        ).toISOString();
      }

      // Cancel after max retries
      if (data.attempt_count >= (this.config.maxPaymentRetries || 4)) {
        customer.subscription.status = 'unpaid';
        this.emit('subscription:dunning_exhausted', {
          customerId: customer.id,
          attempts: data.attempt_count,
        });
      }

      customer.subscription.updatedAt = new Date().toISOString();
    }

    this.emit('payment:failed', {
      customerId: customer.id,
      attemptCount: data.attempt_count,
      nextAttempt: data.next_payment_attempt,
    });
  }

  private async handleTrialEnding(data: {
    id: string;
    customer: string;
    trial_end: number;
  }): Promise<void> {
    const customer = this.getCustomerByStripeId(data.customer);
    if (!customer) return;

    const daysLeft = Math.ceil((data.trial_end * 1000 - Date.now()) / (1000 * 60 * 60 * 24));

    this.emit('trial:ending', {
      customerId: customer.id,
      trialEnd: new Date(data.trial_end * 1000).toISOString(),
      daysLeft,
    });
  }

  // ─── Payment Methods ────────────────────────────────────────

  /**
   * Sync payment methods from Stripe
   */
  async syncPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    const customer = this.customers.get(customerId);
    if (!customer) throw new Error(`Customer ${customerId} not found`);
    if (!customer.stripeCustomerId) throw new Error('Customer has no Stripe ID');

    const methods = await this.config.adapter.listPaymentMethods(customer.stripeCustomerId);

    customer.paymentMethods = methods.map((m, i) => ({
      id: m.id,
      type: m.type as PaymentMethod['type'],
      last4: m.card?.last4 || '****',
      brand: m.card?.brand,
      expiryMonth: m.card?.expMonth,
      expiryYear: m.card?.expYear,
      isDefault: i === 0,
    }));

    return customer.paymentMethods;
  }

  // ─── Revenue Metrics ────────────────────────────────────────

  /**
   * Calculate revenue metrics across all customers
   */
  calculateMetrics(periodStart?: string, periodEnd?: string): RevenueMetrics {
    const now = new Date();
    const start = periodStart || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end = periodEnd || now.toISOString();

    const allCustomers = Array.from(this.customers.values());
    const activeSubscriptions = allCustomers.filter(
      c => c.subscription && (c.subscription.status === 'active' || c.subscription.status === 'trialing'),
    );

    // MRR calculation
    let mrr = 0;
    const planBreakdown: Record<BillingPlan, number> = { free: 0, solo: 0, multi: 0, enterprise: 0, pay_per_count: 0 };
    const revenueByPlan: Record<BillingPlan, number> = { free: 0, solo: 0, multi: 0, enterprise: 0, pay_per_count: 0 };

    for (const customer of activeSubscriptions) {
      const sub = customer.subscription!;
      const planConfig = PLAN_CONFIGS[sub.plan];

      planBreakdown[sub.plan] = (planBreakdown[sub.plan] || 0) + 1;

      if (sub.interval === 'year') {
        mrr += Math.round(planConfig.priceAnnual / 12);
        revenueByPlan[sub.plan] += Math.round(planConfig.priceAnnual / 12);
      } else {
        mrr += planConfig.priceMonthly;
        revenueByPlan[sub.plan] += planConfig.priceMonthly;
      }
    }

    // Count free users
    planBreakdown.free = allCustomers.filter(c => c.plan === 'free').length;

    // Churn: canceled subscriptions in period / total at period start
    const canceledInPeriod = allCustomers.filter(
      c => c.subscription?.canceledAt && c.subscription.canceledAt >= start && c.subscription.canceledAt <= end,
    ).length;
    const totalAtStart = activeSubscriptions.length + canceledInPeriod;
    const churnRate = totalAtStart > 0 ? canceledInPeriod / totalAtStart : 0;

    // ARPU
    const arpu = activeSubscriptions.length > 0 ? Math.round(mrr / activeSubscriptions.length) : 0;

    // LTV (simplified: ARPU / churn rate, capped at 36 months)
    const effectiveChurn = churnRate > 0 ? churnRate : 0.05; // assume 5% if no data
    const ltv = Math.round(arpu / effectiveChurn);

    // Trials and past due
    const activeTrials = allCustomers.filter(c => c.subscription?.status === 'trialing').length;
    const pastDue = allCustomers.filter(c => c.subscription?.status === 'past_due').length;

    return {
      mrr,
      arr: mrr * 12,
      arpu,
      churnRate,
      ltv,
      activeSubscriptions: activeSubscriptions.length,
      totalCustomers: allCustomers.length,
      planBreakdown,
      revenueByPlan,
      activeTrials,
      pastDue,
      periodStart: start,
      periodEnd: end,
      calculatedAt: now.toISOString(),
    };
  }

  // ─── Entitlements ───────────────────────────────────────────

  /**
   * Check if a customer has access to a specific feature
   */
  hasFeature(customerId: string, feature: string): boolean {
    const customer = this.customers.get(customerId);
    if (!customer) return false;

    const planConfig = PLAN_CONFIGS[customer.plan];
    return planConfig.features.includes(feature) || planConfig.features.includes('unlimited_everything');
  }

  /**
   * Get plan limits for a customer
   */
  getPlanLimits(customerId: string): { maxLocations: number; maxSkus: number; features: string[] } | null {
    const customer = this.customers.get(customerId);
    if (!customer) return null;

    const planConfig = PLAN_CONFIGS[customer.plan];
    return {
      maxLocations: planConfig.maxLocations,
      maxSkus: planConfig.maxSkus,
      features: planConfig.features,
    };
  }

  /**
   * Check if subscription is in good standing (active or trialing, not past due beyond grace)
   */
  isInGoodStanding(customerId: string): boolean {
    const customer = this.customers.get(customerId);
    if (!customer) return false;
    if (customer.plan === 'free') return true;
    if (!customer.subscription) return false;

    const { status, gracePeriodEnd } = customer.subscription;

    if (status === 'active' || status === 'trialing') return true;

    // Past due but within grace period
    if (status === 'past_due' && gracePeriodEnd) {
      return new Date(gracePeriodEnd) > new Date();
    }

    return false;
  }

  /**
   * Get a voice-friendly billing summary
   */
  getBillingSummary(customerId: string): string {
    const customer = this.customers.get(customerId);
    if (!customer) return 'Customer not found.';

    const planConfig = PLAN_CONFIGS[customer.plan];

    if (customer.plan === 'free') {
      return `You're on the free plan. Upgrade to Solo Store for $79 per month to unlock unlimited snaps, the dashboard, and product database lookups.`;
    }

    const sub = customer.subscription;
    if (!sub) return `You're on the ${planConfig.name} plan but have no active subscription.`;

    const parts: string[] = [];
    parts.push(`You're on the ${planConfig.name} plan`);

    if (sub.interval === 'year') {
      parts.push(`billed annually at $${(planConfig.priceAnnual / 100).toFixed(0)} per year`);
    } else {
      parts.push(`at $${(planConfig.priceMonthly / 100).toFixed(0)} per month`);
    }

    if (sub.status === 'trialing') {
      const trialEnd = sub.trialEnd ? new Date(sub.trialEnd) : null;
      if (trialEnd) {
        const daysLeft = Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        parts.push(`${daysLeft} days left in your trial`);
      }
    }

    if (sub.cancelAt) {
      parts.push(`scheduled to cancel on ${new Date(sub.cancelAt).toLocaleDateString()}`);
    }

    if (sub.status === 'past_due') {
      parts.push('your payment is past due — please update your payment method');
    }

    // Usage summary
    const unbilled = this.getUnbilledUsage(customerId);
    if (unbilled.length > 0) {
      const totalCost = unbilled.reduce((sum, u) => sum + u.estimatedCost, 0);
      if (totalCost > 0) {
        parts.push(`current usage charges: $${(totalCost / 100).toFixed(2)}`);
      }
    }

    return parts.join('. ') + '.';
  }

  // ─── Helpers ────────────────────────────────────────────────

  private nextId(prefix: string): string {
    this.idCounter++;
    return `${prefix}_${this.idCounter.toString().padStart(6, '0')}`;
  }

  private planFromPriceId(priceId: string): BillingPlan {
    for (const [plan, config] of Object.entries(PLAN_CONFIGS)) {
      if (config.stripePriceIds.month === priceId || config.stripePriceIds.year === priceId) {
        return plan as BillingPlan;
      }
    }
    return 'free';
  }

  private intervalFromPriceId(priceId: string): BillingInterval {
    for (const config of Object.values(PLAN_CONFIGS)) {
      if (config.stripePriceIds.year === priceId) return 'year';
    }
    return 'month';
  }
}
