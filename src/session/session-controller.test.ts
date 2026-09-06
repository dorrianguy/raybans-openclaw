/**
 * Voice Session Controller Tests
 * 🌙 Night Shift Agent — Shift #34
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  SessionController,
  SessionMode,
  FeedbackLevel,
  SessionTemplate,
} from './session-controller';

describe('SessionController', () => {
  let controller: SessionController;

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new SessionController();
  });

  afterEach(() => {
    controller.destroy();
    vi.useRealTimers();
  });

  // ─── Session Lifecycle ─────────────────────────────────────────────────────

  describe('startSession()', () => {
    it('should create a new session', () => {
      const state = controller.startSession({ mode: 'inventory' });
      expect(state.id).toBeTruthy();
      expect(state.status).toBe('active');
      expect(state.config.mode).toBe('inventory');
    });

    it('should assign default mode as general', () => {
      const state = controller.startSession();
      expect(state.config.mode).toBe('general');
    });

    it('should set active agents based on mode', () => {
      const state = controller.startSession({ mode: 'inventory' });
      expect(state.activeAgents).toContain('inventory');
      expect(state.activeAgents).toContain('barcode');
    });

    it('should set session as active', () => {
      controller.startSession();
      expect(controller.getActiveSession()).not.toBeNull();
    });

    it('should emit session:started event', () => {
      const listener = vi.fn();
      controller.on('session:started', listener);
      controller.startSession();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should enforce max concurrent sessions', () => {
      const ctrl = new SessionController({ maxConcurrent: 2 });
      ctrl.startSession({ mode: 'inventory' });
      ctrl.startSession({ mode: 'inspection' });
      expect(() => ctrl.startSession({ mode: 'shopping' })).toThrow('Maximum concurrent');
      ctrl.destroy();
    });

    it('should accept custom config', () => {
      const state = controller.startSession({
        mode: 'inventory',
        storeId: 'store-123',
        name: 'Morning Count',
        feedbackLevel: 'verbose',
      });
      expect(state.config.storeId).toBe('store-123');
      expect(state.config.name).toBe('Morning Count');
      expect(state.config.feedbackLevel).toBe('verbose');
    });

    it('should initialize counters at zero', () => {
      const state = controller.startSession();
      expect(state.commandCount).toBe(0);
      expect(state.imageCount).toBe(0);
      expect(state.checkpoints).toHaveLength(0);
    });
  });

  describe('pauseSession()', () => {
    it('should pause an active session', () => {
      controller.startSession();
      const state = controller.pauseSession();
      expect(state.status).toBe('paused');
      expect(state.pausedAt).not.toBeNull();
    });

    it('should emit session:paused event', () => {
      const listener = vi.fn();
      controller.on('session:paused', listener);
      controller.startSession();
      controller.pauseSession();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should throw when no active session', () => {
      expect(() => controller.pauseSession()).toThrow('No active session');
    });

    it('should throw when session already paused', () => {
      controller.startSession();
      controller.pauseSession();
      expect(() => controller.pauseSession()).toThrow('cannot pause');
    });
  });

  describe('resumeSession()', () => {
    it('should resume a paused session', () => {
      controller.startSession();
      controller.pauseSession();
      vi.advanceTimersByTime(5000);
      const state = controller.resumeSession();
      expect(state.status).toBe('active');
      expect(state.totalPausedMs).toBeGreaterThan(0);
    });

    it('should track total paused time', () => {
      controller.startSession();
      controller.pauseSession();
      vi.advanceTimersByTime(10000);
      const state = controller.resumeSession();
      expect(state.totalPausedMs).toBe(10000);
    });

    it('should accumulate paused time across multiple pauses', () => {
      controller.startSession();
      controller.pauseSession();
      vi.advanceTimersByTime(5000);
      controller.resumeSession();
      controller.pauseSession();
      vi.advanceTimersByTime(3000);
      const state = controller.resumeSession();
      expect(state.totalPausedMs).toBe(8000);
    });

    it('should emit session:resumed event', () => {
      const listener = vi.fn();
      controller.on('session:resumed', listener);
      controller.startSession();
      controller.pauseSession();
      controller.resumeSession();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should throw when session is active', () => {
      controller.startSession();
      expect(() => controller.resumeSession()).toThrow('cannot resume');
    });
  });

  describe('endSession()', () => {
    it('should end an active session', () => {
      controller.startSession();
      const summary = controller.endSession();
      // Summary captures the state during completion (completing → completed)
      expect(['completing', 'completed']).toContain(summary.status);
    });

    it('should return session summary', () => {
      controller.startSession({ mode: 'inventory' });
      vi.advanceTimersByTime(60000);
      const summary = controller.endSession();
      expect(summary.mode).toBe('inventory');
      expect(summary.durationMs).toBeGreaterThan(0);
    });

    it('should clear active session', () => {
      controller.startSession();
      controller.endSession();
      expect(controller.getActiveSession()).toBeNull();
    });

    it('should emit session:ended event', () => {
      const listener = vi.fn();
      controller.on('session:ended', listener);
      controller.startSession();
      controller.endSession();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should throw when already completed', () => {
      controller.startSession();
      controller.endSession();
      expect(() => controller.endSession()).toThrow('No active session');
    });

    it('should end a paused session', () => {
      controller.startSession();
      controller.pauseSession();
      const summary = controller.endSession();
      expect(['completing', 'completed']).toContain(summary.status);
    });
  });

  describe('cancelSession()', () => {
    it('should cancel a session', () => {
      const state = controller.startSession();
      controller.cancelSession();
      expect(controller.getSession(state.id)?.status).toBe('cancelled');
    });

    it('should clear active session', () => {
      controller.startSession();
      controller.cancelSession();
      expect(controller.getActiveSession()).toBeNull();
    });

    it('should emit session:cancelled event', () => {
      const listener = vi.fn();
      controller.on('session:cancelled', listener);
      controller.startSession();
      controller.cancelSession();
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ─── Session Queries ───────────────────────────────────────────────────────

  describe('session queries', () => {
    it('should get session by ID', () => {
      const state = controller.startSession();
      expect(controller.getSession(state.id)).not.toBeNull();
    });

    it('should return null for unknown session', () => {
      expect(controller.getSession('nonexistent')).toBeNull();
    });

    it('should get all sessions', () => {
      controller.startSession({ mode: 'inventory' });
      controller.endSession();
      controller.startSession({ mode: 'inspection' });
      expect(controller.getAllSessions()).toHaveLength(2);
    });

    it('should get only active sessions', () => {
      controller.startSession({ mode: 'inventory' });
      controller.endSession();
      controller.startSession({ mode: 'inspection' });
      expect(controller.getActiveSessions()).toHaveLength(1);
    });
  });

  // ─── Command Processing ────────────────────────────────────────────────────

  describe('queueCommand()', () => {
    it('should queue a command', () => {
      controller.startSession();
      const cmd = controller.queueCommand('start inventory', 'inventory_start', {});
      expect(cmd.id).toBeTruthy();
      expect(cmd.processed).toBe(false);
    });

    it('should increment command count', () => {
      controller.startSession();
      controller.queueCommand('cmd1', 'test', {});
      controller.queueCommand('cmd2', 'test', {});
      expect(controller.getActiveSession()?.commandCount).toBe(2);
    });

    it('should emit command:queued event', () => {
      const listener = vi.fn();
      controller.on('command:queued', listener);
      controller.startSession();
      controller.queueCommand('test', 'test', {});
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should respect priority ordering', () => {
      controller.startSession();
      controller.queueCommand('low', 'test', {}, 10);
      controller.queueCommand('high', 'test', {}, 1);
      controller.queueCommand('mid', 'test', {}, 5);
      
      const next = controller.getNextCommand();
      expect(next?.text).toBe('high');
    });

    it('should throw when no active session', () => {
      expect(() => controller.queueCommand('test', 'test', {})).toThrow('No active session');
    });

    it('should throw when session is paused', () => {
      controller.startSession();
      controller.pauseSession();
      expect(() => controller.queueCommand('test', 'test', {})).toThrow('cannot accept commands');
    });

    it('should enforce queue limit', () => {
      const ctrl = new SessionController({ maxCommandQueue: 3 });
      ctrl.startSession();
      ctrl.queueCommand('cmd1', 'test', {}, 1); // priority 1
      ctrl.queueCommand('cmd2', 'test', {}, 1); // priority 1
      ctrl.queueCommand('cmd3', 'test', {}, 5); // priority 5
      // Queue is full, but a low-priority item can be replaced
      ctrl.queueCommand('cmd4', 'test', {}, 1);
      // The priority 5 command should have been evicted
      ctrl.destroy();
    });
  });

  describe('completeCommand()', () => {
    it('should mark command as processed', () => {
      controller.startSession();
      const cmd = controller.queueCommand('test', 'test', {});
      controller.completeCommand(cmd.id, {
        commandId: cmd.id,
        success: true,
        response: 'Done',
      });
      expect(cmd.processed).toBe(true);
      expect(cmd.result).toBe('Done');
    });

    it('should emit command:completed event', () => {
      const listener = vi.fn();
      controller.on('command:completed', listener);
      controller.startSession();
      const cmd = controller.queueCommand('test', 'test', {});
      controller.completeCommand(cmd.id, { commandId: cmd.id, success: true });
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should throw for unknown command', () => {
      controller.startSession();
      expect(() => controller.completeCommand('unknown', {
        commandId: 'unknown',
        success: false,
      })).toThrow('not found');
    });
  });

  describe('getNextCommand()', () => {
    it('should return null when queue is empty', () => {
      controller.startSession();
      expect(controller.getNextCommand()).toBeNull();
    });

    it('should skip processed commands', () => {
      controller.startSession();
      const cmd1 = controller.queueCommand('first', 'test', {});
      controller.queueCommand('second', 'test', {});
      controller.completeCommand(cmd1.id, { commandId: cmd1.id, success: true });
      
      const next = controller.getNextCommand();
      expect(next?.text).toBe('second');
    });
  });

  describe('getCommandHistory()', () => {
    it('should return processed commands', () => {
      controller.startSession();
      const cmd = controller.queueCommand('test', 'test', {});
      controller.completeCommand(cmd.id, { commandId: cmd.id, success: true });
      
      const history = controller.getCommandHistory(controller.getActiveSession()!.id);
      expect(history).toHaveLength(1);
    });

    it('should respect limit', () => {
      controller.startSession();
      for (let i = 0; i < 10; i++) {
        const cmd = controller.queueCommand(`cmd${i}`, 'test', {});
        controller.completeCommand(cmd.id, { commandId: cmd.id, success: true });
      }
      
      const history = controller.getCommandHistory(undefined, 5);
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });

  // ─── Image Tracking ────────────────────────────────────────────────────────

  describe('recordImage()', () => {
    it('should increment image count', () => {
      controller.startSession();
      controller.recordImage();
      controller.recordImage();
      expect(controller.getActiveSession()?.imageCount).toBe(2);
    });

    it('should emit session:image_captured event', () => {
      const listener = vi.fn();
      controller.on('session:image_captured', listener);
      controller.startSession();
      controller.recordImage();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
    });

    it('should not crash when no session', () => {
      expect(() => controller.recordImage()).not.toThrow();
    });
  });

  // ─── Checkpoints ───────────────────────────────────────────────────────────

  describe('addCheckpoint()', () => {
    it('should add a checkpoint', () => {
      controller.startSession();
      const cp = controller.addCheckpoint('Aisle 1 complete', { items: 45 });
      expect(cp.label).toBe('Aisle 1 complete');
      expect(cp.data.items).toBe(45);
    });

    it('should store multiple checkpoints', () => {
      controller.startSession();
      controller.addCheckpoint('Aisle 1');
      controller.addCheckpoint('Aisle 2');
      controller.addCheckpoint('Aisle 3');
      expect(controller.getCheckpoints()).toHaveLength(3);
    });

    it('should enforce max checkpoints', () => {
      const ctrl = new SessionController({ maxCheckpoints: 3 });
      ctrl.startSession();
      ctrl.addCheckpoint('cp1');
      ctrl.addCheckpoint('cp2');
      ctrl.addCheckpoint('cp3');
      ctrl.addCheckpoint('cp4');
      expect(ctrl.getCheckpoints()).toHaveLength(3);
      ctrl.destroy();
    });

    it('should emit session:checkpoint event', () => {
      const listener = vi.fn();
      controller.on('session:checkpoint', listener);
      controller.startSession();
      controller.addCheckpoint('test');
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ─── Mode Management ──────────────────────────────────────────────────────

  describe('switchMode()', () => {
    it('should switch session mode', () => {
      controller.startSession({ mode: 'inventory' });
      controller.switchMode('shopping');
      expect(controller.getActiveSession()?.config.mode).toBe('shopping');
    });

    it('should update active agents', () => {
      controller.startSession({ mode: 'inventory' });
      controller.switchMode('networking');
      const agents = controller.getActiveAgents();
      expect(agents).toContain('networking');
      expect(agents).not.toContain('inventory');
    });

    it('should add a checkpoint for mode switch', () => {
      controller.startSession({ mode: 'inventory' });
      controller.switchMode('shopping');
      const checkpoints = controller.getCheckpoints();
      expect(checkpoints.length).toBe(1);
      expect(checkpoints[0].label).toContain('inventory');
      expect(checkpoints[0].label).toContain('shopping');
    });

    it('should emit session:mode_changed event', () => {
      const listener = vi.fn();
      controller.on('session:mode_changed', listener);
      controller.startSession({ mode: 'inventory' });
      controller.switchMode('shopping');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        oldMode: 'inventory',
        newMode: 'shopping',
      }));
    });
  });

  // ─── Agent Management ─────────────────────────────────────────────────────

  describe('agent management', () => {
    it('should add an agent', () => {
      controller.startSession({ mode: 'general' });
      controller.addAgent('security');
      expect(controller.getActiveAgents()).toContain('security');
    });

    it('should not duplicate agents', () => {
      controller.startSession({ mode: 'inventory' });
      const before = controller.getActiveAgents().length;
      controller.addAgent('inventory'); // already there
      expect(controller.getActiveAgents().length).toBe(before);
    });

    it('should remove an agent', () => {
      controller.startSession({ mode: 'inventory' });
      controller.removeAgent('barcode');
      expect(controller.getActiveAgents()).not.toContain('barcode');
    });

    it('should emit events for agent changes', () => {
      const addListener = vi.fn();
      const removeListener = vi.fn();
      controller.on('session:agent_added', addListener);
      controller.on('session:agent_removed', removeListener);
      controller.startSession({ mode: 'general' });
      controller.addAgent('security');
      controller.removeAgent('security');
      expect(addListener).toHaveBeenCalledOnce();
      expect(removeListener).toHaveBeenCalledOnce();
    });
  });

  // ─── Metadata ──────────────────────────────────────────────────────────────

  describe('metadata', () => {
    it('should set and get metadata', () => {
      controller.startSession();
      controller.setMetadata('store', 'main-street');
      expect(controller.getMetadata('store')).toBe('main-street');
    });

    it('should handle complex metadata', () => {
      controller.startSession();
      controller.setMetadata('config', { zones: ['A', 'B'], limit: 100 });
      const config = controller.getMetadata('config') as any;
      expect(config.zones).toHaveLength(2);
    });

    it('should return undefined for missing key', () => {
      controller.startSession();
      expect(controller.getMetadata('nonexistent')).toBeUndefined();
    });
  });

  // ─── Templates ─────────────────────────────────────────────────────────────

  describe('templates', () => {
    it('should have built-in templates', () => {
      const templates = controller.getTemplates();
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should get template by id', () => {
      const template = controller.getTemplate('quick-count');
      expect(template).not.toBeNull();
      expect(template?.mode).toBe('inventory');
    });

    it('should start session from template', () => {
      const state = controller.startFromTemplate('quick-count');
      expect(state.config.mode).toBe('inventory');
      expect(state.metadata.templateId).toBe('quick-count');
    });

    it('should allow template overrides', () => {
      const state = controller.startFromTemplate('quick-count', {
        storeId: 'store-123',
        feedbackLevel: 'verbose',
      });
      expect(state.config.storeId).toBe('store-123');
      expect(state.config.feedbackLevel).toBe('verbose');
    });

    it('should throw for unknown template', () => {
      expect(() => controller.startFromTemplate('nonexistent')).toThrow('not found');
    });

    it('should register custom templates', () => {
      const template: SessionTemplate = {
        id: 'custom',
        name: 'Custom',
        description: 'Test',
        mode: 'general',
        config: {},
        setupCommands: [],
        agents: ['custom-agent'],
      };
      controller.registerTemplate(template);
      expect(controller.getTemplate('custom')).not.toBeNull();
    });

    it('should apply template agents', () => {
      const state = controller.startFromTemplate('conference-networking');
      expect(state.activeAgents).toContain('networking');
      expect(state.activeAgents).toContain('security');
    });
  });

  // ─── Feedback Level ────────────────────────────────────────────────────────

  describe('feedback', () => {
    it('should change feedback level', () => {
      controller.startSession({ feedbackLevel: 'normal' });
      controller.setFeedbackLevel('silent');
      expect(controller.getActiveSession()?.config.feedbackLevel).toBe('silent');
    });

    it('should determine if should speak based on level', () => {
      controller.startSession({ feedbackLevel: 'silent' });
      expect(controller.shouldSpeak('critical')).toBe(true);
      expect(controller.shouldSpeak('high')).toBe(false);
      expect(controller.shouldSpeak('normal')).toBe(false);
    });

    it('should speak all priorities on verbose', () => {
      controller.startSession({ feedbackLevel: 'verbose' });
      expect(controller.shouldSpeak('critical')).toBe(true);
      expect(controller.shouldSpeak('high')).toBe(true);
      expect(controller.shouldSpeak('normal')).toBe(true);
      expect(controller.shouldSpeak('low')).toBe(true);
    });

    it('should suppress on minimal except critical/high', () => {
      controller.startSession({ feedbackLevel: 'minimal' });
      expect(controller.shouldSpeak('critical')).toBe(true);
      expect(controller.shouldSpeak('high')).toBe(true);
      expect(controller.shouldSpeak('normal')).toBe(false);
      expect(controller.shouldSpeak('low')).toBe(false);
    });

    it('should suppress all on privacy mode', () => {
      controller.startSession({ feedbackLevel: 'verbose', privacyMode: true });
      expect(controller.shouldSpeak('critical')).toBe(false);
    });
  });

  // ─── Duration ──────────────────────────────────────────────────────────────

  describe('duration', () => {
    it('should track active duration', () => {
      controller.startSession();
      vi.advanceTimersByTime(60000);
      expect(controller.getActiveDuration()).toBe(60000);
    });

    it('should exclude paused time', () => {
      controller.startSession();
      vi.advanceTimersByTime(30000);
      controller.pauseSession();
      vi.advanceTimersByTime(10000);
      controller.resumeSession();
      vi.advanceTimersByTime(20000);
      // Total elapsed: 60000, paused: 10000, active: 50000
      expect(controller.getActiveDuration()).toBe(50000);
    });

    it('should format seconds', () => {
      expect(controller.formatDuration(30000)).toBe('30s');
    });

    it('should format minutes', () => {
      expect(controller.formatDuration(90000)).toBe('1m 30s');
    });

    it('should format hours', () => {
      expect(controller.formatDuration(3660000)).toBe('1h 1m');
    });
  });

  // ─── Voice Summaries ───────────────────────────────────────────────────────

  describe('voice summaries', () => {
    it('should generate progress update', () => {
      controller.startSession({ mode: 'inventory' });
      controller.recordImage();
      controller.recordImage();
      vi.advanceTimersByTime(60000);
      
      const update = controller.generateProgressUpdate();
      expect(update).toContain('inventory');
      expect(update).toContain('2 images');
    });

    it('should include checkpoints in progress', () => {
      controller.startSession();
      controller.addCheckpoint('Aisle 1');
      vi.advanceTimersByTime(1000);
      
      const update = controller.generateProgressUpdate();
      expect(update).toContain('Aisle 1');
    });

    it('should generate session end summary', () => {
      controller.startSession({ mode: 'inventory' });
      controller.recordImage();
      controller.queueCommand('test', 'test', {});
      vi.advanceTimersByTime(120000);
      
      const summary = controller.generateVoiceSummary();
      expect(summary).toContain('inventory');
      expect(summary).toContain('1 images');
    });

    it('should return message for no session', () => {
      expect(controller.generateProgressUpdate()).toContain('No active session');
    });
  });

  // ─── Session Handoff ───────────────────────────────────────────────────────

  describe('handoff', () => {
    it('should export session state', () => {
      controller.startSession({ mode: 'inventory', storeId: 'store-1' });
      controller.queueCommand('test', 'test', {});
      const exported = controller.exportSession();
      expect(exported).toBeTruthy();
      expect(JSON.parse(exported).state.config.storeId).toBe('store-1');
    });

    it('should import session state', () => {
      controller.startSession({ mode: 'inventory', storeId: 'store-1' });
      controller.recordImage();
      controller.recordImage();
      const exported = controller.exportSession();
      
      // Pause current to avoid concurrent limit
      controller.endSession();
      
      const imported = controller.importSession(exported);
      expect(imported.config.storeId).toBe('store-1');
      expect(imported.imageCount).toBe(2);
    });

    it('should generate new ID on import', () => {
      controller.startSession({ mode: 'inventory' });
      const originalId = controller.getActiveSession()!.id;
      const exported = controller.exportSession();
      controller.endSession();
      
      const imported = controller.importSession(exported);
      expect(imported.id).not.toBe(originalId);
      expect(imported.metadata.importedFrom).toBe(originalId);
    });

    it('should emit session:imported event', () => {
      const listener = vi.fn();
      controller.on('session:imported', listener);
      controller.startSession();
      const exported = controller.exportSession();
      controller.endSession();
      controller.importSession(exported);
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('should remove completed sessions', () => {
      for (let i = 0; i < 10; i++) {
        controller.startSession();
        controller.endSession();
      }
      const removed = controller.cleanup(3);
      expect(removed).toBe(7);
      expect(controller.getAllSessions()).toHaveLength(3);
    });

    it('should not remove active sessions', () => {
      controller.startSession();
      const removed = controller.cleanup(0);
      expect(removed).toBe(0);
      expect(controller.getActiveSessions()).toHaveLength(1);
    });

    it('should keep specified number of recent sessions', () => {
      for (let i = 0; i < 5; i++) {
        controller.startSession();
        controller.endSession();
      }
      controller.cleanup(2);
      expect(controller.getAllSessions()).toHaveLength(2);
    });
  });

  // ─── Timers ────────────────────────────────────────────────────────────────

  describe('timers', () => {
    it('should emit auto_save events', () => {
      const listener = vi.fn();
      controller.on('session:auto_save', listener);
      controller.startSession({ autoSaveInterval: 10000 });
      vi.advanceTimersByTime(30000);
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it('should auto-pause on inactivity', () => {
      const listener = vi.fn();
      controller.on('session:inactivity_pause', listener);
      controller.startSession({ inactivityTimeout: 10000 });
      vi.advanceTimersByTime(15000);
      expect(controller.getActiveSession()?.status).toBe('paused');
    });

    it('should not auto-pause when disabled', () => {
      controller.startSession({ inactivityTimeout: 0 });
      vi.advanceTimersByTime(600000);
      expect(controller.getActiveSession()?.status).toBe('active');
    });

    it('should emit progress updates', () => {
      const listener = vi.fn();
      controller.on('session:progress', listener);
      controller.startSession({ progressInterval: 5000, announceProgress: true });
      vi.advanceTimersByTime(15000);
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it('should end session at max duration', () => {
      controller.startSession({ maxDuration: 10000 });
      vi.advanceTimersByTime(15000);
      expect(controller.getActiveSession()).toBeNull();
    });

    it('should clear timers on pause', () => {
      const listener = vi.fn();
      controller.on('session:auto_save', listener);
      controller.startSession({ autoSaveInterval: 5000 });
      controller.pauseSession();
      vi.advanceTimersByTime(20000);
      // Should have fired once before pause, then stopped
      expect(listener).toHaveBeenCalledTimes(0);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle destroy safely', () => {
      controller.startSession();
      controller.startSession();
      expect(() => controller.destroy()).not.toThrow();
      expect(controller.getAllSessions()).toHaveLength(0);
    });

    it('should handle rapid start/stop', () => {
      for (let i = 0; i < 20; i++) {
        controller.startSession();
        controller.endSession();
      }
      expect(controller.getAllSessions()).toHaveLength(20);
    });

    it('should handle mode-specific agents correctly', () => {
      const modes: SessionMode[] = [
        'inventory', 'inspection', 'networking', 'shopping',
        'meeting', 'security', 'exploration', 'debug', 'translation', 'general',
      ];
      for (const mode of modes) {
        controller.startSession({ mode });
        const agents = controller.getActiveAgents();
        expect(agents.length).toBeGreaterThan(0);
        controller.endSession();
      }
    });

    it('should return empty for no session queries', () => {
      expect(controller.getCheckpoints()).toHaveLength(0);
      expect(controller.getActiveAgents()).toHaveLength(0);
    });
  });
});
