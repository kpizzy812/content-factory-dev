/**
 * Правки сценария, ЛИЧНЫЕ для ролика (`Video.scriptOverrides`).
 *
 * ─── Зачем ────────────────────────────────────────────────────────────────
 *
 * Локальная замена фразы обязана писать новый текст в сценарий: трек озвучки —
 * ПРОИЗВОДНАЯ сценария, и полная перегенерация собирает его заново из
 * `storyPlan`. Правка, не доехавшая до сценария, живёт до первой перегенерации,
 * а потом молча возвращает старую фразу.
 *
 * Писала она в `ScenarioVariant.storyPlan` — и это была дыра. Вариант ОБЩИЙ:
 * `Video.variantId` уникальности не даёт, один вариант кормит сколько угодно
 * роликов, а конвейер и вовсе выбирает вариант через
 * `scenario.selectedVariantId` (`video-pipeline.ts`, `selectScenarioVariantForVideo`),
 * то есть на ролик не смотрит вообще. Правка фразы на ролике A переписывала
 * сценарий ролику B — уже снятому или снимающемуся, — и B при первой же
 * перегенерации синтезировал чужой текст и платил за него: сначала TTS, следом
 * lip-sync всех сцен (~$14 на двадцати сценах).
 *
 * ─── Почему правка на ролике, а не копия варианта ─────────────────────────
 *
 * Копия варианта при первой правке (fork-on-write) выглядит очевидной и не
 * работает:
 *
 *  - `runVideoPipeline` берёт вариант НЕ по `Video.variantId`, а по
 *    `scenario.selectedVariantId` → accepted → первый по порядку. Переключи мы
 *    ролик на форк, прогон продолжил бы читать общий вариант — то есть починка
 *    не починила бы ничего;
 *  - форк — полноценная строка `ScenarioVariant` со своим `variantIndex`,
 *    статусом и оценками критика. Она вылезла бы в списке вариантов сценария и
 *    в выборе оператора как «ещё один вариант», которым не является;
 *  - форк ЗАМОРАЖИВАЕТ сценарий ролика: законные правки общего варианта
 *    (rework, регенерация блока, `edit-subtitles`) перестали бы до ролика
 *    доезжать молча.
 *
 * Поэтому правка хранится ПАТЧЕМ на ролике и накладывается при чтении — ровно
 * тем же приёмом, что `Video.editOverrides` поверх `EditProfile`. Ролик
 * наследует общий сценарий и переопределяет в нём только те реплики, которые
 * оператор правил руками. Копии плана не возникает вовсе: у ролика без правок
 * колонка пуста, и чтение возвращает ТОТ ЖЕ объект варианта.
 *
 * ─── Куда ложится правка ──────────────────────────────────────────────────
 *
 * Решает `planScriptTextPatch` — тот же приоритет, что и у сборки трека
 * (`mergeScriptLines`): реплика ведущего в кадре главнее закадровой строки.
 * Наложение идёт через неё же, а не своей копией правила: разойдись два места,
 * закадровая сцена получила бы `spokenLine`, то есть говорящего в кадре там,
 * где его не было, и ролик оплатил бы лишний lip-sync.
 */

import { planScriptTextPatch, type ScriptTextTarget } from "./script-patch"

export type { ScriptTextTarget }

/** Одна поправленная реплика ролика. */
export interface ScriptLineOverride {
  sceneOrder: number
  /**
   * Куда правка легла в момент записи. Диагностика для оператора и логов: при
   * чтении цель определяется заново по актуальному сценарию, потому что общий
   * вариант мог с тех пор измениться.
   */
  target: ScriptTextTarget
  text: string
  at: string
}

