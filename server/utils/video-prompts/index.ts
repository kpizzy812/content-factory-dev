/**
 * Public surface для video-prompts модуля.
 *
 * generateSceneImagePrompts — orchestrator: собирает 9 контекстных блоков
 * (3-4 загружаются параллельно из БД), строит prompt, гонит через Sonnet
 * с prompt caching, post-validate через Haiku, возвращает scenes + debug.
 */

import type { StoryPlan } from "~~/shared/types/story"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type {
  SceneImagePrompts,
  PromptGenerationDebug,
} from "./types"
import type { GenerateScenePromptsExtras } from "./extras"
import {
  buildEnrichedScenesDescription,
  buildBasicScenesDescription,
} from "./scene-description"
import {
  buildGlobalVisualBlock,
  buildProtagonistBlock,
  buildStoryArcBlock,
  buildEmotionalJourneyBlock,
  buildVisualCodeBlock,
  buildContinuityRulesBlock,
  buildPlatformContextBlock,
  buildReferencePromptsBlock,
  buildAppContextBlockStructured,
  buildAccountStyleBlockStructured,
  buildContinuityBibleBlock,
  buildAppScreenReferenceBlock,
  buildNegativeConstraintsBlock,
  buildAppIntegrationStrategyBlock,
  type AppRefImageInfo,
} from "./context-blocks"
import { buildKlingStaticSystemPrompt } from "./system-prompt"
import { fetchSceneImagePrompts } from "./anthropic-call"
import { validateScenePromptsCoherence } from "./post-validation"
import { getAppScenarioContext } from "../app-context"
import { getAccountStyleContext } from "../account-style-context"

export type { SceneImagePrompts, PromptGenerationDebug } from "./types"
export type { GenerateScenePromptsExtras } from "./extras"

/**
 * Главная функция: генерирует per-scene Kling-промпты с полным контекстом.
 *
 * Возвращает scenes (валидированные через Haiku) + debug snapshot (для inputSnapshot).
 */
