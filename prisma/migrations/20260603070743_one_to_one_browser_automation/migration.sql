-- 1:1:1 ENFORCEMENT (PR4): один прокси и один Indigo-профиль обслуживают
-- МАКСИМУМ ОДИН browser_automation-аккаунт.
--
-- ВАЖНО: эти partial UNIQUE INDEX НЕ выражаются декларативно в schema.prisma
-- (Prisma не поддерживает условный @@unique с WHERE). Поэтому индексы заданы
-- только здесь, raw SQL. Дрейф prisma (introspection покажет "лишний" индекс)
-- ОЖИДАЕМ и НЕ исправляем — это намеренное partial-условие на уровне БД.
--
-- api-аккаунты НЕ ограничены: для них шеринг прокси легитимен (legacy
-- proxy-sharing сохраняется, см. SocialAccount.proxyId без @unique).
--
-- БЕЗОПАСНОСТЬ: только CREATE UNIQUE INDEX, без DROP / ALTER данных.
-- Перед накатом обязателен read-only прогон scripts/check-1to1-violations.ts
-- (partial index упадёт, если уже есть дубли среди browser_automation-аккаунтов).

CREATE UNIQUE INDEX "uq_proxy_browser_automation"
  ON "SocialAccount" ("proxyId")
  WHERE "postingMethod" = 'browser_automation' AND "proxyId" IS NOT NULL;

CREATE UNIQUE INDEX "uq_indigo_browser_automation"
  ON "SocialAccount" ("indigoProfileId")
  WHERE "postingMethod" = 'browser_automation' AND "indigoProfileId" IS NOT NULL;
