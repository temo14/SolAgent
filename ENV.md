# Environment files — where they live and when to change them

Two layers: **backend** (Docker / Node services) and **frontend** (Vite, browser-exposed vars only).

---

## Backend (repo root) — `docker compose --env-file …`

| File | When you use it | What to change over time |
|------|-----------------|---------------------------|
| **`.env.devnet`** | Default: `docker compose --env-file .env.devnet up` | **Helius:** rotate `HELIUS_API_KEY`, URL query on `SOLANA_RPC_URL`, and `HELIUS_WEBHOOK_SECRET` when you rotate webhooks. **Public URL:** set `HELIUS_WEBHOOK_URL` when ngrok/deploy URL changes. **Auth:** rotate `JWT_SECRET` (all users re-login). **Agent keys:** rotate `AGENT_KEY_MASTER` only if you accept re-encrypting or invalidating stored agent wallets. **DB:** `DATABASE_URL` if Postgres host/user/db/password changes. |
| **`.env.localnet`** | Local Docker stack with a **separate DB** (`solAgent_localnet`) but same style of secrets as devnet | Same knobs as devnet; switch `SOLANA_RPC_*` / `SOLANA_NETWORK` if you move from hosted devnet to a **local validator** (`http://host.docker.internal:8899`). |
| **`.env.mainnet`** | Production / mainnet compose | Set **mainnet** Helius URL, **never** reuse devnet keys. Tighten `CORS_ORIGIN`, `LOG_LEVEL`, `NODE_ENV`. |
| **`.env.devnet.example`** | Template for new clones | Keep placeholders only; copy to `.env.devnet` and fill in. |

**Never commit** real `.env.devnet` / `.env.mainnet` / `.env.localnet` (they are in `.gitignore`).

---

## Frontend (`app/`) — Vite modes

Only variables prefixed with **`VITE_`** are visible in the browser. Do **not** put `JWT_SECRET`, `AGENT_KEY_MASTER`, or DB URLs here.

| File | When Vite loads it | What to change |
|------|-------------------|----------------|
| **`app/.env.development`** | `npm run dev` (default) | **`VITE_SOLANA_RPC_URL`** — must point at the **same cluster** your backend uses (e.g. devnet Helius). Change when you rotate the RPC API key or switch cluster. **`VITE_WALLETCONNECT_PROJECT_ID`** — change if you create a new WalletConnect Cloud project or domains. |
| **`app/.env.localnet`** | `npm run dev:localnet` | Same idea; align RPC with whatever root `.env.localnet` uses (devnet vs local validator). |
| **`app/.env.mainnet`** | `npm run dev:mainnet` / `npm run build:mainnet` | **Mainnet** Helius URL + WalletConnect id for production-like local builds. |
| **`app/.env.local.example`** | Reference only; copy to **`app/.env.local`** for personal overrides | Optional per-machine tweaks; `app/.env.local` is gitignored if you add it. |

---

## Quick rules

1. **Backend cluster = frontend RPC.** If `SOLANA_NETWORK` / RPC in root env is devnet, `VITE_SOLANA_RPC_URL` must be a **devnet** endpoint (and the reverse for mainnet).
2. **Rotate after leaks:** Helius key, `JWT_SECRET`, `HELIUS_WEBHOOK_SECRET`; treat `AGENT_KEY_MASTER` as catastrophic if exposed.
3. **Webhooks:** whenever Helius sends to a new URL, update `HELIUS_WEBHOOK_URL` in the **root** env file the stack loads, and the matching secret in the Helius dashboard.
