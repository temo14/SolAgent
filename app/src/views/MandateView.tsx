import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  ShieldCheck,
  ShieldOff,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { Skeleton } from '../components/ui';
import { api } from '../lib/api';
import {
  MANDATE_PROGRAM_ID,
  anchorDisc,
  deriveMandatePda,
  lamportsToSol,
  type MandateState,
} from '../lib/mandateUtils';

const LAMPORTS_PER_SOL = 1_000_000_000;

interface MandateViewProps {
  jwt: string;
  agentWalletId: string;
  onBack: () => void;
}

// ── Update mandate instruction ─────────────────────────────────────────────────

async function buildUpdateMandateData(
  maxPerTxLamports: bigint,
  maxPerDayLamports: bigint,
  expiresAt: bigint,
): Promise<Buffer> {
  const disc = await anchorDisc('update_mandate');
  const buf = Buffer.allocUnsafe(8 + 8 + 8 + 8);
  Buffer.from(disc).copy(buf, 0);
  buf.writeBigUInt64LE(maxPerTxLamports, 8);
  buf.writeBigUInt64LE(maxPerDayLamports, 16);
  buf.writeBigInt64LE(expiresAt, 24);
  return buf;
}

async function buildRevokeMandateData(): Promise<Buffer> {
  const disc = await anchorDisc('revoke_mandate');
  return Buffer.from(disc);
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-2 bg-black/[0.06] rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function MandateView({ jwt, agentWalletId, onBack }: MandateViewProps) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [state, setState] = useState<MandateState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [updateOpen, setUpdateOpen] = useState(false);
  const [newMaxPerTxSol, setNewMaxPerTxSol] = useState('');
  const [newMaxPerDaySol, setNewMaxPerDaySol] = useState('');
  const [isSendingUpdate, setIsSendingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const [revokeOpen, setRevokeOpen] = useState(false);
  const [isSendingRevoke, setIsSendingRevoke] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const fetchState = useCallback(async (quiet = false) => {
    if (!quiet) setIsLoading(true);
    else setIsRefreshing(true);
    try {
      const res = await api.get<{ ok: boolean; data: MandateState | null }>(
        `/api/agent-wallets/${agentWalletId}/mandate-state`,
        jwt,
      );
      if (res.ok) setState(res.data);
    } catch {
      // non-fatal
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [agentWalletId, jwt]);

  useEffect(() => { void fetchState(); }, [fetchState]);

  const handleUpdate = async () => {
    if (!publicKey || !state) return;
    setUpdateError(null);
    setIsSendingUpdate(true);
    try {
      const pda = deriveMandatePda(publicKey);
      const maxPerTx  = BigInt(Math.floor(parseFloat(newMaxPerTxSol)  * LAMPORTS_PER_SOL));
      const maxPerDay = BigInt(Math.floor(parseFloat(newMaxPerDaySol) * LAMPORTS_PER_SOL));
      const data = await buildUpdateMandateData(maxPerTx, maxPerDay, 0n);

      const ix = new TransactionInstruction({
        programId: MANDATE_PROGRAM_ID,
        keys: [
          { pubkey: pda,       isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true,  isWritable: false },
        ],
        data,
      });
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const msg = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      setUpdateOpen(false);
      await fetchState(true);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsSendingUpdate(false);
    }
  };

  const handleRevoke = async () => {
    if (!publicKey || !state) return;
    setRevokeError(null);
    setIsSendingRevoke(true);
    try {
      const pda = deriveMandatePda(publicKey);
      const data = await buildRevokeMandateData();

      const ix = new TransactionInstruction({
        programId: MANDATE_PROGRAM_ID,
        keys: [
          { pubkey: pda,       isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true,  isWritable: false },
        ],
        data,
      });
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const msg = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      setRevokeOpen(false);
      await fetchState(true);
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsSendingRevoke(false);
    }
  };

  const openUpdate = () => {
    if (!state) return;
    setNewMaxPerTxSol(lamportsToSol(state.maxPerTxLamports).toString());
    setNewMaxPerDaySol(lamportsToSol(state.maxPerDayLamports).toString());
    setUpdateError(null);
    setUpdateOpen(true);
  };

  const spentSol  = state ? lamportsToSol(state.spentTodayLamports) : 0;
  const maxDay    = state ? lamportsToSol(state.maxPerDayLamports) : 0;
  const maxTx     = state ? lamportsToSol(state.maxPerTxLamports) : 0;
  const dayPct    = maxDay > 0 ? Math.min((spentSol / maxDay) * 100, 100) : 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8 max-w-2xl">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs font-bold text-black/40 hover:text-brand-ink transition-colors"
      >
        <ArrowLeft size={14} /> Back to Dashboard
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-tight mb-1">On-Chain Mandate</h2>
          <p className="text-sm text-black/40 font-medium">
            Spending limits enforced atomically by the Solana program
          </p>
        </div>
        <button
          onClick={() => void fetchState(true)}
          disabled={isRefreshing}
          className="p-3 hover:bg-black/5 rounded-full transition-colors"
        >
          <RefreshCw size={16} className={`text-black/30 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-[28px]" />
          <Skeleton className="h-32 rounded-[28px]" />
        </div>
      ) : !state ? (
        <div className="phantom-card text-center py-12">
          <ShieldOff size={40} className="text-black/10 mx-auto mb-4" />
          <p className="text-sm font-bold text-black/40">No mandate found on chain.</p>
          <p className="text-xs text-black/30 mt-1">Create one from the Dashboard.</p>
        </div>
      ) : (
        <>
          {/* Status card */}
          <div className="phantom-card">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                {state.isActive ? (
                  <ShieldCheck size={22} className="text-brand-safe" />
                ) : (
                  <ShieldOff size={22} className="text-brand-stop" />
                )}
                <div>
                  <h3 className="text-base font-black tracking-tight">
                    {state.isActive ? 'Mandate Active' : 'Mandate Revoked'}
                  </h3>
                  <p className="text-[10px] font-bold text-black/40 uppercase tracking-wider">
                    {Number(state.totalExecutions).toLocaleString()} total executions
                  </p>
                </div>
              </div>
              <a
                href={`https://explorer.solana.com/address/${state.mandatePda}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-bold text-black/30 hover:text-brand-ink flex items-center gap-1 transition-colors"
              >
                Explorer <ExternalLink size={10} />
              </a>
            </div>

            {/* Daily spend progress */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-black/40">
                  Spent Today
                </span>
                <span className="text-xs font-bold">
                  <span className={dayPct > 80 ? 'text-brand-stop' : 'text-black/70'}>
                    {spentSol.toFixed(4)} SOL
                  </span>
                  <span className="text-black/30"> / {maxDay.toFixed(4)} SOL</span>
                </span>
              </div>
              <ProgressBar
                value={spentSol}
                max={maxDay}
                color={dayPct > 80 ? 'bg-brand-stop' : dayPct > 50 ? 'bg-brand-wait' : 'bg-brand-safe'}
              />
              {dayPct > 80 && (
                <p className="text-[10px] text-brand-stop font-bold mt-1.5 flex items-center gap-1">
                  <AlertTriangle size={10} /> {dayPct.toFixed(0)}% of daily limit used
                </p>
              )}
            </div>

            {/* Limits grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="px-4 py-3 rounded-2xl bg-black/[0.02] border border-black/[0.04]">
                <p className="text-[9px] font-black uppercase tracking-widest text-black/30 mb-1">Max per Tx</p>
                <p className="text-lg font-black">{maxTx.toFixed(4)} <span className="text-black/30 text-xs font-bold">SOL</span></p>
              </div>
              <div className="px-4 py-3 rounded-2xl bg-black/[0.02] border border-black/[0.04]">
                <p className="text-[9px] font-black uppercase tracking-widest text-black/30 mb-1">Max per Day</p>
                <p className="text-lg font-black">{maxDay.toFixed(4)} <span className="text-black/30 text-xs font-bold">SOL</span></p>
              </div>
            </div>
          </div>

          {/* Actions */}
          {state.isActive && (
            <div className="flex gap-4">
              <button
                onClick={openUpdate}
                className="flex-1 h-12 rounded-2xl bg-brand-ink text-white text-sm font-black hover:bg-black transition-colors"
              >
                Update Limits
              </button>
              <button
                onClick={() => { setRevokeError(null); setRevokeOpen(true); }}
                className="flex-1 h-12 rounded-2xl border-2 border-brand-stop/30 text-brand-stop text-sm font-black hover:bg-brand-stop/5 transition-colors"
              >
                Revoke Access
              </button>
            </div>
          )}
        </>
      )}

      {/* Update Limits modal */}
      <AnimatePresence>
        {updateOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
            onClick={(e) => { if (e.target === e.currentTarget) setUpdateOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="bg-white rounded-[28px] p-8 w-full max-w-sm shadow-2xl"
            >
              <h2 className="text-xl font-black tracking-tight mb-1">Update Limits</h2>
              <p className="text-xs text-black/40 font-medium mb-6 leading-relaxed">
                New limits take effect on the next execution. Sign the update transaction from your wallet.
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
                    value={newMaxPerTxSol}
                    onChange={(e) => setNewMaxPerTxSol(e.target.value)}
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
                    value={newMaxPerDaySol}
                    onChange={(e) => setNewMaxPerDaySol(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-black/[0.03] border border-black/[0.06] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-ink/20"
                  />
                </div>
              </div>

              {updateError && (
                <p className="text-xs text-brand-stop font-medium mb-4 px-3 py-2 bg-brand-stop/5 rounded-xl break-words">{updateError}</p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setUpdateOpen(false)}
                  className="flex-1 h-12 rounded-2xl border border-black/10 text-sm font-bold text-black/40 hover:bg-black/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleUpdate()}
                  disabled={isSendingUpdate || !publicKey}
                  className="flex-1 h-12 rounded-2xl bg-brand-ink text-white text-sm font-black hover:bg-black transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSendingUpdate ? <><Loader2 size={15} className="animate-spin" /> Signing…</> : 'Sign & Update'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Revoke Access modal */}
      <AnimatePresence>
        {revokeOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
            onClick={(e) => { if (e.target === e.currentTarget) setRevokeOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="bg-white rounded-[28px] p-8 w-full max-w-sm shadow-2xl"
            >
              <div className="w-12 h-12 rounded-2xl bg-brand-stop/10 flex items-center justify-center mb-5">
                <AlertTriangle size={22} className="text-brand-stop" />
              </div>
              <h2 className="text-xl font-black tracking-tight mb-2">Revoke Agent Access?</h2>
              <p className="text-sm text-black/50 font-medium mb-6 leading-relaxed">
                This will permanently disable automated execution for this mandate. Active rules will stop firing immediately. You cannot undo this without creating a new mandate.
              </p>

              {revokeError && (
                <p className="text-xs text-brand-stop font-medium mb-4 px-3 py-2 bg-brand-stop/5 rounded-xl break-words">{revokeError}</p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setRevokeOpen(false)}
                  className="flex-1 h-12 rounded-2xl border border-black/10 text-sm font-bold text-black/40 hover:bg-black/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleRevoke()}
                  disabled={isSendingRevoke || !publicKey}
                  className="flex-1 h-12 rounded-2xl bg-brand-stop text-white text-sm font-black hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSendingRevoke ? <><Loader2 size={15} className="animate-spin" /> Signing…</> : 'Yes, Revoke'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
