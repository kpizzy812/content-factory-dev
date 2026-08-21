import { spawn } from "node:child_process"
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { prisma } from "~~/server/utils/prisma"
import { ffmpegIngestDependencies } from "~~/server/utils/presenter/ffmpeg-adapter"
import { ingestPresenterRecording } from "~~/server/utils/presenter/ingest-runner"
import { reserveRecordingWindow } from "~~/server/utils/presenter-recording-selector"
import {
  RecordingIngestRunningError,
  markIngestCompleted,
  markIngestFailed,
  markIngestRunning,
  reingestRecording,
  saveRecording,
} from "~~/server/utils/presenter/recording-store"
import type { ReingestRecordingDependencies, SaveRecordingDependencies } from "~~/server/utils/presenter/recording-store"

let appId: number
let characterId: string

// beforeEach, не beforeAll: tests/setup.ts делает TRUNCATE всех таблиц public
// после КАЖДОГО теста (см. afterEach там же), поэтому app/character нужно
// пересоздавать перед каждым it — состояние между тестами не переживает.
beforeEach(async () => {
  const app = await prisma.app.create({ data: { name: "presenter-recording-test" } })
  appId = app.id
  const character = await prisma.character.create({
    data: { appId, name: "Ведущая" },
  })
  characterId = character.id
})

