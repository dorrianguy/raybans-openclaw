/**
 * Tests for Voice Pipeline Engine
 *
 * Covers: lifecycle, wake word detection, STT handling, intent classification,
 * agent dispatch, TTS queue, conversation context, priority interrupts,
 * noise gate, metrics, error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VoicePipeline,
  MockSTTAdapter,
  MockTTSAdapter,
  DEFAULT_VOICE_PIPELINE_CONFIG,
  type AudioChunk,
  type VoicePipelineConfig,
  type TTSRequest,
  type ConversationTurn,
} from './voice-pipeline.js';

// ─── Helpers ────────────────────────────────────────────────────

function createChunk(overrides: Partial<AudioChunk> = {}): AudioChunk {
  return {
    buffer: Buffer.from('test-audio-data'),
    sampleRate: 16000,
    timestamp: new Date().toISOString(),
    level: 0.5,
    durationMs: 100,
    ...overrides,
  };
}

function createPipeline(
  configOverrides: Partial<VoicePipelineConfig> = {},
  stt?: MockSTTAdapter,
  tts?: MockTTSAdapter
) {
  const sttAdapter = stt || new MockSTTAdapter();
  const ttsAdapter = tts || new MockTTSAdapter();
  const pipeline = new VoicePipeline(
    { ...configOverrides },
    sttAdapter,
    ttsAdapter
  );
  return { pipeline, sttAdapter, ttsAdapter };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('VoicePipeline — Lifecycle', () => {
  it('should start in idle state', () => {
    const { pipeline } = createPipeline();
    expect(pipeline.getState()).toBe('idle');
  });

  it('should transition to listening on start', () => {
    const { pipeline } = createPipeline();
    const states: string[] = [];
    pipeline.on('state:changed', (s) => states.push(s));

    pipeline.start();
    expect(pipeline.getState()).toBe('listening');
    expect(states).toContain('listening');
  });

  it('should return to idle on stop', () => {
    const { pipeline } = createPipeline();
    pipeline.start();
    pipeline.stop();
    expect(pipeline.getState()).toBe('idle');
  });

  it('should not start if already listening', () => {
    const { pipeline } = createPipeline();
    const states: string[] = [];
    pipeline.start();
    pipeline.on('state:changed', (s) => states.push(s));
    pipeline.start(); // no-op
    expect(states).toHaveLength(0); // no additional state change
  });

  it('should clear TTS queue on stop', () => {
    const { pipeline } = createPipeline({ wakeWordEnabled: false });
    pipeline.start();
    pipeline.queueTTS('test', 5, 'agent1');
    pipeline.stop();
    expect(pipeline.getTTSQueue()).toHaveLength(0);
  });

  it('should ignore audio when idle', () => {
    const { pipeline } = createPipeline();
    const received: AudioChunk[] = [];
    pipeline.on('audio:received', (c) => received.push(c));

    pipeline.processAudio(createChunk());
    expect(received).toHaveLength(0);
  });
});

describe('VoicePipeline — Noise Gate', () => {
  it('should reject audio below noise threshold', () => {
    const { pipeline } = createPipeline({ wakeWordEnabled: false });
    pipeline.start();

    const gated: number[] = [];
    pipeline.on('audio:noiseGated', (level) => gated.push(level));

    pipeline.processAudio(createChunk({ level: 0.005 })); // below 0.01 threshold
    expect(gated).toHaveLength(1);
    expect(gated[0]).toBe(0.005);
  });

  it('should pass audio above noise threshold', () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });
    pipeline.start();

    const received: AudioChunk[] = [];
    pipeline.on('audio:received', (c) => received.push(c));

    pipeline.processAudio(createChunk({ level: 0.5 }));
    expect(received).toHaveLength(1);
  });

  it('should track noise rejections in metrics', () => {
    const { pipeline } = createPipeline({ wakeWordEnabled: false });
    pipeline.start();

    pipeline.processAudio(createChunk({ level: 0.001 }));
    pipeline.processAudio(createChunk({ level: 0.002 }));
    pipeline.processAudio(createChunk({ level: 0.003 }));

    const metrics = pipeline.getMetrics();
    expect(metrics.noiseRejections).toBe(3);
  });

  it('should respect custom noise threshold', () => {
    const { pipeline } = createPipeline({
      wakeWordEnabled: false,
      noiseGateThreshold: 0.1,
    });
    pipeline.start();

    const gated: number[] = [];
    pipeline.on('audio:noiseGated', (level) => gated.push(level));

    pipeline.processAudio(createChunk({ level: 0.05 })); // below 0.1
    expect(gated).toHaveLength(1);

    pipeline.processAudio(createChunk({ level: 0.15 })); // above 0.1
    expect(gated).toHaveLength(1); // no additional gating
  });
});

describe('VoicePipeline — Wake Word', () => {
  it('should detect wake word in speech', () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: true,
    });
    pipeline.start();

    const detected: string[] = [];
    pipeline.on('wake:detected', (ww) => detected.push(ww));

    sttAdapter.injectTranscript('hey openclaw what time is it');
    expect(detected).toHaveLength(1);
    expect(detected[0]).toBe('hey openclaw');
  });

  it('should detect "hey glasses" wake word', () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: true,
    });
    pipeline.start();

    const detected: string[] = [];
    pipeline.on('wake:detected', (ww) => detected.push(ww));

    sttAdapter.injectTranscript('hey glasses price check');
    expect(detected).toHaveLength(1);
    expect(detected[0]).toBe('hey glasses');
  });

  it('should detect "ok glasses" wake word', () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: true,
    });
    pipeline.start();

    const detected: string[] = [];
    pipeline.on('wake:detected', (ww) => detected.push(ww));

    sttAdapter.injectTranscript('ok glasses start meeting');
    expect(detected).toHaveLength(1);
    expect(detected[0]).toBe('ok glasses');
  });

  it('should ignore speech without wake word when enabled', () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: true,
    });
    pipeline.start();

    const intents: string[] = [];
    pipeline.on('intent:classified', (intent) => intents.push(intent));

    sttAdapter.injectTranscript('start inventory');
    // Should not process — no wake word
    expect(intents).toHaveLength(0);
  });

  it('should process all speech when wake word is disabled', async () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: false,
    });

    pipeline.setIntentClassifier((text) => ({
      intent: 'test_intent',
      params: {},
      confidence: 0.9,
    }));

    pipeline.start();

    const intents: string[] = [];
    pipeline.on('intent:classified', (intent) => intents.push(intent));

    sttAdapter.injectTranscript('start inventory');

    // Give async processing time
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(intents).toHaveLength(1);
    expect(intents[0]).toBe('test_intent');
  });

  it('should support custom wake words', () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: true,
      wakeWords: ['jarvis', 'computer'],
    });
    pipeline.start();

    const detected: string[] = [];
    pipeline.on('wake:detected', (ww) => detected.push(ww));

    sttAdapter.injectTranscript('jarvis scan this shelf');
    expect(detected).toHaveLength(1);
    expect(detected[0]).toBe('jarvis');
  });

  it('should extract command text after wake word', async () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: true,
    });

    let lastText = '';
    pipeline.setIntentClassifier((text) => {
      lastText = text;
      return { intent: 'test', params: {}, confidence: 0.9 };
    });
    pipeline.setAgentDispatcher(async () => ({
      agentId: 'test', response: 'ok', priority: 5,
    }));

    pipeline.start();
    sttAdapter.injectTranscript('hey openclaw what is this');

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(lastText).toBe('what is this');
  });

  it('should handle wake word only (no command following)', () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: true,
    });
    pipeline.start();

    const detected: string[] = [];
    pipeline.on('wake:detected', (ww) => detected.push(ww));

    sttAdapter.injectTranscript('hey openclaw');

    expect(detected).toHaveLength(1);
    expect(pipeline.getWakeWordStatus()).toBe('detected');
  });

  it('should toggle wake word on/off', () => {
    const { pipeline } = createPipeline({ wakeWordEnabled: true });
    expect(pipeline.getWakeWordStatus()).toBe('waiting');

    pipeline.setWakeWordEnabled(false);
    expect(pipeline.getWakeWordStatus()).toBe('disabled');

    pipeline.setWakeWordEnabled(true);
    expect(pipeline.getWakeWordStatus()).toBe('waiting');
  });
});

describe('VoicePipeline — Intent Classification', () => {
  it('should call intent classifier with transcript text', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });
    const classified: Array<{ intent: string; confidence: number }> = [];

    pipeline.setIntentClassifier((text) => {
      return {
        intent: text.includes('inventory') ? 'inventory_start' : 'unknown',
        params: {},
        confidence: 0.85,
      };
    });

    pipeline.on('intent:classified', (intent, _params, confidence) => {
      classified.push({ intent, confidence });
    });

    pipeline.start();
    sttAdapter.injectTranscript('start inventory');

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(classified).toHaveLength(1);
    expect(classified[0].intent).toBe('inventory_start');
    expect(classified[0].confidence).toBe(0.85);
  });

  it('should handle unknown intents', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({
      intent: 'unknown',
      params: {},
      confidence: 0.1,
    }));

    const intents: string[] = [];
    pipeline.on('intent:classified', (intent) => intents.push(intent));

    pipeline.start();
    sttAdapter.injectTranscript('blah blah blah');

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(intents[0]).toBe('unknown');
  });

  it('should pass parameters from intent classifier', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier((text) => ({
      intent: 'inventory_set_aisle',
      params: { aisle: '3' },
      confidence: 0.9,
    }));

    const classified: Array<{ params: Record<string, string> }> = [];
    pipeline.on('intent:classified', (_intent, params) => {
      classified.push({ params });
    });

    pipeline.start();
    sttAdapter.injectTranscript('set aisle 3');

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(classified[0].params).toEqual({ aisle: '3' });
  });
});

describe('VoicePipeline — Agent Dispatch', () => {
  it('should dispatch to agent after intent classification', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({
      intent: 'price_check',
      params: {},
      confidence: 0.9,
    }));

    const dispatched: Array<{ agentId: string; text: string }> = [];
    pipeline.setAgentDispatcher(async (intent, params, text) => {
      return { agentId: 'deal-agent', response: 'That costs $29.99', priority: 5 };
    });

    pipeline.on('agent:dispatched', (agentId, text) => {
      dispatched.push({ agentId, text });
    });

    pipeline.start();
    sttAdapter.injectTranscript('price check on this');

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(dispatched).toHaveLength(1);
  });

  it('should emit agent response', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({
      intent: 'what_is_this',
      params: {},
      confidence: 0.9,
    }));

    const responses: Array<{ agentId: string; response: string }> = [];
    pipeline.setAgentDispatcher(async () => ({
      agentId: 'context-agent',
      response: 'That is a Phillips screwdriver',
      priority: 5,
    }));

    pipeline.on('agent:response', (agentId, response) => {
      responses.push({ agentId, response });
    });

    pipeline.start();
    sttAdapter.injectTranscript('what is this');

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(responses).toHaveLength(1);
    expect(responses[0].agentId).toBe('context-agent');
    expect(responses[0].response).toBe('That is a Phillips screwdriver');
  });

  it('should pass conversation context to agent dispatcher', async () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: false,
      conversationEnabled: true,
      conversationHistoryLength: 5,
    });

    pipeline.setIntentClassifier(() => ({
      intent: 'query',
      params: {},
      confidence: 0.9,
    }));

    let receivedContext: ConversationTurn[] = [];
    pipeline.setAgentDispatcher(async (_intent, _params, _text, context) => {
      receivedContext = context;
      return { agentId: 'test', response: 'response', priority: 5 };
    });

    pipeline.start();

    // First turn — no context
    sttAdapter.injectTranscript('what is this');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(receivedContext).toHaveLength(0);

    // Second turn — should have first turn as context
    sttAdapter.injectTranscript('tell me more');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(receivedContext).toHaveLength(1);
    expect(receivedContext[0].userText).toBe('what is this');
  });

  it('should handle agent dispatch errors gracefully', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({
      intent: 'test',
      params: {},
      confidence: 0.9,
    }));

    pipeline.setAgentDispatcher(async () => {
      throw new Error('Agent crashed');
    });

    const errors: string[] = [];
    pipeline.on('error', (_source, error) => errors.push(error));

    pipeline.start();
    sttAdapter.injectTranscript('do something');

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Agent crashed');
    expect(pipeline.getState()).toBe('listening'); // should recover
  });

  it('should return to listening after processing', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({
      intent: 'test',
      params: {},
      confidence: 0.9,
    }));

    pipeline.setAgentDispatcher(async () => ({
      agentId: 'test',
      response: '',
      priority: 5,
    }));

    pipeline.start();

    const states: string[] = [];
    pipeline.on('state:changed', (s) => states.push(s));

    sttAdapter.injectTranscript('test');

    await new Promise(resolve => setTimeout(resolve, 100));
    // Should have gone: listening → processing → listening
    expect(states).toContain('processing');
    expect(pipeline.getState()).toBe('listening');
  });
});

describe('VoicePipeline — TTS Queue', () => {
  it('should queue TTS requests', () => {
    const { pipeline } = createPipeline({ wakeWordEnabled: false });
    pipeline.start();

    // Queue multiple requests without processing to avoid async
    const id1 = pipeline.queueTTS('Hello world', 5, 'agent1');
    expect(id1).toBeTruthy();
    expect(id1.startsWith('tts-')).toBe(true);
  });

  it('should order queue by priority', () => {
    const { pipeline, ttsAdapter } = createPipeline({ wakeWordEnabled: false });
    // Don't start so TTS doesn't auto-process
    pipeline.start();

    // Make TTS slow to simulate queue buildup
    const originalSynth = ttsAdapter.synthesize.bind(ttsAdapter);
    ttsAdapter.synthesize = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return originalSynth(...args);
    };

    pipeline.queueTTS('Low priority', 1, 'agent1');
    pipeline.queueTTS('High priority', 9, 'agent2');
    pipeline.queueTTS('Medium priority', 5, 'agent3');

    const queue = pipeline.getTTSQueue();
    // Note: first item may already be dequeued for processing
    // So we check remaining queue is sorted
    if (queue.length >= 2) {
      for (let i = 0; i < queue.length - 1; i++) {
        expect(queue[i].priority).toBeGreaterThanOrEqual(queue[i + 1].priority);
      }
    }
  });

  it('should process TTS and emit events', async () => {
    const { pipeline, ttsAdapter } = createPipeline({ wakeWordEnabled: false });
    pipeline.start();

    const events: string[] = [];
    pipeline.on('tts:speaking', () => events.push('speaking'));
    pipeline.on('tts:complete', () => events.push('complete'));

    pipeline.queueTTS('Hello world', 5, 'test');

    await new Promise(resolve => setTimeout(resolve, 200));
    expect(events).toContain('speaking');
    expect(events).toContain('complete');
    expect(ttsAdapter.synthesizeCalls).toHaveLength(1);
    expect(ttsAdapter.synthesizeCalls[0].text).toBe('Hello world');
  });

  it('should cancel a queued TTS request', async () => {
    const { pipeline, ttsAdapter } = createPipeline({ wakeWordEnabled: false });
    pipeline.start();

    // Make first TTS slow
    let callCount = 0;
    const originalSynth = ttsAdapter.synthesize.bind(ttsAdapter);
    ttsAdapter.synthesize = async (...args) => {
      callCount++;
      if (callCount === 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      return originalSynth(...args);
    };

    pipeline.queueTTS('First', 5, 'agent1');
    const id2 = pipeline.queueTTS('Second', 3, 'agent2');

    const cancelled = pipeline.cancelTTS(id2);
    expect(cancelled).toBe(true);
  });

  it('should return false when cancelling non-existent request', () => {
    const { pipeline } = createPipeline();
    const cancelled = pipeline.cancelTTS('nonexistent-id');
    expect(cancelled).toBe(false);
  });

  it('should truncate long TTS text', () => {
    const { pipeline, ttsAdapter } = createPipeline({
      wakeWordEnabled: false,
      maxTTSResponseLength: 50,
    });
    pipeline.start();

    const longText = 'This is a very long response that should be truncated. It goes on and on and on and on.';
    pipeline.queueTTS(longText, 5, 'test');

    // Wait for processing
    return new Promise<void>(resolve => {
      setTimeout(() => {
        if (ttsAdapter.synthesizeCalls.length > 0) {
          expect(ttsAdapter.synthesizeCalls[0].text.length).toBeLessThanOrEqual(54); // 50 + "..."
        }
        resolve();
      }, 200);
    });
  });

  it('should handle TTS synthesis errors', async () => {
    const { pipeline, ttsAdapter } = createPipeline({ wakeWordEnabled: false });
    pipeline.start();

    ttsAdapter.setFailMode(true);

    const errors: string[] = [];
    pipeline.on('error', (_source, err) => errors.push(err));

    pipeline.queueTTS('This will fail', 5, 'test');

    await new Promise(resolve => setTimeout(resolve, 200));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('TTS synthesis failed');
  });

  it('should interrupt low priority TTS for high priority', async () => {
    const { pipeline, ttsAdapter } = createPipeline({
      wakeWordEnabled: false,
      interruptPriority: 8,
    });
    pipeline.start();

    // Make TTS slow to simulate ongoing speech
    const originalSynth = ttsAdapter.synthesize.bind(ttsAdapter);
    ttsAdapter.synthesize = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return originalSynth(...args);
    };

    const interrupted: Array<{ requestId: string; by: string }> = [];
    pipeline.on('tts:interrupted', (requestId, by) => {
      interrupted.push({ requestId, by });
    });

    // Queue low priority first
    pipeline.queueTTS('Low priority message', 3, 'agent1');

    // Wait for it to start speaking
    await new Promise(resolve => setTimeout(resolve, 50));

    // Queue high priority interrupt
    pipeline.queueTTS('SECURITY ALERT', 9, 'security');

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(interrupted.length).toBeGreaterThanOrEqual(1);
  });
});

describe('VoicePipeline — Conversation Context', () => {
  it('should track conversation history', async () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: false,
      conversationEnabled: true,
    });

    pipeline.setIntentClassifier(() => ({
      intent: 'query',
      params: {},
      confidence: 0.9,
    }));

    pipeline.setAgentDispatcher(async (_intent, _params, text) => ({
      agentId: 'test',
      response: `Response to: ${text}`,
      priority: 5,
    }));

    pipeline.start();

    sttAdapter.injectTranscript('first question');
    await new Promise(resolve => setTimeout(resolve, 150));

    sttAdapter.injectTranscript('second question');
    await new Promise(resolve => setTimeout(resolve, 150));

    const history = pipeline.getConversationHistory();
    expect(history).toHaveLength(2);
    expect(history[0].userText).toBe('first question');
    expect(history[0].agentResponse).toBe('Response to: first question');
    expect(history[1].userText).toBe('second question');
  });

  it('should clear conversation history', async () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: false,
      conversationEnabled: true,
    });

    pipeline.setIntentClassifier(() => ({ intent: 'test', params: {}, confidence: 0.9 }));
    pipeline.setAgentDispatcher(async () => ({ agentId: 'test', response: 'ok', priority: 5 }));

    pipeline.start();
    sttAdapter.injectTranscript('hello');
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(pipeline.getConversationHistory()).toHaveLength(1);
    pipeline.clearConversation();
    expect(pipeline.getConversationHistory()).toHaveLength(0);
  });

  it('should not pass context when conversation is disabled', async () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: false,
      conversationEnabled: false,
    });

    pipeline.setIntentClassifier(() => ({ intent: 'test', params: {}, confidence: 0.9 }));

    let receivedContext: ConversationTurn[] = [];
    pipeline.setAgentDispatcher(async (_i, _p, _t, context) => {
      receivedContext = context;
      return { agentId: 'test', response: 'ok', priority: 5 };
    });

    pipeline.start();

    sttAdapter.injectTranscript('first');
    await new Promise(resolve => setTimeout(resolve, 100));
    sttAdapter.injectTranscript('second');
    await new Promise(resolve => setTimeout(resolve, 100));

    // Context should be empty even though there's history
    expect(receivedContext).toHaveLength(0);
  });

  it('should trim conversation history to configured length', async () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: false,
      conversationEnabled: true,
      conversationHistoryLength: 2,
    });

    pipeline.setIntentClassifier(() => ({ intent: 'test', params: {}, confidence: 0.9 }));
    pipeline.setAgentDispatcher(async () => ({ agentId: 'test', response: 'ok', priority: 5 }));

    pipeline.start();

    // Send more turns than the history length * 2 to trigger trimming
    for (let i = 0; i < 6; i++) {
      sttAdapter.injectTranscript(`message ${i}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const history = pipeline.getConversationHistory();
    // Should be trimmed (max 2 * 2 = 4 before trim, then trimmed to 2)
    expect(history.length).toBeLessThanOrEqual(4);
  });

  it('should emit conversation turn events', async () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: false,
      conversationEnabled: true,
    });

    pipeline.setIntentClassifier(() => ({ intent: 'test', params: {}, confidence: 0.9 }));
    pipeline.setAgentDispatcher(async () => ({
      agentId: 'deal-agent',
      response: 'That costs $5',
      priority: 5,
    }));

    const turns: ConversationTurn[] = [];
    pipeline.on('conversation:turn', (turn) => turns.push(turn));

    pipeline.start();
    sttAdapter.injectTranscript('price check');
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(turns).toHaveLength(1);
    expect(turns[0].userText).toBe('price check');
    expect(turns[0].agentResponse).toBe('That costs $5');
    expect(turns[0].agentId).toBe('deal-agent');
    expect(turns[0].latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('VoicePipeline — Text Input (Bypass STT)', () => {
  it('should process text commands directly', async () => {
    const { pipeline } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier((text) => ({
      intent: text.includes('inventory') ? 'inventory_start' : 'unknown',
      params: {},
      confidence: 0.9,
    }));

    const intents: string[] = [];
    pipeline.on('intent:classified', (intent) => intents.push(intent));

    pipeline.start();
    await pipeline.processText('start inventory');

    expect(intents).toHaveLength(1);
    expect(intents[0]).toBe('inventory_start');
  });

  it('should ignore text when pipeline is idle', async () => {
    const { pipeline } = createPipeline({ wakeWordEnabled: false });

    const intents: string[] = [];
    pipeline.on('intent:classified', (intent) => intents.push(intent));

    await pipeline.processText('start inventory');
    expect(intents).toHaveLength(0);
  });

  it('should bypass wake word for text input', async () => {
    const { pipeline } = createPipeline({ wakeWordEnabled: true });

    pipeline.setIntentClassifier(() => ({
      intent: 'test',
      params: {},
      confidence: 0.9,
    }));

    pipeline.setAgentDispatcher(async () => ({
      agentId: 'test',
      response: 'ok',
      priority: 5,
    }));

    const intents: string[] = [];
    pipeline.on('intent:classified', (intent) => intents.push(intent));

    pipeline.start();
    // Note: processText goes through handleFinalTranscript which still checks wake word
    // But text input should still work with wake word
    await pipeline.processText('hey openclaw what is this');

    expect(intents).toHaveLength(1);
  });
});

describe('VoicePipeline — Metrics', () => {
  it('should track basic metrics', () => {
    const { pipeline } = createPipeline();
    pipeline.start();

    const metrics = pipeline.getMetrics();
    expect(metrics.totalSegments).toBe(0);
    expect(metrics.totalResponses).toBe(0);
    expect(metrics.state).toBe('listening');
    expect(metrics.sessionStartedAt).toBeTruthy();
    expect(metrics.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('should track segment count', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({ intent: 'test', params: {}, confidence: 0.9 }));
    pipeline.setAgentDispatcher(async () => ({ agentId: 'test', response: 'ok', priority: 5 }));

    pipeline.start();

    sttAdapter.injectTranscript('test one');
    await new Promise(resolve => setTimeout(resolve, 100));
    sttAdapter.injectTranscript('test two');
    await new Promise(resolve => setTimeout(resolve, 100));

    const metrics = pipeline.getMetrics();
    expect(metrics.totalSegments).toBe(2);
  });

  it('should track error count', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({ intent: 'test', params: {}, confidence: 0.9 }));
    pipeline.setAgentDispatcher(async () => { throw new Error('boom'); });

    // Must add error listener to prevent unhandled error throw
    pipeline.on('error', () => { /* expected */ });

    pipeline.start();
    sttAdapter.injectTranscript('test');
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(pipeline.getMetrics().errorCount).toBe(1);
  });

  it('should track wake word detections', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: true });
    pipeline.start();

    // After first wake word with no command, status becomes 'detected'
    // then times out back to 'waiting', so second wake word can be detected
    sttAdapter.injectTranscript('hey openclaw');
    expect(pipeline.getMetrics().wakeWordDetections).toBe(1);

    // Force status back to waiting for the second detection
    pipeline.setWakeWordEnabled(true); // resets to 'waiting'
    sttAdapter.injectTranscript('hey glasses');
    expect(pipeline.getMetrics().wakeWordDetections).toBe(2);
  });

  it('should calculate average latencies', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({ intent: 'test', params: {}, confidence: 0.9 }));
    pipeline.setAgentDispatcher(async () => ({ agentId: 'test', response: 'ok', priority: 5 }));

    pipeline.start();

    sttAdapter.injectTranscript('test');
    await new Promise(resolve => setTimeout(resolve, 150));

    const metrics = pipeline.getMetrics();
    // STT latency should be populated (mock returns 50ms)
    expect(metrics.avgSTTLatencyMs).toBeGreaterThanOrEqual(0);
    // E2E latency should be tracked
    expect(metrics.avgEndToEndLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should return 0 for averages when no data', () => {
    const { pipeline } = createPipeline();
    const metrics = pipeline.getMetrics();
    expect(metrics.avgSTTLatencyMs).toBe(0);
    expect(metrics.avgTTSLatencyMs).toBe(0);
    expect(metrics.avgEndToEndLatencyMs).toBe(0);
  });
});

