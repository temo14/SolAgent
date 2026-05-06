import { Redis as IORedis } from 'ioredis';
import { REDIS_CHANNEL } from '@archon/shared';
import type { ExecResult } from '@archon/shared';

let _publisher: IORedis | null = null;

export function getPublisher(): IORedis {
  if (_publisher === null) {
    _publisher = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return _publisher;
}

export function createSubscriber(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

/**
 * Publishes an ExecResult to two channels:
 *  1. `EXEC_RESULT:<walletPubkey>`  — consumed by api-gateway SSE handler
 *  2. `EXEC_RESULT_ALL`             — consumed by audit-indexer
 */
export async function publishExecResult(result: ExecResult): Promise<void> {
  const pub = getPublisher();
  const json = JSON.stringify(result);
  await Promise.all([
    pub.publish(`${REDIS_CHANNEL.EXEC_RESULT}:${result.walletPubkey}`, json),
    pub.publish(REDIS_CHANNEL.EXEC_RESULT, json),
  ]);
}

export async function disconnectRedis(): Promise<void> {
  if (_publisher !== null) {
    await _publisher.quit();
    _publisher = null;
  }
}
