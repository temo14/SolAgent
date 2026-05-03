import Fastify, { FastifyInstance } from 'fastify';
import { startConditionWorker } from './workers/condition.js';
import { startReconciliationLoop } from './lib/reconcile.js';
import { disconnectPrisma } from './lib/prisma.js';
import { disconnectSubscriber } from './lib/redis.js';
import { closeQueues } from './lib/queue.js';

const SERVICE_NAME = 'condition-evaluator';
const PORT = Number(process.env.CONDITION_EVALUATOR_PORT ?? process.env.PORT ?? 4003);

async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(process.env.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }),
    },
  });

  server.get('/health', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
    });
  });

  return server;
}

async function start(): Promise<void> {
  const server = await buildServer();

  // ── Start background workers ───────────────────────────────────────────────
  startConditionWorker(server.log);
  const reconcileTimer = startReconciliationLoop(server.log);

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (): Promise<void> => {
    server.log.info({ service: SERVICE_NAME }, 'Shutting down...');
    clearInterval(reconcileTimer);
    await server.close();
    await disconnectPrisma();
    await disconnectSubscriber();
    await closeQueues();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  // ── Start HTTP server ──────────────────────────────────────────────────────
  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    server.log.error({ err, service: SERVICE_NAME }, 'Failed to start server');
    process.exit(1);
  }
}

void start();
