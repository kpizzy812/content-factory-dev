-- Создаём таблицу AppReferenceImage с богатыми метаданными вместо плоского App.referenceImageUrls.
-- App.referenceImageUrls остаётся для обратной совместимости (генератор сценариев пока читает оттуда),
-- но первичным источником становится AppReferenceImage с aiTags / aiCaption / aiAnalyzedAt.

CREATE TABLE "AppReferenceImage" (
    "id" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "sha1" TEXT NOT NULL,
    "mimeType" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "aiTags" TEXT[],
    "aiCaption" TEXT,
    "aiHasUI" BOOLEAN,
    "aiPrimaryAction" TEXT,
    "aiAnalyzedAt" TIMESTAMP(3),
    "aiError" TEXT,
    "aiAttempts" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppReferenceImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppReferenceImage_appId_sha1_key" ON "AppReferenceImage"("appId", "sha1");
CREATE INDEX "AppReferenceImage_appId_idx" ON "AppReferenceImage"("appId");
CREATE INDEX "AppReferenceImage_aiAnalyzedAt_idx" ON "AppReferenceImage"("aiAnalyzedAt");

ALTER TABLE "AppReferenceImage" ADD CONSTRAINT "AppReferenceImage_appId_fkey"
    FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: каждый url из App.referenceImageUrls становится AppReferenceImage.
-- sha1 берётся из имени файла (POST endpoint сохранял как `${sha1.slice(0,16)}.{ext}`),
-- mimeType — из расширения. AI-поля остаются NULL и будут заполнены screen-tagger при ручном rerun.
INSERT INTO "AppReferenceImage" (id, "appId", "fileUrl", sha1, "mimeType", "aiTags", "aiAttempts", "createdAt", "updatedAt")
SELECT
    'ref_' || app.id || '_' || COALESCE(
        SUBSTRING(url FROM '/([a-f0-9]{8,})\.[a-z]+$'),
        SUBSTRING(MD5(url) FROM 1 FOR 16)
    ) AS id,
    app.id AS "appId",
    url AS "fileUrl",
    COALESCE(
        SUBSTRING(url FROM '/([a-f0-9]{8,})\.[a-z]+$'),
        SUBSTRING(MD5(url) FROM 1 FOR 16)
    ) AS sha1,
    CASE
        WHEN url ILIKE '%.png'  THEN 'image/png'
        WHEN url ILIKE '%.jpg'  THEN 'image/jpeg'
        WHEN url ILIKE '%.jpeg' THEN 'image/jpeg'
        WHEN url ILIKE '%.webp' THEN 'image/webp'
        WHEN url ILIKE '%.gif'  THEN 'image/gif'
        ELSE NULL
    END AS "mimeType",
    ARRAY[]::TEXT[] AS "aiTags",
    0 AS "aiAttempts",
    NOW() AS "createdAt",
    NOW() AS "updatedAt"
FROM "App" app, UNNEST(app."referenceImageUrls") AS url
WHERE COALESCE(url, '') <> ''
ON CONFLICT ("appId", sha1) DO NOTHING;
