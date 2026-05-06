import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../lib/prisma.js';
import { getRedis } from '../lib/redis.js';
import type { JwtPayload } from '../types.js';

const LINK_TTL_SECONDS = 600;

const UpdateSettingsSchema = z.object({
  notifyOnExec: z.boolean().optional(),
  notifyOnFail: z.boolean().optional(),
});

export async function notificationRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /notifications/telegram/link
   * Generates a short-lived token the user pastes into the Telegram bot (/start <token>).
   * The notification service polls Telegram, reads this token, and stores the chat ID.
   */
  server.post(
    '/telegram/link',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const token = crypto.randomBytes(16).toString('hex');
      const redis = getRedis();
      await redis.setex(`telegram:link:${token}`, LINK_TTL_SECONDS, userId);

      const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? 'ArchonBot';
      return reply.send({
        ok: true,
        data: {
          linkToken: token,
          botUsername,
          deepLink: `https://t.me/${botUsername}?start=${token}`,
          expiresInSeconds: LINK_TTL_SECONDS,
        },
      });
    },
  );

  /**
   * DELETE /notifications/telegram/unlink
   */
  server.delete(
    '/telegram/unlink',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const prisma = getPrisma();
      await prisma.user.update({
        where: { id: userId },
        data: { telegramChatId: null, notifyOnExec: false },
      });
      return reply.send({ ok: true });
    },
  );

  /**
   * GET /notifications/settings
   */
  server.get(
    '/settings',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const prisma = getPrisma();
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { telegramChatId: true, notifyOnExec: true, notifyOnFail: true },
      });
      return reply.send({
        ok: true,
        data: {
          telegramChatId: user?.telegramChatId ?? null,
          notifyOnExec: user?.notifyOnExec ?? false,
          notifyOnFail: user?.notifyOnFail ?? true,
        },
      });
    },
  );

  /**
   * PUT /notifications/settings
   */
  server.put(
    '/settings',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const body = UpdateSettingsSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ ok: false, message: 'Invalid body' });
      }
      const prisma = getPrisma();
      await prisma.user.update({ where: { id: userId }, data: body.data });
      return reply.send({ ok: true });
    },
  );
}
