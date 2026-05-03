import { createHash } from 'crypto';
import type { SolAgentRule, HeliusWebhookEvent } from '@solagent/shared';
import { getSolBalance, getCurrentSlot, LAMPORTS_PER_SOL } from './rpc.js';
import { getAssetPriceUsd } from './price.js';
import { getPrisma } from './prisma.js';

// ─── Idempotency ──────────────────────────────────────────────────────────────

/**
 * Computes the idempotency key for an execution attempt.
 *
 * Formula (spec §IDEMPOTENCY):
 *   SHA-256(rule_id + ":" + trigger_event_signature + ":" + trigger_slot)
 *
 * For polling-path events: trigger_event_signature = "poll:<ruleId>:<epoch-bucket>"
 * where epoch-bucket = Math.floor(unixSeconds / 300) — one bucket per 5-min window.
 * This prevents the reconciliation loop from firing the same rule twice per window.
 */
export function computeIdempotencyKey(
  ruleId: string,
  triggerEventSig: string,
  triggerSlot: number,
): string {
  return createHash('sha256')
    .update(`${ruleId}:${triggerEventSig}:${triggerSlot}`)
    .digest('hex');
}

// ─── Trigger evaluation ───────────────────────────────────────────────────────

export interface TriggerMatch {
  matched: boolean;
  observedValue: number;
  triggerEventSig: string;
  triggerSlot: number;
}

const NOT_MATCHED = (sig: string, slot: number): TriggerMatch => ({
  matched: false,
  observedValue: 0,
  triggerEventSig: sig,
  triggerSlot: slot,
});

/**
 * Evaluates a rule's trigger condition against current on-chain state.
 *
 * @param rule       - Rule record with id and parsedRule
 * @param agentPubkey - The agent wallet pubkey to check balances for
 * @param event      - The triggering Helius webhook event (null on polling path)
 * @returns TriggerMatch with matched flag and the observed value
 */
export async function evaluateTrigger(
  rule: { id: string; parsedRule: SolAgentRule },
  agentPubkey: string,
  event: HeliusWebhookEvent | null,
): Promise<TriggerMatch> {
  const { trigger } = rule.parsedRule;

  // Determine event provenance for idempotency key
  const epoch5min = Math.floor(Date.now() / 1000 / 300);
  const eventSig = event?.signature ?? `poll:${rule.id}:${epoch5min}`;
  const eventSlot = event?.slot ?? (await getCurrentSlot());

  switch (trigger.type) {
    case 'balance_below':
    case 'balance_above': {
      if (trigger.asset !== 'SOL') {
        // Token balance evaluation: TODO in Task 5 (requires getParsedTokenAccountsByOwner)
        return NOT_MATCHED(eventSig, eventSlot);
      }
      const lamports = await getSolBalance(agentPubkey);
      const sol = lamports / LAMPORTS_PER_SOL;
      const matched =
        trigger.type === 'balance_below' ? sol < trigger.threshold : sol > trigger.threshold;
      return { matched, observedValue: sol, triggerEventSig: eventSig, triggerSlot: eventSlot };
    }

    case 'price_below':
    case 'price_above': {
      const price = await getAssetPriceUsd(trigger.asset);
      const matched =
        trigger.type === 'price_below' ? price < trigger.threshold : price > trigger.threshold;
      return { matched, observedValue: price, triggerEventSig: eventSig, triggerSlot: eventSlot };
    }

    case 'time_cron': {
      // Cron trigger evaluation handled by the reconciliation loop.
      // cronMatch checks if the current time satisfies the cron expression.
      if (event !== null) return NOT_MATCHED(eventSig, eventSlot); // cron only fires on poll path
      const matches = matchesCronExpression(trigger.cron_expression ?? '');
      return {
        matched: matches,
        observedValue: Date.now() / 1000,
        triggerEventSig: eventSig,
        triggerSlot: eventSlot,
      };
    }

    case 'outflow_exceeded': {
      if (!trigger.window_seconds) return NOT_MATCHED(eventSig, eventSlot);
      const windowStart = new Date(Date.now() - trigger.window_seconds * 1000);
      const prisma = getPrisma();

      // Sum confirmed outflow in the window from execution logs
      const logs = await prisma.executionLog.findMany({
        where: {
          ruleId: rule.id,
          status: 'CONFIRMED',
          createdAt: { gte: windowStart },
        },
        select: { memoJson: true },
      });

      let totalOutflow = 0;
      for (const log of logs) {
        const memo = log.memoJson as { act?: { amount?: number } } | null;
        totalOutflow += memo?.act?.amount ?? 0;
      }

      const matched = totalOutflow > trigger.threshold;
      return {
        matched,
        observedValue: totalOutflow,
        triggerEventSig: eventSig,
        triggerSlot: eventSlot,
      };
    }

    default:
      return NOT_MATCHED(eventSig, eventSlot);
  }
}

// ─── Minimal cron matcher ─────────────────────────────────────────────────────

/**
 * Evaluates a basic 5-field cron expression against the current UTC time.
 * Supports: exact values, "*", and comma-separated lists per field.
 * Field order: minute hour day-of-month month day-of-week
 *
 * Example: "0 12 * * 5" = every Friday at 12:00 UTC
 */
function matchesCronExpression(expression: string): boolean {
  if (!expression) return false;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const now = new Date();
  const [min, hour, dom, mon, dow] = [
    now.getUTCMinutes(),
    now.getUTCHours(),
    now.getUTCDate(),
    now.getUTCMonth() + 1,
    now.getUTCDay(),
  ];
  const fields = [min, hour, dom, mon, dow];

  return parts.every((part, i) => {
    if (part === '*') return true;
    return part.split(',').some((v) => parseInt(v, 10) === fields[i]);
  });
}
