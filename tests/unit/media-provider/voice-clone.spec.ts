/**
 * Клон голоса ведущего как операция сервера (Task 5, шаги 6-7 плана
 * `docs/superpowers/plans/2026-08-17-segment-replace-and-ui.md`, §9 спеки
 * `docs/superpowers/specs/2026-08-16-audio-first-editing-design.md`).
 *
 * Спека модели (`replicate:minimax-voice-cloning`) проверена отдельно
 * (`voice-cloning-spec.spec.ts`). Здесь — всё, что вокруг неё и чего спека знать
 * не может, потому что не скачивает файл и не ходит в БД:
 *
 *  1. ПОДТВЕРЖДЕНИЕ СУММЫ. Прогон стоит $3 — прямой перенос `--yes` из
 *     `scripts/clone-voice.ts`. Сумма сверяется со СПЕКОЙ, а не с константой
 *     этого модуля: разъехавшись, они означали бы «подтвердил одно, списали другое».
 *  2. ПРОВЕРКИ ДО ОПЛАТЫ. Формат, размер и длительность модель проверяет уже
 *     ПОСЛЕ создания задачи, то есть за наши деньги.
 *  3. ИДЕМПОТЕНТНОСТЬ. Повторная заливка того же образца под ту же целевую
 *     модель не платит второй раз — ни по записи персонажа, ни (если запись не
 *     доехала) по уже оплаченному результату в нашем хранилище.
 *  4. ПУБЛИЧНЫЙ URL ОБРАЗЦА. `minimax/voice-cloning` — прокси к API MiniMax:
 *     файл скачивает сам MiniMax, без наших заголовков. Ссылка Files API
 *     (`api.replicate.com/v1/files/{id}`) непригодна дважды — приватная (401) и
 *     без расширения, а формат MiniMax читает из пути
 *     (`docs/operations/replicate.md` §«Голос ведущей»).
 *  5. РАЗБОР ВЫХОДА. В ответе обязан быть `voice_id`. Мок-режим стенда до сих
 *     пор отдавал на этой ветке ТРАНСКРИПТ (`{text, chunks}`) — такой ответ
 *     обязан ломаться громко, а не записывать персонажу пустой голос.
 *  6. УЧЁТ. $3 попадают в ledger ровно один раз и только за реальный прогон.
 */

import { describe, expect, it, vi } from "vitest"

import {
  cloneCharacterVoice,
  extractClonedVoiceId,
  resolveVoiceSampleExtension,
  resolveVoiceSamplePublicUrl,
  type VoiceCloneCharacter,
  type VoiceCloneDeps,
  type VoiceCloneStorage,
} from "../../../server/utils/media-provider/voice-clone"
import { listMediaSpecs } from "../../../server/utils/media-provider/registry"
import type { MediaTaskResult } from "../../../server/utils/media-provider/run-media-task"
import type { VoiceCloningModelSpec } from "../../../server/utils/media-provider/types"

const SPEC = listMediaSpecs("voice_cloning")[0] as VoiceCloningModelSpec

/** Образец в 12 секунд: внутри диапазона модели (10 с — 5 мин). */
const SAMPLE_DURATION_SEC = 12

function sampleBytes(text = "образец голоса"): Buffer {
  return Buffer.from(text, "utf8")
}

function character(overrides: Partial<VoiceCloneCharacter> = {}): VoiceCloneCharacter {
  return {
    id: "char_1",
    appId: 7,
    voiceId: null,
    voiceModelId: null,
    voiceSampleSha1: null,
    ...overrides,
  }
}

/** Хранилище в памяти: тот же контракт, что у драйверов, без сети и диска. */
function memoryStorage(providerName: VoiceCloneStorage["providerName"] = "gcs") {
  const objects = new Map<string, Buffer>()
  const storage: VoiceCloneStorage = {
    providerName,
    async uploadBuffer(key, data) {
      objects.set(key, data)
      return { key }
    },
    async exists(key) {
      return objects.has(key)
    },
    async downloadToBuffer(key) {
      const found = objects.get(key)
      if (!found) throw new Error(`нет объекта ${key}`)
      return found
    },
    async getSignedDownloadUrl(key) {
      // Ровно форма боевой подписанной ссылки GCS: абсолютный адрес, расширение
      // в ПУТИ, подпись в query.
      return `https://storage.googleapis.com/bucket/${key}?X-Goog-Signature=deadbeef`
    },
  }
  return { storage, objects }
}

