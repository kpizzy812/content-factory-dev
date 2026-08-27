/**
 * Композиция ОДНОГО кадра монтажа: ведущий, фон, PiP (spec §6.3, §8).
 *
 * Модуль ЧИСТЫЙ: ни файловой системы, ни ffmpeg-процессов — по образцу
 * `still-clip.ts`/`shot-cut.ts`. Спавн живёт в `shot-compose-runner.ts`.
 *
 * Порядок, который отсюда нельзя нарушить (жёсткое требование §6.3/§8):
 *
 *   клип сцены от lip-sync  →  приведён к длине СЦЕНЫ В ТРЕКЕ (вызывающим,
 *                               ДО вызова этого модуля — измерение и подгон
 *                               нигде в проекте больше не делаются)
 *                           →  вырезан подотрезок КАДРА по смещению внутри
 *                               сцены (это поле `offsetSec`/`presenterOffsetSec`
 *                               ниже, считается ОТСЮДА)
 *                           →  композиция с фоном (PiP либо во весь экран)
 *
 * Наивное «кадр [t1, t2] — это подотрезок клипа сцены со смещением
 * `t1 - sceneStart`» неверно ДО первого шага: длину клипа lip-sync задаёт
 * исходник (окно записи, библиотечный клип), а не кусок трека. Поэтому вход
 * сюда — уже приведённый клип, а этот модуль вырезает только СВОЙ подотрезок.
 */

import type { ResolvedEditProfile } from "../edit-plan/profile"
import { buildPipOverlayFilter, type LipSyncedClipPath } from "./pip-compose"
import { snapSecToFrame } from "../voiceover/segment-cut"
import { GROUP_CONTIGUITY_TOLERANCE_SEC, type ShotVariationSlice } from "./shot-variation"

export interface ShotSources {
  /** Клип сцены, УЖЕ приведённый к длине сцены в треке. null — ведущего нет. */
  presenterPath: LipSyncedClipPath | null
  /** Смещение начала СЦЕНЫ в треке — база для вырезки подотрезка. */
  sceneStartSec: number
  /** Готовый файл фона. null — фона нет. */
  backgroundPath: string | null
  /** Фон — неподвижная картинка (нужен still-клип), а не видео. */
  backgroundIsStill: boolean
  /**
   * Смещение кадра ВНУТРИ файла фона — для группы кадров, которым заказан
   * ОДИН клип генеративного видео (правка 27.08.2026). Без него все кадры
   * группы показали бы одно и то же начало клипа. Не задано или негодно
   * (отрицательное, NaN, Infinity) — ноль, то есть поведение одиночного кадра.
   *
   * К неподвижной картинке отношения не имеет: её движение задаёт `variation`,
   * а не позиция внутри файла.
   */
  backgroundOffsetSec?: number | null
  /**
   * Сколько секунд клипа ведущего — ЖИВЫЕ, считая от `sceneStartSec`.
   *
   * Приведение клипа к длине сцены (`fitPresenterClipsToScenes`) добивает
   * недостачу удержанием последнего кадра, поэтому длина ФАЙЛА и длина живого
   * материала — разные величины: у сцены 9 ролика 30 файл 11.36с, живого
   * 9.90с. `null` — неизвестно (рассинхрон снапшотов), тогда ограничения нет и
   * поведение прежнее.
   */
  presenterLiveSec?: number | null
}

/**
 * Сколько замороженного хвоста в кадре ещё терпимо.
 *
 * Ноль здесь поставить нельзя: заказ у lip-sync квантуется, и модель отдаёт
 * чуть меньше заказанного — у `kwaivgi/kling-lip-sync` на заказе 10.00с
 * измерено 9.90с. При нулевом допуске эта разница в 0.1с стирала бы ЦЕЛЫЙ
 * полуторасекундный кадр лица на каждом ролике. Четверть секунды — заметно
 * больше измеренного недобора модели и заметно меньше того, что владелец
 * увидел на ролике 30 (1.46с). Порог закреплён тестами с обеих сторон.
 */
const MAX_FROZEN_TAIL_SEC = 0.25

/**
 * Ближайший доступный фон по номеру кадра; при равном расстоянии — ПРЕДЫДУЩИЙ
 * (продолжение того, что зритель только что видел, читается лучше, чем прыжок
 * вперёд). Нужен там, где ведущего показать нельзя, а своего фона у кадра нет
 * вовсе — у кадров ведущего он обычно и не запланирован (`background: "none"`).
 */
export function pickNearestBackground<T>(order: number, available: ReadonlyMap<number, T>): T | null {
  let best: T | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  let bestOrder = Number.POSITIVE_INFINITY
  for (const [candidateOrder, value] of available) {
    const distance = Math.abs(candidateOrder - order)
    if (distance < bestDistance || (distance === bestDistance && candidateOrder < bestOrder)) {
      bestDistance = distance
      bestOrder = candidateOrder
      best = value
    }
  }
  return best
}

