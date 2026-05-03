import IORedis from 'ioredis';

let commandClient: IORedis | null = null;

function buildClient(): IORedis {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const client = new IORedis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  client.on('error', (err) => {
    // Errors are surfaced here; Fastify's logger handles them upstream
    process.stderr.write(`[redis] ${String(err)}\n`);
  });
  return client;
}

/** Shared command client (set/get/del/setex/publish). */
export function getRedis(): IORedis {
  if (commandClient === null) commandClient = buildClient();
  return commandClient;
}

/** Fresh subscriber client — callers own its lifecycle. */
export function createSubscriber(): IORedis {
  return buildClient();
}

export async function disconnectRedis(): Promise<void> {
  if (commandClient !== null) {
    await commandClient.quit();
    commandClient = null;
  }
}
