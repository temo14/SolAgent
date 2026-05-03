import IORedis from 'ioredis';

let _publisher: IORedis | null = null;

export function getPublisher(): IORedis {
  if (_publisher === null) {
    _publisher = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return _publisher;
}

export async function disconnectRedis(): Promise<void> {
  if (_publisher !== null) {
    await _publisher.quit();
    _publisher = null;
  }
}