interface Harness {
  deps: VoiceCloneDeps
  runTask: ReturnType<typeof vi.fn>
  logCost: ReturnType<typeof vi.fn>
  saveCharacterVoice: ReturnType<typeof vi.fn>
  objects: Map<string, Buffer>
}

function harness(overrides: Partial<VoiceCloneDeps> & { raw?: unknown, durationSec?: number } = {}): Harness {
  const { storage, objects } = memoryStorage()
  const raw = "raw" in overrides ? overrides.raw : { voice_id: "R8_TEST_VOICE", preview: null, model: "speech-02-turbo" }
  const runTask = vi.fn(async (request: { persist?: { storageKey: string } | null }): Promise<MediaTaskResult> => {
    // Настоящий раннер кладёт JSON выхода в хранилище — тут же и кладём:
    // без этого второй уровень переиспользования проверять не на чем.
    if (request.persist?.storageKey) {
      objects.set(request.persist.storageKey, Buffer.from(JSON.stringify(raw), "utf8"))
    }
    return {
      localPath: "/tmp/voice-clone.json",
      provider: "replicate",
      modelId: SPEC.id,
      externalRef: null,
      idempotencyKey: "voice_cloning:v1:character:char_1:...",
      costUsd: 3,
      source: "generated",
      remoteUrl: null,
      raw,
    }
  })
  const logCost = vi.fn(async () => {})
  const saveCharacterVoice = vi.fn(async () => {})

  return {
    runTask,
    logCost,
    saveCharacterVoice,
    objects,
    deps: {
      storage,
      probeSampleDurationSec: async () => overrides.durationSec ?? SAMPLE_DURATION_SEC,
      runTask: runTask as unknown as VoiceCloneDeps["runTask"],
      logCost,
      saveCharacterVoice,
      makeWorkDir: async () => "/tmp/voice-clone-test",
      cleanupWorkDir: async () => {},
      mockMode: false,
      ...overrides,
    },
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    character: character(),
    sample: { bytes: sampleBytes(), filename: "presenter.mp3", mimeType: "audio/mpeg" },
    targetModel: "speech-02-turbo",
    confirmUsd: 3,
    userId: 42,
    ...overrides,
  } as Parameters<typeof cloneCharacterVoice>[0]
}

describe("клон голоса: подтверждение суммы", () => {
  it("без подтверждения суммы не платит и называет цену из спеки", async () => {
    const h = harness()

    await expect(cloneCharacterVoice(request({ confirmUsd: 0 }), h.deps))
      .rejects.toThrow(/\$3.*подтвердите|подтвердите.*\$3/is)
    expect(h.runTask).not.toHaveBeenCalled()
  })

  it("подтверждённая сумма не та — отказ до оплаты", async () => {
    const h = harness()

    await expect(cloneCharacterVoice(request({ confirmUsd: 1 }), h.deps)).rejects.toThrow(/\$3/)
    expect(h.runTask).not.toHaveBeenCalled()
  })

  it("целевая модель обязательна: голос обучается ПОД модель", async () => {
    const h = harness()

    await expect(cloneCharacterVoice(request({ targetModel: "  " }), h.deps)).rejects.toThrow(/модел/i)
    expect(h.runTask).not.toHaveBeenCalled()
  })
})

