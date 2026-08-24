/**
 * Multi-Tenant Isolation System
 *
 * Enables multiple organizations to share the platform
 * with complete data isolation. Critical for enterprise sales.
 *
 * Features:
 * - Tenant CRUD with lifecycle management
 * - Data namespace isolation (every query scoped to tenant)
 * - Per-tenant configuration overrides
 * - Per-tenant usage tracking and billing
 * - Per-tenant feature flags
 * - Per-tenant rate limits
 * - Tenant suspension/reactivation
 * - Cross-tenant admin operations
 * - Tenant hierarchy (parent/child for resellers)
 * - Invitation system for team members
 * - Audit logging per tenant
 * - Voice-friendly tenant status summaries
 *
 * @module tenant-manager
 */

import { EventEmitter } from 'events';

// ─── Types ────────────────────────────────────────────────────────

export type TenantStatus = 'active' | 'suspended' | 'trial' | 'deactivated' | 'pending';

export type TenantPlan = 'free' | 'solo' | 'team' | 'enterprise' | 'reseller';

export type MemberRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';

export interface Tenant {
  id: string;
  name: string;
  slug: string; // URL-safe identifier
  status: TenantStatus;
  plan: TenantPlan;
  parentId?: string; // for reseller hierarchy
  ownerId: string;
  contactEmail: string;
  domain?: string; // custom domain for SSO
  settings: TenantSettings;
  usage: TenantUsage;
  limits: TenantLimits;
  features: Set<string>; // enabled feature flags
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  trialEndsAt?: number;
  suspendedAt?: number;
  suspendedReason?: string;
}

export interface TenantSettings {
  timezone: string;
  language: string;
  defaultAgents: string[]; // which agents activate by default
  privacyRegulation: string; // gdpr, ccpa, etc.
  dataRegion: string; // us, eu, ap
  retentionDays: number;
  allowCloudProcessing: boolean;
  requireMFA: boolean;
  customBranding?: {
    logo?: string;
    primaryColor?: string;
    name?: string;
  };
}

export interface TenantUsage {
  imagesCaptured: number;
  agentInvocations: number;
  voiceCommands: number;
  apiCalls: number;
  storageBytes: number;
  activeUsers: number;
  sessionsThisMonth: number;
  lastActiveAt: number;
}

export interface TenantLimits {
  maxUsers: number;
  maxStores: number;
  maxSessionsPerMonth: number;
  maxApiCallsPerDay: number;
  maxStorageBytes: number;
  maxAgents: number;
  rateLimitPerMinute: number;
}

export interface TenantMember {
  id: string;
  tenantId: string;
  userId: string;
  email: string;
  displayName: string;
  role: MemberRole;
  status: 'active' | 'invited' | 'suspended';
  invitedAt: number;
  joinedAt?: number;
  lastActiveAt?: number;
  permissions: string[];
}

export interface TenantInvitation {
  id: string;
  tenantId: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
  expiresAt: number;
  acceptedAt?: number;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}

export interface TenantAuditEntry {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  resource: string;
  details?: Record<string, unknown>;
  timestamp: number;
  ipAddress?: string;
}

export interface TenantManagerConfig {
  maxTenants?: number; // default 10000
  maxMembersPerTenant?: number; // default 500
  invitationExpirationDays?: number; // default 7
  maxAuditEntries?: number; // default 100000
  trialDurationDays?: number; // default 14
}

export interface TenantManagerEvents {
  'tenant:created': (tenant: Tenant) => void;
  'tenant:updated': (tenant: Tenant) => void;
  'tenant:suspended': (tenant: Tenant) => void;
  'tenant:reactivated': (tenant: Tenant) => void;
  'tenant:deleted': (tenantId: string) => void;
  'member:added': (member: TenantMember) => void;
  'member:removed': (member: TenantMember) => void;
  'member:role_changed': (member: TenantMember) => void;
  'invitation:sent': (invitation: TenantInvitation) => void;
  'invitation:accepted': (invitation: TenantInvitation) => void;
  'limit:approaching': (tenantId: string, resource: string, percentage: number) => void;
  'limit:exceeded': (tenantId: string, resource: string) => void;
}

export const DEFAULT_TENANT_CONFIG: TenantManagerConfig = {
  maxTenants: 10000,
  maxMembersPerTenant: 500,
  invitationExpirationDays: 7,
  maxAuditEntries: 100000,
  trialDurationDays: 14,
};

