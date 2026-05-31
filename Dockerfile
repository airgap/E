# Multi-stage build for E (server + client)
# Build:   docker build -t e .
# Run:     docker run -p 3002:3002 -v e-data:/root/.e e
# syntax=docker/dockerfile:1

FROM oven/bun:1 AS base
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY package.json bun.lock* ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run --filter @e/shared build 2>/dev/null || true
RUN bun run --filter @e/client build
RUN bun run --filter @e/server build

# ---- runtime ----
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
# The server resolves the built client assets from here (see index.ts).
ENV CLIENT_DIST=/app/packages/client/build

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/src ./packages/server/src
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/client/package.json ./packages/client/package.json
COPY --from=build /app/packages/client/build ./packages/client/build

EXPOSE 3002
VOLUME /root/.e

# Run the plain server entry (headless). standalone.ts is for the desktop
# binary and now opens a browser by default, which is wrong in a container.
CMD ["bun", "run", "packages/server/src/index.ts"]
