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
 *
 * Функция ЧИСТАЯ: ни БД, ни сети, ни файловой системы — ровно как у
 * `pickBackgroundSource`. Деньги и ассеты производит impure-обвязка
 * (`runShotBackgrounds` в `video-pipeline-steps.ts`), эта функция только
 * РЕШАЕТ, что делать.
 */

import { billedSeconds, pickBackgroundSource } from "./background-source"
import { DEFAULT_EDIT_PROFILE } from "./profile"
import type { ShotBackground } from "./types"

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
  /** Полная цена кадра — идёт в смету ролика (§14) и в `VideoShot.costUsd`. */
  costUsd: number
  /** Только генеративное видео — накопитель потолка §7 (ruling B4-1). */
  countsAgainstBudgetUsd: number
  degradeReason: string | null
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
 * Планирует исполнение фонов ВСЕХ кадров ролика по порядку.
 *
 * Порядок обработки — порядок `input.shots` (вызывающий обязан передать его
 * отсортированным по `order`, как и приходит из БД `orderBy: { order: "asc" }`):
 * потолок §7 исчерпывается по накопительной сумме, и именно порядок решает,
 * КАКИЕ кадры попадут под деградацию при исчерпанном бюджете — «первые
 * успевшие», а не «последние в списке».
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
    })
  }

  // Одинаковые причины деградации на плане из десятков кадров — не десятки
  // одинаковых строк в лог, а одна с числом (тот же приём, что у runEditPlanStep).
  const warnings: string[] = []
  for (const [reason, count] of degradeCounts) {
    warnings.push(count > 1 ? `${reason} (кадров: ${count})` : reason)
  }

  const promptOrders = items
    .filter(item => item.action.kind === "image" || item.action.kind === "video")
    .map(item => item.order)

  return { items, warnings, promptOrders }
}
