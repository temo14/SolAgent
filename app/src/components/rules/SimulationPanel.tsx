import { motion } from 'motion/react';
import { Activity, ShieldCheck, Zap } from 'lucide-react';

interface SimulationPanelProps {
  avgTriggers: string;
  estSpend: string;
  maxDrawdown: string;
  projectedRoi: string;
}

export const SimulationPanel = ({ avgTriggers, estSpend, maxDrawdown, projectedRoi }: SimulationPanelProps) => (
  <motion.div 
    initial={{ opacity: 0, height: 0 }} 
    animate={{ opacity: 1, height: 'auto' }} 
    className="p-10 rounded-[44px] bg-black/5 border-2 border-dashed border-black/5 space-y-8 mb-8"
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-brand-wait/10 flex items-center justify-center text-brand-wait">
          <Activity size={20} />
        </div>
        <div>
          <h4 className="text-sm font-bold uppercase tracking-widest text-brand-ink">30-Day Market Simulation</h4>
          <p className="text-[10px] text-black/40 font-medium font-mono uppercase">Historical Period: Last 30 Days</p>
        </div>
      </div>
      <div className="px-4 py-2 rounded-full bg-brand-safe/10 border border-brand-safe/20 text-brand-safe flex items-center gap-2">
         <ShieldCheck size={14} />
         <span className="text-[10px] font-black uppercase tracking-widest">Logic Verified</span>
      </div>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
      <div className="p-6 rounded-3xl bg-white border border-black/5 shadow-sm">
        <div className="text-[9px] font-bold text-black/20 uppercase tracking-widest mb-1">Avg. Triggers</div>
        <div className="text-xl font-bold">{avgTriggers}</div>
      </div>
      <div className="p-6 rounded-3xl bg-white border border-black/5 shadow-sm">
        <div className="text-[9px] font-bold text-black/20 uppercase tracking-widest mb-1">Est. Spend</div>
        <div className="text-xl font-bold font-mono">{estSpend}</div>
      </div>
      <div className="p-6 rounded-3xl bg-white border border-black/5 shadow-sm">
        <div className="text-[9px] font-bold text-black/20 uppercase tracking-widest mb-1">Peak Drawdown</div>
        <div className="text-xl font-bold text-brand-stop">{maxDrawdown}</div>
      </div>
      <div className="p-6 rounded-3xl bg-white border border-black/5 shadow-sm">
        <div className="text-[9px] font-bold text-black/20 uppercase tracking-widest mb-1">Net Yield</div>
        <div className="text-xl font-bold text-brand-safe">{projectedRoi}</div>
      </div>
    </div>

    <div className="space-y-3">
      <div className="text-[10px] font-bold text-black/20 uppercase tracking-widest flex items-center gap-2">
         <Zap size={10} /> Backtest Example
      </div>
      <div className="p-5 rounded-2xl bg-white flex items-center justify-between border border-black/5 shadow-sm">
         <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-black/40 text-[10px] font-bold">#1</div>
            <div>
               <div className="text-xs font-bold font-display">Optimization Triggered</div>
               <div className="text-[10px] text-black/40">Spread exceeded 0.8% threshold</div>
            </div>
         </div>
         <div className="text-right">
            <div className="text-xs font-medium text-brand-safe font-mono tracking-tighter">SIMULATED OK</div>
            <div className="text-[10px] text-black/40">Gas optimal at 12 gwei</div>
         </div>
      </div>
    </div>
  </motion.div>
);
