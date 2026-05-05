import type { FastifyBaseLogger } from 'fastify';
import type { ExecJobPayload, SolAgentRule } from '@solagent/shared';
import {
  CRON_RECONCILIATION_INTERVAL_MS,
  RECONCILIATION_INTERVAL_MS,
} from '@solagent/shared';
import { getPrisma } from './prisma.js';
import { getExecQueue } from './queue.js';
import { evaluateTrigger, computeIdempotencyKey } from './evaluate.js';

type ReconcileMode = 'standard' | 'cron';

function includeRuleForMode(parsedRule: SolAgentRule, mode: ReconcileMode): boolean {
  const isCron = parsedRule.trigger.type === 'time_cron';
  return mode === 'cron' ? isCron : !isCron;
}

/**
 * Performs one reconciliation pass: evaluates ACTIVE rules on the polling path (no webhook).
 *
 * `standard` (every 5 min): balance_above/below, price_*, outflow_exceeded — safety net beside webhooks.
 * `cron` (every 60 s): `time_cron` only — minute-aligned idempotency (see evaluate.ts).
 */
async function runReconciliation(log: FastifyBaseLogger, mode: ReconcileMode): Promise<void> {
  const start = Date.now();
  log.info({ mode }, 'Reconciliation: starting pass');

  const prisma = getPrisma();

  const rules = await prisma.rule.findMany({
    where: { status: 'ACTIVE' },
    include: {
      agentWallet: { select: { pubkey: true, id: true } },
      user: { select: { walletPubkey: true } },
    },
  });

  const filtered = rules.filter((rule) =>
    includeRuleForMode(rule.parsedRule as unknown as SolAgentRule, mode),
  );

  log.info(
    { ruleCount: filtered.length, totalActive: rules.length, mode },
    'Reconciliation: evaluating rules',
  );

  let dispatched = 0;
  let skipped = 0;

  for (const rule of filtered) {
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
    { dispatched, skipped, evaluated: filtered.length, mode, elapsedMs: elapsed },
    'Reconciliation: pass complete',
  );
}

/**
 * Starts both reconciliation loops:
 * - standard: 5 min (non-cron triggers)
 * - cron: 60 s (`time_cron` only)
 * Returns `[standardTimer, cronTimer]` for graceful shutdown (both clears).
 */
export function startReconciliationLoop(
  log: FastifyBaseLogger,
): [ReturnType<typeof setInterval>, ReturnType<typeof setInterval>] {
  void runReconciliation(log, 'standard').catch((err: unknown) => {
    log.error({ err }, 'Reconciliation: initial standard pass failed');
  });
  void runReconciliation(log, 'cron').catch((err: unknown) => {
    log.error({ err }, 'Reconciliation: initial cron pass failed');
  });

  const standardTimer = setInterval(() => {
    void runReconciliation(log, 'standard').catch((err: unknown) => {
      log.error({ err }, 'Reconciliation: standard scheduled run failed');
    });
  }, RECONCILIATION_INTERVAL_MS);

  const cronTimer = setInterval(() => {
    void runReconciliation(log, 'cron').catch((err: unknown) => {
      log.error({ err }, 'Reconciliation: cron scheduled run failed');
    });
  }, CRON_RECONCILIATION_INTERVAL_MS);

  return [standardTimer, cronTimer];
}
