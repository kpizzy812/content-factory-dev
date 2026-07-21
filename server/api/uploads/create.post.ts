import { createHash } from "node:crypto"

/**
 * POST /api/uploads/create
 * Создать загрузки видео в выбранные аккаунты или группу.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canCreate', 'canRunAgent'], moduleSlug: 'social-upload' })

  const body = await readBody<{
    videoId?: number
    accountIds?: number[]
    groupId?: number
    title?: string
    description?: string
    hashtags?: string[]
    scheduledAt?: string
  }>(event)

  // Валидация videoId
  if (!body?.videoId || typeof body.videoId !== "number" || body.videoId <= 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'videoId' обязательно и должно быть числом > 0",
    })
  }

  // Валидация title
  if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
    throw createError({
      statusCode: 400,
      message: "Поле 'title' обязательно",
    })
  }

  // Нужен либо accountIds, либо groupId
  if (!body.accountIds?.length && !body.groupId) {
    throw createError({
      statusCode: 400,
      message: "Укажите 'accountIds' или 'groupId' для загрузки",
    })
  }

  // Проверить Video
  const video = await prisma.video.findUnique({
    where: { id: body.videoId },
    select: { id: true, status: true, filePath: true },
  })

  if (!video) {
    throw createError({ statusCode: 404, message: "Видео не найдено" })
  }

  if (video.status !== "completed") {
    throw createError({
      statusCode: 400,
      message: `Видео должно быть в статусе 'completed', текущий: ${video.status}`,
    })
  }

  if (!video.filePath) {
    throw createError({
      statusCode: 400,
      message: "У видео отсутствует файл для загрузки",
    })
  }

  // Собрать список accountId-ов
  let targetAccountIds: number[] = []

  if (body.groupId) {
    const group = await prisma.accountGroup.findUnique({
      where: { id: body.groupId },
      include: { members: { select: { socialAccountId: true } } },
    })

    if (!group) {
      throw createError({ statusCode: 404, message: "Группа не найдена" })
    }

    targetAccountIds = group.members.map((m) => m.socialAccountId)
  }

  if (body.accountIds?.length) {
    targetAccountIds = [...new Set([...targetAccountIds, ...body.accountIds])]
  }

  if (targetAccountIds.length === 0) {
    throw createError({
      statusCode: 400,
      message: "Нет аккаунтов для загрузки",
    })
  }

  // Проверить существование аккаунтов
  const accounts = await prisma.socialAccount.findMany({
    where: { id: { in: targetAccountIds }, status: "active" },
    select: { id: true },
  })

  const activeIds = accounts.map((a) => a.id)
  if (activeIds.length === 0) {
    throw createError({
      statusCode: 400,
      message: "Нет активных аккаунтов для загрузки",
    })
  }

  // Проверить env guard и определить статус
  const socialPostingEnabled = process.env.ENABLE_SOCIAL_POSTING === "true"

  const now = Date.now()
  const hashtags = body.hashtags || []
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null
  const publishMode = scheduledAt ? "scheduled" : "immediate"

  // Определить applicationId из видео -> сценария
  const videoWithScenario = await prisma.video.findUnique({
    where: { id: body.videoId },
    select: { applicationId: true, scenario: { select: { appId: true } } },
  })
  const applicationId = videoWithScenario?.applicationId || videoWithScenario?.scenario?.appId || null

  let status: string
  if (!socialPostingEnabled) {
    status = "blocked_by_env"
  } else if (scheduledAt) {
    status = "scheduled"
  } else {
    status = "pending"
  }

  const uploads = await Promise.all(
    activeIds.map(async (accountId) => {
      const idempotencyKey = createHash("sha256")
        .update(`${body.videoId}:${accountId}:${now}`)
        .digest("hex")

      return prisma.upload.create({
        data: {
          videoId: body.videoId!,
          socialAccountId: accountId,
          applicationId,
          title: body.title!.trim(),
          description: body.description || null,
          hashtags,
          scheduledAt,
          publishMode,
          status: status as never,
          blockedByEnv: !socialPostingEnabled,
          idempotencyKey,
          errorMessage: !socialPostingEnabled
            ? "Публикация отключена (ENABLE_SOCIAL_POSTING=false). Загрузка будет выполнена после включения."
            : null,
        },
        select: {
          id: true,
          videoId: true,
          socialAccountId: true,
          status: true,
          publishMode: true,
          title: true,
          scheduledAt: true,
          blockedByEnv: true,
          createdAt: true,
        },
      })
    }),
  )

  // Fire-and-forget: запустить upload pipeline только если enabled и не scheduled
  if (socialPostingEnabled && !scheduledAt) {
    for (const upload of uploads) {
      runUploadPipeline(upload.id).catch(() => {})
    }
  }

  return {
    data: uploads,
    meta: {
      created: uploads.length,
      skipped: targetAccountIds.length - activeIds.length,
      socialPostingEnabled,
      blockedByEnv: !socialPostingEnabled,
    },
  }
})
