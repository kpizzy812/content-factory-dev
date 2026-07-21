-- CreateEnum
CREATE TYPE "TrendStatus" AS ENUM ('new', 'reviewed', 'in_work', 'completed', 'dismissed');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('tiktok', 'instagram', 'youtube');

-- CreateEnum
CREATE TYPE "ScenarioStatus" AS ENUM ('draft', 'selected', 'rejected');

-- CreateTable
CREATE TABLE "App" (
    "id" SERIAL NOT NULL,
    "externalId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "keywords" TEXT[],
    "geo" TEXT,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trend" (
    "id" SERIAL NOT NULL,
    "externalId" INTEGER,
    "appId" INTEGER,
    "platform" "Platform" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "authorName" TEXT,
    "thumbnailUrl" TEXT,
    "videoUrl" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "hashtags" TEXT[],
    "publishedAt" TIMESTAMP(3),
    "status" "TrendStatus" NOT NULL DEFAULT 'new',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" SERIAL NOT NULL,
    "trendId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "fullScript" TEXT NOT NULL,
    "visualStyle" TEXT NOT NULL,
    "status" "ScenarioStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendInsight" (
    "id" SERIAL NOT NULL,
    "trendId" INTEGER NOT NULL,
    "whyViral" TEXT NOT NULL,
    "patterns" TEXT[],
    "hooks" TEXT[],
    "audience" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "App_externalId_key" ON "App"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Trend_externalId_key" ON "Trend"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TrendInsight_trendId_key" ON "TrendInsight"("trendId");

-- AddForeignKey
ALTER TABLE "Trend" ADD CONSTRAINT "Trend_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendInsight" ADD CONSTRAINT "TrendInsight_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE CASCADE ON UPDATE CASCADE;
