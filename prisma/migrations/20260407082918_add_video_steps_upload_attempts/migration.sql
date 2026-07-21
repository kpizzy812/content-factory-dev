-- CreateEnum
CREATE TYPE "VideoStepKey" AS ENUM ('prompt_generation', 'image_generation', 'clip_generation', 'music_generation', 'assembly');

-- CreateEnum
CREATE TYPE "VideoStepStatus" AS ENUM ('pending', 'queued', 'running', 'completed', 'failed', 'canceled', 'skipped');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UploadStatus" ADD VALUE 'canceled';
ALTER TYPE "UploadStatus" ADD VALUE 'blocked_by_env';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VideoStatus" ADD VALUE 'configuring';
ALTER TYPE "VideoStatus" ADD VALUE 'generating_prompts';
ALTER TYPE "VideoStatus" ADD VALUE 'generating_music';
ALTER TYPE "VideoStatus" ADD VALUE 'canceled';

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "applicationId" INTEGER,
ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blockedByEnv" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "publishMode" TEXT NOT NULL DEFAULT 'immediate';

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "applicationId" INTEGER,
ADD COLUMN     "currentStep" TEXT,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedReason" TEXT,
ADD COLUMN     "musicDuration" INTEGER,
ADD COLUMN     "musicEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "musicMood" TEXT,
ADD COLUMN     "renderQuality" TEXT NOT NULL DEFAULT 'medium',
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "subtitlesEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "subtitlesStyle" JSONB,
ADD COLUMN     "targetPlatform" TEXT,
ADD COLUMN     "totalCostActual" DOUBLE PRECISION,
ADD COLUMN     "totalCostEstimate" DOUBLE PRECISION,
ADD COLUMN     "variantId" INTEGER;

-- CreateTable
CREATE TABLE "VideoGenerationStep" (
    "id" SERIAL NOT NULL,
    "videoId" INTEGER NOT NULL,
    "stepKey" "VideoStepKey" NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "status" "VideoStepStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "inputSnapshot" JSONB,
    "outputSnapshot" JSONB,
    "artifacts" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "estimatedCost" DOUBLE PRECISION,
    "actualCost" DOUBLE PRECISION,
    "logs" JSONB,
    "errorMessage" TEXT,
    "falRequestId" TEXT,
    "falEndpoint" TEXT,
    "falQueueStatus" TEXT,
    "falLogsSnapshot" JSONB,
    "falSubmittedAt" TIMESTAMP(3),
    "falCompletedAt" TIMESTAMP(3),
    "falCanceledAt" TIMESTAMP(3),
    "falWebhookReceivedAt" TIMESTAMP(3),
    "falResultUrl" TEXT,
    "falErrorCode" TEXT,
    "falAttemptGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoGenerationStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialUploadAttempt" (
    "id" SERIAL NOT NULL,
    "uploadId" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "requestSnapshot" JSONB,
    "responseSnapshot" JSONB,
    "externalUploadId" TEXT,
    "externalPostId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialUploadAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoGenerationStep_videoId_stepKey_idx" ON "VideoGenerationStep"("videoId", "stepKey");

-- CreateIndex
CREATE INDEX "VideoGenerationStep_falRequestId_idx" ON "VideoGenerationStep"("falRequestId");

-- CreateIndex
CREATE INDEX "VideoGenerationStep_status_idx" ON "VideoGenerationStep"("status");

-- CreateIndex
CREATE INDEX "SocialUploadAttempt_uploadId_attemptNumber_idx" ON "SocialUploadAttempt"("uploadId", "attemptNumber");

-- CreateIndex
CREATE INDEX "Upload_status_idx" ON "Upload"("status");

-- CreateIndex
CREATE INDEX "Upload_videoId_idx" ON "Upload"("videoId");

-- CreateIndex
CREATE INDEX "Video_scenarioId_status_idx" ON "Video"("scenarioId", "status");

-- CreateIndex
CREATE INDEX "Video_status_idx" ON "Video"("status");

-- AddForeignKey
ALTER TABLE "VideoGenerationStep" ADD CONSTRAINT "VideoGenerationStep_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialUploadAttempt" ADD CONSTRAINT "SocialUploadAttempt_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
