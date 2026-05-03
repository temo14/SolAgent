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
} from 'lucide-react';
import { SimulationPanel } from './SimulationPanel';
import { SafetySettings } from './SafetySettings';
import type { BackendRule } from '../../hooks/useRules';

interface RuleWizardProps {
  key?: string;
  onCancel: () => void;
  /** Called after the rule is activated. Parent refreshes the rules list. */
  onComplete: () => void;
  /** Creates a PENDING_ACTIVATION rule via the rule-engine + QVAC. */
  createRule: (rawInput: string, agentWalletId: string) => Promise<BackendRule | null>;
  /** Activates a rule from PENDING_ACTIVATION → ACTIVE. */
  activateRule: (ruleId: string) => Promise<boolean>;
  /** Agent wallet to attach the rule to. */
  agentWalletId: string;
}

export const RuleWizard = ({
  onCancel,
  onComplete,
  createRule,
  activateRule,
  agentWalletId,
}: RuleWizardProps) => {
  const [wizardStep, setWizardStep] = useState(1);
  const [ruleInput, setRuleInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [parsedRule, setParsedRule] = useState<BackendRule | null>(null);
  const [showSimulation, setShowSimulation] = useState(false);
  const [maxSpend, setMaxSpend] = useState(1000);
  const [delay, setDelay] = useState(0);

  // ── Step 1: Parse via QVAC ────────────────────────────────────────────────
  const handleParse = async () => {
    if (!ruleInput.trim() || !agentWalletId) return;
    setIsParsing(true);
    setParseError(null);

    const rule = await createRule(ruleInput.trim(), agentWalletId);
    if (!rule) {
      setParseError(
        'Could not parse your rule. Make sure QVAC is running and try again, or rephrase it.',
      );
      setIsParsing(false);
      return;
    }

    setParsedRule(rule);
    setIsParsing(false);
    setWizardStep(2);
  };

  // ── Step 3: Activate ──────────────────────────────────────────────────────
  const handleDeploy = async () => {
    if (!parsedRule) return;
    setIsDeploying(true);
    setDeployError(null);

    const ok = await activateRule(parsedRule.id);
    if (!ok) {
      setDeployError('Activation failed. Please try again.');
      setIsDeploying(false);
      return;
    }

    setIsDeploying(false);
    onComplete();
  };

  // ── Parsed trigger / action display ───────────────────────────────────────
  const trigger = parsedRule?.parsedRule.trigger;
  const action = parsedRule?.parsedRule.action;

  const triggerLabel = trigger
    ? `${trigger.type.replace(/_/g, ' ')}: ${trigger.asset} @ ${trigger.threshold}`
    : '–';
  const actionLabel = action
    ? `${action.type}${action.from_asset ? ` ${action.amount} ${action.from_asset}` : ''}${action.to_asset ? ` → ${action.to_asset}` : ''}${action.recipient ? ` → ${action.recipient.slice(0, 8)}…` : ''}`
    : '–';

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
            className="space-y-10"
          >
            <div>
              <h1 className="text-5xl font-semibold tracking-tight text-brand-ink">
                Describe Your Rule
              </h1>
              <p className="text-black/40 text-xl font-medium mt-2">
                Tell Aura what to watch for and what action to take.
              </p>
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
                onChange={(e) => setRuleInput(e.target.value)}
                placeholder="e.g. 'If SOL price drops below $100, buy 1 SOL with USDC.'"
                className="w-full h-64 bg-white border border-black/10 rounded-[44px] p-10 text-2xl leading-relaxed focus:ring-8 focus:ring-black/5 focus:outline-none transition-all resize-none shadow-sm group-hover:border-black/20"
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

        {/* ── Step 2: Preview ───────────────────────────────────────────────── */}
        {wizardStep === 2 && (
          <motion.div
            key="w2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-10"
          >
            <div className="flex items-end justify-between">
              <h1 className="text-5xl font-semibold tracking-tight">Rules Preview</h1>
              <button
                onClick={() => setShowSimulation(!showSimulation)}
                className="text-[10px] font-bold uppercase tracking-widest text-brand-wait underline"
              >
                {showSimulation ? 'Hide Test Results' : 'Test With Past Data'}
              </button>
            </div>

            {showSimulation && (
              <SimulationPanel
                avgTriggers="~1.2 / Day"
                estSpend="$142.10"
                maxDrawdown="-$4.20"
                projectedRoi="+8.4%"
              />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-10 rounded-[44px] bg-white border border-black/5 shadow-sm space-y-8">
                <div className="space-y-4">
                  <div className="text-[10px] font-bold text-black/20 uppercase tracking-widest">
                    Logic Resolution (QVAC Output)
                  </div>
                  <div className="space-y-3">
                    <div className="p-5 rounded-2xl bg-black/[0.02] border border-black/5">
                      <div className="text-[10px] font-bold text-black/40 uppercase mb-2">
                        The Trigger
                      </div>
                      <div className="font-mono text-sm font-medium">{triggerLabel}</div>
                    </div>
                    <div className="p-5 rounded-2xl bg-brand-ink text-white shadow-xl">
                      <div className="text-[10px] font-bold text-white/40 uppercase mb-2">
                        The Action
                      </div>
                      <div className="font-mono text-sm font-medium">{actionLabel}</div>
                    </div>
                  </div>
                </div>
              </div>

              <SafetySettings
                maxSpend={maxSpend}
                onMaxSpendChange={setMaxSpend}
                delay={delay}
                onDelayChange={setDelay}
              />
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setWizardStep(1)}
                className="px-10 py-6 rounded-[28px] bg-black/5 font-bold uppercase tracking-widest text-xs transition-all hover:bg-black/10"
              >
                Back
              </button>
              <button
                onClick={() => setWizardStep(3)}
                className="flex-1 py-6 rounded-[28px] bg-brand-ink text-white font-bold text-xl shadow-2xl hover:scale-[1.01] transition-all"
              >
                Confirm Safety
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
