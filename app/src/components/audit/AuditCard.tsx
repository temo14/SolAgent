import { motion, AnimatePresence } from 'motion/react';
import { Fingerprint, ExternalLink, Layers, Cpu, CheckCircle2, XCircle, RotateCcw, Clock, AlertTriangle } from 'lucide-react';
import { AuditLogEntry } from '../../types';
import { useState, useEffect } from 'react';

interface AuditCardProps {
  key?: string;
  entry: AuditLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

const CLUSTER = import.meta.env.MODE === 'mainnet' ? '' : '?cluster=devnet';

function explorerUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}${CLUSTER}`;
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
            <span className="text-[10px] font-bold text-black/20 uppercase tracking-widest">{entry.timestamp}</span>
            <h3 className="text-2xl font-bold mt-1">{entry.ruleName}</h3>
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
              {isExpanded ? 'Hide Details' : 'Show Details'}
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
            <div className="text-[10px] font-bold text-black/20 uppercase tracking-widest mb-4">Trigger</div>
            <div className="space-y-2">
              <div className="text-xs font-bold text-black/40">{entry.trigger.condition}</div>
              <div className="text-3xl font-bold font-mono text-brand-wait">{entry.trigger.observedValue}</div>
            </div>
          </div>

          <div className={`p-8 rounded-[32px] text-white shadow-2xl relative overflow-hidden ${entry.action.status === 'success' ? 'bg-brand-ink' : entry.action.status === 'pending' ? 'bg-blue-600' : entry.action.status === 'retrying' ? 'bg-brand-wait' : 'bg-brand-stop'}`}>
            <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-4">Result</div>
            <div className="space-y-1">
              <div className="text-2xl font-bold leading-tight mb-2">{entry.action.label}</div>
              {entry.action.status === 'failed' && (
                <div className="mt-4 flex items-center gap-2 text-white text-[10px] font-extrabold uppercase tracking-widest">
                  <AlertTriangle size={14} /> Execution failed
                </div>
              )}
              {entry.action.status === 'retrying' && (
                <div className="mt-4 flex items-center gap-2 text-white/60 text-[10px] font-extrabold uppercase tracking-widest">
                  <RotateCcw size={14} className="animate-spin" /> Retrying…
                </div>
              )}
              {entry.action.status === 'success' && entry.action.txSignatureFull && (
                <a
                  href={explorerUrl(entry.action.txSignatureFull)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-brand-safe text-[10px] font-extrabold uppercase tracking-widest hover:underline mt-2"
                >
                  View on Explorer <ExternalLink size={10} />
                </a>
              )}
              {entry.action.status === 'success' && !entry.action.txSignatureFull && (
                <div className="text-white/40 text-[10px] font-mono mt-2">{entry.action.txHash}</div>
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
              <div className="mt-10 pt-10 border-t border-black/5">
                <div className="flex items-center justify-between mb-6">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-black/40">Execution Details</h4>
                  <div className="h-px flex-1 bg-black/5 mx-4" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-black/20 uppercase tracking-widest">
                      <Layers size={14} /> Price Sources
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {entry.details.priceSources.length > 0
                        ? entry.details.priceSources.map((src, i) => (
                          <span key={i} className="px-2 py-1 bg-black/5 rounded text-[10px] font-bold text-black/60">
                            {src}
                          </span>
                        ))
                        : <span className="text-[10px] text-black/30">–</span>
                      }
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-black/20 uppercase tracking-widest">
                      <Cpu size={14} /> Execution
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-black/40 font-medium">Oracle Price</span>
                        <span className="font-bold">{entry.details.oraclePrice}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-black/40 font-medium">Network Fees</span>
                        <span className="font-bold">{entry.details.gasUsed}</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-black/20 uppercase tracking-widest">
                      <CheckCircle2 size={14} /> Risk
                    </div>
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${entry.details.riskScore === 'low' ? 'bg-brand-safe/10 text-brand-safe' : 'bg-brand-wait/10 text-brand-wait'}`}>
                      {entry.details.riskScore === 'low' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                      {entry.details.riskScore === 'low' ? 'Normal' : 'Anomalous'}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
