# Archon — Testing Playbook

> Step-by-step guide for a full end-to-end test session on devnet.
> Budget ~90 minutes for a complete run-through.

---

## 0. Before You Start (10 min)

### Required accounts / keys
| What | Where |
|---|---|
| Helius devnet API key | helius.dev → Dashboard |
| Helius webhook secret | same dashboard, any 32-char string |
| ngrok / Cloudflare tunnel | to expose `http://localhost:4002` publicly |
| Phantom browser extension | devnet mode, funded with ≥ 0.5 SOL |

### Fund your devnet wallet
```bash
# Option A — Solana CLI
solana airdrop 2 <YOUR_PHANTOM_PUBKEY> --url devnet

# Option B — browser
# https://faucet.solana.com
```

### Fill in `.env.devnet`
```bash
cp .env.devnet.example .env.devnet
# Edit these five values — everything else has safe defaults:
# SOLANA_RPC_URL       → your Helius devnet RPC URL
# HELIUS_API_KEY       → your Helius API key
# HELIUS_WEBHOOK_SECRET → any 32+ char secret
# HELIUS_WEBHOOK_URL   → https://<ngrok>.ngrok.io/webhooks/helius
# JWT_SECRET           → openssl rand -hex 32
# AGENT_KEY_MASTER     → openssl rand -hex 32
```

### Start the tunnel
```bash
ngrok http 4002
# Copy the https URL into HELIUS_WEBHOOK_URL in .env.devnet
```

---

## 1. Bring Up the Stack (5 min)

```bash
# Root of repo
docker compose up --build -d

# Tail logs until everything is healthy (~2 min for QVAC to load model)
docker compose logs -f --tail=40
```

### Healthy check — all services should respond
```bash
for port in 4000 4001 4002 4003 4004 4005; do
  status=$(curl -s http://localhost:$port/health | grep -o '"status":"ok"')
  echo "Port $port: ${status:-FAIL}"
done
```
All six should print `"status":"ok"`.

### Confirm QVAC is loaded
```bash
curl -s http://localhost:11434/v1/models | grep "archon-parser"
# Should return a JSON entry for the model
```

---

## 2. Authentication Flow (5 min)

1. Open `http://localhost:3000` in Chrome with Phantom installed.
2. The landing page should load — scroll through it, verify sections render.
3. Click **"Connect Wallet"** → Phantom popup appears.
4. Approve the connection.
5. Phantom shows a **sign message** request (SIWS) — approve it.
6. You should land inside the authenticated app on the Dashboard view.
7. The status footer at the bottom should show your agent wallet address.

**What can go wrong:**
- "Could not find wallet" → Phantom extension not installed or not unlocked.
- Auth fails with 401 → `JWT_SECRET` not set or < 32 chars.
- Blank page → check `docker compose logs api-gateway`.

---

## 3. Agent Wallet Provisioning (auto, verify it)

On first sign-in the frontend calls `POST /agent-wallets` automatically.

```bash
# Check it was created in the DB
docker compose exec postgres psql -U archon -d archon_devnet \
  -c "SELECT id, owner_pubkey, delegate_pubkey, created_at FROM agent_wallets ORDER BY created_at DESC LIMIT 3;"
```

- `owner_pubkey` should be your Phantom wallet.
- `delegate_pubkey` should be a different base58 address (the derived agent keypair).

**Fund the agent wallet** — copy the agent address from the status footer and airdrop:
```bash
solana airdrop 1 <AGENT_DELEGATE_PUBKEY> --url devnet
```

---

## 4. Rule Creation — Happy Path (10 min)

### Test A: Price trigger → swap
1. Click **"My Rules"** → **"+ New Rule"** (or via Dashboard wizard button).
2. In the NL input, type:
   ```
   When SOL price drops below $120, swap 5 USDC to SOL
   ```
3. Click **Parse** — verify the preview card shows:
   - Trigger: `price_below`, asset: SOL, threshold: 120
   - Action: `swap`, from: USDC, to: SOL, amount: 5
