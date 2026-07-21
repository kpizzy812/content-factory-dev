/**
 * Build-функции для всех контекстных блоков Kling-промпт-генератора.
 *
 * Каждая функция принимает источник данных (storyPlan, videoPlan, extras)
 * и возвращает Markdown-блок (или пустую строку, если блок не применим).
 *
 * Пустые строки фильтруются на уровне orchestrator'а (index.ts).
 */

import type { StoryPlan, SceneCard } from "~~/shared/types/story"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type { AppScenarioContext } from "~~/shared/types/app"
import type { GenerateScenePromptsExtras } from "./extras"
import type { LoadedFavoritePrompt } from "../agents/favorite-prompts-loader"
import type { ResolvedAccountStyle } from "../account-style-context"
import { maybeExtractPromptPatternBackground } from "../agents/prompt-pattern-extractor"

// ── Block 1: Global Visual System ─────────────────────────────

export function buildGlobalVisualBlock(storyPlan: StoryPlan): string {
  return `## Global Visual System
- Master style: ${storyPlan.globalVisualSystem.stylePrompt}
- Color palette: ${storyPlan.globalVisualSystem.colorPalette.join(", ")}
- Mood: ${storyPlan.globalVisualSystem.mood}
- Lighting: ${storyPlan.globalVisualSystem.lighting}`
}

// ── Block 2: Protagonist ──────────────────────────────────────

export function buildProtagonistBlock(storyPlan: StoryPlan): string {
  return `## Protagonist (visual identifiers MUST repeat verbatim across scenes)
- Type: ${storyPlan.protagonist.type}
- Description: ${storyPlan.protagonist.description}
- Visual identifiers: ${storyPlan.protagonist.visualIdentifiers.join(", ")}
- Arc: ${storyPlan.protagonist.initialState} → ${storyPlan.protagonist.finalState}`
}

// ── Block 3: Story Arc ────────────────────────────────────────

export function buildStoryArcBlock(storyPlan: StoryPlan): string {
  if (!storyPlan.storyArc?.premise) return ""
  return `## Story Arc (narrative backbone — visuals must support each beat)
- Template: ${storyPlan.storyArc.template}
- Premise: ${storyPlan.storyArc.premise}
- Conflict: ${storyPlan.storyArc.conflict}
- Turning point: ${storyPlan.storyArc.turningPoint}
- Resolution: ${storyPlan.storyArc.resolution}`
}

// ── Block 4: Emotional Journey ────────────────────────────────

export function buildEmotionalJourneyBlock(storyPlan: StoryPlan, sceneOrders: number[]): string {
  const emotions = storyPlan.storyArc?.emotionalJourney ?? []
  if (emotions.length === 0 || sceneOrders.length === 0) return ""

  const lines = sceneOrders.map((order, i) => {
    const emotion = emotions[i] ?? emotions[emotions.length - 1]
    return `  Scene ${order}: ${emotion}`
  })
  return `## Emotional Journey (visual mood must shift accordingly)\n${lines.join("\n")}`
}

// ── Block 5: Visual Code ──────────────────────────────────────

export function buildVisualCodeBlock(storyPlan: StoryPlan): string {
  const vc = storyPlan.continuityBible?.visualCode
  if (!vc) return ""
  const lines = ["## Visual Code (cross-scene rules)"]
  if (vc.lightingConsistency) lines.push(`- Lighting consistency: ${vc.lightingConsistency}`)
  if (vc.environmentStyle) lines.push(`- Environment style: ${vc.environmentStyle}`)
  if (storyPlan.subtitleStyle?.visual?.primaryColor) {
    lines.push(`- Subtitle accent color (for visual harmony, NOT literal overlay): ${storyPlan.subtitleStyle.visual.primaryColor}`)
  }
  return lines.length > 1 ? lines.join("\n") : ""
}

// ── Block 6: Continuity Rules ─────────────────────────────────

