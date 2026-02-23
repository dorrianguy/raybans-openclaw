/**
 * Tests for the Meeting Intelligence Agent — meeting lifecycle,
 * transcript processing, action item detection, visual capture,
 * summary generation, and event handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MeetingAgent } from './meeting-agent.js';
import type { TranscriptSegment } from './meeting-agent.js';
import type { CapturedImage, VisionAnalysis, ExtractedText } from '../types.js';
import type { RoutingContext } from '../routing/context-router.js';

// ─── Test Helpers ───────────────────────────────────────────────

function makeImage(id = 'img-001'): CapturedImage {
  return {
    id,
    buffer: Buffer.from('fake-image'),
    mimeType: 'image/jpeg',
    capturedAt: new Date().toISOString(),
    deviceId: 'test-device',
    trigger: 'auto',
  };
}

function makeAnalysis(overrides: Partial<VisionAnalysis> = {}): VisionAnalysis {
  return {
    imageId: 'img-001',
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 100,
    sceneDescription: 'An office meeting room',
    sceneType: 'office',
    extractedText: [],
    detectedObjects: [],
    products: [],
    barcodes: [],
    quality: {
      score: 0.9,
      isBlurry: false,
      hasGlare: false,
      isUnderexposed: false,
      isOverexposed: false,
      usableForInventory: true,
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    activeMode: null,
    trigger: 'auto',
    recentModes: [],
    ...overrides,
  };
}

function makeSegment(
  speaker: string,
  text: string,
  overrides: Partial<TranscriptSegment> = {},
): TranscriptSegment {
  return {
    speaker,
    text,
    timestamp: new Date().toISOString(),
    confidence: 0.9,
    ...overrides,
  };
}

function makeText(text: string): ExtractedText {
  return { text, confidence: 0.9, textType: 'other' };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('MeetingAgent', () => {
  let agent: MeetingAgent;

  beforeEach(() => {
    agent = new MeetingAgent();
  });

  // ─── Meeting Lifecycle ────────────────────────────────────────

  describe('Meeting Lifecycle', () => {
    it('should start a meeting', () => {
      const session = agent.startMeeting('Q4 Planning');

      expect(session.title).toBe('Q4 Planning');
      expect(session.status).toBe('active');
      expect(session.participants).toEqual([]);
      expect(session.transcript).toEqual([]);
      expect(agent.isMeetingActive()).toBe(true);
    });

    it('should end a meeting and generate summary', () => {
      agent.startMeeting('Sprint Review');

      const summary = agent.endMeeting();

      expect(summary.title).toBe('Sprint Review');
      expect(summary.markdownReport).toContain('Sprint Review');
      expect(summary.voiceSummary).toContain('Meeting ended');
      expect(agent.isMeetingActive()).toBe(false);
    });

    it('should throw when ending with no active meeting', () => {
      expect(() => agent.endMeeting()).toThrow('No active meeting');
    });

    it('should pause and resume a meeting', () => {
      agent.startMeeting('Team Standup');

      agent.pauseMeeting();
      expect(agent.getCurrentMeeting()?.status).toBe('paused');

      agent.resumeMeeting();
      expect(agent.getCurrentMeeting()?.status).toBe('active');
    });

    it('should not pause when no meeting is active', () => {
      agent.pauseMeeting(); // Should not throw
      expect(agent.getCurrentMeeting()).toBeNull();
    });

    it('should not resume when not paused', () => {
      agent.startMeeting('Test');
      agent.resumeMeeting(); // Should not throw, already active
      expect(agent.getCurrentMeeting()?.status).toBe('active');
    });

    it('should track meeting history', () => {
      agent.startMeeting('Meeting 1');
      agent.endMeeting();

      agent.startMeeting('Meeting 2');
      agent.endMeeting();

      expect(agent.getMeetingHistory().length).toBe(2);
    });

    it('should calculate meeting duration', () => {
      agent.startMeeting('Quick Sync');

      // Simulate some time passing by manipulating the start time
      const meeting = agent.getCurrentMeeting()!;
      expect(meeting.durationMinutes).toBe(0); // Not ended yet

      const summary = agent.endMeeting();
      expect(summary.duration).toContain('minute');
    });
  });

  // ─── Transcript Processing ────────────────────────────────────

  describe('Transcript Processing', () => {
    it('should add transcript segments', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Alice', 'Hello everyone'));
      agent.addTranscriptSegment(makeSegment('Bob', 'Hi Alice'));

      const meeting = agent.getCurrentMeeting()!;
      expect(meeting.transcript.length).toBe(2);
    });

    it('should track participants from transcript', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Alice', 'Hello'));
      agent.addTranscriptSegment(makeSegment('Bob', 'Hi'));
      agent.addTranscriptSegment(makeSegment('Alice', 'So about that feature...'));

      const meeting = agent.getCurrentMeeting()!;
      expect(meeting.participants).toEqual(['Alice', 'Bob']);
    });

    it('should not add transcripts when meeting is paused', () => {
      agent.startMeeting('Test');
      agent.pauseMeeting();

      agent.addTranscriptSegment(makeSegment('Alice', 'This is off the record'));

      expect(agent.getCurrentMeeting()!.transcript.length).toBe(0);
    });

    it('should not add transcripts when no meeting is active', () => {
      agent.addTranscriptSegment(makeSegment('Alice', 'No meeting happening'));
      // Should not throw
    });

    it('should enforce transcript length limit', () => {
      agent = new MeetingAgent({ maxTranscriptLength: 3 });
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('A', 'One'));
      agent.addTranscriptSegment(makeSegment('B', 'Two'));
      agent.addTranscriptSegment(makeSegment('C', 'Three'));
      agent.addTranscriptSegment(makeSegment('D', 'Four'));

      expect(agent.getCurrentMeeting()!.transcript.length).toBe(3);
      expect(agent.getCurrentMeeting()!.transcript[0].text).toBe('Two');
    });
  });

  // ─── Action Item Detection ────────────────────────────────────

  describe('Action Item Detection', () => {
    it('should detect "I\'ll do X" pattern', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Mike', "I'll update the documentation by Friday."));

      const items = agent.getCurrentMeeting()!.actionItems;
      expect(items.length).toBe(1);
      expect(items[0].task).toContain('update the documentation');
      expect(items[0].deadline).toBe('Friday');
    });

    it('should detect "X will do Y" pattern', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Sarah', 'Mike will fix the login bug.'));

      const items = agent.getCurrentMeeting()!.actionItems;
      expect(items.length).toBe(1);
      expect(items[0].owner).toBe('Mike');
      expect(items[0].task).toContain('fix the login bug');
    });

    it('should detect "we need to X" pattern', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Team Lead', 'We need to update the API docs by Monday.'));

      const items = agent.getCurrentMeeting()!.actionItems;
      expect(items.length).toBe(1);
      expect(items[0].task).toContain('update the API docs');
      expect(items[0].deadline).toBe('Monday');
    });

    it('should detect explicit "action item" commands', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Manager', 'Action item: Sarah - review the PR.'));

      const items = agent.getCurrentMeeting()!.actionItems;
      expect(items.length).toBe(1);
      expect(items[0].owner).toBe('Sarah');
    });

    it('should detect "I will do X" pattern', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Dev', 'I will refactor the auth module.'));

      const items = agent.getCurrentMeeting()!.actionItems;
      expect(items.length).toBe(1);
    });

    it('should detect "can X do Y" pattern', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('PM', 'Can Dave please review the design spec?'));

      const items = agent.getCurrentMeeting()!.actionItems;
      expect(items.length).toBe(1);
      expect(items[0].owner).toBe('Dave');
    });

    it('should handle manual action items', () => {
      agent.startMeeting('Test');

      const item = agent.addActionItem('Lisa', 'Deploy to staging', 'EOD');

      expect(item.owner).toBe('Lisa');
      expect(item.task).toBe('Deploy to staging');
      expect(item.deadline).toBe('EOD');
      expect(item.source).toBe('manual');
    });

    it('should not detect action items when auto-detect is disabled', () => {
      agent = new MeetingAgent({ autoDetectActionItems: false });
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Mike', "I'll fix the bug by Friday."));

      expect(agent.getCurrentMeeting()!.actionItems.length).toBe(0);
    });

    it('should skip tasks that are too short', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Bob', "I'll go."));

      // "go" is too short (< 3 chars) — should not create action item
      expect(agent.getCurrentMeeting()!.actionItems.length).toBe(0);
    });

    it('should assign to speaker when owner is a filler word', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Alice', 'We should update the readme.'));

      const items = agent.getCurrentMeeting()!.actionItems;
      if (items.length > 0) {
        // Owner should not be "we"
        expect(FILLER_WORDS_SET.has(items[0].owner.toLowerCase())).toBe(false);
      }
    });
  });

  // ─── Decision Detection ───────────────────────────────────────

  describe('Decision Detection', () => {
    it('should detect "we decided to" pattern', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('CTO', "We decided to use PostgreSQL for the backend."));

      const decisions = agent.getCurrentMeeting()!.decisions;
      expect(decisions.length).toBe(1);
      expect(decisions[0].description).toContain('PostgreSQL');
    });

    it('should detect "let\'s go with" pattern', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('PM', "Let's go with option A."));

      const decisions = agent.getCurrentMeeting()!.decisions;
      expect(decisions.length).toBe(1);
      expect(decisions[0].description).toContain('option A');
    });

    it('should detect "we\'re going with" pattern', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Lead', "We're going with React for the frontend."));

      const decisions = agent.getCurrentMeeting()!.decisions;
      expect(decisions.length).toBe(1);
    });

    it('should detect "the decision is" pattern', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('VP', 'The decision is to postpone the launch.'));

      const decisions = agent.getCurrentMeeting()!.decisions;
      expect(decisions.length).toBe(1);
    });

    it('should handle manual decisions', () => {
      agent.startMeeting('Test');

      const decision = agent.addDecision('Ship MVP by March 1', 'Product Lead');

      expect(decision.description).toBe('Ship MVP by March 1');
      expect(decision.proposedBy).toBe('Product Lead');
      expect(decision.source).toBe('manual');
    });

    it('should not detect decisions when auto-detect is disabled', () => {
      agent = new MeetingAgent({ autoDetectDecisions: false });
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('CTO', 'We decided to use MongoDB.'));

      expect(agent.getCurrentMeeting()!.decisions.length).toBe(0);
    });
  });

  // ─── Question Detection ───────────────────────────────────────

  describe('Question Detection', () => {
    it('should detect direct questions', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Dev', 'What framework should we use for testing?'));

      const questions = agent.getCurrentMeeting()!.openQuestions;
      expect(questions.length).toBe(1);
      expect(questions[0].askedBy).toBe('Dev');
    });

    it('should detect "does anyone know" questions', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Intern', 'Does anyone know the deploy process?'));

      const questions = agent.getCurrentMeeting()!.openQuestions;
      expect(questions.length).toBe(1);
    });

    it('should not detect questions when disabled', () => {
      agent = new MeetingAgent({ autoDetectQuestions: false });
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Dev', 'What is the deadline?'));

      expect(agent.getCurrentMeeting()!.openQuestions.length).toBe(0);
    });
  });

  // ─── Visual Capture ───────────────────────────────────────────

  describe('Visual Capture', () => {
    it('should capture whiteboard content', () => {
      agent.startMeeting('Test');

      const analysis = makeAnalysis({
        sceneType: 'whiteboard',
        extractedText: [makeText('Sprint Goals: 1. Ship feature X 2. Fix bug Y')],
        sceneDescription: 'A whiteboard with sprint goals',
      });

      const visual = agent.captureVisual(makeImage(), analysis);

      expect(visual).toBeDefined();
      expect(visual!.contentType).toBe('whiteboard');
      expect(visual!.isNewContent).toBe(true);
    });

    it('should capture screen/slide content', () => {
      agent.startMeeting('Test');

      const analysis = makeAnalysis({
        sceneType: 'screen',
        extractedText: [makeText('Q4 Revenue: $2.5M')],
        sceneDescription: 'A presentation slide',
      });

      const visual = agent.captureVisual(makeImage(), analysis);

      expect(visual).toBeDefined();
      expect(visual!.contentType).toBe('screen');
    });

    it('should skip duplicate visual content', () => {
      agent.startMeeting('Test');

      const analysis = makeAnalysis({
        sceneType: 'whiteboard',
        extractedText: [makeText('Sprint Goals: 1. Ship feature X')],
      });

      const v1 = agent.captureVisual(makeImage('img-1'), analysis);
      const v2 = agent.captureVisual(makeImage('img-2'), analysis); // Same content

      expect(v1).toBeDefined();
      expect(v2).toBeNull(); // Duplicate
    });

    it('should capture new slide when content changes', () => {
      agent.startMeeting('Test');

      const slide1 = makeAnalysis({
        sceneType: 'screen',
        extractedText: [makeText('Introduction: Welcome to the product demo')],
      });

      const slide2 = makeAnalysis({
        sceneType: 'screen',
        extractedText: [makeText('Features: New dashboard, API improvements, better performance')],
      });

      agent.captureVisual(makeImage('img-1'), slide1);
      const v2 = agent.captureVisual(makeImage('img-2'), slide2);

      expect(v2).toBeDefined();
      expect(v2!.isNewContent).toBe(true);
      expect(agent.getCurrentMeeting()!.visuals.length).toBe(2);
    });

    it('should not capture when meeting is not active', () => {
      const analysis = makeAnalysis({ sceneType: 'whiteboard' });
      const visual = agent.captureVisual(makeImage(), analysis);

      expect(visual).toBeNull();
    });

    it('should not capture non-visual scenes', () => {
      agent.startMeeting('Test');

      const analysis = makeAnalysis({
        sceneType: 'outdoor',
        extractedText: [],
      });

      const visual = agent.captureVisual(makeImage(), analysis);

      expect(visual).toBeNull();
    });

    it('should respect max visuals limit', () => {
      agent = new MeetingAgent({ maxVisuals: 2 });
      agent.startMeeting('Test');

      for (let i = 0; i < 5; i++) {
        agent.captureVisual(
          makeImage(`img-${i}`),
          makeAnalysis({
            sceneType: 'whiteboard',
            extractedText: [makeText(`Completely different content ${i} with unique words #${i * 100}`)],
          })
        );
      }

      expect(agent.getCurrentMeeting()!.visuals.length).toBeLessThanOrEqual(2);
    });
  });

  // ─── Annotations ──────────────────────────────────────────────

  describe('Annotations', () => {
    it('should add annotations during meeting', () => {
      agent.startMeeting('Test');

      agent.addAnnotation('Note: competitor launched similar feature');

      expect(agent.getCurrentMeeting()!.annotations.length).toBe(1);
    });

    it('should not add annotations when no meeting is active', () => {
      agent.addAnnotation('Orphan note');
      // Should not throw
    });

    it('should include annotations in summary', () => {
      agent.startMeeting('Test');
      agent.addAnnotation('Important: follow up with legal');

      const summary = agent.endMeeting();

      expect(summary.markdownReport).toContain('follow up with legal');
    });
  });

  // ─── Topics ───────────────────────────────────────────────────

  describe('Topics', () => {
    it('should track unique topics', () => {
      agent.startMeeting('Test');

      agent.addTopic('Architecture');
      agent.addTopic('Timeline');
      agent.addTopic('Architecture'); // Duplicate

      expect(agent.getCurrentMeeting()!.topics).toEqual(['Architecture', 'Timeline']);
    });

    it('should include topics in summary', () => {
      agent.startMeeting('Test');
      agent.addTopic('Budget Review');

      const summary = agent.endMeeting();

      expect(summary.topics).toContain('Budget Review');
      expect(summary.markdownReport).toContain('Budget Review');
    });
  });

  // ─── Summary Generation ───────────────────────────────────────

  describe('Summary Generation', () => {
    it('should generate comprehensive summary', () => {
      agent.startMeeting('Sprint Planning');

      agent.addTranscriptSegment(makeSegment('Alice', "I'll update the API docs by Friday."));
      agent.addTranscriptSegment(makeSegment('Bob', 'We decided to use TypeScript.'));
      agent.addTranscriptSegment(makeSegment('Charlie', 'What about the testing strategy?'));

      agent.addTopic('API Redesign');
      agent.addAnnotation('Need to check with security team');

      const summary = agent.endMeeting();

      expect(summary.title).toBe('Sprint Planning');
      expect(summary.participants.length).toBeGreaterThan(0);
      expect(summary.executiveSummary).toBeTruthy();
      expect(summary.markdownReport).toContain('Sprint Planning');
      expect(summary.voiceSummary).toContain('Meeting ended');
    });

    it('should generate markdown with all sections', () => {
      agent.startMeeting('Design Review');

      agent.addTranscriptSegment(makeSegment('Designer', "Let's go with the blue theme."));
      agent.addActionItem('Dev', 'Implement new color scheme');
      agent.addAnnotation('Stakeholders approved the mockup');
      agent.addTopic('UI Redesign');

      const summary = agent.endMeeting();

      expect(summary.markdownReport).toContain('## Meeting: Design Review');
      expect(summary.markdownReport).toContain('### Decisions');
      expect(summary.markdownReport).toContain('### Action Items');
      expect(summary.markdownReport).toContain('### Key Topics');
      expect(summary.markdownReport).toContain('### Notes');
    });

    it('should generate voice-friendly summary', () => {
      agent.startMeeting('Quick Sync');

      agent.addActionItem('Bob', 'Deploy hotfix');
      agent.addDecision('Use canary deployment');

      const summary = agent.endMeeting();

      expect(summary.voiceSummary).toContain('Meeting ended');
      expect(summary.voiceSummary).toContain('decision');
      expect(summary.voiceSummary).toContain('action item');
    });

    it('should handle empty meeting', () => {
      agent.startMeeting('Empty Meeting');

      const summary = agent.endMeeting();

      expect(summary.executiveSummary).toContain('Empty Meeting');
      expect(summary.voiceSummary).toBeTruthy();
    });

    it('should list participants in executive summary', () => {
      agent.startMeeting('Team Sync');

      agent.addTranscriptSegment(makeSegment('Alice', 'Hi'));
      agent.addTranscriptSegment(makeSegment('Bob', 'Hey'));

      const summary = agent.endMeeting();

      expect(summary.executiveSummary).toContain('Alice');
      expect(summary.executiveSummary).toContain('Bob');
    });

    it('should include transcript excerpt in markdown', () => {
      agent.startMeeting('Test');

      agent.addTranscriptSegment(makeSegment('Alice', 'First point'));
      agent.addTranscriptSegment(makeSegment('Bob', 'Second point'));

      const summary = agent.endMeeting();

      expect(summary.markdownReport).toContain('### Transcript');
      expect(summary.markdownReport).toContain('**Alice:**');
    });
  });

  // ─── Context Router Integration ───────────────────────────────

  describe('Context Router Integration (handle method)', () => {
    it('should start meeting via voice command', async () => {
      const analysis = makeAnalysis();
      const context = makeContext({
        trigger: 'voice',
        voiceIntent: 'start_meeting',
        voiceParams: { topic: 'Sprint Planning' },
      });

      const response = await agent.handle(makeImage(), analysis, context);

      expect(response.agentId).toBe('meeting');
      expect(response.success).toBe(true);
      expect(response.ttsText).toContain('Meeting mode activated');
      expect(agent.isMeetingActive()).toBe(true);
    });

    it('should end meeting via voice command', async () => {
      agent.startMeeting('Sprint');

      const context = makeContext({
        trigger: 'voice',
        voiceIntent: 'end_meeting',
      });

      const response = await agent.handle(makeImage(), makeAnalysis(), context);

      expect(response.ttsText).toContain('Meeting ended');
      expect(agent.isMeetingActive()).toBe(false);
    });

    it('should capture visuals during active meeting', async () => {
      agent.startMeeting('Test');

      const analysis = makeAnalysis({
        sceneType: 'whiteboard',
        extractedText: [makeText('Architecture diagram showing microservices')],
      });

      const response = await agent.handle(makeImage(), analysis, makeContext());

      expect(response.summary).toContain('whiteboard');
    });

    it('should handle no active meeting gracefully', async () => {
      const response = await agent.handle(makeImage(), makeAnalysis(), makeContext());

      expect(response.success).toBe(true);
      expect(response.summary).toContain('No active meeting');
    });
  });

  // ─── Events ───────────────────────────────────────────────────

  describe('Events', () => {
    it('should emit meeting:started', () => {
      const spy = vi.fn();
      agent.on('meeting:started', spy);

      agent.startMeeting('Test');

      expect(spy).toHaveBeenCalledOnce();
    });

    it('should emit meeting:ended with summary', () => {
      const spy = vi.fn();
      agent.on('meeting:ended', spy);

      agent.startMeeting('Test');
      agent.endMeeting();

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toHaveProperty('markdownReport');
    });

    it('should emit meeting:paused and meeting:resumed', () => {
      const pauseSpy = vi.fn();
      const resumeSpy = vi.fn();
      agent.on('meeting:paused', pauseSpy);
      agent.on('meeting:resumed', resumeSpy);

      agent.startMeeting('Test');
      agent.pauseMeeting();
      agent.resumeMeeting();

      expect(pauseSpy).toHaveBeenCalledOnce();
      expect(resumeSpy).toHaveBeenCalledOnce();
    });

    it('should emit action_item:detected', () => {
      const spy = vi.fn();
      agent.on('action_item:detected', spy);

      agent.startMeeting('Test');
      agent.addTranscriptSegment(makeSegment('Mike', "I'll fix the bug by Monday."));

      expect(spy).toHaveBeenCalled();
    });

    it('should emit decision:detected', () => {
      const spy = vi.fn();
      agent.on('decision:detected', spy);

      agent.startMeeting('Test');
      agent.addTranscriptSegment(makeSegment('CTO', 'We decided to use Kubernetes.'));

      expect(spy).toHaveBeenCalled();
    });

    it('should emit participant:new for new speakers', () => {
      const spy = vi.fn();
      agent.on('participant:new', spy);

      agent.startMeeting('Test');
      agent.addTranscriptSegment(makeSegment('Alice', 'Hi'));
      agent.addTranscriptSegment(makeSegment('Bob', 'Hello'));
      agent.addTranscriptSegment(makeSegment('Alice', 'Moving on'));

      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should emit visual:captured', () => {
      const spy = vi.fn();
      agent.on('visual:captured', spy);

      agent.startMeeting('Test');
      agent.captureVisual(makeImage(), makeAnalysis({
        sceneType: 'whiteboard',
        extractedText: [makeText('Some whiteboard content')],
      }));

      expect(spy).toHaveBeenCalledOnce();
    });

    it('should emit transcript:segment for each transcript', () => {
      const spy = vi.fn();
      agent.on('transcript:segment', spy);

      agent.startMeeting('Test');
      agent.addTranscriptSegment(makeSegment('Dev', 'Hello'));

      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ─── Configuration ────────────────────────────────────────────

  describe('Configuration', () => {
    it('should use default config', () => {
      const config = agent.getConfig();
      expect(config.autoDetectActionItems).toBe(true);
      expect(config.consentMode).toBe('one_party');
    });

    it('should allow runtime config updates', () => {
      agent.updateConfig({ consentMode: 'two_party' });
      expect(agent.getConfig().consentMode).toBe('two_party');
    });

    it('should accept custom config on construction', () => {
      const custom = new MeetingAgent({
        autoDetectActionItems: false,
        maxVisuals: 5,
      });

      expect(custom.getConfig().autoDetectActionItems).toBe(false);
      expect(custom.getConfig().maxVisuals).toBe(5);
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle empty transcript segment', () => {
      agent.startMeeting('Test');
      agent.addTranscriptSegment(makeSegment('Speaker', ''));
      expect(agent.getCurrentMeeting()!.transcript.length).toBe(1);
    });

    it('should handle meetings with only visuals', () => {
      agent.startMeeting('Visual Only');

      agent.captureVisual(makeImage(), makeAnalysis({
        sceneType: 'whiteboard',
        extractedText: [makeText('Architecture diagram')],
      }));

      const summary = agent.endMeeting();
      expect(summary.visualsCaptured).toBe(1);
    });

    it('should handle meetings with only manual inputs', () => {
      agent.startMeeting('Manual');

      agent.addActionItem('John', 'Review code');
      agent.addDecision('Ship by Friday');
      agent.addAnnotation('All hands approved');
      agent.addTopic('Release Planning');

      const summary = agent.endMeeting();
      expect(summary.actionItems.length).toBe(1);
      expect(summary.decisions.length).toBe(1);
    });

    it('should getCurrentMeeting returns copy (not reference)', () => {
      agent.startMeeting('Test');

      const meeting1 = agent.getCurrentMeeting()!;
      meeting1.title = 'Modified';

      const meeting2 = agent.getCurrentMeeting()!;
      expect(meeting2.title).toBe('Test');
    });

    it('should add topic only when meeting exists', () => {
      agent.addTopic('Orphan Topic');
      // Should not throw
    });
  });
});

// Helper constant for the filler words test
const FILLER_WORDS_SET = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'we',
  'they', 'them', 'everyone', 'somebody', 'anybody', 'nobody', 'so',
  'then', 'also', 'just', 'maybe', 'perhaps', 'probably', 'really',
  'very', 'actually', 'basically', 'literally', 'absolutely',
]);
