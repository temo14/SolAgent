import { motion, AnimatePresence } from 'motion/react';
import { Fingerprint, Brain, ExternalLink, Layers, Cpu, ShieldCheck, CheckCircle2, Plus, XCircle, RotateCcw, Clock, AlertTriangle } from 'lucide-react';
import { AuditLogEntry } from '../../types';
import { useState, useEffect } from 'react';

interface AuditCardProps {
  key?: string;
  entry: AuditLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

export const AuditCard = ({ entry, isExpanded, onToggle }: AuditCardProps) => {
  const [timeLeft, setTimeLeft] = useState<string | null>(null);

  useEffect(() => {
    if (entry.action.status === 'pending' && entry.action.cancelableUntil) {
      const interval = setInterval(() => {
        const remaining = new Date(entry.action.cancelableUntil!).getTime() - Date.now();
        if (remaining <= 0) {
          setTimeLeft(null);
          clearInterval(interval);
        } else {
          const mins = Math.floor(remaining / 60000);
          const secs = Math.floor((remaining % 60000) / 1000);
          setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [entry.action.status, entry.action.cancelableUntil]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-brand-safe';
      case 'failed': return 'text-brand-stop';
      case 'retrying': return 'text-brand-wait';
      case 'pending': return 'text-blue-500';
      default: return 'text-white/40';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle2 size={16} />;
      case 'failed': return <XCircle size={16} />;
      case 'retrying': return <RotateCcw size={16} className="animate-spin" />;
      case 'pending': return <Clock size={16} className="animate-pulse" />;
      default: return null;
    }
  };

  return (
    <div className="relative">
      <div className={`absolute -left-[35px] md:-left-[64px] top-2 w-[47px] h-[47px] rounded-full border-4 border-[#F8F9FA] flex items-center justify-center z-10 shadow-lg shadow-black/10 transition-transform hover:scale-110 ${entry.action.status === 'failed' ? 'bg-brand-stop text-white' : entry.action.status === 'pending' ? 'bg-blue-500 text-white' : 'bg-brand-ink text-white'}`}>
        <Fingerprint size={20} />
      </div>

      <div className={`phantom-card !p-10 shadow-sm transition-all ${entry.action.status === 'failed' ? 'border-brand-stop/20 shadow-brand-stop/5' : 'border-black/5'}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold text-black/20 uppercase tracking-widest">{entry.timestamp}</span>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-50 text-[9px] font-bold text-blue-500 uppercase tracking-widest">
                <Brain size={10} /> Secure Strategy
              </div>
            </div>
            <h3 className="text-2xl font-bold">{entry.ruleName}</h3>
          </div>
          <div className="flex items-center gap-3">
             <div className={`px-4 py-2 rounded-full border flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${getStatusColor(entry.action.status)} ${entry.action.status === 'failed' ? 'bg-brand-stop/5 border-brand-stop/10' : 'bg-black/5 border-black/5'}`}>
                {getStatusIcon(entry.action.status)}
                {entry.action.status}
             </div>
             <button 
              onClick={onToggle}
              className="px-5 py-2.5 rounded-full bg-black/5 text-[10px] font-bold uppercase tracking-widest hover:bg-black/10 transition-all"
            >
              {isExpanded ? 'Hide Reasoning' : 'Show Full Reasoning'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-black/[0.02] p-8 rounded-[32px] border border-black/5 relative overflow-hidden">
            {entry.action.status === 'pending' && timeLeft && (
              <div className="absolute top-6 right-6 flex items-center gap-2 text-blue-600 bg-white/50 backdrop-blur-sm px-3 py-1.5 rounded-full border border-blue-100 shadow-sm">
                <Clock size={12} />
                <span className="text-[10px] font-black font-mono">AUTOPAUSE: {timeLeft}</span>
              </div>
            )}
            <div className="text-[10px] font-bold text-black/20 uppercase tracking-widest mb-4">The Trigger</div>
            <div className="space-y-1">
              <div className="text-xs font-bold text-black/40">Rule Condition Met:</div>
              <div className="text-3xl font-bold font-mono text-brand-wait group-hover:text-brand-ink transition-colors">{entry.trigger.observedValue}</div>
               <p className="text-[11px] text-black/60 mt-4 leading-relaxed bg-white/50 p-3 rounded-xl border border-black/5 italic">
                 "{entry.action.status === 'failed' ? 'The execution was blocked because price slippage exceeded your safety threshold of 0.5%.' : 'The target threshold was reached. I initiated the move to protect your yields.'}"
               </p>
            </div>
          </div>
          <div className={`p-8 rounded-[32px] text-white shadow-2xl relative overflow-hidden group ${entry.action.status === 'success' ? 'bg-brand-ink' : entry.action.status === 'pending' ? 'bg-blue-600' : entry.action.status === 'retrying' ? 'bg-brand-wait' : 'bg-brand-stop'}`}>
             <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 blur-3xl -tr-8" />
             <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-4 relative z-10">The Result</div>
             <div className="space-y-1 relative z-10">
                <div className="text-xs font-bold text-white/40">Status: {entry.action.status}</div>
                <div className="text-2xl font-bold leading-tight mb-2">{entry.action.label}</div>
                
                {entry.action.status === 'pending' ? (
                  <button 
                    onClick={(e) => { e.stopPropagation(); /* cancel action logic */ }}
                    className="mt-4 px-6 py-2.5 bg-white text-blue-600 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-white/90 transition-all shadow-xl"
                  >
                     <XCircle size={14} /> Stop Execution
                  </button>
                ) : entry.action.status === 'failed' ? (
                  <div className="mt-4 flex items-center gap-2 text-white text-[10px] font-extrabold uppercase tracking-widest">
                     <AlertTriangle size={14} /> Execution Prevented For Your Safety
                  </div>
                ) : entry.action.status === 'retrying' ? (
                  <div className="mt-4 flex items-center gap-2 text-white/60 text-[10px] font-extrabold uppercase tracking-widest">
                     <RotateCcw size={14} className="animate-spin" /> Verifying Network Conditions...
                  </div>
                ) : (
                  <a href="#" className="inline-flex items-center gap-2 text-brand-safe text-[10px] font-extrabold uppercase tracking-widest hover:underline">
                     View Receipt <ExternalLink size={10} />
                  </a>
                )}
             </div>
          </div>
        </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {/* LEVEL 2: PERFORMANCE INSIGHTS */}
            <div className="mt-10 pt-10 border-t border-black/5">
              <div className="flex items-center justify-between mb-6">
                 <h4 className="text-xs font-bold uppercase tracking-widest text-black/40">Performance Insights</h4>
                 <div className="h-px flex-1 bg-black/5 mx-4" />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-black/20 uppercase tracking-widest"><Layers size={14} /> Major Routes</div>
                  <div className="flex flex-wrap gap-2">
                    {entry.details.route.map((hop, i) => (
                      <span key={i} className="px-2 py-1 bg-black/5 rounded text-[10px] font-bold text-black/60">
                        {hop}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                   <div className="flex items-center gap-2 text-[10px] font-bold text-black/20 uppercase tracking-widest"><Cpu size={14} /> Trade Quality</div>
                   <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                         <span className="text-black/40 font-medium">Slippage</span>
                         <span className="font-bold text-brand-safe">{entry.details.slippage}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                         <span className="text-black/40 font-medium">Gas Efficiency</span>
                         <span className="font-bold text-blue-500">Optimized</span>
                      </div>
                   </div>
                </div>
                <div className="space-y-4">
                   <div className="flex items-center gap-2 text-[10px] font-bold text-black/20 uppercase tracking-widest"><ShieldCheck size={14} /> Trust Score</div>
                   <div className="flex items-center gap-2 text-brand-safe font-black text-xs">
                      <CheckCircle2 size={16} /> 100/100 Verified
                   </div>
                   <p className="text-[10px] text-black/40 leading-relaxed font-bold">
                    Matches natural language intent #802.
                   </p>
                </div>
              </div>

              {/* LEVEL 3: PROTOCOL MANIFEST (Advanced) */}
              <div className="mt-8 p-6 rounded-3xl bg-black/[0.02] border border-black/5">
                 <details className="group/advanced">
                    <summary className="flex items-center justify-between cursor-pointer list-none">
                       <span className="text-[9px] font-black uppercase tracking-[0.2em] text-black/20 group-hover/advanced:text-black/40 transition-colors">Show Technical Protocol Manifest (Advanced)</span>
                       <div className="w-6 h-6 rounded-full bg-black/5 flex items-center justify-center group-hover/advanced:bg-black/10 transition-all">
                          <Plus size={12} className="text-black/20 group-open/advanced:rotate-45 transition-transform" />
                       </div>
                    </summary>
                    <div className="mt-6 pt-6 border-t border-black/5 grid grid-cols-2 lg:grid-cols-4 gap-6">
                       <div className="space-y-1">
                          <div className="text-[8px] font-bold text-black/20 uppercase">Solver ID</div>
                          <div className="font-mono text-[10px] text-black/40">0x-aura-main-v4.2</div>
                       </div>
                       <div className="space-y-1">
                          <div className="text-[8px] font-bold text-black/20 uppercase">L2 Compression</div>
                          <div className="font-mono text-[10px] text-black/40">Active (-12% cost)</div>
                       </div>
                       <div className="space-y-1">
                          <div className="text-[8px] font-bold text-black/20 uppercase">Calldata Hash</div>
                          <div className="font-mono text-[10px] text-black/40 truncate">{entry.action.txHash}</div>
                       </div>
                       <div className="space-y-1">
                          <div className="text-[8px] font-bold text-black/20 uppercase">Proof Validity</div>
                          <div className="font-mono text-[10px] text-brand-safe font-bold">ZK-READY</div>
                       </div>
                    </div>
                 </details>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  </div>
);
};
