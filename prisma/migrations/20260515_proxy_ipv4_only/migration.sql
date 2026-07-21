-- ADD-only миграция: новое поле Proxy.ipv4Only.
-- Дефолт false; backfill автоматически проставляет всем существующим строкам.
-- Безопасно для rollback (DROP COLUMN не теряет других данных).

ALTER TABLE "Proxy" ADD COLUMN "ipv4Only" BOOLEAN NOT NULL DEFAULT false;
