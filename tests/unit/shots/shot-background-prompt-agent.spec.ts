/**
 * Ruling S8-3 (ре-ревью Task 4 плана «Сборка по кадрам»): `validate()` внутри
 * `shot-background-prompt-agent.ts` и сама `planShotBackgroundPrompts` не были
 * покрыты НИ ОДНИМ тестом — мутация «убрать проверку типа `order` в
 * `validate()`» выживала молча. Функция разбирает ответ ПЛАТНОГО вызова
 * (единственный кадр экономики шага `shot_background`, который реально
 * платит агенту промптов), поэтому покрываем её здесь: ответ правильной
 * формы, ответ с мусором в ячейке, ответ не-массивом, ответ с лишними полями.
 *
 * `validate` внутри модуля не экспортирован — он вызывается изнутри
 * `callAnthropicAgent`. Тест подменяет транспорт ($fetch) тем же приёмом, что
 * `tests/unit/fixes/anthropic-usage-before-throw.spec.ts`: мок-режим и
 * CLI-транспорт отключены явно, чтобы не зависеть от .env машины, а сеть не
 * трогается вовсе — платных вызовов в этой сьюте нет.
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { vi } from "vitest"

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

let responseBody: unknown = null

beforeEach(() => {
  responseBody = null
  setGlobal("$fetch", async () => responseBody)
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

const USAGE = { input_tokens: 900, output_tokens: 120 }

function textResponse(payload: unknown): unknown {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], usage: USAGE }
}

async function runPrompts(shots: Array<{ order: number, idea: string | null, sceneText: string | null, durationSec: number }>) {
  const { planShotBackgroundPrompts } = await import("~~/server/utils/agents/shot-background-prompt-agent")
  return planShotBackgroundPrompts({
    shots,
    visualStyle: "неоновый киберпанк",
    appName: "TestApp",
    format: "portrait",
  })
}

const SHOTS = [
  { order: 0, idea: "график роста выручки", sceneText: "за квартал мы выросли втрое", durationSec: 1.8 },
  { order: 1, idea: "офис на рассвете", sceneText: null, durationSec: 2.5 },
]

describe("planShotBackgroundPrompts: разбор ответа платного вызова (ruling S8-3)", () => {
  it("ответ правильной формы — оба кадра берут ответ модели, а не фолбэк", async () => {
    responseBody = textResponse({
      prompts: [
        { order: 0, prompt: "a".repeat(60), purpose: "иллюстрация тезиса" },
        { order: 1, prompt: "b".repeat(60), purpose: "перебивка" },
      ],
    })

    const result = await runPrompts(SHOTS)

    expect(result.prompts).toHaveLength(2)
    expect(result.prompts.find(p => p.order === 0)!.prompt).toBe("a".repeat(60))
    expect(result.prompts.find(p => p.order === 1)!.prompt).toBe("b".repeat(60))
    expect(result.usage).toMatchObject({ inputTokens: 900, outputTokens: 120 })
  })

  it("ответ с мусором в ячейке — мусорная ячейка отбрасывается, годная используется", async () => {
    responseBody = textResponse({
      prompts: [
        // order — строка, не число: validate() обязана её отсеять.
        { order: "0", prompt: "a".repeat(60), purpose: "мусор order" },
        // prompt — число, не строка.
        { order: 0, prompt: 12345, purpose: "мусор prompt" },
        // purpose — null, не строка.
        { order: 0, prompt: "c".repeat(60), purpose: null },
        // Годная ячейка на order=1 — должна пройти и попасть в результат.
        { order: 1, prompt: "d".repeat(60), purpose: "перебивка" },
      ],
    })

    const result = await runPrompts(SHOTS)

    // order=0 не получил НИ ОДНОЙ годной ячейки — фолбэк, а не мусор.
    const zero = result.prompts.find(p => p.order === 0)!
    expect(zero.prompt).not.toBe("a".repeat(60))
    expect(zero.prompt).not.toBe(12345 as unknown as string)
    expect(zero.prompt).not.toBe("c".repeat(60))
    expect(zero.prompt.length).toBeGreaterThanOrEqual(50)
    // order=1 получил годную ячейку модели.
    expect(result.prompts.find(p => p.order === 1)!.prompt).toBe("d".repeat(60))
  })

  it("ответ не-массивом — validate() бросает, а не молча пустой результат", async () => {
    // prompts — объект, а не массив.
    responseBody = textResponse({ prompts: { order: 0, prompt: "x".repeat(60), purpose: "p" } })

    await expect(runPrompts(SHOTS)).rejects.toThrow(/ожидался объект с массивом prompts/)
  })

  it("prompts отсутствует вовсе — тот же отказ, что и для не-массива", async () => {
    responseBody = textResponse({ notPrompts: [] })

    await expect(runPrompts(SHOTS)).rejects.toThrow(/ожидался объект с массивом prompts/)
  })

  it("ответ с лишними полями — лишние поля игнорируются, а не роняют разбор", async () => {
    responseBody = textResponse({
      prompts: [
        { order: 0, prompt: "e".repeat(60), purpose: "иллюстрация", confidence: 0.97, extra: { nested: true } },
        { order: 1, prompt: "f".repeat(60), purpose: "перебивка", tags: ["a", "b"] },
      ],
    })

    const result = await runPrompts(SHOTS)

    expect(result.prompts.find(p => p.order === 0)!.prompt).toBe("e".repeat(60))
    expect(result.prompts.find(p => p.order === 1)!.prompt).toBe("f".repeat(60))
    // Лишние поля не просочились в форму ShotPrompt.
    expect(Object.keys(result.prompts[0]!).sort()).toEqual(["order", "prompt", "purpose"])
  })

  it("пустой список кадров не зовёт модель вовсе", async () => {
    const result = await runPrompts([])
    expect(result).toEqual({ prompts: [], usage: null })
  })

  it("usage сообщается ДО броска на невалидной форме — оплаченный вызов не теряется (та же гарантия, что у edit_plan)", async () => {
    responseBody = textResponse({ prompts: "not-an-array" })

    let reportedUsage: unknown = null
    const { planShotBackgroundPrompts } = await import("~~/server/utils/agents/shot-background-prompt-agent")

    await expect(planShotBackgroundPrompts({
      shots: SHOTS,
      visualStyle: null,
      appName: null,
      format: "portrait",
      onUsage: (usage) => { reportedUsage = usage },
    })).rejects.toThrow()

    expect(reportedUsage).toMatchObject({ inputTokens: 900, outputTokens: 120 })
  })
})