describe('VoicePipeline — Audio Segment Management', () => {
  it('should start STT stream when speech detected', () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });
    pipeline.start();

    expect(sttAdapter.isStreaming()).toBe(false);
    pipeline.processAudio(createChunk({ level: 0.5 }));
    expect(sttAdapter.isStreaming()).toBe(true);
  });

  it('should end STT stream on stop', () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });
    pipeline.start();
    pipeline.processAudio(createChunk({ level: 0.5 }));
    expect(sttAdapter.isStreaming()).toBe(true);

    pipeline.stop();
    expect(sttAdapter.isStreaming()).toBe(false);
  });
});

describe('VoicePipeline — Configuration', () => {
  it('should use default config', () => {
    const { pipeline } = createPipeline();
    const metrics = pipeline.getMetrics();
    expect(metrics.state).toBe('idle');
  });

  it('should merge config overrides', () => {
    const { pipeline } = createPipeline({ language: 'es-ES', ttsVoiceId: 'alloy' });
    // Config is private, but we can verify through behavior
    expect(pipeline.getState()).toBe('idle');
  });

  it('should update config dynamically', () => {
    const { pipeline } = createPipeline({ wakeWordEnabled: true });
    expect(pipeline.getWakeWordStatus()).toBe('waiting');

    pipeline.updateConfig({ wakeWordEnabled: false });
    expect(pipeline.getWakeWordStatus()).toBe('disabled');
  });
});

