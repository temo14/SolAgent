import {
  Connection,
  PublicKey,
  VersionedTransaction,
  AddressLookupTableAccount,
  TransactionMessage,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionExpiredBlockheightExceededError,
} from '@solana/web3.js';

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (_connection === null) {
    const primary = process.env.SOLANA_RPC_URL;
    if (!primary) throw new Error('SOLANA_RPC_URL not set');
    _connection = new Connection(primary, 'confirmed');
  }
  return _connection;
}

export async function getSolBalance(pubkey: string): Promise<number> {
  const conn = getConnection();
  const lamports = await conn.getBalance(new PublicKey(pubkey), 'confirmed');
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Loads AddressLookupTableAccount objects for a list of ALT addresses.
 * Returns only successfully loaded accounts.
 */
export async function loadLookupTables(
  addresses: string[],
): Promise<AddressLookupTableAccount[]> {
  const conn = getConnection();
  const results = await Promise.all(
    addresses.map((addr) => conn.getAddressLookupTable(new PublicKey(addr))),
  );
  return results.flatMap((r) => (r.value ? [r.value] : []));
}

/**
 * Builds a versioned-v0 transfer instruction (SOL).
 */
export function buildTransferInstruction(
  fromPubkey: PublicKey,
  toPubkey: PublicKey,
  solAmount: number,
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey,
    toPubkey,
    lamports: Math.floor(solAmount * LAMPORTS_PER_SOL),
  });
}

/**
 * Compiles a VersionedTransaction v0 from a set of instructions.
 * The `payerKey` must be a signer of the returned transaction.
 */
export async function buildVersionedTransaction(
  payerKey: PublicKey,
  instructions: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[] = [],
): Promise<{ tx: VersionedTransaction; blockhash: string; lastValidBlockHeight: number }> {
  const conn = getConnection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');

  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  return { tx: new VersionedTransaction(message), blockhash, lastValidBlockHeight };
}

/**
 * Sends a signed VersionedTransaction and waits for confirmation.
 * Returns `{ signature, confirmed: true }` on success,
 * or `{ signature, confirmed: false }` on 60-second timeout.
 *
 * Per spec: NO auto-retry on timeout. Caller marks status=EXEC_TIMEOUT.
 */
export async function sendAndConfirm(
  tx: VersionedTransaction,
  blockhash: string,
  lastValidBlockHeight: number,
  timeoutMs = 60_000,
): Promise<{ signature: string; confirmed: boolean }> {
  const conn = getConnection();
  const raw = tx.serialize();
  const signature = await conn.sendRawTransaction(raw, { skipPreflight: false });

  const confirmPromise = conn
    .confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    .then(() => true)
    .catch((err: unknown) => {
      if (err instanceof TransactionExpiredBlockheightExceededError) return false;
      throw err;
    });

  const timeoutPromise = new Promise<false>((resolve) =>
    setTimeout(() => resolve(false), timeoutMs),
  );

  const confirmed = await Promise.race([confirmPromise, timeoutPromise]);
  return { signature, confirmed };
}
