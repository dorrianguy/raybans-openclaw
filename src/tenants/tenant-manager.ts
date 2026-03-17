/**
 * Multi-Tenant Manager
 * 
 * Enterprise-grade tenant isolation for the Ray-Bans × OpenClaw platform.
 * Required for $199/mo Multi-Store and $499/mo Enterprise tiers.
 * 
 * Features:
 * - Organization management (create, update, deactivate)
 * - Hierarchical roles: owner, admin, manager, member, viewer
 * - Fine-grained permission system (26 permissions across 6 domains)
 * - Team management (invite, remove, role changes)
 * - Org-level settings and feature flags
 * - Usage quotas per organization
 * - Audit log for all tenant operations
 * - API key management per org
 * - Org data isolation
 * 
 * 🌙 Night Shift Agent — 2026-03-16
 */

import { EventEmitter } from 'events';
import { randomBytes, createHash } from 'crypto';

// ──── Types ────

export type OrgStatus = 'active' | 'suspended' | 'deactivated' | 'trial';

export type OrgRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';

export type OrgPermission =
  // Inventory
  | 'inventory:create_session'
  | 'inventory:view_session'
  | 'inventory:edit_session'
  | 'inventory:delete_session'
  | 'inventory:export'
  // Agents
  | 'agents:invoke'
  | 'agents:configure'
  | 'agents:install_plugins'
  // Billing
  | 'billing:view'
  | 'billing:manage'
  // Team
  | 'team:invite'
  | 'team:remove'
  | 'team:change_role'
  | 'team:view'
  // Settings
  | 'settings:view'
  | 'settings:edit'
  | 'settings:api_keys'
  // Data
  | 'data:view_all'
  | 'data:export_all'
  | 'data:delete'
  // Webhooks
  | 'webhooks:manage'
  | 'webhooks:view'
  // Devices
  | 'devices:register'
  | 'devices:manage'
  | 'devices:view'
  // Reports
  | 'reports:view'
  | 'reports:create'
  | 'reports:share';

// Role → Permission mapping
const ROLE_PERMISSIONS: Record<OrgRole, OrgPermission[]> = {
  owner: [
    'inventory:create_session', 'inventory:view_session', 'inventory:edit_session', 'inventory:delete_session', 'inventory:export',
    'agents:invoke', 'agents:configure', 'agents:install_plugins',
    'billing:view', 'billing:manage',
    'team:invite', 'team:remove', 'team:change_role', 'team:view',
    'settings:view', 'settings:edit', 'settings:api_keys',
    'data:view_all', 'data:export_all', 'data:delete',
    'webhooks:manage', 'webhooks:view',
    'devices:register', 'devices:manage', 'devices:view',
    'reports:view', 'reports:create', 'reports:share',
  ],
  admin: [
    'inventory:create_session', 'inventory:view_session', 'inventory:edit_session', 'inventory:delete_session', 'inventory:export',
    'agents:invoke', 'agents:configure', 'agents:install_plugins',
    'billing:view',
    'team:invite', 'team:remove', 'team:change_role', 'team:view',
    'settings:view', 'settings:edit', 'settings:api_keys',
    'data:view_all', 'data:export_all',
    'webhooks:manage', 'webhooks:view',
    'devices:register', 'devices:manage', 'devices:view',
    'reports:view', 'reports:create', 'reports:share',
  ],
  manager: [
    'inventory:create_session', 'inventory:view_session', 'inventory:edit_session', 'inventory:export',
    'agents:invoke', 'agents:configure',
    'team:invite', 'team:view',
    'settings:view',
    'data:view_all',
    'webhooks:view',
    'devices:register', 'devices:view',
    'reports:view', 'reports:create',
  ],
  member: [
    'inventory:create_session', 'inventory:view_session', 'inventory:export',
    'agents:invoke',
    'team:view',
    'settings:view',
    'devices:view',
    'reports:view',
  ],
  viewer: [
    'inventory:view_session',
    'team:view',
    'settings:view',
    'devices:view',
    'reports:view',
  ],
};

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  plan?: string;
  ownerId: string;
  settings: OrgSettings;
  quotas: OrgQuotas;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface OrgSettings {
  defaultTimezone: string;
  defaultLanguage: string;
  brandColor?: string;
  logoUrl?: string;
  allowMemberInvites: boolean;
  requireMFA: boolean;
  ipAllowlist?: string[];
  dataRetentionDays: number;
  autoExportEnabled: boolean;
  notificationChannels: string[];
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  defaultTimezone: 'America/Chicago',
  defaultLanguage: 'en',
  allowMemberInvites: false,
  requireMFA: false,
  dataRetentionDays: 90,
  autoExportEnabled: false,
  notificationChannels: ['email'],
};

