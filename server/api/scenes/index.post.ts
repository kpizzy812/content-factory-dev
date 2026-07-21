/**
 * POST /api/scenes
 * Создаёт новую сцену. Можно передать blocks сразу — тогда сразу compile.
 */
import type { SceneCreatePayload } from "~~/shared/types/scene"
import { normalizeBlocks, composeScene } from "~~/server/utils/scene-compose"

export default defineEventHandler(async (event) => {
  const body = await readBody<SceneCreatePayload>(event)
  const appId = Number(body?.appId)
  if (!appId || Number.isNaN(appId)) {
    throw createError({ statusCode: 400, message: "appId обязателен" })
  }
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!name) throw createError({ statusCode: 400, message: "Имя сцены обязательно" })

  const user = await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "script-generator",
    appId,
  })

  const blocks = normalizeBlocks(body?.blocks)
  const compiled = composeScene(blocks)

  const scene = await prisma.scene.create({
    data: {
      appId,
      name,
      description: typeof body?.description === "string" ? body.description.trim() || null : null,
      blocks: blocks as unknown as object,
      promptCompiled: compiled.prompt,
      negativeCompiled: compiled.negativePrompt,
      tags: Array.isArray(body?.tags) ? body.tags.filter(t => typeof t === "string" && t.trim()).slice(0, 32) : [],
      status: "draft",
      createdById: user.id,
    },
  })

  return { data: scene }
})
