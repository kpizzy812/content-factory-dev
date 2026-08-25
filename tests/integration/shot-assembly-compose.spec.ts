/**
 * Ruling S8-7 (бриф Task 6, «Сборка по кадрам»): интеграционный тест
 * `composeVideoShots` — оркестрации, которую до этой задачи не покрывал ни
 * один автотест (task-5-report.md, «Фикс-раунд 1», Important 3). Спецификация
 * входов/наблюдаемого результата написана там же — этот файл следует ей
 * дословно, плюс идемпотентность повторного вызова (требование контроллера
 * Task 6, не входившее в спецификацию Task 5).
 *
 * Реальная Postgres (`cf-tests-pg:5436`, `.env.test`) и реальный ffmpeg —
 * синтетические источники собираются `ffmpeg -f lavfi`, тем же приёмом, что
 * ручная проверка Task 5 (см. task-5-report.md, «Чем проверял ffmpeg-граф»).
 * Ни одного платного вызова: провайдеры сюда не вовлечены вовсе — `composeVideoShots`
 * читает уже сохранённые `VideoAsset`/lip-sync снапшот, а не генерирует их.
 *
 * Таймлайн шести кадров одним прогоном покрывает все ветки композиции и
 * слияния:
 *   order 0 [0,2)   background_full, ФОН-КАРТИНКА (still)
 *   order 1 [2,4)   background_full, ФОН-ВИДЕО короче кадра (добивка держанием кадра)
 *   order 2 [4,5)   БЕЗ ИСТОЧНИКОВ — сливается с ПРЕДЫДУЩИМ (order 1), раздвигая его endSec до 5
 *   order 3 [5,7)   presenter_full, sceneOrder=1 — presenter-исходник ДЛИННЕЕ сцены (2с) → TRIM
 *   order 4 [7,9)   pip (фон+ведущий), sceneOrder=2, pipEnabled — presenter-исходник КОРОЧЕ сцены (2с) → HOLD
 *   order 5 [9,11)  background_full с БИТЫМ файлом — композиция падает, кадр деградирует,
 *                   но функция НЕ падает целиком (composedCount > 0 у соседей)
 *
 * @vitest-environment node
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { spawn } from "node:child_process"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { prisma } from "~~/server/utils/prisma"
import { logAgent } from "~~/server/utils/agent-logger"
;(globalThis as Record<string, unknown>).logAgent = logAgent

import { ensureDir, getAssetsDir, probeMediaDuration } from "~~/server/utils/render"
;(globalThis as Record<string, unknown>).ensureDir = ensureDir
;(globalThis as Record<string, unknown>).getAssetsDir = () => workDir

import { composeVideoShots } from "~~/server/utils/video-pipeline-steps"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import type { AlignedScene } from "~~/server/utils/transcription/align"

/** Кадры этого теста живут в своей временной директории, а не в storage/. */
let workDir: string

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", ...args], { stdio: "ignore" })
    proc.once("error", reject)
    proc.once("exit", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${args.join(" ")}`))))
  })
}

/** Неподвижная картинка-фон. */
async function renderStillImage(path: string, color: string): Promise<void> {
  await ffmpeg(["-f", "lavfi", "-i", `color=c=${color}:size=1080x1920`, "-frames:v", "1", path])
}

/** Видео-фон/ведущий заданной длины: узнаваемый паттерн + слышимый тон (тот же приём, что Task 5). */
async function renderTestClip(path: string, durationSec: number, toneHz: number): Promise<void> {
  await ffmpeg([
    "-f", "lavfi", "-i", `testsrc=size=1080x1920:duration=${durationSec}:rate=30`,
    "-f", "lavfi", "-i", `sine=frequency=${toneHz}:duration=${durationSec}`,
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
    path,
  ])
}

async function writeCorruptFile(path: string): Promise<void> {
  await writeFile(path, "это не видео, а обычный текст — ffmpeg обязан отказаться его декодировать\n")
}

interface Fixture {
  videoId: number
}

async function createFixture(): Promise<Fixture> {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const scenario = await prisma.scenario.create({ data: { status: "draft" as never } })
  const video = await prisma.video.create({
    data: { scenarioId: scenario.id, editPipeline: true, format: "portrait" as never },
  })
  return { videoId: video.id }
}

let storageRoot: string

describe("composeVideoShots: оркестрация на реальной БД и реальном ffmpeg (Ruling S8-7)", () => {
  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "cf-shot-compose-"))
  })

  afterAll(async () => {
    await rm(storageRoot, { recursive: true, force: true }).catch(() => {})
  })

  beforeEach(async () => {
    workDir = await mkdtemp(join(storageRoot, "run-"))
  })

  it("шесть кадров одним прогоном: все три ветки композиции, слияние, деградация, trim/hold — и идемпотентность повторного вызова", async () => {
    const { videoId } = await createFixture()

    // ── Источники ────────────────────────────────────────────────────────
    const bgStillPath = join(workDir, "bg_still.png")
    await renderStillImage(bgStillPath, "green")

    const bgShortVideoPath = join(workDir, "bg_short.mp4")
    await renderTestClip(bgShortVideoPath, 1.2, 300) // короче кадра order1 (2с) → добивка держанием

    const bgPipPath = join(workDir, "bg_pip.png")
    await renderStillImage(bgPipPath, "blue")

    const corruptBgPath = join(workDir, "bg_corrupt.mp4")
    await writeCorruptFile(corruptBgPath)

    // Presenter-исходники — уже "lip-synced" файлы шага lip_sync_generation.
    const presenterTrimSourcePath = join(workDir, "presenter_scene1_raw.mp4")
    await renderTestClip(presenterTrimSourcePath, 3.0, 1000) // ДЛИННЕЕ сцены (2с) → TRIM

    const presenterHoldSourcePath = join(workDir, "presenter_scene2_raw.mp4")
    await renderTestClip(presenterHoldSourcePath, 1.0, 1500) // КОРОЧЕ сцены (2с) → HOLD

    // ── VideoShot: шесть кадров, таймлайн из докстринга файла ──────────────
    const shotsData = [
      { order: 0, startSec: 0, endSec: 2, sceneOrder: null, foreground: "none", pipEnabled: false },
      { order: 1, startSec: 2, endSec: 4, sceneOrder: null, foreground: "none", pipEnabled: false },
      { order: 2, startSec: 4, endSec: 5, sceneOrder: null, foreground: "none", pipEnabled: false }, // без источников
      { order: 3, startSec: 5, endSec: 7, sceneOrder: 1, foreground: "presenter", pipEnabled: false },
      { order: 4, startSec: 7, endSec: 9, sceneOrder: 2, foreground: "presenter", pipEnabled: true },
      { order: 5, startSec: 9, endSec: 11, sceneOrder: null, foreground: "none", pipEnabled: false },
    ] as const
    for (const s of shotsData) {
      await prisma.videoShot.create({
        data: {
          videoId, order: s.order, startSec: s.startSec, endSec: s.endSec,
          sceneOrder: s.sceneOrder, foreground: s.foreground, pipEnabled: s.pipEnabled,
          background: s.order === 4 ? "library" : "none",
        },
      })
    }

    // ── VideoAsset(type=shot_background): order 0 (still, contentType задан),
    // order 1 (видео, contentType=null — упражняет фолбэк на расширение файла,
    // Task 5 фикс-раунд 1), order 4 (still для pip), order 5 (битый файл) ────
    const bgAssets: Array<{ order: number, filePath: string, contentType: string | null }> = [
      { order: 0, filePath: bgStillPath, contentType: "image/png" },
      { order: 1, filePath: bgShortVideoPath, contentType: null },
      { order: 4, filePath: bgPipPath, contentType: "image/png" },
      { order: 5, filePath: corruptBgPath, contentType: null },
    ]
    for (const a of bgAssets) {
      await prisma.videoAsset.create({
        data: { videoId, type: "shot_background" as never, order: a.order, filePath: a.filePath, contentType: a.contentType },
      })
    }

    // ── Снапшот lip_sync_generation: сцена 1 (trim), сцена 2 (hold) ─────────
    await prisma.videoGenerationStep.create({
      data: {
        videoId,
        stepKey: "lip_sync_generation" as never,
        stepIndex: 5,
        status: "completed" as never,
        outputSnapshot: {
          scenes: [
            {
              sceneOrder: 1, sceneIndex: 0, sourcePath: presenterTrimSourcePath,
              outputPath: presenterTrimSourcePath, audioPath: null, spokenLineHash: null,
              reuseKey: null, durationSec: 3.0, skipped: null,
            },
            {
              sceneOrder: 2, sceneIndex: 1, sourcePath: presenterHoldSourcePath,
              outputPath: presenterHoldSourcePath, audioPath: null, spokenLineHash: null,
              reuseKey: null, durationSec: 1.0, skipped: null,
            },
          ],
        },
      },
    })

    const assemblyStep = await prisma.videoGenerationStep.create({
      data: { videoId, stepKey: "assembly" as never, stepIndex: 6, status: "running" as never },
    })

    const alignedScenes: AlignedScene[] = [
      { order: 1, startSec: 5, endSec: 7, words: [] },
      { order: 2, startSec: 7, endSec: 9, words: [] },
    ]
    const profile = { ...DEFAULT_EDIT_PROFILE, pipEnabled: true }

    // ══════════════════════ ПЕРВЫЙ ПРОГОН ══════════════════════
    const first = await composeVideoShots(videoId, { id: assemblyStep.id }, alignedScenes, profile, "portrait")

    expect(first).not.toBeNull()
    // Пять эффективных кадров после слияния (order2 поглощён order1); один
    // (order5, битый источник) деградировал, четыре собрались.
    expect(first!.composedCount).toBe(4)
    expect(first!.degradedCount).toBe(1)
    expect(first!.shots).toHaveLength(4)
    expect(first!.shots.map(s => s.order)).toEqual([0, 1, 3, 4])

    // (а) assetPath заполнен у всех рисуемых кадров, файл существует.
    const shotsAfterFirst = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
    const byOrder = new Map(shotsAfterFirst.map(s => [s.order, s]))
    for (const order of [0, 1, 3, 4]) {
      const shot = byOrder.get(order)!
      expect(shot.status).toBe("completed")
      expect(shot.assetPath).toBeTruthy()
      await expect(stat(shot.assetPath!)).resolves.toBeTruthy()
    }

    // (б) донор слияния (order 2) — degraded, assetPath null, endSec order1
    // раздвинут до 5 (поглотил интервал order2).
    const donor = byOrder.get(2)!
    expect(donor.status).toBe("degraded")
    expect(donor.assetPath).toBeNull()
    expect(donor.degradeReason).toMatch(/поглощён/)

    // Битый источник (order 5) — degraded с текстом ошибки, но прогон не упал.
    const broken = byOrder.get(5)!
    expect(broken.status).toBe("degraded")
    expect(broken.assetPath).toBeNull()
    expect(broken.degradeReason).toBeTruthy()

    // (в) fit-файлы trim/hold — реальные, с измеренной длительностью РАЗНОЙ
    // (не одной длительностью «типа сработало»), обе близки к целевым 2с сцены.
    const trimFitPath = join(workDir, "scene_1_lipsync_fit.mp4")
    const holdFitPath = join(workDir, "scene_2_lipsync_fit.mp4")
    await expect(stat(trimFitPath)).resolves.toBeTruthy()
    await expect(stat(holdFitPath)).resolves.toBeTruthy()
    const trimFitSec = await probeMediaDuration(trimFitPath)
    const holdFitSec = await probeMediaDuration(holdFitPath)
    expect(trimFitSec).not.toBeNull()
    expect(holdFitSec).not.toBeNull()
    expect(Math.abs(trimFitSec! - 2.0)).toBeLessThan(0.15)
    expect(Math.abs(holdFitSec! - 2.0)).toBeLessThan(0.15)
    // Раздельные ветки, не совпадение: исходник trim был 3с (обрезан ВНИЗ до 2с),
    // исходник hold был 1с (растянут ВВЕРХ до 2с) — направление правки противоположное.
    expect(trimFitSec!).toBeLessThan(3.0)
    expect(holdFitSec!).toBeGreaterThan(1.0)

    // Composed-кадры реально несут заявленную длину (order3 presenter_full — 2с,
    // order4 pip — 2с, order1 background_full — 3с после слияния с order2).
    const durOrder0 = await probeMediaDuration(byOrder.get(0)!.assetPath!)
    const durOrder1 = await probeMediaDuration(byOrder.get(1)!.assetPath!)
    const durOrder3 = await probeMediaDuration(byOrder.get(3)!.assetPath!)
    const durOrder4 = await probeMediaDuration(byOrder.get(4)!.assetPath!)
    expect(Math.abs(durOrder0! - 2.0)).toBeLessThan(0.15)
    expect(Math.abs(durOrder1! - 3.0)).toBeLessThan(0.2) // [2,5) после поглощения order2
    expect(Math.abs(durOrder3! - 2.0)).toBeLessThan(0.15)
    expect(Math.abs(durOrder4! - 2.0)).toBeLessThan(0.15)

    // ══════════════════════ ВТОРОЙ ПРОГОН — ИДЕМПОТЕНТНОСТЬ ══════════════════════
    const mtimesBefore = new Map<number, number>()
    for (const order of [0, 1, 3, 4]) {
      mtimesBefore.set(order, (await stat(byOrder.get(order)!.assetPath!)).mtimeMs)
    }
    const fitMtimesBefore = {
      trim: (await stat(trimFitPath)).mtimeMs,
      hold: (await stat(holdFitPath)).mtimeMs,
    }

    const second = await composeVideoShots(videoId, { id: assemblyStep.id }, alignedScenes, profile, "portrait")

    expect(second).not.toBeNull()
    // Тот же счёт: повторный заход не потерял и не задвоил ни одного кадра.
    expect(second!.composedCount).toBe(4)
    expect(second!.shots.map(s => s.order)).toEqual([0, 1, 3, 4])

    // Уже собранные кадры НЕ пересобраны: mtime не изменился ни у одного файла.
    for (const order of [0, 1, 3, 4]) {
      const mtimeAfter = (await stat(byOrder.get(order)!.assetPath!)).mtimeMs
      expect(mtimeAfter).toBe(mtimesBefore.get(order))
    }
    // fitPresenterClipsToScenes читает СНАПШОТ (уже проставленный), а не
    // пересчитывает trim/hold заново — те же файлы, тот же mtime.
    expect((await stat(trimFitPath)).mtimeMs).toBe(fitMtimesBefore.trim)
    expect((await stat(holdFitPath)).mtimeMs).toBe(fitMtimesBefore.hold)

    // assetPath не сломан повторным заходом — те же пути, что и после первого.
    const shotsAfterSecond = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
    const byOrderSecond = new Map(shotsAfterSecond.map(s => [s.order, s]))
    for (const order of [0, 1, 3, 4]) {
      expect(byOrderSecond.get(order)!.assetPath).toBe(byOrder.get(order)!.assetPath)
      expect(byOrderSecond.get(order)!.status).toBe("completed")
    }
    // Донор слияния и битый кадр остаются в прежнем (деградированном) состоянии.
    expect(byOrderSecond.get(2)!.status).toBe("degraded")
    expect(byOrderSecond.get(5)!.status).toBe("degraded")
  }, 180_000)
})
