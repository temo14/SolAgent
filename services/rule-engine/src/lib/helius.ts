/**
 * Helius webhook management.
 *
 * On rule activation, the agent wallet must be added to a Helius enhanced
 * webhook so that on-chain transactions trigger the event-listener service.
 *
 * Strategy:
 *  1. List existing webhooks for this API key.
 *  2. If a webhook matching our URL already exists, append the address to it
 *     via a PATCH (Helius deduplicates addresses server-side).
 *  3. Otherwise create a new webhook with the full address list.
 *
 * This function is idempotent: calling it twice for the same address is safe.
 */

import { z } from 'zod';

// ─── Helius API types ─────────────────────────────────────────────────────────

const HeliusWebhookSchema = z.object({
  webhookID: z.string(),
  webhookURL: z.string(),
  accountAddresses: z.array(z.string()),
  transactionTypes: z.array(z.string()),
  webhookType: z.string(),
});

type HeliusWebhook = z.infer<typeof HeliusWebhookSchema>;

const HeliusWebhookListSchema = z.array(HeliusWebhookSchema);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConfig(): { apiKey: string; webhookUrl: string } {
  const apiKey = process.env.HELIUS_API_KEY;
  const webhookUrl = process.env.HELIUS_WEBHOOK_URL;

  if (!apiKey) throw new Error('HELIUS_API_KEY env var is required');
  if (!webhookUrl) throw new Error('HELIUS_WEBHOOK_URL env var is required');

  return { apiKey, webhookUrl };
}

async function listWebhooks(apiKey: string): Promise<HeliusWebhook[]> {
  const res = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Helius list webhooks error ${res.status}: ${await res.text()}`);
  }
  const body: unknown = await res.json();
  const parsed = HeliusWebhookListSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Unexpected Helius webhook list shape: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function createWebhook(
  apiKey: string,
  webhookUrl: string,
  agentWalletPubkey: string,
): Promise<void> {
  const res = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhookURL: webhookUrl,
      transactionTypes: ['ANY'],
      accountAddresses: [agentWalletPubkey],
      webhookType: 'enhanced',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Helius create webhook error ${res.status}: ${await res.text()}`);
  }
}

async function appendAddressToWebhook(
  apiKey: string,
  webhookId: string,
  existing: HeliusWebhook,
  agentWalletPubkey: string,
): Promise<void> {
  // Deduplicate locally before sending — Helius also deduplicates, but this
  // avoids a needless network write.
  if (existing.accountAddresses.includes(agentWalletPubkey)) return;

  const res = await fetch(
    `https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${apiKey}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...existing,
        accountAddresses: [...existing.accountAddresses, agentWalletPubkey],
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Helius update webhook ${webhookId} error ${res.status}: ${await res.text()}`,
    );
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Registers an agent wallet pubkey with a Helius enhanced webhook.
 * Idempotent — safe to call multiple times for the same address.
 *
 * Throws on network errors so the caller can decide whether to surface
 * the failure (non-fatal — Helius registration failure should not block
 * rule activation, but must be logged).
 */
export async function registerHeliusWebhook(agentWalletPubkey: string): Promise<void> {
  const { apiKey, webhookUrl } = getConfig();

  const existing = await listWebhooks(apiKey);

  // Find a webhook that already points to our event-listener URL
  const match = existing.find((wh) => wh.webhookURL === webhookUrl);

  if (match) {
    await appendAddressToWebhook(apiKey, match.webhookID, match, agentWalletPubkey);
  } else {
    await createWebhook(apiKey, webhookUrl, agentWalletPubkey);
  }
}
