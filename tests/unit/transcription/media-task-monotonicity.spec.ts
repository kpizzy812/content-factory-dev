import { describe, expect, it } from "vitest"

import { firstMonotonicityViolation } from "~~/server/utils/transcription/media-task"
import type { Transcript } from "~~/server/utils/transcription/types"

describe("монотонность слов транскрипта (media-task)", () => {
  it("не находит нарушений, когда слова идут по возрастанию времени", () => {
    const transcript: Transcript = {
      text: "тело меняется",
      words: [
        { text: "тело", startSec: 0, endSec: 0.4 },
        { text: "меняется", startSec: 0.4, endSec: 1.1 },
      ],
    }

    expect(firstMonotonicityViolation(transcript)).toBeNull()
  })

  it("находит слово, начавшееся раньше конца предыдущего", () => {
    const transcript: Transcript = {
      text: "тело меняется",
      words: [
        { text: "тело", startSec: 0, endSec: 0.9 },
        { text: "меняется", startSec: 0.4, endSec: 1.1 },
      ],
    }

    expect(firstMonotonicityViolation(transcript)?.text).toBe("меняется")
  })

  it("пустой и однословный транскрипт нарушений не даёт", () => {
    expect(firstMonotonicityViolation({ text: "", words: [] })).toBeNull()
    expect(firstMonotonicityViolation({
      text: "тело",
      words: [{ text: "тело", startSec: 0, endSec: 0.4 }],
    })).toBeNull()
  })
})
