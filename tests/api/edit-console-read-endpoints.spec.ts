/**
 * Контрактные тесты трёх ЧИТАЮЩИХ ручек монтажной консоли (хвост Task 7 плана
 * «Монтаж, фоны и PiP»; запрос исполнителя экранов —
 * `.superpowers/sdd/2026-08-27-segment-replace/task-7-ui-report.md` §5):
 *
 *   GET /api/videos/:id/shots        — факт исполнения кадров
 *   GET /api/videos/:id/progress     — пошаговый режим в опросе прогресса
 *   GET /api/edit-profiles/:id       — один монтажный профиль
 *
 * Настоящий Nitro и настоящая тестовая БД. Каждый `it` самодостаточен:
 * `tests/setup.ts` делает TRUNCATE всей public-схемы после КАЖДОГО теста.
 *
 * Образец: `tests/api/edit-plan-endpoints.spec.ts` — оттуда же взят приём
 * проверки оракула существования (сравнение РАВЕНСТВА кодов на паре
 * «существует / не существует»).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

/** Заведомо свободные id: `tests/setup.ts` делает TRUNCATE ... RESTART IDENTITY. */
const MISSING_VIDEO_ID = 999_999_999
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
    data: { name: `EditConsole Test App ${seed}`, description: "test", keywords: ["test"] },
  })
}

/** Пользователь с доступом РОВНО к одному приложению, не admin. */
function userWithAppAccess(appId: number) {
  return createTestUser({ canAdmin: false, appAssignments: [{ appId, accessLevel: "full" }] })
}

/** Право и appId в порядке, но модуль `video-generator` не выдан. */
function userMissingModule(appId: number) {
  return createTestUser({
    canAdmin: false,
    appAssignments: [{ appId, accessLevel: "full" }],
    moduleAccess: ["script-generator"],
  })
}

async function createVideo(extra: Record<string, unknown> = {}) {
  const scenario = await prisma.scenario.create({ data: { status: "draft" } })
  return prisma.video.create({
    data: { scenarioId: scenario.id, editPipeline: true, status: "completed", ...extra },
  })
}

async function createShot(videoId: number, over: Record<string, unknown> = {}) {
  return prisma.videoShot.create({
    data: {
      videoId,
      order: 0,
      startSec: 0,
      endSec: 2,
      sceneOrder: null,
      foreground: "none",
      background: "library",
      idea: "идея кадра",
      status: "planned",
      ...over,
    },
  })
}

// ── GET /api/videos/:id/shots ────────────────────────────────────────────────

