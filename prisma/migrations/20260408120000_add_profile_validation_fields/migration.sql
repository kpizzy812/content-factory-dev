-- AlterTable
ALTER TABLE "TrendwatcherProfile" ADD COLUMN "validationStatus" TEXT;
ALTER TABLE "TrendwatcherProfile" ADD COLUMN "validationSummary" TEXT;
ALTER TABLE "TrendwatcherProfile" ADD COLUMN "validatedAt" TIMESTAMP(3);
