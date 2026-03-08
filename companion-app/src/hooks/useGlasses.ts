/**
 * useGlasses Hook
 *
 * Bridges the GlassesConnectionService and CameraCaptureService
 * to React components via the connection store.
 *
 * Provides a clean API for:
 * - Scanning for devices
 * - Connecting/disconnecting
 * - Capturing frames
 * - Monitoring connection state
 */

import { useCallback, useEffect, useRef } from 'react';
import { GlassesConnectionService } from '../services/glasses-connection';
import { CameraCaptureService } from '../services/camera-capture';
import { useConnectionStore } from '../stores/connection-store';
import { useSettingsStore } from '../stores/settings-store';

// ─── Singleton Services ─────────────────────────────────────────
// Services live outside React lifecycle — they persist across renders.

let glassesService: GlassesConnectionService | null = null;
let captureService: CameraCaptureService | null = null;

export function getGlassesService(): GlassesConnectionService {
  if (!glassesService) {
    const providerType = useSettingsStore.getState().providerType;
    glassesService = new GlassesConnectionService(providerType);
  }
  return glassesService;
}

export function getCaptureService(): CameraCaptureService {
  if (!captureService) {
    captureService = new CameraCaptureService(getGlassesService());
  }
  return captureService;
}

// ─── Hook ───────────────────────────────────────────────────────

export function useGlasses() {
  const store = useConnectionStore();
  const settings = useSettingsStore();
  const initializedRef = useRef(false);

  // Initialize services and wire up callbacks
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const glasses = getGlassesService();
    const capture = getCaptureService();

    // Wire glasses events to store
    glasses.onStateChange = (state) => {
      store.setConnectionState(state);
    };

    glasses.onDeviceDiscovered = (device) => {
      store.addDiscoveredDevice(device);
    };

    glasses.onConnected = (device) => {
      store.setDevice(device);
      store.setConnectionState('connected');
      settings.setLastDeviceId(device.id);
    };

    glasses.onDisconnected = (_reason) => {
      store.setDevice(null);
    };

    glasses.onStatusUpdate = (status) => {
      store.setStatus(status);
    };

    glasses.onError = (error) => {
      store.setError(error.message);
    };

    // Note: capture callbacks are wired in useAgents hook to avoid
    // overwriting when both hooks initialize. The useAgents hook
    // sets all capture + voice callbacks as the single source of truth.

    store.setProviderName(glasses.providerName);

    // Auto-connect on startup if enabled
    const { autoConnect, lastDeviceId, providerType } = useSettingsStore.getState();
    if (autoConnect) {
      glasses.scan().then((devices) => {
        if (devices.length > 0) {
          // Prefer last connected device, otherwise first found
          const target = devices.find((d) => d.id === lastDeviceId) ?? devices[0];
          return glasses.connect(target.id);
        }
      }).catch((err) => {
        console.warn('[useGlasses] Auto-connect failed:', err.message);
      });
    }

    return () => {
      // Don't dispose on unmount — services are singletons
    };
  }, []);

  // ─── Actions ────────────────────────────────────────────────

  const scan = useCallback(async () => {
    store.clearDiscoveredDevices();
    store.clearError();
    return getGlassesService().scan();
  }, []);

  const stopScan = useCallback(() => {
    getGlassesService().stopScan();
  }, []);

  const connect = useCallback(async (deviceId: string) => {
    store.clearError();
    return getGlassesService().connect(deviceId);
  }, []);

  const disconnect = useCallback(async () => {
    await getCaptureService().stopCapture();
    return getGlassesService().disconnect();
  }, []);

  const captureFrame = useCallback(async () => {
    return getCaptureService().captureSingle('manual');
  }, []);

  const startStreaming = useCallback(async () => {
    await getCaptureService().startCapture();
    store.setStreaming(true);
  }, []);

  const stopStreaming = useCallback(async () => {
    await getCaptureService().stopCapture();
    store.setStreaming(false);
  }, []);

  const refreshStatus = useCallback(async () => {
    const status = await getGlassesService().getStatus();
    if (status) store.setStatus(status);
  }, []);

  return {
    // State
    connectionState: store.connectionState,
    device: store.device,
    status: store.status,
    discoveredDevices: store.discoveredDevices,
    isConnected: store.connectionState === 'connected',
    isStreaming: store.isStreaming,
    captureStats: store.captureStats,
    lastFrameTimestamp: store.lastFrameTimestamp,
    error: store.lastError,
    providerName: store.providerName,

    // Actions
    scan,
    stopScan,
    connect,
    disconnect,
    captureFrame,
    startStreaming,
    stopStreaming,
    refreshStatus,
    clearError: store.clearError,
  };
}
