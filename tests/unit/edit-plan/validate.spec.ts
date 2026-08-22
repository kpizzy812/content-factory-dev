import { describe, expect, it } from "vitest"

import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import { validateShotPlan } from "~~/server/utils/edit-plan/validate"
import type { PlannedShot } from "~~/server/utils/edit-plan/types"

const WORDS = [
  { text: "первое", startSec: 0, endSec: 0.9, matched: true },
  { text: "второе", startSec: 1.0, endSec: 1.9, matched: true },
  { text: "третье", startSec: 2.1, endSec: 3.0, matched: true },
]

const SCENES = [{ order: 1, startSec: 0, endSec: 3.0, words: WORDS }]

function shot(overrides: Partial<PlannedShot> = {}): PlannedShot {
  return {
    order: 0,
    startSec: 0,
    endSec: 3.0,
    sceneOrder: 1,
    foreground: "presenter",
    background: "none",
    backgroundClipId: null,
    appReferenceId: null,
    idea: null,
    pipEnabled: false,
    ...overrides,
  }
}

function context(shots: PlannedShot[], overrides: Record<string, unknown> = {}) {
  return {
    plan: { shots },
    trackDurationSec: 3.0,
    fps: 30,
    alignedScenes: SCENES,
    profile: DEFAULT_EDIT_PROFILE,
    lipSyncMaxDurationSec: 10,
    minGenerativeVideoSec: 5,
    knownBackgroundIds: new Set<string>(),
    ...overrides,
  } as never
}

describe("валидация плана кадров", () => {
  it("принимает план, покрывающий трек без дыр", () => {
    // Второй кадр — foreground: "none", а не дефолтный "presenter": иначе
    // перебивок в плане ноль при целевых 40% (DEFAULT_EDIT_PROFILE.brollRatio)
    // и допуске 0.15, и validateShotPlan честно вернёт broll_ratio. С этой
    // расстановкой доля перебивок 1.05/3.0 = 0.35 — внутри допуска.
    // Граница 1.95 попадает в межсловный интервал (1.9-2.1 между «второе» и
    // «третье»), слово не рвётся.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.95 }),
      shot({ order: 1, startSec: 1.95, endSec: 3.0, foreground: "none" }),
    ]))

    expect(violations).toEqual([])
  })

  it("ловит дыру между кадрами", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.0 }),
      shot({ order: 1, startSec: 1.5, endSec: 3.0 }),
    ]))

    expect(violations.map(v => v.code)).toContain("gap")
  })

  it("ловит дыру в хвосте — план не дотягивает до конца трека", () => {
    // В отличие от предыдущего теста здесь нет ни внутренней дыры, ни
    // нахлёста: единственный кадр просто не дотягивает до конца трека.
    // Это отдельная ветка проверки (после основного цикла по кадрам), и
    // тест выше её не задевает — оба кадра там в сумме покрывают весь трек.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 2.0, foreground: "none" }),
    ]))

    expect(violations.map(v => v.code)).toContain("gap")
  })

  it("ловит нахлёст кадров", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 2.0 }),
      shot({ order: 1, startSec: 1.5, endSec: 3.0 }),
    ]))

    expect(violations.map(v => v.code)).toContain("overlap")
  })

  it("ловит границу посреди слова", () => {
    // 1.4 с — середина слова «второе» (1.0-1.9). Смена картинки там режет
    // слово пополам, и это слышно и видно.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.4 }),
      shot({ order: 1, startSec: 1.4, endSec: 3.0 }),
    ]))

    expect(violations.map(v => v.code)).toContain("word_split")
  })

  it("ловит presenter-кадр длиннее потолка lip-sync модели", () => {
    const violations = validateShotPlan(context(
      [shot({ order: 0, startSec: 0, endSec: 12 })],
      { trackDurationSec: 12 },
    ))

    expect(violations.map(v => v.code)).toContain("presenter_too_long")
  })

  it("ловит ссылку на несуществующий фон", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, background: "library", backgroundClipId: "нет-такого" }),
    ]))

    expect(violations.map(v => v.code)).toContain("unknown_background")
  })

  it("принимает ссылку на фон, который есть в библиотеке", () => {
    // Зеркало предыдущего теста: тот же background: "library", но id
    // известен движку. Без этого теста проверка «ссылка на фон существует»
    // могла бы вырождаться в «background === library всегда невалиден» —
    // и дедуп-тест выше этого бы не заметил.
    const violations = validateShotPlan(context([
      shot({ order: 0, background: "library", backgroundClipId: "клип-1", foreground: "none" }),
    ], { knownBackgroundIds: new Set(["клип-1"]) }))

    expect(violations.map(v => v.code)).not.toContain("unknown_background")
  })

  it("отклоняет генеративное видео на кадре короче пяти секунд", () => {
    // §7: длительность квантуется в 5 или 10 секунд, поэтому двухсекундная
    // перебивка обошлась бы в цену пятисекундного клипа. Отклонять надо ДО
    // оплаты, а не после.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 2.0, foreground: "none", background: "video" }),
      shot({ order: 1, startSec: 2.0, endSec: 3.0, foreground: "none", background: "none" }),
    ]))

    expect(violations.map(v => v.code)).toContain("generative_video_too_short")
  })

  it("принимает генеративное видео на кадре достаточной длины", () => {
    // Зеркало предыдущего теста: минимум опущен до 1 с, кадр длится 3 с —
    // «video» не должен считаться коротким сам по себе, только относительно
    // порога minGenerativeVideoSec.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 3.0, foreground: "none", background: "video" }),
    ], { minGenerativeVideoSec: 1 }))

    expect(violations.map(v => v.code)).not.toContain("generative_video_too_short")
  })

  it("ловит кадр за концом трека", () => {
    const violations = validateShotPlan(context([shot({ order: 0, startSec: 0, endSec: 4.5 })]))

    expect(violations.map(v => v.code)).toContain("out_of_track")
  })

  it("сообщает о доле перебивок вне допуска", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 3.0, foreground: "presenter" }),
    ]))

    // Ноль перебивок при целевых 40% — ролик целиком говорящая голова.
    expect(violations.map(v => v.code)).toContain("broll_ratio")
  })

  it("отклоняет пустой план — покрывать таймлайн нечем", () => {
    expect(validateShotPlan(context([])).map(v => v.code)).toContain("empty")
  })

  it("не мутирует входной план", () => {
    // Спека и бриф требуют чистоты: план приходит из ответа модели, и его
    // порча стёрла бы то, что должно уйти в диагностику повторного запроса.
    const shots = [
      shot({ order: 1, startSec: 1.95, endSec: 3.0, foreground: "none" }),
      shot({ order: 0, startSec: 0, endSec: 1.95 }),
    ]
    const snapshot = JSON.parse(JSON.stringify(shots))

    validateShotPlan(context(shots))

    expect(shots).toEqual(snapshot)
  })
})
