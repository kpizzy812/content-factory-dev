/**
 * POST /api/posting-jobs/bulk
 *
 * Массовое создание PostingJob для YouTube (Phase 3). Reuse createPostingJob
 * per pair — он уже идемпотентен по sha256(videoId:socialAccountId:scheduledAt).
 *
 * НЕ atomic transaction — partial success через 207 Multi-Status (но Nuxt не имеет
 * 207 в setResponseStatus, используем 200 с структурным { created, skipped }).
 * Atomic создаёт проблемы с идемпотентностью (нельзя SELECT existing в той же
 * транзакции) и блокирует UI при одной ошибке среди 50 пар.
 *
 * Limits:
 *   - BULK_PAIRS_LIMIT (50) пар per request
 *   - Snapshot per pair валидируется validateYoutubeSnapshot
 *   - scheduledAt должен попадать в [windowStart, windowEnd]
 *   - MIN_INTERVAL (4ч) per account на сервере (final guard)
 */

import type { Platform } from "~~/app/generated/prisma/client"
import { createPostingJob, defaultMaxAttemptsForMethod } from "~~/server/utils/posting/job-service"
import {
  BULK_PAIRS_LIMIT,
  MIN_INTERVAL_MS,
  validateMinInterval,
  validateScheduledInWindow,
} from "~~/server/utils/posting/bulk-scheduling"
import {
  validateYoutubeSnapshot,
  YoutubeSnapshotValidationError,
} from "~~/server/utils/posting/youtube-snapshot-validator"
import {
  validateInstagramSnapshot,
  InstagramSnapshotValidationError,
} from "~~/server/utils/posting/instagram-snapshot-validator"
import { assertOneToOneForBrowserAutomation } from "~~/server/utils/accounts/one-to-one-guard"
import type {
  BulkCreateRequest,
  BulkCreateResponse,
  BulkCreateSkippedPair,
  PostingJobDto,
} from "~~/shared/types/posting-job"

