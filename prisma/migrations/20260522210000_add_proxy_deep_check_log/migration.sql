-- ProxyDeepCheckLog — персистенция Уровня C deep proxy check.
-- Гибридная схема: денормализованные ключевые поля + fullResult JSON.
-- См. план: .claude/agent-memory/architect/proxy_deep_check_log_plan.md

CREATE TABLE "ProxyDeepCheckLog" (
    "id" TEXT NOT NULL,
    "proxyId" TEXT NOT NULL,
    "socialAccountId" INTEGER,
    "indigoProfileId" TEXT,
    "initiatedById" INTEGER,
    "triggeredFrom" TEXT NOT NULL DEFAULT 'manual',
    "outcome" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "detectedIp" TEXT,
    "detectedCountry" TEXT,
    "detectedCity" TEXT,
    "isLeaking" BOOLEAN,
    "matchesProxyExpectation" BOOLEAN,
    "proxyActuallyWorking" BOOLEAN NOT NULL DEFAULT false,
    "recommendation" TEXT,
    "fullResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxyDeepCheckLog_pkey" PRIMARY KEY ("id")
);

-- Индексы для быстрого fetch последних логов per proxy / per account / per outcome.
CREATE INDEX "ProxyDeepCheckLog_proxyId_createdAt_idx"
    ON "ProxyDeepCheckLog"("proxyId", "createdAt" DESC);

CREATE INDEX "ProxyDeepCheckLog_socialAccountId_createdAt_idx"
    ON "ProxyDeepCheckLog"("socialAccountId", "createdAt" DESC);

CREATE INDEX "ProxyDeepCheckLog_outcome_createdAt_idx"
    ON "ProxyDeepCheckLog"("outcome", "createdAt" DESC);

-- FK: Proxy=Cascade (логи бесполезны без proxy).
ALTER TABLE "ProxyDeepCheckLog"
    ADD CONSTRAINT "ProxyDeepCheckLog_proxyId_fkey"
    FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: SocialAccount=SetNull (логи сохраняем для аналитики прокси даже после удаления аккаунта).
ALTER TABLE "ProxyDeepCheckLog"
    ADD CONSTRAINT "ProxyDeepCheckLog_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: IndigoProfile=SetNull (профиль мог быть пересоздан).
ALTER TABLE "ProxyDeepCheckLog"
    ADD CONSTRAINT "ProxyDeepCheckLog_indigoProfileId_fkey"
    FOREIGN KEY ("indigoProfileId") REFERENCES "IndigoProfile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: ZavodUser=SetNull (audit trail сохраняется при deactivate).
ALTER TABLE "ProxyDeepCheckLog"
    ADD CONSTRAINT "ProxyDeepCheckLog_initiatedById_fkey"
    FOREIGN KEY ("initiatedById") REFERENCES "ZavodUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
