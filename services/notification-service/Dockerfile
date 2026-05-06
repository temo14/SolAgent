FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY shared/prisma ./shared/prisma
COPY services/notification-service/package.json ./services/notification-service/

RUN apk add --no-cache openssl libc6-compat
RUN npm install --legacy-peer-deps

COPY shared ./shared
COPY services/notification-service ./services/notification-service

RUN npx prisma generate --schema=shared/prisma/schema.prisma
RUN npm run build -w @solagent/shared
RUN npm run build -w @solagent/notification-service

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/services/notification-service/dist ./services/notification-service/dist

CMD ["node", "services/notification-service/dist/index.js"]
