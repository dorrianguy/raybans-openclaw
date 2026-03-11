/**
 * Search & Indexing Engine — Meta Ray-Bans × OpenClaw
 *
 * Full-text search across all platform data: inventory items, products,
 * contacts, memory entries, audit events, inspection findings, and more.
 *
 * Features:
 * - Multi-collection search with weighted relevance scoring
 * - FTS5-compatible query building (AND, OR, NOT, phrase, prefix, NEAR)
 * - Search suggestions and autocomplete from recent/popular queries
 * - Faceted search with category, date, tag, and custom facets
 * - Search analytics: popular queries, zero-result tracking, click-through
 * - Saved searches with optional notification on new results
 * - Search history per user with privacy controls
 * - Voice-friendly search result summaries for TTS
 * - Configurable result highlighting with snippet extraction
 *
 * 🌙 Night Shift Agent — Shift #24
 */

import { EventEmitter } from 'events';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SearchCollection =
  | 'inventory'
  | 'products'
  | 'contacts'
  | 'memory'
  | 'audit'
  | 'inspections'
  | 'meetings'
  | 'deals'
  | 'documents'
  | 'custom';

export type SearchOperator = 'AND' | 'OR' | 'NOT' | 'NEAR' | 'PHRASE' | 'PREFIX';

export type SortField = 'relevance' | 'date' | 'name' | 'collection' | 'popularity';
export type SortOrder = 'asc' | 'desc';

export interface SearchQuery {
  text: string;
  collections?: SearchCollection[];
  operator?: SearchOperator;
  filters?: SearchFilter[];
  facets?: string[];
  sort?: { field: SortField; order: SortOrder };
  limit?: number;
  offset?: number;
  highlight?: boolean;
  snippetLength?: number;
  userId?: string;
  dateRange?: { from?: number; to?: number };
  tags?: string[];
  minScore?: number;
}

export interface SearchFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'contains';
  value: string | number | boolean | string[];
}

export interface SearchResult {
  id: string;
  collection: SearchCollection;
  title: string;
  snippet: string;
  score: number;
  highlights: SearchHighlight[];
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt?: number;
  tags: string[];
  url?: string;
}

export interface SearchHighlight {
  field: string;
  fragments: string[];
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
  facets: SearchFacet[];
  suggestions: string[];
  took: number; // ms
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SearchFacet {
  name: string;
  buckets: FacetBucket[];
}

export interface FacetBucket {
  value: string;
  count: number;
  selected: boolean;
}

export interface IndexDocument {
  id: string;
  collection: SearchCollection;
  title: string;
  body: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
  boost?: number; // relevance multiplier
}

export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  query: SearchQuery;
  notifyOnNew: boolean;
  lastRunAt: number;
  lastResultCount: number;
  createdAt: number;
}

export interface SearchHistoryEntry {
  query: string;
  collections: SearchCollection[];
  resultCount: number;
  userId?: string;
  timestamp: number;
  clickedResultId?: string;
}

export interface SearchSuggestion {
  text: string;
  source: 'history' | 'popular' | 'autocomplete' | 'correction';
  score: number;
}

export interface CollectionConfig {
  collection: SearchCollection;
  weight: number; // 0-10 relevance weight
  fields: FieldConfig[];
  enabled: boolean;
}

export interface FieldConfig {
  name: string;
  weight: number; // 0-10
  searchable: boolean;
  facetable: boolean;
  sortable: boolean;
}

export interface SearchEngineConfig {
  collections: CollectionConfig[];
  maxResults: number;
  defaultSnippetLength: number;
  highlightTag: { open: string; close: string };
  minQueryLength: number;
  maxQueryLength: number;
  suggestionsLimit: number;
  historyLimit: number;
  popularQueryWindow: number; // ms — window for "popular" queries
  fuzzyThreshold: number; // 0-1 — Levenshtein tolerance for suggestions
  stopWords: string[];
}

export interface SearchStats {
  totalDocuments: number;
  documentsByCollection: Record<string, number>;
  totalSearches: number;
  averageResultCount: number;
  zeroResultQueries: number;
  averageSearchTime: number;
  popularQueries: Array<{ query: string; count: number }>;
  searchesPerDay: number;
}

