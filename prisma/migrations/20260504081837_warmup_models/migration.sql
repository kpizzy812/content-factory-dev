-- CreateEnum
CREATE TYPE "WarmupSessionStatus" AS ENUM ('planned', 'running', 'completed', 'partial', 'failed', 'cancelled', 'skipped');

-- CreateTable
CREATE TABLE "WarmupSession" (
    "id" TEXT NOT NULL,
    "socialAccountId" INTEGER NOT NULL,
    "status" "WarmupSessionStatus" NOT NULL DEFAULT 'planned',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "dayKey" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "ageBucket" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "executedActions" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmupSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarmupKeywordPool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appId" INTEGER,
    "language" TEXT,
    "category" TEXT NOT NULL,
    "platform" "Platform",
    "keywords" TEXT[],
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmupKeywordPool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarmupSession_socialAccountId_dayKey_idx" ON "WarmupSession"("socialAccountId", "dayKey");

-- CreateIndex
CREATE INDEX "WarmupSession_socialAccountId_scheduledAt_idx" ON "WarmupSession"("socialAccountId", "scheduledAt");

-- CreateIndex
CREATE INDEX "WarmupSession_status_scheduledAt_idx" ON "WarmupSession"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "WarmupKeywordPool_appId_isActive_idx" ON "WarmupKeywordPool"("appId", "isActive");

-- CreateIndex
CREATE INDEX "WarmupKeywordPool_category_idx" ON "WarmupKeywordPool"("category");

-- CreateIndex
CREATE INDEX "WarmupKeywordPool_platform_idx" ON "WarmupKeywordPool"("platform");

-- AddForeignKey
ALTER TABLE "WarmupSession" ADD CONSTRAINT "WarmupSession_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmupKeywordPool" ADD CONSTRAINT "WarmupKeywordPool_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;
