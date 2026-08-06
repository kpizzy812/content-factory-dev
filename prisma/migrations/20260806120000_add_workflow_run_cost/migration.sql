-- Стоимость шага и запуска конвейера.
--
-- До этой миграции деньги в конвейере были видны только внутри output шага
-- «Видео» (videos[].totalCostActual), то есть человек узнавал сумму, только
-- раскрыв разбор одного шага. Из-за этого из макетов вырезаны колонка суммы в
-- строке шага, поле «Стоимость» в шапке запуска, сумма в карточке списка,
-- плитка расхода на дашборде и подтверждение повтора с ценой.
--
-- costActual   — фактически списанное, известно после завершения шага;
-- costEstimate — оценка до запуска, известна не всем типам блоков.
-- Оба в USD: остальной учёт (ServiceBalanceEntry, AiAuditLog.costUsd,
-- Video.totalCostActual) тоже в USD.
--
-- На запуске это денормализованный агрегат по шагам. Пересчитывается движком
-- после каждого шага и при финализации, поэтому переживает рестарт: источник
-- правды — строки WorkflowStep, а не накопленное в памяти число.
ALTER TABLE "WorkflowStep"
  ADD COLUMN "costActual" DOUBLE PRECISION,
  ADD COLUMN "costEstimate" DOUBLE PRECISION;

ALTER TABLE "WorkflowRun"
  ADD COLUMN "costActual" DOUBLE PRECISION,
  ADD COLUMN "costEstimate" DOUBLE PRECISION;

-- Расход за сутки по конвейерам: выборка идёт по дню и статусу.
CREATE INDEX "WorkflowRun_finishedAt_idx" ON "WorkflowRun" ("finishedAt" DESC NULLS LAST);
