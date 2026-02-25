/**
 * Production Server Entry Point
 *
 * Bootstraps the DashboardApiServer with production hardening:
 * - Structured logging
 * - Rate limiting
 * - CORS configuration
 * - Graceful shutdown
 * - WebSocket keepalive for cloud load balancers
 *
 * Usage:
 *   NODE_ENV=production node dist/server.js
 *
 * This file does NOT modify the core agent logic. It wraps the existing
 * DashboardApiServer and PersistenceLayer with cloud-ready configuration.
 */

import * as path from 'path';
import { PersistenceLayer } from './storage/persistence.js';
import { DashboardApiServer } from './dashboard/api-server.js';
import {
  StructuredLogger,
  RateLimiter,
  startWsKeepalive,
} from './dashboard/production.js';

// ─── Environment Configuration ──────────────────────────────────

const PORT = parseInt(process.env.PORT || '3847', 10);
const HOST = '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATA_DIR = process.env.DATA_DIR || './data';
const LOG_JSON = process.env.LOG_JSON === 'true' || NODE_ENV === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'info' : 'debug');
const CORS_ORIGINS = process.env.CORS_ORIGINS || '*';
const RATE_LIMIT_RPM = parseInt(process.env.RATE_LIMIT_RPM || '0', 10);
const AUTH_TOKEN = process.env.API_AUTH_TOKEN || undefined;

// ─── Bootstrap ──────────────────────────────────────────────────

const logger = new StructuredLogger(LOG_JSON, LOG_LEVEL);

logger.info('Starting Ray-Bans × OpenClaw backend', {
  nodeEnv: NODE_ENV,
  port: PORT,
  dataDir: DATA_DIR,
  logJson: LOG_JSON,
  corsOrigins: CORS_ORIGINS,
  rateLimitRpm: RATE_LIMIT_RPM,
});

// Initialize persistence layer
const persistence = new PersistenceLayer({
  dbPath: path.join(DATA_DIR, 'raybans.sqlite'),
  imageDir: path.join(DATA_DIR, 'images'),
  walMode: true,
});
logger.info('Persistence layer initialized', { dbPath: path.join(DATA_DIR, 'raybans.sqlite') });

// Initialize rate limiter
const rateLimiter = RATE_LIMIT_RPM > 0 ? new RateLimiter(RATE_LIMIT_RPM) : null;
if (rateLimiter) {
  logger.info('Rate limiting enabled', { maxRpm: RATE_LIMIT_RPM });
}

// Initialize API server
const apiServer = new DashboardApiServer(persistence, {
  port: PORT,
  host: HOST,
  corsEnabled: true,
  authToken: AUTH_TOKEN,
  debug: NODE_ENV !== 'production',
});

// Wire up server event logging
apiServer.on('server:started', (port) => {
  logger.info(`🚀 Server listening on http://${HOST}:${port}`, { port });
  logger.info(`   Health check: http://${HOST}:${port}/api/health`);
  logger.info(`   WebSocket:    ws://${HOST}:${port}/api/companion`);
});

apiServer.on('request', (method, path, status) => {
  logger.debug('Request handled', { method, path, status });
});

apiServer.on('error', (message) => {
  logger.error('Server error', { message });
});

apiServer.on('log', (message) => {
  logger.debug(message);
});

// ─── Start Server ───────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    await apiServer.start();

    // Start WebSocket keepalive for cloud load balancer compatibility
    const companionWs = apiServer.getCompanionWs();
    const keepaliveInterval = startWsKeepalive(companionWs, logger, 25_000);

    // Set up graceful shutdown
    // We need access to the underlying http.Server — get it via the stop mechanism
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM — shutting down gracefully');
      clearInterval(keepaliveInterval);
      if (rateLimiter) rateLimiter.dispose();
      await apiServer.stop();
      persistence.close();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT — shutting down gracefully');
      clearInterval(keepaliveInterval);
      if (rateLimiter) rateLimiter.dispose();
      await apiServer.stop();
      persistence.close();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception', { error: err.message, stack: err.stack });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', { reason: String(reason) });
    });

    // Log database stats on startup
    const dbStats = persistence.getDbStats();
    logger.info('Database stats', dbStats);

  } catch (err) {
    logger.error('Failed to start server', { error: String(err) });
    process.exit(1);
  }
}

main();
