import type { ArchonRule } from '@archon/shared';
import { ERROR_CODES } from '@archon/shared';
import { parseRuleWithClaude } from './claude-parser.js';
import { parseRuleWithQvac, QvacError } from './qvac.js';

export { QvacError } from './qvac.js';

/**
 * Unified rule parser.
 *
 * Primary:  Claude API with forced tool use — ~200ms, 100% structured output.
 * Fallback: QVAC local model — offline-capable, no API key required.
 *
 * Claude is used when ANTHROPIC_API_KEY is present. On Claude API transport
 * errors (network, quota) the call transparently falls through to QVAC.
 * Validation errors (schema mismatch) are always surfaced immediately — they
 * indicate a bad user instruction, not an infra problem, and retrying QVAC
 * won't help.
 */
export async function parseRule(userInput: string): Promise<ArchonRule> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await parseRuleWithClaude(userInput);
    } catch (err) {
      if (
        err instanceof QvacError &&
        err.errorCode === ERROR_CODES.QVAC_UNAVAILABLE
      ) {
        // Claude transport/quota error — fall through to QVAC if available.
      } else {
        // Validation error or unexpected — bubble up immediately.
        throw err;
      }
    }
  }

  // Only try QVAC if it's configured and reachable.
  const qvacUrl = process.env.QVAC_BASE_URL;
  if (!qvacUrl) {
    throw new QvacError(
      'Claude API is unreachable and no fallback parser is configured. Check your network or ANTHROPIC_API_KEY.',
      ERROR_CODES.QVAC_UNAVAILABLE,
    );
  }
  return parseRuleWithQvac(userInput);
}
