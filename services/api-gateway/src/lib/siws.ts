import { randomBytes } from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export const NONCE_TTL_SECONDS = 300; // 5 minutes
export const NONCE_REDIS_PREFIX = 'siws:nonce:';

/**
 * Generates a cryptographically random hex nonce.
 */
export function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Builds the canonical SIWS message that the frontend must sign exactly.
 * The frontend recreates this string from the same params before calling signMessage.
 */
export function buildSiwsMessage(params: {
  domain: string;
  walletPubkey: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    `${params.domain} wants you to sign in with your Solana account:`,
    params.walletPubkey,
    '',
    'Statement: Sign in to Archon. This will not trigger a transaction.',
    '',
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expiration Time: ${params.expiresAt}`,
  ].join('\n');
}

/**
 * Verifies an Ed25519 signature produced by a Solana wallet's signMessage().
 *
 * @param walletPubkey - Base58-encoded 32-byte Ed25519 public key
 * @param signature    - Base64-encoded 64-byte Ed25519 signature (Phantom format)
 * @param message      - The exact UTF-8 string that was signed
 */
export function verifySiwsSignature(params: {
  walletPubkey: string;
  signature: string;
  message: string;
}): boolean {
  try {
    const pubkeyBytes = bs58.decode(params.walletPubkey);
    if (pubkeyBytes.length !== 32) return false;

    // Phantom returns signatures as base64; also accept hex for testing
    const sigBase64 = Buffer.from(params.signature, 'base64');
    const sigBytes =
      sigBase64.length === 64
        ? sigBase64
        : Buffer.from(params.signature, 'hex');

    if (sigBytes.length !== 64) return false;

    const msgBytes = Buffer.from(params.message, 'utf8');
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}
