/**
 * Фактический порядок нарезки клипов — order'ы сцен в том порядке, в котором
 * runClipGeneration клал файлы в clipPaths.
 *
 * Зачем: клипы строятся из `prompts.scenePrompts.scenes.map((s, idx) => ...)`, то есть
 * clipPaths[idx] соответствует scenePrompts.scenes[idx].order. Этот массив приходит от
 * Claude и нигде не сортируется и не сверяется с videoPlan.scenes (см. validateScenes в
 * video-prompts/anthropic-call.ts) — buildImageScenePlan прямо предусматривает случай
 * «AI переставил сцены местами». Если Claude вернул порядок [1,2,4,3,5], то позиция
 * сцены в videoPlan.scenes перестаёт быть индексом её клипа, и реплика сцены 3 уезжает
 * на клип сцены 4 — ровно тот баг, который lip-sync и лечит.
 *
 * Разбор снапшота вынесен в чистую функцию, читалка из БД — тонкая обёртка над ней.
 */

import { prisma } from "../prisma"

/**
 * Вытаскивает order'ы сцен из outputSnapshot шага prompt_generation
 * (PromptGenerationResult.scenePrompts.scenes). Возвращает null, если снапшота нет
 * или он не story-driven — вызывающий тогда откатывается на позиции videoPlan.scenes.
 */
export function extractClipSceneOrders(snapshot: unknown): number[] | null {
  if (!snapshot || typeof snapshot !== "object") return null
  const scenePrompts = (snapshot as { scenePrompts?: unknown }).scenePrompts
  if (!scenePrompts || typeof scenePrompts !== "object") return null
  const scenes = (scenePrompts as { scenes?: unknown }).scenes
  if (!Array.isArray(scenes) || scenes.length === 0) return null

  const orders: number[] = []
  for (const raw of scenes) {
    if (!raw || typeof raw !== "object") return null
    const order = (raw as { order?: unknown }).order
    // Дырявый снапшот доверия не заслуживает: лучше честный фолбэк на позиции плана,
    // чем частичная карта, в которой половина сцен смотрит на чужие клипы.
    if (typeof order !== "number" || !Number.isFinite(order)) return null
    orders.push(order)
  }
  return orders
}

/**
 * Order'ы сцен, отданных ведущей: под них клип не генерировался.
 * Мусор в списке пропускается поштучно — из-за одного кривого элемента терять
 * карту целиком незачем, в отличие от дырявого снапшота промптов.
 */
function extractPresenterOrders(snapshot: unknown): Set<number> {
  const raw = snapshot && typeof snapshot === "object"
    ? (snapshot as { presenterSceneIndexes?: unknown }).presenterSceneIndexes
    : null
  if (!Array.isArray(raw)) return new Set()
  const orders = new Set<number>()
  for (const value of raw) {
    if (typeof value === "number" && Number.isFinite(value)) orders.add(value)
  }
  return orders
}

/**
 * Фактический порядок клипов: сцены из промптов МИНУС отданные ведущей.
 *
 * Раньше брался только снапшот промптов, где перечислены все сцены. Но
 * `clip_generation` сцены ведущей пропускает, и карта «сцена → индекс клипа»
 * указывала за пределы массива: «индекс клипа 6 вне списка из 5 путей». Сцена
 * при этом молча выпадала из сборки — на ролике 21 так потерялись четыре из
 * девяти.
 */
export function clipSceneOrdersFrom(
  promptSnapshot: unknown,
  clipSnapshot: unknown,
): number[] | null {
  const promptOrders = extractClipSceneOrders(promptSnapshot)
  if (!promptOrders) return null
  const presenter = extractPresenterOrders(clipSnapshot)
  if (presenter.size === 0) return promptOrders
  return promptOrders.filter(order => !presenter.has(order))
}

/**
 * Читает порядок клипов из завершённого шага prompt_generation.
 * Никогда не бросает: если снапшота нет или БД недоступна — null, и сопоставление
 * сцен с клипами останется на прежнем (позиционном) фолбэке.
 */
export async function loadClipSceneOrders(videoId: number): Promise<number[] | null> {
  try {
    const [promptStep, clipStep] = await Promise.all([
      prisma.videoGenerationStep.findFirst({
        where: { videoId, stepKey: "prompt_generation" as never },
        select: { outputSnapshot: true },
      }),
      prisma.videoGenerationStep.findFirst({
        where: { videoId, stepKey: "clip_generation" as never },
        select: { outputSnapshot: true },
      }),
    ])
    return clipSceneOrdersFrom(promptStep?.outputSnapshot, clipStep?.outputSnapshot)
  } catch {
    return null
  }
}
