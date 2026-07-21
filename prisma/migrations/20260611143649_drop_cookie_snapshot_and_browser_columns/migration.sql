-- Этап 2 (DuoPlus-нейтрализация), PR2 — ЕДИНСТВЕННАЯ destructive миграция.
--
-- Браузерные cookies неприменимы к Android cloud phone (DuoPlus): сессии
-- приложений живут в storage устройства и не экспортируются. Снимок cookie
-- удаляется осознанно (пользователь явно разрешил DROP).
--
-- Rename моделей IndigoProfile→DeviceProfile / IndigoProfileAccount→DeviceProfileAccount
-- и полей indigoProfileId→deviceProfileId сделан через @@map/@map в schema.prisma —
-- БЕЗ DDL (физические таблицы/колонки остаются с прежними именами). Поэтому в этой
-- миграции НЕТ ни одного RENAME/DROP TABLE по профилям — только cookie-снапшот.
--
-- Мёртвые браузерные колонки userAgent/screenResolution/lastSessionPort НЕ трогаются
-- (минимизация destructive-поверхности; чистятся в Этапе 3).

-- DropForeignKey
ALTER TABLE "IndigoProfileCookieSnapshot" DROP CONSTRAINT "IndigoProfileCookieSnapshot_profileId_fkey";

-- AlterTable: удаление legacy encrypted cookie-снапшота с DeviceProfile (физ. таблица "IndigoProfile")
ALTER TABLE "IndigoProfile" DROP COLUMN "cookiesSnapshot",
DROP COLUMN "cookiesUpdatedAt";

-- DropTable: per-platform cookie-снапшоты
DROP TABLE "IndigoProfileCookieSnapshot";
