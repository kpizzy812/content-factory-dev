/**
 * Регрессия Critical 1 финального ревью ветки `feat/frontend-rebuild`:
 * оплаченный вызов Anthropic исчезал из учёта на пути «ответ 200 с непустым
 * `usage`, но без текстового блока».
 *
 * `callAnthropicAgent` бросал «AI-сервис вернул пустой ответ» РАНЬШЕ, чем звал
 * `options.onUsage`. Для шага `edit_plan` это означало `collectedUsages = []`
 * → `agentCostUsd = 0` → ни строки в `AiAuditLog`, ни прибавки к `actualCost`:
 * провайдеру заплачено по входным токенам, в учёте ноль. Прямое нарушение
 * инварианта «если провайдеру заплачено — расход записан, чем бы шаг ни
 * кончился».
 *
 * Это третий рецидив одного класса на ветке (до него закрывали обрезанный
 * ответ и падение `saveShots`), поэтому сьюта проверяет НЕ один путь, а
 * свойство целиком: `onUsage` обязан отработать РОВНО ОДИН РАЗ и РАНЬШЕ любого
 * броска, который возможен после получения ответа от провайдера — пустой
 * ответ, ответ без поля `content` вовсе, обрезанный JSON, ответ, не прошедший
 * `validate`, и успешный ответ.
 *
 * Тестов на `callAnthropicAgent` + `onUsage` в проекте не было ни одного:
 * денежные тесты `edit_plan` подают usage через подменённый `askModel` и
 * минуют `call-anthropic.ts` целиком.
 *
 * Сьюта чистая: сеть подменена ($fetch в globalThis), платных вызовов нет.
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AnthropicCallUsage } from "~~/server/utils/agents/call-anthropic"

// Мок-режим и CLI-транспорт к этому свойству отношения не имеют, но оба стоят
// ВЫШЕ проверяемой ветки и читают окружение — подменяем, чтобы тест не зависел
// от того, что лежит в .env запускающей машины.
vi.mock("~~/server/utils/mock/anthropic-mock", () => ({
  tryMockAnthropicAgent: async () => ({ hit: false }),
}))

vi.mock("~~/server/utils/agents/claude-cli", () => ({
  isClaudeCliTransport: () => false,
  callClaudeCli: async () => {
    throw new Error("CLI-транспорт в этой сьюте не используется")
  },
  ClaudeCliError: class ClaudeCliError extends Error {},
}))

/** Ошибка h3: createError кидает объект со statusCode. */
class FakeHttpError extends Error {
  statusCode: number

  constructor(params: { statusCode?: number, message?: string }) {
    super(params.message ?? "ошибка")
    this.statusCode = params.statusCode ?? 500
  }
}

const PATCHED_GLOBALS = ["$fetch", "createError", "requirePaidApisEnabled"] as const
const savedGlobals = new Map<string, unknown>()
const savedEnv = new Map<string, string | undefined>()

function setGlobal(name: string, value: unknown): void {
  const holder = globalThis as unknown as Record<string, unknown>
  if (!savedGlobals.has(name)) savedGlobals.set(name, holder[name])
  holder[name] = value
}

function setEnv(name: string, value: string | undefined): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name])
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

/** Что вернёт подменённый $fetch на единственный запрос к провайдеру. */
let responseBody: unknown = null
let fetchCalls = 0

beforeEach(() => {
  responseBody = null
  fetchCalls = 0
  setGlobal("$fetch", async () => {
    fetchCalls += 1
    return responseBody
  })
  setGlobal("createError", (params: { statusCode?: number, message?: string }) => new FakeHttpError(params))
  setGlobal("requirePaidApisEnabled", () => undefined)
  setEnv("ANTHROPIC_API_KEY", "sk-ant-тестовый-ключ-в-сеть-не-уходит")
  setEnv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
})

afterEach(() => {
  const holder = globalThis as unknown as Record<string, unknown>
  for (const name of PATCHED_GLOBALS) {
    if (savedGlobals.has(name)) holder[name] = savedGlobals.get(name)
  }
  savedGlobals.clear()
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  savedEnv.clear()
})

/** Оплаченный вызов: провайдер посчитал входные токены и вернул 200. */
const PAID_USAGE = {
  input_tokens: 1200,
  output_tokens: 0,
  cache_read_input_tokens: 300,
  cache_creation_input_tokens: 40,
}

