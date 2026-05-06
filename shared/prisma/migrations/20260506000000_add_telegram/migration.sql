-- Add Telegram notification fields to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_chat_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_on_exec" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_on_fail" BOOLEAN NOT NULL DEFAULT true;
