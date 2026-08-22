import { beforeEach, describe, expect, it, vi } from "vitest"

import { prisma } from "~~/server/utils/prisma"
import { StorageKeys } from "~~/server/utils/storage/keys"
import { runVideoEditPlan, type VideoEditPlanInput } from "~~/server/utils/video-pipeline-steps"
import { resetEditPlanShots } from "~~/server/utils/video-pipeline"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import type { EditPlanModelShot } from "~~/server/utils/edit-plan/runner"

// `logAgent` — авто-импорт Nitro (как `prisma`, но prisma.ts сам себя кладёт в
// globalThis в не-production, а agent-logger.ts — нет). video-pipeline.ts
// ссылается на него как на глобал; вне Nitro-процесса тест обязан подставить
// его сам, иначе `resetEditPlanShots`/`runVideoEditPlan` падают
// `ReferenceError: logAgent is not defined` при первом же логе.
import { logAgent } from "~~/server/utils/agent-logger"
;(globalThis as Record<string, unknown>).logAgent = logAgent

// beforeEach, не beforeAll: tests/setup.ts делает TRUNCATE всех таблиц public
// в afterEach ПОСЛЕ каждого it (см. presenter-recording.spec.ts) — данные из
// beforeAll не пережили бы даже первый тест. Каждый it ниже поэтому
// самодостаточен: то, что ему нужно от App/Video, он получает заново.
let appId: number
let videoId: number

beforeEach(async () => {
  const app = await prisma.app.create({ data: { name: "edit-plan-test" } })
  appId = app.id
  const scenario = await prisma.scenario.create({ data: { status: "draft" } })
  const video = await prisma.video.create({ data: { scenarioId: scenario.id, editPipeline: true } })
  videoId = video.id
})

