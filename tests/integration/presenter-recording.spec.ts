import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { prisma } from "~~/server/utils/prisma"
import { cutRecordingWindow, ffmpegIngestDependencies } from "~~/server/utils/presenter/ffmpeg-adapter"
import { ingestPresenterRecording } from "~~/server/utils/presenter/ingest-runner"
import { applyRecordingRetention } from "~~/server/utils/presenter/recording-retention"
import { guardRecordingWindowFrame } from "~~/server/utils/presenter/recording-window-frame-guard"
import { reserveRecordingWindow } from "~~/server/utils/presenter-recording-selector"
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageKeys } from "~~/server/utils/storage/keys"
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

  // Minor 3 из финального ревью: bytes/originalBytes были INTEGER (потолок
  // 2 147 483 647) — приём ограничен MAX_FILE_BYTES = 2 GiB
  // (source-recordings/index.post.ts), то есть originalBytes переполнял бы
  // INTEGER ровно на границе приёма, а нормализованный файл при 30-37 МБ/мин
  // переступает 2 ГБ уже на ~60 минутах записи. saveRecording падал бы на
  // create молча. Значение ниже больше старого потолка INTEGER — до миграции
  // BigInt этот create падал бы с ошибкой переполнения.
  it("принимает bytes/originalBytes больше потолка INTEGER (BigInt)", async () => {
    const overInt32 = 2_500_000_000

    const created = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-bigint-bytes",
        sha1: "bigintbytessha1",
        durationSec: 3600,
        bytes: overInt32,
        originalBytes: overInt32 + 100,
      },
    })

    expect(created.bytes).toBe(BigInt(overInt32))
    expect(created.originalBytes).toBe(BigInt(overInt32 + 100))

    // Чтение наружу (server/api/characters/[id]/recordings/index.get.ts,
    // суммарный объём): сумма BigInt-полей, а не number + bigint — последнее
    // кидает TypeError на рантайме, а не просто даёт неверное число.
    const rows = await prisma.presenterRecording.findMany({
      where: { characterId },
      select: { bytes: true },
    })
    const totalBytes = rows.reduce((sum, row) => sum + (row.bytes ?? 0n), 0n)
    expect(totalBytes).toBe(BigInt(overInt32))
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

  // Important 2 из финального ревью: эндпоинт заливки (source-recordings/index.post.ts)
  // на дедуп-ветке (та же запись залита второй раз) больше не режет клипы
  // инлайн собственным набором хешей — он делегирует ВСЮ повторную нарезку
  // сюда, передавая метаданные формы параметром. Без этого параметра оператор
  // молча терял бы tags/outfit/background/gesture/uploadedById на КАЖДОЙ
  // перенарезке — первичная заливка их проставляет, а голый reingestRecording
  // без options — нет.
  it("применяет метаданные формы к клипам повторной нарезки и не оставляет активным старый разрез", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-reingest-metadata",
        sha1: "metadatasha1",
        durationSec: 12,
        originalName: "metadata.mov",
      },
    })
    // Представляет клип от ПЕРВОЙ заливки (эндпоинт режет её инлайн из
    // оригинала — эта ветка не меняется этой правкой, не переигрываем её
    // здесь настоящим ffmpeg, как и соседние тесты этого describe).
    const staleClip = await prisma.presenterSourceClip.create({
      data: {
        characterId,
        recordingId: recording.id,
        fileUrl: "https://cdn/first-upload-cut.mp4",
        sha1: "first-upload-cut-not-reproduced",
        durationSec: 4,
        isActive: true,
      },
    })

    const { deps } = createFakeReingestDeps(silenceFixturePath)
    const result = await reingestRecording(recording.id, {
      tags: ["новый-жест"],
      outfit: "деловой костюм",
      background: "студия",
      gesture: "указывает рукой",
      uploadedById: 7,
    }, deps)

    expect(result.createdIds.length).toBeGreaterThan(0)
    // Старый разрез первой заливки не подтверждён новым прогоном — гашен, а
    // не остаётся активным рядом с новым (ровно тот дубль по
    // docs/PROJECT_CONTEXT.md §7, который допускал старый инлайн-код
    // эндпоинта на boundarySource === "silence" — известный сценарий реальной
    // записи ведущей).
    expect(result.deactivatedClips).toBe(1)
    const reloadedStale = await prisma.presenterSourceClip.findUnique({ where: { id: staleClip.id } })
    expect(reloadedStale?.isActive).toBe(false)

    const activeClips = await prisma.presenterSourceClip.findMany({
      where: { recordingId: recording.id, isActive: true },
      orderBy: { createdAt: "asc" },
    })
    expect(activeClips).toHaveLength(result.createdIds.length)
    for (const clip of activeClips) {
      expect(clip.tags).toEqual(["новый-жест"])
      expect(clip.outfit).toBe("деловой костюм")
      expect(clip.background).toBe("студия")
      expect(clip.gesture).toBe("указывает рукой")
      expect(clip.uploadedById).toBe(7)
    }

    // Ответ несёт то же по форме содержимое, что и первая заливка эндпоинта —
    // skipped снова полный список (не просто счётчик), sceneDetectionFailed и
    // durationSec заполнены, а не потеряны при делегировании.
    expect(Array.isArray(result.skipped)).toBe(true)
    expect(typeof result.sceneDetectionFailed).toBe("boolean")
    expect(result.durationSec).toBeGreaterThan(0)
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
      reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null, sceneIndex: null }),
      reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null, sceneIndex: null }),
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
  //
  // Minor 2 из ревью (раунд 1): исходное имя теста обещало "вчерашний"
  // интервал, но тело ничего не сдвигало во времени и проверяло то же самое
  // свойство, что и первый тест (просто последовательно, а не параллельно).
  // Переименовано честно под то, что тест реально делает; настоящий тест на
  // "вчерашний" (остывший) интервал — следующий.
  it("третье резервирование не пересекается ни с одним из двух ранее занятых интервалов", async () => {
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

    const firstTaken = await reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null, sceneIndex: null })
    const secondTaken = await reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null, sceneIndex: null })
    expect(firstTaken).not.toBeNull()
    expect(secondTaken).not.toBeNull()

    const taken = await prisma.presenterRecordingUsage.findMany({ where: { recordingId: recording.id } })
    expect(taken).toHaveLength(2)

    const next = await reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null, sceneIndex: null })
    expect(next).not.toBeNull()

    for (const used of taken) {
      const intersect = Math.min(next!.endSec, used.endSec) - Math.max(next!.startSec, used.startSec)
      expect(intersect).toBeLessThanOrEqual(0)
    }
  })

  // Регрессия на Important из ревью (раунд 1): usages фильтровались по
  // cooldown ДО передачи в planRecordingWindow, поэтому usage старше суток
  // выпадал из выборки целиком, а не просто переставал считаться "горячим".
  // planRecordingWindow не мог отличить остывший интервал от нетронутого —
  // окно поверх вчера уже отснятого куска возвращалось бы с reused=false,
  // то есть тот же кусок дважды (дубль по PROJECT_CONTEXT §7, отложенный на
  // сутки). Запись длиной РОВНО в два кадра (10с при requiredSec=5с) делает
  // эффект детерминированным: без фикса второе резервирование обязано
  // вернуть тот же участок [0, 5) заново, с этим же учётом это была первая
  // (и единственная) позиция, на которой planRecordingWindow останавливает
  // перебор при пустом usedIntervals.
  it("остывший (старше суток) интервал не выдаётся заново как нетронутый", async () => {
    await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/aaaa7777.mp4`,
        sha1: "aaaa7777",
        durationSec: 10,
        originalName: "long.mov",
        ingestStatus: "completed",
      },
    })

    const now = Date.now()
    const first = await reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null, sceneIndex: null, now })
    expect(first).not.toBeNull()

    // За пределами суточного RECORDING_WINDOW_COOLDOWN_MS — интервал уже остыл.
    const later = now + 25 * 3600_000
    const second = await reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null, sceneIndex: null, now: later })
    expect(second).not.toBeNull()

    const intersect = Math.min(second!.endSec, first!.endSec) - Math.max(second!.startSec, first!.startSec)
    if (intersect > 0) {
      // Пересечение с остывшим участком допустимо, только если он честно
      // помечен как повторно использованный — не как нетронутый.
      expect(second!.reused).toBe(true)
    }
    else {
      // Запись из двух кадров: непересекающийся результат означает, что
      // выбран второй, ранее нетронутый кусок — именно то, что требует имя
      // предыдущего теста этой группы ("вчерашнее" не берётся, пока есть
      // нетронутое).
      expect(second!.reused).toBe(false)
    }
  })

  // Minor 4 из ревью (раунд 1): фильтр по ingestStatus: "completed" был
  // сформулирован жёстко в комментарии кода, но не проверен тестом — третий
  // тест этой группы заводит персонажа вообще БЕЗ записей, а не персонажа с
  // единственной незавершённой записью.
  it("возвращает null, когда единственная запись персонажа ещё не завершена (running)", async () => {
    await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/bbbb8888.mp4`,
        sha1: "bbbb8888",
        durationSec: 60,
        originalName: "long.mov",
        ingestStatus: "running",
      },
    })

    expect(await reserveRecordingWindow({
      characterId, requiredSec: 5, fps: 30, videoId: null, sceneIndex: null,
    })).toBeNull()
  })

  it("возвращает null, когда у персонажа нет ни одной завершённой записи", async () => {
    const other = await prisma.character.create({ data: { appId, name: "Без записей" } })

    expect(await reserveRecordingWindow({
      characterId: other.id, requiredSec: 5, fps: 30, videoId: null, sceneIndex: null,
    })).toBeNull()
  })

  // Important (второй раунд финального ревью): `findMany` этого прохода не
  // должен иметь `take`. Тот же класс дефекта, что чинила находка 1 в
  // автоочистке, но здесь выборка НЕ самоочищается — ingestStatus:
  // "completed" не меняется никогда, и лимит с orderBy: createdAt asc
  // навсегда прятал бы всё, что моложе отрезанной границы, у персонажа со
  // ста с лишним завершёнными записями.
  //
  // Сто с лишним старых записей здесь — "горячие" (свежее использование
  // покрывает их целиком, окно неизбежно получит overlapSec > 0, reused:
  // true), а одна САМАЯ СВЕЖАЯ по createdAt — нетронутая (overlapSec === 0).
  // С лимитом свежая запись не попала бы в выборку вовсе (orderBy: createdAt
  // asc отдаёт САМЫЕ СТАРЫЕ первыми), и резервирование тихо вернуло бы
  // горячий повтор вместо свободного нетронутого материала — ровно дубль по
  // docs/PROJECT_CONTEXT.md §7, без единого отказа или предупреждения.
  it("свежая незанятая запись не прячется за лимитом выборки среди множества старых горячих записей", async () => {
    const oldCount = 110
    const durationSec = 20
    const requiredSec = 5
    const oldCreatedAt = new Date(Date.now() - 10 * 24 * 3600 * 1000)
    const oldIds = Array.from({ length: oldCount }, () => randomUUID())

    await prisma.presenterRecording.createMany({
      data: oldIds.map((id, i) => ({
        id,
        characterId,
        storageKey: `tmp-selector-old-${i}`,
        sha1: `selectorold${String(i).padStart(6, "0")}`,
        durationSec,
        createdAt: oldCreatedAt,
        ingestStatus: "completed",
      })),
    })
    // Использование на всю длительность записи — ЛЮБОЕ окно внутри неё
    // получит полный overlapSec, детерминированно хуже свободного материала.
    // usedAt "только что" — заведомо внутри RECORDING_WINDOW_COOLDOWN_MS
    // (сутки), горячий интервал.
    await prisma.presenterRecordingUsage.createMany({
      data: oldIds.map(id => ({
        recordingId: id,
        startSec: 0,
        endSec: durationSec,
        usedAt: new Date(),
      })),
    })

    const fresh = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-selector-fresh",
        sha1: "selectorfresh",
        durationSec,
        // Новее всех "старых" — при отрезающем лимите и orderBy: createdAt
        // asc эта запись оказалась бы ЗА пределами выборки.
        createdAt: new Date(),
        ingestStatus: "completed",
      },
    })

    const result = await reserveRecordingWindow({ characterId, requiredSec, fps: 30, videoId: null, sceneIndex: null })

    expect(result).not.toBeNull()
    expect(result?.recordingId).toBe(fresh.id)
    expect(result?.reused).toBe(false)
    expect(result?.overlapSec).toBe(0)
  }, 30_000)
})

