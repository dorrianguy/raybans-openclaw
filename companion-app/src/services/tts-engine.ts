/**
 * TTS Engine Service
 *
 * Converts agent text responses to speech for playback through glasses speakers.
 *
 * Supports:
 * - Cartesia Sonic (primary, high-quality streaming TTS)
 * - System TTS (fallback, expo-speech)
 * - Priority queue (security alerts interrupt everything)
 * - Configurable voice, speed, and volume
 */

import type { GlassesConnectionService } from './glasses-connection';
import { arrayBufferToBase64 } from '../utils/audio';
import {
  CARTESIA_MODEL,
  CARTESIA_VOICE_ID,
  DEFAULT_TTS_SPEED,
  DEFAULT_TTS_VOLUME,
} from '../utils/constants';

// ─── Types ──────────────────────────────────────────────────────

export type TtsProvider = 'cartesia' | 'system';

export interface TtsConfig {
  /** TTS provider */
  provider: TtsProvider;
  /** Cartesia API key */
  cartesiaApiKey: string;
  /** Cartesia model */
  cartesiaModel: string;
  /** Voice ID for Cartesia */
  voiceId: string;
  /** Speech speed (0.5-2.0) */
  speed: number;
  /** Volume (0-1) */
  volume: number;
  /** Language */
  language: string;
  /** Enable audio output through glasses speakers (vs phone speaker) */
  outputToGlasses: boolean;
}

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  provider: 'cartesia',
  cartesiaApiKey: '',
  cartesiaModel: CARTESIA_MODEL,
  voiceId: CARTESIA_VOICE_ID,
  speed: DEFAULT_TTS_SPEED,
  volume: DEFAULT_TTS_VOLUME,
  language: 'en',
  outputToGlasses: true,
};

export interface TtsQueueItem {
  /** Unique ID for this speech item */
  id: string;
  /** Text to speak */
  text: string;
  /** Priority (1 = highest, 10 = lowest) */
  priority: number;
  /** Agent that generated this response */
  agentId: string;
  /** Timestamp queued */
  queuedAt: number;
}

// ─── TTS Callbacks ──────────────────────────────────────────────

export interface TtsCallbacks {
  /** Speech started */
  onSpeechStart?: (item: TtsQueueItem) => void;
  /** Speech completed */
  onSpeechEnd?: (item: TtsQueueItem) => void;
  /** Speech interrupted by higher-priority item */
  onSpeechInterrupted?: (item: TtsQueueItem, by: TtsQueueItem) => void;
  /** Queue changed */
  onQueueUpdate?: (queueSize: number) => void;
  /** Error */
  onError?: (error: Error) => void;
}

// ─── TTS Engine Service ─────────────────────────────────────────

export class TtsEngineService {
  private glasses: GlassesConnectionService;
  private config: TtsConfig;
  private callbacks: TtsCallbacks = {};

  private queue: TtsQueueItem[] = [];
  private currentItem: TtsQueueItem | null = null;
  private isSpeaking = false;
  private itemCounter = 0;

  constructor(
    glasses: GlassesConnectionService,
    config: Partial<TtsConfig> = {},
  ) {
    this.glasses = glasses;
    this.config = { ...DEFAULT_TTS_CONFIG, ...config };
  }

  // ─── Public API ───────────────────────────────────────────

  get speaking(): boolean {
    return this.isSpeaking;
  }

  get queueSize(): number {
    return this.queue.length;
  }

