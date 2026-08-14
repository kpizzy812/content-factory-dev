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
