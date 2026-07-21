interface MubertResponse {
  data?: {
    tasks?: Array<{
      task_id?: string
      status?: string
      download_link?: string
    }>
  }
  status?: string | number
  error?: string | { message?: string; code?: number | string }
}

const MUBERT_API_URL = "https://api-b2b.mubert.com/v2/RecordTrackTTM"

const REQUEST_TIMEOUT_MS = 60_000
const RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1500
const POLL_ATTEMPTS = 6
const POLL_DELAY_MS = 5000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function backoffDelay(attempt: number): number {
  const exp = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
  const jitter = Math.floor(Math.random() * 400)
  return Math.min(15_000, exp) + jitter
}

function extractError(response: MubertResponse | null): string | null {
  if (!response) return 'empty response'
  if (response.error) {
    if (typeof response.error === 'string') return response.error
    return response.error.message || `error code ${response.error.code ?? '?'}`
  }
  if (response.status && response.status !== 'ok' && response.status !== 200) {
    return `status=${response.status}`
  }
  return null
}

async function callMubert(mubertKey: string, mood: string, durationSec: number): Promise<MubertResponse> {
  return await $fetch<MubertResponse>(MUBERT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: {
      method: "RecordTrackTTM",
      params: {
        pat: mubertKey,
        duration: durationSec,
        tags: [mood],
        mode: "track",
        maxit: 20,
        bitrate: 192,
        format: "mp3",
      },
    },
    timeout: REQUEST_TIMEOUT_MS,
  })
}

/**
 * Генерирует музыкальный трек через Mubert API.
 *
 * Ретраи и polling: Mubert RecordTrackTTM иногда отвечает task без download_link
 * (status='processing') — нужно опросить тот же endpoint повторно. Также бывают
 * transient 429/5xx и сетевые ошибки. Возвращает URL трека или null с явным
 * warn-логом причины (раньше любая ошибка молча давала null → видео без музыки
 * без диагностики).
 */
export async function generateMusic(mood: string, durationSec: number): Promise<string | null> {
  if (process.env.ENABLE_PAID_APIS !== "true") {
    console.warn('[mubert] skipped: ENABLE_PAID_APIS != "true" — музыка не будет сгенерирована')
    return null
  }

  const mubertKey = process.env.MUBERT_KEY || ""
  if (!mubertKey) {
    console.warn('[mubert] skipped: MUBERT_KEY не задан — музыка не будет сгенерирована')
    return null
  }

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      let response = await callMubert(mubertKey, mood, durationSec)
      let downloadUrl = response?.data?.tasks?.[0]?.download_link

      // Polling: если ответ есть, но download_link ещё не готов — ждём генерацию.
      // Mubert обычно завершает за 5-30с, опрашиваем до POLL_ATTEMPTS×POLL_DELAY_MS.
      if (!downloadUrl) {
        const errMsg = extractError(response)
        if (errMsg) {
          throw new Error(`Mubert API error: ${errMsg}`)
        }
        for (let pollIdx = 1; pollIdx <= POLL_ATTEMPTS && !downloadUrl; pollIdx++) {
          await sleep(POLL_DELAY_MS)
          response = await callMubert(mubertKey, mood, durationSec)
          downloadUrl = response?.data?.tasks?.[0]?.download_link
          if (!downloadUrl) {
            const status = response?.data?.tasks?.[0]?.status
            console.warn(`[mubert] poll ${pollIdx}/${POLL_ATTEMPTS}: status=${status ?? 'unknown'}, ждём download_link`)
          }
        }
      }

      if (!downloadUrl) {
        console.warn(`[mubert] attempt ${attempt}/${RETRY_ATTEMPTS}: download_link не появился после ${POLL_ATTEMPTS} опросов`)
        if (attempt < RETRY_ATTEMPTS) {
          const delay = backoffDelay(attempt)
          await sleep(delay)
          continue
        }
        return null
      }

      return downloadUrl
    }
    catch (err) {
      const status = (err as { response?: { status?: number }; statusCode?: number })?.response?.status
        ?? (err as { statusCode?: number })?.statusCode
      const message = (err as { message?: string })?.message ?? 'unknown error'
      console.warn(
        `[mubert] attempt ${attempt}/${RETRY_ATTEMPTS} failed (status=${status ?? 'n/a'}): ${message}`,
      )
      if (attempt < RETRY_ATTEMPTS) {
        const delay = backoffDelay(attempt)
        await sleep(delay)
        continue
      }
      return null
    }
  }

  return null
}