describe("схема записей ведущего", () => {
  it("хранит нормализованную запись с дедупом по оригиналу", async () => {
    const created = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/aaaa1111bbbb2222.mp4`,
        storageProvider: "gcs",
        sha1: "aaaa1111bbbb2222",
        durationSec: 612.4,
        fps: 30,
        width: 1080,
        height: 1920,
        bytes: 340_000_000,
        originalName: "dubl-01.mov",
        originalBytes: 1_900_000_000,
      },
    })

    expect(created.retention).toBe("auto")
    expect(created.ingestStatus).toBe("pending")

    // Повторная заливка того же ОРИГИНАЛА не создаёт вторую запись.
    await expect(prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "любой другой ключ",
        sha1: "aaaa1111bbbb2222",
        durationSec: 612.4,
        originalName: "dubl-01-copy.mov",
      },
    })).rejects.toThrow()
  })

  it("связывает клип с записью-родителем, но не требует её", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-parent",
        sha1: "parent1111",
        durationSec: 60,
        originalName: "parent.mov",
      },
    })

    const withParent = await prisma.presenterSourceClip.create({
      data: {
        characterId,
        recordingId: recording.id,
        fileUrl: "https://cdn/clip-1.mp4",
        sha1: "clip1111",
        durationSec: 4.2,
      },
    })
    const orphan = await prisma.presenterSourceClip.create({
      data: {
        characterId,
        fileUrl: "https://cdn/clip-2.mp4",
        sha1: "clip2222",
        durationSec: 3.1,
      },
    })

    expect(withParent.recordingId).toBe(recording.id)
    // Клипы, залитые до этой работы, живут без записи и продолжают работать.
    expect(orphan.recordingId).toBeNull()
  })

  it("пишет использованный интервал записи", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-usage",
        sha1: "usage1111",
        durationSec: 60,
        originalName: "usage.mov",
      },
    })
    const scenario = await prisma.scenario.create({ data: { status: "draft" } })
    const video = await prisma.video.create({ data: { scenarioId: scenario.id } })

    const usage = await prisma.presenterRecordingUsage.create({
      data: {
        recordingId: recording.id,
        startSec: 12.5,
        endSec: 17.25,
        videoId: video.id,
      },
    })

    expect(usage.usedAt).toBeInstanceOf(Date)
  })

  it("удаление записи уносит её интервалы, но не клипы", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp",
        sha1: "cccc3333",
        durationSec: 30,
        originalName: "tmp.mov",
      },
    })
    const clip = await prisma.presenterSourceClip.create({
      data: { characterId, recordingId: recording.id, fileUrl: "u", sha1: "clip3333", durationSec: 3 },
    })
    await prisma.presenterRecordingUsage.create({
      data: { recordingId: recording.id, startSec: 0, endSec: 3 },
    })

    await prisma.presenterRecording.delete({ where: { id: recording.id } })

    expect(await prisma.presenterRecordingUsage.count({ where: { recordingId: recording.id } })).toBe(0)
    // Клип переживает удаление записи: файл клипа лежит отдельно и уже
    // использован в роликах — снести его вместе с исходником значит сломать
    // историю.
    const survived = await prisma.presenterSourceClip.findUnique({ where: { id: clip.id } })
    expect(survived?.recordingId).toBeNull()
  })
})

/**
 * Фейковое хранилище для проверки `saveRecording` без сети: считает
 * заливки, отвечает на `exists`, умеет "потерять" объект (симуляция сироты
 * после обрыва между `create` и `uploadFile`).
 */
function fakeStorage() {
  const objects = new Set<string>()
  let uploadCalls = 0

  const driver: Pick<
    ReturnType<SaveRecordingDependencies["getStorageDriver"]>,
    "exists" | "uploadFile" | "providerName"
  > = {
    providerName: "mock",
    async exists(key: string) {
      return objects.has(key)
    },
    async uploadFile(key: string) {
      uploadCalls += 1
      objects.add(key)
      return { key, sizeBytes: BigInt(0) }
    },
  }

  return {
    driver,
    forget: (key: string) => objects.delete(key),
    get uploadCalls() {
      return uploadCalls
    },
  }
}

describe("сохранение записи и статус нарезки (saveRecording)", () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "presenter-recording-test-"))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  })

  // Ни одного реального ffmpeg-процесса и ни одного платного вызова: transcode
  // и storage подменены фейками через инъекцию зависимостей saveRecording.
  it("повторный saveRecording того же оригинала не создаёт вторую строку и не заливает файл второй раз", async () => {
    const originalPath = join(workDir, "original.mov")
    await writeFile(originalPath, Buffer.from("original-bytes-repeat"))
    const normalizedPath = join(workDir, "normalized.mp4")

    const storage = fakeStorage()
    let normalizeCalls = 0
    const deps: SaveRecordingDependencies = {
      sha1OfFile: async () => "repeatsha1",
      normalizeRecording: async (_input, output) => {
        normalizeCalls += 1
        await writeFile(output, Buffer.from("normalized"))
      },
      probeRecordingMeta: async () => ({ durationSec: 42, fps: 30, width: 1080, height: 1920 }),
      getStorageDriver: () => storage.driver,
    }
    const input = { appId, characterId, originalPath, normalizedPath, originalName: "rec.mov", originalBytes: 100 }

    const first = await saveRecording(input, deps)
    expect(first.deduped).toBe(false)
    expect(normalizeCalls).toBe(1)
    expect(storage.uploadCalls).toBe(1)

    const second = await saveRecording(input, deps)
    expect(second.deduped).toBe(true)
    expect(second.recordingId).toBe(first.recordingId)
    // Повторный вызов не платит второй раз: ни нормализации, ни заливки.
    expect(normalizeCalls).toBe(1)
    expect(storage.uploadCalls).toBe(1)

    expect(await prisma.presenterRecording.count({ where: { characterId } })).toBe(1)
  })

  // Регрессия на Critical 1: обрыв между `create` и `uploadFile` оставляет
  // строку без объекта — дедуп обязан это заметить и перезалить, а не
  // выдавать "готово" на несуществующий файл вечно.
  it("дедуп при отсутствующем в хранилище объекте перезаливает файл, не создавая вторую строку", async () => {
    const originalPath = join(workDir, "original.mov")
    await writeFile(originalPath, Buffer.from("original-bytes-orphan"))
    const normalizedPath = join(workDir, "normalized.mp4")

    const storage = fakeStorage()
    let normalizeCalls = 0
    const deps: SaveRecordingDependencies = {
      sha1OfFile: async () => "orphansha1",
      normalizeRecording: async (_input, output) => {
        normalizeCalls += 1
        await writeFile(output, Buffer.from("normalized"))
      },
      probeRecordingMeta: async () => ({ durationSec: 30, fps: 30, width: 1080, height: 1920 }),
      getStorageDriver: () => storage.driver,
    }
    const input = { appId, characterId, originalPath, normalizedPath, originalName: "rec.mov", originalBytes: 100 }

    const first = await saveRecording(input, deps)
    expect(storage.uploadCalls).toBe(1)

    // Симулируем сироту: объект пропал из хранилища (обрыв процесса, ручное
    // удаление, рестарт на середине многоминутной отправки).
    storage.forget(first.storageKey)

    const second = await saveRecording(input, deps)
    expect(second.recordingId).toBe(first.recordingId)
    expect(second.deduped).toBe(true)
    expect(normalizeCalls).toBe(2)
    expect(storage.uploadCalls).toBe(2)
    expect(await storage.driver.exists(first.storageKey)).toBe(true)

    // Вторая строка не завелась — почин той же самой.
    expect(await prisma.presenterRecording.count({ where: { characterId } })).toBe(1)
  })

  // Регрессия на Important 2: ffprobe при неразобранной длительности не
  // бросает, а резолвит 0 — молчаливая ложь, отравляющая запись навсегда.
  it("отказывает при неизмеримой длительности и не оставляет строку", async () => {
    const originalPath = join(workDir, "original.mov")
    await writeFile(originalPath, Buffer.from("original-bytes-zero-duration"))
    const normalizedPath = join(workDir, "normalized.mp4")

    const storage = fakeStorage()
    const deps: SaveRecordingDependencies = {
      sha1OfFile: async () => "zerodurationsha1",
      normalizeRecording: async (_input, output) => {
        await writeFile(output, Buffer.from("normalized"))
      },
      probeRecordingMeta: async () => ({ durationSec: 0, fps: null, width: null, height: null }),
      getStorageDriver: () => storage.driver,
    }
    const input = { appId, characterId, originalPath, normalizedPath, originalName: "rec.mov", originalBytes: 100 }

    await expect(saveRecording(input, deps)).rejects.toThrow(/длительность/)

    expect(storage.uploadCalls).toBe(0)
    expect(await prisma.presenterRecording.count({ where: { characterId } })).toBe(0)
  })

  it("markIngestRunning/Completed/Failed двигают статус и пишут ingestError", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-status",
        sha1: "statussha1",
        durationSec: 10,
        originalName: "status.mov",
      },
    })

    await markIngestRunning(recording.id)
    const running = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(running?.ingestStatus).toBe("running")
    expect(running?.ingestStartedAt).toBeInstanceOf(Date)
    expect(running?.ingestError).toBeNull()

    await markIngestCompleted(recording.id)
    const completed = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(completed?.ingestStatus).toBe("completed")
    expect(completed?.ingestFinishedAt).toBeInstanceOf(Date)

    const second = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-status-2",
        sha1: "statussha2",
        durationSec: 10,
        originalName: "status2.mov",
      },
    })
    await markIngestFailed(second.id, new Error("бум"))
    const failed = await prisma.presenterRecording.findUnique({ where: { id: second.id } })
    expect(failed?.ingestStatus).toBe("failed")
    expect(failed?.ingestError).toBe("бум")
    expect(failed?.ingestFinishedAt).toBeInstanceOf(Date)
  })
})

/**
 * Плоский чёрный клип НАСТОЯЩИМ ffmpeg (тот же приём, что и в
 * audio-first-pipeline.spec.ts: `color`/`anullsrc` через lavfi, без сети и
 * без внешних фикстур). 12 секунд без склеек и без внутренней речи: тишина
 * касается обоих краёв записи целиком, поэтому `silenceCutPoints` отбрасывает
 * её как краевую (silence-detect.ts) — границ речи не находится, сцен на
 * ровном кадре тоже нет, и `boundarySource` получается `"none"`.
 * Планировщик (planPresenterSegments) в этом случае делит запись пополам:
 * два сегмента по 6с, оба в пределах 2-10с, допустимых для lip-sync.
 *
 * Используется только там, где нужен именно `"none"` — регрессия на
 * Important 3(a) (исключение клипов этой же записи из сравнения похожести).
 * Для остальных тестов используется `renderSilenceFixture` ниже: у реальной
 * записи ведущей границы всегда от пауз речи, и большинство сценариев обязаны
 * проверяться на них, а не на вырожденном случае.
 */
function renderFlatFixture(outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "color=black:size=640x360:duration=12:rate=24",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=44100",
      "-shortest",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
      "-c:a", "aac", "-b:a", "64k",
      outPath,
    ], { stdio: "ignore" })
    proc.once("error", reject)
    proc.once("exit", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))))
  })
}

/**
 * Тон-тишина-тон: 4с тона + 2с настоящей цифровой тишины + 6с тона, видео —
 * тот же плоский чёрный кадр на все 12с. `silencedetect` находит ОДНУ
 * внутреннюю паузу [4с, 6с] (не касается краёв записи — не отбрасывается как
 * краевая), `silenceCutPoints` даёт точку реза ~5с, и `boundarySource`
 * получается `"silence"` — ровно тот путь, по которому размечается реальная
 * запись ведущей (docs/PROJECT_CONTEXT.md, ingest-runner.ts: непрерывный дубль
 * без склеек, границы — только паузы речи).
 *
 * На `"silence"` перцептивный отбор похожих кадров ВЫКЛЮЧЕН
 * (`dropSimilarClips = boundarySource !== "silence"`, ingest-runner.ts) —
 * значит идемпотентность повторного реингеста на этом пути держится
 * ИСКЛЮЧИТЕЛЬНО на совпадении sha1 нарезанного файла, а не на похожести
 * кадров. Задача Important 4 — доказать именно эту ветку, а не ту, где
 * дубли отсеиваются раньше, до сравнения sha1.
 */
function renderSilenceFixture(outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "color=black:size=640x360:duration=12:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4:sample_rate=44100",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=44100:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6:sample_rate=44100",
      "-filter_complex", "[1:a][2:a][3:a]concat=n=3:v=0:a=1[aout]",
      "-map", "0:v", "-map", "[aout]",
      "-shortest",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
      "-c:a", "aac", "-b:a", "64k",
      outPath,
    ], { stdio: "ignore" })
    proc.once("error", reject)
    proc.once("exit", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))))
  })
}

/**
 * Зависимости `reingestRecording` для теста: скачивание из хранилища, работа
 * с временным каталогом и заливка клипов подменены (никакой сети/реального
 * хранилища), а сама нарезка — `ingestPresenterRecording` +
 * `ffmpegIngestDependencies` — НЕ подменена: настоящий ffmpeg режет настоящий
 * fixturePath. Обходить нарезку моком здесь недопустимо — это и есть
 * проверяемая логика задачи. `uploadCount()` считает реальные заливки —
 * нужен, чтобы доказать, что sha1-дедуп срабатывает ДО заливки, а не просто
 * откидывает лишние строки в БД постфактум.
 */
function createFakeReingestDeps(fixturePath: string): {
  deps: ReingestRecordingDependencies
  uploadCount: () => number
} {
  let uploads = 0
  const deps: ReingestRecordingDependencies = {
    downloadToFile: async (_storageKey, localPath) => {
      await copyFile(fixturePath, localPath)
    },
    uploadClip: async () => {
      uploads += 1
    },
    getProviderName: () => "mock",
    createWorkDir: () => mkdtemp(join(tmpdir(), "presenter-reingest-test-")),
    ingestPresenterRecording,
    ingestDependencies: ffmpegIngestDependencies,
  }
  return { deps, uploadCount: () => uploads }
}

describe("повторная нарезка записи", () => {
  let fixtureDir: string
  let flatFixturePath: string
  let silenceFixturePath: string

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "presenter-reingest-fixture-"))
    flatFixturePath = join(fixtureDir, "flat.mp4")
    silenceFixturePath = join(fixtureDir, "silence.mp4")
    await Promise.all([
      renderFlatFixture(flatFixturePath),
      renderSilenceFixture(silenceFixturePath),
    ])
  }, 30_000)

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true }).catch(() => {})
  })

  // tests/setup.ts делает TRUNCATE после каждого it, поэтому запись из брифа
  // (findFirst по ingestStatus: "completed", доставшийся от прошлого теста)
  // здесь не работает — создаём её сами и получаем "completed" первым же
  // прогоном reingestRecording.
  //
  // Important 4 (ревью): исходная версия этого теста гоняла плоскую фикстуру
  // без внутренней тишины (`boundarySource: "none"`) — там `dropSimilarClips`
  // включён, и второй прогон получал createdIds=[] ещё ДО сравнения sha1
  // (оба сегмента отсеивались перцептивным фильтром против уже принятых
  // клипов первого прогона). Тест проходил, но проверял не ту ветку: у
  // реальной записи ведущей `boundarySource` — "silence", там перцептивный
  // отбор выключен, и от повторного создания всей библиотеки защищает
  // ТОЛЬКО совпадение sha1. Переписан на `renderSilenceFixture` и добавлена
  // проверка счётчика заливок — без неё «createdIds пуст» можно получить и
  // просто откинув строки в БД постфактум, не проверив, что заливки не было.
  it("не создаёт дублей клипов и не заливает второй раз (sha1-ветка на границах-паузах)", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-reingest-source",
        sha1: "reingestsha1",
        durationSec: 12,
        originalName: "reingest.mov",
      },
    })

    const { deps, uploadCount } = createFakeReingestDeps(silenceFixturePath)

    const first = await reingestRecording(recording.id, {}, deps)
    // Если фикстура вдруг перестанет давать внутреннюю паузу (другая версия
    // ffmpeg, другой порог) — тест обязан упасть здесь явно, а не молча
    // проверить не ту ветку, как было до этой правки.
    expect(first.boundarySource).toBe("silence")
    expect(first.createdIds.length).toBeGreaterThan(0)
    expect(first.deactivatedClips).toBe(0)

    const afterFirst = await prisma.presenterSourceClip.count({ where: { recordingId: recording.id } })
    expect(afterFirst).toBe(first.createdIds.length)
    const uploadsAfterFirst = uploadCount()
    expect(uploadsAfterFirst).toBe(first.createdIds.length)

    // Тот же материал, те же правила — те же sha1 клипов, а уникальность
    // (characterId, sha1) не даёт создать вторую строку. Вторая нарезка не
    // добавила ни одной записи и не залила ни одного нового объекта.
    const second = await reingestRecording(recording.id, {}, deps)
    expect(second.createdIds).toHaveLength(0)
    // Подтверждённые по sha1 клипы не гасятся (Important 3, часть "б").
    expect(second.deactivatedClips).toBe(0)

    const afterSecond = await prisma.presenterSourceClip.count({ where: { recordingId: recording.id } })
    expect(afterSecond).toBe(afterFirst)
    expect(uploadCount()).toBe(uploadsAfterFirst)

    const reloaded = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(reloaded?.ingestStatus).toBe("completed")
  }, 30_000)

  it("поднимает упавший ingest из статуса failed", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-reingest-broken",
        sha1: "dddd4444",
        durationSec: 20,
        originalName: "broken.mov",
        ingestStatus: "failed",
        ingestError: "процесс убит на середине",
      },
    })

    const { deps } = createFakeReingestDeps(silenceFixturePath)
    await reingestRecording(recording.id, {}, deps).catch(() => {})

    const reloaded = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    // Статус обязан уйти из failed: либо completed, либо новая честная ошибка.
    expect(reloaded!.ingestStatus).not.toBe("failed")
    expect(reloaded!.ingestStartedAt).not.toBeNull()
  }, 30_000)

  // Не из брифа: закрывает гонку, которую вводит атомарный захват статуса в
  // reingestRecording (защита от двойной оплаты процессорного времени).
  it("отклоняет запуск, пока предыдущая нарезка этой же записи ещё идёт (running свежий)", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-reingest-running",
        sha1: "runningsha1",
        durationSec: 12,
        originalName: "running.mov",
        ingestStatus: "running",
        ingestStartedAt: new Date(),
      },
    })

    const { deps } = createFakeReingestDeps(silenceFixturePath)
    await expect(reingestRecording(recording.id, {}, deps))
      .rejects.toThrow(RecordingIngestRunningError)

    const reloaded = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(reloaded?.ingestStatus).toBe("running")
  })

  // Important 1 (ревью): без порога зависший "running" (процесс убит kill -9,
  // деплой, OOM на 4K-записи) был бы заперт навсегда — ни эндпоинт (409), ни
  // прямой вызов (RecordingIngestRunningError) не смогли бы его починить.
  it("лечит зависший running: статус старше порога — не запирает реингест навсегда", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-reingest-stale-running",
        sha1: "stalerunningsha1",
        durationSec: 12,
        originalName: "stale-running.mov",
        ingestStatus: "running",
        // Больше STALE_RUNNING_THRESHOLD_MS (2 часа) — имитация процесса,
        // убитого посреди нарезки: статус остался "running" навсегда.
        ingestStartedAt: new Date(Date.now() - 3 * 60 * 60_000),
      },
    })

    const { deps } = createFakeReingestDeps(silenceFixturePath)
    const result = await reingestRecording(recording.id, {}, deps)
    expect(result.createdIds.length).toBeGreaterThan(0)

    const reloaded = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(reloaded?.ingestStatus).toBe("completed")
  }, 30_000)

  // Important 2 (ревью): mkdtemp раньше вызывался ДО try — отказ (нет места на
  // диске, нет прав) вылетал наружу без markIngestFailed, оставляя "running"
  // без причины. createWorkDir теперь внутри try и это доказуемо тестом.
  it("падение до начала нарезки (нет рабочего каталога) переводит запись в failed, а не оставляет running", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-reingest-workdir-fail",
        sha1: "workdirfailsha1",
        durationSec: 12,
        originalName: "workdir-fail.mov",
      },
    })

    const { deps } = createFakeReingestDeps(silenceFixturePath)
    const brokenDeps: ReingestRecordingDependencies = {
      ...deps,
      createWorkDir: async () => { throw new Error("нет места на диске (симуляция)") },
    }

    await expect(reingestRecording(recording.id, {}, brokenDeps)).rejects.toThrow(/нет места на диске/)

    const reloaded = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(reloaded?.ingestStatus).toBe("failed")
    expect(reloaded?.ingestError).toContain("нет места на диске")
    expect(reloaded?.ingestStartedAt).not.toBeNull()
  })

  // Important 3, часть "а" (ревью): known раньше собирался по ВСЕМ активным
  // клипам персонажа, включая клипы этой же записи от предыдущего прогона.
  // На границах-таймере (`dropSimilarClips=true`) это гарантированно обнуляло
  // результат — первый же новый сегмент "похож" сам на себя из прошлого раза.
  it("не отбрасывает новый разрез из-за похожести на свой же старый разрез (границы не от пауз)", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-reingest-self-compare",
        sha1: "selfcomparesha1",
        durationSec: 12,
        originalName: "flat.mov",
      },
    })
    // Сплошной чёрный кадр даёт детерминированный dHash "00...0" (все соседние
    // пиксели равны) — ровно тот хеш, который получит и новый разрез этого же
    // материала. Без исключения recordingId этот клип попал бы в `known`.
    await prisma.presenterSourceClip.create({
      data: {
        characterId,
        recordingId: recording.id,
        fileUrl: "https://cdn/old-cut.mp4",
        sha1: "old-cut-not-reproduced",
        durationSec: 6,
        perceptualHash: "0000000000000000",
        isActive: true,
      },
    })

    const { deps } = createFakeReingestDeps(flatFixturePath)
    const result = await reingestRecording(recording.id, {}, deps)

    expect(result.boundarySource).toBe("none")
    // Если бы клипы этой же записи не исключались из сравнения похожести,
    // ЛЮБОЙ новый сегмент "совпал" бы с сидированным старым — createdIds
    // был бы пуст.
    expect(result.createdIds.length).toBeGreaterThan(0)
  }, 30_000)

  // Important 3, часть "б" (ревью): подтверждённый разрез не трогаем, а
  // старый разрез, который новый прогон НЕ воспроизвёл, гасим — иначе в
  // активной библиотеке остаются два разреза одного материала одновременно
  // (запрещённый docs/PROJECT_CONTEXT.md §7 дубль).
  it("деактивирует старый разрез записи, не подтверждённый новым прогоном", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-reingest-deactivate",
        sha1: "deactivatesha1",
        durationSec: 12,
        originalName: "prev-cut.mov",
      },
    })
    const staleClip = await prisma.presenterSourceClip.create({
      data: {
        characterId,
        recordingId: recording.id,
        fileUrl: "https://cdn/stale-cut.mp4",
        sha1: "stale-cut-not-reproduced",
        durationSec: 4,
        isActive: true,
      },
    })

    const { deps } = createFakeReingestDeps(silenceFixturePath)
    const result = await reingestRecording(recording.id, {}, deps)

    expect(result.createdIds.length).toBeGreaterThan(0)
    expect(result.deactivatedClips).toBe(1)

    const reloadedStale = await prisma.presenterSourceClip.findUnique({ where: { id: staleClip.id } })
    expect(reloadedStale?.isActive).toBe(false)

    const activeClips = await prisma.presenterSourceClip.findMany({
      where: { recordingId: recording.id, isActive: true },
    })
    expect(activeClips).toHaveLength(result.createdIds.length)
  }, 30_000)

  // Important 3, "осторожно, здесь легко обнулить библиотеку": если новый
  // прогон не дал НИ ОДНОГО клипа, старые активные клипы записи обязаны
  // остаться как есть — гасить нечем заменить. `maxClips: 0` — настоящий
  // способ получить пустой результат от реальной нарезки, без подмены самого
  // ingestPresenterRecording.
  it("не гасит библиотеку, если новый прогон не дал ни одного клипа", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-reingest-empty-run",
        sha1: "emptyrunsha1",
        durationSec: 12,
        originalName: "empty-run.mov",
      },
    })
    const staleClip = await prisma.presenterSourceClip.create({
      data: {
        characterId,
        recordingId: recording.id,
        fileUrl: "https://cdn/kept-cut.mp4",
        sha1: "kept-cut",
        durationSec: 4,
        isActive: true,
      },
    })

    const { deps } = createFakeReingestDeps(silenceFixturePath)
    const result = await reingestRecording(recording.id, { maxClips: 0 }, deps)

    expect(result.createdIds).toHaveLength(0)
    expect(result.deactivatedClips).toBe(0)

    const reloadedStale = await prisma.presenterSourceClip.findUnique({ where: { id: staleClip.id } })
    expect(reloadedStale?.isActive).toBe(true)
  }, 30_000)
})

// Фикстуры здесь СВОИ в каждом it, а не унаследованные от предыдущего теста:
// tests/setup.ts делает TRUNCATE всей public-схемы ПОСЛЕ КАЖДОГО it (см. выше),
// поэтому запись, созданная в одном тесте, не видна следующему. Сценарии и
// проверки — из брифа задачи 5, фикстуры приведены к этому харнессу.
describe("резервирование окна записи", () => {
  it("два параллельных прогона получают разные участки", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/eeee5555.mp4`,
        sha1: "eeee5555",
        durationSec: 60,
        originalName: "long.mov",
        ingestStatus: "completed",
      },
    })

    const [first, second] = await Promise.all([
      reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null }),
      reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null }),
    ])

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    // Один и тот же участок двум прогонам — это два одинаковых кадра в двух
    // роликах, ровно тот дубль, который запрещает PROJECT_CONTEXT §7.
    const intersect = Math.min(first!.endSec, second!.endSec) - Math.max(first!.startSec, second!.startSec)
    expect(intersect).toBeLessThanOrEqual(0)
    expect(await prisma.presenterRecordingUsage.count({ where: { recordingId: recording.id } })).toBe(2)
  })

  // Решение задачи, п.1: запись и оба взятых интервала заводим ВНУТРИ этого
  // теста двумя последовательными резервированиями — findFirst по "остатку от
  // предыдущего it" на этом харнессе ничего не найдёт (TRUNCATE после каждого).
  it("окно вчерашнего ролика не берётся, пока в записи есть нетронутое", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/ffff6666.mp4`,
        sha1: "ffff6666",
        durationSec: 60,
        originalName: "long.mov",
        ingestStatus: "completed",
      },
    })

    const firstTaken = await reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null })
    const secondTaken = await reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null })
    expect(firstTaken).not.toBeNull()
    expect(secondTaken).not.toBeNull()

    const taken = await prisma.presenterRecordingUsage.findMany({ where: { recordingId: recording.id } })
    expect(taken).toHaveLength(2)

    const next = await reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null })
    expect(next).not.toBeNull()

    for (const used of taken) {
      const intersect = Math.min(next!.endSec, used.endSec) - Math.max(next!.startSec, used.startSec)
      expect(intersect).toBeLessThanOrEqual(0)
    }
  })

  it("возвращает null, когда у персонажа нет ни одной завершённой записи", async () => {
    const other = await prisma.character.create({ data: { appId, name: "Без записей" } })

    expect(await reserveRecordingWindow({
      characterId: other.id, requiredSec: 5, fps: 30, videoId: null,
    })).toBeNull()
  })
})
