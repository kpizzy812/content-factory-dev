/**
 * Идентичность медиазадачи, не принадлежащей ролику.
 *
 * До этого ключ идемпотентности строился только от `videoId`, и асинхронный
 * контур Replicate честно отказывался работать без него — это записано в
 * `server/api/characters/[id]/generate-reference.post.ts`: там выбор
 * Replicate-модели закрыт, «пока не появится своя схема идентичности».
 *
 * Вариации портрета персонажа — ровно такая задача: ролика нет, а платный
 * prediction есть, и повтор запроса не должен оплачиваться второй раз
 * (spec 2026-08-14-avatar-pipeline, этап 5).
 */

import { describe, expect, it, vi } from "vitest"
import { buildMediaIdentity } from "../../../server/utils/media-provider/media-identity"
import { runMediaTask } from "../../../server/utils/media-provider/run-media-task"
import { resolveMediaRoute } from "../../../server/utils/media-provider/registry"
import type { ReplicateConfig } from "../../../server/utils/replicate/config"

const MOCK_REPLICATE_CONFIG: ReplicateConfig = {
  apiToken: null,
  webhookSigningSecret: null,
  webhookBaseUrl: null,
  webhookUrl: null,
  defaultLipSyncModel: "kwaivgi/kling-lip-sync",
  defaultTtsModel: "minimax/speech-02-turbo",
  mockMode: true,
  recoveryEnabled: false,
  fallbackProvider: null,
}

describe("buildMediaIdentity с областью субъекта", () => {
  it("строит ключ без videoId", () => {
    const identity = buildMediaIdentity({
      capability: "image_to_image",
      subjectScope: "character:chr_1:variation:0",
      modelId: "black-forest-labs/flux-kontext-dev",
      payload: { prompt: "the same woman, profile view" },
    })
    expect(identity.attemptCeilingScope)
      .toBe("image_to_image:v1:character:chr_1:variation:0:model:black-forest-labs/flux-kontext-dev")
    expect(identity.idempotencyKey.startsWith(`${identity.attemptCeilingScope}:input:`)).toBe(true)
  })

  it("тот же вход — тот же ключ, другой промпт — другой", () => {
    const base = {
      capability: "image_to_image" as const,
      subjectScope: "character:chr_1:variation:0",
      modelId: "black-forest-labs/flux-kontext-dev",
    }
    const first = buildMediaIdentity({ ...base, payload: { prompt: "profile view" } })
    const same = buildMediaIdentity({ ...base, payload: { prompt: "profile view" } })
    const other = buildMediaIdentity({ ...base, payload: { prompt: "three-quarter view" } })

    expect(same.idempotencyKey).toBe(first.idempotencyKey)
    expect(other.idempotencyKey).not.toBe(first.idempotencyKey)
    // Потолок попыток общий: смена промпта открывает свежий узкий бюджет,
    // но не бесконечную серию перегенераций одного и того же слота.
    expect(other.attemptCeilingScope).toBe(first.attemptCeilingScope)
  })

  it("раскладка ключа роликов не меняется", () => {
    // Ключи роликов уже лежат в БД: правка ослепила бы подсчёт потраченных
    // попыток, а уже созданные записи выпали бы из своей области бюджета.
    const identity = buildMediaIdentity({
      capability: "text_to_image",
      videoId: 42,
      sceneOrder: 3,
      modelId: "black-forest-labs/flux-dev",
      payload: { prompt: "kitchen" },
    })
    expect(identity.attemptCeilingScope)
      .toBe("text_to_image:v1:video:42:scene:3:model:black-forest-labs/flux-dev")
  })

  it("без ролика и без субъекта — отказ, а не безымянный ключ", () => {
    expect(() => buildMediaIdentity({
      capability: "image_to_image",
      modelId: "black-forest-labs/flux-kontext-dev",
      payload: { prompt: "x" },
    })).toThrow()
  })
})

describe("runMediaTask для задачи вне ролика", () => {
  it("асинхронный prediction выполняется по identityScope", async () => {
    const execute = vi.fn(async () => ({
      predictionId: "pred_1",
      persistedStorageKey: "characters/chr_1/variation_0.jpg",
    }))
    const route = resolveMediaRoute("image_to_image", null, {})

    const result = await runMediaTask({
      capability: "image_to_image",
      spec: route.primary,
      input: {
        imageUrl: "",
        prompt: "the same woman, profile view",
        count: 1,
      },
      inputUploads: [
        { field: "imageUrl", path: "/tmp/source.jpg", contentType: "image/jpeg" },
      ],
      identityScope: "character:chr_1:variation:0",
      unitKey: "character:chr_1:variation:0",
      outputPath: "/tmp/out.jpg",
    }, {
      replicateConfig: MOCK_REPLICATE_CONFIG,
      requirePaidApis: () => {},
      fingerprintFile: async () => "abc123",
      uploadReplicateInput: async () => ({ id: "upload_1", url: "https://replicate/in.jpg" }),
      deleteReplicateInput: async () => {},
      findPersistedPrediction: async () => null,
      materializeStorageFile: async () => {},
      executeReplicatePrediction: execute,
    })

    expect(result.source).toBe("generated")
    expect(result.externalRef).toBe("pred_1")
    expect(result.idempotencyKey).toContain("character:chr_1:variation:0")
    // Цена задачи — по единице биллинга спеки: $0.025 за кадр.
    expect(result.costUsd).toBeCloseTo(0.025, 6)

    const submission = execute.mock.calls[0]![0]
    expect(submission.videoId).toBeNull()
    // В payload уходит адрес заливки, а в ключ — отпечаток содержимого.
    expect(submission.input.input_image).toBe("https://replicate/in.jpg")
    expect(result.idempotencyKey).not.toContain("https://replicate/in.jpg")
  })

  it("повтор той же задачи не создаёт второй оплаченный prediction", async () => {
    const execute = vi.fn()
    const route = resolveMediaRoute("image_to_image", null, {})

    const result = await runMediaTask({
      capability: "image_to_image",
      spec: route.primary,
      input: { imageUrl: "https://files/source.jpg", prompt: "the same woman", count: 1 },
      identityScope: "character:chr_1:variation:0",
      unitKey: "character:chr_1:variation:0",
      outputPath: "/tmp/out.jpg",
    }, {
      replicateConfig: MOCK_REPLICATE_CONFIG,
      requirePaidApis: () => {},
      findPersistedPrediction: async () => ({
        id: "pred_1",
        externalId: "ext_1",
        persistedStorageKey: "characters/chr_1/variation_0.jpg",
      }),
      materializeStorageFile: async () => {},
      executeReplicatePrediction: execute,
    })

    expect(result.source).toBe("reused_prediction")
    expect(result.costUsd).toBe(0)
    expect(execute).not.toHaveBeenCalled()
  })

  it("без ролика и без identityScope задача Replicate по-прежнему отказывает", async () => {
    const route = resolveMediaRoute("image_to_image", null, {})
    await expect(runMediaTask({
      capability: "image_to_image",
      spec: route.primary,
      input: { imageUrl: "https://files/source.jpg", prompt: "the same woman", count: 1 },
      unitKey: "character:chr_1:variation:0",
      outputPath: "/tmp/out.jpg",
    }, {
      replicateConfig: MOCK_REPLICATE_CONFIG,
      requirePaidApis: () => {},
      findPersistedPrediction: async () => null,
      materializeStorageFile: async () => {},
      executeReplicatePrediction: async () => ({ predictionId: "p", persistedStorageKey: "k" }),
    })).rejects.toThrow(/идемпотентност/i)
  })
})
