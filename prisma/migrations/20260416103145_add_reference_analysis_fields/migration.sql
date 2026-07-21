-- AlterTable
ALTER TABLE "Idea" ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "referenceStatus" TEXT,
ADD COLUMN     "thumbnailUrl" TEXT;

-- AlterTable
ALTER TABLE "IdeaAnalysis" ADD COLUMN     "referenceBreakdown" JSONB,
ADD COLUMN     "referenceVersion" TEXT;
