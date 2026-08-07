/**
 * Планирование fal-preflight: ЧТО пробивать перед запуском и КАК читать ответ.
 *
 * Почему отдельный модуль, а не копипаста в каждой точке запуска:
 *
 * 1. Набор моделей. `falProbeAccess` без `FAL_KEY` возвращает `no_api_key` на
 *    любой строке — в том числе на модели, которую хостит не fal (Replicate).
 *    По docs/PROJECT_CONTEXT.md §5 основной медиа-провайдер — Replicate, а fal
 *    только резерв, поэтому пробивать fal-пробой чужие эндпоинты нельзя: это
 *    ровно тот случай, когда рабочий Replicate + отсутствующий FAL_KEY валили
 *    прогон. Плюс не нужно пробивать модели шагов, которые в этом прогоне не
 *    исполняются (нода с pinnedOutput, шаг уже выполнен при resume) — там
 *    деньги не тратятся и доступ не нужен.
 *
 * 2. Трактовка вердикта. Блокируют только однозначные статусы (см.
 *    fal-access-gate). `probe_error` — сбой самой проверки, а не приговор
 *    модели: терять из-за сетевого сбоя весь прогон нельзя, реальный submit
 *    вернёт внятную ошибку сам.
 *
 * Модуль чистый: ни сети, ни БД — чтобы обе точки запуска и тесты читали одну
 * и ту же логику.
 */

import { isFalAccessBlocking, isFalProbeInconclusive } from "./fal-access-gate"

/** Эндпоинты fal всегда начинаются с `fal-ai/` (см. parseQueueBaseUrl в fal.ts). */
const FAL_ENDPOINT_PREFIX = "fal-ai/"

/** true — модель хостит fal, значит fal-probe про неё что-то знает. */
export function isFalHostedModel(modelId: string | null | undefined): boolean {
  return typeof modelId === "string" && modelId.startsWith(FAL_ENDPOINT_PREFIX)
}

/**
 * Из списка кандидатов оставляет только то, что имеет смысл пробивать:
 * fal-модели, без пустых значений и без дублей (порядок первого вхождения).
 * Пустой результат = probe вызывать вообще не нужно.
 */
export function planFalPreflightTargets(
  candidates: ReadonlyArray<string | null | undefined>,
): string[] {
  const targets: string[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!isFalHostedModel(candidate)) continue
    const endpoint = candidate as string
    if (seen.has(endpoint)) continue
    seen.add(endpoint)
    targets.push(endpoint)
  }
  return targets
}

/** Минимум, который нужен от результата probe — структурно совместим с ModelAccessResult. */
export interface FalPreflightProbeResult {
  status?: string | null
  reason?: string | null
}

export interface FalPreflightIssue {
  endpoint: string
  status: string
  reason: string
}

export interface FalPreflightVerdict {
  /** Доступа точно нет — запуск останавливаем. */
  blocking: FalPreflightIssue[]
  /** Проверка не дала вердикта — продолжаем, но предупреждаем. */
  warnings: FalPreflightIssue[]
}

/**
 * Разбирает ответ `falProbeAccessBatch` на «валим» и «предупреждаем».
 * Принимает Map или любой iterable пар [endpoint, result].
 */
export function evaluateFalPreflight(
  results: Iterable<readonly [string, FalPreflightProbeResult]> | null | undefined,
): FalPreflightVerdict {
  const verdict: FalPreflightVerdict = { blocking: [], warnings: [] }
  if (!results) return verdict

  for (const [endpoint, result] of results) {
    const status = typeof result?.status === "string" ? result.status : ""
    const reason = typeof result?.reason === "string" && result.reason
      ? result.reason
      : "причина не указана"
    if (isFalAccessBlocking(status)) {
      verdict.blocking.push({ endpoint, status, reason })
    } else if (isFalProbeInconclusive(status)) {
      verdict.warnings.push({ endpoint, status, reason })
    }
  }

  return verdict
}
