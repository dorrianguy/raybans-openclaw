/**
 * Persistence Layer — SQLite storage for inventory sessions, items, and visual memory.
 *
 * All data is local-first (privacy by default). This module handles:
 * - Inventory session CRUD
 * - Inventory item storage + querying
 * - Image metadata storage (buffer stored on disk, metadata in SQLite)
 * - Visual memory index (for Perfect Memory agent)
 * - Full-text search over extracted text
 *
 * Uses better-sqlite3 for synchronous, high-performance local storage.
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import type {
  InventorySession,
  InventorySessionStatus,
  InventoryItem,
  InventoryConfig,
  InventoryStats,
  InventoryFlag,
  StoreLocation,
  VisionAnalysis,
  CapturedImage,
  GeoLocation,
} from '../types.js';
import { DEFAULT_INVENTORY_CONFIG } from '../types.js';

// ─── Configuration ──────────────────────────────────────────────

export interface PersistenceConfig {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Directory to store image files */
  imageDir: string;
  /** Enable WAL mode for better concurrency (default: true) */
  walMode?: boolean;
  /** Auto-cleanup: delete images older than this many days (0 = never) */
  imageRetentionDays?: number;
}

// ─── Query Types ────────────────────────────────────────────────

export interface SessionQuery {
  status?: InventorySessionStatus;
  storeName?: string;
  startedAfter?: string;
  startedBefore?: string;
  limit?: number;
  offset?: number;
}

export interface ItemQuery {
  sessionId: string;
  category?: string;
  aisle?: string;
  minConfidence?: number;
  flagged?: boolean;
  search?: string;
  sortBy?: 'name' | 'quantity' | 'category' | 'confidence' | 'lastSeen';
  sortDirection?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface MemoryQuery {
  search?: string;
  sceneType?: string;
  startDate?: string;
  endDate?: string;
  hasText?: boolean;
  limit?: number;
  offset?: number;
}

export interface MemoryEntry {
  id: string;
  imageId: string;
  capturedAt: string;
  sceneDescription: string;
  sceneType: string;
  extractedText: string;
  objectLabels: string;
  productNames: string;
  latitude?: number;
  longitude?: number;
  tags: string[];
  voiceAnnotation?: string;
}

// ─── Persistence Implementation ─────────────────────────────────

export class PersistenceLayer {
  private db: Database.Database;
  private imageDir: string;
  private config: PersistenceConfig;

