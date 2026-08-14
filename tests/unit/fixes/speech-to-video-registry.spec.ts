/**
 * Способность speech_to_video: портрет плюс готовое аудио — сразу говорящее видео.
 *
 * Заменяет для аватарных сцен связку image_to_video + lip_sync: движение
 * выводится из речи, а не генерируется отдельно и потом накрывается губами.
 * Спека и мотивация — docs/superpowers/specs/2026-08-14-avatar-pipeline.md.
 *
 * Payload сверен со схемами, снятыми с Replicate 14.08.2026
 * (`https://replicate.com/api/models/<owner>/<name>/versions`). Имена полей и
 * значения enum здесь дословные: маппер, отправляющий модель в чужом формате,
 * стоит денег и молчит об ошибке.
 */

import { describe, expect, it } from "vitest"
import {
  MEDIA_CAPABILITIES,
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
  if (spec.capability !== "speech_to_video") throw new Error("ожидалась спека speech_to_video")
  return spec
}

describe("speech_to_video в реестре способностей", () => {
  it("объявлена наравне с остальными способностями", () => {
    expect(MEDIA_CAPABILITIES).toContain("speech_to_video")
  })

  it("маршрут по умолчанию ведёт на Replicate", () => {
    // AGENTS.md: Replicate — обязательный основной провайдер медиа-моделей.
    const route = resolveMediaRoute("speech_to_video", null, EMPTY_ENV)
    expect(route.primary.provider).toBe("replicate")
    expect(route.primary.capability).toBe("speech_to_video")
  })

  it("env-дефолт способности перекрывает порядок реестра", () => {
    const route = resolveMediaRoute("speech_to_video", null, {
      MEDIA_MODEL_SPEECH_TO_VIDEO: "veed/fabric-1.0",
    })
    expect(route.primary.id).toBe("veed/fabric-1.0")
  })

  it("включены только модели с подтверждённой ценой", () => {
    // §7 п.2 спецификации: цены fabric, omni-human и wan-s2v не опубликованы.
    // Пускать их в смету и ledger нельзя, пока цена не подтверждена.
    for (const spec of listMediaSpecs("speech_to_video")) {
      if (spec.integrated) expect(spec.billingConfirmed).toBe(true)
    }
  })
})

describe("prunaai/p-video-avatar — маппер входа", () => {
  it("собирает payload по снятой схеме", () => {
    const spec = specFor("prunaai/p-video-avatar")
    expect(spec.mapInput({
      imageUrl: "https://files/portrait.jpg",
      audioUrl: "https://files/line.mp3",
      durationSec: 9,
      resolution: "1080p",
      prompt: "спокойно рассказывает о своём опыте",
      seed: 42,
    })).toEqual({
      payload: {
        image: "https://files/portrait.jpg",
        audio: "https://files/line.mp3",
        resolution: "1080p",
        video_prompt: "спокойно рассказывает о своём опыте",
        seed: 42,
      },
      effectiveDurationSec: 9,
    })
  })

  it("встроенный TTS не используется", () => {
    // Голос ведущего задан voiceoverVoiceId и синтезируется своим маршрутом.
    // Подмена его на чужой набор голосов сменила бы голос персонажа молча.
    const spec = specFor("prunaai/p-video-avatar")
    const { payload } = spec.mapInput({
      imageUrl: "https://files/portrait.jpg",
      audioUrl: "https://files/line.mp3",
      durationSec: 5,
    })
    expect(payload).not.toHaveProperty("voice_script")
    expect(payload).not.toHaveProperty("voice")
    expect(payload).not.toHaveProperty("voice_language")
  })

  it("неизвестное разрешение сводится к допустимому, а не уходит как есть", () => {
    const spec = specFor("prunaai/p-video-avatar")
    const { payload } = spec.mapInput({
      imageUrl: "https://files/portrait.jpg",
      audioUrl: "https://files/line.mp3",
      durationSec: 5,
      resolution: "4K",
    })
    expect(["720p", "1080p"]).toContain(payload.resolution)
  })

  it("пустой портрет или аудио — отказ до оплаты", () => {
    const spec = specFor("prunaai/p-video-avatar")
    expect(() => spec.mapInput({ imageUrl: "", audioUrl: "https://files/line.mp3", durationSec: 5 }))
      .toThrow()
    expect(() => spec.mapInput({ imageUrl: "https://files/portrait.jpg", audioUrl: "", durationSec: 5 }))
      .toThrow()
  })

  it("цена считается по длине аудио и разрешению", () => {
    // $0.025/с в 720p и $0.045/с в 1080p — со страницы модели.
    const spec = specFor("prunaai/p-video-avatar")
    expect(estimateMediaCost(spec, { outputSeconds: 10, resolution: "720p" })).toBeCloseTo(0.25, 5)
    expect(estimateMediaCost(spec, { outputSeconds: 10, resolution: "1080p" })).toBeCloseTo(0.45, 5)
  })
})

