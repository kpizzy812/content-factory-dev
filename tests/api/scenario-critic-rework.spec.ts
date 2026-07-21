/**
 * Contract-тесты Scenario Quality Critic API — rework path.
 *
 * Запускается с CRITIC_MOCK_VARIANT=rework, что переключает agentName на
 * 'scenario-quality-critic-rework' → загружается фикстура
 * server/__fixtures__/agents/scenario-quality-critic-rework-happy.json
 * (все scores < 70, needsRework=true).
 *
 * Отдельный spec-файл необходим потому, что @nuxt/test-utils запускает
 * Nuxt dev-сервер в изолированном Nitro-процессе. env-переменные для него
 * задаются однажды через setup() — изменение process.env в тест-воркере
 * во время теста не влияет на уже запущенный сервер.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"
import { createTestScenarioWithVariants } from "./_helpers/scenario-factory"

await setup({
  dev: true,
  server: true,
  browser: false,
  env: {
    ...nuxtTestEnv,
    SCENARIO_CRITIC_ENABLED: "true",
    // Переключает getCriticAgentName() → 'scenario-quality-critic-rework',
    // tryMockAnthropicAgent загружает 'scenario-quality-critic-rework-happy.json'
    // (55/62/48, needsRework=true).
    CRITIC_MOCK_VARIANT: "rework",
  },
})

describe("POST /api/scenarios/:id/critic — rework path (все scores < 70, needsRework=true)", () => {
  it("возвращает 200 с reachedThreshold=false и reviewIds.length=2 при maxIterations=2", async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario } = await createTestScenarioWithVariants({ variantsCount: 3 })

    const res = await $fetch<{ data: Record<string, unknown> }>(
      `/api/scenarios/${scenario.id}/critic`,
      {
        method: "POST",
        body: { maxIterations: 2 },
        headers: authHeaders(user.id),
      },
    )

    expect(res.data.reachedThreshold).toBe(false)
    expect(res.data.needsRework).toBe(true)
    expect((res.data.reviewIds as number[]).length).toBe(2)
    expect(res.data.iterationsCount).toBe(2)
  })

  it("создаёт 2 CriticReview в БД, обе с needsRework=true и разными iteration", async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario } = await createTestScenarioWithVariants({ variantsCount: 3 })

    const res = await $fetch<{ data: { reviewIds: number[] } }>(
      `/api/scenarios/${scenario.id}/critic`,
      {
        method: "POST",
        body: { maxIterations: 2 },
        headers: authHeaders(user.id),
      },
    )

    const reviews = await prisma.criticReview.findMany({
      where: { id: { in: res.data.reviewIds } },
      orderBy: { iteration: "asc" },
    })

    expect(reviews.length).toBe(2)
    expect(reviews[0]!.needsRework).toBe(true)
    expect(reviews[1]!.needsRework).toBe(true)
    expect(reviews[0]!.iteration).toBe(1)
    expect(reviews[1]!.iteration).toBe(2)
  })

  it("устанавливает scenario.generationStatus='critic_max_iter_reached' после maxIterations", async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario } = await createTestScenarioWithVariants({ variantsCount: 3 })

    await $fetch(`/api/scenarios/${scenario.id}/critic`, {
      method: "POST",
      body: { maxIterations: 2 },
      headers: authHeaders(user.id),
    })

    const updated = await prisma.scenario.findUnique({ where: { id: scenario.id } })
    expect(updated!.generationStatus).toBe("critic_max_iter_reached")
  })

  it("выставляет selectedVariantId на вариант с наивысшим score из последней итерации", async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario, variants } = await createTestScenarioWithVariants({ variantsCount: 3 })

    await $fetch(`/api/scenarios/${scenario.id}/critic`, {
      method: "POST",
      body: { maxIterations: 2 },
      headers: authHeaders(user.id),
    })

    const updated = await prisma.scenario.findUnique({ where: { id: scenario.id } })
    // Rework-фикстура: bestVariantIndex=1 (score=62, наивысший среди 55/62/48)
    const bestVariant = variants.find((v) => v.variantIndex === 1)
    expect(updated!.selectedVariantId).toBe(bestVariant!.id)
  })

  it("при maxIterations=1 (только оценка) — создаёт 1 review, status=critic_iter_1, НЕ rework", async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario } = await createTestScenarioWithVariants({ variantsCount: 3 })

    const res = await $fetch<{ data: Record<string, unknown> }>(
      `/api/scenarios/${scenario.id}/critic`,
      {
        method: "POST",
        body: { maxIterations: 1 },
        headers: authHeaders(user.id),
      },
    )

    expect((res.data.reviewIds as number[]).length).toBe(1)
    expect(res.data.iterationsCount).toBe(1)
    // needsRework=true (scores ниже порога), но rework не запускался (maxIterations=1)
    expect(res.data.needsRework).toBe(true)

    const updated = await prisma.scenario.findUnique({ where: { id: scenario.id } })
    // При maxIterations=1 и needsRework=true — last iteration = 1, нет hasIterationsLeft
    // поэтому ставится 'critic_max_iter_reached' (1 >= 1 = последняя итерация)
    expect(updated!.generationStatus).toBe("critic_max_iter_reached")
  })
})
