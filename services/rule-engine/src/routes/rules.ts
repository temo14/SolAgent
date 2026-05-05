import { createHash } from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES, REDIS_CHANNEL, isValidIanaTimeZone } from '@solagent/shared';
import { getPrisma } from '../lib/prisma.js';
import { parseRuleWithQvac, QvacError } from '../lib/qvac.js';
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

function computeRuleHash(parsedRule: unknown): string {
  // Deterministic: sort keys before hashing
  const canonical = JSON.stringify(parsedRule, Object.keys(parsedRule as object).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function ruleRoutes(server: FastifyInstance): Promise<void> {
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
        parsedRule = await parseRuleWithQvac(rawInput);
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

      const { agentWalletId, rawInput, maxAmountUsd, maxFiresPerDay, clientTimezone } =
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

      // Parse via QVAC (mandatory — returns 503 on unavailability)
      let parsedRule;
      try {
        parsedRule = await parseRuleWithQvac(rawInput);
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
          agentWallet: { select: { pubkey: true } },
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
          where: { userId, ...(status !== undefined ? { status } : {}) },
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
            agentWallet: { select: { pubkey: true, id: true } },
            _count: { select: { executions: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.rule.count({ where: { userId, ...(status !== undefined ? { status } : {}) } }),
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
          agentWallet: { select: { pubkey: true } },
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
        include: { agentWallet: { select: { pubkey: true } } },
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
        const agentWalletPubkey = ruleWithWallet.agentWallet.pubkey;

        // Publish to Redis so execution-engine spins up a per-wallet worker
        const { getPublisher } = await import('../lib/redis.js');
        getPublisher()
          .publish(
            REDIS_CHANNEL.RULE_ACTIVATED,
            JSON.stringify({ ruleId: id, agentWalletPubkey }),
          )
          .catch((err: unknown) =>
            request.log.warn({ err, ruleId: id }, 'Failed to publish rule-activated event'),
          );

        // Register agent wallet with Helius enhanced webhook (non-fatal on error)
        registerHeliusWebhook(agentWalletPubkey).catch((err: unknown) =>
          request.log.warn(
            { err, agentWalletPubkey, ruleId: id },
            'Helius webhook registration failed — manual registration may be needed',
          ),
        );
      }

      request.log.info({ ruleId: id, userId, status }, 'Rule status updated');
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
