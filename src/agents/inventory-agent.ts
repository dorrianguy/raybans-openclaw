/**
 * Inventory Vision Agent — The main orchestrator for smart glasses inventory.
 *
 * This is the "brain" that coordinates:
 * - Image capture scheduling
 * - Vision pipeline (image → analysis)
 * - Inventory state management (dedup, counting)
 * - Product database lookups (UPC → product info)
 * - Voice command handling
 * - Export generation
 * - Voice feedback (TTS responses)
 *
 * Usage:
 *   const agent = new InventoryAgent({ apiKey: '...', model: 'gpt-4o' });
 *   agent.start('Evening Count', { storeName: 'Mike's Hardware' });
 *   agent.processImage(capturedImage);
 *   agent.handleVoice('Aisle 3');
 *   const report = agent.exportCsv();
 */

import { EventEmitter } from 'eventemitter3';
import type {
  CapturedImage,
  VisionAnalysis,
  InventorySession,
  InventoryItem,
  InventoryConfig,
  InventoryFlag,
  VoiceCommand,
  StoreLocation,
  PipelineResult,
} from '../types.js';
import { VisionPipeline, type VisionPipelineConfig } from '../vision/vision-pipeline.js';
import { InventoryStateManager } from '../inventory/inventory-state.js';
import { ProductDatabase, type ProductDatabaseConfig } from '../inventory/product-database.js';
import { ExportService, type ExportOptions } from '../inventory/export-service.js';
import { VoiceCommandRouter } from '../voice/voice-command-router.js';

// ─── Configuration ──────────────────────────────────────────────

export interface InventoryAgentConfig {
  /** Vision model API key */
  apiKey: string;
  /** Vision model name */
  model?: string;
  /** Vision API base URL */
  apiBaseUrl?: string;
  /** Product database config */
  productDb?: Partial<ProductDatabaseConfig>;
  /** Enable verbose logging */
  debug?: boolean;
}

// ─── Events ─────────────────────────────────────────────────────

export interface InventoryAgentEvents {
  /** A voice response that should be sent via TTS to the glasses */
  'voice:response': (text: string) => void;
  /** An image was processed successfully */
  'image:processed': (analysis: VisionAnalysis, items: InventoryItem[]) => void;
  /** An image had quality issues */
  'image:quality_issue': (imageId: string, message: string) => void;
  /** The inventory was updated */
  'inventory:updated': (session: InventorySession) => void;
  /** An item was flagged */
  'inventory:flagged': (item: InventoryItem, flag: InventoryFlag) => void;
  /** Session state changed */
  'session:changed': (status: string) => void;
  /** An error occurred */
  'error': (source: string, message: string) => void;
  /** Debug log */
  'log': (message: string) => void;
}

// ─── Agent ──────────────────────────────────────────────────────

export class InventoryAgent extends EventEmitter<InventoryAgentEvents> {
  private visionPipeline: VisionPipeline;
  private stateManager: InventoryStateManager | null = null;
  private productDb: ProductDatabase;
  private exportService: ExportService;
  private voiceRouter: VoiceCommandRouter;
  private config: InventoryAgentConfig;
  private processedImageCount = 0;
  private lastProgressUpdate = 0;

  constructor(config: InventoryAgentConfig) {
    super();
    this.config = config;

    // Initialize vision pipeline
    this.visionPipeline = new VisionPipeline({
      model: config.model || 'gpt-4o',
      apiKey: config.apiKey,
      apiBaseUrl: config.apiBaseUrl,
      mode: 'inventory',
      temperature: 0.05,
    });

    // Initialize product database
    this.productDb = new ProductDatabase(config.productDb);

    // Initialize export service
    this.exportService = new ExportService();

    // Initialize voice command router
    this.voiceRouter = new VoiceCommandRouter();

    this.log('Inventory agent initialized');
  }

  // ─── Session Lifecycle ──────────────────────────────────────

