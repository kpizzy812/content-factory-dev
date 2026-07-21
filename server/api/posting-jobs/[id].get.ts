import { buildFsmDiagnostics } from "~~/server/utils/posting/operator-diagnostics"
import { loadDeviceContextMap } from "~~/server/utils/posting/device-context"

/**
 * GET /api/posting-jobs/:id
 * Детали PostingJob + последние 50 строк PostingJobLog + безопасная FSM-диагностика
 * (PR5A): поле `fsm` со state-machine состоянием (фазы/progress/draftVideoId/
 * classWindows/operatorAction) БЕЗ секретов. null если job не управляется FSM.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор job" })
  }

  const job = await prisma.postingJob.findUnique({
    where: { id },
    include: {
      socialAccount: {
        select: {
          id: true,
          displayName: true,
          platform: true,
          status: true,
          // 1:1:1 anti-detect видимость и proxy gating-индикатор.
          postingMethod: true,
          proxyId: true,
          deviceProfileId: true,
          proxy: {
            select: { id: true, label: true, status: true },
          },
        },
      },
      video: {
        select: { id: true, status: true, fileUrl: true, duration: true },
      },
      logs: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  })

  if (!job) {
    throw createError({ statusCode: 404, message: "PostingJob не найден" })
  }

  const fsm = buildFsmDiagnostics({
    stateData: job.stateData,
    retryAt: job.retryAt,
    status: job.status,
    errorCategory: job.errorCategory,
    lastErrorPhase: job.lastErrorPhase,
  })

  // DuoPlus device-контекст: резолвим по SocialAccount.deviceProfileId (FK, которым
  // оперирует постинг). config не утекает наружу.
  const profileId = job.socialAccount?.deviceProfileId ?? null
  const deviceMap = await loadDeviceContextMap([profileId])
  const data = {
    ...job,
    socialAccount: job.socialAccount
      ? {
          ...job.socialAccount,
          device: profileId ? deviceMap.get(profileId) ?? null : null,
        }
      : job.socialAccount,
  }

  return { data, fsm }
})
