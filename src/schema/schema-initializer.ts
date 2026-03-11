/**
 * Schema Initializer — Database Schema Definitions Using Migration Engine
 *
 * Defines all database tables for the platform in proper migration order.
 * Uses the existing MigrationEngine to version, apply, and rollback schemas.
 *
 * Table groups:
 * 1. Core — users, teams, sessions, API keys
 * 2. Inventory — sessions, items, products, locations
 * 3. Vision — images, analyses, memory index
 * 4. Agents — agent state, routing history
 * 5. Billing — subscriptions, usage, invoices
 * 6. Audit — audit trail, compliance
 * 7. Config — feature flags, settings
 * 8. Notifications — templates, history, preferences
 * 9. Webhooks — endpoints, deliveries, dead letters
 * 10. Sync — device state, operations, conflicts
 *
 * @module schema/schema-initializer
 * @openclaw/raybans-vision
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  indexes?: IndexDefinition[];
  foreignKeys?: ForeignKeyDefinition[];
  /** Optional table-level constraints */
  constraints?: string[];
}

export interface ColumnDefinition {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB' | 'BOOLEAN' | 'DATETIME' | 'JSON';
  primaryKey?: boolean;
  autoIncrement?: boolean;
  nullable?: boolean;
  unique?: boolean;
  default?: string | number | boolean | null;
  /** Check constraint expression */
  check?: string;
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  unique?: boolean;
  where?: string; // partial index
}

