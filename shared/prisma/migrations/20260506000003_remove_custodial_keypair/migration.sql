-- Phase 2.2: Remove custodial keypair storage; add trustless hot-wallet fields.
-- Existing rows get empty strings for owner_pubkey / delegate_pubkey;
-- they will be re-created on next sign-in via the updated POST /agent-wallets.

ALTER TABLE "agent_wallets" DROP COLUMN IF EXISTS "pubkey";
ALTER TABLE "agent_wallets" DROP COLUMN IF EXISTS "encrypted_key";
ALTER TABLE "agent_wallets" DROP COLUMN IF EXISTS "key_iv";

ALTER TABLE "agent_wallets" ADD COLUMN IF NOT EXISTS "owner_pubkey"    TEXT NOT NULL DEFAULT '';
ALTER TABLE "agent_wallets" ADD COLUMN IF NOT EXISTS "delegate_pubkey" TEXT NOT NULL DEFAULT '';

ALTER TABLE "agent_wallets" ALTER COLUMN "owner_pubkey"    DROP DEFAULT;
ALTER TABLE "agent_wallets" ALTER COLUMN "delegate_pubkey" DROP DEFAULT;

-- Make mandate_pda unique (was already optional; now also unique across rows that have it).
ALTER TABLE "agent_wallets" ADD CONSTRAINT "agent_wallets_mandate_pda_key" UNIQUE ("mandate_pda") NOT DEFERRABLE;
