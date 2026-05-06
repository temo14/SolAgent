CREATE TABLE IF NOT EXISTS "published_templates" (
  "id"          TEXT NOT NULL,
  "rule_hash"   TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "parsed_rule" JSONB NOT NULL,
  "use_count"   INTEGER NOT NULL DEFAULT 0,
  "upvotes"     INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "published_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "published_templates_rule_hash_key"
  ON "published_templates"("rule_hash");
