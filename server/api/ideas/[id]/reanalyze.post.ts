/**
 * POST /api/ideas/:id/reanalyze
 * Повторный структурированный анализ идеи.
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canCreate', 'canRunAgent'],
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

  if (idea.analysisStatus === 'running') {
    throw createError({
      statusCode: 409,
      message: 'Анализ уже выполняется',
    })
  }

  if (!idea.sourceUrl) {
    throw createError({
      statusCode: 400,
      message: 'URL источника не указан — невозможно запустить анализ',
    })
  }

  requirePaidApisEnabled('Anthropic Claude API')

  await prisma.ideaOperatorAction.create({
    data: {
      ideaId: id,
      actionType: 'reanalyze',
      actorId: user.id,
    },
  })

  // Fire-and-forget: перезапуск анализа
  reanalyzeIdea(id).catch(() => {})

  return { data: { id, analysisStatus: 'running' } }
})
