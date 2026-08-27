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
 *   2. ПРАВА И ПОРЯДОК ИХ ПРОВЕРКИ. `canRunAgent`, модуль `script-generator` и
 *      appId ПЕРСОНАЖА — причём именно в таком порядке, потому что от него
 *      зависит, не выдаёт ли код ответа существование чужого персонажа
 *      (отдельный тест в конце блока прав). Без явных override'ов
 *      `createTestUser` выдаёт все права и все модули, поэтому каждый
 *      негативный кейс снимает ровно одно измерение — иначе тест не измерял бы
 *      ничего.
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

  it("404 на персонажа ЧУЖОГО приложения — голос чужого ведущего не обучается", async () => {
    // Именно 404, а не 403: см. тест про оракул ниже. Персонаж, до которого у
    // оператора нет доступа, для него не существует — и отвечать об этом надо
    // ровно тем же, чем на выдуманный id.
    const ownerApp = await createTestApp()
    const intruderApp = await createTestApp()
    const character = await createTestCharacter(ownerApp.id)
    const user = await userWithAppAccess(intruderApp.id)

    expect(await statusOf(() => clone(character.id, {
      file: wavField(), confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))).toBe(404)

    await expectNothingSpent(character.id)
  })

  it("404 на несуществующего персонажа", async () => {
    const user = await createTestUser()
    expect(await statusOf(() => clone("no-such-character-id", {
      file: wavField(), confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))).toBe(404)
  })

  /**
   * Оракул существования персонажа — тот же приём, что в блоке «Оракул
   * существования приложения» в `tests/api/edit-plan-endpoints.spec.ts`.
   *
   * Раньше `prisma.character.findUnique` + 404 стояли в ручке ДО
   * `requireScopedAccess`, и по коду ответа посторонний отличал существующий
   * `Character.id` от несуществующего: 404 против 401/403. Порядок переставлен
   * (сначала право и модуль, потом чтение, потом приложение), а отказ по
   * приложению сведён к тому же 404.
   *
   * Проверяется РАВЕНСТВО кодов в паре, а не «404 где-то есть»: тесты выше уже
   * покрывают каждую ветку по отдельности, и обратная перестановка проверок их
   * не тронула бы вовсе.
   */
  it("код ответа не выдаёт существование персонажа: аноним и посторонний видят одно и то же", async () => {
    const ownerApp = await createTestApp()
    const outsiderApp = await createTestApp()
    const character = await createTestCharacter(ownerApp.id)
    const outsider = await userWithAppAccess(outsiderApp.id)

    const fields = () => ({ file: wavField(), confirmUsd: CLONE_PRICE_USD })

    // Аноним: и существующий персонаж, и выдуманный id — 401. Права проверяются
    // до чтения, поэтому ответ от существования не зависит вовсе.
    const anonExisting = await statusOf(() => clone(character.id, fields()))
    const anonMissing = await statusOf(() => clone("no-such-character-id", fields()))
    expect(anonExisting).toBe(401)
    expect(anonMissing).toBe(anonExisting)

    // Посторонний с правом и модулем, но без доступа к приложению персонажа:
    // 404 на обоих — «есть, но не твой» неотличимо от «нет такого».
    const headers = authHeaders(outsider.id)
    const outsiderExisting = await statusOf(() => clone(character.id, fields(), headers))
    const outsiderMissing = await statusOf(() => clone("no-such-character-id", fields(), headers))
    expect(outsiderExisting).toBe(404)
    expect(outsiderMissing).toBe(outsiderExisting)

    await expectNothingSpent(character.id)
  })
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

  /**
   * ДЕФЕКТ БЫЛ ДОКАЗАН ПРОГОНОМ И ЗАКРЫТ 28.08.2026.
   *
   * `cloneCharacterVoice` строила отказ 422 на допущении «несостоявшийся замер
   * приходит НУЛЁМ». Допущение верно только наполовину: `getVideoDuration`
   * (`server/utils/video-tools/ffmpeg.ts:72-88`) отдаёт 0 ТОЛЬКО когда ffprobe
   * отработал успешно, но длительности в метаданных нет; на ошибке самого
   * ffprobe он `reject`-ит промис через `wrapBinaryError`. Файл, который
   * ffprobe прочитать не может, шёл именно по второй ветке: наружу летел
   * обычный `Error`, ручка мапит в HTTP только `VoiceCloneError` — и оператор
   * получал 500 (`AssertionError: expected 500 to be 422` в прогоне 28.08.2026)
   * вместо внятного «файл не читается». Ветка 422 была недостижима.
   *
   * Починено В САМОЙ `cloneCharacterVoice`, а не в замере: правило «без замера
   * не платим» принадлежит ей, и любая реализация замера — дефолтная, тестовая,
   * будущая — обязана получать один и тот же ответ. `getVideoDuration` при этом
   * не тронут: его ноль и его бросок по-прежнему различимы для остальных
   * вызывающих.
   *
   * Ожидание СТРОГОЕ (422, а не диапазон): именно оно и есть проверка. Дефект
   * контрактный, а не денежный — деньги были в порядке и до починки, потому что
   * отказ случается на замере, то есть ДО заливки образца в хранилище и ДО
   * вызова модели. Поэтому проверяется и то, и другое.
   */
  it("нечитаемый как аудио файл отвечает 422 и отбивается ДО оплаты", async () => {
    const app = await createTestApp()
    const character = await createTestCharacter(app.id)
    const user = await userWithAppAccess(app.id)

    const code = await statusOf(() => clone(character.id, {
      file: { bytes: Buffer.from("это не аудио, это текст"), name: "sample.mp3", type: "audio/mpeg" },
      confirmUsd: CLONE_PRICE_USD,
    }, authHeaders(user.id)))

    expect(code).toBe(422)
    await expectNothingSpent(character.id)
  })
})