export function buildContinuityRulesBlock(storyPlan: StoryPlan): string {
  const antiLoop = storyPlan.continuityBible?.antiLoopRules ?? []
  const forbidden = storyPlan.continuityBible?.forbiddenElements ?? []
  const transitions = storyPlan.continuityBible?.sceneTransitions ?? []
  if (antiLoop.length === 0 && forbidden.length === 0 && transitions.length === 0) return ""

  const lines = ["## Continuity Rules"]
  if (antiLoop.length > 0) lines.push(`Anti-loop: ${antiLoop.join("; ")}`)
  if (forbidden.length > 0) lines.push(`Forbidden: ${forbidden.join("; ")}`)
  if (transitions.length > 0) lines.push(`Allowed transitions: ${transitions.join("; ")}`)
  return lines.join("\n")
}

// ── Block 7: Platform Context ─────────────────────────────────

export function buildPlatformContextBlock(extras: GenerateScenePromptsExtras | undefined): string {
  if (!extras?.platform && !extras?.format && !extras?.voiceoverLanguage) return ""
  const lines = ["## Platform Context"]
  if (extras?.platform) lines.push(`- Target platform: ${extras.platform} (short-form vertical video conventions)`)
  if (extras?.format) lines.push(`- Aspect: ${extras.format === "portrait" ? "9:16 vertical" : "16:9 horizontal"} — compose accordingly`)
  if (extras?.voiceoverLanguage) lines.push(`- Spoken line language: ${extras.voiceoverLanguage} (lip-sync must match)`)
  return lines.length > 1 ? lines.join("\n") : ""
}

// ── Block 8: Reference Prompts (structured patterns) ──────────

/**
 * Reference Prompt Patterns block.
 *
 * Если у промпта есть aiPatternAnalysis — показывает structured Pattern A/B/C формат.
 * Иначе — fallback truncated text (max 200 символов promptText) + fire-and-forget
 * вызов maybeExtractPromptPatternBackground для будущих использований.
 */
export function buildReferencePromptsBlock(prompts: LoadedFavoritePrompt[]): string {
  if (!prompts || prompts.length === 0) return ""

  const sections: string[] = []

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i]
    if (!p) continue
    const label = String.fromCharCode(65 + i) // A, B, C, ...
    const heading = `### Pattern ${label} — ${p.appName ?? "general"}`

    if (p.aiPatternAnalysis) {
      const a = p.aiPatternAnalysis
      const lines = [heading]
      lines.push(`- Camera: ${a.camera}`)
      lines.push(`- Lighting: ${a.lighting}`)
      lines.push(`- Action structure: ${a.actionStructure}`)
      lines.push(`- Mood: ${a.mood}`)
      lines.push(`- Motion intensity: ${a.motionIntensity}`)
      if (p.tags.length > 0) lines.push(`- Tags (semantic context): ${p.tags.join(", ")}`)
      sections.push(lines.join("\n"))
    } else {
      // Fallback: truncated raw text + fire-and-forget extraction
      const truncated = p.promptText.length > 200
        ? p.promptText.slice(0, 200).trimEnd() + "…"
        : p.promptText
      const lines = [heading]
      if (p.tags.length > 0) lines.push(`- Tags: ${p.tags.join(", ")}`)
      if (p.notes) lines.push(`- Why it worked: ${p.notes}`)
      lines.push(`- Raw fragment (truncated): "${truncated}"`)
      sections.push(lines.join("\n"))

      // Fire-and-forget — не блокируем горячий путь.
      // maybeExtractPromptPatternBackground сам ловит все ошибки внутри (try/catch),
      // поэтому внешний .catch не нужен.
      void maybeExtractPromptPatternBackground(p.id, p.promptText, p.aiAnalysisAttempts)
    }
  }

  return `## Reference Prompt Patterns (STYLE COMPASSES — extract patterns, NEVER copy phrasing)
These patterns are extracted from high-performing prompts. Use them to calibrate camera vocabulary, action verb cadence, and lighting style. Generate ENTIRELY NEW prompts.

${sections.join("\n\n")}`
}

// ── Block 9: App Context (structured) ─────────────────────────

