-- CreateIndex
CREATE INDEX "WorkflowRun_pipelineId_createdAt_idx" ON "WorkflowRun"("pipelineId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_idx" ON "WorkflowRun"("status");
