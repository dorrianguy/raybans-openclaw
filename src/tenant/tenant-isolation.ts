/**
 * Multi-Tenant Data Isolation Engine
 * 
 * Enterprise customers ($499/mo+) require strict data separation between
 * organizations, stores, and users. This engine provides:
 * 
 * - Tenant CRUD with hierarchy (org → store → user)
 * - Row-level security enforcement via tenant context
 * - Data access policies with permission scoping
 * - Cross-tenant query prevention
 * - Tenant-scoped resource quotas
 * - Audit logging of all cross-boundary access attempts
 * - Data export/import per tenant for portability
 * - Tenant suspension and data purge lifecycle
 * 
 * Every database query, API call, and agent invocation must pass through
 * tenant context validation before accessing data.
 * 
 * 🌙 Built by Night Shift Agent — Night #35
 */

import { EventEmitter } from 'events';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TenantTier = 'free' | 'solo' | 'multi' | 'enterprise' | 'pay_per_count';

export type TenantStatus = 'active' | 'suspended' | 'pending' | 'deactivated' | 'purging';

export type ResourceType = 'store' | 'session' | 'user' | 'agent' | 'export' | 'api_call' | 'image' | 'webhook';

export type PermissionScope = 
  | 'read' | 'write' | 'delete' | 'admin'
  | 'read:inventory' | 'write:inventory'
  | 'read:analytics' | 'write:analytics'
  | 'read:billing' | 'write:billing'
  | 'read:users' | 'write:users' | 'delete:users'
  | 'manage:agents' | 'manage:webhooks'
  | 'export:data' | 'import:data'
  | 'manage:tenants';

export type AccessDecision = 'allow' | 'deny' | 'escalate';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  tier: TenantTier;
  status: TenantStatus;
  parentId?: string;          // for org → store hierarchy
  ownerId: string;            // user who owns this tenant
  metadata: Record<string, unknown>;
  quotas: ResourceQuotas;
  usage: ResourceUsage;
  settings: TenantSettings;
  createdAt: number;
  updatedAt: number;
  suspendedAt?: number;
  suspendReason?: string;
  deactivatedAt?: number;
}

export interface ResourceQuotas {
  maxStores: number;
  maxUsers: number;
  maxSessions: number;
  maxAgents: number;
  maxExportsPerDay: number;
  maxApiCallsPerHour: number;
  maxImagesPerSession: number;
  maxWebhooks: number;
  maxStorageMb: number;
}

export interface ResourceUsage {
  stores: number;
  users: number;
  activeSessions: number;
  agents: number;
  exportsToday: number;
  apiCallsThisHour: number;
  imagesThisSession: number;
  webhooks: number;
  storageMb: number;
}

export interface TenantSettings {
  dataRetentionDays: number;
  allowCrossTenantSharing: boolean;
  requireMfa: boolean;
  ipWhitelist: string[];
  customDomain?: string;
  webhookSecret?: string;
  timezone: string;
  locale: string;
}

export interface TenantMember {
  userId: string;
  tenantId: string;
  role: TenantRole;
  permissions: PermissionScope[];
  joinedAt: number;
  lastActiveAt: number;
  invitedBy?: string;
  status: 'active' | 'invited' | 'suspended';
}

export type TenantRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'api_key';

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: TenantRole;
  permissions: PermissionScope[];
  tier: TenantTier;
  parentTenantId?: string;
}

export interface AccessRequest {
  context: TenantContext;
  resource: ResourceType;
  action: 'read' | 'write' | 'delete' | 'list';
  targetTenantId?: string;  // for cross-tenant checks
  metadata?: Record<string, unknown>;
}

export interface AccessResult {
  decision: AccessDecision;
  reason: string;
  auditId?: string;
}

export interface DataPolicy {
  id: string;
  name: string;
  tenantId?: string;        // null = global policy
  conditions: PolicyCondition[];
  effect: 'allow' | 'deny';
  priority: number;          // higher = evaluated first
  enabled: boolean;
  createdAt: number;
}

