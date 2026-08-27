/**
 * Клон голоса на НАСТОЯЩЕЙ БД: то, что чистой сьютой не проверить.
 *
 * Правила (подтверждение суммы, проверки образца, дедуп, разбор ответа) уже
 * накрыты DB-free тестами `tests/unit/media-provider/voice-clone.spec.ts`.
 * Здесь остаются три вещи, для которых нужна БД:
 *
 *  1. МИГРАЦИЯ ПРИМЕНЕНА. `Character.voiceSampleSha1` существует и переживает
 *     запись/чтение. Без колонки весь дедуп — фикция, а прогон стоит $3.
 *  2. ПОВТОР НЕ ПЛАТИТ ВТОРОЙ РАЗ через реальную запись персонажа, а не через
 *     объект в памяти теста.
 *  3. РАСХОД ПОПАДАЕТ В LEDGER ровно одной строкой на одну оплату: вторая
 *     строка означала бы, что учёт показывает $6 там, где потратили $3, а
 *     отсутствие строки — что $3 не видно в аудите вовсе.
 *
 * Провайдер подменён: ни одного платного вызова. `runTask` — заглушка, которая
 * делает то же, что делает настоящий раннер (кладёт JSON ответа в хранилище под
 * ключ `persist`), потому что именно из этого объекта берётся уровень B
 * дедупликации.
 *
 * @vitest-environment node
 */
import { beforeAll, describe, expect, it, vi } from "vitest"

import { prisma } from "../../server/utils/prisma"
import { MockDriver } from "../../server/utils/storage/mock-driver"
import { listMediaSpecs } from "../../server/utils/media-provider/registry"
import {
  cloneCharacterVoice,
  type VoiceCloneDeps,
  type VoiceCloneStorage,
} from "../../server/utils/media-provider/voice-clone"
import type { MediaTaskResult } from "../../server/utils/media-provider/run-media-task"
import type { VoiceCloningModelSpec } from "../../server/utils/media-provider/types"

const SPEC = listMediaSpecs("voice_cloning")[0] as VoiceCloningModelSpec
const VOICE_ID = "R8_INTEGRATION_VOICE"
const TARGET_MODEL = "speech-02-turbo"

beforeAll(() => {
  // `server/utils/**` рассчитан на авто-импорты Nitro: настоящие реализации
  // (`logServiceCost`, запись персонажа) зовут `prisma` глобалью. Приём взят из
  // tests/integration/stepwise-approval.spec.ts.
  ;(globalThis as unknown as { prisma: typeof prisma }).prisma = prisma
})

async function createCharacter() {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: { name: `Voice App ${seed}`, description: "Test app", keywords: ["test"] },
  })
  return prisma.character.create({
    data: { appId: app.id, name: `Voice Hero ${seed}`, description: "Ведущая", role: "protagonist" },
  })
}

/**
 * Хранилище — настоящий MockDriver проекта (in-memory, тот же контракт и тот же
 * PrefixGuard). Его подписанная ссылка (`mock://…`) не абсолютный http — значит
 * тест обязан идти в мок-режиме, ровно как боевой стенд без GCS.
 */
function makeDeps(storage: VoiceCloneStorage) {
  const runTask = vi.fn(async (request: { persist?: { storageKey: string } | null }): Promise<MediaTaskResult> => {
    const raw = { voice_id: VOICE_ID, preview: null, model: TARGET_MODEL }
    if (request.persist?.storageKey) {
      await storage.uploadBuffer(request.persist.storageKey, Buffer.from(JSON.stringify(raw), "utf8"), {
        contentType: "application/json",
      })
    }
    return {
      localPath: "/tmp/voice-clone.json",
      provider: "replicate",
      modelId: SPEC.id,
      externalRef: null,
      idempotencyKey: "voice_cloning:v1:character:test",
      costUsd: SPEC.billing.unit === "flat" ? SPEC.billing.usd : 0,
      source: "generated",
      remoteUrl: null,
      raw,
    }
  })

  const deps: VoiceCloneDeps = {
    storage,
    runTask: runTask as unknown as VoiceCloneDeps["runTask"],
    probeSampleDurationSec: async () => 12,
    makeWorkDir: async () => "/tmp/voice-clone-int",
    cleanupWorkDir: async () => {},
    mockMode: true,
    // logCost и saveCharacterVoice — НАСТОЯЩИЕ: ради них тест и ходит в БД.
  }
  return { deps, runTask }
}

