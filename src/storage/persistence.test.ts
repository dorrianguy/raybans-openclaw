/**
 * Tests for PersistenceLayer — SQLite storage for inventory + visual memory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersistenceLayer, type PersistenceConfig } from './persistence.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  InventorySession,
  InventoryItem,
  InventoryConfig,
  VisionAnalysis,
  CapturedImage,
} from '../types.js';
import { DEFAULT_INVENTORY_CONFIG } from '../types.js';

// ─── Fixtures ───────────────────────────────────────────────────

let persistence: PersistenceLayer;
let tempDir: string;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'raybans-test-'));
}

beforeEach(() => {
  tempDir = makeTempDir();
  persistence = new PersistenceLayer({
    dbPath: path.join(tempDir, 'test.db'),
    imageDir: path.join(tempDir, 'images'),
  });
});

afterEach(() => {
  persistence.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeSession(overrides: Partial<InventorySession> = {}): InventorySession {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'Test Inventory',
    storeName: "Mike's Hardware",
    startedAt: new Date().toISOString(),
    status: 'active',
    config: DEFAULT_INVENTORY_CONFIG,
    stats: {
      totalItems: 0,
      totalSKUs: 0,
      imagesProcessed: 0,
      imagesCaptured: 0,
      flaggedItems: 0,
      estimatedAccuracy: 0,
      aislesCovered: [],
      startTime: new Date().toISOString(),
      lastUpdateTime: new Date().toISOString(),
      itemsPerMinute: 0,
    },
    ...overrides,
  };
}

function makeItem(sessionId: string, overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionId,
    sku: '012345678901',
    name: 'Test Product',
    category: 'Hardware',
    quantity: 10,
    countConfidence: 0.9,
    identificationMethod: 'barcode',
    location: { aisle: '3', shelf: 'B' },
    flags: [],
    imageRefs: ['img-1'],
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    manuallyVerified: false,
    ...overrides,
  };
}

function makeImage(overrides: Partial<CapturedImage> = {}): CapturedImage {
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    buffer: Buffer.from('fake-image-data-for-test'),
    mimeType: 'image/jpeg',
    capturedAt: new Date().toISOString(),
    deviceId: 'test-device',
    trigger: 'auto',
    ...overrides,
  };
}

function makeAnalysis(imageId: string, overrides: Partial<VisionAnalysis> = {}): VisionAnalysis {
  return {
    imageId,
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 1500,
    sceneDescription: 'A retail shelf with various hardware products',
    sceneType: 'retail_shelf',
    extractedText: [
      { text: 'DeWalt 20V Max', confidence: 0.95, textType: 'label' },
      { text: '$149.99', confidence: 0.9, textType: 'price' },
    ],
    detectedObjects: [
      { label: 'power drill', confidence: 0.92 },
      { label: 'shelf', confidence: 0.98 },
    ],
    products: [
      {
        name: 'DeWalt 20V Max Drill Kit',
        brand: 'DeWalt',
        category: 'Power Tools',
        confidence: 0.93,
        identificationMethod: 'visual',
        estimatedCount: 5,
        countConfidence: 0.85,
        priceOnShelf: 149.99,
      },
    ],
    barcodes: [],
    quality: {
      score: 0.9,
      isBlurry: false,
      hasGlare: false,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: true,
    },
    ...overrides,
  };
}

// ─── Session Tests ──────────────────────────────────────────────

describe('Persistence - Sessions', () => {
  it('should save and retrieve a session', () => {
    const session = makeSession();
    persistence.saveSession(session);

    const retrieved = persistence.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(session.id);
    expect(retrieved!.name).toBe('Test Inventory');
    expect(retrieved!.storeName).toBe("Mike's Hardware");
    expect(retrieved!.status).toBe('active');
  });

  it('should update an existing session', () => {
    const session = makeSession();
    persistence.saveSession(session);

    session.status = 'completed';
    session.completedAt = new Date().toISOString();
    persistence.saveSession(session);

    const retrieved = persistence.getSession(session.id);
    expect(retrieved!.status).toBe('completed');
    expect(retrieved!.completedAt).toBeDefined();
  });

  it('should list sessions ordered by date', () => {
    const s1 = makeSession({ name: 'First', startedAt: '2026-01-01T00:00:00Z' });
    const s2 = makeSession({ name: 'Second', startedAt: '2026-01-15T00:00:00Z' });
    const s3 = makeSession({ name: 'Third', startedAt: '2026-02-01T00:00:00Z' });

    persistence.saveSession(s1);
    persistence.saveSession(s2);
    persistence.saveSession(s3);

    const sessions = persistence.listSessions();
    expect(sessions.length).toBe(3);
    expect(sessions[0].name).toBe('Third'); // Most recent first
  });

  it('should filter sessions by status', () => {
    const active = makeSession({ status: 'active' });
    const completed = makeSession({ status: 'completed' });

    persistence.saveSession(active);
    persistence.saveSession(completed);

    const activeSessions = persistence.listSessions({ status: 'active' });
    expect(activeSessions.length).toBe(1);
    expect(activeSessions[0].status).toBe('active');
  });

  it('should filter sessions by store name', () => {
    const s1 = makeSession({ storeName: "Mike's Hardware" });
    const s2 = makeSession({ storeName: "Bob's Grocery" });

    persistence.saveSession(s1);
    persistence.saveSession(s2);

    const results = persistence.listSessions({ storeName: 'Mike' });
    expect(results.length).toBe(1);
    expect(results[0].storeName).toBe("Mike's Hardware");
  });

  it('should delete a session and its items', () => {
    const session = makeSession();
    persistence.saveSession(session);

    const item = makeItem(session.id);
    persistence.saveItem(item);

    persistence.deleteSession(session.id);

    expect(persistence.getSession(session.id)).toBeNull();
    expect(persistence.getSessionItems(session.id).length).toBe(0);
  });

  it('should return null for non-existent session', () => {
    expect(persistence.getSession('does-not-exist')).toBeNull();
  });

  it('should limit results', () => {
    for (let i = 0; i < 10; i++) {
      persistence.saveSession(makeSession());
    }
    const results = persistence.listSessions({ limit: 3 });
    expect(results.length).toBe(3);
  });
});

// ─── Item Tests ─────────────────────────────────────────────────

describe('Persistence - Items', () => {
  let session: InventorySession;

  beforeEach(() => {
    session = makeSession();
    persistence.saveSession(session);
  });

  it('should save and retrieve an item', () => {
    const item = makeItem(session.id);
    persistence.saveItem(item);

    const retrieved = persistence.getItem(item.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('Test Product');
    expect(retrieved!.quantity).toBe(10);
    expect(retrieved!.location.aisle).toBe('3');
  });

  it('should save items in batch', () => {
    const items = [
      makeItem(session.id, { name: 'Product A' }),
      makeItem(session.id, { name: 'Product B' }),
      makeItem(session.id, { name: 'Product C' }),
    ];

    persistence.saveItems(items);

    const all = persistence.getSessionItems(session.id);
    expect(all.length).toBe(3);
  });

  it('should query items by category', () => {
    persistence.saveItems([
      makeItem(session.id, { name: 'Drill', category: 'Power Tools' }),
      makeItem(session.id, { name: 'Hammer', category: 'Hand Tools' }),
      makeItem(session.id, { name: 'Saw', category: 'Power Tools' }),
    ]);

    const results = persistence.queryItems({
      sessionId: session.id,
      category: 'Power Tools',
    });

    expect(results.length).toBe(2);
  });

  it('should query items by aisle', () => {
    persistence.saveItems([
      makeItem(session.id, { name: 'Item A', location: { aisle: '1' } }),
      makeItem(session.id, { name: 'Item B', location: { aisle: '2' } }),
      makeItem(session.id, { name: 'Item C', location: { aisle: '1' } }),
    ]);

    const results = persistence.queryItems({
      sessionId: session.id,
      aisle: '1',
    });

    expect(results.length).toBe(2);
  });

  it('should filter flagged items', () => {
    persistence.saveItems([
      makeItem(session.id, { name: 'Good', flags: [] }),
      makeItem(session.id, { name: 'Low Stock', flags: ['low_stock'] }),
      makeItem(session.id, { name: 'Damaged', flags: ['damaged'] }),
    ]);

    const results = persistence.queryItems({
      sessionId: session.id,
      flagged: true,
    });

    expect(results.length).toBe(2);
  });

  it('should search items by name', () => {
    persistence.saveItems([
      makeItem(session.id, { name: 'DeWalt 20V Drill', brand: 'DeWalt' }),
      makeItem(session.id, { name: 'Milwaukee Impact Driver', brand: 'Milwaukee' }),
      makeItem(session.id, { name: 'DeWalt Circular Saw', brand: 'DeWalt' }),
    ]);

    const results = persistence.queryItems({
      sessionId: session.id,
      search: 'DeWalt',
    });

    expect(results.length).toBe(2);
  });

  it('should sort items by quantity', () => {
    persistence.saveItems([
      makeItem(session.id, { name: 'A', quantity: 5 }),
      makeItem(session.id, { name: 'B', quantity: 20 }),
      makeItem(session.id, { name: 'C', quantity: 1 }),
    ]);

    const results = persistence.queryItems({
      sessionId: session.id,
      sortBy: 'quantity',
      sortDirection: 'desc',
    });

    expect(results[0].quantity).toBe(20);
    expect(results[2].quantity).toBe(1);
  });

  it('should get session statistics', () => {
    persistence.saveItems([
      makeItem(session.id, { quantity: 10, priceOnShelf: 5.99, flags: [] }),
      makeItem(session.id, { quantity: 3, priceOnShelf: 149.99, flags: ['low_stock'] }),
      makeItem(session.id, { quantity: 0, flags: ['empty_spot'] }),
    ]);

    const stats = persistence.getSessionStats(session.id);
    expect(stats.totalSKUs).toBe(3);
    expect(stats.totalItems).toBe(13);
    expect(stats.totalValue).toBeCloseTo(10 * 5.99 + 3 * 149.99, 1);
    expect(stats.flaggedCount).toBe(2);
  });

  it('should handle items with null optional fields', () => {
    const item = makeItem(session.id, {
      brand: undefined,
      category: undefined,
      variant: undefined,
      priceOnShelf: undefined,
    });

    persistence.saveItem(item);
    const retrieved = persistence.getItem(item.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.brand).toBeUndefined();
    expect(retrieved!.category).toBeUndefined();
  });

  it('should paginate results', () => {
    for (let i = 0; i < 20; i++) {
      persistence.saveItem(makeItem(session.id, { name: `Product ${i}` }));
    }

    const page1 = persistence.queryItems({ sessionId: session.id, limit: 5, offset: 0 });
    const page2 = persistence.queryItems({ sessionId: session.id, limit: 5, offset: 5 });

    expect(page1.length).toBe(5);
    expect(page2.length).toBe(5);
    expect(page1[0].id).not.toBe(page2[0].id);
  });
});

// ─── Image Storage Tests ────────────────────────────────────────

describe('Persistence - Images', () => {
  it('should save image to disk and metadata to DB', () => {
    const image = makeImage();
    const filePath = persistence.saveImage(image);

    expect(fs.existsSync(filePath)).toBe(true);

    const meta = persistence.getImageMeta(image.id);
    expect(meta).not.toBeNull();
    expect(meta!.mimeType).toBe('image/jpeg');
    expect(meta!.fileSizeBytes).toBeGreaterThan(0);
  });

  it('should load image buffer from disk', () => {
    const image = makeImage({ buffer: Buffer.from('test-image-content') });
    persistence.saveImage(image);

    const loaded = persistence.loadImage(image.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.toString()).toBe('test-image-content');
  });

  it('should return null for non-existent image', () => {
    expect(persistence.loadImage('does-not-exist')).toBeNull();
  });

  it('should organize images by date directory', () => {
    const image = makeImage({ capturedAt: '2026-02-20T15:00:00Z' });
    const filePath = persistence.saveImage(image);

    expect(filePath).toContain('2026-02-20');
  });

  it('should save PNG images with correct extension', () => {
    const image = makeImage({ mimeType: 'image/png' });
    const filePath = persistence.saveImage(image);

    expect(filePath).toMatch(/\.png$/);
  });
});

// ─── Visual Memory Tests ────────────────────────────────────────

describe('Persistence - Visual Memory', () => {
  it('should index a vision analysis', () => {
    const image = makeImage();
    persistence.saveImage(image);

    const analysis = makeAnalysis(image.id);
    const memoryId = persistence.saveMemory(analysis, image, ['inventory', 'hardware']);

    expect(memoryId).toBeDefined();
    expect(typeof memoryId).toBe('string');
  });

  it('should search memory with full-text search', () => {
    const image = makeImage();
    persistence.saveImage(image);

    const analysis = makeAnalysis(image.id, {
      sceneDescription: 'A whiteboard covered with architectural diagrams',
      extractedText: [
        { text: 'API Gateway Design v3', confidence: 0.95, textType: 'document' },
      ],
    });
    persistence.saveMemory(analysis, image, ['meeting', 'whiteboard']);

    const results = persistence.searchMemory('whiteboard');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sceneDescription).toContain('whiteboard');
  });

  it('should search extracted text', () => {
    const image = makeImage();
    persistence.saveImage(image);

    const analysis = makeAnalysis(image.id, {
      extractedText: [
        { text: 'WiFi Password: CoffeeShop2026!', confidence: 0.95, textType: 'sign' },
      ],
    });
    persistence.saveMemory(analysis, image);

    const results = persistence.searchMemory('WiFi Password');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should browse memory by scene type', () => {
    const img1 = makeImage();
    const img2 = makeImage();
    persistence.saveImage(img1);
    persistence.saveImage(img2);

    persistence.saveMemory(
      makeAnalysis(img1.id, { sceneType: 'retail_shelf' }),
      img1
    );
    persistence.saveMemory(
      makeAnalysis(img2.id, { sceneType: 'whiteboard' }),
      img2
    );

    const results = persistence.queryMemory({ sceneType: 'retail_shelf' });
    expect(results.length).toBe(1);
    expect(results[0].sceneType).toBe('retail_shelf');
  });

  it('should browse memory by date range', () => {
    const yesterday = makeImage({ capturedAt: '2026-02-19T12:00:00Z' });
    const today = makeImage({ capturedAt: '2026-02-20T12:00:00Z' });
    persistence.saveImage(yesterday);
    persistence.saveImage(today);

    persistence.saveMemory(makeAnalysis(yesterday.id), yesterday);
    persistence.saveMemory(makeAnalysis(today.id), today);

    const results = persistence.queryMemory({
      startDate: '2026-02-20T00:00:00Z',
      endDate: '2026-02-21T00:00:00Z',
    });

    expect(results.length).toBe(1);
  });

  it('should filter memory with text content', () => {
    const withText = makeImage();
    const noText = makeImage();
    persistence.saveImage(withText);
    persistence.saveImage(noText);

    persistence.saveMemory(
      makeAnalysis(withText.id, {
        extractedText: [{ text: 'Some text content', confidence: 0.9, textType: 'document' }],
      }),
      withText
    );
    persistence.saveMemory(
      makeAnalysis(noText.id, { extractedText: [] }),
      noText
    );

    const results = persistence.queryMemory({ hasText: true });
    expect(results.length).toBe(1);
  });

  it('should include voice annotation in memory', () => {
    const image = makeImage({ voiceAnnotation: 'Important meeting notes' });
    persistence.saveImage(image);

    persistence.saveMemory(makeAnalysis(image.id), image);

    const results = persistence.searchMemory('Important meeting');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].voiceAnnotation).toBe('Important meeting notes');
  });

  it('should limit memory results', () => {
    for (let i = 0; i < 10; i++) {
      const img = makeImage();
      persistence.saveImage(img);
      persistence.saveMemory(makeAnalysis(img.id), img);
    }

    const results = persistence.queryMemory({ limit: 3 });
    expect(results.length).toBe(3);
  });
});

// ─── Database Stats ─────────────────────────────────────────────

describe('Persistence - Stats', () => {
  it('should return correct database statistics', () => {
    // Add some data
    const session = makeSession();
    persistence.saveSession(session);
    persistence.saveItem(makeItem(session.id));
    persistence.saveItem(makeItem(session.id));

    const image = makeImage();
    persistence.saveImage(image);
    persistence.saveMemory(makeAnalysis(image.id), image);

    const stats = persistence.getDbStats();
    expect(stats.sessions).toBe(1);
    expect(stats.items).toBe(2);
    expect(stats.images).toBe(1);
    expect(stats.memories).toBe(1);
    expect(stats.dbSizeBytes).toBeGreaterThan(0);
  });

  it('should return zero counts for empty database', () => {
    const stats = persistence.getDbStats();
    expect(stats.sessions).toBe(0);
    expect(stats.items).toBe(0);
    expect(stats.images).toBe(0);
    expect(stats.memories).toBe(0);
  });
});

// ─── Cleanup ────────────────────────────────────────────────────

describe('Persistence - Cleanup', () => {
  it('should clean up old memories', () => {
    // Create a memory with old date
    const oldImage = makeImage({ capturedAt: '2025-01-01T00:00:00Z' });
    persistence.saveImage(oldImage);
    persistence.saveMemory(makeAnalysis(oldImage.id), oldImage);

    // Create a recent memory
    const newImage = makeImage();
    persistence.saveImage(newImage);
    persistence.saveMemory(makeAnalysis(newImage.id), newImage);

    // Clean up anything older than 30 days
    const deleted = persistence.cleanupOldMemories(30);
    expect(deleted).toBe(1);

    // Recent memory should still be there
    const remaining = persistence.queryMemory();
    expect(remaining.length).toBe(1);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────

describe('Persistence - Edge Cases', () => {
  it('should handle items with special characters in name', () => {
    const session = makeSession();
    persistence.saveSession(session);

    const item = makeItem(session.id, {
      name: 'Tom\'s "Premium" Nuts & Bolts — 3/8" × 1½"',
    });
    persistence.saveItem(item);

    const retrieved = persistence.getItem(item.id);
    expect(retrieved!.name).toBe('Tom\'s "Premium" Nuts & Bolts — 3/8" × 1½"');
  });

  it('should handle empty flags array', () => {
    const session = makeSession();
    persistence.saveSession(session);

    const item = makeItem(session.id, { flags: [] });
    persistence.saveItem(item);

    const retrieved = persistence.getItem(item.id);
    expect(retrieved!.flags).toEqual([]);
  });

  it('should handle multiple flags', () => {
    const session = makeSession();
    persistence.saveSession(session);

    const item = makeItem(session.id, {
      flags: ['low_stock', 'low_confidence', 'needs_recount'],
    });
    persistence.saveItem(item);

    const retrieved = persistence.getItem(item.id);
    expect(retrieved!.flags).toEqual(['low_stock', 'low_confidence', 'needs_recount']);
  });

  it('should handle concurrent saves', () => {
    const session = makeSession();
    persistence.saveSession(session);

    // Save many items at once
    const items = Array.from({ length: 100 }, (_, i) =>
      makeItem(session.id, { name: `Product ${i}`, quantity: i })
    );

    persistence.saveItems(items);

    const all = persistence.getSessionItems(session.id);
    expect(all.length).toBe(100);
  });
});
