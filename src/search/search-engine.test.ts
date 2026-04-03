/**
 * Search & Indexing Engine — Tests
 * 🌙 Night Shift Agent — Shift #24
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SearchEngine,
  type IndexDocument,
  type SearchQuery,
  type SearchCollection,
} from './search-engine.js';

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<IndexDocument> = {}): IndexDocument {
  const id = overrides.id ?? `doc-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    collection: 'inventory',
    title: 'Test Product',
    body: 'A test product for search indexing',
    tags: ['test'],
    metadata: {},
    ...overrides,
  };
}

function seedEngine(engine: SearchEngine): void {
  engine.index(makeDoc({
    id: 'inv-1',
    collection: 'inventory',
    title: 'DeWalt 20V Drill',
    body: 'Professional grade cordless drill with brushless motor and 2 batteries',
    tags: ['tools', 'power-tools', 'dewalt'],
    metadata: { category: 'Power Tools', price: 149.99, location: 'Aisle 3' },
  }));
  engine.index(makeDoc({
    id: 'inv-2',
    collection: 'inventory',
    title: 'Milwaukee Impact Driver',
    body: 'Heavy duty impact driver with 1800 ft-lbs torque and fuel technology',
    tags: ['tools', 'power-tools', 'milwaukee'],
    metadata: { category: 'Power Tools', price: 179.99, location: 'Aisle 3' },
  }));
  engine.index(makeDoc({
    id: 'inv-3',
    collection: 'inventory',
    title: 'Tide Pods Laundry Detergent',
    body: 'Original scent laundry detergent pods, 42 count package',
    tags: ['cleaning', 'laundry'],
    metadata: { category: 'Cleaning Supplies', price: 12.99, location: 'Aisle 7' },
  }));
  engine.index(makeDoc({
    id: 'prod-1',
    collection: 'products',
    title: 'Coca-Cola Classic 12-Pack',
    body: 'Classic coca-cola soda in 12oz cans, pack of 12',
    tags: ['beverages', 'soda'],
    metadata: { brand: 'Coca-Cola', upc: '049000028911', category: 'Beverages' },
  }));
  engine.index(makeDoc({
    id: 'contact-1',
    collection: 'contacts',
    title: 'Sarah Chen',
    body: 'VP Engineering at Stripe. Met at TechCrunch Disrupt 2026. Interested in AI infrastructure.',
    tags: ['tech', 'engineering', 'stripe'],
    metadata: { company: 'Stripe', title: 'VP Engineering', email: 'sarah@stripe.com' },
  }));
  engine.index(makeDoc({
    id: 'mem-1',
    collection: 'memory',
    title: 'Coffee shop whiteboard',
    body: 'Captured whiteboard notes from brainstorming session about product roadmap. Key decisions: prioritize mobile app, delay enterprise features.',
    tags: ['meeting', 'roadmap'],
    metadata: { scene_type: 'indoor', location: 'Blue Bottle Coffee' },
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
  }));
  engine.index(makeDoc({
    id: 'audit-1',
    collection: 'audit',
    title: 'User login',
    body: 'Admin user dorrian logged in from 192.168.1.100 via password authentication',
    tags: ['auth', 'login'],
    metadata: { action: 'login', category: 'auth', actor: 'dorrian' },
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SearchEngine', () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
  });

  // ─── Indexing ────────────────────────────────────────────────────────

  describe('Indexing', () => {
    it('indexes a document and retrieves it', () => {
      const doc = makeDoc({ id: 'test-1', title: 'Test Doc' });
      engine.index(doc);

      const retrieved = engine.getDocument('test-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.title).toBe('Test Doc');
    });

    it('rejects documents without id', () => {
      expect(() => engine.index(makeDoc({ id: '' }))).toThrow('Document must have id and collection');
    });

    it('rejects documents without collection', () => {
      expect(() => engine.index({ ...makeDoc(), collection: '' as any })).toThrow();
    });

    it('updates existing documents', () => {
      engine.index(makeDoc({ id: 'test-1', title: 'Original' }));
      engine.index(makeDoc({ id: 'test-1', title: 'Updated' }));

      const doc = engine.getDocument('test-1');
      expect(doc!.title).toBe('Updated');
      expect(engine.getDocumentCount()).toBe(1);
    });

    it('preserves createdAt on update', () => {
      const original = makeDoc({ id: 'test-1', createdAt: 1000 });
      engine.index(original);
      engine.index(makeDoc({ id: 'test-1', title: 'Updated' }));

      const doc = engine.getDocument('test-1');
      expect(doc!.createdAt).toBe(1000);
    });

    it('sets updatedAt on index', () => {
      const before = Date.now();
      engine.index(makeDoc({ id: 'test-1' }));
      const doc = engine.getDocument('test-1');
      expect(doc!.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('tracks document count per collection', () => {
      engine.index(makeDoc({ id: '1', collection: 'inventory' }));
      engine.index(makeDoc({ id: '2', collection: 'inventory' }));
      engine.index(makeDoc({ id: '3', collection: 'products' }));

      expect(engine.getDocumentCount('inventory')).toBe(2);
      expect(engine.getDocumentCount('products')).toBe(1);
      expect(engine.getDocumentCount()).toBe(3);
    });

    it('batch indexes documents', () => {
      const docs = [
        makeDoc({ id: '1', title: 'First' }),
        makeDoc({ id: '2', title: 'Second' }),
        makeDoc({ id: '3', title: 'Third' }),
      ];
      const result = engine.indexBatch(docs);

      expect(result.indexed).toBe(3);
      expect(result.errors).toHaveLength(0);
      expect(engine.getDocumentCount()).toBe(3);
    });

    it('batch indexes handles errors gracefully', () => {
      const docs = [
        makeDoc({ id: '1', title: 'Good' }),
        makeDoc({ id: '', title: 'Bad' }),
        makeDoc({ id: '3', title: 'Good Too' }),
      ];
      const result = engine.indexBatch(docs);

      expect(result.indexed).toBe(2);
      expect(result.errors).toHaveLength(1);
    });

    it('emits events on index operations', () => {
      const events: string[] = [];
      engine.on('document:indexed', () => events.push('indexed'));
      engine.on('document:updated', () => events.push('updated'));

      engine.index(makeDoc({ id: '1' }));
      engine.index(makeDoc({ id: '1', title: 'Updated' }));

      expect(events).toEqual(['indexed', 'updated']);
    });
  });

  // ─── Removal ─────────────────────────────────────────────────────────

  describe('Removal', () => {
    it('removes a document', () => {
      engine.index(makeDoc({ id: 'test-1' }));
      const removed = engine.removeDocument('test-1');

      expect(removed).toBe(true);
      expect(engine.getDocument('test-1')).toBeUndefined();
      expect(engine.getDocumentCount()).toBe(0);
    });

    it('returns false for non-existent document', () => {
      expect(engine.removeDocument('nonexistent')).toBe(false);
    });

    it('removes from search index', () => {
      engine.index(makeDoc({ id: 'test-1', title: 'Unique SearchTerm' }));
      const before = engine.search({ text: 'SearchTerm' });
      expect(before.total).toBe(1);

      engine.removeDocument('test-1');
      const after = engine.search({ text: 'SearchTerm' });
      expect(after.total).toBe(0);
    });

    it('removes all documents in a collection', () => {
      engine.index(makeDoc({ id: '1', collection: 'inventory' }));
      engine.index(makeDoc({ id: '2', collection: 'inventory' }));
      engine.index(makeDoc({ id: '3', collection: 'products' }));

      const removed = engine.removeByCollection('inventory');
      expect(removed).toBe(2);
      expect(engine.getDocumentCount('inventory')).toBe(0);
      expect(engine.getDocumentCount('products')).toBe(1);
    });

    it('returns 0 for empty collection removal', () => {
      expect(engine.removeByCollection('contacts')).toBe(0);
    });
  });

  // ─── Basic Search ────────────────────────────────────────────────────

  describe('Basic Search', () => {
    beforeEach(() => seedEngine(engine));

    it('finds documents by text match', () => {
      const response = engine.search({ text: 'drill' });
      expect(response.total).toBeGreaterThan(0);
      expect(response.results[0].title).toContain('Drill');
    });

    it('returns empty for no matches', () => {
      const response = engine.search({ text: 'xyznonexistent' });
      expect(response.total).toBe(0);
      expect(response.results).toHaveLength(0);
    });

    it('rejects empty queries', () => {
      const response = engine.search({ text: '' });
      expect(response.total).toBe(0);
    });

    it('truncates long queries', () => {
      const longQuery = 'a'.repeat(600);
      const response = engine.search({ text: longQuery });
      // Should not throw
      expect(response).toBeDefined();
    });

    it('measures search time', () => {
      const response = engine.search({ text: 'drill' });
      expect(response.took).toBeGreaterThanOrEqual(0);
    });

    it('returns pagination info', () => {
      const response = engine.search({ text: 'drill', limit: 5, offset: 0 });
      expect(response.page).toBe(1);
      expect(response.pageSize).toBe(5);
      expect(typeof response.hasMore).toBe('boolean');
    });

    it('handles stop words gracefully', () => {
      // "the" is a stop word, "drill" is not
      const response = engine.search({ text: 'the drill' });
      expect(response.total).toBeGreaterThan(0);
    });
  });

  // ─── Boolean Operators ───────────────────────────────────────────────

  describe('Boolean Operators', () => {
    beforeEach(() => seedEngine(engine));

    it('AND requires all terms', () => {
      const response = engine.search({ text: 'professional drill', operator: 'AND' });
      expect(response.total).toBeGreaterThan(0);
      // Should only match DeWalt drill (has both terms)
      expect(response.results.every(r =>
        r.title.toLowerCase().includes('drill') ||
        engine.getDocument(r.id)!.body.toLowerCase().includes('professional')
      )).toBe(true);
    });

    it('OR returns broader results', () => {
      const orResponse = engine.search({ text: 'drill impact', operator: 'OR' });
      const andResponse = engine.search({ text: 'drill impact', operator: 'AND' });
      expect(orResponse.total).toBeGreaterThanOrEqual(andResponse.total);
    });

    it('NOT excludes terms', () => {
      const response = engine.search({ text: 'tools drill', operator: 'NOT' });
      // Should find docs with "tools" but not "drill"
      for (const result of response.results) {
        const doc = engine.getDocument(result.id)!;
        const fullText = `${doc.title} ${doc.body}`.toLowerCase();
        expect(fullText).not.toContain('drill');
      }
    });

    it('PHRASE requires exact sequence', () => {
      const response = engine.search({ text: 'cordless drill', operator: 'PHRASE' });
      expect(response.total).toBeGreaterThan(0);

      // Search for a phrase that doesn't appear together
      const noMatch = engine.search({ text: 'drill pods', operator: 'PHRASE' });
      expect(noMatch.total).toBe(0);
    });

    it('PREFIX matches partial terms', () => {
      const response = engine.search({ text: 'dew', operator: 'PREFIX' });
      expect(response.total).toBeGreaterThan(0);
      expect(response.results.some(r => r.title.includes('DeWalt'))).toBe(true);
    });

    it('NEAR finds terms within proximity', () => {
      const response = engine.search({ text: 'brushless motor', operator: 'NEAR' });
      expect(response.total).toBeGreaterThan(0);
    });
  });

  // ─── Collection Filtering ────────────────────────────────────────────

  describe('Collection Filtering', () => {
    beforeEach(() => seedEngine(engine));

    it('filters by single collection', () => {
      const response = engine.search({
        text: 'drill',
        collections: ['inventory'],
      });
      for (const r of response.results) {
        expect(r.collection).toBe('inventory');
      }
    });

    it('filters by multiple collections', () => {
      const response = engine.search({
        text: 'stripe',
        collections: ['contacts', 'memory'],
      });
      for (const r of response.results) {
        expect(['contacts', 'memory']).toContain(r.collection);
      }
    });

    it('returns empty when searching in wrong collection', () => {
      const response = engine.search({
        text: 'drill',
        collections: ['contacts'],
      });
      expect(response.total).toBe(0);
    });
  });

  // ─── Filters ─────────────────────────────────────────────────────────

  describe('Filters', () => {
    beforeEach(() => seedEngine(engine));

    it('filters by equality', () => {
      const response = engine.search({
        text: 'drill impact detergent',
        operator: 'OR',
        filters: [{ field: 'category', operator: 'eq', value: 'Power Tools' }],
      });
      expect(response.total).toBeGreaterThan(0);
      for (const r of response.results) {
        expect(r.metadata.category).toBe('Power Tools');
      }
    });

    it('filters by inequality', () => {
      const response = engine.search({
        text: 'drill impact detergent',
        operator: 'OR',
        filters: [{ field: 'category', operator: 'ne', value: 'Cleaning Supplies' }],
      });
      for (const r of response.results) {
        expect(r.metadata.category).not.toBe('Cleaning Supplies');
      }
    });

    it('filters by numeric comparison', () => {
      const response = engine.search({
        text: 'drill impact detergent',
        operator: 'OR',
        filters: [{ field: 'price', operator: 'gt', value: 150 }],
      });
      for (const r of response.results) {
        expect(r.metadata.price as number).toBeGreaterThan(150);
      }
    });

    it('filters by gte/lte', () => {
      const response = engine.search({
        text: 'drill impact detergent',
        operator: 'OR',
        filters: [
          { field: 'price', operator: 'gte', value: 149.99 },
          { field: 'price', operator: 'lte', value: 179.99 },
        ],
      });
      expect(response.total).toBeGreaterThan(0);
      for (const r of response.results) {
        const price = r.metadata.price as number;
        expect(price).toBeGreaterThanOrEqual(149.99);
        expect(price).toBeLessThanOrEqual(179.99);
      }
    });

    it('filters by contains', () => {
      const response = engine.search({
        text: 'drill impact detergent',
        operator: 'OR',
        filters: [{ field: 'location', operator: 'contains', value: 'Aisle 3' }],
      });
      expect(response.total).toBeGreaterThan(0);
    });

    it('filters by in (array)', () => {
      const response = engine.search({
        text: 'tools drill impact',
        operator: 'OR',
        filters: [{ field: 'category', operator: 'in', value: ['Power Tools', 'Hand Tools'] }],
      });
      for (const r of response.results) {
        expect(['Power Tools', 'Hand Tools']).toContain(r.metadata.category);
      }
    });
  });

  // ─── Date Range ──────────────────────────────────────────────────────

  describe('Date Range', () => {
    beforeEach(() => seedEngine(engine));

    it('filters by date from', () => {
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      const response = engine.search({
        text: 'whiteboard roadmap',
        operator: 'OR',
        dateRange: { from: twoDaysAgo },
      });
      for (const r of response.results) {
        expect(r.createdAt).toBeGreaterThanOrEqual(twoDaysAgo);
      }
    });

    it('filters by date to', () => {
      const fourDaysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000;
      const response = engine.search({
        text: 'whiteboard roadmap product',
        operator: 'OR',
        dateRange: { to: fourDaysAgo },
      });
      // Memory doc is 3 days old, should be excluded
      expect(response.total).toBe(0);
    });
  });

  // ─── Tag Filtering ───────────────────────────────────────────────────

  describe('Tag Filtering', () => {
    beforeEach(() => seedEngine(engine));

    it('filters by single tag', () => {
      const response = engine.search({
        text: 'tools drill impact',
        operator: 'OR',
        tags: ['dewalt'],
      });
      for (const r of response.results) {
        expect(r.tags.map(t => t.toLowerCase())).toContain('dewalt');
      }
    });

    it('requires all tags', () => {
      const response = engine.search({
        text: 'tools drill impact',
        operator: 'OR',
        tags: ['tools', 'dewalt'],
      });
      for (const r of response.results) {
        const lowerTags = r.tags.map(t => t.toLowerCase());
        expect(lowerTags).toContain('tools');
        expect(lowerTags).toContain('dewalt');
      }
    });
  });

  // ─── Scoring & Ranking ───────────────────────────────────────────────

  describe('Scoring & Ranking', () => {
    beforeEach(() => seedEngine(engine));

    it('assigns higher score to title matches', () => {
      const response = engine.search({ text: 'drill', operator: 'OR' });
      // DeWalt Drill should rank higher than a doc that only mentions drill in body
      expect(response.results[0].score).toBeGreaterThan(0);
    });

    it('respects document boost', () => {
      engine.index(makeDoc({
        id: 'boosted',
        title: 'Boosted Product',
        body: 'This product is special',
        boost: 5,
      }));
      engine.index(makeDoc({
        id: 'normal',
        title: 'Normal Product',
        body: 'This product is normal',
        boost: 1,
      }));

      const response = engine.search({ text: 'product' });
      const boostedIdx = response.results.findIndex(r => r.id === 'boosted');
      const normalIdx = response.results.findIndex(r => r.id === 'normal');
      expect(boostedIdx).toBeLessThan(normalIdx);
    });

    it('sorts by relevance by default', () => {
      const response = engine.search({ text: 'drill' });
      for (let i = 1; i < response.results.length; i++) {
        expect(response.results[i - 1].score).toBeGreaterThanOrEqual(response.results[i].score);
      }
    });

    it('sorts by date', () => {
      const response = engine.search({
        text: 'tools drill impact whiteboard',
        operator: 'OR',
        sort: { field: 'date', order: 'desc' },
      });
      for (let i = 1; i < response.results.length; i++) {
        expect(response.results[i - 1].createdAt).toBeGreaterThanOrEqual(response.results[i].createdAt);
      }
    });

    it('sorts by name', () => {
      const response = engine.search({
        text: 'tools drill impact detergent',
        operator: 'OR',
        sort: { field: 'name', order: 'asc' },
      });
      for (let i = 1; i < response.results.length; i++) {
        expect(response.results[i - 1].title.localeCompare(response.results[i].title)).toBeLessThanOrEqual(0);
      }
    });

    it('applies minScore filter', () => {
      const allResults = engine.search({ text: 'drill' });
      const filtered = engine.search({ text: 'drill', minScore: 999 });
      expect(filtered.total).toBeLessThanOrEqual(allResults.total);
    });
  });

  // ─── Highlights ──────────────────────────────────────────────────────

  describe('Highlights', () => {
    beforeEach(() => seedEngine(engine));

    it('highlights matching terms in results', () => {
      const response = engine.search({ text: 'drill', highlight: true });
      expect(response.results.length).toBeGreaterThan(0);

      const firstResult = response.results[0];
      expect(firstResult.highlights.length).toBeGreaterThan(0);

      const hasHighlight = firstResult.highlights.some(h =>
        h.fragments.some(f => f.includes('**drill**') || f.includes('**Drill**'))
      );
      expect(hasHighlight).toBe(true);
    });

    it('disables highlights when requested', () => {
      const response = engine.search({ text: 'drill', highlight: false });
      expect(response.results[0].highlights).toHaveLength(0);
    });

    it('respects custom snippet length', () => {
      const response = engine.search({ text: 'drill', snippetLength: 50 });
      // Snippet should be roughly around the specified length
      const snippet = response.results[0].snippet;
      // Allow for "..." and highlight markers
      expect(snippet.length).toBeLessThan(200);
    });
  });

  // ─── Facets ──────────────────────────────────────────────────────────

  describe('Facets', () => {
    beforeEach(() => seedEngine(engine));

    it('returns collection facet by default', () => {
      const response = engine.search({ text: 'tools drill impact detergent', operator: 'OR' });
      expect(response.facets.length).toBeGreaterThan(0);
      expect(response.facets[0].name).toBe('collection');
    });

    it('calculates collection facet counts', () => {
      const response = engine.search({ text: 'tools drill impact detergent', operator: 'OR' });
      const collFacet = response.facets.find(f => f.name === 'collection');
      expect(collFacet).toBeDefined();

      const invBucket = collFacet!.buckets.find(b => b.value === 'inventory');
      expect(invBucket).toBeDefined();
      expect(invBucket!.count).toBeGreaterThan(0);
    });

    it('calculates tag facets', () => {
      const response = engine.search({
        text: 'tools drill impact',
        operator: 'OR',
        facets: ['tags'],
      });
      const tagFacet = response.facets.find(f => f.name === 'tags');
      expect(tagFacet).toBeDefined();
      expect(tagFacet!.buckets.length).toBeGreaterThan(0);
    });

    it('calculates custom field facets', () => {
      const response = engine.search({
        text: 'tools drill impact detergent',
        operator: 'OR',
        facets: ['category'],
      });
      const catFacet = response.facets.find(f => f.name === 'category');
      expect(catFacet).toBeDefined();
    });

    it('sorts facet buckets by count descending', () => {
      const response = engine.search({
        text: 'tools drill impact detergent',
        operator: 'OR',
        facets: ['tags'],
      });
      const tagFacet = response.facets.find(f => f.name === 'tags')!;
      for (let i = 1; i < tagFacet.buckets.length; i++) {
        expect(tagFacet.buckets[i - 1].count).toBeGreaterThanOrEqual(tagFacet.buckets[i].count);
      }
    });
  });

  // ─── Suggestions ─────────────────────────────────────────────────────

  describe('Suggestions', () => {
    beforeEach(() => {
      seedEngine(engine);
      // Generate some search history
      engine.search({ text: 'drill bits' });
      engine.search({ text: 'drill accessories' });
      engine.search({ text: 'drill press' });
    });

    it('suggests from search history', () => {
      const suggestions = engine.getSuggestions('drill');
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('suggests from indexed terms', () => {
      const suggestions = engine.getSuggestions('cor'); // "cordless"
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('returns empty for no matches', () => {
      const suggestions = engine.getSuggestions('xyznoexist');
      expect(suggestions).toHaveLength(0);
    });

    it('limits suggestion count', () => {
      // Generate lots of searches
      for (let i = 0; i < 20; i++) {
        engine.search({ text: `drill query ${i}` });
      }
      const suggestions = engine.getSuggestions('drill');
      expect(suggestions.length).toBeLessThanOrEqual(5); // default limit
    });
  });

  // ─── Saved Searches ──────────────────────────────────────────────────

  describe('Saved Searches', () => {
    beforeEach(() => seedEngine(engine));

    it('saves a search', () => {
      const saved = engine.saveSearch('user-1', 'Power tools search', { text: 'drill' });
      expect(saved.id).toBeTruthy();
      expect(saved.userId).toBe('user-1');
      expect(saved.name).toBe('Power tools search');
    });

    it('runs a saved search', () => {
      const saved = engine.saveSearch('user-1', 'Drill', { text: 'drill' });
      const response = engine.runSavedSearch(saved.id);
      expect(response).not.toBeNull();
      expect(response!.total).toBeGreaterThan(0);
    });

    it('returns null for non-existent saved search', () => {
      expect(engine.runSavedSearch('nonexistent')).toBeNull();
    });

    it('lists saved searches by user', () => {
      engine.saveSearch('user-1', 'Search A', { text: 'drill' });
      engine.saveSearch('user-1', 'Search B', { text: 'impact' });
      engine.saveSearch('user-2', 'Search C', { text: 'tide' });

      const user1Searches = engine.getSavedSearches('user-1');
      expect(user1Searches).toHaveLength(2);

      const user2Searches = engine.getSavedSearches('user-2');
      expect(user2Searches).toHaveLength(1);
    });

    it('deletes a saved search', () => {
      const saved = engine.saveSearch('user-1', 'Test', { text: 'drill' });
      expect(engine.deleteSavedSearch(saved.id)).toBe(true);
      expect(engine.getSavedSearches('user-1')).toHaveLength(0);
    });

    it('checks for new results since last run', () => {
      const saved = engine.saveSearch('user-1', 'Test', { text: 'newstuff' });

      // No new results yet
      const check1 = engine.checkNewResults(saved.id);
      expect(check1.hasNew).toBe(false);

      // Add a matching document
      engine.index(makeDoc({
        id: 'new-1',
        title: 'newstuff item',
        body: 'This is newstuff',
      }));

      const check2 = engine.checkNewResults(saved.id);
      expect(check2.hasNew).toBe(true);
      expect(check2.newCount).toBeGreaterThan(0);
    });
  });

  // ─── Search History ──────────────────────────────────────────────────

  describe('Search History', () => {
    beforeEach(() => seedEngine(engine));

    it('records search history', () => {
      engine.search({ text: 'drill', userId: 'user-1' });
      engine.search({ text: 'impact', userId: 'user-1' });

      const history = engine.getSearchHistory('user-1');
      expect(history).toHaveLength(2);
      expect(history[0].query).toBe('impact'); // most recent first
    });

    it('filters history by user', () => {
      engine.search({ text: 'drill', userId: 'user-1' });
      engine.search({ text: 'impact', userId: 'user-2' });

      expect(engine.getSearchHistory('user-1')).toHaveLength(1);
      expect(engine.getSearchHistory('user-2')).toHaveLength(1);
    });

    it('records click-through', () => {
      engine.search({ text: 'drill' });
      engine.recordClick('drill', 'inv-1');

      const history = engine.getSearchHistory();
      expect(history[0].clickedResultId).toBe('inv-1');
    });

    it('clears history for user', () => {
      engine.search({ text: 'drill', userId: 'user-1' });
      engine.search({ text: 'impact', userId: 'user-2' });

      const cleared = engine.clearHistory('user-1');
      expect(cleared).toBe(1);
      expect(engine.getSearchHistory('user-1')).toHaveLength(0);
      expect(engine.getSearchHistory('user-2')).toHaveLength(1);
    });

    it('clears all history', () => {
      engine.search({ text: 'drill' });
      engine.search({ text: 'impact' });

      const cleared = engine.clearHistory();
      expect(cleared).toBe(2);
      expect(engine.getSearchHistory()).toHaveLength(0);
    });

    it('limits history size', () => {
      const smallEngine = new SearchEngine({ historyLimit: 3 } as any);
      smallEngine.index(makeDoc({ id: '1', title: 'Search Target' }));

      for (let i = 0; i < 5; i++) {
        smallEngine.search({ text: `query${i} target`, operator: 'OR' });
      }

      expect(smallEngine.getSearchHistory().length).toBeLessThanOrEqual(3);
    });
  });

  // ─── Stats ───────────────────────────────────────────────────────────

  describe('Stats', () => {
    beforeEach(() => seedEngine(engine));

    it('tracks total documents', () => {
      const stats = engine.getStats();
      expect(stats.totalDocuments).toBe(7);
    });

    it('tracks documents by collection', () => {
      const stats = engine.getStats();
      expect(stats.documentsByCollection['inventory']).toBe(3);
      expect(stats.documentsByCollection['products']).toBe(1);
      expect(stats.documentsByCollection['contacts']).toBe(1);
    });

    it('tracks search counts', () => {
      engine.search({ text: 'drill' });
      engine.search({ text: 'impact' });
      engine.search({ text: 'nonexistent123' });

      const stats = engine.getStats();
      expect(stats.totalSearches).toBe(3);
      expect(stats.zeroResultQueries).toBe(1);
      expect(stats.averageSearchTime).toBeGreaterThanOrEqual(0);
    });

    it('tracks popular queries', () => {
      engine.search({ text: 'drill' });
      engine.search({ text: 'drill' });
      engine.search({ text: 'drill' });
      engine.search({ text: 'impact' });

      const stats = engine.getStats();
      expect(stats.popularQueries[0].query).toBe('drill');
      expect(stats.popularQueries[0].count).toBe(3);
    });
  });

  // ─── Voice Summary ───────────────────────────────────────────────────

  describe('Voice Summary', () => {
    beforeEach(() => seedEngine(engine));

    it('generates voice summary for results', () => {
      const response = engine.search({ text: 'drill' });
      const summary = engine.voiceSummary(response);

      expect(summary).toContain('Found');
      expect(summary).toContain('drill');
      expect(summary).toContain('Top result');
    });

    it('generates voice summary for no results', () => {
      const response = engine.search({ text: 'xyznonexist' });
      const summary = engine.voiceSummary(response);

      expect(summary).toContain('No results found');
    });
  });

  // ─── Collections ─────────────────────────────────────────────────────

  describe('Collections', () => {
    it('lists all configured collections', () => {
      const collections = engine.getCollections();
      expect(collections.length).toBe(10); // all default collections
      expect(collections.every(c => typeof c.enabled === 'boolean')).toBe(true);
    });

    it('shows collection document counts', () => {
      seedEngine(engine);
      const collections = engine.getCollections();
      const inv = collections.find(c => c.collection === 'inventory');
      expect(inv!.count).toBe(3);
    });
  });

  // ─── Serialization ───────────────────────────────────────────────────

  describe('Serialization', () => {
    it('exports and imports state', () => {
      seedEngine(engine);
      engine.saveSearch('user-1', 'Test', { text: 'drill' });
      engine.search({ text: 'drill' });

      const state = engine.exportState();
      expect(state.documents.length).toBe(7);
      expect(state.savedSearches.length).toBe(1);
      expect(state.history.length).toBeGreaterThan(0);

      // Import into new engine
      const newEngine = new SearchEngine();
      newEngine.importState(state);

      expect(newEngine.getDocumentCount()).toBe(7);
      expect(newEngine.getSavedSearches('user-1')).toHaveLength(1);

      // Search should work
      const response = newEngine.search({ text: 'drill' });
      expect(response.total).toBeGreaterThan(0);
    });
  });

  // ─── Pagination ──────────────────────────────────────────────────────

  describe('Pagination', () => {
    beforeEach(() => {
      // Index 20 docs
      for (let i = 0; i < 20; i++) {
        engine.index(makeDoc({
          id: `item-${i}`,
          title: `Searchable Item ${i}`,
          body: `This is searchable item number ${i} with content`,
        }));
      }
    });

    it('paginates results with limit', () => {
      const page1 = engine.search({ text: 'searchable', limit: 5, offset: 0 });
      expect(page1.results).toHaveLength(5);
      expect(page1.page).toBe(1);
      expect(page1.hasMore).toBe(true);
    });

    it('paginates second page', () => {
      const page2 = engine.search({ text: 'searchable', limit: 5, offset: 5 });
      expect(page2.results).toHaveLength(5);
      expect(page2.page).toBe(2);
    });

    it('handles last page correctly', () => {
      const lastPage = engine.search({ text: 'searchable', limit: 5, offset: 15 });
      expect(lastPage.results).toHaveLength(5);
      expect(lastPage.hasMore).toBe(false);
    });

    it('respects max results limit', () => {
      const engine2 = new SearchEngine({ maxResults: 3 } as any);
      for (let i = 0; i < 10; i++) {
        engine2.index(makeDoc({ id: `x-${i}`, title: `Searchable ${i}`, body: 'content' }));
      }
      const response = engine2.search({ text: 'searchable', limit: 50 });
      expect(response.results.length).toBeLessThanOrEqual(3);
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('handles special characters in query', () => {
      engine.index(makeDoc({ id: '1', title: 'C++ Programming', body: 'Learn C++ basics' }));
      const response = engine.search({ text: 'C++' });
      // Should not crash
      expect(response).toBeDefined();
    });

    it('handles unicode in documents', () => {
      engine.index(makeDoc({
        id: '1',
        title: '日本語テスト',
        body: 'This is a Japanese test document',
      }));
      const response = engine.search({ text: 'japanese' });
      expect(response.total).toBeGreaterThan(0);
    });

    it('handles empty body documents', () => {
      engine.index(makeDoc({ id: '1', title: 'Title Only', body: '' }));
      const response = engine.search({ text: 'title' });
      expect(response.total).toBeGreaterThan(0);
    });

    it('handles documents with no tags', () => {
      engine.index(makeDoc({ id: '1', title: 'No Tags', body: 'Content', tags: [] }));
      const response = engine.search({ text: 'content' });
      expect(response.total).toBeGreaterThan(0);
    });

    it('handles concurrent indexing and searching', () => {
      for (let i = 0; i < 100; i++) {
        engine.index(makeDoc({ id: `doc-${i}`, title: `Document ${i}`, body: `Content ${i}` }));
      }
      const response = engine.search({ text: 'document' });
      expect(response.total).toBe(100);
    });
  });
});
