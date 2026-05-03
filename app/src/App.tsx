import { useState, useCallback } from 'react';
import {
  Bell,
  Search,
  ShieldAlert,
  XCircle,
  Zap,
  LogOut,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { AppView } from './types';
import { AgentStatus } from './types';
import { ErrorBanner } from './components/ui';
import { DashboardView } from './views/DashboardView';
import { RulesListView } from './views/RulesListView';
import { AuditLogView } from './views/AuditLogView';
import { RuleWizard } from './components/rules/RuleWizard';
import { ConnectWallet } from './components/auth/ConnectWallet';
import { useAuth } from './context/AuthContext';
import { useRules } from './hooks/useRules';
import { useAudit } from './hooks/useAudit';
import { useSSE, type ExecResult } from './hooks/useSSE';

// ─── Authenticated shell ───────────────────────────────────────────────────────

function AuthenticatedApp() {
  const { walletPubkey, jwt, primaryAgentWallet, disconnect } = useAuth();
  const {
    rules,
    isLoading: rulesLoading,
    fetchRules,
    deleteRule,
    pauseAllRules,
    resumeAllRules,
    createRule,
    activateRule,
  } = useRules();
  const { auditLog, isLoading: auditLoading, prependLiveEntry } = useAudit(
    primaryAgentWallet?.pubkey ?? null,
  );

  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>(AgentStatus.ACTIVE);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── SSE: live execution results ──────────────────────────────────────────
  useSSE(jwt, useCallback((result: ExecResult) => {
    if (result.status === 'CONFIRMED' && result.memoProof) {
      prependLiveEntry({
        id: result.idempotencyKey,
        txSignature: result.txSignature,
        ruleId: result.ruleId,
        eventType: 'EXECUTION_CONFIRMED',
        payload: result.memoProof as Record<string, unknown>,
        isAnomalous: false,
        createdAt: result.timestamp,
      });
    }
    // Refresh rules so firesToday stays accurate
    void fetchRules();
  }, [prependLiveEntry, fetchRules]));

  const handleRefresh = () => {
    setIsRefreshing(true);
    setError(null);
    Promise.all([fetchRules()]).finally(() => setIsRefreshing(false));
  };

  const handleEmergencyToggle = async () => {
    if (agentStatus === AgentStatus.ACTIVE) {
      await pauseAllRules();
      setAgentStatus(AgentStatus.PAUSED);
    } else {
      await resumeAllRules();
      setAgentStatus(AgentStatus.ACTIVE);
    }
  };

  const shortPubkey = walletPubkey
    ? `${walletPubkey.slice(0, 4)}…${walletPubkey.slice(-4)}`
    : '–';

  const agentPubkey = primaryAgentWallet?.pubkey
    ? `${primaryAgentWallet.pubkey.slice(0, 4)}…${primaryAgentWallet.pubkey.slice(-4)}`
    : 'No agent wallet';

  return (
    <div className="min-h-screen bg-brand-bg pb-32">
      {/* Navigation */}
      <nav className="glass sticky top-0 z-50 px-8 h-24 flex items-center justify-between border-b border-black/5">
        <div
          className="flex items-center gap-4 cursor-pointer group"
          onClick={() => setActiveView('dashboard')}
        >
          <div className="w-12 h-12 rounded-[18px] bg-brand-ink flex items-center justify-center text-white font-bold text-2xl transition-transform group-hover:rotate-6 shadow-xl shadow-black/10">
            A
          </div>
          <div className="flex flex-col -space-y-1">
            <span className="text-2xl font-black tracking-tighter">AURA</span>
            <span className="text-[10px] font-bold tracking-[0.4em] text-brand-safe leading-none">
              SECURE AGENT
            </span>
          </div>
        </div>

        <div className="flex items-center gap-12">
          <div className="hidden lg:flex items-center gap-12">
            {(['dashboard', 'rules-list', 'audit-log'] as AppView[]).map((v) => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                className={`text-[11px] font-extrabold uppercase tracking-[0.2em] transition-all relative ${activeView === v ? 'text-brand-ink' : 'text-black/30 hover:text-black'}`}
              >
                {v === 'rules-list' ? 'My Rules' : v === 'audit-log' ? 'Activity History' : 'Overview'}
                {activeView === v && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute -bottom-4 left-0 right-0 h-1 bg-brand-wait rounded-full"
                  />
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-6">
            <div className="relative group hidden sm:block">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-black/20 group-focus-within:text-brand-ink transition-colors"
                size={16}
              />
              <input
                placeholder="Search tx, rules…"
                className="pl-11 pr-6 py-2.5 rounded-full bg-black/5 border border-transparent focus:bg-white focus:border-black/5 focus:ring-8 focus:ring-black/5 focus:outline-none transition-all text-xs font-semibold placeholder:text-black/20 w-48 focus:w-64"
              />
            </div>

            <button className="w-10 h-10 rounded-full border border-black/5 flex items-center justify-center text-black/20 hover:text-black transition-colors relative">
              <Bell size={18} />
              <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-brand-stop border-2 border-[#F8F9FA]" />
            </button>

            {/* Wallet address chip */}
            <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full bg-black/5 border border-black/5">
              <div className="w-2 h-2 rounded-full bg-brand-safe" />
              <span className="text-[10px] font-mono font-bold text-black/50">{shortPubkey}</span>
              <button
                onClick={disconnect}
                className="text-black/20 hover:text-brand-stop transition-colors ml-1"
                title="Disconnect"
              >
                <LogOut size={12} />
              </button>
            </div>

            <button
              onClick={() => void handleEmergencyToggle()}
              className={`
                h-12 flex items-center gap-3 px-6 rounded-2xl font-bold transition-all shadow-xl group/pause
                ${agentStatus === AgentStatus.ACTIVE
                  ? 'bg-brand-stop text-white shadow-red-200/40 hover:scale-105 active:scale-95'
                  : 'bg-brand-safe text-white shadow-emerald-200/40'}
              `}
            >
              {agentStatus === AgentStatus.ACTIVE ? (
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <XCircle
                    size={18}
                    className="group-hover/pause:rotate-90 transition-transform"
                  />
                </motion.div>
              ) : (
                <Zap size={18} className="animate-pulse" />
              )}
              <span className="text-[10px] uppercase tracking-[0.15em] font-black">
                {agentStatus === AgentStatus.ACTIVE ? 'Emergency STOP' : 'Resume Safety'}
              </span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-8 py-8">
        {error && <ErrorBanner message={error} onRetry={handleRefresh} />}

        <AnimatePresence mode="wait">
          {activeView === 'dashboard' && (
            <DashboardView
              key="d"
              isLoading={rulesLoading}
              isRefreshing={isRefreshing}
              agentStatus={agentStatus}
              auditLog={auditLog}
              onRefresh={handleRefresh}
              onNavigateToRules={() => setActiveView('rules-list')}
              onNavigateToAudit={() => setActiveView('audit-log')}
            />
          )}
          {activeView === 'rules-list' && (
            <RulesListView
              key="r"
              rules={rules}
              isLoading={rulesLoading}
              onAddRule={() => setActiveView('create-rule')}
              onDeleteRule={(id) => void deleteRule(id)}
            />
          )}
          {activeView === 'audit-log' && (
            <AuditLogView key="a" auditLog={auditLog} isLoading={auditLoading} />
          )}
          {activeView === 'create-rule' && (
            <RuleWizard
              key="c"
              onCancel={() => setActiveView('dashboard')}
              onComplete={() => {
                void fetchRules();
                setActiveView('rules-list');
              }}
              createRule={createRule}
              activateRule={activateRule}
              agentWalletId={primaryAgentWallet?.id ?? ''}
            />
          )}
        </AnimatePresence>
      </main>

      {/* Status Footer */}
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-4 px-8 py-4 rounded-full bg-brand-ink text-white shadow-[0_20px_50px_rgba(0,0,0,0.3)] z-[100] border border-white/10 glass max-w-[90vw]">
        <div
          className={`w-2.5 h-2.5 rounded-full ${agentStatus === AgentStatus.ACTIVE ? 'bg-brand-safe animate-pulse' : 'bg-brand-stop'}`}
        />
        <div className="flex flex-col">
          <span className="text-[10px] font-extrabold uppercase tracking-widest leading-none">
            Agent Wallet
          </span>
          <span className="text-[9px] font-mono text-white/40 tracking-tighter">
            {agentPubkey} • Secure Link
          </span>
        </div>
        <div className="h-6 w-px bg-white/20 mx-2" />
        <div className="flex items-center gap-3">
          <ShieldAlert size={16} className="text-brand-wait" />
          <span className="text-[10px] font-bold text-white/60 uppercase">
            {rules.filter((r) => r.status === 'active').length} Active Rules
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Root (auth gate) ─────────────────────────────────────────────────────────

export default function App() {
  const { jwt } = useAuth();
  return jwt ? <AuthenticatedApp /> : <ConnectWallet />;
}
