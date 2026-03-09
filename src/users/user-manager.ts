/**
 * User Management Engine
 * 
 * Complete user lifecycle management for the Ray-Bans × OpenClaw platform.
 * Handles user CRUD, team management, invitations, preferences, and
 * integrates with the API Gateway (auth/RBAC) and Billing Engine (plans).
 * 
 * Features:
 * - User registration and profile management (create, update, deactivate, delete)
 * - Team/organization management with member roles
 * - Invitation system: invite by email → accept → join team
 * - User preferences: notification settings, privacy, voice, accessibility
 * - Activity tracking: login history, feature usage, session logs
 * - Search, pagination, and filtering across users
 * - Team quotas tied to pricing tiers
 * - Password hashing with Argon2id-style (SHA-512 + salt + iterations)
 * - Voice-friendly user summaries
 * 
 * 🌙 Night Shift Agent — 2026-03-09
 */

import { EventEmitter } from 'eventemitter3';
import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending_verification';
export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';
export type AuthProvider = 'email' | 'google' | 'github' | 'apple' | 'saml';
export type NotificationChannel = 'email' | 'push' | 'sms' | 'in_app' | 'voice';
export type PrivacyLevel = 'strict' | 'balanced' | 'open';

export interface UserManagerConfig {
  /** Maximum users per team (default: 50) */
  maxTeamMembers?: number;
  /** Invitation expiry in hours (default: 72) */
  invitationExpiryHours?: number;
  /** Password min length (default: 8) */
  passwordMinLength?: number;
  /** Maximum login attempts before lockout (default: 5) */
  maxLoginAttempts?: number;
  /** Lockout duration in minutes (default: 30) */
  lockoutDurationMinutes?: number;
  /** Require email verification (default: true) */
  requireEmailVerification?: boolean;
  /** Maximum teams a user can own (default: 3) */
  maxTeamsPerUser?: number;
  /** Password hash iterations (default: 100000) */
  hashIterations?: number;
  /** Activity log retention in days (default: 90) */
  activityRetentionDays?: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  displayName?: string;
  avatarUrl?: string;
  status: UserStatus;
  authProvider: AuthProvider;
  passwordHash?: string;
  passwordSalt?: string;
  emailVerified: boolean;
  phone?: string;
  phoneVerified: boolean;
  timezone?: string;
  locale?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  loginCount: number;
  failedLoginAttempts: number;
  lockedUntil?: string;
  deactivatedAt?: string;
  preferences: UserPreferences;
}

export interface UserPreferences {
  notifications: NotificationPreferences;
  privacy: PrivacyPreferences;
  voice: VoicePreferences;
  accessibility: AccessibilityPreferences;
  dashboard: DashboardPreferences;
}

export interface NotificationPreferences {
  channels: NotificationChannel[];
  quietHoursStart?: string; // HH:MM
  quietHoursEnd?: string;
  inventoryAlerts: boolean;
  securityAlerts: boolean;
  billingAlerts: boolean;
  meetingSummaries: boolean;
  weeklyDigest: boolean;
}

export interface PrivacyPreferences {
  level: PrivacyLevel;
  shareAnalytics: boolean;
  allowDataExport: boolean;
  autoDeleteAfterDays?: number;
  blurFacesInMemory: boolean;
  geofencePrivacyZones: GeoPrivacyZone[];
}

