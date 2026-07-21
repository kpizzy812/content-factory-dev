/**
 * PUT /api/scenes/:id — обновление сцены: name/description/blocks/tags/status/archived.
 * При update blocks автоматически пересобирается promptCompiled/negativeCompiled.
 */
import type { SceneUpdatePayload, SceneStatus } from "~~/shared/types/scene"
import { normalizeBlocks, composeScene } from "~~/server/utils/scene-compose"
import type { Character, CharacterReferenceImage, AppReferenceImage } from "../../../app/generated/prisma/client"

const STATUSES: SceneStatus[] = ["draft", "ready", "generating", "done"]

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "id обязателен" })

  const existing = await prisma.scene.findUnique({ where: { id }, select: { appId: true, status: true } })
  if (!existing) throw createError({ statusCode: 404, message: "Сцена не найдена" })

  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "script-generator",
    appId: existing.appId,
  })

  const body = await readBody<SceneUpdatePayload>(event)
  const data: Record<string, unknown> = {}

  if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim()
  if (body?.description !== undefined) data.description = body.description?.trim() || null
  if (Array.isArray(body?.tags)) {
    data.tags = body.tags.filter((t: unknown) => typeof t === "string" && t.trim()).slice(0, 32)
  }
  if (typeof body?.status === "string" && STATUSES.includes(body.status as SceneStatus)) {
    data.status = body.status
  }
  if (typeof body?.archived === "boolean") data.archived = body.archived

  if (Array.isArray(body?.blocks)) {
    const blocks = normalizeBlocks(body.blocks)
    data.blocks = blocks as unknown as object

    const characterIds = blocks.filter(b => b.kind === "character").map(b => b.characterId)
    const appScreenIds = blocks.filter(b => b.kind === "app_screen").map(b => b.referenceImageId)

    const charactersList = characterIds.length
      ? await prisma.character.findMany({
          where: { id: { in: characterIds } },
          include: { referenceImages: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] } },
        })
      : []
    const appScreensList = appScreenIds.length
      ? await prisma.appReferenceImage.findMany({ where: { id: { in: appScreenIds } } })
      : []
    const sceneRefsList = await prisma.sceneReferenceImage.findMany({
      where: { sceneId: id },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    })

    const charactersMap = new Map<string, Character & { referenceImages: CharacterReferenceImage[] }>()
    for (const c of charactersList) charactersMap.set(c.id, c)
    const appScreensMap = new Map<string, AppReferenceImage>()
    for (const s of appScreensList) appScreensMap.set(s.id, s)

    const compiled = composeScene(blocks, {
      characters: charactersMap,
      appScreens: appScreensMap,
      sceneRefs: sceneRefsList.map(r => ({
        id: r.id,
        fileUrl: r.fileUrl,
        kind: r.kind,
        aiVisualDescription: r.aiVisualDescription,
        aiCaption: r.aiCaption,
      })),
    })
    data.promptCompiled = compiled.prompt
    data.negativeCompiled = compiled.negativePrompt
  }

  const scene = await prisma.scene.update({ where: { id }, data })
  return { data: scene }
})
