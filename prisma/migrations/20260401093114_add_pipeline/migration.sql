-- CreateEnum
CREATE TYPE "PipelineStatus" AS ENUM ('active', 'inactive');

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "PipelineStatus" NOT NULL DEFAULT 'inactive',
    "graphData" JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    "sharedWith" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);
