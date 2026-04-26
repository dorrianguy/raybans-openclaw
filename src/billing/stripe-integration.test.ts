/**
 * Tests for Stripe Billing Integration
 * @module billing/stripe-integration.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StripeIntegration,
  StripeAdapter,
  StripeIntegrationConfig,
  PLAN_CONFIGS,
  Customer,
  StripeWebhookEvent,
} from './stripe-integration.js';

// ─── Mock Stripe Adapter ────────────────────────────────────────

function createMockAdapter(): StripeAdapter {
  let customerCounter = 0;
  let sessionCounter = 0;
  let subCounter = 0;
  let usageCounter = 0;

  return {
    createCustomer: vi.fn(async (email, name) => ({
      id: `cus_${++customerCounter}`,
    })),
    createCheckoutSession: vi.fn(async (params) => ({
      id: `cs_${++sessionCounter}`,
      url: `https://checkout.stripe.com/cs_${sessionCounter}`,
    })),
    createPortalSession: vi.fn(async (customerId, returnUrl) => ({
      id: `bps_${++sessionCounter}`,
      url: `https://billing.stripe.com/bps_${sessionCounter}`,
    })),
    updateSubscription: vi.fn(async (subId, params) => ({
      id: subId,
      status: 'active',
    })),
    cancelSubscription: vi.fn(async (subId, params) => ({
      id: subId,
      status: params.immediately ? 'canceled' : 'active',
      cancelAt: params.cancelAtPeriodEnd ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : undefined,
    })),
    reactivateSubscription: vi.fn(async (subId) => ({
      id: subId,
      status: 'active',
    })),
    reportUsage: vi.fn(async (subItemId, quantity) => ({
      id: `mbur_${++usageCounter}`,
    })),
    getInvoice: vi.fn(async (invoiceId) => ({
      id: invoiceId,
      amountDue: 7900,
      amountPaid: 7900,
      status: 'paid',
      lines: [{ description: 'Solo Store - Monthly', quantity: 1, unitAmount: 7900, amount: 7900 }],
    })),
    listPaymentMethods: vi.fn(async (customerId) => ([
      {
        id: 'pm_1',
        type: 'card',
        card: { last4: '4242', brand: 'visa', expMonth: 12, expYear: 2027 },
      },
    ])),
  };
}

function createConfig(adapter?: StripeAdapter): StripeIntegrationConfig {
  return {
    adapter: adapter || createMockAdapter(),
    successUrl: 'https://app.inventoryvision.com/success',
    cancelUrl: 'https://app.inventoryvision.com/cancel',
    portalReturnUrl: 'https://app.inventoryvision.com/billing',
    maxPaymentRetries: 4,
    gracePeriodHours: 72,
    minimumChargeCents: 200,
  };
}

async function createCustomerWithSubscription(
  integration: StripeIntegration,
  plan: 'solo' | 'multi' | 'enterprise' = 'solo',
): Promise<Customer> {
  const customer = await integration.createCustomer('test@example.com', 'Test User');

  // Simulate subscription creation via webhook
  await integration.processWebhook({
    type: 'customer.subscription.created',
    data: {
      id: 'sub_123',
      customer: customer.stripeCustomerId!,
      status: 'active',
      items: [{ price: { id: PLAN_CONFIGS[plan].stripePriceIds.month } }],
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    },
  });

  return integration.getCustomer(customer.id)!;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('StripeIntegration — Customer Management', () => {
  let integration: StripeIntegration;
  let adapter: StripeAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
    integration = new StripeIntegration(createConfig(adapter));
  });

  it('should create a customer', async () => {
    const customer = await integration.createCustomer('alice@example.com', 'Alice');
    expect(customer.email).toBe('alice@example.com');
    expect(customer.name).toBe('Alice');
    expect(customer.plan).toBe('free');
    expect(customer.stripeCustomerId).toBeDefined();
    expect(adapter.createCustomer).toHaveBeenCalledWith('alice@example.com', 'Alice', undefined);
  });

  it('should reject invalid email', async () => {
    await expect(integration.createCustomer('notanemail')).rejects.toThrow('Valid email');
  });

  it('should reject duplicate email', async () => {
    await integration.createCustomer('dup@example.com');
    await expect(integration.createCustomer('dup@example.com')).rejects.toThrow('already exists');
  });

  it('should get customer by ID', async () => {
    const customer = await integration.createCustomer('bob@example.com');
    const found = integration.getCustomer(customer.id);
    expect(found).toBeDefined();
    expect(found!.email).toBe('bob@example.com');
  });

  it('should get customer by Stripe ID', async () => {
    const customer = await integration.createCustomer('charlie@example.com');
    const found = integration.getCustomerByStripeId(customer.stripeCustomerId!);
    expect(found).toBeDefined();
    expect(found!.email).toBe('charlie@example.com');
  });

  it('should return undefined for unknown customer', () => {
    expect(integration.getCustomer('unknown')).toBeUndefined();
    expect(integration.getCustomerByStripeId('unknown')).toBeUndefined();
  });

  it('should list all customers', async () => {
    await integration.createCustomer('a@example.com');
    await integration.createCustomer('b@example.com');
    expect(integration.getAllCustomers()).toHaveLength(2);
  });

  it('should store metadata', async () => {
    const customer = await integration.createCustomer('meta@example.com', undefined, { source: 'referral' });
    expect(customer.metadata.source).toBe('referral');
  });

  it('should emit customer:created event', async () => {
    const handler = vi.fn();
    integration.on('customer:created', handler);
    await integration.createCustomer('event@example.com');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ email: 'event@example.com' }));
  });
});

describe('StripeIntegration — Checkout', () => {
  let integration: StripeIntegration;
  let adapter: StripeAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
    integration = new StripeIntegration(createConfig(adapter));
  });

  it('should create checkout session for solo plan', async () => {
    const customer = await integration.createCustomer('checkout@example.com');
    const session = await integration.createCheckout(customer.id, 'solo');
    expect(session.url).toContain('checkout.stripe.com');
    expect(session.plan).toBe('solo');
    expect(session.interval).toBe('month');
    expect(adapter.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      priceId: PLAN_CONFIGS.solo.stripePriceIds.month,
      trialDays: 7,
    }));
  });

  it('should create annual checkout', async () => {
    const customer = await integration.createCustomer('annual@example.com');
    const session = await integration.createCheckout(customer.id, 'multi', 'year');
    expect(session.interval).toBe('year');
    expect(adapter.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      priceId: PLAN_CONFIGS.multi.stripePriceIds.year,
    }));
  });

  it('should reject checkout for free plan', async () => {
    const customer = await integration.createCustomer('free@example.com');
    await expect(integration.createCheckout(customer.id, 'free')).rejects.toThrow('Cannot create checkout for free');
  });

  it('should reject checkout for unknown customer', async () => {
    await expect(integration.createCheckout('unknown', 'solo')).rejects.toThrow('not found');
  });

  it('should include enterprise trial of 14 days', async () => {
    const customer = await integration.createCustomer('enterprise@example.com');
    await integration.createCheckout(customer.id, 'enterprise');
    expect(adapter.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      trialDays: 14,
    }));
  });

  it('should not include trial for pay-per-count', async () => {
    const customer = await integration.createCustomer('ppc@example.com');
    await integration.createCheckout(customer.id, 'pay_per_count');
    expect(adapter.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      trialDays: undefined,
    }));
  });

  it('should emit checkout:created event', async () => {
    const handler = vi.fn();
    integration.on('checkout:created', handler);
    const customer = await integration.createCustomer('event-checkout@example.com');
    await integration.createCheckout(customer.id, 'solo');
    expect(handler).toHaveBeenCalled();
  });
});

describe('StripeIntegration — Billing Portal', () => {
  let integration: StripeIntegration;
  let adapter: StripeAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
    integration = new StripeIntegration(createConfig(adapter));
  });

  it('should create portal session', async () => {
    const customer = await integration.createCustomer('portal@example.com');
    const session = await integration.createPortal(customer.id);
    expect(session.url).toContain('billing.stripe.com');
    expect(session.customerId).toBe(customer.id);
  });

  it('should reject portal for unknown customer', async () => {
    await expect(integration.createPortal('unknown')).rejects.toThrow('not found');
  });
});

describe('StripeIntegration — Subscription Lifecycle (Webhooks)', () => {
  let integration: StripeIntegration;
  let adapter: StripeAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
    integration = new StripeIntegration(createConfig(adapter));
  });

  it('should handle subscription.created webhook', async () => {
    const customer = await integration.createCustomer('sub@example.com');
    const handler = vi.fn();
    integration.on('subscription:created', handler);

    await integration.processWebhook({
      type: 'customer.subscription.created',
      data: {
        id: 'sub_test',
        customer: customer.stripeCustomerId!,
        status: 'trialing',
        items: [{ price: { id: 'price_solo_monthly' } }],
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        trial_end: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      },
    });

    const updated = integration.getCustomer(customer.id)!;
    expect(updated.plan).toBe('solo');
    expect(updated.subscription).toBeDefined();
    expect(updated.subscription!.status).toBe('trialing');
    expect(updated.subscription!.trialEnd).toBeDefined();
    expect(handler).toHaveBeenCalled();
  });

  it('should handle subscription.updated webhook', async () => {
    const customer = await createCustomerWithSubscription(integration, 'solo');

    await integration.processWebhook({
      type: 'customer.subscription.updated',
      data: {
        id: 'sub_123',
        customer: customer.stripeCustomerId!,
        status: 'active',
        items: [{ price: { id: 'price_multi_monthly' } }],
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      },
    });

    const updated = integration.getCustomer(customer.id)!;
    expect(updated.plan).toBe('multi');
    expect(updated.subscription!.plan).toBe('multi');
  });

  it('should handle subscription.deleted webhook', async () => {
    const customer = await createCustomerWithSubscription(integration, 'solo');

    await integration.processWebhook({
      type: 'customer.subscription.deleted',
      data: {
        id: 'sub_123',
        customer: customer.stripeCustomerId!,
      },
    });

    const updated = integration.getCustomer(customer.id)!;
    expect(updated.plan).toBe('free');
    expect(updated.subscription!.status).toBe('canceled');
  });

  it('should handle checkout.session.completed webhook', async () => {
    const customer = await integration.createCustomer('checkout-wh@example.com');
    const handler = vi.fn();
    integration.on('checkout:completed', handler);

    await integration.processWebhook({
      type: 'checkout.session.completed',
      data: {
        customer: customer.stripeCustomerId!,
        subscription: 'sub_new',
        metadata: { internalCustomerId: customer.id },
      },
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      customerId: customer.id,
    }));
  });

  it('should emit error for unknown customer in webhook', async () => {
    const handler = vi.fn();
    integration.on('webhook:error', handler);

    await integration.processWebhook({
      type: 'customer.subscription.created',
      data: {
        id: 'sub_unknown',
        customer: 'cus_unknown',
        status: 'active',
        items: [{ price: { id: 'price_solo_monthly' } }],
        current_period_start: 0,
        current_period_end: 0,
      },
    });

    expect(handler).toHaveBeenCalled();
  });

  it('should handle unrecognized webhook event', async () => {
    const handler = vi.fn();
    integration.on('webhook:unhandled', handler);

    await integration.processWebhook({
      type: 'some.unknown.event' as any,
      data: {} as any,
    });

    expect(handler).toHaveBeenCalledWith({ type: 'some.unknown.event' });
  });

  it('should detect annual billing from price ID', async () => {
    const customer = await integration.createCustomer('annual-wh@example.com');

    await integration.processWebhook({
      type: 'customer.subscription.created',
      data: {
        id: 'sub_annual',
        customer: customer.stripeCustomerId!,
        status: 'active',
        items: [{ price: { id: 'price_multi_annual' } }],
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      },
    });

    const updated = integration.getCustomer(customer.id)!;
    expect(updated.subscription!.interval).toBe('year');
    expect(updated.plan).toBe('multi');
  });
});

describe('StripeIntegration — Plan Changes', () => {
  let integration: StripeIntegration;
  let adapter: StripeAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
    integration = new StripeIntegration(createConfig(adapter));
  });

  it('should upgrade plan', async () => {
    const customer = await createCustomerWithSubscription(integration, 'solo');
    const handler = vi.fn();
    integration.on('plan:changed', handler);

    const sub = await integration.changePlan(customer.id, 'multi');
    expect(sub.plan).toBe('multi');
    expect(adapter.updateSubscription).toHaveBeenCalledWith('sub_123', expect.objectContaining({
      priceId: 'price_multi_monthly',
      prorationBehavior: 'create_prorations',
    }));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ newPlan: 'multi' }));
  });

  it('should downgrade to free by canceling', async () => {
    const customer = await createCustomerWithSubscription(integration, 'solo');
    await integration.changePlan(customer.id, 'free');

    const updated = integration.getCustomer(customer.id)!;
    expect(updated.plan).toBe('free');
  });

  it('should reject plan change without subscription', async () => {
    const customer = await integration.createCustomer('noplan@example.com');
    await expect(integration.changePlan(customer.id, 'multi')).rejects.toThrow('no active subscription');
  });

  it('should change billing interval with plan change', async () => {
    const customer = await createCustomerWithSubscription(integration, 'solo');
    await integration.changePlan(customer.id, 'multi', 'year');
    expect(adapter.updateSubscription).toHaveBeenCalledWith('sub_123', expect.objectContaining({
      priceId: 'price_multi_annual',
    }));
  });
});

describe('StripeIntegration — Cancellation & Reactivation', () => {
  let integration: StripeIntegration;
  let adapter: StripeAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
    integration = new StripeIntegration(createConfig(adapter));
  });

  it('should cancel at period end', async () => {
    const customer = await createCustomerWithSubscription(integration);
    const sub = await integration.cancelSubscription(customer.id, true);
    expect(sub.cancelAt).toBeDefined();
    expect(sub.canceledAt).toBeDefined();
    expect(sub.status).toBe('active'); // Still active until period end
  });

  it('should cancel immediately', async () => {
    const customer = await createCustomerWithSubscription(integration);
    const sub = await integration.cancelSubscription(customer.id, false);
    expect(sub.status).toBe('canceled');
    const updated = integration.getCustomer(customer.id)!;
    expect(updated.plan).toBe('free');
  });

  it('should reactivate a scheduled cancellation', async () => {
    const customer = await createCustomerWithSubscription(integration);
    await integration.cancelSubscription(customer.id, true);
    const sub = await integration.reactivateSubscription(customer.id);
    expect(sub.cancelAt).toBeUndefined();
    expect(sub.status).toBe('active');
  });

  it('should reject reactivation if not scheduled for cancel', async () => {
    const customer = await createCustomerWithSubscription(integration);
    await expect(integration.reactivateSubscription(customer.id)).rejects.toThrow('not scheduled');
  });

  it('should reject cancel without subscription', async () => {
    const customer = await integration.createCustomer('nosub@example.com');
    await expect(integration.cancelSubscription(customer.id)).rejects.toThrow('no active subscription');
  });

  it('should emit subscription events', async () => {
    const cancelHandler = vi.fn();
    const reactivateHandler = vi.fn();
    integration.on('subscription:canceled', cancelHandler);
    integration.on('subscription:reactivated', reactivateHandler);

    const customer = await createCustomerWithSubscription(integration);
    await integration.cancelSubscription(customer.id, true);
    expect(cancelHandler).toHaveBeenCalled();

    await integration.reactivateSubscription(customer.id);
    expect(reactivateHandler).toHaveBeenCalled();
  });
});

describe('StripeIntegration — Usage-Based Billing', () => {
  let integration: StripeIntegration;

  beforeEach(() => {
    integration = new StripeIntegration(createConfig());
  });

  it('should record usage', async () => {
    const customer = await integration.createCustomer('usage@example.com');
    const record = await integration.recordUsage(customer.id, 'items_counted', 150);
    expect(record.resource).toBe('items_counted');
    expect(record.quantity).toBe(150);
    expect(record.billed).toBe(false);
  });

  it('should reject zero or negative quantity', async () => {
    const customer = await integration.createCustomer('neg@example.com');
    await expect(integration.recordUsage(customer.id, 'items', 0)).rejects.toThrow('positive');
    await expect(integration.recordUsage(customer.id, 'items', -5)).rejects.toThrow('positive');
  });

  it('should calculate unbilled usage', async () => {
    const customer = await integration.createCustomer('unbilled@example.com');
    await integration.recordUsage(customer.id, 'items_counted', 100);
    await integration.recordUsage(customer.id, 'items_counted', 200);
    await integration.recordUsage(customer.id, 'exports', 3);

    const unbilled = integration.getUnbilledUsage(customer.id);
    expect(unbilled).toHaveLength(2);

    const items = unbilled.find(u => u.resource === 'items_counted');
    expect(items!.totalQuantity).toBe(300);
  });

  it('should mark usage as billed', async () => {
    const customer = await integration.createCustomer('billed@example.com');
    await integration.recordUsage(customer.id, 'items_counted', 100);
    await integration.recordUsage(customer.id, 'items_counted', 200);

    const count = integration.markUsageBilled(customer.id, 'inv_123');
    expect(count).toBe(2);

    const unbilled = integration.getUnbilledUsage(customer.id);
    expect(unbilled).toHaveLength(0);
  });

  it('should return empty for unknown customer', () => {
    expect(integration.getUnbilledUsage('unknown')).toEqual([]);
    expect(integration.markUsageBilled('unknown', 'inv_x')).toBe(0);
  });

  it('should emit usage:recorded event', async () => {
    const handler = vi.fn();
    integration.on('usage:recorded', handler);

    const customer = await integration.createCustomer('event-usage@example.com');
    await integration.recordUsage(customer.id, 'snaps', 50);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ resource: 'snaps', quantity: 50 }));
  });
});

describe('StripeIntegration — Payment & Invoice Webhooks', () => {
  let integration: StripeIntegration;

  beforeEach(() => {
    integration = new StripeIntegration(createConfig());
  });

  it('should handle invoice.paid webhook', async () => {
    const customer = await createCustomerWithSubscription(integration);
    const handler = vi.fn();
    integration.on('invoice:paid', handler);

    await integration.processWebhook({
      type: 'invoice.paid',
      data: {
        id: 'in_123',
        customer: customer.stripeCustomerId!,
        subscription: 'sub_123',
        amount_paid: 7900,
        lines: [{ description: 'Solo Store', quantity: 1, unit_amount: 7900, amount: 7900 }],
        period_start: Math.floor(Date.now() / 1000),
        period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      },
    });

    const updated = integration.getCustomer(customer.id)!;
    expect(updated.invoices).toHaveLength(1);
    expect(updated.invoices[0].amountPaid).toBe(7900);
    expect(updated.invoices[0].status).toBe('paid');
    expect(handler).toHaveBeenCalled();
  });

  it('should clear past_due on successful payment', async () => {
    const customer = await createCustomerWithSubscription(integration);

    // Simulate failed payment first
    await integration.processWebhook({
      type: 'invoice.payment_failed',
      data: {
        id: 'in_fail',
        customer: customer.stripeCustomerId!,
        subscription: 'sub_123',
        attempt_count: 1,
        next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
      },
    });

    let updated = integration.getCustomer(customer.id)!;
    expect(updated.subscription!.status).toBe('past_due');

    // Successful retry
    await integration.processWebhook({
      type: 'invoice.paid',
      data: {
        id: 'in_success',
        customer: customer.stripeCustomerId!,
        amount_paid: 7900,
        lines: [{ description: 'Solo', quantity: 1, unit_amount: 7900, amount: 7900 }],
        period_start: Math.floor(Date.now() / 1000),
        period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      },
    });

    updated = integration.getCustomer(customer.id)!;
    expect(updated.subscription!.status).toBe('active');
    expect(updated.subscription!.failedPaymentAttempts).toBe(0);
    expect(updated.subscription!.gracePeriodEnd).toBeUndefined();
  });

  it('should mark usage billed when invoice paid', async () => {
    const customer = await createCustomerWithSubscription(integration);
    await integration.recordUsage(customer.id, 'items', 100);

    await integration.processWebhook({
      type: 'invoice.paid',
      data: {
        id: 'in_usage',
        customer: customer.stripeCustomerId!,
        amount_paid: 200,
        lines: [{ description: 'Usage', quantity: 100, unit_amount: 2, amount: 200 }],
        period_start: Math.floor(Date.now() / 1000),
        period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      },
    });

    expect(integration.getUnbilledUsage(customer.id)).toHaveLength(0);
  });
});

describe('StripeIntegration — Dunning (Failed Payments)', () => {
  let integration: StripeIntegration;

  beforeEach(() => {
    integration = new StripeIntegration(createConfig());
  });

  it('should set past_due on first payment failure', async () => {
    const customer = await createCustomerWithSubscription(integration);

    await integration.processWebhook({
      type: 'invoice.payment_failed',
      data: {
        id: 'in_fail1',
        customer: customer.stripeCustomerId!,
        subscription: 'sub_123',
        attempt_count: 1,
        next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
      },
    });

    const updated = integration.getCustomer(customer.id)!;
    expect(updated.subscription!.status).toBe('past_due');
    expect(updated.subscription!.failedPaymentAttempts).toBe(1);
    expect(updated.subscription!.gracePeriodEnd).toBeDefined();
  });

  it('should set unpaid after max retries', async () => {
    const customer = await createCustomerWithSubscription(integration);
    const handler = vi.fn();
    integration.on('subscription:dunning_exhausted', handler);

    await integration.processWebhook({
      type: 'invoice.payment_failed',
      data: {
        id: 'in_fail4',
        customer: customer.stripeCustomerId!,
        subscription: 'sub_123',
        attempt_count: 4,
      },
    });

    const updated = integration.getCustomer(customer.id)!;
    expect(updated.subscription!.status).toBe('unpaid');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ attempts: 4 }));
  });

  it('should track progressive failure count', async () => {
    const customer = await createCustomerWithSubscription(integration);

    for (let i = 1; i <= 3; i++) {
      await integration.processWebhook({
        type: 'invoice.payment_failed',
        data: { id: `in_fail_${i}`, customer: customer.stripeCustomerId!, attempt_count: i },
      });
    }

    const updated = integration.getCustomer(customer.id)!;
    expect(updated.subscription!.failedPaymentAttempts).toBe(3);
    expect(updated.subscription!.status).toBe('past_due');
  });

  it('should emit payment:failed event', async () => {
    const handler = vi.fn();
    integration.on('payment:failed', handler);

    const customer = await createCustomerWithSubscription(integration);
    await integration.processWebhook({
      type: 'invoice.payment_failed',
      data: { id: 'in_f', customer: customer.stripeCustomerId!, attempt_count: 2 },
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ attemptCount: 2 }));
  });
});

describe('StripeIntegration — Trial Management', () => {
  let integration: StripeIntegration;

  beforeEach(() => {
    integration = new StripeIntegration(createConfig());
  });

  it('should handle trial_will_end webhook', async () => {
    const customer = await integration.createCustomer('trial@example.com');
    const handler = vi.fn();
    integration.on('trial:ending', handler);

    // Create subscription with trial
    await integration.processWebhook({
      type: 'customer.subscription.created',
      data: {
        id: 'sub_trial',
        customer: customer.stripeCustomerId!,
        status: 'trialing',
        items: [{ price: { id: 'price_solo_monthly' } }],
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        trial_end: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
      },
    });

    // Trial ending notification
    await integration.processWebhook({
      type: 'customer.subscription.trial_will_end',
      data: {
        id: 'sub_trial',
        customer: customer.stripeCustomerId!,
        trial_end: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
      },
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      customerId: customer.id,
      daysLeft: expect.any(Number),
    }));
  });
});

describe('StripeIntegration — Payment Methods', () => {
  let integration: StripeIntegration;
  let adapter: StripeAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
    integration = new StripeIntegration(createConfig(adapter));
  });

  it('should sync payment methods', async () => {
    const customer = await integration.createCustomer('pm@example.com');
    const methods = await integration.syncPaymentMethods(customer.id);
    expect(methods).toHaveLength(1);
    expect(methods[0].last4).toBe('4242');
    expect(methods[0].brand).toBe('visa');
    expect(methods[0].isDefault).toBe(true);
  });

  it('should reject sync for unknown customer', async () => {
    await expect(integration.syncPaymentMethods('unknown')).rejects.toThrow('not found');
  });
});

describe('StripeIntegration — Revenue Metrics', () => {
  let integration: StripeIntegration;

  beforeEach(() => {
    integration = new StripeIntegration(createConfig());
  });

  it('should calculate MRR from monthly subscriptions', async () => {
    await createCustomerWithSubscription(integration, 'solo');

    const customer2 = await integration.createCustomer('metrics2@example.com');
    await integration.processWebhook({
      type: 'customer.subscription.created',
      data: {
        id: 'sub_456',
        customer: customer2.stripeCustomerId!,
        status: 'active',
        items: [{ price: { id: 'price_multi_monthly' } }],
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      },
    });

    const metrics = integration.calculateMetrics();
    expect(metrics.mrr).toBe(7900 + 19900); // Solo + Multi
    expect(metrics.arr).toBe((7900 + 19900) * 12);
    expect(metrics.activeSubscriptions).toBe(2);
  });

  it('should calculate MRR from annual subscription', async () => {
    const customer = await integration.createCustomer('annual-m@example.com');
    await integration.processWebhook({
      type: 'customer.subscription.created',
      data: {
        id: 'sub_annual_m',
        customer: customer.stripeCustomerId!,
        status: 'active',
        items: [{ price: { id: 'price_solo_annual' } }],
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      },
    });

    const metrics = integration.calculateMetrics();
    expect(metrics.mrr).toBe(Math.round(79000 / 12)); // Annual / 12
  });

  it('should count plan breakdown', async () => {
    await createCustomerWithSubscription(integration, 'solo');
    await integration.createCustomer('free-user@example.com');

    const metrics = integration.calculateMetrics();
    expect(metrics.planBreakdown.solo).toBe(1);
    expect(metrics.planBreakdown.free).toBe(1);
    expect(metrics.totalCustomers).toBe(2);
  });

  it('should calculate churn rate', async () => {
    const customer = await createCustomerWithSubscription(integration, 'solo');
    await integration.cancelSubscription(customer.id, false);

    const metrics = integration.calculateMetrics();
    expect(metrics.churnRate).toBeGreaterThan(0);
  });

  it('should calculate ARPU', async () => {
    await createCustomerWithSubscription(integration, 'solo');

    const metrics = integration.calculateMetrics();
    expect(metrics.arpu).toBe(7900);
  });

  it('should calculate LTV', async () => {
    await createCustomerWithSubscription(integration, 'solo');

    const metrics = integration.calculateMetrics();
    expect(metrics.ltv).toBeGreaterThan(0);
  });

  it('should count trials', async () => {
    const customer = await integration.createCustomer('trial-m@example.com');
    await integration.processWebhook({
      type: 'customer.subscription.created',
      data: {
        id: 'sub_trial_m',
        customer: customer.stripeCustomerId!,
        status: 'trialing',
        items: [{ price: { id: 'price_solo_monthly' } }],
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        trial_end: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      },
    });

    const metrics = integration.calculateMetrics();
    expect(metrics.activeTrials).toBe(1);
  });

  it('should handle empty state', () => {
    const metrics = integration.calculateMetrics();
    expect(metrics.mrr).toBe(0);
    expect(metrics.activeSubscriptions).toBe(0);
    expect(metrics.churnRate).toBe(0);
  });
});

describe('StripeIntegration — Entitlements & Feature Gating', () => {
  let integration: StripeIntegration;

  beforeEach(() => {
    integration = new StripeIntegration(createConfig());
  });

  it('should check features for free plan', async () => {
    const customer = await integration.createCustomer('free-feat@example.com');
    expect(integration.hasFeature(customer.id, 'basic_vision')).toBe(true);
    expect(integration.hasFeature(customer.id, 'dashboard')).toBe(false);
    expect(integration.hasFeature(customer.id, 'pos_integration')).toBe(false);
  });

  it('should check features for solo plan', async () => {
    const customer = await createCustomerWithSubscription(integration, 'solo');
    expect(integration.hasFeature(customer.id, 'dashboard')).toBe(true);
    expect(integration.hasFeature(customer.id, 'product_db')).toBe(true);
    expect(integration.hasFeature(customer.id, 'pos_integration')).toBe(false);
  });

  it('should check features for enterprise plan', async () => {
    const customer = await createCustomerWithSubscription(integration, 'enterprise');
    // Enterprise has 'unlimited_everything' which covers all features
    expect(integration.hasFeature(customer.id, 'dashboard')).toBe(true);
    expect(integration.hasFeature(customer.id, 'custom_integrations')).toBe(true);
    expect(integration.hasFeature(customer.id, 'anything_at_all')).toBe(true);
  });

  it('should return false for unknown customer', () => {
    expect(integration.hasFeature('unknown', 'anything')).toBe(false);
  });

  it('should get plan limits', async () => {
    const customer = await createCustomerWithSubscription(integration, 'solo');
    const limits = integration.getPlanLimits(customer.id);
    expect(limits).toBeDefined();
    expect(limits!.maxLocations).toBe(1);
    expect(limits!.maxSkus).toBe(5000);
  });

  it('should check good standing for free user', async () => {
    const customer = await integration.createCustomer('standing@example.com');
    expect(integration.isInGoodStanding(customer.id)).toBe(true);
  });

  it('should check good standing for active subscriber', async () => {
    const customer = await createCustomerWithSubscription(integration);
    expect(integration.isInGoodStanding(customer.id)).toBe(true);
  });

  it('should check good standing for past_due within grace', async () => {
    const customer = await createCustomerWithSubscription(integration);

    await integration.processWebhook({
      type: 'invoice.payment_failed',
      data: { id: 'in_f', customer: customer.stripeCustomerId!, attempt_count: 1 },
    });

    expect(integration.isInGoodStanding(customer.id)).toBe(true); // Within 72h grace
  });

  it('should fail good standing for unpaid', async () => {
    const customer = await createCustomerWithSubscription(integration);

    await integration.processWebhook({
      type: 'invoice.payment_failed',
      data: { id: 'in_f4', customer: customer.stripeCustomerId!, attempt_count: 4 },
    });

    expect(integration.isInGoodStanding(customer.id)).toBe(false); // Unpaid
  });
});

describe('StripeIntegration — Voice Billing Summary', () => {
  let integration: StripeIntegration;

  beforeEach(() => {
    integration = new StripeIntegration(createConfig());
  });

  it('should summarize free plan', async () => {
    const customer = await integration.createCustomer('summary-free@example.com');
    const summary = integration.getBillingSummary(customer.id);
    expect(summary).toContain('free plan');
    expect(summary).toContain('$79');
  });

  it('should summarize active subscription', async () => {
    const customer = await createCustomerWithSubscription(integration, 'solo');
    const summary = integration.getBillingSummary(customer.id);
    expect(summary).toContain('Solo Store');
    expect(summary).toContain('$79');
  });

  it('should mention trial', async () => {
    const customer = await integration.createCustomer('trial-sum@example.com');
    await integration.processWebhook({
      type: 'customer.subscription.created',
      data: {
        id: 'sub_t',
        customer: customer.stripeCustomerId!,
        status: 'trialing',
        items: [{ price: { id: 'price_solo_monthly' } }],
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        trial_end: Math.floor(Date.now() / 1000) + 5 * 24 * 60 * 60,
      },
    });

    const summary = integration.getBillingSummary(customer.id);
    expect(summary).toContain('trial');
    expect(summary).toContain('days');
  });

  it('should mention past due', async () => {
    const customer = await createCustomerWithSubscription(integration);
    await integration.processWebhook({
      type: 'invoice.payment_failed',
      data: { id: 'in_pd', customer: customer.stripeCustomerId!, attempt_count: 1 },
    });

    const summary = integration.getBillingSummary(customer.id);
    expect(summary).toContain('past due');
  });

  it('should mention scheduled cancellation', async () => {
    const customer = await createCustomerWithSubscription(integration);
    await integration.cancelSubscription(customer.id, true);

    const summary = integration.getBillingSummary(customer.id);
    expect(summary).toContain('cancel');
  });

  it('should mention usage charges', async () => {
    const customer = await createCustomerWithSubscription(integration);
    await integration.recordUsage(customer.id, 'items_counted', 500);

    const summary = integration.getBillingSummary(customer.id);
    expect(summary).toContain('usage');
  });

  it('should handle unknown customer', () => {
    expect(integration.getBillingSummary('unknown')).toContain('not found');
  });
});

describe('StripeIntegration — Plan Configs', () => {
  it('should have correct pricing for all plans', () => {
    expect(PLAN_CONFIGS.free.priceMonthly).toBe(0);
    expect(PLAN_CONFIGS.solo.priceMonthly).toBe(7900);
    expect(PLAN_CONFIGS.multi.priceMonthly).toBe(19900);
    expect(PLAN_CONFIGS.enterprise.priceMonthly).toBe(49900);
  });

  it('should have trial days configured', () => {
    expect(PLAN_CONFIGS.free.trialDays).toBe(0);
    expect(PLAN_CONFIGS.solo.trialDays).toBe(7);
    expect(PLAN_CONFIGS.enterprise.trialDays).toBe(14);
  });

  it('should have Stripe price IDs for paid plans', () => {
    expect(PLAN_CONFIGS.solo.stripePriceIds.month).toBeTruthy();
    expect(PLAN_CONFIGS.solo.stripePriceIds.year).toBeTruthy();
    expect(PLAN_CONFIGS.multi.stripePriceIds.month).toBeTruthy();
    expect(PLAN_CONFIGS.enterprise.stripePriceIds.month).toBeTruthy();
  });

  it('should have location and SKU limits', () => {
    expect(PLAN_CONFIGS.free.maxLocations).toBe(1);
    expect(PLAN_CONFIGS.solo.maxLocations).toBe(1);
    expect(PLAN_CONFIGS.multi.maxLocations).toBe(5);
    expect(PLAN_CONFIGS.enterprise.maxLocations).toBe(Infinity);
  });

  it('should have features for each plan', () => {
    expect(PLAN_CONFIGS.free.features.length).toBeGreaterThan(0);
    expect(PLAN_CONFIGS.solo.features.length).toBeGreaterThan(PLAN_CONFIGS.free.features.length);
    expect(PLAN_CONFIGS.enterprise.features).toContain('unlimited_everything');
  });
});