describe("veed/fabric-1.0 — маппер входа", () => {
  it("собирает payload по снятой схеме: только image, audio и resolution", () => {
    const spec = specFor("veed/fabric-1.0")
    expect(spec.mapInput({
      imageUrl: "https://files/portrait.jpg",
      audioUrl: "https://files/line.mp3",
      durationSec: 40,
      resolution: "720p",
      prompt: "промпта у модели нет",
    })).toEqual({
      payload: {
        image: "https://files/portrait.jpg",
        audio: "https://files/line.mp3",
        resolution: "720p",
      },
      effectiveDurationSec: 40,
    })
  })

  it("1080p сводится к максимуму модели — 720p", () => {
    const spec = specFor("veed/fabric-1.0")
    const { payload } = spec.mapInput({
      imageUrl: "https://files/portrait.jpg",
      audioUrl: "https://files/line.mp3",
      durationSec: 10,
      resolution: "1080p",
    })
    expect(["480p", "720p"]).toContain(payload.resolution)
  })

  it("аудио длиннее потолка модели отвергается до оплаты", () => {
    // fabric-1.0 держит 60 секунд. Узнать об этом после оплаты — плохой размен.
    const spec = specFor("veed/fabric-1.0")
    expect(() => spec.mapInput({
      imageUrl: "https://files/portrait.jpg",
      audioUrl: "https://files/line.mp3",
      durationSec: 75,
    })).toThrow(/60/)
  })
})

describe("wan-video/wan-2.2-s2v — маппер входа", () => {
  it("промпт обязателен по схеме модели", () => {
    const spec = specFor("wan-video/wan-2.2-s2v")
    const { payload } = spec.mapInput({
      imageUrl: "https://files/portrait.jpg",
      audioUrl: "https://files/line.mp3",
      durationSec: 8,
      prompt: "женщина спокойно рассказывает в камеру",
    })
    expect(payload).toMatchObject({
      image: "https://files/portrait.jpg",
      audio: "https://files/line.mp3",
      prompt: "женщина спокойно рассказывает в камеру",
    })
  })

  it("без промпта подставляется описание говорящей головы, а не пустая строка", () => {
    const spec = specFor("wan-video/wan-2.2-s2v")
    const { payload } = spec.mapInput({
      imageUrl: "https://files/portrait.jpg",
      audioUrl: "https://files/line.mp3",
      durationSec: 8,
    })
    expect(String(payload.prompt).length).toBeGreaterThan(0)
  })
})

describe("bytedance/omni-human — маппер входа", () => {
  it("отправляет ровно два поля, которые принимает модель", () => {
    const spec = specFor("bytedance/omni-human")
    expect(spec.mapInput({
      imageUrl: "https://files/portrait.jpg",
      audioUrl: "https://files/line.mp3",
      durationSec: 12,
      resolution: "1080p",
      prompt: "модель промпта не принимает",
    }).payload).toEqual({
      image: "https://files/portrait.jpg",
      audio: "https://files/line.mp3",
    })
  })
})

describe("разбор выхода", () => {
  it("одна строка-URL — как во всех четырёх схемах", () => {
    for (const spec of listMediaSpecs("speech_to_video")) {
      expect(spec.extractOutput("https://replicate.delivery/out.mp4").urls)
        .toEqual(["https://replicate.delivery/out.mp4"])
    }
  })
})
