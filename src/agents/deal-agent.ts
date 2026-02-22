/**
 * Deal Analysis Agent — Real-time price intelligence for anything you look at.
 *
 * Look at a car on a dealer lot, a product on a shelf, or a house listing.
 * Agent identifies it, researches market pricing, and tells you whether
 * it's a good deal — with specific negotiation leverage points.
 *
 * Categories:
 * - Products: Amazon/eBay price comparison, price history, wholesale pricing
 * - Vehicles: KBB/Edmunds fair value, dealer cost, comparable listings, recalls
 * - Real Estate: Comps, tax assessment, neighborhood data, rent estimates
 * - General: Any item with a visible price tag gets a market analysis
 *
 * Revenue: Powers "Live Deal Intelligence" feature ($9.99-29.99/mo consumer,
 * plus affiliate revenue from purchase referrals).
 *
 * Usage:
 *   const agent = new DealAnalysisAgent({ ... });
 *   const result = await agent.analyzeProduct(image, analysis);
 *   // → "That's $45 here. Amazon has it for $32. Verdict: overpriced by $13."
 */

import { EventEmitter } from 'eventemitter3';
import type {
  CapturedImage,
  VisionAnalysis,
  DetectedProduct,
  DecodedBarcode,
  PipelineResult,
} from '../types.js';
import type { RoutingContext, AgentResponse } from '../routing/context-router.js';

// ─── Types ──────────────────────────────────────────────────────

export type DealCategory = 'product' | 'vehicle' | 'real_estate' | 'general';

export type DealVerdict = 'great_deal' | 'good_deal' | 'fair_price' | 'overpriced' | 'rip_off' | 'unknown';

export interface DealAnalysis {
  /** Unique analysis ID */
  id: string;
  /** What category this deal falls into */
  category: DealCategory;
  /** The item being analyzed */
  item: ItemInfo;
  /** Current asking price (from shelf tag, sticker, listing) */
  askingPrice?: number;
  /** Currency (default USD) */
  currency: string;
  /** Market price data from various sources */
  marketPrices: MarketPrice[];
  /** Fair market value estimate */
  fairMarketValue?: number;
  /** Our verdict */
  verdict: DealVerdict;
  /** Savings opportunity ($) */
  potentialSavings?: number;
  /** Savings opportunity (%) */
  savingsPercent?: number;
  /** Negotiation leverage points */
  negotiationPoints: string[];
  /** Additional insights */
  insights: string[];
  /** Warnings or red flags */
  warnings: string[];
  /** Related alternative products */
  alternatives: AlternativeItem[];
  /** When this analysis was done */
  analyzedAt: string;
  /** Image that triggered this analysis */
  imageId: string;
  /** Sources used */
  sources: string[];
  /** Processing time */
  processingTimeMs: number;
}

export interface ItemInfo {
  /** Item name */
  name: string;
  /** Brand */
  brand?: string;
  /** Model/variant */
  model?: string;
  /** UPC/barcode */
  upc?: string;
  /** Category */
  category?: string;
  /** For vehicles: year, make, model, trim, mileage, VIN */
  vehicleInfo?: VehicleInfo;
  /** For real estate: address, beds, baths, sqft */
  propertyInfo?: PropertyInfo;
}

export interface VehicleInfo {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mileage?: number;
  vin?: string;
  color?: string;
  condition?: string;
}

export interface PropertyInfo {
  address?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  lotSize?: string;
  yearBuilt?: number;
  propertyType?: string;
}

export interface MarketPrice {
  /** Where this price was found */
  source: string;
  /** The price */
  price: number;
  /** URL to the listing */
  url?: string;
  /** Price condition (new, used, refurbished) */
  condition?: string;
  /** When this price was observed */
  observedAt: string;
  /** Additional context */
  notes?: string;
}

export interface AlternativeItem {
  /** Item name */
  name: string;
  /** Price */
  price: number;
  /** Source */
  source: string;
  /** URL */
  url?: string;
  /** Why it's a good alternative */
  reason: string;
}

// ─── Configuration ──────────────────────────────────────────────