  constructor(config: PersistenceConfig) {
    this.config = config;
    this.imageDir = config.imageDir;

    // Ensure directories exist
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    fs.mkdirSync(config.imageDir, { recursive: true });

    // Initialize database
    this.db = new Database(config.dbPath);

    if (config.walMode !== false) {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');

    this.createTables();
  }

  // ─── Schema ─────────────────────────────────────────────────

  private createTables(): void {
    this.db.exec(`
      -- Inventory sessions
      CREATE TABLE IF NOT EXISTS inventory_sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        store_id TEXT,
        store_name TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        config_json TEXT NOT NULL,
        stats_json TEXT NOT NULL
      );

      -- Inventory items
      CREATE TABLE IF NOT EXISTS inventory_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES inventory_sessions(id),
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        brand TEXT,
        category TEXT,
        variant TEXT,
        quantity INTEGER NOT NULL DEFAULT 0,
        count_confidence REAL NOT NULL DEFAULT 0,
        identification_method TEXT NOT NULL,
        location_json TEXT NOT NULL DEFAULT '{}',
        price_on_shelf REAL,
        flags_json TEXT NOT NULL DEFAULT '[]',
        image_refs_json TEXT NOT NULL DEFAULT '[]',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        manually_verified INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_items_session ON inventory_items(session_id);
      CREATE INDEX IF NOT EXISTS idx_items_category ON inventory_items(category);
      CREATE INDEX IF NOT EXISTS idx_items_sku ON inventory_items(sku);

      -- Image metadata (actual images stored on disk)
      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        device_id TEXT,
        trigger_type TEXT,
        voice_annotation TEXT,
        latitude REAL,
        longitude REAL,
        file_size_bytes INTEGER,
        width INTEGER,
        height INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_images_captured ON images(captured_at);

      -- Visual memory index (analysis results for Perfect Memory)
      CREATE TABLE IF NOT EXISTS visual_memory (
        id TEXT PRIMARY KEY,
        image_id TEXT NOT NULL REFERENCES images(id),
        captured_at TEXT NOT NULL,
        scene_description TEXT,
        scene_type TEXT,
        extracted_text TEXT,
        object_labels TEXT,
        product_names TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        voice_annotation TEXT,
        latitude REAL,
        longitude REAL,
        processing_time_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_memory_captured ON visual_memory(captured_at);
      CREATE INDEX IF NOT EXISTS idx_memory_scene_type ON visual_memory(scene_type);

      -- Full-text search over visual memory
      -- Note: FTS5 is an external content table synced via triggers.
      -- Column names here are the FTS index columns (not the source table columns).
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        memory_id,
        scene_description,
        extracted_text,
        object_labels,
        product_names,
        voice_annotation,
        tags_text
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON visual_memory BEGIN
        INSERT INTO memory_fts(memory_id, scene_description, extracted_text, object_labels, product_names, voice_annotation, tags_text)
        VALUES (new.id, new.scene_description, new.extracted_text, new.object_labels, new.product_names, new.voice_annotation, new.tags_json);
      END;

      CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON visual_memory BEGIN
        DELETE FROM memory_fts WHERE memory_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON visual_memory BEGIN
        DELETE FROM memory_fts WHERE memory_id = old.id;
        INSERT INTO memory_fts(memory_id, scene_description, extracted_text, object_labels, product_names, voice_annotation, tags_text)
        VALUES (new.id, new.scene_description, new.extracted_text, new.object_labels, new.product_names, new.voice_annotation, new.tags_json);
      END;
    `);
  }

  // ─── Inventory Sessions ─────────────────────────────────────

  saveSession(session: InventorySession): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO inventory_sessions
      (id, name, store_id, store_name, started_at, completed_at, status, config_json, stats_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.name,
      session.storeId || null,
      session.storeName || null,
      session.startedAt,
      session.completedAt || null,
      session.status,
      JSON.stringify(session.config),
      JSON.stringify(session.stats)
    );
  }

  getSession(id: string): InventorySession | null {
    const row = this.db.prepare(
      'SELECT * FROM inventory_sessions WHERE id = ?'
    ).get(id) as SessionRow | undefined;

    return row ? this.rowToSession(row) : null;
  }

  listSessions(query: SessionQuery = {}): InventorySession[] {
    let sql = 'SELECT * FROM inventory_sessions WHERE 1=1';
    const params: unknown[] = [];

    if (query.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }
    if (query.storeName) {
      sql += ' AND store_name LIKE ?';
      params.push(`%${query.storeName}%`);
    }
    if (query.startedAfter) {
      sql += ' AND started_at >= ?';
      params.push(query.startedAfter);
    }
    if (query.startedBefore) {
      sql += ' AND started_at <= ?';
      params.push(query.startedBefore);
    }

    sql += ' ORDER BY started_at DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }
    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as SessionRow[];
    return rows.map((row) => this.rowToSession(row));
  }

  deleteSession(id: string): void {
    this.db.transaction(() => {
      // Delete items first (foreign key)
      this.db.prepare('DELETE FROM inventory_items WHERE session_id = ?').run(id);
      this.db.prepare('DELETE FROM inventory_sessions WHERE id = ?').run(id);
    })();
  }

  // ─── Inventory Items ────────────────────────────────────────

  saveItem(item: InventoryItem): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO inventory_items
      (id, session_id, sku, name, brand, category, variant, quantity,
       count_confidence, identification_method, location_json, price_on_shelf,
       flags_json, image_refs_json, first_seen_at, last_seen_at, manually_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      item.id,
      item.sessionId,
      item.sku,
      item.name,
      item.brand || null,
      item.category || null,
      item.variant || null,
      item.quantity,
      item.countConfidence,
      item.identificationMethod,
      JSON.stringify(item.location),
      item.priceOnShelf || null,
      JSON.stringify(item.flags),
      JSON.stringify(item.imageRefs),
      item.firstSeenAt,
      item.lastSeenAt,
      item.manuallyVerified ? 1 : 0
    );
  }

