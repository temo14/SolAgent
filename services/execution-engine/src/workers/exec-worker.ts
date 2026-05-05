import { Job, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { Keypair } from '@solana/web3.js';
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

import {
  execQueueName,
  EXEC_QUEUE_CONCURRENCY,
  PRICE_DEVIATION_THRESHOLD,
  PRICE_DEV_REQUEUE_DELAY_MS,
  TX_CONFIRMATION_TIMEOUT_MS,
  DEFAULT_MAX_FIRES_PER_DAY,
  ExecStatus,
  type ExecJobPayload,
  type ExecResult,
} from '@solagent/shared';

import { getPrisma } from '../lib/prisma.js';
import { decryptAgentKeypair } from '../lib/crypto.js';
import {
  getSolBalance,
  loadLookupTables,
  buildTransferInstruction,
  buildVersionedTransaction,
  sendAndConfirm,
} from '../lib/rpc.js';
import { getJupiterQuote, getJupiterSwapInstructions } from '../lib/jupiter.js';
import { dualOracleCheck } from '../lib/pyth.js';
import { buildMemoProof, buildMemoInstruction } from '../lib/memo.js';
import { isCircuitBreakerTripped, triggerCircuitBreaker } from '../lib/circuit-breaker.js';
import { publishExecResult } from '../lib/redis.js';
import { getExecQueue } from '../lib/queue.js';

/** Minimum SOL balance the agent wallet must retain after fees (0.01 SOL). */
const MINIMUM_SOL_RESERVE = 0.01;

// ─── Active worker registry (per-wallet queue) ────────────────────────────────

const activeWorkers = new Map<string, Worker>();

function getRedisOpts() {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// ─── Core job processor ──────────────────────────────────────────────────────

async function processExecJob(job: Job<ExecJobPayload>, log: FastifyBaseLogger): Promise<void> {
  const { ruleId, walletPubkey, agentWalletId, idempotencyKey, parsedRule, observedValue,
    triggerEventSig, triggerSlot, isRetry } = job.data;

  const prisma = getPrisma();

  // ── 1. Idempotency gate ─────────────────────────────────────────────────────
  let execLogId: string;

  if (isRetry) {
    // Price-deviation retry: update the existing PRICE_DEVIATION_ABORT record back to PROCESSING.
    const existing = await prisma.executionLog.findUnique({ where: { idempotencyKey } });
    if (!existing) {
      log.warn({ idempotencyKey }, 'Retry job found no existing execution log — discarding');
      return;
    }
    await prisma.executionLog.update({
      where: { id: existing.id },
      data: { status: 'PROCESSING', errorCode: null, errorDetail: null },
    });
    execLogId = existing.id;
  } else {
    try {
      const row = await prisma.executionLog.create({
        data: {
          ruleId,
          idempotencyKey,
          status: 'PROCESSING',
          triggerEventSig,
          triggerSlot: BigInt(triggerSlot),
        },
        select: { id: true },
      });
      execLogId = row.id;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        log.info({ idempotencyKey }, 'Duplicate execution — discarded');
        return;
      }
      throw err;
    }
  }

  const setStatus = async (
    status: string,
    extra: Record<string, unknown> = {},
  ) => {
    await prisma.executionLog.update({
      where: { id: execLogId },
      data: { status, ...extra } as Parameters<typeof prisma.executionLog.update>[0]['data'],
    });
  };

  const emitResult = async (result: Omit<ExecResult, 'timestamp'>) => {
    await publishExecResult({ ...result, timestamp: new Date().toISOString() }).catch(() => undefined);
  };

  try {
    // ── 2. Stale condition check ──────────────────────────────────────────────
    const rule = await prisma.rule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.status !== 'ACTIVE') {
      await setStatus('STALE_CONDITION');
      log.info({ ruleId, ruleStatus: rule?.status }, 'Stale condition — skipped');
      return;
    }

    // ── 3. Daily fires guard ──────────────────────────────────────────────────
    const maxFires = parsedRule.conditions.max_fires_per_day ?? DEFAULT_MAX_FIRES_PER_DAY;
    if ((rule.firesToday ?? 0) >= maxFires) {
      await setStatus('STALE_CONDITION', { errorDetail: 'max_fires_per_day exceeded' });
      log.info({ ruleId, firesToday: rule.firesToday, maxFires }, 'Daily fire limit reached');
      return;
    }

    // ── 4. Load agent wallet ─────────────────────────────────────────────────
    const agentWallet = await prisma.agentWallet.findUnique({
      where: { id: agentWalletId },
      include: { user: { select: { walletPubkey: true } } },
    });
    if (!agentWallet?.isActive) {
      await setStatus('FAILED', { errorCode: 'EXEC_SIMULATION_FAIL', errorDetail: 'Agent wallet inactive or not found' });
      return;
    }

    // ── 5. Circuit breaker ──────────────────────────────────────────────────
    const tripped = await isCircuitBreakerTripped(ruleId, prisma);
    if (tripped) {
      await setStatus('CIRCUIT_BREAKER_HALT');
      await triggerCircuitBreaker(ruleId, walletPubkey, prisma);
      log.warn({ ruleId }, 'Circuit breaker tripped — rule paused');
      await emitResult({ ruleId, walletPubkey, idempotencyKey, status: 'CIRCUIT_BREAKER_HALT', errorCode: 'CIRCUIT_RULE_BREAKER' });
      return;
    }

    const { action } = parsedRule;

    // ── 6. Dual-oracle price check for SWAP actions ─────────────────────────
    let pythPriceUsd: number | undefined;
    let priceDeviation: number | undefined;
    let savedQuoteResponse: Awaited<ReturnType<typeof getJupiterQuote>>['quoteResponse'] | undefined;

    if (action.type === 'swap' && action.from_asset && action.to_asset) {
      const quoteResult = await getJupiterQuote(
        action.from_asset,
        action.to_asset,
        action.amount,
        action.max_slippage_bps,
      );
      savedQuoteResponse = quoteResult.quoteResponse;

      const oracleResult = await dualOracleCheck(
        action.from_asset,
        action.to_asset,
        quoteResult.inHuman,
        quoteResult.outHuman,
      );
      pythPriceUsd = oracleResult.pythPriceUsd;
      priceDeviation = oracleResult.deviation;

      if (priceDeviation > PRICE_DEVIATION_THRESHOLD) {
        log.warn(
          { ruleId, pythPriceUsd, priceDeviation },
          'Price deviation exceeds threshold',
        );
        await setStatus('PRICE_DEVIATION_ABORT', {
          pythPrice: pythPriceUsd,
          priceDeviation,
          errorCode: 'EXEC_PRICE_DEVIATION',
        });

        // Re-queue exactly once (only on the first attempt, not the retry).
        if (!isRetry) {
          const retryQueue = getExecQueue(agentWallet.pubkey);
          await retryQueue.add(
            'execute',
            { ...job.data, isRetry: true } satisfies ExecJobPayload,
            {
              delay: PRICE_DEV_REQUEUE_DELAY_MS,
              jobId: `${idempotencyKey}:retry`,
              attempts: 1,
            },
          );
          log.info({ ruleId, delay: PRICE_DEV_REQUEUE_DELAY_MS }, 'Price-deviation retry queued');
        } else {
          log.warn({ ruleId }, 'Price deviation on retry — marking FAILED');
          await setStatus('FAILED', {
            errorCode: 'EXEC_PRICE_DEVIATION',
            errorDetail: `Deviation ${(priceDeviation * 100).toFixed(2)}% on retry — aborted`,
          });
        }
        return;
      }
    }

    // ── 7. Decrypt agent keypair ─────────────────────────────────────────────
    let keypair: Keypair;
    try {
      const secretKey = decryptAgentKeypair(
        agentWallet.encryptedKey as Buffer,
        agentWallet.keyIv as Buffer,
        agentWallet.user.walletPubkey,
      );
      keypair = Keypair.fromSecretKey(secretKey);
    } catch (err) {
      await setStatus('FAILED', { errorCode: 'EXEC_SIMULATION_FAIL', errorDetail: 'Keypair decryption failed' });
      log.error({ agentWalletId, err }, 'Keypair decryption failed');
      return;
    }

    // Sanity-check: derived pubkey must match the stored one.
    if (keypair.publicKey.toBase58() !== agentWallet.pubkey) {
      await setStatus('FAILED', { errorCode: 'EXEC_SIMULATION_FAIL', errorDetail: 'Keypair pubkey mismatch' });
      log.error({ agentWalletId }, 'Keypair pubkey mismatch — aborting');
      return;
    }

    // ── 8. Balance check ────────────────────────────────────────────────────
    const solBalance = await getSolBalance(agentWallet.pubkey);
    if (solBalance < MINIMUM_SOL_RESERVE) {
      await setStatus('INSUFFICIENT_FUNDS', { errorCode: 'EXEC_INSUFFICIENT_FUNDS' });
      await emitResult({ ruleId, walletPubkey, idempotencyKey, status: 'INSUFFICIENT_FUNDS', errorCode: 'EXEC_INSUFFICIENT_FUNDS' });
      log.warn({ agentWalletId, solBalance }, 'Insufficient funds for execution');
      return;
    }

    // ── 9. Build transaction (2-instruction atomicity) ───────────────────────
    const memoProof = buildMemoProof({
      ruleId,
      agentWalletPubkey: agentWallet.pubkey,
      parsedRule,
      triggerSlot,
      observedValue,
      priceUsed: pythPriceUsd,
      priceSrc: pythPriceUsd !== undefined ? 'jupiter+pyth' : 'none',
    });
    const memoIx = buildMemoInstruction(memoProof, keypair.publicKey);

    let mainInstructions;
    let altAddresses: string[] = [];

    if (action.type === 'swap' && action.from_asset && action.to_asset) {
      if (!savedQuoteResponse) {
        throw new Error('savedQuoteResponse missing — price check must have been skipped');
      }
      const swapIxs = await getJupiterSwapInstructions(
        savedQuoteResponse,
        keypair.publicKey.toBase58(),
      );
      mainInstructions = swapIxs.instructions;
      altAddresses = swapIxs.altAddresses;
    } else if (action.type === 'transfer') {
      if (!action.recipient) {
        await setStatus('FAILED', { errorCode: 'EXEC_SIMULATION_FAIL', errorDetail: 'Transfer recipient not specified' });
        return;
      }
      const { PublicKey } = await import('@solana/web3.js');
      mainInstructions = [
        buildTransferInstruction(
          keypair.publicKey,
          new PublicKey(action.recipient),
          action.amount,
        ),
      ];
    } else {
      // alert_only / pause_all — no on-chain action; emit result and return.
      if (action.type === 'pause_all') {
        await prisma.rule.update({ where: { id: ruleId }, data: { status: 'PAUSED' } });
      }
      await setStatus('CONFIRMED', { confirmedAt: new Date() });
      await emitResult({ ruleId, walletPubkey, idempotencyKey, status: 'CONFIRMED' });
      log.info({ ruleId, actionType: action.type }, 'Alert-only / pause-all action completed');
      return;
    }

    const lookupTables = altAddresses.length > 0 ? await loadLookupTables(altAddresses) : [];
    const { tx, blockhash, lastValidBlockHeight } = await buildVersionedTransaction(
      keypair.publicKey,
      [...mainInstructions, memoIx],
      lookupTables,
    );
    tx.sign([keypair]);

    // ── 10. Send and wait (60 s, no auto-retry on timeout) ──────────────────
    log.info({ ruleId, agentWalletPubkey: agentWallet.pubkey }, 'Sending transaction');
    const { signature, confirmed } = await sendAndConfirm(
      tx,
      blockhash,
      lastValidBlockHeight,
      TX_CONFIRMATION_TIMEOUT_MS,
    );

    if (!confirmed) {
      await setStatus('FAILED', {
        txSignature: signature,
        errorCode: 'EXEC_TIMEOUT',
        errorDetail: 'Transaction not confirmed within 60 s — manual retry required',
      });
      await emitResult({ ruleId, walletPubkey, idempotencyKey, status: 'FAILED', txSignature: signature, errorCode: 'EXEC_TIMEOUT' });
      log.warn({ ruleId, signature }, 'Transaction confirmation timed out');
      return;
    }

    // ── 11. Mark confirmed, increment firesToday ─────────────────────────────
    await prisma.$transaction([
      prisma.executionLog.update({
        where: { id: execLogId },
        data: {
          status: 'CONFIRMED',
          txSignature: signature,
          memoJson: memoProof as unknown as Prisma.InputJsonValue,
          confirmedAt: new Date(),
          pythPrice: pythPriceUsd,
          priceDeviation,
        },
      }),
      prisma.rule.update({
        where: { id: ruleId },
        data: { firesToday: { increment: 1 } },
      }),
    ]);

    await emitResult({ ruleId, walletPubkey, idempotencyKey, status: 'CONFIRMED', txSignature: signature, memoProof });
    log.info({ ruleId, signature }, 'Execution confirmed');
  } catch (err) {
    log.error({ ruleId, idempotencyKey, err }, 'Unexpected execution error');
    await setStatus('FAILED', {
      errorCode: 'EXEC_SIMULATION_FAIL',
      errorDetail: err instanceof Error ? err.message : String(err),
    }).catch(() => undefined);
    await emitResult({ ruleId, walletPubkey, idempotencyKey, status: 'FAILED', errorCode: 'EXEC_SIMULATION_FAIL' });
    throw err;
  }
}

