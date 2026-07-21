-- AlterTable: Add tags column
ALTER TABLE "Pipeline" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

-- Migrate: Copy existing category values into tags array
UPDATE "Pipeline" SET "tags" = ARRAY["category"] WHERE "category" IS NOT NULL AND "category" != '';

-- AlterTable: Drop category column
ALTER TABLE "Pipeline" DROP COLUMN "category";
