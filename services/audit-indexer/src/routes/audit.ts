import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../lib/prisma.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Public audit-trail routes — no authentication required.
 * Anyone can verify on-chain memo proofs against this endpoint.
 */
export async function auditRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /audit/:walletPubkey
   * Paginated list of confirmed executions for a wallet.
   */
  server.get<{
    Params: { walletPubkey: string };
    Querystring: { page?: number; limit?: number };
  }>(
    '/audit/:walletPubkey',
    {
      schema: {
        params: {
          type: 'object',
          properties: { walletPubkey: { type: 'string' } },
          required: ['walletPubkey'],
        },
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
          },
        },
      },
    },
    async (req, reply) => {
      const { walletPubkey } = req.params;
      const page = req.query.page ?? 1;
      const limit = Math.min(req.query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const skip = (page - 1) * limit;

      const prisma = getPrisma();
      const [total, events] = await Promise.all([
        prisma.auditEvent.count({ where: { walletPubkey } }),
        prisma.auditEvent.findMany({
          where: { walletPubkey },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            txSignature: true,
            ruleId: true,
            eventType: true,
            isAnomalous: true,
            createdAt: true,
            payload: true,
          },
        }),
      ]);

      return reply.send({
        walletPubkey,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        events,
      });
    },
  );

  /**
   * GET /audit/:walletPubkey/:txSignature
   * Single confirmed execution with full MemoProofV1 for on-chain verification.
   */
  server.get<{
    Params: { walletPubkey: string; txSignature: string };
  }>(
    '/audit/:walletPubkey/:txSignature',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            walletPubkey: { type: 'string' },
            txSignature: { type: 'string' },
          },
          required: ['walletPubkey', 'txSignature'],
        },
      },
    },
    async (req, reply) => {
      const { walletPubkey, txSignature } = req.params;
      const prisma = getPrisma();

      const event = await prisma.auditEvent.findFirst({
        where: { walletPubkey, txSignature },
      });

      if (!event) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Audit event not found' });
      }

      return reply.send({
        id: event.id,
        walletPubkey: event.walletPubkey,
        txSignature: event.txSignature,
        ruleId: event.ruleId,
        eventType: event.eventType,
        isAnomalous: event.isAnomalous,
        createdAt: event.createdAt,
        memoProof: event.payload,
      });
    },
  );
}
