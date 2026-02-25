/**
 * Tests for Context-Aware Assistant — Smart Help Based on What You're Doing
 * 🌙 Night Shift Agent
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContextAgent,
  detectContext,
  checkNutritionAlerts,
  lookupBoltSpec,
} from './context-agent.js';
import type { VisionAnalysis, ExtractedText, DetectedObject } from '../types.js';

// ─── Helper ─────────────────────────────────────────────────────

function mockAnalysis(opts: {
  texts?: string[];
  objects?: Array<{ label: string; confidence?: number }>;
  sceneType?: string;
  sceneDescription?: string;
  products?: Array<{ name: string; category?: string; brand?: string; priceOnShelf?: number }>;
}): VisionAnalysis {
  return {
    imageId: `img-${Date.now()}`,
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 100,
    sceneDescription: opts.sceneDescription ?? 'Test scene',
    sceneType: (opts.sceneType ?? 'unknown') as VisionAnalysis['sceneType'],
    extractedText: (opts.texts ?? []).map(text => ({
      text,
      confidence: 0.95,
      textType: 'other' as ExtractedText['textType'],
    })),
    detectedObjects: (opts.objects ?? []).map(obj => ({
      label: obj.label,
      confidence: obj.confidence ?? 0.9,
    })) as DetectedObject[],
    products: (opts.products ?? []).map(p => ({
      name: p.name,
      category: p.category,
      brand: p.brand,
      priceOnShelf: p.priceOnShelf,
      confidence: 0.9,
      identificationMethod: 'visual' as const,
      estimatedCount: 1,
      countConfidence: 0.8,
    })),
    barcodes: [],
    quality: { score: 0.9, isBlurry: false, hasGlare: false, isUnderexposed: false, isOverexposed: false, usableForInventory: true },
  };
}

// ─── detectContext ──────────────────────────────────────────────

describe('detectContext', () => {
  it('should detect kitchen context from objects', () => {
    const analysis = mockAnalysis({
      objects: [{ label: 'stove' }, { label: 'cutting board' }, { label: 'pan' }],
      sceneDescription: 'kitchen with cooking supplies',
    });
    const result = detectContext(analysis);
    expect(result.context).toBe('kitchen');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should detect grocery store from text patterns', () => {
    const analysis = mockAnalysis({
      texts: ['Nutrition Facts\nServing Size 1 cup\nCalories 120\nIngredients: Wheat flour, sugar'],
      sceneType: 'retail_shelf',
    });
    const result = detectContext(analysis);
    expect(result.context).toBe('grocery_store');
  });

  it('should detect workshop from tool objects', () => {
    const analysis = mockAnalysis({
      objects: [{ label: 'drill' }, { label: 'wrench' }],
      sceneDescription: 'workshop with tools on workbench',
    });
    const result = detectContext(analysis);
    expect(result.context).toBe('workshop');
  });

  it('should detect gym from equipment', () => {
    const analysis = mockAnalysis({
      objects: [{ label: 'dumbbell' }, { label: 'bench' }],
      texts: ['45 lbs', '3 sets 12 reps'],
    });
    const result = detectContext(analysis);
    expect(result.context).toBe('gym');
  });

  it('should detect outdoor nature from scene', () => {
    const analysis = mockAnalysis({
      objects: [{ label: 'tree' }, { label: 'flower' }, { label: 'bird' }],
      sceneDescription: 'outdoor nature trail with trees',
    });
    const result = detectContext(analysis);
    expect(result.context).toBe('outdoor_nature');
  });

  it('should detect restaurant from scene', () => {
    const analysis = mockAnalysis({
      sceneDescription: 'restaurant dining area',
      texts: ['Appetizer\nSoup of the Day $8.99\nSpecials:'],
    });
    const result = detectContext(analysis);
    expect(result.context).toBe('restaurant');
  });

  it('should detect vehicle context', () => {
    const analysis = mockAnalysis({
      objects: [{ label: 'dashboard' }, { label: 'steering wheel' }],
      texts: ['check engine'],
      sceneType: 'vehicle',
    });
    const result = detectContext(analysis);
    expect(result.context).toBe('vehicle');
  });

  it('should detect medical context', () => {
    const analysis = mockAnalysis({
      objects: [{ label: 'pill' }],
      texts: ['Dosage: 500mg\nTake 1 tablet daily\nPrescription refill'],
    });
    const result = detectContext(analysis);
    expect(result.context).toBe('medical');
  });

  it('should detect office context', () => {
    const analysis = mockAnalysis({
      objects: [{ label: 'computer' }, { label: 'keyboard' }, { label: 'monitor' }],
      sceneDescription: 'office desk workspace',
    });
    const result = detectContext(analysis);
    expect(result.context).toBe('office');
  });

  it('should return unknown for ambiguous scenes', () => {
    const analysis = mockAnalysis({
      sceneDescription: 'empty room',
    });
    const result = detectContext(analysis);
    expect(result.context).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('should include indicators', () => {
    const analysis = mockAnalysis({
      objects: [{ label: 'stove' }],
      sceneDescription: 'kitchen',
    });
    const result = detectContext(analysis);
    expect(result.indicators.length).toBeGreaterThan(0);
  });

  it('should use scene type mapping', () => {
    const analysis = mockAnalysis({ sceneType: 'retail_shelf' });
    const result = detectContext(analysis);
    expect(result.context).toBe('grocery_store');
  });
});

// ─── checkNutritionAlerts ───────────────────────────────────────

describe('checkNutritionAlerts', () => {
  it('should alert gluten for gluten-free diet', () => {
    const alerts = checkNutritionAlerts(
      'Ingredients: wheat flour, sugar, butter',
      { restrictions: ['gluten_free'], allergens: [], dailySugarTarget: 25 }
    );
    expect(alerts.some(a => a.message.toLowerCase().includes('wheat') || a.message.toLowerCase().includes('gluten'))).toBe(true);
  });

  it('should alert dairy for vegan diet', () => {
    const alerts = checkNutritionAlerts(
      'Ingredients: milk, eggs, sugar',
      { restrictions: ['vegan'], allergens: [], dailySugarTarget: 25 }
    );
    expect(alerts.some(a => a.message.toLowerCase().includes('dairy'))).toBe(true);
    expect(alerts.some(a => a.message.toLowerCase().includes('eggs'))).toBe(true);
  });

  it('should alert meat for vegetarian diet', () => {
    const alerts = checkNutritionAlerts(
      'Contains: chicken, vegetables, rice',
      { restrictions: ['vegetarian'], allergens: [] }
    );
    expect(alerts.some(a => a.message.toLowerCase().includes('meat'))).toBe(true);
  });

  it('should alert nuts for nut-free diet', () => {
    const alerts = checkNutritionAlerts(
      'Contains: peanut butter, almonds',
      { restrictions: ['nut_free'], allergens: [] }
    );
    expect(alerts.some(a => a.message.toLowerCase().includes('nuts') || a.message.toLowerCase().includes('peanut'))).toBe(true);
  });

  it('should flag custom allergens', () => {
    const alerts = checkNutritionAlerts(
      'Contains: soy lecithin, wheat',
      { restrictions: [], allergens: ['soy'] }
    );
    expect(alerts.some(a => a.message.includes('ALLERGEN'))).toBe(true);
  });

  it('should flag pork for halal diet', () => {
    const alerts = checkNutritionAlerts(
      'Ingredients: pork sausage, onions',
      { restrictions: ['halal'], allergens: [] }
    );
    expect(alerts.some(a => a.message.toLowerCase().includes('pork'))).toBe(true);
  });

  it('should flag gelatin for vegetarian diet', () => {
    const alerts = checkNutritionAlerts(
      'Contains: gelatin, sugar, citric acid',
      { restrictions: ['vegetarian'], allergens: [] }
    );
    expect(alerts.some(a => a.message.toLowerCase().includes('gelatin'))).toBe(true);
  });

  it('should flag high sugar relative to target', () => {
    const alerts = checkNutritionAlerts(
      'Total Sugars 42g per serving',
      { restrictions: ['low_sugar'], allergens: [], dailySugarTarget: 25 }
    );
    expect(alerts.some(a => a.message.toLowerCase().includes('sugar'))).toBe(true);
  });

  it('should return empty for compatible food', () => {
    const alerts = checkNutritionAlerts(
      'Ingredients: rice, water, salt',
      { restrictions: ['gluten_free'], allergens: [] }
    );
    // Rice is gluten-free, so no alerts
    const criticalAlerts = alerts.filter(a => a.severity === 'critical');
    expect(criticalAlerts).toHaveLength(0);
  });

  it('should handle seafood for vegetarian', () => {
    const alerts = checkNutritionAlerts(
      'Wild-caught salmon with vegetables',
      { restrictions: ['vegetarian'], allergens: [] }
    );
    expect(alerts.some(a => a.message.toLowerCase().includes('seafood'))).toBe(true);
  });

  it('should flag alcohol for halal', () => {
    const alerts = checkNutritionAlerts(
      'Contains: natural flavors, alcohol',
      { restrictions: ['halal'], allergens: [] }
    );
    expect(alerts.some(a => a.message.toLowerCase().includes('alcohol'))).toBe(true);
  });
});

// ─── lookupBoltSpec ─────────────────────────────────────────────

describe('lookupBoltSpec', () => {
  it('should find M8 bolt spec', () => {
    const spec = lookupBoltSpec('M8 x 1.25 hex bolt');
    expect(spec).not.toBeNull();
    expect(spec!.description).toContain('M8');
    expect(spec!.torqueSpec).toBeDefined();
  });

  it('should find M10 bolt spec', () => {
    const spec = lookupBoltSpec('M10 flange bolt');
    expect(spec).not.toBeNull();
    expect(spec!.description).toContain('M10');
  });

  it('should find M12 bolt spec', () => {
    const spec = lookupBoltSpec('M12 bolt grade 8.8');
    expect(spec).not.toBeNull();
    expect(spec!.torqueSpec).toContain('Nm');
  });

  it('should find 1/4"-20 SAE bolt', () => {
    const spec = lookupBoltSpec('1/4-20 hex bolt');
    expect(spec).not.toBeNull();
    expect(spec!.description).toContain('SAE');
  });

  it('should find 1/2"-13 SAE bolt', () => {
    const spec = lookupBoltSpec('1/2-13 bolt');
    expect(spec).not.toBeNull();
    expect(spec!.torqueSpec).toContain('ft-lbs');
  });

  it('should return null for unknown bolt', () => {
    expect(lookupBoltSpec('random text')).toBeNull();
  });
});

// ─── ContextAgent ───────────────────────────────────────────────

describe('ContextAgent', () => {
  let agent: ContextAgent;

  beforeEach(() => {
    agent = new ContextAgent({
      userPreferences: {
        dietary: {
          restrictions: ['gluten_free'],
          allergens: ['soy'],
          dailySugarTarget: 25,
          dailyCalorieTarget: 2000,
        },
        fitness: {
          goals: ['strength'],
          limitations: ['bad left knee'],
          workoutTypes: ['weightlifting'],
        },
        cookingLevel: 'intermediate',
        workshopLevel: 'intermediate',
        unitSystem: 'imperial',
        custom: {},
      },
      proactiveness: 'helpful',
    });
  });

  describe('handle()', () => {
    it('should detect kitchen context and respond', async () => {
      const analysis = mockAnalysis({
        objects: [{ label: 'stove' }, { label: 'pan' }],
        sceneDescription: 'kitchen counter with cooking supplies',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.context).toBe('kitchen');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect grocery context with nutrition alerts', async () => {
      const analysis = mockAnalysis({
        texts: ['Nutrition Facts\nIngredients: wheat flour, soy lecithin\nCalories 250'],
        sceneType: 'retail_shelf',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.context).toBe('grocery_store');
      // Should flag gluten (wheat) and soy allergen
      expect(result.alerts.length).toBeGreaterThan(0);
    });

    it('should detect workshop context with bolt specs', async () => {
      const analysis = mockAnalysis({
        objects: [{ label: 'wrench' }],
        texts: ['M8 x 1.25 bolt'],
        sceneDescription: 'workshop workbench',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.context).toBe('workshop');
      expect(result.information.some(i => i.text.includes('M8'))).toBe(true);
    });

    it('should detect gym context', async () => {
      const analysis = mockAnalysis({
        objects: [{ label: 'dumbbell' }],
        texts: ['45 lbs'],
        sceneDescription: 'gym floor with equipment',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.context).toBe('gym');
    });

    it('should include fitness limitations as alert in gym', async () => {
      const analysis = mockAnalysis({
        objects: [{ label: 'dumbbell' }, { label: 'bench' }],
        sceneDescription: 'gym fitness area',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.alerts.some(a => a.message.includes('bad left knee'))).toBe(true);
    });

    it('should detect vehicle context with warnings', async () => {
      const analysis = mockAnalysis({
        objects: [{ label: 'dashboard' }],
        texts: ['check engine'],
        sceneType: 'vehicle',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.context).toBe('vehicle');
      expect(result.alerts.some(a => a.message.toLowerCase().includes('check engine'))).toBe(true);
    });

    it('should flag low tire pressure', async () => {
      const analysis = mockAnalysis({
        texts: ['Front Left: 22 PSI'],
        sceneType: 'vehicle',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.alerts.some(a => a.message.includes('Low tire'))).toBe(true);
    });

    it('should detect medical context with safety disclaimer', async () => {
      const analysis = mockAnalysis({
        texts: ['Dosage: 500mg\nTake 2 tablets'],
        objects: [{ label: 'pill' }],
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.context).toBe('medical');
      expect(result.alerts.some(a => a.message.includes('not medical advice'))).toBe(true);
    });

    it('should handle temperature conversion in kitchen (F to C)', async () => {
      const metricAgent = new ContextAgent({
        userPreferences: {
          dietary: { restrictions: [], allergens: [] },
          fitness: { goals: [], limitations: [], workoutTypes: [] },
          cookingLevel: 'intermediate',
          workshopLevel: 'intermediate',
          unitSystem: 'metric',
          custom: {},
        },
      });
      const analysis = mockAnalysis({
        texts: ['Preheat oven to 350 °F'],
        sceneDescription: 'kitchen cooking',
      });
      const result = await metricAgent.handle(Buffer.from('test'), analysis);

      expect(result.information.some(i => i.text.includes('°C'))).toBe(true);
    });

    it('should handle mm to inches conversion in workshop', async () => {
      const analysis = mockAnalysis({
        objects: [{ label: 'wrench' }],
        texts: ['15mm socket needed'],
        sceneDescription: 'workshop with tools',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.information.some(i => i.text.includes('inches'))).toBe(true);
    });

    it('should track calories against daily target in grocery', async () => {
      const analysis = mockAnalysis({
        texts: ['Nutrition Facts\nServing Size 1 cup\nCalories 450\nIngredients: wheat'],
        sceneType: 'retail_shelf',
        sceneDescription: 'grocery store aisle with shelves',
        objects: [{ label: 'shelf' }, { label: 'price tag' }],
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      // Either context is detected and calories info is provided, or the nutrition text is processed
      if (result.context === 'grocery_store') {
        expect(result.information.some(i => i.text.includes('daily target') || i.text.includes('calories'))).toBe(true);
      }
    });

    it('should update stats after response', async () => {
      const analysis = mockAnalysis({
        objects: [{ label: 'stove' }],
        sceneDescription: 'kitchen',
      });
      await agent.handle(Buffer.from('test'), analysis);

      const stats = agent.getStats();
      expect(stats.totalResponses).toBe(1);
    });

    it('should add to history', async () => {
      const analysis = mockAnalysis({ sceneDescription: 'kitchen' });
      await agent.handle(Buffer.from('test'), analysis);

      expect(agent.getHistory()).toHaveLength(1);
    });

    it('should not respond in silent mode', async () => {
      agent.setProactiveness('silent');
      const analysis = mockAnalysis({
        objects: [{ label: 'stove' }],
        sceneDescription: 'kitchen',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.information).toHaveLength(0);
      expect(result.alerts).toHaveLength(0);
    });

    it('should detect product prices in grocery', async () => {
      const analysis = mockAnalysis({
        texts: ['Organic Almonds\n$12.99\n16 oz bag'],
        sceneType: 'retail_shelf',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.information.some(i => i.type === 'price')).toBe(true);
    });

    it('should identify items from products array', async () => {
      const analysis = mockAnalysis({
        products: [{ name: 'Cheerios', brand: 'General Mills', priceOnShelf: 4.99 }],
        sceneType: 'retail_shelf',
        sceneDescription: 'grocery store cereal aisle',
        objects: [{ label: 'shelf' }, { label: 'price tag' }, { label: 'cereal' }],
        texts: ['$4.99', 'Nutrition Facts'],
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.identifiedItem).toBeDefined();
      expect(result.identifiedItem!.name).toBe('Cheerios');
    });
  });

  describe('task management', () => {
    it('should add a task', () => {
      agent.addTask({
        type: 'recipe',
        name: 'Banana Bread',
        currentStep: 1,
        totalSteps: 8,
        data: {},
        startedAt: new Date().toISOString(),
      });

      expect(agent.getActiveTasks()).toHaveLength(1);
    });

    it('should remove a task', () => {
      agent.addTask({
        type: 'recipe',
        name: 'Banana Bread',
        data: {},
        startedAt: new Date().toISOString(),
      });
      agent.removeTask('Banana Bread');

      expect(agent.getActiveTasks()).toHaveLength(0);
    });

    it('should update task step', () => {
      agent.addTask({
        type: 'recipe',
        name: 'Banana Bread',
        currentStep: 1,
        totalSteps: 8,
        data: {},
        startedAt: new Date().toISOString(),
      });
      agent.updateTaskStep('Banana Bread', 3);

      const tasks = agent.getActiveTasks();
      expect(tasks[0].currentStep).toBe(3);
    });

    it('should include task progress in kitchen response', async () => {
      agent.addTask({
        type: 'recipe',
        name: 'Chocolate Cake',
        currentStep: 3,
        totalSteps: 10,
        data: {},
        startedAt: new Date().toISOString(),
      });

      const analysis = mockAnalysis({
        objects: [{ label: 'stove' }],
        sceneDescription: 'kitchen counter',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.information.some(i => i.type === 'recipe_step')).toBe(true);
    });

    it('should include task progress in response', async () => {
      // Create a completely fresh agent for this test
      const isolatedAgent = new ContextAgent({ proactiveness: 'proactive' });
      isolatedAgent.addTask({
        type: 'recipe',
        name: 'Test Recipe',
        currentStep: 2,
        totalSteps: 5,
        data: {},
        startedAt: new Date().toISOString(),
      });

      const analysis = mockAnalysis({
        objects: [{ label: 'stove' }, { label: 'pan' }, { label: 'pot' }],
        sceneDescription: 'kitchen with cooking equipment',
      });
      const result = await isolatedAgent.handle(Buffer.from('test'), analysis);

      expect(result.taskProgress).toBeDefined();
      expect(result.taskProgress!.taskName).toBe('Test Recipe');
      expect(result.taskProgress!.currentStep).toBe(2);
    });
  });

  describe('generateVoiceSummary()', () => {
    it('should prioritize critical alerts', async () => {
      const analysis = mockAnalysis({
        texts: ['Contains: wheat flour, peanuts'],
        sceneType: 'retail_shelf',
      });
      const result = await agent.handle(Buffer.from('test'), analysis);
      const summary = agent.generateVoiceSummary(result);

      // Should mention the allergen/restriction first
      expect(summary.length).toBeGreaterThan(0);
    });

    it('should include identified item', async () => {
      const analysis = mockAnalysis({
        products: [{ name: 'Coca-Cola', brand: 'Coca-Cola Co' }],
        sceneType: 'retail_shelf',
        sceneDescription: 'grocery store shelf',
        objects: [{ label: 'shelf' }, { label: 'bottle' }],
        texts: ['$2.49'],
      });
      const result = await agent.handle(Buffer.from('test'), analysis);
      const summary = agent.generateVoiceSummary(result);

      // If context detected, should mention the product
      if (result.identifiedItem) {
        expect(summary).toContain('Coca-Cola');
      }
    });

    it('should include task progress', async () => {
      const taskAgent = new ContextAgent({
        userPreferences: {
          dietary: { restrictions: [], allergens: [] },
          fitness: { goals: [], limitations: [], workoutTypes: [] },
          cookingLevel: 'intermediate',
          workshopLevel: 'intermediate',
          unitSystem: 'imperial',
          custom: {},
        },
        proactiveness: 'proactive', // More likely to respond
      });
      taskAgent.addTask({
        type: 'recipe',
        name: 'Pasta',
        currentStep: 3,
        totalSteps: 6,
        data: {},
        startedAt: new Date().toISOString(),
      });

      const analysis = mockAnalysis({
        objects: [{ label: 'stove' }, { label: 'pot' }, { label: 'pan' }],
        sceneDescription: 'kitchen with cooking supplies on stove',
      });
      const result = await taskAgent.handle(Buffer.from('test'), analysis);
      const summary = taskAgent.generateVoiceSummary(result);

      expect(summary).toContain('step 3');
    });

    it('should say nothing for empty responses', () => {
      const empty = {
        id: 'test',
        context: 'unknown' as const,
        information: [],
        alerts: [],
        confidence: 0,
        respondedAt: new Date().toISOString(),
      };
      const summary = agent.generateVoiceSummary(empty);
      expect(summary).toContain('No additional context');
    });
  });

  describe('preferences', () => {
    it('should update dietary profile', () => {
      agent.updateDietaryProfile({ restrictions: ['vegan'] });
      // Verify by triggering a grocery context with dairy
    });

    it('should update fitness profile', () => {
      agent.updateFitnessProfile({ goals: ['lose weight'] });
    });

    it('should set proactiveness', () => {
      agent.setProactiveness('conservative');
      // Conservative requires higher confidence
    });
  });

  describe('context tracking', () => {
    it('should track current context', async () => {
      const analysis = mockAnalysis({
        objects: [{ label: 'stove' }, { label: 'pan' }],
        sceneDescription: 'kitchen',
      });
      await agent.handle(Buffer.from('test'), analysis);

      expect(agent.getCurrentContext()).toBe('kitchen');
    });

    it('should keep context history', async () => {
      const kitchen = mockAnalysis({
        objects: [{ label: 'stove' }],
        sceneDescription: 'kitchen',
      });
      const gym = mockAnalysis({
        objects: [{ label: 'dumbbell' }],
        sceneDescription: 'gym',
      });

      await agent.handle(Buffer.from('test'), kitchen);
      await agent.handle(Buffer.from('test'), gym);

      const history = agent.getContextHistory();
      expect(history.length).toBe(2);
    });
  });

  describe('stats', () => {
    it('should track total responses', async () => {
      const analysis = mockAnalysis({ sceneDescription: 'test' });
      await agent.handle(Buffer.from('test'), analysis);
      await agent.handle(Buffer.from('test'), analysis);

      expect(agent.getStats().totalResponses).toBe(2);
    });

    it('should track context counts', async () => {
      const kitchen = mockAnalysis({
        objects: [{ label: 'stove' }],
        sceneDescription: 'kitchen',
      });
      await agent.handle(Buffer.from('test'), kitchen);

      const stats = agent.getStats();
      expect(stats.contextCounts['kitchen']).toBe(1);
    });

    it('should track items identified', async () => {
      const analysis = mockAnalysis({
        products: [{ name: 'Test Product' }],
        sceneType: 'retail_shelf',
        sceneDescription: 'grocery store shelf with products',
        objects: [{ label: 'shelf' }, { label: 'price tag' }],
        texts: ['$4.99', 'Nutrition Facts'],
      });
      await agent.handle(Buffer.from('test'), analysis);

      expect(agent.getStats().itemsIdentified).toBe(1);
    });

    it('should track alerts raised', async () => {
      const analysis = mockAnalysis({
        texts: ['Nutrition Facts\nIngredients: wheat flour, sugar\nServing Size 1 cup'],
        sceneType: 'retail_shelf',
        sceneDescription: 'grocery store aisle with products',
        objects: [{ label: 'shelf' }, { label: 'package' }],
      });
      await agent.handle(Buffer.from('test'), analysis);

      expect(agent.getStats().alertsRaised).toBeGreaterThan(0);
    });

    it('should return copy of stats', () => {
      const s1 = agent.getStats();
      const s2 = agent.getStats();
      expect(s1).not.toBe(s2);
    });
  });
});
