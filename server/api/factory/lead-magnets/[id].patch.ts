/**
 * PATCH /api/factory/lead-magnets/:id
 *
 * Утверждение, отзыв и правка лид-магнита. ПОЧЕМУ это отдельный эндпоинт:
 * флагманский пресет запускает партию только с утверждённым магнитом
 * (`requireApprovedLeadMagnet` → `content-quality-gate.ts`), а автосозданные
 * магниты рождаются черновиками. Без этого перехода фабрика не стартует вообще.
 *
 * Переходы статуса берём из общей таблицы (`utils/lead-magnet-library.ts`),
 * чтобы «утверждение» нельзя было получить произвольной строкой в теле запроса.
 */
import type { Prisma } from '../../../../app/generated/prisma/client'
import {
  canTransitionLeadMagnetStatus,
  describeLeadMagnetTransition,
  isLeadMagnetStatus,
} from '../../../utils/lead-magnet-library'

/** Поля материала: их правка разрешена только пока магнит в черновике. */
const CONTENT_FIELDS = ['title', 'problem', 'audience', 'content', 'deliveryMessage', 'warmupMessages'] as const

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'ID лид-магнита обязателен' })

  const current = await prisma.leadMagnet.findUnique({
    where: { id },
    select: { id: true, appId: true, status: true },
  })
  if (!current) throw createError({ statusCode: 404, message: 'Лид-магнит не найден' })

  await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
    appId: current.appId,
  })

  const body = await readBody<Record<string, unknown>>(event) ?? {}
  const data: Record<string, unknown> = {}

  const touchesContent = CONTENT_FIELDS.some(field => body[field] !== undefined)
  if (touchesContent && current.status !== 'draft') {
    // Утверждённый материал уже прошёл ручную проверку и может быть в выдаче у
    // зрителей: молча подменять его текст нельзя. Сначала вернуть в черновик.
    throw createError({
      statusCode: 409,
      message: 'Править можно только черновик. Верните лид-магнит в статус draft, затем правьте',
    })
  }

  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (title.length < 3 || title.length > 200) {
      throw createError({ statusCode: 400, message: 'Название лид-магнита должно содержать 3–200 символов' })
    }
    data.title = title
  }
  if (body.problem !== undefined) {
    data.problem = typeof body.problem === 'string' ? body.problem.trim().slice(0, 1000) || null : null
  }
  if (body.audience !== undefined) {
    data.audience = typeof body.audience === 'string' ? body.audience.trim().slice(0, 1000) || null : null
  }
  if (body.content !== undefined) {
    if (body.content == null || !['string', 'object'].includes(typeof body.content)) {
      throw createError({ statusCode: 400, message: 'content лид-магнита обязателен' })
    }
    data.content = body.content as Prisma.InputJsonValue
  }
  if (body.deliveryMessage !== undefined) {
    data.deliveryMessage = typeof body.deliveryMessage === 'string'
      ? body.deliveryMessage.trim().slice(0, 4000) || null
      : null
  }
  if (body.warmupMessages !== undefined) {
    if (body.warmupMessages !== null && !Array.isArray(body.warmupMessages)) {
      throw createError({ statusCode: 400, message: 'warmupMessages должен быть массивом сообщений' })
    }
    data.warmupMessages = body.warmupMessages as Prisma.InputJsonValue
  }

  let statusChanged = false
  if (body.status !== undefined) {
    if (!isLeadMagnetStatus(body.status)) {
      throw createError({ statusCode: 400, message: describeLeadMagnetTransition(current.status, body.status) })
    }
    if (body.status !== current.status) {
      if (!canTransitionLeadMagnetStatus(current.status, body.status)) {
        // 409, а не 400: тело запроса корректное, не сходится состояние записи.
        throw createError({ statusCode: 409, message: describeLeadMagnetTransition(current.status, body.status) })
      }
      data.status = body.status
      statusChanged = true
    }
    // Совпадающий статус — идемпотентный no-op: повторный клик «утвердить»
    // не должен превращаться в ошибку.
  }

  if (Object.keys(data).length === 0) {
    const item = await prisma.leadMagnet.findUnique({ where: { id } })
    return { data: item, changed: false }
  }

  const item = await prisma.leadMagnet.update({ where: { id }, data: data as Prisma.LeadMagnetUpdateInput })

  if (statusChanged) {
    // Утверждение и отзыв магнита — событие для журнала: от него зависит,
    // стартует ли партия по флагманскому пресету.
    // Журнал не должен ронять уже применённое изменение статуса.
    await logAgent(
      'lead-magnet',
      'info',
      `Лид-магнит #${id}: статус ${current.status} → ${data.status}`,
      { leadMagnetId: id, appId: current.appId, from: current.status, to: data.status },
    ).catch(() => {})
  }

  return { data: item, changed: true }
})
