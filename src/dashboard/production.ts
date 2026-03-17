/**
 * Production Hardening — CORS, rate limiting, structured logging,
 * graceful shutdown, and WebSocket keepalive for cloud deployment.
 *
 * This module wraps the existing DashboardApiServer with production-grade
 * middleware without modifying the core server code.
 */

import * as http from 'http';
import type { DashboardApiServer } from './api-server.js';
import type { CompanionWebSocketHandler } from './companion-ws.js';

// ─── Configuration ──────────────────────────────────────────────

export interface ProductionConfig {
  /** Allowed CORS origins (comma-separated string or '*') */
  corsOrigins?: string;
  /** Rate limit: max requests per minute per IP (0 = disabled) */
  rateLimitRpm?: number;
  /** Enable structured JSON logging */
  logJson?: boolean;
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** WebSocket ping interval in ms (default: 25000 — below most LB idle timeouts) */
  wsPingIntervalMs?: number;
  /** Graceful shutdown timeout in ms (default: 10000) */
  shutdownTimeoutMs?: number;
}

// ─── Structured Logger ──────────────────────────────────────────

export class StructuredLogger {
  private jsonMode: boolean;
  private level: string;
  private levels = { debug: 0, info: 1, warn: 2, error: 3 };

  constructor(jsonMode = false, level = 'info') {
    this.jsonMode = jsonMode;
    this.level = level;
  }

  private shouldLog(msgLevel: string): boolean {
    return (this.levels[msgLevel as keyof typeof this.levels] ?? 1) >=
           (this.levels[this.level as keyof typeof this.levels] ?? 1);
  }

  log(level: string, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    if (this.jsonMode) {
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...meta,
      };
      console.log(JSON.stringify(entry));
    } else {
      const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
      if (meta && Object.keys(meta).length > 0) {
        console.log(`${prefix} ${message}`, meta);
      } else {
        console.log(`${prefix} ${message}`);
      }
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }
}

// ─── Rate Limiter (in-memory, per-IP) ───────────────────────────

export class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private requests: Map<string, { count: number; resetAt: number }> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(maxRequestsPerMinute: number) {
    this.windowMs = 60_000;
    this.maxRequests = maxRequestsPerMinute;

    // Clean up expired entries every 2 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, entry] of this.requests) {
        if (now > entry.resetAt) {
          this.requests.delete(ip);
        }
      }
    }, 120_000);
  }

  /**
   * Check if request is allowed. Returns true if allowed, false if rate limited.
   */
  check(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let entry = this.requests.get(ip);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.requests.set(ip, entry);
    }

    entry.count++;

    return {
      allowed: entry.count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - entry.count),
      resetAt: entry.resetAt,
    };
  }

  dispose(): void {
    clearInterval(this.cleanupInterval);
    this.requests.clear();
  }
}

// ─── CORS Helper ────────────────────────────────────────────────

export function parseCorsOrigins(origins: string): string[] {
  if (!origins || origins === '*') return ['*'];
  return origins.split(',').map((o) => o.trim()).filter(Boolean);
}

export function setCorsHeaders(
  res: http.ServerResponse,
  origin: string | undefined,
  allowedOrigins: string[],
): void {
  if (allowedOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ─── Graceful Shutdown ──────────────────────────────────────────

export function setupGracefulShutdown(
  server: http.Server,
  apiServer: DashboardApiServer,
  logger: StructuredLogger,
  timeoutMs = 10_000,
): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal} — starting graceful shutdown`, { signal, timeoutMs });

    // Force exit after timeout
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, timeoutMs);

    try {
      // Stop accepting new connections
      await apiServer.stop();
      logger.info('API server stopped');

      // Close HTTP server
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      logger.info('HTTP server closed');

      clearTimeout(forceExit);
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: String(err) });
      clearTimeout(forceExit);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors gracefully
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
    // Don't exit on unhandled rejections — log and continue
  });
}

// ─── Request Logger Middleware ───────────────────────────────────

export function logRequest(
  logger: StructuredLogger,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  startTime: number,
): void {
  const duration = Date.now() - startTime;
  const method = req.method || 'GET';
  const url = req.url || '/';
  const status = res.statusCode;
  const ip = req.socket.remoteAddress || 'unknown';

  logger.info('request', {
    method,
    url,
    status,
    durationMs: duration,
    ip,
    userAgent: req.headers['user-agent'],
  });
}

// ─── WebSocket Keepalive ────────────────────────────────────────

/**
 * Starts a ping interval for WebSocket connections to survive cloud LB idle timeouts.
 * Most cloud load balancers (Railway, Fly, AWS ALB) have a 60s idle timeout.
 * Sending a ping every 25s keeps the connection alive.
 */
export function startWsKeepalive(
  companionWs: CompanionWebSocketHandler,
  logger: StructuredLogger,
  intervalMs = 25_000,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (companionWs.connectedCount > 0) {
      companionWs.broadcastToCompanions({ type: 'pong' });
      logger.debug('WebSocket keepalive ping sent', { clients: companionWs.connectedCount });
    }
  }, intervalMs);
}
