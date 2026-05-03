import Fastify, { FastifyInstance } from 'fastify';
import { startWorkerRegistry, shutdownWorkers } from './workers/exec-worker.js';
import { disconnectPrisma } from './lib/prisma.js';
import { disconnectRedis } from './lib/redis.js';
import { scheduleDailyFiresReset } from './lib/cron.js';

const SERVICE_NAME = 'execution-engine';
const PORT = Number(process.env.EXECUTION_ENGINE_PORT ?? process.env.PORT ?? 4004);

function buildServer(): FastifyInstance {
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
  const server = buildServer();

  // Bootstrap per-wallet BullMQ workers (concurrency=1 each).
  // Non-blocking: Redis reconnects automatically if unavailable at startup.
  startWorkerRegistry(server.log).catch((err: unknown) => {
    server.log.warn({ err }, 'Worker registry startup encountered an error');
  });

  // Daily reset of firesToday at 00:00 UTC
  const firesResetTask = scheduleDailyFiresReset(server.log);

  const gracefulShutdown = async (signal: string) => {
    server.log.info({ signal }, 'Shutting down execution-engine');
    firesResetTask.stop();
    await server.close();
    await shutdownWorkers();
    await Promise.all([disconnectPrisma(), disconnectRedis()]);
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