export interface DealAnalysisAgentConfig {
  /** Web search function — injected for testability */
  searchFn?: (query: string) => Promise<DealSearchResult[]>;
  /** Product database lookup function (UPC → product info) */
  productLookupFn?: (upc: string) => Promise<ProductLookupResult | null>;
  /** Maximum research time per deal (ms) */
  maxResearchTimeMs?: number;
  /** Whether to research alternatives */
  findAlternatives?: boolean;
  /** Maximum alternatives to find */
  maxAlternatives?: number;
  /** Enable deal history tracking */
  trackHistory?: boolean;
  /** Maximum deals to cache */
  maxHistorySize?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface DealSearchResult {
  title: string;
  url: string;
  snippet: string;
  price?: number;
}

export interface ProductLookupResult {
  name: string;
  brand: string;
  category: string;
  avgPrice?: number;
  imageUrl?: string;
}

const DEFAULT_CONFIG: Required<DealAnalysisAgentConfig> = {
  searchFn: async () => [],
  productLookupFn: async () => null,
  maxResearchTimeMs: 12000,
  findAlternatives: true,
  maxAlternatives: 3,
  trackHistory: true,
  maxHistorySize: 200,
  debug: false,
};

// ─── Events ─────────────────────────────────────────────────────

export interface DealAnalysisEvents {
  /** Deal analysis complete */
  'deal:analyzed': (deal: DealAnalysis) => void;
  /** Voice verdict ready for TTS */
  'voice:verdict': (text: string) => void;
  /** Deal saved to history */
  'deal:saved': (deal: DealAnalysis) => void;
  /** Error */
  'error': (source: string, message: string) => void;
  /** Debug */
  'log': (message: string) => void;
}

// ─── Agent Implementation ───────────────────────────────────────

export class DealAnalysisAgent extends EventEmitter<DealAnalysisEvents> {
  private config: Required<DealAnalysisAgentConfig>;
  private history: DealAnalysis[] = [];
  private analysisCount = 0;

