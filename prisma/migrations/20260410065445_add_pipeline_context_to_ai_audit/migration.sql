-- AlterTable
ALTER TABLE "AiAuditLog" ADD COLUMN     "nodeCanvasId" TEXT,
ADD COLUMN     "pipelineId" INTEGER;

-- CreateIndex
CREATE INDEX "AiAuditLog_pipelineId_idx" ON "AiAuditLog"("pipelineId");
