/**
 * Inspection Agent — Automated walkthrough documentation & reporting.
 *
 * Walk through any space (property, server room, construction site,
 * warehouse, vehicle) wearing glasses. Agent auto-captures, analyzes
 * each scene, logs findings by severity, and generates a professional
 * inspection report with photos, annotations, and recommendations.
 *
 * Inspection types:
 * - property   — Rental/sale condition reports
 * - server     — Server room / data center audits
 * - construction — Progress + safety compliance
 * - warehouse  — Organization, safety, inventory spot-check
 * - vehicle    — Pre-purchase / fleet condition assessment
 * - general    — Catch-all for any walkthrough
 *
 * Voice commands:
 * - "Start inspection: property" → begins property inspection
 * - "Note: water damage on ceiling" → voice annotation
 * - "Flag critical: exposed wiring" → manual critical finding
 * - "Next room" / "Next area" → section boundary
 * - "End inspection" → finish and generate report
 *
 * Revenue: Powers "Inspection-as-a-Service" feature ($149-999/mo).
 *
 * Usage:
 *   const agent = new InspectionAgent({ ... });
 *   agent.startInspection('property', 'Unit 4B, 123 Main St');
 *   // walk through, agent auto-captures ...
 *   const report = agent.endInspection();
 */

import { EventEmitter } from 'eventemitter3';
import type {
  CapturedImage,
  VisionAnalysis,
  GeoLocation,
  PipelineResult,
} from '../types.js';
import type { RoutingContext, AgentResponse } from '../routing/context-router.js';

// ─── Types ──────────────────────────────────────────────────────

export type InspectionType =
  | 'property'
  | 'server'
  | 'construction'
  | 'warehouse'
  | 'vehicle'
  | 'general';

export type FindingSeverity = 'critical' | 'major' | 'minor' | 'informational';

export interface InspectionFinding {
  /** Unique finding ID */
  id: string;
  /** Severity level */
  severity: FindingSeverity;
  /** Category of finding */
  category: string;
  /** Brief title */
  title: string;
  /** Detailed description */
  description: string;
  /** Recommended action */
  recommendation: string;
  /** Which section/room/area */
  section: string;
  /** Photo evidence (image IDs) */
  imageRefs: string[];
  /** GPS location if available */
  location?: GeoLocation;
  /** When found */
  detectedAt: string;
  /** How it was found */
  source: 'auto_detected' | 'voice_annotation' | 'manual';
  /** Estimated repair/remediation cost (if applicable) */
  estimatedCost?: number;
}

export interface InspectionSection {
  /** Section name (e.g., "Living Room", "Rack A3", "North Wall") */
  name: string;
  /** When section was started */
  startedAt: string;
  /** Number of images captured in this section */
  imageCount: number;
  /** Findings in this section */
  findings: InspectionFinding[];
  /** Notes/annotations for this section */
  notes: string[];
  /** General condition assessment */
  condition?: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
}

export interface InspectionSession {
  /** Unique inspection ID */
  id: string;
  /** Type of inspection */
  type: InspectionType;
  /** Location/property/site name */
  locationName: string;
  /** Address if available */
  address?: string;
  /** Inspector name */
  inspectorName: string;
  /** When started */
  startedAt: string;
  /** When ended */
  endedAt?: string;
  /** Duration in minutes */
  durationMinutes: number;
  /** Inspection status */
  status: 'active' | 'paused' | 'completed';
  /** Sections walked through */
  sections: InspectionSection[];
  /** Current active section */
  currentSection: string;
  /** All findings across sections */
  findings: InspectionFinding[];
  /** Total images captured */
  totalImages: number;
  /** Overall condition assessment */
  overallCondition?: InspectionSection['condition'];
  /** GPS coordinates of the inspection site */
  siteLocation?: GeoLocation;
}

export interface InspectionReport {
  /** Report title */
  title: string;
  /** Inspection type */
  type: InspectionType;
  /** Location/property */
  location: string;
  /** Inspector */
  inspector: string;
  /** Date */
  date: string;
  /** Duration */
  duration: string;
  /** Overall condition */
  overallCondition: string;
  /** Finding counts by severity */
  findingSummary: Record<FindingSeverity, number>;
  /** All findings organized by section */
  findingsBySection: Record<string, InspectionFinding[]>;
  /** Estimated total remediation cost */
  estimatedTotalCost: number;
  /** Sections covered */
  sectionsCovered: number;
  /** Total photos taken */
  totalPhotos: number;
  /** Full markdown report */
  markdownReport: string;
  /** Voice-friendly TTS summary */
  voiceSummary: string;
}

