/**
 * Шаг плана монтажа: код режет сетку кадров (`grid.ts`), модель заполняет
 * смысл, код проверяет и чинит результат (`validate.ts`/`repair.ts`,
 * `pickBackgroundSource`), кадры уходят на сохранение.
 *
 * Зависимости внедряются — по образцу `transcription/runner.ts`: содержательная
 * часть шага обязана проверяться без БД, сети и денег. DB-обвязка (кэш по
 * отпечатку трека, `ensureStep`/`updateStep`, `logStepCost`) живёт СНАРУЖИ, в
 * `runVideoEditPlan` (`video-pipeline-steps.ts`) — этот модуль про неё не знает.
 *
 * Порядок работы:
 * 1. Сетка кадров считается кодом (`buildShotGrid`) — границы уже готовы,
 *    модель их не трогает.
 * 2. Модель (`deps.askModel`) заполняет смысл: `foreground`/`background`/...
 * 3. Ответ склеивается с сеткой ПО `order`, а не по длине массива — фикстура
 *    мока Anthropic статическая и физически не совпадает по длине с
 *    динамической сеткой конкретного ролика. Незаполненные ячейки получают
 *    детерминированный дефолт.
 * 4. Валидация и ремонт — ДО НЕПОДВИЖНОЙ ТОЧКИ, а не один раз: перебор на
 *    20 000 сценариев (Task 3) показал, что 559 планов меняются между первым и
 *    вторым проходом ремонта. `broll_ratio` — предупреждение, не блокирующее
 *    нарушение: раскладка ведущего/перебивок — смысл, а не арифметика, и
 *    ремонт её не чинит и не может починить.
 * 5. Второй запрос к модели — только если ремонт не сошёлся за отведённое
 *    число проходов; в запрос кладётся текст нарушений (§5.3). Вторая неудача
 *    — честное исключение, ролик не идёт дальше с планом, в котором дыра.
 * 6. Каждый кадр обязан пройти через `pickBackgroundSource` — единственное
 *    место, где потолок стоимости генеративного видео (§7) исполняется ДО
 *    оплаты. Копится `pick.countsAgainstBudgetUsd`, а не `pick.costUsd`.
 */

import { buildShotGrid } from "./grid"
import { repairShotPlan } from "./repair"
import { validateShotPlan } from "./validate"
import { pickBackgroundSource } from "./background-source"
import type { ShotPlanContext, ShotPlanViolation } from "./validate"
import type { PlannedShot, PlannedShotWithCost, ShotBackground, ShotForeground, ShotPlan } from "./types"
import type { ResolvedEditProfile } from "./profile"
import type { AlignedScene } from "../transcription/align"

export interface EditPlanBackgroundOption {
  id: string
  kind: string
  name: string | null
  tags: string[]
}

export interface EditPlanAppScreenOption {
  id: string
  tags: string[]
  caption: string | null
}

/** Сетка, которую видит модель: границы кодовые, только для контекста смысла. */
export interface EditPlanGridCellForModel {
  order: number
  startSec: number
  endSec: number
  sceneOrder: number | null
  /** Текст сцены в этом отрезке — распознанные слова, попавшие в границы. */
  text: string
}

/** То, что модель обязана вернуть на каждый заполненный ею кадр. */
export interface EditPlanModelShot {
  order: number
  foreground: ShotForeground
  background: ShotBackground
  backgroundClipId?: string | null
  appReferenceId?: string | null
  idea?: string | null
  pipEnabled?: boolean
}

export interface EditPlanAskModelContext {
  editPrompt: string | null
  backgrounds: readonly EditPlanBackgroundOption[]
  appScreens: readonly EditPlanAppScreenOption[]
  presenterSceneOrders: readonly number[]
  brollRatio: number
  shotChangeSec: number
  /** Текст нарушений предыдущего плана — второй запрос по §5.3. */
  previousErrors?: string
}

