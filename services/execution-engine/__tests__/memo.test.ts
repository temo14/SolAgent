import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { buildMemoProof, buildMemoInstruction, MEMO_PROGRAM_V2 } from '../src/lib/memo.js';
import type { SolAgentRule } from '@solagent/shared';

// No mocks needed — memo.ts is pure (only Node crypto + @solana/web3.js PublicKey)

const VALID_OPTS = {
  ruleId: '550e8400-e29b-41d4-a716-446655440000',
  agentWalletPubkey: '7xKp4rNsExampleDevnetPublicKeyBase58Addr',
  parsedRule: {
    trigger: { type: 'balance_below', asset: 'SOL', threshold: 1 },
    action: { type: 'swap', from_asset: 'USDC', to_asset: 'SOL', amount: 10, max_slippage_bps: 50 },
    conditions: { max_amount_usd: 50, max_fires_per_day: 10 },
  } as SolAgentRule,
  triggerSlot: 285432910,
  observedValue: 0.87,
  priceUsed: 142.50,
  priceSrc: 'jupiter+pyth',
};

// Valid System Program pubkey (32 zero bytes in base58)
const AGENT_PUBKEY = new PublicKey('11111111111111111111111111111111');

// ─── buildMemoProof ───────────────────────────────────────────────────────────

describe('buildMemoProof', () => {
  it('v field equals 1', () => {
    const proof = buildMemoProof(VALID_OPTS);
    expect(proof.v).toBe(1);
  });

  it('rid is exactly 8 characters (ruleId without hyphens, first 8 chars)', () => {
    const proof = buildMemoProof(VALID_OPTS);
    expect(proof.rid).toHaveLength(8);
    // ruleId = '550e8400-e29b-...' → stripped = '550e8400e29b...' → slice(0,8) = '550e8400'
    expect(proof.rid).toBe('550e8400');
  });

  it('trig.type matches parsedRule.trigger.type', () => {
    const proof = buildMemoProof(VALID_OPTS);
    expect(proof.trig.type).toBe(VALID_OPTS.parsedRule.trigger.type);
  });

  it('trig.observed equals observedValue (0.87)', () => {
    const proof = buildMemoProof(VALID_OPTS);
    expect(proof.trig.observed).toBe(0.87);
  });

  it('trig.slot equals triggerSlot', () => {
    const proof = buildMemoProof(VALID_OPTS);
    expect(proof.trig.slot).toBe(285432910);
  });

  it('act.type matches parsedRule.action.type', () => {
    const proof = buildMemoProof(VALID_OPTS);
    expect(proof.act.type).toBe(VALID_OPTS.parsedRule.action.type);
  });

  it('act.amount matches parsedRule.action.amount (10)', () => {
    const proof = buildMemoProof(VALID_OPTS);
    expect(proof.act.amount).toBe(10);
  });

  it('hash is exactly 16 characters', () => {
    const proof = buildMemoProof(VALID_OPTS);
    expect(proof.hash).toHaveLength(16);
  });

  it('JSON.stringify(result) byte length is <= 350', () => {
    const proof = buildMemoProof(VALID_OPTS);
    const byteLen = Buffer.byteLength(JSON.stringify(proof), 'utf8');
    expect(byteLen).toBeLessThanOrEqual(350);
  });

  it('throws when agentWalletPubkey is 200 chars (proof would exceed 350 bytes)', () => {
    const overflow = { ...VALID_OPTS, agentWalletPubkey: 'A'.repeat(200) };
    expect(() => buildMemoProof(overflow)).toThrow(/too large/i);
  });
});

// ─── buildMemoInstruction ─────────────────────────────────────────────────────

describe('buildMemoInstruction', () => {
  const proof = buildMemoProof(VALID_OPTS);
  const instruction = buildMemoInstruction(proof, AGENT_PUBKEY);

  it('programId.toBase58() equals the Memo Program v2 address', () => {
    expect(instruction.programId.toBase58()).toBe('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    expect(instruction.programId.toBase58()).toBe(MEMO_PROGRAM_V2.toBase58());
  });

  it('data is valid UTF-8 JSON (JSON.parse does not throw)', () => {
    expect(() => JSON.parse(instruction.data.toString())).not.toThrow();
  });

  it('keys has exactly 1 entry', () => {
    expect(instruction.keys).toHaveLength(1);
  });

  it('keys[0].isSigner is true', () => {
    expect(instruction.keys[0].isSigner).toBe(true);
  });

  it('keys[0].isWritable is false', () => {
    expect(instruction.keys[0].isWritable).toBe(false);
  });
});