// ─── Worker registry ─────────────────────────────────────────────────────────

/**
 * Starts a BullMQ Worker (concurrency=1) for the given queue name
 * if one is not already running.
 */
export function ensureWorkerForQueue(queueName: string, log: FastifyBaseLogger): void {
  if (activeWorkers.has(queueName)) return;

  const connection = getRedisOpts();
  const worker = new Worker(
    queueName,
    (job: Job<ExecJobPayload>) => processExecJob(job, log),
    { connection, concurrency: EXEC_QUEUE_CONCURRENCY },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, queueName, err }, 'BullMQ job marked failed');
  });
  worker.on('error', (err) => {
    log.error({ queueName, err }, 'BullMQ worker error');
  });

  activeWorkers.set(queueName, worker);
  log.info({ queueName }, 'Execution worker started');
}

/**
 * Bootstraps workers for all currently active agent wallets,
 * then subscribes to RULE_ACTIVATED for future wallets.
 */
export async function startWorkerRegistry(log: FastifyBaseLogger): Promise<void> {
  const prisma = getPrisma();

  // Load all wallets that already have queues that might contain jobs.
  const wallets = await prisma.agentWallet.findMany({
    where: { isActive: true },
    select: { pubkey: true },
  });

  for (const w of wallets) {
    ensureWorkerForQueue(execQueueName(w.pubkey), log);
  }

  log.info({ count: wallets.length }, 'Execution workers bootstrapped');

  // Subscribe to new-wallet events so we spin up workers dynamically.
  const subscriber = getRedisOpts();
  subscriber.on('error', (err) => log.warn({ err }, 'Worker-registry Redis error'));

  subscriber.subscribe('solagent:rule:activated').catch((err: unknown) => {
    log.warn({ err }, 'Failed to subscribe to rule-activated channel');
  });

  subscriber.on('message', (_channel: string, message: string) => {
    try {
      const { agentWalletPubkey } = JSON.parse(message) as { agentWalletPubkey?: string };
      if (!agentWalletPubkey) return;
      const queueName = execQueueName(agentWalletPubkey);
      ensureWorkerForQueue(queueName, log);
    } catch {
      // ignore malformed messages
    }
  });
}

/**
 * Gracefully shuts down all active workers.
 */
export async function shutdownWorkers(): Promise<void> {
  await Promise.all([...activeWorkers.values()].map((w) => w.close()));
  activeWorkers.clear();
}
