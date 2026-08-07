/**
 * Арифметика сквозной аналитики — на модулях напрямую, без HTTP.
 *
 * HTTP-контракт проверяет `tests/api/analytics-funnel.spec.ts`; здесь считается
 * то, что легко сломать и невозможно заметить глазами на непустой базе:
 * просмотры из последнего замера, стадии по типам событий и раздача заслуги
 * первому или последнему касанию.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { prisma } from "../../server/utils/prisma"
import { parseAnalyticsScope } from "../../server/utils/analytics/period"
import { computeFunnel } from "../../server/utils/analytics/funnel"
import { computeRankings } from "../../server/utils/analytics/rankings"
import { computeTimeseries } from "../../server/utils/analytics/timeseries"
import { computePublicationChain } from "../../server/utils/analytics/publication-chain"

const HOUR = 3_600_000
const DAY = 24 * HOUR

interface Fixture {
  uploadId: number
  publicationId: string
  trackingToken: string
}

async function createApp() {
  return prisma.app.create({
    data: { name: `Funnel App ${Math.floor(Math.random() * 1e9)}`, keywords: [] },
  })
}

async function createAccount(appId: number, platform: "tiktok" | "instagram" | "youtube") {
  return prisma.socialAccount.create({
    data: {
      appId,
      platform,
      displayName: `@acc_${Math.floor(Math.random() * 1e9)}`,
      accessToken: "enc:token",
      status: "active",
    },
  })
}

/** Полная цепочка: тренд → сценарий → вариант → ролик → публикация → фабричная. */
async function createPublication(options: {
  appId: number
  accountId: number
  platform: "tiktok" | "instagram" | "youtube"
  publishedAgoMs: number
  hook: string
  views: number[]
  token: string
}): Promise<Fixture> {
  const seed = Math.floor(Math.random() * 1e9)
  const user = await prisma.zavodUser.create({
    data: {
      externalId: seed,
      email: `funnel-${seed}@example.test`,
      name: "Тест",
      moduleAccess: [],
    },
  })
  const publishedAt = new Date(Date.now() - options.publishedAgoMs)

  const trend = await prisma.trend.create({
    data: {
      appId: options.appId,
      platform: options.platform,
      sourceUrl: `https://example.test/${options.token}`,
      title: "Тренд для проверки воронки",
      geo: "RU",
      keyword: "ниша",
      importedAt: publishedAt,
    },
  })

  const scenario = await prisma.scenario.create({
    data: { appId: options.appId, trendId: trend.id, status: "selected", createdAt: publishedAt },
  })

  const variant = await prisma.scenarioVariant.create({
    data: {
      scenarioId: scenario.id,
      variantIndex: 0,
      status: "accepted",
      title: "Вариант A",
      hook: options.hook,
      body: "тело",
      cta: "cta",
      fullScript: "скрипт",
      visualStyleText: "стиль",
    },
  })

  const video = await prisma.video.create({
    data: {
      scenarioId: scenario.id,
      variantId: variant.id,
      status: "completed",
      totalCostActual: 10,
      createdAt: publishedAt,
      finishedAt: publishedAt,
    },
  })

  const upload = await prisma.upload.create({
    data: {
      videoId: video.id,
      socialAccountId: options.accountId,
      applicationId: options.appId,
      status: "published",
      title: "Публикация для проверки воронки",
      idempotencyKey: `funnel-${options.token}`,
      createdAt: publishedAt,
    },
  })

  for (const [index, views] of options.views.entries()) {
    await prisma.postMetrics.create({
      data: {
        uploadId: upload.id,
        views,
        likes: 0,
        comments: 0,
        shares: 0,
        watchThrough: 0.5,
        ctr: 0.01,
        followerGain: 0,
        collectedAt: new Date(publishedAt.getTime() + (index + 1) * HOUR),
      },
    })
  }

  const pipeline = await prisma.pipeline.create({
    data: { userId: user.id, name: `Конвейер ${options.token}` },
  })
  const cycle = await prisma.productionCycle.create({
    data: { appId: options.appId, startedById: user.id },
  })
  const run = await prisma.workflowRun.create({
    data: { pipelineId: pipeline.id, cycleId: cycle.id, status: "success" },
  })

  const publication = await prisma.factoryPublication.create({
    data: {
      appId: options.appId,
      cycleId: cycle.id,
      runId: run.id,
      socialAccountId: options.accountId,
      platform: options.platform,
      trackingToken: options.token,
      videoId: video.id,
      uploadId: upload.id,
      status: "published",
      publishedAt,
    },
  })

  return { uploadId: upload.id, publicationId: publication.id, trackingToken: options.token }
}

