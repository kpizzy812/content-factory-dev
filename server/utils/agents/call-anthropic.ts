/**
 * Общий хелпер для вызова Anthropic API из агентов.
 * Единая точка: $fetch, обработка ошибок, парсинг JSON из ответа, retry с backoff.
 *
 * agentName — стабильный идентификатор агента (story-architect, scene-planner и т.д.).
 * Используется в ANTHROPIC_MOCK_MODE для подбора фикстуры и в логах при ошибках.
 */

import { tryMockAnthropicAgent } from '../mock/anthropic-mock'
import { ClaudeCliError, callClaudeCli, isClaudeCliTransport } from './claude-cli'

const RETRY_MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1000
const RETRY_MAX_DELAY_MS = 8000

function isRetryableStatus(status: number | undefined): boolean {
  if (!status) return false
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function isRetryableError(err: unknown): boolean {
  const status = (err as { response?: { status?: number }; statusCode?: number })?.response?.status
    ?? (err as { statusCode?: number })?.statusCode
  if (isRetryableStatus(status)) return true
  const code = (err as { code?: string })?.code
  if (code && ['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(code)) return true
  const name = (err as { name?: string })?.name
  if (name === 'TimeoutError' || name === 'AbortError' || name === 'FetchError') {
    const message = String((err as { message?: string })?.message || '').toLowerCase()
    if (message.includes('timeout') || message.includes('aborted') || message.includes('network')) return true
  }
  return false
}

function backoffDelay(attempt: number): number {
  const exp = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
  const jitter = Math.floor(Math.random() * 250)
  return exp + jitter
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export interface AnthropicCallUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreateTokens?: number
  model: string
}

export async function callAnthropicAgent<T>(options: {
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  /** 'haiku' для лёгких field-level задач, undefined — основная модель */
  tier?: 'haiku'
  validate: (data: unknown) => T
  agentName?: string
  /**
   * Опциональный callback с usage tokens. Зовётся ОДИН РАЗ после успешного парсинга
   * ответа. Если retry'и были — отдаёт usage последней успешной попытки.
   * При mock-режиме usage не сообщается (callback не зовётся).
   */
  onUsage?: (usage: AnthropicCallUsage) => void
}): Promise<T> {
  const mocked = await tryMockAnthropicAgent(options.agentName, options.validate)
  if (mocked.hit) return mocked.value

  requirePaidApisEnabled('Anthropic Claude API')

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || ''

  const haikuModel = process.env.ANTHROPIC_HAIKU_MODEL || 'claude-haiku-4-5-20251001'
  const sonnetModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
  const modelUsed = options.tier === 'haiku' ? haikuModel : sonnetModel
  const agentLabel = options.agentName ?? 'unknown-agent'

  // Транспорт через подписку Claude Code. При исчерпанном лимите откатываемся
  // на обычный API-ключ, если он задан: генерация не должна вставать из-за
  // сессионного окна подписки.
  if (isClaudeCliTransport()) {
    try {
      const cliResult = await callClaudeCli({
        systemPrompt: options.systemPrompt,
        userPrompt: options.userPrompt,
        model: modelUsed,
      })

      if (options.onUsage) {
        try {
          options.onUsage({
            model: modelUsed,
            inputTokens: cliResult.usage.inputTokens,
            outputTokens: cliResult.usage.outputTokens,
            cacheReadTokens: cliResult.usage.cacheReadTokens,
            cacheCreateTokens: cliResult.usage.cacheCreateTokens,
          })
        }
        catch (err) {
          console.warn(`[claude-cli:${agentLabel}] onUsage callback threw: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      return options.validate(extractJsonFromText(cliResult.text, agentLabel))
    }
    catch (err) {
      const signal = err instanceof ClaudeCliError ? err.signal : 'none'
      const message = err instanceof Error ? err.message : String(err)

      if (!anthropicApiKey) {
        throw createError({
          statusCode: 502,
          message: `Claude CLI (${agentLabel}) не отработал и запасного ANTHROPIC_API_KEY нет: ${message}`,
        })
      }

      console.warn(
        `[claude-cli:${agentLabel}] ${signal === 'none' ? 'ошибка' : `лимит подписки (${signal})`}: ${message}. Падаю на API-ключ.`,
      )
    }
  }

  if (!anthropicApiKey) {
    throw createError({
      statusCode: 500,
      message: 'API-ключ Anthropic не настроен. Установите ANTHROPIC_API_KEY в .env',
    })
  }

  interface AnthropicResponse {
    content: Array<{ type: string; text?: string }>
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }

  let response: AnthropicResponse | null = null
  let lastError: unknown = null

  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      response = await $fetch<AnthropicResponse>(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          // 180s: scene-planner / story-architect / continuity-director могут писать
          // длинные JSON ответы. С maxTokens=20000 верхняя граница ~5-7 минут на cold
          // start; ставим 360с для подстраховки, повторных попыток retry хватает.
          timeout: 360_000,
          body: {
            model: modelUsed,
            max_tokens: options.maxTokens ?? 4096,
            system: options.systemPrompt,
            messages: [{ role: 'user', content: options.userPrompt }],
          },
        },
      )
      break
    }
    catch (err) {
      lastError = err
      const status = (err as { response?: { status?: number }; statusCode?: number })?.response?.status
        ?? (err as { statusCode?: number })?.statusCode

      if (attempt < RETRY_MAX_ATTEMPTS && isRetryableError(err)) {
        const delay = backoffDelay(attempt)
        console.warn(
          `[anthropic:${agentLabel}] attempt ${attempt}/${RETRY_MAX_ATTEMPTS} failed (status=${status ?? 'n/a'}): ${(err as { message?: string })?.message || 'unknown'}. Retry in ${delay}ms`,
        )
        await sleep(delay)
        continue
      }

      if (status === 429) {
        throw createError({
          statusCode: 429,
          message: 'Слишком много запросов к AI-сервису, попробуйте через минуту',
        })
      }
      if (status && status >= 500) {
        throw createError({ statusCode: 502, message: 'AI-сервис временно недоступен' })
      }
      throw createError({
        statusCode: 502,
        message: `Ошибка AI-сервиса (${agentLabel}): ${(err as { message?: string })?.message || 'неизвестная ошибка'}`,
      })
    }
  }

  if (!response) {
    throw createError({
      statusCode: 502,
      message: `AI-сервис (${agentLabel}) не ответил после ${RETRY_MAX_ATTEMPTS} попыток: ${(lastError as { message?: string })?.message || 'неизвестная ошибка'}`,
    })
  }

  const textBlock = response.content.find(c => c.type === 'text')
  if (!textBlock?.text) {
    throw createError({ statusCode: 502, message: `AI-сервис (${agentLabel}) вернул пустой ответ` })
  }

  if (options.onUsage && response.usage) {
    try {
      options.onUsage({
        model: modelUsed,
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreateTokens: response.usage.cache_creation_input_tokens ?? 0,
      })
    } catch (err) {
      console.warn(`[anthropic:${agentLabel}] onUsage callback threw: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const parsed = extractJsonFromText(textBlock.text, agentLabel)
  return options.validate(parsed)
}

/**
 * Извлекает JSON из текста, обрабатывая markdown code blocks.
 * При ошибке парсинга логирует первые/последние 200 символов raw-ответа,
 * чтобы было видно, что именно вернул Claude (обрезанный JSON, лишний текст и т.п.).
 */
function extractJsonFromText(text: string, agentLabel: string): unknown {
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
      `[anthropic:${agentLabel}] JSON parse failed: ${message}. raw.length=${raw.length}, head="${head}"${tail ? `, tail="${tail}"` : ''}`,
    )
    throw createError({
      statusCode: 502,
      message: `AI-сервис (${agentLabel}) вернул невалидный JSON: ${message}`,
    })
  }
}
