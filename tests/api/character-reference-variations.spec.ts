/**
 * Contract-тесты POST /api/characters/:id/reference-variations.
 *
 * Этап 5 спецификации docs/superpowers/specs/2026-08-14-avatar-pipeline.md:
 * из одного загруженного портрета получить набор кадров того же человека, чтобы
 * ротация аватара (`server/utils/avatar-source.ts`) перестала требовать от
 * заказчика 5-10 фотографий.
 *
 * Что покрыто:
 *   - 404 на несуществующего персонажа, 403 без canRunAgent
 *   - 400 на count вне диапазона, на чужой sourceReferenceId, на модель не той способности
 *   - 400 когда у персонажа нет ни одного кадра — генерировать не из чего
 *   - 200: созданы записи CharacterReferenceImage с generation* полями и kind="face"
 *   - 200: повтор того же слота не оплачивается второй раз (идемпотентность по
 *     `character-reference:{id}:variation:{preset}`)
 *
 * REPLICATE_MOCK_MODE=true: мок отдаёт детерминированный mock:// URL, а
 * `generateMockPlaceholder` пишет заглушку без сети и без ffmpeg.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"
import { REFERENCE_VARIATION_PRESETS } from "../../server/utils/character-reference-variations"

await setup({
  dev: true,
  server: true,
  browser: false,
  env: { ...nuxtTestEnv, REPLICATE_MOCK_MODE: "true" },
})

interface VariationResponse {
  data: {
    sourceReferenceId: string
    modelId: string
    costUsd: number
    created: Array<{
      presetKey: string
      deduplicated: boolean
      costUsd: number
      reference: { id: string, kind: string, generationModel: string | null, generationPrompt: string | null }
    }>
    failed: Array<{ presetKey: string, error: string }>
  }
}

async function createCharacterWithPortrait() {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: { name: `Var App ${seed}`, description: "Test app", keywords: ["test"] },
  })
  const character = await prisma.character.create({
    data: {
      appId: app.id,
      name: `Var Hero ${seed}`,
      description: "Test character description",
      role: "protagonist",
    },
  })
  // Исходный кадр делаем настоящим эндпоинтом генерации: у него в хранилище
  // лежит реальный файл, и вариациям есть что забирать.
  const source = await $fetch<{ data: { reference: { id: string } } }>(
    `/api/characters/${character.id}/generate-reference`,
    {
      method: "POST",
      headers: authHeaders((await createTestUser({ canRunAgent: true })).id),
      body: { prompt: `Source portrait ${seed}`, kind: "face" },
    },
  )
  return { app, character, sourceReferenceId: source.data.reference.id }
}

describe("POST /api/characters/:id/reference-variations — validation", () => {
  it("404 для несуществующего персонажа", async () => {
    const user = await createTestUser({ canRunAgent: true })
    await expect(
      $fetch("/api/characters/nonexistent-xyz/reference-variations", {
        method: "POST",
        headers: authHeaders(user.id),
        body: { count: 1 },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("403 без canRunAgent", async () => {
    const user = await createTestUser({ canRunAgent: false, canAdmin: false })
    const { character } = await createCharacterWithPortrait()
    await expect(
      $fetch(`/api/characters/${character.id}/reference-variations`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { count: 1 },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("400 на count вне диапазона", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createCharacterWithPortrait()
    for (const count of [0, 99]) {
      await expect(
        $fetch(`/api/characters/${character.id}/reference-variations`, {
          method: "POST",
          headers: authHeaders(user.id),
          body: { count },
        }),
      ).rejects.toMatchObject({ statusCode: 400 })
    }
  })

  it("400 на модель не той способности", async () => {
    // text_to_image рисует с нуля: референс он не примет, и «тот же человек»
    // превратится в незнакомца за наши деньги.
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createCharacterWithPortrait()
    await expect(
      $fetch(`/api/characters/${character.id}/reference-variations`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { count: 1, modelId: "fal-ai/flux/schnell" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 на чужой sourceReferenceId", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const mine = await createCharacterWithPortrait()
    const other = await createCharacterWithPortrait()
    await expect(
      $fetch(`/api/characters/${mine.character.id}/reference-variations`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { count: 1, sourceReferenceId: other.sourceReferenceId },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 когда у персонажа нет ни одного кадра", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const seed = Math.floor(Math.random() * 1_000_000_000)
    const app = await prisma.app.create({
      data: { name: `Empty App ${seed}`, description: "Test", keywords: ["test"] },
    })
    const character = await prisma.character.create({
      data: { appId: app.id, name: `Empty Hero ${seed}`, description: "x", role: "protagonist" },
    })
    await expect(
      $fetch(`/api/characters/${character.id}/reference-variations`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { count: 1 },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe("POST /api/characters/:id/reference-variations — happy path", () => {
  it("создаёт кадры того же персонажа с generation* полями", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character, sourceReferenceId } = await createCharacterWithPortrait()

    const res = await $fetch<VariationResponse>(
      `/api/characters/${character.id}/reference-variations`,
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: { count: 2, sourceReferenceId },
      },
    )

    expect(res.data.failed).toHaveLength(0)
    expect(res.data.sourceReferenceId).toBe(sourceReferenceId)
    expect(res.data.modelId).toBe("black-forest-labs/flux-kontext-dev")
    expect(res.data.created).toHaveLength(2)

    const presetKeys = REFERENCE_VARIATION_PRESETS.map(preset => preset.key)
    for (const item of res.data.created) {
      expect(presetKeys).toContain(item.presetKey)
      // Ротация ставит kind="face" впереди прочих кадров: вариация в другом
      // виде никогда не была бы выбрана.
      expect(item.reference.kind).toBe("face")
      expect(item.reference.generationModel).toBe("black-forest-labs/flux-kontext-dev")
      expect(item.reference.generationPrompt?.toLowerCase()).toContain("same person")
    }

    const refs = await prisma.characterReferenceImage.findMany({
      where: { characterId: character.id },
    })
    // Исходник плюс вариации — если, конечно, мок не отдал тот же файл дважды.
    expect(refs.length).toBeGreaterThan(1)
  })

  it("повтор того же слота не создаёт второй оплаченный prediction", async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character, sourceReferenceId } = await createCharacterWithPortrait()

    const first = await $fetch<VariationResponse>(
      `/api/characters/${character.id}/reference-variations`,
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: { count: 1, sourceReferenceId, startIndex: 0 },
      },
    )
    expect(first.data.created[0]!.costUsd).toBeGreaterThan(0)

    const second = await $fetch<VariationResponse>(
      `/api/characters/${character.id}/reference-variations`,
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: { count: 1, sourceReferenceId, startIndex: 0 },
      },
    )
    expect(second.data.created[0]!.presetKey).toBe(first.data.created[0]!.presetKey)
    // Результат уже лежит в нашем хранилище — провайдеру повторно не платим.
    expect(second.data.created[0]!.costUsd).toBe(0)
    expect(second.data.costUsd).toBe(0)

    const predictions = await prisma.mediaPrediction.findMany({
      where: {
        idempotencyKey: {
          startsWith: `image_to_image:v1:character-reference:${sourceReferenceId}:variation:`,
        },
      },
    })
    expect(predictions).toHaveLength(1)
    expect(predictions[0]!.videoId).toBeNull()
  })
})
