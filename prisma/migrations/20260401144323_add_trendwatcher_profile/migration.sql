-- CreateTable
CREATE TABLE "TrendwatcherProfile" (
    "id" SERIAL NOT NULL,
    "appId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "actorId" TEXT NOT NULL DEFAULT 'apify/tiktok-scraper',
    "keywords" TEXT[],
    "platforms" "Platform"[],
    "language" TEXT,
    "geo" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendwatcherProfile_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TrendwatcherProfile" ADD CONSTRAINT "TrendwatcherProfile_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
