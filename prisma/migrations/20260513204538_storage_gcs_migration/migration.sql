-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssetType" ADD VALUE 'thumbnail';
ALTER TYPE "AssetType" ADD VALUE 'preview';

-- AlterEnum
ALTER TYPE "VideoStatus" ADD VALUE 'file_missing';

-- AlterTable
ALTER TABLE "AppReferenceImage" ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "storageProvider" TEXT NOT NULL DEFAULT 'gcs';

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "fileSha256" TEXT,
ADD COLUMN     "fileSizeBytes" BIGINT,
ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "storageProvider" TEXT NOT NULL DEFAULT 'gcs';

-- AlterTable
ALTER TABLE "VideoAsset" ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "fileSha256" TEXT,
ADD COLUMN     "fileSizeBytes" BIGINT,
ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "storageProvider" TEXT NOT NULL DEFAULT 'gcs';

-- AlterTable
ALTER TABLE "VideoUniqueVariant" ADD COLUMN     "storageKey" TEXT;

-- CreateIndex
CREATE INDEX "Video_storageProvider_idx" ON "Video"("storageProvider");

-- CreateIndex
CREATE INDEX "VideoAsset_storageKey_idx" ON "VideoAsset"("storageKey");

-- CreateIndex
CREATE INDEX "VideoAsset_videoId_type_order_idx" ON "VideoAsset"("videoId", "type", "order");
