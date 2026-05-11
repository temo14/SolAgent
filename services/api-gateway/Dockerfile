# Build context: monorepo root  (docker-compose sets context: .)
# node:22-alpine — matches @types/node ^22 in devDeps; keeps image small
FROM node:22-alpine AS builder
WORKDIR /app

# ── Dependency layer (cached unless manifests change) ─────────────────────────
COPY package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY shared/prisma ./shared/prisma
COPY services/api-gateway/package.json ./services/api-gateway/

# openssl — required by Prisma query engine binary
# libc6-compat — glibc shim required by several native addons on Alpine
RUN apk add --no-cache openssl libc6-compat
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN npm install --legacy-peer-deps --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

# ── Source + build ────────────────────────────────────────────────────────────
COPY shared ./shared
COPY services/api-gateway ./services/api-gateway

# Explicit generate — don't rely on the prepare lifecycle hook being called
RUN npx prisma generate --schema=shared/prisma/schema.prisma

RUN npm run build -w @archon/shared
RUN npm run build -w @archon/api-gateway

# ── Production image ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# openssl — required by the Prisma query engine binary (linux-musl-openssl-3.0.x)
RUN apk add --no-cache openssl

# Carry hoisted node_modules (includes .prisma/client), shared types, and dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/services/api-gateway/dist ./services/api-gateway/dist

EXPOSE 4000
CMD ["node", "services/api-gateway/dist/index.js"]
