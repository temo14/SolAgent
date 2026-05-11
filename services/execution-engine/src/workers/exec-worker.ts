import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Keypair, type TransactionInstruction } from '@solana/web3.js';
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

import {
  execQueueName,
  EXEC_QUEUE_CONCURRENCY,
  PRICE_DEVIATION_THRESHOLD,
  PRICE_DEV_REQUEUE_DELAY_MS,
  TX_CONFIRMATION_TIMEOUT_MS,
  DEFAULT_MAX_FIRES_PER_DAY,
  REDIS_CHANNEL,
  ExecStatus,
  ERROR_CODES,
  type ExecJobPayload,
  type ExecResult,
} from '@archon/shared';

import { getPrisma } from '../lib/prisma.js';
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
import {
  deriveMandatePda,
  fetchMandateStatus,
  buildRecordExecutionInstruction,
} from '../lib/mandate.js';
import { deriveAgentKeypair } from '../lib/crypto.js';

/** Minimum SOL the agent wallet must retain after fees (0.01 SOL). */
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
      select: { isActive: true, ownerPubkey: true, mandatePda: true },
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
      await emitResult({ ruleId, walletPubkey, idempotencyKey, status: 'CIRCUIT_BREAKER_HALT', errorCode: ERROR_CODES.CIRCUIT_RULE_BREAKER });
      return;
    }

    // ── 6. Derive per-user agent keypair ────────────────────────────────────
    const agentKeypair = deriveAgentKeypair(agentWallet.ownerPubkey);

    const { action } = parsedRule;

    // ── 7. Dual-oracle price check for SWAP actions ─────────────────────────
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

        if (!isRetry) {
          const retryQueue = getExecQueue(agentWalletId);
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

    // ── 8. Agent wallet SOL balance check ──────────────────────────────────
    const agentKeypairPubkey = agentKeypair.publicKey.toBase58();
    const solBalance = await getSolBalance(agentKeypairPubkey);
    if (solBalance < MINIMUM_SOL_RESERVE) {
      await setStatus('INSUFFICIENT_FUNDS', { errorCode: 'EXEC_INSUFFICIENT_FUNDS' });
      await emitResult({ ruleId, walletPubkey, idempotencyKey, status: 'INSUFFICIENT_FUNDS', errorCode: 'EXEC_INSUFFICIENT_FUNDS' });
      log.warn({ agentWalletId, agentKeypairPubkey, solBalance }, 'Insufficient agent wallet funds for execution');
      return;
    }

    // ── 9. Mandate gate ───────────────────────────────────────────────────────
    // If the agent wallet has a mandatePda recorded, the mandate check is REQUIRED.
    // An RPC error when a mandate exists aborts execution — we never silently
    // bypass spending limits the user set on-chain.
    let mandateIx: TransactionInstruction | null = null;
    const hasMandateInDb = Boolean(agentWallet.mandatePda);
    {
      const { PublicKey: PK } = await import('@solana/web3.js');
      const ownerPubkey = new PK(agentWallet.ownerPubkey);
      const mandatePda = deriveMandatePda(ownerPubkey);
      const mandateStatus = await fetchMandateStatus(mandatePda);

      if (mandateStatus.kind === 'rpc_error') {
        if (hasMandateInDb) {
          await setStatus('CIRCUIT_BREAKER_HALT', { errorCode: 'MANDATE_CHECK_FAILED' });
          log.error({ ruleId, err: mandateStatus.error }, 'Mandate RPC error with DB mandate — execution halted');
          return;
        }
        log.warn({ ruleId, err: mandateStatus.error }, 'Mandate RPC error for non-mandate wallet — proceeding');
      } else if (mandateStatus.kind === 'not_found') {
        if (hasMandateInDb) {
          await setStatus('CIRCUIT_BREAKER_HALT', { errorCode: 'MANDATE_NOT_FOUND' });
          log.error({ ruleId }, 'Mandate PDA not found on-chain — execution halted');
          return;
        }
        // Legacy wallet with no mandate — no restrictions apply.
      } else if (mandateStatus.kind === 'revoked') {
        await setStatus('CIRCUIT_BREAKER_HALT', { errorCode: 'MANDATE_REVOKED' });
        log.warn({ ruleId }, 'Mandate is revoked — execution halted');
        return;
      } else if (mandateStatus.kind === 'active') {
        let lamports = 0n;
        if (action.type === 'transfer') {
          lamports = BigInt(Math.floor(action.amount * 1_000_000_000));
        } else if (action.type === 'swap' && action.from_asset === 'SOL' && savedQuoteResponse) {
          lamports = BigInt((savedQuoteResponse as { inAmount?: string }).inAmount ?? '0');
        } else if (action.type === 'swap' && action.to_asset === 'SOL' && savedQuoteResponse) {
          lamports = BigInt((savedQuoteResponse as { outAmount?: string }).outAmount ?? '0');
        }
        if (lamports > 0n) {
          mandateIx = buildRecordExecutionInstruction(mandatePda, agentKeypair.publicKey, lamports);
          log.info({ ruleId, lamports: lamports.toString() }, 'Mandate gate: record_execution prepended');
        }
      }
    }

    // ── 10. Build transaction ────────────────────────────────────────────────
    const memoProof = buildMemoProof({
      ruleId,
      agentWalletPubkey: agentWallet.ownerPubkey,
      parsedRule,
      triggerSlot,
      observedValue,
      priceUsed: pythPriceUsd,
      priceSrc: pythPriceUsd !== undefined ? 'jupiter+pyth' : 'none',
    });
    const memoIx = buildMemoInstruction(memoProof, agentKeypair.publicKey);

    let mainInstructions;
    let altAddresses: string[] = [];

    if (action.type === 'swap' && action.from_asset && action.to_asset) {
      // Re-fetch a fresh quote at build time — the oracle-check quote (step 7)
      // can be 30+ seconds old by the time we reach this step and may be rejected.
      const freshQuoteResult = await getJupiterQuote(
        action.from_asset,
        action.to_asset,
        action.amount,
        action.max_slippage_bps,
      );
      const swapIxs = await getJupiterSwapInstructions(
        freshQuoteResult.quoteResponse,
        agentKeypair.publicKey.toBase58(),
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
          agentKeypair.publicKey,
          new PublicKey(action.recipient),
          action.amount,
        ),
      ];
    } else {
      if (action.type === 'pause_all') {
        await prisma.rule.update({ where: { id: ruleId }, data: { status: 'PAUSED' } });
      }
      await setStatus('CONFIRMED', { confirmedAt: new Date() });
      await emitResult({ ruleId, walletPubkey, idempotencyKey, status: 'CONFIRMED' });
      log.info({ ruleId, actionType: action.type }, 'Alert-only / pause-all action completed');
      return;
    }

    const lookupTables = altAddresses.length > 0 ? await loadLookupTables(altAddresses) : [];
    const ixList = [
      ...(mandateIx ? [mandateIx] : []),
      ...mainInstructions,
      memoIx,
    ];
    const { tx, blockhash, lastValidBlockHeight } = await buildVersionedTransaction(
      agentKeypair.publicKey,
      ixList,
      lookupTables,
    );
    tx.sign([agentKeypair]);

    // ── 10.5 Pre-send balance re-check ──────────────────────────────────────
    // Re-verify balance immediately before broadcast — it could have changed
    // during the mandate / quote / build steps above.
    const solBalancePreSend = await getSolBalance(agentKeypairPubkey);
    if (solBalancePreSend < MINIMUM_SOL_RESERVE) {
      await setStatus('INSUFFICIENT_FUNDS', { errorCode: 'EXEC_INSUFFICIENT_FUNDS' });
      await emitResult({ ruleId, walletPubkey, idempotencyKey, status: 'INSUFFICIENT_FUNDS', errorCode: 'EXEC_INSUFFICIENT_FUNDS' });
      log.warn({ ruleId, agentKeypairPubkey, solBalancePreSend }, 'Insufficient funds detected pre-send — aborting');
      return;
    }

    // ── 11. Send and wait ────────────────────────────────────────────────────
    log.info({ ruleId, agentKeypairPubkey }, 'Sending transaction');
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

    // ── 12. Mark confirmed, increment firesToday ─────────────────────────────
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
 * Queue names are now keyed by agentWalletId (UUID) — not by pubkey.
 */