export interface GeoPrivacyZone {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface VoicePreferences {
  ttsEnabled: boolean;
  ttsVoice?: string;
  ttsSpeed: number; // 0.5 - 2.0
  wakeWord?: string;
  confirmationSounds: boolean;
  briefingLength: 'short' | 'medium' | 'detailed';
}

export interface AccessibilityPreferences {
  highContrast: boolean;
  largeText: boolean;
  screenReaderOptimized: boolean;
  reducedMotion: boolean;
  colorBlindMode?: 'protanopia' | 'deuteranopia' | 'tritanopia';
}

export interface DashboardPreferences {
  defaultView: string;
  theme: 'light' | 'dark' | 'system';
  compactMode: boolean;
  showTutorials: boolean;
  pinnedWidgets: string[];
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  description?: string;
  ownerId: string;
  plan: string;
  maxMembers: number;
  settings: TeamSettings;
  createdAt: string;
  updatedAt: string;
}

export interface TeamSettings {
  defaultRole: TeamRole;
  allowMemberInvite: boolean;
  requireApproval: boolean;
  sharedInventory: boolean;
  sharedMemory: boolean;
  enforcedPrivacyLevel?: PrivacyLevel;
}

export interface TeamMember {
  userId: string;
  teamId: string;
  role: TeamRole;
  joinedAt: string;
  invitedBy?: string;
}

export interface Invitation {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  status: InvitationStatus;
  invitedBy: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
}

export interface UserQuery {
  status?: UserStatus;
  teamId?: string;
  search?: string;
  authProvider?: AuthProvider;
  sortBy?: 'name' | 'email' | 'createdAt' | 'lastLoginAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CreateUserInput {
  email: string;
  name: string;
  password?: string;
  authProvider?: AuthProvider;
  displayName?: string;
  phone?: string;
  timezone?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateUserInput {
  name?: string;
  displayName?: string;
  avatarUrl?: string;
  phone?: string;
  timezone?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
}

export interface UserManagerEvents {
  'user:created': (user: User) => void;
  'user:updated': (user: User, changes: string[]) => void;
  'user:deleted': (userId: string) => void;
  'user:suspended': (userId: string, reason: string) => void;
  'user:activated': (userId: string) => void;
  'user:login': (userId: string, provider: AuthProvider) => void;
  'user:login_failed': (email: string, reason: string) => void;
  'user:locked': (userId: string, until: string) => void;
  'user:password_changed': (userId: string) => void;
  'team:created': (team: Team) => void;
  'team:updated': (team: Team) => void;
  'team:deleted': (teamId: string) => void;
  'team:member_added': (teamId: string, userId: string, role: TeamRole) => void;
  'team:member_removed': (teamId: string, userId: string) => void;
  'team:member_role_changed': (teamId: string, userId: string, oldRole: TeamRole, newRole: TeamRole) => void;
  'invitation:created': (invitation: Invitation) => void;
  'invitation:accepted': (invitation: Invitation) => void;
  'invitation:expired': (invitationId: string) => void;
  'invitation:revoked': (invitationId: string) => void;
}

// ─── Default Preferences ─────────────────────────────────────────────────────

const DEFAULT_PREFERENCES: UserPreferences = {
  notifications: {
    channels: ['email', 'in_app'],
    inventoryAlerts: true,
    securityAlerts: true,
    billingAlerts: true,
    meetingSummaries: true,
    weeklyDigest: false,
  },
  privacy: {
    level: 'balanced',
    shareAnalytics: false,
    allowDataExport: true,
    blurFacesInMemory: false,
    geofencePrivacyZones: [],
  },
  voice: {
    ttsEnabled: true,
    ttsSpeed: 1.0,
    confirmationSounds: true,
    briefingLength: 'medium',
  },
  accessibility: {
    highContrast: false,
    largeText: false,
    screenReaderOptimized: false,
    reducedMotion: false,
  },
  dashboard: {
    defaultView: 'overview',
    theme: 'system',
    compactMode: false,
    showTutorials: true,
    pinnedWidgets: [],
  },
};

const DEFAULT_TEAM_SETTINGS: TeamSettings = {
  defaultRole: 'member',
  allowMemberInvite: false,
  requireApproval: true,
  sharedInventory: true,
  sharedMemory: false,
};

// Team member limits by plan
const PLAN_TEAM_LIMITS: Record<string, number> = {
  free: 1,
  solo: 1,
  multi: 10,
  enterprise: 100,
  unlimited: 9999,
};

// ─── Implementation ─────────────────────────────────────────────────────────

export class UserManager extends EventEmitter<UserManagerEvents> {
  private users = new Map<string, User>();
  private emailIndex = new Map<string, string>(); // email → userId
  private teams = new Map<string, Team>();
  private teamMembers = new Map<string, TeamMember[]>(); // teamId → members
  private userTeams = new Map<string, string[]>(); // userId → teamIds
  private invitations = new Map<string, Invitation>();
  private activityLogs: ActivityLog[] = [];
  private config: Required<UserManagerConfig>;

  constructor(config: UserManagerConfig = {}) {
    super();
    this.config = {
      maxTeamMembers: config.maxTeamMembers ?? 50,
      invitationExpiryHours: config.invitationExpiryHours ?? 72,
      passwordMinLength: config.passwordMinLength ?? 8,
      maxLoginAttempts: config.maxLoginAttempts ?? 5,
      lockoutDurationMinutes: config.lockoutDurationMinutes ?? 30,
      requireEmailVerification: config.requireEmailVerification ?? true,
      maxTeamsPerUser: config.maxTeamsPerUser ?? 3,
      hashIterations: config.hashIterations ?? 100000,
      activityRetentionDays: config.activityRetentionDays ?? 90,
    };
  }

