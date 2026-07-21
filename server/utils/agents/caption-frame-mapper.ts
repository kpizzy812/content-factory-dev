/**
 * Mapper: VideoAnalysisFramePass → legacy CaptionFrameAnalysis shape.
 *
 * Caption Generator agent ожидает frameAnalyses в historical shape
 * { frameIndex, description, mood, isUI } (storyboard-mode из MarketingCamp).
 * Marketing-grade анализ (`MarketingFrameDescription[]`) имеет другую структуру —
 * приводим её к legacy формату чтобы caption-generator-agent.ts schema не менялся.
 *
 * mood извлекается из tags (category=emotion); если нет — 'neutral'.
 * isUI — heuristic по наличию ключевых слов screen/ui/app/interface в description+keyElements.
 */
import type {
  MarketingFrameDescription,
  VideoAnalysisFramePass,
} from "~~/shared/types/video-analysis"

export interface CaptionFrameAnalysis {
  frameIndex: number
  description: string
  mood: string
  isUI: boolean
}

const UI_HEURISTIC_RE = /\b(screen|ui|app|interface|button|menu|tap|swipe)\b/i

function extractKeyElementsString(keyElements: MarketingFrameDescription["keyElements"]): string {
  if (Array.isArray(keyElements)) return keyElements.join(", ")
  if (keyElements && typeof keyElements === "object") {
    return Object.keys(keyElements).join(", ")
  }
  return ""
}

export function mapFramePassToCaptionFrameAnalyses(
  framePass: VideoAnalysisFramePass | null | undefined,
): CaptionFrameAnalysis[] | null {
  if (!framePass?.result?.frameDescriptions?.length) return null

  const moodTag = framePass.result.tags?.find((t) => t.category === "emotion")
  const fallbackMood = moodTag?.name ?? "neutral"

  return framePass.result.frameDescriptions.slice(0, 8).map((fd) => {
    const keyStr = extractKeyElementsString(fd.keyElements)
    const haystack = `${fd.description} ${keyStr}`
    const isUI = UI_HEURISTIC_RE.test(haystack)

    const description = fd.onScreenText
      ? `${fd.description} [text: ${fd.onScreenText}]`
      : fd.description

    return {
      frameIndex: fd.sequence,
      description,
      mood: fallbackMood,
      isUI,
    }
  })
}
