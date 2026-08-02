-- Формат выдачи для Instagram-актора: фабрика производит вертикальные ролики,
-- поэтому по умолчанию собираем Reels. Лента целиком ("posts") остаётся
-- доступной, но у каруселей и фото просмотров нет вовсе.
ALTER TABLE "TrendwatcherProfile"
  ADD COLUMN "contentFormat" TEXT NOT NULL DEFAULT 'reels';
