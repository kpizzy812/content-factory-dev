-- CreateEnum
CREATE TYPE "PostingJobStatus" AS ENUM ('scheduled', 'queued', 'preparing', 'uploading', 'published', 'failed', 'retry_queued', 'cancelled');

-- CreateEnum
CREATE TYPE "PostingErrorCategory" AS ENUM ('auth_failed', 'proxy_dead', 'network_error', 'platform_5xx', 'platform_validation', 'platform_rate_limit', 'content_rejected', 'account_locked', 'internal_error', 'unknown');

-- CreateTable
CREATE TABLE "PostingJob" (
    "id" TEXT NOT NULL,
    "videoId" INTEGER NOT NULL,
    "socialAccountId" INTEGER NOT NULL,
    "uploadId" INTEGER,
    "runId" INTEGER,
    "pipelineId" INTEGER,
    "status" "PostingJobStatus" NOT NULL DEFAULT 'queued',
    "scheduledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "contentSnapshot" JSONB NOT NULL,
    "platform" "Platform" NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "platformPostId" TEXT,
    "platformPostUrl" TEXT,
    "apiMadeWarning" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "errorCategory" "PostingErrorCategory",
    "retryAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "cancelledById" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostingJobLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingJobLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostingJob_uploadId_key" ON "PostingJob"("uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingJob_idempotencyKey_key" ON "PostingJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PostingJob_status_scheduledAt_idx" ON "PostingJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "PostingJob_socialAccountId_createdAt_idx" ON "PostingJob"("socialAccountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PostingJob_videoId_idx" ON "PostingJob"("videoId");

-- CreateIndex
CREATE INDEX "PostingJob_runId_pipelineId_idx" ON "PostingJob"("runId", "pipelineId");

-- CreateIndex
CREATE INDEX "PostingJob_retryAt_idx" ON "PostingJob"("retryAt");

-- CreateIndex
CREATE INDEX "PostingJobLog_jobId_createdAt_idx" ON "PostingJobLog"("jobId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "PostingJob" ADD CONSTRAINT "PostingJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingJob" ADD CONSTRAINT "PostingJob_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingJob" ADD CONSTRAINT "PostingJob_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingJob" ADD CONSTRAINT "PostingJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingJob" ADD CONSTRAINT "PostingJob_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingJobLog" ADD CONSTRAINT "PostingJobLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PostingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