  constructor(config: DealAnalysisAgentConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Context Router Handler ─────────────────────────────────

  /**
   * Handle a routed image from the context router.
   */
  async handle(
    image: CapturedImage,
    analysis: VisionAnalysis,
    context: RoutingContext,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      const deal = await this.analyze(image, analysis);

      if (!deal) {
        return {
          agentId: 'deals',
          handled: false,
          confidence: 0.2,
          priority: 4,
          processingTimeMs: Date.now() - startTime,
        };
      }

      const verdict = this.buildVoiceVerdict(deal);

      return {
        agentId: 'deals',
        handled: true,
        voiceResponse: verdict,
        data: { deal },
        confidence: deal.verdict === 'unknown' ? 0.4 : 0.85,
        priority: 4,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      this.emit('error', 'handle', String(err));
      return {
        agentId: 'deals',
        handled: false,
        confidence: 0,
        priority: 99,
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  // ─── Analysis ───────────────────────────────────────────────

  /**
   * Analyze an image for deal intelligence.
   */
  async analyze(
    image: CapturedImage,
    analysis: VisionAnalysis,
  ): Promise<DealAnalysis | null> {
    this.analysisCount++;
    this.log(`Deal analysis #${this.analysisCount}`);

    // Determine category
    const category = this.detectCategory(analysis);
    this.log(`Detected category: ${category}`);

    // Extract item info based on category
    const item = this.extractItemInfo(analysis, category);
    if (!item.upc && (!item.name || item.name === 'Unknown Product' || item.name === 'Unknown Vehicle' || item.name === 'Property')) {
      this.log('Could not identify the item — skipping');
      return null;
    }

    // Extract asking price from visible tags/labels
    const askingPrice = this.extractAskingPrice(analysis);

    // Research market prices
    const startTime = Date.now();
    const marketPrices = await this.researchPrices(item, category);
    const researchTimeMs = Date.now() - startTime;

    // Calculate fair market value
    const fairMarketValue = this.calculateFairValue(marketPrices);

    // Determine verdict
    const verdict = this.determineVerdict(askingPrice, fairMarketValue, marketPrices);

    // Calculate savings
    const potentialSavings = this.calculateSavings(askingPrice, marketPrices);

    // Generate negotiation points
    const negotiationPoints = this.generateNegotiationPoints(
      category, item, askingPrice, fairMarketValue, marketPrices,
    );

    // Find alternatives if enabled
    const alternatives: AlternativeItem[] = [];
    if (this.config.findAlternatives) {
      // Alternatives would be found during price research
      // For MVP, we note cheaper options found in market research
      for (const mp of marketPrices) {
        if (askingPrice && mp.price < askingPrice * 0.8) {
          alternatives.push({
            name: item.name,
            price: mp.price,
            source: mp.source,
            url: mp.url,
            reason: `${Math.round(((askingPrice - mp.price) / askingPrice) * 100)}% cheaper`,
          });
        }
      }
    }

    const deal: DealAnalysis = {
      id: `deal-${this.analysisCount}-${Date.now().toString(36)}`,
      category,
      item,
      askingPrice,
      currency: 'USD',
      marketPrices,
      fairMarketValue,
      verdict,
      potentialSavings: potentialSavings?.amount,
      savingsPercent: potentialSavings?.percent,
      negotiationPoints,
      insights: this.generateInsights(category, item, marketPrices),
      warnings: this.generateWarnings(category, item, askingPrice, fairMarketValue),
      alternatives: alternatives.slice(0, this.config.maxAlternatives),
      analyzedAt: new Date().toISOString(),
      imageId: image.id,
      sources: marketPrices.map((p) => p.source),
      processingTimeMs: researchTimeMs,
    };

    // Track history
    if (this.config.trackHistory) {
      this.history.push(deal);
      if (this.history.length > this.config.maxHistorySize) {
        this.history.shift();
      }
      this.emit('deal:saved', deal);
    }

    this.emit('deal:analyzed', deal);
    return deal;
  }

  // ─── Category Detection ─────────────────────────────────────

  /**
   * Detect what category of deal this is from the vision analysis.
   */
  detectCategory(analysis: VisionAnalysis): DealCategory {
    // Vehicle detection
    if (analysis.sceneType === 'vehicle') return 'vehicle';
    if (analysis.extractedText.some((t) =>
      /\b(VIN|mileage|miles|MSRP|dealer|horsepower|engine|transmission)\b/i.test(t.text),
    )) return 'vehicle';

    // Real estate detection
    if (analysis.sceneType === 'property') return 'real_estate';
    if (analysis.extractedText.some((t) =>
      /\b(beds?|baths?|sq\s*ft|sqft|listing|MLS|price reduced|open house|for sale)\b/i.test(t.text),
    )) return 'real_estate';

    // Product detection (most common)
    if (analysis.products.length > 0 || analysis.barcodes.length > 0) return 'product';
    if (analysis.sceneType === 'retail_shelf') return 'product';

    // Check for price tags
    if (analysis.extractedText.some((t) => t.textType === 'price')) return 'product';

    return 'general';
  }

  // ─── Item Extraction ────────────────────────────────────────

  /**
   * Extract item info from the analysis based on category.
   */
  extractItemInfo(
    analysis: VisionAnalysis,
    category: DealCategory,
  ): ItemInfo {
    switch (category) {
      case 'vehicle':
        return this.extractVehicleInfo(analysis);
      case 'real_estate':
        return this.extractPropertyInfo(analysis);
      case 'product':
      default:
        return this.extractProductInfo(analysis);
    }
  }

  /**
   * Extract product info from analysis.
   */
  private extractProductInfo(analysis: VisionAnalysis): ItemInfo {
    // Use the first (most confident) detected product
    const product = analysis.products
      .sort((a, b) => b.confidence - a.confidence)[0];

    const barcode = analysis.barcodes[0];

    return {
      name: product?.name || this.extractNameFromText(analysis) || 'Unknown Product',
      brand: product?.brand,
      model: product?.variant,
      upc: product?.upc || barcode?.data,
      category: product?.category,
    };
  }

  /**
   * Extract vehicle info from analysis.
   */
  private extractVehicleInfo(analysis: VisionAnalysis): ItemInfo {
    const allText = analysis.extractedText.map((t) => t.text).join(' ');

    const yearMatch = allText.match(/\b(19|20)\d{2}\b/);
    const mileageMatch = allText.match(/([\d,]+)\s*(?:miles|mi)\b/i);
    const vinMatch = allText.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);

    // Try to extract make/model from common patterns
    const makeModelMatch = allText.match(
      /\b(Toyota|Honda|Ford|Chevrolet|BMW|Mercedes|Audi|Tesla|Nissan|Hyundai|Kia|Subaru|Volkswagen|Mazda|Lexus|Jeep|Ram|GMC|Dodge|Buick)\s+([A-Za-z0-9\s-]+?)(?:\s+(?:LE|SE|XLE|XSE|EX|LX|Sport|Limited|Premium|Base|S|SV|SR|Pro|TRD))?(?:\s|$)/i,
    );

    return {
      name: makeModelMatch
        ? `${yearMatch?.[0] || ''} ${makeModelMatch[1]} ${makeModelMatch[2]}`.trim()
        : 'Unknown Vehicle',
      brand: makeModelMatch?.[1],
      model: makeModelMatch?.[2],
      vehicleInfo: {
        year: yearMatch ? parseInt(yearMatch[0]) : undefined,
        make: makeModelMatch?.[1],
        model: makeModelMatch?.[2],
        mileage: mileageMatch
          ? parseInt(mileageMatch[1].replace(/,/g, ''))
          : undefined,
        vin: vinMatch?.[0],
      },
    };
  }

  /**
   * Extract property info from analysis.
   */
  private extractPropertyInfo(analysis: VisionAnalysis): ItemInfo {
    const allText = analysis.extractedText.map((t) => t.text).join(' ');

    const bedsMatch = allText.match(/(\d+)\s*(?:bed|br|bedroom)/i);
    const bathsMatch = allText.match(/([\d.]+)\s*(?:bath|ba|bathroom)/i);
    const sqftMatch = allText.match(/([\d,]+)\s*(?:sq\s*ft|sqft|sf)/i);
    const yearBuiltMatch = allText.match(/(?:built|year)\s*:?\s*((?:19|20)\d{2})/i);

    // Try to extract address
    const addressMatch = allText.match(
      /\d{1,5}\s+[A-Za-z0-9\s]+(?:St|Ave|Blvd|Dr|Ln|Rd|Ct|Way|Pl|Ter|Cir)\.?(?:\s*#\d+)?/i,
    );

    return {
      name: addressMatch?.[0] || 'Property',
      propertyInfo: {
        address: addressMatch?.[0],
        beds: bedsMatch ? parseInt(bedsMatch[1]) : undefined,
        baths: bathsMatch ? parseFloat(bathsMatch[1]) : undefined,
        sqft: sqftMatch
          ? parseInt(sqftMatch[1].replace(/,/g, ''))
          : undefined,
        yearBuilt: yearBuiltMatch ? parseInt(yearBuiltMatch[1]) : undefined,
      },
    };
  }

  /**
   * Try to extract an item name from extracted text when no product was detected.
   */
  private extractNameFromText(analysis: VisionAnalysis): string | undefined {
    // Look for the most prominent label-type text
    const labels = analysis.extractedText
      .filter((t) => t.textType === 'label' || t.textType === 'other')
      .sort((a, b) => b.confidence - a.confidence);

    for (const label of labels) {
      if (label.text.length > 3 && label.text.length < 80) {
        return label.text;
      }
    }

    return undefined;
  }

  // ─── Price Extraction ───────────────────────────────────────

  /**
   * Extract the asking price from visible price tags/labels.
   */
  extractAskingPrice(analysis: VisionAnalysis): number | undefined {
    // Look for price-tagged text
    const priceTexts = analysis.extractedText.filter(
      (t) => t.textType === 'price',
    );

    for (const pt of priceTexts) {
      const price = this.parsePrice(pt.text);
      if (price !== null) return price;
    }

    // Search all text for price patterns
    for (const t of analysis.extractedText) {
      const price = this.parsePrice(t.text);
      if (price !== null) return price;
    }

    // Check products for shelf prices
    for (const product of analysis.products) {
      if (product.priceOnShelf) return product.priceOnShelf;
    }

    return undefined;
  }

  /**
   * Parse a price string into a number.
   */
  parsePrice(text: string): number | null {
    const patterns = [
      /\$\s*([\d,]+(?:\.\d{2})?)/,         // $29.99, $1,299
      /(?:USD|US\$)\s*([\d,]+(?:\.\d{2})?)/, // USD 29.99
      /([\d,]+(?:\.\d{2})?)\s*(?:dollars?)/i, // 29.99 dollars
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(value) && value > 0) return value;
      }
    }

    return null;
  }

  // ─── Price Research ─────────────────────────────────────────

  /**
   * Research market prices for an item.
   */
  async researchPrices(
    item: ItemInfo,
    category: DealCategory,
  ): Promise<MarketPrice[]> {
    const prices: MarketPrice[] = [];
    const deadline = Date.now() + this.config.maxResearchTimeMs;

    // Build search queries based on category
    const queries = this.buildPriceQueries(item, category);

    for (const query of queries) {
      if (Date.now() >= deadline) break;

      try {
        const results = await this.config.searchFn(query);

        for (const result of results) {
          const price = result.price || this.extractPriceFromSnippet(result.snippet);
          if (price !== null && price !== undefined) {
            prices.push({
              source: this.extractSourceName(result.url),
              price,
              url: result.url,
              observedAt: new Date().toISOString(),
              notes: result.title.slice(0, 100),
            });
          }
        }
      } catch (err) {
        this.log(`Price search failed: ${query}: ${err}`);
      }
    }

    // UPC lookup for products
    if (item.upc && category === 'product') {
      try {
        const productInfo = await this.config.productLookupFn(item.upc);
        if (productInfo?.avgPrice) {
          prices.push({
            source: 'Product Database',
            price: productInfo.avgPrice,
            observedAt: new Date().toISOString(),
            notes: `Average retail price for ${productInfo.name}`,
          });
        }
      } catch (err) {
        this.log(`Product lookup failed: ${err}`);
      }
    }

    // Sort by price
    prices.sort((a, b) => a.price - b.price);

    return prices;
  }

  /**
   * Build search queries for price research.
   */
  private buildPriceQueries(
    item: ItemInfo,
    category: DealCategory,
  ): string[] {
    const queries: string[] = [];

    switch (category) {
      case 'product':
        if (item.upc) queries.push(`${item.upc} price`);
        if (item.name) {
          queries.push(`${item.name} price amazon`);
          queries.push(`${item.name} price compare`);
        }
        if (item.brand && item.model) {
          queries.push(`${item.brand} ${item.model} best price`);
        }
        break;

      case 'vehicle':
        if (item.vehicleInfo) {
          const v = item.vehicleInfo;
          const desc = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
          queries.push(`${desc} fair market value`);
          queries.push(`${desc} dealer cost invoice price`);
          if (v.vin) queries.push(`${v.vin} vehicle history`);
          if (v.make && v.model && v.year) {
            queries.push(`${v.year} ${v.make} ${v.model} recall NHTSA`);
          }
        }
        break;

      case 'real_estate':
        if (item.propertyInfo?.address) {
          queries.push(`${item.propertyInfo.address} property value`);
          queries.push(`${item.propertyInfo.address} zillow estimate`);
        }
        if (item.propertyInfo?.sqft) {
          queries.push(`homes for sale ${item.propertyInfo.beds}bed ${item.propertyInfo.baths}bath comps`);
        }
        break;

      default:
        if (item.name) queries.push(`${item.name} price`);
        break;
    }

    return queries;
  }

  /**
   * Extract a price from a search result snippet.
   */
  private extractPriceFromSnippet(snippet: string): number | null {
    return this.parsePrice(snippet);
  }

  /**
   * Extract a friendly source name from a URL.
   */
  private extractSourceName(url: string): string {
    try {
      const hostname = new URL(url).hostname;
      const nameMap: Record<string, string> = {
        'www.amazon.com': 'Amazon',
        'amazon.com': 'Amazon',
        'www.ebay.com': 'eBay',
        'ebay.com': 'eBay',
        'www.walmart.com': 'Walmart',
        'walmart.com': 'Walmart',
        'www.target.com': 'Target',
        'www.bestbuy.com': 'Best Buy',
        'www.homedepot.com': 'Home Depot',
        'www.lowes.com': "Lowe's",
        'www.zillow.com': 'Zillow',
        'www.redfin.com': 'Redfin',
        'www.realtor.com': 'Realtor.com',
        'www.kbb.com': 'Kelley Blue Book',
        'www.edmunds.com': 'Edmunds',
        'www.cargurus.com': 'CarGurus',
        'www.autotrader.com': 'AutoTrader',
        'camelcamelcamel.com': 'CamelCamelCamel',
      };
      return nameMap[hostname] || hostname.replace('www.', '');
    } catch {
      return 'Web';
    }
  }

  // ─── Valuation ──────────────────────────────────────────────

  /**
   * Calculate fair market value from market prices.
   */
  calculateFairValue(prices: MarketPrice[]): number | undefined {
    if (prices.length === 0) return undefined;

    // Use median price as fair value (more robust than mean)
    const sorted = [...prices].sort((a, b) => a.price - b.price);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1].price + sorted[mid].price) / 2;
    }
    return sorted[mid].price;
  }

