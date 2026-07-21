-- CreateTable
CREATE TABLE "AiAuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "nodeType" TEXT,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "suggestions" JSONB,
    "blockedFields" JSONB,
    "rejectedFields" JSONB,
    "appliedFields" JSONB,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAuditLog_userId_idx" ON "AiAuditLog"("userId");

-- CreateIndex
CREATE INDEX "AiAuditLog_action_idx" ON "AiAuditLog"("action");

-- CreateIndex
CREATE INDEX "AiAuditLog_createdAt_idx" ON "AiAuditLog"("createdAt");
