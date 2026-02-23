/**
 * Meeting Intelligence Agent — Covert meeting capture and synthesis.
 *
 * Start a meeting, and the agent automatically:
 * 1. Transcribes audio with speaker diarization
 * 2. Captures slides/whiteboards when they change
 * 3. Extracts action items as they're spoken
 * 4. Tracks decisions made
 * 5. Generates structured meeting summary with everything organized
 *
 * Voice commands:
 * - "Start meeting" / "Meeting on" → begin capture
 * - "End meeting" → stop + generate summary
 * - "Note: [text]" → manual annotation
 * - "Action item: [person] [task]" → manual action item
 * - "Decision: [text]" → manual decision logging
 *
 * Revenue: Powers "Covert Meeting Intelligence" feature.
 * Enterprise tier: $999/mo with CRM + task management integration.
 *
 * Usage:
 *   const agent = new MeetingAgent({ ... });
 *   agent.startMeeting('Q4 Planning');
 *   agent.addTranscriptSegment({ speaker: 'Mike', text: '...' });
 *   agent.captureVisual(image, analysis);
 *   const summary = agent.endMeeting();
 */

import { EventEmitter } from 'eventemitter3';
import type {
  CapturedImage,
  VisionAnalysis,
  PipelineResult,
} from '../types.js';
import type { RoutingContext, AgentResponse } from '../routing/context-router.js';

// ─── Types ──────────────────────────────────────────────────────

export interface TranscriptSegment {
  /** Speaker name or ID (from diarization) */
  speaker: string;
  /** What was said */
  text: string;
  /** When it was said (ISO timestamp) */
  timestamp: string;
  /** Confidence of transcription 0-1 */
  confidence: number;
}

export interface ActionItem {
  /** Unique action item ID */
  id: string;
  /** Who is responsible */
  owner: string;
  /** What needs to be done */
  task: string;
  /** When it's due (if mentioned) */
  deadline?: string;
  /** How it was captured */
  source: 'auto_detected' | 'voice_command' | 'manual';
  /** The transcript segment that generated this */
  sourceText?: string;
  /** When it was detected */
  detectedAt: string;
  /** Is it completed? */
  completed: boolean;
}

export interface Decision {
  /** Unique decision ID */
  id: string;
  /** What was decided */
  description: string;
  /** Who made or proposed the decision */
  proposedBy?: string;
  /** Context/reasoning */
  context?: string;
  /** How it was captured */
  source: 'auto_detected' | 'voice_command' | 'manual';
  /** Source transcript text */
  sourceText?: string;
  /** When it was detected */
  detectedAt: string;
}

export interface OpenQuestion {
  /** The unanswered question */
  question: string;
  /** Who asked it */
  askedBy?: string;
  /** When it was asked */
  askedAt: string;
}

export interface VisualCapture {
  /** Image ID reference */
  imageId: string;
  /** What type of visual content */
  contentType: 'slide' | 'whiteboard' | 'document' | 'screen' | 'other';
  /** OCR text extracted from the visual */
  extractedText: string;
  /** Description of the visual */
  description: string;
  /** When captured */
  capturedAt: string;
  /** Whether this visual changed significantly from the previous one */
  isNewContent: boolean;
}

export interface MeetingSession {
  /** Unique meeting ID */
  id: string;
  /** Meeting title/topic */
  title: string;
  /** When it started */
  startedAt: string;
  /** When it ended (null if ongoing) */
  endedAt?: string;
  /** Duration in minutes */
  durationMinutes: number;
  /** All participants detected */
  participants: string[];
  /** Full transcript */
  transcript: TranscriptSegment[];
  /** Extracted action items */
  actionItems: ActionItem[];
  /** Decisions made */
  decisions: Decision[];
  /** Unanswered questions */
  openQuestions: OpenQuestion[];
  /** Visual captures (slides, whiteboards) */
  visuals: VisualCapture[];
  /** Manual annotations */
  annotations: MeetingAnnotation[];
  /** Meeting status */
  status: 'active' | 'paused' | 'ended';
  /** Key topics discussed */
  topics: string[];
}

