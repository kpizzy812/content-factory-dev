/**
 * balance_v2: единая точка записи external API costs в AiAuditLog.
 *
 * Используется video-pipeline + video-pipeline-steps для логирования
 * реальных трат на fal.ai / mubert / anthropic. Запись в AiAuditLog
 * с action='external_api_call' и заполненным service-полем.
 *
 * Defensive: не падает при ошибках БД, не дублирует существующие записи
 * (idempotency check для retry-сценариев).
 */

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
        suggestions: undefined,
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
 *   2. Idempotency: если уже есть запись с теми же (videoId, stepKey, service)
 *      за последний час — skip (защита от retry-pipeline).
 *   3. Пишет через logServiceCost.
 *
 * @param stepKey — ключ шага (см. VideoStepKey)
 * @param service — может быть передан явно (для случаев когда mapStepKeyToService нужен mock),
 *                  но обычно null/undefined и определяется автоматически из stepKey+modelId.
 */
export async function logStepCost(
  stepId: number,
  stepKey: string,
  service: CostService | null | undefined,
  costUsd: number,
  videoId: number,
  modelId?: string | null,
): Promise<void> {
  const resolvedService = service ?? mapStepKeyToService(stepKey, modelId)
  if (!resolvedService || costUsd <= 0) {
    return
  }

  try {
    // Idempotency: одно видео × один шаг × один сервис = одна запись cost навсегда.
    // Первый записанный cost — каноничный; retry pipeline (даже через дни/недели)
    // или corruption-rerun НЕ переписывают историю. Это сохраняет integrity ledger:
    // burn-rate за период считается по уникальным фактам списания, дубли невозможны.
    const existing = await prisma.aiAuditLog.findFirst({
      where: {
        videoId,
        stepKey,
        service: resolvedService,
      },
      select: { id: true },
    })

    if (existing) {
      console.log(
        `[cost-ledger] skip duplicate cost log: video=${videoId} step=${stepKey} service=${resolvedService}`,
      )
      return
    }

    await logServiceCost({
      service: resolvedService,
      model: modelId ?? resolvedService,
      costUsd,
      videoId,
      stepKey,
    })
  } catch (err) {
    console.warn(
      `[cost-ledger] logStepCost failed (video=${videoId}, step=${stepKey}): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