export async function startWorkerRegistry(log: FastifyBaseLogger): Promise<void> {
  const prisma = getPrisma();

  // Verify AGENT_KEY_MASTER is set at startup so we fail fast on misconfiguration.
  if (!process.env.AGENT_KEY_MASTER) {
    log.error('AGENT_KEY_MASTER env var is missing — all executions will fail until fixed');
  } else {
    log.info('Agent key master loaded — per-user keypairs will be derived at execution time');
  }

  const wallets = await prisma.agentWallet.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  for (const w of wallets) {
    ensureWorkerForQueue(execQueueName(w.id), log);
  }

  log.info({ count: wallets.length }, 'Execution workers bootstrapped');

  const subscriber = getRedisOpts();
  subscriber.on('error', (err) => log.warn({ err }, 'Worker-registry Redis error'));

  subscriber.subscribe(REDIS_CHANNEL.RULE_ACTIVATED).catch((err: unknown) => {
    log.warn({ err }, 'Failed to subscribe to rule-activated channel');
  });

  subscriber.on('message', (_channel: string, message: string) => {
    try {
      const { agentWalletId } = JSON.parse(message) as { agentWalletId?: string };
      if (!agentWalletId) return;
      const queueName = execQueueName(agentWalletId);
      ensureWorkerForQueue(queueName, log);
    } catch {
      // ignore malformed messages
    }
  });
}

export async function shutdownWorkers(): Promise<void> {
  await Promise.all([...activeWorkers.values()].map((w) => w.close()));
  activeWorkers.clear();
}
