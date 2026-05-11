const rpc = (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined) ?? '';

export function getNetworkLabel(): string {
  if (rpc.includes('localhost') || rpc.includes('127.0.0.1')) return 'localnet';
  if (rpc.includes('mainnet')) return 'mainnet';
  return 'devnet';
}

export const NETWORK_LABEL = getNetworkLabel();
