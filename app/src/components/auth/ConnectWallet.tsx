import { motion } from 'motion/react';
import { Fingerprint, ShieldCheck, AlertTriangle, Loader2, ExternalLink } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export function ConnectWallet() {
  const { connect, isConnecting, error, clearError } = useAuth();

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
            A
          </motion.div>
          <span className="text-3xl font-black tracking-tighter">AURA</span>
          <span className="text-[10px] font-bold tracking-[0.4em] text-brand-safe mt-1">
            SECURE AGENT
          </span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-[40px] border border-black/5 shadow-[0_24px_64px_rgba(0,0,0,0.06)] p-10 space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-black tracking-tight">Connect Your Wallet</h1>
            <p className="text-sm text-black/40 font-medium leading-relaxed">
              Sign in with your Solana wallet to access your agent. This will not trigger a transaction.
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
              <div className="space-y-1">
                <p className="text-xs font-bold text-brand-stop">{error}</p>
                {error.includes('wallet') && (
                  <a
                    href="https://phantom.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-semibold text-brand-stop/70 flex items-center gap-1 hover:text-brand-stop transition-colors"
                  >
                    Get Phantom <ExternalLink size={10} />
                  </a>
                )}
              </div>
              <button
                onClick={clearError}
                className="ml-auto text-black/20 hover:text-black transition-colors text-xs font-bold"
              >
                ✕
              </button>
            </motion.div>
          )}

          {/* Connect button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => void connect()}
            disabled={isConnecting}
            className="w-full h-16 rounded-[24px] bg-brand-ink text-white font-black text-sm tracking-widest uppercase flex items-center justify-center gap-3 shadow-2xl shadow-black/20 hover:shadow-black/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isConnecting ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Signing In…
              </>
            ) : (
              <>
                <Fingerprint size={20} />
                Sign In With Solana
              </>
            )}
          </motion.button>

          <p className="text-center text-[10px] text-black/20 font-medium">
            Works with Phantom, Backpack, Solflare & all wallet-standard wallets
          </p>
        </div>
      </motion.div>
    </div>
  );
}
