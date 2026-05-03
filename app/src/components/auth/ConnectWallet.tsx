import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Fingerprint, ShieldCheck, AlertTriangle, Loader2, Smartphone, Puzzle } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { WalletName } from '@solana/wallet-adapter-base';
import { WalletConnectWalletName } from '@solana/wallet-adapter-walletconnect';
import { PhantomWalletName } from '@solana/wallet-adapter-phantom';
import { useAuth } from '../../context/AuthContext';

const WC_CONFIGURED = Boolean(
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim(),
);

export function ConnectWallet() {
  const {
    select,
    connect: walletConnect,
    disconnect: walletDisconnect,
    wallet,
    connected,
    publicKey,
    connecting,
  } = useWallet();

  const { isSigning, error, signIn, clearError } = useAuth();

  /**
   * Tracks whether the current wallet selection was triggered by the user
   * clicking one of our connect buttons. Without this guard the useEffect
   * below would call walletConnect() on any ambient wallet change.
   */
  const pendingConnect = useRef(false);

  // Step 2 of connection: once the adapter object changes (after select()),
  // open the wallet UI (Phantom popup or WalletConnect QR modal).
  useEffect(() => {
    if (!wallet || !pendingConnect.current) return;
    walletConnect().catch(() => {
      pendingConnect.current = false;
    });
  // wallet.adapter.name is stable once selected — re-run only when the adapter changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.adapter.name]);

  // Step 3: once the adapter reports connected + publicKey, run the SIWS flow.
  useEffect(() => {
    if (!connected || !publicKey) return;
    void signIn();
  // signIn identity is stable (useCallback); publicKey/connected come from adapter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toBase58()]);

  const handleSelect = (name: WalletName) => {
    clearError();
    pendingConnect.current = true;
    select(name);
  };

  const handleDisconnect = () => {
    pendingConnect.current = false;
    walletDisconnect().catch(() => undefined);
    clearError();
  };

  const isLoading = connecting || isSigning;

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-16">
          <motion.div
            animate={{ rotate: [0, 6, -6, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="w-20 h-20 rounded-[28px] bg-brand-ink flex items-center justify-center text-white font-black text-4xl mb-6 shadow-2xl shadow-black/20"
          >
            S
          </motion.div>
          <span className="text-3xl font-black tracking-tighter">SolAgent</span>
          <span className="text-[10px] font-bold tracking-[0.4em] text-brand-safe mt-1">
            VERIFIABLE AI WALLET
          </span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-[40px] border border-black/5 shadow-[0_24px_64px_rgba(0,0,0,0.06)] p-10 space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-black tracking-tight">Connect Your Wallet</h1>
            <p className="text-sm text-black/40 font-medium leading-relaxed">
              Sign in with your Solana wallet to access your agent. This will not trigger a
              transaction.
            </p>
          </div>

          {/* Trust signals */}
          <div className="space-y-3">
            {[
              { icon: ShieldCheck, text: 'Non-custodial — your keys, your wallet' },
              { icon: Fingerprint, text: 'One-time signature to prove ownership' },
            ].map(({ icon: Icon, text }) => (
              <div
                key={text}
                className="flex items-center gap-3 p-4 rounded-2xl bg-black/[0.02] border border-black/5"
              >
                <Icon size={16} className="text-brand-safe shrink-0" />
                <span className="text-xs font-semibold text-black/60">{text}</span>
              </div>
            ))}
          </div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="flex items-start gap-3 p-4 rounded-2xl bg-red-50 border border-red-100"
            >
              <AlertTriangle size={16} className="text-brand-stop mt-0.5 shrink-0" />
              <p className="text-xs font-bold text-brand-stop flex-1">{error}</p>
              <button
                onClick={() => { clearError(); handleDisconnect(); }}
                className="text-black/20 hover:text-black transition-colors text-xs font-bold"
              >
                ✕
              </button>
            </motion.div>
          )}

          {/* Wallet buttons */}
          <div className="space-y-3">
            {/* Browser extension (Phantom / wallet-standard) */}
            <motion.button
              whileHover={{ scale: isLoading ? 1 : 1.02 }}
              whileTap={{ scale: isLoading ? 1 : 0.98 }}
              onClick={() => handleSelect(PhantomWalletName)}
              disabled={isLoading}
              className="w-full h-16 rounded-[24px] bg-brand-ink text-white font-black text-sm tracking-widest uppercase flex items-center justify-center gap-3 shadow-2xl shadow-black/20 hover:shadow-black/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading && wallet?.adapter.name === PhantomWalletName ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  {isSigning ? 'Signing In…' : 'Connecting…'}
                </>
              ) : (
                <>
                  <Puzzle size={20} />
                  Browser Extension
                </>
              )}
            </motion.button>

            {/* WalletConnect — phone wallet via QR */}
            {WC_CONFIGURED && (
              <>
                <motion.button
                  whileHover={{ scale: isLoading ? 1 : 1.02 }}
                  whileTap={{ scale: isLoading ? 1 : 0.98 }}
                  onClick={() => handleSelect(WalletConnectWalletName)}
                  disabled={isLoading}
                  className="w-full h-16 rounded-[24px] bg-white border-2 border-black/10 text-black font-black text-sm tracking-widest uppercase flex items-center justify-center gap-3 hover:border-brand-ink/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isLoading && wallet?.adapter.name === WalletConnectWalletName ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      {isSigning ? 'Signing In…' : 'Scan QR…'}
                    </>
                  ) : (
                    <>
                      <Smartphone size={20} />
                      WalletConnect
                    </>
                  )}
                </motion.button>
                <p className="text-[10px] text-black/45 font-medium leading-relaxed px-1">
                  After the QR appears: open <span className="font-bold text-black/60">Phantom</span> (or your
                  wallet) → <span className="font-bold text-black/60">WalletConnect</span> → scan. The phone&apos;s
                  default camera often shows &quot;no usable data&quot; because it does not open{' '}
                  <span className="font-mono">wc:</span> links.
                </p>
              </>
            )}
          </div>

          <p className="text-center text-[10px] text-black/20 font-medium">
            {WC_CONFIGURED
              ? 'Browser extension, or connect a mobile wallet via WalletConnect (in-app scanner).'
              : 'Works with Phantom, Backpack, Solflare & all wallet-standard wallets'}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
