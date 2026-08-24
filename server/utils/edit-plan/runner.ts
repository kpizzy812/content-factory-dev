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
 *    — честное исключение (`EditPlanUnresolvedError`, несёт число реально
 *    оплаченных попыток), ролик не идёт дальше с планом, в котором дыра.
 * 6. Каждый кадр обязан пройти через `pickBackgroundSource` — единственное
 *    место, где потолок стоимости генеративного видео (§7) исполняется ДО
 *    оплаты. Копится `pick.countsAgainstBudgetUsd`, а не `pick.costUsd`.
 *
 * Ре-ревью задачи (фикс-раунд 1), Critical 1: этот модуль НЕ считает стоимость
 * вызова Anthropic вовсе — `plannedMediaCostUsd` в результате есть ПРОГНОЗНАЯ
 * смета будущих картинок/видео по плану (для оценки ролика, §14), а не цена
 * самого монтажного агента. Цену агента и то, сколько раз его реально спросили
 * (`modelCallCount`), считает `runVideoEditPlan` — только она знает, во что
 * реально обошёлся вызов LLM, и только там ledger должен получать деньги.
 */

import { buildShotGrid } from "./grid"
import { repairShotPlan } from "./repair"
import { halfFrameSec, validateShotPlan } from "./validate"
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
  /**
   * Разрешён ли PiP профилем вообще (требование 4 ревью задачи, вместе с
   * M-8): без этого модель узнаёт про PiP только из общего описания способности
   * в системном промпте и тратит попытки на вариант, который код всё равно
   * молча обнулит. Раннер клеймит `pipEnabled` по этому же полю НЕЗАВИСИМО от
   * промпта — оно здесь для качества ответа, а не как единственная защита.
   */
  pipAllowed: boolean
  /** Разрешено ли генеративное видео профилем (M-8: иначе модель тратит попытки на вариант, который repair всё равно отклонит). */
  generativeVideoAllowed: boolean
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
  /**
   * Доступна ли вообще генерация картинки (Important 3 ревью задачи): раньше
   * было захардкожено в `true`, из-за чего §10 «фонов нет, генерация запрещена
   * → кадр отдаётся ведущему на весь экран» была недостижимой веткой.
   * Вычисляется вызывающим по факту наличия модели в реестре — здесь только
   * потребляется.
   */
  imageGenerationAllowed: boolean
  backgrounds: readonly EditPlanBackgroundOption[]
  appScreens: readonly EditPlanAppScreenOption[]
}

/**
 * Token usage одного вызова модели (ре-ревью Critical 1, фикс-раунд 2).
 * Форма НАМЕРЕННО провайдер-агностична — раннер не обязан знать, что за
 * моделью стоит Anthropic — но совпадает по полям с `AnthropicCallUsage`
 * (`agents/call-anthropic.ts`), откуда её реально приносит
 * `video-pipeline-steps.ts`: структурная совместимость TypeScript снимает
 * нужду в явном мэппинге на границе.
 */
export interface EditPlanModelUsage {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreateTokens?: number
}

export interface EditPlanStepDeps {
  /**
   * `reportUsage` (3-й параметр) — ре-ревью 3, Critical 1, п.2: askModel
   * обязан вызвать его СРАЗУ, как только узнал usage, — ДО того, как парсинг
   * JSON/валидация ответа МОГУТ бросить исключение. Это единственный канал,
   * который переживает такое исключение: возврат из промиса — нет (промис
   * может так и не разрешиться), а любое поле в возвращаемом объекте видно
   * только ПОСЛЕ успешного `await`.
   */
  askModel: (
    grid: readonly EditPlanGridCellForModel[],
    context: EditPlanAskModelContext,
    reportUsage: (usage: EditPlanModelUsage | null) => void,
  ) => Promise<{ shots: EditPlanModelShot[] }>
  saveShots: (shots: readonly PlannedShotWithCost[]) => Promise<void>
  log: (message: string) => Promise<void>
  /**
   * Вызывается раннером РОВНО один раз на каждую РЕАЛЬНО завершённую попытку
   * askModel (успешную) — с usage этой попытки (или `null`, если askModel
   * не воспользовался `reportUsage`). `video-pipeline-steps.ts` подписывается
   * сюда, чтобы копить usage вне `runEditPlanStep`'а — так падение ПОСЛЕ
   * последнего успешного вызова (например, `saveShots`) не уносит с собой
   * учёт уже оплаченных попыток. Раннер сам ничего не решает про деньги —
   * это работа video-pipeline-steps.ts.
   */
  onModelUsage?: (usage: EditPlanModelUsage | null) => void
}

