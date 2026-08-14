/**
 * План анимационной инфографики поверх готового ролика.
 *
 * `docs/PROJECT_CONTEXT.md` §5 требует анимационной инфографики, и до сих пор
 * её не было вовсе. Remotion рендерит видео из React-кода: он даёт плашки с
 * цифрами, титры и переходы — но НЕ генеративное видео. Картинку сцены
 * по-прежнему рисует flux, а перебивку собирает ffmpeg.
 *
 * Лицензия проверена 14.08.2026: для команды до трёх человек Remotion бесплатен
 * и для коммерческого использования.
 *
 * Здесь только план — что, когда и поверх какой сцены. Рендер запускает
 * `render.ts`, и его отсутствие в системе ролик не ломает.
 */

/** Больше пяти плашек на ролик — это уже презентация, а не короткое видео. */
export const MAX_OVERLAYS_PER_VIDEO = 5

/** Пауза перед появлением плашки: зритель должен успеть увидеть сам кадр. */
const OVERLAY_LEAD_IN_SEC = 1

/** Сколько плашка висит, если сцена позволяет. */
const OVERLAY_DURATION_SEC = 3

/** Запас до конца сцены: плашка обязана уйти до склейки. */
const OVERLAY_TAIL_SEC = 0.5

/** Минимальная длина сцены, куда вообще имеет смысл ставить плашку. */
const MIN_SCENE_FOR_OVERLAY_SEC = 3

export type OverlayKind = "stat"

export interface RemotionOverlay {
  kind: OverlayKind
  sceneOrder: number
  /** Секунды от начала РОЛИКА, а не от начала сцены. */
  startSec: number
  durationSec: number
  /** Текст плашки — цифра с коротким пояснением. */
  text: string
}

export interface RemotionOverlayPlan {
  overlays: RemotionOverlay[]
  totalDurationSec: number
}

export interface OverlayScene {
  order: number
  durationSec: number
  /** Реплика в кадре: на такую сцену плашку не ставим. */
  spokenLine?: string | null
  /** Текст сцены, из которого достаётся цифра. */
  subtitleCopy?: string | null
}

/** Цифра с процентом, кратностью или единицей измерения — то, что стоит показать. */
const STAT_PATTERN = /(\d+[.,]?\d*)\s*(%|раз[а-я]*|процент[а-я]*|₽|\$|мин|час[а-я]*|дн[а-я]+|мес[а-я]*)/i

export function planRemotionOverlays(input: {
  scenes: readonly OverlayScene[]
}): RemotionOverlayPlan {
  const overlays: RemotionOverlay[] = []
  let elapsed = 0
  let totalDurationSec = 0

  for (const scene of input.scenes) {
    const duration = Number.isFinite(scene.durationSec) && scene.durationSec > 0 ? scene.durationSec : 0
    const sceneStart = elapsed
    elapsed += duration
    totalDurationSec += duration

    if (overlays.length >= MAX_OVERLAYS_PER_VIDEO) continue
    // Сцена ведущей — это лицо и губы: плашка забирает внимание ровно там,
    // где работает речь.
    if (scene.spokenLine && scene.spokenLine.trim().length > 0) continue
    if (duration < MIN_SCENE_FOR_OVERLAY_SEC) continue

    const text = (scene.subtitleCopy ?? "").trim()
    if (!text || !STAT_PATTERN.test(text)) continue

    const available = duration - OVERLAY_LEAD_IN_SEC - OVERLAY_TAIL_SEC
    if (available <= 0) continue

    overlays.push({
      kind: "stat",
      sceneOrder: scene.order,
      startSec: Math.round((sceneStart + OVERLAY_LEAD_IN_SEC) * 100) / 100,
      durationSec: Math.round(Math.min(OVERLAY_DURATION_SEC, available) * 100) / 100,
      text,
    })
  }

  return {
    overlays,
    totalDurationSec: Math.round(totalDurationSec * 100) / 100,
  }
}