export interface MeetingAnnotation {
  /** Annotation text */
  text: string;
  /** When annotated */
  timestamp: string;
  /** Associated image ID (if any) */
  imageId?: string;
}

export interface MeetingSummary {
  /** Meeting title */
  title: string;
  /** Date */
  date: string;
  /** Duration */
  duration: string;
  /** Participant list */
  participants: string[];
  /** Executive summary (3-5 sentences) */
  executiveSummary: string;
  /** Decisions made */
  decisions: Decision[];
  /** Action items */
  actionItems: ActionItem[];
  /** Key discussion topics */
  topics: string[];
  /** Open questions */
  openQuestions: OpenQuestion[];
  /** Number of visuals captured */
  visualsCaptured: number;
  /** Full markdown report */
  markdownReport: string;
  /** Voice-friendly TTS summary */
  voiceSummary: string;
}

export interface MeetingAgentConfig {
  /** Minimum change threshold for visual captures (0-1, lower = more sensitive) */
  visualChangeThreshold: number;
  /** Enable auto-detection of action items from transcript */
  autoDetectActionItems: boolean;
  /** Enable auto-detection of decisions from transcript */
  autoDetectDecisions: boolean;
  /** Enable auto-detection of questions from transcript */
  autoDetectQuestions: boolean;
  /** Maximum transcript segments to keep (0 = unlimited) */
  maxTranscriptLength: number;
  /** Maximum visuals per meeting */
  maxVisuals: number;
  /** Maximum meeting duration in minutes (0 = unlimited) */
  maxDurationMinutes: number;
  /** Consent mode: 'one_party' or 'two_party' — for legal compliance */
  consentMode: 'one_party' | 'two_party';
}

export const DEFAULT_MEETING_CONFIG: MeetingAgentConfig = {
  visualChangeThreshold: 0.3,
  autoDetectActionItems: true,
  autoDetectDecisions: true,
  autoDetectQuestions: true,
  maxTranscriptLength: 0,
  maxVisuals: 100,
  maxDurationMinutes: 0,
  consentMode: 'one_party',
};

export interface MeetingAgentEvents {
  'meeting:started': (session: MeetingSession) => void;
  'meeting:ended': (summary: MeetingSummary) => void;
  'meeting:paused': (session: MeetingSession) => void;
  'meeting:resumed': (session: MeetingSession) => void;
  'action_item:detected': (item: ActionItem) => void;
  'decision:detected': (decision: Decision) => void;
  'question:detected': (question: OpenQuestion) => void;
  'visual:captured': (visual: VisualCapture) => void;
  'participant:new': (name: string) => void;
  'transcript:segment': (segment: TranscriptSegment) => void;
}

// ─── Action Item Detection Patterns ─────────────────────────────

