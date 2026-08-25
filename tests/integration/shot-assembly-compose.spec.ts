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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { prisma } from "~~/server/utils/prisma"
import { logAgent } from "~~/server/utils/agent-logger"
;(globalThis as Record<string, unknown>).logAgent = logAgent

import { ensureDir, getAssetsDir, probeMediaDuration } from "~~/server/utils/render"
;(globalThis as Record<string, unknown>).ensureDir = ensureDir
;(globalThis as Record<string, unknown>).getAssetsDir = () => workDir

import {
  composeVideoShots, runShotBackgrounds,
  type ShotBackgroundStepDeps, type VideoShotBackgroundInput,
} from "~~/server/utils/video-pipeline-steps"
import { planShotAssembly } from "~~/server/utils/render"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import type { EditPlanModelUsage } from "~~/server/utils/edit-plan/runner"
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

/** Содержимое файла байт в байт — «ролик другой» проверяется им, а не только mtime. */
async function sha1OfFile(path: string): Promise<string> {
  return createHash("sha1").update(await readFile(path)).digest("hex")
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

    // ══════════════════ Фикс-раунд 1, Critical 1 (ревью) ══════════════════
    // Битый кадр order 5 выпал из `shots` ВМЕСТЕ со своим интервалом [9,11):
    // четыре собранных кадра покрывают только [0,9) при треке в 11с. Это
    // РЕАЛЬНАЯ демонстрация дыры, а не синтетика — тот же вход, которым
    // ревьюер показал недостающую защиту. planShotAssembly (единственная
    // точка решений сборки, вызываемая `assembleVideo` безусловно) обязана
    // отказаться собирать ролик с такой дырой, а не молча склеить 9 секунд
    // картинки под 11-секундный трек.
    expect(second!.shots.map(s => [s.order, s.startSec, s.endSec])).toEqual([
      [0, 0, 2], [1, 2, 5], [3, 5, 7], [4, 7, 9],
    ])
    expect(() => planShotAssembly({
      shotTimeline: { shots: second!.shots, trackDurationSec: 11 },
      clipVolumeWithVoiceover: 0,
      clips: [],
    })).toThrow(/не покрывают/)
  }, 180_000)

  // Important 1 (ревью фикс-раунда 1): `_fit.mp4` не регистрируется как
  // `VideoAsset`, ничей каскад сброса его не сносит, а старая идемпотентность
  // решала по ФАКТУ СУЩЕСТВОВАНИЯ файла — не сверяя его длительность с
  // текущей целью. Перепланировка (новый трек → другие границы сцены) должна
  // перегенерировать файл, а не молча подставить старый, обрезанный под
  // прежнюю (уже неактуальную) длину.
  it("устаревший scene_N_lipsync_fit.mp4 перегенерируется, если цель сменилась (Important 1)", async () => {
    const { videoId } = await createFixture()

    const presenterSourcePath = join(workDir, "presenter_scene1_raw.mp4")
    await renderTestClip(presenterSourcePath, 6.0, 900) // с запасом на обе цели ниже (2с и 5с)

    await prisma.videoShot.create({
      data: {
        videoId, order: 0, startSec: 0, endSec: 2, sceneOrder: 1,
        foreground: "presenter", pipEnabled: false, background: "none",
      },
    })
    await prisma.videoGenerationStep.create({
      data: {
        videoId, stepKey: "lip_sync_generation" as never, stepIndex: 5, status: "completed" as never,
        outputSnapshot: {
          scenes: [{
            sceneOrder: 1, sceneIndex: 0, sourcePath: presenterSourcePath,
            outputPath: presenterSourcePath, audioPath: null, spokenLineHash: null,
            reuseKey: null, durationSec: 6.0, skipped: null,
          }],
        },
      },
    })
    const assemblyStep = await prisma.videoGenerationStep.create({
      data: { videoId, stepKey: "assembly" as never, stepIndex: 6, status: "running" as never },
    })
    const profile = { ...DEFAULT_EDIT_PROFILE, pipEnabled: false }
    const fittedPath = join(workDir, "scene_1_lipsync_fit.mp4")

    // Первый проход: цель 2с.
    const shortTarget: AlignedScene[] = [{ order: 1, startSec: 0, endSec: 2, words: [] }]
    const first = await composeVideoShots(videoId, { id: assemblyStep.id }, shortTarget, profile, "portrait")
    expect(first).not.toBeNull()
    expect(first!.composedCount).toBe(1)
    const firstFitSec = await probeMediaDuration(fittedPath)
    expect(firstFitSec).not.toBeNull()
    expect(Math.abs(firstFitSec! - 2.0)).toBeLessThan(0.15)

    // Перепланировка: та же сцена, но НОВАЯ цель — 5с (трек пересинтезирован,
    // границы сцены другие). `_fit.mp4` прошлого прохода лежит на диске.
    await prisma.videoShot.updateMany({ where: { videoId, order: 0 }, data: { endSec: 5, status: "planned", assetPath: null } })
    const newTarget: AlignedScene[] = [{ order: 1, startSec: 0, endSec: 5, words: [] }]
    const second = await composeVideoShots(videoId, { id: assemblyStep.id }, newTarget, profile, "portrait")
    expect(second).not.toBeNull()
    expect(second!.composedCount).toBe(1)

    const secondFitSec = await probeMediaDuration(fittedPath)
    expect(secondFitSec).not.toBeNull()
    // Устаревшая идемпотентность (только по существованию файла) вернула бы
    // здесь ~2.0с — старый файл, подставленный под новую цель.
    expect(Math.abs(secondFitSec! - 5.0)).toBeLessThan(0.15)
    expect(secondFitSec!).toBeGreaterThan(3.0) // разведено с прежней целью (2с) с явным запасом
  }, 60_000)

  /**
   * Critical 2 финального ревью ветки. Ключ переиспользования собранного кадра —
   * «путь + `status: completed` + файл существует» — содержимого не кодирует, а
   * `runShotBackgrounds` не трогал `assetPath`. Оператор перезапускал платный
   * шаг фонов, ПЛАТИЛ за новые картинки и получал ролик байт в байт прежний,
   * без единой ошибки: `shot_N_composed.mp4` не `VideoAsset` и ни одним
   * каскадом не сносится.
   *
   * Тест идёт настоящим продакшн-путём (`runShotBackgrounds` → `composeVideoShots`
   * на реальной БД и реальном ffmpeg), а не подменяет строки руками, и смотрит
   * НАБЛЮДАЕМЫЙ результат — sha1 собранного файла. Второе требование брифа
   * («без сноса чужих кадров») проверяется соседом: у кадра, чей фон
   * переиспользован, собранный файл обязан остаться тем же (mtime не сдвинут) —
   * иначе «чиню» превращается в «пересобираю всё каждый раз».
   */
  it("Critical 2: перерисованный фон обесценивает собранный кадр, сосед остаётся оплаченным", async () => {
    const { videoId } = await createFixture()

    const greenPath = join(workDir, "bg_green.png")
    const redPath = join(workDir, "bg_red.png")
    await renderStillImage(greenPath, "green")
    await renderStillImage(redPath, "red")

    for (const order of [0, 1]) {
      await prisma.videoShot.create({
        data: {
          videoId, order, startSec: order * 2, endSec: order * 2 + 2, sceneOrder: null,
          foreground: "none", background: "image", idea: `идея кадра ${order}`, pipEnabled: false,
        },
      })
    }
    const assemblyStep = await prisma.videoGenerationStep.create({
      data: { videoId, stepKey: "assembly" as never, stepIndex: 6, status: "running" as never },
    })

    const PROMPT_USAGE: EditPlanModelUsage = { model: "claude-sonnet-4-6", inputTokens: 400, outputTokens: 80 }
    const shotInput: VideoShotBackgroundInput = {
      videoId,
      trackFingerprint: "fp-compose-1",
      format: "portrait",
      renderQuality: "medium",
      profile: { ...DEFAULT_EDIT_PROFILE },
      visualStyle: null,
      appName: null,
      imageModelId: "replicate:flux-dev",
      videoModelId: "replicate:kling-v1.6-standard-t2v",
      sceneTextByOrder: new Map<number, string>(),
    }
    /** Провайдер картинок подменён: платных вызовов нет, а файл — реальный PNG на диске. */
    function shotDeps(imageFor: (order: number) => string): ShotBackgroundStepDeps {
      return {
        planPrompts: vi.fn(async (promptInput: {
          shots: Array<{ order: number, idea: string | null }>
          onUsage?: (u: EditPlanModelUsage) => void
        }) => {
          promptInput.onUsage?.(PROMPT_USAGE)
          return {
            prompts: promptInput.shots.map(s => ({
              order: s.order,
              prompt: `промпт кадра ${s.order}: ${s.idea ?? "без идеи"}`.padEnd(60, "."),
              purpose: "тест",
            })),
            usage: PROMPT_USAGE,
          }
        }),
        generateImage: vi.fn(async (args: { order: number }) => ({ localPath: imageFor(args.order), costUsd: 0.025 })),
        generateVideo: vi.fn(async (args: { order: number, billedSec: number }) => ({
          localPath: imageFor(args.order), costUsd: args.billedSec * 0.05, effectiveDurationSec: args.billedSec,
        })),
      } as ShotBackgroundStepDeps
    }

    // ── Первый прогон: оба кадра на ЗЕЛЁНОМ фоне, оба собраны ──────────────
    const bgFirst = await runShotBackgrounds(shotInput, shotDeps(() => greenPath))
    expect(bgFirst.renderedCount).toBe(2)

    const composeFirst = await composeVideoShots(videoId, { id: assemblyStep.id }, [], DEFAULT_EDIT_PROFILE, "portrait")
    expect(composeFirst!.composedCount).toBe(2)

    const shotsAfterFirst = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
    const composedPath0 = shotsAfterFirst[0]!.assetPath!
    const composedPath1 = shotsAfterFirst[1]!.assetPath!
    const sha0Before = await sha1OfFile(composedPath0)
    const sha1Before = await sha1OfFile(composedPath1)
    const mtime0Before = (await stat(composedPath0)).mtimeMs

    // ── Оператор переписал идею ОДНОГО кадра: шаг фонов рисует его КРАСНЫМ,
    // сосед переиспользуется бесплатно (отпечаток входов не сдвинулся) ─────
    await prisma.videoShot.updateMany({ where: { videoId, order: 1 }, data: { idea: "идея кадра 1 — переписана" } })
    const bgSecond = await runShotBackgrounds(shotInput, shotDeps(order => (order === 1 ? redPath : greenPath)))
    expect(bgSecond.renderedCount).toBe(1)
    expect(bgSecond.reusedCount).toBe(1)
    const assets = await prisma.videoAsset.findMany({
      where: { videoId, type: "shot_background" as never }, orderBy: { order: "asc" },
    })
    expect(assets[1]!.filePath).toBe(redPath) // фон кадра 1 действительно новый

    // ── Второй монтаж: кадр 1 обязан быть ДРУГИМ файлом, кадр 0 — тем же ────
    const composeSecond = await composeVideoShots(videoId, { id: assemblyStep.id }, [], DEFAULT_EDIT_PROFILE, "portrait")
    expect(composeSecond!.composedCount).toBe(2)

    const shotsAfterSecond = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
    const sha1After = await sha1OfFile(shotsAfterSecond[1]!.assetPath!)
    expect(sha1After).not.toBe(sha1Before)

    // Сосед: тот же путь, тот же файл, ffmpeg по нему не гонялся заново.
    expect(shotsAfterSecond[0]!.assetPath).toBe(composedPath0)
    expect(await sha1OfFile(shotsAfterSecond[0]!.assetPath!)).toBe(sha0Before)
    expect((await stat(shotsAfterSecond[0]!.assetPath!)).mtimeMs).toBe(mtime0Before)
  }, 180_000)

  /**
   * Important 3 финального ревью ветки. Покрытие трека проверялось по
   * ЗАЯВЛЕННЫМ интервалам `VideoShot`, а ffmpeg не обязан выдать заказанную
   * длительность: живой замер ревьюера — вырезка `-t 2.000` из источника в
   * 1.0с даёт файл 1.000000с и EXIT=0. Добивку удержанием кадра имела только
   * ветка `background_full`; `presenter_full` и `pip` — нет.
   *
   * Достижимый путь (`fitPresenterClipsToScenes`): у записи lip-sync нет
   * соответствующей сцены в ТЕКУЩЕМ выравнивании — клип берётся как есть, к
   * длине сцены не приводится, а `sceneStartSec` откатывается на
   * `shot.startSec`. Заказанная длина кадра оказывается втрое больше клипа.
   * Итог до правки: склейка короче трека, `amix duration=first` режет речь,
   * ролик помечается готовым — девятый путь §10.
   */
  it("Important 3: presenter-исходник короче кадра — собранный файл всё равно равен заявленной длине (presenter_full и pip)", async () => {
    const { videoId } = await createFixture()

    const shortPresenterPath = join(workDir, "presenter_short.mp4")
    await renderTestClip(shortPresenterPath, 1.0, 1000) // втрое короче любого из кадров ниже
    // Фон PiP — ДВИЖУЩИЙСЯ (testsrc), а не заливка: только на нём видно, что
    // добита была короткая дорожка ВЕДУЩЕГО, а не весь кадр целиком.
    const bgMovingPath = join(workDir, "bg_pip_moving.mp4")
    await renderTestClip(bgMovingPath, 4.0, 300)

    // order 0 [0,3) — presenter_full; order 1 [3,6) — pip (фон + ведущий).
    for (const s of [
      { order: 0, startSec: 0, endSec: 3, sceneOrder: 7, pipEnabled: false },
      { order: 1, startSec: 3, endSec: 6, sceneOrder: 8, pipEnabled: true },
    ]) {
      await prisma.videoShot.create({
        data: {
          videoId, order: s.order, startSec: s.startSec, endSec: s.endSec, sceneOrder: s.sceneOrder,
          foreground: "presenter", pipEnabled: s.pipEnabled, background: s.order === 1 ? "image" : "none",
        },
      })
    }
    await prisma.videoAsset.create({
      data: { videoId, type: "shot_background" as never, order: 1, filePath: bgMovingPath, contentType: "video/mp4" },
    })
    await prisma.videoGenerationStep.create({
      data: {
        videoId, stepKey: "lip_sync_generation" as never, stepIndex: 5, status: "completed" as never,
        outputSnapshot: {
          scenes: [7, 8].map((sceneOrder, index) => ({
            sceneOrder, sceneIndex: index, sourcePath: shortPresenterPath, outputPath: shortPresenterPath,
            audioPath: null, spokenLineHash: null, reuseKey: null, durationSec: 1.0, skipped: null,
          })),
        },
      },
    })
    const assemblyStep = await prisma.videoGenerationStep.create({
      data: { videoId, stepKey: "assembly" as never, stepIndex: 6, status: "running" as never },
    })

    // Выравнивание НЕ содержит сцен 7 и 8 — приводить клип не к чему.
    const profile = { ...DEFAULT_EDIT_PROFILE, pipEnabled: true }
    const result = await composeVideoShots(videoId, { id: assemblyStep.id }, [], profile, "portrait")

    expect(result).not.toBeNull()
    expect(result!.composedCount).toBe(2)

    const shots = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
    const presenterFullSec = await probeMediaDuration(shots[0]!.assetPath!)
    const pipSec = await probeMediaDuration(shots[1]!.assetPath!)

    // До правки оба файла выходили ~1.0с при заказанных 3.0с — молча, с EXIT=0.
    expect(presenterFullSec).not.toBeNull()
    expect(pipSec).not.toBeNull()
    expect(Math.abs(presenterFullSec! - 3.0)).toBeLessThan(0.15)
    expect(Math.abs(pipSec! - 3.0)).toBeLessThan(0.15)

    // Добита короткая дорожка ВЕДУЩЕГО, а не итог наложения: фон в хвосте
    // кадра продолжает жить. Замри-добивка поверх готового PiP дала бы здесь
    // два одинаковых кадра — длительность сошлась бы, а картинка встала.
    const tailA = join(workDir, "pip_tail_a.png")
    const tailB = join(workDir, "pip_tail_b.png")
    await ffmpeg(["-ss", "1.5", "-i", shots[1]!.assetPath!, "-frames:v", "1", tailA])
    await ffmpeg(["-ss", "2.5", "-i", shots[1]!.assetPath!, "-frames:v", "1", tailB])
    expect(await sha1OfFile(tailA)).not.toBe(await sha1OfFile(tailB))
  }, 180_000)
})
