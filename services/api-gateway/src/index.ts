import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { authRoutes } from './routes/auth.js';
import { agentWalletRoutes } from './routes/agent-wallet.js';
import { sseRoutes } from './routes/sse.js';
import { disconnectPrisma } from './lib/prisma.js';
import { disconnectRedis } from './lib/redis.js';
import type { JwtPayload } from './types.js';

const SERVICE_NAME = 'api-gateway';
const PORT = Number(process.env.API_GATEWAY_PORT ?? process.env.PORT ?? 4000);

async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(process.env.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }),
    },
  });

  // ── Security headers ─────────────────────────────────────────────────────
  await server.register(fastifyHelmet, {
    // CSP is handled by the frontend CDN; gateway only serves API
    contentSecurityPolicy: false,
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  await server.register(fastifyCors, {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Rate limiting (in-memory; swap for Redis store in production) ─────────
  await server.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      ok: false,
      message: `Rate limit exceeded. Retry after ${String(context.after)}.`,
    }),
  });

  // ── JWT (HS256, 24h) ──────────────────────────────────────────────────────
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET env var must be at least 32 characters');
  }
  await server.register(fastifyJwt, {
    secret: jwtSecret,
    sign: { algorithm: 'HS256', expiresIn: '24h' },
  });

  // Reusable authentication hook for protected routes
  server.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        await request.jwtVerify<JwtPayload>();
      } catch (err) {
        reply.send(err);
      }
    },
  );

  // ── Routes ────────────────────────────────────────────────────────────────
  await server.register(authRoutes, { prefix: '/auth' });
  await server.register(agentWalletRoutes, { prefix: '/agent-wallets' });
  await server.register(sseRoutes, { prefix: '/ws' });

  // ── Health check ─────────────────────────────────────────────────────────
  server.get('/health', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (): Promise<void> => {
    server.log.info({ service: SERVICE_NAME }, 'Shutting down...');
    await server.close();
    await disconnectPrisma();
    await disconnectRedis();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  return server;
}

async function start(): Promise<void> {
  const server = await buildServer();
  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    server.log.error({ err, service: SERVICE_NAME }, 'Failed to start server');
    process.exit(1);
  }
}

void start();
