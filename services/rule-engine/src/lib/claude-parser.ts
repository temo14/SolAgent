import Anthropic from '@anthropic-ai/sdk';
import { ArchonRuleSchema, type ArchonRule, ERROR_CODES } from '@archon/shared';
import { QvacError, postProcessRule } from './qvac.js';

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// ─── Tool definition ──────────────────────────────────────────────────────────
// tool_choice: { type: 'tool' } forces Claude to always call this tool,
// guaranteeing the response is structured input — no JSON extraction needed.

const PARSE_TOOL: Anthropic.Tool = {
  name: 'parse_automation_rule',
  description: `Parse a natural language Solana wallet automation instruction into a structured rule.

─── ACTION TYPES ────────────────────────────────────────────────────────────
- "send / transfer / pay / move" → action.type = "transfer"
- "buy / purchase / get" → action.type = "swap" (from_asset = spend token, to_asset = bought token)
- "sell / dump / exit" → action.type = "swap" (from_asset = sold token, to_asset = USDC)
- "swap / exchange / convert" → action.type = "swap" with from_asset and to_asset
- "alert / notify / ping / warn" (no transaction) → action.type = "alert_only"
- "pause / stop all rules" → action.type = "pause_all"

─── AMOUNTS ──────────────────────────────────────────────────────────────────
- "$50 of SOL" → buy SOL, amount derived from USD value (store dollar value in max_amount_usd, amount = best estimate in SOL)
- "50% of SOL / half my SOL" → fractional; encode as amount = 0.5 and note percentage in description
- "all SOL / entire balance" → amount = -1 (sentinel for full balance)
- "0.1 SOL / 5 USDC" → exact amount as number

─── CRON FREQUENCY ───────────────────────────────────────────────────────────
Every-minute variants (ALL of these → "* * * * *"):
  "every minute", "each minute", "in every minute", "per minute", "minutely", "every 1 minute"
Every-N-minutes: "every 5 minutes", "every 15 min", "every half hour (30)" → "*/N * * * *"
Every-hour variants → "0 * * * *": "every hour", "hourly", "each hour", "every 1 hour"
Every-N-hours: "every 2 hours", "every 4h" → "0 */N * * *"
Daily: "every day", "daily", "once a day", "each day" → "0 0 * * *" (midnight default)
Daily at time: "every day at 9am / 21:00 / 9:00 UTC" → "0 H * * *" where H is parsed hour
Twice daily: "twice a day", "2x a day", "every 12 hours" → "0 0,12 * * *"
Three times daily: "3x a day", "every 8 hours" → "0 0,8,16 * * *"
Weekly (named day): "every Monday", "each Friday", "weekly on Tuesday" → "0 9 * * D" (D=0-6, default 9am)
Weekly with time: "every Monday at 3pm" → "0 15 * * 1"
Weekdays: "every weekday", "Mon-Fri", "business days" → "0 9 * * 1-5"
Weekends: "every weekend", "Sat and Sun", "Saturday / Sunday" → "0 10 * * 0,6"
Monthly: "every month", "monthly", "once a month" → "0 0 1 * *"
Monthly on date: "on the 1st", "15th of each month", "every 15th" → "0 0 D * *"
Quarterly: "every 3 months", "quarterly" → "0 0 1 */3 *"
Biweekly: "every 2 weeks", "biweekly", "every other week" → "0 9 * * 1/2" (approximate)

─── DURATION vs CLOCK TIME ───────────────────────────────────────────────────
"for 1 hour" at 1/min = max_fires_per_day 60; "for 2 hours" at 1/min = 120; "for 30 min" at 1/min = 30
"for N hours" at 1/min → max_fires_per_day = N × 60; at */5 → max_fires_per_day = N × 12
"for X duration" is always a DURATION cap → use max_fires_per_day, NOT until_local_hour/until_utc_hour
"run 5 times", "execute 3 times", "fire 10 times", "once" → max_fires_per_day = N (1 for "once")
"until 4 PM UTC / GMT / Zulu" → until_utc_hour = 16 (no max_fires_per_day change)
"until 4 PM" (no timezone) → until_local_hour = 16

─── DEFAULT LIMITS ───────────────────────────────────────────────────────────
- max_fires_per_day: 1440 (uncapped) unless user specifies duration or count
- max_amount_usd: infer from amount (SOL price ~$150, USDC 1:1); cap at 10000 if unclear
- For alert_only or pause_all: max_amount_usd = 0

─── ADDRESSES & ASSETS ───────────────────────────────────────────────────────
- Any 32-44 char base58 string → action.recipient (transfers) or trigger.asset / action.from_asset (swaps)
- Common aliases: "solana" = "SOL", "usdc" = "USDC", "bitcoin on solana" = "WBTC", "ether" = "WETH"
- trigger.asset: the main asset being watched; for time_cron use the action's from_asset
- trigger.threshold: always 0 for time_cron

─── SLIPPAGE ─────────────────────────────────────────────────────────────────
- Transfers: max_slippage_bps = 0
- Swaps default: max_slippage_bps = 50 (0.5%)
- "high slippage ok / up to 1%" → 100 bps; "tight / low slippage" → 20 bps`,
  input_schema: {
    type: 'object',
    required: ['trigger', 'action', 'conditions'],
    properties: {
      trigger: {
        type: 'object',
        required: ['type', 'asset', 'threshold'],
        properties: {
          type: {
            type: 'string',
            enum: ['balance_below', 'balance_above', 'price_below', 'price_above', 'time_cron', 'outflow_exceeded'],
          },
          asset: {
            type: 'string',
            description: 'Token symbol (SOL, USDC, BONK, etc.) or full SPL mint address',
          },
          threshold: {
            type: 'number',
            description: 'Numeric threshold; use 0 for time_cron',
          },
          cron_expression: {
            type: 'string',
            description: '5-field cron string: "* * * * *" = every minute, "*/5 * * * *" = every 5 min, "0 9 * * 1" = Monday 9am',
          },
          window_seconds: {
            type: 'number',
            description: 'Window in seconds for outflow_exceeded trigger only',
          },
          until_utc_hour: {
            type: 'integer',
            minimum: 0,
            maximum: 23,
            description: 'Stop hour in UTC (only when user says UTC/GMT/Zulu explicitly)',
          },
          until_local_hour: {
            type: 'integer',
            minimum: 0,
            maximum: 23,
            description: 'Stop hour in user local time ("until 4 PM" without UTC)',
          },
        },
      },
      action: {
        type: 'object',
        required: ['type', 'amount'],
        properties: {
          type: {
            type: 'string',
            enum: ['swap', 'transfer', 'alert_only', 'pause_all'],
          },
          from_asset: { type: 'string', description: 'Asset to sell/spend (swaps only)' },
          to_asset:   { type: 'string', description: 'Asset to buy/receive (swaps only)' },
          amount:     { type: 'number', description: 'Amount in from_asset units (or SOL for transfers)' },
          recipient:  { type: 'string', description: 'Destination wallet address (transfers only)' },
          max_slippage_bps: {
            type: 'number',
            description: 'Max slippage in basis points; 0 for transfers, 50 default for swaps',
          },
        },
      },
      conditions: {
        type: 'object',
        required: ['max_amount_usd', 'max_fires_per_day'],
        properties: {
          max_amount_usd: {
            type: 'number',
            description: 'Maximum USD value per execution',
          },
          max_fires_per_day: {
            type: 'integer',
            minimum: 1,
            maximum: 1440,
            description: 'Max executions per day; for duration rules: fires/min × duration_mins',
          },
        },
      },
    },
  },
};