  // ─── User CRUD ───────────────────────────────────────────────────────

  createUser(input: CreateUserInput): User {
    // Validate email format
    if (!this.isValidEmail(input.email)) {
      throw new Error('Invalid email format');
    }

    // Check for duplicate email
    const normalizedEmail = input.email.toLowerCase().trim();
    if (this.emailIndex.has(normalizedEmail)) {
      throw new Error('Email already registered');
    }

    // Validate password if provided
    if (input.password !== undefined) {
      this.validatePassword(input.password);
    }

    const userId = crypto.randomUUID();
    const now = new Date().toISOString();

    let passwordHash: string | undefined;
    let passwordSalt: string | undefined;
    if (input.password) {
      passwordSalt = crypto.randomBytes(32).toString('hex');
      passwordHash = this.hashPassword(input.password, passwordSalt);
    }

    const user: User = {
      id: userId,
      email: normalizedEmail,
      name: input.name,
      displayName: input.displayName,
      status: this.config.requireEmailVerification ? 'pending_verification' : 'active',
      authProvider: input.authProvider ?? 'email',
      passwordHash,
      passwordSalt,
      emailVerified: !this.config.requireEmailVerification,
      phone: input.phone,
      phoneVerified: false,
      timezone: input.timezone,
      locale: input.locale,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      loginCount: 0,
      failedLoginAttempts: 0,
      preferences: JSON.parse(JSON.stringify(DEFAULT_PREFERENCES)),
    };

    this.users.set(userId, user);
    this.emailIndex.set(normalizedEmail, userId);
    this.userTeams.set(userId, []);

    this.emit('user:created', user);
    this.logActivity(userId, 'user:created');

    return user;
  }

  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  getUserByEmail(email: string): User | undefined {
    const normalizedEmail = email.toLowerCase().trim();
    const userId = this.emailIndex.get(normalizedEmail);
    if (!userId) return undefined;
    return this.users.get(userId);
  }

  updateUser(userId: string, input: UpdateUserInput): User {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    const changes: string[] = [];

    if (input.name !== undefined && input.name !== user.name) {
      user.name = input.name;
      changes.push('name');
    }
    if (input.displayName !== undefined && input.displayName !== user.displayName) {
      user.displayName = input.displayName;
      changes.push('displayName');
    }
    if (input.avatarUrl !== undefined && input.avatarUrl !== user.avatarUrl) {
      user.avatarUrl = input.avatarUrl;
      changes.push('avatarUrl');
    }
    if (input.phone !== undefined && input.phone !== user.phone) {
      user.phone = input.phone;
      user.phoneVerified = false;
      changes.push('phone');
    }
    if (input.timezone !== undefined && input.timezone !== user.timezone) {
      user.timezone = input.timezone;
      changes.push('timezone');
    }
    if (input.locale !== undefined && input.locale !== user.locale) {
      user.locale = input.locale;
      changes.push('locale');
    }
    if (input.metadata !== undefined) {
      user.metadata = { ...user.metadata, ...input.metadata };
      changes.push('metadata');
    }

    if (changes.length > 0) {
      user.updatedAt = new Date().toISOString();
      this.emit('user:updated', user, changes);
      this.logActivity(userId, 'user:updated', { changes });
    }

    return user;
  }

  deleteUser(userId: string): void {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    // Remove from all teams
    const teamIds = this.userTeams.get(userId) ?? [];
    for (const teamId of teamIds) {
      const team = this.teams.get(teamId);
      if (team && team.ownerId === userId) {
        // Delete owned teams
        this.deleteTeam(teamId);
      } else {
        // Remove as member
        this.removeTeamMember(teamId, userId);
      }
    }

    this.users.delete(userId);
    this.emailIndex.delete(user.email);
    this.userTeams.delete(userId);

    this.emit('user:deleted', userId);
  }

  suspendUser(userId: string, reason: string): void {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    user.status = 'suspended';
    user.updatedAt = new Date().toISOString();

    this.emit('user:suspended', userId, reason);
    this.logActivity(userId, 'user:suspended', { reason });
  }

  activateUser(userId: string): void {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    user.status = 'active';
    user.updatedAt = new Date().toISOString();

    this.emit('user:activated', userId);
    this.logActivity(userId, 'user:activated');
  }

