/**
 * Генерация или обновление webhook-токена для конвейера.
 * Генерирует как токен (URL), так и signing secret (для HMAC-SHA256).
 */
import { randomUUID, randomBytes } from 'node:crypto'

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

  const pipeline = await prisma.pipeline.findUnique({
    where: { id },
  })

  if (!pipeline) {
    throw createError({
      statusCode: 404,
      message: 'Конвейер не найден',
    })
  }

  const isOwner = pipeline.userId === user.id
  const isShared = pipeline.sharedWith.includes(user.id)

  if (!isOwner && !isShared && !user.canAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Нет доступа к этому конвейеру',
    })
  }

  const token = randomUUID()
  const secret = randomBytes(32).toString('hex')

  await prisma.pipeline.update({
    where: { id },
    data: {
      webhookToken: token,
      webhookSecret: secret,
      webhookEnabled: true,
    },
  })

  return {
    data: {
      token,
      secret,
    },
  }
})
