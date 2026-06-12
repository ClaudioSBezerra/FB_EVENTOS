# syntax=docker/dockerfile:1.7
#
# FB_EVENTOS multi-stage Dockerfile (Phase 0, Plan 01 — Task 3).
# Produces a Next.js standalone runtime image. Always tag with a semver
# version from package.json — floating tags are structurally forbidden
# (T-0-07, CLAUDE.md "Watchtower auto-pulling floating tag"). The pre-commit
# hook + CI grep guard enforce this.
#
# Build command (also wired as `pnpm docker:build:local`):
#   docker build \
#     --build-arg APP_VERSION=$(node -p "require('./package.json').version") \
#     -t ghcr.io/<org>/fb-eventos-web:$(node -p "require('./package.json').version") \
#     -f docker/Dockerfile .
#
# Requires: next.config.ts → output: 'standalone'

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
# Install pnpm + dependencies only. Cached aggressively in CI.
FROM node:22-alpine AS deps
WORKDIR /app

# Enable corepack so the pinned pnpm version from package.json is used.
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ─── Stage 2: builder ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm build

# ─── Stage 3: runner ────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV TZ=America/Sao_Paulo

# Drop privileges. Next.js standalone server.js does not need root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Standalone build output: contains a minimal node_modules + server.js.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

USER nextjs

EXPOSE 3000

# /api/health is created in Plan 07 (walking-skeleton + Coolify deploy).
# Until then the healthcheck is allowed to fail on first boot — that is
# intentional and resolves once Plan 07 ships.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Image must be tagged with a semver at build time (see header).
# NEVER use a floating tag (T-0-07; CLAUDE.md "What NOT to Use").
ARG APP_VERSION=0.0.0-unset
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="fb-eventos-web"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.source="https://github.com/fb-eventos/fb-eventos"
LABEL org.opencontainers.image.licenses="Proprietary"

CMD ["node", "server.js"]
