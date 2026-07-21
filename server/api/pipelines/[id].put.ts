const VALID_STATUSES = ['active', 'inactive'] as const

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: 'Некорректный ID конвейера',
    })
  }

  const body = await readBody<Record<string, unknown>>(event)

  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      message: 'Тело запроса обязательно',
    })
  }

  const existing = await prisma.pipeline.findUnique({ where: { id } })

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Конвейер не найден',
    })
  }

  // Только владелец или admin может менять
  if (existing.userId !== user.id && !user.canAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Только владелец может редактировать конвейер',
    })
  }

  // Whitelist полей
  const data: Record<string, unknown> = {}

  if ('name' in body && typeof body.name === 'string' && body.name.trim()) {
    const name = body.name.trim()
    if (name.length > 255) {
      throw createError({
        statusCode: 400,
        message: 'Название конвейера не должно превышать 255 символов',
      })
    }
    data.name = name
  }

  if ('description' in body) {
    data.description = body.description
      ? String(body.description).trim() || null
      : null
  }

  if ('status' in body) {
    if (!VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
      throw createError({
        statusCode: 400,
        message: `Некорректный статус. Допустимые: ${VALID_STATUSES.join(', ')}`,
      })
    }
    data.status = body.status
  }

  if ('graphData' in body) {
    const gd = body.graphData as Record<string, unknown> | null
    if (!gd || typeof gd !== 'object' || !Array.isArray(gd.nodes) || !Array.isArray(gd.edges)) {
      throw createError({
        statusCode: 400,
        message: "graphData должен содержать поля 'nodes' (массив) и 'edges' (массив)",
      })
    }
    data.graphData = gd
  }

  if ('webhookEnabled' in body && typeof body.webhookEnabled === 'boolean') {
    data.webhookEnabled = body.webhookEnabled
  }

  if ('sharedWith' in body) {
    if (!Array.isArray(body.sharedWith) || !body.sharedWith.every((v) => typeof v === 'number' && v > 0)) {
      throw createError({
        statusCode: 400,
        message: "sharedWith должен быть массивом числовых ID пользователей",
      })
    }
    data.sharedWith = body.sharedWith
  }

  if ('markdownDescription' in body) {
    data.markdownDescription = body.markdownDescription
      ? String(body.markdownDescription).trim() || null
      : null
  }

  if ('icon' in body) {
    data.icon = body.icon ? String(body.icon).trim() : null
  }

  if ('color' in body) {
    data.color = body.color ? String(body.color).trim() : null
  }

  if ('tags' in body) {
    if (!Array.isArray(body.tags) || !body.tags.every((t: unknown) => typeof t === 'string')) {
      throw createError({
        statusCode: 400,
        message: 'tags должен быть массивом строк',
      })
    }
    const tagNames = (body.tags as string[]).map(t => t.trim()).filter(Boolean)
    // Upsert each tag to ensure it exists
    for (const tagName of tagNames) {
      await prisma.pipelineTag.upsert({
        where: { name: tagName },
        create: { name: tagName },
        update: {},
      })
    }
    data.tags = { set: tagNames.map(tagName => ({ name: tagName })) }
  }

  if (Object.keys(data).length === 0) {
    throw createError({
      statusCode: 400,
      message: 'Необходимо указать хотя бы одно поле для обновления',
    })
  }

  // Автоматически обновляем lastEditedAt при любом изменении контента/метаданных
  data.lastEditedAt = new Date()

  const pipeline = await prisma.pipeline.update({
    where: { id },
    data,
    include: { tags: { select: { id: true, name: true } } },
  })

  return { data: pipeline }
})