export interface InspectionAgentConfig {
  /** Default inspector name */
  inspectorName: string;
  /** Auto-detect findings from vision analysis */
  autoDetectFindings: boolean;
  /** Maximum findings per inspection */
  maxFindings: number;
  /** Maximum sections */
  maxSections: number;
  /** Default section name when none specified */
  defaultSectionName: string;
}

export const DEFAULT_INSPECTION_CONFIG: InspectionAgentConfig = {
  inspectorName: 'Inspector',
  autoDetectFindings: true,
  maxFindings: 500,
  maxSections: 100,
  defaultSectionName: 'General',
};

export interface InspectionAgentEvents {
  'inspection:started': (session: InspectionSession) => void;
  'inspection:ended': (report: InspectionReport) => void;
  'inspection:paused': (session: InspectionSession) => void;
  'inspection:resumed': (session: InspectionSession) => void;
  'finding:detected': (finding: InspectionFinding) => void;
  'finding:critical': (finding: InspectionFinding) => void;
  'section:changed': (section: string) => void;
  'image:captured': (imageId: string, section: string) => void;
}

// ─── Finding Detection Patterns ─────────────────────────────────

/** Keywords/patterns for auto-detecting findings by inspection type */
const FINDING_PATTERNS: Record<InspectionType, Array<{
  keywords: RegExp;
  category: string;
  severity: FindingSeverity;
  title: string;
  recommendation: string;
}>> = {
  property: [
    {
      keywords: /water\s+(?:damage|stain|leak|intrusion|mark)/i,
      category: 'Water Damage',
      severity: 'major',
      title: 'Water damage detected',
      recommendation: 'Investigate source of water intrusion. Check for mold behind affected surface.',
    },
    {
      keywords: /mold|mildew|fungus|black\s+spot/i,
      category: 'Mold',
      severity: 'critical',
      title: 'Mold or mildew detected',
      recommendation: 'Professional mold remediation required. Do not disturb affected area.',
    },
    {
      keywords: /crack(?:s|ed|ing)?(?:\s+(?:in|on|along))?\s+(?:wall|ceiling|floor|foundation)/i,
      category: 'Structural',
      severity: 'major',
      title: 'Cracks detected in surface',
      recommendation: 'Monitor crack progression. Consult structural engineer if cracks are wider than 1/4 inch.',
    },
    {
      keywords: /(?:peeling|chipping|flaking)\s+paint/i,
      category: 'Paint/Finish',
      severity: 'minor',
      title: 'Peeling or chipping paint',
      recommendation: 'Sand, prime, and repaint affected area. Test for lead paint if pre-1978 construction.',
    },
    {
      keywords: /(?:broken|cracked|damaged)\s+(?:window|glass|pane)/i,
      category: 'Windows',
      severity: 'major',
      title: 'Broken or damaged window',
      recommendation: 'Replace damaged window pane. Check seal integrity.',
    },
    {
      keywords: /(?:missing|damaged|loose)\s+(?:tile|grout)/i,
      category: 'Flooring',
      severity: 'minor',
      title: 'Tile or grout damage',
      recommendation: 'Regrout or replace affected tiles. Check subfloor for moisture damage.',
    },
    {
      keywords: /smoke\s+detector|fire\s+alarm|carbon\s+monoxide/i,
      category: 'Safety',
      severity: 'informational',
      title: 'Safety device noted',
      recommendation: 'Verify device is functional and batteries are current. Test monthly.',
    },
    {
      keywords: /(?:exposed|loose|damaged)\s+(?:wire|wiring|electrical)/i,
      category: 'Electrical',
      severity: 'critical',
      title: 'Electrical hazard detected',
      recommendation: 'Do not touch. Have licensed electrician inspect and repair immediately.',
    },
    {
      keywords: /(?:stain|discoloration|damage)\s+(?:on|to)\s+(?:carpet|floor|rug)/i,
      category: 'Flooring',
      severity: 'minor',
      title: 'Floor staining or damage',
      recommendation: 'Professional cleaning or replacement may be needed.',
    },
    {
      keywords: /(?:rust|corrosion|oxidation)\s+(?:on|around)/i,
      category: 'Corrosion',
      severity: 'minor',
      title: 'Rust or corrosion detected',
      recommendation: 'Treat affected area. Investigate moisture source causing corrosion.',
    },
  ],
  server: [
    {
      keywords: /(?:cable|wire|cord)\s+(?:mess|tangle|disorganiz|clutter)/i,
      category: 'Cable Management',
      severity: 'minor',
      title: 'Poor cable management',
      recommendation: 'Reorganize cables using proper cable management. Label all connections.',
    },
    {
      keywords: /(?:hot|warm|overheat|thermal|temperature)\s+(?:spot|zone|issue|warning)/i,
      category: 'Cooling',
      severity: 'major',
      title: 'Thermal issue detected',
      recommendation: 'Check HVAC and airflow. Ensure hot/cold aisle containment is maintained.',
    },
    {
      keywords: /(?:no|missing)\s+(?:label|tag|identifier)/i,
      category: 'Documentation',
      severity: 'minor',
      title: 'Missing equipment labels',
      recommendation: 'Add proper asset tags and cable labels for all equipment.',
    },
    {
      keywords: /(?:full|capacity|no\s+space|congested)\s+(?:rack|shelf|cabinet)/i,
      category: 'Capacity',
      severity: 'informational',
      title: 'Rack at or near capacity',
      recommendation: 'Plan for expansion. Consider consolidation or new rack installation.',
    },
    {
      keywords: /(?:dust|dirty|debris)/i,
      category: 'Cleanliness',
      severity: 'minor',
      title: 'Dust or debris accumulation',
      recommendation: 'Schedule cleaning. Dust can impair cooling and cause hardware failures.',
    },
    {
      keywords: /(?:amber|red|warning|error)\s+(?:light|LED|indicator)/i,
      category: 'Hardware',
      severity: 'major',
      title: 'Warning indicator on equipment',
      recommendation: 'Check equipment logs. Investigate and resolve the warning condition.',
    },
  ],
  construction: [
    {
      keywords: /(?:no|missing|without)\s+(?:hard\s+hat|helmet|PPE|safety\s+vest|harness)/i,
      category: 'Safety Compliance',
      severity: 'critical',
      title: 'PPE compliance violation',
      recommendation: 'Enforce mandatory PPE requirements. Issue citation if repeated.',
    },
    {
      keywords: /(?:fall|trip|slip)\s+(?:hazard|risk|danger)/i,
      category: 'Safety',
      severity: 'major',
      title: 'Fall/trip/slip hazard',
      recommendation: 'Mark hazard area. Install barriers or signage. Remediate promptly.',
    },
    {
      keywords: /(?:unsecured|loose|unstable)\s+(?:scaffold|ladder|platform)/i,
      category: 'Safety',
      severity: 'critical',
      title: 'Unsecured elevated work platform',
      recommendation: 'Stop work. Secure platform before allowing anyone on it.',
    },
    {
      keywords: /(?:progress|complete|finished|done)/i,
      category: 'Progress',
      severity: 'informational',
      title: 'Work progress noted',
      recommendation: 'Document in project timeline.',
    },
    {
      keywords: /(?:defect|deficiency|error|mistake)\s+(?:in|on|with)/i,
      category: 'Quality',
      severity: 'major',
      title: 'Construction defect',
      recommendation: 'Document and require correction before proceeding to next phase.',
    },
  ],
  warehouse: [
    {
      keywords: /(?:blocked|obstructed)\s+(?:exit|aisle|pathway|fire\s+lane)/i,
      category: 'Safety',
      severity: 'critical',
      title: 'Blocked exit or fire lane',
      recommendation: 'Clear immediately. This is a fire code violation.',
    },
    {
      keywords: /(?:damaged|broken|leaning)\s+(?:rack|shelf|pallet)/i,
      category: 'Racking',
      severity: 'major',
      title: 'Damaged storage racking',
      recommendation: 'Remove load from damaged rack. Repair or replace before reloading.',
    },
    {
      keywords: /(?:spill|leak|puddle|wet\s+floor)/i,
      category: 'Safety',
      severity: 'major',
      title: 'Spill or wet floor hazard',
      recommendation: 'Clean up immediately. Place wet floor signage. Investigate source.',
    },
    {
      keywords: /(?:overloaded|overweight|excess|too\s+heavy)/i,
      category: 'Safety',
      severity: 'major',
      title: 'Overloaded storage',
      recommendation: 'Reduce load to within rated capacity. Check posted weight limits.',
    },
    {
      keywords: /(?:disorganized|messy|cluttered|unorganized)/i,
      category: 'Organization',
      severity: 'minor',
      title: 'Area needs organization',
      recommendation: 'Schedule cleanup and reorganization. Implement 5S methodology.',
    },
  ],
  vehicle: [
    {
      keywords: /(?:dent|ding|scratch|scuff|scrape)\s*(?:on|in|along)?/i,
      category: 'Body Damage',
      severity: 'minor',
      title: 'Body damage detected',
      recommendation: 'Get paintless dent repair or body shop estimate.',
    },
    {
      keywords: /(?:rust|corrosion|rot)\s*(?:on|in|along|underneath)?/i,
      category: 'Corrosion',
      severity: 'major',
      title: 'Rust or corrosion detected',
      recommendation: 'Have mechanic assess structural integrity. Treat and protect affected area.',
    },
    {
      keywords: /(?:tire|tyre)\s+(?:wear|bald|low|flat|damage)/i,
      category: 'Tires',
      severity: 'major',
      title: 'Tire condition concern',
      recommendation: 'Measure tread depth. Replace tires below 2/32" tread.',
    },
    {
      keywords: /(?:check\s+engine|warning|malfunction)\s+(?:light|indicator)/i,
      category: 'Engine/Mechanical',
      severity: 'major',
      title: 'Warning light active',
      recommendation: 'Have diagnostic scan performed. Address underlying issue before purchase.',
    },
    {
      keywords: /(?:crack|chip|damage)\s+(?:in|on|to)\s+windshield/i,
      category: 'Glass',
      severity: 'minor',
      title: 'Windshield damage',
      recommendation: 'Repair chip before it spreads. Replace if crack is in driver\'s line of sight.',
    },
  ],
  general: [
    {
      keywords: /(?:damage|broken|defect|issue|problem|concern)/i,
      category: 'General',
      severity: 'minor',
      title: 'Issue noted',
      recommendation: 'Document and assess for repair or remediation.',
    },
    {
      keywords: /(?:hazard|danger|unsafe|risk)/i,
      category: 'Safety',
      severity: 'major',
      title: 'Safety concern noted',
      recommendation: 'Address safety concern promptly. Mark area if immediate risk.',
    },
  ],
};

