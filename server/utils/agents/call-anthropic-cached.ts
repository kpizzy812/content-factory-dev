/**
 * callAnthropicAgentCached — расширенный helper с поддержкой prompt caching
 * (cache_control: ephemeral). Используется только из video-prompts/anthropic-call.ts
 * для генерации Kling-промптов: статичная часть system prompt'а ~1500-2000 токенов
 * кешируется на 5 минут, экономия ~90% input cost при повторных вызовах.
 *
 * Не заменяет callAnthropicAgent — у того есть 10+ существующих callsites.
 *
 * Graceful degradation: если cache_control возвращает 400 (модель не поддерживает),
 * автоматически повторяет без cache_control.
 */

import { ClaudeCliError, callClaudeCli, isClaudeCliTransport } from "./claude-cli"

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

interface CallAnthropicAgentCachedOptions<T> {
  /** Статичная часть system prompt — отправляется с cache_control: ephemeral */
  systemPromptStatic: string
  /** Динамическая часть — идёт в user message */
  userPrompt: string
  /** Default 6144 — для длинных JSON ответов (per-scene Kling prompts) */
  maxTokens?: number
  /** Парсер JSON-ответа. Должен бросить если данные невалидны. */
  validate: (data: unknown) => T
  /** Имя агента для подбора фикстуры в ANTHROPIC_MOCK_MODE. */
  agentName?: string
}

interface CallAnthropicAgentCachedResult<T> {
  result: T
  rawText: string
  cacheHit: boolean
  usage: {
    input: number
    output: number
    cacheRead: number
    cacheCreate: number
  }
}

export async function callAnthropicAgentCached<T>(
  options: CallAnthropicAgentCachedOptions<T>,
): Promise<CallAnthropicAgentCachedResult<T>> {
  const { tryMockAnthropicAgent } = await import("../mock/anthropic-mock")
  const mocked = await tryMockAnthropicAgent(options.agentName, options.validate)
  if (mocked.hit) {
    return {
      result: mocked.value,
      rawText: JSON.stringify(mocked.value),
      cacheHit: false,
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    }
  }

  requirePaidApisEnabled("Anthropic Claude API")

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || ""
  const agentLabel = options.agentName ?? "cached-agent"
  const modelUsed = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6"

  // Транспорт через подписку Claude Code — тот же, что и в callAnthropicAgent.
  // Без этой ветки агенты на кэширующем хелпере (visual-director) уходили в
  // HTTP мимо подписки и падали на заглушке ключа.
  if (isClaudeCliTransport()) {
    try {
      const cliResult = await callClaudeCli({
        systemPrompt: options.systemPromptStatic,
        userPrompt: options.userPrompt,
        model: modelUsed,
      })

      return {
        result: options.validate(extractJsonFromText(cliResult.text)),
        rawText: cliResult.text,
        // Кэш держит сам CLI: cache_control сюда не передаётся.
        cacheHit: cliResult.usage.cacheReadTokens > 0,
        usage: {
          input: cliResult.usage.inputTokens,
          output: cliResult.usage.outputTokens,
          cacheRead: cliResult.usage.cacheReadTokens,
          cacheCreate: cliResult.usage.cacheCreateTokens,
        },
      }
    }
    catch (err) {
      const signal = err instanceof ClaudeCliError ? err.signal : "none"
      const message = err instanceof Error ? err.message : String(err)

      if (!anthropicApiKey) {
        throw createError({
          statusCode: 502,
          message: `Claude CLI (${agentLabel}) не отработал и запасного ANTHROPIC_API_KEY нет: ${message}`,
        })
      }

      console.warn(
        `[claude-cli:${agentLabel}] ${signal === "none" ? "ошибка" : `лимит подписки (${signal})`}: ${message}. Падаю на API-ключ.`,
      )
    }
  }

  if (!anthropicApiKey) {
    throw createError({
      statusCode: 500,
      message: "API-ключ Anthropic не настроен. Установите ANTHROPIC_API_KEY в .env",
    })
  }

  const maxTokens = options.maxTokens ?? 6144

  const baseHeaders = {
    "x-api-key": anthropicApiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  }

  const systemBlocksWithCache = [
    {
      type: "text",
      text: options.systemPromptStatic,
      cache_control: { type: "ephemeral" as const },
    },
  ]

  const messages = [{ role: "user", content: options.userPrompt }]

  let response: AnthropicResponse
  try {
    response = await $fetch<AnthropicResponse>("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: baseHeaders,
      // 240s: max_tokens=8192 для Kling per-scene промптов (6 сцен × ~500 слов)
      // даёт Sonnet'у ~3000-4500 output tokens. При rate ~50-80 tok/sec это
      // 60-90с в обычных условиях и до 180с при cold start / load. 60с
      // (старое значение) урезалось как раз посередине ответа.
      timeout: 240_000,
      body: {
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: maxTokens,
        system: systemBlocksWithCache,
        messages,
      },
    })
  } catch (err) {
    const status = (err as { response?: { status?: number }; statusCode?: number })?.response?.status
      ?? (err as { statusCode?: number })?.statusCode

    // Graceful degradation: если 400 на cache_control — пробуем без cache.
    if (status === 400) {
      console.warn("[call-anthropic-cached] 400 on cache_control, retrying without cache")
      try {
        const fallback = await $fetch<AnthropicResponse>("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: baseHeaders,
          // 240s: max_tokens=8192 для Kling per-scene промптов (6 сцен × ~500 слов)
      // даёт Sonnet'у ~3000-4500 output tokens. При rate ~50-80 tok/sec это
      // 60-90с в обычных условиях и до 180с при cold start / load. 60с
      // (старое значение) урезалось как раз посередине ответа.
      timeout: 240_000,
          body: {
            model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
            max_tokens: maxTokens,
            system: options.systemPromptStatic,
            messages,
          },
        })
        return parseResponse(fallback, options.validate, false)
      } catch (fallbackErr) {
        throw mapAnthropicError(fallbackErr)
      }
    }

    throw mapAnthropicError(err)
  }

  const cacheRead = response.usage?.cache_read_input_tokens ?? 0
  return parseResponse(response, options.validate, cacheRead > 0)
}

