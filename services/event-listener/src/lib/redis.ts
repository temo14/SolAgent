import IORedis from 'ioredis';

let client: IORedis | null = null;

export function getRedis(): IORedis {
  if (client === null) {
    client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    client.on('error', (err) => {
      process.stderr.write(`[redis:event-listener] ${String(err)}\n`);
    });
  }
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (client !== null) {
    await client.quit();
    client = null;
  }
}
