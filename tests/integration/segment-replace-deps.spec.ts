/**
 * Боевые порты раннера замены сегмента — маппинг на prisma.
 *
 * Вся денежная логика замены проверена DB-free через фейковые порты
 * (`tests/unit/voiceover/segment-replace-runner.spec.ts`). Непокрытым оставался
 * ровно один слой — `createReplaceSegmentDeps()`: имена полей, каст enum'ов,
 * транзакция и инкремент попытки. Ошибка здесь не ловится ни одним чистым
 * тестом и вылезает только в бою — то есть уже после списания денег.
 *
 * Платных вызовов тут нет и быть не может: проверяются ТОЛЬКО порты `store`
 * (БД), `media`-порты (ffmpeg, TTS, транскрипция, хранилище) не трогаются вовсе.
 *
 * Отдельный файл, а не дописка в `segment-replace.spec.ts`: тот сценарный, этот
 * контрактный — падение здесь означает «порт врёт про БД», а не «замена не
 * работает».
 */

import { beforeEach, describe, expect, it } from "vitest"

import { prisma } from "~~/server/utils/prisma"
import { createReplaceSegmentDeps } from "~~/server/utils/voiceover/segment-replace-runner"

// `logAgent` — авто-импорт Nitro; вне Nitro-процесса его подставляет тест,
// иначе `appendStepLog` падает ReferenceError на первом же логе.
import { logAgent } from "~~/server/utils/agent-logger"
;(globalThis as Record<string, unknown>).logAgent = logAgent

const STORY_PLAN = {
  version: "1.0",
  scenes: [
    { order: 1, spokenLine: "Первая реплика." },
    { order: 2, spokenLine: "Вторая реплика." },
  ],
  voiceoverPlan: { enabled: true, lines: [] as Array<{ sceneOrder: number, text: string }> },
}

let videoId: number
let variantId: number
let voiceoverStepId: number
let transcriptionStepId: number

beforeEach(async () => {
  // beforeEach, не beforeAll: tests/setup.ts делает TRUNCATE после каждого it.
  const scenario = await prisma.scenario.create({ data: { status: "draft" } })
  const variant = await prisma.scenarioVariant.create({
    data: {
      scenarioId: scenario.id,
      variantIndex: 0,
      title: "t",
      hook: "h",
      body: "b",
      cta: "c",
      fullScript: "s",
      visualStyleText: "v",
      storyPlan: STORY_PLAN as never,
    },
  })
  variantId = variant.id

  const video = await prisma.video.create({
    data: {
      scenarioId: scenario.id,
      variantId: variant.id,
      editPipeline: true,
      voiceoverLanguage: "ru",
      voiceoverPacing: "moderate",
      voiceoverVoiceId: "voice-1",
      voiceoverModelId: "minimax/speech-02-turbo",
    },
  })
  videoId = video.id

  const voiceover = await prisma.videoGenerationStep.create({
    data: {
      videoId,
      stepKey: "voiceover_generation" as never,
      stepIndex: 3,
      status: "completed" as never,
      attemptCount: 1,
      actualCost: 0.07,
      outputSnapshot: {
        route: "audio_first",
        trackPath: "/assets/track.mp3",
        durationSec: 20,
        trackFingerprint: "fp-1",
        scenes: [{ order: 1, text: "Первая реплика." }, { order: 2, text: "Вторая реплика." }],
      } as never,
    },
  })
  voiceoverStepId = voiceover.id

  const transcription = await prisma.videoGenerationStep.create({
    data: {
      videoId,
      stepKey: "transcription" as never,
      stepIndex: 4,
      status: "completed" as never,
      outputSnapshot: { trackFingerprint: "fp-1", scenes: [] } as never,
    },
  })
  transcriptionStepId = transcription.id
})

