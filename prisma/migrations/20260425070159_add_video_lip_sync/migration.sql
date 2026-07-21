-- AlterEnum
ALTER TYPE "VideoStepKey" ADD VALUE 'lip_sync_generation';

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "lipSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lipSyncModelId" TEXT;
