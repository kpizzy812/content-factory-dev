/**
 * Чистая часть шага `shot_background`: какое действие произвести для КАЖДОГО
 * кадра плана монтажа — фон из библиотеки, скрин приложения, картинка с
 * движением, генеративное видео или пустой задний план (§7, §10).
 *
 * Правила выбора источника уже написаны в `pickBackgroundSource`
 * (`./background-source.ts`, ре-ревью «Task 4» ПРЕДЫДУЩЕГО плана монтажа —
 * та же денежная арифметика: потолок бюджета, деградация video→image→none,
 * причины по-русски, полнота разбора `ShotBackground`). Этот модуль их НЕ
 * повторяет: он зовёт `pickBackgroundSource` на КАЖДЫЙ кадр по очереди,
 * добавляя только то, чего у неё нет —
 *
 *  1. накопитель `spentUsd` МЕЖДУ кадрами — потолок §7 общий на весь ролик,
 *     а не на один кадр, и решает его именно порядок обработки кадров;
 *  2. повторную проверку существования ссылки (`backgroundClipId`/
 *     `appReferenceId`) против `knownBackgroundIds`/`knownAppScreenIds`: план
 *     монтажа (`edit_plan`) уже проверял её при ПЛАНИРОВАНИИ, но между планом
 *     и ИСПОЛНЕНИЕМ фон в библиотеке мог деактивироваться — решение шага
 *     `edit_plan`, записанное в БД, и решение шага `shot_background`, принятое
 *     здесь и сейчас, не обязаны совпадать молча, поэтому проверка не
 *     унаследована, а сделана заново;
 *  3. склейку `BackgroundPick` в `ShotBackgroundAction` — исполнительский
 *     контракт с `billedSec` для генеративного видео и конкретным id для
 *     библиотеки/скрина — и `promptOrders`, кадры, которым нужен промпт
 *     генерации (Task 3, `shot-background-prompt-agent.ts`).
 *  4. группировку подряд идущих кадров с ОДНИМ и тем же запрошенным фоном
 *     (`reuseFrom`, правка 26.08.2026, дефект «фон меняется каждые 1.8 с» —
 *     см. отчёт `.superpowers/sdd/2026-08-24-shot-assembly/
 *     background-reuse-report.md`). Группировка — ТА ЖЕ, что уже держит
 *     непрерывное движение камеры (`shotBackgroundIdentity`/
 *     `planShotVariationSlices` в `video-tools/shot-variation.ts`), а не
 *     вторая параллельная: две разные группировки разъехались бы молча.
 *
 * Функция ЧИСТАЯ: ни БД, ни сети, ни файловой системы — ровно как у
 * `pickBackgroundSource`. Деньги и ассеты производит impure-обвязка
 * (`runShotBackgrounds` в `video-pipeline-steps.ts`), эта функция только
 * РЕШАЕТ, что делать.
 */

import { billedSeconds, pickBackgroundSource } from "./background-source"
import { DEFAULT_EDIT_PROFILE } from "./profile"
import type { ShotBackground } from "./types"
import { planShotVariationSlices, shotBackgroundIdentity } from "../video-tools/shot-variation"

/** Кадр плана монтажа — то, что реально лежит в `VideoShot` на момент исполнения. */
export interface PlannedShotRow {
  order: number
  startSec: number
  endSec: number
  sceneOrder: number | null
  foreground: string
  background: string
  backgroundClipId: string | null
  appReferenceId: string | null
  idea: string | null
  pipEnabled: boolean
}

export type ShotBackgroundAction =
  | { kind: "none" }
  | { kind: "library"; backgroundClipId: string }
  | { kind: "app_screen"; appReferenceId: string }
  | { kind: "image" }
  | { kind: "video"; billedSec: number }

export interface ShotBackgroundItem {
  order: number
  action: ShotBackgroundAction
  /**
   * Полная цена кадра ПО СМЕТЕ планирования — идёт в прогноз ролика (§14).
   * НЕ равна тому, что реально спишется в `VideoShot.costUsd`: у кадра-
   * последователя группы (`reuseFrom !== null`) смета всё ещё считает полную
   * цену источника (для прогноза это честнее — источник в принципе платный),
   * а факт спишется только на ОДНОМ кадре группы, который его произвёл
   * (требование 4 правки 26.08.2026, раннер `runShotBackgrounds`).
   */
  costUsd: number
  /** Только генеративное видео — накопитель потолка §7 (ruling B4-1). */
  countsAgainstBudgetUsd: number
  degradeReason: string | null
  /**
   * Кадр обязан переиспользовать УЖЕ произведённый файл кадра с этим
   * `order` вместо собственной генерации/материализации — тот же приём, что
   * `variationIndex` у `shot-variation.ts`, только источник, а не движение.
   * `null` — кадр производит фон сам (лидер группы либо кадр вне группы).
   *
   * Считается ТОЛЬКО для `image`/`library`/`app_screen` — генеративное видео
   * (`background === "video"`) в группировку не входит вовсе: длина заказа
   * (`billedSec`) у видео реально зависит от конкретного кадра (§7), а не
   * только от идеи. Слить пять кадров в один платный клип значило бы либо
   * соврать про длину, либо пересчитать заказ на всю группу — это отдельная
   * задача, не заказанная этой правкой (см. отчёт, раздел «за скобками»).
   */
  reuseFrom: number | null
}

