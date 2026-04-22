/**
 * Voice Pipeline Engine — Real-time STT → Intent → Agent Routing → TTS Response
 *
 * The full voice loop for Meta Ray-Ban smart glasses:
 * 1. Audio chunks arrive from glasses mic via Node Bridge
 * 2. STT (Deepgram/Whisper) transcribes to text
 * 3. Voice Command Router classifies intent
 * 4. Context Router dispatches to correct specialist agent
 * 5. Agent processes and returns response text
 * 6. TTS converts response to audio
 * 7. Audio delivered back to glasses speaker
 *
 * Features:
 * - Streaming STT with partial transcripts (low latency)
 * - Wake word detection ("Hey OpenClaw", "Hey glasses")
 * - Conversation context (multi-turn interactions)
 * - Priority interrupts (security alerts override everything)
 * - Noise gate / silence detection
 * - TTS queue with priority ordering
 * - Configurable STT/TTS providers
 * - Metrics tracking (latency, accuracy)
 *
 * @module voice/voice-pipeline
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export type STTProvider = 'deepgram' | 'whisper' | 'azure' | 'mock';
export type TTSProvider = 'elevenlabs' | 'openai' | 'azure' | 'mock';
export type PipelineState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';
export type WakeWordStatus = 'waiting' | 'detected' | 'disabled';

export interface VoicePipelineConfig {
  /** STT provider to use */
  sttProvider: STTProvider;
  /** TTS provider to use */
  ttsProvider: TTSProvider;
  /** STT API key */
  sttApiKey?: string;
  /** TTS API key */
  ttsApiKey?: string;
  /** STT language (BCP-47) */
  language: string;
  /** Whether wake word is required before processing */
  wakeWordEnabled: boolean;
  /** Custom wake words (defaults: "hey openclaw", "hey glasses") */
  wakeWords: string[];
  /** Seconds of silence before ending a voice segment */
  silenceTimeoutSec: number;
  /** Maximum seconds for a single voice segment */
  maxSegmentDurationSec: number;
  /** Minimum audio level to consider as speech (0-1) */
  noiseGateThreshold: number;
  /** TTS voice ID (provider-specific) */
  ttsVoiceId: string;
  /** TTS speech rate (0.5-2.0) */
  ttsSpeechRate: number;
  /** Maximum TTS response length in characters */
  maxTTSResponseLength: number;
  /** Enable conversation context (multi-turn) */
  conversationEnabled: boolean;
  /** Number of previous turns to keep for context */
  conversationHistoryLength: number;
  /** Priority interrupt threshold — responses above this priority interrupt current TTS */
  interruptPriority: number;
  /** Enable partial transcript events */
  enablePartialTranscripts: boolean;
  /** Debug mode */
  debug: boolean;
}

export const DEFAULT_VOICE_PIPELINE_CONFIG: VoicePipelineConfig = {
  sttProvider: 'deepgram',
  ttsProvider: 'openai',
  sttApiKey: undefined,
  ttsApiKey: undefined,
  language: 'en-US',
  wakeWordEnabled: true,
  wakeWords: ['hey openclaw', 'hey glasses', 'ok glasses'],
  silenceTimeoutSec: 2,
  maxSegmentDurationSec: 30,
  noiseGateThreshold: 0.01,
  ttsVoiceId: 'nova',
  ttsSpeechRate: 1.0,
  maxTTSResponseLength: 500,
  conversationEnabled: true,
  conversationHistoryLength: 5,
  interruptPriority: 8,
  enablePartialTranscripts: true,
  debug: false,
};

export interface AudioChunk {
  /** Raw audio data (PCM 16-bit, mono) */
  buffer: Buffer;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Timestamp when captured */
  timestamp: string;
  /** Audio level (RMS, 0-1) */
  level: number;
  /** Duration in milliseconds */
  durationMs: number;
}

export interface TranscriptResult {
  /** Transcribed text */
  text: string;
  /** Is this a partial (interim) result? */
  isPartial: boolean;
  /** Confidence score 0-1 */
  confidence: number;
  /** Processing latency in ms */
  latencyMs: number;
  /** Detected language */
  language?: string;
  /** Word-level timestamps */
  words?: TranscriptWord[];
}

export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface TTSRequest {
  /** Text to speak */
  text: string;
  /** Priority (1-10, higher = more important) */
  priority: number;
  /** Source agent that generated this response */
  sourceAgent: string;
  /** Unique request ID */
  requestId: string;
  /** Whether this can be interrupted by higher priority */
  interruptible: boolean;
}

