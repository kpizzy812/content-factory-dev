ALTER TABLE "ContentFunnel"
ADD COLUMN "webhookSecretEncrypted" TEXT;

ALTER TABLE "FactoryPublication"
ADD COLUMN "automationStatus" TEXT NOT NULL DEFAULT 'not_requested',
ADD COLUMN "automationExternalId" TEXT,
ADD COLUMN "automationError" TEXT,
ADD COLUMN "automationStartedAt" TIMESTAMP(3),
ADD COLUMN "automationSyncedAt" TIMESTAMP(3),
ADD COLUMN "automationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "automationSnapshot" JSONB;

CREATE INDEX "FactoryPublication_automationStatus_updatedAt_idx"
ON "FactoryPublication"("automationStatus", "updatedAt");
