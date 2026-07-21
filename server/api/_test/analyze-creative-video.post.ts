/**
 * Test-only обёртка над analyzeCreativeVideo() для integration-тестов.
 *
 * Гейт идентичный _test/cleanup.post.ts:
 *   - NODE_ENV !== production
 *   - TEST_AUTH_BYPASS === "1"
 *   - x-test-auth-token совпадает с TEST_AUTH_TOKEN
 *
 * Без этого endpoint orchestrator невозможно протестировать через @nuxt/test-utils:
 * direct-import в vitest падает на runtime config (Nitro context недоступен
 * в родительском процессе vitest), а через $fetch уже идёт в Nitro где config
 * инициализирован.
 */
import { analyzeCreativeVideo } from '~~/server/utils/video-content-analyzer'

interface Body {
  videoId: number
  force?: boolean
  framePassVersion?: string
  appName?: string | null
  appAudience?: string | null
  appGeo?: string | null
}

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }
  if (process.env.TEST_AUTH_BYPASS !== '1') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }
  const headerToken = getHeader(event, 'x-test-auth-token')
  if (!headerToken || headerToken !== process.env.TEST_AUTH_TOKEN) {
    throw createError({ statusCode: 403, message: 'Test bypass token mismatch' })
  }

  const body = await readBody<Body>(event)
  if (!body || typeof body.videoId !== 'number') {
    throw createError({ statusCode: 400, message: 'videoId is required (number)' })
  }

  try {
    const result = await analyzeCreativeVideo(body.videoId, {
      force: body.force,
      framePassVersion: body.framePassVersion,
      appName: body.appName,
      appAudience: body.appAudience,
      appGeo: body.appGeo,
    })
    return { ok: true, result }
  }
  catch (err) {
    return {
      ok: false,
      error: (err as Error).message,
    }
  }
})
