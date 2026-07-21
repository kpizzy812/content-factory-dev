-- AlterTable: добавляем расширенные RBAC поля для синхронизации с MarketingCamp.
-- roleName / rolePresetName приходят из MC validate-external и нужны для UI-отображения
-- кастомных ролей (типа "Админ Gregulas" / "Полный доступ"), которые не маппятся на ZC enum.
ALTER TABLE "ZavodUser"
    ADD COLUMN "roleName" TEXT,
    ADD COLUMN "rolePresetName" TEXT;

-- CreateTable: гранулярная модель назначения приложений (зеркалит UserAppAssignment в MC).
-- accessLevel: none|read_only|full — общий уровень.
-- accounts:    "all" или CSV конкретных Google Ads customer IDs.
-- geos:        "all" или CSV кодов гео.
-- permissions: "read"|"read+write"|"read+create"|"full" — уточнение операций.
-- syncedAt:    отметка последней синхронизации с MC при логине.
CREATE TABLE "UserAppAssignment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "appId" INTEGER NOT NULL,
    "appName" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'none',
    "accounts" TEXT NOT NULL DEFAULT 'all',
    "geos" TEXT NOT NULL DEFAULT 'all',
    "permissions" TEXT NOT NULL DEFAULT 'read',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAppAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAppAssignment_userId_appId_key" ON "UserAppAssignment"("userId", "appId");

-- CreateIndex
CREATE INDEX "UserAppAssignment_userId_idx" ON "UserAppAssignment"("userId");

-- AddForeignKey
ALTER TABLE "UserAppAssignment"
    ADD CONSTRAINT "UserAppAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "ZavodUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: переносим существующий ZavodUser.appAccess (Int[]) в UserAppAssignment.
-- Старая семантика: appAccess пустой = доступ ко всем, appAccess [1,2,3] = только эти.
-- Новая семантика: отдельные UserAppAssignment записи. Пустой массив остаётся пустым набором
-- записей — на уровне сервера это будет означать "нет назначенных apps", что эквивалентно
-- "нет доступа", а доступ ко всему apps теперь даёт canAdmin (как в MC).
-- accessLevel='full', permissions='full', accounts/geos='all' для backward compat.
INSERT INTO "UserAppAssignment" ("userId", "appId", "appName", "accessLevel", "accounts", "geos", "permissions")
SELECT
    u.id AS "userId",
    UNNEST(u."appAccess") AS "appId",
    'app-' || UNNEST(u."appAccess")::TEXT AS "appName",
    'full' AS "accessLevel",
    'all' AS "accounts",
    'all' AS "geos",
    'full' AS "permissions"
FROM "ZavodUser" u
WHERE array_length(u."appAccess", 1) > 0
ON CONFLICT ("userId", "appId") DO NOTHING;

-- AlterTable: удаляем устаревшее appAccess поле.
ALTER TABLE "ZavodUser" DROP COLUMN "appAccess";
