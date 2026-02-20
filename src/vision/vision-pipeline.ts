/**
 * Vision Pipeline — Core image analysis engine.
 *
 * Takes a captured image, sends it to a vision model (GPT-4o / Claude),
 * and returns structured analysis: scene type, OCR text, products,
 * barcodes, objects, and quality assessment.
 *
 * This is the foundation that every feature agent builds on.
 */

import type {
  CapturedImage,
  VisionAnalysis,
  SceneType,
  ExtractedText,
  DetectedObject,
  DetectedProduct,
  DecodedBarcode,
  ImageQuality,
  PipelineResult,
} from '../types.js';

// ─── Configuration ──────────────────────────────────────────────

export interface VisionPipelineConfig {
  /** Vision model identifier (e.g., 'gpt-4o', 'claude-3-opus') */
  model: string;
  /** API key for the vision model provider */
  apiKey: string;
  /** API base URL (defaults to OpenAI) */
  apiBaseUrl?: string;
  /** Maximum tokens for the response */
  maxTokens?: number;
  /** Temperature (lower = more deterministic) */
  temperature?: number;
  /** Timeout for API calls in ms */
  timeoutMs?: number;
  /** Retry count on failure */
  retries?: number;
  /** Analysis mode — what to look for */
  mode?: AnalysisMode;
}

export type AnalysisMode =
  | 'general'          // scene description, OCR, objects
  | 'inventory'        // optimized for product identification + counting
  | 'document'         // optimized for text extraction
  | 'inspection'       // optimized for condition/damage assessment
  | 'networking'       // optimized for badges, cards, people
  | 'security';        // optimized for threat detection

const DEFAULT_CONFIG: Partial<VisionPipelineConfig> = {
  apiBaseUrl: 'https://api.openai.com/v1',
  maxTokens: 4096,
  temperature: 0.1,
  timeoutMs: 30000,
  retries: 2,
  mode: 'general',
};

// ─── Prompts ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a vision analysis engine for smart glasses. Analyze images and return structured JSON data.

CRITICAL: Return ONLY valid JSON. No markdown, no explanation, no code fences. Just the JSON object.`;

function buildAnalysisPrompt(mode: AnalysisMode): string {
  const base = `Analyze this image and return a JSON object with the following structure:

{
  "sceneDescription": "Brief description of what's in the image",
  "sceneType": "one of: retail_shelf, warehouse, office, outdoor, kitchen, workshop, document, screen, whiteboard, person, vehicle, property, unknown",
  "extractedText": [
    { "text": "...", "confidence": 0.0-1.0, "textType": "label|price|barcode_number|document|screen|sign|other" }
  ],
  "detectedObjects": [
    { "label": "...", "confidence": 0.0-1.0, "attributes": {} }
  ],
  "products": [
    {
      "name": "Full product name",
      "brand": "Brand name",
      "category": "Product category",
      "variant": "Size/variant",
      "confidence": 0.0-1.0,
      "identificationMethod": "barcode|shelf_label|visual",
      "upc": "UPC if visible",
      "estimatedCount": 1,
      "countConfidence": 0.0-1.0,
      "priceOnShelf": null
    }
  ],
  "barcodes": [
    { "data": "barcode number", "format": "UPC-A|UPC-E|EAN-13|EAN-8|Code128|Code39|QR|DataMatrix|unknown", "confidence": 0.0-1.0 }
  ],
  "quality": {
    "score": 0.0-1.0,
    "isBlurry": false,
    "hasGlare": false,
    "isUnderexposed": false,
    "isOverexposed": false,
    "usableForInventory": true
  }
}`;

  const modeInstructions: Record<AnalysisMode, string> = {
    general: `
Focus on providing a comprehensive analysis. Identify all visible text, objects, and products.`,
    inventory: `
INVENTORY MODE — Focus on product identification and counting accuracy.
- Identify EVERY product visible on shelves
- Read ALL barcodes, price tags, and shelf labels
- Count items carefully — count individual units, not facing groups
- For shelf depth: only count what's VISIBLE, note if rows go deeper
- Read price tags and match them to the correct product
- Flag: empty shelf spots, items that look misplaced, any visible damage
- Group products by shelf section when possible
- If you see a shelf label with a product name and price, ALWAYS include it in extractedText with textType "label" and "price"`,
    document: `
