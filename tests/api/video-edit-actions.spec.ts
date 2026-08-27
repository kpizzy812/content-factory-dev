/**
 * Контрактные тесты трёх ручек правки готового ролика, появившихся 27.08.2026:
 *
 *   POST /api/videos/:id/approve-step                — решение оператора в пошаговом режиме
 *   POST /api/videos/:id/voiceover/replace-segment   — локальная замена одной фразы
 *   POST /api/videos/:id/voiceover/regenerate-track  — полная перегенерация трека
 *
 * ЧТО ИМЕННО ЗДЕСЬ ПРОВЕРЯЕТСЯ. Содержательные правила этих операций живут в
 * чистых функциях и накрыты сьютой без стенда: `planReplaceSegmentRequest` и
 * `planTrackRegeneration` — в `tests/unit/voiceover/*`, `applyStepwiseApproval`
 * — в `tests/integration/stepwise-approval.spec.ts`. Дублировать их через HTTP
 * значило бы платить четырьмя минутами подъёма Nuxt за то, что уже проверено за
 * секунду. Поэтому здесь ровно то, чего без HTTP не проверить:
 *
 *   1. КОДЫ ОТВЕТОВ. Что решение чистой функции доезжает до клиента тем самым
 *      кодом (400/401/403/404/409), а не превращается в 500 по дороге.
 *   2. ПРАВА. `requireScopedAccess` стоит ПЕРВЫМ и реально отбивает запрос: без
 *      явных override'ов `createTestUser` выдаёт все права, и «проверка прав»
 *      без них не проверяла бы ничего.
 *   3. ОТКАЗ НИЧЕГО НЕ ДЕЛАЕТ. Ролик остаётся в прежнем статусе, файл на месте,
 *      и — главное — прогон НЕ запущен: все три ручки на успехе дёргают
 *      `runVideoPipeline` fire-and-forget, то есть отказ, проскочивший гейт,
 *      стоил бы денег молча. Признак запуска — появившиеся строки
 *      `VideoGenerationStep`: до первого прогона их у ролика нет вовсе.
 *   4. КОД ОТВЕТА НЕ ВЫДАЁТ СУЩЕСТВОВАНИЕ РОЛИКА постороннему. Приём взят из
 *      `tests/api/edit-plan-endpoints.spec.ts` (§«Оракул существования
 *      приложения»): сравнивается РАВЕНСТВО кодов на существующем и
 *      несуществующем id, а не «401 где-то есть». `Video.id` —
 *      последовательные целые, то есть перебором это карта чужих роликов.
 *
 * ПЛАТНЫХ ВЫЗОВОВ ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ. Ни один кейс не доходит до
 * провайдера: успешные пути этих ручек (синтез фразы, пересинтез трека,
 * продолжение прогона) не вызываются вовсе — проверяются только отказы и
 * безопасный повторный заход, который по замыслу ручки ничего не запускает.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

// ── Общие помощники ─────────────────────────────────────────────────────────

/** Заведомо свободный id: `TRUNCATE ... RESTART IDENTITY` в tests/setup.ts возвращает счётчики к 1. */
const MISSING_VIDEO_ID = 999_999_999

/** Код ответа вместо исключения — иначе пары «существует/нет» не сравнить. */
async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run()
    return 200
  }
  catch (error) {
    return (error as { statusCode?: number }).statusCode ?? 0
  }
}

