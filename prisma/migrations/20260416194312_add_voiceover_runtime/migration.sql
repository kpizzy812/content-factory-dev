-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssetType" ADD VALUE 'voiceover';
ALTER TYPE "AssetType" ADD VALUE 'voiceover_mix';

-- AlterEnum
ALTER TYPE "VideoStatus" ADD VALUE 'generating_voiceover';

-- AlterEnum
ALTER TYPE "VideoStepKey" ADD VALUE 'voiceover_generation';

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "modelStrategy" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN     "musicVolume" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
ADD COLUMN     "musicVolumeWithVoiceover" DOUBLE PRECISION NOT NULL DEFAULT 0.12,
ADD COLUMN     "voiceoverEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "voiceoverLanguage" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "voiceoverModelId" TEXT,
ADD COLUMN     "voiceoverPacing" TEXT NOT NULL DEFAULT 'moderate',
ADD COLUMN     "voiceoverProvider" TEXT,
ADD COLUMN     "voiceoverReconciliation" TEXT NOT NULL DEFAULT 'extend_scene',
ADD COLUMN     "voiceoverVoiceId" TEXT;
