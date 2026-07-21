-- CreateTable
CREATE TABLE "Caption" (
    "id" TEXT NOT NULL,
    "videoId" INTEGER NOT NULL,
    "platform" "Platform" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "hashtags" TEXT[],
    "charsTitle" INTEGER NOT NULL,
    "charsHashtagsTotal" INTEGER NOT NULL,
    "fitsLimits" BOOLEAN NOT NULL DEFAULT true,
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "generationCost" DOUBLE PRECISION,
    "generatedById" INTEGER,
    "runId" INTEGER,
    "pipelineId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "approvedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Caption_videoId_idx" ON "Caption"("videoId");

-- CreateIndex
CREATE INDEX "Caption_runId_pipelineId_idx" ON "Caption"("runId", "pipelineId");

-- CreateIndex
CREATE UNIQUE INDEX "Caption_videoId_platform_key" ON "Caption"("videoId", "platform");

-- AddForeignKey
ALTER TABLE "Caption" ADD CONSTRAINT "Caption_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
