/**
 * Проверка плана кадров перед тем, как за него заплатят.
 *
 * Разделение ответственности §5.1: модель выбирает смысл, код считает секунды.
 * Здесь — вторая половина. Причина не теоретическая: автор разобранной системы
 * прямо описывает, как модели «серьёзно тупили при реализации плана монтажа».
 * Модель, которой поручена арифметика таймлайна, рано или поздно вернёт кадры с
 * дырой или нахлёстом, и это увидит зритель.
 *
 * Функция чистая: ни БД, ни сети. Возвращает ВСЕ нарушения, а не первое —
 * ремонт (repair.ts) чинит их пачкой, а текст нарушений уходит в повторный
 * запрос к модели.
 */

import type { AlignedScene } from "../transcription/align"
import type { ResolvedEditProfile } from "./profile"
import type { ShotPlan } from "./types"

export type ViolationCode
  = | "gap"
    | "overlap"
    | "word_split"
    | "presenter_too_long"
    | "unknown_background"
    | "broll_ratio"
    | "generative_video_too_short"
    | "out_of_track"
    | "empty"

export interface ShotPlanViolation {
  code: ViolationCode
  /** Кадр, к которому относится нарушение. null — про план целиком. */
  shotOrder: number | null
  message: string
}

export interface ShotPlanContext {
  plan: ShotPlan
  /** Измеренная ffprobe длительность трека — верхняя граница таймлайна. */
  trackDurationSec: number
  fps: number
  alignedScenes: readonly AlignedScene[]
  profile: ResolvedEditProfile
  /** Потолок lip-sync модели: у kling-lip-sync это 10 с. */
  lipSyncMaxDurationSec: number
  /** Минимум генеративного видео: квантование 5/10 с (§7). */
  minGenerativeVideoSec: number
  knownBackgroundIds: ReadonlySet<string>
}

/** Половина кадра при 30 fps. Мельче — это шум округления, а не дыра. */
const EPSILON_SEC = 1 / 60

/** Насколько фактическая доля перебивок может разойтись с целевой. */
const RATIO_TOLERANCE = 0.15

/** Слово считается разорванным, если граница попала внутрь него глубже допуска. */
const WORD_EDGE_TOLERANCE_SEC = 0.02

export function validateShotPlan(input: ShotPlanContext): ShotPlanViolation[] {
  const shots = [...input.plan.shots].sort((a, b) => a.startSec - b.startSec)
  const violations: ShotPlanViolation[] = []

  if (shots.length === 0) {
    return [{ code: "empty", shotOrder: null, message: "План кадров пуст — покрывать таймлайн нечем" }]
  }

  const words = input.alignedScenes.flatMap(scene => scene.words)

  let cursor = 0
  let brollSeconds = 0
  let totalSeconds = 0

  for (const shot of shots) {
    const duration = shot.endSec - shot.startSec

    if (shot.startSec > cursor + EPSILON_SEC) {
      violations.push({
        code: "gap",
        shotOrder: shot.order,
        message: `Дыра ${cursor.toFixed(2)}-${shot.startSec.toFixed(2)}с перед кадром ${shot.order}`,
      })
    }
    if (shot.startSec < cursor - EPSILON_SEC) {
      violations.push({
        code: "overlap",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} начинается в ${shot.startSec.toFixed(2)}с, когда предыдущий идёт до ${cursor.toFixed(2)}с`,
      })
    }
    if (shot.endSec > input.trackDurationSec + EPSILON_SEC) {
      violations.push({
        code: "out_of_track",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} заканчивается в ${shot.endSec.toFixed(2)}с, а трек длится ${input.trackDurationSec.toFixed(2)}с`,
      })
    }
    if (shot.foreground === "presenter" && duration > input.lipSyncMaxDurationSec + EPSILON_SEC) {
      violations.push({
        code: "presenter_too_long",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} с ведущим длится ${duration.toFixed(2)}с при потолке модели ${input.lipSyncMaxDurationSec}с`,
      })
    }
    if (shot.background === "library" && (!shot.backgroundClipId || !input.knownBackgroundIds.has(shot.backgroundClipId))) {
      violations.push({
        code: "unknown_background",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} ссылается на фон ${shot.backgroundClipId ?? "(не указан)"}, которого нет в библиотеке`,
      })
    }
    if (shot.background === "video" && duration < input.minGenerativeVideoSec - EPSILON_SEC) {
      // §7: модели продают 5 или 10 секунд. Двухсекундная перебивка стоила бы
      // как пятисекундная, и три секунды оплаченного материала ушли бы в мусор.
      violations.push({
        code: "generative_video_too_short",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} длится ${duration.toFixed(2)}с — генеративное видео не бывает короче ${input.minGenerativeVideoSec}с`,
      })
    }

    // Границу проверяем только внутреннюю: старт первого кадра и конец
    // последнего совпадают с границами трека и слово не рвут по построению.
    if (shot.startSec > EPSILON_SEC && splitsWord(words, shot.startSec)) {
      violations.push({
        code: "word_split",
        shotOrder: shot.order,
        message: `Граница кадра ${shot.order} в ${shot.startSec.toFixed(2)}с приходится на середину слова`,
      })
    }

    totalSeconds += duration
    if (shot.foreground !== "presenter") brollSeconds += duration
    cursor = Math.max(cursor, shot.endSec)
  }

  if (cursor < input.trackDurationSec - EPSILON_SEC) {
    violations.push({
      code: "gap",
      shotOrder: null,
      message: `Хвост трека ${cursor.toFixed(2)}-${input.trackDurationSec.toFixed(2)}с не покрыт ни одним кадром`,
    })
  }

  const actualRatio = totalSeconds > 0 ? brollSeconds / totalSeconds : 0
  if (Math.abs(actualRatio - input.profile.brollRatio) > RATIO_TOLERANCE) {
    violations.push({
      code: "broll_ratio",
      shotOrder: null,
      message: `Перебивки занимают ${Math.round(actualRatio * 100)}% при целевых ${Math.round(input.profile.brollRatio * 100)}%`,
    })
  }

  return violations
}

/** Попадает ли момент внутрь слова, а не в межсловный интервал. */
function splitsWord(words: readonly { startSec: number, endSec: number }[], atSec: number): boolean {
  return words.some(word =>
    atSec > word.startSec + WORD_EDGE_TOLERANCE_SEC && atSec < word.endSec - WORD_EDGE_TOLERANCE_SEC)
}
