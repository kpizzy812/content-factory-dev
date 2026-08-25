/**
 * Фактическая стоимость шагов генерации видео.
 *
 * Раньше цена считалась по числу сцен/файлов — то есть resume, который
 * переиспользовал уже готовые картинки и клипы с диска, всё равно записывал
 * полную стоимость, и отчёт по ролику завышался кратно числу возобновлений.
 * Считаем по generatedCount — сколько единиц реально оплачено провайдеру
 * в этом прогоне (контракт runImageGeneration / runClipGeneration).
 */

/**
 * Резервная оценка стоимости ОДНОГО вызова монтажного агента (`edit_plan`).
 *
 * Общая константа для двух ролей:
 *  1. `priceEditPlanModelCall` (`video-pipeline-steps.ts`) — ledger-фолбэк,
 *     когда для конкретного вызова нельзя посчитать реальную цену по токенам
 *     (мок-режим без usage, либо модель отсутствует в тарифной таблице
 *     `ai-pricing.ts`);
 *  2. `estimateVideoCost` (`video-cost.ts`) — смета шага `edit_plan` ДО
 *     запуска пайплайна, когда токенов ещё нет вовсе.
 *
 * Одна константа на обе роли намеренно: смета обязана быть honest-оценкой
 * ТОГО ЖЕ САМОГО числа, которое реально спишется как fallback, а не отдельным
 * выдуманным литералом (§7 спеки 2026-08-16-audio-first-editing-design —
 * «смета сходится с фактом»).
 *
 * Промпт агента растёт вместе с сеткой кадров (`estimateMaxTokens` в
 * `edit-planner-agent.ts`), а сетка — с длиной ролика: плоская оценка
 * систематически ЗАНИЖАЕТ цену на длинных роликах, тем же классом ошибки, что
 * и заниженная ставка Kling (Task 4). Основной путь ledger — реальный
 * токенный расчёт через `calculateAnthropicCost`; эта константа — запасной
 * вариант там и единственный вариант здесь, в смете.
 */
export const EDIT_PLAN_MODEL_CALL_ESTIMATE_USD = 0.05

/** Разрешение кадра, из которого fal считает мегапиксели. */
export function imageMegapixels(format: string, renderQuality: string): number {
  const isLowQ = renderQuality === "low"
  const width = format === "portrait" ? (isLowQ ? 720 : 1080) : (isLowQ ? 1280 : 1920)
  const height = format === "portrait" ? (isLowQ ? 1280 : 1920) : (isLowQ ? 720 : 1080)
  return Math.ceil((width * height) / 1_000_000)
}

export interface ImageActualCostInput {
  /** Сколько изображений реально сгенерировано (оплачено) в этом прогоне. */
  generatedCount: number
  format: string
  renderQuality: string
  /** Цена за мегапиксель у модели изображений. */
  pricePerMegapixel: number
}

export function computeImageActualCost(input: ImageActualCostInput): number {
  if (input.generatedCount <= 0 || input.pricePerMegapixel <= 0) return 0
  return input.generatedCount * imageMegapixels(input.format, input.renderQuality) * input.pricePerMegapixel
}

export interface ClipActualCostInput {
  /** Сцены плана в порядке следования; для legacy-режима пустой массив. */
  scenes: ReadonlyArray<{ durationSec: number }>
  /** Сколько клипов реально сгенерировано (оплачено) в этом прогоне. */
  generatedCount: number
  pricePerSecond: number
  /** Длительность клипа в legacy-режиме, когда плана сцен нет. */
  fallbackDurationSec: number
}

/**
 * Стоимость клипов за прогон.
 *
 * Шаг сообщает только количество сгенерированного, но не то, КАКИЕ сцены
 * переиспользованы с диска. Если сгенерированы все — считаем точно по плану;
 * если часть — берём среднюю длительность сцены. Погрешность тут копеечная и
 * заведомо меньше, чем прежняя ошибка «платим за все сцены каждый resume».
 */
export function computeClipActualCost(input: ClipActualCostInput): number {
  if (input.generatedCount <= 0 || input.pricePerSecond <= 0) return 0

  if (input.scenes.length === 0) {
    return input.generatedCount * input.fallbackDurationSec * input.pricePerSecond
  }

  const totalSeconds = input.scenes.reduce((sum, scene) => sum + scene.durationSec, 0)
  if (input.generatedCount >= input.scenes.length) {
    return totalSeconds * input.pricePerSecond
  }

  const averageSeconds = totalSeconds / input.scenes.length
  return input.generatedCount * averageSeconds * input.pricePerSecond
}

/**
 * Накопленная стоимость шага.
 *
 * actualCost шага — это деньги, потраченные на него по этому ролику, а не за
 * последний прогон: перезапись нулём после resume, который ничего не
 * генерировал, стирала бы уже потраченное из отчёта totalCostActual.
 * Явный rerunVideoStep обнуляет поле отдельно — там оператор осознанно начинает
 * счёт шага заново.
 */
export function accumulateStepCost(previous: number | null | undefined, runCost: number): number {
  const base = typeof previous === "number" && Number.isFinite(previous) ? previous : 0
  const add = Number.isFinite(runCost) && runCost > 0 ? runCost : 0
  return base + add
}

/**
 * Номер текущей попытки шага для ledger.
 * attemptCount инкрементит сам runner при старте работы, поэтому после прогона
 * это и есть номер попытки. 0 (шаг переиспользован и не стартовал) читаем как 1 —
 * дедуп ledger тогда совпадёт с исторической записью первой попытки.
 */
export function stepAttemptForLedger(attemptCount: number | null | undefined): number {
  if (typeof attemptCount !== "number" || !Number.isFinite(attemptCount)) return 1
  return attemptCount < 1 ? 1 : Math.floor(attemptCount)
}
