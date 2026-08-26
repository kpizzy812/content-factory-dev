/**
 * Проводка группы движения от плана композиции до `renderStillClip`.
 *
 * Отдельный файл, потому что `renderBackgroundFull` — внутренняя функция
 * раннера, и до этой правки НИ ОДИН тест не проверял, что она вообще что-то
 * передаёт дальше: мутация «передать только номер группы, а смещение и длину
 * потерять» была бы зелёной на всей сьюте, а на экране дала бы ровно тот же
 * дёрганый фон, ради которого правка затевалась. Приём мокирования — тот же,
 * что у `shot-composed-duration-check.spec.ts`: настоящий ffmpeg здесь не
 * нужен, проверяется РЕШЕНИЕ, а не файл.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  stillCalls: [] as Array<Record<string, unknown>>,
  subClipCalls: [] as Array<Record<string, unknown>>,
}))

vi.mock("../../../server/utils/video-tools/still-clip-runner", () => ({
  renderStillClip: async (request: Record<string, unknown>) => { h.stillCalls.push(request) },
}))

vi.mock("../../../server/utils/video-tools/shot-cut-runner", () => ({
  renderShotSubClip: async (request: Record<string, unknown>) => { h.subClipCalls.push(request) },
}))

vi.mock("../../../server/utils/render", () => ({
  // Файл «намерен» ровно в заказанную длину — добивка удержанием кадра не
  // срабатывает и не мешает смотреть на аргументы движения.
  probeMediaDuration: async () => 1.8,
  holdLastFrameFittedClip: async () => {},
  concatSafeVideoOutputOptions: () => [],
}))

const { renderShotComposition } = await import("../../../server/utils/video-tools/shot-compose-runner")

const VARIATION = { index: 2, offsetSec: 1.8, spanSec: 5.4 }

beforeEach(() => {
  h.stillCalls.length = 0
  h.subClipCalls.length = 0
})

describe("композиция кадра доносит кусок общей траектории до ffmpeg", () => {
  it("полноэкранный неподвижный фон получает номер группы, смещение и длину группы", async () => {
    await renderShotComposition({
      composition: {
        kind: "background_full",
        backgroundPath: "/a/shot_4_bg.png",
        backgroundIsStill: true,
        durationSec: 1.8,
        variation: VARIATION,
      },
      outputPath: "/a/shot_4_composed.mp4",
      format: "portrait",
    })

    expect(h.stillCalls).toHaveLength(1)
    expect(h.stillCalls[0]).toMatchObject({
      sceneIndex: 2,
      variationOffsetSec: 1.8,
      variationSpanSec: 5.4,
      durationSec: 1.8,
    })
  })

  it("фон под PiP — тот же кусок траектории: ведущий поверх не отменяет движение фона", async () => {
    await renderShotComposition({
      composition: {
        kind: "pip",
        backgroundPath: "/a/shot_4_bg.png",
        backgroundIsStill: true,
        presenterPath: "/a/scene_1_lipsync_fit.mp4" as never,
        presenterOffsetSec: 0.5,
        durationSec: 1.8,
        variation: VARIATION,
        pipFilters: ["[1:v]scale=302:-2[pip]", "[0:v][pip]overlay=740:1330[vout]"],
      },
      outputPath: "/a/shot_4_composed.mp4",
      format: "portrait",
    }).catch(() => {
      // Сам overlay спавнит ffmpeg и здесь не мокирован — падение ожидаемо и
      // не мешает: фон готовится ДО него, а проверяется именно фон.
    })

    expect(h.stillCalls).toHaveLength(1)
    expect(h.stillCalls[0]).toMatchObject({
      sceneIndex: 2,
      variationOffsetSec: 1.8,
      variationSpanSec: 5.4,
    })
  })
})
