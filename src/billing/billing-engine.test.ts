/**
 * Tests for BillingEngine — Stripe-powered subscription management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BillingEngine,
  PLAN_DEFINITIONS,
  DEFAULT_BILLING_CONFIG,
  type PlanId,
  type Customer,
  type WebhookEventType,
} from './billing-engine.js';

describe('BillingEngine', () => {
  let engine: BillingEngine;

  beforeEach(() => {
    engine = new BillingEngine({ testMode: true });
  });

  // ─── Plan Management ────────────────────────────────────────

  describe('Plan Management', () => {
    it('should return all available plans sorted by sortOrder', () => {
      const plans = engine.getPlans();
      expect(plans.length).toBeGreaterThanOrEqual(5);
      for (let i = 1; i < plans.length; i++) {
        expect(plans[i].sortOrder).toBeGreaterThanOrEqual(plans[i - 1].sortOrder);
      }
    });

    it('should get a specific plan definition', () => {
      const plan = engine.getPlan('solo_store');
      expect(plan).toBeDefined();
      expect(plan!.name).toBe('Solo Store');
      expect(plan!.prices.monthly).toBe(7900);
    });

    it('should return undefined for unknown plan', () => {
      expect(engine.getPlan('nonexistent' as PlanId)).toBeUndefined();
    });

    it('should get entitlements for a plan', () => {
      const entitlements = engine.getEntitlements('multi_store');
      expect(entitlements).toBeDefined();
      expect(entitlements!.maxStores).toBe(5);
      expect(entitlements!.posIntegration).toBe(true);
    });

    it('should define correct pricing for all plans', () => {
      expect(PLAN_DEFINITIONS.free.prices.monthly).toBe(0);
      expect(PLAN_DEFINITIONS.solo_store.prices.monthly).toBe(7900);
      expect(PLAN_DEFINITIONS.multi_store.prices.monthly).toBe(19900);
      expect(PLAN_DEFINITIONS.enterprise.prices.monthly).toBe(49900);
      expect(PLAN_DEFINITIONS.pay_per_count.entitlements.perItemCostCents).toBe(2);
    });

    it('should have free plan with limited features', () => {
      const free = PLAN_DEFINITIONS.free.entitlements;
      expect(free.maxStores).toBe(1);
      expect(free.maxSkus).toBe(100);
      expect(free.maxSessionsPerMonth).toBe(2);
      expect(free.posIntegration).toBe(false);
      expect(free.apiAccess).toBe(false);
    });

    it('should have enterprise plan with unlimited features', () => {
      const ent = PLAN_DEFINITIONS.enterprise.entitlements;
      expect(ent.maxStores).toBe(-1);
      expect(ent.maxSkus).toBe(-1);
      expect(ent.apiAccess).toBe(true);
      expect(ent.customReporting).toBe(true);
      expect(ent.agentFeatures.length).toBeGreaterThanOrEqual(8);
    });

    it('should have pay_per_count plan with usage pricing', () => {
      const ppc = PLAN_DEFINITIONS.pay_per_count;
      expect(ppc.entitlements.perItemCostCents).toBe(2);
      expect(ppc.entitlements.minSessionChargeCents).toBe(20000);
      expect(ppc.trialDays).toBe(0);
    });
  });

  // ─── Plan Comparison ────────────────────────────────────────

  describe('Plan Comparison', () => {
    it('should detect upgrade correctly', () => {
      const comp = engine.comparePlans('free', 'solo_store');
      expect(comp.isUpgrade).toBe(true);
      expect(comp.isDowngrade).toBe(false);
      expect(comp.priceDiffMonthly).toBe(7900);
    });

    it('should detect downgrade correctly', () => {
      const comp = engine.comparePlans('enterprise', 'solo_store');
      expect(comp.isDowngrade).toBe(true);
      expect(comp.isUpgrade).toBe(false);
      expect(comp.priceDiffMonthly).toBeLessThan(0);
    });

    it('should detect same plan', () => {
      const comp = engine.comparePlans('solo_store', 'solo_store');
      expect(comp.isSame).toBe(true);
      expect(comp.priceDiffMonthly).toBe(0);
    });

    it('should list gains and losses', () => {
      const comp = engine.comparePlans('solo_store', 'multi_store');
      expect(comp.gains.length).toBeGreaterThan(0);
      // Should gain POS Integration
      expect(comp.gains.some(g => g.includes('POS'))).toBe(true);
    });

    it('should list agent feature changes', () => {
      const comp = engine.comparePlans('free', 'enterprise');
      expect(comp.gains.some(g => g.includes('agents'))).toBe(true);
    });

    it('should throw for unknown plans', () => {
      expect(() => engine.comparePlans('free', 'bogus' as PlanId)).toThrow('Unknown plan');
    });
  });

  // ─── Customer Management ────────────────────────────────────

  describe('Customer Management', () => {
    it('should create a customer', () => {
      const customer = engine.createCustomer({
        email: 'test@example.com',
        name: 'Test User',
      });
      expect(customer.id).toBeDefined();
      expect(customer.email).toBe('test@example.com');
      expect(customer.planId).toBe('free');
      expect(customer.subscriptionStatus).toBe('active');
    });

    it('should create a customer on a paid plan', () => {
      const customer = engine.createCustomer({
        email: 'paid@example.com',
        planId: 'solo_store',
      });
      expect(customer.planId).toBe('solo_store');
      expect(customer.subscriptionStatus).toBe('incomplete');
    });

    it('should prevent duplicate emails', () => {
      engine.createCustomer({ email: 'dup@example.com' });
      expect(() => engine.createCustomer({ email: 'dup@example.com' })).toThrow('already exists');
    });

    it('should throw for unknown plan on create', () => {
      expect(() => engine.createCustomer({
        email: 'x@x.com',
        planId: 'fake' as PlanId,
      })).toThrow('Unknown plan');
    });

    it('should get customer by ID', () => {
      const created = engine.createCustomer({ email: 'get@example.com' });
      const fetched = engine.getCustomer(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.email).toBe('get@example.com');
    });

    it('should get customer by email', () => {
      engine.createCustomer({ email: 'byemail@example.com' });
      const customer = engine.getCustomerByEmail('byemail@example.com');
      expect(customer).toBeDefined();
    });

    it('should get customer by Stripe ID', () => {
      engine.createCustomer({
        email: 'stripe@example.com',
        stripeCustomerId: 'cus_stripe123',
      });
      const customer = engine.getCustomerByStripeId('cus_stripe123');
      expect(customer).toBeDefined();
      expect(customer!.email).toBe('stripe@example.com');
    });

    it('should update customer details', () => {
      const c = engine.createCustomer({ email: 'update@example.com' });
      const updated = engine.updateCustomer(c.id, {
        name: 'Updated Name',
        companyName: 'Acme Corp',
        metadata: { source: 'api' },
      });
      expect(updated.name).toBe('Updated Name');
      expect(updated.companyName).toBe('Acme Corp');
      expect(updated.metadata.source).toBe('api');
    });

    it('should throw when updating nonexistent customer', () => {
      expect(() => engine.updateCustomer('fake', { name: 'x' })).toThrow('not found');
    });

    it('should delete a customer', () => {
      const c = engine.createCustomer({ email: 'delete@example.com' });
      expect(engine.deleteCustomer(c.id)).toBe(true);
      expect(engine.getCustomer(c.id)).toBeUndefined();
      expect(engine.getCustomerByEmail('delete@example.com')).toBeUndefined();
    });

    it('should return false when deleting nonexistent customer', () => {
      expect(engine.deleteCustomer('fake')).toBe(false);
    });

    it('should list customers with filters', () => {
      engine.createCustomer({ email: 'a@test.com', name: 'Alice' });
      engine.createCustomer({ email: 'b@test.com', name: 'Bob', planId: 'solo_store' });
      engine.createCustomer({ email: 'c@test.com', name: 'Charlie' });

      const all = engine.listCustomers();
      expect(all.total).toBe(3);

      const free = engine.listCustomers({ planId: 'free' });
      expect(free.total).toBe(2);

      const search = engine.listCustomers({ search: 'bob' });
      expect(search.total).toBe(1);

      const paged = engine.listCustomers({ limit: 2, offset: 0 });
      expect(paged.customers.length).toBe(2);
      expect(paged.total).toBe(3);
    });

    it('should emit customer:created event', () => {
      const spy = vi.fn();
      engine.on('customer:created', spy);
      engine.createCustomer({ email: 'evt@test.com' });
      expect(spy).toHaveBeenCalledOnce();
    });

    it('should emit customer:deleted event', () => {
      const spy = vi.fn();
      engine.on('customer:deleted', spy);
      const c = engine.createCustomer({ email: 'evt2@test.com' });
      engine.deleteCustomer(c.id);
      expect(spy).toHaveBeenCalledWith(c.id);
    });
  });

  // ─── Subscription Lifecycle ─────────────────────────────────

  describe('Subscription Lifecycle', () => {
    let customer: Customer;

    beforeEach(() => {
      customer = engine.createCustomer({ email: 'sub@test.com' });
    });

    it('should start a subscription', () => {
      const updated = engine.startSubscription(customer.id, {
        planId: 'solo_store',
        billingInterval: 'monthly',
      });
      expect(updated.planId).toBe('solo_store');
      expect(updated.subscriptionStatus).toBe('trialing'); // solo has 14-day trial
      expect(updated.trialEndsAt).toBeDefined();
    });

    it('should start subscription without trial when trialDays=0', () => {
      const updated = engine.startSubscription(customer.id, {
        planId: 'solo_store',
        trialDays: 0,
      });
      expect(updated.subscriptionStatus).toBe('active');
      expect(updated.trialEndsAt).toBeUndefined();
    });

    it('should set yearly billing interval and period', () => {
      const updated = engine.startSubscription(customer.id, {
        planId: 'solo_store',
        billingInterval: 'yearly',
        trialDays: 0,
      });
      expect(updated.billingInterval).toBe('yearly');
      const start = new Date(updated.currentPeriodStart!);
      const end = new Date(updated.currentPeriodEnd!);
      const diffMs = end.getTime() - start.getTime();
      // Should be ~365 days
      expect(diffMs).toBeGreaterThan(364 * 24 * 60 * 60 * 1000);
    });

    it('should throw for nonexistent customer', () => {
      expect(() => engine.startSubscription('fake', { planId: 'solo_store' })).toThrow('not found');
    });

    it('should throw for unknown plan', () => {
      expect(() => engine.startSubscription(customer.id, { planId: 'bogus' as PlanId })).toThrow('Unknown plan');
    });

    it('should change plan (upgrade)', () => {
      engine.startSubscription(customer.id, { planId: 'solo_store', trialDays: 0 });
      const spy = vi.fn();
      engine.on('subscription:updated', spy);

      const updated = engine.changePlan(customer.id, 'multi_store');
      expect(updated.planId).toBe('multi_store');
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][1]).toBe('solo_store'); // previous plan
    });

    it('should disallow downgrade when configured', () => {
      const strictEngine = new BillingEngine({ allowDowngrades: false });
      const c = strictEngine.createCustomer({ email: 'strict@test.com' });
      strictEngine.startSubscription(c.id, { planId: 'enterprise', trialDays: 0 });
      expect(() => strictEngine.changePlan(c.id, 'solo_store')).toThrow('downgrades are not allowed');
    });

    it('should cancel subscription at period end', () => {
      engine.startSubscription(customer.id, { planId: 'solo_store', trialDays: 0 });
      const updated = engine.cancelSubscription(customer.id, {
        atPeriodEnd: true,
        reason: 'too_expensive',
      });
      expect(updated.cancelAt).toBeDefined();
      expect(updated.subscriptionStatus).not.toBe('canceled'); // still active until period end
      expect(updated.metadata._cancelReason).toBe('too_expensive');
    });

    it('should cancel subscription immediately', () => {
      engine.startSubscription(customer.id, { planId: 'solo_store', trialDays: 0 });
      const updated = engine.cancelSubscription(customer.id);
      expect(updated.subscriptionStatus).toBe('canceled');
      expect(updated.canceledAt).toBeDefined();
    });

    it('should reactivate a pending cancellation', () => {
      engine.startSubscription(customer.id, { planId: 'solo_store', trialDays: 0 });
      engine.cancelSubscription(customer.id, { atPeriodEnd: true });
      expect(engine.getCustomer(customer.id)!.cancelAt).toBeDefined();

      const reactivated = engine.reactivateSubscription(customer.id);
      expect(reactivated.cancelAt).toBeUndefined();
    });

    it('should reactivate a fully canceled subscription', () => {
      engine.startSubscription(customer.id, { planId: 'solo_store', trialDays: 0 });
      engine.cancelSubscription(customer.id);
      expect(engine.getCustomer(customer.id)!.subscriptionStatus).toBe('canceled');

      const reactivated = engine.reactivateSubscription(customer.id);
      expect(reactivated.subscriptionStatus).toBe('active');
      expect(reactivated.currentPeriodStart).toBeDefined();
    });

    it('should pause subscription', () => {
      engine.startSubscription(customer.id, { planId: 'solo_store', trialDays: 0 });
      const paused = engine.pauseSubscription(customer.id);
      expect(paused.subscriptionStatus).toBe('paused');
    });

    it('should not pause non-active subscription', () => {
      engine.startSubscription(customer.id, { planId: 'solo_store', trialDays: 0 });
      engine.cancelSubscription(customer.id);
      expect(() => engine.pauseSubscription(customer.id)).toThrow('Cannot pause');
    });

    it('should resume paused subscription', () => {
      engine.startSubscription(customer.id, { planId: 'solo_store', trialDays: 0 });
      engine.pauseSubscription(customer.id);
      const resumed = engine.resumeSubscription(customer.id);
      expect(resumed.subscriptionStatus).toBe('active');
    });

    it('should not resume non-paused subscription', () => {
      engine.startSubscription(customer.id, { planId: 'solo_store', trialDays: 0 });
      expect(() => engine.resumeSubscription(customer.id)).toThrow('not paused');
    });

    it('should emit subscription events', () => {
      const created = vi.fn();
      const canceled = vi.fn();
      const reactivated = vi.fn();
      engine.on('subscription:created', created);
      engine.on('subscription:canceled', canceled);
      engine.on('subscription:reactivated', reactivated);

      engine.startSubscription(customer.id, { planId: 'solo_store', trialDays: 0 });
      expect(created).toHaveBeenCalledOnce();

      engine.cancelSubscription(customer.id);
      expect(canceled).toHaveBeenCalledOnce();

      engine.reactivateSubscription(customer.id);
      expect(reactivated).toHaveBeenCalledOnce();
    });
  });

  // ─── Entitlement Checks ─────────────────────────────────────

  describe('Entitlement Checks', () => {
    it('should check boolean entitlements', () => {
      const c = engine.createCustomer({ email: 'ent@test.com' });
      engine.startSubscription(c.id, { planId: 'solo_store', trialDays: 0 });

      expect(engine.hasEntitlement(c.id, 'exportCsv')).toBe(true);
      expect(engine.hasEntitlement(c.id, 'posIntegration')).toBe(false);
      expect(engine.hasEntitlement(c.id, 'apiAccess')).toBe(false);
    });

    it('should check agent feature entitlements', () => {
      const c = engine.createCustomer({ email: 'agent@test.com' });
      engine.startSubscription(c.id, { planId: 'solo_store', trialDays: 0 });

      expect(engine.hasEntitlement(c.id, 'agent:inventory')).toBe(true);
      expect(engine.hasEntitlement(c.id, 'agent:memory')).toBe(true);
      expect(engine.hasEntitlement(c.id, 'agent:networking')).toBe(false); // not in solo
    });

    it('should deny entitlements for canceled subscriptions', () => {
      const c = engine.createCustomer({ email: 'canceled@test.com' });
      engine.startSubscription(c.id, { planId: 'enterprise', trialDays: 0 });
      engine.cancelSubscription(c.id);

      expect(engine.hasEntitlement(c.id, 'apiAccess')).toBe(false);
    });

    it('should allow entitlements during trial', () => {
      const c = engine.createCustomer({ email: 'trial@test.com' });
      engine.startSubscription(c.id, { planId: 'enterprise' }); // 30 day trial
      expect(c.subscriptionStatus).toBe('trialing');
      expect(engine.hasEntitlement(c.id, 'apiAccess')).toBe(true);
    });

    it('should check store limit', () => {
      const c = engine.createCustomer({ email: 'stores@test.com' });
      engine.startSubscription(c.id, { planId: 'solo_store', trialDays: 0 });

      expect(engine.canAddStore(c.id, 0)).toBe(true);
      expect(engine.canAddStore(c.id, 1)).toBe(false); // solo = max 1
    });

    it('should allow unlimited stores for enterprise', () => {
      const c = engine.createCustomer({ email: 'ent@test.com' });
      engine.startSubscription(c.id, { planId: 'enterprise', trialDays: 0 });
      expect(engine.canAddStore(c.id, 100)).toBe(true);
    });

    it('should check SKU limit', () => {
      const c = engine.createCustomer({ email: 'skus@test.com' });
      engine.startSubscription(c.id, { planId: 'free' });
      expect(engine.canAddSku(c.id, 50)).toBe(true);
      expect(engine.canAddSku(c.id, 100)).toBe(false); // free = max 100
    });

    it('should check session limit', () => {
      const c = engine.createCustomer({ email: 'sessions@test.com' });
      engine.startSubscription(c.id, { planId: 'free' });
      expect(engine.canStartSession(c.id, 1)).toBe(true);
      expect(engine.canStartSession(c.id, 2)).toBe(false); // free = max 2
    });

    it('should deny session for canceled subscription', () => {
      const c = engine.createCustomer({ email: 'nomore@test.com' });
      engine.startSubscription(c.id, { planId: 'solo_store', trialDays: 0 });
      engine.cancelSubscription(c.id);
      expect(engine.canStartSession(c.id, 0)).toBe(false);
    });

    it('should check numeric limits and emit events', () => {
      const c = engine.createCustomer({ email: 'limits@test.com' });
      engine.startSubscription(c.id, { planId: 'free' });

      const approaching = vi.fn();
      const exceeded = vi.fn();
      engine.on('usage:limit_approaching', approaching);
      engine.on('entitlement:exceeded', exceeded);

      // 90% of 100 SKUs = should trigger approaching
      const result = engine.checkLimit(c.id, 'skus', 90);
      expect(result.allowed).toBe(true);
      expect(result.percentUsed).toBe(90);
      expect(approaching).toHaveBeenCalled();

      // At limit
      const atLimit = engine.checkLimit(c.id, 'skus', 100);
      expect(atLimit.allowed).toBe(false);
      expect(exceeded).toHaveBeenCalled();
    });

    it('should handle unlimited limits', () => {
      const c = engine.createCustomer({ email: 'unlim@test.com' });
      engine.startSubscription(c.id, { planId: 'enterprise', trialDays: 0 });

      const result = engine.checkLimit(c.id, 'stores', 999);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
      expect(result.remaining).toBe(Infinity);
    });

    it('should return not allowed for nonexistent customer', () => {
      expect(engine.hasEntitlement('fake', 'exportCsv')).toBe(false);
      expect(engine.canAddStore('fake', 0)).toBe(false);
    });
  });

  // ─── Usage Tracking ─────────────────────────────────────────

  describe('Usage Tracking', () => {
    it('should record usage', () => {
      const c = engine.createCustomer({ email: 'usage@test.com' });
      engine.startSubscription(c.id, { planId: 'pay_per_count', trialDays: 0 });

      const record = engine.recordUsage(c.id, 'session_1', 500);
      expect(record.id).toBeDefined();
      expect(record.itemsCounted).toBe(500);
      expect(record.reported).toBe(false);
    });

    it('should emit usage:recorded event', () => {
      const c = engine.createCustomer({ email: 'usageevt@test.com' });
      const spy = vi.fn();
      engine.on('usage:recorded', spy);
      engine.recordUsage(c.id, 'session_1', 100);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('should calculate usage summary', () => {
      const c = engine.createCustomer({ email: 'summary@test.com' });
      engine.startSubscription(c.id, { planId: 'pay_per_count', trialDays: 0 });

      engine.recordUsage(c.id, 's1', 500);
      engine.recordUsage(c.id, 's2', 300);

      const summary = engine.getUsageSummary(c.id);
      expect(summary.totalItems).toBe(800);
      expect(summary.totalSessions).toBe(2);
      // 800 items × $0.02 = $16.00 = 1600 cents
      // But minimum per session is $200 = 20000 cents
      // Session 1: 500 × 2 = 1000 cents, min 20000, so add 19000
      // Session 2: 300 × 2 = 600 cents, min 20000, so add 19400
      expect(summary.estimatedCost).toBe(1600 + 19000 + 19400);
    });

    it('should filter usage by period', () => {
      const c = engine.createCustomer({ email: 'period@test.com' });
      engine.recordUsage(c.id, 's1', 100);

      const future = new Date(Date.now() + 86400000).toISOString();
      const summary = engine.getUsageSummary(c.id, future);
      expect(summary.totalItems).toBe(0);
    });

    it('should mark records as reported', () => {
      const c = engine.createCustomer({ email: 'reported@test.com' });
      const r1 = engine.recordUsage(c.id, 's1', 100);
      const r2 = engine.recordUsage(c.id, 's2', 200);

      engine.markUsageReported([r1.id]);

      const summary = engine.getUsageSummary(c.id);
      const reported = summary.records.filter(r => r.reported);
      expect(reported.length).toBe(1);
    });

    it('should throw for nonexistent customer', () => {
      expect(() => engine.recordUsage('fake', 's1', 100)).toThrow('not found');
    });
  });

  // ─── Invoice Management ─────────────────────────────────────

  describe('Invoice Management', () => {
    it('should create an invoice', () => {
      const c = engine.createCustomer({ email: 'inv@test.com' });
      const invoice = engine.createInvoice({
        customerId: c.id,
        amount: 7900,
        periodStart: '2026-02-01T00:00:00Z',
        periodEnd: '2026-03-01T00:00:00Z',
      });
      expect(invoice.id).toBeDefined();
      expect(invoice.amount).toBe(7900);
      expect(invoice.status).toBe('open');
    });

    it('should mark invoice as paid', () => {
      const c = engine.createCustomer({ email: 'paid@test.com' });
      const invoice = engine.createInvoice({
        customerId: c.id,
        amount: 7900,
        periodStart: '2026-02-01T00:00:00Z',
        periodEnd: '2026-03-01T00:00:00Z',
      });

      const spy = vi.fn();
      engine.on('invoice:paid', spy);

      const paid = engine.markInvoicePaid(invoice.id);
      expect(paid.status).toBe('paid');
      expect(paid.paidAt).toBeDefined();
      expect(spy).toHaveBeenCalledOnce();
    });

    it('should mark invoice as failed', () => {
      const c = engine.createCustomer({ email: 'fail@test.com' });
      const invoice = engine.createInvoice({
        customerId: c.id,
        amount: 7900,
        periodStart: '2026-02-01T00:00:00Z',
        periodEnd: '2026-03-01T00:00:00Z',
      });

      const spy = vi.fn();
      engine.on('invoice:failed', spy);

      const failed = engine.markInvoiceFailed(invoice.id);
      expect(failed.status).toBe('uncollectible');
      expect(spy).toHaveBeenCalledOnce();
    });

    it('should get invoices for a customer', () => {
      const c = engine.createCustomer({ email: 'invoices@test.com' });
      engine.createInvoice({
        customerId: c.id, amount: 7900,
        periodStart: '2026-01-01T00:00:00Z', periodEnd: '2026-02-01T00:00:00Z',
      });
      engine.createInvoice({
        customerId: c.id, amount: 7900,
        periodStart: '2026-02-01T00:00:00Z', periodEnd: '2026-03-01T00:00:00Z',
      });

      const invoices = engine.getInvoices(c.id);
      expect(invoices.length).toBe(2);
      // Most recent first
      expect(invoices[0].periodStart).toBe('2026-02-01T00:00:00Z');
    });

    it('should throw for nonexistent invoice operations', () => {
      expect(() => engine.markInvoicePaid('fake')).toThrow('not found');
      expect(() => engine.markInvoiceFailed('fake')).toThrow('not found');
    });
  });

  // ─── Checkout & Portal ──────────────────────────────────────

  describe('Checkout & Portal', () => {
    it('should create checkout session for paid plan', () => {
      const c = engine.createCustomer({ email: 'checkout@test.com' });
      const session = engine.createCheckoutSession(c.id, 'solo_store');
      expect(session.url).toContain('checkout');
      expect(session.url).toContain('solo_store');
      expect(session.sessionId).toBeDefined();
    });

    it('should auto-subscribe for free plan checkout', () => {
      const c = engine.createCustomer({ email: 'freeckout@test.com' });
      const session = engine.createCheckoutSession(c.id, 'free');
      expect(session.url).toContain('success');
      // Customer should now be subscribed
      const customer = engine.getCustomer(c.id);
      expect(customer!.planId).toBe('free');
      expect(customer!.subscriptionStatus).toBe('active');
    });

    it('should create portal session', () => {
      const c = engine.createCustomer({ email: 'portal@test.com' });
      const portal = engine.createPortalSession(c.id);
      expect(portal.url).toContain('portal');
      expect(portal.url).toContain(c.id);
    });

    it('should throw for nonexistent customer', () => {
      expect(() => engine.createCheckoutSession('fake', 'solo_store')).toThrow('not found');
      expect(() => engine.createPortalSession('fake')).toThrow('not found');
    });
  });

  // ─── Webhook Processing ─────────────────────────────────────

  describe('Webhook Processing', () => {
    it('should process subscription.created webhook', () => {
      const c = engine.createCustomer({
        email: 'wh@test.com',
        stripeCustomerId: 'cus_wh123',
      });

      const event = engine.processWebhook('customer.subscription.created', {
        id: 'sub_123',
        customer: 'cus_wh123',
        status: 'active',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      });

      expect(event.processed).toBe(true);
      const customer = engine.getCustomer(c.id);
      expect(customer!.subscriptionStatus).toBe('active');
      expect(customer!.stripeSubscriptionId).toBe('sub_123');
    });

    it('should process subscription.deleted webhook', () => {
      const c = engine.createCustomer({
        email: 'whdel@test.com',
        stripeCustomerId: 'cus_whdel',
      });
      engine.startSubscription(c.id, { planId: 'solo_store', trialDays: 0 });

      const spy = vi.fn();
      engine.on('subscription:canceled', spy);

      engine.processWebhook('customer.subscription.deleted', {
        customer: 'cus_whdel',
      });

      const customer = engine.getCustomer(c.id);
      expect(customer!.subscriptionStatus).toBe('canceled');
      expect(spy).toHaveBeenCalled();
    });

    it('should process invoice.paid webhook', () => {
      const c = engine.createCustomer({
        email: 'whpaid@test.com',
        stripeCustomerId: 'cus_whpaid',
      });
      // Set to past_due first
      engine.startSubscription(c.id, { planId: 'solo_store', trialDays: 0 });
      const customer = engine.getCustomer(c.id)!;
      customer.subscriptionStatus = 'past_due';

      engine.processWebhook('invoice.paid', {
        id: 'in_123',
        customer: 'cus_whpaid',
        amount_paid: 7900,
        period_start: Math.floor(Date.now() / 1000),
        period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      });

      // Should restore to active
      expect(engine.getCustomer(c.id)!.subscriptionStatus).toBe('active');
    });

    it('should process invoice.payment_failed webhook', () => {
      const c = engine.createCustomer({
        email: 'whfail@test.com',
        stripeCustomerId: 'cus_whfail',
      });
      engine.startSubscription(c.id, { planId: 'solo_store', trialDays: 0 });

      const spy = vi.fn();
      engine.on('subscription:past_due', spy);

      engine.processWebhook('invoice.payment_failed', {
        customer: 'cus_whfail',
      });

      expect(engine.getCustomer(c.id)!.subscriptionStatus).toBe('past_due');
      expect(spy).toHaveBeenCalled();
    });

    it('should process trial_will_end webhook', () => {
      const c = engine.createCustomer({
        email: 'whtrial@test.com',
        stripeCustomerId: 'cus_whtrial',
      });
      engine.startSubscription(c.id, { planId: 'solo_store' });

      const spy = vi.fn();
      engine.on('subscription:trial_ending', spy);

      const trialEnd = Math.floor(Date.now() / 1000) + 3 * 86400; // 3 days
      engine.processWebhook('customer.subscription.trial_will_end', {
        customer: 'cus_whtrial',
        trial_end: trialEnd,
      });

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][1]).toBeLessThanOrEqual(4); // ~3 days
    });

    it('should emit webhook events', () => {
      const received = vi.fn();
      const processed = vi.fn();
      engine.on('webhook:received', received);
      engine.on('webhook:processed', processed);

      engine.processWebhook('customer.created', { id: 'cus_new' });

      expect(received).toHaveBeenCalledOnce();
      expect(processed).toHaveBeenCalledOnce();
    });

    it('should handle unknown stripe customer gracefully', () => {
      const event = engine.processWebhook('customer.subscription.created', {
        customer: 'cus_unknown',
        status: 'active',
      });
      // Should still process without error
      expect(event.processed).toBe(true);
    });

    it('should trim old webhook events', () => {
      const smallEngine = new BillingEngine({ maxWebhookEvents: 10 });
      for (let i = 0; i < 15; i++) {
        smallEngine.processWebhook('customer.created', { id: `cus_${i}` });
      }
      // Should be trimmed to 75% of max
      const stats = smallEngine.getStats();
      expect(stats.webhookEventsProcessed).toBeLessThanOrEqual(10);
    });
  });

  // ─── Revenue Calculations ──────────────────────────────────

  describe('Revenue Calculations', () => {
    it('should calculate MRR', () => {
      const c1 = engine.createCustomer({ email: 'mrr1@test.com' });
      const c2 = engine.createCustomer({ email: 'mrr2@test.com' });
      engine.startSubscription(c1.id, { planId: 'solo_store', trialDays: 0 });
      engine.startSubscription(c2.id, { planId: 'multi_store', trialDays: 0 });

      const mrr = engine.calculateMRR();
      expect(mrr).toBe(7900 + 19900);
    });

    it('should prorate yearly subscriptions in MRR', () => {
      const c = engine.createCustomer({ email: 'yearly@test.com' });
      engine.startSubscription(c.id, {
        planId: 'solo_store',
        billingInterval: 'yearly',
        trialDays: 0,
      });

      const mrr = engine.calculateMRR();
      expect(mrr).toBe(Math.round(79000 / 12)); // yearly / 12
    });

    it('should exclude canceled subscriptions from MRR', () => {
      const c = engine.createCustomer({ email: 'nomrr@test.com' });
      engine.startSubscription(c.id, { planId: 'solo_store', trialDays: 0 });
      engine.cancelSubscription(c.id);

      expect(engine.calculateMRR()).toBe(0);
    });

    it('should include trialing subscriptions in MRR', () => {
      const c = engine.createCustomer({ email: 'trialmrr@test.com' });
      engine.startSubscription(c.id, { planId: 'enterprise' }); // has trial
      expect(engine.getCustomer(c.id)!.subscriptionStatus).toBe('trialing');
      expect(engine.calculateMRR()).toBe(49900);
    });

    it('should calculate ARR', () => {
      const c = engine.createCustomer({ email: 'arr@test.com' });
      engine.startSubscription(c.id, { planId: 'solo_store', trialDays: 0 });
      expect(engine.calculateARR()).toBe(7900 * 12);
    });

    it('should calculate total revenue from paid invoices', () => {
      const c = engine.createCustomer({ email: 'rev@test.com' });
      const inv1 = engine.createInvoice({
        customerId: c.id, amount: 7900,
        periodStart: '2026-01-01', periodEnd: '2026-02-01',
      });
      const inv2 = engine.createInvoice({
        customerId: c.id, amount: 7900,
        periodStart: '2026-02-01', periodEnd: '2026-03-01',
      });
      engine.markInvoicePaid(inv1.id);
      engine.markInvoicePaid(inv2.id);

      expect(engine.calculateTotalRevenue()).toBe(15800);
    });

    it('should exclude unpaid invoices from total revenue', () => {
      const c = engine.createCustomer({ email: 'unpaid@test.com' });
      engine.createInvoice({
        customerId: c.id, amount: 7900,
        periodStart: '2026-01-01', periodEnd: '2026-02-01',
      });
      expect(engine.calculateTotalRevenue()).toBe(0);
    });

    it('should calculate churn rate', () => {
      const c1 = engine.createCustomer({ email: 'churn1@test.com' });
      const c2 = engine.createCustomer({ email: 'churn2@test.com' });
      const c3 = engine.createCustomer({ email: 'churn3@test.com' });
      engine.startSubscription(c1.id, { planId: 'solo_store', trialDays: 0 });
      engine.startSubscription(c2.id, { planId: 'solo_store', trialDays: 0 });
      engine.startSubscription(c3.id, { planId: 'solo_store', trialDays: 0 });

      engine.cancelSubscription(c3.id); // 1 of 3 = 33% churn

      const churn = engine.calculateChurnRate();
      expect(churn).toBeCloseTo(1 / 3, 1);
    });

    it('should return 0 churn when no customers', () => {
      expect(engine.calculateChurnRate()).toBe(0);
    });

    it('should calculate ARPU', () => {
      const c1 = engine.createCustomer({ email: 'arpu1@test.com' });
      const c2 = engine.createCustomer({ email: 'arpu2@test.com' });
      engine.startSubscription(c1.id, { planId: 'solo_store', trialDays: 0 });
      engine.startSubscription(c2.id, { planId: 'multi_store', trialDays: 0 });

      const arpu = engine.calculateARPU();
      expect(arpu).toBe(Math.round((7900 + 19900) / 2));
    });
  });

  // ─── Statistics ─────────────────────────────────────────────

  describe('Statistics', () => {
    it('should return comprehensive stats', () => {
      const c1 = engine.createCustomer({ email: 'stats1@test.com' });
      const c2 = engine.createCustomer({ email: 'stats2@test.com' });
      const c3 = engine.createCustomer({ email: 'stats3@test.com' });
      engine.startSubscription(c1.id, { planId: 'solo_store', trialDays: 0 });
      engine.startSubscription(c2.id, { planId: 'enterprise' }); // trialing
      engine.startSubscription(c3.id, { planId: 'solo_store', trialDays: 0 });
      engine.cancelSubscription(c3.id);

      const stats = engine.getStats();
      expect(stats.totalCustomers).toBe(3);
      expect(stats.activeSubscriptions).toBe(1);
      expect(stats.trialingCustomers).toBe(1);
      expect(stats.canceledCustomers).toBe(1);
      expect(stats.mrr).toBe(7900 + 49900);
      expect(stats.planDistribution.solo_store).toBe(2);
      expect(stats.planDistribution.enterprise).toBe(1);
    });
  });

  // ─── Pricing Display ───────────────────────────────────────

  describe('Pricing Display', () => {
    it('should generate pricing display data', () => {
      const display = engine.getPricingDisplay();
      expect(display.length).toBeGreaterThanOrEqual(4);

      const solo = display.find(d => d.id === 'solo_store');
      expect(solo).toBeDefined();
      expect(solo!.monthlyPrice).toBe(79);
      expect(solo!.yearlyPrice).toBe(790);
      expect(solo!.popular).toBe(true);
      expect(solo!.highlights.length).toBeGreaterThan(0);
      expect(solo!.cta).toContain('Trial');
    });

    it('should show savings for yearly billing', () => {
      const display = engine.getPricingDisplay();
      const solo = display.find(d => d.id === 'solo_store')!;
      expect(solo.yearlySavings).toBeGreaterThan(0);
    });

    it('should show per-item pricing for pay_per_count', () => {
      const display = engine.getPricingDisplay();
      const ppc = display.find(d => d.id === 'pay_per_count')!;
      expect(ppc.highlights.some(h => h.includes('$0.02/item'))).toBe(true);
    });

    it('should mark solo_store as popular', () => {
      const display = engine.getPricingDisplay();
      const popular = display.filter(d => d.popular);
      expect(popular.length).toBe(1);
      expect(popular[0].id).toBe('solo_store');
    });
  });

  // ─── Reset ──────────────────────────────────────────────────

  describe('Reset', () => {
    it('should reset all data', () => {
      engine.createCustomer({ email: 'reset@test.com' });
      engine.reset();
      expect(engine.listCustomers().total).toBe(0);
      expect(engine.getStats().totalCustomers).toBe(0);
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle default config', () => {
      const defaultEngine = new BillingEngine();
      expect(defaultEngine.getPlans().length).toBeGreaterThanOrEqual(5);
    });

    it('should handle multiple plan changes', () => {
      const c = engine.createCustomer({ email: 'multi@test.com' });
      engine.startSubscription(c.id, { planId: 'free' });
      engine.changePlan(c.id, 'solo_store');
      engine.changePlan(c.id, 'multi_store');
      engine.changePlan(c.id, 'enterprise');

      expect(engine.getCustomer(c.id)!.planId).toBe('enterprise');
    });

    it('should handle cancel and restart cycle', () => {
      const c = engine.createCustomer({ email: 'cycle@test.com' });
      engine.startSubscription(c.id, { planId: 'solo_store', trialDays: 0 });
      engine.cancelSubscription(c.id);
      engine.reactivateSubscription(c.id);
      expect(engine.getCustomer(c.id)!.subscriptionStatus).toBe('active');

      engine.cancelSubscription(c.id);
      expect(engine.getCustomer(c.id)!.subscriptionStatus).toBe('canceled');
    });

    it('should handle concurrent customer creation', () => {
      const customers = [];
      for (let i = 0; i < 50; i++) {
        customers.push(engine.createCustomer({ email: `bulk${i}@test.com` }));
      }
      expect(engine.listCustomers().total).toBe(50);
      // All IDs should be unique
      const ids = new Set(customers.map(c => c.id));
      expect(ids.size).toBe(50);
    });

    it('should preserve metadata through operations', () => {
      const c = engine.createCustomer({
        email: 'meta@test.com',
        metadata: { source: 'landing_page' },
      });
      engine.startSubscription(c.id, { planId: 'solo_store', trialDays: 0 });
      engine.cancelSubscription(c.id, { reason: 'switching' });

      const customer = engine.getCustomer(c.id)!;
      expect(customer.metadata.source).toBe('landing_page');
      expect(customer.metadata._cancelReason).toBe('switching');
    });
  });
});
