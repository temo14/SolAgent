import { useState, useCallback } from 'react';
import {
  XCircle,
  Zap,
  LogOut,
  Copy,
  Check,
  Menu,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { AppView } from './types';
import { AgentStatus } from './types';
import { ErrorBanner } from './components/ui';
import { DashboardView } from './views/DashboardView';
import { RulesListView } from './views/RulesListView';
import { AuditLogView } from './views/AuditLogView';
import { PerformanceView } from './views/PerformanceView';
import { MarketplaceView } from './views/MarketplaceView';
import { MandateView } from './views/MandateView';
import { RuleWizard } from './components/rules/RuleWizard';
import { ConnectWallet } from './components/auth/ConnectWallet';
import { useAuth } from './context/AuthContext';
import { useRules } from './hooks/useRules';
import { useAudit } from './hooks/useAudit';
import { useSSE, type ExecResult } from './hooks/useSSE';
import { useAgentBalance } from './hooks/useAgentBalance';
import { useNotificationSettings } from './hooks/useNotificationSettings';

// ─── Authenticated shell ───────────────────────────────────────────────────────

function AuthenticatedApp() {
  const { walletPubkey, jwt, primaryAgentWallet, disconnect, refreshAgentWallets } = useAuth();
  const {
    rules,
    isLoading: rulesLoading,
    fetchRules,
    deleteRule,
    pauseAllRules,
    resumeAllRules,
    parseRule,
    createRule,
    activateRule,
  } = useRules();
  // Audit events are indexed by the *user* signing wallet, not the agent keypair.
  const { auditLog, isLoading: auditLoading, prependLiveEntry } = useAudit(walletPubkey);
  const { sol: solBalance, isLoading: balanceLoading, refetch: refetchBalance } = useAgentBalance(
    primaryAgentWallet?.delegatePubkey ?? null,
  );

  const { settings: notifSettings, refetch: refetchNotifSettings } = useNotificationSettings(jwt);

  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>(AgentStatus.ACTIVE);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [footerAgentCopied, setFooterAgentCopied] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
    void fetchRules();
    void refetchBalance();
  }, [prependLiveEntry, fetchRules, refetchBalance]));

  const handleRefresh = () => {
    setIsRefreshing(true);
    setError(null);
    Promise.all([fetchRules(), refetchBalance()]).finally(() => setIsRefreshing(false));
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

  const agentPubkeyFull = primaryAgentWallet?.delegatePubkey ?? null;

  const copyFooterAgentAddress = async () => {
    if (!agentPubkeyFull) return;
    try {
      await navigator.clipboard.writeText(agentPubkeyFull);
      setFooterAgentCopied(true);
      window.setTimeout(() => setFooterAgentCopied(false), 2000);
    } catch {
      // insecure context / permission denied
    }
  };

  const activeRuleCount = rules.filter((r) => r.status === 'active').length;

  return (
    <div className="min-h-screen bg-brand-bg pb-32">
      {/* Navigation */}
      <nav className="glass sticky top-0 z-50 px-8 h-24 flex items-center justify-between border-b border-black/5">
        <div
          className="flex items-center gap-4 cursor-pointer group"
          onClick={() => setActiveView('dashboard')}
        >
          <div className="w-12 h-12 rounded-[18px] bg-brand-ink flex items-center justify-center text-white font-bold text-2xl transition-transform group-hover:rotate-6 shadow-xl shadow-black/10">
            S
          </div>
          <div className="flex flex-col -space-y-1">
            <span className="text-2xl font-black tracking-tighter">Archon</span>
            <span className="text-[10px] font-bold tracking-[0.4em] text-brand-safe leading-none">
              VERIFIABLE AI WALLET
            </span>
          </div>
        </div>

        <div className="flex items-center gap-12">
          <div className="hidden lg:flex items-center gap-10">
            {([
              ['dashboard', 'Overview'],
              ['rules-list', 'My Rules'],
              ['performance', 'Performance'],
              ['marketplace', 'Marketplace'],
              ['audit-log', 'History'],
            ] as [AppView, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                className={`text-[11px] font-extrabold uppercase tracking-[0.2em] transition-all relative ${activeView === v ? 'text-brand-ink' : 'text-black/30 hover:text-black'}`}
              >
                {label}
                {activeView === v && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute -bottom-4 left-0 right-0 h-1 bg-brand-wait rounded-full"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileNavOpen((o) => !o)}
            className="lg:hidden p-3 hover:bg-black/5 rounded-2xl transition-colors"
          >
            <Menu size={20} className="text-black/40" />
          </button>

          <div className="flex items-center gap-6">
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

      {/* Mobile nav drawer */}
      <AnimatePresence>
        {mobileNavOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="lg:hidden bg-white border-b border-black/5 px-8 py-4 flex flex-col gap-1 z-40"
          >
            {([
              ['dashboard', 'Overview'],
              ['rules-list', 'My Rules'],
              ['performance', 'Performance'],
              ['marketplace', 'Marketplace'],
              ['audit-log', 'History'],
            ] as [AppView, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => { setActiveView(v); setMobileNavOpen(false); }}
                className={`w-full text-left px-4 py-3 rounded-2xl text-sm font-bold transition-colors ${activeView === v ? 'bg-brand-ink text-white' : 'text-black/50 hover:bg-black/5'}`}
              >
                {label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

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
              solBalance={solBalance}
              isBalanceLoading={balanceLoading}
              activeRuleCount={activeRuleCount}
              onRefresh={handleRefresh}
              onNavigateToRules={() => setActiveView('rules-list')}
              onNavigateToAudit={() => setActiveView('audit-log')}
              agentWalletId={primaryAgentWallet?.id ?? ''}
              agentPubkey={primaryAgentWallet?.ownerPubkey ?? ''}
              mandatePda={primaryAgentWallet?.mandatePda ?? null}
              onMandateCreated={(_pda: string) => void refreshAgentWallets()}
              onNavigateToMandate={() => setActiveView('mandate')}
              jwt={jwt ?? ''}
              telegramChatId={notifSettings?.telegramChatId ?? null}
              notifyOnExec={notifSettings?.notifyOnExec ?? false}
              notifyOnFail={notifSettings?.notifyOnFail ?? true}
              onTelegramLinked={() => void refetchNotifSettings()}
            />
          )}
          {activeView === 'rules-list' && (
            <RulesListView
              key="r"
              rules={rules}
              isLoading={rulesLoading}
              onAddRule={() => setActiveView('create-rule')}
              onDeleteRule={async (id) => {
                try {
                  await deleteRule(id);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to delete rule');
                }
              }}
            />
          )}
          {activeView === 'audit-log' && (
            <AuditLogView key="a" auditLog={auditLog} isLoading={auditLoading} />
          )}
          {activeView === 'performance' && (
            <PerformanceView
              key="p"
              jwt={jwt ?? ''}
              agentWalletId={primaryAgentWallet?.id ?? ''}
              onNavigateToMandate={() => setActiveView('mandate')}
            />
          )}
          {activeView === 'marketplace' && (
            <MarketplaceView
              key="m"
              jwt={jwt}
              onUseTemplate={(description) => {
                setActiveView('create-rule');
                // Store template description for the wizard to pick up via URL param / state
                window.sessionStorage.setItem('archon:template', description);
              }}
            />
          )}
          {activeView === 'mandate' && (
            <MandateView
              key="mv"
              jwt={jwt ?? ''}
              agentWalletId={primaryAgentWallet?.id ?? ''}
              onBack={() => setActiveView('dashboard')}
            />
          )}
          {activeView === 'create-rule' && (
            <RuleWizard
              key="c"
              onCancel={() => setActiveView('dashboard')}
              onComplete={() => {
                void fetchRules();
                setActiveView('rules-list');
              }}
              parseRule={parseRule}
              createRule={createRule}
              activateRule={activateRule}
              agentWalletId={primaryAgentWallet?.id ?? ''}
            />
          )}
        </AnimatePresence>
      </main>

      {/* Status footer — light bar for contrast on brand-bg */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 px-5 sm:px-7 py-4 rounded-3xl bg-white text-brand-ink shadow-[0_12px_48px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.06] w-[min(640px,calc(100vw-2rem))] max-w-[95vw]">
        <div className="flex items-center gap-3 shrink-0">
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${agentStatus === AgentStatus.ACTIVE ? 'bg-brand-safe animate-pulse' : 'bg-brand-stop'}`}
          />
          <span className="text-[11px] font-extrabold text-black/50 uppercase tracking-widest whitespace-nowrap">
            {activeRuleCount} active rule{activeRuleCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="hidden sm:block h-8 w-px bg-black/[0.08] shrink-0" />
        <div className="flex-1 min-w-0 pt-1 border-t border-black/[0.06] sm:border-t-0 sm:pt-0">
          <span className="text-[9px] font-extrabold uppercase tracking-widest text-black/35 block mb-1.5">
            Agent wallet (fund devnet SOL)
          </span>
          {agentPubkeyFull ? (
            <div className="flex items-start gap-2">
              <code className="text-[11px] font-mono text-black/85 break-all leading-snug flex-1 select-all">
                {agentPubkeyFull}
              </code>
              <button
                type="button"
                onClick={() => void copyFooterAgentAddress()}
                className="shrink-0 p-2 rounded-xl bg-brand-ink text-white hover:bg-black transition-colors"
                title="Copy address"
              >
                {footerAgentCopied ? <Check size={14} className="text-brand-safe" /> : <Copy size={14} />}
              </button>
            </div>
          ) : (
            <span className="text-[10px] text-black/35 font-mono">Provisioning…</span>
          )}
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
