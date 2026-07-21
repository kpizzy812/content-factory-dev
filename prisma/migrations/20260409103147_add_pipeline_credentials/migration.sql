-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('api_key', 'bearer_token', 'basic_auth', 'oauth2', 'custom');

-- CreateTable
CREATE TABLE "PipelineCredential" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CredentialType" NOT NULL DEFAULT 'api_key',
    "encryptedData" TEXT NOT NULL,
    "metadata" JSONB,
    "description" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineCredential_userId_idx" ON "PipelineCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineCredential_userId_name_key" ON "PipelineCredential"("userId", "name");