export interface ForeignKeyDefinition {
  columns: string[];
  references: { table: string; columns: string[] };
  onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export interface MigrationDefinition {
  version: number;
  name: string;
  description: string;
  category: string;
  tables: TableDefinition[];
}

export interface SchemaInitializerConfig {
  /** Enable Write-Ahead Logging (WAL) mode */
  enableWAL?: boolean;
  /** Enable foreign key enforcement */
  enableForeignKeys?: boolean;
  /** Journal size limit */
  journalSizeLimit?: number;
  /** Cache size (pages) */
  cacheSize?: number;
}

export interface SchemaInitializerEvents {
  'migration:applying': (version: number, name: string) => void;
  'migration:applied': (version: number, name: string) => void;
  'migration:error': (version: number, error: Error) => void;
  'schema:complete': (tableCount: number) => void;
}

// ─── Table Definitions ──────────────────────────────────────────

const CORE_TABLES: TableDefinition[] = [
  {
    name: 'users',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'email', type: 'TEXT', unique: true },
      { name: 'name', type: 'TEXT' },
      { name: 'password_hash', type: 'TEXT' },
      { name: 'salt', type: 'TEXT' },
      { name: 'status', type: 'TEXT', default: 'active', check: "status IN ('active','suspended','inactive','pending')" },
      { name: 'auth_provider', type: 'TEXT', default: 'email' },
      { name: 'provider_id', type: 'TEXT', nullable: true },
      { name: 'email_verified', type: 'BOOLEAN', default: false },
      { name: 'role', type: 'TEXT', default: 'viewer' },
      { name: 'failed_login_attempts', type: 'INTEGER', default: 0 },
      { name: 'locked_until', type: 'DATETIME', nullable: true },
      { name: 'last_login_at', type: 'DATETIME', nullable: true },
      { name: 'preferences', type: 'JSON', nullable: true },
      { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
      { name: 'updated_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_users_email', columns: ['email'], unique: true },
      { name: 'idx_users_status', columns: ['status'] },
      { name: 'idx_users_provider', columns: ['auth_provider', 'provider_id'] },
    ],
  },
  {
    name: 'teams',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'name', type: 'TEXT' },
      { name: 'owner_id', type: 'TEXT' },
      { name: 'plan', type: 'TEXT', default: 'free' },
      { name: 'max_members', type: 'INTEGER', default: 5 },
      { name: 'settings', type: 'JSON', nullable: true },
      { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
      { name: 'updated_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_teams_owner', columns: ['owner_id'] },
    ],
    foreignKeys: [
      { columns: ['owner_id'], references: { table: 'users', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
  {
    name: 'team_members',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'team_id', type: 'TEXT' },
      { name: 'user_id', type: 'TEXT' },
      { name: 'role', type: 'TEXT', default: 'member', check: "role IN ('owner','admin','member','viewer')" },
      { name: 'joined_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_team_members_team', columns: ['team_id'] },
      { name: 'idx_team_members_user', columns: ['user_id'] },
      { name: 'idx_team_members_unique', columns: ['team_id', 'user_id'], unique: true },
    ],
    foreignKeys: [
      { columns: ['team_id'], references: { table: 'teams', columns: ['id'] }, onDelete: 'CASCADE' },
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
  {
    name: 'invitations',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'team_id', type: 'TEXT' },
      { name: 'email', type: 'TEXT' },
      { name: 'role', type: 'TEXT', default: 'member' },
      { name: 'token', type: 'TEXT', unique: true },
      { name: 'status', type: 'TEXT', default: 'pending', check: "status IN ('pending','accepted','expired','revoked')" },
      { name: 'invited_by', type: 'TEXT' },
      { name: 'expires_at', type: 'DATETIME' },
      { name: 'accepted_at', type: 'DATETIME', nullable: true },
      { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_invitations_team', columns: ['team_id'] },
      { name: 'idx_invitations_token', columns: ['token'], unique: true },
      { name: 'idx_invitations_email', columns: ['email'] },
    ],
    foreignKeys: [
      { columns: ['team_id'], references: { table: 'teams', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
  {
    name: 'api_keys',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'user_id', type: 'TEXT' },
      { name: 'key_hash', type: 'TEXT', unique: true },
      { name: 'key_prefix', type: 'TEXT' },
      { name: 'name', type: 'TEXT' },
      { name: 'scope', type: 'TEXT', default: 'read_only' },
      { name: 'permissions', type: 'JSON', nullable: true },
      { name: 'ip_allowlist', type: 'JSON', nullable: true },
      { name: 'last_used_at', type: 'DATETIME', nullable: true },
      { name: 'expires_at', type: 'DATETIME', nullable: true },
      { name: 'revoked', type: 'BOOLEAN', default: false },
      { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_api_keys_user', columns: ['user_id'] },
      { name: 'idx_api_keys_hash', columns: ['key_hash'], unique: true },
      { name: 'idx_api_keys_prefix', columns: ['key_prefix'] },
    ],
    foreignKeys: [
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
];

const INVENTORY_TABLES: TableDefinition[] = [
  {
    name: 'inventory_sessions',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'user_id', type: 'TEXT' },
      { name: 'store_name', type: 'TEXT', nullable: true },
      { name: 'store_location', type: 'JSON', nullable: true },
      { name: 'status', type: 'TEXT', default: 'active', check: "status IN ('active','paused','completed','cancelled')" },
      { name: 'item_count', type: 'INTEGER', default: 0 },
      { name: 'total_value', type: 'REAL', default: 0 },
      { name: 'flags_count', type: 'INTEGER', default: 0 },
      { name: 'config', type: 'JSON', nullable: true },
      { name: 'started_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
      { name: 'paused_at', type: 'DATETIME', nullable: true },
      { name: 'completed_at', type: 'DATETIME', nullable: true },
    ],
    indexes: [
      { name: 'idx_inv_sessions_user', columns: ['user_id'] },
      { name: 'idx_inv_sessions_status', columns: ['status'] },
      { name: 'idx_inv_sessions_store', columns: ['store_name'] },
      { name: 'idx_inv_sessions_date', columns: ['started_at'] },
    ],
    foreignKeys: [
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] } },
    ],
  },
  {
    name: 'inventory_items',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'session_id', type: 'TEXT' },
      { name: 'name', type: 'TEXT' },
      { name: 'brand', type: 'TEXT', nullable: true },
      { name: 'sku', type: 'TEXT', nullable: true },
      { name: 'upc', type: 'TEXT', nullable: true },
      { name: 'category', type: 'TEXT', nullable: true },
      { name: 'quantity', type: 'INTEGER', default: 1 },
      { name: 'price', type: 'REAL', nullable: true },
      { name: 'confidence', type: 'REAL', default: 0.5 },
      { name: 'aisle', type: 'TEXT', nullable: true },
      { name: 'section', type: 'TEXT', nullable: true },
      { name: 'shelf', type: 'TEXT', nullable: true },
      { name: 'flags', type: 'JSON', default: '[]' },
      { name: 'source_image_id', type: 'TEXT', nullable: true },
      { name: 'location', type: 'JSON', nullable: true },
      { name: 'metadata', type: 'JSON', nullable: true },
      { name: 'first_seen_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
      { name: 'last_updated_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_inv_items_session', columns: ['session_id'] },
      { name: 'idx_inv_items_upc', columns: ['upc'] },
      { name: 'idx_inv_items_sku', columns: ['sku'] },
      { name: 'idx_inv_items_category', columns: ['category'] },
      { name: 'idx_inv_items_aisle', columns: ['session_id', 'aisle'] },
      { name: 'idx_inv_items_name', columns: ['name'] },
    ],
    foreignKeys: [
      { columns: ['session_id'], references: { table: 'inventory_sessions', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
  {
    name: 'products',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'upc', type: 'TEXT', unique: true },
      { name: 'name', type: 'TEXT' },
      { name: 'brand', type: 'TEXT', nullable: true },
      { name: 'category', type: 'TEXT', nullable: true },
      { name: 'description', type: 'TEXT', nullable: true },
      { name: 'image_url', type: 'TEXT', nullable: true },
      { name: 'average_price', type: 'REAL', nullable: true },
      { name: 'data_source', type: 'TEXT' },
      { name: 'raw_data', type: 'JSON', nullable: true },
      { name: 'fetched_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
      { name: 'expires_at', type: 'DATETIME', nullable: true },
    ],
    indexes: [
      { name: 'idx_products_upc', columns: ['upc'], unique: true },
      { name: 'idx_products_brand', columns: ['brand'] },
      { name: 'idx_products_category', columns: ['category'] },
    ],
  },
];

const VISION_TABLES: TableDefinition[] = [
  {
    name: 'captured_images',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'user_id', type: 'TEXT' },
      { name: 'device_id', type: 'TEXT' },
      { name: 'mime_type', type: 'TEXT' },
      { name: 'file_path', type: 'TEXT' },
      { name: 'file_size', type: 'INTEGER' },
      { name: 'trigger_type', type: 'TEXT' },
      { name: 'location', type: 'JSON', nullable: true },
      { name: 'voice_annotation', type: 'TEXT', nullable: true },
      { name: 'session_id', type: 'TEXT', nullable: true },
      { name: 'captured_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_images_user', columns: ['user_id'] },
      { name: 'idx_images_device', columns: ['device_id'] },
      { name: 'idx_images_session', columns: ['session_id'] },
      { name: 'idx_images_captured', columns: ['captured_at'] },
    ],
    foreignKeys: [
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] } },
    ],
  },
  {
    name: 'vision_analyses',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'image_id', type: 'TEXT' },
      { name: 'analysis_mode', type: 'TEXT' },
      { name: 'scene_description', type: 'TEXT', nullable: true },
      { name: 'scene_type', type: 'TEXT', nullable: true },
      { name: 'products', type: 'JSON', default: '[]' },
      { name: 'barcodes', type: 'JSON', default: '[]' },
      { name: 'extracted_text', type: 'JSON', default: '[]' },
      { name: 'detected_objects', type: 'JSON', default: '[]' },
      { name: 'quality', type: 'JSON', nullable: true },
      { name: 'processing_time_ms', type: 'INTEGER' },
      { name: 'model_used', type: 'TEXT', nullable: true },
      { name: 'raw_response', type: 'TEXT', nullable: true },
      { name: 'analyzed_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_analyses_image', columns: ['image_id'] },
      { name: 'idx_analyses_mode', columns: ['analysis_mode'] },
      { name: 'idx_analyses_scene', columns: ['scene_type'] },
      { name: 'idx_analyses_date', columns: ['analyzed_at'] },
    ],
    foreignKeys: [
      { columns: ['image_id'], references: { table: 'captured_images', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
  {
    name: 'memory_index',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'user_id', type: 'TEXT' },
      { name: 'image_id', type: 'TEXT' },
      { name: 'scene_description', type: 'TEXT' },
      { name: 'ocr_text', type: 'TEXT', nullable: true },
      { name: 'objects', type: 'JSON', default: '[]' },
      { name: 'products', type: 'JSON', default: '[]' },
      { name: 'tags', type: 'JSON', default: '[]' },
      { name: 'location', type: 'JSON', nullable: true },
      { name: 'voice_annotation', type: 'TEXT', nullable: true },
      { name: 'priority', type: 'INTEGER', default: 0 },
      { name: 'indexed_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
      { name: 'expires_at', type: 'DATETIME', nullable: true },
    ],
    indexes: [
      { name: 'idx_memory_user', columns: ['user_id'] },
      { name: 'idx_memory_image', columns: ['image_id'] },
      { name: 'idx_memory_date', columns: ['indexed_at'] },
      { name: 'idx_memory_priority', columns: ['priority'] },
    ],
    foreignKeys: [
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] } },
      { columns: ['image_id'], references: { table: 'captured_images', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
];

const AGENT_TABLES: TableDefinition[] = [
  {
    name: 'agent_routing_history',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'image_id', type: 'TEXT' },
      { name: 'user_id', type: 'TEXT' },
      { name: 'agent_name', type: 'TEXT' },
      { name: 'routing_mode', type: 'TEXT' },
      { name: 'confidence', type: 'REAL' },
      { name: 'processing_time_ms', type: 'INTEGER' },
      { name: 'result_summary', type: 'TEXT', nullable: true },
      { name: 'voice_response', type: 'TEXT', nullable: true },
      { name: 'error', type: 'TEXT', nullable: true },
      { name: 'routed_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_routing_image', columns: ['image_id'] },
      { name: 'idx_routing_user', columns: ['user_id'] },
      { name: 'idx_routing_agent', columns: ['agent_name'] },
      { name: 'idx_routing_date', columns: ['routed_at'] },
    ],
  },
  {
    name: 'contacts',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'user_id', type: 'TEXT' },
      { name: 'name', type: 'TEXT' },
      { name: 'title', type: 'TEXT', nullable: true },
      { name: 'company', type: 'TEXT', nullable: true },
      { name: 'email', type: 'TEXT', nullable: true },
      { name: 'phone', type: 'TEXT', nullable: true },
      { name: 'linkedin', type: 'TEXT', nullable: true },
      { name: 'twitter', type: 'TEXT', nullable: true },
      { name: 'github', type: 'TEXT', nullable: true },
      { name: 'website', type: 'TEXT', nullable: true },
      { name: 'notes', type: 'TEXT', nullable: true },
      { name: 'research', type: 'JSON', nullable: true },
      { name: 'source_image_id', type: 'TEXT', nullable: true },
      { name: 'met_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
      { name: 'last_seen_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_contacts_user', columns: ['user_id'] },
      { name: 'idx_contacts_email', columns: ['user_id', 'email'] },
      { name: 'idx_contacts_name', columns: ['user_id', 'name'] },
      { name: 'idx_contacts_company', columns: ['company'] },
    ],
    foreignKeys: [
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
  {
    name: 'deal_history',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'user_id', type: 'TEXT' },
      { name: 'category', type: 'TEXT', check: "category IN ('product','vehicle','real_estate')" },
      { name: 'item_name', type: 'TEXT' },
      { name: 'asking_price', type: 'REAL', nullable: true },
      { name: 'fair_value', type: 'REAL', nullable: true },
      { name: 'verdict', type: 'TEXT' },
      { name: 'savings', type: 'REAL', nullable: true },
      { name: 'market_data', type: 'JSON', nullable: true },
      { name: 'source_image_id', type: 'TEXT', nullable: true },
      { name: 'location', type: 'JSON', nullable: true },
      { name: 'analyzed_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_deals_user', columns: ['user_id'] },
      { name: 'idx_deals_category', columns: ['category'] },
      { name: 'idx_deals_verdict', columns: ['verdict'] },
      { name: 'idx_deals_date', columns: ['analyzed_at'] },
    ],
    foreignKeys: [
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
];

const BILLING_TABLES: TableDefinition[] = [
  {
    name: 'subscriptions',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'user_id', type: 'TEXT' },
      { name: 'stripe_customer_id', type: 'TEXT', nullable: true },
      { name: 'stripe_subscription_id', type: 'TEXT', nullable: true },
      { name: 'plan', type: 'TEXT', default: 'free' },
      { name: 'status', type: 'TEXT', default: 'active', check: "status IN ('active','past_due','cancelled','trialing','unpaid','paused')" },
      { name: 'billing_interval', type: 'TEXT', default: 'monthly', check: "billing_interval IN ('monthly','yearly')" },
      { name: 'current_period_start', type: 'DATETIME', nullable: true },
      { name: 'current_period_end', type: 'DATETIME', nullable: true },
      { name: 'cancel_at_period_end', type: 'BOOLEAN', default: false },
      { name: 'payment_method', type: 'JSON', nullable: true },
      { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
      { name: 'updated_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_subs_user', columns: ['user_id'], unique: true },
      { name: 'idx_subs_stripe_customer', columns: ['stripe_customer_id'] },
      { name: 'idx_subs_stripe_sub', columns: ['stripe_subscription_id'] },
      { name: 'idx_subs_status', columns: ['status'] },
      { name: 'idx_subs_plan', columns: ['plan'] },
    ],
    foreignKeys: [
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
  {
    name: 'usage_records',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'user_id', type: 'TEXT' },
      { name: 'resource_type', type: 'TEXT' },
      { name: 'quantity', type: 'REAL', default: 1 },
      { name: 'unit', type: 'TEXT', default: 'count' },
      { name: 'billed', type: 'BOOLEAN', default: false },
      { name: 'billing_period', type: 'TEXT', nullable: true },
      { name: 'metadata', type: 'JSON', nullable: true },
      { name: 'recorded_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_usage_user', columns: ['user_id'] },
      { name: 'idx_usage_resource', columns: ['resource_type'] },
      { name: 'idx_usage_period', columns: ['billing_period'] },
      { name: 'idx_usage_billed', columns: ['billed'], where: 'billed = 0' },
      { name: 'idx_usage_date', columns: ['recorded_at'] },
    ],
    foreignKeys: [
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
];

const AUDIT_TABLES: TableDefinition[] = [
  {
    name: 'audit_events',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'sequence', type: 'INTEGER', unique: true },
      { name: 'category', type: 'TEXT' },
      { name: 'action', type: 'TEXT' },
      { name: 'actor_type', type: 'TEXT' },
      { name: 'actor_id', type: 'TEXT' },
      { name: 'actor_name', type: 'TEXT', nullable: true },
      { name: 'actor_role', type: 'TEXT', nullable: true },
      { name: 'target_type', type: 'TEXT', nullable: true },
      { name: 'target_id', type: 'TEXT', nullable: true },
      { name: 'target_label', type: 'TEXT', nullable: true },
      { name: 'changes', type: 'JSON', nullable: true },
      { name: 'outcome', type: 'TEXT' },
      { name: 'severity', type: 'TEXT' },
      { name: 'description', type: 'TEXT' },
      { name: 'metadata', type: 'JSON', nullable: true },
      { name: 'ip_address', type: 'TEXT', nullable: true },
      { name: 'user_agent', type: 'TEXT', nullable: true },
      { name: 'correlation_id', type: 'TEXT', nullable: true },
      { name: 'hash', type: 'TEXT', nullable: true },
      { name: 'timestamp', type: 'DATETIME' },
    ],
    indexes: [
      { name: 'idx_audit_category', columns: ['category'] },
      { name: 'idx_audit_action', columns: ['action'] },
      { name: 'idx_audit_actor', columns: ['actor_id'] },
      { name: 'idx_audit_target', columns: ['target_type', 'target_id'] },
      { name: 'idx_audit_outcome', columns: ['outcome'] },
      { name: 'idx_audit_severity', columns: ['severity'] },
      { name: 'idx_audit_correlation', columns: ['correlation_id'] },
      { name: 'idx_audit_timestamp', columns: ['timestamp'] },
      { name: 'idx_audit_sequence', columns: ['sequence'], unique: true },
    ],
  },
];