const ALL_PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube"]

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "social-upload",
  })

  const body = await readBody<BulkCreateRequest>(event)
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  if (typeof body.platform !== "string" || !ALL_PLATFORMS.includes(body.platform as Platform)) {
    throw createError({
      statusCode: 400,
      message: `Поле 'platform' обязательно. Допустимые: ${ALL_PLATFORMS.join(", ")}`,
    })
  }

  // Bulk поддерживает YouTube + Instagram (browser-automation платформы).
  // TikTok пока заблокирован (другой platform-options-контракт, не наша платформа).
  if (body.platform === "tiktok") {
    throw createError({
      statusCode: 400,
      message: "Bulk-create для TikTok пока не поддерживается. Доступны: YouTube, Instagram.",
    })
  }

  if (!Array.isArray(body.pairs) || body.pairs.length === 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'pairs' обязательно (непустой массив)",
    })
  }

  if (body.pairs.length > BULK_PAIRS_LIMIT) {
    throw createError({
      statusCode: 400,
      message: `Лимит пар на один bulk-запрос: ${BULK_PAIRS_LIMIT}. Передано: ${body.pairs.length}.`,
    })
  }

  if (typeof body.windowStart !== "string" || typeof body.windowEnd !== "string") {
    throw createError({
      statusCode: 400,
      message: "Поля 'windowStart' и 'windowEnd' обязательны (ISO строки)",
    })
  }
  const windowStartMs = new Date(body.windowStart).getTime()
  const windowEndMs = new Date(body.windowEnd).getTime()
  if (Number.isNaN(windowStartMs) || Number.isNaN(windowEndMs) || windowStartMs >= windowEndMs) {
    throw createError({
      statusCode: 400,
      message: "Окно [windowStart, windowEnd] невалидно",
    })
  }

  const minIntervalMs = body.minIntervalMs ?? MIN_INTERVAL_MS
  if (typeof minIntervalMs !== "number" || minIntervalMs < 60_000) {
    throw createError({
      statusCode: 400,
      message: "minIntervalMs должен быть числом ≥ 60000 (1 минута)",
    })
  }

  // Каждая пара должна иметь scheduledAt + socialAccountId + videoId
  for (const p of body.pairs) {
    if (
      typeof p.socialAccountId !== "number"
      || typeof p.videoId !== "number"
      || typeof p.scheduledAt !== "string"
      || !p.contentSnapshot
    ) {
      throw createError({
        statusCode: 400,
        message: "Каждая пара должна содержать socialAccountId, videoId, scheduledAt, contentSnapshot",
      })
    }
  }

  // Финальный guard: окно и MIN_INTERVAL (защита от клиентского бага)
  const oob = validateScheduledInWindow(
    body.pairs.map((p) => ({
      socialAccountId: p.socialAccountId,
      videoId: p.videoId,
      scheduledAt: p.scheduledAt,
    })),
    windowStartMs,
    windowEndMs,
  )
  if (oob) {
    throw createError({
      statusCode: 400,
      message: `Пара (acc=${oob.socialAccountId}, video=${oob.videoId}) scheduledAt=${oob.scheduledAt} вне окна`,
    })
  }
  const conflict = validateMinInterval(
    body.pairs.map((p) => ({
      socialAccountId: p.socialAccountId,
      videoId: p.videoId,
      scheduledAt: p.scheduledAt,
    })),
    minIntervalMs,
  )
  if (conflict) {
    throw createError({
      statusCode: 400,
      message: `MIN_INTERVAL нарушен для account=${conflict.accountId}: ${conflict.conflict[0]} → ${conflict.conflict[1]}`,
    })
  }

  // Pre-fetch accounts + videos для валидации (минимум запросов).
  const uniqueAccountIds = Array.from(new Set(body.pairs.map((p) => p.socialAccountId)))
  const uniqueVideoIds = Array.from(new Set(body.pairs.map((p) => p.videoId)))

  const [accounts, videos] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { id: { in: uniqueAccountIds } },
      select: {
        id: true,
        platform: true,
        status: true,
        displayName: true,
        proxyId: true,
        deviceProfileId: true,
        postingMethod: true,
        proxy: { select: { id: true, status: true } },
      },
    }),
    prisma.video.findMany({
      where: { id: { in: uniqueVideoIds } },
      select: { id: true, status: true },
    }),
  ])
  const accountMap = new Map(accounts.map((a) => [a.id, a]))
  const videoMap = new Map(videos.map((v) => [v.id, v]))

  const created: PostingJobDto[] = []
  const skipped: BulkCreateSkippedPair[] = []

  for (const pair of body.pairs) {
    const skip = (code: string, message: string) =>
      skipped.push({
        socialAccountId: pair.socialAccountId,
        videoId: pair.videoId,
        code,
        message,
      })

    const account = accountMap.get(pair.socialAccountId)
    const video = videoMap.get(pair.videoId)

    if (!account) {
      skip("account_not_found", `Аккаунт #${pair.socialAccountId} не найден`)
      continue
    }
    if (!video) {
      skip("video_not_found", `Видео #${pair.videoId} не найдено`)
      continue
    }
    if (account.platform !== body.platform) {
      skip(
        "platform_mismatch",
        `Платформа аккаунта (${account.platform}) ≠ ${body.platform}`,
      )
      continue
    }
    // api-постинг для IG/TikTok недоступен (реального API-раннера нет — постинг
    // только через browser_automation). Per-pair skip, не роняем весь bulk.
    // YouTube api НЕ трогаем (вне нашего решения). TikTok bulk и так заблокирован выше.
    if (
      account.postingMethod === "api"
      && (body.platform === "instagram" || body.platform === "tiktok")
    ) {
      const platformName = body.platform === "instagram" ? "Instagram" : "TikTok"
      skip(
        "api_method_unsupported",
        `Постинг в ${platformName} доступен только через browser_automation. `
          + `Переключите аккаунт „${account.displayName}" на „Через браузер".`,
      )
      continue
    }
    if (!account.proxyId) {
      skip("no_proxy", "Аккаунт без прокси")
      continue
    }
    if (account.proxy && account.proxy.status !== "healthy") {
      skip("proxy_unhealthy", `Прокси ${account.proxy.status}`)
      continue
    }

    // 1:1:1 pre-flight для browser_automation. Нарушение → skip (не прерываем bulk).
    // api-аккаунты не ограничены (легитимный шеринг прокси).
    if (account.postingMethod === "browser_automation") {
      try {
        await assertOneToOneForBrowserAutomation(account.id, {
          proxyId: account.proxyId,
          deviceProfileId: account.deviceProfileId,
        })
      } catch (err: unknown) {
        const e = err as { statusCode?: number; statusMessage?: string; message?: string }
        if (e?.statusCode === 409) {
          skip(e.statusMessage ?? "one_to_one_violation", e.message ?? "Нарушение 1:1:1")
          continue
        }
        throw err
      }
    }

    // Snapshot validation — развилка по платформе.
    try {
      if (body.platform === "youtube") {
        validateYoutubeSnapshot(pair.contentSnapshot)
      } else if (body.platform === "instagram") {
        validateInstagramSnapshot(pair.contentSnapshot)
      }
    } catch (err) {
      if (
        err instanceof YoutubeSnapshotValidationError ||
        err instanceof InstagramSnapshotValidationError
      ) {
        skip("snapshot_invalid", err.message)
        continue
      }
      throw err
    }

    // Создаём job (идемпотентно). При повторе того же ключа createPostingJob
    // вернёт existing или кинет 409 (failed/cancelled). Ловим 409 как skip.
    try {
      const job = await createPostingJob({
        videoId: pair.videoId,
        socialAccountId: pair.socialAccountId,
        platform: body.platform as Platform,
        contentSnapshot: pair.contentSnapshot as never,
        scheduledAt: new Date(pair.scheduledAt),
        createdById: user.id,
        maxAttempts: defaultMaxAttemptsForMethod(account.postingMethod),
      })
      created.push(job as unknown as PostingJobDto)
    } catch (err: unknown) {
      const e = err as { statusCode?: number; data?: { existingJobId?: string; status?: string } }
      if (e?.statusCode === 409) {
        skip(
          "idempotency_conflict",
          `Уже есть job с тем же ключом (id=${e.data?.existingJobId}, status=${e.data?.status})`,
        )
        continue
      }
      // Любые другие ошибки — фатальные, прерываем bulk и возвращаем 500.
      throw err
    }
  }

  const response: BulkCreateResponse = { created, skipped }

  // 207 Multi-Status если есть и created и skipped, 201 если всё создано, 200 если ничего.
  if (created.length > 0 && skipped.length === 0) {
    setResponseStatus(event, 201)
  } else if (created.length > 0 && skipped.length > 0) {
    setResponseStatus(event, 207)
  } else {
    setResponseStatus(event, 200)
  }

  return { data: response }
})
