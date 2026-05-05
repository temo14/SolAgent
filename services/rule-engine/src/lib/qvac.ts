import { SolAgentRuleSchema, SolAgentRule, ERROR_CODES } from '@solagent/shared';

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

function buildRuleParsingPrompt(userInput: string): string {
  // /no_think disables Qwen3's chain-of-thought mode, keeping the response token-light.
  return `/no_think
You are a JSON-only API for a Solana wallet automation system.
Parse the user instruction and return a single JSON object. No explanation, no markdown, no preamble.

EXAMPLE 1 INPUT: "If my SOL drops below 1, swap 10 USDC to SOL"
EXAMPLE 1 OUTPUT: {"trigger":{"type":"balance_below","asset":"SOL","threshold":1},"action":{"type":"swap","from_asset":"USDC","to_asset":"SOL","amount":10,"max_slippage_bps":50},"conditions":{"max_amount_usd":50,"max_fires_per_day":10}}

EXAMPLE 2 INPUT: "Transfer 0.05 SOL to wallet ABC123 every minute until 4 PM UTC"
EXAMPLE 2 OUTPUT: {"trigger":{"type":"time_cron","asset":"SOL","threshold":0,"cron_expression":"* * * * *","until_utc_hour":16},"action":{"type":"transfer","amount":0.05,"recipient":"ABC123","max_slippage_bps":0},"conditions":{"max_amount_usd":10,"max_fires_per_day":1440}}

EXAMPLE 3 INPUT: "Send 0.01 SOL each minute until 4 PM"
EXAMPLE 3 OUTPUT: {"trigger":{"type":"time_cron","asset":"SOL","threshold":0,"cron_expression":"* * * * *","until_local_hour":16},"action":{"type":"transfer","amount":0.01,"recipient":"7xKp4rNsEXAMPLEAAAAAAAAAAAAAAAAAAAAAAAA","max_slippage_bps":0},"conditions":{"max_amount_usd":10,"max_fires_per_day":1440}}
(For EXAMPLE 3: wording has no UTC — use until_local_hour only; omit until_utc_hour. Server attaches IANA timezone from the browser.)

SCHEMA (use only the values listed):
trigger.type: balance_below | balance_above | price_below | price_above | time_cron | outflow_exceeded
trigger.asset: SOL | USDC | USDT | JUP | BONK
trigger.threshold: number (use 0 for time_cron)
trigger.cron_expression: cron string e.g. "* * * * *" (only for time_cron)
trigger.until_local_hour: integer 0-23 — stop at or after this local hour when user does NOT say UTC (optional, time_cron only). Omit if user said UTC/Zulu.
trigger.until_utc_hour: integer 0-23 — only when user explicitly says UTC / Zulu / GMT (optional, time_cron only)
Do not output schedule_timezone — the server adds it from the user's browser.
action.type: swap | transfer | alert_only | pause_all
action.from_asset: string (optional)
action.to_asset: string (optional)
action.amount: number
action.recipient: string (optional, wallet address)
action.max_slippage_bps: number (default 50; use 0 for transfers)
conditions.max_amount_usd: number
conditions.max_fires_per_day: number (for every-minute rules set to 1440; default 10)

USER INSTRUCTION: "${userInput}"`;
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

function parseModelJson(content: string): unknown {
  const payload = extractJsonPayload(stripThinkingBlocks(content));
  try {
    return JSON.parse(payload);
  } catch {
    const trySlice = (s: string): unknown | undefined => {
      const idx = s.indexOf('{');
      if (idx < 0) return undefined;
      const sub = extractBalancedJsonObject(s, idx);
      if (sub === null) return undefined;
      try {
        return JSON.parse(sub);
      } catch {
        return undefined;
      }
    };
    const fromPayload = trySlice(payload);
    if (fromPayload !== undefined) return fromPayload;
    const fromFull = trySlice(content.trim());
    if (fromFull !== undefined) return fromFull;
    throw new Error('parse');
  }
}

/**
 * Calls Tether QVAC HTTP server (OpenAI-compatible API).
 * @see https://docs.qvac.tether.io/http-server/
 * QVAC is mandatory — returns QvacError if unreachable or invalid output.
 */
export async function parseRuleWithQvac(userInput: string): Promise<SolAgentRule> {
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let raw: OpenAIChatCompletionResponse;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey !== undefined && apiKey.length > 0) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: qvacModel,
        messages: [{ role: 'user', content: buildRuleParsingPrompt(userInput) }],
        stream: false,
        temperature: 0.1,
        // 2048 gives the Qwen3 think block room to close naturally (~50-600 tok)
        // then emit JSON (~200 tok). Natural stop is ~235 tok; 2048 is safe headroom.
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new QvacError(
        `QVAC HTTP ${response.status}: ${response.statusText}${errText ? ` — ${errText.slice(0, 200)}` : ''}`,
        ERROR_CODES.QVAC_UNAVAILABLE,
      );
    }

    raw = (await response.json()) as OpenAIChatCompletionResponse;
  } catch (err) {
    if (err instanceof QvacError) throw err;
    const isAbort =
      (err instanceof Error && err.name === 'AbortError') ||
      (err instanceof DOMException && err.name === 'AbortError');
    if (isAbort) {
      throw new QvacError(
        `QVAC timed out after ${TIMEOUT_MS / 1_000} s — the model is still busy; try again in a moment.`,
        ERROR_CODES.QVAC_UNAVAILABLE,
      );
    }
    throw new QvacError(
      `QVAC unreachable: ${err instanceof Error ? err.message : String(err)}`,
      ERROR_CODES.QVAC_UNAVAILABLE,
    );
  } finally {
    clearTimeout(timeoutId);
  }

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

  // The model sometimes omits `conditions` when the rule is unambiguous.
  // Inject conservative defaults so Zod validation doesn't reject a correct parse.
  if (typeof parsed === 'object' && parsed !== null && !('conditions' in parsed)) {
    const rule = parsed as Record<string, unknown>;
    const trigger = rule.trigger as Record<string, unknown> | undefined;
    const isCron = trigger?.type === 'time_cron';
    const cronExpr = typeof trigger?.cron_expression === 'string' ? trigger.cron_expression : '';
    const isEveryMinute = cronExpr.trim() === '* * * * *';
    rule.conditions = {
      max_amount_usd: 100,
      max_fires_per_day: isCron && isEveryMinute ? 1440 : 10,
    };
  }

  const result = SolAgentRuleSchema.safeParse(parsed);
  if (!result.success) {
    throw new QvacError(
      `Rule schema validation failed: ${result.error.message}`,
      ERROR_CODES.RULE_VALIDATION_FAIL,
    );
  }

  return result.data;
}
