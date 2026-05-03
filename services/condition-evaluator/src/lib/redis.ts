import IORedis from 'ioredis';

let subscriberInstance: IORedis | null = null;

function buildClient(): IORedis {
  const client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    // null = reconnect indefinitely (subscriber must stay alive)
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  client.on('error', (err) => {
    process.stderr.write(`[redis:condition-evaluator] ${String(err)}\n`);
  });
  return client;
}

/** Singleton subscriber client — dedicated to pub/sub, never used for commands. */
export function getSubscriber(): IORedis {
  if (subscriberInstance === null) subscriberInstance = buildClient();
  return subscriberInstance;
}

export async function disconnectSubscriber(): Promise<void> {
  if (subscriberInstance !== null) {
    await subscriberInstance.quit();
    subscriberInstance = null;
  }
}
