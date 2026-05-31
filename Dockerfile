# E — self-hosted server image
# Build:   docker build -t e .
# Run:     docker run -p 3002:3002 -v e-data:/root/.e e
#
# Single builder stage: a bun workspace install creates per-package
# node_modules full of symlinks into node_modules/.bun, and several deps are
# aliased (e.g. `hono` -> `@hono/hono`). Cherry-picking individual dirs into a
# slim runtime breaks those symlinks/aliases, so we keep the whole built
# workspace in one image and run from it.

FROM oven/bun:1 AS builder
WORKDIR /app

# node-pty (terminal) builds native code; provide the toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git curl \
    && rm -rf /var/lib/apt/lists/*

# Manifests first for layer caching.
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN bun install --frozen-lockfile

# Sources, then build shared -> client -> server.
COPY . .
RUN bun run --filter @e/shared build 2>/dev/null || true
RUN bun run --filter @e/client build
RUN bun run --filter @e/server build

ENV NODE_ENV=production
ENV PORT=3002
# Server serves the built client from here (see index.ts).
ENV CLIENT_DIST=/app/packages/client/build

VOLUME /root/.e
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3002/health || exit 1

# Run the plain headless server entry (standalone.ts opens a browser, wrong
# for a container).
CMD ["bun", "run", "packages/server/src/index.ts"]
