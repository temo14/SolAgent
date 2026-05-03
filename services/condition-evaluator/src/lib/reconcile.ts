import type { FastifyBaseLogger } from 'fastify';
import type { ExecJobPayload, SolAgentRule } from '@solagent/shared';
import { RECONCILIATION_INTERVAL_MS } from '@solagent/shared';
import { getPrisma } from './prisma.js';
import { getExecQueue } from './queue.js';
import { evaluateTrigger, computeIdempotencyKey } from './evaluate.js';

/**
 * Performs one reconciliation pass: loads all ACTIVE rules and evaluates
 * their trigger conditions without relying on a webhook event.
 *
 * This is the safety-net fallback (spec §EVENT_DRIVEN_PRIMARY_POLLING_FALLBACK).
 * It runs every 5 minutes. The primary path is webhook-driven.
 */
async function runReconciliation(log: FastifyBaseLogger): Promise<void> {
  const start = Date.now();
  log.info('Reconciliation: starting pass');

  const prisma = getPrisma();

  const rules = await prisma.rule.findMany({
    where: { status: 'ACTIVE' },
    include: {
      agentWallet: { select: { pubkey: true, id: true } },
      user: { select: { walletPubkey: true } },
    },
  });

  log.info({ ruleCount: rules.length }, 'Reconciliation: evaluating rules');

  let dispatched = 0;
  let skipped = 0;

  for (const rule of rules) {
    // Daily fire limit check
    if (rule.firesToday >= rule.maxFiresDay) {
      skipped++;
      continue;
    }

    const parsedRule = rule.parsedRule as unknown as SolAgentRule;

    let triggerResult;
    try {
      // Passing null for event — this is the polling (non-webhook) path
      triggerResult = await evaluateTrigger(
        { id: rule.id, parsedRule },
        rule.agentWallet.pubkey,
        null,
      );
    } catch (err) {
      log.error({ ruleId: rule.id, err }, 'Reconciliation: trigger evaluation failed');
      skipped++;
      continue;
    }

    if (!triggerResult.matched) continue;

    const idempotencyKey = computeIdempotencyKey(
      rule.id,
      triggerResult.triggerEventSig,
      triggerResult.triggerSlot,
    );

    const payload: ExecJobPayload = {
      ruleId: rule.id,
      walletPubkey: rule.user.walletPubkey,
      agentWalletId: rule.agentWallet.id,
      idempotencyKey,
      triggerEventSig: triggerResult.triggerEventSig,
      triggerSlot: triggerResult.triggerSlot,
      observedValue: triggerResult.observedValue,
      parsedRule,
    };

    const queue = getExecQueue(rule.agentWallet.pubkey);
    try {
      await queue.add('execute', payload, {
        jobId: idempotencyKey,
        attempts: 1,
        backoff: undefined,
      });
      dispatched++;
      log.info(
        { ruleId: rule.id, idempotencyKey, observedValue: triggerResult.observedValue },
        'Reconciliation: dispatched execution job',
      );
    } catch (err) {
      log.error({ ruleId: rule.id, idempotencyKey, err }, 'Reconciliation: enqueue failed');
    }
  }

  const elapsed = Date.now() - start;
  log.info(
    { dispatched, skipped, totalRules: rules.length, elapsedMs: elapsed },
    'Reconciliation: pass complete',
  );
}

/**
 * Starts the 5-minute reconciliation loop.
 * Runs immediately on startup, then on the configured interval.
 * Returns the interval handle so callers can clear it on shutdown.
 */
export function startReconciliationLoop(log: FastifyBaseLogger): ReturnType<typeof setInterval> {
  // Run once immediately so the service is useful right after restart
  void runReconciliation(log).catch((err: unknown) => {
    log.error({ err }, 'Reconciliation: initial run failed');
  });

  return setInterval(() => {
    void runReconciliation(log).catch((err: unknown) => {
      log.error({ err }, 'Reconciliation: scheduled run failed');
    });
  }, RECONCILIATION_INTERVAL_MS);
}
