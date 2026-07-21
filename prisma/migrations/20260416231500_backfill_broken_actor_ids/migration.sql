-- Backfill: исправляем actorId у существующих профилей с несуществующими (de-listed) акторами.
-- apify/tiktok-scraper и apify/youtube-scraper никогда не публиковались в Apify Store —
-- маппим их на community-лидеров clockworks/tiktok-scraper и streamers/youtube-scraper,
-- иначе runner падает: "Актор ... не найден в Apify".
UPDATE "TrendwatcherProfile" SET "actorId" = 'clockworks/tiktok-scraper' WHERE "actorId" = 'apify/tiktok-scraper';
UPDATE "TrendwatcherProfile" SET "actorId" = 'streamers/youtube-scraper' WHERE "actorId" = 'apify/youtube-scraper';
