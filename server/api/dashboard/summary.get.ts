/**
 * GET /api/dashboard/summary — сводка «что требует внимания».
 *
 * Считает одним заходом то, что раньше пришлось бы собирать шестью запросами
 * из разных списков: счётчики у пунктов сайдбара и очередь решений оператора.
 *
 * Возраст самого старого объекта важнее количества: три сценария, которые
 * ждут вторые сутки, хуже двенадцати, поступивших час назад. Поэтому очередь
 * сортируется по возрасту, а не по типу причины.
 *
 * Раздел, к которому у пользователя нет доступа, не считается вообще — иначе
 * счётчик подсказывал бы объём того, чего человек не видит.
 */
import type { AttentionRow, DashboardCounters } from "../../../shared/types/dashboard-summary"

/** Аккаунт считается требующим внимания, если токен истекает в этот срок. */
const TOKEN_EXPIRY_WARNING_DAYS = 3

function ageMs(date: Date | null | undefined): number | null {
  return date ? Date.now() - date.getTime() : null
}

export default defineEventHandler(async (event) => {
  const user = await requirePermission(event, "canRead")

  const modules = new Set(user.moduleAccess)
  const has = (slug: string) => user.canAdmin || modules.has(slug)

  const tokenDeadline = new Date(Date.now() + TOKEN_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000)

  const [
    activeRuns,
    oldestRun,
    trends,
    scenariosOnReview,
    oldestScenario,
    videosFailed,
    oldestVideo,
    postingQueued,
    oldestPosting,
    accountsAttention,
  ] = await Promise.all([
    has("pipeline")
      ? prisma.workflowRun.count({ where: { status: "running" } })
      : 0,
    has("pipeline")
      ? prisma.workflowRun.findFirst({
          where: { status: "running" },
          orderBy: { startedAt: "asc" },
          select: { startedAt: true },
        })
      : null,

    has("trendwatcher") ? prisma.trend.count() : 0,

    // «Сгенерирован» — это и есть ожидание решения: вариант ещё не выбран.
    has("script-generator")
      ? prisma.scenario.count({ where: { status: { in: ["generated", "needs_rework"] } } })
      : 0,
    has("script-generator")
      ? prisma.scenario.findFirst({
          where: { status: { in: ["generated", "needs_rework"] } },
          orderBy: { updatedAt: "asc" },
          select: { updatedAt: true },
        })
      : null,

    // Таймаут — это ошибка: такой ролик повторяют, а не списывают.
    has("video-generator")
      ? prisma.video.count({ where: { status: { in: ["failed", "timeout"] } } })
      : 0,
    has("video-generator")
      ? prisma.video.findFirst({
          where: { status: { in: ["failed", "timeout"] } },
          orderBy: { updatedAt: "asc" },
          select: { updatedAt: true },
        })
      : null,

    has("social-upload")
      ? prisma.postingJob.count({ where: { status: { in: ["queued", "scheduled", "retry_queued"] } } })
      : 0,
    has("social-upload")
      ? prisma.postingJob.findFirst({
          where: { status: { in: ["queued", "scheduled", "retry_queued"] } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        })
      : null,

    // Истёкший и отозванный токен плюс те, что истекут на днях: почти
    // просроченный аккаунт — та же проблема, только её ещё можно предупредить.
    has("social-upload")
      ? prisma.socialAccount.count({
          where: {
            OR: [
              { status: { in: ["expired", "revoked"] } },
              { status: "active", expiresAt: { not: null, lte: tokenDeadline } },
            ],
          },
        })
      : 0,
  ])

  const counters: DashboardCounters = {
    activeRuns,
    trends,
    scenariosOnReview,
    videosFailed,
    postingQueued,
    accountsAttention,
  }

  const attention: AttentionRow[] = [
    {
      key: "scenariosOnReview",
      to: "/scenarios",
      label: "Сценарии ждут решения человека",
      count: scenariosOnReview,
      oldestAgeMs: ageMs(oldestScenario?.updatedAt),
      severity: "warning",
    },
    {
      key: "videosFailed",
      to: "/videos",
      label: "Видео упали на генерации",
      count: videosFailed,
      oldestAgeMs: ageMs(oldestVideo?.updatedAt),
      severity: "danger",
    },
    {
      key: "postingQueued",
      to: "/posting-jobs",
      label: "Публикации ждут отправки",
      count: postingQueued,
      oldestAgeMs: ageMs(oldestPosting?.createdAt),
      severity: "warning",
    },
    {
      key: "accountsAttention",
      to: "/accounts",
      label: "Аккаунты требуют вмешательства",
      count: accountsAttention,
      oldestAgeMs: null,
      severity: "danger",
    },
  ]
    .filter(row => row.count > 0)
    // Возраст важнее количества: строки без возраста уходят вниз.
    .sort((a, b) => (b.oldestAgeMs ?? -1) - (a.oldestAgeMs ?? -1))

  return {
    data: {
      counters,
      attention,
      computedAt: new Date().toISOString(),
      // Возраст самого старого активного запуска нужен монитору, а не очереди
      // решений: работающий запуск — это не проблема, пока он не завис.
      oldestActiveRunAgeMs: ageMs(oldestRun?.startedAt),
    },
  }
})
