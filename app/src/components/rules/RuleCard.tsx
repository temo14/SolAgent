import { motion } from 'motion/react';
import { Zap, Trash2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { AutomationRule } from '../../types';

interface RuleCardProps {
  key?: string;
  rule: AutomationRule;
  onDelete: (id: string) => void;
}

export const RuleCard = ({ rule, onDelete }: RuleCardProps) => (
  <motion.div 
    layout
    className={`
      phantom-card group flex flex-col
      ${rule.status === 'inactive' ? 'opacity-40 grayscale pointer-events-none' : ''}
    `}
  >
    <div className="flex items-center justify-between mb-8">
       <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${rule.status === 'active' ? 'bg-brand-accent/10 text-brand-accent' : 'bg-black/5 text-black/20'}`}>
          <Zap size={24} className={rule.status === 'active' ? 'fill-current' : ''} />
       </div>
       <div className="flex gap-2">
          <button onClick={() => onDelete(rule.id)} className="p-3 hover:bg-red-50 rounded-full text-black/10 hover:text-red-500 transition-all group/trash">
            <Trash2 size={16} />
          </button>
       </div>
    </div>

    <div className="flex-1 space-y-4">
       <div className="flex items-center gap-2">
         <h3 className="text-2xl font-black">{rule.name}</h3>
         {rule.status === 'active' && <CheckCircle2 size={16} className="text-brand-safe" />}
       </div>
       <p className="text-[13px] text-black/40 leading-relaxed min-h-[40px] font-medium">{rule.description}</p>

       <div className="pt-4 space-y-0.5">
          <div className="p-4 rounded-t-2xl bg-black/[0.02] border border-black/5 text-[11px] font-mono">
             <span className="font-extrabold text-black/20 uppercase tracking-widest mr-3 font-sans">If</span>
             {rule.logic.condition}
          </div>
          <div className="p-4 rounded-b-2xl bg-brand-ink text-white text-[11px] font-mono shadow-lg shadow-black/10">
             <span className="font-extrabold text-white/40 uppercase tracking-widest mr-3 font-sans">Do</span>
             {rule.logic.action}
          </div>
       </div>
    </div>

     <div className="mt-8 pt-8 border-t border-black/5 grid grid-cols-2 gap-4">
        <div className="p-4 rounded-3xl bg-black/[0.02] border border-black/5">
           <div className="text-[8px] font-bold uppercase tracking-widest text-black/20 mb-2 flex items-center gap-1.5">
             <ShieldCheck size={10} /> Safety Limits
           </div>
           <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                 <span className="text-black/40">Daily Cap</span>
                 <span className="font-bold">${rule.limits?.maxSpendPerDay || '5,000'}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                 <span className="text-black/40">Delay</span>
                 <span className="font-bold">{rule.limits?.executionDelay || '0'}m</span>
              </div>
           </div>
        </div>
        <div className="p-4 rounded-3xl bg-black/[0.02] border border-black/5">
           <div className="text-[8px] font-bold uppercase tracking-widest text-black/20 mb-2">Performance</div>
           <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                 <span className="text-black/40">Yield</span>
                 <span className="font-bold text-brand-safe">{rule.profit}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                 <span className="text-black/40">Actions</span>
                 <span className="font-bold">{rule.executions}</span>
              </div>
           </div>
        </div>
     </div>
  </motion.div>
);
