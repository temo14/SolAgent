# Build context: monorepo root  (docker-compose sets context: .)
FROM node:22-alpine AS builder
WORKDIR /app

# ── Dependency layer (cached unless manifests change) ─────────────────────────
COPY package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY shared/prisma ./shared/prisma
COPY services/execution-engine/package.json ./services/execution-engine/

RUN apk add --no-cache openssl libc6-compat
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN npm install --legacy-peer-deps --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

# ── Source + build ────────────────────────────────────────────────────────────
COPY shared ./shared
COPY services/execution-engine ./services/execution-engine

RUN npx prisma generate --schema=shared/prisma/schema.prisma

RUN npm run build -w @archon/shared
RUN npm run build -w @archon/execution-engine

# ── Production image ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# openssl — required by the Prisma query engine binary (linux-musl-openssl-3.0.x)
RUN apk add --no-cache openssl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/services/execution-engine/dist ./services/execution-engine/dist

EXPOSE 4004
CMD ["node", "services/execution-engine/dist/index.js"]