export interface PolicyCondition {
  field: 'role' | 'permission' | 'tier' | 'resource' | 'action' | 'ip' | 'time' | 'status';
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'lt' | 'contains';
  value: string | string[] | number;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  tenantId: string;
  userId: string;
  action: string;
  resource: ResourceType;
  targetTenantId?: string;
  decision: AccessDecision;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface TenantIsolationConfig {
  maxTenantsPerOrg: number;
  maxMembersPerTenant: number;
  maxPolicies: number;
  auditRetentionDays: number;
  maxAuditEntries: number;
  enableCrossTenantAudit: boolean;
  defaultQuotas: Record<TenantTier, ResourceQuotas>;
}

export interface TenantExport {
  tenantId: string;
  exportedAt: number;
  version: string;
  data: {
    tenant: Omit<Tenant, 'usage'>;
    members: Omit<TenantMember, 'lastActiveAt'>[];
    policies: DataPolicy[];
    settings: TenantSettings;
  };
}

export interface TenantIsolationEvents {
  'tenant:created': (tenant: Tenant) => void;
  'tenant:updated': (tenant: Tenant) => void;
  'tenant:suspended': (tenantId: string, reason: string) => void;
  'tenant:reactivated': (tenantId: string) => void;
  'tenant:deactivated': (tenantId: string) => void;
  'tenant:purged': (tenantId: string) => void;
  'access:denied': (entry: AuditEntry) => void;
  'access:escalated': (entry: AuditEntry) => void;
  'quota:approaching': (tenantId: string, resource: ResourceType, usage: number, limit: number) => void;
  'quota:exceeded': (tenantId: string, resource: ResourceType, usage: number, limit: number) => void;
  'member:added': (member: TenantMember) => void;
  'member:removed': (tenantId: string, userId: string) => void;
  'policy:violated': (entry: AuditEntry) => void;
  'cross_tenant:blocked': (entry: AuditEntry) => void;
}

// ─── Default Quotas by Tier ──────────────────────────────────────────────────

const DEFAULT_TIER_QUOTAS: Record<TenantTier, ResourceQuotas> = {
  free: {
    maxStores: 1,
    maxUsers: 1,
    maxSessions: 5,
    maxAgents: 3,
    maxExportsPerDay: 2,
    maxApiCallsPerHour: 100,
    maxImagesPerSession: 500,
    maxWebhooks: 1,
    maxStorageMb: 100,
  },
  solo: {
    maxStores: 1,
    maxUsers: 3,
    maxSessions: 50,
    maxAgents: 10,
    maxExportsPerDay: 10,
    maxApiCallsPerHour: 1000,
    maxImagesPerSession: 5000,
    maxWebhooks: 5,
    maxStorageMb: 1000,
  },
  multi: {
    maxStores: 10,
    maxUsers: 25,
    maxSessions: 200,
    maxAgents: 25,
    maxExportsPerDay: 50,
    maxApiCallsPerHour: 5000,
    maxImagesPerSession: 20000,
    maxWebhooks: 20,
    maxStorageMb: 10000,
  },
  enterprise: {
    maxStores: 100,
    maxUsers: 500,
    maxSessions: 1000,
    maxAgents: 100,
    maxExportsPerDay: 500,
    maxApiCallsPerHour: 50000,
    maxImagesPerSession: 100000,
    maxWebhooks: 100,
    maxStorageMb: 100000,
  },
  pay_per_count: {
    maxStores: 5,
    maxUsers: 10,
    maxSessions: 100,
    maxAgents: 15,
    maxExportsPerDay: 25,
    maxApiCallsPerHour: 2500,
    maxImagesPerSession: 10000,
    maxWebhooks: 10,
    maxStorageMb: 5000,
  },
};

// ─── Role Permissions ────────────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<TenantRole, PermissionScope[]> = {
  owner: [
    'read', 'write', 'delete', 'admin',
    'read:inventory', 'write:inventory',
    'read:analytics', 'write:analytics',
    'read:billing', 'write:billing',
    'read:users', 'write:users', 'delete:users',
    'manage:agents', 'manage:webhooks',
    'export:data', 'import:data',
    'manage:tenants',
  ],
  admin: [
    'read', 'write', 'delete',
    'read:inventory', 'write:inventory',
    'read:analytics', 'write:analytics',
    'read:billing',
    'read:users', 'write:users',
    'manage:agents', 'manage:webhooks',
    'export:data', 'import:data',
  ],
  manager: [
    'read', 'write',
    'read:inventory', 'write:inventory',
    'read:analytics',
    'read:users',
    'manage:agents',
    'export:data',
  ],
  member: [
    'read',
    'read:inventory', 'write:inventory',
    'export:data',
  ],
  viewer: [
    'read',
    'read:inventory',
    'read:analytics',
  ],
  api_key: [
    'read',
    'read:inventory',
    'export:data',
  ],
};

// ─── Engine ──────────────────────────────────────────────────────────────────

export class TenantIsolationEngine extends EventEmitter {
  private tenants: Map<string, Tenant> = new Map();
  private members: Map<string, TenantMember[]> = new Map();  // tenantId → members
  private policies: DataPolicy[] = [];
  private auditLog: AuditEntry[] = [];
  private config: TenantIsolationConfig;
  private idCounter = 0;