  /**
   * Determine verdict based on asking price vs market.
   */
  determineVerdict(
    askingPrice: number | undefined,
    fairMarketValue: number | undefined,
    marketPrices: MarketPrice[],
  ): DealVerdict {
    if (!askingPrice || !fairMarketValue) return 'unknown';

    const ratio = askingPrice / fairMarketValue;

    if (ratio <= 0.7) return 'great_deal';     // 30%+ below market
    if (ratio <= 0.9) return 'good_deal';      // 10-30% below market
    if (ratio <= 1.1) return 'fair_price';     // Within 10% of market
    if (ratio <= 1.3) return 'overpriced';     // 10-30% above market
    return 'rip_off';                          // 30%+ above market
  }

  /**
   * Calculate potential savings.
   */
  calculateSavings(
    askingPrice: number | undefined,
    marketPrices: MarketPrice[],
  ): { amount: number; percent: number } | undefined {
    if (!askingPrice || marketPrices.length === 0) return undefined;

    // Compare to the lowest available market price
    const lowestPrice = Math.min(...marketPrices.map((p) => p.price));
    if (lowestPrice >= askingPrice) return undefined;

    const savings = askingPrice - lowestPrice;
    const percent = (savings / askingPrice) * 100;

    return { amount: Math.round(savings * 100) / 100, percent: Math.round(percent) };
  }