describe("createReplaceSegmentDeps — порты замены сегмента на prisma", () => {
  it("читает настройки голоса ролика", async () => {
    const video = await createReplaceSegmentDeps().store.loadVideo(videoId)

    expect(video).toMatchObject({
      isLocked: false,
      voiceoverLanguage: "ru",
      voiceoverPacing: "moderate",
      voiceoverVoiceId: "voice-1",
      voiceoverModelId: "minimax/speech-02-turbo",
    })
  })

  it("несуществующий ролик отдаёт null, а не бросает", async () => {
    expect(await createReplaceSegmentDeps().store.loadVideo(videoId + 100_000)).toBeNull()
  })

  it("читает шаг вместе со снапшотом", async () => {
    const step = await createReplaceSegmentDeps().store.readStep(videoId, "voiceover_generation")

    expect(step).toMatchObject({ id: voiceoverStepId, status: "completed" })
    expect((step!.snapshot as Record<string, unknown>).trackFingerprint).toBe("fp-1")
  })

  it("шага, которого нет, отдаёт null", async () => {
    expect(await createReplaceSegmentDeps().store.readStep(videoId, "lip_sync_generation")).toBeNull()
  })

  it("читает сценарий ролика из варианта", async () => {
    const script = await createReplaceSegmentDeps().store.loadScript(videoId)

    expect(script).toMatchObject({ variantId })
    expect((script!.storyPlan as typeof STORY_PLAN).scenes[1]!.spokenLine).toBe("Вторая реплика.")
  })

  it("ролик без варианта отдаёт пустой сценарий, а не падает", async () => {
    // Legacy-ролик: варианта нет, писать новый текст некуда. Раннер обязан
    // получить null и обойтись предупреждением, а не 500 посреди замены.
    await prisma.video.update({ where: { id: videoId }, data: { variantId: null } })

    expect(await createReplaceSegmentDeps().store.loadScript(videoId)).toBeNull()
  })

  it("пишет снапшоты и сценарий одной транзакцией", async () => {
    await createReplaceSegmentDeps().store.commit(
      [
        { stepId: transcriptionStepId, snapshot: { trackFingerprint: "fp-1", scenes: [{ order: 1 }] } },
        { stepId: voiceoverStepId, snapshot: { route: "audio_first", trackPath: "/assets/track-v2.mp3" } },
      ],
      {
        variantId,
        storyPlan: {
          ...STORY_PLAN,
          scenes: [STORY_PLAN.scenes[0]!, { order: 2, spokenLine: "Новая формулировка." }],
        },
      },
    )

    const voiceover = await prisma.videoGenerationStep.findUnique({ where: { id: voiceoverStepId } })
    const variant = await prisma.scenarioVariant.findUnique({ where: { id: variantId } })
    expect((voiceover!.outputSnapshot as Record<string, unknown>).trackPath).toBe("/assets/track-v2.mp3")
    expect((variant!.storyPlan as unknown as typeof STORY_PLAN).scenes[1]!.spokenLine)
      .toBe("Новая формулировка.")
  })

  it("сорвавшаяся фиксация не оставляет половину записей", async () => {
    // Это и есть смысл транзакции: трек с новой фразой при сценарии со старой
    // (или новое выравнивание при старом треке) — рассогласование, которое
    // потом никто не заметит, пока ролик не пересоберут.
    await expect(createReplaceSegmentDeps().store.commit(
      [
        { stepId: voiceoverStepId, snapshot: { route: "audio_first", trackPath: "/assets/track-v2.mp3" } },
        { stepId: voiceoverStepId + 100_000, snapshot: { boom: true } },
      ],
      { variantId, storyPlan: { ...STORY_PLAN, marker: "не должно доехать" } },
    )).rejects.toThrow()

    const voiceover = await prisma.videoGenerationStep.findUnique({ where: { id: voiceoverStepId } })
    const variant = await prisma.scenarioVariant.findUnique({ where: { id: variantId } })
    expect((voiceover!.outputSnapshot as Record<string, unknown>).trackPath).toBe("/assets/track.mp3")
    expect((variant!.storyPlan as Record<string, unknown>).marker).toBeUndefined()
  })

  it("расход замены идёт НОВОЙ попыткой шага, а не дублем первой", async () => {
    // Дедуп ledger'а завязан на (videoId × stepKey × service × attempt).
    // Запиши мы замену прежним номером попытки — расход молча пропал бы как
    // дубль первой синтезации, и burn-rate систематически занижался бы.
    await createReplaceSegmentDeps().store.recordCost({
      videoId,
      stepId: voiceoverStepId,
      stepKey: "voiceover_generation",
      costUsd: 0.07,
      modelId: "minimax/speech-02-turbo",
    })

    const step = await prisma.videoGenerationStep.findUnique({ where: { id: voiceoverStepId } })
    expect(step!.attemptCount).toBe(2)
    expect(step!.actualCost).toBeCloseTo(0.14, 6)

    const rows = await prisma.aiAuditLog.findMany({ where: { videoId, stepKey: "voiceover_generation" } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.costUsd).toBeCloseTo(0.07, 6)
  })

  it("вторая замена пишет ВТОРУЮ строку расхода, а не проглатывает её", async () => {
    const deps = createReplaceSegmentDeps()
    const cost = {
      videoId,
      stepId: voiceoverStepId,
      stepKey: "voiceover_generation",
      costUsd: 0.07,
      modelId: "minimax/speech-02-turbo",
    }

    await deps.store.recordCost(cost)
    await deps.store.recordCost(cost)

    const rows = await prisma.aiAuditLog.findMany({ where: { videoId, stepKey: "voiceover_generation" } })
    expect(rows).toHaveLength(2)
  })

  it("нулевой расход не пишется вовсе", async () => {
    await createReplaceSegmentDeps().store.recordCost({
      videoId,
      stepId: voiceoverStepId,
      stepKey: "voiceover_generation",
      costUsd: 0,
      modelId: null,
    })

    const step = await prisma.videoGenerationStep.findUnique({ where: { id: voiceoverStepId } })
    // Ни попытки, ни строки расхода: платного вызова не было.
    expect(step!.attemptCount).toBe(1)
    expect(await prisma.aiAuditLog.count({ where: { videoId } })).toBe(0)
  })

  it("в planned уходят кадры только сдвинувшихся сцен", async () => {
    await prisma.videoShot.createMany({
      data: [
        { videoId, order: 0, sceneOrder: 1, startSec: 0, endSec: 5, status: "composed" as never },
        { videoId, order: 1, sceneOrder: 2, startSec: 5, endSec: 10, status: "composed" as never },
        { videoId, order: 2, sceneOrder: 3, startSec: 10, endSec: 20, status: "composed" as never },
      ],
    })

    const affected = await createReplaceSegmentDeps().store.resetShots(videoId, [2, 3])

    expect(affected).toBe(2)
    const shots = await prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })
    // Кадр несдвинувшейся сцены остаётся собранным — второй раз платить за него
    // нельзя, в этом вся задача.
    expect(shots.map(shot => String(shot.status))).toEqual(["composed", "planned", "planned"])
  })

  it("пустой список сцен не трогает ни одного кадра", async () => {
    await prisma.videoShot.create({
      data: { videoId, order: 0, sceneOrder: 1, startSec: 0, endSec: 5, status: "composed" as never },
    })

    expect(await createReplaceSegmentDeps().store.resetShots(videoId, [])).toBe(0)
    const shot = await prisma.videoShot.findFirst({ where: { videoId } })
    expect(String(shot!.status)).toBe("composed")
  })

  it("ассет трека создаётся один раз и дальше обновляется", async () => {
    // Второй ассет voiceover_mix означал бы два «финальных» трека у ролика:
    // сборка взяла бы любой, и с равной вероятностью — прежний.
    const deps = createReplaceSegmentDeps()
    const input = {
      videoId,
      trackPath: "/assets/track-v2.mp3",
      durationSec: 20.95,
      storage: { storageKey: "zavodcamp/videos/1/voiceover_mix.mp3", fileSha256: "sha-1" },
    }

    await deps.store.saveTrackAsset(input)
    await deps.store.saveTrackAsset({ ...input, trackPath: "/assets/track-v3.mp3", durationSec: 21.4 })

    const assets = await prisma.videoAsset.findMany({ where: { videoId, type: "voiceover_mix" as never } })
    expect(assets).toHaveLength(1)
    expect(assets[0]!.filePath).toBe("/assets/track-v3.mp3")
    expect(assets[0]!.duration).toBe(21)
    expect(assets[0]!.fileSha256).toBe("sha-1")
  })

  it("лог шага дописывается, а не перезаписывается", async () => {
    const deps = createReplaceSegmentDeps()

    await deps.store.appendLog(voiceoverStepId, "первая строка")
    await deps.store.appendLog(voiceoverStepId, "вторая строка")

    const step = await prisma.videoGenerationStep.findUnique({ where: { id: voiceoverStepId } })
    expect(JSON.stringify(step!.logs)).toContain("первая строка")
    expect(JSON.stringify(step!.logs)).toContain("вторая строка")
  })
})
