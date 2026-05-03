import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import IORedis from 'ioredis';
import { REDIS_CHANNEL } from '@solagent/shared';
import { createSubscriber } from '../lib/redis.js';
import { type JwtPayload } from '../types.js';

export async function sseRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /ws/activity?token=<jwt>
   *
   * Server-Sent Events stream scoped to the authenticated wallet.
   * JWT is passed as a query param (headers not available for EventSource API).
   * Sends execution result events from the Redis EXEC_RESULT pub/sub channel.
   *
   * Event types streamed to client:
   *   { type: 'connected', walletPubkey }
   *   { type: 'exec_result', data: ExecutionLog }
   *   ':heartbeat' comment every 30s (keeps proxies alive)
   */
  server.get(
    '/activity',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.query as { token?: string };

      if (!token) {
        return reply.status(401).send({ ok: false, message: 'token query param required' });
      }

      // Verify JWT manually (EventSource cannot send Authorization headers)
      let payload: JwtPayload;
      try {
        payload = server.jwt.verify<JwtPayload>(token);
      } catch {
        return reply.status(401).send({ ok: false, message: 'Invalid or expired token' });
      }

      const { walletPubkey } = payload;

      // Switch to SSE mode — Fastify must not try to serialize the reply further
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
      reply.raw.flushHeaders();

      const send = (data: unknown): void => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      send({ type: 'connected', walletPubkey });

      // Subscribe to wallet-scoped channel on a dedicated connection
      // (shared command client must not be in subscribe mode)
      const subscriber: IORedis = createSubscriber();
      const channel = `${REDIS_CHANNEL.EXEC_RESULT}:${walletPubkey}`;
      await subscriber.subscribe(channel);

      subscriber.on('message', (_chan: string, message: string) => {
        try {
          send({ type: 'exec_result', data: JSON.parse(message) as unknown });
        } catch {
          // Malformed pub/sub message — skip silently
        }
      });

      const heartbeat = setInterval(() => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(':heartbeat\n\n');
        }
      }, 30_000);

      // Cleanup on client disconnect
      const cleanup = (): void => {
        clearInterval(heartbeat);
        subscriber.unsubscribe(channel).catch(() => undefined);
        subscriber.quit().catch(() => undefined);
      };

      request.raw.on('close', cleanup);
      request.raw.on('error', cleanup);

      // Hold the connection open until the client disconnects
      await new Promise<void>((resolve) => {
        request.raw.on('close', resolve);
        request.raw.on('error', resolve);
      });

      // Fastify expects us to return something; hijacked reply needs explicit end
      reply.raw.end();
    },
  );
}
