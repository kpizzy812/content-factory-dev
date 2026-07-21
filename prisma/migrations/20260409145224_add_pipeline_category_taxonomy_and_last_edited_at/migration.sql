-- AlterEnum
ALTER TYPE "TaxonomyType" ADD VALUE 'pipeline_category';

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN     "lastEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