// ─── Inspection Agent ───────────────────────────────────────────

export class InspectionAgent extends EventEmitter<InspectionAgentEvents> {
  private config: InspectionAgentConfig;
  private currentInspection: InspectionSession | null = null;
  private inspectionHistory: InspectionReport[] = [];
  private findingIdCounter = 0;

  constructor(config: Partial<InspectionAgentConfig> = {}) {
    super();
    this.config = { ...DEFAULT_INSPECTION_CONFIG, ...config };
  }

  // ─── SpecialistAgent interface ────────────────────────────────

  /**
   * Handle an image routed by the Context Router.
   */
  async handle(
    image: CapturedImage,
    analysis: VisionAnalysis,
    context: RoutingContext,
  ): Promise<AgentResponse> {
    // If no inspection is active, suggest starting one
    if (!this.currentInspection || this.currentInspection.status !== 'active') {
      return {
        agentId: 'inspection',
        agentName: 'Inspection Agent',
        success: true,
        data: null,
        summary: 'No active inspection. Say "start inspection: [type]" to begin.',
        priority: 10,
      };
    }

    // Process the image as part of the active inspection
    const findings = this.processImage(image, analysis);

    const findingSummary = findings.length > 0
      ? `Found ${findings.length} issue${findings.length > 1 ? 's' : ''}: ${findings.map(f => f.title).join('; ')}`
      : 'No issues found in this capture.';

    const ttsText = findings.some(f => f.severity === 'critical')
      ? `Critical finding: ${findings.find(f => f.severity === 'critical')!.title}. ${findings.find(f => f.severity === 'critical')!.recommendation}`
      : findings.length > 0
        ? `${findings.length} finding${findings.length > 1 ? 's' : ''} noted in ${this.currentInspection.currentSection}.`
        : undefined;

    return {
      agentId: 'inspection',
      agentName: 'Inspection Agent',
      success: true,
      data: { findings, section: this.currentInspection.currentSection },
      summary: findingSummary,
      ttsText,
      priority: findings.some(f => f.severity === 'critical') ? 2 : 7,
    };
  }

