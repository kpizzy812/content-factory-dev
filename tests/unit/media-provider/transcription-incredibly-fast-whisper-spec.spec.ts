/**
 * Спека `replicate:incredibly-fast-whisper` — замена `victor-upmeet/whisperx`
 * для маршрута «монтаж от звука»: WhisperX живёт на Nvidia A100 (80GB),
 * дефицитном SKU, и на стенде трижды подряд не дождался железа (26-27.08.2026,
 * дважды по 900с после поднятия потолка с прежних 300с) — при цели 300
 * роликов в сутки ждать дефицитный SKU на каждом ролике нельзя. Ни одной
 * строки кода транскрипции между удачным прогоном и тремя отказами никто не
 * трогал — причина в самом SKU, а не в нашем коде (см. докстринг спеки в
 * `model-specs.ts`).
 *
 * Все факты ниже сверены НАПРЯМУЮ 27.08.2026, тем же публичным способом, что и
 * у `openai/whisper`/`victor-upmeet/whisperx` — HTML страницы модели и её
 * версий, без токена, без единого платного вызова:
 *  - версии — `https://replicate.com/api/models/vaibhavs10/incredibly-fast-whisper/versions`;
 *  - цена/железо/схема входа — `https://replicate.com/vaibhavs10/incredibly-fast-whisper`
 *    (и встроенный в страницу JSON `_extras.dereferenced_openapi_schema`);
 *  - тариф L40S — `https://replicate.com/pricing`.
 */

import { describe, expect, it } from "vitest"

import { estimateMediaCost, findMediaSpec, listMediaSpecs, mapMediaInput } from "~~/server/utils/media-provider/registry"

function fastWhisperSpec() {
  const spec = findMediaSpec("replicate:incredibly-fast-whisper")
  if (!spec || spec.capability !== "transcription") {
    throw new Error("спека replicate:incredibly-fast-whisper не найдена в реестре transcription")
  }
  return spec
}

describe("спека replicate:incredibly-fast-whisper", () => {
  it("зарегистрирована в реестре способности transcription рядом со старыми Whisper/WhisperX", () => {
    const specs = listMediaSpecs("transcription")
    expect(specs.some(spec => spec.registryKey === "replicate:incredibly-fast-whisper")).toBe(true)
    // Старые спеки не удаляются — знание об их непригодности/риске добыто дорого.
    expect(specs.some(spec => spec.registryKey === "replicate:whisper")).toBe(true)
    expect(specs.some(spec => spec.registryKey === "replicate:whisperx")).toBe(true)
  })

  it("несёт ПОСЛЕДНЮЮ версию модели (сверено 27.08.2026 напрямую с публичного эндпоинта versions)", () => {
    const spec = fastWhisperSpec()

    expect(spec.id).toBe("vaibhavs10/incredibly-fast-whisper")
    expect(spec.provider).toBe("replicate")
    expect(spec.execution).toBe("sync_json")
    expect(spec.providerVersion).toBe("3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c")
  })

  it("integrated=false — включается на стенде явной MEDIA_MODEL_TRANSCRIPTION (§4.1), цена уже подтверждена", () => {
    const spec = fastWhisperSpec()

    expect(spec.billingConfirmed).toBe(true)
    expect(spec.integrated).toBe(false)
  })

  it("mapInput шлёт audio, timestamp: word и ПОЛНОЕ имя языка — не ISO-код", () => {
    const spec = fastWhisperSpec()

    const payload = mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voiceover.mp3",
      language: "ru",
    })

    // Схема модели: language — enum из полных английских названий языков
    // ("russian", "english", ...), а НЕ ISO-кодов. "ru" был бы отвергнут
    // валидацией Cog — 422 до единого платного вызова.
    expect(payload).toEqual({
      audio: "https://cdn.example.com/voiceover.mp3",
      language: "russian",
      timestamp: "word",
    })
    expect(payload).not.toHaveProperty("audio_file")
    expect(payload).not.toHaveProperty("word_timestamps")
    expect(payload).not.toHaveProperty("align_output")
  })

  it("английский маппится в полное имя english", () => {
    const spec = fastWhisperSpec()

    const payload = mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voiceover.mp3",
      language: "en",
    })

    expect(payload).toMatchObject({ language: "english" })
  })

  it("язык без подсказки уходит как russian (дефолт ru нашего контура, §4.1)", () => {
    const spec = fastWhisperSpec()

    const payload = mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voiceover.mp3",
    })

    expect(payload).toMatchObject({ language: "russian" })
  })

  it("отказывает честно на языке за пределами продуктового набора, а не отправляет автоопределение", () => {
    // Решение: честный отказ, а не молчаливый auto-detect ("None"). Мы сами
    // выбираем язык подсказкой (ru/en) — неизвестный код здесь означает баг
    // вызывающего кода (сценарий на незаявленном языке), а не легитимный кейс,
    // который стоит тихо разруливать автоопределением. Тот же выбор, что у
    // replicate:whisper и replicate:whisperx.
    const spec = fastWhisperSpec()

    expect(() => mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voiceover.mp3",
      language: "zh",
    })).toThrow(/не размечает язык/)
  })

  it("тарифицируется по времени GPU (hardware_second) на Nvidia L40S — сходится с ценой страницы модели ($0.0040)", () => {
    const spec = fastWhisperSpec()
    const billing = spec.billing

    expect(billing.unit).toBe("hardware_second")
    if (billing.unit !== "hardware_second") throw new Error("unreachable")

    // Страница модели: hardware "L40S", price "$0.000975 per second" — оба поля
    // взяты из встроенного JSON страницы (_extras), не только из прозы.
    // Replicate.com/pricing подтверждает ставку одиночного L40S (gpu-l40s,
    // НЕ l40s-2x/4x/8x с другой ставкой) тем же числом.
    expect(billing.usdPerSecond).toBeCloseTo(0.000975, 10)

    // estimatedSeconds взят НЕ из прозы «typically complete within 5 seconds»
    // (это округлённый потолок отображения — 0.000975×5=$0.004875, это на 22%
    // больше заявленной цены), а обратным счётом из p50price страницы
    // ($0.0040) — того самого числа, из которого Replicate сам строит фразу
    // «costs approximately $0.0040 to run»: 0.0040 / 0.000975 ≈ 4.10 с.
    // Эта же оценка — единственный источник цены в проде: sync_json ветка
    // раннера (`runReplicateJsonModel`) не возвращает metrics.predict_time,
    // только output, так что usage.hardwareSeconds для transcription никогда
    // не передаётся и estimatedSeconds — это не черновая прикидка, а
    // ФАКТИЧЕСКАЯ цена каждого прогона.
    expect(billing.estimatedSeconds).toBeCloseTo(4.1, 5)

    const cost = estimateMediaCost(spec, {})
    expect(cost).toBeCloseTo(0.0040, 4)
    // Как и у Whisper/WhisperX, цена не зависит от длины аудио.
    expect(estimateMediaCost(spec, { audioSeconds: 600 })).toBe(cost)

    // Факт (metrics.predict_time вебхука) переопределяет оценку, если он
    // когда-нибудь будет передан — та же гарантия, что у остальных
    // hardware_second спек.
    expect(estimateMediaCost(spec, { hardwareSeconds: 10 })).toBeCloseTo(10 * billing.usdPerSecond, 10)
  })

  it("community-модель без пометки Official — providerVersion обязателен (is_official: false на странице)", () => {
    const spec = fastWhisperSpec()
    expect(spec.providerVersion).toBeTruthy()
  })
})
