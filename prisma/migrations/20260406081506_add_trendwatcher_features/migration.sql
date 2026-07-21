-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('none', 'pending', 'running', 'completed', 'failed');

-- AlterTable
ALTER TABLE "Trend" ADD COLUMN     "analysisStatus" "AnalysisStatus" NOT NULL DEFAULT 'none',
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "geo" TEXT,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "keyword" TEXT,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "shareCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CreativeBrief" (
    "id" SERIAL NOT NULL,
    "trendId" INTEGER NOT NULL,
    "hookAnalysis" JSONB NOT NULL,
    "sceneStructure" JSONB NOT NULL,
    "visualStyle" JSONB NOT NULL,
    "viralityReasons" JSONB NOT NULL,
    "frameAnalysisSettings" JSONB,
    "summary" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreativeBrief_trendId_key" ON "CreativeBrief"("trendId");

-- CreateIndex
CREATE INDEX "Trend_isDeleted_status_idx" ON "Trend"("isDeleted", "status");

-- CreateIndex
CREATE INDEX "Trend_platform_isDeleted_idx" ON "Trend"("platform", "isDeleted");

-- CreateIndex
CREATE INDEX "Trend_language_idx" ON "Trend"("language");

-- CreateIndex
CREATE INDEX "Trend_geo_idx" ON "Trend"("geo");

-- AddForeignKey
ALTER TABLE "CreativeBrief" ADD CONSTRAINT "CreativeBrief_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE CASCADE ON UPDATE CASCADE;
