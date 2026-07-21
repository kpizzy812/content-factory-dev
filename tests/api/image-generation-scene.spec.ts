/**
 * Contract-тесты POST /api/scenes/:id/generate-reference.
 *
 * Зеркалит image-generation-character.spec.ts, но для SceneReferenceImage:
 *   - KINDS = mood|shot|environment|other
 *   - default aspect = portrait (9:16)
 *   - storageKey pattern: zavodcamp/apps/{appId}/scenes/{sceneId}/refs/{sha1}.{ext}
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

async function createTestScene(opts: { name?: string } = {}) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: {
      name: `Test App ${seed}`,
      description: "Test app",
      keywords: ["test"],
    },
  })
  const scene = await prisma.scene.create({
    data: {
      appId: app.id,
      name: opts.name ?? `Test Scene ${seed}`,
      description: "Test scene description",
      blocks: [],
    },
  })
  return { app, scene }
}

describe("POST /api/scenes/:id/generate-reference — validation", () => {
  it("400 на пустой prompt", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene } = await createTestScene()
    await expect(
      $fetch(`/api/scenes/${scene.id}/generate-reference`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 на неизвестный kind для сцены", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene } = await createTestScene()
    await expect(
      $fetch(`/api/scenes/${scene.id}/generate-reference`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "test", kind: "face" }, // face — для character, не scene
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("404 для несуществующей сцены", async () => {
    const user = await createTestUser({ canRunAgent: true })
    await expect(
      $fetch(`/api/scenes/nonexistent-scene-id/generate-reference`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "test" },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("POST /api/scenes/:id/generate-reference — happy path", () => {
  it("создаёт SceneReferenceImage с generation* полями", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene } = await createTestScene()

    const res = await $fetch<{
      data: {
        reference: {
          id: string
          sceneId: string
          generationPrompt: string | null
          generationModel: string | null
          generationCostUsd: string | null
          storageKey: string | null
          kind: string
        }
        deduplicated: boolean
      }
    }>(`/api/scenes/${scene.id}/generate-reference`, {
      method: "POST",
      headers: authHeaders(user.id),
      body: { prompt: "Cozy kitchen at morning, warm light", kind: "mood" },
    })

    expect(res.data.deduplicated).toBe(false)
    expect(res.data.reference.sceneId).toBe(scene.id)
    expect(res.data.reference.generationPrompt).toBe("Cozy kitchen at morning, warm light")
    expect(res.data.reference.generationModel).toBe("fal-ai/flux/schnell")
    expect(res.data.reference.storageKey).toMatch(/^zavodcamp\/apps\/\d+\/scenes\/.+\/refs\//)
    expect(res.data.reference.kind).toBe("mood")
  })

  it("default aspect portrait — cost соответствует 1024x1820", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene } = await createTestScene()

    const res = await $fetch<{ data: { reference: { generationCostUsd: string | null } } }>(
      `/api/scenes/${scene.id}/generate-reference`,
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "Test portrait default" },
      },
    )
    // 1024x1820 = 1.86 Mp × $0.003 (FLUX Schnell) ≈ $0.0056
    const cost = Number(res.data.reference.generationCostUsd)
    expect(cost).toBeGreaterThan(0.005)
    expect(cost).toBeLessThan(0.01)
  })

  it("dedup: повторный вызов возвращает existing", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene } = await createTestScene()

    const first = await $fetch<{ data: { reference: { id: string }; deduplicated: boolean } }>(
      `/api/scenes/${scene.id}/generate-reference`,
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "first" },
      },
    )
    expect(first.data.deduplicated).toBe(false)

    const second = await $fetch<{ data: { reference: { id: string }; deduplicated: boolean } }>(
      `/api/scenes/${scene.id}/generate-reference`,
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "second — но mock placeholder тот же" },
      },
    )
    expect(second.data.deduplicated).toBe(true)
    expect(second.data.reference.id).toBe(first.data.reference.id)
  })
})

describe("POST /api/scenes/:id/generate-reference — auth", () => {
  it("без canRunAgent → 403", async () => {
    const user = await createTestUser({ canRunAgent: false, canAdmin: false })
    const { scene } = await createTestScene()
    await expect(
      $fetch(`/api/scenes/${scene.id}/generate-reference`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { prompt: "test" },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
