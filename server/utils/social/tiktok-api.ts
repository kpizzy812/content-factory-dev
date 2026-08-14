/**
 * Низкоуровневый клиент TikTok Content Posting API (Direct Post).
 *
 * Вынесен отдельно от адаптера, потому что сам сценарий публикации (creator_info →
 * init → чанки → поллинг статуса) диктуется платформой и его нужно уметь
 * проверять тестом без сети: адаптер получает клиента через фабрику.
 *
 * Direct Post — единственный сценарий, при котором ролик реально появляется в
 * ленте. Inbox-эндпоинт (`/inbox/video/init/`) кладёт черновик в приложение и
 * ждёт, что человек опубликует его руками — для автопостинга он бесполезен.
 */

import { buildAiDisclosure } from "./ai-disclosure"

const TIKTOK_API_BASE = "https://open.tiktokapis.com"

/** Минимальный размер чанка по правилам TikTok. */
export const TIKTOK_MIN_CHUNK_BYTES = 5 * 1024 * 1024
/** Максимальный размер чанка по правилам TikTok. */
export const TIKTOK_MAX_CHUNK_BYTES = 64 * 1024 * 1024
/** Больше тысячи частей TikTok не принимает. */
export const TIKTOK_MAX_CHUNK_COUNT = 1000
/**
 * Рабочий размер чанка для больших файлов. Взят вдвое меньше максимума не из
 * вкуса: последний чанк добирает остаток и может вырасти почти вдвое, а
 * перевалить за 64 МБ ему нельзя.
 */
const TIKTOK_TARGET_CHUNK_BYTES = 32 * 1024 * 1024

export interface TikTokChunk {
  index: number
  /** Смещение первого байта чанка в файле. */
  start: number
  /** Смещение последнего байта чанка включительно — так же считает Content-Range. */
  end: number
  size: number
}

export interface TikTokChunkPlan {
  videoSize: number
  chunkSize: number
  totalChunkCount: number
  chunks: TikTokChunk[]
}

/**
 * Раскладывает файл на чанки по правилам TikTok.
 *
 * Файл до 64 МБ уходит одним куском. Дальше действует жёсткое правило платформы
 * `total_chunk_count = floor(video_size / chunk_size)`, поэтому последний чанк
 * забирает весь остаток, а не идёт отдельной короткой частью.
 */
export function planTikTokChunks(videoSize: number): TikTokChunkPlan {
  if (!Number.isFinite(videoSize) || videoSize <= 0) {
    throw new Error(`TikTok: некорректный размер видеофайла (${videoSize} байт)`)
  }

  if (videoSize <= TIKTOK_MAX_CHUNK_BYTES) {
    return {
      videoSize,
      chunkSize: videoSize,
      totalChunkCount: 1,
      chunks: [{ index: 0, start: 0, end: videoSize - 1, size: videoSize }],
    }
  }

  let chunkSize = TIKTOK_TARGET_CHUNK_BYTES
  // Файл-гигант: увеличиваем чанк, чтобы уложиться в лимит на число частей.
  if (Math.floor(videoSize / chunkSize) > TIKTOK_MAX_CHUNK_COUNT) {
    chunkSize = Math.min(
      TIKTOK_MAX_CHUNK_BYTES,
      Math.ceil(videoSize / TIKTOK_MAX_CHUNK_COUNT),
    )
  }
  chunkSize = Math.max(TIKTOK_MIN_CHUNK_BYTES, Math.min(TIKTOK_MAX_CHUNK_BYTES, chunkSize))

  const totalChunkCount = Math.max(1, Math.floor(videoSize / chunkSize))
  const chunks: TikTokChunk[] = []
  for (let index = 0; index < totalChunkCount; index++) {
    const start = index * chunkSize
    const end = index === totalChunkCount - 1 ? videoSize - 1 : start + chunkSize - 1
    chunks.push({ index, start, end, size: end - start + 1 })
  }

  return { videoSize, chunkSize, totalChunkCount, chunks }
}

