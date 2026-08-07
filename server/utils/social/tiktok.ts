import { open, stat } from "node:fs/promises"
import {
  createTikTokApiClient,
  planTikTokChunks,
  resolveTikTokPrivacyLevel,
  TIKTOK_PUBLIC_PRIVACY_LEVEL,
  type TikTokApiClient,
  type TikTokChunk,
  type TikTokCreatorInfo,
} from "./tiktok-api"
import { PostUnavailableError } from "./post-availability"
import { decideTikTokPoll, resolveTikTokPublishOutcome } from "./tiktok-publish-flow"
import type {
  DecryptedAccount,
  MetricsContext,
  MetricsResult,
  SocialPlatformAdapter,
  UploadParams,
  UploadResult,
} from "./types"

const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
const DEFAULT_POLL_INTERVAL_MS = 5_000
/** Обработка ролика на стороне TikTok редко длится дольше — дальше это зависание. */
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000
/**
 * Сколько ждём возобновлённую публикацию, всё ещё принимающую файл.
 * Заливка в прошлой попытке уже завершилась (иначе publish_id не был бы
 * сохранён), поэтому минуты хватает: дальше это не обработка, а тупик.
 */
const DEFAULT_RESUME_STUCK_TIMEOUT_MS = 60_000
/** Лимит подписи к видео у TikTok. */
const TIKTOK_CAPTION_LIMIT = 2_200

/**
 * Обновляет access token через refresh token.
 */
async function refreshAccessToken(account: DecryptedAccount): Promise<string> {
  if (!account.refreshToken) {
    throw new Error(`TikTok аккаунт ${account.displayName}: отсутствует refresh token`)
  }

  const response = await $fetch<{
    access_token: string
    expires_in: number
    refresh_token: string
  }>(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY || "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET || "",
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }).toString(),
  })

  const newExpiresAt = new Date(Date.now() + response.expires_in * 1000)
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encrypt(response.access_token),
      refreshToken: encrypt(response.refresh_token),
      expiresAt: newExpiresAt,
    },
  })

  return response.access_token
}

/**
 * Получает актуальный access token, обновляя при необходимости.
 */
async function getValidAccessToken(account: DecryptedAccount): Promise<string> {
  if (!account.accessToken && !account.refreshToken) {
    throw new Error(
      // Совет про Indigo browser automation отсюда убран намеренно: это
      // унаследованный контур, запрещённый в основном пути (PROJECT_CONTEXT §4).
      // Из белого адаптера остаётся ровно одно законное действие — OAuth.
      `TikTok аккаунт ${account.displayName}: создан вручную (manual), OAuth-токены отсутствуют. ` +
        `Публикация и сбор метрик через TikTok API недоступны — подключите аккаунт ` +
        `через официальный OAuth TikTok (scope video.list, video.publish, video.upload).`,
    )
  }

  const isExpired = account.expiresAt && account.expiresAt.getTime() < Date.now() + 60_000

  if (isExpired || !account.accessToken) {
    return refreshAccessToken(account)
  }

  return account.accessToken
}

export interface TikTokUploadOptions {
  privacyLevel: string | null
  disableComment: boolean
  disableDuet: boolean
  disableStitch: boolean
  coverTimestampMs: number
}

/** Разбирает `platformOptions.tiktok` — на входе Json из БД, доверять ему нельзя. */
export function tiktokOptions(params: UploadParams): TikTokUploadOptions {
  const root = params.platformOptions
  const raw = root && typeof root === "object"
    ? (root as Record<string, unknown>).tiktok
    : undefined
  const config = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const cover = Number(config.coverTimestampMs)
  return {
    privacyLevel: typeof config.privacyLevel === "string" && config.privacyLevel.trim()
      ? config.privacyLevel.trim().toUpperCase()
      : null,
    disableComment: config.disableComment === true,
    disableDuet: config.disableDuet === true,
    disableStitch: config.disableStitch === true,
    coverTimestampMs: Number.isFinite(cover) && cover >= 0 ? Math.round(cover) : 1_000,
  }
}

/**
 * Подпись к ролику. У TikTok нет отдельных title и description — в ленте
 * показывается один текст, поэтому склеиваем всё и режем по лимиту платформы.
 */
export function buildTikTokCaption(params: UploadParams): string {
  const hashtags = params.hashtags
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => (value.startsWith("#") ? value : `#${value}`))
    .join(" ")
  const caption = [params.title.trim(), (params.description || "").trim(), hashtags]
    .filter(Boolean)
    .join("\n")
    .trim()
  return caption.slice(0, TIKTOK_CAPTION_LIMIT)
}

