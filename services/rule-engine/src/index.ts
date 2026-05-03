import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { ruleRoutes } from './routes/rules.js';
import { disconnectPrisma } from './lib/prisma.js';
import { disconnectRedis } from './lib/redis.js';
import type { JwtPayload } from './types.js';

const SERVICE_NAME = 'rule-engine';
const PORT = Number(process.env.RULE_ENGINE_PORT ?? process.env.PORT ?? 4001);

async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(process.env.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }),
    },
  });

  // ── JWT (same secret as api-gateway — shared HS256 key) ───────────────────
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET env var must be at least 32 characters');
  }
  await server.register(fastifyJwt, {
    secret: jwtSecret,
    sign: { algorithm: 'HS256', expiresIn: '24h' },
  });

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
  await server.register(ruleRoutes, { prefix: '/rules' });

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
    await Promise.all([disconnectPrisma(), disconnectRedis()]);
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
