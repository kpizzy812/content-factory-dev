/**
 * Транспорт к Claude через локальный Claude Code CLI в headless-режиме.
 *
 * Считает не по токенам, а по подписке: long-lived OAuth-токен из
 * `claude setup-token` кладётся в CLAUDE_CODE_OAUTH_TOKEN, и генерация идёт в
 * счёт Pro/Max. Альтернатива обычному ANTHROPIC_API_KEY, включается через
 * LLM_TRANSPORT=claude_cli.
 *
 * Подводные камни, из-за которых транспорт написан именно так:
 *   - prompt обязан быть позиционным аргументом после -p; stdin CLI отдаёт под
 *     контент-документ, и без аргумента процесс молча падает;
 *   - system prompt уезжает временным файлом через --system-prompt-file. Флаг
 *     рабочий, но в `claude --help` не показан: проверен на 2.1.222 тем, что
 *     несуществующий путь даёт «System prompt file not found», а опечатка в
 *     имени флага — «unknown option». Длина ограничена только у user prompt,
 *     который идёт аргументом;
 *   - режим прав только `default`: bypassPermissions CLI разворачивает в
 *     --dangerously-skip-permissions, а тот запрещён под root — контейнер
 *     работает именно под root;
 *   - при упёршемся лимите подписки CLI выходит с кодом 0 и прячет ошибку в
 *     полях is_error/api_error_status, поэтому проверяется и успешный выход.
 */

import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const DEFAULT_TIMEOUT_MS = 360_000

export interface ClaudeCliUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
}

export interface ClaudeCliResult {
  text: string
  usage: ClaudeCliUsage
}

/** Состояние лимитов подписки по выводу CLI. */
export type ExhaustionSignal = "none" | "cooldown" | "exhausted"

/** Включён ли транспорт через подписку вместо обычного API-ключа. */
export function isClaudeCliTransport(): boolean {
  return (process.env.LLM_TRANSPORT || "").trim().toLowerCase() === "claude_cli"
}

/**
 * Предел одного аргумента командной строки в Linux — 128 КБ. Ограничение
 * касается только user prompt: system уезжает файлом. Берём с запасом, потому
 * что кириллица в UTF-8 занимает два байта на символ, а превышение выглядит
 * как необъяснимый отказ запуска процесса.
 */
const MAX_USER_PROMPT_CHARS = 60_000

export function buildClaudeCliArgs(options: {
  userPrompt: string
  systemPromptPath: string
  model: string
}): string[] {
  if (options.userPrompt.length > MAX_USER_PROMPT_CHARS) {
    throw new ClaudeCliError(
      `user-промпт слишком длинный для Claude CLI: ${options.userPrompt.length} символов при пределе ${MAX_USER_PROMPT_CHARS}. `
      + "Транспорт передаёт его аргументом командной строки — используйте LLM_TRANSPORT=api.",
      "none",
    )
  }

  return [
    "-p", options.userPrompt,
    "--output-format", "json",
    "--model", options.model,
    "--system-prompt-file", options.systemPromptPath,
    "--permission-mode", "default",
  ]
}

/**
 * Отличает исчерпанный лимит от обычной поломки.
 * `cooldown` — лимит вернётся сам (сессионное окно), `exhausted` — до конца
 * расчётного периода подписки.
 */
export function detectClaudeCliExhaustion(
  stdout: string,
  stderr: string,
  exitCode: number,
): ExhaustionSignal {
  const haystack = `${stdout}\n${stderr}`.toLowerCase()

  if (haystack.includes("session limit") || haystack.includes("resets at") || haystack.includes("· resets")) {
    return "cooldown"
  }
  if (
    haystack.includes("usage limit reached")
    || haystack.includes("quota exceeded")
    || haystack.includes("subscription limit")
  ) {
    return "exhausted"
  }
  if (exitCode !== 0 && haystack.includes("rate limit")) {
    return "cooldown"
  }

  return "none"
}

/**
 * Разбирает вывод `claude -p --output-format json`.
 * Бросает, если CLI сообщил об ошибке — в том числе спрятанной за нулевым
 * кодом выхода.
 */
