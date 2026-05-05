import { motion } from 'motion/react';
import { LucideIcon, AlertCircle } from 'lucide-react';
import { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState = ({ icon: Icon, title, description, actionText, onAction }: EmptyStateProps) => (
  <motion.div 
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    className="flex flex-col items-center justify-center p-12 text-center bg-white rounded-[44px] border border-black/5 min-h-[400px]"
  >
    <div className="w-20 h-20 rounded-full bg-black/5 flex items-center justify-center text-black/20 mb-6">
      <Icon size={40} />
    </div>
    <h3 className="text-xl font-bold mb-2">{title}</h3>
    <p className="text-sm text-black/40 max-w-xs mb-8">{description}</p>
    {actionText && (
      <button 
        onClick={onAction}
        className="px-8 py-3 rounded-2xl bg-brand-ink text-white font-bold text-sm tracking-widest hover:scale-105 transition-all shadow-xl shadow-black/10"
      >
        {actionText}
      </button>
    )}
  </motion.div>
);

export const ErrorBanner = ({ message, onRetry }: { message: string, onRetry: () => void }) => (
  <motion.div 
    initial={{ opacity: 0, y: -20 }}
    animate={{ opacity: 1, y: 0 }}
    className="p-4 bg-brand-stop/5 border border-brand-stop/10 rounded-2xl flex items-center justify-between mb-8"
  >
    <div className="flex items-center gap-3">
      <AlertCircle className="text-brand-stop" size={18} />
      <span className="text-sm font-medium text-brand-stop uppercase tracking-tight font-bold">{message}</span>
    </div>
    <button onClick={onRetry} className="text-[10px] font-extrabold uppercase tracking-widest text-brand-stop hover:underline">Retry</button>
  </motion.div>
);

export const Skeleton = ({ className, ...props }: { className?: string; [key: string]: any }) => (
  <div className={`skeleton ${className}`} {...props} />
);

export const Card = ({ children, className = "" }: { children: ReactNode, className?: string }) => (
  <div className={`bg-white rounded-[44px] border border-black/5 shadow-sm ${className}`}>
    {children}
  </div>
);
