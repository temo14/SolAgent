import { createHash } from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES, REDIS_CHANNEL, isValidIanaTimeZone, ArchonRuleSchema } from '@archon/shared';
import { getPrisma } from '../lib/prisma.js';
import { parseRule, QvacError } from '../lib/parser.js';
import { simulateRule } from '../lib/simulate.js';
import { registerHeliusWebhook } from '../lib/helius.js';
import type { JwtPayload } from '../types.js';

// ─── Request schemas ──────────────────────────────────────────────────────────

const SimulateBodySchema = z.object({
  rawInput: z.string().min(10).max(2000),
});

const CreateRuleBodySchema = z.object({
  agentWalletId: z.string().uuid(),
  rawInput: z.string().min(10).max(2000),
  maxAmountUsd: z.number().positive().optional(),
  maxFiresPerDay: z.number().int().min(1).max(1440).optional(),
  /** Browser IANA TZ e.g. Asia/Dubai — used for until_local_hour on time_cron */
  clientTimezone: z.string().min(2).max(80).optional(),
  /** Pre-parsed rule from /parse — skips the second QVAC call on confirm */
  parsedRule: ArchonRuleSchema.optional(),
});

const PatchStatusBodySchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']),
  pauseReason: z.string().max(255).optional(),
});

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z
    .enum(['PENDING_ACTIVATION', 'ACTIVE', 'PAUSED', 'PAUSED_CIRCUIT_BREAKER', 'COMPLETED', 'ARCHIVED'])
    .optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deepSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, deepSortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

