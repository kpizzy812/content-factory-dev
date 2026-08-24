/**
 * Промпт генерации фона по «идее» кадра (spec §7).
 *
 * Почему свой агент, а не переиспользование: `runVisualStyleAgent` требует
 * полный сценарий (`title/hook/body/cta`) и отдаёт стиль ролика целиком;
 * `generateSceneImagePrompts` требует целый `StoryPlan`. Пути «дай одну строку
 * идеи» нет ни у одного. Зато `validateScenePrompts`
 * (`./scene-prompt-validator.ts`) переиспользуется как есть — но он БРОСАЕТ
 * при `prompt.length < 50` и пустом `purpose`, поэтому и модель, и фолбэк
 * обязаны отдавать промпт заведомо длиннее порога.
 *
 * Склейка ответа с сеткой — ПО `order`, а не по позиции (тот же ruling B-4, что
 * у монтажного агента): статическая фикстура мока физически не совпадёт по
 * длине с динамическим числом кадров, поэтому `validate` проверяет ФОРМУ, а
 * незаполненные ячейки добиваются детерминированным фолбэком, и их число
 * уходит в предупреждения шага.
 */

import { callAnthropicAgent, type AnthropicCallUsage } from "./call-anthropic"

export interface ShotPromptRequest {
  order: number
  idea: string | null
  /** Текст реплики сцены кадра — контекст смысла. null у перебивки без сцены. */
  sceneText: string | null
  durationSec: number
}

export interface ShotPromptInput {
  shots: readonly ShotPromptRequest[]
  /** StoryPlan.globalVisualStyle — единый стиль ролика. */
  visualStyle: string | null
  appName: string | null
  format: "portrait" | "landscape"
  model?: string | null
  onUsage?: (usage: AnthropicCallUsage) => void
}

export interface ShotPrompt { order: number, prompt: string, purpose: string }
export interface ShotPromptResult { prompts: ShotPrompt[], usage: AnthropicCallUsage | null }

/** Порог `validateScenePrompts`: короче — он бросит, а не починит. */
export const MIN_PROMPT_LENGTH = 50

const SYSTEM_PROMPT = `Ты подбираешь визуальный образ для КАДРА короткого вертикального видео.
На вход — короткая идея кадра и, если есть, реплика, которая под ним звучит.
Верни JSON: {"prompts":[{"order":число,"prompt":"строка","purpose":"строка"}]}.
Правила:
- prompt на английском, не короче 60 символов, описывает КАДР: объект, окружение, свет, ракурс;
- людей с узнаваемыми лицами и текст на изображении не описывать — они читаются как брак;
- purpose по-русски, одной фразой: зачем этот кадр в ролике;
- по одному объекту на каждый order из запроса, порядок любой.`

function buildUserPrompt(input: ShotPromptInput): string {
  const style = input.visualStyle?.trim()
  const app = input.appName?.trim()
  const lines = [
    `Формат кадра: ${input.format === "portrait" ? "вертикальный 9:16" : "горизонтальный 16:9"}.`,
    style ? `Единый визуальный стиль ролика: ${style}` : null,
    app ? `Продукт: ${app}` : null,
    "",
    "Кадры:",
    ...input.shots.map((s) => {
      const idea = (s.idea ?? "").trim() || "нейтральная перебивка по смыслу реплики"
      const speech = (s.sceneText ?? "").trim()
      return `- order ${s.order}, ${s.durationSec.toFixed(1)} с, идея: ${idea}`
        + (speech ? `; под кадром звучит: «${speech}»` : "")
    }),
  ]
  return lines.filter(line => line !== null).join("\n")
}

interface RawResponse { prompts: unknown }

function validate(parsed: unknown): { prompts: ShotPrompt[] } {
  const raw = parsed as RawResponse | null
  if (!raw || !Array.isArray(raw.prompts)) {
    throw new Error("Агент промптов фона: ожидался объект с массивом prompts")
  }
  // Форма, а не длина (ruling B-4): длина сверяется склейкой по order.
  const prompts: ShotPrompt[] = []
  for (const item of raw.prompts) {
    if (!item || typeof item !== "object") continue
    const cell = item as Partial<ShotPrompt>
    if (typeof cell.order !== "number" || !Number.isFinite(cell.order)) continue
    if (typeof cell.prompt !== "string" || typeof cell.purpose !== "string") continue
    prompts.push({ order: cell.order, prompt: cell.prompt, purpose: cell.purpose })
  }
  return { prompts }
}

/**
 * Детерминированный запасной промпт. Детерминизм здесь не косметика: по промпту
 * считается ключ переиспользования картинки, и «случайный» фолбэк заставлял бы
 * пересборку ролика платить за те же кадры заново.
 */
export function fallbackShotPrompt(request: ShotPromptRequest, visualStyle: string | null): ShotPrompt {
  const idea = (request.idea ?? "").trim()
  const style = (visualStyle ?? "").trim()
  const base = idea.length > 0
    ? `Cinematic b-roll shot illustrating: ${idea}.`
    : "Cinematic abstract b-roll shot, soft depth of field, no readable text, no recognizable faces."
  const tail = " Shallow depth of field, soft natural lighting, high detail, no text overlays, no recognizable faces."
  const prompt = style.length > 0 ? `${base} Visual style: ${style}.${tail}` : `${base}${tail}`
  return {
    order: request.order,
    prompt,
    purpose: idea.length > 0 ? `Перебивка по идее кадра: ${idea}` : "Нейтральная перебивка без заданной идеи",
  }
}

function isUsablePrompt(cell: ShotPrompt): boolean {
  return cell.prompt.trim().length >= MIN_PROMPT_LENGTH && cell.purpose.trim().length > 0
}

export function mergeShotPrompts(
  requests: readonly ShotPromptRequest[],
  answered: readonly ShotPrompt[],
  visualStyle: string | null,
): { prompts: ShotPrompt[], filledByFallback: number } {
  const byOrder = new Map<number, ShotPrompt>()
  for (const cell of answered) {
    // Первый выигрывает: дубль order — это неоднозначность, и молча брать
    // последний значило бы решать её монеткой.
    if (!byOrder.has(cell.order) && isUsablePrompt(cell)) byOrder.set(cell.order, cell)
  }
  let filledByFallback = 0
  const prompts = requests.map((request) => {
    const answer = byOrder.get(request.order)
    if (answer) return answer
    filledByFallback += 1
    return fallbackShotPrompt(request, visualStyle)
  })
  return { prompts, filledByFallback }
}

function estimateMaxTokens(shotCount: number): number {
  // ~120 токенов на кадр плюс запас на обёртку JSON.
  return Math.min(8192, 512 + shotCount * 120)
}

export async function planShotBackgroundPrompts(input: ShotPromptInput): Promise<ShotPromptResult> {
  if (input.shots.length === 0) return { prompts: [], usage: null }

  // usage забирается синхронно из callback — до парсинга и до validate(), иначе
  // оплаченный вызов теряется на обрезанном ответе (та же причина, что у
  // `planEditShots`).
  let usage: AnthropicCallUsage | null = null
  const parsed = await callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(input),
    model: input.model ?? undefined,
    maxTokens: estimateMaxTokens(input.shots.length),
    agentName: "shot-background-prompt",
    validate,
    onUsage: (reported) => {
      usage = reported
      input.onUsage?.(reported)
    },
  })

  const { prompts } = mergeShotPrompts(input.shots, parsed.prompts, input.visualStyle)
  return { prompts, usage }
}
