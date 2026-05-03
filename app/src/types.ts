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
  profit: string;
  limits?: {
    maxSpendPerDay: number;
    maxFrequencyPerHour: number;
    executionDelay: number; // in minutes
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
    status: 'success' | 'failed' | 'retrying' | 'pending';
    cancelableUntil?: string; // ISO timestamp
  };
  details: {
    gasUsed: string;
    slippage: string;
    route: string[];
    riskScore: 'low' | 'med';
  };
}
