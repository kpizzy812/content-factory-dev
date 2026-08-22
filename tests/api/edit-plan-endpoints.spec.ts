/**
 * Контрактные тесты HTTP-слоя монтажных профилей и библиотеки фонов
 * (Task 7, план «Монтаж, фоны и PiP», §9 спеки):
 *
 *   GET    /api/edit-profiles?appId=N
 *   POST   /api/edit-profiles
 *   PUT    /api/edit-profiles/:id
 *   GET    /api/apps/:id/background-clips
 *   POST   /api/apps/:id/background-clips
 *   DELETE /api/apps/:id/background-clips/:clipId
 *
 * Настоящий Nitro, настоящая тестовая БД, настоящий ffmpeg (локальный бинарь,
 * не платный вызов) — фикстуры фона строятся из явного grayscale-паттерна
 * 9x8 через `-f rawvideo -pix_fmt gray`, конвертация в PNG лосслесс, поэтому
 * перцептивный хэш, который посчитает эндпоинт, детерминирован и известен
 * заранее (проверено ручным round-trip перед написанием теста).
 *
 * Каждый `it` самодостаточен: tests/setup.ts делает TRUNCATE всей public-схемы
 * после КАЖДОГО теста (прецедент — tests/integration/presenter-recording.spec.ts:30-33).
 * Байтовые фикстуры (PNG/MP4) — в памяти, строятся один раз в beforeAll: это
 * не строки БД, TRUNCATE их не касается.
 *
 * Образцы: tests/api/presenter-recordings.spec.ts, tests/api/characters-regenerate.spec.ts.
 *
 * @vitest-environment node
 */
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, it, expect, beforeAll } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

