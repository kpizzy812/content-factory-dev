-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "generateAudio" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "imageModelId" TEXT NOT NULL DEFAULT 'fal-ai/flux/dev',
ADD COLUMN     "videoModelId" TEXT NOT NULL DEFAULT 'fal-ai/kling-video/v3/standard/text-to-video';
