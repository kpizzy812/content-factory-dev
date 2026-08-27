import { existsSync } from "node:fs"
import { rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { prisma } from "~~/server/utils/prisma"
import { StorageKeys } from "~~/server/utils/storage/keys"
import {
  runVideoEditPlan, type VideoEditPlanInput,
  runShotBackgrounds, type VideoShotBackgroundInput, type ShotBackgroundStepDeps,
} from "~~/server/utils/video-pipeline-steps"
import { resetEditPlanShots } from "~~/server/utils/video-pipeline"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import type { ResolvedEditProfile } from "~~/server/utils/edit-plan/profile"
import type { EditPlanModelShot, EditPlanModelUsage } from "~~/server/utils/edit-plan/runner"
import { calculateAnthropicCost } from "~~/server/utils/ai-pricing"

// `logAgent` — авто-импорт Nitro (как `prisma`, но prisma.ts сам себя кладёт в
// globalThis в не-production, а agent-logger.ts — нет). video-pipeline.ts
// ссылается на него как на глобал; вне Nitro-процесса тест обязан подставить
// его сам, иначе `resetEditPlanShots`/`runVideoEditPlan` падают
// `ReferenceError: logAgent is not defined` при первом же логе.
import { logAgent } from "~~/server/utils/agent-logger"
;(globalThis as Record<string, unknown>).logAgent = logAgent

// Тот же приём для `shot_background`: `runShotBackgrounds` читает
// `getAssetsDir`/`ensureDir` как авто-импорты Nitro (render.ts), вне
// Nuxt-процесса их подставляет тест — настоящими реализациями.
import { ensureDir, getAssetsDir } from "~~/server/utils/render"
;(globalThis as Record<string, unknown>).ensureDir = ensureDir
;(globalThis as Record<string, unknown>).getAssetsDir = getAssetsDir

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
    // Дефолт true — генерация разрешена, поле само по себе только рычаг
    // ВЫКЛЮЧЕНИЯ (ре-ревью 3, Task 5, пункт 1).
    expect(profile.imageGenerationEnabled).toBe(true)
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

  it("ledger хранит ФАКТИЧЕСКУЮ модель из usage, а не сервис 'anthropic' при дефолтном профиле (мелочь ре-ревью 3)", async () => {
    // profile.llmModelId === null (дефолт) — раньше logStepCost получал этот
    // null и logServiceCost подставлял `model: modelId ?? resolvedService`,
    // то есть буквально сервис ("anthropic") в колонку модели, хотя
    // фактическая модель уже известна из usage.model.
    const usage: EditPlanModelUsage = { model: "claude-sonnet-4-6", inputTokens: 5000, outputTokens: 1000 }
    const askModel = vi.fn(async (
      grid: Array<{ order: number }>, _context: unknown, reportUsage: (usage: EditPlanModelUsage | null) => void,
    ): Promise<{ shots: EditPlanModelShot[] }> => {
      reportUsage(usage)
      return { shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image", idea: "фон" })) }
    })

    await runVideoEditPlan(baseInput({ profile: { ...DEFAULT_EDIT_PROFILE, llmModelId: null } }), { askModel })

    const ledgerRow = await prisma.aiAuditLog.findFirst({ where: { videoId, stepKey: "edit_plan" } })
    expect(ledgerRow).not.toBeNull()
    expect(ledgerRow!.model).toBe("claude-sonnet-4-6")
    expect(ledgerRow!.model).not.toBe("anthropic")
  })

  it("ledger различает измеренную и оценённую цену через metadata.estimated (мелочь ре-ревью 3)", async () => {
    // Измеренная цена (usage реален, модель в тарифной таблице) — estimated
    // не проставляется вовсе (байт-в-байт совместимость с историческими
    // строками, тот же принцип, что и у attempt=1).
    const measuredUsage: EditPlanModelUsage = { model: "claude-sonnet-4-6", inputTokens: 5000, outputTokens: 1000 }
    const measuredAskModel = vi.fn(async (
      grid: Array<{ order: number }>, _context: unknown, reportUsage: (usage: EditPlanModelUsage | null) => void,
    ): Promise<{ shots: EditPlanModelShot[] }> => {
      reportUsage(measuredUsage)
      return { shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image", idea: "фон" })) }
    })
    await runVideoEditPlan(baseInput(), { askModel: measuredAskModel })
    const measuredRow = await prisma.aiAuditLog.findFirst({ where: { videoId, stepKey: "edit_plan" } })
    expect(measuredRow).not.toBeNull()
    expect((measuredRow!.suggestions as { estimated?: boolean } | null)?.estimated).toBeFalsy()

    // Оценённая цена (usage не сообщён — как в моке) — estimated: true.
    const secondVideo = await prisma.video.create({
      data: { scenarioId: (await prisma.scenario.create({ data: { status: "draft" } })).id, editPipeline: true },
    })
    await runVideoEditPlan(baseInput({ videoId: secondVideo.id }), { askModel: happyAskModel() })
    const estimatedRow = await prisma.aiAuditLog.findFirst({ where: { videoId: secondVideo.id, stepKey: "edit_plan" } })
    expect(estimatedRow).not.toBeNull()
    expect((estimatedRow!.suggestions as { estimated?: boolean } | null)?.estimated).toBe(true)
  })

  it("ledger получает реальную токенную цену вызова агента, а не смету фонов по плану и не плоскую константу (Critical 1 ре-ревью задачи, фикс-раунд 2)", async () => {
    // Раньше в ledger уходила Σ VideoShot.costUsd (смета БУДУЩИХ картинок/видео
    // по плану) под сервисом "anthropic" — план без единого платного фона терял
    // реально оплаченный вызов модели из учёта целиком. В фикс-раунде 1 это
    // заменили плоской константой ($0.05/вызов) — ре-ревью потребовало
    // реального токенного расчёта: промпт агента растёт с сеткой кадров,
    // плоская оценка систематически занижает цену на длинных роликах.
    //
    // Сцена даёт РОВНО 3 кадра (а не 2, как в `baseInput()`) — со стандартными
    // 2 кадрами 2×$0.025 = $0.05 численно СОВПАДАЕТ с прежней плоской оценкой,
    // и коллизия маскирует дефекты денежной проводки. Оставлено с фикс-раунда 1.
    const usage: EditPlanModelUsage = { model: "claude-sonnet-4-6", inputTokens: 12000, outputTokens: 3000 }
    const askModel = vi.fn(async (
      grid: Array<{ order: number }>, _context: unknown, reportUsage: (usage: EditPlanModelUsage | null) => void,
    ): Promise<{ shots: EditPlanModelShot[] }> => {
      reportUsage(usage)
      return { shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image", idea: "фон" })) }
    })
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

    // Цена — реально посчитана по токенам из usage (через ту же
    // `calculateAnthropicCost`, что и продакшен-код — проверяем, что ЦИФРЫ
    // ДОШЛИ до ledger, а не корректность самой тарифной таблицы), а НЕ сумма
    // стоимостей кадров (3 × $0.025 = $0.075) и НЕ прежняя константа $0.05.
    const expectedCostUsd = calculateAnthropicCost(usage.model, usage)
    expect(expectedCostUsd).not.toBeNull()
    expect(expectedCostUsd).not.toBeCloseTo(0.05, 6)
    expect(expectedCostUsd).not.toBeCloseTo(0.075, 6)
    expect(result.costUsd).toBeCloseTo(expectedCostUsd!, 6)
    const ledgerRow = await prisma.aiAuditLog.findFirst({ where: { videoId, stepKey: "edit_plan" } })
    expect(ledgerRow).not.toBeNull()
    expect(Number(ledgerRow!.costUsd)).toBeCloseTo(expectedCostUsd!, 6)

    // Прогнозная смета фонов — ОТДЕЛЬНОЕ число (askModel просит "image" на
    // каждый кадр, $0.025/кадр), в ledger не попадает вовсе.
    expect(result.plannedMediaCostUsd).toBeCloseTo(0.075, 6)
    expect(result.plannedMediaCostUsd).not.toBeCloseTo(result.costUsd, 6)
  })

  it("usage не сообщён (как в ANTHROPIC_MOCK_MODE) — цена вызова не становится тихим нулём, используется резервная оценка (Critical 1, п.4 ре-ревью задачи)", async () => {
    // happyAskModel() не возвращает usage вовсе — ровно то, что реально
    // происходит в моке: tryMockAnthropicAgent не зовёт onUsage. Проверяем,
    // что это НЕ ломает учёт (нет строки в ledger) и НЕ даёт тихий $0.
    const askModel = happyAskModel()

    const result = await runVideoEditPlan(baseInput(), { askModel })

    expect(result.costUsd).toBeGreaterThan(0)
    const ledgerRow = await prisma.aiAuditLog.findFirst({ where: { videoId, stepKey: "edit_plan" } })
    expect(ledgerRow).not.toBeNull()
    expect(Number(ledgerRow!.costUsd)).toBe(result.costUsd)
  })

  it("модель вне тарифной таблицы — реальный вызов не превращается в тихий ноль, списана резервная оценка и лог явный (Critical 1, п.2 ре-ревью задачи)", async () => {
    // usage ЕСТЬ (модель реально вызвана), но её нет в PRICING_TABLE
    // (`ai-pricing.ts`) — EditProfile.llmModelId разрешает произвольную
    // строку. `calculateAnthropicCost` вернёт null; наивная реализация дала
    // бы costUsd=0 и потеряла бы реально оплаченный вызов из учёта — тот же
    // класс дефекта, что был у imageUsd при отсутствующей спеке flux-dev.
    const unknownModel = "claude-future-model-x1"
    const askModel = vi.fn(async (
      grid: Array<{ order: number }>, _context: unknown, reportUsage: (usage: EditPlanModelUsage | null) => void,
    ): Promise<{ shots: EditPlanModelShot[] }> => {
      reportUsage({ model: unknownModel, inputTokens: 5000, outputTokens: 1000 })
      return { shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image", idea: "фон" })) }
    })

    const result = await runVideoEditPlan(
      baseInput({ profile: { ...DEFAULT_EDIT_PROFILE, llmModelId: unknownModel } }),
      { askModel },
    )

    // Не ноль — резервная плоская оценка ($0.05), задокументированная как
    // fallback именно на этот случай (EDIT_PLAN_MODEL_CALL_ESTIMATE_USD).
    expect(result.costUsd).toBeCloseTo(0.05, 6)
    const ledgerRow = await prisma.aiAuditLog.findFirst({ where: { videoId, stepKey: "edit_plan" } })
    expect(ledgerRow).not.toBeNull()
    expect(Number(ledgerRow!.costUsd)).toBeCloseTo(0.05, 6)

    // Явный лог с известными токенами — не молчим о том, что цена не измерена.
    const step = await prisma.videoGenerationStep.findFirst({
      where: { videoId, stepKey: "edit_plan" as never },
      select: { logs: true },
    })
    const logMessages = (Array.isArray(step?.logs) ? step.logs : [])
      .map(entry => String((entry as { msg?: unknown }).msg ?? ""))
    expect(logMessages.some(msg => msg.includes(unknownModel) && msg.includes("тарифной таблице"))).toBe(true)
  })

  it("ремонт не сходится после двух попыток — обе оплаченные попытки всё равно списаны в ledger по реальным токенам (Critical 1 ре-ревью задачи, п.1 и п.3)", async () => {
    // Presenter-сцена занимает ВЕСЬ трек, потолок lip-sync невалиден (0) —
    // presenter_too_long неустраним, обе попытки модели реально оплачены с
    // РАЗНЫМ usage (вторая попытка — с previousErrors в промпте — обычно
    // тяжелее), а шаг в итоге честно падает.
    const usageByAttempt: EditPlanModelUsage[] = [
      { model: "claude-sonnet-4-6", inputTokens: 4000, outputTokens: 800 },
      { model: "claude-sonnet-4-6", inputTokens: 6000, outputTokens: 1200 },
    ]
    let call = 0
    const askModel = vi.fn(async (
      _grid: unknown, _context: unknown, reportUsage: (usage: EditPlanModelUsage | null) => void,
    ): Promise<{ shots: EditPlanModelShot[] }> => {
      reportUsage(usageByAttempt[call++]!)
      return { shots: [] }
    })

    await expect(runVideoEditPlan(baseInput({ lipSyncMaxDurationSec: 0 }), { askModel })).rejects.toThrow()

    expect(askModel).toHaveBeenCalledTimes(2)
    // Сумма ОБЕИХ попыток по их РЕАЛЬНЫМ usage — не 2×константа (это как раз
    // то, что фикс-раунд 1 делал раньше) и не usage только последней попытки.
    const expectedTotal = usageByAttempt.reduce((sum, usage) => sum + calculateAnthropicCost(usage.model, usage)!, 0)
    const ledgerRow = await prisma.aiAuditLog.findFirst({ where: { videoId, stepKey: "edit_plan" } })
    expect(ledgerRow).not.toBeNull()
    expect(Number(ledgerRow!.costUsd)).toBeCloseTo(expectedTotal, 6)
    const step = await prisma.videoGenerationStep.findFirst({ where: { videoId, stepKey: "edit_plan" as never } })
    expect(step?.status).toBe("failed")
  })

  it("askModel сообщает usage и ПОТОМ падает (аналог обрезанного/непарсимого ответа модели) — оплаченный вызов не теряется (Critical 1, ре-ревью 3, п.2)", async () => {
    // Реальный путь: callAnthropicAgent зовёт onUsage СРАЗУ, как только
    // Anthropic ответил, — ДО того, как extractJsonFromText/validate() могут
    // бросить исключение на обрезанном/невалидном JSON. До этой правки
    // runVideoEditPlan терял usage целиком в этом сценарии: единственным
    // каналом был EditPlanUnresolvedError, а тут исключение — совсем другого
    // типа (оно не оборачивается раннером вовсе).
    const usage: EditPlanModelUsage = { model: "claude-sonnet-4-6", inputTokens: 8000, outputTokens: 4000 }
    const askModel = vi.fn(async (
      _grid: unknown, _context: unknown, reportUsage: (usage: EditPlanModelUsage | null) => void,
    ): Promise<{ shots: EditPlanModelShot[] }> => {
      reportUsage(usage)
      throw new Error("JSON parse failed (симуляция обрезанного ответа)")
    })

    await expect(runVideoEditPlan(baseInput(), { askModel })).rejects.toThrow(/JSON parse failed/)

    const expectedCost = calculateAnthropicCost(usage.model, usage)!
    const ledgerRow = await prisma.aiAuditLog.findFirst({ where: { videoId, stepKey: "edit_plan" } })
    expect(ledgerRow).not.toBeNull()
    expect(Number(ledgerRow!.costUsd)).toBeCloseTo(expectedCost, 6)
    const step = await prisma.videoGenerationStep.findFirst({ where: { videoId, stepKey: "edit_plan" as never } })
    expect(step?.status).toBe("failed")
  })

  it("saveShots падает (гонка/дедлок БД) ПОСЛЕ успешного построения плана — оплаченный вызов агента не теряется (Critical 1, ре-ревью 3, п.2)", async () => {
    // saveShots зовётся ВНУТРИ runEditPlanStep, после успешного askModel —
    // её падение раньше уносило с собой usage вместе с результатом, который
    // так и не был возвращён наружу (тот же класс дефекта, что у непарсимого
    // ответа модели, но на другом конце шага).
    const usage: EditPlanModelUsage = { model: "claude-sonnet-4-6", inputTokens: 9000, outputTokens: 2000 }
    const askModel = vi.fn(async (
      grid: Array<{ order: number }>, _context: unknown, reportUsage: (usage: EditPlanModelUsage | null) => void,
    ): Promise<{ shots: EditPlanModelShot[] }> => {
      reportUsage(usage)
      return { shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image", idea: "фон" })) }
    })
    const saveShots = vi.fn(async () => { throw new Error("deadlock detected") })

    await expect(runVideoEditPlan(baseInput(), { askModel, saveShots })).rejects.toThrow(/deadlock/)

    const expectedCost = calculateAnthropicCost(usage.model, usage)!
    const ledgerRow = await prisma.aiAuditLog.findFirst({ where: { videoId, stepKey: "edit_plan" } })
    expect(ledgerRow).not.toBeNull()
    expect(Number(ledgerRow!.costUsd)).toBeCloseTo(expectedCost, 6)
    // Ни одного кадра не сохранилось (saveShots упала), но деньги списаны —
    // ровно то поведение, которого требует правило "заплатили — обязаны записать".
    expect(await prisma.videoShot.count({ where: { videoId } })).toBe(0)
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

  // Сомнение №3 ре-ревью 3: «ни один тест не меняет ни одного из планинг-полей
  // профиля между прогонами — мутация "planningRelevantProfile возвращает
  // пустой объект" оставит сьюту зелёной». Старый комбинированный тест на
  // НЕ-планинговые поля (Important 2) менял все 4 разом и проверял только
  // кэш-ПОПАДАНИЕ — он прошёл бы точно так же, если бы `planningRelevantProfile`
  // игнорировала ВООБЩЕ все поля, включая планинговые. Ниже — по одному полю
  // за раз, с обеих сторон: планинговое ДОЛЖНО промахивать кэш, непланинговое —
  // НЕ должно.
  describe("ключ кэша реагирует на планинг-поля и игнорирует остальные (сомнение №3 ре-ревью 3)", () => {
    const PLANNING_FIELD_CHANGES: Array<[string, Partial<ResolvedEditProfile>]> = [
      ["editPrompt", { editPrompt: "другое правило монтажа" }],
      ["brollRatio", { brollRatio: 0.6 }],
      ["shotChangeSec", { shotChangeSec: 2.5 }],
      ["pipEnabled", { pipEnabled: true }],
      ["generativeVideoEnabled", { generativeVideoEnabled: true }],
      ["generativeVideoBudgetUsd", { generativeVideoBudgetUsd: 2 }],
      ["llmModelId", { llmModelId: "claude-other-model" }],
      ["imageGenerationEnabled", { imageGenerationEnabled: false }],
    ]

    it.each(PLANNING_FIELD_CHANGES)("планинг-поле %s промахивает кэш — агент вызван заново", async (_field, patch) => {
      const askModel = happyAskModel()
      await runVideoEditPlan(baseInput(), { askModel })

      await runVideoEditPlan(baseInput({ profile: { ...DEFAULT_EDIT_PROFILE, ...patch } }), { askModel })

      expect(askModel).toHaveBeenCalledTimes(2)
      expect(await prisma.aiAuditLog.count({ where: { videoId, stepKey: "edit_plan" } })).toBe(2)
    })

    const NON_PLANNING_FIELD_CHANGES: Array<[string, Partial<ResolvedEditProfile>]> = [
      ["pipPosition", { pipPosition: "top_left" }],
      ["pipSize", { pipSize: 0.4 }],
      ["generativeVideoResolution", { generativeVideoResolution: "1920x1080" }],
      ["stepwiseApproval", { stepwiseApproval: true }],
    ]

    it.each(NON_PLANNING_FIELD_CHANGES)("НЕ-планинг поле %s не промахивает кэш — агент не вызван заново", async (_field, patch) => {
      const askModel = happyAskModel()
      await runVideoEditPlan(baseInput(), { askModel })

      await runVideoEditPlan(baseInput({ profile: { ...DEFAULT_EDIT_PROFILE, ...patch } }), { askModel })

      expect(askModel).toHaveBeenCalledTimes(1)
      expect(await prisma.aiAuditLog.count({ where: { videoId, stepKey: "edit_plan" } })).toBe(1)
    })
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

  it("imageGenerationEnabled=false в профиле реально выключает генерацию картинки — не жёстко закодированный true (ре-ревью 3, Task 5, пункт 1)", async () => {
    // Раньше imageGenerationAllowed вычислялся из findMediaSpec("replicate:flux-dev")
    // !== null — статический реестр моделей содержит flux-dev ВСЕГДА, флаг был
    // вычисляемым хардкодом. Единственный реальный рычаг — профильный флаг.
    const askModel = vi.fn(async (grid: Array<{ order: number }>) => ({
      shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image", idea: "фон" })),
    }))

    await runVideoEditPlan(
      baseInput({ profile: { ...DEFAULT_EDIT_PROFILE, imageGenerationEnabled: false } }),
      { askModel },
    )

    const shots = await prisma.videoShot.findMany({ where: { videoId } })
    expect(shots.length).toBeGreaterThan(0)
    for (const shot of shots) {
      // Модель попросила "image", профиль это запретил — деградация до §10,
      // а не тихая картинка вопреки настройке оператора.
      expect(shot.background).toBe("none")
      expect(shot.foreground).toBe("presenter")
      expect(Number(shot.costUsd)).toBe(0)
    }

    const step = await prisma.videoGenerationStep.findFirst({
      where: { videoId, stepKey: "edit_plan" as never },
      select: { logs: true },
    })
    const logMessages = (Array.isArray(step?.logs) ? step.logs : [])
      .map(entry => String((entry as { msg?: unknown }).msg ?? ""))
    expect(logMessages.some(msg => msg.includes("imageGenerationEnabled=false"))).toBe(true)
  })
})

/**
 * Идемпотентность и деньги шага `shot_background` (Task 4 плана «Сборка по
 * кадрам»). `runShotBackgrounds` вызывается напрямую с подменёнными деньгами
 * (`planPrompts`/`generateImage`/`generateVideo`/`media`) — реальные Anthropic
 * и Replicate уже покрыты `tests/integration/audio-first-pipeline.spec.ts` на
 * моках провайдера; здесь проверяется ТОЛЬКО DB-обвязка: кэш по отпечатку
 * кадров, идемпотентность НА кадр, частичное падение, каскад сброса.
 *
 * Кадры создаются напрямую через `prisma.videoShot.create` (не через
 * `runVideoEditPlan`) — тем же приёмом, что и CRUD-тесты выше в этом файле:
 * шаг `shot_background` читает `VideoShot` из БД сам, ему всё равно, кто их
 * туда положил.
 */
describe("шаг shot_background: идемпотентность, деньги, каскад сброса", () => {
  function baseShotInput(overrides: Partial<VideoShotBackgroundInput> = {}): VideoShotBackgroundInput {
    return {
      videoId,
      trackFingerprint: "fp-1",
      format: "portrait",
      renderQuality: "medium",
      profile: { ...DEFAULT_EDIT_PROFILE },
      visualStyle: null,
      appName: null,
      imageModelId: "replicate:flux-dev",
      videoModelId: "replicate:kling-v1.6-standard-t2v",
      sceneTextByOrder: new Map<number, string>(),
      ...overrides,
    }
  }

  /** Промпт-агент реально отчитывается usage — цена МЕРЯНАЯ, а не резервная оценка, числа детерминированы. */
  const PROMPT_USAGE: EditPlanModelUsage = { model: "claude-sonnet-4-6", inputTokens: 500, outputTokens: 100 }
  const PROMPT_COST = calculateAnthropicCost(PROMPT_USAGE.model, PROMPT_USAGE)!

  function happyDeps(overrides: Partial<ShotBackgroundStepDeps> = {}): ShotBackgroundStepDeps {
    return {
      // Текст промпта зависит от idea И от visualStyle (не только от order) —
      // иначе отпечаток кадра (Ruling I-2: JSON({action, promptText})) не
      // различал бы смену idea/стиля, и DB-тесты на per-кадровую
      // идемпотентность проверяли бы не то, что заявлено.
      planPrompts: vi.fn(async (promptInput: {
        shots: Array<{ order: number, idea: string | null }>
        visualStyle: string | null
        onUsage?: (u: EditPlanModelUsage) => void
      }) => {
        promptInput.onUsage?.(PROMPT_USAGE)
        return {
          prompts: promptInput.shots.map(s => ({
            order: s.order,
            prompt: `тестовый промпт ${s.order}: ${s.idea ?? "без идеи"} / стиль=${promptInput.visualStyle ?? "нет"}`.padEnd(60, "."),
            purpose: "тест",
          })),
          usage: PROMPT_USAGE,
        }
      }),
      generateImage: vi.fn(async (args: { order: number }) => ({ localPath: `/tmp/shot-${args.order}.png`, costUsd: 0.025 })),
      generateVideo: vi.fn(async (args: { order: number, billedSec: number }) => ({
        localPath: `/tmp/shot-${args.order}.mp4`, costUsd: args.billedSec * 0.05, effectiveDurationSec: args.billedSec,
      })),
      media: {
        downloadToFile: vi.fn(async () => {}),
        fileExists: vi.fn(async () => true),
        ensureDir: vi.fn(async () => {}),
      },
      ...overrides,
    } as ShotBackgroundStepDeps
  }

  function makeShot(overrides: Partial<{
    order: number, startSec: number, endSec: number, sceneOrder: number | null,
    foreground: string, background: string, backgroundClipId: string | null,
    appReferenceId: string | null, idea: string | null, pipEnabled: boolean,
  }> = {}) {
    return prisma.videoShot.create({
      data: {
        videoId,
        order: 0, startSec: 0, endSec: 2, sceneOrder: null,
        foreground: "none", background: "image", idea: "идея кадра",
        ...overrides,
      },
    })
  }

  it("повторный прогон при совпавшем ключе кэша не дёргает ни провайдера картинок, ни агента промптов — и не платит второй раз", async () => {
    await makeShot({ order: 0, idea: "фон первого кадра" })
    await makeShot({ order: 1, idea: "фон второго кадра" })

    const deps1 = happyDeps()
    const first = await runShotBackgrounds(baseShotInput(), deps1)
    expect(first.status).toBe("completed")
    // Один вызов на ШАГ, не на кадр — мутационная таблица брифа.
    expect(deps1.planPrompts).toHaveBeenCalledTimes(1)
    expect(deps1.generateImage).toHaveBeenCalledTimes(2)
    expect(first.costUsd).toBeCloseTo(PROMPT_COST + 0.05, 6)

    const assetsAfterFirst = await prisma.videoAsset.findMany({ where: { videoId, type: "shot_background" as never } })
    expect(assetsAfterFirst).toHaveLength(2)
    expect(await prisma.aiAuditLog.count({ where: { videoId, stepKey: "shot_background" } })).toBeGreaterThan(0)
    const ledgerRowsAfterFirst = await prisma.aiAuditLog.count({ where: { videoId, stepKey: "shot_background" } })

    const deps2 = happyDeps()
    const second = await runShotBackgrounds(baseShotInput(), deps2)

    expect(deps2.planPrompts).toHaveBeenCalledTimes(0)
    expect(deps2.generateImage).toHaveBeenCalledTimes(0)
    expect(second.costUsd).toBe(0)
    expect(second.renderedCount).toBe(0)
    expect(second.reusedCount).toBe(2)

    const assetsAfterSecond = await prisma.videoAsset.findMany({ where: { videoId, type: "shot_background" as never } })
    expect(assetsAfterSecond.map(a => a.id).sort()).toEqual(assetsAfterFirst.map(a => a.id).sort())
    // chargeStep не вызывается при попадании в кэш — ledger не растёт.
    expect(await prisma.aiAuditLog.count({ where: { videoId, stepKey: "shot_background" } })).toBe(ledgerRowsAfterFirst)
  })

  it("смена idea у одного кадра промахивает кэш и перерисовывает ТОЛЬКО этот кадр", async () => {
    await makeShot({ order: 0, idea: "фон первого кадра" })
    const shot1 = await makeShot({ order: 1, idea: "фон второго кадра" })

    await runShotBackgrounds(baseShotInput(), happyDeps())
    const assetsBefore = await prisma.videoAsset.findMany({
      where: { videoId, type: "shot_background" as never }, orderBy: { order: "asc" },
    })
    expect(assetsBefore).toHaveLength(2)

    await prisma.videoShot.update({ where: { id: shot1.id }, data: { idea: "фон второго кадра — переписан" } })

    const deps2 = happyDeps()
    const result2 = await runShotBackgrounds(baseShotInput(), deps2)

    // Промахнули ОБЩИЙ ключ (idea входит в отпечаток) — промпты просят заново
    // на весь набор, но рисуют ТОЛЬКО изменившийся кадр.
    expect(deps2.generateImage).toHaveBeenCalledTimes(1)
    expect(deps2.generateImage).toHaveBeenCalledWith(expect.objectContaining({ order: 1 }))
    expect(result2.renderedCount).toBe(1)
    expect(result2.reusedCount).toBe(1)

    const assetsAfter = await prisma.videoAsset.findMany({
      where: { videoId, type: "shot_background" as never }, orderBy: { order: "asc" },
    })
    // Кадр 0 — тот же ассет, ни filePath, ни отпечаток не тронуты.
    const before0 = assetsBefore.find(a => a.order === 0)!
    const after0 = assetsAfter.find(a => a.order === 0)!
    expect(after0.id).toBe(before0.id)
    expect(after0.prompt).toBe(before0.prompt)
    // Кадр 1 — та же строка (update, не create), но отпечаток сменился вместе с idea.
    const before1 = assetsBefore.find(a => a.order === 1)!
    const after1 = assetsAfter.find(a => a.order === 1)!
    expect(after1.id).toBe(before1.id)
    expect(after1.prompt).not.toBe(before1.prompt)
  })

  it("падение исполнения на одном кадре не роняет весь шаг — уже нарисованные кадры остаются и оплачены", async () => {
    await makeShot({ order: 0, idea: "фон первого кадра" })
    await makeShot({ order: 1, idea: "фон второго кадра" })

    const deps = happyDeps({
      generateImage: vi.fn(async (args: { order: number }) => {
        if (args.order === 1) throw new Error("Replicate недоступен (симуляция)")
        return { localPath: `/tmp/shot-${args.order}.png`, costUsd: 0.025 }
      }),
    })

    const result = await runShotBackgrounds(baseShotInput(), deps)

    // Шаг НЕ падает целиком: кадр 0 остался видимым (§10) — только он деградировал.
    expect(result.status).toBe("degraded")
    expect(result.costUsd).toBeCloseTo(PROMPT_COST + 0.025, 6)

    const shots = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
    expect(shots[0]!.status).toBe("completed")
    expect(Number(shots[0]!.costUsd)).toBeCloseTo(0.025, 6)
    expect(shots[1]!.status).toBe("degraded")
    expect(shots[1]!.degradeReason).toBeTruthy()
    expect(shots[1]!.degradeReason).toContain("Replicate недоступен")

    const assets = await prisma.videoAsset.findMany({ where: { videoId, type: "shot_background" as never } })
    expect(assets).toHaveLength(1)
    expect(assets[0]!.order).toBe(0)

    // Оплачено ровно то, что реально сгенерировано — расход за упавший кадр не потерян,
    // но и не выдуман: в ledger он просто отсутствует ($0 за отказ).
    const step = await prisma.videoGenerationStep.findFirst({ where: { videoId, stepKey: "shot_background" as never } })
    expect(step?.status).toBe("completed")
    expect(Number(step!.actualCost)).toBeCloseTo(PROMPT_COST + 0.025, 6)
  })

  it("генеративное видео: смена generativeVideoBudgetUsd промахивает кэш и меняет исход кадра", async () => {
    // 6 с кадр без ведущего — квантуется в 10 с, стоит $0.50.
    await makeShot({ order: 0, startSec: 0, endSec: 6, background: "video", idea: "движение камеры" })

    const budgetProfile = (budgetUsd: number): VideoShotBackgroundInput => baseShotInput({
      profile: { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: budgetUsd },
    })

    // Потолок $0.30 ниже цены клипа $0.50 — деградация до картинки.
    //
    // VideoShot.background — решение ПЛАНА (edit_plan), shot_background его не
    // переписывает (брифом заданы только status/costUsd/degradeReason — см.
    // отчёт задачи, раздел «разошлось с брифом»): факт деградации проверяем по
    // degradeReason и по РЕАЛЬНОМУ расширению ассета, а не по этому полю.
    const deps1 = happyDeps()
    const first = await runShotBackgrounds(budgetProfile(0.3), deps1)
    expect(deps1.generateVideo).toHaveBeenCalledTimes(0)
    expect(deps1.generateImage).toHaveBeenCalledTimes(1)
    const shotAfterFirst = await prisma.videoShot.findFirst({ where: { videoId, order: 0 } })
    expect(shotAfterFirst!.degradeReason).toBeTruthy()
    expect(first.status).toBe("degraded")
    const assetAfterFirst = await prisma.videoAsset.findFirst({ where: { videoId, order: 0, type: "shot_background" as never } })
    expect(assetAfterFirst!.filePath).toMatch(/\.png$/)

    // Тот же кадр, потолок вырос до $1 — ключ кэша обязан промахнуться
    // (иначе профиль сменился, а решение осталось от старого потолка).
    const deps2 = happyDeps()
    const second = await runShotBackgrounds(budgetProfile(1), deps2)
    expect(deps2.generateVideo).toHaveBeenCalledTimes(1)
    const shotAfterSecond = await prisma.videoShot.findFirst({ where: { videoId, order: 0 } })
    expect(shotAfterSecond!.degradeReason).toBeNull()
    expect(second.status).toBe("completed")
    const assetAfterSecond = await prisma.videoAsset.findFirst({ where: { videoId, order: 0, type: "shot_background" as never } })
    expect(assetAfterSecond!.filePath).toMatch(/\.mp4$/)
  })

  it("перезапуск edit_plan сносит и кадры, и ассеты фонов кадров (не только VideoShot)", async () => {
    await makeShot({ order: 0, idea: "фон первого кадра" })
    await runShotBackgrounds(baseShotInput(), happyDeps())

    expect(await prisma.videoShot.count({ where: { videoId } })).toBeGreaterThan(0)
    expect(await prisma.videoAsset.count({ where: { videoId, type: "shot_background" as never } })).toBeGreaterThan(0)

    await resetEditPlanShots(videoId, "edit_plan", ["edit_plan"], true)

    expect(await prisma.videoShot.count({ where: { videoId } })).toBe(0)
    expect(await prisma.videoAsset.count({ where: { videoId, type: "shot_background" as never } })).toBe(0)
  })

  // ── Фикс-раунд 1 (ре-ревью): C-1, I-1, I-2, M-A..M-D ──────────────────────

  it("C-1: картинка и генеративное видео в ОДНОЙ попытке — сумма replicate-строк в ledger равна image+video, ни одна не проглочена дедупом", async () => {
    await makeShot({ order: 0, background: "image", idea: "фон картинкой" })
    // 10с кадр без ведущего — квантуется в 10с, стоит $0.50.
    await makeShot({ order: 1, startSec: 10, endSec: 20, background: "video", idea: "фон видео" })

    const deps = happyDeps()
    const profile = { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 5 }
    const result = await runShotBackgrounds(baseShotInput({ profile }), deps)

    expect(deps.generateImage).toHaveBeenCalledTimes(1)
    expect(deps.generateVideo).toHaveBeenCalledTimes(1)

    const expectedImageCost = 0.025
    const expectedVideoCost = 10 * 0.05
    expect(result.costUsd).toBeCloseTo(PROMPT_COST + expectedImageCost + expectedVideoCost, 6)

    // mapStepKeyToService("shot_background", "replicate:flux-dev") ===
    // mapStepKeyToService("shot_background", "replicate:kling-v1.6-standard-t2v")
    // === "replicate" — обе модели резолвятся в ОДИН сервис. Дедуп logStepCost
    // по (videoId, stepKey, service, attempt) без учёта модели раньше глотал
    // вторую строку целиком (Critical C-1 ре-ревью).
    const replicateRows = await prisma.aiAuditLog.findMany({
      where: { videoId, stepKey: "shot_background", service: "replicate" },
    })
    const replicateSum = replicateRows.reduce((sum, r) => sum + Number(r.costUsd), 0)
    expect(replicateSum).toBeCloseTo(expectedImageCost + expectedVideoCost, 6)
    // Ровно ОДНА строка (обе суммы сложены, а не потеряны) — решение C-1:
    // складывать в одну строку при совпавшем сервисе, а не расширять общий
    // дедуп cost-ledger.ts.
    expect(replicateRows).toHaveLength(1)
  })

  it("I-1: отказ провайдера на кадре не замерзает в кэше — следующий прогон снова идёт к провайдеру за ЭТИМ кадром", async () => {
    await makeShot({ order: 0, idea: "фон первого кадра" })
    await makeShot({ order: 1, idea: "фон второго кадра" })

    let failOrder1 = true
    const deps1 = happyDeps({
      generateImage: vi.fn(async (args: { order: number }) => {
        if (args.order === 1 && failOrder1) throw new Error("сеть недоступна (симуляция)")
        return { localPath: `/tmp/shot-${args.order}.png`, costUsd: 0.025 }
      }),
    })
    const first = await runShotBackgrounds(baseShotInput(), deps1)
    expect(first.status).toBe("degraded")
    expect(deps1.generateImage).toHaveBeenCalledTimes(2)

    // Сеть "восстановилась" — но идемпотентность НЕ должна была заморозить
    // кадр 1 без фона до ручного перезапуска: деградация исполнения — это
    // событие среды, а не свойство материала (см. docstring рядом с
    // cacheKeyToStore в runShotBackgrounds).
    failOrder1 = false
    const deps2 = happyDeps()
    const second = await runShotBackgrounds(baseShotInput(), deps2)

    // Кадр 0 успешно нарисован в первом прогоне — переиспользуется бесплатно.
    expect(deps2.generateImage).toHaveBeenCalledTimes(1)
    expect(deps2.generateImage).toHaveBeenCalledWith(expect.objectContaining({ order: 1 }))
    expect(second.status).toBe("completed")

    const shots = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
    expect(shots[1]!.status).toBe("completed")
    expect(shots[1]!.degradeReason).toBeNull()
  })

  it("I-2: смена visualStyle промахивает ОБЩИЙ ключ и отпечаток кадра — фон перерисовывается", async () => {
    await makeShot({ order: 0, idea: "фон первого кадра" })

    const deps1 = happyDeps()
    await runShotBackgrounds(baseShotInput({ visualStyle: "стиль А" }), deps1)
    expect(deps1.generateImage).toHaveBeenCalledTimes(1)

    const deps2 = happyDeps()
    const result2 = await runShotBackgrounds(baseShotInput({ visualStyle: "стиль Б" }), deps2)

    // Общий ключ шага промахнулся (visualStyle в нём есть) — промпты просят
    // заново; реальный текст промпта изменился вместе со стилем (мок это
    // отражает), значит отпечаток НА КАДР тоже разошёлся — картинка
    // перерисовывается, а не молча остаётся от старого стиля.
    expect(deps2.planPrompts).toHaveBeenCalledTimes(1)
    expect(deps2.generateImage).toHaveBeenCalledTimes(1)
    expect(result2.status).toBe("completed")
  })

  it("M-A: ассет есть и отпечаток совпал, но файла на диске нет — перерисовывается, а не тихо теряется", async () => {
    await makeShot({ order: 0, idea: "фон первого кадра" }) // этот кадр "теряет" файл на диске
    const shot1 = await makeShot({ order: 1, idea: "фон второго кадра" }) // форсирует промах ОБЩЕГО ключа

    await runShotBackgrounds(baseShotInput(), happyDeps())

    await prisma.videoShot.update({ where: { id: shot1.id }, data: { idea: "фон второго кадра — изменён" } })

    // fileExists лжёт "false" именно для файла кадра 0 (потеря диска —
    // перезапуск контейнера, другая нода); кадр 1 в любом случае перерисуется,
    // раз его отпечаток разошёлся вместе с idea.
    const deps2 = happyDeps({
      media: {
        downloadToFile: vi.fn(async () => {}),
        fileExists: vi.fn(async (path: string) => !path.endsWith("shot-0.png")),
        ensureDir: vi.fn(async () => {}),
      },
    })
    const result2 = await runShotBackgrounds(baseShotInput(), deps2)

    expect(deps2.generateImage).toHaveBeenCalledWith(expect.objectContaining({ order: 0 }))
    expect(deps2.generateImage).toHaveBeenCalledWith(expect.objectContaining({ order: 1 }))
    expect(deps2.generateImage).toHaveBeenCalledTimes(2)
    expect(result2.renderedCount).toBe(2)
    expect(result2.reusedCount).toBe(0)
  })

  it("M-B: planPrompts бросает ПОСЛЕ onUsage — оплаченный вызов не теряется, ledger пишется из catch", async () => {
    await makeShot({ order: 0, idea: "фон кадра" })

    const deps = happyDeps({
      planPrompts: vi.fn(async (promptInput: { onUsage?: (u: EditPlanModelUsage) => void }) => {
        promptInput.onUsage?.(PROMPT_USAGE)
        throw new Error("обрезанный ответ агента (симуляция)")
      }),
    })

    await expect(runShotBackgrounds(baseShotInput(), deps)).rejects.toThrow(/обрезанный ответ/)

    const step = await prisma.videoGenerationStep.findFirst({ where: { videoId, stepKey: "shot_background" as never } })
    expect(step?.status).toBe("failed")
    expect(Number(step!.actualCost)).toBeCloseTo(PROMPT_COST, 6)

    const ledgerRows = await prisma.aiAuditLog.findMany({
      where: { videoId, stepKey: "shot_background", service: "anthropic" },
    })
    expect(ledgerRows).toHaveLength(1)
    expect(Number(ledgerRows[0]!.costUsd)).toBeCloseTo(PROMPT_COST, 6)
  })

  it("M-C: VideoShot.costUsd — ФАКТ от провайдера, а не СМЕТА плана (числа разведены нарочно)", async () => {
    await makeShot({ order: 0, idea: "фон кадра" })

    // Смета плана для одной картинки — $0.025 (тариф flux-dev,
    // model-specs.ts). Мок провайдера возвращает ДРУГОЕ число: различить
    // факт и смету можно, только если в VideoShot.costUsd пишется реально
    // вернувшееся число, а не результат planShotBackgroundExecution.
    const deps = happyDeps({
      generateImage: vi.fn(async (args: { order: number }) => ({ localPath: `/tmp/shot-${args.order}.png`, costUsd: 0.031 })),
    })
    await runShotBackgrounds(baseShotInput(), deps)

    const shot = await prisma.videoShot.findFirst({ where: { videoId, order: 0 } })
    expect(Number(shot!.costUsd)).toBeCloseTo(0.031, 6)
    expect(Number(shot!.costUsd)).not.toBeCloseTo(0.025, 6)
  })

  it("M-D: ролик целиком на библиотечных фонах — planPrompts не вызван, строки anthropic в ledger нет", async () => {
    const clip = await prisma.backgroundClip.create({
      data: { appId, storageKey: StorageKeys.backgroundClip(appId, "libshot1"), sha1: "libshot1", kind: "screen_recording" },
    })
    await makeShot({ order: 0, background: "library", backgroundClipId: clip.id, idea: null })

    const deps = happyDeps()
    const result = await runShotBackgrounds(baseShotInput(), deps)

    expect(deps.planPrompts).toHaveBeenCalledTimes(0)
    expect(result.costUsd).toBe(0)

    const anthropicRows = await prisma.aiAuditLog.findMany({
      where: { videoId, stepKey: "shot_background", service: "anthropic" },
    })
    expect(anthropicRows).toHaveLength(0)
  })

  /**
   * Critical 1 финального ревью ветки. Модель промптов НЕДЕТЕРМИНИРОВАНА —
   * ровно как в проде: `callAnthropicAgent` не задаёт `temperature`, то есть
   * работает на дефолте 1.0, и один и тот же вход даёт РАЗНЫЙ текст.
   *
   * Все остальные фикстуры этого файла строят промпт ЧИСТОЙ функцией от
   * входов — допущение, которого у прода нет. Пока отпечаток кадра включал
   * текст промпта, любой промах ОБЩЕГО ключа шага перерисовывал и
   * переоплачивал ВСЕ кадры (~$1 вместо обещанных $0.003), и ни один из 2845
   * тестов этого не видел.
   */
  function nondeterministicDeps(overrides: Partial<ShotBackgroundStepDeps> = {}): ShotBackgroundStepDeps {
    let call = 0
    return happyDeps({
      planPrompts: vi.fn(async (promptInput: {
        shots: Array<{ order: number, idea: string | null }>
        visualStyle: string | null
        onUsage?: (u: EditPlanModelUsage) => void
      }) => {
        call += 1
        promptInput.onUsage?.(PROMPT_USAGE)
        return {
          prompts: promptInput.shots.map(s => ({
            order: s.order,
            // Тот же вход — каждый раз ДРУГОЙ текст, как у модели на temperature 1.0.
            prompt: `промпт ${s.order} (прогон ${call}, ${Math.random()}): ${s.idea ?? "без идеи"}`.padEnd(60, "."),
            purpose: "тест",
          })),
          usage: PROMPT_USAGE,
        }
      }),
      ...overrides,
    })
  }

  it("Critical 1: промах ключа шага при НЕДЕТЕРМИНИРОВАННОЙ модели не переоплачивает ни одного кадра", async () => {
    await makeShot({ order: 0, idea: "фон первого кадра" })
    await makeShot({ order: 1, idea: "фон второго кадра" })

    const deps1 = nondeterministicDeps()
    const first = await runShotBackgrounds(baseShotInput(), deps1)
    expect(first.renderedCount).toBe(2)

    const assetsBefore = await prisma.videoAsset.findMany({
      where: { videoId, type: "shot_background" as never }, orderBy: { order: "asc" },
    })

    // Промах ОБЩЕГО ключа шага БЕЗ единого изменения во входах кадров:
    // отпечаток трека сменился (трек пересинтезирован), а идеи, стиль, формат,
    // качество и модели — те же. Агент промптов дёргается заново и отдаёт
    // ДРУГОЙ текст на те же кадры.
    const deps2 = nondeterministicDeps()
    const second = await runShotBackgrounds(baseShotInput({ trackFingerprint: "fp-2" }), deps2)

    // Один вызов агента — это и есть обещанные $0.003 за повтор.
    expect(deps2.planPrompts).toHaveBeenCalledTimes(1)
    // А вот кадры переоплачены быть не должны НИ ОДИН: их входы не менялись.
    expect(deps2.generateImage).toHaveBeenCalledTimes(0)
    expect(deps2.generateVideo).toHaveBeenCalledTimes(0)
    expect(second.renderedCount).toBe(0)
    expect(second.reusedCount).toBe(2)
    expect(second.costUsd).toBeCloseTo(PROMPT_COST, 6)

    const assetsAfter = await prisma.videoAsset.findMany({
      where: { videoId, type: "shot_background" as never }, orderBy: { order: "asc" },
    })
    // Отпечатки не сдвинулись — они не зависят от ВЫХОДА модели.
    expect(assetsAfter.map(a => a.prompt)).toEqual(assetsBefore.map(a => a.prompt))
    expect(assetsAfter.map(a => a.filePath)).toEqual(assetsBefore.map(a => a.filePath))
  })

  it("Critical 1: отказ провайдера на ОДНОМ кадре при недетерминированной модели — заново платится только он", async () => {
    await makeShot({ order: 0, idea: "фон первого кадра" })
    await makeShot({ order: 1, idea: "фон второго кадра" })

    // Кадр 1 отказал → executionWarnings → ключ шага сохраняется как null,
    // следующий прогон пересчитывает ВСЁ (докстринг runShotBackgrounds).
    const deps1 = nondeterministicDeps({
      generateImage: vi.fn(async (args: { order: number }) => {
        if (args.order === 1) throw new Error("Replicate недоступен (симуляция)")
        return { localPath: `/tmp/shot-${args.order}.png`, costUsd: 0.025 }
      }),
    })
    const first = await runShotBackgrounds(baseShotInput(), deps1)
    expect(first.status).toBe("degraded")

    const deps2 = nondeterministicDeps()
    const second = await runShotBackgrounds(baseShotInput(), deps2)

    // Успешный кадр 0 защищён отпечатком входов и переиспользуется бесплатно.
    expect(deps2.generateImage).toHaveBeenCalledTimes(1)
    expect(deps2.generateImage).toHaveBeenCalledWith(expect.objectContaining({ order: 1 }))
    expect(second.renderedCount).toBe(1)
    expect(second.reusedCount).toBe(1)
  })

  it("Critical 1: смена idea ОДНОГО кадра при недетерминированной модели перерисовывает ТОЛЬКО его", async () => {
    await makeShot({ order: 0, idea: "фон первого кадра" })
    const shot1 = await makeShot({ order: 1, idea: "фон второго кадра" })

    await runShotBackgrounds(baseShotInput(), nondeterministicDeps())
    await prisma.videoShot.update({ where: { id: shot1.id }, data: { idea: "фон второго кадра — переписан" } })

    const deps2 = nondeterministicDeps()
    const result2 = await runShotBackgrounds(baseShotInput(), deps2)

    expect(deps2.generateImage).toHaveBeenCalledTimes(1)
    expect(deps2.generateImage).toHaveBeenCalledWith(expect.objectContaining({ order: 1 }))
    expect(result2.renderedCount).toBe(1)
    expect(result2.reusedCount).toBe(1)
  })

  /**
   * Таблица ВХОДОВ отпечатка кадра (Critical 1 финального ревью): отпечаток
   * обязан меняться от каждого входа, который меняет произведённый файл, —
   * и не меняться от того, что к кадру отношения не имеет.
   *
   * Последние два ряда — пара, разведённая нарочно: `trackFingerprint`
   * промахивает ОБЩИЙ ключ шага, но входом кадра не является (перерисовки
   * быть не должно); тот же промах ПЛЮС другая реплика сцены — вход кадра
   * сменился, перерисовка обязательна. `sceneText` в общий ключ шага не
   * входит вовсе, поэтому в одиночку он проверяем только так.
   *
   * Тест красит красным удаление ЛЮБОГО поля из отпечатка: ряд этого поля
   * ждёт `renderedCount: 1`, а получит переиспользование.
   */
  const FINGERPRINT_CASES: Array<{
    name: string
    second: Partial<VideoShotBackgroundInput>
    patchShot?: { endSec: number }
    redraws: boolean
  }> = [
    { name: "visualStyle", second: { visualStyle: "неоновый киберпанк" }, redraws: true },
    { name: "appName", second: { appName: "Мойка-24" }, redraws: true },
    { name: "format", second: { format: "landscape" }, redraws: true },
    { name: "renderQuality", second: { renderQuality: "low" }, redraws: true },
    {
      name: "llmModelId профиля",
      second: { profile: { ...DEFAULT_EDIT_PROFILE, llmModelId: "claude-opus-4-1" } },
      redraws: true,
    },
    { name: "imageModelId", second: { imageModelId: "fal:flux-schnell" }, redraws: true },
    {
      // Правка 26.08.2026 (группировка фонов, требование 2 отчёта
      // background-reuse-report.md): для КАРТИНОЧНОГО фона длительность
      // кадра вышла из отпечатка — картинка статична, сколько она держится
      // на экране решает монтаж (still-клип), а не генерация. До правки этот
      // ряд ждал redraws:true (длительность шла в промпт как темп сцены) —
      // намеренно ослаблено ВЛАДЕЛЬЦЕМ задачи, не по недосмотру: перерисовка
      // впятеро дороже группы кадров ценой нюанса темпа в промпте была
      // признана невыгодной. Симметричный ряд для ВИДЕО (где длительность
      // реально определяет заказ у Kling и остаётся в отпечатке) — тест
      // "генеративное видео: смена длительности перерисовывает кадр" ниже.
      name: "длительность кадра картинки — БОЛЬШЕ не вход отпечатка",
      second: { trackFingerprint: "fp-2" },
      patchShot: { endSec: 5 },
      redraws: false,
    },
    {
      name: "sceneText (реплика под кадром)",
      second: { trackFingerprint: "fp-2", sceneTextByOrder: new Map([[7, "совсем другая реплика"]]) },
      redraws: true,
    },
    { name: "trackFingerprint — НЕ вход кадра", second: { trackFingerprint: "fp-2" }, redraws: false },
  ]

  it.each(FINGERPRINT_CASES)(
    "отпечаток кадра: смена «$name» → перерисовка = $redraws",
    async ({ second, patchShot, redraws }) => {
      const sceneTextByOrder = new Map([[7, "исходная реплика сцены"]])
      const shot = await makeShot({ order: 0, sceneOrder: 7, idea: "фон кадра" })

      const deps1 = nondeterministicDeps()
      await runShotBackgrounds(baseShotInput({ sceneTextByOrder }), deps1)
      expect(deps1.generateImage).toHaveBeenCalledTimes(1)

      if (patchShot) await prisma.videoShot.update({ where: { id: shot.id }, data: patchShot })

      const deps2 = nondeterministicDeps()
      const result = await runShotBackgrounds(baseShotInput({ sceneTextByOrder, ...second }), deps2)

      expect(deps2.generateImage).toHaveBeenCalledTimes(redraws ? 1 : 0)
      expect(result.renderedCount).toBe(redraws ? 1 : 0)
      expect(result.reusedCount).toBe(redraws ? 0 : 1)
    },
  )

  it("backgroundActual хранит ФАКТ произведённого, background (план) не трогается", async () => {
    // 6с кадр — план просит "video", но потолок $0.30 ниже цены клипа $0.50 —
    // деградация до картинки. background остаётся "video" (план), а
    // backgroundActual обязан отражать то, что реально произведено ("image").
    await makeShot({ order: 0, startSec: 0, endSec: 6, background: "video", idea: "движение камеры" })

    const profile = { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 0.3 }
    await runShotBackgrounds(baseShotInput({ profile }), happyDeps())

    const shot = await prisma.videoShot.findFirst({ where: { videoId, order: 0 } })
    expect(shot!.background).toBe("video")
    expect(shot!.backgroundActual).toBe("image")
  })

  it("генеративное видео: смена длительности кадра ПЕРЕРИСОВЫВАЕТ — длительность остаётся в отпечатке (требование 2 не задевает video)", async () => {
    const shot = await makeShot({ order: 0, startSec: 0, endSec: 6, background: "video", idea: "полёт дрона" })
    const profile = { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 5 }

    const deps1 = happyDeps()
    await runShotBackgrounds(baseShotInput({ profile }), deps1)
    expect(deps1.generateVideo).toHaveBeenCalledTimes(1)

    // Длительность меняется (6с -> 9с), idea та же. trackFingerprint форсирует
    // промах ОБЩЕГО ключа шага, чтобы дойти до отпечатка НА кадр.
    await prisma.videoShot.update({ where: { id: shot.id }, data: { endSec: 9 } })
    const deps2 = happyDeps()
    const result2 = await runShotBackgrounds(baseShotInput({ profile, trackFingerprint: "fp-2" }), deps2)

    expect(deps2.generateVideo).toHaveBeenCalledTimes(1)
    expect(result2.renderedCount).toBe(1)
  })

  // ── Группировка фонов кадров (правка 26.08.2026): подряд идущие кадры с
  //    ОДНИМ и тем же запрошенным фоном получают ОДНУ генерацию и ОДИН файл,
  //    а не свою генерацию на каждый (дефект «фон меняется каждые 1.8 с»,
  //    ролик 30 — см. background-reuse-report.md). Группировка переиспользует
  //    ту же (`shotBackgroundIdentity`/`planShotVariationSlices`), что уже
  //    держит непрерывность движения камеры (коммит 82e6790).
  describe("группировка фонов кадров (одна генерация на группу)", () => {
    /** Пять подряд идущих кадров по 1.8с с одной idea — реальная форма плана §7. */
    async function makeGroup(idea: string, count = 5) {
      const shots = []
      for (let i = 0; i < count; i += 1) {
        shots.push(await makeShot({ order: i, startSec: i * 1.8, endSec: (i + 1) * 1.8, idea }))
      }
      return shots
    }

    it("пять подряд идущих кадров с одной idea дают ОДНУ генерацию и ОДИН файл", async () => {
      await makeGroup("фон группы")

      const deps = happyDeps()
      const result = await runShotBackgrounds(baseShotInput(), deps)

      // Провайдер картинок вызван РОВНО один раз — не пять.
      expect(deps.generateImage).toHaveBeenCalledTimes(1)
      expect(deps.generateImage).toHaveBeenCalledWith(expect.objectContaining({ order: 0 }))
      expect(result.renderedCount).toBe(1)
      expect(result.groupLinkedCount).toBe(4)
      expect(result.reusedCount).toBe(0)

      const assets = await prisma.videoAsset.findMany({
        where: { videoId, type: "shot_background" as never }, orderBy: { order: "asc" },
      })
      expect(assets).toHaveLength(5)
      // ОДИН файл на всю группу — не пять разных.
      const paths = new Set(assets.map(a => a.filePath))
      expect(paths.size).toBe(1)
      expect([...paths][0]).toBe(assets[0]!.filePath)

      // Требование 4: сумма VideoShot.costUsd по группе сходится с фактом
      // ОДНОЙ генерации, а не платит впятеро.
      const shots = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
      const costSum = shots.reduce((sum, s) => sum + Number(s.costUsd), 0)
      expect(costSum).toBeCloseTo(0.025, 6)
      expect(Number(shots[0]!.costUsd)).toBeCloseTo(0.025, 6)
      for (let i = 1; i < 5; i += 1) expect(Number(shots[i]!.costUsd)).toBe(0)

      // Сумма по кадрам обязана сходиться с тем, что реально списано в ledger
      // (не только со сметой): реплика вернёт то же число, потому что реальных
      // трат ОДНА генерация.
      const replicateRows = await prisma.aiAuditLog.findMany({ where: { videoId, stepKey: "shot_background", service: "replicate" } })
      const ledgerSum = replicateRows.reduce((sum, r) => sum + Number(r.costUsd), 0)
      expect(ledgerSum).toBeCloseTo(costSum, 6)
    })

    it("промпт просят ОДИН раз на группу, а не на каждый кадр", async () => {
      await makeGroup("фон группы")
      const deps = happyDeps()
      await runShotBackgrounds(baseShotInput(), deps)
      expect(deps.planPrompts).toHaveBeenCalledTimes(1)
      const call = (deps.planPrompts as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { shots: Array<{ order: number }> }
      expect(call.shots.map(s => s.order)).toEqual([0])
    })

    it("повторный прогон сгруппированного плана не платит второй раз ни за одного из пяти", async () => {
      await makeGroup("фон группы")
      await runShotBackgrounds(baseShotInput(), happyDeps())

      const assetsAfterFirst = await prisma.videoAsset.findMany({
        where: { videoId, type: "shot_background" as never }, orderBy: { order: "asc" },
      })

      const deps2 = happyDeps()
      const second = await runShotBackgrounds(baseShotInput(), deps2)

      expect(deps2.generateImage).toHaveBeenCalledTimes(0)
      expect(deps2.planPrompts).toHaveBeenCalledTimes(0)
      expect(second.costUsd).toBe(0)
      expect(second.renderedCount).toBe(0)
      expect(second.groupLinkedCount).toBe(0)
      expect(second.reusedCount).toBe(5)

      const assetsAfterSecond = await prisma.videoAsset.findMany({
        where: { videoId, type: "shot_background" as never }, orderBy: { order: "asc" },
      })
      expect(assetsAfterSecond.map(a => a.id).sort()).toEqual(assetsAfterFirst.map(a => a.id).sort())
      expect(assetsAfterSecond.map(a => a.filePath)).toEqual(assetsAfterFirst.map(a => a.filePath))
    })

    it("смена idea у ОДНОГО среднего кадра разрывает группу и перерисовывает только новую мини-группу", async () => {
      const shots = await makeGroup("фон группы")
      await runShotBackgrounds(baseShotInput(), happyDeps())

      const assetsBefore = await prisma.videoAsset.findMany({
        where: { videoId, type: "shot_background" as never }, orderBy: { order: "asc" },
      })
      const originalFilePath = assetsBefore[0]!.filePath

      // Кадр 2 (средний) получает свою идею — группа [0,1,2,3,4] рвётся на
      // [0,1] / [2] / [3,4].
      await prisma.videoShot.update({ where: { id: shots[2]!.id }, data: { idea: "другая идея" } })

      const deps2 = happyDeps()
      const result2 = await runShotBackgrounds(baseShotInput(), deps2)

      // Единственная НОВАЯ генерация — кадр 2 (новый лидер своей мини-группы).
      expect(deps2.generateImage).toHaveBeenCalledTimes(1)
      expect(deps2.generateImage).toHaveBeenCalledWith(expect.objectContaining({ order: 2 }))
      expect(result2.renderedCount).toBe(1)

      const assetsAfter = await prisma.videoAsset.findMany({
        where: { videoId, type: "shot_background" as never }, orderBy: { order: "asc" },
      })
      // Кадры 0, 1 — тот же файл, что и раньше (подгруппа не задета).
      expect(assetsAfter[0]!.filePath).toBe(originalFilePath)
      expect(assetsAfter[1]!.filePath).toBe(originalFilePath)
      // Кадр 2 — НОВЫЙ файл (своя идея).
      expect(assetsAfter[2]!.filePath).not.toBe(originalFilePath)
      // Кадры 3, 4 — идея вернулась к прежней, отпечаток совпадает с
      // отпечатком исходной группы (по значениям, не по order) — тот же файл
      // переиспользован БЕЗ похода к провайдеру, хотя лидер сменился (0 -> 3).
      expect(assetsAfter[3]!.filePath).toBe(originalFilePath)
      expect(assetsAfter[4]!.filePath).toBe(originalFilePath)
    })

    it("две НЕсоседние группы с одинаковой idea дают ДВЕ генерации — переиспользование не сквозное по ролику", async () => {
      // Кадры 0-1 идея "A", кадр 2 идея "B" (разрывает смежность), кадры 3-4
      // снова идея "A". Решение (см. отчёт): группировка переиспользует ТУ ЖЕ,
      // что и непрерывность движения камеры, а она не сливает несмежные
      // группы — сквозной кэш "idea -> файл" на весь ролик не заказан этой
      // правкой и добавил бы отдельный класс риска (устаревшая картинка из
      // начала ролика молча выехала бы в конец).
      await makeShot({ order: 0, startSec: 0, endSec: 1.8, idea: "A" })
      await makeShot({ order: 1, startSec: 1.8, endSec: 3.6, idea: "A" })
      await makeShot({ order: 2, startSec: 3.6, endSec: 5.4, idea: "B" })
      await makeShot({ order: 3, startSec: 5.4, endSec: 7.2, idea: "A" })
      await makeShot({ order: 4, startSec: 7.2, endSec: 9.0, idea: "A" })

      const deps = happyDeps()
      const result = await runShotBackgrounds(baseShotInput(), deps)

      expect(deps.generateImage).toHaveBeenCalledTimes(3)
      const orders = (deps.generateImage as ReturnType<typeof vi.fn>).mock.calls.map(c => (c[0] as { order: number }).order).sort((a, b) => a - b)
      expect(orders).toEqual([0, 2, 3])
      expect(result.renderedCount).toBe(3)
      expect(result.groupLinkedCount).toBe(2)

      const assets = await prisma.videoAsset.findMany({
        where: { videoId, type: "shot_background" as never }, orderBy: { order: "asc" },
      })
      // Группа [0,1] и группа [3,4] — РАЗНЫЕ файлы, хотя idea одна и та же.
      expect(assets[0]!.filePath).toBe(assets[1]!.filePath)
      expect(assets[3]!.filePath).toBe(assets[4]!.filePath)
      expect(assets[0]!.filePath).not.toBe(assets[3]!.filePath)
    })

    it("отказ провайдера на лидере группы — вся группа деградирует до none, а не пытается получить фон каждый по отдельности", async () => {
      const shots = await makeGroup("фон группы")
      // §10: ролик не имеет права дойти до "готов", если совсем нечего
      // показывать — ведущий на весь экран держит кадры видимыми, пока
      // проверяется именно "одна попытка провайдера на группу", а не §10.
      await prisma.videoShot.update({ where: { id: shots[0]!.id }, data: { foreground: "presenter" } })
      const deps = happyDeps({
        generateImage: vi.fn(async () => { throw new Error("Replicate недоступен (симуляция)") }),
      })

      const result = await runShotBackgrounds(baseShotInput(), deps)

      // Один провал провайдера — одна попытка, не пять.
      expect(deps.generateImage).toHaveBeenCalledTimes(1)
      expect(result.status).toBe("degraded")

      const shotsAfter = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
      for (const s of shotsAfter) {
        expect(s.backgroundActual).toBe("none")
        expect(s.degradeReason).toBeTruthy()
        expect(Number(s.costUsd)).toBe(0)
      }
      const assets = await prisma.videoAsset.findMany({ where: { videoId, type: "shot_background" as never } })
      expect(assets).toHaveLength(0)
    })

    it("унаследованный costUsd последователя обнуляется группировкой, а не остаётся от старого прогона", async () => {
      const shots = await makeGroup("фон группы", 2)
      // Симулирует данные до этой правки: кадр 1 когда-то платил САМ по себе.
      await prisma.videoShot.update({ where: { id: shots[1]!.id }, data: { costUsd: 0.5 } })

      await runShotBackgrounds(baseShotInput(), happyDeps())

      const shot1After = await prisma.videoShot.findFirst({ where: { videoId, order: 1 } })
      expect(Number(shot1After!.costUsd)).toBe(0)
    })

    /**
     * Группировка ГЕНЕРАТИВНОГО ВИДЕО (правка 27.08.2026): раньше пять подряд
     * идущих кадров с одной идеей давали пять независимых заказов Kling.
     */
    it("два подряд идущих видео-кадра с одной idea — ОДИН заказ провайдеру, платит лидер", async () => {
      await prisma.videoShot.create({
        data: {
          videoId, order: 0, startSec: 0, endSec: 5, sceneOrder: null,
          foreground: "none", background: "video", idea: "полёт дрона над городом",
        },
      })
      await prisma.videoShot.create({
        data: {
          videoId, order: 1, startSec: 5, endSec: 10, sceneOrder: null,
          foreground: "none", background: "video", idea: "полёт дрона над городом",
        },
      })

      const deps = happyDeps()
      const profile = { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 5 }
      const result = await runShotBackgrounds(baseShotInput({ profile }), deps)

      // Один вызов на группу, длиной во всю группу (10 с), а не два по 5 с.
      expect(deps.generateVideo).toHaveBeenCalledTimes(1)
      expect(deps.generateVideo).toHaveBeenCalledWith(expect.objectContaining({ order: 0, billedSec: 10 }))
      // Промпт тоже один на группу.
      expect(deps.planPrompts).toHaveBeenCalledTimes(1)
      expect(result.status).toBe("completed")

      const shots = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
      expect(shots.map(s => s.backgroundActual)).toEqual(["video", "video"])
      // Деньги списаны один раз — на кадре, который клип произвёл.
      expect(Number(shots[0]!.costUsd)).toBeCloseTo(0.5, 6)
      expect(Number(shots[1]!.costUsd)).toBe(0)

      // Оба кадра адресуют ОДИН файл: композиция возьмёт из него свои куски.
      const assets = await prisma.videoAsset.findMany({
        where: { videoId, type: "shot_background" as never },
        orderBy: { order: "asc" },
      })
      expect(assets).toHaveLength(2)
      expect(assets[0]!.filePath).toBe(assets[1]!.filePath)
    })

    it("видео-кадры короче минимума модели по-прежнему идут картинками — слияние не открывает видео в обход §7", async () => {
      for (const order of [0, 1, 2]) {
        await prisma.videoShot.create({
          data: {
            videoId, order, startSec: order * 1.8, endSec: order * 1.8 + 1.8, sceneOrder: null,
            foreground: "none", background: "video", idea: "полёт дрона над городом",
          },
        })
      }

      const deps = happyDeps()
      const profile = { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 5 }
      await runShotBackgrounds(baseShotInput({ profile }), deps)

      expect(deps.generateVideo).toHaveBeenCalledTimes(0)
      // Картинка — одна на группу: деградировавшие видео-кадры группируются как картинки.
      expect(deps.generateImage).toHaveBeenCalledTimes(1)
      const shots = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
      expect(shots.map(s => s.backgroundActual)).toEqual(["image", "image", "image"])
    })
  })
})

/**
 * Ruling S8-9: перезапуск шага, который производит МАТЕРИАЛ внутри кадра
 * (клипы сцен, lip-sync), обязан обесценить уже собранные кадры.
 *
 * `shot_${order}_composed.mp4` — не `VideoAsset`, каскад `assetTypesForSteps`
 * его не знает, а `composeVideoShots` переиспользует кадр по ключу «путь из
 * `assetPath` + `status=completed` + файл на диске», в котором содержимого
 * нет вовсе. `shot_background` стоит РАНЬШЕ клипов и lip-sync в
 * `STEP_EXECUTION_ORDER_AUDIO_FIRST`, поэтому его ключ кэша при таком
 * перезапуске цел, `runShotBackgrounds` не трогает ни одной строки
 * `VideoShot` — и оператор платит за новый lip-sync, получая ролик байт в
 * байт прежним, без единой ошибки.
 *
 * Перезапуск `assembly` под это правило не подпадает: материал кадра тот же,
 * пересборка ffmpeg по каждому кадру (до 180 с на ветке PiP) была бы платой
 * временем ни за что — идемпотентность Ruling S8-7.
 */
describe("каскад перезапуска: собранные кадры (Ruling S8-9)", () => {
  async function makeComposedShot(order: number): Promise<{ id: string, path: string }> {
    const dir = getAssetsDir(videoId)
    await ensureDir(dir)
    const path = join(dir, `shot_${order}_composed.mp4`)
    await writeFile(path, `собранный кадр ${order} прошлого прогона`)
    const shot = await prisma.videoShot.create({
      data: {
        videoId,
        order,
        startSec: order * 2,
        endSec: order * 2 + 2,
        sceneOrder: 1,
        foreground: "presenter",
        background: "none",
        backgroundActual: "none",
        status: "completed",
        assetPath: path,
      },
    })
    return { id: shot.id, path }
  }

  const MATERIAL_STEPS: StepKey[] = ["clip_generation", "lip_sync_generation"]

  it.each(MATERIAL_STEPS)("перезапуск %s обесценивает собранные кадры — оплаченный заново материал доезжает до ролика", async (stepKey) => {
    const first = await makeComposedShot(0)
    const second = await makeComposedShot(1)

    await resetComposedShots(videoId, stepKey, stepsToRerunFrom(stepKey, true))

    for (const shot of [first, second]) {
      const after = await prisma.videoShot.findUnique({ where: { id: shot.id } })
      expect(after).not.toBeNull()
      expect(after!.assetPath).toBeNull()
      expect(existsSync(shot.path)).toBe(false)
    }

    // Кадр и его оплаченный фон остаются: перезапуск lip-sync не повод
    // заново платить за картинки (их каскад — `resetEditPlanShots`).
    expect(await prisma.videoShot.count({ where: { videoId } })).toBe(2)
  })

  it("перезапуск assembly собранные кадры не трогает — ffmpeg по готовым кадрам заново не гоняется (Ruling S8-7)", async () => {
    const shot = await makeComposedShot(0)

    await resetComposedShots(videoId, "assembly", stepsToRerunFrom("assembly", true))

    const after = await prisma.videoShot.findUnique({ where: { id: shot.id } })
    expect(after!.assetPath).toBe(shot.path)
    expect(existsSync(shot.path)).toBe(true)
  })

  it("перезапуск music_generation собранные кадры не трогает — музыка живёт отдельной дорожкой", async () => {
    const shot = await makeComposedShot(0)

    await resetComposedShots(videoId, "music_generation", stepsToRerunFrom("music_generation", true))

    const after = await prisma.videoShot.findUnique({ where: { id: shot.id } })
    expect(after!.assetPath).toBe(shot.path)
    expect(existsSync(shot.path)).toBe(true)
  })

  it("файл собранного кадра вне каталога ассетов не удаляется, но кадр всё равно обесценивается", async () => {
    // Путь из чужого каталога в БД возможен только порчей данных, но
    // `removeAssetFiles` обязан отказаться его трогать (isPathInsideDir), а
    // строку это не оправдывает: кадр всё равно должен пересобраться.
    const outside = join(tmpdir(), `cf-outside-${videoId}.mp4`)
    await writeFile(outside, "чужой файл")
    const shot = await prisma.videoShot.create({
      data: {
        videoId, order: 0, startSec: 0, endSec: 2, sceneOrder: 1,
        foreground: "presenter", background: "none", status: "completed", assetPath: outside,
      },
    })

    await resetComposedShots(videoId, "lip_sync_generation", stepsToRerunFrom("lip_sync_generation", true))

    const after = await prisma.videoShot.findUnique({ where: { id: shot.id } })
    expect(after!.assetPath).toBeNull()
    expect(existsSync(outside)).toBe(true)
    await rm(outside, { force: true })
  })
})

  })
})
