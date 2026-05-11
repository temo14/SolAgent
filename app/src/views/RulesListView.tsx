import { motion } from 'motion/react';
import { Plus, Database } from 'lucide-react';
import { AutomationRule } from '../types';
import { RuleCard } from '../components/rules/RuleCard';
import { EmptyState, Skeleton } from '../components/ui';

interface RulesListViewProps {
  key?: string;
  rules: AutomationRule[];
  isLoading?: boolean;
  onAddRule: () => void;
  onDeleteRule: (id: string) => void;
  onReactivateRule: (id: string) => void;
}

export const RulesListView = ({ rules, isLoading, onAddRule, onDeleteRule, onReactivateRule }: RulesListViewProps) => (
  <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="space-y-12">
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
      <div>
         <h1 className="text-5xl font-semibold tracking-tight text-brand-ink">My Automation Rules</h1>
         <p className="text-black/40 text-xl font-medium mt-2">Manage the automatic tasks that happen when you're away.</p>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={onAddRule}
          className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-brand-ink text-white font-bold text-sm tracking-widest shadow-xl shadow-black/10 hover:scale-105 transition-all"
        >
          <Plus size={18} /> Add New Rule
        </button>
      </div>
    </div>

    {isLoading ? (
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-72 rounded-[44px]" />)}
      </div>
    ) : rules.length === 0 ? (
      <EmptyState
        icon={Database}
        title="No Active Rules"
        description="Your agent is currently purely reactive. Create a rule to start autonomous optimization."
        actionText="Create First Rule"
        onAction={onAddRule}
      />
    ) : (
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
        {rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} onDelete={onDeleteRule} onReactivate={onReactivateRule} />
        ))}
      </div>
    )}
  </motion.div>
);
