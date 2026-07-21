/**
 * Contract-тесты Caption Generator API — все 6 endpoints.
 *
 * Что покрыто:
 *   - POST   /api/videos/:id/captions                — генерация через AI (mock fixture)
 *   - GET    /api/videos/:id/captions                — список
 *   - PUT    /api/videos/:id/captions/:platform      — редактирование, сброс approve, лимиты
 *   - DELETE /api/videos/:id/captions/:platform
 *   - POST   /api/videos/:id/captions/regenerate     — повторная генерация только для существующих
 *   - PUT    /api/videos/:id/captions/approve        — 422 при fitsLimits=false
 *
 * Mock-агент: ANTHROPIC_MOCK_MODE=true, фикстура caption-generator-happy.json
 * возвращает fitsLimits=true для всех 3 платформ.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"
import { createTestVideoWithScenario, createTestCaption } from "./_helpers/video-factory"

await setup({
  dev: true,
  server: true,
  browser: false,
  env: nuxtTestEnv,
})

// --- POST /captions — генерация ---

describe("POST /api/videos/:id/captions — генерация через AI", () => {
  it("создаёт captions для всех 3 платформ из mock fixture", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { video } = await createTestVideoWithScenario()

    const res = await $fetch<{ data: { captions: unknown[]; contextUsed: Record<string, boolean> } }>(
      `/api/videos/${video.id}/captions`,
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: { platforms: ["tiktok", "youtube", "instagram"] },
      },
    )

    expect(res.data.captions).toHaveLength(3)
    expect(res.data.contextUsed).toBeDefined()

    const stored = await prisma.caption.findMany({
      where: { videoId: video.id },
      orderBy: { platform: "asc" },
    })
    expect(stored).toHaveLength(3)
    const platforms = stored.map((c) => c.platform).sort()
    expect(platforms).toEqual(["instagram", "tiktok", "youtube"])
  })

  it("сохраняет fitsLimits=true и валидные snapshot-поля", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { video } = await createTestVideoWithScenario()

    await $fetch(`/api/videos/${video.id}/captions`, {
      method: "POST",
      headers: authHeaders(user.id),
      body: { platforms: ["tiktok"] },
    })

    const tt = await prisma.caption.findUniqueOrThrow({
      where: { videoId_platform: { videoId: video.id, platform: "tiktok" } },
    })
    expect(tt.fitsLimits).toBe(true)
    expect(tt.charsTitle).toBe(tt.title.length)
    expect(tt.hashtags.length).toBe(5) // фикстура: ровно 5 для tiktok
    expect(tt.charsHashtagsTotal).toBeGreaterThan(0)
    expect(tt.charsHashtagsTotal).toBeLessThanOrEqual(100)
    expect(tt.modelVersion).toBe("caption-generator-v1")
    expect(tt.approvedAt).toBeNull()
  })

  it("default platforms (без body) генерирует все 3", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { video } = await createTestVideoWithScenario()

    await $fetch(`/api/videos/${video.id}/captions`, {
      method: "POST",
      headers: authHeaders(user.id),
    })

    const stored = await prisma.caption.findMany({ where: { videoId: video.id } })
    expect(stored).toHaveLength(3)
  })

  it("повторный POST upsert'ит и сбрасывает approve", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok", {
      approvedAt: new Date(),
      approvedById: user.id,
    })

    await $fetch(`/api/videos/${video.id}/captions`, {
      method: "POST",
      headers: authHeaders(user.id),
      body: { platforms: ["tiktok"] },
    })

    const updated = await prisma.caption.findUniqueOrThrow({
      where: { videoId_platform: { videoId: video.id, platform: "tiktok" } },
    })
    expect(updated.approvedAt).toBeNull()
    expect(updated.approvedById).toBeNull()
  })

  it("без auth → 401", async () => {
    const { video } = await createTestVideoWithScenario()
    await expect(
      $fetch(`/api/videos/${video.id}/captions`, {
        method: "POST",
        body: { platforms: ["tiktok"] },
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it("несуществующий videoId → 404", async () => {
    const user = await createTestUser({ canRunAgent: true })
    await expect(
      $fetch("/api/videos/9999999/captions", {
        method: "POST",
        headers: authHeaders(user.id),
        body: { platforms: ["tiktok"] },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("пустой platforms массив → 400", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { video } = await createTestVideoWithScenario()
    await expect(
      $fetch(`/api/videos/${video.id}/captions`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { platforms: ["unknownland"] },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

// --- GET /captions ---

describe("GET /api/videos/:id/captions — список", () => {
  it("возвращает все captions видео", async () => {
    const user = await createTestUser({ canRead: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok")
    await createTestCaption(video.id, "youtube")

    const res = await $fetch<{ data: Array<{ platform: string }> }>(
      `/api/videos/${video.id}/captions`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data).toHaveLength(2)
    const platforms = res.data.map((c) => c.platform).sort()
    expect(platforms).toEqual(["tiktok", "youtube"])
  })

  it("пустой массив если captions нет", async () => {
    const user = await createTestUser({ canRead: true })
    const { video } = await createTestVideoWithScenario()

    const res = await $fetch<{ data: unknown[] }>(
      `/api/videos/${video.id}/captions`,
      { headers: authHeaders(user.id) },
    )
    expect(res.data).toEqual([])
  })

  it("404 если видео не существует", async () => {
    const user = await createTestUser({ canRead: true })
    await expect(
      $fetch("/api/videos/9999999/captions", { headers: authHeaders(user.id) }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// --- PUT /captions/[platform] ---

describe("PUT /api/videos/:id/captions/:platform — редактирование", () => {
  it("обновляет title/description/hashtags и пересчитывает snapshot", async () => {
    const user = await createTestUser({ canWrite: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok")

    const res = await $fetch<{ data: { fitsLimits: boolean; charsTitle: number } }>(
      `/api/videos/${video.id}/captions/tiktok`,
      {
        method: "PUT",
        headers: authHeaders(user.id),
        body: {
          title: "New punchy title for TikTok",
          description: "New description",
          hashtags: ["new", "hashtag", "set", "for", "tiktok"],
        },
      },
    )

    expect(res.data.fitsLimits).toBe(true)
    expect(res.data.charsTitle).toBe("New punchy title for TikTok".length)

    const stored = await prisma.caption.findUniqueOrThrow({
      where: { videoId_platform: { videoId: video.id, platform: "tiktok" } },
    })
    expect(stored.title).toBe("New punchy title for TikTok")
    expect(stored.hashtags).toEqual(["new", "hashtag", "set", "for", "tiktok"])
  })

  it("сбрасывает approvedAt при правке", async () => {
    const user = await createTestUser({ canWrite: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok", {
      approvedAt: new Date(),
      approvedById: user.id,
    })

    await $fetch(`/api/videos/${video.id}/captions/tiktok`, {
      method: "PUT",
      headers: authHeaders(user.id),
      body: { title: "Slightly changed title" },
    })

    const stored = await prisma.caption.findUniqueOrThrow({
      where: { videoId_platform: { videoId: video.id, platform: "tiktok" } },
    })
    expect(stored.approvedAt).toBeNull()
  })

  it("fitsLimits=false при превышении бюджета хэштегов TikTok", async () => {
    const user = await createTestUser({ canWrite: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok")

    const res = await $fetch<{ data: { fitsLimits: boolean }; validation: { valid: boolean; errors: string[] } }>(
      `/api/videos/${video.id}/captions/tiktok`,
      {
        method: "PUT",
        headers: authHeaders(user.id),
        body: {
          // 5 длинных тегов > 100 символов суммарно
          hashtags: [
            "verylongextrahashtagone",
            "verylongextrahashtagtwo",
            "verylongextrahashtagthree",
            "verylongextrahashtagfour",
            "verylongextrahashtagfive",
          ],
        },
      },
    )

    expect(res.data.fitsLimits).toBe(false)
    expect(res.validation.valid).toBe(false)
    expect(res.validation.errors.length).toBeGreaterThan(0)
  })

  it("очищает префикс # из хэштегов на входе", async () => {
    const user = await createTestUser({ canWrite: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok")

    await $fetch(`/api/videos/${video.id}/captions/tiktok`, {
      method: "PUT",
      headers: authHeaders(user.id),
      body: { hashtags: ["#fyp", "##viral", "test"] },
    })

    const stored = await prisma.caption.findUniqueOrThrow({
      where: { videoId_platform: { videoId: video.id, platform: "tiktok" } },
    })
    expect(stored.hashtags).toEqual(["fyp", "viral", "test"])
  })

  it("400 при пустом title", async () => {
    const user = await createTestUser({ canWrite: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok")

    await expect(
      $fetch(`/api/videos/${video.id}/captions/tiktok`, {
        method: "PUT",
        headers: authHeaders(user.id),
        body: { title: "   " },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("404 если caption не существует", async () => {
    const user = await createTestUser({ canWrite: true })
    const { video } = await createTestVideoWithScenario()

    await expect(
      $fetch(`/api/videos/${video.id}/captions/tiktok`, {
        method: "PUT",
        headers: authHeaders(user.id),
        body: { title: "Anything" },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("400 для неизвестной платформы", async () => {
    const user = await createTestUser({ canWrite: true })
    const { video } = await createTestVideoWithScenario()

    await expect(
      $fetch(`/api/videos/${video.id}/captions/twitter`, {
        method: "PUT",
        headers: authHeaders(user.id),
        body: { title: "x" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

// --- DELETE /captions/[platform] ---

describe("DELETE /api/videos/:id/captions/:platform", () => {
  it("удаляет caption", async () => {
    const user = await createTestUser({ canDelete: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok")

    await $fetch(`/api/videos/${video.id}/captions/tiktok`, {
      method: "DELETE",
      headers: authHeaders(user.id),
    })

    const stored = await prisma.caption.findUnique({
      where: { videoId_platform: { videoId: video.id, platform: "tiktok" } },
    })
    expect(stored).toBeNull()
  })

  it("404 если caption нет", async () => {
    const user = await createTestUser({ canDelete: true })
    const { video } = await createTestVideoWithScenario()

    await expect(
      $fetch(`/api/videos/${video.id}/captions/tiktok`, {
        method: "DELETE",
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// --- POST /captions/regenerate ---

describe("POST /api/videos/:id/captions/regenerate", () => {
  it("перегенерирует существующие платформы по умолчанию", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok", {
      title: "Old title",
      approvedAt: new Date(),
      approvedById: user.id,
    })

    await $fetch(`/api/videos/${video.id}/captions/regenerate`, {
      method: "POST",
      headers: authHeaders(user.id),
    })

    const stored = await prisma.caption.findUniqueOrThrow({
      where: { videoId_platform: { videoId: video.id, platform: "tiktok" } },
    })
    expect(stored.title).not.toBe("Old title")
    expect(stored.approvedAt).toBeNull()
  })

  it("explicit platforms override", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok")

    await $fetch(`/api/videos/${video.id}/captions/regenerate`, {
      method: "POST",
      headers: authHeaders(user.id),
      body: { platforms: ["youtube"] },
    })

    const stored = await prisma.caption.findMany({ where: { videoId: video.id } })
    const platforms = stored.map((c) => c.platform).sort()
    expect(platforms).toContain("youtube")
    expect(platforms).toContain("tiktok") // tiktok не тронули, он остался
  })
})

// --- PUT /captions/approve ---

describe("PUT /api/videos/:id/captions/approve", () => {
  it("ставит approvedAt и approvedById", async () => {
    const user = await createTestUser({ canApprove: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok", { fitsLimits: true })

    const res = await $fetch<{ data: { approvedAt: string | null; approvedById: number | null } }>(
      `/api/videos/${video.id}/captions/approve`,
      {
        method: "PUT",
        headers: authHeaders(user.id),
        body: { platform: "tiktok", approve: true },
      },
    )

    expect(res.data.approvedAt).not.toBeNull()
    expect(res.data.approvedById).toBe(user.id)
  })

  it("отзывает approval при approve=false", async () => {
    const user = await createTestUser({ canApprove: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok", {
      fitsLimits: true,
      approvedAt: new Date(),
      approvedById: user.id,
    })

    await $fetch(`/api/videos/${video.id}/captions/approve`, {
      method: "PUT",
      headers: authHeaders(user.id),
      body: { platform: "tiktok", approve: false },
    })

    const stored = await prisma.caption.findUniqueOrThrow({
      where: { videoId_platform: { videoId: video.id, platform: "tiktok" } },
    })
    expect(stored.approvedAt).toBeNull()
    expect(stored.approvedById).toBeNull()
  })

  it("422 если fitsLimits=false", async () => {
    const user = await createTestUser({ canApprove: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok", { fitsLimits: false })

    await expect(
      $fetch(`/api/videos/${video.id}/captions/approve`, {
        method: "PUT",
        headers: authHeaders(user.id),
        body: { platform: "tiktok", approve: true },
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it("404 если caption не найден", async () => {
    const user = await createTestUser({ canApprove: true })
    const { video } = await createTestVideoWithScenario()

    await expect(
      $fetch(`/api/videos/${video.id}/captions/approve`, {
        method: "PUT",
        headers: authHeaders(user.id),
        body: { platform: "tiktok", approve: true },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("400 без platform", async () => {
    const user = await createTestUser({ canApprove: true })
    const { video } = await createTestVideoWithScenario()

    await expect(
      $fetch(`/api/videos/${video.id}/captions/approve`, {
        method: "PUT",
        headers: authHeaders(user.id),
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

// --- caption-limits unit-style smoke ---

describe("caption-limits validation contract", () => {
  it("PUT хэштегов с пробелом фильтрует (через очистку)", async () => {
    const user = await createTestUser({ canWrite: true })
    const { video } = await createTestVideoWithScenario()
    await createTestCaption(video.id, "tiktok")

    await $fetch(`/api/videos/${video.id}/captions/tiktok`, {
      method: "PUT",
      headers: authHeaders(user.id),
      body: { hashtags: ["valid", "with space", "another"] },
    })

    const stored = await prisma.caption.findUniqueOrThrow({
      where: { videoId_platform: { videoId: video.id, platform: "tiktok" } },
    })
    // "with space" должен быть отфильтрован
    expect(stored.hashtags).toEqual(["valid", "another"])
  })
})
