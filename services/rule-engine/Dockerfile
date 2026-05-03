# Build context: monorepo root  (docker-compose sets context: .)
FROM node:22-alpine AS builder
WORKDIR /app

# ── Dependency layer (cached unless manifests change) ─────────────────────────
COPY package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY shared/prisma ./shared/prisma
COPY services/rule-engine/package.json ./services/rule-engine/

RUN apk add --no-cache openssl libc6-compat
RUN npm install --legacy-peer-deps

# ── Source + build ────────────────────────────────────────────────────────────
COPY shared ./shared
COPY services/rule-engine ./services/rule-engine

RUN npx prisma generate --schema=shared/prisma/schema.prisma

RUN npm run build -w @solagent/shared
RUN npm run build -w @solagent/rule-engine

# ── Production image ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/services/rule-engine/dist ./services/rule-engine/dist

EXPOSE 4001
CMD ["node", "services/rule-engine/dist/index.js"]
