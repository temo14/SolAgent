import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Prisma } from '@prisma/client';
import { getPrisma } from '../lib/prisma.js';
import type { JwtPayload } from '../types.js';

export async function marketplaceRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /marketplace
   * Returns published templates sorted by popularity. Public (no auth needed).
   */
  server.get(
    '/',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const prisma = getPrisma();
      const templates = await prisma.publishedTemplate.findMany({
        orderBy: [{ useCount: 'desc' }, { upvotes: 'desc' }],
        take: 50,
        select: {
          id: true,
          description: true,
          parsedRule: true,
          useCount: true,
          upvotes: true,
          createdAt: true,
        },
      });
      return reply.send({ ok: true, data: templates });
    },
  );

  /**
   * POST /marketplace/publish
   * Anonymously publish a rule template (deduped by ruleHash).
   */
  server.post(
    '/publish',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const { ruleId, description } = request.body as {
        ruleId: string;
        description: string;
      };

      if (!ruleId || !description?.trim()) {
        return reply.status(400).send({ ok: false, message: 'ruleId and description required' });
      }

      const prisma = getPrisma();
      const rule = await prisma.rule.findFirst({
        where: { id: ruleId, userId },
        select: { ruleHash: true, parsedRule: true },
      });

      if (!rule) {
        return reply.status(404).send({ ok: false, message: 'Rule not found' });
      }

      // Strip any identifying info from parsedRule before publishing
      const parsedRule = rule.parsedRule as Record<string, unknown>;
      const anonRule: Prisma.InputJsonValue = {
        trigger: (parsedRule.trigger ?? null) as Prisma.InputJsonValue,
        action: (parsedRule.action ?? null) as Prisma.InputJsonValue,
        conditions: (parsedRule.conditions ?? null) as Prisma.InputJsonValue,
      };

      const template = await prisma.publishedTemplate.upsert({
        where: { ruleHash: rule.ruleHash },
        create: {
          ruleHash: rule.ruleHash,
          description: description.trim(),
          parsedRule: anonRule,
        },
        update: { description: description.trim() },
        select: { id: true, useCount: true, upvotes: true },
      });

      return reply.status(201).send({ ok: true, data: template });
    },
  );

  /**
   * POST /marketplace/:id/use
   * Increments the useCount when someone loads a template into the wizard.
   */
  server.post(
    '/:id/use',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const prisma = getPrisma();

      try {
        await prisma.publishedTemplate.update({
          where: { id },
          data: { useCount: { increment: 1 } },
        });
      } catch {
        // silently ignore if template not found
      }
      return reply.send({ ok: true });
    },
  );

  /**
   * POST /marketplace/:id/upvote
   * Increments upvote count.
   */
  server.post(
    '/:id/upvote',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const prisma = getPrisma();

      try {
        const template = await prisma.publishedTemplate.update({
          where: { id },
          data: { upvotes: { increment: 1 } },
          select: { upvotes: true },
        });
        return reply.send({ ok: true, data: { upvotes: template.upvotes } });
      } catch {
        return reply.status(404).send({ ok: false, message: 'Template not found' });
      }
    },
  );
}
