/**
 * Заглушки mock:// на холодном кеше.
 *
 * Две зафиксированные здесь вещи.
 *
 * 1. Кеш заглушек лежал в `<kind>.bin`, а ffmpeg по расширению `.bin` формат
 *    контейнера выбрать не может: «Unable to choose an output format», выход
 *    `Invalid argument`. На машине с прогретым кешем это незаметно — файл уже
 *    есть, ffmpeg не зовётся. На чистой машине падает первый же вызов, и вместе
 *    с ним весь API-контур генерации кадров: `generate-reference` отдаёт 500.
 *    Поэтому проверяем именно холодный старт: кеш-каталог свой на каждый прогон.
 *
 * 2. Вид заглушки выбирается по СПОСОБНОСТИ, а не по форме ссылки одного
 *    провайдера. Раньше вид читался из первого сегмента, и ссылка Replicate
 *    (`mock://replicate/{способность}/{id}.{ext}`) попадала в ветку
 *    «неизвестно»: вместо клипа получался JSON под именем `.mp4`, который
 *    ffmpeg не склеит. Прежняя редакция этого файла закрепляла такое поведение
 *    как ожидаемое — из-за него весь Replicate-контур (lip-sync прежде всего)
 *    в тестах не исполнялся ни разу.
 *
 * Длительность видео-заглушки — часть контракта: lip-sync заказывает клип
 * длиной исходника, и заглушка фиксированной длины превратила бы проверку
 * «клип получился той длины, что заказали» в проверку константы.
 */

import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  generateMockPlaceholder,
  parseMockPlaceholderUrl,
} from "../../../server/utils/mock/fal-mock"

let sandbox: string
let previousBase: string | undefined

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "fal-mock-"))
  previousBase = process.env.UPLOADS_STORAGE_PATH
  process.env.UPLOADS_STORAGE_PATH = sandbox
})

afterEach(async () => {
  if (previousBase === undefined) delete process.env.UPLOADS_STORAGE_PATH
  else process.env.UPLOADS_STORAGE_PATH = previousBase
  await rm(sandbox, { recursive: true, force: true }).catch(() => {})
})

/**
 * Длительность файла настоящим ffprobe.
 *
 * Меряем сторонним инструментом, а не тем же ffmpeg-вызовом, которым файл
 * собран: иначе проверка длины доказывала бы только то, что аргументы не
 * потерялись по дороге.
 */
function probeDurationSec(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ])
    let out = ""
    proc.stdout.on("data", chunk => { out += String(chunk) })
    proc.once("error", reject)
    proc.once("exit", (code) => {
      const parsed = Number.parseFloat(out.trim())
      if (code === 0 && Number.isFinite(parsed)) resolve(parsed)
      else reject(new Error(`ffprobe ${path} → код ${code}, вывод "${out.trim()}"`))
    })
  })
}

/** Сигнатура ISO BMFF: байты 4..8 контейнера mp4 — "ftyp". */
function isMp4(bytes: Buffer): boolean {
  return bytes.subarray(4, 8).toString("ascii") === "ftyp"
}

describe("разбор mock-URL", () => {
  it("читает вид прямо из первого сегмента (форма fal)", () => {
    expect(parseMockPlaceholderUrl("mock://video/abc")).toEqual({ kind: "video", durationSec: null })
    expect(parseMockPlaceholderUrl("mock://image/abc")).toEqual({ kind: "image", durationSec: null })
  })

  it("выводит вид из способности (форма провайдера)", () => {
    expect(parseMockPlaceholderUrl("mock://replicate/lip_sync/x.mp4").kind).toBe("video")
    expect(parseMockPlaceholderUrl("mock://replicate/speech_to_video/x.mp4").kind).toBe("video")
    expect(parseMockPlaceholderUrl("mock://replicate/text_to_image/x.png").kind).toBe("image")
    expect(parseMockPlaceholderUrl("mock://replicate/text_to_speech/x.mp3").kind).toBe("audio")
    expect(parseMockPlaceholderUrl("mock://replicate/transcription/x.json").kind).toBe("transcript")
  })

  it("не привязан к имени провайдера: следующий получит тот же вид без правок", () => {
    // Ключ таблицы — способность. Провайдер в ссылке может быть любым, и
    // добавление второго не требует ни новой подстроки, ни новой ветки.
    expect(parseMockPlaceholderUrl("mock://fish/text_to_speech/x.mp3").kind).toBe("audio")
    expect(parseMockPlaceholderUrl("mock://новый-провайдер/lip_sync/x.mp4").kind).toBe("video")
  })

  it("читает заказанную длительность из query", () => {
    expect(parseMockPlaceholderUrl("mock://replicate/lip_sync/x.mp4?duration=4.500").durationSec).toBe(4.5)
    // Мусор и неположительные значения — это «длину не заказывали», а не ноль.
    expect(parseMockPlaceholderUrl("mock://replicate/lip_sync/x.mp4?duration=abc").durationSec).toBeNull()
    expect(parseMockPlaceholderUrl("mock://replicate/lip_sync/x.mp4?duration=0").durationSec).toBeNull()
  })

  it("оставляет неизвестным то, что медиа не является", () => {
    // Ссылка на ВХОД Replicate и ссылка загрузки fal: заглушку по ним не строят,
    // и придумывать им вид нельзя.
    expect(parseMockPlaceholderUrl("mock://replicate-input/abc").kind).toBe("unknown")
    expect(parseMockPlaceholderUrl("mock://upload/abc").kind).toBe("unknown")
    // Подписанная ссылка мок-хранилища: ключ объекта — не способность.
    expect(parseMockPlaceholderUrl("mock://gcs/videos/1/final.mp4?expires=1").kind).toBe("unknown")
  })
})

