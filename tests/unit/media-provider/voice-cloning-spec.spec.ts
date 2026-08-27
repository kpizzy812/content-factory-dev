/**
 * Клонирование голоса как способность медиареестра (Task 5 плана
 * `docs/superpowers/plans/2026-08-17-segment-replace-and-ui.md`).
 *
 * Логика переезжает из `scripts/clone-voice.ts`: там она уже проверена на
 * боевых деньгах (голос Лианы склонирован 15.08.2026 —
 * `docs/operations/replicate.md` §«Голос ведущей»), и вместе с ней переезжают
 * все её проверки ДО оплаты. Прогон стоит $3 за штуку, поэтому цена ошибки в
 * маппере — не упавший тест, а списанные деньги.
 */

import { describe, expect, it } from "vitest"

import {
  estimateMediaCost,
  listMediaSpecs,
  mapMediaInput,
  MEDIA_CAPABILITIES,
  resolveMediaRoute,
} from "~~/server/utils/media-provider/registry"

describe("способность voice_cloning", () => {
  it("зарегистрирована и отдаёт JSON, а не файл", () => {
    const specs = listMediaSpecs("voice_cloning")

    expect(specs.length).toBeGreaterThan(0)
    expect(specs[0]!.provider).toBe("replicate")
    expect(specs[0]!.execution).toBe("sync_json")
    expect(MEDIA_CAPABILITIES).toContain("voice_cloning")
  })

  it("адресует ту самую модель, что оплачена скриптом", () => {
    // Идентификатор модели — не косметика: соседняя `minimax/speech-02-turbo`
    // тоже принимает voice_id, и опечатка здесь ушла бы в оплату чужой задачи.
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(spec.id).toBe("minimax/voice-cloning")
    expect(spec.registryKey).toBe("replicate:minimax-voice-cloning")
    // Официальная модель Replicate: адресуется именем, а не хешем версии
    // (в отличие от community-моделей транскрипции, где providerVersion
    // обязателен — см. докстринг providerVersion в types.ts).
    expect(spec.providerVersion).toBeUndefined()
  })

  it("цена подтверждена страницей модели — $3 за прогон", () => {
    // Отличие от транскрипции: здесь тариф снят со страницы модели ещё при
    // работе над scripts/clone-voice.ts (generic_output_count), поэтому спека
    // integrated.
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(spec.billing).toMatchObject({ unit: "flat", usd: 3 })
    expect(spec.billingConfirmed).toBe(true)
    expect(spec.integrated).toBe(true)
  })

  it("цена не зависит ни от длины образца, ни от времени железа", () => {
    // Единица `flat` — не украшение: у транскрипции она hardware_second, и
    // подмена единицы дала бы копейки вместо трёх долларов в смете.
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(estimateMediaCost(spec, { audioSeconds: 300 })).toBe(3)
    expect(estimateMediaCost(spec, { hardwareSeconds: 1 })).toBe(3)
    expect(estimateMediaCost(spec, {})).toBe(3)
  })

  it("маршрут способности ведёт на неё без env-переменных", () => {
    const route = resolveMediaRoute("voice_cloning", null, {})

    expect(route.primary.registryKey).toBe("replicate:minimax-voice-cloning")
    expect(route.fallback).toBeNull()
  })

  it("стенд может переопределить модель переменной MEDIA_MODEL_VOICE_CLONING", () => {
    // Ключ способности заведён в ENV_MODEL_KEYS: без записи реестр молча
    // игнорировал бы переменную и уводил бы прогон на дефолтную модель.
    expect(() => resolveMediaRoute("voice_cloning", null, {
      MEDIA_MODEL_VOICE_CLONING: "replicate:minimax-voice-cloning",
    })).not.toThrow()
    expect(() => resolveMediaRoute("voice_cloning", null, {
      MEDIA_MODEL_VOICE_CLONING: "openai/whisper",
    })).toThrow(/Unsupported media model for voice_cloning/)
  })

  it("собирает payload из нормализованного входа", () => {
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/sample.mp3",
      targetModel: "speech-02-turbo",
    })).toMatchObject({
      voice_file: "https://cdn.example.com/sample.mp3",
      model: "speech-02-turbo",
    })
  })

  it("необязательные флаги едут только когда их попросили", () => {
    const spec = listMediaSpecs("voice_cloning")[0]!

    const plain = mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/sample.mp3",
      targetModel: "speech-02-turbo",
    })
    // Ключ payload'а входит в idempotencyKey (`hashPayload`), поэтому лишнее
    // поле со значением по умолчанию — это другой ключ на том же входе, то
    // есть повторная оплата вместо переиспользования.
    expect(plain).not.toHaveProperty("need_noise_reduction")
    expect(plain).not.toHaveProperty("need_volume_normalization")

    expect(mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/sample.mp3",
      targetModel: "speech-02-turbo",
      noiseReduction: true,
      volumeNormalization: true,
    })).toMatchObject({
      need_noise_reduction: true,
      need_volume_normalization: true,
    })
  })

  it("отвергает ссылку без расширения ДО оплаты", () => {
    // Проверено при работе над скриптом: Files API отдаёт /v1/files/{id} без
    // расширения, а MiniMax определяет формат по нему и падает уже после
    // создания задачи — то есть за деньги.
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(() => mapMediaInput(spec, {
      audioUrl: "https://api.replicate.com/v1/files/abc123",
      targetModel: "speech-02-turbo",
    })).toThrow(/расширение/i)
  })

  it("отвергает неподдерживаемый формат", () => {
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(() => mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/sample.ogg",
      targetModel: "speech-02-turbo",
    })).toThrow(/формат/i)
  })

  it("расширение читается из пути, а не из хвоста подписанной ссылки", () => {
    // Публичная ссылка нашего хранилища приходит с подписью в query
    // (`?X-Amz-Signature=…`), а регистр расширения задаёт тот, кто загружал
    // файл. Обе формы — рабочие, и отказывать по ним значит не дать
    // склонировать голос вовсе.
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voices/sample.M4A?X-Amz-Signature=deadbeef",
      targetModel: "speech-02-turbo",
    })).toMatchObject({ voice_file: "https://cdn.example.com/voices/sample.M4A?X-Amz-Signature=deadbeef" })

    // Но расширение в САМОМ query, а не в пути, форматом файла не является:
    // MiniMax скачивает файл по пути и по нему же определяет тип.
    expect(() => mapMediaInput(spec, {
      audioUrl: "https://api.replicate.com/v1/files/abc123?name=sample.mp3",
      targetModel: "speech-02-turbo",
    })).toThrow(/расширение/i)
  })

  it("отвергает пустую целевую модель", () => {
    // Голос обучается ПОД конкретную TTS-модель: того же voice_id в другой
    // модели не существует (`Character.voiceModelId` в схеме про это же).
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(() => mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/sample.mp3",
      targetModel: "   ",
    })).toThrow(/targetModel/)
  })

  it("держит ограничения модели рядом со спекой", () => {
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(spec.constraints).toMatchObject({
      minDurationSec: 10,
      maxDurationSec: 300,
      maxBytes: 20 * 1024 * 1024,
    })
    expect((spec.constraints as { audioExtensions: readonly string[] }).audioExtensions)
      .toEqual([".mp3", ".m4a", ".wav"])
  })

  it("выход — структура с voice_id, скачивать нечего", () => {
    // Вернуть сюда непустой urls значило бы отправить раннер качать файл,
    // которого не существует, и уронить уже оплаченный прогон.
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(spec.extractOutput({ voice_id: "R8_DZK7FMFF", model: "speech-02-turbo" }))
      .toEqual({ urls: [] })
  })
})
