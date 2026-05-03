import { ShieldCheck, CheckCircle2, X } from 'lucide-react';

interface PermissionGuardProps {
  authorized: string[];
  prohibited: string[];
}

export const PermissionGuard = ({ authorized, prohibited }: PermissionGuardProps) => (
  <div className="space-y-6">
    <div>
      <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-4">Authorized Actions</p>
      <ul className="space-y-3">
        {authorized.map((item, i) => (
          <li key={i} className="flex items-center gap-3 text-[13px] font-medium text-white/80">
            <CheckCircle2 size={16} className="text-brand-safe" /> {item}
          </li>
        ))}
      </ul>
    </div>

    <div className="pt-6 border-t border-white/10">
      <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-4">Strictly Prohibited</p>
      <ul className="space-y-3">
        {prohibited.map((item, i) => (
          <li key={i} className="flex items-center gap-3 text-[13px] font-medium text-white/40">
            <X size={16} className="text-brand-stop" /> {item}
          </li>
        ))}
      </ul>
    </div>
  </div>
);
