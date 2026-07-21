-- CreateTable
CREATE TABLE "VideoUniqueVariant" (
    "id" TEXT NOT NULL,
    "videoId" INTEGER NOT NULL,
    "platform" "Platform" NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "paramsJson" JSONB NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoUniqueVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoUniqueVariant_videoId_idx" ON "VideoUniqueVariant"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoUniqueVariant_videoId_platform_paramsHash_key" ON "VideoUniqueVariant"("videoId", "platform", "paramsHash");

-- AddForeignKey
ALTER TABLE "VideoUniqueVariant" ADD CONSTRAINT "VideoUniqueVariant_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
