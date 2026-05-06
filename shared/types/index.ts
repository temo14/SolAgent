import { z } from 'zod';
import { DEFAULT_MAX_SLIPPAGE_BPS } from '../constants.js';

// ─── Enumerations ────────────────────────────────────────────────────────────

export const TriggerType = {
  BALANCE_BELOW: 'balance_below',
  BALANCE_ABOVE: 'balance_above',
  PRICE_BELOW: 'price_below',
  PRICE_ABOVE: 'price_above',
  TIME_CRON: 'time_cron',
  OUTFLOW_EXCEEDED: 'outflow_exceeded',
} as const;
export type TriggerType = (typeof TriggerType)[keyof typeof TriggerType];

export const ActionType = {
  SWAP: 'swap',
  TRANSFER: 'transfer',
  ALERT_ONLY: 'alert_only',
  PAUSE_ALL: 'pause_all',
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

// Mirror Prisma enums for use in service logic without importing @prisma/client
export const RuleStatus = {
  PENDING_ACTIVATION: 'PENDING_ACTIVATION',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  PAUSED_CIRCUIT_BREAKER: 'PAUSED_CIRCUIT_BREAKER',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type RuleStatus = (typeof RuleStatus)[keyof typeof RuleStatus];

export const ExecStatus = {
  PROCESSING: 'PROCESSING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  DUPLICATE_DISCARDED: 'DUPLICATE_DISCARDED',
  STALE_CONDITION: 'STALE_CONDITION',
  PRICE_DEVIATION_ABORT: 'PRICE_DEVIATION_ABORT',
  CIRCUIT_BREAKER_HALT: 'CIRCUIT_BREAKER_HALT',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
} as const;
export type ExecStatus = (typeof ExecStatus)[keyof typeof ExecStatus];

// ─── Error Codes ─────────────────────────────────────────────────────────────

export const ERROR_CODES = {
  RULE_PARSE_FAIL: 'RULE_PARSE_FAIL',
  RULE_VALIDATION_FAIL: 'RULE_VALIDATION_FAIL',
  QVAC_UNAVAILABLE: 'QVAC_UNAVAILABLE',
  EXEC_DUPLICATE: 'EXEC_DUPLICATE',
  EXEC_PRICE_DEVIATION: 'EXEC_PRICE_DEVIATION',
  EXEC_INSUFFICIENT_FUNDS: 'EXEC_INSUFFICIENT_FUNDS',
  EXEC_TIMEOUT: 'EXEC_TIMEOUT',
  EXEC_SIMULATION_FAIL: 'EXEC_SIMULATION_FAIL',
  CIRCUIT_WALLET_BREAKER: 'CIRCUIT_WALLET_BREAKER',
  CIRCUIT_RULE_BREAKER: 'CIRCUIT_RULE_BREAKER',
  RPC_UNAVAILABLE: 'RPC_UNAVAILABLE',
  WEBHOOK_HMAC_FAIL: 'WEBHOOK_HMAC_FAIL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ─── Zod Schemas (QVAC output validation) ────────────────────────────────────

export const TriggerSchema = z.object({
  type: z.enum([
    'balance_below',
    'balance_above',
    'price_below',
    'price_above',
    'time_cron',
    'outflow_exceeded',
  ]),
  asset: z.string().min(2).max(50),
  threshold: z.number(),
  cron_expression: z.string().optional(),
  window_seconds: z.number().optional(),
  /**
   * UTC hour (0–23) at which a time_cron rule stops firing.
   * Evaluated as: do not fire if utcHour >= until_utc_hour.
   * Use when user explicitly mentions UTC/Zulu.
   */
  until_utc_hour: z.number().int().min(0).max(23).optional(),
  /**
   * Local wall-clock hour (0–23) in `schedule_timezone` when firing stops for time_cron.
   * Prefer this for "until 4 PM" without saying UTC — matches the user's timezone.
   */
  until_local_hour: z.number().int().min(0).max(23).optional(),
  /** IANA zone (e.g. Asia/Tbilisi) — set server-side from the client when creating the rule */
  schedule_timezone: z.string().min(2).max(80).optional(),
});

export const ActionSchema = z.object({
  type: z.enum(['swap', 'transfer', 'alert_only', 'pause_all']),
  from_asset: z.string().optional(),
  to_asset: z.string().optional(),
  amount: z.number(),
  recipient: z.string().optional(),
  max_slippage_bps: z.number().default(DEFAULT_MAX_SLIPPAGE_BPS),
});

export const ConditionsSchema = z.object({
  max_amount_usd: z.number(),
  max_fires_per_day: z.number().default(10),
});

export const ArchonRuleSchema = z.object({
  trigger: TriggerSchema,
  action: ActionSchema,
  conditions: ConditionsSchema,
});

export type ArchonRule = z.infer<typeof ArchonRuleSchema>;

// ─── On-chain Memo Proof ──────────────────────────────────────────────────────

export interface MemoProofV1 {
  v: 1;
  rid: string;        // rule UUID first 8 chars
  wid: string;        // agent wallet pubkey
  trig: {
    type: TriggerType;
    asset: string;
    threshold: number;
    observed: number;
    slot: number;
  };
  act: {
    type: ActionType;
    from?: string;
    to?: string;
    amount: number;
    price_src: string;  // "jupiter+pyth" | "jupiter"
    price_used?: number;
  };
  hash: string;       // SHA-256(rule JSON) — first 16 chars
}

// ─── Structured Logging ───────────────────────────────────────────────────────

export interface StructuredLog {
  errorCode: ErrorCode;
  service: string;
  ruleId?: string;
  walletPubkey?: string;
  detail: string;
  timestamp: string;
}

// ─── API Response Shapes ──────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  errorCode: ErrorCode;
  message: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── SIWS / Auth ─────────────────────────────────────────────────────────────

export interface SiwsNonceResponse {
  nonce: string;
  expiresAt: string;
}

export interface SiwsVerifyBody {
  walletPubkey: string;
  signature: string;
  message: string;
  nonce: string;
}

export interface AuthTokenResponse {
  token: string;
  expiresAt: string;
  walletPubkey: string;
}

// ─── Helius Webhook Payload ───────────────────────────────────────────────────

export const TokenBalanceChangeSchema = z.object({
  userAccount: z.string(),
  tokenAccount: z.string(),
  mint: z.string(),
  rawTokenAmount: z.object({
    tokenAmount: z.string(),
    decimals: z.number(),
  }),
});

export const AccountDataSchema = z.object({
  account: z.string(),
  nativeBalanceChange: z.number(),
  tokenBalanceChanges: z.array(TokenBalanceChangeSchema),
});

export const HeliusWebhookEventSchema = z.object({
  accountData: z.array(AccountDataSchema).optional().default([]),
  description: z.string().optional(),
  events: z.record(z.unknown()).optional(),
  fee: z.number().optional(),
  feePayer: z.string().optional(),
  instructions: z.array(z.unknown()).optional(),
  nativeTransfers: z.array(z.unknown()).optional(),
  signature: z.string(),
  slot: z.number(),
  source: z.string().optional(),
  timestamp: z.number(),
  tokenTransfers: z.array(z.unknown()).optional(),
  type: z.string(),
});

export type HeliusWebhookEvent = z.infer<typeof HeliusWebhookEventSchema>;

/** Helius sends an array of events per webhook POST */
export const HeliusWebhookPayloadSchema = z.array(HeliusWebhookEventSchema);
export type HeliusWebhookPayload = z.infer<typeof HeliusWebhookPayloadSchema>;

// ─── BullMQ Job Payloads ──────────────────────────────────────────────────────

export interface ExecJobPayload {
  ruleId: string;
  walletPubkey: string;
  agentWalletId: string;
  idempotencyKey: string;
  triggerEventSig: string;
  triggerSlot: number;
  observedValue: number;
  parsedRule: ArchonRule;
  /**
   * True when this job is the single price-deviation retry.
   * The worker updates the existing PRICE_DEVIATION_ABORT log
   * rather than inserting a new one.
   */
  isRetry?: boolean;
}

// ─── Execution Result (published to Redis for SSE + audit-indexer) ────────────

export interface ExecResult {
  ruleId: string;
  walletPubkey: string;
  idempotencyKey: string;
  status: string;
  txSignature?: string;
  memoProof?: MemoProofV1;
  errorCode?: string;
  timestamp: string;
}
