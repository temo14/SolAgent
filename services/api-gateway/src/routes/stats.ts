import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPrisma } from '../lib/prisma.js';
import type { JwtPayload } from '../types.js';

export async function statsRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /stats
   * Returns execution stats for the authenticated user's rules.
   */
  server.get(
    '/',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const prisma = getPrisma();

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      // All rules belonging to this user
      const rules = await prisma.rule.findMany({
        where: { userId },
        select: {
          id: true,
          rawInput: true,
          status: true,
          firesToday: true,
          maxFiresDay: true,
          createdAt: true,
          activatedAt: true,
          executions: {
            select: {
              id: true,
              status: true,
              confirmedAt: true,
              createdAt: true,
              pythPrice: true,
              memoJson: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Aggregate totals
      let totalConfirmed = 0;
      let totalFailed = 0;
      let confirmedThisMonth = 0;
      let failedThisMonth = 0;

      const byRule = rules.map((rule) => {
        let ruleTotalFires = 0;
        let ruleConfirmed = 0;
        let ruleFailed = 0;
        let lastFired: Date | null = null;

        for (const ex of rule.executions) {
          ruleTotalFires++;
          if (ex.status === 'CONFIRMED') {
            ruleConfirmed++;
            totalConfirmed++;
            if (ex.confirmedAt && ex.confirmedAt >= startOfMonth) confirmedThisMonth++;
            if (!lastFired || (ex.confirmedAt && ex.confirmedAt > lastFired)) {
              lastFired = ex.confirmedAt;
            }
          } else if (ex.status === 'FAILED') {
            ruleFailed++;
            totalFailed++;
            if (ex.createdAt >= startOfMonth) failedThisMonth++;
          }
        }

        return {
          ruleId: rule.id,
          rawInput: rule.rawInput,
          status: rule.status,
          firesToday: rule.firesToday,
          maxFiresDay: rule.maxFiresDay,
          totalFires: ruleTotalFires,
          confirmedFires: ruleConfirmed,
          failedFires: ruleFailed,
          lastFired: lastFired?.toISOString() ?? null,
          createdAt: rule.createdAt.toISOString(),
        };
      });

      // Recent 10 confirmed executions across all rules (for activity feed)
      const recentExecs = await prisma.executionLog.findMany({
        where: {
          rule: { userId },
          status: 'CONFIRMED',
        },
        orderBy: { confirmedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          ruleId: true,
          txSignature: true,
          pythPrice: true,
          memoJson: true,
          confirmedAt: true,
          rule: { select: { rawInput: true } },
        },
      });

      const successRate =
        totalConfirmed + totalFailed > 0
          ? Math.round((totalConfirmed / (totalConfirmed + totalFailed)) * 100)
          : null;

      return reply.send({
        ok: true,
        data: {
          totalConfirmed,
          totalFailed,
          confirmedThisMonth,
          failedThisMonth,
          successRate,
          byRule,
          recentExecs: recentExecs.map((ex) => ({
            id: ex.id,
            ruleId: ex.ruleId,
            ruleLabel: ex.rule.rawInput.slice(0, 60),
            txSignature: ex.txSignature,
            pythPrice: ex.pythPrice ? Number(ex.pythPrice) : null,
            memo: ex.memoJson,
            confirmedAt: ex.confirmedAt?.toISOString() ?? null,
          })),
        },
      });
    },
  );
}