describe("схема монтажа", () => {
  it("хранит профиль с правилами и версией модели", async () => {
    const profile = await prisma.editProfile.create({
      data: {
        appId,
        name: "Reforma / базовый",
        editPrompt: "Чередуй крупный и средний план ведущей каждые 5 секунд.",
        llmModelId: "claude-sonnet-4-6",
      },
    })

    // Правила и версия модели — то, что обещает название теста, а не только дефолты.
    expect(profile.editPrompt).toBe("Чередуй крупный и средний план ведущей каждые 5 секунд.")
    expect(profile.llmModelId).toBe("claude-sonnet-4-6")

    // Дефолты — решения от 14.08 и §5.2 спеки, а не вкус исполнителя.
    expect(profile.brollRatio).toBeCloseTo(0.4, 6)
    expect(profile.shotChangeSec).toBeCloseTo(1.8, 6)
    expect(profile.generativeVideoEnabled).toBe(false)
    expect(profile.stepwiseApproval).toBe(false)
    expect(profile.pipPosition).toBe("bottom_right")
    expect(profile.pipSize).toBeCloseTo(0.28, 6)
    expect(profile.generativeVideoBudgetUsd).toBeCloseTo(0.5, 6)
    // Формат Kling (потребитель поля — генеративный фон кадра), не аватарной
    // speech_to_video модели: см. фикс-раунд 2 ревью Task 2.
    expect(profile.generativeVideoResolution).toBe("1080x1920")
  })

  it("ролик наследует профиль и может перебить его полем", async () => {
    const profile = await prisma.editProfile.create({
      data: { appId, name: "Reforma / базовый" },
    })

    const updated = await prisma.video.update({
      where: { id: videoId },
      data: { editProfileId: profile.id, editOverrides: { pipEnabled: true } },
    })

    expect(updated.editProfileId).toBe(profile.id)
    expect(updated.editOverrides).toMatchObject({ pipEnabled: true })
  })

  it("дедуплицирует фон по sha1 в пределах приложения", async () => {
    await prisma.backgroundClip.create({
      data: {
        appId,
        name: "Запись экрана: лид-магнит",
        storageKey: StorageKeys.backgroundClip(appId, "aaaa1111"),
        sha1: "aaaa1111",
        kind: "screen_recording",
        durationSec: 8.4,
      },
    })

    // P2002, а не просто throw: следующая задача может добавить обязательную
    // колонку без дефолта — тогда create упадёт на валидации входа, а не на
    // @@unique([appId, sha1]), и тест останется зелёным по неверной причине.
    await expect(prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: "другой ключ",
        sha1: "aaaa1111",
        kind: "screen_recording",
      },
    })).rejects.toMatchObject({ code: "P2002" })
  })

  it("хранит кадр ролика отдельной строкой", async () => {
    const background = await prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: StorageKeys.backgroundClip(appId, "bbbb2222"),
        sha1: "bbbb2222",
        kind: "screen_recording",
      },
    })

    const shot = await prisma.videoShot.create({
      data: {
        videoId,
        order: 0,
        startSec: 0,
        endSec: 1.8,
        sceneOrder: 1,
        foreground: "presenter",
        background: "library",
        backgroundClipId: background.id,
        idea: "Ведущая в кадре, фоном запись экрана",
      },
    })

    expect(shot.status).toBe("planned")
    expect(shot.pipEnabled).toBe(false)
    // Пара (ролик, порядок) уникальна: два кадра на одну позицию — это дыра
    // либо нахлёст в таймлайне.
    await expect(prisma.videoShot.create({
      data: { videoId, order: 0, startSec: 1.8, endSec: 3.6, foreground: "none", background: "none" },
    })).rejects.toMatchObject({ code: "P2002" })
  })

  it("удаление фона не уносит кадры, которые его использовали", async () => {
    const background = await prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: StorageKeys.backgroundClip(appId, "cccc3333"),
        sha1: "cccc3333",
        kind: "screen_recording",
      },
    })
    const shot = await prisma.videoShot.create({
      data: {
        videoId,
        order: 0,
        startSec: 0,
        endSec: 1.8,
        foreground: "presenter",
        background: "library",
        backgroundClipId: background.id,
      },
    })

    await prisma.backgroundClip.delete({ where: { id: background.id } })

    const reloaded = await prisma.videoShot.findUnique({ where: { id: shot.id } })
    // Кадр уже отрендерен и уехал в готовый ролик — снести его вместе с
    // исходником значит переписать историю.
    expect(reloaded).not.toBeNull()
    expect(reloaded!.backgroundClipId).toBeNull()
  })

  it("удаление ролика уносит его кадры", async () => {
    await prisma.videoShot.create({
      data: { videoId, order: 0, startSec: 0, endSec: 2, foreground: "none", background: "none" },
    })

    await prisma.video.delete({ where: { id: videoId } })

    expect(await prisma.videoShot.count({ where: { videoId } })).toBe(0)
  })

  it("удаление приложения не уносит монтажный профиль — обнуляет appId", async () => {
    const profile = await prisma.editProfile.create({
      data: { appId, name: "Reforma / базовый" },
    })

    await prisma.app.delete({ where: { id: appId } })

    const reloaded = await prisma.editProfile.findUnique({ where: { id: profile.id } })
    expect(reloaded).not.toBeNull()
    expect(reloaded!.appId).toBeNull()
  })

  it("удаление приложения уносит фоны, но не кадры, которые их использовали", async () => {
    const background = await prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: StorageKeys.backgroundClip(appId, "dddd4444"),
        sha1: "dddd4444",
        kind: "screen_recording",
      },
    })
    const shot = await prisma.videoShot.create({
      data: {
        videoId,
        order: 0,
        startSec: 0,
        endSec: 1.8,
        foreground: "presenter",
        background: "library",
        backgroundClipId: background.id,
      },
    })

    await prisma.app.delete({ where: { id: appId } })

    // Библиотека фонов принадлежит приложению целиком — удаление приложения
    // уносит её каскадом.
    expect(await prisma.backgroundClip.findUnique({ where: { id: background.id } })).toBeNull()
    // А кадр, который фон уже использовал, выживает с backgroundClipId = null —
    // тот же принцип, что и при прямом удалении одного фона.
    const reloadedShot = await prisma.videoShot.findUnique({ where: { id: shot.id } })
    expect(reloadedShot).not.toBeNull()
    expect(reloadedShot!.backgroundClipId).toBeNull()
  })

  it("удаление монтажного профиля не уносит ролик — обнуляет editProfileId", async () => {
    const profile = await prisma.editProfile.create({
      data: { appId, name: "Reforma / базовый" },
    })
    await prisma.video.update({ where: { id: videoId }, data: { editProfileId: profile.id } })

    await prisma.editProfile.delete({ where: { id: profile.id } })

    const reloaded = await prisma.video.findUnique({ where: { id: videoId } })
    expect(reloaded).not.toBeNull()
    expect(reloaded!.editProfileId).toBeNull()
  })

  it("удаление скрина приложения не уносит кадр, который его использовал", async () => {
    const reference = await prisma.appReferenceImage.create({
      data: {
        appId,
        fileUrl: `https://example.test/api/files/app-references/${appId}/eeee5555.png`,
        sha1: "eeee5555",
      },
    })
    const shot = await prisma.videoShot.create({
      data: {
        videoId,
        order: 0,
        startSec: 0,
        endSec: 1.8,
        foreground: "presenter",
        background: "app_screen",
        appReferenceId: reference.id,
      },
    })

    await prisma.appReferenceImage.delete({ where: { id: reference.id } })

    // Тот же принцип, что и у backgroundClipId: у скрина свой жизненный цикл,
    // отрендеренный кадр его не должен терять при удалении исходника.
    const reloaded = await prisma.videoShot.findUnique({ where: { id: shot.id } })
    expect(reloaded).not.toBeNull()
    expect(reloaded!.appReferenceId).toBeNull()
  })
})