export interface EditPlanStepResult {
  status: "completed" | "repaired"
  shots: PlannedShotWithCost[]
  /**
   * Прогнозная смета будущих фонов по плану (Σ `PlannedShotWithCost.costUsd`)
   * — для оценки ролика (§14) и `outputSnapshot`, а НЕ цена этого шага.
   * Ре-ревью задачи, Critical 1: раньше это число уходило в ledger шага под
   * сервисом "anthropic" — план без единого платного фона давал 0 и терял
   * реально оплаченный вызов модели из учёта целиком; план с картинками
   * задваивал расход, когда шаг генерации фонов их и правда сгенерирует.
   */
  plannedMediaCostUsd: number
  /**
   * Сколько раз этот прогон реально спросил модель (1 — сошлось сразу, 2 —
   * потребовался повторный запрос по §5.3). DB-обвязка использует это число
   * только для лога — реальную ledger-цену считает по `modelUsages` ниже.
   */
  modelCallCount: number
  /**
   * Usage КАЖДОЙ реальной попытки, по порядку (длина === `modelCallCount`).
   * Ре-ревью Critical 1, фикс-раунд 2: раньше ledger-цена была плоской
   * константой × `modelCallCount`; теперь `video-pipeline-steps.ts` считает
   * реальную цену по токенам через `calculateAnthropicCost`, и ей нужен
   * usage КАЖДОЙ попытки, а не только последней — иначе несходящийся ремонт
   * (2 реально оплаченных вызова) учёл бы только один.
   */
  modelUsages: Array<EditPlanModelUsage | null>
  warnings: string[]
}

/**
 * Ремонт не сошёлся за отведённое число попыток модели — план невалиден,
 * ролик не идёт дальше. Несёт `modelCallCount` и `modelUsages`: обе (или
 * одна) попытки уже реально оплачены, и это не должно потеряться вместе с
 * исключением (Critical 1 ревью задачи, п.1 — «при несходимости ремонта два
 * оплаченных вызова исчезают»; фикс-раунд 2 — то же самое верно для usage,
 * не только для счётчика).
 */
export class EditPlanUnresolvedError extends Error {
  constructor(
    message: string,
    public readonly modelCallCount: number,
    public readonly modelUsages: Array<EditPlanModelUsage | null>,
  ) {
    super(message)
    this.name = "EditPlanUnresolvedError"
  }
}

