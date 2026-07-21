-- AlterEnum
ALTER TYPE "TaxonomyType" ADD VALUE 'kling_pattern';

-- AlterTable
ALTER TABLE "FavoritePrompt" ADD COLUMN     "aiAnalysisAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiAnalysisError" TEXT,
ADD COLUMN     "aiAnalyzedAt" TIMESTAMP(3),
ADD COLUMN     "aiPatternAnalysis" JSONB;
