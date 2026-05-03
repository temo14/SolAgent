// ─── Supported Assets ─────────────────────────────────────────────────────────

export const SUPPORTED_ASSETS = ['SOL', 'USDC', 'USDT', 'JUP', 'BONK'] as const;

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
export const JUPITER_V6_PROGRAM_ADDRESS = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

// ─── Token Mint Addresses (devnet mirrors where applicable) ───────────────────

export const TOKEN_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112', // Wrapped SOL
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
} as const;

// ─── Execution Safety Parameters ─────────────────────────────────────────────

/** Max allowed price deviation between Jupiter quote and Pyth oracle (1%) */
export const PRICE_DEVIATION_THRESHOLD = 0.01;

/** Transaction confirmation timeout in ms — no auto-retry after this */
export const TX_CONFIRMATION_TIMEOUT_MS = 60_000;

/** Fallback reconciliation loop interval (safety net only) */
export const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1_000;

/** Re-queue delay after price deviation abort */
export const PRICE_DEV_REQUEUE_DELAY_MS = 60_000;

/** Default max slippage in basis points (0.5%) */
export const DEFAULT_MAX_SLIPPAGE_BPS = 50;

/** Default maximum rule fires per day */
export const DEFAULT_MAX_FIRES_PER_DAY = 10;

/** Default daily transfer limit in USD */
export const DEFAULT_DAILY_LIMIT_USD = 1_000;

// ─── BullMQ Queue Configuration ───────────────────────────────────────────────

/** Queue name for execution jobs: exec:<first-8-chars-of-walletPubkey> */
export const EXEC_QUEUE_PREFIX = 'exec';

/** Only one execution job per wallet queue at a time */
export const EXEC_QUEUE_CONCURRENCY = 1;

/** Queue for condition evaluation fan-out */
export const EVAL_QUEUE_NAME = 'eval';

// ─── Memo Proof ───────────────────────────────────────────────────────────────

export const MEMO_PROOF_VERSION = 1 as const;

/** Max bytes for on-chain Memo instruction data */
export const MEMO_MAX_BYTES = 350;

// ─── Jupiter API ─────────────────────────────────────────────────────────────

export const JUPITER_BASE_URL = 'https://quote-api.jup.ag/v6';

// ─── Redis Pub/Sub Channels ───────────────────────────────────────────────────

export const REDIS_CHANNEL = {
  WEBHOOK_EVENTS: 'solagent:webhook:events',
  RULE_ACTIVATED: 'solagent:rule:activated',
  EXEC_RESULT: 'solagent:exec:result',
} as const;
