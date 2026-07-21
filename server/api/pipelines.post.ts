export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canCreate'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    name?: string
    description?: string
    markdownDescription?: string
    icon?: string
    color?: string
    tags?: string[]
    graphData?: { nodes: any[]; edges: any[] }
  }>(event)

  if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
    throw createError({
      statusCode: 400,
      message: "Поле 'name' обязательно и должно быть непустой строкой",
    })
  }

  const name = body.name.trim()

  if (name.length > 255) {
    throw createError({
      statusCode: 400,
      message: 'Название конвейера не должно превышать 255 символов',
    })
  }

  const description = body.description
    ? String(body.description).trim() || null
    : null

  const pipeline = await prisma.pipeline.create({
    data: {
      userId: user.id,
      name,
      description,
      markdownDescription: body.markdownDescription && typeof body.markdownDescription === 'string'
        ? body.markdownDescription.trim() || null
        : null,
      icon: body.icon && typeof body.icon === 'string' ? body.icon.trim() : null,
      color: body.color && typeof body.color === 'string' ? body.color.trim() : null,
      tags: Array.isArray(body.tags)
        ? {
            connectOrCreate: body.tags
              .filter((t): t is string => typeof t === 'string' && !!t.trim())
              .map(t => t.trim())
              .map(tagName => ({
                where: { name: tagName },
                create: { name: tagName },
              })),
          }
        : undefined,
      ...(body.graphData && typeof body.graphData === 'object' && Array.isArray(body.graphData.nodes) && Array.isArray(body.graphData.edges)
        ? { graphData: body.graphData }
        : {}),
    },
    include: { tags: { select: { id: true, name: true } } },
  })

  return { data: pipeline }
})
