-- 1:1:1 enforcement: один Indigo-профиль = максимум один SocialAccount.
-- @@unique([profileId]) на IndigoProfileAccount — DB-уровень гарантия что нельзя
-- привязать второй аккаунт к уже занятому профилю (защита от мульти-аккаунт fingerprint
-- collision → мгновенный бан в соцсетях).
-- Pre-flight verified: 0 нарушений (SELECT "profileId", COUNT(*) GROUP BY HAVING > 1 → 0).
-- isPrimary default true: при 1:1 единственный аккаунт всегда primary.

ALTER TABLE "IndigoProfileAccount"
  ALTER COLUMN "isPrimary" SET DEFAULT true;

CREATE UNIQUE INDEX "IndigoProfileAccount_profileId_key" ON "IndigoProfileAccount"("profileId");
