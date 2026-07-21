-- AI vision fields для CharacterReferenceImage + новая таблица SceneReferenceImage.

ALTER TABLE "CharacterReferenceImage"
  ADD COLUMN "aiTags" TEXT[],
  ADD COLUMN "aiCaption" TEXT,
  ADD COLUMN "aiVisualDescription" TEXT,
  ADD COLUMN "aiAnalyzedAt" TIMESTAMP(3),
  ADD COLUMN "aiError" TEXT,
  ADD COLUMN "aiAttempts" INTEGER NOT NULL DEFAULT 0;

-- aiTags по умолчанию пустой массив (Postgres TEXT[] NULL по умолчанию). Хотим []
-- чтобы клиенту не приходилось делать ?? [] везде. Заполняем существующие записи.
UPDATE "CharacterReferenceImage" SET "aiTags" = '{}' WHERE "aiTags" IS NULL;
ALTER TABLE "CharacterReferenceImage" ALTER COLUMN "aiTags" SET NOT NULL;
ALTER TABLE "CharacterReferenceImage" ALTER COLUMN "aiTags" SET DEFAULT '{}';

CREATE INDEX "CharacterReferenceImage_aiAnalyzedAt_idx" ON "CharacterReferenceImage"("aiAnalyzedAt");

CREATE TABLE "SceneReferenceImage" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'mood',
    "fileUrl" TEXT NOT NULL,
    "storageKey" TEXT,
    "storageProvider" TEXT NOT NULL DEFAULT 'gcs',
    "sha1" TEXT NOT NULL,
    "mimeType" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiTags" TEXT[] DEFAULT '{}',
    "aiCaption" TEXT,
    "aiVisualDescription" TEXT,
    "aiAnalyzedAt" TIMESTAMP(3),
    "aiError" TEXT,
    "aiAttempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SceneReferenceImage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SceneReferenceImage" ALTER COLUMN "aiTags" SET NOT NULL;

CREATE UNIQUE INDEX "SceneReferenceImage_sceneId_sha1_key" ON "SceneReferenceImage"("sceneId", "sha1");
CREATE INDEX "SceneReferenceImage_sceneId_kind_order_idx" ON "SceneReferenceImage"("sceneId", "kind", "order");
CREATE INDEX "SceneReferenceImage_aiAnalyzedAt_idx" ON "SceneReferenceImage"("aiAnalyzedAt");

ALTER TABLE "SceneReferenceImage" ADD CONSTRAINT "SceneReferenceImage_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;
