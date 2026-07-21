-- CreateTable
CREATE TABLE "PipelineTag" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PipelineTag_name_key" ON "PipelineTag"("name");

-- CreateTable (implicit many-to-many join table)
CREATE TABLE "_PipelineToPipelineTag" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_PipelineToPipelineTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_PipelineToPipelineTag_B_index" ON "_PipelineToPipelineTag"("B");

-- AddForeignKey
ALTER TABLE "_PipelineToPipelineTag" ADD CONSTRAINT "_PipelineToPipelineTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PipelineToPipelineTag" ADD CONSTRAINT "_PipelineToPipelineTag_B_fkey" FOREIGN KEY ("B") REFERENCES "PipelineTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate data: Insert unique tags from Pipeline.tags into PipelineTag
INSERT INTO "PipelineTag" ("name")
SELECT DISTINCT unnest(tags) FROM "Pipeline"
WHERE array_length(tags, 1) > 0
ON CONFLICT ("name") DO NOTHING;

-- Migrate data: Also insert tags from TaxonomyItem pipeline_category
INSERT INTO "PipelineTag" ("name")
SELECT DISTINCT "name" FROM "TaxonomyItem"
WHERE "type" = 'pipeline_category' AND "isArchived" = false
ON CONFLICT ("name") DO NOTHING;

-- Migrate data: Create join table relationships from existing tags arrays
INSERT INTO "_PipelineToPipelineTag" ("A", "B")
SELECT p.id, pt.id
FROM "Pipeline" p, unnest(p.tags) AS tag_name
JOIN "PipelineTag" pt ON pt."name" = tag_name
ON CONFLICT DO NOTHING;

-- AlterTable: Drop the old tags column (now replaced by m2m relation)
ALTER TABLE "Pipeline" DROP COLUMN "tags";
