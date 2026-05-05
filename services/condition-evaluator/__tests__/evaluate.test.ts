import { vi, describe, it, expect, beforeEach } from 'vitest';

// vi.mock calls are hoisted by Vitest — they run before any imports below
vi.mock('../src/lib/rpc.js', () => ({
  LAMPORTS_PER_SOL: 1_000_000_000,
  getSolBalanceLamports: vi.fn(),
  getCurrentSlot: vi.fn(),
}));

vi.mock('../src/lib/price.js', () => ({
  getAssetPriceUsd: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  getPrisma: vi.fn(),
}));

import { computeIdempotencyKey, evaluateTrigger } from '../src/lib/evaluate.js';
import { getSolBalanceLamports, getCurrentSlot } from '../src/lib/rpc.js';
import { getAssetPriceUsd } from '../src/lib/price.js';
import type { SolAgentRule, HeliusWebhookEvent } from '@solagent/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SLOT = 285432910;

function makeRule(trigger: SolAgentRule['trigger']): { id: string; parsedRule: SolAgentRule } {
  return {
    id: 'test-rule-id',
    parsedRule: {
      trigger,
      action: { type: 'swap', amount: 10, max_slippage_bps: 50 },
      conditions: { max_amount_usd: 50, max_fires_per_day: 10 },
    } as SolAgentRule,
  };
}

const MOCK_EVENT: HeliusWebhookEvent = {
  signature: 'test-sig-abc',
  slot: SLOT,
  timestamp: 1_746_398_400,
  type: 'SOL_TRANSFER',
  accountData: [],
};

// ─── computeIdempotencyKey ────────────────────────────────────────────────────

describe('computeIdempotencyKey', () => {
  it('returns a 64-char hex string', () => {
    const key = computeIdempotencyKey('rule-1', 'sig-1', 12345);
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same inputs → same hash every call', () => {
    const k1 = computeIdempotencyKey('rule-1', 'sig-1', 12345);
    const k2 = computeIdempotencyKey('rule-1', 'sig-1', 12345);
    expect(k1).toBe(k2);
  });

  it('different slot → different hash', () => {
    const k1 = computeIdempotencyKey('rule-1', 'sig-1', 12345);
    const k2 = computeIdempotencyKey('rule-1', 'sig-1', 99999);
    expect(k1).not.toBe(k2);
  });

  it('different ruleId → different hash', () => {
    const k1 = computeIdempotencyKey('rule-1', 'sig-1', 12345);
    const k2 = computeIdempotencyKey('rule-2', 'sig-1', 12345);
    expect(k1).not.toBe(k2);
  });
});

// ─── evaluateTrigger ─────────────────────────────────────────────────────────

