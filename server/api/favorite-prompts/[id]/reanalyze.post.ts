/**
 * POST /api/favorite-prompts/:id/reanalyze — ручной запуск AI-анализа паттерна.
 * Сбрасывает aiAnalysisAttempts/aiAnalysisError и await'ит extractPromptPattern
 * sync, чтобы UI получил свежие aiPatternAnalysis в одном round-trip'е.
 *
 * При ошибке Haiku — 502. attempts при этом не инкрементятся (мы их только что
 * сбросили в 0; повторное падение учтётся как первый attempt в следующий раз).
 */

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID' })
  }

  const existing = await prisma.favoritePrompt.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Промт не найден' })
  }

  if (existing.userId !== user.id && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Запустить анализ может только автор или администратор' })
  }

  // Сбрасываем счётчик попыток и предыдущую ошибку, чтобы дать чистый retry.
  await prisma.favoritePrompt.update({
    where: { id },
    data: {
      aiAnalysisAttempts: 0,
      aiAnalysisError: null,
    },
  })

  // Sync await — клиенту нужен свежий результат сразу. extractPromptPattern сам
  // пишет результат в БД (cache write inside).
  try {
    await extractPromptPattern(id, existing.promptText)
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось проанализировать промт'
    // Записываем ошибку и инкрементим attempts чтобы фолбэк UI показал failed
    await prisma.favoritePrompt.update({
      where: { id },
      data: {
        aiAnalysisError: message.slice(0, 500),
        aiAnalysisAttempts: { increment: 1 },
      },
    }).catch(() => { /* ignore write errors */ })
    throw createError({ statusCode: 502, message: `AI-анализ не удался: ${message}` })
  }

  const fresh = await prisma.favoritePrompt.findUnique({
    where: { id },
    include: {
      app: { select: { id: true, name: true } },
      sourceVideoAsset: {
        select: {
          id: true,
          order: true,
          video: { select: { id: true, scenarioId: true } },
        },
      },
    },
  })

  return { data: fresh }
})
