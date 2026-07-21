/**
 * POST /api/videos/estimate-cost
 *
 * Динамический расчёт стоимости генерации видео.
 * Используется VideoConfig.vue для cost table.
 *
 * Принимает optional scenarioId+variantIdx: если передан - подгружается storyPlan
 * выбранного варианта и его реальные per-scene длительности подставляются вместо
 * UI slider values. Это делает estimate честным, когда блок видео работает
 * поверх scenario block (источник истины = storyPlan).
 */
import { estimateVideoCost, getCostOptimizationTips, COST_PRESETS } from "~~/server/utils/video-cost"
import type { VideoCostConfig } from "~~/server/utils/video-cost"

type RequestBody = VideoCostConfig & {
  /** Если задан - подгружается storyPlan выбранного варианта. */
  scenarioId?: number
  /** Индекс variant (0-based). По умолчанию берётся accepted, иначе первый. */
  variantIdx?: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RequestBody>(event)

  const enriched: VideoCostConfig & { _source?: 'scenario' | 'config' } = { ...body }

  // Подтягиваем storyPlan только если вручную не переданы perSceneDurations
  if (body.scenarioId && !body.perSceneDurations) {
    const scenario = await prisma.scenario.findUnique({
      where: { id: body.scenarioId },
      include: {
        variants: { orderBy: { variantIndex: 'asc' as const } },
      },
    })
    if (scenario) {
      const variant = typeof body.variantIdx === 'number'
        ? scenario.variants[body.variantIdx]
        : (scenario.variants.find(v => v.status === 'accepted') ?? scenario.variants[0])
      const storyPlan = variant?.storyPlan as { scenes?: Array<{ duration?: string }>; voiceoverPlan?: { lines?: Array<{ text?: string }> } } | null
      if (storyPlan?.scenes && storyPlan.scenes.length > 0) {
        enriched.perSceneDurations = storyPlan.scenes.map((s) => {
          const parsed = parseInt(String(s.duration ?? '5'), 10)
          return Number.isFinite(parsed) && parsed > 0 ? parsed : 5
        })
        enriched._source = 'scenario'
      }
      // Если включён voiceover и у нас есть voiceoverPlan.lines - передаём точное
      // количество символов на каждую строку для честного TTS-расчёта.
      if (body.voiceoverEnabled && storyPlan?.voiceoverPlan?.lines?.length) {
        enriched.voiceoverLines = storyPlan.voiceoverPlan.lines.map(l => (l.text ?? '').length)
      }
    }
  }

  const estimate = estimateVideoCost(enriched)
  const tips = getCostOptimizationTips(enriched)

  return {
    ...estimate,
    tips,
    presets: COST_PRESETS,
    /** Источник данных о сценах: 'scenario' если перекрыто storyPlan, иначе 'config' */
    source: enriched._source ?? 'config',
  }
})
