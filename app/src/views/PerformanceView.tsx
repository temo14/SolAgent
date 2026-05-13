import { useState, useEffect } from 'react';
import { NETWORK_LABEL } from '../lib/network';

const CLUSTER =
  NETWORK_LABEL === 'mainnet' ? '' :
  NETWORK_LABEL === 'localnet' ? '?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899' :
  '?cluster=devnet';
import { motion } from 'motion/react';
import {
  TrendingUp,
  CheckCircle2,
  XCircle,
  Activity,
  ExternalLink,
  Zap,
  ShieldCheck,
} from 'lucide-react';
import { Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { lamportsToSol, type MandateState } from '../lib/mandateUtils';

interface RuleStat {
  ruleId: string;
  rawInput: string;
  status: string;
  firesToday: number;
  maxFiresDay: number;
  totalFires: number;
  confirmedFires: number;
  failedFires: number;
  lastFired: string | null;
}

interface RecentExec {
  id: string;
  ruleId: string;
  ruleLabel: string;
  txSignature: string | null;
  pythPrice: number | null;
  confirmedAt: string | null;
}

interface StatsData {
  totalConfirmed: number;
  totalFailed: number;
  confirmedThisMonth: number;
  failedThisMonth: number;
  successRate: number | null;
  byRule: RuleStat[];
  recentExecs: RecentExec[];
}

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="phantom-card flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-black/30">{label}</span>
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${color}`}>{icon}</div>
      </div>
      <div>
        <p className="text-4xl font-black tracking-tight leading-none">{value}</p>
        {sub && <p className="text-xs text-black/40 font-medium mt-1">{sub}</p>}
      </div>
    </div>
  );
}

interface PerformanceViewProps {
  jwt: string;
  agentWalletId: string;
  onNavigateToMandate: () => void;
}

export function PerformanceView({ jwt, agentWalletId, onNavigateToMandate }: PerformanceViewProps) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mandate, setMandate] = useState<MandateState | null>(null);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      api.get<{ ok: boolean; data: StatsData }>('/api/stats', jwt),
      api.get<{ ok: boolean; data: MandateState | null }>(`/api/agent-wallets/${agentWalletId}/mandate-state`, jwt),
    ])
      .then(([statsRes, mandateRes]) => {
        if (statsRes.ok) setStats(statsRes.data);
        if (mandateRes.ok) setMandate(mandateRes.data);
      })
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, [jwt, agentWalletId]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div>
        <h2 className="text-3xl font-black tracking-tight mb-1">Performance</h2>
        <p className="text-sm text-black/40 font-medium">Execution stats across all your rules</p>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {isLoading ? (
          [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-[24px]" />)
        ) : (
          <>
            <StatCard
              label="Confirmed (all time)"
              value={stats?.totalConfirmed ?? 0}
              sub={`${stats?.confirmedThisMonth ?? 0} this month`}
              icon={<CheckCircle2 size={18} className="text-white" />}
              color="bg-brand-safe"
            />
            <StatCard
              label="Failed (all time)"
              value={stats?.totalFailed ?? 0}
              sub={`${stats?.failedThisMonth ?? 0} this month`}
              icon={<XCircle size={18} className="text-white" />}
              color="bg-brand-stop"
            />
            <StatCard
              label="Success Rate"
              value={stats?.successRate !== null && stats?.successRate !== undefined ? `${stats.successRate}%` : '—'}
              sub="Confirmed / total attempts"
              icon={<TrendingUp size={18} className="text-white" />}
              color="bg-brand-wait"
            />
            <StatCard
              label="Active Rules"
              value={stats?.byRule.filter((r) => r.status === 'ACTIVE').length ?? 0}
              sub={`${stats?.byRule.length ?? 0} total`}
              icon={<Zap size={18} className="text-white" />}
              color="bg-brand-ink"
            />
          </>
        )}
      </div>

      {/* ── Mandate usage ───────────────────────────────────────────────── */}
      {!isLoading && mandate && mandate.isActive && (() => {
        const spent   = lamportsToSol(mandate.spentTodayLamports);
        const maxDay  = lamportsToSol(mandate.maxPerDayLamports);
        const maxTx   = lamportsToSol(mandate.maxPerTxLamports);
        const pct     = maxDay > 0 ? Math.min((spent / maxDay) * 100, 100) : 0;
        return (
          <div className="phantom-card">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <ShieldCheck size={18} className="text-brand-safe" />
                <h3 className="text-base font-black tracking-tight">Mandate Usage Today</h3>
              </div>
              <button
                onClick={onNavigateToMandate}
                className="text-[10px] font-black uppercase tracking-wider text-black/30 hover:text-brand-ink transition-colors"
              >
                Manage →
              </button>
            </div>
            <div className="flex items-center justify-between text-xs font-bold mb-2">
              <span className={pct > 80 ? 'text-brand-stop' : 'text-black/60'}>
                {spent.toFixed(4)} SOL spent
              </span>
              <span className="text-black/30">{maxDay.toFixed(4)} SOL daily limit</span>
            </div>
            <div className="w-full h-3 bg-black/[0.05] rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all ${pct > 80 ? 'bg-brand-stop' : pct > 50 ? 'bg-brand-wait' : 'bg-brand-safe'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center gap-6 text-[10px] text-black/40 font-bold">
              <span>{pct.toFixed(1)}% of daily limit</span>
              <span>·</span>
              <span>Max per tx: {maxTx.toFixed(4)} SOL</span>
              <span>·</span>
              <span>{Number(mandate.totalExecutions).toLocaleString()} total executions</span>
            </div>
          </div>
        );
      })()}

      {/* ── By rule ─────────────────────────────────────────────────────── */}
      <div className="phantom-card !p-0 overflow-hidden">
        <div className="px-8 py-6 border-b border-black/5 flex items-center gap-3">
          <Activity size={18} className="text-brand-accent" />
          <h3 className="text-lg font-black tracking-tight">By Rule</h3>
        </div>
        {isLoading ? (
          <div className="p-8 space-y-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}
          </div>
        ) : !stats?.byRule.length ? (
          <div className="p-16 text-center text-black/20 font-bold uppercase text-xs tracking-widest">
            No rules yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-black/[0.02] text-[10px] uppercase font-bold tracking-widest text-black/20">
                <tr>
                  <th className="px-8 py-4">Rule</th>
                  <th className="px-8 py-4 text-right">Today</th>
                  <th className="px-8 py-4 text-right">Total</th>
                  <th className="px-8 py-4 text-right">Success</th>
                  <th className="px-8 py-4 text-right">Last fired</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {stats.byRule.map((rule) => {
                  const rate = rule.confirmedFires + rule.failedFires > 0
                    ? Math.round((rule.confirmedFires / (rule.confirmedFires + rule.failedFires)) * 100)
                    : null;
                  return (
                    <tr key={rule.ruleId} className="hover:bg-black/[0.01] transition-colors">
                      <td className="px-8 py-5">
                        <p className="text-sm font-bold text-black/80 truncate max-w-xs">
                          {rule.rawInput.slice(0, 70)}{rule.rawInput.length > 70 ? '…' : ''}
                        </p>
                        <span className={`inline-block mt-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          rule.status === 'ACTIVE' ? 'bg-brand-safe/10 text-brand-safe' :
                          rule.status === 'PAUSED' ? 'bg-brand-wait/10 text-brand-wait' :
                          'bg-black/5 text-black/30'
                        }`}>{rule.status.toLowerCase()}</span>
                      </td>
                      <td className="px-8 py-5 text-right font-bold text-sm">
                        {rule.firesToday} <span className="text-black/20 font-normal">/ {rule.maxFiresDay}</span>
                      </td>
                      <td className="px-8 py-5 text-right font-bold text-sm">{rule.totalFires}</td>
                      <td className="px-8 py-5 text-right">
                        {rate !== null ? (
                          <span className={`text-sm font-bold ${rate >= 80 ? 'text-brand-safe' : rate >= 50 ? 'text-brand-wait' : 'text-brand-stop'}`}>
                            {rate}%
                          </span>
                        ) : (
                          <span className="text-black/20 text-sm">—</span>
                        )}
                      </td>
                      <td className="px-8 py-5 text-right text-xs text-black/40 font-medium">
                        {rule.lastFired
                          ? new Date(rule.lastFired).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Recent confirmed executions ─────────────────────────────────── */}
      {stats?.recentExecs && stats.recentExecs.length > 0 && (
        <div className="phantom-card !p-0 overflow-hidden">
          <div className="px-8 py-6 border-b border-black/5">
            <h3 className="text-lg font-black tracking-tight">Recent Confirmed Executions</h3>
          </div>
          <div className="divide-y divide-black/[0.04]">
            {stats.recentExecs.map((ex) => (
              <div key={ex.id} className="px-8 py-5 flex items-center justify-between hover:bg-black/[0.01] transition-colors">
                <div>
                  <p className="text-sm font-bold text-black/80">{ex.ruleLabel.length > 60 ? `${ex.ruleLabel.slice(0, 60)}…` : ex.ruleLabel}</p>
                  <p className="text-xs text-black/30 font-medium mt-0.5">
                    {ex.confirmedAt
                      ? new Date(ex.confirmedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : ''}
                    {ex.pythPrice ? ` · $${ex.pythPrice.toFixed(4)} oracle` : ''}
                  </p>
                </div>
                {ex.txSignature && (
                  <a
                    href={`https://explorer.solana.com/tx/${ex.txSignature}${CLUSTER}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] font-bold text-black/30 hover:text-brand-ink transition-colors shrink-0 ml-4"
                  >
                    {ex.txSignature.slice(0, 8)}… <ExternalLink size={10} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
