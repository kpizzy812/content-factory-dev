-- Виральность ролика: во сколько раз просмотры перекрыли аудиторию автора.
-- Абсолютные просмотры сравнивают размер аккаунтов, а не успех публикации:
-- 115 394 просмотра у блогера с 690 983 подписчиками — провал, а 40 026 у
-- автора с 11 780 — заметный рост.
ALTER TABLE "Trend"
  ADD COLUMN "authorFollowers" INTEGER,
  ADD COLUMN "viralityScore" DOUBLE PRECISION;

-- Сортировка витрины трендов идёт по этому полю.
CREATE INDEX "Trend_viralityScore_idx" ON "Trend" ("viralityScore" DESC NULLS LAST);
