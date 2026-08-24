/**
 * Unit-тесты для balance_v2 cost-attribution: маппинг stepKey × modelId → service.
 *
 * Чистая функция без БД — реальный getModel из video-models.ts.
 */

import { describe, it, expect } from "vitest"
import { mapStepKeyToService, type CostService } from "../../server/utils/balance/cost-attribution"
import { STEP_ORDER, type StepKey } from "../../server/utils/video-pipeline-db"

describe("mapStepKeyToService", () => {
  it("prompt_generation → anthropic", () => {
    expect(mapStepKeyToService("prompt_generation", "claude-sonnet-4-6")).toBe(
      "anthropic",
    )
    // modelId не важен для prompt_generation
    expect(mapStepKeyToService("prompt_generation")).toBe("anthropic")
  })

  it("image_generation → fal.ai (любая модель)", () => {
    expect(mapStepKeyToService("image_generation", "fal-ai/flux/schnell")).toBe("fal.ai")
    expect(mapStepKeyToService("image_generation", "unknown-model")).toBe("fal.ai")
    expect(mapStepKeyToService("image_generation")).toBe("fal.ai")
  })

  it("clip_generation → fal.ai (любая модель)", () => {
    expect(mapStepKeyToService("clip_generation", "fal-ai/luma-dream-machine")).toBe(
      "fal.ai",
    )
    expect(mapStepKeyToService("clip_generation")).toBe("fal.ai")
  })

  it("lip_sync_generation → Replicate по умолчанию, fal.ai только для его модели", () => {
    expect(mapStepKeyToService("lip_sync_generation", "kwaivgi/kling-lip-sync")).toBe(
      "replicate",
    )
    expect(mapStepKeyToService("lip_sync_generation", "fal-ai/sync-lipsync")).toBe(
      "fal.ai",
    )
    expect(mapStepKeyToService("lip_sync_generation", "unknown-model")).toBe("replicate")
    expect(mapStepKeyToService("lip_sync_generation")).toBe("replicate")
  })

  it("voiceover_generation с fal-провайдером → fal.ai", () => {
    // Все TTS модели в registry содержат "fal.ai" в provider строке
    expect(mapStepKeyToService("voiceover_generation", "fal-ai/kokoro/american-english")).toBe(
      "fal.ai",
    )
    expect(mapStepKeyToService("voiceover_generation", "fal-ai/elevenlabs/tts/turbo-v2.5")).toBe(
      "fal.ai",
    )
    expect(mapStepKeyToService("voiceover_generation", "fal-ai/playai/tts/v3")).toBe(
      "fal.ai",
    )
  })

  it("voiceover_generation с неизвестной моделью → null (skip)", () => {
    expect(mapStepKeyToService("voiceover_generation", "totally-unknown-model")).toBeNull()
    // modelId не передан → нет возможности определить провайдера
    expect(mapStepKeyToService("voiceover_generation")).toBeNull()
    expect(mapStepKeyToService("voiceover_generation", null)).toBeNull()
  })

  it("music_generation → mubert", () => {
    expect(mapStepKeyToService("music_generation", "mubert")).toBe("mubert")
    expect(mapStepKeyToService("music_generation")).toBe("mubert")
  })

  it("assembly → null (локальный ffmpeg)", () => {
    expect(mapStepKeyToService("assembly")).toBeNull()
  })

  it("неизвестный stepKey → null", () => {
    expect(mapStepKeyToService("trendwatcher")).toBeNull()
    expect(mapStepKeyToService("")).toBeNull()
    expect(mapStepKeyToService("random_step")).toBeNull()
  })

  it("edit_plan → anthropic (ruling S8-1: ветку удалял ревьюер Task 1, расход терялся молча)", () => {
    expect(mapStepKeyToService("edit_plan", null)).toBe("anthropic")
    expect(mapStepKeyToService("edit_plan")).toBe("anthropic")
  })

  it("transcription → replicate по умолчанию и по спеке whisper", () => {
    expect(mapStepKeyToService("transcription")).toBe("replicate")
    expect(mapStepKeyToService("transcription", "replicate:whisper")).toBe("replicate")
  })

  it("shot_background → та же спека, что у image_generation/clip_generation", () => {
    expect(mapStepKeyToService("shot_background", "replicate:flux-dev")).toBe("replicate")
    expect(mapStepKeyToService("shot_background", "replicate:kling-v1.6-standard-t2v")).toBe("replicate")
    expect(mapStepKeyToService("shot_background", "unknown-model")).toBe("fal.ai")
    expect(mapStepKeyToService("shot_background")).toBe("fal.ai")
  })
})