export interface TTSResult {
  /** Generated audio buffer */
  buffer: Buffer;
  /** Audio format */
  format: 'pcm' | 'mp3' | 'opus';
  /** Sample rate */
  sampleRate: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Processing latency in ms */
  latencyMs: number;
}

export interface ConversationTurn {
  /** User input text */
  userText: string;
  /** Agent response text */
  agentResponse: string;
  /** Which agent handled it */
  agentId: string;
  /** Timestamp */
  timestamp: string;
  /** Latency from speech end to response start */
  latencyMs: number;
}

export interface VoicePipelineMetrics {
  /** Total voice segments processed */
  totalSegments: number;
  /** Total TTS responses delivered */
  totalResponses: number;
  /** Average STT latency in ms */
  avgSTTLatencyMs: number;
  /** Average TTS latency in ms */
  avgTTSLatencyMs: number;
  /** Average end-to-end latency (speech → response audio) */
  avgEndToEndLatencyMs: number;
  /** Wake word detection count */
  wakeWordDetections: number;
  /** Noise-gated (rejected) segments */
  noiseRejections: number;
  /** Interrupts triggered */
  interruptCount: number;
  /** Pipeline errors */
  errorCount: number;
  /** Current pipeline state */
  state: PipelineState;
  /** Current TTS queue depth */
  ttsQueueDepth: number;
  /** Session start time */
  sessionStartedAt: string;
  /** Uptime in seconds */
  uptimeSec: number;
}

export interface VoicePipelineEvents {
  'state:changed': (state: PipelineState) => void;
  'wake:detected': (wakeWord: string) => void;
  'audio:received': (chunk: AudioChunk) => void;
  'audio:noiseGated': (level: number) => void;
  'transcript:partial': (result: TranscriptResult) => void;
  'transcript:final': (result: TranscriptResult) => void;
  'intent:classified': (intent: string, params: Record<string, string>, confidence: number) => void;
  'agent:dispatched': (agentId: string, text: string) => void;
  'agent:response': (agentId: string, response: string) => void;
  'tts:queued': (request: TTSRequest) => void;
  'tts:speaking': (request: TTSRequest) => void;
  'tts:complete': (requestId: string) => void;
  'tts:interrupted': (requestId: string, by: string) => void;
  'conversation:turn': (turn: ConversationTurn) => void;
  'error': (source: string, error: string) => void;
  'metrics:updated': (metrics: VoicePipelineMetrics) => void;
}

// ─── STT Adapter Interface ──────────────────────────────────────

export interface STTAdapter {
  /** Start a streaming transcription session */
  startStream(config: { language: string; sampleRate: number }): void;
  /** Send audio chunk for transcription */
  sendAudio(chunk: AudioChunk): void;
  /** End the streaming session */
  endStream(): void;
  /** Register callback for transcript results */
  onTranscript(callback: (result: TranscriptResult) => void): void;
  /** Register error callback */
  onError(callback: (error: string) => void): void;
  /** Check if a stream is active */
  isStreaming(): boolean;
}

export interface TTSAdapter {
  /** Synthesize text to audio */
  synthesize(text: string, options: {
    voiceId: string;
    speechRate: number;
    language: string;
  }): Promise<TTSResult>;
  /** Get available voices */
  listVoices(): Promise<Array<{ id: string; name: string; language: string }>>;
}

// ─── Mock STT Adapter (for testing) ─────────────────────────────

export class MockSTTAdapter implements STTAdapter {
  private streaming = false;
  private transcriptCallback?: (result: TranscriptResult) => void;
  private errorCallback?: (error: string) => void;
  private pendingText = '';
  private segmentBuffer: AudioChunk[] = [];

  startStream(): void {
    this.streaming = true;
    this.segmentBuffer = [];
    this.pendingText = '';
  }

  sendAudio(chunk: AudioChunk): void {
    if (!this.streaming) return;
    this.segmentBuffer.push(chunk);
  }

  endStream(): void {
    this.streaming = false;
    // In mock mode, we deliver whatever was injected
    if (this.pendingText && this.transcriptCallback) {
      this.transcriptCallback({
        text: this.pendingText,
        isPartial: false,
        confidence: 0.95,
        latencyMs: 50,
        language: 'en-US',
      });
      this.pendingText = '';
    }
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.transcriptCallback = callback;
  }

