-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "analysisData" JSONB,
ADD COLUMN     "analysisDurationSec" DOUBLE PRECISION,
ADD COLUMN     "fitRationale" TEXT,
ADD COLUMN     "fitScore" DOUBLE PRECISION,
ADD COLUMN     "framePassRunAt" TIMESTAMP(3),
ADD COLUMN     "framePassVersion" TEXT;

-- CreateTable
CREATE TABLE "VideoFrame" (
    "id" SERIAL NOT NULL,
    "videoId" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestampSec" DOUBLE PRECISION NOT NULL,
    "filePath" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "isSceneBoundary" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "keyElements" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoFrame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoFrame_videoId_idx" ON "VideoFrame"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoFrame_videoId_sequence_key" ON "VideoFrame"("videoId", "sequence");

-- CreateIndex
CREATE INDEX "Video_framePassRunAt_idx" ON "Video"("framePassRunAt");

-- AddForeignKey
ALTER TABLE "VideoFrame" ADD CONSTRAINT "VideoFrame_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