export interface EditPlanStepInput {
  videoId: number
  /** Измеренная длительность единого трека — верхняя граница таймлайна. */
  trackDurationSec: number
  fps: number
  alignedScenes: readonly AlignedScene[]
  /** Сцены, где ведущий говорит В КАДРЕ (не только закадровый нарратор). */
  presenterSceneOrders: readonly number[]
  profile: ResolvedEditProfile
  /** Потолок lip-sync модели — у kling-lip-sync 10с. */
  lipSyncMaxDurationSec: number
  /** Нижняя граница квантования генеративного видео: 5с. */
  minGenerativeVideoSec: number
  /** Верхняя граница квантования ОДНОГО клипа генеративного видео: 10с. */
  maxGenerativeVideoSec: number
  /** $/сек генеративного видео — из `replicateVideoBilling()`, не литерал. */
  generativeVideoUsdPerSec: number
  /** $/кадр картинки с движением (flux-dev). */
  imageUsd: number
  backgrounds: readonly EditPlanBackgroundOption[]
  appScreens: readonly EditPlanAppScreenOption[]
}

export interface EditPlanStepDeps {
  askModel: (
    grid: readonly EditPlanGridCellForModel[],
    context: EditPlanAskModelContext,
  ) => Promise<{ shots: EditPlanModelShot[] }>
  saveShots: (shots: readonly PlannedShotWithCost[]) => Promise<void>
  log: (message: string) => Promise<void>
}

export interface EditPlanStepResult {
  status: "completed" | "repaired"
  shots: PlannedShotWithCost[]
  costUsd: number
  warnings: string[]
}

/**
 * Сколько раз звать ремонт подряд, добиваясь неподвижной точки (требование 9
 * ревью задачи). Измерено (Task 3, репьюнутый property-тест на 20 000
 * сценариев): план становится неподвижным после ТРЕТЬЕГО прогона ремонта.
 * Четвёртый — запас, а не догадка.
 */
const MAX_REPAIR_PASSES = 4

/** Первый запрос + один повтор по §5.3 — не больше: второй платный запрос уже стоит денег. */
const MAX_MODEL_ATTEMPTS = 2

/**
 * `broll_ratio` — предупреждение, а не блокирующее нарушение (рулинг задачи):
 * раскладка ведущего и перебивок — смысл (работа модели, §5.1), а не
 * арифметика границ, и ремонт её не чинит и не может починить. Считать её
 * блокирующей значило бы гнать почти любой план на второй платный запрос и
 * затем честно валить его.
 */
function isBlocking(violation: ShotPlanViolation): boolean {
  return violation.code !== "broll_ratio"
}

/** Текст сцены в границах кадра — контекст смысла для модели, не арифметика. */
function cellText(
  sceneOrder: number | null,
  startSec: number,
  endSec: number,
  scenes: readonly AlignedScene[],
): string {
  if (sceneOrder === null) return ""
  const scene = scenes.find(candidate => candidate.order === sceneOrder)
  if (!scene) return ""
  return scene.words
    .filter(word => word.startSec >= startSec - 1e-6 && word.endSec <= endSec + 1e-6)
    .map(word => word.text)
    .join(" ")
}

interface GridCellGeometry {
  order: number
  startSec: number
  endSec: number
  sceneOrder: number | null
}

/**
 * Материализует ответ модели на сетку ПО `order` (требование 2 ревью задачи),
 * а НЕ по длине массива: мок Anthropic грузит статическую фикстуру, которая
 * физически не может совпасть по длине с динамической сеткой конкретного
 * ролика. Незаполненные ячейки получают детерминированный дефолт: `foreground`
 * = "presenter", если `sceneOrder` кадра входит в `presenterSceneOrders`,
 * иначе "none"; `background` = "none" для presenter-кадров, иначе "image".
 */
