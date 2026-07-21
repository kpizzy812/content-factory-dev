-- ADD-only: метаданные генерации изображений через fal.ai для CharacterReferenceImage и SceneReferenceImage.
-- Поля nullable — backward compat для существующих ручных загрузок (NULL = ручная загрузка, NOT NULL = AI generation).

ALTER TABLE "CharacterReferenceImage" ADD COLUMN "generationPrompt" TEXT;
ALTER TABLE "CharacterReferenceImage" ADD COLUMN "generationModel" TEXT;
ALTER TABLE "CharacterReferenceImage" ADD COLUMN "generationCostUsd" DECIMAL(10,6);

ALTER TABLE "SceneReferenceImage" ADD COLUMN "generationPrompt" TEXT;
ALTER TABLE "SceneReferenceImage" ADD COLUMN "generationModel" TEXT;
ALTER TABLE "SceneReferenceImage" ADD COLUMN "generationCostUsd" DECIMAL(10,6);
