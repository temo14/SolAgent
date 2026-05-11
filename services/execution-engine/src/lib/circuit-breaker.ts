import type { PrismaClient } from '@prisma/client';
import { REDIS_CHANNEL } from '@archon/shared';

/** How many consecutive FAILED logs in the window before we halt. */
const FAILURE_THRESHOLD = 3;
/** Rolling window in milliseconds (10 minutes). */
const WINDOW_MS = 10 * 60 * 1_000;

/**
 * Returns true if the rule should be paused due to repeated failures.
 * Does NOT mutate the rule — caller must call `triggerCircuitBreaker` separately.
 */
export async function isCircuitBreakerTripped(
  ruleId: string,
  prisma: PrismaClient,
): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const failures = await prisma.executionLog.count({
    where: {
      ruleId,
      status: 'FAILED',
      createdAt: { gte: since },
    },
  });
  return failures >= FAILURE_THRESHOLD;
}

/**
 * Pauses the rule with PAUSED_CIRCUIT_BREAKER status, records an AuditEvent,
 * and publishes a real-time notification so the UI and notification service
 * can alert the user immediately.
 */
export async function triggerCircuitBreaker(
  ruleId: string,
  walletPubkey: string,
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$transaction([
    prisma.rule.update({
      where: { id: ruleId },
      data: { status: 'PAUSED_CIRCUIT_BREAKER' },
    }),
    prisma.auditEvent.create({
      data: {
        walletPubkey,
        ruleId,
        eventType: 'CIRCUIT_BREAKER_HALT',
        payload: { ruleId, reason: `${FAILURE_THRESHOLD}+ failures in ${WINDOW_MS / 60_000} minutes` },
        isAnomalous: true,
      },
    }),
  ]);

  // Publish real-time event so SSE consumers and the notification service are
  // notified immediately rather than relying on DB polling.
  try {
    const { getPublisher } = await import('./redis.js');
    await getPublisher().publish(
      REDIS_CHANNEL.CIRCUIT_BREAKER_TRIPPED,
      JSON.stringify({ ruleId, walletPubkey, timestamp: new Date().toISOString() }),
    );
  } catch { /* non-fatal — audit event already persisted */ }
}
