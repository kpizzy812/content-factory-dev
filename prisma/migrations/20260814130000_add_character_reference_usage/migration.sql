-- Ротация портретов персонажа для AI-аватара.
--
-- Аватарная сцена оживляет референсный кадр персонажа через image-to-video.
-- Без учёта использования выбор детерминирован: один и тот же портрет уходит
-- во все сцены и все ролики, и получается ровно то, что PROJECT_CONTEXT §7
-- называет дублем — одинаковые пиксели при меняющихся губах и субтитрах.
--
-- Поля повторяют учёт фрагментов ведущего в PresenterSourceClip: счётчик и
-- время последнего использования, по ним же строится порядок «наименее
-- использованный первым» и cooldown.
ALTER TABLE "CharacterReferenceImage"
  ADD COLUMN "usageCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastUsedAt" TIMESTAMP(3);

CREATE INDEX "CharacterReferenceImage_characterId_usageCount_lastUsedAt_idx"
  ON "CharacterReferenceImage"("characterId", "usageCount", "lastUsedAt");
