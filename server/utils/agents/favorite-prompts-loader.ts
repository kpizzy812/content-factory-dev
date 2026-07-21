/**
 * Loader избранных промтов для сценарного пайплайна.
 *
 * Два режима:
 *  - manualIds: взять конкретные записи по ID (ограничено hard limit).
 *  - autoSelect: выбрать топ-N по релевантности тегов и usageCount
 *    среди записей {appId = params.appId OR appId IS NULL, isPublic: true}.
 *
 * Hard limit = 5 — предохранитель от раздувания контекста Sonnet.
 */

import type { KlingPromptPattern } from "../video-prompts/types"

export interface LoadedFavoritePrompt {
  id: number
  promptText: string
  tags: string[]
  notes: string | null
  appName: string | null
  /** Кешированный AI-анализ структурного паттерна (камера/свет/мотив). null если ещё не анализировался. */
  aiPatternAnalysis: KlingPromptPattern | null
  /** Сколько раз агент пытался проанализировать промпт. >=3 = больше не пытаемся. */
  aiAnalysisAttempts: number
}

export interface LoadFavoritePromptsParams {
  appId?: number | null
  manualIds?: number[]
  autoSelect?: boolean
  /** Теги тренда/стратегии для авто-ранжирования по пересечению. */
  trendTags?: string[]
  /** Максимум промтов. Default 5. Hard cap 5. */
  limit?: number
}

const HARD_LIMIT = 5

export async function loadFavoritePromptsForScenario(
  params: LoadFavoritePromptsParams,
): Promise<LoadedFavoritePrompt[]> {
  const limit = Math.min(HARD_LIMIT, Math.max(1, params.limit ?? HARD_LIMIT))

  // Режим 1: manualIds
  if (Array.isArray(params.manualIds) && params.manualIds.length > 0) {
    const ids = params.manualIds
      .map(v => Number(v))
      .filter(v => Number.isFinite(v) && v > 0)
      .slice(0, HARD_LIMIT)

    if (ids.length === 0) return []

    const rows = await prisma.favoritePrompt.findMany({
      where: { id: { in: ids } },
      take: limit,
      include: { app: { select: { name: true } } },
    })

    return rows.map(r => ({
      id: r.id,
      promptText: r.promptText,
      tags: r.tags,
      notes: r.notes,
      appName: r.app?.name ?? null,
      aiPatternAnalysis: (r.aiPatternAnalysis as KlingPromptPattern | null) ?? null,
      aiAnalysisAttempts: r.aiAnalysisAttempts,
    }))
  }

  // Режим 2: autoSelect
  if (params.autoSelect) {
    const appId = params.appId ?? null
    const rows = await prisma.favoritePrompt.findMany({
      where: {
        isPublic: true,
        OR: [
          { appId: appId },
          { appId: null },
        ],
      },
      // Берём увеличенную выборку и дальше ранжируем в памяти по пересечению
      // тегов (у БД нет дешёвого способа сортировать по tag-overlap).
      take: HARD_LIMIT * 5,
      orderBy: [
        { usageCount: 'desc' },
        { createdAt: 'desc' },
      ],
      include: { app: { select: { name: true } } },
    })

    const trendTagSet = new Set((params.trendTags ?? []).map(t => t.toLowerCase()))

    const ranked = rows
      .map((r) => {
        let overlap = 0
        for (const t of r.tags) {
          if (trendTagSet.has(t.toLowerCase())) overlap++
        }
        return { row: r, overlap, usageCount: r.usageCount }
      })
      .sort((a, b) => {
        if (b.overlap !== a.overlap) return b.overlap - a.overlap
        return b.usageCount - a.usageCount
      })
      .slice(0, limit)

    return ranked.map(({ row }) => ({
      id: row.id,
      promptText: row.promptText,
      tags: row.tags,
      notes: row.notes,
      appName: row.app?.name ?? null,
      aiPatternAnalysis: (row.aiPatternAnalysis as KlingPromptPattern | null) ?? null,
      aiAnalysisAttempts: row.aiAnalysisAttempts,
    }))
  }

  // Режим 3: ни manual, ни auto — пусто.
  return []
}

/**
 * Fire-and-forget: атомарный инкремент usageCount + lastUsedAt для набора ID.
 * Используется в scenario-pipeline после успешной генерации.
 */
export async function bumpFavoritePromptsUsage(ids: number[]): Promise<void> {
  if (!Array.isArray(ids) || ids.length === 0) return
  const now = new Date()
  await Promise.allSettled(
    ids.map(id =>
      prisma.favoritePrompt.update({
        where: { id },
        data: {
          usageCount: { increment: 1 },
          lastUsedAt: now,
        },
      }),
    ),
  )
}
