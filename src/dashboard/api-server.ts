/**
 * Dashboard API Server — HTTP endpoint for live inventory monitoring.
 *
 * Provides a REST API that the web dashboard connects to for:
 * - Live inventory session progress
 * - Item listing with search/filter/sort
 * - Session history and reports
 * - Export downloads (CSV, JSON)
 * - Visual memory search
 * - System health status
 *
 * Also serves as a WebSocket hub for real-time updates (image captures,
 * item counts, flags) pushed to the dashboard without polling.
 *
 * Architecture:
 *   Dashboard (Browser) ←→ This API Server ←→ PersistenceLayer + Agents
 */

import * as http from 'http';
import { EventEmitter } from 'eventemitter3';
import { WebSocketServer } from 'ws';
import type {
  InventorySession,
  InventoryItem,
} from '../types.js';
import type { PersistenceLayer, ItemQuery, SessionQuery, MemoryQuery } from '../storage/persistence.js';
import { CompanionWebSocketHandler } from './companion-ws.js';
import type { ContextRouter, SpecialistAgent } from '../routing/context-router.js';

// ─── Configuration ──────────────────────────────────────────────

export interface DashboardApiConfig {
  /** Port to listen on (default: 3847) */
  port: number;
  /** Hostname to bind to (default: '0.0.0.0') */
  host?: string;
  /** Enable CORS for any origin (default: true for local dev) */
  corsEnabled?: boolean;
  /** Optional bearer token for authentication */
  authToken?: string;
  /** Enable debug logging */
  debug?: boolean;
}

const DEFAULT_CONFIG: Partial<DashboardApiConfig> = {
  host: '0.0.0.0',
  corsEnabled: true,
  debug: false,
};

// ─── Events ─────────────────────────────────────────────────────

export interface DashboardApiEvents {
  /** Server started */
  'server:started': (port: number) => void;
  /** Server stopped */
  'server:stopped': () => void;
  /** Request handled */
  'request': (method: string, path: string, status: number) => void;
  /** Error */
  'error': (message: string) => void;
  /** Debug log */
  'log': (message: string) => void;
}

// ─── WebSocket Client Tracking ──────────────────────────────────

interface WSClient {
  id: string;
  res: http.ServerResponse;
  connectedAt: number;
}

// ─── API Server Implementation ──────────────────────────────────

export class DashboardApiServer extends EventEmitter<DashboardApiEvents> {
  private config: Required<DashboardApiConfig>;
  private persistence: PersistenceLayer;
  private server: http.Server | null = null;
  private sseClients: Map<string, WSClient> = new Map();
  private clientIdCounter = 0;

  /** Live session reference — set by the inventory agent when active */
  private liveSession: InventorySession | null = null;
  private liveItems: InventoryItem[] = [];

  /** Companion app WebSocket handler */
  private companionWs: CompanionWebSocketHandler;

  /** Context router reference for companion API endpoints */
  private contextRouter: ContextRouter | null = null;

  constructor(persistence: PersistenceLayer, config: DashboardApiConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<DashboardApiConfig>;
    this.persistence = persistence;
    this.companionWs = new CompanionWebSocketHandler({ debug: config.debug });
  }

  /**
   * Set the context router for companion API endpoints.
   */
  setContextRouter(router: ContextRouter): void {
    this.contextRouter = router;
    this.companionWs.setContextRouter(router);
  }

