/**
 * POST /api/uploads/:id/retry
 * Повторить загрузку: failed / blocked_by_env, а также залипшую в pending или
 * uploading (процесс перезапустили посреди fire-and-forget прогона — автоматика
 * такие записи не подбирает, см. upload-rerun-guard).
 */
import { planManualUploadRetry } from "~~/server/utils/upload-rerun-guard"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'social-upload' })

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Неверный ID загрузки",
    })
  }

  const upload = await prisma.upload.findUnique({
    where: { id },
    select: { id: true, status: true, updatedAt: true },
  })

  if (!upload) {
    throw createError({ statusCode: 404, message: "Загрузка не найдена" })
  }

  const decision = planManualUploadRetry(upload)
  if (!decision.allowed) {
    throw createError({ statusCode: 400, message: decision.message })
  }

  // Проверить env guard перед retry
  if (process.env.ENABLE_SOCIAL_POSTING !== "true") {
    throw createError({
      statusCode: 403,
      message: "Публикация в соцсети отключена (ENABLE_SOCIAL_POSTING=false). Включите перед повторной загрузкой.",
    })
  }

  // Сбросить статус и ошибку. updateMany с проверкой прежнего статуса —
  // защита от гонки с автоповтором планировщика: кто первый забрал запись,
  // тот и запускает пайплайн, второй получает 409 вместо второй заливки.
  //
  // platformPostId/platformPostUrl намеренно НЕ обнуляем: для tiktok и instagram
  // это якорь идемпотентности (адаптеры по нему делают short-circuit вместо
  // повторной публикации). Обнулять его — гарантированно получить второй пост.
  const claimed = await prisma.upload.updateMany({
    where: { id, status: upload.status as never },
    data: {
      status: "pending" as never,
      errorMessage: null,
      blockedByEnv: false,
    },
  })

  if (claimed.count === 0) {
    throw createError({
      statusCode: 409,
      message: "Загрузку уже перезапустил кто-то другой (планировщик или другой оператор).",
    })
  }

  if (decision.stuck) {
    await logAgent(
      "scheduler",
      "warn",
      `Upload #${id}: ручной перезапуск залипшей загрузки (статус был ${upload.status})`,
    ).catch(() => {})
  }

  // Fire-and-forget: запустить pipeline. trigger=manual — за кнопкой стоит
  // человек, он берёт на себя риск дубля на площадках без resume.
  runUploadPipeline(id, { trigger: "manual" }).catch(() => {})

  return { data: { id, status: "pending", retrying: true } }
})
