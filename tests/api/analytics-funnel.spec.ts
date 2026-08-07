/**
 * API contract-тесты сквозной аналитики: воронка, рейтинги, динамика, разбор.
 *
 * Проверяем ровно то, что легко сломать и невозможно заметить глазами на
 * непустой базе:
 *  1. Просмотры берутся из ПОСЛЕДНЕГО замера, а не из суммы снимков.
 *  2. Стадии переходов, заявок и продаж считаются по типам событий.
 *  3. Первое и последнее касание раздают заслугу разным публикациям.
 *  4. Стоимость заявки не считается, когда заявок нет: null, а не ноль.
 *  5. Отбор по площадке не сужает стадии производства и честно об этом пишет.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { createTestApp, createTestSocialAccount } from "../helpers/factories"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"
import type {
  FunnelResult,
  PublicationChainResult,
  RankingsResult,
  TimeseriesResult,
} from "../../shared/types/analytics-funnel"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

const HOUR = 3_600_000
const DAY = 24 * HOUR

interface Fixture {
  appId: number
  accountId: number
  uploadId: number
  publicationId: string
  trackingToken: string
}

/**
 * Полная цепочка одной публикации: тренд → сценарий → вариант → ролик →
 * публикация → фабричная публикация с tracking token.
 */
async function createPublication(options: {
  appId: number
  accountId: number
  platform: "tiktok" | "instagram" | "youtube"
  publishedAgoMs: number
  hook: string
  views: number[]
  token: string
}): Promise<Fixture> {
  const user = await createTestUser({ canAdmin: true })
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

  return {
    appId: options.appId,
    accountId: options.accountId,
    uploadId: upload.id,
    publicationId: publication.id,
    trackingToken: options.token,
  }
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

describe("GET /api/analytics/funnel", () => {
  it("считает восемь стадий и берёт просмотры из последнего замера", async () => {
    const user = await createTestUser({ canRead: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({ appId: app.id, platform: "tiktok" })

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

    const res = await $fetch<{ data: FunnelResult }>("/api/analytics/funnel?period=7d", {
      headers: authHeaders(user.id),
    })

    const stages = new Map(res.data.stages.map(stage => [stage.key, stage.value]))
    expect(res.data.stages).toHaveLength(8)
    expect(stages.get("trends")).toBe(1)
    expect(stages.get("scenarios")).toBe(1)
    expect(stages.get("videos")).toBe(1)
    expect(stages.get("publications")).toBe(1)
    expect(stages.get("views")).toBe(1000)
    expect(stages.get("clicks")).toBe(2)
    expect(stages.get("leads")).toBe(1)
    expect(stages.get("sales")).toBe(1)
    expect(res.data.hasAttribution).toBe(true)
  })

  it("стоимость заявки не считается без заявок, а стадии производства не сужаются площадкой", async () => {
    const user = await createTestUser({ canRead: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({ appId: app.id, platform: "tiktok" })

    await createPublication({
      appId: app.id,
      accountId: account.id,
      platform: "tiktok",
      publishedAgoMs: DAY,
      hook: "Без хука",
      views: [500],
      token: "tt_funnel_2",
    })

    const res = await $fetch<{ data: FunnelResult }>(
      "/api/analytics/funnel?period=7d&platform=instagram",
      { headers: authHeaders(user.id) },
    )

    const stages = new Map(res.data.stages.map(stage => [stage.key, stage.value]))
    // Публикация ушла в TikTok — при отборе по Instagram её нет,
    // а тренд и сценарий по-прежнему посчитаны: они не принадлежат площадке.
    expect(stages.get("publications")).toBe(0)
    expect(stages.get("trends")).toBe(1)
    expect(res.data.productionScopeNote).toBe(true)
    expect(res.data.hasAttribution).toBe(false)

    const costPerLead = res.data.kpis.find(kpi => kpi.key === "costPerLead")
    expect(costPerLead?.value).toBeNull()
  })
})

describe("GET /api/analytics/rankings", () => {
  it("первое и последнее касание раздают заслугу разным публикациям", async () => {
    const user = await createTestUser({ canRead: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({ appId: app.id, platform: "tiktok" })

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

    // Один и тот же человек: сначала пришёл с первой публикации, заявку
    // оставил со второй. Сшивается по messengerUserId.
    await addEvent(first, { type: "messenger_opened", agoMs: 2 * DAY, messengerUserId: "same", key: "c" })
    await addEvent(last, { type: "messenger_opened", agoMs: DAY, messengerUserId: "same", key: "c" })
    await addEvent(last, { type: "conversion_submitted", agoMs: HOUR, messengerUserId: "same", key: "l" })

    const byFirst = await $fetch<{ data: RankingsResult }>(
      "/api/analytics/rankings?period=7d&model=first",
      { headers: authHeaders(user.id) },
    )
    const byLast = await $fetch<{ data: RankingsResult }>(
      "/api/analytics/rankings?period=7d&model=last",
      { headers: authHeaders(user.id) },
    )

    expect(byFirst.data.topVideos[0]?.uploadId).toBe(first.uploadId)
    expect(byFirst.data.topVideos[0]?.leads).toBe(1)
    expect(byLast.data.topVideos[0]?.uploadId).toBe(last.uploadId)
    expect(byLast.data.topVideos[0]?.leads).toBe(1)
  })
})

describe("GET /api/analytics/timeseries", () => {
  it("отдаёт день на точку и помечает сегодняшний неполным", async () => {
    const user = await createTestUser({ canRead: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({ appId: app.id, platform: "tiktok" })

    await createPublication({
      appId: app.id,
      accountId: account.id,
      platform: "tiktok",
      publishedAgoMs: DAY,
      hook: "Хук",
      views: [700],
      token: "tt_series",
    })

    const res = await $fetch<{ data: TimeseriesResult }>(
      "/api/analytics/timeseries?period=7d&metric=views",
      { headers: authHeaders(user.id) },
    )

    expect(res.data.metric).toBe("views")
    expect(res.data.points.length).toBeGreaterThanOrEqual(7)
    expect(res.data.points.filter(point => point.partial)).toHaveLength(1)
    expect(res.data.points.reduce((sum, point) => sum + (point.value ?? 0), 0)).toBe(700)
  })
})

describe("GET /api/analytics/chain/:uploadId", () => {
  it("собирает цепочку происхождения и считает касания", async () => {
    const user = await createTestUser({ canRead: true })
    const app = await createTestApp()
    const account = await createTestSocialAccount({ appId: app.id, platform: "tiktok" })

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

    const res = await $fetch<{ data: PublicationChainResult }>(
      `/api/analytics/chain/${fixture.uploadId}`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.chain.map(step => step.kind)).toEqual([
      "trend",
      "scenario",
      "video",
      "publication",
      "result",
    ])
    expect(res.data.hasPublication).toBe(true)
    expect(res.data.leads).toBe(1)
    expect(res.data.touchCount).toBe(3)
    expect(res.data.firstTouch?.type).toBe("messenger_opened")
    expect(res.data.lastTouch?.type).toBe("conversion_submitted")
  })

  it("404 на несуществующей публикации", async () => {
    const user = await createTestUser({ canRead: true })

    let status: number | null = null
    try {
      await $fetch("/api/analytics/chain/999999", { headers: authHeaders(user.id) })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number }
      status = e.statusCode ?? e.status ?? null
    }

    expect(status).toBe(404)
  })
})
