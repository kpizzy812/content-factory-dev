/**
 * POST /api/scenes/:id/generate
 *
 * Запускает генерацию shadow Scenario из сцены композитора. Тело сценария
 * собирается через runSceneScripter (текстовый сценарий с ≥2 scene cards),
 * чтобы pipeline видео-генерации видел story_driven runtime, а кнопки rework
 * /regenerate-block работали по реальному тексту, а не по compiled prompt.
 *
 * Логика:
 *  1. Загружаем Scene + блоки + characters + appScreens + sceneRefs.
 *  2. Запускаем composeScene → compiledPrompt + referenceImages.
 *  3. Upsert первого подходящего AppReferenceImage для image-to-video (scene_ref/character).
 *  4. Вызываем runScenarioGenerationForScene → создаёт Scenario/Variant/storyPlan.
 *  5. Возвращаем { scenarioId, variantId, compiledPrompt, referenceImages }.
 */
import { composeScene, normalizeBlocks } from "~~/server/utils/scene-compose"
import { runScenarioGenerationForScene, resolvePrimaryAppReference } from "~~/server/utils/scene-driven-scenario"
import type { Character, CharacterReferenceImage, AppReferenceImage } from "../../../../app/generated/prisma/client"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "id обязателен" })

  const scene = await prisma.scene.findUnique({ where: { id } })
  if (!scene) throw createError({ statusCode: 404, message: "Сцена не найдена" })

  await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "script-generator",
    appId: scene.appId,
  })

  if (scene.archived) {
    throw createError({ statusCode: 400, message: "Сцена в архиве" })
  }

  const blocks = normalizeBlocks(scene.blocks)
  if (blocks.length === 0) {
    throw createError({ statusCode: 400, message: "Сцена пустая — добавьте блоки перед генерацией" })
  }

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

  // Эталонные кадры сцены добавляются в composeScene → их AI-описания инжектятся в prompt.
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

  // Сборка candidates для primaryAppReference: scene_ref/character refs upsert'ятся
  // в AppReferenceImage, чтобы runClipGeneration подхватил image_url для Kling i2v.
  const pipelineRefs: Array<{ fileUrl: string; storageKey: string | null; mimeType: string | null; source: string }> = []
  for (const r of sceneRefsList) {
    pipelineRefs.push({ fileUrl: r.fileUrl, storageKey: r.storageKey, mimeType: r.mimeType, source: 'scene_ref' })
  }
  for (const c of charactersList) {
    for (const ref of c.referenceImages) {
      pipelineRefs.push({
        fileUrl: ref.fileUrl,
        storageKey: ref.storageKey,
        mimeType: ref.mimeType,
        source: `character_${c.id}`,
      })
    }
  }

  const primaryAppReference = await resolvePrimaryAppReference({
    appId: scene.appId,
    initialAppScreen: appScreensList[0] ?? null,
    candidates: pipelineRefs,
    sceneName: scene.name,
  })

  // Главный персонаж — для inject в scripter (если есть character блок).
  const firstCharacter = charactersList[0] ?? null
  const characterContext = firstCharacter
    ? {
        id: firstCharacter.id,
        name: firstCharacter.name,
        description: firstCharacter.description,
        visualPrompt: firstCharacter.visualPrompt,
        role: firstCharacter.role,
        referenceImages: firstCharacter.referenceImages.map(r => ({
          fileUrl: r.fileUrl,
          aiVisualDescription: r.aiVisualDescription,
        })),
      }
    : null

  const result = await runScenarioGenerationForScene({
    appId: scene.appId,
    sceneId: scene.id,
    sceneName: scene.name,
    character: characterContext,
    compiledPrompt: compiled.prompt,
    negativePrompt: compiled.negativePrompt,
    referenceImageUrls: compiled.referenceImageUrls,
    referenceImages: compiled.referenceImages,
    primaryAppReferenceImageId: primaryAppReference?.id ?? null,
  })

  return {
    data: {
      scenarioId: result.scenarioId,
      variantId: result.variantId,
      compiledPrompt: compiled.prompt,
      referenceImages: compiled.referenceImages,
    },
  }
})
