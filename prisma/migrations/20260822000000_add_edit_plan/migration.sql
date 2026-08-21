-- AlterEnum
ALTER TYPE "VideoStepKey" ADD VALUE 'edit_plan';

-- CreateTable
CREATE TABLE "EditProfile" (
    "id" SERIAL NOT NULL,
    "appId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "editPrompt" TEXT,
    "brollRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "shotChangeSec" DOUBLE PRECISION NOT NULL DEFAULT 1.8,
    "pipEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pipPosition" TEXT NOT NULL DEFAULT 'bottom_right',
    "pipSize" DOUBLE PRECISION NOT NULL DEFAULT 0.28,
    "generativeVideoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "generativeVideoBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "generativeVideoResolution" TEXT NOT NULL DEFAULT '720p',
    "stepwiseApproval" BOOLEAN NOT NULL DEFAULT false,
    "llmModelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- bytes: BIGINT, не INTEGER — библиотека фонов это записи экрана и готовая
-- съёмка, INTEGER (потолок 2 147 483 647) переполняется ровно на 2 ГБ.
-- Тот же дефект уже чинили для PresenterRecording миграцией
-- 20260821030000_widen_presenter_recording_bytes_to_bigint.
CREATE TABLE "BackgroundClip" (
    "id" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "name" TEXT,
    "storageKey" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'gcs',
    "sha1" TEXT NOT NULL,
    "mimeType" TEXT,
    "bytes" BIGINT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'footage',
    "tags" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "perceptualHash" TEXT,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoShot" (
    "id" TEXT NOT NULL,
    "videoId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "sceneOrder" INTEGER,
    "foreground" TEXT NOT NULL DEFAULT 'none',
    "background" TEXT NOT NULL DEFAULT 'none',
    "backgroundClipId" TEXT,
    "appReferenceId" TEXT,
    "idea" TEXT,
    "pipEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "assetPath" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "perceptualHash" TEXT,
    "degradeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoShot_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "editProfileId" INTEGER,
ADD COLUMN     "editOverrides" JSONB;

-- CreateIndex
CREATE INDEX "EditProfile_appId_isDefault_idx" ON "EditProfile"("appId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundClip_appId_sha1_key" ON "BackgroundClip"("appId", "sha1");

-- CreateIndex
CREATE INDEX "BackgroundClip_appId_isActive_lastUsedAt_idx" ON "BackgroundClip"("appId", "isActive", "lastUsedAt");

-- CreateIndex
CREATE INDEX "BackgroundClip_appId_kind_idx" ON "BackgroundClip"("appId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "VideoShot_videoId_order_key" ON "VideoShot"("videoId", "order");

-- CreateIndex
CREATE INDEX "VideoShot_videoId_startSec_idx" ON "VideoShot"("videoId", "startSec");

-- CreateIndex
CREATE INDEX "VideoShot_backgroundClipId_idx" ON "VideoShot"("backgroundClipId");

-- CreateIndex
CREATE INDEX "Video_editProfileId_idx" ON "Video"("editProfileId");

-- AddForeignKey
ALTER TABLE "EditProfile" ADD CONSTRAINT "EditProfile_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundClip" ADD CONSTRAINT "BackgroundClip_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoShot" ADD CONSTRAINT "VideoShot_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoShot" ADD CONSTRAINT "VideoShot_backgroundClipId_fkey" FOREIGN KEY ("backgroundClipId") REFERENCES "BackgroundClip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_editProfileId_fkey" FOREIGN KEY ("editProfileId") REFERENCES "EditProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
