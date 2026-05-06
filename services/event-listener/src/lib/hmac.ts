import { createHmac, timingSafeEqual } from 'crypto';
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

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  // Lengths must match before timingSafeEqual (it throws on length mismatch)
  if (expected.length !== received.length) return false;

  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
}

export { ERROR_CODES };
