import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    hmr: process.env.DISABLE_HMR !== 'true',
    proxy: {
      // More-specific prefixes must come before the catch-all /api
      '/api/rules': {
        target: 'http://localhost:4001',
        rewrite: (p) => p.replace(/^\/api/, ''),
        changeOrigin: true,
      },
      '/api/audit': {
        target: 'http://localhost:4005',
        rewrite: (p) => p.replace(/^\/api/, ''),
        changeOrigin: true,
      },
      // SSE — no /api prefix in the actual URL, proxied as-is to api-gateway
      '/ws': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Catch-all: auth, agent-wallets, and anything else → api-gateway
      '/api': {
        target: 'http://localhost:4000',
        rewrite: (p) => p.replace(/^\/api/, ''),
        changeOrigin: true,
      },
    },
  },
});