// ─── Plan Definitions ───────────────────────────────────────────

export const PLAN_LIMITS: Record<TenantPlan, TenantLimits> = {
  free: {
    maxUsers: 1,
    maxStores: 1,
    maxSessionsPerMonth: 5,
    maxApiCallsPerDay: 100,
    maxStorageBytes: 100 * 1024 * 1024, // 100MB
    maxAgents: 3,
    rateLimitPerMinute: 10,
  },
  solo: {
    maxUsers: 1,
    maxStores: 3,
    maxSessionsPerMonth: 50,
    maxApiCallsPerDay: 1000,
    maxStorageBytes: 1024 * 1024 * 1024, // 1GB
    maxAgents: 8,
    rateLimitPerMinute: 30,
  },
  team: {
    maxUsers: 10,
    maxStores: 10,
    maxSessionsPerMonth: 200,
    maxApiCallsPerDay: 5000,
    maxStorageBytes: 10 * 1024 * 1024 * 1024, // 10GB
    maxAgents: 15,
    rateLimitPerMinute: 60,
  },
  enterprise: {
    maxUsers: 500,
    maxStores: 100,
    maxSessionsPerMonth: 10000,
    maxApiCallsPerDay: 100000,
    maxStorageBytes: 100 * 1024 * 1024 * 1024, // 100GB
    maxAgents: 50,
    rateLimitPerMinute: 300,
  },
  reseller: {
    maxUsers: 1000,
    maxStores: 500,
    maxSessionsPerMonth: 50000,
    maxApiCallsPerDay: 500000,
    maxStorageBytes: 500 * 1024 * 1024 * 1024, // 500GB
    maxAgents: 50,
    rateLimitPerMinute: 600,
  },
};

const DEFAULT_SETTINGS: TenantSettings = {
  timezone: 'America/Chicago',
  language: 'en',
  defaultAgents: ['inventory', 'security'],
  privacyRegulation: 'gdpr',
  dataRegion: 'us',
  retentionDays: 90,
  allowCloudProcessing: true,
  requireMFA: false,
};

// ─── Permission Matrix ──────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<MemberRole, string[]> = {
  owner: [
    'tenant:manage', 'tenant:delete', 'tenant:billing',
    'members:manage', 'members:invite', 'members:remove',
    'sessions:create', 'sessions:view', 'sessions:delete',
    'settings:manage', 'agents:manage', 'exports:create',
    'api:manage', 'audit:view',
  ],
  admin: [
    'tenant:manage',
    'members:manage', 'members:invite', 'members:remove',
    'sessions:create', 'sessions:view', 'sessions:delete',
    'settings:manage', 'agents:manage', 'exports:create',
    'api:manage', 'audit:view',
  ],
  manager: [
    'members:invite',
    'sessions:create', 'sessions:view', 'sessions:delete',
    'agents:manage', 'exports:create',
    'audit:view',
  ],
  member: [
    'sessions:create', 'sessions:view',
    'exports:create',
  ],
  viewer: [
    'sessions:view',
  ],
};

// ─── Utilities ──────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// ─── Engine ─────────────────────────────────────────────────────

export class TenantManager extends EventEmitter {
  private config: Required<TenantManagerConfig>;
  private tenants: Map<string, Tenant> = new Map();
  private members: Map<string, TenantMember[]> = new Map(); // tenantId → members
  private invitations: Map<string, TenantInvitation> = new Map();
  private auditLog: TenantAuditEntry[] = [];
  private slugIndex: Map<string, string> = new Map(); // slug → tenantId

  constructor(config: TenantManagerConfig = {}) {
    super();
    this.config = { ...DEFAULT_TENANT_CONFIG, ...config } as Required<TenantManagerConfig>;
  }

  // ─── Tenant CRUD ──────────────────────────────────────────────

