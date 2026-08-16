import { describe, expect, it } from "vitest"

import { mergeScriptLines } from "~~/server/utils/voiceover/script-merge"

describe("слияние речи в кадре и закадровой", () => {
  it("ставит реплики и нарратора в порядке сцен", () => {
    const merged = mergeScriptLines({
      scenes: [
        { order: 1, spokenLine: "Знаешь, что отличает успешных?" },
        { order: 2, spokenLine: null },
        { order: 3, spokenLine: "Начни с малого." },
      ],
      voiceoverLines: [{ sceneOrder: 2, text: "Большинство зацикливается на разовых продажах." }],
    })

    expect(merged).toEqual([
      { order: 1, text: "Знаешь, что отличает успешных?", source: "spoken" },
      { order: 2, text: "Большинство зацикливается на разовых продажах.", source: "narration" },
      { order: 3, text: "Начни с малого.", source: "spoken" },
    ])
  })

  it("реплика в кадре главнее закадровой строки той же сцены", () => {
    // Иначе у сцены оказалось бы два голоса на один и тот же отрезок времени.
    const merged = mergeScriptLines({
      scenes: [{ order: 1, spokenLine: "Речь в кадре" }],
      voiceoverLines: [{ sceneOrder: 1, text: "Закадровая строка" }],
    })

    expect(merged).toEqual([{ order: 1, text: "Речь в кадре", source: "spoken" }])
  })

  it("пропускает сцены без текста вовсе", () => {
    const merged = mergeScriptLines({
      scenes: [
        { order: 1, spokenLine: "Есть текст" },
        { order: 2, spokenLine: "   " },
        { order: 3, spokenLine: null },
      ],
      voiceoverLines: [],
    })

    expect(merged.map(scene => scene.order)).toEqual([1])
  })

  it("не теряет закадровую строку сцены, которой нет в плане сцен", () => {
    const merged = mergeScriptLines({
      scenes: [{ order: 1, spokenLine: "Первая" }],
      voiceoverLines: [{ sceneOrder: 5, text: "Хвост нарратора" }],
    })

    expect(merged.map(scene => scene.order)).toEqual([1, 5])
  })
})
