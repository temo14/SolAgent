# Archon

> **Solana automation with on-chain spending limits enforced by the chain — not by our server.**

Archon lets users automate their Solana wallet using plain-English rules. The key difference from every other trading bot: spending limits are enforced by an Anchor program that runs atomically with every swap. If the limit is exceeded, the transaction fails on-chain. No server can override it.

---

## How It Works

1. **Describe a rule** — "If SOL drops below $150, swap 50% of my SOL to USDC"
2. **QVAC parses it** — local LLM converts plain English to a structured trigger + action
3. **Review & confirm** — you see exactly what the agent will do, with safety limits you control
4. **Set a Mandate on-chain** — an Anchor program records your per-tx and daily spending caps
5. **Agent executes autonomously** — Helius webhooks trigger condition evaluation; if matched, the execution engine builds a transaction that includes `record_execution` from the Mandate program. If limits are exceeded, the whole transaction fails atomically. No server-side bypass possible.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        React Frontend                        │
│   RuleWizard · MandatePanel · AuditLog · Marketplace · SSE  │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + SSE
┌──────────────────────────▼──────────────────────────────────┐
│                     API Gateway :4000                        │
│   Auth (SIWS+JWT) · Agent Wallets · Marketplace · Stats      │
└──────┬────────────────────────────────────┬─────────────────┘
       │                                    │
┌──────▼──────────┐               ┌─────────▼────────────────┐
│  Rule Engine    │               │   Notification Service    │
│  :4001          │               │   (Telegram Bot)          │
│  QVAC + Zod     │               └──────────────────────────┘
└──────┬──────────┘
       │ Prisma / Postgres
┌──────▼──────────────────────────────────────────────────────┐
│                     Helius Webhooks                          │
│              Event Listener :4002                            │
│              Redis Pub/Sub fanout                            │
└──────┬──────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────┐
│               Condition Evaluator :4003                      │
│   Evaluates active rules against each webhook event          │
│   5-min reconciliation fallback if webhooks miss events      │
└──────┬──────────────────────────────────────────────────────┘
       │ BullMQ (per-wallet queue, concurrency=1)
┌──────▼──────────────────────────────────────────────────────┐
│               Execution Engine :4004                         │
│   Dual-oracle check (Jupiter + Pyth, 1% threshold)           │
│   record_execution Mandate ix prepended to every tx          │
│   Circuit breaker after 3 consecutive failures               │
│   Idempotency keys prevent double-execution                  │
└──────┬──────────────────────────────────────────────────────┘
       │                    │
┌──────▼──────┐    ┌────────▼────────────────────────────────┐
│ Audit       │    │   Solana (devnet)                        │
│ Indexer     │    │   Anchor Program · Jupiter V6 · Pyth     │
│ :4005       │    └─────────────────────────────────────────┘
└─────────────┘
```

---

## On-Chain Program

**Program ID:** `BfKWwCkP8fmvDsWznQXwW5PuvpateF9Nv6X4JMWTVFev`

The `archon` Anchor program enforces spending limits at the transaction level:

```rust
// record_execution is called BEFORE the swap instruction in the same tx.
// If either per-tx or daily limit is exceeded, the instruction fails →
// the entire transaction fails atomically. No server bypass is possible.
pub fn record_execution(ctx: Context<RecordExecution>, amount_lamports: u64) -> Result<()>
```

**Instructions:**
| Instruction | Caller | Effect |
|---|---|---|
| `create_mandate` | User (owner) | Creates PDA with per-tx and daily spending caps |
| `update_mandate` | User (owner) | Tightens or loosens limits |
| `revoke_mandate` | User (owner) | Instantly disables all automation — no server needed |
| `record_execution` | Agent (delegate) | Validates limits, increments daily counter |

---

## Key Safety Features

| Feature | How It Works |
|---|---|
| **On-chain spending limits** | Anchor `record_execution` enforces per-tx and rolling 24h limits atomically |
| **Dual-oracle price check** | Jupiter quote vs Pyth oracle must be within 1% or execution aborts |
| **Circuit breaker** | Rule auto-pauses after 3 consecutive failures |
| **Idempotency** | Deterministic key per `(ruleId, triggerSlot)` prevents double-execution |
| **Per-user agent wallets** | Each user gets a unique derived keypair — no single shared hot wallet |
| **Memo proof** | Every executed tx includes an on-chain memo with the rule hash and observed values |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · Vite · Tailwind CSS v4 · Framer Motion · @solana/wallet-adapter |
| Backend | Node.js 22 · TypeScript · Fastify · Prisma |
| Queue | BullMQ (Redis) — per-wallet queues, concurrency=1 |
| Database | PostgreSQL 16 |
| Blockchain | @solana/web3.js · Anchor 0.32 · Jupiter V6 · Pyth · Helius |
| LLM | QVAC (local OpenAI-compatible — rule parsing, no cloud dependency) |
| Notifications | Telegram Bot API |
| Infrastructure | Docker Compose |

---

## Running Locally

### Prerequisites
- Docker + Docker Compose
- Node.js 22
- [Helius API key](https://helius.dev) (free tier works)
- A tunnel for Helius webhooks (e.g. [ngrok](https://ngrok.com))

### Setup

```bash
# 1. Clone and install
git clone https://github.com/temo14/Archon
cd Archon
yarn install