function parseResponse<T>(
  response: AnthropicResponse,
  validate: (data: unknown) => T,
  cacheHit: boolean,
): CallAnthropicAgentCachedResult<T> {
  const textBlock = response.content.find((c) => c.type === "text")
  if (!textBlock?.text) {
    throw createError({ statusCode: 502, message: "AI-сервис вернул пустой ответ" })
  }

  const parsed = extractJsonFromText(textBlock.text)
  const result = validate(parsed)

  return {
    result,
    rawText: textBlock.text,
    cacheHit,
    usage: {
      input: response.usage?.input_tokens ?? 0,
      output: response.usage?.output_tokens ?? 0,
      cacheRead: response.usage?.cache_read_input_tokens ?? 0,
      cacheCreate: response.usage?.cache_creation_input_tokens ?? 0,
    },
  }
}

function extractJsonFromText(text: string): unknown {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = codeBlockMatch ? codeBlockMatch[1]!.trim() : text.trim()
  try {
    return JSON.parse(raw)
  }
  catch (err) {
    const head = raw.slice(0, 200)
    const tail = raw.length > 400 ? raw.slice(-200) : ''
    const message = (err as { message?: string })?.message || 'JSON parse error'
    console.error(
      `[anthropic:cached] JSON parse failed: ${message}. raw.length=${raw.length}, head="${head}"${tail ? `, tail="${tail}"` : ''}`,
    )
    throw createError({
      statusCode: 502,
      message: `AI-сервис вернул невалидный JSON: ${message}`,
    })
  }
}

function mapAnthropicError(err: unknown): Error {
  const status = (err as { response?: { status?: number }; statusCode?: number })?.response?.status
    ?? (err as { statusCode?: number })?.statusCode

  if (status === 429) {
    return createError({
      statusCode: 429,
      message: "Слишком много запросов к AI-сервису, попробуйте через минуту",
    })
  }
  if (status && status >= 500) {
    return createError({ statusCode: 502, message: "AI-сервис временно недоступен" })
  }
  const message = (err as { message?: string })?.message ?? "неизвестная ошибка"
  return createError({
    statusCode: 502,
    message: `Ошибка AI-сервиса: ${message}`,
  })
}
