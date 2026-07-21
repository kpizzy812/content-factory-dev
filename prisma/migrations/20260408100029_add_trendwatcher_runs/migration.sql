-- CreateEnum
CREATE TYPE "TrendwatcherRunStatus" AS ENUM ('pending', 'starting', 'running', 'importing', 'analyzing', 'completed', 'failed', 'canceled', 'partially_completed');

-- CreateEnum
CREATE TYPE "TrendwatcherTriggerType" AS ENUM ('manual', 'scheduled', 'pipeline');

-- AlterTable
ALTER TABLE "TrendwatcherProfile" ADD COLUMN     "lastRunId" INTEGER,
ADD COLUMN     "lastSuccessfulRunAt" TIMESTAMP(3),
ADD COLUMN     "maxItems" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "scheduleCron" TEXT,
ADD COLUMN     "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduleLastRunAt" TIMESTAMP(3),
ADD COLUMN     "scheduleNextRunAt" TIMESTAMP(3),
ADD COLUMN     "scheduleTimezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN     "viewCountMax" INTEGER,
ADD COLUMN     "viewCountMin" INTEGER;

-- CreateTable
CREATE TABLE "TrendwatcherRun" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "status" "TrendwatcherRunStatus" NOT NULL DEFAULT 'pending',
    "triggerType" "TrendwatcherTriggerType" NOT NULL DEFAULT 'manual',
    "externalRunId" TEXT,
    "sourceType" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "datasetId" TEXT,
    "foundCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "analyzedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "initiatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendwatcherRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendwatcherRunLog" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "level" "AgentLogLevel" NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "step" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendwatcherRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrendwatcherRun_profileId_status_idx" ON "TrendwatcherRun"("profileId", "status");

-- CreateIndex
CREATE INDEX "TrendwatcherRun_status_idx" ON "TrendwatcherRun"("status");

-- CreateIndex
CREATE INDEX "TrendwatcherRun_startedAt_idx" ON "TrendwatcherRun"("startedAt");

-- CreateIndex
CREATE INDEX "TrendwatcherRunLog_runId_createdAt_idx" ON "TrendwatcherRunLog"("runId", "createdAt");

-- AddForeignKey
ALTER TABLE "TrendwatcherRun" ADD CONSTRAINT "TrendwatcherRun_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TrendwatcherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendwatcherRunLog" ADD CONSTRAINT "TrendwatcherRunLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TrendwatcherRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