export interface ShotBackgroundPlan {
  items: ShotBackgroundItem[]
  warnings: string[]
  /** Кадры, которым нужен промпт генерации. */
  promptOrders: number[]
}

export interface PlanShotBackgroundExecutionInput {
  shots: readonly PlannedShotRow[]
  imageUsd: number
  imageGenerationAllowed: boolean
  generativeVideoEnabled: boolean
  generativeVideoBudgetUsd: number
  generativeVideoUsdPerSec: number
  minGenerativeVideoSec: number
  maxGenerativeVideoSec: number
  knownBackgroundIds: ReadonlySet<string>
  knownAppScreenIds: ReadonlySet<string>
}

/**
 * Складывает решение `pickBackgroundSource` в исполнительский контракт.
 *
 * `backgroundClipId`/`appReferenceId` берутся из САМОГО кадра, а не из
 * запроса модели: `pick.background` равен `"library"`/`"app_screen"` только
 * когда `hasLibraryCandidate`/`hasAppScreen` были истинны — то есть только
 * когда соответствующий id у кадра гарантированно непустой и валидный
 * (проверено вызывающим циклом ниже).
 */
function toAction(
  pick: ShotBackground,
  shot: PlannedShotRow,
  durationSec: number,
  minGenerativeVideoSec: number,
  maxGenerativeVideoSec: number,
): ShotBackgroundAction {
  switch (pick) {
    case "none":
      return { kind: "none" }
    case "library":
      return { kind: "library", backgroundClipId: shot.backgroundClipId! }
    case "app_screen":
      return { kind: "app_screen", appReferenceId: shot.appReferenceId! }
    case "image":
      return { kind: "image" }
    case "video":
      return { kind: "video", billedSec: billedSeconds(durationSec, minGenerativeVideoSec, maxGenerativeVideoSec) }
    default: {
      // Полнота разбора ShotBackground — тем же приёмом (М-9), что и в
      // pickBackgroundSource: новый член юниона красит сборку через `never`.
      const exhaustive: never = pick
      throw new Error(`Неизвестный источник фона: ${String(exhaustive)}`)
    }
  }
}

/**
 * Для каждого кадра — order ЛИДЕРА группы подряд идущих кадров с одним и тем
 * же запрошенным фоном ({@link shotBackgroundIdentity}), чью генерацию кадр
 * обязан переиспользовать (см. {@link ShotBackgroundItem.reuseFrom}). Лидер
 * указывает сам на себя — `null`.
 *
 * Группировка — ТА ЖЕ, что уже держит непрерывное движение камеры
 * ({@link planShotVariationSlices}), а не вторая параллельная: план монтажа
 * (`shotTimeline`) уже приходит отсортированным по `order`, ровно тем
 * порядком, которого требует эта функция.
 *
 * Генеративное видео исключено из группировки ЯВНО, ДО вызова общей функции:
 * у неё identity `video:idea` сгруппировала бы кадры видео точно так же, как
 * картинку, а заказ видео обязан остаться ПЕРСОНАЛЬНЫМ для каждого кадра —
 * длина заказа (`billedSec`) реально зависит от длины ИМЕННО этого кадра
 * (§7), слить пять кадров в один платный клип значило бы либо соврать про
 * длину, либо пересчитать заказ на всю группу — отдельная задача, не
 * заказанная этой правкой. Подмена ключа на `null` перед вызовом — тот же
 * приём, что `shotBackgroundIdentity` уже применяет для «фона нет»/«идея
 * пуста»: `null` не группируется ни с кем, кадр остаётся сам себе лидером.
 */