  /**
   * Get the companion WebSocket handler (for external integration).
   */
  getCompanionWs(): CompanionWebSocketHandler {
    return this.companionWs;
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  /**
   * Start the HTTP server.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.sendError(res, 500, String(err));
        });
      });

      // WebSocket upgrade handler for /api/companion
      const wss = new WebSocketServer({ noServer: true });
      this.server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        if (url.pathname === '/api/companion') {
          wss.handleUpgrade(req, socket as any, head, (ws) => {
            this.companionWs.registerClient(ws);
          });
        } else {
          socket.destroy();
        }
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.log(`Dashboard API listening on http://${this.config.host}:${this.config.port}`);
        this.emit('server:started', this.config.port);
        resolve();
      });

      this.server.on('error', (err) => {
        this.emit('error', `Server error: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Stop the HTTP server.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all SSE connections
      for (const [id, client] of this.sseClients) {
        client.res.end();
        this.sseClients.delete(id);
      }

      if (this.server) {
        this.server.close(() => {
          this.log('Dashboard API stopped');
          this.emit('server:stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // ─── Live Session Updates ───────────────────────────────────

  /**
   * Update the live session state (called by InventoryAgent).
   */
  updateLiveSession(session: InventorySession, items: InventoryItem[]): void {
    this.liveSession = session;
    this.liveItems = items;

    // Push to all SSE clients
    this.broadcast({
      type: 'session:updated',
      session,
      itemCount: items.length,
      totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
    });
  }

  /**
   * Push a real-time event to all connected dashboard clients.
   */
  broadcast(data: Record<string, unknown>): void {
    const payload = `data: ${JSON.stringify(data)}\n\n`;

    for (const [id, client] of this.sseClients) {
      try {
        client.res.write(payload);
      } catch {
        // Client disconnected
        this.sseClients.delete(id);
      }
    }
  }

  /**
   * Push an item update to clients.
   */
  pushItemUpdate(item: InventoryItem): void {
    this.broadcast({
      type: 'item:updated',
      item,
    });
  }

  /**
   * Push a flag alert to clients.
   */
  pushFlag(item: InventoryItem, flag: string): void {
    this.broadcast({
      type: 'item:flagged',
      item,
      flag,
    });
  }

  // ─── Request Routing ────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // CORS
    if (this.config.corsEnabled) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // Auth check
    if (this.config.authToken) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${this.config.authToken}`) {
        this.sendError(res, 401, 'Unauthorized');
        return;
      }
    }

    try {
      // Route matching
      if (pathname === '/api/health' && method === 'GET') {
        await this.handleHealth(req, res);
      } else if (pathname === '/api/live' && method === 'GET') {
        await this.handleLiveSession(req, res);
      } else if (pathname === '/api/live/items' && method === 'GET') {
        await this.handleLiveItems(req, res, url);
      } else if (pathname === '/api/sessions' && method === 'GET') {
        await this.handleListSessions(req, res, url);
      } else if (pathname.startsWith('/api/sessions/') && method === 'GET') {
        const sessionId = pathname.split('/')[3];
        if (pathname.endsWith('/items')) {
          await this.handleSessionItems(req, res, sessionId, url);
        } else if (pathname.endsWith('/export')) {
          await this.handleExport(req, res, sessionId, url);
        } else if (pathname.endsWith('/stats')) {
          await this.handleSessionStats(req, res, sessionId);
        } else {
          await this.handleGetSession(req, res, sessionId);
        }
      } else if (pathname === '/api/memory/search' && method === 'GET') {
        await this.handleMemorySearch(req, res, url);
      } else if (pathname === '/api/memory/browse' && method === 'GET') {
        await this.handleMemoryBrowse(req, res, url);
      } else if (pathname === '/api/memory/stats' && method === 'GET') {
        await this.handleMemoryStats(req, res);
      } else if (pathname === '/api/events' && method === 'GET') {
        await this.handleSSE(req, res);
      } else if (pathname === '/api/agents' && method === 'GET') {
        await this.handleGetAgents(req, res);
      } else if (pathname.startsWith('/api/agents/') && method === 'POST') {
        const agentId = pathname.split('/')[3];
        await this.handleSetAgentEnabled(req, res, agentId);
      } else if (pathname === '/api/routing/stats' && method === 'GET') {
        await this.handleRoutingStats(req, res);
      } else {
        this.sendError(res, 404, `Not found: ${pathname}`);
      }

      this.emit('request', method, pathname, res.statusCode || 200);
    } catch (err) {
      this.sendError(res, 500, String(err));
    }
  }

  // ─── Route Handlers ─────────────────────────────────────────

  private async handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const dbStats = this.persistence.getDbStats();
    this.sendJson(res, {
      status: 'ok',
      uptime: process.uptime(),
      liveSession: this.liveSession ? {
        id: this.liveSession.id,
        status: this.liveSession.status,
        name: this.liveSession.name,
      } : null,
      db: dbStats,
      connectedClients: this.sseClients.size,
    });
  }

  private async handleLiveSession(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.liveSession) {
      this.sendJson(res, { active: false });
      return;
    }

    this.sendJson(res, {
      active: true,
      session: this.liveSession,
      itemCount: this.liveItems.length,
      totalQuantity: this.liveItems.reduce((s, i) => s + i.quantity, 0),
      totalValue: this.liveItems.reduce(
        (s, i) => s + (i.priceOnShelf || 0) * i.quantity,
        0
      ),
      flaggedCount: this.liveItems.filter((i) => i.flags.length > 0).length,
    });
  }

  private async handleLiveItems(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    if (!this.liveSession) {
      this.sendJson(res, { items: [], total: 0 });
      return;
    }

    let items = [...this.liveItems];

    // Filtering
    const category = url.searchParams.get('category');
    if (category) {
      items = items.filter((i) => i.category?.toLowerCase() === category.toLowerCase());
    }

    const aisle = url.searchParams.get('aisle');
    if (aisle) {
      items = items.filter((i) => i.location.aisle === aisle);
    }

    const search = url.searchParams.get('search');
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.brand || '').toLowerCase().includes(q) ||
          i.sku.toLowerCase().includes(q)
      );
    }

    const flagged = url.searchParams.get('flagged');
    if (flagged === 'true') {
      items = items.filter((i) => i.flags.length > 0);
    }

    // Sorting
    const sortBy = url.searchParams.get('sort') || 'name';
    const sortDir = url.searchParams.get('dir') === 'desc' ? -1 : 1;
    items.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortBy) {
        case 'quantity': aVal = a.quantity; bVal = b.quantity; break;
        case 'category': aVal = a.category || ''; bVal = b.category || ''; break;
        case 'confidence': aVal = a.countConfidence; bVal = b.countConfidence; break;
        default: aVal = a.name; bVal = b.name;
      }
      if (typeof aVal === 'string') return aVal.localeCompare(bVal as string) * sortDir;
      return ((aVal as number) - (bVal as number)) * sortDir;
    });

    // Pagination
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const total = items.length;
    items = items.slice(offset, offset + limit);

    this.sendJson(res, { items, total, limit, offset });
  }

  private async handleListSessions(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    const query: SessionQuery = {
      status: (url.searchParams.get('status') as SessionQuery['status']) || undefined,
      storeName: url.searchParams.get('store') || undefined,
      limit: parseInt(url.searchParams.get('limit') || '20'),
      offset: parseInt(url.searchParams.get('offset') || '0'),
    };

    const sessions = this.persistence.listSessions(query);
    this.sendJson(res, { sessions, total: sessions.length });
  }

  private async handleGetSession(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    const session = this.persistence.getSession(sessionId);
    if (!session) {
      this.sendError(res, 404, 'Session not found');
      return;
    }
    this.sendJson(res, { session });
  }

  private async handleSessionItems(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string,
    url: URL
  ): Promise<void> {
    const query: ItemQuery = {
      sessionId,
      category: url.searchParams.get('category') || undefined,
      aisle: url.searchParams.get('aisle') || undefined,
      search: url.searchParams.get('search') || undefined,
      flagged: url.searchParams.get('flagged') === 'true' || undefined,
      sortBy: (url.searchParams.get('sort') as ItemQuery['sortBy']) || undefined,
      sortDirection: (url.searchParams.get('dir') as ItemQuery['sortDirection']) || undefined,
      limit: parseInt(url.searchParams.get('limit') || '100'),
      offset: parseInt(url.searchParams.get('offset') || '0'),
    };

    const items = this.persistence.queryItems(query);
    this.sendJson(res, { items, total: items.length });
  }

  private async handleSessionStats(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    const stats = this.persistence.getSessionStats(sessionId);
    this.sendJson(res, stats);
  }

  private async handleExport(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string,
    url: URL
  ): Promise<void> {
    const format = url.searchParams.get('format') || 'csv';
    const items = this.persistence.getSessionItems(sessionId);
    const session = this.persistence.getSession(sessionId);

    if (!session) {
      this.sendError(res, 404, 'Session not found');
      return;
    }

    if (format === 'json') {
      const data = {
        session,
        items: items.map((item) => ({
          sku: item.sku,
          name: item.name,
          brand: item.brand,
          category: item.category,
          quantity: item.quantity,
          price: item.priceOnShelf,
          location: item.location,
          confidence: item.countConfidence,
          flags: item.flags,
        })),
      };
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="inventory-${sessionId}.json"`);
      res.end(JSON.stringify(data, null, 2));
    } else {
      // CSV export
      const lines: string[] = [];
      lines.push('SKU,Name,Brand,Category,Quantity,Price,Aisle,Shelf,Confidence,Flags');
      for (const item of items) {
        lines.push([
          this.csvEscape(item.sku),
          this.csvEscape(item.name),
          this.csvEscape(item.brand || ''),
          this.csvEscape(item.category || ''),
          String(item.quantity),
          item.priceOnShelf ? `$${item.priceOnShelf.toFixed(2)}` : '',
          item.location.aisle || '',
          item.location.shelf || '',
          `${(item.countConfidence * 100).toFixed(0)}%`,
          item.flags.join('; '),
        ].join(','));
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="inventory-${sessionId}.csv"`);
      res.end(lines.join('\n'));
    }
  }

  private async handleMemorySearch(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    const query = url.searchParams.get('q');
    if (!query) {
      this.sendError(res, 400, 'Missing search query parameter "q"');
      return;
    }

    const limit = parseInt(url.searchParams.get('limit') || '20');
    const results = this.persistence.searchMemory(query, limit);
    this.sendJson(res, { results, query, total: results.length });
  }

  private async handleMemoryBrowse(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    const query: MemoryQuery = {
      sceneType: url.searchParams.get('scene') || undefined,
      startDate: url.searchParams.get('start') || undefined,
      endDate: url.searchParams.get('end') || undefined,
      hasText: url.searchParams.get('hasText') === 'true' || undefined,
      limit: parseInt(url.searchParams.get('limit') || '50'),
      offset: parseInt(url.searchParams.get('offset') || '0'),
    };

    const entries = this.persistence.queryMemory(query);
    this.sendJson(res, { entries, total: entries.length });
  }

  private async handleMemoryStats(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const dbStats = this.persistence.getDbStats();
    this.sendJson(res, {
      totalMemories: dbStats.memories,
      totalImages: dbStats.images,
      totalSessions: dbStats.sessions,
      totalItems: dbStats.items,
      dbSizeBytes: dbStats.dbSizeBytes,
    });
  }

  // ─── Companion / Agent API Handlers ──────────────────────────

  private async handleGetAgents(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!this.contextRouter) {
      this.sendJson(res, { agents: [] });
      return;
    }

    const agents = this.contextRouter.getAgents().map((a: SpecialistAgent) => ({
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      priority: a.priority,
    }));

    this.sendJson(res, { agents });
  }

  private async handleSetAgentEnabled(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    agentId: string,
  ): Promise<void> {
    if (!this.contextRouter) {
      this.sendError(res, 503, 'Context router not available');
      return;
    }

    const body = await this.readBody(req);
    const { enabled } = JSON.parse(body);

    this.contextRouter.setAgentEnabled(agentId, enabled);
    this.sendJson(res, { ok: true, agentId, enabled });
  }

  private async handleRoutingStats(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!this.contextRouter) {
      this.sendJson(res, {});
      return;
    }

    this.sendJson(res, this.contextRouter.getStats());
  }

  private async readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  // ─── SSE (Server-Sent Events) for Real-time Updates ─────────

  private async handleSSE(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientId = `client-${++this.clientIdCounter}`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(this.config.corsEnabled ? { 'Access-Control-Allow-Origin': '*' } : {}),
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

    // Track client
    this.sseClients.set(clientId, {
      id: clientId,
      res,
      connectedAt: Date.now(),
    });

    this.log(`SSE client connected: ${clientId} (${this.sseClients.size} total)`);

    // Handle disconnect
    req.on('close', () => {
      this.sseClients.delete(clientId);
      this.log(`SSE client disconnected: ${clientId} (${this.sseClients.size} total)`);
    });
  }

  // ─── Helpers ────────────────────────────────────────────────

  private sendJson(res: http.ServerResponse, data: unknown): void {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  private sendError(res: http.ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message, status }));
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private log(message: string): void {
    if (this.config.debug) {
      this.emit('log', `[DashboardAPI] ${message}`);
    }
  }
}
