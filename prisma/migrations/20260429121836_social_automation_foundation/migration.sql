-- CreateEnum
CREATE TYPE "ProxyType" AS ENUM ('mobile', 'residential', 'datacenter');

-- CreateEnum
CREATE TYPE "ProxyStatus" AS ENUM ('unverified', 'healthy', 'degraded', 'dead', 'expired');

-- CreateEnum
CREATE TYPE "WarmupStatus" AS ENUM ('new', 'warming', 'ready', 'cold');

-- CreateEnum
CREATE TYPE "RegistrationSource" AS ENUM ('self', 'purchased', 'transferred');

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "birthDate" TIMESTAMP(3),
ADD COLUMN     "indigoProfileId" TEXT,
ADD COLUMN     "lastWarmupAt" TIMESTAMP(3),
ADD COLUMN     "loginEmail" TEXT,
ADD COLUMN     "loginPassword" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "proxyId" TEXT,
ADD COLUMN     "recoveryEmail" TEXT,
ADD COLUMN     "recoveryPhone" TEXT,
ADD COLUMN     "registrationSource" "RegistrationSource",
ADD COLUMN     "totalPostsPublished" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "twoFASecret" TEXT,
ADD COLUMN     "warmupStatus" "WarmupStatus" NOT NULL DEFAULT 'new';

-- CreateTable
CREATE TABLE "Proxy" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT,
    "type" "ProxyType" NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "rotationUrl" TEXT,
    "expectedCountry" TEXT,
    "expectedCity" TEXT,
    "status" "ProxyStatus" NOT NULL DEFAULT 'unverified',
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckResult" JSONB,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "monthlyTrafficGB" DOUBLE PRECISION,
    "expiresAt" TIMESTAMP(3),
    "createdById" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyHealthCheck" (
    "id" TEXT NOT NULL,
    "proxyId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggeredBy" TEXT NOT NULL,
    "tcpConnectOk" BOOLEAN NOT NULL,
    "httpProbeOk" BOOLEAN NOT NULL,
    "detectedIp" TEXT,
    "detectedCountry" TEXT,
    "detectedCity" TEXT,
    "latencyMs" INTEGER,
    "isLeaking" BOOLEAN,
    "errorCategory" TEXT,
    "errorMessage" TEXT,
    "rawProbeData" JSONB,

    CONSTRAINT "ProxyHealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretAccessLog" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "clientIp" TEXT,
    "userAgent" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Proxy_status_idx" ON "Proxy"("status");

-- CreateIndex
CREATE INDEX "Proxy_type_status_idx" ON "Proxy"("type", "status");

-- CreateIndex
CREATE INDEX "Proxy_createdById_idx" ON "Proxy"("createdById");

-- CreateIndex
CREATE INDEX "ProxyHealthCheck_proxyId_checkedAt_idx" ON "ProxyHealthCheck"("proxyId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "SecretAccessLog_entityType_entityId_createdAt_idx" ON "SecretAccessLog"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SecretAccessLog_userId_createdAt_idx" ON "SecretAccessLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SocialAccount_proxyId_idx" ON "SocialAccount"("proxyId");

-- CreateIndex
CREATE INDEX "SocialAccount_warmupStatus_idx" ON "SocialAccount"("warmupStatus");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyHealthCheck" ADD CONSTRAINT "ProxyHealthCheck_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretAccessLog" ADD CONSTRAINT "SecretAccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ZavodUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
