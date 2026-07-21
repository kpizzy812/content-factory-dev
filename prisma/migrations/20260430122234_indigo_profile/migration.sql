-- CreateEnum
CREATE TYPE "IndigoSyncStatus" AS ENUM ('synced', 'local_only', 'remote_only', 'conflict', 'deleted_remote', 'error');

-- CreateTable
CREATE TABLE "IndigoProfile" (
    "id" TEXT NOT NULL,
    "indigoId" TEXT,
    "indigoFolderId" TEXT,
    "socialAccountId" INTEGER,
    "proxyId" TEXT,
    "name" TEXT NOT NULL,
    "platformType" TEXT NOT NULL DEFAULT 'desktop',
    "os" TEXT,
    "userAgent" TEXT,
    "screenResolution" TEXT,
    "language" TEXT,
    "timezone" TEXT,
    "config" JSONB,
    "syncStatus" "IndigoSyncStatus" NOT NULL DEFAULT 'local_only',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "totalSessions" INTEGER NOT NULL DEFAULT 0,
    "lastSessionStartedAt" TIMESTAMP(3),
    "lastSessionEndedAt" TIMESTAMP(3),
    "lastSessionPort" INTEGER,
    "cookiesSnapshot" TEXT,
    "cookiesUpdatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndigoProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndigoProfile_indigoId_key" ON "IndigoProfile"("indigoId");

-- CreateIndex
CREATE UNIQUE INDEX "IndigoProfile_socialAccountId_key" ON "IndigoProfile"("socialAccountId");

-- CreateIndex
CREATE INDEX "IndigoProfile_syncStatus_idx" ON "IndigoProfile"("syncStatus");

-- CreateIndex
CREATE INDEX "IndigoProfile_socialAccountId_idx" ON "IndigoProfile"("socialAccountId");

-- CreateIndex
CREATE INDEX "IndigoProfile_proxyId_idx" ON "IndigoProfile"("proxyId");

-- AddForeignKey
ALTER TABLE "IndigoProfile" ADD CONSTRAINT "IndigoProfile_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndigoProfile" ADD CONSTRAINT "IndigoProfile_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
