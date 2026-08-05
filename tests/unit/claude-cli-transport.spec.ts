/**
 * Unit-тесты транспорта через Claude Code CLI на OAuth-подписке.
 *
 * Чистая логика: сборка аргументов, разбор ответа `claude -p --output-format json`
 * и распознавание исчерпанных лимитов. Сам subprocess здесь не запускается.
 *
 * Главная ловушка этого транспорта: при упёршемся лимите подписки CLI выходит
 * с кодом 0 и отдаёт JSON, где ошибка спрятана в полях is_error/api_error_status.
 * Без явной проверки текст «You've hit your session limit» уходит дальше как
 * валидный ответ модели.
 */
import { describe, it, expect, afterEach } from "vitest"
import {
  buildClaudeCliArgs,
  detectClaudeCliExhaustion,
  isClaudeCliTransport,
  parseClaudeCliResponse,
} from "../../server/utils/agents/claude-cli"

describe("isClaudeCliTransport", () => {
  const original = process.env.LLM_TRANSPORT

  afterEach(() => {
    if (original === undefined) delete process.env.LLM_TRANSPORT
    else process.env.LLM_TRANSPORT = original
  })

  // Транспорт — дополнительный, а не замена: без явного включения весь контур
  // обязан идти прежним путём через ANTHROPIC_API_KEY.
  it("выключен, пока его не попросили явно", () => {
    delete process.env.LLM_TRANSPORT
    expect(isClaudeCliTransport()).toBe(false)

    process.env.LLM_TRANSPORT = ""
    expect(isClaudeCliTransport()).toBe(false)

    process.env.LLM_TRANSPORT = "api"
    expect(isClaudeCliTransport()).toBe(false)
  })

  it("не включается от похожих значений", () => {
    process.env.LLM_TRANSPORT = "claude"
    expect(isClaudeCliTransport()).toBe(false)

    process.env.LLM_TRANSPORT = "cli"
    expect(isClaudeCliTransport()).toBe(false)
  })

  it("включается ровно на claude_cli", () => {
    process.env.LLM_TRANSPORT = "claude_cli"
    expect(isClaudeCliTransport()).toBe(true)

    process.env.LLM_TRANSPORT = " CLAUDE_CLI "
    expect(isClaudeCliTransport()).toBe(true)
  })
})

describe("buildClaudeCliArgs", () => {
  const args = buildClaudeCliArgs({
    userPrompt: "сгенерируй сценарий",
    systemPrompt: "ты сценарист",
    model: "claude-sonnet-5",
  })

  it("передаёт prompt аргументом после -p, а не через stdin", () => {
    const promptIndex = args.indexOf("-p")

    expect(promptIndex).toBeGreaterThanOrEqual(0)
    expect(args[promptIndex + 1]).toBe("сгенерируй сценарий")
  })

  it("просит машиночитаемый ответ и нужную модель", () => {
    expect(args).toContain("--output-format")
    expect(args[args.indexOf("--output-format") + 1]).toBe("json")
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5")
  })

  // Файлового варианта у CLI нет (проверено на 2.1.222): только аргумент.
  it("передаёт system prompt отдельным аргументом", () => {
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("ты сценарист")
    expect(args).not.toContain("--system-prompt-file")
  })

  // Ядро Linux режет один аргумент по 128 КБ, и превышение выглядит как
  // необъяснимый отказ запуска — лучше понятная ошибка заранее.
  it("не даёт собрать команду с неподъёмным промптом", () => {
    expect(() => buildClaudeCliArgs({
      userPrompt: "x",
      systemPrompt: "д".repeat(70_000),
      model: "claude-sonnet-5",
    })).toThrowError(/слишком длинн/i)
  })

  // CLI маппит bypassPermissions на --dangerously-skip-permissions, а тот
  // запрещён под root. Контейнер работает под root, поэтому только default.
  it("не просит режим, который запрещён под root", () => {
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default")
    expect(args).not.toContain("--dangerously-skip-permissions")
    expect(args).not.toContain("bypassPermissions")
  })
})

describe("parseClaudeCliResponse", () => {
  it("достаёт текст и расход токенов", () => {
    const stdout = JSON.stringify({
      type: "result",
      result: '{"hook":"текст"}',
      session_id: "abc",
      usage: {
        input_tokens: 1200,
        output_tokens: 340,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 100,
      },
      total_cost_usd: 0,
    })

    const parsed = parseClaudeCliResponse(stdout)

    expect(parsed.text).toBe('{"hook":"текст"}')
    expect(parsed.usage.inputTokens).toBe(1200)
    expect(parsed.usage.outputTokens).toBe(340)
    expect(parsed.usage.cacheReadTokens).toBe(800)
    expect(parsed.usage.cacheCreateTokens).toBe(100)
  })

  it("падает на скрытой ошибке при нулевом коде выхода", () => {
    const stdout = JSON.stringify({
      type: "result",
      is_error: true,
      api_error_status: 429,
      result: "You've hit your session limit · resets 3pm",
    })

    expect(() => parseClaudeCliResponse(stdout)).toThrowError(/session limit/i)
  })

  it("падает на пустом ответе, а не отдаёт пустую строку дальше", () => {
    expect(() => parseClaudeCliResponse(JSON.stringify({ type: "result", result: "" })))
      .toThrowError(/пуст/i)
    expect(() => parseClaudeCliResponse("")).toThrowError()
  })

  it("падает на неразбираемом выводе", () => {
    expect(() => parseClaudeCliResponse("not a json at all")).toThrowError()
  })

  // Дословный ответ claude 2.1.222 на неверный токен: subtype=success,
  // stop_reason=stop_sequence и нулевой код выхода — ошибка видна только по
  // is_error/api_error_status.
  it("узнаёт отказ авторизации в ответе, размеченном как успешный", () => {
    const stdout = JSON.stringify({
      is_error: true,
      duration_api_ms: 0,
      num_turns: 1,
      stop_reason: "stop_sequence",
      session_id: "28137855-b0b6-4ba0-a31c-e82abbb75247",
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
      terminal_reason: "api_error",
      subtype: "success",
      api_error_status: 401,
      result: "Failed to authenticate. API Error: 401 Invalid bearer token",
      type: "result",
    })

    expect(() => parseClaudeCliResponse(stdout)).toThrowError(/401/)
  })
})

describe("detectClaudeCliExhaustion", () => {
  it("узнаёт временный лимит сессии", () => {
    expect(
      detectClaudeCliExhaustion("You've hit your session limit · resets 3pm", "", 0),
    ).toBe("cooldown")
  })

  it("узнаёт исчерпанный лимит подписки", () => {
    expect(detectClaudeCliExhaustion("", "Claude AI usage limit reached", 1)).toBe("exhausted")
  })

  it("не принимает обычную ошибку за лимит", () => {
    expect(detectClaudeCliExhaustion("", "ENOENT: model not found", 1)).toBe("none")
    expect(detectClaudeCliExhaustion("всё хорошо", "", 0)).toBe("none")
  })
})
