/**
 * Разбор чужого ролика для Telegram-бота.
 *
 * ТЗ (docs/SPEC.md, раздел «Telegram-бот» → «Анализ чужих роликов»):
 * ссылка → транскрибация на нужном языке (RU/EN/DE и др.) → разбор структуры
 * (хук, основная часть, CTA, визуальный стиль) → объяснение, почему залетело.
 *
 * ПОЧЕМУ переписано: раньше отсюда уходил один запрос в Anthropic с голым URL и
 * промптом «проанализируй видео по ссылке». Модель ссылку открыть не может, ни
 * транскрипта, ни кадров ей не давали — ответ был правдоподобной выдумкой о
 * ролике, которого никто не видел. Язык был прибит гвоздями («Отвечай на
 * русском»), то есть мультиязычности из ТЗ не было вовсе.
 *
 * Теперь бот идёт тем же путём, что и кнопка разбора в UI: reference-pipeline
 * скачивает ролик, режет кадры, реально транскрибирует (субтитры / whisper) и
 * синтезирует разбор. Язык берётся из самой транскрибации, а не назначается
 * заранее.
 */

import {
  analyzeIdeaReference,
  releaseAnalysisSlot,
  tryAcquireAnalysisSlot,
  type ReferenceAnalysisResult,
} from "../reference-pipeline"
import { isAnthropicMockMode } from "../mock/mode"

export type VideoPlatform = "youtube" | "tiktok" | "instagram" | "unknown"

