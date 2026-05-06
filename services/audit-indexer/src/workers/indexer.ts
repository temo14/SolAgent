import IORedis from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import { Prisma } from '@prisma/client';

import { REDIS_CHANNEL, type ExecResult, type MemoProofV1 } from '@archon/shared';
import { getPrisma } from '../lib/prisma.js';

/** Anomaly threshold multiplier: flag if observed > threshold × ANOMALY_FACTOR */
const ANOMALY_FACTOR = 10;

function getRedisOpts() {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

/**
 * Checks if the observed value in a MemoProofV1 exceeds the trigger threshold
 * by ANOMALY_FACTOR × to flag for review.
 */
function detectAnomaly(memo: MemoProofV1): boolean {
  if (!memo.trig) return false;
  return memo.trig.observed > memo.trig.threshold * ANOMALY_FACTOR;
}

/**
 * Upserts an AuditEvent row for a confirmed execution.
 * Idempotent: re-indexing the same txSignature is a no-op (unique constraint).
 */
async function indexExecResult(result: ExecResult, log: FastifyBaseLogger): Promise<void> {
  if (result.status !== 'CONFIRMED' || !result.txSignature) {
    // Only index on-chain confirmations; other statuses are in execution_log.
    return;
  }

  const prisma = getPrisma();
  const isAnomalous = result.memoProof ? detectAnomaly(result.memoProof) : false;

  try {
    await prisma.auditEvent.upsert({
      where: { txSignature: result.txSignature },
      create: {
        walletPubkey: result.walletPubkey,
        txSignature: result.txSignature,
        ruleId: result.ruleId,
        eventType: 'EXECUTION_CONFIRMED',
        payload: (result.memoProof ?? {}) as Prisma.InputJsonValue,
        isAnomalous,
        idempotencyKey: result.idempotencyKey,
      },
      update: {
        // Re-index: update memo proof if it changed (shouldn't happen in practice).
        payload: (result.memoProof ?? {}) as Prisma.InputJsonValue,
        isAnomalous,
      },
    });

    if (isAnomalous) {
      log.warn(
        { txSignature: result.txSignature, walletPubkey: result.walletPubkey },
        'Anomaly detected: observed value exceeds 10× threshold',
      );
    } else {
      log.info({ txSignature: result.txSignature, ruleId: result.ruleId }, 'AuditEvent indexed');
    }
  } catch (err) {
    log.error({ txSignature: result.txSignature, err }, 'Failed to upsert AuditEvent');
  }
}

/**
 * Subscribes to the EXEC_RESULT_ALL Redis channel and indexes each confirmed
 * execution into the audit_event table.
 *
 * Non-blocking: Redis reconnects automatically if unavailable.
 */
export function startIndexerWorker(log: FastifyBaseLogger): void {
  const subscriber = getRedisOpts();

  subscriber.on('error', (err: Error) => log.warn({ err }, 'Audit-indexer Redis error'));
  subscriber.on('reconnecting', () => log.info('Audit-indexer Redis reconnecting…'));
  subscriber.on('ready', () => log.info('Audit-indexer Redis connected'));

  // Subscribe to the fan-out channel published by execution-engine.
  subscriber.subscribe(REDIS_CHANNEL.EXEC_RESULT).catch((err: unknown) => {
    log.error({ err }, 'Failed to subscribe to exec-result channel');
  });

  subscriber.on('message', (_channel: string, raw: string) => {
    let result: ExecResult;
    try {
      result = JSON.parse(raw) as ExecResult;
    } catch {
      log.warn({ raw }, 'Malformed exec-result message — skipped');
      return;
    }
    void indexExecResult(result, log);
  });

  log.info({ channel: REDIS_CHANNEL.EXEC_RESULT }, 'Audit indexer worker started');
}
