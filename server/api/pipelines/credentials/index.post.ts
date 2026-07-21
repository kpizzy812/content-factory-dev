/**
 * Create a new pipeline credential (encrypted storage).
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    name?: string
    type?: string
    secretData?: Record<string, string>
    description?: string
    expiresAt?: string
    metadata?: Record<string, unknown>
  }>(event)

  if (!body?.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
    throw createError({ statusCode: 400, message: 'Название обязательно (минимум 2 символа)' })
  }

  if (!body.secretData || typeof body.secretData !== 'object' || Object.keys(body.secretData).length === 0) {
    throw createError({ statusCode: 400, message: 'Секретные данные обязательны' })
  }

  // Validate all secret values are strings
  for (const [key, val] of Object.entries(body.secretData)) {
    if (typeof val !== 'string') {
      throw createError({ statusCode: 400, message: `Значение поля "${key}" должно быть строкой` })
    }
  }

  if (
    body.metadata !== undefined &&
    (typeof body.metadata !== 'object' || body.metadata === null || Array.isArray(body.metadata))
  ) {
    throw createError({ statusCode: 400, message: 'metadata должен быть объектом' })
  }

  const validTypes = ['api_key', 'bearer_token', 'basic_auth', 'oauth2', 'custom']
  const type = validTypes.includes(body.type ?? '') ? body.type! : 'api_key'

  const credential = await createCredential(user.id, {
    name: body.name.trim(),
    type,
    secretData: body.secretData,
    description: body.description?.trim(),
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    metadata: body.metadata,
  })

  return { data: credential }
})
