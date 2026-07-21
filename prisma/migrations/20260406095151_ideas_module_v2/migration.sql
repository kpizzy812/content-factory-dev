-- CreateEnum
CREATE TYPE "IdeaActionType" AS ENUM ('create', 'edit', 'delete', 'restore', 'reanalyze', 'send_to_scenario');

-- AlterTable
ALTER TABLE "Idea" ADD COLUMN     "analysisStatus" "AnalysisStatus" NOT NULL DEFAULT 'none',
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "operatorNotes" TEXT,
ADD COLUMN     "sentToScenarioAt" TIMESTAMP(3),
ADD COLUMN     "tags" TEXT[];

-- CreateTable
CREATE TABLE "IdeaAnalysis" (
    "id" SERIAL NOT NULL,
    "ideaId" INTEGER NOT NULL,
    "hookAnalysis" JSONB NOT NULL,
    "sceneStructure" JSONB NOT NULL,
    "visualStyle" JSONB NOT NULL,
    "viralityReasons" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdeaAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaOperatorAction" (
    "id" SERIAL NOT NULL,
    "ideaId" INTEGER NOT NULL,
    "actionType" "IdeaActionType" NOT NULL,
    "reason" TEXT,
    "actorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaOperatorAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdeaAnalysis_ideaId_key" ON "IdeaAnalysis"("ideaId");

-- CreateIndex
CREATE INDEX "IdeaOperatorAction_ideaId_createdAt_idx" ON "IdeaOperatorAction"("ideaId", "createdAt");

-- CreateIndex
CREATE INDEX "Idea_isDeleted_status_idx" ON "Idea"("isDeleted", "status");

-- CreateIndex
CREATE INDEX "Idea_sourceUrl_idx" ON "Idea"("sourceUrl");

-- AddForeignKey
ALTER TABLE "IdeaAnalysis" ADD CONSTRAINT "IdeaAnalysis_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaOperatorAction" ADD CONSTRAINT "IdeaOperatorAction_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