  // ─── Negotiation & Insights ─────────────────────────────────

  /**
   * Generate negotiation leverage points.
   */
  generateNegotiationPoints(
    category: DealCategory,
    item: ItemInfo,
    askingPrice: number | undefined,
    fairMarketValue: number | undefined,
    marketPrices: MarketPrice[],
  ): string[] {
    const points: string[] = [];

    // Price-based leverage
    if (askingPrice && fairMarketValue) {
      const diff = askingPrice - fairMarketValue;
      if (diff > 0) {
        points.push(
          `Asking $${askingPrice.toLocaleString()} is $${diff.toLocaleString()} above fair market value of $${fairMarketValue.toLocaleString()}.`,
        );
      }
    }

    // Cheaper alternatives
    if (askingPrice) {
      const cheaper = marketPrices.filter((p) => p.price < askingPrice);
      if (cheaper.length > 0) {
        const best = cheaper[0];
        points.push(
          `Available for $${best.price.toLocaleString()} at ${best.source}.`,
        );
      }
    }

    // Category-specific points
    switch (category) {
      case 'vehicle':
        if (item.vehicleInfo?.mileage) {
          const mi = item.vehicleInfo.mileage;
          if (mi > 100000) {
            points.push('Over 100K miles — negotiate harder on maintenance history.');
          } else if (mi > 60000) {
            points.push('Approaching 60K miles — major service intervals coming up.');
          }
        }
        points.push('Ask for the vehicle history report (Carfax/AutoCheck).');
        points.push('Check NHTSA for open recalls — dealer must fix for free.');
        break;

      case 'real_estate':
        points.push('Request seller disclosures and inspection reports.');
        points.push('Check days-on-market — longer listing = more negotiation power.');
        if (item.propertyInfo?.yearBuilt && item.propertyInfo.yearBuilt < 1980) {
          points.push('Pre-1980 — check for lead paint, asbestos, and outdated wiring.');
        }
        break;

      case 'product':
        points.push('Check if the product goes on sale seasonally (Black Friday, Prime Day).');
        if (marketPrices.some((p) => p.source === 'eBay')) {
          points.push('Available used/refurbished on eBay for less.');
        }
        break;
    }

    return points.slice(0, 6);
  }