function requestFor(character: { id: string, appId: number, voiceId: string | null, voiceModelId: string | null, voiceSampleSha1: string | null }) {
  return {
    character,
    sample: {
      bytes: Buffer.from("образец голоса ведущей", "utf8"),
      filename: "presenter.mp3",
      mimeType: "audio/mpeg",
    },
    targetModel: TARGET_MODEL,
    confirmUsd: SPEC.billing.unit === "flat" ? SPEC.billing.usd : 0,
    userId: null,
  }
}

describe("клон голоса на настоящей БД", () => {
  it("первый прогон пишет voiceId, модель и sha1 образца на персонажа и одну строку в ledger", async () => {
    const character = await createCharacter()
    const { deps, runTask } = makeDeps(new MockDriver())

    const result = await cloneCharacterVoice(requestFor(character), deps)

    expect(result.source).toBe("cloned")
    expect(result.costUsd).toBe(3)
    expect(runTask).toHaveBeenCalledTimes(1)

    const saved = await prisma.character.findUniqueOrThrow({ where: { id: character.id } })
    expect(saved.voiceId).toBe(VOICE_ID)
    expect(saved.voiceModelId).toBe(TARGET_MODEL)
    // Колонка миграции: она и есть доказательство «за этот файл уже заплачено».
    expect(saved.voiceSampleSha1).toBe(result.sampleSha1)
    expect(saved.voiceSampleSha1).toMatch(/^[0-9a-f]{16}$/)

    const ledger = await prisma.aiAuditLog.findMany({ where: { action: "voice_cloning" } })
    expect(ledger).toHaveLength(1)
    expect(Number(ledger[0]!.costUsd)).toBe(3)
    expect(ledger[0]!.model).toBe(SPEC.id)
    expect(ledger[0]!.service).toBe("replicate")
  })

  it("повтор по той же записи персонажа не зовёт провайдера и не пишет вторую строку расхода", async () => {
    const character = await createCharacter()
    const storage = new MockDriver()
    const first = makeDeps(storage)
    await cloneCharacterVoice(requestFor(character), first.deps)

    const reread = await prisma.character.findUniqueOrThrow({ where: { id: character.id } })
    const second = makeDeps(storage)
    const repeat = await cloneCharacterVoice(requestFor(reread), second.deps)

    expect(repeat.source).toBe("reused_character")
    expect(repeat.voiceId).toBe(VOICE_ID)
    expect(repeat.costUsd).toBe(0)
    expect(second.runTask).not.toHaveBeenCalled()
    expect(await prisma.aiAuditLog.count({ where: { action: "voice_cloning" } })).toBe(1)
  })

  it("заплатили, но запись не доехала — второй заход поднимает оплаченный ответ из хранилища", async () => {
    const character = await createCharacter()
    const storage = new MockDriver()
    const first = makeDeps(storage)
    await cloneCharacterVoice(requestFor(character), first.deps)

    // Имитируем ровно тот сбой, ради которого заведён уровень B: деньги списаны,
    // объект в хранилище лежит, а персонаж про голос ничего не знает.
    const wiped = await prisma.character.update({
      where: { id: character.id },
      data: { voiceId: null, voiceModelId: null, voiceSampleSha1: null },
    })

    const second = makeDeps(storage)
    const repeat = await cloneCharacterVoice(requestFor(wiped), second.deps)

    expect(repeat.source).toBe("reused_storage")
    expect(repeat.voiceId).toBe(VOICE_ID)
    expect(repeat.costUsd).toBe(0)
    expect(second.runTask).not.toHaveBeenCalled()
    expect(await prisma.aiAuditLog.count({ where: { action: "voice_cloning" } })).toBe(1)

    const restored = await prisma.character.findUniqueOrThrow({ where: { id: character.id } })
    expect(restored.voiceId).toBe(VOICE_ID)
    expect(restored.voiceSampleSha1).toBe(repeat.sampleSha1)
  })
})
