/**
 * Регрессия на шаг 5 спецификации «Replicate как основной медиаконтур»
 * (`docs/superpowers/specs/2026-08-07-replicate-media-contour.md`, §4 и §5.1).
 *
 * Два зафиксированных здесь свойства:
 * 1. Мок Replicate отдаёт выход того типа, которого требует способность, —
 *    иначе интеграционный тест картинки скачивает mp4 под именем png и
 *    расхождение всплывает только на реальных деньгах.
 * 2. Разбор выхода в `client.ts` не выбирает первый элемент массива молча.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import type { MediaModelSpec } from "../../../server/utils/media-provider/types"
import { resolveMediaModel } from "../../../server/utils/media-provider/registry"
import {
  createMockReplicateProvider,
  mockReplicateOutputUrl,
} from "../../../server/utils/replicate/mock"
import { normalizeReplicatePrediction } from "../../../server/utils/replicate/client"

/**
 * Спека под произвольную способность.
 *
 * Реестр способностей расширяется отдельной задачей (шаг 0 плана), поэтому
 * `MediaCapability` пока состоит из одного `lip_sync`. Мок обязан быть готов
 * раньше реестра — отсюда приведение типа, а не ожидание чужой правки.
 */
function specFor(capability: string): MediaModelSpec {
  return {
    ...resolveMediaModel("lip_sync"),
    id: `mock-owner/${capability}`,
    capability,
  } as unknown as MediaModelSpec
}

async function succeededOutput(capability: string, idempotencyKey: string): Promise<string | null> {
  const provider = createMockReplicateProvider()
  const created = await provider.create({
    model: specFor(capability),
    input: {},
    webhookUrl: null,
    idempotencyKey,
  })
  const completed = await provider.get(created.externalId)
  expect(completed.status).toBe("succeeded")
  return completed.outputUrl
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("мок Replicate отдаёт выход по способности", () => {
  it("даёт png картинке, mp3 речи и mp4 видео-способностям", async () => {
    await expect(succeededOutput("text_to_image", "video:1:scene:1")).resolves.toMatch(/\.png$/)
    await expect(succeededOutput("text_to_speech", "video:1:scene:2")).resolves.toMatch(/\.mp3$/)
    await expect(succeededOutput("text_to_video", "video:1:scene:3")).resolves.toMatch(/\.mp4$/)
    await expect(succeededOutput("image_to_video", "video:1:scene:4")).resolves.toMatch(/\.mp4$/)
    await expect(succeededOutput("lip_sync", "video:1:scene:5")).resolves.toMatch(/\.mp4$/)
  })

  it("знает выход аватарных сцен и вариаций портрета", async () => {
    // speech_to_video завели в аватарной волне, но в мок не добавили: любой
    // прогон аватарной ветки в mock-режиме падал на «no output type».
    // image_to_image — вариации портрета, выход в том же jpg, что просит маппер.
    await expect(succeededOutput("speech_to_video", "video:2:scene:1")).resolves.toMatch(/\.mp4$/)
    await expect(succeededOutput("image_to_image", "character-reference:ref_1:variation:angle"))
      .resolves.toMatch(/\.jpg$/)
  })

  it("остаётся детерминированным и офлайн: тот же ключ — тот же выход", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const first = await succeededOutput("text_to_image", "video:7:scene:1")
    const second = await succeededOutput("text_to_image", "video:7:scene:1")
    const other = await succeededOutput("text_to_image", "video:7:scene:2")

    expect(first).toBe(second)
    expect(other).not.toBe(first)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("отдаёт mock:// URL, который заглушка загрузки разбирает без сети и без ffmpeg", async () => {
    const url = await succeededOutput("text_to_image", "video:8:scene:1")

    // Первый сегмент — генератор заглушки в mock/fal-mock.ts; ветки
    // video/image/audio там требуют ffmpeg и падают на кеше `<kind>.bin`.
    expect(url).toMatch(/^mock:\/\/replicate\//)
    // Расширение в конце пути — по нему prediction-service выбирает,
    // под каким расширением класть файл в хранилище.
    expect(new URL(url ?? "").pathname.endsWith(".png")).toBe(true)
  })

  it("падает на способности, для которой тип выхода не задан", async () => {
    const provider = createMockReplicateProvider()

    await expect(provider.create({
      model: specFor("b_roll"),
      input: {},
      webhookUrl: null,
      idempotencyKey: "video:9:scene:1",
    })).rejects.toThrow(/no output type for capability: b_roll/)
  })

  it("сохраняет явный override выхода для тестов, которым важен конкретный URL", async () => {
    const provider = createMockReplicateProvider({ outputUrl: "mock://replicate/output.mp4" })
    const created = await provider.create({
      model: specFor("text_to_image"),
      input: {},
      webhookUrl: null,
      idempotencyKey: "video:10:scene:1",
    })

    await expect(provider.get(created.externalId)).resolves.toMatchObject({
      outputUrl: "mock://replicate/output.mp4",
    })
  })

  it("не размывает выход между предсказаниями разных способностей", async () => {
    const provider = createMockReplicateProvider()
    const image = await provider.create({
      model: specFor("text_to_image"),
      input: {},
      webhookUrl: null,
      idempotencyKey: "video:11:scene:1",
    })
    const speech = await provider.create({
      model: specFor("text_to_speech"),
      input: {},
      webhookUrl: null,
      idempotencyKey: "video:11:scene:2",
    })

    await expect(provider.get(image.externalId)).resolves.toMatchObject({
      outputUrl: mockReplicateOutputUrl("text_to_image", image.externalId),
    })
    await expect(provider.get(speech.externalId)).resolves.toMatchObject({
      outputUrl: mockReplicateOutputUrl("text_to_speech", speech.externalId),
    })
  })
})

describe("разбор выхода prediction: один результат", () => {
  function raw(output: unknown) {
    return {
      id: "external_multi",
      status: "succeeded",
      model: "owner/text-to-image",
      output,
    }
  }

  it("берёт первый элемент массива и пишет об остальных в лог", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const normalized = normalizeReplicatePrediction(raw([
      "https://replicate.delivery/a.png",
      "https://replicate.delivery/b.png",
      "https://replicate.delivery/c.png",
    ]))

    expect(normalized.outputUrl).toBe("https://replicate.delivery/a.png")
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain("external_multi")
    expect(message).toContain("3")
    // Потерянные ссылки должны остаться видимыми в снапшоте.
    expect(normalized.raw.output).toEqual([
      "https://replicate.delivery/a.png",
      "https://replicate.delivery/b.png",
      "https://replicate.delivery/c.png",
    ])
  })

  it("молчит на одиночном выходе и на пустом массиве", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(normalizeReplicatePrediction(raw(["https://replicate.delivery/a.png"])).outputUrl)
      .toBe("https://replicate.delivery/a.png")
    expect(normalizeReplicatePrediction(raw([])).outputUrl).toBeNull()
    expect(normalizeReplicatePrediction(raw("https://replicate.delivery/one.mp4")).outputUrl)
      .toBe("https://replicate.delivery/one.mp4")
    expect(warn).not.toHaveBeenCalled()
  })

  it("не считает выходами нестроковые элементы массива", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const normalized = normalizeReplicatePrediction(raw([
      { url: "https://replicate.delivery/a.png" },
      "https://replicate.delivery/b.png",
    ]))

    expect(normalized.outputUrl).toBe("https://replicate.delivery/b.png")
    expect(warn).not.toHaveBeenCalled()
  })
})
