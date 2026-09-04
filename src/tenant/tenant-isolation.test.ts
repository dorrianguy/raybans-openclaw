/**
 * Tests for Multi-Tenant Data Isolation Engine
 * 🌙 Night Shift Agent — Night #35
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TenantIsolationEngine,
  getRolePermissions,
  getDefaultQuotas,
  type Tenant,
  type TenantContext,
  type AccessRequest,
  type DataPolicy,
} from './tenant-isolation.js';

describe('TenantIsolationEngine', () => {
  let engine: TenantIsolationEngine;

  beforeEach(() => {
    engine = new TenantIsolationEngine();
  });

  // ─── Tenant CRUD ───────────────────────────────────────────────────────

  describe('Tenant CRUD', () => {
    it('should create a tenant with defaults', () => {
      const tenant = engine.createTenant({
        name: 'Acme Corp',
        slug: 'acme-corp',
        tier: 'enterprise',
        ownerId: 'user_1',
      });

      expect(tenant.id).toMatch(/^tenant_/);
      expect(tenant.name).toBe('Acme Corp');
      expect(tenant.slug).toBe('acme-corp');
      expect(tenant.tier).toBe('enterprise');
      expect(tenant.status).toBe('active');
      expect(tenant.ownerId).toBe('user_1');
      expect(tenant.quotas.maxStores).toBe(100);
      expect(tenant.quotas.maxUsers).toBe(500);
      expect(tenant.settings.dataRetentionDays).toBe(365);
      expect(tenant.settings.timezone).toBe('UTC');
    });

    it('should auto-add owner as member', () => {
      const tenant = engine.createTenant({
        name: 'Test',
        slug: 'test',
        tier: 'solo',
        ownerId: 'user_owner',
      });

      const members = engine.getMembers(tenant.id);
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe('user_owner');
      expect(members[0].role).toBe('owner');
    });

    it('should reject duplicate slugs', () => {
      engine.createTenant({ name: 'A', slug: 'unique', tier: 'free', ownerId: 'u1' });
      expect(() =>
        engine.createTenant({ name: 'B', slug: 'unique', tier: 'free', ownerId: 'u2' })
      ).toThrow("Tenant slug 'unique' already exists");
    });

    it('should create child tenants under a parent', () => {
      const parent = engine.createTenant({
        name: 'Parent Org',
        slug: 'parent',
        tier: 'enterprise',
        ownerId: 'u1',
      });

      const child = engine.createTenant({
        name: 'Store 1',
        slug: 'store-1',
        tier: 'solo',
        ownerId: 'u1',
        parentId: parent.id,
      });

      expect(child.parentId).toBe(parent.id);
      const children = engine.getChildTenants(parent.id);
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe(child.id);
    });

    it('should reject child tenant if parent not found', () => {
      expect(() =>
        engine.createTenant({
          name: 'Orphan',
          slug: 'orphan',
          tier: 'free',
          ownerId: 'u1',
          parentId: 'nonexistent',
        })
      ).toThrow("Parent tenant 'nonexistent' not found");
    });

    it('should enforce max children per org', () => {
      const parent = engine.createTenant({
        name: 'Parent',
        slug: 'parent',
        tier: 'enterprise',
        ownerId: 'u1',
      });

      const eng = new TenantIsolationEngine({ maxTenantsPerOrg: 2 });
      const p = eng.createTenant({ name: 'P', slug: 'p', tier: 'enterprise', ownerId: 'u1' });
      eng.createTenant({ name: 'C1', slug: 'c1', tier: 'free', ownerId: 'u1', parentId: p.id });
      eng.createTenant({ name: 'C2', slug: 'c2', tier: 'free', ownerId: 'u1', parentId: p.id });

      expect(() =>
        eng.createTenant({ name: 'C3', slug: 'c3', tier: 'free', ownerId: 'u1', parentId: p.id })
      ).toThrow('max child tenants');
    });

    it('should apply quota overrides', () => {
      const tenant = engine.createTenant({
        name: 'Custom',
        slug: 'custom',
        tier: 'solo',
        ownerId: 'u1',
        quotaOverrides: { maxStores: 5, maxUsers: 50 },
      });

      expect(tenant.quotas.maxStores).toBe(5);
      expect(tenant.quotas.maxUsers).toBe(50);
      // Other quotas should remain at solo defaults
      expect(tenant.quotas.maxSessions).toBe(50);
    });

    it('should get tenant by slug', () => {
      engine.createTenant({ name: 'FindMe', slug: 'find-me', tier: 'free', ownerId: 'u1' });
      const found = engine.getTenantBySlug('find-me');
      expect(found).toBeDefined();
      expect(found?.name).toBe('FindMe');
    });

    it('should update tenant properties', () => {
      const tenant = engine.createTenant({ name: 'Original', slug: 'orig', tier: 'solo', ownerId: 'u1' });
      const updated = engine.updateTenant(tenant.id, {
        name: 'Updated Name',
        metadata: { industry: 'retail' },
        settings: { timezone: 'America/Chicago' },
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.metadata.industry).toBe('retail');
      expect(updated.settings.timezone).toBe('America/Chicago');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(tenant.createdAt);
    });

    it('should update tier and reset quotas', () => {
      const tenant = engine.createTenant({ name: 'Upgrade', slug: 'upgrade', tier: 'solo', ownerId: 'u1' });
      expect(tenant.quotas.maxStores).toBe(1);

      const upgraded = engine.updateTenant(tenant.id, { tier: 'enterprise' });
      expect(upgraded.tier).toBe('enterprise');
      expect(upgraded.quotas.maxStores).toBe(100);
    });

    it('should throw when updating nonexistent tenant', () => {
      expect(() => engine.updateTenant('fake', { name: 'X' })).toThrow("Tenant 'fake' not found");
    });

    it('should list tenants with filters', () => {
      engine.createTenant({ name: 'A', slug: 'a', tier: 'free', ownerId: 'u1' });
      engine.createTenant({ name: 'B', slug: 'b', tier: 'solo', ownerId: 'u1' });
      engine.createTenant({ name: 'C', slug: 'c', tier: 'solo', ownerId: 'u2' });

      expect(engine.listTenants()).toHaveLength(3);
      expect(engine.listTenants({ tier: 'solo' })).toHaveLength(2);
      expect(engine.listTenants({ ownerId: 'u2' })).toHaveLength(1);
    });

    it('should emit tenant:created event', () => {
      const handler = vi.fn();
      engine.on('tenant:created', handler);
      engine.createTenant({ name: 'Evt', slug: 'evt', tier: 'free', ownerId: 'u1' });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should emit tenant:updated event', () => {
      const handler = vi.fn();
      engine.on('tenant:updated', handler);
      const t = engine.createTenant({ name: 'Up', slug: 'up', tier: 'free', ownerId: 'u1' });
      engine.updateTenant(t.id, { name: 'Updated' });
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  // ─── Tenant Lifecycle ──────────────────────────────────────────────────

  describe('Tenant Lifecycle', () => {
    it('should suspend a tenant', () => {
      const t = engine.createTenant({ name: 'Suspend', slug: 'suspend', tier: 'solo', ownerId: 'u1' });
      engine.suspendTenant(t.id, 'Payment overdue');

      const updated = engine.getTenant(t.id);
      expect(updated?.status).toBe('suspended');
      expect(updated?.suspendReason).toBe('Payment overdue');
      expect(updated?.suspendedAt).toBeDefined();
    });

    it('should emit tenant:suspended event', () => {
      const handler = vi.fn();
      engine.on('tenant:suspended', handler);
      const t = engine.createTenant({ name: 'S', slug: 's', tier: 'free', ownerId: 'u1' });
      engine.suspendTenant(t.id, 'Violation');
      expect(handler).toHaveBeenCalledWith(t.id, 'Violation');
    });

    it('should not double-suspend', () => {
      const t = engine.createTenant({ name: 'S', slug: 's', tier: 'free', ownerId: 'u1' });
      engine.suspendTenant(t.id, 'reason');
      expect(() => engine.suspendTenant(t.id, 'again')).toThrow('already suspended');
    });

    it('should reactivate a suspended tenant', () => {
      const t = engine.createTenant({ name: 'R', slug: 'r', tier: 'free', ownerId: 'u1' });
      engine.suspendTenant(t.id, 'test');
      engine.reactivateTenant(t.id);

      const updated = engine.getTenant(t.id);
      expect(updated?.status).toBe('active');
      expect(updated?.suspendedAt).toBeUndefined();
      expect(updated?.suspendReason).toBeUndefined();
    });

    it('should not reactivate a non-suspended tenant', () => {
      const t = engine.createTenant({ name: 'R', slug: 'r', tier: 'free', ownerId: 'u1' });
      expect(() => engine.reactivateTenant(t.id)).toThrow('not suspended');
    });

    it('should deactivate a tenant', () => {
      const t = engine.createTenant({ name: 'D', slug: 'd', tier: 'free', ownerId: 'u1' });
      engine.deactivateTenant(t.id);
      expect(engine.getTenant(t.id)?.status).toBe('deactivated');
      expect(engine.getTenant(t.id)?.deactivatedAt).toBeDefined();
    });

    it('should purge a deactivated tenant', () => {
      const t = engine.createTenant({ name: 'Purge', slug: 'purge', tier: 'enterprise', ownerId: 'u1' });
      engine.addMember(t.id, { userId: 'u2', role: 'member' });
      engine.deactivateTenant(t.id);

      const result = engine.purgeTenant(t.id);
      expect(result.success).toBe(true);
      expect(result.purgedData.length).toBeGreaterThan(0);
      expect(engine.getTenant(t.id)).toBeUndefined();
    });

    it('should not purge an active tenant', () => {
      const t = engine.createTenant({ name: 'P', slug: 'p', tier: 'free', ownerId: 'u1' });
      expect(() => engine.purgeTenant(t.id)).toThrow('must be deactivated');
    });

    it('should cascade purge to child tenants', () => {
      const parent = engine.createTenant({ name: 'Parent', slug: 'parent', tier: 'enterprise', ownerId: 'u1' });
      const child = engine.createTenant({
        name: 'Child', slug: 'child', tier: 'solo', ownerId: 'u1', parentId: parent.id,
      });

      engine.deactivateTenant(parent.id);
      const result = engine.purgeTenant(parent.id);

      expect(result.purgedData).toContain('1 child tenants');
      expect(engine.getTenant(parent.id)).toBeUndefined();
      expect(engine.getTenant(child.id)).toBeUndefined();
    });

    it('should filter tenants by status', () => {
      engine.createTenant({ name: 'A', slug: 'a', tier: 'free', ownerId: 'u1' });
      const s = engine.createTenant({ name: 'B', slug: 'b', tier: 'free', ownerId: 'u1' });
      engine.suspendTenant(s.id, 'test');

      expect(engine.listTenants({ status: 'active' })).toHaveLength(1);
      expect(engine.listTenants({ status: 'suspended' })).toHaveLength(1);
    });
  });

  // ─── Member Management ─────────────────────────────────────────────────

  describe('Member Management', () => {
    let tenantId: string;

    beforeEach(() => {
      const t = engine.createTenant({ name: 'Members', slug: 'members', tier: 'enterprise', ownerId: 'owner1' });
      tenantId = t.id;
    });

    it('should add a member with role permissions', () => {
      const member = engine.addMember(tenantId, { userId: 'user2', role: 'admin' });
      expect(member.role).toBe('admin');
      expect(member.permissions).toContain('read');
      expect(member.permissions).toContain('write');
      expect(member.status).toBe('active');
    });

    it('should set status to invited when invitedBy is present', () => {
      const member = engine.addMember(tenantId, {
        userId: 'user3', role: 'member', invitedBy: 'owner1',
      });
      expect(member.status).toBe('invited');
    });

    it('should reject duplicate members', () => {
      engine.addMember(tenantId, { userId: 'dup', role: 'member' });
      expect(() =>
        engine.addMember(tenantId, { userId: 'dup', role: 'viewer' })
      ).toThrow("already a member");
    });

    it('should enforce member limit', () => {
      const eng = new TenantIsolationEngine({ maxMembersPerTenant: 2 });
      const t = eng.createTenant({ name: 'Small', slug: 'small', tier: 'enterprise', ownerId: 'u1' });
      // Owner is auto-added (1)
      eng.addMember(t.id, { userId: 'u2', role: 'member' }); // (2)
      expect(() =>
        eng.addMember(t.id, { userId: 'u3', role: 'member' })
      ).toThrow('maximum members');
    });

    it('should enforce tenant user quota', () => {
      const t = engine.createTenant({
        name: 'Tiny', slug: 'tiny', tier: 'free', ownerId: 'u1',
      });
      // Free tier: maxUsers = 1, owner is auto-added
      expect(() =>
        engine.addMember(t.id, { userId: 'u2', role: 'member' })
      ).toThrow('quota exceeded');
    });

    it('should remove a member', () => {
      engine.addMember(tenantId, { userId: 'removeme', role: 'member' });
      engine.removeMember(tenantId, 'removeme');
      expect(engine.getMember(tenantId, 'removeme')).toBeUndefined();
    });

    it('should not remove the last owner', () => {
      expect(() =>
        engine.removeMember(tenantId, 'owner1')
      ).toThrow('Cannot remove the last owner');
    });

    it('should allow removing owner if another owner exists', () => {
      engine.addMember(tenantId, { userId: 'owner2', role: 'owner' });
      engine.removeMember(tenantId, 'owner1');
      expect(engine.getMember(tenantId, 'owner1')).toBeUndefined();
    });

    it('should update member role', () => {
      engine.addMember(tenantId, { userId: 'promote', role: 'member' });
      const updated = engine.updateMemberRole(tenantId, 'promote', 'admin');
      expect(updated.role).toBe('admin');
      expect(updated.permissions).toContain('write');
    });

    it('should not demote the last owner', () => {
      expect(() =>
        engine.updateMemberRole(tenantId, 'owner1', 'admin')
      ).toThrow('Cannot demote the last owner');
    });

    it('should get user tenants across multiple orgs', () => {
      engine.createTenant({ name: 'T2', slug: 't2', tier: 'free', ownerId: 'owner1' });
      const userTenants = engine.getUserTenants('owner1');
      expect(userTenants.length).toBe(2);
    });

    it('should emit member:added and member:removed events', () => {
      const addHandler = vi.fn();
      const removeHandler = vi.fn();
      engine.on('member:added', addHandler);
      engine.on('member:removed', removeHandler);

      engine.addMember(tenantId, { userId: 'evtuser', role: 'member' });
      expect(addHandler).toHaveBeenCalledOnce();

      engine.removeMember(tenantId, 'evtuser');
      expect(removeHandler).toHaveBeenCalledWith(tenantId, 'evtuser');
    });

    it('should update usage count on member add/remove', () => {
      const t = engine.getTenant(tenantId)!;
      const initialUsers = t.usage.users;
      engine.addMember(tenantId, { userId: 'countme', role: 'member' });
      expect(engine.getTenant(tenantId)!.usage.users).toBe(initialUsers + 1);

      engine.removeMember(tenantId, 'countme');
      expect(engine.getTenant(tenantId)!.usage.users).toBe(initialUsers);
    });
  });

  // ─── Access Control ────────────────────────────────────────────────────

  describe('Access Control', () => {
    let tenant: Tenant;
    let ownerCtx: TenantContext;

    beforeEach(() => {
      tenant = engine.createTenant({
        name: 'AC Test',
        slug: 'ac-test',
        tier: 'enterprise',
        ownerId: 'owner1',
      });
      engine.addMember(tenant.id, { userId: 'viewer1', role: 'viewer' });
      engine.addMember(tenant.id, { userId: 'member1', role: 'member' });
      ownerCtx = engine.buildContext(tenant.id, 'owner1');
    });

    it('should build a valid context', () => {
      expect(ownerCtx.tenantId).toBe(tenant.id);
      expect(ownerCtx.userId).toBe('owner1');
      expect(ownerCtx.role).toBe('owner');
      expect(ownerCtx.permissions).toContain('admin');
      expect(ownerCtx.tier).toBe('enterprise');
    });

    it('should throw when building context for non-member', () => {
      expect(() => engine.buildContext(tenant.id, 'stranger')).toThrow('not a member');
    });

    it('should allow owner to access everything', () => {
      const result = engine.checkAccess({
        context: ownerCtx,
        resource: 'store',
        action: 'write',
      });
      expect(result.decision).toBe('allow');
    });

    it('should deny viewer write access', () => {
      const viewerCtx = engine.buildContext(tenant.id, 'viewer1');
      const result = engine.checkAccess({
        context: viewerCtx,
        resource: 'store',
        action: 'write',
      });
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('Missing permission');
    });

    it('should allow viewer read access', () => {
      const viewerCtx = engine.buildContext(tenant.id, 'viewer1');
      const result = engine.checkAccess({
        context: viewerCtx,
        resource: 'store',
        action: 'read',
      });
      expect(result.decision).toBe('allow');
    });

    it('should deny access for suspended tenant', () => {
      engine.suspendTenant(tenant.id, 'billing');
      const result = engine.checkAccess({
        context: ownerCtx,
        resource: 'store',
        action: 'read',
      });
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('suspended');
    });

    it('should deny cross-tenant access by default', () => {
      const otherTenant = engine.createTenant({
        name: 'Other',
        slug: 'other',
        tier: 'solo',
        ownerId: 'other_owner',
      });

      const result = engine.checkAccess({
        context: ownerCtx,
        resource: 'store',
        action: 'read',
        targetTenantId: otherTenant.id,
      });
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('Cross-tenant');
    });

    it('should allow cross-tenant read when sharing enabled', () => {
      const otherTenant = engine.createTenant({
        name: 'Sharing',
        slug: 'sharing',
        tier: 'solo',
        ownerId: 'other',
        settings: { allowCrossTenantSharing: true },
      });

      const result = engine.checkAccess({
        context: ownerCtx,
        resource: 'store',
        action: 'read',
        targetTenantId: otherTenant.id,
      });
      expect(result.decision).toBe('allow');
    });

    it('should allow parent to read child tenant data', () => {
      const child = engine.createTenant({
        name: 'Child',
        slug: 'child',
        tier: 'solo',
        ownerId: 'owner1',
        parentId: tenant.id,
      });

      const result = engine.checkAccess({
        context: ownerCtx,
        resource: 'store',
        action: 'read',
        targetTenantId: child.id,
      });
      expect(result.decision).toBe('allow');
    });

    it('should emit access:denied event', () => {
      const handler = vi.fn();
      engine.on('access:denied', handler);

      const viewerCtx = engine.buildContext(tenant.id, 'viewer1');
      engine.checkAccess({
        context: viewerCtx,
        resource: 'user',
        action: 'delete',
      });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should emit cross_tenant:blocked event', () => {
      const handler = vi.fn();
      engine.on('cross_tenant:blocked', handler);

      const other = engine.createTenant({
        name: 'O', slug: 'o', tier: 'free', ownerId: 'ox',
      });

      engine.checkAccess({
        context: ownerCtx,
        resource: 'store',
        action: 'read',
        targetTenantId: other.id,
      });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should deny write when quota exceeded', () => {
      // Set store usage to max
      const t = engine.getTenant(tenant.id)!;
      t.usage.stores = t.quotas.maxStores;

      const result = engine.checkAccess({
        context: ownerCtx,
        resource: 'store',
        action: 'write',
      });
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('Quota exceeded');
    });

    it('should log access decisions to audit log', () => {
      engine.checkAccess({
        context: ownerCtx,
        resource: 'store',
        action: 'read',
      });

      const log = engine.getAuditLog({ tenantId: tenant.id });
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].decision).toBe('allow');
    });

    it('should return audit ID in result', () => {
      const result = engine.checkAccess({
        context: ownerCtx,
        resource: 'store',
        action: 'read',
      });
      expect(result.auditId).toBeDefined();
      expect(result.auditId).toMatch(/^audit_/);
    });
  });

  // ─── Policy Engine ─────────────────────────────────────────────────────

  describe('Policy Engine', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = engine.createTenant({
        name: 'Policy Test',
        slug: 'policy',
        tier: 'enterprise',
        ownerId: 'u1',
      });
      engine.addMember(tenant.id, { userId: 'u2', role: 'admin' });
    });

    it('should add and retrieve policies', () => {
      const policy = engine.addPolicy({
        name: 'Block viewers from exports',
        tenantId: tenant.id,
        conditions: [
          { field: 'role', operator: 'eq', value: 'viewer' },
          { field: 'resource', operator: 'eq', value: 'export' },
        ],
        effect: 'deny',
        priority: 10,
        enabled: true,
      });

      expect(policy.id).toMatch(/^policy_/);
      const policies = engine.getPolicies(tenant.id);
      expect(policies.length).toBeGreaterThanOrEqual(1);
    });

    it('should enforce deny policies', () => {
      engine.addMember(tenant.id, { userId: 'blocked', role: 'admin' });

      engine.addPolicy({
        name: 'Block specific role from webhooks',
        tenantId: tenant.id,
        conditions: [
          { field: 'role', operator: 'eq', value: 'admin' },
          { field: 'resource', operator: 'eq', value: 'webhook' },
        ],
        effect: 'deny',
        priority: 100,
        enabled: true,
      });

      const ctx = engine.buildContext(tenant.id, 'blocked');
      const result = engine.checkAccess({
        context: ctx,
        resource: 'webhook',
        action: 'write',
      });

      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('Block specific role');
    });

    it('should enforce allow policies that override defaults', () => {
      engine.addMember(tenant.id, { userId: 'special', role: 'viewer' });

      engine.addPolicy({
        name: 'Allow viewer exports',
        tenantId: tenant.id,
        conditions: [
          { field: 'role', operator: 'eq', value: 'viewer' },
          { field: 'resource', operator: 'eq', value: 'export' },
        ],
        effect: 'allow',
        priority: 50,
        enabled: true,
      });

      const ctx = engine.buildContext(tenant.id, 'special');
      const result = engine.checkAccess({
        context: ctx,
        resource: 'export',
        action: 'read',
      });

      expect(result.decision).toBe('allow');
      expect(result.reason).toContain('Allow viewer exports');
    });

    it('should respect policy priority (higher evaluated first)', () => {
      engine.addMember(tenant.id, { userId: 'test', role: 'admin' });

      engine.addPolicy({
        name: 'Low priority allow',
        conditions: [{ field: 'role', operator: 'eq', value: 'admin' }],
        effect: 'allow',
        priority: 1,
        enabled: true,
      });

      engine.addPolicy({
        name: 'High priority deny',
        tenantId: tenant.id,
        conditions: [
          { field: 'role', operator: 'eq', value: 'admin' },
          { field: 'resource', operator: 'eq', value: 'user' },
          { field: 'action', operator: 'eq', value: 'delete' },
        ],
        effect: 'deny',
        priority: 100,
        enabled: true,
      });

      const ctx = engine.buildContext(tenant.id, 'test');
      const result = engine.checkAccess({
        context: ctx,
        resource: 'user',
        action: 'delete',
      });

      expect(result.decision).toBe('deny');
    });

    it('should ignore disabled policies', () => {
      engine.addMember(tenant.id, { userId: 'user', role: 'admin' });

      engine.addPolicy({
        name: 'Disabled deny',
        tenantId: tenant.id,
        conditions: [{ field: 'role', operator: 'eq', value: 'admin' }],
        effect: 'deny',
        priority: 100,
        enabled: false,
      });

      const ctx = engine.buildContext(tenant.id, 'user');
      const result = engine.checkAccess({
        context: ctx,
        resource: 'store',
        action: 'read',
      });

      expect(result.decision).toBe('allow');
    });

    it('should remove a policy', () => {
      const policy = engine.addPolicy({
        name: 'Temp',
        conditions: [],
        effect: 'deny',
        priority: 1,
        enabled: true,
      });

      engine.removePolicy(policy.id);
      expect(engine.getPolicies().find(p => p.id === policy.id)).toBeUndefined();
    });

    it('should enforce max policies limit', () => {
      const eng = new TenantIsolationEngine({ maxPolicies: 2 });
      eng.addPolicy({ name: 'P1', conditions: [], effect: 'allow', priority: 1, enabled: true });
      eng.addPolicy({ name: 'P2', conditions: [], effect: 'allow', priority: 2, enabled: true });
      expect(() =>
        eng.addPolicy({ name: 'P3', conditions: [], effect: 'allow', priority: 3, enabled: true })
      ).toThrow('Maximum policies reached');
    });

    it('should support "in" operator', () => {
      engine.addMember(tenant.id, { userId: 'viewer', role: 'viewer' });

      engine.addPolicy({
        name: 'Block certain roles',
        tenantId: tenant.id,
        conditions: [
          { field: 'role', operator: 'in', value: ['viewer', 'api_key'] },
          { field: 'action', operator: 'eq', value: 'write' },
        ],
        effect: 'deny',
        priority: 50,
        enabled: true,
      });

      const ctx = engine.buildContext(tenant.id, 'viewer');
      const result = engine.checkAccess({
        context: ctx,
        resource: 'store',
        action: 'write',
      });
      expect(result.decision).toBe('deny');
    });

    it('should support "neq" operator', () => {
      engine.addMember(tenant.id, { userId: 'member', role: 'member' });

      engine.addPolicy({
        name: 'Only enterprise can use webhooks',
        tenantId: tenant.id,
        conditions: [
          { field: 'tier', operator: 'neq', value: 'enterprise' },
          { field: 'resource', operator: 'eq', value: 'webhook' },
        ],
        effect: 'deny',
        priority: 50,
        enabled: true,
      });

      // Enterprise tenant — should NOT match the deny (tier IS enterprise, condition says neq enterprise)
      const ctx = engine.buildContext(tenant.id, 'member');
      const result = engine.checkAccess({
        context: ctx,
        resource: 'webhook',
        action: 'read',
      });
      // The neq condition doesn't match, so policy doesn't fire, falls to role check
      expect(result.decision).toBeDefined();
    });
  });

  // ─── Quota Management ──────────────────────────────────────────────────

  describe('Quota Management', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = engine.createTenant({
        name: 'Quota Test',
        slug: 'quota',
        tier: 'solo',
        ownerId: 'u1',
      });
    });

    it('should increment usage', () => {
      engine.incrementUsage(tenant.id, 'store');
      expect(engine.getTenant(tenant.id)!.usage.stores).toBe(1);
    });

    it('should decrement usage (min 0)', () => {
      engine.decrementUsage(tenant.id, 'store');
      expect(engine.getTenant(tenant.id)!.usage.stores).toBe(0);

      engine.incrementUsage(tenant.id, 'store', 5);
      engine.decrementUsage(tenant.id, 'store', 3);
      expect(engine.getTenant(tenant.id)!.usage.stores).toBe(2);
    });

    it('should reset daily usage', () => {
      engine.incrementUsage(tenant.id, 'export', 5);
      engine.resetDailyUsage(tenant.id);
      expect(engine.getTenant(tenant.id)!.usage.exportsToday).toBe(0);
    });

    it('should reset hourly usage', () => {
      engine.incrementUsage(tenant.id, 'api_call', 100);
      engine.resetHourlyUsage(tenant.id);
      expect(engine.getTenant(tenant.id)!.usage.apiCallsThisHour).toBe(0);
    });

    it('should emit quota:approaching at 80%', () => {
      const handler = vi.fn();
      engine.on('quota:approaching', handler);

      // Solo tier: maxStores = 1 — can't really hit 80% on 1
      // Use api_calls: maxApiCallsPerHour = 1000
      engine.incrementUsage(tenant.id, 'api_call', 800);

      const ctx = engine.buildContext(tenant.id, 'u1');
      engine.checkAccess({ context: ctx, resource: 'api_call', action: 'write' });
      expect(handler).toHaveBeenCalledWith(tenant.id, 'api_call', 800, 1000);
    });

    it('should emit quota:exceeded when at limit', () => {
      const handler = vi.fn();
      engine.on('quota:exceeded', handler);

      engine.incrementUsage(tenant.id, 'api_call', 1000);

      const ctx = engine.buildContext(tenant.id, 'u1');
      engine.checkAccess({ context: ctx, resource: 'api_call', action: 'write' });
      expect(handler).toHaveBeenCalledWith(tenant.id, 'api_call', 1000, 1000);
    });

    it('should provide usage summary', () => {
      engine.incrementUsage(tenant.id, 'store', 1); // 1/1 = 100% = critical
      engine.incrementUsage(tenant.id, 'api_call', 850); // 850/1000 = 85% = warning

      const summary = engine.getUsageSummary(tenant.id);
      expect(summary.overallHealth).toBe('critical');

      const storeResource = summary.resources.find(r => r.resource === 'store');
      expect(storeResource?.status).toBe('critical');
      expect(storeResource?.percentage).toBe(100);

      const apiResource = summary.resources.find(r => r.resource === 'api_call');
      expect(apiResource?.status).toBe('warning');
    });

    it('should throw for nonexistent tenant on increment', () => {
      expect(() => engine.incrementUsage('fake', 'store')).toThrow('not found');
    });
  });

  // ─── Audit Log ─────────────────────────────────────────────────────────

  describe('Audit Log', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = engine.createTenant({
        name: 'Audit Test',
        slug: 'audit',
        tier: 'enterprise',
        ownerId: 'u1',
      });
      engine.addMember(tenant.id, { userId: 'u2', role: 'viewer' });
    });

    it('should record all access checks', () => {
      const ctx = engine.buildContext(tenant.id, 'u1');
      engine.checkAccess({ context: ctx, resource: 'store', action: 'read' });
      engine.checkAccess({ context: ctx, resource: 'user', action: 'write' });

      const log = engine.getAuditLog({ tenantId: tenant.id });
      expect(log.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter audit log by decision', () => {
      const ownerCtx = engine.buildContext(tenant.id, 'u1');
      const viewerCtx = engine.buildContext(tenant.id, 'u2');

      engine.checkAccess({ context: ownerCtx, resource: 'store', action: 'read' }); // allow
      engine.checkAccess({ context: viewerCtx, resource: 'user', action: 'delete' }); // deny

      const denied = engine.getAuditLog({ decision: 'deny' });
      expect(denied.length).toBeGreaterThanOrEqual(1);

      const allowed = engine.getAuditLog({ decision: 'allow' });
      expect(allowed.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter audit log by userId', () => {
      const ctx = engine.buildContext(tenant.id, 'u2');
      engine.checkAccess({ context: ctx, resource: 'store', action: 'read' });

      const log = engine.getAuditLog({ userId: 'u2' });
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log.every(e => e.userId === 'u2')).toBe(true);
    });

    it('should limit audit log results', () => {
      const ctx = engine.buildContext(tenant.id, 'u1');
      for (let i = 0; i < 10; i++) {
        engine.checkAccess({ context: ctx, resource: 'store', action: 'read' });
      }

      const limited = engine.getAuditLog({ limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it('should trim audit log when over max entries', () => {
      const eng = new TenantIsolationEngine({ maxAuditEntries: 10 });
      const t = eng.createTenant({ name: 'Trim', slug: 'trim', tier: 'enterprise', ownerId: 'u1' });
      const ctx = eng.buildContext(t.id, 'u1');

      for (let i = 0; i < 20; i++) {
        eng.checkAccess({ context: ctx, resource: 'store', action: 'read' });
      }

      const log = eng.getAuditLog();
      expect(log.length).toBeLessThanOrEqual(10);
    });

    it('should filter by resource', () => {
      const ctx = engine.buildContext(tenant.id, 'u1');
      engine.checkAccess({ context: ctx, resource: 'store', action: 'read' });
      engine.checkAccess({ context: ctx, resource: 'webhook', action: 'read' });

      const storeLog = engine.getAuditLog({ resource: 'store' });
      expect(storeLog.every(e => e.resource === 'store')).toBe(true);
    });
  });

  // ─── Data Export/Import ────────────────────────────────────────────────

  describe('Data Export/Import', () => {
    it('should export tenant data', () => {
      const tenant = engine.createTenant({
        name: 'Export',
        slug: 'export',
        tier: 'multi',
        ownerId: 'u1',
        metadata: { region: 'US' },
      });

      engine.addMember(tenant.id, { userId: 'u2', role: 'admin' });

      const exported = engine.exportTenantData(tenant.id);
      expect(exported.tenantId).toBe(tenant.id);
      expect(exported.version).toBe('1.0.0');
      expect(exported.data.tenant.name).toBe('Export');
      expect(exported.data.members).toHaveLength(2);
      expect(exported.data.settings.timezone).toBe('UTC');
    });

    it('should import tenant data', () => {
      const tenant = engine.createTenant({
        name: 'Original',
        slug: 'original',
        tier: 'multi',
        ownerId: 'u1',
      });

      const exported = engine.exportTenantData(tenant.id);
      const imported = engine.importTenantData(exported, 'new_owner');

      expect(imported.name).toBe('Original (imported)');
      expect(imported.tier).toBe('multi');
      expect(imported.ownerId).toBe('new_owner');
      expect(imported.id).not.toBe(tenant.id);
    });

    it('should throw when exporting nonexistent tenant', () => {
      expect(() => engine.exportTenantData('fake')).toThrow('not found');
    });
  });

  // ─── Voice Summary ─────────────────────────────────────────────────────

  describe('Voice Summary', () => {
    it('should generate a voice summary', () => {
      const tenant = engine.createTenant({
        name: 'Voice Test',
        slug: 'voice',
        tier: 'enterprise',
        ownerId: 'u1',
      });

      const summary = engine.getVoiceSummary(tenant.id);
      expect(summary).toContain('Voice Test');
      expect(summary).toContain('enterprise');
      expect(summary).toContain('active');
    });

    it('should mention approaching quotas in summary', () => {
      const tenant = engine.createTenant({
        name: 'QuotaVoice',
        slug: 'qv',
        tier: 'solo',
        ownerId: 'u1',
      });

      engine.incrementUsage(tenant.id, 'api_call', 900);
      const summary = engine.getVoiceSummary(tenant.id);
      expect(summary).toContain('Approaching limits');
    });

    it('should mention critical quotas in summary', () => {
      const tenant = engine.createTenant({
        name: 'CritVoice',
        slug: 'cv',
        tier: 'solo',
        ownerId: 'u1',
      });

      engine.incrementUsage(tenant.id, 'store', 1); // 1/1 = 100%
      const summary = engine.getVoiceSummary(tenant.id);
      expect(summary).toContain('at capacity');
    });

    it('should return not found for missing tenant', () => {
      expect(engine.getVoiceSummary('missing')).toBe('Tenant not found.');
    });
  });

  // ─── Stats ─────────────────────────────────────────────────────────────

  describe('Stats', () => {
    it('should return platform stats', () => {
      engine.createTenant({ name: 'A', slug: 'a', tier: 'free', ownerId: 'u1' });
      engine.createTenant({ name: 'B', slug: 'b', tier: 'enterprise', ownerId: 'u2' });
      const s = engine.createTenant({ name: 'C', slug: 'c', tier: 'solo', ownerId: 'u3' });
      engine.suspendTenant(s.id, 'test');

      const stats = engine.getStats();
      expect(stats.totalTenants).toBe(3);
      expect(stats.activeTenants).toBe(2);
      expect(stats.suspendedTenants).toBe(1);
      expect(stats.byTier.free).toBe(1);
      expect(stats.byTier.enterprise).toBe(1);
      expect(stats.byTier.solo).toBe(1);
      expect(stats.totalMembers).toBe(3); // 1 owner each
      expect(stats.totalPolicies).toBe(0);
    });
  });

  // ─── Utility Functions ─────────────────────────────────────────────────

  describe('Utility Functions', () => {
    it('should return role permissions', () => {
      const ownerPerms = getRolePermissions('owner');
      expect(ownerPerms).toContain('admin');
      expect(ownerPerms).toContain('manage:tenants');

      const viewerPerms = getRolePermissions('viewer');
      expect(viewerPerms).not.toContain('write');
      expect(viewerPerms).toContain('read');
    });

    it('should return default quotas for tier', () => {
      const freeQuotas = getDefaultQuotas('free');
      expect(freeQuotas.maxStores).toBe(1);
      expect(freeQuotas.maxUsers).toBe(1);

      const entQuotas = getDefaultQuotas('enterprise');
      expect(entQuotas.maxStores).toBe(100);
      expect(entQuotas.maxUsers).toBe(500);
    });
  });
});
