/**
 * Voice Pipeline Service
 *
 * End-to-end voice processing pipeline:
 *   Glasses Mics → Wake Word Detection → STT (Deepgram) → Command Router → Agent → TTS → Glasses Speakers
 *
 * Components:
 * - Wake word detection (local, on-phone): "Hey Siberius" or configurable
 * - Speech-to-text: Deepgram Nova-3 streaming API
 * - Command routing: sends parsed text to backend VoiceCommandRouter
 * - Interrupt handling: "stop", "cancel" interrupts current audio
 */

import type { GlassesConnectionService, AudioChunk } from './glasses-connection';
import {
  DEFAULT_WAKE_WORD,
  VOICE_SILENCE_TIMEOUT_MS,
  VOICE_MAX_DURATION_MS,
  VOICE_SAMPLE_RATE,
  DEEPGRAM_MODEL,
  DEEPGRAM_LANGUAGE,
} from '../utils/constants';

// ─── Types ──────────────────────────────────────────────────────

export type VoicePipelineState =
  | 'idle'           // Waiting for wake word
  | 'listening'      // Wake word detected, capturing speech
  | 'processing'     // STT processing + command routing
  | 'responding'     // Agent response being spoken
  | 'error'          // Error state
  | 'disabled';      // Pipeline disabled (privacy mode)

export interface VoicePipelineConfig {
  /** Wake word phrase (case insensitive) */
  wakeWord: string;
  /** Enable wake word (false = always listening) */
  wakeWordEnabled: boolean;
  /** Deepgram API key */
  deepgramApiKey: string;
  /** Deepgram model */
  deepgramModel: string;
  /** Language for STT */
  language: string;
  /** Silence timeout (ms) — stop listening after this much silence */
  silenceTimeoutMs: number;
  /** Maximum recording duration (ms) */
  maxDurationMs: number;
  /** Audio sample rate */
  sampleRate: number;
  /** Enable interrupt words ("stop", "cancel", "nevermind") */
  interruptEnabled: boolean;
  /** Words that trigger interrupt */
  interruptWords: string[];
}

export const DEFAULT_VOICE_CONFIG: VoicePipelineConfig = {
  wakeWord: DEFAULT_WAKE_WORD,
  wakeWordEnabled: true,
  deepgramApiKey: '', // Set from settings
  deepgramModel: DEEPGRAM_MODEL,
  language: DEEPGRAM_LANGUAGE,
  silenceTimeoutMs: VOICE_SILENCE_TIMEOUT_MS,
  maxDurationMs: VOICE_MAX_DURATION_MS,
  sampleRate: VOICE_SAMPLE_RATE,
  interruptEnabled: true,
  interruptWords: ['stop', 'cancel', 'nevermind', 'never mind', 'shut up', 'quiet'],
};

export interface TranscriptionResult {
  /** Final transcribed text */
  text: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Transcription duration in ms */
  durationMs: number;
  /** Whether this is a final or interim result */
  isFinal: boolean;
  /** Individual word timestamps */
  words?: Array<{ word: string; start: number; end: number; confidence: number }>;
}

// ─── Voice Pipeline Callbacks ───────────────────────────────────

export interface VoicePipelineCallbacks {
  /** Pipeline state changed */
  onStateChange?: (state: VoicePipelineState) => void;
  /** Wake word detected */
  onWakeWord?: () => void;
  /** Interim transcription result (partial, updating) */
  onInterimTranscript?: (text: string) => void;
  /** Final transcription result */
  onFinalTranscript?: (result: TranscriptionResult) => void;
  /** Voice command parsed and being routed */
  onCommandRouted?: (command: string, intent: string) => void;
  /** Interrupt detected */
  onInterrupt?: () => void;
  /** Audio level update (for visualization) */
  onAudioLevel?: (level: number) => void;
  /** Error */
  onError?: (error: Error) => void;
}

// ─── Deepgram Types ─────────────────────────────────────────────

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words?: DeepgramWord[];
}

