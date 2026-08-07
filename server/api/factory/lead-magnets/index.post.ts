import type { Prisma } from '../../../../app/generated/prisma/client'
// Статусы держим в одном месте с таблицей переходов: иначе создание и PATCH
// разъезжаются, и «утверждённым» становится материал, который так назвали.
import { isLeadMagnetStatus } from '../../../utils/lead-magnet-library'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const appId = Number(body?.appId)
  if (!Number.isInteger(appId) || appId <= 0) {
    throw createError({ statusCode: 400, message: 'appId обязателен' })
  }
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
    appId,
  })

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title.length < 3 || title.length > 200) {
    throw createError({ statusCode: 400, message: 'Название лид-магнита должно содержать 3–200 символов' })
  }
  if (body.content == null || !['string', 'object'].includes(typeof body.content)) {
    throw createError({ statusCode: 400, message: 'content лид-магнита обязателен' })
  }
  const status = isLeadMagnetStatus(body.status) ? body.status : 'draft'
  if (body.warmupMessages !== undefined && !Array.isArray(body.warmupMessages)) {
    throw createError({ statusCode: 400, message: 'warmupMessages должен быть массивом сообщений' })
  }

  const app = await prisma.app.findUnique({ where: { id: appId }, select: { id: true } })
  if (!app) throw createError({ statusCode: 404, message: 'Приложение не найдено' })

  const item = await prisma.leadMagnet.create({
    data: {
      appId,
      title,
      problem: typeof body.problem === 'string' ? body.problem.trim().slice(0, 1000) || null : null,
      audience: typeof body.audience === 'string' ? body.audience.trim().slice(0, 1000) || null : null,
      content: body.content as Prisma.InputJsonValue,
      deliveryMessage: typeof body.deliveryMessage === 'string'
        ? body.deliveryMessage.trim().slice(0, 4000) || null
        : null,
      warmupMessages: body.warmupMessages as Prisma.InputJsonValue | undefined,
      status,
      createdById: user.id,
    },
  })

  return { data: item }
})