DOCUMENT MODE — Focus on text extraction with maximum accuracy.
- Extract ALL text in reading order
- Preserve formatting (paragraphs, lists, tables) in text content
- Note document type (contract, receipt, letter, etc.)
- Flag important clauses, numbers, dates`,
    inspection: `
INSPECTION MODE — Focus on condition assessment.
- Identify any damage, wear, deterioration
- Note cleanliness and maintenance state
- Identify fixtures, appliances, structural elements
- Rate condition: excellent, good, fair, poor
- Flag safety concerns
- Read any model numbers, serial numbers, labels`,
    networking: `
NETWORKING MODE — Focus on people and professional identification.
- Read name badges, business cards, name plates
- Extract: full name, title, company, email, phone, social handles
- Describe the person briefly (for later recognition)
- Note the context (conference, meeting, office)`,
    security: `
SECURITY MODE — Focus on threat detection and safety.
- Analyze QR codes for suspicious URLs
- Check payment terminals for physical tampering
- Identify suspicious devices (skimmers, hidden cameras)
- Read all visible text for hidden clauses / fine print
- Assess overall safety of the environment`,
  };

  return base + (modeInstructions[mode] || modeInstructions.general);
}

// ─── Pipeline Implementation ────────────────────────────────────

export class VisionPipeline {
  private config: Required<VisionPipelineConfig>;

  constructor(config: VisionPipelineConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<VisionPipelineConfig>;
  }

  /**
   * Analyze a captured image and return structured data.
   */
  async analyze(
    image: CapturedImage,
    mode?: AnalysisMode
  ): Promise<PipelineResult<VisionAnalysis>> {
    const startTime = Date.now();
    const analysisMode = mode || this.config.mode;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const rawResponse = await this.callVisionModel(image, analysisMode);
        const parsed = this.parseResponse(rawResponse);
        const analysis = this.buildAnalysis(image.id, parsed, Date.now() - startTime, rawResponse);

        return {
          success: true,
          data: analysis,
          processingTimeMs: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.config.retries) {
          // Exponential backoff
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    return {
      success: false,
      error: `Vision analysis failed after ${this.config.retries + 1} attempts: ${lastError?.message}`,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Quick quality check — useful before running full analysis.
   */
  async quickQualityCheck(image: CapturedImage): Promise<ImageQuality> {
    // Basic heuristic quality check using image buffer size + dimensions
    // In production this would use the vision model, but for speed
    // we do a lightweight check first
    const sizeKB = image.buffer.length / 1024;

    return {
      score: sizeKB > 50 ? 0.8 : sizeKB > 20 ? 0.5 : 0.2,
      isBlurry: sizeKB < 30, // Very small JPEG often indicates blur
      hasGlare: false, // Can't detect without model
      isUnderexposed: sizeKB < 20,
      isOverexposed: false,
      usableForInventory: sizeKB > 50,
    };
  }

  /**
   * Call the vision model API.
   */
  private async callVisionModel(
    image: CapturedImage,
    mode: AnalysisMode
  ): Promise<string> {
    const base64Image = image.buffer.toString('base64');
    const prompt = buildAnalysisPrompt(mode);

    const body = {
      model: this.config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${image.mimeType};base64,${base64Image}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
    };

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs
    );

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Vision API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      return data.choices[0]?.message?.content || '';
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse the raw JSON response from the vision model.
   */
  private parseResponse(raw: string): Record<string, unknown> {
    // Strip markdown code fences if the model wrapped its response
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse vision model response as JSON: ${cleaned.slice(0, 200)}`);
    }
  }

  /**
   * Build a typed VisionAnalysis from the parsed response.
   */
  private buildAnalysis(
    imageId: string,
    parsed: Record<string, unknown>,
    processingTimeMs: number,
    rawResponse: string
  ): VisionAnalysis {
    return {
      imageId,
      analyzedAt: new Date().toISOString(),
      processingTimeMs,
      sceneDescription: String(parsed.sceneDescription || 'No description'),
      sceneType: this.validateSceneType(parsed.sceneType),
      extractedText: this.parseExtractedText(parsed.extractedText),
      detectedObjects: this.parseDetectedObjects(parsed.detectedObjects),
      products: this.parseProducts(parsed.products),
      barcodes: this.parseBarcodes(parsed.barcodes),
      quality: this.parseQuality(parsed.quality),
      rawResponse,
    };
  }

  private validateSceneType(value: unknown): SceneType {
    const valid: SceneType[] = [
      'retail_shelf', 'warehouse', 'office', 'outdoor', 'kitchen',
      'workshop', 'document', 'screen', 'whiteboard', 'person',
      'vehicle', 'property', 'unknown',
    ];
    return valid.includes(value as SceneType) ? (value as SceneType) : 'unknown';
  }

  private parseExtractedText(value: unknown): ExtractedText[] {
    if (!Array.isArray(value)) return [];
    return value.map((item: Record<string, unknown>) => ({
      text: String(item.text || ''),
      confidence: Number(item.confidence) || 0,
      textType: (['label', 'price', 'barcode_number', 'document', 'screen', 'sign', 'other']
        .includes(item.textType as string) ? item.textType : 'other') as ExtractedText['textType'],
      ...(item.region ? { region: item.region as ExtractedText['region'] } : {}),
    }));
  }

  private parseDetectedObjects(value: unknown): DetectedObject[] {
    if (!Array.isArray(value)) return [];
    return value.map((item: Record<string, unknown>) => ({
      label: String(item.label || ''),
      confidence: Number(item.confidence) || 0,
      ...(item.region ? { region: item.region as DetectedObject['region'] } : {}),
      ...(item.attributes
        ? { attributes: item.attributes as Record<string, string> }
        : {}),
    }));
  }

  private parseProducts(value: unknown): DetectedProduct[] {
    if (!Array.isArray(value)) return [];
    return value.map((item: Record<string, unknown>) => ({
      name: String(item.name || 'Unknown Product'),
      brand: item.brand ? String(item.brand) : undefined,
      category: item.category ? String(item.category) : undefined,
      variant: item.variant ? String(item.variant) : undefined,
      confidence: Number(item.confidence) || 0,
      identificationMethod: (['barcode', 'shelf_label', 'visual', 'voice_override']
        .includes(item.identificationMethod as string)
        ? item.identificationMethod
        : 'visual') as DetectedProduct['identificationMethod'],
      upc: item.upc ? String(item.upc) : undefined,
      estimatedCount: Math.max(0, Math.round(Number(item.estimatedCount) || 1)),
      countConfidence: Number(item.countConfidence) || 0,
      ...(item.region ? { region: item.region as DetectedProduct['region'] } : {}),
      ...(item.priceOnShelf != null ? { priceOnShelf: Number(item.priceOnShelf) } : {}),
    }));
  }

  private parseBarcodes(value: unknown): DecodedBarcode[] {
    if (!Array.isArray(value)) return [];
    return value.map((item: Record<string, unknown>) => ({
      data: String(item.data || ''),
      format: (['UPC-A', 'UPC-E', 'EAN-13', 'EAN-8', 'Code128', 'Code39', 'QR', 'DataMatrix', 'unknown']
        .includes(item.format as string)
        ? item.format
        : 'unknown') as DecodedBarcode['format'],
      confidence: Number(item.confidence) || 0,
      ...(item.region ? { region: item.region as DecodedBarcode['region'] } : {}),
    }));
  }

  private parseQuality(value: unknown): ImageQuality {
    if (!value || typeof value !== 'object') {
      return {
        score: 0.5,
        isBlurry: false,
        hasGlare: false,
        isUnderexposed: false,
        isOverexposed: false,
        usableForInventory: true,
      };
    }
    const q = value as Record<string, unknown>;
    return {
      score: Number(q.score) || 0.5,
      isBlurry: Boolean(q.isBlurry),
      hasGlare: Boolean(q.hasGlare),
      isUnderexposed: Boolean(q.isUnderexposed),
      isOverexposed: Boolean(q.isOverexposed),
      usableForInventory: q.usableForInventory !== false,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a pre-configured pipeline for inventory analysis.
 */
export function createInventoryPipeline(
  apiKey: string,
  model = 'gpt-4o'
): VisionPipeline {
  return new VisionPipeline({
    model,
    apiKey,
    mode: 'inventory',
    temperature: 0.05, // Very deterministic for counting
    maxTokens: 4096,
  });
}