  onError(callback: (error: string) => void): void {
    this.errorCallback = callback;
  }

  isStreaming(): boolean {
    return this.streaming;
  }

  /** Inject text for testing (simulates STT result) */
  injectTranscript(text: string, isPartial = false): void {
    if (this.transcriptCallback) {
      this.transcriptCallback({
        text,
        isPartial,
        confidence: 0.95,
        latencyMs: 50,
        language: 'en-US',
      });
    } else {
      this.pendingText = text;
    }
  }

  /** Inject error for testing */
  injectError(error: string): void {
    if (this.errorCallback) {
      this.errorCallback(error);
    }
  }
}

// ─── Mock TTS Adapter (for testing) ─────────────────────────────

export class MockTTSAdapter implements TTSAdapter {
  public synthesizeCalls: Array<{ text: string; voiceId: string }> = [];
  private shouldFail = false;

  async synthesize(text: string, options: {
    voiceId: string;
    speechRate: number;
    language: string;
  }): Promise<TTSResult> {
    this.synthesizeCalls.push({ text, voiceId: options.voiceId });

    if (this.shouldFail) {
      throw new Error('TTS synthesis failed');
    }

    // Estimate duration: ~150ms per word at normal speed
    const wordCount = text.split(/\s+/).length;
    const durationMs = Math.round((wordCount * 150) / options.speechRate);

    return {
      buffer: Buffer.from(`tts-audio:${text}`),
      format: 'mp3',
      sampleRate: 24000,
      durationMs,
      latencyMs: 30,
    };
  }

  async listVoices(): Promise<Array<{ id: string; name: string; language: string }>> {
    return [
      { id: 'nova', name: 'Nova', language: 'en-US' },
      { id: 'alloy', name: 'Alloy', language: 'en-US' },
      { id: 'echo', name: 'Echo', language: 'en-US' },
    ];
  }

  setFailMode(fail: boolean): void {
    this.shouldFail = fail;
  }
}

// ─── Voice Pipeline Engine ──────────────────────────────────────