export async function generateSceneImagePrompts(
  storyPlan: StoryPlan,
  videoPlan?: StoryDrivenVideoPlan | null,
  extras?: GenerateScenePromptsExtras,
): Promise<{ scenes: SceneImagePrompts; debug: PromptGenerationDebug }> {
  // ── 1. Параллельно подгружаем data из БД ──────────────────
  const sceneUnits = videoPlan?.scenes
  const useRuntimeUnits = sceneUnits && sceneUnits.length > 0

  const sceneOrders = useRuntimeUnits
    ? sceneUnits!.map((s) => s.order)
    : storyPlan.scenes.map((s) => s.order)

  // Сбор image-id для appScreenRef сцен — берём из storyPlan.scenes (там лежит ref).
  const refImageIds = storyPlan.scenes
    .map((s) => s.appScreenRef?.imageId)
    .filter((id): id is string => typeof id === "string" && id.length > 0)

  const [appCtxRaw, accountStyleRaw, refImageRows, appRecord] = await Promise.all([
    extras?.appId
      ? getAppScenarioContext(extras.appId).catch(() => null)
      : Promise.resolve(null),
    extras?.socialAccountId
      ? getAccountStyleContext(extras.socialAccountId).catch(() => null)
      : Promise.resolve(null),
    refImageIds.length > 0
      ? prisma.appReferenceImage.findMany({
          where: { id: { in: refImageIds } },
          select: {
            id: true,
            fileUrl: true,
            mimeType: true,
            aiCaption: true,
            aiTags: true,
            aiPrimaryAction: true,
          },
        }).catch(() => [])
      : Promise.resolve([] as Array<{
          id: string
          fileUrl: string
          mimeType: string | null
          aiCaption: string | null
          aiTags: string[]
          aiPrimaryAction: string | null
        }>),
    extras?.appId
      ? prisma.app.findUnique({ where: { id: extras.appId }, select: { name: true } }).catch(() => null)
      : Promise.resolve(null),
  ])

  const refImagesById = new Map<string, AppRefImageInfo>()
  for (const row of refImageRows) {
    refImagesById.set(row.id, {
      id: row.id,
      fileUrl: row.fileUrl,
      mimeType: row.mimeType,
      aiCaption: row.aiCaption,
      aiTags: row.aiTags,
      aiPrimaryAction: row.aiPrimaryAction,
    })
  }

  // ── 2. Собираем динамические блоки ────────────────────────
  const blocksUsed: string[] = []
  const dynamicParts: string[] = []

  const push = (key: string, content: string) => {
    if (content && content.trim().length > 0) {
      dynamicParts.push(content)
      blocksUsed.push(key)
    }
  }

  push("globalVisual", buildGlobalVisualBlock(storyPlan))
  push("protagonist", buildProtagonistBlock(storyPlan))
  push("storyArc", buildStoryArcBlock(storyPlan))
  push("emotionalJourney", buildEmotionalJourneyBlock(storyPlan, sceneOrders))
  push("visualCode", buildVisualCodeBlock(storyPlan))
  push("continuityRules", buildContinuityRulesBlock(storyPlan))
  push("continuityBible", buildContinuityBibleBlock(storyPlan))
  push("platformContext", buildPlatformContextBlock(extras))

  if (extras?.favoritePrompts && extras.favoritePrompts.length > 0) {
    push("referencePrompts", buildReferencePromptsBlock(extras.favoritePrompts))
  }

  if (appCtxRaw) {
    push("appContext", buildAppContextBlockStructured(appCtxRaw, appRecord?.name ?? undefined))
  } else if (videoPlan?.appContext) {
    // Fallback к плоскому контексту, если структурированный недоступен (нет appId).
    push("appContextFlat", videoPlan.appContext)
  }

  if (accountStyleRaw) {
    push("accountStyle", buildAccountStyleBlockStructured(accountStyleRaw))
  } else if (videoPlan?.accountStyleContext) {
    push("accountStyleFlat", videoPlan.accountStyleContext)
  }

  if (refImagesById.size > 0) {
    // Передаём storyPlan.scenes (SceneCard[]) — там лежит appScreenRef для связки order → imageId.
    // SceneRuntimeUnit поле appScreenRef не несёт.
    push("appScreenReferences", buildAppScreenReferenceBlock(storyPlan.scenes, refImagesById))
  }

  push("negativeConstraints", buildNegativeConstraintsBlock(videoPlan ?? null, storyPlan))
  push("appIntegrationStrategy", buildAppIntegrationStrategyBlock(videoPlan ?? null, storyPlan))

  // ── 3. Описания сцен (последний раздел user message) ──────
  const scenesDescription = useRuntimeUnits
    ? buildEnrichedScenesDescription(sceneUnits!)
    : buildBasicScenesDescription(storyPlan.scenes)

  const dynamicUser = `${dynamicParts.join("\n\n")}\n\n## Scenes\n${scenesDescription}\n\nReturn JSON only.`
  const staticSystem = buildKlingStaticSystemPrompt()

  // ── 4. Anthropic call (cached) ─────────────────────────────
  // Сцены прогона уходят вниз ради мок-режима: там промпты собираются из них
  // самих, чтобы список order'ов совпал с планом (см. mockSceneImagePrompts).
  const mockSeeds = useRuntimeUnits
    ? sceneUnits!.map(unit => ({
      order: unit.order,
      visualGuidance: unit.visualPrompt,
      purpose: unit.purpose,
    }))
    : storyPlan.scenes.map(scene => ({
      order: scene.order,
      visualGuidance: scene.visualPromptGuidance,
      purpose: scene.purpose,
    }))
  const { result, rawText, cacheHit } = await fetchSceneImagePrompts(staticSystem, dynamicUser, mockSeeds)

  // ── 5. Post-validation (Haiku coherence check) ────────────
  const fixedScenes = await validateScenePromptsCoherence(result.scenes)

  const debug: PromptGenerationDebug = {
    systemPromptStatic: staticSystem,
    contextBlocks: dynamicParts.join("\n\n"),
    userPrompt: dynamicUser,
    rawResponse: rawText,
    validatedScenes: fixedScenes,
    cacheHit,
    blocksUsed,
  }

  return {
    scenes: { scenes: fixedScenes },
    debug,
  }
}
