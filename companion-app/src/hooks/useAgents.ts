/**
 * useAgents Hook
 *
 * Bridges the BackendClientService to React components for agent management.
 *
 * Provides:
 * - Agent list with enable/disable
 * - Agent response feed
 * - Backend connection management
 * - Voice command results
 * - TTS playback integration
 */

import { useCallback, useEffect, useRef } from 'react';
import { BackendClientService } from '../services/backend-client';
import { TtsEngineService } from '../services/tts-engine';
import { getGlassesService, getCaptureService } from './useGlasses';
import { getVoiceService } from './useVoice';
import { useAgentStore } from '../stores/agent-store';
import { useConnectionStore } from '../stores/connection-store';
import { useSettingsStore } from '../stores/settings-store';

// ─── Singleton Services ─────────────────────────────────────────

let backendService: BackendClientService | null = null;
let ttsService: TtsEngineService | null = null;

export function getBackendService(): BackendClientService {
  if (!backendService) {
    const settings = useSettingsStore.getState();
    backendService = new BackendClientService({
      baseUrl: settings.backendUrl,
      wsUrl: settings.backendUrl.replace(/^http/, 'ws'),
      authToken: settings.authToken || undefined,
    });
  }
  return backendService;
}

export function getTtsService(): TtsEngineService {
  if (!ttsService) {
    const settings = useSettingsStore.getState();
    ttsService = new TtsEngineService(getGlassesService(), {
      provider: settings.ttsProvider,
      cartesiaApiKey: settings.cartesiaApiKey,
      voiceId: settings.cartesiaVoiceId,
      speed: settings.ttsSpeed,
      volume: settings.ttsVolume,
      outputToGlasses: settings.outputToGlasses,
    });
  }
  return ttsService;
}

// ─── Hook ───────────────────────────────────────────────────────