/**
 * Смещение каждого кадра ВНУТРИ его файла фона (правка 27.08.2026).
 *
 * Генеративное видео заказывается одним клипом на группу подряд идущих кадров
 * с одной идеей (`computeVideoGroups`), поэтому у нескольких кадров подряд
 * один и тот же файл. Каждому нужен СВОЙ кусок: без этого группа показала бы
 * начало клипа три раза подряд.
 *
 * Считается по ФАКТУ — совпадению пути файла у соседних кадров, а не по плану:
 * группа заказа (потолок длины модели) и группа траектории
 * (`planShotVariationSlices`, потолка не знает) не обязаны совпадать, и
 * доверять здесь плану значило бы иногда просить `-ss` за концом файла.
 *
 * Неподвижная картинка смещения не получает никогда: её движение задаёт
 * траектория (`variation`), а кусок файла у картинки смысла не имеет.
 */
export function planSharedBackgroundOffsets(
  shots: readonly {
    order: number
    startSec: number
    endSec: number
    backgroundPath: string | null
    backgroundIsStill: boolean
  }[],
): Map<number, number> {
  const offsets = new Map<number, number>()

  let seriesPath: string | null = null
  let seriesStartSec = 0
  let previousEndSec = Number.NaN

  for (const shot of shots) {
    const path = shot.backgroundIsStill ? null : shot.backgroundPath
    const continues = path !== null
      && path === seriesPath
      && Math.abs(shot.startSec - previousEndSec) <= GROUP_CONTIGUITY_TOLERANCE_SEC

    if (continues) {
      offsets.set(shot.order, Math.max(0, shot.startSec - seriesStartSec))
    }
    else {
      seriesPath = path
      seriesStartSec = shot.startSec
      offsets.set(shot.order, 0)
    }
    previousEndSec = shot.endSec
  }

  return offsets
}

export type ShotComposition =
  | { kind: "presenter_full", presenterPath: LipSyncedClipPath, offsetSec: number, durationSec: number }
  | {
    kind: "background_full"
    backgroundPath: string
    backgroundIsStill: boolean
    backgroundOffsetSec: number
    durationSec: number
    variation: ShotVariationSlice
  }
  | {
    kind: "pip"
    backgroundPath: string
    backgroundIsStill: boolean
    backgroundOffsetSec: number
    presenterPath: LipSyncedClipPath
    presenterOffsetSec: number
    durationSec: number
    variation: ShotVariationSlice
    pipFilters: string[]
  }

/**
 * Планирует композицию одного кадра.
 *
 * Ветка выбирается по НАЛИЧИЮ ИСТОЧНИКОВ (`sources.presenterPath`/
 * `sources.backgroundPath`), а НЕ по `shot.foreground`: модель вправе вернуть
 * `foreground: "presenter"` при `sceneOrder: null` (валидация плана такого
 * правила не имеет, подтверждено ре-ревью фикс-раунда 24.08.2026), а клипа
 * ведущего у кадра без своей сцены нет физически — он привязан к сцене.
 * Доверять полю `foreground` значило бы искать несуществующий файл.
 */
