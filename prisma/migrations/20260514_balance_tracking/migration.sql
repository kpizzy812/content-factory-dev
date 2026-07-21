-- ADD-only миграция: новое поле costUsd в AiAuditLog и таблица ServiceBalanceEntry.
-- Никаких DROP/ALTER существующих колонок — безопасный rollout.

-- AiAuditLog.costUsd — опционально, NULL для старых записей.
ALTER TABLE "AiAuditLog" ADD COLUMN "costUsd" DECIMAL(10, 6);

-- ServiceBalanceEntry — таблица для manual entry балансов сервисов.
CREATE TABLE "ServiceBalanceEntry" (
    "id" SERIAL NOT NULL,
    "service" TEXT NOT NULL,
    "amount" DECIMAL(10, 2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "metadata" JSONB,
    "enteredBy" INTEGER,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "ServiceBalanceEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceBalanceEntry_service_key" ON "ServiceBalanceEntry"("service");
CREATE INDEX "ServiceBalanceEntry_service_idx" ON "ServiceBalanceEntry"("service");
CREATE INDEX "ServiceBalanceEntry_enteredAt_idx" ON "ServiceBalanceEntry"("enteredAt");