function materializeShots(
  grid: readonly GridCellGeometry[],
  modelShots: readonly EditPlanModelShot[],
  presenterSceneOrders: ReadonlySet<number>,
): { shots: PlannedShot[], unfilled: number } {
  const byOrder = new Map(modelShots.map(shot => [shot.order, shot]))
  let unfilled = 0

  const shots: PlannedShot[] = grid.map((cell) => {
    const raw = byOrder.get(cell.order)
    if (!raw) {
      unfilled += 1
      const isPresenter = cell.sceneOrder !== null && presenterSceneOrders.has(cell.sceneOrder)
      return {
        order: cell.order,
        startSec: cell.startSec,
        endSec: cell.endSec,
        sceneOrder: cell.sceneOrder,
        foreground: isPresenter ? "presenter" : "none",
        background: isPresenter ? "none" : "image",
        backgroundClipId: null,
        appReferenceId: null,
        idea: null,
        pipEnabled: false,
      }
    }
    return {
      order: cell.order,
      startSec: cell.startSec,
      endSec: cell.endSec,
      sceneOrder: cell.sceneOrder,
      foreground: raw.foreground,
      background: raw.background,
      backgroundClipId: raw.backgroundClipId ?? null,
      appReferenceId: raw.appReferenceId ?? null,
      idea: raw.idea ?? null,
      pipEnabled: raw.pipEnabled === true,
    }
  })

  return { shots, unfilled }
}

/**
 * Гоняет `repairShotPlan` до неподвижной точки, а не один раз (требование 9):
 * ограничено `MAX_REPAIR_PASSES` проходами, и если план всё ещё невалиден —
 * вызывающий код честно об этом узнаёт через `remaining`.
 */
function repairToFixedPoint(
  plan: ShotPlan,
  buildContext: (plan: ShotPlan) => ShotPlanContext,
): { plan: ShotPlan, remaining: ShotPlanViolation[], repaired: boolean } {
  let current = plan
  let remaining = validateShotPlan(buildContext(current))
  if (!remaining.some(isBlocking)) return { plan: current, remaining, repaired: false }

  let repaired = false
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass += 1) {
    const result = repairShotPlan(buildContext(current))
    repaired = true
    current = result.plan
    remaining = result.remaining
    if (!remaining.some(isBlocking)) break
  }
  return { plan: current, remaining, repaired }
}