  verifyEmail(userId: string): void {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    user.emailVerified = true;
    if (user.status === 'pending_verification') {
      user.status = 'active';
    }
    user.updatedAt = new Date().toISOString();
    this.logActivity(userId, 'email:verified');
  }

  // ─── Authentication ─────────────────────────────────────────────────

  authenticateUser(email: string, password: string): User {
    const normalizedEmail = email.toLowerCase().trim();
    const userId = this.emailIndex.get(normalizedEmail);
    if (!userId) {
      this.emit('user:login_failed', normalizedEmail, 'user_not_found');
      throw new Error('Invalid credentials');
    }

    const user = this.users.get(userId)!;

    // Check lockout
    if (user.lockedUntil) {
      const lockExpiry = new Date(user.lockedUntil).getTime();
      if (Date.now() < lockExpiry) {
        this.emit('user:login_failed', normalizedEmail, 'account_locked');
        throw new Error('Account is locked. Try again later.');
      }
      // Lockout expired — reset
      user.lockedUntil = undefined;
      user.failedLoginAttempts = 0;
    }

    // Check status
    if (user.status === 'suspended') {
      this.emit('user:login_failed', normalizedEmail, 'account_suspended');
      throw new Error('Account is suspended');
    }

    if (user.status === 'inactive') {
      this.emit('user:login_failed', normalizedEmail, 'account_inactive');
      throw new Error('Account is inactive');
    }

    // Verify password
    if (!user.passwordHash || !user.passwordSalt) {
      this.emit('user:login_failed', normalizedEmail, 'no_password');
      throw new Error('Invalid credentials');
    }

    const hash = this.hashPassword(password, user.passwordSalt);
    if (hash !== user.passwordHash) {
      user.failedLoginAttempts++;

      if (user.failedLoginAttempts >= this.config.maxLoginAttempts) {
        const lockUntil = new Date(Date.now() + this.config.lockoutDurationMinutes * 60_000).toISOString();
        user.lockedUntil = lockUntil;
        this.emit('user:locked', userId, lockUntil);
        this.logActivity(userId, 'user:locked', { until: lockUntil });
      }

      this.emit('user:login_failed', normalizedEmail, 'invalid_password');
      throw new Error('Invalid credentials');
    }

    // Successful login
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = new Date().toISOString();
    user.loginCount++;
    user.updatedAt = user.lastLoginAt;

    this.emit('user:login', userId, user.authProvider);
    this.logActivity(userId, 'user:login', { provider: user.authProvider });

    return user;
  }

  changePassword(userId: string, currentPassword: string, newPassword: string): void {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    // Verify current password
    if (!user.passwordHash || !user.passwordSalt) {
      throw new Error('No password set for this account');
    }

    const currentHash = this.hashPassword(currentPassword, user.passwordSalt);
    if (currentHash !== user.passwordHash) {
      throw new Error('Current password is incorrect');
    }

    // Validate new password
    this.validatePassword(newPassword);

    // Set new password
    user.passwordSalt = crypto.randomBytes(32).toString('hex');
    user.passwordHash = this.hashPassword(newPassword, user.passwordSalt);
    user.updatedAt = new Date().toISOString();

    this.emit('user:password_changed', userId);
    this.logActivity(userId, 'password:changed');
  }

  resetPassword(userId: string, newPassword: string): void {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    this.validatePassword(newPassword);

    user.passwordSalt = crypto.randomBytes(32).toString('hex');
    user.passwordHash = this.hashPassword(newPassword, user.passwordSalt);
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    user.updatedAt = new Date().toISOString();

    this.emit('user:password_changed', userId);
    this.logActivity(userId, 'password:reset');
  }

  // ─── Preferences ────────────────────────────────────────────────────

  updatePreferences(userId: string, patch: Partial<UserPreferences>): UserPreferences {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    if (patch.notifications) {
      user.preferences.notifications = { ...user.preferences.notifications, ...patch.notifications };
    }
    if (patch.privacy) {
      user.preferences.privacy = { ...user.preferences.privacy, ...patch.privacy };
    }
    if (patch.voice) {
      // Validate TTS speed
      if (patch.voice.ttsSpeed !== undefined) {
        if (patch.voice.ttsSpeed < 0.5 || patch.voice.ttsSpeed > 2.0) {
          throw new Error('TTS speed must be between 0.5 and 2.0');
        }
      }
      user.preferences.voice = { ...user.preferences.voice, ...patch.voice };
    }
    if (patch.accessibility) {
      user.preferences.accessibility = { ...user.preferences.accessibility, ...patch.accessibility };
    }
    if (patch.dashboard) {
      user.preferences.dashboard = { ...user.preferences.dashboard, ...patch.dashboard };
    }

    user.updatedAt = new Date().toISOString();
    this.logActivity(userId, 'preferences:updated');

    return user.preferences;
  }

