/**
 * Контрактные тесты POST /api/characters/:id/clone-voice — клон голоса ведущего
 * (§9 спеки `docs/superpowers/specs/2026-08-16-audio-first-editing-design.md`,
 * ручка появилась 27.08.2026).
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: НИ ОДНОГО ПЛАТНОГО ВЫЗОВА. Прогон клонирования
 * стоит $3 (`billing: { unit: "flat", usd: 3 }` у спеки
 * `replicate:minimax-voice-cloning`), поэтому каждый кейс здесь обязан
 * отбиваться ДО обращения к провайдеру. Порядок гейтов в
 * `cloneCharacterVoice` зафиксирован и проверен чтением кода:
 *
 *   права → разбор multipart → целевая модель → ПОДТВЕРЖДЕНИЕ СУММЫ →
 *   формат образца → размер → длительность → дедуп → заливка в хранилище →
 *   вызов модели
 *
 * Все кейсы ниже останавливаются не позже длительности, то есть за три шага до
 * заливки и за четыре до денег. Успешный путь не вызывается вовсе — ни здесь,
 * ни где-либо ещё в автотестах.
 *
 * ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ, А ЧТО НЕТ. Денежная логика (подтверждение суммы, два
 * уровня дедупликации, разбор ответа, учёт расхода) живёт в
 * `server/utils/media-provider/voice-clone.ts` и целиком накрыта чистой сьютой
 * `tests/unit/media-provider/voice-clone.spec.ts` — без стенда и за секунду.
 * Повторять её через HTTP смысла нет. Здесь ровно то, что добавляет HTTP:
 *
 *   1. РАЗБОР MULTIPART. Что файл действительно вынимается из тела, а его ИМЯ и
 *      MIME реально участвуют в определении формата: одни и те же байты под
 *      именем `.gif` дают 415, а под `.wav` доходят до проверки длительности и
 *      дают 422. Сломайся разбор — обе ветки схлопнулись бы в одну.
 *   2. ПРАВА. `requireScopedAccess` с `canRunAgent`, модулем `script-generator`
 *      и appId ПЕРСОНАЖА. Без явных override'ов `createTestUser` выдаёт все
 *      права и все модули, поэтому каждый негативный кейс снимает ровно одно
 *      измерение — иначе тест не измерял бы ничего.
 *   3. КОДЫ ОПЕРАЦИИ ДОЕЗЖАЮТ КАК ЕСТЬ. 415/422/400 расставлены там, где
 *      принималось решение, и ручка обязана переводить их в HTTP без
 *      переосмысления, а не превращать в 500.
 *   4. ОТКАЗ НИЧЕГО НЕ ПИШЕТ И НИЧЕГО НЕ ТРАТИТ: `Character.voiceId` остаётся
 *      пустым, в ledger (`AiAuditLog` с `action='voice_cloning'`) — ни строки.
 *
 * Фикстура образца — настоящий WAV на 2 секунды из ffmpeg (тот же локальный
 * бинарь, что в `tests/api/edit-plan-endpoints.spec.ts`, платным вызовом не
 * является). Две секунды выбраны намеренно: это законный формат вне диапазона
 * модели (10 с — 5 мин), то есть гейт длительности проверяется настоящим
 * файлом, а не сломанным замером.
 *
 * @vitest-environment node
 */
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, it, expect, beforeAll } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

/** Цена спеки `replicate:minimax-voice-cloning`. Подтверждение обязано быть равно ей. */
const CLONE_PRICE_USD = 3

