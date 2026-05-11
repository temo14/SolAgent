# Build context: monorepo root  (docker-compose sets context: .)
FROM node:22-alpine AS builder
WORKDIR /app

# ── Dependency layer (cached unless manifests change) ─────────────────────────
COPY package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY shared/prisma ./shared/prisma
COPY services/event-listener/package.json ./services/event-listener/

RUN apk add --no-cache openssl libc6-compat
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN npm install --legacy-peer-deps --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

# ── Source + build ────────────────────────────────────────────────────────────
COPY shared ./shared
COPY services/event-listener ./services/event-listener

RUN npx prisma generate --schema=shared/prisma/schema.prisma

RUN npm run build -w @archon/shared
RUN npm run build -w @archon/event-listener

# ── Production image ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# openssl — required by the Prisma query engine binary (linux-musl-openssl-3.0.x)
RUN apk add --no-cache openssl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/services/event-listener/dist ./services/event-listener/dist

EXPOSE 4002
CMD ["node", "services/event-listener/dist/index.js"]
