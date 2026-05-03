import cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';
import { getPrisma } from './prisma.js';

/**
 * Schedules a daily reset of `firesToday` for all non-archived rules.
 * Runs at 00:00 UTC every day.
 *
 * Returns the scheduled task so the caller can destroy it on graceful shutdown.
 */
export function scheduleDailyFiresReset(log: FastifyBaseLogger): cron.ScheduledTask {
  const task = cron.schedule(
    '0 0 * * *',
    async () => {
      log.info('Running daily firesToday reset...');
      try {
        const prisma = getPrisma();
        const { count } = await prisma.rule.updateMany({
          where: {
            status: { notIn: ['ARCHIVED', 'COMPLETED'] },
            firesToday: { gt: 0 },
          },
          data: { firesToday: 0 },
        });
        log.info({ resetCount: count }, 'Daily firesToday reset complete');
      } catch (err) {
        log.error({ err }, 'Daily firesToday reset failed');
      }
    },
    { timezone: 'UTC' },
  );

  log.info('Daily firesToday reset cron scheduled (00:00 UTC)');
  return task;
}
