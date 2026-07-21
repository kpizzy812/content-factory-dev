/**
 * Scene-driven Rework module.
 *
 * Зеркалит scenario-pipeline.regenerateBlock + improveVisualStylePrompt, но для
 * shadow Scenario (trendId=null, sceneId=Scene.id). Вместо trend brief/insights
 * — контекст из scene.blocks (через composeScene) + App + Character.
 *
 * Используется в:
 *  - POST /api/scenarios/:id/rework-regenerate (полный перегон всех 5 блоков)
 *  - POST /api/scenarios/:id/regenerate-block (один блок: hook/body/cta/fullScript/visualStyle)
 *  - POST /api/scenarios/:id/improve-visual-style (улучшение visualStyleStructured)
 */
import { runSceneScripter } from './agents/scene-scripter'
import { improveVisualStylePrompt } from './agents/scenario-pipeline'
import { composeScene, normalizeBlocks } from './scene-compose'
import { buildSceneDrivenStoryPlan } from './scene-driven-scenario'
import type { VisualStyleStructured } from '~~/shared/types/scenario'
import type { Character, CharacterReferenceImage, AppReferenceImage, ScenarioVariant } from '../../app/generated/prisma/client'

type SceneSceriptBlock = 'hook' | 'body' | 'cta' | 'visualStyle' | 'fullScript'

/**
 * Загружает контекст для scripter из shadow scenario: App, Character (если есть),
 * Scene.blocks → compiledPrompt, реф-фото.
 */