  /**
   * Start a new inventory session.
   */
  start(
    name: string,
    options: {
      storeName?: string;
      config?: Partial<InventoryConfig>;
    } = {}
  ): InventorySession {
    if (this.stateManager?.isActive()) {
      this.say('An inventory session is already active. Say "stop inventory" first.');
      return this.stateManager.getSession();
    }

    this.stateManager = new InventoryStateManager(
      name,
      options.config,
      options.storeName
    );
    this.processedImageCount = 0;
    this.lastProgressUpdate = 0;

    // Wire up state manager events
    this.stateManager.on('item:flagged', (item, flag) => {
      this.emit('inventory:flagged', item, flag);
      this.handleFlag(item, flag);
    });

    this.stateManager.on('stats:updated', () => {
      this.emit('inventory:updated', this.stateManager!.getSession());
      this.maybeGiveProgressUpdate();
    });

    const session = this.stateManager.getSession();
    this.log(`Inventory session started: ${name} (${session.id})`);
    this.say(`Inventory started: ${name}. ${options.storeName ? `Store: ${options.storeName}. ` : ''}I'm ready to scan. Walk the aisles and I'll count everything I see.`);
    this.emit('session:changed', 'active');

    return session;
  }

  /**
   * Pause the current session.
   */
  pause(): void {
    if (!this.stateManager?.isActive()) {
      this.say('No active inventory to pause.');
      return;
    }
    this.stateManager.pause();
    this.say('Inventory paused. Say "resume" when ready.');
    this.emit('session:changed', 'paused');
  }

  /**
   * Resume a paused session.
   */
  resume(): void {
    if (this.stateManager?.getStatus() !== 'paused') {
      this.say('No paused inventory to resume.');
      return;
    }
    this.stateManager.resume();
    this.say('Inventory resumed. Keep walking.');
    this.emit('session:changed', 'active');
  }

  /**
   * Complete the current session and generate reports.
   */
  stop(): InventorySession | null {
    if (!this.stateManager) {
      this.say('No active inventory session.');
      return null;
    }

    const session = this.stateManager.complete();
    const items = this.stateManager.getAllItems();
    const voiceSummary = this.exportService.generateVoiceSummary(items, session);

    this.say(voiceSummary);
    this.emit('session:changed', 'completed');
    this.log(`Inventory completed: ${items.length} SKUs, ${session.stats.totalItems} items`);

    return session;
  }

  /**
   * Check if a session is active.
   */
  isActive(): boolean {
    return this.stateManager?.isActive() || false;
  }

  /**
   * Get the current session.
   */
  getSession(): InventorySession | null {
    return this.stateManager?.getSession() || null;
  }

  // ─── Image Processing ──────────────────────────────────────

