-- AlterTable
ALTER TABLE "PresenterRecordingUsage" ADD COLUMN     "frameHash" TEXT,
ADD COLUMN     "sceneIndex" INTEGER;

-- DropIndex
DROP INDEX "PresenterRecordingUsage_recordingId_usedAt_idx";

-- CreateIndex
CREATE UNIQUE INDEX "PresenterRecordingUsage_videoId_sceneIndex_key" ON "PresenterRecordingUsage"("videoId", "sceneIndex");

-- CreateIndex
CREATE INDEX "PresenterRecordingUsage_recordingId_usedAt_frameHash_idx" ON "PresenterRecordingUsage"("recordingId", "usedAt", "frameHash");