interface DeepgramResponse {
  type: string;
  channel?: {
    alternatives: DeepgramAlternative[];
  };
  duration?: number;
  is_final?: boolean;
}

// ─── Deepgram WebSocket Client ──────────────────────────────────

class DeepgramStreamingClient {
  private ws: WebSocket | null = null;
  private config: VoicePipelineConfig;
  private onTranscript: (result: TranscriptionResult) => void;
  private onError: (error: Error) => void;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: VoicePipelineConfig,
    onTranscript: (result: TranscriptionResult) => void,
    onError: (error: Error) => void,
  ) {
    this.config = config;
    this.onTranscript = onTranscript;
    this.onError = onError;
  }

  async connect(): Promise<void> {
    if (!this.config.deepgramApiKey) {
      throw new Error('Deepgram API key not configured');
    }

    const url =
      `wss://api.deepgram.com/v1/listen?` +
      `model=${this.config.deepgramModel}&` +
      `language=${this.config.language}&` +
      `encoding=linear16&` +
      `sample_rate=${this.config.sampleRate}&` +
      `channels=1&` +
      `interim_results=true&` +
      `utterance_end_ms=${this.config.silenceTimeoutMs}&` +
      `vad_events=true&` +
      `smart_format=true&` +
      `punctuate=true`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, ['token', this.config.deepgramApiKey]);

      this.ws.onopen = () => {
        console.log('[Deepgram] Connected');
        // Send keep-alive every 10 seconds
        this.keepAliveInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 10_000);
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          this.handleMessage(data);
        } catch {
          // Ignore parse errors
        }
      };

      this.ws.onerror = (event) => {
        const error = new Error('Deepgram WebSocket error');
        this.onError(error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('[Deepgram] Disconnected');
        this.clearKeepAlive();
      };
    });
  }

  sendAudio(base64Audio: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Convert base64 to binary and send
      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      this.ws.send(bytes.buffer);
    }
  }

  close(): void {
    this.clearKeepAlive();
    if (this.ws) {
      // Send close signal to Deepgram
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      }
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private handleMessage(data: DeepgramResponse): void {
    if (data.type === 'Results' && data.channel?.alternatives?.length > 0) {
      const alt = data.channel.alternatives[0];
      const result: TranscriptionResult = {
        text: alt.transcript || '',
        confidence: alt.confidence || 0,
        durationMs: (data.duration || 0) * 1000,
        isFinal: data.is_final || false,
        words: alt.words?.map((w: DeepgramWord) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
        })),
      };

      if (result.text.trim()) {
        this.onTranscript(result);
      }
    }

    if (data.type === 'UtteranceEnd') {
      // User stopped speaking — emit a final result signal
      this.onTranscript({
        text: '',
        confidence: 1,
        durationMs: 0,
        isFinal: true,
      });
    }
  }

  private clearKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }
}

// ─── Wake Word Detector ─────────────────────────────────────────

class WakeWordDetector {
  private wakeWord: string;
  private buffer: string = '';
  private detected = false;

  constructor(wakeWord: string) {
    this.wakeWord = wakeWord.toLowerCase();
  }

  /**
   * Feed a transcription chunk and check for wake word.
   * Returns true if wake word is detected.
   */
  feed(text: string): boolean {
    this.buffer += ' ' + text.toLowerCase();

    // Keep buffer from growing unbounded
    if (this.buffer.length > 500) {
      this.buffer = this.buffer.slice(-200);
    }

    if (this.buffer.includes(this.wakeWord)) {
      this.buffer = '';
      this.detected = true;
      return true;
    }

    return false;
  }

  reset(): void {
    this.buffer = '';
    this.detected = false;
  }

  updateWakeWord(word: string): void {
    this.wakeWord = word.toLowerCase();
    this.reset();
  }
}

// ─── Voice Pipeline Service ─────────────────────────────────────

export class VoicePipelineService {
  private glasses: GlassesConnectionService;
  private config: VoicePipelineConfig;
  private callbacks: VoicePipelineCallbacks = {};

