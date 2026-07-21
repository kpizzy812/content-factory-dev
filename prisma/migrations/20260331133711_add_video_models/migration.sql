-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('pending', 'generating_images', 'generating_clips', 'assembling', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "VideoFormat" AS ENUM ('portrait', 'landscape');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('image', 'clip', 'music');

-- CreateTable
CREATE TABLE "Video" (
    "id" SERIAL NOT NULL,
    "scenarioId" INTEGER NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'pending',
    "format" "VideoFormat" NOT NULL DEFAULT 'portrait',
    "filePath" TEXT,
    "fileUrl" TEXT,
    "duration" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAsset" (
    "id" SERIAL NOT NULL,
    "videoId" INTEGER NOT NULL,
    "type" "AssetType" NOT NULL,
    "prompt" TEXT,
    "filePath" TEXT,
    "fileUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoAsset_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAsset" ADD CONSTRAINT "VideoAsset_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