// ── Фикстура образца ────────────────────────────────────────────────────────

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    proc.stderr.on("data", chunk => { stderr += chunk.toString() })
    proc.once("error", reject)
    proc.once("exit", code => (code === 0
      ? resolvePromise()
      : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 400)}`))))
  })
}

/** WAV на 2 секунды: формат из списка модели, длительность — нет. */
async function buildShortWav(): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "voice-sample-fixture-"))
  try {
    const outPath = join(dir, "sample.wav")
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", outPath])
    return await readFile(outPath)
  }
  finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

let sampleWav: Buffer

beforeAll(async () => {
  sampleWav = await buildShortWav()
})

// ── Фикстуры БД ─────────────────────────────────────────────────────────────

async function createTestApp() {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  return prisma.app.create({
    data: { name: `Voice Clone App ${seed}`, description: "test", keywords: ["test"] },
  })
}

async function createTestCharacter(appId: number) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  return prisma.character.create({
    data: { appId, name: `Ведущая ${seed}`, description: "контрактная фикстура" },
  })
}

/** Доступ РОВНО к одному приложению и без admin — иначе appId-скоуп не проверяется. */
function userWithAppAccess(appId: number, overrides: Record<string, unknown> = {}) {
  return createTestUser({
    canAdmin: false,
    appAssignments: [{ appId, accessLevel: "full" }],
    ...overrides,
  })
}

// ── Помощники запроса ───────────────────────────────────────────────────────

interface CloneFields {
  file?: { bytes: Buffer, name: string, type: string } | null
  confirmUsd?: number | string | null
  targetModel?: string
}

function cloneForm(fields: CloneFields): FormData {
  const form = new FormData()
  if (fields.file) {
    form.append("file", new File([fields.file.bytes], fields.file.name, { type: fields.file.type }))
  }
  if (fields.confirmUsd !== null && fields.confirmUsd !== undefined) {
    form.append("confirmUsd", String(fields.confirmUsd))
  }
  if (fields.targetModel) form.append("targetModel", fields.targetModel)
  return form
}

function clone(characterId: string, fields: CloneFields, headers?: Record<string, string>) {
  return $fetch(`/api/characters/${characterId}/clone-voice`, {
    method: "POST",
    ...(headers ? { headers } : {}),
    body: cloneForm(fields),
  })
}

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run()
    return 200
  }
  catch (error) {
    return (error as { statusCode?: number }).statusCode ?? 0
  }
}

/** Голос не записан персонажу и денег не потрачено — общий хвост любого отказа. */
async function expectNothingSpent(characterId: string): Promise<void> {
  const row = await prisma.character.findUniqueOrThrow({ where: { id: characterId } })
  expect(row.voiceId, "voiceId не должен появиться на отказе").toBeNull()
  expect(row.voiceModelId).toBeNull()
  expect(row.voiceSampleSha1).toBeNull()
  expect(
    await prisma.aiAuditLog.count({ where: { action: "voice_cloning" } }),
    "в ledger не должно быть строк клонирования",
  ).toBe(0)
}

/** Валидный по всем гейтам ДО длительности образец: имя и MIME модель принимает. */
function wavField() {
  return { bytes: sampleWav, name: "sample.wav", type: "audio/wav" }
}

// ── Права ───────────────────────────────────────────────────────────────────

describe("POST /api/characters/:id/clone-voice — права", () => {
  it("401 без auth — голос не записан, денег не потрачено", async () => {
    const app = await createTestApp()
    const character = await createTestCharacter(app.id)

    expect(await statusOf(() => clone(character.id, {
      file: wavField(), confirmUsd: CLONE_PRICE_USD,
    }))).toBe(401)

    await expectNothingSpent(character.id)
  })

  it("403 без права canRunAgent — проверка прав идёт до всего остального", async () => {
    const app = await createTestApp()
    const character = await createTestCharacter(app.id)
    const user = await userWithAppAccess(app.id, { canRunAgent: false })

    expect(await statusOf(() => clone(character.id, {
      file: wavField(), confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))).toBe(403)

    await expectNothingSpent(character.id)
  })

  it("403 без доступа к модулю script-generator (право и приложение в порядке)", async () => {
    const app = await createTestApp()
    const character = await createTestCharacter(app.id)
    const user = await userWithAppAccess(app.id, { moduleAccess: ["video-generator"] })

    expect(await statusOf(() => clone(character.id, {
      file: wavField(), confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))).toBe(403)

    await expectNothingSpent(character.id)
  })

  it("403 на персонажа ЧУЖОГО приложения — голос чужого ведущего не обучается", async () => {
    const ownerApp = await createTestApp()
    const intruderApp = await createTestApp()
    const character = await createTestCharacter(ownerApp.id)
    const user = await userWithAppAccess(intruderApp.id)

    expect(await statusOf(() => clone(character.id, {
      file: wavField(), confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))).toBe(403)

    await expectNothingSpent(character.id)
  })

  it("404 на несуществующего персонажа", async () => {
    const user = await createTestUser()
    expect(await statusOf(() => clone("no-such-character-id", {
      file: wavField(), confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))).toBe(404)
  })

  /**
   * ИЗВЕСТНЫЙ ДЕФЕКТ, НЕ ЗАКРЫТ. `prisma.character.findUnique` + 404 стоят в
   * ручке ДО `requireScopedAccess`, поэтому по коду ответа посторонний отличает
   * существующий `Character.id` от несуществующего: 401/403 против 404. Это тот
   * же класс, который `tests/api/edit-plan-endpoints.spec.ts` закрывает для
   * приложений («Оракул существования приложения»). Утечка слабее — id персонажа
   * это cuid, а не последовательное целое, перебором его не построить, — но она
   * есть. Лечится перестановкой: сначала права без appId, потом чтение
   * персонажа, потом права с его appId. Файл ручки правит параллельная работа,
   * поэтому здесь только отметка, а разбор — в отчёте задачи.
   */
  it.todo("код ответа не должен выдавать существование персонажа постороннему (сейчас 404 против 401/403)")
})

// ── Разбор multipart и гейты до оплаты ──────────────────────────────────────

describe("POST /api/characters/:id/clone-voice — разбор тела и гейты до оплаты", () => {
  it("400, когда файла в multipart-теле нет вовсе", async () => {
    const app = await createTestApp()
    const character = await createTestCharacter(app.id)
    const user = await userWithAppAccess(app.id)

    expect(await statusOf(() => clone(character.id, {
      file: null, confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))).toBe(400)

    await expectNothingSpent(character.id)
  })

  it("400 на пустой файл — нулевые байты образцом не считаются", async () => {
    const app = await createTestApp()
    const character = await createTestCharacter(app.id)
    const user = await userWithAppAccess(app.id)

    expect(await statusOf(() => clone(character.id, {
      file: { bytes: Buffer.alloc(0), name: "sample.wav", type: "audio/wav" },
      confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))).toBe(400)

    await expectNothingSpent(character.id)
  })

  it("400 без подтверждения суммы — молчаливого пути к $3 нет", async () => {
    const app = await createTestApp()
    const character = await createTestCharacter(app.id)
    const user = await userWithAppAccess(app.id)

    expect(await statusOf(() => clone(character.id, {
      file: wavField(), confirmUsd: null,
    }, authHeaders(user.id)))).toBe(400)

    await expectNothingSpent(character.id)
  })

  it("400, когда подтверждена НЕ ТА сумма — подтверждение сверяется с ценой спеки", async () => {
    const app = await createTestApp()
    const character = await createTestCharacter(app.id)
    const user = await userWithAppAccess(app.id)
    const headers = authHeaders(user.id)

    // Мусор в поле даёт NaN, а NaN не равен цене — это отказ, а не списание.
    expect(await statusOf(() => clone(character.id, { file: wavField(), confirmUsd: "да" }, headers))).toBe(400)
    expect(await statusOf(() => clone(character.id, { file: wavField(), confirmUsd: 1 }, headers))).toBe(400)
    expect(await statusOf(() => clone(character.id, { file: wavField(), confirmUsd: 300 }, headers))).toBe(400)

    await expectNothingSpent(character.id)
  })

  it("415 на формат вне списка модели — имя файла из multipart реально читается", async () => {
    // Те же байты, что в кейсе 422 ниже. Разница только в имени и MIME, и
    // разный код ответа доказывает, что разбор multipart дошёл до них, а не
    // угадал формат по чему-то ещё.
    const app = await createTestApp()
    const character = await createTestCharacter(app.id)
    const user = await userWithAppAccess(app.id)

    expect(await statusOf(() => clone(character.id, {
      file: { bytes: sampleWav, name: "sample.gif", type: "image/gif" },
      confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))).toBe(415)

    await expectNothingSpent(character.id)
  })

  it("422 на образец короче минимума модели — гейт длительности отбивает ДО оплаты", async () => {
    const app = await createTestApp()
    const character = await createTestCharacter(app.id)
    const user = await userWithAppAccess(app.id)

    expect(await statusOf(() => clone(character.id, {
      file: wavField(), confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))).toBe(422)

    await expectNothingSpent(character.id)
  })

  it("422 на файл, который не читается как аудио — несостоявшийся замер это не ноль секунд", async () => {
    const app = await createTestApp()
    const character = await createTestCharacter(app.id)
    const user = await userWithAppAccess(app.id)

    expect(await statusOf(() => clone(character.id, {
      file: { bytes: Buffer.from("это не аудио, это текст"), name: "sample.mp3", type: "audio/mpeg" },
      confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))).toBe(422)

    await expectNothingSpent(character.id)
  })
})