const ACTION_ITEM_PATTERNS: Array<{
  pattern: RegExp;
  ownerGroup?: number;
  taskGroup: number;
  deadlineGroup?: number;
}> = [
  // "I'll do X by Friday"
  {
    pattern: /(?:i'll|i will|i'm going to|i am going to)\s+(.+?)(?:\s+by\s+(.+?))?(?:\.|$)/i,
    taskGroup: 1,
    deadlineGroup: 2,
  },
  // "John will do X"
  {
    pattern: /(\w+)\s+(?:will|should|needs to|is going to|can)\s+(.+?)(?:\s+by\s+(.+?))?(?:\.|$)/i,
    ownerGroup: 1,
    taskGroup: 2,
    deadlineGroup: 3,
  },
  // "Let's make sure [someone/we] does X"
  {
    pattern: /let'?s\s+(?:make sure|ensure)\s+(?:(\w+)\s+)?(?:does|gets|handles|takes care of)\s+(.+?)(?:\.|$)/i,
    ownerGroup: 1,
    taskGroup: 2,
  },
  // "Can [someone] please do X"
  {
    pattern: /(?:can|could)\s+(\w+)\s+(?:please\s+)?(.+?)(?:\?|$)/i,
    ownerGroup: 1,
    taskGroup: 2,
  },
  // "Action item: X" (explicit voice command)
  {
    pattern: /action\s+item[:\s]+(?:(\w+)\s*[-:]\s*)?(.+?)(?:\.|$)/i,
    ownerGroup: 1,
    taskGroup: 2,
  },
  // "TODO: X" / "To do: X"
  {
    pattern: /to[\s-]?do[:\s]+(.+?)(?:\.|$)/i,
    taskGroup: 1,
  },
  // "We need to X"
  {
    pattern: /we\s+need\s+to\s+(.+?)(?:\s+by\s+(.+?))?(?:\.|$)/i,
    taskGroup: 1,
    deadlineGroup: 2,
  },
];

