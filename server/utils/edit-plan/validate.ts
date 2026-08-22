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
 *
 * Фикс-раунд 1 (ревью task-3-review.md): `validateShotPlan` и `repairShotPlan`
 * обязаны сверяться с ОДНИМ и тем же концом таймлайна (`timelineEndSec`) и
 * одним и тем же допуском (`halfFrameSec`) — иначе кадр, поставленный
 * ремонтом ровно в конец трека, сама же валидация на некратной кадру
 * длительности объявляет дырой (Critical 2, воспроизведено на 49.2% случайных
 * длительностей). Обе функции экспортируются отсюда и импортируются в
 * `repair.ts` ради этого согласия.
 *
 * Фикс-раунд 2 (ре-ревью task-3-rereview.md): допуск «рвёт ли граница слово»
 * (`wordEdgeToleranceSec`) тоже стал зависеть от fps — раньше был фиксирован,
 * хотя `halfFrameSec` уже считался от fps, и асимметрия на нестандартном fps
 * могла сама создать `word_split` (Minor 10). Проверка ссылки на фон
 * (`library`/`app_screen`) переписана с `if`/`else if` на `||` — фон не может
 * быть обоими одновременно, `else` только создавал ложное впечатление
 * приоритета (Minor 11).
 */

import { trackEndFrame } from "../voiceover/segment-cut"
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
    /**
     * Task 5, требование 8: один клип генеративного видео не заказать длиннее
     * `maxGenerativeVideoSec` (10с, `REPLICATE_KLING_16_DURATIONS[1]`) — модели
     * квантуют длительность 5/10с, а `presenter_too_long` ограничивает только
     * PRESENTER-кадры. Кадр-перебивка длиннее 10с валиден геометрически, но
     * исполнение всё равно отдаст картинку (см. `maxGenerativeVideoSec` в
     * `background-source.ts`) — без этого кода план в БД врал бы о том, что
     * реально будет доставлено.
     */
    | "generative_video_too_long"
    /** §7: флаг профиля выключен, а кадру назначено генеративное видео. */
    | "generative_video_disabled"
    | "out_of_track"
    /** Нечисловая граница (NaN/Infinity) или endSec <= startSec. */
    | "invalid_bounds"
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
  /**
   * Потолок ОДНОГО клипа генеративного видео: 10 с
   * (`REPLICATE_KLING_16_DURATIONS[1]`). Task 5, требование 8 — раньше
   * `ShotPlanContext` знал только нижнюю границу квантования, и кадр длиннее
   * 10 секунд с `background: "video"` проходил валидацию, хотя исполнение
   * (`pickBackgroundSource`) всё равно отдало бы картинку.
   */
  maxGenerativeVideoSec: number
  knownBackgroundIds: ReadonlySet<string>
}

/** Насколько фактическая доля перебивок может разойтись с целевой. */
const RATIO_TOLERANCE = 0.15

/**
 * Плавающая точка: `Math.abs(0.55 - 0.4) === 0.15000000000000002` в JS, что
 * строго больше `RATIO_TOLERANCE` (Minor 2 ревью). План, стоящий РОВНО на
 * границе допуска, не обязан из-за шума округления считаться невалидным.
 */
const RATIO_FLOAT_GUARD = 1e-9

/** Фолбэк эпсилона, когда fps не годится для арифметики (см. {@link halfFrameSec}). */
const DEFAULT_EPSILON_SEC = 1 / 60

/**
 * Половина кадра — минимальный шум округления, который не считается дырой,
 * нахлёстом или выходом за трек. Раньше была захардкожена под 30 fps (Minor 1
 * ревью): на 24 fps половина кадра — 20.8 мс, и настоящая дыра меньше
 * прежнего фиксированного порога 1/60 проходила бы проверку. Спека фиксирует
 * 30 fps для этого пайплайна (§4.3), но `fps` — параметр контекста, а не
 * встроенная константа, и допуск обязан считаться от него, а не от
 * зашитого числа.
 */
function halfFrameSec(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? 1 / (2 * fps) : DEFAULT_EPSILON_SEC
}

/**
 * Реальный конец таймлайна: граница кадра НЕ ПОЗЖЕ измеренной длительности
 * трека (`trackEndFrame` в `segment-cut.ts` — тот же приём, что использует
 * вырезка кусков трека под lip-sync). Нефинитная/неположительная длительность
 * — трека нет вовсе, таймлайну нечем заканчиваться позже нуля (Minor 4
 * ревью: было протекание `Infinity` из `trackEndFrame` в план).
 */
function timelineEndSec(trackDurationSec: number, fps: number): number {
  const end = trackEndFrame(trackDurationSec, fps)
  return Number.isFinite(end) ? end : 0
}