// ─── Parser ───────────────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client === null) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Parses a natural-language automation rule using Claude with forced tool use.
 * Tool use guarantees a structured response — no JSON extraction or regex needed.
 * ~200ms latency, costs ~$0.00025 per call with claude-haiku-4-5.
 */
export async function parseRuleWithClaude(userInput: string): Promise<ArchonRule> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new QvacError('ANTHROPIC_API_KEY not set', ERROR_CODES.QVAC_UNAVAILABLE);
  }

  let response: Anthropic.Message;
  try {
    response = await getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      tools: [PARSE_TOOL],
      tool_choice: { type: 'tool', name: 'parse_automation_rule' },
      messages: [{ role: 'user', content: userInput }],
    });
  } catch (err) {
    throw new QvacError(
      `Claude API error: ${err instanceof Error ? err.message : String(err)}`,
      ERROR_CODES.QVAC_UNAVAILABLE,
    );
  }

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolBlock) {
    throw new QvacError('Claude did not invoke the parse tool', ERROR_CODES.RULE_PARSE_FAIL);
  }

  let parsed: unknown = postProcessRule(
    toolBlock.input as Record<string, unknown>,
    userInput,
  );

  const result = ArchonRuleSchema.safeParse(parsed);
  if (!result.success) {
    throw new QvacError(
      `Rule validation failed: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      ERROR_CODES.RULE_VALIDATION_FAIL,
    );
  }

  return result.data;
}
