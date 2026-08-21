-- AlterTable
-- Minor 3 из финального ревью (2026-08-17-presenter-recordings-and-speech-cut):
-- оба поля были INTEGER (потолок 2 147 483 647). Приём ограничен
-- MAX_FILE_BYTES = 2 GiB (source-recordings/index.post.ts) — то есть
-- originalBytes переполнял бы INTEGER ровно на границе приёма, а
-- нормализованный файл при 30-37 МБ/мин переступает 2 ГБ уже на ~60 минутах
-- записи. saveRecording падал бы на create молча, оператор получал бы
-- recordingSaveWarning без понятной причины. Расширение INTEGER -> BIGINT —
-- безопасная операция, данных не теряет.
ALTER TABLE "PresenterRecording" ALTER COLUMN "bytes" SET DATA TYPE BIGINT,
ALTER COLUMN "originalBytes" SET DATA TYPE BIGINT;
