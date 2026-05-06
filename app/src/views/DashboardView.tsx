import { motion } from 'motion/react';
import {
  Wallet,
  RefreshCw,
  Cpu,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
} from 'lucide-react';
import { AgentStatus, AuditLogEntry } from '../types';
import { Skeleton } from '../components/ui';
import { MandatePanel } from '../components/mandate/MandatePanel';
import { TelegramPanel } from '../components/notifications/TelegramPanel';

interface DashboardViewProps {
  key?: string;
  isLoading: boolean;
  isRefreshing: boolean;
  agentStatus: AgentStatus;
  auditLog: AuditLogEntry[];
  solBalance: number | null;
  isBalanceLoading: boolean;
  activeRuleCount: number;
  onRefresh: () => void;
  onNavigateToRules: () => void;
  onNavigateToAudit: () => void;
  // Mandate
  agentWalletId: string;
  agentPubkey: string;
  mandatePda: string | null;
  onMandateCreated: (pda: string) => void;
  onNavigateToMandate: () => void;
  jwt: string;
  // Telegram
  telegramChatId: string | null;
  notifyOnExec: boolean;
  notifyOnFail: boolean;
  onTelegramLinked: () => void;
}

export function DashboardView({
  isLoading,
  isRefreshing,
  agentStatus,
  auditLog,
  solBalance,
  isBalanceLoading,
  activeRuleCount,
  onRefresh,
  onNavigateToRules,
  onNavigateToAudit,
  agentWalletId,
  agentPubkey,
  mandatePda,
  onMandateCreated,
  onNavigateToMandate,
  jwt,
  telegramChatId,
  notifyOnExec,
  notifyOnFail,
  onTelegramLinked,
}: DashboardViewProps) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* ── Balance card ─────────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 phantom-card relative overflow-hidden group">
          <div className="absolute -top-10 -right-10 p-8 text-black/[0.02] group-hover:text-black/[0.04] transition-all">
            <Wallet size={320} />
          </div>

          <div className="relative z-10 h-full flex flex-col">
            <div className="flex items-center justify-between mb-12">
              <span className="text-xs font-bold text-black/30 uppercase tracking-[0.2em]">Agent Wallet Balance</span>
              <motion.button
                animate={{ rotate: isRefreshing ? 360 : 0 }}
                onClick={onRefresh}
                className="p-3 hover:bg-black/5 rounded-full transition-colors group/refresh"
                disabled={isRefreshing}
              >
                <RefreshCw size={18} className={`text-black/20 group-hover/refresh:text-black transition-colors ${isRefreshing ? 'opacity-50' : ''}`} />
              </motion.button>
            </div>

            {isLoading || isBalanceLoading ? (
              <div className="space-y-12">
                <Skeleton className="h-20 w-2/3" />
                <Skeleton className="h-10 w-1/3" />
              </div>
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex items-baseline gap-4 mb-4">
                  {solBalance !== null ? (
                    <>
                      <h1 className="text-7xl font-black tracking-tighter leading-none">
                        {solBalance.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                      </h1>
                      <span className="text-3xl font-bold text-black/30">SOL</span>
                    </>
                  ) : (
                    <h1 className="text-5xl font-black tracking-tighter leading-none text-black/20">—</h1>
                  )}
                </div>
                <p className="text-xs text-black/30 font-medium mt-auto">
                  {activeRuleCount} active rule{activeRuleCount !== 1 ? 's' : ''} — devnet
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Agent status card ────────────────────────────────────────────────── */}
        <div className={`
          phantom-card transition-all duration-700 relative overflow-hidden group
          ${agentStatus === AgentStatus.ACTIVE ? '' : 'bg-black/[0.02]'}
        `}>
          <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity">
            <Cpu size={280} />
          </div>
          <div className="flex items-center justify-between mb-12 relative z-10">
            <span className="text-xs font-bold text-black/30 uppercase tracking-[0.2em]">Active Guard</span>
            <div className={`w-3 h-3 rounded-full ${agentStatus === AgentStatus.ACTIVE ? 'bg-brand-safe animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-brand-stop'}`} />
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center">
              <Skeleton className="w-32 h-32 rounded-[40px] mb-10" />
              <Skeleton className="h-8 w-48 mb-4" />
              <Skeleton className="h-12 w-full mb-8" />
              <Skeleton className="h-14 w-full rounded-[24px]" />
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <motion.div
                animate={{
                  rotate: agentStatus === AgentStatus.ACTIVE ? [0, 90, 180, 270, 360] : 0,
                  scale: agentStatus === AgentStatus.ACTIVE ? [1, 1.05, 1] : 1
                }}
                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                className={`w-32 h-32 rounded-[40px] flex items-center justify-center mb-10 ${agentStatus === AgentStatus.ACTIVE ? 'bg-brand-ink text-white shadow-2xl' : 'bg-black/10 text-black/20'}`}
              >
                <Cpu size={56} />
              </motion.div>
              <h2 className="text-3xl font-bold mb-4 text-center">Archon</h2>
              <div className="flex items-center justify-center gap-2 mb-6 px-3 py-1 rounded-full bg-black/5 border border-black/5">
                <div className={`w-2 h-2 rounded-full ${agentStatus === AgentStatus.ACTIVE ? 'bg-brand-safe' : 'bg-brand-stop'}`} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">
                  {agentStatus === AgentStatus.ACTIVE
                    ? `Monitoring · ${activeRuleCount} rule${activeRuleCount !== 1 ? 's' : ''}`
                    : 'Paused'}
                </span>
              </div>
              <p className="text-sm text-center text-black/40 leading-relaxed mb-10 font-medium max-w-[240px]">
                {agentStatus === AgentStatus.ACTIVE
                  ? 'Monitoring your rules and executing transactions automatically.'
                  : 'Safety lockdown active. No automated transactions will execute.'}
              </p>

              <button
                onClick={onNavigateToRules}
                className="modern-btn modern-btn-primary w-full h-14 !text-sm"
              >
                Manage Rules
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Security panels ──────────────────────────────────────────────────────── */}
      {!isLoading && agentWalletId && agentPubkey && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <MandatePanel
            agentWalletId={agentWalletId}
            agentPubkey={agentPubkey}
            mandatePda={mandatePda}
            onMandateCreated={onMandateCreated}
            onManage={onNavigateToMandate}
            jwt={jwt}
          />
          <TelegramPanel
            jwt={jwt}
            telegramChatId={telegramChatId}
            notifyOnExec={notifyOnExec}
            notifyOnFail={notifyOnFail}
            onLinked={onTelegramLinked}
          />
        </div>
      )}

      {/* ── Recent activity ──────────────────────────────────────────────────────── */}
      <div className="phantom-card !p-0 overflow-hidden relative">
        <div className="px-10 py-8 border-b border-black/5 flex items-center justify-between">
          <h3 className="text-xl font-black tracking-tight flex items-center gap-3">
            <Activity size={20} className="text-brand-accent" /> Recent Activity
          </h3>
          <button
            onClick={onNavigateToAudit}
            className="text-[10px] font-black text-black/30 uppercase tracking-widest hover:text-brand-ink transition-colors"
          >
            Browse Full History
          </button>
        </div>

        {isLoading ? (
          <div className="p-10 space-y-6">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
          </div>
        ) : auditLog.length === 0 ? (
          <div className="p-20 text-center text-black/20 font-bold uppercase text-xs tracking-widest">
            No recent activity — rules will appear here once triggered
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-black/[0.02] text-[10px] uppercase font-bold tracking-widest text-black/20">
                <tr>
                  <th className="px-10 py-5">Event</th>
                  <th className="px-10 py-5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {auditLog.slice(0, 5).map((item) => (
                  <tr key={item.id} className="hover:bg-black/[0.01] transition-colors cursor-default">
                    <td className="px-10 py-6">
                      <div className="text-sm font-bold text-black/80">{item.action.label}</div>
                      <div className="text-xs text-black/30 font-medium">{item.timestamp}</div>
                    </td>
                    <td className="px-10 py-6 text-right">
                      <span className={`
                      px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1.5
                      ${item.action.status === 'success' ? 'bg-brand-safe/10 text-brand-safe' :
                        item.action.status === 'failed' ? 'bg-brand-stop/10 text-brand-stop' :
                        item.action.status === 'pending' ? 'bg-blue-50/50 text-blue-500 border border-blue-100' :
                        'bg-brand-wait/10 text-brand-wait'}
                    `}>
                        {item.action.status === 'success' && <CheckCircle2 size={10} />}
                        {item.action.status === 'failed' && <XCircle size={10} />}
                        {item.action.status === 'pending' && <Clock size={10} className="animate-pulse" />}
                        {item.action.status === 'retrying' && <RotateCcw size={10} className="animate-spin" />}
                        {item.action.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}
