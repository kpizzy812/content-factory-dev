/**
 * Два закрытых долга исполнителя админских экранов
 * (`.superpowers/sdd/2026-08-27-segment-replace/admin-edit-profile-backgrounds-report.md`, §8):
 *
 *   DELETE /api/edit-profiles/:id            — профиль стало можно удалить
 *   GET    /api/apps/:id/background-clips    — список отдаёт ссылку на файл
 *
 * Настоящий Nitro и настоящая тестовая БД. Каждый `it` самодостаточен:
 * `tests/setup.ts` делает TRUNCATE всей public-схемы после КАЖДОГО теста.
 *
 * Образец — `tests/api/edit-console-read-endpoints.spec.ts`: оттуда взяты и
 * помощники, и приём проверки оракула существования (сравнение РАВЕНСТВА кодов
 * на паре «существует / не существует»).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

/** Заведомо свободный id: `tests/setup.ts` делает TRUNCATE ... RESTART IDENTITY. */
const MISSING_PROFILE_ID = 999_999_999

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run()
    return 200
  }
  catch (error) {
    return (error as { statusCode?: number }).statusCode ?? 0
  }
}

async function createTestApp() {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  return prisma.app.create({
    data: { name: `EditProfile Delete App ${seed}`, description: "test", keywords: ["test"] },
  })
}

function userWithAppAccess(appId: number) {
  return createTestUser({ canAdmin: false, appAssignments: [{ appId, accessLevel: "full" }] })
}

async function createProfile(appId: number | null, overrides: Record<string, unknown> = {}) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  return prisma.editProfile.create({ data: { appId, name: `Профиль ${seed}`, ...overrides } })
}

async function createVideo(extra: Record<string, unknown> = {}) {
  const scenario = await prisma.scenario.create({ data: { status: "draft" } })
  return prisma.video.create({
    data: { scenarioId: scenario.id, editPipeline: true, status: "completed", ...extra },
  })
}

// ── DELETE /api/edit-profiles/:id ────────────────────────────────────────────

describe("DELETE /api/edit-profiles/:id", () => {
  it("200: свободный профиль удаляется, строки в БД не остаётся", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const profile = await createProfile(app.id)

    const res = await $fetch<{ data: { id: number, note: string } }>(
      `/api/edit-profiles/${profile.id}`,
      { method: "DELETE", headers: authHeaders(user.id) },
    )

    expect(res.data.id).toBe(profile.id)
    expect(await prisma.editProfile.findUnique({ where: { id: profile.id } })).toBeNull()
  })

  it("409: профиль, на который ссылается ролик, не удаляется — иначе SetNull подменит историю", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const profile = await createProfile(app.id)
    const video = await createVideo()
    await prisma.video.update({ where: { id: video.id }, data: { editProfileId: profile.id } })

    const code = await statusOf(() => $fetch(`/api/edit-profiles/${profile.id}`, {
      method: "DELETE",
      headers: authHeaders(user.id),
    }))

    expect(code).toBe(409)
    // Профиль на месте, и ссылка ролика тоже — отказ ничего не сделал наполовину.
    expect(await prisma.editProfile.findUnique({ where: { id: profile.id } })).not.toBeNull()
    const reloaded = await prisma.video.findUnique({ where: { id: video.id } })
    expect(reloaded!.editProfileId).toBe(profile.id)
  })

  it("200: дефолт переезжает на самый свежий из оставшихся профилей", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const old = await createProfile(app.id, { name: "Старый", createdAt: new Date("2026-01-01T00:00:00Z") })
    const fresh = await createProfile(app.id, { name: "Свежий", createdAt: new Date("2026-06-01T00:00:00Z") })
    const target = await createProfile(app.id, { name: "Дефолтный", isDefault: true })

    const res = await $fetch<{ data: { promotedDefaultId: number | null, note: string } }>(
      `/api/edit-profiles/${target.id}`,
      { method: "DELETE", headers: authHeaders(user.id) },
    )

    expect(res.data.promotedDefaultId).toBe(fresh.id)
    expect(res.data.note).toContain("Свежий")

    // Дефолт в приложении ровно один — тот, кого назначили.
    const left = await prisma.editProfile.findMany({ where: { appId: app.id } })
    expect(left.filter(p => p.isDefault).map(p => p.id)).toEqual([fresh.id])
    expect(left.find(p => p.id === old.id)!.isDefault).toBe(false)
  })

  it("200: последний профиль приложения удаляется, приложение остаётся рабочим на встроенных значениях", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const profile = await createProfile(app.id, { isDefault: true })

    const res = await $fetch<{ data: { promotedDefaultId: number | null, note: string } }>(
      `/api/edit-profiles/${profile.id}`,
      { method: "DELETE", headers: authHeaders(user.id) },
    )

    expect(res.data.promotedDefaultId).toBeNull()
    expect(res.data.note).toContain("встроенны")
    expect(await prisma.editProfile.count({ where: { appId: app.id } })).toBe(0)
  })

  it("400 на некорректный id профиля", async () => {
    const user = await createTestUser()
    expect(await statusOf(() => $fetch("/api/edit-profiles/0", {
      method: "DELETE",
      headers: authHeaders(user.id),
    }))).toBe(400)
  })

  it("401 без auth", async () => {
    const app = await createTestApp()
    const profile = await createProfile(app.id)
    expect(await statusOf(() => $fetch(`/api/edit-profiles/${profile.id}`, { method: "DELETE" })))
      .toBe(401)
  })

  it("403 без права canDelete", async () => {
    const app = await createTestApp()
    const profile = await createProfile(app.id)
    const user = await createTestUser({ canDelete: false })
    expect(await statusOf(() => $fetch(`/api/edit-profiles/${profile.id}`, {
      method: "DELETE",
      headers: authHeaders(user.id),
    }))).toBe(403)
  })

  it("код ответа не выдаёт существование ЧУЖОГО профиля: он неотличим от несуществующего", async () => {
    // Тот же оракул, что закрывал GET по id: `appId` в адресе нет,
    // авторизоваться до чтения строки нечем, поэтому «чужой» и «отсутствующий»
    // обязаны отвечать ОДИНАКОВО — иначе перебор `EditProfile.id` выдаёт карту
    // профилей всех арендаторов.
    const app = await createTestApp()
    const outsiderApp = await createTestApp()
    const outsider = await userWithAppAccess(outsiderApp.id)
    const foreign = await createProfile(app.id)

    const headers = authHeaders(outsider.id)
    const foreignCode = await statusOf(() => $fetch(`/api/edit-profiles/${foreign.id}`, {
      method: "DELETE",
      headers,
    }))
    const missingCode = await statusOf(() => $fetch(`/api/edit-profiles/${MISSING_PROFILE_ID}`, {
      method: "DELETE",
      headers,
    }))

    expect(foreignCode).toBe(404)
    expect(missingCode).toBe(foreignCode)
    // И самое главное: отказ ничего не удалил.
    expect(await prisma.editProfile.findUnique({ where: { id: foreign.id } })).not.toBeNull()
  })

  it("шаблон без владельца (appId: null) удаляет только админ", async () => {
    const app = await createTestApp()
    const outsider = await userWithAppAccess(app.id)
    const template = await createProfile(null, { name: "Общий шаблон" })

    expect(await statusOf(() => $fetch(`/api/edit-profiles/${template.id}`, {
      method: "DELETE",
      headers: authHeaders(outsider.id),
    }))).toBe(404)
    expect(await prisma.editProfile.findUnique({ where: { id: template.id } })).not.toBeNull()

    const admin = await createTestUser({ canAdmin: true })
    await $fetch(`/api/edit-profiles/${template.id}`, {
      method: "DELETE",
      headers: authHeaders(admin.id),
    })
    expect(await prisma.editProfile.findUnique({ where: { id: template.id } })).toBeNull()
  })
})

