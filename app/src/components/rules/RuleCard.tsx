import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, Trash2, CheckCircle2, ShieldCheck, AlertTriangle, Store, X, Loader2, RotateCcw } from 'lucide-react';
import { AutomationRule } from '../../types';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

interface PublishModalProps {
  rule: AutomationRule;
  onClose: () => void;
}

function PublishModal({ rule, onClose }: PublishModalProps) {
  const { jwt } = useAuth();
  const [description, setDescription] = useState(
    rule.description.length > 120 ? rule.description.slice(0, 120) : rule.description,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePublish = async () => {
    if (!jwt || !description.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      await api.post(
        '/api/marketplace/publish',
        { ruleId: rule.id, description: description.trim() },
        jwt,
      );
      setDone(true);
    } catch {
      setError('Publish failed. You may have already published this rule.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', duration: 0.3 }}
        className="bg-white rounded-[28px] p-8 w-full max-w-sm shadow-2xl"
      >
        {done ? (
          <div className="text-center py-4">
            <CheckCircle2 size={40} className="text-brand-safe mx-auto mb-4" />
            <h2 className="text-xl font-black tracking-tight mb-2">Published!</h2>
            <p className="text-sm text-black/40 font-medium mb-6">
              Your strategy is now live in the marketplace.
            </p>
            <button onClick={onClose} className="modern-btn modern-btn-primary w-full h-12">
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-brand-ink flex items-center justify-center">
                  <Store size={18} className="text-white" />
                </div>
                <h2 className="text-lg font-black tracking-tight">Publish to Marketplace</h2>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-xl transition-colors">
                <X size={16} className="text-black/30" />
              </button>
            </div>

            <p className="text-xs text-black/40 font-medium mb-5 leading-relaxed">
              Your wallet address is never shared — only the rule logic and your description.
            </p>

            <label className="text-[10px] font-black uppercase tracking-widest text-black/40 block mb-2">
              Description (shown in marketplace)
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              className="w-full px-4 py-3 rounded-2xl bg-black/[0.03] border border-black/[0.06] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-ink/20 resize-none mb-1"
            />
            <p className="text-[10px] text-black/25 text-right mb-5">{description.length}/200</p>

            {error && (
              <p className="text-xs text-brand-stop font-medium mb-4 px-3 py-2 bg-brand-stop/5 rounded-xl">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 h-12 rounded-2xl border border-black/10 text-sm font-bold text-black/40 hover:bg-black/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handlePublish()}
                disabled={isLoading || !description.trim()}
                className="flex-1 h-12 rounded-2xl bg-brand-ink text-white text-sm font-black hover:bg-black transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? <Loader2 size={15} className="animate-spin" /> : <Store size={15} />}
                Publish
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

interface RuleCardProps {
  key?: string;
  rule: AutomationRule;
  onDelete: (id: string) => void;
  onReactivate: (id: string) => void;
}

export const RuleCard = ({ rule, onDelete, onReactivate }: RuleCardProps) => {
  const [showPublish, setShowPublish] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isCircuitBreaker = rule.status === 'circuit_breaker';
  const isInactive = rule.status === 'inactive';

  return (
    <>
      <motion.div
        layout
        className={`
          phantom-card group flex flex-col
          ${isInactive ? 'opacity-60' : ''}
          ${isCircuitBreaker ? 'ring-2 ring-brand-stop/30' : ''}
        `}
      >
        <div className="flex items-center justify-between mb-6">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
            isCircuitBreaker ? 'bg-brand-stop/10 text-brand-stop' :
            rule.status === 'active' ? 'bg-brand-accent/10 text-brand-accent' :
            'bg-black/5 text-black/20'
          }`}>
            {isCircuitBreaker
              ? <AlertTriangle size={22} />
              : <Zap size={24} className={rule.status === 'active' ? 'fill-current' : ''} />
            }
          </div>
          <div className="flex gap-1">
            {rule.status === 'active' && (
              <button
                onClick={() => setShowPublish(true)}
                title="Publish to Marketplace"
                className="p-3 hover:bg-black/5 rounded-full text-black/10 hover:text-brand-accent transition-all"
              >
                <Store size={15} />
              </button>
            )}
            {showDeleteConfirm ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={async () => {
                    setIsDeleting(true);
                    try { await onDelete(rule.id); } finally { setIsDeleting(false); }
                  }}
                  disabled={isDeleting}
                  className="px-3 py-1.5 rounded-xl bg-brand-stop text-white text-[10px] font-black hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {isDeleting ? <Loader2 size={10} className="animate-spin" /> : null}
                  Delete
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="p-2 hover:bg-black/5 rounded-full text-black/30 transition-colors disabled:opacity-30"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-3 hover:bg-red-50 rounded-full text-black/10 hover:text-brand-stop transition-all"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Circuit breaker banner */}
        {isCircuitBreaker && (
          <div className="mb-4 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-amber-700">
                  Rule paused after 3 failed executions
                </p>
                {rule.lastFailureReason && (
                  <p className="text-[10px] text-amber-600 font-medium mt-0.5 leading-snug">
                    Last error: {rule.lastFailureReason}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={async () => {
                setIsReactivating(true);
                await onReactivate(rule.id);
                setIsReactivating(false);
              }}
              disabled={isReactivating}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl bg-brand-stop/10 hover:bg-brand-stop/20 text-brand-stop text-[10px] font-black transition-colors disabled:opacity-50"
            >
              {isReactivating
                ? <Loader2 size={10} className="animate-spin" />
                : <RotateCcw size={10} />}
              Reactivate
            </button>
          </div>
        )}

        {/* Paused — show resume button */}
        {isInactive && (
          <div className="mb-4 px-4 py-3 rounded-2xl bg-black/[0.03] border border-black/10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-black/20 shrink-0" />
              <p className="text-[11px] font-bold text-black/40">Rule is paused</p>
            </div>
            <button
              onClick={async () => {
                setIsReactivating(true);
                await onReactivate(rule.id);
                setIsReactivating(false);
              }}
              disabled={isReactivating}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl bg-brand-safe/10 hover:bg-brand-safe/20 text-brand-safe text-[10px] font-black transition-colors disabled:opacity-50"
            >
              {isReactivating ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
              Resume
            </button>
          </div>
        )}

        {/* Last execution failed — visible on active rules before circuit breaker trips */}
        {rule.status === 'active' && rule.lastFailureReason && (
          <div className="mb-4 px-4 py-2.5 rounded-2xl bg-orange-50 border border-orange-200 flex items-start gap-2">
            <AlertTriangle size={11} className="text-orange-500 shrink-0 mt-0.5" />
            <p className="text-[10px] font-bold text-orange-700 leading-snug">
              Last execution failed: {rule.lastFailureReason}
            </p>
          </div>
        )}

        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-black tracking-tight leading-tight">{rule.name}</h3>
            {rule.status === 'active' && <CheckCircle2 size={14} className="text-brand-safe shrink-0" />}
          </div>
          <p className="text-[13px] text-black/40 leading-relaxed min-h-[36px] font-medium break-all">
            {rule.description.length > 80 ? `${rule.description.slice(0, 80)}…` : rule.description}
          </p>

          <div className="pt-2 space-y-0.5">
            <div className="p-4 rounded-t-2xl bg-black/[0.02] border border-black/5 text-[11px] font-mono overflow-hidden">
              <span className="font-extrabold text-black/20 uppercase tracking-widest mr-3 font-sans">If</span>
              <span className="break-all">{rule.logic.condition}</span>
            </div>
            <div className="p-4 rounded-b-2xl bg-brand-ink text-white text-[11px] font-mono shadow-lg shadow-black/10 overflow-hidden">
              <span className="font-extrabold text-white/40 uppercase tracking-widest mr-3 font-sans">Do</span>
              <span className="break-all">{rule.logic.action}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-black/5 grid grid-cols-2 gap-3">
          <div className="p-4 rounded-3xl bg-black/[0.02] border border-black/5">
            <div className="text-[8px] font-bold uppercase tracking-widest text-black/20 mb-2 flex items-center gap-1.5">
              <ShieldCheck size={10} /> Safety Limits
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-black/40">Max / Exec</span>
                <span className="font-bold">${(rule.limits?.maxSpendPerExec ?? 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-black/40">Max fires / Day</span>
                <span className="font-bold">{rule.limits?.maxFiresDay ?? '—'}</span>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-3xl bg-black/[0.02] border border-black/5">
            <div className="text-[8px] font-bold uppercase tracking-widest text-black/20 mb-2">Activity</div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-black/40">Fires today</span>
                <span className="font-bold">{rule.executions}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-black/40">Created</span>
                <span className="font-bold">{rule.lastRun}</span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showPublish && (
          <PublishModal rule={rule} onClose={() => setShowPublish(false)} />
        )}
      </AnimatePresence>
    </>
  );
};
