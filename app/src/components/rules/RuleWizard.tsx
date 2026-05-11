import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  RefreshCw,
  Sparkles,
  Zap,
  ShieldCheck,
  Fingerprint,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Repeat,
  Send,
  ChevronRight,
} from 'lucide-react';
import type { BackendRule } from '../../hooks/useRules';

// ─── Templates ───────────────────────────────────────────────────────────────

const RULE_TEMPLATES = [
  {
    id: 'dca-weekly',
    name: 'Weekly DCA',
    icon: Repeat,
    description: 'Buy SOL every week automatically',
    template: 'Buy $50 of SOL every Monday at 9am',
  },
  {
    id: 'stop-loss',
    name: 'Stop Loss',
    icon: TrendingDown,
    description: 'Sell if price drops too far',
    template: 'If SOL price drops below $100, swap all SOL to USDC',
  },
  {
    id: 'take-profit',
    name: 'Take Profit',
    icon: TrendingUp,
    description: 'Lock gains when price spikes',
    template: 'If SOL price rises above $250, swap 50% of SOL to USDC',
  },
  {
    id: 'balance-guard',
    name: 'Balance Guard',
    icon: ShieldCheck,
    description: 'Auto-buy when balance dips',
    template: 'If SOL balance drops below 1, swap 50 USDC to SOL',
  },
  {
    id: 'recurring-pay',
    name: 'Recurring Payment',
    icon: Send,
    description: 'Send on a fixed schedule',
    template: 'Send 0.1 SOL to [paste wallet address] every day at 12pm',
  },
] as const;

// ─── Human-readable renderers ─────────────────────────────────────────────────

interface BackendTrigger {
  type: string;
  asset: string;
  threshold: number;
  cron_expression?: string;
  until_local_hour?: number;
  until_utc_hour?: number;
}

interface BackendAction {
  type: string;
  from_asset?: string;
  to_asset?: string;
  amount: number;
  recipient?: string;
  max_slippage_bps?: number;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}

