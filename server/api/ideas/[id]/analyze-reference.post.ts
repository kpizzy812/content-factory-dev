/**
 * Async fire-and-forget endpoint для глубокого reference-анализа.
 *
 * Возвращает HTTP 202 + { ideaId, status: 'running' }. Pipeline пишет прогресс в
 * Idea.analysisProgress (JSON ReferenceProgress). Клиент опрашивает /api/ideas/:id
 * пока referenceStatus === 'running'.
 *
 * Concurrency: глобальный счётчик MAX=2 в reference-pipeline. Если занято — 429.
 */

import {
  analyzeIdeaReference,
  releaseAnalysisSlot,
  tryAcquireAnalysisSlot,
} from '~~/server/utils/reference-pipeline'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID идеи' })
  }

  const idea = await prisma.idea.findUnique({ where: { id } })
  if (!idea || idea.isDeleted) {
    throw createError({ statusCode: 404, message: 'Идея не найдена' })
  }
  if (!idea.sourceUrl) {
    throw createError({ statusCode: 400, message: 'URL источника не указан' })
  }
  if (idea.referenceStatus === 'running') {
    throw createError({ statusCode: 409, message: 'Reference analysis уже выполняется' })
  }

  const allowedStatuses = ['ready', 'in_work', 'completed']
  if (!allowedStatuses.includes(idea.status)) {
    throw createError({
      statusCode: 400,
      message: `Идея должна быть в статусе ${allowedStatuses.join('/')}, текущий: ${idea.status}`,
    })
  }

  // Резервируем concurrency-слот ДО запуска. Если нет места — 429.
  const acquired = tryAcquireAnalysisSlot()
  if (!acquired) {
    throw createError({
      statusCode: 429,
      message: 'Слишком много одновременных анализов референса. Попробуйте через минуту.',
    })
  }

  // Стартовая запись в БД синхронно
  const startProgress = JSON.stringify({
    stage: 'queued',
    startedAt: new Date().toISOString(),
    elapsedSec: 0,
  })
  await prisma.idea.update({
    where: { id },
    data: {
      referenceStatus: 'running',
      analysisProgress: startProgress,
      errorMessage: null,
    },
  })

  // Fire-and-forget. Слот всегда освобождается, статус обновляется в БД.
  void (async () => {
    try {
      await analyzeIdeaReference(id)
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      await prisma.idea.update({
        where: { id },
        data: {
          referenceStatus: 'failed',
          errorMessage: msg.slice(0, 2000),
          analysisProgress: null,
        },
      }).catch(() => {})
      try {
        await logAgent('reference-pipeline', 'error', `Idea ${id}: ${msg}`, { ideaId: id })
      }
      catch { /* non-critical */ }
    }
    finally {
      releaseAnalysisSlot()
    }
  })()

  setResponseStatus(event, 202)
  return { data: { ideaId: id, status: 'running' as const } }
})
