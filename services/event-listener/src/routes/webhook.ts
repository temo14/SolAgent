import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { REDIS_CHANNEL, ERROR_CODES, HeliusWebhookPayloadSchema } from '@archon/shared';
import { validateHeliusHmac } from '../lib/hmac.js';
import { getRedis } from '../lib/redis.js';

export async function webhookRoutes(server: FastifyInstance): Promise<void> {
  /**
   * Override the default JSON content-type parser for this plugin scope so
   * we receive the raw Buffer — required for HMAC signature verification.
   * Fastify will call our parser before the route handler.
   */
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body as Buffer);
    },
  );

  /**
   * POST /webhooks/helius
   *
   * Entry point for all Helius Enhanced Webhook events.
   * Security rule (spec §8):
   *   1. Validate HMAC-SHA256 signature — reject 401 on failure, log source IP
   *   2. Parse + Zod-validate event array
   *   3. Publish each event to Redis WEBHOOK_EVENTS channel for fan-out
   */
  server.post(
    '/helius',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = request.body as Buffer;
      const authHeader = request.headers['authorization'];

      // ── HMAC validation ─────────────────────────────────────────────────
      let hmacValid: boolean;
      try {
        hmacValid = validateHeliusHmac(
          rawBody,
          typeof authHeader === 'string' ? authHeader : undefined,
        );
      } catch (err) {
        server.log.error({ err }, 'HMAC validation threw — secret misconfigured');
        return reply.status(500).send({ ok: false, message: 'Server misconfiguration' });
      }

      if (!hmacValid) {
        server.log.warn(
          {
            errorCode: ERROR_CODES.WEBHOOK_HMAC_FAIL,
            sourceIp: request.ip,
          },
          'Webhook HMAC validation failed — rejecting request',
        );
        return reply.status(401).send({
          ok: false,
          errorCode: ERROR_CODES.WEBHOOK_HMAC_FAIL,
          message: 'Unauthorized',
        });
      }

      // ── JSON parse ────────────────────────────────────────────────────────
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return reply.status(400).send({ ok: false, message: 'Invalid JSON body' });
      }

      // ── Zod schema validation ─────────────────────────────────────────────
      const result = HeliusWebhookPayloadSchema.safeParse(parsed);
      if (!result.success) {
        server.log.warn({ detail: result.error.flatten() }, 'Webhook payload schema mismatch');
        return reply.status(400).send({
          ok: false,
          message: 'Webhook payload does not match expected schema',
        });
      }

      // ── Fan-out to Redis ──────────────────────────────────────────────────
      const redis = getRedis();
      const publishPromises = result.data.map((event) =>
        redis.publish(REDIS_CHANNEL.WEBHOOK_EVENTS, JSON.stringify(event)),
      );

      try {
        await Promise.all(publishPromises);
      } catch (err) {
        server.log.error({ err }, 'Failed to publish webhook events to Redis');
        return reply.status(503).send({ ok: false, message: 'Event bus unavailable' });
      }

      server.log.info(
        { eventCount: result.data.length, sourceIp: request.ip },
        'Webhook events published to Redis',
      );

      // 204 No Content — Helius retries on non-2xx
      return reply.status(204).send();
    },
  );
}
