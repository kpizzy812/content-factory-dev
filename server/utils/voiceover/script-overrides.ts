/**
 * Правки сценария, ЛИЧНЫЕ для ролика (`Video.scriptOverrides`).
 *
 * Их два вида, и оба лежат в ОДНОЙ колонке:
 *  - `lines` — поправленные РЕПЛИКИ (то, что звучит);
 *  - `subtitles` — поправленные ПОДПИСИ (`subtitleCopy`/`subtitlePlacement`,
 *    то, что видно на экране), их пишет `POST /api/videos/[id]/edit-subtitles`.
 *
 * Второй колонки под подписи не заведено намеренно: у неё был бы свой читатель
 * и своя точка наложения, а забытая точка наложения — это ровно тот класс
 * дефекта, который этот модуль и чинит (правка субтитров жила в общем варианте
 * ещё три недели после того, как реплики оттуда уехали).
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
import type { SubtitleAlignment, SubtitlePlacement, SubtitlePosition } from "../../../shared/types/story"

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

/**
 * Одна поправленная ПОДПИСЬ ролика: экранный текст сцены и/или его положение.
 *
 * Оба поля необязательны, но хотя бы одно обязано быть: оператор правит либо
 * текст, либо позицию, либо и то, и другое одним запросом.
 */
export interface SubtitleSceneOverride {
  sceneOrder: number
  /** Экранный текст сцены (`scenes[].subtitleCopy`). undefined — не правился. */
  copy?: string
  /** Положение подписи (`scenes[].subtitlePlacement`). undefined — не правилось. */
  placement?: SubtitlePlacement
  at: string
}

/** Содержимое колонки `Video.scriptOverrides`. */
export interface VideoScriptOverrides {
  /**
   * Версия формата. Читатель обязан пережить чужую версию, а не упасть, поэтому
   * сам номер нигде не сверяется: список `subtitles` добавлен к `v: 1` как
   * необязательное поле, и ролики, правленные до его появления, читаются
   * по-прежнему (`subtitles` там просто нет → пустой список).
   */
  v: 1
  lines: ScriptLineOverride[]
  subtitles: SubtitleSceneOverride[]
}

const SUBTITLE_POSITIONS: readonly string[] = ["top", "center", "bottom"]
const SUBTITLE_ALIGNMENTS: readonly string[] = ["left", "center", "right"]

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
 * Разбор списка ПОДПИСЕЙ. Правила те же, что у реплик: мусор даёт пустой
 * список, а не бросок.
 */
export function readSubtitleOverrides(raw: unknown): SubtitleSceneOverride[] {
  const value = raw as Record<string, unknown> | null | undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  if (!Array.isArray(value.subtitles)) return []

  const result: SubtitleSceneOverride[] = []
  for (const item of value.subtitles as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") continue
    const sceneOrder = Number(item.sceneOrder)
    if (!Number.isFinite(sceneOrder)) continue

    const copy = typeof item.copy === "string" ? item.copy : undefined
    const placement = readPlacement(item.placement)
    // Запись без единого поля правки накладывать некуда — она бесполезна.
    if (copy === undefined && !placement) continue

    result.push({
      sceneOrder,
      ...(copy === undefined ? {} : { copy }),
      ...(placement ? { placement } : {}),
      at: typeof item.at === "string" ? item.at : "",
    })
  }
  return result
}

/** Полностью заданное положение подписи или `null`, если запись неполна/мусорна. */
function readPlacement(raw: unknown): SubtitlePlacement | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const position = typeof value.position === "string" ? value.position : ""
  const alignment = typeof value.alignment === "string" ? value.alignment : ""
  if (!SUBTITLE_POSITIONS.includes(position) || !SUBTITLE_ALIGNMENTS.includes(alignment)) return null
  return {
    position: position as SubtitlePosition,
    alignment: alignment as SubtitleAlignment,
    avoidZones: Array.isArray(value.avoidZones)
      ? value.avoidZones.filter((zone): zone is string => typeof zone === "string")
      : [],
  }
}

