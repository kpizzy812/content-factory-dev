-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'stopped');

-- CreateEnum
CREATE TYPE "AgentLogLevel" AS ENUM ('info', 'warn', 'error');

-- CreateTable
CREATE TABLE "ProductionCycle" (
    "id" SERIAL NOT NULL,
    "appId" INTEGER NOT NULL,
    "groupId" INTEGER,
    "status" "CycleStatus" NOT NULL DEFAULT 'pending',
    "startedById" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "trendsFound" INTEGER NOT NULL DEFAULT 0,
    "scenariosGen" INTEGER NOT NULL DEFAULT 0,
    "videosGen" INTEGER NOT NULL DEFAULT 0,
    "uploadsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentLog" (
    "id" SERIAL NOT NULL,
    "cycleId" INTEGER,
    "module" TEXT NOT NULL,
    "level" "AgentLogLevel" NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentLog_module_createdAt_idx" ON "AgentLog"("module", "createdAt");

-- CreateIndex
CREATE INDEX "AgentLog_level_createdAt_idx" ON "AgentLog"("level", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductionCycle" ADD CONSTRAINT "ProductionCycle_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCycle" ADD CONSTRAINT "ProductionCycle_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentLog" ADD CONSTRAINT "AgentLog_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ProductionCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