// Задача 6b: идемпотентность резервирования по (videoId, sceneIndex) и
// перцептивный хэш окна. Фикстуры свои — та же причина, что и у группы выше
// (TRUNCATE после каждого it).
describe("идемпотентность резервирования по (videoId, sceneIndex)", () => {
  it("повторное резервирование той же сцены того же ролика возвращает то же окно и не создаёт вторую строку", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/idem0001.mp4`,
        sha1: "idem0001",
        durationSec: 60,
        originalName: "long.mov",
        ingestStatus: "completed",
      },
    })
    const scenario = await prisma.scenario.create({ data: { status: "draft" } })
    const video = await prisma.video.create({ data: { scenarioId: scenario.id } })

    const first = await reserveRecordingWindow({
      characterId, requiredSec: 5, fps: 30, videoId: video.id, sceneIndex: 0,
    })
    expect(first).not.toBeNull()
    expect(first!.idempotency).toBeNull()

    const second = await reserveRecordingWindow({
      characterId, requiredSec: 5, fps: 30, videoId: video.id, sceneIndex: 0,
    })
    expect(second).not.toBeNull()
    expect(second).toEqual({ ...first, idempotency: "existing" })

    expect(await prisma.presenterRecordingUsage.count({
      where: { recordingId: recording.id, videoId: video.id, sceneIndex: 0 },
    })).toBe(1)
  })

  it("другая сцена того же ролика получает своё окно, не конфликтует с первой", async () => {
    await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/idem0002.mp4`,
        sha1: "idem0002",
        durationSec: 60,
        originalName: "long.mov",
        ingestStatus: "completed",
      },
    })
    const scenario = await prisma.scenario.create({ data: { status: "draft" } })
    const video = await prisma.video.create({ data: { scenarioId: scenario.id } })

    const sceneA = await reserveRecordingWindow({
      characterId, requiredSec: 5, fps: 30, videoId: video.id, sceneIndex: 0,
    })
    const sceneB = await reserveRecordingWindow({
      characterId, requiredSec: 5, fps: 30, videoId: video.id, sceneIndex: 1,
    })
    expect(sceneA).not.toBeNull()
    expect(sceneB).not.toBeNull()
    expect(sceneB!.usageId).not.toBe(sceneA!.usageId)

    const intersect = Math.min(sceneA!.endSec, sceneB!.endSec) - Math.max(sceneA!.startSec, sceneB!.startSec)
    expect(intersect).toBeLessThanOrEqual(0)
  })

  // Решение задачи, п.2: трек между прогонами мог стать длиннее — сохранённое
  // окно перестаёт покрывать requiredSec, старое использование заменяется, а
  // не остаётся висеть рядом со вторым.
  it("при выросшем requiredSec старое использование заменяется новым, а не дублируется", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/idem0003.mp4`,
        sha1: "idem0003",
        durationSec: 60,
        originalName: "long.mov",
        ingestStatus: "completed",
      },
    })
    const scenario = await prisma.scenario.create({ data: { status: "draft" } })
    const video = await prisma.video.create({ data: { scenarioId: scenario.id } })

    const first = await reserveRecordingWindow({
      characterId, requiredSec: 5, fps: 30, videoId: video.id, sceneIndex: 0,
    })
    expect(first).not.toBeNull()

    const second = await reserveRecordingWindow({
      characterId, requiredSec: 20, fps: 30, videoId: video.id, sceneIndex: 0,
    })
    expect(second).not.toBeNull()
    expect(second!.idempotency).toBe("replaced")
    expect(second!.usageId).not.toBe(first!.usageId)
    expect(second!.durationSec).toBeGreaterThanOrEqual(20)

    // Старая строка удалена — ровно одна на пару (videoId, sceneIndex), не две.
    expect(await prisma.presenterRecordingUsage.count({
      where: { recordingId: recording.id, videoId: video.id, sceneIndex: 0 },
    })).toBe(1)
    const remaining = await prisma.presenterRecordingUsage.findFirst({
      where: { recordingId: recording.id, videoId: video.id, sceneIndex: 0 },
    })
    expect(remaining?.id).toBe(second!.usageId)
  })

  // videoId: null (служебный прогон) идемпотентности не получает — пары для
  // ключа нет, работает как раньше: тот же sceneIndex не мешает следующему
  // резервированию занять НОВОЕ окно.
  it("videoId: null не получает идемпотентность даже при одинаковом sceneIndex", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/idem0004.mp4`,
        sha1: "idem0004",
        durationSec: 60,
        originalName: "long.mov",
        ingestStatus: "completed",
      },
    })

    const first = await reserveRecordingWindow({
      characterId, requiredSec: 5, fps: 30, videoId: null, sceneIndex: 0,
    })
    const second = await reserveRecordingWindow({
      characterId, requiredSec: 5, fps: 30, videoId: null, sceneIndex: 0,
    })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(second!.usageId).not.toBe(first!.usageId)
    expect(second!.idempotency).toBeNull()

    expect(await prisma.presenterRecordingUsage.count({ where: { recordingId: recording.id } })).toBe(2)
  })

  // Гонка: два параллельных прогона ТОЙ ЖЕ сцены не должны создать две строки
  // — уникальность (videoId, sceneIndex) в схеме это гарантирует на уровне БД,
  // а код обязан отработать P2002 осмысленно (отдать строку победителя), а не
  // упасть сырой ошибкой Prisma.
  it("параллельные прогоны одной и той же сцены не создают вторую строку", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/idem0005.mp4`,
        sha1: "idem0005",
        durationSec: 60,
        originalName: "long.mov",
        ingestStatus: "completed",
      },
    })
    const scenario = await prisma.scenario.create({ data: { status: "draft" } })
    const video = await prisma.video.create({ data: { scenarioId: scenario.id } })

    const [first, second] = await Promise.all([
      reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: video.id, sceneIndex: 0 }),
      reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: video.id, sceneIndex: 0 }),
    ])

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first!.usageId).toBe(second!.usageId)
    expect(first!.startSec).toBe(second!.startSec)

    expect(await prisma.presenterRecordingUsage.count({
      where: { recordingId: recording.id, videoId: video.id, sceneIndex: 0 },
    })).toBe(1)
  })

  it("frameHash сохраняется на использовании и читается обратно", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/idem0006.mp4`,
        sha1: "idem0006",
        durationSec: 60,
        originalName: "long.mov",
        ingestStatus: "completed",
      },
    })
    const scenario = await prisma.scenario.create({ data: { status: "draft" } })
    const video = await prisma.video.create({ data: { scenarioId: scenario.id } })

    const reserved = await reserveRecordingWindow({
      characterId, requiredSec: 5, fps: 30, videoId: video.id, sceneIndex: 0,
    })
    expect(reserved).not.toBeNull()
    expect(reserved!.recordingId).toBe(recording.id)

    await prisma.presenterRecordingUsage.update({
      where: { id: reserved!.usageId },
      data: { frameHash: "0000000000000000" },
    })

    const reloaded = await prisma.presenterRecordingUsage.findUnique({ where: { id: reserved!.usageId } })
    expect(reloaded?.frameHash).toBe("0000000000000000")
  })
})

