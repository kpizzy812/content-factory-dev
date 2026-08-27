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
import {
  GROUP_CONTIGUITY_TOLERANCE_SEC,
  planShotVariationSlices,
  shotBackgroundIdentity,
} from "../video-tools/shot-variation"

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
 * Генеративное видео эта функция считает наравне с картинкой — по той же
 * identity `video:idea`. Она отвечает на вопрос «какой кадр производит файл»,
 * и для деградировавшего до картинки видео-кадра ответ ровно тот же, что для
 * обычной картинки. Кадры, которые останутся видео, перекрываются
 * {@link computeVideoGroups}: у них группа дополнительно ограничена потолком
 * длины модели, потому что заказ там оплачивается секундами.
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
    backgroundKey: shotBackgroundIdentity(s),
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

/** Допуск на шум плавающей точки — та же величина, что `FLOAT_GUARD` в `background-source.ts`. */
const GROUP_FLOAT_GUARD = 1e-9

interface VideoGroupPlan {
  /** order лидера для последователя; `null` — кадр сам лидер. Только для кадров из {@link VideoGroupPlan.groupedOrders}. */
  leaderByOrder: Map<number, number | null>
  /** Суммарная длительность группы по её лидеру — столько секунд заказывает лидер. */
  groupDurationByLeader: Map<number, number>
  /** Кадры, чья группировка решается ЭТОЙ функцией, а не общей картиночной. */
  groupedOrders: Set<number>
}

/**
 * Группы генеративного видео: подряд идущие кадры с одной идеей, которым
 * заказывается ОДИН клип на всю группу вместо клипа на каждый кадр.
 *
 * Зачем. Пять подряд идущих кадров с одной `idea` давали пять независимых
 * клипов Kling — на экране это тот же «фон меняется каждые 1.8 с», который
 * для картинок вылечила группировка 26.08.2026, только здесь он ещё и
 * оплачивался пятью вызовами провайдера.
 *
 * Два ограничения, которых нет у картинок, — оба денежные:
 *
 * 1. **В группу входит только кадр, который получил бы видео и в одиночку**
 *    (длина в границах `[min, max]` §7). Слить три кадра по 1.8 с в один
 *    девятисекундный заказ значило бы ОТКРЫТЬ видео там, где порог §7 его
 *    закрывает, — рост расхода под видом экономии. Такие кадры идут прежним
 *    путём и деградируют до картинки поштучно.
 * 2. **Сумма группы не больше `maxGenerativeVideoSec`** — длиннее одного
 *    клипа не заказать (`pickBackgroundSource` отбивает такую длину), поэтому
 *    группа рвётся о потолок модели и следующий кадр начинает свою.
 *
 * Тариф провайдера линеен по секундам, поэтому слияние денежно НЕЙТРАЛЬНО:
 * два заказа по 5 с и один на 10 с стоят одинаково. Выигрыш — непрерывная
 * картинка и один платный вызов вместо N (меньше латентности и меньше точек
 * отказа), а не меньшая сумма.
 */