  private state: VoicePipelineState = 'idle';
  private deepgram: DeepgramStreamingClient | null = null;
  private wakeWordDetector: WakeWordDetector;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private currentTranscript = '';
  private isActive = false;

  constructor(
    glasses: GlassesConnectionService,
    config: Partial<VoicePipelineConfig> = {},
  ) {
    this.glasses = glasses;
    this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
    this.wakeWordDetector = new WakeWordDetector(this.config.wakeWord);

    // Listen for audio chunks from glasses
    this.glasses.onAudioChunk = (chunk) => this.handleAudioChunk(chunk);
  }

  // ─── Public API ───────────────────────────────────────────

  get currentState(): VoicePipelineState {
    return this.state;
  }

  /** Set event callbacks */
  setCallbacks(callbacks: VoicePipelineCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Update configuration */
  updateConfig(config: Partial<VoicePipelineConfig>): void {
    this.config = { ...this.config, ...config };
    this.wakeWordDetector.updateWakeWord(this.config.wakeWord);
  }

  /** Start the voice pipeline (begin listening for wake word) */
  async start(): Promise<void> {
    if (this.isActive) return;

    try {
      // Start audio input from glasses
      await this.glasses.startAudioInput();
      this.isActive = true;
      this.setState('idle');
      console.log('[VoicePipeline] Started — listening for wake word');
    } catch (error) {
      this.setState('error');
      throw error;
    }
  }

  /** Stop the voice pipeline completely */
  async stop(): Promise<void> {
    this.isActive = false;
    this.clearTimers();
    this.deepgram?.close();
    this.deepgram = null;

    try {
      await this.glasses.stopAudioInput();
    } catch {
      // Ignore
    }

    this.setState('disabled');
    console.log('[VoicePipeline] Stopped');
  }

  /** Enable/disable the pipeline (for privacy mode) */
  setEnabled(enabled: boolean): void {
    if (enabled && !this.isActive) {
      this.start().catch(console.error);
    } else if (!enabled && this.isActive) {
      this.stop().catch(console.error);
    }
  }

  /** Manually trigger listening (skip wake word) */
  async triggerListening(): Promise<void> {
    if (!this.isActive) {
      await this.start();
    }
    this.startListening();
  }

  /** Interrupt current response/processing */
  interrupt(): void {
    if (this.state === 'responding') {
      this.glasses.stopAudio().catch(console.error);
    }

    this.clearTimers();
    this.deepgram?.close();
    this.deepgram = null;
    this.currentTranscript = '';
    this.setState('idle');
    this.callbacks.onInterrupt?.();
  }

  /** Clean up resources */
  dispose(): void {
    this.stop().catch(console.error);
  }

  // ─── Private ──────────────────────────────────────────────

  private handleAudioChunk(chunk: AudioChunk): void {
    if (!this.isActive) return;

    // Calculate audio level for visualization
    if (chunk.data) {
      // Simple level estimation from data length
      this.callbacks.onAudioLevel?.(chunk.data.length > 0 ? 0.3 : 0);
    }

    switch (this.state) {
      case 'idle':
        // In idle state, we're doing lightweight wake word detection.
        // We use a background STT to detect the wake word.
        this.feedWakeWordDetection(chunk);
        break;

      case 'listening':
        // In listening state, stream audio to Deepgram for full STT
        this.feedDeepgram(chunk);
        break;

      case 'processing':
      case 'responding':
        // Ignore audio while processing/responding (unless interrupt word)
        break;
    }
  }

  private feedWakeWordDetection(chunk: AudioChunk): void {
    // For MVP: We run a lightweight STT in background to detect wake word.
    // In production, this would be replaced with a local wake word engine
    // (like Porcupine or Snowboy) for privacy and efficiency.
    //
    // The basic approach: if wake word is disabled, go straight to listening.
    if (!this.config.wakeWordEnabled) {
      this.startListening();
      return;
    }

    // For now, we'll use a simplified approach:
    // Start Deepgram, but only look for the wake word in transcripts
    if (!this.deepgram) {
      this.startWakeWordStream();
    } else {
      this.deepgram.sendAudio(chunk.data);
    }
  }

  private async startWakeWordStream(): Promise<void> {
    try {
      this.deepgram = new DeepgramStreamingClient(
        this.config,
        (result) => {
          if (result.text && this.wakeWordDetector.feed(result.text)) {
            console.log('[VoicePipeline] Wake word detected!');
            this.callbacks.onWakeWord?.();
            // Close wake word stream and start full listening
            this.deepgram?.close();
            this.deepgram = null;
            this.startListening();
          }
        },
        (error) => {
          console.error('[VoicePipeline] Wake word STT error:', error);
        },
      );
      await this.deepgram.connect();
    } catch (error) {
      // If Deepgram fails (no API key, etc.), fall back to manual trigger only
      console.warn('[VoicePipeline] Wake word detection unavailable:', error);
    }
  }

  private async startListening(): Promise<void> {
    this.setState('listening');
    this.currentTranscript = '';
    this.wakeWordDetector.reset();

    // Start fresh Deepgram connection for command transcription
    try {
      this.deepgram?.close();
      this.deepgram = new DeepgramStreamingClient(
        this.config,
        (result) => this.handleTranscription(result),
        (error) => {
          this.callbacks.onError?.(error);
          this.setState('error');
          setTimeout(() => this.setState('idle'), 2000);
        },
      );
      await this.deepgram.connect();
    } catch (error) {
      if (!this.config.deepgramApiKey) {
        // No API key configured — voice is unavailable, not an error
        console.warn('[VoicePipeline] Voice unavailable: Deepgram API key not configured');
        this.setState('disabled');
        setTimeout(() => this.setState('idle'), 2000);
      } else {
        this.callbacks.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
        this.setState('error');
        setTimeout(() => this.setState('idle'), 3000);
      }
      return;
    }

    // Set max duration timer
    this.maxDurationTimer = setTimeout(() => {
      console.log('[VoicePipeline] Max duration reached');
      this.finishListening();
    }, this.config.maxDurationMs);

    // Start silence timer
    this.resetSilenceTimer();
  }

  private feedDeepgram(chunk: AudioChunk): void {
    if (this.deepgram) {
      this.deepgram.sendAudio(chunk.data);
      this.resetSilenceTimer();
    }
  }

  private handleTranscription(result: TranscriptionResult): void {
    if (!result.text) {
      if (result.isFinal) {
        this.finishListening();
      }
      return;
    }

    // Check for interrupt words
    if (this.config.interruptEnabled) {
      const lower = result.text.toLowerCase();
      const isInterrupt = this.config.interruptWords.some((w) => lower.includes(w));
      if (isInterrupt) {
        this.interrupt();
        return;
      }
    }

    if (result.isFinal) {
      this.currentTranscript += (this.currentTranscript ? ' ' : '') + result.text;
      this.callbacks.onFinalTranscript?.(result);
    } else {
      this.callbacks.onInterimTranscript?.(result.text);
    }
  }

  private finishListening(): void {
    this.clearTimers();
    this.deepgram?.close();
    this.deepgram = null;

    const transcript = this.currentTranscript.trim();
    this.currentTranscript = '';

    if (transcript) {
      this.setState('processing');
      this.callbacks.onCommandRouted?.(transcript, 'pending');
      // The backend client will handle sending this to VoiceCommandRouter
    } else {
      // No speech detected — go back to idle
      this.setState('idle');
    }
  }

  private setState(state: VoicePipelineState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onStateChange?.(state);
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }
    this.silenceTimer = setTimeout(() => {
      if (this.state === 'listening') {
        console.log('[VoicePipeline] Silence detected');
        this.finishListening();
      }
    }, this.config.silenceTimeoutMs);
  }

  private clearTimers(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }
}