describe("GET /api/videos/:id/shots", () => {
  it("200: отдаёт ФАКТ исполнения кадра целиком, а не план", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const video = await createVideo()
    await createShot(video.id, {
      order: 0,
      startSec: 0,
      endSec: 2.5,
      sceneOrder: 3,
      // План просил видео, а снята картинка — ровно это расхождение таблица и
      // обязана показать оператору, и без ручки показать его нечем.
      background: "video",
      backgroundActual: "image",
      status: "degraded",
      costUsd: 0.04,
      degradeReason: "Потолок расхода на видео $1.00 исчерпан — снята картинка",
      assetPath: "videos/1/shot_0_composed.mp4",
      perceptualHash: "a1b2c3d4e5f60718",
    })

    const res = await $fetch<{ data: Array<Record<string, unknown>> }>(
      `/api/videos/${video.id}/shots`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data).toHaveLength(1)
    expect(res.data[0]).toMatchObject({
      order: 0,
      startSec: 0,
      endSec: 2.5,
      sceneOrder: 3,
      backgroundActual: "image",
      status: "degraded",
      costUsd: 0.04,
      degradeReason: "Потолок расхода на видео $1.00 исчерпан — снята картинка",
      assetPath: "videos/1/shot_0_composed.mp4",
      perceptualHash: "a1b2c3d4e5f60718",
    })
  })

  it("200: кадры отсортированы по позиции на таймлайне", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const video = await createVideo()
    // Порядок вставки обратный — без явного orderBy ответ был бы недетерминирован.
    await createShot(video.id, { order: 2, startSec: 4, endSec: 6 })
    await createShot(video.id, { order: 0, startSec: 0, endSec: 2 })
    await createShot(video.id, { order: 1, startSec: 2, endSec: 4 })

    const res = await $fetch<{ data: Array<{ order: number }> }>(
      `/api/videos/${video.id}/shots`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.map(s => s.order)).toEqual([0, 1, 2])
  })

  it("200: кадр без исполнения отдаёт backgroundActual: null — план без факта, а не ошибка", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const video = await createVideo({ status: "assembling" })
    await createShot(video.id, { order: 0, background: "image", costUsd: 0.04 })

    const res = await $fetch<{ data: Array<Record<string, unknown>> }>(
      `/api/videos/${video.id}/shots`,
      { headers: authHeaders(user.id) },
    )

    const row = res.data[0]!
    // Ключ обязан ПРИСУТСТВОВАТЬ со значением null: пропуск поля клиент
    // прочитал бы как «сервер этого не умеет», и колонка факта снова стала бы
    // неотличима от отсутствующей ручки.
    expect(Object.prototype.hasOwnProperty.call(row, "backgroundActual")).toBe(true)
    expect(row.backgroundActual).toBeNull()
    expect(row.status).toBe("planned")
    expect(row.assetPath).toBeNull()
    expect(row.perceptualHash).toBeNull()
    // Плановая стоимость доступна до исполнения — её пишет ещё saveShots.
    expect(row.costUsd).toBe(0.04)
  })

  it("200: у ролика без кадров пустой список, а не 404", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const video = await createVideo()

    const res = await $fetch<{ data: unknown[] }>(
      `/api/videos/${video.id}/shots`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data).toEqual([])
  })

  it("200: кадры чужого ролика не подмешиваются", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const video = await createVideo()
    const other = await createVideo()
    await createShot(video.id, { order: 0, idea: "свой" })
    await createShot(other.id, { order: 0, idea: "чужой" })

    const res = await $fetch<{ data: unknown[] }>(
      `/api/videos/${video.id}/shots`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data).toHaveLength(1)
  })

  it("400 на некорректный ID видео", async () => {
    const user = await createTestUser()
    expect(await statusOf(() => $fetch(`/api/videos/0/shots`, { headers: authHeaders(user.id) })))
      .toBe(400)
  })

  it("404 на несуществующий ролик", async () => {
    const user = await createTestUser()
    expect(await statusOf(() => $fetch(`/api/videos/${MISSING_VIDEO_ID}/shots`, {
      headers: authHeaders(user.id),
    }))).toBe(404)
  })

  it("401 без auth", async () => {
    const video = await createVideo()
    expect(await statusOf(() => $fetch(`/api/videos/${video.id}/shots`))).toBe(401)
  })

  it("403 без права canRead", async () => {
    const video = await createVideo()
    const user = await createTestUser({ canRead: false })
    expect(await statusOf(() => $fetch(`/api/videos/${video.id}/shots`, {
      headers: authHeaders(user.id),
    }))).toBe(403)
  })

  it("403 без доступа к модулю video-generator (право на месте)", async () => {
    const app = await createTestApp()
    const user = await userMissingModule(app.id)
    const video = await createVideo()
    expect(await statusOf(() => $fetch(`/api/videos/${video.id}/shots`, {
      headers: authHeaders(user.id),
    }))).toBe(403)
  })

  it("код ответа не выдаёт существование ролика: аноним и бесправный видят одно и то же", async () => {
    // Тот же приём и та же причина, что в блоке «Оракул существования» в
    // `edit-plan-endpoints.spec.ts`: `Video.id` — последовательные целые, и
    // разные коды на существующем и несуществующем id превращают перебор в
    // карту чужих роликов. Держится тем, что `requireScopedAccess` стоит ПЕРВОЙ
    // строкой ручки — до разбора id и до чтения ролика.
    const video = await createVideo()

    const anonExisting = await statusOf(() => $fetch(`/api/videos/${video.id}/shots`))
    const anonMissing = await statusOf(() => $fetch(`/api/videos/${MISSING_VIDEO_ID}/shots`))
    expect(anonExisting).toBe(401)
    expect(anonMissing).toBe(anonExisting)

    const stranger = await createTestUser({ canRead: false })
    const headers = authHeaders(stranger.id)
    const strangerExisting = await statusOf(() => $fetch(`/api/videos/${video.id}/shots`, { headers }))
    const strangerMissing = await statusOf(() => $fetch(`/api/videos/${MISSING_VIDEO_ID}/shots`, { headers }))
    expect(strangerExisting).toBe(403)
    expect(strangerMissing).toBe(strangerExisting)
  })
})

