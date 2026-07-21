/*
  Warnings:

  - A unique constraint covering the columns `[externalId]` on the table `Idea` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('none', 'synced', 'pending_export', 'pending_import', 'conflict', 'error');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('local', 'imported', 'exported', 'bidirectional');

-- AlterEnum
ALTER TYPE "IdeaSource" ADD VALUE 'marketingcamp';

-- AlterTable
ALTER TABLE "Idea" ADD COLUMN     "externalId" INTEGER,
ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "localDirty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remoteSnapshot" JSONB,
ADD COLUMN     "syncDirection" "SyncDirection" NOT NULL DEFAULT 'local',
ADD COLUMN     "syncStatus" "SyncStatus" NOT NULL DEFAULT 'none';

-- CreateIndex
CREATE UNIQUE INDEX "Idea_externalId_key" ON "Idea"("externalId");

-- CreateIndex
CREATE INDEX "Idea_externalId_idx" ON "Idea"("externalId");

-- CreateIndex
CREATE INDEX "Idea_syncStatus_idx" ON "Idea"("syncStatus");
