-- DropIndex
-- Избыточен: @@unique([videoId, sceneIndex]) уже B-tree с videoId ведущей
-- колонкой и покрывает те же запросы, что и этот отдельный индекс.
DROP INDEX "PresenterRecordingUsage_videoId_idx";