export function planShotComposition(input: {
  shot: { order: number, startSec: number, endSec: number, pipEnabled: boolean, foreground: string }
  sources: ShotSources
  profile: Pick<ResolvedEditProfile, "pipPosition" | "pipSize" | "pipEnabled">
  canvasWidth: number
  canvasHeight: number
  fps: number
  /**
   * Кусок общей траектории движения фона (`planShotVariationSlices`). Не задан
   * — кадр сам себе группа: план движения по его номеру, отсчёт с нуля, то
   * есть в точности прежнее поведение.
   */
  variation?: ShotVariationSlice
}): ShotComposition | null {
  const { shot, sources, profile, canvasWidth, canvasHeight, fps } = input

  const hasBackground = sources.backgroundPath !== null

  // Смещение — ОТ НАЧАЛА СЦЕНЫ, не от нуля трека: кадр — подотрезок клипа
  // сцены, а не самостоятельный вырез. Отрицательным быть не может: кадр не
  // начинается раньше своей сцены по построению плана, но входные данные
  // (тест, рассинхрон) могут утверждать обратное — клэмп страхует от вылета
  // `-ss` в минус.
  const offsetSec = snapSecToFrame(Math.max(0, shot.startSec - sources.sceneStartSec), fps)
  const durationSec = snapSecToFrame(shot.endSec, fps) - snapSecToFrame(shot.startSec, fps)

  // Второй эшелон защиты от замороженного лица (§8, дефект ролика 30): кадр,
  // уезжающий в удержанный хвост клипа, показывает ФОН, а не застывшую
  // ведущую. Замороженное лицо под живую речь хуже отсутствия лица — но
  // только пока фон есть: чёрный экран хуже обоих, поэтому без фона ведущий
  // остаётся последним средством.
  const liveSec = sources.presenterLiveSec
  const presenterFrozen = typeof liveSec === "number"
    && Number.isFinite(liveSec)
    && offsetSec + durationSec > liveSec + MAX_FROZEN_TAIL_SEC
  const hasPresenter = sources.presenterPath !== null && !(presenterFrozen && hasBackground)

  // Кадр без ведущего и без фона существовать не может — решение (слить с
  // соседом) принимает вызывающий через `mergeUnrenderableShots`.
  if (!hasPresenter && !hasBackground) return null
  // Движение выбирается на ГРУППУ кадров с одним фоном, а не на кадр
  // (`shot-variation.ts`, правка 26.08.2026): одна и та же картинка не имеет
  // права получать новый план движения каждые 1.8 секунды. Группы считает
  // вызывающий — он один видит весь план целиком; здесь дефолт на случай,
  // когда группировать нечего.
  const variation = input.variation ?? { index: shot.order, offsetSec: 0, spanSec: durationSec }

  // Негодное смещение (не задано, отрицательное, NaN, Infinity) — ноль:
  // `-ss` в минус или в бесконечность отдал бы ffmpeg аргумент, на котором
  // кадр не собрался бы вовсе.
  const rawOffset = sources.backgroundOffsetSec
  const backgroundOffsetSec = typeof rawOffset === "number" && Number.isFinite(rawOffset) && rawOffset > 0
    ? snapSecToFrame(rawOffset, fps)
    : 0

  const pipRequested = hasPresenter && hasBackground && shot.pipEnabled && profile.pipEnabled

  if (pipRequested) {
    // `buildPipOverlayFilter` — единственный источник фильтров наложения;
    // пересобирать их здесь запрещено (Task 5, правило 2). Вход
    // `foreground: LipSyncedClipPath` — гарантия §6.3 на уровне типа: строка
    // приходит уже брендированной из `sources.presenterPath`.
    const pipFilters = buildPipOverlayFilter({
      foreground: sources.presenterPath!,
      profile: { pipPosition: profile.pipPosition, pipSize: profile.pipSize },
      canvasWidth,
      canvasHeight,
    })
    return {
      kind: "pip",
      backgroundPath: sources.backgroundPath!,
      backgroundIsStill: sources.backgroundIsStill,
      backgroundOffsetSec,
      presenterPath: sources.presenterPath!,
      presenterOffsetSec: offsetSec,
      durationSec,
      variation,
      pipFilters,
    }
  }

  if (hasPresenter) {
    // PiP выключен любой стороной (кадром или профилем) либо фона нет вовсе —
    // ведущий занимает весь экран, фон отбрасывается.
    return {
      kind: "presenter_full",
      presenterPath: sources.presenterPath!,
      offsetSec,
      durationSec,
    }
  }

  return {
    kind: "background_full",
    backgroundPath: sources.backgroundPath!,
    backgroundIsStill: sources.backgroundIsStill,
    backgroundOffsetSec,
    durationSec,
    variation,
  }
}

/**
 * Сливает кадры, которые нечем нарисовать (ни фона, ни ведущего), с
 * соседями — таймлайн не должен получить дыру.
 *
 * Правило: нерисуемый кадр отдаёт своё время ПРЕДЫДУЩЕМУ уже принятому
 * кадру (раздвигая его `endSec`); если принятых кадров ещё не было —
 * время достаётся СЛЕДУЮЩЕМУ рисуемому кадру (раздвигается его `startSec`
 * вниз). Подряд идущие нерисуемые кадры сливаются в одного и того же
 * соседа, а не размножаются. Инвариант: сумма покрытия таймлайна и границы
 * первого/последнего кадра не меняются, соседние кадры всегда стыкуются
 * встык (`shots[i].startSec === shots[i-1].endSec`).
 *
 * Ни одного рисуемого кадра нет — возвращается пустой список: решение
 * (упасть или деградировать иначе) принимает вызывающий.
 */
export function mergeUnrenderableShots<T extends { order: number, startSec: number, endSec: number }>(
  shots: readonly T[],
  isRenderable: (shot: T) => boolean,
): { shots: T[], mergedOrders: number[] } {
  const result: T[] = []
  const mergedOrders: number[] = []
  // Нижняя граница, которую заберёт СЛЕДУЮЩИЙ рисуемый кадр — накапливается,
  // пока рисуемых кадров ещё не встретилось.
  let pendingStartSec: number | null = null

  for (const shot of shots) {
    if (!isRenderable(shot)) {
      mergedOrders.push(shot.order)
      if (result.length > 0) {
        const lastIndex = result.length - 1
        result[lastIndex] = { ...result[lastIndex]!, endSec: shot.endSec }
      } else if (pendingStartSec === null) {
        pendingStartSec = shot.startSec
      }
      continue
    }

    if (pendingStartSec !== null) {
      result.push({ ...shot, startSec: pendingStartSec })
      pendingStartSec = null
    } else {
      result.push({ ...shot })
    }
  }

  return { shots: result, mergedOrders }
}
