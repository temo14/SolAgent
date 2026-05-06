# Archon — Colosseum Hackathon Review
_Generated: 2026-05-06_

---

## WHAT'S GENUINELY GOOD

**1. On-Chain Mandate System is the killer feature.**
`record_execution` being called atomically inside the same TX as the swap is the right design. If limits are exceeded, the whole TX fails on-chain — no server can override it. This is the one thing that separates Archon from every other "AI trading bot" where you just trust the server. Lead every pitch with this.

**2. Dual-oracle price safety (Jupiter + Pyth, 1% threshold)**
Most hackathon DeFi projects skip this entirely. Production-grade thinking.

**3. Circuit breaker + idempotency keys**
Auto-pausing rules after 3 consecutive failures, and deterministic idempotency keys preventing double-execution — these show operational maturity.

**4. Per-wallet BullMQ concurrency=1**
Correct solution for preventing race conditions on sequential wallet executions.

**5. HMAC validation on Helius webhooks**
Security at the integration boundary. Most projects skip this.

**6. Real test coverage exists**
4 test files (qvac parser, memo encoding, circuit breaker, condition evaluation). Not complete, but better than zero.

**7. Clean service decomposition**
7 services with clear single responsibilities, proper health checks, graceful shutdown, structured Pino logging.

---

## CRITICAL ISSUES (fix before submission)

### ISSUE 1 — Single hot wallet signs everything (architectural flaw)
`SOLAGENT_HOT_WALLET_KEYPAIR` in `.env` signs ALL executions for ALL users. One server compromise exposes every user's authorized automation. Judges who understand Solana WILL ask about this.
- **Fix path:** Per-user derived agent wallets, or document the limitation honestly with a roadmap.

### ISSUE 2 — `RecordExecution` missing PDA seeds constraint (security bug)
```rust
// CURRENT (insecure) — any mandate can be passed as long as delegate signs
#[account(mut)]
pub mandate: Account<'info, Mandate>,

// CORRECT — validate via PDA seeds
#[account(
    mut,
    seeds = [b"mandate", mandate.owner.as_ref()],
    bump = mandate.bump,
    constraint = mandate.delegate == delegate.key() @ ArchonError::Unauthorized
)]
pub mandate: Account<'info, Mandate>,
```

### ISSUE 3 — No root README.md
A judge opens the repo and sees nothing explaining what Archon is. Almost disqualifying for a hackathon.

### ISSUE 4 — No live demo URL
"Try it at demo.archon.xyz" beats a local Docker Compose every time.

### ISSUE 5 — Anchor IDL not committed
`target/idl/archon.json` should be in the repo so judges can verify the on-chain program.

---

## MEDIOCRE (improve before submission)

- **Day reset comment is wrong** — code does a rolling 24h window, comment says "calendar day"
- **4 tests for 7 services** — no tests for api-gateway, notification-service, audit-indexer, or integration
- **Marketplace may be a stub** — broken feature hurts more than missing one
- **5-minute reconciliation fallback** — too slow for "real-time" automation; window can be missed
- **QVAC "AI" claim needs specificity** — what model? what fine-tuning? judges will probe this
- **No user confirmation before rule activation** — LLM misparse could execute wrong trades

---

## WHAT TO DELETE

- `app/README.md` — replace with proper root-level README
- Marketplace nav item — if not functional, remove it
- Dead/stub views — demo what works, don't tease what doesn't

---

## WHAT TO ADD (priority order)

1. Root `README.md` with architecture diagram, demo video link, how to run
2. Fix `RecordExecution` PDA constraint (3-line fix)
3. Live demo deployment
4. Commit Anchor IDL
5. Devnet execution stats ("47 trades, 12.3 SOL, zero mandate violations")
6. Explain QVAC model specifically
7. One end-to-end integration test

---

## HACKATHON PITCH REFRAME

**Current (weak):** "AI-powered Solana automation"

**Better:** "The only Solana automation platform where spending limits are enforced on-chain, not by our server — users set rules in plain English, the Anchor program enforces them atomically."

The mandate system is your moat. Every competitor is just a backend bot signing transactions. You have cryptographic enforcement.

---

## SCORES

| Dimension | Score | Note |
|---|---|---|
| Architecture | 8/10 | Excellent service design, solid Solana patterns |
| On-chain Program | 6/10 | Clever concept, missing PDA constraint |
| Code Quality | 7/10 | Good overall, weak test coverage |
| Security | 5/10 | Single hot wallet + missing constraint = two real issues |
| Demo Readiness | 4/10 | No README, unclear if deployed |
| Novelty | 7/10 | Mandate system is genuinely interesting |
| Pitch Clarity | 4/10 | "AI automation" buries the mandate differentiator |