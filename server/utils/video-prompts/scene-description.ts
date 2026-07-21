/**
 * Описание сцен для подачи в Kling-промпт-генератор.
 * Перенесено из video-helpers.ts без функциональных изменений.
 */

import type { SceneCard } from "~~/shared/types/story"
import type { SceneRuntimeUnit } from "~~/shared/types/video-runtime"
import { buildDeviceOrientationBlock } from "~~/shared/utils/video-prompt-helpers"

/**
 * Build enriched scene descriptions from SceneRuntimeUnits.
 * Includes all StoryPlan data that was previously lost.
 */
export function buildEnrichedScenesDescription(scenes: SceneRuntimeUnit[]): string {
  return scenes.map((s) => {
    const lines = [
      `Scene ${s.order}: ${s.purpose}`,
      `  Setting: ${s.setting}`,
      `  Action: ${s.action}`,
      `  Emotion: ${s.emotionalState}`,
      `  Visual guidance: ${s.visualPrompt}`,
      `  Camera: ${s.cameraAngle}`,
      `  Duration: ${s.durationSec}s`,
    ]
    if (s.props.length > 0) {
      lines.push(`  Props: ${s.props.join(", ")}`)
    }
    if (s.appIntegrationBeat) {
      lines.push(`  App integration: ${s.appIntegrationBeat}`)
    }
    if (s.continuityNotes) {
      lines.push(`  Continuity notes: ${s.continuityNotes}`)
    }
    if (s.voiceoverLine) {
      lines.push(`  Voiceover (context for visual sync): "${s.voiceoverLine}" [${s.voiceoverEmotion || "neutral"}]`)
    }
    if (s.spokenLine) {
      lines.push(`  SPOKEN LINE (character says on camera, for kling lip-sync): "${s.spokenLine}"`)
    }
    if (s.devicesInScene && s.devicesInScene.length > 0) {
      // Per-scene device-orientation block — Kling/FLUX любят рендерить экран на
      // back cover; этот блок MUST FOLLOW для генератора prompt'а.
      const block = buildDeviceOrientationBlock(s.devicesInScene).trim()
      lines.push(`  DEVICES IN SCENE: ${s.devicesInScene.join(", ")}`)
      lines.push(block.split("\n").map((l) => `  ${l}`).join("\n"))
    }
    return lines.join("\n")
  }).join("\n\n")
}

/**
 * Build basic scene descriptions from raw SceneCards (fallback).
 */
export function buildBasicScenesDescription(scenes: SceneCard[]): string {
  return scenes.map((s: SceneCard) =>
    `Scene ${s.order}: ${s.purpose}
  Setting: ${s.setting}
  Action: ${s.action}
  Emotion: ${s.emotionalState}
  Visual guidance: ${s.visualPromptGuidance}
  Camera: ${s.cameraAngle}
  Props: ${s.props.join(", ")}${s.appIntegrationBeat ? `\n  App integration: ${s.appIntegrationBeat}` : ""}${s.continuityNotes ? `\n  Continuity: ${s.continuityNotes}` : ""}`,
  ).join("\n\n")
}
