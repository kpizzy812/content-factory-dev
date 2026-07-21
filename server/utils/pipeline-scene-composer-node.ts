/**
 * Pipeline node: scene_composer.
 *
 * Source-нода (без upstream input). Резолвит Scene из библиотеки app'a по config'у,
 * пересобирает её prompt + референсы через composeScene и выпускает на output.
 *
 * Config:
 *   - appId: number
 *   - sceneId: string — обязательно (или mode для авто-выбора)
 *   - mode: 'fixed' | 'latest' | 'random' — стратегия если sceneId нет
 *
 * Output:
 *   {
 *     scene: { id, name, status, ... },
 *     sceneId: string,
 *     compiledPrompt: string,
 *     negativePrompt: string,
 *     referenceImageUrls: string[],
 *     referenceImages: Array<{ source, sourceId, url, kind? }>,
 *     characterIds: string[],
 *   }
 */
import { composeScene, normalizeBlocks } from "./scene-compose"

export async function executeSceneComposerNode(
  config: Record<string, unknown>,
  _input: Record<string, unknown>,
  _signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const appId = Number(config.appId)
  if (!appId || Number.isNaN(appId)) {
    return {
      scene: null,
      _noData: true,
      _noDataReason: "appId не задан в конфиге ноды",
      _domainStatus: "no_data",
    }
  }

  const sceneId = typeof config.sceneId === "string" && config.sceneId ? config.sceneId : null
  const mode = (typeof config.mode === "string" ? config.mode : "fixed") as "fixed" | "latest" | "random"

  let scene = null as Awaited<ReturnType<typeof prisma.scene.findUnique>> | null

  if (sceneId) {
    scene = await prisma.scene.findUnique({ where: { id: sceneId } })
    if (!scene || scene.archived || scene.appId !== appId) {
      return {
        scene: null,
        _noData: true,
        _noDataReason: !scene
          ? `Сцена ${sceneId} не найдена`
          : scene.archived
          ? `Сцена ${sceneId} в архиве`
          : `Сцена ${sceneId} принадлежит другому app (${scene.appId})`,
        _domainStatus: "no_data",
      }
    }
  } else {
    const pool = await prisma.scene.findMany({
      where: { appId, archived: false },
      orderBy: { updatedAt: "desc" },
      take: 50,
    })
    if (pool.length === 0) {
      return {
        scene: null,
        _noData: true,
        _noDataReason: `В app=${appId} нет сцен в библиотеке композитора`,
        _domainStatus: "no_data",
      }
    }
    scene = mode === "random" ? pool[Math.floor(Math.random() * pool.length)]! : pool[0]!
  }

  const blocks = normalizeBlocks(scene.blocks)
  if (blocks.length === 0) {
    return {
      scene: { id: scene.id, name: scene.name },
      sceneId: scene.id,
      compiledPrompt: "",
      _noData: true,
      _noDataReason: `Сцена "${scene.name}" пустая (нет блоков)`,
      _domainStatus: "no_data",
    }
  }

  const characterIds = blocks.filter((b) => b.kind === "character").map((b) => b.characterId)
  const appScreenIds = blocks.filter((b) => b.kind === "app_screen").map((b) => b.referenceImageId)

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
    where: { sceneId: scene.id },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  })

  const charactersMap = new Map<string, (typeof charactersList)[number]>()
  for (const c of charactersList) charactersMap.set(c.id, c)
  const appScreensMap = new Map<string, (typeof appScreensList)[number]>()
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
    scene: {
      id: scene.id,
      appId: scene.appId,
      name: scene.name,
      description: scene.description,
      status: scene.status,
      tags: scene.tags,
    },
    sceneId: scene.id,
    compiledPrompt: compiled.prompt,
    negativePrompt: compiled.negativePrompt,
    referenceImageUrls: compiled.referenceImageUrls,
    referenceImages: compiled.referenceImages,
    characterIds: compiled.characterIds,
    _domainStatus: "success",
  }
}