4. Set max spend: **$10**, max fires/day: **2**.
5. Click **Deploy** — should transition to `ACTIVE`.

### Test B: Time-cron rule
```
Every hour buy 1 USDC of SOL until 6pm
```
Verify: trigger type `time_cron`, `cron_expression` present, `until_local_hour: 18`.

### Test C: Balance guard
```
If my SOL balance drops below 0.1 SOL, send an alert
```
Verify: trigger `balance_below`, action `alert_only`.

### Check rules in DB
```bash
docker compose exec postgres psql -U archon -d archon_devnet \
  -c "SELECT id, status, raw_input, fires_today FROM rules ORDER BY created_at DESC LIMIT 5;"
```
All should be `ACTIVE`.

---

## 5. Rule Execution — Triggering a Fire (20 min)

This is the most important test.

### Set up a guaranteed-trigger rule
1. Create a new rule:
   ```
   When SOL balance is above 0.001 SOL, swap 0.01 SOL to USDC
   ```
   (threshold is trivially met — will fire immediately on next reconciliation)
2. Set max fires/day: 1 so it fires exactly once.
3. Deploy → `ACTIVE`.

### Wait for execution (~60 seconds)
The reconciliation loop polls every 5 minutes for price/balance rules. To test faster:

```bash
# Watch the execution-engine logs
docker compose logs -f execution-engine | grep -E "ruleId|CONFIRMED|FAILED|Execution"
```

Alternatively, trigger via the condition-evaluator's cron reconciler (60s for time_cron, 5min for balance/price). For a faster test, temporarily trigger a Helius webhook:

```bash
# Simulate a Helius balance-change webhook to condition-evaluator
curl -s -X POST http://localhost:4002/webhooks/helius \
  -H "Content-Type: application/json" \
  -H "helius-signature: <compute HMAC or disable check in dev>" \
  -d '[{
    "signature": "test-sig-001",
    "slot": 999999,
    "timestamp": '$(date +%s)',
    "type": "SOL_TRANSFER",
    "accountData": [{"account": "<AGENT_DELEGATE_PUBKEY>", "nativeBalanceChange": -1000000, "tokenBalanceChanges": []}]
  }]'
```

### Verify execution end-to-end
```bash
docker compose exec postgres psql -U archon -d archon_devnet \
  -c "SELECT status, tx_signature, memo_json, error_code FROM execution_log ORDER BY created_at DESC LIMIT 5;"
```

- Status should be `CONFIRMED`.
- `tx_signature` should be a valid base58 string.
- Open `https://explorer.solana.com/tx/<TX_SIGNATURE>?cluster=devnet` — you should see the swap + Memo instruction.
- The Memo data should contain a JSON blob starting with `{"v":1,"rid":...}`.

### Verify live SSE update
- Open the app in the browser.
- The **History** tab should show a new audit entry as soon as the tx confirms — without refreshing.

---

## 6. Safety Features (15 min)

### Circuit breaker
1. Create a rule with an invalid recipient:
   ```
   Transfer 0.001 SOL to AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
   ```
2. Wait for 3 failed executions (check execution_log).
3. Rule status should flip to `PAUSED_CIRCUIT_BREAKER`.
4. In the UI, **Rules List** should show the circuit-breaker badge.
5. Try to PATCH the rule to ACTIVE — should get 409 "Circuit breaker is active."

### Emergency stop
1. Have at least one ACTIVE rule.
2. Click the red **Emergency STOP** button in the nav.
3. Verify all rules flip to `PAUSED` in **My Rules**.
4. Click **Resume Safety** — rules should go back to `ACTIVE`.

### Daily fire limit
1. Create a rule, set `maxFiresPerDay: 1`.
2. Trigger it once (confirmed).
3. Trigger it again within the same day.
4. Check execution_log — second job should be `STALE_CONDITION` with detail `max_fires_per_day exceeded`.