  saveItems(items: InventoryItem[]): void {
    const insert = this.db.transaction((itemList: InventoryItem[]) => {
      for (const item of itemList) {
        this.saveItem(item);
      }
    });
    insert(items);
  }

  getItem(id: string): InventoryItem | null {
    const row = this.db.prepare(
      'SELECT * FROM inventory_items WHERE id = ?'
    ).get(id) as ItemRow | undefined;

    return row ? this.rowToItem(row) : null;
  }

  queryItems(query: ItemQuery): InventoryItem[] {
    let sql = 'SELECT * FROM inventory_items WHERE session_id = ?';
    const params: unknown[] = [query.sessionId];

    if (query.category) {
      sql += ' AND category = ?';
      params.push(query.category);
    }
    if (query.aisle) {
      sql += " AND json_extract(location_json, '$.aisle') = ?";
      params.push(query.aisle);
    }
    if (query.minConfidence !== undefined) {
      sql += ' AND count_confidence >= ?';
      params.push(query.minConfidence);
    }
    if (query.flagged) {
      sql += " AND flags_json != '[]'";
    }
    if (query.search) {
      sql += ' AND (name LIKE ? OR brand LIKE ? OR sku LIKE ?)';
      const searchTerm = `%${query.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const sortCol = {
      name: 'name',
      quantity: 'quantity',
      category: 'category',
      confidence: 'count_confidence',
      lastSeen: 'last_seen_at',
    }[query.sortBy || 'name'];
    const sortDir = query.sortDirection === 'desc' ? 'DESC' : 'ASC';
    sql += ` ORDER BY ${sortCol} ${sortDir}`;

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }
    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as ItemRow[];
    return rows.map((row) => this.rowToItem(row));
  }

  getSessionItems(sessionId: string): InventoryItem[] {
    const rows = this.db.prepare(
      'SELECT * FROM inventory_items WHERE session_id = ? ORDER BY category, name'
    ).all(sessionId) as ItemRow[];

    return rows.map((row) => this.rowToItem(row));
  }

  getSessionStats(sessionId: string): {
    totalSKUs: number;
    totalItems: number;
    totalValue: number;
    flaggedCount: number;
    categories: string[];
  } {
    const countRow = this.db.prepare(`
      SELECT
        COUNT(*) as sku_count,
        COALESCE(SUM(quantity), 0) as item_count,
        COALESCE(SUM(CASE WHEN price_on_shelf IS NOT NULL THEN price_on_shelf * quantity ELSE 0 END), 0) as total_value,
        COUNT(CASE WHEN flags_json != '[]' THEN 1 END) as flagged_count
      FROM inventory_items WHERE session_id = ?
    `).get(sessionId) as { sku_count: number; item_count: number; total_value: number; flagged_count: number };

    const catRows = this.db.prepare(
      'SELECT DISTINCT category FROM inventory_items WHERE session_id = ? AND category IS NOT NULL'
    ).all(sessionId) as Array<{ category: string }>;

    return {
      totalSKUs: countRow.sku_count,
      totalItems: countRow.item_count,
      totalValue: countRow.total_value,
      flaggedCount: countRow.flagged_count,
      categories: catRows.map((r) => r.category),
    };
  }

  // ─── Image Storage ──────────────────────────────────────────

  /**
   * Store a captured image (saves buffer to disk, metadata to SQLite).
   */
  saveImage(image: CapturedImage): string {
    const ext = image.mimeType === 'image/png' ? '.png' : '.jpg';
    const datePath = new Date(image.capturedAt).toISOString().split('T')[0];
    const dir = path.join(this.imageDir, datePath);
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${image.id}${ext}`);
    fs.writeFileSync(filePath, image.buffer);

    this.db.prepare(`
      INSERT OR REPLACE INTO images
      (id, file_path, mime_type, captured_at, device_id, trigger_type,
       voice_annotation, latitude, longitude, file_size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      image.id,
      filePath,
      image.mimeType,
      image.capturedAt,
      image.deviceId,
      image.trigger,
      image.voiceAnnotation || null,
      image.location?.latitude || null,
      image.location?.longitude || null,
      image.buffer.length
    );

    return filePath;
  }

  /**
   * Load an image from disk by ID.
   */
  loadImage(imageId: string): Buffer | null {
    const row = this.db.prepare(
      'SELECT file_path FROM images WHERE id = ?'
    ).get(imageId) as { file_path: string } | undefined;

    if (!row) return null;

    try {
      return fs.readFileSync(row.file_path);
    } catch {
      return null;
    }
  }

  /**
   * Get image metadata (without loading the buffer).
   */
  getImageMeta(imageId: string): {
    id: string;
    filePath: string;
    mimeType: string;
    capturedAt: string;
    fileSizeBytes: number;
  } | null {
    const row = this.db.prepare('SELECT * FROM images WHERE id = ?').get(imageId) as ImageRow | undefined;
    if (!row) return null;

    return {
      id: row.id,
      filePath: row.file_path,
      mimeType: row.mime_type,
      capturedAt: row.captured_at,
      fileSizeBytes: row.file_size_bytes || 0,
    };
  }

  // ─── Visual Memory ─────────────────────────────────────────

  /**
   * Index a vision analysis result for Perfect Memory search.
   */
  saveMemory(analysis: VisionAnalysis, image: CapturedImage, tags: string[] = []): string {
    const id = uuidv4();

    this.db.prepare(`
      INSERT INTO visual_memory
      (id, image_id, captured_at, scene_description, scene_type,
       extracted_text, object_labels, product_names, tags_json,
       voice_annotation, latitude, longitude, processing_time_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      analysis.imageId,
      image.capturedAt,
      analysis.sceneDescription,
      analysis.sceneType,
      analysis.extractedText.map((t) => t.text).join(' | '),
      analysis.detectedObjects.map((o) => o.label).join(', '),
      analysis.products.map((p) => p.name).join(', '),
      JSON.stringify(tags),
      image.voiceAnnotation || null,
      image.location?.latitude || null,
      image.location?.longitude || null,
      analysis.processingTimeMs
    );

    return id;
  }

  /**
   * Search visual memory using full-text search.
   * This is the backend for "What did I see?" queries.
   */
  searchMemory(query: string, limit = 20): MemoryEntry[] {
    const rows = this.db.prepare(`
      SELECT vm.*
      FROM memory_fts fts
      JOIN visual_memory vm ON vm.id = fts.memory_id
      WHERE memory_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(query, limit) as MemoryRow[];

    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Browse visual memory by date range and filters.
   */
  queryMemory(query: MemoryQuery = {}): MemoryEntry[] {
    let sql = 'SELECT * FROM visual_memory WHERE 1=1';
    const params: unknown[] = [];

    if (query.sceneType) {
      sql += ' AND scene_type = ?';
      params.push(query.sceneType);
    }
    if (query.startDate) {
      sql += ' AND captured_at >= ?';
      params.push(query.startDate);
    }
    if (query.endDate) {
      sql += ' AND captured_at <= ?';
      params.push(query.endDate);
    }
    if (query.hasText) {
      sql += " AND extracted_text IS NOT NULL AND extracted_text != ''";
    }

    sql += ' ORDER BY captured_at DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }
    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Delete visual memories older than the specified number of days.
   */
  cleanupOldMemories(days: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();

    // Get image IDs to delete from disk
    const imageRows = this.db.prepare(`
      SELECT i.file_path FROM visual_memory vm
      JOIN images i ON i.id = vm.image_id
      WHERE vm.captured_at < ?
    `).all(cutoffStr) as Array<{ file_path: string }>;

    // Delete from DB
    const result = this.db.prepare(
      'DELETE FROM visual_memory WHERE captured_at < ?'
    ).run(cutoffStr);

    // Delete image files
    for (const row of imageRows) {
      try {
        fs.unlinkSync(row.file_path);
      } catch {
        // File already gone, that's fine
      }
    }

    return result.changes;
  }

  // ─── Database Utilities ─────────────────────────────────────

  /**
   * Get database statistics.
   */
  getDbStats(): {
    sessions: number;
    items: number;
    images: number;
    memories: number;
    dbSizeBytes: number;
  } {
    const stats = {
      sessions: (this.db.prepare('SELECT COUNT(*) as c FROM inventory_sessions').get() as { c: number }).c,
      items: (this.db.prepare('SELECT COUNT(*) as c FROM inventory_items').get() as { c: number }).c,
      images: (this.db.prepare('SELECT COUNT(*) as c FROM images').get() as { c: number }).c,
      memories: (this.db.prepare('SELECT COUNT(*) as c FROM visual_memory').get() as { c: number }).c,
      dbSizeBytes: 0,
    };

    try {
      const stat = fs.statSync(this.config.dbPath);
      stats.dbSizeBytes = stat.size;
    } catch { /* file might not exist yet */ }

    return stats;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  /**
   * Run a raw SQL query (for dashboard/admin use).
   */
  rawQuery<T = unknown>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  // ─── Row Mappers ────────────────────────────────────────────

  private rowToSession(row: SessionRow): InventorySession {
    return {
      id: row.id,
      name: row.name,
      storeId: row.store_id || undefined,
      storeName: row.store_name || undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      status: row.status as InventorySessionStatus,
      config: row.config_json ? JSON.parse(row.config_json) : DEFAULT_INVENTORY_CONFIG,
      stats: row.stats_json ? JSON.parse(row.stats_json) : {} as InventoryStats,
    };
  }

  private rowToItem(row: ItemRow): InventoryItem {
    return {
      id: row.id,
      sessionId: row.session_id,
      sku: row.sku,
      name: row.name,
      brand: row.brand || undefined,
      category: row.category || undefined,
      variant: row.variant || undefined,
      quantity: row.quantity,
      countConfidence: row.count_confidence,
      identificationMethod: row.identification_method as InventoryItem['identificationMethod'],
      location: JSON.parse(row.location_json) as StoreLocation,
      priceOnShelf: row.price_on_shelf || undefined,
      flags: JSON.parse(row.flags_json) as InventoryFlag[],
      imageRefs: JSON.parse(row.image_refs_json) as string[],
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      manuallyVerified: Boolean(row.manually_verified),
    };
  }

  private rowToMemory(row: MemoryRow): MemoryEntry {
    return {
      id: row.id,
      imageId: row.image_id,
      capturedAt: row.captured_at,
      sceneDescription: row.scene_description || '',
      sceneType: row.scene_type || 'unknown',
      extractedText: row.extracted_text || '',
      objectLabels: row.object_labels || '',
      productNames: row.product_names || '',
      tags: row.tags_json ? JSON.parse(row.tags_json) : [],
      voiceAnnotation: row.voice_annotation || undefined,
      latitude: row.latitude || undefined,
      longitude: row.longitude || undefined,
    };
  }
}

// ─── Row Types (SQLite raw results) ─────────────────────────────

interface SessionRow {
  id: string;
  name: string;
  store_id: string | null;
  store_name: string | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  config_json: string;
  stats_json: string;
}

interface ItemRow {
  id: string;
  session_id: string;
  sku: string;
  name: string;
  brand: string | null;
  category: string | null;
  variant: string | null;
  quantity: number;
  count_confidence: number;
  identification_method: string;
  location_json: string;
  price_on_shelf: number | null;
  flags_json: string;
  image_refs_json: string;
  first_seen_at: string;
  last_seen_at: string;
  manually_verified: number;
}

interface ImageRow {
  id: string;
  file_path: string;
  mime_type: string;
  captured_at: string;
  device_id: string | null;
  trigger_type: string | null;
  voice_annotation: string | null;
  latitude: number | null;
  longitude: number | null;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
}

interface MemoryRow {
  id: string;
  image_id: string;
  captured_at: string;
  scene_description: string | null;
  scene_type: string | null;
  extracted_text: string | null;
  object_labels: string | null;
  product_names: string | null;
  tags_json: string | null;
  voice_annotation: string | null;
  latitude: number | null;
  longitude: number | null;
  processing_time_ms: number | null;
}
