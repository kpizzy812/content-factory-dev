-- CreateTable
CREATE TABLE "IndigoProfileCookieSnapshot" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "cookiesCipher" TEXT NOT NULL,
    "cookieCount" INTEGER NOT NULL DEFAULT 0,
    "payloadBytes" INTEGER NOT NULL DEFAULT 0,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndigoProfileCookieSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndigoProfileCookieSnapshot_profileId_platform_key" ON "IndigoProfileCookieSnapshot"("profileId", "platform");

-- CreateIndex
CREATE INDEX "IndigoProfileCookieSnapshot_profileId_idx" ON "IndigoProfileCookieSnapshot"("profileId");

-- AddForeignKey
ALTER TABLE "IndigoProfileCookieSnapshot" ADD CONSTRAINT "IndigoProfileCookieSnapshot_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "IndigoProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
