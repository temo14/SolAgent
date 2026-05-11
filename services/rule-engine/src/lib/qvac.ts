import { ArchonRuleSchema, ArchonRule, ERROR_CODES } from '@archon/shared';

export class QvacError extends Error {
  public readonly errorCode: string;
  constructor(message: string, errorCode: string) {
    super(message);
    this.name = 'QvacError';
    this.errorCode = errorCode;
  }
}

/** OpenAI-compatible chat completion (blocking). Tether QVAC: POST /v1/chat/completions */
interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: { role?: string; content?: string | null };
  }>;
  error?: { message?: string };
}

const SYSTEM_PROMPT = `/no_think
You are a JSON-only API for a Solana wallet automation system.
Parse the user instruction and return a single JSON object. No explanation, no markdown, no preamble.

EXAMPLE 1 INPUT: "If my SOL drops below 1, swap 10 USDC to SOL"
EXAMPLE 1 OUTPUT: {"trigger":{"type":"balance_below","asset":"SOL","threshold":1},"action":{"type":"swap","from_asset":"USDC","to_asset":"SOL","amount":10,"max_slippage_bps":50},"conditions":{"max_amount_usd":50,"max_fires_per_day":10}}

EXAMPLE 2 INPUT: "Transfer 0.05 SOL to wallet ABC123XYZ every minute until 4 PM UTC"
EXAMPLE 2 OUTPUT: {"trigger":{"type":"time_cron","asset":"SOL","threshold":0,"cron_expression":"* * * * *","until_utc_hour":16},"action":{"type":"transfer","amount":0.05,"recipient":"ABC123XYZ","max_slippage_bps":0},"conditions":{"max_amount_usd":10,"max_fires_per_day":1440}}

EXAMPLE 3 INPUT: "Send 0.01 SOL each minute until 4 PM"
EXAMPLE 3 OUTPUT: {"trigger":{"type":"time_cron","asset":"SOL","threshold":0,"cron_expression":"* * * * *","until_local_hour":16},"action":{"type":"transfer","amount":0.01,"recipient":"","max_slippage_bps":0},"conditions":{"max_amount_usd":10,"max_fires_per_day":1440}}
(EXAMPLE 3: no UTC keyword → until_local_hour; omit until_utc_hour. Server adds IANA timezone from browser.)

EXAMPLE 4 INPUT: "send 0.01 sol every minute for 1 hour to address FnSCvZ9c3wU7EUy7FQGmV4wy7yGet2gW9uiSdFM7vSN4"
EXAMPLE 4 OUTPUT: {"trigger":{"type":"time_cron","asset":"SOL","threshold":0,"cron_expression":"* * * * *"},"action":{"type":"transfer","amount":0.01,"recipient":"FnSCvZ9c3wU7EUy7FQGmV4wy7yGet2gW9uiSdFM7vSN4","max_slippage_bps":0},"conditions":{"max_amount_usd":1,"max_fires_per_day":60}}
(EXAMPLE 4: "for 1 hour" at 1/min = 60 fires — use max_fires_per_day:60, NO until_local_hour. "for X hours/minutes" is a duration, never a clock hour.)

EXAMPLE 5 INPUT: "send 0.1 sol to wallet 7xKpABCDEF1234567890abcdef every day at noon"
EXAMPLE 5 OUTPUT: {"trigger":{"type":"time_cron","asset":"SOL","threshold":0,"cron_expression":"0 12 * * *"},"action":{"type":"transfer","amount":0.1,"recipient":"7xKpABCDEF1234567890abcdef","max_slippage_bps":0},"conditions":{"max_amount_usd":20,"max_fires_per_day":1}}

EXAMPLE 6 INPUT: "Buy $50 of SOL every Monday at 9am"
EXAMPLE 6 OUTPUT: {"trigger":{"type":"time_cron","asset":"SOL","threshold":0,"cron_expression":"0 9 * * 1"},"action":{"type":"swap","from_asset":"USDC","to_asset":"SOL","amount":50,"max_slippage_bps":50},"conditions":{"max_amount_usd":50,"max_fires_per_day":1}}
(EXAMPLE 6: "buy TOKEN" → swap USDC→TOKEN; "$X" means spend X USDC as from_asset amount. "buy/purchase/acquire/get TOKEN" always maps to action.type="swap" with from_asset="USDC" and to_asset=TOKEN. Never use transfer for buy/sell/swap instructions.)

EXAMPLE 7 INPUT: "If SOL price drops below $100, sell all my SOL for USDC"
EXAMPLE 7 OUTPUT: {"trigger":{"type":"price_below","asset":"SOL","threshold":100},"action":{"type":"swap","from_asset":"SOL","to_asset":"USDC","amount":100,"max_slippage_bps":100},"conditions":{"max_amount_usd":5000,"max_fires_per_day":1}}
(EXAMPLE 7: "sell TOKEN" or "swap TOKEN to USDC" → action.type="swap"; "all" or percentage phrases → use a representative amount; never use transfer for sell/swap instructions.)

EXAMPLE 8 INPUT: "swap 10 USDC to SOL every 5 minutes for 2 hours"
EXAMPLE 8 OUTPUT: {"trigger":{"type":"time_cron","asset":"SOL","threshold":0,"cron_expression":"*/5 * * * *"},"action":{"type":"swap","from_asset":"USDC","to_asset":"SOL","amount":10,"max_slippage_bps":50},"conditions":{"max_amount_usd":10,"max_fires_per_day":24}}
(EXAMPLE 8: "every 5 minutes" → cron_expression "*/5 * * * *"; "for 2 hours" at 1/5min = 24 fires — max_fires_per_day:24.)

EXAMPLE 9 INPUT: "Send 0.1 SOL to FnSCvZ9c3wU7EUy7FQGmV4wy7yGet2gW9uiSdFM7vSN4 in every minute for 1 hour"
EXAMPLE 9 OUTPUT: {"trigger":{"type":"time_cron","asset":"SOL","threshold":0,"cron_expression":"* * * * *"},"action":{"type":"transfer","amount":0.1,"recipient":"FnSCvZ9c3wU7EUy7FQGmV4wy7yGet2gW9uiSdFM7vSN4","max_slippage_bps":0},"conditions":{"max_amount_usd":10,"max_fires_per_day":60}}
(EXAMPLE 9: "in every minute" = every minute = "* * * * *"; NOT a specific minute number like "16 * * * *".)

SCHEMA (use only the values listed):
trigger.type: balance_below | balance_above | price_below | price_above | time_cron | outflow_exceeded
trigger.asset: any token symbol (e.g. SOL, USDC, WIF, JTO, BONK) or full SPL mint address
trigger.threshold: number (use 0 for time_cron)
trigger.cron_expression: 5-field cron string e.g. "* * * * *" or "*/5 * * * *" (only for time_cron; NEVER use 6-field with seconds; NEVER put a specific minute number for "every minute" patterns)
trigger.until_local_hour: integer 0-23 — ONLY for absolute end times ("until 4 PM", "by 5pm", "for today"). NEVER use for durations ("for 1 hour", "for 30 minutes") — use max_fires_per_day for those instead.
trigger.until_utc_hour: integer 0-23 — only when user explicitly says UTC / Zulu / GMT (optional, time_cron only)
Do not output schedule_timezone — the server adds it from the user's browser.
action.type: swap | transfer | alert_only | pause_all — RULE: buy/sell/exchange/swap/purchase/acquire → always "swap"; send/transfer/pay → "transfer"
action.from_asset: string (optional)
action.to_asset: string (optional)
action.amount: number
action.recipient: string — extract ANY wallet address from the input, however it is phrased ("to ADDRESS", "in this address ADDRESS", "send to ADDRESS"). Leave empty string "" only if no address given.
action.max_slippage_bps: number (default 50; use 0 for transfers)
conditions.max_amount_usd: number
conditions.max_fires_per_day: number — for duration rules: (fires per minute × duration in minutes); for every-minute all-day: 1440; default 10
Duration conversion: "for 1 hour" every minute = 60; "for 2 hours" every minute = 120; "for 30 minutes" every minute = 30; "for 1 hour" every 5 min = 12`;

