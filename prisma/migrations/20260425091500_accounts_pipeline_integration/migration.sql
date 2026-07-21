-- AlterTable
ALTER TABLE "AccountGroup" ADD COLUMN     "dispatchMode" TEXT NOT NULL DEFAULT 'round_robin';

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "lastPostedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "accountGroupId" INTEGER,
ADD COLUMN     "dispatchMode" TEXT;

-- CreateIndex
CREATE INDEX "AccountGroup_appId_idx" ON "AccountGroup"("appId");

-- CreateIndex
CREATE INDEX "SocialAccount_appId_status_idx" ON "SocialAccount"("appId", "status");

-- CreateIndex
CREATE INDEX "SocialAccount_appId_platform_status_idx" ON "SocialAccount"("appId", "platform", "status");

-- CreateIndex
CREATE INDEX "Upload_accountGroupId_idx" ON "Upload"("accountGroupId");

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_accountGroupId_fkey" FOREIGN KEY ("accountGroupId") REFERENCES "AccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
