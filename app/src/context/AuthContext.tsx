import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { api, ApiError } from '../lib/api';
import { buildSiwsMessage, uint8ToBase64 } from '../lib/siws';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentWalletInfo {
  id: string;
  pubkey: string;
  label: string | null;
  isActive: boolean;
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
  /**
   * Run the SIWS flow against the currently connected wallet.
   * Call this after the wallet-adapter `connect()` resolves and `publicKey` is set.
   */
  signIn: () => Promise<void>;
  disconnect: () => void;
  clearError: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  // Must be rendered inside WalletProvider.
  const { publicKey, signMessage, disconnect: walletDisconnect } = useWallet();

  const [walletPubkey, setWalletPubkey] = useState<string | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);
  const [agentWallets, setAgentWallets] = useState<AgentWalletInfo[]>([]);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setError('No wallet connected. Please connect a wallet first.');
      return;
    }

    setError(null);
    setIsSigning(true);

    const pubkey = publicKey.toBase58();

    try {
      // ── Step 1: Fetch nonce ─────────────────────────────────────────────────
      const nonceRes = await api.get<{
        ok: boolean;
        data: { nonce: string; issuedAt: string; expiresAt: string };
      }>(`/api/auth/nonce?wallet=${pubkey}`);

      if (!nonceRes.ok) throw new Error('Failed to obtain sign-in nonce.');
      const { nonce, issuedAt, expiresAt } = nonceRes.data;

      // ── Step 2: Build + sign SIWS message ───────────────────────────────────
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

      // ── Step 3: Verify signature → receive JWT ──────────────────────────────
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

      // ── Step 4: Load or auto-create the primary agent wallet ─────────────────
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
    walletDisconnect().catch(() => undefined);
    setWalletPubkey(null);
    setJwt(null);
    setAgentWallets([]);
  }, [walletDisconnect]);

  const clearError = useCallback(() => setError(null), []);

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

async function loadOrCreateAgentWallet(jwt: string): Promise<AgentWalletInfo[]> {
  const listRes = await api.get<{
    ok: boolean;
    data: { wallets: AgentWalletInfo[] };
  }>('/api/agent-wallets', jwt);

  const wallets: AgentWalletInfo[] = listRes.ok ? (listRes.data.wallets ?? []) : [];

  if (wallets.length === 0) {
    try {
      const createRes = await api.post<{ ok: boolean; data: AgentWalletInfo }>(
        '/api/agent-wallets',
        { label: 'Primary Agent' },
        jwt,
      );
      if (createRes.ok) return [createRes.data];
    } catch {
      // non-fatal — user can create manually later
    }
  }

  return wallets;
}
