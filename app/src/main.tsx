import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { WalletConnectWalletAdapter } from '@solana/wallet-adapter-walletconnect';
import { WalletAdapterNetwork, type Adapter } from '@solana/wallet-adapter-base';
import { clusterApiUrl } from '@solana/web3.js';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import './index.css';

// Module-level constants — evaluated once at startup (Vite replaces import.meta.env at build time).
const RPC_ENDPOINT =
  (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined) ?? clusterApiUrl('devnet');
/** Trim so trailing newline / spaces from .env do not break WalletConnect pairing. */
const WC_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim();

/** HTTPS icon required by WalletConnect / Reown — http://localhost/favicon.ico often 404s or fails validation and breaks the QR URI. */
const WC_METADATA_ICON = 'https://solana.com/favicon.ico';

/**
 * Wallet-adapter provider tree.
 * Order: ConnectionProvider → WalletProvider → AuthProvider
 * AuthProvider must be inside WalletProvider so it can call useWallet().
 */
function Providers({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => {
    const adapters: Adapter[] = [new PhantomWalletAdapter()];

    if (WC_PROJECT_ID && WC_PROJECT_ID.length > 0) {
      adapters.push(
        new WalletConnectWalletAdapter({
          network: WalletAdapterNetwork.Devnet,
          options: {
            projectId: WC_PROJECT_ID,
            metadata: {
              name: 'SolAgent',
              description: 'Verifiable AI wallet agent on Solana',
              // Reown validates metadata; localhost http URLs for icons often break the wc: URI (phone shows "no usable data").
              url: window.location.origin,
              icons: [WC_METADATA_ICON],
            },
          },
        }),
      );
    }

    return adapters;
    // Adapters are recreated only when the WC project ID changes — which never happens at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
