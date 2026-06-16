# syntax=docker/dockerfile:1.7
#
# FB_EVENTOS unified multi-stage Dockerfile (Phase 0 Plan 01 + Plan 07).
#
# Produces TWO runtime images from a SINGLE shared build pipeline:
#   - target `web-runner`     → Next.js standalone server (port 3000)
#   - target `worker-runner`  → Graphile-Worker process (no port)
#
# Why unified: docker-compose builds web + worker in parallel by default,
# which doubled `pnpm install` + Next.js build memory usage and tripped
# Coolify OOM during demo deploy (2026-06-15 23:51 deploy log:
# exit 255 mid-`COPY --from=deps` on the worker stage). With a unified
# Dockerfile, buildkit deduplicates the `deps` + `builder` stages between
# the two targets and runs them ONCE.
#
# Build commands:
#   docker build -f docker/Dockerfile --target web-runner    \
#     --build-arg APP_VERSION=$(node -p "require('./package.json').version") \
#     -t ghcr.io/<org>/fb-eventos-web:<ver> .
#   docker build -f docker/Dockerfile --target worker-runner \
#     -t ghcr.io/<org>/fb-eventos-worker:<ver> .
#
# Floating tags are contractually banned (T-0-07, CLAUDE.md).
# Requires: next.config.ts → output: 'standalone'.

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
# Install pnpm + dependencies. Shared by web + worker builders.
FROM node:22-alpine AS deps
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ─── Stage 2: builder ───────────────────────────────────────────────────────
# Build BOTH the Next.js standalone server AND the worker TypeScript bundle
# in one pass. Each runner stage cherry-picks the artifacts it needs.
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build-time env validation skip — runtime URLs / secrets are provided by
# Coolify at container start; the build itself cannot see them. The runner
# stages below do NOT propagate this variable, so strict validation still
# runs on production container startup. See src/lib/env.ts `isBuildTime`.
ENV SKIP_ENV_VALIDATION=1

# Web: produces .next/standalone + .next/static.
RUN pnpm build

# Worker no longer pre-compiled — runs source .ts via tsx in the worker
# runner stage. See `worker-runner` block below for rationale.

# ─── Stage 3a: web-runner ──────────────────────────────────────────────────
# Next.js standalone server. Port 3000. Healthcheck via /api/health.
FROM node:22-alpine AS web-runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV TZ=America/Sao_Paulo

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ARG APP_VERSION=0.0.0-unset
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="fb-eventos-web"
LABEL org.opencontainers.image.version="${APP_VERSION}"

CMD ["node", "server.js"]

# ─── Stage 3b: worker-runner ───────────────────────────────────────────────
# Graphile-Worker process. No port. Drains in-flight jobs on SIGTERM.
#
# We run the worker via tsx against the original TypeScript source (NOT a
# compiled bundle). Why:
#   - tsconfig path aliases (`@/lib/env`, `@/db/schema/...`) need a runtime
#     resolver. The previous compiled-to-dist-worker approach hit
#     ERR_MODULE_NOT_FOUND on every relative + alias import because:
#       * "module: ESNext" emits ES module syntax without .js extensions
#         (Node 22 ESM requires extensions; CJS would parse-error on `import`)
#       * src/db/migrate.ts uses `import.meta.url` (forbidden in CJS targets)
#       * path aliases are erased at compile time
#   - tsx handles all of the above natively: ESM/CJS interop, .ts source,
#     tsconfig path resolution. It's the same tool `pnpm worker:dev` already
#     uses successfully.
#   - Trade-off: slightly slower cold start (~1s) but zero ambiguity.
FROM node:22-alpine AS worker-runner
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 worker

# node_modules includes tsx (kept in devDependencies but installed because
# the deps stage above runs `pnpm install --frozen-lockfile` without --prod).
COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules
# Source files the worker imports — keep parity with tsconfig.worker.json
# `include` list (src/jobs, scripts/jobs, src/lib, src/db, src/auth).
COPY --from=builder --chown=worker:nodejs /app/src/jobs      ./src/jobs
COPY --from=builder --chown=worker:nodejs /app/scripts/jobs  ./scripts/jobs
COPY --from=builder --chown=worker:nodejs /app/src/lib       ./src/lib
COPY --from=builder --chown=worker:nodejs /app/src/db        ./src/db
COPY --from=builder --chown=worker:nodejs /app/src/auth      ./src/auth
COPY --from=builder --chown=worker:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=worker:nodejs /app/package.json  ./package.json

USER worker

ARG APP_VERSION=0.0.0-unset
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="fb-eventos-worker"
LABEL org.opencontainers.image.version="${APP_VERSION}"

CMD ["node_modules/.bin/tsx", "scripts/jobs/start-worker.ts"]

# ─── Default target alias for backwards compatibility ──────────────────────
# `docker build -f docker/Dockerfile .` without --target produces web-runner
# (matches Plan 01 behavior; docker-compose.yml uses explicit targets).
FROM web-runner AS runner
