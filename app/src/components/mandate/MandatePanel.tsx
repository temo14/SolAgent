import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Shield, ShieldCheck, Loader2, Settings } from 'lucide-react';
import { api } from '../../lib/api';
import { MANDATE_PROGRAM_ID, SYSTEM_PROGRAM_ID, anchorDisc, deriveMandatePda } from '../../lib/mandateUtils';

/**
 * Borsh-encodes CreateMandateParams and prepends the Anchor discriminator.
 *   [disc(8)] [delegate Pubkey(32)] [max_per_tx u64 LE(8)] [max_per_day u64 LE(8)] [expires_at i64 LE(8)]
 */
async function buildCreateMandateData(
  delegate: PublicKey,
  maxPerTxLamports: bigint,
  maxPerDayLamports: bigint,
): Promise<Buffer> {
  const disc = await anchorDisc('create_mandate');
  const buf = Buffer.allocUnsafe(8 + 32 + 8 + 8 + 8);
  Buffer.from(disc).copy(buf, 0);
  delegate.toBuffer().copy(buf, 8);
  buf.writeBigUInt64LE(maxPerTxLamports, 40);
  buf.writeBigUInt64LE(maxPerDayLamports, 48);
  buf.writeBigInt64LE(0n, 56); // expires_at = 0 (no expiry)
  return buf;
}

interface MandatePanelProps {
  agentWalletId: string;
  agentPubkey: string;
  mandatePda: string | null;
  onMandateCreated: (pda: string) => void;
  onManage?: () => void;
  jwt: string;
}

export function MandatePanel({
  agentWalletId,
  agentPubkey,
  mandatePda,
  onMandateCreated,
  onManage,
  jwt,
}: MandatePanelProps) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [isOpen, setIsOpen] = useState(false);
  const [maxPerTxSol, setMaxPerTxSol] = useState('0.5');
  const [maxPerDaySol, setMaxPerDaySol] = useState('2');
  const [isSending, setIsSending] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const hasMandate = mandatePda !== null;

  const handleCreate = async () => {
    if (!publicKey || !sendTransaction) return;
    setTxError(null);
    setIsSending(true);

    try {
      const agentPk = new PublicKey(agentPubkey);
      const ownerPk = publicKey;
      const pda = deriveMandatePda(ownerPk);

      const maxPerTx = BigInt(Math.floor(parseFloat(maxPerTxSol) * LAMPORTS_PER_SOL));
      const maxPerDay = BigInt(Math.floor(parseFloat(maxPerDaySol) * LAMPORTS_PER_SOL));

      const data = await buildCreateMandateData(agentPk, maxPerTx, maxPerDay);

      // Accounts: [mandate (init, mut, PDA), owner (mut, signer), system_program]
      const ix = new TransactionInstruction({
        programId: MANDATE_PROGRAM_ID,
        keys: [
          { pubkey: pda, isSigner: false, isWritable: true },
          { pubkey: ownerPk, isSigner: true, isWritable: true },
          { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data,
      });

      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const msg = new TransactionMessage({
        payerKey: ownerPk,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message();

      const tx = new VersionedTransaction(msg);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      // Record the PDA in the backend so exec-worker can find it.
      await api.patch(`/api/agent-wallets/${agentWalletId}/mandate`, { mandatePda: pda.toBase58() }, jwt);

      onMandateCreated(pda.toBase58());
      setIsOpen(false);
    } catch (err) {
      setTxError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="phantom-card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {hasMandate ? (
            <ShieldCheck size={18} className="text-brand-safe shrink-0" />
          ) : (
            <Shield size={18} className="text-black/30 shrink-0" />
          )}
          <div>
            <h3 className="text-sm font-black tracking-tight leading-none mb-0.5">On-Chain Limits</h3>
            <p className="text-[10px] text-black/40 font-bold uppercase tracking-wider">
              {hasMandate ? 'Mandate active' : 'Not configured'}
            </p>
          </div>
        </div>
        {hasMandate ? (
          <button
            onClick={onManage}
            className="text-[10px] font-bold text-black/30 hover:text-brand-ink flex items-center gap-1 transition-colors"
          >
            <Settings size={11} /> Manage
          </button>
        ) : (
          <button
            onClick={() => setIsOpen(true)}
            className="text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl bg-brand-ink text-white hover:bg-black transition-colors"
          >
            Set Limits
          </button>
        )}
      </div>

      <p className="text-[11px] text-black/40 font-medium leading-relaxed">
        {hasMandate
          ? 'Spending limits enforced on-chain — the agent cannot exceed them regardless of server state.'
          : 'Set per-tx and daily SOL limits enforced atomically by the Solana program — not the server.'}
      </p>

      {/* Create mandate modal */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
            onClick={(e) => { if (e.target === e.currentTarget) setIsOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="bg-white rounded-[28px] p-8 w-full max-w-sm shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-2xl bg-brand-ink flex items-center justify-center">
                  <Shield size={18} className="text-white" />
                </div>
                <h2 className="text-xl font-black tracking-tight">Set Spending Limits</h2>
              </div>
              <p className="text-xs text-black/40 font-medium mb-6 leading-relaxed">
                Enforced on-chain by the Archon Mandate program. Sign once — limits are permanent until you update them.
              </p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-black/40 block mb-2">
                    Max per transaction (SOL)
                  </label>
                  <input
                    type="number"
                    min="0.001"
                    step="0.1"
                    value={maxPerTxSol}
                    onChange={(e) => setMaxPerTxSol(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-black/[0.03] border border-black/[0.06] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-ink/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-black/40 block mb-2">
                    Max per day (SOL)
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.5"
                    value={maxPerDaySol}
                    onChange={(e) => setMaxPerDaySol(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-black/[0.03] border border-black/[0.06] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-ink/20"
                  />
                </div>
              </div>

              {txError && (
                <p className="text-xs text-brand-stop font-medium mb-4 px-3 py-2 bg-brand-stop/5 rounded-xl break-words">
                  {txError}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setIsOpen(false); setTxError(null); }}
                  className="flex-1 h-12 rounded-2xl border border-black/10 text-sm font-bold text-black/40 hover:bg-black/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleCreate()}
                  disabled={isSending || !publicKey}
                  className="flex-1 h-12 rounded-2xl bg-brand-ink text-white text-sm font-black hover:bg-black transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSending ? (
                    <><Loader2 size={15} className="animate-spin" /> Signing…</>
                  ) : (
                    'Sign & Activate'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
