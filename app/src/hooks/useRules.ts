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
  until_local_hour?: number;
  until_utc_hour?: number;
  schedule_timezone?: string;
}

interface BackendAction {
  type: string;
  from_asset?: string;
  to_asset?: string;
  amount: number;
  recipient?: string;
  max_slippage_bps?: number;
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
  pauseReason?: string | null;
  executions?: { errorCode: string | null; errorDetail: string | null }[];
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function describeCronSchedule(expr: string, untilLocal?: number, untilUtc?: number): string {
  if (!expr) return 'On a schedule';
  let p = expr.trim().split(/\s+/);
  if (p.length === 6) p = p.slice(1);
  if (p.length !== 5) return `Cron: ${expr}`;
  const [min, hour, , , dow] = p;
  let base: string;
  if (expr.trim() === '* * * * *') base = 'Every minute';
  else if (min === '0' && hour === '*') base = 'Every hour';
  else if (dow !== '*') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[parseInt(dow, 10)] ?? `day ${dow}`;
    if (min !== '*' && hour !== '*')
      base = `Every ${dayName} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`;
    else base = `Every ${dayName}`;
  } else if (min !== '*' && hour !== '*') {
    base = `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`;
  } else {
    base = `Cron: ${expr}`;
  }
  if (untilLocal !== undefined) base += ` until ${untilLocal}:00 local`;
  else if (untilUtc !== undefined) base += ` until ${untilUtc}:00 UTC`;
  return base;
}

function ruleNameFromTrigger(t: BackendTrigger | undefined, rawInput: string): string {
  if (!t) return rawInput.length > 35 ? rawInput.slice(0, 35) + '…' : rawInput;
  const asset = t.asset.length > 8 ? t.asset.slice(0, 6) + '…' : t.asset;
  switch (t.type) {
    case 'price_below': return `${asset} below $${t.threshold.toLocaleString()}`;
    case 'price_above': return `${asset} above $${t.threshold.toLocaleString()}`;
    case 'balance_below': return `${asset} balance guard`;
    case 'balance_above': return `${asset} balance guard`;
    case 'time_cron': {
      const expr = t.cron_expression ?? '';
      const parts = expr.trim().split(/\s+/);
      const norm = parts.length === 6 ? parts.slice(1) : parts;
      if (norm.length === 5) {
        if (norm[0] === '*' && norm[1] === '*') return `${asset} every minute`;
        if (norm[0] === '0' && norm[1] === '*') return `${asset} every hour`;
        const dowField = norm[4];
        if (dowField !== '*') {
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          return `${asset} every ${days[parseInt(dowField, 10)] ?? 'week'}`;
        }
        if (norm[0] !== '*' && norm[1] !== '*')
          return `${asset} daily ${norm[1].padStart(2, '0')}:${norm[0].padStart(2, '0')} UTC`;
      }
      return `${asset} scheduled`;
    }
    case 'outflow_exceeded': return `${asset} outflow guard`;
    default: return `${asset} ${t.type.replace(/_/g, ' ')}`;
  }
}

function describeRule(r: BackendRule): { condition: string; action: string } {
  const t = r.parsedRule?.trigger;
  const a = r.parsedRule?.action;

  let condition: string;
  if (!t) {
    condition = r.rawInput.slice(0, 60);
  } else {
    const asset = t.asset.length > 20 ? `${t.asset.slice(0, 8)}…` : t.asset;
    switch (t.type) {
      case 'price_below':
        condition = `When ${asset} price falls below $${t.threshold.toLocaleString()}`;
        break;
      case 'price_above':
        condition = `When ${asset} price rises above $${t.threshold.toLocaleString()}`;
        break;
      case 'balance_below':
        condition = `When ${asset} balance drops below ${t.threshold}`;
        break;
      case 'balance_above':
        condition = `When ${asset} balance rises above ${t.threshold}`;
        break;
      case 'time_cron':
        condition = describeCronSchedule(t.cron_expression ?? '', t.until_local_hour, t.until_utc_hour);
        break;
      case 'outflow_exceeded':
        condition = `When total outflow exceeds $${t.threshold.toLocaleString()}`;
        break;
      default:
        condition = `${t.type.replace(/_/g, ' ')}: ${asset}`;
    }
  }

  let action: string;
  if (!a) {
    action = 'Action';
  } else {
    const fallbackAsset = t?.asset ?? 'SOL';
    switch (a.type) {
      case 'swap':
        action = `Swap ${a.amount} ${a.from_asset ?? fallbackAsset} → ${a.to_asset ?? '?'}`;
        break;
      case 'transfer': {
        const dest = a.recipient ? `${a.recipient.slice(0, 8)}…` : 'recipient';
        action = `Transfer ${a.amount} ${a.from_asset ?? 'SOL'} to ${dest}`;
        break;
      }
      case 'alert_only':
        action = 'Alert only — no transaction';
        break;
      case 'pause_all':
        action = 'Pause all active rules';
        break;
      default:
        action = a.type;
    }
  }

  return { condition, action };
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  EXEC_INSUFFICIENT_FUNDS: 'Agent wallet has no SOL to pay for the transaction.',
  EXEC_TIMEOUT: 'Transaction timed out before it was confirmed on-chain.',
  EXEC_PRICE_DEVIATION: 'Price moved too far from the oracle — execution aborted to protect you.',
  EXEC_SIMULATION_FAIL: 'Transaction simulation failed — the on-chain program rejected it.',
  MANDATE_NOT_FOUND: 'Spending limits account not found on-chain. Re-set your limits.',
  MANDATE_REVOKED: 'Spending limits were revoked on-chain.',
  MANDATE_CHECK_FAILED: 'Could not verify spending limits — RPC connection issue.',
};

