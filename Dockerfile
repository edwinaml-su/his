# =============================================================================
# HIS Multipaís - Dockerfile multi-stage para Next.js standalone
# Uso: deploy primario es Vercel; este Dockerfile cubre el requisito
# cloud-agnostic (@AT) para correr la app en K8s/ECS/on-prem si hace falta.
# =============================================================================

ARG NODE_VERSION=20-alpine

# -----------------------------------------------------------------------------
# Stage 1: deps — instala dependencias del monorepo
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /repo

RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json turbo.json ./
# La lista debe espejar TODOS los workspaces de package.json:workspaces
# (npm ci con workspaces exige cada package.json del lockfile presente).
COPY apps/web/package.json ./apps/web/
COPY packages/database/package.json ./packages/database/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/trpc/package.json ./packages/trpc/
COPY packages/infrastructure/package.json ./packages/infrastructure/
COPY packages/ui/package.json ./packages/ui/
COPY packages/bi/package.json ./packages/bi/
COPY packages/test-utils/package.json ./packages/test-utils/
COPY packages/config/eslint/package.json ./packages/config/eslint/

# --ignore-scripts: evita que el postinstall de @his/database (prisma generate)
# corra aquí sin el schema. El builder lo genera explícitamente más abajo.
RUN npm ci --ignore-scripts

# -----------------------------------------------------------------------------
# Stage 2: builder — Prisma generate + Next.js build
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /repo

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /repo/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* se inlinean en el bundle en BUILD time. apps/web/src/lib/supabase/env.ts
# lanza error si faltan → el build truena sin estos. Son públicos por diseño (van al
# cliente), así que se pasan como build-args desde el workflow (repo Variables), no secrets.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}

RUN npx prisma generate --schema=packages/database/prisma/schema.prisma
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3: runner — imagen final mínima (Next.js standalone)
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

RUN apk add --no-cache openssl tini && \
    addgroup -S -g 1001 nodejs && \
    adduser -S -u 1001 -G nodejs nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# APP_VERSION lo lee /api/health para reportar la build desplegada.
# El workflow lo setea = github.sha; default 'dev' para builds locales.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# Next.js standalone output (apps/web/next.config.mjs debe tener output: 'standalone')
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

# Prisma engines necesitan estar en runtime
COPY --from=builder --chown=nextjs:nodejs /repo/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /repo/node_modules/@prisma/client ./node_modules/@prisma/client

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
