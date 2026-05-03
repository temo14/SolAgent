import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { AuditLogEntry } from '../types';

// ─── Backend shapes ───────────────────────────────────────────────────────────

interface MemoTrig {
  type: string;
  asset: string;
  threshold: number;
  observed: number;
  slot: number;
}

interface MemoAct {
  type: string;
  from?: string;
  to?: string;
  amount: number;
  price_src: string;
  price_used?: number;
}

interface BackendAuditEvent {
  id: string;
  txSignature?: string;
  ruleId?: string;
  eventType: string;
  payload: { trig?: MemoTrig; act?: MemoAct; v?: number } | null;
  isAnomalous: boolean;
  createdAt: string;
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function mapAuditEvent(ev: BackendAuditEvent): AuditLogEntry {
  const memo = ev.payload;
  const act = memo?.act;
  const trig = memo?.trig;

  const sig = ev.txSignature;
  const shortSig = sig ? `${sig.slice(0, 6)}…${sig.slice(-4)}` : '–';

  const actionLabel = act
    ? `${act.type}: ${act.amount} ${act.from ?? ''} ${act.to ? `→ ${act.to}` : ''}`.trim()
    : ev.eventType.replace(/_/g, ' ').toLowerCase();

  return {
    id: ev.id,
    timestamp: new Date(ev.createdAt).toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    ruleName: ev.ruleId ? `Rule ${ev.ruleId.slice(0, 8)}` : 'System Event',
    trigger: {
      condition: trig ? `${trig.type.replace(/_/g, ' ')}: ${trig.asset}` : 'Unknown',
      observedValue: trig ? String(trig.observed) : '–',
    },
    action: {
      label: actionLabel,
      txHash: shortSig,
      status:
        ev.eventType === 'EXECUTION_CONFIRMED'
          ? 'success'
          : ev.eventType === 'CIRCUIT_BREAKER_HALT'
            ? 'failed'
            : 'pending',
    },
    details: {
      gasUsed: '–',
      slippage: act?.price_used ? `$${act.price_used.toFixed(4)}` : '–',
      route: act?.price_src ? [act.price_src] : ['–'],
      riskScore: ev.isAnomalous ? 'med' : 'low',
    },
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAudit(walletPubkey: string | null) {
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchAudit = useCallback(async () => {
    if (!walletPubkey) return;
    setIsLoading(true);
    try {
      const res = await api.get<{ events: BackendAuditEvent[]; total: number }>(
        `/api/audit/${walletPubkey}?limit=50`,
      );
      setAuditLog((res.events ?? []).map(mapAuditEvent));
    } catch {
      // audit trail is not critical — fail silently
    } finally {
      setIsLoading(false);
    }
  }, [walletPubkey]);

  useEffect(() => {
    void fetchAudit();
  }, [fetchAudit]);

  /** Prepends a live SSE-delivered result to the top of the audit log. */
  const prependLiveEntry = useCallback((ev: BackendAuditEvent) => {
    setAuditLog((prev) => [mapAuditEvent(ev), ...prev]);
  }, []);

  return { auditLog, isLoading, prependLiveEntry, fetchAudit };
}