  /**
   * Generate additional insights about the deal.
   */
  private generateInsights(
    category: DealCategory,
    item: ItemInfo,
    marketPrices: MarketPrice[],
  ): string[] {
    const insights: string[] = [];

    if (marketPrices.length > 1) {
      const range = marketPrices[marketPrices.length - 1].price - marketPrices[0].price;
      insights.push(
        `Price range: $${marketPrices[0].price.toLocaleString()} — $${marketPrices[marketPrices.length - 1].price.toLocaleString()} (spread: $${range.toLocaleString()}).`,
      );
    }

    if (category === 'vehicle' && item.vehicleInfo) {
      if (item.vehicleInfo.year) {
        const age = new Date().getFullYear() - item.vehicleInfo.year;
        insights.push(`Vehicle is ${age} year${age !== 1 ? 's' : ''} old.`);
      }
    }

    return insights;
  }

  /**
   * Generate warnings/red flags.
   */
  private generateWarnings(
    category: DealCategory,
    item: ItemInfo,
    askingPrice: number | undefined,
    fairMarketValue: number | undefined,
  ): string[] {
    const warnings: string[] = [];

    if (askingPrice && fairMarketValue) {
      if (askingPrice > fairMarketValue * 1.5) {
        warnings.push('⚠️ Asking price is significantly above market value!');
      }
      if (askingPrice < fairMarketValue * 0.5) {
        warnings.push('⚠️ Price seems too good — verify authenticity/condition.');
      }
    }

    if (category === 'vehicle') {
      if (item.vehicleInfo?.mileage && item.vehicleInfo.mileage > 150000) {
        warnings.push('⚠️ High mileage — inspect carefully for wear and pending repairs.');
      }
    }

    if (category === 'real_estate') {
      if (
        item.propertyInfo?.yearBuilt &&
        item.propertyInfo.yearBuilt < 1960
      ) {
        warnings.push('⚠️ Very old structure — budget for potential major repairs.');
      }
    }

    return warnings;
  }

