/*
  Warnings:

  - You are about to drop the column `body` on the `Scenario` table. All the data in the column will be lost.
  - You are about to drop the column `cta` on the `Scenario` table. All the data in the column will be lost.
  - You are about to drop the column `fullScript` on the `Scenario` table. All the data in the column will be lost.
  - You are about to drop the column `hook` on the `Scenario` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Scenario` table. All the data in the column will be lost.
  - You are about to drop the column `visualStyle` on the `Scenario` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('draft', 'accepted', 'rejected', 'needs_rework', 'superseded');

-- CreateEnum
CREATE TYPE "ReviewActionType" AS ENUM ('accept', 'reject', 'rework', 'regenerate', 'delete_scenario', 'delete_variant', 'copy', 'regenerate_block');

-- AlterEnum
ALTER TYPE "ScenarioStatus" ADD VALUE 'generating';
ALTER TYPE "ScenarioStatus" ADD VALUE 'generated';
ALTER TYPE "ScenarioStatus" ADD VALUE 'needs_rework';
ALTER TYPE "ScenarioStatus" ADD VALUE 'archived';

-- AlterTable: добавляем новые поля (без удаления старых пока)
ALTER TABLE "Scenario"
ADD COLUMN     "appId" INTEGER,
ADD COLUMN     "briefId" INTEGER,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "generationStatus" TEXT,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "operatorNotes" TEXT,
ADD COLUMN     "reworkRequest" TEXT,
ADD COLUMN     "selectedVariantId" INTEGER,
ADD COLUMN     "sourceBriefVersion" TEXT,
ADD COLUMN     "sourcePromptVersion" TEXT;

-- CreateTable
CREATE TABLE "ScenarioVariant" (
    "id" SERIAL NOT NULL,
    "scenarioId" INTEGER NOT NULL,
    "variantIndex" INTEGER NOT NULL,
    "status" "VariantStatus" NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "fullScript" TEXT NOT NULL,
    "visualStyleText" TEXT NOT NULL,
    "visualStyleStructured" JSONB,
    "toneProfile" TEXT,
    "rationale" TEXT,
    "promptVersion" TEXT,
    "agentVersion" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioBlockRevision" (
    "id" SERIAL NOT NULL,
    "variantId" INTEGER NOT NULL,
    "blockType" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioBlockRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualStyleRevision" (
    "id" SERIAL NOT NULL,
    "variantId" INTEGER NOT NULL,
    "colors" JSONB,
    "atmosphere" TEXT,
    "character" TEXT,
    "stylePrompt" TEXT,
    "improvedPrompt" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualStyleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioReviewAction" (
    "id" SERIAL NOT NULL,
    "scenarioId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "actionType" "ReviewActionType" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioReviewAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScenarioVariant_scenarioId_status_idx" ON "ScenarioVariant"("scenarioId", "status");

-- CreateIndex
CREATE INDEX "ScenarioBlockRevision_variantId_blockType_idx" ON "ScenarioBlockRevision"("variantId", "blockType");

-- CreateIndex
CREATE INDEX "VisualStyleRevision_variantId_idx" ON "VisualStyleRevision"("variantId");

-- CreateIndex
CREATE INDEX "ScenarioReviewAction_scenarioId_createdAt_idx" ON "ScenarioReviewAction"("scenarioId", "createdAt");

-- CreateIndex
CREATE INDEX "Scenario_trendId_isDeleted_idx" ON "Scenario"("trendId", "isDeleted");

-- CreateIndex
CREATE INDEX "Scenario_status_isDeleted_idx" ON "Scenario"("status", "isDeleted");

-- AddForeignKey
ALTER TABLE "ScenarioVariant" ADD CONSTRAINT "ScenarioVariant_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioBlockRevision" ADD CONSTRAINT "ScenarioBlockRevision_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ScenarioVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualStyleRevision" ADD CONSTRAINT "VisualStyleRevision_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ScenarioVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioReviewAction" ADD CONSTRAINT "ScenarioReviewAction_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioReviewAction" ADD CONSTRAINT "ScenarioReviewAction_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ScenarioVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: перенос существующих сценариев в ScenarioVariant
-- Выполняется после COMMIT новых enum values (ALTER TYPE ADD VALUE требует отдельную транзакцию)
INSERT INTO "ScenarioVariant" ("scenarioId", "variantIndex", "status", "title", "hook", "body", "cta", "fullScript", "visualStyleText", "createdAt", "updatedAt")
SELECT
  s."id",
  ROW_NUMBER() OVER (PARTITION BY s."trendId" ORDER BY s."id") - 1,
  CASE s."status"
    WHEN 'selected' THEN 'accepted'::"VariantStatus"
    WHEN 'rejected' THEN 'rejected'::"VariantStatus"
    ELSE 'draft'::"VariantStatus"
  END,
  s."title",
  s."hook",
  s."body",
  s."cta",
  s."fullScript",
  s."visualStyle",
  s."createdAt",
  s."updatedAt"
FROM "Scenario" s;

-- Обновляем selectedVariantId для сценариев со статусом selected
UPDATE "Scenario" sc
SET "selectedVariantId" = sv."id"
FROM "ScenarioVariant" sv
WHERE sv."scenarioId" = sc."id" AND sv."status" = 'accepted';

-- Теперь безопасно удаляем старые колонки
ALTER TABLE "Scenario" DROP COLUMN "body",
DROP COLUMN "cta",
DROP COLUMN "fullScript",
DROP COLUMN "hook",
DROP COLUMN "title",
DROP COLUMN "visualStyle";