export interface OrgQuotas {
  maxUsers: number;
  maxDevices: number;
  maxSessionsPerDay: number;
  maxItemsPerSession: number;
  maxStorageBytes: number;
  maxApiCallsPerDay: number;
  maxWebhooks: number;
  maxPlugins: number;
}

export const DEFAULT_QUOTAS: OrgQuotas = {
  maxUsers: 5,
  maxDevices: 3,
  maxSessionsPerDay: 10,
  maxItemsPerSession: 10000,
  maxStorageBytes: 1024 * 1024 * 1024, // 1GB
  maxApiCallsPerDay: 10000,
  maxWebhooks: 5,
  maxPlugins: 10,
};

export const PLAN_QUOTAS: Record<string, Partial<OrgQuotas>> = {
  free: { maxUsers: 1, maxDevices: 1, maxSessionsPerDay: 3, maxApiCallsPerDay: 100, maxWebhooks: 0, maxPlugins: 3 },
  solo: { maxUsers: 1, maxDevices: 2, maxSessionsPerDay: 20, maxApiCallsPerDay: 5000, maxWebhooks: 3, maxPlugins: 10 },
  multi_store: { maxUsers: 10, maxDevices: 10, maxSessionsPerDay: 100, maxApiCallsPerDay: 50000, maxWebhooks: 10, maxPlugins: 25 },
  enterprise: { maxUsers: 100, maxDevices: 50, maxSessionsPerDay: 1000, maxApiCallsPerDay: 500000, maxWebhooks: 50, maxPlugins: 50 },
};

export interface OrgMember {
  userId: string;
  orgId: string;
  role: OrgRole;
  email: string;
  displayName?: string;
  joinedAt: number;
  lastActiveAt?: number;
  invitedBy?: string;
  customPermissions?: OrgPermission[];  // Additional permissions beyond role
  revokedPermissions?: OrgPermission[];  // Permissions removed from role defaults
}

export interface OrgInvite {
  id: string;
  orgId: string;
  email: string;
  role: OrgRole;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  token: string;
  accepted: boolean;
}

export interface OrgApiKey {
  id: string;
  orgId: string;
  name: string;
  keyPrefix: string;         // First 8 chars for display
  keyHash: string;           // SHA-256 hash of full key
  permissions: OrgPermission[];
  createdBy: string;
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  enabled: boolean;
}

export interface AuditLogEntry {
  id: string;
  orgId: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  timestamp: number;
  ip?: string;
}

export interface TenantManagerConfig {
  maxOrgs: number;
  inviteExpirationMs: number;
  maxApiKeysPerOrg: number;
  maxAuditLogEntries: number;
  defaultQuotas: OrgQuotas;
}

export const DEFAULT_TENANT_CONFIG: TenantManagerConfig = {
  maxOrgs: 1000,
  inviteExpirationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxApiKeysPerOrg: 10,
  maxAuditLogEntries: 10000,
  defaultQuotas: DEFAULT_QUOTAS,
};

export interface TenantManagerEvents {
  'org:created': (org: Organization) => void;
  'org:updated': (org: Organization) => void;
  'org:suspended': (orgId: string) => void;
  'org:deactivated': (orgId: string) => void;
  'member:added': (orgId: string, member: OrgMember) => void;
  'member:removed': (orgId: string, userId: string) => void;
  'member:role_changed': (orgId: string, userId: string, oldRole: OrgRole, newRole: OrgRole) => void;
  'invite:created': (invite: OrgInvite) => void;
  'invite:accepted': (invite: OrgInvite) => void;
  'api_key:created': (orgId: string, keyId: string) => void;
  'api_key:revoked': (orgId: string, keyId: string) => void;
  'quota:warning': (orgId: string, resource: string, usage: number, limit: number) => void;
  'quota:exceeded': (orgId: string, resource: string, usage: number, limit: number) => void;
}