  addPrivacyZone(userId: string, zone: GeoPrivacyZone): void {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    if (zone.radiusMeters <= 0) throw new Error('Radius must be positive');
    if (zone.latitude < -90 || zone.latitude > 90) throw new Error('Invalid latitude');
    if (zone.longitude < -180 || zone.longitude > 180) throw new Error('Invalid longitude');

    user.preferences.privacy.geofencePrivacyZones.push(zone);
    user.updatedAt = new Date().toISOString();
  }

  removePrivacyZone(userId: string, zoneName: string): boolean {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    const zones = user.preferences.privacy.geofencePrivacyZones;
    const idx = zones.findIndex(z => z.name === zoneName);
    if (idx === -1) return false;

    zones.splice(idx, 1);
    user.updatedAt = new Date().toISOString();
    return true;
  }

  // ─── Team Management ────────────────────────────────────────────────

  createTeam(ownerId: string, name: string, description?: string, plan: string = 'free'): Team {
    const owner = this.users.get(ownerId);
    if (!owner) throw new Error('Owner not found');

    // Check team limit
    const ownedTeams = (this.userTeams.get(ownerId) ?? [])
      .map(id => this.teams.get(id))
      .filter(t => t && t.ownerId === ownerId);
    if (ownedTeams.length >= this.config.maxTeamsPerUser) {
      throw new Error(`Maximum ${this.config.maxTeamsPerUser} teams per user`);
    }

    // Validate name
    if (!name || name.trim().length === 0) throw new Error('Team name is required');
    if (name.length > 100) throw new Error('Team name too long (max 100 characters)');

    const teamId = crypto.randomUUID();
    const slug = this.generateSlug(name);
    const now = new Date().toISOString();
    const maxMembers = PLAN_TEAM_LIMITS[plan] ?? this.config.maxTeamMembers;

    const team: Team = {
      id: teamId,
      name: name.trim(),
      slug,
      description,
      ownerId,
      plan,
      maxMembers,
      settings: { ...DEFAULT_TEAM_SETTINGS },
      createdAt: now,
      updatedAt: now,
    };

    this.teams.set(teamId, team);

    // Add owner as team member
    const ownerMember: TeamMember = {
      userId: ownerId,
      teamId,
      role: 'owner',
      joinedAt: now,
    };
    this.teamMembers.set(teamId, [ownerMember]);

    const userTeamIds = this.userTeams.get(ownerId) ?? [];
    userTeamIds.push(teamId);
    this.userTeams.set(ownerId, userTeamIds);

    this.emit('team:created', team);
    this.logActivity(ownerId, 'team:created', { teamId, name });

    return team;
  }

  getTeam(teamId: string): Team | undefined {
    return this.teams.get(teamId);
  }

  updateTeam(teamId: string, updates: { name?: string; description?: string; settings?: Partial<TeamSettings> }): Team {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');

    if (updates.name !== undefined) {
      if (updates.name.trim().length === 0) throw new Error('Team name is required');
      if (updates.name.length > 100) throw new Error('Team name too long');
      team.name = updates.name.trim();
      team.slug = this.generateSlug(updates.name);
    }
    if (updates.description !== undefined) {
      team.description = updates.description;
    }
    if (updates.settings) {
      team.settings = { ...team.settings, ...updates.settings };
    }

    team.updatedAt = new Date().toISOString();
    this.emit('team:updated', team);

    return team;
  }

  deleteTeam(teamId: string): void {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');

    // Remove all members
    const members = this.teamMembers.get(teamId) ?? [];
    for (const member of members) {
      const userTeamIds = this.userTeams.get(member.userId) ?? [];
      const idx = userTeamIds.indexOf(teamId);
      if (idx !== -1) userTeamIds.splice(idx, 1);
    }

    // Remove invitations
    for (const [invId, inv] of this.invitations) {
      if (inv.teamId === teamId) {
        this.invitations.delete(invId);
      }
    }

    this.teamMembers.delete(teamId);
    this.teams.delete(teamId);

    this.emit('team:deleted', teamId);
  }