# 2. Configure environment
cp .env.devnet.example .env.devnet
# Fill in: HELIUS_API_KEY, HELIUS_WEBHOOK_SECRET, HELIUS_WEBHOOK_URL,
#          JWT_SECRET, AGENT_KEY_MASTER

# 3. Start infrastructure + services
docker compose up --build

# 4. Start the frontend
cd app && yarn dev
```

Open [http://localhost:3000](http://localhost:3000) and connect your Solana wallet.

### Generate secrets

```bash
# JWT_SECRET and AGENT_KEY_MASTER
openssl rand -hex 32
```

---

## Creating a Rule

1. Connect wallet (SIWS — Sign In With Solana)
2. Go to **Dashboard → Create Rule**
3. Describe your rule in plain English (or pick a template)
4. Review what QVAC understood — set your spending limits
5. Click **Confirm & Deploy**
6. (Optional) Create an on-chain Mandate via the **Mandate** tab to enforce hard spending caps

---

## Project Structure

```
Archon/
├── programs/archon/        # Anchor program (lib.rs)
├── services/
│   ├── api-gateway/           # REST API + auth (port 4000)
│   ├── rule-engine/           # QVAC + rule CRUD (port 4001)
│   ├── event-listener/        # Helius webhook receiver (port 4002)
│   ├── condition-evaluator/   # Trigger evaluation workers (port 4003)
│   ├── execution-engine/      # Tx building + signing (port 4004)
│   ├── audit-indexer/         # Execution indexing (port 4005)
│   └── notification-service/  # Telegram alerts
├── app/                       # React + Vite frontend
├── shared/
│   ├── prisma/                # Database schema + migrations
│   ├── types/                 # Shared TypeScript types
│   └── constants.ts           # Queue names, token mints, limits
└── docker-compose.yml
```

---

## Environment Variables

See [`.env.devnet.example`](.env.devnet.example) for the full list with documentation.

| Variable | Required | Description |
|---|---|---|
| `AGENT_KEY_MASTER` | ✅ | Master secret for deriving per-user agent keypairs |
| `JWT_SECRET` | ✅ | ≥32 chars, shared across services |
| `HELIUS_API_KEY` | ✅ | Helius RPC + webhook API key |
| `HELIUS_WEBHOOK_SECRET` | ✅ | HMAC secret for webhook verification |
| `HELIUS_WEBHOOK_URL` | ✅ | Public URL reachable by Helius |
| `SOLANA_RPC_URL` | ✅ | Helius or custom RPC endpoint |

---

## License

MIT