describe("клон голоса: проверки образца ДО оплаты", () => {
  it("формат не из списка модели — отказ, провайдер не вызван", async () => {
    const h = harness()

    await expect(cloneCharacterVoice(
      request({ sample: { bytes: sampleBytes(), filename: "presenter.ogg", mimeType: "audio/ogg" } }),
      h.deps,
    )).rejects.toThrow(/формат/i)
    expect(h.runTask).not.toHaveBeenCalled()
  })

  it("файл больше предела модели — отказ, провайдер не вызван", async () => {
    const h = harness()
    const huge = Buffer.alloc(SPEC.constraints.maxBytes + 1)

    await expect(cloneCharacterVoice(
      request({ sample: { bytes: huge, filename: "presenter.mp3", mimeType: "audio/mpeg" } }),
      h.deps,
    )).rejects.toThrow(/МБ|байт/i)
    expect(h.runTask).not.toHaveBeenCalled()
  })

  it("короче минимума модели — отказ, провайдер не вызван", async () => {
    const h = harness({ durationSec: SPEC.constraints.minDurationSec - 1 })

    await expect(cloneCharacterVoice(request(), h.deps)).rejects.toThrow(/длительн/i)
    expect(h.runTask).not.toHaveBeenCalled()
  })

  it("длиннее максимума модели — отказ, провайдер не вызван", async () => {
    const h = harness({ durationSec: SPEC.constraints.maxDurationSec + 1 })

    await expect(cloneCharacterVoice(request(), h.deps)).rejects.toThrow(/длительн/i)
    expect(h.runTask).not.toHaveBeenCalled()
  })

  it("ffprobe вернул 0 — это НЕ ноль секунд, а несостоявшийся замер: отказ", async () => {
    // `getVideoDuration` при ошибке отдаёт 0, а не бросает (известный дефект,
    // см. план preflight Task 2). Молча пропустить такой образец — заплатить $3
    // за файл, который модель отвергнет.
    const h = harness({ durationSec: 0 })

    await expect(cloneCharacterVoice(request(), h.deps)).rejects.toThrow(/измер/i)
    expect(h.runTask).not.toHaveBeenCalled()
  })
})

describe("клон голоса: идемпотентность — второй раз за то же не платим", () => {
  it("тот же образец и та же целевая модель — отдаёт готовый voice_id без оплаты", async () => {
    const h = harness()
    const first = await cloneCharacterVoice(request(), h.deps)

    expect(first.source).toBe("cloned")
    expect(h.runTask).toHaveBeenCalledTimes(1)

    const repeat = await cloneCharacterVoice(request({
      character: character({
        voiceId: first.voiceId,
        voiceModelId: "speech-02-turbo",
        voiceSampleSha1: first.sampleSha1,
      }),
    }), h.deps)

    expect(repeat.source).toBe("reused_character")
    expect(repeat.voiceId).toBe(first.voiceId)
    expect(repeat.costUsd).toBe(0)
    expect(h.runTask).toHaveBeenCalledTimes(1)
    expect(h.logCost).toHaveBeenCalledTimes(1)
  })

  it("тот же образец, но другая целевая модель — платит: voice_id под неё не существует", async () => {
    // Отличается ТОЛЬКО целевая модель: sha1 образца тот же самый, иначе тест
    // проверял бы дедуп по файлу, а не то, что клон привязан к модели.
    const h = harness()
    const cloned = await cloneCharacterVoice(request(), h.deps)
    h.runTask.mockClear()

    const result = await cloneCharacterVoice(request({
      targetModel: "speech-02-hd",
      character: character({
        voiceId: cloned.voiceId,
        voiceModelId: "speech-02-turbo",
        voiceSampleSha1: cloned.sampleSha1,
      }),
    }), h.deps)

    expect(result.source).toBe("cloned")
    expect(h.runTask).toHaveBeenCalledTimes(1)
    // И ключ оплаченного ответа у другой модели свой: иначе уровень B отдал бы
    // чужой voice_id вместо оплаты нового клона.
    const [task] = h.runTask.mock.calls[0]! as [{ persist?: { storageKey: string } | null }]
    expect(task.persist?.storageKey).toMatch(/speech-02-hd\.json$/)
  })

  it("sha1 совпал, но voiceId пуст — клон не доехал, платим", async () => {
    const h = harness()
    const sha1 = (await cloneCharacterVoice(request(), h.deps)).sampleSha1
    h.runTask.mockClear()

    const result = await cloneCharacterVoice(request({
      character: character({ voiceId: null, voiceModelId: "speech-02-turbo", voiceSampleSha1: sha1 }),
    }), h.deps)

    expect(result.source).toBe("reused_storage")
    expect(h.runTask).not.toHaveBeenCalled()
  })

  it("запись на персонажа не доехала, но оплаченный результат лежит в хранилище — берём оттуда", async () => {
    // Худший реальный случай: $3 списаны, ответ получен, а update персонажа упал.
    // Второй заход обязан найти уже оплаченный результат, а не платить снова.
    const h = harness()
    await cloneCharacterVoice(request(), h.deps)
    h.runTask.mockClear()
    h.logCost.mockClear()

    const result = await cloneCharacterVoice(request({ character: character() }), h.deps)

    expect(result.source).toBe("reused_storage")
    expect(result.voiceId).toBe("R8_TEST_VOICE")
    expect(result.costUsd).toBe(0)
    expect(h.runTask).not.toHaveBeenCalled()
    // Второй оплаты не было — и в ledger второй строки быть не должно.
    expect(h.logCost).not.toHaveBeenCalled()
    // Зато персонажу голос дописывается: ради этого повтор и заходил.
    expect(h.saveCharacterVoice).toHaveBeenCalledWith("char_1", expect.objectContaining({
      voiceId: "R8_TEST_VOICE",
      voiceModelId: "speech-02-turbo",
    }))
  })

  it("другой образец под ту же модель — это другой голос, платим", async () => {
    const h = harness()
    await cloneCharacterVoice(request(), h.deps)
    h.runTask.mockClear()

    const result = await cloneCharacterVoice(request({
      sample: { bytes: sampleBytes("совсем другая запись"), filename: "presenter.mp3", mimeType: "audio/mpeg" },
    }), h.deps)

    expect(result.source).toBe("cloned")
    expect(h.runTask).toHaveBeenCalledTimes(1)
  })
})

