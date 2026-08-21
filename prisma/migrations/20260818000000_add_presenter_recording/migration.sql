-- CreateTable
CREATE TABLE "PresenterRecording" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'gcs',
    "sha1" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "fps" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "originalName" TEXT,
    "originalBytes" INTEGER,
    "retention" TEXT NOT NULL DEFAULT 'auto',
    "ingestStatus" TEXT NOT NULL DEFAULT 'pending',
    "ingestError" TEXT,
    "ingestStartedAt" TIMESTAMP(3),
    "ingestFinishedAt" TIMESTAMP(3),
    "cooledAt" TIMESTAMP(3),
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresenterRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresenterRecordingUsage" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "videoId" INTEGER,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PresenterRecordingUsage_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "PresenterSourceClip" ADD COLUMN     "recordingId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PresenterRecording_characterId_sha1_key" ON "PresenterRecording"("characterId", "sha1");

-- CreateIndex
CREATE INDEX "PresenterRecording_characterId_retention_createdAt_idx" ON "PresenterRecording"("characterId", "retention", "createdAt");

-- CreateIndex
CREATE INDEX "PresenterRecording_ingestStatus_idx" ON "PresenterRecording"("ingestStatus");

-- CreateIndex
CREATE INDEX "PresenterRecordingUsage_recordingId_usedAt_idx" ON "PresenterRecordingUsage"("recordingId", "usedAt");

-- CreateIndex
CREATE INDEX "PresenterRecordingUsage_videoId_idx" ON "PresenterRecordingUsage"("videoId");

-- CreateIndex
CREATE INDEX "PresenterSourceClip_recordingId_idx" ON "PresenterSourceClip"("recordingId");

-- AddForeignKey
ALTER TABLE "PresenterRecording" ADD CONSTRAINT "PresenterRecording_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenterRecordingUsage" ADD CONSTRAINT "PresenterRecordingUsage_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "PresenterRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenterSourceClip" ADD CONSTRAINT "PresenterSourceClip_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "PresenterRecording"("id") ON DELETE SET NULL ON UPDATE CASCADE;
