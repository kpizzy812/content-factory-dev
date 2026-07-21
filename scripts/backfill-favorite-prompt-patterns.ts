/**
 * Backfill structural pattern analysis для FavoritePrompt.
 *
 * Запуск: pnpm tsx scripts/backfill-favorite-prompt-patterns.ts
 *
 * Standalone-скрипт: НЕ зависит от Nuxt auto-imports (useRuntimeConfig, createError,
 * глобальный prisma, requirePaidApisEnabled). Anthropic вызывается напрямую через
 * fetch с ANTHROPIC_API_KEY из process.env.
 *
 * Берёт все промпты с aiAnalyzedAt IS NULL AND aiAnalysisAttempts < 3,
 * прогоняет через Haiku, записывает результат. Идемпотентен.
 */

import { PrismaClient } from "../app/generated/prisma/client"
import {
  PROMPT_PATTERN_SYSTEM_PROMPT,
  parsePatternFromAnthropicResponse,
} from "../server/utils/agents/prompt-pattern-extractor"

const prisma = new PrismaClient()

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
const HAIKU_MODEL = process.env.ANTHROPIC_HAIKU_MODEL || "claude-haiku-4-5-20251001"

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>
}

async function callAnthropicHaikuStandalone(userPrompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY не задан в окружении (.env)")
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 4096,
      system: PROMPT_PATTERN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => "")
    throw new Error(`Anthropic ${res.status}: ${errBody.slice(0, 300)}`)
  }

  const data = (await res.json()) as AnthropicResponse
  const textBlock = data.content.find((c) => c.type === "text")
  if (!textBlock?.text) {
    throw new Error("Anthropic вернул пустой text-блок")
  }
  return textBlock.text
}

async function main() {
  console.log("[backfill] Запуск: pnpm tsx scripts/backfill-favorite-prompt-patterns.ts")
  console.log(`[backfill] Модель: ${HAIKU_MODEL}`)

  const candidates = await prisma.favoritePrompt.findMany({
    where: {
      aiAnalyzedAt: null,
      aiAnalysisAttempts: { lt: 3 },
    },
    select: {
      id: true,
      promptText: true,
      aiAnalysisAttempts: true,
    },
  })

  console.log(`[backfill] Найдено ${candidates.length} промптов для анализа`)

  let processed = 0
  let errors = 0

  for (const fp of candidates) {
    try {
      const userPrompt = `Extract the structural pattern from this Kling prompt:\n\n"""${fp.promptText}"""\n\nReturn JSON only.`
      const rawText = await callAnthropicHaikuStandalone(userPrompt)
      const pattern = parsePatternFromAnthropicResponse(rawText)

      await prisma.favoritePrompt.update({
        where: { id: fp.id },
        data: {
          aiPatternAnalysis: pattern as unknown as object,
          aiAnalyzedAt: new Date(),
          aiAnalysisError: null,
        },
      })
      processed++
      console.log(`  FP#${fp.id} ✓ (motion=${pattern.motionIntensity}, mood=${pattern.mood})`)
    } catch (err) {
      errors++
      const errorMessage = err instanceof Error ? err.message.slice(0, 500) : "unknown error"
      console.warn(`  FP#${fp.id} ошибка: ${errorMessage}`)
      await prisma.favoritePrompt
        .update({
          where: { id: fp.id },
          data: {
            aiAnalysisError: errorMessage,
            aiAnalysisAttempts: { increment: 1 },
          },
        })
        .catch(() => {
          /* ignore — DB запись ошибки тоже могла упасть */
        })
    }

    if ((processed + errors) % 5 === 0 || (processed + errors) === candidates.length) {
      console.log(`[backfill] Processed ${processed + errors}/${candidates.length}, errors: ${errors}`)
    }
  }

  console.log(`[backfill] Готово. Успешно: ${processed}, ошибок: ${errors}`)
}

main()
  .catch((err) => {
    console.error("[backfill] Fatal:", err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
