-- Character Library (F1) + Scene Composer (F2).
-- Аддитивная миграция: новые таблицы Character / CharacterReferenceImage / Scene,
-- nullable trendId + sceneId в Scenario. Без изменения существующих данных.

-- 1. Scenario.trendId стал nullable + добавлен sceneId для scene-driven сценариев.
ALTER TABLE "Scenario" ALTER COLUMN "trendId" DROP NOT NULL;
ALTER TABLE "Scenario" ADD COLUMN "sceneId" TEXT;

-- 2. Character — per-app reference-персонаж.
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "role" TEXT NOT NULL DEFAULT 'protagonist',
    "visualPrompt" TEXT,
    "tags" TEXT[],
    "emotionDefault" TEXT,
    "ageRange" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Character_appId_archived_idx" ON "Character"("appId", "archived");
CREATE INDEX "Character_appId_name_idx" ON "Character"("appId", "name");
CREATE INDEX "Character_tags_idx" ON "Character" USING GIN ("tags");

-- 3. CharacterReferenceImage — референс-изображения персонажа.
CREATE TABLE "CharacterReferenceImage" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'face',
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
    CONSTRAINT "CharacterReferenceImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterReferenceImage_characterId_sha1_key" ON "CharacterReferenceImage"("characterId", "sha1");
CREATE INDEX "CharacterReferenceImage_characterId_kind_order_idx" ON "CharacterReferenceImage"("characterId", "kind", "order");

-- 4. Scene — блочный композитор сцены.
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "blocks" JSONB NOT NULL,
    "promptCompiled" TEXT,
    "negativeCompiled" TEXT,
    "tags" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedScenarioId" INTEGER,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Scene_appId_archived_updatedAt_idx" ON "Scene"("appId", "archived", "updatedAt");
CREATE INDEX "Scene_status_idx" ON "Scene"("status");

-- 5. Scenario.sceneId index + FKeys.
CREATE INDEX "Scenario_sceneId_idx" ON "Scenario"("sceneId");

ALTER TABLE "Character" ADD CONSTRAINT "Character_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterReferenceImage" ADD CONSTRAINT "CharacterReferenceImage_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;