/**
 * Допуск «рвёт ли граница слово» — половина кадра плюс небольшой
 * фиксированный запас (Minor Н-10 ре-ревью раунда 2).
 *
 * Important НН-6 ре-ревью раунда 3 расширял допуск до ПОЛНОГО кадра
 * (`halfFrameSec * 2`), рассуждая, что раз `snapSecToFrame` может сдвинуть
 * точку до половины кадра в любую сторону, допуск обязан держать запас с
 * обеих сторон, чтобы округление НИКОГДА не могло перекинуть уже
 * проверенную точку обратно в слово. Заявленный тогда замер («32 → 4 из
 * 27 813») при независимой проверке ре-ревью раунда 4 не воспроизвёлся:
 * изолированная замена допуска на коде раунда 2 дала 6 → 10 (хуже, не
 * лучше) — более широкий допуск делает МЕНЬШЕ межсловных щелей пригодными
 * (щель уже `2/fps` перестаёт помещать безопасную точку), и это перекрывает
 * выигрыш от защиты на границе округления. Корень (см. докстринг
 * `resolveBoundary` в `repair.ts`) был не в ширине допуска, а в том, что
 * фолбэк после провала перепроверки ВСЁ РАВНО возвращал ту же небезопасную
 * снятую точку — почему более широкий допуск и не помогал по существу.
 * Ре-ревью раунда 4 починило сам фолбэк; допуск возвращён к формуле
 * раунда 2, которая по факту (см. `repair.property.spec.ts`, замер
 * «созданный `word_split` на здоровом входе») даёт лучший результат вместе
 * с починенным фолбэком, чем расширенный допуск.
 */
function wordEdgeToleranceSec(fps: number): number {
  return halfFrameSec(fps) + 0.003
}

