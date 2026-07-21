-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN     "webhookSecret" TEXT;

-- AlterTable
ALTER TABLE "PipelineCredential" ADD COLUMN     "revokedAt" TIMESTAMP(3);
