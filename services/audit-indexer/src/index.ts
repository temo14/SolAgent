import Fastify, { FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { auditRoutes } from './routes/audit.js';
import { startIndexerWorker } from './workers/indexer.js';
import { disconnectPrisma } from './lib/prisma.js';

const SERVICE_NAME = 'audit-indexer';
const PORT = Number(process.env.AUDIT_INDEXER_PORT ?? process.env.PORT ?? 4005);

function buildServer(): FastifyInstance {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(process.env.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }),
    },
  });

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET env var must be at least 32 characters');
  }
  server.register(fastifyJwt, {
    secret: jwtSecret,
    sign: { algorithm: 'HS256', expiresIn: '24h' },
  });

  server.get('/health', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
    });
  });

  server.register(auditRoutes);

  return server;
}

async function start(): Promise<void> {
  const server = buildServer();

  // Subscribe to execution-engine's EXEC_RESULT channel and index confirmations.
  // Non-blocking: Redis reconnects automatically if unavailable at startup.
  startIndexerWorker(server.log);

  const gracefulShutdown = async (signal: string) => {
    server.log.info({ signal }, 'Shutting down audit-indexer');
    await server.close();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    server.log.error({ err, service: SERVICE_NAME }, 'Failed to start server');
    process.exit(1);
  }
}

void start();
