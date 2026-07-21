/**
 * GET /api/apps/:id/context
 * Scenario-ready контекст приложения для AI-агентов и pipeline.
 */
import { getAppScenarioContext, formatAppContextForPrompt } from '~~/server/utils/app-context'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID приложения" })
  }

  const ctx = await getAppScenarioContext(id)
  if (!ctx) {
    throw createError({ statusCode: 404, message: "Приложение не найдено" })
  }

  const query = getQuery(event)
  // ?format=prompt — вернуть текстовый блок для промпта
  if (query.format === 'prompt') {
    return { data: formatAppContextForPrompt(ctx) }
  }

  return { data: ctx }
})
