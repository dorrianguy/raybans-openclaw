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

// Translation Agent
export { TranslationAgent, detectLanguage, getLanguageName, classifyContent, parseMenuItems } from './agents/translation-agent.js';
export type {
  TranslationConfig,
  TranslationMode,
  TranslationResult,
  TranslatedContentType,
  MenuTranslation,
  CulturalBriefing,
  EtiquetteRule,
  PhraseEntry,
  TranslationAgentStats,
} from './agents/translation-agent.js';

// Debug Agent
export { DebugAgent, detectProgrammingLanguage, classifyDebugContent, parseErrors, findFixes, extractLineNumbers } from './agents/debug-agent.js';
export type {
  DebugConfig,
  DebugAnalysis,
  DebugContentType,
  ProgrammingLanguage,
  DebugProblem,
  ProblemCategory,
  DebugFix,
  DebugSession,
  DebugAgentStats,
} from './agents/debug-agent.js';

// Context-Aware Agent
export { ContextAgent, detectContext, checkNutritionAlerts, lookupBoltSpec } from './agents/context-agent.js';
export type {
  ContextConfig,
  ContextType,
  ContextDetection,
  ContextResponse,
  IdentifiedItem,
  ContextInfo,
  ContextAlert,
  UserPreferences,
  DietaryProfile,
  DietaryRestriction,
  FitnessProfile,
  ActiveTask,
  TaskProgress,
  ContextAgentStats,
} from './agents/context-agent.js';

// Companion WebSocket
export { CompanionWebSocketHandler } from './dashboard/companion-ws.js';
export type { CompanionWSConfig, CompanionWSEvents } from './dashboard/companion-ws.js';

// Context Chain Engine (Feature #10: The Power Move)
export {
  ContextChainEngine,
  BUILT_IN_CHAINS,
  SALES_MEETING_CHAIN,
  SHOPPING_TRIP_CHAIN,
  PROPERTY_WALKTHROUGH_CHAIN,
  TRAVEL_EXPLORER_CHAIN,
  CONFERENCE_NETWORKING_CHAIN,
  DEFAULT_CHAIN_CONFIG,
} from './chains/context-chain-engine.js';
export type {
  ChainDefinition,
  ChainPhase,
  ChainAction,
  ChainTrigger,
  ChainTriggerType,
  ChainInstance,
  ChainInstanceStatus,
  ChainAgentHandler,
  ChainExecutionContext,
  ChainEngineConfig,
  ChainEngineEvents,
  ChainEngineStats,
  ActionResult,
  ActionExecution,
  ActionDelivery,
  PhaseExecution,
  PhaseTiming,
  DeliveryRule as ChainDeliveryRule,
} from './chains/context-chain-engine.js';

// Notification Engine
export {
  NotificationEngine,
  PRIORITY_VALUES,
  DEFAULT_NOTIFICATION_CONFIG,
} from './notifications/notification-engine.js';
export type {
  Notification,
  DeliveredNotification,
  NotificationPriority,
  NotificationCategory,
  NotificationEngineConfig,
  NotificationEngineEvents,
  NotificationEngineStats,
  DeliveryChannel,
  DeliveryRule,
  UserContext,
} from './notifications/notification-engine.js';

// Analytics Engine
export {
  AnalyticsEngine,
  DEFAULT_ANALYTICS_CONFIG,
} from './analytics/analytics-engine.js';
export type {
  AnalyticsEvent,
  AnalyticsEventCategory,
  AnalyticsEngineConfig,
  AnalyticsEngineEvents,
  AnalyticsDashboard,
  AggregatedMetric,
  AgentMetrics,
  SessionMetrics,
  ValueMetrics,
  TimeBucket,
} from './analytics/analytics-engine.js';
