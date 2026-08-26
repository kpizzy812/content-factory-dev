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
import type { ShotVariationSlice } from "./shot-variation"

export interface ShotSources {
  /** Клип сцены, УЖЕ приведённый к длине сцены в треке. null — ведущего нет. */
  presenterPath: LipSyncedClipPath | null
  /** Смещение начала СЦЕНЫ в треке — база для вырезки подотрезка. */
  sceneStartSec: number
  /** Готовый файл фона. null — фона нет. */
  backgroundPath: string | null
  /** Фон — неподвижная картинка (нужен still-клип), а не видео. */
  backgroundIsStill: boolean
}

export type ShotComposition =
  | { kind: "presenter_full", presenterPath: LipSyncedClipPath, offsetSec: number, durationSec: number }
  | { kind: "background_full", backgroundPath: string, backgroundIsStill: boolean, durationSec: number, variation: ShotVariationSlice }
  | {
    kind: "pip"
    backgroundPath: string
    backgroundIsStill: boolean
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

  const hasPresenter = sources.presenterPath !== null
  const hasBackground = sources.backgroundPath !== null

  // Кадр без ведущего и без фона существовать не может — решение (слить с
  // соседом) принимает вызывающий через `mergeUnrenderableShots`.
  if (!hasPresenter && !hasBackground) return null

  // Смещение — ОТ НАЧАЛА СЦЕНЫ, не от нуля трека: кадр — подотрезок клипа
  // сцены, а не самостоятельный вырез. Отрицательным быть не может: кадр не
  // начинается раньше своей сцены по построению плана, но входные данные
  // (тест, рассинхрон) могут утверждать обратное — клэмп страхует от вылета
  // `-ss` в минус.
  const offsetSec = snapSecToFrame(Math.max(0, shot.startSec - sources.sceneStartSec), fps)
  const durationSec = snapSecToFrame(shot.endSec, fps) - snapSecToFrame(shot.startSec, fps)
  // Движение выбирается на ГРУППУ кадров с одним фоном, а не на кадр
  // (`shot-variation.ts`, правка 26.08.2026): одна и та же картинка не имеет
  // права получать новый план движения каждые 1.8 секунды. Группы считает
  // вызывающий — он один видит весь план целиком; здесь дефолт на случай,
  // когда группировать нечего.
  const variation = input.variation ?? { index: shot.order, offsetSec: 0, spanSec: durationSec }

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
