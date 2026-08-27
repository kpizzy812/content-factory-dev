-- Пошаговый режим: ролик ждёт решения оператора ВНЕ прогона.
--
-- Статус ожидания намеренно НЕ входит в RESUMABLE_VIDEO_STATUSES
-- (server/utils/video-pipeline-run-policy.ts): watchdog фильтрует кандидатов
-- прямо в SQL по этому списку, поэтому ролик в ожидании он не увидит вовсе и не
-- оплатит следующий шаг за оператора, которого никто не спрашивал.
--
-- Новое значение enum в этой же миграции только ОБЪЯВЛЯЕТСЯ и не используется:
-- Postgres запрещает использовать значение enum в той же транзакции, где оно
-- добавлено.

-- AlterEnum
ALTER TYPE "VideoStatus" ADD VALUE 'awaiting_operator';

-- AlterTable
-- stepwiseApproval nullable намеренно: NULL — «оператор ничего не выбирал,
-- решает монтажный профиль», false — «оператор выключил режим явно». Дефолт
-- false этих двух состояний не различал бы, и выключить режим, включённый
-- профилем, было бы нечем.
ALTER TABLE "Video" ADD COLUMN     "stepwiseApproval" BOOLEAN,
ADD COLUMN     "awaitingStepKey" "VideoStepKey",
ADD COLUMN     "approvedStepKey" "VideoStepKey";
