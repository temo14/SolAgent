import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { clusterApiUrl } from '@solana/web3.js';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { Buffer } from 'buffer';
import './index.css';

window.Buffer = Buffer;

// Evaluated once at startup — Vite replaces import.meta.env at build time.
const RPC_ENDPOINT =
  (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined) ?? clusterApiUrl('devnet');

/**
 * Provider tree: ConnectionProvider → WalletProvider → AuthProvider
 * AuthProvider must be inside WalletProvider so it can call useWallet().
 * Only Phantom adapter is registered; wallet-standard (Backpack, Solflare, etc.)
 * are auto-discovered by the adapter layer — no extra adapters needed.
 */
function Providers({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Providers>
  </StrictMode>,
);
