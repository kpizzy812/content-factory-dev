/**
 * GET /api/scenes/:id
 * Детали сцены + резолвинг character'ов и app-screen'ов в блоках (для UI композитора).
 */
import { composeScene, normalizeBlocks } from "~~/server/utils/scene-compose"
import type { Character, CharacterReferenceImage, AppReferenceImage } from "../../../../app/generated/prisma/client"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "id обязателен" })

  const scene = await prisma.scene.findUnique({ where: { id } })
  if (!scene) throw createError({ statusCode: 404, message: "Сцена не найдена" })

  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "script-generator",
    appId: scene.appId,
  })

  const blocks = normalizeBlocks(scene.blocks)

  const characterIds = blocks.filter(b => b.kind === "character").map(b => b.characterId)
  const appScreenIds = blocks.filter(b => b.kind === "app_screen").map(b => b.referenceImageId)

  const charactersList = characterIds.length
    ? await prisma.character.findMany({
        where: { id: { in: characterIds } },
        include: {
          referenceImages: {
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          },
        },
      })
    : []

  const appScreensList = appScreenIds.length
    ? await prisma.appReferenceImage.findMany({ where: { id: { in: appScreenIds } } })
    : []

  const sceneRefsList = await prisma.sceneReferenceImage.findMany({
    where: { sceneId: scene.id },
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

  return {
    data: {
      scene,
      blocks,
      characters: charactersList,
      appScreens: appScreensList,
      sceneRefs: sceneRefsList,
      compiled,
    },
  }
})
