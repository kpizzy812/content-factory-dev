/**
 * POST /api/taxonomy
 *
 * Создать новый taxonomy item.
 */
const VALID_TYPES = ['strategy', 'hook_style', 'prompt_pattern'] as const

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canCreate'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    type: string
    name: string
    shortDescription: string
    fullExplanation?: string
    category?: string
    tags?: string[]
    examples?: string[]
    useCases?: string[]
  }>(event)

  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, message: 'Название обязательно' })
  }
  if (!body?.shortDescription?.trim()) {
    throw createError({ statusCode: 400, message: 'Краткое описание обязательно' })
  }
  if (!body?.type || !VALID_TYPES.includes(body.type as any)) {
    throw createError({ statusCode: 400, message: `Неизвестный тип: ${body.type}. Допустимые: ${VALID_TYPES.join(', ')}` })
  }

  // Генерируем slug из name
  const slug = body.name
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s_-]/gi, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60)

  if (!slug) {
    throw createError({ statusCode: 400, message: 'Невозможно создать slug из названия' })
  }

  // Проверка уникальности
  const existing = await prisma.taxonomyItem.findUnique({
    where: { type_slug: { type: body.type as any, slug } },
  })
  if (existing) {
    throw createError({ statusCode: 409, message: `Элемент с slug "${slug}" уже существует для типа ${body.type}` })
  }

  const item = await prisma.taxonomyItem.create({
    data: {
      type: body.type as any,
      slug,
      name: body.name.trim(),
      shortDescription: body.shortDescription.trim(),
      fullExplanation: body.fullExplanation?.trim() || null,
      category: body.category?.trim() || null,
      tags: (body.tags ?? []).map(t => t.trim().toLowerCase()).filter(Boolean),
      examples: (body.examples ?? []).filter(Boolean),
      useCases: (body.useCases ?? []).filter(Boolean),
      isSystem: false,
      createdById: user.id,
    },
  })

  return { data: item }
})
