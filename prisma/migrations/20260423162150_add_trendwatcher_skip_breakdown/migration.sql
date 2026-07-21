-- AlterTable
ALTER TABLE "TrendwatcherRun" ADD COLUMN     "dedupSkipCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "viewCountSkipCount" INTEGER NOT NULL DEFAULT 0;
