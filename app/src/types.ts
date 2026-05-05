export enum AgentStatus {
  ACTIVE = 'active',
  PAUSED = 'paused'
}

export type AppView = 'dashboard' | 'create-rule' | 'rules-list' | 'audit-log';

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'inactive';
  lastRun: string;
  executions: number;
  limits?: {
    maxSpendPerDay: number;
    maxFiresDay: number;
  };
  logic: {
    condition: string;
    action: string;
  };
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  ruleName: string;
  trigger: {
    condition: string;
    observedValue: string;
  };
  action: {
    label: string;
    txHash: string;
    /** Full transaction signature (base58) — for explorer links */
    txSignatureFull?: string;
    status: 'success' | 'failed' | 'retrying' | 'pending';
    cancelableUntil?: string;
  };
  details: {
    gasUsed: string;
    /** Oracle price used at execution time */
    oraclePrice: string;
    /** Price feed source (e.g. Jupiter, Pyth) */
    priceSources: string[];
    riskScore: 'low' | 'med';
  };
}
