import { isKnownNodeType } from '~~/shared/utils/pipeline-node-registry'

const MAX_NODES = 200
const MAX_EDGES = 500
const MAX_MARKDOWN_LENGTH = 50_000

/** Убирает потенциально опасные HTML-теги из markdown-строки (серверная sanitization). */
function sanitizeMarkdown(md: string): string {
  return md
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript\s*:/gi, '')
}

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canCreate'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    version?: number
    exportedAt?: string
    pipeline?: {
      name?: string
      description?: string | null
      markdownDescription?: string | null
      icon?: string | null
      color?: string | null
      tags?: string[]
      graphData?: { nodes: any[]; edges: any[] }
    }
  }>(event)

  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      message: 'Тело запроса должно быть объектом формата PipelineExport',
    })
  }

  if (body.version !== 1) {
    throw createError({
      statusCode: 400,
      message: `Неподдерживаемая версия формата экспорта (получено: ${body.version}). Поддерживается только version: 1`,
    })
  }

  if (!body.pipeline || typeof body.pipeline !== 'object') {
    throw createError({
      statusCode: 400,
      message: "Поле 'pipeline' обязательно и должно быть объектом",
    })
  }

  const { pipeline: src } = body

  if (!src.name || typeof src.name !== 'string' || !src.name.trim()) {
    throw createError({
      statusCode: 400,
      message: "Поле 'pipeline.name' обязательно и должно быть непустой строкой",
    })
  }

  if (
    !src.graphData
    || typeof src.graphData !== 'object'
    || !Array.isArray(src.graphData.nodes)
    || !Array.isArray(src.graphData.edges)
  ) {
    throw createError({
      statusCode: 400,
      message: "Поле 'pipeline.graphData' должно содержать массивы nodes и edges",
    })
  }

  // Лимиты на размер графа
  if (src.graphData.nodes.length > MAX_NODES) {
    throw createError({
      statusCode: 400,
      message: `Слишком много блоков (${src.graphData.nodes.length}). Максимум: ${MAX_NODES}`,
    })
  }
  if (src.graphData.edges.length > MAX_EDGES) {
    throw createError({
      statusCode: 400,
      message: `Слишком много связей (${src.graphData.edges.length}). Максимум: ${MAX_EDGES}`,
    })
  }

  // Валидация типов нод и сбор предупреждений
  const warnings: string[] = []
  const unknownTypes: string[] = []
  const credentialRefs: string[] = []

  for (const node of src.graphData.nodes) {
    const nodeType = node?.data?.type
    if (nodeType && !isKnownNodeType(nodeType)) {
      unknownTypes.push(nodeType)
    }

    // Проверка ссылок на credentials (они не переносятся при импорте)
    const config = node?.data?.config
    if (config && typeof config === 'object') {
      for (const [key, value] of Object.entries(config)) {
        if (key.endsWith('CredentialId') && value) {
          credentialRefs.push(`${node.data?.label || node.id}: ${key}`)
        }
      }
    }
  }

  if (unknownTypes.length > 0) {
    warnings.push(`Неизвестные типы блоков: ${[...new Set(unknownTypes)].join(', ')}. Они могут не работать.`)
  }
  if (credentialRefs.length > 0) {
    warnings.push(`Блоки со ссылками на учётные данные (потребуется перенастройка): ${credentialRefs.join('; ')}`)
    // Очищаем credential references — они привязаны к исходному окружению
    for (const node of src.graphData.nodes) {
      const config = node?.data?.config
      if (config && typeof config === 'object') {
        for (const key of Object.keys(config)) {
          if (key.endsWith('CredentialId')) {
            config[key] = null
          }
        }
      }
    }
  }

  const name = `${src.name.trim()} (импорт)`

  if (name.length > 255) {
    throw createError({
      statusCode: 400,
      message: 'Название конвейера не должно превышать 255 символов',
    })
  }

  const data: Record<string, unknown> = {
    userId: user.id,
    name,
    description: src.description && typeof src.description === 'string'
      ? src.description.trim() || null
      : null,
    graphData: src.graphData,
  }

  // Sanitize markdown description — серверная защита от XSS
  if (src.markdownDescription && typeof src.markdownDescription === 'string') {
    let md = src.markdownDescription.trim()
    if (md.length > MAX_MARKDOWN_LENGTH) {
      md = md.slice(0, MAX_MARKDOWN_LENGTH)
      warnings.push(`Описание обрезано до ${MAX_MARKDOWN_LENGTH} символов`)
    }
    data.markdownDescription = sanitizeMarkdown(md) || null
  }
  if (src.icon && typeof src.icon === 'string') {
    data.icon = src.icon.trim()
  }
  if (src.color && typeof src.color === 'string') {
    data.color = src.color.trim()
  }
  if (Array.isArray(src.tags)) {
    const validTags = src.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).map(t => t.trim())
    if (validTags.length > 0) {
      data.tags = {
        connectOrCreate: validTags.map(tagName => ({
          where: { name: tagName },
          create: { name: tagName },
        })),
      }
    }
  }

  const pipeline = await prisma.pipeline.create({
    data: data as any,
    include: { tags: { select: { id: true, name: true } } },
  })

  return { data: pipeline, warnings }
})
