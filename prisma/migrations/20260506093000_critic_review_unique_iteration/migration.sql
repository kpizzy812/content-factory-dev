-- Атомарная защита от race condition: только 1 CriticReview per (scenarioId, iteration).
-- Параллельные вызовы critic'а на одном scenarioId получат P2002 и gracefully break.
-- DropIndex на старом @@index не нужен — он покрывается уникальным индексом, но Prisma
-- хранит его отдельно (NON-UNIQUE). Оставляем оба чтобы план запросов не менялся.

-- CreateIndex
CREATE UNIQUE INDEX "CriticReview_scenarioId_iteration_key" ON "CriticReview"("scenarioId", "iteration");
