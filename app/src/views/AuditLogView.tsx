import { motion } from 'motion/react';
import { Fingerprint } from 'lucide-react';
import { AuditLogEntry } from '../types';
import { AuditCard } from '../components/audit/AuditCard';
import { EmptyState, Skeleton } from '../components/ui';
import { useState } from 'react';

interface AuditLogViewProps {
  key?: string;
  auditLog: AuditLogEntry[];
  isLoading?: boolean;
}

export const AuditLogView = ({ auditLog, isLoading }: AuditLogViewProps) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mx-auto">
      <div className="mb-16 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 text-brand-safe text-xs font-bold uppercase tracking-widest mb-2">
            <Fingerprint size={14} /> Security Verified
          </div>
          <h1 className="text-5xl font-semibold tracking-tight text-brand-ink">Activity History</h1>
          <p className="text-black/40 text-xl font-medium mt-2">Every automatic action is recorded with the exact reason it was triggered.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-8">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-[44px]" />)}
        </div>
      ) : auditLog.length === 0 ? (
        <EmptyState
           icon={Fingerprint}
           title="No History Found"
           description="Your wallet is currently in a state of rest. Actions will appear here as rules trigger."
        />
      ) : (
        <div className="relative pl-8 md:pl-20">
          <div className="absolute left-[3px] md:left-[23px] top-0 bottom-0 w-px bg-black/5 border-dashed border-l" />
          <div className="space-y-12">
            {auditLog.map((entry) => (
              <AuditCard
                key={entry.id}
                entry={entry}
                isExpanded={expandedId === entry.id}
                onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};
