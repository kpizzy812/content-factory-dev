/**
 * Раскладка сцен ролика на говорящую голову и перебивки (B-roll).
 *
 * Решение от 14.08.2026 (`docs/superpowers/specs/2026-08-14-avatar-pipeline.md` §8):
 * перебивка — это картинка плюс движение камеры, а не сгенерированный клип.
 * Кадр `flux-dev` стоит $0.025 за штуку и покрывает всю сцену, тогда как
 * text-to-video берёт $0.045 за каждую секунду: девятисекундная перебивка
 * дешевеет с $0.41 до $0.025, а движение делает монтаж, который уже есть
 * (`video-tools/shot-variation.ts`).
 *
 * Целевая доля перебивок — около 40% хронометража: правило 60/40 из практики
 * короткого видео. Оно же работает на уникальность — ролик, целиком собранный
 * из говорящей головы, отличается от вчерашнего только губами и субтитрами,
 * ровно то, что `docs/PROJECT_CONTEXT.md` §7 называет дублем.
 */

export type SceneKind = "presenter" | "broll"

/** Доля хронометража под перебивки. 60/40 — практика короткого видео. */
export const DEFAULT_BROLL_RATIO = 0.4

/** Насколько фактическая доля может разойтись с целевой, прежде чем сказать вслух. */
const RATIO_TOLERANCE = 0.15

export interface ScenePlanInput {
  order: number
  durationSec: number
  /** Реплика в кадре. Есть — сцену играет ведущий, и подменять её нельзя. */
  spokenLine: string | null
}

export interface SceneKindsPlan {
  /** Роль каждой сцены в порядке передачи. */
  kinds: SceneKind[]
  /** Индексы сцен, которым нужен сгенерированный кадр. */
  needsImages: number[]
  brollSeconds: number
  totalSeconds: number
  /** Фактическая доля перебивок по хронометражу. */
  actualRatio: number
  /** Заполнено, если раскладка заметно расходится с целевой долей. */
  warning: string | null
}

export function planSceneKinds(input: {
  scenes: readonly ScenePlanInput[]
  targetRatio?: number
}): SceneKindsPlan {
  const target = input.targetRatio ?? DEFAULT_BROLL_RATIO
  const kinds: SceneKind[] = []
  const needsImages: number[] = []
  let brollSeconds = 0
  let totalSeconds = 0

  input.scenes.forEach((scene, index) => {
    const duration = Number.isFinite(scene.durationSec) && scene.durationSec > 0 ? scene.durationSec : 0
    totalSeconds += duration
    // Реплика в кадре — единственный признак говорящей головы. Всё остальное
    // становится перебивкой: это дешевле и это же даёт смену картинки.
    const hasLine = Boolean(scene.spokenLine && scene.spokenLine.trim().length > 0)
    if (hasLine) {
      kinds.push("presenter")
      return
    }
    kinds.push("broll")
    needsImages.push(index)
    brollSeconds += duration
  })

  const actualRatio = totalSeconds > 0 ? brollSeconds / totalSeconds : 0
  const drift = actualRatio - target
  let warning: string | null = null
  if (Math.abs(drift) > RATIO_TOLERANCE) {
    warning = drift > 0
      ? `Перебивки занимают ${Math.round(actualRatio * 100)}% хронометража при целевых ${Math.round(target * 100)}%: ведущего в ролике слишком мало`
      : `Перебивки занимают ${Math.round(actualRatio * 100)}% хронометража при целевых ${Math.round(target * 100)}%: ролик почти целиком говорящая голова`
  }

  return {
    kinds,
    needsImages,
    brollSeconds: Math.round(brollSeconds * 100) / 100,
    totalSeconds: Math.round(totalSeconds * 100) / 100,
    actualRatio,
    warning,
  }
}