/** Тело ошибки целиком: у `regenerate-track` в нём едут числа сметы. */
async function errorBodyOf(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run()
    throw new Error("Ожидался отказ, но запрос прошёл")
  }
  catch (error) {
    return ((error as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>
  }
}

async function createVideo(overrides: Record<string, unknown> = {}) {
  const scenario = await prisma.scenario.create({ data: { status: "draft" } })
  return prisma.video.create({
    data: {
      scenarioId: scenario.id,
      status: "completed",
      editPipeline: true,
      filePath: "videos/contract-fixture.mp4",
      fileUrl: "videos/contract-fixture.mp4",
      ...overrides,
    },
  })
}

/**
 * Пользователь с правом, но БЕЗ admin: иначе `requireScopedAccess` выходит по
 * `if (user.canAdmin) return user` и проверка модуля не выполняется вовсе.
 */
function operator() {
  return createTestUser({ canAdmin: false })
}

/** Право `canRunAgent` снято. Проверка прав идёт ДО admin-шортката, поэтому отбивает и админа. */
function userMissingRunAgent() {
  return createTestUser({ canRunAgent: false })
}

/** Право есть, модуля `video-generator` нет. Без `canAdmin:false` шорткат съел бы проверку. */
function userMissingModule() {
  return createTestUser({ canAdmin: false, moduleAccess: ["script-generator"] })
}

/**
 * Признак того, что прогон стартовал: `runVideoPipeline` заводит строки шагов.
 * У свежесозданного фикстурного ролика их ноль, поэтому ноль после отказа —
 * доказательство, что fire-and-forget не дёрнулся.
 */
async function stepCount(videoId: number): Promise<number> {
  return prisma.videoGenerationStep.count({ where: { videoId } })
}

/** Снимок полей, которые обязан не трогать любой отказ. */
async function videoState(videoId: number) {
  const row = await prisma.video.findUniqueOrThrow({
    where: { id: videoId },
    select: { status: true, filePath: true, awaitingStepKey: true, approvedStepKey: true },
  })
  return { ...row, status: String(row.status) }
}

// ── POST /api/videos/:id/approve-step ────────────────────────────────────────

describe("POST /api/videos/:id/approve-step", () => {
  /** Ролик, остановленный пошаговым режимом: ровно то состояние, в котором ручка осмысленна. */
  async function awaitingVideo(overrides: Record<string, unknown> = {}) {
    return createVideo({
      status: "awaiting_operator",
      awaitingStepKey: "voiceover_generation",
      ...overrides,
    })
  }

  function approve(id: number | string, headers?: Record<string, string>, body: unknown = { action: "approve" }) {
    return $fetch(`/api/videos/${id}/approve-step`, {
      method: "POST",
      ...(headers ? { headers } : {}),
      body,
    })
  }

  it("401 без auth — решение не записано, прогон не запущен", async () => {
    const video = await awaitingVideo()

    expect(await statusOf(() => approve(video.id))).toBe(401)

    const state = await videoState(video.id)
    expect(state.status).toBe("awaiting_operator")
    expect(state.awaitingStepKey).toBe("voiceover_generation")
    expect(state.approvedStepKey).toBeNull()
    expect(await stepCount(video.id)).toBe(0)
  })

  it("код ответа не выдаёт существование ролика: аноним видит одно и то же на существующем и несуществующем id", async () => {
    const video = await awaitingVideo()

    const existing = await statusOf(() => approve(video.id))
    const missing = await statusOf(() => approve(MISSING_VIDEO_ID))

    expect(existing).toBe(401)
    expect(missing).toBe(existing)
  })

  it("403 без права canRunAgent — ролик остаётся ждать решения", async () => {
    const user = await userMissingRunAgent()
    const video = await awaitingVideo()

    expect(await statusOf(() => approve(video.id, authHeaders(user.id)))).toBe(403)

    expect((await videoState(video.id)).status).toBe("awaiting_operator")
    expect(await stepCount(video.id)).toBe(0)
  })

  it("403 без доступа к модулю video-generator (право на месте)", async () => {
    const user = await userMissingModule()
    const video = await awaitingVideo()

    expect(await statusOf(() => approve(video.id, authHeaders(user.id)))).toBe(403)

    expect((await videoState(video.id)).status).toBe("awaiting_operator")
    expect(await stepCount(video.id)).toBe(0)
  })

  it("400 на некорректный ID видео", async () => {
    const user = await operator()
    expect(await statusOf(() => approve(0, authHeaders(user.id)))).toBe(400)
    expect(await statusOf(() => approve("abc", authHeaders(user.id)))).toBe(400)
  })

  it("400 на неизвестное действие — решение не записано", async () => {
    // Намеренно заведомо бессмысленная строка, а не «третье действие»: список
    // действий расширяется (например «отклонить»), и тест не должен краснеть от
    // законного пополнения списка — он про разбор входа, а не про его состав.
    const user = await operator()
    const video = await awaitingVideo()

    expect(await statusOf(() => approve(video.id, authHeaders(user.id), { action: "стереть-всё" }))).toBe(400)

    const state = await videoState(video.id)
    expect(state.status).toBe("awaiting_operator")
    expect(state.approvedStepKey).toBeNull()
    expect(await stepCount(video.id)).toBe(0)
  })

  it("404 на несуществующий ролик", async () => {
    const user = await operator()
    expect(await statusOf(() => approve(MISSING_VIDEO_ID, authHeaders(user.id)))).toBe(404)
  })

  it("409 если ролик решения не ждёт — принимать нечего, прогон не стартует", async () => {
    // 409, а не 400: это состояние ролика, а не кривой запрос. Разница
    // осмысленная — по 400 оператор чинил бы форму, по 409 обновил бы экран.
    const user = await operator()
    const video = await createVideo({ status: "completed" })

    expect(await statusOf(() => approve(video.id, authHeaders(user.id)))).toBe(409)

    const state = await videoState(video.id)
    expect(state.status).toBe("completed")
    expect(state.approvedStepKey).toBeNull()
    expect(await stepCount(video.id)).toBe(0)
  })

  it("409 если ролик стоит в ожидании без указанного шага — принимать вслепую нельзя", async () => {
    const user = await operator()
    const video = await createVideo({ status: "awaiting_operator", awaitingStepKey: null })

    expect(await statusOf(() => approve(video.id, authHeaders(user.id)))).toBe(409)

    const state = await videoState(video.id)
    expect(state.status).toBe("awaiting_operator")
    expect(state.approvedStepKey).toBeNull()
    expect(await stepCount(video.id)).toBe(0)
  })
})

// ── POST /api/videos/:id/voiceover/replace-segment ───────────────────────────

describe("POST /api/videos/:id/voiceover/replace-segment", () => {
  /** Полное валидное тело: нужно там, где проверяется НЕ разбор тела, а состояние ролика. */
  const VALID_BODY = { sceneOrder: 1, newText: "Новая фраза для второй сцены." }

  function replace(id: number | string, headers?: Record<string, string>, body: unknown = VALID_BODY) {
    return $fetch(`/api/videos/${id}/voiceover/replace-segment`, {
      method: "POST",
      ...(headers ? { headers } : {}),
      body,
    })
  }

  it("401 без auth — трек не тронут, прогон не запущен", async () => {
    const video = await createVideo()

    expect(await statusOf(() => replace(video.id))).toBe(401)

    const state = await videoState(video.id)
    expect(state.status).toBe("completed")
    expect(state.filePath).toBe("videos/contract-fixture.mp4")
    expect(await stepCount(video.id)).toBe(0)
  })

  it("код ответа не выдаёт существование ролика: аноним видит одно и то же на существующем и несуществующем id", async () => {
    const video = await createVideo()

    const existing = await statusOf(() => replace(video.id))
    const missing = await statusOf(() => replace(MISSING_VIDEO_ID))

    expect(existing).toBe(401)
    expect(missing).toBe(existing)
  })

  it("403 без права canRunAgent — ролик не тронут", async () => {
    const user = await userMissingRunAgent()
    const video = await createVideo()

    expect(await statusOf(() => replace(video.id, authHeaders(user.id)))).toBe(403)

    expect((await videoState(video.id)).status).toBe("completed")
    expect(await stepCount(video.id)).toBe(0)
  })

  it("403 без доступа к модулю video-generator", async () => {
    const user = await userMissingModule()
    const video = await createVideo()

    expect(await statusOf(() => replace(video.id, authHeaders(user.id)))).toBe(403)
    expect(await stepCount(video.id)).toBe(0)
  })

  it("400 без sceneOrder", async () => {
    const user = await operator()
    const video = await createVideo()

    expect(await statusOf(() => replace(video.id, authHeaders(user.id), { newText: "Текст без сцены" }))).toBe(400)
    expect(await stepCount(video.id)).toBe(0)
  })

  it("400 на нулевой и дробный sceneOrder — номер сцены целый и с единицы", async () => {
    const user = await operator()
    const video = await createVideo()
    const headers = authHeaders(user.id)

    expect(await statusOf(() => replace(video.id, headers, { ...VALID_BODY, sceneOrder: 0 }))).toBe(400)
    expect(await statusOf(() => replace(video.id, headers, { ...VALID_BODY, sceneOrder: 1.5 }))).toBe(400)
  })

  it("400 на пустой newText — синтезировать нечего", async () => {
    const user = await operator()
    const video = await createVideo()
    const headers = authHeaders(user.id)

    expect(await statusOf(() => replace(video.id, headers, { sceneOrder: 1, newText: "   " }))).toBe(400)
    expect(await statusOf(() => replace(video.id, headers, { sceneOrder: 1 }))).toBe(400)
    expect(await stepCount(video.id)).toBe(0)
  })

  it("404 на несуществующий ролик — но только при ВАЛИДНОМ теле: разбор входа идёт первым", async () => {
    // Порядок гейтов зафиксирован намеренно: кривое тело — 400 независимо от
    // того, существует ли ролик. Иначе код ответа на мусорный запрос отличал бы
    // существующий id от несуществующего, то есть был бы оракулом.
    const user = await operator()
    const headers = authHeaders(user.id)

    expect(await statusOf(() => replace(MISSING_VIDEO_ID, headers))).toBe(404)
    expect(await statusOf(() => replace(MISSING_VIDEO_ID, headers, { newText: "без сцены" }))).toBe(400)
  })

  it("409 на заблокированном ролике — идёт другая операция, трек трогать нельзя", async () => {
    const user = await operator()
    const video = await createVideo({ isLocked: true })

    expect(await statusOf(() => replace(video.id, authHeaders(user.id)))).toBe(409)

    const state = await videoState(video.id)
    expect(state.status).toBe("completed")
    expect(await stepCount(video.id)).toBe(0)
  })

  it("400 в рабочем статусе — правка не вклинивается в идущий прогон", async () => {
    const user = await operator()
    const video = await createVideo({ status: "assembling" })

    expect(await statusOf(() => replace(video.id, authHeaders(user.id)))).toBe(400)

    expect((await videoState(video.id)).status).toBe("assembling")
    expect(await stepCount(video.id)).toBe(0)
  })

  it("400 когда ролик не собирали от звука — отказ раннера доезжает как 400, а не как 500", async () => {
    // Гейт маршрута: единого трека нет, вклеивать некуда. Важно, что отказ
    // случается ДО обращения к TTS — синтез фразы стоит денег, и падать он
    // обязан на проверке, а не на счёте.
    const user = await operator()
    const video = await createVideo({ status: "completed" })

    expect(await statusOf(() => replace(video.id, authHeaders(user.id)))).toBe(400)

    const state = await videoState(video.id)
    expect(state.status).toBe("completed")
    expect(state.filePath).toBe("videos/contract-fixture.mp4")
    expect(await stepCount(video.id)).toBe(0)
  })
})

// ── POST /api/videos/:id/voiceover/regenerate-track ──────────────────────────

describe("POST /api/videos/:id/voiceover/regenerate-track", () => {
  function regenerate(id: number | string, headers?: Record<string, string>, body: unknown = {}) {
    return $fetch(`/api/videos/${id}/voiceover/regenerate-track`, {
      method: "POST",
      ...(headers ? { headers } : {}),
      body,
    })
  }

  /**
   * Ролик на маршруте «монтаж от звука»: снапшот шага озвучки с треком плюс
   * сценарий. Без них план отказывает раньше, чем дойдёт до подтверждения
   * суммы, и окно подтверждения не проверялось бы вовсе.
   */
  async function audioFirstVideo(stepStatus: "completed" | "running" = "completed") {
    const scenario = await prisma.scenario.create({ data: { status: "draft" } })
    const variant = await prisma.scenarioVariant.create({
      data: {
        scenarioId: scenario.id,
        variantIndex: 0,
        status: "accepted",
        title: "Контрактный вариант",
        hook: "Крючок",
        body: "Тело",
        cta: "Призыв",
        fullScript: "Полный текст",
        visualStyleText: "Вертикально, ярко",
        storyPlan: {
          scenes: [
            { order: 1, spokenLine: "Первая фраза ролика." },
            { order: 2, spokenLine: "Вторая фраза ролика." },
          ],
        },
      },
    })
    const video = await prisma.video.create({
      data: {
        scenarioId: scenario.id,
        variantId: variant.id,
        status: "completed",
        editPipeline: true,
        filePath: "videos/contract-fixture.mp4",
        fileUrl: "videos/contract-fixture.mp4",
        voiceoverModelId: "minimax/speech-02-turbo",
        voiceoverVoiceId: "voice-контракт",
      },
    })
    await prisma.videoGenerationStep.create({
      data: {
        videoId: video.id,
        stepKey: "voiceover_generation",
        stepIndex: 3,
        status: stepStatus,
        outputSnapshot: {
          route: "audio_first",
          trackPath: "storage/tracks/contract.mp3",
          durationSec: 12,
          voiceId: "voice-контракт",
          modelId: "minimax/speech-02-turbo",
          // Текст трека НАМЕРЕННО расходится со сценарием: иначе план ушёл бы в
          // «пересинтезировать нечего» ещё до окна подтверждения суммы.
          scenes: [
            { order: 1, text: "Старая первая фраза." },
            { order: 2, text: "Старая вторая фраза." },
          ],
        },
      },
    })
    return video
  }

  it("401 без auth — трек не тронут", async () => {
    const video = await createVideo()

    expect(await statusOf(() => regenerate(video.id))).toBe(401)

    expect((await videoState(video.id)).status).toBe("completed")
    expect(await stepCount(video.id)).toBe(0)
  })

  it("код ответа не выдаёт существование ролика: аноним видит одно и то же на существующем и несуществующем id", async () => {
    const video = await createVideo()

    const existing = await statusOf(() => regenerate(video.id))
    const missing = await statusOf(() => regenerate(MISSING_VIDEO_ID))

    expect(existing).toBe(401)
    expect(missing).toBe(existing)
  })

  it("403 без права canRunAgent — самая дорогая кнопка озвучки закрыта", async () => {
    const user = await userMissingRunAgent()
    const video = await audioFirstVideo()

    expect(await statusOf(() => regenerate(video.id, authHeaders(user.id), { confirmExpensive: true }))).toBe(403)

    // Шаг остался completed: каскад сброса `rerunVideoStep` не отработал.
    const step = await prisma.videoGenerationStep.findFirstOrThrow({ where: { videoId: video.id } })
    expect(String(step.status)).toBe("completed")
    expect((await videoState(video.id)).status).toBe("completed")
  })

  it("403 без доступа к модулю video-generator", async () => {
    const user = await userMissingModule()
    const video = await audioFirstVideo()

    expect(await statusOf(() => regenerate(video.id, authHeaders(user.id), { confirmExpensive: true }))).toBe(403)

    const step = await prisma.videoGenerationStep.findFirstOrThrow({ where: { videoId: video.id } })
    expect(String(step.status)).toBe("completed")
  })

  it("400 на некорректный ID видео", async () => {
    const user = await operator()
    expect(await statusOf(() => regenerate(0, authHeaders(user.id)))).toBe(400)
    expect(await statusOf(() => regenerate("abc", authHeaders(user.id)))).toBe(400)
  })

  it("404 на несуществующий ролик", async () => {
    const user = await operator()
    expect(await statusOf(() => regenerate(MISSING_VIDEO_ID, authHeaders(user.id)))).toBe(404)
  })

  it("409 на заблокированном ролике", async () => {
    const user = await operator()
    const video = await createVideo({ isLocked: true })

    expect(await statusOf(() => regenerate(video.id, authHeaders(user.id), { confirmExpensive: true }))).toBe(409)
    expect((await videoState(video.id)).status).toBe("completed")
  })

  it("400 в рабочем статусе — перегенерация не вклинивается в идущий прогон", async () => {
    const user = await operator()
    const video = await createVideo({ status: "assembling" })

    expect(await statusOf(() => regenerate(video.id, authHeaders(user.id), { confirmExpensive: true }))).toBe(400)
    expect((await videoState(video.id)).status).toBe("assembling")
  })

  it("400 когда ролик не собирали от звука — единого трека нет", async () => {
    const user = await operator()
    const video = await createVideo({ status: "completed" })

    expect(await statusOf(() => regenerate(video.id, authHeaders(user.id), { confirmExpensive: true }))).toBe(400)
    expect(await stepCount(video.id)).toBe(0)
  })

  it("400 без confirmExpensive — отказ приходит С ЧИСЛАМИ сметы и ничего не сбрасывает", async () => {
    // Молчаливого пути к самой дорогой кнопке нет: без подписи под суммой ручка
    // обязана вернуть не просто отказ, а цифры, по которым оператор принимает
    // решение. Смета в ответе — часть контракта, а не украшение.
    const user = await operator()
    const video = await audioFirstVideo()

    const body = await errorBodyOf(() => regenerate(video.id, authHeaders(user.id), {}))
    expect(body.statusCode).toBe(400)

    const preview = (body.data as { preview?: Record<string, unknown> } | undefined)?.preview
    expect(preview, "смета обязана ехать в теле отказа").toBeDefined()
    expect(preview!.sceneCount).toBe(2)
    expect(typeof preview!.estimatedCostUsd).toBe("number")
    expect(preview!.changedSceneOrders).toEqual([1, 2])

    // Шаг озвучки не сброшен, ролик не отправлен в очередь.
    const step = await prisma.videoGenerationStep.findFirstOrThrow({ where: { videoId: video.id } })
    expect(String(step.status)).toBe("completed")
    const state = await videoState(video.id)
    expect(state.status).toBe("completed")
    expect(state.filePath).toBe("videos/contract-fixture.mp4")
  })

  it("200 с regenerated:false, пока шаг озвучки в работе — второй клик не платит второй раз", async () => {
    // Это НЕ ошибка и не 500: повторный заход обязан быть безопасным и внятным.
    // Проверяется, что «уже идёт» не роняет живой прогон сбросом шага.
    const user = await operator()
    const video = await audioFirstVideo("running")

    const res = await $fetch<{ data: { regenerated: boolean, reason?: string } }>(
      `/api/videos/${video.id}/voiceover/regenerate-track`,
      { method: "POST", headers: authHeaders(user.id), body: { confirmExpensive: true } },
    )

    expect(res.data.regenerated).toBe(false)
    expect(res.data.reason).toBeTruthy()

    const step = await prisma.videoGenerationStep.findFirstOrThrow({ where: { videoId: video.id } })
    expect(String(step.status)).toBe("running")
    expect((await videoState(video.id)).status).toBe("completed")
  })
})
