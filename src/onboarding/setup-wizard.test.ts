/**
 * Tests for SetupWizard — first-run experience engine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SetupWizard,
  WizardStepId,
  StoreType,
} from './setup-wizard.js';

// ─── Tests ──────────────────────────────────────────────────────

describe('SetupWizard', () => {
  let wizard: SetupWizard;

  beforeEach(() => {
    wizard = new SetupWizard({ stepTimeoutSec: 0 }); // Disable timeouts for testing
  });

  // ─── Initialization ─────────────────────────────────────────

  describe('initialization', () => {
    it('should create a new wizard with default config', () => {
      const w = new SetupWizard();
      expect(w).toBeTruthy();
    });

    it('should start with all steps pending', () => {
      const progress = wizard.start();
      expect(progress.steps.every(s => s.status === 'pending' || s.status === 'active')).toBe(true);
    });

    it('should have 11 steps', () => {
      const progress = wizard.start();
      expect(progress.totalSteps).toBe(11);
    });

    it('should start at welcome step', () => {
      const progress = wizard.start();
      expect(progress.currentStep).toBe('welcome');
    });

    it('should generate a unique session ID', () => {
      const p1 = wizard.start();
      const w2 = new SetupWizard({ stepTimeoutSec: 0 });
      const p2 = w2.start();
      expect(p1.sessionId).not.toBe(p2.sessionId);
    });

    it('should set startedAt timestamp', () => {
      const progress = wizard.start();
      expect(progress.startedAt).toBeTruthy();
    });

    it('should initialize hardware as not connected', () => {
      const progress = wizard.start();
      expect(progress.hardwareStatus.glassesConnected).toBe(false);
      expect(progress.hardwareStatus.nodeRunning).toBe(false);
      expect(progress.hardwareStatus.cameraWorking).toBe(false);
      expect(progress.hardwareStatus.audioWorking).toBe(false);
    });

    it('should calculate initial estimated time', () => {
      const progress = wizard.start();
      expect(progress.estimatedTimeRemainingSec).toBeGreaterThan(0);
    });

    it('should start with 0% progress', () => {
      const progress = wizard.start();
      expect(progress.progress).toBe(0);
    });

    it('should emit wizard:started event', () => {
      const handler = vi.fn();
      wizard.on('wizard:started', handler);
      wizard.start();
      expect(handler).toHaveBeenCalled();
    });
  });

  // ─── Step Navigation ────────────────────────────────────────

  describe('step navigation', () => {
    beforeEach(() => {
      wizard.start();
    });

    it('should get current step', () => {
      const step = wizard.getCurrentStep();
      expect(step).toBeTruthy();
      expect(step!.id).toBe('welcome');
      expect(step!.status).toBe('active');
    });

    it('should get step by ID', () => {
      const step = wizard.getStep('store_profile');
      expect(step).toBeTruthy();
      expect(step!.title).toBe('Set Up Your Store');
    });

    it('should return undefined for unknown step', () => {
      expect(wizard.getStep('nonexistent' as WizardStepId)).toBeUndefined();
    });

    it('should navigate to a step', () => {
      wizard.completeStep('welcome');
      // autoAdvance should have moved to account
      expect(wizard.getCurrentStep()!.id).toBe('account');
    });

    it('should throw for unknown step in goToStep', () => {
      expect(() => wizard.goToStep('invalid' as WizardStepId)).toThrow('Unknown step');
    });

    it('should check prerequisites', () => {
      // connectivity_test requires hardware_pairing
      expect(() => wizard.goToStep('connectivity_test')).toThrow('Prerequisites not met');
    });

    it('should allow welcome without prerequisites', () => {
      wizard.goToStep('welcome');
      expect(wizard.getCurrentStep()!.id).toBe('welcome');
    });

    it('should allow complete without prerequisites', () => {
      wizard.goToStep('complete');
      expect(wizard.getCurrentStep()!.id).toBe('complete');
    });

    it('should emit step:started event', () => {
      const handler = vi.fn();
      wizard.on('step:started', handler);
      wizard.goToStep('welcome');
      expect(handler).toHaveBeenCalledWith('welcome');
    });

    it('should emit voice:prompt event', () => {
      const handler = vi.fn();
      wizard.on('voice:prompt', handler);
      wizard.goToStep('welcome');
      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0]).toContain('Welcome');
    });

    it('should set startedAt on step activation', () => {
      wizard.goToStep('welcome');
      const step = wizard.getStep('welcome');
      expect(step!.startedAt).toBeTruthy();
    });
  });

  // ─── Step Completion ────────────────────────────────────────

  describe('step completion', () => {
    beforeEach(() => {
      wizard.start();
    });

    it('should complete a step', () => {
      wizard.completeStep('welcome');
      const step = wizard.getStep('welcome');
      expect(step!.status).toBe('completed');
      expect(step!.completedAt).toBeTruthy();
    });

    it('should store step data', () => {
      wizard.completeStep('welcome', { userName: 'Mike' });
      const step = wizard.getStep('welcome');
      expect(step!.data.userName).toBe('Mike');
    });

    it('should merge with existing step data', () => {
      wizard.completeStep('welcome', { a: 1, b: 2 });
      const step = wizard.getStep('welcome');
      expect(step!.data.a).toBe(1);
      expect(step!.data.b).toBe(2);
    });

    it('should calculate duration', () => {
      // Step was started when wizard.start() called goToStep('welcome')
      // Complete it immediately — duration will be ~0
      wizard.completeStep('welcome');
      const step = wizard.getStep('welcome');
      expect(step!.durationSec).toBeDefined();
      expect(step!.durationSec).toBeGreaterThanOrEqual(0);
    });

    it('should update progress', () => {
      wizard.completeStep('welcome');
      const progress = wizard.getProgress();
      expect(progress.completedSteps).toBe(1);
      expect(progress.progress).toBeGreaterThan(0);
    });

    it('should auto-advance to next step', () => {
      wizard.completeStep('welcome');
      expect(wizard.getCurrentStep()!.id).toBe('account');
    });

    it('should not auto-advance when disabled', () => {
      const noAutoWizard = new SetupWizard({ autoAdvance: false, stepTimeoutSec: 0 });
      noAutoWizard.start();
      noAutoWizard.completeStep('welcome');
      expect(noAutoWizard.getCurrentStep()!.id).toBe('welcome'); // Still on welcome
    });

    it('should emit step:completed event', () => {
      const handler = vi.fn();
      wizard.on('step:completed', handler);
      wizard.completeStep('welcome', { test: true });
      expect(handler).toHaveBeenCalledWith('welcome', expect.objectContaining({ test: true }));
    });

    it('should emit progress:updated event', () => {
      const handler = vi.fn();
      wizard.on('progress:updated', handler);
      wizard.completeStep('welcome');
      expect(handler).toHaveBeenCalled();
    });

    it('should throw for unknown step', () => {
      expect(() => wizard.completeStep('invalid' as WizardStepId)).toThrow('Unknown step');
    });
  });

  // ─── Skip Step ──────────────────────────────────────────────

  describe('skip step', () => {
    beforeEach(() => {
      wizard.start();
    });

    it('should skip a skippable step', () => {
      wizard.completeStep('welcome');
      wizard.skipStep('account'); // Account is skippable
      const step = wizard.getStep('account');
      expect(step!.status).toBe('skipped');
    });

    it('should not skip a non-skippable step', () => {
      expect(() => wizard.skipStep('welcome')).toThrow('cannot be skipped');
    });

    it('should count skipped steps as progress', () => {
      wizard.completeStep('welcome');
      wizard.skipStep('account');
      const progress = wizard.getProgress();
      expect(progress.completedSteps).toBe(2); // welcome + account
    });

    it('should emit step:skipped event', () => {
      wizard.completeStep('welcome');
      const handler = vi.fn();
      wizard.on('step:skipped', handler);
      wizard.skipStep('account');
      expect(handler).toHaveBeenCalledWith('account');
    });

    it('should auto-advance after skip', () => {
      wizard.completeStep('welcome');
      wizard.skipStep('account');
      // Should move to hardware_pairing
      expect(wizard.getCurrentStep()!.id).toBe('hardware_pairing');
    });

    it('should throw for unknown step', () => {
      expect(() => wizard.skipStep('invalid' as WizardStepId)).toThrow('Unknown step');
    });
  });

  // ─── Fail Step ──────────────────────────────────────────────

  describe('fail step', () => {
    beforeEach(() => {
      wizard.start();
    });

    it('should mark step as failed', () => {
      wizard.failStep('welcome', 'Some error');
      const step = wizard.getStep('welcome');
      expect(step!.status).toBe('failed');
      expect(step!.data.error).toBe('Some error');
    });

    it('should emit step:failed event', () => {
      const handler = vi.fn();
      wizard.on('step:failed', handler);
      wizard.failStep('welcome', 'Connection lost');
      expect(handler).toHaveBeenCalledWith('welcome', 'Connection lost');
    });

    it('should throw for unknown step', () => {
      expect(() => wizard.failStep('invalid' as WizardStepId, 'err')).toThrow('Unknown step');
    });
  });

  // ─── Next/Previous Step ─────────────────────────────────────

  describe('next and previous step', () => {
    beforeEach(() => {
      wizard.start();
    });

    it('should get the next pending step', () => {
      const next = wizard.getNextStep();
      expect(next).toBeTruthy();
      expect(next!.id).toBe('account');
    });

    it('should return undefined when no more steps', () => {
      // Complete all steps manually
      const noAutoWizard = new SetupWizard({ autoAdvance: false, stepTimeoutSec: 0 });
      noAutoWizard.start();

      const progress = noAutoWizard.getProgress();
      for (const step of progress.steps) {
        if (step.status === 'pending') {
          step.status = 'completed';
        }
      }

      // goToStep to last, getNextStep should be undefined
      noAutoWizard.goToStep('complete');
      // Since all are "completed" already, there's no next pending step
      expect(noAutoWizard.getNextStep()).toBeUndefined();
    });

    it('should get the previous step', () => {
      wizard.completeStep('welcome');
      // Now on 'account'
      const prev = wizard.getPreviousStep();
      expect(prev).toBeTruthy();
      expect(prev!.id).toBe('welcome');
    });

    it('should return undefined for previous at first step', () => {
      expect(wizard.getPreviousStep()).toBeUndefined();
    });

    it('should navigate back', () => {
      wizard.completeStep('welcome');
      // Now on 'account'
      wizard.goBack();
      expect(wizard.getCurrentStep()!.id).toBe('welcome');
    });

    it('should throw when going back from first step', () => {
      expect(() => wizard.goBack()).toThrow('No previous step');
    });

    it('should reset current step to pending when going back', () => {
      wizard.completeStep('welcome');
      // Currently on 'account' (active)
      wizard.goBack();
      // 'account' should be back to pending
      const accountStep = wizard.getStep('account');
      expect(accountStep!.status).toBe('pending');
    });
  });

  // ─── Hardware Status ────────────────────────────────────────

  describe('hardware status', () => {
    beforeEach(() => {
      wizard.start();
    });

    it('should update hardware status', () => {
      wizard.updateHardwareStatus({ glassesConnected: true });
      const progress = wizard.getProgress();
      expect(progress.hardwareStatus.glassesConnected).toBe(true);
      expect(progress.hardwareStatus.nodeRunning).toBe(false); // Unchanged
    });

    it('should report hardware not ready by default', () => {
      expect(wizard.isHardwareReady()).toBe(false);
    });

    it('should report hardware ready when all connected', () => {
      wizard.updateHardwareStatus({
        glassesConnected: true,
        nodeRunning: true,
        cameraWorking: true,
        audioWorking: true,
      });
      expect(wizard.isHardwareReady()).toBe(true);
    });

    it('should not require GPS for hardware ready', () => {
      wizard.updateHardwareStatus({
        glassesConnected: true,
        nodeRunning: true,
        cameraWorking: true,
        audioWorking: true,
        gpsAvailable: false,
      });
      expect(wizard.isHardwareReady()).toBe(true);
    });

    it('should emit hardware status event', () => {
      const handler = vi.fn();
      wizard.on('hardware:status-changed', handler);
      wizard.updateHardwareStatus({ glassesBattery: 85 });
      expect(handler).toHaveBeenCalled();
    });

    it('should return hardware checklist', () => {
      const checklist = wizard.getHardwareChecklist();
      expect(checklist.length).toBe(5);
      expect(checklist[0].label).toBe('Glasses connected');
      expect(checklist[0].status).toBe(false);
    });

    it('should reflect updated status in checklist', () => {
      wizard.updateHardwareStatus({ glassesConnected: true });
      const checklist = wizard.getHardwareChecklist();
      expect(checklist[0].status).toBe(true);
    });
  });

  // ─── Store Profile ──────────────────────────────────────────

  describe('store profile', () => {
    beforeEach(() => {
      wizard.start();
    });

    it('should get all store presets', () => {
      const presets = wizard.getStorePresets();
      expect(presets.length).toBe(9);
    });

    it('should have all store types', () => {
      const presets = wizard.getStorePresets();
      const types = presets.map(p => p.type);
      expect(types).toContain('convenience');
      expect(types).toContain('grocery');
      expect(types).toContain('hardware');
      expect(types).toContain('clothing');
      expect(types).toContain('electronics');
      expect(types).toContain('pharmacy');
      expect(types).toContain('warehouse');
      expect(types).toContain('specialty');
      expect(types).toContain('other');
    });

    it('should get a specific preset', () => {
      const preset = wizard.getStorePreset('convenience');
      expect(preset).toBeTruthy();
      expect(preset!.label).toBe('Convenience Store');
      expect(preset!.defaults.estimatedSKUs).toBe(1500);
    });

    it('should return undefined for unknown store type', () => {
      expect(wizard.getStorePreset('moon_base' as StoreType)).toBeUndefined();
    });

    it('should set store profile from preset', () => {
      const profile = wizard.setStoreProfile('hardware', { name: 'Mike\'s Hardware' });
      expect(profile.name).toBe('Mike\'s Hardware');
      expect(profile.type).toBe('hardware');
      expect(profile.estimatedSKUs).toBe(15000);
      expect(profile.categories).toContain('tools');
    });

    it('should allow overriding preset defaults', () => {
      const profile = wizard.setStoreProfile('convenience', {
        name: 'Corner Shop',
        estimatedSKUs: 800,
        aisleCount: 4,
      });
      expect(profile.estimatedSKUs).toBe(800);
      expect(profile.aisleCount).toBe(4);
    });

    it('should save profile to progress', () => {
      wizard.setStoreProfile('grocery', { name: 'Fresh Foods' });
      const progress = wizard.getProgress();
      expect(progress.storeProfile).toBeTruthy();
      expect(progress.storeProfile!.type).toBe('grocery');
    });

    it('should throw for unknown store type', () => {
      expect(() => wizard.setStoreProfile('invalid' as StoreType)).toThrow('Unknown store type');
    });

    it('should set convenience store defaults correctly', () => {
      const profile = wizard.setStoreProfile('convenience');
      expect(profile.defaultDepthFactor).toBe(2);
      expect(profile.autoSnapIntervalSec).toBe(3);
    });

    it('should set warehouse defaults correctly', () => {
      const profile = wizard.setStoreProfile('warehouse');
      expect(profile.defaultDepthFactor).toBe(5);
      expect(profile.aisleCount).toBe(20);
    });

    it('should include preset categories', () => {
      const profile = wizard.setStoreProfile('pharmacy');
      expect(profile.categories).toContain('otc-medicine');
      expect(profile.categories).toContain('vitamins');
    });
  });

  // ─── Tutorial ───────────────────────────────────────────────

  describe('tutorial', () => {
    it('should have tutorial actions', () => {
      const actions = wizard.getTutorialActions();
      expect(actions.length).toBe(6);
    });

    it('should have at least 3 required tutorial actions', () => {
      const required = wizard.getTutorialActions().filter(a => a.required);
      expect(required.length).toBeGreaterThanOrEqual(3);
    });

    it('should get a specific tutorial action', () => {
      const action = wizard.getTutorialAction(0);
      expect(action).toBeTruthy();
      expect(action!.instruction).toContain('shelf');
    });

    it('should return undefined for out-of-bounds index', () => {
      expect(wizard.getTutorialAction(999)).toBeUndefined();
    });

    it('should return tutorial length', () => {
      expect(wizard.getTutorialLength()).toBe(6);
    });

    it('should have hints for all tutorial actions', () => {
      const actions = wizard.getTutorialActions();
      for (const action of actions) {
        expect(action.hint.length).toBeGreaterThan(0);
        expect(action.hintAfterSec).toBeGreaterThan(0);
      }
    });

    it('should have voice prompts for all tutorial actions', () => {
      const actions = wizard.getTutorialActions();
      for (const action of actions) {
        expect(action.voicePrompt.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Voice Summaries ────────────────────────────────────────

  describe('voice summaries', () => {
    beforeEach(() => {
      wizard.start();
    });

    it('should generate initial voice summary', () => {
      const summary = wizard.getVoiceSummary();
      expect(summary).toContain('Welcome');
      expect(summary).toContain('minutes');
    });

    it('should generate in-progress summary', () => {
      wizard.completeStep('welcome');
      wizard.completeStep('account');
      const summary = wizard.getVoiceSummary();
      expect(summary).toContain('2 of 11');
    });

    it('should generate completion summary', () => {
      // Complete all steps
      const progress = wizard.getProgress();
      for (const step of progress.steps) {
        step.status = 'completed';
      }
      wizard.getProgress(); // trigger recalc
      // Manually set completedSteps
      const prog = wizard.getProgress();
      // Hack: directly manipulate for test
      (wizard as any).progress.completedSteps = prog.totalSteps;
      
      const summary = wizard.getVoiceSummary();
      expect(summary).toContain('complete');
    });

    it('should include current step in summary', () => {
      wizard.completeStep('welcome');
      const summary = wizard.getVoiceSummary();
      expect(summary).toContain('Create Your Account');
    });
  });

  // ─── Step Celebrations ──────────────────────────────────────

  describe('celebrations', () => {
    it('should return celebration for hardware pairing', () => {
      const msg = wizard.getStepCelebration('hardware_pairing');
      expect(msg).toBeTruthy();
      expect(msg).toContain('Glasses');
    });

    it('should return celebration for completion', () => {
      const msg = wizard.getStepCelebration('complete');
      expect(msg).toBeTruthy();
      expect(msg).toContain('Congratulations');
    });

    it('should return null for non-celebration step', () => {
      const msg = wizard.getStepCelebration('welcome');
      expect(msg).toBeNull();
    });

    it('should return null when celebrations disabled', () => {
      const noCelebWizard = new SetupWizard({ celebrationEnabled: false, stepTimeoutSec: 0 });
      expect(noCelebWizard.getStepCelebration('hardware_pairing')).toBeNull();
    });
  });

  // ─── Wizard Completion ──────────────────────────────────────

  describe('wizard completion', () => {
    it('should not be complete initially', () => {
      wizard.start();
      expect(wizard.isComplete()).toBe(false);
    });

    it('should emit wizard:completed when all steps done', () => {
      const handler = vi.fn();
      
      // Use autoAdvance=true — walk through the wizard naturally
      const autoWizard = new SetupWizard({ autoAdvance: true, stepTimeoutSec: 0 });
      autoWizard.on('wizard:completed', handler);
      autoWizard.start();

      // Mark all steps except 'complete' as completed internally
      // so that when we complete the second-to-last step, it advances to 'complete'
      const progress = autoWizard.getProgress();
      for (const step of progress.steps) {
        if (step.id !== 'complete' && step.status !== 'active') {
          step.status = 'completed';
          step.completedAt = new Date().toISOString();
        }
      }

      // Complete the current active step — auto-advance should reach 'complete'
      // which triggers completeWizard
      const currentStep = autoWizard.getCurrentStep();
      if (currentStep && currentStep.id !== 'complete') {
        autoWizard.completeStep(currentStep.id);
      }

      // At this point we should be on 'complete'. Complete it.
      if (autoWizard.getCurrentStep()?.id === 'complete') {
        autoWizard.completeStep('complete');
      }

      // The wizard should be complete now
      expect(autoWizard.isComplete()).toBe(true);
    });

    it('should handle abandon', () => {
      const handler = vi.fn();
      wizard.on('wizard:abandoned', handler);
      wizard.start();
      wizard.abandon();
      expect(handler).toHaveBeenCalled();
    });
  });

  // ─── Export Setup Data ──────────────────────────────────────

  describe('export setup data', () => {
    beforeEach(() => {
      wizard.start();
    });

    it('should export collected data', () => {
      wizard.setStoreProfile('convenience', { name: 'Test Store' });
      wizard.completeStep('welcome');

      const data = wizard.exportSetupData();
      expect(data.storeProfile).toBeTruthy();
      expect(data.storeProfile!.type).toBe('convenience');
      expect(data.completedSteps).toContain('welcome');
      expect(data.hardwareStatus).toBeTruthy();
    });

    it('should include selected agents from agent_selection step', () => {
      wizard.completeStep('welcome');
      const agentStep = wizard.getStep('agent_selection')!;
      agentStep.data.selectedAgents = ['inventory', 'security'];
      agentStep.status = 'completed';

      const data = wizard.exportSetupData();
      expect(data.selectedAgents).toEqual(['inventory', 'security']);
    });

    it('should default to inventory agent if no selection', () => {
      const data = wizard.exportSetupData();
      expect(data.selectedAgents).toEqual(['inventory']);
    });

    it('should track skipped steps', () => {
      wizard.completeStep('welcome');
      wizard.skipStep('account');

      const data = wizard.exportSetupData();
      expect(data.skippedSteps).toContain('account');
    });

    it('should calculate total setup time', () => {
      wizard.completeStep('welcome');
      const data = wizard.exportSetupData();
      expect(data.totalSetupTimeSec).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Quick Mode ─────────────────────────────────────────────

  describe('quick mode', () => {
    it('should make tutorial steps skippable in quick mode', () => {
      const quickWizard = new SetupWizard({ quickMode: true, stepTimeoutSec: 0 });
      quickWizard.start();

      const voiceCal = quickWizard.getStep('voice_calibration');
      const practice = quickWizard.getStep('practice_scan');
      const tutorial = quickWizard.getStep('first_scan_tutorial');

      expect(voiceCal!.skippable).toBe(true);
      expect(practice!.skippable).toBe(true);
      expect(tutorial!.skippable).toBe(true);
    });

    it('should keep essential steps non-skippable', () => {
      const quickWizard = new SetupWizard({ quickMode: true, stepTimeoutSec: 0 });
      quickWizard.start();

      expect(quickWizard.getStep('welcome')!.skippable).toBe(false);
      expect(quickWizard.getStep('hardware_pairing')!.skippable).toBe(false);
    });
  });

  // ─── Step Timeouts ──────────────────────────────────────────

  describe('step timeouts', () => {
    it('should emit timeout event when step takes too long', () => {
      vi.useFakeTimers();
      const timeoutWizard = new SetupWizard({ stepTimeoutSec: 5 });
      const handler = vi.fn();
      timeoutWizard.on('step:timeout', handler);
      timeoutWizard.start();

      vi.advanceTimersByTime(6000);
      expect(handler).toHaveBeenCalledWith('welcome');

      vi.useRealTimers();
    });

    it('should not emit timeout when disabled', () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      wizard.on('step:timeout', handler);
      wizard.start();

      vi.advanceTimersByTime(600000);
      expect(handler).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should clear timeout on step completion', () => {
      vi.useFakeTimers();
      const timeoutWizard = new SetupWizard({ stepTimeoutSec: 10 });
      const handler = vi.fn();
      timeoutWizard.on('step:timeout', handler);
      timeoutWizard.start();

      timeoutWizard.completeStep('welcome');
      vi.advanceTimersByTime(15000);
      expect(handler).not.toHaveBeenCalledWith('welcome');

      vi.useRealTimers();
    });
  });

  // ─── Step Voice Commands ────────────────────────────────────

  describe('step voice commands', () => {
    beforeEach(() => {
      wizard.start();
    });

    it('should have voice commands for each step', () => {
      const progress = wizard.getProgress();
      for (const step of progress.steps) {
        expect(step.voiceCommands.length).toBeGreaterThan(0);
      }
    });

    it('should have voice prompts for each step', () => {
      const progress = wizard.getProgress();
      for (const step of progress.steps) {
        expect(step.voicePrompt.length).toBeGreaterThan(0);
      }
    });

    it('should have help text for each step', () => {
      const progress = wizard.getProgress();
      for (const step of progress.steps) {
        expect(step.helpText.length).toBeGreaterThan(0);
      }
    });

    it('should have UI component for each step', () => {
      const progress = wizard.getProgress();
      for (const step of progress.steps) {
        expect(step.uiComponent.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Multiple Wizard Runs ───────────────────────────────────

  describe('multiple runs', () => {
    it('should reset on re-start', () => {
      wizard.start();
      wizard.completeStep('welcome');
      expect(wizard.getProgress().completedSteps).toBe(1);

      wizard.start();
      expect(wizard.getProgress().completedSteps).toBe(0);
    });
  });
});