export function useAgents() {
  const agentStore = useAgentStore();
  const connStore = useConnectionStore();
  const settings = useSettingsStore();
  const initializedRef = useRef(false);

  // Initialize backend client and TTS
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const backend = getBackendService();
    const tts = getTtsService();
    const capture = getCaptureService();

    // Wire backend events
    backend.setCallbacks({
      onConnectionChange: (connected) => {
        connStore.setBackendConnected(connected);
      },

      onAgentResponse: (response) => {
        agentStore.addResponse(response);
        agentStore.setProcessing(false);

        // Auto-speak voice responses via TTS
        if (response.voiceResponse && response.handled) {
          tts.speak(response.voiceResponse, response.agentId, response.priority);
          agentStore.markResponseSpoken(response.agentId);
        }
      },

      onRoutingDecision: (decision) => {
        agentStore.setRoutingDecision(decision);
        agentStore.setProcessing(true, decision.agents[0]?.id ?? null);
      },

      onVoiceCommandResult: (command) => {
        agentStore.setVoiceCommand(command);
      },

      onTtsAudio: (audioData, format, agentId) => {
        // Audio comes pre-rendered from backend — play directly
        const glasses = getGlassesService();
        if (glasses.isConnected) {
          glasses.playAudio(audioData, format as 'pcm16' | 'opus' | 'aac');
        }
      },

      onSessionUpdate: (data) => {
        // Forward session updates for the dashboard view
        console.log('[useAgents] Session update:', data);
      },

      onError: (error) => {
        connStore.setError(error.message);
      },
    });

    // Wire capture → backend: send frames to backend as they're captured
    capture.setCallbacks({
      onFrameCaptured: (frame) => {
        connStore.setLastFrameTimestamp(frame.frame.timestamp);

        // Send frame to backend
        if (backend.isConnected) {
          backend.sendFrame(frame);
          capture.markFrameSent(frame.id);
        }
      },
      onStatsUpdate: (stats) => {
        connStore.setCaptureStats(stats);
      },
      onError: (error) => {
        connStore.setError(error.message);
      },
    });

    // Wire voice → backend: send voice commands to backend
    const voice = getVoiceService();
    voice.setCallbacks({
      onStateChange: (state) => {
        connStore.setVoiceState(state);
      },
      onWakeWord: () => {
        console.log('[useAgents] Wake word detected');
      },
      onInterimTranscript: (text) => {
        connStore.setInterimTranscript(text);
      },
      onFinalTranscript: (result) => {
        connStore.setInterimTranscript(result.text);
      },
      onCommandRouted: (command, _intent) => {
        backend.sendVoiceCommand(command);
      },
      onInterrupt: () => {
        connStore.setInterimTranscript('');
      },
      onError: (error) => {
        connStore.setError(error.message);
      },
    });

    // Auto-connect to backend
    backend.connectWs().catch((err) => {
      console.warn('[useAgents] Backend WS connect failed:', err.message);
    });

    // Auto-start voice pipeline after glasses have time to connect
    // Enables "Hey Siberius" wake word detection immediately on app open
    setTimeout(() => {
      const voice = getVoiceService();
      voice.start().catch((err: Error) => {
        console.warn('[useAgents] Voice auto-start failed (mic permission may be needed):', err.message);
      });
    }, 3000);

    // Load agent list from backend
    backend.getAgents().then(({ agents }) => {
      if (agents?.length > 0) {
        agentStore.setAgents(agents);
      }
    }).catch(() => {
      // Use default agents if backend is unreachable
      console.log('[useAgents] Using default agent list');
    });
  }, []);

  // Sync settings changes to services
  useEffect(() => {
    const backend = getBackendService();
    backend.updateConfig({
      baseUrl: settings.backendUrl,
      wsUrl: settings.backendUrl.replace(/^http/, 'ws'),
      authToken: settings.authToken || undefined,
    });
  }, [settings.backendUrl, settings.authToken]);

  useEffect(() => {
    const tts = getTtsService();
    tts.updateConfig({
      provider: settings.ttsProvider,
      cartesiaApiKey: settings.cartesiaApiKey,
      voiceId: settings.cartesiaVoiceId,
      speed: settings.ttsSpeed,
      volume: settings.ttsVolume,
      outputToGlasses: settings.outputToGlasses,
    });
  }, [
    settings.ttsProvider,
    settings.cartesiaApiKey,
    settings.cartesiaVoiceId,
    settings.ttsSpeed,
    settings.ttsVolume,
    settings.outputToGlasses,
  ]);

  // ─── Actions ────────────────────────────────────────────────

  const toggleAgent = useCallback(async (agentId: string) => {
    const agent = agentStore.agents.find((a) => a.id === agentId);
    if (!agent) return;

    const newEnabled = !agent.enabled;
    agentStore.setAgentEnabled(agentId, newEnabled);

    // Sync to backend
    try {
      await getBackendService().setAgentEnabled(agentId, newEnabled);
    } catch {
      // Revert on failure
      agentStore.setAgentEnabled(agentId, !newEnabled);
    }
  }, [agentStore.agents]);

  const sendVoiceCommand = useCallback((text: string) => {
    getBackendService().sendVoiceCommand(text);
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const health = await getBackendService().getHealth();
      return health;
    } catch (error) {
      connStore.setError(
        error instanceof Error ? error.message : 'Backend unreachable',
      );
      return null;
    }
  }, []);

  const connectBackend = useCallback(async () => {
    try {
      await getBackendService().connectWs();
    } catch (error) {
      connStore.setError(
        error instanceof Error ? error.message : 'Failed to connect to backend',
      );
    }
  }, []);

  const stopTts = useCallback(() => {
    getTtsService().stopAll();
  }, []);

  return {
    // State
    agents: agentStore.agents,
    currentMode: agentStore.currentMode,
    responses: agentStore.responses.filter((r) => !r.dismissed),
    lastVoiceCommand: agentStore.lastVoiceCommand,
    isProcessing: agentStore.isProcessing,
    processingAgentId: agentStore.processingAgentId,
    backendConnected: connStore.backendConnected,

    // Actions
    toggleAgent,
    sendVoiceCommand,
    checkHealth,
    connectBackend,
    stopTts,
    clearResponses: agentStore.clearResponses,
    dismissResponse: agentStore.dismissResponse,
  };
}
