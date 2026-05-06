import { createHmac } from 'crypto';
import { Keypair } from '@solana/web3.js';

/**
 * Derives a deterministic agent Keypair for a given owner wallet.
 * HMAC-SHA256(key=AGENT_KEY_MASTER, data="archon:agent:v1:<ownerPubkey>") → 32-byte seed → Ed25519 keypair.
 *
 * Called at execution time — never stored. Only AGENT_KEY_MASTER needs protecting.
 */
export function deriveAgentKeypair(ownerPubkey: string): Keypair {
  const master = process.env.AGENT_KEY_MASTER;
  if (!master) throw new Error('AGENT_KEY_MASTER env var is required');

  const seed = createHmac('sha256', master)
    .update(`archon:agent:v1:${ownerPubkey}`)
    .digest();

  return Keypair.fromSeed(seed);
}
