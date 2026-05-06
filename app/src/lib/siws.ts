/**
 * SIWS (Sign-In With Solana) utilities for the frontend.
 * The `buildSiwsMessage` output MUST match api-gateway/src/lib/siws.ts exactly.
 */

/**
 * Builds the canonical SIWS message that the wallet signs.
 * The backend re-creates this string from the same params and verifies the signature.
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
 * Encodes a Uint8Array as base64.
 * Phantom's `signMessage` returns a Uint8Array; we encode it for the API.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  const binStr = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binStr);
}
