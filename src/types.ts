/**
 * Core types for the Ray-Bans × OpenClaw vision platform.
 * Every module imports from here.
 */

// ─── Image & Capture ───────────────────────────────────────────

export interface CapturedImage {
  /** Unique image identifier */
  id: string;
  /** Raw image buffer (JPEG/PNG from camera) */
  buffer: Buffer;
  /** MIME type */
  mimeType: 'image/jpeg' | 'image/png';
  /** ISO timestamp when captured */
  capturedAt: string;
  /** GPS coordinates if available */
  location?: GeoLocation;
  /** Source device identifier */
  deviceId: string;
  /** How the capture was triggered */
  trigger: CaptureTrigger;
  /** Optional user-provided context via voice */
  voiceAnnotation?: string;
}

export type CaptureTrigger =
  | 'auto'        // periodic auto-snap
  | 'manual'      // user said "remember this" or tapped
  | 'voice'       // voice command triggered
  | 'gesture'     // double-tap or other gesture
  | 'change';     // change detection triggered re-snap

export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy?: number; // meters
  altitude?: number;
}

// ─── Vision Analysis ────────────────────────────────────────────

export interface VisionAnalysis {
  /** ID of the analyzed image */
  imageId: string;
  /** Timestamp of analysis */
  analyzedAt: string;
  /** Time taken for analysis in ms */
  processingTimeMs: number;
  /** Scene-level description */
  sceneDescription: string;
  /** What type of scene this is */
  sceneType: SceneType;
  /** All text found via OCR */
  extractedText: ExtractedText[];
  /** Objects detected in the image */
  detectedObjects: DetectedObject[];
  /** Products identified (for inventory/shopping) */
  products: DetectedProduct[];
  /** Barcodes found and decoded */
  barcodes: DecodedBarcode[];
  /** Quality assessment of the image */
  quality: ImageQuality;
  /** Raw model response (for debugging) */
  rawResponse?: string;
}

export type SceneType =
  | 'retail_shelf'
  | 'warehouse'
  | 'office'
  | 'outdoor'
  | 'kitchen'
  | 'workshop'
  | 'document'
  | 'screen'
  | 'whiteboard'
  | 'person'
  | 'vehicle'
  | 'property'
  | 'unknown';

export interface ExtractedText {
  text: string;
  /** Rough location in image (normalized 0-1) */
  region?: BoundingBox;
  /** OCR confidence 0-1 */
  confidence: number;
  /** What kind of text this is */
  textType: 'label' | 'price' | 'barcode_number' | 'document' | 'screen' | 'sign' | 'other';
}

export interface DetectedObject {
  label: string;
  confidence: number;
  region?: BoundingBox;
  attributes?: Record<string, string>;
}

export interface DetectedProduct {
  /** Best guess at product name */
  name: string;
  /** Brand if identifiable */
  brand?: string;
  /** Product category */
  category?: string;
  /** Size/variant info */
  variant?: string;
  /** Confidence of identification 0-1 */
  confidence: number;
  /** How the product was identified */
  identificationMethod: 'barcode' | 'shelf_label' | 'visual' | 'voice_override';
  /** Matched UPC/EAN if available */
  upc?: string;
  /** Estimated count visible */
  estimatedCount: number;
  /** Count confidence 0-1 */
  countConfidence: number;
  /** Location in image */
  region?: BoundingBox;
  /** Price if visible on shelf label */
  priceOnShelf?: number;
}

export interface DecodedBarcode {
  /** Raw barcode data */
  data: string;
  /** Barcode format */
  format: BarcodeFormat;
  /** Position in image */
  region?: BoundingBox;
  /** Confidence of decode */
  confidence: number;
}

export type BarcodeFormat =
  | 'UPC-A'
  | 'UPC-E'
  | 'EAN-13'
  | 'EAN-8'
  | 'Code128'
  | 'Code39'
  | 'QR'
  | 'DataMatrix'
  | 'unknown';

export interface BoundingBox {
  x: number;      // 0-1 normalized
  y: number;      // 0-1 normalized
  width: number;  // 0-1 normalized
  height: number; // 0-1 normalized
}

export interface ImageQuality {
  /** Overall quality score 0-1 */
  score: number;
  /** Is the image too blurry? */
  isBlurry: boolean;
  /** Is there excessive glare? */
  hasGlare: boolean;
  /** Is the image too dark? */
  isUnderexposed: boolean;
  /** Is the image overexposed? */
  isOverexposed: boolean;
  /** Usable for product identification? */
  usableForInventory: boolean;
}

// ─── Inventory ──────────────────────────────────────────────────

export interface InventorySession {
  id: string;
  /** Human-readable name */
  name: string;
  /** Store/location identifier */
  storeId?: string;
  storeName?: string;
  /** When the session started */
  startedAt: string;
  /** When the session completed (null if still active) */
  completedAt?: string;
  /** Current session status */
  status: InventorySessionStatus;
  /** Running statistics */
  stats: InventoryStats;
  /** Configuration for this session */
  config: InventoryConfig;
}

export type InventorySessionStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';

export interface InventoryStats {
  totalItems: number;
  totalSKUs: number;
  imagesProcessed: number;
  imagesCaptured: number;
  flaggedItems: number;
  estimatedAccuracy: number;
  aislesCovered: string[];
  startTime: string;
  lastUpdateTime: string;
  /** Items per minute processing rate */
  itemsPerMinute: number;
}