// ── GET /api/videos/:id/progress ─────────────────────────────────────────────

describe("GET /api/videos/:id/progress: пошаговый режим", () => {
  it("отдаёт awaitingStepKey и stepwiseApproval — опрос перестал требовать перечитывания ролика", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const video = await createVideo({
      status: "awaiting_operator",
      awaitingStepKey: "edit_plan",
      stepwiseApproval: true,
    })

    const res = await $fetch<{ data: Record<string, unknown> }>(
      `/api/videos/${video.id}/progress`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.awaitingStepKey).toBe("edit_plan")
    expect(res.data.stepwiseApproval).toBe(true)
  })

  it("оба поля присутствуют ключами и когда пусты — null это ответ, а не молчание", async () => {
    // `stepwiseApproval: null` — законное третье состояние («наследовать
    // профиль»), а не «поля нет». Пропусти сервер ключ — клиент не смог бы
    // отличить его от старой версии ручки и продолжил бы перечитывать ролик.
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const video = await createVideo({ status: "completed" })

    const res = await $fetch<{ data: Record<string, unknown> }>(
      `/api/videos/${video.id}/progress`,
      { headers: authHeaders(user.id) },
    )

    expect(Object.prototype.hasOwnProperty.call(res.data, "awaitingStepKey")).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(res.data, "stepwiseApproval")).toBe(true)
    expect(res.data.awaitingStepKey).toBeNull()
    expect(res.data.stepwiseApproval).toBeNull()
  })

  it("выключенный на ролике пошаговый режим отличается от ненастроенного", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const video = await createVideo({ stepwiseApproval: false })

    const res = await $fetch<{ data: Record<string, unknown> }>(
      `/api/videos/${video.id}/progress`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.stepwiseApproval).toBe(false)
  })
})

// ── GET /api/edit-profiles/:id ───────────────────────────────────────────────

