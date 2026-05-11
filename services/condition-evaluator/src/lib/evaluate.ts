import { createHash } from 'crypto';
import {
  type ArchonRule,
  type HeliusWebhookEvent,
  TOKEN_MINTS,
  getHourInTimeZone,
  isValidIanaTimeZone,
} from '@archon/shared';
import { getSolBalanceLamports, getCurrentSlot, getSplTokenBalance, LAMPORTS_PER_SOL } from './rpc.js';
import { getAssetPriceUsd } from './price.js';
import { getPrisma } from './prisma.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function resolveMintAddress(asset: string): string | null {
  if (BASE58_RE.test(asset)) return asset;
  return TOKEN_MINTS[asset.toUpperCase()] ?? null;
}

// ─── Idempotency ──────────────────────────────────────────────────────────────

/**
 * Computes the idempotency key for an execution attempt.
 *
 * Formula (spec §IDEMPOTENCY):
 *   SHA-256(rule_id + ":" + trigger_event_signature + ":" + trigger_slot)
 *
 * For polling-path events: trigger_event_signature = "poll:<ruleId>:<epoch-bucket>"
 * - Non-cron: bucket = Math.floor(unixSeconds / 300) — one per 5-min window.
 * - time_cron: bucket = Math.floor(unixSeconds / 60) — one per minute (matches cron tick).
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
  rule: { id: string; parsedRule: ArchonRule },
  agentPubkey: string,
  event: HeliusWebhookEvent | null,
): Promise<TriggerMatch> {
  const { trigger } = rule.parsedRule;

  // Polling-path idempotency: 5-minute buckets except time_cron (per-minute buckets).
  const nowSec = Math.floor(Date.now() / 1000);
  const pollBucket =
    event === null && trigger.type === 'time_cron'
      ? Math.floor(nowSec / 60)
      : Math.floor(nowSec / 300);
  const eventSig = event?.signature ?? `poll:${rule.id}:${pollBucket}`;
  const eventSlot = event?.slot ?? (await getCurrentSlot());

  switch (trigger.type) {
    case 'balance_below':
    case 'balance_above': {
      if (trigger.asset === 'SOL') {
        const lamports = await getSolBalanceLamports(agentPubkey);
        const sol = lamports / LAMPORTS_PER_SOL;
        const matched =
          trigger.type === 'balance_below' ? sol < trigger.threshold : sol > trigger.threshold;
        return { matched, observedValue: sol, triggerEventSig: eventSig, triggerSlot: eventSlot };
      }
      // SPL token balance
      const mint = resolveMintAddress(trigger.asset);
      if (!mint) return NOT_MATCHED(eventSig, eventSlot);
      const balance = await getSplTokenBalance(agentPubkey, mint);
      const matched =
        trigger.type === 'balance_below'
          ? balance < trigger.threshold
          : balance > trigger.threshold;
      return { matched, observedValue: balance, triggerEventSig: eventSig, triggerSlot: eventSlot };
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

      // End-time: prefer local wall-clock in schedule_timezone (browser IANA at rule create).
      // Comparison is strictly-greater-than so the rule fires through the target hour
      // ("until 4 PM" fires at 4:xx PM and stops at 5 PM).
      if (
        trigger.until_local_hour !== undefined &&
        trigger.schedule_timezone !== undefined &&
        isValidIanaTimeZone(trigger.schedule_timezone)
      ) {
        const localH = getHourInTimeZone(trigger.schedule_timezone);
        if (localH !== null && localH > trigger.until_local_hour) {
          return NOT_MATCHED(eventSig, eventSlot);
        }
      } else if (trigger.until_utc_hour !== undefined) {
        const nowHourUtc = new Date().getUTCHours();
        if (nowHourUtc > trigger.until_utc_hour) {
          return NOT_MATCHED(eventSig, eventSlot);
        }
      }

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
      // TODO: replace with a _sum aggregate once executedAmountUsd is a dedicated column.
      const logs = await prisma.executionLog.findMany({
        where: {
          ruleId: rule.id,
          status: 'CONFIRMED',
          createdAt: { gte: windowStart },
        },
        select: { memoJson: true },
        take: 1000,
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

// ─── Full cron matcher ────────────────────────────────────────────────────────

/**
 * Evaluates a standard 5-field cron expression against the current UTC time.
 *
 * Supported syntax per field (minute, hour, dom, month, dow):
 *   *         — any value
 *   N         — exact value
 *   N,M,...   — list of values
 *   N-M       — inclusive range
 *   *\/N       — step (every N units from the range start)
 *   N-M\/S     — range with step
 *
 * DOM/DOW semantics follow vixie-cron: when BOTH dom and dow are restricted
 * (neither is "*"), a match on EITHER satisfies the day condition (OR logic).
 * When only one is restricted the other acts as wildcard (AND logic).
 *
 * Examples:
 *   "* * * * *"     every minute
 *   "*\/5 * * * *"   every 5 minutes
 *   "0 9 * * 1-5"   weekdays at 09:00
 *   "0 12 15,20 * *" 15th and 20th of each month at noon
 */
function matchesCronExpression(expression: string): boolean {
  if (!expression) return false;
  let parts = expression.trim().split(/\s+/);

  // Accept 6-field expressions (seconds-prefixed) — drop the seconds field.
  if (parts.length === 6) parts = parts.slice(1);
  if (parts.length !== 5) return false;

  const now = new Date();
  const curMin  = now.getUTCMinutes();
  const curHour = now.getUTCHours();
  const curDom  = now.getUTCDate();
  const curMon  = now.getUTCMonth() + 1;
  const curDow  = now.getUTCDay();

  function matchField(part: string, value: number, lo: number, hi: number): boolean {
    if (part === '*') return true;
    for (const segment of part.split(',')) {
      const slashIdx = segment.indexOf('/');
      if (slashIdx !== -1) {
        const step = parseInt(segment.slice(slashIdx + 1), 10);
        if (isNaN(step) || step <= 0) continue;
        const rangePart = segment.slice(0, slashIdx);
        let start = lo;
        let end   = hi;
        if (rangePart !== '*') {
          const dashIdx = rangePart.indexOf('-');
          if (dashIdx !== -1) {
            start = parseInt(rangePart.slice(0, dashIdx), 10);
            end   = parseInt(rangePart.slice(dashIdx + 1), 10);
          } else {
            start = parseInt(rangePart, 10);
          }
        }
        if (!isNaN(start) && !isNaN(end) && value >= start && value <= end && (value - start) % step === 0) return true;
        continue;
      }
      const dashIdx = segment.indexOf('-');
      if (dashIdx !== -1) {
        const start = parseInt(segment.slice(0, dashIdx), 10);
        const end   = parseInt(segment.slice(dashIdx + 1), 10);
        if (!isNaN(start) && !isNaN(end) && value >= start && value <= end) return true;
        continue;
      }
      if (parseInt(segment, 10) === value) return true;
    }
    return false;
  }

  const [minPart, hourPart, domPart, monPart, dowPart] = parts;

  if (!matchField(minPart,  curMin,  0, 59)) return false;
  if (!matchField(hourPart, curHour, 0, 23)) return false;
  if (!matchField(monPart,  curMon,  1, 12)) return false;

  // Vixie-cron DOM/DOW OR semantics
  const domRestricted = domPart !== '*';
  const dowRestricted = dowPart !== '*';
  if (domRestricted && dowRestricted) {
    return matchField(domPart, curDom, 1, 31) || matchField(dowPart, curDow, 0, 6);
  }
  return matchField(domPart, curDom, 1, 31) && matchField(dowPart, curDow, 0, 6);
}
