-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN     "hypothesisId" TEXT;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "lipSyncCharacterId" TEXT;

-- AlterTable
ALTER TABLE "ProductionCycle" ADD COLUMN     "batchKey" TEXT,
ADD COLUMN     "dailyLimitPerAccount" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "funnelId" TEXT,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "pipelineId" INTEGER,
ADD COLUMN     "sourceContext" JSONB,
ADD COLUMN     "targetCount" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "cycleId" INTEGER,
ADD COLUMN     "inputContext" JSONB,
ADD COLUMN     "trackingToken" TEXT;

-- CreateTable
CREATE TABLE "PresenterSourceClip" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "name" TEXT,
    "fileUrl" TEXT NOT NULL,
    "storageKey" TEXT,
    "storageProvider" TEXT NOT NULL DEFAULT 'gcs',
    "sha1" TEXT NOT NULL,
    "mimeType" TEXT,
    "bytes" INTEGER,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "tags" TEXT[],
    "outfit" TEXT,
    "background" TEXT,
    "gesture" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresenterSourceClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadMagnet" (
    "id" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "problem" TEXT,
    "audience" TEXT,
    "content" JSONB NOT NULL,
    "deliveryMessage" TEXT,
    "warmupMessages" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadMagnet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentFunnel" (
    "id" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "leadMagnetId" TEXT,
    "name" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "deliveryAdapter" TEXT NOT NULL,
    "deliveryConfig" JSONB,
    "automationAdapter" TEXT,
    "automationConfig" JSONB,
    "conversionAdapter" TEXT NOT NULL,
    "conversionUrl" TEXT NOT NULL,
    "conversionTrackingParam" TEXT NOT NULL DEFAULT 'tracking_token',
    "webhookSecretHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentFunnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentHypothesis" (
    "id" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "cycleId" INTEGER,
    "runId" INTEGER,
    "trackingToken" TEXT,
    "funnelId" TEXT,
    "leadMagnetId" TEXT,
    "ordinal" INTEGER,
    "title" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "promise" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "keyword" TEXT,
    "proofPoints" JSONB NOT NULL,
    "evidence" JSONB,
    "sourceTrendIds" INTEGER[],
    "sourceIdeaIds" INTEGER[],
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "rawOutput" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentHypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactoryPublication" (
    "id" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "cycleId" INTEGER NOT NULL,
    "runId" INTEGER NOT NULL,
    "funnelId" TEXT,
    "hypothesisId" TEXT,
    "socialAccountId" INTEGER NOT NULL,
    "platform" "Platform" NOT NULL,
    "trackingToken" TEXT NOT NULL,
    "keyword" TEXT,
    "videoId" INTEGER,
    "uploadId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "platformPostId" TEXT,
    "platformPostUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactoryPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactoryQualityReview" (
    "id" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "cycleId" INTEGER,
    "runId" INTEGER NOT NULL,
    "hypothesisId" TEXT,
    "scenarioId" INTEGER,
    "videoId" INTEGER,
    "stage" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "checks" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactoryQualityReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionEvent" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "trackingToken" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "externalEventId" TEXT,
    "externalUserId" TEXT,
    "messengerUserId" TEXT,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PresenterSourceClip_characterId_isActive_lastUsedAt_idx" ON "PresenterSourceClip"("characterId", "isActive", "lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PresenterSourceClip_characterId_sha1_key" ON "PresenterSourceClip"("characterId", "sha1");

-- CreateIndex
CREATE INDEX "LeadMagnet_appId_status_idx" ON "LeadMagnet"("appId", "status");

-- CreateIndex
CREATE INDEX "ContentFunnel_appId_status_idx" ON "ContentFunnel"("appId", "status");

-- CreateIndex
CREATE INDEX "ContentFunnel_leadMagnetId_idx" ON "ContentFunnel"("leadMagnetId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentHypothesis_runId_key" ON "ContentHypothesis"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentHypothesis_trackingToken_key" ON "ContentHypothesis"("trackingToken");

-- CreateIndex
CREATE INDEX "ContentHypothesis_appId_status_createdAt_idx" ON "ContentHypothesis"("appId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentHypothesis_funnelId_idx" ON "ContentHypothesis"("funnelId");

-- CreateIndex
CREATE INDEX "ContentHypothesis_leadMagnetId_idx" ON "ContentHypothesis"("leadMagnetId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentHypothesis_cycleId_fingerprint_key" ON "ContentHypothesis"("cycleId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryPublication_uploadId_key" ON "FactoryPublication"("uploadId");

-- CreateIndex
CREATE INDEX "FactoryPublication_cycleId_status_idx" ON "FactoryPublication"("cycleId", "status");

-- CreateIndex
CREATE INDEX "FactoryPublication_hypothesisId_idx" ON "FactoryPublication"("hypothesisId");

-- CreateIndex
CREATE INDEX "FactoryPublication_trackingToken_platform_idx" ON "FactoryPublication"("trackingToken", "platform");

-- CreateIndex
CREATE INDEX "FactoryPublication_socialAccountId_platformPostId_idx" ON "FactoryPublication"("socialAccountId", "platformPostId");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryPublication_runId_socialAccountId_key" ON "FactoryPublication"("runId", "socialAccountId");

-- CreateIndex
CREATE INDEX "FactoryQualityReview_cycleId_verdict_idx" ON "FactoryQualityReview"("cycleId", "verdict");

-- CreateIndex
CREATE INDEX "FactoryQualityReview_hypothesisId_idx" ON "FactoryQualityReview"("hypothesisId");

-- CreateIndex
CREATE INDEX "FactoryQualityReview_scenarioId_idx" ON "FactoryQualityReview"("scenarioId");

-- CreateIndex
CREATE INDEX "FactoryQualityReview_videoId_idx" ON "FactoryQualityReview"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryQualityReview_runId_stage_key" ON "FactoryQualityReview"("runId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "AttributionEvent_idempotencyKey_key" ON "AttributionEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AttributionEvent_trackingToken_occurredAt_idx" ON "AttributionEvent"("trackingToken", "occurredAt");

-- CreateIndex
CREATE INDEX "AttributionEvent_publicationId_type_occurredAt_idx" ON "AttributionEvent"("publicationId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "AttributionEvent_source_externalEventId_idx" ON "AttributionEvent"("source", "externalEventId");

-- CreateIndex
CREATE INDEX "Scenario_hypothesisId_isDeleted_idx" ON "Scenario"("hypothesisId", "isDeleted");

-- CreateIndex
CREATE INDEX "Video_lipSyncCharacterId_idx" ON "Video"("lipSyncCharacterId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionCycle_batchKey_key" ON "ProductionCycle"("batchKey");

-- CreateIndex
CREATE INDEX "ProductionCycle_pipelineId_status_idx" ON "ProductionCycle"("pipelineId", "status");

-- CreateIndex
CREATE INDEX "ProductionCycle_mode_status_startedAt_idx" ON "ProductionCycle"("mode", "status", "startedAt");

-- CreateIndex
CREATE INDEX "ProductionCycle_funnelId_idx" ON "ProductionCycle"("funnelId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_trackingToken_key" ON "WorkflowRun"("trackingToken");

-- CreateIndex
CREATE INDEX "WorkflowRun_cycleId_status_idx" ON "WorkflowRun"("cycleId", "status");

-- AddForeignKey
ALTER TABLE "PresenterSourceClip" ADD CONSTRAINT "PresenterSourceClip_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "ContentHypothesis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_lipSyncCharacterId_fkey" FOREIGN KEY ("lipSyncCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCycle" ADD CONSTRAINT "ProductionCycle_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCycle" ADD CONSTRAINT "ProductionCycle_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "ContentFunnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMagnet" ADD CONSTRAINT "LeadMagnet_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentFunnel" ADD CONSTRAINT "ContentFunnel_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentFunnel" ADD CONSTRAINT "ContentFunnel_leadMagnetId_fkey" FOREIGN KEY ("leadMagnetId") REFERENCES "LeadMagnet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentHypothesis" ADD CONSTRAINT "ContentHypothesis_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentHypothesis" ADD CONSTRAINT "ContentHypothesis_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ProductionCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentHypothesis" ADD CONSTRAINT "ContentHypothesis_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentHypothesis" ADD CONSTRAINT "ContentHypothesis_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "ContentFunnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentHypothesis" ADD CONSTRAINT "ContentHypothesis_leadMagnetId_fkey" FOREIGN KEY ("leadMagnetId") REFERENCES "LeadMagnet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPublication" ADD CONSTRAINT "FactoryPublication_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPublication" ADD CONSTRAINT "FactoryPublication_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ProductionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPublication" ADD CONSTRAINT "FactoryPublication_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPublication" ADD CONSTRAINT "FactoryPublication_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "ContentFunnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPublication" ADD CONSTRAINT "FactoryPublication_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "ContentHypothesis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPublication" ADD CONSTRAINT "FactoryPublication_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPublication" ADD CONSTRAINT "FactoryPublication_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPublication" ADD CONSTRAINT "FactoryPublication_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryQualityReview" ADD CONSTRAINT "FactoryQualityReview_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryQualityReview" ADD CONSTRAINT "FactoryQualityReview_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ProductionCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryQualityReview" ADD CONSTRAINT "FactoryQualityReview_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryQualityReview" ADD CONSTRAINT "FactoryQualityReview_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "ContentHypothesis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryQualityReview" ADD CONSTRAINT "FactoryQualityReview_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryQualityReview" ADD CONSTRAINT "FactoryQualityReview_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvent" ADD CONSTRAINT "AttributionEvent_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "FactoryPublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ProductionCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
