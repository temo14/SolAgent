import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
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
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  clearError: () => void;
}

// ─── Wallet type declarations (window.solana injection) ───────────────────────

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      publicKey?: { toBase58(): string };
      connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
      disconnect(): Promise<void>;
      signMessage(
        message: Uint8Array,
        encoding: 'utf8' | 'hex',
      ): Promise<{ signature: Uint8Array }>;
    };
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [walletPubkey, setWalletPubkey] = useState<string | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);
  const [agentWallets, setAgentWallets] = useState<AgentWalletInfo[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    setIsConnecting(true);

    try {
      // ── Step 1: Connect Solana wallet ──────────────────────────────────────
      if (!window.solana) {
        throw new Error('No Solana wallet found. Please install Phantom or Backpack.');
      }
      const { publicKey } = await window.solana.connect();
      const pubkey = publicKey.toBase58();

      // ── Step 2: Fetch nonce from api-gateway ────────────────────────────────
      const nonceRes = await api.get<{
        ok: boolean;
        data: { nonce: string; issuedAt: string; expiresAt: string };
      }>(`/api/auth/nonce?wallet=${pubkey}`);

      if (!nonceRes.ok) throw new Error('Failed to obtain sign-in nonce.');
      const { nonce, issuedAt, expiresAt } = nonceRes.data;

      // ── Step 3: Build and sign SIWS message ─────────────────────────────────
      const message = buildSiwsMessage({
        domain: window.location.host,
        walletPubkey: pubkey,
        nonce,
        issuedAt,
        expiresAt,
      });
      const msgBytes = new TextEncoder().encode(message);
      const { signature } = await window.solana.signMessage(msgBytes, 'utf8');
      const signatureBase64 = uint8ToBase64(signature);

      // ── Step 4: Verify signature, receive JWT ───────────────────────────────
      const verifyRes = await api.post<{
        ok: boolean;
        data: { token: string; walletPubkey: string };
      }>('/api/auth/verify', { walletPubkey: pubkey, signature: signatureBase64, message, nonce });

      if (!verifyRes.ok) throw new Error('Signature verification failed.');
      const { token } = verifyRes.data;

      setWalletPubkey(pubkey);
      setJwt(token);

      // ── Step 5: Load or auto-create the primary agent wallet ────────────────
      const wallets = await loadOrCreateAgentWallet(token);
      setAgentWallets(wallets);
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { message?: string } | null;
        setError(body?.message ?? `Connection error (${err.status})`);
      } else {
        setError(err instanceof Error ? err.message : 'Connection failed');
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    window.solana?.disconnect().catch(() => undefined);
    setWalletPubkey(null);
    setJwt(null);
    setAgentWallets([]);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const primaryAgentWallet = agentWallets.find((w) => w.isActive) ?? agentWallets[0] ?? null;

  return (
    <AuthContext.Provider
      value={{
        walletPubkey,
        jwt,
        agentWallets,
        primaryAgentWallet,
        isConnecting,
        error,
        connect,
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
