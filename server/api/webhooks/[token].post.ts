/**
 * Public webhook endpoint for triggering pipeline runs — hardened.
 *
 * Security layers:
 * 1. Token validation (UUID)
 * 2. HMAC-SHA256 signature verification (if webhook secret configured)
 * 3. Replay protection (X-Webhook-Timestamp, 5-minute window)
 * 4. Multi-layer rate limiting (per-pipeline, per-IP, global)
 * 5. Abuse auto-detection and auto-disable
 * 6. Payload size limit (100KB)
 * 7. Webhook enabled/disabled state
 * 8. Duplicate run prevention
 * 9. Full request logging for forensics
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const REPLAY_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const recentNonces = new Map<string, number>()

// Clean up expired nonces periodically
setInterval(() => {
  const cutoff = Date.now() - REPLAY_WINDOW_MS * 2
  for (const [key, ts] of recentNonces) {
    if (ts < cutoff) recentNonces.delete(key)
  }
}, 60_000)

/** Verify HMAC-SHA256 signature. */
function verifySignature(
  secret: string,
  payload: string,
  signature: string,
  timestamp: string,
): boolean {
  const signedPayload = `${timestamp}.${payload}`
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  const receivedBuf = Buffer.from(signature, 'utf8')

  if (expectedBuf.length !== receivedBuf.length) return false
  return timingSafeEqual(expectedBuf, receivedBuf)
}

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')

  if (!token || token.length < 10) {
    throw createError({ statusCode: 400, message: 'Некорректный токен' })
  }

  const pipeline = await prisma.pipeline.findUnique({
    where: { webhookToken: token },
  })

  if (!pipeline) {
    throw createError({ statusCode: 404, message: 'Конвейер не найден по указанному токену' })
  }

  // Capture request info for logging
  const sourceIp = (
    getRequestHeader(event, 'x-forwarded-for')
    || getRequestHeader(event, 'x-real-ip')
    || 'unknown'
  )
  const userAgent = getRequestHeader(event, 'user-agent') || null

  // --- Security Layer: Multi-layer rate limiting ---
  const rateCheck = checkWebhookRateLimit(pipeline.id, String(sourceIp))
  if (!rateCheck.allowed) {
    trackWebhookError(pipeline.id)
    await prisma.webhookLog.create({
      data: {
        pipelineId: pipeline.id,
        sourceIp: String(sourceIp).slice(0, 100),
        userAgent: userAgent?.slice(0, 500),
        statusCode: 429,
        errorMsg: `Rate limit (${rateCheck.blockedBy ?? 'pipeline'}): retry after ${Math.ceil((rateCheck.retryAfterMs ?? 60000) / 1000)}s`,
      },
    }).catch(() => {})

    setResponseHeader(event, 'Retry-After', Math.ceil((rateCheck.retryAfterMs ?? 60000) / 1000) as any)
    throw createError({ statusCode: 429, message: 'Слишком много запросов. Повторите позже.' })
  }

  // --- Security Layer: Abuse auto-detection ---
  const abuse = checkAbuseLevel(pipeline.id)
  if (abuse.shouldAutoDisable && pipeline.webhookEnabled) {
    // Auto-disable webhook under sustained abuse
    await prisma.pipeline.update({
      where: { id: pipeline.id },
      data: { webhookEnabled: false },
    }).catch(() => {})

    await prisma.webhookLog.create({
      data: {
        pipelineId: pipeline.id,
        sourceIp: String(sourceIp).slice(0, 100),
        userAgent: userAgent?.slice(0, 500),
        statusCode: 403,
        errorMsg: `Webhook автоматически отключён: ${abuse.recentErrors} ошибок за 10 мин`,
      },
    }).catch(() => {})

    await logAgent('pipeline-runtime', 'warn',
      `Webhook конвейера #${pipeline.id} автоматически отключён: ${abuse.recentErrors} ошибок за 10 мин`,
      { pipelineId: pipeline.id, abuseErrors: abuse.recentErrors },
    )

    throw createError({ statusCode: 403, message: 'Webhook автоматически отключён из-за подозрительной активности' })
  }

  // --- Security Layer: HMAC signature verification (if secret configured) ---
  if (pipeline.webhookSecret) {
    const signature = getRequestHeader(event, 'x-webhook-signature')
    const timestamp = getRequestHeader(event, 'x-webhook-timestamp')

    if (!signature || !timestamp) {
      trackWebhookError(pipeline.id)
      await prisma.webhookLog.create({
        data: {
          pipelineId: pipeline.id,
          sourceIp: String(sourceIp).slice(0, 100),
          userAgent: userAgent?.slice(0, 500),
          statusCode: 401,
          errorMsg: 'Missing signature headers (X-Webhook-Signature, X-Webhook-Timestamp)',
        },
      }).catch(() => {})
      throw createError({ statusCode: 401, message: 'Отсутствуют заголовки подписи запроса' })
    }

    // Replay protection: check timestamp freshness
    const requestTime = Number(timestamp)
    const now = Date.now()
    if (Number.isNaN(requestTime) || Math.abs(now - requestTime) > REPLAY_WINDOW_MS) {
      trackWebhookError(pipeline.id)
      await prisma.webhookLog.create({
        data: {
          pipelineId: pipeline.id,
          sourceIp: String(sourceIp).slice(0, 100),
          userAgent: userAgent?.slice(0, 500),
          statusCode: 401,
          errorMsg: `Replay protection: timestamp outside ${REPLAY_WINDOW_MS / 60000}min window`,
        },
      }).catch(() => {})
      throw createError({ statusCode: 401, message: 'Метка времени запроса за пределами допустимого окна' })
    }

    // Nonce check: prevent exact request replay
    const nonce = getRequestHeader(event, 'x-webhook-nonce')
    if (nonce) {
      const nonceKey = `${pipeline.id}:${nonce}`
      if (recentNonces.has(nonceKey)) {
        trackWebhookError(pipeline.id)
        await prisma.webhookLog.create({
          data: {
            pipelineId: pipeline.id,
            sourceIp: String(sourceIp).slice(0, 100),
            userAgent: userAgent?.slice(0, 500),
            statusCode: 409,
            errorMsg: 'Replay protection: duplicate nonce',
          },
        }).catch(() => {})
        throw createError({ statusCode: 409, message: 'Повторная отправка запроса (дубликат nonce)' })
      }
      recentNonces.set(nonceKey, now)
    }

    // Read raw body for signature verification
    const rawBody = await readRawBody(event) || ''

    if (!verifySignature(pipeline.webhookSecret, String(rawBody), signature, timestamp)) {
      trackWebhookError(pipeline.id)
      await prisma.webhookLog.create({
        data: {
          pipelineId: pipeline.id,
          sourceIp: String(sourceIp).slice(0, 100),
          userAgent: userAgent?.slice(0, 500),
          statusCode: 401,
          errorMsg: 'Invalid HMAC signature',
        },
      }).catch(() => {})
      throw createError({ statusCode: 401, message: 'Неверная подпись запроса' })
    }
  }

  // --- Read body ---
  let payload: unknown = null
  try {
    payload = await readBody(event).catch(() => null)
  } catch {
    // No body is fine
  }

  // Payload size check (max 100KB)
  if (payload && JSON.stringify(payload).length > 100_000) {
    trackWebhookError(pipeline.id)
    await prisma.webhookLog.create({
      data: {
        pipelineId: pipeline.id,
        sourceIp: String(sourceIp).slice(0, 100),
        userAgent: userAgent?.slice(0, 500),
        statusCode: 413,
        errorMsg: 'Payload too large (>100KB)',
      },
    }).catch(() => {})
    throw createError({ statusCode: 413, message: 'Тело запроса слишком большое (максимум 100КБ)' })
  }

  // Check if webhook is enabled
  if (!pipeline.webhookEnabled) {
    trackWebhookError(pipeline.id)
    await prisma.webhookLog.create({
      data: {
        pipelineId: pipeline.id,
        sourceIp: String(sourceIp).slice(0, 100),
        userAgent: userAgent?.slice(0, 500),
        payload: payload as never,
        statusCode: 403,
        errorMsg: 'Webhook отключён',
      },
    }).catch(() => {})
    throw createError({ statusCode: 403, message: 'Webhook отключён для этого конвейера' })
  }

  if (pipeline.status !== 'active') {
    trackWebhookError(pipeline.id)
    await prisma.webhookLog.create({
      data: {
        pipelineId: pipeline.id,
        sourceIp: String(sourceIp).slice(0, 100),
        userAgent: userAgent?.slice(0, 500),
        payload: payload as never,
        statusCode: 400,
        errorMsg: 'Конвейер не активен',
      },
    }).catch(() => {})
    throw createError({ statusCode: 400, message: 'Конвейер не активен' })
  }

  const graph = pipeline.graphData as { nodes?: unknown[] }
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []

  if (nodes.length === 0) {
    trackWebhookError(pipeline.id)
    await prisma.webhookLog.create({
      data: {
        pipelineId: pipeline.id,
        sourceIp: String(sourceIp).slice(0, 100),
        userAgent: userAgent?.slice(0, 500),
        payload: payload as never,
        statusCode: 400,
        errorMsg: 'Конвейер не содержит блоков',
      },
    }).catch(() => {})
    throw createError({ statusCode: 400, message: 'Конвейер не содержит блоков' })
  }

  // Duplicate run prevention
  const activeRun = await prisma.workflowRun.findFirst({
    where: {
      pipelineId: pipeline.id,
      status: { in: ['running', 'pending'] },
    },
  })

  if (activeRun) {
    await prisma.webhookLog.create({
      data: {
        pipelineId: pipeline.id,
        sourceIp: String(sourceIp).slice(0, 100),
        userAgent: userAgent?.slice(0, 500),
        payload: payload as never,
        statusCode: 409,
        errorMsg: 'Конвейер уже запущен',
      },
    }).catch(() => {})
    throw createError({ statusCode: 409, message: 'Конвейер уже запущен' })
  }

  const run = await prisma.workflowRun.create({
    data: {
      pipelineId: pipeline.id,
      triggerType: 'webhook',
      status: 'pending',
    },
  })

  // Log successful webhook trigger
  await prisma.webhookLog.create({
    data: {
      pipelineId: pipeline.id,
      runId: run.id,
      sourceIp: String(sourceIp).slice(0, 100),
      userAgent: userAgent?.slice(0, 500),
      payload: payload as never,
      statusCode: 200,
    },
  }).catch(() => {})

  enqueueRun(run.id).catch(() => {})

  return {
    data: {
      runId: run.id,
      status: 'pending',
    },
  }
})