function computeRuleHash(parsedRule: unknown): string {
  return createHash('sha256').update(JSON.stringify(deepSortKeys(parsedRule))).digest('hex');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function ruleRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /rules/parse
   * Parses a natural-language rule via QVAC and returns the structured result.
   * Does NOT save anything to the database — pure preview endpoint.
   * The frontend uses this to show the user what the LLM understood before they confirm.
   */
  server.post(
    '/parse',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const bodyParse = SimulateBodySchema.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          ok: false,
          errorCode: ERROR_CODES.RULE_VALIDATION_FAIL,
          message: 'Invalid request body',
          detail: bodyParse.error.flatten(),
        });
      }

      let parsedRule;
      try {
        parsedRule = await parseRule(bodyParse.data.rawInput);
      } catch (err) {
        if (err instanceof QvacError) {
          const status = err.errorCode === ERROR_CODES.QVAC_UNAVAILABLE ? 503 : 422;
          return reply.status(status).send({ ok: false, errorCode: err.errorCode, message: err.message });
        }
        throw err;
      }

      return reply.send({ ok: true, data: { parsedRule } });
    },
  );

  /**
   * POST /rules/simulate
   * Parses a natural-language rule via QVAC then runs a 7-day back-simulation
   * against Pyth Benchmarks 15-min candle data.
   * Supports price_below / price_above triggers.
   * Non-price triggers return totalFires: 0 (no price history available).
   * Auth: JWT required.
   */
  server.post(
    '/simulate',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const bodyParse = SimulateBodySchema.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          ok: false,
          errorCode: ERROR_CODES.RULE_VALIDATION_FAIL,
          message: 'Invalid request body',
          detail: bodyParse.error.flatten(),
        });
      }

      const { rawInput } = bodyParse.data;

      // 1. Parse rule via QVAC
      let parsedRule;
      try {
        parsedRule = await parseRule(rawInput);
      } catch (err) {
        if (err instanceof QvacError) {
          const status = err.errorCode === ERROR_CODES.QVAC_UNAVAILABLE ? 503 : 422;
          return reply.status(status).send({
            ok: false,
            errorCode: err.errorCode,
            message: err.message,
          });
        }
        throw err;
      }

      // 2. Run simulation (non-price triggers → totalFires: 0, no error)
      let result;
      try {
        result = await simulateRule(parsedRule);
      } catch (err) {
        request.log.warn(
          { err, asset: parsedRule.trigger.asset },
          'Simulation data fetch failed',
        );
        return reply.status(502).send({
          ok: false,
          errorCode: 'SIMULATION_DATA_UNAVAILABLE',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to fetch historical price data',
        });
      }

      return reply.send({ ok: true, data: result });
    },
  );

  /**
   * POST /rules
   * Accepts a natural-language rule, sends it to QVAC for parsing,
   * validates the output with Zod, then persists as PENDING_ACTIVATION.
   * Returns 503 if QVAC is unavailable — no cloud fallback.
   */
  server.post(
    '/',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;

      const bodyParse = CreateRuleBodySchema.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          ok: false,
          errorCode: ERROR_CODES.RULE_VALIDATION_FAIL,
          message: 'Invalid request body',
          detail: bodyParse.error.flatten(),
        });
      }

      const { agentWalletId, rawInput, maxAmountUsd, maxFiresPerDay, clientTimezone, parsedRule: prebuiltRule } =
        bodyParse.data;

      // Verify the agent wallet belongs to this user
      const prisma = getPrisma();

      const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });

      const agentWallet = await prisma.agentWallet.findFirst({
        where: { id: agentWalletId, userId, isActive: true },
      });
      if (agentWallet === null) {
        return reply.status(404).send({
          ok: false,
          message: 'Agent wallet not found or not owned by this account',
        });
      }

      // Use pre-parsed rule from frontend if provided (avoids double QVAC call)
      let parsedRule;
      if (prebuiltRule !== undefined) {
        parsedRule = prebuiltRule;
      } else {
        try {
          parsedRule = await parseRule(rawInput);
        } catch (err) {
          if (err instanceof QvacError) {
            const status =
              err.errorCode === ERROR_CODES.QVAC_UNAVAILABLE ? 503 : 422;
            return reply.status(status).send({
              ok: false,
              errorCode: err.errorCode,
              message: err.message,
            });
          }
          throw err;
        }
      }

      const tzFromBrowser = clientTimezone?.trim();
      const effectiveTz =
        tzFromBrowser && isValidIanaTimeZone(tzFromBrowser)
          ? tzFromBrowser
          : userRow?.timezone && isValidIanaTimeZone(userRow.timezone)
            ? userRow.timezone
            : 'UTC';

      if (tzFromBrowser && isValidIanaTimeZone(tzFromBrowser)) {
        await prisma.user.update({
          where: { id: userId },
          data: { timezone: tzFromBrowser },
        });
      }

      if (parsedRule.trigger.type === 'time_cron') {
        parsedRule.trigger.schedule_timezone =
          parsedRule.trigger.schedule_timezone ?? effectiveTz;
      }

      const ruleHash = computeRuleHash(parsedRule);

      // Merge parsed conditions with any overrides from the request
      const finalMaxAmountUsd = maxAmountUsd ?? parsedRule.conditions.max_amount_usd;
      const finalMaxFiresDay = maxFiresPerDay ?? parsedRule.conditions.max_fires_per_day;

      const rule = await prisma.rule.create({
        data: {
          userId,
          agentWalletId,
          rawInput,
          parsedRule,
          ruleHash,
          maxAmountUsd: finalMaxAmountUsd,
          maxFiresDay: finalMaxFiresDay,
          status: 'PENDING_ACTIVATION',
        },
        select: {
          id: true,
          rawInput: true,
          parsedRule: true,
          ruleHash: true,
          status: true,
          maxAmountUsd: true,
          maxFiresDay: true,
          createdAt: true,
          agentWallet: { select: { delegatePubkey: true } },
        },
      });

      request.log.info({ ruleId: rule.id, userId }, 'Rule created (PENDING_ACTIVATION)');
      return reply.status(201).send({ ok: true, data: rule });
    },
  );

  /**
   * GET /rules
   * Lists rules for the authenticated user with pagination.
   */
  server.get(
    '/',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;

      const queryParse = ListQuerySchema.safeParse(request.query);
      if (!queryParse.success) {
        return reply.status(400).send({ ok: false, message: 'Invalid query params' });
      }

      const { page, limit, status } = queryParse.data;
      const skip = (page - 1) * limit;
      const prisma = getPrisma();

      const [rules, total] = await prisma.$transaction([
        prisma.rule.findMany({
          where: { userId, ...(status !== undefined ? { status } : { status: { not: 'ARCHIVED' } }) },
          select: {
            id: true,
            rawInput: true,
            parsedRule: true,
            ruleHash: true,
            status: true,
            maxAmountUsd: true,
            maxFiresDay: true,
            firesToday: true,
            createdAt: true,
            activatedAt: true,
            pausedAt: true,
            pauseReason: true,
            agentWallet: { select: { delegatePubkey: true, id: true } },
            _count: { select: { executions: true } },
            executions: {
              where: { status: 'FAILED' },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { errorCode: true, errorDetail: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.rule.count({ where: { userId, ...(status !== undefined ? { status } : { status: { not: 'ARCHIVED' } }) } }),
      ]);

      return reply.send({
        ok: true,
        data: { rules, total, page, limit, pages: Math.ceil(total / limit) },
      });
    },
  );

  /**
   * GET /rules/:id
   * Returns a single rule with its recent executions.
   */
  server.get(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();

      const rule = await prisma.rule.findFirst({
        where: { id, userId },
        include: {
          agentWallet: { select: { delegatePubkey: true } },
          executions: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true,
              status: true,
              txSignature: true,
              memoJson: true,
              jupiterPrice: true,
              pythPrice: true,
              errorCode: true,
              createdAt: true,
              confirmedAt: true,
            },
          },
        },
      });

      if (rule === null) {
        return reply.status(404).send({ ok: false, message: 'Rule not found' });
      }

      return reply.send({ ok: true, data: rule });
    },
  );

  /**
   * PATCH /rules/:id/status
   * Transitions a rule between ACTIVE / PAUSED / ARCHIVED.
   * PENDING_ACTIVATION → ACTIVE is the activation path.
   */
  server.patch(
    '/:id/status',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const { id } = request.params as { id: string };

      const bodyParse = PatchStatusBodySchema.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          ok: false,
          message: 'Invalid request body',
          detail: bodyParse.error.flatten(),
        });
      }

      const { status, pauseReason } = bodyParse.data;
      const prisma = getPrisma();

      const rule = await prisma.rule.findFirst({ where: { id, userId } });
      if (rule === null) {
        return reply.status(404).send({ ok: false, message: 'Rule not found' });
      }

      // Disallow re-activating a PAUSED_CIRCUIT_BREAKER rule directly
      if (rule.status === 'PAUSED_CIRCUIT_BREAKER' && status === 'ACTIVE') {
        return reply.status(409).send({
          ok: false,
          message:
            'Circuit breaker is active. Investigate failures before re-activating.',
        });
      }

      // Fetch agentWallet for side-effects below
      const ruleWithWallet = await prisma.rule.findFirst({
        where: { id, userId },
        include: { agentWallet: { select: { id: true, delegatePubkey: true } } },
      });
      if (ruleWithWallet === null) {
        return reply.status(404).send({ ok: false, message: 'Rule not found' });
      }

      const updated = await prisma.rule.update({
        where: { id },
        data: {
          status,
          ...(status === 'ACTIVE' && { activatedAt: new Date(), pausedAt: null, pauseReason: null }),
          ...(status === 'PAUSED' && { pausedAt: new Date(), pauseReason: pauseReason ?? null }),
          ...(status === 'ARCHIVED' && { pausedAt: new Date(), pauseReason: 'archived' }),
        },
        select: { id: true, status: true, activatedAt: true, pausedAt: true, pauseReason: true },
      });

      if (status === 'ACTIVE') {
        const { id: agentWalletId, delegatePubkey } = ruleWithWallet.agentWallet;

        // Publish agentWalletId so execution-engine spins up a per-wallet queue worker.
        const { getPublisher } = await import('../lib/redis.js');
        getPublisher()
          .publish(
            REDIS_CHANNEL.RULE_ACTIVATED,
            JSON.stringify({ ruleId: id, agentWalletId }),
          )
          .catch((err: unknown) =>
            request.log.warn({ err, ruleId: id }, 'Failed to publish rule-activated event'),
          );

        // Await Helius webhook registration so we can surface failures to the caller.
        // For time_cron rules this is non-fatal (polling covers them); for balance/price
        // rules a failed registration means events arrive on the 5-min polling path only.
        let webhookWarning: string | undefined;
        try {
          await registerHeliusWebhook(delegatePubkey);
        } catch (err: unknown) {
          webhookWarning =
            'Helius webhook registration failed — balance/price event latency may be up to 5 minutes. Retry activation to re-register.';
          request.log.error(
            { err, delegatePubkey, ruleId: id },
            'Helius webhook registration failed on rule activation',
          );
        }

        request.log.info({ ruleId: id, userId, status }, 'Rule status updated');
        return reply.send({ ok: true, data: updated, ...(webhookWarning ? { webhookWarning } : {}) });
      }

      request.log.info({ ruleId: id, userId, status }, 'Rule status updated');
      return reply.send({ ok: true, data: updated });
    },
  );

  /**
   * POST /rules/:id/circuit-breaker/reset
   * Clears a PAUSED_CIRCUIT_BREAKER state → PAUSED so the user can investigate
   * failures and then re-activate via PATCH /rules/:id/status.
   * Does NOT re-activate automatically — requires a conscious ACTIVE transition.
   */
  server.post(
    '/:id/circuit-breaker/reset',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();

      const rule = await prisma.rule.findFirst({ where: { id, userId } });
      if (rule === null) {
        return reply.status(404).send({ ok: false, message: 'Rule not found' });
      }
      if (rule.status !== 'PAUSED_CIRCUIT_BREAKER') {
        return reply.status(409).send({
          ok: false,
          message: `Rule is not in PAUSED_CIRCUIT_BREAKER state (current: ${rule.status})`,
        });
      }

      const updated = await prisma.rule.update({
        where: { id },
        data: {
          status: 'PAUSED',
          pauseReason: 'circuit_breaker_manually_reset',
          pausedAt: new Date(),
        },
        select: { id: true, status: true, pauseReason: true, pausedAt: true },
      });

      request.log.info({ ruleId: id, userId }, 'Circuit breaker manually reset to PAUSED');
      return reply.send({ ok: true, data: updated });
    },
  );

  /**
   * DELETE /rules/:id
   * Soft-delete: transitions rule to ARCHIVED.
   */
  server.delete(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();

      const rule = await prisma.rule.findFirst({
        where: { id, userId, NOT: { status: 'ARCHIVED' } },
      });
      if (rule === null) {
        return reply.status(404).send({ ok: false, message: 'Rule not found' });
      }

      await prisma.rule.update({
        where: { id },
        data: { status: 'ARCHIVED', pausedAt: new Date(), pauseReason: 'deleted_by_user' },
      });

      request.log.info({ ruleId: id, userId }, 'Rule archived');
      return reply.send({ ok: true });
    },
  );
}
