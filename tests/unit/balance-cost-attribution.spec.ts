/**
 * Unit-тесты для balance_v2 cost-attribution: маппинг stepKey × modelId → service.
 *
 * Чистая функция без БД — реальный getModel из video-models.ts.
 */

import { describe, it, expect } from "vitest"
import { mapStepKeyToService } from "../../server/utils/balance/cost-attribution"

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

  it("lip_sync_generation → fal.ai (любая модель)", () => {
    expect(mapStepKeyToService("lip_sync_generation", "fal-ai/sync-lipsync")).toBe(
      "fal.ai",
    )
    expect(mapStepKeyToService("lip_sync_generation")).toBe("fal.ai")
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
})