  // ─── Inspection Lifecycle ─────────────────────────────────────

  /**
   * Start a new inspection.
   */
  startInspection(
    type: InspectionType,
    locationName: string,
    address?: string,
  ): InspectionSession {
    const session: InspectionSession = {
      id: `inspection-${Date.now()}`,
      type,
      locationName,
      address,
      inspectorName: this.config.inspectorName,
      startedAt: new Date().toISOString(),
      durationMinutes: 0,
      status: 'active',
      sections: [{
        name: this.config.defaultSectionName,
        startedAt: new Date().toISOString(),
        imageCount: 0,
        findings: [],
        notes: [],
      }],
      currentSection: this.config.defaultSectionName,
      findings: [],
      totalImages: 0,
    };

    this.currentInspection = session;
    this.emit('inspection:started', session);
    return session;
  }

  /**
   * End the current inspection and generate report.
   */
  endInspection(): InspectionReport {
    if (!this.currentInspection) {
      throw new Error('No active inspection to end');
    }

    this.currentInspection.status = 'completed';
    this.currentInspection.endedAt = new Date().toISOString();
    this.currentInspection.durationMinutes = this.calculateDuration();
    this.currentInspection.overallCondition = this.assessOverallCondition();

    const report = this.generateReport(this.currentInspection);
    this.inspectionHistory.push(report);
    this.emit('inspection:ended', report);

    this.currentInspection = null;
    return report;
  }

