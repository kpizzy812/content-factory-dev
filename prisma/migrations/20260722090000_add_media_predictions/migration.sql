-- Durable, idempotent tracking for asynchronous paid media-provider jobs.
CREATE TABLE "MediaPrediction" (
    "id" TEXT NOT NULL,
    "videoId" INTEGER,
    "videoAssetId" INTEGER,
    "provider" TEXT NOT NULL DEFAULT 'replicate',
    "capability" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "externalId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'starting',
    "inputSnapshot" JSONB,
    "outputSnapshot" JSONB,
    "outputUrl" TEXT,
    "persistedStorageKey" TEXT,
    "persistedStorageProvider" TEXT,
    "persistedFileSizeBytes" BIGINT,
    "persistedFileSha256" TEXT,
    "persistedContentType" TEXT,
    "errorMessage" TEXT,
    "metrics" JSONB,
    "submittedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "terminalAt" TIMESTAMP(3),
    "webhookReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaPrediction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaPrediction_externalId_key" ON "MediaPrediction"("externalId");
CREATE UNIQUE INDEX "MediaPrediction_idempotencyKey_key" ON "MediaPrediction"("idempotencyKey");
CREATE INDEX "MediaPrediction_status_updatedAt_idx" ON "MediaPrediction"("status", "updatedAt");
CREATE INDEX "MediaPrediction_videoId_idx" ON "MediaPrediction"("videoId");
CREATE INDEX "MediaPrediction_videoAssetId_idx" ON "MediaPrediction"("videoAssetId");
CREATE INDEX "MediaPrediction_provider_externalId_idx" ON "MediaPrediction"("provider", "externalId");

ALTER TABLE "MediaPrediction"
ADD CONSTRAINT "MediaPrediction_videoId_fkey"
FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaPrediction"
ADD CONSTRAINT "MediaPrediction_videoAssetId_fkey"
FOREIGN KEY ("videoAssetId") REFERENCES "VideoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
