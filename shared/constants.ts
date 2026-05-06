// ─── Trigger / Action Types ───────────────────────────────────────────────────

export const TRIGGER_TYPES = [
  'balance_below',
  'balance_above',
  'price_below',
  'price_above',
  'time_cron',
  'outflow_exceeded',
] as const;

export const ACTION_TYPES = ['swap', 'transfer', 'alert_only', 'pause_all'] as const;

// ─── On-chain Program Addresses ───────────────────────────────────────────────

export const MEMO_PROGRAM_V2_ADDRESS = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

// ─── Token Mint Addresses (devnet mirrors where applicable) ───────────────────

export const TOKEN_MINTS: Record<string, string> = {
  SOL:    'So11111111111111111111111111111111111111112',
  USDC:   'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT:   'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  JUP:    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  BONK:   'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF:    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  JTO:    'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
  PYTH:   'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  RENDER: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',
  ORCA:   'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  RAY:    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  SAMO:   '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  WEN:    'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',
  POPCAT: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
  MEW:    'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',
  MNGO:   'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac',
} as const;

// ─── Execution Safety Parameters ─────────────────────────────────────────────

/** Max allowed price deviation between Jupiter quote and Pyth oracle (1%) */
export const PRICE_DEVIATION_THRESHOLD = 0.01;

/** Transaction confirmation timeout in ms — no auto-retry after this */
export const TX_CONFIRMATION_TIMEOUT_MS = 60_000;

/** Fallback reconciliation loop interval (balance / price / outflow — webhook safety net) */
export const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1_000;

/** Dedicated poll tick for `time_cron` rules (minute-granularity idempotency) */
export const CRON_RECONCILIATION_INTERVAL_MS = 60 * 1_000;

/** Re-queue delay after price deviation abort */
export const PRICE_DEV_REQUEUE_DELAY_MS = 60_000;

/** Default max slippage in basis points (0.5%) */
export const DEFAULT_MAX_SLIPPAGE_BPS = 50;

/** Default maximum rule fires per day */
export const DEFAULT_MAX_FIRES_PER_DAY = 10;

// ─── BullMQ Queue Configuration ───────────────────────────────────────────────

/** Prefix for BullMQ execution queue (`exec-<first-8-of-UUID>` — no ':'; BullMQ forbids colons) */
export const EXEC_QUEUE_PREFIX = 'exec';

export function execQueueName(agentWalletId: string): string {
  return `${EXEC_QUEUE_PREFIX}-${agentWalletId.slice(0, 8)}`;
}

/** Only one execution job per wallet queue at a time */
export const EXEC_QUEUE_CONCURRENCY = 1;

// ─── Memo Proof ───────────────────────────────────────────────────────────────

export const MEMO_PROOF_VERSION = 1 as const;

/** Max bytes for on-chain Memo instruction data */
export const MEMO_MAX_BYTES = 350;

// ─── Redis Pub/Sub Channels ───────────────────────────────────────────────────

export const REDIS_CHANNEL = {
  WEBHOOK_EVENTS: 'archon:webhook:events',
  RULE_ACTIVATED: 'archon:rule:activated',
  EXEC_RESULT: 'archon:exec:result',
} as const;