// ── GET /api/apps/:id/background-clips ───────────────────────────────────────

describe("GET /api/apps/:id/background-clips", () => {
  async function createClip(appId: number, over: Record<string, unknown> = {}) {
    const seed = Math.floor(Math.random() * 1_000_000_000)
    return prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: `zavodcamp/apps/${appId}/backgrounds/${seed}.mp4`,
        sha1: String(seed).padStart(16, "0"),
        mimeType: "video/mp4",
        kind: "footage",
        ...over,
      },
    })
  }

  it("200: у каждого клипа есть поле previewUrl — карточка больше не выбирает фон вслепую", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    await createClip(app.id)

    const res = await $fetch<{ data: Array<Record<string, unknown>> }>(
      `/api/apps/${app.id}/background-clips`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data).toHaveLength(1)
    const clip = res.data[0]!
    // Ключ обязан ПРИСУТСТВОВАТЬ: пропуск поля клиент прочитал бы как «сервер
    // этого не умеет», и карточка навсегда осталась бы с иконкой по типу.
    expect(Object.prototype.hasOwnProperty.call(clip, "previewUrl")).toBe(true)
    // Ключ хранилища из ответа не исчез — по нему сходятся кадры и логи.
    expect(typeof clip.storageKey).toBe("string")
  })

  it("200: ссылка ведёт на сам файл, а не на технический ключ", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const clip = await createClip(app.id, { mimeType: "image/png", kind: "image" })

    const res = await $fetch<{ data: Array<{ previewUrl: string | null }> }>(
      `/api/apps/${app.id}/background-clips`,
      { headers: authHeaders(user.id) },
    )

    const url = res.data[0]!.previewUrl
    // На тестовом стенде драйвер не gcs — значит отдача идёт через своё
    // приложение подписанным токеном, адресом ОТНОСИТЕЛЬНО текущего источника
    // (публичный абсолютный адрес превью не нужен). Ключ хранилища в адресе не
    // светится: он внутри подписанного токена.
    expect(url).not.toBeNull()
    expect(url!.startsWith("/api/public/media/")).toBe(true)
    expect(url!).not.toContain(clip.storageKey)
  })

  it("200: погашенные фоны в списке по-прежнему не появляются", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    await createClip(app.id, { isActive: false })

    const res = await $fetch<{ data: unknown[] }>(
      `/api/apps/${app.id}/background-clips`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data).toEqual([])
  })
})