async function loadSceneContext(scenarioId: number) {
  // Scenario не имеет relation `app` (только appId Int?), поэтому подгружаем App
  // отдельным запросом. Сценарии без appId — fatal, нечем питать scripter agent.
  const scenario = await prisma.scenario.findUnique({
    where: { id: scenarioId },
    include: {
      scene: { include: { referenceImages: true } },
    },
  })
  if (!scenario) throw new Error(`Сценарий #${scenarioId} не найден`)
  if (!scenario.appId) throw new Error(`Сценарий #${scenarioId} без appId`)
  const app = await prisma.app.findUnique({ where: { id: scenario.appId } })
  if (!app) throw new Error(`App #${scenario.appId} не найдено`)

  // Если scene существует — пересобираем compiledPrompt из её блоков для свежего контекста.
  // Иначе fallback на storyPlan.compiledPrompt (если есть в variant).
  let compiledPrompt = ''
  let negativePrompt: string | null = null
  let referenceImageUrls: string[] = []
  let referenceImages: Array<{ source: string; sourceId: string; url: string; kind?: string; aiVisualDescription?: string | null }> = []
  let firstCharacter: (Character & { referenceImages: CharacterReferenceImage[] }) | null = null
  let sceneName: string | null = null

  if (scenario.scene) {
    sceneName = scenario.scene.name
    const blocks = normalizeBlocks(scenario.scene.blocks)
    const characterIds = blocks.filter(b => b.kind === 'character').map(b => b.characterId)
    const appScreenIds = blocks.filter(b => b.kind === 'app_screen').map(b => b.referenceImageId)
    const charactersList = characterIds.length
      ? await prisma.character.findMany({
          where: { id: { in: characterIds } },
          include: { referenceImages: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
        })
      : []
    const appScreensList = appScreenIds.length
      ? await prisma.appReferenceImage.findMany({ where: { id: { in: appScreenIds } } })
      : []
    const charactersMap = new Map<string, Character & { referenceImages: CharacterReferenceImage[] }>()
    for (const c of charactersList) charactersMap.set(c.id, c)
    const appScreensMap = new Map<string, AppReferenceImage>()
    for (const s of appScreensList) appScreensMap.set(s.id, s)

    const compiled = composeScene(blocks, {
      characters: charactersMap,
      appScreens: appScreensMap,
      sceneRefs: scenario.scene.referenceImages.map(r => ({
        id: r.id,
        fileUrl: r.fileUrl,
        kind: r.kind,
        aiVisualDescription: r.aiVisualDescription,
        aiCaption: r.aiCaption,
      })),
    })
    compiledPrompt = compiled.prompt
    negativePrompt = compiled.negativePrompt
    referenceImageUrls = compiled.referenceImageUrls
    referenceImages = compiled.referenceImages
    firstCharacter = charactersList[0] ?? null
  } else {
    // Scene удалён — пытаемся достать compiledPrompt из storyPlan последнего variant.
    const variant = await prisma.scenarioVariant.findFirst({
      where: { scenarioId },
      orderBy: { createdAt: 'desc' },
    })
    const storyPlan = variant?.storyPlan as { compiledPrompt?: string; negativePrompt?: string | null; referenceImageUrls?: string[]; referenceImages?: typeof referenceImages } | null
    if (storyPlan?.compiledPrompt) {
      compiledPrompt = storyPlan.compiledPrompt
      negativePrompt = storyPlan.negativePrompt ?? null
      referenceImageUrls = storyPlan.referenceImageUrls ?? []
      referenceImages = storyPlan.referenceImages ?? []
    }
  }

  if (!compiledPrompt) {
    throw new Error(`Не удалось собрать compiledPrompt для сценария #${scenarioId} (сцена удалена и storyPlan пустой)`)
  }

  return {
    scenario,
    app,
    compiledPrompt,
    negativePrompt,
    referenceImageUrls,
    referenceImages,
    firstCharacter,
    sceneName,
  }
}

/**
 * Полная переработка scene-driven variant: один вызов scripter с reworkReason,
 * перезапись всех 5 блоков + создание ScenarioBlockRevision для каждого.
 */
export async function reworkSceneVariant(
  variantId: number,
  reason: string,
): Promise<{ variant: ScenarioVariant }> {
  const variant = await prisma.scenarioVariant.findUnique({ where: { id: variantId } })
  if (!variant) throw new Error(`Вариант #${variantId} не найден`)

  const ctx = await loadSceneContext(variant.scenarioId)

  const scripter = await runSceneScripter({
    compiledPrompt: ctx.compiledPrompt,
    negativePrompt: ctx.negativePrompt,
    app: {
      name: ctx.app.name,
      description: ctx.app.description,
      transformationPromise: (ctx.app as { transformationPromise?: string | null }).transformationPromise ?? null,
      corePain: (ctx.app as { corePain?: string | null }).corePain ?? null,
      coreOutcome: (ctx.app as { coreOutcome?: string | null }).coreOutcome ?? null,
      keywords: (ctx.app.keywords ?? []) as string[],
    },
    character: ctx.firstCharacter
      ? {
          name: ctx.firstCharacter.name,
          description: ctx.firstCharacter.description,
          visualPrompt: ctx.firstCharacter.visualPrompt,
          role: ctx.firstCharacter.role,
          aiVisualDescriptions: ctx.firstCharacter.referenceImages
            .map(r => r.aiVisualDescription)
            .filter((s): s is string => Boolean(s)),
        }
      : null,
    sceneName: ctx.sceneName,
    referenceImageDescriptions: ctx.referenceImages
      .map(r => r.aiVisualDescription)
      .filter((s): s is string => Boolean(s)),
    platform: 'tiktok',
    reworkReason: reason,
  })

  // Перестраиваем storyPlan со свежим scripter output.
  const newStoryPlan = buildSceneDrivenStoryPlan({
    sceneId: ctx.scenario.sceneId,
    compiledPrompt: ctx.compiledPrompt,
    negativePrompt: ctx.negativePrompt,
    referenceImageUrls: ctx.referenceImageUrls,
    referenceImages: ctx.referenceImages,
    scripter,
    primaryAppReference: null,
  })

  const oldValues: Record<SceneSceriptBlock, string> = {
    hook: variant.hook,
    body: variant.body,
    cta: variant.cta,
    fullScript: variant.fullScript,
    visualStyle: variant.visualStyleText,
  }
  const newValues: Record<SceneSceriptBlock, string> = {
    hook: scripter.hook,
    body: scripter.body,
    cta: scripter.cta,
    fullScript: scripter.fullScript,
    visualStyle: scripter.visualStyleText,
  }

  await prisma.$transaction(async (tx) => {
    for (const blockType of (['hook', 'body', 'cta', 'fullScript', 'visualStyle'] as SceneSceriptBlock[])) {
      await tx.scenarioBlockRevision.create({
        data: {
          variantId,
          blockType,
          oldValue: oldValues[blockType],
          newValue: newValues[blockType],
          reason: `Доработка (scene-driven): ${reason}`,
        },
      })
    }

    await tx.scenarioVariant.update({
      where: { id: variantId },
      data: {
        title: scripter.title,
        hook: scripter.hook,
        body: scripter.body,
        cta: scripter.cta,
        fullScript: scripter.fullScript,
        visualStyleText: scripter.visualStyleText,
        ...(scripter.visualStyleStructured
          ? { visualStyleStructured: scripter.visualStyleStructured as never }
          : {}),
        storyPlan: newStoryPlan as never,
        toneProfile: scripter.toneProfile,
        status: 'draft',
      },
    })

    await tx.scenario.update({
      where: { id: ctx.scenario.id },
      data: {
        status: 'generated',
        generationStatus: 'rework completed (scene-driven)',
        reworkRequest: null,
      },
    })

    await tx.scenarioReviewAction.create({
      data: {
        scenarioId: ctx.scenario.id,
        variantId,
        actionType: 'regenerate',
        reason: `Полная переработка (scene-driven): ${reason}`,
      },
    })
  })

  const updated = await prisma.scenarioVariant.findUnique({ where: { id: variantId } })
  return { variant: updated! }
}

/**
 * Перегенерация одного блока scene-driven variant. Один вызов scripter с reason,
 * берём только нужное поле + апдейт variant + ревизия + ScenarioReviewAction.
 *
 * Возвращает result + актуальный variant (для удобства endpoint).
 */
export async function regenerateSceneBlock(
  variantId: number,
  blockType: SceneSceriptBlock,
  reason?: string,
): Promise<{ value: string; structuredVisualStyle?: VisualStyleStructured; variant: ScenarioVariant }> {
  const variant = await prisma.scenarioVariant.findUnique({ where: { id: variantId } })
  if (!variant) throw new Error(`Вариант #${variantId} не найден`)

  const ctx = await loadSceneContext(variant.scenarioId)

  const scripter = await runSceneScripter({
    compiledPrompt: ctx.compiledPrompt,
    negativePrompt: ctx.negativePrompt,
    app: {
      name: ctx.app.name,
      description: ctx.app.description,
      transformationPromise: (ctx.app as { transformationPromise?: string | null }).transformationPromise ?? null,
      corePain: (ctx.app as { corePain?: string | null }).corePain ?? null,
      coreOutcome: (ctx.app as { coreOutcome?: string | null }).coreOutcome ?? null,
      keywords: (ctx.app.keywords ?? []) as string[],
    },
    character: ctx.firstCharacter
      ? {
          name: ctx.firstCharacter.name,
          description: ctx.firstCharacter.description,
          visualPrompt: ctx.firstCharacter.visualPrompt,
          role: ctx.firstCharacter.role,
          aiVisualDescriptions: ctx.firstCharacter.referenceImages
            .map(r => r.aiVisualDescription)
            .filter((s): s is string => Boolean(s)),
        }
      : null,
    sceneName: ctx.sceneName,
    referenceImageDescriptions: ctx.referenceImages
      .map(r => r.aiVisualDescription)
      .filter((s): s is string => Boolean(s)),
    platform: 'tiktok',
    reworkReason: reason ?? null,
  })

  const newValue = blockType === 'visualStyle'
    ? scripter.visualStyleText
    : scripter[blockType]
  const oldValue = blockType === 'visualStyle' ? variant.visualStyleText : variant[blockType]

  await prisma.$transaction(async (tx) => {
    await tx.scenarioBlockRevision.create({
      data: {
        variantId,
        blockType,
        oldValue,
        newValue,
        reason: reason ? `${reason} (scene-driven)` : 'Перегенерация блока (scene-driven)',
      },
    })

    const updateData: Record<string, unknown> = {}
    if (blockType === 'visualStyle') {
      updateData.visualStyleText = newValue
      if (scripter.visualStyleStructured) {
        updateData.visualStyleStructured = scripter.visualStyleStructured as never
      }
    } else {
      updateData[blockType] = newValue
    }

    await tx.scenarioVariant.update({
      where: { id: variantId },
      data: updateData,
    })

    await tx.scenarioReviewAction.create({
      data: {
        scenarioId: ctx.scenario.id,
        variantId,
        actionType: 'regenerate_block',
        reason: `${blockType} (scene-driven)${reason ? `: ${reason}` : ''}`,
      },
    })
  })

  const updated = await prisma.scenarioVariant.findUnique({ where: { id: variantId } })
  return {
    value: newValue,
    structuredVisualStyle: blockType === 'visualStyle' ? scripter.visualStyleStructured ?? undefined : undefined,
    variant: updated!,
  }
}

/**
 * Улучшение visual style для scene-driven variant. Переиспользует
 * improveVisualStylePrompt (он не требует trend.app — принимает только
 * structured style + контекст hook/body/platform/appName).
 */
export async function improveSceneVisualStyle(
  variantId: number,
): Promise<{ improvedPrompt: string; improvedStyle: VisualStyleStructured; variant: ScenarioVariant }> {
  const variant = await prisma.scenarioVariant.findUnique({
    where: { id: variantId },
    include: { scenario: true },
  })
  if (!variant) throw new Error(`Вариант #${variantId} не найден`)

  const currentStyle = variant.visualStyleStructured as VisualStyleStructured | null
  if (!currentStyle || !currentStyle.colors) {
    throw new Error('Visual style ещё не структурирован. Сначала перегенерируйте visual style.')
  }

  const app = variant.scenario.appId
    ? await prisma.app.findUnique({ where: { id: variant.scenario.appId } })
    : null
  const appName = app?.name ?? ''

  const result = await improveVisualStylePrompt(currentStyle, {
    hook: variant.hook,
    body: variant.body,
    platform: 'tiktok',
    appName,
  })

  await prisma.$transaction(async (tx) => {
    await tx.visualStyleRevision.create({
      data: {
        variantId,
        colors: result.improvedStyle.colors as never,
        atmosphere: result.improvedStyle.atmosphere,
        character: result.improvedStyle.character,
        stylePrompt: result.improvedStyle.stylePrompt,
        improvedPrompt: result.improvedPrompt,
        source: 'improve_agent_scene_driven',
      },
    })

    await tx.scenarioVariant.update({
      where: { id: variantId },
      data: {
        visualStyleStructured: result.improvedStyle as never,
        visualStyleText: `${result.improvedStyle.atmosphere}. ${result.improvedStyle.character}`,
      },
    })
  })

  const updated = await prisma.scenarioVariant.findUnique({ where: { id: variantId } })
  return { improvedPrompt: result.improvedPrompt, improvedStyle: result.improvedStyle, variant: updated! }
}
