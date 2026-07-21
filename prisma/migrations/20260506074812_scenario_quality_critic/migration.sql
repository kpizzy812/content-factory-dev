-- AlterTable
ALTER TABLE "ScenarioVariant" ADD COLUMN     "qualityCheckedAt" TIMESTAMP(3),
ADD COLUMN     "qualityScore" DOUBLE PRECISION,
ADD COLUMN     "qualityScoreDetails" JSONB;

-- CreateTable
CREATE TABLE "CriticReview" (
    "id" SERIAL NOT NULL,
    "scenarioId" INTEGER NOT NULL,
    "iteration" INTEGER NOT NULL,
    "variantsReviewed" INTEGER NOT NULL,
    "bestVariantId" INTEGER,
    "averageScore" DOUBLE PRECISION NOT NULL,
    "needsRework" BOOLEAN NOT NULL,
    "reachedThreshold" BOOLEAN NOT NULL,
    "fullReport" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "costEstimate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriticReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CriticReview_scenarioId_iteration_idx" ON "CriticReview"("scenarioId", "iteration");

-- CreateIndex
CREATE INDEX "CriticReview_scenarioId_createdAt_idx" ON "CriticReview"("scenarioId", "createdAt");

-- AddForeignKey
ALTER TABLE "CriticReview" ADD CONSTRAINT "CriticReview_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