function describeCron(expr: string): string {
  if (!expr) return 'On a schedule';
  let p = expr.trim().split(/\s+/);
  if (p.length === 6) p = p.slice(1);
  if (p.length !== 5) return `Cron: ${expr}`;
  const [min, hour, dom, , dow] = p;

  if (expr === '* * * * *') return 'Every minute';

  // Step values  */N * * * *  or  0 */N * * *
  if (min.startsWith('*/') && hour === '*') {
    const n = parseInt(min.slice(2), 10);
    return `Every ${n} minute${n !== 1 ? 's' : ''}`;
  }
  if (min === '0' && hour.startsWith('*/')) {
    const n = parseInt(hour.slice(2), 10);
    return `Every ${n} hour${n !== 1 ? 's' : ''}`;
  }
  if (min === '0' && hour === '*') return 'Every hour';

  // Day-of-week patterns
  if (dow !== '*') {
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const timeStr = min !== '*' && hour !== '*'
      ? ` at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`
      : '';
    if (dow === '1-5') return `Every weekday${timeStr}`;
    if (dow === '0,6' || dow === '6,0') return `Every weekend${timeStr}`;
    const dayNum = parseInt(dow, 10);
    const dayName = DAYS[dayNum] ?? `day ${dow}`;
    return `Every ${dayName}${timeStr}`;
  }

  // Day-of-month
  if (dom !== '*') {
    const d = parseInt(dom, 10);
    const suffix = ordinal(d);
    const timeStr = min !== '*' && hour !== '*'
      ? ` at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`
      : '';
    return `On the ${d}${suffix} of each month${timeStr}`;
  }

  // Comma-separated hours  e.g. "0 0,12 * * *"
  if (min === '0' && hour.includes(',')) {
    const count = hour.split(',').length;
    return `${count} times a day`;
  }

  if (min !== '*' && hour !== '*')
    return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`;

  return `Cron: ${expr}`;
}

function describeLimit(c: { max_amount_usd: number; max_fires_per_day: number }, triggerType: string): string[] {
  const lines: string[] = [];

  if (triggerType === 'time_cron') {
    if (c.max_fires_per_day < 1440) {
      lines.push(
        c.max_fires_per_day <= 120
          ? `Stops after ${c.max_fires_per_day} execution${c.max_fires_per_day !== 1 ? 's' : ''}`
          : `Up to ${c.max_fires_per_day} times per day`,
      );
    }
  } else if (c.max_fires_per_day <= 5) {
    lines.push(`Fires at most ${c.max_fires_per_day} time${c.max_fires_per_day !== 1 ? 's' : ''} per day`);
  }

  return lines;
}

function describeTrigger(t: BackendTrigger): string {
  const asset = t.asset.length > 20 ? `${t.asset.slice(0, 8)}…` : t.asset;
  switch (t.type) {
    case 'price_below':
      return `When ${asset} price falls below $${t.threshold.toLocaleString()}`;
    case 'price_above':
      return `When ${asset} price rises above $${t.threshold.toLocaleString()}`;
    case 'balance_below':
      return `When ${asset} balance drops below ${t.threshold} ${asset}`;
    case 'balance_above':
      return `When ${asset} balance rises above ${t.threshold} ${asset}`;
    case 'time_cron': {
      let base = describeCron(t.cron_expression ?? '');
      if (t.until_local_hour !== undefined)
        base += ` until ${t.until_local_hour}:00 (local time)`;
      else if (t.until_utc_hour !== undefined)
        base += ` until ${t.until_utc_hour}:00 UTC`;
      return base;
    }
    case 'outflow_exceeded':
      return `When total outflow exceeds $${t.threshold.toLocaleString()}`;
    default:
      return `${t.type.replace(/_/g, ' ')}: ${asset} @ ${t.threshold}`;
  }
}

function describeAction(a: BackendAction, triggerAsset: string): string {
  switch (a.type) {
    case 'swap':
      return `Swap ${a.amount} ${a.from_asset ?? triggerAsset} → ${a.to_asset ?? '?'}`;
    case 'transfer': {
      const dest = a.recipient
        ? `${a.recipient.slice(0, 8)}…${a.recipient.slice(-4)}`
        : 'recipient';
      return `Transfer ${a.amount} ${a.from_asset ?? triggerAsset} to ${dest}`;
    }
    case 'alert_only':
      return 'Alert only — no transaction';
    case 'pause_all':
      return 'Pause all active rules';
    default:
      return a.type;
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ParsedPreview {
  trigger: BackendTrigger;
  action: BackendAction;
  conditions: { max_amount_usd: number; max_fires_per_day: number };
}

interface RuleWizardProps {
  key?: string;
  onCancel: () => void;
  onComplete: () => void;
  parseRule: (rawInput: string) => Promise<ParsedPreview | null>;
  createRule: (rawInput: string, agentWalletId: string, opts?: { maxAmountUsd?: number; maxFiresPerDay?: number }, parsedRule?: BackendRule['parsedRule']) => Promise<BackendRule | null>;
  activateRule: (ruleId: string) => Promise<boolean>;
  agentWalletId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const RuleWizard = ({
  onCancel,
  onComplete,
  parseRule,
  createRule,
  activateRule,
  agentWalletId,
}: RuleWizardProps) => {
  const [wizardStep, setWizardStep] = useState(1);
  const [ruleInput, setRuleInput] = useState(() => {
    // Pick up a template pre-filled by the Marketplace view
    const tmpl = window.sessionStorage.getItem('archon:template');
    if (tmpl) { window.sessionStorage.removeItem('archon:template'); return tmpl; }
    return '';
  });
  const [isParsing, setIsParsing] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [maxAmountUsdInput, setMaxAmountUsdInput] = useState<string>('');

  // Step 1: parse via QVAC (no DB write yet — pure preview)
  const handleParse = async () => {
    if (!ruleInput.trim() || !agentWalletId) return;
    setIsParsing(true);
    setParseError(null);
    try {
      const parsed = await parseRule(ruleInput.trim());
      if (!parsed) {
        setParseError(
          'Unexpected response from the rule service. Check that you are still signed in and try again.',
        );
        return;
      }
      setPreview(parsed);
      setMaxAmountUsdInput(String(parsed.conditions.max_amount_usd));
      setWizardStep(2);
    } catch (err) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Could not parse your rule. If the message mentions QVAC, wait for the parser container to finish starting, then retry.',
      );
    } finally {
      setIsParsing(false);
    }
  };

  // Step 3: create rule with confirmed safety settings, then activate immediately
  const handleDeploy = async () => {
    if (!preview || !agentWalletId) return;
    setIsDeploying(true);
    setDeployError(null);
    try {
      const parsedMaxUsd = parseFloat(maxAmountUsdInput);
      const rule = await createRule(
        ruleInput.trim(),
        agentWalletId,
        {
          maxAmountUsd: Number.isFinite(parsedMaxUsd) && parsedMaxUsd > 0
            ? parsedMaxUsd
            : preview.conditions.max_amount_usd,
          maxFiresPerDay: preview.conditions.max_fires_per_day,
        },
        preview,
      );
      if (!rule) {
        setDeployError('Could not create rule. Please try again.');
        return;
      }
      const ok = await activateRule(rule.id);
      if (!ok) {
        setDeployError('Activation failed. Please try again.');
        return;
      }
      onComplete();
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Deployment failed. Please try again.');
    } finally {
      setIsDeploying(false);
    }
  };

  const trigger = preview?.trigger;
  const action = preview?.action;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-4xl mx-auto py-12"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-12">
        <button
          onClick={onCancel}
          className="flex items-center gap-2 text-black/40 hover:text-black transition-colors"
        >
          <ArrowLeft size={18} />
          <span className="text-sm font-extrabold uppercase tracking-widest">Abort Synthesis</span>
        </button>
        <div className="flex gap-3">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1.5 w-12 rounded-full transition-all duration-500 ${wizardStep >= s ? 'bg-brand-ink' : 'bg-black/10'}`}
            />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ── Step 1: Describe ──────────────────────────────────────────────── */}
        {wizardStep === 1 && (
          <motion.div
            key="w1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <div>
              <h1 className="text-5xl font-semibold tracking-tight text-brand-ink">
                Describe Your Rule
              </h1>
              <p className="text-black/40 text-xl font-medium mt-2">
                Tell Aura what to watch for and what action to take.
              </p>
            </div>

            {/* Templates */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-black/30">
                Start from a template
              </p>
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                {RULE_TEMPLATES.map((tpl) => {
                  const Icon = tpl.icon;
                  const isSelected = selectedTemplate === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        setRuleInput(tpl.template);
                        setSelectedTemplate(tpl.id);
                      }}
                      className={`flex-shrink-0 flex flex-col gap-1.5 p-4 rounded-2xl border text-left transition-all w-44 ${
                        isSelected
                          ? 'border-brand-ink bg-brand-ink text-white'
                          : 'border-black/8 bg-white hover:border-black/20 text-brand-ink'
                      }`}
                    >
                      <Icon size={18} className={isSelected ? 'text-white' : 'text-black/40'} />
                      <span className="text-xs font-bold leading-tight">{tpl.name}</span>
                      <span
                        className={`text-[10px] leading-tight ${isSelected ? 'text-white/60' : 'text-black/35'}`}
                      >
                        {tpl.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {!agentWalletId && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-100">
                <AlertTriangle size={16} className="text-brand-wait shrink-0" />
                <p className="text-xs font-semibold text-amber-700">
                  No agent wallet found. Please wait while it is being created, then try again.
                </p>
              </div>
            )}

            <div className="relative group">
              <textarea
                autoFocus
                value={ruleInput}
                onChange={(e) => {
                  setRuleInput(e.target.value);
                  setSelectedTemplate(null);
                }}
                placeholder="e.g. 'If SOL price drops below $100, buy 1 SOL with USDC.'"
                className="w-full h-56 bg-white border border-black/10 rounded-[44px] p-10 text-2xl leading-relaxed focus:ring-8 focus:ring-black/5 focus:outline-none transition-all resize-none shadow-sm group-hover:border-black/20"
              />
              <div className="absolute bottom-10 right-10 flex items-center gap-2 text-brand-safe text-[10px] font-bold uppercase tracking-widest bg-brand-safe/5 px-3 py-1 rounded-full">
                <Sparkles size={12} /> QVAC Powered
              </div>
            </div>

            {parseError && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-start gap-3 p-5 rounded-2xl bg-red-50 border border-red-100"
              >
                <AlertTriangle size={16} className="text-brand-stop mt-0.5 shrink-0" />
                <p className="text-sm font-semibold text-brand-stop">{parseError}</p>
              </motion.div>
            )}

            <button
              disabled={!ruleInput.trim() || !agentWalletId || isParsing}
              onClick={() => void handleParse()}
              className="w-full py-6 rounded-[28px] bg-brand-ink text-white font-bold text-xl items-center justify-center flex gap-3 shadow-2xl hover:scale-[1.01] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {isParsing ? (
                <RefreshCw size={24} className="animate-spin" />
              ) : (
                <Zap size={24} />
              )}
              {isParsing ? 'Analysing with QVAC…' : 'Parse & Preview Rule'}
            </button>
          </motion.div>
        )}

        {/* ── Step 2: Confirm ───────────────────────────────────────────────── */}
        {wizardStep === 2 && (
          <motion.div
            key="w2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-10"
          >
            <div>
              <h1 className="text-5xl font-semibold tracking-tight">Is this what you meant?</h1>
              <p className="text-black/40 text-lg font-medium mt-2">
                Review what Aura understood.
              </p>
            </div>

            <div className="p-10 rounded-[44px] bg-white border border-black/5 shadow-sm space-y-7">
              <div className="space-y-2">
                <div className="text-[10px] font-black text-black/25 uppercase tracking-widest">Your instruction</div>
                <p className="text-sm font-medium text-black/60 italic leading-relaxed border-l-2 border-black/10 pl-4 break-all">
                  "{ruleInput}"
                </p>
              </div>

              <div className="w-full h-px bg-black/5" />

              <div className="space-y-2">
                <div className="text-[10px] font-black text-black/25 uppercase tracking-widest">Trigger</div>
                <p className="text-base font-semibold text-brand-ink leading-snug">
                  {trigger ? describeTrigger(trigger) : '—'}
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-black text-black/25 uppercase tracking-widest">Action</div>
                <p className="text-base font-semibold text-brand-ink leading-snug">
                  {action && trigger ? describeAction(action, trigger.asset) : '—'}
                </p>
              </div>

              {preview?.conditions && (() => {
                const limitLines = describeLimit(preview.conditions, preview.trigger.type);
                if (limitLines.length === 0) return null;
                return (
                  <>
                    <div className="w-full h-px bg-black/5" />
                    <div className="space-y-2">
                      <div className="text-[10px] font-black text-black/25 uppercase tracking-widest">Limits</div>
                      {limitLines.map((line, i) => (
                        <p key={i} className="text-base font-semibold text-brand-ink leading-snug">{line}</p>
                      ))}
                    </div>
                  </>
                );
              })()}

              <div className="w-full h-px bg-black/5" />
              <div className="space-y-2">
                <div className="text-[10px] font-black text-black/25 uppercase tracking-widest">Max per execution (USD)</div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-black/40">$</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={maxAmountUsdInput}
                    onChange={(e) => setMaxAmountUsdInput(e.target.value)}
                    className="w-36 bg-black/4 border border-black/10 rounded-xl px-3 py-1.5 text-base font-semibold text-brand-ink focus:outline-none focus:ring-2 focus:ring-black/10"
                  />
                  <span className="text-xs text-black/35 font-medium">auto-suggested · edit to override</span>
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setWizardStep(1)}
                className="px-10 py-6 rounded-[28px] bg-black/5 font-bold uppercase tracking-widest text-xs transition-all hover:bg-black/10"
              >
                No, Edit
              </button>
              <button
                onClick={() => setWizardStep(3)}
                className="flex-1 py-6 rounded-[28px] bg-brand-ink text-white font-bold text-xl shadow-2xl hover:scale-[1.01] transition-all flex items-center justify-center gap-3"
              >
                Yes, Looks Right
                <ChevronRight size={22} />
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Step 3: Deploy ────────────────────────────────────────────────── */}
        {wizardStep === 3 && (
          <motion.div
            key="w3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-12 text-center max-w-lg mx-auto py-12"
          >
            <div className="mx-auto w-24 h-24 rounded-full bg-brand-safe/10 text-brand-safe flex items-center justify-center">
              <ShieldCheck size={48} />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Ready to Deploy</h1>
            <p className="text-black/40 text-lg">
              Aura will start monitoring this condition immediately. You can pause or delete at any
              time.
            </p>

            {deployError && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-start gap-3 p-5 rounded-2xl bg-red-50 border border-red-100 text-left"
              >
                <AlertTriangle size={16} className="text-brand-stop mt-0.5 shrink-0" />
                <p className="text-sm font-semibold text-brand-stop">{deployError}</p>
              </motion.div>
            )}

            <div className="flex gap-4">
              <button
                onClick={() => setWizardStep(2)}
                className="px-10 py-6 rounded-[28px] bg-black/5 font-bold uppercase tracking-widest text-xs transition-all hover:bg-black/10"
              >
                Back
              </button>
              <button
                disabled={isDeploying}
                onClick={() => void handleDeploy()}
                className="flex-1 py-8 rounded-[32px] bg-brand-ink text-white font-bold text-2xl flex items-center justify-center gap-4 shadow-2xl hover:scale-[1.01] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isDeploying ? (
                  <RefreshCw size={32} className="animate-spin" />
                ) : (
                  <Fingerprint size={32} />
                )}
                {isDeploying ? 'Activating…' : 'Confirm & Deploy'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
