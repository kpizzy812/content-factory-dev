-- AlterTable
ALTER TABLE "Idea" ADD COLUMN     "pipelineId" INTEGER,
ADD COLUMN     "runId" INTEGER;

-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN     "pipelineId" INTEGER,
ADD COLUMN     "runId" INTEGER;

-- AlterTable
ALTER TABLE "Trend" ADD COLUMN     "pipelineId" INTEGER,
ADD COLUMN     "runId" INTEGER;

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "pipelineId" INTEGER,
ADD COLUMN     "runId" INTEGER;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "pipelineId" INTEGER,
ADD COLUMN     "runId" INTEGER;

-- CreateIndex
CREATE INDEX "Idea_runId_idx" ON "Idea"("runId");

-- CreateIndex
CREATE INDEX "Idea_pipelineId_idx" ON "Idea"("pipelineId");

-- CreateIndex
CREATE INDEX "Scenario_runId_idx" ON "Scenario"("runId");

-- CreateIndex
CREATE INDEX "Scenario_pipelineId_idx" ON "Scenario"("pipelineId");

-- CreateIndex
CREATE INDEX "Trend_runId_idx" ON "Trend"("runId");

-- CreateIndex
CREATE INDEX "Trend_pipelineId_idx" ON "Trend"("pipelineId");

-- CreateIndex
CREATE INDEX "Upload_runId_idx" ON "Upload"("runId");

-- CreateIndex
CREATE INDEX "Upload_pipelineId_idx" ON "Upload"("pipelineId");

-- CreateIndex
CREATE INDEX "Video_runId_idx" ON "Video"("runId");

-- CreateIndex
CREATE INDEX "Video_pipelineId_idx" ON "Video"("pipelineId");

-- AddForeignKey
ALTER TABLE "Trend" ADD CONSTRAINT "Trend_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trend" ADD CONSTRAINT "Trend_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