async function addEvent(fixture: Fixture, options: {
  type: string
  agoMs: number
  messengerUserId?: string
  key: string
}) {
  await prisma.attributionEvent.create({
    data: {
      publicationId: fixture.publicationId,
      trackingToken: fixture.trackingToken,
      type: options.type,
      source: "test",
      idempotencyKey: `${fixture.publicationId}-${options.key}`,
      messengerUserId: options.messengerUserId ?? null,
      occurredAt: new Date(Date.now() - options.agoMs),
    },
  })
}

const week = () => parseAnalyticsScope({ period: "7d" })

describe("воронка атрибуции", () => {
  it("считает восемь стадий и берёт просмотры из последнего замера", async () => {
    const app = await createApp()
    const account = await createAccount(app.id, "tiktok")

    const fixture = await createPublication({
      appId: app.id,
      accountId: account.id,
      platform: "tiktok",
      publishedAgoMs: 2 * DAY,
      hook: "Боль с доставкой",
      // Три снимка одной публикации: сумма дала бы 1 800, правда — 1 000.
      views: [200, 600, 1000],
      token: "tt_funnel_1",
    })

    await addEvent(fixture, { type: "messenger_opened", agoMs: DAY, messengerUserId: "u1", key: "c1" })
    await addEvent(fixture, { type: "messenger_opened", agoMs: DAY, messengerUserId: "u2", key: "c2" })
    await addEvent(fixture, { type: "conversion_submitted", agoMs: HOUR, messengerUserId: "u1", key: "l1" })
    await addEvent(fixture, { type: "sale_attributed", agoMs: HOUR / 2, messengerUserId: "u1", key: "s1" })

    const funnel = await computeFunnel(week())
    const stages = new Map(funnel.stages.map(stage => [stage.key, stage.value]))

    expect(funnel.stages).toHaveLength(8)
    expect(stages.get("trends")).toBe(1)
    expect(stages.get("scenarios")).toBe(1)
    expect(stages.get("videos")).toBe(1)
    expect(stages.get("publications")).toBe(1)
    expect(stages.get("views")).toBe(1000)
    expect(stages.get("clicks")).toBe(2)
    expect(stages.get("leads")).toBe(1)
    expect(stages.get("sales")).toBe(1)
    expect(funnel.hasAttribution).toBe(true)
  })

  it("отбор по площадке не сужает стадии производства, а стоимость заявки без заявок не считается", async () => {
    const app = await createApp()
    const account = await createAccount(app.id, "tiktok")

    await createPublication({
      appId: app.id,
      accountId: account.id,
      platform: "tiktok",
      publishedAgoMs: DAY,
      hook: "Без хука",
      views: [500],
      token: "tt_funnel_2",
    })

    const funnel = await computeFunnel(parseAnalyticsScope({ period: "7d", platform: "instagram" }))
    const stages = new Map(funnel.stages.map(stage => [stage.key, stage.value]))

    // Публикация ушла в TikTok: при отборе по Instagram её нет, а тренд и
    // сценарий посчитаны — они площадке не принадлежат.
    expect(stages.get("publications")).toBe(0)
    expect(stages.get("trends")).toBe(1)
    expect(funnel.productionScopeNote).toBe(true)
    expect(funnel.hasAttribution).toBe(false)
    expect(funnel.kpis.find(kpi => kpi.key === "costPerLead")?.value).toBeNull()
  })
})

