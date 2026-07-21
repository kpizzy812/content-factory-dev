-- AlterTable
ALTER TABLE "App" ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "appStoreUrl" TEXT,
ADD COLUMN     "asoKeywords" TEXT[],
ADD COLUMN     "brandTone" TEXT,
ADD COLUMN     "categories" TEXT[],
ADD COLUMN     "coreOutcome" TEXT,
ADD COLUMN     "corePain" TEXT,
ADD COLUMN     "creativeAngles" JSONB,
ADD COLUMN     "developer" TEXT,
ADD COLUMN     "enrichmentError" TEXT,
ADD COLUMN     "enrichmentStatus" TEXT,
ADD COLUMN     "featureBullets" TEXT[],
ADD COLUMN     "forbiddenClaims" TEXT[],
ADD COLUMN     "heroImageUrl" TEXT,
ADD COLUMN     "iconUrl" TEXT,
ADD COLUMN     "lastEnrichedAt" TIMESTAMP(3),
ADD COLUMN     "longDescription" TEXT,
ADD COLUMN     "onboardingSummary" TEXT,
ADD COLUMN     "playStoreUrl" TEXT,
ADD COLUMN     "pricingNotes" TEXT,
ADD COLUMN     "productName" TEXT,
ADD COLUMN     "riskyClaims" TEXT[],
ADD COLUMN     "scenarioContext" JSONB,
ADD COLUMN     "screenshotUrls" TEXT[],
ADD COLUMN     "storePlatforms" TEXT[],
ADD COLUMN     "subtitle" TEXT,
ADD COLUMN     "targetAudience" TEXT,
ADD COLUMN     "transformationPromise" TEXT,
ADD COLUMN     "visualCues" TEXT;

-- CreateTable
CREATE TABLE "AppEnrichmentLog" (
    "id" SERIAL NOT NULL,
    "appId" INTEGER NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rawPayload" JSONB,
    "parsedData" JSONB,
    "aiContext" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppEnrichmentLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AppEnrichmentLog" ADD CONSTRAINT "AppEnrichmentLog_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