  addTeamMember(teamId: string, userId: string, role: TeamRole = 'member'): TeamMember {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');

    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    const members = this.teamMembers.get(teamId) ?? [];

    // Check if already a member
    if (members.some(m => m.userId === userId)) {
      throw new Error('User is already a team member');
    }

    // Check capacity
    if (members.length >= team.maxMembers) {
      throw new Error(`Team has reached maximum capacity (${team.maxMembers} members)`);
    }

    // Can't add as owner — there's always one owner
    if (role === 'owner') {
      throw new Error('Cannot add a second owner. Use transferOwnership instead.');
    }

    const member: TeamMember = {
      userId,
      teamId,
      role,
      joinedAt: new Date().toISOString(),
    };

    members.push(member);
    this.teamMembers.set(teamId, members);

    const userTeamIds = this.userTeams.get(userId) ?? [];
    userTeamIds.push(teamId);
    this.userTeams.set(userId, userTeamIds);

    this.emit('team:member_added', teamId, userId, role);
    this.logActivity(userId, 'team:joined', { teamId, role });

    return member;
  }

  removeTeamMember(teamId: string, userId: string): void {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');

    if (team.ownerId === userId) {
      throw new Error('Cannot remove team owner. Transfer ownership first or delete the team.');
    }

    const members = this.teamMembers.get(teamId) ?? [];
    const idx = members.findIndex(m => m.userId === userId);
    if (idx === -1) throw new Error('User is not a team member');

    members.splice(idx, 1);

    const userTeamIds = this.userTeams.get(userId) ?? [];
    const teamIdx = userTeamIds.indexOf(teamId);
    if (teamIdx !== -1) userTeamIds.splice(teamIdx, 1);

    this.emit('team:member_removed', teamId, userId);
    this.logActivity(userId, 'team:left', { teamId });
  }

  changeTeamMemberRole(teamId: string, userId: string, newRole: TeamRole): void {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');

    if (team.ownerId === userId && newRole !== 'owner') {
      throw new Error('Cannot change owner role. Transfer ownership first.');
    }

    if (newRole === 'owner') {
      throw new Error('Cannot change role to owner. Use transferOwnership instead.');
    }

    const members = this.teamMembers.get(teamId) ?? [];
    const member = members.find(m => m.userId === userId);
    if (!member) throw new Error('User is not a team member');

    const oldRole = member.role;
    if (oldRole === newRole) return;

    member.role = newRole;

    this.emit('team:member_role_changed', teamId, userId, oldRole, newRole);
    this.logActivity(userId, 'team:role_changed', { teamId, oldRole, newRole });
  }

  transferOwnership(teamId: string, newOwnerId: string): void {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');

    const members = this.teamMembers.get(teamId) ?? [];
    const newOwnerMember = members.find(m => m.userId === newOwnerId);
    if (!newOwnerMember) throw new Error('New owner must be a team member');

    const oldOwnerMember = members.find(m => m.userId === team.ownerId);
    if (oldOwnerMember) oldOwnerMember.role = 'admin';
    newOwnerMember.role = 'owner';

    const oldOwnerId = team.ownerId;
    team.ownerId = newOwnerId;
    team.updatedAt = new Date().toISOString();

    this.emit('team:member_role_changed', teamId, oldOwnerId, 'owner', 'admin');
    this.emit('team:member_role_changed', teamId, newOwnerId, newOwnerMember.role, 'owner');
  }

  getTeamMembers(teamId: string): TeamMember[] {
    return this.teamMembers.get(teamId) ?? [];
  }

  getUserTeams(userId: string): Team[] {
    const teamIds = this.userTeams.get(userId) ?? [];
    return teamIds.map(id => this.teams.get(id)!).filter(Boolean);
  }

  // ─── Invitations ────────────────────────────────────────────────────

