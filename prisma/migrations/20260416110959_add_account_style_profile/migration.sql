/*
  Warnings:

  - Added the required column `updatedAt` to the `AccountGroup` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AccountGroup" ADD COLUMN     "styleMode" TEXT NOT NULL DEFAULT 'independent',
ADD COLUMN     "stylePolicy" JSONB,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "AccountStyleProfile" (
    "id" SERIAL NOT NULL,
    "socialAccountId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_set',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountStyleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountStyleRevision" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "changeType" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "changedSections" TEXT[],
    "previousData" JSONB NOT NULL,
    "newData" JSONB NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "appliedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountStyleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountStyleProfile_socialAccountId_key" ON "AccountStyleProfile"("socialAccountId");

-- CreateIndex
CREATE INDEX "AccountStyleProfile_status_idx" ON "AccountStyleProfile"("status");

-- CreateIndex
CREATE INDEX "AccountStyleRevision_profileId_createdAt_idx" ON "AccountStyleRevision"("profileId", "createdAt");

-- AddForeignKey
ALTER TABLE "AccountStyleProfile" ADD CONSTRAINT "AccountStyleProfile_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountStyleRevision" ADD CONSTRAINT "AccountStyleRevision_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "AccountStyleProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
