-- CreateTable
CREATE TABLE "FavoritePrompt" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "appId" INTEGER,
    "promptText" TEXT NOT NULL,
    "sourceVideoAssetId" INTEGER,
    "tags" TEXT[],
    "notes" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FavoritePrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FavoritePrompt_userId_idx" ON "FavoritePrompt"("userId");

-- CreateIndex
CREATE INDEX "FavoritePrompt_appId_idx" ON "FavoritePrompt"("appId");

-- CreateIndex
CREATE INDEX "FavoritePrompt_isPublic_appId_idx" ON "FavoritePrompt"("isPublic", "appId");

-- CreateIndex
CREATE INDEX "FavoritePrompt_tags_idx" ON "FavoritePrompt" USING GIN ("tags");

-- AddForeignKey
ALTER TABLE "FavoritePrompt" ADD CONSTRAINT "FavoritePrompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ZavodUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoritePrompt" ADD CONSTRAINT "FavoritePrompt_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoritePrompt" ADD CONSTRAINT "FavoritePrompt_sourceVideoAssetId_fkey" FOREIGN KEY ("sourceVideoAssetId") REFERENCES "VideoAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
