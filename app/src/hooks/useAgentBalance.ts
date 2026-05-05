import { useState, useEffect, useCallback } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

export interface AgentBalance {
  sol: number | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAgentBalance(pubkey: string | null): AgentBalance {
  const { connection } = useConnection();
  const [sol, setSol] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!pubkey) {
      setSol(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const pk = new PublicKey(pubkey);
      const lamports = await connection.getBalance(pk);
      setSol(lamports / LAMPORTS_PER_SOL);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch balance');
      setSol(null);
    } finally {
      setIsLoading(false);
    }
  }, [pubkey, connection]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { sol, isLoading, error, refetch };
}
