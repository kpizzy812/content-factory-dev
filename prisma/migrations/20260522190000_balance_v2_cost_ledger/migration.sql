-- balance_v2: расширяем AiAuditLog для service cost-tracking.
-- ADD-only миграция, backward compat сохранён.
-- action — это String (не enum), поэтому ALTER TYPE не требуется.

-- 1. Опциональные поля для not-suggest entries (background pipeline calls без userId)
ALTER TABLE "AiAuditLog" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "AiAuditLog" ALTER COLUMN "prompt" DROP NOT NULL;

-- 2. Service tag (denormalized для быстрого filter по сервису)
ALTER TABLE "AiAuditLog" ADD COLUMN "service" TEXT;

-- 3. Cross-link с pipeline (NULL для standalone calls вне видео-пайплайна)
ALTER TABLE "AiAuditLog" ADD COLUMN "videoId" INTEGER;
ALTER TABLE "AiAuditLog" ADD COLUMN "stepKey" TEXT;

-- 4. Индексы для burn-rate отчётов
CREATE INDEX "AiAuditLog_service_createdAt_idx" ON "AiAuditLog"("service", "createdAt");
CREATE INDEX "AiAuditLog_videoId_idx" ON "AiAuditLog"("videoId");

-- 5. Backfill: проставляем service на старых AiAuditLog где model LIKE 'claude%'.
-- Это позволяет AnthropicEstimateBalanceProvider переключиться на новый фильтр
-- без потери истории.
UPDATE "AiAuditLog" SET "service" = 'anthropic'
WHERE "service" IS NULL AND "model" LIKE 'claude%';
