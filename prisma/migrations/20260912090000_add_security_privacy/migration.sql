ALTER TABLE "customer" ADD COLUMN "anonymizedAt" TIMESTAMP(3);
ALTER TABLE "inquiry" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

CREATE TABLE "rate_limit_bucket" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_limit_bucket_scope_keyHash_windowStart_key"
ON "rate_limit_bucket"("scope", "keyHash", "windowStart");
CREATE INDEX "rate_limit_bucket_expiresAt_idx" ON "rate_limit_bucket"("expiresAt");