  createTenant(params: {
    name: string;
    ownerId: string;
    contactEmail: string;
    plan?: TenantPlan;
    parentId?: string;
    domain?: string;
    settings?: Partial<TenantSettings>;
    metadata?: Record<string, unknown>;
  }): Tenant {
    if (this.tenants.size >= this.config.maxTenants) {
      throw new Error(`Maximum tenant limit reached (${this.config.maxTenants})`);
    }

    const slug = this.generateUniqueSlug(params.name);
    const plan = params.plan ?? 'free';
    const now = Date.now();

    const tenant: Tenant = {
      id: generateId('ten'),
      name: params.name,
      slug,
      status: plan === 'free' ? 'active' : 'trial',
      plan,
      parentId: params.parentId,
      ownerId: params.ownerId,
      contactEmail: params.contactEmail,
      domain: params.domain,
      settings: { ...DEFAULT_SETTINGS, ...params.settings },
      usage: {
        imagesCaptured: 0,
        agentInvocations: 0,
        voiceCommands: 0,
        apiCalls: 0,
        storageBytes: 0,
        activeUsers: 1,
        sessionsThisMonth: 0,
        lastActiveAt: now,
      },
      limits: { ...PLAN_LIMITS[plan] },
      features: new Set(this.getDefaultFeatures(plan)),
      metadata: params.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      trialEndsAt: plan !== 'free' ? now + this.config.trialDurationDays * 24 * 60 * 60 * 1000 : undefined,
    };

    this.tenants.set(tenant.id, tenant);
    this.slugIndex.set(slug, tenant.id);
    this.members.set(tenant.id, []);

    // Auto-add owner as member
    this.addMemberInternal(tenant.id, {
      userId: params.ownerId,
      email: params.contactEmail,
      displayName: params.name + ' Owner',
      role: 'owner',
    });

    this.logAudit(tenant.id, params.ownerId, 'tenant:created', 'tenant', { plan, name: params.name });

    this.emit('tenant:created', tenant);
    return tenant;
  }

  getTenant(tenantId: string): Tenant | undefined {
    return this.tenants.get(tenantId);
  }

  getTenantBySlug(slug: string): Tenant | undefined {
    const id = this.slugIndex.get(slug);
    if (!id) return undefined;
    return this.tenants.get(id);
  }

  updateTenant(
    tenantId: string,
    updates: Partial<Pick<Tenant, 'name' | 'contactEmail' | 'domain' | 'metadata'>>,
    actorId?: string
  ): Tenant {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    if (updates.name) {
      // Update slug if name changes
      this.slugIndex.delete(tenant.slug);
      tenant.slug = this.generateUniqueSlug(updates.name);
      this.slugIndex.set(tenant.slug, tenant.id);
    }

    Object.assign(tenant, updates, { updatedAt: Date.now() });

    if (actorId) {
      this.logAudit(tenantId, actorId, 'tenant:updated', 'tenant', updates);
    }

    this.emit('tenant:updated', tenant);
    return tenant;
  }

  updateTenantSettings(tenantId: string, settings: Partial<TenantSettings>, actorId?: string): Tenant {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    Object.assign(tenant.settings, settings);
    tenant.updatedAt = Date.now();

    if (actorId) {
      this.logAudit(tenantId, actorId, 'settings:updated', 'settings', settings);
    }

    this.emit('tenant:updated', tenant);
    return tenant;
  }

  changePlan(tenantId: string, newPlan: TenantPlan, actorId?: string): Tenant {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    const oldPlan = tenant.plan;
    tenant.plan = newPlan;
    tenant.limits = { ...PLAN_LIMITS[newPlan] };
    tenant.features = new Set(this.getDefaultFeatures(newPlan));
    tenant.updatedAt = Date.now();

    // If upgrading from free, set trial
    if (oldPlan === 'free' && newPlan !== 'free') {
      tenant.status = 'trial';
      tenant.trialEndsAt = Date.now() + this.config.trialDurationDays * 24 * 60 * 60 * 1000;
    }

    if (actorId) {
      this.logAudit(tenantId, actorId, 'plan:changed', 'billing', { oldPlan, newPlan });
    }

    this.emit('tenant:updated', tenant);
    return tenant;
  }

  suspendTenant(tenantId: string, reason: string, actorId?: string): Tenant {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    tenant.status = 'suspended';
    tenant.suspendedAt = Date.now();
    tenant.suspendedReason = reason;
    tenant.updatedAt = Date.now();

    if (actorId) {
      this.logAudit(tenantId, actorId, 'tenant:suspended', 'tenant', { reason });
    }

    this.emit('tenant:suspended', tenant);
    return tenant;
  }

  reactivateTenant(tenantId: string, actorId?: string): Tenant {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
    if (tenant.status !== 'suspended') throw new Error('Tenant is not suspended');

    tenant.status = 'active';
    tenant.suspendedAt = undefined;
    tenant.suspendedReason = undefined;
    tenant.updatedAt = Date.now();

    if (actorId) {
      this.logAudit(tenantId, actorId, 'tenant:reactivated', 'tenant');
    }

    this.emit('tenant:reactivated', tenant);
    return tenant;
  }

