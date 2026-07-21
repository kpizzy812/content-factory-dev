const ALLOWED_FIELDS = ['title', 'hook', 'body', 'cta', 'visualStyle', 'whyViral', 'operatorNotes'] as const

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: 'Некорректный ID идеи',
    })
  }

  const body = await readBody<Record<string, unknown>>(event)

  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      message: 'Тело запроса обязательно',
    })
  }

  // Whitelist полей
  const data: Record<string, unknown> = {}
  for (const field of ALLOWED_FIELDS) {
    if (field in body && typeof body[field] === 'string') {
      data[field] = body[field] as string
    }
  }

  // Поддержка tags (массив строк)
  if ('tags' in body && Array.isArray(body.tags)) {
    data.tags = (body.tags as unknown[]).filter((t): t is string => typeof t === 'string')
  }

  if (Object.keys(data).length === 0) {
    throw createError({
      statusCode: 400,
      message: `Необходимо указать хотя бы одно поле: ${ALLOWED_FIELDS.join(', ')}, tags`,
    })
  }

  const existing = await prisma.idea.findUnique({ where: { id } })

  if (!existing || existing.isDeleted) {
    throw createError({
      statusCode: 404,
      message: 'Идея не найдена',
    })
  }

  // Если идея синхронизирована с MC — помечаем localDirty
  if (existing.externalId && existing.syncStatus === 'synced') {
    data.localDirty = true
  }

  const [idea] = await prisma.$transaction([
    prisma.idea.update({
      where: { id },
      data,
      include: {
        app: { select: { id: true, name: true } },
        analysis: true,
      },
    }),
    prisma.ideaOperatorAction.create({
      data: {
        ideaId: id,
        actionType: 'edit',
        reason: `Отредактированы поля: ${Object.keys(data).join(', ')}`,
        actorId: user.id,
      },
    }),
  ])

  return { data: idea }
})
