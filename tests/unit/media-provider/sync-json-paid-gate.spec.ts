/**
 * Гейт платных API в ветке sync_json (Replicate-транскрипция).
 *
 * Ветка проверяла `ENABLE_PAID_APIS` ДО того, как выяснить, уйдёт ли вызов
 * наружу вообще. На стенде со штатными `REPLICATE_MOCK_MODE=true` и
 * `ENABLE_PAID_APIS=false` это роняло транскрипцию раньше мока, а вместе с ней
 * весь маршрут «монтаж от звука»: шаг падал, ролик не собирался (сквозной
 * прогон Task 13). Ровно то же исключение для мок-режима давно делает ветка
 * async_prediction.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { listMediaSpecs } from "~~/server/utils/media-provider/registry"
import { runMediaTask } from "~~/server/utils/media-provider/run-media-task"

const SPEC = listMediaSpecs("transcription")[0]!

const previousMock = process.env.REPLICATE_MOCK_MODE

afterEach(() => {
  if (previousMock === undefined) delete process.env.REPLICATE_MOCK_MODE
  else process.env.REPLICATE_MOCK_MODE = previousMock
})

function runTranscription(requirePaidApis: (service: string) => void) {
  return runMediaTask({
    capability: "transcription",
    spec: SPEC as never,
    input: { audioUrl: "https://cdn.example.com/track.mp3", language: "ru" },
    unitKey: "transcript",
    outputPath: "/tmp/transcript.json",
    usage: { audioSeconds: 12 },
  }, {
    requirePaidApis,
    runJsonModel: async () => ({ text: "раз", chunks: [{ text: "раз", timestamp: [0, 1] }] }),
    writeBytes: async () => {},
  })
}

describe("sync_json: гейт платных API", () => {
  it("в мок-режиме Replicate гейт не спрашивается — денег вызов не стоит", async () => {
    process.env.REPLICATE_MOCK_MODE = "true"
    const requirePaid = vi.fn(() => { throw new Error("платные API отключены") })

    const result = await runTranscription(requirePaid)

    expect(requirePaid).not.toHaveBeenCalled()
    expect(result.provider).toBe("replicate")
  })

  it("без мок-режима гейт остаётся на месте", async () => {
    process.env.REPLICATE_MOCK_MODE = "false"
    const requirePaid = vi.fn(() => { throw new Error("платные API отключены") })

    await expect(runTranscription(requirePaid)).rejects.toThrow(/платные API отключены/)
    expect(requirePaid).toHaveBeenCalledWith(SPEC.vendorLabel)
  })
})
