/**
 * GET /api/search?q= — поиск по сущностям для командной палитры.
 *
 * По ~50 страницам мышью не ходят: палитра должна находить не только раздел,
 * но и конкретный объект. Это второй источник её результатов, первый —
 * список разделов на клиенте.
 *
 * Раздел, к которому у пользователя нет доступа, не ищется вообще: иначе
 * палитра показывала бы существование объектов, которых человек не может
 * открыть.
 *
 * У видео и сценария своего названия нет — они наследуют его от тренда, из
 * которого выросли. Поэтому подпись собирается по связи, а не по полю.
 */
const PER_TYPE = 5
const MAX_QUERY = 80

export interface SearchHit {
  type: string
  typeLabel: string
  id: number
  label: string
  sublabel?: string
  to: string
  icon: string
}

export default defineEventHandler(async (event) => {
  const user = await requirePermission(event, "canRead")

  const raw = String(getQuery(event).q ?? "").trim().slice(0, MAX_QUERY)
  if (raw.length < 2) return { data: [] as SearchHit[] }

  const has = moduleGate(user)

  // «vid 10842», «#10842», «10842» — оператор диктует номер как придётся.
  const numeric = Number(raw.replace(/\D+/g, ""))
  const byId = Number.isInteger(numeric) && numeric > 0 ? numeric : null
  const contains = { contains: raw, mode: "insensitive" } as const

  const [trends, ideas, pipelines, accounts, videos] = await Promise.all([
    has("trendwatcher")
      ? prisma.trend.findMany({
          where: byId ? { OR: [{ id: byId }, { title: contains }] } : { title: contains },
          select: { id: true, title: true, platform: true },
          take: PER_TYPE,
          orderBy: { importedAt: "desc" },
        })
      : [],

    has("script-generator")
      ? prisma.idea.findMany({
          where: byId ? { OR: [{ id: byId }, { title: contains }] } : { title: contains },
          select: { id: true, title: true },
          take: PER_TYPE,
          orderBy: { createdAt: "desc" },
        })
      : [],

    has("pipeline")
      ? prisma.pipeline.findMany({
          where: byId ? { OR: [{ id: byId }, { name: contains }] } : { name: contains },
          select: { id: true, name: true, status: true },
          take: PER_TYPE,
          orderBy: { updatedAt: "desc" },
        })
      : [],

    has("social-upload")
      ? prisma.socialAccount.findMany({
          where: {
            OR: [
              { displayName: contains },
              { platformHandle: contains },
              ...(byId ? [{ id: byId }] : []),
            ],
          },
          select: { id: true, displayName: true, platformHandle: true, platform: true },
          take: PER_TYPE,
        })
      : [],

    // Видео ищется только по номеру: своего названия у него нет, а искать по
    // названию тренда через две связи — это уже не подсказка, а отчёт.
    has("video-generator") && byId
      ? prisma.video.findMany({
          where: { id: byId },
          select: {
            id: true,
            status: true,
            scenario: { select: { trend: { select: { title: true } } } },
          },
          take: 1,
        })
      : [],
  ])

  const hits: SearchHit[] = [
    ...videos.map(v => ({
      type: "video",
      typeLabel: "Видео",
      id: v.id,
      label: `vid_${v.id}`,
      sublabel: v.scenario?.trend?.title ?? undefined,
      to: `/videos/${v.id}`,
      icon: "mingcute:video-line",
    })),
    ...trends.map(t => ({
      type: "trend",
      typeLabel: "Тренд",
      id: t.id,
      label: t.title || `trend_${t.id}`,
      sublabel: t.platform,
      to: `/trends/${t.id}`,
      icon: "mingcute:fire-line",
    })),
    ...pipelines.map(p => ({
      type: "pipeline",
      typeLabel: "Конвейер",
      id: p.id,
      label: p.name,
      to: `/pipeline/${p.id}`,
      icon: "mingcute:git-branch-line",
    })),
    ...accounts.map(a => ({
      type: "account",
      typeLabel: "Аккаунт",
      id: a.id,
      label: a.platformHandle ? `@${a.platformHandle}` : a.displayName,
      sublabel: a.platform,
      to: "/accounts",
      icon: "mingcute:group-line",
    })),
    ...ideas.map(i => ({
      type: "idea",
      typeLabel: "Идея",
      id: i.id,
      label: i.title,
      to: `/ideas/${i.id}`,
      icon: "mingcute:bulb-line",
    })),
  ]

  return { data: hits }
})
