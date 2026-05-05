import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { AutomationRule } from '../types';

// ─── Backend shapes ───────────────────────────────────────────────────────────

interface BackendTrigger {
  type: string;
  asset: string;
  threshold: number;
  cron_expression?: string;
}

interface BackendAction {
  type: string;
  from_asset?: string;
  to_asset?: string;
  amount: number;
  recipient?: string;
}

export interface BackendRule {
  id: string;
  rawInput: string;
  parsedRule: { trigger: BackendTrigger; action: BackendAction; conditions: { max_amount_usd: number; max_fires_per_day: number } };
  ruleHash: string;
  status: string;
  firesToday: number;
  maxFiresDay: number;
  maxAmountUsd: string | null;
  createdAt: string;
  activatedAt?: string;
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function describeRule(r: BackendRule): { condition: string; action: string } {
  const t = r.parsedRule.trigger;
  const a = r.parsedRule.action;
  const condition = t
    ? `${t.type.replace(/_/g, ' ')}: ${t.asset} @ ${t.threshold}`
    : r.rawInput.slice(0, 60);
  const action = a
    ? `${a.type}${a.from_asset ? ` ${a.amount} ${a.from_asset}` : ''}${a.to_asset ? ` → ${a.to_asset}` : ''}${a.recipient ? ` → ${a.recipient.slice(0, 8)}…` : ''}`
    : 'Action';
  return { condition, action };
}

export function mapBackendRule(r: BackendRule): AutomationRule {
  const { condition, action } = describeRule(r);
  const t = r.parsedRule.trigger;
  const name = t
    ? `${t.asset} ${t.type.replace(/_/g, ' ')}`
    : 'Automation Rule';

  return {
    id: r.id,
    name,
    description: r.rawInput,
    status: r.status === 'ACTIVE' ? 'active' : 'inactive',
    lastRun: r.activatedAt
      ? new Date(r.activatedAt).toLocaleDateString()
      : 'Never',
    executions: r.firesToday ?? 0,
    limits: {
      maxSpendPerDay: r.maxAmountUsd ? Math.round(Number(r.maxAmountUsd)) : 1000,
      maxFiresDay: r.maxFiresDay ?? 10,
    },
    logic: { condition, action },
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRules() {
  const { jwt } = useAuth();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const fetchRules = useCallback(async () => {
    if (!jwt) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<{ ok: boolean; data: { rules: BackendRule[] } }>(
        '/api/rules',
        jwt,
      );
      if (res.ok) setRules((res.data.rules ?? []).map(mapBackendRule));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules');
    } finally {
      setIsLoading(false);
    }
  }, [jwt]);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  /**
   * Sends the NL input to rule-engine (which calls QVAC).
   * Returns the raw backend rule (still PENDING_ACTIVATION).
   */
  const createRule = useCallback(
    async (rawInput: string, agentWalletId: string): Promise<BackendRule | null> => {
      if (!jwt) return null;
      const clientTimezone =
        typeof Intl !== 'undefined'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined;
      try {
        const res = await api.post<{ ok: boolean; data: BackendRule }>(
          '/api/rules',
          {
            rawInput,
            agentWalletId,
            ...(clientTimezone !== undefined ? { clientTimezone } : {}),
          },
          jwt,
        );
        return res.ok ? res.data : null;
      } catch (err) {
        if (err instanceof ApiError) {
          const body = err.body as { message?: string; errorCode?: string } | null;
          throw new Error(
            body?.message ?? `Rule service unavailable (${String(err.status)}).`,
          );
        }
        throw new Error(err instanceof Error ? err.message : 'Could not reach rule service.');
      }
    },
    [jwt],
  );

  /** Activates a PENDING_ACTIVATION rule so the agent starts monitoring it. */
  const activateRule = useCallback(
    async (ruleId: string): Promise<boolean> => {
      if (!jwt) return false;
      try {
        const res = await api.patch<{ ok: boolean }>(
          `/api/rules/${ruleId}/status`,
          { status: 'ACTIVE' },
          jwt,
        );
        if (res.ok) await fetchRules();
        return res.ok;
      } catch {
        return false;
      }
    },
    [jwt, fetchRules],
  );

  const deleteRule = useCallback(
    async (ruleId: string): Promise<void> => {
      if (!jwt) return;
      try {
        await api.del(`/api/rules/${ruleId}`, jwt);
        setRules((prev) => prev.filter((r) => r.id !== ruleId));
      } catch (err) {
        console.error('Failed to delete rule:', err);
      }
    },
    [jwt],
  );

  /** Emergency stop: pauses all currently active rules. */
  const pauseAllRules = useCallback(async (): Promise<void> => {
    if (!jwt) return;
    const active = rulesRef.current.filter((r) => r.status === 'active');
    await Promise.all(
      active.map((r) =>
        api
          .patch(`/api/rules/${r.id}/status`, { status: 'PAUSED' }, jwt)
          .catch(() => undefined),
      ),
    );
    setRules((prev) => prev.map((r) => ({ ...r, status: 'inactive' as const })));
  }, [jwt]);

  /** Resumes all paused rules. */
  const resumeAllRules = useCallback(async (): Promise<void> => {
    if (!jwt) return;
    const paused = rulesRef.current.filter((r) => r.status === 'inactive');
    await Promise.all(
      paused.map((r) =>
        api
          .patch(`/api/rules/${r.id}/status`, { status: 'ACTIVE' }, jwt)
          .catch(() => undefined),
      ),
    );
    setRules((prev) => prev.map((r) => ({ ...r, status: 'active' as const })));
  }, [jwt]);

  return {
    rules,
    isLoading,
    error,
    fetchRules,
    createRule,
    activateRule,
    deleteRule,
    pauseAllRules,
    resumeAllRules,
  };
}
