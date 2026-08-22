/**
 * edit-planner — монтажный агент: заполняет СМЫСЛ уже нарезанной сетки кадров.
 *
 * Разделение ответственности жёсткое (spec §5.1): код уже посчитал границы
 * каждого кадра (`edit-plan/grid.ts`) и передаёт их сюда готовыми — агента не
 * просят вернуть `startSec`/`endSec` вовсе. Автор разобранной системы того же
 * класса прямо описывает, как модели «серьёзно тупили при реализации плана
 * монтажа», когда им поручали арифметику таймлайна. Здесь агент решает только
 * то, что действительно требует смысла: кого показать (ведущего или нет), из
 * какого фона, с какой идеей для генерации картинки, и нужен ли PiP.
 *
 * `validate` проверяет ФОРМУ ответа (массив объектов, `foreground`/`background`
 * из допустимых union, `backgroundClipId`/`appReferenceId`/`idea` — строка или
 * null), а НЕ длину массива против сетки: раннер (`edit-plan/runner.ts`)
 * склеивает ответ с сеткой по полю `order`, а не по позиции в массиве. Причина
 * жёсткая: мок Anthropic (`server/utils/mock/anthropic-mock.ts`) грузит
 * статическую фикстуру `edit-planner-happy.json`, которая физически не может
 * совпасть по длине с динамической сеткой кадров конкретного ролика.
 */

import { callAnthropicAgent } from "./call-anthropic"
import type { ShotBackground, ShotForeground } from "../edit-plan/types"

export interface EditPlannerGridCell {
  order: number
  startSec: number
  endSec: number
  /** Смысловая сцена. null — перебивка между частями одной реплики ведущего. */
  sceneOrder: number | null
  /** Текст сцены в этом отрезке — контекст смысла, не арифметики. */
  text: string
}

export interface EditPlannerBackgroundOption {
  id: string
  kind: string
  name: string | null
  tags: string[]
}

export interface EditPlannerAppScreenOption {
  id: string
  tags: string[]
  caption: string | null
}

export interface EditPlannerInput {
  /** Правила словами из EditProfile.editPrompt — чередование ведущих, что под кого. */
  editPrompt: string | null
  grid: EditPlannerGridCell[]
  backgrounds: readonly EditPlannerBackgroundOption[]
  appScreens: readonly EditPlannerAppScreenOption[]
  /** Сцены, где ведущий говорит в кадре — подсказка, кого показывать по умолчанию. */
  presenterSceneOrders: readonly number[]
  brollRatio: number
  shotChangeSec: number
  /**
   * Разрешён ли PiP профилем (ре-ревью задачи, Important 4 / M-8): без этого
   * модель узнаёт про PiP только из общего описания способности в системном
   * промпте и тратит попытки на вариант, который раннер всё равно обнулит
   * клэмпом. Раннер обнуляет `pipEnabled` независимо от этого поля — оно
   * только про качество ответа, а не единственная защита.
   */
  pipAllowed: boolean
  /** Разрешено ли генеративное видео профилем (M-8): иначе модель тратит попытки на вариант, который repair всё равно заменит картинкой. */
  generativeVideoAllowed: boolean
  /** EditProfile.llmModelId — конкретная версия модели (spec §5.2). null — дефолт. */
  model: string | null
  /** Текст нарушений предыдущего плана — второй запрос по §5.3. */
  previousErrors?: string
}

export interface EditPlannerRawShot {
  order: number
  foreground: ShotForeground
  background: ShotBackground
  backgroundClipId: string | null
  appReferenceId: string | null
  idea: string | null
  pipEnabled: boolean
}

export interface EditPlannerResult {
  shots: EditPlannerRawShot[]
}

const SYSTEM_PROMPT = `You are an edit planner for short-form vertical video.

Hard division of labor:
- The TIMELINE ARITHMETIC is already done by code: every shot's start/end time is fixed and given to you. Do NOT propose different boundaries, do NOT merge or split cells, do NOT return startSec/endSec.
- You decide MEANING ONLY: who is on screen (the presenter or nobody), what is behind them, and — when the background is generated — what idea that background should depict.

For EVERY cell in the input grid, return exactly one shot object with:
- "order": copy the cell's order verbatim — this is how your answer is matched back to the grid.
- "foreground": "presenter" | "none" — "presenter" only makes sense for a cell whose sceneOrder is a scene where the presenter actually speaks on camera.
- "background": "library" | "image" | "video" | "app_screen" | "none".
  - "library" — pick a specific id from the provided background list and put it in "backgroundClipId".
  - "app_screen" — pick a specific id from the provided app screen list and put it in "appReferenceId".
  - "image" — a generated still with camera movement; describe it in "idea".
  - "video" — a generated video clip (expensive, only sensible for longer cutaway shots); describe it in "idea".
  - "none" — empty background, presenter (if any) fills the whole frame.
- "backgroundClipId": string id from the background list, or null.
- "appReferenceId": string id from the app screen list, or null.
- "idea": one short sentence describing the background's visual idea, or null when background is "library"/"app_screen"/"none".
- "pipEnabled": true only when the presenter should be shown as a small overlay on top of a non-presenter background.

Follow the brand's edit rules given as free text. Aim for the target cutaway ratio and shot-change cadence, but these are soft targets, not something to compute precisely — that is code's job, not yours.

Respond ONLY with JSON: { "shots": [{ "order": N, "foreground": "...", "background": "...", "backgroundClipId": "..."|null, "appReferenceId": "..."|null, "idea": "..."|null, "pipEnabled": true|false }, ...] }`

