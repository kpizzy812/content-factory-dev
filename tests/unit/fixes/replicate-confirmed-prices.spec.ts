/**
 * Тарифы Replicate, снятые со страниц моделей 14.08.2026.
 *
 * Публичный API цены не отдаёт, а HTML страницы модели отдаёт — в теге
 * `react-component-props` лежит `billingConfig` с полем `price`. Токен для
 * этого не нужен. До сих пор мы считали смету по числам из окружения «как
 * оплачивалось на стенде», и два из них оказались неверны:
 *
 *   kling-v1.6-standard  считали $0.045/с, на странице $0.05/с — смета занижена;
 *   minimax speech-02    считаем за СИМВОЛЫ, тарифицируется за input-токены.
 *
 * Занижение хуже завышения: бюджет прогона считается по смете, и заниженная
 * смета означает, что партия уедет за пределы кошелька молча.
 */

import { describe, expect, it } from "vitest"
import { estimateMediaCost, findMediaSpec } from "../../../server/utils/media-provider/registry"
import type { MediaModelSpec } from "../../../server/utils/media-provider/types"

function spec(reference: string): MediaModelSpec {
  const found = findMediaSpec(reference)
  if (!found) throw new Error(`Спека не найдена: ${reference}`)
  return found
}

describe("тарифы, подтверждённые страницей модели", () => {
  it("kling-lip-sync — $0.014 за секунду выхода", () => {
    const lipSync = spec("kwaivgi/kling-lip-sync")
    expect(estimateMediaCost(lipSync, { outputSeconds: 10 })).toBeCloseTo(0.14, 6)
    expect(lipSync.billingConfirmed).toBe(true)
  })

  it("flux-dev — $0.025 за кадр", () => {
    const flux = spec("replicate:flux-dev")
    expect(estimateMediaCost(flux, { images: 1 })).toBeCloseTo(0.025, 6)
    expect(flux.billingConfirmed).toBe(true)
  })

  it("kling-v1.6-standard — $0.05 за секунду, а не $0.045", () => {
    // «or 20 seconds for $1» на странице модели. Прежнее число занижало смету
    // клипов на 11%: на партии это разница между «уложились» и «кончились деньги».
    for (const reference of ["replicate:kling-v1.6-standard-t2v", "replicate:kling-v1.6-standard-i2v"]) {
      const kling = spec(reference)
      expect(estimateMediaCost(kling, { outputSeconds: 10 })).toBeCloseTo(0.5, 6)
      expect(kling.billingConfirmed).toBe(true)
    }
  })
})

/**
 * Аватарные модели (`speech_to_video`) стояли в реестре по прикидкам, и три из
 * четырёх занижали смету втрое. Числа сняты со страниц моделей 16.08.2026 —
 * тем же способом, что и остальные тарифы этого файла.
 */
describe("speech_to_video: тарифы со страниц моделей", () => {
  it("omni-human — $0.14 за секунду, а не $0.045", () => {
    // Втрое дороже, чем считал реестр. На сцене ведущей в 8.5 с это разница
    // между $0.38 и $1.19 — партия уехала бы за кошелёк молча.
    const omni = spec("replicate:omni-human")
    expect(estimateMediaCost(omni, { outputSeconds: 10 })).toBeCloseTo(1.4, 6)
    expect(omni.billingConfirmed).toBe(true)
  })

  it("veed/fabric-1.0 — $0.08 за секунду, а не $0.025", () => {
    const veed = spec("replicate:veed-fabric-1")
    expect(estimateMediaCost(veed, { outputSeconds: 10 })).toBeCloseTo(0.8, 6)
    expect(veed.billingConfirmed).toBe(true)
  })

  it("wan-2.2-s2v тарифицируется за секунду ВЫХОДА, а не за секунду железа", () => {
    // Реестр считал 300 секунд GPU по $0.001 — фиксированные $0.30 за прогон
    // независимо от длины сцены. Страница модели: $0.02 за секунду выхода.
    const wan = spec("replicate:wan-2.2-s2v")
    expect(estimateMediaCost(wan, { outputSeconds: 10 })).toBeCloseTo(0.2, 6)
    expect(wan.billingConfirmed).toBe(true)
  })

  it("prunaai/p-video-avatar — $0.025 за секунду, число было верным", () => {
    const pruna = spec("replicate:p-video-avatar")
    expect(estimateMediaCost(pruna, { outputSeconds: 10 })).toBeCloseTo(0.25, 6)
    expect(pruna.billingConfirmed).toBe(true)
  })

  it("kling-avatar-v2 — $0.056 за секунду выхода", () => {
    const kling = spec("replicate:kling-avatar-v2")
    expect(estimateMediaCost(kling, { outputSeconds: 10 })).toBeCloseTo(0.56, 6)
    expect(kling.billingConfirmed).toBe(true)
  })
})

describe("lip_sync: премиальные модели того же семейства", () => {
  it("sync/lipsync-2 — $0.05 за секунду выхода", () => {
    const sync2 = spec("replicate:sync-lipsync-2")
    expect(estimateMediaCost(sync2, { outputSeconds: 10 })).toBeCloseTo(0.5, 6)
    expect(sync2.billingConfirmed).toBe(true)
  })

  it("sync/lipsync-2-pro — $0.08325 за секунду выхода", () => {
    const pro = spec("replicate:sync-lipsync-2-pro")
    expect(estimateMediaCost(pro, { outputSeconds: 10 })).toBeCloseTo(0.8325, 6)
    expect(pro.billingConfirmed).toBe(true)
  })
})

describe("TTS: для русского токен равен символу", () => {
  it("считает $0.06 за 1000 символов", () => {
    // Страница модели: «$0.06 per thousand input tokens». Коэффициент
    // символ→токен измерен на оплаченных прогонах 06.08.2026: пять реплик,
    // у всех `token_input_count` совпал с длиной текста ровно
    // (113→113, 109→109, 102→102, 99→99, 95→95). Для русского это 1:1.
    const tts = spec("replicate:minimax-speech-02-turbo")
    expect(estimateMediaCost(tts, { characters: 1000 })).toBeCloseTo(0.06, 6)
  })

  it("цена подтверждена фактическим счётом, а не догадкой", () => {
    expect(spec("replicate:minimax-speech-02-turbo").billingConfirmed).toBe(true)
  })
})
