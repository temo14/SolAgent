import Fastify, { FastifyInstance } from 'fastify';
import { webhookRoutes } from './routes/webhook.js';
import { disconnectRedis } from './lib/redis.js';

const SERVICE_NAME = 'event-listener';
const PORT = Number(process.env.EVENT_LISTENER_PORT ?? process.env.PORT ?? 4002);

async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(process.env.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }),
    },
    // Trust the first proxy so request.ip is accurate for HMAC failure logging
    trustProxy: true,
  });

  await server.register(webhookRoutes, { prefix: '/webhooks' });

  server.get('/health', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
    });
  });

  const shutdown = async (): Promise<void> => {
    server.log.info({ service: SERVICE_NAME }, 'Shutting down...');
    await server.close();
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
