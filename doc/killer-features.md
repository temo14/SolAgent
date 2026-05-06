# Archon — Killer Feature Ideas

> Ranked by hackathon impact: how much they impress judges × how fast they ship.
> Each idea includes what it proves, why it matters, and how hard it is.

---

## Tier 1 — Ship These First (high impact, 1-2 days each)

---

### 1. Rule Chaining ("If This Then That, On-Chain")

**What:** A rule's action can be `activate_rule:<ruleId>` — one rule fires and wakes up another.

**Example:**
```
Rule A: "When SOL hits $200, buy $100 USDC of SOL"
Rule B: "Immediately after A fires, set a stop-loss: sell if SOL drops below $180"
```
Rule A's action triggers Rule B's activation atomically in the same reconciliation cycle.

**Why judges love it:** Demonstrates composable automation — this is what serious DeFi traders actually need. Nobody else has on-chain rule graphs.

**How hard:** Backend only. Add a new `activate_rule` action type in shared types, handle it in exec-worker (just a Prisma status update — no transaction needed), and add a "chain to" picker in RuleWizard step 3. 1 day.

---

### 2. Portfolio Rebalancer

**What:** A single meta-rule that maintains target allocations across multiple tokens.

```
"Keep my portfolio: 40% SOL, 30% USDC, 20% JUP, 10% BONK.
 Rebalance every Monday at 9am UTC when any position drifts > 5%."
```

The QVAC parser produces multiple sub-rules that fire together. The execution engine checks current balances, computes deltas, and sequences the swaps.

**Why judges love it:** This is a feature Robinhood charges for. On-chain, non-custodial, verifiable — clear differentiation from centralized alternatives.

**How hard:** Medium. Extend the `ArchonRule` schema to support `action.type = 'rebalance'` with target allocations. execution-engine computes which swaps are needed. 2 days.

---

### 3. Copy-Trade Follow Mode

**What:** Enter a verified trader's wallet address — Archon mirrors their swaps automatically within your configured size limits.

```
"Mirror wallet ABC...XYZ's swaps at 10% size, max $50/trade, max 3 trades/day"
```

Helius webhooks already notify when the followed wallet transacts. Condition-evaluator decodes the transaction type, and execution-engine replicates the swap at the configured scale.

**Why judges love it:** Social trading + DeFi automation is a category with massive product-market fit. This is the simplest form of on-chain copy trading and it's fully verifiable.

**How hard:** Medium. Add a `follow_wallet` trigger type. The Helius webhook already fires on any wallet's activity — just add a filter for the target address and parse the instruction type. 2 days.

---

### 4. Telegram Rule Creation Bot

**What:** Create and manage rules entirely through Telegram.

```
User: /create
Bot: Describe your rule:
User: "Buy 10 USDC of SOL every day at 9am"
Bot: ✅ Rule parsed. Trigger: time_cron 09:00, Action: swap 10 USDC→SOL
     [Confirm] [Edit] [Cancel]
User: [Confirm]
Bot: 🚀 Rule deployed! ID: #a3f9...
```

The Telegram bot calls the same `/api/rules` endpoints the frontend uses. Authentication is via a one-time link code generated in the app.

**Why judges love it:** Shows the platform abstraction — the automation layer is wallet-agnostic and interface-agnostic. Any channel can create rules.

**How hard:** Easy. The notification-service already has Telegram wired. Add a command handler using telegraf.js. 1 day.

---

### 5. On-Chain Mandate Spending Dashboard

**What:** Visualize the Mandate PDA state in real time — daily spend bar, per-tx limit indicator, days until expiry countdown.

Turn this raw account data into a live gauge:
```
Daily limit:     1.5 SOL    [████████░░] 0.9 SOL used today
Per-tx limit:    0.3 SOL
Total executions: 47
Expires:         23 days
```

**Why judges love it:** Makes the on-chain safety story visual and tangible. Judges can see the limit enforced in real time — this is the hardest technical thing in the project made human.

**How hard:** Easy — all the data already exists in `GET /agent-wallets/:id/mandate-state`. Just build the UI component. 4 hours.

---

## Tier 2 — Strong Additions (2-3 days each)

---

### 6. Natural Language Backtesting

**What:** After parsing a rule, run a 30-day backtest against real Pyth historical data before deploying.

```
Rule: "Buy SOL when price drops 5% in 1 hour"
Backtest result: Would have fired 12 times in 30 days.
  Best entry: $118.20 (+14.2% gain by day-end)
  Worst entry: $142.10 (-3.1% loss)
  Estimated total: +$87 on $100/trade
```

The `/rules/simulate` endpoint already exists (7-day window). Extend it to 30 days with Pyth Benchmarks.

**Why judges love it:** Lowers the barrier to confidence. Smart traders backtest before deploying — now any user can.

**How hard:** Backend: extend simulate endpoint, fetch more Pyth candle data. Frontend: add a charting library (recharts) to visualize the backtest results in RuleWizard step 2. 2 days.

---

### 7. Multi-Condition Rules (AND/OR Logic)

**What:** Rules with multiple conditions that must all be true.

```
"Swap 20 USDC to SOL IF:
  - SOL price is below $130 AND
  - My SOL balance is below 1 SOL AND
  - Time is between 8am and 6pm UTC"
```

