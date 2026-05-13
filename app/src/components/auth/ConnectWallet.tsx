import { useEffect, useRef, useState } from 'react';
import { NETWORK_LABEL } from '../../lib/network';
import { motion, AnimatePresence } from 'motion/react';
import {
  Puzzle,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Fingerprint,
  Zap,
  Lock,
  Eye,
  ArrowRight,
  BarChart3,
  ChevronDown,
  X,
} from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PhantomWalletName } from '@solana/wallet-adapter-phantom';
import { useAuth } from '../../context/AuthContext';

// ─── Feature data ─────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Zap,
    title: 'Natural Language Rules',
    body: 'Describe what you want in plain English — "buy SOL when price drops below $120." Claude AI translates it into structured on-chain logic instantly.',
    accent: 'bg-brand-wait/10 text-brand-wait',
  },
  {
    icon: Eye,
    title: 'Dual Oracle Safety',
    body: 'Every swap cross-checks Jupiter quotes against Pyth oracle prices. Execution only proceeds when deviation is within 1% — protecting you from bad fills.',
    accent: 'bg-brand-accent/10 text-brand-accent',
  },
  {
    icon: ShieldCheck,
    title: 'Verifiable On-Chain Proof',
    body: 'Each execution emits a cryptographic Memo proof signed by your agent and recorded permanently on Solana. Fully auditable, fully yours.',
    accent: 'bg-brand-safe/10 text-brand-safe',
  },
  {
    icon: Lock,
    title: 'Non-Custodial by Design',
    body: 'Your keys never leave your browser. A per-user derived keypair acts on your behalf — no shared hot wallets, no central points of failure.',
    accent: 'bg-brand-stop/10 text-brand-stop',
  },
] as const;

const STEPS = [
  {
    number: '01',
    title: 'Connect Your Wallet',
    body: 'Link your Phantom wallet. One SIWS signature proves ownership — no transaction, no gas.',
  },
  {
    number: '02',
    title: 'Describe Your Rule',
    body: 'Type what you want in plain English. Preview the parsed logic before anything goes on-chain.',
  },
  {
    number: '03',
    title: 'Your Agent Executes',
    body: 'A dedicated wallet agent monitors conditions 24/7 and executes automatically — every action permanently recorded.',
  },
] as const;

