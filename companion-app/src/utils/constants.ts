/**
 * App-wide constants for the Ray-Bans Companion App.
 */

// ─── Backend ────────────────────────────────────────────────────

export const DEFAULT_BACKEND_URL = 'http://localhost:3847';
export const DEFAULT_WS_URL = 'ws://localhost:3847';
export const API_TIMEOUT_MS = 15_000;
export const WS_RECONNECT_DELAY_MS = 3_000;
export const WS_MAX_RECONNECT_ATTEMPTS = 10;
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

// ─── BLE / Glasses ──────────────────────────────────────────────

export const GLASSES_BLE_SERVICE_UUID = '0000fe01-0000-1000-8000-00805f9b34fb';
export const GLASSES_BLE_CAMERA_CHAR_UUID = '0000fe02-0000-1000-8000-00805f9b34fb';
export const GLASSES_BLE_AUDIO_CHAR_UUID = '0000fe03-0000-1000-8000-00805f9b34fb';
export const GLASSES_BLE_CONTROL_CHAR_UUID = '0000fe04-0000-1000-8000-00805f9b34fb';
export const GLASSES_BLE_STATUS_CHAR_UUID = '0000fe05-0000-1000-8000-00805f9b34fb';

export const BLE_SCAN_TIMEOUT_MS = 15_000;
export const BLE_RECONNECT_DELAY_MS = 2_000;
export const BLE_MAX_RECONNECT_ATTEMPTS = 5;

/** Meta Ray-Ban manufacturer ID for BLE advertisement filtering */
export const META_MANUFACTURER_ID = 0x04E7;

// ─── Camera / Capture ───────────────────────────────────────────

export const DEFAULT_CAPTURE_FPS = 5;
export const MAX_CAPTURE_FPS = 30;
export const MIN_CAPTURE_FPS = 1;
export const DEFAULT_CAPTURE_QUALITY = 0.8; // JPEG quality 0-1
export const FRAME_BUFFER_MAX_SIZE = 50; // frames
export const FRAME_BUFFER_FLUSH_THRESHOLD = 10;
export const DEFAULT_FRAME_WIDTH = 1280;
export const DEFAULT_FRAME_HEIGHT = 720;

// ─── Voice / Audio ──────────────────────────────────────────────

export const DEFAULT_WAKE_WORD = 'hey siberius';
export const VOICE_SILENCE_TIMEOUT_MS = 2_000;
export const VOICE_MAX_DURATION_MS = 30_000;
export const VOICE_SAMPLE_RATE = 16_000;

export const DEEPGRAM_MODEL = 'nova-3';
export const DEEPGRAM_LANGUAGE = 'en-US';

export const CARTESIA_MODEL = 'sonic-2';
export const CARTESIA_VOICE_ID = 'a0e99841-438c-4a64-b679-ae501e7d6091'; // Default male voice
export const DEFAULT_TTS_SPEED = 1.0;
export const DEFAULT_TTS_VOLUME = 0.9;

// ─── UI ─────────────────────────────────────────────────────────

export const COLORS = {
  background: '#0a0a0a',
  surface: '#1a1a2e',
  surfaceLight: '#252542',
  primary: '#7c3aed',       // Violet
  primaryLight: '#a78bfa',
  secondary: '#06b6d4',     // Cyan
  accent: '#f59e0b',        // Amber
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  border: '#334155',
  borderLight: '#475569',
} as const;

export const AGENT_COLORS: Record<string, string> = {
  networking: '#8b5cf6',
  'deal-analysis': '#f59e0b',
  security: '#ef4444',
  meeting: '#3b82f6',
  inspection: '#f97316',
  memory: '#10b981',
  inventory: '#06b6d4',
  context: '#7c3aed',
};

export const AGENT_ICONS: Record<string, string> = {
  networking: 'people',
  'deal-analysis': 'pricetag',
  security: 'shield-checkmark',
  meeting: 'videocam',
  inspection: 'search',
  memory: 'brain',
  inventory: 'cube',
  context: 'git-branch',
};

// ─── Storage Keys ───────────────────────────────────────────────

export const STORAGE_KEYS = {
  SETTINGS: 'app_settings',
  ONBOARDING_COMPLETE: 'onboarding_complete',
  LAST_DEVICE_ID: 'last_device_id',
  AUTH_TOKEN: 'auth_token',
  FRAME_QUEUE: 'offline_frame_queue',
} as const;

// ─── Agent IDs (must match backend SpecialistAgent ids) ─────────

export const AGENT_IDS = {
  NETWORKING: 'networking',
  DEAL_ANALYSIS: 'deal-analysis',
  SECURITY: 'security',
  MEETING: 'meeting',
  INSPECTION: 'inspection',
  MEMORY: 'memory',
  INVENTORY: 'inventory',
} as const;