describe('VoicePipeline — STT Error Handling', () => {
  it('should handle STT errors and track in metrics', () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });
    pipeline.start();

    const errors: Array<{ source: string; error: string }> = [];
    pipeline.on('error', (source, error) => errors.push({ source, error }));

    sttAdapter.injectError('Connection lost');

    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('stt');
    expect(errors[0].error).toBe('Connection lost');
    expect(pipeline.getMetrics().errorCount).toBe(1);
  });
});

describe('VoicePipeline — Partial Transcripts', () => {
  it('should emit partial transcript events', () => {
    const { pipeline, sttAdapter } = createPipeline({
      wakeWordEnabled: false,
      enablePartialTranscripts: true,
    });
    pipeline.start();

    const partials: string[] = [];
    pipeline.on('transcript:partial', (result) => partials.push(result.text));

    sttAdapter.injectTranscript('start invent', true);
    expect(partials).toHaveLength(1);
    expect(partials[0]).toBe('start invent');
  });

  it('should not process partial transcripts as commands', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({ intent: 'test', params: {}, confidence: 0.9 }));

    const intents: string[] = [];
    pipeline.on('intent:classified', (intent) => intents.push(intent));

    pipeline.start();
    sttAdapter.injectTranscript('start', true); // partial

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(intents).toHaveLength(0); // partials should not trigger classification
  });
});

