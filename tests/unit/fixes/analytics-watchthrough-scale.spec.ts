/**
 * Регрессия на шкалу досматриваемости в AI-анализе поста (P0-15).
 *
 * Дефекты, которые здесь закрыты:
 *  - порог `REFERENCE_THRESHOLD_WATCH_THROUGH` (проценты, по умолчанию 50)
 *    сравнивался напрямую с `PostMetrics.watchThrough`, который хранится долей
 *    0…1: условие «0.72 >= 50» не выполнялось никогда, и критерий отбора в базу
 *    референсов по досмотру был мёртвым — оставался только порог просмотров;
 *  - в промпт LLM доля печаталась со знаком процента, и модель получала
 *    «Досматриваемость: 0.72%» вместо «72.0%», а потом объясняла по этим числам
 *    «почему не залетело».
 *
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from "vitest"

const globals = globalThis as unknown as Record<string, unknown>

interface Harness {
  /** Доля досмотра, 0…1 — как её пишет сборщик метрик. */
  watchThrough: number
  /** Доля переходов, 0…1. */
  ctr?: number
  views?: number
  /** Вердикт модели: без него референс не создаётся ни при каком пороге. */
  isSuccessful?: boolean
}

function install(harness: Harness) {
  const prompts: string[] = []
  const referenceUpserts: Array<Record<string, unknown>> = []

  globals.requirePaidApisEnabled = () => {}
  globals.createError = (options: { statusCode: number; message: string }) =>
    new Error(`${options.statusCode}: ${options.message}`)

  globals.prisma = {
    upload: {
      findUnique: async () => ({
        id: 501,
        title: "Ролик про ремонт",
        status: "published",
        hashtags: ["#ремонт"],
        videoId: 11,
        applicationId: 3,
        socialAccountId: 7,
        socialAccount: { platform: "instagram" },
        metrics: [{
          views: harness.views ?? 1_000,
          likes: 10,
          comments: 2,
          shares: 1,
          watchThrough: harness.watchThrough,
          ctr: harness.ctr ?? 0.05,
          followerGain: 4,
        }],
      }),
    },
    reference: {
      upsert: async (args: Record<string, unknown>) => {
        referenceUpserts.push(args)
        return args
      },
    },
    // Побочные пропагации не должны влиять на проверку — глушим их «нет данных».
    accountStyleProfile: { findUnique: async () => null },
    accountStyleRevision: { create: async () => ({}) },
    video: { findUnique: async () => null },
  }

  globals.propagateInsightsToProfiles = async () => {}
  globals.updateOptimizationMemory = async () => {}

  globals.$fetch = async (_url: string, options: { body: { messages: Array<{ content: string }> } }) => {
    prompts.push(options.body.messages[0]!.content)
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          reason: "Сильный хук",
          analysis: "Досмотр высокий",
          recommendations: ["усилить хук"],
          isSuccessful: harness.isSuccessful ?? true,
        }),
      }],
    }
  }

  return { prompts, referenceUpserts }
}

describe("analyzePost: досматриваемость живёт в шкале 0…1", () => {
  const saved = {
    prisma: globals.prisma,
    createError: globals.createError,
    requirePaidApisEnabled: globals.requirePaidApisEnabled,
    propagateInsightsToProfiles: globals.propagateInsightsToProfiles,
    updateOptimizationMemory: globals.updateOptimizationMemory,
    $fetch: globals.$fetch,
  }
  const savedEnv = {
    key: process.env.ANTHROPIC_API_KEY,
    views: process.env.REFERENCE_THRESHOLD_VIEWS,
    watch: process.env.REFERENCE_THRESHOLD_WATCH_THROUGH,
  }

  afterEach(() => {
    Object.assign(globals, saved)
    process.env.ANTHROPIC_API_KEY = savedEnv.key
    if (savedEnv.views === undefined) delete process.env.REFERENCE_THRESHOLD_VIEWS
    else process.env.REFERENCE_THRESHOLD_VIEWS = savedEnv.views
    if (savedEnv.watch === undefined) delete process.env.REFERENCE_THRESHOLD_WATCH_THROUGH
    else process.env.REFERENCE_THRESHOLD_WATCH_THROUGH = savedEnv.watch
  })

  async function analyze(uploadId = 501) {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const { analyzePost } = await import("~~/server/utils/analytics-ai")
    return analyzePost(uploadId)
  }

  it("порог по умолчанию (50 = 50 %) пропускает ролик с досмотром 0.72", async () => {
    delete process.env.REFERENCE_THRESHOLD_WATCH_THROUGH
    // Просмотров заведомо меньше порога — единственный сработавший критерий
    // должен быть именно досмотр.
    process.env.REFERENCE_THRESHOLD_VIEWS = "10000"
    const spy = install({ watchThrough: 0.72, views: 900 })

    const result = await analyze()

    expect(result.referenceCreated).toBe(true)
    expect(spy.referenceUpserts).toHaveLength(1)
  })

  it("досмотр ниже порога референс не создаёт", async () => {
    delete process.env.REFERENCE_THRESHOLD_WATCH_THROUGH
    process.env.REFERENCE_THRESHOLD_VIEWS = "10000"
    const spy = install({ watchThrough: 0.31, views: 900 })

    const result = await analyze()

    expect(result.referenceCreated).toBe(false)
    expect(spy.referenceUpserts).toHaveLength(0)
  })

  it("значение env читается как проценты: 80 — это 80 %, а не 8000 %", async () => {
    process.env.REFERENCE_THRESHOLD_WATCH_THROUGH = "80"
    process.env.REFERENCE_THRESHOLD_VIEWS = "10000"

    const below = install({ watchThrough: 0.72, views: 900 })
    expect((await analyze()).referenceCreated).toBe(false)
    expect(below.referenceUpserts).toHaveLength(0)

    const above = install({ watchThrough: 0.85, views: 900 })
    expect((await analyze()).referenceCreated).toBe(true)
    expect(above.referenceUpserts).toHaveLength(1)
  })

  it("в промпт уходят проценты, а не доля со знаком процента", async () => {
    const spy = install({ watchThrough: 0.703, ctr: 0.0421 })

    await analyze()

    const prompt = spy.prompts[0]!
    expect(prompt).toContain("Досматриваемость: 70.3%")
    expect(prompt).toContain("CTR: 4.2%")
    // Старое поведение печатало долю дословно — этого в промпте быть не должно.
    expect(prompt).not.toContain("0.703%")
    expect(prompt).not.toContain("0.0421%")
  })
})