/**
 * Общий сценарий ГЛАЗАМИ конкретного ролика.
 *
 * Накладываются ОБА вида правок — реплики и подписи. Второй точки наложения не
 * заводится намеренно: у `edit-subtitles` она была бы своей, и ровно про
 * забытую точку наложения этот модуль и написан.
 *
 * Правок нет — возвращается ТОТ ЖЕ объект: ролик без правок обязан читать общий
 * вариант, а не копию. Копируй мы всегда, у каждого ролика завёлся бы мёртвый
 * дубль большого `storyPlan`, а наследование от варианта потерялось бы.
 */
export function applyScriptOverrides<T>(storyPlan: T, raw: unknown): T {
  const lines = readScriptOverrides(raw)
  const subtitles = readSubtitleOverrides(raw)
  if (lines.length === 0 && subtitles.length === 0) return storyPlan

  let plan = storyPlan
  for (const line of lines) {
    const patch = planScriptTextPatch({ storyPlan: plan, sceneOrder: line.sceneOrder, newText: line.text })
    // Якоря нет (сцену выкинули из варианта при rework) — правку молча роняем:
    // выдумывать сцену нельзя, а ронять из-за неё весь сценарий тем более.
    if (patch.ok && patch.changed) plan = patch.storyPlan as T
  }
  if (subtitles.length > 0) plan = applySubtitlePatches(plan, subtitles)
  return plan
}

/**
 * Наложение подписей. Реплику НЕ трогает вовсе: `subtitleCopy` — это пересказ
 * сценариста для экрана, а `spokenLine` — то, что звучит. Задень одно другое,
 * ролик оплатил бы пересинтез трека и lip-sync ради подписи под кадром.
 */
function applySubtitlePatches<T>(storyPlan: T, patches: readonly SubtitleSceneOverride[]): T {
  const plan = storyPlan as unknown as Record<string, unknown> | null | undefined
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return storyPlan
  const scenes = Array.isArray(plan.scenes) ? (plan.scenes as Array<Record<string, unknown>>) : null
  if (!scenes) return storyPlan

  const byOrder = new Map<number, SubtitleSceneOverride>()
  for (const patch of patches) byOrder.set(patch.sceneOrder, patch)

  let touched = false
  const nextScenes = scenes.map((scene) => {
    const patch = byOrder.get(Number(scene.order))
    if (!patch) return scene
    const next = { ...scene }
    if (patch.copy !== undefined) next.subtitleCopy = patch.copy
    if (patch.placement) next.subtitlePlacement = patch.placement
    touched = true
    return next
  })

  // Правка сцены, которой в варианте уже нет, роняет только себя: копию плана
  // ради неё не заводим.
  if (!touched) return storyPlan
  return { ...plan, scenes: nextScenes } as unknown as T
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

  // Список подписей переносится КАК ЕСТЬ: колонка одна на оба вида правок, и
  // запись реплики не имеет права стереть подписи, которые оператор уже
  // выставил руками.
  return { ok: true, target: patch.target, changed: true, overrides: { v: 1, lines, subtitles: readSubtitleOverrides(input.overrides) } }
}

/** Патч подписей, пришедший от оператора: ровно тело ручки `edit-subtitles`. */
export interface SubtitleScenePatch {
  order: number
  subtitleCopy?: string
  subtitlePlacement?: Partial<SubtitlePlacement>
}

export type VideoSubtitleOverridePlan =
  | {
    ok: true
    /** `false` — ролик уже читает ровно эти подписи, писать нечего. */
    changed: boolean
    /** Сколько сцен реально поправлено (сцены вне сценария не считаются). */
    patched: number
    overrides: VideoScriptOverrides
  }
  | { ok: false, reason: string }

/**
 * Правка подписей ролика: что записать в `Video.scriptOverrides`.
 *
 * Сравнение идёт с ЭФФЕКТИВНЫМ сценарием (общий вариант плюс прежние правки
 * ролика) — как и у реплик. Повторный заход с тем же текстом не пишет ничего:
 * лишний UPDATE ролика тянет за собой лишнюю пересборку mp4 на каждый клик
 * «сохранить».
 *
 * ВАЛИДАЦИЯ ПОЛОЖЕНИЯ ЖИВЁТ ЗДЕСЬ, а не в ручке. Мусорное `position` не
 * пишется, а замещается тем, что стояло у сцены В ЭФФЕКТИВНОМ сценарии: то же
 * правило, что было в ручке, но в одном месте с наложением. Разъедься они —
 * ручка писала бы одно, а рендер читал другое.
 */
