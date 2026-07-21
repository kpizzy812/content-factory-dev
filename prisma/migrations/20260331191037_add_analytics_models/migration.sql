-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('active', 'deleted', 'blocked');

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "postStatus" "PostStatus" NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "PostMetrics" (
    "id" SERIAL NOT NULL,
    "uploadId" INTEGER NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "watchThrough" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "followerGain" INTEGER NOT NULL DEFAULT 0,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reference" (
    "id" SERIAL NOT NULL,
    "uploadId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "aiAnalysis" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostMetrics_uploadId_collectedAt_idx" ON "PostMetrics"("uploadId", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reference_uploadId_key" ON "Reference"("uploadId");

-- AddForeignKey
ALTER TABLE "PostMetrics" ADD CONSTRAINT "PostMetrics_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
