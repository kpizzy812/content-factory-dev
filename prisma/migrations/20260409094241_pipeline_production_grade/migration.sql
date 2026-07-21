-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StepStatus" ADD VALUE 'cancelled';
ALTER TYPE "StepStatus" ADD VALUE 'blocked';
ALTER TYPE "StepStatus" ADD VALUE 'waiting';

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN     "activeVersionId" INTEGER,
ADD COLUMN     "webhookEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PipelineSchedule" ADD COLUMN     "lastRunStatus" TEXT,
ADD COLUMN     "missedRunCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PipelineVersion" ADD COLUMN     "description" TEXT,
ADD COLUMN     "isDeployed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "cancelRequestedBy" INTEGER,
ADD COLUMN     "errorCategory" TEXT,
ADD COLUMN     "graphSnapshot" JSONB,
ADD COLUMN     "graphVersionId" INTEGER,
ADD COLUMN     "parentRunId" INTEGER,
ADD COLUMN     "replayOfRunId" INTEGER,
ADD COLUMN     "retryOfRunId" INTEGER;

-- AlterTable
ALTER TABLE "WorkflowStep" ADD COLUMN     "artifacts" JSONB,
ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorCategory" TEXT,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "logs" JSONB,
ADD COLUMN     "retryPolicy" JSONB,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" SERIAL NOT NULL,
    "pipelineId" INTEGER NOT NULL,
    "runId" INTEGER,
    "sourceIp" TEXT,
    "userAgent" TEXT,
    "payload" JSONB,
    "statusCode" INTEGER NOT NULL DEFAULT 200,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookLog_pipelineId_createdAt_idx" ON "WebhookLog"("pipelineId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_parentRunId_idx" ON "WorkflowRun"("parentRunId");

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
