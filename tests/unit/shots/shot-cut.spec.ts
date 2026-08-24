import { describe, expect, it } from "vitest"

import { buildShotSubClipArgs } from "~~/server/utils/video-tools/shot-cut"
import { TIMELINE_FPS } from "~~/shared/types/video-runtime"

const BASE = { sourcePath: "/a/scene_1_lipsync.mp4", outputPath: "/a/shot_5.mp4" }

function argsFor(startSec: number, durationSec: number) {
  return buildShotSubClipArgs({ ...BASE, startSec, durationSec })
}

describe("вырезка подотрезка кадра из готового клипа", () => {
  it("-ss стоит ПЕРЕД -i: иначе ffmpeg декодирует весь клип до точки реза", () => {
    const args = argsFor(2.0, 1.8)
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"))
  })

  it("режет ровно заказанные секунды", () => {
    const args = argsFor(2.0, 1.8)
    expect(args[args.indexOf("-ss") + 1]).toBe("2.000")
    expect(args[args.indexOf("-t") + 1]).toBe("1.800")
  })

  // Фикс-раунд 1, Important #1: было `toContain('fps=30')` — подстрока не
  // защищает соседний `setpts=PTS-STARTPTS` в том же значении `-vf`. Тест
  // сверяет значение ЦЕЛИКОМ: потеря `setpts` (timestamp вырезки остаётся
  // исходным, concat кладёт кадр не туда) теперь красит именно этот тест.
  it("значение -vf ЦЕЛИКОМ: сброс PTS + частота нормализации + формат пикселей", () => {
    const args = argsFor(0, 1.8)
    expect(args[args.indexOf("-vf") + 1]).toBe(`setpts=PTS-STARTPTS,fps=${TIMELINE_FPS},format=yuv420p`)
  })

  // Фикс-раунд 1, Important #2 (рулинг): флага `audioPresent` больше нет —
  // §6.4 требует нулевую громкость клипа кадра всегда, родной звук источника
  // не нужен НИКОГДА. Синтетическая дорожка добавляется безусловно.
  it("синтетическая немая дорожка добавляется БЕЗУСЛОВНО — родной звук источника не переносится никогда (§6.4)", () => {
    const args = argsFor(0, 1.8)
    expect(args).toContain("anullsrc=channel_layout=stereo:sample_rate=44100")
  })

  // Фикс-раунд 1, Important #2: одного `anullsrc` недостаточно. Замерено
  // реальным ffmpeg 8.1 (см. отчёт): без явного `-map` автовыбор ffmpeg
  // выбирает аудиопоток по числу каналов, и при СТЕРЕО-звуке у источника
  // (то же число каналов, что и у `anullsrc`) побеждает поток с МЕНЬШИМ
  // индексом — то есть родной звук источника (mean_volume -21.1 dB), а не
  // синтетическая тишина (-91 dB). Явный `-map` исключает автовыбор совсем.
  it("видео и аудио маппятся ЯВНО (0:v:0, 1:a:0) — иначе при стерео-источнике автовыбор ffmpeg возьмёт родной звук вместо anullsrc", () => {
    const args = argsFor(0, 1.8)
    const mappedTargets = args
      .map((token, i) => [token, args[i + 1]] as const)
      .filter(([token]) => token === "-map")
      .map(([, target]) => target)
    expect(mappedTargets).toEqual(["0:v:0", "1:a:0"])
  })

  // Фикс-раунд 1, Minor: решение — оставить ради единообразия со
  // still-clip.ts (документированно избыточен при данной связке -t), но
  // покрыть тестом, чтобы потеря флага не проходила незамеченной.
  it("-shortest присутствует — единообразно со still-clip.ts, хотя реальную границу длительности уже держит -t", () => {
    expect(argsFor(0, 1.8)).toContain("-shortest")
  })

  it("отрицательный старт и неположительная длина зажимаются, а не уезжают в ffmpeg", () => {
    const args = buildShotSubClipArgs({ ...BASE, startSec: -3, durationSec: 0 })
    expect(args[args.indexOf("-ss") + 1]).toBe("0.000")
    expect(Number(args[args.indexOf("-t") + 1])).toBeGreaterThan(0)
  })

  it("NaN и Infinity не доезжают до аргументов", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const args = buildShotSubClipArgs({ ...BASE, startSec: bad, durationSec: bad })
      expect(args.every(a => !a.includes("NaN") && !a.includes("Infinity"))).toBe(true)
    }
  })

  it("выход пишется в заказанный путь последним аргументом", () => {
    expect(argsFor(1, 1).at(-1)).toBe(BASE.outputPath)
  })
})
