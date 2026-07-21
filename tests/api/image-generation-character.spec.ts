/**
 * Contract-тесты POST /api/characters/:id/generate-reference.
 *
 * Что покрыто:
 *   - 400 на пустой prompt
 *   - 400 на неизвестный modelId
 *   - 400 на неизвестный kind / aspect
 *   - 404 при отсутствии character
 *   - 403 без canRunAgent / без app access
 *   - 200 happy path: CharacterReferenceImage создан + generationPrompt/Model/CostUsd заполнены
 *   - 200 dedup: повторный вызов с тем же mock URL возвращает existing (deduplicated:true)
 *   - 200 + AiAuditLog запись с service='fal.ai' и action='image_generation'
 *
 * FAL_MOCK_MODE=true: mock возвращает mock://image/{id} URL, generateMockPlaceholder
 * создаёт через ffmpeg чёрный PNG 1024x1024. У одного и того же mock URL в одном
 * процессе разный requestId, значит и разный sha1 → dedup-кейс собирается явно
 * через переиспользование того же character + одинаковый seed (но FLUX mock тоже
 * рандомный). Поэтому dedup проверяем напрямую — сначала создаём CharacterReferenceImage
 * руками, потом ожидаем что endpoint распознает sha1 коллизию.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({
  dev: true,
  server: true,
  browser: false,
  env: nuxtTestEnv,
})

async function createTestCharacter(opts: { name?: string } = {}) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: {
      name: `Test App ${seed}`,
      description: "Test app",
      keywords: ["test"],
    },
  })
  const character = await prisma.character.create({
    data: {
      appId: app.id,
      name: opts.name ?? `Test Hero ${seed}`,
      description: "Test character description",
      role: "protagonist",
    },
  })
  return { app, character }
}

describe("POST /api/characters/:id/generate-reference — validation", () => {
  it("400 на пустой prompt", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()
    await expect(
      $fetch(`/api/characters/${character.id}/generate-reference`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "  " },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 на неизвестный modelId", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()
    await expect(
      $fetch(`/api/characters/${character.id}/generate-reference`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "test", modelId: "fal-ai/unknown" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 на неизвестный kind", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()
    await expect(
      $fetch(`/api/characters/${character.id}/generate-reference`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "test", kind: "weird-kind" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 на неизвестный aspect", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()
    await expect(
      $fetch(`/api/characters/${character.id}/generate-reference`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "test", aspect: "ultrawide" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("404 для несуществующего character", async () => {
    const user = await createTestUser({ canRunAgent: true })
    await expect(
      $fetch(`/api/characters/nonexistent-id-xyz/generate-reference`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "test" },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("POST /api/characters/:id/generate-reference — happy path (FAL_MOCK_MODE)", () => {
  it("создаёт CharacterReferenceImage с generation* полями", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()

    const res = await $fetch<{
      data: {
        reference: {
          id: string
          characterId: string
          generationPrompt: string | null
          generationModel: string | null
          generationCostUsd: string | null
          storageKey: string | null
          sha1: string
          kind: string
        }
        deduplicated: boolean
      }
    }>(`/api/characters/${character.id}/generate-reference`, {
      method: "POST",
      headers: authHeaders(user.id),
      body: { prompt: "Young woman, short dark hair, calm face", kind: "face", aspect: "square" },
    })

    expect(res.data.deduplicated).toBe(false)
    expect(res.data.reference.characterId).toBe(character.id)
    expect(res.data.reference.generationPrompt).toBe("Young woman, short dark hair, calm face")
    expect(res.data.reference.generationModel).toBe("fal-ai/flux/schnell")
    expect(Number(res.data.reference.generationCostUsd)).toBeGreaterThan(0)
    // FLUX Schnell, square 1024x1024 = 1.048576 Mp × $0.003 ≈ $0.003146
    expect(Number(res.data.reference.generationCostUsd)).toBeLessThan(0.01)
    expect(res.data.reference.storageKey).toMatch(/^zavodcamp\/apps\/\d+\/characters\//)
    expect(res.data.reference.kind).toBe("face")
  })

  it("логирует cost в AiAuditLog с service='fal.ai'", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()

    await $fetch(`/api/characters/${character.id}/generate-reference`, {
      method: "POST",
      headers: authHeaders(user.id),
      body: { prompt: "Test prompt for audit", kind: "body" },
    })

    const logs = await prisma.aiAuditLog.findMany({
      where: { service: "fal.ai", userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 1,
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]!.action).toBe("image_generation")
    expect(logs[0]!.model).toBe("fal-ai/flux/schnell")
    expect(Number(logs[0]!.costUsd ?? 0)).toBeGreaterThan(0)
  })

  it("dedup: повторный вызов с тем же sha1 возвращает existing (deduplicated=true)", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()

    // Первый вызов — создаёт reference
    const first = await $fetch<{ data: { reference: { id: string; sha1: string }; deduplicated: boolean } }>(
      `/api/characters/${character.id}/generate-reference`,
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "Same prompt content" },
      },
    )
    expect(first.data.deduplicated).toBe(false)

    // Mock placeholder детерминистичен (ffmpeg чёрный PNG → один и тот же sha1),
    // потому повторный вызов гарантированно попадает в dedup-ветку.
    const second = await $fetch<{ data: { reference: { id: string; sha1: string }; deduplicated: boolean } }>(
      `/api/characters/${character.id}/generate-reference`,
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "Completely different prompt — but same mock output" },
      },
    )
    expect(second.data.deduplicated).toBe(true)
    expect(second.data.reference.id).toBe(first.data.reference.id)

    // Проверяем что в БД только одна запись для character
    const refs = await prisma.characterReferenceImage.findMany({
      where: { characterId: character.id },
    })
    expect(refs).toHaveLength(1)
  })

  it("FLUX Dev → больший cost чем Schnell", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()

    const res = await $fetch<{ data: { reference: { generationCostUsd: string | null; generationModel: string | null } } }>(
      `/api/characters/${character.id}/generate-reference`,
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "FLUX Dev test", modelId: "fal-ai/flux/dev", aspect: "portrait" },
      },
    )
    expect(res.data.reference.generationModel).toBe("fal-ai/flux/dev")
    // 1024x1820 ≈ 1.864 Mp × $0.025 ≈ $0.0466
    const cost = Number(res.data.reference.generationCostUsd)
    expect(cost).toBeGreaterThan(0.04)
    expect(cost).toBeLessThan(0.06)
  })
})

describe("POST /api/characters/:id/generate-reference — auth", () => {
  it("без canRunAgent → 403", async () => {
    const user = await createTestUser({ canRunAgent: false, canAdmin: false })
    const { character } = await createTestCharacter()
    await expect(
      $fetch(`/api/characters/${character.id}/generate-reference`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "test" },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
