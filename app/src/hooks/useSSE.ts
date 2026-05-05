import { useEffect, useRef } from 'react';

export interface ExecResult {
  ruleId: string;
  walletPubkey: string;
  idempotencyKey: string;
  status: string;
  txSignature?: string;
  memoProof?: unknown;
  errorCode?: string;
  timestamp: string;
}

/**
 * Subscribes to the api-gateway SSE endpoint `/ws/activity?token=<jwt>`
 * and calls `onResult` for every execution result delivered.
 *
 * The EventSource auto-reconnects on network errors.
 * Calling the effect cleanup closes the connection.
 */
export function useSSE(jwt: string | null, onResult: (result: ExecResult) => void): void {
  // Keep onResult stable so the effect doesn't restart on every render.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    if (!jwt) return;

    const es = new EventSource(`/ws/activity?token=${encodeURIComponent(jwt)}`);

    es.onmessage = (e) => {
      try {
        // Gateway wraps every event: { type: 'exec_result' | 'connected', data: ExecResult }
        const frame = JSON.parse(e.data as string) as { type: string; data?: ExecResult };
        if (frame.type === 'exec_result' && frame.data) {
          onResultRef.current(frame.data);
        }
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      // EventSource reconnects automatically; no action needed here.
    };

    return () => {
      es.close();
    };
  }, [jwt]);
}
