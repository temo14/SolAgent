import { TransactionInstruction, PublicKey, AccountMeta } from '@solana/web3.js';
import { TOKEN_MINTS } from '@solagent/shared';

const JUPITER_BASE_URL = process.env.JUPITER_BASE_URL ?? 'https://quote-api.jup.ag/v6';

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

function getMint(asset: string): string {
  const mint = TOKEN_MINTS[asset as keyof typeof TOKEN_MINTS];
  if (!mint) throw new Error(`Unsupported asset: ${asset}`);
  return mint;
}

/** Decimals for the main supported assets. */
const DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
  JUP: 6,
  BONK: 5,
  WIF: 6,
};

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
  slippageBps = 50,
): Promise<JupiterQuoteResult> {
  const inputMint = getMint(fromAsset);
  const outputMint = getMint(toAsset);
  const fromDecimals = DECIMALS[fromAsset] ?? 9;
  const toDecimals = DECIMALS[toAsset] ?? 9;

  const atomicAmount = Math.floor(amount * Math.pow(10, fromDecimals));

  const url = new URL(`${JUPITER_BASE_URL}/quote`);
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', String(atomicAmount));
  url.searchParams.set('slippageBps', String(slippageBps));
  url.searchParams.set('onlyDirectRoutes', 'false');

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
  const res = await fetch(`${JUPITER_BASE_URL}/swap-instructions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
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