export function buildAppContextBlockStructured(appCtx: AppScenarioContext, appName?: string): string {
  if (!appCtx) return ""
  const lines = ["## App Context (the product the video sells)"]
  if (appName) lines.push(`- Name: ${appName}`)
  lines.push(`- What it is: ${appCtx.whatItIs}`)
  if (appCtx.brandTone) lines.push(`- Brand tone: ${appCtx.brandTone}`)
  if (appCtx.problemSolved) lines.push(`- Core pain solved: ${appCtx.problemSolved}`)
  if (appCtx.transformationImage) lines.push(`- Transformation promise: ${appCtx.transformationImage}`)
  if (appCtx.visualCues) lines.push(`- Visual cues: ${appCtx.visualCues}`)
  if (appCtx.featureBullets.length > 0) lines.push(`- Feature bullets: ${appCtx.featureBullets.join("; ")}`)
  if (appCtx.avoidClaims.length > 0) lines.push(`- Forbidden claims: ${appCtx.avoidClaims.join("; ")}`)
  if (appCtx.riskyClaims.length > 0) lines.push(`- Risky claims (use carefully): ${appCtx.riskyClaims.join("; ")}`)
  return lines.join("\n")
}

// ── Block 10: Account Style (structured) ──────────────────────

export function buildAccountStyleBlockStructured(resolved: ResolvedAccountStyle): string {
  if (!resolved || resolved.status === "not_set") return ""
  const { data } = resolved
  const lines = ["## Account Style Profile (channel-specific identity — must align)"]

  if (data.tone.voice) lines.push(`- Tone of voice: ${data.tone.voice}`)
  if (data.tone.narratorPersona) lines.push(`- Narrator persona: ${data.tone.narratorPersona}`)

  const visualParts: string[] = []
  if (data.visual.aesthetic) visualParts.push(`aesthetic: ${data.visual.aesthetic}`)
  if (data.visual.colorPalette.length > 0) visualParts.push(`palette: ${data.visual.colorPalette.join(", ")}`)
  if (data.visual.lighting) visualParts.push(`lighting: ${data.visual.lighting}`)
  if (data.visual.cameraStyle) visualParts.push(`camera style: ${data.visual.cameraStyle}`)
  if (visualParts.length > 0) lines.push(`- Visual identity: ${visualParts.join("; ")}`)

  if (data.subtitles.primaryColor) lines.push(`- Subtitle style accent color: ${data.subtitles.primaryColor}`)
  if (data.protagonist.recurringMarkers.length > 0) {
    lines.push(`- Recurring motifs / markers: ${data.protagonist.recurringMarkers.join(", ")}`)
  }
  if (data.visual.forbiddenVisuals.length > 0) {
    lines.push(`- Forbidden visuals: ${data.visual.forbiddenVisuals.join(", ")}`)
  }

  return lines.length > 1 ? lines.join("\n") : ""
}

// ── Block 11: Continuity Bible (protagonist appearance) ───────

const WARDROBE_KEYWORDS = ["blazer", "jacket", "coat", "shirt", "t-shirt", "tshirt", "dress", "skirt", "pants", "trousers", "jeans", "shorts", "sweater", "hoodie", "scarf", "tie", "hat", "cap"]
const HAIR_KEYWORDS = ["hair", "ponytail", "bun", "braid", "bangs", "fringe", "shaved", "bald", "beard", "moustache", "mustache"]
const FEATURE_KEYWORDS = ["glasses", "tattoo", "mole", "freckles", "scar", "piercing", "earring", "necklace", "watch", "ring"]

