/**
 * Смена плана внутри сцены.
 *
 * Сцена идёт одним статичным кадром по девять секунд: удержание падает, а
 * последовательность перцептивных хешей у двух роликов с одной ведущей выходит
 * почти одинаковой — платформы сравнивают именно её, сэмплируя кадры с шагом
 * порядка 1-2 секунд. Практика короткого видео держит смену картинки каждые
 * 1.5-2 секунды; медленное движение внутри кадра даёт её монтажом, без единого
 * лишнего платного вызова к провайдеру.
 *
 * Как устроено: исходник масштабируется с запасом, из него вырезается окно
 * целевого размера, и положение окна зависит от времени. Размер выхода при этом
 * постоянный — иначе concat склеит кадры разных размеров и сборка упадёт.
 *
 * ПОЧЕМУ не zoompan: он рассчитан на неподвижные изображения, считает по номеру
 * кадра и на видео даёт рывки. Здесь движение привязано к `t` — секундам сцены.
 */

/** Насколько исходник берётся крупнее кадра: запас, из которого идёт движение. */
const OVERSCAN = 1.12

export type ShotVariationPlan =
  | "static_tight"
  | "pan_left"
  | "pan_right"
  | "pan_up"
  | "push_in"

export const SHOT_VARIATION_PLANS: readonly ShotVariationPlan[] = Object.freeze([
  "static_tight",
  "pan_left",
  "pan_right",
  "pan_up",
  "push_in",
])

/**
 * План для сцены по её индексу. Детерминированно: пересборка ролика обязана
 * давать тот же файл, иначе кеш нормализации и отпечаток уникальности
 * расходятся между прогонами.
 */
export function pickShotVariationPlan(sceneIndex: number): ShotVariationPlan {
  const normalized = Number.isFinite(sceneIndex) ? Math.trunc(Math.abs(sceneIndex)) : 0
  return SHOT_VARIATION_PLANS[normalized % SHOT_VARIATION_PLANS.length]!
}

/**
 * Фильтр ffmpeg для плана. `durationSec` задаёт темп движения: за сцену окно
 * проходит запас целиком, поэтому короткая сцена движется быстрее длинной.
 */
export function buildShotVariationFilter(
  plan: ShotVariationPlan,
  target: { w: number, h: number },
  durationSec: number,
): string {
  const scaledW = Math.round(target.w * OVERSCAN)
  const scaledH = Math.round(target.h * OVERSCAN)
  // Деление на длительность идёт прямо в выражении ffmpeg, поэтому ноль и NaN
  // обязаны быть отсечены здесь: строка "t/0" сделает кадр неопределённым.
  const duration = Number.isFinite(durationSec) && durationSec > 0
    ? Math.round(durationSec * 100) / 100
    : 1
  const base = `scale=${scaledW}:${scaledH}`
  const crop = `crop=${target.w}:${target.h}`
  const maxX = scaledW - target.w
  const maxY = scaledH - target.h
  const centerX = Math.round(maxX / 2)
  const centerY = Math.round(maxY / 2)

  switch (plan) {
    case "pan_left":
      // Окно едет справа налево: кадр «уходит» от зрителя влево.
      return `${base},${crop}:${maxX}-${maxX}*t/${duration}:${centerY}`
    case "pan_right":
      return `${base},${crop}:${maxX}*t/${duration}:${centerY}`
    case "pan_up":
      return `${base},${crop}:${centerX}:${maxY}-${maxY}*t/${duration}`
    case "push_in": {
      // Наезд: масштаб растёт со временем, окно держится в центре. Выражение
      // размера считается в scale, поэтому кроп остаётся постоянным.
      const grown = Math.round(target.w * (OVERSCAN + 0.08))
      const grownH = Math.round(target.h * (OVERSCAN + 0.08))
      return `scale='${scaledW}+(${grown}-${scaledW})*t/${duration}':'${scaledH}+(${grownH}-${scaledH})*t/${duration}':eval=frame,${crop}:(iw-ow)/2:(ih-oh)/2`
    }
    case "static_tight":
    default:
      // Статичный, но кадрированный план: сцена перестаёт совпадать с
      // исходником пиксель в пиксель, а движения не вносит.
      return `${base},${crop}:${centerX}:${centerY}`
  }
}