  /**
   * Pause the inspection.
   */
  pauseInspection(): void {
    if (!this.currentInspection || this.currentInspection.status !== 'active') return;
    this.currentInspection.status = 'paused';
    this.emit('inspection:paused', this.currentInspection);
  }

  /**
   * Resume a paused inspection.
   */
  resumeInspection(): void {
    if (!this.currentInspection || this.currentInspection.status !== 'paused') return;
    this.currentInspection.status = 'active';
    this.emit('inspection:resumed', this.currentInspection);
  }

  // ─── Section Management ───────────────────────────────────────

  /**
   * Move to a new section/room/area.
   */
  changeSection(sectionName: string): void {
    if (!this.currentInspection) return;

    // Check if section already exists
    let section = this.currentInspection.sections.find(s => s.name === sectionName);
    if (!section) {
      if (this.currentInspection.sections.length >= this.config.maxSections) return;

      section = {
        name: sectionName,
        startedAt: new Date().toISOString(),
        imageCount: 0,
        findings: [],
        notes: [],
      };
      this.currentInspection.sections.push(section);
    }

    this.currentInspection.currentSection = sectionName;
    this.emit('section:changed', sectionName);
  }

  // ─── Image Processing ────────────────────────────────────────

  /**
   * Process an image captured during inspection.
   * Auto-detects findings based on inspection type.
   */
  processImage(
    image: CapturedImage,
    analysis: VisionAnalysis,
  ): InspectionFinding[] {
    if (!this.currentInspection || this.currentInspection.status !== 'active') {
      return [];
    }

    // Increment counters
    this.currentInspection.totalImages++;
    const section = this.getCurrentSection();
    if (section) {
      section.imageCount++;
    }

    this.emit('image:captured', image.id, this.currentInspection.currentSection);

    // Auto-detect findings
    if (!this.config.autoDetectFindings) return [];

    const findings = this.detectFindings(analysis, image);

    // Add findings to session + section
    for (const finding of findings) {
      if (this.currentInspection.findings.length >= this.config.maxFindings) break;

      this.currentInspection.findings.push(finding);
      if (section) {
        section.findings.push(finding);
      }

      this.emit('finding:detected', finding);
      if (finding.severity === 'critical') {
        this.emit('finding:critical', finding);
      }
    }

    return findings;
  }

