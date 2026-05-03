/**
 * Historical price simulation for rule trigger back-testing.
 *
 * Data source: Pyth Benchmarks TradingView-shim API
 *   GET https://benchmarks.pyth.network/v1/shims/tradingview/history
 *        ?symbol=Crypto.{ASSET}/USD&resolution=15&from=<unix>&to=<unix>
 *
 * Resolution: 15-minute candles, 7-day lookback window.
 * Returns ~672 data points (7d × 24h × 4 bars/h).
 */
import { z } from 'zod';
import type { SolAgentRule } from '@solagent/shared';

// ─── Pyth Benchmarks response schema ─────────────────────────────────────────

const PythBenchmarksResponseSchema = z.object({
  s: z.string(),                       // "ok" | "no_data" | "error"
  t: z.array(z.number()),              // unix timestamps (bar open)
  c: z.array(z.number()),              // close prices (USD)
});

type PythBenchmarksResponse = z.infer<typeof PythBenchmarksResponseSchema>;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface FiringEvent {
  timestamp: string;       // ISO 8601
  observedValue: number;
  hypotheticalAction: string;
}

export interface SimulationResult {
  parsedRule: SolAgentRule;
  totalFires: number;
  firingEvents: FiringEvent[];
  estimatedDailyFires: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PYTH_SYMBOL_MAP: Record<string, string> = {
  SOL:  'Crypto.SOL/USD',
  USDC: 'Crypto.USDC/USD',
  USDT: 'Crypto.USDT/USD',
  JUP:  'Crypto.JUP/USD',
  BONK: 'Crypto.BONK/USD',
};

/** Max candles to return in firingEvents array to avoid huge payloads. */
const MAX_FIRING_EVENTS_RETURNED = 100;

/** 7-day lookback window. */
const LOOKBACK_SECONDS = 7 * 24 * 60 * 60;

async function fetchPythHistory(asset: string): Promise<PythBenchmarksResponse> {
  const symbol = PYTH_SYMBOL_MAP[asset.toUpperCase()];
  if (!symbol) throw new Error(`No Pyth symbol for asset: ${asset}`);

  const to   = Math.floor(Date.now() / 1000);
  const from = to - LOOKBACK_SECONDS;

  const url = new URL('https://benchmarks.pyth.network/v1/shims/tradingview/history');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('resolution', '15');
  url.searchParams.set('from', String(from));
  url.searchParams.set('to', String(to));

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`Pyth Benchmarks HTTP ${res.status} for ${asset}`);
  }

  const body: unknown = await res.json();
  const parsed = PythBenchmarksResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Pyth Benchmarks unexpected shape: ${parsed.error.message}`);
  }
  if (parsed.data.s !== 'ok') {
    throw new Error(`Pyth Benchmarks returned status "${parsed.data.s}" for ${asset}`);
  }
  return parsed.data;
}

/**
 * Evaluates whether a price value satisfies the trigger condition.
 * Only applicable to price_below / price_above triggers.
 */
function triggerFires(triggerType: string, price: number, threshold: number): boolean {
  switch (triggerType) {
    case 'price_below': return price < threshold;
    case 'price_above': return price > threshold;
    default: return false;
  }
}

/**
 * Builds the human-readable hypothetical action string.
 */
function describeAction(rule: SolAgentRule, price: number): string {
  const { action } = rule;
  switch (action.type) {
    case 'swap':
      return `Swap ${action.amount} ${action.from_asset ?? '?'} → ${action.to_asset ?? '?'} at ~$${price.toFixed(4)}`;
    case 'transfer':
      return `Transfer ${action.amount} ${rule.trigger.asset} to ${action.recipient?.slice(0, 8) ?? '?'}…`;
    case 'alert_only':
      return `Alert: ${rule.trigger.asset} = $${price.toFixed(4)} (threshold $${rule.trigger.threshold})`;
    case 'pause_all':
      return `Pause all rules (${rule.trigger.asset} = $${price.toFixed(4)})`;
    default:
      return `Action: ${action.type}`;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs a 7-day back-simulation against Pyth 15-min candle data.
 *
 * Supports: price_below, price_above.
 * Non-price triggers (balance_below, time_cron, outflow_exceeded) are not
 * simulatable against price history — returns totalFires: 0 with a note.
 */
export async function simulateRule(rule: SolAgentRule): Promise<SimulationResult> {
  const { trigger } = rule;
  const isPriceTrigger =
    trigger.type === 'price_below' || trigger.type === 'price_above';

  if (!isPriceTrigger) {
    return {
      parsedRule: rule,
      totalFires: 0,
      firingEvents: [],
      estimatedDailyFires: 0,
    };
  }

  const history = await fetchPythHistory(trigger.asset);
  const { t: timestamps, c: closes } = history;

  const firingEvents: FiringEvent[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const price = closes[i];
    if (price === undefined) continue;
    if (!triggerFires(trigger.type, price, trigger.threshold)) continue;

    firingEvents.push({
      timestamp: new Date((timestamps[i] ?? 0) * 1000).toISOString(),
      observedValue: price,
      hypotheticalAction: describeAction(rule, price),
    });
  }

  const totalFires = firingEvents.length;
  // Clamp returned events to avoid huge response payloads
  const returnedEvents = firingEvents.slice(0, MAX_FIRING_EVENTS_RETURNED);

  // Estimate: totalFires over 7 days → daily average
  const estimatedDailyFires = Math.round((totalFires / 7) * 10) / 10;

  return {
    parsedRule: rule,
    totalFires,
    firingEvents: returnedEvents,
    estimatedDailyFires,
  };
}
