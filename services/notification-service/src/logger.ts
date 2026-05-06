import pino from 'pino';

export function createLogger(service: string) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service },
    ...(process.env.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  });
}