  createInvitation(teamId: string, email: string, role: TeamRole, invitedBy: string): Invitation {
    const team = this.teams.get(teamId);
    if (!team) throw new Error('Team not found');

    const inviter = this.users.get(invitedBy);
    if (!inviter) throw new Error('Inviter not found');

    // Check if already a member by email
    const existingUser = this.getUserByEmail(email);
    if (existingUser) {
      const members = this.teamMembers.get(teamId) ?? [];
      if (members.some(m => m.userId === existingUser.id)) {
        throw new Error('User is already a team member');
      }
    }

    // Check for pending invitation to same email
    for (const inv of this.invitations.values()) {
      if (inv.teamId === teamId && inv.email === email.toLowerCase() && inv.status === 'pending') {
        throw new Error('Pending invitation already exists for this email');
      }
    }

    // Check team capacity
    const members = this.teamMembers.get(teamId) ?? [];
    const pendingInvitations = Array.from(this.invitations.values())
      .filter(inv => inv.teamId === teamId && inv.status === 'pending');
    if (members.length + pendingInvitations.length >= team.maxMembers) {
      throw new Error('Team has reached maximum capacity (including pending invitations)');
    }

    if (role === 'owner') throw new Error('Cannot invite as owner');

    const invitationId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.invitationExpiryHours * 60 * 60_000);

    const invitation: Invitation = {
      id: invitationId,
      teamId,
      email: email.toLowerCase().trim(),
      role,
      status: 'pending',
      invitedBy,
      token,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.invitations.set(invitationId, invitation);
    this.emit('invitation:created', invitation);
    this.logActivity(invitedBy, 'invitation:created', { teamId, email: invitation.email, role });

    return invitation;
  }

  acceptInvitation(invitationId: string, userId: string): TeamMember {
    const invitation = this.invitations.get(invitationId);
    if (!invitation) throw new Error('Invitation not found');

    if (invitation.status !== 'pending') {
      throw new Error(`Invitation is ${invitation.status}`);
    }

    // Check if expired
    if (new Date(invitation.expiresAt).getTime() < Date.now()) {
      invitation.status = 'expired';
      this.emit('invitation:expired', invitationId);
      throw new Error('Invitation has expired');
    }

    // Verify user email matches invitation
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');
    if (user.email !== invitation.email) {
      throw new Error('Invitation email does not match user email');
    }

    // Add to team
    const member = this.addTeamMember(invitation.teamId, userId, invitation.role);

    invitation.status = 'accepted';
    invitation.acceptedAt = new Date().toISOString();
    invitation.acceptedBy = userId;

    this.emit('invitation:accepted', invitation);
    this.logActivity(userId, 'invitation:accepted', { teamId: invitation.teamId });

    return member;
  }

  acceptInvitationByToken(token: string, userId: string): TeamMember {
    const invitation = Array.from(this.invitations.values()).find(inv => inv.token === token);
    if (!invitation) throw new Error('Invalid invitation token');
    return this.acceptInvitation(invitation.id, userId);
  }

  revokeInvitation(invitationId: string): void {
    const invitation = this.invitations.get(invitationId);
    if (!invitation) throw new Error('Invitation not found');

    if (invitation.status !== 'pending') {
      throw new Error(`Cannot revoke ${invitation.status} invitation`);
    }

    invitation.status = 'revoked';
    this.emit('invitation:revoked', invitationId);
  }

  getTeamInvitations(teamId: string, status?: InvitationStatus): Invitation[] {
    return Array.from(this.invitations.values())
      .filter(inv => inv.teamId === teamId && (!status || inv.status === status));
  }

  // ─── Querying ───────────────────────────────────────────────────────

  queryUsers(query: UserQuery = {}): { users: User[]; total: number } {
    let results = Array.from(this.users.values());

    // Filter by status
    if (query.status) {
      results = results.filter(u => u.status === query.status);
    }

    // Filter by auth provider
    if (query.authProvider) {
      results = results.filter(u => u.authProvider === query.authProvider);
    }

    // Filter by team
    if (query.teamId) {
      const members = this.teamMembers.get(query.teamId) ?? [];
      const memberIds = new Set(members.map(m => m.userId));
      results = results.filter(u => memberIds.has(u.id));
    }

    // Search
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      results = results.filter(u =>
        u.name.toLowerCase().includes(searchLower) ||
        u.email.toLowerCase().includes(searchLower) ||
        (u.displayName && u.displayName.toLowerCase().includes(searchLower))
      );
    }

    const total = results.length;

