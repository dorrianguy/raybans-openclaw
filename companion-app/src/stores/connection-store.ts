/**
 * Connection Store — Manages glasses connection state with Zustand.
 *
 * Tracks:
 * - BLE connection state
 * - Connected device info
 * - Battery level and signal strength
 * - Camera streaming state
 * - Voice pipeline state
 */

import { create } from 'zustand';
import type {
  ConnectionState,
  GlassesDevice,
  GlassesStatus,
} from '../services/glasses-connection';
import type { VoicePipelineState } from '../services/voice-pipeline';
import type { CaptureStats } from '../services/camera-capture';

// ─── State ──────────────────────────────────────────────────────

export interface ConnectionStoreState {
  // Glasses connection
  connectionState: ConnectionState;
  device: GlassesDevice | null;
  status: GlassesStatus | null;
  discoveredDevices: GlassesDevice[];
  providerName: string;

  // Camera
  isStreaming: boolean;
  captureStats: CaptureStats | null;
  lastFrameTimestamp: string | null;

  // Voice
  voiceState: VoicePipelineState;
  interimTranscript: string;
  isListening: boolean;

  // Backend
  backendConnected: boolean;
  backendUrl: string;

  // Error tracking
  lastError: string | null;
  errorTimestamp: number | null;
}

export interface ConnectionStoreActions {
  // Glasses
  setConnectionState: (state: ConnectionState) => void;
  setDevice: (device: GlassesDevice | null) => void;
  setStatus: (status: GlassesStatus | null) => void;
  addDiscoveredDevice: (device: GlassesDevice) => void;
  clearDiscoveredDevices: () => void;
  setProviderName: (name: string) => void;

  // Camera
  setStreaming: (streaming: boolean) => void;
  setCaptureStats: (stats: CaptureStats) => void;
  setLastFrameTimestamp: (ts: string) => void;

  // Voice
  setVoiceState: (state: VoicePipelineState) => void;
  setInterimTranscript: (text: string) => void;
  setListening: (listening: boolean) => void;

  // Backend
  setBackendConnected: (connected: boolean) => void;
  setBackendUrl: (url: string) => void;

  // Error
  setError: (error: string | null) => void;
  clearError: () => void;

  // Reset
  reset: () => void;
}

// ─── Initial State ──────────────────────────────────────────────

const initialState: ConnectionStoreState = {
  connectionState: 'disconnected',
  device: null,
  status: null,
  discoveredDevices: [],
  providerName: 'mock',

  isStreaming: false,
  captureStats: null,
  lastFrameTimestamp: null,

  voiceState: 'idle',
  interimTranscript: '',
  isListening: false,

  backendConnected: false,
  backendUrl: 'http://localhost:3847',

  lastError: null,
  errorTimestamp: null,
};

// ─── Store ──────────────────────────────────────────────────────

export const useConnectionStore = create<ConnectionStoreState & ConnectionStoreActions>(
  (set) => ({
    ...initialState,

    setConnectionState: (connectionState) =>
      set({ connectionState, lastError: null }),

    setDevice: (device) => set({ device }),

    setStatus: (status) => set({ status }),

    addDiscoveredDevice: (device) =>
      set((state) => {
        const existing = state.discoveredDevices.findIndex((d) => d.id === device.id);
        if (existing >= 0) {
          const devices = [...state.discoveredDevices];
          devices[existing] = device;
          return { discoveredDevices: devices };
        }
        return { discoveredDevices: [...state.discoveredDevices, device] };
      }),

    clearDiscoveredDevices: () => set({ discoveredDevices: [] }),

    setProviderName: (providerName) => set({ providerName }),

    setStreaming: (isStreaming) => set({ isStreaming }),

    setCaptureStats: (captureStats) => set({ captureStats }),

    setLastFrameTimestamp: (lastFrameTimestamp) => set({ lastFrameTimestamp }),

    setVoiceState: (voiceState) =>
      set((state) => ({
        voiceState,
        isListening: voiceState === 'listening',
        ...(voiceState === 'idle' ? { interimTranscript: '' } : {}),
      })),

    setInterimTranscript: (interimTranscript) => set({ interimTranscript }),

    setListening: (isListening) => set({ isListening }),

    setBackendConnected: (backendConnected) => set({ backendConnected }),

    setBackendUrl: (backendUrl) => set({ backendUrl }),

    setError: (error) =>
      set({
        lastError: error,
        errorTimestamp: error ? Date.now() : null,
      }),

    clearError: () => set({ lastError: null, errorTimestamp: null }),

    reset: () => set(initialState),
  }),
);