export function validateShotPlan(input: ShotPlanContext): ShotPlanViolation[] {
  const shots = [...input.plan.shots].sort((a, b) => a.startSec - b.startSec)
  const violations: ShotPlanViolation[] = []

  if (shots.length === 0) {
    return [{ code: "empty", shotOrder: null, message: "План кадров пуст — покрывать таймлайн нечем" }]
  }

  const words = input.alignedScenes.flatMap(scene => scene.words)
  const epsilon = halfFrameSec(input.fps)
  const trackEnd = timelineEndSec(input.trackDurationSec, input.fps)

  let cursor = 0
  let brollSeconds = 0

  for (const shot of shots) {
    const hasFiniteBounds = Number.isFinite(shot.startSec) && Number.isFinite(shot.endSec)
    const duration = shot.endSec - shot.startSec

    if (!hasFiniteBounds || duration <= 0) {
      violations.push({
        code: "invalid_bounds",
        shotOrder: shot.order,
        message: hasFiniteBounds
          ? `Кадр ${shot.order} имеет неположительную длительность: ${shot.startSec.toFixed(2)}-${shot.endSec.toFixed(2)}с`
          : `Кадр ${shot.order} имеет нечисловую границу: startSec=${shot.startSec}, endSec=${shot.endSec}`,
      })
    }

    if (!hasFiniteBounds) {
      // NaN/Infinity ниже по цепочке гасят проверки молча (Important 2
      // ревью): `Math.max(cursor, NaN) === NaN`, и дальше КАЖДОЕ сравнение
      // курсора с NaN ложно — весь хвост плана после такого кадра перестаёт
      // проверяться. Курсор и накопитель доли перебивок этот кадр не трогает.
      continue
    }

    if (shot.startSec > cursor + epsilon) {
      violations.push({
        code: "gap",
        shotOrder: shot.order,
        message: `Дыра ${cursor.toFixed(2)}-${shot.startSec.toFixed(2)}с перед кадром ${shot.order}`,
      })
    }
    if (shot.startSec < cursor - epsilon) {
      violations.push({
        code: "overlap",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} начинается в ${shot.startSec.toFixed(2)}с, когда предыдущий идёт до ${cursor.toFixed(2)}с`,
      })
    }
    if (shot.endSec > trackEnd + epsilon) {
      violations.push({
        code: "out_of_track",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} заканчивается в ${shot.endSec.toFixed(2)}с, а трек длится ${input.trackDurationSec.toFixed(2)}с`,
      })
    }
    if (shot.foreground === "presenter" && duration > input.lipSyncMaxDurationSec + epsilon) {
      violations.push({
        code: "presenter_too_long",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} с ведущим длится ${duration.toFixed(2)}с при потолке модели ${input.lipSyncMaxDurationSec}с`,
      })
    }

    const missingLibraryRef = shot.background === "library"
      && (!shot.backgroundClipId || !input.knownBackgroundIds.has(shot.backgroundClipId))
    // §5.3 «ссылки на фоны существуют» — не только у библиотечных клипов
    // (Minor 5 ревью): скрин приложения без ссылки на источник точно так же
    // не из чего собрать.
    const missingAppScreenRef = shot.background === "app_screen" && !shot.appReferenceId

    // `||`, не `if`/`else if` (Minor 11 ре-ревью): background не может быть
    // одновременно "library" и "app_screen", поэтому `else` ничего не
    // экономил, только создавал ложное впечатление приоритета между
    // взаимоисключающими условиями — тот же стиль, что уже был в repair.ts.
    if (missingLibraryRef || missingAppScreenRef) {
      violations.push({
        code: "unknown_background",
        shotOrder: shot.order,
        message: missingLibraryRef
          ? `Кадр ${shot.order} ссылается на фон ${shot.backgroundClipId ?? "(не указан)"}, которого нет в библиотеке`
          : `Кадр ${shot.order} использует app_screen без appReferenceId`,
      })
    }

    if (shot.background === "video") {
      if (duration < input.minGenerativeVideoSec - epsilon) {
        // §7: модели продают 5 или 10 секунд. Двухсекундная перебивка
        // стоила бы как пятисекундная, и три секунды оплаченного материала
        // ушли бы в мусор.
        violations.push({
          code: "generative_video_too_short",
          shotOrder: shot.order,
          message: `Кадр ${shot.order} длится ${duration.toFixed(2)}с — генеративное видео не бывает короче ${input.minGenerativeVideoSec}с`,
        })
      }
      if (!input.profile.generativeVideoEnabled) {
        // §7: «только для кадров длиной от 5 секунд, ПО ФЛАГУ ПРОФИЛЯ и в
        // пределах потолка» (Minor 6 ревью) — валидация проверяла только
        // длину, флаг молча пропускала.
        violations.push({
          code: "generative_video_disabled",
          shotOrder: shot.order,
          message: `Кадр ${shot.order} использует генеративное видео, а профиль его не разрешает (generativeVideoEnabled=false)`,
        })
      }
      if (duration > input.maxGenerativeVideoSec + epsilon) {
        // Task 5, требование 8: один клип генеративного видео длиннее потолка
        // квантования (10с) заказать нельзя — исполнение отдаст картинку,
        // и план не должен молчать об этом до оплаты.
        violations.push({
          code: "generative_video_too_long",
          shotOrder: shot.order,
          message: `Кадр ${shot.order} длится ${duration.toFixed(2)}с — один клип генеративного видео длиннее ${input.maxGenerativeVideoSec}с не заказать`,
        })
      }
    }

    // Границу проверяем только внутреннюю: старт первого кадра и конец
    // последнего совпадают с границами трека и слово не рвут по построению.
    if (shot.startSec > epsilon && splitsWord(words, shot.startSec, input.fps)) {
      violations.push({
        code: "word_split",
        shotOrder: shot.order,
        message: `Граница кадра ${shot.order} в ${shot.startSec.toFixed(2)}с приходится на середину слова`,
      })
    }

    if (shot.foreground !== "presenter") brollSeconds += duration
    cursor = Math.max(cursor, shot.endSec)
  }

  if (cursor < trackEnd - epsilon) {
    violations.push({
      code: "gap",
      shotOrder: null,
      message: `Хвост трека ${cursor.toFixed(2)}-${trackEnd.toFixed(2)}с не покрыт ни одним кадром`,
    })
  }

  // Знаменатель — длина ТРЕКА, а не сумма длин кадров (Minor 8 ревью): на
  // плане без дыр/нахлёстов/вырожденных кадров они совпадают, но сумма длин
  // кадров бессмысленна именно тогда, когда план уже кривой (нахлёст даёт
  // сумму больше трека, дыры — меньше, отрицательная длина — произвольно).
  const actualRatio = trackEnd > 0 ? brollSeconds / trackEnd : 0
  if (Math.abs(actualRatio - input.profile.brollRatio) > RATIO_TOLERANCE + RATIO_FLOAT_GUARD) {
    violations.push({
      code: "broll_ratio",
      shotOrder: null,
      message: `Перебивки занимают ${Math.round(actualRatio * 100)}% при целевых ${Math.round(input.profile.brollRatio * 100)}%`,
    })
  }

  return violations
}

/** Попадает ли момент внутрь слова, а не в межсловный интервал. */
function splitsWord(words: readonly { startSec: number, endSec: number }[], atSec: number, fps: number): boolean {
  const tolerance = wordEdgeToleranceSec(fps)
  return words.some(word =>
    atSec > word.startSec + tolerance && atSec < word.endSec - tolerance)
}

// Экспортируется для repair.ts: обе функции обязаны сверяться с одним и тем
// же понятием "рвёт слово" / "конец таймлайна" / "допуск округления" — иначе
// именно такое расхождение и породило Critical 2.
export { halfFrameSec, splitsWord, timelineEndSec, wordEdgeToleranceSec }
