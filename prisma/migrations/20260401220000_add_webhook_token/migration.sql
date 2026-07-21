-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN "webhookToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_webhookToken_key" ON "Pipeline"("webhookToken");
