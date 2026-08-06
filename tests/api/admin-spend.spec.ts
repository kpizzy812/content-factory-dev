/**
 * API contract-тесты для /api/admin/spend — расход по типам операций.
 *
 * Проверяем:
 *  1. GET 200 + структура (группы, итог, стоимость ролика)
 *  2. Суммы приходят из журнала списаний, а не выдуманы
 *  3. GET 403 для non-admin — деньги завода за тем же правом, что балансы
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

interface SpendResponse {
  data: {
    since: string
    windowHours: number
    groups: Array<{ key: string; label: string; amountUsd: number }>
    totalUsd: number
    videoCount: number
    perVideoUsd: number | null
  }
}

describe("GET /api/admin/spend", () => {
  it("200 + правильная структура для admin", async () => {
    const admin = await createTestUser({ canAdmin: true })

    const res = await $fetch<SpendResponse>("/api/admin/spend", {
      headers: authHeaders(admin.id),
    })

    expect(typeof res.data.since).toBe("string")
    expect(res.data.windowHours).toBe(24)
    expect(Array.isArray(res.data.groups)).toBe(true)
    expect(res.data.groups.map(g => g.key)).toEqual(
      expect.arrayContaining(["video", "audio", "text", "render"]),
    )
    for (const group of res.data.groups) {
      expect(typeof group.label).toBe("string")
      expect(typeof group.amountUsd).toBe("number")
    }
    expect(typeof res.data.totalUsd).toBe("number")
    expect(typeof res.data.videoCount).toBe("number")
  })

  it("суммы приходят из журнала списаний", async () => {
    const admin = await createTestUser({ canAdmin: true })

    await prisma.aiAuditLog.create({
      data: {
        action: "external_api_call",
        model: "fal-ai/kling",
        service: "fal.ai",
        stepKey: "clip_generation",
        costUsd: 2.5,
        status: "applied",
      },
    })

    const res = await $fetch<SpendResponse>("/api/admin/spend", {
      headers: authHeaders(admin.id),
    })

    const video = res.data.groups.find(g => g.key === "video")
    expect(video?.amountUsd).toBeCloseTo(2.5, 6)
    expect(res.data.totalUsd).toBeCloseTo(2.5, 6)
    // Роликов за сутки нет — делить не на что
    expect(res.data.perVideoUsd).toBeNull()
  })

  it("403 для non-admin", async () => {
    const user = await createTestUser({ canAdmin: false, canRead: true })

    let status: number | null = null
    try {
      await $fetch("/api/admin/spend", { headers: authHeaders(user.id) })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number }
      status = e.statusCode ?? e.status ?? null
    }

    expect(status).toBe(403)
  })
})
