-- Потолок расхода на картинки фона в пределах одного ролика (решение владельца
-- 27.08.2026). До него у картинок был только выключатель imageGenerationEnabled,
-- а у генеративного видео потолок в долларах был с самого начала (§7).
ALTER TABLE "EditProfile" ADD COLUMN "imageBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 1.5;