  // ─── Voice Output ───────────────────────────────────────────

  /**
   * Build a voice-friendly verdict (15-30 seconds of speech).
   */
  buildVoiceVerdict(deal: DealAnalysis): string {
    const parts: string[] = [];

    // Item identification
    if (deal.item.brand) {
      parts.push(`${deal.item.brand} ${deal.item.model || deal.item.name}.`);
    } else {
      parts.push(`${deal.item.name}.`);
    }

    // Price comparison
    if (deal.askingPrice) {
      parts.push(`Asking: $${deal.askingPrice.toLocaleString()}.`);
    }

    if (deal.fairMarketValue) {
      parts.push(
        `Fair market value: $${deal.fairMarketValue.toLocaleString()}.`,
      );
    }

    // Cheapest market price
    if (deal.marketPrices.length > 0) {
      const cheapest = deal.marketPrices[0];
      parts.push(
        `Cheapest found: $${cheapest.price.toLocaleString()} at ${cheapest.source}.`,
      );
    }

    // Verdict
    const verdictText: Record<DealVerdict, string> = {
      great_deal: 'This is a great deal.',
      good_deal: 'This is a good deal.',
      fair_price: 'This is a fair price.',
      overpriced: 'This is overpriced.',
      rip_off: 'This is way overpriced. Walk away.',
      unknown: 'I don\'t have enough data to judge.',
    };
    parts.push(verdictText[deal.verdict]);

    // Savings highlight
    if (deal.potentialSavings && deal.potentialSavings > 0) {
      parts.push(
        `You could save $${deal.potentialSavings.toLocaleString()}.`,
      );
    }

    // Top negotiation point
    if (deal.negotiationPoints.length > 0) {
      parts.push(deal.negotiationPoints[0]);
    }

    const verdict = parts.join(' ');
    this.emit('voice:verdict', verdict);
    return verdict;
  }

  // ─── History ────────────────────────────────────────────────

  /**
   * Get deal history.
   */
  getHistory(): DealAnalysis[] {
    return [...this.history];
  }

  /**
   * Search deal history.
   */
  searchHistory(query: string): DealAnalysis[] {
    const q = query.toLowerCase();
    return this.history.filter((d) =>
      d.item.name.toLowerCase().includes(q) ||
      d.item.brand?.toLowerCase().includes(q) ||
      d.item.category?.toLowerCase().includes(q),
    );
  }

  /**
   * Get stats.
   */
  getStats(): {
    totalAnalyses: number;
    historySize: number;
    verdictBreakdown: Record<DealVerdict, number>;
    totalSavingsFound: number;
  } {
    const breakdown: Record<DealVerdict, number> = {
      great_deal: 0,
      good_deal: 0,
      fair_price: 0,
      overpriced: 0,
      rip_off: 0,
      unknown: 0,
    };
    let totalSavings = 0;

    for (const deal of this.history) {
      breakdown[deal.verdict]++;
      if (deal.potentialSavings) totalSavings += deal.potentialSavings;
    }

    return {
      totalAnalyses: this.analysisCount,
      historySize: this.history.length,
      verdictBreakdown: breakdown,
      totalSavingsFound: Math.round(totalSavings * 100) / 100,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────

  private log(message: string): void {
    if (this.config.debug) {
      this.emit('log', `[DealAgent] ${message}`);
    }
  }
}
