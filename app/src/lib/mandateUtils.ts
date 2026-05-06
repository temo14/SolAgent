import { PublicKey } from '@solana/web3.js';

export const MANDATE_PROGRAM_ID = new PublicKey('BfKWwCkP8fmvDsWznQXwW5PuvpateF9Nv6X4JMWTVFev');
export const SYSTEM_PROGRAM_ID  = new PublicKey('11111111111111111111111111111111');

export async function anchorDisc(name: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(`global:${name}`);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(hash).slice(0, 8);
}

export function deriveMandatePda(ownerPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mandate'), ownerPubkey.toBuffer()],
    MANDATE_PROGRAM_ID,
  );
  return pda;
}

export interface MandateState {
  mandatePda: string;
  maxPerTxLamports: string;
  maxPerDayLamports: string;
  spentTodayLamports: string;
  dayResetTs: string;
  totalExecutions: string;
  isActive: boolean;
  expiresAt: string;
}

export const LAMPORTS = 1_000_000_000n;

export function lamportsToSol(lamports: string): number {
  return Number(BigInt(lamports)) / Number(LAMPORTS);
}
