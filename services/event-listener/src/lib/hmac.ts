import { timingSafeEqual } from 'crypto';
import { ERROR_CODES } from '@archon/shared';

/**
 * Validates the HMAC-SHA256 signature on an incoming Helius webhook.
 *
 * Helius sends the raw webhook secret (or its HMAC of the body) in the
 * Authorization header. We compute HMAC-SHA256(HELIUS_WEBHOOK_SECRET, rawBody)
 * and compare with timing-safe equality to prevent timing attacks.
 *
 * Header format accepted: "<hex>" or "Bearer <hex>"
 *
 * @throws if HELIUS_WEBHOOK_SECRET env var is not configured
 */
export function validateHeliusHmac(
  rawBody: Buffer,
  authHeader: string | undefined,
): boolean {
  const secret = process.env.HELIUS_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('HELIUS_WEBHOOK_SECRET env var is required');
  }
  if (!authHeader) return false;

  // Strip "Bearer " prefix if present
  const received = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  // Helius sends the raw secret directly in the Authorization header (not an HMAC).
  if (secret.length !== received.length) return false;

  return timingSafeEqual(Buffer.from(secret, 'utf8'), Buffer.from(received, 'utf8'));
}

export { ERROR_CODES };
