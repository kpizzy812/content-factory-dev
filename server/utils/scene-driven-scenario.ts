/**
 * Scene-driven Scenario module.
 *
 * Создаёт shadow Scenario + ScenarioVariant для scene-driven path (когда есть
 * композитор сцены, но нет тренда). storyPlan совместим с detectRuntimeMode →
 * story_driven (≥2 scenes с visualPromptGuidance + duration).
 *
 * Вызывается из:
 * - POST /api/scenes/:id/generate (ручная генерация из UI композитора)
 * - executeScenarioNode в pipeline-executors (когда upstream — character + scene_composer)
 */
import { createHash } from 'node:crypto'
import { runSceneScripter } from './agents/scene-scripter'
import type { SceneScripterInput } from './agents/scene-scripter'
import type { StoryPlan } from '~~/shared/types/story'
import type { AppReferenceImage } from '../../app/generated/prisma/client'

export interface SceneDrivenCharacterContext {
  id: string
  name: string
  description?: string | null
  visualPrompt?: string | null
  role?: string | null
  /** Реф-фото — для inject в storyPlan + AI vision-описания в scripter promp. */
  referenceImages?: Array<{
    fileUrl: string
    aiVisualDescription?: string | null
  }>
}

export interface SceneDrivenReferenceImage {
  source: string
  sourceId: string
  url: string
  kind?: string
  aiVisualDescription?: string | null
}

export interface SceneDrivenScenarioOpts {
  appId: number
  sceneId: string | null
  /** Опционально: имя исходной сцены — попадёт в operatorNotes/title. */
  sceneName?: string | null
  character?: SceneDrivenCharacterContext | null
  /** Скомпилированный prompt от scene-composer (визуальный, EN). */
  compiledPrompt: string
  negativePrompt?: string | null
  referenceImageUrls?: string[]
  referenceImages?: SceneDrivenReferenceImage[]
  /** Если есть AppReferenceImage записи для inject в storyPlan.scenes[0].appScreenRef. */
  primaryAppReferenceImageId?: string | null
  /** Pipeline tracking. */
  runId?: number | null
  pipelineId?: number | null
  /** Operator notes — например «Сгенерировано из сцены X» или маркер из pipeline. */
  operatorNotes?: string | null
  /** Reason для повторной генерации (rework path). */
  reworkReason?: string | null
  /** Platform для scripter (default tiktok). */
  platform?: string
}

export interface SceneDrivenScenarioResult {
  scenarioId: number
  variantId: number
  variantsCreated: number
}

/**
 * Резолвит первый AppReferenceImage для inject в storyPlan.scenes[0].appScreenRef.
 * Логика upsert переиспользуется между ручной генерацией (scenes/[id]/generate) и
 * pipeline-исполнителем executeScenarioNode (через character + scene_composer).
 *
 * @returns AppReferenceImage (created или existing) или null если refs пусты.
 */
export async function resolvePrimaryAppReference(opts: {
  appId: number
  initialAppScreen?: AppReferenceImage | null
  candidates: Array<{ fileUrl: string; storageKey?: string | null; mimeType?: string | null; source: string }>
  sceneName?: string | null
}): Promise<AppReferenceImage | null> {
  if (opts.initialAppScreen) return opts.initialAppScreen
  if (!opts.candidates.length) return null

  const r = opts.candidates[0]!
  const sha1 = createHash('sha1')
    .update(r.storageKey ?? r.fileUrl)
    .digest('hex')
    .slice(0, 16)
  const existing = await prisma.appReferenceImage.findUnique({
    where: { appId_sha1: { appId: opts.appId, sha1 } },
  })
  if (existing) return existing

  return prisma.appReferenceImage.create({
    data: {
      appId: opts.appId,
      fileUrl: r.fileUrl,
      sha1,
      mimeType: r.mimeType ?? null,
      storageKey: r.storageKey ?? null,
      storageProvider: 'gcs',
      aiCaption: opts.sceneName
        ? `Из composer-сцены "${opts.sceneName}" (${r.source})`
        : `Из composer-сцены (${r.source})`,
    },
  })
}

/**
 * Собирает storyPlan для shadow Scenario так, чтобы video-pipeline видел
 * story_driven runtime mode (detectRuntimeMode требует ≥2 scenes с
 * visualPromptGuidance + duration).
 */
