-- AlterTable
ALTER TABLE "TrendwatcherRun" ADD COLUMN     "apifyStatus" TEXT,
ADD COLUMN     "apifyStatusMessage" TEXT,
ADD COLUMN     "canRetry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "errorCategory" TEXT,
ADD COLUMN     "errorStep" TEXT,
ADD COLUMN     "errorSummary" TEXT,
ADD COLUMN     "needsProfileFix" BOOLEAN NOT NULL DEFAULT false;
