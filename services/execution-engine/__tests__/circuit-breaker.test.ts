import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { isCircuitBreakerTripped, triggerCircuitBreaker } from '../src/lib/circuit-breaker.js';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockCount = vi.fn();
const mockRuleUpdate = vi.fn();
const mockAuditCreate = vi.fn();
const mockTransaction = vi.fn();

const mockPrisma = {
  executionLog: { count: mockCount },
  rule: { update: mockRuleUpdate },
  auditEvent: { create: mockAuditCreate },
  $transaction: mockTransaction,
} as unknown as PrismaClient;

const RULE_ID = 'rule-uuid-1234';
const WALLET_PUBKEY = '7xKp4rNsAgentWalletPublicKeyBase58';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── isCircuitBreakerTripped ──────────────────────────────────────────────────

describe('isCircuitBreakerTripped', () => {
  it('count = 3 (equals threshold) → returns true', async () => {
    mockCount.mockResolvedValue(3);
    const tripped = await isCircuitBreakerTripped(RULE_ID, mockPrisma);
    expect(tripped).toBe(true);
  });

  it('count = 2 (below threshold) → returns false', async () => {
    mockCount.mockResolvedValue(2);
    const tripped = await isCircuitBreakerTripped(RULE_ID, mockPrisma);
    expect(tripped).toBe(false);
  });

  it('count = 0 → returns false', async () => {
    mockCount.mockResolvedValue(0);
    const tripped = await isCircuitBreakerTripped(RULE_ID, mockPrisma);
    expect(tripped).toBe(false);
  });

  it('count = 10 (above threshold) → returns true', async () => {
    mockCount.mockResolvedValue(10);
    const tripped = await isCircuitBreakerTripped(RULE_ID, mockPrisma);
    expect(tripped).toBe(true);
  });

  it('queries executionLog with the correct ruleId and FAILED status', async () => {
    mockCount.mockResolvedValue(0);
    await isCircuitBreakerTripped(RULE_ID, mockPrisma);
    expect(mockCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ruleId: RULE_ID,
          status: 'FAILED',
        }),
      }),
    );
  });
});

// ─── triggerCircuitBreaker ────────────────────────────────────────────────────

describe('triggerCircuitBreaker', () => {
  beforeEach(() => {
    mockTransaction.mockResolvedValue([{}, {}]);
    mockRuleUpdate.mockResolvedValue({});
    mockAuditCreate.mockResolvedValue({});
  });

  it('calls prisma.$transaction once', async () => {
    await triggerCircuitBreaker(RULE_ID, WALLET_PUBKEY, mockPrisma);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('rule.update is called with status PAUSED_CIRCUIT_BREAKER', async () => {
    await triggerCircuitBreaker(RULE_ID, WALLET_PUBKEY, mockPrisma);
    expect(mockRuleUpdate).toHaveBeenCalledWith({
      where: { id: RULE_ID },
      data: { status: 'PAUSED_CIRCUIT_BREAKER' },
    });
  });

  it('auditEvent.create is called with eventType CIRCUIT_BREAKER_HALT and isAnomalous: true', async () => {
    await triggerCircuitBreaker(RULE_ID, WALLET_PUBKEY, mockPrisma);
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'CIRCUIT_BREAKER_HALT',
        isAnomalous: true,
      }),
    });
  });

  it('auditEvent.create includes ruleId and walletPubkey in payload data', async () => {
    await triggerCircuitBreaker(RULE_ID, WALLET_PUBKEY, mockPrisma);
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ruleId: RULE_ID,
        walletPubkey: WALLET_PUBKEY,
      }),
    });
  });
});