export function buildSceneDrivenStoryPlan(opts: {
  sceneId: string | null
  compiledPrompt: string
  negativePrompt?: string | null
  referenceImageUrls: string[]
  referenceImages: SceneDrivenReferenceImage[]
  scripter: Awaited<ReturnType<typeof runSceneScripter>>
  primaryAppReference: AppReferenceImage | null
  appIntegrationStrategy?: string | null
}): StoryPlan & { sceneId: string | null; compiledPrompt: string; negativePrompt?: string | null; referenceImageUrls: string[]; referenceImages: SceneDrivenReferenceImage[] } {
  const scenes = opts.scripter.scenes.map((s, idx) => ({
    ...s,
    order: s.order || (idx + 1),
    appScreenRef: idx === 0 && opts.primaryAppReference
      ? {
          imageId: opts.primaryAppReference.id,
          fileUrl: opts.primaryAppReference.fileUrl,
          intent: 'reaction_to_interface' as const,
        }
      : null,
  }))

  return {
    version: 'scene-driven-1.0',
    storyArc: opts.scripter.storyArc,
    protagonist: opts.scripter.protagonist,
    scenes,
    continuityBible: opts.scripter.continuityBible,
    subtitleStyle: {
      typography: {
        fontIntent: 'bold sans-serif',
        casing: 'mixed',
        maxLineLength: 32,
        wordsPerLine: 4,
        maxLines: 2,
      },
      visual: {
        primaryColor: '#FFFFFF',
        outlineColor: '#000000',
        shadowEnabled: true,
        backgroundColor: null,
      },
      animation: {
        entrance: 'fade',
        exit: 'fade',
        emphasis: 'none',
      },
      consistency: {
        maintainStyleAcrossScenes: true,
        sceneOverrideAllowed: false,
      },
    },
    voiceoverPlan: (() => {
      // Маппим voiceoverLine из scenes в voiceoverPlan.lines. Если scripter
      // вернул хотя бы одну непустую voiceoverLine — включаем озвучку. Если
      // все null/пусто — fallback на subtitleCopy (subtitleCopy ≈ voiceoverLine
      // согласно scripter промпту), иначе fullScript равномерно распределяется
      // по сценам как последнее средство.
      const sceneLines = scenes
        .map((s, idx) => ({
          sceneOrder: typeof s.order === 'number' ? s.order : idx + 1,
          text: (typeof s.voiceoverLine === 'string' && s.voiceoverLine.trim())
            ? s.voiceoverLine.trim()
            : (typeof s.subtitleCopy === 'string' && s.subtitleCopy.trim() ? s.subtitleCopy.trim() : ''),
          emotion: typeof s.emotionalState === 'string' ? s.emotionalState : 'neutral',
          pauseAfter: 'short' as const,
        }))
        .filter(l => l.text.length > 0)
      // Если ничего не извлекли — разрезаем fullScript на куски по числу сцен.
      const fallbackLines = sceneLines.length === 0 && opts.scripter.fullScript
        ? (() => {
            const parts = opts.scripter.fullScript.split(/(?<=[.!?])\s+/).filter(p => p.trim())
            const perScene = Math.max(1, Math.ceil(parts.length / Math.max(scenes.length, 1)))
            return scenes.map((s, idx) => ({
              sceneOrder: typeof s.order === 'number' ? s.order : idx + 1,
              text: parts.slice(idx * perScene, (idx + 1) * perScene).join(' ').trim(),
              emotion: typeof s.emotionalState === 'string' ? s.emotionalState : 'neutral',
              pauseAfter: 'short' as const,
            })).filter(l => l.text.length > 0)
          })()
        : sceneLines
      const lines = fallbackLines.length > 0 ? fallbackLines : sceneLines
      return {
        enabled: lines.length > 0,
        narratorPersona: null,
        pacing: 'moderate' as const,
        emotionalContour: scenes.map(s => typeof s.emotionalState === 'string' ? s.emotionalState : 'neutral'),
        lines,
        syncGuidance: 'Синхронизация по scene.order. Пауза между сценами 0.3-0.5 сек.',
      }
    })(),
    globalVisualSystem: {
      stylePrompt: opts.scripter.visualStyleStructured?.stylePrompt ?? opts.compiledPrompt,
      colorPalette: opts.scripter.continuityBible.visualCode.colorPalette,
      mood: opts.scripter.continuityBible.visualCode.environmentStyle,
      lighting: opts.scripter.continuityBible.visualCode.lightingConsistency,
    },
    appIntegrationStrategy: opts.appIntegrationStrategy ?? opts.scripter.appIntegrationStrategy,
    negativeConstraints: opts.negativePrompt ? [opts.negativePrompt] : [],
    fullScript: opts.scripter.fullScript,
    // Scene-driven extension: эти поля не входят в StoryPlan, но video-pipeline
    // и regenerate-block могут их читать как опциональные.
    sceneId: opts.sceneId,
    compiledPrompt: opts.compiledPrompt,
    negativePrompt: opts.negativePrompt ?? null,
    referenceImageUrls: opts.referenceImageUrls,
    referenceImages: opts.referenceImages,
  }
}

