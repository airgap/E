# E — Self-hosted AI IDE
# Build:   docker build -t maude .
# Run:     docker run -p 3002:3002 -v maude-data:/root/.maude maude

FROM oven/bun:1 AS builder
WORKDIR /app

# Install build dependencies for node-pty
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests first for layer caching
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

RUN bun install --frozen-lockfile

# Copy source
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/client packages/client
COPY tsconfig.json ./

# Build shared types, then client, then server
RUN bun run --filter @maude/shared build 2>/dev/null || true
RUN bun run --filter @maude/client build
RUN bun run --filter @maude/server build

# --- Production image ---
FROM oven/bun:1-slim
WORKDIR /app

# Runtime deps: git for snapshots, curl for health checks
# node-pty requires build tools — copy pre-built node_modules from builder instead
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-built node_modules (includes compiled node-pty) to avoid build tools in prod
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/packages/shared packages/shared
COPY --from=builder /app/packages/server packages/server
COPY --from=builder /app/packages/client/build packages/client/build
COPY --from=builder /app/packages/client/package.json packages/client/package.json

# Data directory
VOLUME /root/.maude

ENV PORT=3002
ENV NODE_ENV=production
ENV CLIENT_DIST=/app/packages/client/build

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3002/health || exit 1

CMD ["bun", "run", "packages/server/src/index.ts"]
