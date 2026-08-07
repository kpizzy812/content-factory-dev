import {
  createInstagramApiClient,
  refreshInstagramLongLivedToken,
  type InstagramApiClient,
  type InstagramMediaInsights,
  type InstagramTrialStrategy,
} from "./instagram-api"
import { resolvePublicMediaUrl } from "./public-media"
import { recordPublishingLimit } from "./publishing-limit"
import type {
  DecryptedAccount,
  MetricsResult,
  SocialPlatformAdapter,
  UploadParams,
  UploadResult,
} from "./types"

const TOKEN_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_POLL_TIMEOUT_MS = 20 * 60 * 1000

type InstagramPublishMode = "reel" | "trial_manual" | "trial_auto"

interface CreateInstagramAdapterOptions {
  clientFactory?: (accessToken: string) => InstagramApiClient
  getAccessToken?: (account: DecryptedAccount) => Promise<string>
  resolveMediaUrl?: (params: UploadParams) => Promise<string>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

function instagramOptions(params: UploadParams): {
  publishMode: InstagramPublishMode
  shareToFeed: boolean
} {
  const root = params.platformOptions
  const raw = root && typeof root === "object"
    ? (root as Record<string, unknown>).instagram
    : undefined
  const config = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const publishMode = ["reel", "trial_manual", "trial_auto"].includes(String(config.publishMode))
    ? String(config.publishMode) as InstagramPublishMode
    : "reel"
  return {
    publishMode,
    shareToFeed: publishMode === "reel" && config.shareToFeed !== false,
  }
}

function trialStrategy(mode: InstagramPublishMode): InstagramTrialStrategy | undefined {
  if (mode === "trial_manual") return "MANUAL"
  if (mode === "trial_auto") return "SS_PERFORMANCE"
  return undefined
}

function buildCaption(params: UploadParams): string {
  const hashtags = params.hashtags
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => value.startsWith("#") ? value : `#${value}`)
    .join(" ")
  const caption = [params.title.trim(), params.description.trim(), hashtags]
    .filter(Boolean)
    .join("\n")
  if (caption.length > 2_200) {
    throw new Error(`Instagram caption exceeds 2200 characters (${caption.length})`)
  }
  return caption
}

async function getValidInstagramAccessToken(account: DecryptedAccount): Promise<string> {
  if (!account.accessToken) {
    throw new Error(
      `Instagram account ${account.displayName} has no OAuth token. Reconnect it through Instagram OAuth.`,
    )
  }

  const now = Date.now()
  const expiresAt = account.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY
  if (expiresAt > now + TOKEN_REFRESH_WINDOW_MS) return account.accessToken

  try {
    const refreshed = await refreshInstagramLongLivedToken(account.accessToken)
    const nextExpiresAt = new Date(now + refreshed.expiresIn * 1000)
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        accessToken: encrypt(refreshed.accessToken),
        expiresAt: nextExpiresAt,
        status: "active",
      },
    })
    return refreshed.accessToken
  } catch (error) {
    if (expiresAt > now + 60_000) return account.accessToken
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { status: "expired" },
    }).catch(() => {})
    const message = error instanceof Error ? error.message : "unknown refresh error"
    throw new Error(`Instagram OAuth token expired; reconnect the account. ${message}`)
  }
}

async function defaultResolveMediaUrl(params: UploadParams): Promise<string> {
  return resolvePublicMediaUrl({
    storageKey: params.storageKey,
    filePath: params.filePath,
    fileUrl: params.fileUrl,
  })
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createInstagramAdapter({
  clientFactory = accessToken => createInstagramApiClient({ accessToken }),
  getAccessToken = getValidInstagramAccessToken,
  resolveMediaUrl = defaultResolveMediaUrl,
  sleep = defaultSleep,
  now = Date.now,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
}: CreateInstagramAdapterOptions = {}): SocialPlatformAdapter {
  return {
    async uploadVideo(account: DecryptedAccount, params: UploadParams): Promise<UploadResult> {
      if (!account.platformUserId) {
        throw new Error(
          `Instagram account ${account.displayName} has no professional account id. Reconnect it through OAuth.`,
        )
      }
      const accessToken = await getAccessToken(account)
      const client = clientFactory(accessToken)

      if (params.resume?.postId) {
        const media = await client.getMedia(params.resume.postId)
        return {
          platformPostId: media.id,
          platformPostUrl: media.permalink ?? params.resume.postUrl ?? "",
        }
      }

      const limit = await client.getPublishingLimit(account.platformUserId)
      // Замер сохраняется независимо от того, разрешена публикация или нет:
      // «квота исчерпана» — это тоже состояние, которое нужно видеть в списке.
      await recordPublishingLimit(account.id, limit)
      if (
        limit.quotaUsage !== null
        && limit.quotaTotal !== null
        && limit.quotaUsage >= limit.quotaTotal
      ) {
        throw new Error(
          `Instagram publishing quota exhausted (${limit.quotaUsage}/${limit.quotaTotal})`,
        )
      }

      const videoUrl = await resolveMediaUrl(params)
      const caption = buildCaption(params)
      const options = instagramOptions(params)
      const deadline = now() + pollTimeoutMs
      let containerId = params.resume?.containerId ?? null
      let recreatedExpiredContainer = false

      const createContainer = async (): Promise<string> => {
        const id = await client.createReelContainer({
          userId: account.platformUserId!,
          videoUrl,
          caption,
          shareToFeed: options.shareToFeed,
          trialStrategy: trialStrategy(options.publishMode),
        })
        await params.onProgress?.({ containerId: id })
        return id
      }

      if (!containerId) containerId = await createContainer()

      while (true) {
        const container = await client.getContainerStatus(containerId)
        if (container.statusCode === "FINISHED") break
        if (container.statusCode === "ERROR") {
          throw new Error(`Instagram failed to process Reel: ${container.status || containerId}`)
        }
        if (container.statusCode === "EXPIRED") {
          if (recreatedExpiredContainer) {
            throw new Error(`Instagram media container expired twice: ${containerId}`)
          }
          recreatedExpiredContainer = true
          containerId = await createContainer()
          continue
        }
        if (now() >= deadline) {
          throw new Error(`Timed out waiting for Instagram media container ${containerId}`)
        }
        await sleep(pollIntervalMs)
      }

      const postId = await client.publishContainer(account.platformUserId, containerId)
      await params.onProgress?.({ postId })

      let postUrl = ""
      try {
        const media = await client.getMedia(postId)
        postUrl = media.permalink ?? ""
      } catch {
        // The media edge can be eventually consistent immediately after publish.
      }
      await params.onProgress?.({ postId, postUrl })
      return { platformPostId: postId, platformPostUrl: postUrl }
    },

    async getPostMetrics(
      account: DecryptedAccount,
      platformPostId: string,
    ): Promise<MetricsResult> {
      const accessToken = await getAccessToken(account)
      const client = clientFactory(accessToken)
      const media = await client.getMedia(platformPostId)
      const insights: InstagramMediaInsights = await client
        .getMediaInsights(platformPostId)
        .catch(() => ({}))
      return {
        views: insights.views ?? insights.plays ?? 0,
        likes: insights.likes ?? media.likeCount,
        comments: insights.comments ?? media.commentsCount,
        shares: insights.shares ?? 0,
        watchThrough: 0,
        ctr: 0,
        followerGain: 0,
      }
    },
  }
}

export const instagramAdapter = createInstagramAdapter()
