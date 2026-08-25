/**
 * Important 3 финального ревью ветки: покрытие трека обязано опираться на
 * ИЗМЕРЕННЫЕ длительности собранных файлов, а не на заявленные интервалы
 * `VideoShot`.
 *
 * Живой замер ревьюера: вырезка `-t 2.000` из источника длиной 1.0с даёт файл
 * 1.000000с и EXIT=0 — ffmpeg не обязан выдать заказанную длительность, если
 * источник короче. Кадр, вышедший короче своего интервала, укорачивает всю
 * склейку: `amix duration=first` режет речь по видеодорожке, вожжённые
 * субтитры уезжают вместе с картинкой, а ролик получает статус «готов» —
 * девятый путь §10.
 *
 * Добивка удержанием кадра (`shot-compose-runner.ts`) закрывает это у
 * источника и проверяется интеграционно на живом ffmpeg
 * (`tests/integration/shot-assembly-compose.spec.ts`). Здесь проверяется
 * ВТОРОЙ эшелон — сверка измеренного файла с интервалом в `composeVideoShots`:
 * если добивка почему-то не справилась, кадр обязан деградировать ЧЕСТНО и
 * выпасть из таймлайна вместе со своим интервалом, чтобы дыру увидел
 * `assertShotsCoverTrack`, — а не проехать «готовым» с чужой длиной.
 *
 * Ветка недостижима на живом ffmpeg, пока добивка работает, поэтому она и
 * проверяется здесь: реальный рендер замокан в no-op, а `probeMediaDuration`
 * отдаёт заданную длину — ровно тот приём, которым `shot-route-inertness.spec.ts`
 * гоняет `composeVideoShots` без БД и без процессов.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const h = vi.hoisted(() => ({
  /** Длительность, которую «намерил» ffprobe у собранного файла, по имени файла. */
  measuredByPath: new Map<string, number>(),
  shotRows: [] as Array<Record<string, unknown>>,
  assetRows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ id: number, data: Record<string, unknown> }>,
  logs: [] as string[],
  composeCalls: [] as string[],
}))

vi.mock("../../../server/utils/video-tools/shot-compose-runner", () => ({
  // Настоящий ffmpeg тут не нужен: проверяется РЕШЕНИЕ по измеренному файлу,
  // а сам замер подменён ниже.
  renderShotComposition: async (request: { outputPath: string }) => { h.composeCalls.push(request.outputPath) },
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => ({ id: 7, attemptCount: 0, actualCost: 0, outputSnapshot: null }),
  updateStep: async () => {},
  appendStepLog: async (_id: number, line: string) => { h.logs.push(line) },
  isStepCompleted: () => false,
  updateVideoStatus: async () => undefined,
  STEP_ORDER: [
    "prompt_generation", "image_generation", "clip_generation", "voiceover_generation",
    "transcription", "edit_plan", "shot_background", "music_generation",
    "lip_sync_generation", "assembly",
  ],
}))

vi.mock("../../../server/utils/render", () => ({
  normalizeSceneClips: async (paths: string[]) => [...paths],
  probeSceneClipDurations: async (paths: string[]) => paths.map(() => 5),
  probeClipDurations: async (paths: string[]) => paths.map(() => 5),
  probeMediaDuration: async (path: string) => h.measuredByPath.get(path) ?? null,
  adjustAudioTempo: async () => ({ outputPath: "x", durationSec: 1 }),
  trimAudio: async () => ({ outputPath: "x", durationSec: 1 }),
  planClipExtension: () => ({ allowed: false, neededSec: 0, limitSec: 0 }),
}))

let scratchDir: string

function installGlobals() {
  const g = globalThis as Record<string, unknown>
  g.getAssetsDir = () => scratchDir
  g.getVideosDir = () => scratchDir
  g.ensureDir = async () => {}
  g.logAgent = async () => {}
  g.prisma = {
    videoShot: {
      findMany: async () => h.shotRows,
      update: async ({ where, data }: { where: { id: number }, data: Record<string, unknown> }) => {
        h.updates.push({ id: where.id, data })
        return {}
      },
    },
    videoAsset: {
      findMany: async () => h.assetRows,
      findFirst: async () => null,
      create: async () => ({}),
      update: async () => ({}),
    },
  }
}

beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "cf-shot-measured-"))
  // Фоны обязаны РЕАЛЬНО существовать: composeVideoShots проверяет файл на
  // диске (`defaultShotFileExists`), иначе кадр уйдёт в слияние без источника.
  for (const order of [0, 1]) {
    await writeFile(join(scratchDir, `bg_${order}.png`), "заглушка фона для проверки существования файла")
  }
})

afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true }).catch(() => {})
})

beforeEach(() => {
  h.measuredByPath.clear()
  h.updates.length = 0
  h.logs.length = 0
  h.composeCalls.length = 0
  h.shotRows = [0, 1].map(order => ({
    id: 100 + order, videoId: 1, order, startSec: order * 3, endSec: order * 3 + 3,
    sceneOrder: null, foreground: "none", background: "image", pipEnabled: false,
    status: "planned", assetPath: null,
  }))
  h.assetRows = [0, 1].map(order => ({
    order, filePath: join(scratchDir, `bg_${order}.png`), contentType: "image/png",
  }))
})

async function loadSteps() {
  installGlobals()
  return await import("../../../server/utils/video-pipeline-steps")
}

describe("composeVideoShots сверяет ИЗМЕРЕННУЮ длительность кадра с его интервалом (Important 3)", () => {
  it("кадр вышел короче интервала — деградирует честно и выпадает из таймлайна вместе со своим интервалом", async () => {
    const { composeVideoShots } = await loadSteps()
    const { DEFAULT_EDIT_PROFILE } = await import("../../../server/utils/edit-plan/profile")

    // Кадр 0 собрался на свои 3с; кадр 1 вышел 1.0с при заказанных 3с — ровно
    // то, что даёт `-t` на коротком источнике.
    h.measuredByPath.set(join(scratchDir, "shot_0_composed.mp4"), 3)
    h.measuredByPath.set(join(scratchDir, "shot_1_composed.mp4"), 1)

    const result = await composeVideoShots(1, { id: 7 }, [], DEFAULT_EDIT_PROFILE, "portrait")

    expect(result).not.toBeNull()
    expect(result!.composedCount).toBe(1)
    expect(result!.degradedCount).toBe(1)
    // Короткий кадр выпал ВМЕСТЕ со своим интервалом [3,6) — дыру дальше
    // увидит `assertShotsCoverTrack`, и ролик не дойдёт до «готов».
    expect(result!.shots.map(s => [s.order, s.startSec, s.endSec])).toEqual([[0, 0, 3]])

    const degraded = h.updates.find(u => u.id === 101 && u.data.status === "degraded")
    expect(degraded, "кадр 1 обязан быть помечен degraded").toBeDefined()
    expect(String(degraded!.data.degradeReason)).toMatch(/короче своего интервала/)
    expect(degraded!.data.assetPath).toBeNull()
    // Причина названа числами, а не «что-то пошло не так».
    expect(String(degraded!.data.degradeReason)).toMatch(/1\.000с вместо 3\.000с/)
  })

  it("кадр в допуске одного кадра сетки 30fps проходит: дрейф кодека не деградирует ролик", async () => {
    const { composeVideoShots } = await loadSteps()
    const { DEFAULT_EDIT_PROFILE } = await import("../../../server/utils/edit-plan/profile")

    h.measuredByPath.set(join(scratchDir, "shot_0_composed.mp4"), 3)
    h.measuredByPath.set(join(scratchDir, "shot_1_composed.mp4"), 3 - 1 / 30)

    const result = await composeVideoShots(1, { id: 7 }, [], DEFAULT_EDIT_PROFILE, "portrait")

    expect(result!.composedCount).toBe(2)
    expect(result!.degradedCount).toBe(0)
  })

  it("длительность не измеряется вовсе — кадр не деградирует по недоказанному подозрению", async () => {
    const { composeVideoShots } = await loadSteps()
    const { DEFAULT_EDIT_PROFILE } = await import("../../../server/utils/edit-plan/profile")

    h.measuredByPath.set(join(scratchDir, "shot_0_composed.mp4"), 3)
    // shot_1 в карте отсутствует → probeMediaDuration вернёт null.

    const result = await composeVideoShots(1, { id: 7 }, [], DEFAULT_EDIT_PROFILE, "portrait")

    expect(result!.composedCount).toBe(2)
    expect(result!.degradedCount).toBe(0)
  })
})