export function detectPlatform(url: string): VideoPlatform {
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

/** Длина куска расшифровки, который показываем в чате как доказательство. */
const TRANSCRIPT_PREVIEW_LIMIT = 400

export type TelegramVideoAnalysisStatus = "completed" | "skipped" | "busy" | "failed"

export interface TelegramVideoAnalysis {
  status: TelegramVideoAnalysisStatus
  /** Текст для чата. Пустым не бывает: молчание бота хуже честного отказа. */
  text: string
  /** Язык, определённый по транскрибации (null — расшифровки не получили). */
  language: string | null
}

/**
 * Причина, по которой реальный разбор запускать нельзя. null — можно.
 *
 * Разбор упирается в платный Anthropic (анализ кадров + синтез) и в whisper,
 * поэтому при выключенных платных API и в mock-режиме мы вообще не заходим в
 * pipeline: в mock-режиме reference-pipeline фикстур не отдаёт, он честно
 * скачивал бы ролик и звал платные модели.
 */
export function describeAnalysisBlocker(): string | null {
  if (isAnthropicMockMode()) {
    return "Mock-режим Anthropic (ANTHROPIC_MOCK_MODE=true): транскрибация и разбор не запускались, реальных вызовов нет."
  }
  if (process.env.ENABLE_PAID_APIS !== "true") {
    return "Платные API отключены (ENABLE_PAID_APIS≠true): транскрибация и разбор ролика недоступны."
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return "ANTHROPIC_API_KEY не настроен: разбор ролика недоступен."
  }
  return null
}

/** Экранируем то, что пришло из модели и расшифровки: sendMessage шлёт HTML. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function line(label: string, value: string | null | undefined): string | null {
  const clean = (value || "").trim()
  if (!clean) return null
  return `${label}: ${escapeHtml(clean)}`
}

/**
 * Строка про транскрибацию. Если расшифровки нет — говорим об этом прямо,
 * потому что «разбор без транскрипта» и «разбор с транскриптом» — это разная
 * степень доверия к выводам, и пользователь должен её видеть.
 */
function formatTranscriptSection(result: ReferenceAnalysisResult): string[] {
  const transcript = result.breakdown.transcript
  const fullText = transcript?.fullText?.trim() || ""

  if (!result.transcriptExtracted || fullText.length === 0) {
    return [
      "Транскрибация: не получена (нет субтитров и распознавание не дало текста).",
      "Разбор построен по кадрам — выводы о речи не делались.",
    ]
  }

  const preview = fullText.slice(0, TRANSCRIPT_PREVIEW_LIMIT)
  const suffix = fullText.length > TRANSCRIPT_PREVIEW_LIMIT ? "…" : ""

  return [
    `Транскрибация: язык ${transcript?.language || "не определён"}, источник ${transcript?.source || "unknown"}, ${fullText.length} символов.`,
    `«${escapeHtml(preview)}${suffix}»`,
  ]
}

/**
 * «Почему залетело» собираем из абстрагированных паттернов разбора —
 * это единственное место в ReferenceBreakdown, где модель объясняет причину
 * успеха, и у паттернов есть сила, по которой их можно отсортировать.
 */
function formatWhyViral(result: ReferenceAnalysisResult): string[] {
  const patterns = [...(result.breakdown.abstractedPatterns || [])]
    .sort((a, b) => (b.strength || 0) - (a.strength || 0))
    .slice(0, 3)

  if (patterns.length === 0) {
    return ["Почему залетело: модель не выделила устойчивых паттернов."]
  }

  return [
    "Почему залетело:",
    ...patterns.map(p => `- ${escapeHtml(p.name)} (${p.strength}/100): ${escapeHtml(p.abstractDescription)}`),
  ]
}

function formatAnalysis(url: string, result: ReferenceAnalysisResult): string {
  const breakdown = result.breakdown
  const narrative = breakdown.narrativeMechanics
  const visual = breakdown.visualPatterns

  const visualParts = [
    visual.aesthetic,
    visual.cameraStyle ? `камера — ${visual.cameraStyle}` : null,
    visual.lighting ? `свет — ${visual.lighting}` : null,
    visual.effects && visual.effects.length > 0 ? `эффекты — ${visual.effects.join(", ")}` : null,
  ].filter(Boolean).join("; ")

  const lines: (string | null)[] = [
    `Разбор ролика (${PLATFORM_NAMES[detectPlatform(url)]})`,
    url,
    "",
    ...formatTranscriptSection(result),
    "",
    line("Хук", narrative.hookType ? `${narrative.hookType} — ${narrative.hookDescription}` : narrative.hookDescription),
    line("Основная часть", narrative.bodyMechanic),
    line("Структура", narrative.narrativeTemplate),
    line("Ритм", narrative.pacing),
    line("CTA", narrative.ctaMechanic),
    line("Визуальный стиль", visualParts),
    "",
    ...formatWhyViral(result),
    "",
    `Сцен разобрано: ${breakdown.sceneTimeline.length}. Уверенность разбора: ${Math.round((breakdown.confidence || 0) * 100)}%.`,
  ]

  if (result.errors.length > 0) {
    lines.push(`Замечания пайплайна: ${escapeHtml(result.errors.join("; "))}`)
  }

  return lines.filter(l => l !== null).join("\n")
}

/**
 * Полный разбор уже созданной идеи через reference-pipeline.
 *
 * Идею создаёт вызывающий код (боту нужен её id для прогресса и для записи
 * расшифровки), сюда приходит только ideaId. Слот concurrency берём тем же
 * механизмом, что и HTTP-эндпоинт разбора, иначе телеграм-ссылки могли бы
 * пробить лимит в два параллельных анализа.
 */
export async function analyzeIdeaVideo(ideaId: number, url: string): Promise<TelegramVideoAnalysis> {
  const blocker = describeAnalysisBlocker()
  if (blocker) {
    return {
      status: "skipped",
      language: null,
      text: [
        `Платформа: ${PLATFORM_NAMES[detectPlatform(url)]}`,
        `Ссылка: ${url}`,
        "",
        blocker,
        "Ссылка сохранена как идея — разбор можно запустить позже из интерфейса.",
      ].join("\n"),
    }
  }

  if (!tryAcquireAnalysisSlot()) {
    return {
      status: "busy",
      language: null,
      text: [
        `Ссылка сохранена как идея #${ideaId}.`,
        "Сейчас идут два других разбора — очередь занята.",
        "Запустите разбор позже из интерфейса или пришлите ссылку ещё раз.",
      ].join("\n"),
    }
  }

  // Пока pipeline работает, UI должен видеть running: он опрашивает эти поля
  // ровно так же, как при запуске разбора из интерфейса.
  await prisma.idea.update({
    where: { id: ideaId },
    data: { referenceStatus: "running", errorMessage: null },
  }).catch(() => { /* не критично: pipeline всё равно перепишет статус */ })

  try {
    const result = await analyzeIdeaReference(ideaId)
    return {
      status: "completed",
      language: result.breakdown.transcript?.language ?? null,
      text: formatAnalysis(url, result),
    }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : "неизвестная ошибка"

    await prisma.idea.update({
      where: { id: ideaId },
      data: {
        referenceStatus: "failed",
        errorMessage: message.slice(0, 2000),
        analysisProgress: null,
      },
    }).catch(() => { /* сообщение пользователю важнее записи статуса */ })

    return {
      status: "failed",
      language: null,
      text: [
        `Не удалось разобрать ролик: ${escapeHtml(message)}`,
        "",
        `Ссылка сохранена как идея #${ideaId} — разбор можно повторить из интерфейса.`,
      ].join("\n"),
    }
  }
  finally {
    releaseAnalysisSlot()
  }
}
