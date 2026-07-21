-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN     "profileId" INTEGER;

-- AlterTable
ALTER TABLE "ScenarioVariant" ADD COLUMN     "storyPlan" JSONB;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "voiceoverPlan" JSONB;

-- CreateTable
CREATE TABLE "ScenarioGenerationProfile" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "appId" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioGenerationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioFeedback" (
    "id" SERIAL NOT NULL,
    "scenarioId" INTEGER,
    "videoId" INTEGER,
    "uploadId" INTEGER,
    "feedbackText" TEXT NOT NULL,
    "sentiment" TEXT,
    "derived" JSONB,
    "source" TEXT NOT NULL DEFAULT 'operator',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioMemory" (
    "id" SERIAL NOT NULL,
    "appId" INTEGER,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "scopeId" INTEGER,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScenarioGenerationProfile_appId_idx" ON "ScenarioGenerationProfile"("appId");

-- CreateIndex
CREATE INDEX "ScenarioFeedback_scenarioId_idx" ON "ScenarioFeedback"("scenarioId");

-- CreateIndex
CREATE INDEX "ScenarioFeedback_videoId_idx" ON "ScenarioFeedback"("videoId");

-- CreateIndex
CREATE INDEX "ScenarioFeedback_uploadId_idx" ON "ScenarioFeedback"("uploadId");

-- CreateIndex
CREATE INDEX "ScenarioMemory_scope_idx" ON "ScenarioMemory"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioMemory_appId_scope_scopeId_key" ON "ScenarioMemory"("appId", "scope", "scopeId");

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ScenarioGenerationProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioGenerationProfile" ADD CONSTRAINT "ScenarioGenerationProfile_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioFeedback" ADD CONSTRAINT "ScenarioFeedback_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioMemory" ADD CONSTRAINT "ScenarioMemory_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;
