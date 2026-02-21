/**
 * @openclaw/raybans-vision — Meta Ray-Bans × OpenClaw Vision Platform
 *
 * Smart glasses + AI vision agents for inventory counting,
 * product identification, hands-free intelligence, and life indexing.
 */

// Core types
export type {
  CapturedImage,
  CaptureTrigger,
  GeoLocation,
  VisionAnalysis,
  SceneType,
  ExtractedText,
  DetectedObject,
  DetectedProduct,
  DecodedBarcode,
  BarcodeFormat,
  BoundingBox,
  ImageQuality,
  InventorySession,
  InventorySessionStatus,
  InventoryStats,
  InventoryConfig,
  InventoryItem,
  InventoryFlag,
  StoreLocation,
  VoiceCommand,
  VoiceIntent,
  ProductInfo,
  ProductDataSource,
  AgentConfig,
  PipelineResult,
  PlatformEvent,
} from './types.js';

export { DEFAULT_INVENTORY_CONFIG } from './types.js';

// Vision pipeline
export { VisionPipeline, createInventoryPipeline } from './vision/vision-pipeline.js';
export type { VisionPipelineConfig, AnalysisMode } from './vision/vision-pipeline.js';

// Inventory
export { InventoryStateManager } from './inventory/inventory-state.js';
export { ProductDatabase } from './inventory/product-database.js';
export { ExportService } from './inventory/export-service.js';
export type { ExportFormat, ExportOptions, ExportColumn } from './inventory/export-service.js';

// Voice
export { VoiceCommandRouter, parseVoiceCommand } from './voice/voice-command-router.js';

// Agents
export { InventoryAgent } from './agents/inventory-agent.js';
export type { InventoryAgentConfig } from './agents/inventory-agent.js';
export { MemoryAgent } from './agents/memory-agent.js';
export type { MemoryAgentConfig, MemoryAgentEvents, MemorySearchResult } from './agents/memory-agent.js';

// Bridge (OpenClaw node integration)
export { NodeBridge } from './bridge/node-bridge.js';
export type { NodeBridgeConfig, NodeBridgeEvents, DeviceInfo } from './bridge/node-bridge.js';
export { ImageScheduler } from './bridge/image-scheduler.js';
export type { ImageSchedulerConfig, ImageSchedulerEvents } from './bridge/image-scheduler.js';

// Storage (persistence layer)
export { PersistenceLayer } from './storage/persistence.js';
export type {
  PersistenceConfig,
  SessionQuery,
  ItemQuery,
  MemoryQuery,
  MemoryEntry,
} from './storage/persistence.js';

// Dashboard API
export { DashboardApiServer } from './dashboard/api-server.js';
export type { DashboardApiConfig, DashboardApiEvents } from './dashboard/api-server.js';