  // ─── Manual Input ─────────────────────────────────────────────

  /**
   * Add a voice annotation/note to the current section.
   */
  addNote(text: string): void {
    if (!this.currentInspection || this.currentInspection.status !== 'active') return;
    const section = this.getCurrentSection();
    if (section) {
      section.notes.push(text);
    }
  }

  /**
   * Manually add a finding.
   */
  addFinding(params: {
    severity: FindingSeverity;
    title: string;
    description: string;
    recommendation?: string;
    category?: string;
    imageId?: string;
    estimatedCost?: number;
  }): InspectionFinding {
    const finding: InspectionFinding = {
      id: `finding-${++this.findingIdCounter}`,
      severity: params.severity,
      category: params.category || 'Manual',
      title: params.title,
      description: params.description,
      recommendation: params.recommendation || 'Document and address as appropriate.',
      section: this.currentInspection?.currentSection || this.config.defaultSectionName,
      imageRefs: params.imageId ? [params.imageId] : [],
      detectedAt: new Date().toISOString(),
      source: 'manual',
      estimatedCost: params.estimatedCost,
    };

    if (this.currentInspection?.status === 'active') {
      this.currentInspection.findings.push(finding);
      const section = this.getCurrentSection();
      if (section) {
        section.findings.push(finding);
      }
    }

    this.emit('finding:detected', finding);
    if (finding.severity === 'critical') {
      this.emit('finding:critical', finding);
    }

    return finding;
  }

  /**
   * Set the condition assessment for the current section.
   */
  setSectionCondition(condition: InspectionSection['condition']): void {
    const section = this.getCurrentSection();
    if (section) {
      section.condition = condition;
    }
  }

  // ─── Finding Detection ────────────────────────────────────────

  /**
   * Auto-detect findings from vision analysis based on inspection type.
   */
  private detectFindings(
    analysis: VisionAnalysis,
    image: CapturedImage,
  ): InspectionFinding[] {
    const findings: InspectionFinding[] = [];
    const type = this.currentInspection?.type || 'general';

    // Get patterns for this inspection type + general patterns
    const patterns = [
      ...(FINDING_PATTERNS[type] || []),
      ...(type !== 'general' ? FINDING_PATTERNS.general : []),
    ];

    // Combine all text for analysis
    const sceneText = [
      analysis.sceneDescription || '',
      ...(analysis.extractedText || []).map(t => t.text),
    ].join(' ');

    for (const { keywords, category, severity, title, recommendation } of patterns) {
      if (keywords.test(sceneText)) {
        findings.push({
          id: `finding-${++this.findingIdCounter}`,
          severity,
          category,
          title,
          description: `Detected in ${this.currentInspection?.currentSection || 'unknown area'}: ${sceneText.substring(0, 200)}`,
          recommendation,
          section: this.currentInspection?.currentSection || this.config.defaultSectionName,
          imageRefs: [image.id],
          location: image.location,
          detectedAt: new Date().toISOString(),
          source: 'auto_detected',
        });
      }
    }

    return findings;
  }

  // ─── Report Generation ────────────────────────────────────────

  /**
   * Generate a professional inspection report.
   */
  generateReport(session: InspectionSession): InspectionReport {
    const date = new Date(session.startedAt).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const duration = this.formatDuration(session.durationMinutes);

    const findingSummary: Record<FindingSeverity, number> = {
      critical: 0,
      major: 0,
      minor: 0,
      informational: 0,
    };

    const findingsBySection: Record<string, InspectionFinding[]> = {};
    let estimatedTotalCost = 0;

    for (const finding of session.findings) {
      findingSummary[finding.severity]++;
      if (!findingsBySection[finding.section]) {
        findingsBySection[finding.section] = [];
      }
      findingsBySection[finding.section].push(finding);
      estimatedTotalCost += finding.estimatedCost || 0;
    }

    const overallCondition = session.overallCondition ?? this.assessOverallConditionFromFindings(session.findings) ?? 'good';
    const markdownReport = this.generateMarkdownReport(session, date, duration, findingSummary, findingsBySection, overallCondition, estimatedTotalCost);
    const voiceSummary = this.generateVoiceSummary(session, duration, findingSummary, overallCondition);

    return {
      title: `${this.typeLabel(session.type)} Inspection Report — ${session.locationName}`,
      type: session.type,
      location: session.locationName,
      inspector: session.inspectorName,
      date,
      duration,
      overallCondition,
      findingSummary,
      findingsBySection,
      estimatedTotalCost,
      sectionsCovered: session.sections.length,
      totalPhotos: session.totalImages,
      markdownReport,
      voiceSummary,
    };
  }