Extend `ArchonRule.trigger` from a single trigger to `{ operator: 'AND' | 'OR', conditions: Trigger[] }`. The condition evaluator checks all conditions in the array.

**Why judges love it:** This is what separates a toy from a real tool. DeFi strategies always have multiple conditions.

**How hard:** Medium. Zod schema change (breaking), condition evaluator update, QVAC prompt update to generate the new format. 2 days.

---

### 8. Rule Templates Marketplace with Revenue Share

**What:** When a published template is used, 0.1% of that rule's swaps goes to the template creator (via a Jupiter referral account).

Flow:
1. User publishes a rule template.
2. Another user imports it from the Marketplace.
3. Every swap executed under that template pays 0.1% platform fee, split between Archon + template creator.

The Jupiter swap already supports `platformFeeBps` and `feeAccount` — it's wired in jupiter.ts but just needs the per-creator referral account logic.

**Why judges love it:** It's a token-less, protocol-native revenue model. Creates a flywheel: good strategists publish, users earn, platform earns. Real business model, fully on-chain.

**How hard:** Medium. Add `creatorFeeAccount` to `PublishedTemplate`, update the jupiter call to route fees. 2 days.

---

### 9. Risk Score & Anomaly Detection

**What:** Every rule gets a risk score (1-10) computed at creation time based on:
- Size of swaps relative to wallet balance
- Frequency of execution
- Token volatility (from Pyth)
- Whether a Mandate PDA exists

Rules above 7/10 require explicit override. Anomalous execution patterns (e.g., 5× normal spend in 10 min) trigger an alert.

**Why judges love it:** "AI + safety" is the headline for this kind of project. A risk score makes the safety story concrete and measurable.

**How hard:** Medium. Risk scoring is pure math — no ML needed. Add a `riskScore` field to the rule create response. Anomaly detection is a simple threshold check in exec-worker. 1.5 days.

---

### 10. Recurring Payment / Payroll Mode

**What:** A first-class payment scheduler UI separate from the DeFi rules.

```
"Pay 0.05 SOL to wallet ABC every Friday"
"Split 100 USDC monthly: 70% to savings wallet, 30% to DCA wallet"
```

This targets a completely different use case — treasury management, recurring bills, team payroll in crypto. Same rule engine underneath, different UX framing.

**Why judges love it:** Real-world utility beyond DeFi. This works for DAOs, freelancers, and anyone paid in crypto. Easy to demo, easy to understand.

**How hard:** Easy. The `time_cron` trigger + `transfer` action already handles this. Just build a cleaner UI that hides the NL parsing and presents a payment form. 1 day.

---

## Tier 3 — Moonshots (impressive if shipped, 3-5 days)

---

### 11. Agent-to-Agent Coordination

**What:** Rules that respond to other agents' activity. "If wallet A (a known DeFi protocol treasury) sends > 10 SOL anywhere, execute rule X within 10 seconds."

This is MEV-adjacent but legal, non-frontrunning automation. Think of it as on-chain event-driven programming.

---

### 12. Mobile PWA + Push Notifications

**What:** The web app becomes installable on iOS/Android. Web Push notifications for rule fires (no Telegram required).

Service worker + Web Push API. The execution-engine emits a push via the notification-service alongside Telegram.

---

### 13. Programmable Mandate with Timelock

**What:** Extend the Anchor program so the Mandate's daily limit auto-decreases over time (time-weighted spending caps). Useful for DAO treasuries that want to slowly deploy capital.

This requires an Anchor program change and a new instruction — the hardest item on this list.

---

### 14. Rule NFT (Transferable Automation)

**What:** Mint a rule as a compressed NFT (Metaplex cNFT). The NFT holder controls the rule. Transfer the NFT → transfer the automation to another wallet.

The on-chain Mandate PDA becomes the NFT's linked account. This makes automation strategies tradeable assets.

---

## For the Hackathon Demo — Pick This Stack

If you're building toward the demo and have 1-2 days:

| Priority | Feature | Demo value |
|---|---|---|
| 1 | On-Chain Mandate spending dashboard | Shows the technical depth visually |
| 2 | Telegram rule creation bot | "I created a rule from my phone, it's live" moment |
| 3 | 30-day backtest chart | Lowers the "will this actually work?" anxiety |
| 4 | Rule chaining | Shows composability — the "aha" moment for judges |

These four together would make Archon the most complete autonomous wallet agent at Colosseum. None requires changes to the core architecture — everything builds on what's already there.

---

## What Makes Archon Genuinely Different

Most "AI wallet agents" at hackathons are:
- Custodial (they hold your keys)
- Cloud-only (no on-chain verification)
- LLM wrappers (call GPT, hope for the best)
- No safety rails

Archon has all the hard parts done:
- Per-user isolated derived keypairs (no shared hot wallet)
- Dual-oracle price safety (Jupiter + Pyth)
- On-chain Mandate with spend limits enforced by the program
- Cryptographic Memo proof on every execution
- Circuit breaker, daily fire limits, emergency stop
- SSE live updates

The pitch is simple: **"Every other AI wallet agent requires you to trust them. Archon requires you to trust math."**
