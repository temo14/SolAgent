import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { execQueueName } from '@solagent/shared';

let _connection: IORedis | null = null;
const queueCache = new Map<string, Queue>();

function getQueueConnection(): IORedis {
  if (_connection === null) {
    _connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    _connection.on('error', (err) => {
      process.stderr.write(`[redis:exec-queue] ${String(err)}\n`);
    });
  }
  return _connection;
}

/**
 * Returns (or creates) a cached BullMQ Queue for the given wallet pubkey.
 * Reused by both exec-worker retries and any future dispatch sites.
 */
export function getExecQueue(walletPubkey: string): Queue {
  const name = execQueueName(walletPubkey);
  let q = queueCache.get(name);
  if (q === undefined) {
    q = new Queue(name, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
    queueCache.set(name, q);
  }
  return q;
}

export async function closeExecQueues(): Promise<void> {
  const closes = [...queueCache.values()].map((q) => q.close());
  await Promise.all(closes);
  queueCache.clear();
  if (_connection !== null) {
    await _connection.quit();
    _connection = null;
  }
}