// ─── Default Config ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SearchEngineConfig = {
  collections: [
    {
      collection: 'inventory',
      weight: 8,
      enabled: true,
      fields: [
        { name: 'name', weight: 10, searchable: true, facetable: false, sortable: true },
        { name: 'sku', weight: 9, searchable: true, facetable: false, sortable: true },
        { name: 'category', weight: 6, searchable: true, facetable: true, sortable: true },
        { name: 'location', weight: 4, searchable: true, facetable: true, sortable: true },
      ],
    },
    {
      collection: 'products',
      weight: 7,
      enabled: true,
      fields: [
        { name: 'name', weight: 10, searchable: true, facetable: false, sortable: true },
        { name: 'brand', weight: 8, searchable: true, facetable: true, sortable: true },
        { name: 'upc', weight: 9, searchable: true, facetable: false, sortable: false },
        { name: 'category', weight: 6, searchable: true, facetable: true, sortable: true },
      ],
    },
    {
      collection: 'contacts',
      weight: 6,
      enabled: true,
      fields: [
        { name: 'name', weight: 10, searchable: true, facetable: false, sortable: true },
        { name: 'company', weight: 7, searchable: true, facetable: true, sortable: true },
        { name: 'title', weight: 5, searchable: true, facetable: true, sortable: true },
        { name: 'email', weight: 8, searchable: true, facetable: false, sortable: false },
      ],
    },
    {
      collection: 'memory',
      weight: 5,
      enabled: true,
      fields: [
        { name: 'description', weight: 10, searchable: true, facetable: false, sortable: false },
        { name: 'text', weight: 8, searchable: true, facetable: false, sortable: false },
        { name: 'location', weight: 4, searchable: true, facetable: true, sortable: true },
        { name: 'scene_type', weight: 5, searchable: true, facetable: true, sortable: true },
      ],
    },
    {
      collection: 'audit',
      weight: 3,
      enabled: true,
      fields: [
        { name: 'action', weight: 8, searchable: true, facetable: true, sortable: true },
        { name: 'category', weight: 7, searchable: true, facetable: true, sortable: true },
        { name: 'actor', weight: 6, searchable: true, facetable: true, sortable: true },
        { name: 'details', weight: 4, searchable: true, facetable: false, sortable: false },
      ],
    },
    {
      collection: 'inspections',
      weight: 6,
      enabled: true,
      fields: [
        { name: 'title', weight: 9, searchable: true, facetable: false, sortable: true },
        { name: 'type', weight: 7, searchable: true, facetable: true, sortable: true },
        { name: 'findings', weight: 8, searchable: true, facetable: false, sortable: false },
        { name: 'location', weight: 5, searchable: true, facetable: true, sortable: true },
      ],
    },
    {
      collection: 'meetings',
      weight: 5,
      enabled: true,
      fields: [
        { name: 'title', weight: 9, searchable: true, facetable: false, sortable: true },
        { name: 'transcript', weight: 6, searchable: true, facetable: false, sortable: false },
        { name: 'attendees', weight: 7, searchable: true, facetable: true, sortable: false },
        { name: 'action_items', weight: 8, searchable: true, facetable: false, sortable: false },
      ],
    },
    {
      collection: 'deals',
      weight: 5,
      enabled: true,
      fields: [
        { name: 'product', weight: 9, searchable: true, facetable: false, sortable: true },
        { name: 'category', weight: 6, searchable: true, facetable: true, sortable: true },
        { name: 'verdict', weight: 7, searchable: true, facetable: true, sortable: true },
        { name: 'details', weight: 5, searchable: true, facetable: false, sortable: false },
      ],
    },
    {
      collection: 'documents',
      weight: 4,
      enabled: true,
      fields: [
        { name: 'title', weight: 10, searchable: true, facetable: false, sortable: true },
        { name: 'content', weight: 7, searchable: true, facetable: false, sortable: false },
        { name: 'type', weight: 5, searchable: true, facetable: true, sortable: true },
      ],
    },
    {
      collection: 'custom',
      weight: 3,
      enabled: true,
      fields: [
        { name: 'title', weight: 8, searchable: true, facetable: false, sortable: true },
        { name: 'body', weight: 6, searchable: true, facetable: false, sortable: false },
      ],
    },
  ],
  maxResults: 100,
  defaultSnippetLength: 200,
  highlightTag: { open: '**', close: '**' },
  minQueryLength: 1,
  maxQueryLength: 500,
  suggestionsLimit: 5,
  historyLimit: 1000,
  popularQueryWindow: 7 * 24 * 60 * 60 * 1000, // 7 days
  fuzzyThreshold: 0.7,
  stopWords: [
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'was', 'are',
  ],
};

// ─── Search Engine Implementation ────────────────────────────────────────────

export class SearchEngine extends EventEmitter {
  private documents: Map<string, IndexDocument> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map(); // term → doc IDs
  private collectionIndex: Map<SearchCollection, Set<string>> = new Map(); // collection → doc IDs
  private tagIndex: Map<string, Set<string>> = new Map(); // tag → doc IDs
  private searchHistory: SearchHistoryEntry[] = [];
  private savedSearches: Map<string, SavedSearch> = new Map();
  private queryPopularity: Map<string, { count: number; lastUsed: number }> = new Map();
  private config: SearchEngineConfig;
  private totalSearches = 0;
  private totalResultCounts = 0;
  private zeroResultCount = 0;
  private totalSearchTime = 0;

