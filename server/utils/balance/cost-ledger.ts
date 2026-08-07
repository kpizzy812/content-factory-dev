/**
 * balance_v2: единая точка записи external API costs в AiAuditLog.
 *
 * Используется video-pipeline + video-pipeline-steps для логирования
 * реальных трат на Replicate / fal.ai / mubert / anthropic. Запись в AiAuditLog
 * с action='external_api_call' и заполненным service-полем.
 *
 * Defensive: не падает при ошибках БД, не дублирует существующие записи
 * (idempotency check для retry-сценариев). Идемпотентность действует В ПРЕДЕЛАХ
 * попытки шага: повторный прогон (rerunVideoStep, resume после сбоя) — это
 * отдельная оплата у провайдера, и она обязана попасть в ledger.
 */

import type { Prisma } from "../../../app/generated/prisma/client"
import { mapStepKeyToService, type CostService } from "./cost-attribution"

interface LogServiceCostParams {
  service: string
  model: string
  costUsd: number
  videoId?: number | null
  stepKey?: string | null
  userId?: number | null
  action?: string
  metadata?: Record<string, unknown>
}

/**
 * Имя Json-поля AiAuditLog, в котором живёт метаданная строки ledger.
 * Схему БД трогать нельзя (отдельной колонки под номер попытки нет),
 * поэтому переиспользуем свободное для external_api_call поле `suggestions`:
 * у cost-записей оно всегда пустое, а фильтровать по нему Prisma умеет
 * через { path: [...], equals: ... } (тот же приём, что и поиск
 * pipelineCredential по metadata.kind в server/plugins/scheduler.ts).
 */
const ATTEMPT_META_FIELD = "suggestions" as const
/** Ключ внутри Json-метаданной: { attempt: N }. */
const ATTEMPT_META_KEY = "attempt" as const

/** Условие дедупа одной строки ledger (без videoId — его добавляет вызывающий). */
export interface StepCostDedupeWhere {
  stepKey: string
  service: string
  suggestions?: { path: string[]; equals: number }
}

/**
 * Приводит номер попытки к целому >= 1.
 * Мусор (undefined, NaN, 0, дробь, отрицательное) считаем первой попыткой —
 * это сохраняет старое поведение для всех вызовов, которые про попытки не знают.
 */
export function normalizeCostAttempt(attempt?: number | null): number {
  if (typeof attempt !== "number" || !Number.isFinite(attempt)) return 1
  const floored = Math.floor(attempt)
  return floored < 1 ? 1 : floored
}

/**
 * Собирает условие дедупа для строки ledger. Чистая функция — накрыта DB-free тестом.
 *
 * Первая попытка ищет запись без учёта метаданной: исторические строки писались
 * вообще без { attempt }, и мы обязаны их находить, иначе resume старого видео
 * задублирует уже учтённый расход.
 * Попытка > 1 — самостоятельный факт списания (rerunVideoStep / resume после сбоя
 * реально платит провайдеру ещё раз), поэтому дедуп сужается до строки этой же попытки.
 */
export function buildStepCostDedupeWhere(
  stepKey: string,
  service: string,
  attempt?: number | null,
): StepCostDedupeWhere {
  const normalized = normalizeCostAttempt(attempt)
  if (normalized === 1) {
    return { stepKey, service }
  }
  return {
    stepKey,
    service,
    [ATTEMPT_META_FIELD]: { path: [ATTEMPT_META_KEY], equals: normalized },
  }
}

/**
 * Пишет одну запись в AiAuditLog с тегом service.
 * Skip если costUsd <= 0 или service пустой.
 * Ошибки БД ловит в try/catch с console.warn — не должна ломать pipeline.
 */
export async function logServiceCost(params: LogServiceCostParams): Promise<void> {
  if (!params.service || params.costUsd <= 0) {
    return
  }

  try {
    await prisma.aiAuditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action ?? "external_api_call",
        model: params.model,
        prompt: null,
        // Метаданная строки ledger (сейчас — только номер повторной попытки).
        // У cost-записей это поле иначе не используется, см. ATTEMPT_META_FIELD.
        suggestions: (params.metadata ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        blockedFields: undefined,
        rejectedFields: undefined,
        costUsd: params.costUsd,
        service: params.service,
        videoId: params.videoId ?? null,
        stepKey: params.stepKey ?? null,
        status: "applied",
      },
    })
  } catch (err) {
    console.warn(
      `[cost-ledger] logServiceCost failed (${params.service}/${params.model}): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Helper для логирования cost после updateStep(actualCost) в video-pipeline.
 *
 * Делает три вещи:
 *   1. Определяет service через mapStepKeyToService — skip если null
 *   2. Idempotency: если уже есть запись этой же попытки (videoId, stepKey, service
 *      [, attempt]) — skip (защита от retry внутри одного прогона).
 *   3. Пишет через logServiceCost.
 *
 * @param stepKey — ключ шага (см. VideoStepKey)
 * @param service — может быть передан явно (для случаев когда mapStepKeyToService нужен mock),
 *                  но обычно null/undefined и определяется автоматически из stepKey+modelId.
 * @param options.attempt — номер попытки шага (обычно VideoStep.attemptCount + 1).
 *                  Не передан или 1 — старое поведение «одна строка на шаг навсегда».
 *                  Больше 1 — повторный прогон (rerunVideoStep, resume после сбоя) реально
 *                  оплачен провайдеру ещё раз, поэтому пишем отдельную строку с пометкой попытки.
 */
export async function logStepCost(
  stepId: number,
  stepKey: string,
  service: CostService | null | undefined,
  costUsd: number,
  videoId: number,
  modelId?: string | null,
  options?: { attempt?: number },
): Promise<void> {
  const resolvedService = service ?? mapStepKeyToService(stepKey, modelId)
  if (!resolvedService || costUsd <= 0) {
    return
  }

  const attempt = normalizeCostAttempt(options?.attempt)

  try {
    // Idempotency: одно видео × один шаг × один сервис × одна попытка = одна запись cost.
    // Внутри попытки первый записанный cost — каноничный: повторный вызов логгера
    // (retry записи, двойной вызов из runner-а) историю не переписывает.
    // Но НОВАЯ попытка — это новый факт списания у провайдера: занижать его нельзя,
    // иначе burn-rate систематически меньше реальных трат.
    //
    // Гонка: уникального индекса под (videoId, stepKey, service, attempt) в схеме нет,
    // а менять схему нельзя, поэтому «прочитали → записали» атомарным не сделать.
    // Важное свойство мы всё же держим: параллельные попытки НЕ падают —
    // разные attempt дают разные строки, а любую ошибку БД гасит catch ниже.
    const existing = await prisma.aiAuditLog.findFirst({
      where: {
        videoId,
        ...buildStepCostDedupeWhere(stepKey, resolvedService, attempt),
      },
      select: { id: true },
    })

    if (existing) {
      console.log(
        `[cost-ledger] пропускаем дубль cost-записи: video=${videoId} step=${stepKey} service=${resolvedService} attempt=${attempt}`,
      )
      return
    }

    await logServiceCost({
      service: resolvedService,
      model: modelId ?? resolvedService,
      costUsd,
      videoId,
      stepKey,
      // Первая попытка пишется без метаданной — так строки остаются байт-в-байт
      // совместимыми с историческими записями и старыми отчётами по ledger.
      metadata: attempt > 1 ? { [ATTEMPT_META_KEY]: attempt } : undefined,
    })
  } catch (err) {
    console.warn(
      `[cost-ledger] logStepCost failed (video=${videoId}, step=${stepKey}): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
