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
  return `You are a rule parser for a Solana wallet automation system.
Convert the natural language instruction into a structured JSON rule.
Return ONLY valid JSON. No explanation. No markdown. No preamble.

EXAMPLE 1:
Input: "If my SOL drops below 1, swap 10 USDC to SOL"
Output: {"trigger":{"type":"balance_below","asset":"SOL","threshold":1},"action":{"type":"swap","from_asset":"USDC","to_asset":"SOL","amount":10,"max_slippage_bps":50},"conditions":{"max_amount_usd":50,"max_fires_per_day":10}}

EXAMPLE 2:
Input: "Send 5 USDC to wallet 7xKp4rNs every day at noon"
Output: {"trigger":{"type":"time_cron","asset":"USDC","threshold":0,"cron_expression":"0 12 * * *"},"action":{"type":"transfer","amount":5,"recipient":"7xKp4rNs","max_slippage_bps":50},"conditions":{"max_amount_usd":10,"max_fires_per_day":1}}

EXAMPLE 3:
Input: "Alert me when SOL price goes above 200"
Output: {"trigger":{"type":"price_above","asset":"SOL","threshold":200},"action":{"type":"alert_only","amount":0,"max_slippage_bps":50},"conditions":{"max_amount_usd":0,"max_fires_per_day":10}}

Schema:
{"trigger":{"type":"<balance_below|balance_above|price_below|price_above|time_cron|outflow_exceeded>","asset":"<SOL|USDC|USDT|JUP|BONK>","threshold":<number>,"cron_expression":"<optional>","window_seconds":<optional>},"action":{"type":"<swap|transfer|alert_only|pause_all>","from_asset":"<optional>","to_asset":"<optional>","amount":<number>,"recipient":"<optional>","max_slippage_bps":<number>},"conditions":{"max_amount_usd":<number>,"max_fires_per_day":<number>}}

User instruction: "${userInput}"`;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Strips optional ```json fences; returns the payload string to JSON.parse.
 */
function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(trimmed);
  if (fence?.[1] !== undefined) {
    return fence[1].trim();
  }
  return trimmed;
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

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
        max_tokens: 4096,
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
    parsed = JSON.parse(extractJsonPayload(content));
  } catch {
    throw new QvacError(
      'QVAC returned non-JSON response body',
      ERROR_CODES.RULE_PARSE_FAIL,
    );
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
