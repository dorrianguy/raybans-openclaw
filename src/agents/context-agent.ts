/**
 * Context-Aware Assistant — Smart Help Based on What You're Doing
 *
 * Understands your situation from visual context and provides
 * relevant help without being asked.
 *
 * Feature #8 from VISION-FEATURES-SPEC.md
 *
 * Capabilities:
 * - Automatic context detection (kitchen, workshop, gym, store, etc.)
 * - Object identification with contextual information
 * - Cross-referencing with user preferences (dietary, fitness, etc.)
 * - Recipe tracking and step guidance
 * - Tool/part identification for workshops
 * - Nutrition info for grocery shopping
 * - Exercise form guidance
 * - Plant/animal identification outdoors
 * - Brief, actionable TTS responses (5-10 seconds)
 *
 * 🌙 Built by Night Shift Agent
 */

import type { VisionAnalysis } from '../types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ContextConfig {
  /** User preferences that affect context responses */
  userPreferences: UserPreferences;
  /** Active tasks/goals the user is working on */
  activeTasks: ActiveTask[];
  /** How chatty the assistant should be */
  proactiveness: 'silent' | 'conservative' | 'helpful' | 'proactive';
  /** Max items in context history */
  maxHistory: number;
  /** Auto-detect context switches */
  autoDetectContext: boolean;
  /** Minimum confidence to offer help unprompted */
  minProactiveConfidence: number;
}

export interface UserPreferences {
  /** Dietary restrictions */
  dietary: DietaryProfile;
  /** Fitness goals */
  fitness: FitnessProfile;
  /** Cooking skill level */
  cookingLevel: 'beginner' | 'intermediate' | 'advanced';
  /** Workshop/DIY skill level */
  workshopLevel: 'beginner' | 'intermediate' | 'advanced';
  /** Units preference */
  unitSystem: 'metric' | 'imperial';
  /** Any custom preferences */
  custom: Record<string, string>;
}

export interface DietaryProfile {
  restrictions: DietaryRestriction[];
  /** Daily sugar target in grams */
  dailySugarTarget?: number;
  /** Daily calorie target */
  dailyCalorieTarget?: number;
  /** Daily sodium target in mg */
  dailySodiumTarget?: number;
  /** Allergens to flag */
  allergens: string[];
}

export type DietaryRestriction =
  | 'vegetarian' | 'vegan' | 'pescatarian'
  | 'gluten_free' | 'dairy_free' | 'nut_free'
  | 'keto' | 'paleo' | 'halal' | 'kosher'
  | 'low_sodium' | 'low_sugar' | 'low_carb';

export interface FitnessProfile {
  /** Current fitness program */
  program?: string;
  /** Goals */
  goals: string[];
  /** Injuries or limitations */
  limitations: string[];
  /** Preferred workout types */
  workoutTypes: string[];
}

export interface ActiveTask {
  type: 'recipe' | 'workout' | 'project' | 'shopping_list' | 'custom';
  name: string;
  /** Current step/progress */
  currentStep?: number;
  totalSteps?: number;
  /** Task-specific data */
  data: Record<string, unknown>;
  /** When the task was started */
  startedAt: string;
}

// ─── Context Detection ──────────────────────────────────────────

export type ContextType =
  | 'kitchen'
  | 'grocery_store'
  | 'workshop'
  | 'gym'
  | 'outdoor_nature'
  | 'outdoor_urban'
  | 'office'
  | 'restaurant'
  | 'vehicle'
  | 'medical'
  | 'retail_store'
  | 'home_general'
  | 'unknown';

export interface ContextDetection {
  /** Detected context */
  context: ContextType;
  /** Confidence 0-1 */
  confidence: number;
  /** Key indicators that led to this detection */
  indicators: string[];
}

export interface ContextResponse {
  id: string;
  /** What context was detected */
  context: ContextType;
  /** The main identified object/item */
  identifiedItem?: IdentifiedItem;
  /** Contextual information provided */
  information: ContextInfo[];
  /** Alerts (allergens, warnings, etc.) */
  alerts: ContextAlert[];
  /** Active task progress (if applicable) */
  taskProgress?: TaskProgress;
  /** Confidence in the response */
  confidence: number;
  /** Timestamp */
  respondedAt: string;
  /** Source image ID */
  imageId?: string;
}

export interface IdentifiedItem {
  name: string;
  category: string;
  details: Record<string, string>;
  confidence: number;
}

export interface ContextInfo {
  /** Type of info */
  type: 'identification' | 'instruction' | 'fact' | 'measurement' | 'nutrition'
    | 'price' | 'recipe_step' | 'exercise' | 'safety' | 'tip';
  /** The information */
  text: string;
  /** Priority (higher = more important to voice) */
  priority: number;
}