export function parseClaudeCliResponse(stdout: string): ClaudeCliResult {
  const raw = stdout.trim()
  if (!raw) {
    throw new Error("Claude CLI вернул пустой вывод")
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    throw new Error(`Claude CLI вернул неразбираемый вывод: ${raw.slice(0, 200)}`)
  }

  const apiStatus = Number(data.api_error_status)
  if (data.is_error === true || (Number.isFinite(apiStatus) && apiStatus >= 400)) {
    const detail = String(data.result || data.error || "без описания")
    throw new Error(`Claude CLI сообщил об ошибке (status=${data.api_error_status ?? "n/a"}): ${detail}`)
  }

  const text = typeof data.result === "string" ? data.result.trim() : ""
  if (!text) {
    throw new Error("Claude CLI вернул пустой результат")
  }

  const usage = (data.usage || {}) as Record<string, unknown>

  return {
    text,
    usage: {
      inputTokens: Number(usage.input_tokens) || 0,
      outputTokens: Number(usage.output_tokens) || 0,
      cacheReadTokens: Number(usage.cache_read_input_tokens) || 0,
      cacheCreateTokens: Number(usage.cache_creation_input_tokens) || 0,
    },
  }
}

/** Ошибка транспорта с пометкой, упёрлись ли мы в лимит подписки. */
export class ClaudeCliError extends Error {
  constructor(message: string, readonly signal: ExhaustionSignal) {
    super(message)
    this.name = "ClaudeCliError"
  }
}

export function buildClaudeCliEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }

  // ANTHROPIC_API_KEY обязан уйти из окружения subprocess: при обоих заданных
  // credentials CLI выбирает ключ и падает с «Invalid API key · Fix external
  // API key», даже когда OAuth-токен рабочий. Ключ остаётся у HTTP-транспорта,
  // которому он и нужен как запасной путь.
  delete env.ANTHROPIC_API_KEY

  // Изолированный HOME: иначе в продовую генерацию подмешиваются CLAUDE.md,
  // хуки и скиллы того, кто ставил CLI на машину.
  const cliHome = base.CLAUDE_CLI_HOME
  if (cliHome) {
    env.HOME = cliHome
    env.USERPROFILE = cliHome
  }

  return env
}

/**
 * Запускает генерацию через CLI и возвращает сырой текст ответа модели.
 * Разбором JSON и валидацией занимается вызывающая сторона.
 */
export async function callClaudeCli(options: {
  systemPrompt: string
  userPrompt: string
  model: string
  timeoutMs?: number
}): Promise<ClaudeCliResult> {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new ClaudeCliError(
      "LLM_TRANSPORT=claude_cli, но CLAUDE_CODE_OAUTH_TOKEN не задан. Токен выдаёт `claude setup-token`.",
      "none",
    )
  }

  const cliPath = process.env.CLAUDE_CLI_PATH || "claude"
  const timeoutMs = options.timeoutMs ?? (Number(process.env.CLAUDE_CLI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS)

  const dir = await mkdtemp(join(tmpdir(), "cf-claude-"))
  const systemPromptPath = join(dir, "system-prompt.txt")

  try {
    await writeFile(systemPromptPath, options.systemPrompt, "utf8")

    const args = buildClaudeCliArgs({
      userPrompt: options.userPrompt,
      systemPromptPath,
      model: options.model,
    })

    const { stdout, stderr, exitCode } = await runProcess(cliPath, args, timeoutMs)

    if (exitCode !== 0) {
      const signal = detectClaudeCliExhaustion(stdout, stderr, exitCode)
      throw new ClaudeCliError(
        `Claude CLI завершился с кодом ${exitCode} (signal=${signal}): ${stderr.slice(0, 400) || stdout.slice(0, 400)}`,
        signal,
      )
    }

    try {
      return parseClaudeCliResponse(stdout)
    }
    catch (err) {
      // Разбор падает и на скрытой ошибке лимита — сигнал считаем из того же вывода.
      const signal = detectClaudeCliExhaustion(stdout, stderr, exitCode)
      throw new ClaudeCliError((err as Error).message, signal)
    }
  }
  finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: buildClaudeCliEnv(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      reject(new ClaudeCliError(`Claude CLI не ответил за ${timeoutMs} мс`, "none"))
    }, timeoutMs)

    child.stdout.on("data", (chunk) => { stdout += String(chunk) })
    child.stderr.on("data", (chunk) => { stderr += String(chunk) })

    child.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new ClaudeCliError(`Не удалось запустить ${command}: ${err.message}`, "none"))
    })

    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? 0 })
    })
  })
}
