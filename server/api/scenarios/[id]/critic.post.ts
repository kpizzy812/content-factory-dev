/**
 * POST /api/scenarios/:id/critic
 * Ручной запуск Quality Critic loop для сценария.
 * Rate-limited (5 reviews / 24ч на scenarioId, проверяется в orchestrator'е).
 */
import { runQualityCriticForScenario } from '~~/server/utils/scenario-critic-orchestrator'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canWrite', 'canRunAgent'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID сценария' })
  }

  const scenario = await prisma.scenario.findUnique({
    where: { id },
    select: { id: true, isDeleted: true, status: true },
  })
  if (!scenario) {
    throw createError({ statusCode: 404, message: 'Сценарий не найден' })
  }
  if (scenario.isDeleted) {
    throw createError({ statusCode: 400, message: 'Сценарий удалён' })
  }
  if (scenario.status === 'generating') {
    throw createError({ statusCode: 400, message: 'Сценарий ещё генерируется, дождитесь завершения' })
  }

  const body = await readBody<{ threshold?: number; maxIterations?: number }>(event).catch(() => null)
  const threshold = typeof body?.threshold === 'number' && body.threshold >= 0 && body.threshold <= 100
    ? body.threshold
    : undefined
  const maxIterations = typeof body?.maxIterations === 'number' && body.maxIterations >= 1 && body.maxIterations <= 3
    ? body.maxIterations
    : undefined

  const result = await runQualityCriticForScenario(id, { threshold, maxIterations })

  return { data: result }
})
