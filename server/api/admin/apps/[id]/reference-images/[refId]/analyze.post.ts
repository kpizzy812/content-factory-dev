/**
 * POST /api/admin/apps/:id/reference-images/:refId/analyze
 * Ручной перезапуск AI-анализа конкретного скриншота через screen-tagger-agent.
 * Используется когда AI-анализ упал (aiError != null) или AI-теги устарели.
 *
 * Запрос синхронный — ждём результата vision API, чтобы UI мог показать обновлённые поля
 * сразу. На таймауте Anthropic возвращаем ошибку 502.
 */
import { analyzeAppReferenceImage } from "~~/server/utils/agents/screen-tagger-agent"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const appId = Number(getRouterParam(event, "id"))
  const refId = getRouterParam(event, "refId")

  if (!appId || Number.isNaN(appId)) {
    throw createError({ statusCode: 400, message: "Некорректный ID приложения" })
  }
  if (!refId) {
    throw createError({ statusCode: 400, message: "Не указан ID картинки" })
  }

  const ref = await prisma.appReferenceImage.findUnique({ where: { id: refId } })
  if (!ref) {
    throw createError({ statusCode: 404, message: "Reference картинка не найдена" })
  }
  if (ref.appId !== appId) {
    throw createError({ statusCode: 404, message: "Reference картинка принадлежит другому приложению" })
  }

  const result = await analyzeAppReferenceImage(refId)

  const updated = await prisma.appReferenceImage.findUnique({ where: { id: refId } })

  if (!result || updated?.aiError) {
    throw createError({
      statusCode: 502,
      message: updated?.aiError || "AI-анализ не дал результата",
      data: { reference: updated },
    })
  }

  return { data: { reference: updated } }
})