/**
 * Идемпотентность и перезапуск шага `edit_plan` (Task 5, требование 6).
 *
 * `runVideoEditPlan` вызывается напрямую с подменённым `askModel` (реальный
 * агент требует Anthropic API/ANTHROPIC_MOCK_MODE — содержательная работа
 * агента и раннера уже покрыта `tests/unit/edit-plan/runner.spec.ts`, здесь
 * проверяется ТОЛЬКО DB-обвязка: кэш по отпечатку трека, `saveShots`,
 * `logStepCost`). `rerunVideoStep` целиком сюда не зовём: в конце он без
 * ожидания запускает `runVideoPipeline`, и в лёгком DB-тесте это гонка с
 * `afterEach`, чистящим таблицы, — каскад для кадров вынесен отдельной
 * функцией `resetEditPlanShots` ровно ради того, чтобы проверить его отдельно.
 */
describe("шаг edit_plan: идемпотентность и перезапуск", () => {
  /** Одна presenter-сцена с безопасной межсловной щелью [1.8, 2.0] — не рвёт слово при нарезке кадров. */
  function baseInput(overrides: Partial<VideoEditPlanInput> = {}): VideoEditPlanInput {
    return {
      videoId,
      trackFingerprint: "fp-1",
      trackDurationSec: 4,
      fps: 30,
      alignedScenes: [{
        order: 1,
        startSec: 0,
        endSec: 4,
        words: [
          { text: "первое", startSec: 0, endSec: 1.8, matched: true },
          { text: "второе", startSec: 2.0, endSec: 4.0, matched: true },
        ],
      }],
      presenterSceneOrders: [1],
      profile: { ...DEFAULT_EDIT_PROFILE },
      lipSyncMaxDurationSec: 10,
      format: "portrait",
      renderQuality: "medium",
      backgrounds: [],
      appScreens: [],
      ...overrides,
    }
  }

  function happyAskModel() {
    return vi.fn(async (grid: Array<{ order: number }>): Promise<{ shots: EditPlanModelShot[] }> => ({
      shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image", idea: "фон" })),
    }))
  }

  it("повторный прогон не создаёт вторых кадров и не платит второй раз", async () => {
    const askModel = happyAskModel()

    const first = await runVideoEditPlan(baseInput(), { askModel })
    expect(askModel).toHaveBeenCalledTimes(1)
    expect(first.costUsd).toBeGreaterThan(0)

    const shotsAfterFirst = await prisma.videoShot.findMany({ where: { videoId } })
    expect(shotsAfterFirst.length).toBeGreaterThan(0)
    expect(await prisma.aiAuditLog.count({ where: { videoId, stepKey: "edit_plan" } })).toBe(1)

    const second = await runVideoEditPlan(baseInput(), { askModel })

    // Кэш по отпечатку трека + профилю + числу сцен: модель не спрошена
    // второй раз, деньги не списаны второй раз.
    expect(askModel).toHaveBeenCalledTimes(1)
    expect(second.costUsd).toBe(0)
    expect(await prisma.aiAuditLog.count({ where: { videoId, stepKey: "edit_plan" } })).toBe(1)

    // Те же строки, а не пересозданные с новыми id.
    const shotsAfterSecond = await prisma.videoShot.findMany({ where: { videoId } })
    expect(shotsAfterSecond.map(s => s.id).sort()).toEqual(shotsAfterFirst.map(s => s.id).sort())
  })

  it("ledger получает плоскую оценку цены вызова агента, а не смету фонов по плану (Critical 1 ре-ревью задачи)", async () => {
    // Раньше в ledger уходила Σ VideoShot.costUsd (смета БУДУЩИХ картинок/видео
    // по плану) под сервисом "anthropic" — план без единого платного фона терял
    // реально оплаченный вызов модели из учёта целиком.
    //
    // Сцена нарочно даёт РОВНО 3 кадра (а не 2, как в `baseInput()`) — со
    // стандартными 2 кадрами 2×$0.025 = $0.05 численно СОВПАДАЕТ с плоской
    // оценкой одного вызова модели, и мутация «положить в ledger
    // plannedMediaCostUsd вместо агентской оценки» на 2-кадровом плане молча
    // проходит тест (числа случайно равны). Обнаружено самой этой мутацией.
    const askModel = happyAskModel()
    const threeShotInput = baseInput({
      trackDurationSec: 6,
      alignedScenes: [{
        order: 1,
        startSec: 0,
        endSec: 6,
        words: [
          { text: "первое", startSec: 0, endSec: 1.8, matched: true },
          { text: "второе", startSec: 2.0, endSec: 3.8, matched: true },
          { text: "третье", startSec: 4.0, endSec: 6.0, matched: true },
        ],
      }],
    })

    const result = await runVideoEditPlan(threeShotInput, { askModel })

    const shots = await prisma.videoShot.findMany({ where: { videoId } })
    expect(shots.length).toBe(3)

    // Ledger-цена — плоская оценка ОДНОГО вызова модели (см. отчёт, п.
    // EDIT_PLAN_MODEL_CALL_ESTIMATE_USD), а не сумма стоимостей кадров
    // (3 × $0.025 = $0.075 — заведомо другое число).
    expect(result.costUsd).toBeCloseTo(0.05, 6)
    const ledgerRow = await prisma.aiAuditLog.findFirst({ where: { videoId, stepKey: "edit_plan" } })
    expect(ledgerRow).not.toBeNull()
    expect(Number(ledgerRow!.costUsd)).toBeCloseTo(0.05, 6)

    // Прогнозная смета фонов — ОТДЕЛЬНОЕ число (happyAskModel просит "image"
    // на каждый кадр, $0.025/кадр), в ledger не попадает вовсе.
    expect(result.plannedMediaCostUsd).toBeCloseTo(0.075, 6)
    expect(result.plannedMediaCostUsd).not.toBeCloseTo(result.costUsd, 6)
  })

  it("ремонт не сходится после двух попыток — обе оплаченные попытки всё равно списаны в ledger (Critical 1 ре-ревью задачи, п.1)", async () => {
    // Presenter-сцена занимает ВЕСЬ трек, потолок lip-sync невалиден (0) —
    // presenter_too_long неустраним, обе попытки модели реально оплачены,
    // а шаг в итоге честно падает.
    const askModel = vi.fn(async () => ({ shots: [] as EditPlanModelShot[] }))

    await expect(runVideoEditPlan(baseInput({ lipSyncMaxDurationSec: 0 }), { askModel })).rejects.toThrow()

    expect(askModel).toHaveBeenCalledTimes(2)
    const ledgerRow = await prisma.aiAuditLog.findFirst({ where: { videoId, stepKey: "edit_plan" } })
    expect(ledgerRow).not.toBeNull()
    expect(Number(ledgerRow!.costUsd)).toBeCloseTo(0.1, 6)
    const step = await prisma.videoGenerationStep.findFirst({ where: { videoId, stepKey: "edit_plan" as never } })
    expect(step?.status).toBe("failed")
  })

  it("другой отпечаток трека — план пересчитан заново, а не отдан из кэша", async () => {
    const askModel = happyAskModel()
    await runVideoEditPlan(baseInput({ trackFingerprint: "fp-1" }), { askModel })
    const shotsBefore = await prisma.videoShot.findMany({ where: { videoId } })

    await runVideoEditPlan(baseInput({ trackFingerprint: "fp-2" }), { askModel })

    expect(askModel).toHaveBeenCalledTimes(2)
    expect(await prisma.aiAuditLog.count({ where: { videoId, stepKey: "edit_plan" } })).toBe(2)
    const shotsAfter = await prisma.videoShot.findMany({ where: { videoId } })
    // Старые строки снесены, а не оставлены рядом с новыми — иначе
    // @@unique([videoId, order]) дал бы конфликт при повторной вставке order=0.
    expect(shotsAfter.map(s => s.id).sort()).not.toEqual(shotsBefore.map(s => s.id).sort())
  })

  it("тот же отпечаток трека, но другое число сцен — кэш не срабатывает (требование 6: ключ включает sceneCount)", async () => {
    const askModel = happyAskModel()
    await runVideoEditPlan(baseInput(), { askModel })

    const twoScenes = [
      ...baseInput().alignedScenes,
      { order: 2, startSec: 4, endSec: 6, words: [{ text: "третье", startSec: 4, endSec: 6, matched: true }] },
    ]
    await runVideoEditPlan(baseInput({ alignedScenes: twoScenes, trackDurationSec: 6 }), { askModel })

    // Число сцен сменилось при том же отпечатке трека — план обязан
    // пересчитаться, а не отдаться из кэша, рассчитанного на другую разметку.
    expect(askModel).toHaveBeenCalledTimes(2)
    expect(await prisma.aiAuditLog.count({ where: { videoId, stepKey: "edit_plan" } })).toBe(2)
  })

  it("смена потолка lip-sync промахивает кэш (Important 1 ре-ревью задачи)", async () => {
    // Раньше `lipSyncMaxDurationSec` не входил в ключ кэша — смена модели
    // lip-sync (другой потолок длительности кадра) не промахивала кэш, и план
    // оставался посчитан под старые условия нарезки.
    const askModel = happyAskModel()
    await runVideoEditPlan(baseInput({ lipSyncMaxDurationSec: 10 }), { askModel })

    await runVideoEditPlan(baseInput({ lipSyncMaxDurationSec: 8 }), { askModel })

    expect(askModel).toHaveBeenCalledTimes(2)
    expect(await prisma.aiAuditLog.count({ where: { videoId, stepKey: "edit_plan" } })).toBe(2)
  })

  it("состав доступных фонов сменился — кэш не срабатывает (Important 1 ре-ревью задачи)", async () => {
    // Раньше состав `backgrounds`/`appScreens` не входил в ключ кэша —
    // заливка нового фона в библиотеку не промахивала кэш, и модель никогда
    // не узнавала про новый вариант.
    const askModel = happyAskModel()
    await runVideoEditPlan(baseInput({ backgrounds: [] }), { askModel })

    await runVideoEditPlan(
      baseInput({ backgrounds: [{ id: "bg-1", kind: "static", name: "фон", tags: [] }] }),
      { askModel },
    )

    expect(askModel).toHaveBeenCalledTimes(2)
    expect(await prisma.aiAuditLog.count({ where: { videoId, stepKey: "edit_plan" } })).toBe(2)
  })

  it("правка не-плановых полей профиля (pipPosition/pipSize/generativeVideoResolution/stepwiseApproval) не платит за агента снова (Important 2 ре-ревью задачи)", async () => {
    // Эти поля не читает ни grid.ts, ни edit-planner-agent.ts, ни
    // pickBackgroundSource — раньше профиль сериализовался ЦЕЛИКОМ, и их
    // правка промахивала кэш без всякой причины.
    const askModel = happyAskModel()
    await runVideoEditPlan(baseInput(), { askModel })

    const changedProfile = {
      ...DEFAULT_EDIT_PROFILE,
      pipPosition: "top_left" as const,
      pipSize: 0.4,
      generativeVideoResolution: "1920x1080",
      stepwiseApproval: true,
    }
    await runVideoEditPlan(baseInput({ profile: changedProfile }), { askModel })

    expect(askModel).toHaveBeenCalledTimes(1)
    expect(await prisma.aiAuditLog.count({ where: { videoId, stepKey: "edit_plan" } })).toBe(1)
  })

  it("перезапуск edit_plan сносит старые кадры плана монтажа", async () => {
    const askModel = happyAskModel()
    await runVideoEditPlan(baseInput(), { askModel })
    expect(await prisma.videoShot.count({ where: { videoId } })).toBeGreaterThan(0)

    await resetEditPlanShots(videoId, "edit_plan", ["edit_plan"], true)

    expect(await prisma.videoShot.count({ where: { videoId } })).toBe(0)
  })

  it("перезапуск, который не включает edit_plan на audio-first маршруте, кадры не трогает", async () => {
    const askModel = happyAskModel()
    await runVideoEditPlan(baseInput(), { askModel })
    const before = await prisma.videoShot.count({ where: { videoId } })
    expect(before).toBeGreaterThan(0)

    await resetEditPlanShots(videoId, "transcription", ["transcription", "voiceover_generation"], true)

    expect(await prisma.videoShot.count({ where: { videoId } })).toBe(before)
  })

  it("маршрут сменился на legacy — кадры прошлого audio-first плана сиротами не остаются (Minor М-9 ре-ревью задачи)", async () => {
    // Ролик, у которого после сборки от звука выключили EDIT_PIPELINE или
    // отвалилась модель транскрипции: `edit_plan` не существует в НОВОМ
    // порядке шагов вовсе, `stepsToReset` его никогда не содержит — раньше
    // строки VideoShot от прошлого плана оставались висеть навсегда.
    const askModel = happyAskModel()
    await runVideoEditPlan(baseInput(), { askModel })
    expect(await prisma.videoShot.count({ where: { videoId } })).toBeGreaterThan(0)

    await resetEditPlanShots(videoId, "transcription", ["transcription", "voiceover_generation"], false)

    expect(await prisma.videoShot.count({ where: { videoId } })).toBe(0)
  })
})