function computeVideoGroups(
  shots: readonly PlannedShotRow[],
  minGenerativeVideoSec: number,
  maxGenerativeVideoSec: number,
): VideoGroupPlan {
  const leaderByOrder = new Map<number, number | null>()
  const groupDurationByLeader = new Map<number, number>()
  const groupedOrders = new Set<number>()

  const boundsUsable = Number.isFinite(minGenerativeVideoSec) && Number.isFinite(maxGenerativeVideoSec)
    && minGenerativeVideoSec > 0 && maxGenerativeVideoSec >= minGenerativeVideoSec

  let leaderOrder: number | null = null
  let leaderKey: string | null = null
  let accumulatedSec = 0
  let previousEndSec = Number.NaN

  for (const shot of shots) {
    const durationSec = shot.endSec - shot.startSec
    const key = shot.background === "video" ? shotBackgroundIdentity(shot) : null
    const eligible = boundsUsable && key !== null && Number.isFinite(durationSec)
      && durationSec >= minGenerativeVideoSec - GROUP_FLOAT_GUARD
      && durationSec <= maxGenerativeVideoSec + GROUP_FLOAT_GUARD

    if (!eligible) {
      leaderOrder = null
      leaderKey = null
      accumulatedSec = 0
      previousEndSec = shot.endSec
      continue
    }

    groupedOrders.add(shot.order)
    const continues = leaderOrder !== null
      && key === leaderKey
      && Math.abs(shot.startSec - previousEndSec) <= GROUP_CONTIGUITY_TOLERANCE_SEC
      && accumulatedSec + durationSec <= maxGenerativeVideoSec + GROUP_FLOAT_GUARD

    if (continues) {
      leaderByOrder.set(shot.order, leaderOrder)
      accumulatedSec += durationSec
      groupDurationByLeader.set(leaderOrder!, accumulatedSec)
    }
    else {
      leaderOrder = shot.order
      leaderKey = key
      accumulatedSec = durationSec
      leaderByOrder.set(shot.order, null)
      groupDurationByLeader.set(shot.order, durationSec)
    }
    previousEndSec = shot.endSec
  }

  return { leaderByOrder, groupDurationByLeader, groupedOrders }
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
  const itemByOrder = new Map<number, ShotBackgroundItem>()
  const degradeCounts = new Map<string, number>()
  const reuseFromByOrder = computeReuseFromByOrder(input.shots)
  const videoGroups = computeVideoGroups(input.shots, input.minGenerativeVideoSec, input.maxGenerativeVideoSec)

  for (const shot of input.shots) {
    const videoLeaderOrder = videoGroups.groupedOrders.has(shot.order)
      ? videoGroups.leaderByOrder.get(shot.order) ?? null
      : null

    // Последователь видео-группы не решает ничего сам: он получит ФАЙЛ лидера,
    // и его собственное решение может только разойтись с тем, что реально
    // произведено. Деньги на нём нулевые — заплатил лидер, один раз за клип.
    if (videoLeaderOrder !== null) {
      const leaderItem = itemByOrder.get(videoLeaderOrder)
      if (leaderItem) {
        if (leaderItem.degradeReason) {
          degradeCounts.set(leaderItem.degradeReason, (degradeCounts.get(leaderItem.degradeReason) ?? 0) + 1)
        }
        const follower: ShotBackgroundItem = {
          order: shot.order,
          action: leaderItem.action,
          costUsd: 0,
          countsAgainstBudgetUsd: 0,
          degradeReason: leaderItem.degradeReason,
          reuseFrom: videoLeaderOrder,
        }
        items.push(follower)
        itemByOrder.set(shot.order, follower)
        continue
      }
      // Лидера нет в обработанных — порядок обхода нарушен вызывающим
      // (`shots` не отсортирован по order). Не молчим и не гадаем: кадр
      // считается сам по себе, как до группировки.
    }

    const durationSec = shot.endSec - shot.startSec
    const hasLibraryCandidate = shot.background === "library"
      && shot.backgroundClipId !== null
      && input.knownBackgroundIds.has(shot.backgroundClipId)
    const hasAppScreen = shot.background === "app_screen"
      && shot.appReferenceId !== null
      && input.knownAppScreenIds.has(shot.appReferenceId)

    // Лидер видео-группы заказывает клип на ВСЮ группу, поэтому и решение о
    // нём (порог §7, квантование, потолок бюджета) считается от длины группы,
    // а не от длины собственного кадра.
    const billableDurationSec = videoGroups.groupDurationByLeader.get(shot.order) ?? durationSec

    const pick = pickBackgroundSource({
      durationSec: billableDurationSec,
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

    const item: ShotBackgroundItem = {
      order: shot.order,
      action: toAction(pick.background, shot, billableDurationSec, input.minGenerativeVideoSec, input.maxGenerativeVideoSec),
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