function computeReuseFromByOrder(
  shots: readonly {
    order: number
    startSec: number
    endSec: number
    background: string
    backgroundClipId: string | null
    appReferenceId: string | null
    idea: string | null
  }[],
): Map<number, number | null> {
  const slices = planShotVariationSlices(shots.map(s => ({
    order: s.order,
    startSec: s.startSec,
    endSec: s.endSec,
    backgroundKey: s.background === "video" ? null : shotBackgroundIdentity(s),
  })))

  // Лидер группы — кадр с МЕНЬШИМ order среди её членов: `shots` приходит по
  // возрастанию order (требование этой же функции ниже), значит именно он
  // будет обработан ПЕРВЫМ и успеет произвести файл раньше, чем до него
  // дойдёт очередь у последователей.
  const leaderOrderByGroupIndex = new Map<number, number>()
  for (const [order, slice] of slices) {
    const current = leaderOrderByGroupIndex.get(slice.index)
    if (current === undefined || order < current) leaderOrderByGroupIndex.set(slice.index, order)
  }

  const reuseFromByOrder = new Map<number, number | null>()
  for (const [order, slice] of slices) {
    const leaderOrder = leaderOrderByGroupIndex.get(slice.index)!
    reuseFromByOrder.set(order, leaderOrder === order ? null : leaderOrder)
  }
  return reuseFromByOrder
}

/**
 * Планирует исполнение фонов ВСЕХ кадров ролика по порядку.
 *
 * Порядок обработки — порядок `input.shots` (вызывающий обязан передать его
 * отсортированным по `order`, как и приходит из БД `orderBy: { order: "asc" }`):
 * потолок §7 исчерпывается по накопительной сумме, и именно порядок решает,
 * КАКИЕ кадры попадут под деградацию при исчерпанном бюджете — «первые
 * успевшие», а не «последние в списке». Тот же порядок гарантирует, что
 * лидер группы фона (`reuseFrom`) обработается раньше своих последователей.
 */
export function planShotBackgroundExecution(input: PlanShotBackgroundExecutionInput): ShotBackgroundPlan {
  // pickBackgroundSource читает из профиля только два поля (generativeVideoEnabled,
  // generativeVideoBudgetUsd) — остальные берутся из DEFAULT_EDIT_PROFILE, чтобы
  // не тащить сюда полный ResolvedEditProfile ради двух чисел и не дублировать
  // его форму приведением типа.
  const profile = {
    ...DEFAULT_EDIT_PROFILE,
    generativeVideoEnabled: input.generativeVideoEnabled,
    generativeVideoBudgetUsd: input.generativeVideoBudgetUsd,
  }

  let spentUsd = 0
  const items: ShotBackgroundItem[] = []
  const degradeCounts = new Map<string, number>()
  const reuseFromByOrder = computeReuseFromByOrder(input.shots)

  for (const shot of input.shots) {
    const durationSec = shot.endSec - shot.startSec
    const hasLibraryCandidate = shot.background === "library"
      && shot.backgroundClipId !== null
      && input.knownBackgroundIds.has(shot.backgroundClipId)
    const hasAppScreen = shot.background === "app_screen"
      && shot.appReferenceId !== null
      && input.knownAppScreenIds.has(shot.appReferenceId)

    const pick = pickBackgroundSource({
      durationSec,
      profile,
      requested: shot.background as ShotBackground,
      spentUsd,
      hasLibraryCandidate,
      hasAppScreen,
      generativeVideoUsdPerSec: input.generativeVideoUsdPerSec,
      imageUsd: input.imageUsd,
      minGenerativeVideoSec: input.minGenerativeVideoSec,
      maxGenerativeVideoSec: input.maxGenerativeVideoSec,
      imageGenerationAllowed: input.imageGenerationAllowed,
    })

    // Ruling B4-1: накопитель ТОЛЬКО из countsAgainstBudgetUsd, не из costUsd —
    // иначе картинки исчерпывали бы потолок Kling втрое быстрее задуманного.
    spentUsd += pick.countsAgainstBudgetUsd

    if (pick.degradeReason) {
      degradeCounts.set(pick.degradeReason, (degradeCounts.get(pick.degradeReason) ?? 0) + 1)
    }

    items.push({
      order: shot.order,
      action: toAction(pick.background, shot, durationSec, input.minGenerativeVideoSec, input.maxGenerativeVideoSec),
      costUsd: pick.costUsd,
      countsAgainstBudgetUsd: pick.countsAgainstBudgetUsd,
      degradeReason: pick.degradeReason,
      reuseFrom: reuseFromByOrder.get(shot.order) ?? null,
    })
  }

  // Одинаковые причины деградации на плане из десятков кадров — не десятки
  // одинаковых строк в лог, а одна с числом (тот же приём, что у runEditPlanStep).
  const warnings: string[] = []
  for (const [reason, count] of degradeCounts) {
    warnings.push(count > 1 ? `${reason} (кадров: ${count})` : reason)
  }

  // Последователь группы (`reuseFrom !== null`) переиспользует ФАЙЛ лидера —
  // ему просить собственный промпт не за чем: агент промптов зовётся ОДНИМ
  // батчем на все `promptOrders`, и лишние order здесь — это лишние токены
  // без единого кадра, который бы их использовал.
  const promptOrders = items
    .filter(item => (item.action.kind === "image" || item.action.kind === "video") && item.reuseFrom === null)
    .map(item => item.order)

  return { items, warnings, promptOrders }
}