describe("generateMockPlaceholder на холодном кеше", () => {
  it("отдаёт настоящий PNG для mock://image", async () => {
    const dest = join(sandbox, "out.png")
    await generateMockPlaceholder("mock://image/abc", dest)

    const bytes = await readFile(dest)
    // Сигнатура PNG: 89 50 4E 47. Заглушка обязана быть картинкой, а не
    // JSON-текстом: вызывающий считает её ширину, высоту и sha1.
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4E, 0x47])
  })

  it("второй вызов берёт кеш и отдаёт тот же файл", async () => {
    const first = join(sandbox, "first.png")
    const second = join(sandbox, "second.png")
    await generateMockPlaceholder("mock://image/abc", first)
    await generateMockPlaceholder("mock://image/xyz", second)

    expect(await readFile(second)).toEqual(await readFile(first))
  })

  it("отдаёт настоящее видео на выход lip-sync, а не JSON под именем .mp4", async () => {
    const dest = join(sandbox, "lipsync.mp4")
    await generateMockPlaceholder("mock://replicate/lip_sync/mock_abc.mp4", dest)

    expect(isMp4(await readFile(dest))).toBe(true)
  }, 60_000)

  it("отдаёт картинку на выход text_to_image через ссылку провайдера", async () => {
    const dest = join(sandbox, "frame.png")
    await generateMockPlaceholder("mock://replicate/text_to_image/mock_abc.png", dest)

    expect([...(await readFile(dest)).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4E, 0x47])
  }, 60_000)

  it("картинка text_to_image и картинка image_to_image — разные файлы", async () => {
    // text_to_image и image_to_image вместе дают один вид "image"
    // (KIND_BY_CAPABILITY), и без разбора по способности их заглушки были бы
    // байт в байт одним и тем же файлом. Для HTTP-контура вариаций персонажа
    // (`POST /api/characters/:id/reference-variations`) это не косметика:
    // исходный портрет персонажа рисует text_to_image, а вариацию — по нему —
    // image_to_image, и sha1-дедup кадров (`characterId_sha1`) молча склеил бы
    // новую вариацию с исходным портретом, если бы их байты совпали.
    const t2i = join(sandbox, "t2i.png")
    const i2i = join(sandbox, "i2i.png")
    await generateMockPlaceholder("mock://replicate/text_to_image/mock_abc.png", t2i)
    await generateMockPlaceholder("mock://replicate/image_to_image/mock_def.png", i2i)

    expect(await readFile(i2i)).not.toEqual(await readFile(t2i))
  }, 60_000)

  it("кеш внутри ОДНОЙ способности по-прежнему работает: разные id — тот же файл", async () => {
    // Суффикс способности в имени кеш-файла (`buildCacheFileName`) разводит
    // РАЗНЫЕ способности (тест выше), но не должен развести ссылки ОДНОЙ и
    // той же способности с разными id — иначе каждый вызов через ссылку
    // провайдера заново звал бы ffmpeg вместо копии из кеша.
    const first = join(sandbox, "t2i-first.png")
    const second = join(sandbox, "t2i-second.png")
    await generateMockPlaceholder("mock://replicate/text_to_image/mock_abc.png", first)
    await generateMockPlaceholder("mock://replicate/text_to_image/mock_xyz.png", second)

    expect(await readFile(second)).toEqual(await readFile(first))
  }, 60_000)

  it("делает видео заказанной длины, а не своей", async () => {
    const dest = join(sandbox, "ordered.mp4")
    await generateMockPlaceholder("mock://replicate/lip_sync/mock_abc.mp4?duration=4.500", dest)

    const durationSec = await probeDurationSec(dest)
    expect(Math.abs(durationSec - 4.5)).toBeLessThan(0.2)
  }, 60_000)

  it("не путает кеш заглушек разной длины", async () => {
    const short = join(sandbox, "short.mp4")
    const long = join(sandbox, "long.mp4")
    await generateMockPlaceholder("mock://replicate/lip_sync/a.mp4?duration=2.000", short)
    await generateMockPlaceholder("mock://replicate/lip_sync/b.mp4?duration=6.000", long)

    expect(Math.abs((await probeDurationSec(short)) - 2)).toBeLessThan(0.2)
    expect(Math.abs((await probeDurationSec(long)) - 6)).toBeLessThan(0.2)
  }, 60_000)

  it("незнакомый вид отдаёт JSON-заглушку без ffmpeg", async () => {
    // Ссылка на ВХОД Replicate: медиа по ней не отдают, и генератору её вид
    // неизвестен — JSON без ffmpeg и без сети ровно то, что нужно.
    const dest = join(sandbox, "out.json")
    await generateMockPlaceholder("mock://replicate-input/8b1c2d3e4f", dest)

    expect(JSON.parse(await readFile(dest, "utf8"))).toMatchObject({ mock: true })
  })
})
