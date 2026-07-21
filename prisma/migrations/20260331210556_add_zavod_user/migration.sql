-- CreateEnum
CREATE TYPE "RolePreset" AS ENUM ('admin', 'producer', 'operator', 'analyst', 'observer');

-- CreateTable
CREATE TABLE "ZavodUser" (
    "id" SERIAL NOT NULL,
    "externalId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "surname" TEXT,
    "rolePreset" "RolePreset" NOT NULL DEFAULT 'operator',
    "canRead" BOOLEAN NOT NULL DEFAULT true,
    "canWrite" BOOLEAN NOT NULL DEFAULT false,
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "canApprove" BOOLEAN NOT NULL DEFAULT false,
    "canRunAgent" BOOLEAN NOT NULL DEFAULT false,
    "canApplyChanges" BOOLEAN NOT NULL DEFAULT false,
    "canAdmin" BOOLEAN NOT NULL DEFAULT false,
    "moduleAccess" TEXT[],
    "appAccess" INTEGER[],
    "telegramChatId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZavodUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZavodUser_externalId_key" ON "ZavodUser"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ZavodUser_email_key" ON "ZavodUser"("email");