/** Уровни приватности, которые TikTok возвращает в creator_info. */
export const TIKTOK_PUBLIC_PRIVACY_LEVEL = "PUBLIC_TO_EVERYONE"

/**
 * Выбирает уровень приватности: запрошенный оператором — только если платформа
 * разрешила его этому аккаунту. У неаудированных приложений список состоит из
 * одного `SELF_ONLY`, и молча публиковать «в общий доступ» там нельзя.
 */
export function resolveTikTokPrivacyLevel(
  requested: string | null | undefined,
  options: string[],
): string {
  const allowed = options.filter(option => typeof option === "string" && option.length > 0)
  if (allowed.length === 0) {
    throw new Error(
      "TikTok: creator_info не вернул допустимые уровни приватности — "
        + "переподключите аккаунт через OAuth со scope video.publish",
    )
  }

  const wanted = String(requested ?? "").trim().toUpperCase()
  if (wanted) {
    if (!allowed.includes(wanted)) {
      throw new Error(
        `TikTok: уровень приватности ${wanted} недоступен этому аккаунту. `
          + `Разрешены: ${allowed.join(", ")}`,
      )
    }
    return wanted
  }

  if (allowed.includes(TIKTOK_PUBLIC_PRIVACY_LEVEL)) return TIKTOK_PUBLIC_PRIVACY_LEVEL

  // Подставлять allowed[0] нельзя: у неаудированного приложения это SELF_ONLY,
  // и ролик, который видит только автор, уезжал в published с алертом «Видео
  // загружено». Молчаливая «публикация в никуда» хуже явного отказа.
  throw new Error(
    `TikTok: аккаунту недоступен уровень ${TIKTOK_PUBLIC_PRIVACY_LEVEL} (разрешены: ${allowed.join(", ")}). `
      + "Обычно это значит, что приложение ещё не прошло аудит TikTok и публиковать «в общий доступ» нельзя. "
      + "Если ролик нужен непубличным — задайте privacyLevel в настройках загрузки явно.",
  )
}

export interface TikTokCreatorInfo {
  username: string | null
  nickname: string | null
  privacyLevelOptions: string[]
  maxVideoPostDurationSec: number | null
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
}

export interface TikTokPostInfo {
  title: string
  privacyLevel: string
  disableComment: boolean
  disableDuet: boolean
  disableStitch: boolean
  videoCoverTimestampMs: number
  /**
   * Раскрытие AI-происхождения (`post_info.is_aigc`). Наши ролики синтетические
   * по построению; поле обязательно с 02.08.2026 для аудитории в EU.
   */
  isAiGenerated?: boolean
}

export interface TikTokInitResult {
  publishId: string
  uploadUrl: string
}

export type TikTokPublishStatusCode =
  | "PROCESSING_UPLOAD"
  | "PROCESSING_DOWNLOAD"
  | "PUBLISH_COMPLETE"
  | "SEND_TO_USER_INBOX"
  | "FAILED"

export interface TikTokPublishStatus {
  status: TikTokPublishStatusCode | string
  failReason: string | null
  /** В API поле называется publicaly_available_post_id и приходит массивом. */
  postIds: string[]
}

export interface TikTokVideoStats {
  id: string
  viewCount: number
  likeCount: number
  commentCount: number
  shareCount: number
}

export interface TikTokApiClient {
  queryCreatorInfo(): Promise<TikTokCreatorInfo>
  initDirectPost(input: { postInfo: TikTokPostInfo; plan: TikTokChunkPlan }): Promise<TikTokInitResult>
  uploadChunk(input: {
    uploadUrl: string
    body: Uint8Array
    chunk: TikTokChunk
    videoSize: number
  }): Promise<void>
  fetchPublishStatus(publishId: string): Promise<TikTokPublishStatus>
  queryVideos(videoIds: string[]): Promise<TikTokVideoStats[]>
}

export type TikTokFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

interface CreateTikTokApiClientOptions {
  accessToken: string
  fetchImpl?: TikTokFetch
  baseUrl?: string
}

