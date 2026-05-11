import { createHash } from 'crypto';
import {
  PublicKey,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';
import { getConnection } from './rpc.js';

export const MANDATE_PROGRAM_ID = new PublicKey(
  process.env.MANDATE_PROGRAM_ID ?? 'BfKWwCkP8fmvDsWznQXwW5PuvpateF9Nv6X4JMWTVFev',
);

// Anchor discriminator = sha256("global:record_execution")[0..8]
const RECORD_EXECUTION_DISC = createHash('sha256')
  .update('global:record_execution')
  .digest()
  .slice(0, 8);

// Byte offsets within the Mandate account data (after 8-byte discriminator)
const IS_ACTIVE_OFFSET = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8; // = 112

/**
 * Derives the Mandate PDA for a given owner pubkey.
 * Seeds: [b"mandate", owner.key().as_ref()]
 */
export function deriveMandatePda(ownerPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mandate'), ownerPubkey.toBuffer()],
    MANDATE_PROGRAM_ID,
  );
  return pda;
}

// Discriminated union — callers must handle rpc_error separately from not_found
// so an RPC outage cannot silently bypass mandate limits.
export type MandateCheckResult =
  | { kind: 'active' }
  | { kind: 'revoked' }
  | { kind: 'not_found' }
  | { kind: 'rpc_error'; error: Error };

/**
 * Fetches the Mandate account and returns a discriminated result.
 * Distinguishes between "account missing" (not_found) and "RPC failure"
 * (rpc_error) so callers can abort rather than silently bypassing limits.
 */
export async function fetchMandateStatus(mandatePda: PublicKey): Promise<MandateCheckResult> {
  try {
    const conn = getConnection();
    const info = await conn.getAccountInfo(mandatePda, 'confirmed');
    if (!info || info.data.length < IS_ACTIVE_OFFSET + 1) return { kind: 'not_found' };
    return info.data[IS_ACTIVE_OFFSET] === 1 ? { kind: 'active' } : { kind: 'revoked' };
  } catch (err) {
    return { kind: 'rpc_error', error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Builds the record_execution TransactionInstruction.
 *
 * Instruction data: [discriminator(8 bytes)] + [amount_lamports u64 LE(8 bytes)]
 *
 * Accounts:
 *   0. mandate — writable PDA, not signer
 *   1. delegate — signer (agent wallet), not writable
 */
export function buildRecordExecutionInstruction(
  mandatePda: PublicKey,
  delegatePubkey: PublicKey,
  amountLamports: bigint,
): TransactionInstruction {
  const data = Buffer.allocUnsafe(16);
  Buffer.from(RECORD_EXECUTION_DISC).copy(data, 0);
  data.writeBigUInt64LE(amountLamports, 8);

  const keys: AccountMeta[] = [
    { pubkey: mandatePda, isSigner: false, isWritable: true },
    { pubkey: delegatePubkey, isSigner: true, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: MANDATE_PROGRAM_ID,
    keys,
    data,
  });
}