### Price deviation guard
- Only testable by temporarily setting `PRICE_DEVIATION_THRESHOLD=0.00001` in `.env.devnet` and restarting execution-engine.
- Next swap should log `PRICE_DEVIATION_ABORT` in execution_log.
- Reset threshold after verifying.

---

## 7. Mandate (On-Chain Program) (10 min)

1. Go to **Dashboard → Mandate** (or navigate via sidebar).
2. Click **Create Mandate** — Phantom will ask you to sign a transaction.
3. Confirm in Phantom.
4. Wait for confirmation — the mandate PDA address should appear in the UI.
5. Verify the PDA was stored in the DB:
   ```bash
   docker compose exec postgres psql -U archon -d archon_devnet \
     -c "SELECT id, mandate_pda FROM agent_wallets WHERE mandate_pda IS NOT NULL;"
   ```
6. Verify on-chain:
   ```bash
   solana account <MANDATE_PDA> --url devnet
   # Should show an owned account with ~200 bytes of data
   ```
7. Create and trigger a rule — the execution_log memo_json should show the `record_execution` instruction was prepended.

---

## 8. Notifications (5 min)

1. Create a Telegram bot via `@BotFather` → get a bot token.
2. Start a chat with your bot, get the chat ID.
3. In the app, go to **Dashboard → Telegram**.
4. Enter bot token + chat ID → link.
5. Trigger a rule execution.
6. You should receive a Telegram message within a few seconds.

---

## 9. Marketplace (5 min)

1. Navigate to **Marketplace**.
2. Browse existing published templates.
3. Click **Use Template** on any entry.
4. Verify it pre-fills the rule wizard with the template description.
5. Optionally: go to **My Rules** → click the three-dot menu on an active rule → **Publish to Marketplace**.
6. Refresh Marketplace — your rule should appear.

---

## 10. Performance View (5 min)

1. Navigate to **Performance**.
2. Verify charts render (may be empty if no executions yet).
3. After some executions, check:
   - Fire count timeline
   - Success vs failure ratio
   - Mandate spend gauge (if mandate was created)

---

## 11. Cleanup & Edge Cases

### Rule deletion
1. Go to **My Rules** → delete a rule.
2. Verify it transitions to `ARCHIVED` in DB (not hard-deleted).
3. Verify it no longer appears in the UI.

### Reconnect after disconnect
1. Click the **Disconnect** button (LogOut icon in nav).
2. Verify you land back on the landing page.
3. Reconnect — all your rules and data should reload.

### Multi-tab / SSE reconnect
1. Open the app in two browser tabs.
2. Trigger an execution.
3. Both tabs should receive the live SSE update.

---

## Quick Reference: Useful DB Queries

```sql
-- All rules with their fire counts
SELECT id, status, fires_today, max_fires_day, raw_input FROM rules ORDER BY created_at DESC;

-- Recent executions
SELECT status, tx_signature, error_code, error_detail, created_at
FROM execution_log ORDER BY created_at DESC LIMIT 20;

-- Circuit breaker candidates (3+ failures in 10 min)
SELECT rule_id, COUNT(*) as failures
FROM execution_log
WHERE status = 'FAILED' AND created_at > NOW() - INTERVAL '10 minutes'
GROUP BY rule_id HAVING COUNT(*) >= 3;

-- Confirmed swaps today
SELECT COUNT(*), SUM((memo_json->'act'->>'amount')::numeric) as total_out
FROM execution_log
WHERE status = 'CONFIRMED' AND created_at > NOW() - INTERVAL '24 hours';
```

---

## Smoke-Test Checklist (for a 15-minute quick pass)

- [ ] All 6 service health checks return `"status":"ok"`
- [ ] Phantom sign-in works, authenticated app loads
- [ ] Agent wallet address shown in footer
- [ ] Rule created from NL input, parsed correctly, status = ACTIVE
- [ ] At least one execution confirmed in execution_log
- [ ] Tx visible on Solana explorer with Memo proof
- [ ] SSE live update received in browser on confirmation
- [ ] Emergency STOP pauses all rules
- [ ] Landing page renders with all sections on unauthenticated visit
