-- AlterTable
ALTER TABLE "TrendwatcherProfile" ADD COLUMN     "isInline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceNodeId" TEXT,
ADD COLUMN     "sourcePipelineId" INTEGER;

-- CreateIndex
CREATE INDEX "TrendwatcherProfile_isInline_idx" ON "TrendwatcherProfile"("isInline");

-- CreateIndex
CREATE INDEX "TrendwatcherProfile_appId_isInline_idx" ON "TrendwatcherProfile"("appId", "isInline");