  constructor(config?: Partial<SearchEngineConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.collections) {
      this.config.collections = config.collections;
    }
  }

  // ─── Indexing ────────────────────────────────────────────────────────────

  index(doc: IndexDocument): void {
    if (!doc.id || !doc.collection) {
      throw new Error('Document must have id and collection');
    }

    const existing = this.documents.has(doc.id);
    if (existing) {
      this.removeFromIndexes(doc.id);
    }

    const now = Date.now();
    const stored: IndexDocument = {
      ...doc,
      createdAt: doc.createdAt ?? (existing ? this.documents.get(doc.id)!.createdAt : now),
      updatedAt: doc.updatedAt ?? now,
    };

    this.documents.set(doc.id, stored);

    // Collection index
    if (!this.collectionIndex.has(doc.collection)) {
      this.collectionIndex.set(doc.collection, new Set());
    }
    this.collectionIndex.get(doc.collection)!.add(doc.id);

    // Tag index
    for (const tag of doc.tags) {
      const normalTag = tag.toLowerCase();
      if (!this.tagIndex.has(normalTag)) {
        this.tagIndex.set(normalTag, new Set());
      }
      this.tagIndex.get(normalTag)!.add(doc.id);
    }

    // Inverted index (full-text)
    const terms = this.tokenize(`${doc.title} ${doc.body}`);
    for (const term of terms) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Set());
      }
      this.invertedIndex.get(term)!.add(doc.id);
    }

    this.emit(existing ? 'document:updated' : 'document:indexed', {
      id: doc.id,
      collection: doc.collection,
    });
  }

  indexBatch(docs: IndexDocument[]): { indexed: number; errors: Array<{ id: string; error: string }> } {
    const errors: Array<{ id: string; error: string }> = [];
    let indexed = 0;

    for (const doc of docs) {
      try {
        this.index(doc);
        indexed++;
      } catch (err) {
        errors.push({
          id: doc.id ?? 'unknown',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.emit('batch:indexed', { indexed, errors: errors.length });
    return { indexed, errors };
  }

  removeDocument(id: string): boolean {
    if (!this.documents.has(id)) return false;

    const doc = this.documents.get(id)!;
    this.removeFromIndexes(id);
    this.documents.delete(id);

    this.emit('document:removed', { id, collection: doc.collection });
    return true;
  }

  removeByCollection(collection: SearchCollection): number {
    const docIds = this.collectionIndex.get(collection);
    if (!docIds) return 0;

    const count = docIds.size;
    for (const id of [...docIds]) {
      this.removeDocument(id);
    }
    return count;
  }

  private removeFromIndexes(id: string): void {
    const doc = this.documents.get(id);
    if (!doc) return;

    // Remove from collection index
    this.collectionIndex.get(doc.collection)?.delete(id);

    // Remove from tag index
    for (const tag of doc.tags) {
      this.tagIndex.get(tag.toLowerCase())?.delete(id);
    }

    // Remove from inverted index
    const terms = this.tokenize(`${doc.title} ${doc.body}`);
    for (const term of terms) {
      this.invertedIndex.get(term)?.delete(id);
    }
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  search(query: SearchQuery): SearchResponse {
    const start = Date.now();

    // Validate query
    if (!query.text || query.text.length < this.config.minQueryLength) {
      return this.emptyResponse(query.text ?? '', start);
    }
    if (query.text.length > this.config.maxQueryLength) {
      query = { ...query, text: query.text.slice(0, this.config.maxQueryLength) };
    }

    const limit = Math.min(query.limit ?? 20, this.config.maxResults);
    const offset = query.offset ?? 0;
    const operator = query.operator ?? 'AND';
    const collections = query.collections ??
      this.config.collections.filter(c => c.enabled).map(c => c.collection);

    // Tokenize query
    const queryTerms = this.tokenize(query.text);
    if (queryTerms.length === 0) {
      return this.emptyResponse(query.text, start);
    }

    // Find matching document IDs
    let candidateIds: Set<string>;

    if (operator === 'PHRASE') {
      candidateIds = this.phraseSearch(queryTerms);
    } else if (operator === 'PREFIX') {
      candidateIds = this.prefixSearch(queryTerms);
    } else if (operator === 'NEAR') {
      candidateIds = this.nearSearch(queryTerms);
    } else {
      candidateIds = this.booleanSearch(queryTerms, operator);
    }

    // Filter by collections
    const filteredIds = new Set<string>();
    for (const id of candidateIds) {
      const doc = this.documents.get(id);
      if (doc && collections.includes(doc.collection)) {
        filteredIds.add(id);
      }
    }

    // Apply filters
    let resultIds = this.applyFilters(filteredIds, query.filters ?? []);

    // Apply date range filter
    if (query.dateRange) {
      resultIds = this.applyDateRange(resultIds, query.dateRange);
    }

    // Apply tag filter
    if (query.tags && query.tags.length > 0) {
      resultIds = this.applyTagFilter(resultIds, query.tags);
    }

    // Score and rank results
    let results = this.scoreResults(resultIds, queryTerms, query);

    // Apply min score filter
    if (query.minScore !== undefined) {
      results = results.filter(r => r.score >= query.minScore!);
    }

    // Sort
    results = this.sortResults(results, query.sort);

    // Calculate facets
    const facets = this.calculateFacets(resultIds, query.facets ?? []);

    // Get suggestions
    const suggestions = this.getSuggestions(query.text);

    // Paginate
    const total = results.length;
    const paginatedResults = results.slice(offset, offset + limit);

    // Record search
    this.recordSearch({
      query: query.text,
      collections,
      resultCount: total,
      userId: query.userId,
      timestamp: Date.now(),
    });

    const took = Date.now() - start;
    this.totalSearchTime += took;

    const response: SearchResponse = {
      query: query.text,
      results: paginatedResults,
      total,
      facets,
      suggestions,
      took,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      hasMore: offset + limit < total,
    };

    this.emit('search:completed', { query: query.text, total, took });
    return response;
  }

  private booleanSearch(terms: string[], operator: 'AND' | 'OR' | 'NOT'): Set<string> {
    if (terms.length === 0) return new Set();

    if (operator === 'AND') {
      let result: Set<string> | null = null;
      for (const term of terms) {
        const termDocs = this.invertedIndex.get(term) ?? new Set();
        if (result === null) {
          result = new Set(termDocs);
        } else {
          result = new Set([...result].filter(id => termDocs.has(id)));
        }
      }
      return result ?? new Set();
    }

    if (operator === 'OR') {
      const result = new Set<string>();
      for (const term of terms) {
        const termDocs = this.invertedIndex.get(term) ?? new Set();
        for (const id of termDocs) {
          result.add(id);
        }
      }
      return result;
    }

    // NOT: first term required, subsequent terms excluded
    if (terms.length < 2) return this.invertedIndex.get(terms[0]) ?? new Set();

    const included = this.invertedIndex.get(terms[0]) ?? new Set();
    const excluded = new Set<string>();
    for (let i = 1; i < terms.length; i++) {
      const termDocs = this.invertedIndex.get(terms[i]) ?? new Set();
      for (const id of termDocs) {
        excluded.add(id);
      }
    }
    return new Set([...included].filter(id => !excluded.has(id)));
  }

  private phraseSearch(terms: string[]): Set<string> {
    // For phrase search: all terms must be present AND appear in sequence in the source text
    const candidates = this.booleanSearch(terms, 'AND');
    const phrase = terms.join(' ');
    const result = new Set<string>();

    for (const id of candidates) {
      const doc = this.documents.get(id)!;
      const fullText = `${doc.title} ${doc.body}`.toLowerCase();
      if (fullText.includes(phrase)) {
        result.add(id);
      }
    }
    return result;
  }

  private prefixSearch(terms: string[]): Set<string> {
    const result = new Set<string>();

    for (const term of terms) {
      for (const [indexedTerm, docIds] of this.invertedIndex) {
        if (indexedTerm.startsWith(term)) {
          for (const id of docIds) {
            result.add(id);
          }
        }
      }
    }
    return result;
  }

  private nearSearch(terms: string[], proximity: number = 5): Set<string> {
    // NEAR: all terms present and within N words of each other
    const candidates = this.booleanSearch(terms, 'AND');
    const result = new Set<string>();

    for (const id of candidates) {
      const doc = this.documents.get(id)!;
      const words = this.tokenize(`${doc.title} ${doc.body}`);

      // Find positions of each term
      const positions: Map<string, number[]> = new Map();
      for (const term of terms) {
        const termPositions: number[] = [];
        for (let i = 0; i < words.length; i++) {
          if (words[i] === term) termPositions.push(i);
        }
        positions.set(term, termPositions);
      }

      // Check if any combination is within proximity
      if (this.checkProximity(terms, positions, proximity)) {
        result.add(id);
      }
    }
    return result;
  }

  private checkProximity(
    terms: string[],
    positions: Map<string, number[]>,
    maxDistance: number,
  ): boolean {
    if (terms.length < 2) return true;

    const firstPositions = positions.get(terms[0]) ?? [];
    for (const pos of firstPositions) {
      let allNear = true;
      for (let i = 1; i < terms.length; i++) {
        const termPositions = positions.get(terms[i]) ?? [];
        const hasNearby = termPositions.some(p => Math.abs(p - pos) <= maxDistance);
        if (!hasNearby) {
          allNear = false;
          break;
        }
      }
      if (allNear) return true;
    }
    return false;
  }

  private applyFilters(docIds: Set<string>, filters: SearchFilter[]): Set<string> {
    if (filters.length === 0) return docIds;

    const result = new Set<string>();
    for (const id of docIds) {
      const doc = this.documents.get(id)!;
      let matches = true;

      for (const filter of filters) {
        const value = (doc.metadata as Record<string, unknown>)[filter.field] ??
          (doc as Record<string, unknown>)[filter.field];

        if (!this.matchesFilter(value, filter)) {
          matches = false;
          break;
        }
      }

      if (matches) result.add(id);
    }
    return result;
  }

  private matchesFilter(value: unknown, filter: SearchFilter): boolean {
    if (value === undefined || value === null) return false;

    switch (filter.operator) {
      case 'eq': return value === filter.value;
      case 'ne': return value !== filter.value;
      case 'gt': return typeof value === 'number' && value > (filter.value as number);
      case 'lt': return typeof value === 'number' && value < (filter.value as number);
      case 'gte': return typeof value === 'number' && value >= (filter.value as number);
      case 'lte': return typeof value === 'number' && value <= (filter.value as number);
      case 'in': return Array.isArray(filter.value) && filter.value.includes(String(value));
      case 'contains':
        return typeof value === 'string' &&
          value.toLowerCase().includes(String(filter.value).toLowerCase());
      default:
        return false;
    }
  }

  private applyDateRange(docIds: Set<string>, range: { from?: number; to?: number }): Set<string> {
    const result = new Set<string>();
    for (const id of docIds) {
      const doc = this.documents.get(id)!;
      const ts = doc.createdAt ?? 0;
      if (range.from !== undefined && ts < range.from) continue;
      if (range.to !== undefined && ts > range.to) continue;
      result.add(id);
    }
    return result;
  }

  private applyTagFilter(docIds: Set<string>, tags: string[]): Set<string> {
    const result = new Set<string>();
    for (const id of docIds) {
      const doc = this.documents.get(id)!;
      const docTags = doc.tags.map(t => t.toLowerCase());
      const hasAllTags = tags.every(t => docTags.includes(t.toLowerCase()));
      if (hasAllTags) result.add(id);
    }
    return result;
  }

  // ─── Scoring ─────────────────────────────────────────────────────────────

  private scoreResults(docIds: Set<string>, queryTerms: string[], query: SearchQuery): SearchResult[] {
    const results: SearchResult[] = [];
    const highlight = query.highlight !== false;
    const snippetLength = query.snippetLength ?? this.config.defaultSnippetLength;

    for (const id of docIds) {
      const doc = this.documents.get(id)!;

      // Calculate TF-IDF-like score
      let score = 0;
      const totalDocs = this.documents.size || 1;

      for (const term of queryTerms) {
        const termDocs = this.invertedIndex.get(term)?.size ?? 0;
        if (termDocs === 0) continue;

        const idf = Math.log(totalDocs / termDocs);
        const titleText = doc.title.toLowerCase();
        const bodyText = doc.body.toLowerCase();

        // Term frequency in title (weighted higher)
        const titleTf = (titleText.match(new RegExp(this.escapeRegex(term), 'g')) ?? []).length;
        // Term frequency in body
        const bodyTf = (bodyText.match(new RegExp(this.escapeRegex(term), 'g')) ?? []).length;

        score += (titleTf * 3 + bodyTf) * idf;
      }

      // Apply collection weight
      const collConfig = this.config.collections.find(c => c.collection === doc.collection);
      const collWeight = collConfig?.weight ?? 5;
      score *= (collWeight / 10);

      // Apply document boost
      if (doc.boost) {
        score *= doc.boost;
      }

      // Apply recency boost (newer docs slightly preferred)
      const ageMs = Date.now() - (doc.createdAt ?? 0);
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      const recencyBoost = Math.max(0.5, 1 - (ageDays / 365)); // decay over 1 year
      score *= recencyBoost;

      // Generate highlights and snippet
      const highlights: SearchHighlight[] = [];
      let snippet = '';

      if (highlight) {
        const { fragmentsMap, generatedSnippet } = this.generateHighlights(doc, queryTerms, snippetLength);
        for (const [field, fragments] of Object.entries(fragmentsMap)) {
          if (fragments.length > 0) {
            highlights.push({ field, fragments });
          }
        }
        snippet = generatedSnippet;
      } else {
        snippet = doc.body.slice(0, snippetLength);
        if (doc.body.length > snippetLength) snippet += '...';
      }

      results.push({
        id: doc.id,
        collection: doc.collection,
        title: doc.title,
        snippet,
        score: Math.round(score * 1000) / 1000,
        highlights,
        metadata: doc.metadata,
        createdAt: doc.createdAt ?? 0,
        updatedAt: doc.updatedAt,
        tags: doc.tags,
      });
    }

    return results;
  }

  private generateHighlights(
    doc: IndexDocument,
    queryTerms: string[],
    snippetLength: number,
  ): { fragmentsMap: Record<string, string[]>; generatedSnippet: string } {
    const { open, close } = this.config.highlightTag;
    const fragmentsMap: Record<string, string[]> = {};

    // Highlight title
    let highlightedTitle = doc.title;
    for (const term of queryTerms) {
      const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');
      highlightedTitle = highlightedTitle.replace(regex, `${open}$1${close}`);
    }
    if (highlightedTitle !== doc.title) {
      fragmentsMap['title'] = [highlightedTitle];
    }

    // Find best snippet from body
    const bodyLower = doc.body.toLowerCase();
    let bestStart = 0;
    let bestScore = 0;

    // Slide a window across the body to find the best snippet
    const windowSize = snippetLength;
    for (let i = 0; i < doc.body.length; i += 20) {
      let windowScore = 0;
      const windowText = bodyLower.slice(i, i + windowSize);
      for (const term of queryTerms) {
        const matches = (windowText.match(new RegExp(this.escapeRegex(term), 'g')) ?? []).length;
        windowScore += matches;
      }
      if (windowScore > bestScore) {
        bestScore = windowScore;
        bestStart = i;
      }
    }

    let snippet = doc.body.slice(bestStart, bestStart + windowSize);
    if (bestStart > 0) snippet = '...' + snippet;
    if (bestStart + windowSize < doc.body.length) snippet += '...';

    // Highlight snippet
    let highlightedSnippet = snippet;
    for (const term of queryTerms) {
      const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');
      highlightedSnippet = highlightedSnippet.replace(regex, `${open}$1${close}`);
    }

    if (highlightedSnippet !== snippet) {
      fragmentsMap['body'] = [highlightedSnippet];
    }

    return { fragmentsMap, generatedSnippet: highlightedSnippet };
  }

  private sortResults(results: SearchResult[], sort?: { field: SortField; order: SortOrder }): SearchResult[] {
    const field = sort?.field ?? 'relevance';
    const order = sort?.order ?? 'desc';

    results.sort((a, b) => {
      let cmp = 0;
      switch (field) {
        case 'relevance':
          cmp = a.score - b.score;
          break;
        case 'date':
          cmp = a.createdAt - b.createdAt;
          break;
        case 'name':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'collection':
          cmp = a.collection.localeCompare(b.collection);
          break;
        default:
          cmp = a.score - b.score;
      }
      return order === 'desc' ? -cmp : cmp;
    });

    return results;
  }

  // ─── Facets ──────────────────────────────────────────────────────────────

  private calculateFacets(docIds: Set<string>, facetFields: string[]): SearchFacet[] {
    if (facetFields.length === 0) {
      // Default: collection facet
      return [this.calculateCollectionFacet(docIds)];
    }

    const facets: SearchFacet[] = [];

    for (const field of facetFields) {
      if (field === 'collection') {
        facets.push(this.calculateCollectionFacet(docIds));
        continue;
      }

      if (field === 'tags') {
        facets.push(this.calculateTagFacet(docIds));
        continue;
      }

      // Generic field facet
      const buckets = new Map<string, number>();
      for (const id of docIds) {
        const doc = this.documents.get(id)!;
        const value = (doc.metadata as Record<string, unknown>)[field];
        if (value !== undefined && value !== null) {
          const key = String(value);
          buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
      }

      facets.push({
        name: field,
        buckets: [...buckets.entries()]
          .map(([value, count]) => ({ value, count, selected: false }))
          .sort((a, b) => b.count - a.count),
      });
    }

    return facets;
  }

  private calculateCollectionFacet(docIds: Set<string>): SearchFacet {
    const buckets = new Map<string, number>();
    for (const id of docIds) {
      const doc = this.documents.get(id)!;
      buckets.set(doc.collection, (buckets.get(doc.collection) ?? 0) + 1);
    }

    return {
      name: 'collection',
      buckets: [...buckets.entries()]
        .map(([value, count]) => ({ value, count, selected: false }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private calculateTagFacet(docIds: Set<string>): SearchFacet {
    const buckets = new Map<string, number>();
    for (const id of docIds) {
      const doc = this.documents.get(id)!;
      for (const tag of doc.tags) {
        buckets.set(tag, (buckets.get(tag) ?? 0) + 1);
      }
    }

    return {
      name: 'tags',
      buckets: [...buckets.entries()]
        .map(([value, count]) => ({ value, count, selected: false }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // ─── Suggestions ─────────────────────────────────────────────────────────

  getSuggestions(queryText: string): string[] {
    const suggestions: SearchSuggestion[] = [];
    const normalQuery = queryText.toLowerCase().trim();
    if (!normalQuery) return [];

    // From search history
    const seenQueries = new Set<string>();
    for (const entry of this.searchHistory) {
      const historyQuery = entry.query.toLowerCase();
      if (historyQuery.startsWith(normalQuery) && historyQuery !== normalQuery && !seenQueries.has(historyQuery)) {
        seenQueries.add(historyQuery);
        suggestions.push({
          text: entry.query,
          source: 'history',
          score: 0.8,
        });
      }
    }

    // From popular queries
    for (const [query, data] of this.queryPopularity) {
      const popQuery = query.toLowerCase();
      if (popQuery.startsWith(normalQuery) && popQuery !== normalQuery && !seenQueries.has(popQuery)) {
        seenQueries.add(popQuery);
        suggestions.push({
          text: query,
          source: 'popular',
          score: 0.6 + (data.count / 100),
        });
      }
    }

    // From indexed terms (autocomplete)
    const queryTerms = this.tokenize(normalQuery);
    const lastTerm = queryTerms[queryTerms.length - 1];
    if (lastTerm) {
      for (const term of this.invertedIndex.keys()) {
        if (term.startsWith(lastTerm) && term !== lastTerm && !seenQueries.has(term)) {
          seenQueries.add(term);
          suggestions.push({
            text: queryTerms.slice(0, -1).concat(term).join(' '),
            source: 'autocomplete',
            score: 0.4,
          });
          if (suggestions.length > this.config.suggestionsLimit * 2) break;
        }
      }
    }

    // Sort by score and limit
    suggestions.sort((a, b) => b.score - a.score);
    return suggestions.slice(0, this.config.suggestionsLimit).map(s => s.text);
  }

  // ─── Saved Searches ──────────────────────────────────────────────────────

  saveSearch(userId: string, name: string, query: SearchQuery, notifyOnNew: boolean = false): SavedSearch {
    const saved: SavedSearch = {
      id: `ss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      name,
      query,
      notifyOnNew,
      lastRunAt: Date.now(),
      lastResultCount: 0,
      createdAt: Date.now(),
    };

    this.savedSearches.set(saved.id, saved);
    this.emit('search:saved', { id: saved.id, userId, name });
    return saved;
  }

  runSavedSearch(searchId: string): SearchResponse | null {
    const saved = this.savedSearches.get(searchId);
    if (!saved) return null;

    const response = this.search(saved.query);
    saved.lastRunAt = Date.now();
    saved.lastResultCount = response.total;

    return response;
  }

  getSavedSearches(userId: string): SavedSearch[] {
    return [...this.savedSearches.values()].filter(s => s.userId === userId);
  }

  deleteSavedSearch(searchId: string): boolean {
    return this.savedSearches.delete(searchId);
  }

  checkNewResults(searchId: string): { hasNew: boolean; newCount: number } {
    const saved = this.savedSearches.get(searchId);
    if (!saved) return { hasNew: false, newCount: 0 };

    const response = this.search({ ...saved.query, dateRange: { from: saved.lastRunAt } });
    return {
      hasNew: response.total > 0,
      newCount: response.total,
    };
  }

  // ─── History ─────────────────────────────────────────────────────────────

  private recordSearch(entry: SearchHistoryEntry): void {
    this.searchHistory.push(entry);
    if (this.searchHistory.length > this.config.historyLimit) {
      this.searchHistory = this.searchHistory.slice(-this.config.historyLimit);
    }

    // Update popularity
    const normalQuery = entry.query.toLowerCase().trim();
    const pop = this.queryPopularity.get(normalQuery) ?? { count: 0, lastUsed: 0 };
    pop.count++;
    pop.lastUsed = entry.timestamp;
    this.queryPopularity.set(normalQuery, pop);

    // Track stats
    this.totalSearches++;
    this.totalResultCounts += entry.resultCount;
    if (entry.resultCount === 0) {
      this.zeroResultCount++;
    }
  }

  recordClick(query: string, resultId: string): void {
    const entry = [...this.searchHistory].reverse().find(h => h.query === query);
    if (entry) {
      entry.clickedResultId = resultId;
    }
    this.emit('search:click', { query, resultId });
  }

  getSearchHistory(userId?: string, limit: number = 20): SearchHistoryEntry[] {
    let history = this.searchHistory;
    if (userId) {
      history = history.filter(h => h.userId === userId);
    }
    return history.slice(-limit).reverse();
  }

  clearHistory(userId?: string): number {
    if (userId) {
      const before = this.searchHistory.length;
      this.searchHistory = this.searchHistory.filter(h => h.userId !== userId);
      return before - this.searchHistory.length;
    }
    const count = this.searchHistory.length;
    this.searchHistory = [];
    return count;
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  getStats(): SearchStats {
    const docsByCollection: Record<string, number> = {};
    for (const [collection, ids] of this.collectionIndex) {
      docsByCollection[collection] = ids.size;
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const todaySearches = this.searchHistory.filter(h => now - h.timestamp < dayMs).length;

    // Popular queries (within window)
    const windowStart = now - this.config.popularQueryWindow;
    const recentPopularity = new Map<string, number>();
    for (const entry of this.searchHistory) {
      if (entry.timestamp >= windowStart) {
        const q = entry.query.toLowerCase().trim();
        recentPopularity.set(q, (recentPopularity.get(q) ?? 0) + 1);
      }
    }
    const popularQueries = [...recentPopularity.entries()]
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalDocuments: this.documents.size,
      documentsByCollection: docsByCollection,
      totalSearches: this.totalSearches,
      averageResultCount: this.totalSearches > 0
        ? Math.round(this.totalResultCounts / this.totalSearches)
        : 0,
      zeroResultQueries: this.zeroResultCount,
      averageSearchTime: this.totalSearches > 0
        ? Math.round(this.totalSearchTime / this.totalSearches)
        : 0,
      popularQueries,
      searchesPerDay: todaySearches,
    };
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  getDocument(id: string): IndexDocument | undefined {
    return this.documents.get(id);
  }

  getDocumentCount(collection?: SearchCollection): number {
    if (collection) {
      return this.collectionIndex.get(collection)?.size ?? 0;
    }
    return this.documents.size;
  }

  getCollections(): Array<{ collection: SearchCollection; count: number; enabled: boolean }> {
    return this.config.collections.map(c => ({
      collection: c.collection,
      count: this.collectionIndex.get(c.collection)?.size ?? 0,
      enabled: c.enabled,
    }));
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2)
      .filter(t => !this.config.stopWords.includes(t));
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private emptyResponse(query: string, startTime: number): SearchResponse {
    return {
      query,
      results: [],
      total: 0,
      facets: [],
      suggestions: this.getSuggestions(query),
      took: Date.now() - startTime,
      page: 1,
      pageSize: 20,
      hasMore: false,
    };
  }

  // ─── Voice Summary ───────────────────────────────────────────────────────

  voiceSummary(response: SearchResponse): string {
    if (response.total === 0) {
      return `No results found for "${response.query}". ${
        response.suggestions.length > 0
          ? `Try searching for ${response.suggestions[0]}.`
          : 'Try a different search.'
      }`;
    }

    const parts = [`Found ${response.total} result${response.total === 1 ? '' : 's'} for "${response.query}".`];

    // Top result
    const top = response.results[0];
    parts.push(`Top result: ${top.title} in ${top.collection}.`);

    // Collection breakdown
    const collectionFacet = response.facets.find(f => f.name === 'collection');
    if (collectionFacet && collectionFacet.buckets.length > 1) {
      const breakdown = collectionFacet.buckets
        .slice(0, 3)
        .map(b => `${b.count} in ${b.value}`)
        .join(', ');
      parts.push(breakdown + '.');
    }

    return parts.join(' ');
  }

  // ─── Serialization ───────────────────────────────────────────────────────

  exportState(): {
    documents: IndexDocument[];
    savedSearches: SavedSearch[];
    history: SearchHistoryEntry[];
  } {
    return {
      documents: [...this.documents.values()],
      savedSearches: [...this.savedSearches.values()],
      history: this.searchHistory,
    };
  }

  importState(state: {
    documents?: IndexDocument[];
    savedSearches?: SavedSearch[];
    history?: SearchHistoryEntry[];
  }): void {
    if (state.documents) {
      for (const doc of state.documents) {
        this.index(doc);
      }
    }
    if (state.savedSearches) {
      for (const saved of state.savedSearches) {
        this.savedSearches.set(saved.id, saved);
      }
    }
    if (state.history) {
      this.searchHistory = state.history;
    }
  }
}