export function buildContinuityBibleBlock(storyPlan: StoryPlan): string {
  const identifiers = storyPlan.protagonist.visualIdentifiers ?? []
  if (identifiers.length === 0) return ""

  const wardrobe: string[] = []
  const hair: string[] = []
  const features: string[] = []
  const literal: string[] = []

  for (const raw of identifiers) {
    const lower = raw.toLowerCase()
    if (WARDROBE_KEYWORDS.some((k) => lower.includes(k))) wardrobe.push(raw)
    else if (HAIR_KEYWORDS.some((k) => lower.includes(k))) hair.push(raw)
    else if (FEATURE_KEYWORDS.some((k) => lower.includes(k))) features.push(raw)
    else literal.push(raw)
  }

  // Если эвристика не дала разбиения — возвращаем всё одной строкой.
  const allInOne = wardrobe.length === 0 && hair.length === 0 && features.length === 0
  if (allInOne) {
    return `## Protagonist Continuity Bible (MUST repeat verbatim — Kling drifts features otherwise)
- Visual identifiers (literal): ${literal.join(", ")}
- Default expression baseline: ${storyPlan.protagonist.initialState}`
  }

  const lines = ["## Protagonist Continuity Bible (MUST repeat verbatim — Kling drifts features otherwise)"]
  lines.push(`- Appearance: ${storyPlan.protagonist.description}`)
  if (wardrobe.length > 0) lines.push(`- Wardrobe: ${wardrobe.join(", ")}`)
  if (hair.length > 0) lines.push(`- Hairstyle: ${hair.join(", ")}`)
  if (features.length > 0) lines.push(`- Distinguishing features: ${features.join(", ")}`)
  if (literal.length > 0) lines.push(`- Other identifiers: ${literal.join(", ")}`)
  lines.push(`- Default expression baseline: ${storyPlan.protagonist.initialState}`)
  return lines.join("\n")
}

// ── Block 12: App Screen References (image-to-video) ──────────

export interface AppRefImageInfo {
  id: string
  fileUrl: string
  mimeType?: string | null
  aiCaption?: string | null
  aiTags: string[]
  aiPrimaryAction?: string | null
}

/**
 * Принимает SceneCard[] из storyPlan (НЕ SceneRuntimeUnit) — у SceneCard есть
 * appScreenRef.imageId, по которому делается lookup в refImagesById.
 *
 * Заголовки строятся по плану архитектора:
 *   ### Scene N — Reference: imageId
 * чтобы AI знал, какая сцена использует какой скриншот.
 */
export function buildAppScreenReferenceBlock(
  scenes: SceneCard[] | undefined,
  refImagesById: Map<string, AppRefImageInfo>,
): string {
  if (!scenes || scenes.length === 0) return ""
  if (refImagesById.size === 0) return ""

  const items: string[] = []
  for (const scene of scenes) {
    const ref = scene.appScreenRef
    if (!ref || !ref.imageId) continue
    const info = refImagesById.get(ref.imageId)
    if (!info) continue

    const lines = [`### Scene ${scene.order} — Reference: ${info.id}`]
    if (info.aiCaption) lines.push(`- AI caption: "${info.aiCaption}"`)
    if (info.aiTags.length > 0) lines.push(`- AI tags: ${info.aiTags.join(", ")}`)
    if (info.aiPrimaryAction) lines.push(`- Primary action visible: ${info.aiPrimaryAction}`)
    lines.push(`- Intent: ${ref.intent}`)
    lines.push(`- RULE: Do NOT describe UI elements in words — they are captured by the image input. Describe the protagonist's interaction with the device, their reaction, and ambient setting.`)
    items.push(lines.join("\n"))
  }

  if (items.length === 0) return ""

  return `## App Screen References (for image-to-video scenes)
For scenes with appScreenRef set, the screenshot is the reference image — describe MOTION around it, NOT the UI layout itself. Kling renders the UI from the image.

${items.join("\n\n")}`
}

// ── Block 13: Negative Constraints ────────────────────────────

export function buildNegativeConstraintsBlock(
  videoPlan: StoryDrivenVideoPlan | null | undefined,
  storyPlan: StoryPlan,
): string {
  const negatives = videoPlan?.negativeConstraints ?? storyPlan.negativeConstraints ?? []
  if (negatives.length === 0) return ""
  return `## Negative Constraints (AVOID these in ALL scenes)\n${negatives.join("\n")}`
}

// ── Block 14: App Integration Strategy ────────────────────────

export function buildAppIntegrationStrategyBlock(
  videoPlan: StoryDrivenVideoPlan | null | undefined,
  storyPlan: StoryPlan,
): string {
  const strategy = videoPlan?.appIntegrationStrategy ?? storyPlan.appIntegrationStrategy
  if (!strategy) return ""
  return `## App Integration Strategy\n${strategy}`
}
