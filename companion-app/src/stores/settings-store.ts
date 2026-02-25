/**
 * Settings Store — Persisted user preferences with Zustand + MMKV.
 *
 * All settings persist across app restarts.
 * Uses react-native-mmkv for fast synchronous storage.
 */

import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';
import type { CaptureMode } from '../services/camera-capture';
import type { TtsProvider } from '../services/tts-engine';
import {
  DEFAULT_BACKEND_URL,
  DEFAULT_WAKE_WORD,
  DEFAULT_CAPTURE_FPS,
  DEFAULT_CAPTURE_QUALITY,
  DEFAULT_TTS_SPEED,
  DEFAULT_TTS_VOLUME,
  STORAGE_KEYS,
  CARTESIA_VOICE_ID,
} from '../utils/constants';

// ─── MMKV Storage ───────────────────────────────────────────────

const storage = new MMKV({ id: 'settings' });

// ─── Settings State ─────────────────────────────────────────────

export interface SettingsState {
  // Backend
  backendUrl: string;
  authToken: string;

  // Glasses connection
  providerType: 'meta-dat' | 'ble-plx' | 'mock';
  autoConnect: boolean;
  lastDeviceId: string | null;

  // Camera/Capture
  captureMode: CaptureMode;
  captureFps: number;
  captureQuality: number;
  autoSnapIntervalSec: number;
  adaptiveQuality: boolean;

  // Voice
  wakeWord: string;
  wakeWordEnabled: boolean;
  deepgramApiKey: string;
  voiceLanguage: string;

  // TTS
  ttsProvider: TtsProvider;
  cartesiaApiKey: string;
  cartesiaVoiceId: string;
  ttsSpeed: number;
  ttsVolume: number;
  outputToGlasses: boolean;

  // Privacy
  privacyMode: boolean;

  // Onboarding
  onboardingComplete: boolean;

  // Debug
  debugMode: boolean;
}

export interface SettingsActions {
  // Backend
  setBackendUrl: (url: string) => void;
  setAuthToken: (token: string) => void;

  // Glasses
  setProviderType: (type: 'meta-dat' | 'ble-plx' | 'mock') => void;
  setAutoConnect: (enabled: boolean) => void;
  setLastDeviceId: (id: string | null) => void;

  // Camera
  setCaptureMode: (mode: CaptureMode) => void;
  setCaptureFps: (fps: number) => void;
  setCaptureQuality: (quality: number) => void;
  setAutoSnapInterval: (seconds: number) => void;
  setAdaptiveQuality: (enabled: boolean) => void;

  // Voice
  setWakeWord: (word: string) => void;
  setWakeWordEnabled: (enabled: boolean) => void;
  setDeepgramApiKey: (key: string) => void;
  setVoiceLanguage: (lang: string) => void;

  // TTS
  setTtsProvider: (provider: TtsProvider) => void;
  setCartesiaApiKey: (key: string) => void;
  setCartesiaVoiceId: (id: string) => void;
  setTtsSpeed: (speed: number) => void;
  setTtsVolume: (volume: number) => void;
  setOutputToGlasses: (enabled: boolean) => void;

  // Privacy
  setPrivacyMode: (enabled: boolean) => void;

  // Onboarding
  setOnboardingComplete: (complete: boolean) => void;

  // Debug
  setDebugMode: (enabled: boolean) => void;

  // Reset
  resetToDefaults: () => void;
}

// ─── Default State ──────────────────────────────────────────────

const defaultState: SettingsState = {
  backendUrl: DEFAULT_BACKEND_URL,
  authToken: '',
  providerType: 'mock',
  autoConnect: true,
  lastDeviceId: null,
  captureMode: 'manual',
  captureFps: DEFAULT_CAPTURE_FPS,
  captureQuality: DEFAULT_CAPTURE_QUALITY,
  autoSnapIntervalSec: 3,
  adaptiveQuality: true,
  wakeWord: DEFAULT_WAKE_WORD,
  wakeWordEnabled: true,
  deepgramApiKey: '',
  voiceLanguage: 'en-US',
  ttsProvider: 'cartesia',
  cartesiaApiKey: '',
  cartesiaVoiceId: CARTESIA_VOICE_ID,
  ttsSpeed: DEFAULT_TTS_SPEED,
  ttsVolume: DEFAULT_TTS_VOLUME,
  outputToGlasses: true,
  privacyMode: false,
  onboardingComplete: false,
  debugMode: false,
};

// ─── Load persisted state ───────────────────────────────────────

function loadPersistedState(): Partial<SettingsState> {
  try {
    const json = storage.getString(STORAGE_KEYS.SETTINGS);
    if (json) {
      return JSON.parse(json);
    }
  } catch {
    console.warn('[Settings] Failed to load persisted settings');
  }
  return {};
}

function persistState(state: SettingsState): void {
  try {
    storage.set(STORAGE_KEYS.SETTINGS, JSON.stringify(state));
  } catch {
    console.warn('[Settings] Failed to persist settings');
  }
}

// ─── Store ──────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState & SettingsActions>(
  (set, get) => {
    // Helper that sets state and persists
    const setAndPersist = (partial: Partial<SettingsState>) => {
      set(partial);
      persistState({ ...get(), ...partial } as SettingsState);
    };

    return {
      ...defaultState,
      ...loadPersistedState(),

      // Backend
      setBackendUrl: (backendUrl) => setAndPersist({ backendUrl }),
      setAuthToken: (authToken) => setAndPersist({ authToken }),

      // Glasses
      setProviderType: (providerType) => setAndPersist({ providerType }),
      setAutoConnect: (autoConnect) => setAndPersist({ autoConnect }),
      setLastDeviceId: (lastDeviceId) => setAndPersist({ lastDeviceId }),

      // Camera
      setCaptureMode: (captureMode) => setAndPersist({ captureMode }),
      setCaptureFps: (captureFps) => setAndPersist({ captureFps }),
      setCaptureQuality: (captureQuality) => setAndPersist({ captureQuality }),
      setAutoSnapInterval: (autoSnapIntervalSec) => setAndPersist({ autoSnapIntervalSec }),
      setAdaptiveQuality: (adaptiveQuality) => setAndPersist({ adaptiveQuality }),

      // Voice
      setWakeWord: (wakeWord) => setAndPersist({ wakeWord }),
      setWakeWordEnabled: (wakeWordEnabled) => setAndPersist({ wakeWordEnabled }),
      setDeepgramApiKey: (deepgramApiKey) => setAndPersist({ deepgramApiKey }),
      setVoiceLanguage: (voiceLanguage) => setAndPersist({ voiceLanguage }),

      // TTS
      setTtsProvider: (ttsProvider) => setAndPersist({ ttsProvider }),
      setCartesiaApiKey: (cartesiaApiKey) => setAndPersist({ cartesiaApiKey }),
      setCartesiaVoiceId: (cartesiaVoiceId) => setAndPersist({ cartesiaVoiceId }),
      setTtsSpeed: (ttsSpeed) => setAndPersist({ ttsSpeed }),
      setTtsVolume: (ttsVolume) => setAndPersist({ ttsVolume }),
      setOutputToGlasses: (outputToGlasses) => setAndPersist({ outputToGlasses }),

      // Privacy
      setPrivacyMode: (privacyMode) => setAndPersist({ privacyMode }),

      // Onboarding
      setOnboardingComplete: (onboardingComplete) => setAndPersist({ onboardingComplete }),

      // Debug
      setDebugMode: (debugMode) => setAndPersist({ debugMode }),

      // Reset
      resetToDefaults: () => {
        set(defaultState);
        persistState(defaultState);
      },
    };
  },
);
