import { ShieldCheck } from 'lucide-react';
import { PermissionGuard } from '../common/PermissionGuard';

interface SafetySettingsProps {
  maxSpend: number;
  onMaxSpendChange: (val: number) => void;
}

export const SafetySettings = ({ maxSpend, onMaxSpendChange }: SafetySettingsProps) => (
  <div className="p-10 rounded-[44px] bg-brand-ink text-white shadow-2xl relative overflow-hidden flex flex-col h-full">
    <div className="absolute -top-10 -right-10 opacity-10"><ShieldCheck size={240} /></div>

    <div className="relative z-10">
      <div className="flex items-center gap-2 text-brand-safe font-bold mb-8">
         <ShieldCheck size={20} />
         <h3 className="text-xl font-display uppercase tracking-tight">Safety Protocol</h3>
      </div>

      <div className="grid grid-cols-1 gap-8 mb-10">
         <div className="space-y-4">
            <label className="text-[10px] font-black uppercase tracking-widest text-white/30">Max Per Execution ($)</label>
            <div className="flex items-center gap-4">
               <input
                 type="range"
                 min="100"
                 max="50000"
                 step="100"
                 value={maxSpend}
                 onChange={(e) => onMaxSpendChange(parseInt(e.target.value))}
                 className="flex-1 accent-brand-safe"
               />
               <span className="text-lg font-mono font-bold">${maxSpend.toLocaleString()}</span>
            </div>
         </div>
      </div>

      <PermissionGuard
        authorized={[
          "Swap tokens for optimization",
          "Move yields to YOUR verified vault",
          "Rebalance within 5% slippage"
        ]}
        prohibited={[
          "Withdraw to unverified addresses",
          "Modify security or recovery info",
          "Increase limits without 2FA"
        ]}
      />
    </div>

    <div className="mt-auto pt-10 relative z-10">
       <div className="p-5 rounded-3xl bg-white/5 border border-white/10 text-[11px] font-medium leading-relaxed text-white/50 italic">
          "Aura operates within these mathematical boundaries. You can instantly pause or revoke this authority at any time."
       </div>
    </div>
  </div>
);