  /**
   * Generate full markdown inspection report.
   */
  private generateMarkdownReport(
    session: InspectionSession,
    date: string,
    duration: string,
    findingSummary: Record<FindingSeverity, number>,
    findingsBySection: Record<string, InspectionFinding[]>,
    overallCondition: string,
    estimatedTotalCost: number,
  ): string {
    const lines: string[] = [];

    // Header
    lines.push(`## ${this.typeLabel(session.type)} Inspection Report`);
    lines.push(`**Location:** ${session.locationName}${session.address ? ` — ${session.address}` : ''}`);
    lines.push(`**Date:** ${date} | **Duration:** ${duration} | **Inspector:** ${session.inspectorName}`);
    lines.push(`**Overall Condition:** ${this.conditionEmoji(overallCondition)} ${overallCondition.toUpperCase()}`);
    lines.push('');

    // Executive Summary
    const totalFindings = Object.values(findingSummary).reduce((a, b) => a + b, 0);
    lines.push('### Executive Summary');
    lines.push(`Inspection covered ${session.sections.length} area${session.sections.length !== 1 ? 's' : ''} with ${session.totalImages} photo${session.totalImages !== 1 ? 's' : ''} captured.`);
    if (totalFindings > 0) {
      const parts: string[] = [];
      if (findingSummary.critical) parts.push(`🔴 ${findingSummary.critical} critical`);
      if (findingSummary.major) parts.push(`🟠 ${findingSummary.major} major`);
      if (findingSummary.minor) parts.push(`🟡 ${findingSummary.minor} minor`);
      if (findingSummary.informational) parts.push(`🔵 ${findingSummary.informational} informational`);
      lines.push(`**${totalFindings} findings:** ${parts.join(', ')}`);
    } else {
      lines.push('**No issues found.** Property/site is in good condition.');
    }
    if (estimatedTotalCost > 0) {
      lines.push(`**Estimated remediation cost:** $${estimatedTotalCost.toLocaleString()}`);
    }
    lines.push('');

    // Findings by section
    if (totalFindings > 0) {
      lines.push('### Findings by Area');
      lines.push('');

      for (const section of session.sections) {
        const sectionFindings = findingsBySection[section.name] || [];
        lines.push(`#### ${section.name}${section.condition ? ` — ${section.condition.toUpperCase()}` : ''}`);
        lines.push(`*${section.imageCount} photo${section.imageCount !== 1 ? 's' : ''} captured*`);

        if (sectionFindings.length > 0) {
          for (const finding of sectionFindings) {
            const emoji = this.severityEmoji(finding.severity);
            lines.push(`- ${emoji} **[${finding.severity.toUpperCase()}]** ${finding.title}`);
            lines.push(`  ${finding.description.substring(0, 200)}`);
            lines.push(`  *Recommendation:* ${finding.recommendation}`);
            if (finding.estimatedCost) {
              lines.push(`  *Estimated cost:* $${finding.estimatedCost.toLocaleString()}`);
            }
          }
        } else {
          lines.push('- ✅ No issues found in this area');
        }

        if (section.notes.length > 0) {
          lines.push('');
          lines.push('**Notes:**');
          for (const note of section.notes) {
            lines.push(`- ${note}`);
          }
        }

        lines.push('');
      }
    }

    // Section summary table
    lines.push('### Areas Inspected');
    lines.push('| Area | Photos | Findings | Condition |');
    lines.push('|------|--------|----------|-----------|');
    for (const section of session.sections) {
      const condition = section.condition || 'N/A';
      const findingCount = (findingsBySection[section.name] || []).length;
      lines.push(`| ${section.name} | ${section.imageCount} | ${findingCount} | ${condition} |`);
    }
    lines.push('');

    lines.push('---');
    lines.push('🌙 Generated by Night Shift Inspection Agent');

    return lines.join('\n');
  }