export async function runEditPlanStep(
  input: EditPlanStepInput,
  deps: EditPlanStepDeps,
): Promise<EditPlanStepResult> {
  const presenterSet = new Set(input.presenterSceneOrders)
  const knownBackgroundIds = new Set(input.backgrounds.map(bg => bg.id))
  const warnings: string[] = []

  const grid = buildShotGrid({
    alignedScenes: input.alignedScenes,
    presenterSceneOrders: presenterSet,
    shotChangeSec: input.profile.shotChangeSec,
    lipSyncMaxDurationSec: input.lipSyncMaxDurationSec,
    fps: input.fps,
    brollAllowed: input.profile.brollRatio > 0,
  })
  warnings.push(...grid.warnings)

  if (grid.cells.length === 0) {
    throw new Error("План монтажа: сетка кадров пуста — резать таймлайн нечем")
  }

  const gridForModel: EditPlanGridCellForModel[] = grid.cells.map(cell => ({
    ...cell,
    text: cellText(cell.sceneOrder, cell.startSec, cell.endSec, input.alignedScenes),
  }))

  const buildContext = (plan: ShotPlan): ShotPlanContext => ({
    plan,
    trackDurationSec: input.trackDurationSec,
    fps: input.fps,
    alignedScenes: input.alignedScenes,
    profile: input.profile,
    lipSyncMaxDurationSec: input.lipSyncMaxDurationSec,
    minGenerativeVideoSec: input.minGenerativeVideoSec,
    maxGenerativeVideoSec: input.maxGenerativeVideoSec,
    knownBackgroundIds,
  })

  const baseModelContext: EditPlanAskModelContext = {
    editPrompt: input.profile.editPrompt,
    backgrounds: input.backgrounds,
    appScreens: input.appScreens,
    presenterSceneOrders: input.presenterSceneOrders,
    brollRatio: input.profile.brollRatio,
    shotChangeSec: input.profile.shotChangeSec,
  }

  let repairedAtLeastOnce = false
  let plan: ShotPlan | null = null
  let remaining: ShotPlanViolation[] = []

  for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
    const modelContext: EditPlanAskModelContext = attempt === 1
      ? baseModelContext
      : { ...baseModelContext, previousErrors: remaining.filter(isBlocking).map(v => v.message).join("; ") }

    const response = await deps.askModel(gridForModel, modelContext)
    const { shots, unfilled } = materializeShots(grid.cells, response.shots ?? [], presenterSet)
    if (unfilled > 0) {
      const attemptNote = attempt > 1 ? " (повторный запрос)" : ""
      warnings.push(`Модель не заполнила ${unfilled} из ${grid.cells.length} кадров${attemptNote} — применён детерминированный дефолт`)
    }

    const outcome = repairToFixedPoint({ shots }, buildContext)
    plan = outcome.plan
    remaining = outcome.remaining
    repairedAtLeastOnce = repairedAtLeastOnce || outcome.repaired

    const blocking = remaining.filter(isBlocking)
    if (blocking.length === 0) break

    if (attempt === MAX_MODEL_ATTEMPTS) {
      await deps.log(
        `План монтажа: ремонт не сошёлся за ${MAX_REPAIR_PASSES} проходов и после ${MAX_MODEL_ATTEMPTS} запросов к модели — `
        + `нарушения: ${blocking.map(v => v.message).join("; ")}`,
      )
      throw new Error(
        `План монтажа невалиден после ремонта и ${MAX_MODEL_ATTEMPTS} запросов к модели: ${blocking.map(v => v.message).join("; ")}`,
      )
    }
  }

  // Недостижимо при MAX_MODEL_ATTEMPTS >= 1 (цикл либо ставит `plan` и уходит
  // break'ом, либо бросает раньше) — проверка ради типа, а не логики.
  if (!plan) throw new Error("План монтажа: не удалось построить план")

  const brollWarning = remaining.find(v => v.code === "broll_ratio")
  if (brollWarning) warnings.push(brollWarning.message)

  // Требование 5: каждый кадр обязан пройти через pickBackgroundSource —
  // единственное место, где §7 исполняется ДО оплаты. Копим
  // pick.countsAgainstBudgetUsd, а НЕ pick.costUsd: второе включает стоимость
  // картинок и исчерпало бы потолок Kling втрое быстрее (background-source.ts).
  let spentUsd = 0
  let totalCostUsd = 0
  const finalShots: PlannedShotWithCost[] = []

  for (const shot of plan.shots) {
    const durationSec = shot.endSec - shot.startSec
    const pick = pickBackgroundSource({
      durationSec,
      profile: input.profile,
      requested: shot.background,
      spentUsd,
      // Пост-ремонт shot.background === "library"/"app_screen" гарантированно
      // ссылается на существующий источник: repair.ts уже сбросил мусорные
      // ссылки в "image"/"none" на предыдущем шаге. Здесь остаётся решить
      // денежный вопрос §7, а не повторно проверять существование ссылки.
      hasLibraryCandidate: shot.background === "library",
      hasAppScreen: shot.background === "app_screen",
      generativeVideoUsdPerSec: input.generativeVideoUsdPerSec,
      imageUsd: input.imageUsd,
      minGenerativeVideoSec: input.minGenerativeVideoSec,
      maxGenerativeVideoSec: input.maxGenerativeVideoSec,
      imageGenerationAllowed: true,
    })

    spentUsd += pick.countsAgainstBudgetUsd
    totalCostUsd += pick.costUsd
    if (pick.degradeReason) warnings.push(pick.degradeReason)

    finalShots.push({
      ...shot,
      background: pick.background,
      backgroundClipId: pick.background === "library" ? shot.backgroundClipId : null,
      appReferenceId: pick.background === "app_screen" ? shot.appReferenceId : null,
      costUsd: pick.costUsd,
      degradeReason: pick.degradeReason,
    })
  }

  await deps.saveShots(finalShots)

  return {
    status: repairedAtLeastOnce ? "repaired" : "completed",
    shots: finalShots,
    costUsd: totalCostUsd,
    warnings,
  }
}