  deleteTenant(tenantId: string, actorId?: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    // Check for child tenants
    const children = this.listTenants({ parentId: tenantId });
    if (children.length > 0) {
      throw new Error(`Cannot delete tenant with ${children.length} child tenant(s)`);
    }

    this.slugIndex.delete(tenant.slug);
    this.members.delete(tenantId);
    this.tenants.delete(tenantId);

    // Remove invitations
    for (const [id, inv] of this.invitations) {
      if (inv.tenantId === tenantId) this.invitations.delete(id);
    }

    if (actorId) {
      this.logAudit(tenantId, actorId, 'tenant:deleted', 'tenant');
    }

    this.emit('tenant:deleted', tenantId);
    return true;
  }

  listTenants(filter?: {
    status?: TenantStatus;
    plan?: TenantPlan;
    parentId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Tenant[] {
    let tenants = Array.from(this.tenants.values());

    if (filter) {
      if (filter.status) tenants = tenants.filter((t) => t.status === filter.status);
      if (filter.plan) tenants = tenants.filter((t) => t.plan === filter.plan);
      if (filter.parentId) tenants = tenants.filter((t) => t.parentId === filter.parentId);
      if (filter.search) {
        const q = filter.search.toLowerCase();
        tenants = tenants.filter(
          (t) => t.name.toLowerCase().includes(q) || t.contactEmail.toLowerCase().includes(q)
        );
      }
    }

    tenants.sort((a, b) => b.createdAt - a.createdAt);

    if (filter?.offset) tenants = tenants.slice(filter.offset);
    if (filter?.limit) tenants = tenants.slice(0, filter.limit);

    return tenants;
  }

  // ─── Member Management ────────────────────────────────────────

  addMember(tenantId: string, params: {
    userId: string;
    email: string;
    displayName: string;
    role: MemberRole;
  }, actorId?: string): TenantMember {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    const members = this.members.get(tenantId) ?? [];
    if (members.length >= this.config.maxMembersPerTenant) {
      throw new Error(`Maximum member limit reached (${this.config.maxMembersPerTenant})`);
    }

    // Check plan limit
    if (members.length >= tenant.limits.maxUsers) {
      this.emit('limit:exceeded', tenantId, 'users');
      throw new Error(`Plan limit: maximum ${tenant.limits.maxUsers} users for ${tenant.plan} plan`);
    }

    // Check duplicate
    if (members.some((m) => m.userId === params.userId)) {
      throw new Error(`User ${params.userId} is already a member`);
    }

    const member = this.addMemberInternal(tenantId, params);

    if (actorId) {
      this.logAudit(tenantId, actorId, 'member:added', 'member', {
        userId: params.userId,
        role: params.role,
      });
    }

    return member;
  }

  removeMember(tenantId: string, userId: string, actorId?: string): boolean {
    const members = this.members.get(tenantId);
    if (!members) return false;

    const idx = members.findIndex((m) => m.userId === userId);
    if (idx === -1) return false;

    const member = members[idx];

    // Can't remove the owner
    if (member.role === 'owner') {
      throw new Error('Cannot remove the tenant owner');
    }

    members.splice(idx, 1);

    if (actorId) {
      this.logAudit(tenantId, actorId, 'member:removed', 'member', { userId });
    }

    this.emit('member:removed', member);
    return true;
  }

  changeMemberRole(tenantId: string, userId: string, newRole: MemberRole, actorId?: string): TenantMember {
    const members = this.members.get(tenantId);
    if (!members) throw new Error(`Tenant not found: ${tenantId}`);

    const member = members.find((m) => m.userId === userId);
    if (!member) throw new Error(`Member not found: ${userId}`);

    // Can't change owner role
    if (member.role === 'owner') {
      throw new Error('Cannot change owner role');
    }

    const oldRole = member.role;
    member.role = newRole;
    member.permissions = ROLE_PERMISSIONS[newRole];

    if (actorId) {
      this.logAudit(tenantId, actorId, 'member:role_changed', 'member', {
        userId,
        oldRole,
        newRole,
      });
    }

    this.emit('member:role_changed', member);
    return member;
  }

  getMembers(tenantId: string): TenantMember[] {
    return this.members.get(tenantId) ?? [];
  }

  getMember(tenantId: string, userId: string): TenantMember | undefined {
    const members = this.members.get(tenantId) ?? [];
    return members.find((m) => m.userId === userId);
  }

  // ─── Invitations ──────────────────────────────────────────────

  inviteMember(tenantId: string, params: {
    email: string;
    role: MemberRole;
    invitedBy: string;
  }): TenantInvitation {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    const invitation: TenantInvitation = {
      id: generateId('inv'),
      tenantId,
      email: params.email,
      role: params.role,
      invitedBy: params.invitedBy,
      expiresAt: Date.now() + this.config.invitationExpirationDays * 24 * 60 * 60 * 1000,
      status: 'pending',
    };

    this.invitations.set(invitation.id, invitation);
    this.logAudit(tenantId, params.invitedBy, 'invitation:sent', 'invitation', {
      email: params.email,
      role: params.role,
    });

    this.emit('invitation:sent', invitation);
    return invitation;
  }

  acceptInvitation(invitationId: string, userId: string, displayName: string): TenantMember {
    const invitation = this.invitations.get(invitationId);
    if (!invitation) throw new Error(`Invitation not found: ${invitationId}`);
    if (invitation.status !== 'pending') throw new Error(`Invitation is ${invitation.status}`);
    if (invitation.expiresAt < Date.now()) {
      invitation.status = 'expired';
      throw new Error('Invitation has expired');
    }

    invitation.status = 'accepted';
    invitation.acceptedAt = Date.now();

    const member = this.addMemberInternal(invitation.tenantId, {
      userId,
      email: invitation.email,
      displayName,
      role: invitation.role,
    });

    this.logAudit(invitation.tenantId, userId, 'invitation:accepted', 'invitation', {
      invitationId,
    });

    this.emit('invitation:accepted', invitation);
    return member;
  }

  revokeInvitation(invitationId: string, actorId?: string): boolean {
    const invitation = this.invitations.get(invitationId);
    if (!invitation) return false;
    if (invitation.status !== 'pending') return false;

    invitation.status = 'revoked';

    if (actorId) {
      this.logAudit(invitation.tenantId, actorId, 'invitation:revoked', 'invitation', { invitationId });
    }

    return true;
  }

  listInvitations(tenantId: string, status?: 'pending' | 'accepted' | 'expired' | 'revoked'): TenantInvitation[] {
    const results = Array.from(this.invitations.values()).filter((i) => i.tenantId === tenantId);
    if (status) return results.filter((i) => i.status === status);
    return results;
  }

  // ─── Authorization ────────────────────────────────────────────

  hasPermission(tenantId: string, userId: string, permission: string): boolean {
    const member = this.getMember(tenantId, userId);
    if (!member) return false;
    if (member.status !== 'active') return false;
    return member.permissions.includes(permission);
  }

  checkPermission(tenantId: string, userId: string, permission: string): void {
    if (!this.hasPermission(tenantId, userId, permission)) {
      throw new Error(`Permission denied: ${permission}`);
    }
  }

  // ─── Usage Tracking ───────────────────────────────────────────

  trackUsage(tenantId: string, metric: keyof TenantUsage, amount = 1): TenantUsage {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    if (typeof tenant.usage[metric] === 'number') {
      (tenant.usage[metric] as number) += amount;
    }
    tenant.usage.lastActiveAt = Date.now();

    // Check limits
    this.checkUsageLimits(tenant);

    return tenant.usage;
  }

  getUsage(tenantId: string): TenantUsage | undefined {
    return this.tenants.get(tenantId)?.usage;
  }

  resetMonthlyUsage(tenantId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return;

    tenant.usage.sessionsThisMonth = 0;
    tenant.usage.apiCalls = 0;
  }

  // ─── Feature Flags ────────────────────────────────────────────

  hasFeature(tenantId: string, feature: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    return tenant.features.has(feature);
  }

  enableFeature(tenantId: string, feature: string): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
    tenant.features.add(feature);
    tenant.updatedAt = Date.now();
  }

  disableFeature(tenantId: string, feature: string): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
    tenant.features.delete(feature);
    tenant.updatedAt = Date.now();
  }