  /**
   * Generate voice-friendly TTS summary.
   */
  private generateVoiceSummary(
    session: InspectionSession,
    duration: string,
    findingSummary: Record<FindingSeverity, number>,
    overallCondition: string,
  ): string {
    const parts: string[] = [];
    const total = Object.values(findingSummary).reduce((a, b) => a + b, 0);

    parts.push(`Inspection complete. ${session.locationName}, ${duration}.`);
    parts.push(`Overall condition: ${overallCondition}.`);
    parts.push(`${session.sections.length} area${session.sections.length !== 1 ? 's' : ''} inspected, ${session.totalImages} photos taken.`);

    if (total > 0) {
      parts.push(`${total} finding${total !== 1 ? 's' : ''}.`);
      if (findingSummary.critical > 0) {
        parts.push(`${findingSummary.critical} critical issue${findingSummary.critical !== 1 ? 's' : ''} require immediate attention.`);
      }
      if (findingSummary.major > 0) {
        parts.push(`${findingSummary.major} major issue${findingSummary.major !== 1 ? 's' : ''}.`);
      }
    } else {
      parts.push('No issues found.');
    }

    return parts.join(' ');
  }

  // ─── Utility Methods ──────────────────────────────────────────

  private getCurrentSection(): InspectionSection | null {
    if (!this.currentInspection) return null;
    return this.currentInspection.sections.find(
      s => s.name === this.currentInspection!.currentSection
    ) || null;
  }

  private assessOverallCondition(): InspectionSection['condition'] {
    if (!this.currentInspection) return 'good';
    return this.assessOverallConditionFromFindings(this.currentInspection.findings);
  }

  private assessOverallConditionFromFindings(findings: InspectionFinding[]): InspectionSection['condition'] {
    const critical = findings.filter(f => f.severity === 'critical').length;
    const major = findings.filter(f => f.severity === 'major').length;
    const minor = findings.filter(f => f.severity === 'minor').length;

    if (critical >= 2) return 'critical';
    if (critical >= 1 || major >= 5) return 'poor';
    if (major >= 2 || minor >= 8) return 'fair';
    if (major >= 1 || minor >= 3) return 'good';
    return 'excellent';
  }

  private calculateDuration(): number {
    if (!this.currentInspection) return 0;
    const start = new Date(this.currentInspection.startedAt).getTime();
    return Math.round((Date.now() - start) / 60000);
  }

  private formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const hourStr = `${h} hour${h !== 1 ? 's' : ''}`;
    return m > 0 ? `${hourStr} ${m} minute${m !== 1 ? 's' : ''}` : hourStr;
  }

  private typeLabel(type: InspectionType): string {
    const labels: Record<InspectionType, string> = {
      property: 'Property',
      server: 'Server Room',
      construction: 'Construction Site',
      warehouse: 'Warehouse',
      vehicle: 'Vehicle',
      general: 'General',
    };
    return labels[type] || 'General';
  }

  private severityEmoji(severity: FindingSeverity): string {
    switch (severity) {
      case 'critical': return '🔴';
      case 'major': return '🟠';
      case 'minor': return '🟡';
      case 'informational': return '🔵';
    }
  }

  private conditionEmoji(condition: string): string {
    switch (condition) {
      case 'excellent': return '🟢';
      case 'good': return '🟢';
      case 'fair': return '🟡';
      case 'poor': return '🟠';
      case 'critical': return '🔴';
      default: return '⚪';
    }
  }

  // ─── Getters ──────────────────────────────────────────────────

  /** Get current inspection. */
  getCurrentInspection(): InspectionSession | null {
    return this.currentInspection ? { ...this.currentInspection } : null;
  }

  /** Check if inspection is active. */
  isInspectionActive(): boolean {
    return this.currentInspection?.status === 'active';
  }

  /** Get inspection history. */
  getInspectionHistory(): InspectionReport[] {
    return [...this.inspectionHistory];
  }

  /** Get config. */
  getConfig(): Readonly<InspectionAgentConfig> {
    return { ...this.config };
  }

  /** Update config. */
  updateConfig(patch: Partial<InspectionAgentConfig>): void {
    this.config = { ...this.config, ...patch };
  }
}
