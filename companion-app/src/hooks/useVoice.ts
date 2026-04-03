/**
 * useVoice Hook
 *
 * Bridges the VoicePipelineService to React components.
 *
 * Provides:
 * - Voice pipeline state
 * - Manual listen trigger
 * - Interrupt control
 * - Current transcript
 */

import { useCallback, useEffect, useRef } from 'react';
import { VoicePipelineService } from '../services/voice-pipeline';
import { getGlassesService } from './useGlasses';
import { useConnectionStore } from '../stores/connection-store';
import { useSettingsStore } from '../stores/settings-store';

// ─── Singleton Service ──────────────────────────────────────────

let voiceService: VoicePipelineService | null = null;

export function getVoiceService(): VoicePipelineService {
  if (!voiceService) {
    const settings = useSettingsStore.getState();
    voiceService = new VoicePipelineService(getGlassesService(), {
      wakeWord: settings.wakeWord,
      wakeWordEnabled: settings.wakeWordEnabled,
      deepgramApiKey: settings.deepgramApiKey,
      language: settings.voiceLanguage,
    });
  }
  return voiceService;
}

// ─── Hook ───────────────────────────────────────────────────────

export function useVoice() {
  const store = useConnectionStore();
  const settings = useSettingsStore();
  const initializedRef = useRef(false);

  // Initialize voice pipeline (ensure service is created)
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Ensure the voice service singleton is created.
    // Callbacks are wired in useAgents hook as the single source of truth
    // to avoid overwriting when both hooks initialize.
    getVoiceService();
  }, []);

  // Sync settings changes to voice service
  useEffect(() => {
    const voice = getVoiceService();
    voice.updateConfig({
      wakeWord: settings.wakeWord,
      wakeWordEnabled: settings.wakeWordEnabled,
      deepgramApiKey: settings.deepgramApiKey,
      language: settings.voiceLanguage,
    });
  }, [
    settings.wakeWord,
    settings.wakeWordEnabled,
    settings.deepgramApiKey,
    settings.voiceLanguage,
  ]);

  // ─── Actions ────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    try {
      await getVoiceService().start();
    } catch (error) {
      store.setError(
        error instanceof Error ? error.message : 'Failed to start voice pipeline',
      );
    }
  }, []);

  const stopListening = useCallback(async () => {
    await getVoiceService().stop();
  }, []);

  const triggerManualListen = useCallback(async () => {
    try {
      await getVoiceService().triggerListening();
    } catch (error) {
      store.setError(
        error instanceof Error ? error.message : 'Failed to trigger listening',
      );
    }
  }, []);

  const interrupt = useCallback(() => {
    getVoiceService().interrupt();
  }, []);

  return {
    // State
    voiceState: store.voiceState,
    isListening: store.isListening,
    interimTranscript: store.interimTranscript,

    // Actions
    startListening,
    stopListening,
    triggerManualListen,
    interrupt,
  };
}
