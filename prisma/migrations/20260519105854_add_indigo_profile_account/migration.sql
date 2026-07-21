-- CreateTable
CREATE TABLE "IndigoProfileAccount" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "socialAccountId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" INTEGER,

    CONSTRAINT "IndigoProfileAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IndigoProfileAccount_socialAccountId_idx" ON "IndigoProfileAccount"("socialAccountId");

-- CreateIndex
CREATE INDEX "IndigoProfileAccount_profileId_isPrimary_idx" ON "IndigoProfileAccount"("profileId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "IndigoProfileAccount_profileId_socialAccountId_key" ON "IndigoProfileAccount"("profileId", "socialAccountId");

-- AddForeignKey
ALTER TABLE "IndigoProfileAccount" ADD CONSTRAINT "IndigoProfileAccount_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "IndigoProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndigoProfileAccount" ADD CONSTRAINT "IndigoProfileAccount_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (Цикл M.1): зеркало существующих 1:1 связок IndigoProfile→SocialAccount
-- в новую таблицу с isPrimary=true. Только для профилей с непустым socialAccountId.
-- Используется gen_random_uuid() (доступен в Postgres 13+ без extension).
-- ON CONFLICT — idempotent на повторных запусках.
INSERT INTO "IndigoProfileAccount" ("id", "profileId", "socialAccountId", "isPrimary", "addedAt")
SELECT
  'mig_' || REPLACE(gen_random_uuid()::TEXT, '-', ''),
  "id",
  "socialAccountId",
  TRUE,
  COALESCE("createdAt", NOW())
FROM "IndigoProfile"
WHERE "socialAccountId" IS NOT NULL
ON CONFLICT ("profileId", "socialAccountId") DO NOTHING;
