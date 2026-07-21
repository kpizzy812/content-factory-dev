export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canCreate'],
    moduleSlug: 'script-generator',
  })

  const body = await readBody<{
    sourceUrl?: string
    appId?: number
    language?: string
  }>(event)

  if (!body?.sourceUrl || typeof body.sourceUrl !== 'string') {
    throw createError({
      statusCode: 400,
      message: "Поле 'sourceUrl' обязательно и должно быть строкой",
    })
  }

  const sourceUrl = body.sourceUrl.trim()

  if (!sourceUrl.startsWith('http')) {
    throw createError({
      statusCode: 400,
      message: 'Некорректный URL. Ссылка должна начинаться с http:// или https://',
    })
  }

  // Дедупликация: проверяем, нет ли активной идеи с таким же URL
  const existing = await prisma.idea.findFirst({
    where: {
      sourceUrl,
      isDeleted: false,
    },
  })

  if (existing) {
    throw createError({
      statusCode: 409,
      message: `Идея с таким URL уже существует (ID: ${existing.id})`,
    })
  }

  // Валидация appId если указан
  if (body.appId !== undefined) {
    if (typeof body.appId !== 'number' || body.appId <= 0) {
      throw createError({
        statusCode: 400,
        message: "Поле 'appId' должно быть числом > 0",
      })
    }

    const app = await prisma.app.findUnique({ where: { id: body.appId } })
    if (!app) {
      throw createError({
        statusCode: 404,
        message: 'Приложение не найдено',
      })
    }
  }

  const idea = await prisma.idea.create({
    data: {
      sourceUrl,
      appId: body.appId ?? null,
      language: body.language ?? null,
      source: 'manual',
      createdById: user.id,
    },
  })

  // Логируем действие оператора
  await prisma.ideaOperatorAction.create({
    data: {
      ideaId: idea.id,
      actionType: 'create',
      actorId: user.id,
    },
  }).catch(() => {})

  // Fire-and-forget: запускаем обработку
  processIdea(idea.id).catch(() => {})

  return { data: idea }
})
