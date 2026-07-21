-- CreateEnum
CREATE TYPE "IdeaSource" AS ENUM ('manual', 'telegram');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('pending', 'processing', 'ready', 'in_work', 'completed', 'failed');

-- CreateTable
CREATE TABLE "Idea" (
    "id" SERIAL NOT NULL,
    "appId" INTEGER,
    "source" "IdeaSource" NOT NULL DEFAULT 'manual',
    "sourceUrl" TEXT,
    "platform" "Platform",
    "transcription" TEXT,
    "language" TEXT,
    "title" TEXT,
    "hook" TEXT,
    "body" TEXT,
    "cta" TEXT,
    "visualStyle" TEXT,
    "whyViral" TEXT,
    "status" "IdeaStatus" NOT NULL DEFAULT 'pending',
    "createdById" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;
