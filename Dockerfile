# ─── Stage 1: Build ─────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3, sharp)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for layer caching
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for TypeScript)
RUN npm ci

# Copy source and config
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# ─── Stage 2: Production ───────────────────────────────────────
FROM node:22-slim AS production

WORKDIR /app

# Install runtime dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Remove build tools after native module compilation
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Create data directories for SQLite and images
RUN mkdir -p /app/data /app/data/images

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3847
ENV DATA_DIR=/app/data

# Expose the configured port
EXPOSE 3847

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:${PORT:-3847}/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Run as non-root for security
RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser
RUN chown -R appuser:appuser /app
USER appuser

# Start the production server (with structured logging, graceful shutdown, keepalive)
CMD ["node", "dist/server.js"]
