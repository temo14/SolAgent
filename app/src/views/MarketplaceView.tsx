import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Store, TrendingUp, ThumbsUp, ArrowRight, Loader2 } from 'lucide-react';
import { Skeleton } from '../components/ui';
import { api } from '../lib/api';

interface ParsedRule {
  trigger?: { type?: string; asset?: string; threshold?: number; cron_expression?: string };
  action?: { type?: string; from_asset?: string; to_asset?: string; amount?: number };
}

interface Template {
  id: string;
  description: string;
  parsedRule: ParsedRule;
  useCount: number;
  upvotes: number;
  createdAt: string;
}

function triggerSummary(rule: ParsedRule): string {
  const t = rule.trigger;
  if (!t) return 'Custom trigger';
  switch (t.type) {
    case 'price_below': return `${t.asset} price < $${t.threshold}`;
    case 'price_above': return `${t.asset} price > $${t.threshold}`;
    case 'balance_below': return `${t.asset} balance < ${t.threshold}`;
    case 'balance_above': return `${t.asset} balance > ${t.threshold}`;
    case 'time_cron': return `Recurring: ${t.cron_expression ?? '* * * * *'}`;
    case 'outflow_exceeded': return `Outflow > $${t.threshold}`;
    default: return t.type ?? 'Trigger';
  }
}

function actionSummary(rule: ParsedRule): string {
  const a = rule.action;
  if (!a) return 'Custom action';
  switch (a.type) {
    case 'swap': return `Swap ${a.amount} ${a.from_asset} → ${a.to_asset}`;
    case 'transfer': return `Transfer ${a.amount} SOL`;
    case 'alert_only': return 'Send alert only';
    case 'pause_all': return 'Pause all rules';
    default: return a.type ?? 'Action';
  }
}

interface MarketplaceViewProps {
  jwt: string | null;
  onUseTemplate: (description: string) => void;
}

export function MarketplaceView({ jwt, onUseTemplate }: MarketplaceViewProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [upvoted, setUpvoted] = useState<Set<string>>(new Set());
  const [upvoting, setUpvoting] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ ok: boolean; data: Template[] }>('/api/marketplace')
      .then((res) => { if (res.ok) setTemplates(res.data); })
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, []);

  const handleUse = async (template: Template) => {
    // Increment use count in background
    void api.post(`/api/marketplace/${template.id}/use`, {}).catch(() => undefined);
    onUseTemplate(template.description);
  };

  const handleUpvote = async (template: Template) => {
    if (upvoted.has(template.id) || !jwt) return;
    setUpvoting(template.id);
    try {
      const res = await api.post<{ ok: boolean; data: { upvotes: number } }>(
        `/api/marketplace/${template.id}/upvote`,
        {},
        jwt,
      );
      if (res.ok) {
        setUpvoted((prev) => new Set([...prev, template.id]));
        setTemplates((prev) =>
          prev.map((t) => (t.id === template.id ? { ...t, upvotes: res.data.upvotes } : t)),
        );
      }
    } catch {
      // non-fatal
    } finally {
      setUpvoting(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-tight mb-1 flex items-center gap-3">
            <Store size={28} className="text-brand-accent" /> Marketplace
          </h2>
          <p className="text-sm text-black/40 font-medium">
            Community-published rule templates. Click any to load it into the wizard.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-48 rounded-[24px]" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="phantom-card text-center py-20">
          <Store size={48} className="text-black/10 mx-auto mb-4" />
          <p className="text-black/30 font-bold uppercase text-xs tracking-widest mb-2">No templates yet</p>
          <p className="text-sm text-black/40 max-w-xs mx-auto">
            Create a rule and publish it to share your strategy with the community.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((template) => (
            <motion.div
              key={template.id}
              whileHover={{ y: -2 }}
              className="phantom-card flex flex-col group cursor-default"
            >
              {/* Use count badge */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-safe/10">
                  <TrendingUp size={10} className="text-brand-safe" />
                  <span className="text-[10px] font-black text-brand-safe uppercase tracking-wider">
                    {template.useCount.toLocaleString()} uses
                  </span>
                </div>
                <button
                  onClick={() => void handleUpvote(template)}
                  disabled={upvoted.has(template.id) || !jwt || upvoting === template.id}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full border transition-colors text-[10px] font-black ${
                    upvoted.has(template.id)
                      ? 'bg-brand-ink text-white border-brand-ink'
                      : 'border-black/10 text-black/30 hover:border-brand-ink hover:text-brand-ink'
                  } disabled:opacity-50`}
                >
                  {upvoting === template.id ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <ThumbsUp size={10} />
                  )}
                  {template.upvotes}
                </button>
              </div>

              {/* Description */}
              <h3 className="text-base font-black tracking-tight mb-3 leading-snug flex-1">
                {template.description}
              </h3>

              {/* Rule summary pills */}
              <div className="flex flex-wrap gap-2 mb-5">
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-black/[0.04] text-black/50">
                  {triggerSummary(template.parsedRule)}
                </span>
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-black/[0.04] text-black/50">
                  {actionSummary(template.parsedRule)}
                </span>
              </div>

              {/* Use button */}
              <button
                onClick={() => void handleUse(template)}
                className="w-full h-11 rounded-2xl bg-brand-ink text-white text-xs font-black hover:bg-black transition-colors flex items-center justify-center gap-2 group-hover:gap-3"
              >
                Use this template <ArrowRight size={14} />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {!jwt && templates.length > 0 && (
        <p className="text-center text-xs text-black/30 font-medium">
          Connect your wallet to upvote templates and publish your own.
        </p>
      )}
    </motion.div>
  );
}