export class VoicePipeline extends EventEmitter {
  private config: VoicePipelineConfig;
  private sttAdapter: STTAdapter;
  private ttsAdapter: TTSAdapter;
  private state: PipelineState = 'idle';
  private wakeWordStatus: WakeWordStatus;
  private conversationHistory: ConversationTurn[] = [];
  private ttsQueue: TTSRequest[] = [];
  private currentTTS: TTSRequest | null = null;
  private isTTSSpeaking = false;
  private audioBuffer: AudioChunk[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private segmentTimer: ReturnType<typeof setTimeout> | null = null;
  private isSegmentActive = false;
  private segmentStartTime = 0;

  // Metrics
  private sttLatencies: number[] = [];
  private ttsLatencies: number[] = [];
  private e2eLatencies: number[] = [];
  private totalSegments = 0;
  private totalResponses = 0;
  private wakeWordDetections = 0;
  private noiseRejections = 0;
  private interruptCount = 0;
  private errorCount = 0;
  private sessionStartedAt: string;

  // Agent dispatch callback
  private agentDispatcher?: (
    intent: string,
    params: Record<string, string>,
    text: string,
    conversationContext: ConversationTurn[]
  ) => Promise<{ agentId: string; response: string; priority: number }>;

  // Intent classifier callback
  private intentClassifier?: (
    text: string
  ) => { intent: string; params: Record<string, string>; confidence: number };

  constructor(
    config: Partial<VoicePipelineConfig> = {},
    sttAdapter?: STTAdapter,
    ttsAdapter?: TTSAdapter
  ) {
    super();
    this.config = { ...DEFAULT_VOICE_PIPELINE_CONFIG, ...config };
    this.sttAdapter = sttAdapter || new MockSTTAdapter();
    this.ttsAdapter = ttsAdapter || new MockTTSAdapter();
    this.wakeWordStatus = this.config.wakeWordEnabled ? 'waiting' : 'disabled';
    this.sessionStartedAt = new Date().toISOString();

    this.setupSTTCallbacks();
  }

  // ─── Public API ─────────────────────────────────────────────

  /** Start the voice pipeline */
  start(): void {
    if (this.state !== 'idle' && this.state !== 'error') return;
    this.setState('listening');
    this.sessionStartedAt = new Date().toISOString();
  }

  /** Stop the voice pipeline */
  stop(): void {
    this.clearTimers();
    if (this.sttAdapter.isStreaming()) {
      this.sttAdapter.endStream();
    }
    this.setState('idle');
    this.ttsQueue = [];
    this.currentTTS = null;
    this.isTTSSpeaking = false;
    this.isSegmentActive = false;
  }

  /** Feed audio into the pipeline */
  processAudio(chunk: AudioChunk): void {
    if (this.state !== 'listening' && this.state !== 'processing') return;

    this.emit('audio:received', chunk);

    // Noise gate check
    if (chunk.level < this.config.noiseGateThreshold) {
      this.noiseRejections++;
      this.emit('audio:noiseGated', chunk.level);
      this.handleSilence();
      return;
    }

    // Reset silence timer on speech
    this.resetSilenceTimer();

    // Start a new segment if not already active
    if (!this.isSegmentActive) {
      this.startSegment();
    }

    this.audioBuffer.push(chunk);

    // Send to STT adapter
    this.sttAdapter.sendAudio(chunk);
  }

  /** Inject a text command (bypass STT, for testing or text input fallback) */
  async processText(text: string): Promise<void> {
    if (this.state === 'idle') return;

    const fakeTranscript: TranscriptResult = {
      text,
      isPartial: false,
      confidence: 1.0,
      latencyMs: 0,
      language: this.config.language,
    };

    await this.handleFinalTranscript(fakeTranscript);
  }

  /** Register the intent classifier */
  setIntentClassifier(
    classifier: (text: string) => {
      intent: string;
      params: Record<string, string>;
      confidence: number;
    }
  ): void {
    this.intentClassifier = classifier;
  }

  /** Register the agent dispatcher */
  setAgentDispatcher(
    dispatcher: (
      intent: string,
      params: Record<string, string>,
      text: string,
      conversationContext: ConversationTurn[]
    ) => Promise<{ agentId: string; response: string; priority: number }>
  ): void {
    this.agentDispatcher = dispatcher;
  }

  /** Queue a TTS response directly (for proactive alerts, not from voice input) */
  queueTTS(text: string, priority: number, sourceAgent: string): string {
    const requestId = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const request: TTSRequest = {
      text: this.truncateForTTS(text),
      priority,
      sourceAgent,
      requestId,
      interruptible: priority < this.config.interruptPriority,
    };

    this.ttsQueue.push(request);
    this.ttsQueue.sort((a, b) => b.priority - a.priority);
    this.emit('tts:queued', request);

    // Process queue if not currently speaking
    if (!this.isTTSSpeaking) {
      this.processNextTTS();
    } else if (priority >= this.config.interruptPriority && this.currentTTS?.interruptible) {
      // High priority interrupt
      this.interruptCurrentTTS(requestId);
    }

    return requestId;
  }

  /** Get current pipeline state */
  getState(): PipelineState {
    return this.state;
  }

  /** Get wake word status */
  getWakeWordStatus(): WakeWordStatus {
    return this.wakeWordStatus;
  }

  /** Get conversation history */
  getConversationHistory(): ConversationTurn[] {
    return [...this.conversationHistory];
  }

  /** Clear conversation history */
  clearConversation(): void {
    this.conversationHistory = [];
  }

  /** Get current metrics */
  getMetrics(): VoicePipelineMetrics {
    const now = Date.now();
    const started = new Date(this.sessionStartedAt).getTime();

    return {
      totalSegments: this.totalSegments,
      totalResponses: this.totalResponses,
      avgSTTLatencyMs: this.average(this.sttLatencies),
      avgTTSLatencyMs: this.average(this.ttsLatencies),
      avgEndToEndLatencyMs: this.average(this.e2eLatencies),
      wakeWordDetections: this.wakeWordDetections,
      noiseRejections: this.noiseRejections,
      interruptCount: this.interruptCount,
      errorCount: this.errorCount,
      state: this.state,
      ttsQueueDepth: this.ttsQueue.length,
      sessionStartedAt: this.sessionStartedAt,
      uptimeSec: Math.round((now - started) / 1000),
    };
  }

  /** Get TTS queue */
  getTTSQueue(): TTSRequest[] {
    return [...this.ttsQueue];
  }

  /** Cancel a queued TTS request */
  cancelTTS(requestId: string): boolean {
    const idx = this.ttsQueue.findIndex(r => r.requestId === requestId);
    if (idx === -1) return false;
    this.ttsQueue.splice(idx, 1);
    return true;
  }

  /** Enable or disable wake word */
  setWakeWordEnabled(enabled: boolean): void {
    this.config.wakeWordEnabled = enabled;
    this.wakeWordStatus = enabled ? 'waiting' : 'disabled';
  }

  /** Update config dynamically */
  updateConfig(partial: Partial<VoicePipelineConfig>): void {
    this.config = { ...this.config, ...partial };
    if ('wakeWordEnabled' in partial) {
      this.wakeWordStatus = this.config.wakeWordEnabled ? 'waiting' : 'disabled';
    }
  }

  // ─── Private: STT Handling ──────────────────────────────────

  private setupSTTCallbacks(): void {
    this.sttAdapter.onTranscript((result: TranscriptResult) => {
      if (result.isPartial) {
        this.emit('transcript:partial', result);
      } else {
        this.handleFinalTranscript(result);
      }
    });

    this.sttAdapter.onError((error: string) => {
      this.errorCount++;
      this.emit('error', 'stt', error);
    });
  }

  private async handleFinalTranscript(result: TranscriptResult): Promise<void> {
    const e2eStart = Date.now();
    this.sttLatencies.push(result.latencyMs);
    this.totalSegments++;

    this.emit('transcript:final', result);

    const text = result.text.trim();
    if (!text) return;

    // Wake word check
    if (this.config.wakeWordEnabled && this.wakeWordStatus === 'waiting') {
      const wakeWord = this.detectWakeWord(text);
      if (wakeWord) {
        this.wakeWordDetections++;
        this.wakeWordStatus = 'detected';
        this.emit('wake:detected', wakeWord);

        // Extract text after wake word
        const afterWake = this.textAfterWakeWord(text, wakeWord);
        if (!afterWake) {
          // Just the wake word, wait for actual command
          this.startWakeWordTimeout();
          return;
        }
        // Process the text after the wake word
        await this.processCommand(afterWake, e2eStart);
        return;
      } else {
        // No wake word detected, ignore
        return;
      }
    }

    // If wake word was detected, process the command
    if (this.wakeWordStatus === 'detected') {
      // Reset wake word status after processing
      if (this.config.wakeWordEnabled) {
        this.wakeWordStatus = 'waiting';
      }
    }

    await this.processCommand(text, e2eStart);
  }

  private async processCommand(text: string, e2eStart: number): Promise<void> {
    this.setState('processing');

    try {
      // Classify intent
      let intent = 'unknown';
      let params: Record<string, string> = {};
      let confidence = 0;

      if (this.intentClassifier) {
        const result = this.intentClassifier(text);
        intent = result.intent;
        params = result.params;
        confidence = result.confidence;
      }

      this.emit('intent:classified', intent, params, confidence);

      // Dispatch to agent
      if (this.agentDispatcher) {
        const contextWindow = this.config.conversationEnabled
          ? this.conversationHistory.slice(-this.config.conversationHistoryLength)
          : [];

        this.emit('agent:dispatched', intent, text);

        const result = await this.agentDispatcher(intent, params, text, contextWindow);

        this.emit('agent:response', result.agentId, result.response);

        // Record conversation turn
        const turn: ConversationTurn = {
          userText: text,
          agentResponse: result.response,
          agentId: result.agentId,
          timestamp: new Date().toISOString(),
          latencyMs: Date.now() - e2eStart,
        };
        this.conversationHistory.push(turn);

        // Trim conversation history
        if (this.conversationHistory.length > this.config.conversationHistoryLength * 2) {
          this.conversationHistory = this.conversationHistory.slice(
            -this.config.conversationHistoryLength
          );
        }

        this.emit('conversation:turn', turn);
        this.e2eLatencies.push(turn.latencyMs);

        // Queue TTS response
        if (result.response) {
          this.queueTTS(result.response, result.priority, result.agentId);
        }
      }
    } catch (error) {
      this.errorCount++;
      this.emit('error', 'pipeline', error instanceof Error ? error.message : String(error));
    } finally {
      // Return to listening if pipeline is still active
      if (this.state === 'processing') {
        this.setState('listening');
      }
    }
  }

  // ─── Private: Wake Word Detection ─────────────────────────

  private detectWakeWord(text: string): string | null {
    const lower = text.toLowerCase().trim();
    for (const ww of this.config.wakeWords) {
      if (lower.startsWith(ww) || lower.includes(ww)) {
        return ww;
      }
    }
    return null;
  }

  private textAfterWakeWord(text: string, wakeWord: string): string {
    const lower = text.toLowerCase();
    const idx = lower.indexOf(wakeWord);
    if (idx === -1) return '';
    const after = text.slice(idx + wakeWord.length).trim();
    // Remove leading punctuation/comma
    return after.replace(/^[,;:.\s]+/, '').trim();
  }

  private startWakeWordTimeout(): void {
    // Auto-reset wake word status after a timeout if no command follows
    setTimeout(() => {
      if (this.wakeWordStatus === 'detected') {
        this.wakeWordStatus = 'waiting';
      }
    }, 5000);
  }

  // ─── Private: Audio Segment Management ────────────────────

  private startSegment(): void {
    this.isSegmentActive = true;
    this.segmentStartTime = Date.now();

    // Start STT stream
    if (!this.sttAdapter.isStreaming()) {
      this.sttAdapter.startStream({
        language: this.config.language,
        sampleRate: 16000,
      });
    }

    // Set max segment duration timer
    this.segmentTimer = setTimeout(() => {
      this.endSegment();
    }, this.config.maxSegmentDurationSec * 1000);
  }

  private endSegment(): void {
    if (!this.isSegmentActive) return;
    this.isSegmentActive = false;
    this.audioBuffer = [];
    this.clearTimers();

    if (this.sttAdapter.isStreaming()) {
      this.sttAdapter.endStream();
    }
  }

  private handleSilence(): void {
    // Only start silence timer if a segment is active
    if (!this.isSegmentActive) return;

    if (!this.silenceTimer) {
      this.silenceTimer = setTimeout(() => {
        this.endSegment();
      }, this.config.silenceTimeoutSec * 1000);
    }
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  // ─── Private: TTS Queue Processing ────────────────────────

  private async processNextTTS(): Promise<void> {
    if (this.ttsQueue.length === 0) {
      this.isTTSSpeaking = false;
      this.currentTTS = null;
      // Return to listening after TTS completes
      if (this.state === 'speaking') {
        this.setState('listening');
      }
      return;
    }

    const request = this.ttsQueue.shift()!;
    this.currentTTS = request;
    this.isTTSSpeaking = true;

    this.setState('speaking');
    this.emit('tts:speaking', request);

    try {
      const result = await this.ttsAdapter.synthesize(request.text, {
        voiceId: this.config.ttsVoiceId,
        speechRate: this.config.ttsSpeechRate,
        language: this.config.language,
      });

      this.ttsLatencies.push(result.latencyMs);
      this.totalResponses++;

      // Simulate speaking duration (in real impl, this would be audio playback)
      // In tests/mock, we just mark it complete
      this.emit('tts:complete', request.requestId);
      this.emit('metrics:updated', this.getMetrics());

      // Process next in queue
      await this.processNextTTS();
    } catch (error) {
      this.errorCount++;
      this.emit('error', 'tts', error instanceof Error ? error.message : String(error));
      this.isTTSSpeaking = false;
      this.currentTTS = null;

      // Try next item in queue
      if (this.ttsQueue.length > 0) {
        await this.processNextTTS();
      } else if (this.state === 'speaking') {
        this.setState('listening');
      }
    }
  }

  private interruptCurrentTTS(byRequestId: string): void {
    if (this.currentTTS) {
      this.interruptCount++;
      this.emit('tts:interrupted', this.currentTTS.requestId, byRequestId);
      this.currentTTS = null;
      this.isTTSSpeaking = false;
      // Process the new high-priority item
      this.processNextTTS();
    }
  }

  // ─── Private: Helpers ─────────────────────────────────────

  private setState(state: PipelineState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit('state:changed', state);
  }

  private clearTimers(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.segmentTimer) {
      clearTimeout(this.segmentTimer);
      this.segmentTimer = null;
    }
  }

  private truncateForTTS(text: string): string {
    if (text.length <= this.config.maxTTSResponseLength) return text;
    // Truncate at last sentence boundary within limit
    const truncated = text.slice(0, this.config.maxTTSResponseLength);
    const lastSentence = truncated.lastIndexOf('. ');
    if (lastSentence > this.config.maxTTSResponseLength * 0.5) {
      return truncated.slice(0, lastSentence + 1);
    }
    return truncated + '...';
  }

  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }
}