  /**
   * Process a captured image through the vision pipeline.
   * This is the core method — called every time the glasses snap a photo.
   */
  async processImage(
    image: CapturedImage
  ): Promise<PipelineResult<{ analysis: VisionAnalysis; items: InventoryItem[] }>> {
    const startTime = Date.now();

    if (!this.stateManager?.isActive()) {
      return {
        success: false,
        error: 'No active inventory session',
        processingTimeMs: 0,
      };
    }

    this.log(`Processing image ${image.id}...`);

    // Quick quality check
    const quality = await this.visionPipeline.quickQualityCheck(image);
    if (!quality.usableForInventory) {
      const msg = quality.isBlurry
        ? "That image was too blurry. Try holding still for a moment."
        : quality.isUnderexposed
          ? "Too dark. Can you get more light on the shelf?"
          : "Image quality issue. Try again from a different angle.";

      this.emit('image:quality_issue', image.id, msg);
      this.say(msg);

      return {
        success: false,
        error: msg,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Run vision analysis
    const result = await this.visionPipeline.analyze(image, 'inventory');

    if (!result.success || !result.data) {
      this.emit('error', 'vision', result.error || 'Analysis failed');
      return {
        success: false,
        error: result.error,
        processingTimeMs: Date.now() - startTime,
      };
    }

    const analysis = result.data;

    // Enrich products with database lookups
    await this.enrichProducts(analysis);

    // Process analysis into inventory state
    const updatedItems = this.stateManager.processAnalysis(analysis);
    this.processedImageCount++;

    this.emit('image:processed', analysis, updatedItems);
    this.log(
      `Image ${image.id}: ${analysis.products.length} products, ` +
      `${analysis.barcodes.length} barcodes, ` +
      `${updatedItems.length} items updated (${Date.now() - startTime}ms)`
    );

    return {
      success: true,
      data: { analysis, items: updatedItems },
      processingTimeMs: Date.now() - startTime,
    };
  }

  // ─── Voice Commands ─────────────────────────────────────────

  /**
   * Handle a voice command from the glasses.
   */
  handleVoice(rawText: string): VoiceCommand {
    const command = this.voiceRouter.parse(rawText);
    this.log(`Voice command: "${rawText}" → ${command.intent} (${(command.confidence * 100).toFixed(0)}%)`);

    switch (command.intent) {
      case 'inventory_start':
        this.start('Voice Inventory');
        break;

      case 'inventory_stop':
        this.stop();
        break;

      case 'inventory_pause':
        this.pause();
        break;

      case 'inventory_resume':
        this.resume();
        break;

      case 'inventory_set_aisle':
        if (command.params.aisle) {
          this.stateManager?.setAisle(command.params.aisle);
          this.say(`Now in aisle ${command.params.aisle}.`);
        }
        break;

      case 'inventory_set_section':
        if (command.params.section) {
          this.stateManager?.setSection(command.params.section);
          this.say(`Section: ${command.params.section}.`);
        }
        break;

      case 'inventory_set_depth':
        if (command.params.depth && this.stateManager) {
          const depth = parseInt(command.params.depth, 10);
          const session = this.stateManager.getSession();
          session.config.defaultDepthFactor = depth;
          this.say(`Shelf depth set to ${depth}.`);
        }
        break;

      case 'inventory_manual_count':
        if (command.params.count && command.params.product) {
          const count = parseInt(command.params.count, 10);
          const item = this.stateManager?.manualCount({
            productIdentifier: command.params.product,
            count,
          });
          if (item) {
            this.say(`Got it. ${count} ${command.params.product}.`);
          } else {
            this.say(`Noted: ${count} ${command.params.product}.`);
          }
        }
        break;

      case 'inventory_skip':
        this.say('Skipping this area.');
        break;

      case 'inventory_annotate':
        if (command.params.annotation) {
          this.log(`Annotation: ${command.params.annotation}`);
          this.say(`Note saved: ${command.params.annotation}`);
        }
        break;

      case 'status_report':
        this.giveStatusReport();
        break;

      case 'unknown':
        if (command.rawText.length > 0) {
          this.say("I didn't catch that. Say 'status' for a progress update or 'help' for available commands.");
        }
        break;

      default:
        this.say(`Command "${command.intent}" is not available in inventory mode.`);
        break;
    }

    return command;
  }

  // ─── Export ─────────────────────────────────────────────────

  /**
   * Export inventory to CSV.
   */
  exportCsv(options?: Partial<ExportOptions>): string {
    if (!this.stateManager) return '';
    return this.exportService.export(
      this.stateManager.getAllItems(),
      this.stateManager.getSession(),
      { ...options, format: 'csv' }
    );
  }

  /**
   * Export inventory to JSON.
   */
  exportJson(options?: Partial<ExportOptions>): string {
    if (!this.stateManager) return '';
    return this.exportService.export(
      this.stateManager.getAllItems(),
      this.stateManager.getSession(),
      { ...options, format: 'json' }
    );
  }

  /**
   * Generate a full markdown report.
   */
  generateReport(): string {
    if (!this.stateManager) return '';
    return this.exportService.generateSummary(
      this.stateManager.getAllItems(),
      this.stateManager.getSession()
    );
  }

  /**
   * Get all inventory items.
   */
  getItems(): InventoryItem[] {
    return this.stateManager?.getAllItems() || [];
  }

  /**
   * Get flagged items.
   */
  getFlaggedItems(): InventoryItem[] {
    return this.stateManager?.getFlaggedItems() || [];
  }

  // ─── Private ──────────────────────────────────────────────

  /**
   * Enrich detected products with database info (UPC lookups).
   */
  private async enrichProducts(analysis: VisionAnalysis): Promise<void> {
    // Look up all barcodes
    const upcs = analysis.barcodes.map((b) => b.data);
    if (upcs.length === 0) return;

    const lookups = await this.productDb.batchLookup(upcs);

    // Match barcode lookups to products
    for (const product of analysis.products) {
      if (product.upc && lookups.has(product.upc)) {
        const info = lookups.get(product.upc)!;
        // Enrich with database info
        if (!product.name || product.name.startsWith('Unknown')) {
          product.name = info.name;
        }
        if (!product.brand) product.brand = info.brand;
        if (!product.category) product.category = info.category;
      }
    }

    // Create products for barcodes that weren't matched by vision
    for (const [upc, info] of lookups) {
      const hasProduct = analysis.products.some((p) => p.upc === upc);
      if (!hasProduct) {
        analysis.products.push({
          name: info.name,
          brand: info.brand,
          category: info.category,
          confidence: 0.9, // High confidence from DB match
          identificationMethod: 'barcode',
          upc,
          estimatedCount: 1,
          countConfidence: 0.5, // Low count confidence since we didn't visually count
        });
      }
    }
  }

  /**
   * Handle a flagged item — decide if we need to alert the user.
   */
  private handleFlag(item: InventoryItem, flag: InventoryFlag): void {
    switch (flag) {
      case 'empty_spot':
        this.say(`Empty shelf spotted where ${item.name} should be.`);
        break;
      case 'low_stock':
        // Don't announce every low stock item — too noisy.
        // Will be summarized in progress updates.
        break;
      case 'price_mismatch':
        this.say(`Price mismatch on ${item.name}. Check shelf label.`);
        break;
      case 'damaged':
        this.say(`Damaged packaging detected: ${item.name}.`);
        break;
      case 'expired':
        this.say(`Expired product found: ${item.name}.`);
        break;
      case 'misplaced':
        this.say(`${item.name} may be misplaced.`);
        break;
      default:
        break;
    }
  }

  /**
   * Give periodic voice progress updates.
   */
  private maybeGiveProgressUpdate(): void {
    if (!this.stateManager) return;

    const config = this.stateManager.getSession().config;
    if (!config.voiceFeedbackEnabled) return;

    const stats = this.stateManager.getStats();
    const itemsSinceLastUpdate = stats.totalItems - this.lastProgressUpdate;

    if (itemsSinceLastUpdate >= config.voiceUpdateInterval) {
      this.say(
        `${stats.totalItems} items counted across ${stats.totalSKUs} products. ` +
        `${stats.aislesCovered.length} aisles covered.`
      );
      this.lastProgressUpdate = stats.totalItems;
    }
  }

  /**
   * Give a full status report via voice.
   */
  private giveStatusReport(): void {
    if (!this.stateManager) {
      this.say('No active inventory session.');
      return;
    }

    const session = this.stateManager.getSession();
    const items = this.stateManager.getAllItems();
    const summary = this.exportService.generateVoiceSummary(items, session);
    this.say(summary);
  }

  /**
   * Send a voice response (emits event for TTS delivery).
   */
  private say(text: string): void {
    this.emit('voice:response', text);
  }

  /**
   * Log a debug message.
   */
  private log(message: string): void {
    if (this.config.debug) {
      this.emit('log', `[InventoryAgent] ${message}`);
    }
  }
}