  constructor(config?: Partial<TenantIsolationConfig>) {
    super();
    this.config = {
      maxTenantsPerOrg: config?.maxTenantsPerOrg ?? 50,
      maxMembersPerTenant: config?.maxMembersPerTenant ?? 500,
      maxPolicies: config?.maxPolicies ?? 100,
      auditRetentionDays: config?.auditRetentionDays ?? 90,
      maxAuditEntries: config?.maxAuditEntries ?? 50000,
      enableCrossTenantAudit: config?.enableCrossTenantAudit ?? true,
      defaultQuotas: config?.defaultQuotas ?? DEFAULT_TIER_QUOTAS,
    };
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${++this.idCounter}`;
  }

  // ─── Tenant CRUD ─────────────────────────────────────────────────────────

  createTenant(params: {
    name: string;
    slug: string;
    tier: TenantTier;
    ownerId: string;
    parentId?: string;
    metadata?: Record<string, unknown>;
    settings?: Partial<TenantSettings>;
    quotaOverrides?: Partial<ResourceQuotas>;
  }): Tenant {
    // Validate slug uniqueness
    for (const t of this.tenants.values()) {
      if (t.slug === params.slug) {
        throw new Error(`Tenant slug '${params.slug}' already exists`);
      }
    }

    // Validate parent exists if specified
    if (params.parentId) {
      const parent = this.tenants.get(params.parentId);
      if (!parent) {
        throw new Error(`Parent tenant '${params.parentId}' not found`);
      }
      // Check org limit
      const childCount = this.getChildTenants(params.parentId).length;
      if (childCount >= this.config.maxTenantsPerOrg) {
        throw new Error(`Parent tenant has reached max child tenants (${this.config.maxTenantsPerOrg})`);
      }
    }

    const quotas = {
      ...this.config.defaultQuotas[params.tier],
      ...(params.quotaOverrides ?? {}),
    };

    const tenant: Tenant = {
      id: this.generateId('tenant'),
      name: params.name,
      slug: params.slug,
      tier: params.tier,
      status: 'active',
      parentId: params.parentId,
      ownerId: params.ownerId,
      metadata: params.metadata ?? {},
      quotas,
      usage: {
        stores: 0,
        users: 0,
        activeSessions: 0,
        agents: 0,
        exportsToday: 0,
        apiCallsThisHour: 0,
        imagesThisSession: 0,
        webhooks: 0,
        storageMb: 0,
      },
      settings: {
        dataRetentionDays: params.settings?.dataRetentionDays ?? 365,
        allowCrossTenantSharing: params.settings?.allowCrossTenantSharing ?? false,
        requireMfa: params.settings?.requireMfa ?? false,
        ipWhitelist: params.settings?.ipWhitelist ?? [],
        customDomain: params.settings?.customDomain,
        webhookSecret: params.settings?.webhookSecret,
        timezone: params.settings?.timezone ?? 'UTC',
        locale: params.settings?.locale ?? 'en-US',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tenants.set(tenant.id, tenant);
    this.members.set(tenant.id, []);

    // Auto-add owner as member
    this.addMember(tenant.id, {
      userId: params.ownerId,
      role: 'owner',
    });

    this.emit('tenant:created', tenant);
    return tenant;
  }

  getTenant(tenantId: string): Tenant | undefined {
    return this.tenants.get(tenantId);
  }

  getTenantBySlug(slug: string): Tenant | undefined {
    for (const t of this.tenants.values()) {
      if (t.slug === slug) return t;
    }
    return undefined;
  }

  updateTenant(tenantId: string, updates: {
    name?: string;
    tier?: TenantTier;
    metadata?: Record<string, unknown>;
    settings?: Partial<TenantSettings>;
    quotaOverrides?: Partial<ResourceQuotas>;
  }): Tenant {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);

    if (updates.name !== undefined) tenant.name = updates.name;
    if (updates.tier !== undefined) {
      tenant.tier = updates.tier;
      // Update quotas to new tier defaults (preserving overrides)
      const newDefaults = this.config.defaultQuotas[updates.tier];
      tenant.quotas = { ...newDefaults, ...(updates.quotaOverrides ?? {}) };
    } else if (updates.quotaOverrides) {
      tenant.quotas = { ...tenant.quotas, ...updates.quotaOverrides };
    }
    if (updates.metadata !== undefined) {
      tenant.metadata = { ...tenant.metadata, ...updates.metadata };
    }
    if (updates.settings !== undefined) {
      tenant.settings = { ...tenant.settings, ...updates.settings };
    }
    tenant.updatedAt = Date.now();

    this.tenants.set(tenantId, tenant);
    this.emit('tenant:updated', tenant);
    return tenant;
  }

  suspendTenant(tenantId: string, reason: string): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);
    if (tenant.status === 'suspended') throw new Error('Tenant is already suspended');

    tenant.status = 'suspended';
    tenant.suspendedAt = Date.now();
    tenant.suspendReason = reason;
    tenant.updatedAt = Date.now();

    this.tenants.set(tenantId, tenant);
    this.emit('tenant:suspended', tenantId, reason);
  }

  reactivateTenant(tenantId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);
    if (tenant.status !== 'suspended') throw new Error('Tenant is not suspended');

    tenant.status = 'active';
    tenant.suspendedAt = undefined;
    tenant.suspendReason = undefined;
    tenant.updatedAt = Date.now();

    this.tenants.set(tenantId, tenant);
    this.emit('tenant:reactivated', tenantId);
  }

  deactivateTenant(tenantId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);

    tenant.status = 'deactivated';
    tenant.deactivatedAt = Date.now();
    tenant.updatedAt = Date.now();

    this.tenants.set(tenantId, tenant);
    this.emit('tenant:deactivated', tenantId);
  }

  purgeTenant(tenantId: string): { success: boolean; purgedData: string[] } {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);
    if (tenant.status !== 'deactivated') {
      throw new Error('Tenant must be deactivated before purging');
    }

    const purgedData: string[] = [];

    // Remove members
    const memberCount = (this.members.get(tenantId) ?? []).length;
    this.members.delete(tenantId);
    purgedData.push(`${memberCount} members`);

    // Remove tenant-specific policies
    const policyCount = this.policies.filter(p => p.tenantId === tenantId).length;
    this.policies = this.policies.filter(p => p.tenantId !== tenantId);
    purgedData.push(`${policyCount} policies`);

    // Remove audit entries
    const auditCount = this.auditLog.filter(a => a.tenantId === tenantId).length;
    this.auditLog = this.auditLog.filter(a => a.tenantId !== tenantId);
    purgedData.push(`${auditCount} audit entries`);

    // Remove child tenants
    const children = this.getChildTenants(tenantId);
    for (const child of children) {
      child.status = 'deactivated';
      child.deactivatedAt = Date.now();
      this.purgeTenant(child.id);
    }
    if (children.length > 0) {
      purgedData.push(`${children.length} child tenants`);
    }

    // Remove the tenant itself
    this.tenants.delete(tenantId);
    purgedData.push('tenant record');

    this.emit('tenant:purged', tenantId);
    return { success: true, purgedData };
  }

  listTenants(filters?: {
    tier?: TenantTier;
    status?: TenantStatus;
    parentId?: string;
    ownerId?: string;
  }): Tenant[] {
    let results = Array.from(this.tenants.values());

    if (filters?.tier) {
      results = results.filter(t => t.tier === filters.tier);
    }
    if (filters?.status) {
      results = results.filter(t => t.status === filters.status);
    }
    if (filters?.parentId) {
      results = results.filter(t => t.parentId === filters.parentId);
    }
    if (filters?.ownerId) {
      results = results.filter(t => t.ownerId === filters.ownerId);
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  getChildTenants(parentId: string): Tenant[] {
    return Array.from(this.tenants.values())
      .filter(t => t.parentId === parentId);
  }

  // ─── Member Management ───────────────────────────────────────────────────

  addMember(tenantId: string, params: {
    userId: string;
    role: TenantRole;
    permissions?: PermissionScope[];
    invitedBy?: string;
  }): TenantMember {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);

    const existing = this.members.get(tenantId) ?? [];

    // Check for duplicate
    if (existing.some(m => m.userId === params.userId)) {
      throw new Error(`User '${params.userId}' is already a member of tenant '${tenantId}'`);
    }

    // Check member limit
    if (existing.length >= this.config.maxMembersPerTenant) {
      throw new Error(`Tenant has reached maximum members (${this.config.maxMembersPerTenant})`);
    }

    // Check tenant quota
    if (existing.length >= tenant.quotas.maxUsers) {
      this.emit('quota:exceeded', tenantId, 'user', existing.length, tenant.quotas.maxUsers);
      throw new Error(`Tenant user quota exceeded (${tenant.quotas.maxUsers})`);
    }

    const rolePerms = ROLE_PERMISSIONS[params.role] ?? [];
    const member: TenantMember = {
      userId: params.userId,
      tenantId,
      role: params.role,
      permissions: params.permissions ?? rolePerms,
      joinedAt: Date.now(),
      lastActiveAt: Date.now(),
      invitedBy: params.invitedBy,
      status: params.invitedBy ? 'invited' : 'active',
    };

    existing.push(member);
    this.members.set(tenantId, existing);

    // Update usage
    tenant.usage.users = existing.length;
    this.tenants.set(tenantId, tenant);

    this.emit('member:added', member);
    return member;
  }

  removeMember(tenantId: string, userId: string): void {
    const members = this.members.get(tenantId);
    if (!members) throw new Error(`Tenant '${tenantId}' not found`);

    const member = members.find(m => m.userId === userId);
    if (!member) throw new Error(`User '${userId}' is not a member of tenant '${tenantId}'`);

    if (member.role === 'owner') {
      // Check if there are other owners
      const otherOwners = members.filter(m => m.role === 'owner' && m.userId !== userId);
      if (otherOwners.length === 0) {
        throw new Error('Cannot remove the last owner of a tenant');
      }
    }

    const filtered = members.filter(m => m.userId !== userId);
    this.members.set(tenantId, filtered);

    // Update usage
    const tenant = this.tenants.get(tenantId);
    if (tenant) {
      tenant.usage.users = filtered.length;
      this.tenants.set(tenantId, tenant);
    }

    this.emit('member:removed', tenantId, userId);
  }

  getMember(tenantId: string, userId: string): TenantMember | undefined {
    return (this.members.get(tenantId) ?? []).find(m => m.userId === userId);
  }

  getMembers(tenantId: string): TenantMember[] {
    return this.members.get(tenantId) ?? [];
  }

  updateMemberRole(tenantId: string, userId: string, newRole: TenantRole): TenantMember {
    const members = this.members.get(tenantId);
    if (!members) throw new Error(`Tenant '${tenantId}' not found`);

    const member = members.find(m => m.userId === userId);
    if (!member) throw new Error(`User '${userId}' is not a member of tenant '${tenantId}'`);

    // If demoting from owner, check for other owners
    if (member.role === 'owner' && newRole !== 'owner') {
      const otherOwners = members.filter(m => m.role === 'owner' && m.userId !== userId);
      if (otherOwners.length === 0) {
        throw new Error('Cannot demote the last owner');
      }
    }

    member.role = newRole;
    member.permissions = ROLE_PERMISSIONS[newRole] ?? [];
    this.members.set(tenantId, members);

    return member;
  }

  getUserTenants(userId: string): Array<{ tenant: Tenant; membership: TenantMember }> {
    const results: Array<{ tenant: Tenant; membership: TenantMember }> = [];

    for (const [tenantId, members] of this.members.entries()) {
      const membership = members.find(m => m.userId === userId);
      if (membership) {
        const tenant = this.tenants.get(tenantId);
        if (tenant) {
          results.push({ tenant, membership });
        }
      }
    }

    return results;
  }

  // ─── Access Control ──────────────────────────────────────────────────────

  buildContext(tenantId: string, userId: string): TenantContext {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);

    const member = this.getMember(tenantId, userId);
    if (!member) throw new Error(`User '${userId}' is not a member of tenant '${tenantId}'`);

    return {
      tenantId,
      userId,
      role: member.role,
      permissions: member.permissions,
      tier: tenant.tier,
      parentTenantId: tenant.parentId,
    };
  }

  checkAccess(request: AccessRequest): AccessResult {
    const { context, resource, action, targetTenantId } = request;

    // Check tenant status first
    const tenant = this.tenants.get(context.tenantId);
    if (!tenant || tenant.status !== 'active') {
      const result: AccessResult = {
        decision: 'deny',
        reason: tenant ? `Tenant is ${tenant.status}` : 'Tenant not found',
      };
      this.logAccess(context, resource, action, result, targetTenantId);
      return result;
    }

    // Cross-tenant access check
    if (targetTenantId && targetTenantId !== context.tenantId) {
      return this.checkCrossTenantAccess(request);
    }

    // Check policies (custom rules first)
    const policyResult = this.evaluatePolicies(request);
    if (policyResult) {
      this.logAccess(context, resource, action, policyResult, targetTenantId);
      return policyResult;
    }

    // Check role-based permissions
    const requiredPermission = this.mapActionToPermission(resource, action);
    if (requiredPermission && !context.permissions.includes(requiredPermission) && !context.permissions.includes('admin')) {
      const result: AccessResult = {
        decision: 'deny',
        reason: `Missing permission: ${requiredPermission}`,
      };
      this.logAccess(context, resource, action, result, targetTenantId);
      this.emit('access:denied', this.auditLog[this.auditLog.length - 1]);
      return result;
    }

    // Check quota for write actions
    if (action === 'write') {
      const quotaResult = this.checkQuota(context.tenantId, resource);
      if (quotaResult) {
        this.logAccess(context, resource, action, quotaResult, targetTenantId);
        return quotaResult;
      }
    }

    const result: AccessResult = { decision: 'allow', reason: 'Authorized' };
    this.logAccess(context, resource, action, result, targetTenantId);
    return result;
  }

  private checkCrossTenantAccess(request: AccessRequest): AccessResult {
    const { context, resource, action, targetTenantId } = request;

    // Check if source tenant allows cross-tenant sharing
    const sourceTenant = this.tenants.get(context.tenantId);
    const targetTenant = targetTenantId ? this.tenants.get(targetTenantId) : undefined;

    // Allow parent-child access
    if (targetTenant && (
      targetTenant.parentId === context.tenantId ||
      sourceTenant?.parentId === targetTenantId
    )) {
      // Parent can read child data, child can read parent data
      if (action === 'read' && context.permissions.includes('admin')) {
        const result: AccessResult = {
          decision: 'allow',
          reason: 'Parent-child tenant relationship',
        };
        this.logAccess(context, resource, action, result, targetTenantId);
        return result;
      }
    }

    // Check if target allows sharing
    if (targetTenant?.settings.allowCrossTenantSharing && action === 'read') {
      const result: AccessResult = {
        decision: 'allow',
        reason: 'Target tenant allows cross-tenant sharing',
      };
      this.logAccess(context, resource, action, result, targetTenantId);
      return result;
    }

    // Deny cross-tenant access by default
    const result: AccessResult = {
      decision: 'deny',
      reason: 'Cross-tenant access not permitted',
    };
    this.logAccess(context, resource, action, result, targetTenantId);

    const entry = this.auditLog[this.auditLog.length - 1];
    this.emit('cross_tenant:blocked', entry);
    this.emit('access:denied', entry);
    return result;
  }

  private mapActionToPermission(resource: ResourceType, action: string): PermissionScope | null {
    const mapping: Record<string, Record<string, PermissionScope>> = {
      store: { read: 'read:inventory', write: 'write:inventory', delete: 'delete', list: 'read:inventory' },
      session: { read: 'read:inventory', write: 'write:inventory', delete: 'delete', list: 'read:inventory' },
      user: { read: 'read:users', write: 'write:users', delete: 'delete:users', list: 'read:users' },
      agent: { read: 'read', write: 'manage:agents', delete: 'manage:agents', list: 'read' },
      export: { read: 'export:data', write: 'export:data', delete: 'delete', list: 'export:data' },
      api_call: { read: 'read', write: 'read', delete: 'admin', list: 'read' },
      image: { read: 'read:inventory', write: 'write:inventory', delete: 'delete', list: 'read:inventory' },
      webhook: { read: 'manage:webhooks', write: 'manage:webhooks', delete: 'manage:webhooks', list: 'manage:webhooks' },
    };

    return mapping[resource]?.[action] ?? null;
  }

  // ─── Policy Management ───────────────────────────────────────────────────

  addPolicy(policy: Omit<DataPolicy, 'id' | 'createdAt'>): DataPolicy {
    if (this.policies.length >= this.config.maxPolicies) {
      throw new Error(`Maximum policies reached (${this.config.maxPolicies})`);
    }

    const newPolicy: DataPolicy = {
      ...policy,
      id: this.generateId('policy'),
      createdAt: Date.now(),
    };

    this.policies.push(newPolicy);
    // Sort by priority descending
    this.policies.sort((a, b) => b.priority - a.priority);
    return newPolicy;
  }

  removePolicy(policyId: string): void {
    this.policies = this.policies.filter(p => p.id !== policyId);
  }

  getPolicies(tenantId?: string): DataPolicy[] {
    if (tenantId) {
      return this.policies.filter(p => p.tenantId === tenantId || !p.tenantId);
    }
    return [...this.policies];
  }

  private evaluatePolicies(request: AccessRequest): AccessResult | null {
    const { context, resource, action } = request;

    // Get applicable policies (tenant-specific + global)
    const applicable = this.policies.filter(p =>
      p.enabled && (!p.tenantId || p.tenantId === context.tenantId)
    );

    for (const policy of applicable) {
      if (this.matchesPolicy(policy, request)) {
        if (policy.effect === 'deny') {
          return {
            decision: 'deny',
            reason: `Policy '${policy.name}' denied access`,
          };
        }
        if (policy.effect === 'allow') {
          return {
            decision: 'allow',
            reason: `Policy '${policy.name}' allowed access`,
          };
        }
      }
    }

    return null; // No policy matched
  }

  private matchesPolicy(policy: DataPolicy, request: AccessRequest): boolean {
    const { context, resource, action } = request;

    return policy.conditions.every(condition => {
      const value = this.getConditionValue(condition.field, context, resource, action);
      return this.evaluateCondition(condition, value);
    });
  }

  private getConditionValue(
    field: PolicyCondition['field'],
    context: TenantContext,
    resource: ResourceType,
    action: string
  ): string | number {
    switch (field) {
      case 'role': return context.role;
      case 'tier': return context.tier;
      case 'resource': return resource;
      case 'action': return action;
      case 'status': {
        const tenant = this.tenants.get(context.tenantId);
        return tenant?.status ?? 'unknown';
      }
      default: return '';
    }
  }

  private evaluateCondition(condition: PolicyCondition, value: string | number): boolean {
    switch (condition.operator) {
      case 'eq': return value === condition.value;
      case 'neq': return value !== condition.value;
      case 'in': return Array.isArray(condition.value) && condition.value.includes(value as string);
      case 'not_in': return Array.isArray(condition.value) && !condition.value.includes(value as string);
      case 'gt': return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;
      case 'lt': return typeof value === 'number' && typeof condition.value === 'number' && value < condition.value;
      case 'contains': return typeof value === 'string' && typeof condition.value === 'string' && value.includes(condition.value);
      default: return false;
    }
  }

  // ─── Quota Management ────────────────────────────────────────────────────

  private checkQuota(tenantId: string, resource: ResourceType): AccessResult | null {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return { decision: 'deny', reason: 'Tenant not found' };

    const quotaMap: Record<ResourceType, { usage: number; limit: number }> = {
      store: { usage: tenant.usage.stores, limit: tenant.quotas.maxStores },
      session: { usage: tenant.usage.activeSessions, limit: tenant.quotas.maxSessions },
      user: { usage: tenant.usage.users, limit: tenant.quotas.maxUsers },
      agent: { usage: tenant.usage.agents, limit: tenant.quotas.maxAgents },
      export: { usage: tenant.usage.exportsToday, limit: tenant.quotas.maxExportsPerDay },
      api_call: { usage: tenant.usage.apiCallsThisHour, limit: tenant.quotas.maxApiCallsPerHour },
      image: { usage: tenant.usage.imagesThisSession, limit: tenant.quotas.maxImagesPerSession },
      webhook: { usage: tenant.usage.webhooks, limit: tenant.quotas.maxWebhooks },
    };

    const entry = quotaMap[resource];
    if (!entry) return null;

    // Check if approaching (80%+)
    const ratio = entry.usage / entry.limit;
    if (ratio >= 0.8 && ratio < 1.0) {
      this.emit('quota:approaching', tenantId, resource, entry.usage, entry.limit);
    }

    if (entry.usage >= entry.limit) {
      this.emit('quota:exceeded', tenantId, resource, entry.usage, entry.limit);
      return {
        decision: 'deny',
        reason: `Quota exceeded for ${resource}: ${entry.usage}/${entry.limit}`,
      };
    }

    return null;
  }

  incrementUsage(tenantId: string, resource: ResourceType, amount: number = 1): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);

    const usageMap: Record<ResourceType, keyof ResourceUsage> = {
      store: 'stores',
      session: 'activeSessions',
      user: 'users',
      agent: 'agents',
      export: 'exportsToday',
      api_call: 'apiCallsThisHour',
      image: 'imagesThisSession',
      webhook: 'webhooks',
    };

    const key = usageMap[resource];
    if (key) {
      (tenant.usage[key] as number) += amount;
      this.tenants.set(tenantId, tenant);
    }
  }

  decrementUsage(tenantId: string, resource: ResourceType, amount: number = 1): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);

    const usageMap: Record<ResourceType, keyof ResourceUsage> = {
      store: 'stores',
      session: 'activeSessions',
      user: 'users',
      agent: 'agents',
      export: 'exportsToday',
      api_call: 'apiCallsThisHour',
      image: 'imagesThisSession',
      webhook: 'webhooks',
    };

    const key = usageMap[resource];
    if (key) {
      (tenant.usage[key] as number) = Math.max(0, (tenant.usage[key] as number) - amount);
      this.tenants.set(tenantId, tenant);
    }
  }

  resetDailyUsage(tenantId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return;

    tenant.usage.exportsToday = 0;
    this.tenants.set(tenantId, tenant);
  }

  resetHourlyUsage(tenantId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return;

    tenant.usage.apiCallsThisHour = 0;
    this.tenants.set(tenantId, tenant);
  }

  getUsageSummary(tenantId: string): {
    resources: Array<{
      resource: ResourceType;
      usage: number;
      limit: number;
      percentage: number;
      status: 'ok' | 'warning' | 'critical';
    }>;
    overallHealth: 'healthy' | 'warning' | 'critical';
  } {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);

    const resources: Array<{
      resource: ResourceType;
      usage: number;
      limit: number;
      percentage: number;
      status: 'ok' | 'warning' | 'critical';
    }> = [
      { resource: 'store', usage: tenant.usage.stores, limit: tenant.quotas.maxStores, percentage: 0, status: 'ok' },
      { resource: 'user', usage: tenant.usage.users, limit: tenant.quotas.maxUsers, percentage: 0, status: 'ok' },
      { resource: 'session', usage: tenant.usage.activeSessions, limit: tenant.quotas.maxSessions, percentage: 0, status: 'ok' },
      { resource: 'agent', usage: tenant.usage.agents, limit: tenant.quotas.maxAgents, percentage: 0, status: 'ok' },
      { resource: 'export', usage: tenant.usage.exportsToday, limit: tenant.quotas.maxExportsPerDay, percentage: 0, status: 'ok' },
      { resource: 'api_call', usage: tenant.usage.apiCallsThisHour, limit: tenant.quotas.maxApiCallsPerHour, percentage: 0, status: 'ok' },
      { resource: 'webhook', usage: tenant.usage.webhooks, limit: tenant.quotas.maxWebhooks, percentage: 0, status: 'ok' },
    ];

    for (const r of resources) {
      r.percentage = r.limit > 0 ? Math.round((r.usage / r.limit) * 100) : 0;
      if (r.percentage >= 100) r.status = 'critical';
      else if (r.percentage >= 80) r.status = 'warning';
    }

    const criticalCount = resources.filter(r => r.status === 'critical').length;
    const warningCount = resources.filter(r => r.status === 'warning').length;

    return {
      resources,
      overallHealth: criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'healthy',
    };
  }

  // ─── Audit Log ───────────────────────────────────────────────────────────

  private logAccess(
    context: TenantContext,
    resource: ResourceType,
    action: string,
    result: AccessResult,
    targetTenantId?: string
  ): void {
    const entry: AuditEntry = {
      id: this.generateId('audit'),
      timestamp: Date.now(),
      tenantId: context.tenantId,
      userId: context.userId,
      action,
      resource,
      targetTenantId,
      decision: result.decision,
      reason: result.reason,
    };

    this.auditLog.push(entry);
    result.auditId = entry.id;

    // Trim if needed
    if (this.auditLog.length > this.config.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-Math.floor(this.config.maxAuditEntries * 0.75));
    }
  }

  getAuditLog(filters?: {
    tenantId?: string;
    userId?: string;
    resource?: ResourceType;
    decision?: AccessDecision;
    since?: number;
    limit?: number;
  }): AuditEntry[] {
    let results = [...this.auditLog];

    if (filters?.tenantId) {
      results = results.filter(e => e.tenantId === filters.tenantId);
    }
    if (filters?.userId) {
      results = results.filter(e => e.userId === filters.userId);
    }
    if (filters?.resource) {
      results = results.filter(e => e.resource === filters.resource);
    }
    if (filters?.decision) {
      results = results.filter(e => e.decision === filters.decision);
    }
    if (filters?.since) {
      results = results.filter(e => e.timestamp >= filters.since!);
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    if (filters?.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  // ─── Data Export/Import ──────────────────────────────────────────────────

  exportTenantData(tenantId: string): TenantExport {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);

    const members = (this.members.get(tenantId) ?? []).map(m => {
      const { lastActiveAt, ...rest } = m;
      return rest;
    });

    const policies = this.policies.filter(p => p.tenantId === tenantId);

    const { usage, ...tenantData } = tenant;

    return {
      tenantId,
      exportedAt: Date.now(),
      version: '1.0.0',
      data: {
        tenant: tenantData,
        members,
        policies,
        settings: tenant.settings,
      },
    };
  }

  importTenantData(data: TenantExport, newOwnerId?: string): Tenant {
    // Create new tenant from exported data
    const imported = this.createTenant({
      name: data.data.tenant.name + ' (imported)',
      slug: data.data.tenant.slug + '-imported-' + Date.now(),
      tier: data.data.tenant.tier,
      ownerId: newOwnerId ?? data.data.tenant.ownerId,
      settings: data.data.settings,
    });

    // Import policies
    for (const policy of data.data.policies) {
      this.addPolicy({
        ...policy,
        tenantId: imported.id,
      });
    }

    return imported;
  }

  // ─── Voice Summary ───────────────────────────────────────────────────────

  getVoiceSummary(tenantId: string): string {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return 'Tenant not found.';

    const usage = this.getUsageSummary(tenantId);
    const members = this.getMembers(tenantId);

    const parts: string[] = [];
    parts.push(`Tenant ${tenant.name}, ${tenant.tier} plan, ${tenant.status}.`);
    parts.push(`${members.length} members.`);

    const criticals = usage.resources.filter(r => r.status === 'critical');
    const warnings = usage.resources.filter(r => r.status === 'warning');

    if (criticals.length > 0) {
      parts.push(`Warning: ${criticals.map(r => r.resource).join(', ')} at capacity.`);
    }
    if (warnings.length > 0) {
      parts.push(`Approaching limits on ${warnings.map(r => r.resource).join(', ')}.`);
    }

    if (usage.overallHealth === 'healthy') {
      parts.push('All quotas healthy.');
    }

    return parts.join(' ');
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  getStats(): {
    totalTenants: number;
    activeTenants: number;
    suspendedTenants: number;
    byTier: Record<TenantTier, number>;
    totalMembers: number;
    totalPolicies: number;
    totalAuditEntries: number;
    recentDenials: number;
  } {
    const tenants = Array.from(this.tenants.values());

    const byTier: Record<TenantTier, number> = {
      free: 0, solo: 0, multi: 0, enterprise: 0, pay_per_count: 0,
    };
    for (const t of tenants) {
      byTier[t.tier]++;
    }

    let totalMembers = 0;
    for (const members of this.members.values()) {
      totalMembers += members.length;
    }

    const oneHourAgo = Date.now() - 3600000;
    const recentDenials = this.auditLog.filter(
      e => e.decision === 'deny' && e.timestamp > oneHourAgo
    ).length;

    return {
      totalTenants: tenants.length,
      activeTenants: tenants.filter(t => t.status === 'active').length,
      suspendedTenants: tenants.filter(t => t.status === 'suspended').length,
      byTier,
      totalMembers,
      totalPolicies: this.policies.length,
      totalAuditEntries: this.auditLog.length,
      recentDenials,
    };
  }
}

export function getRolePermissions(role: TenantRole): PermissionScope[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function getDefaultQuotas(tier: TenantTier): ResourceQuotas {
  return { ...DEFAULT_TIER_QUOTAS[tier] };
}
