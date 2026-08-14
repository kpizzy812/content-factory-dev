/**
 * Способность image_to_image: из одного портрета — набор кадров того же человека.
 *
 * Этап 5 спецификации docs/superpowers/specs/2026-08-14-avatar-pipeline.md.
 * Сегодня аватарной ротации нужно 5-10 снятых фотографий человека, иначе все
 * сцены показывают один кадр. С генерацией вариаций хватает одного референса:
 * ракурс, свет, одежда и обстановка меняются, лицо остаётся тем же.
 *
 * Схемы сняты с Replicate 14.08.2026 через
 * `https://replicate.com/api/models/<owner>/<name>/versions`, цены — из
 * `billingConfig` страницы модели. Имена полей и значения enum здесь дословные:
 * маппер, отправляющий модель в чужом формате, стоит денег и молчит об ошибке.
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
const PORTRAIT = "https://files/portrait.jpg"

function specFor(reference: string): MediaModelSpec {
  const spec = findMediaSpec(reference)
  if (!spec) throw new Error(`Спека не найдена: ${reference}`)
  if (spec.capability !== "image_to_image") throw new Error("ожидалась спека image_to_image")
  return spec
}

describe("image_to_image в реестре способностей", () => {
  it("объявлена наравне с остальными способностями", () => {
    expect(MEDIA_CAPABILITIES).toContain("image_to_image")
  })

  it("маршрут по умолчанию ведёт на Replicate", () => {
    // AGENTS.md: Replicate — обязательный основной провайдер медиа-моделей.
    const route = resolveMediaRoute("image_to_image", null, EMPTY_ENV)
    expect(route.primary.provider).toBe("replicate")
    expect(route.primary.capability).toBe("image_to_image")
  })

  it("по умолчанию берётся самая дешёвая подтверждённая модель", () => {
    // $0.025 за кадр против $0.04 у pro и $0.08 у max. Вариаций делают пачками,
    // и разница в четыре раза на партии — это не округление.
    const route = resolveMediaRoute("image_to_image", null, EMPTY_ENV)
    expect(route.primary.id).toBe("black-forest-labs/flux-kontext-dev")
  })

  it("env-дефолт способности перекрывает порядок реестра", () => {
    const route = resolveMediaRoute("image_to_image", null, {
      MEDIA_MODEL_IMAGE_TO_IMAGE: "black-forest-labs/flux-kontext-pro",
    })
    expect(route.primary.id).toBe("black-forest-labs/flux-kontext-pro")
  })

  it("включены только модели с подтверждённой ценой", () => {
    for (const spec of listMediaSpecs("image_to_image")) {
      if (spec.integrated) expect(spec.billingConfirmed).toBe(true)
    }
  })

  it("способность не путается с text_to_image", () => {
    // Обе рисуют картинку, но у image_to_image вход другой: без референса
    // получится не «тот же человек в профиль», а незнакомый человек.
    const t2i = resolveMediaRoute("text_to_image", null, EMPTY_ENV)
    expect(t2i.primary.capability).toBe("text_to_image")
    for (const spec of listMediaSpecs("image_to_image")) {
      expect(spec.capability).toBe("image_to_image")
    }
  })
})

describe("black-forest-labs/flux-kontext-dev — маппер входа", () => {
  it("собирает payload по снятой схеме", () => {
    // Схема: required = [prompt, input_image]; aspect_ratio с match_input_image;
    // output_format = webp|jpg|png.
    const spec = specFor("black-forest-labs/flux-kontext-dev")
    expect(spec.mapInput({
      imageUrl: PORTRAIT,
      prompt: "the same woman, three-quarter view, beige knit sweater",
      count: 1,
      seed: 7,
    })).toEqual({
      payload: {
        prompt: "the same woman, three-quarter view, beige knit sweater",
        input_image: PORTRAIT,
        aspect_ratio: "match_input_image",
        output_format: "jpg",
        seed: 7,
      },
    })
  })

  it("заданный кадр сводится к допустимой пропорции модели", () => {
    const spec = specFor("black-forest-labs/flux-kontext-dev")
    const { payload } = spec.mapInput({
      imageUrl: PORTRAIT,
      prompt: "the same woman, profile view",
      count: 1,
      width: 1024,
      height: 1820,
    })
    expect(payload.aspect_ratio).toBe("9:16")
  })

  it("без референса и без промпта — отказ до оплаты", () => {
    // Оба поля обязательны по схеме модели.
    const spec = specFor("black-forest-labs/flux-kontext-dev")
    expect(() => spec.mapInput({ imageUrl: "", prompt: "the same woman", count: 1 })).toThrow()
    expect(() => spec.mapInput({ imageUrl: PORTRAIT, prompt: "  ", count: 1 })).toThrow()
  })

  it("больше одного кадра за запрос не просим", () => {
    // Схема kontext не знает num_outputs, а разбор выхода берёт один URL.
    const spec = specFor("black-forest-labs/flux-kontext-dev")
    expect(() => spec.mapInput({ imageUrl: PORTRAIT, prompt: "the same woman", count: 2 }))
      .toThrow()
  })

  it("цена — $0.025 за кадр, со страницы модели", () => {
    const spec = specFor("black-forest-labs/flux-kontext-dev")
    expect(spec.billingConfirmed).toBe(true)
    expect(estimateMediaCost(spec, { images: 1 })).toBeCloseTo(0.025, 6)
    expect(estimateMediaCost(spec, { images: 4 })).toBeCloseTo(0.1, 6)
  })
})

describe("black-forest-labs/flux-kontext-pro и max — маппер входа", () => {
  it("pro собирает payload по своей схеме", () => {
    // У pro/max нет guidance и num_inference_steps, зато есть safety_tolerance
    // и prompt_upsampling. Апсемплинг промпта не включаем: он переписывает
    // инструкцию, а мы просим сохранить конкретного человека.
    const spec = specFor("black-forest-labs/flux-kontext-pro")
    expect(spec.mapInput({
      imageUrl: PORTRAIT,
      prompt: "the same man, standing in a bright office",
      count: 1,
    })).toEqual({
      payload: {
        prompt: "the same man, standing in a bright office",
        input_image: PORTRAIT,
        aspect_ratio: "match_input_image",
        output_format: "jpg",
      },
    })
    expect(spec.mapInput({ imageUrl: PORTRAIT, prompt: "x", count: 1 }).payload)
      .not.toHaveProperty("prompt_upsampling")
  })

  it("цены pro и max подтверждены страницей модели", () => {
    expect(estimateMediaCost(specFor("black-forest-labs/flux-kontext-pro"), { images: 1 }))
      .toBeCloseTo(0.04, 6)
    expect(estimateMediaCost(specFor("black-forest-labs/flux-kontext-max"), { images: 1 }))
      .toBeCloseTo(0.08, 6)
  })
})

describe("bytedance/flux-pulid — маппер входа", () => {
  it("собирает payload по снятой схеме: лицо в main_face_image", () => {
    // Схема: required = [main_face_image]; width/height 256-1536;
    // num_outputs 1-4; output_format = png|jpg|webp.
    const spec = specFor("bytedance/flux-pulid")
    expect(spec.mapInput({
      imageUrl: PORTRAIT,
      prompt: "portrait of the same woman in a cafe, cinematic light",
      count: 1,
      width: 896,
      height: 1152,
      seed: 3,
    })).toEqual({
      payload: {
        main_face_image: PORTRAIT,
        prompt: "portrait of the same woman in a cafe, cinematic light",
        width: 896,
        height: 1152,
        num_outputs: 1,
        output_format: "jpg",
        seed: 3,
      },
    })
  })

  it("кадр крупнее потолка модели сводится к 1536, а не уходит как есть", () => {
    const spec = specFor("bytedance/flux-pulid")
    const { payload } = spec.mapInput({
      imageUrl: PORTRAIT,
      prompt: "the same woman",
      count: 1,
      width: 1080,
      height: 1920,
    })
    expect(payload.width).toBeLessThanOrEqual(1536)
    expect(payload.height).toBeLessThanOrEqual(1536)
    expect(Number(payload.width) / Number(payload.height)).toBeCloseTo(1080 / 1920, 2)
  })

  it("тариф по времени GPU не подтверждён — модель выключена", () => {
    // Страница модели даёт только оценку «≈$0.021 за прогон, A100 80GB».
    // Оценка — не тариф: в смету такую модель не пускаем (§7 п.2 спецификации).
    const spec = specFor("bytedance/flux-pulid")
    expect(spec.billing.unit).toBe("hardware_second")
    expect(spec.billingConfirmed).toBe(false)
    expect(spec.integrated).toBe(false)
  })
})

describe("разбор выхода", () => {
  it("kontext отдаёт одну строку-URL", () => {
    for (const id of [
      "black-forest-labs/flux-kontext-dev",
      "black-forest-labs/flux-kontext-pro",
      "black-forest-labs/flux-kontext-max",
    ]) {
      expect(specFor(id).extractOutput("https://replicate.delivery/out.jpg").urls)
        .toEqual(["https://replicate.delivery/out.jpg"])
    }
  })

  it("pulid отдаёт массив URL — берём первый", () => {
    const spec = specFor("bytedance/flux-pulid")
    expect(spec.extractOutput(["https://replicate.delivery/a.jpg"]).urls)
      .toEqual(["https://replicate.delivery/a.jpg"])
  })
})
