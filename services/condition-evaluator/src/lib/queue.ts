import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { execQueueName } from '@archon/shared';

let connection: IORedis | null = null;
const queueCache = new Map<string, Queue>();

function getConnection(): IORedis {
  if (connection === null) {
    connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    connection.on('error', (err) => {
      process.stderr.write(`[redis:bullmq] ${String(err)}\n`);
    });
  }
  return connection;
}

/**
 * Returns (or creates) the BullMQ Queue for a given agent wallet UUID.
 * Queue name: exec-<first-8-chars-of-UUID>
 * Concurrency = 1 is enforced by the Worker in execution-engine.
 */
export function getExecQueue(agentWalletId: string): Queue {
  const name = execQueueName(agentWalletId);
  let q = queueCache.get(name);
  if (q === undefined) {
    q = new Queue(name, {
      connection: getConnection(),
      defaultJobOptions: {
        removeOnComplete: 100, // keep last 100 completed jobs for debugging
        removeOnFail: 500,
      },
    });
    queueCache.set(name, q);
  }
  return q;
}

export async function closeQueues(): Promise<void> {
  const closes = [...queueCache.values()].map((q) => q.close());
  await Promise.all(closes);
  queueCache.clear();
  if (connection !== null) {
    await connection.quit();
    connection = null;
  }
}
