/**
 * Jupiter strict token list resolver — in-memory cache, 1-hour TTL.
 * Resolves token symbol → mint address / decimals for services that need it.
 */

interface JupiterToken {
  symbol: string;
  address: string;
  decimals: number;
}

let symbolCache: Map<string, string> | null = null;
let decimalsCache: Map<string, number> | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

async function refreshCache(): Promise<void> {
  const res = await fetch('https://token.jup.ag/strict', {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Jupiter token list HTTP ${res.status}`);
  const tokens = (await res.json()) as JupiterToken[];

  const sym = new Map<string, string>();
  const dec = new Map<string, number>();
  for (const t of tokens) {
    const key = t.symbol.toUpperCase();
    sym.set(key, t.address);
    dec.set(key, t.decimals);
  }
  symbolCache = sym;
  decimalsCache = dec;
  cacheTs = Date.now();
}

async function ensureCache(): Promise<void> {
  if (symbolCache && Date.now() - cacheTs < CACHE_TTL_MS) return;
  await refreshCache();
}

export async function symbolToMint(symbol: string): Promise<string | null> {
  try {
    await ensureCache();
    return symbolCache!.get(symbol.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

export async function symbolToDecimals(symbol: string): Promise<number | null> {
  try {
    await ensureCache();
    return decimalsCache!.get(symbol.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}