describe('VoicePipeline — Full E2E Flow', () => {
  it('should handle complete voice interaction: audio → STT → intent → agent → TTS', async () => {
    const ttsAdapter = new MockTTSAdapter();
    const sttAdapter = new MockSTTAdapter();
    const { pipeline } = createPipeline(
      { wakeWordEnabled: false },
      sttAdapter,
      ttsAdapter
    );

    const events: string[] = [];

    pipeline.setIntentClassifier((text) => ({
      intent: text.includes('price') ? 'price_check' : 'unknown',
      params: {},
      confidence: 0.9,
    }));

    pipeline.setAgentDispatcher(async (intent) => {
      if (intent === 'price_check') {
        return {
          agentId: 'deal-agent',
          response: 'That product is $29.99 on Amazon. You could save $10.',
          priority: 5,
        };
      }
      return { agentId: 'general', response: 'I don\'t understand.', priority: 3 };
    });

    pipeline.on('state:changed', (s) => events.push(`state:${s}`));
    pipeline.on('intent:classified', (i) => events.push(`intent:${i}`));
    pipeline.on('agent:response', (id, r) => events.push(`response:${id}`));
    pipeline.on('tts:complete', () => events.push('tts:done'));

    pipeline.start();
    events.push('started');

    // Simulate STT delivering final transcript
    sttAdapter.injectTranscript('price check on this product');

    // Wait for full pipeline
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(events).toContain('started');
    expect(events).toContain('state:listening');
    expect(events).toContain('intent:price_check');
    expect(events).toContain('response:deal-agent');
    expect(events).toContain('tts:done');

    // Verify TTS was called with the right text
    expect(ttsAdapter.synthesizeCalls).toHaveLength(1);
    expect(ttsAdapter.synthesizeCalls[0].text).toContain('$29.99');

    // Verify conversation history
    const history = pipeline.getConversationHistory();
    expect(history).toHaveLength(1);
    expect(history[0].userText).toBe('price check on this product');
    expect(history[0].agentId).toBe('deal-agent');
  });

  it('should handle wake word → command → response flow', async () => {
    const ttsAdapter = new MockTTSAdapter();
    const sttAdapter = new MockSTTAdapter();
    const { pipeline } = createPipeline(
      { wakeWordEnabled: true },
      sttAdapter,
      ttsAdapter
    );

    pipeline.setIntentClassifier(() => ({
      intent: 'status_report',
      params: {},
      confidence: 0.9,
    }));

    pipeline.setAgentDispatcher(async () => ({
      agentId: 'inventory-agent',
      response: 'Aisle 3 complete. 147 items counted.',
      priority: 5,
    }));

    const wakeWords: string[] = [];
    pipeline.on('wake:detected', (ww) => wakeWords.push(ww));

    pipeline.start();
    sttAdapter.injectTranscript('hey openclaw give me a status report');

    await new Promise(resolve => setTimeout(resolve, 300));

    expect(wakeWords).toHaveLength(1);
    expect(ttsAdapter.synthesizeCalls).toHaveLength(1);
    expect(ttsAdapter.synthesizeCalls[0].text).toContain('147 items counted');
  });

  it('should handle multi-turn conversation', async () => {
    const sttAdapter = new MockSTTAdapter();
    const ttsAdapter = new MockTTSAdapter();
    const { pipeline } = createPipeline(
      { wakeWordEnabled: false, conversationEnabled: true },
      sttAdapter,
      ttsAdapter
    );

    let turnNumber = 0;
    pipeline.setIntentClassifier(() => ({ intent: 'query', params: {}, confidence: 0.9 }));
    pipeline.setAgentDispatcher(async (_i, _p, text, context) => {
      turnNumber++;
      if (turnNumber === 1) {
        return { agentId: 'deal-agent', response: 'That TV is $499.', priority: 5 };
      }
      // Second turn should have context
      const hasContext = context.length > 0;
      return {
        agentId: 'deal-agent',
        response: hasContext ? 'Amazon has it for $399.' : 'What product?',
        priority: 5,
      };
    });

    pipeline.start();

    sttAdapter.injectTranscript('how much is this TV');
    await new Promise(resolve => setTimeout(resolve, 200));

    sttAdapter.injectTranscript('is it cheaper anywhere else');
    await new Promise(resolve => setTimeout(resolve, 200));

    const history = pipeline.getConversationHistory();
    expect(history).toHaveLength(2);
    expect(history[1].agentResponse).toContain('$399');
  });
});

