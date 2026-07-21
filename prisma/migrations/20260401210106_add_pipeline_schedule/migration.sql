-- CreateTable
CREATE TABLE "PipelineSchedule" (
    "id" SERIAL NOT NULL,
    "pipelineId" INTEGER NOT NULL,
    "cronExpr" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PipelineSchedule_pipelineId_key" ON "PipelineSchedule"("pipelineId");

-- AddForeignKey
ALTER TABLE "PipelineSchedule" ADD CONSTRAINT "PipelineSchedule_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