function buildMessages(userInput: string): Array<{ role: string; content: string }> {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: userInput },
  ];
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Remove Qwen3 chain-of-thought blocks (<think>…</think>) before extracting JSON.
 * With /no_think these are always empty, but stripping here is a safe fallback for
 * when thinking mode fires unexpectedly — prevents the reasoner's in-progress JSON
 * fragments from being grabbed instead of the final answer.
 */
function stripThinkingBlocks(text: string): string {
  return text.replace(/<think[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * First ```json ... ``` (or ``` ... ```) block that looks like an object.
 * Models often wrap JSON in fences *and* add a sentence before/after.
 */
function extractMarkdownFencedJson(text: string): string | null {
  const re = /```(?:json)?\s*\n?([\s\S]*?)\n?```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim();
    if (inner.startsWith('{')) return inner;
  }
  return null;
}

/**
 * Prefer fenced JSON if present; otherwise the trimmed full reply.
 */
function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  return extractMarkdownFencedJson(trimmed) ?? trimmed;
}

/** First top-level `{ ... }` slice, respecting `"` strings and escapes. */
function extractBalancedJsonObject(source: string, startIdx: number): string | null {
  if (source[startIdx] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = startIdx; i < source.length; i++) {
    const c = source[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(startIdx, i + 1);
    }
  }
  return null;
}

/**
 * Walks all `{` positions in `source` and returns the first balanced JSON
 * object that parses successfully. Handles preamble/postamble text robustly:
 * if the model says "Here is the rule: {...}" we skip the prose and land on
 * the actual object.
 */
function parseFirstValidObject(source: string): unknown | undefined {
  let from = 0;
  while (true) {
    const idx = source.indexOf('{', from);
    if (idx < 0) return undefined;
    const slice = extractBalancedJsonObject(source, idx);
    if (slice !== null) {
      try { return JSON.parse(slice); } catch { /* not valid JSON here, keep scanning */ }
      from = idx + slice.length;
    } else {
      from = idx + 1;
    }
  }
}

function parseModelJson(content: string): unknown {
  const stripped = stripThinkingBlocks(content);

  // Priority 1: markdown-fenced JSON block — most explicit signal from the model.
  const fenced = extractMarkdownFencedJson(stripped);
  if (fenced) {
    try { return JSON.parse(fenced); } catch { /* fall through */ }
    const obj = parseFirstValidObject(fenced);
    if (obj !== undefined) return obj;
  }

  // Priority 2: scan all `{` positions in stripped then raw content.
  for (const src of [stripped, content.trim()]) {
    const obj = parseFirstValidObject(src);
    if (obj !== undefined) return obj;
  }

  throw new Error('parse');
}

// ─── Canonical cron inference ─────────────────────────────────────────────────
// Deterministically derives the cron expression from common natural-language
// patterns that models frequently misparse (e.g. "in every minute" → 16 * * * *).
// Only overrides for unambiguous high-frequency phrases — leaves complex
// patterns (e.g. "every Monday at 9am") to the model.

const EVERY_N_MIN_RE  = /\bevery\s+(\d+)\s*(?:minutes?|mins?)\b/i;
const EVERY_MIN_RE    = /\b(?:every|each|per|in\s+every)\s+(?:single\s+)?minute\b|once\s+a\s+minute|\bminutely\b/i;
const EVERY_N_HOUR_RE = /\bevery\s+(\d+)\s*(?:hours?|hrs?)\b/i;
const EVERY_HOUR_RE   = /\b(?:every|each)\s+hour\b|hourly|once\s+an?\s+hour\b/i;

function inferCronFromInput(input: string): string | null {
  const nMin = EVERY_N_MIN_RE.exec(input);
  if (nMin) {
    const n = parseInt(nMin[1], 10);
    if (n === 1) return '* * * * *';
    if (n > 1 && n < 60) return `*/${n} * * * *`;
  }
  if (EVERY_MIN_RE.test(input)) return '* * * * *';

  const nHour = EVERY_N_HOUR_RE.exec(input);
  if (nHour) {
    const n = parseInt(nHour[1], 10);
    if (n === 1) return '0 * * * *';
    if (n > 1 && n < 24) return `0 */${n} * * *`;
  }
  if (EVERY_HOUR_RE.test(input)) return '0 * * * *';

  return null;
}

// ─── Post-processor ───────────────────────────────────────────────────────────

const BASE58_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DURATION_RE = /\bfor\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/i;

function isWalletAddress(s: unknown): s is string {
  return typeof s === 'string' && BASE58_ADDR_RE.test(s);
}

/**
 * Deterministic fixes applied after any model responds, before Zod validation.
 * Shared by both the Claude parser and the QVAC fallback.
 */
export function postProcessRule(
  raw: Record<string, unknown>,
  userInput: string,
): Record<string, unknown> {
  const trigger = { ...(raw.trigger as Record<string, unknown> ?? {}) };
  const action  = { ...(raw.action  as Record<string, unknown> ?? {}) };
  const conditions = { ...(raw.conditions as Record<string, unknown> ?? {}) };

  // ── 1. Inject / fix conditions ───────────────────────────────────────────
  // Derive max_amount_usd from the actual action amount when Claude's estimate
  // looks implausible (e.g. $1,500 for a 0.1 SOL transfer).
  {
    const amt = typeof action.amount === 'number' ? action.amount : 0;
    const fromAsset = String(action.from_asset ?? trigger.asset ?? 'SOL').toUpperCase();
    const SOL_PRICE_ESTIMATE = 150; // rough ceiling — keeps the guard meaningful
    let derivedMax = 0;
    if (fromAsset === 'SOL') derivedMax = Math.ceil(amt * SOL_PRICE_ESTIMATE * 1.2); // +20% buffer
    else if (['USDC', 'USDT', 'DAI', 'PYUSD'].includes(fromAsset)) derivedMax = Math.ceil(amt * 1.05);
    if (derivedMax > 0) {
      // Trust Claude's value only if it's within 3× the derived amount
      const claudeMax = typeof conditions.max_amount_usd === 'number' ? conditions.max_amount_usd : 0;
      if (!claudeMax || claudeMax > derivedMax * 3) {
        conditions.max_amount_usd = derivedMax;
      }
    } else if (!conditions.max_amount_usd) {
      conditions.max_amount_usd = 100;
    }
  }
  if (!conditions.max_fires_per_day) {
    const cronExpr = String(trigger.cron_expression ?? '').trim();
    const parts = cronExpr.split(/\s+/);
    // Strip seconds field if 6-field cron, then check if minute field is '*'
    const normalized = parts.length === 6 ? parts.slice(1) : parts;
    const isEveryMinute = normalized.length === 5 && normalized[0] === '*';
    conditions.max_fires_per_day = trigger.type === 'time_cron' && isEveryMinute ? 1440 : 10;
  }

  // ── 2. Fix misplaced wallet address for transfer actions ──────────────────
  if (action.type === 'transfer' && !isWalletAddress(action.recipient)) {
    // Check from_asset / to_asset fields first
    for (const field of ['from_asset', 'to_asset'] as const) {
      if (isWalletAddress(action[field])) {
        action.recipient = action[field];
        delete action[field];
        break;
      }
    }
    // Check trigger.asset (model sometimes puts address there)
    if (!isWalletAddress(action.recipient) && isWalletAddress(trigger.asset)) {
      action.recipient = trigger.asset;
      trigger.asset = 'SOL';
    }
    // Last resort: scan raw input tokens for any base58 address
    if (!isWalletAddress(action.recipient)) {
      const addr = userInput.trim().split(/\s+/).find(isWalletAddress);
      if (addr) action.recipient = addr;
    }
  }

  // ── 3. "for X hours/minutes" is a duration, not a clock hour ─────────────
  if (trigger.type === 'time_cron') {
    const m = DURATION_RE.exec(userInput);
    if (m) {
      const n = parseFloat(m[1]);
      const isHour = /^h/i.test(m[2]);
      const durationMins = isHour ? n * 60 : n;

      // Infer fires-per-minute from cron expression
      const cronParts = String(trigger.cron_expression ?? '* * * * *')
        .trim().split(/\s+/).filter(Boolean);
      const minField = cronParts.length === 6 ? cronParts[1] : cronParts[0] ?? '*';
      let firesPerMin = 1;
      if (minField !== '*') {
        if (minField.startsWith('*/')) firesPerMin = 1 / Math.max(1, parseInt(minField.slice(2), 10));
        else firesPerMin = 1 / 60; // specific minute = once per hour
      }

      conditions.max_fires_per_day = Math.max(1, Math.round(firesPerMin * durationMins));
      delete trigger.until_local_hour;
      delete trigger.until_utc_hour;
    }
  }

  // ── 4. Normalise from_asset: if it looks like a symbol keep it, else drop ─
  if (action.from_asset !== undefined && isWalletAddress(action.from_asset)) {
    delete action.from_asset;
  }

  // ── 5. Canonical cron override ────────────────────────────────────────────
  // Deterministically re-derives cron_expression for unambiguous frequency
  // phrases the model frequently gets wrong (e.g. "in every minute" → 16 * * * *).
  // Complex patterns ("every Monday at 9am") return null and are left untouched.
  if (trigger.type === 'time_cron') {
    const canonical = inferCronFromInput(userInput);
    if (canonical !== null) {
      trigger.cron_expression = canonical;
    }
  }

  return { ...raw, trigger, action, conditions };
}

// ─── QVAC HTTP client ─────────────────────────────────────────────────────────

/**
 * Calls Tether QVAC HTTP server (OpenAI-compatible API).
 * @see https://docs.qvac.tether.io/http-server/
 * QVAC is mandatory — returns QvacError if unreachable or invalid output.
 */
export async function parseRuleWithQvac(userInput: string): Promise<ArchonRule> {
  const qvacBaseUrl = process.env.QVAC_BASE_URL;
  const qvacModel = process.env.QVAC_MODEL;
  const apiKey = process.env.QVAC_API_KEY;

  if (!qvacBaseUrl || !qvacModel) {
    throw new QvacError(
      'QVAC_BASE_URL and QVAC_MODEL env vars are required',
      ERROR_CODES.QVAC_UNAVAILABLE,
    );
  }

  const base = normalizeBaseUrl(qvacBaseUrl);
  const url = `${base}/v1/chat/completions`;

  const TIMEOUT_MS = 90_000;
  const MAX_RETRIES = 3;
  const BUSY_RETRY_MS = 2_000;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey !== undefined && apiKey.length > 0) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const body = JSON.stringify({
    model: qvacModel,
    messages: buildMessages(userInput),
    stream: false,
    temperature: 0,
    max_tokens: 512,
  });

  let raw: OpenAIChatCompletionResponse | undefined;
  let lastError: QvacError | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });

      if (!response.ok) {
        const errText = await response.text();
        const isBusy = errText.includes('job is already set') || errText.includes('being processed');
        if (isBusy && attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, BUSY_RETRY_MS));
          continue;
        }
        throw new QvacError(
          `QVAC HTTP ${response.status}: ${response.statusText}${errText ? ` — ${errText.slice(0, 200)}` : ''}`,
          ERROR_CODES.QVAC_UNAVAILABLE,
        );
      }

      raw = (await response.json()) as OpenAIChatCompletionResponse;
      break;
    } catch (err) {
      if (err instanceof QvacError) { lastError = err; break; }
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        (err instanceof DOMException && err.name === 'AbortError');
      lastError = new QvacError(
        isAbort
          ? `QVAC timed out after ${TIMEOUT_MS / 1_000} s — the model is still busy; try again in a moment.`
          : `QVAC unreachable: ${err instanceof Error ? err.message : String(err)}`,
        ERROR_CODES.QVAC_UNAVAILABLE,
      );
      break;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (!raw) throw lastError ?? new QvacError('QVAC request failed', ERROR_CODES.QVAC_UNAVAILABLE);

  if (raw.error?.message) {
    throw new QvacError(`QVAC error: ${raw.error.message}`, ERROR_CODES.QVAC_UNAVAILABLE);
  }

  const content = raw.choices?.[0]?.message?.content;
  if (content === undefined || content === null || content.trim() === '') {
    throw new QvacError('QVAC returned empty completion', ERROR_CODES.RULE_PARSE_FAIL);
  }

  let parsed: unknown;
  try {
    parsed = parseModelJson(content);
  } catch {
    throw new QvacError(
      'QVAC returned non-JSON response body (model added text around the rule JSON, or invalid JSON)',
      ERROR_CODES.RULE_PARSE_FAIL,
    );
  }

  if (typeof parsed === 'object' && parsed !== null) {
    parsed = postProcessRule(parsed as Record<string, unknown>, userInput);
  }

  const result = ArchonRuleSchema.safeParse(parsed);
  if (!result.success) {
    // Re-ranking: inject Zod errors back into QVAC for a single correction attempt.
    const errorSummary = result.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
    const rerankedMessages = buildMessages(
      `${userInput}\n\n[Previous parse failed validation — fix these errors and return only valid JSON: ${errorSummary}]`,
    );
    const rerankedBody = JSON.stringify({
      model: qvacModel,
      messages: rerankedMessages,
      stream: false,
      temperature: 0,
      max_tokens: 512,
    });

    try {
      const controller2 = new AbortController();
      const tid2 = setTimeout(() => controller2.abort(), TIMEOUT_MS);
      const resp2 = await fetch(url, { method: 'POST', headers, body: rerankedBody, signal: controller2.signal });
      clearTimeout(tid2);
      if (resp2.ok) {
        const raw2 = (await resp2.json()) as OpenAIChatCompletionResponse;
        const content2 = raw2.choices?.[0]?.message?.content;
        if (content2) {
          let parsed2: unknown;
          try { parsed2 = parseModelJson(content2); } catch { /* fall through */ }
          if (parsed2 !== undefined && typeof parsed2 === 'object' && parsed2 !== null) {
            parsed2 = postProcessRule(parsed2 as Record<string, unknown>, userInput);
            const result2 = ArchonRuleSchema.safeParse(parsed2);
            if (result2.success) return result2.data;
          }
        }
      }
    } catch { /* fall through to original error */ }

    throw new QvacError(
      `Rule schema validation failed: ${result.error.message}`,
      ERROR_CODES.RULE_VALIDATION_FAIL,
    );
  }

  return result.data;
}
