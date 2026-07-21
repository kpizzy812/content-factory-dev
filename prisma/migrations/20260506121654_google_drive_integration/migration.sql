-- CreateEnum
CREATE TYPE "DriveSyncStatus" AS ENUM ('detected', 'downloading', 'downloaded', 'imported_to_video', 'failed');

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "externalSource" TEXT,
ADD COLUMN     "externalSourceId" TEXT,
ADD COLUMN     "isExternalCreative" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DriveFile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "credentialId" INTEGER NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "driveCreatedAt" TIMESTAMP(3),
    "driveModifiedAt" TIMESTAMP(3),
    "driveUrl" TEXT,
    "thumbnailUrl" TEXT,
    "videoId" INTEGER,
    "syncStatus" "DriveSyncStatus" NOT NULL DEFAULT 'detected',
    "localPath" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "hasGeneratedCaption" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriveFile_videoId_key" ON "DriveFile"("videoId");

-- CreateIndex
CREATE INDEX "DriveFile_syncStatus_idx" ON "DriveFile"("syncStatus");

-- CreateIndex
CREATE INDEX "DriveFile_hasGeneratedCaption_idx" ON "DriveFile"("hasGeneratedCaption");

-- CreateIndex
CREATE INDEX "DriveFile_userId_idx" ON "DriveFile"("userId");

-- CreateIndex
CREATE INDEX "DriveFile_videoId_idx" ON "DriveFile"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "DriveFile_credentialId_driveFileId_key" ON "DriveFile"("credentialId", "driveFileId");

-- CreateIndex
CREATE INDEX "Video_externalSource_externalSourceId_idx" ON "Video"("externalSource", "externalSourceId");

-- AddForeignKey
ALTER TABLE "DriveFile" ADD CONSTRAINT "DriveFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ZavodUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveFile" ADD CONSTRAINT "DriveFile_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "PipelineCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveFile" ADD CONSTRAINT "DriveFile_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;
