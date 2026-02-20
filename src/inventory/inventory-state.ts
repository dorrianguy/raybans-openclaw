/**
 * Inventory State Manager — Tracks running inventory across image captures.
 *
 * Responsibilities:
 * - Maintains the running inventory table for an active session
 * - Deduplicates products across multiple shelf images
 * - Merges counts when the same product appears in multiple snaps
 * - Tracks confidence and flags issues
 * - Manages session lifecycle (start, pause, resume, complete)
 *
 * This is a pure in-memory state manager. Persistence is handled separately.
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import type {
  InventorySession,
  InventorySessionStatus,
  InventoryItem,
  InventoryConfig,
  InventoryStats,
  InventoryFlag,
  DetectedProduct,
  StoreLocation,
  VisionAnalysis,
  PlatformEvent,
} from '../types.js';
import { DEFAULT_INVENTORY_CONFIG } from '../types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface AddProductInput {
  product: DetectedProduct;
  imageId: string;
  location?: StoreLocation;
  analysis?: VisionAnalysis;
}

export interface ManualCountInput {
  /** Product name or SKU to update */
  productIdentifier: string;
  /** New count value */
  count: number;
  /** Optional location update */
  location?: StoreLocation;
}

// ─── State Manager ──────────────────────────────────────────────

export class InventoryStateManager extends EventEmitter<{
  'item:added': (item: InventoryItem) => void;
  'item:updated': (item: InventoryItem) => void;
  'item:flagged': (item: InventoryItem, flag: InventoryFlag) => void;
  'session:changed': (session: InventorySession) => void;
  'stats:updated': (stats: InventoryStats) => void;
}> {
  private session: InventorySession;
  private items: Map<string, InventoryItem> = new Map();
  /** Maps UPC → item ID for dedup */
  private upcIndex: Map<string, string> = new Map();
  /** Maps lowercase product name → item ID for fuzzy dedup */
  private nameIndex: Map<string, string> = new Map();
  /** Current aisle/location being walked */
  private currentLocation: StoreLocation = {};

  constructor(
    name: string,
    config: Partial<InventoryConfig> = {},
    storeName?: string
  ) {
    super();

    const now = new Date().toISOString();
    this.session = {
      id: uuidv4(),
      name,
      storeName,
      startedAt: now,
      status: 'active',
      config: { ...DEFAULT_INVENTORY_CONFIG, ...config },
      stats: {
        totalItems: 0,
        totalSKUs: 0,
        imagesProcessed: 0,
        imagesCaptured: 0,
        flaggedItems: 0,
        estimatedAccuracy: 0,
        aislesCovered: [],
        startTime: now,
        lastUpdateTime: now,
        itemsPerMinute: 0,
      },
    };
  }

  // ─── Session Lifecycle ──────────────────────────────────────

  getSession(): InventorySession {
    return { ...this.session };
  }

  getSessionId(): string {
    return this.session.id;
  }

  getStatus(): InventorySessionStatus {
    return this.session.status;
  }

  pause(): void {
    if (this.session.status !== 'active') return;
    this.session.status = 'paused';
    this.emit('session:changed', this.getSession());
  }

  resume(): void {
    if (this.session.status !== 'paused') return;
    this.session.status = 'active';
    this.emit('session:changed', this.getSession());
  }

  complete(): InventorySession {
    this.session.status = 'completed';
    this.session.completedAt = new Date().toISOString();
    this.updateStats();
    this.emit('session:changed', this.getSession());
    return this.getSession();
  }

  cancel(): void {
    this.session.status = 'cancelled';
    this.session.completedAt = new Date().toISOString();
    this.emit('session:changed', this.getSession());
  }

  isActive(): boolean {
    return this.session.status === 'active';
  }

  // ─── Location Tracking ─────────────────────────────────────

  setCurrentLocation(location: StoreLocation): void {
    this.currentLocation = { ...location };
    if (location.aisle && !this.session.stats.aislesCovered.includes(location.aisle)) {
      this.session.stats.aislesCovered.push(location.aisle);
    }
  }

  getCurrentLocation(): StoreLocation {
    return { ...this.currentLocation };
  }

  setAisle(aisle: string): void {
    this.setCurrentLocation({ ...this.currentLocation, aisle });
  }

  setSection(section: string): void {
    this.setCurrentLocation({ ...this.currentLocation, section });
  }

  // ─── Product Management ─────────────────────────────────────

  /**
   * Process products detected in a vision analysis.
   * Deduplicates against existing inventory and updates counts.
   */
  processAnalysis(analysis: VisionAnalysis): InventoryItem[] {
    if (!this.isActive()) return [];

    this.session.stats.imagesProcessed++;
    this.session.stats.imagesCaptured++;

    const updatedItems: InventoryItem[] = [];

    for (const product of analysis.products) {
      if (product.confidence < this.session.config.minProductConfidence) {
        continue; // Skip low-confidence identifications
      }

      const item = this.addOrUpdateProduct({
        product,
        imageId: analysis.imageId,
        location: { ...this.currentLocation },
        analysis,
      });

      if (item) {
        updatedItems.push(item);
      }
    }

    // Process barcodes that weren't matched to products
    for (const barcode of analysis.barcodes) {
      if (!this.upcIndex.has(barcode.data)) {
        // Barcode found but no product match — create placeholder
        const placeholder: DetectedProduct = {
          name: `Unknown (${barcode.data})`,
          confidence: barcode.confidence,
          identificationMethod: 'barcode',
          upc: barcode.data,
          estimatedCount: 1,
          countConfidence: 0.5,
        };
        const item = this.addOrUpdateProduct({
          product: placeholder,
          imageId: analysis.imageId,
          location: { ...this.currentLocation },
        });
        if (item) updatedItems.push(item);
      }
    }

    this.updateStats();
    this.emit('stats:updated', this.getStats());

    return updatedItems;
  }

  /**
   * Add a new product or update an existing one.
   * Returns the item if it was created or updated, null if skipped.
   */
  addOrUpdateProduct(input: AddProductInput): InventoryItem | null {
    const { product, imageId, location } = input;
    const existingId = this.findExistingItem(product);

    if (existingId) {
      return this.updateExistingItem(existingId, product, imageId);
    } else {
      return this.createNewItem(product, imageId, location);
    }
  }

  /**
   * Manual count override — user says "That's 24 cases of X".
   */
  manualCount(input: ManualCountInput): InventoryItem | null {
    const { productIdentifier, count, location } = input;

    // Try to find by name or SKU
    const itemId =
      this.upcIndex.get(productIdentifier) ||
      this.nameIndex.get(productIdentifier.toLowerCase()) ||
      this.findByFuzzyName(productIdentifier);

    if (itemId) {
      const item = this.items.get(itemId);
      if (!item) return null;

      item.quantity = count;
      item.countConfidence = 1.0; // Manual = 100% confidence
      item.manuallyVerified = true;
      item.lastSeenAt = new Date().toISOString();
      if (location) item.location = { ...item.location, ...location };

      // Remove low_confidence flag if present
      item.flags = item.flags.filter((f) => f !== 'low_confidence' && f !== 'needs_recount');

      this.items.set(itemId, item);
      this.updateStats();
      this.emit('item:updated', { ...item });
      return { ...item };
    }

    // Product not found — create new with manual override
    const newItem: InventoryItem = {
      id: uuidv4(),
      sessionId: this.session.id,
      sku: productIdentifier,
      name: productIdentifier,
      quantity: count,
      countConfidence: 1.0,
      identificationMethod: 'voice_override',
      location: location || { ...this.currentLocation },
      flags: [],
      imageRefs: [],
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      manuallyVerified: true,
    };

    this.items.set(newItem.id, newItem);
    this.nameIndex.set(productIdentifier.toLowerCase(), newItem.id);
    this.updateStats();
    this.emit('item:added', { ...newItem });
    return { ...newItem };
  }

  // ─── Queries ────────────────────────────────────────────────

  getItem(id: string): InventoryItem | undefined {
    const item = this.items.get(id);
    return item ? { ...item } : undefined;
  }

  getItemBySku(sku: string): InventoryItem | undefined {
    const id = this.upcIndex.get(sku);
    return id ? this.getItem(id) : undefined;
  }

  getAllItems(): InventoryItem[] {
    return Array.from(this.items.values()).map((item) => ({ ...item }));
  }

  getItemsByCategory(category: string): InventoryItem[] {
    return this.getAllItems().filter(
      (item) => item.category?.toLowerCase() === category.toLowerCase()
    );
  }

  getItemsByAisle(aisle: string): InventoryItem[] {
    return this.getAllItems().filter(
      (item) => item.location.aisle === aisle
    );
  }

  getFlaggedItems(): InventoryItem[] {
    return this.getAllItems().filter((item) => item.flags.length > 0);
  }

  getLowConfidenceItems(threshold = 0.7): InventoryItem[] {
    return this.getAllItems().filter(
      (item) => item.countConfidence < threshold && !item.manuallyVerified
    );
  }

  getStats(): InventoryStats {
    return { ...this.session.stats };
  }

  getItemCount(): number {
    return this.items.size;
  }

  getTotalQuantity(): number {
    let total = 0;
    for (const item of this.items.values()) {
      total += item.quantity;
    }
    return total;
  }

  getTotalValue(): number {
    let total = 0;
    for (const item of this.items.values()) {
      if (item.priceOnShelf) {
        total += item.priceOnShelf * item.quantity;
      }
    }
    return total;
  }

  // ─── Private ────────────────────────────────────────────────

  /**
   * Find an existing item that matches this product.
   * Uses UPC first (exact match), then name fuzzy match.
   */
  private findExistingItem(product: DetectedProduct): string | undefined {
    // Exact UPC match
    if (product.upc && this.upcIndex.has(product.upc)) {
      return this.upcIndex.get(product.upc);
    }

    // Exact name match (case-insensitive)
    const normalizedName = product.name.toLowerCase().trim();
    if (this.nameIndex.has(normalizedName)) {
      return this.nameIndex.get(normalizedName);
    }

    // Fuzzy name match
    return this.findByFuzzyName(product.name);
  }

  /**
   * Simple fuzzy name matching.
   * Returns item ID if a close match is found.
   */
  private findByFuzzyName(name: string): string | undefined {
    const normalized = name.toLowerCase().trim();

    for (const [existingName, itemId] of this.nameIndex) {
      // Check if one contains the other (handles partial brand names)
      if (
        existingName.includes(normalized) ||
        normalized.includes(existingName)
      ) {
        // Only match if overlap is significant (>60% of shorter string)
        const shorter = Math.min(existingName.length, normalized.length);
        const longer = Math.max(existingName.length, normalized.length);
        if (shorter / longer > 0.6) {
          return itemId;
        }
      }

      // Levenshtein distance check for typos
      if (this.levenshteinDistance(existingName, normalized) <= 3) {
        return itemId;
      }
    }

    return undefined;
  }

  private createNewItem(
    product: DetectedProduct,
    imageId: string,
    location?: StoreLocation
  ): InventoryItem {
    const now = new Date().toISOString();
    const item: InventoryItem = {
      id: uuidv4(),
      sessionId: this.session.id,
      sku: product.upc || `VIS-${uuidv4().slice(0, 8)}`,
      name: product.name,
      brand: product.brand,
      category: product.category,
      variant: product.variant,
      quantity: product.estimatedCount,
      countConfidence: product.countConfidence,
      identificationMethod: product.identificationMethod,
      location: location || { ...this.currentLocation },
      priceOnShelf: product.priceOnShelf,
      flags: this.detectFlags(product),
      imageRefs: [imageId],
      firstSeenAt: now,
      lastSeenAt: now,
      manuallyVerified: false,
    };

    this.items.set(item.id, item);

    // Index for deduplication
    if (product.upc) {
      this.upcIndex.set(product.upc, item.id);
    }
    this.nameIndex.set(product.name.toLowerCase().trim(), item.id);

    this.emit('item:added', { ...item });

    // Emit flags
    for (const flag of item.flags) {
      this.emit('item:flagged', { ...item }, flag);
    }

    return { ...item };
  }

  private updateExistingItem(
    itemId: string,
    product: DetectedProduct,
    imageId: string
  ): InventoryItem | null {
    const item = this.items.get(itemId);
    if (!item) return null;

    // Don't double-count from the same image
    if (item.imageRefs.includes(imageId)) {
      return null;
    }

    // Update count — take the higher confidence count
    if (product.countConfidence > item.countConfidence) {
      item.quantity = product.estimatedCount;
      item.countConfidence = product.countConfidence;
    } else if (product.countConfidence === item.countConfidence) {
      // Same confidence — average the counts
      item.quantity = Math.round((item.quantity + product.estimatedCount) / 2);
    }
    // If new count is lower confidence, keep existing

    // Update product info if we got better data
    if (product.upc && !item.sku.startsWith('VIS-')) {
      // Already have a real SKU, but maybe UPC index needs updating
    } else if (product.upc) {
      item.sku = product.upc;
      this.upcIndex.set(product.upc, itemId);
    }

    if (product.brand && !item.brand) item.brand = product.brand;
    if (product.category && !item.category) item.category = product.category;
    if (product.variant && !item.variant) item.variant = product.variant;
    if (product.priceOnShelf && !item.priceOnShelf) {
      item.priceOnShelf = product.priceOnShelf;
    }

    // Track this image
    item.imageRefs.push(imageId);
    item.lastSeenAt = new Date().toISOString();

    // Check for new flags
    const newFlags = this.detectFlags(product);
    for (const flag of newFlags) {
      if (!item.flags.includes(flag)) {
        item.flags.push(flag);
        this.emit('item:flagged', { ...item }, flag);
      }
    }

    this.items.set(itemId, item);
    this.emit('item:updated', { ...item });
    return { ...item };
  }

  private detectFlags(product: DetectedProduct): InventoryFlag[] {
    const flags: InventoryFlag[] = [];

    if (product.estimatedCount === 0) {
      flags.push('empty_spot');
    } else if (product.estimatedCount <= 2) {
      flags.push('low_stock');
    }

    if (product.countConfidence < this.session.config.minCountConfidence) {
      flags.push('low_confidence');
    }

    if (product.confidence < 0.5) {
      flags.push('needs_recount');
    }

    return flags;
  }

  private updateStats(): void {
    const items = Array.from(this.items.values());
    const now = new Date();
    const startTime = new Date(this.session.stats.startTime);
    const elapsedMinutes = (now.getTime() - startTime.getTime()) / 60000;

    this.session.stats.totalSKUs = items.length;
    this.session.stats.totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    this.session.stats.flaggedItems = items.filter((item) => item.flags.length > 0).length;
    this.session.stats.lastUpdateTime = now.toISOString();
    this.session.stats.itemsPerMinute = elapsedMinutes > 0
      ? Math.round(this.session.stats.totalItems / elapsedMinutes)
      : 0;

    // Estimate accuracy based on confidence scores
    if (items.length > 0) {
      const avgConfidence =
        items.reduce((sum, item) => sum + item.countConfidence, 0) / items.length;
      const verifiedRatio = items.filter((i) => i.manuallyVerified).length / items.length;
      this.session.stats.estimatedAccuracy = Math.min(
        1.0,
        avgConfidence * 0.7 + verifiedRatio * 0.3
      );
    }
  }

  /**
   * Simple Levenshtein distance for fuzzy matching.
   */
  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = b[i - 1] === a[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[b.length][a.length];
  }
}