function describeFailure(executions: BackendRule['executions']): string | undefined {
  const last = executions?.[0];
  if (!last) return undefined;
  const known = last.errorCode ? ERROR_CODE_MESSAGES[last.errorCode] : undefined;
  return known ?? last.errorDetail ?? last.errorCode ?? undefined;
}

export function mapBackendRule(r: BackendRule): AutomationRule {
  const { condition, action } = describeRule(r);
  const t = r.parsedRule?.trigger;
  const name = ruleNameFromTrigger(t, r.rawInput);

  const status =
    r.status === 'ACTIVE' ? 'active' :
    r.status === 'PAUSED_CIRCUIT_BREAKER' ? 'circuit_breaker' :
    'inactive';

  // Show last failure reason on circuit_breaker rules AND on active rules that have a recent failure
  const lastFailureReason =
    r.status === 'PAUSED_CIRCUIT_BREAKER' || (r.executions && r.executions.length > 0)
      ? describeFailure(r.executions)
      : undefined;

  return {
    id: r.id,
    name,
    description: r.rawInput,
    status,
    lastFailureReason,
    lastRun: r.createdAt
      ? new Date(r.createdAt).toLocaleDateString()
      : 'Never',
    executions: r.firesToday ?? 0,
    limits: {
      maxSpendPerExec: r.maxAmountUsd ? Math.round(Number(r.maxAmountUsd)) : 1000,
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
   * Parse-only: sends the NL input to QVAC and returns the structured preview.
   * Does NOT save anything to the database.
   */
  const parseRule = useCallback(
    async (rawInput: string): Promise<BackendRule['parsedRule'] | null> => {
      if (!jwt) return null;
      try {
        const res = await api.post<{ ok: boolean; data: { parsedRule: BackendRule['parsedRule'] } }>(
          '/api/rules/parse',
          { rawInput },
          jwt,
        );
        return res.ok ? res.data.parsedRule : null;
      } catch (err) {
        if (err instanceof ApiError) {
          const body = err.body as { message?: string; errorCode?: string } | null;
          throw new Error(body?.message ?? `Rule service unavailable (${String(err.status)}).`);
        }
        throw new Error(err instanceof Error ? err.message : 'Could not reach rule service.');
      }
    },
    [jwt],
  );

  /**
   * Creates a rule (PENDING_ACTIVATION) then immediately activates it.
   * Call this only after the user has confirmed the parsed preview.
   */
  const createRule = useCallback(
    async (
      rawInput: string,
      agentWalletId: string,
      opts?: { maxAmountUsd?: number; maxFiresPerDay?: number },
      parsedRule?: BackendRule['parsedRule'],
    ): Promise<BackendRule | null> => {
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
            ...(opts?.maxAmountUsd !== undefined ? { maxAmountUsd: opts.maxAmountUsd } : {}),
            ...(opts?.maxFiresPerDay !== undefined ? { maxFiresPerDay: opts.maxFiresPerDay } : {}),
            ...(parsedRule !== undefined ? { parsedRule } : {}),
          },
          jwt,
        );
        return res.ok ? res.data : null;
      } catch (err) {
        if (err instanceof ApiError) {
          const body = err.body as { message?: string; errorCode?: string } | null;
          throw new Error(body?.message ?? `Rule service unavailable (${String(err.status)}).`);
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
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
        // 404 means already gone — fall through to remove from local state
      }
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    },
    [jwt],
  );

  /** Reactivates a PAUSED_CIRCUIT_BREAKER rule: clears to PAUSED first, then sets ACTIVE. */
  const reactivateRule = useCallback(
    async (ruleId: string): Promise<boolean> => {
      if (!jwt) return false;
      try {
        await api.patch(`/api/rules/${ruleId}/status`, { status: 'PAUSED' }, jwt);
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

  /** Emergency stop: pauses all currently active rules. Re-fetches to reflect true backend state. */
  const pauseAllRules = useCallback(async (): Promise<void> => {
    if (!jwt) return;
    const active = rulesRef.current.filter((r) => r.status === 'active');
    await Promise.allSettled(
      active.map((r) =>
        api.patch(`/api/rules/${r.id}/status`, { status: 'PAUSED' }, jwt),
      ),
    );
    await fetchRules();
  }, [jwt, fetchRules]);

  /** Resumes all normally-paused rules. Skips circuit_breaker rules — those require manual review. */
  const resumeAllRules = useCallback(async (): Promise<void> => {
    if (!jwt) return;
    const paused = rulesRef.current.filter((r) => r.status === 'inactive');
    await Promise.allSettled(
      paused.map((r) =>
        api.patch(`/api/rules/${r.id}/status`, { status: 'ACTIVE' }, jwt),
      ),
    );
    await fetchRules();
  }, [jwt, fetchRules]);

  return {
    rules,
    isLoading,
    error,
    fetchRules,
    parseRule,
    createRule,
    activateRule,
    reactivateRule,
    deleteRule,
    pauseAllRules,
    resumeAllRules,
  };
}
