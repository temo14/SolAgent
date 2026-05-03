# SolAgent — frontend (`app/`)

React + Vite + Tailwind CSS v4. Proxies `/api` to the monorepo backend (see root `docker-compose.yml` and `ENV.md`).

## Run locally

1. From repo root: `npm install`
2. Backend: `docker compose --env-file .env.devnet up` (or your chosen env file)
3. Env: copy `app/.env.local.example` if needed; for dev, `app/.env.development` supplies `VITE_*` vars
4. `cd app && npm run dev` — open http://localhost:3000
