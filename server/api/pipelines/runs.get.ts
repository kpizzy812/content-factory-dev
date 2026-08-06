/**
 * GET /api/pipelines/runs — запуски по всем доступным конвейерам.
 *
 * До него истории существовали только внутри одного конвейера
 * (`/api/pipelines/:id/runs`), а `/api/pipelines/monitor` отдаёт конвейеры со
 * вложенными запусками — то есть каталог, а не ленту. Из-за этого в
 * интерфейсе не было общего экрана «что происходило на заводе» и пункта
 * «Запуски» в навигации.
 *
 * Фильтры: статус (`?status=failed,cancelled`), конвейер (`?pipelineId=`),
 * календарный день (`?day=2026-08-06`).
 */

import { listRuns, parseRunListQuery } from '~~/server/utils/pipeline-run-list'

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const filters = parseRunListQuery(getQuery(event) as Record<string, unknown>)

  // Администратор видит завод целиком; остальные — свои и расшаренные.
  // Список id считается заранее: фильтровать запуски по вложенному условию
  // конвейера дороже, чем по готовому массиву.
  let pipelineIds: number[] | null = null
  if (!user.canAdmin) {
    const accessible = await prisma.pipeline.findMany({
      where: { OR: [{ userId: user.id }, { sharedWith: { has: user.id } }] },
      select: { id: true },
    })
    pipelineIds = accessible.map(p => p.id)
  }

  return listRuns(filters, pipelineIds)
})
