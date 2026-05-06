import type { FastifyBaseLogger } from 'fastify';
import {
  REDIS_CHANNEL,
  HeliusWebhookEventSchema,
  type ExecJobPayload,
  type ArchonRule,
} from '@archon/shared';
import { getPrisma } from '../lib/prisma.js';
import { getSubscriber } from '../lib/redis.js';
import { getExecQueue } from '../lib/queue.js';
import { evaluateTrigger, computeIdempotencyKey } from '../lib/evaluate.js';

/**
 * Processes a single webhook event:
 * 1. Parse + validate with Zod
 * 2. Find all agent wallets whose derived agent keypair (delegatePubkey) is in the affected accounts
 * 3. For each active rule on those wallets, evaluate trigger condition
 * 4. On match: compute idempotency key → dispatch to BullMQ exec queue
 */
async function processWebhookEvent(
  rawMessage: string,
  log: FastifyBaseLogger,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    log.warn('Received non-JSON message on webhook channel — discarding');
    return;
  }

  const result = HeliusWebhookEventSchema.safeParse(parsed);
  if (!result.success) {
    log.warn({ detail: result.error.flatten() }, 'Invalid HeliusWebhookEvent schema — discarding');
    return;
  }
  const event = result.data;

  const affectedPubkeys = event.accountData.map((ad) => ad.account);
  if (affectedPubkeys.length === 0) {
    log.debug({ signature: event.signature }, 'Webhook event has no accountData — skipping');
    return;
  }

  const prisma = getPrisma();

  // Match agent wallets whose derived agent keypair (delegatePubkey) was involved in the tx.
  const agentWallets = await prisma.agentWallet.findMany({
    where: { delegatePubkey: { in: affectedPubkeys }, isActive: true },
    include: {
      rules: {
        where: { status: 'ACTIVE' },
        include: { user: { select: { walletPubkey: true } } },
      },
    },
  });

  if (agentWallets.length === 0) return;

  for (const wallet of agentWallets) {
    for (const rule of wallet.rules) {
      if (rule.firesToday >= rule.maxFiresDay) {
        log.warn(
          { ruleId: rule.id, firesToday: rule.firesToday, maxFiresDay: rule.maxFiresDay },
          'Rule daily fire limit reached — skipping',
        );
        continue;
      }

      const parsedRule = rule.parsedRule as unknown as ArchonRule;

      let triggerResult;
      try {
        // Use ownerPubkey (user's wallet) for balance-based trigger evaluation.
        triggerResult = await evaluateTrigger(
          { id: rule.id, parsedRule },
          wallet.ownerPubkey,
          event,
        );
      } catch (err) {
        log.error(
          { ruleId: rule.id, ownerPubkey: wallet.ownerPubkey, err },
          'Trigger evaluation failed',
        );
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
        agentWalletId: wallet.id,
        idempotencyKey,
        triggerEventSig: triggerResult.triggerEventSig,
        triggerSlot: triggerResult.triggerSlot,
        observedValue: triggerResult.observedValue,
        parsedRule,
        isRetry: false,
      };

      const queue = getExecQueue(wallet.id);
      try {
        await queue.add('execute', payload, {
          jobId: idempotencyKey,
          attempts: 1,
          backoff: undefined,
        });

        log.info(
          {
            ruleId: rule.id,
            idempotencyKey,
            agentWalletId: wallet.id,
            observedValue: triggerResult.observedValue,
          },
          'Execution job dispatched to BullMQ',
        );
      } catch (err) {
        log.error(
          { ruleId: rule.id, idempotencyKey, err },
          'Failed to enqueue execution job',
        );
      }
    }
  }
}

export function startConditionWorker(log: FastifyBaseLogger): void {
  const subscriber = getSubscriber();

  subscriber.on('message', (_channel: string, message: string) => {
    processWebhookEvent(message, log).catch((err: unknown) => {
      log.error({ err }, 'Unhandled error in processWebhookEvent');
    });
  });

  subscriber.on('reconnecting', () => {
    log.warn('Redis subscriber reconnecting...');
  });

  subscriber.on('ready', () => {
    log.info({ channel: REDIS_CHANNEL.WEBHOOK_EVENTS }, 'Redis subscriber ready');
  });

  subscriber.subscribe(REDIS_CHANNEL.WEBHOOK_EVENTS).catch((err: unknown) => {
    log.error({ err }, 'Failed to subscribe to webhook events channel');
  });

  log.info(
    { channel: REDIS_CHANNEL.WEBHOOK_EVENTS },
    'Condition evaluator worker started (pending Redis connection)',
  );
}
