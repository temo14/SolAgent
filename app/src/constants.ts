import { AuditLogEntry, AutomationRule } from './types';

export const MOCK_RULES: AutomationRule[] = [
  {
    id: 'rule-1',
    name: 'ETH Yield Optimizer',
    description: 'Auto-harvests AAVE rewards and stakes into Lido.',
    status: 'active',
    lastRun: '12m ago',
    executions: 142,
    profit: '+0.42 ETH',
    limits: {
      maxSpendPerDay: 5000,
      maxFrequencyPerHour: 1,
      executionDelay: 10
    },
    logic: {
      condition: 'AAVE Rewards > 5 && Gas < 30 gwei',
      action: 'Swap AAVE → stETH && Stake'
    }
  },
  {
    id: 'rule-2',
    name: 'Stablecoin Sweep',
    description: 'Moves USDC/USDT excess over $5,000 to Gnosis Safe vault.',
    status: 'active',
    lastRun: '1h ago',
    executions: 8,
    profit: '$0.00',
    limits: {
      maxSpendPerDay: 10000,
      maxFrequencyPerHour: 24,
      executionDelay: 0
    },
    logic: {
      condition: 'Balance(USDC) > $5,000',
      action: 'Transfer excess to 0xCold...'
    }
  }
];

export const MOCK_AUDIT: AuditLogEntry[] = [
  {
    id: 'tx-pending',
    timestamp: 'Just Now',
    ruleName: 'Weekly Stablecoin Harvest',
    trigger: {
      condition: 'Scheduled Event',
      observedValue: 'Friday 12:00 UTC'
    },
    action: {
      label: 'Moving $1,240 to Vault',
      txHash: 'Pending...',
      status: 'pending',
      cancelableUntil: new Date(Date.now() + 1000 * 60 * 12).toISOString() // 12 mins from now
    },
    details: {
      gasUsed: '--',
      slippage: '--',
      route: ['Aave V3', 'Uniswap V3', 'Safe'],
      riskScore: 'low'
    }
  },
  {
    id: 'tx-1',
    timestamp: 'May 01, 2026 • 14:24:02',
    ruleName: 'ETH Yield Optimizer',
    trigger: {
      condition: 'Price(ETH) < $2,200',
      observedValue: '$2,198.42'
    },
    action: {
      label: 'Swap 1,000 USDC for ETH',
      txHash: '0x8f2...a41c',
      status: 'success'
    },
    details: {
      gasUsed: '42,102 gwei',
      slippage: '0.12%',
      route: ['Uniswap V3', '1inch Proxy', 'Aura Vault-1'],
      riskScore: 'low'
    }
  },
  {
    id: 'tx-failed',
    timestamp: '1h ago',
    ruleName: 'DAI Arbitrage',
    trigger: {
      condition: 'Spread > 0.5%',
      observedValue: '0.82% Spread'
    },
    action: {
      label: 'Flash Swap DAI/USDC',
      txHash: '0xcc...de33',
      status: 'failed'
    },
    details: {
      gasUsed: '350,000',
      slippage: '0.8%',
      route: ['Curve', 'Balancer', 'Sushiswap'],
      riskScore: 'med'
    }
  }
];
