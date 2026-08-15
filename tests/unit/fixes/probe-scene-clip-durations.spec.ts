/**
 * Регрессия: замер длительностей списка, адресуемого позицией сцены.
 *
 * `probeClipDurations` подменяет ЛЮБУЮ неудачу ffprobe пятью секундами. Для
 * списка по сценам это ложь: пустая ячейка (сцену снимает ведущая, своего клипа
 * нет) начинала «весить» 5 секунд, которых в ролике не существует, и старты всех
 * следующих реплик уезжали вперёд. Дыра обязана оставаться дырой, а дефолт —
 * доставаться только реальному файлу, который не удалось измерить.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  probed: [] as string[],
  durationByPath: new Map<string, number>(),
}))

vi.mock("fluent-ffmpeg", () => {
  const ffmpeg = () => ({}) as unknown
  ffmpeg.ffprobe = (path: string, cb: (err: Error | null, data?: unknown) => void) => {
    h.probed.push(path)
    const duration = h.durationByPath.get(path)
    if (duration === undefined) cb(new Error("ffprobe failed"))
    else cb(null, { format: { duration } })
  }
  ffmpeg.setFfmpegPath = () => {}
  ffmpeg.setFfprobePath = () => {}
  return { default: ffmpeg }
})

vi.mock("../../../server/utils/storage-paths", () => ({
  getAssetsDirFor: () => "/tmp",
  getVideosBase: () => "/tmp",
}))

beforeEach(() => {
  h.probed.length = 0
  h.durationByPath.clear()
})

describe("probeSceneClipDurations", () => {
  it("пустая ячейка даёт null и вообще не измеряется", async () => {
    const { probeSceneClipDurations } = await import("../../../server/utils/render")
    h.durationByPath.set("a.mp4", 6)

    const durations = await probeSceneClipDurations(["a.mp4", "", "  "])

    expect(durations).toEqual([6, null, null])
    expect(h.probed).toEqual(["a.mp4"])
  })

  it("реальный файл, который не измерился, получает прежний дефолт в 5 секунд", async () => {
    const { probeSceneClipDurations } = await import("../../../server/utils/render")

    expect(await probeSceneClipDurations(["broken.mp4"])).toEqual([5])
  })
})