describe("GET /api/edit-profiles/:id", () => {
  async function createProfile(appId: number | null, overrides: Record<string, unknown> = {}) {
    const seed = Math.floor(Math.random() * 1_000_000_000)
    return prisma.editProfile.create({ data: { appId, name: `Профиль ${seed}`, ...overrides } })
  }

  it("200: отдаёт РАЗРЕШЁННЫЕ значения, как и список (brollRatio:2 в БД -> 1 в ответе)", async () => {
    const app = await createTestApp()
    const user = await userWithAppAccess(app.id)
    const profile = await createProfile(app.id, { brollRatio: 2, shotChangeSec: 0.1, imageBudgetUsd: 1.5 })

    const res = await $fetch<{ data: Record<string, unknown> }>(
      `/api/edit-profiles/${profile.id}`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.id).toBe(profile.id)
    expect(res.data.appId).toBe(app.id)
    expect(res.data.brollRatio).toBe(1)
    expect(res.data.shotChangeSec).toBe(1.8)
    expect(res.data.imageBudgetUsd).toBe(1.5)
    expect(res.data.pipPosition).toBe("bottom_right")
  })

  it("400 на некорректный id профиля", async () => {
    const user = await createTestUser()
    expect(await statusOf(() => $fetch(`/api/edit-profiles/0`, { headers: authHeaders(user.id) })))
      .toBe(400)
  })

  it("404 на несуществующий профиль", async () => {
    const user = await createTestUser()
    expect(await statusOf(() => $fetch(`/api/edit-profiles/${MISSING_PROFILE_ID}`, {
      headers: authHeaders(user.id),
    }))).toBe(404)
  })

  it("401 без auth", async () => {
    const app = await createTestApp()
    const profile = await createProfile(app.id)
    expect(await statusOf(() => $fetch(`/api/edit-profiles/${profile.id}`))).toBe(401)
  })

  it("403 без права canRead", async () => {
    const app = await createTestApp()
    const profile = await createProfile(app.id)
    const user = await createTestUser({ canRead: false })
    expect(await statusOf(() => $fetch(`/api/edit-profiles/${profile.id}`, {
      headers: authHeaders(user.id),
    }))).toBe(403)
  })

  it("403 без доступа к модулю video-generator", async () => {
    const app = await createTestApp()
    const profile = await createProfile(app.id)
    const user = await userMissingModule(app.id)
    expect(await statusOf(() => $fetch(`/api/edit-profiles/${profile.id}`, {
      headers: authHeaders(user.id),
    }))).toBe(403)
  })

  it("админ читает профиль-шаблон без владельца (appId: null)", async () => {
    const user = await createTestUser({ canAdmin: true })
    const profile = await createProfile(null, { name: "Общий шаблон" })

    const res = await $fetch<{ data: Record<string, unknown> }>(
      `/api/edit-profiles/${profile.id}`,
      { headers: authHeaders(user.id) },
    )

    expect(res.data.id).toBe(profile.id)
    expect(res.data.appId).toBeNull()
  })

  it("код ответа не выдаёт существование ЧУЖОГО профиля: он неотличим от несуществующего", async () => {
    // Здесь оракул опаснее, чем у списка профилей: `appId` в адресе НЕТ, а
    // значит авторизоваться до чтения строки нечем. Единственный способ не
    // сдать факт существования — отвечать на «чужой» и «отсутствующий»
    // ОДИНАКОВО. Отдай ручка 403 на чужой и 404 на отсутствующий — перебор
    // `EditProfile.id` (последовательные целые) выдал бы карту профилей всех
    // арендаторов любому пользователю модуля.
    const app = await createTestApp()
    const outsiderApp = await createTestApp()
    const outsider = await userWithAppAccess(outsiderApp.id)
    const foreign = await createProfile(app.id)

    const headers = authHeaders(outsider.id)
    const foreignCode = await statusOf(() => $fetch(`/api/edit-profiles/${foreign.id}`, { headers }))
    const missingCode = await statusOf(() => $fetch(`/api/edit-profiles/${MISSING_PROFILE_ID}`, { headers }))

    expect(foreignCode).toBe(404)
    expect(missingCode).toBe(foreignCode)
  })

  it("код ответа не выдаёт существование ШАБЛОНА без прав администратора", async () => {
    // Профиль без владельца (`appId: null`) правится только админом (см. PUT),
    // и читаться он обязан по тому же правилу. Не-админ не должен по коду
    // ответа узнать, что шаблон с таким id вообще заведён.
    const app = await createTestApp()
    const user = await createTestUser({ canAdmin: false, appAssignments: [{ appId: app.id, accessLevel: "full" }] })
    const template = await createProfile(null, { name: "Общий шаблон" })

    const headers = authHeaders(user.id)
    const templateCode = await statusOf(() => $fetch(`/api/edit-profiles/${template.id}`, { headers }))
    const missingCode = await statusOf(() => $fetch(`/api/edit-profiles/${MISSING_PROFILE_ID}`, { headers }))

    expect(templateCode).toBe(404)
    expect(missingCode).toBe(templateCode)
  })

  it("код ответа не выдаёт существование профиля анониму и бесправному", async () => {
    const app = await createTestApp()
    const profile = await createProfile(app.id)

    const anonExisting = await statusOf(() => $fetch(`/api/edit-profiles/${profile.id}`))
    const anonMissing = await statusOf(() => $fetch(`/api/edit-profiles/${MISSING_PROFILE_ID}`))
    expect(anonExisting).toBe(401)
    expect(anonMissing).toBe(anonExisting)

    const stranger = await createTestUser({ canRead: false })
    const headers = authHeaders(stranger.id)
    const strangerExisting = await statusOf(() => $fetch(`/api/edit-profiles/${profile.id}`, { headers }))
    const strangerMissing = await statusOf(() => $fetch(`/api/edit-profiles/${MISSING_PROFILE_ID}`, { headers }))
    expect(strangerExisting).toBe(403)
    expect(strangerMissing).toBe(strangerExisting)
  })
})