/** Decision detection patterns */
const DECISION_PATTERNS = [
  /(?:we'?ve?\s+)?(?:decided|agreed|going)\s+(?:to\s+)?(?:go\s+with\s+)?(.+?)(?:\.|$)/i,
  /(?:the\s+)?decision\s+(?:is|was)\s+(?:to\s+)?(.+?)(?:\.|$)/i,
  /let'?s\s+go\s+with\s+(.+?)(?:\.|$)/i,
  /(?:we'?re|we\s+are)\s+going\s+(?:to\s+)?(?:go\s+)?(?:with\s+|for\s+)?(.+?)(?:\.|$)/i,
  /(?:final\s+)?(?:answer|verdict|choice|pick)\s*(?:is|:)\s*(.+?)(?:\.|$)/i,
  /(?:so\s+)?(?:we'll|we\s+will)\s+(?:use|adopt|implement|go\s+with)\s+(.+?)(?:\.|$)/i,
];

/** Question detection patterns */
const QUESTION_PATTERNS = [
  /(?:what|how|why|when|where|who|which|can|could|should|would|will|do|does|is|are|was|were)\s+.+\?/i,
  /(?:i\s+)?(?:wonder|wondering)\s+(?:if|whether|about)\s+(.+?)(?:\.|$)/i,
  /(?:does\s+anyone|anybody)\s+know\s+(.+?)(?:\?|$)/i,
];

// Filler words to ignore in ownership detection
const FILLER_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'we',
  'they', 'them', 'everyone', 'somebody', 'anybody', 'nobody', 'so',
  'then', 'also', 'just', 'maybe', 'perhaps', 'probably', 'really',
  'very', 'actually', 'basically', 'literally', 'absolutely',
]);

// ─── Meeting Agent ──────────────────────────────────────────────

export class MeetingAgent extends EventEmitter<MeetingAgentEvents> {
  private config: MeetingAgentConfig;
  private currentMeeting: MeetingSession | null = null;
  private meetingHistory: MeetingSummary[] = [];
  private itemIdCounter = 0;
  private decisionIdCounter = 0;
  private lastVisualText = '';

  constructor(config: Partial<MeetingAgentConfig> = {}) {
    super();
    this.config = { ...DEFAULT_MEETING_CONFIG, ...config };
  }

  // ─── SpecialistAgent interface ────────────────────────────────

  /**
   * Handle an image routed by the Context Router.
   * When in meeting mode, captures slides/whiteboards.
   */
  async handle(
    image: CapturedImage,
    analysis: VisionAnalysis,
    context: RoutingContext,
  ): Promise<AgentResponse> {
    // If meeting isn't active, check for start command
    if (!this.currentMeeting || this.currentMeeting.status !== 'active') {
      if (context.voiceIntent === 'start_meeting') {
        const session = this.startMeeting(context.voiceParams?.['topic'] || 'Meeting');
        return {
          agentId: 'meeting',
          agentName: 'Meeting Intelligence',
          success: true,
          data: session,
          summary: `Meeting started: ${session.title}`,
          ttsText: `Meeting mode activated. I'll capture slides, track action items, and take notes. Say "end meeting" when you're done.`,
          priority: 5,
        };
      }

      return {
        agentId: 'meeting',
        agentName: 'Meeting Intelligence',
        success: true,
        data: null,
        summary: 'No active meeting. Say "start meeting" to begin.',
        priority: 10,
      };
    }

    // Handle end meeting
    if (context.voiceIntent === 'end_meeting') {
      const summary = this.endMeeting();
      return {
        agentId: 'meeting',
        agentName: 'Meeting Intelligence',
        success: true,
        data: summary,
        summary: `Meeting ended. ${summary.actionItems.length} action items, ${summary.decisions.length} decisions.`,
        ttsText: summary.voiceSummary,
        priority: 3,
      };
    }

    // Capture visual content during meeting
    const visual = this.captureVisual(image, analysis);

    if (visual && visual.isNewContent) {
      return {
        agentId: 'meeting',
        agentName: 'Meeting Intelligence',
        success: true,
        data: visual,
        summary: `Captured ${visual.contentType}: ${visual.description.substring(0, 80)}`,
        priority: 7,
      };
    }

    return {
      agentId: 'meeting',
      agentName: 'Meeting Intelligence',
      success: true,
      data: null,
      summary: 'Meeting in progress. No new visual content detected.',
      priority: 10,
    };
  }

  // ─── Meeting Lifecycle ────────────────────────────────────────

  /**
   * Start a new meeting session.
   */
  startMeeting(title: string = 'Meeting'): MeetingSession {
    const session: MeetingSession = {
      id: `meeting-${Date.now()}`,
      title,
      startedAt: new Date().toISOString(),
      durationMinutes: 0,
      participants: [],
      transcript: [],
      actionItems: [],
      decisions: [],
      openQuestions: [],
      visuals: [],
      annotations: [],
      status: 'active',
      topics: [],
    };

    this.currentMeeting = session;
    this.lastVisualText = '';
    this.emit('meeting:started', session);
    return session;
  }

  /**
   * End the current meeting and generate summary.
   */
  endMeeting(): MeetingSummary {
    if (!this.currentMeeting) {
      throw new Error('No active meeting to end');
    }

    this.currentMeeting.status = 'ended';
    this.currentMeeting.endedAt = new Date().toISOString();
    this.currentMeeting.durationMinutes = this.calculateDuration();

    const summary = this.generateSummary(this.currentMeeting);
    this.meetingHistory.push(summary);
    this.emit('meeting:ended', summary);

    const ended = this.currentMeeting;
    this.currentMeeting = null;

    return summary;
  }

  /**
   * Pause the current meeting.
   */
  pauseMeeting(): void {
    if (!this.currentMeeting || this.currentMeeting.status !== 'active') return;
    this.currentMeeting.status = 'paused';
    this.emit('meeting:paused', this.currentMeeting);
  }

  /**
   * Resume a paused meeting.
   */
  resumeMeeting(): void {
    if (!this.currentMeeting || this.currentMeeting.status !== 'paused') return;
    this.currentMeeting.status = 'active';
    this.emit('meeting:resumed', this.currentMeeting);
  }

  // ─── Transcript Processing ────────────────────────────────────

  /**
   * Add a transcript segment (from STT).
   */
  addTranscriptSegment(segment: TranscriptSegment): void {
    if (!this.currentMeeting || this.currentMeeting.status !== 'active') return;

    this.currentMeeting.transcript.push(segment);
    this.emit('transcript:segment', segment);

    // Track participants
    if (segment.speaker && !this.currentMeeting.participants.includes(segment.speaker)) {
      this.currentMeeting.participants.push(segment.speaker);
      this.emit('participant:new', segment.speaker);
    }

    // Auto-detect action items
    if (this.config.autoDetectActionItems) {
      const items = this.detectActionItems(segment);
      for (const item of items) {
        this.currentMeeting.actionItems.push(item);
        this.emit('action_item:detected', item);
      }
    }

    // Auto-detect decisions
    if (this.config.autoDetectDecisions) {
      const decisions = this.detectDecisions(segment);
      for (const decision of decisions) {
        this.currentMeeting.decisions.push(decision);
        this.emit('decision:detected', decision);
      }
    }

    // Auto-detect questions
    if (this.config.autoDetectQuestions) {
      const questions = this.detectQuestions(segment);
      for (const q of questions) {
        this.currentMeeting.openQuestions.push(q);
        this.emit('question:detected', q);
      }
    }

    // Enforce transcript limit
    if (this.config.maxTranscriptLength > 0 &&
        this.currentMeeting.transcript.length > this.config.maxTranscriptLength) {
      this.currentMeeting.transcript.shift();
    }
  }

  // ─── Visual Capture ───────────────────────────────────────────

  /**
   * Capture visual content (slide, whiteboard, etc.) during a meeting.
   * Deduplicates by comparing extracted text to previous captures.
   */
  captureVisual(
    image: CapturedImage,
    analysis: VisionAnalysis,
  ): VisualCapture | null {
    if (!this.currentMeeting || this.currentMeeting.status !== 'active') return null;

    // Determine content type
    const contentType = this.classifyVisualContent(analysis);
    if (!contentType) return null;

    // Extract text from the visual
    const text = (analysis.extractedText || []).map(t => t.text).join(' ');

    // Check for significant change
    const isNewContent = this.isSignificantChange(text, this.lastVisualText);

    if (!isNewContent && this.currentMeeting.visuals.length > 0) {
      return null; // Skip duplicate
    }

    // Enforce max visuals
    if (this.currentMeeting.visuals.length >= this.config.maxVisuals) {
      return null;
    }

    const visual: VisualCapture = {
      imageId: image.id,
      contentType,
      extractedText: text,
      description: analysis.sceneDescription || `${contentType} capture`,
      capturedAt: image.capturedAt,
      isNewContent,
    };

    this.currentMeeting.visuals.push(visual);
    this.lastVisualText = text;
    this.emit('visual:captured', visual);

    return visual;
  }

  // ─── Manual Input ─────────────────────────────────────────────

  /**
   * Add a manual annotation (voice note during meeting).
   */
  addAnnotation(text: string, imageId?: string): void {
    if (!this.currentMeeting || this.currentMeeting.status !== 'active') return;

    this.currentMeeting.annotations.push({
      text,
      timestamp: new Date().toISOString(),
      imageId,
    });
  }

  /**
   * Manually add an action item.
   */
  addActionItem(owner: string, task: string, deadline?: string): ActionItem {
    const item: ActionItem = {
      id: `action-${++this.itemIdCounter}`,
      owner,
      task,
      deadline,
      source: 'manual',
      detectedAt: new Date().toISOString(),
      completed: false,
    };

    if (this.currentMeeting?.status === 'active') {
      this.currentMeeting.actionItems.push(item);
    }

    this.emit('action_item:detected', item);
    return item;
  }

  /**
   * Manually add a decision.
   */
  addDecision(description: string, proposedBy?: string): Decision {
    const decision: Decision = {
      id: `decision-${++this.decisionIdCounter}`,
      description,
      proposedBy,
      source: 'manual',
      detectedAt: new Date().toISOString(),
    };

    if (this.currentMeeting?.status === 'active') {
      this.currentMeeting.decisions.push(decision);
    }

    this.emit('decision:detected', decision);
    return decision;
  }

  /**
   * Add a topic to the meeting.
   */
  addTopic(topic: string): void {
    if (!this.currentMeeting) return;
    if (!this.currentMeeting.topics.includes(topic)) {
      this.currentMeeting.topics.push(topic);
    }
  }

  // ─── Detection Logic ──────────────────────────────────────────

  /**
   * Detect action items in a transcript segment.
   */
  detectActionItems(segment: TranscriptSegment): ActionItem[] {
    const items: ActionItem[] = [];

    for (const { pattern, ownerGroup, taskGroup, deadlineGroup } of ACTION_ITEM_PATTERNS) {
      const match = segment.text.match(pattern);
      if (match) {
        let owner = ownerGroup ? (match[ownerGroup] || '').trim() : segment.speaker;
        const task = (match[taskGroup] || '').trim();
        const deadline = deadlineGroup ? (match[deadlineGroup] || '').trim() : undefined;

        // Skip if task is too short or owner is a filler word
        if (task.length < 3) continue;
        if (FILLER_WORDS.has(owner.toLowerCase())) {
          owner = segment.speaker || 'Unassigned';
        }

        items.push({
          id: `action-${++this.itemIdCounter}`,
          owner: owner || segment.speaker || 'Unassigned',
          task,
          deadline: deadline || undefined,
          source: 'auto_detected',
          sourceText: segment.text,
          detectedAt: new Date().toISOString(),
          completed: false,
        });

        break; // One action item per segment to avoid duplicates
      }
    }

    return items;
  }

  /**
   * Detect decisions in a transcript segment.
   */
  detectDecisions(segment: TranscriptSegment): Decision[] {
    const decisions: Decision[] = [];

    for (const pattern of DECISION_PATTERNS) {
      const match = segment.text.match(pattern);
      if (match && match[1]?.trim().length > 3) {
        decisions.push({
          id: `decision-${++this.decisionIdCounter}`,
          description: match[1].trim(),
          proposedBy: segment.speaker,
          context: segment.text,
          source: 'auto_detected',
          sourceText: segment.text,
          detectedAt: new Date().toISOString(),
        });

        break; // One decision per segment
      }
    }

    return decisions;
  }

  /**
   * Detect unanswered questions in a transcript segment.
   */
  detectQuestions(segment: TranscriptSegment): OpenQuestion[] {
    const questions: OpenQuestion[] = [];

    for (const pattern of QUESTION_PATTERNS) {
      const match = segment.text.match(pattern);
      if (match) {
        questions.push({
          question: match[0].trim(),
          askedBy: segment.speaker,
          askedAt: segment.timestamp,
        });
        break;
      }
    }

    return questions;
  }

  // ─── Summary Generation ───────────────────────────────────────

  /**
   * Generate a comprehensive meeting summary.
   */
  generateSummary(meeting: MeetingSession): MeetingSummary {
    const duration = this.formatDuration(meeting.durationMinutes);
    const date = new Date(meeting.startedAt).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const executiveSummary = this.generateExecutiveSummary(meeting);
    const markdownReport = this.generateMarkdownReport(meeting, date, duration, executiveSummary);
    const voiceSummary = this.generateVoiceSummary(meeting, duration);

    return {
      title: meeting.title,
      date,
      duration,
      participants: [...meeting.participants],
      executiveSummary,
      decisions: [...meeting.decisions],
      actionItems: [...meeting.actionItems],
      topics: [...meeting.topics],
      openQuestions: [...meeting.openQuestions],
      visualsCaptured: meeting.visuals.length,
      markdownReport,
      voiceSummary,
    };
  }

  /**
   * Generate an executive summary (3-5 sentences).
   */
  private generateExecutiveSummary(meeting: MeetingSession): string {
    const parts: string[] = [];

    // Duration and participants
    const duration = this.formatDuration(meeting.durationMinutes);
    if (meeting.participants.length > 0) {
      parts.push(
        `${meeting.title} lasted ${duration} with ${meeting.participants.length} participant${meeting.participants.length > 1 ? 's' : ''}: ${meeting.participants.join(', ')}.`
      );
    } else {
      parts.push(`${meeting.title} lasted ${duration}.`);
    }

    // Topics
    if (meeting.topics.length > 0) {
      parts.push(`Key topics discussed: ${meeting.topics.join(', ')}.`);
    }

    // Decisions
    if (meeting.decisions.length > 0) {
      parts.push(`${meeting.decisions.length} decision${meeting.decisions.length > 1 ? 's were' : ' was'} made.`);
    }

    // Action items
    if (meeting.actionItems.length > 0) {
      const owners = [...new Set(meeting.actionItems.map(a => a.owner))];
      parts.push(
        `${meeting.actionItems.length} action item${meeting.actionItems.length > 1 ? 's' : ''} assigned to ${owners.join(', ')}.`
      );
    }

    // Open questions
    if (meeting.openQuestions.length > 0) {
      parts.push(`${meeting.openQuestions.length} question${meeting.openQuestions.length > 1 ? 's remain' : ' remains'} open.`);
    }

    return parts.join(' ');
  }

  /**
   * Generate full markdown meeting report.
   */
  private generateMarkdownReport(
    meeting: MeetingSession,
    date: string,
    duration: string,
    executiveSummary: string,
  ): string {
    const lines: string[] = [];

    lines.push(`## Meeting: ${meeting.title}`);
    lines.push(`**Date:** ${date} | **Duration:** ${duration} | **Participants:** ${meeting.participants.length > 0 ? meeting.participants.join(', ') : 'Not recorded'}`);
    lines.push('');

    // Summary
    lines.push('### Summary');
    lines.push(executiveSummary);
    lines.push('');

    // Decisions
    if (meeting.decisions.length > 0) {
      lines.push('### Decisions');
      for (const d of meeting.decisions) {
        lines.push(`- ${d.description}${d.proposedBy ? ` (proposed by ${d.proposedBy})` : ''}`);
      }
      lines.push('');
    }

    // Action items
    if (meeting.actionItems.length > 0) {
      lines.push('### Action Items');
      for (const a of meeting.actionItems) {
        const deadline = a.deadline ? ` — by ${a.deadline}` : '';
        lines.push(`- [ ] **${a.owner}**: ${a.task}${deadline}`);
      }
      lines.push('');
    }

    // Topics
    if (meeting.topics.length > 0) {
      lines.push('### Key Topics');
      for (const t of meeting.topics) {
        lines.push(`- ${t}`);
      }
      lines.push('');
    }

    // Open questions
    if (meeting.openQuestions.length > 0) {
      lines.push('### Open Questions');
      for (const q of meeting.openQuestions) {
        lines.push(`- ${q.question}${q.askedBy ? ` (asked by ${q.askedBy})` : ''}`);
      }
      lines.push('');
    }

    // Annotations
    if (meeting.annotations.length > 0) {
      lines.push('### Notes');
      for (const a of meeting.annotations) {
        lines.push(`- ${a.text}`);
      }
      lines.push('');
    }

    // Visual captures
    if (meeting.visuals.length > 0) {
      lines.push('### Visual Captures');
      for (const v of meeting.visuals) {
        lines.push(`- **${v.contentType}** (${v.capturedAt}): ${v.description.substring(0, 100)}`);
        if (v.extractedText) {
          const text = v.extractedText.substring(0, 200);
          lines.push(`  > ${text}${v.extractedText.length > 200 ? '...' : ''}`);
        }
      }
      lines.push('');
    }

    // Transcript excerpt (first 20 lines)
    if (meeting.transcript.length > 0) {
      lines.push('### Transcript (excerpt)');
      const excerpt = meeting.transcript.slice(0, 20);
      for (const t of excerpt) {
        lines.push(`**${t.speaker}:** ${t.text}`);
      }
      if (meeting.transcript.length > 20) {
        lines.push(`*...and ${meeting.transcript.length - 20} more segments*`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('🌙 Generated by Night Shift Meeting Intelligence');

    return lines.join('\n');
  }

  /**
   * Generate a voice-friendly TTS summary.
   */
  private generateVoiceSummary(meeting: MeetingSession, duration: string): string {
    const parts: string[] = [];

    parts.push(`Meeting ended. ${meeting.title}, ${duration}.`);

    if (meeting.decisions.length > 0) {
      parts.push(`${meeting.decisions.length} decision${meeting.decisions.length > 1 ? 's' : ''} made.`);
      // Read first 2 decisions
      for (const d of meeting.decisions.slice(0, 2)) {
        parts.push(d.description + '.');
      }
    }

    if (meeting.actionItems.length > 0) {
      parts.push(`${meeting.actionItems.length} action item${meeting.actionItems.length > 1 ? 's' : ''}.`);
      // Read first 3 action items
      for (const a of meeting.actionItems.slice(0, 3)) {
        parts.push(`${a.owner}: ${a.task}.`);
      }
    }

    if (meeting.openQuestions.length > 0) {
      parts.push(`${meeting.openQuestions.length} open question${meeting.openQuestions.length > 1 ? 's' : ''} remain.`);
    }

    parts.push(`${meeting.visuals.length} slide${meeting.visuals.length !== 1 ? 's' : ''} captured.`);

    return parts.join(' ');
  }

  // ─── Utility Methods ──────────────────────────────────────────

  /**
   * Classify visual content type from analysis.
   */
  private classifyVisualContent(analysis: VisionAnalysis): VisualCapture['contentType'] | null {
    switch (analysis.sceneType) {
      case 'whiteboard': return 'whiteboard';
      case 'screen': return 'screen';
      case 'document': return 'document';
      default:
        // Check if text content suggests slides/whiteboard
        const hasText = (analysis.extractedText || []).some(t => t.text.length > 20);
        if (hasText && (analysis.sceneType === 'office' || analysis.sceneType === 'unknown')) {
          return 'other';
        }
        return null;
    }
  }

  /**
   * Determine if text has changed significantly from previous capture.
   */
  private isSignificantChange(current: string, previous: string): boolean {
    if (!previous) return true;
    if (!current) return false;

    // Normalize for comparison
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const a = norm(current);
    const b = norm(previous);

    if (a === b) return false;

    // Calculate Jaccard similarity on words
    const wordsA = new Set(a.split(' '));
    const wordsB = new Set(b.split(' '));

    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;

    if (union === 0) return false;

    const similarity = intersection / union;

    // Change threshold: if similarity is below (1 - threshold), it's a new slide
    return similarity < (1 - this.config.visualChangeThreshold);
  }

  private calculateDuration(): number {
    if (!this.currentMeeting) return 0;
    const start = new Date(this.currentMeeting.startedAt).getTime();
    const end = Date.now();
    return Math.round((end - start) / 60000);
  }

  private formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const hourStr = `${h} hour${h !== 1 ? 's' : ''}`;
    return m > 0 ? `${hourStr} ${m} minute${m !== 1 ? 's' : ''}` : hourStr;
  }

  // ─── Getters ──────────────────────────────────────────────────

  /** Get the current active meeting (if any). */
  getCurrentMeeting(): MeetingSession | null {
    return this.currentMeeting ? { ...this.currentMeeting } : null;
  }

  /** Check if a meeting is currently active. */
  isMeetingActive(): boolean {
    return this.currentMeeting?.status === 'active';
  }

  /** Get meeting history. */
  getMeetingHistory(): MeetingSummary[] {
    return [...this.meetingHistory];
  }

  /** Get current config. */
  getConfig(): Readonly<MeetingAgentConfig> {
    return { ...this.config };
  }

  /** Update config at runtime. */
  updateConfig(patch: Partial<MeetingAgentConfig>): void {
    this.config = { ...this.config, ...patch };
  }
}
