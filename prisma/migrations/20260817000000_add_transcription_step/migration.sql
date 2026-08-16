-- AlterEnum
ALTER TYPE "VideoStepKey" ADD VALUE 'transcription';

-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'transcript';

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "editPipeline" BOOLEAN NOT NULL DEFAULT false;
