-- Лимит публикаций площадки на аккаунте.
--
-- Величину отдаёт только Instagram и только в момент отправки
-- (content_publishing_limit: quota_usage и config.quota_total). До сих пор она
-- жила ровно один вызов внутри адаптера публикации и нигде не сохранялась,
-- поэтому в интерфейсе нельзя было показать ни «34 / 50», ни свободную ёмкость.
--
-- Это снимок, а не текущее состояние: рядом лежит время замера, и интерфейс
-- обязан показывать его возраст, иначе вчерашняя цифра выдаётся за сегодняшнюю.
ALTER TABLE "SocialAccount"
  ADD COLUMN "publishingQuotaUsage" INTEGER,
  ADD COLUMN "publishingQuotaTotal" INTEGER,
  ADD COLUMN "publishingQuotaAt" TIMESTAMP(3);
