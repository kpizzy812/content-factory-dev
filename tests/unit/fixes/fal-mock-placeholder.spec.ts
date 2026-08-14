/**
 * Заглушки mock:// на холодном кеше.
 *
 * Кеш заглушек лежал в `<kind>.bin`, а ffmpeg по расширению `.bin` формат
 * контейнера выбрать не может: «Unable to choose an output format», выход
 * `Invalid argument`. На машине с прогретым кешем это незаметно — файл уже
 * есть, ffmpeg не зовётся. На чистой машине падает первый же вызов, и вместе
 * с ним весь API-контур генерации кадров: `generate-reference` отдаёт 500.
 *
 * Проверяем именно холодный старт: кеш-каталог свой на каждый прогон.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { generateMockPlaceholder } from "../../../server/utils/mock/fal-mock"

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

  it("незнакомый вид отдаёт JSON-заглушку без ffmpeg", async () => {
    // Ветка Replicate (`mock://replicate/...`) идёт именно сюда: ffmpeg там
    // не нужен, а сеть в тестах недоступна.
    const dest = join(sandbox, "out.json")
    await generateMockPlaceholder("mock://replicate/image_to_image/x.jpg", dest)

    expect(JSON.parse(await readFile(dest, "utf8"))).toMatchObject({ mock: true })
  })
})