export function planVideoSubtitleOverride(input: {
  storyPlan: unknown
  overrides: unknown
  scenes: readonly SubtitleScenePatch[]
  /** Отметка времени — параметром ради воспроизводимых тестов. */
  at?: string
}): VideoSubtitleOverridePlan {
  const effective = applyScriptOverrides(input.storyPlan, input.overrides) as Record<string, unknown> | null
  if (!effective || typeof effective !== "object" || Array.isArray(effective)) {
    return { ok: false, reason: "у ролика нет сценария (storyPlan)" }
  }
  const scenes = Array.isArray(effective.scenes) ? (effective.scenes as Array<Record<string, unknown>>) : null
  if (!scenes) return { ok: false, reason: "в сценарии нет сцен" }

  const at = input.at ?? new Date().toISOString()
  const previous = readSubtitleOverrides(input.overrides)
  const next = new Map<number, SubtitleSceneOverride>()
  for (const entry of previous) next.set(entry.sceneOrder, entry)

  let patched = 0
  for (const patch of input.scenes) {
    const sceneOrder = Number(patch.order)
    const scene = scenes.find(item => Number(item.order) === sceneOrder)
    // Сцены нет в сценарии — правка роняет только себя. Выдумывать сцену
    // нельзя, а отвергать из-за неё весь запрос — значит терять остальные.
    if (!scene) continue

    const currentCopy = typeof scene.subtitleCopy === "string" ? scene.subtitleCopy : ""
    const currentPlacement = readPlacement(scene.subtitlePlacement)
    const entry: SubtitleSceneOverride = { sceneOrder, at }
    const existing = next.get(sceneOrder)
    if (existing?.copy !== undefined) entry.copy = existing.copy
    if (existing?.placement) entry.placement = existing.placement

    let changedHere = false
    if (typeof patch.subtitleCopy === "string" && patch.subtitleCopy !== currentCopy) {
      entry.copy = patch.subtitleCopy
      changedHere = true
    }
    if (patch.subtitlePlacement) {
      const merged = mergePlacement(patch.subtitlePlacement, currentPlacement)
      if (!samePlacement(merged, currentPlacement)) {
        entry.placement = merged
        changedHere = true
      }
    }
    if (!changedHere) continue

    next.set(sceneOrder, entry)
    patched += 1
  }

  if (patched === 0) {
    return { ok: true, changed: false, patched: 0, overrides: toOverrides(input.overrides) }
  }

  const subtitles = [...next.values()].sort((a, b) => a.sceneOrder - b.sceneOrder)
  // Список реплик переносится КАК ЕСТЬ — см. довод у `planVideoScriptOverride`.
  return { ok: true, changed: true, patched, overrides: { v: 1, lines: readScriptOverrides(input.overrides), subtitles } }
}

/**
 * Присланное положение поверх нынешнего. Мусорное значение НЕ пишется:
 * берётся то, что стояло у сцены, а совсем ничего не стояло — общий дефолт
 * (низ по центру), тот же, что был в ручке.
 */
function mergePlacement(
  patch: Partial<SubtitlePlacement>,
  current: SubtitlePlacement | null,
): SubtitlePlacement {
  const position = typeof patch.position === "string" && SUBTITLE_POSITIONS.includes(patch.position)
    ? patch.position
    : current?.position ?? "bottom"
  const alignment = typeof patch.alignment === "string" && SUBTITLE_ALIGNMENTS.includes(patch.alignment)
    ? patch.alignment
    : current?.alignment ?? "center"
  const avoidZones = Array.isArray(patch.avoidZones)
    ? patch.avoidZones.filter((zone): zone is string => typeof zone === "string")
    : current?.avoidZones ?? []
  return { position, alignment, avoidZones: [...avoidZones] }
}

function samePlacement(left: SubtitlePlacement, right: SubtitlePlacement | null): boolean {
  if (!right) return false
  return left.position === right.position
    && left.alignment === right.alignment
    && left.avoidZones.length === right.avoidZones.length
    && left.avoidZones.every((zone, index) => zone === right.avoidZones[index])
}

function toOverrides(raw: unknown): VideoScriptOverrides {
  return { v: 1, lines: readScriptOverrides(raw), subtitles: readSubtitleOverrides(raw) }
}
