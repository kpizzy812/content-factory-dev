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
 * Читает порядок клипов из завершённого шага prompt_generation.
 * Никогда не бросает: если снапшота нет или БД недоступна — null, и сопоставление
 * сцен с клипами останется на прежнем (позиционном) фолбэке.
 */
export async function loadClipSceneOrders(videoId: number): Promise<number[] | null> {
  try {
    const step = await prisma.videoGenerationStep.findFirst({
      where: { videoId, stepKey: "prompt_generation" as never },
      select: { outputSnapshot: true },
    })
    return extractClipSceneOrders(step?.outputSnapshot)
  } catch {
    return null
  }
}
