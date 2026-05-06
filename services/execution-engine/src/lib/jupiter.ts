import { TransactionInstruction, PublicKey, AccountMeta } from '@solana/web3.js';
import { TOKEN_MINTS, DEFAULT_MAX_SLIPPAGE_BPS, symbolToMint, symbolToDecimals } from '@archon/shared';
import { getConnection } from './rpc.js';

const JUPITER_BASE_URL = process.env.JUPITER_BASE_URL ?? 'https://quote-api.jup.ag/v6';

// Platform fee: 0.1% by default. Set ARCHON_FEE_BPS=0 to disable.
// ARCHON_FEE_ACCOUNT must be a Jupiter referral token account for the output token.
const PLATFORM_FEE_BPS = Number(process.env.ARCHON_FEE_BPS ?? 10);
const FEE_ACCOUNT = process.env.ARCHON_FEE_ACCOUNT ?? '';

// ─── Types from Jupiter v6 swap-instructions endpoint ────────────────────────

interface JupiterAccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

interface JupiterInstruction {
  programId: string;
  accounts: JupiterAccountMeta[];
  data: string; // base64
}

interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: unknown[];
  slippageBps: number;
  [k: string]: unknown;
}

interface JupiterSwapInstructionsResponse {
  tokenLedgerInstruction?: JupiterInstruction;
  computeBudgetInstructions: JupiterInstruction[];
  setupInstructions: JupiterInstruction[];
  swapInstruction: JupiterInstruction;
  cleanupInstruction?: JupiterInstruction;
  addressLookupTableAddresses: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toInstruction(raw: JupiterInstruction): TransactionInstruction {
  const keys: AccountMeta[] = raw.accounts.map((a) => ({
    pubkey: new PublicKey(a.pubkey),
    isSigner: a.isSigner,
    isWritable: a.isWritable,
  }));
  return new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    keys,
    data: Buffer.from(raw.data, 'base64'),
  });
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function getMint(asset: string): Promise<string> {
  if (BASE58_RE.test(asset)) return asset;
  const upper = asset.toUpperCase();
  const knownMint = TOKEN_MINTS[upper];
  if (knownMint) return knownMint;
  // Fall back to Jupiter strict token list (cached 1h)
  const listMint = await symbolToMint(upper);
  if (listMint) return listMint;
  throw new Error(
    `Unknown token "${asset}". Use a direct SPL mint address or a known symbol (SOL, USDC, WIF, JTO…).`,
  );
}

/** Known decimals. For unlisted tokens we check token-list then fall back to chain. */
const DECIMALS: Record<string, number> = {
  SOL: 9, USDC: 6, USDT: 6, JUP: 6, BONK: 5,
  WIF: 6, JTO: 9, PYTH: 6, RENDER: 8, ORCA: 6,
  RAY: 6, SAMO: 9, WEN: 5, POPCAT: 9, MEW: 6, MNGO: 6,
};

async function getDecimalsFor(asset: string, mintAddress: string): Promise<number> {
  const upper = asset.toUpperCase();
  const known = DECIMALS[upper];
  if (known !== undefined) return known;
  // Try Jupiter token list before hitting the RPC
  const listDec = await symbolToDecimals(upper);
  if (listDec !== null) return listDec;
  try {
    const conn = getConnection();
    const info = await conn.getParsedAccountInfo(new PublicKey(mintAddress));
    const data = info.value?.data;
    if (data && typeof data === 'object' && 'parsed' in data) {
      const dec = (data as { parsed: { info?: { decimals?: number } } }).parsed?.info?.decimals;
      if (typeof dec === 'number') return dec;
    }
  } catch { /* fall through */ }
  return 6;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface JupiterQuoteResult {
  quoteResponse: JupiterQuoteResponse;
  /** Human-unit input amount (e.g. 10.0 USDC). Used by dual-oracle check. */
  inHuman: number;
  /** Human-unit output amount (e.g. 0.071 SOL). Used by dual-oracle check. */
  outHuman: number;
}

/**
 * Fetches the Jupiter v6 quote for an asset swap.
 * Amount is in human-readable units (e.g. 1.5 SOL, not lamports).
 */
export async function getJupiterQuote(
  fromAsset: string,
  toAsset: string,
  amount: number,
  slippageBps = DEFAULT_MAX_SLIPPAGE_BPS,
): Promise<JupiterQuoteResult> {
  const [inputMint, outputMint] = await Promise.all([getMint(fromAsset), getMint(toAsset)]);
  const [fromDecimals, toDecimals] = await Promise.all([
    getDecimalsFor(fromAsset, inputMint),
    getDecimalsFor(toAsset, outputMint),
  ]);

  const atomicAmount = Math.floor(amount * Math.pow(10, fromDecimals));

  const url = new URL(`${JUPITER_BASE_URL}/quote`);
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', String(atomicAmount));
  url.searchParams.set('slippageBps', String(slippageBps));
  url.searchParams.set('onlyDirectRoutes', 'false');
  if (PLATFORM_FEE_BPS > 0 && FEE_ACCOUNT) {
    url.searchParams.set('platformFeeBps', String(PLATFORM_FEE_BPS));
  }

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jupiter quote error ${res.status}: ${body}`);
  }
  const quoteResponse = (await res.json()) as JupiterQuoteResponse;

  const inHuman = Number(quoteResponse.inAmount) / Math.pow(10, fromDecimals);
  const outHuman = Number(quoteResponse.outAmount) / Math.pow(10, toDecimals);

  return { quoteResponse, inHuman, outHuman };
}

/**
 * Calls Jupiter's /swap-instructions to get individual instructions,
 * which we combine with our own Memo instruction.
 */
export async function getJupiterSwapInstructions(
  quoteResponse: JupiterQuoteResponse,
  userPublicKey: string,
): Promise<{
  instructions: TransactionInstruction[];
  altAddresses: string[];
}> {
  const swapBody: Record<string, unknown> = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  };
  if (PLATFORM_FEE_BPS > 0 && FEE_ACCOUNT) {
    swapBody.feeAccount = FEE_ACCOUNT;
  }

  const res = await fetch(`${JUPITER_BASE_URL}/swap-instructions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(swapBody),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jupiter swap-instructions error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as JupiterSwapInstructionsResponse;

  const instructions: TransactionInstruction[] = [
    ...data.computeBudgetInstructions.map(toInstruction),
    ...data.setupInstructions.map(toInstruction),
    toInstruction(data.swapInstruction),
    ...(data.cleanupInstruction ? [toInstruction(data.cleanupInstruction)] : []),
  ];

  return { instructions, altAddresses: data.addressLookupTableAddresses };
}