// ──── Tenant Manager Implementation ────

export class TenantManager extends EventEmitter {
  private config: TenantManagerConfig;
  private orgs: Map<string, Organization> = new Map();
  private members: Map<string, OrgMember[]> = new Map();    // orgId → members
  private invites: Map<string, OrgInvite[]> = new Map();     // orgId → invites
  private apiKeys: Map<string, OrgApiKey[]> = new Map();     // orgId → keys
  private auditLog: AuditLogEntry[] = [];
  private usageCounters: Map<string, Record<string, number>> = new Map(); // orgId → counters

  constructor(config: Partial<TenantManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TENANT_CONFIG, ...config };
  }

  // ── Organization CRUD ──

  createOrg(params: {
    name: string;
    ownerId: string;
    ownerEmail: string;
    plan?: string;
    settings?: Partial<OrgSettings>;
    metadata?: Record<string, unknown>;
  }): Organization {
    if (this.orgs.size >= this.config.maxOrgs) {
      throw new Error(`Maximum number of organizations reached (${this.config.maxOrgs})`);
    }

    if (!params.name || params.name.trim().length === 0) {
      throw new Error('Organization name is required');
    }

    if (!params.ownerId) {
      throw new Error('Owner ID is required');
    }

    const slug = this.generateSlug(params.name);
    
    // Check slug uniqueness
    for (const [, org] of this.orgs) {
      if (org.slug === slug) {
        throw new Error(`Organization slug "${slug}" is already taken`);
      }
    }

    const now = Date.now();
    const id = this.generateId('org');

    // Determine quotas based on plan
    const planQuotas = params.plan ? PLAN_QUOTAS[params.plan] : undefined;
    const quotas: OrgQuotas = { ...this.config.defaultQuotas, ...planQuotas };

    const org: Organization = {
      id,
      name: params.name.trim(),
      slug,
      status: params.plan === 'free' ? 'active' : 'trial',
      plan: params.plan,
      ownerId: params.ownerId,
      settings: { ...DEFAULT_ORG_SETTINGS, ...params.settings },
      quotas,
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata,
    };

    this.orgs.set(id, org);
    this.members.set(id, []);
    this.invites.set(id, []);
    this.apiKeys.set(id, []);
    this.usageCounters.set(id, {});

    // Add owner as first member
    const ownerMember: OrgMember = {
      userId: params.ownerId,
      orgId: id,
      role: 'owner',
      email: params.ownerEmail,
      joinedAt: now,
    };
    this.members.get(id)!.push(ownerMember);

    this.audit(id, params.ownerId, 'org.created', 'organization', id, { name: params.name });
    this.emit('org:created', org);

    return org;
  }

  updateOrg(orgId: string, updates: Partial<Pick<Organization, 'name' | 'settings' | 'metadata'>>): Organization {
    const org = this.getOrgOrThrow(orgId);

    if (updates.name !== undefined) {
      if (!updates.name || updates.name.trim().length === 0) {
        throw new Error('Organization name cannot be empty');
      }
      org.name = updates.name.trim();
    }

    if (updates.settings) {
      org.settings = { ...org.settings, ...updates.settings };
    }

    if (updates.metadata) {
      org.metadata = { ...org.metadata, ...updates.metadata };
    }

    org.updatedAt = Date.now();
    this.emit('org:updated', org);
    return org;
  }

  suspendOrg(orgId: string, reason?: string): void {
    const org = this.getOrgOrThrow(orgId);
    org.status = 'suspended';
    org.updatedAt = Date.now();

    this.audit(orgId, 'system', 'org.suspended', 'organization', orgId, { reason });
    this.emit('org:suspended', orgId);
  }

  reactivateOrg(orgId: string): void {
    const org = this.getOrgOrThrow(orgId);
    if (org.status !== 'suspended') {
      throw new Error('Organization is not suspended');
    }
    org.status = 'active';
    org.updatedAt = Date.now();

    this.audit(orgId, 'system', 'org.reactivated', 'organization', orgId);
    this.emit('org:updated', org);
  }

  deactivateOrg(orgId: string): void {
    const org = this.getOrgOrThrow(orgId);
    org.status = 'deactivated';
    org.updatedAt = Date.now();

    this.audit(orgId, 'system', 'org.deactivated', 'organization', orgId);
    this.emit('org:deactivated', orgId);
  }

  getOrg(orgId: string): Organization | undefined {
    return this.orgs.get(orgId);
  }

  getOrgBySlug(slug: string): Organization | undefined {
    for (const [, org] of this.orgs) {
      if (org.slug === slug) return org;
    }
    return undefined;
  }

  listOrgs(filter?: { status?: OrgStatus; plan?: string }): Organization[] {
    let result = Array.from(this.orgs.values());

    if (filter?.status) {
      result = result.filter(o => o.status === filter.status);
    }
    if (filter?.plan) {
      result = result.filter(o => o.plan === filter.plan);
    }

    return result;
  }

  getUserOrgs(userId: string): Organization[] {
    const orgs: Organization[] = [];

    for (const [orgId, memberList] of this.members) {
      if (memberList.some(m => m.userId === userId)) {
        const org = this.orgs.get(orgId);
        if (org) orgs.push(org);
      }
    }

    return orgs;
  }

  // ── Member Management ──

  addMember(orgId: string, params: { userId: string; email: string; role: OrgRole; invitedBy: string; displayName?: string }): OrgMember {
    const org = this.getOrgOrThrow(orgId);
    const members = this.members.get(orgId)!;

    // Check if already a member
    if (members.some(m => m.userId === params.userId)) {
      throw new Error(`User "${params.userId}" is already a member`);
    }

    // Check quota
    if (members.length >= org.quotas.maxUsers) {
      this.emit('quota:exceeded', orgId, 'users', members.length, org.quotas.maxUsers);
      throw new Error(`User quota exceeded (${org.quotas.maxUsers})`);
    }

    // Can't add another owner
    if (params.role === 'owner') {
      throw new Error('Cannot add another owner. Transfer ownership instead.');
    }

    const member: OrgMember = {
      userId: params.userId,
      orgId,
      role: params.role,
      email: params.email,
      displayName: params.displayName,
      joinedAt: Date.now(),
      invitedBy: params.invitedBy,
    };

    members.push(member);

    this.audit(orgId, params.invitedBy, 'member.added', 'member', params.userId, { role: params.role });
    this.emit('member:added', orgId, member);

    return member;
  }

  removeMember(orgId: string, userId: string, removedBy: string): void {
    const members = this.getOrgMembersOrThrow(orgId);
    const index = members.findIndex(m => m.userId === userId);

    if (index === -1) {
      throw new Error(`User "${userId}" is not a member`);
    }

    if (members[index].role === 'owner') {
      throw new Error('Cannot remove the organization owner');
    }

    members.splice(index, 1);

    this.audit(orgId, removedBy, 'member.removed', 'member', userId);
    this.emit('member:removed', orgId, userId);
  }

  changeMemberRole(orgId: string, userId: string, newRole: OrgRole, changedBy: string): void {
    const members = this.getOrgMembersOrThrow(orgId);
    const member = members.find(m => m.userId === userId);

    if (!member) {
      throw new Error(`User "${userId}" is not a member`);
    }

    if (member.role === 'owner' && newRole !== 'owner') {
      throw new Error('Cannot demote the owner. Transfer ownership first.');
    }

    if (newRole === 'owner') {
      throw new Error('Cannot promote to owner. Use transferOwnership instead.');
    }

    const oldRole = member.role;
    member.role = newRole;

    this.audit(orgId, changedBy, 'member.role_changed', 'member', userId, { oldRole, newRole });
    this.emit('member:role_changed', orgId, userId, oldRole, newRole);
  }

  transferOwnership(orgId: string, newOwnerId: string, currentOwnerId: string): void {
    const org = this.getOrgOrThrow(orgId);
    const members = this.members.get(orgId)!;

    if (org.ownerId !== currentOwnerId) {
      throw new Error('Only the current owner can transfer ownership');
    }

    const newOwner = members.find(m => m.userId === newOwnerId);
    if (!newOwner) {
      throw new Error('New owner must be an existing member');
    }

    const currentOwner = members.find(m => m.userId === currentOwnerId);

    // Transfer
    newOwner.role = 'owner';
    if (currentOwner) {
      currentOwner.role = 'admin';
    }
    org.ownerId = newOwnerId;
    org.updatedAt = Date.now();

    this.audit(orgId, currentOwnerId, 'ownership.transferred', 'organization', orgId, { newOwnerId });
  }

  getMember(orgId: string, userId: string): OrgMember | undefined {
    return this.members.get(orgId)?.find(m => m.userId === userId);
  }

  listMembers(orgId: string): OrgMember[] {
    this.getOrgOrThrow(orgId);
    return [...(this.members.get(orgId) ?? [])];
  }

  // ── Permission Checking ──

  hasPermission(orgId: string, userId: string, permission: OrgPermission): boolean {
    const member = this.getMember(orgId, userId);
    if (!member) return false;

    // Check revoked permissions
    if (member.revokedPermissions?.includes(permission)) return false;

    // Check custom (additional) permissions
    if (member.customPermissions?.includes(permission)) return true;

    // Check role-based permissions
    const rolePerms = ROLE_PERMISSIONS[member.role];
    return rolePerms.includes(permission);
  }

  getEffectivePermissions(orgId: string, userId: string): OrgPermission[] {
    const member = this.getMember(orgId, userId);
    if (!member) return [];

    const rolePerms = new Set(ROLE_PERMISSIONS[member.role]);

    // Add custom permissions
    if (member.customPermissions) {
      for (const p of member.customPermissions) {
        rolePerms.add(p);
      }
    }

    // Remove revoked permissions
    if (member.revokedPermissions) {
      for (const p of member.revokedPermissions) {
        rolePerms.delete(p);
      }
    }

    return Array.from(rolePerms);
  }

  getRolePermissions(role: OrgRole): OrgPermission[] {
    return [...ROLE_PERMISSIONS[role]];
  }

  grantCustomPermission(orgId: string, userId: string, permission: OrgPermission): void {
    const member = this.getMember(orgId, userId);
    if (!member) throw new Error(`User "${userId}" is not a member of org "${orgId}"`);

    if (!member.customPermissions) member.customPermissions = [];
    if (!member.customPermissions.includes(permission)) {
      member.customPermissions.push(permission);
    }
  }

  revokeCustomPermission(orgId: string, userId: string, permission: OrgPermission): void {
    const member = this.getMember(orgId, userId);
    if (!member) throw new Error(`User "${userId}" is not a member of org "${orgId}"`);

    if (!member.revokedPermissions) member.revokedPermissions = [];
    if (!member.revokedPermissions.includes(permission)) {
      member.revokedPermissions.push(permission);
    }
  }

  // ── Invites ──

  createInvite(orgId: string, params: { email: string; role: OrgRole; invitedBy: string }): OrgInvite {
    this.getOrgOrThrow(orgId);
    const invites = this.invites.get(orgId)!;

    // Check for existing pending invite
    const existing = invites.find(i => i.email === params.email && !i.accepted && i.expiresAt > Date.now());
    if (existing) {
      throw new Error(`Pending invite already exists for ${params.email}`);
    }

    if (params.role === 'owner') {
      throw new Error('Cannot invite someone as owner');
    }

    const invite: OrgInvite = {
      id: this.generateId('inv'),
      orgId,
      email: params.email,
      role: params.role,
      invitedBy: params.invitedBy,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.inviteExpirationMs,
      token: randomBytes(32).toString('hex'),
      accepted: false,
    };

    invites.push(invite);

    this.audit(orgId, params.invitedBy, 'invite.created', 'invite', invite.id, { email: params.email, role: params.role });
    this.emit('invite:created', invite);

    return invite;
  }

  acceptInvite(token: string, userId: string): OrgMember {
    let foundInvite: OrgInvite | undefined;
    let foundOrgId: string | undefined;

    for (const [orgId, invites] of this.invites) {
      const invite = invites.find(i => i.token === token && !i.accepted);
      if (invite) {
        foundInvite = invite;
        foundOrgId = orgId;
        break;
      }
    }

    if (!foundInvite || !foundOrgId) {
      throw new Error('Invalid or expired invite token');
    }

    if (foundInvite.expiresAt < Date.now()) {
      throw new Error('Invite has expired');
    }

    foundInvite.accepted = true;

    const member = this.addMember(foundOrgId, {
      userId,
      email: foundInvite.email,
      role: foundInvite.role,
      invitedBy: foundInvite.invitedBy,
    });

    this.audit(foundOrgId, userId, 'invite.accepted', 'invite', foundInvite.id);
    this.emit('invite:accepted', foundInvite);

    return member;
  }

  listInvites(orgId: string, includeExpired = false): OrgInvite[] {
    this.getOrgOrThrow(orgId);
    const invites = this.invites.get(orgId) ?? [];

    if (includeExpired) return [...invites];
    return invites.filter(i => !i.accepted && i.expiresAt > Date.now());
  }

  // ── API Keys ──

  createApiKey(orgId: string, params: { name: string; permissions: OrgPermission[]; createdBy: string; expiresAt?: number }): { key: string; apiKey: OrgApiKey } {
    this.getOrgOrThrow(orgId);
    const keys = this.apiKeys.get(orgId)!;

    if (keys.length >= this.config.maxApiKeysPerOrg) {
      throw new Error(`Maximum API keys reached (${this.config.maxApiKeysPerOrg})`);
    }

    if (!params.name || params.name.trim().length === 0) {
      throw new Error('API key name is required');
    }

    const rawKey = `ocvk_${randomBytes(32).toString('hex')}`;
    const keyPrefix = rawKey.substring(0, 12);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const apiKey: OrgApiKey = {
      id: this.generateId('key'),
      orgId,
      name: params.name.trim(),
      keyPrefix,
      keyHash,
      permissions: params.permissions,
      createdBy: params.createdBy,
      createdAt: Date.now(),
      expiresAt: params.expiresAt,
      enabled: true,
    };

    keys.push(apiKey);

    this.audit(orgId, params.createdBy, 'api_key.created', 'api_key', apiKey.id, { name: params.name });
    this.emit('api_key:created', orgId, apiKey.id);

    return { key: rawKey, apiKey };
  }

  validateApiKey(rawKey: string): { orgId: string; permissions: OrgPermission[] } | null {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    for (const [orgId, keys] of this.apiKeys) {
      for (const key of keys) {
        if (key.keyHash === keyHash) {
          if (!key.enabled) return null;
          if (key.expiresAt && key.expiresAt < Date.now()) return null;

          key.lastUsedAt = Date.now();
          return { orgId, permissions: key.permissions };
        }
      }
    }

    return null;
  }

  revokeApiKey(orgId: string, keyId: string, revokedBy: string): void {
    const keys = this.apiKeys.get(orgId);
    if (!keys) throw new Error(`Organization "${orgId}" not found`);

    const key = keys.find(k => k.id === keyId);
    if (!key) throw new Error(`API key "${keyId}" not found`);

    key.enabled = false;

    this.audit(orgId, revokedBy, 'api_key.revoked', 'api_key', keyId);
    this.emit('api_key:revoked', orgId, keyId);
  }

  listApiKeys(orgId: string): Omit<OrgApiKey, 'keyHash'>[] {
    this.getOrgOrThrow(orgId);
    return (this.apiKeys.get(orgId) ?? []).map(({ keyHash, ...rest }) => rest);
  }

  // ── Quotas ──

  updateQuotas(orgId: string, quotas: Partial<OrgQuotas>): OrgQuotas {
    const org = this.getOrgOrThrow(orgId);
    org.quotas = { ...org.quotas, ...quotas };
    org.updatedAt = Date.now();
    return org.quotas;
  }

  applyPlanQuotas(orgId: string, plan: string): OrgQuotas {
    const org = this.getOrgOrThrow(orgId);
    const planQuotas = PLAN_QUOTAS[plan];

    if (!planQuotas) {
      throw new Error(`Unknown plan: ${plan}`);
    }

    org.plan = plan;
    org.quotas = { ...DEFAULT_QUOTAS, ...planQuotas };
    org.status = plan === 'free' ? 'active' : org.status;
    org.updatedAt = Date.now();

    return org.quotas;
  }

  checkQuota(orgId: string, resource: string, currentUsage: number): { allowed: boolean; limit: number; usage: number; percentage: number } {
    const org = this.getOrgOrThrow(orgId);
    const quotaMap: Record<string, number> = {
      users: org.quotas.maxUsers,
      devices: org.quotas.maxDevices,
      sessions_per_day: org.quotas.maxSessionsPerDay,
      items_per_session: org.quotas.maxItemsPerSession,
      storage_bytes: org.quotas.maxStorageBytes,
      api_calls_per_day: org.quotas.maxApiCallsPerDay,
      webhooks: org.quotas.maxWebhooks,
      plugins: org.quotas.maxPlugins,
    };

    const limit = quotaMap[resource];
    if (limit === undefined) {
      throw new Error(`Unknown quota resource: ${resource}`);
    }

    const percentage = (currentUsage / limit) * 100;
    const allowed = currentUsage < limit;

    // Emit warnings at 80%
    if (percentage >= 80 && percentage < 100) {
      this.emit('quota:warning', orgId, resource, currentUsage, limit);
    }

    if (!allowed) {
      this.emit('quota:exceeded', orgId, resource, currentUsage, limit);
    }

    return { allowed, limit, usage: currentUsage, percentage };
  }

  // ── Audit Log ──

  getAuditLog(orgId: string, options?: { limit?: number; action?: string; userId?: string }): AuditLogEntry[] {
    let entries = this.auditLog.filter(e => e.orgId === orgId);

    if (options?.action) {
      entries = entries.filter(e => e.action === options.action);
    }
    if (options?.userId) {
      entries = entries.filter(e => e.userId === options.userId);
    }

    entries.sort((a, b) => b.timestamp - a.timestamp);

    const limit = options?.limit ?? 100;
    return entries.slice(0, limit);
  }

  // ── Stats ──

  getStats(): TenantManagerStats {
    let totalMembers = 0;
    let totalApiKeys = 0;

    for (const [, members] of this.members) {
      totalMembers += members.length;
    }
    for (const [, keys] of this.apiKeys) {
      totalApiKeys += keys.filter(k => k.enabled).length;
    }

    const orgs = Array.from(this.orgs.values());

    return {
      totalOrgs: orgs.length,
      activeOrgs: orgs.filter(o => o.status === 'active').length,
      trialOrgs: orgs.filter(o => o.status === 'trial').length,
      suspendedOrgs: orgs.filter(o => o.status === 'suspended').length,
      totalMembers,
      totalApiKeys,
      totalAuditEntries: this.auditLog.length,
    };
  }

  getVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];
    parts.push(`${stats.totalOrgs} organizations, ${stats.activeOrgs} active.`);
    parts.push(`${stats.totalMembers} total members.`);
    if (stats.trialOrgs > 0) parts.push(`${stats.trialOrgs} on trial.`);
    if (stats.suspendedOrgs > 0) parts.push(`${stats.suspendedOrgs} suspended.`);
    return parts.join(' ');
  }

  // ── Private Helpers ──

  private getOrgOrThrow(orgId: string): Organization {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error(`Organization "${orgId}" not found`);
    return org;
  }

  private getOrgMembersOrThrow(orgId: string): OrgMember[] {
    this.getOrgOrThrow(orgId);
    return this.members.get(orgId)!;
  }

  private audit(orgId: string, userId: string, action: string, resource: string, resourceId?: string, details?: Record<string, unknown>): void {
    const entry: AuditLogEntry = {
      id: this.generateId('aud'),
      orgId,
      userId,
      action,
      resource,
      resourceId,
      details,
      timestamp: Date.now(),
    };

    this.auditLog.push(entry);

    // Trim
    if (this.auditLog.length > this.config.maxAuditLogEntries) {
      this.auditLog = this.auditLog.slice(-Math.floor(this.config.maxAuditLogEntries * 0.75));
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }
}

// ──── Stats Type ────

export interface TenantManagerStats {
  totalOrgs: number;
  activeOrgs: number;
  trialOrgs: number;
  suspendedOrgs: number;
  totalMembers: number;
  totalApiKeys: number;
  totalAuditEntries: number;
}
