import { createHash } from 'crypto';
import { TransactionInstruction, PublicKey } from '@solana/web3.js';
import type { MemoProofV1, SolAgentRule } from '@solagent/shared';

/** Memo Program v2 address (mainnet + devnet). */
export const MEMO_PROGRAM_V2 = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const MEMO_MAX_BYTES = 350;

interface BuildMemoOptions {
  ruleId: string;
  agentWalletPubkey: string;
  parsedRule: SolAgentRule;
  triggerSlot: number;
  observedValue: number;
  priceUsed?: number;
  priceSrc?: string;
}

/**
 * Constructs a compact MemoProofV1 matching the shared type definition.
 * Validates that the JSON fits within 350 bytes.
 */
export function buildMemoProof(opts: BuildMemoOptions): MemoProofV1 {
  const { ruleId, agentWalletPubkey, parsedRule, triggerSlot, observedValue, priceUsed, priceSrc } =
    opts;

  const ruleDigest = createHash('sha256')
    .update(JSON.stringify(parsedRule))
    .digest('hex')
    .slice(0, 16);

  const proof: MemoProofV1 = {
    v: 1,
    rid: ruleId.replace(/-/g, '').slice(0, 8),
    wid: agentWalletPubkey,
    trig: {
      type: parsedRule.trigger.type,
      asset: parsedRule.trigger.asset,
      threshold: parsedRule.trigger.threshold,
      observed: observedValue,
      slot: triggerSlot,
    },
    act: {
      type: parsedRule.action.type,
      from: parsedRule.action.from_asset,
      to: parsedRule.action.to_asset,
      amount: parsedRule.action.amount,
      price_src: priceSrc ?? 'none',
      ...(priceUsed !== undefined ? { price_used: priceUsed } : {}),
    },
    hash: ruleDigest,
  };

  const json = JSON.stringify(proof);
  const byteLen = Buffer.byteLength(json, 'utf8');
  if (byteLen > MEMO_MAX_BYTES) {
    throw new Error(`MemoProofV1 too large: ${byteLen} bytes (max ${MEMO_MAX_BYTES})`);
  }
  return proof;
}

/**
 * Creates the Memo Program v2 TransactionInstruction.
 * The agentWalletPubkey must be a signer in the transaction.
 */
export function buildMemoInstruction(
  proof: MemoProofV1,
  agentWalletPublicKey: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_V2,
    keys: [{ pubkey: agentWalletPublicKey, isSigner: true, isWritable: false }],
    data: Buffer.from(JSON.stringify(proof), 'utf8'),
  });
}