/**
 * Основная точка входа: вызывает scene-scripter agent + сохраняет Scenario/Variant.
 */
export async function runScenarioGenerationForScene(
  opts: SceneDrivenScenarioOpts,
): Promise<SceneDrivenScenarioResult> {
  const app = await prisma.app.findUnique({ where: { id: opts.appId } })
  if (!app) {
    throw new Error(`Приложение #${opts.appId} не найдено`)
  }

  // Собираем AI-описания реф-изображений для scripter prompt.
  const refDescriptions: string[] = []
  for (const r of opts.referenceImages ?? []) {
    if (r.aiVisualDescription && r.aiVisualDescription.trim()) {
      refDescriptions.push(r.aiVisualDescription.trim())
    }
  }

  const characterAiVisuals: string[] = []
  for (const ref of opts.character?.referenceImages ?? []) {
    if (ref.aiVisualDescription && ref.aiVisualDescription.trim()) {
      characterAiVisuals.push(ref.aiVisualDescription.trim())
    }
  }

  const scripterInput: SceneScripterInput = {
    compiledPrompt: opts.compiledPrompt,
    negativePrompt: opts.negativePrompt,
    app: {
      name: app.name,
      description: app.description,
      transformationPromise: (app as { transformationPromise?: string | null }).transformationPromise ?? null,
      corePain: (app as { corePain?: string | null }).corePain ?? null,
      coreOutcome: (app as { coreOutcome?: string | null }).coreOutcome ?? null,
      keywords: (app.keywords ?? []) as string[],
    },
    character: opts.character
      ? {
          name: opts.character.name,
          description: opts.character.description,
          visualPrompt: opts.character.visualPrompt,
          role: opts.character.role,
          aiVisualDescriptions: characterAiVisuals,
        }
      : null,
    sceneName: opts.sceneName ?? null,
    referenceImageDescriptions: refDescriptions,
    platform: opts.platform ?? 'tiktok',
    reworkReason: opts.reworkReason ?? null,
  }

  const scripter = await runSceneScripter(scripterInput)

  // Resolve AppReferenceImage для appScreenRef (первая сцена в storyPlan).
  let primaryAppReference: AppReferenceImage | null = null
  if (opts.primaryAppReferenceImageId) {
    primaryAppReference = await prisma.appReferenceImage.findUnique({
      where: { id: opts.primaryAppReferenceImageId },
    })
  }

  const storyPlan = buildSceneDrivenStoryPlan({
    sceneId: opts.sceneId,
    compiledPrompt: opts.compiledPrompt,
    negativePrompt: opts.negativePrompt,
    referenceImageUrls: opts.referenceImageUrls ?? [],
    referenceImages: opts.referenceImages ?? [],
    scripter,
    primaryAppReference,
  })

  const result = await prisma.$transaction(async (tx) => {
    const scenario = await tx.scenario.create({
      data: {
        appId: opts.appId,
        sceneId: opts.sceneId,
        status: 'generated',
        generationStatus: 'completed',
        operatorNotes: opts.operatorNotes ?? (opts.sceneName ? `Сгенерировано из сцены "${opts.sceneName}"` : null),
        ...(opts.runId ? { runId: opts.runId } : {}),
        ...(opts.pipelineId ? { pipelineId: opts.pipelineId } : {}),
      },
    })

    const variant = await tx.scenarioVariant.create({
      data: {
        scenarioId: scenario.id,
        variantIndex: 0,
        status: 'accepted',
        title: scripter.title,
        hook: scripter.hook,
        body: scripter.body,
        cta: scripter.cta,
        fullScript: scripter.fullScript,
        visualStyleText: scripter.visualStyleText,
        visualStyleStructured: scripter.visualStyleStructured as never,
        storyPlan: storyPlan as never,
        toneProfile: scripter.toneProfile,
        promptVersion: 'scene-driven-1.0',
      },
    })

    await tx.scenario.update({
      where: { id: scenario.id },
      data: { selectedVariantId: variant.id },
    })

    if (opts.sceneId) {
      await tx.scene.update({
        where: { id: opts.sceneId },
        data: { status: 'ready', generatedScenarioId: scenario.id },
      })
    }

    return { scenarioId: scenario.id, variantId: variant.id }
  })

  return {
    scenarioId: result.scenarioId,
    variantId: result.variantId,
    variantsCreated: 1,
  }
}