const NOTIFICATION_TABLES: TableDefinition[] = [
  {
    name: 'notifications',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'user_id', type: 'TEXT' },
      { name: 'category', type: 'TEXT' },
      { name: 'priority', type: 'TEXT', default: 'normal' },
      { name: 'title', type: 'TEXT' },
      { name: 'body', type: 'TEXT' },
      { name: 'voice_text', type: 'TEXT', nullable: true },
      { name: 'action_url', type: 'TEXT', nullable: true },
      { name: 'metadata', type: 'JSON', nullable: true },
      { name: 'read', type: 'BOOLEAN', default: false },
      { name: 'read_at', type: 'DATETIME', nullable: true },
      { name: 'dismissed', type: 'BOOLEAN', default: false },
      { name: 'dismissed_at', type: 'DATETIME', nullable: true },
      { name: 'expires_at', type: 'DATETIME', nullable: true },
      { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_notifs_user', columns: ['user_id'] },
      { name: 'idx_notifs_category', columns: ['category'] },
      { name: 'idx_notifs_priority', columns: ['priority'] },
      { name: 'idx_notifs_unread', columns: ['user_id', 'read'], where: 'read = 0' },
      { name: 'idx_notifs_date', columns: ['created_at'] },
    ],
    foreignKeys: [
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
  {
    name: 'notification_deliveries',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'notification_id', type: 'TEXT' },
      { name: 'channel', type: 'TEXT' },
      { name: 'status', type: 'TEXT', default: 'queued', check: "status IN ('queued','sending','sent','delivered','failed','read')" },
      { name: 'provider_message_id', type: 'TEXT', nullable: true },
      { name: 'attempts', type: 'INTEGER', default: 0 },
      { name: 'last_error', type: 'TEXT', nullable: true },
      { name: 'sent_at', type: 'DATETIME', nullable: true },
      { name: 'delivered_at', type: 'DATETIME', nullable: true },
      { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_deliveries_notif', columns: ['notification_id'] },
      { name: 'idx_deliveries_channel', columns: ['channel'] },
      { name: 'idx_deliveries_status', columns: ['status'] },
    ],
    foreignKeys: [
      { columns: ['notification_id'], references: { table: 'notifications', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
];

const WEBHOOK_TABLES: TableDefinition[] = [
  {
    name: 'webhook_endpoints',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'user_id', type: 'TEXT' },
      { name: 'url', type: 'TEXT' },
      { name: 'secret', type: 'TEXT' },
      { name: 'events', type: 'JSON', default: '["*"]' },
      { name: 'integration_type', type: 'TEXT', default: 'generic' },
      { name: 'active', type: 'BOOLEAN', default: true },
      { name: 'health', type: 'TEXT', default: 'healthy' },
      { name: 'consecutive_failures', type: 'INTEGER', default: 0 },
      { name: 'rate_limit_per_minute', type: 'INTEGER', default: 60 },
      { name: 'metadata', type: 'JSON', nullable: true },
      { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
      { name: 'updated_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_webhooks_user', columns: ['user_id'] },
      { name: 'idx_webhooks_active', columns: ['active'] },
      { name: 'idx_webhooks_health', columns: ['health'] },
    ],
    foreignKeys: [
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
  {
    name: 'webhook_deliveries',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'endpoint_id', type: 'TEXT' },
      { name: 'event_type', type: 'TEXT' },
      { name: 'payload', type: 'JSON' },
      { name: 'status', type: 'TEXT', default: 'pending', check: "status IN ('pending','sending','success','failed','dead_letter')" },
      { name: 'response_status', type: 'INTEGER', nullable: true },
      { name: 'response_body', type: 'TEXT', nullable: true },
      { name: 'attempts', type: 'INTEGER', default: 0 },
      { name: 'next_retry_at', type: 'DATETIME', nullable: true },
      { name: 'signature', type: 'TEXT', nullable: true },
      { name: 'duration_ms', type: 'INTEGER', nullable: true },
      { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_wh_deliveries_endpoint', columns: ['endpoint_id'] },
      { name: 'idx_wh_deliveries_event', columns: ['event_type'] },
      { name: 'idx_wh_deliveries_status', columns: ['status'] },
      { name: 'idx_wh_deliveries_retry', columns: ['next_retry_at'], where: "status = 'failed'" },
      { name: 'idx_wh_deliveries_date', columns: ['created_at'] },
    ],
    foreignKeys: [
      { columns: ['endpoint_id'], references: { table: 'webhook_endpoints', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
];

const DEVICE_TABLES: TableDefinition[] = [
  {
    name: 'devices',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'user_id', type: 'TEXT' },
      { name: 'name', type: 'TEXT' },
      { name: 'type', type: 'TEXT', check: "type IN ('glasses','phone','dashboard','companion','api')" },
      { name: 'capabilities', type: 'JSON', default: '[]' },
      { name: 'status', type: 'TEXT', default: 'online' },
      { name: 'firmware_version', type: 'TEXT', nullable: true },
      { name: 'last_seen_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
      { name: 'paired_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_devices_user', columns: ['user_id'] },
      { name: 'idx_devices_type', columns: ['type'] },
      { name: 'idx_devices_status', columns: ['status'] },
    ],
    foreignKeys: [
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
  {
    name: 'device_sync_operations',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'device_id', type: 'TEXT' },
      { name: 'namespace', type: 'TEXT' },
      { name: 'key', type: 'TEXT' },
      { name: 'value', type: 'JSON', nullable: true },
      { name: 'operation_type', type: 'TEXT', check: "operation_type IN ('set','delete','sync')" },
      { name: 'vector_clock', type: 'JSON' },
      { name: 'conflict_strategy', type: 'TEXT', nullable: true },
      { name: 'status', type: 'TEXT', default: 'pending' },
      { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_sync_device', columns: ['device_id'] },
      { name: 'idx_sync_namespace', columns: ['namespace'] },
      { name: 'idx_sync_key', columns: ['namespace', 'key'] },
      { name: 'idx_sync_status', columns: ['status'] },
    ],
    foreignKeys: [
      { columns: ['device_id'], references: { table: 'devices', columns: ['id'] }, onDelete: 'CASCADE' },
    ],
  },
];

const CONFIG_TABLES: TableDefinition[] = [
  {
    name: 'config_entries',
    columns: [
      { name: 'key', type: 'TEXT', primaryKey: true },
      { name: 'value', type: 'JSON' },
      { name: 'environment', type: 'TEXT', default: 'production' },
      { name: 'encrypted', type: 'BOOLEAN', default: false },
      { name: 'updated_by', type: 'TEXT', nullable: true },
      { name: 'updated_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_config_env', columns: ['environment'] },
    ],
  },
  {
    name: 'feature_flags',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },
      { name: 'name', type: 'TEXT', unique: true },
      { name: 'enabled', type: 'BOOLEAN', default: false },
      { name: 'rollout_percentage', type: 'REAL', default: 0 },
      { name: 'target_users', type: 'JSON', default: '[]' },
      { name: 'target_environments', type: 'JSON', default: '[]' },
      { name: 'description', type: 'TEXT', nullable: true },
      { name: 'created_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
      { name: 'updated_at', type: 'DATETIME', default: "CURRENT_TIMESTAMP" },
    ],
    indexes: [
      { name: 'idx_flags_name', columns: ['name'], unique: true },
      { name: 'idx_flags_enabled', columns: ['enabled'] },
    ],
  },
];

// ─── All Migrations ─────────────────────────────────────────────

export const ALL_MIGRATIONS: MigrationDefinition[] = [
  { version: 1, name: 'create_core_tables', description: 'Users, teams, invitations, API keys', category: 'core', tables: CORE_TABLES },
  { version: 2, name: 'create_inventory_tables', description: 'Inventory sessions, items, products', category: 'inventory', tables: INVENTORY_TABLES },
  { version: 3, name: 'create_vision_tables', description: 'Captured images, analyses, memory index', category: 'vision', tables: VISION_TABLES },
  { version: 4, name: 'create_agent_tables', description: 'Agent routing, contacts, deal history', category: 'agents', tables: AGENT_TABLES },
  { version: 5, name: 'create_billing_tables', description: 'Subscriptions, usage records', category: 'billing', tables: BILLING_TABLES },
  { version: 6, name: 'create_audit_tables', description: 'Audit event log', category: 'audit', tables: AUDIT_TABLES },
  { version: 7, name: 'create_notification_tables', description: 'Notifications, deliveries', category: 'notifications', tables: NOTIFICATION_TABLES },
  { version: 8, name: 'create_webhook_tables', description: 'Webhook endpoints, deliveries', category: 'webhooks', tables: WEBHOOK_TABLES },
  { version: 9, name: 'create_device_tables', description: 'Devices, sync operations', category: 'devices', tables: DEVICE_TABLES },
  { version: 10, name: 'create_config_tables', description: 'Configuration entries, feature flags', category: 'config', tables: CONFIG_TABLES },
];

// ─── SQL Generation ─────────────────────────────────────────────

/**
 * Generate CREATE TABLE SQL from a TableDefinition
 */
export function generateCreateTableSQL(table: TableDefinition): string {
  const parts: string[] = [];
  parts.push(`CREATE TABLE IF NOT EXISTS ${table.name} (`);

  const columnDefs: string[] = [];
  for (const col of table.columns) {
    let def = `  ${col.name} ${col.type}`;
    if (col.primaryKey) def += ' PRIMARY KEY';
    if (col.autoIncrement) def += ' AUTOINCREMENT';
    if (col.unique && !col.primaryKey) def += ' UNIQUE';
    if (col.nullable === false || col.primaryKey) {
      // Primary keys are implicitly NOT NULL
      if (!col.primaryKey) def += ' NOT NULL';
    }
    if (col.default !== undefined) {
      if (col.default === "CURRENT_TIMESTAMP") {
        def += ` DEFAULT ${col.default}`;
      } else if (typeof col.default === 'string') {
        def += ` DEFAULT '${col.default}'`;
      } else if (typeof col.default === 'boolean') {
        def += ` DEFAULT ${col.default ? 1 : 0}`;
      } else if (col.default === null) {
        def += ' DEFAULT NULL';
      } else {
        def += ` DEFAULT ${col.default}`;
      }
    }
    if (col.check) {
      def += ` CHECK(${col.check})`;
    }
    columnDefs.push(def);
  }

  // Foreign keys
  if (table.foreignKeys) {
    for (const fk of table.foreignKeys) {
      let fkDef = `  FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.references.table}(${fk.references.columns.join(', ')})`;
      if (fk.onDelete) fkDef += ` ON DELETE ${fk.onDelete}`;
      if (fk.onUpdate) fkDef += ` ON UPDATE ${fk.onUpdate}`;
      columnDefs.push(fkDef);
    }
  }

  parts.push(columnDefs.join(',\n'));
  parts.push(');');

  return parts.join('\n');
}

/**
 * Generate CREATE INDEX SQL from an IndexDefinition
 */
export function generateCreateIndexSQL(tableName: string, index: IndexDefinition): string {
  const unique = index.unique ? 'UNIQUE ' : '';
  let sql = `CREATE ${unique}INDEX IF NOT EXISTS ${index.name} ON ${tableName}(${index.columns.join(', ')})`;
  if (index.where) {
    sql += ` WHERE ${index.where}`;
  }
  return sql + ';';
}

/**
 * Generate DROP TABLE SQL
 */
export function generateDropTableSQL(tableName: string): string {
  return `DROP TABLE IF EXISTS ${tableName};`;
}

/**
 * Generate all SQL for a migration
 */
export function generateMigrationSQL(migration: MigrationDefinition): { up: string[]; down: string[] } {
  const up: string[] = [];
  const down: string[] = [];

  for (const table of migration.tables) {
    up.push(generateCreateTableSQL(table));
    if (table.indexes) {
      for (const index of table.indexes) {
        up.push(generateCreateIndexSQL(table.name, index));
      }
    }
  }

  // Drop in reverse order for down migration (respects foreign keys)
  for (const table of [...migration.tables].reverse()) {
    down.push(generateDropTableSQL(table.name));
  }

  return { up, down };
}

// ─── Schema Initializer ─────────────────────────────────────────

export class SchemaInitializer extends EventEmitter {
  private config: Required<SchemaInitializerConfig>;
  private appliedMigrations: Set<number> = new Set();

  constructor(config: SchemaInitializerConfig = {}) {
    super();
    this.config = {
      enableWAL: config.enableWAL ?? true,
      enableForeignKeys: config.enableForeignKeys ?? true,
      journalSizeLimit: config.journalSizeLimit ?? 67_108_864, // 64MB
      cacheSize: config.cacheSize ?? 2000,
    };
  }

  /**
   * Get all migration definitions
   */
  getMigrations(): MigrationDefinition[] {
    return [...ALL_MIGRATIONS];
  }

  /**
   * Get a specific migration by version
   */
  getMigration(version: number): MigrationDefinition | undefined {
    return ALL_MIGRATIONS.find(m => m.version === version);
  }

  /**
   * Generate all SQL for a specific migration version
   */
  generateSQL(version: number): { up: string[]; down: string[] } | null {
    const migration = this.getMigration(version);
    if (!migration) return null;
    return generateMigrationSQL(migration);
  }

  /**
   * Generate all SQL for all migrations
   */
  generateAllSQL(): { version: number; name: string; up: string[]; down: string[] }[] {
    return ALL_MIGRATIONS.map(m => ({
      version: m.version,
      name: m.name,
      ...generateMigrationSQL(m),
    }));
  }

  /**
   * Get SQLite pragma setup statements
   */
  getPragmaStatements(): string[] {
    const pragmas: string[] = [];
    if (this.config.enableWAL) {
      pragmas.push('PRAGMA journal_mode=WAL;');
    }
    if (this.config.enableForeignKeys) {
      pragmas.push('PRAGMA foreign_keys=ON;');
    }
    pragmas.push(`PRAGMA journal_size_limit=${this.config.journalSizeLimit};`);
    pragmas.push(`PRAGMA cache_size=${this.config.cacheSize};`);
    return pragmas;
  }

  /**
   * Get FTS5 virtual table creation statements for full-text search
   */
  getFTS5Statements(): string[] {
    return [
      `CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        scene_description,
        ocr_text,
        voice_annotation,
        tags,
        content='memory_index',
        content_rowid='rowid'
      );`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
        name,
        brand,
        category,
        description,
        content='products',
        content_rowid='rowid'
      );`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
        name,
        company,
        title,
        notes,
        content='contacts',
        content_rowid='rowid'
      );`,
    ];
  }

  /**
   * Simulate applying a migration (marks as applied without running SQL)
   * Used for in-memory tracking
   */
  markApplied(version: number): void {
    this.appliedMigrations.add(version);
    const migration = this.getMigration(version);
    if (migration) {
      this.emit('migration:applied', version, migration.name);
    }
  }

  /**
   * Check if a migration version has been applied
   */
  isApplied(version: number): boolean {
    return this.appliedMigrations.has(version);
  }

  /**
   * Get pending migration versions
   */
  getPendingVersions(): number[] {
    return ALL_MIGRATIONS
      .filter(m => !this.appliedMigrations.has(m.version))
      .map(m => m.version);
  }

  /**
   * Get all table names across all migrations
   */
  getAllTableNames(): string[] {
    const tables: string[] = [];
    for (const migration of ALL_MIGRATIONS) {
      for (const table of migration.tables) {
        tables.push(table.name);
      }
    }
    return tables;
  }

  /**
   * Get total index count across all tables
   */
  getTotalIndexCount(): number {
    let count = 0;
    for (const migration of ALL_MIGRATIONS) {
      for (const table of migration.tables) {
        count += table.indexes?.length || 0;
      }
    }
    return count;
  }

  /**
   * Get total column count across all tables
   */
  getTotalColumnCount(): number {
    let count = 0;
    for (const migration of ALL_MIGRATIONS) {
      for (const table of migration.tables) {
        count += table.columns.length;
      }
    }
    return count;
  }

  /**
   * Get schema statistics
   */
  getStats(): {
    migrations: number;
    tables: number;
    columns: number;
    indexes: number;
    foreignKeys: number;
    applied: number;
    pending: number;
  } {
    let foreignKeys = 0;
    for (const migration of ALL_MIGRATIONS) {
      for (const table of migration.tables) {
        foreignKeys += table.foreignKeys?.length || 0;
      }
    }

    return {
      migrations: ALL_MIGRATIONS.length,
      tables: this.getAllTableNames().length,
      columns: this.getTotalColumnCount(),
      indexes: this.getTotalIndexCount(),
      foreignKeys,
      applied: this.appliedMigrations.size,
      pending: this.getPendingVersions().length,
    };
  }

  /**
   * Generate a voice-friendly schema summary
   */
  getVoiceSummary(): string {
    const stats = this.getStats();
    return `Database schema has ${stats.tables} tables with ${stats.columns} columns and ${stats.indexes} indexes across ${stats.migrations} migrations. ${stats.applied} applied, ${stats.pending} pending.`;
  }

  /**
   * Get a table definition by name
   */
  getTableDefinition(tableName: string): TableDefinition | undefined {
    for (const migration of ALL_MIGRATIONS) {
      for (const table of migration.tables) {
        if (table.name === tableName) return table;
      }
    }
    return undefined;
  }

  /**
   * Validate schema integrity — checks for:
   * - Foreign key references to existing tables
   * - No duplicate table names
   * - No duplicate index names
   * - Proper primary keys
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const tableNames = new Set<string>();
    const indexNames = new Set<string>();
    const allTableNames = this.getAllTableNames();

    for (const migration of ALL_MIGRATIONS) {
      for (const table of migration.tables) {
        // Duplicate table names
        if (tableNames.has(table.name)) {
          errors.push(`Duplicate table name: ${table.name}`);
        }
        tableNames.add(table.name);

        // Check for primary key
        const hasPK = table.columns.some(c => c.primaryKey);
        if (!hasPK) {
          errors.push(`Table ${table.name} has no primary key`);
        }

        // Check indexes
        if (table.indexes) {
          for (const idx of table.indexes) {
            if (indexNames.has(idx.name)) {
              errors.push(`Duplicate index name: ${idx.name}`);
            }
            indexNames.add(idx.name);

            // Check columns exist
            for (const col of idx.columns) {
              if (!table.columns.some(c => c.name === col)) {
                errors.push(`Index ${idx.name} references non-existent column ${col} in ${table.name}`);
              }
            }
          }
        }

        // Check foreign keys
        if (table.foreignKeys) {
          for (const fk of table.foreignKeys) {
            if (!allTableNames.includes(fk.references.table)) {
              errors.push(`Foreign key in ${table.name} references non-existent table ${fk.references.table}`);
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Reset applied state
   */
  reset(): void {
    this.appliedMigrations.clear();
  }
}