const STATS = [
  { value: '< 1%', label: 'Max price deviation' },
  { value: '1s', label: 'Webhook latency' },
  { value: '100%', label: 'Non-custodial' },
  { value: 'Open', label: 'Source & verifiable' },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectWallet() {
  const {
    select,
    connect: walletConnect,
    disconnect: walletDisconnect,
    wallet,
    connected,
    publicKey,
    connecting,
    signMessage,
  } = useWallet();

  const { isSigning, error, signIn, clearError } = useAuth();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showConnectCard, setShowConnectCard] = useState(false);

  const connectSectionRef = useRef<HTMLDivElement>(null);

  const pendingConnect = useRef(false);
  const signInFlight = useRef(false);

  // Step 2: adapter selected → open Phantom popup
  useEffect(() => {
    if (!wallet || !pendingConnect.current) return;
    setConnectError(null);
    walletConnect().catch((err: unknown) => {
      pendingConnect.current = false;
      setConnectError(
        err instanceof Error ? err.message : 'Wallet connect failed',
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.adapter.name]);

  // Step 3: adapter connected → SIWS sign-in
  useEffect(() => {
    if (!connected || !publicKey) {
      signInFlight.current = false;
      return;
    }
    if (connecting) return;
    if (!signMessage) {
      setConnectError(
        'This wallet did not expose Solana message signing. Please use Phantom, Backpack, or Solflare.',
      );
      return;
    }
    setConnectError(null);
    if (signInFlight.current) return;
    signInFlight.current = true;
    void signIn().finally(() => {
      signInFlight.current = false;
    });
  }, [connected, connecting, publicKey, signMessage, signIn]);

  const handleConnect = () => {
    clearError();
    setConnectError(null);
    pendingConnect.current = true;
    if (wallet?.adapter.name === PhantomWalletName) {
      // Phantom already selected — select() is a no-op so the effect won't fire; connect directly.
      walletConnect().catch((err: unknown) => {
        pendingConnect.current = false;
        setConnectError(
          err instanceof Error ? err.message : 'Wallet connect failed',
        );
      });
    } else {
      select(PhantomWalletName);
    }
  };

  const handleDisconnect = () => {
    pendingConnect.current = false;
    signInFlight.current = false;
    walletDisconnect().catch(() => undefined);
    clearError();
    setConnectError(null);
  };

  const openConnectCard = () => {
    setShowConnectCard(true);
    setTimeout(() => {
      connectSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  };

  const isLoading = connecting || isSigning;
  const anyError = error ?? connectError;

  return (
    <div className="min-h-screen bg-brand-bg">

      {/* ── Sticky nav ──────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 glass px-6 sm:px-10 h-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[14px] bg-brand-ink flex items-center justify-center text-white font-black text-xl shadow-lg shadow-black/10">
            S
          </div>
          <div className="flex flex-col -space-y-0.5">
            <span className="text-lg font-black tracking-tighter leading-none">Archon</span>
            <span className="text-[9px] font-bold tracking-[0.35em] text-brand-safe leading-none">
              VERIFIABLE AI WALLET
            </span>
          </div>
        </div>

        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={openConnectCard}
          className="h-10 px-6 rounded-full bg-brand-ink text-white text-[11px] font-black uppercase tracking-widest shadow-lg shadow-black/10 hover:shadow-black/20 transition-shadow"
        >
          Launch App
        </motion.button>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 pt-24 pb-20 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-black/5 shadow-sm mb-10">
            <div className="w-2 h-2 rounded-full bg-brand-safe animate-pulse" />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-black/50">
              Built on Solana
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tighter leading-[0.95] mb-6">
            Automate Your
            <br />
            <span className="text-brand-ink">Solana Wallet</span>
            <br />
            <span className="text-brand-safe">Verifiably.</span>
          </h1>

          <p className="max-w-2xl mx-auto text-lg text-black/50 font-medium leading-relaxed mb-12">
            Define rules in plain English. Your dedicated on-chain agent executes them
            non-custodially — every action signed with a cryptographic proof, permanent
            on Solana.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              onClick={openConnectCard}
              className="w-full sm:w-auto h-14 px-10 rounded-2xl bg-brand-ink text-white font-black text-sm tracking-widest uppercase shadow-2xl shadow-black/20 hover:shadow-black/30 transition-shadow flex items-center justify-center gap-3"
            >
              <Puzzle size={18} />
              Connect Wallet
              <ArrowRight size={16} />
            </motion.button>
            <a
              href="#how-it-works"
              className="w-full sm:w-auto h-14 px-10 rounded-2xl bg-white border border-black/8 text-black font-black text-sm tracking-widest uppercase flex items-center justify-center gap-3 hover:border-black/20 transition-colors"
            >
              How It Works
              <ChevronDown size={16} />
            </a>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-black/5 rounded-3xl overflow-hidden border border-black/5">
            {STATS.map(({ value, label }) => (
              <div key={label} className="bg-white px-6 py-5 text-center">
                <div className="text-2xl font-black text-brand-ink mb-1">{value}</div>
                <div className="text-[11px] font-semibold text-black/35 uppercase tracking-wider">{label}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 pb-24">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-3">
            Engineered for Safety
          </h2>
          <p className="text-black/40 font-medium">
            Every layer of the stack is designed to protect your assets.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {FEATURES.map(({ icon: Icon, title, body, accent }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="bg-white rounded-[32px] border border-black/5 p-8 hover:-translate-y-1 transition-transform duration-300"
            >
              <div className={`w-12 h-12 rounded-2xl ${accent} flex items-center justify-center mb-5`}>
                <Icon size={22} />
              </div>
              <h3 className="text-lg font-black tracking-tight mb-2">{title}</h3>
              <p className="text-sm text-black/45 font-medium leading-relaxed">{body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="bg-brand-ink text-white py-24 px-6 sm:px-10">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-3">
              From Words to On-Chain Action
            </h2>
            <p className="text-white/40 font-medium">
              Three steps. No code. No custody.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {STEPS.map(({ number, title, body }, i) => (
              <motion.div
                key={number}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="relative"
              >
                {/* Connector line between steps */}
                {i < STEPS.length - 1 && (
                  <div className="hidden sm:block absolute top-6 left-[calc(100%+8px)] w-[calc(100%-16px)] h-px bg-white/10" />
                )}
                <div className="text-[11px] font-black tracking-[0.3em] text-white/25 mb-4">{number}</div>
                <h3 className="text-xl font-black tracking-tight mb-3">{title}</h3>
                <p className="text-sm text-white/45 font-medium leading-relaxed">{body}</p>
              </motion.div>
            ))}
          </div>

          {/* Rule example card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-16 bg-white/[0.04] border border-white/10 rounded-3xl p-8"
          >
            <div className="text-[10px] font-bold tracking-[0.3em] text-white/25 mb-3 uppercase">Example Rule</div>
            <p className="text-white font-medium text-lg leading-relaxed mb-5">
              "If my SOL balance drops below 2 SOL, swap 50 USDC to SOL"
            </p>
            <div className="flex flex-wrap gap-3">
              {[
                { label: 'Trigger', value: 'balance_below: SOL @ 2.0' },
                { label: 'Action', value: 'swap 50 USDC → SOL' },
                { label: 'Safety', value: '≤1% oracle deviation' },
              ].map(({ label, value }) => (
                <div key={label} className="px-4 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-sm">
                  <span className="text-white/35 font-semibold">{label}: </span>
                  <span className="text-white font-bold font-mono text-xs">{value}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Performance / stats ─────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 py-24">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {[
            {
              icon: BarChart3,
              title: 'Dual Oracle Price Check',
              body: 'Jupiter v6 quote cross-checked against Pyth Benchmarks. Protects every swap from manipulation.',
            },
            {
              icon: ShieldCheck,
              title: 'Circuit Breaker',
              body: 'Three consecutive failures auto-pause the rule. You\'re always in control of resuming.',
            },
            {
              icon: Fingerprint,
              title: 'SIWS Authentication',
              body: 'Sign In With Solana — cryptographic proof of wallet ownership, no passwords, no email.',
            },
          ].map(({ icon: Icon, title, body }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="flex flex-col gap-4 p-7 bg-white rounded-[28px] border border-black/5"
            >
              <Icon size={20} className="text-brand-accent" />
              <div>
                <div className="font-black text-base tracking-tight mb-1.5">{title}</div>
                <p className="text-sm text-black/40 font-medium leading-relaxed">{body}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Connect CTA ─────────────────────────────────────────────────────── */}
      <section ref={connectSectionRef} className="max-w-5xl mx-auto px-6 sm:px-10 pb-32">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-3">
              Ready to Automate?
            </h2>
            <p className="text-black/40 font-medium text-sm">
              Connect your browser extension wallet to get started. Works with Phantom,
              Backpack, and Solflare.
            </p>
          </div>

          <AnimatePresence mode="wait">
            {!showConnectCard ? (
              <motion.div
                key="cta"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="text-center"
              >
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={openConnectCard}
                  className="h-16 px-14 rounded-2xl bg-brand-ink text-white font-black text-sm tracking-widest uppercase shadow-2xl shadow-black/20 hover:shadow-black/30 transition-shadow flex items-center justify-center gap-3 mx-auto"
                >
                  <Puzzle size={20} />
                  Connect Wallet
                  <ArrowRight size={16} />
                </motion.button>
              </motion.div>
            ) : (
              <motion.div
                key="card"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="bg-white rounded-[40px] border border-black/5 shadow-[0_24px_64px_rgba(0,0,0,0.07)] p-10 space-y-7"
              >
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-black tracking-tight">Connect Your Wallet</h3>
                    <p className="text-sm text-black/40 font-medium mt-1">
                      One signature to prove ownership — no transaction.
                    </p>
                  </div>
                  <button
                    onClick={() => { setShowConnectCard(false); handleDisconnect(); }}
                    className="p-2 rounded-xl hover:bg-black/5 transition-colors text-black/25 hover:text-black/50"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Trust signals */}
                <div className="space-y-2.5">
                  {[
                    { icon: ShieldCheck, text: 'Non-custodial — your keys never leave your device' },
                    { icon: Fingerprint, text: 'SIWS signature — proves wallet ownership only' },
                  ].map(({ icon: Icon, text }) => (
                    <div
                      key={text}
                      className="flex items-center gap-3 p-3.5 rounded-2xl bg-brand-safe/5 border border-brand-safe/10"
                    >
                      <Icon size={15} className="text-brand-safe shrink-0" />
                      <span className="text-xs font-semibold text-black/55">{text}</span>
                    </div>
                  ))}
                </div>

                {/* Error */}
                <AnimatePresence>
                  {anyError && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-start gap-3 p-4 rounded-2xl bg-red-50 border border-red-100"
                    >
                      <AlertTriangle size={15} className="text-brand-stop mt-0.5 shrink-0" />
                      <p className="text-xs font-bold text-brand-stop flex-1">{anyError}</p>
                      <button
                        onClick={() => { clearError(); setConnectError(null); handleDisconnect(); }}
                        className="text-black/20 hover:text-black transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Connect button */}
                <motion.button
                  whileHover={{ scale: isLoading ? 1 : 1.02 }}
                  whileTap={{ scale: isLoading ? 1 : 0.98 }}
                  onClick={handleConnect}
                  disabled={isLoading}
                  className="w-full h-16 rounded-[24px] bg-brand-ink text-white font-black text-sm tracking-widest uppercase flex items-center justify-center gap-3 shadow-2xl shadow-black/20 hover:shadow-black/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      {isSigning ? 'Signing In…' : 'Connecting…'}
                    </>
                  ) : (
                    <>
                      <Puzzle size={20} />
                      Browser Extension
                      <ArrowRight size={16} />
                    </>
                  )}
                </motion.button>

                <p className="text-center text-[10px] text-black/25 font-medium">
                  Compatible with Phantom, Backpack, Solflare & all wallet-standard wallets
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-black/5 px-6 sm:px-10 py-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-[9px] bg-brand-ink flex items-center justify-center text-white font-black text-sm">
              S
            </div>
            <span className="text-sm font-black tracking-tighter">Archon</span>
          </div>
          <p className="text-[11px] text-black/30 font-medium">
            Verifiable AI wallet automation on Solana
          </p>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-brand-safe" />
            <span className="text-[11px] text-black/30 font-medium capitalize">{NETWORK_LABEL}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
