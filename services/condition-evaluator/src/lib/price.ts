import { TOKEN_MINTS } from '@solagent/shared';

interface JupiterPriceEntry {
  id: string;
  type: string;
  price: string;
}

interface JupiterPriceV2Response {
  data: Record<string, JupiterPriceEntry>;
  timeTaken: number;
}

/**
 * Fetches the USD price for a supported Solana asset using the Jupiter Price API v2.
 *
 * @param asset - One of: SOL, USDC, USDT, JUP, BONK
 * @returns Price in USD as a float
 * @throws if the asset is unsupported or Jupiter is unreachable
 */
export async function getAssetPriceUsd(asset: string): Promise<number> {
  const mint = TOKEN_MINTS[asset as keyof typeof TOKEN_MINTS];
  if (!mint) {
    throw new Error(`getAssetPriceUsd: unsupported asset "${asset}"`);
  }

  const url = `https://api.jup.ag/price/v2?ids=${mint}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new Error(
      `Jupiter Price API unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    throw new Error(`Jupiter Price API HTTP ${res.status}`);
  }

  const json = (await res.json()) as JupiterPriceV2Response;
  const entry = json.data[mint];
  if (entry === undefined) {
    throw new Error(`No price data returned for ${asset} (mint=${mint})`);
  }

  const price = parseFloat(entry.price);
  if (isNaN(price)) {
    throw new Error(`Jupiter returned non-numeric price for ${asset}: "${entry.price}"`);
  }

  return price;
}
