import { Redis as IORedis } from 'ioredis';
import { createLogger } from './logger.js';
import { getPrisma, disconnectPrisma } from './prisma.js';
import { sendTelegramMessage } from './telegram.js';
import { REDIS_CHANNEL } from '@archon/shared';
import type { ExecResult } from '@archon/shared';

const log = createLogger('notification-service');

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// ─── Telegram link flow ───────────────────────────────────────────────────────
// When user clicks "Connect Telegram" → api-gateway stores
//   telegram:link:{token} = userId (TTL 600s)
// Bot receives /start {token} → this service looks it up, stores chatId in DB.

async function handleBotUpdate(
  redis: IORedis,
  update: TelegramUpdate,
): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = String(msg.chat.id);

  if (msg.text.startsWith('/start ')) {
    const token = msg.text.slice(7).trim();
    if (!token) return;

    const key = `telegram:link:${token}`;
    const userId = await redis.getdel(key);
    if (!userId) {
      await sendTelegramMessage(chatId, '❌ Link expired or invalid. Please generate a new link from the Archon app.');
      return;
    }

    const prisma = getPrisma();
    await prisma.user.update({
      where: { id: userId },
      data: { telegramChatId: chatId, notifyOnExec: true },
    });

    await sendTelegramMessage(chatId, '✅ Telegram connected! You\'ll receive alerts whenever your rules fire.');
    log.info({ userId, chatId }, 'Telegram linked');
  }

  if (msg.text === '/stop') {
    const prisma = getPrisma();
    await prisma.user.updateMany({
      where: { telegramChatId: chatId },
      data: { telegramChatId: null, notifyOnExec: false },
    });
    await sendTelegramMessage(chatId, '🔕 Notifications disabled. You can reconnect anytime from the Archon app.');
  }
}

// ─── Exec result handler ──────────────────────────────────────────────────────

async function handleExecResult(result: ExecResult): Promise<void> {
  if (result.status !== 'CONFIRMED' && result.status !== 'FAILED') return;

  const prisma = getPrisma();

  // Find user by walletPubkey → check if they want notifications
  const user = await prisma.user.findFirst({
    where: { walletPubkey: result.walletPubkey },
    select: {
      telegramChatId: true,
      notifyOnExec: true,
      notifyOnFail: true,
    },
  });

  if (!user?.telegramChatId) return;
  if (result.status === 'CONFIRMED' && !user.notifyOnExec) return;
  if (result.status === 'FAILED' && !user.notifyOnFail) return;

  // Fetch rule details for a richer message
  const rule = await prisma.rule.findUnique({
    where: { id: result.ruleId },
    select: { rawInput: true, firesToday: true, maxFiresDay: true },
  });

  const shortTx = result.txSignature
    ? `${result.txSignature.slice(0, 8)}…${result.txSignature.slice(-6)}`
    : null;

  let text: string;
  if (result.status === 'CONFIRMED') {
    text = [
      `✅ *Rule fired — Archon*`,
      ``,
      rule ? `Rule: "${rule.rawInput.slice(0, 80)}"` : '',
      shortTx ? `Tx: \`${shortTx}\`` : '',
      result.txSignature
        ? `[View on Explorer](https://explorer.solana.com/tx/${result.txSignature}?cluster=${process.env.SOLANA_NETWORK === 'mainnet' ? '' : process.env.SOLANA_NETWORK ?? 'devnet'})`
        : '',
      rule ? `Fires today: ${rule.firesToday + 1}/${rule.maxFiresDay}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    text = [
      `⚠️ *Rule failed — Archon*`,
      ``,
      rule ? `Rule: "${rule.rawInput.slice(0, 80)}"` : '',
      result.errorCode ? `Error: ${result.errorCode}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  await sendTelegramMessage(user.telegramChatId, text, { parse_mode: 'Markdown' });
}

// ─── Telegram long-polling ────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat: { id: number } };
}

async function pollTelegram(redis: IORedis): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  let offset = 0;
  while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`,
        { signal: AbortSignal.timeout(30_000) },
      );
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 5_000));
        continue;
      }
      const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
      for (const update of data.result ?? []) {
        offset = update.update_id + 1;
        await handleBotUpdate(redis, update).catch((err) =>
          log.error({ err }, 'bot update handler error'),
        );
      }
    } catch (err) {
      log.warn({ err }, 'Telegram poll error — retrying');
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
  const sub = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });

  sub.subscribe(REDIS_CHANNEL.EXEC_RESULT, (err) => {
    if (err) log.error({ err }, 'Redis subscribe failed');
    else log.info('Subscribed to exec results');
  });

  sub.on('message', (_channel, message) => {
    try {
      const result = JSON.parse(message) as ExecResult;
      void handleExecResult(result).catch((err) =>
        log.error({ err }, 'exec result handler error'),
      );
    } catch (err) {
      log.error({ err }, 'Failed to parse exec result message');
    }
  });

  // Start Telegram bot polling in background (no-op if no token set)
  void pollTelegram(redis).catch((err) => log.error({ err }, 'Telegram poll crashed'));

  log.info('Notification service started');

  const shutdown = async (): Promise<void> => {
    await sub.quit();
    await redis.quit();
    await disconnectPrisma();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

void main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
