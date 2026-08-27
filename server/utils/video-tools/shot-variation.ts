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
 *
 * ГРУППА КАДРОВ (правка 26.08.2026, дефект картинки на ролике 30). Кадровый
 * монтаж режет таймлайн каждые 1.5-2 секунды, но фон меняется НАМНОГО реже:
 * на 50 кадрах ролика 30 было всего 9 уникальных идей, то есть одна и та же
 * картинка жила по 5-6 кадров подряд. Прежний рулинг «`variationIndex` =
 * `shot.order`» давал каждому такому куску СВОЙ план движения и СВОЙ отсчёт
 * времени с нуля — одна картинка каждые 1.8 с ехала то влево, то вправо, то
 * наездом, и на экране это читалось как случайное перекладывание фона.
 *
 * Теперь план движения выбирается на ГРУППУ подряд идущих кадров с одним и тем
 * же фоном ({@link planShotVariationSlices}), а каждый кусок рисует свой
 * отрезок ОБЩЕЙ траектории: он знает своё смещение внутри группы и полную
 * длину группы. Камера едет плавно через всю группу, режется только монтаж.
 * Разнообразие между РАЗНЫМИ фонами сохраняется: номер группы растёт на
 * каждой смене фона, а планов пять — соседние группы обязаны различаться.
 */

import { isLipSyncOutputPath } from "../presenter/scene-clip-mapping"

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
 * План для КОНКРЕТНОГО клипа. null — клип остаётся как есть.
 *
 * Сцену ведущей смена плана только портит. Движение здесь покупается ценой
 * масштабирования на 12% и кропа: рот, который lip-sync только что перерисовал,
 * растягивается ещё раз (это самое мягкое место кадра), а окно кропа срезает
 * макушку — на ролике 24 голова оказалась обрезана. Ради чего затевалась смена
 * плана — оживить статичную перебивку — говорящая голова делает сама.
 */
export function planShotVariationForClip(
  clipPath: string,
  sceneIndex: number,
  enabled: boolean,
): ShotVariationPlan | null {
  if (!enabled) return null
  if (typeof clipPath !== "string" || clipPath.trim().length === 0) return null
  if (isLipSyncOutputPath(clipPath)) return null
  return pickShotVariationPlan(sceneIndex)
}

/**
 * Фильтр ffmpeg для плана.
 *
 * `spanSec` задаёт темп движения: за это время окно проходит запас целиком,
 * поэтому короткая траектория движется быстрее длинной. `offsetSec` — где
 * внутри траектории начинается ЭТОТ кусок: ноль у первого куска группы, длина
 * предыдущих кусков — у остальных.
 *
 * При `offsetSec = 0` строка совпадает с прежней БАЙТ В БАЙТ: перебивка
 * старого маршрута (`still-clip.ts` без полей группы) обязана получить те же
 * аргументы, что и до правки.
 */
export function buildShotVariationFilter(
  plan: ShotVariationPlan,
  target: { w: number, h: number },
  spanSec: number,
  offsetSec = 0,
): string {
  const scaledW = Math.round(target.w * OVERSCAN)
  const scaledH = Math.round(target.h * OVERSCAN)
  // Деление на длительность идёт прямо в выражении ffmpeg, поэтому ноль и NaN
  // обязаны быть отсечены здесь: строка "t/0" сделает кадр неопределённым.
  const span = Number.isFinite(spanSec) && spanSec > 0
    ? Math.round(spanSec * 100) / 100
    : 1
  // Смещение — тем же приёмом: нечисловое, бесконечное и отрицательное
  // одинаково означают «кусок первый в группе».
  const offset = Number.isFinite(offsetSec) && offsetSec > 0
    ? Math.round(offsetSec * 100) / 100
    : 0
  // Ровно `t` при нулевом смещении — иначе старый маршрут получил бы другую
  // строку фильтра на пустом месте.
  const time = offset > 0 ? `(t+${offset})` : "t"
  const base = `scale=${scaledW}:${scaledH}`
  const crop = `crop=${target.w}:${target.h}`
  const maxX = scaledW - target.w
  const maxY = scaledH - target.h
  const centerX = Math.round(maxX / 2)
  const centerY = Math.round(maxY / 2)

  switch (plan) {
    case "pan_left":
      // Окно едет справа налево: кадр «уходит» от зрителя влево.
      return `${base},${crop}:${maxX}-${maxX}*${time}/${span}:${centerY}`
    case "pan_right":
      return `${base},${crop}:${maxX}*${time}/${span}:${centerY}`
    case "pan_up":
      return `${base},${crop}:${centerX}:${maxY}-${maxY}*${time}/${span}`
    case "push_in": {
      // Наезд: масштаб растёт со временем, окно держится в центре. Выражение
      // размера считается в scale, поэтому кроп остаётся постоянным.
      const grown = Math.round(target.w * (OVERSCAN + 0.08))
      const grownH = Math.round(target.h * (OVERSCAN + 0.08))
      return `scale='${scaledW}+(${grown}-${scaledW})*${time}/${span}':'${scaledH}+(${grownH}-${scaledH})*${time}/${span}':eval=frame,${crop}:(iw-ow)/2:(ih-oh)/2`
    }
    case "static_tight":
    default:
      // Статичный, но кадрированный план: сцена перестаёт совпадать с
      // исходником пиксель в пиксель, а движения не вносит.
      return `${base},${crop}:${centerX}:${centerY}`
  }
}

