/**
 * Tests for Multi-Tenant Manager
 * 🌙 Night Shift Agent — 2026-03-16
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TenantManager,
  DEFAULT_QUOTAS,
  PLAN_QUOTAS,
  type Organization,
  type OrgRole,
  type OrgPermission,
} from './tenant-manager.js';

// ──── Helpers ────

function createOrgParams(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Store',
    ownerId: 'user_owner',
    ownerEmail: 'owner@test.com',
    plan: 'multi_store', // Need multi-user plan for most tests
    ...overrides,
  };
}

// ──── Tests ────

describe('TenantManager', () => {
  let manager: TenantManager;

  beforeEach(() => {
    manager = new TenantManager();
  });

  // ── Organization CRUD ──

  describe('organization management', () => {
    it('should create an organization', () => {
      const org = manager.createOrg(createOrgParams());

      expect(org.id).toBeTruthy();
      expect(org.name).toBe('Test Store');
      expect(org.slug).toBe('test-store');
      expect(org.ownerId).toBe('user_owner');
      expect(org.status).toBe('trial'); // Non-free plans start as trial
      expect(org.plan).toBe('multi_store');
      expect(org.createdAt).toBeGreaterThan(0);
    });

    it('should create free org as active status', () => {
      const org = manager.createOrg(createOrgParams({ plan: 'free' }));
      expect(org.status).toBe('active');
    });

    it('should auto-add owner as first member', () => {
      const org = manager.createOrg(createOrgParams());
      const members = manager.listMembers(org.id);

      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe('user_owner');
      expect(members[0].role).toBe('owner');
    });

    it('should generate unique slug', () => {
      const org = manager.createOrg(createOrgParams({ name: 'My Cool Store!' }));
      expect(org.slug).toBe('my-cool-store');
    });

    it('should reject duplicate slug', () => {
      manager.createOrg(createOrgParams({ name: 'Test Store' }));
      expect(() => manager.createOrg(createOrgParams({
        name: 'Test Store',
        ownerId: 'user_2',
        ownerEmail: 'user2@test.com',
      }))).toThrow('already taken');
    });

    it('should reject empty name', () => {
      expect(() => manager.createOrg(createOrgParams({ name: '' }))).toThrow('required');
    });

    it('should reject missing ownerId', () => {
      expect(() => manager.createOrg(createOrgParams({ ownerId: '' }))).toThrow('required');
    });

    it('should enforce max orgs limit', () => {
      const tm = new TenantManager({ maxOrgs: 2 });
      tm.createOrg(createOrgParams({ name: 'One', ownerId: 'u1', ownerEmail: 'a@b.com' }));
      tm.createOrg(createOrgParams({ name: 'Two', ownerId: 'u2', ownerEmail: 'b@c.com' }));
      expect(() => tm.createOrg(createOrgParams({ name: 'Three', ownerId: 'u3', ownerEmail: 'c@d.com' }))).toThrow('Maximum');
    });

    it('should apply plan quotas', () => {
      const org = manager.createOrg(createOrgParams({ plan: 'enterprise' }));
      expect(org.quotas.maxUsers).toBe(PLAN_QUOTAS.enterprise!.maxUsers);
      expect(org.quotas.maxDevices).toBe(PLAN_QUOTAS.enterprise!.maxDevices);
    });

    it('should emit org:created event', () => {
      const handler = vi.fn();
      manager.on('org:created', handler);

      const org = manager.createOrg(createOrgParams());
      expect(handler).toHaveBeenCalledWith(org);
    });

    it('should update organization', () => {
      const org = manager.createOrg(createOrgParams());
      const updated = manager.updateOrg(org.id, { name: 'New Name' });

      expect(updated.name).toBe('New Name');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);
    });

    it('should update settings', () => {
      const org = manager.createOrg(createOrgParams());
      manager.updateOrg(org.id, { settings: { defaultTimezone: 'UTC', requireMFA: true } });

      const updated = manager.getOrg(org.id)!;
      expect(updated.settings.defaultTimezone).toBe('UTC');
      expect(updated.settings.requireMFA).toBe(true);
      // Other settings preserved
      expect(updated.settings.defaultLanguage).toBe('en');
    });

    it('should suspend organization', () => {
      const org = manager.createOrg(createOrgParams());
      manager.suspendOrg(org.id, 'Payment failed');

      expect(manager.getOrg(org.id)?.status).toBe('suspended');
    });

    it('should reactivate suspended org', () => {
      const org = manager.createOrg(createOrgParams());
      manager.suspendOrg(org.id);
      manager.reactivateOrg(org.id);

      expect(manager.getOrg(org.id)?.status).toBe('active');
    });

    it('should throw reactivating non-suspended org', () => {
      const org = manager.createOrg(createOrgParams());
      expect(() => manager.reactivateOrg(org.id)).toThrow('not suspended');
    });

    it('should deactivate organization', () => {
      const org = manager.createOrg(createOrgParams());
      manager.deactivateOrg(org.id);

      expect(manager.getOrg(org.id)?.status).toBe('deactivated');
    });

    it('should get org by slug', () => {
      const org = manager.createOrg(createOrgParams());
      expect(manager.getOrgBySlug('test-store')?.id).toBe(org.id);
      expect(manager.getOrgBySlug('nonexistent')).toBeUndefined();
    });

    it('should list orgs with filter', () => {
      manager.createOrg(createOrgParams({ name: 'Active One', ownerId: 'u1', ownerEmail: 'a@b.com', plan: 'free' }));
      const org2 = manager.createOrg(createOrgParams({ name: 'Trial Two', ownerId: 'u2', ownerEmail: 'b@c.com', plan: 'enterprise' }));
      manager.suspendOrg(org2.id);

      const active = manager.listOrgs({ status: 'active' });
      expect(active).toHaveLength(1);

      const suspended = manager.listOrgs({ status: 'suspended' });
      expect(suspended).toHaveLength(1);
    });

    it('should get user orgs', () => {
      manager.createOrg(createOrgParams({ name: 'Store A', ownerId: 'user1', ownerEmail: 'a@b.com' }));
      manager.createOrg(createOrgParams({ name: 'Store B', ownerId: 'user2', ownerEmail: 'b@c.com' }));

      const orgs = manager.getUserOrgs('user1');
      expect(orgs).toHaveLength(1);
      expect(orgs[0].name).toBe('Store A');
    });
  });

  // ── Member Management ──

  describe('member management', () => {
    let org: Organization;

    beforeEach(() => {
      org = manager.createOrg(createOrgParams());
    });

    it('should add a member', () => {
      const member = manager.addMember(org.id, {
        userId: 'user_new',
        email: 'new@test.com',
        role: 'member',
        invitedBy: 'user_owner',
      });

      expect(member.userId).toBe('user_new');
      expect(member.role).toBe('member');
      expect(manager.listMembers(org.id)).toHaveLength(2);
    });

    it('should reject duplicate member', () => {
      expect(() => manager.addMember(org.id, {
        userId: 'user_owner',
        email: 'owner@test.com',
        role: 'admin',
        invitedBy: 'user_owner',
      })).toThrow('already a member');
    });

    it('should reject adding another owner', () => {
      expect(() => manager.addMember(org.id, {
        userId: 'user_new',
        email: 'new@test.com',
        role: 'owner',
        invitedBy: 'user_owner',
      })).toThrow('Transfer ownership');
    });

    it('should enforce user quota', () => {
      // Solo plan: maxUsers = 1 (owner already counts)
      const freeOrg = manager.createOrg(createOrgParams({ name: 'Free Org', ownerId: 'u2', ownerEmail: 'u2@t.com', plan: 'free' }));

      expect(() => manager.addMember(freeOrg.id, {
        userId: 'user_new',
        email: 'new@test.com',
        role: 'member',
        invitedBy: 'u2',
      })).toThrow('quota exceeded');
    });

    it('should remove a member', () => {
      manager.addMember(org.id, {
        userId: 'user_new',
        email: 'new@test.com',
        role: 'member',
        invitedBy: 'user_owner',
      });

      manager.removeMember(org.id, 'user_new', 'user_owner');
      expect(manager.listMembers(org.id)).toHaveLength(1);
    });

    it('should not remove the owner', () => {
      expect(() => manager.removeMember(org.id, 'user_owner', 'user_owner'))
        .toThrow('Cannot remove the organization owner');
    });

    it('should throw removing non-existent member', () => {
      expect(() => manager.removeMember(org.id, 'nonexistent', 'user_owner'))
        .toThrow('not a member');
    });

    it('should change member role', () => {
      manager.addMember(org.id, {
        userId: 'user_new',
        email: 'new@test.com',
        role: 'member',
        invitedBy: 'user_owner',
      });

      manager.changeMemberRole(org.id, 'user_new', 'admin', 'user_owner');
      expect(manager.getMember(org.id, 'user_new')?.role).toBe('admin');
    });

    it('should not demote owner', () => {
      expect(() => manager.changeMemberRole(org.id, 'user_owner', 'admin', 'user_owner'))
        .toThrow('Cannot demote the owner');
    });

    it('should not promote to owner', () => {
      manager.addMember(org.id, {
        userId: 'user_new',
        email: 'new@test.com',
        role: 'member',
        invitedBy: 'user_owner',
      });

      expect(() => manager.changeMemberRole(org.id, 'user_new', 'owner', 'user_owner'))
        .toThrow('transferOwnership');
    });

    it('should transfer ownership', () => {
      manager.addMember(org.id, {
        userId: 'user_new',
        email: 'new@test.com',
        role: 'admin',
        invitedBy: 'user_owner',
      });

      manager.transferOwnership(org.id, 'user_new', 'user_owner');

      expect(manager.getMember(org.id, 'user_new')?.role).toBe('owner');
      expect(manager.getMember(org.id, 'user_owner')?.role).toBe('admin');
      expect(manager.getOrg(org.id)?.ownerId).toBe('user_new');
    });

    it('should reject transfer from non-owner', () => {
      manager.addMember(org.id, {
        userId: 'user_admin',
        email: 'admin@test.com',
        role: 'admin',
        invitedBy: 'user_owner',
      });

      expect(() => manager.transferOwnership(org.id, 'user_admin', 'user_admin'))
        .toThrow('Only the current owner');
    });

    it('should emit member events', () => {
      const addHandler = vi.fn();
      const removeHandler = vi.fn();
      const roleHandler = vi.fn();
      manager.on('member:added', addHandler);
      manager.on('member:removed', removeHandler);
      manager.on('member:role_changed', roleHandler);

      manager.addMember(org.id, {
        userId: 'u2', email: 'u2@t.com', role: 'member', invitedBy: 'user_owner',
      });
      expect(addHandler).toHaveBeenCalledTimes(1);

      manager.changeMemberRole(org.id, 'u2', 'admin', 'user_owner');
      expect(roleHandler).toHaveBeenCalledWith(org.id, 'u2', 'member', 'admin');

      manager.removeMember(org.id, 'u2', 'user_owner');
      expect(removeHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Permissions ──

  describe('permissions', () => {
    let org: Organization;

    beforeEach(() => {
      org = manager.createOrg(createOrgParams());
    });

    it('should grant role-based permissions to owner', () => {
      expect(manager.hasPermission(org.id, 'user_owner', 'billing:manage')).toBe(true);
      expect(manager.hasPermission(org.id, 'user_owner', 'team:remove')).toBe(true);
      expect(manager.hasPermission(org.id, 'user_owner', 'data:delete')).toBe(true);
    });

    it('should restrict permissions by role', () => {
      manager.addMember(org.id, {
        userId: 'viewer',
        email: 'v@t.com',
        role: 'viewer',
        invitedBy: 'user_owner',
      });

      expect(manager.hasPermission(org.id, 'viewer', 'inventory:view_session')).toBe(true);
      expect(manager.hasPermission(org.id, 'viewer', 'inventory:create_session')).toBe(false);
      expect(manager.hasPermission(org.id, 'viewer', 'billing:manage')).toBe(false);
    });

    it('should return false for non-members', () => {
      expect(manager.hasPermission(org.id, 'stranger', 'inventory:view_session')).toBe(false);
    });

    it('should get effective permissions', () => {
      manager.addMember(org.id, {
        userId: 'member1',
        email: 'm@t.com',
        role: 'member',
        invitedBy: 'user_owner',
      });

      const perms = manager.getEffectivePermissions(org.id, 'member1');
      expect(perms).toContain('inventory:create_session');
      expect(perms).toContain('inventory:view_session');
      expect(perms).not.toContain('billing:manage');
    });

    it('should grant custom permissions', () => {
      manager.addMember(org.id, {
        userId: 'member1',
        email: 'm@t.com',
        role: 'member',
        invitedBy: 'user_owner',
      });

      // Members don't have billing:view by default
      expect(manager.hasPermission(org.id, 'member1', 'billing:view')).toBe(false);

      manager.grantCustomPermission(org.id, 'member1', 'billing:view');
      expect(manager.hasPermission(org.id, 'member1', 'billing:view')).toBe(true);
    });

    it('should revoke custom permissions', () => {
      manager.addMember(org.id, {
        userId: 'member1',
        email: 'm@t.com',
        role: 'member',
        invitedBy: 'user_owner',
      });

      // Members have inventory:create_session by default
      expect(manager.hasPermission(org.id, 'member1', 'inventory:create_session')).toBe(true);

      manager.revokeCustomPermission(org.id, 'member1', 'inventory:create_session');
      expect(manager.hasPermission(org.id, 'member1', 'inventory:create_session')).toBe(false);
    });

    it('should get role permissions', () => {
      const adminPerms = manager.getRolePermissions('admin');
      expect(adminPerms).toContain('team:invite');
      expect(adminPerms).toContain('settings:api_keys');
      expect(adminPerms).not.toContain('billing:manage'); // Only owner

      const viewerPerms = manager.getRolePermissions('viewer');
      expect(viewerPerms).toContain('inventory:view_session');
      expect(viewerPerms).not.toContain('inventory:create_session');
    });

    it('should have more permissions for higher roles', () => {
      const viewerPerms = manager.getRolePermissions('viewer').length;
      const memberPerms = manager.getRolePermissions('member').length;
      const managerPerms = manager.getRolePermissions('manager').length;
      const adminPerms = manager.getRolePermissions('admin').length;
      const ownerPerms = manager.getRolePermissions('owner').length;

      expect(viewerPerms).toBeLessThan(memberPerms);
      expect(memberPerms).toBeLessThan(managerPerms);
      expect(managerPerms).toBeLessThan(adminPerms);
      expect(adminPerms).toBeLessThanOrEqual(ownerPerms);
    });
  });

  // ── Invites ──

  describe('invites', () => {
    let org: Organization;

    beforeEach(() => {
      org = manager.createOrg(createOrgParams());
    });

    it('should create an invite', () => {
      const invite = manager.createInvite(org.id, {
        email: 'invited@test.com',
        role: 'member',
        invitedBy: 'user_owner',
      });

      expect(invite.id).toBeTruthy();
      expect(invite.token).toBeTruthy();
      expect(invite.email).toBe('invited@test.com');
      expect(invite.role).toBe('member');
      expect(invite.accepted).toBe(false);
    });

    it('should reject duplicate pending invite', () => {
      manager.createInvite(org.id, {
        email: 'invited@test.com',
        role: 'member',
        invitedBy: 'user_owner',
      });

      expect(() => manager.createInvite(org.id, {
        email: 'invited@test.com',
        role: 'admin',
        invitedBy: 'user_owner',
      })).toThrow('already exists');
    });

    it('should reject inviting as owner', () => {
      expect(() => manager.createInvite(org.id, {
        email: 'new@test.com',
        role: 'owner',
        invitedBy: 'user_owner',
      })).toThrow('Cannot invite someone as owner');
    });

    it('should accept an invite', () => {
      const invite = manager.createInvite(org.id, {
        email: 'invited@test.com',
        role: 'member',
        invitedBy: 'user_owner',
      });

      const member = manager.acceptInvite(invite.token, 'user_invited');
      expect(member.userId).toBe('user_invited');
      expect(member.role).toBe('member');
      expect(manager.listMembers(org.id)).toHaveLength(2);
    });

    it('should reject invalid invite token', () => {
      expect(() => manager.acceptInvite('bad-token', 'user_x')).toThrow('Invalid');
    });

    it('should reject expired invite', () => {
      const tm = new TenantManager({ inviteExpirationMs: 1 }); // 1ms expiration
      const o = tm.createOrg(createOrgParams());
      const invite = tm.createInvite(o.id, {
        email: 'x@t.com',
        role: 'member',
        invitedBy: 'user_owner',
      });

      // Force expiration (token was created with 1ms expiration)
      // Wait a tiny bit
      const start = Date.now();
      while (Date.now() - start < 5) { /* busy wait */ }

      expect(() => tm.acceptInvite(invite.token, 'user_x')).toThrow('expired');
    });

    it('should list pending invites', () => {
      manager.createInvite(org.id, { email: 'a@t.com', role: 'member', invitedBy: 'user_owner' });
      manager.createInvite(org.id, { email: 'b@t.com', role: 'admin', invitedBy: 'user_owner' });

      const invites = manager.listInvites(org.id);
      expect(invites).toHaveLength(2);
    });

    it('should emit invite events', () => {
      const createHandler = vi.fn();
      const acceptHandler = vi.fn();
      manager.on('invite:created', createHandler);
      manager.on('invite:accepted', acceptHandler);

      const invite = manager.createInvite(org.id, { email: 'x@t.com', role: 'member', invitedBy: 'user_owner' });
      expect(createHandler).toHaveBeenCalledTimes(1);

      manager.acceptInvite(invite.token, 'user_x');
      expect(acceptHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ── API Keys ──

  describe('API keys', () => {
    let org: Organization;

    beforeEach(() => {
      org = manager.createOrg(createOrgParams());
    });

    it('should create an API key', () => {
      const { key, apiKey } = manager.createApiKey(org.id, {
        name: 'Production Key',
        permissions: ['inventory:view_session', 'inventory:export'],
        createdBy: 'user_owner',
      });

      expect(key).toMatch(/^ocvk_/);
      expect(apiKey.name).toBe('Production Key');
      expect(apiKey.keyPrefix).toBe(key.substring(0, 12));
      expect(apiKey.enabled).toBe(true);
    });

    it('should validate API key', () => {
      const { key } = manager.createApiKey(org.id, {
        name: 'Test',
        permissions: ['inventory:view_session'],
        createdBy: 'user_owner',
      });

      const result = manager.validateApiKey(key);
      expect(result).not.toBeNull();
      expect(result!.orgId).toBe(org.id);
      expect(result!.permissions).toContain('inventory:view_session');
    });

    it('should reject invalid API key', () => {
      expect(manager.validateApiKey('bad-key')).toBeNull();
    });

    it('should reject disabled API key', () => {
      const { key, apiKey } = manager.createApiKey(org.id, {
        name: 'Test',
        permissions: ['inventory:view_session'],
        createdBy: 'user_owner',
      });

      manager.revokeApiKey(org.id, apiKey.id, 'user_owner');
      expect(manager.validateApiKey(key)).toBeNull();
    });

    it('should reject expired API key', () => {
      const { key } = manager.createApiKey(org.id, {
        name: 'Test',
        permissions: ['inventory:view_session'],
        createdBy: 'user_owner',
        expiresAt: Date.now() - 1000, // Already expired
      });

      expect(manager.validateApiKey(key)).toBeNull();
    });

    it('should enforce max API keys', () => {
      const tm = new TenantManager({ maxApiKeysPerOrg: 2 });
      const o = tm.createOrg(createOrgParams());

      tm.createApiKey(o.id, { name: 'K1', permissions: [], createdBy: 'user_owner' });
      tm.createApiKey(o.id, { name: 'K2', permissions: [], createdBy: 'user_owner' });

      expect(() => tm.createApiKey(o.id, { name: 'K3', permissions: [], createdBy: 'user_owner' }))
        .toThrow('Maximum API keys');
    });

    it('should list API keys without hash', () => {
      manager.createApiKey(org.id, { name: 'K1', permissions: [], createdBy: 'user_owner' });

      const keys = manager.listApiKeys(org.id);
      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe('K1');
      expect((keys[0] as any).keyHash).toBeUndefined();
    });

    it('should reject empty key name', () => {
      expect(() => manager.createApiKey(org.id, { name: '', permissions: [], createdBy: 'user_owner' }))
        .toThrow('name is required');
    });

    it('should update lastUsedAt on validation', () => {
      const { key, apiKey } = manager.createApiKey(org.id, {
        name: 'Test',
        permissions: [],
        createdBy: 'user_owner',
      });

      expect(apiKey.lastUsedAt).toBeUndefined();

      manager.validateApiKey(key);

      // Access via listApiKeys to check
      const keys = manager.listApiKeys(org.id);
      expect(keys[0].lastUsedAt).toBeGreaterThan(0);
    });
  });

  // ── Quotas ──

  describe('quotas', () => {
    it('should check quota within limits', () => {
      const org = manager.createOrg(createOrgParams({ plan: 'solo' }));
      const result = manager.checkQuota(org.id, 'sessions_per_day', 5);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(PLAN_QUOTAS.solo!.maxSessionsPerDay);
      expect(result.usage).toBe(5);
    });

    it('should reject when quota exceeded', () => {
      const org = manager.createOrg(createOrgParams({ plan: 'free' }));
      const handler = vi.fn();
      manager.on('quota:exceeded', handler);

      const result = manager.checkQuota(org.id, 'sessions_per_day', 10);
      expect(result.allowed).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should warn at 80% usage', () => {
      const org = manager.createOrg(createOrgParams({ plan: 'solo' }));
      const handler = vi.fn();
      manager.on('quota:warning', handler);

      // solo maxSessionsPerDay = 20, so 80% = 16
      manager.checkQuota(org.id, 'sessions_per_day', 16);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should update quotas', () => {
      const org = manager.createOrg(createOrgParams());
      manager.updateQuotas(org.id, { maxUsers: 50 });

      expect(manager.getOrg(org.id)?.quotas.maxUsers).toBe(50);
    });

    it('should apply plan quotas', () => {
      const org = manager.createOrg(createOrgParams({ plan: 'free' }));
      manager.applyPlanQuotas(org.id, 'enterprise');

      const updated = manager.getOrg(org.id)!;
      expect(updated.plan).toBe('enterprise');
      expect(updated.quotas.maxUsers).toBe(PLAN_QUOTAS.enterprise!.maxUsers);
    });

    it('should reject unknown plan', () => {
      const org = manager.createOrg(createOrgParams());
      expect(() => manager.applyPlanQuotas(org.id, 'nonexistent')).toThrow('Unknown plan');
    });

    it('should reject unknown quota resource', () => {
      const org = manager.createOrg(createOrgParams());
      expect(() => manager.checkQuota(org.id, 'unknown_resource', 1)).toThrow('Unknown quota resource');
    });
  });

  // ── Audit Log ──

  describe('audit log', () => {
    it('should log org creation', () => {
      const org = manager.createOrg(createOrgParams());
      const log = manager.getAuditLog(org.id);

      expect(log.length).toBeGreaterThan(0);
      expect(log[0].action).toBe('org.created');
      expect(log[0].userId).toBe('user_owner');
    });

    it('should log member actions', () => {
      const org = manager.createOrg(createOrgParams());
      manager.addMember(org.id, { userId: 'u2', email: 'u2@t.com', role: 'member', invitedBy: 'user_owner' });
      manager.removeMember(org.id, 'u2', 'user_owner');

      const log = manager.getAuditLog(org.id);
      const actions = log.map(e => e.action);
      expect(actions).toContain('member.added');
      expect(actions).toContain('member.removed');
    });

    it('should filter audit log by action', () => {
      const org = manager.createOrg(createOrgParams());
      manager.addMember(org.id, { userId: 'u2', email: 'u2@t.com', role: 'member', invitedBy: 'user_owner' });

      const log = manager.getAuditLog(org.id, { action: 'member.added' });
      expect(log).toHaveLength(1);
    });

    it('should filter audit log by userId', () => {
      const org = manager.createOrg(createOrgParams());
      manager.suspendOrg(org.id);

      const log = manager.getAuditLog(org.id, { userId: 'system' });
      expect(log.length).toBeGreaterThan(0);
      expect(log.every(e => e.userId === 'system')).toBe(true);
    });

    it('should limit audit log results', () => {
      const org = manager.createOrg(createOrgParams({ plan: 'enterprise' })); // enterprise allows 100 users
      for (let i = 0; i < 10; i++) {
        manager.addMember(org.id, { userId: `u${i}`, email: `u${i}@t.com`, role: 'member', invitedBy: 'user_owner' });
      }

      const log = manager.getAuditLog(org.id, { limit: 3 });
      expect(log).toHaveLength(3);
    });
  });

  // ── Stats ──

  describe('stats', () => {
    it('should return manager stats', () => {
      manager.createOrg(createOrgParams({ name: 'Org 1', ownerId: 'u1', ownerEmail: 'u1@t.com', plan: 'free' }));
      const o2 = manager.createOrg(createOrgParams({ name: 'Org 2', ownerId: 'u2', ownerEmail: 'u2@t.com', plan: 'enterprise' }));
      manager.suspendOrg(o2.id);

      const stats = manager.getStats();
      expect(stats.totalOrgs).toBe(2);
      expect(stats.activeOrgs).toBe(1);
      expect(stats.suspendedOrgs).toBe(1);
      expect(stats.totalMembers).toBe(2);
    });

    it('should generate voice summary', () => {
      manager.createOrg(createOrgParams({ plan: 'free' }));
      const summary = manager.getVoiceSummary();

      expect(summary).toContain('1 organizations');
      expect(summary).toContain('1 total members');
    });
  });
});