  listFeatures(tenantId: string): string[] {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return [];
    return Array.from(tenant.features);
  }

  // ─── Tenant Hierarchy ─────────────────────────────────────────

  getChildTenants(parentId: string): Tenant[] {
    return Array.from(this.tenants.values()).filter((t) => t.parentId === parentId);
  }

  getParentTenant(tenantId: string): Tenant | undefined {
    const tenant = this.tenants.get(tenantId);
    if (!tenant?.parentId) return undefined;
    return this.tenants.get(tenant.parentId);
  }

  // ─── Audit Log ────────────────────────────────────────────────

  getAuditLog(filter?: {
    tenantId?: string;
    userId?: string;
    action?: string;
    since?: number;
    limit?: number;
  }): TenantAuditEntry[] {
    let entries = [...this.auditLog];

    if (filter) {
      if (filter.tenantId) entries = entries.filter((e) => e.tenantId === filter.tenantId);
      if (filter.userId) entries = entries.filter((e) => e.userId === filter.userId);
      if (filter.action) entries = entries.filter((e) => e.action === filter.action);
      if (filter.since) entries = entries.filter((e) => e.timestamp >= filter.since!);
    }

    entries.sort((a, b) => b.timestamp - a.timestamp);
    if (filter?.limit) entries = entries.slice(0, filter.limit);

    return entries;
  }