/** Кусок общей траектории группы: какой план играть, откуда и на какой длине. */
export interface ShotVariationSlice {
  /** Номер ГРУППЫ — вход {@link pickShotVariationPlan}, а не номер кадра. */
  index: number
  /** Смещение куска внутри траектории группы. */
  offsetSec: number
  /** Полная длина траектории группы. */
  spanSec: number
}

/** Кадр глазами группировки: только время и идентичность фона. */
export interface ShotVariationInput {
  order: number
  startSec: number
  endSec: number
  /** Идентичность фона; null — кадр не группируется ни с кем. */
  backgroundKey: string | null
}

/**
 * Идентичность фона кадра — что именно увидит зритель, а не как это назвал
 * план.
 *
 * Библиотечный клип и скрин приложения адресуются своей ссылкой: два кадра с
 * одним `backgroundClipId` показывают один файл, какая бы `idea` у них ни
 * стояла. Сгенерированный фон адресуется идеей — это единственный вход, по
 * которому кадры одной сцены получают ОДНУ И ТУ ЖЕ картинку. `image` и `video`
 * с одной идеей — разные фоны: это разные файлы, произведённые разными
 * моделями.
 *
 * `null` (фона нет, идея пуста, ссылка не проставлена) означает «не
 * группировать»: непрерывная траектория через кадры с непонятно каким фоном
 * соврала бы про длину группы.
 */
export function shotBackgroundIdentity(shot: {
  background: string
  backgroundClipId: string | null
  appReferenceId: string | null
  idea: string | null
}): string | null {
  switch (shot.background) {
    case "library":
      return shot.backgroundClipId ? `library:${shot.backgroundClipId}` : null
    case "app_screen":
      return shot.appReferenceId ? `app_screen:${shot.appReferenceId}` : null
    case "image":
    case "video": {
      const idea = shot.idea?.trim() ?? ""
      return idea.length > 0 ? `${shot.background}:${idea}` : null
    }
    default:
      return null
  }
}

/**
 * Насколько кадры группы могут не сойтись встык и всё ещё считаться одной
 * траекторией. План кадров покрывает трек без дыр (Critical 1 финального
 * ревью), поэтому расхождение здесь — это шум округления границ к сетке
 * кадров, а не настоящий разрыв: 50 мс заведомо больше кадра на любом
 * рабочем fps и заведомо меньше самого короткого кадра монтажа.
 */
export const GROUP_CONTIGUITY_TOLERANCE_SEC = 0.05

/**
 * Режет список кадров на группы подряд идущих кадров с ОДНИМ фоном и выдаёт
 * каждому кадру его кусок общей траектории.
 *
 * Вызывающий обязан передать кадры в порядке таймлайна (так они и приходят из
 * БД, `orderBy: { order: "asc" }`). Группа рвётся, когда меняется
 * идентичность фона, когда идентичности нет вовсе или когда кадры не сходятся
 * встык.
 */
export function planShotVariationSlices(
  shots: readonly ShotVariationInput[],
): Map<number, ShotVariationSlice> {
  const groups: ShotVariationInput[][] = []

  for (const shot of shots) {
    const current = groups[groups.length - 1]
    const previous = current?.[current.length - 1]
    const joinable = current !== undefined
      && previous !== undefined
      && shot.backgroundKey !== null
      && previous.backgroundKey === shot.backgroundKey
      && Number.isFinite(previous.endSec)
      && Number.isFinite(shot.startSec)
      && Math.abs(shot.startSec - previous.endSec) <= GROUP_CONTIGUITY_TOLERANCE_SEC

    if (joinable) current.push(shot)
    else groups.push([shot])
  }

  const slices = new Map<number, ShotVariationSlice>()
  groups.forEach((group, index) => {
    const first = group[0]!
    const last = group[group.length - 1]!
    // Нечисловые границы (рассинхрон источников, вырожденный план) не имеют
    // права уехать в выражение ffmpeg: там NaN делает кадр неопределённым.
    const rawSpan = last.endSec - first.startSec
    const spanSec = Number.isFinite(rawSpan) && rawSpan > 0 ? rawSpan : 1

    for (const shot of group) {
      const rawOffset = shot.startSec - first.startSec
      const offsetSec = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0
      slices.set(shot.order, { index, offsetSec, spanSec })
    }
  })

  return slices
}
