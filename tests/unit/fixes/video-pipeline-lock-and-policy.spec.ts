/**
 * Регрессии оркестрации: владение блокировкой прогона, каскад перезапуска шага,
 * доверие кэшу озвучки и учёт денег упавшего шага.
 * DB-free — вся логика вынесена в чистые модули рядом с пайплайном.
 */
import { describe, expect, it } from "vitest"
import { createLockRegistry, nextLockStamp } from "../../../server/utils/video-pipeline-lock"
import {
  generatedUnitsFromAssetDelta,
  shouldApplyVoiceoverClipPaths,
  STEP_EXECUTION_ORDER,
  stepsToRerunFrom,
} from "../../../server/utils/video-pipeline-run-policy"

describe("V1: блокировка принадлежит прогону, а не ролику", () => {
  it("повторный захват того же ролика не проходит", () => {
    const registry = createLockRegistry()
    expect(registry.claim(7, 1000)).not.toBeNull()
    expect(registry.claim(7, 1001)).toBeNull()
  })

  it("finally отменённого прогона не снимает блокировку нового запуска", () => {
    const registry = createLockRegistry()

    // Прогон A взял блокировку, оператор отменил ролик (force), запустил заново.
    const handleA = registry.claim(7, 1000)!
    registry.forceRelease(7)
    const handleB = registry.claim(7, 1000)!

    // Штампы обязаны различаться даже в пределах одной миллисекунды.
    expect(handleB.stampMs).not.toBe(handleA.stampMs)

    // Опоздавший finally прогона A приносит СВОЙ штамп — блокировка B цела.
    expect(registry.release(handleA)).toBe(false)
    expect(registry.isBusy(7)).toBe(true)
    expect(registry.ownerStamp(7)).toBe(handleB.stampMs)

    // И третий прогон по тому же ролику не стартует.
    expect(registry.claim(7, 1002)).toBeNull()

    // Свою блокировку B снимает нормально.
    expect(registry.release(handleB)).toBe(true)
    expect(registry.isBusy(7)).toBe(false)
  })

  it("штамп строго растёт даже при остановленных часах", () => {
    expect(nextLockStamp(1000, 1000)).toBe(1001)
    expect(nextLockStamp(1000, 999)).toBe(1001)
    expect(nextLockStamp(1000, 2000)).toBe(2000)
    expect(nextLockStamp(1000, Number.NaN)).toBe(1001)
  })
})

describe("W2: каскад перезапуска идёт по реальному порядку выполнения", () => {
  it("lip-sync выполняется до озвучки и музыки", () => {
    expect([...STEP_EXECUTION_ORDER]).toEqual([
      "prompt_generation",
      "image_generation",
      "clip_generation",
      "lip_sync_generation",
      "voiceover_generation",
      "music_generation",
      "assembly",
    ])
  })

  it("перезапуск озвучки не заставляет платить за lip-sync заново", () => {
    expect(stepsToRerunFrom("voiceover_generation")).toEqual([
      "voiceover_generation",
      "music_generation",
      "assembly",
    ])
  })

  it("перезапуск lip-sync сбрасывает и озвучку — её кэш держит пути старых клипов", () => {
    expect(stepsToRerunFrom("lip_sync_generation")).toContain("voiceover_generation")
  })

  it("неизвестный шаг — пустой каскад (вызывающий бросает ошибку)", () => {
    expect(stepsToRerunFrom("нет_такого_шага" as never)).toEqual([])
  })
})

describe("V3: кэш озвучки не перетирает свежий lip-sync", () => {
  it("озвучка отработала в этом прогоне — её пути актуальны", () => {
    expect(shouldApplyVoiceoverClipPaths({ voiceoverRegenerated: true, lipSyncRegenerated: true })).toBe(true)
  })

  it("обе из кэша — пути согласованы между собой, применяем", () => {
    expect(shouldApplyVoiceoverClipPaths({ voiceoverRegenerated: false, lipSyncRegenerated: false })).toBe(true)
  })

  it("lip-sync переигран, озвучка из кэша — старые *_ext.mp4 не применяем", () => {
    expect(shouldApplyVoiceoverClipPaths({ voiceoverRegenerated: false, lipSyncRegenerated: true })).toBe(false)
  })
})

describe("W3: деньги упавшего шага восстанавливаются по приросту ассетов", () => {
  it("три скачанных клипа до сбоя — три оплаченные единицы", () => {
    expect(generatedUnitsFromAssetDelta(0, 3)).toBe(3)
    expect(generatedUnitsFromAssetDelta(3, 5)).toBe(2)
  })

  it("ничего не добавилось — нечего списывать", () => {
    expect(generatedUnitsFromAssetDelta(3, 3)).toBe(0)
  })

  it("отрицательная дельта и мусор не превращаются в деньги", () => {
    expect(generatedUnitsFromAssetDelta(5, 3)).toBe(0)
    expect(generatedUnitsFromAssetDelta(Number.NaN, 3)).toBe(0)
  })
})
