-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'PAUSED', 'PAUSED_CIRCUIT_BREAKER', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExecStatus" AS ENUM ('PROCESSING', 'CONFIRMED', 'FAILED', 'DUPLICATE_DISCARDED', 'STALE_CONDITION', 'PRICE_DEVIATION_ABORT', 'CIRCUIT_BREAKER_HALT', 'INSUFFICIENT_FUNDS');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "wallet_pubkey" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),
    "daily_limit_usd" DECIMAL(18,6) NOT NULL DEFAULT 1000,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "encrypted_key" BYTEA NOT NULL,
    "key_iv" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "agent_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_wallet_id" TEXT NOT NULL,
    "raw_input" TEXT NOT NULL,
    "parsed_rule" JSONB NOT NULL,
    "rule_hash" TEXT NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "max_amount_usd" DECIMAL(18,6),
    "fires_today" INTEGER NOT NULL DEFAULT 0,
    "max_fires_day" INTEGER NOT NULL DEFAULT 10,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "pause_reason" TEXT,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_log" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "ExecStatus" NOT NULL DEFAULT 'PROCESSING',
    "trigger_event_sig" TEXT,
    "trigger_slot" BIGINT,
    "tx_signature" TEXT,
    "memo_json" JSONB,
    "jupiter_price" DECIMAL(18,6),
    "pyth_price" DECIMAL(18,6),
    "price_deviation" DECIMAL(8,4),
    "error_code" TEXT,
    "error_detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "execution_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "wallet_pubkey" TEXT NOT NULL,
    "tx_signature" TEXT,
    "rule_id" TEXT,
    "event_type" TEXT NOT NULL DEFAULT 'EXECUTION_CONFIRMED',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "is_anomalous" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_pubkey_key" ON "users"("wallet_pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "agent_wallets_pubkey_key" ON "agent_wallets"("pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "execution_log_idempotency_key_key" ON "execution_log"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_tx_signature_key" ON "audit_events"("tx_signature");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_idempotency_key_key" ON "audit_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "audit_events_wallet_pubkey_idx" ON "audit_events"("wallet_pubkey");

-- CreateIndex
CREATE INDEX "audit_events_rule_id_idx" ON "audit_events"("rule_id");

-- AddForeignKey
ALTER TABLE "agent_wallets" ADD CONSTRAINT "agent_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_agent_wallet_id_fkey" FOREIGN KEY ("agent_wallet_id") REFERENCES "agent_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_log" ADD CONSTRAINT "execution_log_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