/** Содержимое колонки `Video.scriptOverrides`. */
export interface VideoScriptOverrides {
  /** Версия формата. Читатель обязан пережить чужую версию, а не упасть. */
  v: 1
  lines: ScriptLineOverride[]
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Разбор колонки. Мусор и незнакомые формы дают ПУСТОЙ список, а не бросок:
 * ролик со сломанной колонкой обязан собираться по общему сценарию, а не
 * падать посреди прогона.
 */
export function readScriptOverrides(raw: unknown): ScriptLineOverride[] {
  const value = raw as Record<string, unknown> | null | undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  if (!Array.isArray(value.lines)) return []

  const lines: ScriptLineOverride[] = []
  for (const item of value.lines as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") continue
    const sceneOrder = Number(item.sceneOrder)
    const text = textOf(item.text)
    // Строка без номера сцены или без текста наложить некуда — она бесполезна.
    if (!Number.isFinite(sceneOrder) || !text) continue
    lines.push({
      sceneOrder,
      target: item.target === "narration" ? "narration" : "spoken",
      text,
      at: typeof item.at === "string" ? item.at : "",
    })
  }
  return lines
}

/**
 * Общий сценарий ГЛАЗАМИ конкретного ролика.
 *
 * Правок нет — возвращается ТОТ ЖЕ объект: ролик без правок обязан читать общий
 * вариант, а не копию. Копируй мы всегда, у каждого ролика завёлся бы мёртвый
 * дубль большого `storyPlan`, а наследование от варианта потерялось бы.
 */
export function applyScriptOverrides<T>(storyPlan: T, raw: unknown): T {
  const lines = readScriptOverrides(raw)
  if (lines.length === 0) return storyPlan

  let plan = storyPlan
  for (const line of lines) {
    const patch = planScriptTextPatch({ storyPlan: plan, sceneOrder: line.sceneOrder, newText: line.text })
    // Якоря нет (сцену выкинули из варианта при rework) — правку молча роняем:
    // выдумывать сцену нельзя, а ронять из-за неё весь сценарий тем более.
    if (patch.ok && patch.changed) plan = patch.storyPlan as T
  }
  return plan
}

export type VideoScriptOverridePlan =
  | {
    ok: true
    /** Куда легла правка: реплика в кадре или закадровая строка. */
    target: ScriptTextTarget
    /** `false` — ролик уже читает ровно этот текст, писать нечего. */
    changed: boolean
    /** Новое содержимое колонки ролика. */
    overrides: VideoScriptOverrides
  }
  | { ok: false, reason: string }

/**
 * Правка одной реплики ролика: что записать в `Video.scriptOverrides`.
 *
 * Сравнение идёт с ЭФФЕКТИВНЫМ сценарием (общий вариант плюс прежние правки
 * ролика), поэтому повторный заход замены не пишет ничего: замена обязана быть
 * идемпотентной, а лишнее обновление ролика — это ещё и лишний UPDATE в
 * транзакции фиксации.
 */
export function planVideoScriptOverride(input: {
  storyPlan: unknown
  overrides: unknown
  sceneOrder: number
  newText: string
  /** Отметка времени — параметром ради воспроизводимых тестов. */
  at?: string
}): VideoScriptOverridePlan {
  const effective = applyScriptOverrides(input.storyPlan, input.overrides)
  const patch = planScriptTextPatch({
    storyPlan: effective,
    sceneOrder: input.sceneOrder,
    newText: input.newText,
  })
  if (!patch.ok) return patch
  if (!patch.changed) {
    return { ok: true, target: patch.target, changed: false, overrides: toOverrides(input.overrides) }
  }

  const entry: ScriptLineOverride = {
    sceneOrder: input.sceneOrder,
    target: patch.target,
    text: input.newText.trim(),
    at: input.at ?? new Date().toISOString(),
  }
  const previous = readScriptOverrides(input.overrides)
  // Правка ЗАМЕЩАЕТ прежнюю правку той же сцены, а не копится рядом: иначе
  // колонка росла бы на каждый клик, а порядок наложения решал бы, чей текст
  // победит.
  const lines = previous.filter(line => line.sceneOrder !== input.sceneOrder)
  lines.push(entry)
  lines.sort((a, b) => a.sceneOrder - b.sceneOrder)

  return { ok: true, target: patch.target, changed: true, overrides: { v: 1, lines } }
}

function toOverrides(raw: unknown): VideoScriptOverrides {
  return { v: 1, lines: readScriptOverrides(raw) }
}
