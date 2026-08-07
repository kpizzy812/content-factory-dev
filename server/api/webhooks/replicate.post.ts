import {
  createError,
  defineEventHandler,
  getRequestHeaders,
  getRequestURL,
  readRawBody,
} from "h3"
import { readReplicateConfig } from "../../utils/replicate/config"
import { finalizeAfterWebhook } from "../../utils/replicate/finalize"
import {
  handleReplicateWebhook,
  InvalidReplicateWebhookError,
  InvalidReplicateWebhookPayloadError,
} from "../../utils/replicate/webhook"

export default defineEventHandler(async (event) => {
  const body = await readRawBody(event)
  if (body === undefined) {
    throw createError({ statusCode: 400, message: "Replicate webhook body is required" })
  }

  const config = readReplicateConfig()
  if (!config.webhookSigningSecret) {
    throw createError({ statusCode: 503, message: "Replicate webhook verification is not configured" })
  }

  try {
    const prediction = await handleReplicateWebhook({
      body,
      headers: getRequestHeaders(event),
      url: getRequestURL(event).toString(),
      secret: config.webhookSigningSecret,
    })
    // Вебхук — основной путь завершения, а не только запись статуса: ставим
    // перенос результата в фоновую очередь, не задерживая ответ 200. Очередь
    // нужна потому, что вебхуки приходят пачкой по всему пакету роликов.
    finalizeAfterWebhook(prediction, config)
    return {
      ok: true,
      predictionId: prediction.externalId,
      status: prediction.status,
    }
  } catch (error) {
    if (error instanceof InvalidReplicateWebhookError) {
      throw createError({ statusCode: 401, message: error.message })
    }
    if (error instanceof InvalidReplicateWebhookPayloadError) {
      throw createError({ statusCode: 400, message: error.message })
    }
    throw error
  }
})
