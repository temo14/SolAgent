/**
 * Fetches Pyth Network prices via the Hermes REST API.
 * Hermes reads from on-chain Pyth accounts and serves them at low latency.
 * Docs: https://hermes.pyth.network/docs
 */

const HERMES_BASE = process.env.PYTH_HERMES_URL ?? 'https://hermes.pyth.network';

/** Pyth price feed IDs for supported assets (hex, without 0x prefix internally). */
const PRICE_FEED_IDS: Record<string, string> = {
  SOL: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  USDC: 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  USDT: '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
  JUP: '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
  BONK: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
  WIF: '4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc',
};

interface HermesPrice {
  price: string;
  conf: string;
  expo: number;
  publish_time: number;
}

interface HermesParsedFeed {
  id: string;
  price: HermesPrice;
  ema_price: HermesPrice;
}

interface HermesResponse {
  parsed: HermesParsedFeed[];
}

function parseHermesPrice(p: HermesPrice): number {
  return Number(p.price) * Math.pow(10, p.expo);
}

/**
 * Returns the latest Pyth USD price for a given asset symbol (e.g. "SOL").
 * Throws if the asset is not supported or if the fetch fails.
 */
export async function getPythPriceUsd(asset: string): Promise<number> {
  const feedId = PRICE_FEED_IDS[asset.toUpperCase()];
  if (!feedId) {
    throw new Error(`No Pyth price feed for asset: ${asset}`);
  }

  const url = `${HERMES_BASE}/v2/updates/price/latest?ids[]=${feedId}&encoding=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`Pyth Hermes error ${res.status} for ${asset}`);
  }

  const data = (await res.json()) as HermesResponse;
  const feed = data.parsed?.[0];
  if (!feed) throw new Error(`Pyth: empty response for ${asset}`);

  return parseHermesPrice(feed.price);
}

/**
 * Checks the dual-oracle price deviation between Jupiter and Pyth.
 * Returns the deviation ratio (0–1). Caller aborts if > 0.01 (1%).
 *
 * Both prices must represent the same quantity: USD per 1 unit of `fromAsset`.
 */
export async function dualOracleCheck(
  fromAsset: string,
  jupiterPriceUsd: number,
): Promise<{ pythPriceUsd: number; deviation: number }> {
  const pythPriceUsd = await getPythPriceUsd(fromAsset);
  const deviation = Math.abs(jupiterPriceUsd - pythPriceUsd) / pythPriceUsd;
  return { pythPriceUsd, deviation };
}