// Фикс-раунд 1 (Important 2 из ревью): safety-net в guardRecordingWindowFrame
// раньше срабатывал ровно в одном из пяти путей отказа (create() поверх уже
// существующей строки второй попытки бился о уникальность и тихо глотался
// пустым catch), а в ветке "resérvировать было не из чего" (null без throw)
// восстановления не было вовсе. До этой правки тело guardRecordingWindowFrame
// не исполнялось НИ ОДНИМ тестом — вся проверка шла через мок в
// lip-sync-recording-window.spec.ts. Эти два теста гоняют настоящую функцию
// (настоящий ffmpeg, настоящая БД) и доказывают, что после отказа на КАЖДОМ из
// двух разобранных путей защита интервала ПЕРВОГО окна восстанавливается, а не
// теряется и не дублируется.
describe("guardRecordingWindowFrame: восстановление после отказа (задача 6b, фикс-раунд 1)", () => {
  let fixtureDir: string
  let flatFixturePath: string

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "presenter-frame-guard-fixture-"))
    flatFixturePath = join(fixtureDir, "flat.mp4")
    await renderFlatFixture(flatFixturePath)
  }, 30_000)

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true }).catch(() => {})
  })

  /**
   * Общая подготовка обоих тестов: одна запись на 12с, первое окно 4с в её
   * начале [0,4), "недавний" хэш персонажа посажен на [8,12) той же записи —
   * тот же самый плоский чёрный кадр даёт детерминированный dHash
   * "0000000000000000" (см. комментарий у renderFlatFixture выше), поэтому
   * первый кадр вырезанного окна гарантированно "похож" на затравку, и guard
   * уходит в ветку перерезервирования. Свободное место на этой записи после
   * затравки — ровно [4,8), 4 секунды: перерезервирование детерминированно
   * попадает туда же, на ТУ ЖЕ запись (recordingId не меняется), что убирает
   * из уравнения редкий путь ensureRecordingDownloaded и оставляет чистый
   * тестовый прогон на нужный failure-path.
   */
  async function setupWithSimilarSeed(): Promise<{
    recording: Awaited<ReturnType<typeof prisma.presenterRecording.create>>
    video: Awaited<ReturnType<typeof prisma.video.create>>
    first: NonNullable<Awaited<ReturnType<typeof reserveRecordingWindow>>>
    windowPath: string
  }> {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-frame-guard-recording",
        sha1: "frameguardrecording",
        durationSec: 12,
        originalName: "flat.mov",
        ingestStatus: "completed",
      },
    })
    const scenario = await prisma.scenario.create({ data: { status: "draft" } })
    const video = await prisma.video.create({ data: { scenarioId: scenario.id } })

    const first = await reserveRecordingWindow({
      characterId, requiredSec: 4, fps: 30, videoId: video.id, sceneIndex: 0,
    })
    expect(first).not.toBeNull()

    await prisma.presenterRecordingUsage.create({
      data: { recordingId: recording.id, startSec: 8, endSec: 12, frameHash: "0000000000000000" },
    })

    const windowPath = join(fixtureDir, `window-${video.id}.mp4`)
    await cutRecordingWindow({
      recordingPath: flatFixturePath,
      startSec: first!.startSec,
      durationSec: first!.durationSec,
      outputPath: windowPath,
    })

    return { recording, video, first: first!, windowPath }
  }

  it("отказ на нарезке ПОСЛЕ успешного перерезервирования восстанавливает защиту первого окна (update, а не потерянный create)", async () => {
    const { recording, video, first, windowPath } = await setupWithSimilarSeed()

    await expect(guardRecordingWindowFrame({
      characterId,
      videoId: video.id,
      sceneIndex: 0,
      requiredSec: 4,
      fps: 30,
      window: first,
      windowPath,
      retryWindowPath: join(fixtureDir, `window-${video.id}-retry.mp4`),
      // Нарезка второй попытки обязана упасть: несуществующий исходник.
      // ensureRecordingDownloaded не понадобится — retried.recordingId
      // совпадёт с recording.id (свободное место только там же, см. доктрину
      // setupWithSimilarSeed).
      recordingPath: join(fixtureDir, "does-not-exist.mp4"),
      ensureRecordingDownloaded: async () => {
        throw new Error("не должен вызываться на этом сценарии — та же запись")
      },
    })).rejects.toThrow()

    const rows = await prisma.presenterRecordingUsage.findMany({
      where: { videoId: video.id, sceneIndex: 0 },
    })
    // Ровно одна строка — не ноль (интервал не потерян) и не две (create поверх
    // уже существующей строки второй попытки не сработал бы вовсе, P2002).
    expect(rows).toHaveLength(1)
    expect(rows[0]!.recordingId).toBe(recording.id)
    expect(rows[0]!.startSec).toBeCloseTo(first.startSec, 3)
    expect(rows[0]!.endSec).toBeCloseTo(first.endSec, 3)
    // Хэш ПЕРВОГО (реально используемого дальше) окна тоже восстановлен —
    // иначе следующая сцена сравнивала бы себя не с тем, что видит зритель.
    expect(rows[0]!.frameHash).toBe("0000000000000000")
  }, 30_000)

  it("резервировать было не из чего (запись стала недоступна) — защита первого окна восстанавливается без throw", async () => {
    const { recording, video, first, windowPath } = await setupWithSimilarSeed()

    // Запись "стала недоступна между первым и вторым резервированием" — тот
    // самый сценарий из комментария кода: reserveRecordingWindow вернёт null
    // (не бросит), потому что единственная запись персонажа больше не
    // ingestStatus: "completed".
    await prisma.presenterRecording.update({
      where: { id: recording.id },
      data: { ingestStatus: "failed" },
    })

    const result = await guardRecordingWindowFrame({
      characterId,
      videoId: video.id,
      sceneIndex: 0,
      requiredSec: 4,
      fps: 30,
      window: first,
      windowPath,
      retryWindowPath: join(fixtureDir, `window-${video.id}-retry2.mp4`),
      recordingPath: flatFixturePath,
      ensureRecordingDownloaded: async () => {
        throw new Error("не должен понадобиться — reserveRecordingWindow вернёт null раньше")
      },
    })

    expect(result.reReserved).toBe(false)
    expect(result.stillSimilar).toBe(true)
    expect(result.windowPath).toBe(windowPath)

    const rows = await prisma.presenterRecordingUsage.findMany({
      where: { videoId: video.id, sceneIndex: 0 },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.recordingId).toBe(recording.id)
    expect(rows[0]!.startSec).toBeCloseTo(first.startSec, 3)
    expect(rows[0]!.endSec).toBeCloseTo(first.endSec, 3)
    expect(rows[0]!.frameHash).toBe("0000000000000000")
  }, 30_000)
})