export interface InventoryConfig {
  /** Seconds between auto-snaps (0 = manual only) */
  autoSnapIntervalSec: number;
  /** Default shelf depth multiplier */
  defaultDepthFactor: number;
  /** Minimum confidence to accept a product ID */
  minProductConfidence: number;
  /** Minimum confidence to accept a count */
  minCountConfidence: number;
  /** Enable voice feedback */
  voiceFeedbackEnabled: boolean;
  /** How often to give voice progress updates (in items) */
  voiceUpdateInterval: number;
  /** Categories to track (empty = all) */
  categoryFilter: string[];
}

export const DEFAULT_INVENTORY_CONFIG: InventoryConfig = {
  autoSnapIntervalSec: 3,
  defaultDepthFactor: 1,
  minProductConfidence: 0.6,
  minCountConfidence: 0.5,
  voiceFeedbackEnabled: true,
  voiceUpdateInterval: 50,
  categoryFilter: [],
};

export interface InventoryItem {
  /** Unique item identifier in this session */
  id: string;
  /** Session this belongs to */
  sessionId: string;
  /** UPC/EAN/SKU code */
  sku: string;
  /** Product name */
  name: string;
  /** Brand */
  brand?: string;
  /** Category */
  category?: string;
  /** Size/variant */
  variant?: string;
  /** Current count (cumulative across snaps) */
  quantity: number;
  /** Confidence of the count 0-1 */
  countConfidence: number;
  /** How the product was identified */
  identificationMethod: DetectedProduct['identificationMethod'];
  /** Location in store */
  location: StoreLocation;
  /** Price seen on shelf */
  priceOnShelf?: number;
  /** Flags for attention */
  flags: InventoryFlag[];
  /** All image IDs that contributed to this item's count */
  imageRefs: string[];
  /** First time this product was seen in this session */
  firstSeenAt: string;
  /** Last time this product was seen */
  lastSeenAt: string;
  /** Was this manually verified/corrected? */
  manuallyVerified: boolean;
}

export interface StoreLocation {
  aisle?: string;
  shelf?: string;
  position?: string;
  section?: string;
}

export type InventoryFlag =
  | 'low_stock'
  | 'empty_spot'
  | 'misplaced'
  | 'damaged'
  | 'expired'
  | 'low_confidence'
  | 'price_mismatch'
  | 'needs_recount';

// ─── Voice Commands ─────────────────────────────────────────────

export interface VoiceCommand {
  /** Raw transcribed text */
  rawText: string;
  /** Parsed intent */
  intent: VoiceIntent;
  /** Extracted parameters */
  params: Record<string, string>;
  /** Confidence of intent classification */
  confidence: number;
  /** Timestamp */
  timestamp: string;
}

export type VoiceIntent =
  // Inventory commands
  | 'inventory_start'
  | 'inventory_stop'
  | 'inventory_pause'
  | 'inventory_resume'
  | 'inventory_annotate'
  | 'inventory_set_aisle'
  | 'inventory_set_section'
  | 'inventory_set_depth'
  | 'inventory_manual_count'
  | 'inventory_skip'
  // General commands
  | 'remember_this'
  | 'take_photo'
  | 'what_is_this'
  | 'price_check'
  | 'translate'
  | 'debug_this'
  | 'start_meeting'
  | 'end_meeting'
  | 'privacy_mode'
  | 'resume_capture'
  | 'delete_recent'
  | 'status_report'
  | 'unknown';

// ─── Product Database ───────────────────────────────────────────

export interface ProductInfo {
  /** UPC/EAN code */
  upc: string;
  /** Product name */
  name: string;
  /** Brand */
  brand: string;
  /** Category */
  category: string;
  /** Description */
  description?: string;
  /** Size/weight */
  size?: string;
  /** Image URL */
  imageUrl?: string;
  /** Average retail price */
  avgPrice?: number;
  /** Data source */
  source: ProductDataSource;
}

export type ProductDataSource =
  | 'upcitemdb'
  | 'open_food_facts'
  | 'manual'
  | 'vision_identified'
  | 'cache';

// ─── Agent & Pipeline ───────────────────────────────────────────

export interface AgentConfig {
  /** Which vision model to use */
  visionModel: string;
  /** API key for vision model */
  visionApiKey: string;
  /** OpenClaw gateway URL */
  gatewayUrl?: string;
  /** OpenClaw gateway token */
  gatewayToken?: string;
  /** Device ID of the Ray-Ban node */
  deviceId?: string;
  /** Data storage directory */
  dataDir: string;
  /** Enable debug logging */
  debug: boolean;
}

export interface PipelineResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  processingTimeMs: number;
}

// ─── Events ─────────────────────────────────────────────────────

export type PlatformEvent =
  | { type: 'image_captured'; image: CapturedImage }
  | { type: 'analysis_complete'; analysis: VisionAnalysis }
  | { type: 'product_identified'; product: DetectedProduct; imageId: string }
  | { type: 'barcode_decoded'; barcode: DecodedBarcode; imageId: string }
  | { type: 'inventory_updated'; item: InventoryItem; sessionId: string }
  | { type: 'inventory_session_changed'; session: InventorySession }
  | { type: 'voice_command'; command: VoiceCommand }
  | { type: 'quality_issue'; imageId: string; quality: ImageQuality }
  | { type: 'flag_raised'; flag: InventoryFlag; item: InventoryItem }
  | { type: 'error'; source: string; message: string; details?: unknown };