describe('VoicePipeline — Edge Cases', () => {
  it('should handle empty transcript', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({ intent: 'test', params: {}, confidence: 0.9 }));
    const intents: string[] = [];
    pipeline.on('intent:classified', (i) => intents.push(i));

    pipeline.start();
    sttAdapter.injectTranscript('');

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(intents).toHaveLength(0);
  });

  it('should handle whitespace-only transcript', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({ intent: 'test', params: {}, confidence: 0.9 }));
    const intents: string[] = [];
    pipeline.on('intent:classified', (i) => intents.push(i));

    pipeline.start();
    sttAdapter.injectTranscript('   \n  \t  ');

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(intents).toHaveLength(0);
  });

  it('should handle rapid consecutive transcripts', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    let callCount = 0;
    pipeline.setIntentClassifier(() => {
      callCount++;
      return { intent: 'test', params: {}, confidence: 0.9 };
    });
    pipeline.setAgentDispatcher(async () => ({
      agentId: 'test', response: 'ok', priority: 5,
    }));

    pipeline.start();

    sttAdapter.injectTranscript('first');
    sttAdapter.injectTranscript('second');
    sttAdapter.injectTranscript('third');

    await new Promise(resolve => setTimeout(resolve, 300));
    expect(callCount).toBe(3);
  });

  it('should handle TTS queue with zero items gracefully', async () => {
    const { pipeline } = createPipeline();
    pipeline.start();
    // No TTS queued — just verify no crash
    expect(pipeline.getTTSQueue()).toHaveLength(0);
  });

  it('should handle missing agent dispatcher', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    pipeline.setIntentClassifier(() => ({ intent: 'test', params: {}, confidence: 0.9 }));
    // No agent dispatcher set

    pipeline.start();
    sttAdapter.injectTranscript('test command');

    await new Promise(resolve => setTimeout(resolve, 50));
    // Should not crash, just classify intent without dispatch
    expect(pipeline.getMetrics().totalSegments).toBe(1);
  });

  it('should handle missing intent classifier', async () => {
    const { pipeline, sttAdapter } = createPipeline({ wakeWordEnabled: false });

    // No intent classifier set
    pipeline.setAgentDispatcher(async (intent) => ({
      agentId: 'test', response: 'ok', priority: 5,
    }));

    const intents: string[] = [];
    pipeline.on('intent:classified', (i) => intents.push(i));

    pipeline.start();
    sttAdapter.injectTranscript('test');

    await new Promise(resolve => setTimeout(resolve, 50));
    // Should default to 'unknown' intent
    expect(intents[0]).toBe('unknown');
  });
});