/**
 * Сколько раз звать ремонт подряд, добиваясь неподвижной точки (требование 9
 * ревью задачи). Число унаследовано от Task 3 (репьюнутый property-тест на
 * 20 000 сценариев: план становится неподвижным после ТРЕТЬЕГО прогона
 * ремонта, четвёртый — запас).
 *
 * Важная оговорка (ре-ревью задачи, Important 5): та мера снята на СЫРЫХ
 * `PlannedShot[]` — произвольной, в том числе вырожденной геометрии (нулевая
 * длина, нахлёсты, дыры), потому что Task 3 готовилась к миру, где границы
 * мог прислать кто угодно. В этом раннере геометрия ВСЕГДА приходит из
 * `buildShotGrid` — код, не модель (§5.1) — и уже упорядочена, без нулевых
 * длин и нахлёстов. Перебор на 230 000+ сценариях через РЕАЛЬНЫЙ
 * `buildShotGrid` + `repairShotPlan` (не показал НИ ОДНОГО случая,
 * сходящегося на 2-м, 3-м или 4-м проходе: сходимость на этом входе строго
 * бимодальна — план либо чинится ЗА ОДИН внешний проход, либо не чинится
 * НИКОГДА (типично — presenter_too_long без non-presenter соседа в
 * досягаемости `relieveOversizedPresenters`, который умеет сдвигать границу
 * только между ФИЗИЧЕСКИ СОСЕДНИМИ сегментами — см. докстринг
 * `repair.property.spec.ts`, ре-ревью НН-16 Task 3). Многопроходный сценарий
 * Task 3 требовал вырожденного (нулевой длины) кадра, а `buildShotGrid`
 * структурно не может такой отдать.
 *
 * `MAX_REPAIR_PASSES` остаётся 4 не потому, что она чем-то помогает сегодня
 * (мутация на 1 не меняет НИ ОДНОГО измеренного исхода), а как дешёвый запас
 * прочности: если сетку когда-нибудь начнут строить иначе (или ремонт станет
 * ещё на шаг умнее и создаст промежуточное состояние), лишний проход обойдётся
 * бесплатно, а его отсутствие — нет.
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
 *
 * `pipAllowed` (требование 4 ревью задачи, Important): `profile.pipEnabled`
 * — операторский выключатель, а не пожелание. Модель, попросившая PiP при
 * выключенном профиле, не должна получить его в `VideoShot` — клэмп здесь, а
 * не только в промпте, потому что промпт модель может проигнорировать.
 */
function materializeShots(
  grid: readonly GridCellGeometry[],
  modelShots: readonly EditPlanModelShot[],
  presenterSceneOrders: ReadonlySet<number>,
  pipAllowed: boolean,
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
      pipEnabled: pipAllowed && raw.pipEnabled === true,
    }
  })

  return { shots, unfilled }
}

/**
 * Гоняет `repairShotPlan` до неподвижной точки, а не один раз (требование 9):
 * ограничено `MAX_REPAIR_PASSES` проходами, и если план всё ещё невалиден —
 * вызывающий код честно об этом узнаёт через `remaining`.
 *
 * `changed` (Minor М-1 ревью задачи): true, только если хотя бы один проход
 * реально что-то поправил (`result.changes.length > 0`), а не просто "цикл
 * хоть раз выполнился". Раньше `repaired` заводился безусловно при входе в
 * цикл — а туда попадал почти любой реальный план (межсценные паузы дают
 * `gap` практически всегда), и статус "completed" был недостижим на практике.
 */
function repairToFixedPoint(
  plan: ShotPlan,
  buildContext: (plan: ShotPlan) => ShotPlanContext,
): { plan: ShotPlan, remaining: ShotPlanViolation[], changed: boolean } {
  let current = plan
  let remaining = validateShotPlan(buildContext(current))
  if (!remaining.some(isBlocking)) return { plan: current, remaining, changed: false }

  let changed = false
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass += 1) {
    const result = repairShotPlan(buildContext(current))
    if (result.changes.length > 0) changed = true
    current = result.plan
    remaining = result.remaining
    if (!remaining.some(isBlocking)) break
  }
  return { plan: current, remaining, changed }
}

