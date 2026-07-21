/**
 * Анализ видео по ссылке через Anthropic API.
 * Определяет платформу, отправляет промпт и возвращает текстовый анализ.
 */

type VideoPlatform = "youtube" | "tiktok" | "instagram" | "unknown"

function detectPlatform(url: string): VideoPlatform {
  const lower = url.toLowerCase()

  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube"
  if (lower.includes("tiktok.com") || lower.includes("vm.tiktok.com")) return "tiktok"
  if (lower.includes("instagram.com")) return "instagram"

  return "unknown"
}

const PLATFORM_NAMES: Record<VideoPlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  unknown: "Неизвестная платформа",
}

const ANALYSIS_PROMPT = `Ты — эксперт по вирусному видеоконтенту. Проанализируй видео по предоставленной ссылке.

Определи и опиши:
1. Хук (первые 3 секунды) — как видео цепляет зрителя
2. Основная часть — структура и подача контента
3. CTA (призыв к действию) — как видео побуждает к действию
4. Визуальный стиль — монтаж, эффекты, графика
5. Почему видео залетело — что делает его вирусным

Отвечай на русском. Будь конкретен и давай практические рекомендации.
Формат ответа: структурированный текст с заголовками.`

export async function analyzeVideoByUrl(url: string): Promise<string> {
  if (process.env.ENABLE_PAID_APIS !== "true") {
    return [
      `Платформа: ${PLATFORM_NAMES[detectPlatform(url)]}`,
      `Ссылка: ${url}`,
      "",
      "AI-анализ недоступен: платные API отключены.",
      "Установите ENABLE_PAID_APIS=true для включения.",
    ].join("\n")
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || ""
  if (!anthropicApiKey) {
    return "AI-анализ недоступен: ANTHROPIC_API_KEY не настроен."
  }

  const platform = detectPlatform(url)

  try {
    const response = await $fetch<{
      content: Array<{ type: string; text?: string }>
    }>("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      timeout: 60_000,
      body: {
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: `${ANALYSIS_PROMPT}\n\nПлатформа: ${PLATFORM_NAMES[platform]}\nСсылка: ${url}`,
          },
        ],
      },
    })

    const textBlock = response.content.find((c) => c.type === "text")
    if (!textBlock?.text) {
      return "AI-сервис вернул пустой ответ. Попробуйте позже."
    }

    return [
      `Платформа: ${PLATFORM_NAMES[platform]}`,
      `Ссылка: ${url}`,
      "",
      textBlock.text,
    ].join("\n")
  } catch {
    return `Не удалось проанализировать видео. Попробуйте позже.\n\nПлатформа: ${PLATFORM_NAMES[platform]}\nСсылка: ${url}`
  }
}