/**
 * Ruling S8-1 (ре-ревью Task 1, унаследованный пробел): ревьюер Task 1 удалил
 * `case "shot_background"` из `mapStepKeyToService`, и вся сьюта в 2695 тестов
 * осталась зелёной — ни один тест не проверял ВСЕ ключи `STEP_ORDER` разом,
 * только отдельные знакомые случаи. Без своей ветки `case` шаг падает в
 * `default: return null`, и расход шага не попадает ни в `AiAuditLog`, ни в
 * `Video.totalCostActual` — тихая денежная дыра.
 *
 * Таблица ниже перебирает КАЖДЫЙ ключ из `STEP_ORDER` (единственный источник
 * истины о том, какие шаги вообще существуют — `server/utils/video-pipeline-db.ts`)
 * и проверяет и позитивный случай (сервис есть), и легитимный отрицательный
 * (`assembly` — локальный ffmpeg, `$0`, `null` — это ПРАВИЛЬНЫЙ ответ, а не
 * пробел). `Record<StepKey, ...>` — с умыслом: если в `StepKey` добавят новый
 * ключ, а сюда его ожидание не допишут, TypeScript откажется собирать файл —
 * та же защита, что M-9 в `background-source.ts` даёт `ShotBackground`.
 *
 * Тест красит красным удаление ЛЮБОЙ ветки `case`: без неё `mapStepKeyToService`
 * вернёт `default` (обычно `null`), а таблица для ЭТОГО ключа ждёт конкретный
 * сервис — несовпадение бросается в глаза сразу на нужном ключе, а не тонет
 * среди остальных.
 */
describe("таблица: mapStepKeyToService размечает КАЖДЫЙ ключ STEP_ORDER (ruling S8-1)", () => {
  interface Case { modelId: string | null | undefined, expected: CostService | null }

  const EXPECTATIONS: Record<StepKey, Case[]> = {
    prompt_generation: [
      { modelId: undefined, expected: "anthropic" },
      { modelId: "claude-sonnet-4-6", expected: "anthropic" },
    ],
    image_generation: [
      { modelId: "replicate:flux-dev", expected: "replicate" },
      { modelId: "unknown-model", expected: "fal.ai" },
    ],
    clip_generation: [
      { modelId: "replicate:kling-v1.6-standard-t2v", expected: "replicate" },
      { modelId: "fal-ai/luma-dream-machine", expected: "fal.ai" },
    ],
    voiceover_generation: [
      { modelId: "fal-ai/kokoro/american-english", expected: "fal.ai" },
      { modelId: "totally-unknown-model", expected: null },
      { modelId: undefined, expected: null },
    ],
    music_generation: [
      { modelId: "mubert", expected: "mubert" },
      { modelId: undefined, expected: "mubert" },
    ],
    lip_sync_generation: [
      { modelId: "kwaivgi/kling-lip-sync", expected: "replicate" },
      { modelId: "fal-ai/sync-lipsync", expected: "fal.ai" },
      { modelId: undefined, expected: "replicate" },
    ],
    assembly: [
      // Легитимный отрицательный случай — локальный ffmpeg, $0, не "пробел".
      { modelId: undefined, expected: null },
    ],
    transcription: [
      { modelId: "replicate:whisper", expected: "replicate" },
      { modelId: undefined, expected: "replicate" },
    ],
    edit_plan: [
      { modelId: null, expected: "anthropic" },
      { modelId: undefined, expected: "anthropic" },
    ],
    shot_background: [
      { modelId: "replicate:flux-dev", expected: "replicate" },
      { modelId: "replicate:kling-v1.6-standard-t2v", expected: "replicate" },
      { modelId: "unknown-model", expected: "fal.ai" },
    ],
  }

  it.each(STEP_ORDER)("ключ STEP_ORDER '%s' размечен явно — не default", (stepKey) => {
    const cases = EXPECTATIONS[stepKey]
    // Сам факт присутствия ключа в таблице — часть проверки: забытый ключ в
    // EXPECTATIONS означает недописанный тест, а не прошедшую проверку.
    expect(cases, `нет ожиданий для '${stepKey}' — допиши EXPECTATIONS`).toBeDefined()
    for (const c of cases) {
      expect(mapStepKeyToService(stepKey, c.modelId), `${stepKey} modelId=${String(c.modelId)}`).toBe(c.expected)
    }
  })
})