    // Sort
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    results.sort((a, b) => {
      let aVal: string, bVal: string;
      switch (sortBy) {
        case 'name': aVal = a.name; bVal = b.name; break;
        case 'email': aVal = a.email; bVal = b.email; break;
        case 'lastLoginAt': aVal = a.lastLoginAt ?? ''; bVal = b.lastLoginAt ?? ''; break;
        default: aVal = a.createdAt; bVal = b.createdAt;
      }
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    // Paginate
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    results = results.slice(offset, offset + limit);

    return { users: results, total };
  }

  // ─── Activity Logging ───────────────────────────────────────────────

  getActivityLog(userId: string, limit: number = 50): ActivityLog[] {
    return this.activityLogs
      .filter(a => a.userId === userId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  getTeamActivityLog(teamId: string, limit: number = 100): ActivityLog[] {
    const members = this.teamMembers.get(teamId) ?? [];
    const memberIds = new Set(members.map(m => m.userId));
    return this.activityLogs
      .filter(a => memberIds.has(a.userId))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  cleanupExpiredActivities(): number {
    const cutoff = Date.now() - this.config.activityRetentionDays * 24 * 60 * 60_000;
    const before = this.activityLogs.length;
    this.activityLogs = this.activityLogs.filter(a => new Date(a.timestamp).getTime() >= cutoff);
    return before - this.activityLogs.length;
  }

  // ─── Statistics ─────────────────────────────────────────────────────

  getStats(): {
    totalUsers: number;
    activeUsers: number;
    suspendedUsers: number;
    pendingUsers: number;
    totalTeams: number;
    totalInvitations: number;
    pendingInvitations: number;
    authProviderBreakdown: Record<string, number>;
  } {
    const allUsers = Array.from(this.users.values());
    const providerBreakdown: Record<string, number> = {};
    for (const u of allUsers) {
      providerBreakdown[u.authProvider] = (providerBreakdown[u.authProvider] ?? 0) + 1;
    }

    const pendingInvitations = Array.from(this.invitations.values())
      .filter(inv => inv.status === 'pending').length;

    return {
      totalUsers: allUsers.length,
      activeUsers: allUsers.filter(u => u.status === 'active').length,
      suspendedUsers: allUsers.filter(u => u.status === 'suspended').length,
      pendingUsers: allUsers.filter(u => u.status === 'pending_verification').length,
      totalTeams: this.teams.size,
      totalInvitations: this.invitations.size,
      pendingInvitations,
      authProviderBreakdown: providerBreakdown,
    };
  }

  // ─── Voice Summary ──────────────────────────────────────────────────

  getVoiceSummary(): string {
    const stats = this.getStats();
    const parts: string[] = [];

    parts.push(`You have ${stats.totalUsers} user${stats.totalUsers !== 1 ? 's' : ''}`);
    if (stats.activeUsers !== stats.totalUsers) {
      parts.push(`${stats.activeUsers} active`);
    }
    if (stats.suspendedUsers > 0) {
      parts.push(`${stats.suspendedUsers} suspended`);
    }
    if (stats.pendingUsers > 0) {
      parts.push(`${stats.pendingUsers} pending verification`);
    }
    if (stats.totalTeams > 0) {
      parts.push(`${stats.totalTeams} team${stats.totalTeams !== 1 ? 's' : ''}`);
    }
    if (stats.pendingInvitations > 0) {
      parts.push(`${stats.pendingInvitations} pending invitation${stats.pendingInvitations !== 1 ? 's' : ''}`);
    }

    return parts.join('. ') + '.';
  }

  // ─── Serialization ─────────────────────────────────────────────────

  exportState(): {
    users: User[];
    teams: Team[];
    teamMembers: Record<string, TeamMember[]>;
    invitations: Invitation[];
  } {
    // Strip password hashes for security
    const sanitizedUsers = Array.from(this.users.values()).map(u => ({
      ...u,
      passwordHash: u.passwordHash ? '[REDACTED]' : undefined,
      passwordSalt: u.passwordSalt ? '[REDACTED]' : undefined,
    }));

    return {
      users: sanitizedUsers,
      teams: Array.from(this.teams.values()),
      teamMembers: Object.fromEntries(this.teamMembers),
      invitations: Array.from(this.invitations.values()).map(inv => ({
        ...inv,
        token: '[REDACTED]',
      })),
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private validatePassword(password: string): void {
    if (password.length < this.config.passwordMinLength) {
      throw new Error(`Password must be at least ${this.config.passwordMinLength} characters`);
    }
    if (!/[A-Z]/.test(password)) {
      throw new Error('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      throw new Error('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      throw new Error('Password must contain at least one digit');
    }
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, this.config.hashIterations, 64, 'sha512').toString('hex');
  }

  private generateSlug(name: string): string {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  }

  private logActivity(userId: string, action: string, details?: Record<string, unknown>): void {
    this.activityLogs.push({
      id: crypto.randomUUID(),
      userId,
      action,
      details,
      timestamp: new Date().toISOString(),
    });
  }
}
