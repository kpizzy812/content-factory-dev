/**
 * Переключение пошагового режима на КОНКРЕТНОМ ролике (§9).
 *
 * До этой ручки режим включался только полем монтажного профиля приложения
 * (`EditProfile.stepwiseApproval`) либо прямой записью в БД: `Video.stepwiseApproval`
 * прогон читал, но выставить его было нечем — при том, что поле сделано nullable
 * ровно затем, чтобы ролик мог перебить профиль в ОБЕ стороны.
 *
 * Три состояния, а не два:
 *   `true`  — включить на этом ролике, что бы ни говорил профиль;
 *   `false` — выключить на этом ролике, что бы ни говорил профиль;
 *   `null`  — наследовать профиль (снять переопределение).
 *
 * `null` — законное значение, а не «поле не прислали», поэтому разбор тела живёт
 * в `parseStepwiseOverride` и требует НАЛИЧИЯ ключа: склей их, и любой кривой
 * запрос молча стирал бы выбор оператора.
 *
 * Прогон эта ручка не запускает и не останавливает. Ролик, который уже стоит в
 * `awaiting_operator`, выключение режима само не отпускает — снять его с
 * ожидания может только явное решение (`approve-step`), иначе переключатель
 * флага тратил бы деньги. Текущий `awaitingStepKey` возвращается, чтобы
 * интерфейсу было чем сказать «ролик всё ещё ждёт решения по шагу X».
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный ID видео" })
  }

  const body = await readBody<unknown>(event).catch(() => null)
  const parsed = parseStepwiseOverride(body)

  if (!parsed.ok) {
    throw createError({ statusCode: 400, message: parsed.message })
  }

  // 404 бросает сама setVideoStepwiseApproval — правило «ролика нет» одно на все
  // входы, дублировать его проверкой в ручке нельзя: разойдутся.
  const result = await setVideoStepwiseApproval(id, parsed.value)

  return { data: result }
})
