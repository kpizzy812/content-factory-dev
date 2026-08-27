/**
 * Решение оператора по шагу в пошаговом режиме (§9).
 *
 * `approve` — принять результат и продолжить; `regenerate` — переиграть тот же
 * шаг и снова показать результат. Продолжение — это НОВЫЙ прогон
 * `runVideoPipeline`: завершённые шаги он поднимает из снапшотов и повторно за
 * них не платит. Запускаем fire-and-forget тем же приёмом, что
 * `resumeVideoPipeline` и `rerunVideoStep`, — HTTP-ответ не должен ждать
 * генерацию.
 */

const VALID_ACTIONS = ["approve", "regenerate"] as const
type ApprovalAction = (typeof VALID_ACTIONS)[number]

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный ID видео" })
  }

  const body = await readBody<{ action?: string }>(event).catch(() => null)
  const rawAction = body?.action ?? "approve"

  if (!VALID_ACTIONS.includes(rawAction as ApprovalAction)) {
    throw createError({
      statusCode: 400,
      message: `Поле 'action' должно быть одним из: ${VALID_ACTIONS.join(", ")}`,
    })
  }

  // 404/409 бросает сама applyStepwiseApproval: правило «ролик не ждёт решения»
  // одно на все входы, дублировать его проверкой в ручке нельзя — разойдутся.
  const result = await applyStepwiseApproval(id, rawAction as ApprovalAction)

  runVideoPipeline(id).catch((err) => {
    logAgent('video-pipeline', 'error',
      `Ошибка продолжения видео ${id} после решения оператора: ${err instanceof Error ? err.message : err}`,
      { videoId: id },
    ).catch(() => {})
  })

  return {
    data: {
      id,
      action: result.action,
      approvedStepKey: result.approvedStepKey,
      regeneratedStepKey: result.regeneratedStepKey,
      status: "pending",
    },
  }
})
