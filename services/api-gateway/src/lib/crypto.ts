import { createHmac } from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

/**
 * Derives a deterministic agent pubkey for a given owner wallet.
 * HMAC-SHA256(key=AGENT_KEY_MASTER, data="archon:agent:v1:<ownerPubkey>") → 32-byte seed → Ed25519 keypair.
 *
 * Each user gets a unique delegate address derived from the master secret.
 * Isolates users — a leak of one wallet's activity cannot be attributed to others.
 */
export function deriveAgentPubkey(ownerPubkey: string): string {
  const master = process.env.AGENT_KEY_MASTER;
  if (!master) throw new Error('AGENT_KEY_MASTER env var is required');

  const seed = createHmac('sha256', master)
    .update(`archon:agent:v1:${ownerPubkey}`)
    .digest();

  const kp = nacl.sign.keyPair.fromSeed(seed);
  return bs58.encode(kp.publicKey);
}
