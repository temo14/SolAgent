interface SendMessageOptions {
  parse_mode?: 'Markdown' | 'HTML';
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  opts: SendMessageOptions = {},
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...opts }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage HTTP ${res.status}: ${body}`);
  }
}
