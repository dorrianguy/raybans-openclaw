/**
 * Audio utilities for the Ray-Bans Companion App.
 *
 * Handles audio format conversion, level metering, and
 * buffer management for the voice pipeline.
 */

import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

// ─── Audio Session Setup ────────────────────────────────────────

/**
 * Configure the audio session for BLE headset communication.
 * Must be called once at app startup.
 */
export async function configureAudioSession(): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
}

// ─── Audio Buffer Utilities ─────────────────────────────────────

/**
 * Convert a base64-encoded audio string to a Float32Array of PCM samples.
 */
export function base64ToPcmFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // Assume 16-bit PCM LE
  const samples = new Float32Array(bytes.length / 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}

/**
 * Calculate RMS level from PCM samples (0-1 range).
 */
export function calculateRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Simple voice activity detection based on RMS threshold.
 */
export function detectVoiceActivity(
  samples: Float32Array,
  threshold = 0.02,
): boolean {
  return calculateRmsLevel(samples) > threshold;
}

// ─── Chunking ───────────────────────────────────────────────────

/**
 * Split an audio buffer into chunks for streaming.
 */
export function chunkAudioBuffer(
  buffer: ArrayBuffer,
  chunkSize: number,
): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < buffer.byteLength; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, buffer.byteLength);
    chunks.push(buffer.slice(offset, end));
  }
  return chunks;
}

/**
 * Convert ArrayBuffer to base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Generate a silent audio buffer of given duration.
 * Used for padding or testing.
 */
export function generateSilence(
  durationMs: number,
  sampleRate: number = 16000,
): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  return new Float32Array(numSamples);
}

// ─── Format Detection ───────────────────────────────────────────

export type AudioFormat = 'pcm16' | 'opus' | 'aac' | 'mp3' | 'wav' | 'unknown';

/**
 * Detect audio format from buffer header bytes.
 */
export function detectAudioFormat(buffer: ArrayBuffer): AudioFormat {
  const view = new DataView(buffer);

  if (buffer.byteLength < 4) return 'unknown';

  // WAV: starts with "RIFF"
  if (
    view.getUint8(0) === 0x52 &&
    view.getUint8(1) === 0x49 &&
    view.getUint8(2) === 0x46 &&
    view.getUint8(3) === 0x46
  ) {
    return 'wav';
  }

  // MP3: starts with 0xFF 0xFB or ID3
  if (
    (view.getUint8(0) === 0xff && (view.getUint8(1) & 0xe0) === 0xe0) ||
    (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33)
  ) {
    return 'mp3';
  }

  // OGG/Opus: starts with "OggS"
  if (
    view.getUint8(0) === 0x4f &&
    view.getUint8(1) === 0x67 &&
    view.getUint8(2) === 0x67 &&
    view.getUint8(3) === 0x53
  ) {
    return 'opus';
  }

  return 'unknown';
}