  // ─── Statistics ───────────────────────────────────────────────

  getTenantStats(): {
    total: number;
    active: number;
    trial: number;
    suspended: number;
    byPlan: Record<TenantPlan, number>;
    totalMembers: number;
    totalUsage: TenantUsage;
  } {
    const tenants = Array.from(this.tenants.values());
    const byPlan: Record<TenantPlan, number> = { free: 0, solo: 0, team: 0, enterprise: 0, reseller: 0 };

    for (const t of tenants) {
      byPlan[t.plan]++;
    }

    let totalMembers = 0;
    for (const members of this.members.values()) {
      totalMembers += members.length;
    }

    const totalUsage: TenantUsage = {
      imagesCaptured: 0,
      agentInvocations: 0,
      voiceCommands: 0,
      apiCalls: 0,
      storageBytes: 0,
      activeUsers: 0,
      sessionsThisMonth: 0,
      lastActiveAt: 0,
    };

    for (const t of tenants) {
      totalUsage.imagesCaptured += t.usage.imagesCaptured;
      totalUsage.agentInvocations += t.usage.agentInvocations;
      totalUsage.voiceCommands += t.usage.voiceCommands;
      totalUsage.apiCalls += t.usage.apiCalls;
      totalUsage.storageBytes += t.usage.storageBytes;
      totalUsage.activeUsers += t.usage.activeUsers;
      totalUsage.sessionsThisMonth += t.usage.sessionsThisMonth;
      if (t.usage.lastActiveAt > totalUsage.lastActiveAt) {
        totalUsage.lastActiveAt = t.usage.lastActiveAt;
      }
    }

    return {
      total: tenants.length,
      active: tenants.filter((t) => t.status === 'active').length,
      trial: tenants.filter((t) => t.status === 'trial').length,
      suspended: tenants.filter((t) => t.status === 'suspended').length,
      byPlan,
      totalMembers,
      totalUsage,
    };
  }

  // ─── Voice Summary ────────────────────────────────────────────

  generateVoiceSummary(tenantId: string): string {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return 'Tenant not found.';

    const parts: string[] = [];
    parts.push(`${tenant.name}: ${tenant.status} on ${tenant.plan} plan.`);

    const members = this.members.get(tenantId) ?? [];
    parts.push(`${members.length} team member${members.length !== 1 ? 's' : ''}.`);

    // Usage highlights
    if (tenant.usage.sessionsThisMonth > 0) {
      parts.push(`${tenant.usage.sessionsThisMonth} sessions this month.`);
    }
    if (tenant.usage.imagesCaptured > 0) {
      parts.push(`${tenant.usage.imagesCaptured} images captured.`);
    }

    // Limit warnings
    const sessionPct = (tenant.usage.sessionsThisMonth / tenant.limits.maxSessionsPerMonth) * 100;
    if (sessionPct > 80) {
      parts.push(`Warning: ${Math.round(sessionPct)}% of monthly session limit used.`);
    }

    // Trial info
    if (tenant.status === 'trial' && tenant.trialEndsAt) {
      const daysLeft = Math.ceil((tenant.trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000));
      if (daysLeft > 0) {
        parts.push(`Trial expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`);
      } else {
        parts.push('Trial has expired. Please upgrade.');
      }
    }

    return parts.join(' ');
  }

  // ─── Data Isolation Helpers ───────────────────────────────────