describe("рейтинги", () => {
  it("первое и последнее касание раздают заслугу разным публикациям", async () => {
    const app = await createApp()
    const account = await createAccount(app.id, "tiktok")

    const first = await createPublication({
      appId: app.id,
      accountId: account.id,
      platform: "tiktok",
      publishedAgoMs: 3 * DAY,
      hook: "Первое касание",
      views: [400],
      token: "tt_rank_first",
    })
    const last = await createPublication({
      appId: app.id,
      accountId: account.id,
      platform: "tiktok",
      publishedAgoMs: 2 * DAY,
      hook: "Последнее касание",
      views: [400],
      token: "tt_rank_last",
    })

    // Один человек: пришёл с первой публикации, заявку оставил со второй.
    await addEvent(first, { type: "messenger_opened", agoMs: 2 * DAY, messengerUserId: "same", key: "c" })
    await addEvent(last, { type: "messenger_opened", agoMs: DAY, messengerUserId: "same", key: "c" })
    await addEvent(last, { type: "conversion_submitted", agoMs: HOUR, messengerUserId: "same", key: "l" })

    const byFirst = await computeRankings(week(), "first")
    const byLast = await computeRankings(week(), "last")

    expect(byFirst.topVideos[0]?.uploadId).toBe(first.uploadId)
    expect(byFirst.topVideos[0]?.leads).toBe(1)
    expect(byLast.topVideos[0]?.uploadId).toBe(last.uploadId)
    expect(byLast.topVideos[0]?.leads).toBe(1)
  })
})

describe("динамика", () => {
  it("отдаёт день на точку и помечает сегодняшний неполным", async () => {
    const app = await createApp()
    const account = await createAccount(app.id, "tiktok")

    await createPublication({
      appId: app.id,
      accountId: account.id,
      platform: "tiktok",
      publishedAgoMs: DAY,
      hook: "Хук",
      views: [700],
      token: "tt_series",
    })

    const series = await computeTimeseries(week(), "views")

    expect(series.metric).toBe("views")
    expect(series.points.length).toBeGreaterThanOrEqual(7)
    expect(series.points.filter(point => point.partial)).toHaveLength(1)
    expect(series.points.reduce((sum, point) => sum + (point.value ?? 0), 0)).toBe(700)
  })
})

describe("разбор публикации", () => {
  it("собирает цепочку происхождения и считает касания", async () => {
    const app = await createApp()
    const account = await createAccount(app.id, "tiktok")

    const fixture = await createPublication({
      appId: app.id,
      accountId: account.id,
      platform: "tiktok",
      publishedAgoMs: 2 * DAY,
      hook: "Боль с доставкой",
      views: [900],
      token: "tt_chain",
    })

    await addEvent(fixture, { type: "messenger_opened", agoMs: DAY, messengerUserId: "chain", key: "c" })
    await addEvent(fixture, { type: "lead_magnet_delivered", agoMs: DAY - HOUR, messengerUserId: "chain", key: "d" })
    await addEvent(fixture, { type: "conversion_submitted", agoMs: HOUR, messengerUserId: "chain", key: "l" })

    const chain = await computePublicationChain(fixture.uploadId)

    expect(chain?.chain.map(step => step.kind)).toEqual([
      "trend",
      "scenario",
      "video",
      "publication",
      "result",
    ])
    expect(chain?.hasPublication).toBe(true)
    expect(chain?.leads).toBe(1)
    expect(chain?.touchCount).toBe(3)
    expect(chain?.firstTouch?.type).toBe("messenger_opened")
    expect(chain?.lastTouch?.type).toBe("conversion_submitted")
  })

  it("на несуществующей публикации отдаёт null", async () => {
    expect(await computePublicationChain(999_999)).toBeNull()
  })
})