describe("клон голоса: публичный URL образца", () => {
  it("модели уходит абсолютная ссылка нашего хранилища с расширением в пути", async () => {
    const h = harness()

    await cloneCharacterVoice(request(), h.deps)

    const [task] = h.runTask.mock.calls[0]! as [{ input: { audioUrl: string, targetModel: string } }]
    expect(task.input.audioUrl).toMatch(/^https:\/\//)
    expect(task.input.audioUrl.split("?")[0]).toMatch(/\.mp3$/)
    expect(task.input.targetModel).toBe("speech-02-turbo")
  })

  it("драйвер отдал относительный путь и мок выключен — отказ ДО оплаты", async () => {
    // Локальный драйвер отдаёт `/api/files/{key}` — это наш приватный маршрут за
    // авторизацией. MiniMax скачивает файл сам и до такой ссылки не дотянется:
    // задача упадёт уже созданной, то есть за $3.
    expect(() => resolveVoiceSamplePublicUrl({
      signedUrl: "/api/files/zavodcamp%2Fapps%2F7%2Fcharacters%2Fchar_1%2Fvoice-samples%2Fabc.mp3",
      storageProvider: "local",
      mockMode: false,
      allowedExtensions: SPEC.constraints.audioExtensions,
    })).toThrow(/публичн/i)
  })

  it("в мок-режиме относительная ссылка допустима: наружу она не уходит", () => {
    const url = resolveVoiceSamplePublicUrl({
      signedUrl: "/api/files/zavodcamp%2Fapps%2F7%2Fcharacters%2Fchar_1%2Fvoice-samples%2Fabc.mp3",
      storageProvider: "local",
      mockMode: true,
      allowedExtensions: SPEC.constraints.audioExtensions,
    })

    expect(url).toMatch(/abc\.mp3$/)
  })

  it("ссылка без расширения отвергается, даже будучи публичной", () => {
    expect(() => resolveVoiceSamplePublicUrl({
      signedUrl: "https://api.replicate.com/v1/files/abc123",
      storageProvider: "gcs",
      mockMode: false,
      allowedExtensions: SPEC.constraints.audioExtensions,
    })).toThrow(/расширени/i)
  })

  it("расширение читается из ПУТИ, а не из query подписи", () => {
    expect(() => resolveVoiceSamplePublicUrl({
      signedUrl: "https://storage.googleapis.com/bucket/zavodcamp/x/abc?name=sample.mp3",
      storageProvider: "gcs",
      mockMode: false,
      allowedExtensions: SPEC.constraints.audioExtensions,
    })).toThrow(/расширени/i)
  })

  it("расширение образца берётся из имени файла, иначе из mime", () => {
    expect(resolveVoiceSampleExtension(
      { filename: "Запись.M4A", mimeType: null },
      SPEC.constraints.audioExtensions,
    )).toBe(".m4a")
    expect(resolveVoiceSampleExtension(
      { filename: null, mimeType: "audio/wav" },
      SPEC.constraints.audioExtensions,
    )).toBe(".wav")
    expect(() => resolveVoiceSampleExtension(
      { filename: null, mimeType: "application/octet-stream" },
      SPEC.constraints.audioExtensions,
    )).toThrow(/формат/i)
  })
})

describe("клон голоса: разбор ответа модели", () => {
  it("voice_id из ответа записывается персонажу вместе с моделью и sha1", async () => {
    const h = harness()

    const result = await cloneCharacterVoice(request(), h.deps)

    expect(result.voiceId).toBe("R8_TEST_VOICE")
    expect(result.costUsd).toBe(3)
    expect(h.saveCharacterVoice).toHaveBeenCalledWith("char_1", {
      voiceId: "R8_TEST_VOICE",
      voiceModelId: "speech-02-turbo",
      voiceSampleSha1: result.sampleSha1,
    })
  })

  it("ответ мока-транскрипции ломается громко и персонажа не портит", async () => {
    // Ровно то, что отдавала ветка sync_json в мок-режиме до этой задачи.
    const h = harness({ raw: { text: "мок транскрипции", chunks: [] } })

    await expect(cloneCharacterVoice(request(), h.deps)).rejects.toThrow(/voice_id/i)
    expect(h.saveCharacterVoice).not.toHaveBeenCalled()
  })

  it("extractClonedVoiceId принимает форму модели и отвергает чужую", () => {
    expect(extractClonedVoiceId({ voice_id: "R8_A", preview: "x", model: "speech-02-turbo" })).toBe("R8_A")
    expect(() => extractClonedVoiceId({ text: "мок транскрипции", chunks: [] })).toThrow(/voice_id/i)
    expect(() => extractClonedVoiceId({ voice_id: "   " })).toThrow(/voice_id/i)
    expect(() => extractClonedVoiceId(null)).toThrow(/voice_id/i)
  })
})

describe("клон голоса: учёт расхода", () => {
  it("$3 уходят в ledger один раз, с моделью и персонажем в метаданных", async () => {
    const h = harness()

    const result = await cloneCharacterVoice(request(), h.deps)

    expect(h.logCost).toHaveBeenCalledTimes(1)
    const [entry] = h.logCost.mock.calls[0]! as [{
      service: string
      model: string
      costUsd: number
      userId: number | null
      metadata?: Record<string, unknown>
    }]
    expect(entry.service).toBe("replicate")
    expect(entry.model).toBe(SPEC.id)
    expect(entry.costUsd).toBe(3)
    expect(entry.userId).toBe(42)
    expect(entry.metadata).toMatchObject({
      characterId: "char_1",
      targetModel: "speech-02-turbo",
      sampleSha1: result.sampleSha1,
    })
  })

  it("сбой записи в ledger не отменяет уже оплаченный и полученный клон", async () => {
    // Деньги списаны, voice_id получен. Уронить ответ из-за учёта — потерять то,
    // за что заплатили: повтор пошёл бы платить снова.
    const h = harness()
    h.logCost.mockRejectedValueOnce(new Error("БД недоступна"))

    await expect(cloneCharacterVoice(request(), h.deps)).resolves.toMatchObject({
      voiceId: "R8_TEST_VOICE",
    })
  })

  it("образец лежит в хранилище под ключом с расширением", async () => {
    const h = harness()

    const result = await cloneCharacterVoice(request(), h.deps)

    expect(result.sampleStorageKey).toMatch(/^zavodcamp\/apps\/7\/characters\/char_1\/voice-samples\/.+\.mp3$/)
    expect(h.objects.has(result.sampleStorageKey)).toBe(true)
  })
})
