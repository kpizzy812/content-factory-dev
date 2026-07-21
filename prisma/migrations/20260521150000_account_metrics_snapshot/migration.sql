-- AccountMetricsSnapshot: снимок метрик профиля соцсети из Apify profile-scrapers.
-- Идемпотентность 24h rolling — повторный fetch в течение суток отдаёт последний 'ok'-снимок.
-- onDelete: Cascade — снимки удаляются вместе с аккаунтом (бессмысленны без него).

-- CreateTable
CREATE TABLE "AccountMetricsSnapshot" (
    "id" TEXT NOT NULL,
    "socialAccountId" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followers" BIGINT,
    "following" BIGINT,
    "totalViews" BIGINT,
    "totalLikes" BIGINT,
    "totalComments" BIGINT,
    "postsCount" INTEGER,
    "avgViewsPer30d" BIGINT,
    "engagementRate" DOUBLE PRECISION,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "isVerified" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "errorMessage" TEXT,
    "rawData" JSONB,
    "agentRunId" INTEGER,

    CONSTRAINT "AccountMetricsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountMetricsSnapshot_socialAccountId_fetchedAt_idx" ON "AccountMetricsSnapshot"("socialAccountId", "fetchedAt" DESC);

-- CreateIndex
CREATE INDEX "AccountMetricsSnapshot_status_idx" ON "AccountMetricsSnapshot"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMetricsSnapshot_socialAccountId_fetchedAt_key" ON "AccountMetricsSnapshot"("socialAccountId", "fetchedAt");

-- AddForeignKey
ALTER TABLE "AccountMetricsSnapshot" ADD CONSTRAINT "AccountMetricsSnapshot_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