/**
 * Похоже ли значение на публичный id поста TikTok.
 *
 * Нужно, чтобы не объявить удалённым пост, которого у нас никогда и не было:
 * publish_id выглядит иначе (`v_pub_file~v2.123…`) и попадает в platformPostId,
 * когда публичный id не разрезолвился за отведённые опросы статуса. Пустой
 * ответ Display API на такой «id» — наша недоделка публикации, а не удаление.
 */
export function looksLikeTikTokPostId(value: string): boolean {
  return /^\d{6,}$/.test(value.trim())
}

/** Публичный URL поста. Без username его собрать нельзя — врать не будем. */
export function buildTikTokPostUrl(username: string | null, postId: string): string {
  if (!username || !postId) return ""
  return `https://www.tiktok.com/@${username}/video/${postId}`
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Читает один чанк с диска. Целиком файл в память не берём: ролик может весить
 * гигабайты, а поднимаем мы их пачками в одном процессе.
 */
async function defaultReadChunk(filePath: string, chunk: TikTokChunk): Promise<Uint8Array> {
  const handle = await open(filePath, "r")
  try {
    const buffer = Buffer.alloc(chunk.size)
    const { bytesRead } = await handle.read(buffer, 0, chunk.size, chunk.start)
    if (bytesRead !== chunk.size) {
      throw new Error(
        `TikTok: файл ${filePath} короче ожидаемого (чанк ${chunk.index + 1}: ${bytesRead}/${chunk.size} байт)`,
      )
    }
    return buffer
  } finally {
    await handle.close()
  }
}

interface CreateTikTokAdapterOptions {
  fetchImpl?: typeof fetch
  clientFactory?: (accessToken: string) => TikTokApiClient
  getAccessToken?: (account: DecryptedAccount) => Promise<string>
  fileSize?: (filePath: string) => Promise<number>
  readChunk?: (filePath: string, chunk: TikTokChunk) => Promise<Uint8Array>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  pollIntervalMs?: number
  pollTimeoutMs?: number
  resumeStuckTimeoutMs?: number
}

/**
 * TikTok Content Posting API, сценарий Direct Post:
 * creator_info → init → загрузка чанков → поллинг статуса публикации.
 */
export function createTikTokAdapter({
  fetchImpl,
  clientFactory = accessToken => createTikTokApiClient({ accessToken, fetchImpl }),
  getAccessToken = getValidAccessToken,
  fileSize = async filePath => (await stat(filePath)).size,
  readChunk = defaultReadChunk,
  sleep = defaultSleep,
  now = Date.now,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  resumeStuckTimeoutMs = DEFAULT_RESUME_STUCK_TIMEOUT_MS,
}: CreateTikTokAdapterOptions = {}): SocialPlatformAdapter {
  return {
    async uploadVideo(account: DecryptedAccount, params: UploadParams): Promise<UploadResult> {
      const accessToken = await getAccessToken(account)
      const client = clientFactory(accessToken)

      // Пост уже опубликован в прошлой попытке — второй раз публиковать нельзя.
      if (params.resume?.postId) {
        return {
          platformPostId: params.resume.postId,
          platformPostUrl: params.resume.postUrl ?? "",
        }
      }

      let creatorInfo: TikTokCreatorInfo | null = null
      const options = tiktokOptions(params)
      let publishId = params.resume?.containerId ?? null
      const resumed = Boolean(publishId)
      // На пути возобновления creator_info заново не спрашиваем, поэтому уровень
      // берём из зафиксированных настроек загрузки. Пустой выбор оператора теперь
      // означает ровно «в общий доступ»: подставить SELF_ONLY молча уже нельзя.
      let privacyLevel = options.privacyLevel ?? TIKTOK_PUBLIC_PRIVACY_LEVEL

      if (!publishId) {
        creatorInfo = await client.queryCreatorInfo()
        privacyLevel = resolveTikTokPrivacyLevel(
          options.privacyLevel,
          creatorInfo.privacyLevelOptions,
        )

        const videoSize = await fileSize(params.filePath)
        const plan = planTikTokChunks(videoSize)

        const init = await client.initDirectPost({
          postInfo: {
            title: buildTikTokCaption(params),
            privacyLevel,
            // Запреты аккаунта сильнее настроек оператора: TikTok отклонит
            // публикацию, если разрешить то, что творцу запрещено.
            disableComment: options.disableComment || creatorInfo.commentDisabled,
            disableDuet: options.disableDuet || creatorInfo.duetDisabled,
            disableStitch: options.disableStitch || creatorInfo.stitchDisabled,
            videoCoverTimestampMs: options.coverTimestampMs,
          },
          plan,
        })
        publishId = init.publishId

        for (const chunk of plan.chunks) {
          const body = await readChunk(params.filePath, chunk)
          await client.uploadChunk({
            uploadUrl: init.uploadUrl,
            body,
            chunk,
            videoSize: plan.videoSize,
          })
        }

        // publish_id сохраняем только сейчас, после последнего чанка. Раньше он
        // уходил наружу сразу после init, и обрыв на середине заливки делал
        // публикацию невосстановимой: ретрай возобновлялся по этому id, минуя и
        // init, и загрузку, а дослать чанки некуда — upload_url нигде не хранится.
        await params.onProgress?.({ containerId: publishId })
      }

      // Поллинг статуса: до него пост в ленте не появился и id у него нет.
      const startedAt = now()
      const deadline = startedAt + pollTimeoutMs
      const stuckUploadDeadline = startedAt + resumeStuckTimeoutMs
      let status = await client.fetchPublishStatus(publishId)
      for (;;) {
        const decision = decideTikTokPoll({
          publishId,
          status: status.status,
          failReason: status.failReason,
          resumed,
          now: now(),
          deadline,
          stuckUploadDeadline,
        })
        if (decision.action === "complete") break
        if (decision.action === "fail") throw new Error(decision.message)
        await sleep(pollIntervalMs)
        status = await client.fetchPublishStatus(publishId)
      }

      const outcome = resolveTikTokPublishOutcome({
        publishId,
        postIds: status.postIds,
        privacyLevel,
      })
      if (outcome.kind === "incomplete") {
        throw new Error(outcome.message)
      }
      if (outcome.kind === "restricted") {
        // Непубличный уровень оператор выбрал сам: публичного id у такого поста
        // нет. Подсовывать publish_id в URL нельзя — ссылка будет битой.
        return { platformPostId: publishId, platformPostUrl: "" }
      }
      const postId = outcome.postId

      if (!creatorInfo) {
        // Путь ретрая: username нужен только для ссылки, поэтому его отсутствие
        // не должно рушить уже успешную публикацию.
        creatorInfo = await client.queryCreatorInfo().catch(() => null)
      }
      const postUrl = buildTikTokPostUrl(creatorInfo?.username ?? null, postId)
      await params.onProgress?.({ postId, postUrl })

      return { platformPostId: postId, platformPostUrl: postUrl }
    },

    async getPostMetrics(
      account: DecryptedAccount,
      platformPostId: string,
      _context?: MetricsContext,
    ): Promise<MetricsResult> {
      const accessToken = await getAccessToken(account)
      const client = clientFactory(accessToken)

      const videos = await client.queryVideos([platformPostId])
      // Только точное совпадение id. Фолбэка на videos[0] здесь больше нет: он
      // подставлял счётчики ЧУЖОГО ролика в PostMetrics этой загрузки. Штатный
      // путь к такой порче — в platformPostId лежит publish_id (настоящий id
      // поста не разрезолвился за отведённые опросы статуса), Display API по
      // нему ничего не находит и отдаёт что-то своё.
      const video = videos.find(item => item.id === platformPostId)
      if (!video) {
        // Пустой или «не тот» ответ Display API чаще означает не «ролик удалён»,
        // а publish_id вместо id поста либо токен без scope video.list.
        const returned = videos.map(item => item.id).filter(Boolean)

        // Единственный случай, когда пустоту можно читать как удаление: спросили
        // про настоящий id поста, запрос прошёл (нет scope и протухший токен
        // приходят ошибкой TikTokApiError выше), и площадка не вернула ничего.
        if (returned.length === 0 && looksLikeTikTokPostId(platformPostId)) {
          throw new PostUnavailableError(
            "deleted",
            `TikTok: видео ${platformPostId} не найдено в Display API этого аккаунта `
              + "и запрос при этом прошёл — публикация помечена удалённой",
          )
        }

        throw new Error(
          `TikTok: видео ${platformPostId} не найдено в Display API`
            + (returned.length ? ` (в ответе пришли другие id: ${returned.join(", ")})` : "")
            + ". Частая причина — в platformPostId сохранён publish_id, а не id поста: "
            + "публичный id не разрезолвился за отведённые опросы статуса публикации. "
            + "Ещё проверьте, что пост публичный, а аккаунт подключён со scope video.list "
            + "(без него счётчики недоступны — переподключите аккаунт через OAuth). "
            + "Брать счётчики первого попавшегося ролика из ответа нельзя — это чужие числа.",
        )
      }

      return {
        views: video.viewCount,
        likes: video.likeCount,
        comments: video.commentCount,
        shares: video.shareCount,
        // Display API не отдаёт время просмотра — считать досматриваемость не из чего.
        watchThrough: 0,
        ctr: 0,
        followerGain: 0,
        unsupported: ["watchThrough"],
      }
    },
  }
}

export const tiktokAdapter = createTikTokAdapter()
