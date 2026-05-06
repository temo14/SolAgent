import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { api, ApiError } from '../lib/api';
import { buildSiwsMessage, uint8ToBase64 } from '../lib/siws';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentWalletInfo {
  id: string;
  /** User's own wallet (Phantom). Used for mandate PDA derivation. */
  ownerPubkey: string;
  /** Archon agent wallet. Fund this address with SOL/tokens. */
  delegatePubkey: string;
  isActive: boolean;
  mandatePda?: string | null;
}

export interface AuthState {
  walletPubkey: string | null;
  /** JWT stored in memory only — never in localStorage. */
  jwt: string | null;
  agentWallets: AgentWalletInfo[];
  /** The first active agent wallet (used as the default for rule creation). */
  primaryAgentWallet: AgentWalletInfo | null;
  /** True while the SIWS + JWT exchange is in progress. */
  isSigning: boolean;
  error: string | null;
  refreshAgentWallets: () => Promise<void>;
  signIn: () => Promise<void>;
  disconnect: () => void;
  clearError: () => void;
}

// ─── Dev bypass ───────────────────────────────────────────────────────────────

const DEV_WALLET = (import.meta.env.VITE_DEV_WALLET as string | undefined)?.trim();
const IS_DEV_BYPASS = Boolean(DEV_WALLET && import.meta.env.DEV);

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, disconnect: walletDisconnect } = useWallet();

  const [walletPubkey, setWalletPubkey] = useState<string | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);
  const [agentWallets, setAgentWallets] = useState<AgentWalletInfo[]>([]);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const devBypassStarted = useRef(false);
  const devBypassLoggedOut = useRef(false);

  useEffect(() => {
    if (!IS_DEV_BYPASS || jwt) return;
    if (devBypassStarted.current) return;
    if (devBypassLoggedOut.current) return;
    devBypassStarted.current = true;

    void (async () => {
      setError(null);
      setIsSigning(true);
      try {
        const nonceRes = await api.get<{
          ok: boolean;
          data: { nonce: string; issuedAt: string; expiresAt: string };
        }>(`/api/auth/nonce?wallet=${encodeURIComponent(DEV_WALLET!)}`);

        if (!nonceRes.ok) throw new Error('Dev bypass: nonce failed');
        const { nonce, issuedAt, expiresAt } = nonceRes.data;

        const verifyRes = await api.post<{
          ok: boolean;
          data: { token: string; walletPubkey: string };
        }>('/api/auth/dev-bypass', {
          walletPubkey: DEV_WALLET,
          nonce,
          issuedAt,
          expiresAt,
        });

        if (!verifyRes.ok) throw new Error('Dev bypass: verify failed');
        const { token } = verifyRes.data;

        setWalletPubkey(DEV_WALLET!);
        setJwt(token);

        const wallets = await loadOrCreateAgentWallet(token);
        setAgentWallets(wallets);
      } catch (err) {
        devBypassStarted.current = false;
        if (err instanceof ApiError) {
          const body = err.body as { message?: string } | null;
          setError(body?.message ?? `Dev bypass error (${err.status})`);
        } else {
          setError(err instanceof Error ? err.message : 'Dev bypass failed');
        }
      } finally {
        setIsSigning(false);
      }
    })();
  }, [jwt]);

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setError('No wallet connected. Please connect a wallet first.');
      return;
    }

    setError(null);
    setIsSigning(true);

    const pubkey = publicKey.toBase58();

    try {
      const nonceRes = await api.get<{
        ok: boolean;
        data: { nonce: string; issuedAt: string; expiresAt: string };
      }>(`/api/auth/nonce?wallet=${encodeURIComponent(pubkey)}`);

      if (!nonceRes.ok) throw new Error('Failed to obtain sign-in nonce.');
      const { nonce, issuedAt, expiresAt } = nonceRes.data;

      const message = buildSiwsMessage({
        domain: window.location.host,
        walletPubkey: pubkey,
        nonce,
        issuedAt,
        expiresAt,
      });
      const msgBytes = new TextEncoder().encode(message);
      const signature = await signMessage(msgBytes);
      const signatureBase64 = uint8ToBase64(signature);

      const verifyRes = await api.post<{
        ok: boolean;
        data: { token: string; walletPubkey: string };
      }>('/api/auth/verify', {
        walletPubkey: pubkey,
        signature: signatureBase64,
        message,
        nonce,
      });

      if (!verifyRes.ok) throw new Error('Signature verification failed.');
      const { token } = verifyRes.data;

      setWalletPubkey(pubkey);
      setJwt(token);

      const wallets = await loadOrCreateAgentWallet(token);
      setAgentWallets(wallets);
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { message?: string } | null;
        setError(body?.message ?? `Sign-in error (${err.status})`);
      } else {
        setError(err instanceof Error ? err.message : 'Sign-in failed');
      }
    } finally {
      setIsSigning(false);
    }
  }, [publicKey, signMessage]);

  const disconnect = useCallback(() => {
    if (!IS_DEV_BYPASS) {
      walletDisconnect().catch(() => undefined);
    } else {
      devBypassStarted.current = false;
      devBypassLoggedOut.current = true;
    }
    setWalletPubkey(null);
    setJwt(null);
    setAgentWallets([]);
  }, [walletDisconnect]);

  const clearError = useCallback(() => setError(null), []);

  const refreshAgentWallets = useCallback(async () => {
    if (!jwt) return;
    const wallets = await loadOrCreateAgentWallet(jwt);
    setAgentWallets(wallets);
  }, [jwt]);

  const primaryAgentWallet = agentWallets.find((w) => w.isActive) ?? agentWallets[0] ?? null;

  return (
    <AuthContext.Provider
      value={{
        walletPubkey,
        jwt,
        agentWallets,
        primaryAgentWallet,
        isSigning,
        error,
        signIn,
        disconnect,
        clearError,
        refreshAgentWallets,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeAgentWallets(data: unknown): AgentWalletInfo[] {
  if (!data) return [];
  const raw = Array.isArray(data) ? data : (data as { wallets?: unknown }).wallets;
  if (!Array.isArray(raw)) return [];

  return raw.map((item) => {
    const w = item as {
      id: string;
      ownerPubkey: string;
      delegatePubkey: string;
      isActive?: boolean;
      mandatePda?: string | null;
    };
    return {
      id: w.id,
      ownerPubkey: w.ownerPubkey ?? '',
      delegatePubkey: w.delegatePubkey ?? '',
      isActive: w.isActive ?? true,
      mandatePda: w.mandatePda ?? null,
    };
  });
}

async function loadOrCreateAgentWallet(jwt: string): Promise<AgentWalletInfo[]> {
  const listRes = await api.get<{
    ok: boolean;
    data: AgentWalletInfo[] | { wallets: AgentWalletInfo[] };
  }>('/api/agent-wallets', jwt);

  const wallets: AgentWalletInfo[] = listRes.ok ? normalizeAgentWallets(listRes.data) : [];

  if (wallets.length === 0) {
    try {
      const createRes = await api.post<{ ok: boolean; data: AgentWalletInfo }>(
        '/api/agent-wallets',
        {},
        jwt,
      );
      if (createRes.ok) {
        const d = createRes.data;
        return [
          {
            id: d.id,
            ownerPubkey: d.ownerPubkey ?? '',
            delegatePubkey: d.delegatePubkey ?? '',
            isActive: d.isActive,
            mandatePda: d.mandatePda ?? null,
          },
        ];
      }
    } catch {
      // non-fatal — user can create manually later
    }
  }

  return wallets;
}