const FOREGROUNDS: ReadonlySet<string> = new Set(["presenter", "none"])
const BACKGROUNDS: ReadonlySet<string> = new Set(["library", "image", "video", "app_screen", "none"])

function optionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  throw new Error(`edit-planner: ${field} — ожидалась строка или null`)
}

function validate(data: unknown): EditPlannerResult {
  if (!data || typeof data !== "object") {
    throw new Error("edit-planner: ожидался object")
  }
  const obj = data as { shots?: unknown }
  if (!Array.isArray(obj.shots)) {
    throw new Error("edit-planner: shots — ожидался array")
  }

  const shots: EditPlannerRawShot[] = obj.shots.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`edit-planner: shots[${index}] — ожидался object`)
    }
    const raw = item as Record<string, unknown>

    const order = typeof raw.order === "number" ? raw.order : Number(raw.order)
    if (!Number.isFinite(order)) {
      throw new Error(`edit-planner: shots[${index}].order — не число`)
    }

    if (typeof raw.foreground !== "string" || !FOREGROUNDS.has(raw.foreground)) {
      throw new Error(`edit-planner: shots[${index}].foreground — недопустимое значение "${String(raw.foreground)}"`)
    }
    if (typeof raw.background !== "string" || !BACKGROUNDS.has(raw.background)) {
      throw new Error(`edit-planner: shots[${index}].background — недопустимое значение "${String(raw.background)}"`)
    }

    return {
      order,
      foreground: raw.foreground as ShotForeground,
      background: raw.background as ShotBackground,
      backgroundClipId: optionalString(raw.backgroundClipId, `shots[${index}].backgroundClipId`),
      appReferenceId: optionalString(raw.appReferenceId, `shots[${index}].appReferenceId`),
      idea: optionalString(raw.idea, `shots[${index}].idea`),
      pipEnabled: raw.pipEnabled === true,
    }
  })

  return { shots }
}

function buildUserPrompt(input: EditPlannerInput): string {
  const payload = {
    editPrompt: input.editPrompt,
    targetBrollRatio: input.brollRatio,
    targetShotChangeSec: input.shotChangeSec,
    presenterSceneOrders: input.presenterSceneOrders,
    // M-8 ре-ревью задачи: без этих двух полей модель не знает, что PiP или
    // генеративное видео запрещены профилем, и тратит попытки на вариант,
    // который код всё равно отклонит (repair заменит "video" картинкой,
    // раннер обнулит pipEnabled клэмпом) — впустую жжёт токены и качество
    // плана на заведомо отвергаемый вариант.
    pipAllowed: input.pipAllowed,
    generativeVideoAllowed: input.generativeVideoAllowed,
    grid: input.grid,
    backgrounds: input.backgrounds,
    appScreens: input.appScreens,
  }
  const base = `Plan the meaning of every shot in this grid:\n\n${JSON.stringify(payload, null, 2)}\n\n`
    + `${input.pipAllowed ? "" : "pipAllowed is false — never set \"pipEnabled\": true for any shot.\n"}`
    + `${input.generativeVideoAllowed ? "" : "generativeVideoAllowed is false — never use \"background\": \"video\" for any shot.\n"}`
    + `Return JSON.`
  if (!input.previousErrors) return base
  return `${base}\n\nYour previous answer produced an invalid plan. Fix these issues while keeping the same grid:\n${input.previousErrors}`
}

/**
 * Токены под ответ растут с числом кадров сетки (Minor М-3 ревью задачи):
 * фиксированные 8192 достаточны для короткого ролика (~30 кадров при
 * `shotChangeSec` 1.8с), но трек на 3+ минуты уже даёт 90+ кадров, ответ
 * обрезается, и `extractJsonFromText` падает 502 без единого retry на
 * парс-ошибку. Оценка — по ~120 токенов на объект кадра (поля + JSON-обвязка)
 * плюс запас на системную часть ответа; нижняя граница сохранена на прежних
 * 8192, чтобы не уменьшить бюджет для коротких роликов.
 */
const TOKENS_PER_SHOT_ESTIMATE = 120
const BASE_RESPONSE_TOKENS = 8192
/** `scenario-pipeline.ts` уже просит 20000 у той же модели в проде без спецзаголовков — тот же потолок здесь. */
const MAX_RESPONSE_TOKENS = 20000

function estimateMaxTokens(gridSize: number): number {
  return Math.min(MAX_RESPONSE_TOKENS, BASE_RESPONSE_TOKENS + Math.max(0, gridSize) * TOKENS_PER_SHOT_ESTIMATE)
}

export async function planEditShots(input: EditPlannerInput): Promise<EditPlannerResult> {
  return callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(input),
    model: input.model ?? undefined,
    maxTokens: estimateMaxTokens(input.grid.length),
    agentName: "edit-planner",
    validate,
  })
}
