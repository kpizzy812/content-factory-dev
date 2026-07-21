-- CreateEnum
CREATE TYPE "TaxonomyType" AS ENUM ('strategy', 'hook_style', 'prompt_pattern');

-- CreateTable
CREATE TABLE "TaxonomyItem" (
    "id" SERIAL NOT NULL,
    "type" "TaxonomyType" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "fullExplanation" TEXT,
    "category" TEXT,
    "tags" TEXT[],
    "examples" TEXT[],
    "useCases" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxonomyItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxonomyItem_type_isArchived_idx" ON "TaxonomyItem"("type", "isArchived");

-- CreateIndex
CREATE INDEX "TaxonomyItem_category_idx" ON "TaxonomyItem"("category");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyItem_type_slug_key" ON "TaxonomyItem"("type", "slug");