export class TikTokApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly logId?: string,
  ) {
    super(message)
    this.name = "TikTokApiError"
  }
}

/**
 * Человеческое объяснение отказов доступа.
 *
 * TikTok на нехватку scope отвечает так же сухо, как на «нет такого видео», и
 * в логе сборщика метрик это выглядит удалённым постом, а не аккаунтом, который
 * надо переподключить.
 */
function explainTikTokError(code: string | undefined, message: string): string {
  if (code === "scope_not_authorized") {
    return `${message} — токену не выдан нужный scope. Переподключите аккаунт через OAuth `
      + "(для счётчиков нужен video.list, для публикации — video.publish и video.upload)."
  }
  if (code === "access_token_invalid" || code === "token_expired") {
    return `${message} — токен TikTok недействителен, аккаунт нужно переподключить через OAuth.`
  }
  return message
}

/**
 * Счётчик из ответа Display API.
 *
 * Раньше отсутствующее поле молча превращалось в 0, а такой ноль в отчёте не
 * отличить от честного «никто не посмотрел». Причина пропажи всегда наша
 * (не тот scope, поле не запрошено в fields), поэтому лучше явная ошибка:
 * она попадёт в errors сборщика, а не в PostMetrics под видом данных.
 */
function requireCount(videoId: string, field: string, value: unknown): number {
  const numeric = Number(value)
  if (value === null || value === undefined || value === "" || !Number.isFinite(numeric)) {
    throw new Error(
      `TikTok: Display API не вернул ${field} для видео ${videoId}. `
        + "Записать 0 нельзя — его не отличить от настоящего нуля просмотров. "
        + "Обычно это значит, что поле не попало в fields запроса или токену не выдан "
        + "scope video.list — переподключите аккаунт через OAuth.",
    )
  }
  return numeric
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

export function createTikTokApiClient({
  accessToken,
  fetchImpl = fetch,
  baseUrl = TIKTOK_API_BASE,
}: CreateTikTokApiClientOptions): TikTokApiClient {
  if (!accessToken) throw new Error("TikTok: не передан access token")
  const base = baseUrl.replace(/\/+$/, "")

  async function post<T>(path: string, body: unknown, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${base}${path}`)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)

    let response: Response
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          // TikTok требует явную кодировку, иначе режет юникод в title.
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(body ?? {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "сетевая ошибка"
      throw new TikTokApiError(`TikTok API недоступен: ${message}`, 0)
    }

    const text = await response.text()
    let payload: Record<string, unknown> = {}
    if (text) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>
      } catch {
        throw new TikTokApiError(
          `TikTok API вернул не-JSON (HTTP ${response.status})`,
          response.status,
        )
      }
    }

    const error = payload.error as { code?: string; message?: string; log_id?: string } | undefined
    const failed = !response.ok || (error?.code && error.code !== "ok")
    if (failed) {
      throw new TikTokApiError(
        explainTikTokError(error?.code, `TikTok API: ${error?.message || `HTTP ${response.status}`}`),
        response.status,
        error?.code,
        error?.log_id,
      )
    }
    return payload as T
  }

  return {
    async queryCreatorInfo() {
      const response = await post<{
        data?: {
          creator_username?: string
          creator_nickname?: string
          privacy_level_options?: unknown
          max_video_post_duration_sec?: unknown
          comment_disabled?: boolean
          duet_disabled?: boolean
          stitch_disabled?: boolean
        }
      }>("/v2/post/publish/creator_info/query/", {})
      const data = response.data ?? {}
      return {
        username: data.creator_username || null,
        nickname: data.creator_nickname || null,
        privacyLevelOptions: stringArray(data.privacy_level_options),
        maxVideoPostDurationSec: Number.isFinite(Number(data.max_video_post_duration_sec))
          ? Number(data.max_video_post_duration_sec)
          : null,
        commentDisabled: Boolean(data.comment_disabled),
        duetDisabled: Boolean(data.duet_disabled),
        stitchDisabled: Boolean(data.stitch_disabled),
      }
    },

    async initDirectPost({ postInfo, plan }) {
      const response = await post<{ data?: { publish_id?: string; upload_url?: string } }>(
        "/v2/post/publish/video/init/",
        {
          post_info: {
            title: postInfo.title,
            privacy_level: postInfo.privacyLevel,
            disable_comment: postInfo.disableComment,
            disable_duet: postInfo.disableDuet,
            disable_stitch: postInfo.disableStitch,
            video_cover_timestamp_ms: postInfo.videoCoverTimestampMs,
            ...buildAiDisclosure("tiktok", postInfo.isAiGenerated ?? true),
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: plan.videoSize,
            chunk_size: plan.chunkSize,
            total_chunk_count: plan.totalChunkCount,
          },
        },
      )
      const publishId = response.data?.publish_id
      const uploadUrl = response.data?.upload_url
      if (!publishId || !uploadUrl) {
        throw new Error("TikTok: init не вернул publish_id/upload_url")
      }
      return { publishId, uploadUrl }
    },

    async uploadChunk({ uploadUrl, body, chunk, videoSize }) {
      let response: Response
      try {
        response = await fetchImpl(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(chunk.size),
            "Content-Range": `bytes ${chunk.start}-${chunk.end}/${videoSize}`,
          },
          // Приведение типа: у Node-типов Uint8Array и BodyInit разъезжаются
          // ArrayBufferLike-параметры, хотя undici буфер принимает как есть.
          body: body as unknown as BodyInit,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "сетевая ошибка"
        throw new TikTokApiError(`TikTok: чанк ${chunk.index + 1} не загрузился: ${message}`, 0)
      }
      // 201 приходит на последний чанк, 206 — на промежуточные.
      if (!response.ok && response.status !== 206) {
        throw new TikTokApiError(
          `TikTok: чанк ${chunk.index + 1} отклонён (HTTP ${response.status})`,
          response.status,
        )
      }
    },

    async fetchPublishStatus(publishId) {
      const response = await post<{
        data?: {
          status?: string
          fail_reason?: string
          publicaly_available_post_id?: unknown
          publically_available_post_id?: unknown
        }
      }>("/v2/post/publish/status/fetch/", { publish_id: publishId })
      const data = response.data ?? {}
      // Опечатку в имени поля TikTok допустил сам; на всякий случай читаем оба.
      const rawIds = data.publicaly_available_post_id ?? data.publically_available_post_id
      const postIds = Array.isArray(rawIds)
        ? rawIds.map(item => String(item)).filter(Boolean)
        : []
      return {
        status: data.status || "UNKNOWN",
        failReason: data.fail_reason || null,
        postIds,
      }
    },

    async queryVideos(videoIds) {
      const response = await post<{
        data?: {
          videos?: Array<{
            id?: string
            view_count?: unknown
            like_count?: unknown
            comment_count?: unknown
            share_count?: unknown
          }>
        }
      }>(
        "/v2/video/query/",
        { filters: { video_ids: videoIds } },
        // fields обязателен: без него TikTok отдаёт пустые объекты видео.
        { fields: "id,view_count,like_count,comment_count,share_count" },
      )
      return (response.data?.videos ?? []).map((video, index) => {
        // Запись без id привязать не к чему: раньше она превращалась в видео с
        // пустым id и могла уехать в метрики как «первый элемент ответа».
        const id = video.id === null || video.id === undefined ? "" : String(video.id)
        if (!id) {
          throw new Error(
            `TikTok: Display API вернул запись ${index + 1} без id — `
              + "привязать счётчики к ролику невозможно, ответ платформы неполный.",
          )
        }
        return {
          id,
          viewCount: requireCount(id, "view_count", video.view_count),
          likeCount: requireCount(id, "like_count", video.like_count),
          commentCount: requireCount(id, "comment_count", video.comment_count),
          shareCount: requireCount(id, "share_count", video.share_count),
        }
      })
    },
  }
}
