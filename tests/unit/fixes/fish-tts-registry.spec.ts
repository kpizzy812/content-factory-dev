/**
 * Fish Audio как третий провайдер медиаконтура.
 *
 * Взят ради двух вещей, обе измерены: на русском он вдвое дешевле MiniMax
 * ($0.03 против $0.06 за 1000 символов) и звучит живее — заказчик сравнил на
 * одной реплике голосом Лианы.
 *
 * Транспорт у него третий по счёту. Replicate — асинхронный prediction, fal —
 * синхронная очередь со ссылкой на выход, Fish отдаёт **байты аудио прямо в
 * ответе**. Отсюда `execution: "sync_bytes"`: разбирать URL нечего.
 *
 * Тарифицируется по UTF-8 БАЙТАМ, а не символам — и для кириллицы это вдвое
 * больше, чем кажется: два байта на букву.
 *
 * Схема снята с `https://api.fish.audio/openapi.json` 15.08.2026.
 */

import { describe, expect, it } from "vitest"
import {
  estimateMediaCost,
  findMediaSpec,
  listMediaSpecs,
  resolveMediaRoute,
} from "../../../server/utils/media-provider/registry"
import type { MediaModelSpec } from "../../../server/utils/media-provider/types"

const EMPTY_ENV: Record<string, string | undefined> = {}

function specFor(reference: string): MediaModelSpec {
  const spec = findMediaSpec(reference)
  if (!spec) throw new Error(`Спека не найдена: ${reference}`)
  return spec
}

const baseInput = {
  text: "Замер бесплатный, но замерщик уедет с готовым расчётом.",
  voiceId: "a41ce4ce7d2f4afe9dac0026b6555bf2",
  speed: 1,
  language: "ru",
  format: "mp3",
}

describe("Fish в реестре", () => {
  it("объявлен провайдером наравне с replicate и fal", () => {
    const fish = listMediaSpecs("text_to_speech").filter(spec => spec.provider === "fish")
    expect(fish.length).toBeGreaterThan(0)
    for (const spec of fish) expect(spec.capability).toBe("text_to_speech")
  })

  it("отдаёт байты, а не ссылку — это отдельный способ исполнения", () => {
    expect(specFor("fish:s2.1-pro-free").execution).toBe("sync_bytes")
  })

  it("маршрут по умолчанию не трогается: основной провайдер прежний", () => {
    // PROJECT_CONTEXT §5 — Replicate основной. Fish включается персонажу через
    // Character.voiceModelId, а не подменой дефолта у всех роликов разом.
    expect(resolveMediaRoute("text_to_speech", null, EMPTY_ENV).primary.provider).toBe("replicate")
  })

  it("выбирается явно по id", () => {
    expect(resolveMediaRoute("text_to_speech", "s2.1-pro-free", EMPTY_ENV).primary.provider).toBe("fish")
  })
})

describe("маппер входа по снятой схеме", () => {
  it("собирает payload /v1/tts", () => {
    const spec = specFor("fish:s2.1-pro-free")
    expect(spec.mapInput(baseInput)).toEqual({
      payload: {
        text: baseInput.text,
        reference_id: "a41ce4ce7d2f4afe9dac0026b6555bf2",
        format: "mp3",
        mp3_bitrate: 128,
        prosody: { speed: 1 },
      },
    })
  })

  it("темп зажимается в диапазон модели 0.5–2.0", () => {
    const spec = specFor("fish:s2.1-pro-free")
    expect((spec.mapInput({ ...baseInput, speed: 9 }).payload.prosody as { speed: number }).speed).toBe(2)
    expect((spec.mapInput({ ...baseInput, speed: 0.1 }).payload.prosody as { speed: number }).speed).toBe(0.5)
  })

  it("поля языка в payload нет — модель определяет его сама", () => {
    // В схеме /v1/tts языка не существует. Подставлять несуществующее поле
    // значит получить отказ на весь запрос.
    const spec = specFor("fish:s2.1-pro-free")
    const payload = spec.mapInput(baseInput).payload
    expect(payload).not.toHaveProperty("language")
    expect(payload).not.toHaveProperty("language_boost")
  })

  it("пустой текст — отказ до вызова", () => {
    const spec = specFor("fish:s2.1-pro-free")
    expect(() => spec.mapInput({ ...baseInput, text: "  " })).toThrow()
  })

  it("текст длиннее предела тарифа отвергается", () => {
    const spec = specFor("fish:s2.1-pro-free")
    expect(() => spec.mapInput({ ...baseInput, text: "я".repeat(5000) })).toThrow()
  })
})

describe("тариф по UTF-8 байтам", () => {
  it("кириллица считается по два байта на букву", () => {
    // $15 за 1 млн байт. 1000 русских символов = 2000 байт = $0.03 —
    // вдвое дешевле MiniMax ($0.06 за те же 1000 символов).
    const spec = specFor("fish:s2.1-pro")
    expect(estimateMediaCost(spec, { utf8Bytes: 2000 })).toBeCloseTo(0.03, 6)
  })

  it("платная модель ждёт подтверждения счётом", () => {
    // Официальная страница тарифов отдала 404, число взято из обзоров.
    expect(specFor("fish:s2.1-pro").billingConfirmed).toBe(false)
  })

  it("бесплатная модель стоит ноль и это подтверждено прогоном", () => {
    const free = specFor("fish:s2.1-pro-free")
    expect(estimateMediaCost(free, { utf8Bytes: 2000 })).toBe(0)
    expect(free.billingConfirmed).toBe(true)
  })
})

describe("разбор выхода", () => {
  it("ссылок нет: байты приходят в теле ответа", () => {
    const spec = specFor("fish:s2.1-pro-free")
    expect(spec.extractOutput(null)).toEqual({ urls: [], contentType: "audio/mpeg" })
  })
})
