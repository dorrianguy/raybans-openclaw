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
export { NetworkingAgent } from './agents/networking-agent.js';
export type {
  NetworkingAgentConfig,
  NetworkingAgentEvents,
  ContactInfo,
  ContactContext,
  PersonResearch,
} from './agents/networking-agent.js';
export { DealAnalysisAgent } from './agents/deal-agent.js';
export type {
  DealAnalysisAgentConfig,
  DealAnalysisEvents,
  DealAnalysis,
  DealCategory,
  DealVerdict,
  ItemInfo,
  VehicleInfo,
  PropertyInfo,
  MarketPrice,
  AlternativeItem,
} from './agents/deal-agent.js';
export { SecurityAgent } from './agents/security-agent.js';
export type {
  SecurityAgentConfig,
  SecurityAgentEvents,
  SecurityScanResult,
  ThreatDetection,
  ThreatLevel,
  ThreatCategory,
  QRAnalysis,
  URLCheck,
  DocumentFlag,
} from './agents/security-agent.js';
export { MeetingAgent } from './agents/meeting-agent.js';
export type {
  MeetingAgentConfig,
  MeetingAgentEvents,
  MeetingSession,
  MeetingSummary,
  TranscriptSegment,
  ActionItem,
  Decision,
  OpenQuestion,
  VisualCapture,
} from './agents/meeting-agent.js';
export { InspectionAgent } from './agents/inspection-agent.js';
export type {
  InspectionAgentConfig,
  InspectionAgentEvents,
  InspectionSession,
  InspectionReport,
  InspectionFinding,
  InspectionSection,
  InspectionType,
  FindingSeverity,
} from './agents/inspection-agent.js';

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

// Routing (Context Router)
export { ContextRouter } from './routing/context-router.js';
export type {
  ContextRouterConfig,
  ContextRouterEvents,
  SpecialistAgent,
  RoutingContext,
  AgentResponse,
  RoutingMode,
  RoutingDecision,
} from './routing/context-router.js';

// Dashboard API
export { DashboardApiServer } from './dashboard/api-server.js';
export type { DashboardApiConfig, DashboardApiEvents } from './dashboard/api-server.js';

// Companion WebSocket
export { CompanionWebSocketHandler } from './dashboard/companion-ws.js';
export type { CompanionWSConfig, CompanionWSEvents } from './dashboard/companion-ws.js';

// Translation Agent
export { TranslationAgent } from './agents/translation-agent.js';

// Debug Agent
export { DebugAgent } from './agents/debug-agent.js';

// Context-Aware Agent
export { ContextAgent } from './agents/context-agent.js';

// Context Chain Engine
export { ContextChainEngine } from './chains/context-chain-engine.js';

// Notification Engine
export { NotificationEngine } from './notifications/notification-engine.js';

// Analytics Engine
export { AnalyticsEngine } from './analytics/analytics-engine.js';

// Billing Engine
export { BillingEngine } from './billing/billing-engine.js';

// Store Layout Mapper
export { StoreLayoutMapper } from './inventory/store-layout.js';

// Landing Page Data
export { LandingPageDataEngine } from './marketing/landing-page-data.js';

// Plugin Registry (NEW — Night #16)
export { PluginRegistry } from './plugins/plugin-registry.js';
export type {
  PluginMetadata,
  PluginInstance,
  PluginState,
  PluginCategory,
  PluginCapability,
  PluginConfigSchema,
  PluginConfig,
  PluginHealthStatus,
  PluginHook,
  PricingTier,
  PluginRegistryConfig,
  PluginRegistryEvents,
} from './plugins/plugin-registry.js';

// Setup Wizard (NEW — Night #16)
export { SetupWizard } from './onboarding/setup-wizard.js';
export type {
  WizardStepId,
  WizardStep,
  WizardProgress,
  WizardConfig,
  WizardEvents,
  StoreProfile,
  StoreType,
  StorePreset,
  HardwarePairingStatus,
  TutorialAction,
} from './onboarding/setup-wizard.js';

// Dashboard Widget System (NEW — Night #16)
export { WidgetSystem } from './dashboard/widget-system.js';
export type {
  WidgetType,
  WidgetSize,
  WidgetConfig,
  WidgetAction,
  WidgetPosition,
  WidgetRefresh,
  DashboardLayout,
  DashboardView,
  DashboardTheme,
  WidgetSystemConfig,
  WidgetSystemEvents,
} from './dashboard/widget-system.js';

// API Gateway & Authentication (NEW — Night #21)
export { ApiGateway } from './gateway/api-gateway.js';
export type {
  ApiGatewayConfig,
  ApiGatewayEvents,
  AuthMethod,
  UserRole,
  Permission,
  ApiKeyScope,
  JwtPayload,
  ApiKey,
  AuthenticatedRequest,
  RequestLog,
  RouteDefinition,
} from './gateway/api-gateway.js';

// Configuration Engine (NEW — Night #21)
export { ConfigEngine, PLATFORM_CONFIG_SCHEMA } from './config/config-engine.js';
export type {
  ConfigEngineConfig,
  ConfigEngineEvents,
  Environment,
  ConfigSchema,
  ConfigValue,
  ConfigSource,
  ConfigValidationError,
  FeatureFlag,
  ConfigChangeEvent,
  SecretEntry,
} from './config/config-engine.js';

// Migration Engine (NEW — Night #21)
export {
  MigrationEngine,
  createTableMigration,
  addColumnMigration,
  createIndexMigration,
  seedDataMigration,
} from './migrations/migration-engine.js';
export type {
  MigrationEngineConfig,
  MigrationEngineEvents,
  Migration,
  MigrationFn,
  MigrationContext,
  MigrationRecord,
  MigrationPlan,
  MigrationDirection,
  MigrationStatus,
  MigrationCategory,
} from './migrations/migration-engine.js';