async function callWithUsageSpy(options: {
  body: unknown
  validate?: (data: unknown) => unknown
}): Promise<{ usages: AnthropicCallUsage[], error: unknown, value: unknown }> {
  const { callAnthropicAgent } = await import("~~/server/utils/agents/call-anthropic")
  responseBody = options.body

  const usages: AnthropicCallUsage[] = []
  let error: unknown = null
  let value: unknown = null
  try {
    value = await callAnthropicAgent({
      systemPrompt: "system",
      userPrompt: "user",
      agentName: "тестовый-агент",
      validate: options.validate ?? ((data: unknown) => data),
      onUsage: usage => void usages.push(usage),
    })
  }
  catch (err) {
    error = err
  }

  return { usages, error, value }
}

describe("callAnthropicAgent: usage сообщается раньше любого броска после ответа", () => {
  // Тот самый Critical 1: 200 + usage + content без блока type "text".
  // Так отвечает провайдер, когда генерация остановлена сразу на max_tokens.
  it("пустой ответ: usage сообщён ровно один раз, и только потом 502", async () => {
    const { usages, error } = await callWithUsageSpy({
      body: { content: [], usage: PAID_USAGE },
    })

    expect(fetchCalls).toBe(1)
    expect(usages).toHaveLength(1)
    expect(usages[0]).toMatchObject({
      inputTokens: 1200,
      outputTokens: 0,
      cacheReadTokens: 300,
      cacheCreateTokens: 40,
      model: "claude-sonnet-4-6",
    })
    expect((error as FakeHttpError)?.statusCode).toBe(502)
    expect((error as Error)?.message).toContain("пустой ответ")
  })

  // Тот же класс, другой вход: у ответа нет поля `content` вовсе. Бросок здесь
  // не наш `createError`, а TypeError из `response.content.find` — но вызов
  // всё равно оплачен, и учёт обязан его увидеть.
  it("ответ без поля content: usage сообщён ровно один раз, и только потом падение", async () => {
    const { usages, error } = await callWithUsageSpy({
      body: { usage: PAID_USAGE },
    })

    expect(usages).toHaveLength(1)
    expect(usages[0]?.inputTokens).toBe(1200)
    expect(error).toBeTruthy()
  })

  // Уже закрытый ранее путь (ре-ревью 3, Ruling B5-4) — держим под тестом,
  // чтобы перестановка блока обратно вниз не осталась незамеченной.
  it("обрезанный JSON: usage сообщён ровно один раз, и только потом 502", async () => {
    const { usages, error } = await callWithUsageSpy({
      body: {
        content: [{ type: "text", text: "{\"shots\": [{\"order\": 1," }],
        usage: { ...PAID_USAGE, output_tokens: 4096 },
      },
    })

    expect(usages).toHaveLength(1)
    expect(usages[0]?.outputTokens).toBe(4096)
    expect((error as FakeHttpError)?.statusCode).toBe(502)
    expect((error as Error)?.message).toContain("невалидный JSON")
  })

  it("ответ не прошёл validate: usage сообщён ровно один раз", async () => {
    const { usages, error } = await callWithUsageSpy({
      body: {
        content: [{ type: "text", text: "{\"shots\": []}" }],
        usage: { ...PAID_USAGE, output_tokens: 17 },
      },
      validate: () => {
        throw new Error("Схема ответа не сошлась")
      },
    })

    expect(usages).toHaveLength(1)
    expect(usages[0]?.outputTokens).toBe(17)
    expect((error as Error)?.message).toBe("Схема ответа не сошлась")
  })

  it("успешный ответ: usage сообщён ровно один раз, значение возвращено", async () => {
    const { usages, error, value } = await callWithUsageSpy({
      body: {
        content: [{ type: "text", text: "{\"ok\": true}" }],
        usage: { ...PAID_USAGE, output_tokens: 42 },
      },
    })

    expect(error).toBeNull()
    expect(value).toEqual({ ok: true })
    expect(usages).toHaveLength(1)
    expect(usages[0]?.outputTokens).toBe(42)
  })

  // Обратная сторона свойства: сообщать нечего — сообщать не надо. Раннер в
  // этом случае сам репортит `null` (`runner.ts`, `if (!usageReported)`), и
  // выдуманный нулевой usage здесь спутал бы «провайдер не сказал» с
  // «провайдер сказал ноль».
  it("ответа без usage не выдумывает: onUsage не зовётся", async () => {
    const { usages, error } = await callWithUsageSpy({
      body: { content: [] },
    })

    expect(usages).toHaveLength(0)
    expect((error as FakeHttpError)?.statusCode).toBe(502)
  })
})