// ── Фикстуры файлов ─────────────────────────────────────────────────────────

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    proc.stderr.on("data", chunk => { stderr += chunk.toString() })
    proc.once("error", reject)
    proc.once("exit", code => (code === 0 ? resolvePromise() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 400)}`))))
  })
}

/**
 * PNG 9x8 из явного grayscale-паттерна. Раунд-трип raw->png->raw лосслесс
 * (PNG grayscale не сжимает с потерями, scale 9x8->9x8 внутри grayscaleThumbnail
 * — identity) — проверено вручную перед написанием теста, поэтому хэш,
 * который посчитает эндпоинт из готового PNG, совпадает с dHash от pattern.
 */
async function buildGrayscalePng(pattern: number[]): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "bg-fixture-"))
  try {
    const rawPath = join(dir, "pixels.raw")
    const pngPath = join(dir, "out.png")
    await writeFile(rawPath, Buffer.from(pattern))
    await runFfmpeg([
      "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "9x8", "-i", rawPath,
      "-frames:v", "1", "-update", "1", pngPath,
    ])
    return await readFile(pngPath)
  }
  finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Базовый паттерн: чередование 200/50 по x — устойчивые left>right переходы. */
function patternBase(): number[] {
  const p: number[] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) p.push(x % 2 === 0 ? 200 : 50)
  return p
}

/** Один изменённый пиксель — другой sha1, дистанция dHash = 2 (порог 6, значит «похож»). */
function patternSimilar(): number[] {
  const p = patternBase()
  p[2] = 10
  return p
}

/** Полная инверсия — дистанция dHash = 64 (заведомо выше порога, «не похож»). */
function patternDifferent(): number[] {
  const p: number[] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) p.push(x % 2 === 0 ? 50 : 200)
  return p
}

async function buildTinyMp4(): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "bg-fixture-mp4-"))
  try {
    const outPath = join(dir, "out.mp4")
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=blue:size=64x64:duration=1:rate=5",
      "-frames:v", "5", "-pix_fmt", "yuv420p", outPath,
    ])
    return await readFile(outPath)
  }
  finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

let basePngBytes: Buffer
let similarPngBytes: Buffer
let differentPngBytes: Buffer
let tinyMp4Bytes: Buffer

beforeAll(async () => {
  ;[basePngBytes, similarPngBytes, differentPngBytes, tinyMp4Bytes] = await Promise.all([
    buildGrayscalePng(patternBase()),
    buildGrayscalePng(patternSimilar()),
    buildGrayscalePng(patternDifferent()),
    buildTinyMp4(),
  ])
})

function pngFile(bytes: Buffer, name = "bg.png"): File {
  return new File([bytes], name, { type: "image/png" })
}
function mp4File(bytes: Buffer, name = "bg.mp4"): File {
  return new File([bytes], name, { type: "video/mp4" })
}

// ── Фикстуры БД ──────────────────────────────────────────────────────────────

async function createTestApp() {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  return prisma.app.create({
    data: { name: `EditPlan Test App ${seed}`, description: "test", keywords: ["test"] },
  })
}

async function createTestEditProfile(appId: number, overrides: Record<string, unknown> = {}) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  return prisma.editProfile.create({ data: { appId, name: `Профиль ${seed}`, ...overrides } })
}

async function createTestBackgroundClip(appId: number, overrides: Record<string, unknown> = {}) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  return prisma.backgroundClip.create({
    data: {
      appId,
      storageKey: `zavodcamp/apps/${appId}/backgrounds/contract-${seed}.mp4`,
      sha1: `contractsha1${seed}`.slice(0, 16),
      ...overrides,
    },
  })
}

/** Пользователь с доступом РОВНО к одному приложению, не admin — appId-скоуп реально проверяется. */
function userWithAppAccess(appId: number) {
  return createTestUser({ canAdmin: false, appAssignments: [{ appId, accessLevel: "full" }] })
}

// ── GET /api/edit-profiles ───────────────────────────────────────────────────

describe("GET /api/edit-profiles", () => {
  it("200: список содержит РАЗРЕШЁННЫЕ значения, а не сырые (brollRatio:2 в БД -> 1 в ответе)", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    // Профиль создан МИМО API — как будто легаси-строка с мусором вне диапазона.
    const profile = await createTestEditProfile(app.id, { brollRatio: 2, shotChangeSec: 0.1 })

    const res = await $fetch<{ data: Array<Record<string, unknown>> }>(
      `/api/edit-profiles?appId=${app.id}`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data).toHaveLength(1)
    const row = res.data[0]!
    expect(row.id).toBe(profile.id)
    expect(row.brollRatio).toBe(1) // зажато резолвером, а не 2 как в БД
    expect(row.shotChangeSec).toBe(1.8) // 0.1 ниже порога валидности -> дефолт
    expect(row.imageGenerationEnabled).toBe(true)
    expect(row.pipPosition).toBe("bottom_right")
  })

  it("400 без query-параметра appId", async () => {
    const user = await createTestUser()
    await expect($fetch(`/api/edit-profiles`, { headers: authHeaders(user.id) }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it("404 на несуществующее приложение", async () => {
    const user = await createTestUser()
    await expect($fetch(`/api/edit-profiles?appId=999999999`, { headers: authHeaders(user.id) }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it("403 без доступа к приложению", async () => {
    const app = await createTestApp()
    const otherApp = await createTestApp()
    const user = await userWithAppAccess(otherApp.id)
    await expect($fetch(`/api/edit-profiles?appId=${app.id}`, { headers: authHeaders(user.id) }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it("401 без auth", async () => {
    const app = await createTestApp()
    await expect($fetch(`/api/edit-profiles?appId=${app.id}`)).rejects.toMatchObject({ statusCode: 401 })
  })
})

// ── POST /api/edit-profiles ──────────────────────────────────────────────────

describe("POST /api/edit-profiles", () => {
  it("200 создаёт профиль, ответ и БД совпадают", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)

    const res = await $fetch<{ data: Record<string, unknown> }>(`/api/edit-profiles`, {
      method: "POST",
      headers: authHeaders(user.id),
      body: { appId: app.id, name: "Бренд A", brollRatio: 0.3, pipEnabled: true, pipPosition: "top_left" },
    })

    expect(res.data.name).toBe("Бренд A")
    expect(res.data.brollRatio).toBe(0.3)
    expect(res.data.pipEnabled).toBe(true)
    expect(res.data.pipPosition).toBe("top_left")
    expect(res.data.imageGenerationEnabled).toBe(true) // дефолт схемы

    const row = await prisma.editProfile.findUnique({ where: { id: res.data.id as number } })
    expect(row?.appId).toBe(app.id)
    expect(row?.brollRatio).toBe(0.3)
  })

  it("400 на brollRatio: 2 — API отвергает то, что резолвер бы молча зажал до 1", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)

    await expect($fetch(`/api/edit-profiles`, {
      method: "POST", headers: authHeaders(user.id),
      body: { appId: app.id, name: "x", brollRatio: 2 },
    })).rejects.toMatchObject({ statusCode: 400 })

    expect(await prisma.editProfile.count({ where: { appId: app.id } })).toBe(0)
  })

  it("400 на shotChangeSec: 0", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)

    await expect($fetch(`/api/edit-profiles`, {
      method: "POST", headers: authHeaders(user.id),
      body: { appId: app.id, name: "x", shotChangeSec: 0 },
    })).rejects.toMatchObject({ statusCode: 400 })

    expect(await prisma.editProfile.count({ where: { appId: app.id } })).toBe(0)
  })

  it("400 без appId", async () => {
    const user = await createTestUser()
    await expect($fetch(`/api/edit-profiles`, {
      method: "POST", headers: authHeaders(user.id), body: { name: "x" },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 без name", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    await expect($fetch(`/api/edit-profiles`, {
      method: "POST", headers: authHeaders(user.id), body: { appId: app.id },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 на некорректный pipPosition", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    await expect($fetch(`/api/edit-profiles`, {
      method: "POST", headers: authHeaders(user.id),
      body: { appId: app.id, name: "x", pipPosition: "center" },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 на некорректный generativeVideoResolution", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    await expect($fetch(`/api/edit-profiles`, {
      method: "POST", headers: authHeaders(user.id),
      body: { appId: app.id, name: "x", generativeVideoResolution: "640x480" },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it("404 на несуществующее приложение", async () => {
    const user = await createTestUser()
    await expect($fetch(`/api/edit-profiles`, {
      method: "POST", headers: authHeaders(user.id), body: { appId: 999999999, name: "x" },
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it("403 без доступа к приложению — профиль не создаётся", async () => {
    const app = await createTestApp()
    const otherApp = await createTestApp()
    const user = await userWithAppAccess(otherApp.id)

    await expect($fetch(`/api/edit-profiles`, {
      method: "POST", headers: authHeaders(user.id), body: { appId: app.id, name: "x" },
    })).rejects.toMatchObject({ statusCode: 403 })

    expect(await prisma.editProfile.count({ where: { appId: app.id } })).toBe(0)
  })

  it("401 без auth", async () => {
    const app = await createTestApp()
    await expect($fetch(`/api/edit-profiles`, {
      method: "POST", body: { appId: app.id, name: "x" },
    })).rejects.toMatchObject({ statusCode: 401 })
  })
})

// ── PUT /api/edit-profiles/:id ────────────────────────────────────────────────

describe("PUT /api/edit-profiles/:id", () => {
  it("200 обновляет поля, значения реально меняются в БД, остальное не тронуто", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const profile = await createTestEditProfile(app.id, { brollRatio: 0.4, name: "Исходное имя" })

    const res = await $fetch<{ data: Record<string, unknown> }>(`/api/edit-profiles/${profile.id}`, {
      method: "PUT", headers: authHeaders(user.id), body: { brollRatio: 0.6, pipEnabled: true },
    })
    expect(res.data.brollRatio).toBe(0.6)
    expect(res.data.pipEnabled).toBe(true)

    const refreshed = await prisma.editProfile.findUnique({ where: { id: profile.id } })
    expect(refreshed?.brollRatio).toBe(0.6)
    expect(refreshed?.pipEnabled).toBe(true)
    expect(refreshed?.name).toBe("Исходное имя")
  })

  it("400 на brollRatio: 2 в PUT — не зажимается, отвергается", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const profile = await createTestEditProfile(app.id, { brollRatio: 0.4 })

    await expect($fetch(`/api/edit-profiles/${profile.id}`, {
      method: "PUT", headers: authHeaders(user.id), body: { brollRatio: 2 },
    })).rejects.toMatchObject({ statusCode: 400 })

    const untouched = await prisma.editProfile.findUnique({ where: { id: profile.id } })
    expect(untouched?.brollRatio).toBe(0.4)
  })

  it("400 на shotChangeSec: 0 в PUT", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const profile = await createTestEditProfile(app.id)

    await expect($fetch(`/api/edit-profiles/${profile.id}`, {
      method: "PUT", headers: authHeaders(user.id), body: { shotChangeSec: 0 },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400 при попытке сменить appId профиля", async () => {
    const app = await createTestApp()
    const otherApp = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const profile = await createTestEditProfile(app.id)

    await expect($fetch(`/api/edit-profiles/${profile.id}`, {
      method: "PUT", headers: authHeaders(user.id), body: { appId: otherApp.id },
    })).rejects.toMatchObject({ statusCode: 400 })

    const untouched = await prisma.editProfile.findUnique({ where: { id: profile.id } })
    expect(untouched?.appId).toBe(app.id)
  })

  it("404 на несуществующий id", async () => {
    const user = await createTestUser()
    await expect($fetch(`/api/edit-profiles/999999999`, {
      method: "PUT", headers: authHeaders(user.id), body: { brollRatio: 0.5 },
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it("403 на профиль ЧУЖОГО приложения — профиль не изменяется", async () => {
    const owner = await createTestApp()
    const intruderApp = await createTestApp()
    const user = await userWithAppAccess(intruderApp.id)
    const profile = await createTestEditProfile(owner.id, { brollRatio: 0.4 })

    await expect($fetch(`/api/edit-profiles/${profile.id}`, {
      method: "PUT", headers: authHeaders(user.id), body: { brollRatio: 0.9 },
    })).rejects.toMatchObject({ statusCode: 403 })

    const untouched = await prisma.editProfile.findUnique({ where: { id: profile.id } })
    expect(untouched?.brollRatio).toBe(0.4)
  })

  it("401 без auth", async () => {
    const app = await createTestApp()
    const profile = await createTestEditProfile(app.id)
    await expect($fetch(`/api/edit-profiles/${profile.id}`, {
      method: "PUT", body: { brollRatio: 0.5 },
    })).rejects.toMatchObject({ statusCode: 401 })
  })
})

// ── GET /api/apps/:id/background-clips ───────────────────────────────────────

describe("GET /api/apps/:id/background-clips", () => {
  it("200: только активные, bytes сериализуется строкой (BigInt > потолка INTEGER)", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const bigBytes = 5_000_000_000n // выше 2 147 483 647 — потолок INTEGER
    const active = await createTestBackgroundClip(app.id, { bytes: bigBytes })
    await createTestBackgroundClip(app.id, { isActive: false })

    const res = await $fetch<{ data: Array<Record<string, unknown>> }>(
      `/api/apps/${app.id}/background-clips`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data).toHaveLength(1)
    expect(res.data[0]!.id).toBe(active.id)
    expect(res.data[0]!.bytes).toBe("5000000000")
    expect(typeof res.data[0]!.bytes).toBe("string")
  })

  it("404 на несуществующее приложение", async () => {
    const user = await createTestUser()
    await expect($fetch(`/api/apps/999999999/background-clips`, { headers: authHeaders(user.id) }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it("403 без доступа к приложению", async () => {
    const app = await createTestApp()
    const otherApp = await createTestApp()
    const user = await userWithAppAccess(otherApp.id)
    await expect($fetch(`/api/apps/${app.id}/background-clips`, { headers: authHeaders(user.id) }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it("401 без auth", async () => {
    const app = await createTestApp()
    await expect($fetch(`/api/apps/${app.id}/background-clips`)).rejects.toMatchObject({ statusCode: 401 })
  })
})

// ── POST /api/apps/:id/background-clips ──────────────────────────────────────

describe("POST /api/apps/:id/background-clips", () => {
  it("200 заливает картинку: sha1, перцептивный хэш, storageKey под префиксом хранилища", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)

    const form = new FormData()
    form.append("file", pngFile(basePngBytes))
    form.append("name", "Экран лендинга")
    form.append("tags", "лендинг, скрин")

    const res = await $fetch<{ data: { clip: Record<string, unknown>, deduped: boolean, similarClips: string[] } }>(
      `/api/apps/${app.id}/background-clips`,
      { method: "POST", headers: authHeaders(user.id), body: form },
    )

    expect(res.data.deduped).toBe(false)
    expect(res.data.similarClips).toEqual([])
    const clip = res.data.clip
    expect(clip.appId).toBe(app.id)
    expect(clip.name).toBe("Экран лендинга")
    expect(clip.kind).toBe("image")
    expect(clip.tags).toEqual(["лендинг", "скрин"])
    expect(typeof clip.sha1).toBe("string")
    expect((clip.sha1 as string).length).toBe(16)
    expect(clip.perceptualHash).toMatch(/^[0-9a-f]{16}$/)
    // Требование 9: StorageKeys.backgroundClip реально использован и его
    // результат реально проверен — префикс хранилища и путь backgrounds/.
    expect(clip.storageKey).toMatch(/^zavodcamp\//)
    expect(clip.storageKey).toContain(`apps/${app.id}/backgrounds/`)

    const row = await prisma.backgroundClip.findUnique({ where: { id: clip.id as string } })
    expect(row).not.toBeNull()
    expect(row?.perceptualHash).toBe(clip.perceptualHash)
  })

  it("повторная заливка того же файла возвращает существующую строку, а не создаёт вторую", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)

    const form1 = new FormData()
    form1.append("file", pngFile(basePngBytes))
    const first = await $fetch<{ data: { clip: { id: string }, deduped: boolean } }>(
      `/api/apps/${app.id}/background-clips`, { method: "POST", headers: authHeaders(user.id), body: form1 },
    )
    expect(first.data.deduped).toBe(false)

    const form2 = new FormData()
    form2.append("file", pngFile(basePngBytes))
    const second = await $fetch<{ data: { clip: { id: string }, deduped: boolean } }>(
      `/api/apps/${app.id}/background-clips`, { method: "POST", headers: authHeaders(user.id), body: form2 },
    )
    expect(second.data.deduped).toBe(true)
    expect(second.data.clip.id).toBe(first.data.clip.id)

    expect(await prisma.backgroundClip.count({ where: { appId: app.id } })).toBe(1)
  })

  it("похожий по перцептивному хэшу фон принимается, но помечается в ответе (similarClips)", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)

    const form1 = new FormData()
    form1.append("file", pngFile(basePngBytes))
    const first = await $fetch<{ data: { clip: { id: string } } }>(
      `/api/apps/${app.id}/background-clips`, { method: "POST", headers: authHeaders(user.id), body: form1 },
    )

    const form2 = new FormData()
    form2.append("file", pngFile(similarPngBytes))
    const second = await $fetch<{ data: { clip: { id: string }, deduped: boolean, similarClips: string[] } }>(
      `/api/apps/${app.id}/background-clips`, { method: "POST", headers: authHeaders(user.id), body: form2 },
    )

    expect(second.data.deduped).toBe(false) // разные байты — не дубль по sha1
    expect(second.data.clip.id).not.toBe(first.data.clip.id) // новая строка реально создана
    expect(second.data.similarClips).toContain(first.data.clip.id) // но похожесть отмечена

    expect(await prisma.backgroundClip.count({ where: { appId: app.id } })).toBe(2)
  })

  it("непохожий фон НЕ попадает в similarClips — порог реально фильтрует, а не декорация", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)

    const form1 = new FormData()
    form1.append("file", pngFile(basePngBytes))
    await $fetch(`/api/apps/${app.id}/background-clips`, { method: "POST", headers: authHeaders(user.id), body: form1 })

    const form2 = new FormData()
    form2.append("file", pngFile(differentPngBytes))
    const second = await $fetch<{ data: { similarClips: string[] } }>(
      `/api/apps/${app.id}/background-clips`, { method: "POST", headers: authHeaders(user.id), body: form2 },
    )
    expect(second.data.similarClips).toEqual([])
  })

  it("200 заливает видео: kind по умолчанию footage, durationSec посчитан", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)

    const form = new FormData()
    form.append("file", mp4File(tinyMp4Bytes))
    const res = await $fetch<{ data: { clip: Record<string, unknown> } }>(
      `/api/apps/${app.id}/background-clips`, { method: "POST", headers: authHeaders(user.id), body: form },
    )
    expect(res.data.clip.kind).toBe("footage")
    expect(res.data.clip.mimeType).toBe("video/mp4")
    expect(Number(res.data.clip.durationSec)).toBeGreaterThan(0)
  })

  it("415 на неподдерживаемый формат", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const form = new FormData()
    form.append("file", new File([Buffer.from("gif-like-bytes")], "bg.gif", { type: "image/gif" }))
    await expect($fetch(`/api/apps/${app.id}/background-clips`, { method: "POST", headers: authHeaders(user.id), body: form }))
      .rejects.toMatchObject({ statusCode: 415 })
  })

  it("400 без файла", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const form = new FormData()
    form.append("name", "без файла")
    await expect($fetch(`/api/apps/${app.id}/background-clips`, { method: "POST", headers: authHeaders(user.id), body: form }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it("404 на несуществующее приложение", async () => {
    const user = await createTestUser()
    const form = new FormData()
    form.append("file", pngFile(basePngBytes))
    await expect($fetch(`/api/apps/999999999/background-clips`, { method: "POST", headers: authHeaders(user.id), body: form }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it("403 без доступа к приложению — фон не создаётся", async () => {
    const app = await createTestApp()
    const otherApp = await createTestApp()
    const user = await userWithAppAccess(otherApp.id)
    const form = new FormData()
    form.append("file", pngFile(basePngBytes))

    await expect($fetch(`/api/apps/${app.id}/background-clips`, { method: "POST", headers: authHeaders(user.id), body: form }))
      .rejects.toMatchObject({ statusCode: 403 })

    expect(await prisma.backgroundClip.count({ where: { appId: app.id } })).toBe(0)
  })

  it("401 без auth", async () => {
    const app = await createTestApp()
    const form = new FormData()
    form.append("file", pngFile(basePngBytes))
    await expect($fetch(`/api/apps/${app.id}/background-clips`, { method: "POST", body: form }))
      .rejects.toMatchObject({ statusCode: 401 })
  })
})

// ── DELETE /api/apps/:id/background-clips/:clipId ────────────────────────────

describe("DELETE /api/apps/:id/background-clips/:clipId", () => {
  it("200 мягко гасит: isActive false, строка остаётся в БД (на неё могут ссылаться кадры роликов)", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const clip = await createTestBackgroundClip(app.id)

    const res = await $fetch<{ data: Array<Record<string, unknown>> }>(
      `/api/apps/${app.id}/background-clips/${clip.id}`, { method: "DELETE", headers: authHeaders(user.id) },
    )
    expect(res.data.find(c => c.id === clip.id)).toBeUndefined()

    const row = await prisma.backgroundClip.findUnique({ where: { id: clip.id } })
    expect(row).not.toBeNull()
    expect(row?.isActive).toBe(false)
  })

  it("404 на фон ЧУЖОГО приложения — чужой фон не гасится", async () => {
    const owner = await createTestApp()
    const intruderApp = await createTestApp()
    const user = await userWithAppAccess(intruderApp.id)
    const clip = await createTestBackgroundClip(owner.id)

    await expect(
      $fetch(`/api/apps/${intruderApp.id}/background-clips/${clip.id}`, { method: "DELETE", headers: authHeaders(user.id) }),
    ).rejects.toMatchObject({ statusCode: 404 })

    const untouched = await prisma.backgroundClip.findUnique({ where: { id: clip.id } })
    expect(untouched?.isActive).toBe(true)
  })

  it("404 на несуществующий clipId", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    await expect(
      $fetch(`/api/apps/${app.id}/background-clips/does-not-exist`, { method: "DELETE", headers: authHeaders(user.id) }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("403 без доступа к приложению", async () => {
    const app = await createTestApp()
    const otherApp = await createTestApp()
    const user = await userWithAppAccess(otherApp.id)
    const clip = await createTestBackgroundClip(app.id)

    await expect(
      $fetch(`/api/apps/${app.id}/background-clips/${clip.id}`, { method: "DELETE", headers: authHeaders(user.id) }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("401 без auth", async () => {
    const app = await createTestApp()
    const clip = await createTestBackgroundClip(app.id)
    await expect(
      $fetch(`/api/apps/${app.id}/background-clips/${clip.id}`, { method: "DELETE" }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})