export async function runEditPlanStep(
  input: EditPlanStepInput,
  deps: EditPlanStepDeps,
): Promise<EditPlanStepResult> {
  const presenterSet = new Set(input.presenterSceneOrders)
  const knownBackgroundIds = new Set(input.backgrounds.map(bg => bg.id))
  // Critical 2 ревью задачи: симметрично `knownBackgroundIds` — раньше
  // `app_screen` не сверялся ни с чем, кроме "поле не пустое".
  const knownAppScreenIds = new Set(input.appScreens.map(s => s.id))

  const grid = buildShotGrid({
    alignedScenes: input.alignedScenes,
    presenterSceneOrders: presenterSet,
    shotChangeSec: input.profile.shotChangeSec,
    lipSyncMaxDurationSec: input.lipSyncMaxDurationSec,
    fps: input.fps,
    brollAllowed: input.profile.brollRatio > 0,
  })
  // Предупреждения сетки не зависят от попытки модели — в отличие от
  // предупреждений внутри цикла ниже, которые обязаны сбрасываться на каждой
  // новой попытке (Minor М-2 ревью задачи: раньше предупреждения ОТБРОШЕННОЙ
  // первой попытки переживали успешную вторую).
  const gridWarnings = [...grid.warnings]

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
    knownAppScreenIds,
  })

  const baseModelContext: EditPlanAskModelContext = {
    editPrompt: input.profile.editPrompt,
    backgrounds: input.backgrounds,
    appScreens: input.appScreens,
    presenterSceneOrders: input.presenterSceneOrders,
    brollRatio: input.profile.brollRatio,
    shotChangeSec: input.profile.shotChangeSec,
    pipAllowed: input.profile.pipEnabled,
    generativeVideoAllowed: input.profile.generativeVideoEnabled,
  }

  let changedByRepair = false
  let plan: ShotPlan | null = null
  let remaining: ShotPlanViolation[] = []
  let modelCallCount = 0
  const modelUsages: Array<EditPlanModelUsage | null> = []
  let attemptWarnings: string[] = []

  for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
    // Сбрасывается на каждой попытке: предупреждения плана, который вот-вот
    // заменит успешный (или следующий) прогон, не должны попасть в результат.
    attemptWarnings = []

    const modelContext: EditPlanAskModelContext = attempt === 1
      ? baseModelContext
      : { ...baseModelContext, previousErrors: remaining.filter(isBlocking).map(v => v.message).join("; ") }

    // Ре-ревью 3, Critical 1, п.2: usageThisAttempt копится ВНУТРИ callback'а,
    // который askModel обязан вызвать СИНХРОННО, как только узнал usage —
    // если askModel потом бросит исключение (непарсимый/обрезанный ответ),
    // usageThisAttempt уже установлен ДО этого момента.
    let usageThisAttempt: EditPlanModelUsage | null = null
    let usageReported = false
    const response = await deps.askModel(gridForModel, modelContext, (usage) => {
      usageThisAttempt = usage
      usageReported = true
      // Пробрасываем НЕМЕДЛЕННО — эта строка выполняется ДО потенциального
      // исключения внутри askModel, в отличие от всего, что ниже.
      deps.onModelUsage?.(usage)
    })
    modelCallCount += 1
    // Critical 1, фикс-раунд 2: usage ЭТОЙ попытки сохраняется независимо от
    // того, сойдётся ли план — несходящийся ремонт всё равно платит за обе
    // попытки, и `video-pipeline-steps.ts` обязано посчитать обе.
    modelUsages.push(usageThisAttempt)
    // askModel мог не воспользоваться `reportUsage` вовсе (простой мок,
    // которому нечего сообщать) — в этом случае считаем usage неизвестным
    // здесь же, а не оставляем `onModelUsage` неувиденным для этой попытки.
    if (!usageReported) deps.onModelUsage?.(null)
    const { shots, unfilled } = materializeShots(grid.cells, response.shots ?? [], presenterSet, input.profile.pipEnabled)
    if (unfilled > 0) {
      const attemptNote = attempt > 1 ? " (повторный запрос)" : ""
      attemptWarnings.push(`Модель не заполнила ${unfilled} из ${grid.cells.length} кадров${attemptNote} — применён детерминированный дефолт`)
    }

    const outcome = repairToFixedPoint({ shots }, buildContext)
    plan = outcome.plan
    remaining = outcome.remaining
    changedByRepair = changedByRepair || outcome.changed

    const blocking = remaining.filter(isBlocking)
    if (blocking.length === 0) break

    if (attempt === MAX_MODEL_ATTEMPTS) {
      await deps.log(
        `План монтажа: ремонт не сошёлся за ${MAX_REPAIR_PASSES} проходов и после ${MAX_MODEL_ATTEMPTS} запросов к модели — `
        + `нарушения: ${blocking.map(v => v.message).join("; ")}`,
      )
      throw new EditPlanUnresolvedError(
        `План монтажа невалиден после ремонта и ${MAX_MODEL_ATTEMPTS} запросов к модели: ${blocking.map(v => v.message).join("; ")}`,
        modelCallCount,
        modelUsages,
      )
    }
  }

  // Недостижимо при MAX_MODEL_ATTEMPTS >= 1 (цикл либо ставит `plan` и уходит
  // break'ом, либо бросает раньше) — проверка ради типа, а не логики.
  if (!plan) throw new Error("План монтажа: не удалось построить план")

  const warnings: string[] = [...gridWarnings, ...attemptWarnings]
  const brollWarning = remaining.find(v => v.code === "broll_ratio")
  if (brollWarning) warnings.push(brollWarning.message)

  // Требование 5: каждый кадр обязан пройти через pickBackgroundSource —
  // единственное место, где §7 исполняется ДО оплаты. Копим
  // pick.countsAgainstBudgetUsd, а НЕ pick.costUsd: второе включает стоимость
  // картинок и исчерпало бы потолок Kling втрое быстрее (background-source.ts).
  let spentUsd = 0
  let plannedMediaCostUsd = 0
  const finalShots: PlannedShotWithCost[] = []
  // Minor М-2 ревью задачи: одинаковые причины деградации (флаг профиля
  // выключен, нет кандидата в библиотеке и т.п.) на плане из 20-30 кадров
  // давали 20-30 идентичных строк в лог и в warnings. Группируем по тексту
  // причины — у не завязанных на конкретную сумму сообщений текст совпадает
  // дословно; у завязанных на текущий расход (потолок бюджета) он всё ещё
  // будет отличаться и не схлопнется, но каждая такая строка несёт РЕАЛЬНО
  // новую сумму, а не дубль.
  const degradeCounts = new Map<string, number>()

  for (const shot of plan.shots) {
    const durationSec = shot.endSec - shot.startSec
    const pick = pickBackgroundSource({
      durationSec,
      profile: input.profile,
      requested: shot.background,
      spentUsd,
      // Пост-ремонт shot.background === "library"/"app_screen" гарантированно
      // ссылается на существующий источник: validate.ts/repair.ts (выше)
      // сбрасывают мусорные ссылки в "image"/"none" ДО этого цикла — сверены
      // против knownBackgroundIds/knownAppScreenIds. Здесь остаётся решить
      // денежный вопрос §7, а не повторно проверять существование ссылки.
      hasLibraryCandidate: shot.background === "library",
      hasAppScreen: shot.background === "app_screen",
      generativeVideoUsdPerSec: input.generativeVideoUsdPerSec,
      imageUsd: input.imageUsd,
      minGenerativeVideoSec: input.minGenerativeVideoSec,
      maxGenerativeVideoSec: input.maxGenerativeVideoSec,
      imageGenerationAllowed: input.imageGenerationAllowed,
    })

    spentUsd += pick.countsAgainstBudgetUsd
    plannedMediaCostUsd += pick.costUsd

    // §10 (Important 3 ревью задачи): «фонов нет, генерация запрещена → кадр
    // отдаётся ведущему на весь экран». `pickBackgroundSource` меняет только
    // `background`; когда оно ВЫНУЖДЕННО схлопнулось в "none" (а не потому что
    // модель/дефолт САМИ попросили пустой фон), кадру нужен ведущий — иначе
    // это чёрный экран, а не заявленная §10 деградация.
    const forcedEmpty = pick.background === "none" && shot.background !== "none"

    // Important 1 финального ревью ветки: этот цикл идёт ПОСЛЕ
    // `repairToFixedPoint`, и его результат `validateShotPlan` больше не
    // видит. Значит подмена `foreground` обязана САМА держать инварианты,
    // которые валидация держит для presenter-кадров, — иначе в БД уезжает
    // план, который шаг сборки физически не соберёт:
    //  * потолок lip-sync (`presenter_too_long`, `validate.ts`): кадр длиннее
    //    потолка модели kling-lip-sync не синхронизировать. Ровно тот случай,
    //    ради недопущения которого написаны Task 3 и Task 4; допуск взят тот
    //    же (`halfFrameSec`), что и в самой валидации, — иначе кадр на границе
    //    считался бы то валидным, то нет;
    //  * наличие `sceneOrder`: кадр-перебивка между частями одной реплики
    //    (`splitLongPresenterLine`, `sceneOrder: null`) вообще не привязан ни
    //    к какой реплике — искать, ЧТО на нём говорит ведущий, не по чему.
    //    Кроме того, перебивка и существует затем, чтобы склейка двух ракурсов
    //    ведущего не встречалась в кадре (§5.3): вернуть на неё ведущего —
    //    отменить смысл собственного дробления.
    // Членство `sceneOrder` в `presenterSceneOrders` НЕ требуется намеренно:
    // §10 и §7 говорят «кадр отдаётся ведущему» без оговорки про закадрового
    // нарратора, а сузить условие до presenter-сцен значило бы отдавать
    // чёрный экран там, где сегодня спека требует ведущего.
    const holdsPresenterInvariants = shot.sceneOrder !== null
      && durationSec <= input.lipSyncMaxDurationSec + halfFrameSec(input.fps)
    const forcePresenter = forcedEmpty && holdsPresenterInvariants

    // Отказ обязан быть НАЗВАН, а не тихо оставить чёрный кадр: причина
    // уезжает в `degradeReason` кадра и в warnings шага рядом с причиной
    // самой деградации фона.
    const refusalReason = forcedEmpty && !holdsPresenterInvariants
      ? (shot.sceneOrder === null
          ? "ведущего на этот кадр поставить нельзя: кадр не привязан ни к какой реплике (перебивка между частями)"
          : `ведущего на этот кадр поставить нельзя: ${durationSec.toFixed(2)}с длиннее чем потолок lip-sync ${input.lipSyncMaxDurationSec}с`)
      : null
    const degradeReason = refusalReason
      ? `${pick.degradeReason ?? "Задний план кадра пуст"} — ${refusalReason}`
      : pick.degradeReason

    if (degradeReason) {
      degradeCounts.set(degradeReason, (degradeCounts.get(degradeReason) ?? 0) + 1)
    }

    finalShots.push({
      ...shot,
      foreground: forcePresenter ? "presenter" : shot.foreground,
      background: pick.background,
      backgroundClipId: pick.background === "library" ? shot.backgroundClipId : null,
      appReferenceId: pick.background === "app_screen" ? shot.appReferenceId : null,
      // Ре-ревью 3, Task 5, пункт 1 (связанная мелочь): при форсированном
      // "ведущий на весь экран" PiP обязан сброситься — иначе получается
      // ведущий во весь кадр И он же наложением поверх самого себя.
      // `pickBackgroundSource` меняет только `background`, про `pipEnabled`
      // не знает вовсе — клэмп только здесь.
      pipEnabled: forcedEmpty ? false : shot.pipEnabled,
      costUsd: pick.costUsd,
      degradeReason,
    })
  }

  for (const [reason, count] of degradeCounts) {
    warnings.push(count > 1 ? `${reason} (кадров: ${count})` : reason)
  }

  await deps.saveShots(finalShots)

  return {
    status: changedByRepair ? "repaired" : "completed",
    shots: finalShots,
    plannedMediaCostUsd,
    modelCallCount,
    modelUsages,
    warnings,
  }
}
