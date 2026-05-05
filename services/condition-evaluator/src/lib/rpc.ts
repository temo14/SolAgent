export const LAMPORTS_PER_SOL = 1_000_000_000;

interface RpcResult<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

async function rpcPost<T>(method: string, params: unknown[]): Promise<T> {
  // Same primary as execution-engine; SOLANA_RPC_PRIMARY kept as optional legacy alias
  const primaryUrl =
    process.env.SOLANA_RPC_URL ?? process.env.SOLANA_RPC_PRIMARY;
  const fallbackUrl = process.env.SOLANA_RPC_FALLBACK ?? 'https://api.devnet.solana.com';

  // Try primary first, fall back to secondary on network failure
  for (const url of [primaryUrl, fallbackUrl].filter(Boolean) as string[]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) continue;

      const json = (await res.json()) as RpcResult<T>;
      if (json.error !== undefined) {
        throw new Error(`RPC error [${method}]: ${json.error.message}`);
      }
      if (json.result === undefined) {
        throw new Error(`RPC returned no result for ${method}`);
      }
      return json.result;
    } catch (err) {
      if (url === (fallbackUrl as string)) throw err; // exhausted all URLs
    }
  }
  throw new Error('All RPC endpoints unreachable');
}

/**
 * Returns the SOL balance of a pubkey in lamports (NOT SOL units).
 * Callers must divide by LAMPORTS_PER_SOL to get SOL.
 * Named explicitly to prevent confusion with execution-engine's getSolBalance,
 * which returns SOL units directly via @solana/web3.js Connection.getBalance.
 */
export async function getSolBalanceLamports(pubkey: string): Promise<number> {
  const result = await rpcPost<{ value: number }>('getBalance', [
    pubkey,
    { commitment: 'confirmed' },
  ]);
  return result.value;
}

/**
 * Returns the current confirmed slot.
 */
export async function getCurrentSlot(): Promise<number> {
  return rpcPost<number>('getSlot', [{ commitment: 'confirmed' }]);
}
