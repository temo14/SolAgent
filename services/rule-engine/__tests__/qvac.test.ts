import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseRuleWithQvac, QvacError } from '../src/lib/qvac.js';
import { ERROR_CODES } from '@archon/shared';

// ─── Setup ────────────────────────────────────────────────────────────────────

process.env.QVAC_BASE_URL = 'http://localhost:11434';
process.env.QVAC_MODEL = 'archon-parser';

const VALID_RULE_JSON = JSON.stringify({
  trigger: { type: 'balance_below', asset: 'SOL', threshold: 1 },
  action: { type: 'swap', from_asset: 'USDC', to_asset: 'SOL', amount: 10, max_slippage_bps: 50 },
  conditions: { max_amount_usd: 50, max_fires_per_day: 10 },
});

function makeQvacResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { role: 'assistant', content } }],
    }),
    text: async () => content,
  };
}

beforeEach(() => {
  process.env.QVAC_BASE_URL = 'http://localhost:11434';
  process.env.QVAC_MODEL = 'archon-parser';
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.QVAC_BASE_URL = 'http://localhost:11434';
  process.env.QVAC_MODEL = 'archon-parser';
});

// ─── parseRuleWithQvac ────────────────────────────────────────────────────────

describe('parseRuleWithQvac', () => {
  it('fetch returns VALID_RULE_JSON → returns ArchonRule with correct trigger.type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeQvacResponse(VALID_RULE_JSON)));
    const result = await parseRuleWithQvac('If my SOL drops below 1, swap 10 USDC to SOL');
    expect(result.trigger.type).toBe('balance_below');
    expect(result.trigger.asset).toBe('SOL');
    expect(result.trigger.threshold).toBe(1);
    expect(result.action.type).toBe('swap');
  });

  it('fetch returns VALID_RULE_JSON wrapped in ```json fence → parses correctly', async () => {
    const fenced = `\`\`\`json\n${VALID_RULE_JSON}\n\`\`\``;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeQvacResponse(fenced)));
    const result = await parseRuleWithQvac('test');
    expect(result.trigger.type).toBe('balance_below');
  });

  it('fetch throws network error → throws QvacError with errorCode QVAC_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED: connection refused')));
    await expect(parseRuleWithQvac('test')).rejects.toSatisfy((e: unknown) => {
      return e instanceof QvacError && e.errorCode === ERROR_CODES.QVAC_UNAVAILABLE;
    });
  });

  it('fetch returns { ok: false, status: 503 } → throws QvacError with errorCode QVAC_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'Service Unavailable',
    }));
    await expect(parseRuleWithQvac('test')).rejects.toSatisfy((e: unknown) => {
      return e instanceof QvacError && e.errorCode === ERROR_CODES.QVAC_UNAVAILABLE;
    });
  });

  it('fetch returns valid JSON but missing required field (no trigger) → throws QvacError with errorCode RULE_VALIDATION_FAIL', async () => {
    const noTrigger = JSON.stringify({
      action: { type: 'swap', from_asset: 'USDC', to_asset: 'SOL', amount: 10, max_slippage_bps: 50 },
      conditions: { max_amount_usd: 50, max_fires_per_day: 10 },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeQvacResponse(noTrigger)));
    await expect(parseRuleWithQvac('test')).rejects.toSatisfy((e: unknown) => {
      return e instanceof QvacError && e.errorCode === ERROR_CODES.RULE_VALIDATION_FAIL;
    });
  });

  it('QVAC_BASE_URL deleted from process.env → throws QvacError with errorCode QVAC_UNAVAILABLE', async () => {
    delete process.env.QVAC_BASE_URL;
    // No fetch stub — the function throws before making any network call
    await expect(parseRuleWithQvac('test')).rejects.toSatisfy((e: unknown) => {
      return e instanceof QvacError && e.errorCode === ERROR_CODES.QVAC_UNAVAILABLE;
    });
  });

  it('fetch returns empty content string → throws QvacError with errorCode RULE_PARSE_FAIL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeQvacResponse('')));
    await expect(parseRuleWithQvac('test')).rejects.toSatisfy((e: unknown) => {
      return e instanceof QvacError && e.errorCode === ERROR_CODES.RULE_PARSE_FAIL;
    });
  });

  it('fetch returns non-JSON string "hello world" → throws QvacError with errorCode RULE_PARSE_FAIL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeQvacResponse('hello world')));
    await expect(parseRuleWithQvac('test')).rejects.toSatisfy((e: unknown) => {
      return e instanceof QvacError && e.errorCode === ERROR_CODES.RULE_PARSE_FAIL;
    });
  });
});