// Задача 7: жизненный цикл записей — applyRecordingRetention реально трогает
// БД и хранилище (в тестовом окружении STORAGE_DRIVER не задан, поэтому
// действует LocalDriver — см. server/utils/storage/index.ts), в отличие от
// чистого planRecordingRetention (tests/unit/presenter/recording-retention.spec.ts,
// который ни БД, ни хранилища не знает вовсе). Фикстуры свои в каждом it —
// TRUNCATE после каждого it, как и у остальных describe этого файла.
describe("применение правила хранения (applyRecordingRetention)", () => {
  it("очистка не трогает keep и записи с живыми клипами", async () => {
    const keep = await prisma.presenterRecording.create({
      data: {
        characterId, storageKey: "k", sha1: "keep0001", durationSec: 10,
        retention: "keep", createdAt: new Date(Date.now() - 400 * 24 * 3600 * 1000),
      },
    })
    const withClips = await prisma.presenterRecording.create({
      data: {
        characterId, storageKey: "w", sha1: "with0001", durationSec: 10,
        createdAt: new Date(Date.now() - 400 * 24 * 3600 * 1000),
      },
    })
    await prisma.presenterSourceClip.create({
      data: { characterId, recordingId: withClips.id, fileUrl: "u", sha1: "clipw001", durationSec: 3 },
    })

    await applyRecordingRetention()

    expect(await prisma.presenterRecording.findUnique({ where: { id: keep.id } })).not.toBeNull()
    expect(await prisma.presenterRecording.findUnique({ where: { id: withClips.id } })).not.toBeNull()
  })

  // Решение задачи, п.1: activeClipCount обязан считать только isActive: true.
  // Повторная нарезка (задача 6) гасит старый разрез через isActive: false, не
  // удаляя строки клипов — запись с одними отключёнными клипами появляется
  // штатно. Если бы _count считал ВСЕ клипы без фильтра, такая запись никогда
  // бы не подпала под удаление: формально "непустой" счётчик держал бы её вечно
  // ровно там, где автоочистка и должна была сработать.
  //
  // Мелочь 3 из ревью (фикс-раунд 1): объект реально заливается в хранилище
  // ПЕРЕД проходом и проверяется на исчезновение ПОСЛЕ — раньше storageKey был
  // фиктивным, delete() уходил в no-op по ENOENT, и ошибка вида "передали не
  // тот ключ" осталась бы незамеченной ровно там, где писалось «сначала
  // объект, потом строка».
  it("удаляет auto-запись без активных клипов, даже если у неё остались отключённые клипы от старого разреза", async () => {
    const storageKey = StorageKeys.presenterRecording(appId, characterId, "onlyinactive")
    await getStorageDriver().uploadBuffer(storageKey, Buffer.from("normalized-recording-bytes"))

    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey,
        sha1: "onlyinactive",
        durationSec: 10,
        createdAt: new Date(Date.now() - 200 * 24 * 3600 * 1000),
      },
    })
    const staleClip = await prisma.presenterSourceClip.create({
      data: {
        characterId, recordingId: recording.id, fileUrl: "u", sha1: "clipinactive",
        durationSec: 3, isActive: false,
      },
    })

    const decisions = await applyRecordingRetention()

    const decision = decisions.find(d => d.recordingId === recording.id)
    expect(decision?.action).toBe("delete")
    // Important из ревью: applied — то, что реально произошло, а не план.
    expect(decision?.applied).toBe(true)
    expect(await prisma.presenterRecording.findUnique({ where: { id: recording.id } })).toBeNull()
    // Объект реально удалён из хранилища, а не просто "должен был".
    expect(await getStorageDriver().exists(storageKey)).toBe(false)
    // Требование "ОСТОРОЖНО" из задачи: удаление записи не должно утащить клип
    // каскадом — клип выживает, теряя только ссылку на родителя
    // (onDelete: SetNull в схеме уже есть, здесь проверяем это на реальном
    // проходе applyRecordingRetention, а не только прямым prisma.delete).
    const survivedClip = await prisma.presenterSourceClip.findUnique({ where: { id: staleClip.id } })
    expect(survivedClip).not.toBeNull()
    expect(survivedClip?.recordingId).toBeNull()
  })

  it("переводит старую запись в холодный класс, отмечая cooledAt, а не удаляя строку", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp-cool",
        sha1: "coolme01",
        durationSec: 10,
        createdAt: new Date(Date.now() - 40 * 24 * 3600 * 1000),
      },
    })

    const decisions = await applyRecordingRetention()

    const decision = decisions.find(d => d.recordingId === recording.id)
    expect(decision?.action).toBe("cool")
    expect(decision?.applied).toBe(true)
    const reloaded = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    expect(reloaded).not.toBeNull()
    expect(reloaded?.cooledAt).toBeInstanceOf(Date)
  })

  // Critical из ревью (фикс-раунд 1): audio-first берёт окно ИЗ САМОЙ ЗАПИСИ
  // (server/utils/presenter-recording-selector.ts, reserveRecordingWindow),
  // не спрашивая PresenterSourceClip вовсе. Запись без единого активного
  // клипа может быть живой и востребованной каждую неделю — до фикса такую
  // запись правило сносило бы вместе со всем журналом PresenterRecordingUsage
  // (каскад), а сцена на следующей неделе падала бы с "File not found".
  it("не удаляет запись без активных клипов, если её недавно использовали напрямую (audio-first)", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: StorageKeys.presenterRecording(appId, characterId, "recentlyusedbyaudio"),
        sha1: "recentlyused",
        durationSec: 60,
        createdAt: new Date(Date.now() - 200 * 24 * 3600 * 1000),
        ingestStatus: "completed",
      },
    })
    await prisma.presenterRecordingUsage.create({
      data: {
        recordingId: recording.id,
        startSec: 0,
        endSec: 5,
        usedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
      },
    })

    const decisions = await applyRecordingRetention()

    const decision = decisions.find(d => d.recordingId === recording.id)
    expect(decision?.action).not.toBe("delete")
    expect(await prisma.presenterRecording.findUnique({ where: { id: recording.id } })).not.toBeNull()
    // Журнал использований тоже цел — не унесён каскадом несостоявшегося удаления.
    expect(await prisma.presenterRecordingUsage.count({ where: { recordingId: recording.id } })).toBe(1)
  })

  // Мелочь 2 из ревью: гонка с реингестом. ingestStatus: "running" — нарезка
  // этой же записи идёт прямо сейчас (server/utils/presenter/recording-store.ts,
  // reingestRecording держит статус атомарным UPDATE). Проход не должен
  // снести файл из-под работающего процесса, даже если по возрасту и
  // активным клипам запись выглядела бы кандидатом на удаление.
  it("не трогает запись, у которой нарезка идёт прямо сейчас (ingestStatus: running)", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: StorageKeys.presenterRecording(appId, characterId, "runningnow"),
        sha1: "runningnow",
        durationSec: 60,
        createdAt: new Date(Date.now() - 200 * 24 * 3600 * 1000),
        ingestStatus: "running",
        // Minor 4 из финального ревью: "running" защищает только моложе
        // STALE_RUNNING_THRESHOLD_MS — без отметки о начале строка считалась
        // бы зависшей, а не работающей прямо сейчас (см. тест ниже).
        ingestStartedAt: new Date(),
      },
    })

    const decisions = await applyRecordingRetention()

    expect(decisions.find(d => d.recordingId === recording.id)?.action).toBe("keep")
    expect(await prisma.presenterRecording.findUnique({ where: { id: recording.id } })).not.toBeNull()
  })

  // Minor 4 из финального ревью: строка, застрявшая в running после убитого
  // процесса (kill -9, деплой, OOM), раньше была защищена от удаления и
  // охлаждения НАВСЕГДА — "running" сам по себе принимался за живой процесс
  // без учёта возраста отметки.
  it("удаляет auto-запись без клипов, у которой running завис дольше порога зависания", async () => {
    const storageKey = StorageKeys.presenterRecording(appId, characterId, "stalerunning")
    await getStorageDriver().uploadBuffer(storageKey, Buffer.from("normalized-recording-bytes"))

    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey,
        sha1: "stalerunning",
        durationSec: 60,
        createdAt: new Date(Date.now() - 200 * 24 * 3600 * 1000),
        ingestStatus: "running",
        // Больше двух часов назад (STALE_RUNNING_THRESHOLD_MS в recording-store.ts) —
        // процесс, который это ставил, давно мёртв.
        ingestStartedAt: new Date(Date.now() - 3 * 3600 * 1000),
      },
    })

    const decisions = await applyRecordingRetention()

    expect(decisions.find(d => d.recordingId === recording.id)?.action).toBe("delete")
    expect(await prisma.presenterRecording.findUnique({ where: { id: recording.id } })).toBeNull()
  })

  // Требование "ОСТОРОЖНО" из задачи: проход обязан быть безопасен при
  // частичном отказе. storageKey без префикса zavodcamp/ бьётся о PrefixGuard
  // (server/utils/storage/prefix-guard.ts) — настоящая ошибка хранилища, а не
  // подделанный мок. Запись с такой ошибкой не удаляется (строка и объект
  // остаются целы до следующего прохода), но соседняя запись с корректным
  // ключом всё равно обрабатывается — проход не падает целиком из-за одной
  // сломанной записи.
  //
  // Мелочь 4 из ревью: без ORDER BY порядок строк из findMany не гарантирован,
  // и тест ничего не доказывал бы про изоляцию, если бы Postgres вернул
  // здоровую запись первой. applyRecordingRetention сам сортирует по
  // createdAt asc (см. server/utils/presenter/recording-retention.ts) — здесь
  // broken специально СТАРШЕ healthy, чтобы гарантированно обрабатываться
  // первым в цикле: если бы отказ на broken прерывал цикл целиком (регрессия
  // на изоляцию), healthy, идущий следующим, тоже не был бы удалён.
  it("отказ на одной записи (ошибка хранилища) не мешает удалить остальные кандидаты этого же прохода", async () => {
    const broken = await prisma.presenterRecording.create({
      data: {
        characterId,
        // Без префикса zavodcamp/ — storage.delete() бросит PREFIX_GUARD.
        storageKey: "no-zavodcamp-prefix/broken.mp4",
        sha1: "brokenkey",
        durationSec: 10,
        createdAt: new Date(Date.now() - 202 * 24 * 3600 * 1000),
      },
    })
    const healthyKey = StorageKeys.presenterRecording(appId, characterId, "healthykey")
    await getStorageDriver().uploadBuffer(healthyKey, Buffer.from("normalized-recording-bytes"))
    const healthy = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: healthyKey,
        sha1: "healthykey",
        durationSec: 10,
        createdAt: new Date(Date.now() - 201 * 24 * 3600 * 1000),
      },
    })

    const decisions = await applyRecordingRetention()

    const brokenDecision = decisions.find(d => d.recordingId === broken.id)
    const healthyDecision = decisions.find(d => d.recordingId === healthy.id)
    expect(brokenDecision?.action).toBe("delete")
    expect(healthyDecision?.action).toBe("delete")
    // Important из ревью: applied различает план и факт для каждой записи
    // прохода независимо — у сломанной операция не выполнилась, у соседней да.
    expect(brokenDecision?.applied).toBe(false)
    expect(healthyDecision?.applied).toBe(true)

    // Отказавшая запись осталась целой — ошибка хранилища не даёт удалить строку.
    expect(await prisma.presenterRecording.findUnique({ where: { id: broken.id } })).not.toBeNull()
    // Соседняя запись обработана как обычно, несмотря на отказ первой, и её
    // объект реально исчез из хранилища (Мелочь 3).
    expect(await prisma.presenterRecording.findUnique({ where: { id: healthy.id } })).toBeNull()
    expect(await getStorageDriver().exists(healthyKey)).toBe(false)
  })

  // Important из финального ревью: раньше `where` брал ЛЮБУЮ auto-строку.
  // Запись, которую правило признаёт живой (activeClipCount > 0 — то есть
  // любая нормально нарезанная и УЖЕ ОХЛАЖДЁННАЯ запись), никогда больше не
  // меняет состояние — но отсортированная по возрасту, она навсегда занимает
  // голову очереди. При ~300 единиц материала в месяц набирается
  // RETENTION_BATCH_LIMIT (200) таких строк примерно за три недели, и дальше
  // проход каждый раз забирает один и тот же вечно-живой пакет, до более
  // новых кандидатов не доходя уже никогда.
  //
  // Число вечно-живых здесь заметно больше лимита пакета (200) — иначе тест
  // ничего не доказывал бы: при меньшем числе кандидат из хвоста поместился
  // бы в выборку и по старому `where` тоже.
  it("вечно-живые (охлаждённые, с активными клипами) записи не вытесняют более молодого кандидата из лимита пакета", async () => {
    const evergreenCount = 210
    const evergreenCreatedAt = new Date(Date.now() - 250 * 24 * 3600 * 1000)
    const evergreenCooledAt = new Date(Date.now() - 40 * 24 * 3600 * 1000)
    const evergreenIds = Array.from({ length: evergreenCount }, () => randomUUID())

    await prisma.presenterRecording.createMany({
      data: evergreenIds.map((id, i) => ({
        id,
        characterId,
        storageKey: `tmp-evergreen-${i}`,
        sha1: `evergreen${String(i).padStart(6, "0")}`,
        durationSec: 10,
        createdAt: evergreenCreatedAt,
        // Уже охлаждена прошлым проходом — второй раз охлаждать нечего, а
        // активный клип держит её от удаления. По старому `where` она и
        // дальше возвращалась бы КАЖДЫЙ проход, забивая лимит пакета собой.
        cooledAt: evergreenCooledAt,
      })),
    })
    await prisma.presenterSourceClip.createMany({
      data: evergreenIds.map((id, i) => ({
        characterId,
        recordingId: id,
        fileUrl: "u",
        sha1: `evergreenclip${String(i).padStart(6, "0")}`,
        durationSec: 3,
        isActive: true,
      })),
    })

    const deletableStorageKey = StorageKeys.presenterRecording(appId, characterId, "younger-deletable")
    await getStorageDriver().uploadBuffer(deletableStorageKey, Buffer.from("normalized-recording-bytes"))
    const deletable = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: deletableStorageKey,
        sha1: "younger-deletable",
        durationSec: 10,
        // Моложе вечно-живых (250 дней) — по старому `where` (orderBy:
        // createdAt asc, take: 200, без учёта cooledAt/activeClipCount) все
        // 210 вечно-живых строк, будучи старше, вытеснили бы его из выборки
        // целиком. Но всё ещё старше срока удаления (180 дней) — сам по себе
        // законный кандидат на delete.
        createdAt: new Date(Date.now() - 200 * 24 * 3600 * 1000),
      },
    })

    const decisions = await applyRecordingRetention()

    const decision = decisions.find(d => d.recordingId === deletable.id)
    expect(decision?.action).toBe("delete")
    expect(decision?.applied).toBe(true)
    expect(await prisma.presenterRecording.findUnique({ where: { id: deletable.id } })).toBeNull()
  }, 30_000)
})