  /** Set event callbacks */
  setCallbacks(callbacks: TtsCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Update configuration */
  updateConfig(config: Partial<TtsConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Speak text with priority.
   * Higher priority (lower number) interrupts lower priority speech.
   * Security alerts use priority 1.
   */
  async speak(text: string, agentId: string, priority = 5): Promise<void> {
    if (!text.trim()) return;

    const item: TtsQueueItem = {
      id: `tts-${++this.itemCounter}`,
      text: text.trim(),
      priority,
      agentId,
      queuedAt: Date.now(),
    };

    // Check if this should interrupt current speech
    if (this.isSpeaking && this.currentItem && priority < this.currentItem.priority) {
      console.log(`[TTS] Interrupting (priority ${this.currentItem.priority} → ${priority})`);
      this.callbacks.onSpeechInterrupted?.(this.currentItem, item);
      await this.stopCurrent();
      // Put the interrupted item back in queue if it was less than half done
      // (simplified — we re-queue it at its original priority)
      this.queue.unshift(this.currentItem);
    }

    // Insert into priority queue
    this.insertIntoQueue(item);
    this.callbacks.onQueueUpdate?.(this.queue.length);

    // Start processing if not already speaking
    if (!this.isSpeaking) {
      this.processQueue();
    }
  }

  /** Stop current speech and clear queue */
  async stopAll(): Promise<void> {
    this.queue = [];
    await this.stopCurrent();
    this.callbacks.onQueueUpdate?.(0);
  }

  /** Stop current speech only (continue with queue) */
  async stopCurrent(): Promise<void> {
    if (!this.isSpeaking) return;

    this.isSpeaking = false;
    try {
      await this.glasses.stopAudio();
    } catch {
      // Ignore stop errors
    }

    if (this.currentItem) {
      this.callbacks.onSpeechEnd?.(this.currentItem);
      this.currentItem = null;
    }
  }

  /** Skip to next item in queue */
  async skip(): Promise<void> {
    await this.stopCurrent();
    this.processQueue();
  }

  /** Clean up resources */
  dispose(): void {
    this.stopAll();
  }

  // ─── Private ──────────────────────────────────────────────

  private insertIntoQueue(item: TtsQueueItem): void {
    // Insert sorted by priority (lower number = higher priority)
    const idx = this.queue.findIndex((q) => q.priority > item.priority);
    if (idx === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(idx, 0, item);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isSpeaking || this.queue.length === 0) return;

    const item = this.queue.shift()!;
    this.currentItem = item;
    this.isSpeaking = true;
    this.callbacks.onSpeechStart?.(item);
    this.callbacks.onQueueUpdate?.(this.queue.length);

    try {
      if (this.config.provider === 'cartesia' && this.config.cartesiaApiKey) {
        await this.speakCartesia(item);
      } else {
        await this.speakSystem(item);
      }
    } catch (error) {
      console.error('[TTS] Error:', error);
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      this.isSpeaking = false;
      this.callbacks.onSpeechEnd?.(item);
      this.currentItem = null;

      // Process next item
      if (this.queue.length > 0) {
        // Small delay between items
        setTimeout(() => this.processQueue(), 200);
      }
    }
  }

  /**
   * Speak using Cartesia Sonic streaming TTS.
   * Sends the resulting audio to glasses speakers.
   */
  private async speakCartesia(item: TtsQueueItem): Promise<void> {
    if (!this.config.cartesiaApiKey) {
      throw new Error('Cartesia API key not configured');
    }

    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'X-API-Key': this.config.cartesiaApiKey,
        'Cartesia-Version': '2024-06-10',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: this.config.cartesiaModel,
        transcript: item.text,
        voice: {
          mode: 'id',
          id: this.config.voiceId,
        },
        output_format: {
          container: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: 24000,
        },
        language: this.config.language,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Cartesia TTS failed: ${response.status} ${body}`);
    }

    const audioBuffer = await response.arrayBuffer();

    if (!this.isSpeaking) return; // Interrupted while waiting

    // Send audio to glasses speakers
    if (this.config.outputToGlasses && this.glasses.isConnected) {
      const base64Audio = arrayBufferToBase64(audioBuffer);
      await this.glasses.playAudio(base64Audio, 'pcm16');
    } else {
      // Fallback: play through phone speaker using expo-av
      await this.playThroughPhone(audioBuffer);
    }
  }

  /**
   * Speak using system TTS (expo-speech).
   * Fallback when Cartesia is not configured.
   */
  private async speakSystem(item: TtsQueueItem): Promise<void> {
    // Use expo-speech for system TTS
    // Note: This doesn't route through glasses speakers —
    // it plays through the phone's default audio output.
    // If the glasses are connected as a BLE audio device,
    // the phone's audio may route there automatically.
    let Speech: typeof import('expo-speech');
    try {
      Speech = await import('expo-speech');
    } catch {
      throw new Error('expo-speech not available');
    }

    return new Promise<void>((resolve, reject) => {
      Speech.speak(item.text, {
        rate: this.config.speed,
        language: this.config.language,
        onDone: resolve,
        onError: (error: { message: string }) => reject(new Error(`System TTS error: ${error.message}`)),
        onStopped: resolve,
      });
    });
  }

  /**
   * Play audio buffer through phone speaker using expo-av.
   * Creates a WAV file in memory and plays it.
   */
  private async playThroughPhone(audioBuffer: ArrayBuffer): Promise<void> {
    try {
      const { Audio } = await import('expo-av');

      // Create WAV header for PCM16 data
      const wavBuffer = this.createWavBuffer(audioBuffer, 24000, 1, 16);
      const base64Wav = arrayBufferToBase64(wavBuffer);
      const uri = `data:audio/wav;base64,${base64Wav}`;

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, volume: this.config.volume },
      );

      // Wait for playback to complete
      return new Promise<void>((resolve) => {
        sound.setOnPlaybackStatusUpdate((status) => {
          if ('didJustFinish' in status && status.didJustFinish) {
            sound.unloadAsync().catch(() => {});
            resolve();
          }
        });
      });
    } catch (error) {
      console.warn('[TTS] Phone speaker playback failed:', error);
      // Fall back to system TTS
      if (this.currentItem) {
        await this.speakSystem(this.currentItem);
      }
    }
  }

  /**
   * Create a WAV file buffer from raw PCM data.
   */
  private createWavBuffer(
    pcmData: ArrayBuffer,
    sampleRate: number,
    channels: number,
    bitsPerSample: number,
  ): ArrayBuffer {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcmData.byteLength;
    const headerSize = 44;
    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);

    // RIFF header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // sub-chunk size
    view.setUint16(20, 1, true);  // PCM format
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Copy PCM data
    const pcmBytes = new Uint8Array(pcmData);
    const wavBytes = new Uint8Array(buffer);
    wavBytes.set(pcmBytes, headerSize);

    return buffer;
  }

  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
}
