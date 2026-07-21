-- CreateEnum
CREATE TYPE "TelegramDeliveryStatus" AS ENUM ('pending', 'sent', 'failed');

-- AlterTable
ALTER TABLE "TelegramChat" ADD COLUMN     "chatType" TEXT NOT NULL DEFAULT 'private',
ADD COLUMN     "isAuthorized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "routingTags" TEXT[],
ADD COLUMN     "title" TEXT,
ADD COLUMN     "username" TEXT;

-- CreateTable
CREATE TABLE "TelegramMessageTemplate" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'alert',
    "messageBody" TEXT NOT NULL,
    "variablesSchema" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramMessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramDelivery" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER,
    "eventType" TEXT NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityId" INTEGER,
    "targetChatId" TEXT NOT NULL,
    "status" "TelegramDeliveryStatus" NOT NULL DEFAULT 'pending',
    "telegramMessageId" INTEGER,
    "errorMessage" TEXT,
    "messageText" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramCommandAudit" (
    "id" SERIAL NOT NULL,
    "chatId" TEXT NOT NULL,
    "telegramUserId" TEXT,
    "telegramUsername" TEXT,
    "command" TEXT NOT NULL,
    "parsedArgs" TEXT,
    "resultStatus" TEXT NOT NULL DEFAULT 'success',
    "relatedEntityType" TEXT,
    "relatedEntityId" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramCommandAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramMessageTemplate_key_key" ON "TelegramMessageTemplate"("key");

-- CreateIndex
CREATE INDEX "TelegramDelivery_eventType_createdAt_idx" ON "TelegramDelivery"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "TelegramDelivery_targetChatId_createdAt_idx" ON "TelegramDelivery"("targetChatId", "createdAt");

-- CreateIndex
CREATE INDEX "TelegramDelivery_status_idx" ON "TelegramDelivery"("status");

-- CreateIndex
CREATE INDEX "TelegramCommandAudit_chatId_createdAt_idx" ON "TelegramCommandAudit"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "TelegramCommandAudit_command_createdAt_idx" ON "TelegramCommandAudit"("command", "createdAt");

-- AddForeignKey
ALTER TABLE "TelegramDelivery" ADD CONSTRAINT "TelegramDelivery_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TelegramMessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramDelivery" ADD CONSTRAINT "TelegramDelivery_targetChatId_fkey" FOREIGN KEY ("targetChatId") REFERENCES "TelegramChat"("chatId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramCommandAudit" ADD CONSTRAINT "TelegramCommandAudit_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "TelegramChat"("chatId") ON DELETE RESTRICT ON UPDATE CASCADE;