export interface ContextAlert {
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface TaskProgress {
  taskName: string;
  currentStep: number;
  totalSteps: number;
  nextInstruction?: string;
}

export interface ContextAgentStats {
  totalResponses: number;
  contextCounts: Record<string, number>;
  itemsIdentified: number;
  alertsRaised: number;
  tasksAssisted: number;
}

// ─── Context Detection Patterns ─────────────────────────────────

interface ContextPattern {
  context: ContextType;
  /** Object keywords that indicate this context */
  objectKeywords: string[];
  /** Scene description patterns */
  scenePatterns: RegExp[];
  /** Text patterns found via OCR */
  textPatterns: RegExp[];
  /** Base confidence if matched */
  baseConfidence: number;
}

const CONTEXT_PATTERNS: ContextPattern[] = [
  {
    context: 'kitchen',
    objectKeywords: [
      'stove', 'oven', 'microwave', 'refrigerator', 'fridge', 'counter',
      'cutting board', 'knife', 'pan', 'pot', 'bowl', 'spoon', 'spatula',
      'blender', 'toaster', 'sink', 'dish', 'plate', 'cup', 'mug',
      'food', 'ingredient', 'spice', 'herb', 'flour', 'sugar', 'salt',
    ],
    scenePatterns: [/kitchen/i, /cooking/i, /baking/i, /food prep/i],
    textPatterns: [/recipe/i, /ingredients?:/i, /preheat/i, /°[FC]/i, /tsp|tbsp|cup|oz/i],
    baseConfidence: 0.8,
  },
  {
    context: 'grocery_store',
    objectKeywords: [
      'shelf', 'aisle', 'cart', 'basket', 'price tag', 'barcode',
      'produce', 'cereal', 'can', 'bottle', 'package', 'label',
      'checkout', 'register', 'coupon',
    ],
    scenePatterns: [/grocery/i, /supermarket/i, /store aisle/i, /retail shelf/i],
    textPatterns: [
      /\$\d+\.\d{2}/, /nutrition facts/i, /ingredients:/i,
      /serving size/i, /calories/i, /net\s*w[t|eight]/i,
      /buy\s*\d+\s*get/i, /sale/i, /organic/i,
    ],
    baseConfidence: 0.8,
  },
  {
    context: 'workshop',
    objectKeywords: [
      'drill', 'saw', 'hammer', 'screwdriver', 'wrench', 'pliers',
      'bolt', 'nut', 'screw', 'nail', 'wood', 'metal', 'pipe',
      'wire', 'tape measure', 'level', 'clamp', 'vice', 'workbench',
      'sandpaper', 'paint', 'tool', 'ladder',
    ],
    scenePatterns: [/workshop/i, /garage/i, /tool/i, /workbench/i],
    textPatterns: [/\d+mm|\d+\s*inch/i, /torque/i, /gauge/i, /thread/i, /grade\s*\d/i],
    baseConfidence: 0.8,
  },
  {
    context: 'gym',
    objectKeywords: [
      'dumbbell', 'barbell', 'weight', 'bench', 'treadmill', 'bike',
      'elliptical', 'cable', 'machine', 'mat', 'rack', 'plate',
      'kettlebell', 'resistance band', 'pull-up bar', 'squat rack',
    ],
    scenePatterns: [/gym/i, /fitness/i, /workout/i, /exercise/i],
    textPatterns: [/\d+\s*(lbs?|kg)\b/i, /reps?/i, /sets?/i, /rest\s*\d/i],
    baseConfidence: 0.8,
  },
  {
    context: 'outdoor_nature',
    objectKeywords: [
      'tree', 'plant', 'flower', 'bush', 'grass', 'leaf', 'bird',
      'insect', 'butterfly', 'mushroom', 'rock', 'trail', 'mountain',
      'river', 'lake', 'forest', 'garden', 'soil', 'seed',
    ],
    scenePatterns: [/outdoor/i, /garden/i, /park/i, /forest/i, /nature/i, /trail/i],
    textPatterns: [/species/i, /botanical/i, /wildlife/i],
    baseConfidence: 0.7,
  },
  {
    context: 'restaurant',
    objectKeywords: [
      'menu', 'table', 'chair', 'waiter', 'wine', 'glass', 'napkin',
      'candle', 'tablecloth', 'fork', 'knife', 'plate', 'dish',
    ],
    scenePatterns: [/restaurant/i, /dining/i, /café|cafe/i, /bar\b/i],
    textPatterns: [/appetizer/i, /entrée|entree/i, /dessert/i, /specials?:/i, /\$\d+/],
    baseConfidence: 0.75,
  },
  {
    context: 'vehicle',
    objectKeywords: [
      'car', 'truck', 'dashboard', 'steering wheel', 'tire', 'engine',
      'hood', 'bumper', 'headlight', 'taillight', 'license plate',
      'speedometer', 'fuel', 'oil', 'brake', 'battery',
    ],
    scenePatterns: [/vehicle/i, /car\b/i, /truck/i, /automotive/i, /garage/i],
    textPatterns: [/mph|km\/h/i, /check engine/i, /oil\s*(change|level)/i, /PSI/i, /VIN/i],
    baseConfidence: 0.8,
  },
  {
    context: 'medical',
    objectKeywords: [
      'pill', 'medicine', 'prescription', 'syringe', 'bandage',
      'thermometer', 'blood pressure', 'stethoscope', 'first aid',
    ],
    scenePatterns: [/medical/i, /pharmacy/i, /hospital/i, /clinic/i],
    textPatterns: [/\d+\s*mg\b/i, /dosage/i, /prescription/i, /refill/i, /take\s*\d+/i],
    baseConfidence: 0.8,
  },
  {
    context: 'office',
    objectKeywords: [
      'computer', 'monitor', 'keyboard', 'mouse', 'desk', 'chair',
      'printer', 'whiteboard', 'projector', 'phone', 'notepad',
    ],
    scenePatterns: [/office/i, /workspace/i, /desk/i],
    textPatterns: [/meeting/i, /agenda/i, /deadline/i, /schedule/i],
    baseConfidence: 0.65,
  },
];

/**
 * Detect the user's current context from a vision analysis.
 */
export function detectContext(analysis: VisionAnalysis): ContextDetection {
  const scores: Record<ContextType, { score: number; indicators: string[] }> = {} as any;

  // Initialize all contexts
  for (const pattern of CONTEXT_PATTERNS) {
    scores[pattern.context] = { score: 0, indicators: [] };
  }

  // Score based on detected objects
  const objectLabels = analysis.detectedObjects.map(o => o.label.toLowerCase());
  for (const pattern of CONTEXT_PATTERNS) {
    for (const keyword of pattern.objectKeywords) {
      for (const label of objectLabels) {
        if (label.includes(keyword)) {
          scores[pattern.context].score += 0.2;
          scores[pattern.context].indicators.push(`object: ${label}`);
        }
      }
    }
  }

  // Score based on scene description
  const sceneDesc = analysis.sceneDescription.toLowerCase();
  for (const pattern of CONTEXT_PATTERNS) {
    for (const scenePat of pattern.scenePatterns) {
      if (scenePat.test(sceneDesc)) {
        scores[pattern.context].score += 0.3;
        scores[pattern.context].indicators.push(`scene: ${sceneDesc.slice(0, 50)}`);
      }
    }
  }

  // Score based on OCR text
  const allText = analysis.extractedText.map(t => t.text).join('\n');
  for (const pattern of CONTEXT_PATTERNS) {
    for (const textPat of pattern.textPatterns) {
      if (textPat.test(allText)) {
        scores[pattern.context].score += 0.2;
        const match = allText.match(textPat);
        if (match) {
          scores[pattern.context].indicators.push(`text: "${match[0]}"`);
        }
      }
    }
  }

  // Score based on scene type from vision analysis
  const sceneTypeMap: Record<string, ContextType> = {
    retail_shelf: 'grocery_store',
    warehouse: 'workshop',
    office: 'office',
    outdoor: 'outdoor_nature',
    kitchen: 'kitchen',
    workshop: 'workshop',
    vehicle: 'vehicle',
  };
  if (sceneTypeMap[analysis.sceneType]) {
    const ctx = sceneTypeMap[analysis.sceneType];
    scores[ctx].score += 0.25;
    scores[ctx].indicators.push(`sceneType: ${analysis.sceneType}`);
  }

  // Find best match
  const sorted = Object.entries(scores)
    .sort(([, a], [, b]) => b.score - a.score);

  if (sorted.length > 0 && sorted[0][1].score > 0) {
    const [context, data] = sorted[0];
    const patternDef = CONTEXT_PATTERNS.find(p => p.context === context);
    const confidence = Math.min(0.95, data.score * (patternDef?.baseConfidence ?? 0.7));
    return {
      context: context as ContextType,
      confidence,
      indicators: data.indicators.slice(0, 5), // Top 5 indicators
    };
  }

  return { context: 'unknown', confidence: 0, indicators: [] };
}

// ─── Contextual Knowledge Bases ─────────────────────────────────

interface NutritionAlertRule {
  pattern: RegExp;
  /** Which dietary restrictions this is relevant for */
  relevantFor: DietaryRestriction[];
  /** Alert message */
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

const NUTRITION_ALERTS: NutritionAlertRule[] = [
  { pattern: /\bgluten\b/i, relevantFor: ['gluten_free'], message: 'Contains gluten.', severity: 'critical' },
  { pattern: /\bwheat\b/i, relevantFor: ['gluten_free'], message: 'Contains wheat (gluten).', severity: 'critical' },
  { pattern: /\bmilk|dairy|lactose|casein|whey\b/i, relevantFor: ['dairy_free', 'vegan'], message: 'Contains dairy.', severity: 'critical' },
  { pattern: /\beggs?\b/i, relevantFor: ['vegan'], message: 'Contains eggs.', severity: 'warning' },
  { pattern: /\bhoney\b/i, relevantFor: ['vegan'], message: 'Contains honey.', severity: 'info' },
  { pattern: /\b(peanut|almond|cashew|walnut|pecan|pistachio|hazelnut|macadamia)\b/i, relevantFor: ['nut_free'], message: 'Contains tree nuts or peanuts.', severity: 'critical' },
  { pattern: /\b(beef|pork|chicken|turkey|lamb|bacon|ham|sausage)\b/i, relevantFor: ['vegetarian', 'vegan', 'pescatarian'], message: 'Contains meat.', severity: 'critical' },
  { pattern: /\b(fish|salmon|tuna|shrimp|crab|lobster|shellfish)\b/i, relevantFor: ['vegetarian', 'vegan'], message: 'Contains seafood.', severity: 'critical' },
  { pattern: /\bgelatin\b/i, relevantFor: ['vegetarian', 'vegan', 'halal'], message: 'Contains gelatin (animal-derived).', severity: 'warning' },
  { pattern: /\blard|tallow\b/i, relevantFor: ['vegetarian', 'vegan', 'halal', 'kosher'], message: 'Contains animal fats.', severity: 'warning' },
  { pattern: /\bpork\b/i, relevantFor: ['halal', 'kosher'], message: 'Contains pork.', severity: 'critical' },
  { pattern: /\balcohol\b/i, relevantFor: ['halal'], message: 'Contains alcohol.', severity: 'critical' },
  { pattern: /\bpalm\s*oil\b/i, relevantFor: [], message: 'Contains palm oil (environmental concern).', severity: 'info' },
  { pattern: /\bartificial\s*(color|flavor|sweetener)\b/i, relevantFor: [], message: 'Contains artificial additives.', severity: 'info' },
  { pattern: /high\s*fructose\s*corn\s*syrup/i, relevantFor: ['keto', 'low_sugar'], message: 'Contains high fructose corn syrup.', severity: 'warning' },
];

/**
 * Check for nutrition-related alerts based on text and dietary profile.
 */
export function checkNutritionAlerts(
  text: string,
  dietary: DietaryProfile
): ContextAlert[] {
  const alerts: ContextAlert[] = [];

  for (const rule of NUTRITION_ALERTS) {
    if (!rule.pattern.test(text)) continue;

    // Check if relevant to user's restrictions
    const isRelevant = rule.relevantFor.length === 0 ||
      rule.relevantFor.some(r => dietary.restrictions.includes(r));

    if (isRelevant && rule.relevantFor.length > 0) {
      alerts.push({ severity: rule.severity, message: rule.message });
    } else if (rule.relevantFor.length === 0 && dietary.restrictions.length > 0) {
      // General health alerts for health-conscious users
      alerts.push({ severity: rule.severity, message: rule.message });
    }

    // Check for allergens
    for (const allergen of dietary.allergens) {
      const allergenRegex = new RegExp(`\\b${allergen}\\b`, 'i');
      if (allergenRegex.test(text)) {
        alerts.push({
          severity: 'critical',
          message: `⚠️ ALLERGEN DETECTED: ${allergen}`,
        });
      }
    }
  }

  // Check numeric nutrition values
  const sugarMatch = text.match(/sugars?\s*(\d+)\s*g|(\d+)\s*g\s*sugars?/i);
  if (sugarMatch && dietary.dailySugarTarget) {
    const sugarG = parseInt(sugarMatch[1] ?? sugarMatch[2] ?? sugarMatch[0].match(/\d+/)?.[0] ?? '0');
    if (sugarG > dietary.dailySugarTarget * 0.5) {
      alerts.push({
        severity: 'warning',
        message: `High sugar: ${sugarG}g per serving (your daily target: ${dietary.dailySugarTarget}g).`,
      });
    }
  }

  return alerts;
}

// ─── Workshop Knowledge ─────────────────────────────────────────

interface BoltSpec {
  pattern: RegExp;
  description: string;
  torqueSpec?: string;
}

const BOLT_SPECS: BoltSpec[] = [
  { pattern: /M6/i, description: 'M6 metric bolt (6mm diameter)', torqueSpec: '8-10 Nm' },
  { pattern: /M8/i, description: 'M8 metric bolt (8mm diameter)', torqueSpec: '20-25 Nm' },
  { pattern: /M10/i, description: 'M10 metric bolt (10mm diameter)', torqueSpec: '40-50 Nm' },
  { pattern: /M12/i, description: 'M12 metric bolt (12mm diameter)', torqueSpec: '70-85 Nm' },
  { pattern: /1\/4["-]?\s*20/i, description: '1/4"-20 SAE bolt', torqueSpec: '6-8 ft-lbs' },
  { pattern: /3\/8["-]?\s*16/i, description: '3/8"-16 SAE bolt', torqueSpec: '20-25 ft-lbs' },
  { pattern: /1\/2["-]?\s*13/i, description: '1/2"-13 SAE bolt', torqueSpec: '50-60 ft-lbs' },
];

/**
 * Look up bolt/fastener specs from text.
 */
export function lookupBoltSpec(text: string): BoltSpec | null {
  for (const spec of BOLT_SPECS) {
    if (spec.pattern.test(text)) return spec;
  }
  return null;
}

// ─── Context-Aware Agent ────────────────────────────────────────

const DEFAULT_CONFIG: ContextConfig = {
  userPreferences: {
    dietary: { restrictions: [], allergens: [], dailySugarTarget: 25 },
    fitness: { goals: [], limitations: [], workoutTypes: [] },
    cookingLevel: 'intermediate',
    workshopLevel: 'intermediate',
    unitSystem: 'imperial',
    custom: {},
  },
  activeTasks: [],
  proactiveness: 'helpful',
  maxHistory: 200,
  autoDetectContext: true,
  minProactiveConfidence: 0.3,
};

export class ContextAgent {
  private config: ContextConfig;
  private currentContext: ContextType = 'unknown';
  private contextHistory: ContextDetection[] = [];
  private responseHistory: ContextResponse[] = [];
  private stats: ContextAgentStats = {
    totalResponses: 0,
    contextCounts: {},
    itemsIdentified: 0,
    alertsRaised: 0,
    tasksAssisted: 0,
  };

  constructor(config: Partial<ContextConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      // Deep copy arrays to prevent shared references to DEFAULT_CONFIG
      activeTasks: [...(config.activeTasks ?? [])],
      userPreferences: {
        ...DEFAULT_CONFIG.userPreferences,
        ...config.userPreferences,
        dietary: {
          ...DEFAULT_CONFIG.userPreferences.dietary,
          ...config.userPreferences?.dietary,
          restrictions: [...(config.userPreferences?.dietary?.restrictions ?? DEFAULT_CONFIG.userPreferences.dietary.restrictions)],
          allergens: [...(config.userPreferences?.dietary?.allergens ?? DEFAULT_CONFIG.userPreferences.dietary.allergens)],
        },
        fitness: {
          ...DEFAULT_CONFIG.userPreferences.fitness,
          ...config.userPreferences?.fitness,
          goals: [...(config.userPreferences?.fitness?.goals ?? DEFAULT_CONFIG.userPreferences.fitness.goals)],
          limitations: [...(config.userPreferences?.fitness?.limitations ?? DEFAULT_CONFIG.userPreferences.fitness.limitations)],
          workoutTypes: [...(config.userPreferences?.fitness?.workoutTypes ?? DEFAULT_CONFIG.userPreferences.fitness.workoutTypes)],
        },
        custom: { ...(config.userPreferences?.custom ?? DEFAULT_CONFIG.userPreferences.custom) },
      },
    };
  }

  /**
   * Handle a vision analysis — detect context and provide relevant help.
   */
  async handle(
    _image: Buffer,
    analysis: VisionAnalysis,
    _context?: Record<string, unknown>,
  ): Promise<ContextResponse> {
    // Detect current context
    const detection = detectContext(analysis);
    this.updateContextHistory(detection);

    // Determine if we should respond (based on proactiveness)
    const shouldRespond = this.shouldRespond(detection);

    // Build context-specific response
    const response = this.buildResponse(analysis, detection, shouldRespond);

    // Update stats
    this.updateStats(response);

    // Add to history
    this.responseHistory.unshift(response);
    if (this.responseHistory.length > this.config.maxHistory) {
      this.responseHistory = this.responseHistory.slice(0, this.config.maxHistory);
    }

    return response;
  }

  /**
   * Build a response based on detected context.
   */
  private buildResponse(
    analysis: VisionAnalysis,
    detection: ContextDetection,
    shouldRespond: boolean,
  ): ContextResponse {
    const response: ContextResponse = {
      id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      context: detection.context,
      information: [],
      alerts: [],
      confidence: detection.confidence,
      respondedAt: new Date().toISOString(),
      imageId: analysis.imageId,
    };

    if (!shouldRespond) return response;

    const allText = analysis.extractedText.map(t => t.text).join('\n');

    // Context-specific processing
    switch (detection.context) {
      case 'kitchen':
        this.processKitchenContext(response, analysis, allText);
        break;
      case 'grocery_store':
        this.processGroceryContext(response, analysis, allText);
        break;
      case 'workshop':
        this.processWorkshopContext(response, analysis, allText);
        break;
      case 'gym':
        this.processGymContext(response, analysis, allText);
        break;
      case 'outdoor_nature':
        this.processNatureContext(response, analysis, allText);
        break;
      case 'restaurant':
        this.processRestaurantContext(response, analysis, allText);
        break;
      case 'vehicle':
        this.processVehicleContext(response, analysis, allText);
        break;
      case 'medical':
        this.processMedicalContext(response, analysis, allText);
        break;
      default:
        this.processGeneralContext(response, analysis, allText);
    }

    // Check for active task progress
    this.checkTaskProgress(response, analysis, allText);

    return response;
  }

  private processKitchenContext(
    response: ContextResponse,
    analysis: VisionAnalysis,
    text: string,
  ): void {
    // Identify any visible ingredients/items
    for (const obj of analysis.detectedObjects) {
      const label = obj.label.toLowerCase();
      if (this.isKitchenItem(label)) {
        response.identifiedItem = {
          name: obj.label,
          category: 'kitchen_item',
          details: {},
          confidence: obj.confidence,
        };
        response.information.push({
          type: 'identification',
          text: `I see ${obj.label}.`,
          priority: 5,
        });
      }
    }

    // Check for temperature references
    const tempMatch = text.match(/(\d+)\s*°\s*([FC])/);
    if (tempMatch) {
      const temp = parseInt(tempMatch[1]);
      const unit = tempMatch[2];
      if (unit === 'F' && this.config.userPreferences.unitSystem === 'metric') {
        const celsius = Math.round((temp - 32) * 5 / 9);
        response.information.push({
          type: 'measurement',
          text: `${temp}°F is ${celsius}°C.`,
          priority: 8,
        });
      } else if (unit === 'C' && this.config.userPreferences.unitSystem === 'imperial') {
        const fahrenheit = Math.round(temp * 9 / 5 + 32);
        response.information.push({
          type: 'measurement',
          text: `${temp}°C is ${fahrenheit}°F.`,
          priority: 8,
        });
      }
    }

    // Recipe step tracking
    const activeRecipe = this.config.activeTasks.find(t => t.type === 'recipe');
    if (activeRecipe) {
      response.information.push({
        type: 'recipe_step',
        text: `Recipe: ${activeRecipe.name}, step ${activeRecipe.currentStep ?? '?'} of ${activeRecipe.totalSteps ?? '?'}.`,
        priority: 7,
      });
    }

    // Measurement conversions
    const measMatch = text.match(/(\d+(?:\.\d+)?)\s*(tsp|tbsp|cup|oz|ml|g|lb|kg)\b/i);
    if (measMatch) {
      const value = parseFloat(measMatch[1]);
      const unit = measMatch[2].toLowerCase();
      const conversion = this.convertMeasurement(value, unit);
      if (conversion) {
        response.information.push({
          type: 'measurement',
          text: conversion,
          priority: 6,
        });
      }
    }
  }

  private processGroceryContext(
    response: ContextResponse,
    analysis: VisionAnalysis,
    text: string,
  ): void {
    // Check nutrition labels against dietary preferences
    const alerts = checkNutritionAlerts(text, this.config.userPreferences.dietary);
    response.alerts.push(...alerts);

    // Product identification
    if (analysis.products.length > 0) {
      const product = analysis.products[0];
      response.identifiedItem = {
        name: product.name,
        category: product.category ?? 'grocery',
        details: {
          brand: product.brand ?? 'unknown',
          ...(product.priceOnShelf ? { price: `$${product.priceOnShelf.toFixed(2)}` } : {}),
        },
        confidence: product.confidence,
      };
    }

    // Price detection
    const priceMatch = text.match(/\$(\d+\.\d{2})/);
    if (priceMatch) {
      response.information.push({
        type: 'price',
        text: `Price: $${priceMatch[1]}`,
        priority: 5,
      });
    }

    // Nutrition facts parsing
    const calorieMatch = text.match(/calories?\s*(\d+)/i);
    if (calorieMatch) {
      const calories = parseInt(calorieMatch[1]);
      response.information.push({
        type: 'nutrition',
        text: `${calories} calories per serving.`,
        priority: 6,
      });

      if (this.config.userPreferences.dietary.dailyCalorieTarget) {
        const pct = Math.round((calories / this.config.userPreferences.dietary.dailyCalorieTarget) * 100);
        response.information.push({
          type: 'nutrition',
          text: `That's ${pct}% of your daily target.`,
          priority: 7,
        });
      }
    }

    // Check shopping list
    const shoppingList = this.config.activeTasks.find(t => t.type === 'shopping_list');
    if (shoppingList) {
      response.information.push({
        type: 'tip',
        text: `Shopping list active: ${shoppingList.name}`,
        priority: 4,
      });
    }
  }

  private processWorkshopContext(
    response: ContextResponse,
    analysis: VisionAnalysis,
    text: string,
  ): void {
    // Bolt/fastener identification
    const boltSpec = lookupBoltSpec(text);
    if (boltSpec) {
      response.identifiedItem = {
        name: boltSpec.description,
        category: 'fastener',
        details: boltSpec.torqueSpec ? { torque: boltSpec.torqueSpec } : {},
        confidence: 0.85,
      };
      response.information.push({
        type: 'identification',
        text: boltSpec.description,
        priority: 8,
      });
      if (boltSpec.torqueSpec) {
        response.information.push({
          type: 'measurement',
          text: `Torque spec: ${boltSpec.torqueSpec}.`,
          priority: 9,
        });
      }
    }

    // Tool identification from objects
    for (const obj of analysis.detectedObjects) {
      const label = obj.label.toLowerCase();
      if (this.isWorkshopTool(label)) {
        response.identifiedItem = {
          name: obj.label,
          category: 'tool',
          details: {},
          confidence: obj.confidence,
        };
        response.information.push({
          type: 'identification',
          text: `Tool identified: ${obj.label}.`,
          priority: 6,
        });
      }
    }

    // Measurement conversions
    const mmMatch = text.match(/(\d+(?:\.\d+)?)\s*mm\b/);
    if (mmMatch && this.config.userPreferences.unitSystem === 'imperial') {
      const mm = parseFloat(mmMatch[1]);
      const inches = (mm / 25.4).toFixed(3);
      response.information.push({
        type: 'measurement',
        text: `${mm}mm = ${inches} inches.`,
        priority: 7,
      });
    }

    const inchMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:inch|in|")\b/i);
    if (inchMatch && this.config.userPreferences.unitSystem === 'metric') {
      const inches = parseFloat(inchMatch[1]);
      const mm = (inches * 25.4).toFixed(1);
      response.information.push({
        type: 'measurement',
        text: `${inches}" = ${mm}mm.`,
        priority: 7,
      });
    }

    // Safety warnings
    if (/unplug|disconnect|power off/i.test(text)) {
      response.alerts.push({
        severity: 'warning',
        message: 'Safety reminder: ensure power is disconnected.',
      });
    }
  }

  private processGymContext(
    response: ContextResponse,
    analysis: VisionAnalysis,
    text: string,
  ): void {
    // Machine/equipment identification
    for (const obj of analysis.detectedObjects) {
      const label = obj.label.toLowerCase();
      if (this.isGymEquipment(label)) {
        response.identifiedItem = {
          name: obj.label,
          category: 'gym_equipment',
          details: {},
          confidence: obj.confidence,
        };
        response.information.push({
          type: 'identification',
          text: `Equipment: ${obj.label}.`,
          priority: 6,
        });
      }
    }

    // Weight/rep detection
    const weightMatch = text.match(/(\d+)\s*(lbs?|kg)\b/i);
    if (weightMatch) {
      const weight = parseInt(weightMatch[1]);
      const unit = weightMatch[2].toLowerCase();
      if (unit.startsWith('lb') && this.config.userPreferences.unitSystem === 'metric') {
        response.information.push({
          type: 'measurement',
          text: `${weight} lbs = ${Math.round(weight * 0.453592)} kg.`,
          priority: 6,
        });
      } else if (unit === 'kg' && this.config.userPreferences.unitSystem === 'imperial') {
        response.information.push({
          type: 'measurement',
          text: `${weight} kg = ${Math.round(weight * 2.20462)} lbs.`,
          priority: 6,
        });
      }
    }

    // Fitness program progress
    const activeWorkout = this.config.activeTasks.find(t => t.type === 'workout');
    if (activeWorkout) {
      response.information.push({
        type: 'exercise',
        text: `Workout: ${activeWorkout.name}. Step ${activeWorkout.currentStep ?? '?'} of ${activeWorkout.totalSteps ?? '?'}.`,
        priority: 8,
      });
    }

    // Fitness limitations check
    if (this.config.userPreferences.fitness.limitations.length > 0) {
      response.alerts.push({
        severity: 'info',
        message: `Remember your limitations: ${this.config.userPreferences.fitness.limitations.join(', ')}.`,
      });
    }
  }

  private processNatureContext(
    response: ContextResponse,
    _analysis: VisionAnalysis,
    _text: string,
  ): void {
    // In production: would call a plant/animal identification API
    response.information.push({
      type: 'tip',
      text: 'Say "What is this?" to identify plants, animals, or natural features.',
      priority: 3,
    });
  }

  private processRestaurantContext(
    response: ContextResponse,
    _analysis: VisionAnalysis,
    text: string,
  ): void {
    // Menu item detection
    const priceMatch = text.match(/\$(\d+\.\d{2})/);
    if (priceMatch) {
      response.information.push({
        type: 'price',
        text: `Price: $${priceMatch[1]}`,
        priority: 5,
      });
    }

    // Dietary alerts for restaurant menus
    const alerts = checkNutritionAlerts(text, this.config.userPreferences.dietary);
    response.alerts.push(...alerts);
  }

  private processVehicleContext(
    response: ContextResponse,
    _analysis: VisionAnalysis,
    text: string,
  ): void {
    // Warning light detection
    if (/check engine/i.test(text)) {
      response.alerts.push({
        severity: 'warning',
        message: 'Check engine light detected. Recommend diagnostic scan.',
      });
    }

    // Tire pressure
    const psiMatch = text.match(/(\d+)\s*PSI/i);
    if (psiMatch) {
      const psi = parseInt(psiMatch[1]);
      response.information.push({
        type: 'measurement',
        text: `Tire pressure: ${psi} PSI.`,
        priority: 7,
      });
      if (psi < 28) {
        response.alerts.push({
          severity: 'warning',
          message: `Low tire pressure: ${psi} PSI. Recommended: 32-35 PSI.`,
        });
      }
    }

    // VIN detection
    if (/VIN/i.test(text)) {
      response.information.push({
        type: 'fact',
        text: 'VIN detected. Say "decode this" for full vehicle history.',
        priority: 6,
      });
    }
  }

  private processMedicalContext(
    response: ContextResponse,
    _analysis: VisionAnalysis,
    text: string,
  ): void {
    // Medication dosage detection
    const doseMatch = text.match(/(\d+)\s*mg\b/i);
    if (doseMatch) {
      response.information.push({
        type: 'fact',
        text: `Dosage: ${doseMatch[1]}mg detected.`,
        priority: 7,
      });
    }

    // Safety warning
    response.alerts.push({
      severity: 'info',
      message: 'This is a reference tool, not medical advice. Consult your healthcare provider.',
    });
  }

  private processGeneralContext(
    response: ContextResponse,
    analysis: VisionAnalysis,
    _text: string,
  ): void {
    // General object identification
    if (analysis.detectedObjects.length > 0) {
      const topObj = analysis.detectedObjects[0];
      response.identifiedItem = {
        name: topObj.label,
        category: 'general',
        details: topObj.attributes ?? {},
        confidence: topObj.confidence,
      };
      response.information.push({
        type: 'identification',
        text: `I see: ${topObj.label}.`,
        priority: 5,
      });
    }
  }

  /**
   * Check if an active task has progressed.
   */
  private checkTaskProgress(
    response: ContextResponse,
    _analysis: VisionAnalysis,
    _text: string,
  ): void {
    for (const task of this.config.activeTasks) {
      if (task.currentStep !== undefined && task.totalSteps !== undefined) {
        response.taskProgress = {
          taskName: task.name,
          currentStep: task.currentStep,
          totalSteps: task.totalSteps,
        };
        break; // Only show one task at a time
      }
    }
  }

  /**
   * Decide if we should respond based on proactiveness setting.
   */
  private shouldRespond(detection: ContextDetection): boolean {
    switch (this.config.proactiveness) {
      case 'silent': return false;
      case 'conservative': return detection.confidence >= 0.8;
      case 'helpful': return detection.confidence >= this.config.minProactiveConfidence;
      case 'proactive': return detection.confidence >= 0.3;
      default: return true;
    }
  }

  // ─── Utility Methods ────────────────────────────────────────────

  private isKitchenItem(label: string): boolean {
    const keywords = ['spice', 'herb', 'ingredient', 'pan', 'pot', 'bowl', 'jar', 'bottle', 'food'];
    return keywords.some(k => label.includes(k));
  }

  private isWorkshopTool(label: string): boolean {
    const keywords = ['drill', 'saw', 'hammer', 'wrench', 'screwdriver', 'pliers', 'clamp', 'level'];
    return keywords.some(k => label.includes(k));
  }

  private isGymEquipment(label: string): boolean {
    const keywords = ['dumbbell', 'barbell', 'bench', 'treadmill', 'machine', 'weight', 'rack', 'kettlebell'];
    return keywords.some(k => label.includes(k));
  }

  private convertMeasurement(value: number, unit: string): string | null {
    const conversions: Record<string, { to: string; factor: number; toUnit: string }> = {
      tsp: { to: 'metric', factor: 4.929, toUnit: 'ml' },
      tbsp: { to: 'metric', factor: 14.787, toUnit: 'ml' },
      cup: { to: 'metric', factor: 236.588, toUnit: 'ml' },
      oz: { to: 'metric', factor: 28.3495, toUnit: 'g' },
      ml: { to: 'imperial', factor: 1 / 4.929, toUnit: 'tsp' },
      g: { to: 'imperial', factor: 1 / 28.3495, toUnit: 'oz' },
      lb: { to: 'metric', factor: 453.592, toUnit: 'g' },
      kg: { to: 'imperial', factor: 2.20462, toUnit: 'lbs' },
    };

    const conv = conversions[unit];
    if (!conv) return null;

    const targetSystem = this.config.userPreferences.unitSystem;
    if (conv.to !== targetSystem) return null;

    const converted = (value * conv.factor).toFixed(1);
    return `${value} ${unit} ≈ ${converted} ${conv.toUnit}`;
  }

  /**
   * Update context tracking.
   */
  private updateContextHistory(detection: ContextDetection): void {
    this.contextHistory.push(detection);
    if (this.contextHistory.length > 50) {
      this.contextHistory.shift();
    }
    if (detection.confidence > 0.5) {
      this.currentContext = detection.context;
    }
  }

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Generate a voice-friendly response.
   */
  generateVoiceSummary(response: ContextResponse): string {
    const parts: string[] = [];

    // Critical alerts first
    const criticalAlerts = response.alerts.filter(a => a.severity === 'critical');
    for (const alert of criticalAlerts) {
      parts.push(alert.message);
    }

    // Identified item
    if (response.identifiedItem) {
      parts.push(response.identifiedItem.name + '.');
    }

    // Top priority information (up to 3)
    const sortedInfo = [...response.information].sort((a, b) => b.priority - a.priority);
    for (const info of sortedInfo.slice(0, 3)) {
      parts.push(info.text);
    }

    // Warning alerts
    const warnings = response.alerts.filter(a => a.severity === 'warning');
    if (warnings.length > 0) {
      parts.push(warnings[0].message);
    }

    // Task progress
    if (response.taskProgress) {
      parts.push(
        `${response.taskProgress.taskName}: step ${response.taskProgress.currentStep} of ${response.taskProgress.totalSteps}.`
      );
    }

    if (parts.length === 0) {
      return 'No additional context to share.';
    }

    return parts.join(' ');
  }

  /**
   * Get the current detected context.
   */
  getCurrentContext(): ContextType {
    return this.currentContext;
  }

  /**
   * Get recent context history.
   */
  getContextHistory(limit: number = 10): ContextDetection[] {
    return this.contextHistory.slice(-limit);
  }

  /**
   * Get response history.
   */
  getHistory(limit: number = 20): ContextResponse[] {
    return this.responseHistory.slice(0, limit);
  }

  /**
   * Add an active task.
   */
  addTask(task: ActiveTask): void {
    this.config.activeTasks.push(task);
  }

  /**
   * Remove an active task.
   */
  removeTask(taskName: string): void {
    this.config.activeTasks = this.config.activeTasks.filter(t => t.name !== taskName);
  }

  /**
   * Update a task's progress.
   */
  updateTaskStep(taskName: string, step: number): void {
    const task = this.config.activeTasks.find(t => t.name === taskName);
    if (task) {
      task.currentStep = step;
    }
  }

  /**
   * Get active tasks.
   */
  getActiveTasks(): ActiveTask[] {
    return [...this.config.activeTasks];
  }

  /**
   * Update dietary preferences.
   */
  updateDietaryProfile(profile: Partial<DietaryProfile>): void {
    this.config.userPreferences.dietary = {
      ...this.config.userPreferences.dietary,
      ...profile,
    };
  }

  /**
   * Update fitness profile.
   */
  updateFitnessProfile(profile: Partial<FitnessProfile>): void {
    this.config.userPreferences.fitness = {
      ...this.config.userPreferences.fitness,
      ...profile,
    };
  }

  /**
   * Set proactiveness level.
   */
  setProactiveness(level: ContextConfig['proactiveness']): void {
    this.config.proactiveness = level;
  }

  /**
   * Get agent statistics.
   */
  getStats(): ContextAgentStats {
    return { ...this.stats };
  }

  private updateStats(response: ContextResponse): void {
    this.stats.totalResponses++;

    const ctx = response.context;
    this.stats.contextCounts[ctx] = (this.stats.contextCounts[ctx] ?? 0) + 1;

    if (response.identifiedItem) this.stats.itemsIdentified++;
    this.stats.alertsRaised += response.alerts.length;
    if (response.taskProgress) this.stats.tasksAssisted++;
  }
}
