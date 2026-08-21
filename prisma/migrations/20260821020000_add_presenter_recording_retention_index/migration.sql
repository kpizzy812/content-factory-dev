-- CreateIndex
-- Important из финального ревью (2026-08-17-presenter-recordings-and-speech-cut):
-- под глобальный (не по characterId) проход автоочистки
-- (applyRecordingRetention, server/utils/presenter/recording-retention.ts) —
-- прежний PresenterRecording_characterId_retention_createdAt_idx для него
-- бесполезен, characterId там ведущая колонка. Заводится вместе с сужением
-- `where` этого прохода до строк, которые правило вообще способно перевести
-- в новое состояние: покрывает и фильтр (retention), и ORDER BY (createdAt).
CREATE INDEX "PresenterRecording_retention_createdAt_idx" ON "PresenterRecording"("retention", "createdAt");
