-- CreateIndex
CREATE INDEX "PostingJob_status_retryAt_idx" ON "PostingJob"("status", "retryAt");

-- AddForeignKey
ALTER TABLE "PostingJob" ADD CONSTRAINT "PostingJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "ZavodUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingJob" ADD CONSTRAINT "PostingJob_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "ZavodUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
