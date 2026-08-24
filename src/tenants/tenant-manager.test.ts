/**
 * Tests for Multi-Tenant Isolation System
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TenantManager,
  PLAN_LIMITS,
  ROLE_PERMISSIONS,
  DEFAULT_TENANT_CONFIG,
} from './tenant-manager.js';
import type {
  Tenant,
  TenantMember,
  TenantInvitation,
} from './tenant-manager.js';

describe('TenantManager', () => {
  let manager: TenantManager;

  beforeEach(() => {
    manager = new TenantManager();
  });

  describe('Tenant CRUD', () => {
    it('creates a tenant', () => {
      const tenant = manager.createTenant({
        name: 'Acme Corp',
        ownerId: 'user1',
        contactEmail: 'admin@acme.com',
      });

      expect(tenant.id).toBeTruthy();
      expect(tenant.name).toBe('Acme Corp');
      expect(tenant.slug).toBe('acme-corp');
      expect(tenant.status).toBe('active'); // free plan = active
      expect(tenant.plan).toBe('free');
      expect(tenant.ownerId).toBe('user1');
    });

    it('creates tenant with trial status on paid plan', () => {
      const tenant = manager.createTenant({
        name: 'Premium Co',
        ownerId: 'user1',
        contactEmail: 'admin@premium.com',
        plan: 'team',
      });

      expect(tenant.status).toBe('trial');
      expect(tenant.trialEndsAt).toBeTruthy();
    });

    it('auto-adds owner as member', () => {
      const tenant = manager.createTenant({
        name: 'Test',
        ownerId: 'user1',
        contactEmail: 'test@test.com',
      });

      const members = manager.getMembers(tenant.id);
      expect(members.length).toBe(1);
      expect(members[0].role).toBe('owner');
      expect(members[0].userId).toBe('user1');
    });

    it('generates unique slugs', () => {
      const t1 = manager.createTenant({ name: 'Test', ownerId: 'u1', contactEmail: 'a@a.com' });
      const t2 = manager.createTenant({ name: 'Test', ownerId: 'u2', contactEmail: 'b@b.com' });

      expect(t1.slug).toBe('test');
      expect(t2.slug).toBe('test-1');
    });

    it('retrieves tenant by ID', () => {
      const created = manager.createTenant({ name: 'Find Me', ownerId: 'u1', contactEmail: 'a@a.com' });
      const found = manager.getTenant(created.id);
      expect(found).toBeTruthy();
      expect(found!.name).toBe('Find Me');
    });

    it('retrieves tenant by slug', () => {
      manager.createTenant({ name: 'Slug Test', ownerId: 'u1', contactEmail: 'a@a.com' });
      const found = manager.getTenantBySlug('slug-test');
      expect(found).toBeTruthy();
      expect(found!.name).toBe('Slug Test');
    });

    it('updates tenant', () => {
      const tenant = manager.createTenant({ name: 'Old', ownerId: 'u1', contactEmail: 'a@a.com' });
      const updated = manager.updateTenant(tenant.id, { name: 'New' });
      expect(updated.name).toBe('New');
      expect(updated.slug).toBe('new');
    });

    it('throws on updating non-existent tenant', () => {
      expect(() => manager.updateTenant('nope', { name: 'X' })).toThrow('Tenant not found');
    });

    it('updates tenant settings', () => {
      const tenant = manager.createTenant({ name: 'Test', ownerId: 'u1', contactEmail: 'a@a.com' });
      const updated = manager.updateTenantSettings(tenant.id, { timezone: 'Europe/London', requireMFA: true });
      expect(updated.settings.timezone).toBe('Europe/London');
      expect(updated.settings.requireMFA).toBe(true);
    });

    it('changes plan', () => {
      const tenant = manager.createTenant({ name: 'Upgrade Me', ownerId: 'u1', contactEmail: 'a@a.com' });
      const upgraded = manager.changePlan(tenant.id, 'team');
      expect(upgraded.plan).toBe('team');
      expect(upgraded.limits.maxUsers).toBe(PLAN_LIMITS.team.maxUsers);
      expect(upgraded.status).toBe('trial'); // upgraded from free
    });

    it('suspends tenant', () => {
      const tenant = manager.createTenant({ name: 'Suspend', ownerId: 'u1', contactEmail: 'a@a.com' });
      const suspended = manager.suspendTenant(tenant.id, 'Unpaid');
      expect(suspended.status).toBe('suspended');
      expect(suspended.suspendedReason).toBe('Unpaid');
      expect(suspended.suspendedAt).toBeTruthy();
    });

    it('reactivates suspended tenant', () => {
      const tenant = manager.createTenant({ name: 'Reactivate', ownerId: 'u1', contactEmail: 'a@a.com' });
      manager.suspendTenant(tenant.id, 'Test');
      const reactivated = manager.reactivateTenant(tenant.id);
      expect(reactivated.status).toBe('active');
      expect(reactivated.suspendedReason).toBeUndefined();
    });

    it('throws when reactivating non-suspended tenant', () => {
      const tenant = manager.createTenant({ name: 'Test', ownerId: 'u1', contactEmail: 'a@a.com' });
      expect(() => manager.reactivateTenant(tenant.id)).toThrow('not suspended');
    });

    it('deletes tenant', () => {
      const tenant = manager.createTenant({ name: 'Delete Me', ownerId: 'u1', contactEmail: 'a@a.com' });
      expect(manager.deleteTenant(tenant.id)).toBe(true);
      expect(manager.getTenant(tenant.id)).toBeUndefined();
      expect(manager.getTenantBySlug('delete-me')).toBeUndefined();
    });

    it('returns false for deleting non-existent tenant', () => {
      expect(manager.deleteTenant('nope')).toBe(false);
    });

    it('prevents deleting tenant with children', () => {
      const parent = manager.createTenant({ name: 'Parent', ownerId: 'u1', contactEmail: 'a@a.com' });
      manager.createTenant({ name: 'Child', ownerId: 'u2', contactEmail: 'b@b.com', parentId: parent.id });

      expect(() => manager.deleteTenant(parent.id)).toThrow('child tenant');
    });

    it('enforces max tenants limit', () => {
      const mgr = new TenantManager({ maxTenants: 2 });
      mgr.createTenant({ name: 'A', ownerId: 'u1', contactEmail: 'a@a.com' });
      mgr.createTenant({ name: 'B', ownerId: 'u2', contactEmail: 'b@b.com' });
      expect(() => mgr.createTenant({ name: 'C', ownerId: 'u3', contactEmail: 'c@c.com' })).toThrow('Maximum tenant limit');
    });

    it('lists tenants with filters', () => {
      manager.createTenant({ name: 'Active', ownerId: 'u1', contactEmail: 'a@a.com' });
      const t2 = manager.createTenant({ name: 'Team', ownerId: 'u2', contactEmail: 'b@b.com', plan: 'team' });
      manager.suspendTenant(
        manager.createTenant({ name: 'Suspended', ownerId: 'u3', contactEmail: 'c@c.com' }).id,
        'Test'
      );

      expect(manager.listTenants().length).toBe(3);
      expect(manager.listTenants({ status: 'active' }).length).toBe(1);
      expect(manager.listTenants({ plan: 'team' }).length).toBe(1);
      expect(manager.listTenants({ search: 'active' }).length).toBe(1);
    });

    it('paginates tenant list', () => {
      for (let i = 0; i < 5; i++) {
        manager.createTenant({ name: `T${i}`, ownerId: `u${i}`, contactEmail: `${i}@a.com` });
      }

      expect(manager.listTenants({ limit: 2 }).length).toBe(2);
      expect(manager.listTenants({ offset: 3 }).length).toBe(2);
    });

    it('emits events on CRUD', () => {
      const created = vi.fn();
      const updated = vi.fn();
      const suspended = vi.fn();
      const reactivated = vi.fn();
      const deleted = vi.fn();

      manager.on('tenant:created', created);
      manager.on('tenant:updated', updated);
      manager.on('tenant:suspended', suspended);
      manager.on('tenant:reactivated', reactivated);
      manager.on('tenant:deleted', deleted);

      const tenant = manager.createTenant({ name: 'Events', ownerId: 'u1', contactEmail: 'a@a.com' });
      expect(created).toHaveBeenCalledOnce();

      manager.updateTenant(tenant.id, { name: 'Updated' });
      expect(updated).toHaveBeenCalled();

      manager.suspendTenant(tenant.id, 'Test');
      expect(suspended).toHaveBeenCalledOnce();

      manager.reactivateTenant(tenant.id);
      expect(reactivated).toHaveBeenCalledOnce();

      manager.deleteTenant(tenant.id);
      expect(deleted).toHaveBeenCalledWith(tenant.id);
    });
  });

  describe('Member Management', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = manager.createTenant({ name: 'Team', ownerId: 'owner1', contactEmail: 'a@a.com', plan: 'team' });
    });

    it('adds a member', () => {
      const member = manager.addMember(tenant.id, {
        userId: 'user2',
        email: 'user2@team.com',
        displayName: 'User Two',
        role: 'member',
      });

      expect(member.userId).toBe('user2');
      expect(member.role).toBe('member');
      expect(member.permissions).toEqual(ROLE_PERMISSIONS.member);
    });

    it('prevents duplicate members', () => {
      expect(() =>
        manager.addMember(tenant.id, {
          userId: 'owner1', // already added as owner
          email: 'dup@team.com',
          displayName: 'Dup',
          role: 'member',
        })
      ).toThrow('already a member');
    });

    it('enforces plan member limit', () => {
      // Free plan has maxUsers=1, but team plan has 10
      const freeTenant = manager.createTenant({ name: 'Free', ownerId: 'fu1', contactEmail: 'f@f.com' });
      // Owner is already member 1 of 1
      expect(() =>
        manager.addMember(freeTenant.id, {
          userId: 'fu2',
          email: 'x@x.com',
          displayName: 'X',
          role: 'member',
        })
      ).toThrow('Plan limit');
    });

    it('removes a member', () => {
      manager.addMember(tenant.id, { userId: 'user2', email: 'u@u.com', displayName: 'U', role: 'member' });
      expect(manager.removeMember(tenant.id, 'user2')).toBe(true);
      expect(manager.getMembers(tenant.id).length).toBe(1); // just owner
    });

    it('prevents removing the owner', () => {
      expect(() => manager.removeMember(tenant.id, 'owner1')).toThrow('Cannot remove the tenant owner');
    });

    it('returns false for removing non-member', () => {
      expect(manager.removeMember(tenant.id, 'nonexistent')).toBe(false);
    });

    it('changes member role', () => {
      manager.addMember(tenant.id, { userId: 'user2', email: 'u@u.com', displayName: 'U', role: 'member' });
      const updated = manager.changeMemberRole(tenant.id, 'user2', 'admin');
      expect(updated.role).toBe('admin');
      expect(updated.permissions).toEqual(ROLE_PERMISSIONS.admin);
    });

    it('prevents changing owner role', () => {
      expect(() => manager.changeMemberRole(tenant.id, 'owner1', 'admin')).toThrow('Cannot change owner role');
    });

    it('throws when changing role of non-member', () => {
      expect(() => manager.changeMemberRole(tenant.id, 'nobody', 'admin')).toThrow('Member not found');
    });

    it('gets specific member', () => {
      const member = manager.getMember(tenant.id, 'owner1');
      expect(member).toBeTruthy();
      expect(member!.role).toBe('owner');
    });

    it('emits member events', () => {
      const added = vi.fn();
      const removed = vi.fn();
      const roleChanged = vi.fn();

      manager.on('member:added', added);
      manager.on('member:removed', removed);
      manager.on('member:role_changed', roleChanged);

      manager.addMember(tenant.id, { userId: 'user2', email: 'u@u.com', displayName: 'U', role: 'member' });
      expect(added).toHaveBeenCalled();

      manager.changeMemberRole(tenant.id, 'user2', 'admin');
      expect(roleChanged).toHaveBeenCalledOnce();

      manager.removeMember(tenant.id, 'user2');
      expect(removed).toHaveBeenCalledOnce();
    });
  });

  describe('Invitations', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = manager.createTenant({ name: 'Invite', ownerId: 'owner1', contactEmail: 'a@a.com', plan: 'team' });
    });

    it('creates an invitation', () => {
      const inv = manager.inviteMember(tenant.id, {
        email: 'newuser@test.com',
        role: 'member',
        invitedBy: 'owner1',
      });

      expect(inv.id).toBeTruthy();
      expect(inv.email).toBe('newuser@test.com');
      expect(inv.role).toBe('member');
      expect(inv.status).toBe('pending');
      expect(inv.expiresAt).toBeGreaterThan(Date.now());
    });

    it('accepts an invitation', () => {
      const inv = manager.inviteMember(tenant.id, {
        email: 'new@test.com',
        role: 'member',
        invitedBy: 'owner1',
      });

      const member = manager.acceptInvitation(inv.id, 'newuser1', 'New User');
      expect(member.userId).toBe('newuser1');
      expect(member.role).toBe('member');

      // Check invitation status updated
      const updatedInv = manager.listInvitations(tenant.id, 'accepted')[0];
      expect(updatedInv.acceptedAt).toBeTruthy();
    });

    it('rejects expired invitation', () => {
      const inv = manager.inviteMember(tenant.id, {
        email: 'exp@test.com',
        role: 'member',
        invitedBy: 'owner1',
      });

      // Manually expire
      const stored = manager.listInvitations(tenant.id)[0];
      (stored as any).expiresAt = Date.now() - 1000;

      expect(() => manager.acceptInvitation(inv.id, 'user', 'User')).toThrow('expired');
    });

    it('revokes an invitation', () => {
      const inv = manager.inviteMember(tenant.id, {
        email: 'revoke@test.com',
        role: 'member',
        invitedBy: 'owner1',
      });

      expect(manager.revokeInvitation(inv.id)).toBe(true);
      expect(manager.listInvitations(tenant.id, 'pending').length).toBe(0);
    });

    it('lists invitations by status', () => {
      manager.inviteMember(tenant.id, { email: 'a@t.com', role: 'member', invitedBy: 'owner1' });
      const inv2 = manager.inviteMember(tenant.id, { email: 'b@t.com', role: 'admin', invitedBy: 'owner1' });
      manager.acceptInvitation(inv2.id, 'user2', 'User 2');

      expect(manager.listInvitations(tenant.id).length).toBe(2);
      expect(manager.listInvitations(tenant.id, 'pending').length).toBe(1);
      expect(manager.listInvitations(tenant.id, 'accepted').length).toBe(1);
    });

    it('emits invitation events', () => {
      const sent = vi.fn();
      const accepted = vi.fn();

      manager.on('invitation:sent', sent);
      manager.on('invitation:accepted', accepted);

      const inv = manager.inviteMember(tenant.id, { email: 'e@t.com', role: 'member', invitedBy: 'owner1' });
      expect(sent).toHaveBeenCalledOnce();

      manager.acceptInvitation(inv.id, 'newuser', 'New');
      expect(accepted).toHaveBeenCalledOnce();
    });

    it('throws for non-existent invitation', () => {
      expect(() => manager.acceptInvitation('nope', 'u', 'U')).toThrow('Invitation not found');
    });

    it('returns false for revoking non-existent invitation', () => {
      expect(manager.revokeInvitation('nope')).toBe(false);
    });
  });

  describe('Authorization', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = manager.createTenant({ name: 'Auth', ownerId: 'owner1', contactEmail: 'a@a.com', plan: 'team' });
      manager.addMember(tenant.id, { userId: 'viewer1', email: 'v@v.com', displayName: 'V', role: 'viewer' });
    });

    it('owner has all permissions', () => {
      expect(manager.hasPermission(tenant.id, 'owner1', 'tenant:manage')).toBe(true);
      expect(manager.hasPermission(tenant.id, 'owner1', 'tenant:delete')).toBe(true);
      expect(manager.hasPermission(tenant.id, 'owner1', 'members:manage')).toBe(true);
    });

    it('viewer has limited permissions', () => {
      expect(manager.hasPermission(tenant.id, 'viewer1', 'sessions:view')).toBe(true);
      expect(manager.hasPermission(tenant.id, 'viewer1', 'sessions:create')).toBe(false);
      expect(manager.hasPermission(tenant.id, 'viewer1', 'tenant:manage')).toBe(false);
    });

    it('returns false for non-member', () => {
      expect(manager.hasPermission(tenant.id, 'nobody', 'sessions:view')).toBe(false);
    });

    it('checkPermission throws on denied', () => {
      expect(() => manager.checkPermission(tenant.id, 'viewer1', 'tenant:delete'))
        .toThrow('Permission denied');
    });

    it('checkPermission passes on allowed', () => {
      expect(() => manager.checkPermission(tenant.id, 'owner1', 'tenant:manage')).not.toThrow();
    });
  });

  describe('Usage Tracking', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = manager.createTenant({ name: 'Usage', ownerId: 'u1', contactEmail: 'a@a.com' });
    });

    it('tracks usage metrics', () => {
      manager.trackUsage(tenant.id, 'imagesCaptured', 5);
      manager.trackUsage(tenant.id, 'agentInvocations', 10);

      const usage = manager.getUsage(tenant.id);
      expect(usage).toBeTruthy();
      expect(usage!.imagesCaptured).toBe(5);
      expect(usage!.agentInvocations).toBe(10);
    });

    it('updates lastActiveAt on usage', () => {
      const before = Date.now();
      manager.trackUsage(tenant.id, 'voiceCommands');
      const usage = manager.getUsage(tenant.id);
      expect(usage!.lastActiveAt).toBeGreaterThanOrEqual(before);
    });

    it('emits limit warning at 80%', () => {
      const approaching = vi.fn();
      manager.on('limit:approaching', approaching);

      // Free plan has maxSessionsPerMonth = 5
      // Track 4 sessions (80%)
      for (let i = 0; i < 4; i++) {
        manager.trackUsage(tenant.id, 'sessionsThisMonth');
      }

      expect(approaching).toHaveBeenCalled();
    });

    it('emits limit exceeded at 100%', () => {
      const exceeded = vi.fn();
      manager.on('limit:exceeded', exceeded);

      // Free plan has maxSessionsPerMonth = 5
      for (let i = 0; i < 5; i++) {
        manager.trackUsage(tenant.id, 'sessionsThisMonth');
      }

      expect(exceeded).toHaveBeenCalled();
    });

    it('resets monthly usage', () => {
      manager.trackUsage(tenant.id, 'sessionsThisMonth', 10);
      manager.resetMonthlyUsage(tenant.id);

      const usage = manager.getUsage(tenant.id);
      expect(usage!.sessionsThisMonth).toBe(0);
    });

    it('throws for non-existent tenant', () => {
      expect(() => manager.trackUsage('nope', 'apiCalls')).toThrow('Tenant not found');
    });
  });

  describe('Feature Flags', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = manager.createTenant({ name: 'Flags', ownerId: 'u1', contactEmail: 'a@a.com' });
    });

    it('checks default features for plan', () => {
      // Free plan has: inventory, voice_commands, export_csv
      expect(manager.hasFeature(tenant.id, 'inventory')).toBe(true);
      expect(manager.hasFeature(tenant.id, 'voice_commands')).toBe(true);
      expect(manager.hasFeature(tenant.id, 'sso')).toBe(false);
    });

    it('enables a feature', () => {
      manager.enableFeature(tenant.id, 'custom_feature');
      expect(manager.hasFeature(tenant.id, 'custom_feature')).toBe(true);
    });

    it('disables a feature', () => {
      manager.disableFeature(tenant.id, 'inventory');
      expect(manager.hasFeature(tenant.id, 'inventory')).toBe(false);
    });

    it('lists features', () => {
      const features = manager.listFeatures(tenant.id);
      expect(features.length).toBeGreaterThan(0);
      expect(features).toContain('inventory');
    });

    it('enterprise plan has more features', () => {
      const enterprise = manager.createTenant({ name: 'Ent', ownerId: 'u2', contactEmail: 'e@e.com', plan: 'enterprise' });
      expect(manager.hasFeature(enterprise.id, 'sso')).toBe(true);
      expect(manager.hasFeature(enterprise.id, 'audit_log')).toBe(true);
      expect(manager.hasFeature(enterprise.id, 'white_label')).toBe(true);
    });

    it('returns false for non-existent tenant', () => {
      expect(manager.hasFeature('nope', 'inventory')).toBe(false);
    });
  });

  describe('Tenant Hierarchy', () => {
    it('creates parent-child relationship', () => {
      const parent = manager.createTenant({ name: 'Parent', ownerId: 'u1', contactEmail: 'p@p.com', plan: 'reseller' });
      const child = manager.createTenant({ name: 'Child', ownerId: 'u2', contactEmail: 'c@c.com', parentId: parent.id });

      expect(child.parentId).toBe(parent.id);
    });

    it('gets child tenants', () => {
      const parent = manager.createTenant({ name: 'Parent', ownerId: 'u1', contactEmail: 'p@p.com', plan: 'reseller' });
      manager.createTenant({ name: 'Child 1', ownerId: 'u2', contactEmail: 'c1@c.com', parentId: parent.id });
      manager.createTenant({ name: 'Child 2', ownerId: 'u3', contactEmail: 'c2@c.com', parentId: parent.id });
      manager.createTenant({ name: 'Unrelated', ownerId: 'u4', contactEmail: 'u@u.com' });

      const children = manager.getChildTenants(parent.id);
      expect(children.length).toBe(2);
    });

    it('gets parent tenant', () => {
      const parent = manager.createTenant({ name: 'Parent', ownerId: 'u1', contactEmail: 'p@p.com' });
      const child = manager.createTenant({ name: 'Child', ownerId: 'u2', contactEmail: 'c@c.com', parentId: parent.id });

      const foundParent = manager.getParentTenant(child.id);
      expect(foundParent).toBeTruthy();
      expect(foundParent!.id).toBe(parent.id);
    });

    it('returns undefined parent for root tenant', () => {
      const root = manager.createTenant({ name: 'Root', ownerId: 'u1', contactEmail: 'r@r.com' });
      expect(manager.getParentTenant(root.id)).toBeUndefined();
    });
  });

  describe('Data Isolation', () => {
    it('validates tenant access for valid member', () => {
      const tenant = manager.createTenant({ name: 'Iso', ownerId: 'u1', contactEmail: 'a@a.com' });
      const result = manager.validateTenantAccess(tenant.id, 'u1');

      expect(result.tenant.id).toBe(tenant.id);
      expect(result.member.userId).toBe('u1');
      expect(result.permissions.length).toBeGreaterThan(0);
    });

    it('throws for non-member access', () => {
      const tenant = manager.createTenant({ name: 'Iso', ownerId: 'u1', contactEmail: 'a@a.com' });
      expect(() => manager.validateTenantAccess(tenant.id, 'hacker')).toThrow('Access denied');
    });

    it('throws for suspended tenant', () => {
      const tenant = manager.createTenant({ name: 'Iso', ownerId: 'u1', contactEmail: 'a@a.com' });
      manager.suspendTenant(tenant.id, 'Test');
      expect(() => manager.validateTenantAccess(tenant.id, 'u1')).toThrow('suspended');
    });

    it('generates namespace', () => {
      const tenant = manager.createTenant({ name: 'My Company', ownerId: 'u1', contactEmail: 'a@a.com' });
      const ns = manager.getNamespace(tenant.id);
      expect(ns).toBe('t_my-company');
    });

    it('throws for non-existent tenant namespace', () => {
      expect(() => manager.getNamespace('nope')).toThrow('Tenant not found');
    });
  });

  describe('Audit Log', () => {
    it('records actions', () => {
      const tenant = manager.createTenant({ name: 'Audit', ownerId: 'u1', contactEmail: 'a@a.com' });
      // Creation should auto-log
      const log = manager.getAuditLog({ tenantId: tenant.id });
      expect(log.length).toBeGreaterThan(0);
    });

    it('filters by tenant', () => {
      const t1 = manager.createTenant({ name: 'T1', ownerId: 'u1', contactEmail: 'a@a.com' });
      const t2 = manager.createTenant({ name: 'T2', ownerId: 'u2', contactEmail: 'b@b.com' });

      const log1 = manager.getAuditLog({ tenantId: t1.id });
      const log2 = manager.getAuditLog({ tenantId: t2.id });
      expect(log1.every((e) => e.tenantId === t1.id)).toBe(true);
      expect(log2.every((e) => e.tenantId === t2.id)).toBe(true);
    });

    it('filters by action', () => {
      manager.createTenant({ name: 'Test', ownerId: 'u1', contactEmail: 'a@a.com' });
      const entries = manager.getAuditLog({ action: 'tenant:created' });
      expect(entries.length).toBeGreaterThan(0);
    });

    it('limits results', () => {
      for (let i = 0; i < 10; i++) {
        manager.createTenant({ name: `T${i}`, ownerId: `u${i}`, contactEmail: `${i}@a.com` });
      }
      expect(manager.getAuditLog({ limit: 3 }).length).toBe(3);
    });

    it('records setting changes', () => {
      const tenant = manager.createTenant({ name: 'Test', ownerId: 'u1', contactEmail: 'a@a.com' });
      manager.updateTenantSettings(tenant.id, { timezone: 'UTC' }, 'u1');

      const entries = manager.getAuditLog({ action: 'settings:updated' });
      expect(entries.length).toBe(1);
    });
  });

  describe('Statistics', () => {
    it('returns comprehensive stats', () => {
      manager.createTenant({ name: 'Active', ownerId: 'u1', contactEmail: 'a@a.com' });
      manager.createTenant({ name: 'Team', ownerId: 'u2', contactEmail: 'b@b.com', plan: 'team' });
      const s = manager.createTenant({ name: 'Suspended', ownerId: 'u3', contactEmail: 'c@c.com' });
      manager.suspendTenant(s.id, 'Test');

      const stats = manager.getTenantStats();
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(1);
      expect(stats.suspended).toBe(1);
      expect(stats.trial).toBe(1);
      expect(stats.byPlan.free).toBe(2);
      expect(stats.byPlan.team).toBe(1);
      expect(stats.totalMembers).toBe(3); // 3 owners
    });

    it('aggregates usage across tenants', () => {
      const t1 = manager.createTenant({ name: 'T1', ownerId: 'u1', contactEmail: 'a@a.com' });
      const t2 = manager.createTenant({ name: 'T2', ownerId: 'u2', contactEmail: 'b@b.com' });

      manager.trackUsage(t1.id, 'imagesCaptured', 10);
      manager.trackUsage(t2.id, 'imagesCaptured', 20);

      const stats = manager.getTenantStats();
      expect(stats.totalUsage.imagesCaptured).toBe(30);
    });
  });

  describe('Voice Summary', () => {
    it('generates summary for active tenant', () => {
      const tenant = manager.createTenant({ name: 'My Store', ownerId: 'u1', contactEmail: 'a@a.com' });
      manager.trackUsage(tenant.id, 'imagesCaptured', 50);

      const summary = manager.generateVoiceSummary(tenant.id);
      expect(summary).toContain('My Store');
      expect(summary).toContain('active');
      expect(summary).toContain('50 images');
    });

    it('warns about trial expiration', () => {
      const tenant = manager.createTenant({ name: 'Trial', ownerId: 'u1', contactEmail: 'a@a.com', plan: 'team' });
      const summary = manager.generateVoiceSummary(tenant.id);
      expect(summary).toContain('Trial expires');
    });

    it('returns not found for invalid tenant', () => {
      expect(manager.generateVoiceSummary('nope')).toContain('not found');
    });
  });

  describe('Plan Limits', () => {
    it('defines limits for all plans', () => {
      const plans = ['free', 'solo', 'team', 'enterprise', 'reseller'] as const;
      for (const plan of plans) {
        expect(PLAN_LIMITS[plan]).toBeTruthy();
        expect(PLAN_LIMITS[plan].maxUsers).toBeGreaterThan(0);
        expect(PLAN_LIMITS[plan].maxStores).toBeGreaterThan(0);
      }
    });

    it('enterprise has higher limits than team', () => {
      expect(PLAN_LIMITS.enterprise.maxUsers).toBeGreaterThan(PLAN_LIMITS.team.maxUsers);
      expect(PLAN_LIMITS.enterprise.maxStores).toBeGreaterThan(PLAN_LIMITS.team.maxStores);
    });
  });

  describe('Role Permissions', () => {
    it('defines permissions for all roles', () => {
      const roles = ['owner', 'admin', 'manager', 'member', 'viewer'] as const;
      for (const role of roles) {
        expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
      }
    });

    it('owner has most permissions', () => {
      expect(ROLE_PERMISSIONS.owner.length).toBeGreaterThan(ROLE_PERMISSIONS.admin.length);
      expect(ROLE_PERMISSIONS.admin.length).toBeGreaterThan(ROLE_PERMISSIONS.manager.length);
      expect(ROLE_PERMISSIONS.manager.length).toBeGreaterThan(ROLE_PERMISSIONS.member.length);
      expect(ROLE_PERMISSIONS.member.length).toBeGreaterThan(ROLE_PERMISSIONS.viewer.length);
    });
  });

  describe('Reset', () => {
    it('clears everything', () => {
      manager.createTenant({ name: 'Test', ownerId: 'u1', contactEmail: 'a@a.com' });
      manager.reset();

      expect(manager.listTenants().length).toBe(0);
      expect(manager.getAuditLog().length).toBe(0);
    });
  });

  describe('Default Config', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_TENANT_CONFIG.maxTenants).toBe(10000);
      expect(DEFAULT_TENANT_CONFIG.maxMembersPerTenant).toBe(500);
      expect(DEFAULT_TENANT_CONFIG.trialDurationDays).toBe(14);
      expect(DEFAULT_TENANT_CONFIG.invitationExpirationDays).toBe(7);
    });
  });
});
