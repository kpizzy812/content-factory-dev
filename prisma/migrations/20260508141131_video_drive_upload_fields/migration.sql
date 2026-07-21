-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "driveCredentialId" INTEGER,
ADD COLUMN     "driveFileId" TEXT;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_driveCredentialId_fkey" FOREIGN KEY ("driveCredentialId") REFERENCES "PipelineCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