  /**
   * Validates that an operation is scoped to a specific tenant.
   * Used as a guard before any data access.
   */
  validateTenantAccess(tenantId: string, userId: string): {
    tenant: Tenant;
    member: TenantMember;
    permissions: string[];
  } {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    if (tenant.status === 'suspended') {
      throw new Error('Tenant is suspended');
    }
    if (tenant.status === 'deactivated') {
      throw new Error('Tenant is deactivated');
    }

    const member = this.getMember(tenantId, userId);
    if (!member) throw new Error(`Access denied: user ${userId} is not a member of tenant ${tenantId}`);
    if (member.status !== 'active') throw new Error('Member account is not active');

    return {
      tenant,
      member,
      permissions: member.permissions,
    };
  }

  /**
   * Generates a namespace prefix for data isolation
   */
  getNamespace(tenantId: string): string {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
    return `t_${tenant.slug}`;
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  reset(): void {
    this.tenants.clear();
    this.members.clear();
    this.invitations.clear();
    this.auditLog = [];
    this.slugIndex.clear();
  }

  // ─── Private Helpers ──────────────────────────────────────────

  private generateUniqueSlug(name: string): string {
    let slug = slugify(name);
    let counter = 1;
    while (this.slugIndex.has(slug)) {
      slug = slugify(name) + '-' + counter++;
    }
    return slug;
  }

  private addMemberInternal(tenantId: string, params: {
    userId: string;
    email: string;
    displayName: string;
    role: MemberRole;
  }): TenantMember {
    const now = Date.now();
    const member: TenantMember = {
      id: generateId('mem'),
      tenantId,
      userId: params.userId,
      email: params.email,
      displayName: params.displayName,
      role: params.role,
      status: 'active',
      invitedAt: now,
      joinedAt: now,
      lastActiveAt: now,
      permissions: ROLE_PERMISSIONS[params.role],
    };

    const members = this.members.get(tenantId) ?? [];
    members.push(member);
    this.members.set(tenantId, members);

    this.emit('member:added', member);
    return member;
  }

  private logAudit(
    tenantId: string,
    userId: string,
    action: string,
    resource: string,
    details?: Record<string, unknown>
  ): void {
    const entry: TenantAuditEntry = {
      id: generateId('aud'),
      tenantId,
      userId,
      action,
      resource,
      details,
      timestamp: Date.now(),
    };

    this.auditLog.push(entry);

    if (this.auditLog.length > this.config.maxAuditEntries) {
      this.auditLog.splice(0, this.auditLog.length - this.config.maxAuditEntries);
    }
  }

  private checkUsageLimits(tenant: Tenant): void {
    const checks: Array<{ metric: keyof TenantUsage; limit: keyof TenantLimits; name: string }> = [
      { metric: 'sessionsThisMonth', limit: 'maxSessionsPerMonth', name: 'sessions' },
      { metric: 'apiCalls', limit: 'maxApiCallsPerDay', name: 'api_calls' },
      { metric: 'storageBytes', limit: 'maxStorageBytes', name: 'storage' },
    ];

    for (const check of checks) {
      const usage = tenant.usage[check.metric] as number;
      const limit = tenant.limits[check.limit] as number;
      const pct = (usage / limit) * 100;

      if (pct >= 100) {
        this.emit('limit:exceeded', tenant.id, check.name);
      } else if (pct >= 80) {
        this.emit('limit:approaching', tenant.id, check.name, pct);
      }
    }
  }

  private getDefaultFeatures(plan: TenantPlan): string[] {
    const base = ['inventory', 'voice_commands', 'export_csv'];

    switch (plan) {
      case 'free':
        return base;
      case 'solo':
        return [...base, 'deal_analysis', 'security_scan', 'store_layout'];
      case 'team':
        return [...base, 'deal_analysis', 'security_scan', 'store_layout',
          'meeting_intel', 'networking', 'multi_user', 'api_access'];
      case 'enterprise':
        return [...base, 'deal_analysis', 'security_scan', 'store_layout',
          'meeting_intel', 'networking', 'multi_user', 'api_access',
          'custom_agents', 'sso', 'audit_log', 'compliance', 'white_label'];
      case 'reseller':
        return [...base, 'deal_analysis', 'security_scan', 'store_layout',
          'meeting_intel', 'networking', 'multi_user', 'api_access',
          'custom_agents', 'sso', 'audit_log', 'compliance', 'white_label',
          'reseller_portal', 'sub_tenants'];
      default:
        return base;
    }
  }
}