describe('evaluateTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentSlot).mockResolvedValue(SLOT);
  });

  // ── balance_below ───────────────────────────────────────────────────────────

  describe('balance_below', () => {
    it('balance 0.5 SOL < threshold 1.0 → matched: true, observedValue: 0.5', async () => {
      vi.mocked(getSolBalanceLamports).mockResolvedValue(500_000_000); // 0.5 SOL in lamports
      const result = await evaluateTrigger(
        makeRule({ type: 'balance_below', asset: 'SOL', threshold: 1.0 }),
        'agent-pubkey',
        null,
      );
      expect(result.matched).toBe(true);
      expect(result.observedValue).toBeCloseTo(0.5);
    });

    it('balance 2.0 SOL >= threshold 1.0 → matched: false', async () => {
      vi.mocked(getSolBalanceLamports).mockResolvedValue(2_000_000_000); // 2.0 SOL in lamports
      const result = await evaluateTrigger(
        makeRule({ type: 'balance_below', asset: 'SOL', threshold: 1.0 }),
        'agent-pubkey',
        null,
      );
      expect(result.matched).toBe(false);
    });
  });

  // ── balance_above ───────────────────────────────────────────────────────────

  describe('balance_above', () => {
    it('balance 2.0 SOL > threshold 1.0 → matched: true', async () => {
      vi.mocked(getSolBalanceLamports).mockResolvedValue(2_000_000_000);
      const result = await evaluateTrigger(
        makeRule({ type: 'balance_above', asset: 'SOL', threshold: 1.0 }),
        'agent-pubkey',
        null,
      );
      expect(result.matched).toBe(true);
    });

    it('balance 0.5 SOL <= threshold 1.0 → matched: false', async () => {
      vi.mocked(getSolBalanceLamports).mockResolvedValue(500_000_000);
      const result = await evaluateTrigger(
        makeRule({ type: 'balance_above', asset: 'SOL', threshold: 1.0 }),
        'agent-pubkey',
        null,
      );
      expect(result.matched).toBe(false);
    });
  });

  // ── price_below ─────────────────────────────────────────────────────────────

  describe('price_below', () => {
    it('price 150 < threshold 200 → matched: true', async () => {
      vi.mocked(getAssetPriceUsd).mockResolvedValue(150);
      const result = await evaluateTrigger(
        makeRule({ type: 'price_below', asset: 'SOL', threshold: 200 }),
        'agent-pubkey',
        null,
      );
      expect(result.matched).toBe(true);
      expect(result.observedValue).toBe(150);
    });

    it('price 250 >= threshold 200 → matched: false', async () => {
      vi.mocked(getAssetPriceUsd).mockResolvedValue(250);
      const result = await evaluateTrigger(
        makeRule({ type: 'price_below', asset: 'SOL', threshold: 200 }),
        'agent-pubkey',
        null,
      );
      expect(result.matched).toBe(false);
    });
  });

  // ── price_above ─────────────────────────────────────────────────────────────

  describe('price_above', () => {
    it('price 250 > threshold 200 → matched: true', async () => {
      vi.mocked(getAssetPriceUsd).mockResolvedValue(250);
      const result = await evaluateTrigger(
        makeRule({ type: 'price_above', asset: 'SOL', threshold: 200 }),
        'agent-pubkey',
        null,
      );
      expect(result.matched).toBe(true);
      expect(result.observedValue).toBe(250);
    });

    it('price 150 <= threshold 200 → matched: false', async () => {
      vi.mocked(getAssetPriceUsd).mockResolvedValue(150);
      const result = await evaluateTrigger(
        makeRule({ type: 'price_above', asset: 'SOL', threshold: 200 }),
        'agent-pubkey',
        null,
      );
      expect(result.matched).toBe(false);
    });
  });

  // ── time_cron ───────────────────────────────────────────────────────────────

  describe('time_cron', () => {
    it('event is not null → matched: false (webhook path never fires cron)', async () => {
      const result = await evaluateTrigger(
        makeRule({ type: 'time_cron', asset: 'SOL', threshold: 0, cron_expression: '* * * * *' }),
        'agent-pubkey',
        MOCK_EVENT,
      );
      expect(result.matched).toBe(false);
    });

    it('event is null, "* * * * *" → matched: true (wildcard always matches)', async () => {
      const result = await evaluateTrigger(
        makeRule({ type: 'time_cron', asset: 'SOL', threshold: 0, cron_expression: '* * * * *' }),
        'agent-pubkey',
        null,
      );
      expect(result.matched).toBe(true);
    });

    it('event is null, "0 0 1 1 *" (Jan 1 midnight) → matched: false (today is not Jan 1)', async () => {
      // Today is 2026-05-05 so dom=5, mon=5 — neither matches cron dom=1, mon=1
      const result = await evaluateTrigger(
        makeRule({ type: 'time_cron', asset: 'SOL', threshold: 0, cron_expression: '0 0 1 1 *' }),
        'agent-pubkey',
        null,
      );
      expect(result.matched).toBe(false);
    });
  });

  // ── unknown trigger type ────────────────────────────────────────────────────

  describe('unknown trigger type', () => {
    it('returns matched: false without throwing', async () => {
      const rule = {
        id: 'test-id',
        parsedRule: {
          trigger: { type: 'totally_unknown' as unknown as SolAgentRule['trigger']['type'], asset: 'SOL' as const, threshold: 0 },
          action: { type: 'swap' as const, amount: 10, max_slippage_bps: 50 },
          conditions: { max_amount_usd: 50, max_fires_per_day: 10 },
        } as SolAgentRule,
      };
      const result = await evaluateTrigger(rule, 'agent-pubkey', null);
      expect(result.matched).toBe(false);
    });
  });
});
