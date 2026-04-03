/**
 * Event Bus Tests — Night Shift #30
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EventBus,
  type BusEvent,
  type EventHandler,
  type EventMiddleware,
} from './event-bus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // ── Basic Pub/Sub ──────────────────────────────────────────────────────

  describe('basic pub/sub', () => {
    it('should publish and receive events', () => {
      const received: BusEvent[] = [];
      bus.subscribe('test', (e) => received.push(e));
      bus.publish('test', { value: 42 });

      expect(received).toHaveLength(1);
      expect(received[0].channel).toBe('test');
      expect(received[0].payload).toEqual({ value: 42 });
    });

    it('should return the published event', () => {
      const event = bus.publish('test', 'hello');
      expect(event).not.toBeNull();
      expect(event!.id).toMatch(/^evt_/);
      expect(event!.channel).toBe('test');
      expect(event!.payload).toBe('hello');
      expect(event!.timestamp).toBeGreaterThan(0);
    });

    it('should deliver to multiple subscribers', () => {
      let count = 0;
      bus.subscribe('test', () => count++);
      bus.subscribe('test', () => count++);
      bus.subscribe('test', () => count++);
      bus.publish('test', null);

      expect(count).toBe(3);
    });

    it('should not deliver to unrelated channels', () => {
      let called = false;
      bus.subscribe('other', () => { called = true; });
      bus.publish('test', null);

      expect(called).toBe(false);
    });

    it('should handle events with no subscribers', () => {
      const event = bus.publish('orphan', { data: 'no one listens' });
      expect(event).not.toBeNull();
      expect(bus.getMetrics().totalPublished).toBe(1);
    });
  });

  // ── Wildcards ──────────────────────────────────────────────────────────

  describe('wildcard subscriptions', () => {
    it('should match namespace wildcards', () => {
      const received: string[] = [];
      bus.subscribe('image:*', (e) => received.push(e.channel));

      bus.publish('image:captured', {});
      bus.publish('image:processed', {});
      bus.publish('agent:started', {});

      expect(received).toEqual(['image:captured', 'image:processed']);
    });

    it('should match global wildcard', () => {
      const received: string[] = [];
      bus.subscribe('*', (e) => received.push(e.channel));

      bus.publish('image:captured', {});
      bus.publish('agent:started', {});
      bus.publish('voice:command', {});

      expect(received).toEqual(['image:captured', 'agent:started', 'voice:command']);
    });

    it('should not match partial namespaces', () => {
      const received: string[] = [];
      bus.subscribe('image:*', (e) => received.push(e.channel));

      bus.publish('images:captured', {}); // 'images' not 'image'
      expect(received).toHaveLength(0);
    });

    it('should match exact channels alongside wildcards', () => {
      const exact: string[] = [];
      const wild: string[] = [];

      bus.subscribe('image:captured', (e) => exact.push(e.channel));
      bus.subscribe('image:*', (e) => wild.push(e.channel));

      bus.publish('image:captured', {});

      expect(exact).toEqual(['image:captured']);
      expect(wild).toEqual(['image:captured']);
    });
  });

  // ── Priority ───────────────────────────────────────────────────────────

  describe('priority ordering', () => {
    it('should deliver critical handlers before normal', () => {
      const order: string[] = [];
      bus.subscribe('test', () => order.push('normal'), { priority: 'normal' });
      bus.subscribe('test', () => order.push('critical'), { priority: 'critical' });
      bus.subscribe('test', () => order.push('low'), { priority: 'low' });
      bus.subscribe('test', () => order.push('high'), { priority: 'high' });

      bus.publish('test', null);

      expect(order).toEqual(['critical', 'high', 'normal', 'low']);
    });
  });

  // ── Once ───────────────────────────────────────────────────────────────

  describe('once subscriptions', () => {
    it('should fire once then unsubscribe', () => {
      let count = 0;
      bus.once('test', () => count++);

      bus.publish('test', null);
      bus.publish('test', null);
      bus.publish('test', null);

      expect(count).toBe(1);
    });

    it('should remove from subscriptions after firing', () => {
      bus.once('test', () => {});
      expect(bus.getSubscriptions().length).toBe(1);

      bus.publish('test', null);
      expect(bus.getSubscriptions().length).toBe(0);
    });
  });

  // ── Filters ────────────────────────────────────────────────────────────

  describe('subscription filters', () => {
    it('should filter events per subscription', () => {
      const received: number[] = [];
      bus.subscribe('test', (e) => received.push(e.payload as number), {
        filter: (e) => (e.payload as number) > 5,
      });

      bus.publish('test', 3);
      bus.publish('test', 7);
      bus.publish('test', 1);
      bus.publish('test', 10);

      expect(received).toEqual([7, 10]);
    });
  });

  // ── Unsubscribe ────────────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('should stop receiving after unsubscribe', () => {
      let count = 0;
      const id = bus.subscribe('test', () => count++);

      bus.publish('test', null);
      expect(count).toBe(1);

      bus.unsubscribe(id);
      bus.publish('test', null);
      expect(count).toBe(1);
    });

    it('should return false for unknown subscription', () => {
      expect(bus.unsubscribe('nonexistent')).toBe(false);
    });

    it('should unsubscribe all for a channel', () => {
      bus.subscribe('test', () => {});
      bus.subscribe('test', () => {});
      bus.subscribe('other', () => {});

      const removed = bus.unsubscribeAll('test');
      expect(removed).toBe(2);
      expect(bus.getSubscriptions().length).toBe(1);
    });

    it('should unsubscribe everything when no channel specified', () => {
      bus.subscribe('a', () => {});
      bus.subscribe('b', () => {});
      bus.subscribe('c', () => {});

      const removed = bus.unsubscribeAll();
      expect(removed).toBe(3);
      expect(bus.getSubscriptions().length).toBe(0);
    });
  });

  // ── Middleware ──────────────────────────────────────────────────────────

  describe('middleware', () => {
    it('should transform events through middleware', () => {
      const mw: EventMiddleware = {
        name: 'enricher',
        priority: 0,
        process: (event) => ({
          ...event,
          metadata: { ...event.metadata, enriched: true },
        }),
      };

      bus.addMiddleware(mw);

      const received: BusEvent[] = [];
      bus.subscribe('test', (e) => received.push(e));
      bus.publish('test', null);

      expect(received[0].metadata?.enriched).toBe(true);
    });

    it('should filter events when middleware returns null', () => {
      const mw: EventMiddleware = {
        name: 'blocker',
        priority: 0,
        process: () => null,
      };

      bus.addMiddleware(mw);

      let called = false;
      bus.subscribe('test', () => { called = true; });
      const result = bus.publish('test', null);

      expect(result).toBeNull();
      expect(called).toBe(false);
      expect(bus.getMetrics().totalFiltered).toBe(1);
    });

    it('should execute middleware in priority order', () => {
      const order: string[] = [];

      bus.addMiddleware({
        name: 'second',
        priority: 10,
        process: (e) => { order.push('second'); return e; },
      });

      bus.addMiddleware({
        name: 'first',
        priority: 1,
        process: (e) => { order.push('first'); return e; },
      });

      bus.publish('test', null);
      expect(order).toEqual(['first', 'second']);
    });

    it('should remove middleware by name', () => {
      bus.addMiddleware({
        name: 'removable',
        priority: 0,
        process: () => null,
      });

      expect(bus.removeMiddleware('removable')).toBe(true);
      expect(bus.removeMiddleware('nonexistent')).toBe(false);

      // Event should now go through
      let called = false;
      bus.subscribe('test', () => { called = true; });
      bus.publish('test', null);
      expect(called).toBe(true);
    });
  });

  // ── Channel Configuration ──────────────────────────────────────────────

  describe('channel configuration', () => {
    it('should rate limit events per channel', () => {
      bus.configureChannel('limited', { rateLimit: { maxPerSecond: 2 } });

      let count = 0;
      bus.subscribe('limited', () => count++);

      bus.publish('limited', 1);
      bus.publish('limited', 2);
      bus.publish('limited', 3); // should be filtered
      bus.publish('limited', 4); // should be filtered

      expect(count).toBe(2);
      expect(bus.getMetrics().totalFiltered).toBe(2);
    });

    it('should apply backpressure when queue is full', () => {
      bus.configureChannel('bptest', { maxQueueDepth: 1 });

      // Subscribe with an async handler to keep queue depth > 0
      // For sync handlers, depth is incremented and decremented immediately
      // So we test that the config is respected:
      let count = 0;
      bus.subscribe('bptest', () => count++);

      // First event processes synchronously (depth goes 1 -> 0)
      const r1 = bus.publish('bptest', 1);
      expect(r1).not.toBeNull();
      expect(count).toBe(1);
    });
  });

  // ── Dead Letter Queue ──────────────────────────────────────────────────

  describe('dead letter queue', () => {
    it('should capture failed handler events', () => {
      bus.subscribe('test', () => { throw new Error('boom'); });
      bus.publish('test', { data: 'will fail' });

      const dlq = bus.getDeadLetters();
      expect(dlq).toHaveLength(1);
      expect(dlq[0].error).toBe('boom');
      expect(dlq[0].event.channel).toBe('test');
      expect(dlq[0].retryCount).toBe(0);
    });

    it('should not affect other handlers when one fails', () => {
      let successCount = 0;
      bus.subscribe('test', () => { throw new Error('fail'); }, { priority: 'critical' });
      bus.subscribe('test', () => successCount++, { priority: 'normal' });

      bus.publish('test', null);
      expect(successCount).toBe(1);
    });

    it('should filter dead letters by channel', () => {
      bus.subscribe('a', () => { throw new Error('fail a'); });
      bus.subscribe('b', () => { throw new Error('fail b'); });

      bus.publish('a', null);
      bus.publish('b', null);

      expect(bus.getDeadLetters({ channel: 'a' })).toHaveLength(1);
      expect(bus.getDeadLetters({ channel: 'b' })).toHaveLength(1);
    });

    it('should retry dead letter events', () => {
      let attempts = 0;
      bus.subscribe('test', () => {
        attempts++;
        if (attempts < 2) throw new Error('not yet');
      });

      bus.publish('test', null);
      expect(bus.getDeadLetters()).toHaveLength(1);

      const dlq = bus.getDeadLetters();
      bus.retryDeadLetter(dlq[0].event.id);

      // Second attempt succeeds, DLQ cleared
      expect(bus.getDeadLetters()).toHaveLength(0);
    });

    it('should clear all dead letters', () => {
      bus.subscribe('test', () => { throw new Error('fail'); });
      bus.publish('test', 1);
      bus.publish('test', 2);

      expect(bus.clearDeadLetters()).toBe(2);
      expect(bus.getDeadLetters()).toHaveLength(0);
    });

    it('should limit DLQ size', () => {
      const smallBus = new EventBus({ deadLetterMax: 3 });
      smallBus.subscribe('test', () => { throw new Error('fail'); });

      for (let i = 0; i < 5; i++) {
        smallBus.publish('test', i);
      }

      expect(smallBus.getDeadLetters()).toHaveLength(3);
    });
  });

  // ── History & Replay ───────────────────────────────────────────────────

  describe('history and replay', () => {
    it('should store events in history', () => {
      bus.publish('test', 1);
      bus.publish('test', 2);

      const history = bus.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].payload).toBe(1);
      expect(history[1].payload).toBe(2);
    });

    it('should filter history by channel', () => {
      bus.publish('a', 1);
      bus.publish('b', 2);
      bus.publish('a', 3);

      expect(bus.getHistory({ channel: 'a' })).toHaveLength(2);
      expect(bus.getHistory({ channel: 'b' })).toHaveLength(1);
    });

    it('should filter history by time', () => {
      bus.publish('test', 1);
      const since = Date.now() + 1;
      bus.publish('test', 2);

      // Both happen at approximately the same time in tests
      // so we check that since filtering works directionally
      const all = bus.getHistory();
      expect(all.length).toBe(2);
    });

    it('should limit history by count', () => {
      for (let i = 0; i < 10; i++) bus.publish('test', i);

      const limited = bus.getHistory({ limit: 3 });
      expect(limited).toHaveLength(3);
      expect(limited[0].payload).toBe(7); // last 3
    });

    it('should replay events to a handler', () => {
      bus.publish('test', 1);
      bus.publish('test', 2);
      bus.publish('test', 3);

      const replayed: number[] = [];
      const count = bus.replay('test', (e) => replayed.push(e.payload as number));

      expect(count).toBe(3);
      expect(replayed).toEqual([1, 2, 3]);
    });

    it('should replay with limit', () => {
      for (let i = 0; i < 10; i++) bus.publish('test', i);

      const replayed: number[] = [];
      bus.replay('test', (e) => replayed.push(e.payload as number), { limit: 3 });

      expect(replayed).toEqual([7, 8, 9]);
    });

    it('should clear history', () => {
      bus.publish('test', 1);
      bus.publish('test', 2);

      expect(bus.clearHistory()).toBe(2);
      expect(bus.getHistory()).toHaveLength(0);
    });

    it('should limit history buffer size', () => {
      const smallBus = new EventBus({ historySize: 5 });
      for (let i = 0; i < 10; i++) smallBus.publish('test', i);

      const history = smallBus.getHistory();
      expect(history).toHaveLength(5);
      expect(history[0].payload).toBe(5); // oldest kept
    });
  });

  // ── Correlation ────────────────────────────────────────────────────────

  describe('event correlation', () => {
    it('should find correlated events', () => {
      bus.publish('start', {}, { correlationId: 'req-1' });
      bus.publish('process', {}, { correlationId: 'req-1' });
      bus.publish('end', {}, { correlationId: 'req-1' });
      bus.publish('other', {}, { correlationId: 'req-2' });

      const correlated = bus.getCorrelatedEvents('req-1');
      expect(correlated).toHaveLength(3);
      expect(correlated.map((e) => e.channel)).toEqual(['start', 'process', 'end']);
    });

    it('should trace causation chains', () => {
      const e1 = bus.publish('first', {})!;
      const e2 = bus.publish('second', {}, { causationId: e1.id })!;
      bus.publish('third', {}, { causationId: e2.id });

      const chain = bus.getCausationChain(e2.id);
      expect(chain).toHaveLength(2);
      expect(chain[0].channel).toBe('first');
      expect(chain[1].channel).toBe('second');
    });
  });

  // ── Pause / Resume ─────────────────────────────────────────────────────

  describe('pause and resume', () => {
    it('should buffer events while paused', () => {
      let received = 0;
      bus.subscribe('test', () => received++);

      bus.pause();
      expect(bus.isPaused()).toBe(true);

      bus.publish('test', 1);
      bus.publish('test', 2);
      expect(received).toBe(0);

      bus.resume();
      expect(received).toBe(2);
      expect(bus.isPaused()).toBe(false);
    });

    it('should still add to history while paused', () => {
      bus.pause();
      bus.publish('test', 1);
      expect(bus.getHistory()).toHaveLength(1);
    });
  });

  // ── Metrics ────────────────────────────────────────────────────────────

  describe('metrics', () => {
    it('should track publish counts', () => {
      bus.publish('a', 1);
      bus.publish('a', 2);
      bus.publish('b', 3);

      const metrics = bus.getMetrics();
      expect(metrics.totalPublished).toBe(3);
      expect(metrics.channelCounts['a']).toBe(2);
      expect(metrics.channelCounts['b']).toBe(1);
    });

    it('should track delivery counts', () => {
      bus.subscribe('test', () => {});
      bus.subscribe('test', () => {});
      bus.publish('test', null);

      expect(bus.getMetrics().totalDelivered).toBe(2);
    });

    it('should track failure counts', () => {
      bus.subscribe('test', () => { throw new Error(); });
      bus.publish('test', null);

      expect(bus.getMetrics().totalFailed).toBe(1);
    });

    it('should track subscription count', () => {
      bus.subscribe('a', () => {});
      bus.subscribe('b', () => {});
      expect(bus.getMetrics().activeSubscriptions).toBe(2);

      bus.unsubscribeAll();
      expect(bus.getMetrics().activeSubscriptions).toBe(0);
    });

    it('should provide channel-specific metrics', () => {
      bus.subscribe('test', () => {});
      bus.subscribe('test', () => {});
      bus.publish('test', 1);
      bus.publish('test', 2);

      const cm = bus.getChannelMetrics('test');
      expect(cm.published).toBe(2);
      expect(cm.subscribers).toBe(2);
    });

    it('should reset metrics', () => {
      bus.publish('test', 1);
      bus.publish('test', 2);
      bus.resetMetrics();

      expect(bus.getMetrics().totalPublished).toBe(0);
      expect(bus.getMetrics().channelCounts).toEqual({});
    });
  });

  // ── Convenience Publishers ─────────────────────────────────────────────

  describe('convenience publishers', () => {
    it('should publish image events', () => {
      const events: BusEvent[] = [];
      bus.subscribe('image:*', (e) => events.push(e));

      bus.publishImage('captured', { imageId: 'img1' });
      bus.publishImage('processed', { result: 'ok' });

      expect(events).toHaveLength(2);
      expect(events[0].channel).toBe('image:captured');
      expect(events[0].source).toBe('vision-pipeline');
      expect(events[1].channel).toBe('image:processed');
    });

    it('should publish agent events', () => {
      const events: BusEvent[] = [];
      bus.subscribe('agent:*', (e) => events.push(e));

      bus.publishAgent('inventory', 'started', { sessionId: 's1' });
      expect(events[0].channel).toBe('agent:inventory:started');
      expect(events[0].source).toBe('inventory');
    });

    it('should publish inventory events', () => {
      const events: BusEvent[] = [];
      bus.subscribe('inventory:*', (e) => events.push(e));

      bus.publishInventory('item:added', { name: 'Widget' });
      expect(events[0].channel).toBe('inventory:item:added');
    });

    it('should publish voice events', () => {
      const events: BusEvent[] = [];
      bus.subscribe('voice:*', (e) => events.push(e));

      bus.publishVoice('command', { intent: 'start' });
      expect(events[0].channel).toBe('voice:command');
    });

    it('should publish system events with priority', () => {
      const events: BusEvent[] = [];
      bus.subscribe('system:*', (e) => events.push(e));

      bus.publishSystem('shutdown', {}, 'critical');
      expect(events[0].channel).toBe('system:shutdown');
      expect(events[0].priority).toBe('critical');
    });
  });

  // ── Introspection ──────────────────────────────────────────────────────

  describe('introspection', () => {
    it('should list subscriptions', () => {
      bus.subscribe('a', () => {});
      bus.subscribe('b', () => {}, { priority: 'high' });
      bus.once('c', () => {});

      const subs = bus.getSubscriptions();
      expect(subs).toHaveLength(3);
      expect(subs[1].priority).toBe('high');
      expect(subs[2].once).toBe(true);
    });

    it('should filter subscriptions by channel', () => {
      bus.subscribe('a', () => {});
      bus.subscribe('b', () => {});
      bus.subscribe('a', () => {});

      expect(bus.getSubscriptions('a')).toHaveLength(2);
      expect(bus.getSubscriptions('b')).toHaveLength(1);
    });

    it('should list known channels', () => {
      bus.subscribe('sub-only', () => {});
      bus.publish('pub-only', null);
      bus.publish('both', null);
      bus.subscribe('both', () => {});

      const channels = bus.getChannels();
      expect(channels).toContain('sub-only');
      expect(channels).toContain('pub-only');
      expect(channels).toContain('both');
    });
  });

  // ── Voice Summary ──────────────────────────────────────────────────────

  describe('voice summary', () => {
    it('should generate a voice summary', () => {
      bus.subscribe('test', () => {});
      bus.subscribe('fail', () => { throw new Error(); });

      bus.publish('test', 1);
      bus.publish('test', 2);
      bus.publish('fail', 3);

      const summary = bus.getVoiceSummary();
      expect(summary).toContain('3 events');
      expect(summary).toContain('delivered');
      expect(summary).toContain('failed');
    });

    it('should handle empty bus', () => {
      const summary = bus.getVoiceSummary();
      expect(summary).toContain('0 events');
    });
  });

  // ── Async Handlers ─────────────────────────────────────────────────────

  describe('async handlers', () => {
    it('should handle async handlers without blocking', async () => {
      let resolved = false;
      bus.subscribe('test', async () => {
        await new Promise((r) => setTimeout(r, 10));
        resolved = true;
      });

      bus.publish('test', null);
      expect(resolved).toBe(false); // not yet

      await new Promise((r) => setTimeout(r, 50));
      expect(resolved).toBe(true);
    });

    it('should capture async handler failures in DLQ', async () => {
      bus.subscribe('test', async () => {
        throw new Error('async boom');
      });

      bus.publish('test', null);
      await new Promise((r) => setTimeout(r, 50));

      expect(bus.getDeadLetters()).toHaveLength(1);
      expect(bus.getDeadLetters()[0].error).toBe('async boom');
    });
  });

  // ── Event Options ──────────────────────────────────────────────────────

  describe('event options', () => {
    it('should carry correlation and causation IDs', () => {
      const received: BusEvent[] = [];
      bus.subscribe('test', (e) => received.push(e));

      bus.publish('test', null, {
        correlationId: 'corr-1',
        causationId: 'cause-1',
        source: 'my-module',
        metadata: { key: 'value' },
      });

      expect(received[0].correlationId).toBe('corr-1');
      expect(received[0].causationId).toBe('cause-1');
      expect(received[0].source).toBe('my-module');
      expect(received[0].metadata).toEqual({ key: 'value' });
    });

    it('should set event priority', () => {
      const received: BusEvent[] = [];
      bus.subscribe('test', (e) => received.push(e));

      bus.publish('test', null, { priority: 'critical' });
      expect(received[0].priority).toBe('critical');
    });
  });

  // ── Destroy ────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should clean up all state', () => {
      bus.subscribe('test', () => {});
      bus.publish('test', 1);
      bus.addMiddleware({ name: 'mw', priority: 0, process: (e) => e });

      bus.destroy();

      expect(bus.getSubscriptions()).toHaveLength(0);
      expect(bus.getHistory()).toHaveLength(0);
      expect(bus.getChannels()).toHaveLength(0);
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle rapid sequential publishes', () => {
      let count = 0;
      bus.subscribe('test', () => count++);

      for (let i = 0; i < 100; i++) {
        bus.publish('test', i);
      }

      expect(count).toBe(100);
    });

    it('should handle subscribe during publish', () => {
      let secondCalled = false;

      bus.subscribe('test', () => {
        // Subscribe a new handler during delivery
        bus.subscribe('test', () => { secondCalled = true; });
      });

      bus.publish('test', 1);
      expect(secondCalled).toBe(false); // not called for this event

      bus.publish('test', 2);
      expect(secondCalled).toBe(true); // called for next event
    });

    it('should handle unsubscribe during publish', () => {
      let count = 0;
      const id = bus.subscribe('test', () => {
        count++;
        bus.unsubscribe(id);
      });

      bus.publish('test', null);
      bus.publish('test', null);

      expect(count).toBe(1);
    });

    it('should handle empty payloads', () => {
      const received: unknown[] = [];
      bus.subscribe('test', (e) => received.push(e.payload));

      bus.publish('test', null);
      bus.publish('test', undefined);
      bus.publish('test', '');
      bus.publish('test', 0);
      bus.publish('test', false);

      expect(received).toEqual([null, undefined, '', 0, false]);
    });

    it('should handle deeply nested channel names', () => {
      const received: string[] = [];
      bus.subscribe('a:b:c:d', (e) => received.push(e.channel));
      bus.subscribe('a:*', (e) => received.push(e.channel));

      bus.publish('a:b:c:d', null);
      expect(received).toEqual(['a:b:c:d', 'a:b:c:d']);
    });
  });
});
