/**
 * Contract-тесты Scenario Quality Critic API — gate disabled (SCENARIO_CRITIC_ENABLED=false).
 *
 * Отдельный spec-файл необходим потому, что @nuxt/test-utils запускает Nuxt dev-сервер
 * в изолированном Nitro-процессе. Env-переменные для сервера задаются через setup() env.
 * Изменение process.env в тест-воркере во время теста не влияет на запущенный сервер.
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
    // isCriticEnabled() проверяет process.env.SCENARIO_CRITIC_ENABLED !== 'false'
    SCENARIO_CRITIC_ENABLED: "false",
  },
})

describe("POST /api/scenarios/:id/critic — gate disabled (SCENARIO_CRITIC_ENABLED=false)", () => {
  it("возвращает 200 с skipped=true", async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario } = await createTestScenarioWithVariants({ variantsCount: 3 })

    const res = await $fetch<{ data: Record<string, unknown> }>(
      `/api/scenarios/${scenario.id}/critic`,
      {
        method: "POST",
        headers: authHeaders(user.id),
      },
    )

    expect(res.data.skipped).toBe(true)
  })

  it("возвращает reason в ответе при skipped=true", async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario } = await createTestScenarioWithVariants({ variantsCount: 3 })

    const res = await $fetch<{ data: Record<string, unknown> }>(
      `/api/scenarios/${scenario.id}/critic`,
      {
        method: "POST",
        headers: authHeaders(user.id),
      },
    )

    expect(typeof res.data.reason).toBe("string")
    expect(res.data.reason).toContain("SCENARIO_CRITIC_ENABLED")
  })

  it("не создаёт CriticReview в БД при skipped=true", async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario } = await createTestScenarioWithVariants({ variantsCount: 3 })

    await $fetch(`/api/scenarios/${scenario.id}/critic`, {
      method: "POST",
      headers: authHeaders(user.id),
    })

    const count = await prisma.criticReview.count({ where: { scenarioId: scenario.id } })
    expect(count).toBe(0)
  })

  it("не изменяет qualityScore у вариантов при skipped=true", async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario } = await createTestScenarioWithVariants({ variantsCount: 3 })

    await $fetch(`/api/scenarios/${scenario.id}/critic`, {
      method: "POST",
      headers: authHeaders(user.id),
    })

    const variants = await prisma.scenarioVariant.findMany({
      where: { scenarioId: scenario.id },
    })
    for (const v of variants) {
      expect(v.qualityScore).toBeNull()
    }
  })

  it("возвращает iterationsCount=0 и пустой reviewIds при skipped", async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario } = await createTestScenarioWithVariants({ variantsCount: 3 })

    const res = await $fetch<{ data: Record<string, unknown> }>(
      `/api/scenarios/${scenario.id}/critic`,
      {
        method: "POST",
        headers: authHeaders(user.id),
      },
    )

    expect(res.data.iterationsCount).toBe(0)
    expect(res.data.reviewIds).toEqual([])
  })
})
